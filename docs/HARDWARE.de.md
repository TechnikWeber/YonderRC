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
- Standardadresse **0x40** — dieselbe wie bei jedem INA2xx-Sensor. **Sensor auf 0x40
  lassen und den PCA9685 auf 0x41 verschieben** (Lötbrücke **A0** schließen), dann `0x41`
  unter Setup › *Vehicle configuration* eintragen und den Dienst neu starten.
- Servos/ESC an die Ausgänge 0–15. App-Kanäle 1–16 entsprechen PCA9685-Kanälen 0–15;
  verbunden zeigt die App den Ausgang neben jedem Kanal (`CH03 · out 2`).

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
- **Servo-V+ kommt ebenfalls nicht vom Pi.** Ein Servo an den 5-V-Pins des Pi zieht den
  ganzen Pi herunter — das sieht aus wie ein Softwareabsturz: Bild friert ein, eine Minute
  später wieder da.
- **5,1 V / 3 A mit kurzem, dickem Kabel sind das Minimum.** Pi, Kamera, LTE-Stick und GPS
  ziehen allein 1,4–2 A bei 5 V; ein 5-A-Regler am Fahrakku ist eine sichere Wahl.
- Das OSD zeigt **⚠ POWER**, solange die Versorgung zu schwach ist.
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

- **TX und RX kreuzen sich.** Vertauscht bleibt der Empfänger stumm.
- **`/dev/serial0`** verwenden, nicht `/dev/ttyAMA0` (das ist auf Pi 3/4/5 Bluetooth).
  Braucht das Modul `serialport` (3.3).
- Bietet Setup › GPS **Free the serial port for GPS** an, drücken und neu starten.
- **Drinnen gibt es keinen Fix**, aber das GPS-Panel zählt die eingehenden Daten: Zählt es
  hoch, stimmt die Verkabelung. „Nothing received" ist die Verkabelung; „no fix" ist das
  Dach.
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

> **Zum ersten Mal mit Linux?** [`QUICKSTART.de.md`](QUICKSTART.de.md) zeigt dieses
> Kapitel Klick für Klick — Imager, den Pi finden, SSH, Dateien kopieren.

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit)**. Getestet mit **Bookworm**
   (steht dort als *Legacy*); das aktuelle **Trixie** sollte gehen, ist aber ungetestet.
2. In den Imager-Einstellungen: **SSH aktivieren**, Benutzer, **WLAN-Name, Passwort und
   Land**, Hostname `yonderrc`.
3. **Zuerst die Hardware anschließen** (Kapitel 2), den PCA9685 auf **0x41** — der
   Installer schaut einmal auf den Bus.
4. Flashen, einsetzen, einschalten.

### 3.2 Installieren

