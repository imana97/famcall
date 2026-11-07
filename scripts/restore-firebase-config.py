"""Restore native Firebase files only inside the protected release job."""

import json
import os
from pathlib import Path
import plistlib
from xml.parsers.expat import ExpatError


raw = os.environ.get("FAMCALL_FIREBASE_CONFIG_JSON")
if not raw:
    raise SystemExit("The protected Firebase app configuration is missing.")

try:
    value = json.loads(raw)
    ios_text = value["ios"]
    ios = plistlib.loads(ios_text.encode("utf-8"))
    android = value["android"]
    package_names = {
        client["client_info"]["android_client_info"]["package_name"]
        for client in android["client"]
    }
    if (
        ios["PROJECT_ID"] != "famcall"
        or ios["BUNDLE_ID"] != "com.silvergridtech.famcall"
        or str(ios["GCM_SENDER_ID"]) != "635297130023"
        or android["project_info"]["project_id"] != "famcall"
        or str(android["project_info"]["project_number"]) != "635297130023"
        or package_names != {"com.silvergridtech.famcall"}
    ):
        raise ValueError("Unexpected Firebase project or app")
except (KeyError, TypeError, ValueError, AttributeError, ExpatError, plistlib.InvalidFileException):
    # Do not include the supplied configuration in errors or job logs.
    raise SystemExit("Firebase configuration must match the production FamCall apps.") from None

root = Path(__file__).resolve().parents[1] / ".local"
root.mkdir(mode=0o700, parents=True, exist_ok=True)
for name, content in (
    ("GoogleService-Info.plist", ios_text),
    ("google-services.json", json.dumps(android)),
):
    destination = root / name
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(content)
    destination.chmod(0o600)

print("Native Firebase app configuration restored for build preparation.")
