import AppleCore
import Combine
import Foundation

enum TVServerMode {
    case dedicated, selfHosted
}

struct TVBrowsePage: Identifiable {
    let id = UUID()
    let item: JSONValue
    var items: [JSONValue] = []
    var hasMore = false
    var title: String { TVMedia.title(item) }
}

@MainActor
final class TVAppModel: ObservableObject {
    @Published private(set) var session: EmbySession?
    @Published private(set) var client: EmbyClient?
    @Published private(set) var libraries: [JSONValue] = []
    @Published private(set) var resume: [JSONValue] = []
    @Published var error: String?
    @Published private(set) var busy = false
    @Published private(set) var serverMode: TVServerMode?
    @Published var serverURL = ""
    @Published private(set) var pages: [TVBrowsePage] = []
    @Published private(set) var selectedItem: JSONValue?
    @Published private(set) var focusTarget: String?
    @Published private var fixtureActive = false

    let player = TVPlaybackController()
    let fixtureMode: Bool
    private let store: TVSessionStore
    private var started = false
    private var requestID = UUID()
    private let batchSize = 80
    private var retryAction: RetryAction = .home

    private enum RetryAction {
        case home, page, more, detail(JSONValue), playback(JSONValue, Bool)
    }

    init(fixtureMode: Bool = ProcessInfo.processInfo.arguments.contains("--tv-fixture"),
         store: TVSessionStore = TVSessionStore()) {
        self.fixtureMode = fixtureMode
        self.store = store
        player.onStopped = { [weak self] item, position, duration in
            self?.updateProgress(item: item, position: position, duration: duration)
        }
    }

    var isAuthenticated: Bool { session != nil || fixtureActive }
    var canGoBack: Bool { selectedItem != nil || !pages.isEmpty }
    var currentPage: TVBrowsePage? { pages.last }

