import posthog from 'posthog-js';

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey) {
    posthog.init(posthogKey, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        defaults: '2025-11-30',
        capture_pageview: false,
        capture_pageleave: true,
        person_profiles: 'identified_only',
    });

    if (process.env.NEXT_PUBLIC_SYNTHETIC_TRAFFIC === 'true') {
        posthog.register({
            synthetic: true,
            traffic_type: 'demo_synthetic',
        });
    }
}
