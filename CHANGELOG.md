# Changelog

All notable changes to YonderRC. Each release is the full project; every zip is
self-contained. Entries from v1.17.0 on are bilingual (English / Deutsch).

## v1.19.0
**English**
- **Link health in the OSD** — the vehicle now reports its uplink signal (LTE % or
  WiFi dBm), shown bottom-right in the OSD and folded into the **weak-link** warning
  alongside control RTT and video packet loss. One unified "is the link good" signal.
- **One-line install** on Raspberry Pi OS Lite:
  `curl -fsSL …/provisioning/bootstrap.sh | bash` clones to `/opt/yonderrc` and runs
  the installer.
- **"Detect hardware"** button in Setup — scans the I²C bus, LTE modem and cameras and
  suggests the driver/sensors to pick, so you don't have to guess addresses. The
  installer now also adds `i2c-tools`.

**Deutsch**
- **Link-Qualität im OSD** — das Fahrzeug meldet jetzt sein Uplink-Signal (LTE % oder
  WiFi dBm), unten rechts im OSD sichtbar und in die **Weak-Link**-Warnung eingerechnet
  (zusammen mit Steuer-RTT und Video-Paketverlust). Ein einheitliches „ist der Link gut".
- **Ein-Zeilen-Installation** auf Raspberry Pi OS Lite:
  `curl -fsSL …/provisioning/bootstrap.sh | bash` klont nach `/opt/yonderrc` und startet
  den Installer.
- **„Detect hardware"**-Button im Setup — scannt den I²C-Bus, das LTE-Modem und Kameras
  und schlägt Treiber/Sensoren vor, statt Adressen raten zu müssen. Der Installer bringt
  jetzt zusätzlich `i2c-tools` mit.

## v1.18.4
**English**
- **More LTE control** (Setup › LTE): force the **network mode** (4G/LTE-only or 3G)
  for lower latency, toggle **data roaming** (home-only), a **Diagnostics** button
  that shows the raw `mmcli` output so you can see what the Pi detects, and **SIM PIN
  management** — change the PIN or **remove the PIN lock** entirely (empty new PIN =
  no PIN). PIN operations act on the SIM itself and require the current PIN.

**Deutsch**
- **Mehr LTE-Kontrolle** (Setup › LTE): **Netzmodus** erzwingen (nur 4G/LTE oder 3G)
  für niedrigere Latenz, **Daten-Roaming** umschalten (home-only), ein **Diagnose**-
  Button mit der rohen `mmcli`-Ausgabe (du siehst, was der Pi erkennt) und
  **SIM-PIN-Verwaltung** — PIN ändern oder die **PIN-Sperre ganz entfernen** (leere
  neue PIN = keine PIN). PIN-Aktionen wirken auf die SIM selbst und brauchen die
  aktuelle PIN.

## v1.18.3
**English**
- **Non-root operation**: added a ready-made minimal sudoers policy
  (`provisioning/yonderrc.sudoers`) for running the vehicle service as a non-root
  user — it grants passwordless sudo only for the privileged helpers (mmcli PIN,
  wg/wg-quick, zerotier-cli, install of the WireGuard conf, reboot). The default
  systemd unit runs as root, where it isn't needed. `zerotier-cli` is now invoked via
  sudo too, so ZeroTier works under a non-root user. Documented in provisioning/README.

**Deutsch**
- **Nicht-Root-Betrieb**: eine fertige, minimale sudoers-Policy
  (`provisioning/yonderrc.sudoers`) für den Betrieb des Fahrzeugdienstes als
  Nicht-Root-User — sie gewährt passwortloses sudo nur für die privilegierten Helfer
  (mmcli-PIN, wg/wg-quick, zerotier-cli, install der WireGuard-Conf, reboot). Die
  Standard-systemd-Unit läuft als root, dort ist sie nicht nötig. `zerotier-cli` wird
  jetzt ebenfalls via sudo aufgerufen, damit ZeroTier auch als Nicht-Root funktioniert.
  Dokumentiert in provisioning/README.

## v1.18.2
**English**
- **Much better LTE stick setup** (Setup › LTE) — no longer assumes pure plug-and-play:
  - **SIM PIN** unlock (`mmcli --pin`) for locked SIMs.
  - **APN username/password** for carriers that require APN auth.
  - **Richer status/diagnostics**: real modem model, registration state, live APN/IP,
    and a clear "SIM PIN required" flag (instead of just "idle").
  - The NM connection is created with **`autoconnect`** so it redials itself.
  - PIN/password are stored on the vehicle and **never returned** by the API.
  - The install script now adds **`usb-modeswitch`** for "Zero-CD" dongles.

