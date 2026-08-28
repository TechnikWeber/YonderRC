[English](HARDWARE.md) · **Deutsch**

# YonderRC — Hardware-Guide (Teileliste, Verkabelung, Einrichtung)

Von der reinen Simulation zu echter Hardware: ein Raspberry Pi als Fahrzeugrechner, ein
PCA9685 für Servos/ESC, ein INA228 für Strom/Spannung, eine Kamera für FPV — erst über
WLAN, dann über LTE mit Tailscale.

> **Sicherheit zuerst.** Für den ersten Test: **Props ab / Räder hoch**, ESC stromlos oder
> Motor abgesteckt. Antriebsstrom erst, wenn jeder Kanal nachweislich das Richtige tut.
> Armen ist immer der **letzte** Schritt.

---

## 1. Teileliste

### Pflicht

| Teil | Empfehlung | Warum |
|---|---|---|
| Rechner | **Raspberry Pi 4** (2 GB reichen) oder **Pi Zero 2 W** | Hardware-H.264-Encoder für latenzarmes FPV. **Der Pi 5 hat keinen.** |
| Speicher | microSD 32 GB (A1/A2) | Für Raspberry Pi OS Lite. |
| Servo/ESC-Treiber | **PCA9685** 16-Kanal-PWM (I2C), verschoben auf **0x41** | Saubere 50-Hz-Servosignale unabhängig von der CPU. Lötbrücke **A0** schließen, damit er nicht mit dem Sensor kollidiert (2.1). |
| Strom-/Spannungssensor | **INA228**-Breakout (I2C) auf **0x40**, **2 mΩ Shunt** (`R002`) | Akkuspannung und Strom, High-Side. Zählt Ladung und Energie selbst, 85 V Bus (bis 12S), 20 Bit. |
| Pi-Stromversorgung | **UBEC/BEC 5 V / 3 A** | Versorgt den Pi aus dem Fahrakku. |
| Kamera | **Pi Camera Module 3** (CSI) *oder* USB-Kamera mit H.264 | CSI = niedrigste Latenz. |
| Verkabelung | Jumper, JST, Lötzeug | I2C-Bus, Servostecker, Sensor. |

### Optional

| Teil | Empfehlung | Warum |
|---|---|---|
| GPS | **Adafruit Ultimate GPS v3** (MTK3339) | NMEA 9600 an der Header-UART, gepuffert. u-blox NEO-6/7/8/M9 und BN-880 gehen genauso (2.6). |
| LTE | siehe „Für LTE" unten | Jenseits der Sichtweite. |
| Temperatur | siehe 2.7 | Motor-/ESC-/Akkutemperaturen im OSD. |

### Der Referenzaufbau

Was die Setup-Seite für dich einträgt und wovon dieser Guide ausgeht. Alles änderbar.

| Was | Wert | Warum dieser |
|---|---|---|
| INA228-Adresse | **0x40** | Werksadresse; der Telemetriekanal nutzt sie als Standard. |
| PCA9685-Adresse | **0x41** | Beide Chips kommen auf 0x40, und die Treiberadresse ist die, die sich im Browser ändern lässt (2.1). |
| Shunt | **0,002 Ω** (`R002`) | Was übliche 85-V-Breakouts tragen. Eigenes Board ablesen und **gegen ein Referenzgerät kalibrieren**. |
| Max. Strom | **20 A** | Setzt das LSB des Chips, also die Auflösung des mAh/Wh-Zählers. Nimm die echte Spitze deines Modells. |
| Shunt-Bereich | ±163,84 mV | 0,002 Ω × 20 A = 40 mV passt *knapp* in ±40,96 mV, ohne Reserve — darüber klippt die Anzeige lautlos. |
| GPS | `/dev/serial0`, 9600 Baud | Der Alias für die Header-UART; ttyAMA0 ist die Bluetooth-UART (2.6). |
| Steuerung | Bildschirm-Pad (Touch) | Demo-Auto und -Boot starten im Touch-Modus, ein Handy am Hotspot kann also sofort fahren. |

### Welcher Stromsensor? (Empfehlung INA228)

Alle unterstützt und gleich konfiguriert — High-Side verdrahten, Shunt-Wert eintragen.

| Sensor | Bus-Bereich | Auflösung | Ladungszähler | Wann |
|---|---|---|---|---|
| **INA228** | 85 V | 20 Bit | **ja — im Chip** | **Empfohlen.** Bis 12S, und die mAh kommen aus dem Sensor. |
| INA238 | 85 V | 16 Bit | nein | Günstigere 85-V-Option, gleiche Verkabelung. Der Pi integriert. |
| INA237 | 85 V | 16 Bit | nein | Wie INA238, geringere Genauigkeitsklasse. |
| INA226 | 36 V | 16 Bit | nein | Gut bis 8S; das häufigste Breakout. |
| INA219 | 26 V | 12 Bit | nein | Kleine Ströme / kleine Akkus. |
| INA260 | 36 V | 16 Bit | nein | Integrierter 2-mΩ-Shunt, bis ~15 A. |
| INA3221 | 26 V | 13 Bit | nein | Drei Kanäle gleichzeitig, grob. |

Der INA228 integriert **Ladung und Energie in Hardware** mit ADC-Rate — die verbrauchten
mAh hängen also nicht mehr an der Abtastrate oder an einem verpassten Sample. Jeder andere
Sensor wird auf dem Pi integriert: präzise, aber nur so gut wie die Abtastung.

Auslegung: Shunt so wählen, dass `max. Strom × Shunt ≤ 163 mV` (z. B. 1 mΩ für 100 A).
Unter **40,96 mV** kannst du auf den ±40,96-mV-Bereich umschalten — 4× Auflösung.

**Das Shunt-Feld ist ein Kalibrierfaktor**, kein Datenblattwert — Toleranz und
Klemmenwiderstand landen beide in der Messung. Bekannten Strom einspeisen und
`alter Shunt × Anzeige / echter Strom` eintragen. Am Referenzaufbau wurden aus nominell
0,002 Ω genau 0,00206 Ω — 3 % Fehler, den keine Auflösung gefunden hätte.

### Für LTE (Phase 2)

