FAMCALL — STANDALONE CALLKIT SIMULATOR PROBE

Purpose: distinguish an iOS simulator calling-interface failure from FamCall,
Firebase, WebRTC or JavaScript behavior. This app only reports a fictional
incoming call, records native callbacks and cleans up after a 25-second
observation. It does not open a microphone, make a network request, use push,
or test speech. It is not an end-to-end call test.

BUILD ON AN APPLE SILICON MAC WITH XCODE
  bash e2e/ios-callkit-probe/build.sh

The result is .local/callkit-probe/build/CallKitProbe.app. The binary targets
IOSSIMULATOR, with minimum iOS 16.4. FAMCALLLAB is a synthetic simulator identity;
no real Apple certificate, provisioning profile or production credential is used.
The probe uses the older localized-name provider initializer; the SDK emits a
deprecation warning, but it remains available on these versions.

The build uses Xcode's simulated-entitlement Mach-O sections. Do not pass the
simulated application identifier as a real code-signing entitlement to an
ad-hoc binary: macOS rejects that signature before the probe can run. A probe
without the simulated application identity is also invalid evidence: the native
call service can reject its connection before reportNewIncomingCall completes.

RUN ONLY ON A NEW, DISPOSABLE LAB SIMULATOR
First check installed runtimes with xcrun simctl list runtimes. The recorded
cases used iPhone 16 Pro device types on iOS 18.6 and iOS 26.5. Example:

  probe_device=$(xcrun simctl create 'FamCall CallKit Probe' \
    com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro \
    com.apple.CoreSimulator.SimRuntime.iOS-26-5)
  xcrun simctl boot "$probe_device"
  xcrun simctl bootstatus "$probe_device" -b
  xcrun simctl install "$probe_device" .local/callkit-probe/build/CallKitProbe.app
  xcrun simctl launch "$probe_device" com.silvergridtech.famcall.callkitprobe
  probe_data=$(xcrun simctl get_app_container "$probe_device" \
    com.silvergridtech.famcall.callkitprobe data)

The probe writes Documents/events.json in that data directory. Retain it after
observation_complete and cleanup_requested appear, along with the source/binary
hashes and simulator runtime/device identity. Capture system evidence promptly:

  xcrun simctl spawn "$probe_device" log show --last 2m --style compact \
    --predicate 'process == "callservicesd" OR process == "InCallService"'

Clean up only the dedicated simulator created for this run:

  xcrun simctl terminate "$probe_device" com.silvergridtech.famcall.callkitprobe
  xcrun simctl uninstall "$probe_device" com.silvergridtech.famcall.callkitprobe
  xcrun simctl shutdown "$probe_device"

INTERPRETATION
An accepted report requires report_completed with an empty error and code zero.
An ended call is spontaneous only if call_changed has ended=true before
cleanup_requested. Provider reset or a missing completion is a setup/service
failure, not a reproduced incoming-call termination. Retain unsuccessful setup
attempts separately and never count them as passes or valid comparisons.

OBSERVED 7 NOVEMBER 2026 UTC
One valid run per runtime, using the same compiled binary:
- iOS 26.5: report accepted, native call ended 44 ms after the completion callback.
  The system log failed to open facetime://?launchForIncomingCall=1 and recorded
  disconnect reason 55, matching the earlier FamCall simulator symptom.
- iOS 18.6: report accepted, native call ended 216 ms after completion. The log
  also failed to open the incoming-call URL. Reason 55 was not observed here.

Both ends occurred before the probe's cleanup, without an answer or user action.
These observations establish that the symptom can arise without FamCall code.
They do not exclude other app defects or establish behavior on a real iPhone.
Keep actual iPhone incoming calls, background push and audio as release gates.

The public build script reproduced the exact tested binary hash:
15b9aeb508ccaedd5291979632b3884fb0a9bab15f9aecfa9ffa9061048300cc
Probe.swift SHA-256:
8053cc5c63564ef0824df86e9836bd22dd04aeca28cae94fd7eca4146bb891b0
