import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";

import { LocaleProvider } from "@/contexts/locale-context";
import { APP_VERSION } from "@/lib/app-version";
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
          <p
            className="pointer-events-none fixed left-3 top-3 z-50 select-none font-mono text-[10px] leading-none text-muted-foreground/70 sm:left-4 sm:top-4"
            title={`NekoZeni v${APP_VERSION}`}
            aria-hidden
          >
            v{APP_VERSION}
          </p>
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