| Teil | Empfehlung |
|---|---|
| LTE-Stick | USB-Dongle, den ModemManager unterstützt (Huawei E3372 im „Stick"/NCM-Modus, Quectel EG25-G) — oder ein HiLink-Stick, siehe 4.1.1 |
| SIM | Daten-SIM mit bekanntem APN |

### Je nach Fahrzeug

- **Auto/Boot:** ESC + Lenk-/Ruderservo.
- **Flugzeug:** ESC + Servos (Quer/Höhe/Seite/Gas).
- **Drohne:** meist ein **Flight Controller** über **SBUS** statt des PCA9685.

---

## 2. Verkabelung

### 2.1 PCA9685 ↔ Raspberry Pi (I2C)

| PCA9685 | Raspberry Pi (BCM) | Pin |
|---|---|---|
| VCC (Logik) | 3V3 | Pin 1 |
| GND | GND | Pin 6 |
| SDA | GPIO2 / SDA1 | Pin 3 |
| SCL | GPIO3 / SCL1 | Pin 5 |
| V+ (Servostrom) | **nicht** vom Pi! | eigenes BEC 5–6 V |

- **V+** ist die Servo-/ESC-Versorgung und kommt vom BEC, **nicht** vom Pi.
- Standardadresse **0x40**, die auch jeder INA2xx nutzt. **Sensor auf 0x40 lassen und den
  PCA9685 auf 0x41 verschieben** (Brücke **A0** schließen), dann `0x41` unter Setup ›
  *Vehicle configuration* eintragen und den Dienst neu starten. Der PCA weicht aus, weil
  seine Adresse im Browser einstellbar ist.
- Der PCA9685 antwortet zusätzlich auf **0x70**, seiner *All-Call*-Adresse. Er hat kein
  ID-Register, und genau darüber unterscheidet **Detect hardware** ihn von einem INA2xx.
  YonderRC lässt All-Call absichtlich aktiv, damit der Chip im Betrieb erkennbar bleibt.
- Servos/ESC an die Ausgänge 0–15. App-Kanäle 1–16 entsprechen PCA9685-Kanälen 0–15.

### 2.2 INA228 (Strom/Spannung) ↔ I2C

*(Identisch für INA226/237/238 — nur der Setup-Eintrag ändert sich.)*

Ein Breakout hat **zwei Seiten**: der kleine Header führt I²C, der Laststrom läuft über
die separaten Klemmen — niemals über den Header.

| INA228-Board | Raspberry Pi (BCM) | Pin |
|---|---|---|
| VCC | **3V3** | Pin 1 |
| GND | GND | Pin 6 |
| SDA | GPIO2 / SDA1 | Pin 3 |
| SCL | GPIO3 / SCL1 | Pin 5 |
| ALE / ALERT | — | offen lassen |

- **VCC an 3V3, nicht an 5 V**, außer das Board hat einen Levelshifter (Adafruit/STEMMA
  ja, einfache CJMCU-Boards nein). Ohne würden die Pull-ups SDA/SCL auf 5 V ziehen.
- SDA/SCL teilen sich den Bus mit dem PCA9685. INA auf 0x40 lassen und den PCA verschieben
  (2.1); muss doch der Sensor weichen, ist seine Adresse ein Feld an jedem Telemetriekanal.
- **High-Side** in der Plusleitung: Akku(+) → `VIN+`, Last → `VIN−`. Shunt vom Board
  ablesen: `R001` = 0,001 Ω, `R002` = 0,002 Ω, `R015` = 0,015 Ω. Er begrenzt auch, was der
  Chip sieht — **I_max = 163,84 mV / R_Shunt** (0,015 Ω ≈ 10 A, 0,001 Ω ≈ 160 A).
- **VBUS** misst gegen die Sensormasse, ein INA228 liefert also Spannung *und* Strom ohne
  zusätzlichen Teiler.
- Die **GND** des Sensors gehört an den gemeinsamen Massepunkt.

```
Akku(+) ──► [INA228 VIN+  VIN−] ──► ESC/BEC (+)
Akku(−) ─────────────── gemeinsame Masse ───────────────
                 │
              Pi GND, PCA9685 GND, BEC GND  (ALLE zusammen!)
```

> **Eine gemeinsame Masse ist Pflicht.** Pi, PCA9685, Sensor, BEC und ESC müssen sie
> teilen, sonst sind Servosignale und Messwerte unzuverlässig.

### 2.3 Stromversorgung

```
Fahrakku ──► BEC 5V/3A ──► Pi (5V/GND, z. B. GPIO Pin 2/6 oder USB-C)
        └──► ESC ──► Motor
```

- Den Pi **nicht** aus einem PCA9685-Kanal speisen.
- **Servo-V+ kommt ebenfalls nicht vom Pi.** Die 5-V-Header-Pins hängen ohne eigene
  Sicherung am Eingangsrail, ein ziehender Servo bricht das ganze Board ein — und dieser
  Fehler sieht aus wie ein Softwareabsturz, nicht wie ein Stromproblem: Bild läuft, Freeze,
  eine Minute später wieder da. Irgendwann kostet es die SD-Karte.
- **5,1 V / 3 A mit kurzem, dickem Kabel.** Kamera plus LTE-Stick am Handy-Netzteil ist
  schon darüber.
- **Gemessener Leerlaufstrom** (Pi 4B + CSI-Kamera + HiLink-LTE-Stick + PCA9685 + GPS,
  streamend, Motor steht): **0,7–1,0 A bei 7,2 V** ≈ 5–7 W — **1,4–2 A hinter einem
  5-V-Regler, bevor sich ein Servo bewegt**. „5 V / 3 A" ist die Untergrenze, nicht die
  Reserve. Ein 5-A-Buck-Boost am Akku hielt `vcgencmd get_throttled` bei `0x0`.
- Das Fahrzeug zeigt **⚠ POWER** im OSD, solange die Schiene unter Spezifikation liegt, und
  unterscheidet eine thermische Drosselung davon. `0x0` heißt gesunde Schiene.
- Einschaltreihenfolge: Elektronik zuerst, Antrieb zuletzt. Zum Ausschalten **Shut down**
  auf der Setup-Seite und die grüne LED abwarten.

### 2.4 Kamera

- **CSI:** Flachbandkabel an den Kameraport (Pi Zero: das schmalere Kabel).
- **USB:** einstecken; idealerweise eine, die selbst H.264 ausgibt.

### 2.5 Drohne per SBUS (optional, statt PCA9685)

- Pi **UART TX** (GPIO14 / Pin 8) → **SBUS-in** des Flight Controllers.
- SBUS ist **invertiert**, 100000 8E2. Hat der FC keinen internen Invert, braucht es einen
  Transistor-Inverter zwischen Pi-TX und FC.

### 2.6 GPS (optional)

**Adafruit Ultimate GPS** (MTK3339), **u-blox NEO-6M/7M/8M/M9N**, **Beitian BN-220/880** —
die meisten sprechen **NMEA mit 9600 Baud** über UART.

| GPS | Raspberry Pi | Pin |
|---|---|---|
| VCC | 3V3 (oder 5V je Modul) | Pin 1 / 2 |
| GND | GND | Pin 6 |
| TX  | GPIO15 / RXD | Pin 10 |
| RX  | GPIO14 / TXD | Pin 8 |

- **TX und RX kreuzen sich.** Falsch herum gibt dasselbe Symptom wie kein Kabel: Stille.
- **`/dev/serial0`** verwenden — der Alias zeigt immer auf die UART am Header. **Nicht
  `/dev/ttyAMA0` auf einem Pi 3/4/5**: das ist die *Bluetooth*-PL011. Sie öffnet ohne
  Fehler und liefert nie ein Byte, was exakt wie ein Verkabelungsfehler aussieht. Setup ›
  GPS warnt davor. Die serielle Quelle braucht das optionale Paket `serialport` (3.3).
- **Raspberry Pi OS parkt eine Login-Konsole auf derselben UART**, und eine Konsole, die
  über den Empfänger redet, zerschießt dessen Sätze. Setup › GPS prüft beides (`enable_uart=1`, keine serielle
  Konsole) und bietet **Free the serial port for GPS** an (Backups als `*.yonderrc-bak`, Reboot nötig). Der
  Installer macht das bei Neuinstallationen seit v1.61.0.
- **Drinnen, wo es keinen Fix gibt:** das GPS-Panel zählt eingehende NMEA-Sätze und zeigt
  Satelliten *in Sicht*. Steigende Sätze bei 0 Satelliten heißt: Kabel, Baudrate und Port
  stimmen. „Nothing received" ist die Verkabelung; „no fix" ist das Dach.
- **USB-Dongles** (u-blox VK-172, GlobalSat BU-353): stattdessen die **gpsd**-Quelle.
- **Min. Satelliten** setzen (6 ist ein guter Standard) und **Auto-Home** aktivieren.

---

### 2.7 Temperatursensoren (optional)

Beliebig viele Kanäle, in Setup › Telemetry hinzugefügt, im OSD unter Spannung und Strom.

| Sensor | Bus | Bereich / Hinweise | Zusätzlich nötig |
|---|---|---|---|
| **Raspberry Pi SoC** | — | Die Die-Temperatur des Pi selbst | nichts |
| **DS18B20** | 1-Wire | −55…+125 °C, ±0,5 °C, auch als wasserdichte Sonde | `dtoverlay=w1-gpio` + 4,7 kΩ Pull-up auf 3V3 |
| **MCP9808 / TMP102 / TMP117** | I²C | −40…+125 °C; der TMP117 ist der genaue (±0,1 °C) | Adresse (0x18 / 0x48…) |
| **BMP280 / BME280** | I²C | Umgebungsluft; nicht für heiße Stellen | Adresse 0x76/0x77 |
| **MAX6675 / MAX31855** | SPI | Typ-K-Thermoelement bis ~1000 °C — Motoren, ESCs | `dtparam=spi=on` |
| **MAX31856** | SPI | Thermoelement mit wählbarem Typ (B/E/J/K/N/R/S/T) | `dtparam=spi=on` |
| **MAX31865** | SPI | PT100/PT1000 bis ~600 °C | `dtparam=spi=on`, Referenzwiderstand 430 Ω / 4300 Ω |
| **ADS1115 / MCP3008 + NTC oder PT100** | I²C / SPI | Günstigste Variante | Vorwiderstand, Speisespannung, NTC R25/Beta |

- 1-Wire- und I²C-Sensoren **teilen sich den Bus** mit PCA9685/INA — nur die Adressen
  müssen sich unterscheiden. SPI-Verstärker brauchen je ein eigenes Chip-Select (CE0/CE1).
- **NTC/PT100 an einem ADC** ist ein Teiler: Speisung → Festwiderstand → Sonde → GND, der
  ADC-Eingang dazwischen. Festwiderstand als *Vorwiderstand* eintragen, beim NTC dazu
  `R25/Beta` (z. B. `10000/3950`).
- **Thermoelemente messen Heißes, nicht Genaues** (±2 °C). Für Akkutemperatur ist ein
  DS18B20 an den Zellen besser.
- Ein nicht lesbarer Sensor wird **aus dem OSD weggelassen**, nie als 0 °C gezeigt.

---

### 2.8 GPIO-PWM (statt PCA9685)

Mit `YRC_DRIVER=gpio-pwm` erzeugt der Pi die Impulse selbst über `pigpio` (DMA-getaktet).
Kein Zusatzboard, aber CPU und ein GPIO pro Kanal sind jetzt Teil des Signalwegs. **Ab ein
paar Kanälen bleibt der PCA9685 die bessere Antwort.**

Standard-Pinbelegung (BCM), Kanal 1 → 16:

| CH | BCM | Header-Pin | | CH | BCM | Header-Pin |
|---|---|---|---|---|---|---|
| 1 | 17 | 11 | | 9 | 6 | 31 |
| 2 | 18 | 12 | | 10 | 12 | 32 |
| 3 | 27 | 13 | | 11 | 13 | 33 |
| 4 | 22 | 15 | | 12 | 16 | 36 |
| 5 | 23 | 16 | | 13 | 19 | 35 |
| 6 | 24 | 18 | | 14 | 20 | 38 |
| 7 | 25 | 22 | | 15 | 21 | 40 |
| 8 | 5 | 29 | | 16 | 26 | 37 |

- **Ändern mit `YRC_GPIO_PINS`** (BCM-Nummern in Kanalreihenfolge), z. B.
  `YRC_GPIO_PINS=17,18,27,22`. Die **Länge begrenzt die Kanalzahl**. Kein Feld in der UI.
- Der Dienst loggt die benutzte Belegung: `[gpio-pwm] ready on BCM pins […]`.
- **Kanal 3 (BCM 27) ist das Standard-Gas** (`YRC_THROTTLE_CH=2`, 0-basiert).
- Alle Pins starten auf **1500 µs**; beim Herunterfahren werden die Impulse abgeschaltet.
- `pigpio` **braucht root** — die mitgelieferte Unit läuft bereits als root.

#### Passt zum Referenzaufbau

Die Belegung meidet jeden Bus dieses Guides, GPIO-PWM, INA228, GPS und ein
Temperatursensor können also gleichzeitig laufen:

| Bleibt frei | Pins | Genutzt von |
|---|---|---|
| I²C1 | BCM 2/3 (Header 3/5) | INA228/226, MCP9808/TMP102/TMP117, BMP280/BME280, ADS1115 |
| UART0 | BCM 14/15 (Header 8/10) | serielles GPS — und SBUS |
| SPI0 | BCM 7–11 (Header 19/21/23/24/26) | MAX6675/31855/31856/31865, MCP3008 |
| 1-Wire | BCM 4 (Header 7) | DS18B20 (`dtoverlay=w1-gpio` Standard) |

- **BCM 18/19/20/21 sind zugleich I²S.** Nur mit einem Audio-HAT ein Problem.
- **Den 1-Wire-Pin verschieben, nicht wiederverwenden.** `dtoverlay=w1-gpio,gpiopin=17`
  macht GPIO 17 zum Kernel-Pin, und Kanal 1 verstummt. DS18B20 auf GPIO 4 lassen.

> **Strom bleibt wie in 2.3:** Servo-/ESC-Strom vom BEC, nie von den 5-V-Pins des Pi. Der
> Pi liefert nur das **Signal**, und eine **gemeinsame Masse** ist Pflicht.

---

## 3. Software — Schritt für Schritt (zuerst WLAN)

### 3.1 Raspberry Pi OS flashen

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit)**. Der Installer ist gegen
   **Bookworm** getestet; neuere Releases sollten gehen, sind aber nicht verifiziert.
