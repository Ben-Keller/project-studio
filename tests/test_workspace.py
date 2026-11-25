import json
from pathlib import Path
import tempfile
import unittest
from app.workspace import copy_workspace, save_preferences

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.source=self.root/'source';(self.source/'outputs/private').mkdir(parents=True)
        (self.source/'outputs/private/catalog.json').write_text(json.dumps({'schema_version':1,'apps':[]}))
        (self.source/'assets/photos').mkdir(parents=True)
        (self.source/'assets/photos/one.jpg').write_bytes(b'photo')
    def tearDown(self):self.tmp.cleanup()
    def test_atomic_migration_and_verified_backup(self):
        target=self.root/'new'
        save_preferences(self.source/'outputs',{'projectStudioMode':'portfolio'})
        copy_workspace(self.source,target,checkout=True,apply=True)
        self.assertEqual((target/'media/photos/one.jpg').read_bytes(),b'photo')
        self.assertEqual(json.loads((target/'preferences.json').read_text())['projectStudioMode'],'portfolio')
        backup=self.root/'backup';copy_workspace(target,backup,apply=True)
        (backup/'media/photos/one.jpg').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):copy_workspace(backup,self.root/'restore',apply=True)
        self.assertFalse((self.root/'restore').exists())
    def test_reject_existing_and_symlink(self):
        with self.assertRaises(ValueError):copy_workspace(self.source,self.root,checkout=True,apply=True)
        (self.source/'assets/photos/link').symlink_to('/etc/hosts')
        with self.assertRaises(ValueError):copy_workspace(self.source,self.root/'new',checkout=True,apply=True)
        self.assertFalse((self.root/'new').exists())
    def test_preferences_never_accept_authentication_tokens(self):
        with self.assertRaises(ValueError):save_preferences(self.source,{'auth':'secret'})

    def test_helper_references_are_portable(self):
        path=self.source/'outputs/private/catalog.json'
        value=json.loads(path.read_text())
        value['apps']=[{'slug':'sample','name':'Sample','url':'http://127.0.0.1:9999/',
            'processes':[{'name':'web','repo':'/tmp','command':f'python3 "{self.source}/spa_static_server.py" --port 9999'}]}]
        path.write_text(json.dumps(value))
        copy_workspace(self.source,self.root/'new',checkout=True,apply=True)
        migrated=json.loads((self.root/'new/private/catalog.json').read_text())
        self.assertEqual(migrated['apps'][0]['processes'][0]['command'],'@studio:spa --port 9999')
