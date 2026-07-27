import { beforeEach, describe, expect, it, vi } from 'vitest';

const runMigrationsMock = vi.fn();

vi.mock('@clack/prompts', () => ({
    log: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('../../shared/project-validation', () => ({
    validateVendureProjectDirectory: vi.fn(),
}));
vi.mock('../../shared/shared-prompts', () => ({
    analyzeProject: vi.fn().mockResolvedValue({ project: {}, tsConfigPath: 'tsconfig.json' }),
}));
vi.mock('../../shared/vendure-config-ref', () => ({
    VendureConfigRef: class {
        getPathRelativeToProjectRoot() {
            return 'src/vendure-config.ts';
        }
    },
}));
vi.mock('../../shared/load-vendure-config-file', () => ({
    loadVendureConfigFile: vi.fn().mockResolvedValue({}),
}));
vi.mock('@vendure/core', () => ({
    runMigrations: (...args: any[]) => runMigrationsMock(...args),
    generateMigration: vi.fn(),
    revertLastMigration: vi.fn(),
}));

// eslint-disable-next-line import/first
import { runMigrationsOperation } from './migration-operations';

describe('runMigrationsOperation() reporting', () => {
    beforeEach(() => {
        runMigrationsMock.mockReset();
    });

    it('reports the reason when no migration files were found', async () => {
        // #5001 — a non-matching `migrations` glob is reported as success, which makes an
        // out-of-sync database look like an up-to-date one.
        runMigrationsMock.mockImplementation((config: unknown, options: any) => {
            options?.onNoMigrationsFound?.('No migration files matched the configured patterns.');
            return Promise.resolve([]);
        });

        const result = await runMigrationsOperation();

        expect(result.success).toBe(true);
        expect(result.message).toBe('No migration files matched the configured patterns.');
        expect(result.message).not.toBe('No pending migrations found');
    });

    it('still reports "No pending migrations found" when migration files exist', async () => {
        runMigrationsMock.mockResolvedValue([]);

        const result = await runMigrationsOperation();

        expect(result.success).toBe(true);
        expect(result.message).toBe('No pending migrations found');
    });

    it('reports the number of migrations that ran', async () => {
        runMigrationsMock.mockResolvedValue(['1700000000000-first', '1700000000001-second']);

        const result = await runMigrationsOperation();

        expect(result.success).toBe(true);
        expect(result.message).toBe('Successfully ran 2 migrations');
        expect(result.migrationsRan).toHaveLength(2);
    });
});