**Deutsch**
- **Deutlich besseres LTE-Stick-Setup** (Setup › LTE) — nicht mehr reines Plug-and-Play:
  - **SIM-PIN**-Entsperrung (`mmcli --pin`) für gesperrte SIMs.
  - **APN-Benutzer/Passwort** für Anbieter mit APN-Auth.
  - **Reichere Statusanzeige/Diagnose**: echtes Modem-Modell, Registrierungsstatus, live
    APN/IP und eine klare „SIM PIN required"-Markierung (statt nur „idle").
  - Die NM-Verbindung wird mit **`autoconnect`** angelegt, wählt sich also selbst neu.
  - PIN/Passwort werden am Fahrzeug gespeichert und von der API **nie zurückgegeben**.
  - Das Install-Skript bringt jetzt **`usb-modeswitch`** für „Zero-CD"-Dongles mit.

## v1.18.1
**English**
- **Auto-disarm on reconnect is now coupled to the vehicle type** — the ground derives
  it from the active profile (car/boat = ON, plane/drone = OFF) and pushes it to the
  vehicle, so a brief reconnect can no longer cut an aircraft's motors in flight. The
  Controls (Safety) panel shows the current policy and why; the vehicle's manual toggle
  is now just a fallback used until a ground connects. Failsafe is unchanged and remains
  the primary link-loss safety.

**Deutsch**
- **Auto-Disarm bei Reconnect ist jetzt an den Fahrzeugtyp gekoppelt** — der Ground
  leitet es aus dem aktiven Profil ab (Auto/Boot = AN, Flugzeug/Drohne = AUS) und pusht
  es ans Fahrzeug, sodass ein kurzer Reconnect einem Luftfahrzeug nicht mehr im Flug die
  Motoren kappen kann. Das Controls-(Safety-)Panel zeigt die aktuelle Politik und warum;
  der manuelle Schalter am Fahrzeug ist nur noch ein Fallback, bis ein Ground verbindet.
  Failsafe bleibt unverändert die primäre Sicherheit bei Link-Verlust.

## v1.18.0
**English**
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

**Deutsch**
- **Wählbarer Remote-Zugang** (Setup › Remote access) — eine Methode, um das Fahrzeug
  hinter CGNAT/LTE zu erreichen:
  - **Tailscale** und **ZeroTier** — Zero-Config-Mesh-VPNs (ZeroTier: 16-stellige
    Network-ID eintragen, dann Node autorisieren).
  - **WireGuard** — eine **`.conf` hochladen** (z. B. FritzBox-Export); das Fahrzeug
    wendet sie mit `wg-quick` an; kommt beim Boot automatisch hoch.
  - Die gewählte Methode wird gespeichert und beim Boot hochgefahren; Secrets (Auth-Key,
    WG-Conf) gibt die API nie zurück. Alles hinter dem optionalen Shared Secret. *(ZeroTier/
    WireGuard sind im Simulator und per Unit-Tests geprüft; die echten `wg-quick`/
    `zerotier-cli`-Pfade sind nur auf Hardware verifizierbar — bitte am Pi testen.)*
- Das Pi-Install-Skript installiert jetzt zusätzlich `wireguard-tools` und ZeroTier.

## v1.17.4
**English**
- **Choose what drives the battery % gauge.** Setup › Telemetry now has a "Battery %
  source": **coulomb** (consumed mAh vs capacity), **voltage** (full/empty curve), or
  **clamp** (the lower of the two — safe default). The mAh readout (consumed/remaining)
  is shown regardless; this only changes the top-right % gauge. The OSD now labels the
  bar with its source (`mAh` / `volt` / `mAh·V`) so it's clear where the number comes from.

**Deutsch**
- **Wählbar, was die Akku-%-Anzeige speist.** Unter Setup › Telemetry gibt es jetzt eine
  „Battery % source": **coulomb** (verbrauchte mAh vs. Kapazität), **voltage**
  (Voll/Leer-Kurve) oder **clamp** (der niedrigere von beiden — sicherer Default). Die
  mAh-Anzeige (verbraucht/Rest) bleibt unabhängig; das ändert nur die %-Anzeige oben
  rechts. Das OSD beschriftet den Balken jetzt mit seiner Quelle (`mAh` / `volt` /
  `mAh·V`), damit klar ist, woher der Wert kommt.

