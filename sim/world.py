"""Small 2-D world: vehicles on straight paths, BLE beacons, a radio channel and GPS noise.

Coordinates are local metres: x = east, y = north. Headings are compass degrees
(0 = north, 90 = east). Used by make_traces.py and montecarlo.py.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "protocol", "python"))
import hearme_protocol as hp  # noqa: E402
from params import GPS, RADIO  # noqa: E402

ORIGIN_LAT, ORIGIN_LON = 25.4052, 55.5136      # Ajman, UAE
EARTH_R = 6371008.8
T0 = 1_800_000_000.0                            # absolute unix time used for MAC epochs


def to_latlon(x: float, y: float) -> Tuple[float, float]:
    k = math.pi / 180.0
    lat = ORIGIN_LAT + y / (EARTH_R * k)
    lon = ORIGIN_LON + x / (EARTH_R * k * math.cos(ORIGIN_LAT * k))
    return lat, lon


@dataclass
class Vehicle:
    vtype: str
    start: Tuple[float, float]
    heading_deg: float
    speed_mps: float
    t_start: float = 0.0
    beacon: bool = True
    secret: bytes = b"veh"
    stop_at_m: Optional[float] = None    # decelerate to stop after travelling this far
    decel: float = 1.5
    route: str = ""
    door: str = "front"
    # infrastructure
    name: str = ""
    short_code: int = 0

    def state(self, t: float):
        """(x, y, speed) at time t (relative to scenario start)."""
        tau = t - self.t_start
        if tau < 0:
            tau = 0.0
        h = math.radians(self.heading_deg)
        if self.stop_at_m is None:
            s, v = self.speed_mps * tau, self.speed_mps
        else:
            t_brake_start = self.stop_at_m / self.speed_mps if self.speed_mps > 0 else 0.0
            if tau <= t_brake_start:
                s, v = self.speed_mps * tau, self.speed_mps
            else:
                tb = tau - t_brake_start
                t_stop = self.speed_mps / self.decel
                tb = min(tb, t_stop)
                s = self.stop_at_m + self.speed_mps * tb - 0.5 * self.decel * tb * tb
                v = max(0.0, self.speed_mps - self.decel * tb)
        return self.start[0] + s * math.sin(h), self.start[1] + s * math.cos(h), v

    @property
    def infra(self) -> bool:
        return self.vtype in hp.INFRA_TYPES


class GpsError:
    """First-order Gauss-Markov horizontal error, sampled at the fix rate."""

    def __init__(self, rng: np.random.Generator, sigma=GPS["sigma_per_axis_m"], tau=GPS["tau_s"]):
        self.rng, self.sigma, self.tau = rng, sigma, tau
        self.ex, self.ey = rng.normal(0, sigma), rng.normal(0, sigma)
        self.t = None

    def at(self, t: float):
        if self.t is not None:
            a = math.exp(-(t - self.t) / self.tau)
            s = self.sigma * math.sqrt(1 - a * a)
            self.ex = a * self.ex + s * self.rng.normal()
            self.ey = a * self.ey + s * self.rng.normal()
        self.t = t
        return self.ex, self.ey


class Beacon:
    """Builds HearMe packets for a vehicle, including GPS fix sampling and extrapolation."""

    def __init__(self, veh: Vehicle, rng: np.random.Generator, gps: bool = True, key=hp.TEST_FLEET_KEY):
        self.v, self.rng, self.gps, self.key = veh, rng, gps, key
        self.err = GpsError(rng)
        self.fix = None          # (t, x, y, speed, heading)
        self.next_adv = veh.t_start + rng.uniform(0, RADIO["adv_interval_s"])

    def _update_fix(self, t: float):
        period = 1.0 / GPS["fix_rate_hz"]
        if self.fix is None or t - self.fix[0] >= period:
            x, y, sp = self.v.state(t)
            ex, ey = self.err.at(t)
            spm = max(0.0, sp + self.rng.normal(0, GPS["speed_sigma_mps"])) if sp > 0 else 0.0
            hd = self.v.heading_deg + (self.rng.normal(0, GPS["heading_sigma_deg"]) if sp > 1.0 else 0.0)
            self.fix = (t, x + ex, y + ey, spm, hd)

    def packet(self, t: float) -> hp.Packet:
        v = self.v
        epoch = hp.epoch_of(T0 + t)
        rid = hp.rolling_id_for(v.secret, epoch)
        if v.infra:
            return hp.Packet(v.vtype, rid, speed_raw=0, heading_raw=hp.heading_to_raw(v.heading_deg),
                             short_code=v.short_code, name=v.name)
        _, _, true_speed = v.state(t)
        p = hp.Packet(v.vtype, rid, speed_raw=hp.speed_to_raw(true_speed),
                      heading_raw=hp.heading_to_raw(v.heading_deg))
        if self.gps:
            self._update_fix(t)
            ft, fx, fy, fsp, fhd = self.fix
            age = t - ft
            h = math.radians(fhd)
            # beacon dead-reckons between 1 Hz fixes using GNSS speed/heading
            px, py = fx + fsp * age * math.sin(h), fy + fsp * age * math.cos(h)
            lat, lon = to_latlon(px, py)
            p.lat_e7, p.lon_e7 = int(round(lat * 1e7)), int(round(lon * 1e7))
            p.gps_valid = True
            p.speed_raw = hp.speed_to_raw(fsp)
            p.heading_raw = hp.heading_to_raw(fhd)
        if v.vtype == "bus":
            p.route, p.door = v.route, v.door
        return p


class Channel:
    """Log-distance path loss + correlated log-normal shadowing + loss + body blocking."""

    def __init__(self, rng: np.random.Generator, n=RADIO["path_loss_n"], loss=RADIO["packet_loss"],
                 sigma=RADIO["shadowing_sigma_db"], body_db=RADIO["body_loss_pocket_db"]):
        self.rng, self.n, self.loss, self.sigma, self.body_db = rng, n, loss, sigma, body_db
        self.shadow = {}

    def rssi(self, key, t: float, d: float, rel_angle_deg: float) -> Optional[float]:
        if self.rng.random() < self.loss:
            return None
        prev = self.shadow.get(key)
        if prev is None:
            s = self.rng.normal(0, self.sigma)
        else:
            a = math.exp(-(t - prev[0]) / RADIO["shadowing_tau_s"])
            s = a * prev[1] + self.sigma * math.sqrt(1 - a * a) * self.rng.normal()
        self.shadow[key] = (t, s)
        body = self.body_db * (1 - math.cos(math.radians(rel_angle_deg))) / 2.0
        r = (RADIO["tx_power_1m_dbm"] - 10 * self.n * math.log10(max(d, 0.3)) + s
             + self.rng.normal(0, RADIO["fast_fading_sigma_db"]) - body)
        if r < RADIO["sensitivity_dbm"]:
            return None
        return r


def rel_angle(ped_xy, ped_heading, x, y) -> float:
    b = math.degrees(math.atan2(x - ped_xy[0], y - ped_xy[1]))
    r = (b - ped_heading + 180.0) % 360.0 - 180.0
    return r
