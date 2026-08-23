[English](HARDWARE.md) · **Deutsch**

# YonderRC — Hardware-Guide (Teileliste, Verkabelung, Einrichtung)

Diese Anleitung bringt YonderRC von der reinen Simulation auf echte Hardware:
Raspberry Pi als Fahrzeugrechner, PCA9685 für Servos/ESC, INA228 für Strom/Spannung,
Kamera für FPV, zuerst über WLAN, danach über LTE mit Tailscale für unterwegs.

> **Sicherheit zuerst.** Beim ersten Test **Propeller ab / Räder hoch**, ESC
> stromlos oder Motor abgesteckt. Erst wenn jeder Kanal nachweislich das Richtige
> tut, kommt Antriebsenergie dazu. Gearmt wird immer als **letzter** Schritt.

---

## 1. Teileliste

### Pflicht

| Teil | Empfehlung | Warum |
|---|---|---|
| Rechner | **Raspberry Pi 4** (2 GB reicht) oder **Pi Zero 2 W** | Beide haben einen Hardware-H.264-Encoder für latenzarmes FPV. **Der Pi 5 hat keinen** — nicht ideal fürs Video. |
| Speicher | microSD 32 GB (A1/A2) | Für Raspberry Pi OS Lite. |
| Servo-/ESC-Treiber | **PCA9685** 16-Kanal PWM (I2C) | Erzeugt saubere 50-Hz-Servosignale unabhängig von der CPU. |
| Strom-/Spannungssensor | **INA228** Breakout (I2C) | Misst Pack-Spannung und Strom hochseitig. **Zählt Ladung und Energie selbst** (CHARGE-/ENERGY-Register), 85 V Busbereich (bis 12S) und 20 Bit Auflösung. Alternativen siehe „Welcher Stromsensor?". |
| Stromversorgung Pi | **UBEC/BEC 5 V / 3 A** | Versorgt den Pi stabil aus dem Fahrakku. |
| Kamera | **Pi Camera Module 3** (CSI) *oder* USB-Kamera mit H.264 | CSI = geringste Latenz. |
| Verkabelung | Jumper, JST, Lötzeug | I2C-Bus, Servostecker, Sensor. |

### Welcher Stromsensor? (Empfehlung INA228)

Alle werden unterstützt und gleich konfiguriert — einen aussuchen, hochseitig
verdrahten, den Shunt-Wert im Setup eintragen:

| Sensor | Busbereich | Auflösung | Ladungszähler | Wann |
|---|---|---|---|---|
| **INA228** | 85 V | 20 Bit | **ja — im Chip** | **Empfehlung.** Deckt bis 12S ab, und die mAh kommen aus dem Sensor statt aus einer Summe auf dem Pi. |
| INA238 | 85 V | 16 Bit | nein | Günstigere 85-V-Variante, gleiche Verdrahtung und Registerkarte. Der Pi integriert. |
| INA237 | 85 V | 16 Bit | nein | Wie INA238, nur niedrigere Genauigkeitsklasse. |
| INA226 | 36 V | 16 Bit | nein | Reicht bis 8S; das verbreitetste Breakout. |
| INA219 | 26 V | 12 Bit | nein | Kleine Ströme / kleine Packs. |
| INA260 | 36 V | 16 Bit | nein | Shunt (2 mΩ) integriert — nichts auszuwählen, dafür nur ~15 A. |
| INA3221 | 26 V | 13 Bit | nein | Drei Kanäle gleichzeitig, dafür grob. |

**Warum sich der INA228 lohnt.** Über Bereich und Auflösung hinaus integriert er
**Ladung (Coulomb) und Energie (Joule) in Hardware**, durchgehend mit der ADC-Rate.
YonderRC liest dann nur noch zwei Register: die verbrauchten mAh hängen nicht mehr
daran, wie oft das Fahrzeug abtastet, und eine ausgefallene Messung (CPU beschäftigt,
Video-Hänger) fehlt nicht mehr still in der Bilanz. Bei allen anderen Sensoren
integriert das Fahrzeug den abgetasteten Strom selbst — präzise, aber eben nur so gut
wie die Abtastung.

Einzutragen sind weiterhin **Max current A** (bestimmt den chipinternen LSB und damit
die Kalibrierung) und der **Shunt-Wert**. Faustregel: Shunt so wählen, dass
`max. Strom × Shunt ≤ 163 mV`, z. B. 1 mΩ für 100 A. Bleibt `max. Strom × Shunt` sogar
unter **40,96 mV**, den Shunt-Bereich auf ±40,96 mV stellen — 4× feinere Auflösung.

### Für LTE (Phase 2)

