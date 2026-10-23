import { cipherRows, keyhole } from "@vauly/ui/lib/ciphertext";
import { useEffect, useRef } from "react";

// Enough rows for the tallest sign-in page: the setup form on a phone.
const { plain, cipher } = cipherRows(64);

/**
 * Ciphertext across the sign-in sky, as on the website's hero. A keyhole drifts through it
 * on a slow loop and reads the same rows as a team's items. It keeps still when the
 * system asks for less motion.
 */
export function CipherField() {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const field = ref.current;
		if (!field) return;
		let size = field.getBoundingClientRect();
		const resize = new ResizeObserver(() => {
			size = field.getBoundingClientRect();
		});
		resize.observe(field);

		// Wide and slow: across most of the page, passing behind the card now and then.
		const place = (now: number) => {
			field.style.setProperty(
				"--x",
				`${size.width * (0.5 + 0.4 * Math.sin(now / 5200))}px`,
			);
			field.style.setProperty(
				"--y",
				`${size.height * (0.5 + 0.28 * Math.sin(now / 3700))}px`,
			);
		};
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
			place(4000);
			return () => resize.disconnect();
		}
		let frame = requestAnimationFrame(function step(now) {
			place(now);
			frame = requestAnimationFrame(step);
		});
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
		};
	}, []);

	return (
		<div ref={ref} data-slot="cipher-field" aria-hidden>
			<pre data-layer="cipher">{cipher.join("\n")}</pre>
			<pre data-layer="plain">{plain.join("\n")}</pre>
			<svg aria-hidden data-slot="keyhole" viewBox="0 0 200 280">
				<path d={keyhole} />
			</svg>
		</div>
	);
}
