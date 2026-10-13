import Foundation
import Testing
@testable import AppleCore
@Test func profilesPersistSelectionAndKeepFilesSeparate() throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try ProfileStore(root: root)
    let first = store.currentID
    let firstDirectory = store.directory
    let second = try store.create(name: "家里")
    try store.select(second)
    #expect(store.currentID == second)
    #expect(store.directory != firstDirectory)
    let restored = try ProfileStore(root: root)
    #expect(restored.currentID == second)
    try restored.select(first)
    #expect(restored.directory == firstDirectory)
    #expect(throws: (any Error).self) { try restored.select(UUID()) }
}
