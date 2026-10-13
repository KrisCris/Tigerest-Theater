import Foundation
public enum DanmakuMatch {
    public static func choose(works: [JSONValue], title: String, season: Int) -> [JSONValue] {
        let expected = work(title).0
        return works.filter {
            let candidate = work($0["animeTitle"].string ?? "")
            return candidate.0 == expected && (candidate.1 ?? 1) == max(1, season)
        }
    }
    public static func episode(_ episodes: [JSONValue], number: Int, title: String) -> JSONValue? {
        let clean = normalize(title.replacingOccurrences(of: "^第\\s*\\d+\\s*[话話集]\\s*", with: "", options: .regularExpression))
        let regular = episodes.filter { !(($0["episodeTitle"].string ?? "").lowercased().range(of: "^(op|ed|ncop|nced|opening|ending|片头曲|片尾曲)([0-9 ]|$)", options: .regularExpression) != nil) }
        let titled = clean.isEmpty ? [] : regular.filter { normalize($0["episodeTitle"].string ?? "") == clean }
        let matches = titled.isEmpty ? regular.filter { ($0["episodeNumber"].number ?? Double($0["episodeNumber"].string ?? "")) == Double(number) } : titled
        return matches.count == 1 ? matches.first : nil
    }
    private static func work(_ text: String) -> (String, Int?) {
        let title = normalize(text)
        let chinese = ["零","一","二","三","四","五","六","七","八","九"]
        for number in (1...99).reversed() {
            let cn = number < 10 ? chinese[number] : (number >= 20 ? chinese[number/10] : "") + "十" + (number%10 > 0 ? chinese[number%10] : "")
            for suffix in ["第\(number)季", "第\(cn)季", "第\(number)部", "第\(cn)部", "season\(number)", "s\(number)", String(format:"s%02d",number)] where title.hasSuffix(suffix) && title.count > suffix.count { return (String(title.dropLast(suffix.count)), number) }
        }
        return (title, nil)
    }
    private static func normalize(_ text: String) -> String { text.lowercased().filter { $0.isLetter || $0.isNumber } }
}
public struct DanmakuClock: Sendable {
    private var baseTime = 0.0, baseHost = 0.0, previousEpoch: UInt64 = 0
    public init() {}
    public mutating func position(mediaTime: Double, hostTime: Double, playing: Bool, rate: Double, epoch: UInt64) -> Double {
        if epoch != previousEpoch || mediaTime != baseTime || !playing { baseTime = mediaTime; baseHost = hostTime; previousEpoch = epoch }
        return max(0, mediaTime + (playing ? min(0.25, max(0, hostTime - baseHost)) * rate : 0))
    }
}
