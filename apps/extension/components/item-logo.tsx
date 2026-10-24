import type { Icon } from "@phosphor-icons/react";
import { useState } from "react";

/**
 * An item's brand logo, from the address lib/logos.ts gives, or the icon for its kind when
 * there's none to show.
 */
export function ItemLogo({
	logo,
	icon: Fallback,
}: {
	logo: string | null;
	icon: Icon;
}) {
	const [missing, setMissing] = useState(false);
	return (
		<span className="bg-surface text-fg-muted shadow-pill flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md">
			{logo && !missing ? (
				<img
					src={logo}
					alt=""
					draggable={false}
					className="size-full object-cover"
					onError={() => setMissing(true)}
				/>
			) : (
				<Fallback className="size-4" />
			)}
		</span>
	);
}
