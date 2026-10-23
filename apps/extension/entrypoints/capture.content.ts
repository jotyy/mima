// Notices a login being submitted on a page and hands it to the background, which keeps
// it for the popup to offer saving. Nothing is stored here, and nothing leaves the
// browser.
export default defineContentScript({
	matches: ["http://*/*", "https://*/*"],
	runAt: "document_idle",
	main() {
		let last = "";

		const visible = (element: HTMLElement) =>
			element.getClientRects().length > 0 &&
			getComputedStyle(element).visibility !== "hidden";

		const report = () => {
			const passwords = [
				...document.querySelectorAll<HTMLInputElement>(
					'input[type="password"]',
				),
			].filter((input) => input.value && visible(input));
			if (passwords.length === 0) return;
			// A sign-up or change form repeats the new password last; otherwise it's the first.
			const [first] = passwords;
			const newest = passwords.at(-1);
			const password =
				passwords.length > 1 && newest?.value === passwords.at(-2)?.value
					? newest
					: first;
			if (!password || password.value.length < 4) return;

			const scope = password.form ?? document;
			const inputs = [
				...scope.querySelectorAll<HTMLInputElement>("input"),
			].filter(visible);
			const before = inputs.slice(0, inputs.indexOf(password)).reverse();
			const username =
				inputs.find(
					(input) => input.autocomplete === "username" && input.value,
				) ??
				before.find(
					(input) =>
						["text", "email", "tel", ""].includes(input.type) && input.value,
				);

			const login = {
				type: "mima:login",
				username: username?.value.trim() ?? "",
				password: password.value,
			};
			const key = `${login.username}\n${login.password}`;
			if (key === last) return;
			last = key;
			void browser.runtime.sendMessage(login).catch(() => {});
		};

		document.addEventListener("submit", report, true);
		document.addEventListener(
			"click",
			(event) => {
				const target = event.target as Element | null;
				if (target?.closest('button, input[type="submit"], [role="button"]'))
					report();
			},
			true,
		);
		document.addEventListener(
			"keydown",
			(event) => {
				if (event.key === "Enter" && event.target instanceof HTMLInputElement)
					report();
			},
			true,
		);
	},
});
