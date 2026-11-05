# Pilinova

Ein ruhiger, öffentlicher Einstieg, um eigene Werte und die eines anderen Menschen kennenzulernen. Responsiv, deutschsprachig und ohne externe Schriften, Tracking oder JavaScript-Abhängigkeiten.

![Pilinova Startseite](docs/preview.jpg)

## Aktueller Umfang

- **Verbindung zu mir:** Fragen und Werte aus den im Admin-Bereich veröffentlichten, zugeordneten Listen ansehen. Die vollständige Werte-Übung folgt später.
- **Verbindung zu dir:** Zufällige Session-ID erstellen, kopieren und auf einem anderen Gerät eingeben; Werte aus einer zugeordneten Liste in zufälligen Paaren auswählen und über mehrere Runden auf höchstens acht Werte reduzieren (siehe unten). Sessions bleiben über Container-Neustarts erhalten und laufen standardmäßig nach 30 Tagen ab. Der Beitritt prüft die Existenz der Session; Teilnehmeridentitäten und der geräteübergreifende Ergebnisvergleich sind noch nicht implementiert.
- **E-Mail für uns:** Zwei unterschiedliche E-Mail-Adressen und täglich, wöchentlich oder monatlich als Intervall speichern. **Es werden noch keine E-Mails versendet.** SMTP, Inhalte, beidseitige E-Mail-Bestätigung, Abmeldung und Versandplanung sind bewusst Teil einer späteren Erweiterung. Die Oberfläche weist vor dem Speichern darauf hin.

## Mit Docker starten

```bash
git clone https://github.com/aquaneno/Pilinova.git
cd Pilinova
docker compose up -d --build
```

Danach: <http://localhost:8080>. Bei einem privaten Repository muss Git am ausführenden Rechner authentifiziert sein.

### An eine bestimmte Host-IP binden

Die veröffentlichte IP und der Host-Port sind über `BIND_ADDRESS` und `PORT` konfigurierbar. Ohne Konfiguration bindet Docker ausschließlich an `127.0.0.1:8080`.

Für eine dauerhafte Einstellung die Vorlage einmalig kopieren:

```bash
cp .env.example .env
```

Anschließend in der lokalen `.env` die **bereits auf dem Docker-Host vorhandene IP-Adresse** eintragen, zum Beispiel:

```dotenv
BIND_ADDRESS=192.168.1.50
PORT=8080
```

Die Beispiel-IP durch die gewünschte eigene Host-IP ersetzen. Danach den Container erstellen beziehungsweise mit der geänderten Portbindung neu erstellen:

```bash
docker compose up -d --build
```

Pilinova ist dann unter `http://192.168.1.50:8080` erreichbar. Docker Compose liest die `.env` automatisch ein; sie wird nicht ins Repository eingecheckt. Zum Prüfen der aufgelösten Konfiguration und der tatsächlichen Portbindung:

```bash
docker compose config
docker compose port pilinova 8080
```

Alternativ ohne `.env` für diesen Aufruf:

```bash
BIND_ADDRESS=192.168.1.50 PORT=8080 docker compose up -d --build
```

Shell-Umgebungsvariablen haben Vorrang vor der `.env`. Ein bloßes `docker compose restart` übernimmt eine geänderte Portbindung nicht; dafür `docker compose up -d` verwenden. Ist die gewählte IP nicht am Host vorhanden oder der Port auf dieser Adresse bereits belegt, schlägt der Start fehl.

Mit `BIND_ADDRESS=0.0.0.0` wird auf allen IPv4-Adressen des Hosts veröffentlicht. Im Container lauscht die Anwendung weiterhin auf `0.0.0.0:8080`; die Auswahl der Host-IP erfolgt über Dockers `ports.host_ip`. Bei einem HTTPS-Reverse-Proxy auf demselben Host kann die Voreinstellung `127.0.0.1` beibehalten werden.

Für die öffentliche Bereitstellung einen HTTPS-Reverse-Proxy verwenden. Liegt dieser auf demselben Host, kann er auf `http://127.0.0.1:8080` weiterleiten. In einem gemeinsamen Docker-Netz lautet das Ziel `http://pilinova:8080`. Der Proxy muss den ursprünglichen `Host`-Header einschließlich eines etwaigen Ports weitergeben; die Anwendung prüft ihn gegen den Browser-Origin. Keine Pfadpräfixe verwenden. Die Anwendung benötigt keine ausgehenden Netzwerkverbindungen.

### Aktualisieren und betreiben

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

