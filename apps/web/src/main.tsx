import { loadConfig } from "./config";

// The instance's settings come first: the app's modules read them as they load.
loadConfig().then(() => import("./app"));
