import { Button } from "@mima/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mima/ui/components/tooltip";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

export function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		toast.success(`Copied ${label}`, {
			description: "Clears from the clipboard in 90 seconds.",
		});
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Copy ${label}`}
						onClick={copy}
					/>
				}
			>
				{copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
			</TooltipTrigger>
			<TooltipContent>Copy {label}</TooltipContent>
		</Tooltip>
	);
}
