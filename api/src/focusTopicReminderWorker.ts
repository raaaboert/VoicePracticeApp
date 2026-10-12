import { runRetiredFocusTopicReminderShim } from "./focusTopicReminderShim.js";

// Temporary no-op compatibility entrypoint for any external scheduler that
// still invokes `npm run run:focus-topic-reminders` after deadline retirement.
runRetiredFocusTopicReminderShim();
