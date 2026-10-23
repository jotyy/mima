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
	| { type: "vauly:offer?" };

/** Asked by vauly's frame, about the tab it sits in. */
export type FrameRequest =
	| { type: "vauly:menu" }
	| { type: "vauly:fill"; id: string }
	| { type: "vauly:offer" }
	| { type: "vauly:save"; vaultId: string; name: string; username: string }
	| { type: "vauly:update" }
	| { type: "vauly:dismiss" };

export type Request = PageRequest | FrameRequest;

/** Sent by the background to the page script. */
export type PageMessage =
	/** A login was just captured on this page; offer to save it. */
	| { type: "vauly:offer-ready" }
	/** A fill is about to focus the page's fields; don't open the menu for that. */
	| { type: "vauly:filling" };

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
