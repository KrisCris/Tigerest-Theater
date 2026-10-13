import Foundation

/// Manual `title|class` catalog and episode rows from PC apis/extra.lua.
public enum DanmakuExtra {
    public static let sites=[("bilibili1","b 站"),("imgo","芒果TV"),("qq","腾讯"),("qiyi","爱奇艺"),("youku","优酷")]
    public static func query(_ input: String) -> (name:String,category:String)? {
        guard let split=input.firstIndex(of:"|") else {return nil}
        let name=String(input[..<split]).replacingOccurrences(of:#"\s*\([0-9]*\)\s*$"#,with:"",options:.regularExpression).trimmingCharacters(in:.whitespaces)
        return (name,String(input[input.index(after:split)...]).trimmingCharacters(in:.whitespaces).lowercased())
    }
    public static func works(_ value: JSONValue) -> [JSONValue] {
        (value["data"]["longData"]["rows"].array ?? []).flatMap { row in
            sites.compactMap { site,label -> JSONValue? in
                guard let link=row["playlinks"][site].string else {return nil}
                let id=DanmakuMatch.scalar(row["en_id"])
                guard !id.isEmpty else {return nil}
                return .object(["bangumiId":.string("extra-"+id+"-"+site),"animeTitle":row["titleTxt"],"typeDescription":.string((row["cat_name"].string ?? "")+" | "+DanmakuMatch.scalar(row["year"])+" | "+label),"_extra":.object(["id":.string(id),"site":.string(site),"class":row["cat_name"],"playlink":.string(link),"year":row["year"],"seriesSite":row["seriesSite"],"seriesPlaylinks":row["seriesPlaylinks"]])])
            }
        }
    }
    public static func rows(_ list: JSONValue, playlink: String? = nil) -> [JSONValue] {
        (list.array ?? []).enumerated().compactMap { index,item in
            guard let url=item.string.map({playlink ?? $0}) ?? item["url"].string, !url.isEmpty else {return nil}
            return episode(index:String(index+1),url:url)
        }
    }
    public static func episode(index: String,url: String) -> JSONValue {
        .object(["episodeId":.string(index),"episodeNumber":.string(index),"episodeTitle":.string("第"+index+"集"),"_url":.string(cleanURL(url))])
    }
    public static func cleanURL(_ url: String) -> String {
        if let range=url.range(of:".html") {return String(url[...url.index(before:range.upperBound)])}
        if url.hasPrefix("https://v.youku.com/") || url.hasPrefix("http://v.youku.com/"),let id=URLComponents(string:url)?.queryItems?.first(where:{$0.name=="vid"})?.value {return "https://v.youku.com/v_show/id_"+id+".html"}
        return url.replacingOccurrences(of:#"\?bsource=360ogvys$"#,with:"",options:.regularExpression).components(separatedBy:"&")[0]
    }
}
