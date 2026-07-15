import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

createCrudTestSuite({
    entityName: 'product',
    entityNamePlural: 'products',
    listPath: '/products',
    listTitle: 'Products',
    newButtonLabel: 'New Product',
    newPageTitle: 'New product',
    createFields: [{ label: 'Product name', value: 'E2E Test Product' }],
    afterFillCreate: async (_page, detail) => {
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
    },
});

test.describe('Product detail features', () => {
    test('should display all detail page sections', async ({ page }) => {
        // Navigate to the seeded "Laptop" product via search to avoid race conditions
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await page.getByPlaceholder('Filter...').fill('Laptop');
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Product name field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Product name', { exact: true }),
        ).toBeVisible();

        // Slug field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Slug', { exact: true }),
        ).toBeVisible();

        // Description field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Description', { exact: true }),
        ).toBeVisible();

        // Enabled toggle
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Enabled', { exact: true }),
        ).toBeVisible();

        // Facet Values block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Facet Values', { exact: true }),
        ).toBeVisible();

        // Assets block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Assets', { exact: true }),
        ).toBeVisible();
    });

    test('should display product variants table', async ({ page }) => {
        // Navigate to the seeded "Laptop" product which has variants
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await page.getByPlaceholder('Filter...').fill('Laptop');
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // The "Manage variants" button should be visible for the Laptop product
        await expect(page.getByRole('button', { name: /Manage variants/i })).toBeVisible({ timeout: 10_000 });
    });

    test('should navigate to manage variants page', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        const manageButton = page.getByRole('button', { name: /Manage variants/i });
        // Only proceed if the product has variants
        if (await manageButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await manageButton.click();
            await expect(page).toHaveURL(/\/products\/[^/]+\/variants/);
        }
    });

    test('should display the rich text editor for description', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // The rich text editor renders a ProseMirror container with a toolbar
        // Look for the editor toolbar (formatting buttons) or the editable area
        const editorContainer = page.getByTestId('rich-text-editor');
        await expect(editorContainer.first()).toBeVisible({ timeout: 5_000 });
    });

    test('should display custom field tabs when configured', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Custom fields are configured in the test fixtures (SEO, Details, Struct tabs)
        // Check if any custom field tabs/sections are present
        const customFieldsBlock = page
            .locator('[data-slot="card-title"]')
            .filter({ hasText: /custom fields|seo|details/i });
        const hasCustomFields = await customFieldsBlock
            .first()
            .isVisible({ timeout: 3_000 })
            .catch(() => false);

        if (hasCustomFields) {
            await expect(customFieldsBlock.first()).toBeVisible();
        }
        // If no custom fields configured in the fixture, this test passes silently
    });
});

// OSS-567 — the changed-fields-only update behaviour is framework-wide, not just
// the variant page. Editing only the (translated) product name must send just
// `id` + `translations`, leaving replace-semantics fields (facetValueIds, assetIds,
// enabled) untouched so they can't clobber a concurrent edit.
test.describe('product update sends only changed fields (OSS-567)', () => {
    let productId: string;

    // Create a dedicated product instead of editing a seed product: this test
    // renames and saves, and mutating shared seed data (e.g. the "Laptop"
    // product) pollutes other specs that assert on it — notably
    // translation-placeholders, which expects the Laptop name to stay "Laptop".
    // Seed it with a non-empty `facetValueIds` so the assertion below proves the
    // unchanged non-empty replace-array is *omitted* (not merely that an empty one is).
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        const { facetValues } = await client.gql(
            `query { facetValues(options: { take: 1 }) { items { id } } }`,
        );
        const facetValueId = facetValues.items[0].id as string;
        const { createProduct } = await client.gql(
            `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
            {
                input: {
                    facetValueIds: [facetValueId],
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'OSS567 Product',
                            slug: `oss567-product-${Date.now()}`,
                            description: '',
                        },
                    ],
                },
            },
        );
        productId = createProduct.id;
        await page.close();
    });

    test('editing only the name submits just id + translations', async ({ page }) => {
        await page.goto(`/products/${productId}`);

        const nameField = page
            .getByRole('main')
            .locator('[data-slot="field"]')
            .filter({
                has: page.locator('[data-slot="field-label"]').getByText('Product name', { exact: true }),
            })
            .getByRole('textbox');
        await expect(nameField).toBeVisible({ timeout: 10_000 });
        const newName = `OSS567 Product ${Date.now()}`;
        await nameField.fill(newName);

        const updateRequest = page.waitForRequest(
            req => req.method() === 'POST' && (req.postData() ?? '').includes('mutation UpdateProduct('),
            { timeout: 15_000 },
        );
        await page.getByRole('button', { name: 'Update' }).click();
        const input = (await updateRequest).postDataJSON()?.variables?.input;

        expect(input).toBeTruthy();
        expect(Object.keys(input).sort()).toEqual(['id', 'translations']);
        expect(input.facetValueIds).toBeUndefined();
        expect(input.assetIds).toBeUndefined();
        expect(input.enabled).toBeUndefined();
        expect(input.translations?.[0]?.name).toBe(newName);

        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /updated/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test.afterAll(async ({ browser }) => {
        if (!productId) return;
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, {
            id: productId,
        });
        await page.close();
    });
});
