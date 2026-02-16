import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "VoicePractice Admin",
  description: "Admin console for VoicePractice Phase 1"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
