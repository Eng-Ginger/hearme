"""HearMe vehicle beacon schematic (prototype). Run: python docs/schematics/vehicle_beacon.py

Outputs vehicle_beacon.png and vehicle_beacon.svg next to this script.
Pin map must match firmware: GPS RX GPIO20 (from GPS TXD), GPS TX GPIO21 (to GPS RXD),
status LED GPIO8, ignition/motion sense GPIO3. Nets with the same label are connected.
"""
import os

import schemdraw
import schemdraw.elements as elm

HERE = os.path.dirname(os.path.abspath(__file__))
schemdraw.config(fontsize=11)
SMALL = 9


def pin(name, side, pos):
    return elm.IcPin(name=name, side=side, pos=pos)


def netlabel(d, text, loc='top'):
    d += elm.Label().label(text, loc, fontsize=SMALL + 1, color='blue')


with schemdraw.Drawing(show=False) as d:
    d.config(unit=2.0)

    # ================================================================ POWER ROW (y = 0)
    j1 = (elm.Ic(size=(2.6, 3.0), pins=[pin('V+', 'R', 0.83), pin('IGN', 'R', 0.5), pin('GND', 'R', 0.17)])
          .theta(0).anchor('V+').at((2.8, 0))
          .label('J1 vehicle harness\n12 V or 36/48 V\nbattery', 'top', fontsize=SMALL + 1))
    d += j1
    d += elm.Line().at(j1.IGN).right(0.8)
    netlabel(d, 'IGN', 'right')
    d += elm.Line().at(j1.GND).right(0.6)
    d += elm.Ground(lead=False)

    d += elm.Line().at(j1['V+']).right(0.4)
    d += elm.Fuse().right(2.0).label('F1 0.5-1 A\n(PTC or blade)', 'top', fontsize=SMALL)
    d += elm.Schottky().right(2.0).label('D1 reverse-\npolarity, SS110\n(100 V 1 A)', 'top', fontsize=SMALL)
    d += elm.Line().right(1.0)
    nA = d.here
    d += elm.Dot()
    d += elm.DiodeTVS().at(nA).down(2.0).reverse().label('D2 TVS\nSMBJ24CA (12 V)\nSMBJ58CA (48 V)', 'top', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(nA).right(2.0)
    nB = d.here
    d += elm.Dot()
    d += elm.Capacitor(polar=True).at(nB).down(2.0).label('C1 47uF\n100 V', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)

    u1 = (elm.Ic(size=(3.4, 2.4), pins=[pin('VIN', 'L', 0.75), pin('EN', 'L', 0.25), pin('VOUT', 'R', 0.75),
                                        pin('GND', 'B', 0.5)])
          .theta(0).anchor('VIN').at((nB[0] + 2.0, 0))
          .label('U1 buck to 5 V, 0.5 A\nVin rated above TVS clamp\n(LM5164-class 100 V IC;\nXL7015 80 V module: 12 V or bench only)',
                 'top', fontsize=SMALL))
    d += u1
    d += elm.Line().at(nB).to(u1.VIN)
    d += elm.Line().at(u1.EN).left(0.8)
    d += elm.Line().up(u1.VIN[1] - u1.EN[1])
    d += elm.Dot()
    d += elm.Ground().at(u1.GND)
    d += elm.Line().at(u1.VOUT).right(1.8)
    nC = d.here
    d += elm.Dot()
    d += elm.Line().up(0.6)
    netlabel(d, '+5V')
    d += elm.Capacitor().at(nC).down(1.6).label('C2 22uF', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)

    # ================================================================ MCU
    u2 = (elm.Ic(size=(4.6, 8.0), pins=[pin('5V', 'L', 0.88), pin('3V3', 'L', 0.62), pin('GND', 'L', 0.12),
                                        pin('GPIO20 (RX)', 'R', 0.88), pin('GPIO21 (TX)', 'R', 0.72),
                                        pin('GPIO8', 'R', 0.42), pin('GPIO3', 'R', 0.15)])
          .theta(0).anchor('5V').at((6.0, -8.0))
          .label('U2 ESP32-C3 SuperMini / DevKitM-1\n(on-board 3.3 V LDO, BLE advertiser +10 dBm)', 'bottom',
                 fontsize=SMALL + 1))
    d += u2
    d += elm.Line().at(u2['5V']).left(1.0)
    netlabel(d, '+5V', 'left')
    d += elm.Line().at(u2['3V3']).left(1.0)
    netlabel(d, '+3V3 (out)', 'left')
    d += elm.Line().at(u2.GND).left(0.6)
    d += elm.Ground(lead=False)

    # ---- GPS module on UART
    gx = u2['GPIO20 (RX)'][0] + 6.0
    u3 = (elm.Ic(size=(3.6, 3.2), pins=[pin('TXD', 'L', 0.75), pin('RXD', 'L', 0.35), pin('VCC', 'R', 0.8),
                                        pin('GND', 'B', 0.5), pin('ANT', 'R', 0.3)])
          .theta(0).anchor('TXD').at((gx, u2['GPIO20 (RX)'][1]))
          .label('U3 GPS module\nu-blox NEO-6M breakout\nor ATGM336H\n9600 baud NMEA, 1 Hz', 'top', fontsize=SMALL))
    d += u3
    d += elm.Line().at(u2['GPIO20 (RX)']).to(u3.TXD)
    d += elm.Label().at(((u2['GPIO20 (RX)'][0] + u3.TXD[0]) / 2, u3.TXD[1] + 0.35)).label('GPS TXD -> MCU RX', fontsize=SMALL)
    xm = u2['GPIO21 (TX)'][0] + 2.0
    d += elm.Line().at(u2['GPIO21 (TX)']).to((xm, u2['GPIO21 (TX)'][1]))
    d += elm.Line().to((xm, u3.RXD[1]))
    d += elm.Line().to(u3.RXD)
    d += elm.Label().at(((xm + u3.TXD[0]) / 2, u3.RXD[1] + 0.35)).label('MCU TX -> GPS RXD (optional config)', fontsize=SMALL)
    d += elm.Line().at(u3.VCC).right(0.6)
    netlabel(d, '+3V3', 'right')
    d += elm.Ground().at(u3.GND)
    d += elm.Line().at(u3.ANT).right(2.6)
    d += elm.Antenna().label('patch\nantenna', 'right', fontsize=SMALL)

    # ---- GPIO8 status LED (active low, on-board on SuperMini)
    d += elm.LED().at(u2.GPIO8).right(2.2).reverse().label('D3 status', 'bottom', fontsize=SMALL)
    d += elm.Resistor().right(2.0).label('R1 1k', 'top', fontsize=SMALL)
    d += elm.Line().right(0.3)
    netlabel(d, '+3V3', 'right')

    # ---- GPIO3 ignition / motion sense (active HIGH)
    d += elm.Line().at(u2.GPIO3).right(1.0)
    n1 = d.here
    d += elm.Dot()
    d += elm.Zener().at(n1).down(2.0).reverse().label('D4 3V3\nzener\nBZT52C3V3', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(n1).right(2.6)
    n2 = d.here
    d += elm.Dot()
    d += elm.Resistor().at(n2).down(2.0).label('R3\n100k', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(n2).right(2.2)
    n3 = d.here
    d += elm.Dot()
    d += elm.Capacitor().at(n3).down(2.0).label('C3\n100nF', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Resistor().at(n3).right(2.4).label('R2 100k', 'top', fontsize=SMALL)
    d += elm.Line().right(0.3)
    netlabel(d, 'IGN (9-60 V = ON)', 'right')

    notes = ("NOTES (prototype schematic, not production-reviewed)\n"
             "1. Pins: GPIO20 = UART RX from GPS TXD, GPIO21 = UART TX to GPS RXD, GPIO8 = status LED (plain LED active LOW;\n"
             "   the DevKitM-1 has a WS2812 RGB LED on GPIO8 instead), GPIO3 = ignition/motion sense, active HIGH\n"
             "   (R2/R3 divider clamped by D4 to <= 3.3 V). With R3 fitted, configure GPIO3 WITHOUT the internal pull-up;\n"
             "   for bench use with IGN unconnected, omit R3/D4/C3 and use the pull-up ('unwired = on').\n"
             "2. GPS is optional: beacon still works without it (no position, speed from wheel sensor or 'unknown').\n"
             "3. D2 must match the pack: SMBJ58CA clamps near 93 V, so U1 needs a 100 V-class input (an 80 V module is NOT enough).\n"
             "4. For e-bikes without an ignition wire, a motion switch or the controller's 'key-on' line can drive IGN.\n"
             "5. GPS VCC from +3V3 keeps UART at 3.3 V logic; NEO-6M breakouts draw ~40-50 mA (approx.) while tracking.\n"
             "6. Mount the module's PCB antenna away from metal frames; enclosure IP65 or better for outdoor use.")
    d += elm.Label().at((-1.0, -19.5)).label(notes, 'right', fontsize=10, halign='left')

    d.save(os.path.join(HERE, 'vehicle_beacon.svg'))
    d.save(os.path.join(HERE, 'vehicle_beacon.png'), dpi=150)
print('ok')
