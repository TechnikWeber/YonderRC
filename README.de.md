[English](README.md) · **Deutsch**

# YonderRC

Fernsteuerung jenseits der Sichtweite über IP — eine App für **Video, Steuerung
und Konfiguration** von Autos, Booten, Flugzeugen und Drohnen. Läuft im Browser
(inkl. Smartphone), als Desktop-App (Windows/Linux) und auf einem Raspberry Pi als
Fahrzeugrechner. Niedrige Latenz, ausgelegt für den Betrieb über LTE.

Alles ist **im Simulator lauffähig — ganz ohne Hardware**. Für den echten Aufbau
auf dem Pi (Teileliste, Verkabelung, Schritt für Schritt WLAN → LTE) siehe
[`docs/HARDWARE.de.md`](docs/HARDWARE.de.md).

![Bodenstation im Fahrbetrieb: FPV-Video mit vollem OSD — GPS-Fix und Home-Kompass mit Distanz, Odometer und Speed oben links, Akku-Balken oben rechts, Link-Signal und Stats unten rechts](docs/screenshots/Overview_OSD.png?v=2)

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
  wählbarer Eingabemethode und pro Achse einstellbarem Einrasten (Mitte/Min/frei).
- Pro Kanal Trim, Expo, Reverse, Endpunkte (µs) und Failsafe-Wert.
- **Tempolimit mit drei Stufen** (Low / Mid / High, Prozentwerte pro Modell): drei
  Buttons unter den Sticks schalten im Fahrbetrieb um, alternativ ein belegbarer
  Controller-Button. Der Befehl wird **um die Ruhelage des Gaskanals** skaliert — ein
  Auto mit Rückwärtsgang wird in beide Richtungen begrenzt, ein Flugzeug behält seinen
  exakten Leerlauf und wird nur nach oben begrenzt. Endpunkte, Failsafe, Disarm-Wert und
  Pre-Arm-Check bleiben unangetastet.

![Touch-Steuerung mit Lenk-/Gas-Joysticks, Halten-zum-Armen-Button, Lights/Horn-Buttons, WebRTC-Steuerschalter und Status-Leiste](docs/screenshots/TouchInputs_and_Status.png?v=3)

*Touch-Steuerung (Multitouch-Joysticks, belegbare Buttons), der **Halten-zum-Armen**-
Button, der optionale **WebRTC-Steuerkanal**-Schalter und eine Status-Leiste: Link,
Zustand, Session-Zeit, Round-Trip, Eingabemethode, Fahrzeug/Treiber, Telemetrie.*

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
- Modellwechsel und Einstellungen sind im gearmten Zustand gesperrt.
- **Optionales Shared Secret** (standardmäßig aus): einmal gesetzt, verlangen der
  Steuer-Link und die Setup-API es — erster Verbindungsaufbau bleibt schnell, bei
  Bedarf abschließbar.

![Kanal-Monitor: tatsächliche µs-Ausgabe je Kanal, Throttle „HELD SAFE · DISARMED“](docs/screenshots/ChannelOutput_Monitor.png?v=2)

*Kanal-Monitor: zeigt die **echte** Fahrzeug-Ausgabe in µs inklusive Failsafe und
Disarm — der Throttle-Kanal wird sichtbar sicher gehalten, solange disarmed.*

**Video (FPV)**
- Latenzarmes Video über **go2rtc/WebRTC**; H.264-Encoder wird automatisch erkannt
  (`libx264`, `libopenh264`, Pi-Hardware).
- **Selbstheilend**: erkennt eingefrorenes/abgerissenes Bild und verbindet sich
  automatisch neu; der letzte Frame bleibt stehen.
- **Video-Qualität live umschaltbar** von der Groundstation (High/Medium/Low) oder
  **Auto**: schaltet bei steigendem Verlust/Latenz schnell herunter und erst wieder
  hoch, wenn die Verbindung klar gut ist (Schwellen einstellbar).
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
- **Blackbox-Logging** (optional, standardmäßig aus): 2-Hz-CSV mit Arm-/Failsafe-
  Zustand, Link, Round-Trip, Bitrate, Loss, FPS, Video-Latenz, mAh und Prozent — dazu
  **je eine Spalte pro Telemetriekanal** (`Pack_V`, `BEC_V`, `I1_A`, `Motor_C`…), damit
  jede konfigurierte Spannung, jeder Strom und jede Temperatur im Log landet. Bis ca.
  5 h, herunterladbar unter Setup › Controls.

**GPS & Navigation**
- **Wählbare GPS-Quelle**: lokaler NMEA-Empfänger über Serial (Adafruit Ultimate GPS,
  u-blox NEO-6/7/8/M9, BN-880…), ein USB-Dongle über **gpsd**, eine **Sim**-Quelle oder
  (später) **MAVLink** vom Flight Controller — alles zu einem Fix normalisiert.
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

  ![Setup-Seite des Fahrzeugs: System-Status (LTE-Modem, Betreiber, Tailscale, WiFi) und der LTE-Bereich mit APN, SIM-PIN, APN-Auth und Netzmodus](docs/screenshots/VehicleConfig_Setup.png?v=2)

  *Setup-Seite direkt vom Fahrzeug: System-Status (Modus, LTE-Modem/Betreiber,
  Fernzugriff, WiFi) und der robuste **LTE**-Bereich — APN, SIM-PIN, APN-Benutzer/Passwort
  und Netzmodus. Bedienbar vom Handy ohne Bildschirm.*
- **Fernzugriff, eine Methode wählen**: **Tailscale** oder **ZeroTier** (Zero-Config-
  Mesh-VPNs) oder **WireGuard** — einfach die von deinem eigenen Server oder einer
  **FritzBox** exportierte **`.conf` hochladen**. Kommt beim Boot automatisch hoch.
- **Robustes LTE-Setup** (nicht nur Plug-and-Play): APN, **SIM-PIN**, **APN-Benutzer/
  Passwort**, **Netzmodus** (nur 4G), **Roaming**-Schalter, live **Diagnose** (rohe
  `mmcli`-Ausgabe) und **SIM-PIN ändern/entfernen**. `autoconnect` wählt selbst neu.
- **Geführter Hardware-Selbsttest**: Kanal-Sweep, Sensoren lesen, Kamera-Standbild.
- **Werksreset** für Fahrzeug und Boden-App.
- **Autark im Feld**: ohne Netz startet der Pi einen WLAN-Hotspot und öffnet per
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
`http://<pi-ip>:8080/setup` öffnen und **Detect hardware** drücken — es schlägt
Treiber/Sensoren anhand des I²C-Bus vor. Lieber manuell? Dann die Schritte unten.

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
