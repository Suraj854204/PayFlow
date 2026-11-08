import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { getLocale, getMessages } from "next-intl/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/theme/theme-provider";
import { ACCENT_BOOT_SCRIPT } from "@/lib/accent";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PayFlow — AI-powered payroll & HR for India", template: "%s · PayFlow" },
  description:
    "Automation-first payroll and HR for Indian companies: PF, ESI, PT, TDS, payslips, attendance, leave and an AI copilot.",
  applicationName: "PayFlow",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b12" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: ACCENT_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers nonce={nonce}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