2. In den Imager-Einstellungen (Zahnrad): **SSH aktivieren**, Benutzer setzen,
   **WLAN-Zugangsdaten** eintragen, Hostname z. B. `yonderrc`.
3. Flashen, einsetzen, einschalten.

### 3.2 Einloggen und Projekt auf den Pi kopieren

```bash
ssh pi@yonderrc.local          # oder die IP aus dem Router
```

Dann das Projekt nach `/opt/yonderrc` bringen. **Drei Wege — einer genügt:**

**a) git clone (am einfachsten, wenn der Pi Internet hat)**
```bash
sudo mkdir -p /opt/yonderrc
sudo chown $USER /opt/yonderrc
git clone https://github.com/TechnikWeber/YonderRC.git /opt/yonderrc
```

**b) scp vom Laptop** — auf dem **Laptop** ausführen:
```bash
# im Ordner, der YonderRC enthält:
scp -r ~/YonderRC pi@yonderrc.local:/tmp/YonderRC
# dann auf dem Pi:
ssh pi@yonderrc.local 'sudo mkdir -p /opt/yonderrc && sudo cp -a /tmp/YonderRC/. /opt/yonderrc/'
```
`node_modules` nicht mitkopieren — der Installer installiert ohnehin frisch.

**c) USB-Stick (Pi ohne Netz)**
```bash
sudo mkdir -p /opt/yonderrc
sudo cp -a /media/*/YonderRC/. /opt/yonderrc/   # Pfad anpassen (lsblk zeigt das Laufwerk)
```

