[English](README.md) · **Deutsch**

# YonderRC

Fernsteuerung jenseits der Sichtweite über IP — **Video, Steuerung und Konfiguration**
für Autos, Boote, Flugzeuge und Drohnen. Läuft im Browser (inkl. Smartphone), als
Desktop-App (Windows/Linux) und auf einem Raspberry Pi als Fahrzeugrechner. Ausgelegt
für LTE.

Alles läuft **im Simulator, ganz ohne Hardware**. Für den echten Aufbau siehe
[`docs/HARDWARE.de.md`](docs/HARDWARE.de.md).

![Bodenstation im Fahrbetrieb: FPV-Video mit vollem OSD — GPS-Fix und Home-Kompass mit Distanz, Odometer und Speed oben links, Akku-Balken oben rechts, Spannung/Strom/mAh unten rechts, Link-Gesundheitszahl oben Mitte](docs/screenshots/Overview_OSD.png?v=5)

*FPV mit vollem OSD: GPS + Home-Kompass, Distanz, Odometer und Speed (oben links),
Akku-Balken (oben rechts), Spannung/Strom/mAh (unten rechts), Link-Gesundheit als eine
Zahl (oben Mitte). Hell oder dunkel wird am Fahrzeug gewählt (Setup › Design).*

---

## Was YonderRC kann

**Steuerung**
- 16 Kanäle über WebSocket oder WebRTC-Datenkanal; Tastatur, Bildschirmtasten, Gamepad
  oder vollwertiger Touch-Joystick (Multitouch, Deadzone, Federrückstellung).
- **Der richtige Controller**: jedes Gerät, das der Browser meldet, wird mit seiner
  Einschätzung angezeigt; ein Headset oder die Bewegungssensoren eines Pads werden nie
  automatisch gewählt, und die Wahl wird gemerkt (Setup › Controls › Game controller).
- **Modelle** für Auto / Boot / Flugzeug / Drohne mit passenden Kanal-Vorlagen,
  wählbarer Eingabemethode und Rastung pro Achse (Mitte/Min/frei).
- Pro Kanal: Trim, Expo, Reverse, Endpunkte (µs), Failsafe-Wert. Verbunden zeigt jeder
  Kanal auch seinen Ausgang an der Hardware (`CH03 · out 2`).
- **Kennlinien** pro Stick-Kanal (3/5/7/9 Punkte, Live-Plot) für Formen, die Expo nicht
  abbilden kann. Standardmäßig aus.
- **Live-Trims** unter den Sticks: 5 µs pro Druck, bis ±150 µs, im Modell gespeichert —
  auch auf zwei belegbaren Tasten oder Controller-Knöpfen (Trim −/+), standardmäßig die
  Lenkung.
- **Zwei Tasten als eine Achse**, z. B. RT/R2 vorwärts und LT/L2 zurück bei Auto oder Boot.
  Controller-Tasten haben im Browser und in der Desktop-App dieselben Nummern.
- **Folgekanäle** für ein zweites Lenkservo oder einen zweiten Regler: eine Kopie eines
  anderen Kanals mit eigenem Versatz, Reverse und Endpunkten. Failsafe und Disarm folgen mit.
- **Speed-Limiter**, drei Stufen, im Fahren umschaltbar. Skaliert um die Ruhelage des
  Gaskanals — ein Auto wird in beide Richtungen begrenzt, ein Flugzeug nur nach oben.

![Touch-Steuerung: ein großer Lenk-/Gas-Stick, der Halten-zum-Armen-Button, Licht- und Hupe-Tasten, der Speed-Limiter, der WebRTC-Schalter und eine Statusleiste](docs/screenshots/TouchInputs_and_Status.png?v=5)

*Touch-Steuerung, Halten-zum-Armen, Speed-Limiter, WebRTC-Schalter und eine
Statusleiste: Link, Zustand, Session, Round-Trip, Verbindungslücken, Eingabe, Fahrzeug,
Telemetrie.*

**Am Handy**
- Eine normale Webseite — über LAN, den Hotspot des Pi oder eine VPN-Adresse öffnen.
  Keine Installation; das Fahrzeug liefert sie selbst aus.
