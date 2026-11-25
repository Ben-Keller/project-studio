"""Real HTTP boundary checks; all process/vault effects are mocked."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import auth as auth
from app import credentials as vault
import local_tools_launcher as launcher
from http.server import ThreadingHTTPServer


class AuthBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = patch.object(auth, 'AUTH_DIR', Path(self.temp.name)/'auth')
        self.directory.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), launcher.Handler)
        auth.initialize(self.server.server_port)
        self.host = '127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        status, _, data = self.request('POST', '/api/studio/session', {'bootstrap':auth.BOOTSTRAP})
        self.assertEqual(status, 200)
        self.session = json.loads(data)['session']

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.directory.stop(); self.temp.cleanup()

    def request(self, method, path, body=None, owner=False, headers=None):
        base = {'Origin':'http://' + self.host, 'Content-Type':'application/json'}
        if owner:
            base.update({'X-Studio-Session':self.session, 'X-Studio-Action':'1', 'X-Studio-CSRF':vault.CSRF})
        base.update(headers or {})
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, json.dumps(body) if body is not None else None, base)
        response=connection.getresponse(); result=(response.status,dict(response.getheaders()),response.read())
        connection.close(); return result

    def test_public_assets_revalidate_but_private_pages_never_cache(self):
        status, headers, body = self.request('GET', '/project-studio-assets/studio-loading.css')
        headers = {k.lower(): v for k,v in headers.items()}
        self.assertEqual(status, 200)
        self.assertIn(b'color-scheme: dark', body)
        self.assertEqual(headers['cache-control'], 'private, no-cache')
        self.assertEqual(self.request('GET', '/project-studio-assets/studio-loading.css',
                                     headers={'If-None-Match': headers['etag']})[0], 304)
        self.assertEqual(self.request('GET', '/project-studio-assets/studio-loading.css',
                                     headers={'If-None-Match': '"old"'})[0], 200)
        for path in ['/', '/credentials']:
            _, h, b = self.request('GET', path)
            self.assertEqual({k.lower():v for k,v in h.items()}['cache-control'], 'no-store')
            self.assertIn(b'studio-loading.css', b)
            self.assertNotIn(b'tool-card', b)
        self.assertEqual(self.request('GET', '/project-studio-assets/docs/credentials.md',
                                     headers={'If-None-Match': headers['etag']})[0], 200)
        _, h, _ = self.request('GET', '/project-studio-assets/docs/credentials.md', owner=True)
        self.assertEqual({k.lower():v for k,v in h.items()}['cache-control'], 'no-store')

    def test_state_requires_independent_owner_authority(self):
        self.assertEqual(self.request('GET','/api/credentials/state')[0],401)
        with patch.object(vault,'inventory',return_value={'credentials':[]}):
            self.assertEqual(self.request('GET','/api/credentials/state',owner=True)[0],200)
        self.assertEqual(self.request('POST','/api/studio/session',{'bootstrap':'wrong'})[0],403)

    def test_every_native_alias_requires_owner_post_and_get_is_inert(self):
        actions=['/stop-all','/apps/demo/open','/apps/demo/stop','/apps/demo/folder',
                 '/services/demo/open','/services/demo/stop','/links/demo/open?capture=1']
        with patch.object(launcher,'_start_app') as start, patch.object(launcher,'_stop_all_local_apps') as stop, patch.object(launcher,'_folder_html') as folder:
            for path in actions:
                self.assertEqual(self.request('GET',path,owner=True)[0],200)
                self.assertEqual(self.request('POST',path)[0],401)
                self.assertEqual(self.request('POST',path,owner=True,headers={'Origin':'http://evil.example'})[0],403)
            for path in ['/apps/demo/extra/folder','/apps/demo/extra/open','/services/demo/extra/stop','/links/demo/extra/open']:
                self.assertEqual(self.request('GET',path,owner=True)[0],404)
            start.assert_not_called(); stop.assert_not_called(); folder.assert_not_called()

    def test_credential_writes_and_launcher_actions_work_only_with_authority(self):
        with patch.object(vault,'add_secret',return_value={'saved':True}) as save:
            self.assertEqual(self.request('POST','/api/credentials/save',{},owner=True)[0],200)
            self.assertEqual(save.call_count,1)
            self.assertEqual(self.request('POST','/api/credentials/save',{},owner=True,headers={'X-Studio-CSRF':'wrong'})[0],403)
            self.assertEqual(self.request('POST','/api/credentials/save',{},owner=True,headers={'X-Studio-Action':''})[0],403)
            self.assertEqual(save.call_count,1)
        with patch.object(launcher,'_find_app',return_value=object()),patch.object(launcher,'_start_app',return_value={'ready':True}) as start:
            self.assertEqual(self.request('POST','/api/apps/demo/launch',owner=True)[0],200)
            self.assertEqual(start.call_count,1)

    def test_alias_removed_and_all_html_disallows_frames(self):
        for path in ['/credentials','/project-studio-assets/credentials.html','/apps/demo/open']:
            status,headers,_=self.request('GET',path,owner=True)
            self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])
            self.assertEqual(headers['X-Frame-Options'],'DENY')
            if path.endswith('credentials.html'):self.assertEqual(status,404)

    def test_expiry_restart_host_and_fetch_metadata(self):
        auth.SESSIONS[self.session]['expires']=time.time()-1
        self.assertEqual(self.request('GET','/api/credentials/state',owner=True)[0],401)
        self.assertEqual(self.request('GET','/credentials',owner=True)[0],401)
        auth.initialize(self.server.server_port)
        self.assertEqual(self.request('GET','/api/credentials/state',owner=True)[0],401)
        self.assertEqual(self.request('GET','/',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.request('GET','/',headers={'Sec-Fetch-Site':'cross-site'})[0],403)

    def test_private_bootstrap_and_no_public_disclosure(self):
        path=auth.AUTH_DIR/(str(self.server.server_port)+'.json')
        self.assertEqual(path.stat().st_mode & 0o777,0o600)
        self.assertEqual(auth.AUTH_DIR.stat().st_mode & 0o777,0o700)
        for url in ['/','/credentials','/healthz','/api/credentials/state']:
            self.assertNotIn(auth.BOOTSTRAP.encode(),self.request('GET',url)[2])


if __name__=='__main__':unittest.main()
