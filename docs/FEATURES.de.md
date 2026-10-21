[English](FEATURES.md) · **Deutsch**

# Was YonderRC kann

Die vollständige Funktionsliste. Die Kurzfassung steht im [README](../README.de.md).

## Steuerung

- 16 Kanäle über WebSocket oder WebRTC-Datenkanal. Eingabe über Tastatur,
  Bildschirmtasten, Gamepad oder Touch-Joystick (Multitouch, Deadzone, Federrückstellung).
- **Modelle** für Auto, Boot, Flugzeug und Drohne, jeweils mit passender Kanal-Vorlage,
  Eingabemethode und Sender-Modus 1–4.
- **Pro Kanal**: Trim, Expo, Reverse, Endpunkte (µs), Failsafe-Wert, optionale Kennlinie
  (3–9 Punkte). Verbunden zeigt jeder Kanal seinen Ausgang an der Hardware
  (`CH03 · out 2`).
- **Live-Trims** unter den Sticks: 5 µs pro Druck, bis ±150 µs, im Modell gespeichert.
  Auch auf zwei Tasten oder Controller-Knöpfen (Trim −/+).
- **Zwei Tasten als eine Achse**, z. B. RT/R2 vorwärts und LT/L2 zurück bei Auto oder Boot.
- **Folgekanäle** für ein zweites Lenkservo oder einen zweiten Regler: eine Kopie eines
  anderen Kanals mit eigenem Versatz, Reverse und Endpunkten.
- **Speed-Limiter** mit drei Stufen, im Fahren umschaltbar.
- **Controller**: jedes Gerät, das der Browser meldet, wird angezeigt; Headsets und
  Bewegungssensoren werden nie automatisch gewählt. Ein Controller mit eigenem Layout
  (ein RC-Sender im Joystick-Modus) wird einmal eingerichtet, danach funktioniert jedes
  Modell damit. Jeder Controller kann eigene Aktionstasten haben.

![Touch-Steuerung: ein großer Lenk-/Gas-Stick, der Halten-zum-Armen-Button, Licht- und Hupe-Tasten, der Speed-Limiter, der WebRTC-Schalter und eine Statusleiste](screenshots/TouchInputs_and_Status.png?v=5)

*Touch-Steuerung, Halten zum Armen, Speed-Limiter, WebRTC-Schalter und Statusleiste.*

## Am Handy

- Eine normale Webseite: über LAN, den Hotspot des Pi oder eine VPN-Adresse öffnen.
  Keine Installation; das Fahrzeug liefert sie selbst aus.
- Responsives Layout und ein **kompaktes OSD**, das das Bild frei lässt
  (FPV › ⚙ › *OSD size*).

<details>
<summary><b>Handy-Ansicht — zum Ausklappen klicken</b></summary>

![YonderRC am Handy: FPV mit kompaktem OSD, umgebrochene Werkzeugtasten, Arm-Button und Touch-Joysticks](screenshots/Mobile_FPV.jpeg?v=5)

*Dieselbe App in einer nachgebildeten Handy-Ansicht mit 390 px.*

</details>

## Sicherheit

- **Failsafe**: bleiben Steuerpakete 500 ms aus (einstellbar), geht jeder Kanal auf
  seinen Failsafe-Wert. Er hängt vom Fahrzeugtyp ab: Eine Drohne *hält*, Auto und Boot
  *stoppen*, ein Flugzeug nimmt den *Motor* weg.
- **Armen**: jede Verbindung startet entschärft. Auto und Boot werden nach einem
  Reconnect wieder entschärft, Fluggeräte nicht (änderbar in Setup › Controls).
- **Halten zum Armen** (1 s) für Armen *und* Entschärfen — am Button und an einer
  gebundenen Taste. **Panic-Disarm** wirkt sofort und ist ab Werk unbelegt: eine Taste
  wählen, die man nicht versehentlich trifft.
- **Pre-Arm-Check**: das Gas muss vor dem Armen in Ruhelage stehen.
- **Lieber keine Pakete als falsche**: geht die App in den Hintergrund oder verschwindet
  der Controller, wird nichts gesendet, und das Fahrzeug geht in den Failsafe.
- Modell und Einstellungen sind gesperrt, solange es scharf ist. Optionales
  **Shared Secret** für Steuerverbindung und Setup-Seite.
- **Stick-Feedback** (standardmäßig aus): Klick oder Vibration in der Mitte und am Rand.

