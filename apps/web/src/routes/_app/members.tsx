import { Avatar, AvatarFallback } from "@mima/ui/components/avatar";
import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@mima/ui/components/dropdown-menu";
import { Input } from "@mima/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mima/ui/components/select";
import {
	DotsThreeIcon,
	UserMinusIcon,
	UserSwitchIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { notify } from "@/components/notify";
import { Page } from "@/components/page";
import { currentMemberId, members, vaults, workspace } from "@/fixtures/vault";
import { initials, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_app/members")({
	component: Members,
});

const roles = [
	{ value: "Member", label: "Member" },
	{ value: "Admin", label: "Admin" },
];

function Members() {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState("Member");
	const people = members.filter((member) => !member.invited);

	return (
		<Page
			title="Members"
			description={`${people.length} people in ${workspace.name}. Invites expire after 7 days.`}
		>
			<form
				className="rounded-window bg-surface shadow-card mb-3 flex items-center gap-2 p-2"
				onSubmit={(event) => {
					event.preventDefault();
					if (!email) return;
					notify.success(`Invite sent to ${email}`);
					setEmail("");
				}}
			>
				<Input
					type="email"
					placeholder="name@acme.example"
					aria-label="Email address"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					className="flex-1 border-transparent hover:border-transparent"
				/>
				<Select
					items={roles}
					value={role}
					onValueChange={(value) => value && setRole(String(value))}
				>
					<SelectTrigger className="w-28">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{roles.map((r) => (
							<SelectItem key={r.value} value={r.value}>
								{r.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button type="submit">Invite</Button>
			</form>

			<section className="divide-line-subtle rounded-window bg-surface shadow-card flex flex-col divide-y">
				{members.map((member) => {
					const vaultCount = vaults.filter((vault) =>
						vault.memberIds.includes(member.id),
					).length;
					return (
						<div
							key={member.id}
							className="flex items-center gap-3 px-3.5 py-3"
						>
							<Avatar>
								<AvatarFallback>{initials(member.name)}</AvatarFallback>
							</Avatar>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<div className="flex items-center gap-2">
									<span className="text-body-sm text-fg">{member.name}</span>
									{member.id === currentMemberId && (
										<Badge variant="secondary">You</Badge>
									)}
									{member.invited && <Badge variant="brand">Invited</Badge>}
								</div>
								<span className="text-caption text-fg-subtle">
									{member.email}
								</span>
							</div>
							<span className="text-caption text-fg-muted w-20">
								{member.role}
							</span>
							<span className="text-caption text-fg-subtle w-20">
								{member.invited
									? "—"
									: `${vaultCount} ${vaultCount === 1 ? "vault" : "vaults"}`}
							</span>
							<span className="text-caption text-fg-subtle w-24 text-right">
								{member.invited
									? "invite pending"
									: member.lastActiveMin === 0
										? "active now"
										: timeAgo(member.lastActiveMin)}
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Manage ${member.name}`}
											disabled={member.id === currentMemberId}
										/>
									}
								>
									<DotsThreeIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-44">
									<DropdownMenuItem>
										<UserSwitchIcon />
										Change role
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive">
										<UserMinusIcon />
										{member.invited ? "Cancel invite" : "Remove"}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				})}
			</section>
		</Page>
	);
}
