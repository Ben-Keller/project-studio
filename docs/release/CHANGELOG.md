# Preview 0.2.2

- Personal category presets replaced with tabs generated from your project library.
- Add a category during registration or use Edit categories to reorganize projects.
- Category assignments persist locally and are included in workspace backups.
- Existing legacy project groups remain intact until explicitly reassigned.
- Added first-user category setup instructions and packaged browser coverage.

# Preview 0.2.1

- Consolidated internal services in `app/`, utilities in `scripts/`, and tests in `tests/`.
- Kept existing source launch commands and desktop entry points stable.
- Included the shared Keys instructions in the app bundle and public source export.
- Added interface screenshots and a repository map to the canonical README.
- Verified the clean public source, packaged browser flows, and native startup/recovery.

This remains an Apple Silicon preview: ad-hoc signed, not Apple notarized.

# Preview 0.2.0

- Recording Studio is independent and no longer shipped with Project Studio.
- Workspace preferences and personal media can migrate with a verified backup.
- Added CLI launch, stop, status, backup and restore commands.
- Catalog changes reload without restarting the service.
- Bundled helpers and credential-runner entry points work without source Python files.
- Native single-instance protection and bounded service recovery.
- Sparkle update framework with EdDSA-signed archives and a Keychain-held private key.
- Python 3.13.14 build runtime, pinned build dependencies and redistribution notices.
- Expanded packaged browser and native smoke checks.

This remains an ad-hoc-signed collaboration preview, not a notarized production release.
The previous preview requires one manual download to acquire the new updater.
