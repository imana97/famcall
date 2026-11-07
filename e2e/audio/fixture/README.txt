LINUX EMULATOR AUDIO CONTROL

This is a diagnostic prerequisite for the FamCall call matrix. It sends generated
speech through the Android emulator's authenticated microphone API into a separate
Android AudioRecord app. It does not use FamCall, WebRTC, Firebase, TURN, personal
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
boots three fresh API 36 x86_64 AVD processes. Each receives one injection only.
All outcomes are retained, including failures. No automatic retry replaces them.
The Android app also refuses hardware other than ranchu/goldfish emulators.

The controller starts emulators with -no-audio so host microphone passthrough is
disabled. The gRPC injection temporarily supplies synthetic microphone input.
Only disposable emulator recordings and allowlisted JSON reports are uploaded.
Debug keystores, discovery bearer tokens, raw emulator logs, and APKs are excluded.
Artifacts expire after seven days; preserve evidence needed for a release audit.

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
