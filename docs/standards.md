# HearMe and existing V2X standards

HearMe is a **low-cost Bluetooth Low Energy profile** that carries the core fields of existing
road-safety messages in 12–27 bytes, for vehicles and people that will never get an ITS-G5 or C-V2X
radio. This page maps HearMe v1.1 fields to the closest messages in ETSI and SAE standards.

> Element names and units below are given as we understand the current versions of these
> standards; **check them against the official texts** (ETSI TS 103 300-3, ETSI EN 302 637-2,
> SAE J2735) before citing them formally.

## Who sends what

In the VRU Awareness Message (VAM, ETSI TS 103 300-3) and the SAE J2735 Personal Safety Message
(PSM), a **vulnerable road user (VRU) broadcasts about itself** so vehicles can avoid it. In HearMe,
the **quiet vehicle broadcasts about itself** and the VRU listens. HearMe vehicle packets are therefore
closer in role to the vehicle-side messages (ETSI CAM, EN 302 637-2; SAE J2735 Basic Safety Message,
BSM), but the e-bikes and e-scooters that send them are themselves VRUs in the ETSI sense (VRU profile
"bicyclist", which covers light vehicles such as e-scooters). The VAM is therefore a natural target:
a gateway could translate a HearMe e-bike packet into a VAM about that e-bike.

## Field mapping

| HearMe v1.1 field | ETSI VAM (TS 103 300-3) | SAE J2735 PSM | Notes |
|---|---|---|---|
| version / type code | `stationType` + VRU profile (pedestrian, bicyclist, motorcyclist, animal) in the low-frequency container | `basicType` (aPEDESTRIAN, aPEDALCYCLIST, …); `propulsion` for motorised devices | HearMe types (e_bike, e_scooter, tuk_tuk, car, bus, motorcycle) map to station types / profiles; bus and car are not VRUs (CAM / BSM) |
| rolling ID, 4 bytes, changes every 10 min | station ID (4 bytes) in the PDU header, changed as a pseudonym | `id` TemporaryID (4 octets) | Same size and the same idea: a short-lived pseudonym |
| speed, uint8, 0.1 m/s | `speed` (high-frequency container) | `speed` Velocity, 0.02 m/s units | HearMe is coarser (0.1 m/s, max 25.4 m/s) |
| heading, deg / 2 | `heading` (high-frequency container) | `heading`, 0.0125° units | HearMe 2° resolution is ample for "from your left" |
| lat / lon int32, 1e-7° | `referencePosition` (basic container) | `position` (lat / long, 1/10 µdeg) | **Same resolution** in all three |
| GPS_VALID flag | position confidence (`referencePosition` confidence ellipse) | `accuracy` PositionalAccuracy | HearMe has one bit, no accuracy value; the receiver assumes 4 m RMS |
| BRAKING flag | acceleration fields / exterior lights (CAM) | `accelSet` (PSM), `brakes` (BSM) | One bit in HearMe |
| REVERSING flag | drive direction (CAM) | `transmission` (BSM) | |
| bus route + door + ramp | CAM public-transport container (special vehicle container) | no direct PSM element | HearMe adds the boarding door for blind passengers |
| stop / crossing short code + name | no VAM element; closest are infrastructure messages (e.g. MAP / IVI) | no PSM element | HearMe-specific: announces places to pedestrians |
| 4-byte truncated HMAC (fleet key) | ETSI ITS security (IEEE 1609.2-style certificates and signatures) | IEEE 1609.2 security | HearMe's MAC is a deterrent, not certificate-grade security (SPEC section 9) |

**What HearMe drops**, to fit 31-byte legacy advertising: accuracy values, acceleration, path history,
path prediction, vehicle size, clustering, and certificates. **What it adds:** place announcements and
bus boarding information for blind people, and an acoustic-free warning chain to a $3 wristband or a
phone.

## Why a BLE profile and not V2X

| | ITS-G5 / C-V2X | HearMe BLE |
|---|---|---|
| Radio in an e-bike, e-scooter or tuk-tuk | Rare; a dedicated module costs far more than the vehicle electronics budget | BLE chips already in many displays and controllers (~$0–1 firmware, estimate), or a retrofit beacon (~$2.5–8, estimate) |
| Radio in a pedestrian's pocket | Not in phones today | Every smartphone; or a ~$3 wristband (estimate) |
| Security | PKI with certificates | Truncated HMAC (v1); Ed25519 planned for v2 extended advertising |
| Message richness | Full VAM / CAM / PSM / BSM | Core fields only |

A **gateway** (a roadside unit or a connected phone) can translate between the two: HearMe packets
into VAMs or PSMs for vehicles with V2X, and the other way round for a blind pedestrian's wristband.
Proposed standardisation routes are in `protocol/SPEC.md` (section 12) and `docs/adoption.md`.

## Sources

- ETSI TS 103 300-3, Intelligent Transport Systems; Vulnerable Road Users awareness; Part 3:
  Specification of VRU awareness basic service (VAM): https://www.etsi.org/standards (search "TS 103 300-3")
- ETSI EN 302 637-2, Cooperative Awareness Basic Service (CAM): https://www.etsi.org/standards (search "EN 302 637-2")
- SAE J2735, V2X Communications Message Set Dictionary (PSM, BSM): https://www.sae.org/standards/content/j2735/
- IEEE 1609.2, Security services for applications and management messages: https://standards.ieee.org/ (search "1609.2")
