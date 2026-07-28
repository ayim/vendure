import { AuthContext } from '@/vdb/providers/auth.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router';
import { PostHogProvider, usePostHog } from '@posthog/react';
import React from 'react';
import { usePageTitle } from '../common/use-page-title.js';

export interface MyRouterContext {
    auth: AuthContext;
    queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
    component: RootComponent,
});

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as string | undefined;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;

if (import.meta.env.DEV && !posthogKey) {
    console.error(
        'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_PROJECT_TOKEN is configured',
    );
}

function PostHogAuthBridge() {
    const auth = useAuth();
    const posthog = usePostHog();
    const prevStatusRef = React.useRef(auth.status);

    React.useEffect(() => {
        const prevStatus = prevStatusRef.current;
        prevStatusRef.current = auth.status;

        if (auth.status === 'authenticated' && auth.user) {
            posthog.identify(auth.user.id, {
                email: auth.user.emailAddress,
                name: `${auth.user.firstName} ${auth.user.lastName}`,
                role: 'admin',
            });
        } else if (prevStatus === 'authenticated' && auth.status === 'unauthenticated') {
            posthog.reset();
        }
    }, [auth.status, auth.user, posthog]);

    return null;
}

function RootComponent() {
    document.title = usePageTitle();

    if (!posthogKey || !posthogHost) {
        return (
            <>
                <HeadContent />
                <Outlet />
            </>
        );
    }

    return (
        <PostHogProvider
            apiKey={posthogKey}
            options={{
                api_host: '/ingest',
                ui_host: posthogHost,
                defaults: '2026-01-30',
                capture_exceptions: true,
                debug: import.meta.env.DEV,
            }}
        >
            <PostHogAuthBridge />
            <HeadContent />
            <Outlet />
        </PostHogProvider>
    );
}
