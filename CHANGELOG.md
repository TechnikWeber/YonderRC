# Changelog

All notable changes to YonderRC. Each release is the full project; every zip is
self-contained.

## v1.72.3
*The desktop app as a download: Windows installer, portable and Linux AppImage on every
release — and the installed app now actually works.*

- **Desktop app downloads** on the release page from now on: `…-windows-setup.exe`,
  `…-windows-portable.exe` and `…-linux-x86_64.AppImage`, built automatically for every
  release. **Unsigned**: SmartScreen warns (*More info › Run anyway*), and with Smart App
  Control on, Windows blocks them — then use the browser. The AppImage is not yet tested on
  a real Linux desktop. How to: README › *Desktop app*.
- **The installed app showed an empty window.** It looked for its files under `/assets`,
  which in an installed app is `C:ssets`. It had only ever been run from the source.
- **Video in the desktop app** works without an API secret, also with the vehicle on the
  same PC. The installed app's requests looked like a page from the internet and the
  vehicle refused them (403). Works with every vehicle, nothing to update there.
- **`npm install` with npm 11** fetches Electron, esbuild and the WebRTC module again:
  newer npm skips install scripts that a project has not allowed.

## v1.72.2
*Setup › Controls keeps one group open at a time.*

- **One group open at a time** in Setup › Controls: opening Safety, Return-home budget,
  Stick feedback, Voice callouts, Auto-disarm, Game controller, Action bindings,
  Low-battery warning or Blackbox logging folds the one that was open, so the page stays
  short. The small hints inside a group open and close as before. A browser too old for
  this simply lets several stay open.
- Troubleshooting §5: Windows' Smart App Control can block a file of the simulator right
  after `npm install` — wait and start again, and the way out if it stays blocked.

## v1.72.1
*The simulator on Windows and macOS, with video; go2rtc on 32-bit Pi OS.*

- **`npm run dev:video` runs on Windows, Linux and macOS.** It is a Node script now and
  downloads the go2rtc build for your system. Before, it was a bash script that always
  fetched the Linux binary, so video in the simulator only worked on Linux.
- **The README says how to get the simulator running**: what to install on Windows,
  Debian/Ubuntu, Fedora and macOS, then clone, `npm install`, `npm run dev`.
- **Install on 32-bit Pi OS**: the installer asked for a go2rtc file that does not exist
  (`go2rtc_linux_armv7`) and stopped. It now fetches `go2rtc_linux_arm`, or `_armv6` on a
  Pi Zero / Pi 1.

## v1.72.0
*One setup per controller: a controller with a layout of its own is shown once where its
sticks and buttons are, and every controller can have its own action buttons.*

- **Set up a controller once, use it with every model.** A device the browser reports with
  a layout of its own — an RC transmitter in joystick mode, a pad it does not know — gets a
  **Set up** button in Setup › Controls › Game controller. Move each stick, press or flip
  what should be A … Home: the app learns where the standard controls are on it. Models
  keep speaking the standard layout (left stick, R2/L2, Start), so every model works with
  it, from a template or not — no second model for the transmitter. A switch reported as
  an axis works as a button, and a stick pushed one way can stand in for a trigger.
  Locked while armed. Tested with simulated controllers, not a real transmitter: if yours
  behaves differently, please open an issue.
- **Action buttons per controller.** Setup › Controls › Action bindings › *Controller
  buttons for*: give a controller its own buttons for arm, panic, trims …; one without its
  own uses the shared buttons, as every controller did before. Keys stay shared — there is
  one keyboard. Nothing changes until you do this.
- **Nothing to convert.** Since v1.71 the models use the standard layout in the browser and
  the desktop app alike, so stored models stay exactly as they are, and a standard pad needs
  no setup. A channel learned with an own-layout controller before it was set up may point
  at another control afterwards — press Learn on it once more.
- **The channel editor names the stick**: `left stick ↑` instead of `axis:1:inv`. And Learn
  takes a stick for a proportional channel and a button for a switch. It used to take
  either — a stick channel on a button then read nothing but centre, and a switch on an
  axis read the button with the same number.
- The diagnostics file says whether an own-layout controller in use is set up, and carries
  the setups.

## v1.71.0
*Controller and channel wishes from users: two buttons as one axis, trim on buttons,
follower channels, the board's own output numbers — and one button layout in the browser
and the desktop app.*

- **Two buttons as one axis.** A gamepad channel can be driven by two buttons — RT/R2
  forward, LT/L2 back, each by how far it is pulled. It rests in the middle, so it is
  offered for steering and for a car's or boat's throttle; on a throttle that rests at
  idle the editor refuses it.
- **Trim on buttons.** Two new actions, Trim − and Trim +, for a key or a controller
  button (Setup › Controls › Action bindings, unbound by default). 5 µs a press, on the
  steering unless the model names another channel (Setup › model › Trim buttons). A click
  per step, a lower tone back at centre.
- **Follower channels** for a second steering servo (Traxxas Revo) or a second ESC: Add
  channel › Source › *follow another channel*. It copies the other channel's final value —
  trim and speed limiter included — with its own offset, reverse and endpoints. Its
  failsafe and disarmed values follow too, so two ESCs never disagree about stop.
- **Reverse is in the channel row.** It was there all along, hidden in the collapsed details.
- **The hardware's own numbers.** Connected, every channel shows what it is wired to:
  `CH03 · out 2` on a PCA9685 board (which counts from 0), the GPIO pin, or the SBUS
  channel. ESC calibration names the output too.
- **One button layout.** The desktop app numbered controller buttons differently from the
  browser (Start was 7 there and 9 here; the triggers were axes). It now reports the
  browser's standard layout, and what it had stored is renumbered once, automatically —
  every binding keeps its physical button. The default templates were never affected.
  Tested against recorded controller data, not a real pad in the desktop app: if a button
  lands somewhere unexpected there, please open an issue.
- **Edits to a stick channel stay.** Giving a template stick another input — other keys,
  another axis, two buttons — was undone at the next load.
- **Typing is not driving.** Keys typed into a text field no longer count as control
  input: a space now reaches a label, and on a keyboard model a "w" typed into the
  vehicle address is no longer throttle.

## v1.70.2
*Video follows the control link — whatever address the vehicle has stored for itself.*

- **Video comes over the address you connected to.** Since v1.70.1 the vehicle serves
  video itself (`…:8080/video`), but the ground still took the host from the video address
  the vehicle had stored. Where that differed from the address in the app — `yonderrc.local`
  against the IP, a LAN address while connected over Tailscale — video missed the vehicle
  or reached it without the API secret, and a vehicle with a secret refused it. The ground
  now always asks the address of the control link, as the hardware guide already said
  ("the video comes along over the same address"). Older vehicles that still report
  go2rtc on port 1984 work as before.
- **The video panel says why there is no picture** instead of "Reconnecting…" forever: the
  vehicle's own answer (go2rtc not running, no camera of that name), a missing API secret,
  or a refused request — each with what to do about it.

## v1.70.1
*Safety and security fixes from a review of the whole project. Worth installing soon: two
of them let anything on the network reach further into the vehicle than it should.*

- **go2rtc is no longer open to the network.** Its API on port 1984 is full control of
  go2rtc — which runs as root and can be told to run any command as a video source — and it
  answered anyone on the network, API secret or not. Its RTSP port (8554) took anyone's
  picture into a camera stream. Both now listen on the vehicle only; the control app gets
  video through the vehicle service (`…:8080/video`), only for the configured cameras and
  under the same rules as everything else, API secret included. Nothing to do: a stored
  video address on port 1984 is moved over automatically. `http://<vehicle>:1984` no longer
  opens; the WebRTC media port 8555 is unchanged.
- **A stray request could stop the vehicle service** — `/%E0%A4%A` from any device on the
  network, or a malformed control message — and the servo board kept its last value until
  systemd restarted it. Such requests now get an error; an unexpected error writes the
  failsafe frame before the service exits.
- **No control frames rather than wrong ones.** With the control app in the background
  (another tab, minimised, phone screen off) frames arrived once a second and the vehicle
  jerked between command and failsafe. A disconnected controller read as "sticks centred" —
  half throttle on a plane — and the watchdog never tripped. Now the app sends nothing in
  both cases, the vehicle holds its own failsafe, and the app says so. A gamepad model no
  longer arms without its controller.
- **Safe values from the first moment.** The failsafe and disarmed values the control app
  sends lived in memory only: after every restart all channels sat at 1500 µs until a ground
  connected — half throttle for a plane ESC that was still powered. They are now stored on
  the vehicle. A disarmed vehicle that loses its link keeps its throttle off; a drone's
  "hold" applies only while armed.
- **Pre-arm check and speed limiter use the real rest position.** A boat could only be
  armed at full reverse, a reversed plane throttle only at full throttle, and the limiter's
  Low step turned a boat's stop into 60 % reverse.
- **ESC calibration is cancelled when the link is lost** — a ground that went away in the
  MAX step left the ESC at full throttle.
- **The setup page no longer runs a WiFi name as code.** An SSID — which anyone near the
  vehicle can choose — went into the page as HTML; so did device names and the Tailscale
  login link.
- **Restart, reboot, update and factory reset wait for a disarm**, like shutdown always
  did: each takes the outputs away and brings the vehicle back disarmed.
- Also: changing the video quality uses the detected Pi camera program; arm, config and
  calibration messages are checked before use.

## v1.70.0
- **License is now PolyForm Noncommercial 1.0.0, still with the no-military-use
  restriction.** Modified versions may now be made and shared, so forks and pull
  requests are possible; commercial and military use stay excluded. Notes that are not
  license terms moved to `NOTICE.md`.

*From a user's first-week report: a vehicle flickering in and out of failsafe, the browser
taking a headset for the joystick, and a first install that assumed more Linux than a
newcomer has.*

- **The failsafe watchdog is 500 ms** (was 300). 300 ms was tighter than the jitter of the
  links this runs on — 13 gaps over 300 ms per minute on LTE at 0 % loss, and a Pi on WiFi
  with power saving holds packets for a few hundred ms — so a working link stuttered into
  failsafe. A stored 300 from before is treated as the old default (the setup form saved it
  on every Save); a value typed in on purpose stays. Now 100–2000 ms, applied on Save
  without a restart.
- **WiFi power saving is switched off** by the installer — the classic cause of that
  stutter on a Pi in WiFi client mode.
- **A problem report is one file.** *Setup › Diagnostics* in the control app downloads both
  halves: how regularly the app really sent (with the moments the page was hidden — a
  browser throttles a background tab), the gaps between the frames the vehicle received,
  every failsafe episode and over which transport, WiFi power saving and signal, supply,
  load, the vehicle's log and journal. It then says in plain words what it found — e.g.
  "a failsafe that no network caused". The setup page has the vehicle half
  (*Overview › Problem report*), `provisioning/diag.sh` covers a vehicle whose page does
  not open. Passwords, PINs, VPN keys, the API secret, a pending Tailscale login and the
  GPS position are removed. How to send it: `docs/TROUBLESHOOTING.md`, plus an issue
  template.
- **The right game controller.** The ground read the first device the browser listed —
  often a headset. Every device is now listed with an assessment (standard layout, own
  layout, not a controller) and a live input marker; a headset or a PS4's Linux motion
  sensors are never picked automatically; the choice is remembered per browser
  (*Setup › Controls › Game controller*), with PS4/PS5 pairing notes. **Learn** no longer
  picks up a trigger that rests at −1.
- **The installer configures the hardware it finds**: a PCA9685 becomes the output driver
  (and `i2c-bus` is built), a CSI camera replaces the test pattern. Only settings that were
  never saved; sensors are named, not configured. It also refuses to run without sudo and
  moves a copy made elsewhere to `/opt/yonderrc` itself.
- **"sim" is no longer hidden**: after a hardware driver failed to start, the setup overview,
  the vehicle form and the ground's status strip show the driver that is actually running,
  with the reason.
- **OpenVPN (experimental)** as a fourth remote-access method: upload the `.ovpn`, optional
  username/password. Script hooks and file-writing directives in the profile are removed
  and listed, the vehicle keeps its own uplink unless *all traffic through the VPN* is
  ticked. Not yet verified on a vehicle.
- **Quick start for newcomers** (`docs/QUICKSTART.md`): Imager, finding the Pi, SSH from
  Windows/macOS/Linux, plan B without Imager (`ssh` + `userconf.txt`), copying with
  WinSCP/FileZilla without root, I²C addresses *before* installing.
- Fixed: the vehicle's own WireGuard interface (`yonderrc`) was counted towards the mobile
  data budget — twice, with the uplink. Shell scripts now keep LF line endings on a
  Windows checkout (`.gitattributes`).

## v1.69.0
- **The OSD stopped blinking during the first real drive.** Home symbol, home arrow,
  odometer and speed vanished for a few seconds at a time and came back — with 8
  satellites and a solid fix. The receiver was fine: a fix is spread over several NMEA
  sentences (GGA carries position and satellites, RMC speed and course, GSA the 2D/3D
  mode) and the vehicle rebuilt the whole fix from scratch out of one one-second parse
  window. A sentence burst cut by the window boundary produced a fix with holes, and the
  OSD draws nothing for a missing value. It lasted seconds at a time because the
  receiver's 1 Hz and ours are free-running clocks drifting through each other.
- **A missing sentence is now a gap, not a loss.** Values are carried over for up to 3 s
  (`mergeFix`), so a split burst is invisible. A reported loss of fix is never held — that
  is real information and drops out at once.
- **The half sentence at the window boundary is no longer destroyed.** The buffer is cut
  at the last complete line and the remainder waits for the next window; before, exactly
  one sentence per second was thrown away, and which one depended on the phase.
- **A silent receiver now reports no fix** after 5 s instead of freezing the last one. A
  position the vehicle left minutes ago is worse than no position: the home arrow keeps
  pointing, confidently, at nothing.

## v1.68.3
Documentation only — no code changes.

- **README and hardware guide cut down**, both languages: README −41 %, hardware guide
  −30 % by word count. Feature lists are bullets now, prose only where it earns its place.
  Tables, wiring, pin maps and commands are untouched — that is the part people come for.
- The project was getting hard to enter for a beginner. Every fact is still there; the
  paragraphs around it are not.

