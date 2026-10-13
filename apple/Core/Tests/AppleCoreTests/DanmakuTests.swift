import Foundation
import Testing
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
    let works: [JSONValue] = [.object(["animeTitle":.string("作品"),"bangumiId":.string("1")]),.object(["animeTitle":.string("作品 第二季"),"bangumiId":.string("2")])]
    #expect(DanmakuMatch.choose(works:works,title:"作品",season:2).map { $0["bangumiId"] } == [.string("2")])
    let episodes: [JSONValue] = [.object(["episodeTitle":.string("起点"),"episodeNumber":.string("1")]),.object(["episodeTitle":.string("终点"),"episodeNumber":.string("2")])]
    #expect(DanmakuMatch.episode(episodes,number:1,title:"终点") == episodes[1])
    #expect(DanmakuMatch.episode(episodes+episodes,number:1,title:"终点") == nil)
}
@Test func danmakuClockTracksPauseRateAndSeek() {
    var clock = DanmakuClock()
    let a=clock.position(mediaTime:5,hostTime:10,playing:true,rate:2,epoch:1)
    let b=clock.position(mediaTime:5,hostTime:10.1,playing:true,rate:2,epoch:1)
    let c=clock.position(mediaTime:5,hostTime:11,playing:false,rate:2,epoch:1)
    let d=clock.position(mediaTime:50,hostTime:12,playing:true,rate:1,epoch:2)
    #expect(a==5); #expect(abs(b-5.2)<0.001); #expect(c==5); #expect(d==50)
}
