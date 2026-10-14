import Foundation
import Security
import CryptoKit
struct KeychainStore {
    let profile: UUID
    private func query(server: String, account: String) -> [String: Any] {
        let key = SHA256.hash(data: Data((server + "\n" + account).utf8)).map { String(format: "%02x", $0) }.joined()
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "top.tigerest.theater.ipad.\(profile)", kSecAttrAccount as String: key]
    }
    func read(server: String, account: String) -> Data? {
        var request = query(server: server, account: account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }
    func write(_ data: Data?, server: String, account: String) throws {
        let request = query(server: server, account: account)
        if let data {
            let status = SecItemUpdate(request as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                var addition = request
                addition[kSecValueData as String] = data
                addition[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw CocoaError(.fileWriteUnknown) }
            } else if status != errSecSuccess { throw CocoaError(.fileWriteUnknown) }
        } else {
            let status = SecItemDelete(request as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw CocoaError(.fileWriteUnknown) }
        }
    }
}