## v1.68.2
- **An unset allowance now falls back to the LTE stick's own limit.** With `Measured by:
  the LTE stick` the plan is already in the stick and enforced by it — retyping it here
  was busywork, and until you did, nothing could warn.
- **A counter with no allowance says so.** It showed `Used: 2.24 GB` and looked like it
  was working, while no threshold existed and the OSD could never fire. Now stated in the
  panel and flagged amber on the overview.

## v1.68.1
- **The data counter now survives a clean restart.** It was written at most every 5
  minutes and nothing flushed it on shutdown, so every `systemctl restart` — which every
  update does — threw away what had been counted since the last write. Now saved on
  shutdown too.
- **Mobile data is on the overview**, with usage, percent and which source counted it.
  It was only in the Network tab, four panels down.

## v1.68.0
- **Mobile-data budget** (Setup › Network). Set the plan's allowance; the OSD shows
  **⚠ DATA** past the configured share. An FPV stream costs 0.5–1 GB/h.
- Two sources: **the vehicle** (default, sums every metered interface — works with a phone
  hotspot too) or **the LTE stick's own billing month** (HiLink only, survives reboots).
- Not counted: the vehicle's own hotspot (that traffic is free, ~900 MB/h) and VPN
  interfaces (Tailscale/WireGuard/ZeroTier — they leave again through the real uplink and
  would count twice).
- Counter persists across reboots; reset by hand or on the plan's day of month.
- **Fix:** every tick box on the setup page was stretched across its label (194–477 px
  instead of 13) — `input { width: 100% }` inherited by a checkbox in a row-flex label.
- Status strip: **Vehicle** and **Driver** merged into one cell, so the grid is 4×2 again.

## v1.67.0
- Status strip: **Link gaps** — failsafe episodes since the connection began, plus the
  longest the vehicle ever waited for a control frame. A watchdog trip lasts one control
  tick and the bars snap back unread; the 2 Hz blackbox misses it too.
- Amber once the worst gap passes 60 % of the vehicle's watchdog timeout, red after an
  actual episode. Rising edges, not ticks; the opening moment of a connection (no frame
  accepted yet) is not counted.
- Measured indoors over LTE: 13 gaps past 300 ms per minute at 0 % packet loss. Latency
  was fine, jitter was not, and nothing said so.

## v1.66.1
- Setup › Sensors now shows **which charge counter is actually running**. `auto` states a
  wish: it silently falls back to Pi integration when the primary current channel is not
  an INA228, and the mAh keep coming either way — only their accuracy changes. Also on the
  overview as a `· counter` row. It used to be visible only in an OSD tooltip and a
  startup log line.
- **Measured idle draw** documented (`HARDWARE.md` §2.3): Pi 4B + CSI camera + LTE stick +
  PCA9685 + GPS, motor stopped = **0.7–1.0 A at 7.2 V**, i.e. 1.4–2 A behind a 5 V
  regulator. "5 V / 3 A" is the floor, not headroom.

## v1.66.0
- **The vehicle reports its own condition**, ported from YonderGate and trimmed to what a
  vehicle can act on: SoC **temperature**, **load**, **uptime** and **free card space**,
  on the overview under the system status. Each is there because it explains a failure
  that otherwise reads as a bug in this software — the Pi encodes H.264 in a sealed hull,
  and from 80 °C the firmware clamps its clock, so video and control get worse *together*;
  the control loop shares the CPU, so a load spike is the honest cause of round-trip
  jitter; a full card cannot take an update.
- **The clock is reported where it actually breaks something.** A Pi has no
  battery-backed clock: with no network at boot it starts in the past, and `git pull` then
  fails with a **certificate error that never mentions the time**. That line now sits
  above *Check for updates*, with the vehicle's own clock compared against yours — and it
  only appears when there is something wrong with it. No DS3231 and no NTP-server editor:
  the vehicle only needs the time when it already has internet, and then NTP just works.
- Readings live on `/api/health` at a 30 s poll, not on the 3 s status — each one costs a
  file or a process on a box that is also driving servos.
- **Fixed while porting: an unreadable sensor read as a healthy one.** `Number('')` is 0,
  not NaN, so an empty temperature file came back as 0 °C, an empty loadavg as an idle
  0.00, and an empty uptime as a box that booted this instant. Fixed in both projects.

## v1.65.3
- **Fixed: current and mAh were near-invisible in the OSD under the light theme.** The
  video stage keeps the dark palette in both themes, but it only ever re-declared the
  tokens — and CSS inheritance passes the **computed** colour down, not the `var()` that
  produced it. The OSD spans that carry no class of their own (current, mAh) therefore
  arrived with the page's ink, which the light theme had turned dark, and landed
  dark-on-dark over the video; voltage and temperature were fine only because they
  hardcode their colour. The stage now states its text colour instead of inheriting one.
  Nothing changes in the dark theme, where the two colours were identical.
- README screenshots retaken with the fix in them.

## v1.65.2
- **All eight groups of Setup › Controls now start folded**, not just Safety: return-home
  budget, stick feedback, voice callouts, auto-disarm, action bindings, low-battery
  warning and blackbox logging, each with its explanation. The panel is eight headings
  instead of six screens; the *Ground app* panel below it is unchanged.
- **Folding never hides state or a warning.** *Auto-disarm on reconnect* carries its
  ON/OFF as a badge in the heading, blackbox logging shows *recording* there while it
  runs, and the two ⚠ notes about a forced auto-disarm sit outside their group — a
  warning you have to unfold is not a warning.

## v1.65.1
- **Setup › Safety starts collapsed** in the ground app. Three settings you pick once per
  model sat on top of the six groups below them; folded away, the whole Controls panel
  fits on one screen. The heading stays the eyebrow the other groups use, so nothing
  looks out of place — it is the same heading, now with a chevron.

## v1.65.0
- **Light is now the default.** Dark is still one click away in Setup › Design, and both
  the setup page and the ground app stamp the choice before their first paint, so nothing
  flashes the wrong palette on the way.
- **The tab strip wraps instead of scrolling.** Seven tabs are wider than the 640 px
  column, and a mouse wheel does not scroll a horizontal box — on a PC the **Design** tab
  was simply unreachable. It now wraps to a second row; only under 520 px, where a swipe
  works and vertical space is the scarce one, does it stay a single scrolling row.
- **The ground app's Setup got the same collapsible hints as the vehicle's.** Eleven long
  explanations — the endpoints batch write, both hold times, the return-home budget, stick
  feedback, voice callouts, auto-disarm, action bindings, the low-battery thresholds,
  blackbox logging, the curve editor and the OSD sensor list — are now a one-line summary
  you can unfold. The takeaway stays visible, the reasoning is a click away, and the short
  one-liners were left alone.

## v1.64.0
- **A light theme, chosen on the vehicle.** Setup › **Design** offers exactly two looks —
  dark (the default, and what you want next to live video) and light for a bright bench.
  The choice lives on the vehicle and is pushed down the control link, so the setup page
  and the ground app can never disagree, and switching repaints a **connected** control
  app within a second instead of waiting for its next reconnect. The ground app has no
  switch of its own on purpose; it caches the last answer so a cold start does not flash
  the wrong one.
- **The video overlay stays light-on-dark in both.** The OSD is drawn on the picture, not
  on the page: the light theme's deeper inks are chosen for contrast against white and
  would sit at 3:1 over video, with the FAILSAFE badge the first thing to go. The video
  stage keeps the dark palette as its own island.
- **Fixed: `--bad` and `--go` were used in eight places and defined nowhere.** An
  unresolvable `var()` is invalid at computed-value time, so the "NO SENSOR" badge had no
  background, the REC badge and toast lost theirs, and `.osd-warn` inherited its colour
  instead of turning red. Found while building the second palette; the test suite now
  fails if any token the stylesheet uses is undefined.

## v1.63.0
- **The setup page is six tabs instead of one long column.** Fourteen panels stacked on
  top of each other meant everything was on screen at once and nothing was findable:
  **Overview · Network · Remote access · Sensors & outputs · Camera · GPS**. Each tab is
  a URL (`…/setup#gps`), so a step in the hardware guide can be linked to the panel it
  talks about, and the hash survives the reload after a service restart.
- **Overview answers "is everything there?" on one screen.** Next to the system status it
  now carries one line each for **sensors** (source, channel counts, the live reading and
  consumed mAh), **GPS** (source, fix, and the sentence count that proves a receiver
  indoors, where there will never be a fix) and **cameras** (how many, and what each one
  is). Every one of those lines jumps to its own tab. The firmware's **5 V rail** verdict
  appears there too — silently while it is healthy.
- **The long explanations are collapsed.** Twenty paragraphs that used to sit open under
  their fields are now one-line summaries you can unfold: the takeaway stays visible, the
  detail is a click away. Nothing was deleted.

## v1.62.2
- **The demo boat goes single-stick as well** (mode 2): rudder and throttle under one
  thumb, same as the car. Its throttle stays **ratcheted** on that shared stick — the
  detent travels with the binding, so moving the axis does not quietly turn a boat's
  hold-position throttle into a spring-centred one. There is now a test for exactly that.

## v1.62.1
- **The demo boat starts on the on-screen pad too.** Same reason as the car in v1.62.0:
  the first connection to a new vehicle is a phone on its hotspot. It keeps stick mode 1,
  though — a boat's throttle is ratcheted (free detent), so rudder and throttle stay on
  separate sticks rather than sharing the car's single-stick layout.

## v1.62.0
- **The demo car starts on the on-screen pad.** Its default was keyboard, so the first
  thing anyone does with a new vehicle — join its hotspot from a phone and try to drive —
  led to an empty control surface and a trip through the binding editor. Both axes sit on
  one stick (mode 2), which is all a car needs.
- **Picking a sensor now fills in values instead of empty fields.** Choose `ina228` and
  the shunt (0.002 Ω, what the common 85 V breakouts carry, marked `R002`), max current
  (20 A) and the shunt range come with it — only where nothing was entered yet, so it can
  never overwrite what you typed. Same for the other INA parts, with the 0.1 Ω the small
  INA219/3221 modules use.
- **The hardware guide documents a reference build** rather than a menu of options: INA228
  on 0x40, PCA9685 moved to 0x41, 2 mΩ shunt, GPS on `/dev/serial0`, touch control — the
  configuration this project is actually tested against, with the reasoning for each
  choice. GPS gets an *Optional parts* entry (Adafruit Ultimate GPS v3 as the reference
  receiver), and both READMEs say the demo car is touch-first.
- **The shunt field is documented as a calibration factor**, not a datasheet value: shunt
  tolerance and terminal resistance land in the measurement, so feed a known current and
  enter `old shunt × reading / true current`. On the reference build that turned a nominal
  0.002 Ω into 0.00206 Ω — a 3 % error no amount of resolution would have found.
- The test suite now checks that the two hardware guides keep the same structure, the way
  it already did for the two READMEs.

## v1.61.1
- **The other silent serial trap: `/dev/ttyAMA0`.** On a Pi 3/4/5 that is the PL011, and
  it belongs to the Bluetooth chip — a GPS configured there opens without an error and
  never delivers a byte, which looks exactly like bad wiring. Setup › GPS now resolves
  what `/dev/serial0` actually points at, says so when the configured device is a
  different UART, and offers a **Use /dev/serial0** button. New configs default to
  `/dev/serial0`; existing ones are warned about rather than silently rewritten, because
  a Pi with `dtoverlay=disable-bt` genuinely does use ttyAMA0.

## v1.61.0
- **A wired GPS no longer needs a terminal.** Raspberry Pi OS pins a login console to the
  very UART a GPS receiver wants, and `install.sh` only ever enabled the hardware — so
  every wired receiver shared its line with kernel messages and delivered shredded
  sentences, which is indistinguishable from bad wiring. Setup › GPS now checks both
  conditions and offers **Free the serial port for GPS**: it writes `enable_uart=1`, drops
  the console token from cmdline.txt (backups as `*.yonderrc-bak`), stops the getty and
  says a reboot is due. Pure text handling in `system/serial.ts`, unit-tested — cmdline.txt
  decides whether the Pi boots at all, so it is edited token-wise and never rewritten.
- The installer does the same on a fresh install (`do_serial_cons 1` plus disabling the
  getty units), with a fallback message for raspi-config versions that lack the call.
- **GPS bring-up works indoors now.** The panel counts the NMEA sentences arriving and
  shows the satellites *in view*, separately from the fix — because a receiver wired up at
  a desk will never get a fix, and "no fix" then says nothing about the wiring. Sentences
  ticking up with 0 satellites in view means the cable, the baud rate and the port are
  right. `GET /api/gps` carries it as `link`.
- Serial device default is **/dev/serial0** everywhere now: the alias always points at the
  UART that is actually on the header, whichever one the firmware mapped there.

## v1.60.2
- **A running PCA9685 made itself unidentifiable.** The driver's init wrote a bare 0x00
  to MODE1, which also clears the ALLCALL bit — so the chip stopped answering on 0x70,
  and 0x70 is the only signature it has (no ID register). *Detect hardware* named it
  before the driver started and showed a blank "unknown device" afterwards, on the very
  vehicle where it was working. The driver now keeps all-call enabled, which is the
  chip's own reset default.
- **And a fallback for chips whose all-call was cleared by something else**: MODE2's
  reserved bits plus a valid PRE_SCALE identify a PCA9685 well enough to name it, and
  the guess says which PWM frequency it is running at. Explicitly unconfirmed — it is a
  family resemblance, not an ID.

## v1.60.1
- **The setup form showed the running driver, not the saved one.** `GET /api/config`
  answered from the live config, but driver, address, bus, name, watchdog and throttle
  channels are only read at startup — so reloading the page after saving showed the old
  values back, exactly as if the save had been dropped. It now answers with what was
  saved, reports the running driver separately, and says so in one line: *"Saved, not
  applied: the vehicle is still running driver X @ 0x40. Restart to apply."* Found on the
  real vehicle: a PCA9685 physically moved to 0x41 while the driver still addressed 0x40 —
  which means the servo driver was writing onto the current sensor.

## v1.60.0
- **The I²C scan now asks the chips what they are.** 0x40 is the factory address of the
  PCA9685 *and* of every INA2xx, so "0x40 — PCA9685 or INA2xx" was the best the setup page
  could say. It now reads the ID registers (`i2ctransfer`, pure parsing + identification in
  `system/detect.ts`) and names the part: INA228/229/237/238 and INA226/260/3221 by
  manufacturer + die id, MCP9808, TMP117, BMP280/BME280 by their chip ids, and the PCA9685
  — which has no ID register at all — through its all-call address 0x70. A ✓ marks what was
  read back; everything else stays an honest guess from the address.
- **Two chips on one address is now called out**, instead of silently returning nonsense
  to whoever asks first.
- **The PCA9685's address is editable in the browser.** It used to be `YRC_I2C_ADDR` only —
  an env var in a systemd unit, i.e. an SSH session on a vehicle that may be reachable only
  over its own hotspot. It is a persisted setting now, with a field under *Vehicle
  configuration* and a **Restart vehicle service** button right there, because the driver is
  built at startup.
- **Voltage and current channels got their I²C address field**, the one thing the telemetry
  form was missing: the reader had always defaulted to 0x40 with no way to say otherwise,
  so a sensor on any other address was simply invisible.
- **Use these addresses** fills what was detected into the driver and telemetry forms —
  and saves nothing, so a wrong guess costs one keystroke to correct.
- Hardware guide: INA on **0x40**, PCA9685 moved to **0x41**, is now the documented pairing,
  with the INA breakout's logic side (VCC on 3V3, ALE unconnected) as a table, how to read
  the shunt off the board (`R001` = 0.001 Ω) and what it caps the measurement at.

## v1.59.0
- **Fresh screenshots.** The four in the READMEs were from v1.20.4 and v1.3x — old enough
  to show an OSD and an arm button that no longer exist. Retaken against the simulator with
  the current build: the FPV overview with the full OSD, the touch pad, the channel monitor
  and the setup page. The phone shot stays as it is; it is a real photo of a real phone and
  cannot be reproduced headlessly.
- The touch screenshot now shows what actually happens: a car in stick mode 2 drives from
  **one large stick**, not two small ones, and the caption says why.
- **The READMEs had fallen behind the code.** Nothing about picking a CSI camera module,
  rotation and mirroring, focus and tuning files, "no camera" as a supported setup, video
  starting on low, stick feedback, the power warning or the shutdown button. All of it is
  in now, in both languages.
- **The hardware guide says the thing that cost a day.** Servo V+ does not belong on the
  Pi's 5 V pins — they sit on the input rail with no fuse, and the brownout that follows
  presents as a software crash, not as a power problem. Plus what a real supply looks like,
  and that the vehicle now checks this itself.

## v1.58.3
- **The setup page's panel headings had no space beneath them.** It only showed under
  *System*, where the heading is followed straight by a row of buttons — everywhere else a
  label or a `.msg` follows, and those bring their own margin, which hid it. Fixed on
  `.eyebrow` rather than on the button row: the next block to sit under a heading would
  have had the same problem. It collapses with the following margin where there is one, so
  no other panel moves.

## v1.58.2
- **Text selection is off by default in the ground app now, instead of being switched off
  one element at a time.** v1.58.1 stopped the Light button from highlighting the "Speed"
  caption below it — and double-tapping Horn then reached past the whole pad to select
  "Control via WebRTC data channel" underneath it. That is the shape of the bug: iOS does
  not stop at a `user-select: none` element, it starts the selection in the nearest
  selectable text *around* it, so every fix that names one more element loses the same way.
  The default is now the other way round for the whole app — this is a control surface
  driven with thumbs, not a document.
- Switched back on for the two things worth it: **prose** (`.note` — the explanatory
  paragraphs) and **values worth copying into a terminal** (`.mono`), plus a `.selectable`
  opt-in and every input. Nothing that should be readable, copyable or typeable stopped
  being so.

## v1.58.1
- **Holding a pad button no longer highlights the label underneath on iOS.** The buttons
  themselves were already marked non-selectable, which is not enough: iOS does not stop at
  a `user-select: none` element — a long press there starts a selection in the nearest
  selectable text *around* it. Holding **Light** for its hold time therefore selected the
  **Speed** caption below it, complete with the callout menu. The whole driving surface is
  now non-selectable (`.controlpad`), because there is nothing in that panel worth
  selecting — it is all button captions. Inputs are excluded, so nothing that should be
  typeable stops being typeable.

## v1.58.0
- **Shut down vehicle**, next to Reboot in Setup › System. Pulling the plug on a Pi is how
  an SD card ends up unreadable; this parks it first. The confirmation says the part that
  matters — nothing brings it back but a power cycle, so do it when you can reach the
  vehicle.
