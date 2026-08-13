[English](HARDWARE.md) · **Deutsch**

# YonderRC — Hardware-Guide (Teileliste, Verkabelung, Einrichtung)

Diese Anleitung bringt YonderRC von der reinen Simulation auf echte Hardware:
Raspberry Pi als Fahrzeugrechner, PCA9685 für Servos/ESC, INA226 für Strom/Spannung,
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
| Strom-/Spannungssensor | **INA226** Breakout (I2C) | Misst Pack-Spannung und Strom hochseitig; präzise für die mAh-Zählung. Alternativ INA219 (kleinere Ströme). |
| Stromversorgung Pi | **UBEC/BEC 5 V / 3 A** | Versorgt den Pi stabil aus dem Fahrakku. |
| Kamera | **Pi Camera Module 3** (CSI) *oder* USB-Kamera mit H.264 | CSI = geringste Latenz. |
| Verkabelung | Jumper, JST, Lötzeug | I2C-Bus, Servostecker, Sensor. |

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

### 2.2 INA226 (Strom/Spannung) ↔ I2C

- SDA/SCL an **denselben** I2C-Bus wie der PCA9685 (parallel), Adresse abweichend
  (INA226 Standard **0x40**? — kollidiert mit PCA9685! **Adresse per Lötbrücke auf
  z. B. 0x41 setzen**, oder PCA9685 auf 0x41 legen; Hauptsache verschieden).
- Der Sensor sitzt **hochseitig** in der Plus-Leitung des Akkus: Akku(+) → `VIN+`,
  Last (ESC/BEC) → `VIN−`. Der interne/externe **Shunt** bestimmt den Messbereich
  (z. B. 0,002 Ω für hohe Ströme). Den Shunt-Wert trägst du später im Setup ein.
- **GND** des Sensors mit dem gemeinsamen Massepunkt verbinden.

```
Akku(+) ──► [INA226 VIN+  VIN−] ──► ESC/BEC (+)
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

---

## 3. Software — Schritt für Schritt (zuerst WLAN)

### 3.1 Raspberry Pi OS flashen

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit, Bookworm)**.
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

`install.sh` installiert Node, ffmpeg, NetworkManager, ModemManager, Tailscale und
go2rtc, richtet die drei systemd-Dienste ein (`yonderrc-vehicle`, `go2rtc`,
`yonderrc-onboard`) und aktiviert **I2C** und **UART**.

> Fedora-Notiz von deinem Laptop gilt hier nicht — auf dem Pi bringt das Skript das
> passende ffmpeg mit H.264 mit.

### 3.3 Hardware-Treiber-Abhängigkeiten (nur was du nutzt)

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA226
npm install pigpio     -w @yonderrc/vehicle    # (nur bei GPIO-PWM statt PCA9685)
npm install serialport -w @yonderrc/vehicle    # (nur bei SBUS/Drohne)
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Über WLAN einrichten (grafisch)

Öffne vom Laptop/Handy im selben WLAN: **`http://yonderrc.local:8080/setup`**
(oder `http://<pi-ip>:8080/setup`).

1. **Vehicle:** Name setzen, **Output driver = `pca9685`** (Drohne: `sbus`),
   Throttle-Kanal prüfen.
2. **Cameras:** Kamera hinzufügen (Typ `rpicam` oder `usb`, Auflösung/FPS/Bitrate)
   → **Save & apply**. go2rtc wird neu geladen.
3. **Telemetry:** Source **`real`**, Strom-Sensor **`ina226`**, `Shunt Ω` eintragen
   (z. B. 0.002), Spannungslabel „Spannung 1", Batteriekapazität (mAh) angeben,
   Anzeige verbraucht/Rest wählen → **Save**. Danach Fahrzeug neu starten
   (`sudo systemctl restart yonderrc-vehicle`).

### 3.5 Erster Funktionstest (RÄDER HOCH / PROPS AB!)

1. Boden-App am Laptop öffnen, oben die **Pi-Adresse** eintragen:
   `ws://yonderrc.local:8080`, **Connect**.
2. Noch **nicht armen**. Im Kanal-Monitor prüfen: Lenkung/Ruder bewegt den
   richtigen Kanal? Endpunkte ok? Bei Bedarf im Setup Trim/EPA/Reverse anpassen.
3. **ESC-Kalibrierung** (falls nötig) im Setup starten — Anweisungen folgen.
4. Erst wenn alles stimmt: Antrieb scharf, **Arm** drücken, vorsichtig Gas.
5. **Video** sollte im FPV-Panel laufen (der `go2rtc`-Dienst läuft dauerhaft).
6. **Telemetrie** im OSD prüfen: zeigt es echte Pack-Spannung? Steht dort **nicht**
   „SIM"? Dann liest der INA226 korrekt. Falls „SIM" erscheint, greift der Fallback
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
   `usb-modeswitch` (vom Setup-Skript installiert).

