import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CXM", template: "%s · CXM" },
  description: "SubcontractorHub customer experience dashboard",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
