# YonderRC

Fernsteuerung jenseits der Sichtweite über IP — eine App für **Video, Steuerung
und Konfiguration** von Autos, Booten, Flugzeugen und Drohnen. Läuft im Browser
(inkl. Smartphone), als Desktop-App (Windows/Linux) und auf einem Raspberry Pi als
Fahrzeugrechner. Niedrige Latenz, ausgelegt für den Betrieb über LTE.

Alles ist **im Simulator lauffähig — ganz ohne Hardware**. Für den echten Aufbau
auf dem Pi (Teileliste, Verkabelung, Schritt für Schritt WLAN → LTE) siehe
[`docs/HARDWARE.md`](docs/HARDWARE.md).

---

## Was YonderRC kann

**Steuerung**
- 16 Kanäle über WebSocket oder WebRTC-Data-Channel; Tastatur, On-Screen-Buttons,
  Gamepad oder vollwertiger Touch-Joystick (Multitouch, Deadzone, Federrücklauf).
- **Modelle** für Auto / Boot / Flugzeug / Drohne mit passenden Kanal-Vorlagen,
  wählbarer Eingabemethode und pro Achse einstellbarem Einrasten (Mitte/Min/frei).
- Pro Kanal Trim, Expo, Reverse, Endpunkte (µs) und Failsafe-Wert.

**Sicherheit**
- Zeitbasierter **Failsafe-Watchdog**: bleiben Steuer-Frames aus, gehen alle Kanäle
  auf ihren Failsafe-Wert. **Modellabhängig und getrennt vom Disarmen** — eine
  Drohne *hält* bei Link-Verlust (Gas mittig), Auto/Boot *stoppt*, Flugzeug geht
  auf *Motor aus*.
- **Arming**; jede neue Verbindung startet disarmed. **Auto-Disarm bei Reconnect**
  ist abschaltbar (für Flugzeug/Drohne, wo Disarmen im Flug die Motoren kappt).
- Modellwechsel und Einstellungen sind im gearmten Zustand gesperrt.

**Video (FPV)**
- Latenzarmes Video über **go2rtc/WebRTC**; H.264-Encoder wird automatisch erkannt
  (`libx264`, `libopenh264`, Pi-Hardware).
- **Selbstheilend**: erkennt eingefrorenes/abgerissenes Bild und verbindet sich
  automatisch neu; der letzte Frame bleibt stehen.
- **Video-Qualität live umschaltbar** von der Groundstation (High/Medium/Low).
- OSD mit Status, Kanälen, **Bitrate/Paketverlust/FPS/Video-Latenz** und Telemetrie.
- **Aufnahme & Standbild** lokal (Ordner einmal vorwählen; auf Taste oder
  Controller-Button legbar).

**Telemetrie**
- Spannungs-/Stromsensoren (real: ADS1115/1015, MCP3008/3208, INA219/226/260/3221,
  ACS712/758 — oder Sim), **präzises Coulomb-Counting** (verbrauchte mAh) und
  **Batterie-Prozent** aus der eingestellten Kapazität. Sim-Werte sind klar als
  **SIM** markiert; fehlt ein echter Sensor, zeigt das OSD **„NO SENSOR"** statt
  gefälschter Werte.

**Betrieb & Einrichtung**
- Grafische **Setup-Seite** direkt vom Fahrzeug (`/setup`): Treiber, Kameras,
  Telemetrie, Watchdog, LTE-APN, Tailscale — vom Handy/Laptop, ohne Bildschirm.
- **Geführter Hardware-Selbsttest**: Kanal-Sweep, Sensoren lesen, Kamera-Standbild.
- **Autark im Feld**: ohne Netz startet der Pi einen WLAN-Hotspot und öffnet per
  **Captive Portal** die Steuer-/Setup-Seite — die Boden-App wird vom Pi selbst
  ausgeliefert, Steuern und Konfigurieren gehen also mit dem bloßen Handy.
- Hardware-Treiber **PCA9685 / GPIO-PWM / SBUS** (native Libs sind optional),
  nicht-blockierende **ESC-Kalibrierung**, LTE + **Tailscale** gegen CGNAT.
- **Desktop-App** (Electron) mit nativem SDL2-Controller-Layer (Hot-Plug, Rumble)
  und Fallback auf die Browser-Gamepad-API.

---

## Schnellstart

Benötigt Node 20+.

```bash
npm install
npm run dev
```

- Fahrzeug-Dienst: `ws://localhost:8080` (Sim-Treiber), Setup unter `/setup`.
- Bodenstation: `http://localhost:5173`.

