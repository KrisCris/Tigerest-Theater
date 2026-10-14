import Foundation
import Testing
@testable import AppleCore
@Test func rangeResponsesNeverSilentlyCorruptFiles() {
    #expect(ResumePolicy.decide(status:206,headers:["content-range":"bytes 100-199/200","etag":"a"],received:100,validator:"a") == .append)
    #expect(ResumePolicy.decide(status:200,headers:[:],received:100,validator:nil) == .restart)
    #expect(ResumePolicy.decide(status:206,headers:["content-range":"bytes 90-199/200"],received:100,validator:nil) == .reject)
    #expect(ResumePolicy.decide(status:206,headers:["content-range":"bytes 100-199/200","etag":"b"],received:100,validator:"a") == .restart)
    #expect(ResumePolicy.decide(status:416,headers:["content-range":"bytes */200","etag":"a"],received:200,validator:"a") == .complete)
    #expect(ResumePolicy.decide(status:416,headers:["content-range":"bytes */200"],received:100,validator:nil) == .reject)
    #expect(ResumePolicy.decide(status:500,headers:[:],received:0,validator:nil) == .reject)
}
@Test func staleOfflinePlaybackCannotOverwriteNewerServerProgress() {
    let progress=OfflineProgress(position:50,recordedAt:Date(timeIntervalSince1970:100))
    #expect(!progress.mayUpload(serverUpdatedAt:Date(timeIntervalSince1970:101)))
    #expect(progress.mayUpload(serverUpdatedAt:Date(timeIntervalSince1970:99)))
}
