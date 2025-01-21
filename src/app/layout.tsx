import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Sue_Ellen_Francisco } from "next/font/google";

const sueEllenFrancisco = Sue_Ellen_Francisco({
  subsets: ["latin"], // Specify the subset
  weight: "400", // Only one weight available for this font
  variable: "--font-sue-ellen", // Optional: Define a CSS variable
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Learn.words",
  description: "Translate, learn and practice words",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sueEllenFrancisco.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
