FAMCALL HOSTED-DEVICE SMOKE TEST

Use the separate com.silvergridtech.famcall.e2e package, built with APP_VARIANT=e2e
and EXPO_PUBLIC_EMULATOR_HOST=bs-local.com. Production builds reject emulator
configuration. Only fictional lab numbers and the demo-famcall backend are used.

signup-and-contacts.yaml reuses the existing phone entry, verification, contact
creation and persistent-sign-in flows. It retrieves a temporary code from the
Auth emulator, then verifies the saved contact after restarting the app. The
flow requires explicit PHONE, CONTACT_PHONE, CONTACT_NAME and AUTH_EMULATOR_HOST
parameters. It validates distinct fictional endpoint numbers before launching.
Do not add literal env defaults: those shadow the provider's per-run parameters.

Prepare the archive with:
  node scripts/package-cloud-smoke.mjs

The ZIP contains a single famcall/ parent directory, three cloud helpers/flows
and four referenced Maestro flows. It excludes apps, credentials, backend
records, audio captures and private local files. BrowserStack's execute path is:
  e2e/cloud/signup-and-contacts.yaml

Before running: confirm free minutes and concurrency, start the demo backend,
restrict Local to the necessary emulator ports and use local=true in the request.
Do not enable paid network logs/audio injection on an unqualified trial account.
Pass the four parameters via setEnvVariables; never put production secrets in
those variables, which BrowserStack displays. AUTH_EMULATOR_HOST is bs-local.com.
Use a freshly installed app for signup: Maestro reported that clearState is not
supported on the hosted real iPhone. Do not assume it clears persisted iOS auth.

QUALIFICATION — 6 NOVEMBER 2026
The first Pixel 6 / Android 12 run passed signup, contact saving and persistent
sign-in. Backend records independently confirm the fictional identity and saved
contact. Native Auth, callable functions, Firestore updates and the runner's OTP
lookup worked through Local on that Android setup.

The iPhone 15 / iOS 17.4 run verified its fictional number, then failed saving a
contact. Firebase Functions refused authenticated requests to the non-loopback
HTTP emulator URL; native Firestore reported connection refused at 127.0.0.1:8080.
This tunnel configuration is not qualified for the iPhone backend. Both runs
used PHONE ending 0101: the original flow's constants overrode the iPhone build's
requested values. The flow now requires supplied values and has no such defaults.
These are retained setup failures, not a cross-platform pass.

The revised flow subsequently passed on Pixel 6 with supplied PHONE ending 0102
and CONTACT_PHONE ending 0101. The Maestro trace, final screenshot and independent
backend record agree. Both identities have therefore passed in separate Android
runs; concurrent endpoints and call behavior have not been tested in this setup.

An iPhone retry needs a qualified secure backend and native database route.
Do not disable Firebase transport protections or add a production auth bypass.
Provider re-signing also means these demo tests cannot validate production App
Attest, APNs, TestFlight, real SMS or the final store candidate. No call audio,
network-recovery or background-ringing claim follows from this smoke test.

Keep app/ZIP hashes, provider build/session IDs, backend evidence and full
pass/failure artifacts. See store/release/cloud-device-testing.txt for updated
results, provider limitations and the remaining validation requirements.
