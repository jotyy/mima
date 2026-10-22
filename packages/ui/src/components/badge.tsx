import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@mima/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
	"group/badge text-micro aria-invalid:border-danger-line inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1.5 whitespace-nowrap transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				default:
					"border-line text-fg-muted [a]:hover:border-line-strong [a]:hover:text-fg",
				secondary: "bg-tint/6 text-fg-muted [a]:hover:bg-tint/8",
				destructive: "border-danger-line bg-danger-soft text-danger-strong",
				outline: "border-line bg-surface text-fg [a]:hover:border-line-strong",
				ghost: "text-fg-muted hover:bg-tint/4 hover:text-fg",
				link: "text-link underline-offset-4 hover:underline",
				brand: "border-brand-line bg-brand-soft text-brand",
				success: "border-success-line bg-success-soft text-success",
				warning: "border-warning-line bg-warning-soft text-warning",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ variant }), className),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Badge, badgeVariants };
