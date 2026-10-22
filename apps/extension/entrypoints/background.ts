import { getUnlocked } from "@/lib/storage";

// Checks every minute whether the extension has been idle long enough to lock, so the
// unlocked key leaves memory even if the popup is never opened again.
export default defineBackground(() => {
	browser.alarms.create("auto-lock", { periodInMinutes: 1 });
	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === "auto-lock") void getUnlocked();
	});
});
