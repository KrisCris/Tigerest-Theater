import SwiftUI
import AppleCore
import CryptoKit
import Security

private actor TVCommentTokenStore: CommunityTokenStore {
    private let account: String
    init(session: EmbySession) {
        account = SHA256.hash(data: Data((session.serverURL + "|" + session.userID).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "top.tigerest.theater.tv.community", kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false] }
    private var tombstone: String { "tv.community.revoked." + account }
    func read() throws -> Data? {
        guard !UserDefaults.standard.bool(forKey: tombstone) else { return nil }
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }; guard status == errSecSuccess else { throw CoreError.invalidRequest }; return result as? Data
    }
    func write(_ data: Data?) throws {
        guard let data else {
            // A failed Keychain deletion must not resurrect this identity next launch.
            // Only this non-sensitive revocation marker lives outside Keychain.
            UserDefaults.standard.set(true, forKey: tombstone)
            let code = SecItemDelete(query as CFDictionary)
            guard code == errSecSuccess || code == errSecItemNotFound else { throw CoreError.invalidRequest }
            return
        }
        let code = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if code == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw CoreError.invalidRequest }
        } else if code != errSecSuccess { throw CoreError.invalidRequest }
        UserDefaults.standard.removeObject(forKey: tombstone)
    }
}

@MainActor private final class TVCommentsModel: ObservableObject {
    @Published var channel: CommunityChannel = .publicCommunity
    @Published var scope: String
    @Published var privateAvailable = false
    @Published var comments: [JSONValue] = []
    @Published var nextCursor: String?
    @Published var title = ""
    @Published var status = ""
    @Published var busy = false
    @Published private(set) var hasLoadedComments = false
    @Published var loginRequired = false
    @Published var draft = ""
    @Published var reply: JSONValue?
    @Published var me: JSONValue = .null
    @Published private(set) var item: JSONValue
    private let emby: EmbyClient
    private let community: CommunityClient
    private var hasDiscovered = false
    private var hasSelectedChannel = false
    private var started = false
    private var series: JSONValue = .null
    private var topic: JSONValue = .null
    private var job: Task<Void, Never>?
    private var generation = UUID()
    private var drafts: [String: (String, JSONValue?)] = [:]
    private var key: String { channel.rawValue + ":" + scope }
    var canSend: Bool { !busy && !loginRequired && me["muted"].bool != true && topic["id"].string != nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.unicodeScalars.count <= 2000 }

