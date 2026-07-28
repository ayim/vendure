import {bootstrap, JobQueueService, Logger, runMigrations} from '@vendure/core';

import {config} from './vendure-config';

async function start() {
    await runMigrations(config);
    const app = await bootstrap(config);
    await app.get(JobQueueService).start();
    Logger.info(`Overwatch demo API is listening on port ${config.apiOptions?.port}`, 'Bootstrap');
}

start().catch(error => {
    Logger.error(error instanceof Error ? error.stack ?? error.message : String(error), 'Bootstrap');
    process.exitCode = 1;
});
