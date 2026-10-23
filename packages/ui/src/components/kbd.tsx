import { cn } from "@vauly/ui/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn(
				"border-line bg-surface text-micro text-fg-subtle in-data-[slot=tooltip-content]:bg-cta-fg/15 in-data-[slot=tooltip-content]:text-cta-fg pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-md border px-1 font-sans select-none in-data-[slot=tooltip-content]:border-transparent [&_svg:not([class*='size-'])]:size-3",
				className,
			)}
			{...props}
		/>
	);
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<kbd
			data-slot="kbd-group"
			className={cn("inline-flex items-center gap-1", className)}
			{...props}
		/>
	);
}

export { Kbd, KbdGroup };
