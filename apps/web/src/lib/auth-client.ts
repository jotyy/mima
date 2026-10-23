import { createAuthClient } from "better-auth/react";

import { instance } from "../config";

// Without an API address of its own the API is on the app's, Better Auth's default.
export const authClient = createAuthClient({
	baseURL: instance().server || undefined,
});
