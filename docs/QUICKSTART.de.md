[English](QUICKSTART.md) · **Deutsch**

# YonderRC — Schnellstart auf dem Raspberry Pi

Von der leeren SD-Karte bis zum Fahrzeug, das du aus dem Browser fährst — geschrieben für
alle, die noch nie mit Linux gearbeitet haben. Plane etwa eine Stunde ein; das meiste
davon ist Warten.

Am Ende hast du: einen Raspberry Pi mit YonderRC, seine Setup-Seite im Browser und — wenn
du sie vor der Installation angeschlossen hast — Servo-Board und Kamera schon in Betrieb.

> **Sicherheit zuerst.** Bis alles geprüft ist: **Räder in der Luft / Propeller ab**,
> Motor abgesteckt. Armen ist immer der letzte Schritt.

---

## 0. Was läuft wo

| Teil | Wo | Was du tust |
|---|---|---|
| **Fahrzeug** | ein Raspberry Pi im Modell | YonderRC darauf installieren — diese Anleitung |
| **Bodenstation** | jeder Browser (PC, Handy, Tablet) | nichts installieren — das Fahrzeug liefert sie unter `http://yonderrc.local:8080/` aus |
| Desktop-App (optional) | Windows / Linux | `packages/desktop` — nur für native Controller-Unterstützung |

Im Repository ist `provisioning/` alles, was nur den Pi betrifft (Installer, Dienste,
Hotspot). Daraus wird auf dem PC nie etwas ausgeführt.

## 1. Was du brauchst

- **Raspberry Pi 4** (2 GB reichen) oder **Pi Zero 2 W**, eine **microSD-Karte** (32 GB),
  ein ordentliches **5-V-/3-A-Netzteil**.
- Einen **PC** (Windows, macOS oder Linux) mit SD-Kartenleser, im selben WLAN/LAN.
- Optional, für ein echtes Fahrzeug: ein **PCA9685**-Servo-Board, ein
  **Pi-Kameramodul**, ein **INA228**-Stromsensor — Teile und Verkabelung stehen in
  [`HARDWARE.de.md`](HARDWARE.de.md).

## 2. Vor der Installation: Hardware anschließen und I²C-Adressen setzen

**Das zuerst.** Der Installer schaut einmal auf den I²C-Bus und den Kamera-Anschluss:
ein gefundener PCA9685 wird zum Ausgabetreiber, ein Kameramodul ersetzt das Testbild.
Was dann nicht angeschlossen ist, bleibt simuliert — das ist in Ordnung und lässt sich
später auf der Setup-Seite einstellen, aber „anstecken, installieren, fahren" klappt nur
in dieser Reihenfolge.

