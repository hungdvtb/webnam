import assert from 'node:assert/strict';

import { calculateGrossProfitTotal } from './money.js';

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

runTest('calculateGrossProfitTotal returns payment total minus cost total', () => {
    assert.equal(calculateGrossProfitTotal(1500000, 900000), 600000);
});

runTest('calculateGrossProfitTotal treats missing cost total as zero', () => {
    assert.equal(calculateGrossProfitTotal(1500000, null), 1500000);
    assert.equal(calculateGrossProfitTotal('1.500.000', ''), 1500000);
});

runTest('calculateGrossProfitTotal handles formatted currency strings and negative results', () => {
    assert.equal(calculateGrossProfitTotal('1.500.000₫', '2.000.000₫'), -500000);
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