    func start() async {
        guard !started else { return }
        started = true
        if fixtureMode {
            fixtureActive = true
            await refresh()
            return
        }
        do {
            if let saved = try store.load() {
                client = try EmbyClient(session: saved)
                session = saved
                serverURL = saved.serverURL
                await refresh()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func selectServer(_ mode: TVServerMode) {
        invalidateRequest()
        serverMode = mode
        error = nil
        if mode == .dedicated {
            let presets = ServerPresets.bundled
            serverURL = ServerPresets.onLocalSubnet(presets.localIP) ? presets.local : presets.remote
        } else {
            serverURL = ""
        }
    }

    func resetServerSelection() {
        invalidateRequest()
        serverMode = nil
        error = nil
        serverURL = ""
    }

    func login(username: String, password: String) async {
        guard !fixtureMode else {
            error = "此启动为隔离测试模式。请正常启动应用后登录服务器。"
            return
        }
        guard serverMode != nil, !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "请输入用户名。"
            return
        }
        let id = beginRequest()
        do {
            let server: String
            if serverMode == .dedicated {
                server = try await dedicatedServer()
            } else {
                let value = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !value.isEmpty else { throw TVError.message("请输入服务器地址。") }
                server = value.contains("://") ? value : "http://" + value
                _ = try await EmbyClient.publicInfo(server: server)
            }
            guard isCurrent(id) else { return }
            let deviceID = try store.deviceID()
            let saved = try await EmbyClient.login(server: server, username: username.trimmingCharacters(in: .whitespacesAndNewlines),
                                                   password: password, deviceID: deviceID)
            guard isCurrent(id) else { return }
            let authenticatedClient = try EmbyClient(session: saved)
            try store.save(saved)
            session = saved
            client = authenticatedClient
            serverURL = saved.serverURL
            busy = false
            await refresh()
        } catch {
            fail(error, request: id)
        }
    }

    func logout() async {
        invalidateRequest()
        player.stop()
        do {
            if !fixtureMode { try store.clear() }
            session = nil
            client = nil
            fixtureActive = false
            libraries = []
            resume = []
            pages = []
            selectedItem = nil
            serverMode = nil
            serverURL = ""
            error = nil
            focusTarget = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refresh() async {
        let id = beginRequest()
        retryAction = .home
        if fixtureActive {
            libraries = TVFixtures.libraries
            resume = [TVFixtures.episode(1)]
            busy = false
            focusTarget = "tv.item.fixture.episode.1"
            return
        }
        guard let client else { busy = false; return }
        do {
            async let libraryResult = client.libraries()
            async let resumeResult = client.resumeItems()
            let (newLibraries, newResume) = try await (libraryResult, resumeResult)
            guard isCurrent(id) else { return }
            libraries = newLibraries
            resume = newResume
            busy = false
            focusTarget = (newResume.first ?? newLibraries.first).map { "tv.item.\(TVMedia.id($0))" }
        } catch {
            fail(error, request: id)
        }
    }

    func open(_ item: JSONValue) async {
        if TVMedia.isContainer(item) {
            invalidateRequest()
            selectedItem = nil
            pages.append(TVBrowsePage(item: item))
            await loadPage(append: false)
        } else {
            await loadDetail(item)
        }
    }

    func goBack() {
        invalidateRequest()
        error = nil
        if let selectedItem {
            focusTarget = "tv.item.\(TVMedia.id(selectedItem))"
            self.selectedItem = nil
        } else if let page = pages.popLast() {
            focusTarget = "tv.item.\(TVMedia.id(page.item))"
        }
    }

    func loadMore() async { await loadPage(append: true) }

    /// A response that arrives after backgrounding must not open a new player.
    func suspend() {
        if busy, case .playback = retryAction {
            invalidateRequest()
            error = "播放准备已暂停，请重试。"
            focusTarget = "tv.retry"
        }
    }

    func retry() async {
        switch retryAction {
        case .home: await refresh()
        case .page: await loadPage(append: false)
        case .more: await loadPage(append: true)
        case .detail(let item): await loadDetail(item)
        case .playback(let item, let resume): await play(item, resume: resume)
        }
    }

    func play(_ item: JSONValue, resume shouldResume: Bool) async {
        let id = beginRequest()
        retryAction = .playback(item, shouldResume)
        if fixtureActive {
            do {
                let arguments = ProcessInfo.processInfo.arguments
                guard let flag = arguments.firstIndex(of: "--tv-fixture-media"), arguments.indices.contains(flag + 1) else {
                    throw TVError.message("这是浏览测试样片。需要随隔离测试启动提供本地测试视频才能验证播放。")
                }
                let path = arguments[flag + 1]
                let url: URL?
                if path == "bundled" {
                    url = Bundle.main.url(forResource: "tv-fixture", withExtension: "mp4")
                } else {
                    url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : nil
                }
                guard let url, (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
                    throw TVError.message("未找到本地测试视频，请检查隔离测试资源。")
                }
                let fixtureSession = EmbySession(serverURL: "http://127.0.0.1:9", userID: "tv-fixture",
                                                 accessToken: "tv-fixture", deviceID: "tv-fixture")
                let fixtureClient = try EmbyClient(session: fixtureSession)
                let playback = EmbyPlayback(url: url, headers: [:], item: item, mediaSourceID: "tv-fixture",
                                            playSessionID: "tv-fixture", startSeconds: shouldResume ? TVMedia.resumeSeconds(item) : 0)
                try player.play(playback, client: fixtureClient)
                busy = false
            } catch {
                fail(error, request: id)
            }
            return
        }
        guard let client else {
            fail(TVError.message("这是浏览测试样片，没有连接媒体服务器。请正常启动并登录后播放。"), request: id)
            return
        }
        do {
            var requestedItem = item
            if !shouldResume, var object = item.object {
                var userData = item["UserData"].object ?? [:]
                userData["PlaybackPositionTicks"] = .number(0)
                object["UserData"] = .object(userData)
                requestedItem = .object(object)
            }
            let playback = try await client.playback(item: requestedItem)
            guard isCurrent(id) else { return }
            try player.play(playback, client: client)
            busy = false
        } catch {
            fail(error, request: id)
        }
    }

    private func loadPage(append: Bool) async {
        guard let page = currentPage, !append || page.hasMore else { return }
        let id = beginRequest()
        retryAction = append ? .more : .page
        do {
            let result: [JSONValue]
            if fixtureActive {
                result = TVFixtures.children(of: page.item)
            } else if let client {
                result = try await client.children(of: page.item, startIndex: append ? page.items.count : 0, limit: batchSize)
            } else {
                busy = false
                return
            }
            guard isCurrent(id), pages.last?.id == page.id else { return }
            let index = pages.count - 1
            pages[index].items = append ? page.items + result : result
            pages[index].hasMore = !fixtureActive && result.count == batchSize
            busy = false
            if let first = result.first { focusTarget = "tv.item.\(TVMedia.id(first))" }
        } catch {
            fail(error, request: id)
        }
    }

    private func loadDetail(_ item: JSONValue) async {
        let id = beginRequest()
        retryAction = .detail(item)
        selectedItem = item
        do {
            let detail: JSONValue
            if fixtureActive {
                detail = item
            } else if let client {
                detail = try await client.item(id: TVMedia.id(item))
            } else {
                busy = false
                return
            }
            guard isCurrent(id) else { return }
            selectedItem = detail
            busy = false
            focusTarget = TVMedia.resumeSeconds(detail) > 0 ? "tv.resume" : "tv.play"
        } catch {
            fail(error, request: id)
        }
    }

    private func dedicatedServer() async throws -> String {
        let presets = ServerPresets.bundled
        let candidates = ServerPresets.onLocalSubnet(presets.localIP) ? [presets.local, presets.remote] : [presets.remote]
        var lastError: Error = TVError.message("暂时无法连接专属服务器。")
        for candidate in candidates {
            do {
                _ = try await EmbyClient.publicInfo(server: candidate)
                return candidate
            } catch {
                try Task.checkCancellation()
                lastError = error
            }
        }
        throw lastError
    }

    private func updateProgress(item: JSONValue, position: Double, duration: Double) {
        guard position.isFinite, position >= 0 else { return }
        let completed = duration.isFinite && duration > 0 && position >= max(0, duration - 0.5)
        let seconds = completed ? 0 : min(position, 600_000_000)
        let id = TVMedia.id(item)
        func updated(_ value: JSONValue) -> JSONValue {
            guard TVMedia.id(value) == id, var object = value.object else { return value }
            var userData = value["UserData"].object ?? [:]
            userData["PlaybackPositionTicks"] = .number((seconds * 10_000_000).rounded(.down))
            object["UserData"] = .object(userData)
            return .object(object)
        }
        if let selectedItem { self.selectedItem = updated(selectedItem) }
        for index in pages.indices { pages[index].items = pages[index].items.map(updated) }
        if seconds > 0 {
            if resume.contains(where: { TVMedia.id($0) == id }) {
                resume = resume.map(updated)
            } else {
                resume.insert(updated(item), at: 0)
            }
        } else {
            resume.removeAll { TVMedia.id($0) == id }
        }
    }

    private func beginRequest() -> UUID {
        requestID = UUID()
        busy = true
        error = nil
        return requestID
    }

    private func invalidateRequest() {
        requestID = UUID()
        busy = false
    }

    private func isCurrent(_ id: UUID) -> Bool { requestID == id && !Task.isCancelled }

    private func fail(_ error: Error, request id: UUID) {
        guard isCurrent(id) else { return }
        busy = false
        self.error = error.localizedDescription
        if isAuthenticated { focusTarget = "tv.retry" }
    }
}

private enum TVError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let message): message }
    }
}

