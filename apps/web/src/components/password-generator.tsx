import {
	ArrowsClockwiseIcon,
	SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@vauly/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vauly/ui/components/select";
import { Switch } from "@vauly/ui/components/switch";
import { Tabs, TabsList, TabsTrigger } from "@vauly/ui/components/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@vauly/ui/components/tooltip";
import { type ReactNode, useState } from "react";

import {
	type GeneratorSettings,
	generateSecret,
	LENGTHS,
	readGeneratorSettings,
	saveGeneratorSettings,
} from "@/lib/generator";
import { MAX_WORDS, MIN_WORDS, type Separator } from "@/lib/passphrase";

// The generate button beside a password field, and what it makes: random characters, or
// words. Changing a setting makes a new one straight away, and this device keeps the
// settings for next time.

export type Generated = { value: string; bits: number };

const separators: { value: Separator; label: string }[] = [
	{ value: "-", label: "Hyphens" },
	{ value: " ", label: "Spaces" },
	{ value: ".", label: "Periods" },
	{ value: "_", label: "Underscores" },
];

const wordCounts = Array.from(
	{ length: MAX_WORDS - MIN_WORDS + 1 },
	(_, index) => MIN_WORDS + index,
);

export function PasswordGenerator({
	onGenerate,
}: {
	onGenerate: (generated: Generated) => void;
}) {
	const [settings, setSettings] = useState(readGeneratorSettings);

	const generate = async (next: GeneratorSettings) =>
		onGenerate(await generateSecret(next));

	const change = (patch: Partial<GeneratorSettings>) => {
		const next = { ...settings, ...patch };
		setSettings(next);
		saveGeneratorSettings(next);
		void generate(next);
	};

	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label="Generate a password"
							onClick={() => void generate(settings)}
						/>
					}
				>
					<ArrowsClockwiseIcon />
				</TooltipTrigger>
				<TooltipContent>
					{settings.mode === "words"
						? "Generate a passphrase"
						: "Generate a strong password"}
				</TooltipContent>
			</Tooltip>
			<Popover>
				<PopoverTrigger
					render={
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label="Generator settings"
						/>
					}
				>
					<SlidersHorizontalIcon />
				</PopoverTrigger>
				<PopoverContent align="end" aria-label="Generator settings">
					<Tabs
						value={settings.mode}
						onValueChange={(mode) =>
							change({ mode: mode as GeneratorSettings["mode"] })
						}
					>
						<TabsList className="w-full">
							<TabsTrigger value="characters">Characters</TabsTrigger>
							<TabsTrigger value="words">Words</TabsTrigger>
						</TabsList>
					</Tabs>
					{settings.mode === "characters" ? (
						<>
							<Setting label="Length">
								<Choice
									label="Length"
									value={settings.length}
									options={LENGTHS.map((length) => ({
										value: length,
										label: `${length} characters`,
									}))}
									onChange={(length) => change({ length })}
								/>
							</Setting>
							<Toggle
								label="Symbols"
								checked={settings.symbols}
								onChange={(symbols) => change({ symbols })}
							/>
						</>
					) : (
						<>
							<Setting label="Words">
								<Choice
									label="Words"
									value={settings.words}
									options={wordCounts.map((words) => ({
										value: words,
										label: `${words} words`,
									}))}
									onChange={(words) => change({ words })}
								/>
							</Setting>
							<Setting label="Between words">
								<Choice
									label="Between words"
									value={settings.separator}
									options={separators}
									onChange={(separator) => change({ separator })}
								/>
							</Setting>
							<Toggle
								label="Capital letters"
								checked={settings.capitals}
								onChange={(capitals) => change({ capitals })}
							/>
							<Toggle
								label="A digit"
								checked={settings.digit}
								onChange={(digit) => change({ digit })}
							/>
							<p className="text-caption text-fg-subtle">
								Words from the{" "}
								<a
									className="underline underline-offset-2"
									href="https://www.eff.org/dice"
									target="_blank"
									rel="noreferrer"
								>
									EFF's large wordlist
								</a>
								,{" "}
								<a
									className="underline underline-offset-2"
									href="https://creativecommons.org/licenses/by/3.0/us/"
									target="_blank"
									rel="noreferrer"
								>
									CC BY 3.0 US
								</a>
								.
							</p>
						</>
					)}
				</PopoverContent>
			</Popover>
		</>
	);
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-body-sm text-fg">{label}</span>
			{children}
		</div>
	);
}

function Choice<T extends string | number>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<Select
			items={options}
			value={value}
			onValueChange={(next) => next !== null && onChange(next as T)}
		>
			<SelectTrigger size="sm" className="w-36" aria-label={label}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
		<label className="flex items-center justify-between gap-3">
			<span className="text-body-sm text-fg">{label}</span>
			<Switch size="sm" checked={checked} onCheckedChange={onChange} />
		</label>
	);
}
