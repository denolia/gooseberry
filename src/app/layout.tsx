import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Sue_Ellen_Francisco } from "next/font/google";
import { Providers } from "@/app/providers/Providers";
import { NextIntlClientProvider } from "next-intl";
import { getI18n } from "@/i18n/server";

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

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: "Learn.words",
    description: t("common.appDescription"),
    icons: {
      icon: "/favicon.ico",
      shortcut: "/favicon.ico",
      apple: "/favicon.ico",
    },
  };
}

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
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
