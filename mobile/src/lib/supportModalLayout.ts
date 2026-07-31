export const SUPPORT_MODAL_MAX_HEIGHT_RATIO = 0.84;
export const SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS = "handled" as const;

export function getSupportModalMaxHeight(windowHeight: number): number {
  const normalizedHeight = Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : 640;
  return Math.round(normalizedHeight * SUPPORT_MODAL_MAX_HEIGHT_RATIO);
}

export function getSupportModalKeyboardDismissMode(platform: string): "interactive" | "on-drag" {
  return platform === "ios" ? "interactive" : "on-drag";
}
