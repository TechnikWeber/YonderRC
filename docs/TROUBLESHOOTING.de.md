[English](TROUBLESHOOTING.md) · **Deutsch**

# YonderRC — Fehlersuche und Probleme melden

Kurz: wenn etwas schiefgeht, **sofort eine Diagnosedatei erstellen und an ein
GitHub-Issue hängen.** Sie enthält alles, was zum Finden der Ursache nötig ist — und
nennt die Ursache oft selbst, bevor irgendwer nachsehen muss.

---

## 1. Ein Problem melden: die Diagnosedatei

### 1.1 Welche Datei, wo erstellt

| Situation | Wo | Was du bekommst |
|---|---|---|
| **Normalfall** — die Steuer-App verbindet sich | Steuer-App › **Setup › Diagnostics › Download diagnostics** | eine `.json` mit **beiden Hälften**: dieser App und dem Fahrzeug |
| Die Steuer-App verbindet nicht, die Setup-Seite öffnet sich | Setup-Seite › **Overview › Problem report › Download diagnostics** | eine `.json` mit der Hälfte des Fahrzeugs |
| Nicht einmal die Setup-Seite öffnet sich (Dienst läuft nicht) | SSH: `sudo bash /opt/yonderrc/provisioning/diag.sh` | eine `.txt` in deinem Home-Verzeichnis auf dem Pi |

**Direkt nach dem Problem erstellen**, ohne zwischendurch etwas neu zu starten: das
Fahrzeug zählt seine Link-Statistik seit dem Start des Dienstes, die App seit dem Laden
der Seite. Ein Neustart löscht die Spuren.

Die `.txt` von `diag.sh` muss vom Pi herunter: in einem Terminal **auf dem PC**
`scp pi@yonderrc.local:yonderrc-diagnostics-*.txt .` — oder mit WinSCP/FileZilla (SFTP),
wie in [`QUICKSTART.de.md` §6](QUICKSTART.de.md#option-b-die-dateien-selbst-kopieren).

### 1.2 Was drinsteht — und was nicht

**Drin:**

- **Beide Seiten des Steuerlinks.** Die App zeichnet auf, wie regelmäßig ihre
  50-Hz-Steuerschleife wirklich gesendet hat und ob die Seite verdeckt war; das Fahrzeug
  zeichnet die Lücken zwischen den empfangenen Frames und jede Failsafe-Episode auf.
  Nebeneinander sagen sie, ob ein Failsafe vom Netz, von der App oder vom Fahrzeug selbst
  kam.
- Version, Einstellungen und Log des Fahrzeugs, WLAN- und Stromversorgungs-Zustand,
  Temperatur, Last und Speicher, was das Betriebssystem zu Netz und Diensten sagt,
  Journal-Auszüge.
- Browser und Gerät, die Controller, die der Browser sieht, und welcher benutzt wird, das
  aktive Modell.
- **Befunde** (`findings`): Aussagen in Klartext, was die Zahlen bedeuten — oben in der
  Datei und gleich nach dem Download auf der Seite angezeigt.

**Nicht drin:** Passwörter, PINs, VPN-Schlüssel und das Schlüsselmaterial von Profilen,
das API-Secret, ein offener Tailscale-Login-Link, die GPS-Position und der Home-Punkt. Sie
werden vor dem Schreiben der Datei entfernt.

**Trotzdem drin:** Netzwerknamen (SSIDs) und lokale IP-Adressen — damit findet man
Netzwerkprobleme. Wenn das für ein öffentliches Issue zu viel ist: siehe 1.3.

### 1.3 Wie du sie schickst

1. <https://github.com/TechnikWeber/YonderRC/issues/new> öffnen (ein kostenloses
   GitHub-Konto ist nötig) und **Bug report** wählen.
2. In ein paar Zeilen beschreiben: was du getan hast, was passiert ist, was du erwartet
   hast; Pi-Modell, wie die Bodenstation verbunden ist (Heim-WLAN, Hotspot des Fahrzeugs,
   LTE + VPN), Browser.