- **Refused while armed.** A reboot at least comes back on its own; a shutdown with a live
  throttle leaves the vehicle powered down wherever it stopped, and walking out to it is
  the wrong moment to find out the motor was still enabled.

## v1.57.1
- **The power warning is a badge now, not a banner**, and it clears itself. It sat in the
  big overlay next to BATTERY LOW, which is too loud for something you may be looking at
  for a whole drive. It is now a red `⚠ POWER` in the top badge row, next to the timer and
  GPS, blinking only while the fault is live.
- **A live fault disappears the moment the rail recovers** — nothing to acknowledge, no
  reload. That already worked, but it was hidden behind the second problem:
- **the sticky flag was making it permanent.** The firmware keeps a separate
  "under-voltage has occurred since boot" bit that it never clears until the next reboot,
  and the banner reacted to it as well. So even a vehicle whose supply had recovered kept
  warning, forever, which is how a warning stops being read. That flag now gets a
  **20-second window** from when it first appears — long enough not to miss a sag that
  happened while you were watching the road, then gone. The full explanation stays on
  hover and in Detect hardware.
- Measured while writing this, on the Pi with everything unplugged: `throttled=0x50005`
  continuously, and the kernel log alternating *Undervoltage detected* / *Voltage
  normalised*. The reading was right — the supply itself is the problem, not the servo.

## v1.57.0
- **Video starts on `low`.** What matters in the first seconds of a drive is a fluid
  picture with the least latency, not the most pixels — starting high and discovering the
  link cannot carry it costs you exactly the seconds you spend working out where the
  vehicle is pointing. Stepping up stays a deliberate act. **Auto** starts low too and
  climbs once the link has proved it can carry more, instead of opening at full resolution
  and stepping down after it has already stuttered.
- **…and the selection is now actually applied.** It was only ever sent to the vehicle when
  someone touched the dropdown, so after a page reload the panel could claim "low" while
  the vehicle streamed full resolution — the setting was cosmetic until you changed it to
  something else and back. The welcome message now carries the level the vehicle is
  serving, and the ground sends its own only when the two differ, so a matching level costs
  no go2rtc reload.
- `VideoQuality` moved into the protocol. The union was written out by hand in the vehicle
  and in the ground, which is how the two ended up able to disagree about a level in the
  first place.
- A stored preference still wins over the new default — this changes what a fresh browser
  does, not what you have already chosen.

## v1.56.0
- **The vehicle now says when its own power is failing.** `vcgencmd get_throttled` is the
  firmware's verdict on the 5 V rail, and it was going unread. A brownout mid-drive is a
  reset mid-drive, and from the ground that is indistinguishable from a software crash —
  which is exactly how it presented: video fine, then a freeze and a minute of
  "reconnecting" every time a servo was asked to move. Measured on the real Pi:
  `throttled=0x50005`, continuously, at idle.
- Pure `vehicle/system/power.ts` decodes the mask and, more importantly, **names the fix**:
  under-voltage points at servo V+ on the Pi's rail and a 5.1 V / 3 A supply; a thermal
  clamp points at airflow, because that is a different problem and must not be described
  as a supply one. A past event still gets a quieter warning — no headroom is worth fixing
  before the next drive, not after the crash.
- Shown as **⚠ POWER** in the OSD next to the battery warning, carried on the status frame
  beside the uplink signal, and put at the *top* of Detect hardware — on a Pi that is
  browning out, nothing else on that page is trustworthy either.

- **A superseded ground station could stop the new one from steering.** Connect the phone
  while the PC is connected and the PC is correctly kicked, but the phone's first session
  would not steer until it disconnected and reconnected. Control frames travel over the
  **WebRTC data channel**, which takes seconds to tear down — far longer than the
  WebSocket. The old ground kept sending during that window, its high sequence number
  landed after the new session had reset the counter to −1, and every frame from the new
  ground was then dropped as "stale". Arm and configuration kept working because those go
  over the reliable WebSocket: a connected vehicle that would not steer.
- `beginControlSession()` hands out a token that **both** transports carry, so the moment a
  new ground takes over the previous one stops being able to move anything. Two separate
  guards is how this was missed in the first place; there is now one rule in the core.

## v1.55.0
- **A radio's percentage is not a quality score** — and treating it as one put a permanent
  ⚠ SIGNAL on a link that was fine. The health model fed the signal percentage straight in
  as a 0–100 sub-score, while round-trip and packet loss each went through a curve with a
  sensible "good" and "useless" point. A HiLink stick derives its percentage from RSRP over
  −140…−75 dBm, so a thoroughly usable **−101 dBm reads as 62 %** — and 62 sat under the 70
  that means "good", making the radio the named culprit for a link with **19 dB SINR** and
  no loss.
- `signalScore(pct, kind)` gives each radio its own curve, because the two percentages come
  off different scales: **LTE** is full marks at 60 % (RSRP ≈ −101 dBm) and zero at 30 %
  (≈ −120 dBm, the edge of coverage); **WiFi** is full marks at 60 % (−70 dBm, the usual
  reliable mark) and zero at 25 % (−87 dBm). Ethernet has no signal to worry about.
- The OSD's weak-link warning and the signal label now use the same curve instead of a flat
  25 %, so the badge and the warning can no longer disagree about whether the radio is the
  problem.
- A genuinely weak radio is still caught and still named — only the definition of weak
  changed. Measured on the real stick: RSRP −101 dBm, RSRQ −7.0 dB, SINR 19 dB, 4 of 5 bars.

## v1.54.2
- **Auto quality could freeze the picture into a permanent "reconnecting".** Stepping the
  level makes the vehicle rescale the camera and reload go2rtc, which kills the current
  WebRTC stream — the connection has to be rebuilt either way. A **manual** change got
  that for free, because it moves the `quality` state the connect effect depends on: full
  teardown, attempt counter back to zero, fresh connect. An **automatic** change only
  moved `effectiveQuality`, which the effect did *not* depend on, so nothing rebuilt the
  connection. The dead stream was left to the 4-second frame-liveness watchdog, which
  reconnects on the accumulated failed-attempt count and its widening backoff — and once
  frozen, auto-quality cannot rescue itself either, because it only steps while the
  picture is playing. Picking a level by hand broke the loop, which is exactly what was
  observed.
- `effectiveQuality` is now part of the connect effect, so an automatic step takes the
  identical path to a manual one.
- The vehicle side was ruled out first: the medium rescale of a 1280×720 camera
  (844×476 at 1200 kbps) was applied and served a frame on the real Pi.
- Verified by reasoning and by the manual path already being known-good, **not** by a
  test — this is a React effect dependency, not a pure function.

## v1.54.1
- **The camera row stopped talking about the IMX519 under every other sensor.** The
  tuning-file placeholder and the note underneath were hardcoded, so an OV5647 was still
  offered an Arducam's file path and told about an autofocus algorithm it has no motor
  for. Both now follow the selected CSI module: the placeholder is that module's tuning
  file (or "none needed for this module"), and the note names the module it is about.
- **Focus controls only where there is a lens to move.** A module that names one sensor
  without an actuator says so instead of offering a Focus dropdown that does nothing;
  auto-detect and a custom overlay keep the controls, because either might turn up an
  IMX708. A focus setting already stored on a camera stays visible and editable rather
  than being hidden with its value still in the config.
- The camera rows re-render when the module selection changes, so the two follow each
  other without a page reload.

## v1.54.0
- **Rotation and mirroring per camera** (Setup › Cameras): 0° / 180° plus independent
  horizontal and vertical mirrors, for CSI and USB alike. A camera bolted in upside down
  is the normal case, not an exception.
- **It is one transform, not three options.** A 180° rotation *is* a horizontal plus a
  vertical flip, so all three settings collapse into two booleans before anything is
  emitted. That is why "180° and also mirrored horizontally" cancels on that axis instead
  of depending on the order a camera stack happens to apply two separate flags in.
- On the CSI path the sensor applies the transform (`rpicam-vid --hflip/--vflip`), so it
  is free; the V4L2 path gets an ffmpeg `-vf` filter, written without spaces because
  go2rtc splits an `exec:` line on whitespace.
- **90° and 270° are deliberately absent.** `rpicam-vid` only offers 0 and 180 — the
  sensor cannot do the others — and faking them would mean putting a transcode back into
  a pipeline that was rebuilt in v1.47.0 specifically to avoid one.

## v1.53.0
- **Switching camera module now cleans up after the previous one.** A tuning file is a
  *sensor* calibration, not a preference: swapping an Arducam IMX519 for a Raspberry Pi
  OV5647 left `imx519-af.json` on the camera entry, which hands the new sensor another
  one's colour and exposure model — silently, with a picture that looks plausible. The
  same applies to a focus mode on a camera that has no lens actuator. `reconcileCameras`
  now runs whenever a module is selected: it fills in that module's tuning file and drops
  the previous module's, and clears a focus mode the new module cannot use. Only values
  the catalogue put there are touched — a hand-entered tuning path is the operator's and
  stays. USB cameras are never touched.
- The reconciliation lives on the vehicle rather than in the setup page, so it applies
  whoever makes the change; the page just takes the camera list back from the response.
- Found by walking into it: a working IMX519 was replaced with an OV5647, and the stale
  tuning file came along for the ride.

## v1.52.1
- **Deleting every camera is now a supported way to run YonderRC**, not a broken state.
  It was broken: emptying the list left the panel holding the id of a stream that no
  longer existed, so it kept asking the vehicle for it every few seconds, forever. The
  selection is now cleared when the list is empty (`selectedCamera`), which switches the
  whole video path off — no requests, no reconnects, no error text. The FPV area stays
  dark and the OSD, telemetry, arming and controls carry on as normal. That is the setup
  for anyone who wants a plain IP/WiFi/AP receiver and drives on sight.
- The placeholder says so instead of blaming go2rtc, and Record/Snapshot grey out when
  there is no camera rather than offering a button that can only fail.
- **A camera that is gone for good no longer gets hammered.** The reconnect backoff
  stopped widening at 5 s, so an unplugged camera meant one full RTCPeerConnection plus
  ICE every five seconds for as long as the app was open — on a phone that competes with
  the 20 ms control loop. It now stays quick for the first four attempts (a blip is
  covered), holds 5 s for about half a minute, then widens to 15 s and 30 s. Recovery
  from a real blip is unchanged.
- The vehicle banner says `no cameras (fine — the ground station just stays dark)`
  instead of printing an empty list.
- **The reload log no longer lies.** go2rtc restarts *itself* in response to
  `POST /api/restart`, so it often drops the connection before answering and the fetch
  rejects — after which the vehicle printed "wrote go2rtc.yaml; start/restart go2rtc to
  apply" although the reload had happened. It now asks go2rtc what it is serving before
  claiming anything, and only says that when the streams really did not change.

## v1.51.0
- **The on-screen stick gets the space it deserves.** Stick modes 2 and 3 put both axes
  on one stick, which left the other half of the row empty while the stick you actually
  use stayed 128 px. It now grows to `clamp(128px, 62vw, 300px)` whenever only one stick
  is rendered — on a phone roughly twice the travel for the same thumb, which is the
  difference between thumb-tip and thumb-width precision. Landscape on a phone scales off
  the height instead, since that is the scarce axis there. Base, knob and travel all come
  from one `--joy-size` variable, so it is the same stick, just bigger; the knob's travel
  used to be a hardcoded 44 px that only fitted the 128 px base.
- Keyed on **how many sticks are shown**, not on the mode number, so a custom binding that
  leaves one side empty gets the same benefit.
- **Stick feedback at the centre and the rim** (Setup › Controls, off by default). Each
  boundary fires once per crossing, with hysteresis on both — holding the stick against
  the stop stays quiet instead of chattering.
- **An iPhone cannot vibrate from a web page.** Safari has no Vibration API and no setting
  changes that, so a phone-only "rumble" cannot be built. What does work on iOS is a very
  short Web Audio click, and that is the default channel; vibration is offered where the
  browser actually has it (Android) and greys out where it does not, rather than being a
  switch that silently does nothing. A connected gamepad is rumbled through
  `vibrationActuator`. The click is deliberately separate from `beep.ts`, whose tones are
  alerts meant to be heard over wind and must not be competed with.

## v1.50.0
- **The update button no longer turns a configured vehicle back into a simulator.** The
  native driver modules (`i2c-bus`, `pigpio`, `serialport`) are optionalDependencies, and
  the update runs `npm install --omit=optional` — which prunes them. `install.sh` has put
  them back from the recorded `hardwareDeps` since v1.39.0, but the **in-app update never
  did**, so pressing *Update & restart* silently removed the PCA9685 driver and the INA
  sensors until someone reinstalled them by hand. `updateSteps` now appends one restore
  step per recorded module, after the pruning install, through the same allowlist as
  `hwDeps.ts` (`restorableHwDeps`) — the value comes from a config file and ends up in an
  npm command line.
- **The PCA9685 driver only writes channels that changed.** Every channel is its own I²C
  transaction; sixteen of them nearly fill the 20 ms control tick, and `VehicleCore` then
  drops the next one — visible on real hardware as a steadily climbing
  `[core] driver write still busy — N ticks skipped`. Driving a car moves one or two
  channels per tick, so the bus traffic drops accordingly. Comparison is on PWM **counts**,
  not µs, since two µs values that round to the same count are the same pulse. A channel
  the caller has no value for stays untouched, exactly as before, and a failed write
  clears the cache so the next tick sends everything again — the cache can never claim a
  value the chip did not receive.

## v1.49.1
- **"Reboot required" now means it.** v1.49.0 raised the flag whenever the *text* of
  config.txt changed, so selecting a module and then selecting the one that is already
  running left a reboot notice standing for a change the firmware would not notice.
  YonderRC now records the effective camera configuration the system actually booted with
  — keyed by the kernel boot id, so it survives a service restart — and compares against
  that. Switching away and back is silent; a real change is still flagged.
- The answer to *Select module* says which of the two happened instead of always
  promising a reboot.

## v1.49.0
- **Pick the camera module in the setup page instead of over SSH.** A new *CSI camera
  module* panel above the camera list writes `camera_auto_detect` and `dtoverlay=` into
  `/boot/firmware/config.txt`, then says *Reboot required* until the Pi has actually
  booted with the change — with a **Reboot now** button next to it. The catalogue covers
  auto-detect, the four official sensors forced explicitly, Arducam IMX519 / 64MP Hawkeye
  / OV64A40 Owlsight / Pivariety, and *Other module* for anything else.
- **The choice is a property of the Pi, not of a stream.** It deliberately did not become
  a fourth entry next to `sim`/`rpicam`/`usb`: the stream type says how the picture is
  produced (and an Arducam is produced by `rpicam-vid` exactly like any other CSI camera),
  while the overlay is one setting for the one camera connector. Putting it in the stream
  list would let you express two conflicting overlays for hardware that has one port —
  and "arducam" alone could never say *which* Arducam, since each needs a different
  overlay.
- Selecting a module that ships a tuning file fills it into the `rpicam` cameras that have
  none, so the IMX519's autofocus works without knowing any path.
- **Nothing is rewritten blind.** One backup is kept as `config.txt.yonderrc-bak`,
  competing lines are commented out rather than deleted, our block is marked and replaced
  as a whole on the next change, and it is appended under its own `[all]` so it can't land
  in a `[cm4]`/`[pi5]` section. A custom overlay name must pass a syntax check *and* exist
  as a `.dtbo` on that Pi.
- Reboot detection compares the kernel boot id recorded at write time against the current
  one, so it survives a service restart and clears exactly when the Pi has really rebooted.
- **`Detect hardware` now explains the boot config**, which is what was missing: it used
  to advise adding a `dtoverlay` even when the actual problem was that
  `camera_auto_detect` had been switched off for a module that is no longer attached.
- Fully usable in the simulator — `SimSystem` keeps its own config.txt, including the
  reboot-pending state and the same overlay-name validation as the real one.

## v1.48.1
- **The IMX519 focus map is now measured instead of assumed.** v1.48.0 mapped 0 dioptres
  to the AK7375's rest position — and on the real module that is the *blurriest* setting,
  not infinity. Sweeping the actuator's 10-bit range against a distant scene peaks at code
  ≈ 597, so the shipped tuning anchors 0 dioptres there: `"map": [0.0, 597, 10.0, 1023]`.
  `focus: manual` + `lensPosition: 0` is now the sharp far setting a vehicle wants.
