import { cn } from "@mima/ui/lib/utils";
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
			className={cn(
				"mx-auto w-full px-6 pt-6 pb-16",
				wide ? "max-w-6xl" : "max-w-4xl",
			)}
		>
			<header className="mb-8 flex flex-col items-center gap-1.5 text-center">
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
		<div className="mb-2.5 flex items-center justify-between px-0.5">
			<h2 className="text-body-sm text-fg font-medium">{children}</h2>
			{action}
		</div>
	);
}
