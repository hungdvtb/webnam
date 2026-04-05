const SEARCH_ENTRY_PRODUCT = 'product';
const SEARCH_ENTRY_VARIATION = 'variation';

const normalizeText = (value) => String(value ?? '').trim();

const parseAttributeValueList = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeText(entry)).filter(Boolean);
    }

    if (typeof value !== 'string') {
        return value == null ? [] : [normalizeText(value)].filter(Boolean);
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    if (
        (trimmedValue.startsWith('[') && trimmedValue.endsWith(']'))
        || (trimmedValue.startsWith('{') && trimmedValue.endsWith('}'))
    ) {
        try {
            const parsed = JSON.parse(trimmedValue);
            if (Array.isArray(parsed)) {
                return parsed.map((entry) => normalizeText(entry)).filter(Boolean);
            }

            if (parsed && typeof parsed === 'object') {
                return Object.values(parsed).map((entry) => normalizeText(entry)).filter(Boolean);
            }
        } catch {
            return [trimmedValue];
        }
    }

    return [trimmedValue];
};

const getAttributeSummary = (product) => Array.from(new Set(
    (Array.isArray(product?.attribute_values) ? product.attribute_values : [])
        .flatMap((attributeValue) => parseAttributeValueList(attributeValue?.value))
        .filter(Boolean)
)).join(' / ');

const getPrimaryImage = (product) => normalizeText(
    product?.main_image
    || product?.primary_image?.url
    || product?.image_url
);

const buildVariationDisplayName = (parentName, optionLabel, variationName) => {
    const normalizedParentName = normalizeText(parentName);
    const normalizedOptionLabel = normalizeText(optionLabel);
    const normalizedVariationName = normalizeText(variationName);

    if (normalizedParentName && normalizedOptionLabel) {
        return `${normalizedParentName} - ${normalizedOptionLabel}`;
    }

    if (normalizedParentName && normalizedVariationName && normalizedVariationName !== normalizedParentName) {
        return `${normalizedParentName} - ${normalizedVariationName}`;
    }

    return normalizedVariationName || normalizedParentName;
};

export const normalizeOrderAiRuleAliasList = (value) => {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))).slice(0, 12);
    }

    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[,;\n]+/u)
                .map((entry) => normalizeText(entry))
                .filter(Boolean)
        )).slice(0, 12);
    }

    return [];
};

export const formatOrderAiRuleAliases = (aliases = []) => (
    normalizeOrderAiRuleAliasList(aliases).join(', ')
);

export const createOrderAiRuleItem = (entry = null) => ({
    id: `order-ai-rule-item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    aliases: normalizeOrderAiRuleAliasList(entry?.aliases ?? []),
    default_quantity: Math.max(1, Number(entry?.default_quantity ?? 1) || 1),
    target_product_id: Number(entry?.target_product_id ?? 0) || 0,
    parent_product_id: Number(entry?.parent_product_id ?? 0) || null,
    entry_kind: normalizeText(entry?.entry_kind) === SEARCH_ENTRY_VARIATION ? SEARCH_ENTRY_VARIATION : SEARCH_ENTRY_PRODUCT,
    display_name: normalizeText(entry?.display_name ?? entry?.name),
    display_sku: normalizeText(entry?.display_sku ?? entry?.sku),
    option_label: normalizeText(entry?.option_label),
    main_image: normalizeText(entry?.main_image),
    price: Number(entry?.price ?? 0) || 0,
    cost_price: Number(entry?.cost_price ?? 0) || 0,
});

export const createOrderAiRuleGroup = () => ({
    id: `order-ai-rule-group-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    altar_size_label: '',
    altar_size_aliases: [],
    context_aliases: [],
    training_source_type: '',
    training_source_name: '',
    training_note: '',
    definition_text: '',
    training_raw_text: '',
    trained_at: '',
    items: [],
});

export const normalizeOrderAiRuleItems = (items = []) => (
    (Array.isArray(items) ? items : [])
        .map((item) => createOrderAiRuleItem(item))
        .filter((item) => item.target_product_id > 0)
        .slice(0, 40)
);

export const normalizeOrderAiRules = (value) => (
    (Array.isArray(value) ? value : [])
        .map((group, index) => {
            const altarSizeLabel = normalizeText(group?.altar_size_label ?? group?.size_label);
            if (!altarSizeLabel) return null;

            return {
                id: normalizeText(group?.id) || `order-ai-rule-group-${index + 1}`,
                altar_size_label: altarSizeLabel,
                altar_size_aliases: normalizeOrderAiRuleAliasList([
                    altarSizeLabel,
                    ...normalizeOrderAiRuleAliasList(group?.altar_size_aliases ?? []),
                ]),
                context_aliases: normalizeOrderAiRuleAliasList(group?.context_aliases ?? []),
                training_source_type: normalizeText(group?.training_source_type),
                training_source_name: normalizeText(group?.training_source_name),
                training_note: normalizeText(group?.training_note),
                definition_text: normalizeText(group?.definition_text),
                training_raw_text: normalizeText(group?.training_raw_text),
                trained_at: normalizeText(group?.trained_at),
                items: normalizeOrderAiRuleItems(group?.items),
            };
        })
        .filter(Boolean)
        .slice(0, 24)
);

