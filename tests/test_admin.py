import hashlib
import http.client
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from admin import password_hash, verify_password
from server import PilinovaServer


PASSWORD = 'Pilinova test password 2026'
HASH = password_hash(PASSWORD)


class AdminTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'app.sqlite3'
        self.environment = patch.dict(os.environ, {'ADMIN_USERNAME': 'admin', 'ADMIN_PASSWORD_HASH': HASH, 'ADMIN_COOKIE_SECURE': 'true'})
        self.environment.start()
        self.cookie = self.csrf = ''
        self.start()

    def start(self):
        self.server = PilinovaServer(('127.0.0.1', 0), self.database)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def tearDown(self):
        self.stop()
        self.environment.stop()
        self.temp.cleanup()

    def request(self, path, data=None, method=None, auth=True, headers=None):
        actual_headers = {'Content-Type': 'application/json'}
        if auth:
            actual_headers.update({'Cookie': self.cookie, 'X-CSRF-Token': self.csrf})
        actual_headers.update(headers or {})
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method or ('POST' if data is not None else 'GET'), path,
                               body=json.dumps(data, ensure_ascii=False).encode('utf-8') if data is not None else None, headers=actual_headers)
            response = connection.getresponse()
            raw = response.read()
            content = json.loads(raw) if raw and response.getheader('Content-Type').startswith('application/json') else raw
            return response.status, content, dict(response.getheaders())
        finally:
            connection.close()

    def login(self):
        status, result, headers = self.request('/api/admin/login', {'username': 'admin', 'password': PASSWORD})
        self.assertEqual(status, 200)
        self.cookie = headers['Set-Cookie'].split(';')[0]
        self.csrf = result['csrfToken']
        return headers

    def create_list(self, **overrides):
        data = dict(name='Unsere Fragen', kind='questions', items=['Was gibt dir Kraft?', 'Was bedeutet Nähe für dich?'], enabled=True, methods=['self', 'together'])
        data.update(overrides)
        status, result, _ = self.request('/api/admin/lists', data)
        self.assertEqual(status, 201, result)
        return result['id']

    def test_authentication_csrf_expiry_logout_and_password_rotation(self):
        for path in ('/api/admin/me', '/api/admin/sessions', '/api/admin/emails', '/api/admin/lists'):
            self.assertEqual(self.request(path)[0], 401)
        self.assertEqual(self.request('/api/admin/sessions/x', method='DELETE')[0], 401)
        self.assertEqual(self.request('/api/admin/login', {'username': 'admin', 'password': 'wrong'})[0], 401)
        headers = self.login()
        for flag in ('HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/api/admin', 'Max-Age=28800'):
            self.assertIn(flag, headers['Set-Cookie'])
        self.assertEqual(self.request('/api/admin/me')[1]['csrfToken'], self.csrf)
        self.assertEqual(self.request('/api/admin/sessions', {}, headers={'X-CSRF-Token': ''})[0], 403)
        self.assertEqual(self.request('/api/admin/sessions', {}, headers={'X-CSRF-Token': 'é'})[0], 403)
        self.assertEqual(self.request('/api/admin/sessions', {}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/admin/sessions', {}, headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        with self.server.connect() as db:
            stored = db.execute('SELECT token_hash FROM admin_sessions').fetchone()[0]
            self.assertNotIn(self.cookie.split('=', 1)[1], stored)
        self.stop(); self.start()
        self.assertEqual(self.request('/api/admin/me')[0], 200)
        self.server.admin_password_hash = password_hash('A different password')
        self.assertEqual(self.request('/api/admin/me')[0], 401)
        self.server.admin_password_hash = HASH
        with self.server.connect() as db:
            db.execute('UPDATE admin_sessions SET expires_at = 1')
        self.assertEqual(self.request('/api/admin/me')[0], 401)
        self.login()
        status, _, headers = self.request('/api/admin/logout', {})
        self.assertEqual(status, 200)
        self.assertIn('Max-Age=0', headers['Set-Cookie'])
        self.assertEqual(self.request('/api/admin/me')[0], 401)

    def test_disabled_admin_login_rate_and_invalid_payloads(self):
        self.server.admin_password_hash = ''
        self.assertEqual(self.request('/api/admin/login', {'username': 'admin', 'password': PASSWORD})[0], 503)
        self.assertEqual(self.request('/api/admin/emails')[0], 503)
        self.server.admin_password_hash = HASH
        for _ in range(9):
            self.assertEqual(self.request('/api/admin/login', {'username': [], 'password': None})[0], 401)
        self.assertEqual(self.request('/api/admin/login', {'username': 'admin', 'password': PASSWORD})[0], 429)
        self.server.requests.clear()
        self.assertEqual(self.request('/api/admin/login', [], auth=False)[0], 400)
        self.assertEqual(self.request('/api/admin/login', {}, headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('/api/admin/login', {'x': 'a' * 5000})[0], 413)
        self.assertFalse(verify_password(PASSWORD, 'broken'))
        self.assertFalse(verify_password('wrong', HASH))
        self.assertTrue(verify_password(PASSWORD, HASH))

    def test_session_management_is_enforced_for_public_join(self):
        self.login()
        status, result, _ = self.request('/api/admin/sessions', {})
        self.assertEqual(status, 201)
        session_id = result['id']
        self.assertEqual(self.request('/api/sessions/join', {'sessionId': session_id}, auth=False)[0], 200)
        expiry = int(time.time()) + 10000
        path = '/api/admin/sessions/' + session_id
        self.assertEqual(self.request(path, {'expiresAt': expiry, 'disabled': True}, method='PUT')[0], 200)
        self.assertEqual(self.request('/api/sessions/join', {'sessionId': session_id}, auth=False)[0], 404)
        self.stop(); self.start()
        self.assertEqual(self.request('/api/admin/sessions')[1]['items'][0]['status'], 'disabled')
        self.assertEqual(self.request(path, {'expiresAt': expiry, 'disabled': False}, method='PUT')[0], 200)
        self.assertEqual(self.request('/api/sessions/join', {'sessionId': session_id}, auth=False)[0], 200)
        self.assertEqual(self.request(path, {'expiresAt': 1, 'disabled': False}, method='PUT')[0], 200)
        self.request('/api/sessions', {}, auth=False)
        result = self.request('/api/admin/sessions?q=' + session_id)[1]
        self.assertEqual(result['items'][0]['status'], 'expired')
        self.assertEqual(self.request(path, {'expiresAt': 'tomorrow', 'disabled': False}, method='PUT')[0], 400)
        self.assertEqual(self.request(path, method='DELETE')[0], 200)
        self.assertEqual(self.request(path, method='DELETE')[0], 404)

    def test_email_editing_deduplication_conflict_and_deletion(self):
        self.request('/api/email-preferences', {'emailOne': 'A@example.org', 'emailTwo': 'b@example.org', 'interval': 'weekly'}, auth=False)
        self.login()
        item = self.request('/api/admin/emails?q=example.org')[1]['items'][0]
        self.assertEqual(item['email_one'], 'a@example.org')
        path = '/api/admin/emails/' + str(item['id'])
        status = self.request(path, {'emailOne': 'c@example.org', 'emailTwo': 'd@example.org', 'interval': 'monthly'}, method='PUT')[0]
        self.assertEqual(status, 200)
        self.request('/api/email-preferences', {'emailOne': 'D@example.org', 'emailTwo': 'C@example.org', 'interval': 'daily'}, auth=False)
        item = self.request('/api/admin/emails')[1]['items'][0]
        self.assertEqual(item['interval'], 'daily')
        self.assertEqual(item['id'], int(path.split('/')[-1]))
        self.assertEqual(self.request('/api/admin/emails', {'emailOne': 'd@example.org', 'emailTwo': 'c@example.org', 'interval': 'weekly'})[0], 409)
        self.assertEqual(self.request(path, {'emailOne': 'bad', 'emailTwo': 'c@example.org', 'interval': 'weekly'}, method='PUT')[0], 400)
        self.assertEqual(self.request(path, method='DELETE')[0], 200)
        self.assertEqual(self.request('/api/admin/emails')[1]['total'], 0)
        self.assertEqual(self.request('/api/email-preferences', auth=False)[0], 404)

    def test_lists_drafts_assignments_edits_and_public_content(self):
        self.login()
        first = self.create_list()
        draft = self.create_list(name='Geheim', enabled=False, items=[], methods=['self'])
        values = self.create_list(name='Werte', kind='values', items=['Nähe', '<script>alert(1)</script>'], methods=['email'])
        public = self.request('/api/methods/self/content', auth=False)[1]
        self.assertEqual([item['id'] for item in public['lists']], [first])
        self.assertEqual(public['lists'][0]['items'][0], 'Was gibt dir Kraft?')
        self.assertNotIn('email', json.dumps(public))
        self.assertEqual(self.request('/api/admin/lists')[1]['total'], 3)
        self.assertEqual(self.request('/api/methods/email/content', auth=False)[1]['lists'][0]['id'], values)
        self.assertEqual(self.request('/api/methods/unknown/content', auth=False)[0], 404)
        update = dict(name='Neue Fragen', kind='questions', items=['Was ist heute wichtig?'], enabled=True, methods=['email'])
        self.assertEqual(self.request('/api/admin/lists/' + str(first), update, method='PUT')[0], 200)
        self.assertEqual(self.request('/api/methods/self/content', auth=False)[1]['lists'], [])
        self.assertEqual(len(self.request('/api/methods/email/content', auth=False)[1]['lists']), 2)
        self.stop(); self.start()
        self.assertEqual(len(self.request('/api/methods/email/content', auth=False)[1]['lists']), 2)
        self.assertEqual(self.request('/api/admin/lists/' + str(first), method='DELETE')[0], 200)
        self.assertEqual(len(self.request('/api/methods/email/content', auth=False)[1]['lists']), 1)
        with self.server.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM method_lists WHERE list_id = ?', (first,)).fetchone()[0], 0)
        self.assertEqual(self.request('/api/admin/lists?q=Geheim')[1]['items'][0]['id'], draft)

    def test_list_validation_and_payload_limits(self):
        self.login()
        valid = dict(name='Fragen', kind='questions', items=['Eine Frage?'], enabled=True, methods=['self'])
        for change in ({'name': ''}, {'name': 'x' * 101}, {'kind': []}, {'items': ['']}, {'items': ['x' * 501]}, {'items': ['x\ny']}, {'items': ['x'] * 201}, {'items': []}, {'enabled': 'true'}, {'methods': ['unknown']}, {'methods': ['self', 'self']}, {'methods': [[]]}):
            self.assertEqual(self.request('/api/admin/lists', valid | change)[0], 400, change)
        self.assertEqual(self.request('/api/admin/lists')[1]['total'], 0)
        self.assertEqual(self.request('/api/admin/lists', valid | {'items': ['ä' * 500] * 200})[0], 201)
        self.assertEqual(self.request('/api/admin/lists', {}, headers={'Content-Length': '524289'})[0], 413)
        self.assertEqual(self.request('/api/admin/lists?offset=-1')[0], 400)
        self.assertEqual(self.request('/api/admin/lists?offset=no')[0], 400)

    def test_search_pagination_and_static_admin_files(self):
        self.login()
        with self.server.connect() as db:
            db.executemany('INSERT INTO content_lists (name, kind, items, enabled, updated_at) VALUES (?, ?, ?, ?, ?)',
                           [('Liste ' + str(i), 'values', '["Mut"]', 0, i) for i in range(55)])
        first = self.request('/api/admin/lists')[1]
        second = self.request('/api/admin/lists?offset=50')[1]
        self.assertEqual((first['total'], len(first['items']), len(second['items'])), (55, 50, 5))
        self.assertFalse({item['id'] for item in first['items']} & {item['id'] for item in second['items']})
        self.assertEqual(self.request('/api/admin/lists?q=Liste%2054')[1]['total'], 1)
        self.assertEqual(self.request('/api/admin/lists?q=%27%20OR%201=1')[1]['total'], 0)
        self.assertEqual(self.request('/api/admin/lists/999999', method='DELETE')[0], 404)
        for path in ('/admin', '/admin/', '/admin.js', '/admin.css'):
            self.assertEqual(self.request(path, auth=False)[0], 200)
        self.assertEqual(self.request('/api/admin/emails', method='HEAD')[1], b'')


class MigrationTest(unittest.TestCase):
    def test_original_database_upgrades_without_data_loss(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'old.sqlite3'
            with sqlite3.connect(path) as db:
                db.executescript('''CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
                    CREATE TABLE email_preferences (email_one TEXT NOT NULL, email_two TEXT NOT NULL, interval TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(email_one, email_two));
                    INSERT INTO sessions VALUES ('ABCDEF-ABCDEF-ABCDEF-ABCDEF', 1, 9999999999);
                    INSERT INTO email_preferences VALUES ('a@example.org', 'b@example.org', 'weekly', 123);''')
            for _ in range(2):
                server = PilinovaServer(('127.0.0.1', 0), path)
                try:
                    with server.connect() as db:
                        self.assertEqual(db.execute('SELECT disabled FROM sessions').fetchall(), [(0,)])
                        self.assertEqual(db.execute('SELECT email_one, email_two, interval, updated_at FROM email_preferences').fetchall(), [('a@example.org', 'b@example.org', 'weekly', 123)])
                        self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                finally:
                    server.server_close()


if __name__ == '__main__':
    unittest.main()
