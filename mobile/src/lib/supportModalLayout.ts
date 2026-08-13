export const SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS = "handled" as const;

export function getSupportModalKeyboardDismissMode(platform: string): "interactive" | "on-drag" {
  return platform === "ios" ? "interactive" : "on-drag";
}
