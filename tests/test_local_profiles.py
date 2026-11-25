import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import studio_cli as cli

class LocalProfilesTests(unittest.TestCase):
    def test_explicit_local_profile_never_reads_vault(self):
        manifest = {"project": "test", "profiles": {"dev": [["local-app"]]}, "local_profiles": ["dev"]}
        with patch.object(cli, "find_manifest", return_value=(Path("/tmp"), manifest)), patch.object(cli, "project_binding", side_effect=AssertionError("vault accessed")), patch.object(cli, "run_commands", return_value=0) as run:
            self.assertEqual(cli.run_profile("dev"), 0)
            run.assert_called_once_with([["local-app"]], Path("/tmp"), {})

    def test_ordinary_profile_still_fails_closed_when_access_expires(self):
        manifest = {"profiles": {"live-test": [["live"]]}, "local_profiles": ["dev"]}
        with patch.object(cli, "find_manifest", return_value=(Path("/tmp"), manifest)), patch.object(cli, "project_binding", side_effect=cli.vault.CredentialError("expired")), patch.object(cli, "run_commands") as run:
            with self.assertRaises(cli.vault.CredentialError): cli.run_profile("live-test")
            run.assert_not_called()

    def test_malformed_opt_in_is_rejected(self):
        manifest = {"profiles": {"dev": [["local"]]}, "local_profiles": "dev"}
        with patch.object(cli, "find_manifest", return_value=(Path("/tmp"), manifest)):
            with self.assertRaises(cli.vault.CredentialError): cli.run_profile("dev")

    def test_local_child_has_no_inherited_service_keys(self):
        with patch.dict(cli.os.environ, {"OPENAI_API_KEY": "synthetic-value"}):
            self.assertNotIn("OPENAI_API_KEY", cli.child_environment({}))