- **Responsives Layout** und ein **kompaktes OSD**, das Nebenwerte weglässt, damit es
  das Bild nicht mehr verdeckt (FPV › ⚙ › *OSD size*).

<details>
<summary><b>Handy-Ansicht — zum Ausklappen klicken</b></summary>

![YonderRC am Handy: FPV mit kompaktem OSD, umgebrochene Werkzeugtasten, Arm-Button und Touch-Joysticks](docs/screenshots/Mobile_FPV.jpeg?v=5)

*Dieselbe App bei 390 px: kompaktes OSD, umgebrochene FPV-Werkzeuge, Arm-Button und
Touch-Stick.*

</details>

**Sicherheit**
- **Failsafe-Watchdog**: bleiben Steuerpakete 500 ms aus (einstellbar, 100–2000), geht
  jeder Kanal auf seinen Failsafe-Wert. **Fahrzeugtyp-abhängig und getrennt vom
  Entschärfen** — Drohne *hält*, Auto/Boot *stoppt*, Flugzeug geht auf *Motor aus*.
- **Armen**; jede Verbindung startet entschärft. Auto-Disarm beim Reconnect folgt dem
  Fahrzeugtyp (Auto/Boot an, Flugzeug/Drohne aus), in Setup › Controls überschreibbar.
- **Halten zum Armen** (Standard 1 s) für Armen *und* Entschärfen, am Button und an
  einer gebundenen Taste. Einstellbar, abschaltbar. **Panic-Disarm bleibt sofortig** und
  wird **ohne Belegung** ausgeliefert, damit du eine Taste wählst, die du nicht
  versehentlich triffst.
- **Pre-Arm-Check**: Gas muss in Ruhelage stehen.
- **Stick-Feedback** (standardmäßig aus): Klick oder Vibration in der Mitte und am Rand —
  ein Daumen auf Glas hat keine Kante zum Fühlen. iPhones können aus einer Webseite nicht
  vibrieren, deshalb ist der Klick der Standard.
- Modellwechsel und Einstellungen sind gesperrt, solange geschärft.
- **Optionales Shared Secret** (standardmäßig aus) für Steuerlink und Setup-API.

