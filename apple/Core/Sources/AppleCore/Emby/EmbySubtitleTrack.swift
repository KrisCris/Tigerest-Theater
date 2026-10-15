import Foundation

/// Emby's stream index identifies the choice; MPV's embedded index is a separate,
/// one-based ordinal that excludes physical external subtitle files.
public struct EmbySubtitleTrack: Identifiable, Sendable, Equatable {
    public let index: Int
    public var id: Int { index }
    public let embeddedIndex: Int?
    public let externalURL: URL?
    public let title: String
    public let language: String?
    public let codec: String?
    public let isDefault: Bool
    public let isForced: Bool
    public let isExternal: Bool

    public init(index: Int, embeddedIndex: Int? = nil, externalURL: URL? = nil,
                title: String, language: String? = nil, codec: String? = nil,
                isDefault: Bool = false, isForced: Bool = false, isExternal: Bool = false) {
        self.index = index; self.embeddedIndex = embeddedIndex; self.externalURL = externalURL
        self.title = title; self.language = language; self.codec = codec
        self.isDefault = isDefault; self.isForced = isForced; self.isExternal = isExternal
    }
}
