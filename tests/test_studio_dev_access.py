import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import dev_access as dev
from app import credentials as vault


class DevAccessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'access.json'
        self.binding={'project_id':'original-vault','development_project_id':'dev-vault','folder':'/api','domain':vault.DOMAINS[0]}
        vault.save_json(self.path,{'projects':{'original-vault':{'status':'verified','development_project_id':'dev-vault','domain':vault.DOMAINS[0],'folders':['/api'],'identity_id':'restricted','client_id':'public-id'}}})
        self.patcher=patch.object(dev,'CONFIG',self.path);self.patcher.start()

    def tearDown(self):self.patcher.stop();self.temp.cleanup()

    def test_runtime_uses_separate_vault_and_machine_token(self):
        with patch.object(dev,'access_token',return_value='synthetic-machine-token'),patch.object(vault,'cli',return_value='[{"key":"KEY","value":"canary"}]') as cli:
            self.assertEqual(dev.fetch_values(dict(self.binding,development_project_id='tampered-target')),{'KEY':'canary'})
        args=cli.call_args.args[0]
        self.assertEqual(args[args.index('--projectId')+1],'dev-vault')
        self.assertEqual(cli.call_args.kwargs['machine_token'],'synthetic-machine-token')

    def test_missing_identity_fails_without_human_login_fallback(self):
        self.path.unlink()
        with patch.object(vault,'cli') as cli:
            with self.assertRaises(vault.CredentialError):dev.fetch_values(self.binding)
            cli.assert_not_called()

    def test_non_development_and_unapproved_folders_are_rejected(self):
        with patch.object(vault,'cli') as cli:
            for environment in ['staging','prod']:
                with self.assertRaises(vault.CredentialError):dev.fetch_values(self.binding,environment)
            with self.assertRaises(vault.CredentialError):dev.fetch_values(dict(self.binding,folder='/other'))
            cli.assert_not_called()

    def test_machine_token_is_private_environment_only(self):
        from types import SimpleNamespace
        with patch.object(vault,'cli_path',return_value='/bin/fake'),patch.object(vault.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='[]')) as run:
            vault.cli(['export'],vault.DOMAINS[0],machine_token='synthetic-token')
        self.assertNotIn('synthetic-token',str(run.call_args.args))
        self.assertEqual(run.call_args.kwargs['env']['INFISICAL_TOKEN'],'synthetic-token')

    def test_renewal_retries_pending_revocation_before_issuing_new_credential(self):
        config={'projects':{},'shared_development_identity':{'identity_id':'identity','client_id':'client','client_secret_id':'current','expires_at':'2027-01-25T22:00:00+00:00'},'pending_revocation':'old'}
        vault.save_json(self.path,config)
        with patch.object(vault,'cli',return_value='owner'),patch.object(dev,'request',side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError):dev.renew()
        self.assertEqual(vault.read_json(self.path,{})['pending_revocation'],'old')
        with patch.object(vault,'cli',return_value='owner'),patch.object(dev,'request',return_value={}) as request,patch.object(dev,'record_metadata'):
            self.assertTrue(dev.renew()['completed_pending_revocation'])
        self.assertEqual(request.call_count,1)
        self.assertTrue(request.call_args.args[1].endswith('/old/revoke'))
        self.assertNotIn('pending_revocation',vault.read_json(self.path,{}))

    def renewal_config(self):
        config={'projects':{},'shared_development_identity':{'identity_id':'identity','client_id':'client','client_secret_id':'old','expires_at':'2027-01-25T22:00:00+00:00'}}
        vault.save_json(self.path, config)
        return config

    def test_interrupted_issuance_blocks_retry_without_issuing_again(self):
        self.renewal_config()
        with patch.object(vault,'cli',return_value='owner'), patch.object(dev,'keychain_read',return_value='old-value'), patch.object(dev,'request',side_effect=RuntimeError('offline')) as req:
            with self.assertRaises(RuntimeError): dev.renew()
            with self.assertRaises(vault.CredentialError): dev.renew()
            self.assertEqual(req.call_count,1)
        marker=vault.read_json(self.path,{})['renewal_in_progress']
        self.assertEqual(marker['old_client_secret_id'],'old')
        self.assertTrue(marker['description'].startswith('Studio renewal '))

    def test_keychain_failure_preserves_both_ids_without_revocation(self):
        self.renewal_config()
        with patch.object(vault,'cli',return_value='owner'), patch.object(dev,'keychain_read',return_value='old-value'), patch.object(dev,'keychain_store',side_effect=RuntimeError('locked')), patch.object(dev,'request',side_effect=[{'clientSecret':'new-value','clientSecretData':{'id':'new'}},{'accessToken':'token'}]) as req:
            with self.assertRaises(RuntimeError): dev.renew()
            self.assertEqual(req.call_count,2)
        data=vault.read_json(self.path,{})
        self.assertEqual(data['renewal_in_progress']['new_client_secret_id'],'new')
        self.assertEqual(data['shared_development_identity']['client_secret_id'],'old')
        self.assertNotIn('new-value',self.path.read_text())

    def test_success_verifies_keychain_then_revokes_old(self):
        self.renewal_config()
        with patch.object(vault,'cli',return_value='owner'), patch.object(dev,'keychain_read',side_effect=['old-value','new-value']), patch.object(dev,'keychain_store') as store, patch.object(dev,'record_metadata'), patch.object(dev,'request',side_effect=[{'clientSecret':'new-value','clientSecretData':{'id':'new'}},{'accessToken':'token'},{}]) as req:
            self.assertTrue(dev.renew()['renewed'])
            store.assert_called_once_with('identity','new-value')
            self.assertTrue(req.call_args.args[1].endswith('/old/revoke'))
        data=vault.read_json(self.path,{})
        self.assertEqual(data['shared_development_identity']['client_secret_id'],'new')
        self.assertNotIn('renewal_in_progress',data)
        self.assertNotIn('pending_revocation',data)

    def test_parallel_renewal_is_rejected_before_remote_access(self):
        import fcntl
        self.renewal_config()
        fd=os.open(self.path.with_suffix('.lock'),os.O_CREAT|os.O_RDWR,0o600)
        with os.fdopen(fd,'w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(vault,'cli') as cli:
                with self.assertRaises(vault.CredentialError): dev.renew()
                cli.assert_not_called()

    def test_missing_keychain_does_not_issue_replacement(self):
        self.renewal_config()
        with patch.object(vault,'cli',return_value='owner'), patch.object(dev,'keychain_read',side_effect=RuntimeError('missing')), patch.object(dev,'request') as req:
            with self.assertRaises(RuntimeError): dev.renew()
            req.assert_not_called()

    def test_unsafe_local_configuration_is_rejected(self):
        self.path.chmod(0o644)
        with self.assertRaises(RuntimeError):dev.configuration(self.binding)


if __name__=='__main__':unittest.main()
