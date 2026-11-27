# Power budget

All current figures are **approximate**. Datasheet-style numbers for the ESP32-C3 and
nRF52 are typical values as we recall them from the vendors' datasheets, rounded,
and must be checked against the current datasheet and **measured on the real
board** (dev boards add LEDs, regulators and USB bridges that draw extra current).
Usage patterns are **assumptions**.

## 1. Reference currents (approximate)

| State | ESP32-C3 (at 3.3 V) | nRF52805/810-class (at 3 V, DC/DC on) |
|---|---|---|
| Radio receiving (BLE scan window), CPU running | ~80-90 mA | ~5-7 mA |
| CPU active, radio off (modem sleep) | ~15-25 mA | ~2-3 mA |
| Light sleep, RAM retained | ~0.13 mA | ~2-3 uA (System ON idle) |
| Deep sleep | ~5 uA | <1 uA (System OFF) |
| BLE TX burst at ~+9/+10 dBm | short bursts; dominated by CPU/radio-on time | ~10-15 mA during TX (+4 dBm max on nRF52805/810) |

The gap in receive current (roughly 15x) is the main reason a production wristband
should use a low-power BLE SoC rather than the ESP32-C3.

## 2. Wristband

### 2.1 Scan duty cycle versus detection

A vehicle sends one advertising event every ~105 ms (100 ms + 0-10 ms advDelay) on
channels 37, 38 and 39. A scanner listening on one channel for a window W hears
about W / 105 ms packets per window from each beacon (before losses).

| Scan setting (window / interval) | Duty | Packets per second per beacon (approx, before ~10 % loss) | Fit with receiver defaults |
|---|---|---|---|
| 100 / 100 ms (continuous) | 100 % | ~9.5 | best |
| 60 / 100 ms | 60 % | ~5.7 | good |
| 30 / 100 ms | 30 % | ~2.9 | usable; slower distance filter convergence |
| 30 / 300 ms | 10 % | ~1 | **too sparse**: the receiver marks a track stale after 2.5 s without packets; with ~1 packet/s, gaps of 2.5 s happen roughly 1 time in 10 |

So the wristband should scan at **>= 30-60 %** whenever HearMe beacons are around,
and can drop to ~5-10 % only as an "is anything here?" idle mode.

### 2.2 Daily budget (assumptions)

Assumptions: user walks outdoors 3 h per day; beacons in range half of that time;
band switched off (S2) or in deep sleep when not walking; 100 alerts per day, each
0.8 s of vibration at ~80 mA (coin ERM, from VBAT); LED negligible.

| Item | ESP32-C3 | nRF52-class |
|---|---|---|
| Active mode, 1.5 h at 60 % scan (0.6 x 85 + 0.4 x 15 = ~57 mA) | ~86 mAh | ~1.5 h x ~4 mA = ~6 mAh |
| Idle mode, 1.5 h at 10 % scan with light sleep (~9 mA) | ~14 mAh | ~1 mAh |
| Vibration motor, 100 x 0.8 s x 80 mA | ~1.8 mAh | ~1.8 mAh |
| LDO quiescent + battery protection, 24 h x ~50 uA | ~1.2 mAh | ~1.2 mAh |
| **Total per day** | **~103 mAh** | **~10 mAh** |
| 200 mAh battery lasts (usable ~85 %) | **~1.6 days** of this pattern; continuous scanning would last only **~2 h** | **~2 weeks** of this pattern; ~1 day of continuous scanning |

Conclusions:

- The ESP32-C3 prototype works for demos and short pilots with **nightly charging**,
  but only if the firmware duty-cycles the scanner and sleeps between windows.
  Continuous scanning at ~85 mA empties 200 mAh in about 2 hours.
- Light sleep while BLE is active needs a low-power clock; many small ESP32-C3 boards
  have no 32 kHz crystal, which limits how deep it can sleep between windows
  (measure before relying on the 9 mA idle figure).