- Verified through the live stream on a Pi 4B: the same frame went from 26 kB to 40 kB and
  the scene outside the window became legible.

## v1.48.0
- **Focus control for CSI cameras** — the reason an Arducam 16 MP IMX519 streams a
  permanently soft picture even after v1.47.0. Its AK7375 lens actuator is bound by the
  kernel and visible as a v4l-subdev, but Raspberry Pi's stock `imx519.json` tuning has
  no `rpi.af` algorithm, so libcamera answers every focus request with *Could not set
  AF_MODE - no AF algorithm* and the lens simply stays where it rests.
- `CameraCfg` gained `focus` (`off` / `manual` / `auto` / `continuous`), `lensPosition`
  in dioptres and `tuningFile`; Setup › Cameras shows the three fields for `rpicam`
  cameras. Default is `off`, i.e. exactly the previous behaviour.
- **`provisioning/tuning/imx519-af.json`** ships Raspberry Pi's tuning with an `rpi.af`
  block appended, mapped to the AK7375's full range; `install.sh` copies it to
  `/var/lib/yonderrc/tuning/`, outside the checkout, so an update can't clobber it.
  Verified on a Pi 4B with the real module: without the file `--autofocus-mode` is
  refused, with it `auto` finds focus and `manual` + `--lens-position` holds it.
- On a moving model **`manual` at 0 dioptres beats `continuous`**, which re-hunts on every
  scene change — the setup page says so next to the field.
- The tuning path is validated like the V4L2 device: absolute, no spaces, `.json`, no
  `..` — go2rtc splits `exec:` on whitespace, so a path with a space would quietly become
  two arguments.

## v1.47.0
- **The Pi camera stream never worked on current Raspberry Pi OS.** Two independent bugs,
  both found on real hardware (Pi 4B, Bookworm): the generated go2rtc source called
  `libcamera-vid`, but Bookworm renamed the tools to `rpicam-*` and dropped the old
  symlinks — go2rtc logged `executable file not found in $PATH` and the ground station
  showed connecting → black → reconnecting. `detectRpicamBinary()` now resolves the real
  name at startup, `rpicam-vid` first, `libcamera-vid` for Bullseye.
- **The second bug would have survived the rename.** The source was
  `libcamera-vid … -o - | ffmpeg … -f rtsp {output}`, but go2rtc runs `exec:` **without a
  shell** (`shell.QuoteSplit` + `exec.Command`), so the `|` and everything after it went
  to the camera binary as literal arguments. Without `{output}` go2rtc reads the process
  stdout and sniffs the format itself, and raw H.264 Annex-B is exactly what `rpicam-vid`
  writes — so ffmpeg is gone from the `rpicam` path. One process less, no transcode, less
  latency, and it works on a Pi 5 with no hardware encoder.
- **Detect hardware told the truth about cameras for the first time.** It ran the same
  hardcoded `libcamera-hello` and, finding nothing, fell back to listing every
  `/dev/video*` — on a Pi with no camera at all that is `video10`…`video31`, the V4L2
  codec/ISP nodes, so the page claimed fourteen cameras. It now tries `rpicam-hello`
  first, counts only real capture nodes (`video0`–`video9`), and when there is nothing it
  says what to change: ribbon cable and CAM-vs-DISPLAY port, or `camera_auto_detect=0`
  plus an explicit `dtoverlay=` for sensors outside the auto-detect set (Arducam IMX519 /
  64MP / Pivariety, OV64A40).
- Pure helpers in `vehicle/system/cameras.ts` (`parseCameraList`, `captureNodes`,
  `explainNoCamera`) with tests; the camera binary is sanitised like the V4L2 device path.
- Both hardware guides gained a troubleshooting note for a black `rpicam` stream.

## v1.46.3
- **A test now fails if the two READMEs drift apart.** `README.md` and `README.de.md` must
  have the same sections and point at each other; the German one must link the German
  hardware guide. It cannot judge a translation, but it catches the thing that actually
  happens — a section added to one of them and forgotten in the other.
- **CLAUDE.md says the rule out loud**: both language versions are edited in the *same
  commit*, always. A translation that lags is worse than none — it states as current
  something the project stopped doing, and the reader has no way to tell which of the two
  is the lie.
- Same guard and same wording in **YonderGate** (v0.12.12), which just gained its own
  `README.de.md`.

## v1.46.2
- **WireGuard can now be set up by hand, not only from a file.** Uploading the `.conf`
  is perfect when there is one — a FritzBox hands you a file. It is useless when there is
  not: a peer somebody set up for you, a provider that shows the values on a web page, a
  key you generated on the Pi. Then you had seven pieces of information and nowhere to
  type them. Setup › Remote access › WireGuard now offers both, on a radio button.
- **One stored representation either way.** The fields are turned into the `.conf` and
  that stays the source of truth — `wg-quick` reads a file regardless, and keeping a
  second parallel copy in the config would be a drift bug waiting for the day the two
  disagree. The form is filled by parsing the stored file back, which has the pleasant
  side effect that **a `.conf` you uploaded can afterwards be edited field by field**.
- **What the form cannot hold, it says so about** rather than dropping quietly: a second
  `[Peer]`, or directives like `MTU` and `PostUp`. The panel names them and tells you to
  stay on the file if you need them.
- **The two secrets never come back out of the box.** `/api/remote` answers without the
  API secret so the page always loads, and the vehicle's onboarding hotspot is open by
  default — returning the private key there would hand anyone in Wi-Fi range the VPN.
  The form shows them as stored and leaves the boxes blank; blank means keep.
- **Every refusal names the fix**, because this is read on a phone: a missing private key
  says `wg genkey`, a bad endpoint says what host:port looks like, a stray preshared key
  says `wg genpsk`. A bare address like `10.0.0.2` is accepted and written as `/32`, since
  that is what people are told to type.
- **Keepalive defaults to 25 on purpose.** Behind carrier NAT a tunnel without it works
  until the first idle minute and then quietly stops carrying anything inbound.
- Identical in **YonderGate** (v0.12.7): same module, same endpoint, same panel — the two
  repositories differ only in the word they use for the box.
- 772 tests (33 new): key and endpoint shapes, the round trip through a conf and back, a
  foreign file with lower-case keys and comments, and the redaction.

## v1.46.1
- The origin gate from v1.46.0 now also reads **`Sec-Fetch-Site`**, which browsers send
  on every request — including the ones that carry no `Origin` at all, like an `<img>`,
  a `<script>` or a plain form. Those cannot read an answer, but they can still make the
  vehicle do something, and the Origin rule alone would have waved them through. Anything
  a page elsewhere caused is refused; curl and scripts are unaffected. Brought back from
  YonderGate, where the same request can switch a relay.

## v1.46.0
A review pass over the whole repository — protocol, vehicle, ground, desktop — in the
same spirit as the one on YonderGate. Five findings, all fixed here. Nothing needed
hardware to find, and nothing found needed hardware to fix.

- **Fixed: a web page could arm your vehicle.** The API secret is off by default and
  WebSockets ignore CORS entirely, so any site the operator happened to open — while
  their phone was on the vehicle's own hotspot — could open a control link to
  `192.168.4.1:8080` and arm it, or POST to the setup API (factory reset, a servo sweep,
  a camera or WiFi change, a restart). The vehicle now looks at **where the page itself
  came from**: no `Origin` at all (curl, scripts, the tests), `file://` (the desktop
  app), a private, loopback, `.local` or Tailscale address, or the vehicle's own address
  are accepted; a page from the public internet is refused with HTTP 403 or WS close code
  **4003**, unless it presents the API secret. Reads are untouched, so the setup page
  always opens. This also defeats DNS rebinding, because the attacking page keeps its own
  origin even once its name points at the Pi.
- **Fixed: two ground stations could drive at once.** Nothing enforced a single control
  link, and the vehicle resets its sequence tracking for each new connection — so a
  forgotten tab on a phone in someone's pocket and the operator's real session would both
  be sending stick frames, at 50 Hz, last one wins. Reconnecting has to keep working
  (that is the normal case after a link loss), so the **new session takes over** and the
  old one is closed with code **4002** and told exactly what happened, instead of the two
  of them trading the vehicle every second.
- **Fixed: a stalling driver could interleave two frames on the same bus.** `setInterval`
  does not wait for an async callback, so an I2C bus holding the line or a full serial
  buffer got a second `writeChannels` on top of the first. Two interleaved frames is not
  a slow servo, it is a corrupted one. A tick that arrives while a write is still running
  is now skipped — the next one is 20 ms away and carries fresher values than a queue
  would — and a stalling bus says so in the log once a second.
- **Fixed: a busy port killed the vehicle service** with an unhandled error event and a
  stack trace. Under systemd that is a restart loop with no explanation in it. It now
  says which port is taken and how to move, then exits cleanly.
- **Fixed: the driver fallback quietly changed a safety setting.** When a real driver
  fails at boot the service falls back to sim so the setup UI stays reachable — but it
  rebuilt the core without `disarmOnReconnect`, so a vehicle type configured not to
  auto-disarm on reconnect got the default back until the ground pushed its config again.
- Both language versions of the hardware guide document the new trust rules, and the
  troubleshooting table explains close codes 4002 and 4003.

## v1.45.3
- **The WiFi country can be changed after it has been set.** The field only appeared
  while something was broken — once a country was in force, the block disappeared and
  the only way to correct it was an SSH session. It is a regulatory setting that decides
  which channels and what transmit power the radio may use, so it has to stay editable:
  a vehicle that crosses a border needs it changed, not re-provisioned.
- The row now always shows the country in force, the field is pre-filled with it (not
  just with the suggestion), a short list of common codes is offered, and the button
  says what it will do — *Apply country* when the radio is healthy, *Enable WiFi radio*
  when it is blocked. There is **no built-in default**: the suggestion comes from the
  Pi's own locale or timezone, and nothing is set until you press the button or the
  hotspot repairs a missing country by itself.

## v1.45.2
- **Fixed: "Link lost" was announced for a link that never existed.** Open the ground app,
  don't press Connect, and two seconds later the voice reported an outage — of a
  connection you never had. Reported as "it says Link lost every time I switch from Setup
  to Drive", which is the same bug seen through the browser: speech is held until the page
  has had a user gesture, so the callout queued at startup only became audible at the next
  tap — and the tap looked like the cause.
- The link voice now remembers whether a link ever existed in this session and stays
  silent about losing one that did not. Everything else is unchanged: a real outage is
  still announced after the 2 s grace, its recovery still only if the loss was announced,
  and **failsafe is still immediate**.
- Eight new assertions, including a full minute of ticks with no connection ever made,
  proving silence — and the same disconnect announced once a connection has existed.

## v1.45.1
- **The setup page shows its version, the same way the control app does.** The header now
  reads `YonderRC · Setup  vehicle · v1.45.1` next to the control app's
  `ground · v1.45.1` — so it takes a glance, not an investigation, to see whether both
  halves are on the same build.
- **The version is read from `package.json` instead of being hardcoded.** The vehicle
  banner had its own copy of the string, which is one more thing to forget on release
  day; banner, setup header and the update check now all come from the same source, and a
  test fails if the ground masthead falls behind.
- **Fixed: `install.sh` did not apply unit changes to running services.** `enable --now`
  starts what is stopped but leaves a running service on its OLD unit, so a changed
  `ExecStart` or `Environment=` only took effect at the next reboot — exactly what
  happened with v1.45.0's new go2rtc path. The installer now does a `try-restart` on
  go2rtc and the vehicle service.

## v1.45.0
- **The generated video config moved out of the git checkout.** go2rtc's config is
  written by the vehicle from your camera settings, and it lived at
  `docker/go2rtc.yaml` — *inside the repository*. Every vehicle that had ever started
  therefore had a modified checkout, which is what the update button kept tripping over.
  It now lives at **`/var/lib/yonderrc/go2rtc.yaml`**: `yonderrc-vehicle.service` points
  `YRC_GO2RTC_CONFIG` there and `go2rtc.service` reads the same path.
- **`install.sh` migrates it**: it creates the directory, copies an existing
  `docker/go2rtc.yaml` across so go2rtc keeps its streams, and restores the checkout.
  Because this changes systemd units, it takes **one full installer run** — the update
  panel already flags that when `provisioning/` changed.
- A regression test now reads both unit files and asserts they name the **same** path.
  Getting that wrong would have the vehicle write a config go2rtc never reads, which
  stays invisible until the cameras are dark.
- Vehicles that have not run the installer yet keep working exactly as before, and the
  updater still treats the old in-repo path as a generated file it may discard.

## v1.44.2
- **Fixed: every real vehicle reported "local changes".** Two reasons, both ours.
  `docker/go2rtc.yaml` is **tracked in git and rewritten by the vehicle** from the camera
  settings at every start — so the checkout is modified on any vehicle that has ever run.
  And the check counted **untracked** files as changes, which they are not: a running
  vehicle always has some (its own config, logs), and they never stand in the way of a
  fast-forward.
- Untracked files are ignored now, and files the vehicle generates itself are recognised
  as such and **discarded before the pull** — they are written again on the next start,
  so nothing is lost. `yonderrc-config.json` is git-ignored too, so a human `git status`
  stays readable.
- **The check is no longer stricter than git.** It used to refuse on any local change;
  git only refuses when the incoming update touches the *same* file. Measured on a real
  clone: a modified `docker/go2rtc.yaml` did not stop `git pull --ff-only` at all. So the
  update now blocks on that overlap alone, and merely mentions local changes it does not
  affect.

## v1.44.1
- **Third attempt at git's ownership block, and this time with the actual path.** The
  repo root is derived from a URL and therefore ends in a slash — `/opt/yonderrc/`. git
  compares `safe.directory` literally, so the exception the vehicle wrote never matched
  the directory git was complaining about. It went unnoticed because the git here accepts
  both spellings while the Pi's does not. The path is normalised now, and the throwaway
  config lists **both spellings plus `*`**.
- The wildcard is safe in this specific place: that config file reaches git only through
  `GIT_CONFIG_GLOBAL` on the vehicle's **own** invocations. It never touches the
  operator's git configuration and never applies to any other command.
- **If it still fails, the message now says what was tried** — which file was written and
  which path was declared safe — so the next report carries the information instead of
  costing another round.
- Verified end to end with the ownership block forced on and `$HOME` removed: the check
  completes, where the same repository refuses every plain git command with exit 128.

## v1.44.0
- **Fixed (for real this time): the update check still refused the checkout.** git only
  honours `safe.directory` from **protected** configuration — system or global — and
  never from `-c` on the command line, which is what v1.43.2 used. On a newer git that
  flag happened to work, which is exactly why it shipped; on the Pi's git it changed
  nothing. The vehicle now hands git a **global config file of its own**
  (`GIT_CONFIG_GLOBAL`), which is honoured, needs no `$HOME`, and leaves nothing behind
  but a file in `/tmp`.
- Verified end to end by forcing the exact condition
  (`GIT_TEST_ASSUME_DIFFERENT_OWNER=1`): plain git fails with `dubious ownership`, exit
  128, while the vehicle's own update check completes and reports versions on the same
  repository, with `$HOME` removed for good measure.
- **The update source is a field now.** Two inputs under *Update source* take a git
  remote name or a full URL plus a branch, defaulting to this vehicle's `origin` / `main`
  — so a fork or a test branch (`https://github.com/you/YonderRC.git` / `experiment`)
  needs no code change. The check reports FETCH_HEAD, so a custom source behaves exactly
  like the default, and a non-default source is shown in the panel so nobody wonders
  where an update came from.

## v1.43.2
- **Fixed: the update check's self-repair repaired nothing.** v1.43.1 answered git's
  "dubious ownership" by writing `git config --global --add safe.directory …` and
  retrying — but `--global` resolves through `$HOME`, and that is not something a
  systemd service can count on. The write failed with `fatal: $HOME not set` while the
  result was ignored, so the vehicle helpfully reported the same error again.
- **Every git call now carries `-c safe.directory=<checkout>` instead.** No config
  write, no `$HOME`, no state left on the machine — and it works on the first press.
  Verified by forcing the exact condition (`GIT_TEST_ASSUME_DIFFERENT_OWNER=1`), with
  and without `$HOME`: the flag succeeds where the old path failed.
- Why this happens at all: `bootstrap.sh` clones as `pi` while the vehicle service runs
  as root, and git refuses to touch a repository owned by someone else. It is the normal
  state of a YonderRC vehicle, not a broken install.

