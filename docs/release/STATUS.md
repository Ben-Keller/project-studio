# Release status

Target: macOS 13+, Apple Silicon only. License: MIT. Public collaboration preview.

## Implemented

- Personal catalog extracted from executable source into ignored local JSON.
- Empty portable catalog and explicit trust for imported launch commands.
- Studio Add Project dialog and CLI registration/validation.
- Installed application data separated from source/immutable bundle resources.
- Non-destructive copy migration into an empty workspace.
- Shared Codex/Claude skill, explicit installer, no overwrite of existing skills.
- Native standalone Swift/WebKit target and bundled Python build.
- Stable packaged web origin separate from source runs, private local sessions.
- Public source allowlist: no personal inventory, photo library, Git history or outputs.
- Manual Releases menu, static product site and CI preview workflow.

## Required before a production release

- Configure Developer ID signing and Apple notarization; validate on a clean Mac.
- Integrate signed Sparkle updates, release feed and active-work deferral. Current
  Check for Updates opens GitHub Releases; it is not an automatic updater.
- Bundle and license-audit recorder Node/browser/FFmpeg dependencies, and wire the
  packaged service to those binaries. Recorder source is included, not fully packaged.
- Migrate user media and browser-local layout/portfolio preferences explicitly.
  Current importer handles catalog, recording/export files and credential metadata,
  but does not migrate browser profiles, secret values or consent/provider sessions.
- Normalize all remaining source/packaged helper paths and provider setup flows.
- Test multi-instance startup, occupied packaged port 18765, service crash recovery,
  updates/rollback, and the complete Keys setup flow on a clean user account.
- Complete provider-independent credential onboarding. Infisical is the current
  provider; installing the app does not provision a vault or access identity.
- Add portable live catalog reload and full CLI launch/stop/backup commands.
- Review complete third-party license notices and runtime redistribution.

The existing source-linked installation is deliberately left intact. Do not publish
personal history or delete its local data to prepare a release. The public source
export has its own fresh Git history.
