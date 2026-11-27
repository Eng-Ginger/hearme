// Simulated radio, GPS and acoustic parameters for the HearMe Lab.
// Same numbers and sources as sim/params.py (the Monte Carlo); keep the two in sync.

export const RADIO = {
  /** HearMe SPEC: 100 ms advertising interval. BLE Core Spec v5.3 Vol 6 Part B 4.4.2.2 adds a
   *  pseudo-random advDelay of 0-10 ms to every advertising event. */
  advIntervalS: 0.1,
  advDelayMaxS: 0.01,
  /** RSSI at 1 m. Apple's Proximity Beacon Specification uses about -59 dBm for a ~0 dBm beacon;
   *  HearMe SPEC requires vehicle beacons at +10 dBm (ESP32-C3 datasheet: up to +21 dBm) -> about -50 dBm. */
  txPower1mDbm: -50,
  /** Log-distance exponent. Rappaport, "Wireless Communications" 2nd ed., Table 4.2: free space 2,
   *  urban 2.7-3.5, line-of-sight in buildings 1.6-1.8. Short line-of-sight street link: 2.2. */
  pathLossN: 2.2,
  /** Log-normal shadowing sigma. Rappaport sec. 4.9.2 reports 4-12 dB; ASSUMPTION 4 dB for short LOS links. */
  shadowingSigmaDb: 4,
  /** ASSUMPTION: correlation time of the slow fading for a moving vehicle. */
  shadowingTauS: 0.8,
  /** ASSUMPTION: residual per-packet multipath fading. */
  fastFadingSigmaDb: 2,
  /** ESP32-C3 datasheet: -98 dBm at 1 Mbps; phones a few dB worse. ASSUMPTION -95 dBm. */
  sensitivityDbm: -95,
  /** ASSUMPTION: collisions + scan-window gaps. */
  packetLoss: 0.1,
  /** Body shadowing at 2.4 GHz: published on-body measurements range ~5 to >20 dB depending on posture.
   *  ASSUMPTION: 10 dB worst-angle for a phone in a front pocket, 4 dB for a wrist band, 2 dB in hand. */
  bodyLossDb: { pocket: 10, wrist: 4, hand: 2 } as Record<CarryMode, number>,
};
export type CarryMode = "pocket" | "wrist" | "hand";

export const GPS = {
  /** GPS.gov "GPS Accuracy": smartphones typically within a 4.9 m radius under open sky. Modelled as a
   *  first-order Gauss-Markov error, 4 m horizontal RMS (2.83 m per axis). */
  sigmaPerAxisM: 2.83,
  /** ASSUMPTION: error correlation time. */
  tauS: 10,
  /** NMEA GPS modules (TinyGPSPlus) default to 1 Hz; the beacon dead-reckons between fixes. */
  fixRateHz: 1,
  /** ASSUMPTION: Doppler speed / course errors of a consumer GNSS module. */
  speedSigmaMps: 0.2,
  headingSigmaDeg: 5,
};

/** Acoustic model used for the "audible" lead-time comparison (same as sim/params.py AUDIO). */
export const AUDIO_MODEL = {
  /** ASSUMPTION: e-bike tyre + drivetrain at 25 km/h, measured at 2 m. Two-wheelers have no AVAS
   *  requirement: UN Regulation No. 138 covers M and N category vehicles. */
  ebikeDba2m: 48,
  /** ASSUMPTION: a bike AVAS speaker at 56 dB(A) at 2 m (UN R138 asks ~50-56 dB(A) for cars at 10-20 km/h). */
  avasDba2m: 56,
  /** ASSUMPTION: typical levels at 2 m for combustion vehicles in town. */
  motorcycleDba2m: 80,
  carDba2m: 66,
  busDba2m: 76,
  tuktukElectricDba2m: 50,
  /** ASSUMPTION: urban background level (55-70 dB(A)); per scenario below. */
  detectSnrDb: -3,
  detectDwellS: 0.5,
};