## v1.17.3
**English**
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

**Deutsch**
- **Werksreset** — Fahrzeug und Ground. Fahrzeug: Setup › System → „Factory reset"
  leert die gespeicherte Config-Datei (inkl. API-Secret, live gelöscht, damit man
  sich nicht aussperrt); Neustart übernimmt die Defaults. Ground: Setup → „Reset app
  settings" löscht den gesamten `yonderrc.*`-Browser-Speicher (Modelle, Bindings,
  Aktionen, Akku, Secret) und lädt mit den Demo-Modellen neu.
- **Spannungs-Sicherheits-Floor für Akku-%** — optional volle/leere Pack-Spannung
  unter Setup › Telemetry setzen; der Akku-Prozentwert wird dann so begrenzt, dass er
  nicht höher als die Spannung anzeigt (reines Coulomb-Counting würde bei nicht-voll
  gestartetem Pack ~100 % zeigen). Liefert auch ohne Kapazität einen %-Wert.
- **SBUS-Treiber**: ein Serial-Fehler wird jetzt geloggt statt als unbehandelter
  Absturz; die Frames laufen weiter und der Watchdog hält Failsafe.

## v1.17.2
**English**
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

**Deutsch**
- **Telemetrie abschaltbar** (Setup › Telemetry → Source „off"). Standard bleibt Sim,
  aber für den ersten Flug kann man sie deaktivieren, damit das OSD **gar keine
  Fantasiewerte** zeigt. Die Ground-Seite blendet Telemetrie zudem aus, wenn das
  Fahrzeug keine mehr sendet — Abschalten im Betrieb hinterlässt keine alten Werte.
- **„Setup ↗"-Button** auf der Ground-Seite öffnet die Fahrzeug-Setup-Seite in einem
  neuen Tab, abgeleitet aus der Verbindungsadresse — funktioniert im LAN, über den
  AP des Pi oder eine Tailscale-IP (gleicher Host:Port wie der Steuer-Link, per http).
- **WebRTC-Option klarer erklärt**: Die Checkbox „Control via WebRTC data channel" hat
  jetzt Tooltip + Hinweis (latenzärmerer, NAT/LTE-freundlicher Steuerpfad mit
  automatischem WS-Fallback; Arm/Einstellungen laufen immer über WS).

## v1.17.1
**English**
- **Optional shared secret (off by default).** Set an "API secret" in the vehicle's
  Setup › Security. While unset, nothing changes — first-time connect and setup need
  no password. Once set, it's required for **saving settings** (mutating `/api/*`
  POSTs, via header `x-yonderrc-secret` or `?secret=`) **and for the control link**
  (the ground app's new "secret" field, sent as `?secret=`; a wrong/missing secret is
  rejected with WS close 4001). The secret is never returned by the API. Set/clear it
  live without a restart.

**Deutsch**
- **Optionales Shared Secret (standardmäßig aus).** Unter Setup › Security am Fahrzeug
  ein „API secret" setzen. Solange keins gesetzt ist, ändert sich nichts — der erste
  Verbindungsaufbau und das Setup brauchen kein Passwort. Einmal gesetzt, ist es nötig
  zum **Speichern von Einstellungen** (mutierende `/api/*`-POSTs, per Header
  `x-yonderrc-secret` oder `?secret=`) **und für den Steuer-Link** (neues „secret"-Feld
  in der Ground-App, als `?secret=`; falsches/fehlendes Secret → WS-Close 4001). Das
  Secret wird von der API nie zurückgegeben. Setzen/Löschen live ohne Neustart.

## v1.17.0
**English**
- **English-first documentation.** `README.md` and `docs/HARDWARE.md` are now
  English; the German originals live in `README.de.md` and `docs/HARDWARE.de.md`,
  with a language switcher at the top of each. No code changes — docs only.

**Deutsch**
- **Englisch als Hauptsprache der Doku.** `README.md` und `docs/HARDWARE.md` sind
  jetzt englisch; die deutschen Originale liegen in `README.de.md` und
  `docs/HARDWARE.de.md`, mit Sprachumschalter oben in jeder Datei. Keine
  Code-Änderungen — nur Dokumentation.

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
