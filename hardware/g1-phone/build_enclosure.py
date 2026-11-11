#!/usr/bin/env python3
"""G1 Phone enclosure, at the exact outer size of the first iPhone: 115.0 x 61.0 x 11.6 mm.

Two printable parts for fit checks (EVT shell): a front frame that holds the 3.5" display,
and a back shell with the board zone, battery bay and port openings.

    pip install trimesh manifold3d numpy scipy
    python3 hardware/g1-phone/build_enclosure.py        # writes g1_phone_front.stl, g1_phone_back.stl

Every number below is a parameter. Measure your actual display module, battery and board,
change the numbers, and run it again. Print: PETG or resin, 0.12 mm layers.
"""
from pathlib import Path

import numpy as np
import trimesh

# ---------------------------------------------------------------- outer body (do not change: iPhone 1)
BODY_W, BODY_H, BODY_D = 61.0, 115.0, 11.6
CORNER_R = 10.0

# ---------------------------------------------------------------- construction
WALL = 1.6            # side wall
BACK = 1.2            # back plate thickness
FRONT_D = 3.4         # depth of the front frame; the rest is the back shell
FRONT_LIP = 0.8       # frame material in front of the display module

# ---------------------------------------------------------------- 3.5" 320 x 480 display (confirm against your panel's drawing)
DISP_ACTIVE_W, DISP_ACTIVE_H = 48.96, 73.44     # visible area
DISP_MODULE_W, DISP_MODULE_H = 55.0, 84.5       # glass outline incl. touch panel
DISP_CENTER_Y = 4.0                              # display sits a little above centre
WINDOW_MARGIN = 0.4

# ---------------------------------------------------------------- inside
BOARD_W, BOARD_H = 55.0, 46.0     # main board zone at the top (40.5 mm Android module + power + audio)
BOARD_STANDOFF_H = 1.4
BATTERY_W, BATTERY_H, BATTERY_T = 52.0, 58.0, 4.6   # LiPo pouch below the board

SEG = 48  # cylinder smoothness


def rounded_box(w, h, d, r, z0=0.0):
    """Box with rounded vertical edges, centred on x/y, from z0 to z0 + d."""
    r = max(0.05, min(r, w / 2 - 0.01, h / 2 - 0.01))
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = trimesh.creation.cylinder(radius=r, height=d, sections=SEG)
            c.apply_translation([sx * (w / 2 - r), sy * (h / 2 - r), z0 + d / 2])
            pts.append(c.vertices)
    return trimesh.convex.convex_hull(np.vstack(pts))


def box(w, h, d, x=0.0, y=0.0, z0=0.0):
    b = trimesh.creation.box((w, h, d))
    b.apply_translation([x, y, z0 + d / 2])
    return b


def hole(dia, length, x, y, z, axis):
    """Round hole centred at (x, y, z) along 'x', 'y' or 'z'."""
    c = trimesh.creation.cylinder(radius=dia / 2, height=length, sections=SEG)
    if axis == "x":
        c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    elif axis == "y":
        c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    c.apply_translation([x, y, z])
    return c


def union(parts):
    return trimesh.boolean.union(parts, engine="manifold")


def cut(body, cutters):
    return trimesh.boolean.difference([body, union(cutters)], engine="manifold")


