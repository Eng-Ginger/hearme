# HearMe schematics (prototype)

Drawn with Python `schemdraw` (0.23). Regenerate with:

```
python docs/schematics/vehicle_beacon.py
python docs/schematics/wristband.py
```

| File | What it shows |
|---|---|
| `vehicle_beacon.png` / `.svg` | Vehicle beacon: 12 V or 36/48 V vehicle battery -> fuse -> reverse-polarity Schottky -> TVS -> 100 V-class buck to 5 V -> ESP32-C3 module (on-board 3.3 V LDO); GPS module on UART; ignition/motion sense input; status LED |
| `wristband.png` / `.svg` | Wristband: USB-C (power only) -> TP4056 charger -> 150-200 mAh LiPo (protected cell) -> slide switch -> 3.3 V LDO -> ESP32-C3 module; coin vibration motor on an AO3400 N-MOSFET with gate resistor, gate pull-down and flyback diode; push button; status LED |

These are prototype-level schematics for a hackathon: correct in topology and pin
assignment, but part values are typical-practice choices that have **not** been
through a design review, EMC test or vehicle transient (ISO 7637-2 style) test.
Dev boards (ESP32-C3 SuperMini, ESP32-C3-DevKitM-1) already contain the 3.3 V
LDO, EN RC network and an LED; those parts are drawn for a future custom PCB.

## GPIO map (must match firmware)

| Device | Signal | ESP32-C3 GPIO | Direction / level |
|---|---|---|---|
| Wristband | Vibration motor PWM (Q1 gate via R6) | **GPIO 5** | output, PWM, high = motor on |
| Wristband | Status LED (D3 to +3V3 via R9) | **GPIO 8** | output, **active LOW** |
| Wristband | Push button S1 to GND | **GPIO 9** | input, internal pull-up, **active LOW** |
| Wristband | Buzzer (Wokwi simulation stand-in only, not fitted) | **GPIO 6** | output |
| Beacon | GPS UART RX (from GPS TXD) | **GPIO 20** | input, 9600 baud NMEA |
| Beacon | GPS UART TX (to GPS RXD, optional config) | **GPIO 21** | output |
| Beacon | Status LED | **GPIO 8** | output, **active LOW** |
| Beacon | Ignition / motion sense | **GPIO 3** | input, **active HIGH** (IGN 9-60 V -> about 3.3 V via R2/R3 + zener D4) |

Notes on the pins:

- GPIO 8 and GPIO 9 are ESP32-C3 strapping pins. GPIO 8 must not be pulled low at
  reset (the LED is wired to +3V3, so it idles high); holding the button on GPIO 9
  during reset enters the ROM serial download mode. This matches the SuperMini and
  DevKitM-1 boards, whose BOOT button and LED use the same pins (check your board).
- GPIO 20/21 are UART0's default pins on the ESP32-C3. The firmware
  (`firmware/platformio.ini`, env `vehicle_beacon`) maps the GPS to **UART1** on these
  pins and sends the console to the native USB-Serial/JTAG port, so there is no conflict.
- **GPIO 8 LED type:** the ESP32-C3-DevKitM-1 has a WS2812 RGB LED on GPIO 8 (firmware
  build flag `HEARME_LED_RGB=1`); the SuperMini and the Wokwi diagram use a plain LED
  (`HEARME_LED_RGB=0`). The schematics show the plain-LED, active-LOW variant.
- **Ignition sense (GPIO 3) is active HIGH**, matching the firmware. The firmware
  currently enables the internal pull-up so that an unwired input reads "on". With
  the R2/R3/D4 sense circuit fitted, the internal pull-up (roughly 45 k, approximate)
  fights R3 (100 k pull-down) and "ignition off" can read as an undefined level
  (about 2.3 V). Either configure GPIO 3 **without** the internal pull-up when the
  circuit is fitted, or (bench only) leave R3/D4/C3 off and keep the pull-up.
- GPIO 3 is also one of the few ESP32-C3 pins (GPIO 0-5) that can wake the chip from
  deep sleep, which the parked-vehicle sleep mode needs (`docs/power_budget.md`).

Optional, not in the current firmware: a battery-voltage divider (e.g. 2 x 100k
from VBAT to an ADC pin such as GPIO 4) to report wristband battery level.
