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
    @Published var error: String?
    @Published var loading = false
    let diagnostics = DiagnosticsLog()
    lazy var danmaku = DanmakuRepository(model: self)
    lazy var community = CommunityTransport(model: self)
    lazy var player = PlaybackController(model: self)
    lazy var bridge = NativeBridge(model: self)
    lazy var web = WebHost(model: self)
    init() {
        let testing = ProcessInfo.processInfo.arguments.contains("--ui-testing")
        let root = URL.applicationSupportDirectory.appending(path: testing ? "UITestProfiles" : "Profiles")
        if testing { try? FileManager.default.removeItem(at: root) }
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
    func setEmbySession(_ value: JSONValue) { embySession=value;downloads.setOwner(value) }
    func playOffline(_ record: DownloadRecord, coordinator: DownloadCoordinator) throws {
        guard record.status=="completed" else {throw CoreError.invalidRequest}
        try player.dispatch("load",[.string(coordinator.localURL(record).absoluteString),.object(["autoplay":.bool(true),"startMilliseconds":.number((record.progress?.position ?? 0)*1000)]),.object(["title":.string(record.title),"type":.string("video")]),.number(1),.number(-1)])
        offlinePlayback=(coordinator,record.id)
    }
    func selectProfile(_ id: UUID) throws {
        player.stop(notify:true);community.clear();web.close()
        try profiles.select(id)
        settings=try SettingsStore(directory:profiles.directory)
        community=CommunityTransport(model:self);danmaku=DanmakuRepository(model:self)
        embySession = .null
        server=try? ServerAddress(settings.get("main","userWebClient").string ?? "")
        web=WebHost(model:self);showConnection=server==nil;start();objectWillChange.send()
    }
    func connect(_ input: String) throws {
        let address = try ServerAddress(input)
        try settings.set("main", "userWebClient", .string(address.baseURL.absoluteString))
        server = address; showConnection = false; error = nil
        web.open(address)
    }
    func start() { if let server { web.open(server) } }
}
