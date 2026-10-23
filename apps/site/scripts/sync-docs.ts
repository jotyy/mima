// Copies the repository's docs/ into the site, so the Markdown people read on GitHub is
// also the docs on the website. Each page's first heading becomes its title, links to
// other docs become site links, and links out of docs/ point at the file on GitHub.
//
// It also writes the docs for AI agents, the way llmstxt.org suggests: each page as
// Markdown beside it (/docs/self-hosting.md), with the plain-text diagrams GitHub shows
// and every link absolute; /llms.txt, which is src/llms.md followed by a list of those
// pages; and /llms-full.txt, which is all of them in one file.

import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const REPOSITORY = "https://github.com/jotyy/vauly";
const SITE = "https://vauly.app";
const root = path.resolve(import.meta.dirname, "../../..");
const source = path.join(root, "docs");
const site = path.resolve(import.meta.dirname, "..");
const pages = path.join(site, "src/content/docs/docs");
// Served as they are: the Markdown for agents, and the images.
const published = path.join(site, "public/docs");
const images = path.join(published, "images");
// The landing page shows the same screenshots, optimized at build time.
const screens = path.join(site, "src/assets/screens");

rmSync(pages, { recursive: true, force: true });
rmSync(published, { recursive: true, force: true });
rmSync(screens, { recursive: true, force: true });
mkdirSync(pages, { recursive: true });
mkdirSync(images, { recursive: true });
mkdirSync(screens, { recursive: true });

const slugOf = (file: string) =>
	file === "README.md" ? "" : file.replace(/\.md$/, "");
/** Where a docs page is, for people and as Markdown for agents. */
const pageUrl = (slug: string) => `/docs/${slug ? `${slug}/` : ""}`;
const markdownUrl = (slug: string) => `${SITE}/docs/${slug || "index"}.md`;

/** A page's first paragraph, as plain text, for search results and link previews. */
function summary(body: string) {
	const paragraph =
		body
			.split(/\n\s*\n/)
			.map((block) => block.trim())
			.find((block) => block && !/^[#|`<>-]/.test(block)) ?? "";
	const text = paragraph
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[*_`]/g, "")
		.replace(/\s+/g, " ");
	// Whole sentences, as many as fit a search result.
	let kept = "";
	for (const sentence of text.split(/(?<=[.!?])\s+/)) {
		if (kept && kept.length + sentence.length > 180) break;
		kept += `${sentence} `;
	}
	return kept.trim();
}

/**
 * On GitHub a diagram is the plain-text block after a `<!-- diagram: Name -->` comment;
 * on the site it's the component of that name, drawn properly, and the page becomes MDX.
 */
function drawDiagrams(body: string) {
	const used = new Set<string>();
	const mdx = body.replace(
		/<!-- diagram: (\w+) -->\s*```[^\n]*\n[\s\S]*?\n```/g,
		(_, name: string) => {
			used.add(name);
			return `<${name} />`;
		},
	);
	return { mdx, used: [...used] };
}

/** Links to other docs go to `linkPage`; images are under `origin`, the site's by default. */
function rewriteLinks(
	body: string,
	linkPage: (slug: string) => string,
	origin = "",
) {
	return body.replace(
		/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
		(match, bang: string, text: string, target: string) => {
			if (/^[a-z]+:|^#/i.test(target)) return match;
			const [file, hash] = target.split("#");
			const anchor = hash ? `#${hash}` : "";
			if (bang || file?.startsWith("images/"))
				return `${bang}[${text}](${origin}/docs/${file}${anchor})`;
			if (file && !file.includes("/") && file.endsWith(".md"))
				return `[${text}](${linkPage(slugOf(file))}${anchor})`;
			// Anything else lives in the repository: show it on GitHub.
			const inRepo = path
				.relative(root, path.resolve(source, file ?? ""))
				.split(path.sep)
				.join("/");
			return `[${text}](${REPOSITORY}/blob/main/${inRepo}${anchor})`;
		},
	);
}

// The introduction first, then the rest by name.
const files = readdirSync(source)
	.filter((file) => file.endsWith(".md"))
	.sort((a, b) =>
		a === "README.md" ? -1 : b === "README.md" ? 1 : a.localeCompare(b),
	);
const forAgents: {
	title: string;
	url: string;
	summary: string;
	text: string;
}[] = [];

for (const file of files) {
	const raw = readFileSync(path.join(source, file), "utf8");
	const heading = /^# (.+)$/m.exec(raw);
	if (!heading?.[1]) throw new Error(`docs/${file} needs a "# Title" heading`);
	const content = raw.replace(heading[0], "").trim();
	const body = rewriteLinks(content, pageUrl);
	const frontmatter = [
		"---",
		`title: ${JSON.stringify(heading[1])}`,
		`description: ${JSON.stringify(summary(body))}`,
		`editUrl: ${REPOSITORY}/edit/main/docs/${file}`,
		"---",
		"",
	].join("\n");
	forAgents.push({
		title: heading[1],
		url: markdownUrl(slugOf(file)),
		summary: summary(body),
		text: [
			`# ${heading[1]}`,
			`Source: ${SITE}${pageUrl(slugOf(file))}`,
			rewriteLinks(content, markdownUrl, SITE).replace(
				/<!-- diagram: \w+ -->\s*/g,
				"",
			),
		].join("\n\n"),
	});
	const slug = slugOf(file) || "index";
	const { mdx, used } = drawDiagrams(body);
	const imports = used
		.map(
			(name) =>
				`import ${name} from "@/components/docs/diagrams/${name}.astro";`,
		)
		.join("\n");
	if (used.length)
		writeFileSync(
			path.join(pages, `${slug}.mdx`),
			`${frontmatter}${imports}\n\n${mdx}\n`,
		);
	else writeFileSync(path.join(pages, `${slug}.md`), `${frontmatter}${body}\n`);
}

for (const file of readdirSync(path.join(source, "images"))) {
	copyFileSync(path.join(source, "images", file), path.join(images, file));
	copyFileSync(path.join(source, "images", file), path.join(screens, file));
}

const about = readFileSync(path.join(site, "src/llms.md"), "utf8").trim();
for (const page of forAgents)
	writeFileSync(
		path.join(published, page.url.slice(`${SITE}/docs/`.length)),
		`${page.text}\n`,
	);
writeFileSync(
	path.join(site, "public/llms.txt"),
	`${[
		about,
		"## Docs",
		forAgents
			.map((page) => `- [${page.title}](${page.url}): ${page.summary}`)
			.join("\n"),
		"## Optional",
		[
			`- [All the docs in one file](${SITE}/llms-full.txt)`,
			`- [Source code](${REPOSITORY}): the web app, the API, the browser extension and the vauly CLI, under AGPL-3.0`,
			`- [Changelog](${REPOSITORY}/blob/main/CHANGELOG.md): what changed in each release`,
		].join("\n"),
	].join("\n\n")}\n`,
);
writeFileSync(
	path.join(site, "public/llms-full.txt"),
	`${[about, ...forAgents.map((page) => page.text)].join("\n\n")}\n`,
);
