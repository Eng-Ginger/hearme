"""HearMe BLE packet codec (Python reference implementation).

Layout is defined in protocol/SPEC.md. This file is the reference that
generates protocol/test_vectors.json; the C and TypeScript codecs must
produce byte-identical output for every vector.
"""
from __future__ import annotations

import hashlib
import hmac
import struct
from dataclasses import dataclass, field
from typing import Optional

COMPANY_ID = 0xFFFF          # Bluetooth SIG "test / internal use" company identifier
VERSION = 1
EPOCH_SECONDS = 600          # rolling ID + MAC epoch length (10 min)
MAC_LEN = 4
HEADER_LEN = 8
POS_LEN = 8
MAX_BODY = 27                # 31 - (len, type 0xFF, company id 2 bytes)

TYPES = ["e_bike", "e_scooter", "tuk_tuk", "car", "bus", "bus_stop",
         "crossing", "school_zone", "motorcycle"]
TYPE_CODE = {name: i for i, name in enumerate(TYPES)}
INFRA_TYPES = {"bus_stop", "crossing", "school_zone"}

FLAG_BRAKING = 0x01
FLAG_GPS_VALID = 0x02
FLAG_HAS_POSITION = 0x04
FLAG_REVERSING = 0x08

DOORS = ["front", "middle", "rear", "unknown"]
SPEED_UNKNOWN = 0xFF
HEADING_UNKNOWN = 0xFF


class DecodeError(ValueError):
    pass


@dataclass
class Packet:
    type: str
    rolling_id: str                   # 8 hex chars
    speed_raw: int = SPEED_UNKNOWN    # 0.1 m/s units, 255 = unknown
    heading_raw: int = HEADING_UNKNOWN  # degrees / 2, 255 = unknown
    braking: bool = False
    gps_valid: bool = False
    reversing: bool = False
    lat_e7: Optional[int] = None
    lon_e7: Optional[int] = None
    route: str = ""                   # bus only
    door: str = "unknown"             # bus only
    ramp: bool = False                # bus only
    short_code: int = 0               # infrastructure only
    name: str = ""                    # infrastructure only
    mac: str = ""                     # filled by decode
    version: int = VERSION

    # convenience accessors -------------------------------------------------
    @property
    def speed_mps(self) -> Optional[float]:
        return None if self.speed_raw == SPEED_UNKNOWN else self.speed_raw / 10.0

    @property
    def heading_deg(self) -> Optional[float]:
        return None if self.heading_raw == HEADING_UNKNOWN else self.heading_raw * 2.0

    @property
    def has_position(self) -> bool:
        return self.lat_e7 is not None and self.lon_e7 is not None

    def fields(self) -> dict:
        """Canonical dict used in test vectors (raw integers only)."""
        d = {
            "type": self.type, "rolling_id": self.rolling_id,
            "speed_raw": self.speed_raw, "heading_raw": self.heading_raw,
            "braking": self.braking, "gps_valid": self.gps_valid,
            "reversing": self.reversing,
            "lat_e7": self.lat_e7, "lon_e7": self.lon_e7,
        }
        if self.type == "bus":
            d.update(route=self.route, door=self.door, ramp=self.ramp)
        if self.type in INFRA_TYPES:
            d.update(short_code=self.short_code, name=self.name)
        return d


def speed_to_raw(mps: Optional[float]) -> int:
    if mps is None:
        return SPEED_UNKNOWN
    return max(0, min(254, int(mps * 10.0 + 0.5)))


def heading_to_raw(deg: Optional[float]) -> int:
    if deg is None:
        return HEADING_UNKNOWN
    return int((deg % 360.0) / 2.0 + 0.5) % 180


