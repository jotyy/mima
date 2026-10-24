import XCTest

// Opens the AutoFill extension the way a person would: turn vauly proto on as a provider,
// tap a username field, pick it from the keyboard's passwords button. Simulator UI changes
// between iOS versions, so this records what it sees as it goes.
final class AutoFillUITests: XCTestCase {
	/** Where screenshots go: TEST_RUNNER_VAULY_PROTO_SHOTS, or the runner's temporary folder. */
	let shots = ProcessInfo.processInfo.environment["VAULY_PROTO_SHOTS"] ?? NSTemporaryDirectory()
	let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

	func shot(_ name: String) {
		try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/\(name).png"))
	}

	func testOpensTheExtension() throws {
		let app = XCUIApplication()
		app.launch()
		app.buttons["Turn on AutoFill"].tap()
		let turnOn = springboard.alerts.buttons["Turn On"]
		if turnOn.waitForExistence(timeout: 5) { turnOn.tap() }
		sleep(1)
		app.textFields["username"].tap()
		shot("2-field")
		app.buttons["Passwords"].firstMatch.tap()
		let provider = app.buttons["vauly proto"]
		XCTAssertTrue(provider.waitForExistence(timeout: 5))
		provider.tap()
		sleep(8)
		shot("3-extension")
	}

	/** The Capacitor shell (../capacitor-shell), installed separately, signs in to the demo. */
	func testShellSignsInToTheDemo() throws {
		let shell = XCUIApplication(bundleIdentifier: "app.vauly.proto.shell")
		shell.launch()
		let signIn = shell.webViews.buttons["Sign in"]
		XCTAssertTrue(signIn.waitForExistence(timeout: 30))
		shot("shell-1-sign-in")
		let start = Date()
		signIn.tap()
		// At phone width the sidebar sits behind Menu, so look for the item search.
		let vault = shell.webViews.textFields["Find an item"]
		let signedIn = vault.waitForExistence(timeout: 60)
		print("SHELL signed in: \(signedIn), after \(String(format: "%.1f", Date().timeIntervalSince(start))) s")
		shot("shell-2-after-sign-in")
		if !signedIn { print("SHELL TREE:\n\(shell.debugDescription)") }
		XCTAssertTrue(signedIn)
	}
}
