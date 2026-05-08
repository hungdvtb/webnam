const BUNDLE_DISCOUNT_RATE = 0.1;
const BUNDLE_METADATA_VERSION = 2;
const BUNDLE_TOTAL_ROUNDING_UNIT = 10000;

const cloneBundleValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneBundleValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneBundleValue(nestedValue)])
    );
  }

  return value;
};

const toFiniteNumber = (value, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const toInteger = (value, fallback = 0) => {
  const normalized = Number.parseInt(value, 10);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const toPositiveInteger = (value, fallback = 1) => {
  const normalized = toInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
};

const normalizeText = (value = '') => String(value || '').trim();

const floorToUnit = (value, unit = BUNDLE_TOTAL_ROUNDING_UNIT) => {
  const normalizedValue = Math.max(toFiniteNumber(value, 0), 0);
  const normalizedUnit = Math.max(toInteger(unit, BUNDLE_TOTAL_ROUNDING_UNIT), 1);

  return Math.floor(normalizedValue / normalizedUnit) * normalizedUnit;
};

export const calculateFullBundleDiscount = (
  subtotal,
  { discountRate = BUNDLE_DISCOUNT_RATE, roundingUnit = BUNDLE_TOTAL_ROUNDING_UNIT } = {},
) => {
  const normalizedSubtotal = Math.max(toFiniteNumber(subtotal, 0), 0);
  const baseDiscountAmount = Math.round(
    normalizedSubtotal * toFiniteNumber(discountRate, BUNDLE_DISCOUNT_RATE)
  );
  const subtotalAfterBaseDiscount = Math.max(normalizedSubtotal - baseDiscountAmount, 0);
  const finalSubtotal = floorToUnit(subtotalAfterBaseDiscount, roundingUnit);
  const comboDiscountAmount = Math.max(normalizedSubtotal - finalSubtotal, 0);

  return {
    baseDiscountAmount,
    comboDiscountAmount,
    discountRoundingAdjustment: Math.max(comboDiscountAmount - baseDiscountAmount, 0),
    finalSubtotal,
  };
};

export const getBundleOptionTitle = (item = {}) => normalizeText(
  item?.option_title
  || item?.pivot?.option_title
);

export const getBundleSourcePosition = (item = {}, fallbackIndex = 0) => {
  const rawPosition = item?.source_position ?? item?.pivot?.position ?? fallbackIndex;
  const normalizedPosition = Number(rawPosition);
  return Number.isFinite(normalizedPosition) ? normalizedPosition : fallbackIndex;
};

export const getBundleSlotKey = (item = {}, fallbackIndex = 0) => {
  const optionTitle = getBundleOptionTitle(item);
  const sourcePosition = getBundleSourcePosition(item, fallbackIndex);
  return `${optionTitle}::${sourcePosition}`;
};

export const resolveBundleConfigName = (items = []) => (
  (Array.isArray(items) ? items : [])
    .map((item) => getBundleOptionTitle(item))
    .find(Boolean)
  || ''
);

export const createBundleCartEntry = (item = {}, fallbackIndex = 0) => {
  const optionTitle = getBundleOptionTitle(item);
  const sourcePosition = getBundleSourcePosition(item, fallbackIndex);
  const slotKey = normalizeText(item?.bundle_slot_key) || getBundleSlotKey(item, fallbackIndex);
  const baseProductId = toInteger(
    item?.base_product_id
    ?? item?.baseProductId
    ?? item?.id
    ?? item?.product_id
    ?? item?.selected_product_id,
    0,
  );
  const selectedProductId = toInteger(
    item?.selected_product_id
    ?? item?.product_id
    ?? item?.id
    ?? item?.variant_id
    ?? baseProductId,
    baseProductId,
  ) || baseProductId;
  const quantity = toPositiveInteger(
    item?.qty
    ?? item?.quantity
    ?? item?.pivot?.quantity
    ?? 1,
    1,
  );
  const unitPrice = toFiniteNumber(item?.unit_price ?? item?.price ?? 0, 0);

  return {
    ...cloneBundleValue(item),
    uid: normalizeText(item?.uid) || normalizeText(item?.bundle_item_uid) || slotKey,
    bundle_item_uid: normalizeText(item?.bundle_item_uid) || normalizeText(item?.uid) || slotKey,
    bundle_slot_key: slotKey,
    option_title: optionTitle,
    source_position: sourcePosition,
    id: selectedProductId || baseProductId,
    product_id: selectedProductId || baseProductId,
    selected_product_id: selectedProductId || baseProductId,
    base_product_id: baseProductId || selectedProductId,
    variant_id: item?.variant_id ?? item?.pivot?.variant_id ?? null,
    name: normalizeText(item?.name || item?.product_name),
    product_name: normalizeText(item?.product_name || item?.name),
    sku: normalizeText(item?.sku || item?.product_sku),
    product_sku: normalizeText(item?.product_sku || item?.sku),
    qty: quantity,
    quantity,
    price: unitPrice,
    unit_price: unitPrice,
    line_total: unitPrice * quantity,
    image: cloneBundleValue(
      item?.image
      ?? item?.primary_image
      ?? item?.images?.[0]
      ?? null
    ),
  };
};

export const getBundleItemsForConfig = (items = [], configName = '') => {
  const normalizedConfig = normalizeText(configName);

  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      const optionTitle = getBundleOptionTitle(item);

      if (!optionTitle) {
        return true;
      }

      if (!normalizedConfig) {
        return optionTitle === '';
      }

      return optionTitle === normalizedConfig;
    })
    .sort((left, right) => {
      const leftPosition = getBundleSourcePosition(left, 0);
      const rightPosition = getBundleSourcePosition(right, 0);
      return leftPosition - rightPosition;
    });
};

