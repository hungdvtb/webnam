import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion as _motion } from 'framer-motion';
import { productApi, categoryApi } from '../../services/api';

const normalizeText = (value = '') => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const compactText = (value = '') => normalizeText(value).replace(/\s+/g, '');

const parseAttributeValueList = (value) => {
    if (Array.isArray(value)) {
        return value.flatMap(parseAttributeValueList);
    }

    if (value === null || value === undefined) {
        return [];
    }

    const rawValue = String(value).trim();
    if (!rawValue) {
        return [];
    }

    if (
        (rawValue.startsWith('[') && rawValue.endsWith(']'))
        || (rawValue.startsWith('{') && rawValue.endsWith('}'))
    ) {
        try {
            const parsed = JSON.parse(rawValue);
            if (Array.isArray(parsed)) {
                return parsed.flatMap(parseAttributeValueList);
            }

            if (parsed && typeof parsed === 'object') {
                return Object.values(parsed).flatMap(parseAttributeValueList);
            }
        } catch {
            // Fall through and use the raw value.
        }
    }

    return [rawValue];
};

const getAttributeOptionValues = (attribute) => {
    const rawOptions = Array.isArray(attribute?.options)
        ? attribute.options
        : (Array.isArray(attribute?.values) ? attribute.values : []);

    return rawOptions
        .flatMap((option) => {
            if (option && typeof option === 'object') {
                return parseAttributeValueList(option.value ?? option.label ?? option.name);
            }

            return parseAttributeValueList(option);
        })
        .filter(Boolean);
};

const getTargetAttributeTokens = (attribute) => getAttributeOptionValues(attribute)
    .map(compactText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

const buildComparableIdentity = (value, targetAttribute) => getTargetAttributeTokens(targetAttribute).reduce(
    (current, token) => (token ? current.split(token).join('') : current),
    compactText(value),
);

const addAttributeValue = (map, attributeId, value) => {
    const normalizedId = String(attributeId ?? '').trim();
    if (!normalizedId) return;

    const values = parseAttributeValueList(value).filter(Boolean);
    if (values.length === 0) return;

    map[normalizedId] = values[0];
};

const buildAttributeMap = (source) => {
    const map = {};
    if (!source || typeof source !== 'object') return map;

    if (source.product_attributes && typeof source.product_attributes === 'object') {
        Object.entries(source.product_attributes).forEach(([attributeId, value]) => {
            addAttributeValue(map, attributeId, value);
        });
    }

    const attributeValues = Array.isArray(source.attribute_values)
        ? source.attribute_values
        : (Array.isArray(source.attributeValues) ? source.attributeValues : []);

    attributeValues.forEach((attributeValue) => {
        addAttributeValue(
            map,
            attributeValue?.attribute_id ?? attributeValue?.attribute?.id,
            attributeValue?.value,
        );
    });

    if (source.attributes_map && typeof source.attributes_map === 'object') {
        Object.entries(source.attributes_map).forEach(([attributeId, value]) => {
            addAttributeValue(map, attributeId, value);
        });
    }

    return map;
};

const findAttributeValueInTexts = (texts, attribute) => {
    const sortedOptions = getAttributeOptionValues(attribute)
        .map((value) => ({ value, normalized: normalizeText(value) }))
        .filter((option) => option.normalized)
        .sort((left, right) => right.normalized.length - left.normalized.length);

    for (const text of texts) {
        const haystack = ` ${normalizeText(text)} `;
        if (!haystack.trim()) continue;

        const matched = sortedOptions.find((option) => haystack.includes(` ${option.normalized} `));
        if (matched) return matched.value;
    }

    return null;
};

const buildItemAttributeMap = (item, attributeById, targetAttributeId) => {
    const map = buildAttributeMap(item);
    const optionTexts = [
        item?.options?.variant_label,
        item?.options?.variant_name,
        item?.name,
        item?.snapshot_name,
        item?.sku,
        item?.snapshot_sku,
    ];

    Object.values(attributeById || {}).forEach((attribute) => {
        const attributeId = String(attribute?.id ?? '').trim();
        if (!attributeId || attributeId === String(targetAttributeId) || map[attributeId]) return;

        const inferredValue = findAttributeValueInTexts(optionTexts, attribute);
        if (inferredValue) {
            map[attributeId] = inferredValue;
        }
    });

    return map;
};

const normalizedValuesEqual = (left, right) => {
    const normalizedLeft = normalizeText(left);
    const normalizedRight = normalizeText(right);

    return normalizedLeft !== '' && normalizedLeft === normalizedRight;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Extract the parent product id from an order line item.
 *  Order line items store it in multiple possible locations. */
const resolveItemParentId = (item) => {
    // Always prefer the explicitly stored variant_parent_id
    const fromOptions = Number(item?.options?.variant_parent_id);
    if (fromOptions > 0) return fromOptions;

    const fromBundleBase = Number(item?.options?.bundle_item_base_product_id);
    if (fromBundleBase > 0) return fromBundleBase;

    // We DO NOT fallback to item.parent_product_id because in order items,
    // if the item is part of a bundle, parent_product_id points to the BUNDLE,
    // not the configurable parent. Using the bundle ID as parent_id breaks the sibling search.
    // By returning null, we gracefully fallback to the highly-reliable SKU prefix search.
    return null;
};

/** Tokenise a product name for similarity scoring */
const tokenise = (name = '') =>
    normalizeText(name)
        .split(/[\s\-–]+/)
        .map(t => t.trim())
        .filter(t => t.length > 1);

/** Return the longest shared SKU prefix length (split by '-') */
const skuPrefixMatchCount = (skuA = '', skuB = '') => {
    const a = String(skuA || '').split(/[-_\s/]+/).map(normalizeText).filter(Boolean);
    const b = String(skuB || '').split(/[-_\s/]+/).map(normalizeText).filter(Boolean);
    let count = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] === b[i]) count++;
        else break;
    }
    return count;
};

/** Score a candidate product against the source item.
 *  Higher = better match. */
