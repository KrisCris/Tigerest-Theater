import Testing
@testable import AppleCore
@Test func communityBoundsHeadersPathsAndExchangeIdentity() {
    func request(_ path: String, _ headers: [String:JSONValue]=[:], _ method: String="GET") -> JSONValue { .object(["path":.string(path),"method":.string(method),"headers":.object(headers),"body":.string("")]) }
    #expect(CommunityPolicy.allowed(request("/capabilities"),trusted:""))
    #expect(!CommunityPolicy.allowed(request("//evil.test/x"),trusted:""))
    #expect(!CommunityPolicy.allowed(request("/me",["Cookie":.string("secret")]),trusted:""))
    #expect(!CommunityPolicy.allowed(request("/auth/emby",["X-Emby-Token":.string("secret"),"X-Emby-User-Id":.string("user"),"X-Emby-Server-Id":.string("11111111111111111111111111111111")],"POST"),trusted:"22222222222222222222222222222222"))
    #expect(!CommunityPolicy.allowed(request("/me",["Authorization":.string("Bearer a\r\nx-secret: yes")]),trusted:""))
}
@Test func diagnosticsRemoveSecretsAndAuthenticatedURLs() {
    let value=DiagnosticRedactor.redact("failed https://host/Video?api_key=SECRETA token=SECRETB password=SECRETC Authorization: Bearer SECRETD")
    for secret in ["SECRETA","SECRETB","SECRETC","SECRETD"] { #expect(!value.contains(secret)) }
}