**Connect** drücken, dann **Arm**, und mit `W A S D` / Pfeiltasten fahren. Vom Handy
`http://<PC-LAN-IP>:5173` öffnen (Dev-Server und Fahrzeug lauschen auf allen
Interfaces).

**Video im Sim** (synthetisches Testbild, braucht `ffmpeg`):

```bash
npm run dev            # Terminal 1: Fahrzeug + Boden-App
npm run dev:video      # Terminal 2: go2rtc mit Testbild
```

Reihenfolge beachten: `npm run dev` erkennt den H.264-Encoder und schreibt die
go2rtc-Config; danach `npm run dev:video`. Fedora: `sudo dnf install -y openh264 ffmpeg-free`.

**Tests:**

```bash
npm test               # Sicherheits-/Logik-Testsuite
```

---

## Auf echter Hardware

Kompletter Aufbau auf dem Raspberry Pi — Teileliste, Verkabelung, Pi-Einrichtung,
erst im WLAN, dann Umstellung auf LTE mit Tailscale — in
**[`docs/HARDWARE.md`](docs/HARDWARE.md)**.

**1. Repo auf den Pi kopieren** (`/opt/yonderrc`) — ein Weg genügt:

```bash
# a) git clone (wenn der Pi Internet hat)
sudo mkdir -p /opt/yonderrc && sudo chown $USER /opt/yonderrc
git clone https://github.com/TechnikWeber/YonderRC.git /opt/yonderrc

# b) scp vom Laptop (dein lokales Repo auf den Pi kopieren) — auf dem LAPTOP ausführen:
scp -r ~/YonderRC pi@yonderrc.local:/tmp/YonderRC
ssh pi@yonderrc.local 'sudo mkdir -p /opt/yonderrc && sudo cp -a /tmp/YonderRC/. /opt/yonderrc/'

# c) USB-Stick (Pi ohne Netz) — Stick einstecken, dann auf dem Pi:
sudo mkdir -p /opt/yonderrc && sudo cp -a /media/*/YonderRC/. /opt/yonderrc/   # Pfad ggf. via lsblk prüfen
```

**2. Installieren und einrichten:**

```bash
sudo bash /opt/yonderrc/provisioning/install.sh   # Node, ffmpeg, go2rtc, systemd, I2C/UART
# dann grafisch unter  http://<pi>:8080/setup  einrichten
```

Treiber-Auswahl per Env (Details in HARDWARE.md und `provisioning/README.md`):

```bash
YRC_DRIVER=pca9685 npm run start -w @yonderrc/vehicle   # I2C-PWM, 16 Kanäle
YRC_DRIVER=gpio-pwm npm run start -w @yonderrc/vehicle   # pigpio
YRC_DRIVER=sbus     npm run start -w @yonderrc/vehicle   # SBUS an einen Flight Controller
```

Schlägt ein Hardware-Treiber beim Start fehl, fällt der Dienst automatisch auf
`sim` zurück und bleibt erreichbar — ein headless Gerät wird nie unkonfigurierbar.

---

## Projektstruktur

```
packages/
  protocol/   geteilte TypeScript-Typen (Wire-Nachrichten, Kanäle, Profile, Telemetrie)
  vehicle/    Fahrzeug-Dienst (Node/tsx): Core, Failsafe, Treiber, Sensoren, go2rtc, Setup
  ground/     Bodenstation (React): Steuerung, FPV, OSD, Aufnahme, Setup-UI
  desktop/    Electron-Shell mit nativem SDL2-Input
docs/HARDWARE.md   Hardware-Guide
provisioning/      Pi-Setup (systemd, LTE, Tailscale, Hotspot/Onboarding)
test/              Testsuite (npm test)
```

Alles oberhalb des Transports ist transport-unabhängig; die Steuerung läuft über
WebSocket (Fallback + Signalisierung) oder den WebRTC-Data-Channel.

---

## Versionen

Die aktuellen Änderungen stehen in [`CHANGELOG.md`](CHANGELOG.md) und in den
[GitHub-Releases](https://github.com/TechnikWeber/YonderRC/releases). Diese README
beschreibt immer den aktuellen Stand.

## Lizenz

YonderRC steht unter **CC BY-NC-ND 4.0** (Namensnennung – nicht kommerziell –
keine Bearbeitung) **mit einem Zusatz: keine militärische oder kriegerische
Nutzung**. Kurz: kostenlos nutzen und unveränderte Kopies mit Quellenangabe
weitergeben; kein Verändern, keine kommerzielle und keine militärische Nutzung.
Der volle Text steht in [`LICENSE`](LICENSE).
