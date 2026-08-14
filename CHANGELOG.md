# Changelog

All notable changes to YonderRC. Each release is the full project; every zip is
self-contained. Entries from v1.17.0 on are bilingual (English / Deutsch).

## v1.29.0
**English**
- **The arm hold now covers the bound key and controller button too.** Until now the
  2 s hold only applied to the on-screen arm button; a key or gamepad button bound to
  *Arm / disarm* fired on the press, which is the input most likely to be bumped by
  accident. It now needs the same sustained press, and releasing early cancels.
- **The arm button shows that hold**: holding the bound key fills the same bar and runs
  the same countdown, so there is visible feedback wherever you're looking.
- Switching the protection off in Setup › Controls disables it for **both** paths, and
  **panic-disarm stays instant** either way. Losing window focus mid-hold cancels, so a
  key can't stay "held" while you're in another tab.

**Deutsch**
- **Das Arm-Halten gilt jetzt auch für die belegte Taste und den Controller-Button.**
  Bisher galten die 2 s nur für den Arm-Button auf dem Bildschirm; eine auf
  *Arm / disarm* gelegte Taste oder Gamepad-Taste löste beim Drücken aus — ausgerechnet
  die Eingabe, die man am ehesten aus Versehen anstößt. Jetzt braucht sie dasselbe
  Halten, und früher loslassen bricht ab.
- **Der Arm-Button zeigt dieses Halten mit an**: die belegte Taste füllt denselben
  Balken und lässt denselben Countdown laufen — sichtbares Feedback, egal wohin man
  gerade schaut.
- Der Aus-Schalter in Setup › Controls schaltet **beide** Wege ab, und **Panic-Disarm
  bleibt in jedem Fall sofort**. Verliert das Fenster den Fokus, bricht das Halten ab —
  eine Taste kann also nicht „gedrückt bleiben", während man in einem anderen Tab ist.

## v1.28.0
**English**
- **Hold-to-arm is now configurable** in Setup › Controls: a switch to turn the
  protection off entirely and an adjustable **hold time** (0.5–10 s), stored per browser.
- **The default hold is now 2 s** instead of 3 — long enough that no pocket-touch gets
  through, short enough that arming doesn't feel like a ceremony. Switched off, the arm
  button toggles on a plain tap again and says so ("DISARMED — tap to arm").
- **Panic-disarm stays instant** in every configuration, and the pre-arm check is
  unaffected.

**Deutsch**
- **Halten zum Armen ist jetzt einstellbar** unter Setup › Controls: ein Schalter, um den
  Schutz ganz abzuschalten, und eine einstellbare **Haltezeit** (0,5–10 s), pro Browser
  gespeichert.
