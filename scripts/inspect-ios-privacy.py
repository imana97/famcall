#!/usr/bin/env python3
"""Inventory privacy declarations in an IPA without extracting private app files.

This reports declarations, not observed traffic or a completed store disclosure.
Run for each store candidate; a simulator bundle is not a substitute.
"""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import zipfile


def inspect(archive):
    with zipfile.ZipFile(archive) as package:
        infos = [name for name in package.namelist()
                 if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        if len(infos) != 1:
            raise ValueError("Expected exactly one top-level iOS app in the IPA")
        app_root = infos[0].removesuffix("Info.plist")
        info = plistlib.loads(package.read(infos[0]))
        manifests = []
        apis = {}
        collected = []
        for name in sorted(package.namelist()):
            if not name.startswith(app_root) or not name.endswith("/PrivacyInfo.xcprivacy"):
                continue
            manifest = plistlib.loads(package.read(name))
            relative = name.removeprefix(app_root)
            manifests.append({"path": relative, "declaration": manifest})
            for item in manifest.get("NSPrivacyAccessedAPITypes", []):
                category = item["NSPrivacyAccessedAPIType"]
                apis.setdefault(category, set()).update(item["NSPrivacyAccessedAPITypeReasons"])
            for item in manifest.get("NSPrivacyCollectedDataTypes", []):
                collected.append({"manifest": relative, **item})
        if not manifests:
            raise ValueError("No privacy manifests found; inspect the candidate before proceeding")
        framework_infos = []
        for name in sorted(package.namelist()):
            if re.fullmatch(re.escape(app_root) + r"Frameworks/[^/]+\.framework/Info\.plist", name):
                framework = plistlib.loads(package.read(name))
                framework_infos.append({
                    "path": name.removeprefix(app_root),
                    "identifier": framework.get("CFBundleIdentifier"),
                    "version": framework.get("CFBundleShortVersionString"),
                })
        return {
            "schemaVersion": 1,
            "scope": "Static declarations from this IPA only; not a runtime collection audit, SDK completeness certification, or store approval.",
            "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "app": {key: info.get(key) for key in [
                "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion",
            ]},
            "configuration": {key: info.get(key) for key in [
                "FirebaseDataCollectionDefaultEnabled", "FirebaseAppDelegateProxyEnabled",
                "NSUserTrackingUsageDescription",
            ]},
            "configurationNote": "null means the key was absent; it does not mean collection or delegation is disabled.",
            "manifestCount": len(manifests),
            "declaredTrackingManifests": [m["path"] for m in manifests if m["declaration"].get("NSPrivacyTracking") is True],
            "declaredTrackingDomains": sorted({domain for m in manifests for domain in m["declaration"].get("NSPrivacyTrackingDomains", [])}),
            "declaredCollectedData": collected,
            "requiredReasonAPIUnion": {key: sorted(value) for key, value in sorted(apis.items())},
            "embeddedFrameworks": framework_infos,
            "manifests": manifests,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.ipa.resolve() == args.output.resolve():
        parser.error("Output must not replace the IPA")
    result = inspect(args.ipa)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Inspected {result['manifestCount']} manifests; report: {args.output}")


if __name__ == "__main__":
    main()
