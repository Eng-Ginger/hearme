# HearMe adoption path

HearMe only protects pedestrians from vehicles that carry a beacon, so adoption is the whole game.
The cheapest path starts with phones that riders already carry, then adds hardware where phones are
not available, and ends with a rule that makes beacons standard equipment.

Costs below are **estimates** (see `docs/bom.md`); nothing here has been agreed with any partner.

## 1. Rider phones first (zero hardware)

Delivery platforms and shared e-bike / e-scooter operators already require riders to run their app,
with location on, for every trip. Adding HearMe to that app turns each rider's phone into a beacon.

| | |
|---|---|
| **What they need** | A small SDK (`apps/android-rider-sdk`: `HearMeBeacon(context, type, fleetKey).start()` and `update(location)` per GPS fix), one fleet key per operator, a foreground-service notification, a privacy notice for riders |
| **What they get** | A visible road-safety and accessibility commitment, data-free compliance with future rules, no hardware cost |
| **Cost driver** | Developer time to integrate (days); battery: BLE advertising adds little next to GPS and screen (estimate, to be measured) |
| **Limits** | Android only: iOS apps cannot put manufacturer data into BLE advertisements, so iPhone riders cannot be v1 beacons. Phones transmit about 9 dB weaker than a +10 dBm module (Lab scenario "Delivery rider with phone beacon"). Vendor BLE stacks differ |
| **Risks** | Riders switching the app off between orders; operators fearing tracking claims (mitigated: rolling IDs, no uploads from the beacon) |
| **Milestone** | One operator ships the SDK to riders in one district; a two-phone field test confirms detection range and lead time |

Policy option: the platform makes "HearMe on while riding" part of its rider terms, like helmet rules.

## 2. Fleets (retrofit beacons)

Tuk-tuk cooperatives, bus operators and shared-bike fleets fit a stand-alone beacon where there is no
phone in the loop.

| | |
|---|---|
| **Needs** | Retrofit beacon (~$2.5–5 without GPS, ~$4–8 with GPS at 10k units, estimate), installation at depots, key management, health checks (`docs/maintenance.md`) |
| **Gets** | Fewer conflicts at stops and crossings; buses announce route and door to blind passengers |
| **Cost driver** | Installation labour more than parts |
| **Milestone** | One bus line + one tuk-tuk cooperative fully equipped; stop beacons on that line |

## 3. Makers (built-in firmware)

E-bike, e-scooter and moped makers already ship a Bluetooth chip in the display or controller.
HearMe is then a firmware feature: about $0–1 per vehicle (estimate) and no installation.

| | |
|---|---|
| **Needs** | Reference firmware (`firmware/`), an assigned Bluetooth SIG company ID or 16-bit UUID, test vectors (`protocol/test_vectors.json`), a certification checklist |
| **Gets** | A selling point for cities and fleets; readiness for regulation |
| **Milestone** | One maker ships HearMe on by default in a model sold in the region |

## 4. Cities and procurement

| | |
|---|---|
| **Needs** | Tender clauses ("vehicles must broadcast HearMe v1.1"), beacons at stops, crossings and school or campus gates, the anonymous dashboard (`apps/dashboard`) |
| **Gets** | Hotspot maps for crossings and speed measures without cameras or personal data |
| **Milestone** | One city corridor in shared-mobility permits and bus contracts |

## 5. Regulation and standards

| | |
|---|---|
| **Needs** | An AVAS-like requirement for quiet L-category vehicles (two- and three-wheelers), a published profile mapped to existing V2X messages (`docs/standards.md`), an assigned identifier |
| **Gets** | Universal coverage, which is the only way the warning becomes something a blind person can rely on |
| **Milestone** | A national or regional rule, or a standards-body work item |

## Timeline (indicative)

| Phase | Months | Main actor | Coverage goal |
|---|---|---|---|
| 0. Prototype + field test | 0–3 | HearMe team, blind association | 2 phones, test site |
| 1. Rider-phone pilot | 3–9 | 1 delivery or sharing operator | hundreds of riders, 1 district |
| 2. Fleets + stop beacons | 6–18 | bus operator, tuk-tuk cooperative | 1 bus line, 1 cooperative |
| 3. Built-in firmware | 12–30 | 1–2 makers | new vehicles in 1 market |
| 4. Rule / standard | 24+ | regulator, standards body | all new quiet vehicles |

**Blind users at every stage:** associations of blind and low-vision people co-design alert wording and
vibration patterns before the first pilot, review each phase, and set the success criteria (for
example, "warned at least 3 s before a pass in 90 % of passes"). Testing with blind participants needs
ethics approval (`docs/limitations.md`, section 4).
