"""Offline safety tests for the two service-scoped event invocation grants."""

import copy
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "infra" / "ensure-event-invocation.py"
SPEC = importlib.util.spec_from_file_location("event_invocation", SCRIPT)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)
MEMBER = "serviceAccount:" + repair.TRIGGER_ACCOUNT


class FakeCloud:
    def __init__(self, granted=False):
        self.calls = []
        self.configs = {}
        self.policies = {}
        self.persist_grant = True
        for function, service in repair.SERVICES.items():
            prefix = f"projects/{repair.PROJECT}/locations/{repair.REGION}"
            self.configs[function] = {
                "name": f"{prefix}/functions/{function}", "environment": "GEN_2",
                "eventTrigger": {"serviceAccountEmail": repair.TRIGGER_ACCOUNT},
                "serviceConfig": {"service": f"{prefix}/services/{service}"},
            }
            self.policies[service] = {"etag": "unchanged", "bindings": [
                {"role": "roles/run.viewer", "members": ["group:reviewers@example.com"]},
            ]}
            if granted:
                self.policies[service]["bindings"].append({"role": repair.ROLE, "members": [MEMBER]})

    def __call__(self, *args):
        self.calls.append(args)
        if args[:2] == ("functions", "describe"):
            return copy.deepcopy(self.configs[args[2]])
        if args[:3] == ("run", "services", "get-iam-policy"):
            return copy.deepcopy(self.policies[args[3]])
        if args[:3] == ("run", "services", "add-iam-policy-binding"):
            if self.persist_grant:
                self.policies[args[3]]["bindings"].append({"role": repair.ROLE, "members": [MEMBER]})
            return copy.deepcopy(self.policies[args[3]])
        raise AssertionError(f"Unexpected request: {args}")

    def mutations(self):
        return [args for args in self.calls if "add-iam-policy-binding" in args]


class EventInvocationTests(unittest.TestCase):
    def run_check(self, cloud, **kwargs):
        return repair.ensure_invocation(cloud, emit=lambda _: None, **kwargs)

    def test_default_check_detects_missing_access_without_mutation(self):
        cloud = FakeCloud()
        self.assertFalse(self.run_check(cloud))
        self.assertEqual(cloud.mutations(), [])

    def test_apply_adds_only_correct_scoped_bindings_and_verifies(self):
        cloud = FakeCloud()
        original = copy.deepcopy(cloud.policies)
        self.assertTrue(self.run_check(cloud, apply=True))
        self.assertEqual(cloud.mutations(), [
            ("run", "services", "add-iam-policy-binding", service,
             f"--member={MEMBER}", f"--role={repair.ROLE}", "--condition=None", "--format=json")
            for service in repair.SERVICES.values()
        ])
        for service, policy in cloud.policies.items():
            self.assertEqual(policy["bindings"][:-1], original[service]["bindings"])
            self.assertEqual(policy["etag"], original[service]["etag"])
        self.assertEqual(sum("get-iam-policy" in call for call in cloud.calls), 4)

    def test_existing_correct_bindings_are_noop(self):
        cloud = FakeCloud(granted=True)
        self.assertTrue(self.run_check(cloud))
        self.assertTrue(self.run_check(cloud, apply=True))
        self.assertEqual(cloud.mutations(), [])

    def test_wrong_target_or_identity_fails_before_any_mutation(self):
        for field, value in [
            ("service", "projects/other/locations/us-east1/services/processaccountdeletion"),
            ("service", "projects/famcall/locations/us-west1/services/processaccountdeletion"),
            ("service", "projects/famcall/locations/us-east1/services/unreviewed"),
            ("identity", None),
            ("identity", "other@famcall.iam.gserviceaccount.com"),
            ("identity", "famcall-runtime@other.iam.gserviceaccount.com"),
        ]:
            with self.subTest(field=field, value=value):
                cloud = FakeCloud()
                config = cloud.configs["processAccountDeletion"]
                if field == "service":
                    config["serviceConfig"]["service"] = value
                else:
                    config["eventTrigger"]["serviceAccountEmail"] = value
                with self.assertRaises(repair.ConfigurationError):
                    self.run_check(cloud, apply=True)
                self.assertEqual(cloud.mutations(), [])

    def test_wrong_project_and_region_fail_without_requests(self):
        for options in [{"project": "other"}, {"region": "us-west1"}]:
            cloud = FakeCloud()
            with self.assertRaises(repair.ConfigurationError):
                self.run_check(cloud, apply=True, **options)
            self.assertEqual(cloud.calls, [])

    def test_conditional_and_other_identity_grants_do_not_count(self):
        policy = {"bindings": [
            {"role": repair.ROLE, "members": [MEMBER], "condition": {"expression": "false"}},
            {"role": repair.ROLE, "members": ["serviceAccount:other@famcall.iam.gserviceaccount.com"]},
        ]}
        self.assertFalse(repair.has_invoker(policy, MEMBER))

    def test_failed_write_verification_fails_closed(self):
        cloud = FakeCloud()
        cloud.persist_grant = False
        with self.assertRaisesRegex(repair.ConfigurationError, "verification failed"):
            self.run_check(cloud, apply=True)

    def test_gcloud_uses_explicit_project_region_and_suppresses_errors(self):
        result = subprocess.CompletedProcess([], 1, stdout="private config", stderr="private error")
        with patch.object(repair.subprocess, "run", return_value=result) as run:
            with self.assertRaisesRegex(repair.ConfigurationError, r"gcloud request failed \(exit 1\)"):
                repair.Gcloud("famcall", "us-east1")("functions", "describe", "dispatchCall", "--gen2")
            command = run.call_args.args[0]
            self.assertEqual(command[-3:], ["--project=famcall", "--region=us-east1", "--quiet"])
            self.assertFalse(run.call_args.kwargs.get("shell", False))


if __name__ == "__main__":
    unittest.main()
