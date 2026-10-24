import Clibsodium
import CommonCrypto
import CryptoKit
import Foundation
import os

// The slice of packages/crypto that unlocking with the master password needs, natively:
// Argon2id from libsodium (as on the web), or PBKDF2-SHA256 from CommonCrypto, then HKDF
// "vauly/auth" and "vauly/wrap" from CryptoKit, then AES-256-GCM open. Checked against
// packages/crypto/test-vectors.json, with the time and memory each derivation takes in
// the process that runs it: the app, or the AutoFill extension.

let log = Logger(subsystem: "app.vauly.proto", category: "argon2")

enum VaulyCoreError: Error {
	case sodium, argon2, pbkdf2, format(String)
}

struct Kdf: Decodable {
	let kdf: String
	let kdfIterations: Int
	let kdfPasses: Int?
	let kdfMemory: Int?
}

struct MasterKeysVector: Decodable {
	struct Check: Decodable {
		let plaintext: String
		let sealed: String
	}
	let passwordNfkc: String
	let password: String
	let salt: String
	let kdf: Kdf
	let masterKey: String
	let authKey: String
	let wrapKey: String
	let wrapKeyCheck: Check
}

struct Vectors: Decodable {
	let masterKeys: [MasterKeysVector]
}

/** Resident memory as iOS counts it against a process's limit, now and at its peak. */
func footprint() -> (now: UInt64, peak: UInt64) {
	var info = task_vm_info_data_t()
	var count = mach_msg_type_number_t(
		MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
	let result = withUnsafeMutablePointer(to: &info) {
		$0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
			task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
		}
	}
	guard result == KERN_SUCCESS else { return (0, 0) }
	return (info.phys_footprint, UInt64(info.ledger_phys_footprint_peak))
}

func mib(_ bytes: UInt64) -> String { String(format: "%.1f MiB", Double(bytes) / 1_048_576) }

func hex(_ data: some DataProtocol) -> String { data.map { String(format: "%02x", $0) }.joined() }

func masterBits(password: String, salt: Data, kdf: Kdf) throws -> Data {
	let bytes = Array(password.precomposedStringWithCompatibilityMapping.utf8)
	var out = Data(count: 32)
	if kdf.kdf == "argon2id" {
		guard sodium_init() >= 0 else { throw VaulyCoreError.sodium }
		let passes = UInt64(kdf.kdfPasses ?? 3)
		let memory = Int((kdf.kdfMemory ?? 65_536) * 1024)
		let status = out.withUnsafeMutableBytes { outBytes in
			salt.withUnsafeBytes { saltBytes in
				bytes.withUnsafeBufferPointer { passwordBytes in
					passwordBytes.baseAddress!.withMemoryRebound(to: CChar.self, capacity: bytes.count) {
						crypto_pwhash(
							outBytes.bindMemory(to: UInt8.self).baseAddress!, 32,
							$0, UInt64(bytes.count),
							saltBytes.bindMemory(to: UInt8.self).baseAddress!,
							passes, memory, crypto_pwhash_ALG_ARGON2ID13)
					}
				}
			}
		}
		guard status == 0 else { throw VaulyCoreError.argon2 }
	} else {
		let status = out.withUnsafeMutableBytes { outBytes in
			salt.withUnsafeBytes { saltBytes in
				CCKeyDerivationPBKDF(
					CCPBKDFAlgorithm(kCCPBKDF2), bytes.map { CChar(bitPattern: $0) }, bytes.count,
					saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
					CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(kdf.kdfIterations),
					outBytes.bindMemory(to: UInt8.self).baseAddress, 32)
			}
		}
		guard status == kCCSuccess else { throw VaulyCoreError.pbkdf2 }
	}
	return out
}

func hkdf(_ master: Data, _ info: String) -> SymmetricKey {
	HKDF<SHA256>.deriveKey(
		inputKeyMaterial: SymmetricKey(data: master), salt: Data(count: 32),
		info: Data(info.utf8), outputByteCount: 32)
}

/** `base64(iv).base64(ciphertext and tag)`, as packages/crypto seals. */
func open(_ sealed: String, with key: SymmetricKey) throws -> Data {
	let parts = sealed.split(separator: ".")
	guard parts.count == 2, let iv = Data(base64Encoded: String(parts[0])),
		let body = Data(base64Encoded: String(parts[1])), body.count >= 16
	else { throw VaulyCoreError.format("sealed") }
	let box = try AES.GCM.SealedBox(
		nonce: AES.GCM.Nonce(data: iv), ciphertext: body.dropLast(16), tag: body.suffix(16))
	return try AES.GCM.open(box, using: key)
}

