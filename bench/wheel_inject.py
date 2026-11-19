"""A virtual hi-res mouse: plays wheel patterns (as a Logitech hi-res wheel would: 120 units a notch)."""
import sys, time
from evdev import UInput, ecodes as e
cap = {e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL, e.REL_WHEEL_HI_RES, e.REL_HWHEEL, e.REL_HWHEEL_HI_RES], e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE]}
ui = UInput(cap, name='volumen-test-mouse')
time.sleep(1.0)
def slow_notch(d=1, parts=8, gap=0.04):
    # a hi-res wheel (Logitech HID++: eight steps a notch) turned slowly
    acc = 0
    for i in range(parts):
        ui.write(e.EV_REL, e.REL_WHEEL_HI_RES, -d * 120 // parts)
        acc += 120 // parts
        if acc >= 120: ui.write(e.EV_REL, e.REL_WHEEL, -d); acc = 0
        ui.syn(); time.sleep(gap)
def notch(d=1, parts=1):
    # a full notch as `parts` hi-res events; the legacy REL_WHEEL fires once per full notch
    for i in range(parts):
        ui.write(e.EV_REL, e.REL_WHEEL_HI_RES, -d * 120 // parts)
        if i == parts - 1: ui.write(e.EV_REL, e.REL_WHEEL, -d)
        ui.syn(); time.sleep(0.008)
# a little motion first: the compositor gives pointer focus to the surface under the
# cursor only when the pointer moves
for dx in (3, -3, 3, -3):
    ui.write(e.EV_REL, e.REL_X, dx); ui.syn(); time.sleep(0.03)
time.sleep(0.3)
plan = sys.argv[1] if len(sys.argv) > 1 else 'all'
def mark(): ui.write(e.EV_REL, e.REL_X, 1); ui.syn(); time.sleep(0.05); ui.write(e.EV_REL, e.REL_X, -1); ui.syn()
steps = {
  'single': lambda: [notch(1), time.sleep(1.5)],
  'double': lambda: [notch(1), time.sleep(0.12), notch(1), time.sleep(1.8)],
  'spin':   lambda: [[notch(1), time.sleep(0.035)] for _ in range(12)] + [time.sleep(3)],
  'hires':  lambda: [notch(1, 4), time.sleep(1.5)],
  'back':   lambda: [notch(-1), time.sleep(1.5)],
  'slow':   lambda: [slow_notch(1), time.sleep(1.5)],
  'half':   lambda: [slow_notch(1, 4, 0.04), time.sleep(1.5)],
}
for name in (steps if plan == 'all' else plan.split(',')):
    print('step', name, flush=True); steps[name]()
ui.close()
