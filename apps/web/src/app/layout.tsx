import type { Metadata } from "next";
import { ClientLayout } from "../components/ClientLayout";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes",
  description: "On-chain science bounties on Base",
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("hermes-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}else if(window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.setAttribute("data-theme","dark")}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-grid font-sans">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
