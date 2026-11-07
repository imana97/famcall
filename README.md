# FamCall

A little signal. A familiar voice.

FamCall is an open-source Android and iPhone app for simple voice calls, designed with weak and unstable connections in mind. It is under active development; reliability claims will be backed by measured tests before release.

The app uses React Native with Expo development builds, native WebRTC and Opus, Firebase phone verification, and Cloudflare TURN. Calls are between FamCall users. The interface is an English-first contact list, with all strings centralized for future translations and all layouts left to right.

## Development status

This is a working prototype, not a published service. Android and iOS simulator builds compile. Maestro covers signup, persistent sign-in, contacts, and navigation on both platforms, plus call controls and blocking on two Android emulators. The automated suite includes 55 logic, database-rule, backend, connection/mute-policy, call-start/outbox, native-event, and release-guard tests, along with ten audio-evidence validation tests. See the verification record and commit checks for results and limitations.

Android calls exchange generated speech through the Cloudflare relay. The audio harness now restarts the emulators between profiles and prevents repeated injection into the same emulator process, which previously caused silence or crashes. Pilot measurements and transport recovery checks are recorded in `store/release/verification-report.txt`; they do not establish a supported network envelope. The iOS simulator ends incoming native calls immediately with a system error. Physical-device calling, push delivery, production authentication, and the full poor-network matrix remain release gates.

The production backend and website require an owner-approved deployment. Production mobile releases go through Google Play internal testing and TestFlight first. Nothing in this repository bypasses that approval.

## Repository

- `apps/mobile`: Expo Router app and native integration config plugins.
- `packages/core`: shared phone, call-state, and Opus logic.
- `backend`: Firebase callable functions, push delivery, and cleanup workers.
- `tests`: unit, Firestore rules, and emulator integration tests.
- `e2e`: Maestro journeys and generated-speech measurements.
- `scripts`: isolated emulator and network-test tools.
- `website`, `brand`, `store`: landing page, original artwork, and store submission drafts.

## Run locally

Use Node from `.nvmrc`, Java 21 for the Firebase emulators, and the Android SDK or Xcode for native builds. Install the Firebase CLI, Maestro, and CocoaPods as needed.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:backend
node scripts/prepare-e2e-config.mjs
firebase emulators:start --project demo-famcall --only auth,firestore,functions
```

Run the integration suite against the already-running local emulators:

```sh
FAMCALL_FUNCTIONS_TEST=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm test
```

Build a separate test app using `APP_VARIANT=e2e`. From `apps/mobile`, use `APP_VARIANT=e2e npx expo run:android --variant release` for a standalone Android test build. It has the `.e2e` package suffix and accepts only the `demo-famcall` Firebase project. On the iOS simulator, also set `EXPO_PUBLIC_EMULATOR_HOST=127.0.0.1`. Generated `ios/` and `android/` folders are ignored; change config plugins rather than editing generated code.

Routine tests use fictional numbers and the Firebase Auth emulator. They send no SMS. Live-media tests additionally require your own Cloudflare TURN credentials in the backend emulator's environment. The maintainer's `scripts/start-emulators.mjs --live-turn` reads the dedicated secrets from Google Secret Manager into process memory. No provider credentials belong in source control.

## Reliability testing

See `store/release/e2e-test-plan.txt` for the full release matrix. Maestro drives the actual native app. The audio lab injects generated PCM through the Android emulator's authenticated gRPC interface, captures the other emulator's output, and records WebRTC packet counters plus a laboratory STOI estimate. It never opens the host microphone.

`scripts/audio-lab.mjs` impairs only the test relay's UDP traffic. Delay and loss apply to each endpoint's relay leg; do not confuse a per-leg setting with end-to-end loss or round-trip latency. `e2e/audio/measure.py` checks the selected candidate path, received speech, and packet evidence from both peers. See `e2e/audio/README.txt` for reproducible setup and emulator limitations. TCP/TLS fallback, speech recovery, screen lock, credential renewal, and real-device listening are separate cases. A connected screen alone is not a passing audio test.

## Deployment and secrets

Production uses phone-based Firebase authentication and App Check, private per-user data, participant-only signaling, expiring relay credentials, bounded ringing, retryable hangup intents, and three-minute call leases. The configured GCP verification quota is 50 requests per project per day; the real-provider boundary test is a separate release check. Cloud billing alerts do not impose a spending cap.

The `backend` and `release` GitHub environments require `silvergrid` approval. Cloud deployment uses restricted workload identity federation, not a checked-in service-account key. `infra/configure-github-cloud.py` records the project-specific setup. Forks must configure their own cloud project and identities. Store workflows also need Expo and store credentials in protected environments. The current configuration and unresolved release gates are tracked in `store/release/submission-checklist.txt`.

Android upload signing and iOS distribution signing are configured. The App Store listing is an unpublished draft; Play setup still needs publisher declarations. `testing-release.yml` builds and submits to the testing channels. `public-release.yml` promotes an explicit tested build only after the checked-in candidate record contains passing evidence and the owner approves the workflow. See `store/release/infrastructure-status.txt` for remaining account setup.

## Contributing

Contributions are welcome through pull requests. The project owner, silvergrid, is the sole approving maintainer. Releases are published through protected GitHub workflows after owner approval. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Copyright 2026 SilverGrid Technology LLC.