Dann installieren:

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

Das installiert Node 22, ffmpeg, NetworkManager, ModemManager, `usb-modeswitch`,
`i2c-tools`, `gpsd`, `wireguard-tools`, Tailscale, ZeroTier und go2rtc, richtet die drei
systemd-Dienste (`yonderrc-vehicle`, `go2rtc`, `yonderrc-onboard`) ein und aktiviert
**I2C** und **UART**.

### 3.3 Hardware-Treiber-Abhängigkeiten (nur was du nutzt)

Die nativen Bibliotheken sind **optionale Abhängigkeiten** — sie werden auf dem Pi
kompiliert und ein Fahrzeug braucht höchstens eine, deshalb läuft der Installer mit
`npm install --omit=optional`.

**Die benötigte im Browser installieren** — Setup › Vehicle configuration › **Native
driver modules**:

| Modul | nötig für |
| --- | --- |
| `i2c-bus` | PCA9685-Servo/ESC-Treiber · INA2xx-Stromsensoren · ADS1115-ADC |
| `pigpio` | GPIO-PWM statt PCA9685 (Pinbelegung: 2.8) |
| `serialport` | SBUS-Ausgabe (Flight Controller) · serielles GPS |

Jede Zeile zeigt ihren Status und hat einen **Install**-Knopf; danach bietet die Seite den
Dienst-Neustart an. Drei Dinge:

- Der Pi braucht **Internet** — sein eigener Hotspot hat keinen Uplink, also erst in ein
  Netz einbuchen.
- Es **dauert eine Minute**: das Modul wird auf dem Pi kompiliert.
- Ein fehlgeschlagener Build nennt Ursache und Befehl. Meist
  `sudo apt install -y build-essential`; `pigpio` braucht zusätzlich
  `sudo apt install -y pigpio`.

Was installiert wurde, wird gemerkt (`hardwareDeps`) und von `install.sh` nach jedem Update
wiederhergestellt — ein Update kann ein konfiguriertes Fahrzeug also nicht zum Simulator
zurückmachen.

Stattdessen über SSH:

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA2xx
npm install pigpio     -w @yonderrc/vehicle    # GPIO-PWM (Pins: 2.8)
npm install serialport -w @yonderrc/vehicle    # SBUS, serielles GPS
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Das Fahrzeug aktualisieren

**Von der Setup-Seite** — *Software update*:

1. **Check for updates** meldet installierte Version, verfügbare Version, wie viele Commits
   fehlen und jede Betreffzeile. Es ändert nichts.
2. **Update & restart** macht, was eine SSH-Sitzung täte — `git pull --ff-only`, geänderte
   Abhängigkeiten installieren, die Boden-App bei Bedarf neu bauen — und startet den Dienst
   zuletzt neu, damit er nie in einem halb aktualisierten Checkout hochkommt.

Es verweigert mit Begründung bei **lokalen Änderungen** (ein Fast-Forward würde scheitern
oder sie verwerfen) und **ohne Internet**. Ein fehlgeschlagener Schritt stoppt dort, die
alte Version läuft weiter.

**Update-Quelle.** Standard ist `origin` / `main` des Checkouts. Die zwei Felder unter
*Update source* nehmen einen Remote-Namen oder eine volle URL plus Branch, ein Fahrzeug
kann also ohne Codeänderung auf deinen Fork oder einen Testbranch zeigen.

> **Die generierte Video-Config** liegt unter **`/var/lib/yonderrc/go2rtc.yaml`**, außerhalb
> des Checkouts (`YRC_GO2RTC_CONFIG` überschreibt das). Im Repo geschrieben hinterließ sie
> auf jedem Fahrzeug lokale Änderungen — genau das, worüber ein Fast-Forward stolpert.
> `install.sh` verschiebt eine vorhandene Datei einmalig.

> **Nicht abgedeckt:** apt-Pakete, systemd-Units und `install.sh` selbst. Wenn die Prüfung
> sagt, der Installer hat sich geändert, einmal `sudo bash provisioning/install.sh` laufen
> lassen.

Das Gegenstück über SSH:

```bash
cd /opt/yonderrc
sudo git pull --ff-only
sudo systemctl restart yonderrc-vehicle
# …und wenn sich Boden-App oder Abhängigkeiten geändert haben, stattdessen der volle Lauf:
sudo bash provisioning/install.sh
```

### 3.5 Über WLAN einrichten (grafisch)

**`http://yonderrc.local:8080/setup`** öffnen (oder `http://<pi-ip>:8080/setup`).

Sieben Tabs — **Overview · Network · Remote access · Sensors & outputs · Camera · GPS ·
Design**. *Overview* beantwortet „ist alles da?" auf einem Schirm. *Design* wählt hell
(Standard) oder dunkel; das Fahrzeug speichert es und schiebt es an die Boden-App, das
Video-Overlay bleibt in beiden hell auf dunkel. Jeder Tab ist eine URL (`…/setup#gps`).
Lange Erklärungen stecken hinter einer einzeiligen Zusammenfassung.

