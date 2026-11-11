// G1 Dev Kit — handheld enclosure (2 parts: front bezel + back shell)
// Parametric: measure your exact display/board and adjust the variables.
// Print: PETG, 0.2 mm layers, 3 walls, 20% infill. Render: F6, then export STL.

$fn = 64;

// ---------- overall body
body_w = 172;   // width (mm)
body_h = 92;    // height
body_d = 40;    // total depth (front + back)
corner = 14;    // corner radius
wall   = 2.4;
split  = 9;     // depth of the front bezel part

// ---------- 5" DSI touch display (visible window + module pocket)
disp_win_w = 112; disp_win_h = 66;     // visible area window
disp_mod_w = 121; disp_mod_h = 76; disp_mod_d = 5.5;
disp_offset_x = -14;                    // display sits left, "eye" button on the right

// ---------- controls
eye_d = 24;          // big push-to-talk "eye" button
eye_x = 64;          // from centre
ring_d = 34;         // LED ring recess around the eye
spk_slots = 6;       // speaker grille slots (under the eye)

// ---------- Raspberry Pi 5 mounting (58 x 49 mm hole pattern, M2.5)
pi_holes = [[0,0],[58,0],[0,49],[58,49]];
pi_origin = [-56, -24.5];

part = "both";   // "front", "back", or "both"

module rounded_box(w, h, d, r) {
    hull() for (x = [-w/2 + r, w/2 - r], y = [-h/2 + r, h/2 - r])
        translate([x, y, 0]) cylinder(r = r, h = d);
}

// ------------------------------------------------------------ FRONT BEZEL
module front() {
    difference() {
        rounded_box(body_w, body_h, split, corner);
        // hollow
        translate([0, 0, wall]) rounded_box(body_w - 2*wall, body_h - 2*wall, split, corner - wall);
        // display window + pocket
        translate([disp_offset_x - disp_win_w/2, -disp_win_h/2, -1]) cube([disp_win_w, disp_win_h, wall + 2]);
        translate([disp_offset_x - disp_mod_w/2, -disp_mod_h/2, wall - 0.01]) cube([disp_mod_w, disp_mod_h, disp_mod_d]);
        // eye button + LED ring recess
        translate([eye_x, 10, -1]) cylinder(d = eye_d + 0.6, h = wall + 2);
        translate([eye_x, 10, -1]) difference() {
            cylinder(d = ring_d, h = 1.6);
            cylinder(d = eye_d + 3, h = 1.6);
        }
        // speaker grille
        for (i = [0 : spk_slots - 1])
            translate([eye_x - 10, -22 - i * 3.2, -1]) cube([20, 1.6, wall + 2]);
        // 2 mic holes on the top edge
        for (dx = [-30, 30]) translate([dx, body_h/2 - wall - 1, split/2]) rotate([-90, 0, 0]) cylinder(d = 1.6, h = wall + 3);
    }
    // snap lip
    translate([0, 0, split]) difference() {
        rounded_box(body_w - 2*wall - 0.4, body_h - 2*wall - 0.4, 2.5, corner - wall);
        translate([0, 0, -1]) rounded_box(body_w - 4*wall, body_h - 4*wall, 5, corner - 2*wall);
    }
}

// ------------------------------------------------------------- BACK SHELL
module back() {
    d = body_d - split;
    difference() {
        rounded_box(body_w, body_h, d, corner);
        translate([0, 0, wall]) rounded_box(body_w - 2*wall, body_h - 2*wall, d, corner - wall);
        // camera window (Camera Module 3) top-left of the back
        translate([-body_w/2 + 26, body_h/2 - 22, -1]) cylinder(d = 9, h = wall + 2);
        // vents over the Pi 5 active cooler
        for (i = [0 : 8]) translate([-30 + i * 6, -10, -1]) cube([2.4, 34, wall + 2]);
        // side ports: USB-C power (left), 2x USB-A (right), SIM tray access (bottom)
        translate([-body_w/2 - 1, -6, d - 16]) cube([wall + 2, 11, 5]);
        translate([body_w/2 - wall - 1, -14, d - 22]) cube([wall + 2, 15, 17]);
        translate([10, -body_h/2 - 1, d - 12]) cube([18, wall + 2, 4]);
        // 2 SMA antenna holes (4G main + diversity) on the top edge
        for (dx = [-20, 0]) translate([dx, body_h/2 - wall - 1, d - 12]) rotate([-90, 0, 0]) cylinder(d = 6.6, h = wall + 3);
        // lanyard slot
        translate([body_w/2 - 10, -body_h/2 - 1, 6]) cube([3, wall + 2, 8]);
    }
    // Pi 5 standoffs (M2.5 heat-set inserts)
    for (p = pi_holes) translate([pi_origin[0] + p[0], pi_origin[1] + p[1], wall - 0.01])
        difference() { cylinder(d = 6, h = 6); cylinder(d = 3.6, h = 7); }
    // battery bay rails (2x 21700 or LiPo pack lies under the Pi)
    for (y = [-30, 30]) translate([-60, y, wall - 0.01]) cube([120, 1.6, 3]);
    // screw bosses in the corners (M2.5 x 10)
    for (x = [-body_w/2 + 9, body_w/2 - 9], y = [-body_h/2 + 9, body_h/2 - 9])
        translate([x, y, wall - 0.01]) difference() { cylinder(d = 7, h = d - wall - 3); cylinder(d = 3.6, h = d); }
}

if (part == "front" || part == "both") color("#1b1b20") front();
if (part == "back"  || part == "both") color("#2a2a31") translate([0, 0, -6]) mirror([0, 0, 1]) back();
