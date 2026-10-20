import Testing
@testable import AppleCore

private let dolbyVisionSource: JSONValue = .object([
    "w": .number(3840), "h": .number(2160), "primaries": .string("bt.2020"), "gamma": .string("pq"),
    "colormatrix": .string("dolbyvision"), "max-luma": .number(1000.6065),
])

@Test func dolbyVisionOnHDRDisplayReportsHDROutput() {
    let target: JSONValue = .object(["primaries": .string("bt.2020"), "gamma": .string("pq"), "max-luma": .number(10000)])
    #expect(DynamicRangeSummary.text(source: dolbyVisionSource, target: target, dolbyVisionProfile: 8, toneMapping: "bt.2446a") ==
        "HDR 输出 · 杜比视界 Profile 8\n片源 3840×2160 · BT.2020 / PQ · 母版 1000 nits\n输出 BT.2020 / PQ · 由系统按屏幕能力映射亮度")
}
@Test func hdrOnSDRDisplayNamesTheToneMapping() {
    let target: JSONValue = .object(["primaries": .string("display-p3"), "gamma": .string("gamma2.2"), "max-luma": .number(203)])
    #expect(DynamicRangeSummary.text(source: dolbyVisionSource, target: target, dolbyVisionProfile: 8, toneMapping: "bt.2446a") ==
        "SDR 输出 · 杜比视界 Profile 8 已色调映射（bt.2446a）\n片源 3840×2160 · BT.2020 / PQ · 母版 1000 nits\n输出 Display P3 / Gamma 2.2")
    let hdr10: JSONValue = .object(["w": .number(1920), "h": .number(1080), "primaries": .string("bt.2020"), "gamma": .string("pq")])
    #expect(DynamicRangeSummary.text(source: hdr10, target: target, dolbyVisionProfile: nil, toneMapping: "") ==
        "SDR 输出 · HDR10 已色调映射（自动）\n片源 1920×1080 · BT.2020 / PQ\n输出 Display P3 / Gamma 2.2")
}
@Test func sdrSourceAndUnconfiguredTarget() {
    let source: JSONValue = .object(["w": .number(1920), "h": .number(1080), "primaries": .string("bt.709"), "gamma": .string("bt.1886")])
    let target: JSONValue = .object(["primaries": .string("bt.709"), "gamma": .string("bt.1886")])
    #expect(DynamicRangeSummary.text(source: source, target: target, dolbyVisionProfile: 0, toneMapping: "bt.2446a") ==
        "SDR 播放\n片源 1920×1080 · BT.709 / BT.1886\n输出 BT.709 / BT.1886")
    #expect(DynamicRangeSummary.text(source: source, target: .null, dolbyVisionProfile: nil, toneMapping: "") == nil)
    let hlg: JSONValue = .object(["primaries": .string("bt.2020"), "gamma": .string("hlg")])
    #expect(DynamicRangeSummary.text(source: hlg, target: hlg, dolbyVisionProfile: nil, toneMapping: "")?.hasPrefix("HDR 输出 · HLG\n") == true)
}
