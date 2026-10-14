import SwiftUI
import AppleCore
struct DanmakuControls: View {
    @ObservedObject var repository: DanmakuRepository
    @Environment(\.dismiss) private var dismiss
    @State private var keyword = ""
    @State private var url = ""
    @State private var works: [JSONValue] = []
    @State private var episodes: [JSONValue] = []
    @State private var work: JSONValue = .null
    @State private var busy = false
    @State private var error = ""
    @State private var importing = false
    @State private var share = true
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("启用弹幕",isOn:Binding(get:{repository.enabled},set:{ value in run { _ = try await repository.dispatch("setEnabled",[.bool(value)]) } }))
                    Button("重新匹配当前视频") { repository.refresh() }.disabled(busy || !repository.enabled)
                    if !repository.status.isEmpty { Text(repository.status).font(.caption).foregroundStyle(.secondary) }
                }
                Section("作品与集数") {
                    Text("动画直接输入名称；其他作品可按 PC 端格式输入：名称|tv（电视剧）、名称|dy（电影）。").font(.caption).foregroundStyle(.secondary)
                    HStack { TextField("搜索作品",text:$keyword); Button("搜索") { episodes = []; work = .null; run { works = try await repository.search(keyword) } }.disabled(busy || keyword.isEmpty) }
                    ForEach(Array(works.enumerated()),id:\.offset) { _, candidate in
                        Button { episodes = []; work = candidate; run { episodes = try await repository.episodes(for:candidate) } } label: {
                            VStack(alignment:.leading) {
                                Text(candidate["animeTitle"].string ?? "作品")
                                if let hint=candidate["typeDescription"].string {Text(hint).font(.caption).foregroundStyle(.secondary)}
                            }
                        }.disabled(busy)
                    }
                    if !episodes.isEmpty {
                        if work["_extra"] == .null {
                            Toggle("同时纠正共享匹配",isOn:$share)
                            Text("开启后，你选择的集数会提交到弹幕共享服务；需要服务器账号具有权限。").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(Array(episodes.enumerated()),id:\.offset) { _, episode in
                            Button(episode["episodeTitle"].string ?? id(episode["episodeId"])) { let selectedWork=work, shouldShare=share; run { try await repository.select(episode,work:selectedWork,share:shouldShare) } }.disabled(busy)
                        }
                    }
                }
                Section("导入") {
                    Button("从文件导入 XML / JSON / ASS") { importing = true }
                    TextField("弹幕来源网址",text:$url).textInputAutocapitalization(.never).keyboardType(.URL)
                    Button("加载网址") { run { _ = try await repository.dispatch("loadUrl",[.string(url)]) } }.disabled(url.isEmpty || busy)
                }
                Section("已加载的来源") {
                    ForEach(repository.sources) { source in
                        Toggle(source.title,isOn:Binding(get:{repository.sources.first { $0.id == source.id }?.enabled ?? false},set:{ value in try? repository.setSource(source.id,enabled:value,delay:source.delay) }))
                        Stepper("偏移 \(source.delay,specifier:"%.1f") 秒 · \(source.comments.count) 条", value:Binding(get:{source.delay},set:{ try? repository.setSource(source.id,enabled:source.enabled,delay:$0) }),in:-3600...3600,step:0.5)
                    }
                }
                if busy { ProgressView() }
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
            }.navigationTitle("弹幕").toolbar { Button("完成") { dismiss() } }
        }.onAppear { keyword = repository.searchTitle }.fileImporter(isPresented:$importing,allowedContentTypes:[.data]) { result in
            do {
                let source=try result.get(), granted=source.startAccessingSecurityScopedResource(); defer { if granted { source.stopAccessingSecurityScopedResource() } }
                guard (try source.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0 <= 16*1024*1024 else { throw CoreError.invalidRequest }
                try repository.importData(Data(contentsOf:source),name:source.lastPathComponent)
            } catch { self.error = "弹幕文件导入失败" }
        }
    }
    private func id(_ value: JSONValue) -> String { value.string ?? value.number.map { String(Int($0)) } ?? "" }
    private func run(_ action: @escaping @MainActor () async throws -> Void) { guard !busy else {return}; busy=true; error=""; Task { do { try await action() } catch { self.error = "弹幕操作失败，请检查网络、权限和所选集数" }; busy=false } }
}