0. **Detect hardware** (in *Vehicle configuration*) scannt I²C, `mmcli` und die
   Kamera-Devices. Chips mit ID-Register werden **ausgelesen**, nicht geraten — eine
   ✓-Zeile nennt das echte Bauteil, und der PCA9685 wird über seine All-Call-Adresse
   gefunden. **Use these addresses** trägt sie in die Formulare ein; gespeichert wird erst
   mit Save.
1. **Vehicle:** Name, **Output driver = `pca9685`** (Drohne: `sbus`; ohne Zusatzboard:
   `gpio-pwm`, Pins in 2.8), Gaskanal prüfen. Bei `pca9685` erscheint ein
   **I²C-Adressfeld** — **0x41** beim Referenzaufbau, 0x40 bei einem Board ohne Sensor
   daneben. Der Treiber wird beim Start gebaut, also speichern und **Restart vehicle
   service** nutzen. Die Checkbox *Auto-disarm on reconnect* ist nur ein **Fallback**; eine
   verbundene Bodenstation schiebt die zum Modelltyp passende Einstellung.
2. **CSI camera module:** den Sensor am Kameraport wählen. Nur die offiziellen
   Raspberry-Pi-Kameras werden automatisch erkannt; alles andere braucht ein
   Device-Tree-Overlay, das **nur beim Booten** gelesen wird. Die Auswahl schreibt
   `camera_auto_detect` und `dtoverlay=` in `/boot/firmware/config.txt` (ein Backup als
   `config.txt.yonderrc-bak`, konkurrierende Zeilen auskommentiert), und das Panel meldet
   *Reboot required*, bis der Pi damit gebootet hat. Ein Pi 4 hat einen CSI-Anschluss, das
   ist also eine Wahl pro Fahrzeug; USB-Kameras sind davon unberührt. Ein Sensor, der nicht
   in der Liste steht, kommt unter *Other module* — akzeptiert nur, wenn das `.dtbo` da ist.
3. **Cameras:** Kamera hinzufügen (Typ `rpicam` oder `usb`, Auflösung/FPS/Bitrate) →
   **Save & apply**. go2rtc lädt neu.

   - **Kopfüber montiert?** Jede Kamera hat **Rotation** (0°/180°) plus horizontale und
     vertikale Spiegelung. Bei CSI macht das der Sensor kostenlos, bei USB ein
     ffmpeg-Filter. 90°/270° gibt es bewusst nicht — der Sensor kann es nicht, und es
     nachzubauen hieße, einen Transcode in die Pipeline zurückzuholen.
   - **Keine Kamera ist eine gültige Konfiguration.** Alle Einträge entfernen, und der
     FPV-Bereich bleibt dunkel: nichts wird wiederholt, kein Fehler, OSD/Telemetrie/
     Steuerung laufen weiter.
   - **`rpicam`-Stream bleibt schwarz?** `rpicam-hello --list-cameras` ist die Wahrheit.
     Bookworm hat die Werkzeuge von `libcamera-*` nach `rpicam-*` umbenannt; YonderRC
     erkennt das selbst. Die offiziellen OV5647 / IMX219 / IMX477 / IMX708 brauchen nur
     `camera_auto_detect=1`. Andere — **Arducam IMX519 / 64MP / Pivariety, OV64A40** —
     zusätzlich `camera_auto_detect=0`, ein explizites `dtoverlay=` und einen Reboot, was
     das Panel **CSI camera module** erledigt. Schweigt auch die I²C-Adresse des Sensors
     (`sudo i2cdetect -y 10`, braucht `dtparam=i2c_vc=on`), ist es das Flachbandkabel: Kontakte Richtung HDMI, **CAM**-
     Port, nicht DISPLAY.
   - **Arducam 16 MP IMX519 — scharfes Bild.** Raspberry Pis `imx519.json` hat keinen
     `rpi.af`-Algorithmus, libcamera beantwortet also jede Fokusanfrage mit *no AF
     algorithm* und die Linse bleibt in Ruhelage — was wie eine unscharfe Linse aussieht.
     **Tuning file** auf `/var/lib/yonderrc/tuning/imx519-af.json` setzen (von `install.sh`
     mitgeliefert) und einen **Focus**-Modus wählen. Am bewegten Modell lieber `manual` bei
     0 Dioptrien; `continuous` sucht ständig.
4. **Telemetry:** Quelle **`real`**, Stromsensor **`ina228`** (oder `ina226`/`ina237`/
   `ina238`) — die Auswahl füllt die Referenzwerte. `Shunt Ω` auf den Aufdruck deines
   Boards korrigieren und **Max current A** auf die echte Spitze deines Modells setzen. Das
   **I²C-Adressfeld** bleibt für den Standard 0x40 leer. Einen Spannungskanal derselben Art
   hinzufügen — der INA liefert beides. Akkukapazität eintragen, Anzeigeart und die Quelle
   für die **Akku-%** wählen, **Charge counter** auf `auto` lassen. Bei mehr als einem
   Spannungs- oder Stromkanal den, der den Akku misst, als **primary** markieren.
   **Temperaturkanäle** sind optional (2.7).
5. **Security (optional):** ein **API-Secret** setzen, wenn das Fahrzeug in einem Netz
   hängt, dem du nicht ganz traust — siehe 6.1. Standardmäßig aus.

### 3.6 Erster Funktionstest (RÄDER HOCH / PROPS AB!)

1. Boden-App öffnen, `ws://yonderrc.local:8080` eintragen, **Connect**.
2. **Nicht armen.** Im Kanal-Monitor: bewegt die Lenkung den richtigen Kanal? Endpunkte
   ok? Trim/EPA/Reverse im Setup anpassen.
3. **ESC-Kalibrierung** bei Bedarf — sie lehrt den ESC die **Endpunkte des Gaskanals**
   (über dem Startknopf angezeigt), also den Weg dieses Kanals vorher setzen. Das
   profilweite *Endpoints*-Feld ist ein **Sammelschreiben**, keine Obergrenze.
4. Erst dann: armen, **den Arm-Button halten**, bis der Countdown durch ist, vorsichtig
   Gas geben.
5. **Video** sollte im FPV-Panel laufen.
6. **Telemetrie** prüfen: echte Akkuspannung, und **kein** „SIM"-Marker. „SIM" heißt, der
   Sensor wurde nicht gefunden — Verkabelung/Adresse/`i2c-bus` prüfen
   (`sudo i2cdetect -y 1`).

---

## 4. Von WLAN auf LTE umstellen (Phase 2)

LTE sitzt hinter **CGNAT**, das Fahrzeug hat also keine öffentliche IP. **Tailscale** legt
Pi und Bodengerät in dasselbe private Netz.

### 4.1 LTE-Stick

