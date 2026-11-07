#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_root="$(cd "$probe_dir/../.." && pwd)"
build_dir="$task_root/.local/callkit-probe/build"
app_dir="$build_dir/CallKitProbe.app"
mkdir -p "$app_dir"
cp "$probe_dir/Info.plist" "$app_dir/Info.plist"
# Match Xcode's simulator packaging: simulated entitlements are Mach-O sections,
# not restricted entitlements in an ad-hoc macOS code signature.
/usr/bin/derq query -f xml -i "$probe_dir/Simulated.entitlements" \
  -o "$build_dir/Simulated.entitlements.der" --raw
xcrun --sdk iphonesimulator swiftc -swift-version 5 -parse-as-library \
  -target arm64-apple-ios16.4-simulator \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  "$probe_dir/Probe.swift" -o "$app_dir/CallKitProbe" \
  -framework UIKit -framework CallKit \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements \
  -Xlinker "$probe_dir/Simulated.entitlements" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __ents_der \
  -Xlinker "$build_dir/Simulated.entitlements.der"
codesign --force --sign - "$app_dir"
printf '%s\n' "$app_dir"
