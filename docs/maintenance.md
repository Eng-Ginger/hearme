# Maintenance and operations

HearMe has no road infrastructure to maintain except small beacons at stops and
crossings, but beacons, keys, firmware and batteries still need owners. This page
says who does what. Items marked *proposal* are design intentions, not implemented.

## 1. Responsibilities

| Asset | Owner / maintainer | Typical tasks |
|---|---|---|
| Beacons built into new vehicles | vehicle manufacturer (firmware), dealer/service shop | firmware updates during service, fault codes |
| Retrofit beacons on fleet vehicles (shared scooters, delivery bikes, tuk-tuk cooperatives, buses) | fleet operator | install, monthly health check, replace on failure |
| Beacons on private vehicles | owner, with installer/dealer | install, check status LED |
| Bus-stop beacons | public transport authority or bus operator (same owner as stop signs and timetables) | install, battery/power, name and short-code updates |
| Crossing beacons | road / traffic authority | install with signal maintenance rounds |
| School-zone beacons | municipality with the school | term-time checks |
| Wristbands | the user; distributing organisation (blind association, NGO, city) for support and replacement | charging, strap, battery replacement |
| Phone app | app publisher (proposal: open source, published by the city or an association) | updates, key list updates |
| Fleet keys and short-code registry | a **key authority**, proposal: the city transport authority or a national body | key generation, rotation, distribution, revocation |
| City dashboard | city traffic / road-safety department | data retention, access control |

## 2. Firmware updates

- **Vehicle beacons:** update at depots or during service, over USB or over the air
  (Wi-Fi/BLE OTA on the ESP32-C3) from an operator tool. Production firmware *should*
  use secure boot and signed images so a stolen update tool cannot install malicious
  firmware (*proposal*; the prototype has neither).
- **Staged rollout:** 1-5 % of a fleet first, check health counts, then the rest.
- **Protocol compatibility:** receivers must keep decoding v1 while v2 beacons roll out;
  beacons may send v1 and v2 side by side (see `protocol/SPEC.md` section 11).
- **Wristbands:** update through the companion app (BLE OTA) or USB-C at a
  distribution centre. Users who never update must still get warnings: firmware
  changes must not break v1 decoding.
- **Phone app:** normal app-store updates; the fleet-key list can also be refreshed
  without an app update.

## 3. Key management and rotation

v1 facts that constrain this (see `protocol/SPEC.md` sections 6-7):

- There is **no key identifier** in the packet. A receiver tries every fleet key it
  holds, for 3 epochs each. HMAC-SHA256 on ~30 bytes is cheap, so tens of keys are
  fine even on a wristband.
- Keys are symmetric and will eventually leak (threat T5); rotation limits how long a
  leaked key stays useful.

Proposed procedure:

1. The key authority generates one 32-byte `fleet_key` per fleet per period (for
   example per year), each with an ID and validity dates (kept off-air).
2. **Overlap:** a new key is pushed to receivers (app sync; wristbands via their app)
   at least one month before beacons switch to it. Receivers accept old and new keys
   during the overlap.
3. Beacons switch at their next service or OTA update.
4. The old key is removed from receivers after the overlap ends.
5. **Revocation:** if a key leaks (for example, a spoofing campaign shows up as many MAC
   failures in the aggregate counts), shorten the overlap and rotate early. Because
   receivers warn on unverified packets by default, revocation never removes
   protection; it only changes the "verified" ranking.
6. **Device secrets** (`device_secret`, rolling IDs) are generated on the device at
   provisioning and never leave it except into the operator's maintenance database
   (needed for health checks below). They are not rotated; a compromised device is
   re-provisioned.
7. **Time:** beacons need UTC to within a few minutes for MAC epochs. GPS beacons get it
   from GPS; others need their RTC set at provisioning and checked at each service.
   ESP32 sleep-clock drift can be large, so beacons without GPS should re-sync time
   from the operator tool regularly.

## 4. Batteries and charging

- **Wristband:** charge nightly via USB-C (about 2 h for 200 mAh at 130 mA). The status
  LED shows charging (TP4056 CHRG LED) and low battery (firmware pattern). LiPo cells
  typically lose noticeable capacity after a few hundred cycles, so a daily-charged
  band needs a battery or band replacement roughly every 1-2 years (estimate). Use
  protected cells only; replacement through the distributing organisation, not by
  users opening the case.
- **Vehicle beacons:** powered from the vehicle; no battery to replace. Check the fuse
  and connector at service.
- **Infrastructure beacons:** preferably powered from the shelter's mains or solar
  lighting supply. Battery-only beacons (primary lithium) at 200-500 ms advertising
  and 0 dBm need a replacement schedule; set it from measured current, and log the
  install date on the asset register.

## 5. Health checks

The design keeps privacy, so health checks must not create a tracking database for
everyone.

- **Self-test at power-up:** beacon checks GPS fix, clock validity and advertising,
  shows the result on the status LED (pattern table to be defined with the firmware).
- **Operator check (*proposal*):** an operator app holds its own fleet's
  `device_secret` list, so it can resolve rolling IDs of *its own* vehicles at the depot
  and confirm each one is advertising, with plausible speed and position. This works
  without uploading anything from pedestrians' receivers.
- **Field check:** any phone with the app in "maintenance mode" shows nearby HearMe
  packets with decode/MAC status and RSSI, useful for stop and crossing beacons.
- **Aggregate signals:** city dashboard trends (for example a corridor whose counts drop
  to zero) can flag failed infrastructure beacons, without per-device data.
- **Infrastructure register:** each stop/crossing beacon has a short code, location,
  owner, power source and install date in the city's asset register; the same table
  feeds the app's offline name lookup (localised names, including Arabic).

## 6. End of life

Beacons and wristbands contain a LiPo cell (wristband) and electronics: collect
through the distributing organisation or fleet operator for e-waste recycling.
Wipe keys (flash erase) before disposal or resale.
