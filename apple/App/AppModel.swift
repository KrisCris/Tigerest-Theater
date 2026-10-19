import SwiftUI
import AppleCore
@MainActor final class AppModel: ObservableObject {
    static weak var shared: AppModel?
    let profiles: ProfileStore
    var embySession: JSONValue = .null
    private var downloadRegistry: [UUID: DownloadCoordinator] = [:]
    var offlinePlayback: (DownloadCoordinator, String)?
    @Published var settings: SettingsStore
    @Published var server: ServerAddress?
    @Published var showConnection = false
    @Published var showOffline = false
    @Published var showProfiles = false
    @Published var showQuality = false
    @Published var error: String?
    @Published var loading = false
    @Published var connectionFailure: String?
    private var connectionTask: Task<Void, Never>?
    private var selectionID = UUID()
    private var pendingWeb: WebHost?
    private var serverSelectionError = false
    private func cancelServerSelection() {
        selectionID = UUID(); pendingWeb?.cancelSelection(); pendingWeb = nil
    }
    func takeServerSelectionError() -> Bool {
        let result = serverSelectionError; serverSelectionError = false; return result
    }
    let diagnostics = DiagnosticsLog()
    lazy var updates = UpdateController(model:self)
    lazy var danmaku = DanmakuRepository(model: self)
    lazy var community = CommunityTransport(model: self)
    lazy var player = PlaybackController(model: self)
    lazy var bridge = NativeBridge(model: self)
    lazy var web = WebHost(model: self)
    init() {
        let testing = ProcessInfo.processInfo.arguments.contains("--ui-testing")
        let root = URL.applicationSupportDirectory.appending(path: testing ? "UITestProfiles" : "Profiles")
        if testing {
            try? FileManager.default.removeItem(at: root)
            UserDefaults(suiteName:"TigerestUITestUpdates")?.removePersistentDomain(forName:"TigerestUITestUpdates")
        }
        do {
            profiles = try ProfileStore(root: root)
            settings = try SettingsStore(directory: profiles.directory)
            server = try? ServerAddress(settings.get("main", "userWebClient").string ?? "")
        } catch { fatalError("无法打开应用配置目录") }
        showConnection = server == nil
        Self.shared = self
    }
    var downloads: DownloadCoordinator { coordinator(for: profiles.currentID) }
    func coordinator(for id: UUID) -> DownloadCoordinator {
        if let saved=downloadRegistry[id] { return saved }
        let value=try! DownloadCoordinator(profile:id,directory:profiles.root.appending(path:id.uuidString))
        value.changed={ [weak self] snapshot in guard let self,self.profiles.currentID==id else {return};self.bridge.emit("system","downloadsChanged",[snapshot]) }
        downloadRegistry[id]=value;return value
    }
    func setEmbySession(_ value: JSONValue) { if embySession != value { danmaku.authorizationChanged() };embySession=value;downloads.setOwner(value) }
    func playOffline(_ record: DownloadRecord, coordinator: DownloadCoordinator) throws {
        guard record.status=="completed" else {throw CoreError.invalidRequest}
        try player.dispatch("load",[.string(coordinator.localURL(record).absoluteString),.object(["autoplay":.bool(true),"startMilliseconds":.number((record.progress?.position ?? 0)*1000)]),.object(["title":.string(record.title),"type":.string("video")]),.number(1),.number(-1)])
        offlinePlayback=(coordinator,record.id)
    }
    func selectProfile(_ id: UUID) throws {
        connectionTask?.cancel(); cancelServerSelection(); connectionFailure = nil
        player.stop(notify:true);community.clear();web.close()
        try profiles.select(id)
        settings=try SettingsStore(directory:profiles.directory)
        community=CommunityTransport(model:self);danmaku=DanmakuRepository(model:self)
        embySession = .null
        server=try? ServerAddress(settings.get("main","userWebClient").string ?? "")
        web=WebHost(model:self);showConnection=server==nil;start();objectWillChange.send()
    }
    func connect(_ input: String, mode: String) async throws {
        try await selectServer(input, mode: mode, target: nil)
    }
    func finishServerSelection(_ input: String, mode: String, target: String) async -> Bool {
        guard ["custom", "tigerest"].contains(mode), let address = try? ServerAddress(input),
              let url = URL(string: target), WebHost.origin(url) == address.origin else { return false }
        do { try await selectServer(input, mode: mode, target: url); return true }
        catch { return false }
    }
    private func selectServer(_ input: String, mode: String, target: URL?) async throws {
        guard ["custom", "tigerest"].contains(mode) else { throw CoreError.invalidSetting }
        cancelServerSelection(); serverSelectionError = false
        let selection = selectionID, profile = profiles.currentID
        var candidate: WebHost?
        do {
            let address = try await checkServer(input)
            try Task.checkCancellation()
            guard profile == profiles.currentID, selection == selectionID else { throw CancellationError() }
            let host = WebHost(model: self, active: false)
            candidate = host; pendingWeb = host
            try await host.loadForSelection(address, mode: mode, target: target)
            try Task.checkCancellation()
            guard profile == profiles.currentID, selection == selectionID else { throw CancellationError() }
            try settings.setServerConnection(address, mode: mode)
            // No suspension between persistence and replacement: cancelled or stale
            // documents never write the profile or dispatch native side effects.
            web.close(); player.stop(notify: true); setEmbySession(.null)
            web = host; pendingWeb = nil
            server = address; showConnection = false; loading = false
            error = nil; connectionFailure = nil
            host.activate(); objectWillChange.send()
        } catch {
            candidate?.cancelSelection()
            if selection == selectionID {
                pendingWeb = nil
                if !Task.isCancelled && !(error is CancellationError) { serverSelectionError = true }
            }
            throw error
        }
    }
    func checkServer(_ input: String) async throws -> ServerAddress {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let address = try ServerAddress(value.contains("://") ? value : "http://" + value)
        var request = URLRequest(url: address.endpoint("System/Info/Public"))
        request.timeoutInterval = 5
        let (body, response) = try await community.data(request, limit: 65536)
        let info = try JSONDecoder().decode(JSONValue.self, from: body)
        guard response.statusCode == 200, info["Id"].string != nil || info["Version"].string != nil else { throw URLError(.badServerResponse) }
        return address
    }
    func connectDedicated() async throws {
        let profile = profiles.currentID
        let presets = ServerPresets.bundled
        let candidates = ServerPresets.onLocalSubnet(presets.localIP) ? [presets.local, presets.remote] : [presets.remote]
        for (index, candidate) in candidates.enumerated() {
            do { try await connect(candidate, mode: "tigerest"); return }
            catch {
                try Task.checkCancellation()
                guard profile == profiles.currentID else { throw CancellationError() }
                if index == candidates.count - 1 { throw error }
            }
        }
    }
    func start() {
        connectionTask?.cancel(); cancelServerSelection(); connectionFailure = nil
        guard let server else { return }
        let mode = settings.get("main", "serverConnectionMode").string ?? ""
        if mode == "tigerest" || (mode.isEmpty && ServerPresets.bundled.contains(server)) {
            loading = true
            connectionTask = Task {
                do { try await connectDedicated() }
                catch { if !Task.isCancelled { loading = false; connectionFailure = "专属服务器暂时无法连接，请检查网络后重试，也可以先打开离线媒体。" } }
            }
        } else { web.open(server) }
    }
    func openServerSettings() { connectionTask?.cancel(); cancelServerSelection(); loading = false; showConnection = true }
}
