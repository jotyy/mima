/** Joins class names, skipping the falsy ones. The islands' answer to cn, without the
 * weight of tailwind-merge: their classes never need merging. */
export function cx(...classes: (string | false | null | undefined)[]) {
	return classes.filter(Boolean).join(" ");
}
