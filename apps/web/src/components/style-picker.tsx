import { cn } from "@mima/ui/lib/utils";

import { APP_STYLES, setAppStyle, useAppStyle } from "@/lib/app-style";

/** For choosing a look while trying them out: a row of styles in the corner. */
export function StylePicker() {
	const current = useAppStyle();
	return (
		<fieldset
			aria-label="Style"
			className="bg-cta text-cta-fg shadow-float fixed right-4 bottom-4 z-50 m-0 flex items-center gap-0.5 rounded-full border-0 p-1"
		>
			<span className="text-caption px-2 opacity-60">Style</span>
			{APP_STYLES.map((style) => (
				<button
					key={style.value}
					type="button"
					aria-pressed={current === style.value}
					onClick={() => setAppStyle(style.value)}
					className={cn(
						"text-caption h-7 rounded-full px-3 transition-colors",
						current === style.value
							? "bg-cta-fg text-cta"
							: "hover:bg-cta-fg/10",
					)}
				>
					{style.label}
				</button>
			))}
		</fieldset>
	);
}