| Teil | Empfehlung |
|---|---|
| LTE-Stick | USB-LTE-Dongle, von ModemManager unterstützt (z. B. Huawei E3372 im „stick"/NCM-Modus, oder Quectel EG25-G) |
| SIM | Daten-SIM mit bekannter APN |

### Je nach Fahrzeug

- **Auto/Boot:** Fahrtregler (ESC) + Lenk-/Ruderservo.
- **Flugzeug:** ESC + Servos (Quer/Höhe/Seite/Gas).
- **Drohne:** in der Regel ein **Flight Controller**, angesteuert per **SBUS** (statt PCA9685). YonderRC unterstützt beides.

---

## 2. Verkabelung

### 2.1 PCA9685 ↔ Raspberry Pi (I2C)

| PCA9685 | Raspberry Pi (BCM) | Pin |
|---|---|---|
| VCC (Logik) | 3V3 | Pin 1 |
| GND | GND | Pin 6 |
| SDA | GPIO2 / SDA1 | Pin 3 |
| SCL | GPIO3 / SCL1 | Pin 5 |
| V+ (Servopower) | **nicht** vom Pi! | eigener BEC 5–6 V |

- **V+** ist die Servo-/ESC-Versorgung und kommt vom BEC, **nicht** vom Pi.
- Standard-I2C-Adresse **0x40**. Mehrere Boards: Adress-Lötbrücken A0–A5.
- Servos/ESC stecken auf den Kanal-Ausgängen 0–15 (Signal/+/−). YonderRCs
  Kanäle 1–16 in der App entsprechen den PCA9685-Kanälen 0–15.

### 2.2 INA228 (Strom/Spannung) ↔ I2C

*(Verkabelung identisch für INA226/237/238 — nur der Eintrag im Setup ändert sich.)*

- SDA/SCL an **denselben** I2C-Bus wie der PCA9685 (parallel), Adresse abweichend
  (INA2xx Standard **0x40** — kollidiert mit PCA9685! **Adresse über die A0/A1-Pins bzw.
  Lötbrücken auf z. B. 0x41 setzen**, oder PCA9685 auf 0x41 legen; Hauptsache
  verschieden).
- Der Sensor sitzt **hochseitig** in der Plus-Leitung des Akkus: Akku(+) → `VIN+`,
  Last (ESC/BEC) → `VIN−`. Der **Shunt** bestimmt den Messbereich (z. B. 0,002 Ω für
  hohe Ströme, 0,001 Ω für sehr hohe). Den Shunt-Wert trägst du später im Setup ein.
- **VBUS** misst gegen die Masse des Sensors — ein INA228 liefert Pack-Spannung
  **und** Strom, ohne zusätzlichen Spannungsteiler.
- **GND** des Sensors mit dem gemeinsamen Massepunkt verbinden.

```
Akku(+) ──► [INA228 VIN+  VIN−] ──► ESC/BEC (+)
Akku(−) ─────────────── gemeinsame Masse ───────────────
                 │
              Pi GND, PCA9685 GND, BEC GND  (ALLE zusammen!)
```

> **Gemeinsame Masse ist Pflicht.** Pi, PCA9685, Sensor, BEC und ESC müssen sich
> eine Masse teilen, sonst sind Servosignale und Messwerte unzuverlässig.

### 2.3 Stromversorgung

```
Fahrakku ──► BEC 5V/3A ──► Pi (5V/GND, z. B. GPIO Pin 2/6 oder USB-C)
        └──► ESC ──► Motor
```

- Den Pi **nicht** aus einem PCA9685-Kanal speisen.
- Reihenfolge beim Einschalten: erst Elektronik/Pi, Antrieb zuletzt.

### 2.4 Kamera

- **CSI:** Flachbandkabel an den Kameraport (bei Pi Zero: schmaleres Kabel).
- **USB:** einfach einstecken; am besten eine Kamera, die selbst H.264 liefert.

### 2.5 Drohne per SBUS (optional, statt PCA9685)

- Pi **UART TX** (GPIO14 / Pin 8) → **SBUS-in** des Flight Controllers.
- SBUS ist **invertiert** und läuft mit 100000 8E2. Viele FCs erwarten das invertierte
  Signal; wenn dein FC kein internes Invert hat, brauchst du einen kleinen
  Inverter (Transistor) zwischen Pi-TX und FC.

### 2.6 GPS (optional)

Gängige Empfänger, die am Pi problemlos laufen: **Adafruit Ultimate GPS** (MTK3339),
**u-blox NEO-6M/7M/8M/M9N**, **Beitian BN-220/BN-880** — die meisten sprechen **NMEA mit
9600 Baud** über UART. Verkabelung:

| GPS | Raspberry Pi | Pin |
|---|---|---|
| VCC | 3V3 (oder 5V je Modul) | Pin 1 / 2 |
| GND | GND | Pin 6 |
| TX  | GPIO15 / RXD | Pin 10 |
| RX  | GPIO14 / TXD | Pin 8 |

- Den Hardware-UART des Pi nutzen (`/dev/ttyAMA0` bzw. `/dev/serial0`; Serial-Console
  deaktivieren). Unter Setup › GPS **local NMEA (serial)** wählen, Device `/dev/ttyAMA0`, 9600.
  Die serielle Quelle braucht das optionale Paket `serialport` (siehe 3.3) — fehlt es,
  meldet der Dienst das und bleibt auf der bisherigen Quelle.
- **USB-GPS-Dongles** (u-blox VK-172, GlobalSat BU-353): einstecken und stattdessen die
  **gpsd**-Quelle wählen — `gpsd` installiert das Setup-Skript, es übernimmt das Gerät.
- Die **Mindest-Satelliten** für einen guten Fix setzen (6 ist ein guter Default) und
  **Auto-Home** aktivieren, um den Startpunkt automatisch zu erfassen.

---

### 2.7 Temperatursensoren (optional)

Beliebig viele Temperaturkanäle lassen sich in Setup › Telemetry anlegen; sie erscheinen
im OSD unterhalb von Spannung und Strom. Auswahl nach Anschlussart:

| Sensor | Bus | Bereich / Hinweise | Zusätzlich nötig |
|---|---|---|---|
| **Raspberry Pi SoC** | — | Die Chiptemperatur des Pi selbst; gut als Throttling-Warnung | nichts |
| **DS18B20** | 1-Wire | −55…+125 °C, ±0,5 °C, günstig, auch als wasserdichte Sonde | `dtoverlay=w1-gpio` + 4,7-kΩ-Pull-up von Data nach 3V3 |
| **MCP9808 / TMP102 / TMP117** | I²C | −40…+125 °C; der TMP117 ist der genaue (±0,1 °C) | Adresse (0x18 / 0x48…) |
| **BMP280 / BME280** | I²C | Umgebungsluft (BME zusätzlich Feuchte); nicht für heiße Punkte | Adresse 0x76/0x77 |
| **MAX6675 / MAX31855** | SPI | Thermoelement Typ K, bis ca. 1000 °C — für Motor, ESC, Auspuff | `dtparam=spi=on` |
| **MAX31856** | SPI | Thermoelement mit wählbarem Typ (B/E/J/K/N/R/S/T) | `dtparam=spi=on` |
| **MAX31865** | SPI | PT100/PT1000, genau bis ca. 600 °C | `dtparam=spi=on`, Referenzwiderstand 430 Ω (PT100) / 4300 Ω (PT1000) |
| **ADS1115 / MCP3008 + NTC oder PT100** | I²C / SPI | Was ohnehin verbaut ist; günstigste Variante | Vorwiderstand, Speisespannung, NTC R25/Beta |

- **1-Wire- und I²C-Sensoren teilen sich den Bus** mit PCA9685/INA — nur die Adressen
  müssen sich unterscheiden. SPI-Verstärker brauchen je ein eigenes Chip-Select (CE0/CE1).
- **NTC/PT100 am ADC** ist ein Spannungsteiler: Speisung → Festwiderstand → *Sonde* → GND,
  der ADC-Eingang liegt zwischen Widerstand und Sonde. Den Festwiderstand als *Series
  resistor* eintragen und beim NTC zusätzlich `R25/Beta` (z. B. `10000/3950`, steht auf
  dem Bauteil).
- **Thermoelemente messen heiß, nicht genau** (typisch ±2 °C). Für Motor oder ESC ist
  genau das richtig; für die Akkutemperatur ist ein DS18B20 an der Zelle besser.
- Ein Sensor, der sich nicht lesen lässt (offenes Thermoelement, CRC-Fehler, fehlendes
  1-Wire-Gerät), wird **im OSD weggelassen** statt als 0 °C angezeigt — und einmalig im
  Fahrzeug-Log vermerkt.

---

### 2.8 GPIO-PWM (statt PCA9685)

Mit `YRC_DRIVER=gpio-pwm` erzeugt der Pi die Servo-Impulse selbst, über `pigpio`
(DMA-getaktet, also deutlich jitterärmer als Software-PWM). Kein Zusatzboard — dafür
liegen jetzt die CPU und ein GPIO pro Kanal im Signalweg. **Ab ein paar Kanälen bleibt
der PCA9685 die bessere Antwort**: eigener Timer, unabhängig von der CPU-Last, und die
GPIOs bleiben frei.

Standardbelegung (BCM-Nummern), Kanal 1 → 16 in dieser Reihenfolge:

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

- **Änderbar über `YRC_GPIO_PINS`** (komma-getrennte BCM-Nummern in Kanalreihenfolge),
  z. B. `YRC_GPIO_PINS=17,18,27,22` in der systemd-Unit. Die **Länge begrenzt die
  Kanalzahl** — vier Pins heißt vier Kanäle. Ein Feld im Setup-UI gibt es dafür nicht.
- Der Dienst loggt beim Start die tatsächlich genutzte Belegung:
  `[gpio-pwm] ready on BCM pins […]`.
- **Kanal 3 (BCM 27) ist der Standard-Throttle**, denn `YRC_THROTTLE_CH` ist `2` und
  dieser Index ist 0-basiert.
- Alle Pins starten auf **1500 µs**, damit beim Booten nichts zuckt; beim Herunterfahren
  werden die Impulse abgeschaltet.
- `pigpio` **braucht root** — die mitgelieferte systemd-Unit läuft bereits als root.

#### Passt zum Referenzaufbau

Die Standardbelegung meidet bewusst jeden Bus, den dieser Guide benutzt — **GPIO-PWM,
INA228, GPS und ein Temperatursensor laufen also gleichzeitig**:

| Bleibt frei | Pins | Wird genutzt von |
|---|---|---|
| I²C1 | BCM 2/3 (Header 3/5) | INA228/226, MCP9808/TMP102/TMP117, BMP280/BME280, ADS1115 |
| UART0 | BCM 14/15 (Header 8/10) | serielles GPS — und SBUS zum Flight Controller |
| SPI0 | BCM 7–11 (Header 19/21/23/24/26) | MAX6675/31855/31856/31865, MCP3008 |
| 1-Wire | BCM 4 (Header 7) | DS18B20 (Standard von `dtoverlay=w1-gpio`) |

Zwei Dinge trotzdem im Blick behalten:

- **BCM 18/19/20/21 sind zugleich I²S** (PCM). Nur mit Audio-HAT ein Problem — dann diese
  Kanäle aus `YRC_GPIO_PINS` streichen.
- **Den 1-Wire-Pin verschieben, nicht doppelt belegen.** Wer `dtoverlay=w1-gpio,gpiopin=17`
  setzt, gibt GPIO 17 an den Kernel ab — Kanal 1 ist dann still. Den DS18B20 auf seinem
  Standard-GPIO 4 lassen.

> **Die Versorgung bleibt wie in 2.3:** Servo-/ESC-Strom kommt vom BEC, nie aus den
> 5-V-Pins des Pi. Der Pi liefert nur das **Signal** — und eine **gemeinsame Masse** ist
> Pflicht, sonst wird der Impuls gegen nichts gemessen.

---

## 3. Software — Schritt für Schritt (zuerst WLAN)

### 3.1 Raspberry Pi OS flashen

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit)**. Das Install-Skript ist
   für **Bookworm** geschrieben und dort getestet; neuere Releases sollten laufen (es
   nutzt nur apt, systemd und NetworkManager), geprüft ist das aber nicht.
