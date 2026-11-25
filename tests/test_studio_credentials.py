"""Security and lifecycle checks use synthetic credentials only; no live vault writes."""
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import credentials as v
import studio_cli as c


class CredentialsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.seed = self.root / 'seed.json'
        self.seed.write_text(json.dumps({'studio_cards':[{'slug':'demo','name':'Demo','paths':[str(self.root)]}],
                                        'credentials':[{'id':'original','name':'TOKEN','project':'Demo','store':'GitHub','environment':'dev'}]}))
        self.patchers = [patch.object(v,'DATA',self.root/'state'),patch.object(v,'SEED',self.seed),patch.object(v,'DEPLOYMENTS',self.root/'deployments.json')]
        for p in self.patchers: p.start()
        self.b = {'project':'demo','project_id':'project-123','domain':v.DOMAINS[0],'folder':'/backend','required':['TOKEN']}
        v.configure(self.b)

    def tearDown(self):
        for p in self.patchers: p.stop()
        self.temp.cleanup()

    def test_deployment_metadata_uses_allowlist_and_keeps_overrides(self):
        snapshot={'checked_at':'2026-10-27T20:00:00Z','records':[
            {'store':'Azure App Service','studio_project':'demo','name':'JWT_SECRET','service':'app','resource_id':'/test/app','environment':'production','setting_type':'application settings','value_group':'group-1','value':'must-never-appear'},
            {'store':'Local environment','name':'JWT_SECRET','path':'/test/.env','value_group':'group-1'}]}
        v.save_json(v.DEPLOYMENTS,snapshot)
        row=next(r for r in v.inventory()['credentials'] if r['store']=='Azure App Service')
        self.assertNotIn('must-never-appear',json.dumps(v.inventory()))
        self.assertIn('/test/.env',row['consumers'])
        v.update_record({'id':row['id'],'owner':'Verified owner'})
        updated=next(r for r in v.inventory()['credentials'] if r['id']==row['id'])
        self.assertEqual(updated['owner'],'Verified owner')
        self.assertEqual(v.inventory()['counts']['total_register_records'],2)

    def test_connection_rejects_unknown_project_and_domain(self):
        for changes in ({'project':'other'}, {'domain':'https://attacker.example'}, {'folder':'/../prod'}, {'required':['TOKEN; printenv']}):
            with self.assertRaises(v.CredentialError): v.configure(dict(self.b,**changes))

    def test_metadata_is_private_and_atomic(self):
        path = v.DATA/'state.json'
        self.assertEqual(path.stat().st_mode & 0o777,0o600)
        self.assertEqual(list(path.parent.glob('*.tmp')),[])

    def test_values_only_in_pipe_and_never_metadata(self):
        value = 'synthetic-unique-key\nsecond-line\n'
        with patch.object(v,'fetch_values',side_effect=[{}, {'TOKEN':value}]), patch.object(v,'cli') as call:
            v.add_secret({'project':'demo','name':'TOKEN','value':value,'owner':'Tester'})
        args = call.call_args
        self.assertIn('TOKEN=@/dev/stdin',args.args[0])
        self.assertNotIn(value,str(args.args[0]))
        self.assertEqual(args.args[2],value)
        self.assertNotIn(value,(v.DATA/'state.json').read_text())
        self.assertEqual(v.state()['entries'][0]['rotation_status'],'stored; consumers need verification')

    def test_existing_name_requires_explicit_replace(self):
        with patch.object(v,'fetch_values',return_value={'TOKEN':'old'}), patch.object(v,'cli') as call:
            with self.assertRaises(v.CredentialError): v.add_secret({'project':'demo','name':'TOKEN','value':'new'})
            call.assert_not_called()

    def test_verify_mismatch_does_not_claim_success(self):
        with patch.object(v,'fetch_values',side_effect=[{}, {'TOKEN':'wrong'}]), patch.object(v,'cli'):
            with self.assertRaisesRegex(v.CredentialError,'may have succeeded'):
                v.add_secret({'project':'demo','name':'TOKEN','value':'new'})
        self.assertEqual(v.state()['entries'],[])

    def test_status_returns_names_only(self):
        with patch.object(v,'fetch_values',return_value={'TOKEN':'secret-output-canary'}):
            result=v.vault_status('demo')
        self.assertEqual(result['names'],['TOKEN'])
        self.assertNotIn('secret-output-canary',json.dumps(result))

    def test_cli_provider_errors_are_not_returned(self):
        with patch.object(v,'cli_path',return_value='/bin/fake'), patch.object(v.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='leaked-value',stderr='leaked-value')):
            with self.assertRaises(v.CredentialError) as caught: v.cli(['export'],v.DOMAINS[0])
        self.assertNotIn('leaked-value',str(caught.exception))

    def test_cli_does_not_inherit_tokens(self):
        with patch.dict(os.environ,{'INFISICAL_TOKEN':'never-forward','OPENAI_API_KEY':'never-forward'}), patch.object(v,'cli_path',return_value='/bin/fake'), patch.object(v.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='[]')) as run:
            v.cli(['export'],v.DOMAINS[0])
        self.assertNotIn('INFISICAL_TOKEN',run.call_args.kwargs['env'])
        self.assertNotIn('OPENAI_API_KEY',run.call_args.kwargs['env'])

    def test_export_disables_expansion_and_imports(self):
        with patch.object(v,'cli',return_value='[{"key":"TOKEN","value":"$literal"}]') as call:
            self.assertEqual(v.fetch_values(self.b),{'TOKEN':'$literal'})
        self.assertIn('--expand=false',call.call_args.args[0])
        self.assertIn('--include-imports=false',call.call_args.args[0])

    def test_runtime_only_injects_required_development_names(self):
        m={'version':1,'project':'demo','profiles':{'dev':[['echo','test']]}}
        with patch.object(c,'find_manifest',return_value=(self.root,m)), patch.object(c.studio_dev_access,'fetch_values',return_value={'TOKEN':'needed','EXTRA':'exclude'}) as fetch, patch.object(c,'run_commands',return_value=0) as run:
            c.run_profile('dev')
        self.assertEqual(fetch.call_args.args[1],'dev')
        self.assertEqual(run.call_args.args[2],{'TOKEN':'needed'})

    def test_missing_key_does_not_launch(self):
        m={'version':1,'project':'demo','profiles':{'dev':[['echo','test']]}}
        with patch.object(c,'find_manifest',return_value=(self.root,m)), patch.object(c.studio_dev_access,'fetch_values',return_value={}), patch.object(c,'run_commands') as run:
            with self.assertRaises(v.CredentialError): c.run_profile('dev')
            run.assert_not_called()

    def test_clean_child_environment(self):
        with patch.dict(os.environ,{'OTHER_SECRET':'nope','INFISICAL_TOKEN':'nope'}):
            env=c.child_environment({'TOKEN':'yes'})
        self.assertEqual(env['TOKEN'],'yes')
        self.assertNotIn('OTHER_SECRET',env)
        self.assertNotIn('INFISICAL_TOKEN',env)

    def test_redactor_handles_chunk_boundaries_and_multiline(self):
        r=c.Redactor(['abcdef','one\ntwo'])
        output=b''.join(r.feed(x) for x in [b'hello ab',b'cdef\none',b'\ntwo done'])+r.feed(final=True)
        self.assertEqual(output,b'hello [REDACTED]\n[REDACTED] done')

    def test_redactor_masks_overlapping_longest_value(self):
        r=c.Redactor(['abc','abcdef'])
        self.assertEqual(r.feed(b'abcdef abc',final=True),b'[REDACTED] [REDACTED]')

    def test_real_child_receives_key_without_printing_it(self):
        script = "import os; print('has_key=' + str(bool(os.environ.get('TOKEN')))); print(os.environ['TOKEN']); print('unrelated=' + str('UNRELATED_SECRET' in os.environ))"
        capture = io.BytesIO()
        output = SimpleNamespace(buffer=capture)
        with patch.dict(os.environ, {'UNRELATED_SECRET':'parent-only'}), patch.object(c.sys, 'stdout', output):
            result = c.run_commands([[sys.executable, '-c', script]], self.root, {'TOKEN':'unique-child-canary'})
        self.assertEqual(result, 0)
        self.assertIn(b'has_key=True', capture.getvalue())
        self.assertIn(b'unrelated=False', capture.getvalue())
        self.assertNotIn(b'unique-child-canary', capture.getvalue())
        self.assertIn(b'[REDACTED]', capture.getvalue())

    def test_failing_component_stops_siblings(self):
        capture=io.BytesIO()
        with patch.object(c.sys, 'stdout', SimpleNamespace(buffer=capture)):
            result=c.run_commands([[sys.executable,'-c','import sys;sys.exit(7)'],[sys.executable,'-c','import time;time.sleep(30)']],self.root,{})
        self.assertEqual(result,7)

    def test_env_parser_handles_quotes_comments_and_multiline(self):
        f=self.root/'.env'
        f.write_text('# comment\nexport PLAIN=abc#notcomment\nSPACED=abc # trailing\nDQ="a\\"b\\nc"\nSQ=\'x y\'\nEMPTY=\nMULTI="-----BEGIN\nrest"\n')
        got=v.parse_env_file(f)
        self.assertEqual(got['PLAIN'],'abc#notcomment')
        self.assertEqual(got['SPACED'],'abc')
        self.assertEqual(got['DQ'],'a"b\nc')
        self.assertEqual(got['SQ'],'x y')
        self.assertEqual(got['EMPTY'],'')
        self.assertIsNone(got['MULTI'])

    def test_import_writes_selected_names_to_development_only(self):
        f=self.root/'.env'
        f.write_text('TOKEN=synthetic-import-value\nOTHER=not-selected\nBLANK=\n')
        with patch.object(v,'add_secret',return_value={'ok':True}) as add:
            results=v.import_env('demo',f,['TOKEN','BLANK','ABSENT'])
        self.assertEqual(add.call_count,1)
        sent=add.call_args.args[0]
        self.assertEqual((sent['name'],sent['environment'],sent['replace']),('TOKEN','dev',True))
        self.assertEqual(sent['value'],'synthetic-import-value')
        self.assertNotIn('synthetic-import-value',json.dumps(results))
        self.assertEqual([r['result'] for r in results],['saved and verified in development','empty or multi-line; use studio secrets add','not in file'])

    def test_import_command_prints_names_only_and_refreshes_reference(self):
        f=self.root/'.env'; f.write_text('TOKEN=synthetic-cli-value\n')
        m={'version':1,'project':'demo','vault':{},'profiles':{'dev':[['echo','test']]}}
        out=io.StringIO()
        with patch.object(c,'find_manifest',return_value=(self.root,m)), patch.object(v,'add_secret',return_value={'ok':True}), patch('sys.stdout',out), patch('sys.stderr',io.StringIO()):
            self.assertEqual(c.main(['secrets','import',str(f),'--names','TOKEN']),0)
        self.assertNotIn('synthetic-cli-value',out.getvalue())
        self.assertIn('saved and verified',out.getvalue())
        self.assertEqual(v.read_json(self.root/'.studio-secrets.json',{})['vault']['project_id'],'project-123')

    def test_named_profile_runs_through_development_runner(self):
        m={'version':1,'project':'demo','profiles':{'workspace':[['echo','test']]}}
        with patch.object(c,'find_manifest',return_value=(self.root,m)), patch.object(c.studio_dev_access,'fetch_values',return_value={'TOKEN':'needed'}) as fetch, patch.object(c,'run_commands',return_value=0) as run:
            self.assertEqual(c.main(['run','workspace']),0)
        self.assertEqual(fetch.call_args.args[1],'dev')
        self.assertEqual(run.call_args.args[2],{'TOKEN':'needed'})

    def test_manifest_moves_and_works_without_local_state(self):
        moved=self.root/'new-folder'; moved.mkdir()
        v.save_json(moved/'.studio-secrets.json',{'version':1,'project':'elsewhere','vault':self.b,'profiles':{'dev':[['echo','test']]}})
        nested=moved/'src'; nested.mkdir()
        root,m=c.find_manifest(nested)
        self.assertEqual(root,moved.resolve())
        self.assertEqual(c.project_binding(m)['project_id'],'project-123')

    def test_agent_instructions_preserve_existing_text(self):
        (self.root/'AGENTS.md').write_text('Existing instructions.\n')
        c.install_instructions(self.root); c.install_instructions(self.root)
        text=(self.root/'AGENTS.md').read_text()
        self.assertTrue(text.startswith('Existing instructions.'))
        self.assertEqual(text.count('<!-- studio-credentials -->'),1)
        self.assertTrue((self.root/'CLAUDE.md').is_file())
        (self.root/'.studio'/'credentials.md').write_text('Outdated guide')
        c.install_instructions(self.root)
        self.assertNotEqual((self.root/'.studio'/'credentials.md').read_text(),'Outdated guide')

    def test_complete_rotation_requires_date(self):
        with self.assertRaises(v.CredentialError): v.update_record({'id':'original','rotation_status':'complete'})
        v.update_record({'id':'original','rotation_status':'complete','last_rotated_at':'2026-10-27'})
        self.assertEqual(v.inventory()['credentials'][0]['rotation_status'],'complete')

    def test_verified_expiry_requires_date(self):
        with self.assertRaises(v.CredentialError): v.update_record({'id':'original','expiry_status':'verified'})

    def test_studio_launch_uses_shared_runner(self):
        import local_tools_launcher as launcher
        v.save_json(self.root/'.studio-secrets.json', {'version':1,'project':'demo','vault':self.b,'profiles':{}})
        app=SimpleNamespace(slug='demo')
        process=SimpleNamespace(repo=self.root,name='Demo worker',command='python3 app.py')
        with patch.object(launcher,'_pid_file_running',return_value=False), patch.object(launcher,'_repo_access_error',return_value=None), patch.object(launcher,'_app_state_dir',return_value=self.root), patch.object(launcher,'_log_file',return_value=self.root/'app.log'), patch.object(launcher,'_launcher_log',return_value=self.root/'launcher.log'), patch.object(launcher,'_pid_file',return_value=self.root/'app.pid'), patch.object(launcher.subprocess,'Popen',return_value=SimpleNamespace(pid=1234)) as start:
            self.assertTrue(launcher._start_process(app,process))
        args=start.call_args.args[0]
        self.assertTrue(args[1].endswith('studio_cli.py'))
        self.assertEqual(args[2:],['_run','--','/bin/bash','-c','python3 app.py'])
        self.assertEqual(start.call_args.kwargs['cwd'],str(self.root))

    def test_invalid_reference_does_not_fall_back_to_unprotected_launch(self):
        import local_tools_launcher as launcher
        (self.root/'.studio-secrets.json').write_text('{bad-json')
        app=SimpleNamespace(slug='demo')
        process=SimpleNamespace(repo=self.root,name='Demo worker',command='python3 app.py')
        with patch.object(launcher,'_pid_file_running',return_value=False), patch.object(launcher,'_repo_access_error',return_value=None), patch.object(launcher,'_app_state_dir',return_value=self.root), patch.object(launcher,'_log_file',return_value=self.root/'app.log'), patch.object(launcher.subprocess,'Popen') as start:
            self.assertFalse(launcher._start_process(app,process))
            start.assert_not_called()

    def test_same_variable_name_is_separate_per_consumer(self):
        v.configure(dict(self.b,consumers={'api':{'folder':'/api','required':[]},'worker':{'folder':'/worker','required':[]}}))
        with patch.object(v,'fetch_values',side_effect=[{}, {'TOKEN':'api-value'}, {}, {'TOKEN':'worker-value'}]), patch.object(v,'cli'):
            v.add_secret({'project':'demo','consumer':'api','name':'TOKEN','value':'api-value'})
            v.add_secret({'project':'demo','consumer':'worker','name':'TOKEN','value':'worker-value'})
        entries=v.state()['entries']
        self.assertEqual(len(entries),2)
        self.assertEqual({e['vault_reference']['folder'] for e in entries},{'/api','/worker'})
        self.assertNotEqual(entries[0]['id'],entries[1]['id'])
        self.assertEqual(v.state()['bindings']['demo']['consumers']['worker']['required'],['TOKEN'])

    def test_profile_selects_its_consumer_folder(self):
        v.configure(dict(self.b,consumers={'worker':{'folder':'/worker','required':['WORKER_TOKEN']}}))
        m={'version':1,'project':'demo','profile_consumers':{'worker':'worker'},'profiles':{'worker':[['echo','test']]}}
        with patch.object(c,'find_manifest',return_value=(self.root,m)),patch.object(c.studio_dev_access,'fetch_values',return_value={'WORKER_TOKEN':'needed','TOKEN':'exclude'}) as fetch,patch.object(c,'run_commands',return_value=0) as run:
            c.run_profile('worker')
        self.assertEqual(fetch.call_args.args[0]['folder'],'/worker')
        self.assertEqual(fetch.call_args.args[1],'dev')
        self.assertEqual(run.call_args.args[2],{'WORKER_TOKEN':'needed'})

    def test_connection_edit_preserves_service_folders(self):
        v.configure(dict(self.b,consumers={'api':{'folder':'/api','required':[]}}))
        v.configure(self.b)
        self.assertEqual(v.binding('demo')['consumers']['api']['folder'],'/api')

    def test_unknown_consumer_fails_before_vault_read(self):
        with patch.object(v,'fetch_values') as fetch:
            with self.assertRaises(v.CredentialError):
                v.add_secret({'project':'demo','consumer':'unknown','name':'TOKEN','value':'canary'})
            fetch.assert_not_called()

    def test_request_boundary(self):
        base={'Host':'127.0.0.1:8765','Origin':'http://127.0.0.1:8765','X-Studio-CSRF':v.CSRF}
        def check(headers,ip='127.0.0.1'):
            h=SimpleNamespace(headers=headers,client_address=(ip,1234),server=SimpleNamespace(server_port=8765))
            with patch.object(v.studio_auth, 'authenticated', return_value=True):
                return v.authorized(h,True)
        self.assertTrue(check(base))
        for change in ({'Origin':'http://evil.example'}, {'Host':'evil.example:8765'}, {'X-Studio-CSRF':'wrong'}, {'Sec-Fetch-Site':'cross-site'}, {'Origin':''}):
            self.assertFalse(check(dict(base,**change)))
        self.assertFalse(check(base,'192.168.1.10'))


