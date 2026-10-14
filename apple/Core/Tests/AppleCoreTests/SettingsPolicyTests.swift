import Foundation
import Testing
@testable import AppleCore
@Test func settingsRejectWrongTypesNonfiniteAndOutOfRange() throws {
    let policy = SettingsPolicy(defaults: ["video":["cache":.number(100),"default_playback_speed":.number(1)],"mpv":["enableDanmaku":.bool(true)]])
    #expect(try policy.validate(section:"video",key:"cache",value:.number(200)) == .number(200))
    for invalid in [JSONValue.string("100"),.number(.nan),.number(.infinity),.number(-1)] {
        #expect(throws:(any Error).self) { try policy.validate(section:"video",key:"cache",value:invalid) }
    }
    #expect(throws:(any Error).self) { try policy.validate(section:"mpv",key:"enableDanmaku",value:.number(1)) }
    #expect(throws:(any Error).self) { try policy.validate(section:"video",key:"default_playback_speed",value:.number(5)) }
    #expect(throws:(any Error).self) { try policy.validate(section:"unknown",key:"x",value:.bool(true)) }
}