SQLite liegt im persistenten Volume `pilinova-data`, nicht im Container-Image. `docker compose down` erhält es; **`docker compose down -v` löscht die gespeicherten Daten**. Für ein konsistentes Backup den Dienst stoppen und das Volume sichern oder die SQLite-Backup-API verwenden. Enthalten sind Session-IDs, E-Mail-Präferenzen, Admin-Sitzungen und Fragen-/Wertelisten. E-Mail-Adressen können ausschließlich über die geschützte Admin-API gelesen werden. Die Präferenzen bleiben bis zur administrativen Löschung erhalten; für den echten Versand müssen Bestätigung und Abmeldung ergänzt werden. Die Datenbank ist zugleich der Erweiterungspunkt für diese Funktionen.

Der Container läuft als Benutzer 10001 ohne zusätzliche Linux-Capabilities und mit schreibgeschütztem Root-Dateisystem. Bei einem eigenen Bind-Mount für `/app/data` muss das Verzeichnis für UID/GID 10001 schreibbar sein. Das Named Volume in der Compose-Datei wird automatisch passend initialisiert. Der Healthcheck prüft `/api/health`. Docker begrenzt den Dienst auf 256 MB RAM und 128 Prozesse/Threads.

## Lokal entwickeln und prüfen

Python 3.11 oder neuer, keine Installation weiterer Pakete erforderlich:

```bash
python3 server.py
python3 -m unittest discover -s tests -v
node --test tests/value-selection.test.mjs
node --check public/app.js
```

`PORT` (Standard `8080`) und `DATABASE_PATH` (Standard `data/pilinova.sqlite3`) sind konfigurierbar. `PORT` in Compose ändert nur den veröffentlichten Host-Port; intern bleibt es bei 8080.

## Aufbau und Erweiterungen

- `public/index.html`, `styles.css`, `app.js`: barrierearme Oberfläche mit nativen Dialogen, Tastaturbedienung, Formularvalidierung und Statusmeldungen.
- `public/value-selection.mjs`, `value-exercise.mjs`: Rundenlogik und Oberfläche der Werte-Auswahl, ohne zusätzliche JavaScript-Abhängigkeiten.
- `server.py`: HTTP-Server auf Basis der Python-Standardbibliothek und SQLite mit parametrisierten SQL-Abfragen.
- `POST /api/sessions` mit `{}`: Session erstellen (96 Bit Zufall).
- `POST /api/sessions/join` mit `{"sessionId":"…"}`: Session prüfen.
- `POST /api/email-preferences` mit `{"emailOne":"a@example.org","emailTwo":"b@example.org","interval":"weekly"}`: Präferenz speichern/aktualisieren. Intervall: `daily`, `weekly`, `monthly`. Die Reihenfolge der beiden Adressen ist unerheblich.
- `GET /api/health`: Betriebsprüfung ohne Nutzerdaten.

Öffentliche POST-Anfragen benötigen `application/json`, sind auf 4 KiB und 30 Anfragen pro Minute je direkter Client-IP begrenzt. Hinter einem Reverse-Proxy teilen sich Clients gegebenenfalls dessen Limit; vor breiter öffentlicher Nutzung ist das Limit am Proxy passend zu konfigurieren und die App-Begrenzung entsprechend weiterzuentwickeln. Weitergeleitete IP-Header werden nicht ungeprüft vertraut. Session-IDs gehören nur den beteiligten Personen und sollten nicht öffentlich geteilt werden. Ein Prozess/Container mit persistentem Volume ist vorgesehen; horizontale Skalierung erfordert eine gemeinsame Datenbank und ein gemeinsames Rate-Limit.

## Admin-Interface

Die Verwaltung liegt unter **`/admin`** (auch über den Link im Footer erreichbar). Für die eigene Installation beispielsweise `https://demo.pilinova.de/admin` öffnen. Der öffentliche Teil benötigt weiterhin keine Anmeldung.

### Zugang einrichten

Ohne `ADMIN_PASSWORD_HASH` bleiben sämtliche Admin-Daten und -Aktionen gesperrt. Es gibt kein Standardpasswort. Für den HTTPS-Betrieb mit Cloudflare Tunnel und Nginx Proxy Manager:

1. Aktuellen Code holen und das Image bauen:

   ```bash
   git pull --ff-only
   docker compose build
   ```

2. Ein eigenes Passwort mit mindestens 12 Zeichen wählen und den Hash erzeugen. Das Passwort wird zweimal verdeckt abgefragt und weder gespeichert noch als Argument übergeben:

   ```bash
   docker compose run --rm --no-deps pilinova python server.py --hash-admin-password
   ```

   Ohne Docker funktioniert `python3 server.py --hash-admin-password`.