export const buildBundleSnapshot = (items = [], configName = '') => (
  getBundleItemsForConfig(items, configName).map((item, index) => createBundleCartEntry(item, index))
);

const groupBundleEntriesBySlot = (items = []) => {
  const slotMap = new Map();

  items.forEach((item) => {
    const bucket = slotMap.get(item.bundle_slot_key) || [];
    bucket.push(item);
    slotMap.set(item.bundle_slot_key, bucket);
  });

  return slotMap;
};

export const evaluateBundleSelection = (
  currentItems = [],
  snapshotItems = [],
  { discountRate = BUNDLE_DISCOUNT_RATE } = {},
) => {
  const normalizedCurrentItems = (Array.isArray(currentItems) ? currentItems : [])
    .map((item, index) => createBundleCartEntry(item, index));
  const normalizedSnapshotItems = (Array.isArray(snapshotItems) ? snapshotItems : [])
    .map((item, index) => createBundleCartEntry(item, index));
  const currentSubtotal = normalizedCurrentItems.reduce(
    (sum, item) => sum + (toFiniteNumber(item.price, 0) * toPositiveInteger(item.qty, 1)),
    0,
  );
  const expectedSubtotal = normalizedSnapshotItems.reduce(
    (sum, item) => sum + (toFiniteNumber(item.price, 0) * toPositiveInteger(item.qty, 1)),
    0,
  );

  if (normalizedSnapshotItems.length === 0) {
    return {
      currentItems: normalizedCurrentItems,
      snapshotItems: normalizedSnapshotItems,
      matchedItems: [],
      missingItems: [],
      removedItems: [],
      invalidItems: [],
      extraItems: normalizedCurrentItems,
      currentSubtotal,
      expectedSubtotal,
      expectedCount: 0,
      currentCount: normalizedCurrentItems.length,
      comboDiscountRate: discountRate,
      comboDiscountAmount: 0,
      finalSubtotal: currentSubtotal,
      isFullBundle: false,
      eligibleDiscount: false,
      failureCode: 'missing_snapshot',
    };
  }

  const currentItemsBySlot = groupBundleEntriesBySlot(normalizedCurrentItems);
  const matchedItems = [];
  const missingItems = [];
  const invalidItems = [];

  normalizedSnapshotItems.forEach((snapshotItem) => {
    const slotMatches = currentItemsBySlot.get(snapshotItem.bundle_slot_key) || [];

    if (slotMatches.length === 0) {
      missingItems.push(snapshotItem);
      return;
    }

    const [currentItem, ...duplicates] = slotMatches;
    currentItemsBySlot.delete(snapshotItem.bundle_slot_key);

    duplicates.forEach((duplicateItem) => {
      invalidItems.push({
        current: duplicateItem,
        snapshot: snapshotItem,
        reason: 'duplicate_slot',
      });
    });

    const hasMatchingBaseProduct = toInteger(currentItem.base_product_id, 0) === toInteger(snapshotItem.base_product_id, 0);
    const hasMatchingQuantity = toPositiveInteger(currentItem.qty, 1) === toPositiveInteger(snapshotItem.qty, 1);

    if (!hasMatchingBaseProduct) {
      invalidItems.push({
        current: currentItem,
        snapshot: snapshotItem,
        reason: 'product_mismatch',
      });
      return;
    }

    if (!hasMatchingQuantity) {
      invalidItems.push({
        current: currentItem,
        snapshot: snapshotItem,
        reason: 'quantity_mismatch',
      });
      return;
    }

    matchedItems.push({
      current: currentItem,
      snapshot: snapshotItem,
    });
  });

  const extraItems = Array.from(currentItemsBySlot.values()).flat();
  const isFullBundle = normalizedSnapshotItems.length > 0
    && missingItems.length === 0
    && invalidItems.length === 0
    && extraItems.length === 0;
  const bundleDiscount = isFullBundle
    ? calculateFullBundleDiscount(currentSubtotal, { discountRate })
    : {
      baseDiscountAmount: 0,
      comboDiscountAmount: 0,
      discountRoundingAdjustment: 0,
      finalSubtotal: currentSubtotal,
    };

  let failureCode = 'eligible';

  if (missingItems.length > 0) {
    failureCode = 'missing_item';
  } else if (invalidItems.some((item) => item.reason === 'product_mismatch')) {
    failureCode = 'invalid_item';
  } else if (invalidItems.some((item) => item.reason === 'quantity_mismatch')) {
    failureCode = 'quantity_mismatch';
  } else if (extraItems.length > 0 || invalidItems.some((item) => item.reason === 'duplicate_slot')) {
    failureCode = 'unexpected_item';
  }

  return {
    currentItems: normalizedCurrentItems,
    snapshotItems: normalizedSnapshotItems,
    matchedItems,
    missingItems,
    removedItems: missingItems,
    invalidItems,
    extraItems,
    currentSubtotal,
    expectedSubtotal,
    expectedCount: normalizedSnapshotItems.length,
    currentCount: normalizedCurrentItems.length,
    comboDiscountRate: toFiniteNumber(discountRate, BUNDLE_DISCOUNT_RATE),
    baseComboDiscountAmount: bundleDiscount.baseDiscountAmount,
    comboDiscountAmount: bundleDiscount.comboDiscountAmount,
    comboDiscountRoundingAdjustment: bundleDiscount.discountRoundingAdjustment,
    finalSubtotal: bundleDiscount.finalSubtotal,
    isFullBundle,
    eligibleDiscount: isFullBundle,
    failureCode,
  };
};

