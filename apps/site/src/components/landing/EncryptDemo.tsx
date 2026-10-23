import { newDataKey, sealJson, wrapKey } from "@mima/crypto";
import { cn } from "@mima/ui/lib/utils";
import {
	CloudIcon,
	GlobeIcon,
	type Icon,
	KeyIcon,
	LaptopIcon,
	LockSimpleIcon,
	NoteIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

// The hero's demo: an item on the left, as you'd type it into mima, and on the right
// what the server receives for it. It runs mima's real encryption in this page, so every
// keystroke really is sealed with AES-256-GCM under a fresh key.

type Kind = "login" | "api-key" | "note";

type Field = {
	key: string;
	label: string;
	value: string;
	mono?: boolean;
	multiline?: boolean;
};

const kinds: { value: Kind; label: string; icon: Icon }[] = [
	{ value: "login", label: "Login", icon: GlobeIcon },
	{ value: "api-key", label: "API key", icon: KeyIcon },
	{ value: "note", label: "Note", icon: NoteIcon },
];

const samples: Record<Kind, { name: string; fields: Field[] }> = {
	login: {
		name: "GitHub",
		fields: [
			{ key: "username", label: "Username", value: "alex@acme.example" },
			{
				key: "secret",
				label: "Password",
				value: "r7#Lq2v!Wm9e-Tb4",
				mono: true,
			},
			{ key: "url", label: "Website", value: "github.com" },
		],
	},
	"api-key": {
		name: "Stripe live key",
		fields: [
			{
				key: "secret",
				label: "Value",
				value: "sk_live_51NxQ2vLr8KcT4mWpZ",
				mono: true,
			},
			{ key: "url", label: "Website", value: "dashboard.stripe.com" },
		],
	},
	note: {
		name: "Office Wi-Fi",
		fields: [
			{
				key: "notes",
				label: "Note",
				value: "Network: Acme 5G\nPassword: lighthouse-42",
				multiline: true,
			},
		],
	},
};

type Draft = { name: string; values: Record<string, string> };

const draftOf = (kind: Kind): Draft => ({
	name: samples[kind].name,
	values: Object.fromEntries(samples[kind].fields.map((f) => [f.key, f.value])),
});

const prefersCalm = () =>
	typeof matchMedia !== "undefined" &&
	matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function EncryptDemo() {
	const [kind, setKind] = useState<Kind>("login");
	const [drafts, setDrafts] = useState<Record<Kind, Draft>>(() => ({
		login: {
			...draftOf("login"),
			values: { ...draftOf("login").values, secret: "" },
		},
		"api-key": draftOf("api-key"),
		note: draftOf("note"),
	}));
	const [sealed, setSealed] = useState({ data: "", wrappedKey: "" });
	const keys = useRef<{ item: CryptoKey; wrapped: string } | null>(null);
	const touched = useRef(false);
	const root = useRef<HTMLDivElement>(null);
	const draft = drafts[kind];

	// One item key and one vault key for the page, as a vault would hold them.
	useEffect(() => {
		void (async () => {
			const vault = await newDataKey();
			const item = await newDataKey();
			keys.current = { item, wrapped: await wrapKey(vault, item) };
			setSealed((current) => ({
				...current,
				wrappedKey: keys.current?.wrapped ?? "",
			}));
		})();
	}, []);

	// Seal the item again whenever it changes: a new IV each time, so it never repeats.
	useEffect(() => {
		let stale = false;
		const run = async () => {
			while (!keys.current) await new Promise((r) => setTimeout(r, 30));
			const data = await sealJson(keys.current.item, {
				kind,
				name: draft.name,
				...draft.values,
			});
			if (!stale) setSealed({ data, wrappedKey: keys.current.wrapped });
		};
		void run();
		return () => {
			stale = true;
		};
	}, [kind, draft]);

	// Types the password in once the demo comes into view, unless someone got there first.
	useEffect(() => {
		const target =
			samples.login.fields.find((f) => f.key === "secret")?.value ?? "";
		const type = (text: string) =>
			setDrafts((all) => ({
				...all,
				login: { ...all.login, values: { ...all.login.values, secret: text } },
			}));
		if (prefersCalm()) return type(target);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				observer.disconnect();
				let typed = 0;
				const next = () => {
					if (touched.current) return;
					typed += 1;
					type(target.slice(0, typed));
					if (typed < target.length)
						timer = setTimeout(next, 55 + Math.random() * 70);
				};
				timer = setTimeout(next, 700);
			},
			{ threshold: 0.4 },
		);
		if (root.current) observer.observe(root.current);
		return () => {
			observer.disconnect();
			clearTimeout(timer);
		};
	}, []);

	const edit = (patch: Partial<Draft> | { field: string; value: string }) => {
		touched.current = true;
		setDrafts((all) => {
			const current = all[kind];
			const next =
				"field" in patch
					? {
							...current,
							values: { ...current.values, [patch.field]: patch.value },
						}
					: { ...current, ...patch };
			return { ...all, [kind]: next };
		});
	};

	return (
		<div
			ref={root}
			className="bg-surface rounded-window shadow-float overflow-hidden text-left"
		>
			<div className="border-line-subtle flex items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-4">
				<div
					role="tablist"
					aria-label="Kind of item"
					className="bg-surface-sunken flex gap-0.5 rounded-full p-0.5"
				>
					{kinds.map((k) => (
						<button
							key={k.value}
							type="button"
							role="tab"
							aria-selected={kind === k.value}
							onClick={() => {
								touched.current = true;
								setKind(k.value);
							}}
							className={cn(
								"text-label focus-visible:ring-brand flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors outline-none focus-visible:ring-2",
								kind === k.value
									? "bg-surface text-fg shadow-pill"
									: "text-fg-subtle hover:text-fg",
							)}
						>
							<k.icon className="size-3.5" />
							{k.label}
						</button>
					))}
				</div>
				<span className="text-micro text-fg-subtle hidden items-center gap-1.5 sm:flex">
					<span className="bg-success size-1.5 rounded-full" />
					Live AES-256-GCM
				</span>
			</div>

			<div className="relative grid md:grid-cols-2">
				{/* On your device */}
				<div className="flex flex-col gap-4 p-5 sm:p-7 md:pr-12">
					<PaneLabel icon={LaptopIcon}>On your device</PaneLabel>
					<input
						aria-label="Name"
						value={draft.name}
						onChange={(event) => edit({ name: event.target.value })}
						className="text-h4 text-fg focus-visible:ring-brand/40 -mx-1 rounded-md px-1 font-medium outline-none focus-visible:ring-2"
					/>
					<div className="border-line-subtle divide-line-subtle flex flex-col divide-y rounded-lg border">
						{samples[kind].fields.map((field) => (
							// biome-ignore lint/a11y/noLabelWithoutControl: the control is one of two, picked below
							<label
								key={field.key}
								className="flex flex-col gap-1 px-3.5 py-2.5"
							>
								<span className="text-micro text-fg-subtle">{field.label}</span>
								{field.multiline ? (
									<textarea
										rows={2}
										value={draft.values[field.key] ?? ""}
										onChange={(event) =>
											edit({ field: field.key, value: event.target.value })
										}
										className="text-copy text-fg resize-none bg-transparent outline-none"
									/>
								) : (
									<span className="flex items-center">
										<input
											value={draft.values[field.key] ?? ""}
											onChange={(event) =>
												edit({ field: field.key, value: event.target.value })
											}
											spellCheck={false}
											className={cn(
												"text-copy text-fg min-w-0 flex-1 bg-transparent outline-none",
												field.mono && "font-mono tracking-tight",
											)}
										/>
									</span>
								)}
							</label>
						))}
					</div>
				</div>

				{/* The lock line between them */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-y-0 left-1/2 hidden md:block"
				>
					<div className="border-brand-line h-full border-l border-dashed" />
					<span className="bg-brand text-brand-fg shadow-float ring-surface absolute top-1/2 left-0 flex size-9 -translate-1/2 items-center justify-center rounded-full ring-4">
						<LockSimpleIcon weight="bold" className="size-4" />
					</span>
				</div>
				<div aria-hidden className="flex items-center gap-3 px-5 md:hidden">
					<span className="border-brand-line flex-1 border-t border-dashed" />
					<span className="bg-brand text-brand-fg flex size-8 items-center justify-center rounded-full">
						<LockSimpleIcon weight="bold" className="size-4" />
					</span>
					<span className="border-brand-line flex-1 border-t border-dashed" />
				</div>

				{/* On the server */}
				<div className="bg-surface-sunken/60 flex flex-col gap-4 p-5 sm:p-7 md:pl-12">
					<PaneLabel icon={CloudIcon}>On the server</PaneLabel>
					<pre className="text-caption text-fg-muted font-mono leading-relaxed whitespace-pre-wrap">
						<span aria-hidden className="text-fg-faint">
							{"POST /rpc/items/create\n{\n"}
						</span>
						<JsonLine name="vaultId" value="vlt_4f9c2a7e" />
						<JsonLine name="wrappedKey" value={sealed.wrappedKey} cipher />
						<JsonLine name="data" value={sealed.data} cipher last />
						<span aria-hidden className="text-fg-faint">
							{"}"}
						</span>
					</pre>
					<p className="text-caption text-fg-subtle mt-auto">
						Even the name is encrypted. Type to see it change.
					</p>
				</div>
			</div>
		</div>
	);
}

