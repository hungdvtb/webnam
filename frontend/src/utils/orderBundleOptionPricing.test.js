/* global process */

import assert from 'node:assert/strict';

import {
    calculateBundleItemsSubtotal,
    resolveBundleOptionEntryPrice,
} from './orderBundleOptionPricing.js';

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

runTest('calculateBundleItemsSubtotal totals unit price by quantity', () => {
    assert.equal(
        calculateBundleItemsSubtotal([
            { price: '550000.00', quantity: 1 },
            { price: 300000, quantity: 2 },
            { price: '', quantity: 99 },
        ]),
        1150000,
    );
});

runTest('resolveBundleOptionEntryPrice prefers item subtotal over stale parent option price', () => {
    const entry = {
        price: 3260000,
        bundle_option_discounted_price: 3260000,
        bundle_items: [
            { price: 550000, quantity: 1 },
            { price: 300000, quantity: 1 },
            { price: 450000, quantity: 2 },
        ],
    };

    assert.equal(resolveBundleOptionEntryPrice(entry), 1750000);
});

runTest('resolveBundleOptionEntryPrice falls back to option price when items are missing', () => {
    assert.equal(
        resolveBundleOptionEntryPrice({ bundle_option_total_price: '7290000.00' }, []),
        7290000,
    );
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
