// Identities: a person's or a company's details, for the forms that ask for them. The
// web app and the browser extension share these.

/** An identity as an item holds it. The tax number is hidden until revealed. */
export type Identity = {
	name?: string;
	company?: string;
	email?: string;
	phone?: string;
	/** The street address, one line or several. */
	address?: string;
	city?: string;
	region?: string;
	postalCode?: string;
	country?: string;
	taxNumber?: string;
	registrationNumber?: string;
};

/** The postal address as it's written on an envelope, a line each. */
export function addressLines(identity: Identity) {
	const place = [identity.city, identity.region, identity.postalCode]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");
	return [
		...(identity.address ?? "").split("\n"),
		place,
		identity.country ?? "",
	]
		.map((line) => line.trim())
		.filter(Boolean);
}
