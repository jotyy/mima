import { version as packageVersion } from "../package.json";

// A release build passes its version and commit with `bun build --define`; run from
// source, the CLI says it's a development copy.

declare const VAULY_VERSION: string | undefined;
declare const VAULY_COMMIT: string | undefined;

export const version =
	typeof VAULY_VERSION === "string" ? VAULY_VERSION : `${packageVersion}-dev`;

export const commit = typeof VAULY_COMMIT === "string" ? VAULY_COMMIT : null;

/** `vauly 0.1.0 (3f8w2kq)` */
export const versionLine = `vauly ${version}${commit ? ` (${commit})` : ""}`;
