import Foundation
import AppleCore

@MainActor final class UpdateController {
    unowned let model:AppModel
    private var task:Task<JSONValue,Never>?
    private var lastCheck:Date?
    private var manualCheck=false
    private let defaults:UserDefaults
    var http=NoRedirectSession.make()
    private(set) var state:JSONValue
    private let currentVersion:String
    init(model:AppModel) {
        self.model=model
        currentVersion=Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "unknown"
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
            defaults=UserDefaults(suiteName:"TigerestUITestUpdates")!
        } else {defaults = .standard}
        state = .object(["status":.string("idle"),"currentVersion":.string(currentVersion),"checkOnly":.bool(true),"message":.string("开发签名版通过 Mac 上的 Xcode 更新。")])
    }
    private func publish(_ value:JSONValue) {state=value;model.bridge.emit("system","appUpdateChanged",[value])}
    func check(manual:Bool) async -> JSONValue {
        if let task {
            if manual {manualCheck=true}
            return await task.value
        }
        if !manual && (model.settings.get("main","checkForUpdates").bool==false || lastCheck.map{Date().timeIntervalSince($0)<6*3600}==true) {return state}
        manualCheck=manual
        publish(.object(["status":.string("checking"),"currentVersion":.string(currentVersion),"checkOnly":.bool(true),"manual":.bool(manual)]))
        let job=Task { @MainActor in
            let result:JSONValue
            do {
                var request=URLRequest(url:URL(string:"https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30")!)
                request.setValue("application/vnd.github+json",forHTTPHeaderField:"Accept")
                request.setValue("TigerestTheater-iPad/"+currentVersion,forHTTPHeaderField:"User-Agent")
                request.timeoutInterval=20
                let (bytes,response)=try await http.bytes(for:request)
                guard let response=response as? HTTPURLResponse,response.statusCode==200,response.expectedContentLength<=2*1024*1024 else {throw URLError(.badServerResponse)}
                var data=Data()
                for try await byte in bytes {guard data.count<2*1024*1024 else {throw URLError(.dataLengthExceedsMaximum)};data.append(byte)}
                guard let releases=try JSONDecoder().decode(JSONValue.self,from:data).array else {throw URLError(.cannotParseResponse)}
                var value=IPadUpdatePolicy.state(releases:releases,currentVersion:currentVersion).object!
                value["manual"] = .bool(manualCheck)
                if !manualCheck,value["version"]?.string==defaults.string(forKey:"TigerestSkippedIPadVersion"),value["status"]?.string=="available" {value["status"] = .string("idle")}
                result = .object(value)
            } catch {
                result = .object(["status":.string("error"),"currentVersion":.string(currentVersion),"checkOnly":.bool(true),"manual":.bool(manualCheck),"error":.string("暂时无法连接发布服务，请稍后重新检查。")])
            }
            lastCheck=Date();publish(result);task=nil;return result
        }
        task=job;return await job.value
    }
    func skip() {
        guard state["status"].string=="available",let version=state["version"].string,!version.isEmpty else {return}
        defaults.set(version,forKey:"TigerestSkippedIPadVersion")
        var value=state.object!;value["status"] = .string("idle");publish(.object(value))
    }
    func deferUpdate() {var value=state.object ?? [:];value["deferred"] = .bool(true);publish(.object(value))}
}
