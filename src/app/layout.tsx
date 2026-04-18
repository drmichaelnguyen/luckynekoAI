import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";

import { GlobalLanguageSwitcher } from "@/components/i18n/global-language-switcher";
import { LocaleProvider } from "@/contexts/locale-context";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n/config";

import "./globals.css";

import { AuthSessionProvider } from "./providers";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-sans" });

export const metadata: Metadata = {
  applicationName: "NekoZeni",
  title: {
    default: "NekoZeni",
    template: "%s | NekoZeni",
  },
  description:
    "NekoZeni — a chat-first lucky-cat treasurer for transactions, receipts, and Canadian payroll documents.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NekoZeni",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#d97706",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} min-h-dvh font-sans`}>
        <LocaleProvider initialLocale={locale}>
          <GlobalLanguageSwitcher />
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
