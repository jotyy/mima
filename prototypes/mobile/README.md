# Mobile prototypes (#8)

Throwaway code that answers two of the questions in [docs/rfcs/mobile.md](../../docs/rfcs/mobile.md#prototype-first) before the apps are built. It lives on the `proto/8-mobile` branch and isn't meant to be merged.

## argon2-autofill: Argon2id inside an iOS AutoFill extension

A small app and an AutoFill credential provider extension that share one Swift file, `Shared/VaulyCore.swift`. It unlocks the way the web app does: Argon2id from libsodium ([swift-sodium](https://github.com/jedisct1/swift-sodium) 0.9.1), or PBKDF2-SHA256 from CommonCrypto, then HKDF `vauly/auth` and `vauly/wrap` and AES-256-GCM from CryptoKit. It checks every `masterKeys` vector in `packages/crypto/test-vectors.json` and records the time, and the process's memory as iOS counts it (`phys_footprint`, and its peak).

```sh
cd prototypes/mobile/argon2-autofill
xcodegen generate
# The vectors, in a unit test:
xcodebuild -project VaulyProto.xcodeproj -scheme VaulyProto -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build -only-testing:VaulyProtoTests test
# The extension: turns it on, taps a username field, picks it from Passwords. Needs the
# simulator's software keyboard (Simulator › I/O › Keyboard › Connect Hardware Keyboard off).
xcodebuild ... -only-testing:VaulyProtoUITests/AutoFillUITests/testOpensTheExtension test
xcrun simctl spawn booted log show --last 5m --predicate 'eventMessage CONTAINS "VAULY-PROTO"'
```

Results on the iOS 26.5 simulator, on an M5 Pro, October 24, 2026:

| In the AutoFill extension's own process                     | Result                                 |
| ----------------------------------------------------------- | -------------------------------------- |
| The four `masterKeys` vectors (Argon2id ×2, PBKDF2 ×2)      | All match, byte for byte               |
| Footprint when the extension starts                         | 22.3 MiB                               |
| Argon2id, 64 MiB, 3 passes, 1 lane                          | 0.09–0.10 s; peak 86.9 MiB (+64.3 MiB) |
| A master-password unlock with a 1,000-item cache            | Peak 87.5 MiB; opening all items 4 ms  |
| PBKDF2-SHA256, 600,000 rounds (accounts that haven't moved) | 0.07–0.08 s                            |

What it doesn't show:
- **The limit.** The simulator doesn't enforce extension memory limits; only a device does. Vendors report about 120 MB for AutoFill, and Bitwarden and Strongbox warn above 64 MiB of Argon2 memory. So the peak leaves about 30 MiB for everything else, on a device that allows 120.
- **A phone's speed.** The simulator runs on the Mac's CPU. Expect a phone to be several times slower.
- **A real extension's UI.** This one shows a label. A list with search adds to the 22 MiB start.

A device run needs an iPhone and an Apple ID to sign with; nothing else changes.

## capacitor-shell: apps/web in Capacitor

Capacitor 8.5.2 around the web app's production build, with CocoaPods (the Swift Package Manager route stalled resolving Capacitor's binary frameworks, here).

```sh
cd apps/web && VITE_SERVER_URL=https://demo-api.vauly.app VITE_DEMO_EMAIL=… VITE_DEMO_PASSWORD=… bun run build
cd prototypes/mobile/capacitor-shell && npm install && npx cap add ios --packagemanager CocoaPods
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app
# Signs in to the demo from the shell:
cd ../argon2-autofill && xcodebuild ... -only-testing:VaulyProtoUITests/AutoFillUITests/testShellSignsInToTheDemo test
```

What it showed:
- **It signs in to the demo and unlocks, unchanged, in 2.6 s** from a fresh install: WebCrypto, the Argon2id key worker and the API all work under `capacitor://localhost`. The bundled `/vauly.json` names the server, so one build serves any instance once the app asks for an address.
- **Only with Capacitor's native HTTP on** (`CapacitorHttp`), which sends `fetch` through the app instead of the WebView. Without it the API's CORS refuses `capacitor://localhost`, and the app says "You're offline. This needs a connection." The apps need either that, or the server allowing the app's origins, with bearer sessions instead of a third-party cookie.
- **The layout needs a phone pass.** The demo banner runs under the status bar (safe areas), and the WebView lays the page out wider than the screen, which mobile Chrome at the same width doesn't.