def epoch_of(unix_s: float) -> int:
    return int(unix_s // EPOCH_SECONDS) & 0xFFFFFFFF


def rolling_id_for(device_secret: bytes, epoch: int) -> str:
    """Rolling anonymous ID: first 4 bytes of HMAC(device_secret, 'HMid'||epoch)."""
    return hmac.new(device_secret, b"HMid" + struct.pack("<I", epoch),
                    hashlib.sha256).digest()[:4].hex()


def compute_mac(key: bytes, epoch: int, body: bytes) -> bytes:
    msg = b"HMv1" + struct.pack("<IH", epoch, COMPANY_ID) + body
    return hmac.new(key, msg, hashlib.sha256).digest()[:MAC_LEN]


def _ascii_fixed(s: str, n: int) -> bytes:
    b = s.encode("ascii", errors="replace")[:n]
    return b + b"\x00" * (n - len(b))


def encode(p: Packet, key: bytes, epoch: int) -> bytes:
    """Return the manufacturer-specific data *after* the 2-byte company ID."""
    if p.type not in TYPE_CODE:
        raise ValueError("unknown type " + p.type)
    has_pos = p.has_position and p.type not in INFRA_TYPES
    flags = ((FLAG_BRAKING if p.braking else 0) | (FLAG_GPS_VALID if p.gps_valid else 0)
             | (FLAG_HAS_POSITION if has_pos else 0) | (FLAG_REVERSING if p.reversing else 0))
    body = bytearray()
    body.append((VERSION << 4) | TYPE_CODE[p.type])
    body += bytes.fromhex(p.rolling_id)
    body += bytes([flags, p.speed_raw & 0xFF, p.heading_raw & 0xFF])
    if has_pos:
        body += struct.pack("<ii", p.lat_e7, p.lon_e7)
    if p.type == "bus":
        body += _ascii_fixed(p.route, 6)
        body.append((DOORS.index(p.door) & 0x03) | (0x04 if p.ramp else 0))
    elif p.type in INFRA_TYPES:
        body += struct.pack("<H", p.short_code & 0xFFFF) + _ascii_fixed(p.name, 12)
    out = bytes(body) + compute_mac(key, epoch, bytes(body))
    assert len(out) <= MAX_BODY, len(out)
    return out


def encode_adv(p: Packet, key: bytes, epoch: int) -> bytes:
    """Full legacy advertising data: one manufacturer-specific AD structure."""
    body = encode(p, key, epoch)
    return bytes([len(body) + 3, 0xFF]) + struct.pack("<H", COMPANY_ID) + body


def decode(data: bytes) -> Packet:
    """Decode manufacturer data (after company ID). Does not verify the MAC."""
    if len(data) < HEADER_LEN + MAC_LEN:
        raise DecodeError("too short")
    ver, tcode = data[0] >> 4, data[0] & 0x0F
    if ver != VERSION:
        raise DecodeError("bad version")
    if tcode >= len(TYPES):
        raise DecodeError("bad type")
    t = TYPES[tcode]
    flags = data[5]
    has_pos = bool(flags & FLAG_HAS_POSITION)
    if t in INFRA_TYPES and has_pos:
        raise DecodeError("infrastructure packet with position")
    expected = HEADER_LEN + (POS_LEN if has_pos else 0) + MAC_LEN
    if t == "bus":
        expected += 7
    elif t in INFRA_TYPES:
        expected += 14
    if len(data) != expected:
        raise DecodeError("bad length")
    p = Packet(type=t, rolling_id=data[1:5].hex(), speed_raw=data[6], heading_raw=data[7],
               braking=bool(flags & FLAG_BRAKING), gps_valid=bool(flags & FLAG_GPS_VALID),
               reversing=bool(flags & FLAG_REVERSING))
    if p.heading_raw != HEADING_UNKNOWN and p.heading_raw >= 180:
        raise DecodeError("bad heading")
    off = HEADER_LEN
    if has_pos:
        p.lat_e7, p.lon_e7 = struct.unpack_from("<ii", data, off)
        off += POS_LEN
    if t == "bus":
        p.route = data[off:off + 6].split(b"\x00")[0].decode("ascii", "replace")
        db = data[off + 6]
        p.door, p.ramp = DOORS[db & 0x03], bool(db & 0x04)
        off += 7
    elif t in INFRA_TYPES:
        p.short_code = struct.unpack_from("<H", data, off)[0]
        p.name = data[off + 2:off + 14].split(b"\x00")[0].decode("ascii", "replace")
        off += 14
    p.mac = data[off:off + 4].hex()
    return p


def verify(data: bytes, key: bytes, epoch: int, window: int = 1) -> bool:
    """True if the MAC matches the key for any epoch in [epoch-window, epoch+window]."""
    body, mac = data[:-MAC_LEN], data[-MAC_LEN:]
    return any(hmac.compare_digest(compute_mac(key, (epoch + d) & 0xFFFFFFFF, body), mac)
               for d in range(-window, window + 1))


def parse_adv(adv: bytes) -> Optional[bytes]:
    """Walk AD structures; return HearMe manufacturer data (after company ID) or None."""
    i = 0
    while i < len(adv):
        ln = adv[i]
        if ln == 0 or i + 1 + ln > len(adv):
            return None
        if adv[i + 1] == 0xFF and ln >= 3 and struct.unpack_from("<H", adv, i + 2)[0] == COMPANY_ID:
            return bytes(adv[i + 4:i + 1 + ln])
        i += 1 + ln
    return None


TEST_FLEET_KEY = bytes.fromhex(
    "4865617224d650a1c3e79f0b8a2d5e6f1b3c4d5e6f708192a3b4c5d6e7f80910")
