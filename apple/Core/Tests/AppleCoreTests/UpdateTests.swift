import Foundation
import Testing
@testable import AppleCore

private func release(_ version:String,package:String?="universal.ipa",prerelease:Bool=false,draft:Bool=false) -> JSONValue {
    .object(["tag_name":.string("v"+version),"prerelease":.bool(prerelease),"draft":.bool(draft),"body":.string("更新说明"),"assets":.array([.object([
        "name":.string("TigerestTheater-\(version)-"+(package ?? "arm64.dmg")),
        "browser_download_url":.string("https://github.com/Tigerest/Tigerest-Theater/releases/download/v\(version)/TigerestTheater-\(version)-"+(package ?? "arm64.dmg")),
        "size":.number(100),"digest":.string("sha256:"+String(repeating:"a",count:64))])])])
}
@Test func updateCheckDoesNotTreatDesktopReleaseAsUniversal() {
    let state=UniversalUpdatePolicy.state(releases:[release("9.0.0",package:nil)],currentVersion:"2.6.0")
    #expect(state["status"].string=="unpublished")
    #expect(state["version"].string=="")
    #expect(state["projectVersion"].string=="9.0.0")
    #expect(state["checkOnly"].bool==true)
}
@Test func updateCheckSelectsHighestStableUniversalRelease() {
    let state=UniversalUpdatePolicy.state(releases:[release("2.7.0"),release("2.10.0"),release("4.0.0",prerelease:true),release("5.0.0",draft:true)],currentVersion:"2.6.0")
    #expect(state["version"].string=="2.10.0");#expect(state["status"].string=="available")
    #expect(state["releaseUrl"].string=="https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.10.0")
}
@Test func releasesBefore294StillOfferTheIPadPackage() {
    let state=UniversalUpdatePolicy.state(releases:[release("2.9.3",package:"ipad.ipa")],currentVersion:"2.9.2")
    #expect(state["status"].string=="available");#expect(state["version"].string=="2.9.3")
}
@Test func equalAndOlderReleasesAreCurrent() {
    for version in ["2.5.0","2.6.0"] {
        #expect(UniversalUpdatePolicy.state(releases:[release(version)],currentVersion:"2.6.0")["status"].string=="current")
    }
    #expect(UniversalUpdatePolicy.state(releases:[release("2.6.0")],currentVersion:"2.6.0-dev")["status"].string=="available")
}
@Test func invalidAssetsAndTagsCannotAdvertiseUniversalUpdates() {
    var invalid=release("3.0.0").object!
    var asset=invalid["assets"]!.array![0].object!
    asset["browser_download_url"] = .string("https://unrelated.invalid/update.ipa")
    invalid["assets"] = .array([.object(asset)])
    let state=UniversalUpdatePolicy.state(releases:[.object(invalid),release("999999999999999.0.0")],currentVersion:"2.6.0")
    #expect(state["status"].string=="unpublished")
}