class UpcomingTests(unittest.TestCase):
    def inv(self):
        return {'credentials': [
            {'name': 'A', 'project': 'P', 'tracking_required': True, 'rotation_status': 'not started', 'rotation_due_at': '2026-11-01'},
            {'name': 'B', 'project': 'P', 'tracking_required': True, 'rotation_status': 'complete', 'expires_at': '2026-11-20', 'rotation_due_at': '2026-11-13'},
            {'name': 'C', 'project': 'P', 'tracking_required': False, 'expires_at': '2026-11-02'},
            {'name': 'D', 'project': 'P', 'tracking_required': True, 'rotation_status': 'retired', 'expires_at': '2026-11-02'},
            {'name': 'E', 'project': 'P', 'tracking_required': True, 'rotation_status': 'complete', 'rotation_due_at': '2026-10-01', 'last_rotated_at': '2026-10-02'},
            {'name': 'F', 'project': 'P', 'tracking_required': True, 'rotation_status': 'in progress', 'expires_at': '2027-06-01'},
            {'name': 'A', 'project': 'P', 'tracking_required': True, 'rotation_status': 'not started', 'rotation_due_at': '2026-11-01'}],
            'access_protection': {'development_expires_at': '2026-10-27T10:00:00+00:00'}}

    def test_window_overdue_and_exclusions(self):
        import datetime as dt
        items = v.upcoming(30, today=dt.date(2026, 10, 29), inv=self.inv())
        self.assertEqual([(i['name'], i['kind']) for i in items],
                         [('Development vault access', 'expires'), ('A', 'review / rotate by'), ('B', 'replace before expiry'), ('B', 'expires')])
        self.assertEqual(items[0]['days_left'], -2)
        self.assertEqual(items[0]['hint'], 'studio access renew')

    def test_completed_rotation_keeps_next_deadline_without_expiry(self):
        import datetime as dt
        row = {'name':'NEXT', 'project':'P', 'tracking_required':True, 'rotation_status':'complete',
               'last_rotated_at':'2026-10-01', 'rotation_due_at':'2026-11-05'}
        self.assertEqual(len(v.upcoming(30, today=dt.date(2026,11,2), inv={'credentials':[row]})), 1)
        row['rotation_status'] = 'accepted exception'
        self.assertEqual(v.upcoming(30, today=dt.date(2026,11,2), inv={'credentials':[row]}), [])

    def test_reminder_text(self):
        import datetime as dt
        self.assertIsNone(v.reminder_text([]))
        head, body = v.reminder_text(v.upcoming(30, today=dt.date(2026, 10, 29), inv=self.inv()))
        self.assertEqual(head, '4 keys to deal with, 1 overdue')
        self.assertIn('2 days overdue', body)
        self.assertIn('and 1 more', body)

    def test_cli_due_lists_without_values(self):
        out = io.StringIO()
        with patch.object(v, 'upcoming', return_value=[{'name': 'A', 'project': 'P', 'kind': 'rotate by', 'date': '2026-11-01', 'days_left': 3, 'hint': ''}]), \
             patch.object(c, 'notify') as n, patch('sys.stdout', out):
            self.assertEqual(c.main(['keys', 'due', '--notify']), 0)
        self.assertIn('rotate by', out.getvalue())
        n.assert_called_once()


if __name__ == '__main__': unittest.main()
