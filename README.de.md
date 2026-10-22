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
