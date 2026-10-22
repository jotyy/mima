import { Button } from "@mima/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mima/ui/components/tooltip";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { copyToClipboard } from "./notify";

export function CopyButton({
	value,
	label,
	source,
	secret = true,
	onCopied,
}: {
	value: string;
	label: string;
	/** Where the value came from, e.g. the item name. */
	source?: string;
	/** Secrets clear from the clipboard after 90 seconds. */
	secret?: boolean;
	onCopied?: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		if (!(await copyToClipboard(value, { label, source, secret }))) return;
		setCopied(true);
		onCopied?.();
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