2. In den Imager-Einstellungen (Zahnrad): **SSH aktivieren**, Benutzer setzen,
   **WLAN-Zugangsdaten** eintragen, Hostname z. B. `yonderrc`.
3. SD-Karte flashen, in den Pi, einschalten.

### 3.2 Einloggen und Projekt auf den Pi kopieren

Zuerst per SSH einloggen:

```bash
ssh pi@yonderrc.local          # oder die IP aus deinem Router
```

Dann das Projekt nach `/opt/yonderrc` bringen. **Drei Wege — nimm einen:**

**a) git clone (am einfachsten, wenn der Pi Internet hat)**
```bash
sudo mkdir -p /opt/yonderrc
sudo chown $USER /opt/yonderrc
git clone https://github.com/TechnikWeber/YonderRC.git /opt/yonderrc
```

**b) scp vom Laptop (kopiert dein lokales Repo auf den Pi)**
Auf deinem **Laptop** (nicht auf dem Pi) ausführen:
```bash
# im Ordner, der YonderRC enthält:
scp -r ~/YonderRC pi@yonderrc.local:/tmp/YonderRC
# dann auf dem Pi:
ssh pi@yonderrc.local 'sudo mkdir -p /opt/yonderrc && sudo cp -a /tmp/YonderRC/. /opt/yonderrc/'
```
Tipp: Vorher auf dem Laptop `node_modules` nicht mitkopieren (spart Zeit) — das
Install-Skript installiert auf dem Pi ohnehin frisch.

**c) USB-Stick (wenn der Pi kein Netz hat)**
YonderRC auf einen USB-Stick kopieren, in den Pi stecken, dann auf dem Pi:
```bash
sudo mkdir -p /opt/yonderrc
sudo cp -a /media/*/YonderRC/. /opt/yonderrc/   # Pfad ggf. anpassen (lsblk zeigt das Laufwerk)
```

Danach installieren:

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

`install.sh` installiert Node 22, ffmpeg, NetworkManager, ModemManager,
`usb-modeswitch`, `i2c-tools`, `gpsd`, `wireguard-tools`, Tailscale, ZeroTier und
go2rtc, richtet die drei systemd-Dienste ein (`yonderrc-vehicle`, `go2rtc`,
`yonderrc-onboard`) und aktiviert **I2C** und **UART**.

> Fedora-Notiz von deinem Laptop gilt hier nicht — auf dem Pi bringt das Skript das
> passende ffmpeg mit H.264 mit.

### 3.3 Hardware-Treiber-Abhängigkeiten (nur was du nutzt)

Die nativen Bibliotheken sind **optionale Abhängigkeiten**: sie werden auf dem Pi
kompiliert, und ein Fahrzeug braucht höchstens eine davon. Deshalb führt der Installer
bewusst `npm install --omit=optional` aus — so installiert auch ein Pi ohne diese
Hardware sauber durch. (Danach installiert er das *ground*-Workspace noch einmal mit
optionalen Abhängigkeiten: der Schalter gilt global, und rollup/esbuild liefern ihre
Plattform-Binaries als optionale Abhängigkeiten, die `vite build` braucht.)

**Installiere die passende direkt im Browser** — Setup › Vehicle configuration ›
**Native driver modules**:

| Modul | wofür |
| --- | --- |
| `i2c-bus` | PCA9685 Servo/ESC-Treiber · INA2xx Stromsensoren · ADS1115 ADC |
| `pigpio` | GPIO-PWM statt PCA9685 (Pinbelegung: 2.8) |
| `serialport` | SBUS-Ausgang (Flugcontroller) · serielles GPS |

Jede Zeile zeigt den Status und hat einen **Install**-Knopf; danach bietet die Seite den
Neustart des Dienstes an, der das Modul übernimmt. Kein SSH — genau darum geht es bei
einem Fahrzeug, das du nur über seinen eigenen Hotspot erreichst. Drei Dinge dazu:

- Der Pi braucht dafür **Internet** (WLAN oder LTE). Sein eigener Hotspot hat keinen
  Uplink — vorher also in Setup › WiFi ins Netz gehen.
- Es **dauert eine Minute**, weil das Modul auf dem Pi kompiliert wird.
- Scheitert der Build, nennt die Seite die Ursache und den Befehl, der hilft. Meist
  `sudo apt install -y build-essential` (kein Compiler); `pigpio` braucht zusätzlich seine
  C-Bibliothek: `sudo apt install -y pigpio`.

Was du installiert hast, wird **gemerkt** (`hardwareDeps` in `yonderrc-config.json`) und
von `install.sh` nach jedem Update wiederhergestellt — ein Update kann ein eingerichtetes
Fahrzeug damit nicht mehr klammheimlich zum Simulator zurückbauen.

Dasselbe über SSH, falls dir das lieber ist:

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA2xx
npm install pigpio     -w @yonderrc/vehicle    # (nur bei GPIO-PWM statt PCA9685 — Pinbelegung: 2.8)
npm install serialport -w @yonderrc/vehicle    # (nur bei SBUS/Drohne und seriellem GPS)
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Das Fahrzeug aktualisieren

**Über die Setup-Seite** — Abschnitt *Software update*, genau das, was man im Feld
braucht:

1. **Check for updates** holt den Stand und berichtet: installierte Version, verfügbare
   Version, wie viele Commits zurück, und die Betreffzeile jedes einzelnen. Es ändert
   nichts.
2. **Update & restart** erscheint nur, wenn es etwas zu installieren gibt. Es tut, was
   eine SSH-Sitzung täte — `git pull --ff-only`, geänderte Abhängigkeiten installieren,
   die Steuer-App neu bauen, falls sie sich geändert hat — und startet den Fahrzeugdienst
   **zuletzt** neu, damit er nie in einem halb aktualisierten Stand hochkommt. Die Seite
   lädt sich danach selbst neu.

