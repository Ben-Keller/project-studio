# Installation, migration and release operations

## Install and run

The Apple Silicon preview includes Python, the UI, the native window and Sparkle.
It does not include Recording Studio or install dependencies for registered projects.
Copy Project Studio.app to Applications. The CLI is:

```sh
"/Applications/Project Studio.app/Contents/MacOS/studio" doctor
```

macOS 13+ is the target. Preview apps are ad-hoc signed, not notarized. Do not turn
off Gatekeeper globally. Apple-signed distribution still requires the publisher's
Developer ID and notarization credentials.

## Move an existing source workspace

First run the updated source launcher once and open its main page. Existing browser
layout and portfolio settings are saved into `outputs/preferences.json`. Wait for
that file before migrating; browser-only settings cannot be recovered by the CLI.
Close Studio before copying. No launch commands execute during migration.

```sh
studio import-workspace /path/to/project_studio
studio import-workspace /path/to/project_studio --apply
```

The destination is `~/Library/Application Support/Project Studio`, or the explicit
`PROJECT_STUDIO_DATA_DIR`. It must not already exist. If you have already opened the
installed app, close it and use a new destination, then inspect the copy before
replacing an existing workspace. Source files are never removed. The importer stages
and verifies the copy before publishing the destination; failures discard only its
own temporary copy. Symlinks are rejected rather than silently copying external files.

Included: catalog, credential metadata, layout/portfolio preferences, icons, photos,
preview screenshots, documentation and videos. Registered project repositories stay
where they are: their absolute paths are not relocated. Known Project Studio static
helpers become portable `@studio:spa` / `@studio:static` references.

Excluded: browser profiles, Keychain secret values, authentication sessions, running
process state, and obsolete Recording Studio data. Reconnect providers and review
project paths on a different Mac. Never publish a workspace backup: its metadata and
media are private even though secret values are excluded.

## Operate and back up

```sh
studio projects list
studio projects validate project.json
studio projects add project.json --trust-commands
studio launch project-slug
studio status project-slug
studio stop project-slug
studio backup /path/to/new-backup-folder
PROJECT_STUDIO_DATA_DIR=/path/to/new-workspace studio restore /path/to/backup
PROJECT_STUDIO_DATA_DIR=/path/to/new-workspace studio restore /path/to/backup --apply
```

Launch/stop/status require the running Studio service and use the same local owner
session boundary as the UI. Reload the page after catalog changes; no server restart
is needed. Backup/restore requires Studio closed for a consistent snapshot. Restore
verifies backup checksums and refuses existing destinations. Keep old copies for
rollback. An app downgrade does not roll back user data automatically.

## Keys and agent integration

Keys is optional. Ordinary project launching, Studio and Portfolio require no vault.
Local development profiles can explicitly run without keys. Infisical-backed profiles
require the user's own provider account and references; setup does not provision a
vault, migrate consent or expose secret values. Other provider integrations are not
claimed. Codex and Claude use the same supported CLI and portable skill:

```sh
studio integrations install --agent codex
studio integrations install --agent claude
```

Existing skill folders are never overwritten. Review and back them up before replacing.

## Publish an update

1. Update version/build numbers in `release/build_macos.py`, release notes and checks.
2. Run the Python tests and JavaScript syntax checks, then build with
   `release/.venv/bin/python release/build_macos.py --dmg`.
3. Run `release/.venv/bin/python release/prepare_update.py`. Sparkle signs the archive
   with the `project-studio-updates` account in the publisher's macOS Keychain.
4. Verify the signature/checksum, upload the exact DMG to the corresponding GitHub
   release, then publish `site/appcast.xml`. Never edit an archive after signing it.
5. Test from the preceding installed version before promoting a preview to stable.

Only the public EdDSA key is committed. Preserve the private key in a secure publisher
backup through Keychain procedures; do not put it in Git or chat. Losing it prevents
existing installations from trusting replacement update signatures. Developer ID
signing is separate. Sparkle is pinned by version and SHA256; builds reject a changed
archive. Downloaded update installation requires explicit confirmation; background
installation is disabled. Finish pending workspace edits before updating. Launched
project servers remain independent of Studio's own UI process.

The first preview had a manual Releases menu, so its users must download this build
once to acquire Sparkle. The framework code and signed feed are present, but a real
previous-to-next release upgrade and rollback on a clean Mac remain release acceptance
checks, not claims proven by a successful compile.

## Build toolchain

The preview is built with Python 3.13.14 (OpenSSL 3.5.7 in the local build), pinned
Python build dependencies and checksum-pinned Sparkle 2.10.1. CI uses the same Python
patch version. `Contents/Resources/Licenses` contains runtime notices and the build
dependency inventory. No Node.js or browser runtime is required by Project Studio;
Playwright is only a developer test dependency.
