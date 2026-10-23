import { cn } from "@mima/ui/lib/utils";
import { CheckIcon } from "@phosphor-icons/react";

import {
	APP_STYLES,
	type AppStyle,
	setAppStyle,
	useAppStyle,
} from "@/lib/app-style";

/** What each style's thumbnail is drawn with: its page, sidebar, card and typeface. */
const previews: Record<
	AppStyle,
	{
		page: string;
		sidebar: string;
		card: string;
		depth: string;
		font: string;
		fontName: string;
	}
> = {
	classic: {
		page: "#f7f7f7",
		sidebar: "transparent",
		card: "#ffffff",
		depth: "0 0 0 1px rgb(0 0 0 / 6%), 0 2px 6px rgb(0 0 0 / 8%)",
		font: '"IBM Plex Sans Variable", sans-serif',
		fontName: "IBM Plex Sans",
	},
	frost: {
		page: "radial-gradient(80% 70% at 10% 0%, rgb(31 91 249 / 0.18), transparent 70%), #f5f7fc",
		sidebar: "rgb(255 255 255 / 70%)",
		card: "#ffffff",
		depth:
			"0 0 0 1px rgb(31 60 150 / 6%), 0 6px 14px -6px rgb(31 60 150 / 25%)",
		font: '"IBM Plex Sans Variable", sans-serif',
		fontName: "IBM Plex Sans",
	},
	pure: {
		page: "#ffffff",
		sidebar: "#f9f9fa",
		card: "#ffffff",
		depth: "0 0 0 1px #e9e9ec",
		font: '"Spline Sans Variable", sans-serif',
		fontName: "Spline Sans",
	},
};

/** The styles to pick from, each as a small picture of the app wearing it. */
export function StylePicker() {
	const current = useAppStyle();
	return (
		<div
			role="radiogroup"
			aria-label="Style"
			className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
		>
			{APP_STYLES.map((style) => {
				const preview = previews[style.value];
				const active = current === style.value;
				return (
					// biome-ignore lint/a11y/useSemanticElements: a card with a picture, not a bare radio
					<button
						key={style.value}
						type="button"
						role="radio"
						aria-checked={active}
						aria-label={style.label}
						onClick={() => setAppStyle(style.value)}
						className={cn(
							"rounded-window flex flex-col gap-2 p-1.5 text-left transition-shadow",
							active
								? "ring-brand bg-brand-soft ring-2"
								: "ring-line hover:ring-line-strong ring-1",
						)}
					>
						<span
							aria-hidden
							className="flex h-16 gap-1.5 overflow-hidden rounded-md p-1.5"
							style={{ background: preview.page }}
						>
							<span
								className="flex w-1/4 flex-col gap-1 rounded p-1.5"
								style={{ background: preview.sidebar }}
							>
								<span className="bg-fg/20 h-1 w-full rounded-full" />
								<span className="bg-fg/10 h-1 w-3/4 rounded-full" />
								<span className="bg-fg/10 h-1 w-3/4 rounded-full" />
							</span>
							<span
								className="flex flex-1 flex-col gap-1 rounded p-1.5"
								style={{ background: preview.card, boxShadow: preview.depth }}
							>
								<span className="bg-fg/25 h-1 w-1/2 rounded-full" />
								<span className="bg-fg/10 h-1 w-3/4 rounded-full" />
								<span className="bg-brand mt-auto h-2 w-6 rounded-sm" />
							</span>
						</span>
						<span className="flex items-center justify-between gap-2 px-1 pb-0.5">
							<span className="flex min-w-0 flex-col">
								<span
									className="text-body-sm text-fg"
									style={{ fontFamily: preview.font }}
								>
									{style.label}
								</span>
								<span className="text-caption text-fg-subtle truncate">
									{preview.fontName}
								</span>
							</span>
							{active && (
								<CheckIcon weight="bold" className="text-brand size-3.5" />
							)}
						</span>
					</button>
				);
			})}
		</div>
	);
}