1. Dongle einstecken, `mmcli -L` prüfen.
2. In Setup › **LTE** den **APN** eintragen → **Connect**. Er wird gespeichert und
   verbindet beim Booten automatisch (`autoconnect`). **SIM-PIN** und
   **APN-Benutzer/Passwort** bei Bedarf eintragen — beides wird auf dem Fahrzeug gespeichert
   und nie wieder angezeigt. Sticks im „Zero-CD"-Modus übernimmt `usb-modeswitch`. Außerdem
   **4G-only** erzwingen, **Roaming** schalten, die **PIN-Sperre** ändern/entfernen und
   **Diagnostics** (rohes `mmcli`) laufen lassen.
3. Das **Uplink-Signal erscheint dann im OSD** (LTE-% von ModemManager, sonst WLAN-RSSI aus
   `iw dev wlan0 link`), unter 25 % als schwach markiert. Heißt die WLAN-Schnittstelle nicht
   `wlan0`, bleibt der WLAN-Wert leer; LTE ist davon unberührt.

### 4.1.1 HiLink-Sticks (Huawei E3372h-320 und Verwandte)

Viele Huawei-Sticks sind **keine Modems**: sie betreiben einen eigenen Router, erscheinen
als USB-Ethernet mit DHCP und wählen selbst. `mmcli -L` bleibt für sie ewig leer, §4.1 gilt
also nicht — ein leeres LTE-Panel ist erwartet, nicht kaputt.

YonderRC liest sie über ihre eigene API. **Setup › LTE stick (HiLink)** zeigt Modell,
Interface, Zustand, Betreiber, Netztyp und Signal, und das OSD zeigt die LTE-Prozente wie
bei jedem Modem.

- Der Stick wird **über die Routing-Tabelle** gefunden (`ip route get 192.168.8.1`), nie
  über den Interface-Namen — eine FritzBox an `eth0` und der Stick an `eth1` können also
  nie verwechselt werden, egal in welcher Reihenfolge sie hochkommen.
- **APN, SIM-PIN und Netzmodus stecken im Stick.** Das Fahrzeug **reicht dessen eigene
  Konfigurationsseite auf Port 8081 durch**: `http://<fahrzeug>:8081/` vom Hotspot, aus dem
  LAN oder über das VPN öffnen. Mit API-Secret einmal als `…:8081/?secret=DEIN_SECRET`
  öffnen. Ein leeres Portfeld schaltet den Proxy ab.
  > Auf einem **offenen** Hotspot erreicht jeder, der sich verbindet, die Admin-Seite des
  > Sticks. Vor dem Feldeinsatz ein Hotspot-Passwort oder API-Secret setzen.
- Ein roher API-Pfad im Browser liefert `125002` — der Stick will eine Session, die seine
  eigene UI aufbaut. Erwartet; YonderRC holt sich vorher ein Session-Token.
- Ein **reiner 2G/3G-Stick** (E3131/E353, USB-ID `12d1:14db`) wird markiert: mehrere
  Länder, Deutschland eingeschlossen, haben 3G vor Jahren abgeschaltet.

### 4.1.2 Datenvolumen-Budget

Ein FPV-Stream kostet **0,5–1 GB pro Stunde**, und nichts meldet, dass das Volumen zur
Neige geht. **Setup › Mobile data budget** zählt mit und zeigt `⚠ DATA` im OSD ab einem
eingestellten Anteil.

| Gemessen von | Sieht | Übersteht Neustart |
| --- | --- | --- |
| **dem Fahrzeug** (Standard) | jede kostenpflichtige Schnittstelle: LTE-Stick, Handy-Hotspot, getethertes Notebook | ja |
| **dem LTE-Stick** | nur Verkehr über den Stick | ja, im Flash des Sticks |

Bewusst nicht gezählt:

- **Der eigene WLAN-Hotspot des Fahrzeugs** — eine Bodenstation daran zieht den
  Videostream kostenlos (~900 MB/h). Dasselbe Funkmodul im *Client*-Modus wird gezählt.
- **VPN-Schnittstellen** (Tailscale, WireGuard, ZeroTier) — ihr Verkehr geht erneut über
  die echte Verbindung raus, beides zu zählen zählt jedes Byte doppelt.

Einstellungen: **Plan allowance** in MB (4096 = 4 GB), **Warn at** in % (Standard 80) und
optional der **Tag im Monat**, an dem der Tarif zurücksetzt. Sonst *Reset counter*. Mit
HiLink-Stick greift bei leerem Volumen das Limit, das im Stick schon gesetzt ist.

> Der Zähler wird alle 5 Minuten, alle 20 MB und beim Herunterfahren gespeichert — ein
> harter Stromausfall kostet höchstens die letzten Minuten.

### 4.2 Tailscale

1. **Setup › Remote access** → **Tailscale** → **Bring up**, Auth-Key-Feld leer. Der
   Login-Link erscheint in wenigen Sekunden; öffnen und das Gerät bestätigen — es tritt als
   `yonderrc` bei. Der Link bleibt im Status stehen, ein Reload verliert ihn also nicht.
2. Ohne Klicken: einen **Auth-Key** anlegen (*Settings › Keys*), einfügen, **Bring up**.
3. Die **Tailscale-IP** des Fahrzeugs steht danach im Setup-Status.
4. **Key-Expiry deaktivieren** (*Machines › yonderrc*), sonst fliegt es nach ~180 Tagen aus
   dem Tailnet — zuverlässig, während du im Feld stehst.

> Kommt gar kein Link, hat das Fahrzeug kein Internet oder Tailscale hängt. Über SSH gibt
> `sudo tailscale up --hostname=yonderrc` ihn direkt aus.

### 4.3 Von unterwegs verbinden

- Das Bodengerät ins selbe Tailnet holen.
- Die **Tailscale-IP** als Adresse nutzen: `ws://100.x.y.z:8080`. Video genauso über
  `http://100.x.y.z:1984`.

> Für den latenzärmsten WebRTC-Pfad über LTE kannst du später einen eigenen **TURN-Server
> (coturn)** auf einem günstigen VPS ergänzen. Tailscale allein liefert schon eine
> funktionierende verschlüsselte Verbindung.

#### Was dabei tatsächlich gemessen wurde (erster Feldtest)

Ein Nachmittag, ein Netz, ein Ort — ein Datenpunkt, kein Benchmark. Pi 4 mit einem
**Huawei E3372h-320** an der **internen** Antenne, Ethernet abgezogen; Boden ein
Fedora-Laptop im selben Tailnet.

| Messwert | Wert | Anmerkung |
|---|---|---|
| Tailscale-Pfad | **direkt, IPv6** | 69 ms, kein DERP-Relay |
| Steuer-Round-Trip | **110 ms** | ergibt 87/100 in der Link-Gesundheit |
| Video-Latenz | **128 ms** | kaum über dem Steuerpfad — die WebRTC-Strecke ist gesund |
| Video-Bitrate | 444 kbps | Auto-Qualität hatte wegen des schwachen Signals reduziert |
| LTE-Signal | **52 %** (≈ −106 dBm RSRP) | der begrenzende Faktor — OSD zeigte `⚠ SIGNAL` |