const scoreCandidate = (item, candidate, targetAttributeId, attributeById, itemAttributeMap = {}) => {
    let score = 0;
    const targetAttribute = attributeById[String(targetAttributeId)] || null;

    const itemParentId = resolveItemParentId(item);
    const candidateParentId =
        Number(candidate.parent_product_id) ||
        Number(candidate.variant_parent_id) ||
        Number(candidate.options?.variant_parent_id) ||
        null;

    // 1. Sibling bonus: same parent is the strongest product-family signal.
    if (itemParentId && candidateParentId && itemParentId === candidateParentId) {
        score += 10_000;
    }

    // 2. Configurable/parent penalty.
    if (candidate.type === 'configurable' || candidate.has_variations) {
        score -= 8_000;
    }

    // 3. Being a variation is a positive signal.
    if (candidate.type === 'variation' || candidateParentId) {
        score += 300;
    }

    // 4. Attribute consistency: preserve non-target attributes like Size.
    //       product_attributes on order line is  { [attrId]: value }
    //       candidate.attribute_values is an array of { attribute_id, value }  OR
    //       candidate.attributes_map is { [attrId]: value }
    if (item.product_attributes && typeof item.product_attributes === 'object') {
        // Build a quick lookup for the candidate
        const candAttrById = {};
        if (Array.isArray(candidate.attribute_values)) {
            candidate.attribute_values.forEach(av => {
                candAttrById[String(av.attribute_id)] = av.value;
            });
        }
        if (candidate.attributes_map) {
            Object.entries(candidate.attributes_map).forEach(([k, v]) => {
                candAttrById[String(k)] = v;
            });
        }

        Object.entries(item.product_attributes).forEach(([attrId, attrVal]) => {
            if (String(attrId) === String(targetAttributeId)) return; // skip the one we're changing
            if (!attrVal) return;

            const candVal = candAttrById[String(attrId)];
            if (candVal !== undefined) {
                if (String(candVal).toLowerCase() === String(attrVal).toLowerCase()) {
                    score += 2_000; // same value, e.g. same Size
                } else {
                    score -= 1_000; // different value penalty
                }
            }
        });
    }

    // 5. Name token similarity.
    const candidateAttributeMap = buildAttributeMap(candidate);
    Object.entries(itemAttributeMap || {}).forEach(([attrId, attrVal]) => {
        if (String(attrId) === String(targetAttributeId)) return;
        if (!attrVal) return;

        const candVal = candidateAttributeMap[String(attrId)];
        if (candVal !== undefined) {
            if (normalizedValuesEqual(candVal, attrVal)) {
                score += 2_000;
            } else {
                score -= 1_000;
            }
        }
    });

    const itemSkuKey = buildComparableIdentity(item.sku || item.snapshot_sku, targetAttribute);
    const candidateSkuKey = buildComparableIdentity(candidate.sku || candidate.display_sku, targetAttribute);
    if (itemSkuKey && candidateSkuKey) {
        if (itemSkuKey === candidateSkuKey) {
            score += 4_000;
        } else if (itemSkuKey.includes(candidateSkuKey) || candidateSkuKey.includes(itemSkuKey)) {
            score += 900;
        }
    }

    const itemNameKey = buildComparableIdentity(item.name || item.snapshot_name, targetAttribute);
    const candidateNameKey = buildComparableIdentity(candidate.display_name || candidate.name, targetAttribute);
    if (itemNameKey && candidateNameKey) {
        if (itemNameKey === candidateNameKey) {
            score += 1_200;
        } else if (itemNameKey.includes(candidateNameKey) || candidateNameKey.includes(itemNameKey)) {
            score += 400;
        }
    }

    const itemTokens = tokenise(item.name);
    const candTokens = tokenise(candidate.display_name || candidate.name);
    if (itemTokens.length > 0) {
        const matched = itemTokens.filter(t => candTokens.includes(t)).length;
        const ratio = matched / itemTokens.length;
        score += Math.round(ratio * 600);
        if (ratio >= 0.8) score += 200;
    }

    // 6. SKU prefix similarity.
    const prefixLen = skuPrefixMatchCount(item.sku, candidate.sku || candidate.display_sku);
    score += prefixLen * 250;

    // 7. Category match.
    if (item.category_id && Number(candidate.category_id) === Number(item.category_id)) {
        score += 150;
    }

    return score;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BULK_REPLACE_TAB_ATTRIBUTE = 'attribute';
const BULK_REPLACE_TAB_CATEGORY_GROUP = 'category_group';
const CATEGORY_GROUP_MAX_PRODUCT_PAGES = 8;
const CATEGORY_GROUP_STYLE_WORDS = new Set([
    'men',
    'mau',
    'mau1',
    'mau2',
    'lam',
    'ran',
    'vang',
    'anh',
    'kim',
    'xanh',
    'do',
    'nau',
    'trang',
    'den',
    'hong',
    'ngoc',
    'hoang',
    'thach',
]);
const CATEGORY_GROUP_GENERIC_WORDS = new Set([
    'san',
    'pham',
    'loai',
    'kieu',
    'mau',
    'so',
    'dong',
    'hang',
    'mac',
    'dinh',
    'combo',
    'set',
    'bo',
    'cai',
    'chiec',
    'cao',
    'thap',
    'nho',
    'lon',
    'phi',
    'ph',
    'cm',
]);
const CATEGORY_GROUP_TYPE_PHRASES = [
    ['chan de bat huong', 'Đế bát hương', 'de_bat_huong'],
    ['de bat huong', 'Đế bát hương', 'de_bat_huong'],
    ['bat huong', 'Bát hương', 'bat_huong'],
    ['bat tra sam', 'Bát trà sâm', 'bat_tra_sam'],
    ['bat sam', 'Bát sâm', 'bat_sam'],
    ['bat com', 'Bát cơm', 'bat_com'],
    ['am tra', 'Ấm trà', 'am_tra'],
    ['am chen', 'Ấm chén', 'am_chen'],
    ['lo huong', 'Lọ hương', 'lo_huong'],
    ['ong huong', 'Ống hương', 'ong_huong'],
    ['mam bong', 'Mâm bồng', 'mam_bong'],
    ['mam ngu qua', 'Mâm ngũ quả', 'mam_ngu_qua'],
    ['ky ngai chen', 'Kỷ ngai chén', 'ky_ngai_chen'],
    ['ky ngai', 'Kỷ ngai', 'ky_ngai'],
    ['ngai chen', 'Ngai chén', 'ngai_chen'],
    ['choe', 'Chóe', 'choe'],
    ['den dau', 'Đèn', 'den'],
    ['den', 'Đèn', 'den', true],
    ['nam ruou', 'Nậm', 'nam'],
    ['nam', 'Nậm', 'nam', true],
    ['lo hoa', 'Lọ hoa', 'lo_hoa'],
    ['loc binh', 'Lộc bình', 'loc_binh'],
    ['luc binh', 'Lộc bình', 'loc_binh'],
    ['dia cau', 'Đĩa', 'dia'],
    ['dia', 'Đĩa', 'dia', true],
    ['bo dua', 'Bộ đũa', 'bo_dua'],
    ['chen', 'Chén', 'chen', true],
    ['bat', 'Bát', 'bat', true],
];

const resolveCategoryRows = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.categories)) return payload.categories;
    return [];
};

const flattenCategoryOptions = (categories = [], depth = 0, ancestors = []) => {
    const rows = [];

    (Array.isArray(categories) ? categories : []).forEach((category) => {
        if (!category || typeof category !== 'object') return;

        const name = String(category?.name || '').trim();
        const pathParts = [...ancestors, name].filter(Boolean);
        rows.push({
            ...category,
            id: Number(category?.id) || category?.id,
            depth,
            name,
            path: pathParts.join(' / '),
        });
        rows.push(...flattenCategoryOptions(category?.children || [], depth + 1, pathParts));
    });

    return rows;
};

const buildCategoryWordSet = (...categories) => {
    const words = new Set();

    categories.forEach((category) => {
        [
            category?.name,
            category?.path,
            category?.slug,
        ].filter(Boolean).forEach((value) => {
            normalizeText(value)
                .split(/\s+/)
                .filter(Boolean)
                .forEach((word) => {
                    if (/^\d+$/.test(word) && Number(word) > 9) return;
                    words.add(word);
                });
        });
    });

    return words;
};

