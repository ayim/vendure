import { describe, expect, it } from 'vitest';

import { getNoMigrationsFoundMessage } from './migrate';

describe('getNoMigrationsFoundMessage()', () => {
    class SomeMigration {}

    it('returns undefined when migration files were loaded', () => {
        expect(getNoMigrationsFoundMessage(3, ['src/migrations/*.ts'], '/project')).toBeUndefined();
    });

    it('returns undefined when no migrations are configured', () => {
        expect(getNoMigrationsFoundMessage(0, undefined, '/project')).toBeUndefined();
        expect(getNoMigrationsFoundMessage(0, [], '/project')).toBeUndefined();
    });

    it('returns undefined when migrations are configured as classes', () => {
        // Classes are passed directly rather than resolved from disk, so a zero count
        // cannot be attributed to non-matching glob patterns.
        expect(getNoMigrationsFoundMessage(0, [SomeMigration], '/project')).toBeUndefined();
    });

    it('reports the patterns and the cwd they resolve against', () => {
        const message = getNoMigrationsFoundMessage(0, ['dist/migrations/*.js'], '/project');

        expect(message).toContain('No migration files matched');
        expect(message).toContain('/project');
        expect(message).toContain('dist/migrations/*.js');
    });

    it('reports every configured pattern', () => {
        const message = getNoMigrationsFoundMessage(
            0,
            ['dist/migrations/*.js', 'plugins/*/migrations/*.js'],
            '/project',
        );

        expect(message).toContain('dist/migrations/*.js');
        expect(message).toContain('plugins/*/migrations/*.js');
    });

    it('supports the object form of the migrations option', () => {
        const message = getNoMigrationsFoundMessage(0, { first: 'dist/migrations/*.js' } as any, '/project');

        expect(message).toContain('dist/migrations/*.js');
    });

    it('ignores class entries when reporting patterns', () => {
        const message = getNoMigrationsFoundMessage(0, [SomeMigration, 'dist/migrations/*.js'], '/project');

        expect(message).toContain('dist/migrations/*.js');
        expect(message).not.toContain('SomeMigration');
    });
});
