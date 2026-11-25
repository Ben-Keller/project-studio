# Release status

Target: macOS 13+, Apple Silicon. MIT license. Public collaboration preview.
Recording Studio is a separate project and is not part of this distribution.

## Implemented

- Empty portable registry; explicit approval of project launch commands.
- Studio, Portfolio and optional Keys; shared Codex/Claude integration skill.
- Native Swift/WebKit window with bundled Python and pinned Sparkle framework.
- Private local sessions, separate packaged port, single-window instance lock,
  service PID verification, one crash-recovery retry and explicit failure reporting.
- Workspace-backed layout/portfolio preferences and browser-cache migration.
- Staged, checksum-verified migration and backup/restore into new destinations.
- Portable media overlays and bundled static-site helpers.
- Live catalog reload and authenticated CLI launch/stop/status.
- Signed update feed tooling, public EdDSA key, private key held in publisher Keychain.
  Update checks are user initiated; installation is not automatic.
- Third-party notices bundled with the app, publication allowlist and CI checks.

## Acceptance still requiring external validation

- Apple Developer ID signing and notarization, followed by a clean-Mac install.
- Real prior-version upgrade/rollback and native Dock/window/crash behavior on a clean
  user account. Compiled builds and service/browser tests do not prove these UI cases.
- Reconnect and verify the user's actual credential provider; no production secrets
  or provider accounts are provisioned by installation. Infisical and explicit local
  profiles are the supported workflows, not arbitrary interchangeable providers.

See [operations](OPERATIONS.md) for installation, migration, backup and publication.
The original development workspace and private history are never published.
