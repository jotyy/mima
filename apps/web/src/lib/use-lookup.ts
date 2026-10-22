import { useMemo } from "react";

import { useAgents, useItems, useMembers, useVaults } from "./vault-data";

/** Id → decrypted record maps, for naming things in events and requests. */
export function useLookup() {
	const items = useItems();
	const vaults = useVaults();
	const agents = useAgents();
	const members = useMembers();
	return useMemo(
		() => ({
			items: new Map((items.data ?? []).map((row) => [row.id, row])),
			vaults: new Map((vaults.data ?? []).map((row) => [row.id, row])),
			agents: new Map((agents.data ?? []).map((row) => [row.id, row])),
			members: new Map(
				(members.data?.members ?? []).map((row) => [row.userId, row]),
			),
		}),
		[items.data, vaults.data, agents.data, members.data],
	);
}
