/**
 * Runs inside the page when someone chooses Fill: finds the visible password field and
 * the username field before it, and types into them the way a person would, so the
 * page's own scripts notice. It must not use anything from outside its own body.
 */
export function fillLoginForm(username: string, password: string) {
	const visible = (element: HTMLElement) => {
		const style = getComputedStyle(element);
		return (
			element.getClientRects().length > 0 &&
			style.visibility !== "hidden" &&
			style.display !== "none" &&
			!(element as HTMLInputElement).disabled &&
			!(element as HTMLInputElement).readOnly
		);
	};
	const type = (input: HTMLInputElement, value: string) => {
		const setValue = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		input.focus();
		setValue?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	};

	const inputs = [...document.querySelectorAll("input")].filter(visible);
	const passwordField = inputs.find((input) => input.type === "password");
	const usernameTypes = ["text", "email", "tel", ""];
	const before = passwordField
		? inputs.slice(0, inputs.indexOf(passwordField))
		: inputs;
	const usernameField =
		inputs.find((input) => input.autocomplete === "username") ??
		before.reverse().find((input) => usernameTypes.includes(input.type));

	if (usernameField && username) type(usernameField, username);
	if (passwordField && password) type(passwordField, password);
	return { username: Boolean(usernameField), password: Boolean(passwordField) };
}
