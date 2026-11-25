"""Value-free scope classification and evidence-backed grouping for Studio."""
from collections import Counter
import hashlib
import re

CLASSES = {
    'external': 'Service credential',
    'application': 'Application access / signing',
    'local': 'Local only',
    'configuration': 'Identifier / configuration',
    'reference': 'Reference only',
    'review': 'Needs review',
}
TRACKED = {'external', 'application', 'review'}
IDENTIFIERS = {'R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID', 'AZURE_CLIENT_ID',
               'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'DESTINATION_PATH',
               'SOURCE_PATH', 'PREVIEW_DESTINATION_PATH', 'NEXT_PUBLIC_AUTH_COOKIE_DOMAIN',
               'STAGING_AZURE_HOST', 'STAGING_AZURE_PORT', 'STAGING_AZURE_PROJECT_PATH',
               'STAGING_AZURE_USERNAME', 'WP_CACHE_KEY_SALT'}
APP_NAMES = re.compile(r'JWT|SESSION_SECRET|APP_KEYS|TOKEN_SALT|SUPPRESSION_PEPPER|ACCESS_KEY_HASH|WEBHOOK_SECRET')


def classify(record, reviews):
    """Location alone never makes a provider key disposable."""
    choice = record.get('tracking_class', 'auto')
    if choice in CLASSES and record.get('tracking_reason', '').strip():
        return choice, record['tracking_reason'], 'Owner classification'
    evidence = reviews.get(record['id'])
    if evidence and evidence.get('classification') in CLASSES:
        return evidence['classification'], evidence['reason'], evidence.get('evidence', '')
    kind, name, store = (record.get(k, '') for k in ('kind', 'name', 'store'))
    if kind == 'Reference only':
        return 'reference', 'Only a variable name or documentation reference was found; no configured credential was confirmed.', 'Source inventory'
    if name in IDENTIFIERS:
        return 'configuration', 'An identifier or configuration field, not a standalone authentication secret. Keep its paired secret and access controls tracked.', 'Field role; stored GitHub values cannot be read back'
    if kind == 'Configuration-like GitHub entry':
        return 'review', 'Probably configuration, but the saved value is unreadable. Confirm it is not a signed URL or embedded credential before excluding it.', 'GitHub name only'
    if kind in {'Test account credential', 'API key metadata; consumer type unverified'}:
        return 'review', 'Consumer and scope need verification. A test account or browser-labelled key can still access hosted data or paid services.', kind
    if APP_NAMES.search(name) or 'Application' in record.get('provider', ''):
        return 'application', 'Protects application access, signatures or stored data. Generated values still need coordinated lifecycle management when used by a hosted app.', 'Configured value or managed store'
    if kind in {'Managed credential', 'GitHub stored credential', 'Cloudflare stored credential',
                'Deployed credential candidate', 'User-managed service-account key'}:
        return 'external', 'Configured credential or issuer key. Its presence is confirmed; current validity and all consumers may still need verification.', store
    if kind in {'Local value observed', 'Backup value observed'}:
        if record.get('provider', '').lower() in {'provider to verify', 'azure / provider to verify'}:
            return 'review', 'A value exists, but its issuer and access scope are not established.', 'Local inventory'
        return 'external', 'A provider credential was found in a local file or backup. Local storage does not limit what it can access; verify validity before retirement.', 'Local inventory'
    return 'review', 'Insufficient evidence to exclude this entry from credential review.', kind or store


def enrich_inventory(inventory, review):
    records = inventory['credentials']
    by_id = {r['id']: r for r in records}
    for r in records:
        category, reason, evidence = classify(r, review.get('records', {}))
        r.update(classification=category, classification_label=CLASSES[category],
                 classification_reason=reason, classification_evidence=evidence)
        r['tracking_required'] = category in TRACKED and r.get('rotation_status') != 'retired'
    parent = {rid: rid for rid in by_id}

    def find(rid):
        while parent[rid] != rid:
            parent[rid] = parent[parent[rid]]
            rid = parent[rid]
        return rid

    accepted = []
    for link in review.get('groups', []):
        members = [rid for rid in link.get('record_ids', []) if rid in by_id]
        # A later vault write invalidates old equality evidence. Never group by name alone.
        members = [rid for rid in members if by_id[rid].get('last_value_saved_at') == link.get('versions', {}).get(rid)
                   and not by_id[rid].get('last_rotated_at')
                   and by_id[rid].get('rotation_status') != 'retired']
        if len(members) < 2:
            continue
        for rid in members[1:]:
            parent[find(rid)] = find(members[0])
        accepted.append((members, link.get('evidence', ''), link.get('observed_at', '')))
    buckets = {}
    for rid in by_id:
        buckets.setdefault(find(rid), []).append(rid)
    groups = []
    for ids in buckets.values():
        members = [by_id[rid] for rid in sorted(ids)]
        if any(r['classification'] in {'external', 'application'} for r in members):
            for r in members:
                if r['classification'] == 'local':
                    r.update(classification='review', classification_label=CLASSES['review'], tracking_required=True,
                             classification_reason='Recorded matching value also occurs in a service credential. Local-only classification needs review.')
        gid = 'group-' + hashlib.sha256('|'.join(sorted(ids)).encode()).hexdigest()[:16]
        for r in members:
            r['credential_group_id'] = gid
        evidence = [{'reason': reason, 'observed_at': at} for linked, reason, at in accepted if any(rid in ids for rid in linked)]
        groups.append({'id': gid, 'record_ids': sorted(ids), 'tracking_required': any(r['tracking_required'] for r in members),
                       'classifications': sorted({r['classification'] for r in members}), 'evidence': evidence})
    inventory['credential_groups'] = groups
    inventory['classification_counts'] = dict(Counter(r['classification'] for r in records))
    inventory['classification_labels'] = CLASSES
    inventory['triage_checked_at'] = review.get('checked_at')
    inventory['counts']['managed_credential_groups'] = sum(g['tracking_required'] for g in groups)
    inventory['counts']['excluded_from_rotation_records'] = sum(not r['tracking_required'] for r in records)
    return inventory
