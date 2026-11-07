"""Check event-trigger invocation access; mutate only with an explicit --apply.

Only the two reviewed FamCall services and their configured trigger account are
eligible. Uses the existing gcloud session; never creates or prints credentials.
"""

import argparse
import json
import subprocess
import sys


PROJECT = "famcall"
REGION = "us-east1"
TRIGGER_ACCOUNT = "famcall-runtime@famcall.iam.gserviceaccount.com"
SERVICES = {"dispatchCall": "dispatchcall", "processAccountDeletion": "processaccountdeletion"}
ROLE = "roles/run.invoker"


class ConfigurationError(RuntimeError):
    """An unsafe target, unreadable configuration, or unsuccessful repair."""


class Gcloud:
    def __init__(self, project, region):
        self.flags = [f"--project={project}", f"--region={region}", "--quiet"]

    def __call__(self, *args):
        try:
            result = subprocess.run(
                ["gcloud", *args, *self.flags], capture_output=True, text=True,
                check=False, timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise ConfigurationError("Unable to complete the gcloud request.") from None
        if result.returncode:
            # gcloud errors can include configuration data. Do not echo stdout/stderr.
            raise ConfigurationError(f"gcloud request failed (exit {result.returncode}).")
        try:
            value = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise ConfigurationError("gcloud returned invalid JSON.") from None
        if not isinstance(value, dict):
            raise ConfigurationError("gcloud returned an unexpected response.")
        return value


def discover_target(cloud, function, service, project, region):
    config = cloud(
        "functions", "describe", function, "--gen2",
        "--format=json(name,environment,eventTrigger.serviceAccountEmail,serviceConfig.service)",
    )
    prefix = f"projects/{project}/locations/{region}"
    trigger = config.get("eventTrigger")
    runtime = config.get("serviceConfig")
    if (config.get("name") != f"{prefix}/functions/{function}"
            or config.get("environment") != "GEN_2"
            or not isinstance(runtime, dict)
            or runtime.get("service") != f"{prefix}/services/{service}"):
        raise ConfigurationError(f"{function}: unexpected function or Cloud Run target; no access granted.")
    if not isinstance(trigger, dict) or trigger.get("serviceAccountEmail") != TRIGGER_ACCOUNT:
        raise ConfigurationError(f"{function}: missing or unexpected trigger identity; no access granted.")
    return "serviceAccount:" + trigger["serviceAccountEmail"]


def has_invoker(policy, member):
    bindings = policy.get("bindings", [])
    if not isinstance(bindings, list):
        raise ConfigurationError("Invalid Cloud Run IAM bindings.")
    for binding in bindings:
        if (not isinstance(binding, dict) or not isinstance(binding.get("members"), list)
                or not all(isinstance(item, str) for item in binding["members"])):
            raise ConfigurationError("Invalid Cloud Run IAM binding.")
    return any(
        binding.get("role") == ROLE and member in binding["members"]
        and "condition" not in binding
        for binding in bindings
    )


def read_policy(cloud, service):
    return cloud("run", "services", "get-iam-policy", service, "--format=json")


def ensure_invocation(cloud, project=PROJECT, region=REGION, apply=False, emit=print):
    if project != PROJECT or region != REGION:
        raise ConfigurationError("Only the reviewed famcall/us-east1 targets are supported.")
    # Complete every safety check before granting access to any service.
    targets = []
    for function, service in SERVICES.items():
        member = discover_target(cloud, function, service, project, region)
        present = has_invoker(read_policy(cloud, service), member)
        targets.append((function, service, member, present))
    missing = [target for target in targets if not target[3]]
    if not apply:
        for function, _, _, present in targets:
            emit(f"{function}: {'invocation binding present' if present else 'invocation binding missing'}")
        return not missing
    for function, service, member, _ in missing:
        # This command adds one service-scoped binding without replacing the policy.
        cloud("run", "services", "add-iam-policy-binding", service,
              f"--member={member}", f"--role={ROLE}", "--condition=None", "--format=json")
        emit(f"{function}: added scoped invocation binding")
    for function, service, member, _ in targets:
        if not has_invoker(read_policy(cloud, service), member):
            raise ConfigurationError(f"{function}: invocation binding verification failed.")
        emit(f"{function}: invocation binding verified")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=PROJECT, choices=[PROJECT])
    parser.add_argument("--region", default=REGION, choices=[REGION])
    parser.add_argument("--apply", action="store_true", help="Add missing service-level invocation bindings.")
    args = parser.parse_args(argv)
    try:
        return 0 if ensure_invocation(Gcloud(args.project, args.region), args.project, args.region, args.apply) else 1
    except ConfigurationError as error:
        print(f"Invocation check failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