## v1.43.1
- **Fixed: the update check blamed the network for everything.** "Could not reach the
  update source. The vehicle needs internet" appeared on a vehicle that demonstrably had
  internet, because the check swallowed git's actual message and guessed. It now reports
  **git's own words** and translates the common causes: a checkout owned by another user
  (`dubious ownership` — the usual one, since the installer clones as `pi` while the
  service runs as root), no DNS, an unreachable github.com, missing credentials, a
  missing branch, or a vehicle installed from a zip and therefore unable to update at all.
- **The ownership case repairs itself.** That error asks for exactly one setting, so the
  vehicle applies it to its own directory (`git config --global --add safe.directory
  /opt/yonderrc`) and retries the fetch once, instead of sending you looking for an SSH
  session.
- **Every parsed command now runs in the C locale.** git, nmcli and the rest translate
  their messages: on a German Pi git answers `Schwerwiegend: Kein Git-Repository`, which
  none of our patterns match — and the same applies to every other output this code reads.
  Found by running the real commands rather than trusting the English wording, and fixed
  once for all of them.
- Reaching a vehicle over Tailscale says nothing about whether the *vehicle* has internet.
  The message says so now, because that is the exact confusion this bug produced.

## v1.43.0
- **The vehicle updates itself from the setup page.** New *Software update* panel:
  **Check for updates** fetches and reports the installed version, the available one, how
  many commits behind you are and the subject line of each — and changes nothing, so you
  can look before you decide. **Update & restart** then does what an SSH session would
  (`git pull --ff-only`, install changed dependencies, rebuild the control app when it
  changed) and restarts the service last. The point is a vehicle standing in a field with
  no keyboard anywhere near it.
- **The steps come from the diff, not from optimism.** A pull that adds a dependency or
  changes the ground app, followed by a bare restart, gives you a service that fails to
  start — and the setup page *is* that service, so you would lose the page you are holding.
  So dependencies are installed and the control app is rebuilt **before** the restart, and
  a vehicle-only change stays a single `git pull`.
- **It refuses when it should, and says why.** Local changes in the checkout (a
  fast-forward would fail or discard them, and the modified files are listed), or no
  internet. If a step fails it stops there and reports which one — the vehicle keeps
  running the version it had.
- **apt, systemd units and `install.sh` itself are deliberately out of scope.** When the
  check sees those changed, it says so and points at the full installer for when you are
  back at a keyboard.
- Documented as HARDWARE §3.4 in both languages, including the SSH equivalent.

## v1.42.0
- **Fixed: the setup page scrolled sideways on a phone.** Flex items don't shrink below
  their content, so one long unbreakable value — an IPv6 address, a Tailscale login URL,
  a device path — pushed a status row wider than the screen and dragged the whole page
  with it. Status rows may shrink and wrap now, and the four- and three-column grids fold
  to two (and to one on very narrow screens), so the page is a one-pager like the control
  app.
- **System status shows the Wi-Fi address too**, so LTE (WAN), the tailnet address and the
  Wi-Fi/LAN address are in one place — and the row no longer calls the vehicle's own
  hotspot a "client" connection: serving an AP and being joined to a network both read as
  *connected* to NetworkManager, only the connection name tells them apart.
- **The status block is grouped** with thin dividers between hostname/mode, LTE, remote
  access and Wi-Fi, instead of one undifferentiated list.
- **The LTE modem fields collapse when a HiLink stick is the uplink.** They do nothing for
  such a stick, so they get out of the way — while the sentence explaining *why* stays
  visible, and one button brings them back for the case where a real modem is plugged in
  later.
- **README and HARDWARE now carry the first field test**: a Pi 4 on a Huawei E3372h-320
  (internal antenna) controlled over Tailscale with the cable unplugged — direct IPv6 path
  (no relay, 69 ms), control round-trip 110 ms, video 128 ms at 444 kbps, LTE signal 52 %,
  and failsafe firing and clearing while the ground station moved from Wi-Fi to LTE.
  Written down as a data point with its conditions, not as a benchmark.

## v1.41.2
- **Fixed: a stale message under the Remote access panel.** The line held whatever the
  last button press wrote, so `Starting…` could sit there while the status row above it
  already said `Tailscale · Running · 100.x.y.z`. The status poll now owns that line: a
  pending login shows the link, a running tailnet shows the vehicle's name, IP and the
  address to reach it at.

## v1.41.1
- **Fixed: "Bring up" for Tailscale gave you no login link.** The vehicle sat at
  `down · NeedsLogin` with nothing to click. Two causes, both ours: the link was scraped
  from `tailscale up --timeout=1s`, which returns *before* tailscaled has reached the
  control plane and therefore before the URL exists — and the status parser then
  hardcoded `loginUrl: null`, so the pending login could never surface either.
- **The login link now comes from the daemon itself** (`AuthURL` in
  `tailscale status --json`). *Bring up* starts the login detached and waits up to 14 s
  for the link; the status keeps showing it for as long as the login is pending, so
  reloading the setup page no longer loses it. Pressing the button again while a login is
  already waiting hands back the same link instead of starting a second `tailscale up`.
- If no link appears within that window, the vehicle now says so and names the fallback
  (`sudo tailscale up --hostname=yonderrc` over SSH) instead of claiming it is "starting".
- The tailnet IPv4 is read from the same status document, so the common case needs one
  shell call less.
- Documented properly in HARDWARE §4.2, including the step everybody forgets: **disable
  key expiry** for the vehicle, or it silently drops out of the tailnet after ~180 days.

## v1.41.0
- **The onboarding hotspot now defaults to `always`.** It comes up whenever the WiFi radio
  is free — next to Ethernet or LTE too — so you can always walk up to the vehicle and
  reach the setup page. Before, any default route (a network cable on the bench counted)
  suppressed it, which is exactly how a vehicle ends up unreachable the moment its uplink
  misbehaves. The old behaviour is still one dropdown away as `auto`.
- **This changes existing vehicles that never picked a mode.** An unset `hotspot.mode`
  follows the shipped default, so after this update such a Pi starts broadcasting
  `YonderRC-setup`. A vehicle whose WiFi is *joined* to a network is unaffected — one
  radio can serve an AP or be a client, never both, and the client connection still wins.
- The hotspot stays **open** by default (that is what lets the captive portal put the page
  in front of you with nothing to type), so **set a password once the vehicle leaves the
  bench** — Setup › WiFi › Setup hotspot, min. 8 characters. Leaving it open is a valid
  choice; it just means anyone in range reaches the setup page and, if you enabled it, the
  LTE stick's admin page.

## v1.40.2
- **Installing one native driver module builds all three — now it says so.** `npm install
  i2c-bus -w @yonderrc/vehicle` reifies the *whole* vehicle package, and `pigpio` and
  `serialport` are optional dependencies of that same package, so npm always builds them
  along with it. This cannot be avoided: `npm install <pkg> --omit=optional` skips the
  requested module as well (npm answers "up to date" and installs nothing), which is
  worse. So the panel now says it upfront and the success message names what else got
  built. It is harmless — no module is used unless you select that driver.
- **Fixed: the record used for updates only listed the module you clicked.** `install.sh`
  restores what is listed in `hardwareDeps` after its `--omit=optional` pass, so the two
  modules that came along would have been pruned on the next update while the third
  survived. What is actually installed is recorded now.

## v1.40.1
- **Fixed: System status still said "no modem" while the vehicle was online through a
  HiLink stick.** The status row only ever asked ModemManager. It now falls back to the
  stick, so model, state, operator, signal and WAN IP appear there — marked as
  `(HiLink)`, and the LTE panel says outright that its fields do nothing for such a
  stick, because APN and PIN live inside it.
- **The stick's web UI is now proxied by default, on port 8081.** A stick you cannot
  configure is a stick you have to unplug and carry to a laptop, and everything else on
  this vehicle is reachable from a browser. The panel's **Open the stick's UI ↗** button
  therefore always has somewhere to go. Clearing the port field still switches it off.
  *The trade-off, stated plainly:* on an **open** onboarding hotspot anyone who joins can
  reach that admin page — set a hotspot password or an API secret before the vehicle
  leaves the bench, which is the same rule the setup UI itself already follows.
- **The OSD label stopped saying LTE twice.** It was "LTE 72% · 4G (LTE)"; it is "LTE 72%"
  now — but a **2G/3G fallback is spelled out** ("3G (HSPA+) 41%"), because that is the
  moment video stops working and the pilot needs the reason, not a percentage.
- The stick is read at most every 8 seconds and cached: the setup page polls status every
  3 s and the OSD link every 5 s, and each read is five HTTP requests to the stick. The
  panel's **Refresh** forces a fresh read.
- Opening a raw API path in a browser (`…:8081/api/monitoring/status`) answers `125002` —
  the stick wants a session, which its own UI establishes and which YonderRC's reader
  fetches first. Expected, and now documented.

