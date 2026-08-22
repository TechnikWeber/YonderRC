# libcamera tuning files

## `imx519-af.json` — Arducam 16 MP IMX519 with working autofocus

Raspberry Pi OS ships `/usr/share/libcamera/ipa/rpi/vc4/imx519.json` **without an
`rpi.af` algorithm**. The AK7375 lens actuator is bound by the kernel and shows up as a
v4l-subdev, but libcamera refuses every focus control:

```
WARN IPARPI ipa_base.cpp:797 Could not set AF_MODE - no AF algorithm
```

so the lens stays wherever it happens to rest and the picture is permanently soft.

This file is Raspberry Pi's stock `imx519.json` with an `rpi.af` block appended, modelled
on the shipped `imx708.json`.

The `map` is **measured, not assumed**. Sweeping `--lens-position` across the AK7375's
10-bit range on a distant scene peaks at code ≈ 597 — the actuator's rest position (code
0) is *not* infinity, which is why a naive `[0.0, 0, 12.0, 1023]` map made "0 dioptres"
the blurriest setting of all. The shipped map anchors 0 dioptres at the measured far
focus and spends the remaining stroke on the near range:

```
"map": [0.0, 597, 10.0, 1023]
```

So `focus: manual`, `lensPosition: 0` is the sharp far setting you want on a vehicle. The
dioptre numbers above 0 are a usable scale, not a calibrated distance — 10 is simply the
near end of the stroke.

`install.sh` copies it to `/var/lib/yonderrc/tuning/imx519-af.json`. Point a camera at it
in **Setup › Cameras › Tuning file** and pick a focus mode. Verified on a Pi 4B
(Bookworm, kernel 6.12) with an Arducam 16 MP IMX519: without the file
`--autofocus-mode` is refused, with it both `auto` and `manual`/`--lens-position` work.

Upstream: `raspberrypi/libcamera`, `src/ipa/rpi/vc4/data/imx519.json`, BSD-2-Clause —
that licence covers this derivative too, not the project's CC BY-NC-ND.
