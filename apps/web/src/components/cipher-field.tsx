import { cipherRows, keyhole } from "@vauly/ui/lib/ciphertext";
import { useEffect, useRef } from "react";

// Enough rows for the tallest sign-in page: the setup form on a phone.
const { plain, cipher } = cipherRows(64);

/**
 * Ciphertext across the sign-in sky, as on the website's hero. A keyhole drifts through it
 * on a slow loop and reads the same rows as a team's items. It keeps still when the
 * system asks for less motion.
 *
 * The keyhole is a lens that moves while the plain rows inside it move the other way, so
 * they stay lined up with the ciphertext. Both moves are transforms, which the compositor
 * handles without painting the glowing text again.
 */
export function CipherField() {
	const ref = useRef<HTMLDivElement>(null);
	const lensRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const field = ref.current;
		const lens = lensRef.current;
		if (!field || !lens) return;
		const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
		let { width, height } = field.getBoundingClientRect();

		// Wide and slow: across most of the page, passing behind the card now and then.
		const place = (now: number) => {
			field.style.setProperty(
				"--x",
				`${width * (0.5 + 0.4 * Math.sin(now / 5200))}px`,
			);
			field.style.setProperty(
				"--y",
				`${height * (0.5 + 0.28 * Math.sin(now / 3700))}px`,
			);
		};
		let frame = 0;
		const step = (now: number) => {
			place(now);
			frame = requestAnimationFrame(step);
		};
		place(calm ? 4000 : performance.now());

		const resize = new ResizeObserver(([entry]) => {
			if (!entry) return;
			({ width, height } = entry.contentRect);
			if (calm) place(4000);
		});
		resize.observe(field);

		// It only moves while the keyhole can be seen: it's hidden on phones, and off the
		// screen when a tall form has scrolled past it.
		const visible = new IntersectionObserver(([entry]) => {
			cancelAnimationFrame(frame);
			if (entry?.isIntersecting && !calm) frame = requestAnimationFrame(step);
		});
		visible.observe(lens);

		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
			visible.disconnect();
		};
	}, []);

	return (
		<div ref={ref} data-slot="cipher-field" aria-hidden>
			<pre data-layer="cipher">{cipher.join("\n")}</pre>
			<div ref={lensRef} data-slot="lens">
				<div data-slot="lens-view">
					<pre data-layer="plain">{plain.join("\n")}</pre>
				</div>
				<svg aria-hidden data-slot="keyhole" viewBox="0 0 200 280">
					<path d={keyhole} />
				</svg>
			</div>
		</div>
	);
}