    init(item: JSONValue, client: EmbyClient, session: EmbySession, community: CommunityClient? = nil) {
        self.item = item; self.emby = client; scope = item["Type"].string == "Episode" ? "episode" : "work"
        self.community = community ?? CommunityClient(emby: session, store: TVCommentTokenStore(session: session))
    }
    func start() { started = true; refresh() }
    func updateItem(_ item: JSONValue) {
        guard item["Id"] == self.item["Id"], item != self.item else { return }
        if item["SeriesId"] != self.item["SeriesId"] { series = .null }
        self.item = item
        if started { refresh() }
    }
    func select(channel: CommunityChannel? = nil, scope: String? = nil) {
        if channel != nil { hasSelectedChannel = true }
        updateSelection(channel: channel, scope: scope)
        comments = []; nextCursor = nil; topic = .null; me = .null; hasLoadedComments = false
        run { try await self.load($0, reset: true) }
    }
    private func updateSelection(channel: CommunityChannel? = nil, scope: String? = nil) {
        drafts[key] = (draft, reply)
        if let channel { self.channel = channel }; if let scope { self.scope = scope }
        (draft, reply) = drafts[key] ?? ("", nil)
    }
    func refresh() { run { try await self.load($0, reset: true) } }
    private func load(_ id: UUID, reset: Bool) async throws {
        guard current(id) else { return }
        if reset { hasLoadedComments = false }
        // A failed prerequisite remains retryable by refresh or a channel change.
        if !hasDiscovered {
            let available = try await community.privateAvailable()
            guard current(id) else { return }
            privateAvailable = available; hasDiscovered = true
            if !hasSelectedChannel { updateSelection(channel: available ? .privateServer : .publicCommunity) }
        }
        let channel = channel, scope = scope
        if channel == .publicCommunity, series == .null,
           ["Episode", "Season"].contains(item["Type"].string ?? ""), let seriesID = item["SeriesId"].string {
            let series = try await emby.item(id: seriesID)
            guard current(id) else { return }
            self.series = series
        }
        let me = try await community.me(channel: channel)
        let topic = try await community.resolve(item: item, series: series, scope: scope, channel: channel)
        guard current(id), let topicID = topic["id"].string else { return }
        let page = try await community.comments(topicID: topicID, itemID: item["Id"].string ?? "", channel: channel, cursor: reset ? nil : nextCursor)
        guard current(id) else { return }
        self.me = me; self.topic = topic; self.loginRequired = false; self.title = topic["title"].string ?? item["Name"].string ?? ""
        merge(page["items"].array ?? [], reset: reset); nextCursor = page["nextCursor"].string; hasLoadedComments = true
        status = me["muted"].bool == true ? "你已被禁言，可浏览评论。" : "以 \(me["author"]["name"].string ?? "当前账号") 的身份发言"
    }
    func more() { guard nextCursor != nil else { return }; run { try await self.load($0, reset: false) } }
    func moreReplies(_ comment: JSONValue) {
        guard let cursor = comment["repliesNextCursor"].string, let rootID = comment["id"].string else { return }
        run { id in
            let page = try await self.community.replies(rootID: rootID, itemID: self.item["Id"].string ?? "", channel: self.channel, cursor: cursor)
            guard self.current(id), let index = self.comments.firstIndex(where: { $0["id"].string == rootID }), var fields = self.comments[index].object else { return }
            let existing = fields["replies"]?.array ?? [], ids = Set(existing.compactMap { $0["id"].string })
            fields["replies"] = .array(existing + (page["items"].array ?? []).filter { !ids.contains($0["id"].string ?? "") }); fields["repliesNextCursor"] = page["nextCursor"]
            self.comments[index] = .object(fields)
        }
    }
    func send() {
        guard canSend, let topicID = topic["id"].string else { return }
        let text = draft, reply = reply, channel = channel
        run { id in
            _ = try await self.community.send(topicID: topicID, itemID: self.item["Id"].string ?? "", channel: channel, text: text, reply: reply)
            guard self.current(id) else { return }
            self.draft = ""; self.reply = nil; self.drafts[self.key] = nil; self.status = "已发送"
            // A successful write is not made to look failed by a later read error.
            do { try await self.load(id, reset: true) } catch { if self.current(id) { self.status = "已发送，列表暂未刷新，请稍后重试。" } }
        }
    }
    func remove(_ comment: JSONValue) {
        guard comment["permissions"]["canDelete"].bool == true, let commentID = comment["id"].string else { return }
        run { id in
            try await self.community.remove(commentID: commentID, itemID: self.item["Id"].string ?? "", channel: self.channel)
            guard self.current(id) else { return }; self.status = "已删除"
            do { try await self.load(id, reset: true) } catch { if self.current(id) { self.status = "已删除，列表暂未刷新，请稍后重试。" } }
        }
    }
    func login(username: String, password: String) {
        run { id in try await self.community.login(username: username, password: password); try await self.load(id, reset: true) }
    }
    func close() { started = false; generation = UUID(); job?.cancel(); job = nil; busy = false }
    private func current(_ id: UUID) -> Bool { generation == id && !Task.isCancelled }
    private func merge(_ items: [JSONValue], reset: Bool) {
        let prior = reset ? [] : comments, ids = Set(prior.compactMap { $0["id"].string })
        comments = prior + items.filter { !ids.contains($0["id"].string ?? "") }
    }
    private func run(_ work: @escaping @MainActor (UUID) async throws -> Void) {
        job?.cancel(); let id = UUID(); generation = id; busy = true; status = "正在加载…"
        job = Task { [weak self] in
            guard let self else { return }
            do { try await work(id) }
            catch { if current(id) { status = error.localizedDescription; loginRequired = ["LOGIN_REQUIRED", "AUTH_REQUIRED", "AUTH_INVALID"].contains((error as? CommunityError)?.code ?? "") } }
            if current(id) { busy = false }
        }
    }
}

