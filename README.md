# Pilinova

Ein ruhiger, öffentlicher Einstieg, um eigene Werte und die eines anderen Menschen kennenzulernen. Responsiv, deutschsprachig und ohne externe Schriften, Tracking oder JavaScript-Abhängigkeiten.

![Pilinova Startseite](docs/preview.jpg)

## Aktueller Umfang

- **Verbindung zu mir:** Startknopf mit einem Hinweis auf die später folgende Werte-Übung.
- **Verbindung zu dir:** Zufällige Session-ID erstellen, kopieren und auf einem anderen Gerät eingeben. Sessions bleiben über Container-Neustarts erhalten und laufen nach 30 Tagen ab. Die gemeinsame Werte-Übung und der Ergebnisvergleich sind noch nicht implementiert. Der Beitritt prüft aktuell die Existenz der Session; er bindet noch keine Teilnehmeridentität.
- **E-Mail für uns:** Zwei unterschiedliche E-Mail-Adressen und täglich, wöchentlich oder monatlich als Intervall speichern. **Es werden noch keine E-Mails versendet.** SMTP, Inhalte, beidseitige E-Mail-Bestätigung, Abmeldung und Versandplanung sind bewusst Teil einer späteren Erweiterung. Die Oberfläche weist vor dem Speichern darauf hin.

## Mit Docker starten

```bash
git clone https://github.com/aquaneno/Pilinova.git
cd Pilinova
docker compose up -d --build
```

Danach: <http://localhost:8080>. Bei einem privaten Repository muss Git am ausführenden Rechner authentifiziert sein.

Standardmäßig ist Port 8080 nur am Docker-Host erreichbar. Für direkten Zugriff aus dem LAN:

```bash
BIND_ADDRESS=0.0.0.0 PORT=8080 docker compose up -d --build
```

Für die öffentliche Bereitstellung einen HTTPS-Reverse-Proxy verwenden. Liegt dieser auf demselben Host, kann er auf `http://127.0.0.1:8080` weiterleiten. In einem gemeinsamen Docker-Netz lautet das Ziel `http://pilinova:8080`. Der Proxy muss den ursprünglichen `Host`-Header einschließlich eines etwaigen Ports weitergeben; die Anwendung prüft ihn gegen den Browser-Origin. Keine Pfadpräfixe verwenden. Die Anwendung benötigt keine ausgehenden Netzwerkverbindungen.

### Aktualisieren und betreiben

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

SQLite liegt im persistenten Volume `pilinova-data`, nicht im Container-Image. `docker compose down` erhält es; **`docker compose down -v` löscht die gespeicherten Daten**. Für ein konsistentes Backup den Dienst stoppen und das Volume sichern oder die SQLite-Backup-API verwenden. Enthalten sind Session-IDs und E-Mail-Präferenzen. Es gibt keinen öffentlichen Lese-Endpunkt für E-Mail-Adressen. Die Präferenzen bleiben bis zur administrativen Löschung erhalten; für den echten Versand müssen Bestätigung und Abmeldung ergänzt werden. Die Datenbank ist zugleich der Erweiterungspunkt für diese Funktionen.

Der Container läuft als Benutzer 10001 ohne zusätzliche Linux-Capabilities und mit schreibgeschütztem Root-Dateisystem. Bei einem eigenen Bind-Mount für `/app/data` muss das Verzeichnis für UID/GID 10001 schreibbar sein. Das Named Volume in der Compose-Datei wird automatisch passend initialisiert. Der Healthcheck prüft `/api/health`. Docker begrenzt den Dienst auf 256 MB RAM und 128 Prozesse/Threads.

## Lokal entwickeln und prüfen

Python 3.11 oder neuer, keine Installation weiterer Pakete erforderlich:

```bash
python3 server.py
python3 -m unittest discover -s tests -v
node --check public/app.js
```

`PORT` (Standard `8080`) und `DATABASE_PATH` (Standard `data/pilinova.sqlite3`) sind konfigurierbar. `PORT` in Compose ändert nur den veröffentlichten Host-Port; intern bleibt es bei 8080.

## Aufbau und Erweiterungen

- `public/index.html`, `styles.css`, `app.js`: barrierearme Oberfläche mit nativen Dialogen, Tastaturbedienung, Formularvalidierung und Statusmeldungen.
- `server.py`: HTTP-Server auf Basis der Python-Standardbibliothek und SQLite mit parametrisierten SQL-Abfragen.
- `POST /api/sessions` mit `{}`: Session erstellen (96 Bit Zufall).
- `POST /api/sessions/join` mit `{"sessionId":"…"}`: Session prüfen.
- `POST /api/email-preferences` mit `{"emailOne":"a@example.org","emailTwo":"b@example.org","interval":"weekly"}`: Präferenz speichern/aktualisieren. Intervall: `daily`, `weekly`, `monthly`. Die Reihenfolge der beiden Adressen ist unerheblich.
- `GET /api/health`: Betriebsprüfung ohne Nutzerdaten.

POST-Anfragen benötigen `application/json`, sind auf 4 KiB und 30 Anfragen pro Minute je direkter Client-IP begrenzt. Hinter einem Reverse-Proxy teilen sich Clients gegebenenfalls dessen Limit; vor breiter öffentlicher Nutzung ist das Limit am Proxy passend zu konfigurieren und die App-Begrenzung entsprechend weiterzuentwickeln. Weitergeleitete IP-Header werden nicht ungeprüft vertraut. Session-IDs gehören nur den beteiligten Personen und sollten nicht öffentlich geteilt werden. Ein Prozess/Container mit persistentem Volume ist vorgesehen; horizontale Skalierung erfordert eine gemeinsame Datenbank und ein gemeinsames Rate-Limit.
