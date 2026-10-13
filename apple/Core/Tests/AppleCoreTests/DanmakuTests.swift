import Foundation
import Testing
import CryptoKit
@testable import AppleCore
@Test func parsesDanmakuJSONXMLAndASS() throws {
    let json = try DanmakuParser.parse(data: Data(#"{"comments":[{"p":"2.5,1,16711680","m":"你好"}]}"#.utf8))
    #expect(json == [DanmakuComment(time:2.5,text:"你好",color:0xff0000)])
    let xml = try DanmakuParser.parse(data: Data(#"<i><d p="1.5,5,25,255">顶端 &amp; 文本</d></i>"#.utf8))
    #expect(xml == [DanmakuComment(time:1.5,text:"顶端 & 文本",mode:5,color:255)])
    let ass = try DanmakuParser.parse(data: Data("[Events]\nDialogue: 0,0:00:03.00,0:00:07.00,Default,,0,0,0,,{\\an8}字幕".utf8))
    #expect(ass.first?.time == 3); #expect(ass.first?.text == "字幕"); #expect(ass.first?.mode == 5)
}
@Test func danmakuRejectsEntitiesAndOversize() {
    #expect(throws:(any Error).self) { try DanmakuParser.parse(data:Data("<!DOCTYPE i [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><i>&x;</i>".utf8)) }
    #expect(throws:(any Error).self) { _ = try DanmakuParser.parse(data:Data(repeating:32,count:16*1024*1024+1)) }
}
@Test func timelineBoundsSeekAndSourceTime() {
    let t=DanmakuTimeline([.init(time:1,text:"a"),.init(time:10,text:"b"),.init(time:20,text:"c")])
    #expect(t.visible(at:12,duration:5).map(\.text)==["b"])
    #expect(t.visible(at:2,duration:5).map(\.text)==["a"])
}
@Test func danmakuMatchingKeepsSeasonAndAmbiguity() {
    let works: [JSONValue] = [.object(["type":.string("tvseries"),"animeTitle":.string("作品"),"bangumiId":.string("1")]),.object(["type":.string("tvseries"),"animeTitle":.string("作品 第二季"),"bangumiId":.string("2")])]
    #expect(DanmakuMatch.choose(works:works,title:"作品",season:2).map { $0["bangumiId"] } == [.string("2")])
    let episodes: [JSONValue] = [.object(["episodeId":.string("1"),"episodeTitle":.string("起点"),"episodeNumber":.string("1")]),.object(["episodeId":.string("2"),"episodeTitle":.string("终点"),"episodeNumber":.string("2")])]
    #expect(DanmakuMatch.episode(episodes,number:1,title:"终点") == episodes[1])
    #expect(DanmakuMatch.episode(episodes+episodes,number:1,title:"终点") == episodes[1])
}
@Test func danmakuClockTracksPauseRateAndSeek() {
    var clock = DanmakuClock()
    let a=clock.position(mediaTime:5,hostTime:10,playing:true,rate:2,epoch:1)
    let b=clock.position(mediaTime:5,hostTime:10.1,playing:true,rate:2,epoch:1)
    let c=clock.position(mediaTime:5,hostTime:11,playing:false,rate:2,epoch:1)
    let d=clock.position(mediaTime:50,hostTime:12,playing:true,rate:1,epoch:2)
    #expect(a==5); #expect(abs(b-5.2)<0.001); #expect(c==5); #expect(d==50)
}
@Test func episodeTitlePrefixesAndSpecialsDoNotBreakMatching() {
    let episodes: [JSONValue] = [
        .object(["episodeId": .number(1), "episodeTitle": .string("第1话 起点"), "episodeNumber": .string("1")]),
        .object(["episodeId": .number(2), "episodeTitle": .string("第2话 王都的工作"), "episodeNumber": .string("2")]),
        .object(["episodeId": .number(3), "episodeTitle": .string("王都的工作"), "episodeNumber": .string("S1")])]
    #expect(DanmakuMatch.episode(episodes, number: 1, title: "王都的工作") == episodes[1])
}
@Test func ipadMatchingAgreesWithShippedPCMatcher() throws {
    let file=Bundle.module.url(forResource:"pc-danmaku",withExtension:"json",subdirectory:"Fixtures")!
    let cases=try JSONDecoder().decode([JSONValue].self,from:Data(contentsOf:file))
    for test in cases {
        let ranked=DanmakuMatch.ranked(works:test["works"].array!,title:test["title"].string!,season:Int(test["season"].number!))
        let candidates=ranked.flatMap { work in
            let matches=DanmakuMatch.episodes(work.value["episodes"].array!,number:Int(test["number"].number!),title:test["episodeTitle"].string!)
            return matches.values.map { DanmakuMatch.Candidate(work:work.value,episode:$0,score:work.score,byTitle:matches.byTitle) }
        }
        let selected=DanmakuMatch.resolve(candidates)
        let actual=selected.map { ($0.work["_server"].string ?? "")+"/"+DanmakuMatch.scalar($0.episode["episodeId"]) } ?? ""
        #expect(actual==test["expected"].string!, "\(test["name"].string!)")
    }
}
@Test func danmakuProviderRoutingMatchesPC() {
    let value=DanmakuProvidersFixture()
    #expect(value.count==3)
    #expect(value.map(\.url)==[DanmakuProvider.local,DanmakuProvider.local,"https://custom.example/api"])
    #expect(value[2].note=="备用")
}
private func DanmakuProvidersFixture() -> [DanmakuProvider] {
    DanmakuProvider.parse("https://danmaku-api.152468.xyz,http://nas.tigerest.top:18443,https://custom.example/api|备用",embyHost:"192.168.5.150")
}
@Test func danmakuLayoutKeepsLanesAcrossPlaybackAndSeek() {
    let comments:[DanmakuComment]=[.init(time:0,text:"a"),.init(time:0.1,text:"b"),.init(time:3,text:"c"),.init(time:3,text:"top",mode:5),.init(time:3.1,text:"top2",mode:5)]
    let layout=DanmakuLayout(comments.map{($0,100)},width:1000,lanes:3,duration:8)
    #expect(layout.visible(at:4).first(where:{$0.comment.text=="b"})?.lane==1)
    #expect(layout.visible(at:8.05).first(where:{$0.comment.text=="b"})?.lane==1)
    #expect(layout.visible(at:4).first(where:{$0.comment.text=="top2"})?.lane==1)
    #expect(layout.visible(at:8.2).allSatisfy{$0.comment.mode==1})
}
@Test func danmakuLayoutRejectsCatchUpCollision() {
    let layout=DanmakuLayout([(.init(time:0,text:"short"),40),(.init(time:1,text:"long"),900)],width:1000,lanes:1,duration:8)
    #expect(layout.visible(at:2).map(\.comment.text)==["short"])
}
@Test func alternatePCResponseIsNormalized() throws {
    let comments=try DanmakuParser.parse(data:Data(##"{"danmuku":[[1.234,"right","#ff0000","","hello"],[2,"top",255,"fixed"],[3,"bottom","ffffff","","bottom"]],"danum":3}"##.utf8))
    #expect(comments == [.init(time:1.23,text:"hello",color:0xff0000),.init(time:2,text:"fixed",mode:4,color:255),.init(time:3,text:"bottom",mode:5)])
}
@Test func officialHeadersMatchShippedPC() throws {
    let fixture=Bundle.module.url(forResource:"pc-danmaku-signing",withExtension:"json",subdirectory:"Fixtures")!
    let expected=try JSONDecoder().decode([String].self,from:Data(contentsOf:fixture))
    let paths=["/api/v2/search/anime?keyword=test","/api/v2/comment/11?withRelated=true&chConvert=0"]
    for (index,path) in paths.enumerated() {
        let headers=try DanmakuSigning.headers(url:URL(string:"https://api.dandanplay.net"+path)!,timestamp:1800000000)
        let text=headers.map { $0.key+": "+$0.value }.sorted().joined(separator:"\n")
        let fingerprint=SHA256.hash(data:Data(text.utf8)).map { String(format:"%02x",$0) }.joined()
        #expect(fingerprint==expected[index])
    }
    #expect(try DanmakuSigning.headers(url:URL(string:"https://custom.invalid/?url=api.dandanplay.net")!).isEmpty)
}
@Test func extraCatalogUsesPCQueryAndEpisodeRules() throws {
    let query=DanmakuExtra.query("作品 (2026) | TV")
    #expect(query?.name=="作品");#expect(query?.category=="tv")
    #expect(DanmakuExtra.query("作品")==nil)
    let value=try JSONDecoder().decode(JSONValue.self,from:Data(#"{"data":{"longData":{"rows":[{"en_id":"abc","titleTxt":"作品","cat_name":"电视剧","year":"2026","seriesSite":"qq","seriesPlaylinks":["1",{"url":"https://v.qq.com/two.html?x=2"}],"playlinks":{"qq":"https://v.qq.com/one.html?bsource=360ogvys","youku":"https://v.youku.com/video?vid=test"}}]}}}"#.utf8))
    let works=DanmakuExtra.works(value)
    #expect(works.count==2);#expect(works[0]["_extra"]["site"].string=="qq")
    let rows=DanmakuExtra.rows(works[0]["_extra"]["seriesPlaylinks"],playlink:works[0]["_extra"]["playlink"].string)
    #expect(rows.map{$0["_url"].string!}==["https://v.qq.com/one.html","https://v.qq.com/two.html"])
    #expect(DanmakuExtra.cleanURL("https://v.youku.com/video?vid=test&x=2")=="https://v.youku.com/v_show/id_test.html")
}
@Test func danmakuClockSmoothsCoarseVideoSamplesAtDisplayRate() {
    var clock=DanmakuClock(),positions:[Double]=[]
    for frame in 0..<240 {
        let host=Double(frame)/120
        // A 10 Hz controller sampling a 24 fps video.
        let media=floor(floor(host*10)/10*24)/24
        positions.append(clock.position(mediaTime:media,hostTime:host,playing:true,rate:1,epoch:1))
    }
    let deltas=zip(positions.dropFirst(),positions).map(-)
    #expect(deltas.allSatisfy{$0>0.005 && $0<0.012})
    let paused=clock.position(mediaTime:2,hostTime:2,playing:false,rate:1,epoch:1)
    #expect(paused==2)
    #expect(clock.position(mediaTime:2,hostTime:20,playing:true,rate:1,epoch:1)==2)
    #expect(clock.position(mediaTime:1,hostTime:20.1,playing:true,rate:1,epoch:2)==1)
}