Mit Internet am Pi einloggen (`ssh pi@yonderrc.local`) und ausführen:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Kein Internet am Pi, oder eine eigene Kopie: den Ordner hinüberkopieren
([`QUICKSTART.de.md`, Option B](QUICKSTART.de.md#option-b-die-dateien-selbst-kopieren)),
dann `sudo bash /opt/yonderrc/provisioning/install.sh`.

Der Installer richtet alles ein, was das Fahrzeug braucht (Node, Video, Netz- und
VPN-Werkzeuge, drei systemd-Dienste), schaltet I²C und die serielle Schnittstelle ein und
das WLAN-Energiesparen ab. Dann schaut er **einmal** nach der Hardware und trägt nur ein,
was noch nie gespeichert wurde:

- ein **PCA9685** → Ausgabetreiber `pca9685` mit seiner Adresse;
- eine **CSI-Kamera** → Kamera `cam` statt des Testbilds;
- Stromsensoren werden nur **genannt** — sie werden auf der Seite eingerichtet
  (3.5 Schritt 4).

Nichts gefunden → der Simulator bleibt. Den Installer erneut laufen zu lassen ist
unbedenklich. Zwei Chips auf derselben Adresse sind nicht zu unterscheiden, also die
Adressen **vor** der Installation setzen.

### 3.3 Hardware-Treiber-Abhängigkeiten (nur was du nutzt)

Die Hardware-Treiber brauchen ein natives Modul, das auf dem Pi kompiliert wird. Ein
Fahrzeug braucht höchstens eines, deshalb ist ab Werk keines installiert. **Deines im
Browser installieren** — Setup › Vehicle configuration › **Native driver modules**:

| Modul | nötig für |
| --- | --- |
| `i2c-bus` | PCA9685-Servo/ESC-Treiber · INA2xx-Stromsensoren · ADS1115-ADC |
| `pigpio` | GPIO-PWM statt PCA9685 (Pinbelegung: 2.8) |
| `serialport` | SBUS-Ausgabe (Flight Controller) · serielles GPS |

**Install** drücken, dann den Dienst neu starten, wenn die Seite es anbietet.

- Der Pi braucht **Internet** — sein eigener Hotspot hat keins, also erst in ein Netz
  einbuchen.
- Es **dauert eine Minute**.
- Ein fehlgeschlagener Build nennt die Ursache und den Befehl, der sie behebt.

Installierte Module werden nach jedem Update wiederhergestellt.

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

1. **Check for updates** zeigt, was neu ist. Es ändert nichts.
2. **Update & restart** lädt, installiert, baut neu und startet neu. Scheitert ein
   Schritt, läuft die alte Version weiter.

Ohne Internet oder bei von Hand geänderten Dateien verweigert es, mit Begründung.
*Update source* kann auf einen Fork oder einen anderen Branch zeigen.

> Meldet die Prüfung, dass sich der **Installer** geändert hat, einmal
> `sudo bash provisioning/install.sh` laufen lassen — Systempakete und Dienste werden
> nicht über die Seite aktualisiert.

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

Die Seite hat Tabs — **Overview · Network · Remote access · Sensors & outputs · Camera ·
GPS · Design**. *Overview* zeigt auf einem Schirm, ob alles da ist.

0. **Detect hardware** (in *Vehicle configuration*) listet die gefundenen Chips, Modems
   und Kameras mit Namen. **Use these addresses** trägt sie in die Formulare ein; Save
   behält sie.
1. **Vehicle:** Name, **Output driver = `pca9685`** (Drohne: `sbus`; ohne Zusatzboard:
   `gpio-pwm`, Pins in 2.8), Gaskanal prüfen. Die **I²C-Adresse** setzen — **0x41** beim
   Referenzaufbau. Speichern, dann **Restart vehicle service**.
2. **CSI camera module:** den Sensor am Kameraport wählen. Die offiziellen Pi-Kameras werden
   von selbst gefunden; für andere (Arducam …) schreibt die Seite die Boot-Einstellung und
   verlangt einen **Reboot**.
3. **Cameras:** Kamera hinzufügen (`rpicam` für das Flachbandkabel, `usb` für USB;
   Auflösung, FPS, Bitrate) → **Save & apply**.

   - **Kopfüber montiert?** Jede Kamera hat **Rotation** (0°/180°) und Spiegelung.
   - **Keine Kamera** geht auch: der FPV-Bereich bleibt dunkel, alles andere funktioniert.
   - **Bild bleibt schwarz?** `rpicam-hello --list-cameras` muss die Kamera auflisten. Wenn
     nicht: das Flachbandkabel — Kontakte Richtung HDMI, **CAM**-Port, nicht DISPLAY.
   - **Arducam 16 MP IMX519 unscharf?** **Tuning file** auf
     `/var/lib/yonderrc/tuning/imx519-af.json` und **Focus** auf `manual` bei 0 Dioptrien.
4. **Telemetry:** Quelle **`real`**, Stromsensor **`ina228`** (oder ein anderer INA) — das
   füllt die Referenzwerte. `Shunt Ω` auf den Aufdruck deines Boards setzen und **Max
   current A** auf die Spitze deines Modells. Einen Spannungskanal derselben Art hinzufügen
   (der INA misst beides), die Akkukapazität eintragen. Bei mehreren Kanälen den am Akku
   als **primary** markieren. Temperaturkanäle sind optional (2.7).
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
2. In Setup › **LTE** den **APN** eintragen → **Connect**. Nach einem Neustart verbindet er
   von selbst. **SIM-PIN** und APN-Benutzer/Passwort, falls der Anbieter sie braucht. Das
   Panel kann außerdem **4G-only** erzwingen, **Roaming** schalten, die PIN ändern und eine
   Diagnose zeigen.
3. Das **Signal** erscheint dann im OSD, unter 25 % als schwach markiert.

### 4.1.1 HiLink-Sticks (Huawei E3372h-320 und Verwandte)

Viele Huawei-Sticks sind **keine Modems**, sondern kleine Router: Sie wählen selbst, und
`mmcli -L` bleibt leer — also bleibt auch das LTE-Panel leer. Das ist erwartet.

- **Setup › LTE stick (HiLink)** zeigt Modell, Zustand, Betreiber und Signal; das OSD zeigt
  das Signal wie bei jedem Modem.
- **APN, PIN und Netzmodus stellt man auf der eigenen Seite des Sticks ein.** Das Fahrzeug
  reicht sie auf **Port 8081** durch: `http://<fahrzeug>:8081/` öffnen (mit API-Secret:
  `…:8081/?secret=DEIN_SECRET`).
  > Auf einem **offenen** Hotspot erreicht jeder, der sich verbindet, diese Seite. Vor dem
  > Feldeinsatz ein Hotspot-Passwort oder API-Secret setzen.
- Ein **reiner 2G/3G-Stick** (E3131/E353) wird markiert: 3G ist in vielen Ländern
  abgeschaltet.

### 4.1.2 Datenvolumen-Budget

Ein FPV-Stream kostet **0,5–1 GB pro Stunde**. **Setup › Mobile data budget** zählt die
mobilen Daten und zeigt `⚠ DATA` im OSD ab einem eingestellten Anteil deines Tarifs.

- **Plan allowance** in MB (4096 = 4 GB), **Warn at** in % (Standard 80) und optional den
  **Tag im Monat** eintragen, an dem der Tarif zurücksetzt.
- Gezählt: LTE-Stick, Handy-Hotspot, getethertes Notebook. Nicht gezählt: der eigene
  Hotspot des Fahrzeugs (kostenlos) und VPN-Schnittstellen (sie würden jedes Byte doppelt
  zählen).
- Mit HiLink-Stick kann stattdessen dessen eigener Zähler dienen. Beide überstehen einen
  Neustart.

### 4.2 Tailscale

1. **Setup › Remote access** → **Tailscale** → **Bring up**, Auth-Key leer lassen. Ein
   Login-Link erscheint; öffnen und das Gerät bestätigen (es tritt als `yonderrc` bei).
2. Oder in Tailscale einen **Auth-Key** anlegen (*Settings › Keys*), einfügen, **Bring up**.
3. Die **Tailscale-IP** des Fahrzeugs erscheint im Status.
4. **Key-Expiry deaktivieren** (*Machines › yonderrc*), sonst fällt es nach etwa 180 Tagen
   heraus.

### 4.3 Von unterwegs verbinden

- Das Bodengerät ins selbe Tailnet holen.
- Die **Tailscale-IP** als Adresse nutzen: `ws://100.x.y.z:8080`. Das Video kommt über
  dieselbe Adresse mit.

Ein erster Feldtest über LTE ergab 110 ms Steuer-Round-Trip und 128 ms Video-Latenz
(Details: [`FEATURES.de.md`](FEATURES.de.md#im-feld-gemessen)). Meist begrenzt ein schwaches
Signal — eine externe Antenne hilft mehr als alles andere. `tailscale ping <fahrzeug>`
zeigt, ob die Verbindung direkt läuft oder über ein Relay.

### 4.4 Weitere Remote-Access-Methoden (Setup › Remote access)

**Eine** Methode wählen:

- **Tailscale** / **ZeroTier** — Zero-Config-Mesh-VPNs ohne eigenen Server. Für ZeroTier:
  Netz auf my.zerotier.com anlegen, die 16-stellige **Network ID** eintragen, *Bring up*,
  dann den Pi in ZeroTier Central autorisieren.
- **WireGuard (eigener Server / FritzBox)** — die exportierte **`.conf` hochladen** oder
  die Werte eintippen. FritzBox: *Internet › Freigaben › VPN (WireGuard) › Verbindung
  hinzufügen*, Datei herunterladen, hochladen, *Bring up*. **PersistentKeepalive auf 25**
  lassen — ohne das stirbt der Tunnel hinter dem NAT des Mobilfunkanbieters.
- **OpenVPN (eigener Server) — experimentell.** Das Client-Profil (`.ovpn`) **mit den
  Zertifikaten darin** hochladen; Benutzername und Passwort dazu, wenn es sie verlangt.
  Zeilen, die Programme auf dem Fahrzeug starten würden, werden abgeschaltet und
  aufgelistet. **Auf einem Fahrzeug noch nicht getestet** — auf der Werkbank ausprobieren
  und Rückmeldung geben.

Die Methode zu Hause testen, bevor du dich im Feld darauf verlässt.

---

## 5. Lokal ohne Netz betreiben (AP-Modus + Handy)

Solange sein WLAN nicht in einem Netz eingebucht ist, startet der Pi kurz nach dem Booten
den eigenen Hotspot **„YonderRC-setup"** — **offen, ohne Passwort**.

1. Das Handy mit **„YonderRC-setup"** verbinden.
2. Die Seite öffnet sich von selbst; sonst `http://192.168.4.1:8080/` öffnen.
3. Du bekommst **beides**: die Steuerung und unter **Setup** die volle Konfiguration.

> **Die Seite öffnet sich nicht von selbst**, wenn das Fahrzeug eigenes Internet hat
> (LTE): Der Hotspot teilt es dann, und die Seite muss von Hand geöffnet werden. Laptops
> zeigen meist nur eine „Im Netzwerk anmelden"-Meldung.

> **WLAN geht gar nicht?** Raspberry Pi OS sperrt das Funkmodul, bis ein **WLAN-Land**
> gesetzt ist. **Setup › WiFi › WiFi radio** behebt das mit einem Knopf.

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
| **always** (Standard) | Immer wenn das Funkmodul frei ist — auch neben Ethernet oder LTE. |
| **auto** | Nur wenn beim Booten keine andere Verbindung da ist. |
| **off** | Startet nie von selbst. |

> **Gib ihm ein Passwort**, sobald das Fahrzeug die Werkbank verlässt. Offen ist er nur ab
> Werk, damit die erste Einrichtung ohne Tippen geht — an einem offenen Hotspot erreicht
> jeder in Reichweite die Setup-Seite.

> **Ein Funkmodul, eine Aufgabe.** Das eingebaute WLAN ist entweder Hotspot **oder** in
> einem Netz, nie beides. Für beides gleichzeitig einen USB-WLAN-Adapter ergänzen.

---

## 6. Was YonderRC an Sicherheit dazutut

- **Failsafe:** bleiben Steuerpakete **500 ms** aus (100–2000 ms, Setup › Sensors &
  outputs), geht jeder Kanal auf seinen Failsafe-Wert: Eine Drohne hält das Gas in der
  **Mitte**, Auto und Boot **stoppen**, ein Flugzeug nimmt den **Motor** weg. Pro Kanal
  einstellbar.
- **Entschärft heißt aus:** ein entschärftes Fahrzeug lässt den Motor aus, auch wenn die
  Verbindung abreißt. Die Failsafe-Werte gelten ab dem Start des Dienstes, noch bevor sich
  eine Bodenstation verbindet.
- **Lieber keine Pakete als falsche:** im Hintergrund (anderer Tab, Handy-Bildschirm aus)
  oder bei einem scharfen Gamepad-Modell ohne Controller sendet die App nichts, und das
  Fahrzeug geht in den Failsafe. Ein Gamepad-Modell lässt sich ohne seinen Controller
  nicht armen.
- **Armen:** jede neue Verbindung startet entschärft. Nach einem Reconnect werden Auto und
  Boot entschärft, Fluggeräte bleiben scharf — ein kurzer Abriss darf im Flug keinen Motor
  abschalten (änderbar unter **Setup › Controls**).
- **Pre-Arm-Check:** Armen wird verweigert, solange das Gas nicht in Ruhelage steht.
- **Halten zum Armen** (1 s) für Armen *und* Entschärfen, am Button und an einer
  gebundenen Taste. **Panic-Disarm** wirkt sofort und ist ab Werk unbelegt — auf etwas
  legen, das du nicht versehentlich triffst.
- Der **Speed-Limiter** ist Komfort, keine Sicherheit. Die Regler-Kalibrierung bricht bei
  Verbindungsverlust ab.
- Ein Hardware-Treiber, der nicht startet, lässt das Fahrzeug im Simulator, erreichbar,
  und die Seite sagt warum. Nach einem Absturz startet der Dienst sich selbst neu.

### 6.1 Vertrauensmodell (wer das Fahrzeug steuern kann)

Der Dienst lauscht auf **allen Schnittstellen** (`0.0.0.0:8080`), und ab Werk kann
**jeder, der diesen Port erreicht, steuern und umkonfigurieren**. Das ist Absicht — ein
headless Fahrzeug darf dich nie aussperren — macht aber das Netz zur Sicherheitsgrenze.

- **Heim-WLAN / Werkbank:** so in Ordnung.
- **Eigener Hotspot des Pi:** WPA2 hält Fremde von der Luftschnittstelle fern.
- **LTE:** mit Tailscale/ZeroTier/WireGuard ist das Fahrzeug nur im privaten Netz
  erreichbar, und CGNAT bedeutet ohnehin keine öffentliche IP.
- **Fremdes oder öffentliches WLAN:** ein **API-Secret** unter *Setup › Security* setzen.
  Steuer-App, Video und jede Änderung auf der Setup-Seite brauchen es dann (neben der
  Adresse eintragen). Es ist ein Schloss an der Tür, keine Verschlüsselung.
- **Eine Webseite aus dem Internet kann dein Fahrzeug nicht fahren**, auch ohne Secret:
  Das Fahrzeug nimmt nur Seiten von sich selbst, aus dem lokalen Netz oder über ein VPN an.
- **Der Videoserver ist aus dem Netz nicht erreichbar**; das Video läuft über den
  Fahrzeugdienst (`…:8080/video`) nach denselben Regeln. WebRTC-Medien nutzen Port 8555.
- **Nur eine Bodenstation hat die Kontrolle.** Eine neue Verbindung übernimmt, und die alte
  erfährt warum.
- Ein **Werksreset** löscht das Secret mit allem anderen.
- Noch enger: `YRC_HOST=100.x.y.z` in der systemd-Unit bindet den Dienst an eine Adresse —
  sperrt aber Hotspot und LAN aus, also erst, wenn der Fernzugriff läuft.

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
| Flackert in den Failsafe und wieder heraus | Meist WLAN-Energiesparen, eine verdeckte Steuerseite oder Jitter — die Diagnosedatei sagt, was ([TROUBLESHOOTING.de.md §2](TROUBLESHOOTING.de.md#2-das-fahrzeug-flackert-in-den-failsafe-und-wieder-heraus)). |
| Controller tut nichts / das falsche Gerät wird benutzt | Eine Taste daran drücken; *Setup › Controls › Game controller* listet jedes Gerät und lässt wählen ([TROUBLESHOOTING.de.md §3](TROUBLESHOOTING.de.md#3-der-gamecontroller-tut-nichts)). |
| Übersicht: „Output driver … failed to start" | Das native Modul fehlt oder die Adresse stimmt nicht — die Zeile sagt, was (TROUBLESHOOTING.de.md §4). |
| Alles andere | *Setup › Diagnostics* → eine Datei → GitHub-Issue ([TROUBLESHOOTING.de.md §1](TROUBLESHOOTING.de.md#1-ein-problem-melden-die-diagnosedatei)). |

---

## 8. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Armen / Entschärfen** | Scharf = der Motor darf laufen. Entschärft hält das Fahrzeug das Gas aus. |
| **BEC / UBEC** | Kleiner Spannungsregler: macht aus dem Fahrakku 5 V für Pi und Servos. |
| **ESC / Regler** | Fahrtregler — treibt den Motor; bekommt ein Servosignal wie ein Servo. |
| **Failsafe** | Was jeder Kanal tut, wenn die Verbindung weg ist (stoppen, halten, Motor aus). |
| **FPV** | First Person View: Fahren nach dem Kamerabild. |
| **I²C** | Zweidraht-Bus (SDA, SCL) für PCA9685 und Sensoren; jeder Chip hat eine Adresse wie `0x40`. |
| **LTE / CGNAT** | Mobiles Internet. Das Fahrzeug bekommt dort keine öffentliche Adresse, daher ein VPN. |
| **OSD** | On-Screen-Display: die Messwerte über dem Video. |
| **PCA9685** | Ein 16-Kanal-Board, das die Servosignale erzeugt. |
| **Shunt** | Winziger Widerstand, über dem der Stromsensor misst; sein Wert steht auf dem Board (`R002` = 0,002 Ω). |
| **SSH** | Fernzugang zur Kommandozeile des Pi. |
| **Tailscale / WireGuard / ZeroTier** | VPNs: bringen Fahrzeug und Handy oder Laptop über das Internet in ein privates Netz. |
| **µs (Mikrosekunden)** | Das Servosignal: 1000 µs ein Ende, 1500 µs Mitte, 2000 µs das andere Ende. |
