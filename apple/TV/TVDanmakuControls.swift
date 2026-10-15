import SwiftUI
import AppleCore

/// The catalog and selection contract are shared with iPad; only focusable TV
/// controls differ. Shared correction requires a deliberate opt-in each visit.
struct TVDanmakuControls: View {
    @ObservedObject var repository: DanmakuRepository
    @Environment(\.dismiss) private var dismiss
    @State private var keyword = ""
    @State private var sourceURL = ""
    @State private var works: [JSONValue] = []
    @State private var episodes: [JSONValue] = []
    @State private var work: JSONValue = .null
    @State private var busy = false
    @State private var message = ""
    @State private var share = false
    @State private var operation: Task<Void, Never>?
    @State private var operationID = UUID()

    var body: some View {
        NavigationStack {
            List {
                Section("当前视频") {
                    Toggle("启用弹幕", isOn: Binding(get: { repository.enabled }, set: { enabled in
                        run { _ = try await repository.dispatch("setEnabled", [.bool(enabled)]) }
                    })).disabled(busy).accessibilityIdentifier("tv.danmaku.enabled")
                    Button("重新自动匹配") { repository.refresh() }
                        .disabled(busy || !repository.enabled).accessibilityIdentifier("tv.danmaku.refresh")
                    if !repository.status.isEmpty { Text(repository.status).foregroundStyle(.secondary) }
                }
                Section("手动搜索与选集") {
                    TextField("搜索作品", text: $keyword).onSubmit(search)
                        .accessibilityIdentifier("tv.danmaku.query")
                    Button("搜索") { search() }.disabled(busy || keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("tv.danmaku.search")
                    Text("动画输入作品名；电视剧可输入“名称|tv”，电影可输入“名称|dy”。")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(works.enumerated()), id: \.offset) { index, candidate in
                        Button {
                            episodes = []; work = candidate
                            run {
                                let result = try await repository.episodes(for: candidate)
                                try Task.checkCancellation(); episodes = result
                                if result.isEmpty { message = "此作品暂无可选择的集数。" }
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(candidate["animeTitle"].string ?? "作品")
                                if let hint = candidate["typeDescription"].string { Text(hint).font(.caption).foregroundStyle(.secondary) }
                            }
                        }.disabled(busy).accessibilityIdentifier("tv.danmaku.work.\(index)")
                    }
                }
                if !episodes.isEmpty {
                    Section(work["animeTitle"].string ?? "选择集数") {
                        if work["_extra"] == .null {
                            Toggle("同时纠正共享匹配", isOn: $share).disabled(busy)
                                .accessibilityIdentifier("tv.danmaku.share")
                            Text("仅开启此项后，所选集数才会提交到共享服务；需要当前服务器账号具有权限。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(Array(episodes.enumerated()), id: \.offset) { index, episode in
                            Button(episode["episodeTitle"].string ?? DanmakuMatch.scalar(episode["episodeId"])) {
                                let selectedWork = work, shouldShare = share
                                run { try await repository.select(episode, work: selectedWork, share: shouldShare) }
                            }.disabled(busy).accessibilityIdentifier("tv.danmaku.episode.\(index)")
                        }
                    }
                }
                if !repository.sources.isEmpty {
                    Section("已加载来源") {
                        ForEach(repository.sources) { source in
                            VStack(alignment: .leading, spacing: 16) {
                                Toggle(source.title, isOn: Binding(get: {
                                    repository.sources.first { $0.id == source.id }?.enabled ?? false
                                }, set: { enabled in updateSource(source.id, enabled: enabled) }))
                                Text("\(source.comments.count) 条 · 偏移 \(source.delay, specifier: "%.1f") 秒")
                                    .font(.caption).foregroundStyle(.secondary)
                                HStack(spacing: 24) {
                                    Button("提前 0.5 秒") { updateSource(source.id, delta: -0.5) }.disabled(source.delay <= -3600)
                                    Button("延后 0.5 秒") { updateSource(source.id, delta: 0.5) }.disabled(source.delay >= 3600)
                                    Button("重置偏移") { updateSource(source.id, reset: true) }.disabled(source.delay == 0)
                                }
                            }.disabled(busy)
                        }
                    }
                }
                Section("从网址加载") {
                    TextField("弹幕来源网址", text: $sourceURL).keyboardType(.URL).textInputAutocapitalization(.never)
                    Button("加载网址") {
                        let url = sourceURL.trimmingCharacters(in: .whitespacesAndNewlines)
                        run { _ = try await repository.dispatch("loadUrl", [.string(url)]) }
                    }.disabled(busy || sourceURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if busy { ProgressView("正在获取弹幕…") }
                if !message.isEmpty { Text(message).foregroundStyle(.yellow) }
                Button("完成") { dismiss() }.accessibilityIdentifier("tv.danmaku.done")
            }
            .navigationTitle("弹幕")
            .background(Color(red: 0.035, green: 0.043, blue: 0.055).ignoresSafeArea())
        }
        .background(Color(red: 0.035, green: 0.043, blue: 0.055).ignoresSafeArea())
        .onExitCommand { dismiss() }
        .onAppear { keyword = repository.searchTitle }
        .onDisappear { operationID = UUID(); operation?.cancel(); operation = nil; busy = false }
    }

    private func search() {
        guard !busy else { return }
        let query = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        works = []; episodes = []; work = .null
        run {
            let result = try await repository.search(query)
            try Task.checkCancellation(); works = result
            if result.isEmpty { message = "未找到对应作品，请尝试其他名称。" }
        }
    }
    private func updateSource(_ id: String, enabled: Bool? = nil, delta: Double = 0, reset: Bool = false) {
        guard let source = repository.sources.first(where: { $0.id == id }) else { return }
        do { try repository.setSource(id, enabled: enabled ?? source.enabled, delay: reset ? 0 : min(3600, max(-3600, source.delay + delta))) }
        catch { message = "未能更新来源，请重新选择。" }
    }
    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true; message = ""
        let id = UUID(); operationID = id
        operation = Task { @MainActor in
            defer { if operationID == id { busy = false; operation = nil } }
            do { try await action() }
            catch is CancellationError {}
            catch { if !Task.isCancelled { message = "弹幕操作失败，请检查网络、权限和所选集数。" } }
        }
    }
}
