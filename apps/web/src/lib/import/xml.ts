// Just enough XML for KeePass exports: elements, attributes, text, entities and CDATA.
// It runs the same in the browser and in tests, which have no DOMParser.

export type XmlNode = {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
};

const token =
	/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
const attribute = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const entities: Record<string, string> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
};

export function decodeEntities(text: string) {
	return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name: string) => {
		if (name[0] === "#") {
			const code =
				name[1] === "x" || name[1] === "X"
					? Number.parseInt(name.slice(2), 16)
					: Number.parseInt(name.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return entities[name] ?? whole;
	});
}

/** The document's root element. Throws when the tags don't nest. */
export function parseXml(text: string): XmlNode {
	const root: XmlNode = { name: "", attrs: {}, children: [], text: "" };
	const open = [root];
	for (const match of text.matchAll(token)) {
		const [, cdata, closing, name, rest, selfClosing, chars] = match;
		const parent = open[open.length - 1] as XmlNode;
		if (cdata !== undefined) {
			parent.text += cdata;
		} else if (chars !== undefined) {
			parent.text += decodeEntities(chars);
		} else if (name && closing) {
			if (parent.name !== name || open.length === 1) {
				throw new Error(`Unexpected </${name}>`);
			}
			open.pop();
		} else if (name) {
			const node: XmlNode = { name, attrs: {}, children: [], text: "" };
			for (const [, key, double, single] of (rest ?? "").matchAll(attribute)) {
				if (key) node.attrs[key] = decodeEntities(double ?? single ?? "");
			}
			parent.children.push(node);
			if (!selfClosing) open.push(node);
		}
	}
	const [element] = root.children;
	if (open.length !== 1 || !element) throw new Error("Unclosed XML element");
	return element;
}

export const child = (node: XmlNode | undefined, name: string) =>
	node?.children.find((c) => c.name === name);

export const children = (node: XmlNode | undefined, name: string) =>
	node?.children.filter((c) => c.name === name) ?? [];
