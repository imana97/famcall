import UIKit
import CallKit

@main
final class Probe: UIResponder, UIApplicationDelegate, CXProviderDelegate, CXCallObserverDelegate {
    var window: UIWindow?
    private var provider: CXProvider!
    private let observer = CXCallObserver()
    private let callID = UUID()
    private let began = ProcessInfo.processInfo.systemUptime
    private var events: [[String: Any]] = []
    private var label = UILabel()
    private var reporting = false
    private var cleanupStarted = false

    func record(_ kind: String, _ fields: [String: Any] = [:]) {
        var item = fields
        item["event"] = kind
        item["seconds"] = ProcessInfo.processInfo.systemUptime - began
        item["date"] = ISO8601DateFormatter().string(from: Date())
        events.append(item)
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("events.json")
        let data = try! JSONSerialization.data(withJSONObject: events, options: [.prettyPrinted, .sortedKeys])
        try! data.write(to: url, options: .atomic)
        label.text = "CallKit simulator probe\n\n" + kind
        print("FAMCALL_PROBE " + String(data: try! JSONSerialization.data(withJSONObject: item, options: [.sortedKeys]), encoding: .utf8)!)
    }
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let controller = UIViewController()
        controller.view.backgroundColor = .systemBackground
        label.numberOfLines = 0
        label.textAlignment = .center
        label.frame = CGRect(x: 20, y: 150, width: 350, height: 300)
        controller.view.addSubview(label)
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = controller
        window?.makeKeyAndVisible()
        let configuration = CXProviderConfiguration(localizedName: "FamCall Lab Probe")
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.phoneNumber]
        configuration.includesCallsInRecents = false
        provider = CXProvider(configuration: configuration)
        provider.setDelegate(self, queue: .main)
        observer.setDelegate(self, queue: .main)
        record("launch", ["os": UIDevice.current.systemVersion, "callID": callID.uuidString, "microphoneUsed": false, "networkUsed": false])
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.report() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
            self.record("observation_complete", ["calls": self.observer.calls.map { ["id": $0.uuid.uuidString, "ended": $0.hasEnded, "connected": $0.hasConnected, "outgoing": $0.isOutgoing] }])
            self.cleanupStarted = true
            self.record("cleanup_requested")
            self.provider.reportCall(with: self.callID, endedAt: Date(), reason: .remoteEnded)
        }
        return true
    }
    func report() {
        reporting = true
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .phoneNumber, value: "+12025550199")
        update.localizedCallerName = "Fictional Lab Caller"
        update.hasVideo = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        record("report_requested")
        provider.reportNewIncomingCall(with: callID, update: update) { error in
            DispatchQueue.main.async {
                let e = error as NSError?
                self.record("report_completed", ["errorDomain": e?.domain ?? "", "errorCode": e?.code ?? 0, "error": e?.localizedDescription ?? ""])
            }
        }
    }
    func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
        record("call_changed", ["id": call.uuid.uuidString, "ended": call.hasEnded, "connected": call.hasConnected, "outgoing": call.isOutgoing, "afterCleanup": cleanupStarted])
    }
    func providerDidReset(_ provider: CXProvider) { record("provider_reset", ["afterReport": reporting]) }
    func provider(_ provider: CXProvider, perform action: CXEndCallAction) { record("end_action", ["afterCleanup": cleanupStarted]); action.fulfill() }
    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) { record("answer_action"); action.fulfill() }
    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) { record("action_timeout", ["action": String(describing: type(of: action))]) }
}
