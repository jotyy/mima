import React from "react";
import ReactDOM from "react-dom/client";

import App, { tellPage } from "./App.tsx";

import "./style.css";

// Follow the system theme; the design tokens switch on the .dark class.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
	document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const root = document.getElementById("root");
if (!root) throw new Error("The frame page has no #root element");

// The page script sizes the frame to the card; with no card yet, to nothing, so the
// frame never covers the page for no reason.
new ResizeObserver(() =>
	tellPage({
		mima: "size",
		height: root.childElementCount ? document.documentElement.scrollHeight : 0,
	}),
).observe(document.body);

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
