LINUX EMULATOR AUDIO CONTROL

This is a diagnostic prerequisite for the FamCall call matrix. It sends generated
speech through a controlled emulator input into a separate Android AudioRecord
app. It does not use FamCall, WebRTC, Firebase, TURN, personal
phones, or a host microphone. A pass establishes only that this input fixture
captured matching speech for these three attempts. It is not a call-quality,
physical-microphone, repeatability-population, or weak-network qualification.

Why a separate control: silent input was reproduced in a standalone recorder on
the Mac, outside FamCall and WebRTC. The installed WebRTC 155.0.1 Java audio module
has an observation callback, but no supported external-PCM source setter. Replacing
its audio implementation would change the tested native path. A Linux runner is
an independent host/architecture experiment; a different outcome cannot isolate
which OS, emulator version, architecture, or timing difference caused it.

The Audio fixture control workflow runs on a standard ubuntu-24.04 public-repo
runner, without secrets or paid runner labels. It builds a network-free, separate
debug APK using the Android SDK, generates nonrepeating speech with espeak-ng, and
boots fresh API 36 x86_64 AVD processes. Each receives one injection only.
All outcomes are retained, including failures. No automatic retry replaces them.
The Android app also refuses hardware other than ranchu/goldfish emulators.
After installation, each emulator reboots once before any measurement. This makes
the fixture part of AudioService's initial native UID/package population instead
of relying on its asynchronous package-added update, which package-manager queue
waits do not fence. The controller verifies a new boot ID and unchanged APK/UID,
then grants and verifies microphone permission on the measuring boot.
No failed recording is retried. The previous unknown-UID failures remain failures.

The grpc method starts emulators with -no-audio and temporarily injects generated
microphone input through gRPC. The pulse method instead starts a private audio
server with exactly two virtual null sinks and no physical-device detection. Its
only microphone sources are their virtual monitors. It verifies the source/module
list before enabling emulator input and plays generated PCM into the input sink.
The server uses a private Unix socket, never a network listener. No host hardware
microphone is used by either method. FAMCALL_FIXTURE_INPUT selects grpc, pulse,
or pulse-pipe.
The pulse-pipe variant feeds a private FIFO into module-pipe-source. It exposes
an ordinary virtual input source, with no hardware devices, and supplies generated
PCM at real-time speed. Pulse input/output stream snapshots identify the emulator's
route before and during playback. The workflow currently runs this diagnostic.
Virtual host input is enabled and verified before Android opens AudioRecord.
Pulse controls use the normal emulator on a private Xvfb display and verify the
running executable. The no-window launcher selects a headless executable whose
Linux PulseAudio implementation is stubbed; enabling the microphone gate cannot
restore that backend. The grpc comparison retains its original headless mode.
The display accepts no TCP connections and is cleaned up by xvfb-run afterward.
The pulse route explicitly sets QEMU_PA_SERVER/SOURCE/SINK and uses the emulator's
-allow-host-audio flag, which otherwise zeroes host input even when the microphone
state RPC is enabled. This flag is only used inside the isolated Linux runner
after the virtual-only source guard succeeds; never add it to the Mac lab launcher.
Selected Android audio error tags are retained to explain recorder failures;
the disposable Android image contains no signed-in user or backend account.
Only disposable emulator recordings and allowlisted JSON reports are uploaded.
Debug keystores, discovery bearer tokens, raw emulator logs, and APKs are excluded.
Artifacts expire after seven days; preserve evidence needed for a release audit.
Partial recordings from unsuccessful runs are retained explicitly as unqualified.
FAMCALL_FIXTURE_ATTEMPTS=1 selects a bounded diagnostic pilot while fixing setup.
The default is three fresh processes. A single passing sample never sets
repeatabilityQualified; rerun all three controls before advancing to call tests.

The whole 30-second reference must correlate at least 0.75 with the Android PCM.
At least 90% of active two-second windows must independently correlate at least
0.6, searching within 250ms of the whole-clip alignment. Silent reference windows
are excluded explicitly. These are fixture-content gates, not intelligibility
thresholds. Reports include every window, native completion/sample counts,
reference/build/installed-APK hashes, emulator version and protocol hash. Unit
tests reject silence, unrelated audio, truncated recordings, partial bursts,
replay, gaps and nonfinite input.

Run manually from GitHub Actions after merging, or on the development branch
codex/qualify-linux-audio. The runner intentionally refuses local execution and
an already-populated evidence directory. A local build-only check is supported:
ANDROID_HOME=/path/to/sdk JAVA_HOME=/path/to/jdk17 python3 e2e/audio/fixture/build.py

If all three controls pass, the next step is the actual two-emulator FamCall
baseline, followed by constrained-link and interruption cases. Never count this
standalone control toward those release gates.