Es verweigert (und sagt warum), wenn das Fahrzeug **lokale Änderungen** hat — ein
Fast-Forward würde entweder scheitern oder sie wegwerfen — und wenn **kein Internet**
da ist. Scheitert ein Schritt, bleibt es dort stehen, und das Fahrzeug läuft mit der
bisherigen Version weiter.

**Update-Quelle.** Standardmäßig holt das Fahrzeug von seinem eigenen `origin` / `main`.
Die beiden Felder unter *Update source* nehmen einen git-Remote-Namen oder eine
vollständige URL plus Branch — damit lässt sich ein Fahrzeug ohne Code-Änderung auf einen
eigenen Fork oder einen Testbranch zeigen: `https://github.com/du/YonderRC.git` /
`experiment` funktioniert genau wie der Standard.

> **Wo die generierte Video-Konfiguration liegt:** Das Fahrzeug schreibt die
> go2rtc-Konfiguration aus deinen Kameraeinstellungen nach
> **`/var/lib/yonderrc/go2rtc.yaml`**, und `go2rtc.service` liest sie von dort
> (`YRC_GO2RTC_CONFIG` überschreibt den Pfad). Früher landete sie in
> `docker/go2rtc.yaml` **im Checkout** — womit jedes laufende Fahrzeug lokale Änderungen
> hatte, und genau darüber stolpert ein Fast-Forward-Update. `install.sh` verschiebt eine
> vorhandene Datei einmalig und stellt den Checkout wieder her.

> **Was es nicht tut:** apt-Pakete, systemd-Units und `install.sh` selbst. Meldet der
> Check, dass sich der Installer geändert hat, lass einmal
> `sudo bash provisioning/install.sh` laufen, sobald du wieder an einer Tastatur bist.

Dasselbe über SSH:

```bash
cd /opt/yonderrc
sudo git pull --ff-only
sudo systemctl restart yonderrc-vehicle
# …und wenn sich Boden-App oder Abhängigkeiten geändert haben, stattdessen der volle Lauf:
sudo bash provisioning/install.sh
```

### 3.5 Über WLAN einrichten (grafisch)

Öffne vom Laptop/Handy im selben WLAN: **`http://yonderrc.local:8080/setup`**
(oder `http://<pi-ip>:8080/setup`).

0. **Detect hardware** (unter *Vehicle configuration*) scannt den I²C-Bus, `mmcli` und
   die Kamera-Geräte und schlägt Treiber/Sensoren vor — ein guter Startpunkt, bevor du
   etwas von Hand einträgst.
1. **Vehicle:** Name setzen, **Output driver = `pca9685`** (Drohne: `sbus`; ohne
   Zusatzboard: `gpio-pwm`, Pinbelegung in 2.8),
   Throttle-Kanal prüfen. Die Checkbox *Auto-disarm on reconnect* ist hier nur ein
   **Fallback** — sobald sich eine Bodenstation verbindet, pusht sie den zum Modelltyp
   passenden Wert (Auto/Boot an, Flugzeug/Drohne aus).
2. **CSI camera module:** auswählen, welcher Sensor am Kameraport sitzt. Automatisch
   erkannt werden nur die offiziellen Raspberry-Pi-Kameras; eine Arducam braucht ein
   explizites Device-Tree-Overlay in der Firmware-Konfiguration, und die wird **nur beim
   Booten** gelesen. Die Auswahl eines Moduls schreibt `camera_auto_detect` und
   `dtoverlay=` für dich in `/boot/firmware/config.txt` — ein Backup bleibt als
   `config.txt.yonderrc-bak` liegen, konkurrierende Zeilen werden auskommentiert statt
   gelöscht — danach zeigt das Panel *Reboot required*, bis der Pi damit gebootet hat.
   Daneben liegt ein **Reboot now**-Knopf. Ein Pi 4 hat einen CSI-Anschluss, das ist also
   eine Auswahl pro Fahrzeug; USB-Kameras sind davon unberührt und können zusätzlich
   dazukommen. Ein Sensor, der nicht in der Liste steht, geht über *Other module* — der
   Overlay-Name wird nur akzeptiert, wenn die `.dtbo` auf dem Pi wirklich existiert.
3. **Cameras:** Kamera hinzufügen (Typ `rpicam` oder `usb`, Auflösung/FPS/Bitrate)
   → **Save & apply**. go2rtc wird neu geladen.

   > **Keine Kamera ist eine gültige Konfiguration.** Löscht man alle Einträge, bleibt
   > die FPV-Fläche einfach dunkel: nichts wird wiederholt, nichts meldet einen Fehler,
   > und OSD, Telemetrie und Steuerung laufen weiter. Genau so konfiguriert man YonderRC,
   > wenn man es rein als IP/WLAN/AP-Empfänger will und auf Sicht fährt.

   > **Ein `rpicam`-Stream bleibt schwarz / verbindet sich immer neu?** Maßgeblich ist
   > `rpicam-hello --list-cameras` auf dem Pi — sagt das *No cameras available!*, hilft
   > keine Einstellung im UI. Raspberry Pi OS Bookworm hat die Kamera-Tools von
   > `libcamera-*` nach `rpicam-*` umbenannt und die alten Symlinks entfernt; YonderRC
   > erkennt den Namen seit v1.47.0 selbst. Die offiziellen OV5647 / IMX219 / IMX477 /
   > IMX708 findet `camera_auto_detect=1` allein. Sensoren außerhalb dieser Menge —
   > **Arducam IMX519 / 64MP / Pivariety, OV64A40** — brauchen zusätzlich
   > `camera_auto_detect=0` plus ein explizites `dtoverlay=<sensor>` und einen Reboot —
   > genau das erledigt das Panel **CSI camera module** weiter oben. Schweigt selbst die I²C-Adresse des
   > Sensors (`sudo i2cdetect -y 10`, mit `dtparam=i2c_vc=on`), ist es das Flachbandkabel:
   > Kontakte zur HDMI-Seite, Port **CAM**, nicht DISPLAY.

   > **Arducam 16 MP IMX519 — scharfes Bild.** Unter **CSI camera module** *Arducam 16MP
   > IMX519* wählen und neu starten; der AK7375-Fokusmotor taucht danach von allein als
   > v4l-subdev auf. Der Fokus funktioniert trotzdem noch nicht, weil
   > Raspberry Pis `imx519.json` keinen `rpi.af`-Algorithmus enthält — libcamera
   > beantwortet jede Fokus-Anforderung mit *Could not set AF_MODE - no AF algorithm*,
   > die Linse bleibt in Ruhelage, und das sieht exakt aus wie ein unscharfes Objektiv.
   > Die Modulauswahl trägt **Tuning file**
   > (`/var/lib/yonderrc/tuning/imx519-af.json`, bringt `install.sh` mit) für dich ein;
   > danach in Setup › Cameras einen **Focus**-Modus wählen. Am fahrenden
   > Modell ist `manual` auf 0 Dioptrien (unendlich) meist besser als `continuous`, das
   > bei jedem Szenenwechsel neu sucht.
