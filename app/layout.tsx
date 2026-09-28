import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const sans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "PDF-Strip — wipe metadata, keep the page",
  description:
    "Drop a PDF, photo, or Word file. Author, dates, EXIF, and Content Credentials are stripped. Nothing is stored.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${sans.className} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