struct Result: CustomStringConvertible {
	let label: String
	let matches: Bool
	let seconds: Double
	let before: UInt64
	let peak: UInt64

	var description: String {
		"\(label): \(matches ? "matches" : "MISMATCH") in \(String(format: "%.2f", seconds)) s, footprint \(mib(before)) before, peak \(mib(peak))"
	}
}

/** Derives each master-keys vector in this process and checks every output. */
func checkVectors(in process: String) throws -> [Result] {
	guard let url = Bundle.main.url(forResource: "test-vectors", withExtension: "json") else {
		throw VaulyCoreError.format("test-vectors.json isn't in the bundle")
	}
	let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
	var results: [Result] = []
	for vector in vectors.masterKeys {
		let before = footprint().now
		let start = DispatchTime.now().uptimeNanoseconds
		let master = try masterBits(
			password: vector.password, salt: Data(base64Encoded: vector.salt)!, kdf: vector.kdf)
		let seconds = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e9
		let auth = hkdf(master, "vauly/auth").withUnsafeBytes { hex($0) }
		let wrap = hkdf(master, "vauly/wrap")
		let opened = try open(vector.wrapKeyCheck.sealed, with: wrap)
		let matches =
			hex(master) == vector.masterKey && auth == vector.authKey
			&& wrap.withUnsafeBytes { hex($0) } == vector.wrapKey
			&& String(decoding: opened, as: UTF8.self) == vector.wrapKeyCheck.plaintext
			&& vector.password.precomposedStringWithCompatibilityMapping == vector.passwordNfkc
		let memory = vector.kdf.kdf == "argon2id" ? "\(vector.kdf.kdfMemory ?? 0) KiB, \(vector.kdf.kdfPasses ?? 0) passes" : "\(vector.kdf.kdfIterations) rounds"
		let result = Result(
			label: "\(process) \(vector.kdf.kdf) (\(memory))", matches: matches, seconds: seconds,
			before: before, peak: footprint().peak)
		log.notice("VAULY-PROTO \(result.description, privacy: .public)")
		results.append(result)
	}
	return results
}

struct CachedItem: Codable {
	let name: String
	let username: String
	let password: String
	let urls: [String]
	let notes: String
	let totp: String
}

/**
 * A master-password unlock against a cache of `count` items: the ciphertext as read from
 * the cache, then Argon2id, then every item opened and decoded, as a list screen would.
 */
func unlockWithCache(count: Int, in process: String) throws -> String {
	let itemKey = SymmetricKey(size: .bits256)
	let sealed: [Data] = try (0..<count).map { index in
		let item = CachedItem(
			name: "Item \(index) — Office Wi-Fi", username: "person\(index)@example.com",
			password: String(repeating: "x", count: 24),
			urls: ["https://service\(index).example.com/login"],
			notes: String(repeating: "Some notes about this login. ", count: 8),
			totp: "otpauth://totp/Example:person?secret=JBSWY3DPEHPK3PXP")
		return try AES.GCM.seal(JSONEncoder().encode(item), using: itemKey).combined!
	}
	let before = footprint().now
	let start = DispatchTime.now().uptimeNanoseconds
	let kdf = Kdf(kdf: "argon2id", kdfIterations: 600_000, kdfPasses: 3, kdfMemory: 65_536)
	_ = try masterBits(password: "correct horse battery staple", salt: Data(count: 16), kdf: kdf)
	let derived = DispatchTime.now().uptimeNanoseconds
	let items = try sealed.map {
		try JSONDecoder().decode(
			CachedItem.self, from: AES.GCM.open(AES.GCM.SealedBox(combined: $0), using: itemKey))
	}
	let end = DispatchTime.now().uptimeNanoseconds
	let text =
		"\(process) unlock with \(items.count) items: Argon2id \(String(format: "%.2f", Double(derived - start) / 1e9)) s, opening them \(String(format: "%.3f", Double(end - derived) / 1e9)) s, footprint \(mib(before)) with the cache, peak \(mib(footprint().peak)), \(mib(footprint().now)) after"
	log.notice("VAULY-PROTO \(text, privacy: .public)")
	return text
}