struct TVCommentsView: View {
    @StateObject private var model: TVCommentsModel
    private let item: JSONValue
    private let focusRequest: Int
    @FocusState private var focused: String?
    @State private var username = ""
    @State private var password = ""
    @State private var deleting: JSONValue?

    init(item: JSONValue, client: EmbyClient, session: EmbySession, focusRequest: Int = 0) {
        self.item = item; self.focusRequest = focusRequest
        _model = StateObject(wrappedValue: TVCommentsModel(item: item, client: client, session: session))
    }

    // The detail owns vertical scrolling and the exit command. This section
    // contributes focus targets directly to that same reading surface.
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text("评论区").font(.system(size: 30, weight: .bold))
                    .focusable().focused($focused, equals: "tv.comments.heading")
                    .accessibilityIdentifier("tv.comments.section")
                Spacer()
                Button("刷新评论") { model.refresh() }.disabled(model.busy)
                    .accessibilityIdentifier("tv.comments.refresh")
            }.focusSection()
            HStack(spacing: 22) {
                if model.privateAvailable {
                    Button(model.channel == .privateServer ? "✓ 专属评论" : "专属评论") { model.select(channel: .privateServer) }
                        .accessibilityIdentifier("tv.comments.private")
                }
                Button(model.channel == .publicCommunity ? "✓ 公共评论" : "公共评论") { model.select(channel: .publicCommunity) }
                    .accessibilityIdentifier("tv.comments.public")
                Spacer()
                if model.item["Type"].string == "Episode" {
                    Button(model.scope == "episode" ? "✓ 本集评论" : "本集评论") { model.select(scope: "episode") }
                        .accessibilityIdentifier("tv.comments.episode")
                }
                Button(model.scope == "work" ? "✓ 作品评论" : "作品评论") { model.select(scope: "work") }
                    .accessibilityIdentifier("tv.comments.work")
            }.disabled(model.busy).focusSection()
            if !model.title.isEmpty { Text(model.title).font(.title3).lineLimit(2) }
            HStack {
                if model.busy { ProgressView() }
                Text(model.status).font(.callout).foregroundStyle(.secondary)
                    .accessibilityIdentifier("tv.comments.status")
            }
            if model.loginRequired {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        TextField("评论账号", text: $username).textContentType(.username)
                            .accessibilityIdentifier("tv.comments.username")
                        SecureField("评论密码", text: $password).textContentType(.password)
                            .accessibilityIdentifier("tv.comments.password")
                        Button("登录评论账号") {
                            let secret = password; password = ""; model.login(username: username, password: secret)
                        }.disabled(model.busy || username.isEmpty || password.isEmpty)
                            .accessibilityIdentifier("tv.comments.login")
                    }
                    Text("自建服务器的 Emby 密码不会发送给公共评论服务。请使用已有的评论账号。")
                        .font(.caption).foregroundStyle(.secondary)
                }.focusSection()
            } else {
                composer
                LazyVStack(alignment: .leading, spacing: 20) {
                    if model.hasLoadedComments && model.comments.isEmpty && !model.busy {
                        Text("还没有评论").foregroundStyle(.secondary).padding(24)
                            .accessibilityIdentifier("tv.comments.empty")
                    }
                    ForEach(model.comments, id: \.commentID) { comment in
                        VStack(alignment: .leading, spacing: 16) {
                            row(comment)
                            ForEach(comment["replies"].array ?? [], id: \.commentID) { reply in row(reply).padding(.leading, 50) }
                            if comment["repliesNextCursor"].string != nil {
                                Button("更多回复") { model.moreReplies(comment) }.disabled(model.busy)
                                    .accessibilityIdentifier("tv.comments.moreReplies." + comment.commentID)
                            }
                        }
                        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 16))
                    }
                    if model.nextCursor != nil {
                        Button("下一页评论") { model.more() }.disabled(model.busy)
                            .accessibilityIdentifier("tv.comments.more")
                    }
                }.id("tv.comments.list")
            }
        }
        .padding(28).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 16))
        .tint(Color(red: 0.82, green: 0.68, blue: 0.38))
        .onAppear { model.start() }.onDisappear { model.close() }
        .onChange(of: item) { _, item in model.updateItem(item) }
        .onChange(of: focusRequest) { _, _ in focused = "tv.comments.heading" }
        .alert("删除这条评论？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("取消", role: .cancel) { deleting = nil }
            Button("删除", role: .destructive) { if let deleting { model.remove(deleting) }; deleting = nil }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let reply = model.reply {
                HStack {
                    Text("回复 @" + (reply["author"]["name"].string ?? ""))
                    Button("取消回复") { model.reply = nil }
                        .accessibilityIdentifier("tv.comments.cancelReply")
                }
            }
            HStack {
                TextField("写下评论（最多 2000 字）", text: $model.draft)
                    .focused($focused, equals: "tv.comments.draft")
                    .accessibilityIdentifier("tv.comments.draft")
                Button("发送") { model.send() }.disabled(!model.canSend)
                    .accessibilityIdentifier("tv.comments.send")
            }.disabled(model.busy || model.me["muted"].bool == true)
        }.focusSection()
    }

    private func row(_ comment: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(comment["author"]["name"].string ?? "用户").font(.headline)
                Text(comment["createdAt"].string?.prefix(16).replacingOccurrences(of: "T", with: " ") ?? "")
                    .font(.caption).foregroundStyle(.secondary)
            }
            TVCommentBody(text: comment["state"].string == "visible" ? (comment["replyToAuthor"]["name"].string.map { "回复 @\($0)：" } ?? "") + (comment["body"].string ?? "") : "评论已删除")
                .accessibilityIdentifier("tv.comments.body." + comment.commentID)
            HStack {
                if comment["permissions"]["canReply"].bool == true {
                    Button("回复") { model.reply = comment; focused = "tv.comments.draft" }
                        .disabled(model.busy || model.me["muted"].bool == true)
                        .accessibilityIdentifier("tv.comments.reply." + comment.commentID)
                }
                if comment["permissions"]["canDelete"].bool == true {
                    Button("删除") { deleting = comment }.disabled(model.busy)
                        .accessibilityIdentifier("tv.comments.delete." + comment.commentID)
                }
            }
        }
    }
}

private extension JSONValue {
    var commentID: String { self["id"].string ?? "" }
}

/// Keep each focus target shorter than the reading viewport. Focusing successive
/// segments scrolls even very long comments, including read-only/deleted rows.
private struct TVCommentBody: View {
    let text: String
    private var segments: [String] {
        var result: [String] = [], segment = "", lineBreaks = 0
        for character in text {
            segment.append(character)
            if character.isNewline { lineBreaks += 1 }
            if segment.count >= 160 || lineBreaks >= 3 {
                result.append(segment); segment = ""; lineBreaks = 0
            }
        }
        if !segment.isEmpty { result.append(segment) }
        return result
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                TVCommentReadingSegment(text: segment)
            }
        }
    }
}

private struct TVCommentReadingSegment: View {
    let text: String
    @FocusState private var focused: Bool
    var body: some View {
        Text(text).font(.body).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading).padding(10)
            .background(focused ? Color.white.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8))
            .focusable().focused($focused)
    }
}
