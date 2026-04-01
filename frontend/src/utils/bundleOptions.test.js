import assert from 'node:assert/strict';

import {
    cloneBundleOptionForCopy,
    copyBundleOptionToTop,
} from './bundleOptions.js';

const createSourceOption = () => ({
    id: 'source-option',
    title: 'Bộ men lam',
    post_id: 88,
    post_title: 'Bài viết đi kèm',
    items: [
        {
            entry_id: 'entry-1',
            id: 101,
            product_id: 101,
            product_name: 'Đỉnh thờ',
            product_sku: 'DINH-THO',
            product_price: 1200000,
            product_cost_price: 800000,
            name: 'Đỉnh thờ biến thể đỏ',
            sku: 'DINH-THO-RED',
            price: 1350000,
            cost_price: 850000,
            quantity: 2,
            is_required: true,
            is_default: true,
            type: 'configurable',
            variant_id: 501,
            variant_label: 'Đỏ / Phi 18',
            image_url: 'https://example.com/dinh-tho.jpg',
            metadata: {
                dimensions: ['18cm', '24cm'],
            },
        },
        {
            entry_id: 'entry-2',
            id: 202,
            product_id: 202,
            product_name: 'Chân nến',
            product_sku: 'CHAN-NEN',
            product_price: 250000,
            product_cost_price: 140000,
            name: 'Chân nến',
            sku: 'CHAN-NEN',
            price: 250000,
            cost_price: 140000,
            quantity: 4,
            is_required: true,
            is_default: false,
            type: 'simple',
            variant_id: null,
            variant_label: '',
            image_url: 'https://example.com/chan-nen.jpg',
        },
    ],
});

const runTest = (name, fn) => {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
};

runTest('cloneBundleOptionForCopy clones full option data but regenerates IDs', () => {
    const sourceOption = createSourceOption();
    let optionIdCounter = 0;
    let entryIdCounter = 0;

    const clonedOption = cloneBundleOptionForCopy(sourceOption, {
        createOptionId: () => `copied-option-${++optionIdCounter}`,
        createEntryId: () => `copied-entry-${++entryIdCounter}`,
    });

    assert.equal(clonedOption.id, 'copied-option-1');
    assert.equal(clonedOption.title, sourceOption.title);
    assert.equal(clonedOption.post_id, sourceOption.post_id);
    assert.equal(clonedOption.post_title, sourceOption.post_title);
    assert.equal(clonedOption.items.length, 2);

    assert.deepEqual(
        clonedOption.items.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            is_default: item.is_default,
            name: item.name,
        })),
        sourceOption.items.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            is_default: item.is_default,
            name: item.name,
        })),
    );

    assert.deepEqual(
        clonedOption.items.map((item) => item.entry_id),
        ['copied-entry-1', 'copied-entry-2'],
    );
    assert.notEqual(clonedOption.items[0], sourceOption.items[0]);
    assert.notEqual(clonedOption.items[0].metadata, sourceOption.items[0].metadata);
    assert.deepEqual(clonedOption.items[0].metadata, sourceOption.items[0].metadata);
});

runTest('copyBundleOptionToTop inserts the copied option at the beginning and keeps source untouched', () => {
    const sourceOption = createSourceOption();
    const options = [
        { id: 'existing-top', title: 'Tùy chọn hiện tại', items: [] },
        sourceOption,
        { id: 'existing-bottom', title: 'Tùy chọn cuối', items: [] },
    ];

    let optionIdCounter = 0;
    let entryIdCounter = 0;
    const { copiedOption, nextOptions } = copyBundleOptionToTop(options, 'source-option', {
        createOptionId: () => `copy-${++optionIdCounter}`,
        createEntryId: () => `entry-copy-${++entryIdCounter}`,
    });

    assert.ok(copiedOption);
    assert.equal(nextOptions.length, 4);
    assert.equal(nextOptions[0].id, 'copy-1');
    assert.equal(nextOptions[1].id, 'existing-top');
    assert.equal(nextOptions[2].id, 'source-option');
    assert.equal(nextOptions[3].id, 'existing-bottom');
    assert.deepEqual(nextOptions[0].items.map((item) => item.entry_id), ['entry-copy-1', 'entry-copy-2']);
    assert.deepEqual(sourceOption.items.map((item) => item.entry_id), ['entry-1', 'entry-2']);
});

runTest('copyBundleOptionToTop returns a safe no-op when source option does not exist', () => {
    const options = [{ id: 'only-option', title: 'Only', items: [] }];
    const { copiedOption, nextOptions } = copyBundleOptionToTop(options, 'missing-option');

    assert.equal(copiedOption, null);
    assert.deepEqual(nextOptions, options);
    assert.notEqual(nextOptions, options);
});

runTest('cloneBundleOptionForCopy tolerates missing items and still returns a valid option shell', () => {
    const clonedOption = cloneBundleOptionForCopy(
        {
            id: 'empty-option',
            title: 'Không sản phẩm',
            post_id: '',
            post_title: '',
        },
        {
            createOptionId: () => 'empty-copy',
            createEntryId: () => 'unused-entry',
        },
    );

    assert.equal(clonedOption.id, 'empty-copy');
    assert.equal(clonedOption.title, 'Không sản phẩm');
    assert.deepEqual(clonedOption.items, []);
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
