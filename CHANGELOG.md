# Changelog

All notable changes to YonderRC. Each release is the full project; every zip is
self-contained. Entries from v1.17.0 on are bilingual (English / Deutsch).

## v1.40.1
**English**
- **Fixed: System status still said "no modem" while the vehicle was online through a
  HiLink stick.** The status row only ever asked ModemManager. It now falls back to the
  stick, so model, state, operator, signal and WAN IP appear there — marked as
  `(HiLink)`, and the LTE panel says outright that its fields do nothing for such a
  stick, because APN and PIN live inside it.
- **The stick's web UI is now proxied by default, on port 8081.** A stick you cannot
  configure is a stick you have to unplug and carry to a laptop, and everything else on
  this vehicle is reachable from a browser. The panel's **Open the stick's UI ↗** button
  therefore always has somewhere to go. Clearing the port field still switches it off.
  *The trade-off, stated plainly:* on an **open** onboarding hotspot anyone who joins can
  reach that admin page — set a hotspot password or an API secret before the vehicle
  leaves the bench, which is the same rule the setup UI itself already follows.
- **The OSD label stopped saying LTE twice.** It was "LTE 72% · 4G (LTE)"; it is "LTE 72%"
  now — but a **2G/3G fallback is spelled out** ("3G (HSPA+) 41%"), because that is the
  moment video stops working and the pilot needs the reason, not a percentage.
- The stick is read at most every 8 seconds and cached: the setup page polls status every
  3 s and the OSD link every 5 s, and each read is five HTTP requests to the stick. The
  panel's **Refresh** forces a fresh read.
- Opening a raw API path in a browser (`…:8081/api/monitoring/status`) answers `125002` —
  the stick wants a session, which its own UI establishes and which YonderRC's reader
  fetches first. Expected, and now documented.

**Deutsch**
- **Behoben: System status meldete weiter „no modem", während das Fahrzeug über den
  HiLink-Stick online war.** Die Statuszeile fragte ausschließlich ModemManager. Sie
  greift jetzt auf den Stick zurück — Modell, Zustand, Betreiber, Signal und WAN-IP
  stehen dort, gekennzeichnet mit `(HiLink)`, und das LTE-Panel sagt ausdrücklich, dass
  seine Felder für so einen Stick wirkungslos sind, weil APN und PIN in ihm selbst
  liegen.
- **Die Weboberfläche des Sticks wird jetzt standardmäßig durchgereicht, auf Port 8081.**
  Ein Stick, den man nicht konfigurieren kann, ist ein Stick, den man abziehen und zum
  Laptop tragen muss — und alles andere an diesem Fahrzeug ist per Browser erreichbar.
  Der Knopf **Open the stick's UI ↗** hat damit immer ein Ziel. Leeres Portfeld schaltet
  es weiterhin ab. *Der Nachteil, klar gesagt:* An einem **offenen** Onboarding-Hotspot
  erreicht jeder Verbundene diese Admin-Seite — also Hotspot-Passwort oder API-Secret
  setzen, bevor das Fahrzeug die Werkbank verlässt; für die Setup-Oberfläche gilt
  dasselbe ohnehin schon.