![Kanal-Monitor: die tatsächliche µs-Ausgabe pro Kanal, Gas „HELD SAFE · DISARMED"](screenshots/ChannelOutput_Monitor.png?v=5)

*Die echte Fahrzeugausgabe in µs, inklusive Failsafe und Disarm.*

## Video (FPV)

- Latenzarmes Video über **go2rtc/WebRTC**; der H.264-Encoder wird automatisch erkannt.
- **Selbstheilend**: ein eingefrorenes Bild verbindet neu; das letzte Bild bleibt so lange
  stehen.
- **Qualität** hoch/mittel/niedrig oder **Auto**, im Fahren umschaltbar.
- **CSI-Kameramodule** im Browser wählbar, auch solche, die der Pi nicht selbst erkennt.
  Drehung, Spiegelung und Fokus pro Kamera.
- Ohne Kamera geht es auch: der FPV-Bereich bleibt dunkel, alles andere funktioniert.
- OSD mit Status, Kanälen, Videowerten und Telemetrie; jeder Wert ist ausblendbar.
- **Aufnahme und Schnappschüsse** im Browser, auf Taste oder Knopf legbar.

## Telemetrie

- **Spannung und Strom**: INA219/226/228/237/238/260/3221, ADS1115/1015, MCP3008/3208,
  ACS712/758. mAh-Zählung und Akku-% aus der Kapazität. **INA228 empfohlen** — er zählt
  die Ladung selbst.
- **Temperatur**: Pi-SoC, DS18B20, MCP9808, TMP102/117, BMP280/BME280, MAX6675/318xx,
  NTC/PT100 an einem ADC.
- Beliebig viele Kanäle, jeder im OSD ausblendbar. Simulierte Werte sind mit **SIM**
  markiert, ein fehlender Sensor zeigt **NO SENSOR** — nie erfundene Zahlen.
- **Akku-Warnung** auf %, Spannung oder mAh: blinkendes OSD, Vibration, Piepton.
- **Heimkehr-Budget** (standardmäßig aus): wie weit du noch darfst und trotzdem heimkommst.
  Braucht Kapazität, Stromsensor und GPS.
- **Sprachansagen**: Link weg/zurück, Failsafe, scharf/entschärft, Akku leer.
- **Link-Gesundheit** als eine Zahl 0–100 (Round-Trip, Verlust, Signal; der schlechteste
  zählt).
- **Blackbox-Log** (standardmäßig aus): CSV mit Link, Video, Akku, jedem Sensor und dem
  GPS-Track; auch als GPX.

## GPS & Navigation

- Serieller NMEA-Empfänger, USB-Empfänger über gpsd, oder simuliert.
- Home-Punkt von Hand oder automatisch; das OSD zeigt Distanz und Richtung nach Hause.
- Setup gibt die serielle Schnittstelle des Pi frei und zählt eingehende Daten, ein
  Empfänger lässt sich also drinnen prüfen.

## Betrieb & Einrichtung

- **Setup-Seite am Fahrzeug** (`/setup`, geht vom Handy): Treiber, Kameras, Sensoren,
  Watchdog, WLAN, LTE, Fernzugriff, Sicherheit, Design.
- **WLAN**: von der Seite aus scannen und verbinden. Falsches Passwort → der Hotspot kommt
  zurück.
- **Eigener Hotspot** mit Captive Portal, damit sich die Seite im Feld von selbst öffnet.
- **Fernzugriff**: Tailscale, ZeroTier, WireGuard; OpenVPN (experimentell).
- **LTE**: USB-Modems über ModemManager (APN, PIN, 4G-only, Roaming) und HiLink-Sticks
  (Huawei E3372h & Co.); die Seite des Sticks ist über das Fahrzeug erreichbar.
- **Datenvolumen**: zählt mobile Daten und warnt (**⚠ DATA**), bevor der Tarif aufgebraucht
  ist.
- **Problembericht in einer Datei**: *Setup › Diagnostics* sammelt beide Seiten und sagt in
  Klartext, was auffällt. Wie man sie schickt:
  [`TROUBLESHOOTING.de.md`](TROUBLESHOOTING.de.md).
- **Update, Neustart, Herunterfahren und Werksreset** von der Seite — verweigert, solange
  es scharf ist.
- Hardware-Selbsttest, Regler-Kalibrierung, Treibermodule aus dem Browser installierbar.
- Das Fahrzeug meldet seinen Zustand: **⚠ POWER** bei schwacher Versorgung, Temperatur,
  Last, freier Speicher, falsche Uhrzeit.
- Ausgabetreiber **PCA9685 / GPIO-PWM / SBUS**. **Desktop-App** (Electron) mit nativer
  Controller-Unterstützung.

![Setup-Seite des Fahrzeugs, Tab Overview: Tabs oben, darunter Systemstatus — Modus, LTE-Modem und Betreiber, Fernzugriff, WLAN und je eine Zeile für Sensoren, GPS und Kameras — gefolgt von Hardware-Test, Software-Update und Systemtasten](screenshots/VehicleConfig_Setup.png?v=5)

## Im Feld gemessen

21.08.2026, ein Nachmittag, ein Netz, ein Ort — kein Benchmark. Pi 4 mit einem Huawei
E3372h-320 (interne Antenne), gesteuert von einem Laptop über Tailscale.

| | |
| --- | --- |
| Steuer-Round-Trip | 110 ms |
| Video-Latenz | 128 ms |
| Bitrate | 444 kbps |
| LTE-Signal | 52 % (≈ −106 dBm RSRP) |
| Pfad | direkt über IPv6, kein Relay |

Der Failsafe löste aus und ging zurück wie vorgesehen, während der Link von WLAN auf LTE
wechselte.

## Projektstruktur

```
packages/
  protocol/   gemeinsame TypeScript-Typen (Nachrichten, Kanäle, Profile, Telemetrie)
  vehicle/    Fahrzeug-Dienst (Node): Core, Failsafe, Treiber, Sensoren, Video, Setup-Seite
  ground/     Bodenstation (React): Steuerung, FPV, OSD, Aufnahme, Setup
  desktop/    Electron-Shell mit nativer Controller-Eingabe
docs/         Schnellstart, Hardware, Fehlersuche, diese Liste
provisioning/ nur Pi: Installer, systemd, Hotspot, diag.sh
test/         Testsuite (npm test)
```

Die Steuerung läuft über WebSocket oder einen WebRTC-Datenkanal; alles darüber ist davon
unabhängig.