enum TVMedia {
    static func id(_ item: JSONValue) -> String { item["Id"].string ?? "unknown" }
    static func title(_ item: JSONValue) -> String { item["Name"].string ?? "未命名媒体" }
    static func isContainer(_ item: JSONValue) -> Bool {
        item["IsFolder"].bool == true || ["CollectionFolder", "UserView", "Folder", "BoxSet", "Series", "Season"].contains(item["Type"].string ?? "")
    }
    static func episodeLabel(_ item: JSONValue) -> String? {
        guard item["Type"].string == "Episode" else { return nil }
        let season = boundedInteger(item["ParentIndexNumber"].number, maximum: 9999)
        let episode = boundedInteger(item["IndexNumber"].number, maximum: 9999)
        return String(format: "S%02dE%02d", season, episode)
    }
    static func subtitle(_ item: JSONValue) -> String {
        if let episode = episodeLabel(item) {
            return [item["SeriesName"].string, episode].compactMap { $0 }.joined(separator: " · ")
        }
        let year = item["ProductionYear"].number.map { String(boundedInteger($0, maximum: 9999)) }
        let seconds = (item["RunTimeTicks"].number ?? 0) / 10_000_000
        let duration = seconds > 0 ? "\(boundedInteger(seconds / 60, maximum: 10_000_000)) 分钟" : nil
        return [year, duration].compactMap { $0 }.joined(separator: " · ")
    }
    static func resumeSeconds(_ item: JSONValue) -> Double {
        let seconds = (item["UserData"]["PlaybackPositionTicks"].number ?? 0) / 10_000_000
        return seconds.isFinite ? min(max(0, seconds), 600_000_000) : 0
    }
    static func time(_ seconds: Double) -> String {
        let total = boundedInteger(seconds, maximum: 600_000_000)
        return total >= 3600 ? String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60)
            : String(format: "%d:%02d", total / 60, total % 60)
    }
    private static func boundedInteger(_ value: Double?, maximum: Double) -> Int {
        guard let value, value.isFinite else { return 0 }
        return Int(min(max(0, value), maximum))
    }
}

