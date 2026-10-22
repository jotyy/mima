import type { Agent, Item, Member, Vault, VaultEvent } from "./vault-data";

const durations: Record<string, string> = {
	once: "for one run",
	hour: "for 1 hour",
	day: "for 1 day",
	always: "until revoked",
};

/** Turns an audit event into "<actor> <verb> <object> · <detail>" using decrypted names. */
export function describeEvent(
	event: VaultEvent,
	lookup: {
		items: Map<string, Item>;
		vaults: Map<string, Vault>;
		agents: Map<string, Agent>;
		members: Map<string, Member>;
	},
) {
	const item = event.itemId ? lookup.items.get(event.itemId) : undefined;
	const vault = event.vaultId ? lookup.vaults.get(event.vaultId) : undefined;
	const itemName = item?.name ?? (event.itemId ? "a deleted item" : undefined);
	const subject = event.subjectId
		? (lookup.agents.get(event.subjectId)?.name ??
			lookup.members.get(event.subjectId)?.name)
		: undefined;

	const parts = (verb: string, object?: string, detail?: string) => ({
		actor: event.actorName,
		verb,
		object,
		detail,
		vault,
	});

	switch (event.action) {
		case "created":
			if (event.itemId) return parts("added", itemName);
			if (event.detail?.startsWith("agent "))
				return parts("created the agent", event.detail.slice(6));
			return parts("created the vault", vault?.name);
		case "updated":
			return parts("updated", itemName);
		case "deleted":
			if (event.itemId) return parts("deleted", itemName);
			if (event.detail?.startsWith("agent "))
				return parts("deleted the agent", event.detail.slice(6));
			return parts("deleted a vault");
		case "revealed":
			return parts(`revealed the ${field(event.detail)} of`, itemName);
		case "copied":
			return parts(`copied the ${field(event.detail)} of`, itemName);
		case "injected":
			return parts(
				"injected",
				itemName,
				event.detail ? `into ${event.detail}` : undefined,
			);
		case "requested":
			return parts(
				"asked to use",
				itemName,
				event.detail ? `for ${event.detail}` : undefined,
			);
		case "approved":
			return parts(
				`let ${subject ?? "an agent"} use`,
				itemName,
				durations[event.detail ?? ""],
			);
		case "denied":
			return parts(`denied ${subject ?? "an agent"} access to`, itemName);
		case "granted":
			return parts(
				`let ${subject ?? "an agent"} use`,
				itemName,
				durations[event.detail ?? ""],
			);
		case "revoked":
			if (event.itemId)
				return parts(`revoked ${subject ?? "an agent"} from`, itemName);
			if (event.vaultId)
				return parts(
					`removed ${subject ?? "someone"} from`,
					vault?.name ?? "a vault",
				);
			return parts(`removed ${subject ?? "someone"} from the workspace`);
		case "shared":
			return parts(
				`gave ${subject ?? "someone"} access to`,
				vault?.name ?? "a vault",
			);
		case "joined":
			return parts(
				"joined the workspace",
				undefined,
				event.detail ?? undefined,
			);
		case "invited":
			return parts("invited", event.detail ?? "someone");
		case "imported": {
			const count = Number(event.detail ?? 0);
			return parts(
				"imported",
				`${count} ${count === 1 ? "item" : "items"}`,
				vault ? `into ${vault.name}` : undefined,
			);
		}
		default:
			return parts(event.action, itemName);
	}
}

function field(detail: string | null | undefined) {
	if (!detail || detail === "secret") return "password";
	return detail;
}
