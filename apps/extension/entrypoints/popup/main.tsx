import { type Argon2, setArgon2 } from "@vauly/crypto";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "./style.css";

// Unlocking happens here, so Argon2id (libsodium's WebAssembly) loads here, and only once
// someone unlocks. The manifest's CSP lets the extension's own pages compile it.
const failures = {
	memory:
		"This device ran out of memory while deriving your key. Close some tabs or apps, then try again.",
	blocked:
		"This browser stopped the code that derives your key from running. Check that the extension is up to date.",
	failed: "vauly couldn't derive your key here. Close the popup and try again.",
};
const argon2: Argon2 = async (...input) => {
	const { argon2Failure, argon2id } = await import("@vauly/crypto/argon2");
	try {
		return await argon2id(...input);
	} catch (error) {
		throw new Error(failures[argon2Failure(error)]);
	}
};
setArgon2(argon2);

// Follow the system theme; the design tokens switch on the .dark class.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
	document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const root = document.getElementById("root");
if (!root) throw new Error("The popup page has no #root element");

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
