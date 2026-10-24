import {
	ask,
	type PageMessage,
	type PasskeyCall,
	type PasskeyOutcome,
	type PasskeyReply,
} from "@/lib/messages";

// Carries passkey requests between the script in the page and the background, which asks
// the person in a window of its own. Only the top frame's own window is listened to: an
// embedded site's frame can't ask through it. From document start, so a site that asks
// as soon as it loads still reaches vauly.
export default defineContentScript({
	matches: ["https://*/*", "http://localhost/*"],
	runAt: "document_start",
	noScriptStartedPostMessage: true,
	main() {
		const reply = (message: PasskeyReply) =>
			window.postMessage(message, location.origin);
		const answer = (id: string, outcome: PasskeyOutcome) =>
			reply({ vauly: "passkey-result", id, outcome });

		window.addEventListener("message", async (event) => {
			if (event.source !== window) return;
			const call = event.data as PasskeyCall | undefined;
			if (typeof call?.id !== "string") return;
			if (call.vauly === "passkey-abort") {
				void ask({ type: "vauly:passkey-abort", id: call.id });
				return;
			}
			if (call.vauly !== "passkey") return;
			reply({ vauly: "passkey-ack", id: call.id });
			const outcome = await ask<PasskeyOutcome>({
				type: "vauly:passkey",
				id: call.id,
				kind: call.kind,
				request: call.request,
			});
			// While vauly's window asks, the answer comes later, as vauly:passkey-done.
			if (outcome?.next !== "prompt")
				answer(call.id, outcome ?? { next: "browser" });
		});

		browser.runtime.onMessage.addListener(
			(message: PageMessage, _sender, respond) => {
				if (message.type !== "vauly:passkey-done") return;
				answer(message.id, message.outcome);
				respond(true);
			},
		);
	},
});