function PaneLabel({ icon: Icon, children }: { icon: Icon; children: string }) {
	return (
		<span className="text-label text-fg-subtle flex items-center gap-1.5">
			<Icon className="size-3.5" />
			{children}
		</span>
	);
}

function JsonLine({
	name,
	value,
	cipher = false,
	last = false,
}: {
	name: string;
	value: string;
	cipher?: boolean;
	last?: boolean;
}) {
	return (
		<span className="block pl-4 break-all">
			<span className="text-fg-subtle">"{name}"</span>
			<span aria-hidden className="text-fg-faint">
				:{" "}
			</span>
			<span className={cipher ? "text-link" : "text-fg-muted"}>
				"{cipher ? <Scramble text={value} /> : value}"
			</span>
			{!last && (
				<span aria-hidden className="text-fg-faint">
					,
				</span>
			)}
		</span>
	);
}

const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Ciphertext that churns into its new value, left to right, when it changes. */
function Scramble({ text }: { text: string }) {
	const [shown, setShown] = useState(text);
	const from = useRef(text);

	useEffect(() => {
		if (prefersCalm() || !from.current) {
			from.current = text;
			setShown(text);
			return;
		}
		const start = performance.now();
		const duration = 520;
		let frame = 0;
		const tick = (now: number) => {
			const progress = Math.min(1, (now - start) / duration);
			let next = "";
			for (let i = 0; i < text.length; i++) {
				// Each character settles a little after the one before it.
				const settle = (i / text.length) * 0.7 + 0.3;
				next +=
					progress >= settle
						? text[i]
						: ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
			}
			setShown(next);
			if (progress < 1) frame = requestAnimationFrame(tick);
			else from.current = text;
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [text]);

	return <>{shown}</>;
}
