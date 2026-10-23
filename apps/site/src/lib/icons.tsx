import lockSimpleBold from "@phosphor-icons/core/bold/lock-simple-bold.svg?raw";
import checkCircleFill from "@phosphor-icons/core/fill/check-circle-fill.svg?raw";
import arrowCounterClockwise from "@phosphor-icons/core/regular/arrow-counter-clockwise.svg?raw";
import cloud from "@phosphor-icons/core/regular/cloud.svg?raw";
import globe from "@phosphor-icons/core/regular/globe.svg?raw";
import key from "@phosphor-icons/core/regular/key.svg?raw";
import laptop from "@phosphor-icons/core/regular/laptop.svg?raw";
import note from "@phosphor-icons/core/regular/note.svg?raw";
import robot from "@phosphor-icons/core/regular/robot.svg?raw";
import shieldCheck from "@phosphor-icons/core/regular/shield-check.svg?raw";
import type { JSX } from "preact";

// The few Phosphor icons the islands draw, from the same SVG files as Icon.astro: a
// component per icon, without shipping an icon library.

export type IconComponent = (props: { className?: string }) => JSX.Element;

function icon(svg: string): IconComponent {
	const body = svg
		.replace(/^[\s\S]*?<svg[^>]*>/, "")
		.replace(/<\/svg>\s*$/, "");
	return ({ className }) => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 256 256"
			width="1em"
			height="1em"
			fill="currentColor"
			aria-hidden="true"
			className={className}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Phosphor's own SVG paths, fixed at build time
			dangerouslySetInnerHTML={{ __html: body }}
		/>
	);
}

export const ArrowCounterClockwiseIcon = icon(arrowCounterClockwise);
export const CheckCircleIcon = icon(checkCircleFill);
export const CloudIcon = icon(cloud);
export const GlobeIcon = icon(globe);
export const KeyIcon = icon(key);
export const LaptopIcon = icon(laptop);
export const LockSimpleIcon = icon(lockSimpleBold);
export const NoteIcon = icon(note);
export const RobotIcon = icon(robot);
export const ShieldCheckIcon = icon(shieldCheck);
