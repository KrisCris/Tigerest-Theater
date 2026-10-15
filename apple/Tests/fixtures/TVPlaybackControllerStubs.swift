import Foundation
import AppleCore
import Combine
// macOS-only test doubles for the production tvOS controller. The runner links
// AppleCore and the unmodified controller source, without UIKit or libmpv.
@MainActor final class FixtureMetalLayer { var drawableSize = CGSize(width: 1, height: 1) }
@MainActor final class MetalSurface {
 let metal = FixtureMetalLayer()
 init(frame: CGRect) {}
}
@MainActor final class UIApplication { static let shared = UIApplication(); var isIdleTimerDisabled = false }
@MainActor final class AVAudioSession {
 enum Category { case playback }; enum Mode { case moviePlayback }; enum Options { case notifyOthersOnDeactivation }
 static let shared = AVAudioSession(); static func sharedInstance() -> AVAudioSession { shared }
 func setCategory(_ category: Category, mode: Mode) throws {}
 func setActive(_ active: Bool, options: Options? = nil) throws {}
}
@MainActor final class MPVEngine {
 enum Event { case loaded, restarted, ended, failed }
 static var failNewQuality = false
 static var failingNewQualityValues: Set<String> = []
 var failQuality = false, closed = false
 var failingQualityValues: Set<String> = []
 var failResetCalls: Set<Int> = [], resets = 0
 var actions: [String] = []
 var commands: [[String]] = []
 var failCommands: Set<String> = []
 var appliedQuality: [String: String] = [:]
 var properties: [String: JSONValue] = [:]
 var pendingEvents: [Event] = []
 init(layer: FixtureMetalLayer? = nil) throws { failQuality = Self.failNewQuality; failingQualityValues = Self.failingNewQualityValues }
 func resetQuality() throws { resets += 1; actions.append("reset"); if failResetCalls.contains(resets) { throw CoreError.invalidSetting }; appliedQuality = [:] }
 func qualitySetting(_ key: String, _ value: String) throws { actions.append("quality:" + key); if failQuality || failingQualityValues.contains(key + "=" + value) { throw CoreError.invalidSetting }; appliedQuality[key] = value }
 func set(_ key: String, _ value: String) throws {
  properties[key] = .string(value)
  if key == "sid", let tracks = properties["track-list"]?.array {
   properties["track-list"] = .array(tracks.map { track in
    var object = track.object ?? [:]
    object["selected"] = .bool(track["id"].number.flatMap(Int.init(exactly:)).map(String.init) == value)
    return .object(object)
   })
  }
 }
 func command(_ args: [String]) throws { actions.append(args[0]); commands.append(args); if failCommands.contains(args[0]) { throw CoreError.invalidRequest } }
 func close() { closed = true }
 func events() -> [Event] { defer { pendingEvents = [] }; return pendingEvents }
 func string(_ key: String) -> String { appliedQuality[key] ?? properties[key]?.string ?? "" }
 func number(_ key: String) -> Double { properties[key]?.number ?? 0 }
 func flag(_ key: String) -> Bool { properties[key]?.bool ?? false }
 func json(_ key: String) -> JSONValue { properties[key] ?? .null }
}
struct TVQualityPreset {
 var light = false
 var options: [String: String] { light ? ["scale":"bilinear", "cscale":"bilinear", "dscale":"bilinear", "deband":"no", "sigmoid-upscaling":"no"] : ["scale": "ewa_lanczos", "cscale": "ewa_lanczos", "dscale": "mitchell", "deband": "yes", "deband-iterations": "3", "tone-mapping": "bt.2446a"] }
 static var shaderPaths = ["/app/shaders/SSimDownscaler_RT.glsl", "/app/shaders/KrigBilateral.glsl", "/app/shaders/ravu_zoom_ar_r3.glsl"]
 static func bundled(_ selection: String) throws -> Self { Self(light: selection == "tv-balanced") }
 func paths() throws -> [String] { light ? ["/app/shaders/ravu_lite_ar_r3.glsl"] : Self.shaderPaths }
}
@MainActor protocol DanmakuPlaybackState: AnyObject {}
@MainActor final class TVDanmakuHost { var mappingHeaders: [String: String] = [:]; init(session: EmbySession) {} }
@MainActor final class DanmakuRepository: ObservableObject { init(host: TVDanmakuHost) {}; func autoMatch(_ item: JSONValue, mediaURL: URL) {}; func clear() {} }
