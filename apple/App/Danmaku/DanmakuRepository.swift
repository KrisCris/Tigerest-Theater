import Foundation
import AppleCore
@MainActor final class DanmakuRepository: ObservableObject {
    struct Source: Codable, Identifiable {
        let id: String
        let title: String
        let comments: [DanmakuComment]
        var enabled = true
        var delay = 0.0
    }
    unowned let model: AppModel
    @Published var sources: [Source] = []
    @Published var status = ""
    @Published var enabled = true
    private var timelines: [String: DanmakuTimeline] = [:]
    private var generation: UInt64 = 0
    private var job: Task<Void, Never>?
    private var item: JSONValue = .null
    private var cooldown = Date.distantPast
    init(model: AppModel) { self.model = model; enabled = model.settings.get("mpv", "enableDanmaku").bool != false }
    var base: String { (try? ServerAddress(model.settings.get("danmaku", "apiServer").string.flatMap { $0.isEmpty ? nil : $0 } ?? "http://nas.tigerest.top:18443").baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn:"/"))) ?? "http://nas.tigerest.top:18443" }
    private func scalar(_ value: JSONValue) -> String { value.string ?? value.number.map { String(Int($0)) } ?? "" }
    private func fetch(_ path: String) async throws -> JSONValue {
        guard Date() >= cooldown, let url = URL(string: base + path) else { throw CoreError.invalidRequest }
        let (data, response) = try await model.community.data(URLRequest(url: url), limit: 16 * 1024 * 1024)
        guard response.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
    private var cache: URL {
        let key = (item["Id"].string ?? "unknown").unicodeScalars.map { $0.properties.isAlphabetic || CharacterSet.decimalDigits.contains($0) ? String($0) : "_" }.joined()
        return model.profiles.directory.appending(path: "danmaku-" + String(key.prefix(128)) + ".json")
    }
    private func changed() {
        timelines = Dictionary(uniqueKeysWithValues: sources.map { ($0.id, DanmakuTimeline($0.comments)) })
        if item != .null { try? JSONEncoder().encode(sources).write(to: cache, options: .atomic) }
        model.bridge.emit("danmaku", "sourcesChanged", [snapshot])
    }
    private func announce(_ text: String) { status = text; model.bridge.emit("danmaku", "status", [.string(text)]) }
    var snapshot: JSONValue { .array(sources.map { .object(["id": .string($0.id), "title": .string($0.title), "enabled": .bool($0.enabled), "delay": .number($0.delay), "count": .number(Double($0.comments.count))]) }) }
    func clear() { generation &+= 1; job?.cancel(); job = nil; sources = []; timelines = [:]; item = .null; announce("") }
    func autoMatch(_ metadata: JSONValue) {
        clear(); item = metadata
        guard enabled else { return }
        let token = generation
        job = Task { [weak self] in
            guard let self else { return }
            do {
                if try await shared(selection: nil, token: token) { return }
                guard token == generation, !Task.isCancelled else { return }
                if let data = try? Data(contentsOf: cache), data.count <= 32 * 1024 * 1024, let saved = try? JSONDecoder().decode([Source].self, from: data), !saved.isEmpty { sources = Array(saved.prefix(12)); changed(); return }
                let title = metadata["SeriesName"].string ?? metadata["Name"].string ?? ""
                guard !title.isEmpty else { return }
                let works = try await search(title)
                let candidates = DanmakuMatch.choose(works: works, title: title, season: Int(metadata["ParentIndexNumber"].number ?? 1))
                var matches: [(JSONValue, JSONValue)] = []
                for work in candidates.prefix(6) {
                    let records = try await episodes(scalar(work["bangumiId"]))
                    if let episode = DanmakuMatch.episode(records, number: Int(metadata["IndexNumber"].number ?? 1), title: metadata["Name"].string ?? "") { matches.append((work,episode)) }
                }
                guard token == generation, !Task.isCancelled else { return }
                if matches.count == 1, let (work,episode) = matches.first { _ = try await load(scalar(episode["episodeId"]), title: work["animeTitle"].string ?? title, token: token) }
                else { announce("未自动匹配弹幕，请搜索作品后选择集数") }
            } catch { if token == generation, !Task.isCancelled { announce("弹幕暂不可用，可稍后手动搜索或导入") } }
        }
    }
    func search(_ keyword: String) async throws -> [JSONValue] {
        guard !keyword.isEmpty, keyword.count <= 200 else { throw CoreError.invalidRequest }
        let encoded = keyword.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed.subtracting(CharacterSet(charactersIn:"&+=?#")))!
        return try await fetch("/api/v2/search/anime?keyword=" + encoded)["animes"].array ?? []
    }
    func episodes(_ id: String) async throws -> [JSONValue] {
        guard id.range(of:"^(?:[0-9]+|tmdb-[A-Za-z0-9-]+)$",options:.regularExpression) != nil, id.count <= 100 else { throw CoreError.invalidRequest }
        return try await fetch("/api/v2/bangumi/" + id)["bangumi"]["episodes"].array ?? []
    }
    @discardableResult func load(_ id: String, title: String, token: UInt64? = nil) async throws -> Int {
        guard id.range(of:"^[0-9]{1,32}$",options:.regularExpression) != nil else { throw CoreError.invalidRequest }
        let token = token ?? generation
        let value = try await fetch("/api/v2/comment/\(id)?withRelated=true&chConvert=0")
        let comments = try DanmakuParser.parse(data: JSONEncoder().encode(value))
        guard token == generation, !Task.isCancelled else { throw CancellationError() }
        add(id, title, comments); return comments.count
    }
    func select(_ episode: JSONValue, work: JSONValue, share: Bool) async throws {
        let token = generation, id = scalar(episode["episodeId"])
        job?.cancel()
        if share {
            guard try await shared(selection:.object(["bangumiId":.string(scalar(work["bangumiId"])),"episodeId":.string(id)]),token:token) else { throw CoreError.invalidRequest }
        } else { _ = try await load(id, title:(work["animeTitle"].string ?? "") + " · " + (episode["episodeTitle"].string ?? ""), token:token) }
    }
    private func shared(selection: JSONValue?, token: UInt64) async throws -> Bool {
        guard ["http://nas.tigerest.top:18443", "https://nas.tigerest.top:18443", "http://192.168.5.150:18443", "https://192.168.5.150:18443"].contains(base),
              let title = item["SeriesName"].string, let season = item["ParentIndexNumber"].number, let episode = item["IndexNumber"].number, (1...1000).contains(season), (1...10000).contains(episode), Date() >= cooldown else { return false }
        var body: [String:JSONValue] = ["source":.object(["title":.string(title),"season":.number(season),"episode":.number(episode)]),"comment":.object(["withRelated":.bool(true),"chConvert":.number(0)])]
        var request = URLRequest(url:URL(string:base+"/api/tigerest/v1/danmaku")!); request.httpMethod = "POST"
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let selection {
            guard !model.community.mappingHeaders.isEmpty else { return false }
            body["selection"] = selection
            for (name,value) in model.community.mappingHeaders { request.setValue(value,forHTTPHeaderField:name) }
        }
        request.httpBody = try JSONEncoder().encode(body)
        let (data,response) = try await model.community.data(request,limit:16*1024*1024)
        if response.statusCode == 429 { cooldown = Date().addingTimeInterval(max(1,Double(response.value(forHTTPHeaderField:"Retry-After") ?? "60") ?? 60)); throw URLError(.resourceUnavailable) }
        guard token == generation, !Task.isCancelled else { throw CancellationError() }
        guard response.statusCode == 200, let value = try? JSONDecoder().decode(JSONValue.self,from:data), value["success"].bool == true, value["matched"].bool == true, value["match"]["origin"].string == (selection == nil ? "shared" : "manual") else { return false }
        let comments = try DanmakuParser.parse(data: JSONEncoder().encode(value["danmaku"]))
        add(scalar(value["match"]["episodeId"]), value["match"]["episodeTitle"].string ?? title, comments)
        return true
    }
    private func add(_ id: String, _ title: String, _ comments: [DanmakuComment]) {
        let previous = sources.first { $0.id == id }
        sources.removeAll { $0.id == id }; if sources.count >= 12 { sources.removeFirst() }
        sources.append(Source(id:id,title:title,comments:comments,enabled:previous?.enabled ?? true,delay:previous?.delay ?? 0)); changed(); announce("已载入 \(comments.count) 条弹幕")
    }
    func importData(_ data: Data, name: String) throws { add(UUID().uuidString,name,try DanmakuParser.parse(data:data)) }
    func setSource(_ id: String, enabled: Bool, delay: Double) throws {
        guard delay.isFinite, abs(delay) <= 3600, let index = sources.firstIndex(where: { $0.id == id }) else { throw CoreError.invalidRequest }
        sources[index].enabled = enabled; sources[index].delay = delay; changed()
    }
    func visible(at time: Double, duration: Double) -> [DanmakuComment] {
        guard enabled else { return [] }
        return sources.filter(\.enabled).flatMap { source in (timelines[source.id]?.visible(at:time-source.delay,duration:duration) ?? []).map { .init(time:$0.time+source.delay,text:$0.text,mode:$0.mode,color:$0.color) } }.sorted { $0.time < $1.time }
    }
    func dispatch(_ method: String, _ args: [JSONValue]) async throws -> JSONValue {
        func arg(_ n: Int) -> JSONValue { args.indices.contains(n) ? args[n] : .null }
        switch method {
        case "search": return .array(try await search(arg(0).string ?? ""))
        case "episodes": return .array(try await episodes(scalar(arg(0))))
        case "match": autoMatch(arg(0)); return .bool(true)
        case "load": return .number(Double(try await load(scalar(arg(0)),title:arg(1).string ?? "弹幕")))
        case "sources": return snapshot
        case "setSource": try setSource(arg(0).string ?? "",enabled:arg(1).bool ?? true,delay:arg(2).number ?? 0); return .bool(true)
        case "setEnabled": enabled = arg(0).bool ?? false; try model.settings.set("mpv","enableDanmaku",.bool(enabled)); return .bool(true)
        case "loadUrl":
            guard let url = arg(0).string, let parsed = URL(string:url), ["http","https"].contains(parsed.scheme), parsed.user == nil else { throw CoreError.invalidAddress }
            let token = generation
            let value = try await fetch("/api/v2/extcomment?url=" + (url.addingPercentEncoding(withAllowedCharacters:.alphanumerics) ?? ""))
            let comments = try DanmakuParser.parse(data:JSONEncoder().encode(value))
            guard token == generation else { throw CancellationError() }; add(url,parsed.host ?? "网址弹幕",comments); return .number(Double(comments.count))
        default: throw CoreError.invalidRequest
        }
    }
}