- A production band on an nRF52-class SoC could last on the order of a week or more on
  150-200 mAh. Motor energy is small; scanning dominates.
- Charging: TP4056 at ~130 mA (R3 = 10k) refills 200 mAh in roughly 2 hours.

## 3. Vehicle beacon

### 3.1 While riding

| Load (3.3 V side) | Current (approx) |
|---|---|
| ESP32-C3 advertising every 100 ms, CPU parsing GPS (no light sleep) | ~25-40 mA average |
| GPS module tracking (NEO-6M ~40-50 mA; ATGM336H class ~25 mA) | ~25-50 mA |
| LED | ~1 mA (can be blinked) |
| **Total** | **~50-90 mA, about 0.2-0.3 W** |

From the vehicle battery through an ~85 % efficient buck: **~0.25-0.35 W**, i.e.
~5-8 mA at 48 V or ~20-30 mA at 12 V.

Context: a typical 48 V, 13 Ah e-bike pack stores ~600 Wh; 3 h of riding per day
costs ~1 Wh, about **0.2 % of the pack**, or well under 1 % of range. Negligible.

### 3.2 While parked (the real design constraint)

Leaving the beacon running costs ~6-8 Wh/day: about 1 % per day of a 600 Wh e-bike
pack, but roughly **10 % per day of a small 12 V, 7 Ah motorbike battery**, which is
unacceptable. Parked vehicles need no warnings (receivers ignore speeds below
0.5 m/s), so:

1. **Ignition/motion off -> stop advertising, GPS off, ESP32-C3 deep sleep.** Wake on
   GPIO3 (ignition or motion line). On the ESP32-C3 only GPIO0-5 can wake the chip
   from deep sleep, which is one reason the sense input is on GPIO3 (verify against
   the ESP-IDF docs for the chip revision used).
2. If no ignition wire exists, wake periodically (for example every 5-10 s) to sample
   a motion switch, or use the motor controller's "key-on" signal.
3. **Switch the GPS off**, not just the MCU: add a load switch on GPS VCC or use the
   receiver's power-save/backup mode (the prototype schematic powers the GPS
   permanently; a production board must not).
4. **The buck converter's own quiescent current dominates** once the MCU sleeps.
   Cheap modules can draw around 1-5 mA at 48 V (tens to hundreds of mW); a good
   100 V buck IC is in the ~10-100 uA class. Choose a low-Iq converter, or power the
   beacon only from the vehicle's switched (ignition) supply.

Target parked drain: **< 1 mW** (estimate, achievable with a low-Iq buck + deep
sleep + GPS off).

### 3.3 Integrated beacons

When HearMe runs as firmware on an existing BLE chip, the added load is just the
advertising: one extra ~0.4 ms advertising event per 100 ms, on the order of
**0.1-0.5 mA** average depending on the SoC (estimate).

## 4. Phone app considerations

- **Battery:** continuous BLE scanning plus GPS (for position mode and own heading)
  plus text-to-speech. Scanning alone is typically a modest drain on modern phones;
  GPS and the screen dominate. We have not measured this; plan to measure on a
  low-end Android phone, a mid-range Android phone and an iPhone.
- **Android:** background scanning is throttled (scan-start rate limits, low-power
  scan mode when the screen is off, Doze). A foreground service with a persistent
  notification and an explicit scan mode is the usual way to keep scanning while
  walking; permissions differ by Android version (location permission on older
  versions, `BLUETOOTH_SCAN` on newer ones).
- **iOS:** apps in the background can generally scan only for advertisements that
  carry specific service UUIDs, and duplicate reports are coalesced. v1.1 beacons put a
  128-bit HearMe service UUID in the scan response (SPEC section 2.2) so a background app can
  discover them (to be verified on a real iPhone); real-time warnings still need the app in
  the **foreground** or a paired wristband.
- **Adaptive behaviour:** the app should reduce GPS use when no HearMe beacons are
  heard, and scan at full rate only while walking (step detection).
- Real numbers must come from a pilot; see `docs/limitations.md`.
