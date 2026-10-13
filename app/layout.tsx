import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const sans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "File Check & Clean",
  description:
    "Check UK invoices and contracts against Companies House, then wipe author, dates, EXIF, and Content Credentials. Nothing is stored.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${sans.className} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
