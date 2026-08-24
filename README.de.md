[English](README.md) · **Deutsch**

# YonderRC

Fernsteuerung jenseits der Sichtweite über IP — eine App für **Video, Steuerung
und Konfiguration** von Autos, Booten, Flugzeugen und Drohnen. Läuft im Browser
(inkl. Smartphone), als Desktop-App (Windows/Linux) und auf einem Raspberry Pi als
Fahrzeugrechner. Niedrige Latenz, ausgelegt für den Betrieb über LTE.

Alles ist **im Simulator lauffähig — ganz ohne Hardware**. Für den echten Aufbau
auf dem Pi (Teileliste, Verkabelung, Schritt für Schritt WLAN → LTE) siehe
[`docs/HARDWARE.de.md`](docs/HARDWARE.de.md).

![Bodenstation im Fahrbetrieb: FPV-Video mit vollem OSD — GPS-Fix und Home-Kompass mit Distanz, Odometer und Speed oben links, Akku-Balken oben rechts, Link-Signal und Stats unten rechts](docs/screenshots/Overview_OSD.png?v=3)

*Bodenstation im Fahrbetrieb: latenzarmes FPV mit vollem OSD — GPS-Fix + **Home-Kompass,
Distanz, Odometer und Speed** (oben links), Akku-Balken (oben rechts) sowie das
**Link-Signal** + Steuer-/Video-Latenz, Bitrate, FPS und Loss (unten rechts). Ein
**Setup ↗**-Shortcut öffnet die Setup-Seite des Fahrzeugs.*

---

## Was YonderRC kann

**Steuerung**
- 16 Kanäle über WebSocket oder WebRTC-Data-Channel; Tastatur, On-Screen-Buttons,
  Gamepad oder vollwertiger Touch-Joystick (Multitouch, Deadzone, Federrücklauf).
- **Modelle** für Auto / Boot / Flugzeug / Drohne mit passenden Kanal-Vorlagen,
  wählbarer Eingabemethode und pro Achse einstellbarem Einrasten (Mitte/Min/frei). Das
  Demo-Auto startet auf dem **Bildschirm-Pad**, ein Handy im Hotspot des Fahrzeugs kann
  also sofort losfahren — beide Achsen auf einem Stick, ohne vorher in den
  Binding-Editor zu müssen.
- Pro Kanal Trim, Expo, Reverse, Endpunkte (µs) und Failsafe-Wert.
- **Kennlinien** pro Stick-Kanal (standardmäßig aus): eine 3-/5-/7-/9-Punkt-Kurve mit
  Live-Diagramm, für die Verläufe, die Expo nicht abbilden kann — ein Gas, das bis
  Halbgas sanft bleibt und dann aufmacht, eine Lenkung, die an den Enden weich und in
  der Mitte direkt ist. Wird vor dem Expo angewendet, beides ist also kombinierbar. Die
  beiden Endpunkte sind auf ±100 % fixiert, damit der volle Weg erreichbar bleibt —
  begrenzen über die Endpunkte, und Disarm-Wert wie Pre-Arm-Check funktionieren
  unabhängig davon, welche Form du zeichnest.
- **Live-Trims** in einem aufklappbaren Feld unter den Sticks: 5 µs pro Druck, bis
  ±150 µs, Reset je Kanal. Derselbe Wert wie `trim µs` im Setup, mit dem Modell
  gespeichert.
- **Tempolimit mit drei Stufen** (Low / Mid / High, Prozentwerte pro Modell): drei
  Buttons unter den Sticks schalten im Fahrbetrieb um, alternativ ein belegbarer
  Controller-Button. Der Befehl wird **um die Ruhelage des Gaskanals** skaliert — ein
  Auto mit Rückwärtsgang wird in beide Richtungen begrenzt, ein Flugzeug behält seinen
  exakten Leerlauf und wird nur nach oben begrenzt. Endpunkte, Failsafe, Disarm-Wert und
  Pre-Arm-Check bleiben unangetastet.

