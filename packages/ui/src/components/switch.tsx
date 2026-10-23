import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@vauly/ui/lib/utils";

function Switch({
	className,
	size = "default",
	...props
}: SwitchPrimitive.Root.Props & {
	size?: "sm" | "default";
}) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				"peer group/switch aria-invalid:border-danger data-checked:bg-brand data-unchecked:bg-line data-unchecked:inset-shadow-line relative inline-flex shrink-0 items-center rounded-full border border-transparent transition duration-200 ease-out after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="shadow-pill ease-emphasized pointer-events-none block rounded-full bg-white transition-transform duration-200 group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:translate-x-0.5 group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:translate-x-px group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
