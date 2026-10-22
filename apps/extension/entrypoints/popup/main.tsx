import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("The popup page has no #root element");

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