3. **Die Datei ins Textfeld ziehen** — GitHub nimmt `.json` und `.txt` direkt an.

Die Datei lieber nicht öffentlich posten? Das Issue ohne sie eröffnen und nach einem
privaten Weg fragen.

### 1.4 Selbst hineinschauen

Die `.json` im Browser oder Editor öffnen. Die **`findings`** oben sind die
Zusammenfassung; `vehicle.link` enthält das Lücken-Histogramm und die Failsafe-Episoden
(`failsafe.recent`), `ground.sendLoop` die eigenen Pausen der App (`recentStalls`, mit
`hidden: true`, wenn die Seite im Hintergrund war).

## 2. Das Fahrzeug flackert in den Failsafe und wieder heraus

**Was passiert:** das Fahrzeug setzt jeden Kanal auf seinen Failsafe-Wert, wenn es länger
als seinen **Watchdog** keinen Steuer-Frame bekommen hat (seit v1.70.0 standardmäßig
500 ms, vorher 300 ms). Das Feld **Link gaps** in der Statusleiste zählt diese Episoden und
zeigt die längste Wartezeit. Auch ein Link, der *funktioniert*, kann ihn auslösen, wenn die
Frames schubweise ankommen.

| Ursache | Woran man es erkennt | Was hilft |
|---|---|---|
| **Die Steuerseite war verdeckt oder ausgelastet** — anderer Tab vorne, Fenster minimiert, Handy-Bildschirm aus, langsames Handy | Diagnose: „control loop paused …", Ereignisse `page: hidden` | Die Steuerseite vorne und den Bildschirm an lassen. Browser bremsen Timer im Hintergrund absichtlich — das Fahrzeug hält dann an, und das ist richtig. |
| **WLAN-Energiesparen am Pi** | Diagnose: „WiFi power saving is on"; am Pi: `iw dev wlan0 get power_save` | `sudo iw dev wlan0 set power_save off`; der Installer (ab v1.70.0) schaltet es dauerhaft ab — einmal laufen lassen. |
| **Schwaches WLAN** | OSD/Diagnose: Signal unter etwa −70 dBm | Näherer Access Point, der Hotspot des Fahrzeugs, oder LTE. |
| **Die Versorgung bricht ein** | ⚠ POWER im OSD, „under-voltage" in der Diagnose | 5,1 V / 3 A oder mehr, kurzes dickes Kabel, Servos nie vom Pi versorgen ([HARDWARE.de.md 2.3](HARDWARE.de.md#23-stromversorgung)). |
| **LTE-Jitter** | Lücken von 300–1000 ms bei 0 % Verlust | Den Watchdog (unten) auf 700–1000 ms erhöhen; *Control via WebRTC data channel* in der Steuer-App ausprobieren. |
| **Das Fahrzeug selbst ist ausgelastet** | Diagnose: „the vehicle service itself stalls", hohe Last oder Temperatur | Video-Auflösung oder -Qualität senken; Kühlung. |

**Den Watchdog ändern:** Setup-Seite › **Sensors & outputs › Watchdog (ms)**, 100–2000,
wirkt beim *Save* ohne Neustart. Kürzer hält nach einem echten Verlust schneller an; zu
kurz löst bei gewöhnlichem Jitter aus. Die Failsafe-*Werte* pro Kanal werden pro Modell in
der Steuer-App eingestellt.

## 3. Der Gamecontroller tut nichts

- **Eine Taste daran drücken.** Ein Browser zeigt einer Seite einen Controller erst, nachdem
  eine seiner Tasten gedrückt wurde, während die Seite den Fokus hatte.
