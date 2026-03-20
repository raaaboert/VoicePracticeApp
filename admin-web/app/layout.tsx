import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Peritio - Web Admin",
  description: "Internal Peritio admin console"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
