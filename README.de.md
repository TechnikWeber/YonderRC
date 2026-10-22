[English](README.md) · **Deutsch**

# YonderRC

Fernsteuerung über das Internet für RC-Autos, -Boote, -Flugzeuge und -Drohnen — mit
Live-Video, Telemetrie und Einstellungen im Browser. Ein Raspberry Pi im Fahrzeug; am
Boden ein Browser, ein Handy oder die Desktop-App. Ausgelegt für LTE.

Alles läuft auch **im Simulator, ganz ohne Hardware**.

![Bodenstation im Fahrbetrieb: FPV-Video mit vollem OSD — GPS-Fix und Home-Kompass mit Distanz, Odometer und Speed oben links, Akku-Balken oben rechts, Spannung/Strom/mAh unten rechts, Link-Gesundheitszahl oben Mitte](docs/screenshots/Overview_OSD.png?v=5)

## Was es kann

- **Von überall fahren**: 16 Kanäle, latenzarmes FPV-Video (WebRTC), über LTE, WLAN oder
  ein VPN.
- **Sicher ab Werk**: Failsafe nach 500 ms ohne Signal — das Fahrzeug stoppt, hält oder
  nimmt den Motor weg, je nach Typ. Halten zum Armen, Panic-Disarm, Pre-Arm-Check.
- **Jede Eingabe**: Touch-Sticks am Handy, Tastatur, Gamepad oder ein RC-Sender im
  Joystick-Modus.
- **Modelle** für Auto, Boot, Flugzeug und Drohne mit fertigen Kanal-Vorlagen; Trim, Expo,
  Endpunkte, Kennlinien, Folgekanäle und ein Speed-Limiter.
- **Telemetrie**: Akkuspannung, Strom, mAh, Temperaturen, GPS mit Heimweg, Sprachansagen,
  ein Blackbox-Log.
- **Setup-Seite am Fahrzeug**: WLAN, LTE, Fernzugriff (Tailscale, ZeroTier, WireGuard),
  Kameras, Sensoren, Updates — vom Handy, ohne Bildschirm am Pi.
- **Problembericht in einer Datei**, die in Klartext sagt, was schiefging.

Die vollständige Liste: [`docs/FEATURES.de.md`](docs/FEATURES.de.md).

## Loslegen

