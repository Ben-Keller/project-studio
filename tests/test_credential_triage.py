import unittest
from app.credential_triage import enrich_inventory


def entry(rid, **fields):
    return dict(id=rid, name='OPENAI_API_KEY', kind='Managed credential',
                store='Infisical', provider='OpenAI', rotation_status='not started', **fields)


def enrich(records, review=None):
    return enrich_inventory({'credentials': records, 'counts': {}}, review or {})


class TriageTests(unittest.TestCase):
    def test_local_file_does_not_make_provider_key_disposable(self):
        r = entry('a'); r.update(store='Local files', kind='Local value observed')
        result = enrich([r])
        self.assertEqual(result['credentials'][0]['classification'], 'external')
        self.assertTrue(r['tracking_required'])

    def test_references_and_identifiers_do_not_require_rotation(self):
        reference = entry('r'); reference['kind'] = 'Reference only'
        identifier = entry('i'); identifier['name'] = 'AZURE_CLIENT_ID'
        enrich([reference, identifier])
        self.assertFalse(reference['tracking_required'])
        self.assertFalse(identifier['tracking_required'])

    def test_generated_hosted_session_key_remains_managed(self):
        r = entry('s'); r.update(name='EDIM_AUTH_SESSION_SECRET', provider='Azure / application')
        enrich([r])
        self.assertEqual(r['classification'], 'application')
        self.assertTrue(r['tracking_required'])

    def test_unknown_and_browser_keys_are_not_silently_excluded(self):
        r = entry('a'); r['kind'] = 'API key metadata; consumer type unverified'
        enrich([r]); self.assertEqual(r['classification'], 'review')
        self.assertTrue(r['tracking_required'])

    def test_signed_url_cannot_be_excluded_by_name(self):
        r = entry('u'); r.update(kind='Configuration-like GitHub entry', name='STAGING_ENDPOINT_URL')
        enrich([r]); self.assertEqual(r['classification'], 'review')

    def test_same_name_different_services_are_not_assumed_equal(self):
        result = enrich([entry('api', consumer='api'), entry('worker', consumer='worker')])
        self.assertEqual(len(result['credential_groups']), 2)

    def test_verified_copies_group_without_losing_records(self):
        result = enrich([entry('a'), entry('b')], {'groups': [{'record_ids': ['a', 'b'], 'evidence': 'Verified copies'}]})
        self.assertEqual(len(result['credentials']), 2)
        self.assertEqual(result['credential_groups'][0]['record_ids'], ['a', 'b'])
        self.assertEqual(result['counts']['managed_credential_groups'], 1)

    def test_later_vault_write_breaks_stale_equality(self):
        result = enrich([entry('a', last_value_saved_at='2026-10-28T00:00:00Z'), entry('b')],
                        {'groups': [{'record_ids': ['a', 'b']}]})
        self.assertEqual(len(result['credential_groups']), 2)

    def test_local_secret_shared_with_remote_is_flagged(self):
        local = entry('a')
        result = enrich([local, entry('b')], {'records': {'a': {'classification': 'local', 'reason': 'Local fixture'}},
                                             'groups': [{'record_ids': ['a', 'b']}]})
        self.assertEqual(local['classification'], 'review')
        self.assertTrue(result['credential_groups'][0]['tracking_required'])

    def test_exclusion_is_not_retirement(self):
        r = entry('a', tracking_class='local', tracking_reason='Confirmed local-only fixture')
        enrich([r]); self.assertFalse(r['tracking_required'])
        self.assertEqual(r['rotation_status'], 'not started')

    def test_retired_entry_does_not_inflate_queue(self):
        r = entry('a'); r['rotation_status'] = 'retired'
        enrich([r]); self.assertFalse(r['tracking_required'])

    def test_unexplained_override_is_not_applied(self):
        r = entry('a', tracking_class='local')
        enrich([r]); self.assertEqual(r['classification'], 'external')


if __name__ == '__main__':
    unittest.main()
