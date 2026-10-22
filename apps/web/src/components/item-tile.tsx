import { cn } from "@mima/ui/lib/utils";
import {
	GlobeIcon,
	KeyIcon,
	NoteIcon,
	RobotIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";

import type { CSSProperties } from "react";

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

export function ItemTile({
	kind,
	size = "default",
	className,
	style,
}: {
	kind: ItemKind | "agent";
	size?: "default" | "lg";
	className?: string;
	style?: CSSProperties;
}) {
	const Icon = kindIcon[kind];
	return (
		<span
			style={style}
			className={cn(
				"bg-surface text-fg-muted shadow-pill inline-flex shrink-0 items-center justify-center",
				size === "lg" ? "size-10 rounded-lg" : "size-7 rounded-md",
				className,
			)}
		>
			<Icon className={size === "lg" ? "size-5" : "size-4"} />
		</span>
	);
}
