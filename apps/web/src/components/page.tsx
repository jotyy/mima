import { cn } from "@vauly/ui/lib/utils";
import type { ReactNode } from "react";

export function Page({
	title,
	description,
	wide,
	children,
}: {
	title: string;
	description: ReactNode;
	wide?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			data-slot="page"
			className={cn(
				"mx-auto w-full px-4 pt-4 pb-16 md:px-6 md:pt-6",
				wide ? "max-w-6xl" : "max-w-4xl",
			)}
		>
			<header
				data-slot="page-header"
				className="mb-6 flex flex-col items-center gap-1.5 text-center text-balance md:mb-8"
			>
				<h1 className="text-fg text-h4">{title}</h1>
				<p className="text-body-sm text-fg-muted">{description}</p>
			</header>
			{children}
		</div>
	);
}

export function SectionTitle({
	children,
	action,
}: {
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div
			data-slot="section-title"
			className="mb-2.5 flex items-center justify-between px-0.5"
		>
			<h2 className="text-body-sm text-fg font-medium">{children}</h2>
			{action}
		</div>
	);
}
