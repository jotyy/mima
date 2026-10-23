import { setArgon2 } from "@vauly/crypto";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "./style.css";

// Unlocking happens here, so Argon2id (libsodium's WebAssembly) loads here, and only once
// someone unlocks. The manifest's CSP lets the extension's own pages compile it.
setArgon2(async (...input) =>
	(await import("@vauly/crypto/argon2")).argon2id(...input),
);

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
