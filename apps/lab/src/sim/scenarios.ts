// Street layout and scenarios. Road runs east-west along x; north = -z.
// Lanes (right-hand traffic): eastbound near lane z = +1.75, westbound far lane z = -1.75.

export type VType = "e_bike" | "e_scooter" | "motorcycle" | "car" | "bus" | "tuk_tuk";
export const SILENT: ReadonlySet<VType> = new Set(["e_bike", "e_scooter", "tuk_tuk"]);

export const ROAD_HALF = 3.5;
export const KERB_Z = 4.6;          // pedestrian stands here (south kerb)
export const CROSSING_X = 0;
export const STOP_X = 26;           // bus stop shelter on the south kerb

export interface VehicleSpec {
  key: string;            // stable name (director / stats)
  type: VType;
  beacon: boolean;
  dir: 1 | -1;            // +1 eastbound (from the pedestrian's left), -1 westbound (from the right)
  speed: number;          // cruise m/s
  spawn: number;          // seconds into the scenario
  startX?: number;        // default: +-110 m upstream
  z?: number;             // lateral position, default lane centre
  stopAtX?: number;       // decelerate and stop with the vehicle centre here
  dwell?: number;         // seconds stopped
  route?: string;
  color?: string;
  seedSalt?: number;
  /** beacon is the rider's phone (rider app), not a +10 dBm module */
  phoneBeacon?: boolean;
}

export interface InfraSpec { type: "bus_stop" | "crossing" | "school_zone"; x: number; z: number; name: string; shortCode: number }

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  night: boolean;
  ped: { x: number; z: number; yaw: number };
  period: number;          // vehicles repeat every period seconds (free play)
  ambientDb: number;       // background level for the audibility model
  vehicles: VehicleSpec[];
}

export const INFRA: InfraSpec[] = [
  { type: "crossing", x: 0, z: 5.6, name: "School Xing", shortCode: 7 },
  { type: "bus_stop", x: STOP_X, z: 5.8, name: "Al Jurf Stop", shortCode: 101 },
  { type: "school_zone", x: -14, z: -7, name: "Nuaimiya Sch", shortCode: 3 },
];

export const laneZ = (dir: 1 | -1) => (dir === 1 ? 1.75 : -1.75);

