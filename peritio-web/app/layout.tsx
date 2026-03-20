import "./globals.css";

import type { Metadata } from "next";
import { ReactNode } from "react";

import { ThemeProvider } from "@/src/components/ThemeProvider";

const themeBootScript = `
(() => {
  try {
    const stored = window.localStorage.getItem('peritio.theme');
    const theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
    document.documentElement.dataset.theme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`;

export const metadata: Metadata = {
  title: "Peritio",
  description: "Peritio training insight platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
