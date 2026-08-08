# YonderRC

Fernsteuerung jenseits der Sichtweite über IP. Eine App für Video, Steuerung und
Konfiguration — Windows, Linux und Browser (inkl. Smartphone). Steuere Autos,
Boote, Flugzeuge oder Drohnen über LTE mit niedriger Latenz.

**v1.0.0 — Software komplett, Simulationsmodus.** Alle geplanten Funktionen sind
da und im Sim lauffähig; keine Hardware nötig. Die Hardware-Meilensteine (Video,
Treiber, LTE) warten nur noch aufs reale Gegentesten. Der komplette Steuerpfad
läuft auf einem PC (oder Handy im selben Netz), die 16 Kanäle reagieren live.

## Was heute funktioniert

- **Fahrzeug-Dienst** (`packages/vehicle`) mit austauschbarem `OutputDriver`.
  Vorerst existiert nur der `SimDriver` — er realisiert Kanäle, indem er sie sich
  merkt, läuft also überall und wirft keine Fehler bei fehlender Hardware.
- **Zeitbasierter Failsafe-Watchdog + Arming** im `VehicleCore`. Kommt innerhalb
  des Watchdog-Fensters kein Steuer-Frame an, gehen alle Kanäle auf ihren
  Failsafe-Wert. Gas-Kanäle bleiben im Disarmed-Zustand sicher. (Das ist der Fix
  für das alte „Runaway bei Verbindungsabbruch".)
- **Bodenstation** (`packages/ground`) — eine responsive React-Web-App. Steuern
  per Tastatur + On-Screen-Buttons (kein Controller nötig), oder Gamepad
  einstecken und die Sticks übernehmen die Achsen automatisch. Der Kanal-Monitor
  zeigt die tatsächliche Ausgabe des Fahrzeugs.
- **Geteiltes Protokoll** (`packages/protocol`) — ein Satz TypeScript-Typen für
  Wire-Nachrichten, Kanal-Modell und Profil-Schema, von beiden Seiten importiert.

## Architektur in einem Bild

```
   Boden (Web / später Electron)          Fahrzeug (Pi, oder dein PC im Sim)
   ┌───────────────────────────┐          ┌──────────────────────────────┐
   │ Input: Tastatur / Touch /  │  Steuer- │ Transport (WS jetzt,          │
   │        Gamepad             │  Frames  │            WebRTC später)     │
   │  → InputManager (µs)       │ ───────► │  → VehicleCore               │
   │ LinkClient  ◄──── Status ──│          │     · Arming                 │
   │ ChannelMonitor             │          │     · Failsafe-Watchdog       │
   └───────────────────────────┘          │  → OutputDriver (sim|pca9685  │
                                           │       |gpio-pwm|sbus)         │
                                           └──────────────────────────────┘
```

Alles oberhalb des Transports ist transport-unabhängig: v0.1 nutzt WebSocket
(trivial zu betreiben, funktioniert PC↔Handy im LAN); WebRTC (Video + Data
Channel) kommt in M2 dazu, ohne Protokoll oder App-Logik anzufassen.

## Starten

Benötigt Node 20+.

```bash
npm install
npm run dev
```

- Fahrzeug-Dienst startet auf `ws://localhost:8080` (Sim-Treiber).
- Bodenstation öffnet auf `http://localhost:5173`.

Bodenstation öffnen, **Connect** drücken, dann **Arm**, und mit `W A S D` /
Pfeiltasten fahren, `Space` (Hupe), `L` (Licht). Zum Testen vom Handy
`http://<PC-LAN-IP>:5173` öffnen — Dev-Server und Fahrzeug lauschen auf allen
Interfaces.

Beide Seiten getrennt starten, falls gewünscht:

```bash
npm run dev:vehicle
npm run dev:ground
```

Nützliche Env-Variablen fürs Fahrzeug: `YRC_PORT`, `YRC_WATCHDOG_MS`,
`YRC_THROTTLE_CH` (Komma-Liste), `YRC_SIM_LOG_MS` (Kanal-Logging im Terminal).

### Desktop-App (M5)

Dieselbe Boden-App läuft auch als Electron-Desktop-App für Windows und Linux — mit
nativem SDL2-Controller-Layer (riesige Controller-DB, Hot-Plug, Rumble) und
automatischem Fallback auf die Chromium-Gamepad-API, wenn SDL fehlt. Details und
Build-Anleitung: `packages/desktop/README.md`.

```bash
npm run dev:ground     # Web-App
npm run dev:vehicle    # Fahrzeug (Sim)
npm run dev:desktop    # Electron-Shell
# Installer bauen (Win + Linux):
npm run build:desktop
```

### Setup-UI & headless Betrieb (M4)

Der Fahrzeug-Dienst serviert eine eigene Konfigurationsseite unter
`http://<vehicle>:8080/setup` — Fahrzeugname, Ausgangstreiber, Kameras, Watchdog,
LTE-APN und Tailscale, alles vom Handy/Laptop aus, ganz ohne Bildschirm. Die
Einstellungen landen in `yonderrc-config.json` und überleben Neustarts.

Im Sim läuft die komplette Setup-UI mit gemocktem LTE/Tailscale (`SimSystem`), du
kannst sie also lokal ausprobieren:

```bash
npm run dev:vehicle
# → http://localhost:8080/setup
```

Für den echten Pi (LTE-Stick, Tailscale, WLAN-Hotspot-Fallback fürs Onboarding,
systemd-Dienste, Image) liegt alles unter `provisioning/` — siehe
`provisioning/README.md`. Auf dem Pi wird `YRC_SYSTEM=real` gesetzt, dann schaltet
die Setup-UI auf echte `tailscale`/`mmcli`/`nmcli`-Befehle um.

Robust by design: Schlägt ein per Setup gewählter Hardware-Treiber beim Start
fehl (Lib/Hardware fehlt), fällt der Dienst automatisch auf `sim` zurück und
bleibt erreichbar — ein headless Gerät wird nie tot und unkonfigurierbar.

### Steuerung über WebRTC (M2)

Im Drive-Tab „Control via WebRTC data channel" anhaken. Der WebSocket bleibt für
Handshake, Status und Signalisierung; sobald der Data-Channel offen ist, laufen
die Steuer-Frames darüber (Anzeige wechselt auf `WEBRTC`).

### Video testen (M2)

Video kommt von **go2rtc**. Am einfachsten mit Docker:

```bash
docker compose -f docker/docker-compose.yml up
```

Das startet Fahrzeug-Dienst + go2rtc mit einem synthetischen Testbild-Stream
(`test`). In der Boden-App erscheint das Bild im FPV-Panel mit OSD-Overlay. Ohne
Docker kannst du go2rtc auch direkt starten (`go2rtc -config docker/go2rtc.yaml`);
dafür muss `ffmpeg` installiert sein. Auf echter Hardware trägst du in
`docker/go2rtc.yaml` die Pi-Cam bzw. USB-Kamera ein (Beispiele sind auskommentiert
enthalten).

### Hardware-Treiber wählen (M3)

Der Ausgang wird über `YRC_DRIVER` gewählt — im Sim ohne Hardware bleibt `sim`.
Auf dem Pi:

```bash
YRC_DRIVER=pca9685 npm run start -w @yonderrc/vehicle   # I2C-PWM, 16 Kanäle
YRC_DRIVER=gpio-pwm npm run start -w @yonderrc/vehicle   # pigpio, jitterarm
YRC_DRIVER=sbus     npm run start -w @yonderrc/vehicle   # SBUS-UART an einen FC
```

Die nativen Libs (`i2c-bus`, `pigpio`, `serialport`) sind `optionalDependencies`
und werden nur geladen, wenn der jeweilige Treiber gewählt ist — dein Nicht-Pi-
`npm install` bleibt also sauber. Treiber-Optionen per Env: `YRC_I2C_BUS`,
`YRC_I2C_ADDR`, `YRC_PWM_FREQ`, `YRC_GPIO_PINS`, `YRC_SBUS_PATH`.

**ESC-Kalibrierung:** im Setup-Tab. Start legt Vollgas an (Propeller ab!), Next
schaltet auf Minimum, nochmal Next beendet. Läuft nicht-blockierend; das Fahrzeug
bleibt dabei disarmed und hält alle anderen Kanäle sicher.

## Roadmap

- **v0.1** — Sim-Skelett: Protokoll, Sim-Fahrzeug, responsive Boden-App,
  Kanal-Monitor, Failsafe + Arming, Tastatur/On-Screen/Basis-Gamepad. ✓
- **M1** — Profile + Kanal-Bindings (Quelle/Modus/Trim/Expo/Reverse/EPA/
  Failsafe), zum Fahrzeug gepusht und dort gespeichert. Plus virtueller Joystick. ✓
- **M2** — Video (go2rtc + WHEP-Player, OSD-Overlay, Kamera-Umschaltung) und
  Steuerung über WebRTC-Data-Channel (WS bleibt Signalisierung + Fallback). ✓
- **M3** — Hardware-Treiber (PCA9685, GPIO-PWM, SBUS) + nicht-blockierende
  ESC-Kalibrier-State-Machine. ✓
- **M4** — LTE + Tailscale + headless Provisioning + Setup-Web-UI auf dem Pi. ✓
- **M5** — Electron-Shell (Windows + Linux) + natives SDL2-Input mit Rumble;
  Halte-Rampen-Buttons und virtueller Joystick sind bereits ab M1 dabei. ✓
  ← Roadmap komplett (Hardware-Meilensteine M2–M4 warten aufs reale Gegentesten)

### TODO-Parkplatz (für später vereinbart)

- ~~Proportional-über-Haltedauer-Buttons~~ ✓ (hold-ramp-Modus seit M1)
- Vollwertiger virtueller Joystick (Multitouch, Deadzone, Federrücklauf, Skalierung).
- Gamepad-Lern-/Kalibrier-UI („beweg jetzt den Gas-Stick") für beliebige Controller.
- WebHID für exotische Controller.
- Telemetrie-Rückkanal + OSD-Spannung (braucht Sensor); Protokoll reserviert ihn.

## Lizenz

Noch nicht festgelegt.
