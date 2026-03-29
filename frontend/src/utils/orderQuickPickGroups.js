import { normalizeRoundedImportCostNumber } from './money';

export const ORDER_QUICK_PICK_MAX_ITEMS = 15;

const normalizeText = (value) => String(value ?? '').trim();
const normalizeMatchValue = (value) => normalizeText(value).toLocaleLowerCase('vi');

const parseIncomingGroups = (value) => {
    if (Array.isArray(value)) return value;

    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const normalizeOrderQuickPickItems = (items = []) => (
    (Array.isArray(items) ? items : [])
        .map((item, index) => {
            const targetProductId = Number(item?.target_product_id ?? item?.product_id ?? item?.id ?? 0);
            if (!Number.isFinite(targetProductId) || targetProductId <= 0) return null;

            const parentProductId = Number(item?.parent_product_id ?? 0);
            const type = normalizeText(item?.type) === 'variation' ? 'variation' : 'product';

            return {
                id: normalizeText(item?.id) || `order-quick-pick-item-${targetProductId}-${index + 1}`,
                target_product_id: targetProductId,
                parent_product_id: Number.isFinite(parentProductId) && parentProductId > 0 ? parentProductId : null,
                type,
                display_name: normalizeText(item?.display_name ?? item?.name),
                display_sku: normalizeText(item?.display_sku ?? item?.sku),
                option_label: normalizeText(item?.option_label),
                main_image: normalizeText(item?.main_image),
                price: Number(item?.price ?? 0) || 0,
                cost_price: normalizeRoundedImportCostNumber(item?.cost_price) ?? 0,
                order: index + 1,
            };
        })
        .filter(Boolean)
        .slice(0, ORDER_QUICK_PICK_MAX_ITEMS)
);

export const normalizeOrderQuickPickGroups = (value) => (
    parseIncomingGroups(value)
        .map((group, index) => {
            const attributeId = normalizeText(group?.attribute_id);
            const attributeValue = normalizeText(group?.attribute_value);

            if (!attributeId || !attributeValue) return null;

            return {
                id: normalizeText(group?.id) || `order-quick-pick-group-${attributeId}-${index + 1}`,
                attribute_id: attributeId,
                attribute_value: attributeValue,
                items: normalizeOrderQuickPickItems(group?.items),
            };
        })
        .filter(Boolean)
);

export const createOrderQuickPickGroup = (attributes = []) => {
    const firstAttribute = Array.isArray(attributes) ? attributes[0] : null;
    const firstOption = firstAttribute?.options?.[0];

    return {
        id: `order-quick-pick-group-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        attribute_id: normalizeText(firstAttribute?.id),
        attribute_value: normalizeText(firstOption?.value),
        items: [],
    };
};

export const getOrderQuickPickAttribute = (attributes = [], attributeId) => (
    (Array.isArray(attributes) ? attributes : []).find((attribute) => String(attribute?.id) === String(attributeId)) || null
);

export const getOrderQuickPickAttributeOptions = (attributes = [], attributeId) => (
    getOrderQuickPickAttribute(attributes, attributeId)?.options || []
);

export const getOrderQuickPickGroupLabel = (group, attributes = []) => {
    const attribute = getOrderQuickPickAttribute(attributes, group?.attribute_id);
    const attributeName = normalizeText(attribute?.name) || 'Thuộc tính';
    const attributeValue = normalizeText(group?.attribute_value) || 'Chưa chọn';

    return `${attributeName}: ${attributeValue}`;
};

export const getOrderQuickPickItemsForFilter = (groups, attributeId, attributeValue) => {
    const normalizedAttributeId = normalizeText(attributeId);
    const normalizedAttributeValue = normalizeMatchValue(attributeValue);
    const matchedItems = [];
    const seenProductIds = new Set();

    normalizeOrderQuickPickGroups(groups).forEach((group) => {
        if (normalizeText(group.attribute_id) !== normalizedAttributeId) return;
        if (normalizeMatchValue(group.attribute_value) !== normalizedAttributeValue) return;

        group.items.forEach((item) => {
            const productKey = String(item.target_product_id);
            if (seenProductIds.has(productKey)) return;

            seenProductIds.add(productKey);
            matchedItems.push(item);
        });
    });

    return matchedItems.slice(0, ORDER_QUICK_PICK_MAX_ITEMS);
};
