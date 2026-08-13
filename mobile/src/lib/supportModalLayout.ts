export const SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS = "handled" as const;

export function getSupportModalKeyboardDismissMode(platform: string): "interactive" | "none" {
  return platform === "ios" ? "interactive" : "none";
}
