import { cn } from "@vauly/ui/lib/utils";
import type * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"border-line bg-surface text-field text-fg hover:border-line-strong focus-visible:border-brand focus-visible:ring-brand-soft disabled:bg-surface-sunken aria-invalid:border-danger aria-invalid:ring-danger-soft flex field-sizing-content min-h-16 w-full rounded-lg border px-3 py-2 transition outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:ring-3",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
