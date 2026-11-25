# Keys for this project (Codex and Claude)

This project's keys live in Infisical and are managed through Project Studio. Use these commands from the project folder:

```sh
studio secrets status              # required development keys: present or missing
studio secrets add NAME            # opens Studio's private entry form for the project owner
studio dev                         # run the dev profile with keys injected
studio run NAME                    # run another named profile from .studio-secrets.json
studio check --profile integration # run a configured test profile
```

Add `--consumer api` (or another service folder) to `status` and `add` when the project has service folders.

When a key is missing, run `studio secrets add NAME` and ask the project owner to enter the value in the form that opens. Values go in through that form or the Infisical web UI, so they stay out of the conversation, command arguments and files in the repository.

The helper reads only the development environment, through a read-only identity, and passes the app exactly the names listed in `.studio-secrets.json`. Output from `studio dev` has exact key values masked. Staging and production keys reach their deployments through Railway, Azure or GitHub and are changed deliberately, following the rotation sequence:

1. issue a replacement at the provider,
2. store it in the matching vault environment and folder,
3. update every consumer listed in Studio's register,
4. redeploy and test the real integration,
5. revoke the old key at the provider,
6. record the date in the register.

If development access has expired, the helper says so; the owner renews it with `studio access renew`.

Project Studio installation and operations: https://github.com/Ben-Keller/project-studio/blob/main/docs/release/OPERATIONS.md.