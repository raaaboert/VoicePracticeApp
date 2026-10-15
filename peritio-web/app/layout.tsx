import "./globals.css";

import type { Metadata } from "next";
import { ReactNode } from "react";

import { ThemeProvider } from "@/src/components/ThemeProvider";
import { THEME_BOOT_SCRIPT } from "@/src/lib/themePreference";

export const metadata: Metadata = {
  title: "Peritio",
  description: "Peritio training insight platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="light">
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
