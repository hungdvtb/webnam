import { readFile, writeFile } from 'node:fs/promises';

const inputPath = process.argv[2] || 'meta-feed.csv';
const outputPath = process.argv[3] || 'openai-product-feed.csv';
const sellerName = 'Gốm Đại Thành';

const optionalColumns = new Set([
  'condition',
  'product_category',
]);

const outputColumns = [
  'item_id',
  'title',
  'description',
  'url',
  'brand',
  'seller_name',
  'image_url',
  'availability',
  'price',
  'condition',
  'product_category',
  'is_ads_eligible',
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ''));
}

function toCsvCell(value) {
  const normalizedValue = String(value ?? '');
  if (/[",\r\n]/.test(normalizedValue)) {
    return `"${normalizedValue.replaceAll('"', '""')}"`;
  }
  return normalizedValue;
}

function normalizeAvailability(value) {
  const normalizedValue = String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');

  if (normalizedValue === 'in_stock') return 'in_stock';
  if (normalizedValue === 'out_of_stock') return 'out_of_stock';
  if (normalizedValue === 'preorder' || normalizedValue === 'pre_order') return 'pre_order';
  if (normalizedValue === 'backorder') return 'backorder';

  return 'unknown';
}

function normalizePrice(value) {
  const match = String(value || '').trim().match(/^([0-9]+(?:[.,][0-9]+)?)\s*([A-Za-z]{3})$/);
  if (!match) {
    return '';
  }

  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) {
    return '';
  }

  return `${amount.toFixed(2)} ${match[2].toUpperCase()}`;
}

const source = await readFile(inputPath, 'utf8');
const [header, ...rows] = parseCsv(source);

if (!header || rows.length === 0) {
  throw new Error(`No product rows found in ${inputPath}`);
}

const headerIndex = new Map(header.map((column, index) => [column.trim(), index]));
const getValue = (row, column) => row[headerIndex.get(column)]?.trim() || '';

const outputRows = rows
  .map((row) => ({
    item_id: getValue(row, 'id'),
    title: getValue(row, 'title').slice(0, 150),
    description: getValue(row, 'description').slice(0, 5000),
    url: getValue(row, 'link'),
    brand: getValue(row, 'brand') || sellerName,
    seller_name: sellerName,
    image_url: getValue(row, 'image_link'),
    availability: normalizeAvailability(getValue(row, 'availability')),
    price: normalizePrice(getValue(row, 'price')),
    condition: getValue(row, 'condition') || 'new',
    product_category: getValue(row, 'product_type'),
    is_ads_eligible: 'true',
  }))
  .filter((row) => outputColumns.every((column) => optionalColumns.has(column) || row[column] !== ''));

if (outputRows.length === 0) {
  throw new Error('No valid OpenAI product rows were generated');
}

const output = [
  outputColumns.join(','),
  ...outputRows.map((row) => outputColumns.map((column) => toCsvCell(row[column])).join(',')),
].join('\n');

await writeFile(outputPath, `${output}\n`, 'utf8');
console.log(`Wrote ${outputRows.length} products to ${outputPath}`);