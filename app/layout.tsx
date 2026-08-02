import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Daily Tiffin Tracker",
  description: "A transparent record of every meal, bill and payment.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Tiffin Tracker" },
};

import { Analytics } from "@vercel/analytics/next";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}

