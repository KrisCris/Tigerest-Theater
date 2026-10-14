import Foundation
import CryptoKit
import CommonCrypto

/// The official-provider request contract shipped in PC apis/dandanplay.lua.
/// Credentials remain in their upstream representation; never log the headers.
public enum DanmakuSigning {
    enum DecodeFailure: Error { case base64, aes(Int32), utf8 }
    public static func headers(url: URL, timestamp: Int64 = Int64(Date().timeIntervalSince1970)) throws -> [String:String] {
        guard url.host?.lowercased().hasPrefix("api.dandanplay.") == true else { return [:] }
        let app = try decrypt("UgjRIH45lE1BBLNmir1WKw==")
        let accept = try decrypt("SzuWlFZAPRMqeWf9qmfp8dcvYr3hvxuSrIRZuAeEfko=")
        // PC signs the encoded URL path, excluding all query parameters.
        let path = URLComponents(url:url,resolvingAgainstBaseURL:false)?.percentEncodedPath ?? url.path
        let signature = Data(SHA256.hash(data:Data((app+String(timestamp)+path+accept).utf8))).base64EncodedString()
        return ["X-AppId":app,"X-Signature":signature,"X-Timestamp":String(timestamp)]
    }
    private static func decrypt(_ encoded: String) throws -> String {
        guard let input=Data(base64Encoded:encoded) else { throw DecodeFailure.base64 }
        // PC table_to_zero_indexed shifts in place backwards, producing 32 × 0x1f.
        // Keep the effective key used by the shipped encrypted credentials.
        let key=[UInt8](repeating:0x1f,count:32)
        var output=[UInt8](repeating:0,count:input.count+kCCBlockSizeAES128), count=0
        let capacity=output.count
        let status=key.withUnsafeBytes { keyBytes in input.withUnsafeBytes { inputBytes in
            output.withUnsafeMutableBytes { bytes in
                CCCrypt(CCOperation(kCCDecrypt),CCAlgorithm(kCCAlgorithmAES),CCOptions(kCCOptionECBMode),keyBytes.baseAddress,key.count,nil,inputBytes.baseAddress,input.count,bytes.baseAddress,capacity,&count)
            }
        } }
        guard status==kCCSuccess else {throw DecodeFailure.aes(status)}
        output=Array(output.prefix(count))
        // PC accepts PKCS#7 padding and falls back to zero padding.
        if let last=output.last,last>0,last<=16,output.suffix(Int(last)).allSatisfy({$0==last}) { output.removeLast(Int(last)) }
        else {while output.last==0 {output.removeLast()} }
        guard let value=String(bytes:output,encoding:.utf8) else {throw DecodeFailure.utf8};return value
    }
}
