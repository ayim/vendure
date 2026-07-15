import { describe, expect, it } from 'vitest';

import { runPluginConfigurations } from './bootstrap';
import { CustomFieldConfig } from './config/custom-field/custom-field-types';
import { RuntimeVendureConfig } from './config/vendure-config';
// Importing the core entities registers their `customFields` embedded columns in the
// TypeORM metadata, which is how getEntityNamesWithCustomFields() detects the entities
// that support custom fields.
import { coreEntitiesMap } from './entity/entities';
import { VendurePlugin } from './plugin/vendure-plugin';

void coreEntitiesMap;

function makeConfig(partial: {
    plugins?: RuntimeVendureConfig['plugins'];
    customFields?: Record<string, CustomFieldConfig[]>;
}): RuntimeVendureConfig {
    return { plugins: [], customFields: {}, ...partial } as unknown as RuntimeVendureConfig;
}

describe('runPluginConfigurations()', () => {
    // OSS-408: entities that support custom fields get an empty array pre-initialised so a
    // plugin's `configuration` callback can extend them without a defensive guard.
    it('auto-initialises customFields for entities that support them', async () => {
        const config = makeConfig({});
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toEqual([]);
        expect(config.customFields.Customer).toEqual([]);
    });

    // OSS-408: translation entities also declare a `customFields` embedded (for localized
    // values), but must NOT be auto-initialised — a `config.customFields.<Entity>Translation`
    // entry makes the GraphQL schema builder emit a duplicate `customFields` field on the
    // `*TranslationInput` types ("... can only be defined once").
    it('does not auto-initialise translation entities', async () => {
        const config = makeConfig({});
        await runPluginConfigurations(config);
        expect(config.customFields.ProductTranslation).toBeUndefined();
        expect(config.customFields.CollectionTranslation).toBeUndefined();
    });

    it('does not overwrite an existing customFields entry', async () => {
        const existing: CustomFieldConfig[] = [{ name: 'foo', type: 'string' }];
        const config = makeConfig({ customFields: { Product: existing } });
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toBe(existing);
    });

    it('lets a plugin extend a supported entity without a guard', async () => {
        @VendurePlugin({
            configuration: cfg => {
                // No `if (!cfg.customFields.Product) cfg.customFields.Product = []` guard needed.
                cfg.customFields.Product.push({ name: 'fromPlugin', type: 'string' });
                return cfg;
            },
        })
        class TestPlugin {}

        const config = makeConfig({ plugins: [TestPlugin] });
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toContainEqual({ name: 'fromPlugin', type: 'string' });
    });
});
