import { mountFrames } from "@/lib/frames";
import {
	ask,
	type PageMessage,
	type PasskeyCall,
	type PasskeyOutcome,
	type PasskeyReply,
} from "@/lib/messages";

// Carries passkey requests between the script in the page and the background, and shows
// vauly's passkey prompt when the background wants to ask. Only the top frame's own
// window is listened to: an embedded site's frame can't ask through it. From document
// start, so a site that asks as soon as it loads still reaches vauly.
export default defineContentScript({
	matches: ["https://*/*", "http://localhost/*"],
	runAt: "document_start",
	noScriptStartedPostMessage: true,
	main() {
		const frames = mountFrames();
		/** The request vauly's prompt is open for. */
		let waiting: string | null = null;
		/** Requests the site gave up on before the background had answered. */
		const abandoned = new Set<string>();

		const reply = (message: PasskeyReply) =>
			window.postMessage(message, location.origin);
		const answer = (id: string, outcome: PasskeyOutcome) => {
			if (waiting === id) waiting = null;
			reply({ vauly: "passkey-result", id, outcome });
		};

		window.addEventListener("message", async (event) => {
			if (event.source !== window) return;
			const call = event.data as PasskeyCall | undefined;
			if (call?.vauly === "passkey-abort") {
				abandoned.add(call.id);
				if (call.id === waiting) {
					waiting = null;
					frames.close("passkey");
				}
				void ask({ type: "vauly:passkey-abort", id: call.id });
				return;
			}
			if (call?.vauly !== "passkey" || typeof call.id !== "string") return;
			reply({ vauly: "passkey-ack", id: call.id });

			if (call.kind === "available") {
				const result = await ask<{ available: boolean }>({
					type: "vauly:passkey-available",
				});
				reply({
					vauly: "passkey-available",
					id: call.id,
					available: result?.available === true,
				});
				return;
			}
			// A new request takes the place of one still waiting, as the browser's own does.
			if (waiting) {
				answer(waiting, {
					next: "error",
					name: "NotAllowedError",
					message: "Another passkey request took its place.",
				});
				frames.close("passkey");
			}
			const outcome = await ask<PasskeyOutcome>({
				type: "vauly:passkey",
				id: call.id,
				kind: call.kind,
				request: call.request,
			});
			if (abandoned.has(call.id)) {
				void ask({ type: "vauly:passkey-abort", id: call.id });
				return;
			}
			if (outcome?.next === "prompt") {
				waiting = call.id;
				frames.show("passkey");
				return;
			}
			answer(call.id, outcome ?? { next: "browser" });
		});

		// What the person chose in the prompt. The prompt closes itself once it's said so.
		browser.runtime.onMessage.addListener(
			(message: PageMessage, _sender, respond) => {
				if (message.type !== "vauly:passkey-done") return;
				answer(message.id, message.outcome);
				respond(true);
			},
		);
	},
});
