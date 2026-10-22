import { Button } from "@mima/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mima/ui/components/tooltip";
import { cn } from "@mima/ui/lib/utils";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { CopyButton } from "./copy-button";

export function SecretValue({
	value,
	label,
}: {
	value: string;
	label: string;
}) {
	const [revealed, setRevealed] = useState(false);

	return (
		<div className="flex min-w-0 items-center gap-1">
			<span
				className={cn(
					"text-caption min-w-0 flex-1 truncate font-mono",
					revealed ? "text-fg" : "text-fg-subtle tracking-widest",
				)}
			>
				{revealed ? value : "•".repeat(Math.min(value.length, 16))}
			</span>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
							onClick={() => setRevealed((shown) => !shown)}
						/>
					}
				>
					{revealed ? <EyeSlashIcon /> : <EyeIcon />}
				</TooltipTrigger>
				<TooltipContent>
					{revealed ? "Hide" : "Reveal with Touch ID"}
				</TooltipContent>
			</Tooltip>
			<CopyButton value={value} label={label} />
		</div>
	);
}
