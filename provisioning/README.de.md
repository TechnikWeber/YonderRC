[English](README.md) · **Deutsch**

# YonderRC – Fahrzeug-Einrichtung (Raspberry Pi, ohne Bildschirm)

Alles in diesem Ordner läuft **auf dem Pi** — nichts davon ist für deinen PC gedacht. Es
macht aus einem Raspberry Pi ein YonderRC-Fahrzeug ohne Bildschirm: Steuerdienst,
go2rtc-Video, Hotspot zur Ersteinrichtung, Fernzugriff — eingerichtet vom Handy oder
Laptop über die Setup-Seite des Fahrzeugs.

- **Erstinstallation, Schritt für Schritt:** [`docs/QUICKSTART.de.md`](../docs/QUICKSTART.de.md)
- **Verkabelung, LTE, Tailscale, alles nach der Installation:** [`docs/HARDWARE.de.md`](../docs/HARDWARE.de.md)
- **Wenn etwas nicht funktioniert:** [`docs/TROUBLESHOOTING.de.md`](../docs/TROUBLESHOOTING.de.md)

Diese Seite beschreibt nur die Dateien selbst.

## 1. Die Dateien

| Datei | Was sie tut |
|---|---|
| `bootstrap.sh` | der Einzeiler: nach `/opt/yonderrc` klonen (oder aktualisieren), dann `install.sh` starten |
| `install.sh` | alles, was der Pi braucht — siehe §2; nach jedem Update erneut ausführbar |
| `diag.sh` | Diagnosedatei aus dem Terminal, wenn die Setup-Seite nicht erreichbar ist (§3) |
| `onboard.sh` | Hotspot-Rückfallebene beim Booten, gestartet von `yonderrc-onboard.service` |
| `systemd/` | `yonderrc-vehicle` (Steuerung, Setup-Seite und Video-Signalisierung, Port 8080), `go2rtc` (Video; API und RTSP antworten nur auf dem Pi, WebRTC-Medien über 8555), `yonderrc-onboard` |
| `tuning/` | Kamera-Tuning-Dateien (Autofokus der Arducam IMX519), kopiert nach `/var/lib/yonderrc/tuning` |
| `yonderrc.sudoers` | nur für den Betrieb des Dienstes als Nicht-root-Benutzer (§4) |

## 2. Was install.sh tut

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

1. Prüft, dass es als root läuft und das Projekt in `/opt/yonderrc` liegt. Eine Kopie an
   anderer Stelle wird dorthin verschoben, wenn `/opt/yonderrc` noch nicht existiert;
   sonst sagt es, was zu tun ist.
2. Installiert die Pakete (ffmpeg, NetworkManager, ModemManager, WireGuard, OpenVPN,
   i2c-tools, gpsd, iw), Node 22, Tailscale, ZeroTier und go2rtc.
3. `npm install` ohne die nativen Treibermodule, danach die, die dieses Fahrzeug vermerkt
   hat (`hardwareDeps` in der Config) — ein Update macht aus einem eingerichteten
   Fahrzeug nie wieder einen Simulator. Baut die Steuer-App.
4. Aktiviert I²C und die UART und nimmt die Login-Konsole von der UART (für ein
   verkabeltes GPS).
5. Schaltet das **WLAN-Energiesparen ab** — es verzögert eingehende Pakete und löst den
   Failsafe-Watchdog auf einem funktionierenden Link aus.
6. **Hardware-Erkennung** (`npm run first-run -w @yonderrc/vehicle`): ein PCA9685 an Bus 1
   wird zum Ausgabetreiber und `i2c-bus` wird gebaut, eine CSI-Kamera ersetzt das
   Testbild. Nur Einstellungen, die **nie gespeichert** wurden, werden ausgefüllt;
   Sensoren werden genannt, nicht eingerichtet. Die Hardware **vor** der Installation
   anschließen und adressieren (ein PCA9685 neben einem INA2xx auf `0x41`).
7. Verschiebt die erzeugte Video-Config nach `/var/lib/yonderrc`, installiert die drei
   Dienste und startet sie (neu).

Die Config liegt in `/opt/yonderrc/yonderrc-config.json` (`YRC_CONFIG` überschreibt das).

## 3. diag.sh

```bash
sudo bash /opt/yonderrc/provisioning/diag.sh
```

Schreibt eine Textdatei in das Home-Verzeichnis des Benutzers, der es gestartet hat:
Versionen, Zustand der Dienste, den Diagnosebericht des Fahrzeugs selbst (wenn der Dienst
antwortet), die gespeicherte Config, Netzwerk, Journale und Kernel-Meldungen. Passwörter,
Schlüssel, das API-Secret und GPS-Positionen werden maskiert. Wie man sie vom Pi holt und
schickt: [`docs/TROUBLESHOOTING.de.md` §1](../docs/TROUBLESHOOTING.de.md#1-ein-problem-melden-die-diagnosedatei).

## 4. Betrieb als Nicht-root-Benutzer (optionale Härtung)

Die mitgelieferte `yonderrc-vehicle.service` läuft als **`User=root`** (pigpio braucht
root für DMA-PWM). Läuft sie stattdessen als **Nicht-root-Benutzer**, brauchen die
privilegierten Helfer des Fahrzeugs — SIM-PIN entsperren (`mmcli`), WireGuard
(`wg`/`wg-quick`), ZeroTier (`zerotier-cli`), OpenVPN (`systemctl … openvpn-client@yonderrc`),
das Ablegen der WireGuard-Conf und des OpenVPN-Profils (`install`) und der Reboot-Knopf —
sudo ohne Passwort. Der Diagnose-Export liest außerdem das Journal, dafür braucht es die
Gruppe `systemd-journal`. Eine fertige, minimale Regel liegt in
[`yonderrc.sudoers`](yonderrc.sudoers):

```bash
sudo cp /opt/yonderrc/provisioning/yonderrc.sudoers /etc/sudoers.d/yonderrc
# "yonderrc" durch deinen Dienst-Benutzer ersetzen, falls anders:
sudo sed -i 's/^yonderrc /DEINBENUTZER /' /etc/sudoers.d/yonderrc
sudo chmod 0440 /etc/sudoers.d/yonderrc
sudo visudo -cf /etc/sudoers.d/yonderrc      # muss ": parsed OK" ausgeben
```

Sie erlaubt NOPASSWD nur für genau diese Befehle. NetworkManager (`nmcli`) ist bewusst
nicht enthalten — das dem Benutzer per polkit oder über die Gruppe `netdev` geben. Läuft
der Dienst als root (Standard), wird die Datei nicht gebraucht. Der Sicherheitshinweis zu
`install` steht im Kopf der Datei.

## 5. Ein fertiges Image bauen (optional)

Für viele Fahrzeuge das Obige mit [`rpi-image-gen`](https://github.com/RPi-Distro/rpi-image-gen)
oder `pi-gen` in ein `.img` backen: das Repo nach `/opt/yonderrc` legen und `install.sh`
in einer Customization-Stage ausführen. Die Hardware-Erkennung findet dann nichts (das
Image entsteht ohne das Fahrzeug) — auf dem Fahrzeug `install.sh` noch einmal laufen
lassen, oder Treiber und Kamera auf der Setup-Seite wählen. Für ein einzelnes Fahrzeug ist
der Weg „flashen, dann `install.sh`" am einfachsten.