![Touch-Steuerung: ein großer Lenk-/Gas-Stick, Halten-zum-Armen-Button, Lights- und Horn-Buttons, Speed-Limiter, WebRTC-Steuerschalter und Status-Leiste](docs/screenshots/TouchInputs_and_Status.png?v=4)

*Touch-Steuerung, der **Halten-zum-Armen**-Button, der **Speed-Limiter**, der optionale
**WebRTC-Steuerkanal**-Schalter und eine Status-Leiste: Link, Zustand, Session-Zeit,
Round-Trip, Eingabemethode, Fahrzeug/Treiber, Telemetrie. Ein Auto in Stick-Modus 2 fährt
mit einem **einzigen Stick** — Lenkung auf X, Gas auf Y — und bekommt dafür die ganze
Reihe und die Größe, die damit möglich ist; Modus 4 verteilt beides auf zwei.*

**Am Handy**
- Die Boden-App ist eine normale Webseite — vom Handy über das LAN, den eigenen
  Hotspot des Pi oder eine VPN-Adresse öffnen. Keine Installation nötig, und das
  Fahrzeug kann sie selbst ausliefern.
- **Responsives Layout**: Bedienelemente brechen um, statt die Seite breiter zu
  machen — der Browser verschiebt oder zoomt die Ansicht also nicht mehr weg,
  während du fährst.
- **Kompaktes OSD**: am Handy schrumpft die Einblendung automatisch und blendet
  sekundäre Werte aus, damit sie das Bild nicht mehr verdeckt. Umschaltbar unter
  FPV › ⚙ › *OSD size* (Auto / Compact / Full).

<details>
<summary><b>Mobile Ansicht — hier klicken</b></summary>

![YonderRC am Handy: FPV mit kompaktem OSD, umgebrochene Tool-Buttons, Arm-Button und Touch-Joysticks](docs/screenshots/Mobile_FPV.jpeg?v=1)

*Dieselbe App auf einem iPhone: FPV mit kompaktem OSD (GPS, Home-Kompass, Odometer
und Speed links, Akku-Balken rechts, Link/Latenz in einer Zeile), die FPV-Buttons in
einer zweiten Reihe und darunter der Arm-Button mit Touch-Joysticks und belegbaren
Buttons.*

</details>

**Sicherheit**
- Zeitbasierter **Failsafe-Watchdog**: bleiben Steuer-Frames aus, gehen alle Kanäle
  auf ihren Failsafe-Wert. **Modellabhängig und getrennt vom Disarmen** — eine
  Drohne *hält* bei Link-Verlust (Gas mittig), Auto/Boot *stoppt*, Flugzeug geht
  auf *Motor aus*.
- **Arming**; jede neue Verbindung startet disarmed. **Auto-Disarm bei Reconnect folgt
  dem Fahrzeugtyp** (Auto/Boot an, Flugzeug/Drohne aus — vom Ground gepusht), damit ein
  Reconnect einem Luftfahrzeug nicht im Flug die Motoren kappt; in Setup › Controls
  **überschreibbar** auf immer an/aus, Standard bleibt *auto*.
- **Halten zum Armen**: der Arm-Button muss gehalten werden (standardmäßig 1 s, mit
  Countdown, der den Button füllt), zum Armen *und* zum Disarmen — ein Fehlgriff am
  Handy kappt so nicht die Motoren — und dasselbe Halten gilt für eine auf Arm/Disarm
  gelegte **Taste oder Controller-Taste**. Haltezeit einstellbar, der Schutz ganz
  abschaltbar unter Setup › Controls; **Panic-Disarm** bleibt in jedem Fall sofort.
- **Pre-Arm-Check** (Gas muss in Ruhelage stehen) und **Panic-Disarm** auf belegbarer
  Taste/Button, immer über die zuverlässige Verbindung gesendet. Panic ist **ab Werk
  unbelegt**: es löst ohne Halten sofort aus, du wählst also selbst eine Taste oder
  Controller-Taste, die du nicht versehentlich triffst.
