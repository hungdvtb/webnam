import assert from 'node:assert/strict';

import * as bundleOptionUtils from './bundleOptions.js';
import {
    cloneBundleOptionForCopy,
    copyBundleOptionBelowSource,
} from './bundleOptions.js';

const createSourceOption = () => ({
    id: 'source-option',
    title: 'Bộ men lam',
    post_id: 88,
    post_title: 'Bài viết đi kèm',
    image_url: 'https://example.com/option.jpg',
    video_url: 'https://example.com/option.mp4',
    video_source: 'custom',
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
        createOptionUid: () => 'copied-option-uid',
    });

    assert.equal(clonedOption.id, 'copied-option-1');
    assert.equal(clonedOption.uid, 'copied-option-uid');
    assert.equal(clonedOption.bundle_option_uid, 'copied-option-uid');
    assert.equal(clonedOption.title, `Copy ${sourceOption.title}`);
    assert.equal(clonedOption.post_id, sourceOption.post_id);
    assert.equal(clonedOption.post_title, sourceOption.post_title);
    assert.equal(clonedOption.image_url, sourceOption.image_url);
    assert.equal(clonedOption.video_url, sourceOption.video_url);
    assert.equal(clonedOption.video_source, sourceOption.video_source);
    assert.equal(clonedOption.items.length, 2);

    assert.deepEqual(
        clonedOption.items.map((item) => ({
            id: item.id,
            product_id: item.product_id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            is_default: item.is_default,
            name: item.name,
        })),
        sourceOption.items.map((item) => ({
            id: item.product_id,
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

runTest('cloneBundleOptionForCopy backfills product_id from item id when needed', () => {
    const clonedOption = cloneBundleOptionForCopy(
        {
            id: 'source-option',
            title: 'Source',
            items: [
                {
                    entry_id: 'source-entry',
                    id: 301,
                    sku: 'CONFIG-PARENT',
                    type: 'configurable',
                    variant_id: 401,
                    name: 'Selected variant',
                },
            ],
        },
        {
            createOptionId: () => 'copy-option',
            createEntryId: () => 'copy-entry',
            createOptionUid: () => 'copy-option-uid',
        },
    );

    assert.equal(clonedOption.items[0].id, 301);
    assert.equal(clonedOption.items[0].product_id, 301);
    assert.equal(clonedOption.items[0].variant_id, 401);
    assert.equal(clonedOption.items[0].sku, 'CONFIG-PARENT');
});

runTest('copyBundleOptionBelowSource inserts the copied option below the source and keeps source untouched', () => {
    const sourceOption = createSourceOption();
    const options = [
        { id: 'existing-top', title: 'Tùy chọn hiện tại', items: [] },
        sourceOption,
        { id: 'existing-bottom', title: 'Tùy chọn cuối', items: [] },
    ];

    let optionIdCounter = 0;
    let entryIdCounter = 0;
    const { copiedOption, nextOptions } = copyBundleOptionBelowSource(options, 'source-option', {
        createOptionId: () => `copy-${++optionIdCounter}`,
        createEntryId: () => `entry-copy-${++entryIdCounter}`,
        createOptionUid: () => 'copy-uid-1',
    });

    assert.ok(copiedOption);
    assert.equal(nextOptions.length, 4);
    assert.equal(nextOptions[0].id, 'existing-top');
    assert.equal(nextOptions[1].id, 'source-option');
    assert.equal(nextOptions[2].id, 'copy-1');
    assert.equal(nextOptions[3].id, 'existing-bottom');
    assert.equal(nextOptions[2].title, `Copy ${sourceOption.title}`);
    assert.equal(nextOptions[2].bundle_option_uid, 'copy-uid-1');
    assert.deepEqual(nextOptions[2].items.map((item) => item.entry_id), ['entry-copy-1', 'entry-copy-2']);
    assert.deepEqual(sourceOption.items.map((item) => item.entry_id), ['entry-1', 'entry-2']);
});

runTest('copyBundleOptionBelowSource returns a safe no-op when source option does not exist', () => {
    const options = [{ id: 'only-option', title: 'Only', items: [] }];
    const { copiedOption, nextOptions } = copyBundleOptionBelowSource(options, 'missing-option');

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
            createOptionUid: () => 'empty-copy-uid',
        },
    );

    assert.equal(clonedOption.id, 'empty-copy');
    assert.equal(clonedOption.uid, 'empty-copy-uid');
    assert.equal(clonedOption.title, 'Copy Không sản phẩm');
    assert.deepEqual(clonedOption.items, []);
});

runTest('calculateBundleOptionImportCostTotal totals rounded import cost by quantity', () => {
    assert.equal(typeof bundleOptionUtils.calculateBundleOptionImportCostTotal, 'function');
    assert.equal(
        bundleOptionUtils.calculateBundleOptionImportCostTotal({
            items: [
                { cost_price: 850000, quantity: 2 },
                { cost_price: '139.600', quantity: 4 },
                { cost_price: '', quantity: 99 },
            ],
        }),
        2260000,
    );
});

runTest('resolveBundleImportCostValue falls back to expected cost when current cost is empty', () => {
    assert.equal(typeof bundleOptionUtils.resolveBundleImportCostValue, 'function');
    assert.equal(
        bundleOptionUtils.resolveBundleImportCostValue(null, '', '289500.00'),
        290000,
    );
    assert.equal(
        bundleOptionUtils.resolveBundleImportCostValue(null, undefined, ''),
        '',
    );
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
