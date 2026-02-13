import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "mygarage.bio",
  description: "Link-in-bio for car builds."
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="site-brand" href="/">
            mygarage.bio
          </Link>
          <AuthButton />
        </header>
        {children}
      </body>
    </html>
  );
}