| Du willst … | Lies |
| --- | --- |
| es ohne Hardware ausprobieren | [den Simulator](#im-simulator-ausprobieren), unten |
| ein Fahrzeug aufbauen, Schritt für Schritt | [`docs/QUICKSTART.de.md`](docs/QUICKSTART.de.md) |
| Teile, Verkabelung, LTE und Fernzugriff sehen | [`docs/HARDWARE.de.md`](docs/HARDWARE.de.md) |
| etwas reparieren, das nicht geht | [`docs/TROUBLESHOOTING.de.md`](docs/TROUBLESHOOTING.de.md) |
| aus einem eigenen Programm steuern | [die Desktop-App](#desktop-app), unten |

Auf einem Raspberry Pi mit angeschlossener Hardware installiert eine Zeile alles:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Danach `http://<pi-ip>:8080/setup` öffnen.

## Im Simulator ausprobieren

Läuft unter Windows, Linux und macOS. Du brauchst [Node.js](https://nodejs.org) 20 oder
neuer (npm ist dabei) und [Git](https://git-scm.com); für Video zusätzlich `ffmpeg`. Kein
Compiler: Die Hardware-Treiber sind optional und werden auf einem PC übersprungen.

| System | Einmal installieren |
| --- | --- |
| Windows | `winget install OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg`, danach ein neues Terminal öffnen |
| Debian / Ubuntu | `sudo apt install git ffmpeg`, Node.js von [nodejs.org](https://nodejs.org/de/download) (das Systempaket ist oft älter als 20) |
| Fedora | `sudo dnf install nodejs git ffmpeg-free openh264` |
| macOS | `brew install node git ffmpeg` |

Dann in einem Terminal (unter Windows PowerShell):

```bash
git clone https://github.com/TechnikWeber/YonderRC.git
cd YonderRC
npm install
npm run dev
```

`http://localhost:5173` öffnen, **Connect** drücken, **Arm 1 s halten** und mit
`W A S D` fahren. Vom Handy: `http://<IP-deines-PCs>:5173`.

Für Video `npm run dev:video` in einem zweiten Terminal im selben Ordner starten. Beim
ersten Mal lädt es go2rtc nach `bin/`. Tests: `npm test`.

Windows blockiert beim ersten Start eine Datei („Anwendungssteuerungsrichtlinie“)? Siehe
[Fehlersuche §5](docs/TROUBLESHOOTING.de.md#5-probleme-bei-der-installation).

## Desktop-App

Dieselbe Steuer-App als eigenes Programm, für Windows und Linux. Sie liest Gamecontroller
direkt (SDL): lohnt sich, wenn der Browser deinen Controller nicht kennt, oder für
Vibration. Alles andere ist wie im Browser.

- **Download** im [neuesten Release](https://github.com/TechnikWeber/YonderRC/releases/latest):
  `…-windows-setup.exe` (installiert), `…-windows-portable.exe` (läuft ohne Installation)
  oder `…-linux-x86_64.AppImage`.
- **Windows**: Die Dateien sind **nicht signiert**. SmartScreen warnt — *Weitere
  Informationen › Trotzdem ausführen*. Ist die intelligente App-Steuerung an, blockiert
  Windows sie ganz; dann den Browser nehmen oder die App aus dem Quellcode starten (unten).
- **Linux**: `chmod +x YonderRC-*.AppImage`, dann starten. Ab Ubuntu 22.04 braucht es
  `libfuse2` (`sudo apt install libfuse2`; unter 24.04 `libfuse2t64`). Das AppImage wird
  automatisch gebaut und ist **noch nicht auf einem echten Linux-Desktop getestet** — wenn
  es nicht startet, bitte ein Issue aufmachen.
- **Aus dem Quellcode**: Während `npm run dev` läuft, `npm run dev:desktop` in einem
  zweiten Terminal starten. Mehr in [`packages/desktop`](packages/desktop/README.md).

## Wie dieser Code entstanden ist

YonderRC ist **mit KI-Unterstützung** entstanden: Der Großteil des Codes stammt von
Anthropics Claude nach den Vorgaben des Autors, und jede Änderung prüft ein Mensch, bevor
sie ausgeliefert wird. Die Commits tragen eine `Co-Authored-By: Claude`-Zeile.

- Alles ist von der Testsuite abgedeckt; die Sicherheitslogik wird ohne Hardware getestet.
- **Der Simulator-Pfad ist geprüft. Der Hardware-Pfad nicht vollständig** — Treiber,
  Sensoren, LTE und Video lassen sich nur auf einem echten Pi beweisen, und die Doku sagt,
  wo.
- **Prüfe es selbst, bevor du ihm ein Fahrzeug anvertraust.**

## Sicherheit & Recht

YonderRC steuert **echte Fahrzeuge** und kann Schäden, Verletzungen oder den Tod
verursachen. Es kommt **„wie besehen", ohne jede Gewährleistung**; der Autor übernimmt
**keine Haftung**.

- Fliegen oder Fahren außerhalb der Sichtweite (FPV, BVLOS) ist **in vielen Ländern
  beschränkt oder verboten**. **Prüfe die Gesetze bei dir**, bevor du es einsetzt.
- Failsafe und Arming aktiviert lassen, zuerst im Simulator und auf der Werkbank testen,
  Abstand zu Menschen halten und dich nie allein auf die Verbindung verlassen.
- Die Nutzung erfolgt **auf eigenes Risiko.** Siehe [`LICENSE`](LICENSE).

## Lizenz

[PolyForm-Noncommercial-1.0.0](LICENSE) **plus: keine militärische Nutzung**. Kostenlos
nutzen, verändern und weitergeben; nichts Kommerzielles, nichts Militärisches. Hinweise und
Fremdkomponenten: [NOTICE.md](NOTICE.md). Änderungen: [`CHANGELOG.md`](CHANGELOG.md) und
die [Releases](https://github.com/TechnikWeber/YonderRC/releases).