const getCategoryGroupDisplayName = (product) => (
    String(product?.display_name || product?.name || product?.snapshot_name || product?.actual_name || 'Sản phẩm').trim()
);

const getCategoryGroupDisplaySku = (product) => (
    String(product?.display_sku || product?.sku || product?.snapshot_sku || product?.actual_sku || '').trim()
);

const getCategoryGroupProductId = (product) => (
    Number(product?.target_product_id || product?.product_id || product?.id || product?.actual_product_id || 0) || 0
);

const isSelectableCategoryGroupProduct = (product) => (
    product
    && normalizeText(product?.type) !== 'configurable'
    && normalizeText(product?.type) !== 'variable'
    && !product?.has_variations
);

const buildCategoryGroupAttributeMap = (source) => Object.entries(buildAttributeMap(source))
    .reduce((result, [attributeId, value]) => {
        const values = parseAttributeValueList(value).map(normalizeText).filter(Boolean);
        if (values.length > 0) {
            result[String(attributeId)] = values;
        }
        return result;
    }, {});

const extractCategoryGroupType = (text = '') => {
    const normalized = normalizeText(text);
    const matched = CATEGORY_GROUP_TYPE_PHRASES.find(([phrase, , , prefixOnly = false]) => {
        const normalizedPhrase = normalizeText(phrase);
        if (!normalizedPhrase) return false;

        const startsAsProductType = normalized === normalizedPhrase
            || normalized.startsWith(normalizedPhrase + ' ')
            || normalized.startsWith('bo ' + normalizedPhrase + ' ');

        return prefixOnly
            ? startsAsProductType
            : startsAsProductType || normalized.includes(' ' + normalizedPhrase + ' ');
    });

    return matched
        ? { key: matched[2] || normalizeText(matched[0]).replace(/\s+/g, '_'), label: matched[1] }
        : { key: '', label: '' };
};

const extractCategoryGroupDimensions = (...values) => {
    const dimensions = new Set();

    values.forEach((value, valueIndex) => {
        const normalized = normalizeText(value);
        if (!normalized) return;

        let matched = null;
        const phiPattern = /\b(?:phi|ph|p)\s*0*([0-9]{1,3})\b/g;
        while ((matched = phiPattern.exec(normalized)) !== null) {
            dimensions.add(`phi${Number(matched[1])}`);
        }

        const cmPattern = /\b0*([0-9]{1,3})\s*(?:cm|centimet)\b/g;
        while ((matched = cmPattern.exec(normalized)) !== null) {
            dimensions.add(`cm${Number(matched[1])}`);
        }

        const sizePattern = /\bs\s*0*([0-9]{1,2})\b/g;
        while ((matched = sizePattern.exec(normalized)) !== null) {
            dimensions.add(`s${Number(matched[1])}`);
        }

        const pairPattern = /\b0*([0-9]{1,3})\s*x\s*0*([0-9]{1,3})\b/g;
        while ((matched = pairPattern.exec(normalized)) !== null) {
            dimensions.add(`${Number(matched[1])}x${Number(matched[2])}`);
        }

        if (valueIndex === 0) {
            const standaloneSizePattern = /\b0*([1-9][0-9])\b/g;
            while ((matched = standaloneSizePattern.exec(normalized)) !== null) {
                dimensions.add(`n${Number(matched[1])}`);
            }
        }
    });

    return Array.from(dimensions).sort();
};

const buildCategoryDimensionNumberKey = (dimensions = []) => Array.from(new Set(
    (Array.isArray(dimensions) ? dimensions : [])
        .map((dimension) => String(dimension).match(/[0-9]+/g)?.join('x') || '')
        .filter(Boolean)
)).sort((left, right) => Number(left.split('x')[0]) - Number(right.split('x')[0])).join('_');

const stripCategoryGroupWords = (value, categoryWords = new Set()) => (
    normalizeText(value)
        .split(/\s+/)
        .filter((word) => (
            word
            && !categoryWords.has(word)
            && !CATEGORY_GROUP_STYLE_WORDS.has(word)
            && !CATEGORY_GROUP_GENERIC_WORDS.has(word)
            && !/^mau[0-9]+$/.test(word)
        ))
        .join(' ')
);

const buildCategoryGroupIdentity = (product, { categoryWords = new Set() } = {}) => {
    const attributeMap = buildCategoryGroupAttributeMap(product);
    const name = getCategoryGroupDisplayName(product);
    const sku = getCategoryGroupDisplaySku(product);
    const attributeText = Object.values(attributeMap).flat().join(' ');
    const combinedText = [name, sku, attributeText].filter(Boolean).join(' ');
    const strippedName = stripCategoryGroupWords(name, categoryWords);
    const strippedSku = stripCategoryGroupWords(sku, categoryWords);
    const type = extractCategoryGroupType(combinedText);
    const dimensions = extractCategoryGroupDimensions(name, sku, attributeText);
    const dimensionNumberKey = buildCategoryDimensionNumberKey(dimensions);
    const coreTokens = Array.from(new Set(
        strippedName
            .split(/\s+/)
            .filter((token) => token && !/^[0-9]+$/.test(token))
    ));
    const fallbackCore = coreTokens.slice(0, 5).join('_');
    const primaryKey = [
        type.key || fallbackCore,
        dimensionNumberKey || compactText(strippedSku) || fallbackCore,
    ].filter(Boolean).join('|');

    return {
        type,
        dimensions,
        dimensionNumberKey,
        strippedName,
        strippedSku,
        strippedCompactName: compactText(strippedName),
        strippedCompactSku: compactText(strippedSku),
        primaryKey,
        attributeMap,
        tokens: coreTokens,
    };
};

const isCategoryGroupStyleAttribute = (attribute) => {
    const normalized = normalizeText([
        attribute?.name,
        attribute?.code,
    ].filter(Boolean).join(' '));

    return [
        'men',
        'mau',
        'color',
        'glaze',
        'hoa van',
        'bo suu tap',
        'dong mau',
        'loai men',
    ].some((keyword) => normalized.includes(keyword));
};

const categoryGroupValuesIntersect = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
        return false;
    }

    const rightSet = new Set(right);
    return left.some((value) => value && rightSet.has(value));
};

