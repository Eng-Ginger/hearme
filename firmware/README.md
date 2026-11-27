# HearMe firmware (ESP32-C3)

Two devices, one PlatformIO project:

| env | what | source |
|---|---|---|
| `vehicle_beacon` | GNSS + BLE beacon on the vehicle (e-bike, scooter, tuk-tuk, bus...) | `src/vehicle_beacon/main.cpp` |
| `vehicle_beacon_bus` | same, configured as bus route 12, front door | (build flags only) |
| `wristband` | pedestrian wristband: passive BLE scan -> receiver core -> vibration | `src/wristband/main.cpp` |
| `wristband_wokwi` | same wristband code for the Wokwi simulator: BLE replaced by serial packet injection | `src/wristband/main.cpp` with `-DHEARME_WOKWI` |
| `native` | host unit tests (Unity) | `test/test_native/test_main.c` |

Shared code (single source of truth):

* `../protocol/c/hearme_packet.h` - packet codec + HMAC, header-only (added with `-I../protocol/c` in `platformio.ini`).
* `lib/hearme_receiver/` - C99 port of `sim/receiver.py` (no malloc, static 32-track table).
  It is checked against Python (and the TypeScript port) by `tests/cross_language/run_all.py`.

## Build and flash

```sh
pip install platformio
cd firmware
pio run -e vehicle_beacon -t upload          # then: pio device monitor
pio run -e wristband -t upload
pio run -e wristband_wokwi                   # for Wokwi, no upload
```

The `espressif32@^6.9` platform ships Arduino-ESP32 core 2.0.x, so the code uses the 2.x LEDC API
(`ledcSetup`/`ledcAttachPin`) and NimBLE-Arduino 1.4.x.

### Vehicle beacon

* GNSS (any NMEA module, TinyGPSPlus) on UART1: module TX -> GPIO20, module RX <- GPIO21, 9600 baud.
* Every 100 ms a HearMe packet is built with `hearme_packet.h` and set as the raw advertising
  data (single manufacturer AD structure, company 0xFFFF, no flags so a 27-byte bus packet still
  fits the 31-byte legacy limit). Non-connectable, 100-110 ms interval, +9 dBm (`HEARME_TX_POWER`).
* Position is dead-reckoned between the 1 Hz fixes with GNSS speed and course (capped at 2 s).
  Course is sent as unknown below 1 m/s.
* Rolling ID = first 4 bytes of HMAC(device secret, "HMid" || epoch), regenerated each 10-min epoch.
  Device secret: `-DHEARME_DEVICE_SECRET=\"...\"` or, by default, derived from the eFuse MAC.
  The epoch comes from GNSS UTC; until the module has time, a millis()-based epoch is used and
  receivers that require a MAC will drop the packets (default receivers still warn).
* BLE address: the beacon advertises from a **static random address** derived from the same
  device secret, HMAC(secret, "HMad" || epoch)[0:6] with the two top bits set to 11. It is set
  with NimBLE's `ble_hs_id_set_rnd()` (own address type `BLE_OWN_ADDR_RANDOM`) and changes in the
  same step as the rolling ID (advertising is stopped for the swap), so the address and the
  rolling ID can't be used to link one epoch to the next. The chip's public MAC is never
  advertised. Limitation: in the first epoch after boot without GNSS time, the epoch is derived
  from millis(), so the address and ID repeat from one power cycle to the next until GNSS time arrives.
* Ignition sense on GPIO3, active high. The beacon schematic (`docs/schematics/vehicle_beacon.py`)
  feeds the ignition line through a 100 k series resistor with a 100 k pull-down and a 3.3 V zener,
  so the firmware configures GPIO3 as a plain `INPUT` (default `HEARME_IGN_PULLUP=0`). For bench
  use with GPIO3 unwired, build with `-DHEARME_IGN_PULLUP=1`: the internal pull-up then makes the
  floating pin read "ignition on". Without the circuit and without that flag the pin floats and
  the beacon may go to sleep at random. `-DHEARME_IGNITION_SENSE=0` ignores the pin entirely.
* Parked -> advertising off, light sleep 5 s, wake, listen to GNSS for 1.5 s, repeat. Parked means
  ignition low on GPIO3 or no motion (< 0.5 m/s) for 120 s. A rising ignition wakes it immediately.
* Status LED GPIO8: 1 Hz blink, green = GNSS fix, amber = no fix.
* Build flags: `HEARME_VEHICLE_TYPE` (`HM_E_BIKE`, `HM_E_SCOOTER`, `HM_TUK_TUK`, `HM_CAR`, `HM_BUS`,
  `HM_MOTORCYCLE`), `HEARME_FLEET_KEY_HEX`, `HEARME_BUS_ROUTE`, `HEARME_BUS_DOOR`,
  `HEARME_IGNITION_SENSE`, `HEARME_LED_RGB`. The fleet key in `platformio.ini` is the public
  **test** key from `protocol/`; use a real secret key for any deployment.

Board notes (ESP32-C3-DevKitM-1): GPIO20/21 are UART0's default pins and are wired to the
on-board USB-UART bridge. The beacon therefore logs over the native USB port (GPIO18/19,
`ARDUINO_USB_CDC_ON_BOOT=1`); on the DevKitM-1 the GNSS module on GPIO20/21 shares those lines
with the bridge, so a board without a bridge on 20/21 (e.g. a C3 "super mini") is a better fit
for the vehicle unit. GPIO8 on the DevKitM-1 is a WS2812 RGB LED (`HEARME_LED_RGB=1` uses
`neopixelWrite`); set it to 0 for a plain LED. USB-serial drops while the beacon is in light sleep.

