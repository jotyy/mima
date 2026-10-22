import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@mima/ui/lib/utils";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"border-line bg-surface text-input text-fg file:text-body-sm file:text-fg hover:border-line-strong focus-visible:border-brand focus-visible:ring-brand-soft disabled:bg-surface-sunken aria-invalid:border-danger aria-invalid:ring-danger-soft h-8 w-full min-w-0 rounded-lg border px-3 py-1 transition-[border-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:ring-3",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