- **Die Vorgabe sind jetzt 2 s** statt 3 — lang genug, dass kein Griff in die Hosentasche
  durchkommt, kurz genug, dass Armen keine Zeremonie wird. Abgeschaltet reagiert der
  Arm-Button wieder auf einfaches Antippen und sagt das auch („DISARMED — tap to arm").
- **Panic-Disarm bleibt in jeder Konfiguration sofort**, der Pre-Arm-Check bleibt
  unberührt.

## v1.27.1
**English**
- **The setup hotspot can now stay up next to LTE.** New *when to start it* setting in
  Setup › WiFi: **auto** (default, unchanged — only when the Pi has no uplink at boot),
  **always** (also next to a working LTE link, so you can always walk up to the vehicle
  for diagnostics) and **off**. Plus a **Stop hotspot** button.
- A WiFi *client* connection always wins over `always`: one radio can't serve an access
  point and stay joined to a network, and dropping the WiFi link would cut the vehicle
  off your LAN. The onboarding checks that before starting anything and says so in the
  log.
- Documented what actually closes the hotspot: joining a network, *Stop hotspot*, or a
  reboot with an uplink in `auto` mode — a remote service (Tailscale/ZeroTier/WireGuard)
  or LTE does **not**, those ride on other interfaces.

**Deutsch**
- **Der Setup-Hotspot kann jetzt neben LTE oben bleiben.** Neue Einstellung *when to
  start it* in Setup › WiFi: **auto** (Standard, unverändert — nur wenn der Pi beim
  Booten keinen Uplink hat), **always** (auch neben laufendem LTE, damit du fürs
  Diagnostizieren immer ans Fahrzeug herankommst) und **off**. Dazu ein Button
  **Stop hotspot**.
- Eine WLAN-*Client*-Verbindung schlägt `always` immer: eine Funkeinheit kann nicht
  gleichzeitig Access Point sein und in einem Netz hängen, und den WLAN-Link abzureißen
  würde das Fahrzeug aus dem LAN werfen. Das Onboarding prüft das vorher und schreibt es
  ins Log.
- Dokumentiert, was den Hotspot tatsächlich schließt: einem Netz beitreten, *Stop
  hotspot*, oder ein Neustart mit Uplink im Modus `auto` — ein Remote-Dienst
  (Tailscale/ZeroTier/WireGuard) oder LTE **nicht**, die laufen über andere Interfaces.

## v1.27.0
**English**
- **Wi-Fi onboarding from the phone.** New **Setup › WiFi** panel: scan for networks
  (SSID, signal, lock state), pick one, enter the password, connect. The Pi has a single
  radio, so joining your network closes the setup hotspot — the page stops responding,
  which is the expected sign it worked. **If the password was wrong the vehicle restarts
  the hotspot**, so it can't lock itself out.
- **The onboarding hotspot is now open by default.** The captive portal can then put the
  setup page in front of you with nothing to type; a default password published in a
  public README protected nothing anyway. **Set an SSID and a password** (min. 8
  characters, WPA2) in the same panel — *Save* applies at the next hotspot start,
  *Save & start now* restarts it immediately.
- **Generate button for the API secret**: 20 random characters from a confusable-free
  alphabet, shown once so you can copy it, then applied to the vehicle.
- **The status header no longer claims "Tailscale"** when another method is configured.
  The row is now **Remote access** and shows the selected method with its state
  (`ZeroTier · up (joined …)`, `WireGuard · down`, `none`).

**Deutsch**
- **WLAN-Einrichtung vom Handy.** Neues Panel **Setup › WiFi**: Netze scannen (SSID,
  Signal, verschlüsselt ja/nein), auswählen, Passwort eingeben, verbinden. Der Pi hat
  nur eine Funkeinheit — das Verbinden schließt also den Setup-Hotspot, die Seite
  antwortet nicht mehr, und genau das ist das erwartete Zeichen. **War das Passwort
  falsch, fährt das Fahrzeug den Hotspot wieder hoch**, es sperrt sich also nicht aus.
- **Der Onboarding-Hotspot ist jetzt standardmäßig offen.** So stellt das Captive Portal
  die Setup-Seite ohne Tipparbeit vor dich; ein in einem öffentlichen README
  dokumentiertes Standardpasswort hat ohnehin nichts geschützt. **SSID und Passwort**
  (mind. 8 Zeichen, WPA2) lassen sich im selben Panel setzen — *Save* wirkt beim
  nächsten Hotspot-Start, *Save & start now* startet ihn sofort neu.
- **Generieren-Button für das API-Secret**: 20 Zufallszeichen aus einem Alphabet ohne
  verwechselbare Zeichen, einmal sichtbar zum Kopieren, dann ans Fahrzeug übernommen.
- **Die Statuszeile behauptet nicht mehr „Tailscale"**, wenn eine andere Methode
  konfiguriert ist. Die Zeile heißt jetzt **Remote access** und zeigt die gewählte
  Methode mit ihrem Zustand (`ZeroTier · up (joined …)`, `WireGuard · down`, `none`).

## v1.26.0
**English**
- **Auto-disarm on reconnect is now selectable** in Setup › Controls: **Auto** (default,
  follows the vehicle type — on for car/boat, off for plane/drone), **Always on** or
  **Always off**. The choice is pushed to the vehicle immediately, not only on the next
  connect, and forcing it against the type policy shows a warning saying what that means
  in the air or on the ground.
- **Fixed the stretched OSD badges (top left).** The left-hand OSD columns had no
  alignment, so the flex default stretched every badge to the width of the widest one —
  the session timer and the GPS badge carried a blank tail. Same class of bug as the
  LINK badge in v1.22.0, now fixed for both left columns.

**Deutsch**
- **Auto-Disarm bei Reconnect ist jetzt wählbar** unter Setup › Controls: **Auto**
  (Standard, folgt dem Fahrzeugtyp — an für Auto/Boot, aus für Flugzeug/Drohne),
  **immer an** oder **immer aus**. Die Wahl geht sofort ans Fahrzeug, nicht erst beim
  nächsten Verbinden; wer gegen die Typregel erzwingt, bekommt einen Warnhinweis, was
  das in der Luft bzw. am Boden bedeutet.
- **Verzerrte OSD-Badges oben links behoben.** Den linken OSD-Spalten fehlte die
  Ausrichtung, dadurch streckte der Flex-Default jedes Badge auf die Breite des
  breitesten — Session-Timer und GPS-Badge hatten einen leeren Fortsatz. Dieselbe
  Fehlerklasse wie beim LINK-Badge in v1.22.0, jetzt für beide linken Spalten behoben.

## v1.25.0
**English**
- **The blackbox CSV now holds every telemetry channel.** Next to the fixed link/video
  columns it gets **one column per configured channel**, named after its label
  (`Pack_V`, `BEC_V`, `I1_A`, `Motor_C`), so temperatures and extra voltages/currents
  finally land in the log. `volt`/`amp` stay as the **primary** channel so a script
  always finds the pack in a known place. Columns are the union over the whole log, so
  a probe that drops out mid-run leaves a gap instead of shifting everything.
- **"Flight" is now "Session"** in the status strip and the OSD field list — the same
  app drives cars and boats, and the timer measures armed time, not flight.
- **Docs pass** for everything since v1.21.1: hold-to-arm in the safety chapter and the
  first-test steps (both languages), per-value OSD switches, the temperature-sensor and
  INA228 additions in the feature list, the new CSV columns, and a refreshed
  touch/status screenshot showing the hold-to-arm button and the Session stat.

**Deutsch**
- **Die Blackbox-CSV enthält jetzt jeden Telemetriekanal.** Neben den festen Link-/
  Video-Spalten gibt es **je eine Spalte pro konfiguriertem Kanal**, benannt nach dessen
  Label (`Pack_V`, `BEC_V`, `I1_A`, `Motor_C`) — Temperaturen und zusätzliche
  Spannungen/Ströme landen also endlich im Log. `volt`/`amp` bleiben der **primäre**
  Kanal, damit ein Skript den Pack immer an derselben Stelle findet. Die Spalten sind
  die Vereinigung über das ganze Log: ein zeitweise ausfallender Sensor hinterlässt eine
  Lücke, statt alles zu verschieben.
- **Aus „Flight" wird „Session"** in der Status-Leiste und der OSD-Feldliste — dieselbe
  App fährt Autos und Boote, und der Timer misst die gearmte Zeit, keinen Flug.
- **Doku-Durchgang** für alles seit v1.21.1: Halten-zum-Armen im Sicherheitskapitel und
  in den Erst-Test-Schritten (beide Sprachen), die Einzelschalter im OSD, Temperatur-
  sensoren und INA228 in der Feature-Liste, die neuen CSV-Spalten sowie ein
  aufgefrischter Touch-/Status-Screenshot mit Halten-zum-Armen und Session-Anzeige.

## v1.24.0
**English**
- **Temperature sensors, 1..n.** New temperature channels in Setup › Telemetry, shown in
  the OSD under voltage and current: **Raspberry Pi SoC**, **DS18B20** (1-Wire),
  **MCP9808 / TMP102 / TMP117 / BMP280 / BME280** (I²C), **MAX6675 / MAX31855 / MAX31856**
  thermocouples and **MAX31865** PT100/PT1000 (SPI), plus an **NTC or PT100 on an
  ADS1115 / MCP3008**. Each kind shows only the fields it needs (address, chip-select,
  thermocouple type, probe, series resistor, R25/beta, offset). A sensor that can't be
  read is left out of the OSD instead of appearing as 0 °C, and is logged once.
- **Every telemetry value can now be hidden individually** — FPV › ⚙ › *Sensor values*
  lists every channel the vehicle reports, per browser, so a phone can show less than
  the laptop. New channels are visible by default.
- **Labels in the OSD**: as soon as a kind has more than one channel, its label is shown
  in front of the value (`Pack 16.6 V · BEC 5.1 V`, `Motor 62 °C`). With a single channel
  nothing changes. New channels default to short labels (`U2`, `I2`, `T1`).
- **Explicit primary channel.** Battery %, mAh/Wh counting, the low-battery warning and
  the blackbox used to read *whichever channel happened to be first*, so deleting or
  inserting a channel silently moved the battery maths. A **primary** radio (Setup ›
  Telemetry, shown once a kind has two channels) now marks it; without a flag the first
  channel wins, so existing configs are unchanged. The vehicle reports the index, so the
  ground warns on the same voltage it counted with.

**Deutsch**
- **Temperatursensoren, 1..n.** Neue Temperaturkanäle in Setup › Telemetry, im OSD
  unterhalb von Spannung und Strom: **Raspberry-Pi-SoC**, **DS18B20** (1-Wire),
  **MCP9808 / TMP102 / TMP117 / BMP280 / BME280** (I²C), Thermoelemente über
  **MAX6675 / MAX31855 / MAX31856** und PT100/PT1000 über **MAX31865** (SPI) sowie
  **NTC oder PT100 an ADS1115 / MCP3008**. Jede Art zeigt nur die Felder, die sie
  braucht (Adresse, Chip-Select, Thermoelement-Typ, Sonde, Vorwiderstand, R25/Beta,
  Offset). Ein Sensor, der sich nicht lesen lässt, fehlt im OSD, statt als 0 °C
  aufzutauchen — und wird einmalig geloggt.
- **Jeder Telemetriewert ist jetzt einzeln ausblendbar** — FPV › ⚙ › *Sensor values*
  listet jeden Kanal, den das Fahrzeug meldet, pro Browser gespeichert; am Handy also
  weniger als am Laptop. Neue Kanäle sind standardmäßig sichtbar.
- **Kürzel im OSD**: sobald eine Art mehr als einen Kanal hat, steht das Label vor dem
  Wert (`Pack 16.6 V · BEC 5.1 V`, `Motor 62 °C`). Bei einem einzelnen Kanal ändert sich
  nichts. Neue Kanäle heißen per Default kurz (`U2`, `I2`, `T1`).
- **Expliziter Primärkanal.** Akku-%, mAh/Wh-Zählung, Akku-Warnung und Blackbox haben
  bisher schlicht den *ersten* Kanal gelesen — Löschen oder Einfügen verschob die
  Akkurechnung also unbemerkt. Ein **primary**-Radio (Setup › Telemetry, erscheint ab
  zwei Kanälen einer Art) markiert ihn jetzt; ohne Flag gewinnt weiterhin der erste
  Kanal, bestehende Configs bleiben unverändert. Das Fahrzeug meldet den Index mit,
  damit der Ground auf derselben Spannung warnt, mit der gezählt wurde.

## v1.23.0
**English**
- **INA228 support — the sensor counts the charge itself.** The INA228 integrates
  CHARGE (coulombs) and ENERGY (joules) in hardware at ADC rate, so the vehicle reads
  two registers instead of summing samples: the consumed mAh no longer depend on the
  polling rate, and a sample the loop missed can't quietly go uncounted. 85 V bus
  range (up to 12S) and 20-bit resolution on top. New **Charge counter** setting
  (`auto` / `sensor` / `pi`); `auto` uses the chip when it has a counter and the Pi
  otherwise, and **Reset mAh** now also clears the chip's registers (RSTACC).
- **INA237 / INA238 support** — the same 85 V family and register map, 16-bit and
  without the accumulators, so the Pi keeps integrating for them. Complete coverage:
  INA219/226/228/237/238/260/3221.
- New per-channel fields for these three: **Max current A** (sets CURRENT_LSB and with
  it SHUNT_CAL, written at init) and the **shunt range** (±163.84 mV / ±40.96 mV, 4×
  resolution), with a warning when max current × shunt doesn't fit the low range.
  Current is read from VSHUNT, so it stays correct even if the calibration write
  didn't land.
- **Recommendation in the hardware guide is now the INA228** (parts list, wiring 2.2,
  setup step 3), with a comparison table of all seven supported sensors — INA226
  remains the choice up to 36 V.
- **Fixed:** saving telemetry updated the file and the running service but not the
  in-memory config, so reloading the setup page showed the pre-save values again.
- Detection hints for I²C addresses now name the whole INA2xx family.

**Deutsch**
- **INA228 unterstützt — der Sensor zählt die Ladung selbst.** Der INA228 integriert
  CHARGE (Coulomb) und ENERGY (Joule) in Hardware mit der ADC-Rate; das Fahrzeug liest
  nur noch zwei Register, statt Messwerte aufzusummieren: die verbrauchten mAh hängen
  nicht mehr an der Abtastrate, und eine ausgefallene Messung fehlt nicht mehr still in
  der Bilanz. Dazu 85 V Busbereich (bis 12S) und 20 Bit Auflösung. Neue Einstellung
  **Charge counter** (`auto` / `sensor` / `pi`); `auto` nimmt den Chip, wenn er einen
  Zähler hat, sonst den Pi. **Reset mAh** löscht jetzt auch die Chip-Register (RSTACC).
- **INA237 / INA238 unterstützt** — dieselbe 85-V-Familie und Registerkarte, 16 Bit und
  ohne Akkumulatoren, für sie integriert weiterhin der Pi. Damit ist die Abdeckung
  komplett: INA219/226/228/237/238/260/3221.
- Neue Felder pro Kanal für diese drei: **Max current A** (bestimmt CURRENT_LSB und
  damit SHUNT_CAL, wird beim Start geschrieben) und der **Shunt-Bereich** (±163,84 mV /
  ±40,96 mV, 4× Auflösung), mit Warnung, wenn max. Strom × Shunt nicht in den kleinen
  Bereich passt. Der Strom kommt aus VSHUNT und stimmt daher auch dann, wenn die
  Kalibrierung nicht geschrieben werden konnte.
- **Empfehlung im Hardware-Guide ist jetzt der INA228** (Teileliste, Verkabelung 2.2,
  Setup-Schritt 3), mit Vergleichstabelle aller sieben unterstützten Sensoren — der
  INA226 bleibt die Wahl bis 36 V.
- **Behoben:** Telemetrie-Speichern aktualisierte Datei und laufenden Dienst, aber
  nicht die Config im Speicher — nach einem Reload zeigte die Setup-Seite wieder die
  alten Werte.
- Die Erkennungs-Hinweise zu I²C-Adressen nennen jetzt die ganze INA2xx-Familie.

## v1.22.0
**English**
- **Hold-to-arm (3 s)**: the arm button no longer toggles on a tap. Press and hold it
  for 3 seconds — the button fills up and counts down ("ARMING IN 1.6 s") — and the
  same hold is required to *disarm*, which is the accidental touch that actually hurts.
  Releasing early cancels; losing the link mid-hold cancels too. Works with a finger,
  the mouse and Space/Enter, with a short haptic buzz on phones that support it.
  **Panic-disarm (Setup › Controls) stays instant** — that's the emergency path.
- **OSD shows only DISARMED / FAILSAFE**, never ARMED. Armed is the normal case and is
  already obvious from the flight timer and the channel bars, so the badge is dropped —
  one element less over the picture on a phone.
- **Fixed the stretched OSD badge**: the top-centre strip inherited `flex-direction:
  column` from `.osd > div`, so LINK and DISARMED were stacked *and* the shorter badge
  was stretched to the wider one — the blank tail behind "LINK" that vanished as soon
  as you armed. Both centre strips are proper rows again.
- **More room between the touch joysticks** (gap 18px → up to 64px, scaled with the
  viewport): easier two-thumb control on a phone, in every stick mode, and still no
  wrapping on narrow screens.

**Deutsch**
- **Halten zum Armen (3 s)**: der Arm-Button schaltet nicht mehr auf Antippen. 3 Sekunden
  gedrückt halten — der Button füllt sich und zählt herunter („ARMING IN 1.6 s") — und
  dasselbe Halten gilt fürs *Disarmen*, denn das ist der Fehlgriff, der wirklich weh tut.
  Früher loslassen bricht ab; ein Link-Verlust während des Haltens ebenfalls. Geht mit
  Finger, Maus und Leertaste/Enter, mit kurzem Vibrieren auf Handys, die das können.
  **Panic-Disarm (Setup › Controls) bleibt sofort** — das ist der Notfallweg.
- **Im OSD steht nur noch DISARMED / FAILSAFE**, nie ARMED. Gearmt ist der Normalfall und
  am Flight-Timer und den Kanalbalken ohnehin sichtbar — ein Element weniger im Bild.
- **Verzerrtes OSD-Badge behoben**: der obere Mittelstreifen hat `flex-direction: column`
  von `.osd > div` geerbt, dadurch standen LINK und DISARMED untereinander *und* das
  kürzere Badge wurde auf die Breite des längeren gestreckt — das leere Feld hinter
  „LINK", das beim Armen verschwand. Beide Mittelstreifen sind wieder echte Zeilen.
- **Mehr Platz zwischen den Touch-Joysticks** (Abstand 18px → bis 64px, mit der
  Viewport-Breite skaliert): bessere Zwei-Daumen-Bedienung am Handy, in allen Stick-Modes,
  ohne auf schmalen Displays umzubrechen.

## v1.21.1
**English**
- **Documentation pass over all four docs** (EN + DE), correcting what had gone stale:
  auto-disarm on reconnect is **vehicle-type coupled** (the setup checkbox is only the
  fallback until a ground station connects — the old "turn it off for plane/drone by
  hand" advice was wrong); the installer's real package list (Node 22, `usb-modeswitch`,
  `i2c-tools`, `gpsd`, `wireguard-tools`, ZeroTier); the native driver libs are
  **optional dependencies** skipped by `npm install --omit=optional`; serial GPS needs
  `serialport` too; Pi OS is no longer pinned to Bookworm in the text.
- **New in `HARDWARE.md` §6.1: the trust model** — the service listens on `0.0.0.0`, so
  the network is the security boundary; when to set an API secret, what it does and does
  not protect (plaintext in the config, traffic unencrypted), `YRC_API_SECRET`, and
  `YRC_HOST` for binding to a single address.
- Setup steps now cover **Detect hardware**, the **battery-% source** and the **Security**
  panel; the LTE section explains the **uplink signal in the OSD** (`mmcli` %, else the
  `wlan0` RSSI). New troubleshooting rows for a set API secret, no GPS fix and a missing
  signal value.
- README (EN + DE): **mobile view** with a collapsible screenshot, plus the features that
  were missing — **Auto** video quality, per-block OSD toggles, low-battery warning and
  **blackbox logging**.
- Setup page: the last German string ("RÄDER HOCH / PROPS AB") is now English.

**Deutsch**
- **Doku-Durchgang über alle vier Dokumente** (EN + DE), veraltete Stellen korrigiert:
  Auto-Disarm bei Reconnect ist **an den Fahrzeugtyp gekoppelt** (die Checkbox im Setup
  ist nur der Fallback, bis sich eine Bodenstation verbindet — der alte Hinweis „für
  Flugzeug/Drohne von Hand ausschalten" war falsch); die echte Paketliste des Installers
  (Node 22, `usb-modeswitch`, `i2c-tools`, `gpsd`, `wireguard-tools`, ZeroTier); die
  nativen Treiber-Libs sind **optionale Abhängigkeiten**, die `npm install
  --omit=optional` überspringt; serielles GPS braucht ebenfalls `serialport`; Pi OS ist
  im Text nicht mehr auf Bookworm festgenagelt.
- **Neu in `HARDWARE.de.md` §6.1: das Vertrauensmodell** — der Dienst lauscht auf
  `0.0.0.0`, das Netz ist also die Sicherheitsgrenze; wann ein API-Secret sinnvoll ist,
  was es schützt und was nicht (Klartext in der Config, Verkehr unverschlüsselt),
  `YRC_API_SECRET` sowie `YRC_HOST` zum Binden auf eine einzelne Adresse.
- Die Setup-Schritte decken jetzt **Detect hardware**, die **Akku-%-Quelle** und das
  **Security**-Panel ab; der LTE-Abschnitt erklärt das **Uplink-Signal im OSD**
  (`mmcli`-%, sonst der `wlan0`-RSSI). Neue Fehlersuche-Zeilen für gesetztes API-Secret,
  fehlenden GPS-Fix und fehlenden Signalwert.
- README (EN + DE): **mobile Ansicht** mit aufklappbarem Screenshot, dazu die bisher
  fehlenden Funktionen — **Auto**-Videoqualität, einzeln abschaltbare OSD-Blöcke,
  Akku-Warnung und **Blackbox-Logging**.
- Setup-Seite: der letzte deutsche String („RÄDER HOCH / PROPS AB") ist jetzt englisch.

## v1.21.0
**English**
- **Mobile layout fixes** — nothing widens the page any more, so mobile Safari can't
  pan/zoom the whole view sideways: the FPV/OSD tool buttons wrap into a second row,
  the model editor's *Duplicate*/*Delete* drop onto their own right-aligned row, and
  the number-input grids (endpoints, auto-quality, battery thresholds) let their
  columns govern the width instead of the inputs' intrinsic size. The endpoints
  min/max pair was completely unstyled and now renders as a proper two-column field.
- **Compact OSD on phones** — same blocks at ~⅔ the size, secondary readouts (video
  latency, kbps, fps, battery-% source) hidden, the bottom-right telemetry stacks laid
  out as wrapped rows, and the ARMED/FAILSAFE badge moved up next to LINK so the
  telemetry block can't cover it. New **OSD size** setting in the FPV ⚙ panel:
  *Auto* (compact on narrow screens and on phones in landscape), *Compact*, *Full* —
  persisted per browser. Desktop is unchanged.

**Deutsch**
- **Mobile-Layout-Fixes** — nichts macht die Seite mehr breiter als das Fenster, damit
  Safari die Ansicht nicht mehr seitlich verschieben/zoomen lässt: die FPV/OSD-Buttons
  rutschen in eine zweite Reihe, *Duplicate*/*Delete* im Modell-Editor bekommen eine
  eigene, rechtsbündige Zeile, und die Zahlenfeld-Raster (Endpoints, Auto-Qualität,
  Akku-Schwellen) richten sich nach den Spalten statt nach der Eigenbreite der Felder.
  Das min/max-Paar bei den Endpoints hatte gar kein CSS und ist jetzt ein sauberes
  Zwei-Spalten-Feld.
- **Kompaktes OSD am Handy** — gleiche Blöcke in ca. ⅔ Größe, sekundäre Werte
  (Video-Latenz, kbps, fps, Akku-%-Quelle) ausgeblendet, die Telemetrie-Blöcke unten
  rechts als umbrechende Zeilen, und das ARMED/FAILSAFE-Badge wandert nach oben neben
  LINK, damit der Telemetrie-Block es nicht mehr verdeckt. Neue Einstellung **OSD size**
  im FPV-⚙-Panel: *Auto* (kompakt auf schmalen Screens und am Handy im Querformat),
  *Compact*, *Full* — pro Browser gespeichert. Desktop bleibt unverändert.

## v1.20.4
**English**
- OSD: **GPS ground speed** (km/h) now shown under the home compass, next to the trip
  odometer; the compass column is left-aligned so speed/odometer sit flush left.

**Deutsch**
- OSD: **GPS-Geschwindigkeit** (km/h) jetzt unter dem Home-Kompass, neben dem
  Trip-Odometer; die Kompass-Spalte ist linksbündig, sodass Speed/Odometer links stehen.

## v1.20.3
**English**
- **Trip odometer** under the home compass in the OSD — accumulated ground distance
  (m, switching to km with 2 decimals ≥ 1000 m), computed from successive GPS fixes
  with a jitter deadband so a stationary receiver doesn't make it creep. Resets on
  link loss.

**Deutsch**
- **Trip-Odometer** unter dem Home-Kompass im OSD — aufsummierte Strecke (m, ab
  1000 m in km mit 2 Nachkommastellen), aus aufeinanderfolgenden GPS-Fixes mit
  Jitter-Deadband, damit ein stehender Empfänger sie nicht hochzählt. Reset bei
  Verbindungsverlust.

## v1.20.2
**English**
- OSD polish: bigger **battery bar** and **home compass**; dropped the distance label
  next to the compass (it's already shown in the home badge just above it).

**Deutsch**
- OSD-Feinschliff: größerer **Akku-Balken** und **Home-Kompass**; die Distanz-Anzeige
  neben dem Kompass entfällt (sie steht bereits im Home-Badge direkt darüber).

## v1.20.1
**English**
- **Home compass/arrow in the OSD** — a rotating arrow that points the way back to
  home. It rotates relative to your travel direction (course) so "up = forward", with
  the distance next to it (falls back to north-relative when stationary).
- **OSD field toggles** in the gear (⚙) menu — show/hide individual OSD blocks: flight
  timer, GPS, home arrow, channel bars, link block (WS/ms/fps/loss), battery bar, and
  battery data (V/A/mAh). Saved per browser.

**Deutsch**
- **Home-Kompass/-Pfeil im OSD** — ein drehender Pfeil, der den Weg zurück zum Home
  zeigt. Er dreht relativ zur Fahrtrichtung (Kurs), also „oben = vorne", mit der Distanz
  daneben (fällt bei Stillstand auf Nord-Bezug zurück).
- **OSD-Feld-Schalter** im Zahnrad-(⚙-)Menü — einzelne OSD-Blöcke ein-/ausblenden:
  Flug-Timer, GPS, Home-Pfeil, Kanal-Balken, Link-Block (WS/ms/fps/loss), Akku-Balken
  und Akku-Daten (V/A/mAh). Pro Browser gespeichert.

## v1.20.0
**English**
- **GPS (local, source-selectable).** A new GPS subsystem with a pluggable source —
  **local NMEA** over serial (Adafruit Ultimate GPS, u-blox NEO-6/7/8/M9, BN-880…),
  **gpsd** (USB dongles), a **sim** source, and a **MAVLink** slot for later — all
  normalized to one fix and streamed to the ground at ~1 Hz.
- **Home point**: set it manually or **auto-home** on the first good fix (session /
  takeoff point). The OSD shows fix type + satellites and, with home set, **distance
  and direction back to home**.
- Setup › GPS (source, serial device/baud, min-sats, auto-home, live status, set/clear
  home); "Detect hardware" now also lists serial GPS candidates; the installer adds
  `gpsd`. HARDWARE docs (EN+DE) cover common modules and wiring.

**Deutsch**
- **GPS (lokal, Quelle wählbar).** Ein neues GPS-Subsystem mit austauschbarer Quelle —
  **lokales NMEA** über Serial (Adafruit Ultimate GPS, u-blox NEO-6/7/8/M9, BN-880…),
  **gpsd** (USB-Dongles), eine **Sim**-Quelle und ein **MAVLink**-Slot für später — alles
  zu einem Fix normalisiert und ~1 Hz an die Ground gestreamt.
- **Home-Punkt**: manuell setzen oder **Auto-Home** beim ersten guten Fix (Session /
  Startpunkt). Das OSD zeigt Fix-Typ + Satelliten und, mit gesetztem Home, **Distanz und
  Richtung zurück zum Home**.
- Setup › GPS (Quelle, Serial-Device/Baud, Min-Sats, Auto-Home, Live-Status, Home
  setzen/löschen); „Detect hardware" listet jetzt auch serielle GPS-Kandidaten; der
  Installer bringt `gpsd` mit. HARDWARE-Docs (EN+DE) mit gängigen Modulen und Verkabelung.

## v1.19.0
**English**
- **Link health in the OSD** — the vehicle now reports its uplink signal (LTE % or
  WiFi dBm), shown bottom-right in the OSD and folded into the **weak-link** warning
  alongside control RTT and video packet loss. One unified "is the link good" signal.
- **One-line install** on Raspberry Pi OS Lite:
  `curl -fsSL …/provisioning/bootstrap.sh | bash` clones to `/opt/yonderrc` and runs
  the installer.
- **"Detect hardware"** button in Setup — scans the I²C bus, LTE modem and cameras and
  suggests the driver/sensors to pick, so you don't have to guess addresses. The
  installer now also adds `i2c-tools`.

**Deutsch**
- **Link-Qualität im OSD** — das Fahrzeug meldet jetzt sein Uplink-Signal (LTE % oder
  WiFi dBm), unten rechts im OSD sichtbar und in die **Weak-Link**-Warnung eingerechnet
  (zusammen mit Steuer-RTT und Video-Paketverlust). Ein einheitliches „ist der Link gut".
- **Ein-Zeilen-Installation** auf Raspberry Pi OS Lite:
  `curl -fsSL …/provisioning/bootstrap.sh | bash` klont nach `/opt/yonderrc` und startet
  den Installer.
- **„Detect hardware"**-Button im Setup — scannt den I²C-Bus, das LTE-Modem und Kameras
  und schlägt Treiber/Sensoren vor, statt Adressen raten zu müssen. Der Installer bringt
  jetzt zusätzlich `i2c-tools` mit.

## v1.18.4
**English**
- **More LTE control** (Setup › LTE): force the **network mode** (4G/LTE-only or 3G)
  for lower latency, toggle **data roaming** (home-only), a **Diagnostics** button
  that shows the raw `mmcli` output so you can see what the Pi detects, and **SIM PIN
  management** — change the PIN or **remove the PIN lock** entirely (empty new PIN =
  no PIN). PIN operations act on the SIM itself and require the current PIN.

**Deutsch**
- **Mehr LTE-Kontrolle** (Setup › LTE): **Netzmodus** erzwingen (nur 4G/LTE oder 3G)
  für niedrigere Latenz, **Daten-Roaming** umschalten (home-only), ein **Diagnose**-
  Button mit der rohen `mmcli`-Ausgabe (du siehst, was der Pi erkennt) und
  **SIM-PIN-Verwaltung** — PIN ändern oder die **PIN-Sperre ganz entfernen** (leere
  neue PIN = keine PIN). PIN-Aktionen wirken auf die SIM selbst und brauchen die
  aktuelle PIN.

## v1.18.3
**English**
- **Non-root operation**: added a ready-made minimal sudoers policy
  (`provisioning/yonderrc.sudoers`) for running the vehicle service as a non-root
  user — it grants passwordless sudo only for the privileged helpers (mmcli PIN,
  wg/wg-quick, zerotier-cli, install of the WireGuard conf, reboot). The default
  systemd unit runs as root, where it isn't needed. `zerotier-cli` is now invoked via
  sudo too, so ZeroTier works under a non-root user. Documented in provisioning/README.

**Deutsch**
- **Nicht-Root-Betrieb**: eine fertige, minimale sudoers-Policy
  (`provisioning/yonderrc.sudoers`) für den Betrieb des Fahrzeugdienstes als
  Nicht-Root-User — sie gewährt passwortloses sudo nur für die privilegierten Helfer
  (mmcli-PIN, wg/wg-quick, zerotier-cli, install der WireGuard-Conf, reboot). Die
  Standard-systemd-Unit läuft als root, dort ist sie nicht nötig. `zerotier-cli` wird
  jetzt ebenfalls via sudo aufgerufen, damit ZeroTier auch als Nicht-Root funktioniert.
  Dokumentiert in provisioning/README.

## v1.18.2
**English**
- **Much better LTE stick setup** (Setup › LTE) — no longer assumes pure plug-and-play:
  - **SIM PIN** unlock (`mmcli --pin`) for locked SIMs.
  - **APN username/password** for carriers that require APN auth.
  - **Richer status/diagnostics**: real modem model, registration state, live APN/IP,
    and a clear "SIM PIN required" flag (instead of just "idle").
  - The NM connection is created with **`autoconnect`** so it redials itself.
  - PIN/password are stored on the vehicle and **never returned** by the API.
  - The install script now adds **`usb-modeswitch`** for "Zero-CD" dongles.

**Deutsch**
- **Deutlich besseres LTE-Stick-Setup** (Setup › LTE) — nicht mehr reines Plug-and-Play:
  - **SIM-PIN**-Entsperrung (`mmcli --pin`) für gesperrte SIMs.
  - **APN-Benutzer/Passwort** für Anbieter mit APN-Auth.
  - **Reichere Statusanzeige/Diagnose**: echtes Modem-Modell, Registrierungsstatus, live
    APN/IP und eine klare „SIM PIN required"-Markierung (statt nur „idle").
  - Die NM-Verbindung wird mit **`autoconnect`** angelegt, wählt sich also selbst neu.
  - PIN/Passwort werden am Fahrzeug gespeichert und von der API **nie zurückgegeben**.
  - Das Install-Skript bringt jetzt **`usb-modeswitch`** für „Zero-CD"-Dongles mit.

## v1.18.1
**English**
- **Auto-disarm on reconnect is now coupled to the vehicle type** — the ground derives
  it from the active profile (car/boat = ON, plane/drone = OFF) and pushes it to the
  vehicle, so a brief reconnect can no longer cut an aircraft's motors in flight. The
  Controls (Safety) panel shows the current policy and why; the vehicle's manual toggle
  is now just a fallback used until a ground connects. Failsafe is unchanged and remains
  the primary link-loss safety.

**Deutsch**
- **Auto-Disarm bei Reconnect ist jetzt an den Fahrzeugtyp gekoppelt** — der Ground
  leitet es aus dem aktiven Profil ab (Auto/Boot = AN, Flugzeug/Drohne = AUS) und pusht
  es ans Fahrzeug, sodass ein kurzer Reconnect einem Luftfahrzeug nicht mehr im Flug die
  Motoren kappen kann. Das Controls-(Safety-)Panel zeigt die aktuelle Politik und warum;
  der manuelle Schalter am Fahrzeug ist nur noch ein Fallback, bis ein Ground verbindet.
  Failsafe bleibt unverändert die primäre Sicherheit bei Link-Verlust.

## v1.18.0
**English**
- **Selectable remote access** (Setup › Remote access) — pick one method to reach the
  vehicle behind CGNAT/LTE:
  - **Tailscale** and **ZeroTier** — zero-config mesh VPNs (ZeroTier: enter the 16-hex
    network ID, then authorize the node).
  - **WireGuard** — **upload a `.conf`** (e.g. exported by a FritzBox) and the vehicle
    applies it with `wg-quick`; comes up automatically at boot.
  - The chosen method is persisted and brought up at boot; secrets (auth key, WG conf)
    are never returned by the API. Setup gates all of this behind the optional shared
    secret. *(ZeroTier/WireGuard were validated in the simulator and via unit tests; the
    real `wg-quick`/`zerotier-cli` paths are hardware-verified only — test on your Pi.)*
- The Pi install script now also installs `wireguard-tools` and ZeroTier.

**Deutsch**
- **Wählbarer Remote-Zugang** (Setup › Remote access) — eine Methode, um das Fahrzeug
  hinter CGNAT/LTE zu erreichen:
  - **Tailscale** und **ZeroTier** — Zero-Config-Mesh-VPNs (ZeroTier: 16-stellige
    Network-ID eintragen, dann Node autorisieren).
  - **WireGuard** — eine **`.conf` hochladen** (z. B. FritzBox-Export); das Fahrzeug
    wendet sie mit `wg-quick` an; kommt beim Boot automatisch hoch.
  - Die gewählte Methode wird gespeichert und beim Boot hochgefahren; Secrets (Auth-Key,
    WG-Conf) gibt die API nie zurück. Alles hinter dem optionalen Shared Secret. *(ZeroTier/
    WireGuard sind im Simulator und per Unit-Tests geprüft; die echten `wg-quick`/
    `zerotier-cli`-Pfade sind nur auf Hardware verifizierbar — bitte am Pi testen.)*
- Das Pi-Install-Skript installiert jetzt zusätzlich `wireguard-tools` und ZeroTier.

## v1.17.4
**English**
- **Choose what drives the battery % gauge.** Setup › Telemetry now has a "Battery %
  source": **coulomb** (consumed mAh vs capacity), **voltage** (full/empty curve), or
  **clamp** (the lower of the two — safe default). The mAh readout (consumed/remaining)
  is shown regardless; this only changes the top-right % gauge. The OSD now labels the
  bar with its source (`mAh` / `volt` / `mAh·V`) so it's clear where the number comes from.

**Deutsch**
- **Wählbar, was die Akku-%-Anzeige speist.** Unter Setup › Telemetry gibt es jetzt eine
  „Battery % source": **coulomb** (verbrauchte mAh vs. Kapazität), **voltage**
  (Voll/Leer-Kurve) oder **clamp** (der niedrigere von beiden — sicherer Default). Die
  mAh-Anzeige (verbraucht/Rest) bleibt unabhängig; das ändert nur die %-Anzeige oben
  rechts. Das OSD beschriftet den Balken jetzt mit seiner Quelle (`mAh` / `volt` /
  `mAh·V`), damit klar ist, woher der Wert kommt.

## v1.17.3
**English**
- **Factory reset** — vehicle and ground. Vehicle: Setup › System → "Factory reset"
  clears the saved config file (incl. the API secret, dropped live so you're not
  locked out); restart to apply defaults. Ground: Setup → "Reset app settings" wipes
  all `yonderrc.*` browser storage (models, bindings, actions, battery, secret) and
  reloads with the demo models.
- **Voltage sanity floor for battery %** — set an optional full/empty pack voltage in
  Setup › Telemetry; the battery percentage is then clamped so it can't read higher
  than the voltage suggests (coulomb counting alone would show ~100% on a
  not-actually-full pack). Also yields a % from voltage when no capacity is set.
- **SBUS driver**: a serial error is now logged instead of surfacing as an unhandled
  crash; the fixed-rate frames keep trying and the watchdog holds failsafe.

**Deutsch**
- **Werksreset** — Fahrzeug und Ground. Fahrzeug: Setup › System → „Factory reset"
  leert die gespeicherte Config-Datei (inkl. API-Secret, live gelöscht, damit man
  sich nicht aussperrt); Neustart übernimmt die Defaults. Ground: Setup → „Reset app
  settings" löscht den gesamten `yonderrc.*`-Browser-Speicher (Modelle, Bindings,
  Aktionen, Akku, Secret) und lädt mit den Demo-Modellen neu.
- **Spannungs-Sicherheits-Floor für Akku-%** — optional volle/leere Pack-Spannung
  unter Setup › Telemetry setzen; der Akku-Prozentwert wird dann so begrenzt, dass er
  nicht höher als die Spannung anzeigt (reines Coulomb-Counting würde bei nicht-voll
  gestartetem Pack ~100 % zeigen). Liefert auch ohne Kapazität einen %-Wert.
- **SBUS-Treiber**: ein Serial-Fehler wird jetzt geloggt statt als unbehandelter
  Absturz; die Frames laufen weiter und der Watchdog hält Failsafe.

## v1.17.2
**English**
- **Telemetry can be turned OFF** (Setup › Telemetry → source "off"). Default stays
  sim, but for a first flight you can disable it so the OSD shows **no fake values**
  at all. The ground also clears telemetry if the vehicle stops sending it, so
  turning it off live doesn't leave stale numbers on screen.
- **"Setup ↗" button** on the ground page opens the vehicle's setup page in a new
  tab, derived from the connection address — works over LAN, the Pi's AP, or a
  Tailscale IP (same host:port as the control link, over http).
- **Clearer WebRTC control option**: the "Control via WebRTC data channel" checkbox
  now has a tooltip + hint explaining it (lower-latency, NAT/LTE-friendly control
  path that auto-falls back to WS; arm/settings always use WS).

**Deutsch**
- **Telemetrie abschaltbar** (Setup › Telemetry → Source „off"). Standard bleibt Sim,
  aber für den ersten Flug kann man sie deaktivieren, damit das OSD **gar keine
  Fantasiewerte** zeigt. Die Ground-Seite blendet Telemetrie zudem aus, wenn das
  Fahrzeug keine mehr sendet — Abschalten im Betrieb hinterlässt keine alten Werte.
- **„Setup ↗"-Button** auf der Ground-Seite öffnet die Fahrzeug-Setup-Seite in einem
  neuen Tab, abgeleitet aus der Verbindungsadresse — funktioniert im LAN, über den
  AP des Pi oder eine Tailscale-IP (gleicher Host:Port wie der Steuer-Link, per http).
- **WebRTC-Option klarer erklärt**: Die Checkbox „Control via WebRTC data channel" hat
  jetzt Tooltip + Hinweis (latenzärmerer, NAT/LTE-freundlicher Steuerpfad mit
  automatischem WS-Fallback; Arm/Einstellungen laufen immer über WS).

## v1.17.1
**English**
- **Optional shared secret (off by default).** Set an "API secret" in the vehicle's
  Setup › Security. While unset, nothing changes — first-time connect and setup need
  no password. Once set, it's required for **saving settings** (mutating `/api/*`
  POSTs, via header `x-yonderrc-secret` or `?secret=`) **and for the control link**
  (the ground app's new "secret" field, sent as `?secret=`; a wrong/missing secret is
  rejected with WS close 4001). The secret is never returned by the API. Set/clear it
  live without a restart.

**Deutsch**
- **Optionales Shared Secret (standardmäßig aus).** Unter Setup › Security am Fahrzeug
  ein „API secret" setzen. Solange keins gesetzt ist, ändert sich nichts — der erste
  Verbindungsaufbau und das Setup brauchen kein Passwort. Einmal gesetzt, ist es nötig
  zum **Speichern von Einstellungen** (mutierende `/api/*`-POSTs, per Header
  `x-yonderrc-secret` oder `?secret=`) **und für den Steuer-Link** (neues „secret"-Feld
  in der Ground-App, als `?secret=`; falsches/fehlendes Secret → WS-Close 4001). Das
  Secret wird von der API nie zurückgegeben. Setzen/Löschen live ohne Neustart.

## v1.17.0
**English**
- **English-first documentation.** `README.md` and `docs/HARDWARE.md` are now
  English; the German originals live in `README.de.md` and `docs/HARDWARE.de.md`,
  with a language switcher at the top of each. No code changes — docs only.

**Deutsch**
- **Englisch als Hauptsprache der Doku.** `README.md` und `docs/HARDWARE.md` sind
  jetzt englisch; die deutschen Originale liegen in `README.de.md` und
  `docs/HARDWARE.de.md`, mit Sprachumschalter oben in jeder Datei. Keine
  Code-Änderungen — nur Dokumentation.

## v1.16.3
- **Camera setup hardening**: stream names are restricted to a safe charset (they
  become go2rtc stream keys *and* the ground's stream id), USB device paths are
  validated, and dimensions/fps are coerced to safe integers — a crafted camera
  name or device path can no longer break the generated `go2rtc.yaml` or inject
  into its `exec:` command lines. Names are normalised on save so config, welcome
  and YAML stay in sync.
- **INA sensors can now provide pack voltage too**: `ina219/226/260/3221` are
  selectable as voltage channels and read from their bus-voltage register, so a
  single INA battery monitor delivers both voltage and current (no extra divider).
  *(Register conversions are unit-tested; the I²C read path is hardware-verified only.)*
- **Fix — per-axis detent could be mis-assigned after a transmitter-mode change**:
  detents are now preserved per channel (not per stick axis), so switching input
  method after changing the stick mode keeps each channel's centering correct.

## v1.16.2
- **Safety fix — arm/disarm now always travels over the reliable WebSocket.**
  Previously, when the opt-in "Control via WebRTC data channel" mode was active,
  arm/disarm (incl. panic-disarm) went over the lossy, no-retransmit data channel,
  so a single dropped packet could silently leave the vehicle armed. Only control
  frames (which are superseded 20 ms later) now use the data channel; every
  one-shot command (arm, config, hello, video, calib) is forced onto the WS.
- **Security fix — no more shell injection in the vehicle setup API.** The LTE APN
  and Tailscale auth key from `/api/lte` and `/api/tailscale` were interpolated
  into shell strings; a crafted value could execute arbitrary commands on the Pi.
  These now use `execFile` (no shell), so operator input is a literal argument.

## v1.16.1
- **OSD refinement**: the battery **charge bar stands alone top-right** (phone-style),
  and the numeric battery data (voltage, current, mAh) moves to the **bottom-right as
  its own panel under the link/latency block**, so the two are cleanly separated.

## v1.16.0
- **OSD layout swapped** for a more intuitive read: battery/power block (charge bar,
  voltage, current, capacity) now sits **top-right**, phone-style, with the charge
  bar on top; link/latency data (control path, ctrl/video ms, bitrate, fps, loss)
  moved to the **bottom-right**.

## v1.15.0
- Fix: battery %/mAh now appears **without a vehicle restart** — telemetry config
  hot-applies (`/api/telemetry` reconfigures the running service). Set the capacity
  in the vehicle's Setup › Telemetry.
- Fix: switching Setup → Drive could show a black picture every other time — the
  WHEP stream now attaches only for the latest connection attempt (generation guard)
  and force-plays, so overlapping attempts can't leave a dead stream.
- **Fullscreen** button on the FPV panel (OSD stays overlaid).
- Vehicle Setup: camera W/H/FPS/kbps fields no longer overflow their box.
- Added `CLAUDE.md` for local development handoff.

## v1.14.0
- **Blackbox logging** (opt-in, OFF by default): records telemetry + link stats
  (RTT, bitrate, loss, fps, video latency, volts/amps/mAh/percent) at 2 Hz while
  enabled and downloads as CSV. Costs nothing when off; buffer is capped. In
  Setup › Controls.
- **Low-battery warning** gained a **consumed-mAh** threshold (in addition to
  percent and voltage), and the settings layout was tidied into aligned rows.
- Fix: switching Setup → Drive could leave a frozen/black video with no recovery —
  the frame watchdog used a stale state value; it now tracks live frames and
  reconnects a black stream on its own.

## v1.13.0 — Low-battery warning
- **Low-battery warning** with independent **percent** and **voltage** thresholds.
  "Auto" mode only warns when a real sensor is delivering data (no nagging in sim);
  can be forced on/off. Alerts — **OSD red blink**, **rumble** and **sound** — are
  each individually switchable and repeat every ~3 s while low. Settings live in
  Setup › Controls.

## v1.12.0 — Safety & controls
- **Pre-arm check**: arming is refused while a throttle channel is off its rest
  position (centre for reverse-capable cars/drones, idle for planes/boats — taken
  from the channel's detent). Toggleable in Setup › Controls, on by default.
- **Unified action bindings** (Setup › Controls): assign a keyboard key and/or a
  controller button to Panic-disarm, Arm/disarm, Next-camera, Record and Snapshot,
  each with a Learn button. Record/snapshot hotkeys moved here from the FPV panel.
- **Panic disarm**: a bindable action that disarms immediately over the reliable link.
- **React error boundary**: a UI fault shows a reload panel instead of a white screen.
- **Flight timer + session**: runs while armed (OSD top-left and status strip), with
  mAh consumed since arming when a real sensor is present.


## v1.11.0
- OSD: link state moved to top-center, armed/failsafe to bottom-center; the
  top-right stats and bottom-right telemetry now sit on a translucent panel so
  they stay readable over bright video.
- Channels: added an **Edit** button (alongside Add/Remove) and a per-channel
  **rest position** (center / min / hold) so a hold-ramp, momentary or toggle can
  settle at centre (1500) instead of min. Independent of stick modes.
- Channel monitor: throttle-held-safe channels are now clearly tinted and labelled
  "held safe · disarmed" instead of a truncated tag.


## v1.10.0
- **Transmitter stick modes 1–4**: switch which stick controls throttle / elevator
  / aileron / rudder — for touch, gamepad and keyboard. Chosen per model in Setup
  and preserved across input-method switches (car/boat default to Mode 1, plane/
  drone to Mode 2).
- **Add / remove channels**: build your own channel map in Setup. "+ Add channel"
  with a channel number, label, source (keyboard / gamepad / on-screen), mode
  (proportional / momentary / toggle / hold-ramp) and a "Learn" button to capture a
  key or gamepad button/axis; each channel has a Remove button. Custom channels now
  survive input-method and stick-mode switches.


## v1.9.0
- Fix: per-channel and global endpoints (µs) now actually apply beyond 1000–2000 —
  the hard clamp was widened to an absolute 500–2500 range (nominal default stays
  1000–2000). The channel monitor scales each bar to that channel's own endpoints.
- UI: dark, consistent styling for all dropdowns and number fields. Layout
  reorganised — model selection now lives under Setup only; Drive view is
  Vehicle-Link → FPV+control → status info → servo outputs. The OSD now shows the
  link state (LINK / NO LINK) alongside armed/failsafe.


## v1.8.0
- **Auto video quality**: a new "Auto" mode steps the video quality down when the
  link degrades (packet loss / latency) and back up when it recovers, with
  hysteresis so it doesn't oscillate. Thresholds are adjustable in the FPV video
  settings (⚙). Manual High/Medium/Low still available.
- **Link robustness**: the OSD now shows "RECONNECTING…" during control-link
  recovery and a "⚠ WEAK LINK" warning when control latency or video loss is high.
- **License**: switched to CC BY-NC-ND 4.0 with an additional no-military-use
  restriction. README gained the repo-copy instructions (git/scp/USB).


## v1.7.2
- Docs: README rewritten to be concise and describe the current feature set
  (per-version notes moved to this changelog). Added a LICENSE — freeware for
  private, non-commercial use; no modification, no commercial use, and no
  military/warfare use.

## v1.7.1
- Fix: live video quality change crashed the vehicle with ENOENT — the go2rtc
  config path is now absolute (resolved to the repo root) and writes create the
  folder and never throw. REC toast in the OSD now blinks red.

## v1.7.0
- **Self-healing video**: the FPV stream now detects a frozen/dropped picture
  (WebRTC state + a frame watchdog) and reconnects on its own with backoff, keeping
  the last frame on screen and showing "Reconnecting…" instead of freezing.
- **Live video quality from the ground** (High / Medium / Low): the ground sends a
  command; the vehicle rescales resolution + caps bitrate and reloads go2rtc, then
  the stream re-establishes automatically. Keeps the picture fluid on a poor link.
- **Connection stats in the OSD**: bitrate, packet loss, FPS and video latency from
  WebRTC stats (top-right). Armed/failsafe badge moved to top-center so it no longer
  overlaps the REC indicator.

## v1.6.0
- **Recording & snapshots** in the FPV panel: record the live video locally (WebM)
  and grab stills (PNG). Pick a target folder once before flight (File System
  Access API) so nothing needs clicking mid-flight; otherwise files go to Downloads.
  Bindable to a keyboard key or controller button (video start/stop + snapshot).
- **Guided hardware self-test** in the setup UI: sweep any channel (min→max→center,
  disarmed only — refused while armed), read the current sensor values once, and
  snapshot each camera. Makes the first real bring-up a click-through.
- **Repeatable test suite** (`npm test`): consolidates the sensor math, coulomb
  counting, sim/real telemetry, vehicle-type failsafe/disarmed logic, template and
  binding-engine behaviour, and camera-source generation into one run (23 checks).

## v1.5.1
- Auto-detect the H.264 encoder (libx264 / libopenh264 / Pi hardware) so video
  works without RPM Fusion; `dev:video` accepts any usable encoder.

## v1.5.0
- Disarmed and failsafe are separate, vehicle-type-aware values (drone holds on
  link loss, disarms motors-off). Auto-disarm on reconnect is toggleable (off for
  aircraft). Telemetry shows "NO SENSOR" instead of silently substituting sim.
  Field operation: AP hotspot + captive portal; the Pi serves the ground app.

## v1.4.0
- Sim telemetry clearly marked SIM (OSD + status). Model switch and settings
  locked while armed. New connections start disarmed. Hardware guide added.

## v1.3.0 / v1.3.1
- Telemetry subsystem (voltage/current sensors, coulomb counting, battery %),
  graphical camera configuration generating go2rtc.yaml, video-latency estimate.
  libx264 preflight added.

## v1.2.0
- Video verified end-to-end (go2rtc /api/webrtc), `dev:video` helper.

## v1.1.x
- Models (car/plane/drone/boat) from templates, per-model input method and
  per-axis detents, virtual joystick, µs endpoints; reconnect and detent fixes.

## v1.0.0
- First consolidated monorepo: protocol, vehicle (sim + hardware drivers), ground
  (React), desktop (Electron + SDL2). Sim-complete.
