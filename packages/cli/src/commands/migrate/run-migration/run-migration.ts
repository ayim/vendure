import { log, spinner } from '@clack/prompts';
import { runMigrations } from '@vendure/core';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';

const cancelledMessage = 'Run migrations cancelled';

export const runMigrationCommand = new CliCommand<{ configFile?: string }>({
    id: 'run-migration',
    category: 'Other',
    description: 'Run any pending database migrations',
    run: options => runRunMigration(options?.configFile),
});

async function runRunMigration(configFile?: string): Promise<CliCommandReturnVal> {
    const { project } = await analyzeProject({ cancelledMessage });
    const vendureConfig = new VendureConfigRef(project, configFile);
    log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
    const config = await loadVendureConfigFile(vendureConfig);

    const runSpinner = spinner();
    runSpinner.start('Running migrations...');
    let noMigrationsFoundMessage: string | undefined;
    const migrationsRan = await runMigrations(config, {
        onNoMigrationsFound: message => (noMigrationsFoundMessage = message),
    });
    const report = migrationsRan.length
        ? `Successfully ran ${migrationsRan.length} migrations`
        : (noMigrationsFoundMessage ?? 'No pending migrations found');
    runSpinner.stop(report);
    return {
        project,
        modifiedSourceFiles: [],
    };
}
