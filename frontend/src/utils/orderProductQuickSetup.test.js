import assert from 'node:assert/strict';

import {
    copyProductQuickSetupItemsToNamespace,
    findProductQuickSetupItems,
} from './orderProductQuickSetup.js';

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

runTest('findProductQuickSetupItems returns items from the active namespace first', () => {
    const store = {
        'legacy::GSDT': {
            '6::men lam': [{ product_id: 101 }],
        },
        '2::1::GSDT::order-form': {
            '6::men lam': [{ product_id: 202 }],
        },
    };

    const result = findProductQuickSetupItems(store, '2::1::GSDT::order-form', '6::men lam');

    assert.equal(result.sourceNamespace, '2::1::GSDT::order-form');
    assert.deepEqual(result.items, [{ product_id: 202 }]);
});

runTest('findProductQuickSetupItems falls back to another namespace with the same setup key', () => {
    const store = {
        '1::GSDT': {
            '6::men lam': [{ product_id: 101 }, { product_id: 102 }],
        },
        '2::1::GSDT::order-form': {},
    };

    const result = findProductQuickSetupItems(store, '2::1::GSDT::order-form', '6::men lam');

    assert.equal(result.sourceNamespace, '1::GSDT');
    assert.deepEqual(result.items, [{ product_id: 101 }, { product_id: 102 }]);
});

runTest('copyProductQuickSetupItemsToNamespace copies fallback items without mutating the source store', () => {
    const sourceItems = [{ product_id: 101 }];
    const store = {
        '1::GSDT': {
            '6::men lam': sourceItems,
        },
    };

    const nextStore = copyProductQuickSetupItemsToNamespace(
        store,
        '2::1::GSDT::order-form',
        '6::men lam',
        sourceItems,
    );

    assert.notEqual(nextStore, store);
    assert.notEqual(nextStore['2::1::GSDT::order-form']['6::men lam'], sourceItems);
    assert.deepEqual(nextStore['2::1::GSDT::order-form']['6::men lam'], sourceItems);
    assert.equal(store['2::1::GSDT::order-form'], undefined);
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