- **Spüren, wo der Stick steht** (standardmäßig aus, Setup › Controls). Beim FPV-Fahren
  hat der Daumen keine Kante zum Ertasten, also markiert der Bildschirm-Stick die beiden
  Positionen, auf die es ankommt: zurück in der Mitte und hart am Anschlag, je einmal pro
  Überschreitung. Ein **iPhone kann von einer Webseite aus nicht vibrieren** — Safari hat
  keine Vibration-API —, deshalb ist der Standardkanal ein kurzer Klick, der dort
  funktioniert; Vibration wird nur angeboten, wo der Browser sie wirklich hat, und ein
  angeschlossenes Gamepad wird über seinen Aktuator gerüttelt.
- Modellwechsel und Einstellungen sind im gearmten Zustand gesperrt.
- **Optionales Shared Secret** (standardmäßig aus): einmal gesetzt, verlangen der
  Steuer-Link und die Setup-API es — erster Verbindungsaufbau bleibt schnell, bei
  Bedarf abschließbar.

![Kanal-Monitor: tatsächliche µs-Ausgabe je Kanal, Throttle „HELD SAFE · DISARMED“](docs/screenshots/ChannelOutput_Monitor.png?v=3)

*Kanal-Monitor: zeigt die **echte** Fahrzeug-Ausgabe in µs inklusive Failsafe und
Disarm — der Throttle-Kanal wird sichtbar sicher gehalten, solange disarmed.*

**Video (FPV)**
- Latenzarmes Video über **go2rtc/WebRTC**; H.264-Encoder wird automatisch erkannt
  (`libx264`, `libopenh264`, Pi-Hardware).
- **Selbstheilend**: erkennt eingefrorenes/abgerissenes Bild und verbindet sich
  automatisch neu; der letzte Frame bleibt stehen.
- **Video-Qualität live umschaltbar** von der Groundstation (High/Medium/Low) oder
  **Auto**: schaltet bei steigendem Verlust/Latenz schnell herunter und erst wieder hoch,
  wenn die Verbindung klar gut ist (Schwellen einstellbar). Sie **startet auf Low** — in
  den ersten Sekunden zählt ein flüssiges Bild, nicht die höchste Auflösung — und Auto
  steigt von dort, statt in voller Auflösung zu öffnen und erst nach dem Ruckeln
  herunterzuschalten.
- **Das Kameramodul ohne Terminal auswählen.** Automatisch erkannt werden nur die vier
  offiziellen Raspberry-Pi-Sensoren; eine Arducam braucht ein explizites
  Device-Tree-Overlay in der Firmware-Konfiguration, die nur beim Booten gelesen wird.
  *Setup › CSI camera module* schreibt es, legt ein Backup an und sagt, wann ein Neustart
  fällig ist. **Rotation (0°/180°) und Spiegelung** gibt es pro Kamera — über Kopf verbaut
  ist der Normalfall, und auf einem CSI-Sensor kostet die Transformation nichts. Der
  **Fokus** eines Moduls mit Fokusmotor ist ebenfalls einstellbar; eine Arducam 16 MP
  braucht dafür eine Tuning-Datei, die YonderRC mitbringt und selbst einträgt, weil die von
  Raspberry Pi keinen Autofokus-Algorithmus enthält.
- **Keine Kamera ist eine unterstützte Betriebsart**, kein Defekt: löscht man alle
  Einträge, bleibt die FPV-Fläche dunkel, nichts wird wiederholt, nichts meldet einen
  Fehler, und OSD, Telemetrie und Steuerung laufen weiter. Genau so konfiguriert man einen
  reinen IP/WLAN/AP-Empfänger fürs Fahren auf Sicht.
- OSD mit Status, Kanälen, **Bitrate/Paketverlust/FPS/Video-Latenz** und Telemetrie.
  Jeder Block **und jeder einzelne Sensorwert** ist abschaltbar, und die ganze
  Einblendung hat einen **Kompakt-Modus** fürs Handy.
