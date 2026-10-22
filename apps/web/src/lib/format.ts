import type { Tone } from "@/fixtures/vault";

export function timeAgo(minutes: number) {
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
	if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / 60 / 24)}d ago`;
	return `${Math.floor(minutes / 60 / 24 / 30)}mo ago`;
}

export function initials(name: string) {
	return name
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

export const toneDot: Record<Tone, string> = {
	blue: "bg-chart-1",
	teal: "bg-chart-2",
	amber: "bg-chart-3",
	violet: "bg-chart-4",
};
