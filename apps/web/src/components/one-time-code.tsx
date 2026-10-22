import { useEffect, useState } from "react";

import { fakeOneTimeCode } from "@/fixtures/vault";

import { CopyButton } from "./copy-button";

const PERIOD = 30;

export function OneTimeCode({ seed }: { seed: string }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	const seconds = Math.floor(now / 1000);
	const code = fakeOneTimeCode(seed, Math.floor(seconds / PERIOD));
	const left = PERIOD - (seconds % PERIOD);
	const circumference = 2 * Math.PI * 6;

	return (
		<div className="flex items-center gap-2">
			<span className="text-body-sm text-fg font-mono tracking-wider tabular-nums">
				{code.slice(0, 3)} {code.slice(3)}
			</span>
			<span className="text-caption text-fg-subtle flex items-center gap-1 tabular-nums">
				<svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
					<circle
						cx="8"
						cy="8"
						r="6"
						fill="none"
						strokeWidth="2"
						className="stroke-line"
					/>
					<circle
						cx="8"
						cy="8"
						r="6"
						fill="none"
						strokeWidth="2"
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={circumference * (1 - left / PERIOD)}
						className={left <= 5 ? "stroke-danger" : "stroke-brand"}
					/>
				</svg>
				{left}s
			</span>
			<CopyButton value={code} label="one-time code" />
		</div>
	);
}
