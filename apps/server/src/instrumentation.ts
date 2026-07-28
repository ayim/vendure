import {resourceFromAttributes} from '@opentelemetry/resources';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {getSdkConfiguration} from '@vendure/telemetry-plugin/preload';
import 'dotenv/config';

const licenseKey = process.env.NEW_RELIC_LICENSE_KEY;

if (licenseKey) {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
        process.env.NEW_RELIC_OTLP_ENDPOINT ?? 'https://otlp.nr-data.net';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = `api-key=${licenseKey}`;
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
    process.env.OTEL_LOGS_EXPORTER = 'otlp';
}

const sdk = new NodeSDK(
    getSdkConfiguration({
        config: {
            resource: resourceFromAttributes({
                'service.name': process.env.OTEL_SERVICE_NAME ?? 'vendure-overwatch-demo',
                'service.namespace': 'overwatch-demo',
                'service.environment': process.env.APP_ENV ?? 'production',
                'service.version': process.env.APP_VERSION ?? 'local',
                'deployment.environment.name': process.env.APP_ENV ?? 'production',
                'vcs.repository.url':
                    process.env.VCS_REPOSITORY_URL ?? 'https://github.com/ayim/vendure',
                'vcs.ref.head.name': process.env.VCS_REF_NAME ?? 'master',
                'vcs.ref.head.revision': process.env.VCS_REF_REVISION ?? process.env.APP_VERSION ?? 'local',
            }),
        },
    }),
);

sdk.start();
