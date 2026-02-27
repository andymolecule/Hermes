import type { Metadata } from "next";
import dynamic from "next/dynamic";
import "./globals.css";

const ClientLayout = dynamic(
  () => import("../components/ClientLayout").then((m) => m.ClientLayout),
  { ssr: false },
) as React.ComponentType<{ children: React.ReactNode }>;

export const metadata: Metadata = {
  title: "Hermes",
  description: "On-chain science bounties on Base",
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-grid font-sans">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
