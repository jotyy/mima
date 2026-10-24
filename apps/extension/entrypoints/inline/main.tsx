import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "./style.css";

// Follow the system theme; the design tokens switch on the .dark class.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
	document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const root = document.getElementById("root");
if (!root) throw new Error("The frame page has no #root element");

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
