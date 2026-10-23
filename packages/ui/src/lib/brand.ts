// The Vauly mark and wordmark: one source for the web app, the website, the extension
// and the exported icons (brand/build.ts). Coordinates are the artwork's own; the mark
// spans x 6.39–25.41 and y 30.84–51.29, the wordmark x 29.41–75.05.

/** The mark: a folded V, lit from the top left. Two light facets over two deep ones. */
export const markFacets = {
	lowerLeft: "m6.39 36.3v7.73l9.51 7.26v-5.44l-4.21-3.19v-3.01l-5.3-3.35z",
	lowerRight: "m25.41 36.3v7.73l-9.51 7.26v-5.44l4.25-3.19v-3.01l5.26-3.35z",
	upperLeft: "m6.39 30.84v5.46l8.5 5.39v-5.44l-8.5-5.41z",
	upperRight: "m25.41 30.84v5.46l-8.46 5.39v-5.44l8.46-5.41z",
} as const;

/** "vauly", letter by letter. */
export const wordmark = [
	"m29.41 36.89 4.23 9.37h2.37l4.23-9.37h-3.23l-2.21 5.26-2.23-5.26h-3.16z",
	"m45.61 36.89h-4.57l0.81 2.18h2.87c0.68 0 1.1 0.4 1.1 1.03v0.19h-3.31c-1.86 0-3.23 1.13-3.23 2.98 0 1.9 1.6 3.06 3.23 3.06h1.28c0.86 0 1.69-0.48 2.12-0.93v0.86h2.67v-6.11c0-1.9-1.63-3.26-2.97-3.26zm0.21 5.43c0 1.22-1.07 1.81-2.23 1.81-1 0-1.54-0.47-1.54-1.06 0-0.75 0.66-1.16 1.74-1.16h2.03v0.41z",
	"m49.56 36.89v6.23c0 2.06 1.79 3.14 2.76 3.14h2.53c0.62 0 1.23-0.44 1.47-0.76v0.76h2.68v-9.37h-2.73v5.02c0 1.28-0.82 1.95-1.96 1.95-1.23 0-1.99-0.59-1.99-1.8v-5.17h-2.76z",
	"m60.2 32.29v13.97h2.72v-12.78l-2.72-1.19z",
	"m63.62 36.89 3.77 8.22-2.38 5.02h3.34l6.06-13.24h-3.26l-2.11 4.94-2.19-4.94h-3.23z",
] as const;

type Stop = readonly [offset: number, color: string];
type Gradient = {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	stops: readonly Stop[];
};

/**
 * Each facet's gradient, in Vauly blue (#1F5BF9): the light facets catch the light and
 * fade into the brand blue at the fold; the deep ones fall from navy to blue at the tip.
 */
export const markGradients: Record<keyof typeof markFacets, Gradient> = {
	lowerLeft: {
		x1: 6.39,
		y1: 36.34,
		x2: 15.9,
		y2: 51.29,
		stops: [
			[0, "#0C2280"],
			[1, "#2F6BFF"],
		],
	},
	lowerRight: {
		x1: 25.41,
		y1: 36.34,
		x2: 15.9,
		y2: 51.29,
		stops: [
			[0, "#2453E6"],
			[1, "#0B1C6B"],
		],
	},
	upperLeft: {
		x1: 10.85,
		y1: 30.84,
		x2: 14.88,
		y2: 41.69,
		stops: [
			[0, "#8DB0FF"],
			[0.64, "#6290FF"],
			[1, "#1F5BF9"],
		],
	},
	upperRight: {
		x1: 25.41,
		y1: 30.84,
		x2: 16.93,
		y2: 41.69,
		stops: [
			[0, "#9ABAFF"],
			[0.58, "#6C97FF"],
			[1, "#1F5BF9"],
		],
	},
};

/**
 * The all-white mark, for deep blue and photographs: the fold stays readable because the
 * deep facets take less white.
 */
export const whiteFacetOpacity: Record<keyof typeof markFacets, number> = {
	upperLeft: 1,
	upperRight: 1,
	lowerLeft: 0.72,
	lowerRight: 0.52,
};

/** The wordmark's ink on light backgrounds, and on dark ones. */
export const ink = { light: "#0B1A45", dark: "#F4F4F5" } as const;

/** The mark's box, and the box of the whole logo, as SVG viewBoxes with a little air. */
export const markBox = { x: 5.9, y: 30.34, width: 20, height: 21.45 } as const;
export const logoBox = {
	x: 5.9,
	y: 30.34,
	width: 69.65,
	height: 21.45,
} as const;
