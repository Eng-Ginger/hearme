# Limitations, open questions and what a pilot would need

HearMe at this stage is a **protocol, reference code, firmware and a simulation**. It
has not been tested with real vehicles on real streets, nor with blind users. This
page says plainly what the work shows and what it does not.

## 1. What the simulation and code can show

- **The packet format works and is unambiguous.** Python, C and TypeScript codecs
  produce byte-identical packets for every test vector, and reject the same malformed
  ones (`protocol/test_vectors.json`).
- **The receiver logic is deterministic and portable.** The Python, TypeScript and C
  receiver cores emit the same alert events on shared traces (`tests/traces`):
  left/right passes, RSSI-only approach, lossy pocket reception, parked and parallel
  vehicles (no alert), two bikes on both sides, bus arrival, and a spoofed packet
  rejected when `require_mac` is on.
- **The approach is plausible under stated assumptions.** The radio model
  (`sim/params.py`) uses a log-distance path loss with exponent 2.2, 4 dB log-normal
  shadowing, 2 dB fast fading, body loss (10 dB pocket, 4 dB wrist), -95 dBm
  sensitivity and 10 % random packet loss; GPS error is a 4 m RMS Gauss-Markov
  process. Each value cites a source or is marked as an assumption. Under these
  assumptions the simulation estimates warning lead times and miss rates (results are
  reported separately in `docs/results/`).
- **Sensitivity analysis**: because parameters are explicit, we can show which ones
  matter (for example path-loss exponent and body loss), which tells a pilot what to
  measure first.

## 2. What it cannot show

- **Real RSSI behaviour.** Urban multipath, parked cars, buses blocking line of sight,
  rain, the rider's body, and different antennas change RSSI by many dB. The
  log-distance model with log-normal shadowing is a standard first-order model, not a
  prediction for a specific street. RSSI-only distance and approach-rate estimates may
  be much worse in reality.
- **Device variability.** Phones differ in antenna, receiver sensitivity, RSSI
  calibration and scan behaviour. The -50 dBm at 1 m calibration is an assumption
  derived from typical beacon practice, not a measurement of our hardware.
- **Phone operating-system limits.** Background BLE scanning is restricted on both
  Android (throttling, Doze, foreground-service requirements) and iOS (background
  scans generally only for service UUIDs; v1 has none). The real reception rate on a
  phone in a pocket with the screen off is unknown; see `docs/power_budget.md`.
- **Channel congestion.** At a busy junction with dozens of beacons plus other BLE
  traffic, collision losses rise (roughly 30 % at 50 beacons by a simple estimate,
  `protocol/SPEC.md` section 2.1). Not measured.
- **GPS in urban canyons.** The 4 m RMS figure is an open-sky value. Between tall
  buildings errors of tens of metres and wrong headings are common; position-mode
  side and time-to-reach could be wrong exactly where traffic is densest. The
  pedestrian's own heading (phone compass or wrist orientation) is also noisy and was
  modelled simply.
- **Rider adoption.** The system protects pedestrians only from vehicles that carry a
  beacon. Coverage depends on manufacturers, fleets and regulation (see the adoption
  path in `protocol/SPEC.md` section 12). A partial rollout may create false
  confidence: "no warning" does not mean "no vehicle".
- **Alarm fatigue.** Thresholds (35 m aware, 6 s warn, 3 s urgent, 8 m pass radius) are
  engineering guesses tuned on synthetic traces. Too many warnings on a busy street
  and users will switch the device off; too few and it fails its purpose.
- **Human factors and accessibility.** Whether blind and low-vision users understand
  vibration patterns quickly enough, whether speech is audible in traffic without
  masking the environmental sounds they rely on, whether left/right is conveyed
  correctly when the wrist or phone is turned: none of this has been tested. Nothing
  here replaces orientation-and-mobility training, a cane or a guide dog.
- **Security in practice.** The MAC is a deterrent, not strong security (threat model,
  `protocol/SPEC.md` section 9). Real attacker behaviour is unknown.
- **Hardware.** Schematics are prototype-level and unreviewed; power figures are
  datasheet-style approximations; costs are estimates (`docs/bom.md`).

## 3. Real-world unknowns to measure first

1. RSSI versus distance and angle for each receiver placement (wrist, trouser pocket,
   bag, hand) and each vehicle mounting position, on at least two street types.
2. Packet reception rate versus distance with realistic beacon density.
3. Detection distance and warning lead time for e-bikes at 15-30 km/h, crossing and
   passing.
4. Phone background reception rates on a range of Android phones and on iPhone.
5. GPS position and heading error on vehicles in the pilot corridor.
6. Battery life of wristband and phone in real use.

