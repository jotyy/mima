import { cn } from "@mima/ui/lib/utils";
import {
	GlobeIcon,
	KeyIcon,
	NoteIcon,
	RobotIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";

import type { ItemKind } from "@/lib/vault-data";

const kindIcon = {
	login: GlobeIcon,
	"api-key": KeyIcon,
	note: NoteIcon,
	"ssh-key": TerminalWindowIcon,
	agent: RobotIcon,
} as const;

export const kindLabel: Record<ItemKind, string> = {
	login: "Login",
	"api-key": "API key",
	note: "Secure note",
	"ssh-key": "SSH key",
};

const sizes = {
	sm: { tile: "size-6 rounded-full", icon: "size-3.5" },
	default: { tile: "size-7 rounded-md", icon: "size-4" },
	lg: { tile: "size-10 rounded-lg", icon: "size-5" },
};

export function ItemTile({
	kind,
	size = "default",
	className,
}: {
	kind: ItemKind | "agent";
	size?: keyof typeof sizes;
	className?: string;
}) {
	const Icon = kindIcon[kind];
	return (
		<span
			className={cn(
				"bg-surface text-fg-muted shadow-pill inline-flex shrink-0 items-center justify-center",
				sizes[size].tile,
				className,
			)}
		>
			<Icon className={sizes[size].icon} />
		</span>
	);
}
