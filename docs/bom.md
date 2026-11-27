# Bill of materials (estimates)

**All prices are ESTIMATES in USD**, not quotes. Basis:

- *Prototype (1-10 units):* typical single-unit prices from hobby marketplaces
  (AliExpress-level for dev boards and modules) and distributors (LCSC / DigiKey /
  Mouser-level for discrete parts), late 2026, excluding shipping and tax.
- *10,000 units:* typical volume price ranges for the same class of part from
  Asian distributors and contract manufacturers, assuming a custom PCB and
  machine assembly. Ranges, because volume prices depend on supplier, timing and
  negotiation. Get real quotes before quoting these numbers externally.

Schematics: `docs/schematics/`.

---

## 1. Vehicle beacon (retrofit unit)

| Ref | Part | Prototype unit price | 10k unit price | Notes |
|---|---|---|---|---|
| U2 | ESP32-C3 board (SuperMini or DevKitM-1) / at volume: ESP32-C3-MINI-1 module or bare ESP32-C3 + antenna | 2.00-4.00 (board) | 0.90-1.80 | bare chip (C3FH4 has flash in package) ~0.8-1.1 plus crystal, passives and PCB antenna; module ~1.6-2.0 |
| U3 | GPS: u-blox NEO-6M breakout (often clones) or ATGM336H module | 3.00-6.00 | 1.50-2.50 | optional; chip-level GNSS on the main PCB could be ~1-2 |
| U1 | Buck converter, 100 V-class input, 5 V 0.5 A | 1.50-3.00 (module) / 2-3 (TI LM5164 class IC + inductor) | 0.40-1.00 | must survive TVS clamp (~93 V for SMBJ58CA); cheap 80 V modules only for 12 V vehicles |
| F1, D1, D2 | Fuse, 100 V Schottky (SS110), TVS (SMBJ24CA / SMBJ58CA) | 0.60-1.00 | 0.10-0.20 | |
| C1-C3, R1-R3, D3, D4 | passives, LED, zener | 0.50 | 0.05-0.10 | |
| J1 | harness connector + 3-wire lead | 1.00-2.00 | 0.20-0.40 | |
| - | PCB | 1.00-2.00 (small batch) | 0.10-0.20 | |
| - | IP65 enclosure, potting or conformal coat | 2.00-5.00 | 0.40-1.00 | outdoor, vibration |
| - | assembly and test | (own labour) | 0.30-0.60 | |
| | **Total, no GPS** | **~9-18** | **~2.4-5.3** | |
| | **Total, with GPS** | **~12-24** | **~3.9-7.8** | |

### 1.1 The "$1 per vehicle" target, honestly

A stand-alone retrofit box with its own 100 V power supply, enclosure and harness
**does not reach $1**. Our estimate is roughly $2.5-5 at 10k units without GPS and
$4-8 with GPS.

The $1 figure is realistic as the **incremental cost when HearMe is built into the
vehicle's existing electronics**:

| Integration case | Extra BOM (estimate) |
|---|---|
| Vehicle already has a BLE SoC (many e-bike displays/controllers, shared-scooter IoT boxes, smart locks) | **~$0**: firmware only (HearMe needs one advertising set and a 10-min key schedule) |
| Add a BLE SoC to an existing controller PCB that already has 3.3-5 V and (for shared fleets) GPS | **~$0.3-1.0**: advertising-only BLE SoCs from several Asian vendors are commonly quoted in the ~$0.2-0.5 range at volume, Nordic nRF52805-class around ~$1 (verify with quotes), plus antenna and a few passives |
| Same, without GPS | position omitted; receivers use RSSI-only mode (side unknown) |
| Stand-alone retrofit for old vehicles and tuk-tuks | ~$2.5-8 (table above) |

So "$1" should be presented as the **manufacturer-integrated** target, with
retrofit at a few dollars. Shared and delivery fleets usually already have GPS
and a cellular IoT box, so they get position at no extra cost.

---

## 2. Wristband

| Ref | Part | Prototype unit price | 10k unit price | Notes |
|---|---|---|---|---|
| U3 | ESP32-C3 SuperMini / DevKitM-1 / at volume: bare ESP32-C3 or a cheaper BLE SoC | 2.00-4.00 | 0.90-1.40 (ESP32-C3) / ~0.5-1.0 (nRF52805/810-class or low-cost BLE SoC) | see power note: an nRF52-class SoC scans at a fraction of the ESP32-C3 current |
| BT1 | LiPo 3.7 V 150-200 mAh with protection PCB | 2.00-3.50 | 0.60-1.00 | |
| U1 | TP4056 charger (or module) | 0.30-0.80 | 0.05-0.10 | |
| U2 | LDO 3.3 V (ME6211C33 / AP2112K-3.3) | 0.10-0.30 | 0.03-0.08 | |
| J1 | USB-C receptacle (power only) + 2 x 5.1k | 0.30-0.60 | 0.05-0.12 | |
| M1 | 10 mm coin vibration motor (ERM) | 0.50-1.00 | 0.15-0.30 | an LRA + driver gives crisper patterns, ~+$0.5 |
| Q1, D2, R6, R7 | AO3400, 1N4148W, resistors | 0.20 | 0.02-0.04 | |
| S1, S2, D1, D3, R1-R5, R9, C1-C4 | button, slide switch, LEDs, passives | 0.60 | 0.08-0.15 | |
| - | PCB | 1.00-2.00 | 0.08-0.15 | |
| - | case + strap | 3.00-6.00 (3D print + watch strap) | 0.40-0.90 | |
| - | assembly and test | (own labour) | 0.30-0.50 | |
| | **Total** | **~10-19** | **~2.7-4.7** | |

### 2.1 The "$3 wristband" target

At 10k units our estimate is **about $3-4.5**, so $3 is reachable only at the low end.
What gets it there:

1. A cheaper BLE SoC than the ESP32-C3 (it also fixes battery life; see
   `docs/power_budget.md`). The ESP32-C3 is our prototype choice because it is cheap,
   available and has Wi-Fi for development, not because it is the best production part.
2. A 150 mAh cell (possible only with a lower-power SoC).
3. Injection-moulded case and simple silicone strap at higher volume (100k+).
4. Optional parts dropped (power switch replaced by a long-press soft-off).

The free phone app is the zero-cost option for people who already have a phone; the
wristband is for those who do not, or who want their hands and ears free.

---

## 3. Infrastructure beacon (bus stop, crossing, school zone)

Not drawn as a schematic: the same ESP32-C3 or a commercial BLE beacon, powered from
the shelter's mains/solar supply, or from a primary lithium cell when advertising at
200-500 ms and 0 dBm. Estimated $3-10 per stop at volume including enclosure;
installation labour dominates. Commercial "iBeacon-style" battery beacons that allow
custom manufacturer data could be used if their firmware can compute the HearMe MAC
and rolling ID (many cannot; check).
