import {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
    output: 'standalone',
    cacheComponents: true,
    turbopack: {
        root: process.cwd(),
    },
    images: {
        // This is necessary to display images from your local Vendure instance
        dangerouslyAllowLocalIP: true,
        // The Oracle demo is initially addressed by public IP, so product asset
        // hosts cannot be fixed at build time.
        remotePatterns: [
            {
                protocol: 'http',
                hostname: '**',
            },
            {
                protocol: 'https',
                hostname: '**',
            },
        ],
    },
    experimental: {
        rootParams: true
    }
};

export default withNextIntl(nextConfig);