export const buildOrderAiPickerEntries = (products = []) => {
    const entries = [];

    (Array.isArray(products) ? products : []).forEach((product) => {
        if (!product || typeof product !== 'object') return;

        const baseId = Number(product?.id ?? product?.product_id ?? 0);
        if (!baseId) return;

        const baseName = normalizeText(product?.name) || `Sản phẩm #${baseId}`;
        const baseEntry = {
            entry_kind: SEARCH_ENTRY_PRODUCT,
            target_product_id: baseId,
            parent_product_id: null,
            parent_product_name: '',
            name: baseName,
            display_name: baseName,
            sku: normalizeText(product?.sku),
            display_sku: normalizeText(product?.display_sku ?? product?.sku),
            option_label: '',
            price: Number(product?.price ?? 0) || 0,
            cost_price: Number(product?.cost_price ?? product?.expected_cost ?? 0) || 0,
            expected_cost: product?.expected_cost == null ? null : (Number(product.expected_cost) || 0),
            main_image: getPrimaryImage(product),
            attribute_values: Array.isArray(product?.attribute_values) ? product.attribute_values : [],
            attribute_summary: getAttributeSummary(product),
        };

        if (!(normalizeText(product?.type) === 'configurable' && Array.isArray(product?.variations) && product.variations.length > 0)) {
            entries.push(baseEntry);
        }

        (Array.isArray(product?.variations) ? product.variations : []).forEach((variation) => {
            const variationId = Number(variation?.id ?? 0);
            if (!variationId) return;

            const optionLabel = getAttributeSummary(variation);
            entries.push({
                entry_kind: SEARCH_ENTRY_VARIATION,
                target_product_id: variationId,
                parent_product_id: baseId,
                parent_product_name: baseName,
                name: normalizeText(variation?.name) || baseName,
                display_name: buildVariationDisplayName(baseName, optionLabel, variation?.name),
                sku: normalizeText(variation?.sku),
                display_sku: normalizeText(variation?.sku || product?.sku),
                option_label: optionLabel,
                price: Number(variation?.price ?? 0) || 0,
                cost_price: Number(variation?.cost_price ?? variation?.expected_cost ?? 0) || 0,
                expected_cost: variation?.expected_cost == null ? null : (Number(variation.expected_cost) || 0),
                main_image: getPrimaryImage(variation) || getPrimaryImage(product),
                attribute_values: Array.isArray(variation?.attribute_values) ? variation.attribute_values : [],
                attribute_summary: optionLabel,
            });
        });
    });

    return entries;
};

const normalizePhrasePart = (value) => normalizeText(value).replace(/\s+/g, ' ');

const extractRuleSizeLabel = (value) => {
    const match = normalizePhrasePart(value).match(/(\d+\s*m\s*\d+|\d+\s*cm|\d{3,4})/i);
    if (!match) return '';

    return match[1].replace(/\s+/g, '').toLowerCase();
};

const buildOrderAiQuickRuleLabel = (rule) => {
    const contextLabel = normalizePhrasePart((normalizeOrderAiRuleAliasList(rule?.context_aliases || [])[0]) || '');
    const altarAliases = normalizeOrderAiRuleAliasList(rule?.altar_size_aliases || []);
    const preferredAltarPhrase = normalizePhrasePart(
        altarAliases.find((alias) => normalizePhrasePart(alias).toLowerCase() !== extractRuleSizeLabel(alias) && extractRuleSizeLabel(alias))
        || rule?.altar_size_label
        || altarAliases[0]
        || ''
    );
    const sizeLabel = extractRuleSizeLabel(preferredAltarPhrase) || extractRuleSizeLabel(rule?.altar_size_label) || preferredAltarPhrase;

    if (contextLabel && sizeLabel) {
        return `${contextLabel} ${sizeLabel}`.trim();
    }

    return contextLabel || preferredAltarPhrase || normalizePhrasePart(rule?.rule_key || '') || 'Mẫu train AI';
};

export const buildOrderAiQuickRuleOptions = (rules = []) => {
    const seenValues = new Set();

    return (Array.isArray(rules) ? rules : [])
        .map((rule, index) => {
            const value = normalizeText(rule?.rule_key ?? rule?.id);
            if (!value || seenValues.has(value)) return null;

            seenValues.add(value);

            const label = buildOrderAiQuickRuleLabel(rule);
            const itemCount = Math.max(0, Number(rule?.items_count ?? rule?.items?.length ?? 0) || 0);
            const searchText = [
                label,
                value,
                normalizeText(rule?.altar_size_label),
                ...normalizeOrderAiRuleAliasList(rule?.altar_size_aliases || []),
                ...normalizeOrderAiRuleAliasList(rule?.context_aliases || []),
                normalizeText(rule?.definition_text),
                normalizeText(rule?.training_note),
                normalizeText(rule?.training_source_name ?? rule?.source_name),
            ]
                .filter(Boolean)
                .join(' | ');

            return {
                id: `order-ai-quick-rule-${index + 1}`,
                value,
                name: label,
                search_text: searchText,
                subtitle: [
                    itemCount > 0 ? `${itemCount} sản phẩm map` : '',
                    normalizeText(rule?.altar_size_label),
                ].filter(Boolean).join(' • '),
                item_count: itemCount,
                altar_size_label: normalizeText(rule?.altar_size_label),
                context_label: normalizeOrderAiRuleAliasList(rule?.context_aliases || [])[0] || '',
            };
        })
        .filter(Boolean);
};
