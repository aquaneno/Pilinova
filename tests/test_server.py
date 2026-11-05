import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from server import PilinovaServer


class ApplicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'app.sqlite3'
        self.start_server()

    def start_server(self):
        self.server = PilinovaServer(('127.0.0.1', 0), self.database)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def tearDown(self):
        self.stop_server()
        self.temp.cleanup()

    def request(self, path, data=None, method=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method or ('POST' if data is not None else 'GET'), path,
                               body=json.dumps(data) if data is not None else None,
                               headers=headers or ({'Content-Type': 'application/json'} if data is not None else {}))
            response = connection.getresponse()
            raw = response.read()
            content = json.loads(raw) if raw and response.getheader('Content-Type').startswith('application/json') else raw
            return response.status, content, dict(response.getheaders())
        finally:
            connection.close()

    def test_sessions_survive_restart_and_accept_formatted_input(self):
        status, result, _ = self.request('/api/sessions', {})
        self.assertEqual(status, 201)
        session_id = result['sessionId']
        self.assertRegex(session_id, r'^[A-F0-9]{6}(?:-[A-F0-9]{6}){3}$')
        self.stop_server()
        self.start_server()
        status, result, _ = self.request('/api/sessions/join', {'sessionId': session_id.lower().replace('-', ' ')})
        self.assertEqual(status, 200)
        self.assertEqual(result['sessionId'], session_id)

    def test_expired_unknown_and_invalid_sessions(self):
        _, result, _ = self.request('/api/sessions', {})
        session_id = result['sessionId']
        with self.server.connect() as db:
            db.execute('UPDATE sessions SET expires_at = ?', (int(time.time()) - 1,))
        self.assertEqual(self.request('/api/sessions/join', {'sessionId': session_id})[0], 404)
        self.assertEqual(self.request('/api/sessions/join', {'sessionId': 'ABCDEF-' * 3 + 'ABCDEF'})[0], 404)
        for invalid in (None, [], "' OR 1=1 --", ''):
            self.assertEqual(self.request('/api/sessions/join', {'sessionId': invalid})[0], 400)

    def test_preferences_are_persistent_and_deduplicate_reversed_addresses(self):
        for interval in ('daily', 'weekly', 'monthly'):
            status, result, _ = self.request('/api/email-preferences', {'emailOne': 'A@example.org', 'emailTwo': 'b@example.org', 'interval': interval})
            self.assertEqual(status, 200)
            self.assertFalse(result['deliveryEnabled'])
        self.request('/api/email-preferences', {'emailOne': 'b@example.org', 'emailTwo': 'a@example.org', 'interval': 'weekly'})
        self.stop_server()
        self.start_server()
        with self.server.connect() as db:
            self.assertEqual(db.execute('SELECT email_one, email_two, interval FROM email_preferences').fetchall(), [('a@example.org', 'b@example.org', 'weekly')])
        self.assertEqual(self.request('/api/email-preferences')[0], 404)

    def test_invalid_email_preferences_are_not_saved(self):
        for one, two, interval in [('bad', 'b@example.org', 'daily'), ('a@example.org', 'A@example.org', 'weekly'), ('a@example.org', 'b@example.org', 'hourly'), ([], 'b@example.org', 'daily'), ('a@example.org', 'b@example.org', [])]:
            self.assertEqual(self.request('/api/email-preferences', {'emailOne': one, 'emailTwo': two, 'interval': interval})[0], 400)
        with self.server.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM email_preferences').fetchone()[0], 0)

    def test_origin_payload_and_content_type_guards(self):
        self.assertEqual(self.request('/api/sessions', {}, headers={'Content-Type': 'application/json', 'Origin': 'https://other.example'})[0], 403)
        self.assertEqual(self.request('/api/sessions', {}, headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('/api/sessions', {'large': 'a' * 5000})[0], 413)
        self.assertEqual(self.request('/api/sessions', [1, 2])[0], 400)

    def test_static_health_headers_and_private_files(self):
        for path in ('/', '/styles.css', '/app.js', '/favicon.svg', '/api/health'):
            status, _, headers = self.request(path)
            self.assertEqual(status, 200)
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
            self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        for path in ('/server.py', '/../server.py', '/data/pilinova.sqlite3', '/missing'):
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request('/', method='HEAD')[1], b'')

    def test_rate_limit(self):
        for _ in range(30):
            self.assertEqual(self.request('/api/sessions', {})[0], 201)
        status, _, headers = self.request('/api/sessions', {})
        self.assertEqual(status, 429)
        self.assertEqual(headers['Retry-After'], '60')
        self.assertEqual(self.request('/api/health')[0], 200)


if __name__ == '__main__':
    unittest.main()
