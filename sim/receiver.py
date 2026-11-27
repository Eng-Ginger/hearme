"""HearMe receiver core - Python port.

Line-for-line equivalent of packages/receiver-core/src/receiver.ts and
firmware/lib/hearme_receiver/hearme_receiver.c. tests/cross_language proves the
three produce identical alert events on the shared traces.

Pipeline per packet:
  decode -> (optional) MAC check -> per-rolling-ID track
  RSSI EMA -> log-distance path loss -> alpha-beta (steady-state Kalman) filter
  -> geometry (GPS: bearing, closest point of approach, time-to-reach;
               RSSI-only: approach rate) -> level with hysteresis -> events
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "protocol", "python"))
import hearme_protocol as hp  # noqa: E402

IGNORE, AWARE, WARN, URGENT = 0, 1, 2, 3
LEVEL_NAMES = ["ignore", "aware", "warn", "urgent"]
EARTH_R = 6371008.8


@dataclass
class Config:
    tx_power_1m: float = -50.0      # RSSI at 1 m for a +10 dBm beacon (SPEC)
    path_loss_n: float = 2.2        # log-distance exponent
    rssi_alpha: float = 0.3         # EMA weight on new RSSI sample
    ab_alpha: float = 0.35          # alpha-beta filter gains on distance
    ab_beta: float = 0.06
    stale_s: float = 2.5            # no packet for this long -> ignore
    forget_s: float = 30.0          # drop the track entirely
    danger_radius_m: float = 3.0    # RSSI-only: "will reach you" radius around the pedestrian
    pass_radius_m: float = 8.0      # GPS: a vehicle passing closer than this is a conflict
    aware_dist_m: float = 35.0
    warn_ttr_s: float = 6.0
    urgent_ttr_s: float = 3.0
    urgent_dist_m: float = 6.0      # close + approaching -> urgent regardless of ttr
    hysteresis_s: float = 1.0       # exit thresholds are this much looser
    hold_s: float = 1.5             # lower level must persist this long before downgrade
    min_approach_mps: float = 0.8   # RSSI-only: closing speed needed to count as approaching
    moving_mps: float = 0.5         # below this a vehicle is "parked"
    alert_repeat_s: float = 4.0     # min interval between events of the same level per track
    bus_announce_dist_m: float = 30.0
    infra_announce_dist_m: float = 12.0
    infra_reannounce_s: float = 120.0
    require_mac: bool = False       # if False, unverified packets still warn (fail-safe)
    use_position: bool = True       # False = RSSI-only mode
    fleet_key: Optional[bytes] = None
    max_tracks: int = 32


@dataclass
class Track:
    id: str
    type: str
    first_t: float
    last_t: float
    packets: int = 0
    rssi_ema: float = 0.0
    dist: float = 0.0
    rate: float = 0.0               # d(dist)/dt, negative = approaching
    level: int = IGNORE
    lower_since: float = -1.0
    last_alert_t: List[float] = field(default_factory=lambda: [-1e9] * 4)
    announced: bool = False
    last_announce_t: float = -1e9
    pkt: Optional[hp.Packet] = None
    verified: bool = False
    # last geometry (for UI)
    side: str = "unknown"
    ttr: Optional[float] = None
    geo_dist: Optional[float] = None


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def rssi_to_distance(rssi: float, cfg: Config) -> float:
    return math.pow(10.0, (cfg.tx_power_1m - rssi) / (10.0 * cfg.path_loss_n))


def enu_offset(lat_from: float, lon_from: float, lat_to: float, lon_to: float):
    """Equirectangular offset in metres (east, north) from -> to. Fine below ~1 km."""
    k = math.pi / 180.0
    dx = (lon_to - lon_from) * k * EARTH_R * math.cos(lat_from * k)
    dy = (lat_to - lat_from) * k * EARTH_R
    return dx, dy


def side_of(rel_deg: float) -> str:
    if -45.0 <= rel_deg <= 45.0:
        return "ahead"
    if 45.0 < rel_deg <= 135.0:
        return "right"
    if -135.0 <= rel_deg < -45.0:
        return "left"
    return "behind"


# --------------------------------------------------------------------- text
NAMES_EN = {"e_bike": "Electric bike", "e_scooter": "E-scooter", "tuk_tuk": "Tuk-tuk", "car": "Car",
            "bus": "Bus", "motorcycle": "Motorbike"}
NAMES_AR = {"e_bike": "دراجة كهربائية", "e_scooter": "سكوتر كهربائي", "tuk_tuk": "توك توك", "car": "سيارة",
            "bus": "حافلة", "motorcycle": "دراجة نارية"}
FEMININE = {"e_bike", "car", "bus", "motorcycle"}
SIDE_EN = {"left": "from your left", "right": "from your right", "ahead": "ahead", "behind": "from behind",
           "unknown": ""}
SIDE_AR = {"left": "من يسارك", "right": "من يمينك", "ahead": "أمامك", "behind": "من خلفك", "unknown": ""}
DOOR_EN = {"front": "front", "middle": "middle", "rear": "rear", "unknown": ""}
DOOR_AR = {"front": "الأمامي", "middle": "الأوسط", "rear": "الخلفي", "unknown": ""}
BUS_SIDE_EN = {"left": "on your left", "right": "on your right", "ahead": "ahead", "behind": "behind you",
               "unknown": ""}
PLACE_EN = {"bus_stop": "Bus stop", "crossing": "Crossing", "school_zone": "School zone"}
PLACE_AR = {"bus_stop": "موقف حافلات", "crossing": "معبر مشاة", "school_zone": "منطقة مدرسية"}


def seconds_en(n: int) -> str:
    return "1 second" if n == 1 else f"{n} seconds"


def seconds_ar(n: int) -> str:
    if n == 1:
        return "ثانية واحدة"
    if n == 2:
        return "ثانيتان"
    if n <= 10:
        return f"{n} ثوانٍ"
    return f"{n} ثانية"


def speed_word(vtype: str, speed: Optional[float]):
    if speed is None:
        return "", ""
    fem = vtype in FEMININE
    if speed >= 5.5:
        return "fast", ("سريعة" if fem else "سريع")
    if speed < 2.5:
        return "slow", ("بطيئة" if fem else "بطيء")
    return "", ""


def vehicle_text(level: int, vtype: str, speed: Optional[float], side: str, seconds: Optional[int]):
    en_parts = [NAMES_EN[vtype] + (" nearby" if level == AWARE else "")]
    ar_parts = [NAMES_AR[vtype] + (" بالقرب منك" if level == AWARE else "")]
    sw_en, sw_ar = speed_word(vtype, speed)
    if level >= WARN and sw_en:
        en_parts.append(sw_en)
        ar_parts.append(sw_ar)
    if SIDE_EN[side]:
        en_parts.append(SIDE_EN[side])
        ar_parts.append(SIDE_AR[side])
    if level >= WARN and seconds is not None:
        en_parts.append(seconds_en(seconds))
        ar_parts.append(seconds_ar(seconds))
    en, ar = ", ".join(en_parts), "، ".join(ar_parts)
    if level == URGENT:
        en, ar = "Stop! " + en, "توقف! " + ar
    return en, ar


def bus_text(route: str, door: str, side: str):
    en = f"Bus {route} arriving"
    ar = f"الحافلة {route} تصل"
    if DOOR_EN[door]:
        en += f", {DOOR_EN[door]} door"
        ar += f"، الباب {DOOR_AR[door]}"
        if BUS_SIDE_EN[side]:
            en += " " + BUS_SIDE_EN[side]
            ar += " " + SIDE_AR[side]
    return en, ar


def place_text(vtype: str, name: str):
    return f"{PLACE_EN[vtype]}: {name}", f"{PLACE_AR[vtype]}: {name}"


# --------------------------------------------------------------------- core
class Receiver:
    def __init__(self, cfg: Optional[Config] = None):
        self.cfg = cfg or Config()
        self.tracks: Dict[str, Track] = {}
        self.pose = None   # (lat, lon, heading_deg)
        self.packets_rejected = 0

    # inputs ---------------------------------------------------------------
    def set_pose(self, lat: float, lon: float, heading_deg: float):
        self.pose = (lat, lon, heading_deg)

    def process_payload(self, t: float, rssi: float, payload: bytes) -> List[dict]:
        try:
            p = hp.decode(payload)
        except hp.DecodeError:
            self.packets_rejected += 1
            return []
        verified = False
        if self.cfg.fleet_key is not None:
            verified = hp.verify(payload, self.cfg.fleet_key, hp.epoch_of(t))
            if not verified and self.cfg.require_mac:
                self.packets_rejected += 1
                return []
        return self.process_packet(t, rssi, p, verified)

    def process_packet(self, t: float, rssi: float, p: hp.Packet, verified: bool = False) -> List[dict]:
        cfg = self.cfg
        key = p.rolling_id + ":" + p.type
        tr = self.tracks.get(key)
        if tr is None:
            if len(self.tracks) >= cfg.max_tracks:
                self._evict()
            tr = Track(id=p.rolling_id, type=p.type, first_t=t, last_t=t)
            tr.rssi_ema = rssi
            tr.dist = rssi_to_distance(rssi, cfg)
            tr.rate = 0.0
            self.tracks[key] = tr
        else:
            tr.rssi_ema = tr.rssi_ema + cfg.rssi_alpha * (rssi - tr.rssi_ema)
            z = rssi_to_distance(tr.rssi_ema, cfg)
            dt = t - tr.last_t
            if dt < 0.01:
                dt = 0.01
            pred = tr.dist + tr.rate * dt
            r = z - pred
            tr.dist = pred + cfg.ab_alpha * r
            tr.rate = tr.rate + cfg.ab_beta * r / dt
            if tr.dist < 0.5:
                tr.dist = 0.5
        tr.last_t = t
        tr.packets += 1
        tr.pkt = p
        tr.verified = verified
        return self._evaluate(tr, t)

    def tick(self, t: float) -> List[dict]:
        """Call periodically (e.g. 10 Hz). Downgrades stale tracks; never emits events."""
        for key in list(self.tracks.keys()):
            tr = self.tracks[key]
            age = t - tr.last_t
            if age > self.cfg.forget_s:
                del self.tracks[key]
            elif age > self.cfg.stale_s:
                tr.level = IGNORE
                tr.lower_since = -1.0
                tr.ttr = None
        return []

    # internals ------------------------------------------------------------
    def _evict(self):
        oldest = min(self.tracks, key=lambda k: self.tracks[k].last_t)
        del self.tracks[oldest]

    def _geometry(self, tr: Track):
        """Returns (dist, ttr or None, side, approaching, moving)."""
        cfg, p = self.cfg, tr.pkt
        speed = p.speed_mps
        heading = p.heading_deg
        moving = speed is None or speed >= cfg.moving_mps
        if cfg.use_position and p.has_position and p.gps_valid and self.pose is not None:
            plat, plon, phead = self.pose
            rx, ry = enu_offset(plat, plon, p.lat_e7 / 1e7, p.lon_e7 / 1e7)
            dist = math.sqrt(rx * rx + ry * ry)
            bearing = math.degrees(math.atan2(rx, ry))
            rel = bearing - phead
            while rel > 180.0:
                rel -= 360.0
            while rel <= -180.0:
                rel += 360.0
            side = side_of(rel)
            ttr = None
            approaching = False
            if speed is not None and heading is not None and speed >= cfg.moving_mps:
                h = math.radians(heading)
                vx, vy = speed * math.sin(h), speed * math.cos(h)
                tc = -(rx * vx + ry * vy) / (speed * speed)
                if tc > 0.0:
                    cx, cy = rx + vx * tc, ry + vy * tc
                    cpa = math.sqrt(cx * cx + cy * cy)
                    if cpa <= cfg.pass_radius_m:
                        approaching = True
                        ttr = tc
            return dist, ttr, side, approaching, moving
        # RSSI-only
        dist = tr.dist
        approach = -tr.rate
        ttr = None
        approaching = approach >= cfg.min_approach_mps and tr.packets >= 3
        if approaching:
            rate = speed if (speed is not None and speed > approach) else approach
            ttr = (dist - cfg.danger_radius_m) / rate
            if ttr < 0.0:
                ttr = 0.0
        return dist, ttr, "unknown", approaching, moving

    def _level_for(self, dist, ttr, approaching, moving, margin):
        cfg = self.cfg
        if not moving:
            return IGNORE
        if ttr is not None and ttr <= cfg.urgent_ttr_s + margin:
            return URGENT
        if approaching and dist <= cfg.urgent_dist_m + margin:
            return URGENT
        if ttr is not None and ttr <= cfg.warn_ttr_s + margin:
            return WARN
        if dist <= cfg.aware_dist_m + margin * 5.0:
            return AWARE
        return IGNORE

    def _event(self, tr, t, kind, urgency, side, seconds, en, ar):
        return {"t": t, "id": tr.id, "kind": kind, "type": tr.type, "side": side,
                "seconds": seconds, "urgency": urgency, "text_en": en, "text_ar": ar}

    def _evaluate(self, tr: Track, t: float) -> List[dict]:
        cfg, p = self.cfg, tr.pkt
        events: List[dict] = []
        if p.type in hp.INFRA_TYPES:
            tr.geo_dist = None
            if tr.dist <= cfg.infra_announce_dist_m and (
                    not tr.announced or t - tr.last_announce_t >= cfg.infra_reannounce_s):
                tr.announced = True
                tr.last_announce_t = t
                en, ar = place_text(p.type, p.name)
                events.append(self._event(tr, t, "place", 0, "unknown", None, en, ar))
            return events

        dist, ttr, side, approaching, moving = self._geometry(tr)
        tr.side, tr.ttr, tr.geo_dist = side, ttr, dist

        if p.type == "bus" and not tr.announced and dist <= cfg.bus_announce_dist_m and (
                approaching or (p.speed_mps is not None and p.speed_mps < 3.0)):
            tr.announced = True
            tr.last_announce_t = t
            en, ar = bus_text(p.route, p.door, side)
            events.append(self._event(tr, t, "bus_arriving", 0, side, None, en, ar))

        enter = self._level_for(dist, ttr, approaching, moving, 0.0)
        stay = self._level_for(dist, ttr, approaching, moving, cfg.hysteresis_s)
        if p.type == "bus" and p.braking:
            # a bus braking (into a stop) is expected, not a threat: cap at aware
            enter, stay = min(enter, AWARE), min(stay, AWARE)
        if enter > tr.level:
            tr.level = enter
            tr.lower_since = -1.0
            if t - tr.last_alert_t[enter] >= cfg.alert_repeat_s:
                tr.last_alert_t[enter] = t
                seconds = None
                if enter >= WARN and ttr is not None:
                    seconds = round_half_up(ttr)
                    if seconds < 1:
                        seconds = 1
                en, ar = vehicle_text(enter, p.type, p.speed_mps, side, seconds)
                events.append(self._event(tr, t, "vehicle_" + LEVEL_NAMES[enter], enter, side,
                                          seconds, en, ar))
        elif stay < tr.level:
            if tr.lower_since < 0.0:
                tr.lower_since = t
            elif t - tr.lower_since >= cfg.hold_s:
                tr.level = stay
                tr.lower_since = -1.0
        else:
            tr.lower_since = -1.0
        return events

    def states(self) -> List[dict]:
        return [{"id": tr.id, "type": tr.type, "level": LEVEL_NAMES[tr.level], "dist": tr.dist,
                 "geo_dist": tr.geo_dist, "rssi": tr.rssi_ema, "ttr": tr.ttr, "side": tr.side,
                 "packets": tr.packets, "verified": tr.verified} for tr in self.tracks.values()]


def run_trace(trace: dict) -> List[dict]:
    """Run a cross-language trace (see tests/traces) and return the emitted events."""
    c = trace.get("config", {})
    cfg = Config(**{k: v for k, v in c.items() if k != "fleet_key_hex"})
    if c.get("fleet_key_hex"):
        cfg.fleet_key = bytes.fromhex(c["fleet_key_hex"])
    rx = Receiver(cfg)
    out: List[dict] = []
    for ev in trace["events"]:
        if ev["k"] == "pose":
            rx.set_pose(ev["lat"], ev["lon"], ev["heading"])
        elif ev["k"] == "pkt":
            out += rx.process_payload(ev["t"], ev["rssi"], bytes.fromhex(ev["hex"]))
        elif ev["k"] == "tick":
            out += rx.tick(ev["t"])
    return out