Zwei Dinge zum Mitnehmen. Die Zahl **benennt ihren eigenen Engpass**: 52 war das Signal,
die Lösung ist also eine Antenne, kein schnellerer Anschluss (der E3372h-320 hat zwei
TS-9-Buchsen, 10–20 dB wert). Und der Wechsel der Bodenstation von WLAN auf LTE mitten in
der Sitzung **löste Failsafe aus und nahm es zurück** — der Watchdog bei der Arbeit.

> Ein direkter Pfad ist nicht garantiert; hier klappte es, weil der Anbieter eine
> routbare **IPv6** vergeben hat. Hinter reinem CGNAT-IPv4 kann Tailscale auf ein Relay
> zurückfallen — mit `tailscale ping <fahrzeug>` prüfen.

### 4.4 Weitere Remote-Access-Methoden (Setup › Remote access)

**Eine** Methode wählen:

- **Tailscale** / **ZeroTier** — Zero-Config-Mesh-VPNs ohne eigenen Server. Für ZeroTier:
  Netz auf my.zerotier.com anlegen, die 16-stellige **Network ID** eintragen, *Bring up*,
  dann den Pi in ZeroTier Central autorisieren.
- **WireGuard (eigener Server / FritzBox)** — entweder die exportierte **`.conf`
  hochladen** oder die **Werte eintippen** (privater Schlüssel, Tunneladresse, öffentlicher
  Schlüssel des Servers, Endpoint, AllowedIPs). FritzBox: *Internet › Freigaben › VPN
  (WireGuard) › Verbindung hinzufügen*, Config herunterladen, hochladen, *Bring up*.
  **PersistentKeepalive auf 25** lassen — hinter Carrier-NAT hält ein Tunnel ohne das nur
  bis zur ersten Leerlaufminute. Kommt beim nächsten Booten automatisch hoch.

> ZeroTier/WireGuard brauchen ihre Werkzeuge auf dem Pi (`zerotier-cli`,
> `wireguard-tools`); der Installer bringt sie mit. Die Methode vor dem Feldeinsatz prüfen.

---

## 5. Lokal ohne Netz betreiben (AP-Modus + Handy)

Solange sein WLAN nicht in einem Netz eingebucht ist, startet der Pi kurz nach dem Booten
den eigenen Hotspot **„YonderRC-setup"** (Modus `always`, Standard seit v1.41.0) —
**offen, ohne Passwort**, damit das Captive Portal die Seite ohne Tipparbeit vorlegen kann.

1. Das Handy mit **„YonderRC-setup"** verbinden.
2. Das **Captive Portal** öffnet die Seite automatisch; sonst `http://192.168.4.1:8080/`.
3. Du bekommst **beides**: die Steuerung und unter **Setup** die volle Konfiguration.

> **Wenn sich die Seite nicht von selbst öffnet — Absicht.** Das Portal löst jeden Namen
> auf den Pi auf. Hat das Fahrzeug einen eigenen Uplink, **teilt der Hotspot dieses
> Internet**, und DNS zu kapern würde es kaputtmachen — YonderRC lässt DNS dann in Ruhe und
> du öffnest `http://192.168.4.1:8080/` selbst. Die Setup-Meldung sagt, was der Fall war.
> Handys öffnen die Seite zuverlässig; Laptops zeigen meist nur eine Benachrichtigung.

> **Das WLAN-Funkmodul muss erst an sein.** Raspberry Pi OS hält es rfkill-gesperrt, bis
> ein **WLAN-Land** gesetzt ist, und NetworkManager nennt das Gerät dann nur „unavailable".
> **Setup › WiFi › WiFi radio** zeigt den Zustand und entsperrt es mit einem Knopf, das
> Land aus der Locale des Pi vorbelegt. Der Hotspot-Start repariert es automatisch. Das
> Land bleibt editierbar — es entscheidet über Kanäle und Sendeleistung. Über SSH:
> `sudo raspi-config nonint do_wifi_country DE && sudo rfkill unblock wifi`.

### 5.1 Den Pi vom Handy aus ins WLAN bringen

**Setup › WiFi**, ohne Tastatur am Pi:

1. **Scan for networks** — SSID, Signal, Verschlüsselung.
2. Deins antippen, Passwort eingeben, **Connect**.
3. Der Pi hat **ein Funkmodul**, das Einbuchen schließt also den Hotspot — die Seite
   reagiert nicht mehr, was das erwartete Zeichen für Erfolg ist. Ins eigene WLAN
   zurückwechseln und `http://yonderrc.local:8080/setup` öffnen.
4. Bei falschem Passwort **kommt der Hotspot zurück**, du kannst dich also nicht aussperren.

### 5.2 Hotspot-Passwort und wann er startet

**Setup › WiFi › Setup hotspot** benennt ihn um, setzt ein Passwort (min. 8 Zeichen, WPA2 —
leer bleibt offen) und wählt, wann er startet:

| Modus | Verhalten |
|---|---|
| **always** (Standard) | Immer wenn das Funkmodul frei ist — **auch neben Ethernet oder LTE**. |
| **auto** | Nur **ganz ohne Uplink** beim Booten (Verhalten vor v1.41.0). |
| **off** | Startet nie von selbst. |

*Save* wirkt beim nächsten Start, *Save & start now* startet sofort neu (und wirft dich
raus, wenn du darüber verbunden bist), *Stop hotspot* nimmt ihn herunter.

> **Gib ihm ein Passwort**, sobald das Fahrzeug die Werkbank verlässt. Offen als Standard
> ist Absicht — nur so funktioniert das Captive Portal ohne Tipparbeit — aber ein offener
> AP heißt, jeder in Reichweite erreicht die Setup-Seite und, wenn aktiviert, die
> Admin-Seite des LTE-Sticks.

> **Ein Funkmodul, eine Aufgabe.** Das eingebaute WLAN kann den Hotspot bedienen **oder**
> sich in ein Netz einbuchen, nicht beides. `always` startet den Hotspot also neben **LTE**,
> aber nie während der Pi WLAN-Client ist. Für beides gleichzeitig braucht es einen
> **zweiten USB-WLAN-Adapter**.

> **Was den Hotspot schließt:** ein Netz aus Setup › WiFi beitreten, *Stop hotspot*, oder
> ein Reboot mit funktionierendem Uplink im Modus `auto`. Ein VPN oder eine LTE-Verbindung
> **nicht** — die laufen über andere Schnittstellen.

Das Fahrzeug liefert die Boden-App selbst aus, und die App verbindet sich zum selben Host
zurück, Video eingeschlossen — autark im Feld.

> **Sicherheit im AP-Modus** ist unverändert: Watchdog, Armen und Auto-Disarm gelten, und
> die Boden-App setzt Auto-Disarm nach Modelltyp.

---

## 6. Was YonderRC an Sicherheit dazutut

