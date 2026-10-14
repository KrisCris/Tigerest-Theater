import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif
public struct DanmakuComment: Codable, Sendable, Equatable {
    public let time: Double
    public let text: String
    public let mode: Int
    public let color: UInt32
    public init(time: Double, text: String, mode: Int = 1, color: UInt32 = 0xffffff) { self.time = time; self.text = text; self.mode = mode; self.color = color }
}
public enum DanmakuParser {
    public static func parse(data: Data, format: String = "auto") throws -> [DanmakuComment] {
        guard data.count <= 16 * 1024 * 1024, let raw = String(data: data, encoding: .utf8) else { throw CoreError.invalidRequest }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn:"\u{FEFF}")))
        var result: [DanmakuComment] = []
        if text.hasPrefix("{") || text.range(of: #"^\[\s*(\{|\])"#, options: .regularExpression) != nil {
            var value = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
            if value["comments"] == .null, value["count"] == .null, let rows=value["danmuku"].array {
                value = .array(rows.prefix(50000).compactMap { row in
                    guard let fields=row.array else { return nil }
                    func field(_ n: Int) -> JSONValue { fields.indices.contains(n) ? fields[n] : .null }
                    let time=field(0).number ?? field(0).string.flatMap(Double.init) ?? 0
                    let mode=field(1).string == "top" ? 4 : field(1).string == "bottom" ? 5 : 1
                    let color=field(2).number.flatMap { $0.isFinite && (0...Double(UInt32.max)).contains($0) ? UInt32($0) : nil } ?? field(2).string.flatMap { UInt32($0.replacingOccurrences(of:"#",with:""),radix:16) } ?? 0xffffff
                    return .object(["p":.string(String(format:"%.2f,%d,%u",locale:Locale(identifier:"en_US_POSIX"),time,mode,color)),"m":field(4) == .null ? field(3) : field(4)])
                })
            }
            result = (value.array ?? value["comments"].array ?? []).prefix(50000).compactMap { item in
                let fields = (item["p"].string ?? "").split(separator:",",omittingEmptySubsequences:false)
                guard let first = fields.first, let time = Double(first) else { return nil }
                return .init(time: time + (item["shift"].number ?? 0), text: item["m"].string ?? item["text"].string ?? "", mode: fields.count > 1 ? Int(fields[1]) ?? 1 : 1, color: fields.count > 2 ? UInt32(fields[2]) ?? 0xffffff : 0xffffff)
            }
        } else if text.hasPrefix("<") {
            guard text.range(of: #"<!\s*(DOCTYPE|ENTITY)"#, options:[.regularExpression,.caseInsensitive]) == nil else { throw CoreError.invalidRequest }
            let delegate = XMLComments(), parser = XMLParser(data: Data(text.utf8))
            parser.shouldResolveExternalEntities = false; parser.delegate = delegate
            guard parser.parse() else { throw CoreError.invalidRequest }; result = delegate.comments
        } else {
            var format = ["layer","start","end","style","name","marginl","marginr","marginv","effect","text"], events = false
            for line in text.components(separatedBy:.newlines) {
                let line = line.trimmingCharacters(in:.whitespaces)
                if line.hasPrefix("[") { events = line.lowercased() == "[events]" }
                guard events, result.count < 50000 else { continue }
                if line.lowercased().hasPrefix("format:") { format = line.dropFirst(7).split(separator:",").map { $0.trimmingCharacters(in:.whitespaces).lowercased() } }
                guard line.lowercased().hasPrefix("dialogue:"), !format.isEmpty else { continue }
                let fields = line.dropFirst(9).split(separator:",",maxSplits:format.count-1,omittingEmptySubsequences:false).map(String.init)
                func field(_ key: String) -> String { guard let i = format.firstIndex(of:key), fields.indices.contains(i) else { return "" }; return fields[i].trimmingCharacters(in:.whitespaces) }
                let parts = field("start").split(separator:":").compactMap { Double($0) }
                guard parts.count == 3 else { continue }
                let content = field("text")
                let mode = content.contains("\\move(") ? 1 : content.range(of:#"\\an[789]"#,options:.regularExpression) != nil ? 5 : content.range(of:#"\\an[123]"#,options:.regularExpression) != nil ? 4 : 1
                var color: UInt32 = 0xffffff
                if let match = content.range(of:#"\\(?:1c|c)&H[0-9A-Fa-f]{6}&"#,options:.regularExpression), let hex = content[match].split(separator:"H").last?.dropLast(), let bgr = UInt32(hex,radix:16) { color = ((bgr & 255) << 16) | (bgr & 0xff00) | ((bgr >> 16) & 255) }
                let clean = content.replacingOccurrences(of:#"\{[^}]*\}"#,with:"",options:.regularExpression).replacingOccurrences(of:"\\N",with:"\n").replacingOccurrences(of:"\\n",with:"\n").replacingOccurrences(of:"\\h",with:" ")
                result.append(.init(time:parts[0]*3600+parts[1]*60+parts[2],text:clean,mode:mode,color:color))
            }
        }
        return result.filter { $0.time.isFinite && $0.time >= 0 && !$0.text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty }.map {
            .init(time:$0.time,text:String($0.text.unicodeScalars.filter { $0.value >= 32 || $0.value == 10 }.prefix(500).map(String.init).joined()),mode:[4,5].contains($0.mode) ? $0.mode : 1,color:$0.color & 0xffffff)
        }.sorted { $0.time < $1.time }
    }
}
private final class XMLComments: NSObject, XMLParserDelegate {
    var comments: [DanmakuComment] = [], fields: [String] = [], text = "", reading = false
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String:String]) {
        if elementName == "d", comments.count < 50000 { fields = (attributes["p"] ?? "").components(separatedBy:","); text = ""; reading = true }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { if reading { text += String(string.prefix(max(0, 500 - text.count))) } }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        guard elementName == "d", reading else { return }; reading = false
        guard let first = fields.first, let time = Double(first) else { return }
        comments.append(.init(time:time,text:text,mode:fields.count>1 ? Int(fields[1]) ?? 1 : 1,color:fields.count>3 ? UInt32(fields[3]) ?? 0xffffff : 0xffffff))
    }
}
public struct DanmakuTimeline: Sendable {
    public let comments: [DanmakuComment]
    public init(_ comments: [DanmakuComment]) { self.comments = comments.sorted { $0.time < $1.time } }
    public func visible(at time: Double, duration: Double) -> [DanmakuComment] {
        var low = 0, high = comments.count
        while low < high { let middle = (low+high)/2; if comments[middle].time < time-duration { low=middle+1 } else { high=middle } }
        var result: [DanmakuComment] = []
        while low < comments.count, comments[low].time <= time, result.count < 200 { result.append(comments[low]); low += 1 }
        return result
    }
}
