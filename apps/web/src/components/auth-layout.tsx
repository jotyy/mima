import { Button } from "@mima/ui/components/button";
import { Input } from "@mima/ui/components/input";
import { cn } from "@mima/ui/lib/utils";
import {
	ClockCounterClockwiseIcon,
	DevicesIcon,
	EyeIcon,
	EyeSlashIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { passwordStrength } from "@/lib/secrets";

import { MimaLogo } from "./mima-mark";

/**
 * The frame around sign-in, setup, join and unlock: a card on a brand panel, drawn on a
 * page of thin guide lines, with a short note on how mima keeps items safe beside it.
 */
export function AuthLayout({
	title,
	description,
	children,
	footer,
	note = "End-to-end encrypted. Your master password never leaves this device.",
}: {
	title: string;
	/** Shown as the tinted notice under the title. */
	description?: ReactNode;
	children: ReactNode;
	/** Links under the form, inside the card. */
	footer?: ReactNode;
	/** Fine print under the panel. */
	note?: ReactNode;
}) {
	return (
		<div className="bg-surface relative isolate flex min-h-svh flex-col overflow-x-hidden">
			<Guides />
			<div className="min-h-6 flex-1 sm:min-h-16" />
			<div className="sm:border-line-subtle sm:border-y">
				<div className="mx-auto grid w-full max-w-6xl sm:px-6 lg:grid-cols-2">
					<div className="relative px-4 sm:px-0">
						<Corners />
						<div className="rounded-shell bg-brand-soft p-2">
							<div className="rounded-window bg-brand pattern-rings px-3 py-8 sm:px-10 sm:py-20">
								<main className="bg-surface shadow-float mx-auto flex max-w-sm flex-col rounded-lg px-6 py-8 sm:px-8">
									<div className="mb-6 flex flex-col items-center gap-2.5 text-center">
										<MimaLogo className="h-8" />
										<h1 className="text-body text-fg-muted">{title}</h1>
									</div>
									{description && (
										<p className="bg-brand-soft text-body-sm text-link mb-5 rounded-lg px-3.5 py-3 text-pretty">
											{description}
										</p>
									)}
									{children}
									{footer && (
										<div className="text-body-sm text-fg-muted mt-6 flex flex-col items-center gap-1.5 text-center">
											{footer}
										</div>
									)}
								</main>
							</div>
						</div>
					</div>
					<div className="hidden items-center justify-center p-10 lg:flex">
						<SafetyCard />
					</div>
				</div>
			</div>
			<div className="mx-auto grid w-full max-w-6xl flex-1 px-4 pt-5 pb-10 sm:px-6 lg:grid-cols-2">
				<p className="text-caption text-fg-subtle mx-auto max-w-sm text-center text-balance">
					{note}
				</p>
			</div>
		</div>
	);
}

/** Two vertical guide lines that run the full height of the page around the panel. */
function Guides() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 -z-10 hidden sm:block"
		>
			<div className="mx-auto grid h-full w-full max-w-6xl px-6 lg:grid-cols-2">
				<div className="border-line-subtle border-x" />
			</div>
		</div>
	);
}

/** Small dots where the guide lines cross, at the panel's corners. */
function Corners() {
	const dot = "bg-line-strong absolute size-1.5 rounded-full";
	return (
		<div aria-hidden className="hidden sm:contents">
			<span className={cn(dot, "-top-0.75 -left-0.75")} />
			<span className={cn(dot, "-top-0.75 -right-0.75")} />
			<span className={cn(dot, "-bottom-0.75 -left-0.75")} />
			<span className={cn(dot, "-right-0.75 -bottom-0.75")} />
		</div>
	);
}

/** What mima does with your items, in the spot a sign-in page would put a testimonial. */
function SafetyCard() {
	const points = [
		{ icon: DevicesIcon, label: "Encrypted on your device" },
		{ icon: UsersThreeIcon, label: "Shared vault by vault" },
		{ icon: ClockCounterClockwiseIcon, label: "Every reveal is logged" },
	];
	return (
		<figure className="rounded-shell bg-brand-soft/60 w-full max-w-md p-1.5">
			<div className="border-line bg-surface flex flex-col gap-6 rounded-lg border p-8">
				<div className="flex gap-2">
					{points.map(({ icon: Icon, label }) => (
						<span
							key={label}
							title={label}
							className="bg-brand-soft text-brand flex size-9 items-center justify-center rounded-full"
						>
							<Icon className="size-4.5" />
						</span>
					))}
				</div>
				<blockquote className="text-h5 text-fg text-pretty">
					Items are locked on your device before they're saved. The server keeps
					ciphertext it can't read, and only the people you share a vault with
					can open it.
				</blockquote>
				<figcaption className="flex flex-col gap-0.5">
					<span className="text-body-sm text-fg font-medium">
						End-to-end encrypted
					</span>
					<span className="text-caption text-fg-muted">
						AES-256-GCM, with keys derived from your master password
					</span>
				</figcaption>
			</div>
		</figure>
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

/** The form's one big action: a full-width brand pill. */
export function SubmitButton({
	busy,
	busyLabel,
	children,
}: {
	busy: boolean;
	busyLabel: string;
	children: ReactNode;
}) {
	return (
		<Button
			type="submit"
			variant="brand"
			size="lg"
			className="mt-2 h-10 w-full rounded-full"
			disabled={busy}
		>
			{busy ? busyLabel : children}
		</Button>
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
