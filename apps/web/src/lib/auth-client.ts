import { createAuthClient } from "better-auth/react";

import { ENV } from "../env.public";

// Without VITE_SERVER_URL the API is on the app's own address, Better Auth's default.
export const authClient = createAuthClient({
	baseURL: ENV.VITE_SERVER_URL || undefined,
});
