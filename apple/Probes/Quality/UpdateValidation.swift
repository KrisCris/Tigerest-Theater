import Foundation
import AppleCore
private final class UpdateFixtureProtocol:URLProtocol {
    static let lock=NSLock()
    nonisolated(unsafe) static var requests=0,code=200,tooLarge=false,delay:Double=0
    static func reset(code:Int=200,tooLarge:Bool=false,delay:Double=0) {lock.lock();defer{lock.unlock()};requests=0;self.code=code;self.tooLarge=tooLarge;self.delay=delay}
    static var count:Int {lock.lock();defer{lock.unlock()};return requests}
    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        Self.lock.lock();Self.requests+=1;let code=Self.code,large=Self.tooLarge,delay=Self.delay;Self.lock.unlock()
        if delay>0 {Thread.sleep(forTimeInterval:delay)}
        let version="99.0.0",name="TigerestTheater-99.0.0-ipad.ipa"
        let release:[String:Any]=["tag_name":"v"+version,"draft":false,"prerelease":false,"body":"fixture release notes","assets":[["name":name,"browser_download_url":"https://github.com/Tigerest/Tigerest-Theater/releases/download/v"+version+"/"+name,"size":100,"digest":"sha256:"+String(repeating:"a",count:64)]]]
        let data=try! JSONSerialization.data(withJSONObject:[release])
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:code,httpVersion:nil,headerFields:["Content-Type":"application/json","Content-Length":String(large ? 3*1024*1024 : data.count)])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
@MainActor enum UpdateValidation {
    static func run(_ model:AppModel) async {
        var rows:[[String:Any]]=[]
        func check(_ value:Bool) throws {if !value {throw PlaybackValidation.Failure.incorrectOutput}}
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[UpdateFixtureProtocol.self]
        func controller()->UpdateController {let value=UpdateController(model:model);value.http=URLSession(configuration:config);return value}
        do {
            try model.settings.set("main","checkForUpdates",.bool(true));UpdateFixtureProtocol.reset()
            let update=controller()
            let first=Task{await update.check(manual:true)},second=Task{await update.check(manual:true)}
            let (a,b)=await(first.value,second.value)
            try check(a["status"].string=="available" && b==a && UpdateFixtureProtocol.count==1)
            _ = await update.check(manual:false);try check(UpdateFixtureProtocol.count==1)
            update.skip();try check(update.state["status"].string=="idle")
            let resumed=controller();let automatic=await resumed.check(manual:false)
            try check(automatic["status"].string=="idle" && UpdateFixtureProtocol.count==2)
            let retry=await resumed.check(manual:true);try check(retry["status"].string=="available" && UpdateFixtureProtocol.count==3)
            rows.append(["case":"coalesce-throttle-skip-manual","passed":true])
            // Previously skipped + manual request joins an unfinished automatic request.
            UpdateFixtureProtocol.reset(delay:0.15)
            let joined=controller();let background=Task{await joined.check(manual:false)}
            while UpdateFixtureProtocol.count==0 {try await Task.sleep(for:.milliseconds(5))}
            let requested=await joined.check(manual:true),completed=await background.value
            try check(requested==completed && requested["status"].string=="available" && requested["manual"].bool==true && UpdateFixtureProtocol.count==1)
            rows.append(["case":"manual-upgrades-inflight-skipped-auto","passed":true])
            try model.settings.set("main","checkForUpdates",.bool(false));UpdateFixtureProtocol.reset()
            let restored=try SettingsStore(directory:model.profiles.directory)
            try check(restored.get("main","checkForUpdates").bool==false && restored.descriptions["main"]?.array?.contains(where:{$0["key"].string=="checkForUpdates"})==true)
            let disabled=controller();_ = await disabled.check(manual:false);try check(UpdateFixtureProtocol.count==0)
            _ = await disabled.check(manual:true);try check(UpdateFixtureProtocol.count==1)
            rows.append(["case":"disabled-auto-manual-allowed","passed":true])
            for code in [403,429,503] {
                UpdateFixtureProtocol.reset(code:code);let value=await controller().check(manual:true)
                try check(value["status"].string=="error" && value["version"].string==nil)
                rows.append(["case":"http-\(code)-not-current","passed":true])
            }
            UpdateFixtureProtocol.reset(tooLarge:true);let large=await controller().check(manual:true)
            try check(large["status"].string=="error");rows.append(["case":"oversized-feed","passed":true])
            // A real anonymous GET, kept separate from the deterministic cases.
            let live=await UpdateController(model:model).check(manual:true)
            rows.append(["case":"live-github","passed":["unpublished","available","current"].contains(live["status"].string ?? ""),"status":live["status"].string ?? "","projectVersion":live["projectVersion"].string ?? "","currentVersion":live["currentVersion"].string ?? ""])
        } catch {rows.append(["case":"failure","passed":false,"error":String(describing:error)])}
        try? JSONSerialization.data(withJSONObject:rows,options:[.prettyPrinted,.sortedKeys]).write(to:URL.cachesDirectory.appending(path:"update-validation.json"))
    }
}