### 4.2 Tailscale

1. Im Setup unter **Tailscale** auf **Bring up** — ohne Auth-Key bekommst du eine
   Login-URL; öffnen und das Gerät in deinem Tailnet bestätigen. (Oder vorab einen
   Auth-Key erzeugen und einfügen für Setup ohne Interaktion.)
2. Die **Tailscale-IP** des Fahrzeugs steht danach oben im Setup-Status
   (z. B. `100.x.y.z`).

### 4.3 Von unterwegs verbinden

- Dein Boden-Gerät (Laptop/Handy) ebenfalls in dasselbe Tailnet bringen
  (Tailscale-App installieren, einloggen).
- In der Boden-App als Adresse die **Tailscale-IP** verwenden:
  `ws://100.x.y.z:8080`. Das Video läuft analog über `http://100.x.y.z:1984`.

> **Latenz/Reichweite:** Für den absolut niedrigsten WebRTC-Weg über LTE kannst du
> später einen eigenen **TURN-Server (coturn)** auf einem günstigen VPS ergänzen.
> Tailscale allein gibt dir aber bereits eine funktionierende, verschlüsselte
> Verbindung und ist der einfachste Weg, der zuverlässig klappt.

### 4.4 Weitere Remote-Access-Methoden (Setup › Remote access)

Unter **Setup › Remote access** wählst du **eine** Methode:

- **Tailscale** / **ZeroTier** — Zero-Config-Mesh-VPNs, ganz ohne eigenen Server. Bei
  ZeroTier: unter my.zerotier.com ein Netzwerk anlegen, die 16-stellige **Network ID**
  eintragen, *Bring up* drücken und den Pi in ZeroTier Central autorisieren. Die
  Ground-App dann auf die ZeroTier-IP des Pi verbinden.
- **WireGuard (eigener Server / FritzBox)** — wenn du bereits einen WireGuard-Server
  betreibst, füge den Pi als Peer hinzu und **lade die exportierte `.conf` hoch**. Bei
  einer **FritzBox**: *Internet › Freigaben › VPN (WireGuard) › Verbindung hinzufügen*,
  eine Verbindung für den Pi anlegen, die Konfigurationsdatei herunterladen und unter
  *Setup › Remote access › WireGuard* hochladen, dann *Bring up*. Das Fahrzeug speichert
  die Datei, wendet sie mit `wg-quick` an und ist danach unter seiner WireGuard-Adresse
  erreichbar (z. B. aus dem Heimnetz / über MyFRITZ!). Beim nächsten Boot kommt sie
  automatisch hoch.

> ZeroTier/WireGuard brauchen ihre Tools auf dem Pi (`zerotier-cli`, `wireguard-tools`)
> — das Install-Skript bringt sie mit; WireGuard wird als root via `wg-quick` angewandt.
> Prüfe die Methode auf deinem Pi, bevor du dich im Feld darauf verlässt.

---

## 5. Lokal ohne Netz betreiben (AP-Modus + Handy)

Wenn der Pi **weder ein bekanntes WLAN noch LTE** findet, startet er nach dem
Booten automatisch einen eigenen **WLAN-Hotspot „YonderRC-setup"** (Passwort
`yonderrc123`). So steuerst und konfigurierst du komplett **ohne Laptop, nur mit
dem Handy**:

1. Am Handy mit dem WLAN **„YonderRC-setup"** verbinden.
2. Dank **Captive Portal** öffnet sich automatisch die YonderRC-Seite (falls nicht,
   im Browser `http://192.168.4.1:8080/` öffnen).
3. Dort hast du **beides**: die **Steuerung** (Boden-App, direkt vom Pi ausgeliefert)
   und unter **Setup** die komplette Konfiguration.

Das Fahrzeug liefert die Boden-App also selbst aus — die Boden-App verbindet sich
automatisch zurück auf denselben Host (den Pi), inklusive Video. Damit ist der Pi
im Feld autark bedienbar; sobald wieder WLAN/LTE da ist, nutzt du wie gewohnt
Laptop oder die Tailscale-Adresse.

> **Sicherheit im AP-Betrieb:** Auch hier gelten Watchdog, Arming und (falls
> aktiviert) Auto-Disarm bei Reconnect. Für Flugzeug/Drohne im Setup den
> Auto-Disarm ausschalten.

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
- **Auto-Disarm bei Reconnect:** Jede neue Verbindung startet disarmed — nach
  Link-Verlust musst du bewusst neu armen.
- **Treiber-Fallback:** Schlägt der Hardware-Treiber beim Start fehl, läuft der
  Dienst im Sim weiter und die Setup-UI bleibt erreichbar.
- **systemd `Restart=always`:** Stürzt der Dienst ab, startet ihn systemd neu.

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