## v1.40.0
- **HiLink LTE sticks are supported properly.** A Huawei E3372h-320 (and friends) is not a
  modem in the ModemManager sense — it is a small router that dials by itself, so
  `mmcli -L` stays empty and the LTE panel had nothing to show. YonderRC now reads the
  stick's **own API**: **Setup › LTE stick (HiLink)** shows model, interface, state,
  operator, network type and signal, and the **OSD link block shows the LTE percentage**
  just like it does for a real modem (RSRP-based, with the stick's bar icon as fallback).
- **The stick is identified through the routing table, never by interface name.** With a
  FritzBox on `eth0` and the stick on `eth1` — or the reverse after a reboot or another
  USB port — a name-based guess would eventually report the LAN as the LTE link.
  `ip route get 192.168.8.1` answers which interface *is* the stick, and that is what gets
  reported and used.
- **The stick's configuration page is reachable through the vehicle.** Its network
  (192.168.8.0/24) is only routable from the Pi, so APN, SIM PIN and network mode used to
  mean a keyboard on the vehicle or moving the stick to a laptop. Set a port under
  *Expose its web UI on port* and the vehicle passes the page through at
  `http://<vehicle>:<port>/` — usable from the hotspot, the LAN or the VPN. It is proxied
  at the **root of its own port**, because the HiLink UI is full of absolute paths that no
  prefix rewriting survives, and that also keeps its session cookie working.
- **The proxy is off by default and honours the API secret.** With a secret set, the page
  is opened once as `…?secret=…`, which is traded for an `HttpOnly` cookie so the UI's own
  requests are covered; without it the port answers 401. Our cookie is stripped before
  forwarding, and the target address is validated as a literal IPv4 — it is a proxy
  target, so it must never become a hostname somebody else controls.
- **A 2G/3G-only stick is called out.** E3131/E353 (`12d1:14db`) and similar are flagged in
  the panel: Germany and others switched 3G off years ago, so such a stick gets no data
  connection at all — better to learn that from the page than in a field.
- 32 new tests: XML parsing, error codes, network-type and connection-state mapping,
  RSRP → percent, route parsing, the full read against recorded XML (including session
  headers), and the proxy's auth gate. The proxy itself was exercised end to end against a
  stand-in stick. **The real stick's XML is the one thing only your hardware can confirm.**

## v1.39.2
- **Every button in Setup now shows that it is working.** nmcli, npm and modem calls take
  seconds; the page looked frozen, so you clicked again — and a second "start hotspot" on
  top of a running one is how NetworkManager ends up half-built. One `run()` wrapper
  disables the button and labels it for the duration of the call, and restores it even if
  the handler throws. Applied to **all 38** async buttons at once, not just the hotspot.
- **Setup links back to the control app.** A **Control ↗** link sits in the setup header —
  shown only when the ground app is actually built on this vehicle (`groundApp` in
  `/api/system`). The ground app already had the mirror-image Setup link, so you can now
  go both ways instead of typing URLs.
- **Fixed: the captive portal was only ever set up at boot.** Starting the hotspot from
  the setup page never wrote the dnsmasq drop-in, so the page could not open by itself —
  which is what you see when you join from a laptop after pressing "Save & start now".
  `hotspotStart` now handles it, before the profile comes up, so nobody has to be
  disconnected for it to apply.
- **…and it is deliberately skipped when the vehicle has an uplink.** The portal works by
  resolving every name to the Pi. With Ethernet or LTE the hotspot **shares that
  internet**, and hijacking DNS would break it for every client — so DNS is left alone and
  the message tells you which of the two happened. Stopping the hotspot removes the
  drop-in again.
- A laptop behaves differently from a phone here: phones pop the page up, GNOME/Windows
  usually just offer a "sign in to network" notification. Documented in HARDWARE §5.

## v1.39.1
- **Fixed: the "open" onboarding hotspot was never open.** `nmcli device wifi hotspot`
  always secures the AP — its man page says "password to use for the created hotspot. If
  not provided, nmcli will generate a password". So the vehicle broadcast **YonderRC-setup
  with a random WPA key nobody could know**, which quietly made the entire documented
  headless onboarding ("join it, the captive portal opens, type nothing") impossible. The
  profile is now built explicitly (`connection add … 802-11-wireless.mode ap …
  ipv4.addresses 192.168.4.1/24`), security is added **only** when you set a password, and
  the key is **read back** afterwards instead of assumed — if the AP ends up secured, the
  page tells you the key rather than leaving you locked out of your own vehicle.
- **Fixed: no hotspot at all, and nothing said why.** Raspberry Pi OS keeps the WiFi radio
  rfkill-blocked until a **WiFi country** is set, and NetworkManager then reports only
  `device is not available`. Setup › WiFi now has a **WiFi radio** block: state, country,
  and one button that unblocks the radio and sets the country — **pre-filled from the Pi's
  own locale/timezone**, so in the normal case you press one button and nothing else.
  Starting the hotspot repairs this on its own and says what it did.
- **Every nmcli failure is translated**, like the npm ones in v1.39.0: blocked radio, no
  country, no WiFi device, a hardware switch, a rejected key, a timeout, an adapter that
  can't do AP mode — each with the step that fixes it, and nmcli's own words underneath.
- `onboard.sh` mirrors all of it, so the **boot-time** hotspot is open too and repairs a
  blocked radio itself (country derived from the locale).
- 25 new tests, including the exact error string this Pi produced. The nmcli calls
  themselves stay hardware-only-verifiable — the flaw they fix was found on real hardware,
  not in the simulator, which is precisely why the sim can't prove them.

## v1.39.0
- **Native driver modules install from the browser.** Setup › Vehicle configuration now has
  **Native driver modules**: `i2c-bus`, `pigpio` and `serialport` with their status and an
  **Install** button, plus a **Restart service now** button afterwards. Until now a detected
  PCA9685 or INA228 still meant opening an SSH session — absurd on a vehicle whose whole
  onboarding story is "join its hotspot with a phone".
- **A failed install explains itself.** The npm/node-gyp log is translated into a cause and
  the command that fixes it: no internet (the most likely one — its own hotspot has no
  uplink), missing compiler (`build-essential`), a missing C library (`pigpio` needs its own
  apt package, which is *not* a missing compiler), node-gyp without Python, a full SD card,
  wrong ownership, or a timeout. The raw log tail is shown underneath, because the compiler's
  own last words are sometimes the only real clue.
- **Detect hardware now says when a module is missing.** Finding a device at 0x40 is useless
  while the module that talks to it is absent, so the probe result points at it instead of
  letting the driver fall back to `sim` silently.
- **An update no longer disarms your hardware.** What you install is recorded
  (`hardwareDeps`) and `install.sh` restores it after its `--omit=optional` pass — before,
  every re-run of the installer silently removed the driver modules again.
- Only allowlisted module names ever reach npm (`i2c-bus`/`pigpio`/`serialport`, checked in
  the router *and* in the system layer), the call carries no shell, and the endpoint sits
  behind the API secret like every other mutating call.
- **"npm said it worked" is not proof.** These modules are optional dependencies, so when
  the native build fails npm removes the module again, prints `up to date` and **exits 0**.
  Trusting that exit code would have reported a successful install of a driver that isn't
  there — the very silent failure this feature exists to prevent. Success is therefore
  decided by whether the module actually resolves afterwards, never by npm's exit code.
- Verified in sim end to end (status, install, failure path, allowlist rejection, secret
  gate, persistence), against a **real npm/node-gyp run** on a scratch checkout — which
  really did fail to build and was reported correctly — plus 26 new unit tests covering
  the allowlist and every failure message. Only the arm64/Pi specifics remain
  hardware-only-verifiable.
- One of those tests exists because of a bug found in that real run: a node-gyp stack
  trace contains the identifier `eNotFound`, and a case-insensitive `ENOTFOUND` match
  turned a broken Python into "the Pi has no internet". Error codes are matched
  case-sensitively as whole words now.

## v1.38.5
- **Fixed: `yonderrc-onboard.service` failed to start on a fresh Pi.** `onboard.sh` was
  committed **without the executable bit**, and the unit ran it directly as `ExecStart=`
  — systemd could only answer with `203/EXEC`. The hotspot fallback therefore never came
  up, so a Pi that later lost its network had no way back in. The file is executable now,
  and the unit calls it through `/bin/bash` as well, which also survives an install from
  a source zip (zips do not carry file modes).
- **A failing onboarding service no longer aborts provisioning.** It is enabled on its own
  line now: the hotspot is a fallback, while `go2rtc` and the vehicle service are what
  actually fly the model — the installer prints a hint and runs to the end.

## v1.38.4
- **Fixed: provisioning a fresh Raspberry Pi aborted at the ground build.** `install.sh`
  ran `npm install --omit=optional` to keep the native hardware drivers (i2c-bus, pigpio,
  serialport) out of a plain sim install — but npm applies `--omit` to the *whole* tree,
  and rollup and esbuild ship their platform binaries as their own optional dependencies.
  So `vite build` died with `Cannot find module @rollup/rollup-linux-arm64-gnu`, and
  because the script aborts on error the Pi was left **without a built ground app and
  without its systemd services**.
- The installer now runs a second, narrow `npm install --include-workspace-root
  -w @yonderrc/ground` with optional deps allowed: that adds only the rollup/esbuild
  binaries for this architecture (including vite's nested esbuild) — the vehicle's
  hardware drivers stay out, because that workspace is not selected. If the build still
  fails, it retries once with a full install instead of leaving a half-provisioned Pi.
- **Recovering a Pi that already hit this**: `cd /opt/yonderrc && sudo git pull --ff-only
  && sudo bash provisioning/install.sh` — the installer is idempotent.

## v1.38.3
- **Fixed: a one-second link blip was announced as an outage.** The WebSocket reconnects
  a second after any close, so a WiFi roam or an LTE handover produced a truthful but
  useless "link lost / link restored" pair. Both now wait ~2 s, and a recovery is only
  spoken for an outage that was actually announced — so a blip is completely silent.
  No safety cost: **failsafe is still announced immediately**, and the vehicle enters it
  300 ms after the frames stop.
- **Fixed: a reconnect announced "link recovered" in the middle of an outage.** The
  link-quality callout was derived from a value that included "are we connected", so
  losing the socket made the health score vanish — which read as a transition out of
  "bad" and cheerfully reported a recovery while the link was down. Presence and quality
  are now decided together: **while the link is down its quality is not bad, it is
  unknown**, and the quality clock restarts on reconnect instead of claiming improvement.
- **The two pairs no longer sound alike.** "Link recovered" next to "Link restored" was
  two near-identical phrases for different events. It is now **lost / restored** for the
  link existing and **weak / good** for how well it works.
- Sustained weakness needs ~3 s before it is spoken — longer than the outage grace,
  because a momentary spike in round-trip or loss is normal and the OSD badge already
  shows it instantly.

## v1.38.2
- **The return-home reserve is explained properly.** It is a margin on the **trip home**,
  not a percentage of the pack: at 50% you turn around while the pack still holds **1.5×**
  what getting home costs, and arrive with half that cost to spare. So it scales with how
  far out you are — small at 100 m, large at 2 km, which is where a misjudged consumption
  rate gets expensive. Setup › Controls now says exactly that, and points out that it
  guards against **estimation error**, not deep discharge (that's the low-battery warning).
- The code comment said "arrive with half again as much as the trip home costs", which
  was simply wrong — that is the state at the **turn-around** point, not on arrival.

## v1.38.1
- **Clearer wording in the return-home budget**: `home 64 of 2143 mAh` instead of
  `home 64 · left 2143 mAh`. With the unit only at the end of the line, the first number
  looked like it had none, and it wasn't obvious the two were the same quantity — the
  cost of the trip home out of what is left in the pack.

## v1.38.0
- **Return-home energy budget** (off by default). A battery percentage cannot answer the
  question you actually have beyond line of sight: 30% is plenty at 50 m and not enough
  at 800 m into a headwind. This measures what the vehicle really consumes per km and
  turns it into a decision — **how much further you may go and still get home** with the
  reserve intact.
- The headline is deliberately a **distance, not a percentage**: `⏎ 1.7 km` answers
  "keep going?" directly. Under it, what the trip home costs and what is left, plus the
  measured mAh/km — the efficiency figure that also shows up a dragging brake or a
  fouled prop. Green while there is room, amber as it tightens, red at **TURN BACK**.
- **Full OSD only** for the block; the **turn-back warning** rides in the badge row, so
  it survives compact mode on a phone, and it is **spoken** when callouts are on.
- **Reserve is configurable** (default 50%): the margin it insists on still having for
  the trip back — headwind, detours, a hill, and a pack that sags at the end.
- **It needs a battery capacity, a current sensor and a GPS home point, and without any
  of them it shows nothing at all.** That is the design, not a limitation: most vehicles
  have none of it, and a PCA9685 on its own is a complete way to drive. Setup › Controls
  says which input is missing, since the OSD deliberately stays silent about it.
- The odometer moved from the OSD into the app, so the distance readout and the energy
  estimate can never disagree about how far the vehicle has gone.

## v1.37.0
- **Voice callouts, on by default.** On FPV you watch the picture, not the OSD — a beep
  says *that* something happened, a voice says *what*. Spoken: **link lost / restored**,
  **failsafe**, **armed / disarmed**, and **low battery with the percentage**, repeated
  every 30 s while it stays low. Uses the browser's built-in speech engine, so no
  dependency and no network. Rate adjustable, with a Test button, in Setup › Controls.
- Deliberately nothing beyond that list. A voice that comments on everything is a voice
  you mute, and then the callouts that matter are gone with it. Urgent ones (failsafe,
  link lost, low battery) cut off whatever is still being spoken — by the time "armed"
  has finished playing, "failsafe" is stale news.
- The first connect of a session says nothing: you just pressed Connect and are looking
  at the screen. Only an actual **re**connect is announced.
- **Link health as one number.** Round-trip, packet loss and radio signal become a
  single 0–100 score with a trend arrow, green / amber / red. The score is the **worst**
  of the three, not an average — a perfect radio signal must not be able to hide 15%
  packet loss, which averaging would do.
- **The individual numbers are hidden while the link is good and come back by
  themselves the moment it isn't.** That's the point: "link 34, falling" tells you to
  react but not how, while "packet loss 12%" and "signal 18%" point at different fixes —
  and a dying link is the worst moment to go hunting for a setting. A second badge names
  what is dragging the score down. Setup can force the numbers on permanently.
- The trend arrow uses a deadband over a ~12 s history, so a single noisy sample can't
  flip it back and forth.

## v1.36.1
- **Fixed: holding a button on iOS selected its label.** Since v1.35 several buttons
  need a ~0.3 s press, and on iOS that is precisely the gesture that starts a text
  selection and pops the callout menu — so holding the lights toggle or a trim
  highlighted the text instead of feeling like a press. `user-select: none` alone
  doesn't stop it on Safari; `-webkit-touch-callout: none` was missing everywhere and
  is now set on every control at once, rather than per button, so the next control that
  grows a hold doesn't hit the same thing.
- The speed-limit buttons also lacked `-webkit-user-select` entirely, and used
  `touch-action: manipulation` — a page scroll starting on one could cancel the press
  half way through. Both corrected to match the other hold buttons.

## v1.36.0
- **Response curves per stick channel** — the thing expo cannot express. Expo is one
  number and always symmetric around centre; a curve gives you the actual shape: gentle
  to half throttle and then opening up, soft at the extremes but direct in the middle,
  a dead flat section, whatever the model wants. **Off by default** — a channel without
  one behaves bit-for-bit as before.
- 3, 5, 7 or 9 points, evenly spaced, linear interpolation between them, with a **live
  plot** next to the numbers. The dashed diagonal stays visible underneath so the
  deviation from linear is the thing you see. Changing the point count **resamples** the
  shape you already have instead of discarding it.
- **The two end points are fixed at ±100%.** Travel is limited with `min/max µs`, which
  already exists — a curve that could also cut the ends would be a confusing second way
  to do it, and it would quietly break the guarantee the safety chain rests on: that a
  resting stick produces the channel's off value. With the ends pinned, the **disarmed
  value, the failsafe and the pre-arm check keep working whatever shape you draw**, and
  there are tests for exactly that, including a curve that tries to cut the ends off.
- Applied **before** expo, so the curve's X axis is the stick position itself — which is
  what makes the plot readable — and the two can be combined. Only proportional
  channels get one: a switch has two positions and nothing in between to shape.

## v1.35.0
- **Live trims.** A collapsible *Trims* panel under the sticks (and under the video for
  keyboard/gamepad models) nudges a stick channel's neutral by 5 µs a press, up to
  ±150 µs, with a reset per channel. The car pulls left, you tap right — no trip to
  Setup. The value lands in the channel's existing `shaping.trimUs`, so it's the same
  number as `trim µs` in Setup › Channels and is saved with the model.
- **A short hold on the buttons that change something lasting.** Toggle channels, the
  speed limiter and the trims now need ~0.3 s of press before they act, on the screen
  and on a controller alike — long enough to reject brushing one with a thumb, short
  enough not to feel broken. Each button fills up while you hold it, the way the arm
  button does.
- Deliberately **not** covered, and this is the point of the list: **momentary channels**
  (a horn has to sound the instant you press it), **hold-ramp channels** (holding is
  already the gesture), and the **sticks** — steering and throttle are never delayed.
  Arm keeps its own longer, separate hold; panic-disarm stays instant.
- Configurable in Setup › Controls (0.1–3 s, or off — off restores exactly the previous
  tap behaviour). Per browser, like the other ground-side safety options.
- The action hold is now **per action** rather than one time for all of them, because
  arming (~1 s confirmation) and the speed limiter (~0.3 s filter) want different
  things from the same mechanism.

## v1.34.1
- **Setup › Channels now warns when a throttle failsafe would open the throttle.** The
  failsafe is stored as a raw µs and never passes through shaping, so on a channel with
  `reverse` ticked the seeded 1000 µs — which meant "motor off" when the profile was
  built — silently becomes **full power on link loss**, while the number in the editor
  still reads a perfectly innocent 1000. v1.34.0 fixed the disarmed value, which is
  derived; this covers the failsafe, which is yours to set and so is flagged rather
  than rewritten behind your back.
- The warning names the actual figure and the fix: *"Failsafe 1000 µs = 100% throttle on
  this channel (reverse is on) — Motor-off here is 2000 µs."* It sits above the collapsed
  shaping row, so it's visible without expanding anything, and clears the moment the
  value is corrected.
- Threshold is blunt on purpose — it only fires above half throttle, so a plane
  deliberately set to cruise home on a low failsafe throttle stays quiet. Drone, car and
  boat failsafe at centre, which is reverse-symmetric, and never trigger it.

## v1.34.0
- **Fixed (safety): a reversed throttle channel disarmed to FULL THROTTLE.** The
  disarmed value was read flat off the profile endpoints (`endpoints.minUs` for plane
  and drone), ignoring the channel's own `reverse` flag. With `reverse` ticked the idle
  stick maps to **max**, so "motors off" is 2000 µs on that channel — and sending 1000
  µs meant full power the moment you disarmed. It is now **derived** by running the
  resting stick position through the channel's own shaping, so reverse, per-channel
  endpoints and trim all count. Car and boat were never affected (they stop at centre,
  which is reverse-symmetric); an unreversed channel gets exactly the same value as
  before. Covered by tests across all four vehicle types with reverse on and off.
- **The fullscreen button now works on a phone.** It never did on iPhone: Safari has no
  `Element.requestFullscreen` there (iPadOS 13+ does), so the old `requestFullscreen?.()`
  quietly evaluated to nothing. Fullscreen is a CSS mode now — a fixed, `100dvh` stage
  that tracks Safari's sliding toolbar — so it behaves the same everywhere, and the real
  Fullscreen API is layered on top where it exists to hide the browser chrome too. The
  **OSD comes along**; leave with the Exit button in the corner or Esc.
- While fullscreen the page can't scroll or zoom under a finger (`touch-action: none`
  — iOS ignores `user-scalable=no`, so that meta tag was never the defence). The OSD
  keeps clear of the notch and home indicator via the safe-area insets.
- Touch sticks stay on the page behind and can't be reached from fullscreen; while
  **armed** a line says so, since that's when not being able to steer matters.
- Fixed on the way: the wide-screen `max-height: 60vh` cap on the video stage also
  applied in fullscreen, leaving the desktop picture at two-thirds height while the
  phone looked right.

## v1.33.2
- **The throttle row in Setup › Channels now shows its disarmed value** next to the
  failsafe: `fs 1500 · disarmed 1000`. Those two are deliberately different on a drone
  — failsafe is link loss *while armed* (hold, don't drop it), disarmed is switched off
  on the ground (motors off) — and seeing only `fs 1500` next to a channel sitting at
  1000 in the monitor looked like a contradiction. Shown on throttle channels only,
  where it's the one value that differs, with the reasoning on the tooltip.

## v1.33.1
- **Fixed: a channel row in Setup › Channels broke apart when its label was long.**
  The row was a wrapping flexbox whose mode text carried `margin-left: auto`, so once
  the content no longer fitted, the auto margin scattered the leftovers — the Throttle
  row (the longest label) split with "Remove" dropping to a second line while every
  other row stayed intact. The row is a grid now: above 640 px it's one line, below it
  the mode moves to its own full-width line under the label — the same way for **every**
  channel, whatever the label is called. The mode text truncates rather than wrapping
  into a column of single letters, with the full value on its tooltip.

## v1.33.0
- **The blackbox now logs the GPS track.** `lat`, `lon`, `alt_m`, `sats`, `hdop`,
  `speed_ms` and `course_deg` are written into the *same row* as the electrics and the
  link stats, at the same 2 Hz. That's the point of putting them there rather than in a
  separate file: in QGIS or kepler.gl you can colour the route by pack voltage or
  round-trip and see **where** the link gets bad, not just that it did.
- **New "Download GPX" button** (Setup › Controls) writes a GPX 1.1 track — elevation,
  satellites and HDOP per point, speed and course in the Garmin `TrackPointExtension`.
  Google Earth, [gpx.studio](https://gpx.studio), Garmin BaseCamp, GPSBabel, QGIS and
  Strava read it as-is. The button stays disabled until a row actually carries a fix,
  and the status line shows the fix count next to the row count.
- Rows recorded **without** a fix log empty coordinates rather than the last known
  position — a frozen point would look like the vehicle parked there. Satellite count is
  still logged while searching, so you can see the receiver coming up.
- **The GPS sim now circles over Balingen (72336)** at ~517 m instead of Berlin, so a
  sim track lands where the project does.

## v1.32.0
- **The Car template now defaults to stick mode 2.** A car needs only two axes, and mode 2
  puts both on the **left stick** — steering on X, throttle on Y — so one thumb drives it
  on a phone. Mode 4 splits them across two sticks if you prefer that; switch any time in
  Setup › Model.
- **Fixed: a template's default stick mode was recorded but never applied.** `buildProfile`
  stored `stickMode` while laying the axes out exactly as written in the template, so a
  template whose default differed from that layout produced a profile claiming a mode it
  wasn't in. The mode is now applied when the profile is built — a no-op for boat, plane
  and drone, whose layouts already matched.
- Existing models keep their stick mode; this changes what a **new** model from the
  template looks like (and what a factory reset seeds).

## v1.31.3
- **The default arm hold is now 1 s** (was 2 s). Still long enough to filter out a tap or
  a bumped controller button, but quicker to arm. An already-stored hold time is
  untouched — this only changes the default for a fresh install or after a factory reset;
  the time stays adjustable (0.5–10 s) and switchable off in Setup › Controls.

## v1.31.2
- **ESC calibration now uses the throttle channel's own endpoints.** It sent the
  profile-wide *Endpoints* values, so narrowing just the throttle channel (say to
  1200–1800 µs) still calibrated the ESC to 1000–2000 — teaching it a range it is never
  driven with. The channel's values now win, with the profile-wide ones as a fallback.
- **The calibration panel says what it is about to do** before the motor runs:
  "Will teach the ESC CH03: max 1800 µs → min 1200 µs", and warns when the selected
  channel isn't this model's throttle.
- **The channel field follows the model.** It was filled in once when the panel mounted,
  so switching models (or moving the throttle) left it pointing at the previous channel.
- **Fixed "Endpoints (ms)" in the UI.** The label always said µs in the source, but CSS
  `text-transform: uppercase` maps the MICRO SIGN to GREEK CAPITAL MU — visually a Latin
  M, so it read as milliseconds. Units in uppercased headings now opt out of the
  transform.
- The *Endpoints* field is now labelled and described as what it is: a **batch write**
  into every channel, adjustable per channel afterwards — not a cap that keeps applying.

## v1.31.1
- **Fixed: a touch model could come up with a missing joystick and refuse to arm.**
  Profiles live in the browser and outlive the version that wrote them. Before v1.10.0 a
  transmitter-mode switch reassigned a stick axis without re-deriving its input element,
  so a stored model could end up with, say, its throttle axis still on the *keyboard*
  source while the model ran on **touch**. The control pad only draws virtual `joy:…`
  bindings, so that stick was never rendered — and because nothing drove the channel it
  sat at centre instead of idle, which made the pre-arm check refuse with "throttle not
  at idle".
- Models are now **repaired once when they load** and written back: an axis binding gets
  the source and element its input method requires. Aux and user-added channels are left
  untouched. Switching the input method away and back was the manual workaround; it is no
  longer needed.

## v1.31.0
- **Fixed: the throttle channel could go stale.** A profile stored `throttleChannels`
  from its template, but moving a binding to another channel in the editor never updated
  that list — and the **disarmed value, the failsafe array, the pre-arm check**, the OSD
  bar and the ESC calibration all read it. A plane whose throttle had been moved held
  *centre* on link loss instead of motor-off, and passed the stick straight through while
  "disarmed". The channel is now derived from the bindings (`throttleChannelsOf`), with
  the stored list as a fallback, and the editor writes the derived list back on every
  edit, so older models heal themselves.
- **Speed limiter with three steps.** Low / Mid / High (percent per model, default
  40/70/100) as three buttons under the sticks and the channel buttons; the values are
  edited on the throttle channel in Setup, and a bindable controller button cycles them.
- The command is **scaled around the throttle's rest position**, so one rule covers both
  cases: a **centre** detent (car with reverse, drone) is capped forwards *and*
  backwards, a **low/free** detent (plane, ratcheted throttle) keeps its exact idle and
  is capped only upwards. Scaled, not clipped — the full stick travel stays usable.
- The limiter only changes what is **sent**: endpoints, failsafe, the disarmed value and
  the pre-arm check keep working off the true rest position, and the pre-arm check still
  sees the raw stick command. The OSD shows `LIM 40%` next to the throttle bar while a
  limit is active.

## v1.30.0
- **Panic-disarm now ships unbound** — for every vehicle type and input method. It used
  to default to **Escape**, and it is the one control with *no hold and no
  confirmation*: an accidental press cuts the motors, which on an aircraft means a
  crash. Bind it yourself in Setup › Controls to a key or controller button you can't
  hit by accident — and if you fly with a controller, bind it *on the controller*, since
  a keyboard key is no use with both hands on the sticks.
- **Existing installs are migrated**: bindings move to `yonderrc.actions.v2`, and a
  stored panic binding that is exactly the old shipped `Escape` default is dropped —
  it was never a deliberate choice. Anything you actually picked (including Escape plus
  a button) survives untouched.
- The Controls panel now says why panic is unbound and what to bind it to.

## v1.29.0
- **The arm hold now covers the bound key and controller button too.** Until now the
  2 s hold only applied to the on-screen arm button; a key or gamepad button bound to
  *Arm / disarm* fired on the press, which is the input most likely to be bumped by
  accident. It now needs the same sustained press, and releasing early cancels.
- **The arm button shows that hold**: holding the bound key fills the same bar and runs
  the same countdown, so there is visible feedback wherever you're looking.
- Switching the protection off in Setup › Controls disables it for **both** paths, and
  **panic-disarm stays instant** either way. Losing window focus mid-hold cancels, so a
  key can't stay "held" while you're in another tab.

## v1.28.0
- **Hold-to-arm is now configurable** in Setup › Controls: a switch to turn the
  protection off entirely and an adjustable **hold time** (0.5–10 s), stored per browser.
- **The default hold is now 2 s** instead of 3 — long enough that no pocket-touch gets
  through, short enough that arming doesn't feel like a ceremony. Switched off, the arm
  button toggles on a plain tap again and says so ("DISARMED — tap to arm").
- **Panic-disarm stays instant** in every configuration, and the pre-arm check is
  unaffected.

## v1.27.1
- **The setup hotspot can now stay up next to LTE.** New *when to start it* setting in
  Setup › WiFi: **auto** (default, unchanged — only when the Pi has no uplink at boot),
  **always** (also next to a working LTE link, so you can always walk up to the vehicle
  for diagnostics) and **off**. Plus a **Stop hotspot** button.
- A WiFi *client* connection always wins over `always`: one radio can't serve an access
  point and stay joined to a network, and dropping the WiFi link would cut the vehicle
  off your LAN. The onboarding checks that before starting anything and says so in the
  log.
- Documented what actually closes the hotspot: joining a network, *Stop hotspot*, or a
  reboot with an uplink in `auto` mode — a remote service (Tailscale/ZeroTier/WireGuard)
  or LTE does **not**, those ride on other interfaces.

## v1.27.0
- **Wi-Fi onboarding from the phone.** New **Setup › WiFi** panel: scan for networks
  (SSID, signal, lock state), pick one, enter the password, connect. The Pi has a single
  radio, so joining your network closes the setup hotspot — the page stops responding,
  which is the expected sign it worked. **If the password was wrong the vehicle restarts
  the hotspot**, so it can't lock itself out.
- **The onboarding hotspot is now open by default.** The captive portal can then put the
  setup page in front of you with nothing to type; a default password published in a
  public README protected nothing anyway. **Set an SSID and a password** (min. 8
  characters, WPA2) in the same panel — *Save* applies at the next hotspot start,
  *Save & start now* restarts it immediately.
- **Generate button for the API secret**: 20 random characters from a confusable-free
  alphabet, shown once so you can copy it, then applied to the vehicle.
- **The status header no longer claims "Tailscale"** when another method is configured.
  The row is now **Remote access** and shows the selected method with its state
  (`ZeroTier · up (joined …)`, `WireGuard · down`, `none`).

## v1.26.0
- **Auto-disarm on reconnect is now selectable** in Setup › Controls: **Auto** (default,
  follows the vehicle type — on for car/boat, off for plane/drone), **Always on** or
  **Always off**. The choice is pushed to the vehicle immediately, not only on the next
  connect, and forcing it against the type policy shows a warning saying what that means
  in the air or on the ground.
- **Fixed the stretched OSD badges (top left).** The left-hand OSD columns had no
  alignment, so the flex default stretched every badge to the width of the widest one —
  the session timer and the GPS badge carried a blank tail. Same class of bug as the
  LINK badge in v1.22.0, now fixed for both left columns.

## v1.25.0
- **The blackbox CSV now holds every telemetry channel.** Next to the fixed link/video
  columns it gets **one column per configured channel**, named after its label
  (`Pack_V`, `BEC_V`, `I1_A`, `Motor_C`), so temperatures and extra voltages/currents
  finally land in the log. `volt`/`amp` stay as the **primary** channel so a script
  always finds the pack in a known place. Columns are the union over the whole log, so
  a probe that drops out mid-run leaves a gap instead of shifting everything.
- **"Flight" is now "Session"** in the status strip and the OSD field list — the same
  app drives cars and boats, and the timer measures armed time, not flight.
- **Docs pass** for everything since v1.21.1: hold-to-arm in the safety chapter and the
  first-test steps (both languages), per-value OSD switches, the temperature-sensor and
  INA228 additions in the feature list, the new CSV columns, and a refreshed
  touch/status screenshot showing the hold-to-arm button and the Session stat.

## v1.24.0
- **Temperature sensors, 1..n.** New temperature channels in Setup › Telemetry, shown in
  the OSD under voltage and current: **Raspberry Pi SoC**, **DS18B20** (1-Wire),
  **MCP9808 / TMP102 / TMP117 / BMP280 / BME280** (I²C), **MAX6675 / MAX31855 / MAX31856**
  thermocouples and **MAX31865** PT100/PT1000 (SPI), plus an **NTC or PT100 on an
  ADS1115 / MCP3008**. Each kind shows only the fields it needs (address, chip-select,
  thermocouple type, probe, series resistor, R25/beta, offset). A sensor that can't be
  read is left out of the OSD instead of appearing as 0 °C, and is logged once.
- **Every telemetry value can now be hidden individually** — FPV › ⚙ › *Sensor values*
  lists every channel the vehicle reports, per browser, so a phone can show less than
  the laptop. New channels are visible by default.
- **Labels in the OSD**: as soon as a kind has more than one channel, its label is shown
  in front of the value (`Pack 16.6 V · BEC 5.1 V`, `Motor 62 °C`). With a single channel
  nothing changes. New channels default to short labels (`U2`, `I2`, `T1`).
- **Explicit primary channel.** Battery %, mAh/Wh counting, the low-battery warning and
  the blackbox used to read *whichever channel happened to be first*, so deleting or
  inserting a channel silently moved the battery maths. A **primary** radio (Setup ›
  Telemetry, shown once a kind has two channels) now marks it; without a flag the first
  channel wins, so existing configs are unchanged. The vehicle reports the index, so the
  ground warns on the same voltage it counted with.

## v1.23.0
- **INA228 support — the sensor counts the charge itself.** The INA228 integrates
  CHARGE (coulombs) and ENERGY (joules) in hardware at ADC rate, so the vehicle reads
  two registers instead of summing samples: the consumed mAh no longer depend on the
  polling rate, and a sample the loop missed can't quietly go uncounted. 85 V bus
  range (up to 12S) and 20-bit resolution on top. New **Charge counter** setting
  (`auto` / `sensor` / `pi`); `auto` uses the chip when it has a counter and the Pi
  otherwise, and **Reset mAh** now also clears the chip's registers (RSTACC).
- **INA237 / INA238 support** — the same 85 V family and register map, 16-bit and
  without the accumulators, so the Pi keeps integrating for them. Complete coverage:
  INA219/226/228/237/238/260/3221.
- New per-channel fields for these three: **Max current A** (sets CURRENT_LSB and with
  it SHUNT_CAL, written at init) and the **shunt range** (±163.84 mV / ±40.96 mV, 4×
  resolution), with a warning when max current × shunt doesn't fit the low range.
  Current is read from VSHUNT, so it stays correct even if the calibration write
  didn't land.
- **Recommendation in the hardware guide is now the INA228** (parts list, wiring 2.2,
  setup step 3), with a comparison table of all seven supported sensors — INA226
  remains the choice up to 36 V.
- **Fixed:** saving telemetry updated the file and the running service but not the
  in-memory config, so reloading the setup page showed the pre-save values again.
- Detection hints for I²C addresses now name the whole INA2xx family.

## v1.22.0
- **Hold-to-arm (3 s)**: the arm button no longer toggles on a tap. Press and hold it
  for 3 seconds — the button fills up and counts down ("ARMING IN 1.6 s") — and the
  same hold is required to *disarm*, which is the accidental touch that actually hurts.
  Releasing early cancels; losing the link mid-hold cancels too. Works with a finger,
  the mouse and Space/Enter, with a short haptic buzz on phones that support it.
  **Panic-disarm (Setup › Controls) stays instant** — that's the emergency path.
- **OSD shows only DISARMED / FAILSAFE**, never ARMED. Armed is the normal case and is
  already obvious from the flight timer and the channel bars, so the badge is dropped —
  one element less over the picture on a phone.
- **Fixed the stretched OSD badge**: the top-centre strip inherited `flex-direction:
  column` from `.osd > div`, so LINK and DISARMED were stacked *and* the shorter badge
  was stretched to the wider one — the blank tail behind "LINK" that vanished as soon
  as you armed. Both centre strips are proper rows again.
- **More room between the touch joysticks** (gap 18px → up to 64px, scaled with the
  viewport): easier two-thumb control on a phone, in every stick mode, and still no
  wrapping on narrow screens.

## v1.21.1
- **Documentation pass over all four docs** (EN + DE), correcting what had gone stale:
  auto-disarm on reconnect is **vehicle-type coupled** (the setup checkbox is only the
  fallback until a ground station connects — the old "turn it off for plane/drone by
  hand" advice was wrong); the installer's real package list (Node 22, `usb-modeswitch`,
  `i2c-tools`, `gpsd`, `wireguard-tools`, ZeroTier); the native driver libs are
  **optional dependencies** skipped by `npm install --omit=optional`; serial GPS needs
  `serialport` too; Pi OS is no longer pinned to Bookworm in the text.
- **New in `HARDWARE.md` §6.1: the trust model** — the service listens on `0.0.0.0`, so
  the network is the security boundary; when to set an API secret, what it does and does
  not protect (plaintext in the config, traffic unencrypted), `YRC_API_SECRET`, and
  `YRC_HOST` for binding to a single address.
- Setup steps now cover **Detect hardware**, the **battery-% source** and the **Security**
  panel; the LTE section explains the **uplink signal in the OSD** (`mmcli` %, else the
  `wlan0` RSSI). New troubleshooting rows for a set API secret, no GPS fix and a missing
  signal value.
- README (EN + DE): **mobile view** with a collapsible screenshot, plus the features that
  were missing — **Auto** video quality, per-block OSD toggles, low-battery warning and
  **blackbox logging**.
- Setup page: the last German string ("RÄDER HOCH / PROPS AB") is now English.

## v1.21.0
- **Mobile layout fixes** — nothing widens the page any more, so mobile Safari can't
  pan/zoom the whole view sideways: the FPV/OSD tool buttons wrap into a second row,
  the model editor's *Duplicate*/*Delete* drop onto their own right-aligned row, and
  the number-input grids (endpoints, auto-quality, battery thresholds) let their
  columns govern the width instead of the inputs' intrinsic size. The endpoints
  min/max pair was completely unstyled and now renders as a proper two-column field.
- **Compact OSD on phones** — same blocks at ~⅔ the size, secondary readouts (video
  latency, kbps, fps, battery-% source) hidden, the bottom-right telemetry stacks laid
  out as wrapped rows, and the ARMED/FAILSAFE badge moved up next to LINK so the
  telemetry block can't cover it. New **OSD size** setting in the FPV ⚙ panel:
  *Auto* (compact on narrow screens and on phones in landscape), *Compact*, *Full* —
  persisted per browser. Desktop is unchanged.

## v1.20.4
- OSD: **GPS ground speed** (km/h) now shown under the home compass, next to the trip
  odometer; the compass column is left-aligned so speed/odometer sit flush left.

## v1.20.3
- **Trip odometer** under the home compass in the OSD — accumulated ground distance
  (m, switching to km with 2 decimals ≥ 1000 m), computed from successive GPS fixes
  with a jitter deadband so a stationary receiver doesn't make it creep. Resets on
  link loss.

## v1.20.2
- OSD polish: bigger **battery bar** and **home compass**; dropped the distance label
  next to the compass (it's already shown in the home badge just above it).

## v1.20.1
- **Home compass/arrow in the OSD** — a rotating arrow that points the way back to
  home. It rotates relative to your travel direction (course) so "up = forward", with
  the distance next to it (falls back to north-relative when stationary).
- **OSD field toggles** in the gear (⚙) menu — show/hide individual OSD blocks: flight
  timer, GPS, home arrow, channel bars, link block (WS/ms/fps/loss), battery bar, and
  battery data (V/A/mAh). Saved per browser.

## v1.20.0
- **GPS (local, source-selectable).** A new GPS subsystem with a pluggable source —
  **local NMEA** over serial (Adafruit Ultimate GPS, u-blox NEO-6/7/8/M9, BN-880…),
  **gpsd** (USB dongles), a **sim** source, and a **MAVLink** slot for later — all
  normalized to one fix and streamed to the ground at ~1 Hz.
- **Home point**: set it manually or **auto-home** on the first good fix (session /
  takeoff point). The OSD shows fix type + satellites and, with home set, **distance
  and direction back to home**.
- Setup › GPS (source, serial device/baud, min-sats, auto-home, live status, set/clear
  home); "Detect hardware" now also lists serial GPS candidates; the installer adds
  `gpsd`. HARDWARE docs (EN+DE) cover common modules and wiring.

## v1.19.0
- **Link health in the OSD** — the vehicle now reports its uplink signal (LTE % or
  WiFi dBm), shown bottom-right in the OSD and folded into the **weak-link** warning
  alongside control RTT and video packet loss. One unified "is the link good" signal.
- **One-line install** on Raspberry Pi OS Lite:
  `curl -fsSL …/provisioning/bootstrap.sh | bash` clones to `/opt/yonderrc` and runs
  the installer.
- **"Detect hardware"** button in Setup — scans the I²C bus, LTE modem and cameras and
  suggests the driver/sensors to pick, so you don't have to guess addresses. The
  installer now also adds `i2c-tools`.

## v1.18.4
- **More LTE control** (Setup › LTE): force the **network mode** (4G/LTE-only or 3G)
  for lower latency, toggle **data roaming** (home-only), a **Diagnostics** button
  that shows the raw `mmcli` output so you can see what the Pi detects, and **SIM PIN
  management** — change the PIN or **remove the PIN lock** entirely (empty new PIN =
  no PIN). PIN operations act on the SIM itself and require the current PIN.

## v1.18.3
- **Non-root operation**: added a ready-made minimal sudoers policy
  (`provisioning/yonderrc.sudoers`) for running the vehicle service as a non-root
  user — it grants passwordless sudo only for the privileged helpers (mmcli PIN,
  wg/wg-quick, zerotier-cli, install of the WireGuard conf, reboot). The default
  systemd unit runs as root, where it isn't needed. `zerotier-cli` is now invoked via
  sudo too, so ZeroTier works under a non-root user. Documented in provisioning/README.

## v1.18.2
- **Much better LTE stick setup** (Setup › LTE) — no longer assumes pure plug-and-play:
  - **SIM PIN** unlock (`mmcli --pin`) for locked SIMs.
  - **APN username/password** for carriers that require APN auth.
  - **Richer status/diagnostics**: real modem model, registration state, live APN/IP,
    and a clear "SIM PIN required" flag (instead of just "idle").
  - The NM connection is created with **`autoconnect`** so it redials itself.
  - PIN/password are stored on the vehicle and **never returned** by the API.
  - The install script now adds **`usb-modeswitch`** for "Zero-CD" dongles.

## v1.18.1
- **Auto-disarm on reconnect is now coupled to the vehicle type** — the ground derives
  it from the active profile (car/boat = ON, plane/drone = OFF) and pushes it to the
  vehicle, so a brief reconnect can no longer cut an aircraft's motors in flight. The
  Controls (Safety) panel shows the current policy and why; the vehicle's manual toggle
  is now just a fallback used until a ground connects. Failsafe is unchanged and remains
  the primary link-loss safety.

## v1.18.0
- **Selectable remote access** (Setup › Remote access) — pick one method to reach the
  vehicle behind CGNAT/LTE:
  - **Tailscale** and **ZeroTier** — zero-config mesh VPNs (ZeroTier: enter the 16-hex
    network ID, then authorize the node).
  - **WireGuard** — **upload a `.conf`** (e.g. exported by a FritzBox) and the vehicle
    applies it with `wg-quick`; comes up automatically at boot.
  - The chosen method is persisted and brought up at boot; secrets (auth key, WG conf)
    are never returned by the API. Setup gates all of this behind the optional shared
    secret. *(ZeroTier/WireGuard were validated in the simulator and via unit tests; the
    real `wg-quick`/`zerotier-cli` paths are hardware-verified only — test on your Pi.)*
- The Pi install script now also installs `wireguard-tools` and ZeroTier.

## v1.17.4
- **Choose what drives the battery % gauge.** Setup › Telemetry now has a "Battery %
  source": **coulomb** (consumed mAh vs capacity), **voltage** (full/empty curve), or
  **clamp** (the lower of the two — safe default). The mAh readout (consumed/remaining)
  is shown regardless; this only changes the top-right % gauge. The OSD now labels the
  bar with its source (`mAh` / `volt` / `mAh·V`) so it's clear where the number comes from.

## v1.17.3
- **Factory reset** — vehicle and ground. Vehicle: Setup › System → "Factory reset"
  clears the saved config file (incl. the API secret, dropped live so you're not
  locked out); restart to apply defaults. Ground: Setup → "Reset app settings" wipes
  all `yonderrc.*` browser storage (models, bindings, actions, battery, secret) and
  reloads with the demo models.
- **Voltage sanity floor for battery %** — set an optional full/empty pack voltage in
  Setup › Telemetry; the battery percentage is then clamped so it can't read higher
  than the voltage suggests (coulomb counting alone would show ~100% on a
  not-actually-full pack). Also yields a % from voltage when no capacity is set.
- **SBUS driver**: a serial error is now logged instead of surfacing as an unhandled
  crash; the fixed-rate frames keep trying and the watchdog holds failsafe.

## v1.17.2
- **Telemetry can be turned OFF** (Setup › Telemetry → source "off"). Default stays
  sim, but for a first flight you can disable it so the OSD shows **no fake values**
  at all. The ground also clears telemetry if the vehicle stops sending it, so
  turning it off live doesn't leave stale numbers on screen.
- **"Setup ↗" button** on the ground page opens the vehicle's setup page in a new
  tab, derived from the connection address — works over LAN, the Pi's AP, or a
  Tailscale IP (same host:port as the control link, over http).
- **Clearer WebRTC control option**: the "Control via WebRTC data channel" checkbox
  now has a tooltip + hint explaining it (lower-latency, NAT/LTE-friendly control
  path that auto-falls back to WS; arm/settings always use WS).

## v1.17.1
- **Optional shared secret (off by default).** Set an "API secret" in the vehicle's
  Setup › Security. While unset, nothing changes — first-time connect and setup need
  no password. Once set, it's required for **saving settings** (mutating `/api/*`
  POSTs, via header `x-yonderrc-secret` or `?secret=`) **and for the control link**
  (the ground app's new "secret" field, sent as `?secret=`; a wrong/missing secret is
  rejected with WS close 4001). The secret is never returned by the API. Set/clear it
  live without a restart.

## v1.17.0
- **English-first documentation.** `README.md` and `docs/HARDWARE.md` are now
  English; the German originals live in `README.de.md` and `docs/HARDWARE.de.md`,
  with a language switcher at the top of each. No code changes — docs only.

## v1.16.3
- **Camera setup hardening**: stream names are restricted to a safe charset (they
  become go2rtc stream keys *and* the ground's stream id), USB device paths are
  validated, and dimensions/fps are coerced to safe integers — a crafted camera
  name or device path can no longer break the generated `go2rtc.yaml` or inject
  into its `exec:` command lines. Names are normalised on save so config, welcome
  and YAML stay in sync.
- **INA sensors can now provide pack voltage too**: `ina219/226/260/3221` are
  selectable as voltage channels and read from their bus-voltage register, so a
  single INA battery monitor delivers both voltage and current (no extra divider).
  *(Register conversions are unit-tested; the I²C read path is hardware-verified only.)*
- **Fix — per-axis detent could be mis-assigned after a transmitter-mode change**:
  detents are now preserved per channel (not per stick axis), so switching input
  method after changing the stick mode keeps each channel's centering correct.

## v1.16.2
- **Safety fix — arm/disarm now always travels over the reliable WebSocket.**
  Previously, when the opt-in "Control via WebRTC data channel" mode was active,
  arm/disarm (incl. panic-disarm) went over the lossy, no-retransmit data channel,
  so a single dropped packet could silently leave the vehicle armed. Only control
  frames (which are superseded 20 ms later) now use the data channel; every
  one-shot command (arm, config, hello, video, calib) is forced onto the WS.
- **Security fix — no more shell injection in the vehicle setup API.** The LTE APN
  and Tailscale auth key from `/api/lte` and `/api/tailscale` were interpolated
  into shell strings; a crafted value could execute arbitrary commands on the Pi.
  These now use `execFile` (no shell), so operator input is a literal argument.

## v1.16.1
- **OSD refinement**: the battery **charge bar stands alone top-right** (phone-style),
  and the numeric battery data (voltage, current, mAh) moves to the **bottom-right as
  its own panel under the link/latency block**, so the two are cleanly separated.

## v1.16.0
- **OSD layout swapped** for a more intuitive read: battery/power block (charge bar,
  voltage, current, capacity) now sits **top-right**, phone-style, with the charge
  bar on top; link/latency data (control path, ctrl/video ms, bitrate, fps, loss)
  moved to the **bottom-right**.

## v1.15.0
- Fix: battery %/mAh now appears **without a vehicle restart** — telemetry config
  hot-applies (`/api/telemetry` reconfigures the running service). Set the capacity
  in the vehicle's Setup › Telemetry.
- Fix: switching Setup → Drive could show a black picture every other time — the
  WHEP stream now attaches only for the latest connection attempt (generation guard)
  and force-plays, so overlapping attempts can't leave a dead stream.
- **Fullscreen** button on the FPV panel (OSD stays overlaid).
- Vehicle Setup: camera W/H/FPS/kbps fields no longer overflow their box.
- Added `CLAUDE.md` for local development handoff.

## v1.14.0
- **Blackbox logging** (opt-in, OFF by default): records telemetry + link stats
  (RTT, bitrate, loss, fps, video latency, volts/amps/mAh/percent) at 2 Hz while
  enabled and downloads as CSV. Costs nothing when off; buffer is capped. In
  Setup › Controls.
- **Low-battery warning** gained a **consumed-mAh** threshold (in addition to
  percent and voltage), and the settings layout was tidied into aligned rows.
- Fix: switching Setup → Drive could leave a frozen/black video with no recovery —
  the frame watchdog used a stale state value; it now tracks live frames and
  reconnects a black stream on its own.

## v1.13.0 — Low-battery warning
- **Low-battery warning** with independent **percent** and **voltage** thresholds.
  "Auto" mode only warns when a real sensor is delivering data (no nagging in sim);
  can be forced on/off. Alerts — **OSD red blink**, **rumble** and **sound** — are
  each individually switchable and repeat every ~3 s while low. Settings live in
  Setup › Controls.

## v1.12.0 — Safety & controls
- **Pre-arm check**: arming is refused while a throttle channel is off its rest
  position (centre for reverse-capable cars/drones, idle for planes/boats — taken
  from the channel's detent). Toggleable in Setup › Controls, on by default.
- **Unified action bindings** (Setup › Controls): assign a keyboard key and/or a
  controller button to Panic-disarm, Arm/disarm, Next-camera, Record and Snapshot,
  each with a Learn button. Record/snapshot hotkeys moved here from the FPV panel.
- **Panic disarm**: a bindable action that disarms immediately over the reliable link.
- **React error boundary**: a UI fault shows a reload panel instead of a white screen.
- **Flight timer + session**: runs while armed (OSD top-left and status strip), with
  mAh consumed since arming when a real sensor is present.

## v1.11.0
- OSD: link state moved to top-center, armed/failsafe to bottom-center; the
  top-right stats and bottom-right telemetry now sit on a translucent panel so
  they stay readable over bright video.
- Channels: added an **Edit** button (alongside Add/Remove) and a per-channel
  **rest position** (center / min / hold) so a hold-ramp, momentary or toggle can
  settle at centre (1500) instead of min. Independent of stick modes.
- Channel monitor: throttle-held-safe channels are now clearly tinted and labelled
  "held safe · disarmed" instead of a truncated tag.

## v1.10.0
- **Transmitter stick modes 1–4**: switch which stick controls throttle / elevator
  / aileron / rudder — for touch, gamepad and keyboard. Chosen per model in Setup
  and preserved across input-method switches (car/boat default to Mode 1, plane/
  drone to Mode 2).
- **Add / remove channels**: build your own channel map in Setup. "+ Add channel"
  with a channel number, label, source (keyboard / gamepad / on-screen), mode
  (proportional / momentary / toggle / hold-ramp) and a "Learn" button to capture a
  key or gamepad button/axis; each channel has a Remove button. Custom channels now
  survive input-method and stick-mode switches.

## v1.9.0
- Fix: per-channel and global endpoints (µs) now actually apply beyond 1000–2000 —
  the hard clamp was widened to an absolute 500–2500 range (nominal default stays
  1000–2000). The channel monitor scales each bar to that channel's own endpoints.
- UI: dark, consistent styling for all dropdowns and number fields. Layout
  reorganised — model selection now lives under Setup only; Drive view is
  Vehicle-Link → FPV+control → status info → servo outputs. The OSD now shows the
  link state (LINK / NO LINK) alongside armed/failsafe.

## v1.8.0
- **Auto video quality**: a new "Auto" mode steps the video quality down when the
  link degrades (packet loss / latency) and back up when it recovers, with
  hysteresis so it doesn't oscillate. Thresholds are adjustable in the FPV video
  settings (⚙). Manual High/Medium/Low still available.
- **Link robustness**: the OSD now shows "RECONNECTING…" during control-link
  recovery and a "⚠ WEAK LINK" warning when control latency or video loss is high.
- **License**: switched to CC BY-NC-ND 4.0 with an additional no-military-use
  restriction. README gained the repo-copy instructions (git/scp/USB).

## v1.7.2
- Docs: README rewritten to be concise and describe the current feature set
  (per-version notes moved to this changelog). Added a LICENSE — freeware for
  private, non-commercial use; no modification, no commercial use, and no
  military/warfare use.

## v1.7.1
- Fix: live video quality change crashed the vehicle with ENOENT — the go2rtc
  config path is now absolute (resolved to the repo root) and writes create the
  folder and never throw. REC toast in the OSD now blinks red.

## v1.7.0
- **Self-healing video**: the FPV stream now detects a frozen/dropped picture
  (WebRTC state + a frame watchdog) and reconnects on its own with backoff, keeping
  the last frame on screen and showing "Reconnecting…" instead of freezing.
- **Live video quality from the ground** (High / Medium / Low): the ground sends a
  command; the vehicle rescales resolution + caps bitrate and reloads go2rtc, then
  the stream re-establishes automatically. Keeps the picture fluid on a poor link.
- **Connection stats in the OSD**: bitrate, packet loss, FPS and video latency from
  WebRTC stats (top-right). Armed/failsafe badge moved to top-center so it no longer
  overlaps the REC indicator.

## v1.6.0
- **Recording & snapshots** in the FPV panel: record the live video locally (WebM)
  and grab stills (PNG). Pick a target folder once before flight (File System
  Access API) so nothing needs clicking mid-flight; otherwise files go to Downloads.
  Bindable to a keyboard key or controller button (video start/stop + snapshot).
- **Guided hardware self-test** in the setup UI: sweep any channel (min→max→center,
  disarmed only — refused while armed), read the current sensor values once, and
  snapshot each camera. Makes the first real bring-up a click-through.
- **Repeatable test suite** (`npm test`): consolidates the sensor math, coulomb
  counting, sim/real telemetry, vehicle-type failsafe/disarmed logic, template and
  binding-engine behaviour, and camera-source generation into one run (23 checks).

## v1.5.1
- Auto-detect the H.264 encoder (libx264 / libopenh264 / Pi hardware) so video
  works without RPM Fusion; `dev:video` accepts any usable encoder.

## v1.5.0
- Disarmed and failsafe are separate, vehicle-type-aware values (drone holds on
  link loss, disarms motors-off). Auto-disarm on reconnect is toggleable (off for
  aircraft). Telemetry shows "NO SENSOR" instead of silently substituting sim.
  Field operation: AP hotspot + captive portal; the Pi serves the ground app.

## v1.4.0
- Sim telemetry clearly marked SIM (OSD + status). Model switch and settings
  locked while armed. New connections start disarmed. Hardware guide added.

## v1.3.0 / v1.3.1
- Telemetry subsystem (voltage/current sensors, coulomb counting, battery %),
  graphical camera configuration generating go2rtc.yaml, video-latency estimate.
  libx264 preflight added.

## v1.2.0
- Video verified end-to-end (go2rtc /api/webrtc), `dev:video` helper.

## v1.1.x
- Models (car/plane/drone/boat) from templates, per-model input method and
  per-axis detents, virtual joystick, µs endpoints; reconnect and detent fixes.

## v1.0.0
- First consolidated monorepo: protocol, vehicle (sim + hardware drivers), ground
  (React), desktop (Electron + SDL2). Sim-complete.
