<div align="center">

# Project Studio
### Your projects. One local workspace.

**Launch tools · Shape a portfolio · Connect development keys**

[Explore](https://ben-keller.github.io/project-studio/) · [Releases](https://github.com/Ben-Keller/project-studio/releases) · [Release status](docs/release/STATUS.md) · [Agent skill](integrations/skills/project-studio/SKILL.md)

**macOS 13+ · Apple Silicon · MIT · Local-first**

</div>

---

Project Studio brings local applications, prototypes and hosted tools into a native
macOS workspace. Keep your projects where they already live. Launch them deliberately,
see what is running, and turn working software into a portfolio.

| Studio | Portfolio | Keys |
|:---|:---|:---|
| Organize projects, launch apps, inspect resources and stop servers. | Present selected work through ten layouts and project-level customization. | Track credential references and connect supported Infisical development workflows. |

## Preview status

This repository is the **public collaboration preview**, not a completed production
release. The native Apple Silicon preview bundles Python and the main UI. It is
ad-hoc signed, **not Apple notarized**; macOS may block downloaded builds. Do not disable
Gatekeeper globally. Signed installation and verified automatic updates remain release
gates. The current update menu opens the Releases page for manual downloads.

Recording Studio source is included. Its Node/Chrome/FFmpeg runtime is not yet bundled
into the desktop preview. See [the release checklist](docs/release/STATUS.md) for
remaining integration and migration work; no dependency-free recorder claim is made.

## Run from source

```sh
git clone https://github.com/Ben-Keller/project-studio.git
cd project-studio
python3 local_tools_launcher.py --open
```

Use Python 3.11 or newer. A fresh checkout starts with an empty catalog: it contains
no personal projects, credentials, recordings, browser profiles or private inventories.
Use **Add project** to register a URL and optional local launch command. Dependencies
for your own projects are managed by those projects.

## Codex and Claude

One portable skill supports both agents. From the repository:

```sh
python3 studio_cli.py integrations install --agent codex
python3 studio_cli.py integrations install --agent claude
```

In the packaged app, use `/Applications/Project Studio.app/Contents/MacOS/studio`
instead of `python3 studio_cli.py`. Existing skills are never overwritten silently.

```sh
python3 studio_cli.py doctor
python3 studio_cli.py projects validate examples/project.json
```

Edit the example with your folder and command, review it, then register with
`projects add examples/project.json --trust-commands`. Registration does not execute
commands. Restart Studio after CLI registration.

## Build the macOS preview

Build on Apple Silicon with Xcode Command Line Tools and Python 3.13:

```sh
python3 -m venv release/.venv
release/.venv/bin/pip install -r release/requirements.txt
release/.venv/bin/python release/build_macos.py --dmg
```

Build output: `release/build/Project Studio.app` and an ARM64 preview DMG.
No Intel release is provided. The existing source-linked developer installer remains
available; it is not the distributable build.

## Data and privacy

Installed app state lives in `~/Library/Application Support/Project Studio/`.
Source runs use ignored `outputs/` unless `PROJECT_STUDIO_DATA_DIR` is set.
Credential values belong in Keychain or your vault, not project manifests or Git.
Nothing automatically imports or publishes your local project library.

Migration is opt-in: `import-workspace PATH` previews copies and `--apply` copies into
an empty destination. Source data is preserved. Browser preferences and provider access
still require separate review; see [release status](docs/release/STATUS.md).

## Contributing

Keep the local-first architecture: Python service, native WebKit shell, vanilla Studio/
Portfolio/Keys UI, isolated React recording runtime. Prefer small, tested changes over
framework rewrites. Include reproducible steps and sanitized logs in bug reports.

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --check assets/studio.js
node --check assets/portfolio.js
cd recording-studio && npm ci && npm run typecheck && npm test && npm run build
```

Never attach keys, private inventory files or browser profiles to an issue.

## License

Original Project Studio code is licensed under [MIT](LICENSE). Dependencies retain their
own licenses. Personal project photos, logos and inventories are not distributed here.