def back_shell():
    depth = BODY_D - FRONT_D
    shell = cut(
        rounded_box(BODY_W, BODY_H, depth, CORNER_R),
        [rounded_box(BODY_W - 2 * WALL, BODY_H - 2 * WALL, depth, CORNER_R - WALL, z0=BACK)],
    )
    top, bottom = BODY_H / 2, -BODY_H / 2
    mid_z = BACK + (depth - BACK) / 2

    add = []
    # board standoffs (M1.6 self-tapping), board zone at the top
    by = top - WALL - 1.0 - BOARD_H / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = trimesh.creation.cylinder(radius=2.2, height=BOARD_STANDOFF_H, sections=SEG)
            p.apply_translation([sx * (BOARD_W / 2 - 3), by + sy * (BOARD_H / 2 - 3), BACK + BOARD_STANDOFF_H / 2])
            add.append(p)
    # battery bay: a low rail on each side keeps the pouch from sliding into the board
    bat_y = bottom + WALL + 1.5 + BATTERY_H / 2
    add.append(box(BATTERY_W + 2.4, 1.2, BATTERY_T * 0.6, y=bat_y + BATTERY_H / 2 + 0.9, z0=BACK))
    for sx in (-1, 1):
        add.append(box(1.0, BATTERY_H * 0.5, BATTERY_T * 0.6, x=sx * (BATTERY_W / 2 + 0.8), y=bat_y, z0=BACK))
    # four screw posts that the front frame closes onto
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = trimesh.creation.cylinder(radius=1.9, height=depth - BACK - 0.2, sections=SEG)
            p.apply_translation([sx * (BODY_W / 2 - WALL - 1.9), sy * (BODY_H / 2 - WALL - 9.0), BACK + (depth - BACK - 0.2) / 2])
            add.append(p)
    shell = union([shell] + add)

    cuts = []
    # standoff and post pilot holes
    for sx in (-1, 1):
        for sy in (-1, 1):
            cuts.append(hole(1.3, 6, sx * (BOARD_W / 2 - 3), by + sy * (BOARD_H / 2 - 3), BACK + 3, "z"))
            cuts.append(hole(1.3, depth, sx * (BODY_W / 2 - WALL - 1.9), sy * (BODY_H / 2 - WALL - 9.0), BACK + depth / 2 + 0.6, "z"))
    # bottom edge: USB-C, speaker holes, talk microphone
    cuts.append(box(9.2, WALL + 2, 3.4, y=bottom + WALL / 2, z0=mid_z - 1.7))
    for i in range(5):
        cuts.append(hole(1.2, WALL + 2, 12.5 + i * 2.6, bottom + WALL / 2, mid_z, "y"))
    cuts.append(hole(1.0, WALL + 2, -14.0, bottom + WALL / 2, mid_z, "y"))
    # top edge: second microphone (noise cancelling) and 3.5 mm-free flat top
    cuts.append(hole(1.0, WALL + 2, 12.0, top - WALL / 2, mid_z, "y"))
    # right side: the G1 key (press to talk), left side: nano-SIM tray
    cuts.append(box(WALL + 2, 14.0, 3.0, x=BODY_W / 2 - WALL / 2, y=18.0, z0=mid_z - 1.5))
    cuts.append(box(WALL + 2, 13.0, 2.2, x=-BODY_W / 2 + WALL / 2, y=24.0, z0=mid_z - 1.1))
    # back: camera window, top-left as you look at the back
    cuts.append(hole(7.0, BACK + 2, BODY_W / 2 - 11.0, top - 11.0, BACK / 2, "z"))
    return cut(shell, cuts)


def front_frame():
    z0 = BODY_D - FRONT_D
    frame = rounded_box(BODY_W, BODY_H, FRONT_D, CORNER_R, z0=z0)
    # a lip that drops into the back shell and locates the frame
    lip_outer = rounded_box(BODY_W - 2 * WALL - 0.3, BODY_H - 2 * WALL - 0.3, 1.2, CORNER_R - WALL, z0=z0 - 1.2)
    lip_inner = rounded_box(BODY_W - 2 * WALL - 2.3, BODY_H - 2 * WALL - 2.3, 1.6, CORNER_R - WALL - 1.0, z0=z0 - 1.4)
    frame = union([frame, cut(lip_outer, [lip_inner])])

    cuts = [
        # display window (through) and the pocket the display module sits in, from behind
        box(DISP_ACTIVE_W + 2 * WINDOW_MARGIN, DISP_ACTIVE_H + 2 * WINDOW_MARGIN, FRONT_D + 2, y=DISP_CENTER_Y, z0=z0 - 1),
        box(DISP_MODULE_W + 0.4, DISP_MODULE_H + 0.4, FRONT_D - FRONT_LIP + 2, y=DISP_CENTER_Y, z0=z0 - 2),
        # earpiece slot above the display
        box(12.0, 1.4, FRONT_D + 2, y=BODY_H / 2 - 5.2, z0=z0 - 1),
        # room for the screw posts
    ]
    for sx in (-1, 1):
        for sy in (-1, 1):
            cuts.append(hole(1.8, FRONT_D + 4, sx * (BODY_W / 2 - WALL - 1.9), sy * (BODY_H / 2 - WALL - 9.0), z0 + FRONT_D / 2 - 1.0, "z"))
    return cut(frame, cuts)


def main():
    out = Path(__file__).parent
    back, front = back_shell(), front_frame()
    back.export(out / "g1_phone_back.stl")
    front.export(out / "g1_phone_front.stl")
    both = trimesh.util.concatenate([back, front])
    size = both.bounds[1] - both.bounds[0]
    print(f"outer size  : {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} mm  (target {BODY_W} x {BODY_H} x {BODY_D})")
    print(f"back shell  : watertight={back.is_watertight}  volume={back.volume / 1000:.2f} cm3")
    print(f"front frame : watertight={front.is_watertight}  volume={front.volume / 1000:.2f} cm3")
    assert np.allclose(size, [BODY_W, BODY_H, BODY_D], atol=0.02), "outer size is off"
    assert back.is_watertight and front.is_watertight, "a part is not printable (not watertight)"
    # the stack must fit: display in front, battery behind it
    stack = FRONT_LIP + 3.2 + 0.4 + BATTERY_T + 0.3 + BACK
    print(f"depth stack : lip {FRONT_LIP} + display 3.2 + gap 0.4 + battery {BATTERY_T} + gap 0.3 + back {BACK} = {stack:.1f} mm of {BODY_D}")
    assert stack <= BODY_D, "display + battery do not fit in the depth"
    assert BOARD_H + BATTERY_H + 2 * WALL + 4.0 <= BODY_H, "board + battery do not fit in the height"


if __name__ == "__main__":
    main()