- **Das OSD sagt nicht mehr zweimal LTE.** Aus „LTE 72% · 4G (LTE)" wurde „LTE 72%" — ein
  **Rückfall auf 2G/3G wird aber ausgeschrieben** („3G (HSPA+) 41%"), denn genau dann
  hört das Video auf zu funktionieren, und der Pilot braucht den Grund, nicht eine Zahl.
- Der Stick wird höchstens alle 8 Sekunden gelesen und zwischengespeichert: die
  Setup-Seite pollt den Status alle 3 s, das OSD den Link alle 5 s, und ein Lesevorgang
  sind fünf HTTP-Anfragen an den Stick. **Refresh** im Panel erzwingt eine frische
  Abfrage.
- Ein API-Pfad direkt im Browser (`…:8081/api/monitoring/status`) antwortet mit `125002`:
  der Stick will eine Session, die seine eigene Oberfläche aufbaut und die der Leser von
  YonderRC vorher selbst holt. Erwartet — und jetzt dokumentiert.

## v1.40.0
**English**
- **HiLink LTE sticks are supported properly.** A Huawei E3372h-320 (and friends) is not a
  modem in the ModemManager sense — it is a small router that dials by itself, so
  `mmcli -L` stays empty and the LTE panel had nothing to show. YonderRC now reads the
  stick's **own API**: **Setup › LTE stick (HiLink)** shows model, interface, state,
  operator, network type and signal, and the **OSD link block shows the LTE percentage**
  just like it does for a real modem (RSRP-based, with the stick's bar icon as fallback).
- **The stick is identified through the routing table, never by interface name.** With a
  FritzBox on `eth0` and the stick on `eth1` — or the reverse after a reboot or another
  USB port — a name-based guess would eventually report the LAN as the LTE link.
  `ip route get 192.168.8.1` answers which interface *is* the stick, and that is what gets
  reported and used.
- **The stick's configuration page is reachable through the vehicle.** Its network
  (192.168.8.0/24) is only routable from the Pi, so APN, SIM PIN and network mode used to
  mean a keyboard on the vehicle or moving the stick to a laptop. Set a port under
  *Expose its web UI on port* and the vehicle passes the page through at
  `http://<vehicle>:<port>/` — usable from the hotspot, the LAN or the VPN. It is proxied
  at the **root of its own port**, because the HiLink UI is full of absolute paths that no
  prefix rewriting survives, and that also keeps its session cookie working.
- **The proxy is off by default and honours the API secret.** With a secret set, the page
  is opened once as `…?secret=…`, which is traded for an `HttpOnly` cookie so the UI's own
  requests are covered; without it the port answers 401. Our cookie is stripped before
  forwarding, and the target address is validated as a literal IPv4 — it is a proxy
  target, so it must never become a hostname somebody else controls.
- **A 2G/3G-only stick is called out.** E3131/E353 (`12d1:14db`) and similar are flagged in
  the panel: Germany and others switched 3G off years ago, so such a stick gets no data
  connection at all — better to learn that from the page than in a field.
- 32 new tests: XML parsing, error codes, network-type and connection-state mapping,
  RSRP → percent, route parsing, the full read against recorded XML (including session
  headers), and the proxy's auth gate. The proxy itself was exercised end to end against a
  stand-in stick. **The real stick's XML is the one thing only your hardware can confirm.**

**Deutsch**
- **HiLink-LTE-Sticks werden jetzt richtig unterstützt.** Ein Huawei E3372h-320 (und
  Verwandte) ist kein Modem im Sinne von ModemManager, sondern ein kleiner Router, der
  sich selbst einwählt — `mmcli -L` bleibt leer, das LTE-Panel hatte nichts zu zeigen.
  YonderRC liest jetzt die **eigene API des Sticks**: **Setup › LTE stick (HiLink)** zeigt
  Modell, Interface, Zustand, Betreiber, Netztyp und Signal, und im **OSD erscheint die
  LTE-Prozentzahl** wie bei einem echten Modem (aus RSRP, ersatzweise aus der
  Balkenanzeige des Sticks).
- **Der Stick wird über die Routing-Tabelle erkannt, nie über den Interface-Namen.** Mit
  FritzBox an `eth0` und Stick an `eth1` — oder nach Reboot bzw. anderem USB-Port
  umgekehrt — würde eine Namensvermutung irgendwann das LAN als LTE-Strecke melden.
  `ip route get 192.168.8.1` beantwortet, welches Interface der Stick **ist**, und genau
  das wird angezeigt und benutzt.
- **Die Konfigurationsseite des Sticks ist über das Fahrzeug erreichbar.** Sein Netz
  (192.168.8.0/24) ist nur vom Pi aus routbar; APN, SIM-PIN und Netzmodus bedeuteten
  bisher also Tastatur am Fahrzeug oder Umstecken an den Laptop. Trägst du unter *Expose
  its web UI on port* einen Port ein, reicht das Fahrzeug die Seite unter
  `http://<Fahrzeug>:<Port>/` durch — nutzbar vom Hotspot, aus dem LAN oder über das VPN.
  Weitergereicht wird auf der **Wurzel eines eigenen Ports**, weil die HiLink-Oberfläche
  voller absoluter Pfade steckt, die kein Präfix-Umschreiben überleben; nebenbei
  funktioniert so auch ihr Session-Cookie unverändert.
- **Der Proxy ist standardmäßig aus und respektiert das API-Secret.** Mit gesetztem Secret
  öffnet man die Seite einmal als `…?secret=…`, was gegen ein `HttpOnly`-Cookie getauscht
  wird, damit auch die eigenen Anfragen der Oberfläche durchkommen; ohne das antwortet der
  Port mit 401. Unser Cookie wird vor dem Weiterleiten entfernt, und die Zieladresse muss
  eine IPv4-Literal sein — sie ist ein Proxy-Ziel und darf nie zu einem fremden Hostnamen
  werden.
- **Ein reiner 2G/3G-Stick wird benannt.** E3131/E353 (`12d1:14db`) und Ähnliche werden im
  Panel markiert: Deutschland und andere haben 3G vor Jahren abgeschaltet, ein solcher
  Stick bekommt dort überhaupt keine Datenverbindung — das erfährt man besser auf der
  Seite als im Feld.
- 32 neue Tests: XML-Auswertung, Fehlercodes, Netztyp- und Zustandszuordnung, RSRP →
  Prozent, Routen-Auswertung, der komplette Lesevorgang gegen aufgezeichnetes XML
  (inklusive Session-Header) und das Auth-Gate des Proxys. Der Proxy selbst lief
  Ende-zu-Ende gegen einen nachgebauten Stick. **Das XML des echten Sticks kann nur deine
  Hardware bestätigen.**

## v1.39.2
**English**
- **Every button in Setup now shows that it is working.** nmcli, npm and modem calls take
  seconds; the page looked frozen, so you clicked again — and a second "start hotspot" on
  top of a running one is how NetworkManager ends up half-built. One `run()` wrapper
  disables the button and labels it for the duration of the call, and restores it even if
  the handler throws. Applied to **all 38** async buttons at once, not just the hotspot.
- **Setup links back to the control app.** A **Control ↗** link sits in the setup header —
  shown only when the ground app is actually built on this vehicle (`groundApp` in
  `/api/system`). The ground app already had the mirror-image Setup link, so you can now
  go both ways instead of typing URLs.
- **Fixed: the captive portal was only ever set up at boot.** Starting the hotspot from
  the setup page never wrote the dnsmasq drop-in, so the page could not open by itself —
  which is what you see when you join from a laptop after pressing "Save & start now".
  `hotspotStart` now handles it, before the profile comes up, so nobody has to be
  disconnected for it to apply.
- **…and it is deliberately skipped when the vehicle has an uplink.** The portal works by
  resolving every name to the Pi. With Ethernet or LTE the hotspot **shares that
  internet**, and hijacking DNS would break it for every client — so DNS is left alone and
  the message tells you which of the two happened. Stopping the hotspot removes the
  drop-in again.
- A laptop behaves differently from a phone here: phones pop the page up, GNOME/Windows
  usually just offer a "sign in to network" notification. Documented in HARDWARE §5.

**Deutsch**
- **Jeder Knopf im Setup zeigt jetzt, dass er arbeitet.** nmcli-, npm- und Modem-Aufrufe
  dauern Sekunden; die Seite wirkte eingefroren, also klickt man nochmal — und ein zweites
  „Hotspot starten" auf einem laufenden ist genau der Weg, wie NetworkManager halbfertig
  liegen bleibt. Ein `run()`-Wrapper sperrt den Knopf und beschriftet ihn für die Dauer des
  Aufrufs und stellt ihn selbst dann wieder her, wenn der Handler eine Ausnahme wirft.
  Gilt für **alle 38** asynchronen Knöpfe, nicht nur den Hotspot.
- **Vom Setup geht es zurück zur Steuerung.** Ein **Control ↗**-Link sitzt in der
  Setup-Kopfzeile — nur sichtbar, wenn die Boden-App auf diesem Fahrzeug wirklich gebaut
  ist (`groundApp` in `/api/system`). Die Boden-App hatte den Setup-Link schon; damit
  kommt man jetzt in beide Richtungen, ohne URLs zu tippen.
- **Behoben: das Captive Portal wurde nur beim Booten eingerichtet.** Beim Start über die
  Setup-Seite wurde die dnsmasq-Datei nie geschrieben — die Seite konnte sich also gar
  nicht von selbst öffnen. Genau das sieht man, wenn man sich nach „Save & start now" mit
  dem Laptop verbindet. `hotspotStart` erledigt das jetzt, und zwar **bevor** das Profil
  hochkommt, damit dafür niemand getrennt werden muss.
- **…und es wird bewusst weggelassen, wenn das Fahrzeug einen Uplink hat.** Das Portal
  funktioniert, indem jeder Name auf den Pi zeigt. Mit Ethernet oder LTE **teilt der
  Hotspot dieses Internet**, und DNS umzubiegen würde es für jeden Client zerstören —
  also bleibt DNS in Ruhe, und die Meldung sagt dir, welcher Fall eingetreten ist. Beim
  Stoppen des Hotspots wird die Datei wieder entfernt.
- Ein Laptop verhält sich hier anders als ein Handy: Handys öffnen die Seite von selbst,
  GNOME/Windows bieten meist nur eine „Beim Netzwerk anmelden"-Benachrichtigung. In
  HARDWARE §5 dokumentiert.

## v1.39.1
**English**
- **Fixed: the "open" onboarding hotspot was never open.** `nmcli device wifi hotspot`
  always secures the AP — its man page says "password to use for the created hotspot. If
  not provided, nmcli will generate a password". So the vehicle broadcast **YonderRC-setup
  with a random WPA key nobody could know**, which quietly made the entire documented
  headless onboarding ("join it, the captive portal opens, type nothing") impossible. The
  profile is now built explicitly (`connection add … 802-11-wireless.mode ap …
  ipv4.addresses 192.168.4.1/24`), security is added **only** when you set a password, and
  the key is **read back** afterwards instead of assumed — if the AP ends up secured, the
  page tells you the key rather than leaving you locked out of your own vehicle.
- **Fixed: no hotspot at all, and nothing said why.** Raspberry Pi OS keeps the WiFi radio
  rfkill-blocked until a **WiFi country** is set, and NetworkManager then reports only
  `device is not available`. Setup › WiFi now has a **WiFi radio** block: state, country,
  and one button that unblocks the radio and sets the country — **pre-filled from the Pi's
  own locale/timezone**, so in the normal case you press one button and nothing else.
  Starting the hotspot repairs this on its own and says what it did.
- **Every nmcli failure is translated**, like the npm ones in v1.39.0: blocked radio, no
  country, no WiFi device, a hardware switch, a rejected key, a timeout, an adapter that
  can't do AP mode — each with the step that fixes it, and nmcli's own words underneath.
- `onboard.sh` mirrors all of it, so the **boot-time** hotspot is open too and repairs a
  blocked radio itself (country derived from the locale).
- 25 new tests, including the exact error string this Pi produced. The nmcli calls
  themselves stay hardware-only-verifiable — the flaw they fix was found on real hardware,
  not in the simulator, which is precisely why the sim can't prove them.

**Deutsch**
- **Behoben: der „offene" Onboarding-Hotspot war nie offen.** `nmcli device wifi hotspot`
  verschlüsselt den AP immer — die Manpage sagt es wörtlich: „password to use for the
  created hotspot. If not provided, nmcli will generate a password." Das Fahrzeug funkte
  also **YonderRC-setup mit einem zufälligen WPA-Schlüssel, den niemand kennen konnte**,
  womit das gesamte dokumentierte Onboarding ohne Laptop („verbinden, Captive Portal geht
  auf, nichts tippen") stillschweigend unmöglich war. Das Profil wird jetzt explizit
  gebaut (`connection add … 802-11-wireless.mode ap … ipv4.addresses 192.168.4.1/24`),
  Verschlüsselung kommt **nur** bei einem gesetzten Passwort dazu, und der Schlüssel wird
  danach **zurückgelesen** statt angenommen — landet der AP doch verschlüsselt, nennt die
  Seite den Schlüssel, statt dich aus deinem eigenen Fahrzeug auszusperren.
- **Behoben: gar kein Hotspot, ohne Begründung.** Raspberry Pi OS hält das WLAN-Modul per
  rfkill gesperrt, solange kein **WLAN-Land** gesetzt ist; NetworkManager meldet dann nur
  `device is not available`. Setup › WiFi hat jetzt einen Block **WiFi radio**: Zustand,
  Land und ein Knopf, der das Modul entsperrt und das Land setzt — **vorbelegt aus Locale
  bzw. Zeitzone des Pi**, im Normalfall also ein Klick und sonst nichts. Der Hotspot-Start
  repariert das von selbst und sagt, was er getan hat.
- **Jeder nmcli-Fehler wird übersetzt**, wie in v1.39.0 die von npm: gesperrtes Modul,
  fehlendes Land, kein WLAN-Gerät, Hardware-Schalter, abgelehnter Schlüssel, Timeout, ein
  Adapter ohne AP-Fähigkeit — jeweils mit dem Schritt, der hilft, und darunter nmclis
  eigener Wortlaut.
- `onboard.sh` spiegelt alles, der Hotspot **beim Booten** ist damit ebenfalls offen und
  repariert ein gesperrtes Funkmodul selbst (Land aus der Locale abgeleitet).
- 25 neue Tests, darunter exakt die Fehlermeldung, die dieser Pi ausgegeben hat. Die
  nmcli-Aufrufe selbst bleiben nur auf Hardware verifizierbar — der Fehler, den sie
  beheben, wurde auf echter Hardware gefunden und nicht im Simulator, genau deshalb kann
  der Simulator sie nicht beweisen.

## v1.39.0
**English**
- **Native driver modules install from the browser.** Setup › Vehicle configuration now has
  **Native driver modules**: `i2c-bus`, `pigpio` and `serialport` with their status and an
  **Install** button, plus a **Restart service now** button afterwards. Until now a detected
  PCA9685 or INA228 still meant opening an SSH session — absurd on a vehicle whose whole
  onboarding story is "join its hotspot with a phone".
- **A failed install explains itself.** The npm/node-gyp log is translated into a cause and
  the command that fixes it: no internet (the most likely one — its own hotspot has no
  uplink), missing compiler (`build-essential`), a missing C library (`pigpio` needs its own
  apt package, which is *not* a missing compiler), node-gyp without Python, a full SD card,
  wrong ownership, or a timeout. The raw log tail is shown underneath, because the compiler's
  own last words are sometimes the only real clue.
- **Detect hardware now says when a module is missing.** Finding a device at 0x40 is useless
  while the module that talks to it is absent, so the probe result points at it instead of
  letting the driver fall back to `sim` silently.
- **An update no longer disarms your hardware.** What you install is recorded
  (`hardwareDeps`) and `install.sh` restores it after its `--omit=optional` pass — before,
  every re-run of the installer silently removed the driver modules again.
- Only allowlisted module names ever reach npm (`i2c-bus`/`pigpio`/`serialport`, checked in
  the router *and* in the system layer), the call carries no shell, and the endpoint sits
  behind the API secret like every other mutating call.
- **"npm said it worked" is not proof.** These modules are optional dependencies, so when
  the native build fails npm removes the module again, prints `up to date` and **exits 0**.
  Trusting that exit code would have reported a successful install of a driver that isn't
  there — the very silent failure this feature exists to prevent. Success is therefore
  decided by whether the module actually resolves afterwards, never by npm's exit code.
- Verified in sim end to end (status, install, failure path, allowlist rejection, secret
  gate, persistence), against a **real npm/node-gyp run** on a scratch checkout — which
  really did fail to build and was reported correctly — plus 26 new unit tests covering
  the allowlist and every failure message. Only the arm64/Pi specifics remain
  hardware-only-verifiable.
- One of those tests exists because of a bug found in that real run: a node-gyp stack
  trace contains the identifier `eNotFound`, and a case-insensitive `ENOTFOUND` match
  turned a broken Python into "the Pi has no internet". Error codes are matched
  case-sensitively as whole words now.

**Deutsch**
- **Native Treibermodule installieren sich im Browser.** Setup › Vehicle configuration hat
  jetzt **Native driver modules**: `i2c-bus`, `pigpio` und `serialport` mit Status und
  **Install**-Knopf, danach **Restart service now**. Bisher bedeutete ein erkannter PCA9685
  oder INA228 trotzdem: SSH-Sitzung aufmachen — absurd bei einem Fahrzeug, dessen ganze
  Inbetriebnahme „mit dem Handy in seinen Hotspot" lautet.
- **Ein gescheiterter Build erklärt sich selbst.** Das npm/node-gyp-Protokoll wird in eine
  Ursache plus den passenden Befehl übersetzt: kein Internet (der wahrscheinlichste Fall —
  der eigene Hotspot hat keinen Uplink), fehlender Compiler (`build-essential`), fehlende
  C-Bibliothek (`pigpio` braucht sein eigenes apt-Paket und ist *kein* Compiler-Problem),
  node-gyp ohne Python, volle SD-Karte, falsche Besitzrechte oder ein Timeout. Darunter
  steht das Ende des Rohprotokolls — manchmal ist das letzte Wort des Compilers der einzige
  echte Hinweis.
- **Detect hardware sagt jetzt, wenn ein Modul fehlt.** Ein Gerät auf 0x40 nützt nichts,
  solange das Modul fehlt, das mit ihm spricht — statt still auf `sim` zurückzufallen, weist
  das Ergebnis darauf hin.
- **Ein Update entwaffnet die Hardware nicht mehr.** Was du installierst, wird gemerkt
  (`hardwareDeps`), und `install.sh` stellt es nach seinem `--omit=optional`-Lauf wieder
  her — vorher entfernte jeder Installer-Rerun die Treibermodule klammheimlich.
- Nur Modulnamen von der Positivliste erreichen npm (`i2c-bus`/`pigpio`/`serialport`,
  geprüft im Router *und* in der Systemschicht), der Aufruf läuft ohne Shell, und der
  Endpunkt liegt wie jeder andere schreibende Aufruf hinter dem API-Secret.
- **„npm hat Erfolg gemeldet" ist kein Beweis.** Die Module sind optionale
  Abhängigkeiten: Scheitert der native Build, entfernt npm das Modul wieder, schreibt
  `up to date` und **endet mit Exit-Code 0**. Diesem Code zu glauben hätte einen Treiber
  als installiert gemeldet, der gar nicht da ist — genau das stille Versagen, gegen das
  diese Funktion gebaut ist. Erfolg entscheidet deshalb, ob sich das Modul danach
  tatsächlich auflösen lässt, nie der Exit-Code.
- In sim komplett durchgetestet (Status, Installation, Fehlerpfad, abgelehnte
  Positivliste, Secret-Gate, Persistenz), dazu ein **echter npm/node-gyp-Lauf** in einer
  Wegwerf-Kopie — der tatsächlich scheiterte und korrekt gemeldet wurde — plus 26 neue
  Unit-Tests für Positivliste und jede Fehlermeldung. Offen bleibt nur, was arm64/Pi
  spezifisch ist.
- Einer dieser Tests existiert wegen eines Fehlers aus genau diesem echten Lauf: In einem
  node-gyp-Stacktrace steht der Bezeichner `eNotFound`, und ein case-insensitiver
  Treffer auf `ENOTFOUND` machte daraus „der Pi hat kein Internet", obwohl in Wahrheit
  Python kaputt war. Fehlercodes werden jetzt case-sensitiv als ganze Wörter geprüft.

## v1.38.5
**English**
- **Fixed: `yonderrc-onboard.service` failed to start on a fresh Pi.** `onboard.sh` was
  committed **without the executable bit**, and the unit ran it directly as `ExecStart=`
  — systemd could only answer with `203/EXEC`. The hotspot fallback therefore never came
  up, so a Pi that later lost its network had no way back in. The file is executable now,
  and the unit calls it through `/bin/bash` as well, which also survives an install from
  a source zip (zips do not carry file modes).
- **A failing onboarding service no longer aborts provisioning.** It is enabled on its own
  line now: the hotspot is a fallback, while `go2rtc` and the vehicle service are what
  actually fly the model — the installer prints a hint and runs to the end.

**Deutsch**
- **Behoben: `yonderrc-onboard.service` startete auf einem frischen Pi nicht.** `onboard.sh`
  war **ohne Ausführungsrecht** eingecheckt, und die Unit rief es direkt als `ExecStart=`
  auf — systemd konnte darauf nur mit `203/EXEC` antworten. Der Hotspot-Rückfall kam damit
  nie hoch, ein Pi ohne Netzwerk wäre also nicht mehr erreichbar gewesen. Die Datei ist
  jetzt ausführbar, und die Unit ruft sie zusätzlich über `/bin/bash` auf — das übersteht
  auch eine Installation aus einem Quell-Zip (Zips transportieren keine Dateirechte).
- **Ein fehlschlagender Onboarding-Dienst bricht die Einrichtung nicht mehr ab.** Er wird
  jetzt in einer eigenen Zeile aktiviert: der Hotspot ist ein Rückfall, während `go2rtc`
  und der Fahrzeugdienst das Modell tatsächlich fahren — der Installer gibt einen Hinweis
  aus und läuft bis zum Ende durch.

## v1.38.4
**English**
- **Fixed: provisioning a fresh Raspberry Pi aborted at the ground build.** `install.sh`
  ran `npm install --omit=optional` to keep the native hardware drivers (i2c-bus, pigpio,
  serialport) out of a plain sim install — but npm applies `--omit` to the *whole* tree,
  and rollup and esbuild ship their platform binaries as their own optional dependencies.
  So `vite build` died with `Cannot find module @rollup/rollup-linux-arm64-gnu`, and
  because the script aborts on error the Pi was left **without a built ground app and
  without its systemd services**.
- The installer now runs a second, narrow `npm install --include-workspace-root
  -w @yonderrc/ground` with optional deps allowed: that adds only the rollup/esbuild
  binaries for this architecture (including vite's nested esbuild) — the vehicle's
  hardware drivers stay out, because that workspace is not selected. If the build still
  fails, it retries once with a full install instead of leaving a half-provisioned Pi.
- **Recovering a Pi that already hit this**: `cd /opt/yonderrc && sudo git pull --ff-only
  && sudo bash provisioning/install.sh` — the installer is idempotent.

**Deutsch**
- **Behoben: die Einrichtung eines frischen Raspberry Pi brach beim Ground-Build ab.**
  `install.sh` lief mit `npm install --omit=optional`, um die nativen Hardware-Treiber
  (i2c-bus, pigpio, serialport) aus einer reinen Sim-Installation herauszuhalten — npm
  wendet `--omit` aber auf den *gesamten* Abhängigkeitsbaum an, und rollup und esbuild
  liefern ihre Plattform-Binaries selbst als optionale Abhängigkeiten. `vite build` starb
  deshalb mit `Cannot find module @rollup/rollup-linux-arm64-gnu`, und da das Skript bei
  einem Fehler abbricht, blieb der Pi **ohne gebaute Ground-App und ohne seine
  systemd-Dienste** zurück.
- Der Installer führt jetzt ein zweites, eng gefasstes `npm install
  --include-workspace-root -w @yonderrc/ground` mit optionalen Abhängigkeiten aus: das
  ergänzt nur die rollup/esbuild-Binaries für diese Architektur (inklusive des
  verschachtelten esbuild von vite) — die Hardware-Treiber des Fahrzeugs bleiben draußen,
  weil dieses Workspace nicht ausgewählt ist. Scheitert der Build trotzdem, wird einmal
  mit einer vollständigen Installation wiederholt, statt einen halb eingerichteten Pi
  zu hinterlassen.
- **Einen bereits betroffenen Pi retten**: `cd /opt/yonderrc && sudo git pull --ff-only
  && sudo bash provisioning/install.sh` — der Installer ist idempotent.

## v1.38.3
**English**
- **Fixed: a one-second link blip was announced as an outage.** The WebSocket reconnects
  a second after any close, so a WiFi roam or an LTE handover produced a truthful but
  useless "link lost / link restored" pair. Both now wait ~2 s, and a recovery is only
  spoken for an outage that was actually announced — so a blip is completely silent.
  No safety cost: **failsafe is still announced immediately**, and the vehicle enters it
  300 ms after the frames stop.
- **Fixed: a reconnect announced "link recovered" in the middle of an outage.** The
  link-quality callout was derived from a value that included "are we connected", so
  losing the socket made the health score vanish — which read as a transition out of
  "bad" and cheerfully reported a recovery while the link was down. Presence and quality
  are now decided together: **while the link is down its quality is not bad, it is
  unknown**, and the quality clock restarts on reconnect instead of claiming improvement.
- **The two pairs no longer sound alike.** "Link recovered" next to "Link restored" was
  two near-identical phrases for different events. It is now **lost / restored** for the
  link existing and **weak / good** for how well it works.
- Sustained weakness needs ~3 s before it is spoken — longer than the outage grace,
  because a momentary spike in round-trip or loss is normal and the OSD badge already
  shows it instantly.

**Deutsch**
- **Behoben: ein Ein-Sekunden-Aussetzer wurde als Verbindungsverlust angesagt.** Der
  WebSocket verbindet sich eine Sekunde nach jedem Abriss neu, ein WLAN-Wechsel oder
  LTE-Handover erzeugte also ein zwar wahres, aber nutzloses „link lost / link restored".
  Beide warten jetzt ca. 2 s, und eine Rückkehr wird nur für einen Ausfall angesagt, der
  auch gemeldet wurde — ein Aussetzer bleibt damit komplett stumm. Ohne Sicherheitsverlust:
  **Failsafe wird weiterhin sofort angesagt**, und das Fahrzeug geht 300 ms nach dem
  Ausbleiben der Frames hinein.
- **Behoben: ein Reconnect meldete mitten im Ausfall „link recovered".** Die Ansage zur
  Verbindungsqualität hing an einem Wert, in dem „sind wir verbunden" mit drinsteckte —
  fiel die Verbindung weg, verschwand der Health-Score, was als Übergang aus „schlecht"
  gelesen wurde und fröhlich eine Erholung meldete, während die Verbindung weg war.
  Präsenz und Qualität werden jetzt gemeinsam entschieden: **solange die Verbindung weg
  ist, ist ihre Qualität nicht schlecht, sondern unbekannt**, und die Qualitätsuhr startet
  beim Reconnect neu, statt eine Verbesserung zu behaupten.
- **Die beiden Paare klingen nicht mehr gleich.** „Link recovered" neben „Link restored"
  waren zwei fast identische Formulierungen für verschiedene Ereignisse. Jetzt heißt es
  **lost / restored** für die Existenz der Verbindung und **weak / good** für ihre Güte.
- Anhaltende Schwäche braucht ca. 3 s bis zur Ansage — länger als die Ausfall-Karenz,
  weil eine kurze Spitze bei Round-Trip oder Verlust normal ist und das OSD-Badge sie
  ohnehin sofort zeigt.

## v1.38.2
**English**
- **The return-home reserve is explained properly.** It is a margin on the **trip home**,
  not a percentage of the pack: at 50% you turn around while the pack still holds **1.5×**
  what getting home costs, and arrive with half that cost to spare. So it scales with how
  far out you are — small at 100 m, large at 2 km, which is where a misjudged consumption
  rate gets expensive. Setup › Controls now says exactly that, and points out that it
  guards against **estimation error**, not deep discharge (that's the low-battery warning).
- The code comment said "arrive with half again as much as the trip home costs", which
  was simply wrong — that is the state at the **turn-around** point, not on arrival.

**Deutsch**
- **Die Heimkehr-Reserve ist jetzt richtig erklärt.** Sie ist eine Marge auf den
  **Rückweg**, kein Prozentsatz des Akkus: Bei 50 % kehrst du um, während im Pack noch
  das **1,5-fache** dessen ist, was der Heimweg kostet, und kommst mit der Hälfte davon
  an. Sie skaliert also mit der Entfernung — klein bei 100 m, groß bei 2 km, und genau
  dort wird eine falsch geschätzte Verbrauchsrate teuer. Unter Setup › Controls steht das
  jetzt so, samt dem Hinweis, dass sie gegen **Schätzfehler** schützt und nicht gegen
  Tiefentladung (dafür ist die Akku-Warnung da).
- Der Code-Kommentar behauptete „mit dem Anderthalbfachen ankommen" — das ist schlicht
  falsch, das ist der Zustand am **Umkehrpunkt**, nicht bei der Ankunft.

## v1.38.1
**English**
- **Clearer wording in the return-home budget**: `home 64 of 2143 mAh` instead of
  `home 64 · left 2143 mAh`. With the unit only at the end of the line, the first number
  looked like it had none, and it wasn't obvious the two were the same quantity — the
  cost of the trip home out of what is left in the pack.

**Deutsch**
- **Klarere Beschriftung im Heimkehr-Budget**: `home 64 of 2143 mAh` statt
  `home 64 · left 2143 mAh`. Weil die Einheit nur am Zeilenende stand, sah die erste
  Zahl aus, als hätte sie gar keine — und dass beide dieselbe Größe sind (Kosten des
  Heimwegs von dem, was im Pack übrig ist), war nicht erkennbar.

## v1.38.0
**English**
- **Return-home energy budget** (off by default). A battery percentage cannot answer the
  question you actually have beyond line of sight: 30% is plenty at 50 m and not enough
  at 800 m into a headwind. This measures what the vehicle really consumes per km and
  turns it into a decision — **how much further you may go and still get home** with the
  reserve intact.
- The headline is deliberately a **distance, not a percentage**: `⏎ 1.7 km` answers
  "keep going?" directly. Under it, what the trip home costs and what is left, plus the
  measured mAh/km — the efficiency figure that also shows up a dragging brake or a
  fouled prop. Green while there is room, amber as it tightens, red at **TURN BACK**.
- **Full OSD only** for the block; the **turn-back warning** rides in the badge row, so
  it survives compact mode on a phone, and it is **spoken** when callouts are on.
- **Reserve is configurable** (default 50%): the margin it insists on still having for
  the trip back — headwind, detours, a hill, and a pack that sags at the end.
- **It needs a battery capacity, a current sensor and a GPS home point, and without any
  of them it shows nothing at all.** That is the design, not a limitation: most vehicles
  have none of it, and a PCA9685 on its own is a complete way to drive. Setup › Controls
  says which input is missing, since the OSD deliberately stays silent about it.
- The odometer moved from the OSD into the app, so the distance readout and the energy
  estimate can never disagree about how far the vehicle has gone.

**Deutsch**
- **Heimkehr-Energiebudget** (standardmäßig aus). Ein Akku-Prozentwert beantwortet die
  Frage nicht, die man jenseits der Sichtweite wirklich hat: 30 % sind bei 50 m reichlich
  und bei 800 m gegen den Wind zu wenig. Das hier misst, was das Fahrzeug tatsächlich pro
  km verbraucht, und macht daraus eine Entscheidung — **wie weit du noch weiter darfst
  und trotzdem mit Reserve heimkommst**.
- Die Hauptzahl ist bewusst eine **Distanz, kein Prozentwert**: `⏎ 1,7 km` beantwortet
  „weiterfahren?" direkt. Darunter, was der Heimweg kostet und was übrig ist, dazu die
  gemessenen mAh/km — die Effizienzzahl, an der man auch eine schleifende Bremse oder
  eine verdreckte Schraube sieht. Grün, solange Luft ist, gelb wenn es eng wird, rot bei
  **TURN BACK**.
- Der Block erscheint **nur im vollen OSD**; die **Umkehr-Warnung** sitzt in der
  Badge-Zeile, überlebt also den Kompakt-Modus am Handy, und wird **angesagt**, wenn
  Sprachansagen an sind.
- **Reserve einstellbar** (Standard 50 %): die Marge, die er für den Rückweg
  übrigbehalten will — Gegenwind, Umwege, eine Steigung, und ein Pack, das zum Schluss
  einbricht.
- **Es braucht Akkukapazität, einen Stromsensor und einen GPS-Home-Punkt — fehlt eines
  davon, zeigt es gar nichts.** Das ist die Konstruktion, keine Einschränkung: die
  meisten Fahrzeuge haben nichts davon, und ein PCA9685 allein ist eine vollständige Art,
  ein Fahrzeug zu steuern. Unter Setup › Controls steht, welche Eingangsgröße fehlt —
  das OSD schweigt dazu ja mit Absicht.
- Der Odometer ist vom OSD in die App gewandert, damit Distanzanzeige und
  Energieschätzung sich nie darüber uneinig sein können, wie weit das Fahrzeug gefahren ist.

## v1.37.0
**English**
- **Voice callouts, on by default.** On FPV you watch the picture, not the OSD — a beep
  says *that* something happened, a voice says *what*. Spoken: **link lost / restored**,
  **failsafe**, **armed / disarmed**, and **low battery with the percentage**, repeated
  every 30 s while it stays low. Uses the browser's built-in speech engine, so no
  dependency and no network. Rate adjustable, with a Test button, in Setup › Controls.
- Deliberately nothing beyond that list. A voice that comments on everything is a voice
  you mute, and then the callouts that matter are gone with it. Urgent ones (failsafe,
  link lost, low battery) cut off whatever is still being spoken — by the time "armed"
  has finished playing, "failsafe" is stale news.
- The first connect of a session says nothing: you just pressed Connect and are looking
  at the screen. Only an actual **re**connect is announced.
- **Link health as one number.** Round-trip, packet loss and radio signal become a
  single 0–100 score with a trend arrow, green / amber / red. The score is the **worst**
  of the three, not an average — a perfect radio signal must not be able to hide 15%
  packet loss, which averaging would do.
- **The individual numbers are hidden while the link is good and come back by
  themselves the moment it isn't.** That's the point: "link 34, falling" tells you to
  react but not how, while "packet loss 12%" and "signal 18%" point at different fixes —
  and a dying link is the worst moment to go hunting for a setting. A second badge names
  what is dragging the score down. Setup can force the numbers on permanently.
- The trend arrow uses a deadband over a ~12 s history, so a single noisy sample can't
  flip it back and forth.

**Deutsch**
- **Sprachansagen, standardmäßig an.** Bei FPV schaust du aufs Bild, nicht aufs OSD — ein
  Piepser sagt, *dass* etwas ist, eine Stimme sagt, *was*. Angesagt werden: **Verbindung
  verloren / wieder da**, **Failsafe**, **armiert / entschärft** und **niedriger Akku mit
  Prozentwert**, alle 30 s wiederholt, solange er niedrig bleibt. Nutzt die eingebaute
  Sprachausgabe des Browsers — keine Abhängigkeit, kein Netz. Geschwindigkeit einstellbar,
  mit Test-Button, unter Setup › Controls.
- Bewusst nichts darüber hinaus. Eine Stimme, die alles kommentiert, ist eine Stimme, die
  man stummschaltet — und dann sind die wichtigen Ansagen mit weg. Dringende (Failsafe,
  Verbindung verloren, Akku leer) unterbrechen das, was gerade läuft: bis „armiert"
  zu Ende gesprochen ist, ist „Failsafe" alte Nachricht.
- Der erste Verbindungsaufbau einer Sitzung sagt nichts — du hast gerade Connect gedrückt
  und schaust hin. Nur ein echter **Wieder**verbindungsaufbau wird angesagt.
- **Link-Gesundheit als eine Zahl.** Round-Trip, Paketverlust und Funksignal werden zu
  einem Wert von 0–100 mit Trendpfeil, grün / gelb / rot. Die Zahl ist das
  **Schlechteste** der drei, kein Mittelwert — ein perfektes Funksignal darf 15 %
  Paketverlust nicht verdecken können, und genau das täte ein Mittelwert.
- **Die Einzelwerte bleiben ausgeblendet, solange der Link gut ist, und kommen von
  selbst zurück, sobald er es nicht mehr ist.** Darum geht es: „Link 34, fallend" sagt
  dir, dass du reagieren musst, aber nicht wie — „Paketverlust 12 %" und „Signal 18 %"
  verlangen unterschiedliche Reaktionen. Und ein sterbender Link ist der schlechteste
  Moment, um eine Einstellung zu suchen. Ein zweites Badge benennt, was die Zahl
  herunterzieht. Im Setup lassen sich die Zahlen dauerhaft einblenden.
- Der Trendpfeil nutzt einen Totbereich über eine ca. 12 s lange Historie, damit ein
  einzelner Ausreißer ihn nicht hin- und herspringen lässt.

## v1.36.1
**English**
- **Fixed: holding a button on iOS selected its label.** Since v1.35 several buttons
  need a ~0.3 s press, and on iOS that is precisely the gesture that starts a text
  selection and pops the callout menu — so holding the lights toggle or a trim
  highlighted the text instead of feeling like a press. `user-select: none` alone
  doesn't stop it on Safari; `-webkit-touch-callout: none` was missing everywhere and
  is now set on every control at once, rather than per button, so the next control that
  grows a hold doesn't hit the same thing.
- The speed-limit buttons also lacked `-webkit-user-select` entirely, and used
  `touch-action: manipulation` — a page scroll starting on one could cancel the press
  half way through. Both corrected to match the other hold buttons.

**Deutsch**
- **Behoben: Ein Button gedrückt zu halten markierte unter iOS seine Beschriftung.** Seit
  v1.35 brauchen mehrere Buttons ca. 0,3 s Druck — und genau diese Geste startet unter
  iOS eine Textauswahl samt Kontextmenü. Den Licht-Toggle oder einen Trim zu halten
  markierte also den Text, statt sich nach einem Druck anzufühlen. `user-select: none`
  allein reicht in Safari nicht; `-webkit-touch-callout: none` fehlte überall und steht
  jetzt für alle Bedienelemente gemeinsam, nicht pro Button — damit das nächste Element
  mit Haltezeit nicht in dieselbe Falle läuft.
- Den Speed-Limit-Buttons fehlte zusätzlich `-webkit-user-select` komplett, und sie
  nutzten `touch-action: manipulation` — ein auf ihnen beginnendes Scrollen konnte den
  Druck auf halbem Weg abbrechen. Beides an die übrigen Halte-Buttons angeglichen.

## v1.36.0
**English**
- **Response curves per stick channel** — the thing expo cannot express. Expo is one
  number and always symmetric around centre; a curve gives you the actual shape: gentle
  to half throttle and then opening up, soft at the extremes but direct in the middle,
  a dead flat section, whatever the model wants. **Off by default** — a channel without
  one behaves bit-for-bit as before.
- 3, 5, 7 or 9 points, evenly spaced, linear interpolation between them, with a **live
  plot** next to the numbers. The dashed diagonal stays visible underneath so the
  deviation from linear is the thing you see. Changing the point count **resamples** the
  shape you already have instead of discarding it.
- **The two end points are fixed at ±100%.** Travel is limited with `min/max µs`, which
  already exists — a curve that could also cut the ends would be a confusing second way
  to do it, and it would quietly break the guarantee the safety chain rests on: that a
  resting stick produces the channel's off value. With the ends pinned, the **disarmed
  value, the failsafe and the pre-arm check keep working whatever shape you draw**, and
  there are tests for exactly that, including a curve that tries to cut the ends off.
- Applied **before** expo, so the curve's X axis is the stick position itself — which is
  what makes the plot readable — and the two can be combined. Only proportional
  channels get one: a switch has two positions and nothing in between to shape.

**Deutsch**
- **Kennlinien pro Stick-Kanal** — genau das, was Expo nicht kann. Expo ist eine Zahl und
  immer symmetrisch um die Mitte; eine Kurve gibt dir den tatsächlichen Verlauf: bis
  Halbgas sanft und dann aufmachend, an den Enden weich und in der Mitte direkt, ein
  flacher Totbereich, was das Modell eben braucht. **Standardmäßig aus** — ein Kanal ohne
  Kurve verhält sich exakt wie bisher.
- 3, 5, 7 oder 9 gleichmäßig verteilte Punkte, linear interpoliert, mit einem
  **Live-Diagramm** neben den Zahlen. Die gestrichelte Diagonale bleibt darunter
  sichtbar, damit die Abweichung von der Geraden das ist, was man sieht. Ändert man die
  Punktzahl, wird die vorhandene Form **neu abgetastet** statt verworfen.
- **Die beiden Endpunkte sind auf ±100 % fixiert.** Den Weg begrenzt man mit
  `min/max µs`, das gibt es bereits — eine Kurve, die die Enden ebenfalls kappen könnte,
  wäre ein verwirrender zweiter Weg dorthin und würde stillschweigend die Garantie
  brechen, auf der die Sicherheitskette steht: dass ein ruhender Stick den Aus-Wert des
  Kanals erzeugt. Mit fixierten Enden funktionieren **Disarm-Wert, Failsafe und
  Pre-Arm-Check unabhängig davon, welche Form du zeichnest** — dafür gibt es Tests,
  inklusive einer Kurve, die versucht, die Enden abzuschneiden.
- Wird **vor** dem Expo angewendet, damit die X-Achse der Kurve die Stickposition selbst
  ist — das macht das Diagramm erst lesbar — und beides kombinierbar bleibt. Nur
  proportionale Kanäle bekommen eine: ein Schalter hat zwei Stellungen und nichts
  dazwischen zu formen.

## v1.35.0
**English**
- **Live trims.** A collapsible *Trims* panel under the sticks (and under the video for
  keyboard/gamepad models) nudges a stick channel's neutral by 5 µs a press, up to
  ±150 µs, with a reset per channel. The car pulls left, you tap right — no trip to
  Setup. The value lands in the channel's existing `shaping.trimUs`, so it's the same
  number as `trim µs` in Setup › Channels and is saved with the model.
- **A short hold on the buttons that change something lasting.** Toggle channels, the
  speed limiter and the trims now need ~0.3 s of press before they act, on the screen
  and on a controller alike — long enough to reject brushing one with a thumb, short
  enough not to feel broken. Each button fills up while you hold it, the way the arm
  button does.
- Deliberately **not** covered, and this is the point of the list: **momentary channels**
  (a horn has to sound the instant you press it), **hold-ramp channels** (holding is
  already the gesture), and the **sticks** — steering and throttle are never delayed.
  Arm keeps its own longer, separate hold; panic-disarm stays instant.
- Configurable in Setup › Controls (0.1–3 s, or off — off restores exactly the previous
  tap behaviour). Per browser, like the other ground-side safety options.
- The action hold is now **per action** rather than one time for all of them, because
  arming (~1 s confirmation) and the speed limiter (~0.3 s filter) want different
  things from the same mechanism.

**Deutsch**
- **Live-Trims.** Ein aufklappbares *Trims*-Feld unter den Sticks (bzw. unter dem Video
  bei Tastatur-/Gamepad-Modellen) verschiebt die Mittelstellung eines Stick-Kanals um
  5 µs pro Druck, bis ±150 µs, mit Reset je Kanal. Das Auto zieht nach links, du tippst
  nach rechts — ohne Umweg über Setup. Der Wert landet im vorhandenen
  `shaping.trimUs` des Kanals, ist also dieselbe Zahl wie `trim µs` unter Setup ›
  Channels und wird mit dem Modell gespeichert.
- **Kurze Haltezeit für die Buttons, die etwas Dauerhaftes verstellen.** Toggle-Kanäle,
  der Speed-Limiter und die Trims brauchen jetzt ca. 0,3 s Druck, bevor sie auslösen —
  am Bildschirm wie am Controller. Lang genug, um ein versehentliches Streifen
  abzuweisen, kurz genug, um sich nicht kaputt anzufühlen. Jeder Button füllt sich
  während des Haltens, so wie der Arm-Button.
- Bewusst **nicht** betroffen, und darum geht es bei dieser Liste: **Momentary-Kanäle**
  (eine Hupe muss im Moment des Drückens kommen), **Hold-Ramp-Kanäle** (Halten ist dort
  bereits die Geste) und die **Sticks** — Lenkung und Gas werden nie verzögert. Arm
  behält seine eigene, längere Haltezeit; Panic-Disarm bleibt sofort.
- Einstellbar unter Setup › Controls (0,1–3 s, oder aus — aus stellt exakt das bisherige
  Tipp-Verhalten wieder her). Pro Browser, wie die anderen Sicherheitsoptionen der
  Bodenstation.
- Die Haltezeit für Aktionen ist jetzt **pro Aktion** statt einer Zeit für alle, weil
  Armieren (~1 s Bestätigung) und Speed-Limiter (~0,3 s Filter) vom selben Mechanismus
  Unterschiedliches wollen.

## v1.34.1
**English**
- **Setup › Channels now warns when a throttle failsafe would open the throttle.** The
  failsafe is stored as a raw µs and never passes through shaping, so on a channel with
  `reverse` ticked the seeded 1000 µs — which meant "motor off" when the profile was
  built — silently becomes **full power on link loss**, while the number in the editor
  still reads a perfectly innocent 1000. v1.34.0 fixed the disarmed value, which is
  derived; this covers the failsafe, which is yours to set and so is flagged rather
  than rewritten behind your back.
- The warning names the actual figure and the fix: *"Failsafe 1000 µs = 100% throttle on
  this channel (reverse is on) — Motor-off here is 2000 µs."* It sits above the collapsed
  shaping row, so it's visible without expanding anything, and clears the moment the
  value is corrected.
- Threshold is blunt on purpose — it only fires above half throttle, so a plane
  deliberately set to cruise home on a low failsafe throttle stays quiet. Drone, car and
  boat failsafe at centre, which is reverse-symmetric, and never trigger it.

**Deutsch**
- **Setup › Channels warnt jetzt, wenn ein Gas-Failsafe das Gas aufziehen würde.** Der
  Failsafe wird als roher µs-Wert gespeichert und läuft nie durch die Shaping — auf
  einem Kanal mit gesetztem `reverse` wird aus den beim Anlegen gesetzten 1000 µs, die
  „Motor aus" bedeuteten, klammheimlich **volle Leistung bei Verbindungsabriss**,
  während im Editor weiterhin unverdächtige 1000 stehen. v1.34.0 hat den Disarmed-Wert
  behoben, der abgeleitet wird; das hier deckt den Failsafe ab, den du selbst setzt und
  der deshalb markiert statt hinter deinem Rücken überschrieben wird.
- Die Warnung nennt die konkrete Zahl und die Lösung: *„Failsafe 1000 µs = 100 % Gas auf
  diesem Kanal (reverse ist an) — Motor aus ist hier 2000 µs."* Sie steht über der
  zugeklappten Shaping-Zeile, ist also ohne Aufklappen sichtbar, und verschwindet, sobald
  der Wert korrigiert ist.
- Die Schwelle ist bewusst grob — sie greift erst oberhalb von halbem Gas, damit ein
  Flugzeug, das absichtlich mit wenig Gas heimfliegen soll, still bleibt. Drohne, Auto
  und Boot haben ihren Failsafe in der Mitte, was reverse-symmetrisch ist, und lösen ihn
  nie aus.

## v1.34.0
**English**
- **Fixed (safety): a reversed throttle channel disarmed to FULL THROTTLE.** The
  disarmed value was read flat off the profile endpoints (`endpoints.minUs` for plane
  and drone), ignoring the channel's own `reverse` flag. With `reverse` ticked the idle
  stick maps to **max**, so "motors off" is 2000 µs on that channel — and sending 1000
  µs meant full power the moment you disarmed. It is now **derived** by running the
  resting stick position through the channel's own shaping, so reverse, per-channel
  endpoints and trim all count. Car and boat were never affected (they stop at centre,
  which is reverse-symmetric); an unreversed channel gets exactly the same value as
  before. Covered by tests across all four vehicle types with reverse on and off.
- **The fullscreen button now works on a phone.** It never did on iPhone: Safari has no
  `Element.requestFullscreen` there (iPadOS 13+ does), so the old `requestFullscreen?.()`
  quietly evaluated to nothing. Fullscreen is a CSS mode now — a fixed, `100dvh` stage
  that tracks Safari's sliding toolbar — so it behaves the same everywhere, and the real
  Fullscreen API is layered on top where it exists to hide the browser chrome too. The
  **OSD comes along**; leave with the Exit button in the corner or Esc.
- While fullscreen the page can't scroll or zoom under a finger (`touch-action: none`
  — iOS ignores `user-scalable=no`, so that meta tag was never the defence). The OSD
  keeps clear of the notch and home indicator via the safe-area insets.
- Touch sticks stay on the page behind and can't be reached from fullscreen; while
  **armed** a line says so, since that's when not being able to steer matters.
- Fixed on the way: the wide-screen `max-height: 60vh` cap on the video stage also
  applied in fullscreen, leaving the desktop picture at two-thirds height while the
  phone looked right.

**Deutsch**
- **Behoben (Sicherheit): ein reversierter Gaskanal ging beim Disarm auf VOLLGAS.** Der
  Disarmed-Wert wurde pauschal aus den Profil-Endpoints gelesen (`endpoints.minUs` bei
  Flugzeug und Drohne) und ignorierte das `reverse`-Flag des Kanals. Mit gesetztem
  `reverse` liegt der Leerlauf-Stick auf **max**, „Motoren aus" ist auf diesem Kanal
  also 2000 µs — 1000 µs zu senden bedeutete volle Leistung im Moment des Entschärfens.
  Der Wert wird jetzt **abgeleitet**: die Ruhelage des Sticks läuft durch die Shaping
  des Kanals, damit zählen Reverse, kanaleigene Endpoints und Trim. Auto und Boot waren
  nie betroffen (sie stoppen in der Mitte, das ist reverse-symmetrisch); ein nicht
  reversierter Kanal bekommt exakt den bisherigen Wert. Durch Tests über alle vier
  Fahrzeugtypen mit Reverse an und aus abgedeckt.
- **Der Fullscreen-Button funktioniert jetzt am Handy.** Auf dem iPhone tat er noch nie
  etwas: Safari hat dort kein `Element.requestFullscreen` (iPadOS 13+ schon), das alte
  `requestFullscreen?.()` lief also ins Leere. Fullscreen ist jetzt ein CSS-Modus — eine
  fixierte `100dvh`-Bühne, die Safaris ein- und ausfahrende Leiste mitrechnet — und
  verhält sich überall gleich; die echte Fullscreen-API kommt obendrauf, wo es sie gibt,
  um zusätzlich die Browserleiste auszublenden. Das **OSD bleibt sichtbar**; raus über
  den Exit-Button in der Ecke oder Esc.
- Im Vollbild kann die Seite unter dem Finger weder scrollen noch zoomen
  (`touch-action: none` — iOS ignoriert `user-scalable=no`, dieses Meta-Tag war nie der
  Schutz). Das OSD hält sich per Safe-Area-Insets von Notch und Home-Indikator frei.
- Die Touch-Sticks bleiben auf der Seite dahinter und sind im Vollbild nicht erreichbar;
  im **armierten** Zustand weist eine Zeile darauf hin — dann zählt es.
- Nebenbei behoben: der `max-height: 60vh`-Deckel der Videobühne für breite Fenster galt
  auch im Vollbild und ließ das Desktop-Bild auf zwei Dritteln Höhe stehen, während es
  am Handy passte.

## v1.33.2
**English**
- **The throttle row in Setup › Channels now shows its disarmed value** next to the
  failsafe: `fs 1500 · disarmed 1000`. Those two are deliberately different on a drone
  — failsafe is link loss *while armed* (hold, don't drop it), disarmed is switched off
  on the ground (motors off) — and seeing only `fs 1500` next to a channel sitting at
  1000 in the monitor looked like a contradiction. Shown on throttle channels only,
  where it's the one value that differs, with the reasoning on the tooltip.

**Deutsch**
- **Die Throttle-Zeile unter Setup › Channels zeigt jetzt ihren Disarmed-Wert** neben
  dem Failsafe: `fs 1500 · disarmed 1000`. Die beiden unterscheiden sich bei einer
  Drohne mit Absicht — Failsafe ist Verbindungsabriss *im armierten Zustand* (halten,
  nicht abstürzen lassen), Disarmed ist bewusst abgeschaltet am Boden (Motoren aus) —
  und nur `fs 1500` neben einem Kanal zu sehen, der im Monitor auf 1000 steht, sah nach
  einem Widerspruch aus. Nur auf Throttle-Kanälen, wo dieser Wert überhaupt abweicht;
  die Begründung steht im Tooltip.

## v1.33.1
**English**
- **Fixed: a channel row in Setup › Channels broke apart when its label was long.**
  The row was a wrapping flexbox whose mode text carried `margin-left: auto`, so once
  the content no longer fitted, the auto margin scattered the leftovers — the Throttle
  row (the longest label) split with "Remove" dropping to a second line while every
  other row stayed intact. The row is a grid now: above 640 px it's one line, below it
  the mode moves to its own full-width line under the label — the same way for **every**
  channel, whatever the label is called. The mode text truncates rather than wrapping
  into a column of single letters, with the full value on its tooltip.

**Deutsch**
- **Behoben: eine Kanalzeile unter Setup › Channels ist bei langem Label zerfallen.**
  Die Zeile war eine umbrechende Flexbox, deren Modus-Text `margin-left: auto` trug —
  sobald der Inhalt nicht mehr passte, verteilte die Auto-Margin die Reste: Die
  Throttle-Zeile (das längste Label) brach auf, „Remove" rutschte in eine zweite Zeile,
  während alle anderen Zeilen einzeilig blieben. Jetzt ist die Zeile ein Grid: über
  640 px einzeilig, darunter wandert der Modus in eine eigene Zeile über die volle
  Breite unter das Label — für **jeden** Kanal gleich, egal wie das Label heißt. Der
  Modus-Text wird abgeschnitten statt zu einer Buchstabensäule umzubrechen, der
  vollständige Wert steht im Tooltip.

## v1.33.0
**English**
- **The blackbox now logs the GPS track.** `lat`, `lon`, `alt_m`, `sats`, `hdop`,
  `speed_ms` and `course_deg` are written into the *same row* as the electrics and the
  link stats, at the same 2 Hz. That's the point of putting them there rather than in a
  separate file: in QGIS or kepler.gl you can colour the route by pack voltage or
  round-trip and see **where** the link gets bad, not just that it did.
- **New "Download GPX" button** (Setup › Controls) writes a GPX 1.1 track — elevation,
  satellites and HDOP per point, speed and course in the Garmin `TrackPointExtension`.
  Google Earth, [gpx.studio](https://gpx.studio), Garmin BaseCamp, GPSBabel, QGIS and
  Strava read it as-is. The button stays disabled until a row actually carries a fix,
  and the status line shows the fix count next to the row count.
- Rows recorded **without** a fix log empty coordinates rather than the last known
  position — a frozen point would look like the vehicle parked there. Satellite count is
  still logged while searching, so you can see the receiver coming up.
- **The GPS sim now circles over Balingen (72336)** at ~517 m instead of Berlin, so a
  sim track lands where the project does.

**Deutsch**
- **Die Blackbox loggt jetzt die GPS-Strecke.** `lat`, `lon`, `alt_m`, `sats`, `hdop`,
  `speed_ms` und `course_deg` stehen in *derselben Zeile* wie Elektrik und
  Link-Statistik, mit denselben 2 Hz. Genau deshalb stecken sie dort und nicht in einer
  zweiten Datei: In QGIS oder kepler.gl lässt sich die Route nach Akkuspannung oder
  Round-Trip einfärben — man sieht also, **wo** die Verbindung schlecht wird, nicht nur
  dass sie es war.
- **Neuer Button „Download GPX"** (Setup › Controls) schreibt eine GPX-1.1-Strecke — Höhe,
  Satelliten und HDOP je Punkt, Geschwindigkeit und Kurs in der Garmin-Erweiterung
  `TrackPointExtension`. Google Earth, [gpx.studio](https://gpx.studio), Garmin BaseCamp,
  GPSBabel, QGIS und Strava lesen das direkt. Der Button bleibt gesperrt, solange keine
  Zeile einen Fix trägt; die Statuszeile zeigt die Zahl der Fixe neben der Zeilenzahl.
- Zeilen **ohne** Fix loggen leere Koordinaten statt der letzten bekannten Position — ein
  eingefrorener Punkt sähe aus, als stünde das Fahrzeug dort. Die Satellitenzahl wird
  auch während der Suche geloggt, damit man den Empfänger hochkommen sieht.
- **Die GPS-Sim kreist jetzt über Balingen (72336)** auf ca. 517 m statt über Berlin,
  damit eine Sim-Strecke dort landet, wo das Projekt herkommt.

## v1.32.0
**English**
- **The Car template now defaults to stick mode 2.** A car needs only two axes, and mode 2
  puts both on the **left stick** — steering on X, throttle on Y — so one thumb drives it
  on a phone. Mode 4 splits them across two sticks if you prefer that; switch any time in
  Setup › Model.
- **Fixed: a template's default stick mode was recorded but never applied.** `buildProfile`
  stored `stickMode` while laying the axes out exactly as written in the template, so a
  template whose default differed from that layout produced a profile claiming a mode it
  wasn't in. The mode is now applied when the profile is built — a no-op for boat, plane
  and drone, whose layouts already matched.
- Existing models keep their stick mode; this changes what a **new** model from the
  template looks like (and what a factory reset seeds).

**Deutsch**
- **Die Auto-Vorlage steht jetzt standardmäßig auf Stick-Mode 2.** Ein Auto braucht nur
  zwei Achsen, und Mode 2 legt beide auf den **linken Stick** — Lenkung auf X, Gas auf Y —
  damit fährt man es am Handy mit einem Daumen. Mode 4 verteilt sie auf zwei Sticks, wenn
  dir das lieber ist; jederzeit umstellbar unter Setup › Model.
- **Behoben: der Standard-Stick-Mode einer Vorlage wurde vermerkt, aber nie angewendet.**
  `buildProfile` hat `stickMode` gespeichert und die Achsen trotzdem genau so gelegt, wie
  sie in der Vorlage stehen — eine Vorlage, deren Standard von dieser Anordnung abweicht,
  erzeugte also ein Profil, das einen Mode behauptete, in dem es gar nicht war. Der Mode
  wird jetzt beim Erzeugen angewendet — für Boot, Flugzeug und Drohne ohne Wirkung, deren
  Anordnung passte bereits.
- Bestehende Modelle behalten ihren Stick-Mode; das ändert, wie ein **neues** Modell aus
  der Vorlage aussieht (und was ein Factory Reset anlegt).

## v1.31.3
**English**
- **The default arm hold is now 1 s** (was 2 s). Still long enough to filter out a tap or
  a bumped controller button, but quicker to arm. An already-stored hold time is
  untouched — this only changes the default for a fresh install or after a factory reset;
  the time stays adjustable (0.5–10 s) and switchable off in Setup › Controls.

**Deutsch**
- **Die Standard-Haltezeit zum Armen ist jetzt 1 s** (vorher 2 s). Immer noch lang genug,
  um ein Antippen oder einen angestoßenen Controller-Button abzufangen, aber schneller
  beim Armen. Eine bereits gespeicherte Haltezeit bleibt unverändert — das ändert nur die
  Vorgabe für eine frische Installation bzw. nach einem Factory Reset; die Zeit bleibt
  einstellbar (0,5–10 s) und abschaltbar unter Setup › Controls.

## v1.31.2
**English**
- **ESC calibration now uses the throttle channel's own endpoints.** It sent the
  profile-wide *Endpoints* values, so narrowing just the throttle channel (say to
  1200–1800 µs) still calibrated the ESC to 1000–2000 — teaching it a range it is never
  driven with. The channel's values now win, with the profile-wide ones as a fallback.
- **The calibration panel says what it is about to do** before the motor runs:
  "Will teach the ESC CH03: max 1800 µs → min 1200 µs", and warns when the selected
  channel isn't this model's throttle.
- **The channel field follows the model.** It was filled in once when the panel mounted,
  so switching models (or moving the throttle) left it pointing at the previous channel.
- **Fixed "Endpoints (ms)" in the UI.** The label always said µs in the source, but CSS
  `text-transform: uppercase` maps the MICRO SIGN to GREEK CAPITAL MU — visually a Latin
  M, so it read as milliseconds. Units in uppercased headings now opt out of the
  transform.
- The *Endpoints* field is now labelled and described as what it is: a **batch write**
  into every channel, adjustable per channel afterwards — not a cap that keeps applying.

**Deutsch**
- **Die ESC-Kalibrierung nimmt jetzt die Endpunkte des Gaskanals selbst.** Sie hat die
  profilweiten *Endpoints* geschickt — wer nur den Gaskanal enger stellte (etwa auf
  1200–1800 µs), kalibrierte den ESC trotzdem auf 1000–2000 und lehrte ihm damit einen
  Bereich, mit dem er nie gefahren wird. Jetzt gewinnen die Werte des Kanals, die
  profilweiten sind nur noch Rückfallebene.
- **Das Kalibrier-Panel sagt vorher, was es tun wird**, bevor der Motor läuft: „Will
  teach the ESC CH03: max 1800 µs → min 1200 µs" — mit Warnung, wenn der gewählte Kanal
  nicht der Gaskanal des Modells ist.
- **Das Kanal-Feld folgt dem Modell.** Es wurde einmalig beim Aufbau des Panels gefüllt;
  ein Modellwechsel (oder ein verschobener Gaskanal) ließ es auf dem alten Kanal stehen.
- **„Endpoints (ms)" in der Oberfläche behoben.** Im Quelltext stand immer µs, aber CSS
  `text-transform: uppercase` bildet das MICRO SIGN auf das griechische große My ab —
  optisch ein lateinisches M, also las es sich als Millisekunden. Einheiten in
  großgeschriebenen Überschriften sind jetzt von der Umwandlung ausgenommen.
- Das *Endpoints*-Feld heißt und erklärt sich jetzt als das, was es ist: ein
  **Sammel-Schreibvorgang** in alle Kanäle, danach pro Kanal anpassbar — keine dauerhaft
  wirkende Begrenzung.

## v1.31.1
**English**
- **Fixed: a touch model could come up with a missing joystick and refuse to arm.**
  Profiles live in the browser and outlive the version that wrote them. Before v1.10.0 a
  transmitter-mode switch reassigned a stick axis without re-deriving its input element,
  so a stored model could end up with, say, its throttle axis still on the *keyboard*
  source while the model ran on **touch**. The control pad only draws virtual `joy:…`
  bindings, so that stick was never rendered — and because nothing drove the channel it
  sat at centre instead of idle, which made the pre-arm check refuse with "throttle not
  at idle".
- Models are now **repaired once when they load** and written back: an axis binding gets
  the source and element its input method requires. Aux and user-added channels are left
  untouched. Switching the input method away and back was the manual workaround; it is no
  longer needed.

**Deutsch**
- **Behoben: ein Touch-Modell konnte mit fehlendem Joystick starten und das Armen
  verweigern.** Profile liegen im Browser und überleben die Version, die sie geschrieben
  hat. Vor v1.10.0 hat ein Sendermodus-Wechsel eine Stick-Achse umgehängt, ohne ihr
  Eingabe-Element neu abzuleiten — ein gespeichertes Modell konnte also seine Gas-Achse
  noch auf der *Tastatur*-Quelle haben, während das Modell auf **Touch** lief. Das
  Control-Pad zeichnet nur virtuelle `joy:…`-Bindungen, dieser Stick fehlte also — und
  weil niemand den Kanal gefahren hat, stand er auf Mitte statt Leerlauf, worauf der
  Pre-Arm-Check mit „throttle not at idle" blockierte.
- Modelle werden jetzt **beim Laden einmal repariert** und zurückgeschrieben: eine
  Achsen-Bindung bekommt Quelle und Element, die ihre Eingabemethode verlangt. Aux- und
  selbst angelegte Kanäle bleiben unangetastet. Der Workaround (Eingabemethode einmal
  hin und zurück schalten) ist damit überflüssig.

## v1.31.0
**English**
- **Fixed: the throttle channel could go stale.** A profile stored `throttleChannels`
  from its template, but moving a binding to another channel in the editor never updated
  that list — and the **disarmed value, the failsafe array, the pre-arm check**, the OSD
  bar and the ESC calibration all read it. A plane whose throttle had been moved held
  *centre* on link loss instead of motor-off, and passed the stick straight through while
  "disarmed". The channel is now derived from the bindings (`throttleChannelsOf`), with
  the stored list as a fallback, and the editor writes the derived list back on every
  edit, so older models heal themselves.
- **Speed limiter with three steps.** Low / Mid / High (percent per model, default
  40/70/100) as three buttons under the sticks and the channel buttons; the values are
  edited on the throttle channel in Setup, and a bindable controller button cycles them.
- The command is **scaled around the throttle's rest position**, so one rule covers both
  cases: a **centre** detent (car with reverse, drone) is capped forwards *and*
  backwards, a **low/free** detent (plane, ratcheted throttle) keeps its exact idle and
  is capped only upwards. Scaled, not clipped — the full stick travel stays usable.
- The limiter only changes what is **sent**: endpoints, failsafe, the disarmed value and
  the pre-arm check keep working off the true rest position, and the pre-arm check still
  sees the raw stick command. The OSD shows `LIM 40%` next to the throttle bar while a
  limit is active.

**Deutsch**
- **Behoben: der Gaskanal konnte veralten.** Ein Profil speicherte `throttleChannels` aus
  seiner Vorlage, aber das Verschieben einer Bindung auf einen anderen Kanal im Editor
  hat diese Liste nie aktualisiert — und **Disarm-Wert, Failsafe-Array, Pre-Arm-Check**,
  OSD-Balken und ESC-Kalibrierung lesen genau sie. Ein Flugzeug mit verschobenem Gas
  hielt bei Link-Verlust *Mitte* statt Motor aus und reichte den Stick im „disarmten"
  Zustand einfach durch. Der Kanal wird jetzt aus den Bindungen abgeleitet
  (`throttleChannelsOf`), mit der gespeicherten Liste als Rückfallebene, und der Editor
  schreibt die abgeleitete Liste bei jeder Änderung zurück — alte Modelle heilen sich
  damit selbst.
- **Tempolimit mit drei Stufen.** Low / Mid / High (Prozent pro Modell, Vorgabe
  40/70/100) als drei Buttons unter den Sticks und den Kanal-Buttons; die Werte werden am
  Gaskanal im Setup eingestellt, ein belegbarer Controller-Button schaltet durch.
- Der Befehl wird **um die Ruhelage des Gaskanals skaliert**, eine Regel deckt damit
  beide Fälle: **Mitte** (Auto mit Rückwärtsgang, Drohne) wird nach oben *und* unten
  begrenzt, **min/frei** (Flugzeug, gerastertes Gas) behält den exakten Leerlauf und wird
  nur nach oben begrenzt. Skaliert statt abgeschnitten — der volle Stickweg bleibt
  nutzbar.
- Das Limit ändert nur das, was **gesendet** wird: Endpunkte, Failsafe, Disarm-Wert und
  Pre-Arm-Check arbeiten weiter mit der echten Ruhelage, und der Pre-Arm-Check sieht
  weiterhin den rohen Stickbefehl. Im OSD steht `LIM 40%` neben dem Gasbalken, solange
  ein Limit aktiv ist.

## v1.30.0
**English**
- **Panic-disarm now ships unbound** — for every vehicle type and input method. It used
  to default to **Escape**, and it is the one control with *no hold and no
  confirmation*: an accidental press cuts the motors, which on an aircraft means a
  crash. Bind it yourself in Setup › Controls to a key or controller button you can't
  hit by accident — and if you fly with a controller, bind it *on the controller*, since
  a keyboard key is no use with both hands on the sticks.
- **Existing installs are migrated**: bindings move to `yonderrc.actions.v2`, and a
  stored panic binding that is exactly the old shipped `Escape` default is dropped —
  it was never a deliberate choice. Anything you actually picked (including Escape plus
  a button) survives untouched.
- The Controls panel now says why panic is unbound and what to bind it to.

**Deutsch**
- **Panic-Disarm ist jetzt ab Werk unbelegt** — für jeden Fahrzeugtyp und jede
  Eingabemethode. Bisher lag es standardmäßig auf **Escape**, und es ist die einzige
  Funktion *ohne Halten und ohne Rückfrage*: ein versehentlicher Druck kappt die
  Motoren, bei einem Luftfahrzeug also Absturz. Selbst belegen unter Setup › Controls,
  auf eine Taste oder Controller-Taste, die man nicht aus Versehen trifft — und wer mit
  Controller fliegt, legt sie *auf den Controller*, denn eine Tastaturtaste nützt nichts,
  wenn beide Hände an den Sticks sind.
- **Bestehende Installationen werden migriert**: die Belegungen wandern nach
  `yonderrc.actions.v2`, und eine gespeicherte Panic-Belegung, die exakt dem alten
  `Escape`-Standard entspricht, wird entfernt — sie war nie eine bewusste Wahl. Alles
  selbst Gewählte (auch Escape plus Button) bleibt unangetastet.
- Das Controls-Panel erklärt jetzt, warum Panic unbelegt ist und worauf man es legen
  sollte.

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
