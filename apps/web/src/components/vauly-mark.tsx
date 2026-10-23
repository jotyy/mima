import {
	logoBox,
	markBox,
	markFacets,
	markGradients,
	whiteFacetOpacity,
	wordmark,
} from "@vauly/ui/lib/brand";
import { cn } from "@vauly/ui/lib/utils";
import { useId } from "react";

// The vauly mark and wordmark, drawn from the artwork in @vauly/ui/lib/brand, the same
// source as every exported logo and icon. Gradient ids are made unique so several logos
// can share a page.

const viewBox = (b: typeof markBox | typeof logoBox) =>
	`${b.x} ${b.y} ${b.width} ${b.height}`;

const facets = Object.keys(markFacets) as (keyof typeof markFacets)[];

function MarkShapes() {
	const id = useId().replace(/:/g, "");
	return (
		<>
			<defs>
				{facets.map((facet) => {
					const g = markGradients[facet];
					return (
						<linearGradient
							key={facet}
							id={`${id}-${facet}`}
							x1={g.x1}
							y1={g.y1}
							x2={g.x2}
							y2={g.y2}
							gradientUnits="userSpaceOnUse"
						>
							{g.stops.map(([offset, color]) => (
								<stop key={offset} offset={offset} stopColor={color} />
							))}
						</linearGradient>
					);
				})}
			</defs>
			{facets.map((facet) => (
				<path key={facet} d={markFacets[facet]} fill={`url(#${id}-${facet})`} />
			))}
		</>
	);
}

/** The mark alone. Size it with a height class; the width follows. */
export function VaulyMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox={viewBox(markBox)}
			fill="none"
			aria-hidden
			className={cn("h-4 w-auto shrink-0", className)}
		>
			<MarkShapes />
		</svg>
	);
}

/**
 * Mark and wordmark. The wordmark uses the text color, so it follows the theme. The white
 * tone is for deep blue backgrounds, where the mark's deep facets would vanish.
 */
export function VaulyLogo({
	className,
	tone = "color",
}: {
	className?: string;
	tone?: "color" | "white";
}) {
	return (
		<svg
			viewBox={viewBox(logoBox)}
			fill="none"
			role="img"
			aria-label="vauly"
			className={cn(
				"h-6 w-auto shrink-0",
				tone === "white" ? "text-white" : "text-fg",
				className,
			)}
		>
			{tone === "white" ? (
				facets.map((facet) => (
					<path
						key={facet}
						d={markFacets[facet]}
						fill="#fff"
						fillOpacity={whiteFacetOpacity[facet]}
					/>
				))
			) : (
				<MarkShapes />
			)}
			<g fill="currentColor">
				{wordmark.map((d) => (
					<path key={d} d={d} />
				))}
			</g>
		</svg>
	);
}
