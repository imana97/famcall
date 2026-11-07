#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
node scripts/prepare-e2e-config.mjs
export APP_VARIANT=e2e
export EXPO_PUBLIC_EMULATOR_HOST=127.0.0.1
cd apps/mobile
npx expo prebuild --platform ios --no-install
cd ios
pod install
# Simulator-only ad-hoc signing supplies the keychain access group required by
# Firebase Auth. FAMCALLLAB is a test identifier, never a production Apple team.
xcodebuild -workspace FamCallTest.xcworkspace -scheme FamCallTest \
  -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' ARCHS=arm64 \
  -derivedDataPath "$task_root/.local/ios-build" -jobs 3 \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=FAMCALLLAB build
