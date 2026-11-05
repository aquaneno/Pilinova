"""Admin authentication, migration and content management (standard library only)."""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from http.cookies import SimpleCookie, CookieError
from urllib.parse import parse_qs, urlsplit

METHODS = {'self', 'together', 'email'}
KINDS = {'questions', 'values'}
ADMIN_TTL = 8 * 60 * 60
ITERATIONS = 600_000
INTERVALS = {'daily', 'weekly', 'monthly'}
EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+\Z")


def validate_email_pair(data):
    one, two, interval = data.get('emailOne'), data.get('emailTwo'), data.get('interval')
    if not all(isinstance(email, str) and len(email) <= 254 and EMAIL.fullmatch(email) and len(email.split('@')[0]) <= 64 for email in (one, two)):
        raise APIError(400, 'Bitte gib zwei gültige E-Mail-Adressen ein.')
    if one.lower() == two.lower():
        raise APIError(400, 'Bitte verwende zwei unterschiedliche E-Mail-Adressen.')
    if not isinstance(interval, str) or interval not in INTERVALS:
        raise APIError(400, 'Bitte wähle täglich, wöchentlich oder monatlich.')
    return (*sorted((one.lower(), two.lower())), interval)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${digest}'


def verify_password(password, encoded):
    try:
        algorithm, rounds, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or int(rounds) != ITERATIONS or not re.fullmatch(r'[a-f0-9]{32}', salt) or not re.fullmatch(r'[a-f0-9]{64}', expected):
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), ITERATIONS).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, AttributeError):
        return False


