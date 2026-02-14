import type { Metadata } from "next";

import { initializeDatabase } from "@/lib/db";
import { seedPreconfiguredServers } from "@/lib/db/seed";

import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Client",
  description: "Interactive MCP client shell for browsing and connecting servers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (process.env.NODE_ENV === "development") {
    initializeDatabase();
    seedPreconfiguredServers();
  }

  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