### Wristband

* Passive NimBLE scan (100 % duty cycle, duplicates on), keeps manufacturer data with company ID
  0xFFFF, queues it to `loop()`, which feeds `hm_rx_process_payload()`; `hm_rx_tick()` at 10 Hz.
* Haptics: PWM on GPIO5 (motor through a transistor/driver, 5 kHz, 8 bit):
  * slow double pulse: aware (vehicle nearby)
  * fast pulses: warn; faster and stronger for urgent, repeated every 1.5 s while a track stays urgent
  * long buzz (0.9 s): bus arriving
  * single short tick: place (bus stop, crossing, school zone)
  A cue never interrupts a more urgent one.
* Button GPIO9 (the BOOT button): short press = acknowledge (stop the cue, no urgent repeats for 10 s);
  long press (> 1 s) = mute/unmute aware, bus and place cues. Warn and urgent are never muted.
* LED GPIO8: red urgent, orange warn, green aware, blue heartbeat when idle.
* Every event is printed on Serial (115200) as one JSON line, same format as `tools/run_trace.c`.
* Serial commands (all builds): `POSE <lat> <lon> <heading_deg>` (pedestrian pose, e.g. from the
  phone; without a pose the receiver runs RSSI-only), `TIME <unix>` (clock for MAC epochs).

## Native tests

With PlatformIO (needs a host gcc/clang on PATH):

```sh
pio test -e native
```

Without PlatformIO, using the tiny Unity-compatible shim in `tools/unity_shim/` (kept outside
`test/` so it never shadows the real Unity) and zig's clang:

```sh
cd firmware
python -m ziglang cc -std=c99 -O2 -ffp-contract=off -Itools/unity_shim -I../protocol/c \
    -I../protocol/c/test -Ilib/hearme_receiver test/test_native/test_main.c \
    lib/hearme_receiver/hearme_receiver.c -o ../build/test_native.exe
../build/test_native.exe
```

Covered: codec on the shared vectors, garbage rejection, aware -> warn -> urgent escalation (with
exact English and Arabic texts), hysteresis hold before a downgrade, hysteresis band, stale downgrade
and forget, parked vehicle ignored, spoofed packets rejected with `require_mac`, unverified
packets still warning without it, bus arrival and place announcements.

Cross-language check (Python reference vs C, and TypeScript when present), from the repo root:

```sh
python tests/cross_language/run_all.py
```

## Wokwi

**Wokwi does not simulate BLE.** The `wristband_wokwi` build therefore has no radio: the same
receiver and haptics code is fed by lines on the serial port instead. Everything after the radio
(decode, MAC check, tracking, levels, texts, vibration patterns) is the real firmware code.

`diagram.json`: ESP32-C3-DevKitM-1, orange LED + 220 ohm on GPIO5 as the motor stand-in (brightness =
PWM duty), buzzer on GPIO6 (`tone()`, pitch rises with urgency), status LED on GPIO8, pushbutton on
GPIO9, serial monitor on UART0.

1. `pio run -e wristband_wokwi`
2. VS Code: install the Wokwi extension, open the `firmware/` folder, run "Wokwi: Start Simulator"
   (uses `wokwi.toml`). CLI: `wokwi-cli firmware` (needs `WOKWI_CLI_TOKEN`).
3. Feed packets, either
   * paste lines from `wokwi/inject_example.txt` into the serial monitor, or
   * stream a whole trace in real time through the RFC2217 port that `wokwi.toml` opens
     (VS Code extension; needs `pip install pyserial`):
     `python tools/trace_to_wokwi.py ../tests/traces/ebike_left_gps.json --send rfc2217://localhost:4000`
     The same command with `--send COM5` drives a real board flashed with `wristband_wokwi`.

### Serial injection format

```
TIME <unix seconds>            set the clock (t of following packets)
POSE <lat> <lon> <heading>     pedestrian position and facing (degrees, 0 = north)
PKT <rssi dBm> <hex>           one advertisement: manufacturer data after the company ID
# comment
```

A `PKT` is processed at `t = base + millis()/1000`, where `TIME` sets `base` so that "now" equals
the given unix time. `tools/trace_to_wokwi.py` writes a `TIME` before every `PKT`, so the
receiver sees the trace timestamps even when the lines arrive in one burst; trace ticks are left
out because the firmware ticks itself at 10 Hz. `wokwi/inject_example.txt` is
`tests/traces/ebike_left_gps.json` converted this way; its expected events are listed at the end
as comments (aware at t+6.66 s, warn "Electric bike, fast, from your left, 3 seconds",
urgent "Stop! ..."). In Python, dropping the ticks from this trace gives the same events.

## Build status in this environment

* `pio run` with PlatformIO Core 6.2.0, platform espressif32 6.x (Arduino-ESP32 2.0.17,
  toolchain riscv32-esp 8.4.0), NimBLE-Arduino 1.4.3, TinyGPSPlus: **compiled** `wristband`,
  `wristband_wokwi`, `vehicle_beacon` and `vehicle_beacon_bus` with no warnings from project
  sources. Nothing was flashed or run on hardware, and the Wokwi simulation was not run here.
  So BLE advertising and scanning, haptics, light sleep and address rotation are compiled but
  untested on a device.
* `pio test -e native` was not run (no host gcc on that machine). The same test file passed
  10/10 when built with `python -m ziglang cc` and the shim.
* `tests/cross_language/run_all.py`: C == Python on all 7 traces and on 28 config variants. The
  TypeScript port also matched on all 7 traces.
