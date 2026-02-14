import type { Metadata } from "next";
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
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