- **Aufnahme & Standbild** lokal (Ordner einmal vorwählen; auf Taste oder
  Controller-Button legbar).

**Telemetrie**
- Spannungs-/Stromsensoren (real: ADS1115/1015, MCP3008/3208, INA219/226/228/237/238/
  260/3221, ACS712/758 — oder Sim), **präzises Coulomb-Counting** (verbrauchte mAh) und
  **Batterie-Prozent** aus der eingestellten Kapazität. Sim-Werte sind klar als
  **SIM** markiert; fehlt ein echter Sensor, zeigt das OSD **„NO SENSOR"** statt
  gefälschter Werte, und Telemetrie ist **abschaltbar**, damit der erste Flug keine
  Fantasiewerte zeigt.
- **Wählbar, was die %-Anzeige speist**: Coulomb-Counting, eine Voll/Leer-**Spannungs**-
  kurve oder **clamp** (der niedrigere von beiden, damit ein nicht-voller Pack nicht
  100 % zeigt). Das OSD beschriftet die Quelle; die mAh-Anzeige läuft unabhängig.
- Ein einzelner INA-Sensor kann **Spannung und Strom** liefern.
- **Temperatursensoren, 1..n**: Raspberry-Pi-SoC, DS18B20 (1-Wire), MCP9808 / TMP102 /
  TMP117 / BMP280 / BME280 (I²C), Thermoelemente über MAX6675 / MAX31855 / MAX31856 und
  PT100/PT1000 über MAX31865 (SPI), oder ein NTC/PT100 an ADS1115 / MCP3008. Im OSD
  unterhalb von Spannung und Strom.
- **Beliebig viele Kanäle, jeder einzeln schaltbar**: das OSD listet unter FPV › ⚙ ›
  *Sensor values* jeden Kanal, den das Fahrzeug meldet — du entscheidest pro Gerät, was
  im Bild steht. Sobald eine Art mehr als einen Kanal hat, steht das **Kürzel** vor dem
  Wert (`Pack 16.6 V · BEC 5.1 V`, `Motor 62 °C`); bei einem einzelnen Kanal bleibt die
  Anzeige so knapp wie bisher.
- **Ein Kanal ist als *primary* markiert** (Setup › Telemetry) und speist Akku-%,
  mAh/Wh-Zählung, Akku-Warnung und Blackbox — ein zweiter Spannungs- oder Stromkanal
  kann die Akkurechnung damit nicht mehr unbemerkt auf den falschen Sensor schieben.
- **INA228 (Empfehlung): der Sensor zählt die Ladung selbst.** Seine CHARGE-/ENERGY-
  Register integrieren in Hardware mit der ADC-Rate, das Fahrzeug liest nur noch zwei
  Register — die mAh hängen nicht mehr an der Abtastrate oder an ausgefallenen
  Messungen. 85 V Busbereich (bis 12S) und 20 Bit Auflösung. INA237/238 sind dieselbe
  85-V-Familie ohne Zähler (dann integriert der Pi), INA226 reicht bis 36 V.
- **Akku-Warnung** über Prozent / Spannung / verbrauchte mAh, mit blinkender
  OSD-Markierung, Controller-Rumble und Ton.
- **Heimkehr-Energiebudget** (standardmäßig aus): misst, was das Fahrzeug tatsächlich
  pro km verbraucht, und macht daraus die Zahl, die eine Entscheidung ist — **wie weit
  du noch weiter darfst und trotzdem mit Reserve heimkommst**. Ein Prozentwert kann das
  nicht beantworten: 30 % sind bei 50 m reichlich und bei 800 m zu wenig. Angezeigt im
  **vollen OSD**; die **Umkehr-Warnung** erscheint auch im kompakten OSD und wird
  angesagt. Braucht Akkukapazität, Stromsensor und einen GPS-Home-Punkt — **ohne die
  zeigt es schlicht nichts**, was für ein Fahrzeug, das nur ein Servotreiber ist, der
  Normalfall ist.