def initialize(server):
    server.admin_username = os.environ.get('ADMIN_USERNAME', 'admin')
    server.admin_password_hash = os.environ.get('ADMIN_PASSWORD_HASH', '')
    server.admin_cookie_secure = os.environ.get('ADMIN_COOKIE_SECURE', 'true').lower() != 'false'
    with server.connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('BEGIN IMMEDIATE')
        columns = {row[1] for row in db.execute('PRAGMA table_info(sessions)')}
        if 'disabled' not in columns:
            db.execute('ALTER TABLE sessions ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0')
        # Give existing email pairs stable identifiers without losing any registrations.
        columns = {row[1] for row in db.execute('PRAGMA table_info(email_preferences)')}
        if 'id' not in columns:
            db.execute('ALTER TABLE email_preferences RENAME TO email_preferences_legacy')
            db.execute('''CREATE TABLE email_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_one TEXT NOT NULL, email_two TEXT NOT NULL,
                interval TEXT NOT NULL CHECK(interval IN ('daily','weekly','monthly')),
                updated_at INTEGER NOT NULL, UNIQUE(email_one, email_two))''')
            db.execute('''INSERT INTO email_preferences (email_one, email_two, interval, updated_at)
                SELECT email_one, email_two, interval, updated_at FROM email_preferences_legacy''')
            db.execute('DROP TABLE email_preferences_legacy')
        # Use individual statements so the migration and copies commit atomically.
        for statement in [
            '''CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL,
                credential_hash TEXT NOT NULL)''',
            '''CREATE TABLE IF NOT EXISTS content_lists (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('questions','values')),
                items TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL)''',
            '''CREATE TABLE IF NOT EXISTS method_lists (
                method TEXT NOT NULL CHECK(method IN ('self','together','email')),
                list_id INTEGER NOT NULL REFERENCES content_lists(id) ON DELETE CASCADE,
                PRIMARY KEY(method, list_id))''',
        ]:
            db.execute(statement)


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class AdminMixin:
    def read_admin_json(self, limit=524288):
        self.check_origin()
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            raise APIError(415, 'Bitte sende die Angaben als JSON.')
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = 0
        if not 0 < size <= limit or self.headers.get('Transfer-Encoding'):
            raise APIError(413, 'Die Anfrage ist leer oder zu groß.')
        try:
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError
            return data
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise APIError(400, 'Die Angaben konnten nicht gelesen werden.')

    def check_origin(self):
        origin = self.headers.get('Origin')
        try:
            different_origin = origin and urlsplit(origin).netloc.lower() != self.headers.get('Host', '').lower()
        except ValueError:
            different_origin = True
        if self.headers.get('Sec-Fetch-Site') == 'cross-site' or different_origin:
            raise APIError(403, 'Diese Anfrage ist nicht erlaubt.')

    def credential_hash(self):
        return hashlib.sha256((self.server.admin_username + '\0' + self.server.admin_password_hash).encode()).hexdigest()

    def admin_session(self, db, mutate=False):
        if not self.server.admin_password_hash:
            raise APIError(503, 'Der Admin-Zugang ist noch nicht konfiguriert.')
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie['pilinova_admin'].value if 'pilinova_admin' in cookie else ''
        except CookieError:
            token = ''
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        row = db.execute('SELECT csrf, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ? AND credential_hash = ?',
                         (token_hash, int(time.time()), self.credential_hash())).fetchone()
        if not row:
            raise APIError(401, 'Bitte melde dich im Admin-Bereich an.')
        if mutate:
            self.check_origin()
            if not hmac.compare_digest(self.headers.get('X-CSRF-Token', '').encode(), row[0].encode()):
                raise APIError(403, 'Die Sitzung konnte nicht bestätigt werden. Bitte lade die Seite neu.')
        return token_hash, row[0], row[1]

    def cookie_header(self, token='', max_age=0):
        return 'pilinova_admin=' + token + '; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=' + str(max_age) + ('; Secure' if self.server.admin_cookie_secure else '')

    def admin_api(self, method, head=False):
        import sqlite3
        try:
            with self.server.connect() as db:
                result, headers = self.admin_dispatch(db, method)
            self.respond(result[0], result[1], head=head, extra_headers=headers)
        except APIError as error:
            self.respond(error.status, {'error': error.message}, head=head)
        except sqlite3.IntegrityError:
            self.respond(409, {'error': 'Dieses E-Mail-Paar ist bereits vorhanden.'}, head=head)
        except sqlite3.Error:
            self.respond(503, {'error': 'Die Datenbank ist gerade nicht verfügbar.'}, head=head)

    def admin_dispatch(self, db, method):
        path = urlsplit(self.path).path
        now = int(time.time())
        if path == '/api/admin/login' and method == 'POST':
            if not self.server.rate_allowed('admin-login:' + self.client_address[0], limit=10):
                raise APIError(429, 'Bitte warte eine Minute und versuche es erneut.')
            data = self.read_admin_json(4096)
            if not self.server.admin_password_hash:
                raise APIError(503, 'Der Admin-Zugang ist noch nicht konfiguriert.')
            username, password = data.get('username'), data.get('password')
            valid_password = isinstance(password, str) and len(password) <= 1024 and verify_password(password, self.server.admin_password_hash)
            if not valid_password or not isinstance(username, str) or not hmac.compare_digest(username.encode(), self.server.admin_username.encode()):
                raise APIError(401, 'Benutzername oder Passwort ist nicht korrekt.')
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            db.execute('DELETE FROM admin_sessions WHERE expires_at <= ? OR credential_hash != ?', (now, self.credential_hash()))
            db.execute('INSERT INTO admin_sessions VALUES (?, ?, ?, ?)',
                       (hashlib.sha256(token.encode()).hexdigest(), csrf, now + ADMIN_TTL, self.credential_hash()))
            return (200, {'username': self.server.admin_username, 'csrfToken': csrf, 'expiresAt': now + ADMIN_TTL}), {'Set-Cookie': self.cookie_header(token, ADMIN_TTL)}
        token_hash, csrf, expires_at = self.admin_session(db, method != 'GET')
        if path == '/api/admin/me' and method == 'GET':
            return (200, {'username': self.server.admin_username, 'csrfToken': csrf, 'expiresAt': expires_at}), {}
        if path == '/api/admin/logout' and method == 'POST':
            self.read_admin_json(4096)
            db.execute('DELETE FROM admin_sessions WHERE token_hash = ?', (token_hash,))
            return (200, {'saved': True}), {'Set-Cookie': self.cookie_header()}
        match = re.fullmatch(r'/api/admin/(sessions|emails|lists)(?:/([A-Za-z0-9-]+))?', path)
        if not match:
            raise APIError(404, 'Diese Funktion wurde nicht gefunden.')
        resource, identifier = match.groups()
        table, key = {'sessions': ('sessions', 'id'), 'emails': ('email_preferences', 'id'), 'lists': ('content_lists', 'id')}[resource]
        if method == 'GET' and identifier is None:
            query = parse_qs(urlsplit(self.path).query)
            search = query.get('q', [''])[0].strip()
            if len(search) > 254:
                raise APIError(400, 'Der Suchtext ist zu lang.')
            try:
                offset = int(query.get('offset', ['0'])[0])
                if not 0 <= offset <= 1_000_000:
                    raise ValueError
            except ValueError:
                raise APIError(400, 'Die Seitennummer ist ungültig.')
            fields = {'sessions': ['id'], 'emails': ['email_one', 'email_two'], 'lists': ['name']}[resource]
            where = ' OR '.join(f'instr(lower({field}), lower(?)) > 0' for field in fields)
            params = [search] * len(fields)
            total = db.execute(f'SELECT count(*) FROM {table} WHERE {where}', params).fetchone()[0]
            order = 'created_at DESC, id DESC' if resource == 'sessions' else 'updated_at DESC, id DESC'
            rows = db.execute(f'SELECT * FROM {table} WHERE {where} ORDER BY {order} LIMIT 50 OFFSET ?', params + [offset]).fetchall()
            columns = [row[1] for row in db.execute(f'PRAGMA table_info({table})')]
            items = [dict(zip(columns, row)) for row in rows]
            for item in items:
                if resource == 'sessions':
                    item['disabled'] = bool(item['disabled'])
                    item['status'] = 'disabled' if item['disabled'] else ('expired' if item['expires_at'] <= now else 'active')
                if resource == 'lists':
                    item['items'] = json.loads(item['items'])
                    item['enabled'] = bool(item['enabled'])
                    item['methods'] = [row[0] for row in db.execute('SELECT method FROM method_lists WHERE list_id = ? ORDER BY method', (item['id'],))]
            return (200, {'items': items, 'total': total, 'offset': offset, 'limit': 50}), {}
        if identifier is not None:
            if resource != 'sessions' and (not identifier.isdigit() or len(identifier) > 15):
                raise APIError(404, 'Der Eintrag wurde nicht gefunden.')
            if not db.execute(f'SELECT 1 FROM {table} WHERE {key} = ?', (identifier,)).fetchone():
                raise APIError(404, 'Der Eintrag wurde nicht gefunden.')
        if method == 'DELETE' and identifier is not None:
            db.execute(f'DELETE FROM {table} WHERE {key} = ?', (identifier,))
            return (200, {'deleted': True}), {}
        if (method == 'PUT' and identifier is not None) or (method == 'POST' and identifier is None):
            data = self.read_admin_json()
            if resource == 'sessions':
                if method == 'POST':
                    raw = secrets.token_hex(12).upper()
                    identifier = '-'.join(raw[i:i+6] for i in range(0, 24, 6))
                    db.execute('INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)', (identifier, now, now + 30 * 24 * 3600))
                else:
                    expiry, disabled = data.get('expiresAt'), data.get('disabled')
                    if type(expiry) is not int or not 0 < expiry <= now + 366 * 24 * 3600 or type(disabled) is not bool:
                        raise APIError(400, 'Bitte wähle ein Ablaufdatum innerhalb eines Jahres und einen gültigen Status.')
                    db.execute('UPDATE sessions SET expires_at = ?, disabled = ? WHERE id = ?', (expiry, int(disabled), identifier))
            elif resource == 'emails':
                one, two, interval = validate_email_pair(data)
                if method == 'POST':
                    identifier = db.execute('INSERT INTO email_preferences (email_one, email_two, interval, updated_at) VALUES (?, ?, ?, ?)', (one, two, interval, now)).lastrowid
                else:
                    db.execute('UPDATE email_preferences SET email_one = ?, email_two = ?, interval = ?, updated_at = ? WHERE id = ?', (one, two, interval, now, identifier))
            else:
                name, kind, items, enabled, methods = (data.get(key) for key in ('name', 'kind', 'items', 'enabled', 'methods'))
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or not isinstance(kind, str) or kind not in KINDS or type(enabled) is not bool:
                    raise APIError(400, 'Bitte gib einen Namen (max. 100 Zeichen), einen Typ und einen Status an.')
                if not isinstance(items, list) or len(items) > 200 or any(not isinstance(item, str) or not 1 <= len(item.strip()) <= 500 or '\n' in item or '\r' in item for item in items):
                    raise APIError(400, 'Eine Liste erlaubt bis zu 200 Einträge mit jeweils 1 bis 500 Zeichen.')
                if not isinstance(methods, list) or len(methods) > 3 or any(not isinstance(item, str) or item not in METHODS for item in methods) or len(set(methods)) != len(methods):
                    raise APIError(400, 'Bitte wähle gültige Methoden aus.')
                if enabled and not items:
                    raise APIError(400, 'Eine veröffentlichte Liste benötigt mindestens einen Eintrag.')
                values = (name.strip(), kind, json.dumps([item.strip() for item in items], ensure_ascii=False), int(enabled), now)
                if method == 'POST':
                    identifier = db.execute('INSERT INTO content_lists (name, kind, items, enabled, updated_at) VALUES (?, ?, ?, ?, ?)', values).lastrowid
                else:
                    db.execute('UPDATE content_lists SET name = ?, kind = ?, items = ?, enabled = ?, updated_at = ? WHERE id = ?', values + (identifier,))
                db.execute('DELETE FROM method_lists WHERE list_id = ?', (identifier,))
                db.executemany('INSERT INTO method_lists VALUES (?, ?)', [(item, identifier) for item in methods])
            return (201 if method == 'POST' else 200, {'saved': True, 'id': identifier}), {}
        raise APIError(405, 'Diese Aktion ist nicht erlaubt.')

    def method_content(self, method, head=False):
        import sqlite3
        if method not in METHODS:
            self.respond(404, {'error': 'Diese Methode wurde nicht gefunden.'}, head=head)
            return
        try:
            with self.server.connect() as db:
                rows = db.execute('''SELECT c.id, c.name, c.kind, c.items FROM content_lists c
                    JOIN method_lists m ON m.list_id = c.id
                    WHERE m.method = ? AND c.enabled = 1 ORDER BY c.id''', (method,)).fetchall()
            self.respond(200, {'method': method, 'lists': [dict(id=row[0], name=row[1], kind=row[2], items=json.loads(row[3])) for row in rows]}, head=head)
        except sqlite3.Error:
            self.respond(503, {'error': 'Die Inhalte sind gerade nicht verfügbar.'}, head=head)