- **Setup › Controls › Game controller** listet jedes Gerät, das der Browser sieht, welches
  benutzt wird, und zeigt einen Punkt, solange ein Gerät Eingaben sendet. Dort deines
  wählen, falls die automatische Wahl falsch ist — ein Headset oder ein
  „Motion Sensors"-Gerät wird nie automatisch gewählt, aber gelistet.
- **„Own layout"** heißt, der Browser bildet das Gerät nicht auf das Standard-Layout ab: die
  Stick-Achsen können anders nummeriert sein. Im Kanal-Editor **Learn** benutzen und den
  Stick bewegen. Ein Trigger, der bei −1 ruht, wird nicht mehr versehentlich „gelernt".
- **PS4 / PS5:** per USB geht es sofort. Bluetooth: **Share + PS** (PS5: **Create + PS**)
  halten, bis die Lichtleiste blinkt, dann in den Bluetooth-Einstellungen des Systems
  koppeln. In Chrome und Edge hat er dann das Standard-Layout. **DS4Windows** versteckt den
  echten Controller und bietet ein emuliertes Xbox-Pad an — das wählen, oder das Tool
  schließen. **Steam** kann den Controller belegen, solange es läuft — schließen, wenn der
  Controller hier keine Eingaben zeigt.
- Die **Eingabemethode** des Modells muss *gamepad* sein: Setup › Modell › Input method.

## 4. Die Servos bewegen sich nicht

- Setup-Seite › **Overview › Output driver**: `sim` heißt, kein Hardware-Treiber ist
  gewählt; roter Text heißt, einer ist nicht gestartet, mit Grund.
- Die üblichen Gründe: das native Modul fehlt (*Sensors & outputs › Native driver modules ›
  Install* `i2c-bus`), oder die I²C-Adresse stimmt nicht (*Detect hardware*, dann das
  Adressfeld des PCA9685). Danach **Restart vehicle service**.
- Immer noch nichts: `sudo i2cdetect -y 1` per SSH muss die Adresse des PCA9685 zeigen
  (z. B. `41`) und `70`. Fehlt sie, ist es Verkabelung oder Strom; zwei Chips auf einer
  Adresse liefern Müll ([QUICKSTART.de.md §2](QUICKSTART.de.md)).
- Der Servo-Strom (V+) am PCA9685 kommt von einem BEC, nicht vom Pi, und alle Massen sind
  verbunden.

## 5. Probleme bei der Installation

| Meldung | Bedeutung und Abhilfe |
|---|---|
| `$'\r': command not found`, `set: pipefail: invalid option` | Die Skripte haben Windows-Zeilenenden. Auf dem Pi: `sed -i 's/\r$//' /opt/yonderrc/provisioning/*.sh`, noch einmal starten. |
| `Run it with sudo` | `sudo bash /opt/yonderrc/provisioning/install.sh` |
| `… YonderRC lives in /opt/yonderrc — and that folder already has content` | Zwei Kopien. Die in `/opt/yonderrc` installieren, oder deine mit dem angezeigten Befehl darüberkopieren (die Einstellungen des Fahrzeugs bleiben). |
| `does not look like the YonderRC project` | Der Ordner wurde eine Ebene zu tief kopiert (z. B. `YonderRC-main/YonderRC-main`). Den Ordner kopieren, in dem `package.json` liegt. |
| `curl: (6) Could not resolve host` | Kein Internet am Pi. WLAN im Imager gesetzt? Sonst Ethernet, oder die Dateien kopieren (QUICKSTART Option B). |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` (SSH) | Nach dem Neubespielen: am PC `ssh-keygen -R yonderrc.local`. |
| Zertifikatsfehler beim Update | Die Uhr des Pi stimmt nicht (er hat keine gepufferte Uhr). Ihm Internet geben; die Setup-Seite zeigt die Uhr neben dem Update-Knopf. |

Weitere Symptome — kein Video, LTE, GPS, das Datenbudget — stehen in
[`HARDWARE.de.md` §7](HARDWARE.de.md#7-schnelle-fehlersuche).
