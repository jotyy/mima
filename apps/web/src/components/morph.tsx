import { cn } from "@mima/ui/lib/utils";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

const duration = 320;
const easing = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * A column that eases between layouts when `layoutKey` changes, so a form that swaps its
 * fields doesn't jump: its height follows the content, rows that stay slide to their new
 * spot and rows that appear fade in. Rows are its direct children. React keeps the same
 * element for a row that stays, which is how one is told from a new one.
 */
export function Morph({
	layoutKey,
	className,
	children,
}: {
	layoutKey: unknown;
	className?: string;
	children: ReactNode;
}) {
	const column = useRef<HTMLDivElement>(null);
	const tops = useRef(new Map<Element, number>());
	const shown = useRef(layoutKey);
	const [height, setHeight] = useState<number>();

	useLayoutEffect(() => {
		const element = column.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// Runs after every render, so the positions it keeps are the ones on screen just
	// before the layout changes.
	useLayoutEffect(() => {
		const element = column.current;
		if (!element) return;
		const rows = [...element.children] as HTMLElement[];
		const moved = shown.current !== layoutKey;
		if (moved && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
			for (const row of rows) {
				const from = tops.current.get(row);
				if (from === undefined) {
					row.animate({ opacity: [0, 1] }, { duration, easing });
				} else if (from !== row.offsetTop) {
					const offset = from - row.offsetTop;
					row.animate(
						{ transform: [`translateY(${offset}px)`, "none"] },
						{ duration, easing },
					);
				}
			}
		}
		shown.current = layoutKey;
		tops.current = new Map(rows.map((row) => [row, row.offsetTop]));
	});

	return (
		// The negative margin and matching padding leave room for focus rings at the clip.
		<div
			style={{ height }}
			className="ease-emphasized -m-1 overflow-hidden transition-[height] duration-320 motion-reduce:transition-none"
		>
			<div ref={column} className={cn("relative p-1", className)}>
				{children}
			</div>
		</div>
	);
}