- **Sprachansagen** (standardmäßig an, eingebaute Browserstimme, ohne Netz):
  Verbindung verloren/wieder da, Failsafe, armiert/entschärft und niedriger Akku mit
  Prozentwert. Bei FPV schaust du aufs Bild — ein Piepser sagt, *dass* etwas ist, eine
  Stimme sagt, *was*. Bewusst nichts darüber hinaus, damit sie nichts wird, das man
  stummschaltet.
- **Link-Gesundheit als eine Zahl**: Round-Trip, Paketverlust und Funksignal
  zusammengefasst zu 0–100 mit Trendpfeil, grün / gelb / rot. Die Zahl ist das
  **Schlechteste** der drei, kein Mittelwert — ein perfektes Funksignal kann also keine
  15 % Paketverlust verdecken. Die Einzelwerte bleiben ausgeblendet, solange der Link
  gut ist, und **kommen von selbst zurück**, sobald er es nicht mehr ist — dann willst
  du wissen, *welcher* davon eingebrochen ist.
- **Blackbox-Logging** (optional, standardmäßig aus): 2-Hz-CSV mit Arm-/Failsafe-
  Zustand, Link, Round-Trip, Bitrate, Loss, FPS, Video-Latenz, mAh und Prozent — dazu
  **je eine Spalte pro Telemetriekanal** (`Pack_V`, `BEC_V`, `I1_A`, `Motor_C`…), damit
  jede konfigurierte Spannung, jeder Strom und jede Temperatur im Log landet. Bis ca.
  5 h, herunterladbar unter Setup › Controls.
