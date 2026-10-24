import AuthenticationServices
import SwiftUI

@main
struct ProtoApp: App {
	var body: some Scene {
		WindowGroup { ContentView() }
	}
}

struct ContentView: View {
	@State private var report = "Not run yet"
	@State private var username = ""

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			Text(report).font(.footnote).accessibilityIdentifier("report")
			Button("Run in the app") { run() }
			Button("Turn on AutoFill") { Task { await turnOn() } }
			TextField("Username", text: $username)
				.textContentType(.username)
				.textFieldStyle(.roundedBorder)
				.accessibilityIdentifier("username")
		}
		.padding()
		.onAppear {
			if ProcessInfo.processInfo.arguments.contains("-runCheck") { run() }
		}
	}

	private func run() {
		do {
			report = try checkVectors(in: "app").map(\.description).joined(separator: "\n")
		} catch {
			report = "\(error)"
		}
	}

	private func turnOn() async {
		if #available(iOS 18.0, *) {
			_ = try? await ASSettingsHelper.requestToTurnOnCredentialProviderExtension()
		}
	}
}
