import XCTest

@testable import VaulyProto

final class VaulyCoreTests: XCTestCase {
	func testMasterKeysMatchTheVectors() throws {
		let results = try checkVectors(in: "unit test")
		XCTAssertEqual(results.count, 4)
		for result in results {
			XCTAssertTrue(result.matches, result.description)
		}
	}
}
