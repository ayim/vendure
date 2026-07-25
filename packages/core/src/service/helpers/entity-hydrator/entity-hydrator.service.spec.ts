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

        // https://github.com/vendurehq/vendure/issues/4955
        // Relation arrays can contain `undefined` holes (e.g. payments/surcharges/shippingLines
        // after OrderPlacedEvent). An `undefined` element was never fetched and must be reported
        // missing; only `null` counts as loaded.
        it('reports missing when the array has an undefined leading hole', () => {
            const order = { payments: [undefined, { refunds: [{ id: 1 }] }] };
            expect(getMissingRelations(order, ['payments.refunds'])).toEqual([
                'payments',
                'payments.refunds',
            ]);
        });

        it('does not crash when a loaded relation array is very large', () => {
            // Spreading a very large array into push() (`push(...value)`) exceeds V8's argument
            // limit and throws "RangeError: Maximum call stack size exceeded"; a plain loop must
            // be used instead. Reproduces e.g. `collections.productVariants` on a big catalog.
            const collection = {
                productVariants: Array.from({ length: 200_000 }, (_, i) => ({ id: i })),
            };
            expect(() => getMissingRelations(collection, ['productVariants'])).not.toThrow();
            expect(getMissingRelations(collection, ['productVariants'])).toEqual([]);
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
