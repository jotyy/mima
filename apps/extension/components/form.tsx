import type { ReactNode } from "react";

export function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
		<label className="flex flex-col gap-1.5">
			<span className="text-caption text-fg-muted">{label}</span>
			{children}
		</label>
	);
}

export function FormError({ children }: { children: ReactNode }) {
	if (!children) return null;
	return (
		<p
			role="alert"
			className="border-danger-line bg-danger-soft text-caption text-danger-strong rounded-lg border px-3 py-2"
		>
			{children}
		</p>
	);
}
