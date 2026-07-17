import { describe, expect, it } from 'vitest';

import { EntityHydrator } from './entity-hydrator.service';

describe('EntityHydrator', () => {
    describe('getMissingRelations()', () => {
        function getMissingRelations(target: any, relations: string[]): string[] {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            return (hydrator as any).getMissingRelations(target, { relations });
        }

        // https://github.com/vendurehq/vendure/issues/4537
        it('detects a relation missing from a later array element', () => {
            const order = {
                lines: [
                    { productVariant: { product: { id: 1 } } },
                    { productVariant: { product: undefined } },
                ],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/4537
        it('detects an intermediate relation missing from a later array element', () => {
            const order = {
                lines: [{ productVariant: { product: { id: 1 } } }, { productVariant: undefined }],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);
        });

        it('detects a relation missing from a nested array element', () => {
            const order = {
                lines: [
                    {
                        productVariant: {
                            assets: [{ asset: { id: 1 } }, { asset: undefined }],
                        },
                    },
                ],
            };

            expect(getMissingRelations(order, ['lines.productVariant.assets.asset'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.assets',
                'lines.productVariant.assets.asset',
            ]);
        });

        it('reports nothing when every array element has the relation', () => {
            const order = {
                lines: [
                    { productVariant: { product: { id: 1 } } },
                    { productVariant: { product: { id: 2 } } },
                ],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([]);
        });

        it('treats a relation that is null in the database as loaded', () => {
            const order = {
                lines: [{ productVariant: { product: null } }, { productVariant: { product: null } }],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([]);
        });

        it('reports a relation missing from a sibling of a null relation', () => {
            const order = {
                lines: [{ productVariant: { product: null } }, { productVariant: { product: undefined } }],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);
        });

        it('reports nothing for a loaded empty array', () => {
            expect(getMissingRelations({ lines: [] }, ['lines'])).toEqual([]);
        });

        it('reports deeper relations of a loaded empty array as missing', () => {
            expect(getMissingRelations({ lines: [] }, ['lines.productVariant'])).toEqual([
                'lines',
                'lines.productVariant',
            ]);
        });
    });

    describe('getRelationEntityAtPath()', () => {
        // https://github.com/vendurehq/vendure/issues/4661
        it('treats undefined intermediate relations as terminal values', () => {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            const translation = { languageCode: 'en', name: 'Laptop' };
            const order = {
                lines: [
                    {
                        productVariant: {
                            translations: [translation],
                        },
                    },
                    {
                        productVariant: undefined,
                    },
                ],
            };

            const result = (hydrator as any).getRelationEntityAtPath(order, [
                'lines',
                'productVariant',
                'translations',
            ]);

            expect(result).toEqual([translation, undefined]);
        });
    });
});
