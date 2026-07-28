import type {Metadata, Viewport} from "next";
import {locale as rootLocale} from "next/root-params";
import {hasLocale, NextIntlClientProvider} from "next-intl";
import {getMessages, getTranslations, setRequestLocale} from "next-intl/server";
import {notFound} from "next/navigation";
import {connection} from "next/server";
import {Suspense} from "react";
import {routing} from "@/i18n/routing";
import {toOgLocale} from "@/i18n/locale-utils";
import {getRouteLocale} from "@/i18n/server";
import {Toaster} from "@/components/ui/sonner";
import {Navbar} from "@/components/layout/navbar";
import {Footer} from "@/components/layout/footer";
import {ThemeProvider} from "@/components/providers/theme-provider";
import {AnalyticsProvider} from "@/components/providers/analytics-provider";
import {SITE_NAME, SITE_URL} from "@/lib/metadata";
import "./globals.css";

export function generateStaticParams() {
    return routing.locales.map((locale) => ({locale}));
}

export async function generateMetadata(): Promise<Metadata> {
    const locale = await getRouteLocale();
    const ogLocale = toOgLocale(locale);
    const t = await getTranslations({locale, namespace: 'Common'});

    return {
        metadataBase: new URL(SITE_URL),
        title: {
            default: SITE_NAME,
            template: `%s | ${SITE_NAME}`,
        },
        description: t('siteDescription', {siteName: SITE_NAME}),
        openGraph: {
            type: "website",
            siteName: SITE_NAME,
            locale: ogLocale,
        },
        twitter: {
            card: "summary_large_image",
        },
        robots: {
            index: true,
            follow: true,
            googleBot: {
                index: true,
                follow: true,
                "max-video-preview": -1,
                "max-image-preview": "large",
                "max-snippet": -1,
            },
        },
        alternates: {
            languages: Object.fromEntries(
                routing.locales.map((l) => [l, `/${l}`])
            ),
        },
    };
}

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    themeColor: [
        {media: "(prefers-color-scheme: light)", color: "#ffffff"},
        {media: "(prefers-color-scheme: dark)", color: "#000000"},
    ],
};

async function RequestTimeStorefront({children}: {children: React.ReactNode}) {
    // The demo API is deployed alongside the storefront, after the image is
    // built. Defer Vendure-backed rendering until request time.
    await connection();

    return (
        <>
            <Navbar />
            {children}
            <Footer/>
        </>
    );
}

export default async function LocaleLayout({children}: {children: React.ReactNode}) {
    const locale = await rootLocale();

    if (!hasLocale(routing.locales, locale)) {
        notFound();
    }

    setRequestLocale(locale);
    const messages = await getMessages({locale});

    return (
        <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
            <body
                className="antialiased flex flex-col min-h-screen"
            >
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <AnalyticsProvider>
                        <ThemeProvider>
                            <Suspense fallback={<main className="min-h-screen" />}>
                                <RequestTimeStorefront>{children}</RequestTimeStorefront>
                            </Suspense>
                            <Toaster/>
                        </ThemeProvider>
                    </AnalyticsProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
