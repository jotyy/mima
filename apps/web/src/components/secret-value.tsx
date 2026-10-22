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
	source,
	onReveal,
	onCopied,
}: {
	value: string;
	label: string;
	source?: string;
	onReveal?: () => void;
	onCopied?: () => void;
}) {
	const [revealed, setRevealed] = useState(false);
	const multiline = value.includes("\n");

	return (
		<div className="flex min-w-0 flex-1 items-start gap-1">
			<span
				className={cn(
					"text-caption min-w-0 flex-1 py-1 font-mono",
					revealed
						? cn(
								"text-fg",
								multiline ? "break-all whitespace-pre-wrap" : "break-all",
							)
						: "text-fg-subtle truncate tracking-widest",
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
							onClick={() => {
								if (!revealed) onReveal?.();
								setRevealed((shown) => !shown);
							}}
						/>
					}
				>
					{revealed ? <EyeSlashIcon /> : <EyeIcon />}
				</TooltipTrigger>
				<TooltipContent>{revealed ? "Hide" : "Reveal"}</TooltipContent>
			</Tooltip>
			<CopyButton
				value={value}
				label={label}
				source={source}
				onCopied={onCopied}
			/>
		</div>
	);
}
