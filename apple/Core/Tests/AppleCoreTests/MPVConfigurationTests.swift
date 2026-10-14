import Foundation
import Testing
@testable import AppleCore
@Test func importedConfigurationAllowsOnlyInProcessPlaybackOptions() throws {
    let root=URL(fileURLWithPath:"/profile/Shaders")
    #expect(try MPVConfigurationPolicy.parse("scale=ewa_lanczossharp\ndeband=yes\n# comment",shaderRoot:root)==["scale":"ewa_lanczossharp","deband":"yes"])
    for invalid in ["script=/tmp/execute.lua","vf=vapoursynth=/tmp/x.py","input-ipc-server=/tmp/socket","glsl-shaders=/etc/secret","include=other.conf"] {
        #expect(throws:(any Error).self) { try MPVConfigurationPolicy.parse(invalid,shaderRoot:root) }
    }
    #expect(try MPVConfigurationPolicy.parse("glsl-shaders=/profile/Shaders/custom.glsl",shaderRoot:root)["glsl-shaders"] == "/profile/Shaders/custom.glsl")
}