1. Den Pi beim Verkabeln **ausschalten**.
2. Die Boards anschließen wie in [`HARDWARE.de.md` §2](HARDWARE.de.md#2-verkabelung):
   SDA → Pin 3, SCL → Pin 5, 3V3 → Pin 1, GND → Pin 6. Servo-Strom (V+) **nie** vom Pi.
3. **Jedem I²C-Chip eine eigene Adresse geben.** Zwei Chips auf derselben Adresse
   antworten gleichzeitig und liefern Müll, und keiner von beiden ist zu erkennen:

   | Chip | Werksadresse | Was tun |
   |---|---|---|
   | INA228 / INA2xx Stromsensor | `0x40` | so lassen |
   | **PCA9685** Servo-Board | `0x40` | **mit INA am Bus: Lötbrücke A0 schließen → `0x41`** |
   | ADS1115 ADC | `0x48` | — |
   | MCP9808 Temperatur | `0x18` | — |
   | BME280 / BMP280 | `0x76` / `0x77` | — |

   Der PCA9685 antwortet außerdem auf **`0x70`** (seine All-Call-Adresse) — diese
   Adresse freihalten; ein I²C-Multiplexer (TCA9548A) kommt genau auf `0x70`.
   Ohne Stromsensor kann der PCA9685 auf `0x40` bleiben.
4. **Kamera:** Flachbandkabel in den **CAM**-Anschluss (nicht DISPLAY), Kontakte zur
   HDMI-Seite. Die offiziellen Pi-Kameras werden automatisch erkannt. Andere (Arducam
   IMX519, 64MP …) brauchen nach der Installation ihr Overlay: Setup › Camera ›
   *CSI camera module*, neu starten, dann den Installer noch einmal laufen lassen.

## 3. SD-Karte beschreiben (Raspberry Pi Imager)

1. **Raspberry Pi Imager** auf dem PC installieren: <https://www.raspberrypi.com/software/>.
2. **Gerät:** dein Pi-Modell.
3. **Betriebssystem:** *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**.
   „Lite" heißt ohne Desktop — der Pi läuft im Modell ohne Bildschirm.
   > Der Installer ist **auf Bookworm (Debian 12) getestet**. Das aktuelle Lite-Image im
   > Imager basiert auf **Trixie (Debian 13)**; das sollte funktionieren, ist auf einem
   > Fahrzeug aber noch nicht geprüft. Wer den getesteten Weg will, nimmt in derselben
   > Liste das **Legacy**-Lite-Image (Bookworm) — und wer Trixie nimmt: ein kurzer
   > Hinweis in einem Issue, ob es lief, hilft allen.
4. **Speicher:** deine SD-Karte. Alles darauf wird gelöscht.
5. **Betriebssystem anpassen** — der Imager fragt danach (Imager 2: die Anpassungs-Schritte
   im Assistenten; Imager 1.x: *Einstellungen bearbeiten*). Damit ist der Pi ohne
   Bildschirm erreichbar:
   - **Hostname:** `yonderrc`
   - **Benutzername und Passwort:** frei wählbar — aufschreiben. Diese Anleitung nimmt `pi`.
   - **WLAN:** Netzwerkname, Passwort und **WLAN-Land** (ohne Land lässt der Pi sein WLAN
     abgeschaltet).
   - **Sprache / Zeitzone:** deine.
   - **Fernzugriff / Dienste:** **SSH aktivieren**, mit Passwort-Anmeldung.
6. Karte schreiben, in den Pi stecken, einschalten. Der **erste Start dauert 2–5 Minuten**
   (er vergrößert das Dateisystem, übernimmt die Einstellungen und startet evtl. einmal neu).

### Ohne Anpassung im Imager (Plan B)

Schritt 5 übersprungen? Mit **Netzwerkkabel** (Ethernet) lässt sich der Pi trotzdem vom PC
aus vorbereiten: die SD-Karte zeigt ein Laufwerk, `bootfs`. Darauf zwei Dateien legen:

- eine leere Datei, die genau **`ssh`** heißt — ohne Endung. Windows blendet Endungen
  aus: einschalten (Explorer › Ansicht › *Dateinamenerweiterungen*) und prüfen, dass sie
  nicht `ssh.txt` heißt;
- eine Datei **`userconf.txt`** mit einer Zeile `benutzername:verschlüsseltes-passwort`.
  Das verschlüsselte Passwort liefert `echo 'deinpasswort' | openssl passwd -6 -stdin`
  (Linux, macOS oder die *Git Bash*, die bei Git für Windows dabei ist).

WLAN lässt sich so seit Raspberry Pi OS Bookworm nicht mehr setzen (`wpa_supplicant.conf`
wird nicht mehr gelesen) — für den ersten Start das Kabel nehmen, danach **Setup › Network
› WiFi** im Browser. (Trixie-Images lesen ihre Einstellungen aus den Dateien `user-data`
und `network-config` auf demselben Laufwerk — siehe
[den Hinweis von Raspberry Pi zu cloud-init](https://www.raspberrypi.com/news/cloud-init-on-raspberry-pi-os/).)
Ehrlich gesagt: den Imager noch einmal mit Anpassung laufen zu lassen geht schneller.

## 4. Den Pi im Netz finden

Warten, bis der erste Start durch ist (2–5 Minuten), dann am PC:

- **Windows:** Start → **PowerShell** tippen → Enter. **macOS:** Programme › Dienstprogramme
  › **Terminal**. **Linux:** dein Terminal.
- `ping yonderrc.local` eingeben und Enter. Kommen Antworten → der Pi ist da, ab jetzt
  `yonderrc.local` verwenden. (Ping mit **Strg+C** beenden.)
- Keine Antwort? Den Pi in der **Geräteliste des Routers** suchen (FritzBox: *Heimnetz ›
  Netzwerk*) — das Gerät `yonderrc` — und unten überall seine IP-Adresse
  (z. B. `192.168.178.42`) statt `yonderrc.local` nehmen.

## 5. Mit SSH anmelden

Im selben PowerShell-/Terminal-Fenster:

```bash
ssh pi@yonderrc.local
```

(`pi` = der Benutzername aus Schritt 3.)

- Beim ersten Mal kommt *„Are you sure you want to continue connecting?"* → `yes` tippen
  und Enter.
- Passwort eintippen. **Beim Tippen erscheint nichts — keine Punkte, keine Sterne. Das ist
  normal.** Enter.
- Du bist drin, wenn die Zeile `pi@yonderrc:~ $` lautet. Jeder Befehl läuft jetzt **auf dem Pi**.

Ein paar Grundlagen:

| | |
|---|---|
| `sudo …` | Befehl als Administrator ausführen (fragt evtl. nach deinem Passwort) |
| Einfügen | rechte Maustaste, oder **Strg+Umschalt+V** (Windows-Terminal: Strg+V) |
| **Strg+C** | laufenden Befehl abbrechen |
| `exit` | abmelden; der Pi läuft weiter |
| `sudo reboot` / `sudo poweroff` | neu starten / herunterfahren — nie einfach den Stecker ziehen, während er schreibt |

> **„REMOTE HOST IDENTIFICATION HAS CHANGED"** nach dem Neubespielen der Karte: der PC
> kennt noch den alten Pi. **Am PC** `ssh-keygen -R yonderrc.local` ausführen und neu anmelden.

## 6. YonderRC installieren

### Option A (empfohlen): eine Zeile, der Pi holt alles selbst

Der Pi braucht Internet (über dein WLAN hat er es). Ins SSH-Fenster einfügen:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

- Lädt YonderRC nach **`/opt/yonderrc`** und startet den Installer. Das dauert
  **10–30 Minuten** (ein Pi Zero 2 W länger); es läuft viel Text durch.
- Auf den Block **`-- hardware detection`** achten: er sagt, was gefunden und eingestellt
  wurde, z. B. `Output driver: PCA9685 at 0x41 → driver "pca9685"` und
  `Camera: CSI module imx708 → camera "cam"`. „staying on sim" heißt, es wurde nichts
  gefunden — Verkabelung und Adressen prüfen (Schritt 2).
- Am Ende steht **`== Done ==`** mit den Adressen der Setup-Seite.
- Verbindung zwischendurch abgerissen? Neu anmelden und dieselbe Zeile noch einmal
  ausführen — sie macht dort weiter, wo es steht.

### Option B: die Dateien selbst kopieren

Für einen Pi ohne Internet, oder eine eigene, veränderte Fassung.

1. Das Projekt auf den PC holen: auf GitHub **Code › Download ZIP**, entpacken. Es
   entsteht ein Ordner (z. B. `YonderRC-main`), in dem `package.json`, `packages`,
   `provisioning`, … **direkt** liegen — das ist der Ordner zum Kopieren.
2. Mit **WinSCP** (Windows) oder **FileZilla** auf den Pi kopieren: Protokoll **SFTP**,
   Host `yonderrc.local`, Port `22`, **dein normaler Benutzer** und Passwort — **nicht
   root**: die root-Anmeldung ist bei Raspberry Pi OS abgeschaltet und wird nicht
   gebraucht. Den Ordner in dein Home-Verzeichnis (`/home/pi`) legen. Einen Ordner
   `node_modules` weglassen, falls vorhanden.
3. Im SSH-Fenster den Installer von dort starten, wo er liegt:

   ```bash
   sudo bash ~/YonderRC-main/provisioning/install.sh
   ```

   Er verschiebt das Projekt selbst nach **`/opt/yonderrc`** (dort erwarten es die Dienste)
   und macht dort weiter. Gibt es `/opt/yonderrc` schon, sagt er genau, was zu tun ist.

> **`$'\r': command not found`** oder **`set: pipefail: invalid option`**: die Skripte
> haben unterwegs Windows-Zeilenenden bekommen (eine unter Windows bearbeitete oder
> ausgecheckte Kopie). Auf dem Pi beheben: `sed -i 's/\r$//' ~/YonderRC-main/provisioning/*.sh`
> — dann den Installer noch einmal starten.

## 7. Die Setup-Seite öffnen

Im Browser am PC oder Handy (im selben Netz):

- **Setup-Seite:** `http://yonderrc.local:8080/setup`
- **Steuer-App:** `http://yonderrc.local:8080/`

Auf **Overview** die ersten Zeilen prüfen:

- **Output driver** — `pca9685` heißt, das Servo-Board ist in Betrieb.
  `sim — nothing is wired to a servo` heißt Simulator. Roter Text ist ein Treiber, der
  nicht gestartet ist; die Zeile sagt warum. Beheben unter **Sensors & outputs**:
  *Detect hardware*, der *Install*-Knopf des nativen Moduls, *Restart vehicle service*.
- **Cameras** — eine Kamera vom Typ `rpicam` ist das Kameramodul; Typ `sim` ist das
  Testbild.

Dann, bevor das Fahrzeug die Werkbank verlässt: ein **Passwort für den Setup-Hotspot**
(Network › WiFi) und, in Netzen, denen du nicht ganz traust, ein **API-Secret**
(Network › Security).

> **Kein WLAN in Reichweite?** Dann öffnet der Pi seinen eigenen Hotspot
> **`YonderRC-setup`** — mit dem Handy beitreten und `http://192.168.4.1:8080/setup` öffnen.

## 8. Die erste Fahrt (Räder in der Luft!)

1. Die Steuer-App `http://yonderrc.local:8080/` öffnen und **Connect** drücken.
2. **Setup** (oben rechts) › ein Modell wählen oder anlegen (*+ New…*), die
   **Eingabemethode** wählen: Tastatur, Gamepad oder Touch.
3. **Gamecontroller:** anstecken oder per Bluetooth koppeln, dann **eine seiner Tasten
   drücken** — Browser zeigen einen Controller erst danach. *Setup › Controls › Game
   controller* listet alle Geräte und welches benutzt wird; dort deines auswählen, falls
   die automatische Wahl falsch ist. Das Koppeln eines PS4/PS5-Controllers ist dort
   erklärt.
4. Zurück zu **Drive**: folgt der Kanal-Monitor den Sticks? Dann **Arm 1 s halten**, und
   vorsichtig.

## 9. Später aktualisieren

**Setup › Overview › Software update**: *Check for updates*, dann *Update & restart*.
Meldet es, dass sich der Installer selbst geändert hat, ihn einmal per SSH laufen lassen:

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

## 10. Wenn etwas nicht funktioniert

Direkt danach eine **Diagnosedatei** erstellen — *Setup › Diagnostics* in der Steuer-App
(oder *Overview › Problem report* auf der Setup-Seite) — und an ein GitHub-Issue hängen.
Was drinsteht, wie man sie schickt, und die üblichen Ursachen für ein Fahrzeug, das in den
Failsafe flackert, oder einen Controller, der nichts tut:
[`TROUBLESHOOTING.de.md`](TROUBLESHOOTING.de.md).
