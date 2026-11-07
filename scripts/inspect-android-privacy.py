#!/usr/bin/env python3
"""Read a store AAB's manifest and selected SDK metadata using official bundletool.

No APK is generated, signed, installed or launched. No Firebase values are dumped.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("aab", type=Path)
    parser.add_argument("--bundletool", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in [args.aab.resolve(), args.bundletool.resolve()]:
        parser.error("Output must not replace an input")
    xml = subprocess.check_output([
        "java", "-jar", str(args.bundletool), "dump", "manifest",
        "--bundle=" + str(args.aab), "--module=base",
    ])
    root = ET.fromstring(xml)
    android = "{http://schemas.android.com/apk/res/android}"
    app = root.find("application")
    sdk = root.find("uses-sdk")
    properties = {}
    with zipfile.ZipFile(args.aab) as archive:
        for name in sorted(archive.namelist()):
            if name.startswith("base/root/") and name.endswith(".properties") and any(
                key in name for key in ("firebase", "play-services", "integrity", "recaptcha")
            ):
                values = {}
                for line in archive.read(name).decode().splitlines():
                    if "=" in line and not line.startswith("#"):
                        key, value = line.split("=", 1)
                        if key in ["client", "version"]:
                            values[key] = value
                properties[name.removeprefix("base/root/")] = values
    report = {
        "schemaVersion": 1,
        "scope": "Static base-module manifest and selected SDK metadata from this AAB; not a complete dependency inventory, runtime collection audit, or Play-signature verification.",
        "archiveSha256": hashlib.sha256(args.aab.read_bytes()).hexdigest(),
        "bundletoolSha256": hashlib.sha256(args.bundletool.read_bytes()).hexdigest(),
        "app": {"package": root.get("package"), **{key: root.get(android + key) for key in ["versionName", "versionCode"]}},
        "sdk": {key: sdk.get(android + key) for key in ["minSdkVersion", "targetSdkVersion"]},
        "applicationFlags": {key: app.get(android + key) for key in ["allowBackup", "debuggable", "usesCleartextTraffic"]},
        "flagNote": "null means absent; apply Android defaults when interpreting the value.",
        "permissions": sorted({item.get(android + "name") for item in root.findall("uses-permission")}),
        "firebaseComponents": sorted({item.get(android + "name").removeprefix("com.google.firebase.components:") for item in root.findall(".//meta-data") if item.get(android + "name", "").startswith("com.google.firebase.components:")}),
        "sdkProperties": properties,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Inspected Android build {report['app']['versionCode']}; report: {args.output}")


if __name__ == "__main__":
    main()
