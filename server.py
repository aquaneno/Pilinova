"""Pilinova: dependency-free HTTP application with persistent SQLite storage."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from admin import AdminMixin, APIError, initialize, password_hash, validate_email_pair

PUBLIC = Path(__file__).parent / 'public'
SESSION_TTL = 30 * 24 * 60 * 60
STATIC = {'/': ('index.html', 'text/html; charset=utf-8'),
          '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
          '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
          '/value-selection.mjs': ('value-selection.mjs', 'text/javascript; charset=utf-8'),
          '/value-exercise.mjs': ('value-exercise.mjs', 'text/javascript; charset=utf-8'),
          '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
STATIC.update({'/admin': ('admin.html', 'text/html; charset=utf-8'),
               '/admin/': ('admin.html', 'text/html; charset=utf-8'),
               '/admin.js': ('admin.js', 'text/javascript; charset=utf-8'),
               '/admin.css': ('admin.css', 'text/css; charset=utf-8')})


class PilinovaServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, database):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.rate_lock = threading.Lock()
        self.requests = {}
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS email_preferences (
                    email_one TEXT NOT NULL, email_two TEXT NOT NULL,
                    interval TEXT NOT NULL CHECK(interval IN ('daily','weekly','monthly')),
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY(email_one, email_two)
                );
            ''')
        initialize(self)
        super().__init__(address, Handler)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.database, timeout=10)
        connection.execute('PRAGMA foreign_keys=ON')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def rate_allowed(self, ip, limit=30):
        now = time.monotonic()
        with self.rate_lock:
            self.requests = {key: value for key, value in self.requests.items() if now - value[0] < 60}
            if ip not in self.requests and len(self.requests) >= 10000:
                return False
            started, count = self.requests.get(ip, (now, 0))
            self.requests[ip] = (started, count + 1)
            return count < limit


class Handler(AdminMixin, BaseHTTPRequestHandler):
    server_version = 'Pilinova'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        # Do not log email addresses, session IDs, request bodies or client IPs.
        pass

    def respond(self, status, content, content_type='application/json; charset=utf-8', head=False, extra_headers=None):
        if not isinstance(content, bytes):
            content = json.dumps(content, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        self.send_header('Connection', 'close')
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        if status == 429:
            self.send_header('Retry-After', '60')
        self.end_headers()
        self.close_connection = True
        if not head:
            self.wfile.write(content)

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        path = urlsplit(self.path).path
        if path.startswith('/api/admin/'):
            self.admin_api('GET', head=head)
        elif re.fullmatch(r'/api/methods/[^/]+/content', path):
            self.method_content(path.split('/')[3], head=head)
        elif path == '/api/health':
            try:
                with self.server.connect() as db:
                    db.execute('SELECT 1').fetchone()
                self.respond(200, {'status': 'ok'}, head=head)
            except sqlite3.Error:
                self.respond(503, {'status': 'unavailable'}, head=head)
        elif path in STATIC:
            name, mime = STATIC[path]
            self.respond(200, (PUBLIC / name).read_bytes(), mime, head=head)
        else:
            self.respond(404, {'error': 'Diese Seite wurde nicht gefunden.'}, head=head)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/admin/'):
            self.admin_api('POST')
            return
        if path not in {'/api/sessions', '/api/sessions/join', '/api/email-preferences'}:
            self.respond(404, {'error': 'Diese Funktion wurde nicht gefunden.'})
            return
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.respond(403, {'error': 'Diese Anfrage ist nicht erlaubt.'})
            return
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc.lower() != self.headers.get('Host', '').lower():
            self.respond(403, {'error': 'Diese Anfrage ist nicht erlaubt.'})
            return
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            self.respond(415, {'error': 'Bitte sende die Angaben als JSON.'})
            return
        if not self.server.rate_allowed(self.client_address[0]):
            self.respond(429, {'error': 'Bitte warte eine Minute und versuche es erneut.'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = 0
        if not 0 < size <= 4096 or self.headers.get('Transfer-Encoding'):
            self.respond(413, {'error': 'Die Anfrage ist leer oder zu groß.'})
            return
        try:
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self.respond(400, {'error': 'Die Angaben konnten nicht gelesen werden.'})
            return
        try:
            with self.server.connect() as db:
                now = int(time.time())
                if path == '/api/sessions':
                    raw = secrets.token_hex(12).upper()
                    session_id = '-'.join(raw[i:i+6] for i in range(0, 24, 6))
                    db.execute('INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)', (session_id, now, now + SESSION_TTL))
                    result = (201, {'sessionId': session_id, 'expiresAt': now + SESSION_TTL})
                elif path == '/api/sessions/join':
                    session_id = data.get('sessionId')
                    raw = re.sub(r'[-\s]', '', session_id).upper() if isinstance(session_id, str) else ''
                    if not re.fullmatch(r'[A-F0-9]{24}', raw):
                        result = (400, {'error': 'Bitte prüfe das Format der Session-ID.'})
                    else:
                        session_id = '-'.join(raw[i:i+6] for i in range(0, 24, 6))
                        row = db.execute('SELECT expires_at FROM sessions WHERE id = ? AND expires_at > ? AND disabled = 0', (session_id, now)).fetchone()
                        result = (200, {'sessionId': session_id, 'expiresAt': row[0]}) if row else (404, {'error': 'Diese Session wurde nicht gefunden oder ist abgelaufen.'})
                else:
                    one, two, interval = validate_email_pair(data)
                    db.execute('INSERT INTO email_preferences (email_one, email_two, interval, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email_one, email_two) DO UPDATE SET interval=excluded.interval, updated_at=excluded.updated_at', (one, two, interval, now))
                    result = (200, {'saved': True, 'deliveryEnabled': False})
            # Confirm only after SQLite has committed successfully.
            self.respond(*result)
        except APIError as error:
            self.respond(error.status, {'error': error.message})
        except sqlite3.Error:
            self.respond(503, {'error': 'Das Speichern ist gerade nicht möglich. Bitte versuche es erneut.'})

    def do_PUT(self):
        if urlsplit(self.path).path.startswith('/api/admin/'):
            self.admin_api('PUT')
        else:
            self.respond(404, {'error': 'Diese Funktion wurde nicht gefunden.'})

    def do_DELETE(self):
        if urlsplit(self.path).path.startswith('/api/admin/'):
            self.admin_api('DELETE')
        else:
            self.respond(404, {'error': 'Diese Funktion wurde nicht gefunden.'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Pilinova HTTP-Server')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8080')))
    parser.add_argument('--strictPort', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--hash-admin-password', action='store_true', help='Admin-Passwort verdeckt einlesen und Hash ausgeben')
    args = parser.parse_args()
    if args.hash_admin_password:
        from getpass import getpass
        password = getpass('Admin-Passwort (mindestens 12 Zeichen): ')
        if len(password) < 12 or len(password) > 1024:
            parser.error('Das Passwort muss 12 bis 1024 Zeichen lang sein.')
        if password != getpass('Passwort wiederholen: '):
            parser.error('Die Passwörter stimmen nicht überein.')
        print(password_hash(password))
        raise SystemExit(0)
    server = PilinovaServer((args.host, args.port), os.environ.get('DATABASE_PATH', 'data/pilinova.sqlite3'))
    print(f'Pilinova lauscht auf Port {server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