/// Explicit launch-only fixtures never read or mutate the production Keychain.
private enum TVFixtures {
    static let libraries: [JSONValue] = [
        container(id: "fixture.movies", name: "电影", type: "CollectionFolder"),
        container(id: "fixture.series", name: "剧集", type: "CollectionFolder"),
    ]
    static let movie: JSONValue = .object([
        "Id": .string("fixture.movie"), "Name": .string("星海远航"), "Type": .string("Movie"),
        "ProductionYear": .number(2026), "RunTimeTicks": .number(6_600 * 10_000_000),
        "Overview": .string("隔离测试内容：检验遥控器焦点、影片详情和返回导航。此内容未连接真实媒体服务器。"),
    ])
    static func episode(_ number: Int) -> JSONValue {
        .object([
            "Id": .string("fixture.episode.\(number)"), "Name": .string(number == 1 ? "启程" : "群星之间"),
            "Type": .string("Episode"), "SeriesName": .string("星海纪事"), "ParentIndexNumber": .number(1),
            "IndexNumber": .number(Double(number)), "RunTimeTicks": .number(2_700 * 10_000_000),
            "Overview": .string("隔离测试剧集，用于检查 SXXEXX 集数标记与继续播放入口。"),
            "UserData": .object(["PlaybackPositionTicks": .number(number == 1 ? 4 * 10_000_000 : 0)]),
        ])
    }
    static func children(of item: JSONValue) -> [JSONValue] {
        switch TVMedia.id(item) {
        case "fixture.movies": [movie]
        case "fixture.series": [container(id: "fixture.show", name: "星海纪事", type: "Series")]
        case "fixture.show": [container(id: "fixture.season", name: "第 1 季", type: "Season")]
        case "fixture.season": [episode(1), episode(2)]
        default: []
        }
    }
    private static func container(id: String, name: String, type: String) -> JSONValue {
        .object(["Id": .string(id), "Name": .string(name), "Type": .string(type), "IsFolder": .bool(true)])
    }
}
