FAMCALL — MACOS ANDROID AUDIO LAB

The lab uses two dedicated Android AVDs, an isolated Firebase demo project,
Maestro, generated speech, and the emulator's authenticated audio API. It does
not record the host microphone. Native WebRTC carries the injected speech through
the real Cloudflare relay. The local UDP proxy impairs only this experiment.

PREREQUISITES
Node from .nvmrc, Python 3.12 or newer (3.14 used for this pilot), Java 17 for
Maestro, Java 21 for Firebase emulators,
Android SDK/emulator and an ARM64 API 36 system image on Apple Silicon, Maestro,
ffmpeg, and macOS say (or another offline source of synthetic speech).

Create named AVDs famcall_a and famcall_b under this repository's .local/avd.
Set ANDROID_AVD_HOME to that absolute directory when using avdmanager. Use
separate data directories and enable virtual audio input/output. Do not use
personal-device AVDs. The restart helper refuses an unrelated AVD at its ports.

Install the separate com.silvergridtech.famcall.e2e app on both emulators, then
sign in with the Auth emulator's fictional +12025550101 and +12025550102 users.
Use scripts/e2e-sign-in.mjs, setting DEVICE and PHONE for each. Save the second
number as a contact on the first phone. Never use real SMS for this lab.

PYTHON SETUP (from repository root)
python3 -m venv .local/audio-venv
.local/audio-venv/bin/pip install -r e2e/audio/requirements.txt
mkdir -p .local/audio-proto
.local/audio-venv/bin/python -m grpc_tools.protoc \
  -I "$ANDROID_HOME/emulator/lib" \
  --python_out=.local/audio-proto --grpc_python_out=.local/audio-proto \
  "$ANDROID_HOME/emulator/lib/emulator_controller.proto"

Use the proto shipped with the exact emulator binary. Confirm the generated
files import successfully before running. ANDROID_HOME must name the SDK.
For a separate emulator installation, set FAMCALL_EMULATOR_BIN to its executable
and FAMCALL_AUDIO_PROTO_DIR to a directory generated from that installation's
lib/emulator_controller.proto. The default generated directory is .local/audio-proto.
Reports record each running emulator's reported version, the protocol descriptor
hash and the gRPC library version; preserve these when comparing toolchains.
FAMCALL_AUDIO_INPUT_RATE selects 8000, 16000 or 48000 Hz (default 48000) for
synthetic microphone input. Keep it fixed across comparison samples and record
it with results. Matching a native recording rate is a diagnostic experiment,
not proof of a reliable fixture; retain silent and otherwise invalid attempts.

SYNTHETIC REFERENCE
Generate only between runs; never replace the reference during a matrix:
say -v Samantha -f e2e/audio/phrases.txt -o .local/audio-source.aiff
ffmpeg -y -i .local/audio-source.aiff -ac 1 -ar 48000 \
  -c:a pcm_s16le .local/audio-source.wav

Another synthetic clip is acceptable if it is mono signed 16-bit PCM at 48 kHz.
Keep the exact reference with the private run evidence. A different clip changes
the experiment and must not be silently compared as an identical repeat.

RUN
1. Start Firebase demo emulators and the lab server in separate terminals:
   node scripts/start-emulators.mjs --live-turn
   node scripts/audio-lab.mjs
   The maintainer command reads relay secrets into memory from Secret Manager.
   Forks must use their own relay/project; never put permanent keys in the repo.
2. End any existing lab call. Set JAVA_HOME for Maestro and MAESTRO_BIN if needed.
3. Run node scripts/run-audio-matrix.mjs.
   Each direction of each profile restarts the dedicated AVDs, places/answers a
   native call through Maestro, and uses one injection per emulator process.
   Speech measurements use buffered delivery and emulator flow control.
   The run keeps a private copy of the synthetic reference, source hashes,
   emulator version, and each profile's actual installed APK hashes. A workspace
   commit alone does not prove which app binary was installed.
4. Inspect the timestamped .local/audio-lab/matrix-* directory. A process exit
   code of zero means measurements were valid, not that voice quality passed a
   release threshold. Listen to the synthetic captures and review packet data.

For a focused regression run, FAMCALL_AUDIO_PROFILES=baseline,weak selects only
those fixed profiles. Omit it for all four. Selection is saved in provenance;
do not describe a subset as the complete matrix. It is rejected in outage mode.

The baseline/modest/weak/stress labels describe experimental configurations,
not an advertised support envelope. Delay/loss/jitter are applied independently
on both endpoint relay legs. Report measured RTT and RTP loss. Bandwidth includes
an estimated 28-byte IPv4/UDP header per packet; link-layer and VPN overhead are
not included. The measured network model is recorded in each report.

OUTAGES AND SAFETY
With a connected call on the isolated UDP proxy, run:
node scripts/measure-transport-outage.mjs 5
Repeat with 15 or 30. This reports packet recovery only, at approximately
three-second observation intervals. It cannot prove speech recovery.

Generated speech recovery is a separate experiment:
say -v Samantha -f e2e/audio/recovery-phrases.txt -o .local/recovery-source.aiff
afconvert -f WAVE -d LEI16@48000 -c 1 .local/recovery-source.aiff .local/recovery-source.wav
node scripts/run-audio-matrix.mjs --outages 2 5 15 30

