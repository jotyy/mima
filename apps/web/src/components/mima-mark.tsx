import { cn } from "@mima/ui/lib/utils";

export function MimaMark({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"bg-cta text-cta-fg text-tiny inline-flex size-4 shrink-0 items-center justify-center rounded-xs font-medium",
				className,
			)}
		>
			m
		</span>
	);
}
