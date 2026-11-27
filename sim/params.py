"""Simulation parameters. Every default states its source, or says ASSUMPTION.

Keep in sync with apps/lab/src/config/radio.ts (same numbers, same citations).
"""

RADIO = dict(
    # Advertising interval. HearMe SPEC sets 100 ms; BLE Core Spec v5.3 Vol 6 Part B 4.4.2.2
    # adds a pseudo-random advDelay of 0-10 ms to every advertising event.
    adv_interval_s=0.100,
    adv_delay_max_s=0.010,
    # Received power at 1 m. Apple's Proximity Beacon Specification (iBeacon) uses about -59 dBm
    # as the typical "measured power" at 1 m for a ~0 dBm beacon. HearMe SPEC requires vehicle
    # beacons to transmit at +10 dBm (ESP32-C3 datasheet: up to +21 dBm), so about -50 dBm at 1 m.
    tx_power_1m_dbm=-50.0,
    # Log-distance path loss exponent. Free space = 2; Rappaport, "Wireless Communications:
    # Principles and Practice", 2nd ed., Table 4.2 lists 2.7-3.5 for urban cellular and 1.6-1.8
    # for line-of-sight in buildings. A street crossing at < 50 m is mostly line-of-sight: 2.2.
    path_loss_n=2.2,
    # Log-normal shadowing standard deviation. Rappaport (sec. 4.9.2) reports 4-12 dB in
    # measurements; 4 dB is used for short line-of-sight links. ASSUMPTION within that range.
    shadowing_sigma_db=4.0,
    shadowing_tau_s=0.8,         # ASSUMPTION: correlation time of slow fading for a moving bike
    fast_fading_sigma_db=2.0,    # ASSUMPTION: residual per-packet multipath on top of shadowing
    # Typical BLE receiver sensitivity is about -95 dBm (ESP32-C3 datasheet: -98 dBm at 1 Mbps;
    # phones are generally a few dB worse). ASSUMPTION: -95 dBm.
    sensitivity_dbm=-95.0,
    # Random packet loss from collisions and scan-window gaps. ASSUMPTION: 10 %.
    packet_loss=0.10,
    # Human body shadowing at 2.4 GHz when the body blocks the path. Published on-body
    # measurements range from roughly 5 to more than 20 dB depending on posture; ASSUMPTION:
    # 10 dB at the worst angle for a phone in a front pocket, 4 dB for a wrist-worn band.
    body_loss_pocket_db=10.0,
    body_loss_wrist_db=4.0,
)

GPS = dict(
    # GPS.gov ("GPS Accuracy"): GPS-enabled smartphones are typically accurate to within a
    # 4.9 m (16 ft) radius under open sky. Urban canyons are worse. Modelled as a first-order
    # Gauss-Markov error with 4 m horizontal RMS (2.83 m per axis) and 10 s correlation time.
    sigma_per_axis_m=2.83,
    tau_s=10.0,                  # ASSUMPTION
    fix_rate_hz=1.0,             # TinyGPSPlus/NMEA modules default to 1 Hz output
    speed_sigma_mps=0.2,         # ASSUMPTION: Doppler speed error of consumer GNSS
    heading_sigma_deg=5.0,       # ASSUMPTION, valid only when moving > 1 m/s
)

TRAFFIC = dict(
    # EU pedelec assistance cut-off is 25 km/h (EN 15194). Observed e-bike/e-scooter cruising
    # speeds in cities are commonly 20-30 km/h. ASSUMPTION: uniform 20-30 km/h.
    ebike_speed_kmh=(20.0, 30.0),
    lane_width_m=3.5,            # ASSUMPTION: typical urban lane; two lanes = 7 m road
)

PEDESTRIAN = dict(
    # MUTCD (2009) sec. 4E.06 uses 3.5 ft/s (1.07 m/s) as the walking speed for pedestrian
    # clearance; many blind and older pedestrians walk slower. ASSUMPTION: normal(1.0, 0.15) m/s,
    # truncated to [0.6, 1.4].
    walk_speed_mps=(1.0, 0.15),
    # ASSUMPTION: time between arriving at the kerb and deciding to cross when nothing is
    # detected: uniform 1-4 s (listening for traffic).
    start_delay_s=(1.0, 4.0),
    # ASSUMPTION: time from a warning to stopping or not stepping out (perception-reaction).
    reaction_s=1.5,
)

AUDIO = dict(
    # Background noise on an urban street: ASSUMPTION 55-70 dB(A) (quiet residential to busy).
    background_dba=(55.0, 70.0),
    # Tyre + drivetrain sound of an e-bike at 25 km/h measured at 2 m. ASSUMPTION: 48 dB(A).
    # (No AVAS: UN Regulation No. 138 covers M and N category vehicles, not two-wheelers.)
    ebike_tyre_dba_2m=48.0,
    # AVAS-style speaker fitted to the e-bike: UN R138 asks for at least ~50-56 dB(A) at 2 m
    # for cars at 10-20 km/h. ASSUMPTION: a bike speaker achieving 56 dB(A) at 2 m.
    avas_dba_2m=56.0,
    # ASSUMPTION: a sound is detected when it exceeds the background by this signal-to-noise
    # ratio (broadband sound in broadband noise; detection, not localisation).
    detect_snr_db=-3.0,
    # ASSUMPTION: a listener needs this long above threshold to notice and judge an approach.
    detect_dwell_s=0.5,
)
