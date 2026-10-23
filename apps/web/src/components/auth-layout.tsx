import { EyeIcon, EyeSlashIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import { Input } from "@vauly/ui/components/input";
import { cn } from "@vauly/ui/lib/utils";
import {
	type ComponentProps,
	type CSSProperties,
	type ReactNode,
	useId,
	useState,
} from "react";

import { passwordStrength } from "@/lib/secrets";
import type { ItemKind } from "@/lib/vault-data";

import { ItemTile } from "./item-tile";
import { VaulyLogo } from "./vauly-mark";

/**
 * The page's grid: the panel takes a little less than half, so the note beside it has
 * room to move. Shared by the guides, the panel row and the fine print so they line up.
 */
const grid =
	"mx-auto grid w-full max-w-7xl lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]";

/**
 * The frame around sign-in, setup, join and unlock: the logo up top, a card on a brand
 * panel drawn on a page of thin guide lines, and a short note on how vauly keeps items
 * safe beside it.
 */
export function AuthLayout({
	title,
	description,
	children,
	footer,
	note = "End-to-end encrypted. Your master password never leaves this device.",
}: {
	title: string;
	/** A line under the title. */
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
			<header className={cn(grid, "px-4 pt-5 sm:px-6 sm:pt-7")}>
				<VaulyLogo className="h-7 sm:ml-5" />
			</header>
			<div className="min-h-6 flex-1 sm:min-h-16" />
			<div className="sm:border-line-subtle sm:border-y">
				<div className={cn(grid, "sm:px-6")}>
					<div className="relative px-4 sm:px-0">
						<Corners />
						<div className="rounded-panel bg-brand-soft p-1.5 sm:rounded-none">
							<div
								data-slot="auth-panel"
								className="rounded-window relative isolate overflow-hidden px-3 py-8 sm:rounded-none sm:px-10 sm:py-20 lg:flex lg:aspect-[10/11] lg:flex-col lg:justify-center"
							>
								<div className="mx-auto w-full max-w-sm">
									<Shackle />
									{/* The lock's body: a frosted rim like the shackle, around an opaque form. */}
									<div className="rounded-panel border-brand-fg/25 bg-brand-fg/15 relative border p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),var(--elevation-float)] backdrop-blur-md">
										<main className="bg-surface rounded-window shadow-pill flex flex-col px-6 py-8 sm:px-8">
											<div className="mb-6 flex flex-col items-center gap-1.5 text-center">
												<h1 className="text-h5 text-fg">{title}</h1>
												{description && (
													<p className="text-body-sm text-fg-muted text-balance">
														{description}
													</p>
												)}
											</div>
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
						</div>
					</div>
					{/* Reaches halfway into the page margin, so the card sits toward the edge. */}
					<div className="hidden items-center justify-end py-10 pl-16 lg:-mr-[max(0px,calc((100vw_-_80rem)/4))] lg:flex">
						<SafetyCard />
					</div>
				</div>
			</div>
			<div className={cn(grid, "flex-1 px-4 pt-5 pb-10 sm:px-6")}>
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
			<div className={cn(grid, "h-full px-6")}>
				<div className="border-line-subtle border-x" />
			</div>
		</div>
	);
}

/**
 * Small dots where the guide lines cross, at the panel's corners. The panel is square from
 * `sm` up so its corners land on them; on phones there are no guides and it stays round.
 */
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

/**
 * A padlock's shackle rising from behind the card, so the card reads as the lock's body.
 * Frosted white that fades toward the card, with light along both edges. It drops into
 * place as the page opens. Hidden on phones, where the panel is tight.
 */
function Shackle() {
	const id = useId().replace(/:/g, "");
	return (
		<svg
			aria-hidden
			viewBox="0 0 200 170"
			className="animate-in fade-in slide-in-from-top-3 fill-mode-both ease-emphasized mx-auto -mb-10 hidden w-48 duration-700 motion-reduce:animate-none sm:block"
		>
			<defs>
				<linearGradient id={`${id}-body`} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0" stopColor="#fff" stopOpacity=".5" />
					<stop offset="1" stopColor="#fff" stopOpacity=".08" />
				</linearGradient>
				<linearGradient id={`${id}-edge`} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0" stopColor="#fff" stopOpacity=".85" />
					<stop offset=".6" stopColor="#fff" stopOpacity="0" />
				</linearGradient>
			</defs>
			<path
				d="M12 170V100a88 88 0 0 1 176 0v70"
				fill="none"
				stroke={`url(#${id}-body)`}
				strokeWidth="24"
			/>
			<path
				d="M.75 170V100a99.25 99.25 0 0 1 198.5 0v70"
				fill="none"
				stroke={`url(#${id}-edge)`}
				strokeWidth="1.5"
			/>
			<path
				d="M23.25 170V100a76.75 76.75 0 0 1 153.5 0v70"
				fill="none"
				stroke={`url(#${id}-edge)`}
				strokeOpacity=".45"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

/** Example items for the lock beside the form, each with the ciphertext the server keeps. */
const sealed: { kind: ItemKind; name: string; cipher: string }[][] = [
	[
		{ kind: "login", name: "GitHub", cipher: "kX9fQ2Lq0vA7" },
		{ kind: "api-key", name: "Stripe live key", cipher: "U2FsdGVkX1+e" },
		{ kind: "note", name: "Office Wi-Fi", cipher: "p0Rz8nWc4Jd=" },
		{ kind: "ssh-key", name: "deploy@prod", cipher: "Hq7tB3mYx9Ks" },
		{ kind: "login", name: "Figma", cipher: "c2VjcmV0LWE1" },
	],
	[
		{ kind: "api-key", name: "OpenAI API key", cipher: "9dE4wLr1Tz+Q" },
		{ kind: "login", name: "Google Workspace", cipher: "Vn6sA0yP2gHk" },
		{ kind: "note", name: "Door codes", cipher: "Rk3bM8qZ7cX=" },
		{ kind: "api-key", name: "Cloudflare token", cipher: "f1Jw5uN9eL0o" },
		{ kind: "ssh-key", name: "Backup server", cipher: "Yt2hG6vK4pWs" },
	],
	[
		{ kind: "login", name: "AWS root", cipher: "Ze8cD1nR5qB+" },
		{ kind: "api-key", name: "Postgres · staging", cipher: "m4Ls9Xa0Jf7T" },
		{ kind: "login", name: "Linear", cipher: "Qw3oE7iU1yH=" },
		{ kind: "note", name: "Recovery codes", cipher: "b6Nv2Kc8Ps4D" },
		{ kind: "ssh-key", name: "Build runner", cipher: "Gx5tR0wM3zLa" },
	],
];

/**
 * Items drift left to right through a lock: plain names on your device, ciphertext on
 * the server. Both sides are the same rows drawn twice in step, each clipped to its half.
 */
function Seal() {
	const rows = (cipher: boolean) =>
		sealed.map((row, index) => (
			<div key={row[0]?.name} data-slot="marquee">
				<div
					data-slot="marquee-track"
					data-reverse
					style={
						{
							"--marquee-duration": `${44 + index * 9}s`,
							animationDelay: `${-index * 13}s`,
						} as CSSProperties
					}
				>
					{[...row, ...row].map((item, position) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: each row repeats its chips once
							key={position}
							className={cn(
								"shadow-pill text-caption mr-2 inline-flex w-40 shrink-0 items-center gap-1.5 rounded-full py-1 pr-3 pl-1",
								cipher
									? "bg-brand-soft text-link font-mono"
									: "bg-surface text-fg-muted",
							)}
						>
							{cipher ? (
								<span className="bg-surface text-link inline-flex size-6 shrink-0 items-center justify-center rounded-full">
									<LockSimpleIcon className="size-3.5" />
								</span>
							) : (
								<ItemTile
									kind={item.kind}
									size="sm"
									className="bg-surface-sunken shadow-none"
								/>
							)}
							<span className="truncate">
								{cipher ? item.cipher : item.name}
							</span>
						</span>
					))}
				</div>
			</div>
		));

	return (
		<div aria-hidden className="flex flex-col gap-3">
			<div data-slot="seal">
				<div data-slot="seal-layer" data-plain>
					{rows(false)}
				</div>
				<div data-slot="seal-layer">{rows(true)}</div>
				<span className="via-brand-line absolute inset-y-[-0.5rem] left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent to-transparent" />
				<span className="bg-brand text-brand-fg shadow-pill ring-surface-sunken absolute top-1/2 left-1/2 flex size-8 -translate-1/2 items-center justify-center rounded-full ring-4">
					<LockSimpleIcon className="size-4" weight="bold" />
				</span>
			</div>
			<div className="text-micro text-fg-subtle grid grid-cols-2 text-center">
				<span>On your device</span>
				<span>On the server</span>
			</div>
		</div>
	);
}

/** What vauly does with your items, in the spot a sign-in page would put a testimonial. */
function SafetyCard() {
	return (
		<section className="rounded-panel bg-brand-soft/60 w-full max-w-lg p-1.5">
			<div className="border-line bg-surface rounded-window overflow-hidden border">
				<div className="bg-surface-sunken border-line-subtle animate-in fade-in fill-mode-both border-b py-6 duration-700">
					<Seal />
				</div>
				<div className="flex flex-col gap-1 px-8 py-6">
					<h2 className="text-h5 text-fg animate-in fade-in slide-in-from-bottom-1 fill-mode-both delay-200 duration-500">
						Locked before it leaves your device
					</h2>
					<p className="text-caption text-fg-muted animate-in fade-in slide-in-from-bottom-1 fill-mode-both delay-300 duration-500">
						Only the people you share a vault with can open it
					</p>
				</div>
			</div>
		</section>
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
