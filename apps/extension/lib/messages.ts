import type { Assertion, CreatedCredential } from "./passkey";

// What the page script, vauly's frame inside the page and the background say to each
// other. Passwords only ever travel from the page script to the background: the frame
// asks the background to fill or save, and never holds a secret itself.

/** A login the page script saw being submitted. */
export type LoginMessage = {
	type: "vauly:login";
	username: string;
	password: string;
};

/** Asked by the page script. */
export type PageRequest =
	| LoginMessage
	/** Someone focused a login field: is there anything to show? */
	| { type: "vauly:field" }
	/** The page loaded: is a login from before waiting to be saved? */
	| { type: "vauly:offer?" }
	/** The site asked for a passkey; `request` is its options as JSON, unchecked. */
	| {
			type: "vauly:passkey";
			id: string;
			kind: "create" | "get";
			request: unknown;
	  }
	/** The site gave up waiting for the passkey. */
	| { type: "vauly:passkey-abort"; id: string }
	/** Can the site count on a passkey from vauly here? */
	| { type: "vauly:passkey-available" };

/** Asked by vauly's frame, about the tab it sits in. */
export type FrameRequest =
	| { type: "vauly:menu" }
	| { type: "vauly:fill"; id: string }
	| { type: "vauly:offer" }
	| { type: "vauly:save"; vaultId: string; name: string; username: string }
	| { type: "vauly:update" }
	| { type: "vauly:dismiss" }
	| { type: "vauly:passkey-state" }
	| { type: "vauly:passkey-save"; vaultId: string }
	| { type: "vauly:passkey-use"; itemId: string }
	/** Not with vauly: with the browser's own passkeys (`another`), or not at all. */
	| { type: "vauly:passkey-decline"; another: boolean };

export type Request = PageRequest | FrameRequest;

/** Sent by the background to the page script. */
export type PageMessage =
	/** A login was just captured on this page; offer to save it. */
	| { type: "vauly:offer-ready" }
	/** A fill is about to focus the page's fields; don't open the menu for that. */
	| { type: "vauly:filling" }
	/** The person chose in vauly's passkey prompt; hand the outcome to the site. */
	| { type: "vauly:passkey-done"; id: string; outcome: PasskeyOutcome };

/**
 * What becomes of a site's passkey request: the browser's own passkeys take it, vauly
 * answers with a credential or an error, or (only to the content script) vauly asks first.
 */
export type PasskeyOutcome =
	| { next: "browser" }
	| { next: "prompt" }
	| { next: "credential"; credential: CreatedCredential | Assertion }
	| {
			next: "error";
			name: "NotAllowedError" | "InvalidStateError";
			message: string;
	  };

/** Between the passkey script in the page and vauly's content script, by postMessage. */
export type PasskeyCall =
	| { vauly: "passkey"; id: string; kind: "create" | "get"; request: unknown }
	| { vauly: "passkey"; id: string; kind: "available" }
	| { vauly: "passkey-abort"; id: string };

export type PasskeyReply =
	/** The content script is there, and has the request. */
	| { vauly: "passkey-ack"; id: string }
	| { vauly: "passkey-result"; id: string; outcome: PasskeyOutcome }
	| { vauly: "passkey-available"; id: string; available: boolean };

/** What vauly's passkey prompt shows; never a key. */
export type PasskeyState =
	| { status: "none" }
	| { status: "locked"; kind: "create" | "get"; rpId: string }
	| {
			status: "create";
			rpId: string;
			userName: string;
			/** The login it goes into, when one for this account is saved already. */
			into?: { name: string; vault: string };
			vaults: { id: string; name: string }[];
	  }
	/** vauly has this account's passkey already, and the site asked not to make another. */
	| { status: "exists"; rpId: string; name: string }
	| {
			status: "get";
			rpId: string;
			passkeys: {
				itemId: string;
				name: string;
				userName?: string;
				logo: string | null;
			}[];
	  };

export type MenuLogin = {
	id: string;
	name: string;
	username?: string;
	logo: string | null;
};

export type MenuState =
	| { status: "signed-out" }
	| { status: "locked" }
	| { status: "ready"; host: string; logins: MenuLogin[] };

/** What the frame shows of a login waiting to be saved: never its password. */
export type OfferView =
	| { kind: "save"; host: string; username: string }
	| { kind: "update"; host: string; username: string; entryName: string };

export type OfferState =
	| { status: "none" }
	| { status: "locked"; host: string }
	| {
			status: "ready";
			offer: OfferView;
			vaults: { id: string; name: string }[];
	  };

export type Done =
	| { ok: true; message?: string }
	| { ok: false; error: string };

export type FillResult = { ok: boolean; code?: string };

/** Sends a request to the background and waits for its answer. */
export function ask<T>(request: Request): Promise<T | null> {
	return browser.runtime
		.sendMessage(request)
		.catch(() => null) as Promise<T | null>;
}
