import {bootstrap, JobQueueService, Logger, Product} from '@vendure/core';
import {populate} from '@vendure/core/cli';
import path from 'node:path';
import {DataSource} from 'typeorm';

import {initialData} from './initial-data';
import {config} from './vendure-config';

async function seed() {
    const probe = await bootstrap(config);
    const productCount = await probe.get(DataSource).getRepository(Product).count();
    await probe.close();

    if (productCount > 0) {
        Logger.info(`Seed skipped: ${productCount} products already exist`, 'Seed');
        return;
    }

    const app = await populate(
        () => bootstrap(config),
        initialData,
        path.join(process.cwd(), 'static/products.csv'),
    );
    await app.get(JobQueueService).start();
    await new Promise(resolve => setTimeout(resolve, 20_000));
    await app.close();
    Logger.info('Seed data and product assets are ready', 'Seed');
}

seed().catch(error => {
    Logger.error(error instanceof Error ? error.stack ?? error.message : String(error), 'Seed');
    process.exitCode = 1;
});
