import type { Metadata } from "next";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "HODL: tokens that reward holding",
  description: "Launch and trade tokens where the sell tax melts to zero the longer you hold.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap"
        />
      </head>
      <body>
        <Providers>
          <Header />
          <main className="page">{children}</main>
          <footer className="foot">
            HODL is an unaudited prototype. Only trade with money you can lose.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