![Kanal-Monitor: die tatsächliche µs-Ausgabe pro Kanal, Gas „HELD SAFE · DISARMED"](docs/screenshots/ChannelOutput_Monitor.png?v=5)

*Die **echte** Fahrzeugausgabe in µs, inklusive Failsafe und Disarm.*

**Video (FPV)**
- Latenzarmes Video über **go2rtc/WebRTC**; H.264-Encoder wird erkannt (`libx264`,
  `libopenh264`, Pi-Hardware).
- **Selbstheilend**: erkennt ein eingefrorenes Bild und verbindet neu; das letzte Bild
  bleibt stehen.
- **Qualität live umschaltbar** (hoch/mittel/niedrig) oder **Auto** — startet niedrig,
  steigt bei klar gutem Link, fällt schnell wieder ab.
- **CSI-Kameramodul im Browser wählbar.** Nur die vier offiziellen Pi-Sensoren werden
  automatisch erkannt; alles andere braucht ein Device-Tree-Overlay, das Setup schreibt
  (ein Backup, Reboot wird angezeigt). **Drehung/Spiegelung** und, wenn das Modul einen
  Aktuator hat, der **Fokus** sind pro Kamera einstellbar.
- **Keine Kamera ist eine unterstützte Konfiguration**: alle Einträge entfernen, und der
  FPV-Bereich bleibt dunkel, während OSD, Telemetrie und Steuerung weiterlaufen.
- OSD mit Status, Kanälen, Bitrate/Loss/FPS/Video-Latenz und Telemetrie. Jeder Block und
  jeder einzelne Sensorwert ist abschaltbar.
- **Aufnahme & Schnappschüsse** lokal, an Taste oder Button bindbar.

**Telemetrie**
- Spannungs-/Stromsensoren (ADS1115/1015, MCP3008/3208, INA219/226/228/237/238/260/3221,
  ACS712/758 — oder Sim), **Coulomb-Zählung** und **Akku-%** aus der Kapazität.
- Sim-Werte sind mit **SIM** markiert; ein fehlender echter Sensor zeigt **NO SENSOR**,
  niemals erfundene Zahlen. Telemetrie ist ganz abschaltbar.
- **%-Quelle wählbar**: Coulomb, eine Voll/Leer-Spannungskurve oder **Clamp** (der
  kleinere der beiden).
- **Temperatur, 1..n**: Pi-SoC, DS18B20, MCP9808 / TMP102 / TMP117 / BMP280 / BME280,
  MAX6675 / MAX31855 / MAX31856 / MAX31865, oder ein NTC/PT100 an ADS1115 / MCP3008.
- **Beliebig viele Kanäle, einzeln schaltbar** im OSD; Labels erscheinen, sobald eine Art
  mehr als einen Kanal hat.
- **Ein Kanal ist *primary*** und treibt Akku-%, mAh/Wh, Warnung und Blackbox — ein
  zweiter Sensor kann die Akku-Rechnung also nicht still übernehmen.
- **INA228 (empfohlen)** zählt die Ladung in Hardware, die mAh hängen also nicht mehr an
  der Abtastrate. 85 V Bus, 20 Bit. INA237/238 sind dieselbe Familie ohne Zähler.
- **Unterspannungswarnung** auf Prozent / Spannung / mAh, mit blinkendem OSD-Marker,
  Rumble und Piepton.
- **Heimkehr-Energiebudget** (standardmäßig aus): misst den Verbrauch pro km und
  beantwortet, *wie viel weiter du noch darfst und trotzdem heimkommst*. Ein Prozentwert
  kann das nicht — 30 % reichen bei 50 m und nicht bei 800 m. Braucht Kapazität,
  Stromsensor und Home-Punkt.
- **Sprachansagen** (standardmäßig an, offline): Link verloren/zurück, Failsafe,
  Arm-Zustand, leerer Akku. Ein Piep sagt, *dass* etwas war, eine Stimme sagt *was*.
- **Link-Gesundheit als eine Zahl**: Round-Trip, Loss und Signal als 0–100 mit
  Trendpfeil. Es ist der **schlechteste** der drei, kein Mittelwert. Die Einzelwerte
  kommen von selbst zurück, sobald der Link schlecht wird.
- **Blackbox-Logging** (standardmäßig aus): 2-Hz-CSV mit Arm/Failsafe, Link, Round-Trip,
  Bitrate, Loss, FPS, Video-Latenz, mAh, Prozent, **einer Spalte pro Telemetriekanal**
  und dem GPS-Track in derselben Zeile — die Route lässt sich damit in QGIS nach
  Akkuspannung einfärben. Ein zweiter Knopf exportiert reines **GPX**.

**GPS & Navigation**
- **Wählbare Quelle**: serieller NMEA-Empfänger, USB-Dongle über **gpsd**, **Sim** oder
  (später) MAVLink — alle auf einen Fix normalisiert. Setup gibt die Header-UART frei
  (Raspberry Pi OS parkt dort eine Login-Konsole) und zählt eingehende Sätze, ein
  Empfänger ist also drinnen prüfbar, wo es nie einen Fix geben wird.
- **Home-Punkt**, manuell oder automatisch beim ersten guten Fix. Das OSD zeigt Fix +
  Satelliten und, sobald Home steht, Distanz und Richtung zurück.

**Betrieb & Einrichtung**
- **Datenvolumen-Budget**: zählt jede kostenpflichtige Verbindung (LTE-Stick,
  Handy-Hotspot, getethertes Notebook) und zeigt **⚠ DATA** ab einem eingestellten
  Anteil. Eigener Hotspot und VPN-Schnittstellen sind ausgenommen — kostenlos bzw.
  doppelt gezählt. Alternativ der Abrechnungsmonat eines HiLink-Sticks. Übersteht
  Neustarts.
- **Verbindungslücken**: ein Watchdog-Auslöser dauert einen Steuertakt und ist vorbei,
  bevor man ihn lesen kann. Die Statusleiste zählt die Episoden pro Verbindung und die
  längste Wartezeit auf einen Frame.
- **Problembericht in einer Datei**: *Setup › Diagnostics* schreibt beide Hälften — wie
  regelmäßig die App wirklich gesendet hat, die Lücken, die das Fahrzeug empfangen hat,
  jede Failsafe-Episode, WLAN-Energiesparen, Versorgung, Last, Logs — und sagt in
  Klartext, was auffällt. Geheimnisse und die GPS-Position werden entfernt. Wie man sie
  schickt: [`docs/TROUBLESHOOTING.de.md`](docs/TROUBLESHOOTING.de.md).
- Grafische **Setup-Seite** am Fahrzeug (`/setup`): Treiber, Kameras, Telemetrie,
  Watchdog, WLAN, LTE, Fernzugriff, Sicherheit — vom Handy, ohne Bildschirm.
  **WLAN-Einrichtung**: scannen, wählen, verbinden; der Hotspot kommt zurück, wenn das
  Passwort falsch war, und kann neben LTE oben bleiben. Die Boden-App hat einen
  **Setup ↗**-Shortcut.

  ![Setup-Seite des Fahrzeugs, Tab Overview: Tabs oben, darunter Systemstatus — Modus, LTE-Modem und Betreiber, Fernzugriff, WLAN und je eine Zeile für Sensoren, GPS und Kameras — gefolgt von Hardware-Test, Software-Update und Systemtasten](docs/screenshots/VehicleConfig_Setup.png?v=5)

  *Tabs — Overview · Network · Remote access · Sensors & outputs · Camera · GPS · Design,
  jeder eine URL (`…/setup#gps`). Overview beantwortet „ist alles da?" auf einem Schirm.*
- **Fernzugriff, eine Methode**: **Tailscale**, **ZeroTier** oder **WireGuard** — die
  `.conf` vom eigenen Server oder der FritzBox hochladen oder die Werte eintippen. Kommt
  beim Booten hoch. **OpenVPN** für einen vorhandenen OpenVPN-Server gibt es auch,
  **experimentell**: Skripte in einem hochgeladenen Profil werden entfernt, das Fahrzeug
  behält seinen eigenen Uplink.
- **Robustes LTE**: APN, SIM-PIN, APN-Benutzer/Passwort, 4G-only, Roaming-Schalter, rohe
  `mmcli`-Diagnose, PIN ändern/entfernen. `autoconnect` wählt selbst neu.
- **Auch HiLink-Sticks** (Huawei E3372h-320 & Co.). Das sind Router, für `mmcli`
  unsichtbar — YonderRC liest die eigene API des Sticks für Zustand, Betreiber und
  Signal. Gefunden wird er über die **Routing-Tabelle**, nie über den Interface-Namen;
  seine Konfigurationsseite wird auf Port 8081 durchgereicht.
- **Native Treibermodule aus dem Browser installieren**: `i2c-bus`, `pigpio`,
  `serialport`, je ein Knopf. Ein fehlgeschlagener Build wird in Ursache und den
  Befehl übersetzt, der es behebt.
- **Das WLAN-Funkmodul repariert sich selbst**: Pi OS hält es rfkill-gesperrt, bis ein
  WLAN-Land gesetzt ist, und NetworkManager sagt nur „device is not available". Setup
  entsperrt es.
- **Update von der Setup-Seite**: Prüfen zeigt die anstehenden Commits; Update holt sie,
  installiert Abhängigkeiten, baut die Boden-App neu und startet neu.
- **Geführter Hardware-Selbsttest**: Kanal-Sweep, Sensoren lesen, Kamera-Schnappschuss.
- **Das Fahrzeug meldet seinen eigenen Zustand**: **⚠ POWER** im OSD, solange die
  5-V-Schiene einbricht (ein Brownout-Reset ist von unten nicht von einem Absturz zu
  unterscheiden), dazu SoC-Temperatur, Load, Uptime und freier Kartenplatz in der
  Übersicht. Die Uhr wird nur gemeldet, wenn sie falsch ist — ein Pi ohne gepufferte Uhr
  startet in der Vergangenheit, und `git pull` scheitert dann mit einem
  Zertifikatsfehler, der die Zeit nie erwähnt.
- **Von der Seite herunterfahren.** Strom mitten im Schreibvorgang zu ziehen ist, woran
  SD-Karten sterben. Verweigert, solange geschärft — wie Dienst-Neustart, Reboot, Update
  und Werksreset.
- **Werksreset** für Fahrzeug und Boden-App.
- **Autark im Feld**: der Pi startet seinen eigenen Hotspot, sobald das Funkmodul frei
  ist, und öffnet die Seite per **Captive Portal**.
- Hardware-Treiber **PCA9685 / GPIO-PWM / SBUS** (native Libs optional), nicht
  blockierende **ESC-Kalibrierung**.
- **Desktop-App** (Electron) mit nativer SDL2-Eingabe (Hot-Plug, Rumble).

**Im Feld gemessen** (21.08.2026, ein Nachmittag, ein Netz, ein Ort — kein Benchmark):
Pi 4 an einem Huawei E3372h-320 mit interner Antenne, gesteuert von einem Laptop über
Tailscale, Ethernet abgezogen.

| | |
| --- | --- |
| Steuer-Round-Trip | 110 ms |
| Video-Latenz | 128 ms |
| Bitrate | 444 kbps |
| LTE-Signal | 52 % (≈ −106 dBm RSRP) |
| Pfad | direkt über IPv6, kein DERP-Relay |

Die Link-Gesundheit stand auf 52 und nannte `SIGNAL` als begrenzenden Teil. Failsafe löste
aus und ging zurück wie vorgesehen, während der Link von WLAN auf LTE wechselte.

---

## Auf echter Hardware

**Schritt für Schritt, von der leeren SD-Karte bis zur ersten Fahrt** — Imager, SSH,
Dateien kopieren, was der Installer tut, geschrieben für Linux-Einsteiger:
**[`docs/QUICKSTART.de.md`](docs/QUICKSTART.de.md)**. Teileliste, Verkabelung und der
ganze Aufbau: **[`docs/HARDWARE.de.md`](docs/HARDWARE.de.md)**. Wenn etwas nicht geht:
**[`docs/TROUBLESHOOTING.de.md`](docs/TROUBLESHOOTING.de.md)**.

Die Kurzfassung, auf Raspberry Pi OS Lite mit bereits angeschlossener Hardware:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Klont nach `/opt/yonderrc` und startet den Installer. Er schaut einmal nach der Hardware —
ein PCA9685 am I²C wird zum Ausgabetreiber (neben einem INA2xx gehört er auf `0x41`), ein
Kameramodul ersetzt das Testbild, und das native Modul, das der Treiber braucht, wird
gebaut. Wird nichts gefunden, bleibt der Simulator, und eine einmal gespeicherte
Einstellung wird nie geändert. Danach `http://<pi-ip>:8080/setup` öffnen; **Detect
hardware** liest das **ID-Register** jedes I²C-Chips und benennt damit das tatsächliche
Bauteil (INA228, MCP9808, BME280 — und den PCA9685 über seine All-Call-Adresse), statt aus
einer geteilten Adresse zu raten. Kein Internet am Pi, oder eine eigene Kopie:
[`docs/QUICKSTART.de.md`, Option B](docs/QUICKSTART.de.md#option-b-die-dateien-selbst-kopieren).

Ein Hardware-Treiber, der nicht startet, fällt auf `sim` zurück — ein headless Gerät wird
nie unkonfigurierbar, und die Setup-Seite sagt es samt Grund.

---

## Im Simulator ausprobieren

Keine Hardware nötig. Benötigt Node 20+.

```bash
npm install
npm run dev
```

- Fahrzeug-Dienst: `ws://localhost:8080` (Sim-Treiber), Setup unter `/setup`.
- Bodenstation: `http://localhost:5173`.

**Connect** drücken, **Arm 1 s halten**, mit `W A S D` / Pfeiltasten fahren. Vom Handy
`http://<PC-LAN-IP>:5173` öffnen.

**Video im Sim** (synthetisches Testbild, braucht `ffmpeg`):

```bash
npm run dev            # Terminal 1: Fahrzeug + Boden-App
npm run dev:video      # Terminal 2: go2rtc mit Testbild
```

Reihenfolge beachten — `npm run dev` schreibt zuerst die go2rtc-Config. Fedora:
`sudo dnf install -y openh264 ffmpeg-free`.

**Tests:**

```bash
npm test               # Sicherheits-/Logik-Testsuite
```

---

## Projektstruktur

```
packages/
  protocol/   gemeinsame TypeScript-Typen (Wire-Messages, Kanäle, Profile, Telemetrie)
  vehicle/    Fahrzeug-Dienst (Node/tsx): Core, Failsafe, Treiber, Sensoren, go2rtc, Setup
  ground/     Bodenstation (React): Steuerung, FPV, OSD, Aufnahme, Setup-UI
  desktop/    Electron-Shell mit nativer SDL2-Eingabe
docs/QUICKSTART.de.md       Erstinstallation auf dem Pi, Schritt für Schritt
docs/HARDWARE.de.md         Hardware-Anleitung
docs/TROUBLESHOOTING.de.md  Diagnosedatei, Failsafe-Flackern, Controller
provisioning/               nur Pi: Installer, systemd, Hotspot/Onboarding, diag.sh
test/                       Testsuite (npm test)
```

Alles oberhalb des Transports ist transportunabhängig; die Steuerung läuft über
WebSocket (Fallback + Signaling) oder den WebRTC-Datenkanal.

---

## Versionen

Die Änderungen stehen in [`CHANGELOG.md`](CHANGELOG.md) und in den
[GitHub-Releases](https://github.com/TechnikWeber/YonderRC/releases). Diese README
beschreibt immer den aktuellen Stand.

## Wie dieser Code entstanden ist

YonderRC ist **mit KI-Unterstützung** entstanden — der Großteil des Codes stammt von
Anthropics Claude nach den Vorgaben des Autors, und jede Änderung wird von einem Menschen
geprüft und freigegeben, bevor sie ausgeliefert wird. Die Commits tragen einen
`Co-Authored-By: Claude`-Trailer.

Was das dafür bedeutet, wie sehr du dem Code trauen solltest:

- **Alles ist von der Testsuite abgedeckt** (`npm test`), alle vier Pakete typechecken.
  Sicherheitslogik — Failsafe, Disarm-Werte, Armen, Kanalmathematik, Pre-Arm-Check —
  liegt als reine Funktionen vor, damit sie ohne Hardware testbar ist.
- **Der Simulator-Pfad ist wirklich verifiziert. Der Hardware-Pfad nicht.** Echte
  Treiber, I²C-Register, nmcli/mmcli, LTE und WebRTC-Reconnect lassen sich nur auf einem
  Pi beweisen. Diese Stellen sagen das, statt so zu tun als ob.
- **Prüfe es selbst, bevor du ihm ein Fahrzeug anvertraust.**

Es gibt keinen Standard, KI-Beteiligung in einer Codebasis auszuweisen — kein SPDX-Feld,
keinen Lizenz-Header. Was es gibt, sind Commit-Trailer (`Co-Authored-By:`) und eine klare
Aussage wie diese. Dieses Projekt nutzt beides.

## Haftungsausschluss — Sicherheit & Recht

YonderRC steuert **physische Fahrzeuge** und kann Sachschäden, Verletzungen oder den Tod
verursachen. Es wird **„wie besehen", ohne jede Gewährleistung** bereitgestellt; der Autor
übernimmt **keine Haftung**.

- **FPV- und Betrieb außerhalb der Sichtweite (BVLOS) sind in vielen Ländern beschränkt
  oder verboten** und können Registrierung, Lizenz oder einen Spotter erfordern. **Prüfe
  die Gesetze bei dir** (Luftfahrt, Funk, Datenschutz), **bevor du es einsetzt.**
- Failsafe und Arming-Schutz aktiviert lassen, zuerst im Simulator und auf der Werkbank
  testen, Abstand zu Menschen und fremdem Eigentum halten, und dich nie allein auf die
  Verbindung verlassen.
- Die Nutzung erfolgt **vollständig auf eigenes Risiko.** Siehe [`LICENSE`](LICENSE).

## Lizenz

[PolyForm-Noncommercial-1.0.0](LICENSE) **plus eine Ergänzung: keine militärische
Nutzung**. Kurz: kostenlos nutzen, verändern und weitergeben, auch verändert; nichts
Kommerzielles, nichts Militärisches. Hinweise und Fremdkomponenten:
[NOTICE.md](NOTICE.md).
