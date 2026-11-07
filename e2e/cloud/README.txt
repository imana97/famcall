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
Keep paid network features disabled. A bounded free-account audio capability
request was rejected before session creation; microphone injection is unavailable
for this account/framework. Do not purchase an upgrade or assume trial access.
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
backend record agree. At this stage both identities had passed in separate
Android runs; the paired-call qualification below was performed afterward.

An iPhone retry needs a qualified secure backend and native database route.
Do not disable Firebase transport protections or add a production auth bypass.
Provider re-signing also means these demo tests cannot validate production App
Attest, APNs, TestFlight, real SMS or the final store candidate. No call audio,
network-recovery or background-ringing claim follows from this smoke test.

PAIRED ANDROID CALL
Package the two endpoint flows with:
  node scripts/package-cloud-smoke.mjs --paired-call

This produces a separate famcall-cloud-call.zip with twelve allowlisted files.
Before testing, build the backend, start demo-famcall with live TURN access,
and run node scripts/cloud-call-lab.mjs <fresh-run-UUID>. The call lab listens on
loopback port 8787; include only this port and 9099/8080/5001 in the authenticated
provider tunnel. Never expose these demo services publicly. The lab selects UDP
relay traffic without impairment and records the existing e2e metrics.

Start two simultaneous Android builds with the same RUN_ID. Execute only
e2e/cloud/call-callee.yaml for the phone ending 0102 and only
e2e/cloud/call-caller.yaml for the phone ending 0101. Each endpoint needs the four
signup parameters above, with the other phone as CONTACT_PHONE. Each build must
have its own device session. The caller waits for callee readiness, both assert
connected state, and the caller waits at least fifteen seconds after the callee's
connected marker before hanging up. Both flows verify return to the people list.
The synchronization helper polls for at most ninety seconds; it does not retry
failed call actions. Limit overall provider run duration separately and stop the
other endpoint if startup fails. Stop the tunnel, collector and emulators after
retaining results.

Both Pixel 6 / Android 12 flows passed on 6 November 2026. The backend recorded
20.782 seconds from acceptance to hangup and no remaining active leases. Six
WebRTC samples per endpoint over fifteen seconds confirmed each selected pair
used UDP relay candidates, with inbound/outbound RTP and increasing source and
received audio energy. Screenshots and logs are retained. No known speech was
injected and no network impairment was applied. This is foreground call/media
transport evidence; it does not establish intelligibility, push or poor-network
recovery. See the release verification record for the precise artifact scope.

MISSED HISTORY AND BLOCKING
Package the longer two-endpoint flows with:
  node scripts/package-cloud-smoke.mjs --lifecycle

This produces famcall-cloud-lifecycle.zip with seventeen allowlisted files.
Use the same private backend, collector, endpoint identities and tunnel as above,
but execute lifecycle-caller.yaml and lifecycle-callee.yaml in separate sessions.
The caller cancels only after the callee observes the ringing screen. The callee
checks that this unanswered call appears as Missed in Recents, blocks the number
from that history row, and waits for the caller to verify its next attempt is
refused. After unblocking, both endpoints must complete a connected call. Both
apps restart and check the persisted history; the callee checks both Incoming
and Missed rows. Save backend snapshots while blocked and after unblocking, plus
the final calls and active leases. This does not test ring-expiry scheduling,
background notifications, speech quality or a blocked call racing with unblock.

The two lifecycle flows passed on hosted Pixel 6 / Android 12 devices on
6 November 2026 after one retained provider-startup failure and bounded retry.
Backend snapshots confirmed the block existed during the refused attempt, no
extra call record was created, unblocking removed it, and the subsequent call
ended with no active leases. Post-relaunch history screenshots were inspected.

RECORDING AND FEATURE QUALIFICATION
If Maestro's per-test video URL returns 404, the general session endpoint
/app-automate/sessions/<session-id>.json can provide a working video_url. Treat
the returned signed URL as a credential: retain it only in private artifacts and
never forward API authorization headers to its download/redirect destinations.
Retain file hashes and examine the audio track before claiming usable capture.
The paired run's recovered videos show connected calls but include long silent
audio intervals. With no known microphone signal injected, speech capture is
unqualified. The subsequent injection capability request returned HTTP 422 /
BROWSERSTACK_INVALID_ACTION_BY_GROUP without creating a session. The account
remained Free. Do not interpret that account limit as a FamCall audio failure.

Keep app/ZIP hashes, provider build/session IDs, backend evidence and full
pass/failure artifacts. See store/release/cloud-device-testing.txt for updated
results, provider limitations and the remaining validation requirements.