- **Die Wegstrecke steckt im selben Log**: `lat`, `lon`, `alt_m`, `sats`, `hdop`,
  `speed_ms` und `course_deg` stehen in *derselben Zeile* wie Elektrik und
  Link-Statistik — damit lässt sich die Route in QGIS oder kepler.gl nach
  Akkuspannung oder Round-Trip einfärben, also buchstäblich eine Karte davon, wo die
  Verbindung schlecht wird. Ein zweiter Button exportiert die reine **GPX**-Strecke
  (mit Höhe, Satelliten, Geschwindigkeit und Kurs), die Google Earth,
  [gpx.studio](https://gpx.studio), Garmin BaseCamp, GPSBabel und jedes andere
  Kartenprogramm ohne Umwandlung lesen.

**GPS & Navigation**
- **Wählbare GPS-Quelle**: lokaler NMEA-Empfänger über Serial (Referenz ist das
  **Adafruit Ultimate GPS v3**, dazu u-blox NEO-6/7/8/M9, BN-880…), ein USB-Dongle über
  **gpsd**, eine **Sim**-Quelle oder (später) **MAVLink** vom Flight Controller — alles zu
  einem Fix normalisiert. Setup › GPS gibt dir den Header-UART frei (Raspberry Pi OS legt
  eine Login-Konsole darauf) und zählt die ankommenden NMEA-Sätze, ein Empfänger lässt
  sich also im Haus prüfen, wo es nie einen Fix geben wird.
- **Home-Punkt**: manuell setzen oder **Auto-Home** beim ersten guten Fix (Startpunkt).
  Das OSD zeigt Fix-Typ + Satelliten und, sobald Home gesetzt ist, **Distanz und
  Richtung zurück zum Home** — das Wesentliche für den Betrieb außerhalb der Sichtweite.

**Betrieb & Einrichtung**
- Grafische **Setup-Seite** direkt vom Fahrzeug (`/setup`): Treiber, Kameras,
  Telemetrie, Watchdog, **WLAN**, LTE, Fernzugriff, Sicherheit — vom Handy/Laptop, ohne
  Bildschirm. **WLAN-Einrichtung vom Handy**: scannen, Netz auswählen, verbinden — der
  Setup-Hotspot schließt sich, sobald der Pi im WLAN ist, und kommt zurück, wenn das
  Passwort falsch war. Der Hotspot kann für Felddiagnose **neben LTE oben bleiben**.
  Das **API-Secret** lässt sich per Klick erzeugen. Die Boden-App hat einen **„Setup ↗"-Shortcut**, der sie für das
  verbundene Fahrzeug öffnet (im LAN, über den AP des Pi oder eine VPN-Adresse).

  ![Setup-Seite des Fahrzeugs: System-Status (LTE-Modem, Betreiber, Tailscale, WiFi) und der LTE-Bereich mit APN, SIM-PIN, APN-Auth und Netzmodus](docs/screenshots/VehicleConfig_Setup.png?v=3)

  *Setup-Seite direkt vom Fahrzeug: System-Status (Modus, LTE-Modem/Betreiber,
  Fernzugriff, WiFi) und der robuste **LTE**-Bereich — APN, SIM-PIN, APN-Benutzer/Passwort
  und Netzmodus. Bedienbar vom Handy ohne Bildschirm.*
- **Fernzugriff, eine Methode wählen**: **Tailscale** oder **ZeroTier** (Zero-Config-
  Mesh-VPNs) oder **WireGuard** — entweder die von deinem eigenen Server oder einer
  **FritzBox** exportierte **`.conf` hochladen**, oder die Werte **von Hand eintragen**
  (Schlüssel, Adresse, Endpoint, AllowedIPs), wenn es nur eine Seite mit Einstellungen
  gab. Beides landet als dieselbe gespeicherte `.conf`, eine hochgeladene Datei lässt
  sich also danach feldweise bearbeiten. Kommt beim Boot automatisch hoch.
- **Robustes LTE-Setup** (nicht nur Plug-and-Play): APN, **SIM-PIN**, **APN-Benutzer/
  Passwort**, **Netzmodus** (nur 4G), **Roaming**-Schalter, live **Diagnose** (rohe
  `mmcli`-Ausgabe) und **SIM-PIN ändern/entfernen**. `autoconnect` wählt selbst neu.
- **HiLink-LTE-Sticks ebenso** (Huawei E3372h-320 und Verwandte). Sie sind Router, keine
  ModemManager-Modems — `mmcli` sieht sie nie — deshalb liest YonderRC ihre eigene API:
  Modell, Zustand, Betreiber, Netztyp und **Signal im OSD** wie bei jedem Modem. Der
  Stick wird über die **Routing-Tabelle** gefunden, ein LAN an einem anderen `eth*` kann
  also nicht verwechselt werden, und seine **Konfigurationsseite wird durch das Fahrzeug
  durchgereicht** (Port 8081) — APN/PIN lassen sich damit vom Hotspot, aus dem LAN oder
  über das VPN einstellen.
- **Native Treibermodule installieren sich im Browser** (Setup › Vehicle configuration):
  `i2c-bus`, `pigpio`, `serialport` mit Status und einem Knopf — kein SSH auf einem
  Fahrzeug, das du womöglich nur über seinen eigenen Hotspot erreichst. Ein gescheiterter
  Build wird in Ursache plus passenden Befehl übersetzt, und die Auswahl übersteht
  Updates.
- **Das WLAN-Modul repariert sich selbst.** Raspberry Pi OS hält es per rfkill gesperrt,
  solange kein **WLAN-Land** gesetzt ist, und NetworkManager sagt dann nur „device is not
  available". Das Setup zeigt den Zustand und entsperrt es per Knopfdruck, das Länderkürzel
  ist aus der Locale des Pi vorbelegt — beim Hotspot-Start passiert das von selbst.
- **Update direkt über die Setup-Seite**: *Check for updates* zeigt die anstehenden
  Commits und die Version, ohne etwas zu ändern; *Update & restart* holt sie dann,
  installiert geänderte Abhängigkeiten, baut bei Bedarf die Steuer-App neu und startet
  den Dienst — ein Fahrzeug lässt sich damit im Feld allein mit dem Handy aktualisieren.
- **Geführter Hardware-Selbsttest**: Kanal-Sweep, Sensoren lesen, Kamera-Standbild.
- **Das Fahrzeug sagt, wenn seine eigene Versorgung zusammenbricht.** Ein Pi mit
  einbrechender 5-V-Schiene setzt mitten in der Fahrt zurück, und von der Bodenstation aus
  ist das von einem Softwareabsturz nicht zu unterscheiden — Video läuft, dann Freeze und
  eine Minute Reconnect. YonderRC liest das Urteil der Firmware und zeigt **⚠ POWER** im
  OSD, solange es anliegt, mit einem Satz, der die Abhilfe benennt (Servo-V+ gehört ans
  eigene BEC, nie an den Pi) und eine thermische Drosselung von einbrechender Versorgung
  unterscheidet, denn die wollen Verschiedenes.
- **Das Fahrzeug von der Seite aus herunterfahren.** Einem Pi mitten im Schreibvorgang den
  Strom zu nehmen ist der Weg, auf dem eine SD-Karte unlesbar wird. Abgelehnt, solange
  scharfgeschaltet.
- **Werksreset** für Fahrzeug und Boden-App.
**Im Feld gemessen** (21.08.2026, ein Nachmittag, ein Netz, ein Ort — kein Benchmark):
Pi 4 mit **Huawei E3372h-320** und dessen interner Antenne, gesteuert von einem
Fedora-Laptop über **Tailscale**, Netzwerkkabel gezogen. Tailscale fand einen **direkten
IPv6-Pfad** über LTE (kein DERP-Relay, `tailscale ping` 69 ms). Die Boden-App zeigte
**Steuer-Roundtrip 110 ms**, **Video 128 ms** und 444 kbps bei **52 % LTE-Signal** — die
Link-Health im OSD stand auf 52 und nannte `SIGNAL` als begrenzenden Teil, genau das Bild
einer internen Stick-Antenne bei etwa −106 dBm RSRP. Failsafe griff und löste sich wieder,
wie vorgesehen, während die Verbindung von WLAN auf LTE wechselte.

- **Autark im Feld**: der Pi startet seinen eigenen WLAN-Hotspot, sobald seine Funkeinheit frei ist, und öffnet per
  **Captive Portal** die Steuer-/Setup-Seite — die Boden-App wird vom Pi selbst
  ausgeliefert, Steuern und Konfigurieren gehen also mit dem bloßen Handy.
- Hardware-Treiber **PCA9685 / GPIO-PWM / SBUS** (native Libs sind optional),
  nicht-blockierende **ESC-Kalibrierung**.
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

**Connect** drücken, **Arm 1 s halten**, und mit `W A S D` / Pfeiltasten fahren. Vom Handy
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
erst im WLAN, dann Umstellung auf LTE — in
**[`docs/HARDWARE.de.md`](docs/HARDWARE.de.md)**.

**Am schnellsten (eine Zeile auf Raspberry Pi OS Lite):**

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Das klont das Repo nach `/opt/yonderrc` und startet den Installer. Danach
`http://<pi-ip>:8080/setup` öffnen und **Detect hardware** drücken: es scannt den I²C-Bus
und **liest das ID-Register jedes Chips**, benennt also das tatsächliche Bauteil (INA228,
MCP9808, BME280 — und den PCA9685 über seine All-Call-Adresse), statt aus einer Adresse
zu raten, die sich mehrere Geräte teilen. Ein Knopf trägt diese Adressen in die
Treiber- und Telemetrieformulare ein. Das nötige native Treibermodul (`i2c-bus`,
`pigpio`, `serialport`) installiert dieselbe Seite, ganz ohne SSH. Lieber manuell? Dann
die Schritte unten.

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

Treiber-Auswahl per Env (Details in `docs/HARDWARE.de.md` und `provisioning/README.md`):

```bash
YRC_DRIVER=pca9685 npm run start -w @yonderrc/vehicle   # I2C-PWM, 16 Kanäle
YRC_DRIVER=gpio-pwm npm run start -w @yonderrc/vehicle   # pigpio; Pins: docs/HARDWARE.de.md 2.8
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

## Wie dieser Code entstanden ist

YonderRC wird **mit KI-Unterstützung** entwickelt — der Großteil des Codes stammt von
Anthropics Claude, nach den Vorgaben des Autors, und jede Änderung wird vor der
Veröffentlichung von einem Menschen geprüft und freigegeben. Die Commits tragen einen
`Co-Authored-By: Claude`-Trailer, `git log` zeigt also genau, welche.

Was das praktisch bedeutet — offen gesagt, weil es beeinflusst, wie sehr man diesem
Code trauen sollte:

- **Alles ist durch die Testsuite abgedeckt** (`npm test`), alle vier Pakete
  typechecken. Sicherheitsrelevante Logik — Failsafe, Disarmed-Werte, Armierung,
  Kanalmathematik, Pre-Arm-Check — ist bewusst als pure Funktionen in `protocol` und
  `ground/src/lib` geschrieben, damit sie ohne Hardware prüfbar ist.
- **Der Simulatorpfad ist wirklich verifiziert. Der Hardwarepfad nicht.** Alles, was
  echte Treiber, I²C-Sensorregister, nmcli/mmcli, LTE oder das WebRTC-Reconnect-Verhalten
  berührt, lässt sich nur auf einem Pi mit angeschlossener Hardware beweisen. Diese
  Stellen sagen das in Doku und Changelog auch so, statt etwas anderes vorzugeben.
- **Prüfe es selbst, bevor du ihm ein Fahrzeug anvertraust.** Das gilt für jede
  RC-Software; durch die Entstehungsweise wird es hier weder schwächer noch stärker.

Einen formalen Industriestandard für die Kennzeichnung von KI-Beteiligung an einer
Codebasis gibt es nicht — kein SPDX-Feld, keinen vereinbarten Lizenzheader. Was es gibt,
sind Commit-Trailer (`Co-Authored-By:`, vom Linux-Kernel als `Co-developed-by:`
formalisiert) und eine schlichte Aussage wie diese in der README. Dieses Projekt nutzt
beides.

## Haftungsausschluss — Sicherheit & Recht

YonderRC steuert **echte Fahrzeuge** und kann Sach-, Personen- oder tödliche Schäden
verursachen. Die Software wird **„wie besehen", ohne jede Gewährleistung**
bereitgestellt, und der Autor übernimmt **keinerlei Haftung** für Schäden oder
Verluste, die aus der Nutzung entstehen.

- **FPV und der Betrieb außerhalb der Sichtweite (BVLOS) sind in vielen Ländern
  eingeschränkt oder ganz verboten** und können Registrierung, eine Lizenz, einen
  Beobachter (Spotter) oder eine Sondergenehmigung erfordern. **Informiere dich und
  halte die für dich geltenden Gesetze ein** (Luftfahrt/Drohnen, Funk/Frequenzen,
  Datenschutz) **bevor du es einsetzt.**
- Setze es immer **verantwortungsvoll** ein: Failsafe und Arming aktiviert lassen,
  alles zuerst im Simulator und auf der Werkbank testen, Abstand zu Menschen und
  Sachwerten halten und dich nie allein auf die Funkverbindung verlassen.
- Die Nutzung erfolgt **vollständig auf eigenes Risiko.** Der volle
  Gewährleistungs-/Haftungsausschluss steht in [`LICENSE`](LICENSE).

## Lizenz

YonderRC steht unter **CC BY-NC-ND 4.0** (Namensnennung – nicht kommerziell –
keine Bearbeitung) **mit einem Zusatz: keine militärische oder kriegerische
Nutzung**. Kurz: kostenlos nutzen und unveränderte Kopien mit Quellenangabe
weitergeben; kein Verändern, keine kommerzielle und keine militärische Nutzung.
Der volle Text steht in [`LICENSE`](LICENSE).
