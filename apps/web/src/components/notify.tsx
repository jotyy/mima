import { cn } from "@mima/ui/lib/utils";
import { CheckIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

// Every notification in mima is one dark pill at the bottom center, close to the content
// the person is working in. Copies of secrets replace each other (there is only one
// clipboard) and show when the clipboard clears.

const CLEAR_AFTER = 90;

function Pill({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				// --toast-shift centers the pill over the content column when a sidebar is open.
				"bg-cta text-cta-fg shadow-float text-body-sm mx-auto flex h-10 w-fit max-w-full translate-x-(--toast-shift) items-center gap-2.5 rounded-full pr-4 pl-2",
				className,
			)}
		>
			{children}
		</div>
	);
}

const icons = {
	success: (
		<span className="bg-success flex size-6 shrink-0 items-center justify-center rounded-full text-white">
			<CheckIcon weight="bold" className="size-3.5" />
		</span>
	),
	error: (
		<span className="bg-danger flex size-6 shrink-0 items-center justify-center rounded-full text-white">
			<WarningIcon weight="bold" className="size-3.5" />
		</span>
	),
	info: (
		<span className="bg-cta-fg/15 flex size-6 shrink-0 items-center justify-center rounded-full">
			<InfoIcon weight="bold" className="size-3.5" />
		</span>
	),
};

function show(kind: keyof typeof icons, title: string, detail?: string) {
	toast.custom(
		() => (
			<Pill>
				{icons[kind]}
				<span className="truncate">{title}</span>
				{detail && <span className="truncate opacity-60">{detail}</span>}
			</Pill>
		),
		{ duration: kind === "error" ? 6000 : 3000 },
	);
}

export const notify = {
	success: (title: string, detail?: string) => show("success", title, detail),
	error: (title: string, detail?: string) => show("error", title, detail),
	info: (title: string, detail?: string) => show("info", title, detail),
};

let clearTimer: ReturnType<typeof setTimeout> | undefined;

async function clearClipboard() {
	clearTimeout(clearTimer);
	try {
		await navigator.clipboard.writeText("");
	} catch {
		// The page may not have focus; the OS clipboard keeps the value until the next copy.
	}
	toast.dismiss("clipboard");
}

/** Copies a value. Secrets clear from the clipboard after 90 seconds. */
export async function copyToClipboard(
	value: string,
	{
		label,
		source,
		secret = true,
	}: { label: string; source?: string; secret?: boolean },
) {
	try {
		await navigator.clipboard.writeText(value);
	} catch {
		notify.error("Couldn't copy", "Click the page and try again");
		return false;
	}
	clearTimeout(clearTimer);
	if (secret) clearTimer = setTimeout(clearClipboard, CLEAR_AFTER * 1000);
	toast.custom(
		() => <ClipboardPill label={label} source={source} secret={secret} />,
		{ id: "clipboard", duration: secret ? CLEAR_AFTER * 1000 : 2500 },
	);
	return true;
}

function ClipboardPill({
	label,
	source,
	secret,
}: {
	label: string;
	source?: string;
	secret: boolean;
}) {
	const [startedAt] = useState(() => Date.now());
	const [now, setNow] = useState(startedAt);
	useEffect(() => {
		if (!secret) return;
		const timer = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(timer);
	}, [secret]);

	const left = Math.max(0, CLEAR_AFTER - (now - startedAt) / 1000);
	const circumference = 2 * Math.PI * 7;

	return (
		<Pill className={secret ? "pr-1.5" : undefined}>
			{icons.success}
			<span className="truncate">
				Copied {label}
				{source && <span className="opacity-60"> · {source}</span>}
			</span>
			{secret && (
				<>
					<span className="bg-cta-fg/20 h-4 w-px" />
					<span className="text-caption flex items-center gap-1.5 tabular-nums opacity-70">
						<svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden>
							<circle
								cx="9"
								cy="9"
								r="7"
								fill="none"
								strokeWidth="2"
								className="stroke-current opacity-25"
							/>
							<circle
								cx="9"
								cy="9"
								r="7"
								fill="none"
								strokeWidth="2"
								strokeLinecap="round"
								strokeDasharray={circumference}
								strokeDashoffset={circumference * (1 - left / CLEAR_AFTER)}
								className="stroke-current transition-[stroke-dashoffset] duration-300 ease-linear"
							/>
						</svg>
						{Math.ceil(left)}s
					</span>
					<button
						type="button"
						onClick={clearClipboard}
						className="hover:bg-cta-fg/10 text-caption h-7 rounded-full px-2.5 transition-colors"
					>
						Clear now
					</button>
				</>
			)}
		</Pill>
	);
}
