---
name: project-studio
description: Register, validate and troubleshoot local projects in Project Studio using its supported catalog and CLI. Use for Project Studio app integration, launch definitions and development credential references in Codex or Claude.
---

# Project Studio integration

Use the installed `studio` command. If absent, check
`/Applications/Project Studio.app/Contents/MacOS/studio`; in a source checkout use
`python3 studio_cli.py`. Never assume a particular user's home or project directory.

1. Run `studio doctor` and `studio projects list`. Do not display credentials.
2. Inspect the requested project's package scripts, working directories, readiness
   endpoint and required ports. Do not start unknown commands during discovery.
3. Prepare a JSON project manifest with `slug`, `name`, `url`, optional `health_url`
   and `note`, plus `processes` containing `name`, `repo`, `command`, `ports`.
   Keep commands explicit. Do not embed tokens, passwords or secret values.
4. Run `studio projects validate /path/to/manifest.json`.
5. Show the launch commands to the user and obtain approval before registration.
   Run `studio projects add /path/to/manifest.json --trust-commands` only after approval.
6. Restart Project Studio to load the registered project, then ask the user to
   launch from its card. Check the target app identity, readiness and stop behavior.
7. Diagnose failures using the UI's logs and `studio doctor`. Never stop unrelated
   port owners or edit Project Studio source to add a project.

Credential providers are optional. `studio dev` requires a separately configured
project reference/provider or an explicit local profile. Never use a personal or
production credential as a fallback. Do not scan unrelated folders or publish
project screenshots without authorization.

This preview does not yet expose generic launch/stop commands through this CLI.
Do not invent commands or imply that all dependency setup is automatic.