const scoreCategoryGroupCandidate = (source, candidate, context = {}) => {
    const sourceIdentity = buildCategoryGroupIdentity(source, context);
    const candidateIdentity = buildCategoryGroupIdentity(candidate, context);
    const attributeById = context.attributeById || {};
    let score = 0;
    const reasons = [];

    if (
        sourceIdentity.type.key
        && candidateIdentity.type.key
        && sourceIdentity.type.key !== candidateIdentity.type.key
    ) {
        return {
            sourceIdentity,
            candidateIdentity,
            score: Number.NEGATIVE_INFINITY,
            reasons: ['khác loại sản phẩm'],
        };
    }

    if (sourceIdentity.primaryKey && sourceIdentity.primaryKey === candidateIdentity.primaryKey) {
        score += 7000;
        reasons.push('trùng loại + kích thước');
    }

    if (sourceIdentity.type.key && sourceIdentity.type.key === candidateIdentity.type.key) {
        score += 2400;
        reasons.push(sourceIdentity.type.label || 'trùng loại sản phẩm');
    } else if (sourceIdentity.type.key || candidateIdentity.type.key) {
        score -= 1800;
    }

    if (sourceIdentity.dimensionNumberKey) {
        const sourceNumbers = sourceIdentity.dimensionNumberKey.split('_').filter(Boolean);
        const candidateNumbers = new Set(candidateIdentity.dimensionNumberKey.split('_').filter(Boolean));
        const matchedNumbers = sourceNumbers.filter((value) => candidateNumbers.has(value));
        if (matchedNumbers.length === sourceNumbers.length) {
            score += 2600;
            reasons.push(`trùng size ${matchedNumbers.join(', ')}`);
        } else if (matchedNumbers.length > 0) {
            score += 900;
            reasons.push(`gần đúng size ${matchedNumbers.join(', ')}`);
        } else {
            score -= 2400;
        }
    }

    if (
        sourceIdentity.strippedCompactSku
        && candidateIdentity.strippedCompactSku
        && sourceIdentity.strippedCompactSku === candidateIdentity.strippedCompactSku
    ) {
        score += 1800;
        reasons.push('trùng mã lõi SKU');
    }

    if (
        sourceIdentity.strippedCompactName
        && candidateIdentity.strippedCompactName
        && sourceIdentity.strippedCompactName === candidateIdentity.strippedCompactName
    ) {
        score += 1400;
        reasons.push('trùng tên lõi');
    }

    Object.entries(sourceIdentity.attributeMap).forEach(([attributeId, sourceValues]) => {
        const attribute = attributeById[String(attributeId)];
        if (isCategoryGroupStyleAttribute(attribute)) return;

        const candidateValues = candidateIdentity.attributeMap[String(attributeId)];
        if (!candidateValues || candidateValues.length === 0) return;

        if (categoryGroupValuesIntersect(sourceValues, candidateValues)) {
            score += 600;
        } else {
            score -= 500;
        }
    });

    if (sourceIdentity.tokens.length > 0 && candidateIdentity.tokens.length > 0) {
        const candidateTokenSet = new Set(candidateIdentity.tokens);
        const overlap = sourceIdentity.tokens.filter((token) => candidateTokenSet.has(token));
        const ratio = overlap.length / sourceIdentity.tokens.length;
        score += Math.round(ratio * 900);
        if (ratio >= 0.8) {
            reasons.push('tên lõi gần giống');
        }
    }

    const sourceProductId = getCategoryGroupProductId(source);
    const candidateProductId = getCategoryGroupProductId(candidate);
    if (sourceProductId > 0 && sourceProductId === candidateProductId) {
        score -= 5000;
    }

    return {
        sourceIdentity,
        candidateIdentity,
        score,
        reasons: Array.from(new Set(reasons)).slice(0, 3),
    };
};

const findCategoryGroupReplacement = (item, candidates = [], context = {}) => {
    const scored = (Array.isArray(candidates) ? candidates : [])
        .filter(isSelectableCategoryGroupProduct)
        .map((candidate) => ({
            product: candidate,
            ...scoreCategoryGroupCandidate(item, candidate, context),
        }))
        .sort((left, right) => right.score - left.score);

    const best = scored[0] || null;
    const second = scored[1] || null;
    if (!best || best.score < 2200) {
        return {
            product: null,
            status: 'missing',
            statusLabel: 'Không tìm thấy',
            confidence: 0,
            reasons: [],
            score: best?.score || 0,
            competingProduct: second?.product || null,
        };
    }

    const margin = best.score - (second?.score || 0);
    const exactPrimaryKey = best.sourceIdentity.primaryKey
        && best.sourceIdentity.primaryKey === best.candidateIdentity.primaryKey;
    const highConfidence = best.score >= 7200 && exactPrimaryKey && margin >= 500;

    return {
        product: best.product,
        status: highConfidence ? 'matched' : 'review',
        statusLabel: highConfidence ? 'Tìm thấy chuẩn' : 'Cần kiểm tra',
        confidence: highConfidence ? 95 : Math.max(55, Math.min(82, Math.round(best.score / 100))),
        reasons: best.reasons,
        score: best.score,
        competingProduct: second?.product || null,
    };
};

const resolveCategoryGroupItemCategoryId = (item) => String(
    item?.category_id
    || item?.product?.category_id
    || item?.product_category_id
    || item?.options?.category_id
    || ''
).trim();

const getMostCommonCategoryId = (items = []) => {
    const counts = new Map();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const categoryId = resolveCategoryGroupItemCategoryId(item);
        if (!categoryId) return;
        counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
    });

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([categoryId]) => categoryId)[0] || '';
};

const fetchCategoryGroupProducts = async (categoryId, signal) => {
    const rows = [];
    let page = 1;
    let lastPage = 1;

    do {
        const response = await productApi.getAll({
            picker: 1,
            replace_picker: 1,
            allow_variants: 1,
            category_id: categoryId,
            per_page: 200,
            page,
            _category_group_replace: `${Date.now()}-${page}`,
        }, signal);
        const payload = response.data || {};
        const pageRows = Array.isArray(payload.data) ? payload.data : [];
        rows.push(...pageRows);
        lastPage = Math.max(1, Number(payload.last_page || 1));
        page += 1;
    } while (page <= lastPage && page <= CATEGORY_GROUP_MAX_PRODUCT_PAGES);

    return rows;
};

