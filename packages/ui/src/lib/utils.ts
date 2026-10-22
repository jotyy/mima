import { createCn } from "cn/config";

// Teach class merging about the custom scales in globals.css, so that
// `text-caption` and `text-fg` don't cancel out as two colors.
export const cn = createCn({
	extend: {
		theme: {
			text: [
				"tiny",
				"micro",
				"caption",
				"body-sm",
				"input",
				"body",
				"h5",
				"h4",
				"h3",
				"stat",
			],
			shadow: ["card", "pill", "popover", "float", "overlay"],
			"inset-shadow": ["line"],
			radius: ["window", "shell", "panel"],
		},
	},
});
