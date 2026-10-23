#if DEBUG
import Foundation
import WebKit
import AppleCore

extension Notification.Name {
    /// Validation builds only: open a player panel for a layout screenshot.
    static let tigerestTourPlayer = Notification.Name("TigerestTourPlayer")
}

/// Validation builds only (`--device-tour`): a remote-controlled screen tour for
/// layout review on a real device. devicectl copies Caches/tour-command.json in;
/// each new command id runs once and its result is written to Caches/tour-result.json.
/// Screenshots and rotation are taken by devicectl itself.
@MainActor final class DeviceTour {
    private static var shared: DeviceTour?
    private unowned let model: AppModel
    private var timer: Timer?
    private var lastID = ""
    private var running = false
    private init(model: AppModel) { self.model = model }

    static func startIfRequested(_ model: AppModel) {
        guard shared == nil, ProcessInfo.processInfo.arguments.contains("--device-tour") else { return }
        let tour = DeviceTour(model: model); shared = tour
        try? FileManager.default.removeItem(at: tour.commandURL)
        tour.timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in Task { @MainActor in await tour.poll() } }
    }
    private var commandURL: URL { URL.cachesDirectory.appending(path: "tour-command.json") }

    private func poll() async {
        guard !running, let data = try? Data(contentsOf: commandURL),
              let command = try? JSONDecoder().decode(JSONValue.self, from: data),
              let id = command["id"].string, id != lastID else { return }
        lastID = id; running = true; defer { running = false }
        var result: [String: JSONValue] = ["id": .string(id)]
        do { result["value"] = try await run(command); result["ok"] = .bool(true) }
        catch { result["ok"] = .bool(false); result["error"] = .string(String(describing: error)) }
        try? JSONEncoder().encode(JSONValue.object(result)).write(to: URL.cachesDirectory.appending(path: "tour-result.json"), options: .atomic)
    }

    private func run(_ command: JSONValue) async throws -> JSONValue {
        if let script = command["js"].string {
            // An async function body in the page world; return a JSON-serialisable value.
            let value = try await model.web.view.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
            return .string(String(describing: value ?? "null"))
        }
        if let panel = command["show"].string {
            switch panel {
            case "quality": model.showQuality = true
            case "offline": model.showOffline = true
            case "profiles": model.showProfiles = true
            case "connection": model.openServerSettings()
            case "none": model.showQuality = false; model.showOffline = false; model.showProfiles = false; model.showConnection = false
            default: throw CoreError.invalidRequest
            }
            return .null
        }
        if let pair = command["mpvSet"].array, pair.count == 2, let engine = model.player.engine {
            try engine.set(pair[0].string ?? "", pair[1].string ?? ""); return .string(engine.string(pair[0].string ?? ""))
        }
        if let names = command["mpvGet"].array, let engine = model.player.engine {
            return .object(Dictionary(uniqueKeysWithValues: names.compactMap(\.string).map { ($0, JSONValue.string(engine.string($0))) }))
        }
        if let args = command["mpvCommand"].array, let engine = model.player.engine {
            try engine.command(args.compactMap(\.string)); return .null
        }
        if command["surface"].bool == true {
            let surface = model.player.surface
            return .string("bounds=\(surface.bounds) drawable=\(surface.metal.drawableSize) frame=\(surface.frame)")
        }
        if command["updateCheck"].bool == true {
            // The in-app check against the live feed; the log line shows when GitHub was asked instead.
            let state = await model.updates.check(manual: true)
            let log = model.diagnostics.collect()["logText"].string ?? ""
            // The feed on its own, verified on this device: the release count and newest tag, or why it was rejected.
            var request = URLRequest(url: ReleaseFeed.productionURL, timeoutInterval: 10)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let feed: JSONValue
            do {
                let (data, response) = try await NoRedirectSession.make().data(for: request)
                let releases = try ReleaseFeed.releases(envelope: data)
                feed = .object(["status": .number(Double((response as? HTTPURLResponse)?.statusCode ?? 0)), "releases": .number(Double(releases.count)), "newest": releases.first?["tag_name"] ?? .null])
            } catch { feed = .string(String(describing: error)) }
            return .object(["state": state, "feedUsed": log.isEmpty ? .null : .bool(!log.contains("Release feed not used")), "feed": feed])
        }
        if let panel = command["player"].string {
            NotificationCenter.default.post(name: .tigerestTourPlayer, object: panel)
            return .null
        }
        return .null
    }
}
#endif