export const SCENARIOS: Scenario[] = [
  {
    id: "school", name: "School crossing", night: false, period: 40, ambientDb: 60,
    blurb: "Zebra crossing without signals next to a school gate. Silent e-bikes mixed with ordinary traffic.",
    ped: { x: CROSSING_X, z: KERB_Z, yaw: 0 },
    vehicles: [
      { key: "ebike1", type: "e_bike", beacon: true, dir: 1, speed: 7.2, spawn: 1, z: 2.5, color: "#e8432e" },
      { key: "moto1", type: "motorcycle", beacon: false, dir: -1, speed: 11, spawn: 6 },
      { key: "scoot1", type: "e_scooter", beacon: true, dir: -1, speed: 6.4, spawn: 13, z: -2.4 },
      { key: "car1", type: "car", beacon: false, dir: 1, speed: 10, spawn: 19, color: "#d9d4c7" },
      { key: "ebike2", type: "e_bike", beacon: true, dir: -1, speed: 7.8, spawn: 26, z: -2.5, color: "#2e7de8" },
      { key: "ebike3", type: "e_bike", beacon: true, dir: 1, speed: 6.6, spawn: 33, z: 2.4, color: "#f2b632" },
    ],
  },
  {
    id: "busstop", name: "Bus stop", night: false, period: 45, ambientDb: 62,
    blurb: "Waiting at the Al Jurf stop. Bus 12 pulls in; an e-scooter slips past in the far lane.",
    ped: { x: STOP_X, z: KERB_Z, yaw: 0 },
    vehicles: [
      { key: "bus12", type: "bus", beacon: true, dir: 1, speed: 9, spawn: 1, startX: -90, stopAtX: STOP_X - 1, dwell: 10, route: "12" },
      { key: "scoot1", type: "e_scooter", beacon: true, dir: -1, speed: 6.5, spawn: 8, z: -2.4 },
      { key: "ebike1", type: "e_bike", beacon: true, dir: 1, speed: 7, spawn: 27, z: 2.5, color: "#e8432e" },
      { key: "car1", type: "car", beacon: false, dir: -1, speed: 10, spawn: 33, color: "#4a6fa5" },
    ],
  },
  {
    id: "night", name: "Busy street at night", night: true, period: 36, ambientDb: 66,
    blurb: "Evening traffic: delivery e-bikes, an electric tuk-tuk, cars and a petrol motorbike.",
    ped: { x: CROSSING_X, z: KERB_Z, yaw: 0 },
    vehicles: [
      { key: "ebike1", type: "e_bike", beacon: true, dir: 1, speed: 7.5, spawn: 1, z: 2.5, color: "#e8432e" },
      { key: "car1", type: "car", beacon: false, dir: -1, speed: 11, spawn: 3, color: "#2b2b2b" },
      { key: "tuk1", type: "tuk_tuk", beacon: true, dir: 1, speed: 6, spawn: 8, color: "#2fa84f" },
      { key: "moto1", type: "motorcycle", beacon: false, dir: 1, speed: 12, spawn: 14 },
      { key: "ebike2", type: "e_bike", beacon: true, dir: -1, speed: 8, spawn: 16, z: -2.5, color: "#f2b632" },
      { key: "car2", type: "car", beacon: false, dir: 1, speed: 10, spawn: 21, color: "#b8b8b8" },
      { key: "scoot1", type: "e_scooter", beacon: true, dir: 1, speed: 6.2, spawn: 26, z: 2.5 },
      { key: "ebike3", type: "e_bike", beacon: true, dir: -1, speed: 7.2, spawn: 30, z: -2.5, color: "#2e7de8" },
    ],
  },
  {
    id: "twobikes", name: "Two bikes from both sides", night: false, period: 22, ambientDb: 60,
    blurb: "An e-bike from the left and an e-scooter from the right reach the crossing almost together.",
    ped: { x: CROSSING_X, z: KERB_Z, yaw: 0 },
    vehicles: [
      { key: "ebikeL", type: "e_bike", beacon: true, dir: 1, speed: 7.4, spawn: 1, startX: -95, z: 2.5, color: "#e8432e" },
      { key: "scootR", type: "e_scooter", beacon: true, dir: -1, speed: 6.6, spawn: 1.6, startX: 85, z: -2.4 },
    ],
  },
  {
    id: "delivery", name: "Delivery rider with phone beacon", night: false, period: 30, ambientDb: 62,
    blurb: "Delivery riders whose rider app turns their phone into a HearMe beacon: no extra hardware, about 9 dB weaker than a beacon module.",
    ped: { x: CROSSING_X, z: KERB_Z, yaw: 0 },
    vehicles: [
      { key: "rider1", type: "e_bike", beacon: true, phoneBeacon: true, dir: 1, speed: 7.0, spawn: 1, z: 2.5, color: "#ff5a1f" },
      { key: "moto1", type: "motorcycle", beacon: false, dir: -1, speed: 11, spawn: 8 },
      { key: "rider2", type: "e_bike", beacon: true, phoneBeacon: true, dir: -1, speed: 7.6, spawn: 13, z: -2.5, color: "#00a86b" },
      { key: "rider3", type: "e_scooter", beacon: true, phoneBeacon: true, dir: 1, speed: 6.2, spawn: 21, z: 2.4 },
    ],
  },
];

/** Empty street used by director mode (it spawns vehicles itself). */
export const DIRECTOR_SCENARIO: Scenario = {
  ...SCENARIOS[0], id: "director", name: "Director", period: 1e9, vehicles: [],
};
