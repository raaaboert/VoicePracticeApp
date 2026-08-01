import { Alert, Linking } from "react-native";

import { sanitizeTrainingContentLink } from "./externalUrlPolicy";

export { sanitizeTrainingContentLink } from "./externalUrlPolicy";

export const EXTERNAL_RESOURCE_CONFIRMATION =
  "This resource opens outside Peritio. Continue?";

export function confirmAndOpenExternalLink(
  rawUrl: string,
  options: {
    allowMailto?: boolean;
    onError?: (message: string) => void;
    confirmationTitle?: string;
    confirmationMessage?: string;
  } = {}
): void {
  const safeUrl = sanitizeTrainingContentLink(rawUrl, options);
  if (!safeUrl) {
    options.onError?.("This link cannot be opened safely.");
    return;
  }
  Alert.alert(
    options.confirmationTitle ?? "Open External Resource",
    options.confirmationMessage ?? EXTERNAL_RESOURCE_CONFIRMATION,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Continue",
        onPress: () => {
          void Linking.openURL(safeUrl).catch(() => {
            options.onError?.("The resource could not be opened.");
          });
        },
      },
    ]
  );
}
