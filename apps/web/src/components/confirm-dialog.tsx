import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mima/ui/components/dialog";
import { type ReactNode, useState } from "react";

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirm,
	destructive,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	confirm: string;
	destructive?: boolean;
	onConfirm: () => Promise<unknown> | unknown;
}) {
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await onConfirm();
								onOpenChange(false);
							} finally {
								setBusy(false);
							}
						}}
					>
						{confirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