- **Failsafe-Watchdog:** bleiben gültige Steuerpakete länger als eingestellt aus (Standard
  300 ms), geht jeder Kanal auf seinen Failsafe-Wert. Die Standards sind
  **fahrzeugtyp-abhängig und getrennt vom Entschärfen**: Drohne hält Gas **Mitte**,
  Auto/Boot **Stopp**, Flugzeug **Motor aus**. Pro Kanal einstellbar.
- **Entschärfen ≠ Failsafe:** bewusstes Entschärfen schaltet den Motor wirklich ab,
  unabhängig vom Failsafe-Wert.
- **Armen:** der Gaskanal bleibt im Leerlauf, solange entschärft.
- **Armen gilt pro Verbindung.** Eine neue Bodenstation ist immer entschärft. Ob ein
  *bestehendes* Armen einen Reconnect überlebt, ist **fahrzeugtyp-abhängig**: Auto/Boot
  entschärfen, Flugzeug/Drohne nicht — ein kurzer Verbindungsabriss darf einem Fluggerät
  nicht die Motoren abschalten. Die Boden-App schiebt das; die Checkbox im Setup ist nur
  der Fallback. Unter **Setup › Controls** auf immer an/aus erzwingbar.
- **Pre-Arm-Check:** verweigert, solange das Gas nicht in Ruhelage steht.
- **Halten zum Armen** (Standard 1 s) für Armen *und* Entschärfen, am Button und an einer
  gebundenen Taste. Haltezeit (0,5–10 s) und Ausschalter unter **Setup › Controls**.
  **Panic-Disarm bleibt sofortig.**
- **Der Speed-Limiter ist Komfort, keine Sicherheit.** Er skaliert das Gaskommando
  bodenseitig; Failsafe, Disarm-Wert und Pre-Arm-Check bleiben unberührt.
- **Panic-Disarm wird ohne Belegung ausgeliefert.** Es ist die eine Funktion ohne Halten
  und ohne Rückfrage, ein versehentlicher Druck schaltet die Motoren ab — bei einem
  Fluggerät ist das ein Absturz. Auf etwas legen, das du nicht versehentlich triffst.
- **Treiber-Fallback:** ein Hardware-Treiber, der nicht startet, lässt den Dienst im
  Sim-Modus weiterlaufen, die Setup-UI bleibt erreichbar.
- **systemd `Restart=always`.**

### 6.1 Vertrauensmodell (wer das Fahrzeug steuern kann)

Der Dienst lauscht auf **allen Schnittstellen** (`0.0.0.0:8080`), und ab Werk kann
**jeder, der diesen Port erreicht, steuern und umkonfigurieren**. Das ist Absicht — ein
headless Fahrzeug darf dich nie aussperren — macht aber das Netz zur Sicherheitsgrenze.

- **Heim-WLAN / Werkbank:** so in Ordnung.
- **Eigener Hotspot des Pi:** WPA2 hält Fremde von der Luftschnittstelle fern.
- **LTE:** mit Tailscale/ZeroTier/WireGuard ist das Fahrzeug nur im privaten Netz
  erreichbar, und CGNAT bedeutet ohnehin keine öffentliche IP.
- **Fremdes oder öffentliches WLAN:** ein **API-Secret** unter *Setup › Security* setzen.
  Verändernde `/api/*`-Aufrufe brauchen dann den Header `x-yonderrc-secret` (oder
  `?secret=`), der Steuer-WebSocket `?secret=`; ein falsches schließt mit Code 4001. Es
  kann auch aus `YRC_API_SECRET` kommen. Im Klartext gespeichert — ein Schloss an der Tür,
  keine Verschlüsselung.
- **Eine Seite aus dem Internet kann dein Fahrzeug nicht fahren**, auch ohne Secret. Jede
  Seite, die der Betreiber öffnet, während sein Handy am Hotspot hängt, könnte sonst an die
  Setup-API posten oder einen Steuer-WebSocket öffnen, der CORS komplett ignoriert. Das
  Fahrzeug prüft deshalb die Herkunft der Seite: ohne `Origin` (curl, Skripte), `file://`
  (Desktop-App), eine private, Loopback-, `.local`- oder Tailscale-Adresse oder die eigene
  Adresse des Fahrzeugs werden akzeptiert; eine Seite aus dem öffentlichen Internet wird
  abgelehnt (HTTP 403, WS-Close **4003**), außer sie zeigt das Secret. Das entschärft auch
  DNS-Rebinding.
- **Nur eine Bodenstation hat die Kontrolle.** Eine zweite Verbindung schließt die ältere
  mit Code **4002** und sagt warum. Die neue gewinnt immer — genau das macht das
  Wiederverbinden nach einem Abriss möglich.
- Ein **Werksreset** löscht das Secret mit allem anderen.
- Enger geht es mit einer festen Adresse: `YRC_HOST=100.x.y.z` in der systemd-Unit. Kein UI
  dafür, und es sperrt den Hotspot-/LAN-Weg aus — also erst, wenn der Fernzugriff
  nachweislich läuft.

---

## 7. Schnelle Fehlersuche

| Symptom | Prüfen |
|---|---|
| Kein I2C-Gerät | `sudo i2cdetect -y 1` — erscheinen 0x40/0x41? Verkabelung/Adressen. |
| Sensor und Treiber beide auf 0x40 | Zwei Chips auf einer Adresse liefern Müll, keinen Fehler. *Detect hardware* sagt es; PCA9685 auf 0x41 (2.1). |
| Servos zittern | Gemeinsame Masse? BEC stark genug? PCA9685-V+ versorgt? |
| OSD zeigt „SIM" trotz Sensor | `i2c-bus` installiert? Adresse richtig? Sensor auf dem Bus sichtbar? |
| Kein Video | `systemctl status go2rtc`. Kamera erkannt? |
| LTE verbindet nicht | `mmcli -L`, APN richtig? Signal? Für HiLink siehe 4.1.1. |
| Keine Verbindung aus dem Feld | Beide Geräte im selben Tailnet? Tailscale-IP benutzt? |
| Link bricht sofort ab / Setup fragt nach Passwort | Ein **API-Secret** ist gesetzt — neben der Adresse eintragen (WS 4001, HTTP 401). |
| „Another ground station took over" | Eine zweite Bodenstation hat verbunden (Close-Code 4002). Neu verbinden holt sie zurück. |
| „The vehicle refused this page" | Die Boden-App kam von einer öffentlichen Adresse (4003 / HTTP 403). Vom Fahrzeug ausliefern oder Secret setzen. |
| Kein GPS-Fix | Richtige Quelle und Device in *Setup › GPS*? Seriell braucht `serialport`, USB-Dongles die **gpsd**-Quelle. Der erste Fix kann Minuten dauern. |
| Kein Signalwert im OSD | LTE muss verbunden sein, oder die WLAN-Schnittstelle muss `wlan0` heißen. |
| Keine Datenwarnung trotz Budget | Ohne **Plan allowance** gibt es keine Schwelle — das Panel sagt das (4.1.2). |