const ProductBulkReplaceModal = ({
    show,
    onClose,
    selectedItems = [],
    attributes = [],
    onApply,
    onApplyCategoryGroup,
    currencyFormatter,
}) => {
    const selectedItemsSafe = useMemo(
        () => (Array.isArray(selectedItems) ? selectedItems : []),
        [selectedItems],
    );
    const [activeTab, setActiveTab] = useState(BULK_REPLACE_TAB_CATEGORY_GROUP);
    const [targetAttributeId, setTargetAttributeId] = useState(() => {
        if (typeof window !== 'undefined') return window.localStorage.getItem('productBulkReplace_attrId') || '';
        return '';
    });
    const [targetValue, setTargetValue] = useState(() => {
        if (typeof window !== 'undefined') return window.localStorage.getItem('productBulkReplace_attrVal') || '';
        return '';
    });
    const [replacementMap, setReplacementMap] = useState({});
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [errors, setErrors] = useState({});
    const [categories, setCategories] = useState([]);
    const [categoriesLoading, setCategoriesLoading] = useState(false);
    const [sourceCategoryId, setSourceCategoryId] = useState('');
    const [targetCategoryId, setTargetCategoryId] = useState('');
    const [categoryRows, setCategoryRows] = useState([]);
    const [categoryPreviewing, setCategoryPreviewing] = useState(false);
    const [categoryLoading, setCategoryLoading] = useState(false);
    const [categoryError, setCategoryError] = useState('');
    const categoryPreviewAbortRef = useRef(null);

    const selectionSignature = useMemo(() => (
        selectedItemsSafe
            .map((item, index) => [
                item?.line_id || index,
                item?.product_id,
                item?.category_id,
                item?.name,
                item?.sku,
            ].filter(Boolean).join(':'))
            .join('|')
    ), [selectedItemsSafe]);

    const resetAttributePreview = useCallback(() => {
        setReplacementMap({});
        setPreviewing(false);
        setErrors({});
    }, []);

    const resetCategoryPreview = useCallback(() => {
        categoryPreviewAbortRef.current?.abort();
        categoryPreviewAbortRef.current = null;
        setCategoryRows([]);
        setCategoryPreviewing(false);
        setCategoryLoading(false);
        setCategoryError('');
    }, []);

    useEffect(() => {
        if (!show) {
            resetAttributePreview();
            resetCategoryPreview();
            setActiveTab(BULK_REPLACE_TAB_CATEGORY_GROUP);
        }
    }, [resetAttributePreview, resetCategoryPreview, show]);

    useEffect(() => {
        if (!show) return;

        setSourceCategoryId(getMostCommonCategoryId(selectedItemsSafe));
        setTargetCategoryId('');
        resetCategoryPreview();
        resetAttributePreview();
    }, [resetAttributePreview, resetCategoryPreview, selectedItemsSafe, selectionSignature, show]);

    useEffect(() => {
        if (typeof window !== 'undefined' && targetAttributeId !== undefined) {
            window.localStorage.setItem('productBulkReplace_attrId', targetAttributeId);
        }
    }, [targetAttributeId]);

    useEffect(() => {
        if (typeof window !== 'undefined' && targetValue !== undefined) {
            window.localStorage.setItem('productBulkReplace_attrVal', targetValue);
        }
    }, [targetValue]);

    useEffect(() => {
        if (!show) return undefined;

        let disposed = false;
        setCategoriesLoading(true);

        categoryApi.getAll()
            .then((response) => {
                if (disposed) return;
                setCategories(resolveCategoryRows(response.data));
            })
            .catch((error) => {
                if (disposed) return;
                console.error('Cannot load categories for category group replacement.', error);
                setCategories([]);
            })
            .finally(() => {
                if (!disposed) setCategoriesLoading(false);
            });

        return () => {
            disposed = true;
        };
    }, [show]);

    useEffect(() => () => {
        categoryPreviewAbortRef.current?.abort();
    }, []);

    const availableAttributes = useMemo(() => {
        if (!Array.isArray(attributes)) return [];
        return attributes.filter(attr => {
            const type = attr.frontend_type || attr.type;
            return type === 'select' || type === 'multiselect';
        });
    }, [attributes]);

    const attributeById = useMemo(() => {
        const map = {};
        availableAttributes.forEach(a => { map[String(a.id)] = a; });
        return map;
    }, [availableAttributes]);

    const categoryAttributeById = useMemo(() => {
        const map = {};
        (Array.isArray(attributes) ? attributes : []).forEach((attribute) => {
            if (attribute?.id != null) {
                map[String(attribute.id)] = attribute;
            }
        });
        return map;
    }, [attributes]);

    const targetAttribute = useMemo(() =>
        availableAttributes.find(a => String(a.id) === String(targetAttributeId)) ?? null,
        [availableAttributes, targetAttributeId],
    );

    const targetAttributeValues = useMemo(() => {
        if (!targetAttribute) return [];
        return Array.from(new Set(getAttributeOptionValues(targetAttribute))).filter(Boolean);
    }, [targetAttribute]);

    const categoryOptions = useMemo(
        () => flattenCategoryOptions(categories),
        [categories],
    );
    const categoryById = useMemo(() => {
        const map = new Map();
        categoryOptions.forEach((category) => {
            map.set(String(category.id), category);
        });
        return map;
    }, [categoryOptions]);
    const sourceCategory = categoryById.get(String(sourceCategoryId)) || null;
    const targetCategory = categoryById.get(String(targetCategoryId)) || null;
    const canUseCategoryGroup = typeof onApplyCategoryGroup === 'function';
    const sourceMismatchCount = useMemo(() => {
        if (!sourceCategoryId) return 0;

        return selectedItemsSafe.filter((item) => {
            const itemCategoryId = resolveCategoryGroupItemCategoryId(item);
            return itemCategoryId && itemCategoryId !== String(sourceCategoryId);
        }).length;
    }, [selectedItemsSafe, sourceCategoryId]);

    const formatMoney = useCallback((value) => {
        if (typeof currencyFormatter === 'function') {
            return currencyFormatter(value);
        }
        if (value === null || value === undefined || value === '') {
            return '-';
        }
        return value;
    }, [currencyFormatter]);

    const handleRunPreview = useCallback(async () => {
        if (!targetAttributeId || !targetValue) return;

        setLoading(true);
        setPreviewing(true);
        setErrors({});
        const nextMap = {};
        const nextErrors = {};

        try {
            await Promise.all(
                selectedItemsSafe.map(async (item) => {
                    const parentId = resolveItemParentId(item);
                    const itemAttributeMap = buildItemAttributeMap(item, attributeById, targetAttributeId);
                    const skuParts = (item.sku || item.snapshot_sku || '').split('-').filter(Boolean);
                    const skuHint = skuParts.length > 2
                        ? skuParts.slice(0, skuParts.length - 1).join('-')
                        : skuParts.join('-');

                    const buildParams = ({ parent_id, search, includeSourceAttributes = true }) => {
                        const nextParams = {
                            picker: 1,
                            per_page: 200,
                            allow_variants: 1,
                            _bulk_replace: `${Date.now()}-${item.line_id || item.product_id || ''}`,
                        };

                        if (parent_id) nextParams.parent_id = parent_id;
                        if (search) nextParams.search = search;
                        if (item.category_id) nextParams.category_id = item.category_id;

                        nextParams[`attributes[${targetAttributeId}]`] = targetValue;

                        if (includeSourceAttributes) {
                            Object.entries(itemAttributeMap).forEach(([attrId, attrVal]) => {
                                if (String(attrId) === String(targetAttributeId)) return;
                                if (!attrVal) return;
                                nextParams[`attributes[${attrId}]`] = attrVal;
                            });
                        }

                        return nextParams;
                    };

                    const attempts = [];
                    if (parentId) {
                        attempts.push(buildParams({ parent_id: parentId, includeSourceAttributes: true }));
                        attempts.push(buildParams({ parent_id: parentId, includeSourceAttributes: false }));
                    }
                    if (skuHint) {
                        attempts.push(buildParams({ search: skuHint, includeSourceAttributes: true }));
                        attempts.push(buildParams({ search: skuHint, includeSourceAttributes: false }));
                    }
                    attempts.push(buildParams({ includeSourceAttributes: true }));
                    attempts.push(buildParams({ includeSourceAttributes: false }));

                    const isVariationProduct = (c) =>
                        c.type !== 'configurable' &&
                        !c.has_variations &&
                        !(c.type === 'variable');

                    try {
                        let response = null;
                        let candidates = [];
                        let usedParams = null;
                        const seenAttempts = new Set();

                        for (const attemptParams of attempts) {
                            const attemptKey = JSON.stringify({
                                ...attemptParams,
                                _bulk_replace: undefined,
                            });
                            if (seenAttempts.has(attemptKey)) continue;
                            seenAttempts.add(attemptKey);

                            response = await productApi.getAll(attemptParams);
                            candidates = (response.data?.data || []).filter(isVariationProduct);
                            usedParams = attemptParams;
                            if (candidates.length > 0) break;
                        }

                        item._debug = {
                            parentId,
                            search: usedParams?.search,
                            sourceAttributes: itemAttributeMap,
                            rawCandidates: response?.data?.data?.length || 0,
                            filteredCandidates: candidates.length,
                        };

                        if (candidates.length === 0) {
                            nextMap[item.line_id] = null;
                            return;
                        }

                        const scored = candidates
                            .map(c => ({ c, score: scoreCandidate(item, c, targetAttributeId, attributeById, itemAttributeMap) }))
                            .sort((a, b) => b.score - a.score);

                        const minimumScore = usedParams?.parent_id ? 0 : 900;
                        nextMap[item.line_id] = scored[0]?.score > minimumScore ? scored[0].c : null;
                    } catch (err) {
                        console.error('API error for item:', item.name, err);
                        nextErrors[item.line_id] = 'Lỗi tìm kiếm';
                        nextMap[item.line_id] = null;
                    }
                }),
            );

            setReplacementMap(nextMap);
            setErrors(nextErrors);
        } catch (error) {
            console.error('[BulkReplace] Fatal error', error);
        } finally {
            setLoading(false);
        }
    }, [attributeById, selectedItemsSafe, targetAttributeId, targetValue]);

    const handleRunCategoryPreview = useCallback(async () => {
        if (
            !canUseCategoryGroup
            || selectedItemsSafe.length === 0
            || !sourceCategoryId
            || !targetCategoryId
            || sourceCategoryId === targetCategoryId
            || categoryLoading
        ) {
            return;
        }

        categoryPreviewAbortRef.current?.abort();
        const controller = new AbortController();
        categoryPreviewAbortRef.current = controller;

        setCategoryLoading(true);
        setCategoryPreviewing(true);
        setCategoryRows([]);
        setCategoryError('');

        try {
            const targetProducts = await fetchCategoryGroupProducts(targetCategoryId, controller.signal);
            const categoryWords = buildCategoryWordSet(sourceCategory, targetCategory);
            const context = { categoryWords, attributeById: categoryAttributeById };
            const nextRows = selectedItemsSafe.map((item, index) => {
                const result = findCategoryGroupReplacement(item, targetProducts, context);

                return {
                    lineId: String(item?.line_id || '').trim(),
                    lineNumber: index + 1,
                    item,
                    replacementEntry: result.product,
                    status: result.status,
                    statusLabel: result.statusLabel,
                    confidence: result.confidence,
                    reasons: result.reasons,
                    score: result.score,
                    competingProduct: result.competingProduct,
                };
            });

            setCategoryRows(nextRows);
        } catch (error) {
            if (error?.name !== 'CanceledError' && error?.name !== 'AbortError' && error?.code !== 'ERR_CANCELED') {
                console.error('Cannot preview category group replacement.', error);
                setCategoryError('Không tải được sản phẩm trong danh mục đích.');
            }
        } finally {
            if (categoryPreviewAbortRef.current === controller) {
                categoryPreviewAbortRef.current = null;
                setCategoryLoading(false);
            }
        }
    }, [
        canUseCategoryGroup,
        categoryAttributeById,
        categoryLoading,
        selectedItemsSafe,
        sourceCategory,
        sourceCategoryId,
        targetCategory,
        targetCategoryId,
    ]);

    const handleConfirmAttribute = useCallback(() => {
        const replacements = Object.entries(replacementMap)
            .filter(([, product]) => !!product)
            .map(([lineId, product]) => ({ lineId, product }));
        onApply?.(replacements);
        onClose?.();
    }, [onApply, onClose, replacementMap]);

    const handleConfirmCategoryGroup = useCallback(() => {
        const rowsToApply = categoryRows.filter((row) => row.replacementEntry && row.lineId);
        if (rowsToApply.length === 0) return;

        onApplyCategoryGroup?.(rowsToApply);
        onClose?.();
    }, [categoryRows, onApplyCategoryGroup, onClose]);

    const matchCount = Object.values(replacementMap).filter(Boolean).length;
    const hasAnyMatch = matchCount > 0;
    const categoryMatchCount = categoryRows.filter((row) => row.replacementEntry).length;
    const categoryReviewCount = categoryRows.filter((row) => row.status === 'review').length;
    const categoryMissingCount = categoryRows.filter((row) => row.status === 'missing').length;
    const hasCategoryMatch = categoryMatchCount > 0;
    const canRunCategoryPreview = canUseCategoryGroup
        && selectedItemsSafe.length > 0
        && sourceCategoryId
        && targetCategoryId
        && sourceCategoryId !== targetCategoryId
        && !categoryLoading;
    const categoryStatusClassMap = {
        matched: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        review: 'border-amber-200 bg-amber-50 text-amber-700',
        missing: 'border-rose-200 bg-rose-50 text-rose-700',
    };
    const renderCategoryOptionLabel = (category) => (
        `${'--'.repeat(Number(category?.depth) || 0)} ${category?.name || 'Danh mục'}`.trim()
    );

    if (!show) return null;

    const isAttributeTab = activeTab === BULK_REPLACE_TAB_ATTRIBUTE;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <_motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />

            <_motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">swap_horiz</span>
                        </div>
                        <div className="min-w-0">
                            <h3 className="truncate text-lg font-bold text-slate-800">Đổi sản phẩm hàng loạt</h3>
                            <p className="text-xs font-medium text-slate-500">Đang chọn {selectedItemsSafe.length} sản phẩm</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="border-b border-slate-100 px-6 pt-4">
                    <div className="grid grid-cols-1 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setActiveTab(BULK_REPLACE_TAB_CATEGORY_GROUP)}
                            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition-all ${
                                !isAttributeTab
                                    ? 'bg-white text-primary shadow-sm'
                                    : 'text-slate-500 hover:bg-white/60 hover:text-primary'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">category</span>
                            Đổi nhóm theo danh mục
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab(BULK_REPLACE_TAB_ATTRIBUTE)}
                            className={`hidden items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition-all sm:flex ${
                                isAttributeTab
                                    ? 'bg-white text-primary shadow-sm'
                                    : 'text-slate-500 hover:bg-white/60 hover:text-primary'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">tune</span>
                            Đổi theo thuộc tính
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {isAttributeTab ? (
                        <>
                            <div className="grid grid-cols-2 gap-4 rounded-xl border border-primary/10 bg-primary/[0.02] p-4">
                                <div className="flex flex-col justify-end gap-1.5">
                                    <label className="text-[13px] font-bold text-primary/70">Chọn thuộc tính muốn thay đổi</label>
                                    <select
                                        value={targetAttributeId}
                                        onChange={(e) => {
                                            setTargetAttributeId(e.target.value);
                                            setTargetValue('');
                                            resetAttributePreview();
                                        }}
                                        className="w-full rounded-lg border border-primary/10 bg-white px-3 py-2 text-sm font-semibold shadow-sm focus:border-primary/30 focus:outline-none"
                                    >
                                        <option value="">-- Chọn thuộc tính --</option>
                                        {availableAttributes.map(attr => (
                                            <option key={attr.id} value={attr.id}>{attr.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col justify-end gap-1.5">
                                    <label className="text-[13px] font-bold text-primary/70">Chọn giá trị mới</label>
                                    <select
                                        value={targetValue}
                                        onChange={(e) => {
                                            setTargetValue(e.target.value);
                                            resetAttributePreview();
                                        }}
                                        disabled={!targetAttributeId}
                                        className="w-full rounded-lg border border-primary/10 bg-white px-3 py-2 text-sm font-semibold shadow-sm focus:border-primary/30 focus:outline-none disabled:opacity-50"
                                    >
                                        <option value="">-- Chọn giá trị --</option>
                                        {targetAttributeValues.map((val, idx) => (
                                            <option key={`${val}-${idx}`} value={val}>{val}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={handleRunPreview}
                                        disabled={!targetAttributeId || !targetValue || loading}
                                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        {loading ? (
                                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[18px]">find_replace</span>
                                        )}
                                        {loading ? 'Đang tìm kiếm...' : previewing ? 'Tìm lại sản phẩm tương đương' : 'Bắt đầu tìm sản phẩm tương đương'}
                                    </button>
                                </div>
                            </div>

                            {previewing && (
                                <div className="mt-6 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-bold text-slate-700">Kết quả đối chiếu</h4>
                                        {!loading && (
                                            <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${hasAnyMatch ? 'bg-green-50 text-green-600' : 'bg-rose-50 text-rose-500'}`}>
                                                {matchCount}/{selectedItemsSafe.length} khớp
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex max-h-[380px] flex-col overflow-y-auto rounded-xl border border-slate-100 bg-white">
                                        <div className="sticky top-0 z-10 hidden gap-4 border-b border-slate-100 bg-slate-50/90 px-4 py-3 backdrop-blur-md sm:grid sm:grid-cols-[1fr_40px_1fr]">
                                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sản phẩm hiện tại</div>
                                            <div className="text-center" />
                                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sản phẩm thay thế</div>
                                        </div>

                                        <div className="flex flex-col gap-3 bg-slate-50/30 p-3">
                                            {selectedItemsSafe.map((item) => {
                                                const replacement = replacementMap[item.line_id];
                                                const hasReplacement = !!replacement;

                                                return (
                                                    <div key={item.line_id} className={`flex flex-col gap-3 rounded-xl border p-3.5 transition-all sm:grid sm:grid-cols-[1fr_40px_1fr] sm:items-center sm:gap-4 sm:p-4 ${hasReplacement ? 'border-green-200/60 bg-white shadow-sm' : 'border-slate-200 bg-white shadow-sm'}`}>
                                                        <div className="relative flex w-full flex-col gap-1">
                                                            <span className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">Đang có</span>
                                                            <p className="text-[13px] font-bold leading-snug text-slate-700">{item.name}</p>
                                                            <p className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                                                                <span className="material-symbols-outlined text-[13px]">barcode</span>
                                                                {item.sku}
                                                            </p>
                                                        </div>

                                                        <div className="relative flex w-full justify-center py-2 sm:w-auto sm:py-0">
                                                            <div className="absolute inset-0 flex items-center px-4 sm:hidden">
                                                                <div className="w-full border-t border-dashed border-slate-200" />
                                                            </div>
                                                            <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white transition-all ${
                                                                hasReplacement
                                                                    ? 'bg-green-100 text-green-600'
                                                                    : loading
                                                                        ? 'animate-pulse bg-slate-100 text-slate-400'
                                                                        : 'bg-slate-100 text-slate-300'
                                                            }`}>
                                                                <span className={`material-symbols-outlined text-[16px] ${!hasReplacement ? 'rotate-90 sm:rotate-0' : ''}`}>
                                                                    {hasReplacement ? 'check_circle' : 'chevron_right'}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className={`flex w-full flex-col gap-1 rounded-lg border sm:border-0 sm:bg-transparent sm:p-0 ${hasReplacement ? 'border-green-200/50 bg-green-50/50 p-3' : 'border-slate-200 bg-slate-50 p-3'}`}>
                                                            <span className={`mb-0.5 text-[10px] font-bold uppercase tracking-wider sm:hidden ${hasReplacement ? 'text-green-600' : 'text-slate-400'}`}>Thay bằng</span>
                                                            {hasReplacement ? (
                                                                <>
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <p className="text-[13px] font-bold leading-snug text-primary">
                                                                            {replacement.display_name || replacement.name}
                                                                        </p>
                                                                        <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">Đã khớp</span>
                                                                    </div>
                                                                    <p className="flex flex-wrap items-center gap-1 text-[11px] font-medium text-slate-400">
                                                                        <span className="material-symbols-outlined text-[13px]">barcode</span>
                                                                        {replacement.display_sku || replacement.sku}
                                                                        {replacement.price != null && (
                                                                            <>
                                                                                <span className="text-slate-200">•</span>
                                                                                <span className="material-symbols-outlined text-[13px]">sell</span>
                                                                                {formatMoney(replacement.price)}
                                                                            </>
                                                                        )}
                                                                    </p>
                                                                </>
                                                            ) : loading ? (
                                                                <div className="space-y-2">
                                                                    <div className="h-3 w-full max-w-[200px] animate-pulse rounded bg-slate-200" />
                                                                    <div className="h-2.5 w-24 animate-pulse rounded bg-slate-200" />
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-1.5 text-rose-500 italic">
                                                                    <span className="material-symbols-outlined text-[15px]">error</span>
                                                                    <span className="text-[12px] font-medium">
                                                                        {errors[item.line_id] || 'Không tìm thấy mẫu tương ứng'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {!loading && !hasAnyMatch && (
                                        <p className="text-center text-[12px] font-medium italic text-slate-400">
                                            Không tìm thấy sản phẩm thay thế nào. Hãy kiểm tra lại các sản phẩm đã được liên kết biến thể trong hệ thống.
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="rounded-xl border border-primary/10 bg-primary/[0.02] p-4">
                                {!canUseCategoryGroup ? (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
                                        Chưa nối handler đổi nhóm cho màn hình này.
                                    </div>
                                ) : null}
                                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] md:items-end">
                                    <div className="space-y-1.5">
                                        <label className="text-[13px] font-bold text-primary/70">Danh mục nguồn</label>
                                        <select
                                            value={sourceCategoryId}
                                            onChange={(event) => {
                                                setSourceCategoryId(event.target.value);
                                                resetCategoryPreview();
                                            }}
                                            disabled={categoriesLoading}
                                            className="h-11 w-full rounded-lg border border-primary/10 bg-white px-3 text-sm font-semibold text-primary shadow-sm transition-all focus:border-primary/30 focus:outline-none disabled:opacity-50"
                                        >
                                            <option value="">{categoriesLoading ? 'Đang tải danh mục...' : '-- Chọn danh mục nguồn --'}</option>
                                            {categoryOptions.map((category) => (
                                                <option key={`source-${category.id}`} value={category.id}>
                                                    {renderCategoryOptionLabel(category)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="hidden h-11 items-center justify-center text-primary/35 md:flex">
                                        <span className="material-symbols-outlined">arrow_forward</span>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[13px] font-bold text-primary/70">Danh mục đích</label>
                                        <select
                                            value={targetCategoryId}
                                            onChange={(event) => {
                                                setTargetCategoryId(event.target.value);
                                                resetCategoryPreview();
                                            }}
                                            disabled={categoriesLoading}
                                            className="h-11 w-full rounded-lg border border-primary/10 bg-white px-3 text-sm font-semibold text-primary shadow-sm transition-all focus:border-primary/30 focus:outline-none disabled:opacity-50"
                                        >
                                            <option value="">{categoriesLoading ? 'Đang tải danh mục...' : '-- Chọn danh mục đích --'}</option>
                                            {categoryOptions.map((category) => (
                                                <option key={`target-${category.id}`} value={category.id}>
                                                    {renderCategoryOptionLabel(category)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {sourceMismatchCount > 0 ? (
                                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
                                        Có {sourceMismatchCount} dòng không trùng danh mục nguồn đã chọn, hệ thống vẫn thử ghép theo tên lõi và thuộc tính.
                                    </div>
                                ) : null}

                                <button
                                    type="button"
                                    onClick={handleRunCategoryPreview}
                                    disabled={!canRunCategoryPreview}
                                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {categoryLoading ? (
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                    ) : (
                                        <span className="material-symbols-outlined text-[18px]">find_replace</span>
                                    )}
                                    {categoryLoading ? 'Đang tìm sản phẩm tương ứng...' : categoryPreviewing ? 'Tìm lại sản phẩm tương ứng' : 'Tìm sản phẩm tương ứng'}
                                </button>
                            </div>

                            {categoryError ? (
                                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-bold text-rose-700">
                                    {categoryError}
                                </div>
                            ) : null}

                            {categoryPreviewing ? (
                                <div className="mt-5 overflow-hidden rounded-xl border border-slate-100 bg-white">
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                                        <div className="text-sm font-black text-slate-800">Kết quả ghép tự động</div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-black text-emerald-700">
                                                {categoryMatchCount}/{selectedItemsSafe.length} có thể đổi
                                            </span>
                                            {categoryReviewCount > 0 ? (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
                                                    {categoryReviewCount} cần kiểm tra
                                                </span>
                                            ) : null}
                                            {categoryMissingCount > 0 ? (
                                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-700">
                                                    {categoryMissingCount} chưa thấy
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="hidden grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_150px_140px] gap-3 border-b border-slate-100 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-[0.08em] text-slate-400 md:grid">
                                        <div>Sản phẩm nguồn</div>
                                        <div />
                                        <div>Sản phẩm đích</div>
                                        <div>Trạng thái</div>
                                        <div>Giá chốt</div>
                                    </div>

                                    <div className="max-h-[46vh] overflow-y-auto">
                                        {categoryLoading && categoryRows.length === 0 ? (
                                            <div className="px-4 py-10 text-center text-[13px] font-semibold text-primary/45">
                                                Đang đối chiếu sản phẩm trong danh mục đích...
                                            </div>
                                        ) : categoryRows.map((row) => {
                                            const replacement = row.replacementEntry;
                                            const statusClass = categoryStatusClassMap[row.status] || categoryStatusClassMap.missing;

                                            return (
                                                <div
                                                    key={row.lineId || `${row.lineNumber}-${getCategoryGroupDisplayName(row.item)}`}
                                                    className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_150px_140px] md:items-center"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="shrink-0 rounded-full bg-primary/[0.04] px-2 py-0.5 text-[10px] font-black text-primary/45">
                                                                STT {row.lineNumber}
                                                            </span>
                                                            <span className="truncate text-[13px] font-bold text-primary">
                                                                {getCategoryGroupDisplayName(row.item)}
                                                            </span>
                                                        </div>
                                                        {getCategoryGroupDisplaySku(row.item) ? (
                                                            <div className="mt-1 truncate text-[11px] font-semibold text-primary/35">
                                                                {getCategoryGroupDisplaySku(row.item)}
                                                            </div>
                                                        ) : null}
                                                    </div>

                                                    <div className="hidden justify-center md:flex">
                                                        <span className={`material-symbols-outlined text-[18px] ${replacement ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                            {replacement ? 'arrow_forward' : 'error'}
                                                        </span>
                                                    </div>

                                                    <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 md:border-0 md:bg-transparent md:p-0">
                                                        {replacement ? (
                                                            <>
                                                                <div className="truncate text-[13px] font-bold text-slate-900">
                                                                    {getCategoryGroupDisplayName(replacement)}
                                                                </div>
                                                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-400">
                                                                    {getCategoryGroupDisplaySku(replacement) ? (
                                                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                                                            {getCategoryGroupDisplaySku(replacement)}
                                                                        </span>
                                                                    ) : null}
                                                                    {(row.reasons || []).map((reason) => (
                                                                        <span key={reason} className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                                                                            {reason}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="text-[12px] font-bold text-rose-600">
                                                                Không có sản phẩm đủ giống trong danh mục đích
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div>
                                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${statusClass}`}>
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                {row.status === 'matched' ? 'check_circle' : row.status === 'review' ? 'warning' : 'cancel'}
                                                            </span>
                                                            {row.statusLabel}
                                                        </span>
                                                    </div>

                                                    <div className="text-[12px] font-black text-sky-800">
                                                        Giữ {formatMoney(row.item?.price)}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-5 rounded-xl border border-dashed border-primary/10 bg-primary/[0.02] px-5 py-8 text-center">
                                    <div className="text-[13px] font-bold text-primary/55">
                                        Chọn danh mục nguồn và danh mục đích rồi bấm tìm để xem preview.
                                    </div>
                                </div>
                            )}

                            <div className="mt-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] font-semibold text-sky-800">
                                <span className="material-symbols-outlined shrink-0 text-[18px]">info</span>
                                <span>Không đổi số lượng, không đổi giá bán, không đổi ghi chú đơn hàng. Chỉ đổi sản phẩm trên dòng đơn.</span>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                    <div className="text-[12px] font-semibold text-slate-500">
                        {isAttributeTab ? (
                            previewing && !loading ? (
                                hasAnyMatch
                                    ? `Sẵn sàng thay đổi ${matchCount} sản phẩm.`
                                    : 'Không có sản phẩm nào khớp để áp dụng.'
                            ) : null
                        ) : (
                            categoryPreviewing && !categoryLoading ? (
                                hasCategoryMatch
                                    ? `Sẵn sàng đổi nhóm ${categoryMatchCount}/${selectedItemsSafe.length} dòng.`
                                    : 'Chưa có dòng nào đủ điều kiện đổi.'
                            ) : null
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
                        >
                            Hủy bỏ
                        </button>
                        {isAttributeTab ? (
                            <button
                                type="button"
                                onClick={handleConfirmAttribute}
                                disabled={loading || !hasAnyMatch}
                                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-700 disabled:opacity-40"
                            >
                                Xác nhận thay đổi {hasAnyMatch ? `(${matchCount})` : ''}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleConfirmCategoryGroup}
                                disabled={categoryLoading || !hasCategoryMatch}
                                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Xác nhận đổi nhóm {hasCategoryMatch ? `(${categoryMatchCount})` : ''}
                            </button>
                        )}
                    </div>
                </div>
            </_motion.div>
        </div>
    );
};

export default ProductBulkReplaceModal;
