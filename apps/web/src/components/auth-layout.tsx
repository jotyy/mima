import { Button } from "@mima/ui/components/button";
import { Input } from "@mima/ui/components/input";
import { cn } from "@mima/ui/lib/utils";
import { EyeIcon, EyeSlashIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { passwordStrength } from "@/lib/secrets";

import { MimaMark } from "./mima-mark";

export function AuthLayout({
	title,
	description,
	children,
	footer,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<div className="bg-frame flex min-h-svh flex-col items-center justify-center px-4 py-10">
			<div className="rounded-window bg-surface shadow-card w-full max-w-sm p-6">
				<div className="mb-6 flex flex-col items-center gap-3 text-center">
					<MimaMark className="text-h5 size-9 rounded-lg" />
					<div className="flex flex-col gap-1">
						<h1 className="text-fg text-h5">{title}</h1>
						{description && (
							<p className="text-body-sm text-fg-muted">{description}</p>
						)}
					</div>
				</div>
				{children}
			</div>
			{footer}
			<p className="text-caption text-fg-subtle mt-4 flex items-center gap-1.5">
				<LockSimpleIcon className="size-3.5" />
				End-to-end encrypted. Your master password never leaves this device.
			</p>
		</div>
	);
}

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
		<label className="flex flex-col gap-1.5">
			<span className="text-caption text-fg-muted">{label}</span>
			{children}
			{hint && <span className="text-caption text-fg-subtle">{hint}</span>}
		</label>
	);
}

export function PasswordInput({
	showStrength,
	className,
	...props
}: ComponentProps<"input"> & { showStrength?: boolean }) {
	const [visible, setVisible] = useState(false);
	const value = String(props.value ?? "");
	const strength = value ? passwordStrength(value) : null;
	const level =
		strength === "strong" ? 3 : strength === "fair" ? 2 : strength ? 1 : 0;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="relative">
				<Input
					{...props}
					type={visible ? "text" : "password"}
					className={cn("pr-9 font-mono", className)}
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="absolute top-1/2 right-1 -translate-y-1/2"
					aria-label={visible ? "Hide password" : "Show password"}
					onClick={() => setVisible((shown) => !shown)}
				>
					{visible ? <EyeSlashIcon /> : <EyeIcon />}
				</Button>
			</div>
			{showStrength && (
				<div className="flex items-center gap-2">
					<div className="flex flex-1 gap-1" aria-hidden>
						{[1, 2, 3].map((step) => (
							<span
								key={step}
								className={cn(
									"h-1 flex-1 rounded-full transition-colors",
									step > level
										? "bg-line"
										: level === 1
											? "bg-danger"
											: level === 2
												? "bg-chart-3"
												: "bg-success",
								)}
							/>
						))}
					</div>
					<span className="text-caption text-fg-subtle w-12 text-right">
						{strength ? strength[0]?.toUpperCase() + strength.slice(1) : ""}
					</span>
				</div>
			)}
		</div>
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