4. **Telemetry:** Source **`real`**, Strom-Sensor **`ina228`** (oder `ina226`/`ina237`/
   `ina238`), `Shunt Ω` eintragen (z. B. 0.002) und beim INA228/237/238 zusätzlich
   **Max current A** plus Shunt-Bereich. Einen Spannungskanal derselben Art anlegen
   („Spannung 1") — der INA liefert beides. Batteriekapazität (mAh) angeben, Anzeige
   verbraucht/Rest wählen, festlegen, was die **Akku-%** speist (Coulomb-Counting,
   Spannungskurve oder *clamp* = der niedrigere von beiden), und **Charge counter** auf
   `auto` lassen: mit einem INA228 zählt dann der Chip selbst, alles andere integriert
   der Pi → **Save**. Danach Fahrzeug neu starten
   (`sudo systemctl restart yonderrc-vehicle`). Bei mehr als einem Spannungs- oder
   Stromkanal den Kanal am Pack als **primary** markieren — er speist %, mAh und
   Warnungen. **Temperaturkanäle** sind optional (siehe 2.7); jeder Wert lässt sich pro
   Bodengerät unter FPV › ⚙ › *Sensor values* ausblenden.
5. **Security (optional):** Ein **API-Secret** setzen, wenn das Fahrzeug in einem Netz
   hängt, dem du nicht voll vertraust — siehe 6.1. Für die ersten Tests auf der
   Werkbank leer lassen; standardmäßig ist es aus.

### 3.6 Erster Funktionstest (RÄDER HOCH / PROPS AB!)

1. Boden-App am Laptop öffnen, oben die **Pi-Adresse** eintragen:
   `ws://yonderrc.local:8080`, **Connect**.
2. Noch **nicht armen**. Im Kanal-Monitor prüfen: Lenkung/Ruder bewegt den
   richtigen Kanal? Endpunkte ok? Bei Bedarf im Setup Trim/EPA/Reverse anpassen.
3. **ESC-Kalibrierung** (falls nötig) im Setup starten — Anweisungen folgen. Sie lehrt
   dem ESC die **Endpunkte des Gaskanals selbst** (stehen über dem Start-Knopf, z. B.
   „CH03: max 1800 µs → min 1200 µs"). Wer einen reduzierten Bereich will, stellt also
   zuerst den Weg dieses Kanals ein. Das profilweite *Endpoints*-Feld ist ein
   **Sammel-Schreibvorgang** in alle Kanäle, keine Begrenzung — jeder Kanal lässt sich
   danach einzeln anpassen.
4. Erst wenn alles stimmt: Antrieb scharf, den **Arm-Button halten**, bis der Countdown
   durch ist (standardmäßig 1 s), vorsichtig Gas geben.
5. **Video** sollte im FPV-Panel laufen (der `go2rtc`-Dienst läuft dauerhaft).
6. **Telemetrie** im OSD prüfen: zeigt es echte Pack-Spannung? Steht dort **nicht**
   „SIM"? Dann liest der Sensor korrekt. Falls „SIM" erscheint, greift der Fallback
   (Sensor nicht gefunden) — Verkabelung/Adresse/`i2c-bus` prüfen (`sudo i2cdetect -y 1`).

---

## 4. Von WLAN auf LTE umstellen (Phase 2)

Sobald alles im WLAN läuft, kommt die Reichweite über Mobilfunk. Das Problem: LTE
liegt hinter **CGNAT**, das Fahrzeug hat keine öffentliche IP. Lösung: **Tailscale**
legt Pi und Boden-Gerät ins selbe private Netz — überall erreichbar.

### 4.1 LTE-Stick

1. USB-LTE-Dongle einstecken. Prüfen, ob ModemManager ihn sieht:
   ```bash
   mmcli -L
   ```
2. Im Setup unter **LTE** die **APN** deines Anbieters eintragen → **Connect**.
   Die APN wird gespeichert und verbindet künftig automatisch beim Booten (mit
   `autoconnect`, NetworkManager wählt also selbst neu). Hat deine SIM eine **PIN**
   oder braucht dein Anbieter **APN-Benutzer/Passwort**, trage das ebenfalls ein —
   PIN/Passwort werden am Fahrzeug gespeichert und nie wieder angezeigt. Das
   Status-Panel zeigt Modem-Modell, Registrierungsstatus und markiert „SIM PIN
   required", wenn nötig. Dongles im „Zero-CD"/Speichermodus übernimmt
   `usb-modeswitch` (vom Setup-Skript installiert). Du kannst zudem den **Netzmodus**
   erzwingen (nur 4G für niedrigere Latenz), **Daten-Roaming** umschalten, die
   **SIM-PIN ändern oder entfernen** und eine **Diagnose** (rohe `mmcli`-Ausgabe)
   laufen lassen, um genau zu sehen, was der Pi erkennt.
3. Sobald verbunden, taucht das **Uplink-Signal im OSD der Bodenstation** auf
   (LTE-Signal in % vom ModemManager, sonst der WLAN-RSSI aus `iw dev wlan0 link`);
   unter 25 % markiert das OSD den Link als schwach. Heißt dein WLAN-Interface nicht
   `wlan0`, bleibt der WLAN-Wert leer — LTE ist davon nicht betroffen.

### 4.1.1 HiLink-Sticks (Huawei E3372h-320 und Verwandte)

Viele Huawei-Sticks sind **keine Modems** im Sinne von ModemManager: Sie betreiben einen
eigenen kleinen Router, melden sich als USB-Ethernet-Interface mit DHCP und wählen sich
selbst ein. `mmcli -L` bleibt bei ihnen für immer leer, §4.1 gilt für sie also schlicht
nicht — nichts ist kaputt, und dass das LTE-Panel leer bleibt, ist erwartet.

YonderRC liest sie stattdessen über ihre eigene API. **Setup › LTE stick (HiLink)** zeigt
Modell, Interface, Zustand, Betreiber, Netztyp und Signal, und im **OSD erscheint die
LTE-Prozentzahl** genau wie bei einem ModemManager-Modem.

- Der Stick wird **über die Routing-Tabelle** gefunden (`ip route get 192.168.8.1`), nie
  über den Interface-Namen. Ein Fahrzeug mit FritzBox an `eth0` und Stick an `eth1` — oder
  nach einem Reboot bzw. anderem USB-Port umgekehrt — kann die beiden damit nie
  verwechseln.
- **APN, SIM-PIN und Netzmodus liegen im Stick**, nicht in YonderRC. Das Fahrzeug
  **reicht die Konfigurationsseite des Sticks deshalb standardmäßig auf Port 8081
  durch**: `http://<Fahrzeug>:8081/` (oder der Knopf **Open the stick's UI ↗** im Panel)
  vom Hotspot, aus dem LAN oder über das VPN — keine Tastatur am Pi, kein Umstecken an
  den Laptop. Mit gesetztem API-Secret einmalig als `…:8081/?secret=DEIN_SECRET` öffnen,
  das Fahrzeug merkt es sich dann in einem Cookie. Leerst du das Portfeld, ist der Proxy
  ganz aus.
  > Was das bedeutet: An einem **offenen** Onboarding-Hotspot erreicht jeder, der sich
  > verbindet, auch die Admin-Seite des Sticks. Setz ein Hotspot-Passwort oder ein
  > API-Secret, bevor das Fahrzeug die Werkbank verlässt — dieselbe Regel gilt ohnehin
  > schon für die Setup-Oberfläche.
- Rufst du einen API-Pfad direkt im Browser auf (z. B. `…:8081/api/monitoring/status`),
  kommt `125002`: der Stick will eine Session, die seine eigene Oberfläche aufbaut. Das
  ist erwartet — der Leser von YonderRC holt sich vorher ein Session-Token.
- Ein **reiner 2G/3G-Stick** (E3131/E353, USB-ID `12d1:14db`) wird im Panel markiert:
  Mehrere Länder — Deutschland eingeschlossen — haben 3G vor Jahren abgeschaltet, ein
  solcher Stick bekommt dort gar keine Datenverbindung mehr.

### 4.2 Tailscale

1. **Setup › Remote access** → Method **Tailscale** → **Bring up**, Auth-Key-Feld leer
   lassen. Das Fahrzeug startet einen Login und zeigt den Link nach wenigen Sekunden (es
   wartet bis zu 14 s darauf); Link öffnen, Gerät bestätigen — es tritt als `yonderrc`
   bei. Der Link bleibt außerdem im Status stehen, solange der Login aussteht, ein
   Neuladen der Seite verliert ihn also nicht.
2. Lieber ohne Klicken? In der Admin-Konsole (*Settings › Keys*) einen **Auth-Key**
   erzeugen, ins Feld einfügen und **Bring up** drücken — dieser Weg läuft ohne
   Interaktion.
3. Die **Tailscale-IP** des Fahrzeugs steht danach oben im Setup-Status
   (z. B. `100.x.y.z`).
4. **Key-Ablauf abschalten** (Admin-Konsole → *Machines › yonderrc › Disable key
   expiry*), sonst fliegt das Fahrzeug nach ca. 180 Tagen aus dem Tailnet — zuverlässig
   genau dann, wenn du ohne Tastatur im Feld stehst.

> Kommt gar kein Link, hat das Fahrzeug kein Internet oder Tailscale hängt. Über SSH gibt
> `sudo tailscale up --hostname=yonderrc` den Link direkt aus.

### 4.3 Von unterwegs verbinden

- Dein Boden-Gerät (Laptop/Handy) ebenfalls in dasselbe Tailnet bringen
  (Tailscale-App installieren, einloggen).
- In der Boden-App als Adresse die **Tailscale-IP** verwenden:
  `ws://100.x.y.z:8080`. Das Video läuft analog über `http://100.x.y.z:1984`.

> **Latenz/Reichweite:** Für den absolut niedrigsten WebRTC-Weg über LTE kannst du
> später einen eigenen **TURN-Server (coturn)** auf einem günstigen VPS ergänzen.
> Tailscale allein gibt dir aber bereits eine funktionierende, verschlüsselte
> Verbindung und ist der einfachste Weg, der zuverlässig klappt.

#### Was dabei tatsächlich gemessen wurde (erster Feldtest)

Ein Nachmittag, ein Netz, ein Ort — ein Datenpunkt, kein Benchmark. Fahrzeug: Pi 4 mit
**Huawei E3372h-320** an dessen **interner** Antenne, Netzwerkkabel gezogen. Boden: ein
Fedora-Laptop, beide im selben Tailnet.

| Messwert | Wert | Anmerkung |
|---|---|---|
| Tailscale-Pfad | **direkt, IPv6** | `pong … via [2a01:599:…]:41641 in 69ms` — kein DERP-Relay |
| Steuer-Roundtrip | **110 ms** | ergibt 87/100 in der Link-Health des OSD |
| Video-Latenz | **128 ms** | kaum über dem Steuerpfad, die WebRTC-Strecke ist also gesund |
| Video-Bitrate | 444 kbps | die Auto-Qualität hatte wegen des schwachen Signals heruntergeregelt |
| LTE-Signal | **52 %** (ca. −106 dBm RSRP) | der begrenzende Faktor — OSD zeigte `⇅ 52` und `⚠ SIGNAL` |

Zwei Dinge sind daran wichtig. Erstens **nennt der Wert seinen eigenen Engpass**: die 52
kamen vom Signal, nicht von der Latenz — die Abhilfe ist also eine Antenne und keine
schnellere Leitung. Der E3372h-320 hat zwei TS-9-Buchsen, eine externe Antenne bringt
typisch 10–20 dB. Zweitens hat der Wechsel der Bodenstation von WLAN auf LTE mitten in der
Sitzung **Failsafe ausgelöst und wieder aufgehoben** — genau die Aufgabe des Watchdogs:
die Steuerframes blieben länger als 300 ms aus, das Fahrzeug ging in den sicheren Zustand
und kam zurück, als die Frames wieder liefen.

> Ein direkter Pfad ist nicht garantiert: Er kam hier zustande, weil der Betreiber eine
> routbare **IPv6**-Adresse vergeben hat. Hinter reinem CGNAT-IPv4 kann Tailscale auf ein
> DERP-Relay zurückfallen, was Latenz kostet — prüf das mit `tailscale ping <Fahrzeug>`,
> bevor du dich darauf verlässt.

### 4.4 Weitere Remote-Access-Methoden (Setup › Remote access)

Unter **Setup › Remote access** wählst du **eine** Methode:

- **Tailscale** / **ZeroTier** — Zero-Config-Mesh-VPNs, ganz ohne eigenen Server. Bei
  ZeroTier: unter my.zerotier.com ein Netzwerk anlegen, die 16-stellige **Network ID**
  eintragen, *Bring up* drücken und den Pi in ZeroTier Central autorisieren. Die
  Ground-App dann auf die ZeroTier-IP des Pi verbinden.
- **WireGuard (eigener Server / FritzBox)** — wenn du bereits einen WireGuard-Server
  betreibst, füge den Pi als Peer hinzu. Zwei Wege, beide unter *Setup › Remote access ›
  WireGuard*: die exportierte **`.conf` hochladen**, oder die **Werte eintragen**
  (privater Schlüssel, Adresse im Tunnel, öffentlicher Schlüssel des Servers, Endpoint,
  AllowedIPs), wenn dein Peer als Seite mit Einstellungen statt als Datei kam. Bei einer
  **FritzBox** gibt es eine Datei: *Internet › Freigaben › VPN (WireGuard) › Verbindung
  hinzufügen*, eine Verbindung für den Pi anlegen, die Konfigurationsdatei herunterladen,
  hochladen, dann *Bring up*. Einen Schlüssel erzeugst du bei Bedarf auf dem Pi mit
  `wg genkey`, und lass **PersistentKeepalive auf 25** — hinter Carrier-NAT funktioniert
  ein Tunnel ohne das bis zur ersten Leerlaufminute. Das Fahrzeug speichert
  die Datei, wendet sie mit `wg-quick` an und ist danach unter seiner WireGuard-Adresse
  erreichbar (z. B. aus dem Heimnetz / über MyFRITZ!). Beim nächsten Boot kommt sie
  automatisch hoch.

> ZeroTier/WireGuard brauchen ihre Tools auf dem Pi (`zerotier-cli`, `wireguard-tools`)
> — das Install-Skript bringt sie mit; WireGuard wird als root via `wg-quick` angewandt.
> Prüfe die Methode auf deinem Pi, bevor du dich im Feld darauf verlässt.

---

## 5. Lokal ohne Netz betreiben (AP-Modus + Handy)

Solange sein WLAN nicht in einem Netz eingebucht ist, startet der Pi kurz nach dem Booten
einen eigenen **WLAN-Hotspot „YonderRC-setup"** (Modus `always`, Standard seit v1.41.0 —
die übrigen Modi stehen in 5.2) — **offen, ohne
Passwort**, damit das Captive Portal die Seite ohne Tipparbeit vor dich stellt. So
steuerst und konfigurierst du komplett **ohne Laptop, nur mit dem Handy**:

1. Am Handy mit dem WLAN **„YonderRC-setup"** verbinden.
2. Dank **Captive Portal** öffnet sich automatisch die YonderRC-Seite (falls nicht,
   im Browser `http://192.168.4.1:8080/` öffnen).
3. Dort hast du **beides**: die **Steuerung** (Boden-App, direkt vom Pi ausgeliefert)
   und unter **Setup** die komplette Konfiguration.

> **Wenn sich die Seite *nicht* von selbst öffnet — so gewollt.** Das Captive Portal
> funktioniert, indem jeder Name auf den Pi aufgelöst wird. Hat das Fahrzeug einen
> eigenen Uplink (Ethernet auf der Werkbank, LTE im Feld), **teilt der Hotspot dieses
> Internet** — DNS umzubiegen würde es für alle Verbundenen kaputtmachen. YonderRC lässt
> DNS dann in Ruhe, und du öffnest `http://192.168.4.1:8080/` selbst. Die Hotspot-Meldung
> im Setup sagt dir, welcher der beiden Fälle eingetreten ist. Außerdem: **Handys** öffnen
> die Seite zuverlässig von allein, ein **Laptop** (GNOME/Fedora, Windows) zeigt meist nur
> eine Benachrichtigung „Beim Netzwerk anmelden".

> **Das WLAN-Modul muss erst eingeschaltet sein.** Raspberry Pi OS hält es per rfkill
> gesperrt, solange kein **WLAN-Land** gesetzt ist (Funkregulierung); NetworkManager
> meldet das Gerät dann schlicht als „unavailable" — es kann kein Hotspot starten, und
> nichts sagt warum. YonderRC fängt das ab: **Setup › WiFi › WiFi radio** zeigt Zustand
> und Land, ein Knopf entsperrt das Modul und setzt das Land (vorbelegt aus Locale bzw.
> Zeitzone des Pi). Beim Hotspot-Start wird das automatisch repariert und auch gesagt.
> Das Länderfeld bleibt **danach änderbar** — es ist eine Funkregulierung, die Kanäle
> und Sendeleistung bestimmt, und muss korrigierbar sein, wenn die Kiste über eine
> Grenze umzieht.
> `onboard.sh` macht beim Booten dasselbe. Über SSH entspricht das
> `sudo raspi-config nonint do_wifi_country DE && sudo rfkill unblock wifi`.

### 5.1 Den Pi vom Handy aus ins WLAN bringen

**Setup › WiFi** erledigt das ganze Onboarding ohne Tastatur am Pi:

1. **Scan for networks** — die Liste zeigt SSID, Signal und ob verschlüsselt.
2. Dein Netz antippen, Passwort eingeben, **Connect**.
3. Der Pi hat **eine Funkeinheit**, das Verbinden **schließt also den Hotspot** — die
   Seite antwortet nicht mehr, und genau das ist das erwartete Zeichen, dass es
   geklappt hat. Wieder ins eigene WLAN gehen und `http://yonderrc.local:8080/setup`
   öffnen (oder die neue IP des Pi).
4. War das Passwort falsch, **fährt das Fahrzeug den Hotspot wieder hoch** — du sperrst
   dich also nicht aus. Erneut verbinden und nochmal probieren.

### 5.2 Hotspot-Passwort und wann er startet

Unter **Setup › WiFi › Setup hotspot** lassen sich Name und Passwort des Hotspots setzen
(mind. 8 Zeichen, WPA2 — leer bleibt offen) und **wann er startet**:

| Modus | Verhalten |
|---|---|
| **always** (Standard) | Immer, wenn die WLAN-Einheit frei ist — **auch neben Ethernet oder LTE**, du kommst also jederzeit ans Fahrzeug und auf die Setup-Seite. |
| **auto** | Nur, wenn der Pi beim Booten **gar keinen Uplink** hat (Verhalten vor v1.41.0). |
| **off** | Startet nie von selbst. |

> Da der Standard den Hotspot dauerhaft laufen lässt: **gib ihm ein Passwort**, sobald das
> Fahrzeug die Werkbank verlässt (gleiches Panel, mind. 8 Zeichen). Ihn offen zu lassen ist
> eine bewusste Entscheidung — nur so funktioniert das Captive Portal ohne Tipparbeit —
> aber ein offener AP heißt eben auch, dass jeder in Reichweite die Setup-Seite erreicht
> und, falls aktiviert, die Admin-Seite des LTE-Sticks.

*Save* wirkt beim nächsten Hotspot-Start, *Save & start now* startet ihn sofort neu
(was dich rauswirft, wenn du darüber verbunden bist), *Stop hotspot* fährt ihn herunter.

> **Eine Funkeinheit, eine Aufgabe.** Das eingebaute WLAN des Pi kann entweder den
> Hotspot bereitstellen **oder** in einem Netz sein — nicht beides. `always` startet den
> Hotspot also neben **LTE**, aber nie, solange der Pi WLAN-Client ist; das Onboarding
> prüft das zuerst, denn den WLAN-Link abzureißen würde das Fahrzeug aus deinem LAN
> werfen. Wer Hotspot *und* WLAN gleichzeitig will, steckt einen **zweiten
> USB-WLAN-Adapter** an.

> **Was den Hotspot schließt:** ein Netz über **Setup › WiFi** beitreten (eine
> Funkeinheit), *Stop hotspot*, oder ein Neustart mit funktionierendem Uplink im Modus
> `auto`. Ein Remote-Dienst (Tailscale / ZeroTier / WireGuard) oder eine LTE-Verbindung
> **nicht** — die laufen über andere Interfaces, der AP bleibt also schlicht oben.

Das Fahrzeug liefert die Boden-App also selbst aus — die Boden-App verbindet sich
automatisch zurück auf denselben Host (den Pi), inklusive Video. Damit ist der Pi
im Feld autark bedienbar; sobald wieder WLAN/LTE da ist, nutzt du wie gewohnt
Laptop oder die Tailscale-Adresse.

> **Sicherheit im AP-Betrieb:** Auch hier gelten Watchdog, Arming und Auto-Disarm bei
> Reconnect. Für Flugzeug/Drohne musst du den Auto-Disarm nicht mehr von Hand
> abschalten — die Boden-App setzt ihn nach Modelltyp (Auto/Boot an,
> Flugzeug/Drohne aus).

> **Wer drankommt:** Der Hotspot ist **standardmäßig offen**, jeder in Reichweite kann
> also beitreten und mit dem Fahrzeug reden. Auf der Werkbank ist das praktisch; vor dem
> Rausgehen ein **Hotspot-Passwort** (5.2) und ein **API-Secret** (6.1) setzen. Ein
> öffentlich dokumentiertes Standardpasswort hätte nichts geschützt — darum gibt es
> keines. Dasselbe gilt in einem geteilten WLAN.

---

## 6. Was YonderRC an Sicherheit dazutut

- **Failsafe-Watchdog:** Bleiben gültige Steuer-Frames länger als die eingestellte
  Zeit aus (Standard 300 ms, im Setup als „Watchdog (ms)" änderbar), fährt das
  Fahrzeug jeden Kanal auf seinen Failsafe-Wert. Die Defaults sind **modellabhängig
  und getrennt vom Disarmen**: Drohne hält Gas in der **Mitte** (kein Absturz),
  Auto/Boot auf **Stopp**, Flugzeug auf **Motor aus**. Alles pro Kanal einstellbar.
- **Disarmen ≠ Failsafe:** Bewusstes Disarmen schaltet den Motor wirklich aus
  (Drohne/Flugzeug = Minimum, Auto/Boot = Stopp) — unabhängig vom Failsafe-Wert.
- **Arming:** Der Gas-Kanal bleibt disarmed auf Leerlauf; Motor läuft erst nach
  bewusstem Arm.
- **Arming gilt pro Verbindung:** Eine neu verbundene Bodenstation ist immer disarmed
  und muss bewusst armen. Ob ein *bestehendes* Arm einen Reconnect überlebt, ist
  **fahrzeugtyp-abhängig**: bei Auto/Boot disarmt das Fahrzeug beim Reconnect, bei
  Flugzeug/Drohne **nicht** — ein kurzer Verbindungsabriss darf einem Luftfahrzeug im
  Flug nicht die Motoren kappen. Die Boden-App pusht das anhand des Modelltyps; die
  Checkbox in der Setup-Seite ist nur der Fallback, bis sich eine Bodenstation verbindet.
  In der Boden-App lässt sich die Regel unter **Setup › Controls** auf *immer an* oder
  *immer aus* zwingen — steh lassen auf **auto**, außer der Fahrzeugtyp beschreibt deinen
  Aufbau wirklich nicht.
- **Pre-Arm-Check:** Armen wird verweigert, solange das Gas nicht in seiner Ruhelage
  steht (Mitte oder Leerlauf, je nach Detent des Kanals).
- **Halten zum Armen:** Der Arm-Button löst erst nach Halten aus (standardmäßig 1 s; er
  füllt sich und zählt herunter), beim Armen *und* beim Disarmen — ein Fehlgriff am Handy
  kappt so nicht die Motoren. Dasselbe Halten gilt für eine auf Arm/Disarm gelegte
  **Taste oder Controller-Taste** — ein angestoßener Controller kappt die Motoren genauso
  gut wie ein Fehlgriff. Haltezeit (0,5–10 s) und Aus-Schalter liegen in der Boden-App
  unter **Setup › Controls**. Das belegbare **Panic-Disarm** bleibt in jedem
  Fall sofort, und das OSD zeigt nur noch DISARMED oder FAILSAFE, nie ein Badge für den
  Normalfall „gearmt".
- **Das Tempolimit ist Komfort, keine Sicherheitsfunktion.** Die drei Stufen unter den
  Sticks skalieren den Gasbefehl auf der Bodenseite; sie ändern weder Failsafe-Wert noch
  Disarm-Wert noch den Pre-Arm-Check — ein begrenztes Fahrzeug ist kein disarmtes.
- **Panic-Disarm ist ab Werk unbelegt.** Es ist die einzige Funktion ohne Halten und ohne
  Rückfrage — ein versehentlicher Druck kappt die Motoren, bei einem Luftfahrzeug also
  Absturz. Unter **Setup › Controls** auf eine Taste oder Controller-Taste legen, die du
  nicht aus Versehen triffst; wer mit Controller fliegt, legt sie *auf den Controller*.
- **Treiber-Fallback:** Schlägt der Hardware-Treiber beim Start fehl, läuft der
  Dienst im Sim weiter und die Setup-UI bleibt erreichbar.
- **systemd `Restart=always`:** Stürzt der Dienst ab, startet ihn systemd neu.

### 6.1 Vertrauensmodell (wer das Fahrzeug steuern kann)

Der Fahrzeug-Dienst lauscht auf **allen Interfaces** (`0.0.0.0:8080`) und ist ab Werk
so eingestellt, dass **jeder, der diesen Port erreicht, steuern und umkonfigurieren
kann**. Das ist Absicht — ein headless Fahrzeug darf dich nie aussperren — bedeutet
aber: das Netz *ist* die Sicherheitsgrenze.

- **Heim-WLAN / Werkbank:** so wie es ist in Ordnung.
- **Eigener Hotspot des Pi:** WPA2 hält Fremde draußen; wer im Hotspot ist, gilt als
  vertrauenswürdig.
- **LTE:** mit Tailscale/ZeroTier/WireGuard ist das Fahrzeug nur innerhalb deines
  privaten Netzes erreichbar. Durch CGNAT hat es zusätzlich keine öffentliche IP.
- **Geteiltes oder öffentliches WLAN:** unter *Setup › Security* ein **API-Secret**
  setzen. Danach brauchen verändernde `/api/*`-Aufrufe den Header `x-yonderrc-secret`
  (oder `?secret=`) und der Steuer-WebSocket `?secret=` — ein falsches wird mit
  Close-Code 4001 abgewiesen. Die Boden-App hat ein Secret-Feld neben der Adresse, die
  Setup-Seite fragt danach. Alternativ kommt es aus der Umgebungsvariablen
  `YRC_API_SECRET`. Das Secret liegt im Klartext in der Config-Datei des Fahrzeugs —
  betrachte es als Türschloss, nicht als Verschlüsselung; der Datenverkehr selbst ist
  nicht verschlüsselt (dafür ein VPN nutzen).
- **Eine Seite aus dem Internet kann dein Fahrzeug nicht steuern**, auch ohne gesetztes
  Secret. Der Browser ist der eine Angreifer, der ohnehin schon im Netz ist: Jede
  beliebige Website, die der Bediener öffnet, während sein Handy am Fahrzeug-Hotspot
  hängt, könnte sonst POSTs an die Setup-API schicken — oder einen Kontroll-WebSocket
  öffnen, der CORS komplett ignoriert — und das Fahrzeug scharf schalten. Das Fahrzeug
  schaut deshalb, **woher die Seite selbst stammt**. Anfragen ohne `Origin` (curl,
  Skripte), von `file://` (die Desktop-App), von einer privaten, Loopback-, `.local`-
  oder Tailscale-Adresse oder von der eigenen Adresse des Fahrzeugs werden angenommen;
  eine Seite aus dem öffentlichen Internet wird abgewiesen (HTTP 403, WS-Close-Code
  **4003**) — es sei denn, sie weist das API-Secret vor. Das entschärft auch
  DNS-Rebinding, weil die angreifende Seite ihren eigenen Origin behält.
- **Nur eine Bodenstation hat gleichzeitig die Kontrolle.** Verbindet sich eine zweite,
  wird die ältere mit Code **4002** geschlossen und bekommt gesagt, warum — statt dass
  beide Sitzungen dem Fahrzeug fünfzigmal pro Sekunde Steuerframes schicken. Das normale
  Wiederverbinden nach einem Abriss bleibt davon unberührt: Der Neue gewinnt immer, und
  genau das macht das Übernehmen möglich.
- Ein **Werksreset** (*Setup › System*) löscht das Secret zusammen mit allem anderen.
- Noch enger geht es, indem du den Dienst auf eine einzige Adresse bindest statt auf
  alle Interfaces — z. B. `YRC_HOST=100.x.y.z` (die Tailscale-IP) als `Environment=` in
  der systemd-Unit. Dafür gibt es keine UI, und du sperrst dich damit vom Hotspot-/
  LAN-Weg aus — also erst, wenn der Fernzugriff nachweislich läuft.

---

## 7. Schnelle Fehlersuche

| Symptom | Prüfen |
|---|---|
| Kein I2C-Gerät | `sudo i2cdetect -y 1` — erscheinen 0x40/0x41? Verkabelung/Adressen. |
| Servos zittern | Gemeinsame Masse? BEC stark genug? PCA9685 V+ versorgt? |
| OSD zeigt „SIM" trotz Sensor | `i2c-bus` installiert? Adresse im Setup korrekt? Sensor auf dem Bus sichtbar? |
| Kein Video | Läuft `go2rtc`? `systemctl status go2rtc`. Kamera erkannt? |
| LTE verbindet nicht | `mmcli -L`, APN korrekt? Signal? |
| Von unterwegs keine Verbindung | Beide Geräte im selben Tailnet? Tailscale-IP genutzt? |
| Link bricht sofort ab / Setup fragt nach Passwort | Es ist ein **API-Secret** gesetzt — in der Boden-App neben der Adresse eintragen (WS-Close-Code 4001 = falsches Secret, HTTP 401 auf der Setup-API). |
| Kein GPS-Fix | Richtige Quelle und Device unter *Setup › GPS*? Seriell braucht das optionale Paket `serialport`, USB-Dongles die **gpsd**-Quelle. Im Freien kann der erste Fix Minuten dauern. |
| Kein Signalwert im OSD | LTE muss verbunden sein (`mmcli`), oder das WLAN-Interface muss `wlan0` heißen — andere Namen werden nicht gelesen. |
