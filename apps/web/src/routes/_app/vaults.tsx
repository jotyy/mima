import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
} from "@mima/ui/components/avatar";
import { ArrowUpRightIcon, PlusIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Page } from "@/components/page";
import { agents, findMember, items, vaults } from "@/fixtures/vault";
import { initials, toneDot } from "@/lib/format";

export const Route = createFileRoute("/_app/vaults")({
	component: Vaults,
});

function Vaults() {
	return (
		<Page
			title="Vaults"
			description="Group items and decide who can open them."
		>
			<div className="grid grid-cols-2 gap-3">
				{vaults.map((vault) => {
					const inVault = items.filter((item) => item.vaultId === vault.id);
					const agentCount = agents.filter((agent) =>
						agent.itemIds.some((id) => inVault.some((item) => item.id === id)),
					).length;
					return (
						<Link
							key={vault.id}
							to="/items"
							search={{ vault: vault.slug }}
							className="group/vault rounded-window bg-surface shadow-card hover:shadow-popover flex flex-col p-3.5 transition-shadow"
						>
							<div className="flex items-center gap-2">
								<span
									className={`size-2 rounded-full ${toneDot[vault.tone]}`}
								/>
								<span className="text-body-sm text-fg flex-1 font-medium">
									{vault.name}
								</span>
								<ArrowUpRightIcon className="text-fg-subtle group-hover/vault:text-fg size-3.5 transition-colors" />
							</div>
							<p className="text-caption text-fg-subtle mt-1.5">
								{vault.description}
							</p>
							<div className="mt-5 flex items-end justify-between">
								<div className="flex gap-6">
									<Figure value={inVault.length} label="items" />
									<Figure value={agentCount} label="agents" />
								</div>
								<AvatarGroup>
									{vault.memberIds.map((id) => {
										const member = findMember(id);
										return (
											<Avatar key={id} size="sm">
												<AvatarFallback>
													{initials(member?.name ?? "?")}
												</AvatarFallback>
											</Avatar>
										);
									})}
								</AvatarGroup>
							</div>
						</Link>
					);
				})}
				<button
					type="button"
					className="rounded-window border-line text-caption text-fg-muted hover:border-line-strong hover:text-fg flex min-h-36 flex-col items-center justify-center gap-2 border border-dashed transition-colors"
				>
					<PlusIcon className="size-4" />
					New vault
				</button>
			</div>
		</Page>
	);
}

function Figure({ value, label }: { value: number; label: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-fg text-stat tabular-nums">{value}</span>
			<span className="text-caption text-fg-subtle mt-1.5">{label}</span>
		</div>
	);
}
