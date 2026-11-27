"""Extra parameters for the Monte Carlo study (sim/montecarlo.py).

Physical, radio, GPS, audio and pedestrian parameters live in sim/params.py and are reused
unchanged. Everything here describes the *scenario* and the *behaviour model*. Every value
states its source or says ASSUMPTION.
"""

SCENE = dict(
    # Two 3.5 m lanes (params.TRAFFIC lane_width_m) -> road edge at y = +/-3.5 m.
    road_half_width_m=3.5,
    lane_y_m=(-1.75, 1.75),          # right-hand traffic (UAE): eastbound south lane, westbound north lane
    # ASSUMPTION: a blind pedestrian waits about 1 m back from the kerb edge (cane at the kerb).
    ped_wait_y_m=-4.5,
    ped_end_y_m=4.5,                 # crossing complete 1 m past the far kerb (symmetric)
    # ASSUMPTION: riders do not hold the lane centre exactly; lateral offset ~ N(0, 0.3 m).
    lateral_sd_m=0.3,
    # ASSUMPTION: a parallel street 25 m north of the crossing (task brief: "~25 m away").
    parallel_street_y_m=25.0,
)

TRAFFIC_MC = dict(
    # ASSUMPTION: 200 e-bikes / e-scooters per hour on the crossing road, both directions combined,
    # split evenly. A busy micromobility corridor; the density sweep covers 60-600 /h.
    main_rate_per_h=200.0,
    # ASSUMPTION: the parallel street carries half the main road's two-wheeler flow.
    parallel_rate_ratio=0.5,
    # ASSUMPTION: e-bike / e-scooter mix 50 / 50. Both use params.TRAFFIC ebike_speed_kmh
    # (uniform 20-30 km/h); no separate measured e-scooter speed is in params.py.
    escooter_share=0.5,
    # ASSUMPTION: on average 2 parked (speed 0) e-bikes left switched on and beaconing within
    # 6-30 m of the crossing along either kerb (Poisson). |x| >= 6 m keeps their closest approach
    # to the crossing path > 5 m, so any WARN/URGENT for them is a false alarm by definition.
    parked_mean=2.0,
    parked_x_range_m=(6.0, 30.0),
    parked_y_m=(-5.5, 5.5),
    # ASSUMPTION (worst case, stated in results.md): riders never yield or swerve. A conflict
    # is therefore *exposure* (rider within 2 m while the pedestrian is on the road), not a crash.
    riders_yield=False,
)

BEHAVIOUR = dict(
    # Truncation of params.PEDESTRIAN walk speed normal(1.0, 0.15) to [0.6, 1.4] m/s, as stated
    # in params.py.
    walk_speed_clip_mps=(0.6, 1.4),
    # ASSUMPTION: after this long at the kerb the pedestrian gives up waiting and crosses anyway
    # (counted as "forced" crossings). Prevents endless waits at high traffic density.
    max_wait_s=90.0,
    # ASSUMPTION: a stepped-back pedestrian re-applies a fresh start delay (listens again).
    restart_delay_after_retreat=True,
)

RUN = dict(
    tick_s=0.1,                      # receiver tick and pedestrian decision rate (task brief: 10 Hz)
    warmup_s=15.0,                   # receiver runs this long before the pedestrian reaches the kerb
    t_start_s=100.0,                 # sim clock start; keeps all attempts inside one 600 s rolling-ID epoch
    radio_range_m=150.0,             # packets are only generated within this range (well below sensitivity)
    audio_range_m=120.0,             # audibility evaluated only within this range (inaudible beyond)
    conflict_radius_m=2.0,           # task brief: vehicle within 2 m while pedestrian on the road
    false_alarm_cpa_m=5.0,           # task brief: closest approach to the crossing path > 5 m
    lead_ok_s=3.0,                   # task brief: share of attempts with >= 3 s warning
    fast_pass_radius_m=5.0,          # dashboard: fast pass within 5 m of a receiver
    # The smartphone's own position (receiver pose) also has GPS error. ASSUMPTION: same
    # Gauss-Markov model as the vehicle (params.GPS) and *independent* of it (pessimistic: nearby
    # receivers share much of their error in reality, which would cancel in the relative offset).
    phone_gps_error=True,
)

SEED = 20270101                      # base seed; every attempt derives its own SeedSequence from it
