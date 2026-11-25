import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from app.registry import catalog, save_catalog, validate
from app.paths import state_root, inventory_root
from app.cli import main

class ReleaseContracts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'PROJECT_STUDIO_DATA_DIR': self.directory.name})
        self.env.start()
    def tearDown(self):
        self.env.stop(); self.directory.cleanup()
    def project(self):
        return {'slug':'demo','name':'Demo','url':'http://127.0.0.1:5173/','processes':[{'name':'web','repo':'/tmp/demo','command':'npm run dev','ports':[5173]}]}
    def test_empty_workspace_has_no_personal_projects(self):
        self.assertEqual(catalog()['apps'], [])
        self.assertEqual(inventory_root(), state_root()/'credentials/inventory')
    def test_catalog_round_trip_private_permissions(self):
        value=catalog();value['apps'].append(self.project());save_catalog(value)
        self.assertEqual(catalog(),value)
        self.assertEqual((state_root()/'private/catalog.json').stat().st_mode & 0o777, 0o600)
    def test_invalid_and_duplicate_projects_rejected(self):
        value=catalog();value['apps']=[self.project(), self.project()]
        with self.assertRaises(ValueError):validate(value)
        value['apps']=[{**self.project(),'url':'https://user:password@example.com/'}]
        with self.assertRaises(ValueError):validate(value)
    def test_registration_requires_explicit_command_trust(self):
        manifest=Path(self.directory.name)/'project.json';manifest.write_text(json.dumps(self.project()))
        with self.assertRaises(SystemExit):main(['projects','add',str(manifest)])
        self.assertEqual(catalog()['apps'], [])
        self.assertEqual(main(['projects','add',str(manifest),'--trust-commands']),0)
        self.assertEqual(len(catalog()['apps']),1)
    def test_corrupt_catalog_never_silently_resets(self):
        path=state_root()/'private/catalog.json';path.parent.mkdir();path.write_text('{invalid')
        with self.assertRaises(json.JSONDecodeError):catalog()
        self.assertEqual(path.read_text(),'{invalid')
