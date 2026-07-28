import {AssetServerPlugin} from '@vendure/asset-server-plugin';
import {
    DefaultJobQueuePlugin,
    DefaultLogger,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    LogLevel,
    VendureConfig,
} from '@vendure/core';
import {defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader} from '@vendure/email-plugin';
import {GraphiqlPlugin} from '@vendure/graphiql-plugin';
import {TelemetryPlugin} from '@vendure/telemetry-plugin';
import 'dotenv/config';
import path from 'node:path';

import {HealthPlugin} from './health.plugin';

const isDevelopment = process.env.APP_ENV === 'development';
const telemetryEnabled = process.env.OTEL_ENABLED !== 'false';
const dataDir = process.env.VENDURE_DATA_DIR ?? path.join(process.cwd(), 'data');
const publicApiUrl = process.env.PUBLIC_API_URL;

export const config: VendureConfig = {
    apiOptions: {
        port: Number(process.env.PORT ?? 3000),
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        trustProxy: isDevelopment ? false : 1,
        cors: {
            origin: (process.env.STOREFRONT_ORIGIN ?? 'http://localhost:3001').split(','),
            credentials: true,
        },
        ...(isDevelopment
            ? {
                  adminApiDebug: true,
                  shopApiDebug: true,
              }
            : {}),
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        requireVerification: false,
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME ?? 'superadmin',
            password: process.env.SUPERADMIN_PASSWORD ?? 'superadmin',
        },
        cookieOptions: {
            secret: process.env.COOKIE_SECRET ?? 'replace-this-in-production',
        },
    },
    dbConnectionOptions: {
        type: 'postgres',
        synchronize: process.env.DB_SYNCHRONIZE !== 'false',
        migrations: [path.join(__dirname, 'migrations/*.+(js|ts)')],
        logging: false,
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        schema: process.env.DB_SCHEMA ?? 'public',
        username: process.env.DB_USERNAME ?? 'vendure',
        password: process.env.DB_PASSWORD ?? 'vendure',
    },
    importExportOptions: {
        importAssetsDir: path.join(process.cwd(), 'static/assets'),
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    logger: new DefaultLogger({
        level: isDevelopment ? LogLevel.Debug : LogLevel.Info,
    }),
    plugins: [
        HealthPlugin,
        ...(isDevelopment ? [GraphiqlPlugin.init()] : []),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(dataDir, 'assets'),
            assetUrlPrefix: publicApiUrl ? `${publicApiUrl.replace(/\/$/, '')}/assets/` : undefined,
        }),
        DefaultSchedulerPlugin.init(),
        DefaultJobQueuePlugin.init({useDatabaseForBuffer: true}),
        DefaultSearchPlugin.init({bufferUpdates: false, indexStockStatus: true}),
        EmailPlugin.init({
            devMode: true,
            route: 'mailbox',
            outputPath: path.join(dataDir, 'emails'),
            handlers: defaultEmailHandlers,
            templateLoader: new FileBasedTemplateLoader(
                path.join(process.cwd(), 'node_modules/@vendure/email-plugin/templates'),
            ),
            globalTemplateVars: {
                fromAddress: '"Overwatch Demo" <noreply@example.com>',
                verifyEmailAddressUrl: `${process.env.STOREFRONT_ORIGIN ?? 'http://localhost:3001'}/verify`,
                passwordResetUrl: `${process.env.STOREFRONT_ORIGIN ?? 'http://localhost:3001'}/reset-password`,
                changeEmailAddressUrl: `${process.env.STOREFRONT_ORIGIN ?? 'http://localhost:3001'}/verify`,
            },
        }),
        ...(telemetryEnabled ? [TelemetryPlugin.init({})] : []),
    ],
};
