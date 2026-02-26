import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import "./globals.css";

const WebProviders = dynamic(
  () => import("../lib/wagmi").then((m) => m.WebProviders),
  { ssr: false },
);
const ThemeToggle = dynamic(
  () => import("../components/ThemeToggle").then((m) => m.ThemeToggle),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "Hermes",
  description: "On-chain science bounties",
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <WebProviders>
          <div className="container">
            <header className="header">
              <Link href="/" className="wordmark">
                Hermes
              </Link>
              <nav style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Link href="/challenges" className="badge">
                  Challenges
                </Link>
                <Link href="/post" className="badge">
                  Post
                </Link>
                <ThemeToggle />
              </nav>
            </header>
            {children}
          </div>
        </WebProviders>
      </body>
    </html>
  );
}