## 4. What a physical pilot would need

**Approvals and partners**

- **Ethics approval** from a university research ethics committee (or equivalent)
  before involving participants; informed consent in accessible formats (audio,
  braille, large print) and the right to withdraw at any time.
- **Co-design with blind and low-vision associations** from the start: choosing alert
  wording and vibration patterns, deciding what "too many alerts" means, recruiting
  participants, and reviewing results. Include orientation-and-mobility instructors.
- City / road authority permission for the test corridor; a fleet operator or rider
  group to equip vehicles; insurance.

**Design (proposal)**

- **Stage 1, closed course:** no real traffic. Equipped e-bikes ridden by the team at
  controlled speeds and paths; sighted spotters; participants stand at a marked kerb
  and report when they detect a vehicle (with and without HearMe). Measures radio and
  timing without risk.
- **Stage 2, supervised real street:** one corridor, **10-50 equipped vehicles**, a
  few bus-stop and crossing beacons, participants accompanied by a sighted guide;
  no decision to cross is ever based only on HearMe.
- **Participants:** on the order of 10-20 blind or low-vision adults for a first
  usability study (a typical size for formative accessibility studies), plus older
  pedestrians if possible.

**Measurements**

- Radio: RSSI, packet rate, detection range, by placement and vehicle.
- Timing: warning lead time before the vehicle's closest approach; fraction of
  vehicles warned at least 3 s ahead.
- Errors: missed vehicles, false alarms per hour of walking, wrong side.
- Power: wristband and phone battery per day.
- User: perceived usefulness and trust, annoyance, workload (for example NASA-TLX),
  usability (for example the System Usability Scale), preference between vibration
  and speech, interviews.

**Success metrics (proposed targets, to be agreed with the blind associations)**

| Metric | Proposed target |
|---|---|
| Equipped vehicles approaching at <= 25 km/h that trigger a warn or urgent alert at least 3 s before closest approach | >= 95 % |
| False alarms (warn/urgent with no conflicting vehicle) | < 1 per 10 minutes of walking |
| Correct side (left/right) when position mode is available | >= 90 % |
| Wristband battery | >= 1 day of normal use |
| Participants who would keep using it | majority, with no participant reporting it made them less safe |

If the pilot misses these targets, the parameters, the hardware or the concept change;
the targets are a starting point for discussion, not a claim.

## 5. Known receiver weaknesses (found by the simulation and code review)

These are open design issues in `receiver-core` (identical in C, TypeScript and Python). They are
reported here rather than tuned away, so the simulated results reflect the receiver as built.

1. **RSSI-only time-to-reach is optimistic.** As soon as the filtered range rate shows ≥ 0.8 m/s of
   closing, the receiver divides distance by the vehicle's *advertised ground speed*. Near the
   sensitivity limit only up-faded packets survive, so distant riders look closer. Result: early,
   intermittent warnings, including for riders on a parallel street (~12 false alarms per attempt in
   the Monte Carlo). Fix to evaluate: use the filtered closing speed, require a sustained approach, and
   prefer GPS geometry whenever it is available.
2. **`pass_radius_m` = 8 m sits close to GPS error for the far lane.** A rider in the far lane passes
   about 6.25 m from a pedestrian at the kerb, so GPS noise makes the warning flicker. Continuous
   ≥ 3 s warning was present for 90.9 % of near-lane riders but only 67.4 % of far-lane riders.
3. **`warn_ttr_s` = 6 s is shorter than the time to cross two lanes** (5–12 s at 0.6–1.4 m/s). A rider
   more than 6 s away when the pedestrian steps out is not flagged. A crossing-aware threshold (road
   width / walking speed + margin) should be evaluated.
4. **`hysteresis_s` mixes units.** It is a margin in seconds for time-to-reach, in metres for
   `urgent_dist_m`, and is multiplied by 5 (metres) for `aware_dist_m`.
5. **Silent re-escalation.** `alert_repeat_s` is per level, so if a track drops and climbs back within
   4 s, the level rises without a new alert.
6. **Eviction forgets announcements.** With a very small `max_tracks`, an evicted bus or place is
   announced again (not an issue at the default of 32).
7. **Infrastructure announcements use RSSI distance only**, so a stop 20 m away is occasionally
   announced early because of shadowing (seen in the Lab). A per-beacon calibrated TX power or a
   longer averaging window would help.
8. **Bus pulling into a stop.** A bus with its braking flag set is capped at "aware" (it is expected,
   not a threat). This relies on the bus beacon reporting braking while decelerating and while stopped
   with the brake held.
