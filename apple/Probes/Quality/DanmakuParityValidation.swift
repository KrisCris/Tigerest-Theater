// Fixture-only transport exercises the production repository. No request can
// reach the network, and AppModel uses its separate --ui-testing profile.
import Foundation
import AppleCore
final class DanmakuFixtureProtocol: URLProtocol {
    static let lock = NSLock()
    nonisolated(unsafe) static var mappingStatus = 503, malformed = false, alternate = false, xmlFallback = false, stalledFirst = false
    nonisolated(unsafe) static var paths: [String] = []
    private var work: DispatchWorkItem?
    static func reset(_ status: Int = 503, malformed: Bool = false, alternate: Bool = false, xmlFallback: Bool = false, stalledFirst: Bool = false) {
        lock.lock(); defer { lock.unlock() }; mappingStatus=status;self.malformed=malformed;self.alternate=alternate;self.xmlFallback=xmlFallback;self.stalledFirst=stalledFirst;paths=[]
    }
    static var requests: [String] { lock.lock();defer {lock.unlock()};return paths }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url=request.url!,path=url.path
        let query=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
        func parameter(_ name: String) -> String? {query.first{$0.name==name}?.value}
        Self.lock.lock();Self.paths.append((request.httpMethod ?? "GET")+" "+(url.host=="api.tmdb.org" ? "https://api.tmdb.org"+path : url.absoluteString));let status=Self.mappingStatus,malformed=Self.malformed,alternate=Self.alternate,xmlFallback=Self.xmlFallback,stalledFirst=Self.stalledFirst;Self.lock.unlock()
        var requestBody=request.httpBody ?? Data()
        if requestBody.isEmpty,let stream=request.httpBodyStream {
            stream.open();defer{stream.close()};var buffer=[UInt8](repeating:0,count:16384)
            let count=stream.read(&buffer,maxLength:buffer.count);if count>0{requestBody=Data(buffer.prefix(count))}
        }
        let comment: [String:Any] = ["comments":[["p":"1,1,16777215","m":"fixture"]]]
        var result:[String:Any]=[:],code=200,raw:Data?
        if url.host=="api.danmu.icu",xmlFallback {
            raw=Data("<i><d p=\"1,1,25,16711680\">one</d><d p=\"2,5,25,255\">two</d></i>".utf8)
        } else if path=="/index" {
            result=["data":["longData":["rows":[["en_id":"abc","titleTxt":"作品","cat_name":parameter("type")=="dy" ? "电影" : "电视剧","year":"2026","seriesSite":"qq","seriesPlaylinks":[["url":"https://v.qq.com/one.html?x=1"]],"playlinks":["qq":"https://v.qq.com/one.html","youku":"https://v.youku.com/video?vid=one"]]]]]]
        } else if path=="/episodesv2" {result=["code":0,"data":[["seriesHTML":["seriesPlaylinks":[["url":"https://v.youku.com/one.html"]]]]]]}
        else if path.hasPrefix("/3/search/") {result=["results":[["name":"作品","title":"作品"]]]}
        else if path=="/api/v2/extcomment" {
            if url.host=="first.invalid" || xmlFallback {code=503}
            else {result=["comments":[["p":"1,1,16777215","m":"one"],["p":"2,1,255","m":"two"]],"count":2]}
        } else if path=="/api/tigerest/v1/danmaku" {
            code=status;result=["success":true,"matched":true,"match":["origin":((try? JSONSerialization.jsonObject(with:requestBody)) as? [String:Any])?["selection"] != nil ? "manual" : "shared","episodeId":malformed ? "bad/id" : "11","episodeTitle":"开始"],"danmaku":comment]
        } else if path=="/community/v2/capabilities" { result=["data":["enabled":true,"embyExchangeServerId":String(repeating:"a",count:32)]]
        } else if path=="/api/v2/search/anime" {
            result=["animes":[["type":"tvseries","bangumiId":"1","animeTitle":"作品"],["type":"movie","bangumiId":url.host=="second.invalid" ? "3" : "2","animeTitle":"另一作品"]]]
        } else if path=="/api/v2/bangumi/1" { result=["bangumi":["episodes":[["episodeId":"11","episodeNumber":"1","episodeTitle":"第1话 开始"]]]] }
        else if path.hasPrefix("/api/v2/comment/") { result=alternate ? ["danmuku":[[1,"right","#ff0000","","fixture"]],"danum":1] : comment }
        else { code=404 }
        let data=try! raw ?? JSONSerialization.data(withJSONObject:result)
        let response=HTTPURLResponse(url:url,statusCode:code,httpVersion:nil,headerFields:["Content-Type":"application/json","Content-Length":String(data.count),"Retry-After":"60"])!
        let item=DispatchWorkItem { [weak self] in guard let self else {return};self.client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed);self.client?.urlProtocol(self,didLoad:data);self.client?.urlProtocolDidFinishLoading(self) }
        work=item;DispatchQueue.global().asyncAfter(deadline:.now()+(stalledFirst && url.host=="first.invalid" ? 5 : 0.03),execute:item)
    }
    override func stopLoading() { work?.cancel() }
}
@MainActor enum DanmakuParityValidation {
    static func run(_ model: AppModel) async {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[DanmakuFixtureProtocol.self]
        model.community.http=URLSession(configuration:config)
        var report:[[String:Any]]=[]
        func metadata(_ id: String) -> JSONValue { .object(["Id":.string(id),"SeriesName":.string("作品"),"ParentIndexNumber":.number(1),"IndexNumber":.number(1),"Name":.string("开始")]) }
        func fresh(_ status: Int = 503,malformed: Bool = false) throws {
            model.community.clear();model.danmaku.clear();model.danmaku=DanmakuRepository(model:model);DanmakuFixtureProtocol.reset(status,malformed:malformed)
            try model.settings.set("mpv","enableDanmaku",.bool(true));try model.settings.set("danmaku","apiServer",.string(DanmakuProvider.remote))
        }
        func check(_ condition: Bool) throws { if !condition { throw PlaybackValidation.Failure.incorrectOutput } }
        for test in ["shared-first","shared-failure-fallback","invalid-shared-fallback","rate-limit-no-get","ordered-providers","manual-no-auth-fallback","stale-manual-selection","manual-share-success","manual-share-forbidden","manual-share-limited","mixed-catalog-selection","alternate-response","main-quality-reset","extra-cached-episodes","extra-v2-episodes","extra-movie","extra-translated-search","extra-xml-fallback","extra-first-success"] {
            do {
                try fresh(["shared-first","invalid-shared-fallback","manual-share-success"].contains(test) ? 200 : test=="rate-limit-no-get" || test=="manual-share-limited" ? 429 : test=="manual-share-forbidden" ? 403 : 503,malformed:test=="invalid-shared-fallback")
                let repo=model.danmaku
                if test.hasPrefix("extra-") {
                    if test=="extra-xml-fallback" {DanmakuFixtureProtocol.reset(xmlFallback:true)}
                    if test=="extra-first-success" {DanmakuFixtureProtocol.reset(stalledFirst:true)}
                    try model.settings.set("danmaku","apiServer",.string("https://api.dandanplay.net,https://first.invalid,https://second.invalid"))
                    let works=try await repo.search(test=="extra-translated-search" ? "Story|TV" : test=="extra-movie" ? "作品|dy" : "作品|tv")
                    try check(works.count==2)
                    let work=works[test=="extra-v2-episodes" ? 1 : 0]
                    let episodes=try await repo.episodes(for:work)
                    try check(episodes.count==1)
                    let began=Date();try await repo.select(episodes[0],work:work,share:true)
                    if test=="extra-first-success" {try check(Date().timeIntervalSince(began)<2)}
                    let requests=DanmakuFixtureProtocol.requests
                    try check(repo.sources.count==1 && repo.sources[0].comments.count==2 && !requests.contains(where:{$0.hasPrefix("POST") || $0.contains("api.dandanplay.net")}))
                    if test=="extra-xml-fallback" {try check(requests.contains(where:{$0.contains("api.danmu.icu")}) && repo.sources[0].comments[0].color==0xff0000)}
                    if test=="extra-v2-episodes" {try check(requests.contains(where:{$0.contains("/episodesv2")}))}
                    if test=="extra-cached-episodes" {try check(!requests.contains(where:{$0.contains("/episodesv2")}))}
                    if test=="extra-translated-search" {try check(requests.contains(where:{$0.contains("/3/search/tv")}))}
                    report.append(["case":test,"result":"success","requests":requests]);continue
                }
                if test=="main-quality-reset" {
                    func change(_ method: String,_ args: [JSONValue]) async throws {
                        let value:JSONValue = .object(["id":.number(1),"component":.string("settings"),"method":.string(method),"args":.array(args)])
                        _ = try await model.bridge.handle(BridgeRequest.decode(JSONEncoder().encode(value)))
                    }
                    for choice in ["native","default"] {
                        try model.player.selectQuality(QualitySelection(custom:["deband":"yes"]))
                        try await change("setValue",[.string("mpv"),.string("shaderPreset"),.string(choice)])
                        try check(model.player.qualitySelection.custom.isEmpty && model.player.qualitySelection.preset==QualitySelection.ids[choice])
                    }
                    try model.player.selectQuality(QualitySelection(custom:["deband":"yes"]))
                    try await change("resetToDefault",[.string("mpv")])
                    try check(model.player.qualitySelection.custom.isEmpty && model.player.qualitySelection.preset=="native")
                    report.append(["case":test,"result":"success"]);continue
                }
                if test=="alternate-response" {
                    DanmakuFixtureProtocol.reset(alternate:true)
                    try check(try await repo.load("11",title:"fixture",server:"https://first.invalid")==1)
                    try check(repo.sources[0].comments[0].color==0xff0000)
                    report.append(["case":test,"result":"success"]);continue
                }
                if ["ordered-providers","stale-manual-selection"].contains(test) { try model.settings.set("danmaku","apiServer",.string("https://first.invalid|首选,https://second.invalid#备用")) }
                if (test.hasPrefix("manual-share") || test=="mixed-catalog-selection") {
                    try model.community.request("caps",.object(["method":.string("GET"),"path":.string("/capabilities"),"headers":.object([:])]))
                    try await PlaybackValidation.wait { !model.community.trusted.isEmpty }
                    _ = model.community.setSession(.object(["serverId":.string(String(repeating:"a",count:32)),"userId":.string(String(repeating:"b",count:32)),"token":.string("fixture-token")]))
                }
                if test=="manual-no-auth-fallback" || test=="stale-manual-selection" || test.hasPrefix("manual-share") || test=="mixed-catalog-selection" {
                    try model.settings.set("mpv","enableDanmaku",.bool(false));repo.autoMatch(metadata(test))
                    let works=try await repo.search("作品"),episodes=try await repo.episodes("1",server:works[0]["_server"].string)
                    if test=="stale-manual-selection" || test=="mixed-catalog-selection" {
                        if test=="stale-manual-selection" {repo.autoMatch(metadata("next-item"))};var rejected=false
                        do { try await repo.select(episodes[0],work:works[test=="mixed-catalog-selection" ? 1 : 0],share:true) } catch is CancellationError { rejected=true }
                        try check(rejected && repo.sources.isEmpty && !DanmakuFixtureProtocol.requests.contains(where:{$0.hasPrefix("POST")}))
                    } else {
                        if test=="manual-share-limited" {
                            do { try await repo.select(episodes[0],work:works[0],share:true) } catch is CancellationError {}
                            try check(repo.sources.isEmpty && !DanmakuFixtureProtocol.requests.contains(where:{$0.contains("/comment/")}))
                        } else {
                            try await repo.select(episodes[0],work:works[0],share:true)
                            try check(repo.enabled && repo.sources.count==1)
                            let requests=DanmakuFixtureProtocol.requests
                            if test=="manual-no-auth-fallback" {try check(!requests.contains(where:{$0.hasPrefix("POST")}))}
                            if test=="manual-share-success" {try check(requests.contains(where:{$0.hasPrefix("POST")}) && !requests.contains(where:{$0.contains("/comment/")}))}
                            if test=="manual-share-forbidden" {try check(requests.contains(where:{$0.hasPrefix("POST")}) && requests.contains(where:{$0.contains("/comment/")}))}
                        }
                    }
                } else if test=="ordered-providers" {
                    let works=try await repo.search("作品")
                    try check(works.map{DanmakuMatch.scalar($0["bangumiId"])}==["1","2","3"] && works[0]["_server"].string=="https://first.invalid")
                } else {
                    repo.autoMatch(metadata(test),mediaURL:URL(string:"https://media.invalid/video.mp4"))
                    try await PlaybackValidation.wait { !repo.sources.isEmpty || !repo.status.contains("正在") }
                    let requests=DanmakuFixtureProtocol.requests
                    try check(requests.first?.hasPrefix("POST "+DanmakuProvider.remote+"/api/tigerest/v1/danmaku")==true && !requests.contains(where:{$0.contains("media.invalid")}))
                    if test=="rate-limit-no-get" { try check(repo.sources.isEmpty && requests.count==1) }
                    else { try check(repo.sources.count==1 && repo.sources[0].comments.count==1 && (test != "shared-first" || requests.count==1)) }
                }
                report.append(["case":test,"result":"success","requests":DanmakuFixtureProtocol.requests])
            } catch { report.append(["case":test,"result":"failed","error":String(describing:error),"requests":DanmakuFixtureProtocol.requests]) }
        }
        model.danmaku.clear()
        if let data=try? JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:URL.cachesDirectory.appending(path:"danmaku-parity.json"),options:.atomic) }
    }
}
