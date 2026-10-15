import "./globals.css";
import { ReactNode } from "react";
import { ThemeProvider } from "../../peritio-web/src/components/ThemeProvider";
import { THEME_BOOT_SCRIPT } from "../../peritio-web/src/lib/themePreference";

export const metadata = {
  title: "Peritio - Web Admin",
  description: "Internal Peritio admin console"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="light">
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
