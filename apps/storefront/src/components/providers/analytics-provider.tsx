'use client';

import posthog from 'posthog-js';
import {PostHogProvider} from 'posthog-js/react';
import {usePathname, useSearchParams} from 'next/navigation';
import {Suspense, useEffect} from 'react';

function CriticalPathTracker() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    useEffect(() => {
        if (!pathname) {
            return;
        }

        const url = `${window.origin}${pathname}${searchParams.size ? `?${searchParams}` : ''}`;
        posthog.capture('$pageview', {$current_url: url});

        const criticalPath =
            pathname.includes('/sign-in') || pathname.includes('/register')
                ? 'authentication'
                : pathname.includes('/checkout')
                  ? 'checkout'
                  : pathname.includes('/cart')
                    ? 'cart'
                    : pathname.includes('/product/')
                      ? 'product'
                      : undefined;

        if (criticalPath) {
            posthog.capture('critical_path_entered', {
                critical_path: criticalPath,
                route: pathname,
            });
        }
    }, [pathname, searchParams]);

    return null;
}

export function AnalyticsProvider({children}: {children: React.ReactNode}) {
    return (
        <PostHogProvider client={posthog}>
            <Suspense fallback={null}>
                <CriticalPathTracker />
            </Suspense>
            {children}
        </PostHogProvider>
    );
}
