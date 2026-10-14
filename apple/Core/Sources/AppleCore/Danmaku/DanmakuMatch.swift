import Foundation
/// Port of uosc_danmaku/apis/dandanplay.lua match_anime/match_episode.
/// Keep provider identity, work score and title priority until the final choice.
public enum DanmakuMatch {
    public struct Work: Sendable { public let value: JSONValue; public let score: Double }
    public struct Candidate: Sendable {
        public let work: JSONValue, episode: JSONValue
        public let score: Double, byTitle: Bool
        public init(work: JSONValue, episode: JSONValue, score: Double, byTitle: Bool) { self.work=work;self.episode=episode;self.score=score;self.byTitle=byTitle }
    }
    public static func ranked(works: [JSONValue], title: String, season: Int?, includeUnmatched: Bool = false) -> [Work] {
        let (base, querySeason)=work(title)
        let type = title.contains("OVA") || title.contains("OAD") ? "ova" : "tvseries"
        var seen=Set<String>()
        func cleaned(_ value:String) -> String {
            value.trimmingCharacters(in:.whitespacesAndNewlines)
                .replacingOccurrences(of:#"\s*\([^)]*\)\s*$|\s*【[^】]*】.*$"#,with:"",options:.regularExpression)
        }
        return works.compactMap { anime -> Work? in
            guard anime["type"].string==type, !base.isEmpty else { return nil }
            let id=scalar(anime["bangumiId"]), provider=anime["_server"].string ?? ""
            guard !id.isEmpty, seen.insert(provider+"\u{0}"+id).inserted else { return nil }
            let raw=cleaned(anime["animeTitle"].string ?? "")
            let (candidate, explicit)=work(raw), special=raw.range(of:"ova|oad|special|特别篇|特別篇|番外",options:[.regularExpression,.caseInsensitive]) != nil
            guard !candidate.isEmpty else { return nil }
            if let querySeason, let season, season>0, querySeason != season { return nil }
            if season==0 && !special { return nil }
            if let season, season>0, special, title.range(of:"ova|oad",options:[.regularExpression,.caseInsensitive]) == nil { return nil }
            // The primary release title gates season eligibility. A generic
            // alias may never turn a second season into a first season match.
            if let explicit, let season, explicit != season { return nil }
            if let season, season>1, explicit != season { return nil }
            let names=[raw]+(anime["titles"].array ?? []).compactMap{$0["title"].string}.map(cleaned)
            let score=names.compactMap { name -> Double? in
                let (candidate, aliasSeason)=work(name)
                guard !candidate.isEmpty else {return nil}
                if let aliasSeason,let season,aliasSeason != season {return nil}
                let specialTitle=normalize(name.replacingOccurrences(of:"ova|oad|special|特别篇|特別篇|番外",with:"",options:[.regularExpression,.caseInsensitive]))
                return (aliasSeason != nil && base==candidate) || (season==0 && specialTitle==base) ? 1 : similarity(base,candidate)
            }.max() ?? 0
            return includeUnmatched || score>=0.85 ? Work(value:anime,score:score) : nil
        }.sorted { $0.score>$1.score }
    }
    public static func choose(works: [JSONValue], title: String, season: Int) -> [JSONValue] { ranked(works:works,title:title,season:season).map(\.value) }
    /// Below the primary-title threshold only detail aliases can admit a release.
    /// Same bound as the PC matcher: every strong title, at most five weak releases per provider.
    public static func detailLookups(_ ranked: [Work], weakLimit: Int = 5) -> [Work] {
        var weakReads=[String:Int]()
        return ranked.filter { work in
            guard work.score<0.85 else { return true }
            let provider=work.value["_server"].string ?? ""
            weakReads[provider, default:0] += 1
            return weakReads[provider, default:0]<=weakLimit
        }
    }
    public static func episodes(_ episodes: [JSONValue], number: Int, title: String) -> (values: [JSONValue], byTitle: Bool) {
        let expected=episodeTitle(title)
        var seen=Set<String>()
        let regular=episodes.filter {
            let id=scalar($0["episodeId"]), raw=$0["episodeTitle"].string ?? "", name=episodeTitle(raw)
            guard !id.isEmpty, !raw.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,
                  let n=$0["episodeNumber"].number ?? Double($0["episodeNumber"].string ?? ""), n.isFinite, n>=0 else { return false }
            let credit=name.range(of:#"^(op$|ed$|opening$|ending$|op[0-9]+|ed[0-9]+|ncop|nced|opopening|edending|optheme|edtheme|openingtheme|endingtheme|openingcredits|endingcredits|musicvideo|片头曲|片尾曲|主题曲|主題曲)"#,options:.regularExpression) != nil
            return !credit && seen.insert(id).inserted
        }
        let titled=expected.isEmpty ? [] : regular.filter { episodeTitle($0["episodeTitle"].string ?? "")==expected }
        return titled.isEmpty ? (regular.filter { ($0["episodeNumber"].number ?? Double($0["episodeNumber"].string ?? ""))==Double(number) },false) : (titled,true)
    }
    public static func episode(_ values: [JSONValue], number: Int, title: String) -> JSONValue? {
        let result=episodes(values,number:number,title:title).values
        return result.count==1 ? result[0] : nil
    }
    public static func resolve(_ candidates: [Candidate]) -> Candidate? {
        var seen=Set<String>()
        let unique=candidates.filter { seen.insert(($0.work["_server"].string ?? "")+"\u{0}"+scalar($0.work["bangumiId"])+"\u{0}"+scalar($0.episode["episodeId"])).inserted }
        guard let score=unique.map(\.score).max() else { return nil }
        let works=unique.filter { $0.score==score }, titled=works.filter(\.byTitle)
        let best=titled.isEmpty ? works : titled
        return best.count==1 ? best[0] : nil
    }
    public static func scalar(_ value: JSONValue) -> String { value.string ?? value.number.map { String(format:"%.0f",$0) } ?? "" }
    private static func episodeTitle(_ value: String) -> String {
        let result=normalize(value.replacingOccurrences(of:#"^第\s*\d+\s*[话話集]\s*"#,with:"",options:.regularExpression))
        return result.range(of:#"^(episode|ep)?[0-9]+$"#,options:.regularExpression) != nil ? "" : result
    }
    private static func work(_ text: String) -> (String,Int?) {
        let title=normalize(text), chinese=["零","一","二","三","四","五","六","七","八","九"],words=["first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth"]
        for n in (1...99).reversed() {
            let cn=n<10 ? chinese[n] : (n>=20 ? chinese[n/10] : "")+"十"+(n%10>0 ? chinese[n%10] : "")
            let suffixes=["第\(n)季","第\(cn)季","第\(n)期","第\(cn)期","第\(n)部","第\(cn)部","season\(n)","s\(n)",String(format:"s%02d",n),"\(n)stseason","\(n)ndseason","\(n)rdseason","\(n)thseason"]+(n<=10 ? [words[n-1]+"season"] : [])
            for suffix in suffixes where title.hasSuffix(suffix) && title.count>suffix.count { return (String(title.dropLast(suffix.count)),n) }
        }
        return (title,nil)
    }
    private static func normalize(_ value: String) -> String {
        let punctuation=CharacterSet(charactersIn:"，。！？；：、·「」『』“”‘’（）【】《》〈〉—…　")
        return String(String.UnicodeScalarView(value.replacingOccurrences(of:"½",with:"1/2").lowercased().unicodeScalars.filter {
            !CharacterSet.whitespacesAndNewlines.contains($0) && !punctuation.contains($0) && !($0.value<128 && CharacterSet.punctuationCharacters.union(.symbols).contains($0))
        }))
    }
    /// Preserve the PC Lua function's one-based table boundary handling. Golden
    /// cases execute the original Lua, so changing this cannot silently drift.
    public static func similarity(_ left: String,_ right: String) -> Double {
        if left.isEmpty && right.isEmpty { return 0 }
        if left==right { return 1 }
        let a:[Unicode.Scalar?]=[nil]+left.unicodeScalars.map(Optional.some),b:[Unicode.Scalar?]=[nil]+right.unicodeScalars.map(Optional.some)
        guard a.count>1,b.count>1 else { return 0 }
        let window=max(a.count-1,b.count-1)/2-1
        var am=Array(repeating:false,count:a.count),bm=Array(repeating:false,count:b.count),matches=0
        for i in a.indices {
            let start=max(0,i-window),end=min(i+window+1,b.count-1)
            if start<=end { for k in start...end where !bm[k] && a[i]==b[k] { am[i]=true;bm[k]=true;matches+=1;break } }
        }
        if matches==0 { return 0 }
        let x=a.indices.filter { am[$0] }.map { a[$0] },y=b.indices.filter { bm[$0] }.map { b[$0] }
        let t=Double(zip(x,y).filter { $0 != $1 }.count)/2,m=Double(matches)
        let d=(m/Double(a.count-1)+m/Double(b.count-1)+(m-t)/m)/3
        var prefix=0
        while prefix<4 && prefix<a.count && prefix<b.count && a[prefix]==b[prefix] { prefix+=1 }
        return min(1,d+Double(prefix)*0.1*(1-d))
    }
}
/// Smooth display time between coarse playback observations without quantizing
/// motion to video frames. Small drift is corrected gradually; seeks snap.
public struct DanmakuClock: Sendable {
    private var baseTime=0.0,baseHost=0.0,lastSample=0.0,sampleHost=0.0,lastRate=1.0
    private var previousEpoch:UInt64=0,initialized=false,wasPlaying=false
    public init() {}
    public mutating func position(mediaTime:Double,hostTime:Double,playing:Bool,rate:Double,epoch:UInt64) -> Double {
        guard mediaTime.isFinite,hostTime.isFinite,rate.isFinite,rate>0 else {return max(0,lastSample)}
        let predicted=baseTime+max(0,min(hostTime,sampleHost+0.25)-baseHost)*lastRate
        if !initialized || epoch != previousEpoch || !playing || playing != wasPlaying || abs(mediaTime-lastSample)>0.5 {
            baseTime=mediaTime;baseHost=hostTime;sampleHost=hostTime
        } else if rate != lastRate {
            baseTime=predicted;baseHost=hostTime;sampleHost=hostTime
        } else if mediaTime != lastSample {
            let drift=mediaTime-predicted
            baseTime=abs(drift)>0.5 ? mediaTime : predicted+min(0.002,max(-0.002,drift))
            baseHost=hostTime;sampleHost=hostTime
        }
        initialized=true;previousEpoch=epoch;wasPlaying=playing;lastRate=rate;lastSample=mediaTime
        return max(0,baseTime+(playing ? max(0,min(hostTime,sampleHost+0.25)-baseHost)*rate : 0))
    }
}
