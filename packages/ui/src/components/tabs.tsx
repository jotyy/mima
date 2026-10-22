"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@mima/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

function Tabs({
	className,
	orientation = "horizontal",
	...props
}: TabsPrimitive.Root.Props) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			data-orientation={orientation}
			className={cn(
				"group/tabs flex gap-3 data-horizontal:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

const tabsListVariants = cva(
	"group/tabs-list relative isolate inline-flex w-fit items-center group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
	{
		variants: {
			variant: {
				default: "bg-surface-sunken rounded-lg p-0.5",
				ghost: "gap-0.5",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsList({
	className,
	variant = "default",
	children,
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(tabsListVariants({ variant }), className)}
			{...props}
		>
			{children}
			<TabsPrimitive.Indicator
				data-slot="tabs-indicator"
				className="ease-emphasized group-data-[variant=default]/tabs-list:bg-surface group-data-[variant=default]/tabs-list:shadow-pill group-data-[variant=ghost]/tabs-list:bg-tint/6 pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) -z-10 h-(--active-tab-height) w-(--active-tab-width) rounded-md transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
			/>
		</TabsPrimitive.List>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"text-caption text-fg-subtle hover:text-fg data-active:text-fg group-data-[variant=default]/tabs-list:text-fg-muted group-data-[variant=default]/tabs-list:data-active:text-fg relative inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 whitespace-nowrap transition-colors duration-200 select-none group-data-vertical/tabs:justify-start disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cn("text-body-sm flex-1 outline-none", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