The runner restarts both dedicated AVDs for each direction of each outage. Set
FAMCALL_AUDIO_DIRECTION=b-to-a (or a-to-b) to run only one direction. It injects
continuous, nonrepeating synthetic speech,
blocks only the UDP relay after 12 seconds, restores it after the requested
interval, and captures another 20 seconds. It verifies the exact profile-change
history, actual packet drops, the selected path, and speech before the outage.
It requires a two-second received waveform matching new reference speech from
after restoration. Silence and replayed pre-outage audio fail the recovery check.
The first full matching window's arrival time is a conservative observation
upper bound, not exact speech latency. Delayed capture delivery makes that bound
later. The reported post-recovery STOI is an estimate for up to ten seconds;
it is not a word-understanding score, a simultaneous two-way test, or a G4/G5 pass.
These baseline-link outage cases do not cover outages on N1/N2 impaired links.

To retain an impaired link on both sides of the outage, use:
FAMCALL_OUTAGE_PROFILE=weak node scripts/run-audio-matrix.mjs --outages 2 5
The available underlying profiles are baseline (the default), modest, weak and
stress, with the same settings as the fixed-profile matrix. During the outage
only loss changes to 100%; afterward the original loss, cap, delay and jitter
must all return. Evidence validation rejects a restoration to a healthier link.
The profile is recorded in provenance and the case names. These per-relay-leg
presets do not directly establish the end-to-end N1/N2 release conditions.

Each case also saves PID-filtered native logs from both test apps before dialing,
through measurement and hangup. Their hashes, process IDs and capture lifetime
are retained beside the report. This helps investigate lost statistics or native
errors. It does not follow a restarted app process. Raw logs can contain sensitive
diagnostic values and stay in ignored .local; never publish them.
Private system-audio snapshots after connection and measurement record mute,
route and audio-device state for diagnosing a silent input or output fixture.

The detector uses a fixed correlation threshold of 0.35 and two-second windows,
sampled every 250 ms. Preserve these settings and the reference with the evidence.
Unit checks cover restored audio, silent packet streams, replayed old audio,
profile changes and missing packet drops. Run them with the audio virtualenv:
.local/audio-venv/bin/python -m unittest discover -s e2e/audio -p 'test_*.py'

TIMING DIAGNOSTICS
Test builds record native receiver buffer and acceleration counters. For an
outage report, preserve a diagnostic extract with:
python3 scripts/analyze-audio-timing.py .local/audio-lab/RUN/outage-15-b-to-a.json \
  --output .local/audio-lab/timing-diagnostic.json
The extract preserves selected raw observations and report/analysis source hashes.
It separates each peer, stream, and before/during/after interval; missing counters
remain missing and counter resets invalidate the affected delta. Mean buffer delay
uses the change in cumulative delay divided by emitted samples. This describes
receiver buffering, not end-to-end latency, and never grants a speech pass.

Reports also retain the emulator's capture timestamps and progress handing
generated input to gRPC. Handoff time is not microphone consumption time.
FAMCALL_AUDIO_DELIVERY=realtime selects the emulator's experimental paced mode
for a controlled comparison. Buffered remains the default; a realtime pilot
produced no valid input, so that mode is not a validated workaround.

To observe an already-connected call's selected path and packet continuity:
node scripts/measure-transport-session.mjs udp 30
The first argument is udp, tcp, tls, or direct; the second is 15–7200 seconds.
For TCP/TLS, set the lab /config transport and proxy=false BEFORE placing a new
call. For direct, the selected candidate must actually be host/srflx/prflx.
Forcing a relay protocol proves that path is usable, not that automatic fallback
works when UDP is blocked. The UDP shaper does not impair TCP/TLS traffic.
A longer observation also records signaling generation changes, without storing
SDP or relay passwords. Renegotiation alone is not proof of credential expiry
handling or audible continuity. Physical-device endurance remains required.

With the current test APK installed and both fictional users signed in, exercise
initial setup failure separately (end any existing call first):
node scripts/test-initial-connection.mjs recover
node scripts/test-initial-connection.mjs timeout
The first blocks the relay during initial setup, verifies a signaling retry,
restores it after 22 seconds, and checks received packets at both phones. The
second keeps it blocked and requires the call to end within 90 seconds. Neither
injects audio or sends SMS. Both restore the baseline lab network afterward.

To check durable caller hangup with both signaling and media unavailable:
node scripts/test-offline-hangup.mjs
End any existing call first. This uses only famcall_a/famcall_b and the isolated
test app. It places a call, disables the caller's emulator Wi-Fi and mobile data,
checks that no default network remains, hangs up locally, and restarts the app
while still offline. The server call must remain accepted until connectivity is
restored; afterward it must end, clear both leases, and disappear at the recipient.
The caller must remain on the contacts screen. Original network settings are
restored on completion/interruption. This covers caller hangup/process restart,
not every offline-call state or physical-device background behavior. The replay
observation after detecting a default network is not exact reconnection latency.

Interrupting the matrix restores the network profile. An interrupted run may
leave a lab call active; end it before starting another run. All reports and
recordings remain in .local; do not publish raw diagnostic logs.

The emulator may become silent or crash if injectAudio is reopened in the same
process. measure.py refuses repeated injections. Restart the emulator first;
do not delete its guard marker to force another injection. Discovery skips dead
processes. Two recovery samples also had no input signal when injection followed
output capture in the same process. The runner now restarts both emulators for
every direction to isolate that transition. This is a workaround under test,
not a diagnosed emulator defect. These workarounds need revalidation when
upgrading the emulator.

Results and recordings stay in ignored .local. No live conversation, contact
book, SMS code, push token, API key or relay password belongs in shared evidence.
Physical-device audio, background ringing, authentication, and listener tests
remain separate release gates. See store/release/e2e-test-plan.txt.