export const buildBundleCartSignature = (items = []) => JSON.stringify(
  (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const entry = createBundleCartEntry(item, index);
      return {
        slot: entry.bundle_slot_key,
        base_product_id: entry.base_product_id,
        selected_product_id: entry.selected_product_id,
        variant_id: entry.variant_id || null,
        qty: entry.qty,
      };
    })
    .sort((left, right) => {
      const leftKey = `${left.slot}::${left.base_product_id}::${left.selected_product_id}`;
      const rightKey = `${right.slot}::${right.base_product_id}::${right.selected_product_id}`;
      return leftKey.localeCompare(rightKey);
    })
);

export const isTrustedBundleSnapshot = (cartItem = {}) => {
  const metadataVersion = toInteger(
    cartItem?.bundleMetadataVersion ?? cartItem?.bundle_metadata_version,
    0,
  );
  const snapshotItems = Array.isArray(cartItem?.bundleSnapshot) && cartItem.bundleSnapshot.length > 0
    ? cartItem.bundleSnapshot
    : Array.isArray(cartItem?.originalGroupedItems) && cartItem.originalGroupedItems.length > 0
      ? cartItem.originalGroupedItems
      : [];

  return metadataVersion >= BUNDLE_METADATA_VERSION && snapshotItems.length > 0;
};

export const getCartBundlePricing = (cartItem = {}) => {
  const currentItems = Array.isArray(cartItem?.groupedItems) ? cartItem.groupedItems : [];
  const trustedSnapshotItems = isTrustedBundleSnapshot(cartItem)
    ? (
      Array.isArray(cartItem?.bundleSnapshot) && cartItem.bundleSnapshot.length > 0
        ? cartItem.bundleSnapshot
        : cartItem?.originalGroupedItems || []
    )
    : [];
  const evaluation = evaluateBundleSelection(currentItems, trustedSnapshotItems);
  const fallbackExpectedCount = Array.isArray(cartItem?.bundleSnapshot) && cartItem.bundleSnapshot.length > 0
    ? cartItem.bundleSnapshot.length
    : Array.isArray(cartItem?.originalGroupedItems) && cartItem.originalGroupedItems.length > 0
      ? cartItem.originalGroupedItems.length
      : Math.max(toInteger(cartItem?.originalSubCount, 0), 0);
  const bundleQuantity = toPositiveInteger(cartItem?.quantity, 1);

  return {
    ...evaluation,
    hasTrustedSnapshot: trustedSnapshotItems.length > 0,
    expectedCountDisplay: evaluation.expectedCount || fallbackExpectedCount || evaluation.currentCount,
    currentCountDisplay: evaluation.currentCount,
    lineSubtotal: evaluation.currentSubtotal * bundleQuantity,
    lineDiscount: evaluation.comboDiscountAmount * bundleQuantity,
    lineTotal: evaluation.finalSubtotal * bundleQuantity,
    bundleQuantity,
    bundleConfigName: normalizeText(
      cartItem?.bundleConfigName
      || cartItem?.options?.bundle_option_title
      || cartItem?.options?.bundle_config
      || resolveBundleConfigName(currentItems)
    ),
  };
};

export {
  BUNDLE_DISCOUNT_RATE,
  BUNDLE_METADATA_VERSION,
  BUNDLE_TOTAL_ROUNDING_UNIT,
};
