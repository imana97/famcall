# FamCall

A little signal. A familiar voice.

FamCall is an open-source Android and iPhone app for simple voice calls, designed with weak and unstable connections in mind. It is under active development; reliability claims will be backed by measured tests before release.

The app uses React Native with Expo development builds, native WebRTC and Opus, Firebase phone verification, and Cloudflare TURN. Calls are between FamCall users. The interface is an English-first contact list, with all strings centralized for future translations and all layouts left to right.

## Development status

As of 7 November 2026, FamCall is available to its configured owner tester through **TestFlight 0.1.0 (3)** and **Google Play internal testing 0.1.0 (4)**. Both were delivered by [protected testing workflow 42336889833](https://github.com/silvergrid/famcall/actions/runs/42336889833) from commit `fecda4296f7c1e64576b172d8d170e0883ad958b`. These builds contain the iOS phone-verification update and Android permission cleanup; later changes on `main` are not part of this delivery. See the [testing-delivery record](store/release/testing-delivery-2026-11-07.json) for the exact build identities and verification limits.

The production backend and [FamCall website](https://famcall.web.app) are online. The website, privacy, terms, and account-deletion pages were checked against their deployed source; see the [website-delivery record](store/release/website-delivery-2026-11-07.json) and [infrastructure status](store/release/infrastructure-status.txt).

Android and iOS simulator builds compile. Maestro covers signup, persistent sign-in, contacts, and navigation on both platforms, plus call controls and blocking on two Android emulators. Automated checks cover call logic, database rules, backend behavior, connection and mute policies, call start and outbox handling, native events, release guards, and audio-evidence validation. See the [verification report](store/release/verification-report.txt) and commit checks for results and limitations.

Generated-speech relay experiments and transport recovery checks do not yet establish a supported poor-network envelope. The iOS simulator ends incoming native calls immediately with a system error. Valid two-way speech and interruption recovery, physical-device calling and audio routes, background push delivery, and production authentication/App Check remain public-launch gates. Internal store delivery does not clear those gates; the [public-release candidate](store/release/candidate.json) remains not ready.

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

Android upload signing and iOS distribution signing are configured, and both internal testing channels are active. Public-store listings, publisher declarations, final-candidate privacy review, and release evidence still require completion; see the [submission checklist](store/release/submission-checklist.txt). [testing-release.yml](.github/workflows/testing-release.yml) builds and submits to the testing channels. [public-release.yml](.github/workflows/public-release.yml) promotes an explicit tested build only after the checked-in candidate record contains passing evidence and the owner approves the workflow. The owner-only branch and environment protections remain in place.

The protected `release` environment also needs `FAMCALL_FIREBASE_CONFIG_JSON`, with an `ios` field containing the native Firebase plist text and an `android` field containing the parsed native Firebase JSON. The testing workflow restores these ignored files before Expo resolves native configuration and removes them during cleanup. Keep the matching `GOOGLE_SERVICE_INFO_PLIST` and `GOOGLE_SERVICES_JSON` secret file variables in Expo's production environment for the remote build; those remote-only files are unavailable during GitHub's initial configuration checks.

## Contributing

Contributions are welcome through pull requests. The project owner, silvergrid, is the sole approving maintainer. Releases are published through protected GitHub workflows after owner approval. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Copyright 2026 SilverGrid Technology LLC.
