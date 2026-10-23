import type { ImportSource } from "./parsed";

// The apps people move from, with how to export from each. docs/import.md says the same
// at more length; keep the two in step.

export type ImportApp = {
	/** Also the anchor of the app's section in the docs. */
	id: string;
	name: string;
	/** The file the steps end with, as people see it: ".1pux", "CSV". */
	file: string;
	accept: string;
	steps: string[];
	note?: string;
	/** The source vauly reads the file as, when it isn't the app's name. */
	source?: ImportSource;
};

export const importApps: ImportApp[] = [
	{
		id: "1password",
		name: "1Password",
		file: ".1pux",
		accept: ".1pux,.csv",
		steps: [
			"Open the 1Password app on a Mac, Windows or Linux computer. The website and phones can't export.",
			"On a Mac, choose File › Export. On Windows or Linux, select ⋯ at the top of the sidebar, then Export.",
			"Choose your account and enter its password.",
			"Choose 1PUX as the format, then Export Data.",
		],
		note: "1PUX keeps one-time codes, API credentials, SSH keys and every vault. Pick CSV only if you must: it has logins and passwords alone.",
	},
	{
		id: "bitwarden",
		name: "Bitwarden",
		file: ".json",
		accept: ".json,.csv,.zip",
		steps: [
			"In the Bitwarden web app, go to Tools › Export vault.",
			"Under Export from, choose My vault, or an organization to bring its collections.",
			"Choose .json as the file format. Not .json (Encrypted): vauly can't open that.",
			"Select Export and confirm with your master password.",
		],
	},
	{
		id: "lastpass",
		name: "LastPass",
		file: "CSV",
		accept: ".csv,.txt,.html",
		steps: [
			"Select the LastPass button in your browser's toolbar and log in.",
			"Go to Account › Fix a problem yourself › Export vault items.",
			"Choose Export data for use anywhere, then Continue.",
			"Enter your master password. LastPass saves a CSV file.",
		],
		note: "LastPass leaves attachments out of its export, and often the one-time codes too.",
	},
	{
		id: "dashlane",
		name: "Dashlane",
		file: "ZIP",
		accept: ".zip,.csv",
		steps: [
			"Open the Dashlane web app and choose Settings from the Vault menu at the top left.",
			"Choose Export data, then Export to CSV.",
			"Unlock with your master password. Dashlane saves a ZIP; bring it here as it is.",
		],
	},
	{
		id: "keeper",
		name: "Keeper",
		file: ".json",
		accept: ".json,.csv",
		steps: [
			"In the Keeper web vault or desktop app, open the account menu at the top right and choose Settings.",
			"Choose Export.",
			"Choose JSON, then Export.",
			"Enter your master password and choose Export Now.",
		],
		note: "JSON keeps one-time codes, SSH keys and each record's type. CSV works too.",
	},
	{
		id: "nordpass",
		name: "NordPass",
		file: "CSV",
		accept: ".csv",
		steps: [
			"Open the NordPass desktop app or web vault. The phone apps can't export.",
			"Select the gear at the top left to open Settings.",
			"Under Import and Export, select Export.",
			"Enter your master password and save the CSV file.",
		],
	},
	{
		id: "roboform",
		name: "RoboForm",
		file: "CSV",
		accept: ".csv",
		steps: [
			"Select the RoboForm button in your browser's toolbar, then ⋯ › Settings.",
			"Choose Account & Data, then Export.",
			"Enter your master password and select Export. RoboForm saves a CSV file.",
		],
		note: "RoboForm's CSV holds logins and safenotes, not identities or contacts.",
	},
	{
		id: "proton-pass",
		name: "Proton Pass",
		file: "ZIP",
		accept: ".zip,.json,.csv",
		steps: [
			"Open Proton Pass on the web, in the browser extension or on your computer. Phones can't export.",
			"Open Settings and choose Export.",
			"Choose ZIP as the file format. Not PGP-encrypted: vauly can't open that.",
			"Select Export and save the file.",
		],
		note: "The export holds only the vaults you own.",
	},
	{
		id: "keepass",
		name: "KeePass",
		file: "XML",
		accept: ".xml,.csv",
		steps: [
			"Open your database in KeePass.",
			"Choose File › Export.",
			"Choose KeePass XML (2.x) and save the file.",
		],
		note: "XML keeps groups, tags, one-time codes and custom fields. The .kdbx database itself is encrypted, so vauly can't read it.",
	},
	{
		id: "keepassxc",
		name: "KeePassXC",
		file: "XML",
		accept: ".xml,.csv",
		steps: [
			"Open your database in KeePassXC.",
			"Choose Database › Export › XML File…",
			"Confirm the export and save the file.",
		],
		note: "XML keeps groups, tags and custom fields. A CSV file works too, without the custom fields.",
	},
	{
		id: "enpass",
		name: "Enpass",
		file: ".json",
		accept: ".json",
		steps: [
			"Open Enpass on your computer.",
			"Choose File › Export. On Windows, the File menu is behind ☰.",
			"Choose the vault and .json as the format.",
			"Choose where to save it, then Export.",
		],
	},
	{
		id: "apple-passwords",
		name: "Apple Passwords",
		source: "Apple Passwords",
		file: "CSV",
		accept: ".csv,.zip",
		steps: [
			"On a Mac with macOS Sequoia or later, open the Passwords app.",
			"Choose File › Export All Passwords to File, then Export Passwords.",
			"Save the CSV file.",
		],
		note: "On an iPhone, go to Settings › Apps › Safari › Export, choose only Passwords, and save to Downloads. Wi-Fi passwords and passkeys aren't exported.",
	},
	{
		id: "chrome",
		name: "Chrome",
		source: "Chrome",
		file: "CSV",
		accept: ".csv",
		steps: [
			"In Chrome, go to chrome://password-manager/settings.",
			"Next to Export passwords, select Download file.",
			"Confirm with your computer's password if asked, and save the CSV file.",
		],
	},
	{
		id: "edge",
		name: "Edge",
		source: "Chrome",
		file: "CSV",
		accept: ".csv",
		steps: [
			"In Edge, select ⋯ › Passwords.",
			"Select ⋯ next to the search box, then Export passwords.",
			"Select Export, confirm with your computer's password, and save the CSV file.",
		],
		note: "Edge on phones can't export passwords.",
	},
	{
		id: "brave",
		name: "Brave",
		source: "Chrome",
		file: "CSV",
		accept: ".csv",
		steps: [
			"In Brave, go to brave://password-manager/settings.",
			"Next to Export passwords, select Download file.",
			"Confirm with your computer's password if asked, and save the CSV file.",
		],
	},
	{
		id: "firefox",
		name: "Firefox",
		file: "CSV",
		accept: ".csv",
		steps: [
			"In Firefox, open the ≡ menu and choose Passwords.",
			"Select ⋯ at the top right, then Export Passwords…",
			"Select Continue with export, confirm with your computer's password, and save the file.",
		],
	},
	{
		id: "another-app",
		name: "Another app",
		source: "CSV",
		file: "CSV",
		accept: ".csv",
		steps: [
			"Export your passwords from the app as a CSV file.",
			"Make sure the first row names the columns, and that one is called password. vauly also reads name, url, username, notes, totp, folder and tags.",
		],
	},
];

/** The app a file came from, for its mark in the review. */
export function appFor(source: ImportSource) {
	return importApps.find((app) => (app.source ?? app.name) === source);
}