3. Die folgenden Einstellungen in die bestehende `.env` ergänzen. Den vollständig ausgegebenen Hash **in einfache Anführungszeichen** setzen, damit Docker Compose die `$`-Zeichen nicht als Variablen interpretiert:

   ```dotenv
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH='pbkdf2_sha256$600000$…$…'
   ADMIN_COOKIE_SECURE=true
   ```

   Der dargestellte Hash ist ein Platzhalter und muss vollständig ersetzt werden. Die bisherige Einstellung für `BIND_ADDRESS` und `PORT` beibehalten.

4. Container neu erstellen und unter `/admin` mit dem selbst gewählten Passwort anmelden:

   ```bash
   docker compose up -d --build
   ```

`ADMIN_COOKIE_SECURE=true` ist für die öffentliche HTTPS-Adresse vorgesehen und bleibt auch dann aktiviert, wenn Nginx intern per HTTP mit dem Container spricht. Für eine ausschließlich lokale Entwicklung per HTTP ausdrücklich `ADMIN_COOKIE_SECURE=false` in der Prozessumgebung setzen. Docker Compose liest die `.env`; beim direkten Aufruf von Python müssen die Variablen in der Shell gesetzt sein.

### Funktionen

- **Sessions:** Durchsuchen, neu erstellen, Ablaufdatum bearbeiten, sperren/entsperren und nach Bestätigung endgültig löschen. Gesperrte oder abgelaufene IDs werden am öffentlichen Beitritt abgewiesen. Abgelaufene Sessions bleiben bis zur administrativen Löschung sichtbar. Zum Reaktivieren müssen die Sperre aufgehoben und ein zukünftiges Ablaufdatum eingestellt werden; maximal ein Jahr ab dem Bearbeitungszeitpunkt.
- **E-Mail-Adressen:** Gespeicherte Paare durchsuchen, hinzufügen, beide Adressen und den Rhythmus bearbeiten oder nach Bestätigung endgültig löschen. Adresspaare werden unabhängig von Reihenfolge und Groß-/Kleinschreibung dedupliziert. Beim Bearbeiten auf ein schon vorhandenes Paar erscheint ein Konflikthinweis; kein anderer Eintrag wird überschrieben. **Der Versand ist weiterhin nicht implementiert.**
- **Fragen & Werte:** Benannte Listen mit Typ „Fragen“ oder „Werte“ anlegen, bearbeiten und löschen. Ein Eintrag pro Zeile, bis zu 200 Einträge mit je 500 Zeichen; die Reihenfolge bleibt erhalten. Listen können mehreren Methoden zugeordnet werden: „Verbindung zu mir“, „Verbindung zu dir“ und „E-Mail für uns“. Nur veröffentlichte Listen werden dort angezeigt; unveröffentlichte Listen sind Entwürfe. Änderungen gelten beim nächsten Öffnen einer Methode. Beim Löschen einer Liste entfallen ihre Zuordnungen automatisch.
- Alle Bereiche bieten Suche und Seiten mit jeweils 50 Einträgen. Löschungen sind endgültig; ein Datenbankbackup ermöglicht eine Wiederherstellung.

„Verbindung zu mir“ und „E-Mail für uns“ zeigen Fragen und Werte als aufklappbare Impulslisten. „Verbindung zu dir“ verwendet veröffentlichte Wertelisten für die folgende Übung. Teilnehmerzuordnung, geräteübergreifender Ergebnisvergleich und E-Mail-Versand bleiben spätere Erweiterungen.

### Werte-Auswahl in „Verbindung zu dir“

1. Im Admin-Bereich eine Liste vom Typ **Werte** veröffentlichen und **Verbindung zu dir** zuordnen. Mindestens zwei unterschiedliche, nicht leere Werte sind erforderlich. Doppelte Einträge (auch bei unterschiedlicher Groß-/Kleinschreibung oder Unicode-Schreibweise) werden für die Übung zusammengefasst. Fragenlisten werden in dieser Übung nicht verwendet. Sind mehrere geeignete Listen verknüpft, wählt die Person vor dem Start eine davon aus.
2. Nach Session-Erstellung oder -Beitritt die Werte-Auswahl starten. Die gesamte Liste wird mit Fisher–Yates zufällig gemischt und in disjunkte Paare aufgeteilt. Zwei Werte erscheinen nebeneinander; erst eine Entscheidung führt zum nächsten Paar. Pro Runde wird jeder Wert genau einmal verwendet.
3. Bei **ungerader Anzahl** ist eine vollständige Paarbildung mathematisch unmöglich. Ein zufälliger Wert erhält deshalb ein sichtbar erklärtes Freilos und kommt automatisch weiter; alle übrigen werden genau einmal verglichen. Es gibt keinen doppelten Vergleich und keinen stillschweigend ausgelassenen Wert.
4. Nach allen Paaren erscheint die Übersicht der gewählten Werte einschließlich eines möglichen Freiloses. Aus den **in dieser Runde** abgewählten Werten lassen sich optional bis zu zwei zurückholen und wieder abwählen. Nach der zweiten Ergänzung bleiben nur die bereits ergänzten Werte zum Abwählen bedienbar.
5. Mit mehr als acht Werten startet eine neue zufällige Runde ausschließlich aus der aktuellen Auswahl einschließlich zurückgeholter Werte. Erst nach der Rundenübersicht und den optionalen Ergänzungen wird geprüft, ob höchstens acht Werte übrig sind. Dann zeigt „Meine Werte ansehen“ das endgültige Ergebnis. Auch eine kurze Ausgangsliste durchläuft zuerst eine Auswahlrunde.

