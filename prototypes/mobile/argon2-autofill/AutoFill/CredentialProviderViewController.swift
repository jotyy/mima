import AuthenticationServices
import UIKit

// The AutoFill extension runs the same derivations as the app, in its own process, when
// iOS opens its list (the path a master-password unlock would take).
final class CredentialProviderViewController: ASCredentialProviderViewController {
	private let label = UILabel()

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = .systemBackground
		label.numberOfLines = 0
		label.font = .preferredFont(forTextStyle: .footnote)
		label.accessibilityIdentifier = "report"
		label.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(label)
		NSLayoutConstraint.activate([
			label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
			label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
			label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
		])
	}

	override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
		run()
	}

	override func prepareInterfaceForExtensionConfiguration() {
		run()
	}

	private func run() {
		log.notice("VAULY-PROTO extension started, footprint \(mib(footprint().now), privacy: .public)")
		label.text = "Deriving…"
		DispatchQueue.global(qos: .userInitiated).async {
			let text: String
			do {
				let unlock = try unlockWithCache(count: 1_000, in: "extension")
				let vectors = try checkVectors(in: "extension").map(\.description)
				text = ([unlock] + vectors).joined(separator: "\n")
			} catch {
				text = "\(error)"
			}
			DispatchQueue.main.async { self.label.text = text }
		}
	}
}
