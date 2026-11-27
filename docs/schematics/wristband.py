"""HearMe wristband schematic (prototype). Run: python docs/schematics/wristband.py

Outputs wristband.png and wristband.svg next to this script.
Pin map must match firmware: motor PWM GPIO5, LED GPIO8, button GPIO9, buzzer GPIO6 (Wokwi only).
Nets with the same label (+5V_USB, VBAT, VBAT_SW, +3V3) are connected.
"""
import os

import schemdraw
import schemdraw.elements as elm

HERE = os.path.dirname(os.path.abspath(__file__))
schemdraw.config(fontsize=11)
SMALL = 9


def pin(name, side, pos):
    return elm.IcPin(name=name, side=side, pos=pos)


def net(d, at, text, direction='up', length=0.6, loc='top'):
    """Short stub ending in a net label."""
    line = elm.Line().at(at)
    line = getattr(line, direction)(length)
    d += line
    d += elm.Label().label(text, loc, fontsize=SMALL + 1, color='blue')


with schemdraw.Drawing(show=False) as d:
    d.config(unit=2.0)

    # ================================================================ POWER ROW (y = 0)
    j1 = (elm.Ic(size=(2.2, 4.0), pins=[pin('VBUS', 'R', 0.875), pin('CC1', 'R', 0.625),
                                        pin('CC2', 'R', 0.375), pin('GND', 'R', 0.125)])
          .theta(0).anchor('VBUS').at((2.6, 0)).label('J1 USB-C\n(power only)', 'top', fontsize=SMALL + 1))
    d += j1
    d += elm.Line().at(j1.CC1).right(0.4)
    d += elm.Resistor().right(1.4).label('R1 5.1k', 'top', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(j1.CC2).right(0.4)
    d += elm.Resistor().right(1.4).label('R2 5.1k', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(j1.GND).right(0.4)
    d += elm.Ground(lead=False)

    d += elm.Line().at(j1.VBUS).right(3.6)
    nA = d.here
    d += elm.Dot()
    net(d, nA, '+5V_USB')
    d += elm.Capacitor().at(nA).down(1.6).label('C1 10uF', 'top', fontsize=SMALL)
    d += elm.Ground(lead=False)  # (drawn below CC resistors' x range)

    u1 = (elm.Ic(size=(3.4, 4.0), pins=[pin('VCC', 'L', 0.875), pin('CE', 'L', 0.625), pin('TEMP', 'L', 0.375),
                                        pin('GND', 'L', 0.125),
                                        pin('BAT', 'R', 0.875), pin('CHRG', 'R', 0.625), pin('STDBY', 'R', 0.375),
                                        pin('PROG', 'R', 0.125)])
          .theta(0).anchor('VCC').at((nA[0] + 2.4, 0)).label('U1 TP4056\nLi-ion charger', 'top', fontsize=SMALL + 1))
    d += u1
    d += elm.Line().at(nA).to(u1.VCC)
    ce_x = u1.CE[0] - 0.8
    d += elm.Line().at(u1.CE).left(0.8)
    d += elm.Line().up(u1.VCC[1] - u1.CE[1])
    d += elm.Dot()
    d += elm.Line().at(u1.TEMP).left(0.5)
    d += elm.Ground(lead=False)
    d += elm.Line().at(u1.GND).left(0.5)
    d += elm.Ground(lead=False)
    d += elm.Line().at(u1.PROG).right(0.6)
    d += elm.Resistor().down(1.6).label('R3 10k\n(~130 mA)', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(u1.STDBY).right(0.6)
    d += elm.NoConnect()
    d += elm.Line().at(u1.CHRG).right(0.6)
    d += elm.LED().right(1.8).reverse().label('D1 red', 'bottom', fontsize=SMALL)
    d += elm.Resistor().right(1.8).label('R4 1k', 'bottom', fontsize=SMALL)
    d += elm.Line().right(0.3)
    d += elm.Label().label('+5V_USB', 'right', fontsize=SMALL + 1, color='blue')

    bx = u1.BAT[0] + 9.0
    d += elm.Line().at(u1.BAT).right(bx - u1.BAT[0])
    nB = d.here
    d += elm.Dot()
    net(d, nB, 'VBAT')
    d += elm.Battery().at(nB).down(2.4).reverse().label('BT1 LiPo 3.7 V\n150-200 mAh\n(cell with protection\nPCB, DW01A+8205A)', 'top', fontsize=SMALL)
    d += elm.Ground(lead=False)

    d += elm.Switch().at(nB).right(2.4).label('S2 ON/OFF', 'bottom', fontsize=SMALL)
    d += elm.Line().right(0.8)
    nC = d.here
    d += elm.Dot()
    net(d, nC, 'VBAT_SW')
    d += elm.Capacitor().at(nC).down(1.6).label('C2 1uF', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)

    u2 = (elm.Ic(size=(2.8, 2.4), pins=[pin('VIN', 'L', 0.75), pin('EN', 'L', 0.25), pin('VOUT', 'R', 0.75),
                                        pin('GND', 'B', 0.5)])
          .theta(0).anchor('VIN').at((nC[0] + 2.0, 0)).label('U2 LDO 3.3 V\n(ME6211C33 /\nAP2112K-3.3)', 'top', fontsize=SMALL))
    d += u2
    d += elm.Line().at(nC).to(u2.VIN)
    d += elm.Line().at(u2.EN).left(0.8)
    d += elm.Line().up(u2.VIN[1] - u2.EN[1])
    d += elm.Dot()
    d += elm.Ground().at(u2.GND)
    d += elm.Line().at(u2.VOUT).right(1.6)
    nD = d.here
    d += elm.Dot()
    net(d, nD, '+3V3')
    d += elm.Capacitor().at(nD).down(1.6).label('C3 10uF', 'top', fontsize=SMALL)
    d += elm.Ground(lead=False)

    # ================================================================ MCU ROW
    y0 = -8.0
    u3 = (elm.Ic(size=(4.6, 9.0), pins=[pin('3V3', 'L', 0.9), pin('EN', 'L', 0.6), pin('GND', 'L', 0.1),
                                        pin('GPIO5', 'R', 0.9), pin('GPIO6', 'R', 0.58),
                                        pin('GPIO8', 'R', 0.36), pin('GPIO9', 'R', 0.12)])
          .theta(0).anchor('3V3').at((10.0, y0))
          .label('U3 ESP32-C3 module (ESP32-C3-MINI-1 /\nSuperMini / DevKitM-1), BLE scanner', 'bottom', fontsize=SMALL + 1))
    d += u3
    d += elm.Line().at(u3['3V3']).left(0.8)
    d += elm.Line().up(0.6)
    d += elm.Label().label('+3V3', 'top', fontsize=SMALL + 1, color='blue')
    d += elm.Line().at(u3.EN).left(2.6)
    nE = d.here
    d += elm.Dot()
    d += elm.Resistor().at(nE).up(1.8).label('R5 10k', 'top', fontsize=SMALL)
    d += elm.Label().label('+3V3', 'top', fontsize=SMALL + 1, color='blue')
    d += elm.Capacitor().at(nE).down(1.6).label('C4 1uF', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Line().at(u3.GND).left(0.6)
    d += elm.Ground(lead=False)

    # ---- GPIO5: motor driver
    d += elm.Resistor().at(u3.GPIO5).right(2.2).label('R6 100R', 'top', fontsize=SMALL)
    nG = d.here
    d += elm.Dot()
    d += elm.Line().right(1.4)
    q1 = elm.NFet(bulk=False).anchor('gate').reverse().label('Q1 AO3400\nN-MOSFET', 'right', fontsize=SMALL)
    d += q1
    d += elm.Resistor().at(nG).down(1.8).label('R7 100k', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)
    d += elm.Ground().at(q1.source)
    d += elm.Line().at(q1.drain).up(0.5)
    nM = d.here
    d += elm.Dot()
    d += elm.Motor().up(2.2).label('M1 coin ERM\n3 V, ~60-90 mA', 'top', fontsize=SMALL)
    nMt = d.here
    d += elm.Dot()
    net(d, nMt, 'VBAT_SW', length=0.5)
    d += elm.Line().at(nM).right(1.6)
    d += elm.Diode().up(2.2).label('D2 flyback\n1N4148W', 'bottom', fontsize=SMALL)
    d += elm.Line().left(1.6)

    # ---- GPIO6: buzzer (Wokwi stand-in, not fitted)
    d += elm.Resistor().at(u3.GPIO6).right(2.2).label('R8 1k (DNP)', 'top', fontsize=SMALL)
    d += elm.RBox().right(2.0).label('BZ1 piezo\n(DNP, Wokwi only)', 'bottom', fontsize=SMALL)
    d += elm.Ground(lead=False)

    # ---- GPIO8: status LED, active low (keeps strapping pin high)
    d += elm.LED().at(u3.GPIO8).right(2.2).reverse().label('D3 blue', 'bottom', fontsize=SMALL)
    d += elm.Resistor().right(2.0).label('R9 1k', 'top', fontsize=SMALL)
    d += elm.Line().right(0.3)
    d += elm.Label().label('+3V3  (LED active LOW)', 'right', fontsize=SMALL + 1, color='blue')

    # ---- GPIO9: button to GND (internal pull-up)
    d += elm.Line().at(u3.GPIO9).right(0.6)
    d += elm.Button().right(2.0).label('S1 push button', 'top', fontsize=SMALL)
    d += elm.Line().right(0.4)
    d += elm.Ground(lead=False)

    notes = ("NOTES (prototype schematic, not production-reviewed)\n"
             "1. Pins: GPIO5 motor PWM, GPIO8 status LED (active LOW), GPIO9 button (active LOW, internal pull-up),\n"
             "   GPIO6 buzzer (Wokwi simulation stand-in only, DNP on hardware).\n"
             "2. GPIO8/GPIO9 are ESP32-C3 strapping pins: keep GPIO8 high at reset; holding S1 at reset enters download mode.\n"
             "3. Motor runs from VBAT_SW through Q1; PWM on GPIO5 sets intensity; D2 clamps the inductive kick; R7 keeps Q1 off at boot.\n"
             "4. SuperMini/DevKitM-1 boards already include the LDO, R5/C4 and an LED; parts are shown for a custom PCB.\n"
             "5. TP4056 R3 = 10k gives ~130 mA (datasheet table); CC1/CC2 5.1k let USB-C chargers supply 5 V.")
    d += elm.Label().at((-1.0, -19.0)).label(notes, 'right', fontsize=10, halign='left')

    d.save(os.path.join(HERE, 'wristband.svg'))
    d.save(os.path.join(HERE, 'wristband.png'), dpi=150)
print('ok')