Die Auswahl bleibt innerhalb der geöffneten Seite je Session erhalten, auch wenn der Dialog geschlossen und derselben Session wieder beigetreten wird. Sie wird **nicht** auf dem Server oder im Browser-Speicher abgelegt und geht beim Neuladen der Seite verloren. Andere Geräte haben ihre eigene Auswahl. Während einer begonnenen Übung bleibt die geladene Werteliste unverändert; Admin-Änderungen werden erst beim erstmaligen Öffnen einer anderen Session oder nach Neuladen übernommen.

`npm test` führt die Python-API-Tests und die Node-Tests für die Rundenlogik aus (Node.js 18 oder neuer). Die Node-Tests prüfen unter anderem alle Listengrößen von 2 bis 200 über sämtliche Folgerunden, Freilose, Zufallsmischung, maximal zwei Ergänzungen und die Abschlussgrenze von acht Werten.

### Speicherung und Zugriffsschutz

Die bestehenden SQLite-Daten werden beim ersten Start automatisch und ohne Verlust von Sessions und E-Mail-Paaren erweitert. Ein konsistentes Backup vor dem Update ist sinnvoll (siehe Betriebsabschnitt). Auch Listen und ihre Methodenzuordnungen liegen im bestehenden Datenvolume.

Der Admin-Login verwendet PBKDF2-SHA256 mit 600.000 Iterationen und zufälligem Salt. Admin-Sitzungen sind acht Stunden gültig und bleiben über Neustarts erhalten. Das Browser-Cookie ist `HttpOnly`, `SameSite=Strict` und standardmäßig `Secure`. In der Datenbank liegt nur der Hash des zufälligen Sitzungstokens. Schreibzugriffe benötigen zusätzlich einen CSRF-Token und durchlaufen die Origin-Prüfung. Loginversuche sind separat auf zehn pro Minute je direkter Client-IP begrenzt; hinter dem Proxy teilen Clients dessen IP-Limit. Der Proxy muss wie bisher den ursprünglichen `Host` weitergeben.

Ein Wechsel von `ADMIN_USERNAME` oder `ADMIN_PASSWORD_HASH` samt Neuerstellen des Containers macht bestehende Admin-Sitzungen ungültig. Nach Abmeldung wird die jeweilige Sitzung serverseitig gelöscht. Zum Deaktivieren der Verwaltung `ADMIN_PASSWORD_HASH` leeren und den Container neu erstellen. Die Admin-Oberfläche enthält keine Zugangsdaten; persönliche Daten werden ausschließlich nach erfolgreicher Anmeldung über die Admin-API ausgeliefert.

Zusätzliche API-Endpunkte:

- `POST /api/admin/login`, `GET /api/admin/me`, `POST /api/admin/logout`.
- `GET/POST /api/admin/sessions`, `/api/admin/emails`, `/api/admin/lists`.
- `PUT/DELETE /api/admin/{sessions|emails|lists}/{id}`. Für Änderungen das Sitzungscookie und den bei Login/`me` gelieferten `X-CSRF-Token` senden. IDs für E-Mail-Paare und Listen sind stabile Ganzzahlen.
- Listen-Endpunkte unterstützen `?q=Suchtext&offset=0`, Seitengröße 50. Anfragen mit JSON-Inhalten sind im Admin-Bereich auf 512 KiB begrenzt, beim Login auf 4 KiB.
- `GET /api/methods/{self|together|email}/content` liefert ausschließlich veröffentlichte, zugewiesene Listen mit Namen, Typ und geordneten Einträgen. Keine Sessions oder E-Mail-Adressen.

Zusätzliche Prüfung:

```bash
python3 -m unittest discover -s tests -v
node --check public/app.js
node --check public/admin.js
```
