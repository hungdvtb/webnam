import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { productApi } from '../../services/api';

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
        } catch (error) {
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

const ProductBulkReplaceModal = ({
    show,
    onClose,
    selectedItems,
    attributes = [],
    onApply,
    currencyFormatter,
}) => {
    const [targetAttributeId, setTargetAttributeId] = useState(() => {
        if (typeof window !== 'undefined') return window.localStorage.getItem('productBulkReplace_attrId') || '';
        return '';
    });
    const [targetValue, setTargetValue] = useState(() => {
        if (typeof window !== 'undefined') return window.localStorage.getItem('productBulkReplace_attrVal') || '';
        return '';
    });
    const [replacementMap, setReplacementMap] = useState({}); // line_id -> candidate | null
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [errors, setErrors] = useState({}); // line_id -> error message

    // Reset state when modal is closed / re-opened
    useEffect(() => {
        if (!show) {
            setReplacementMap({});
            setPreviewing(false);
            setErrors({});
        }
    }, [show]);

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

    // Attributes eligible for bulk replacement
    const availableAttributes = useMemo(() => {
        if (!Array.isArray(attributes)) return [];
        return attributes.filter(attr => {
            const type = attr.frontend_type || attr.type;
            return type === 'select' || type === 'multiselect';
        });
    }, [attributes]);

    // Build a lookup map: attrId -> attribute object (with .code)
    const attributeById = useMemo(() => {
        const map = {};
        availableAttributes.forEach(a => { map[String(a.id)] = a; });
        return map;
    }, [availableAttributes]);

    const targetAttribute = useMemo(() =>
        availableAttributes.find(a => String(a.id) === String(targetAttributeId)) ?? null,
        [availableAttributes, targetAttributeId],
    );

    const targetAttributeValues = useMemo(() => {
        if (!targetAttribute) return [];
        return (targetAttribute.options || targetAttribute.values || [])
            .map(o => (typeof o === 'object' ? o.value : o))
            .filter(Boolean);
    }, [targetAttribute]);

    // â”€â”€ Search handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleRunPreview = useCallback(async () => {
        if (!targetAttributeId || !targetValue) return;

        setLoading(true);
        setPreviewing(true);
        setErrors({});
        const nextMap = {};
        const nextErrors = {};

        try {
            await Promise.all(
                selectedItems.map(async (item) => {
                    const parentId = resolveItemParentId(item);
                    {
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
                            nextMap[item.line_id] = scored[0].score > minimumScore ? scored[0].c : null;
                        } catch (err) {
                            console.error('API error for item:', item.name, err);
                            nextErrors[item.line_id] = 'Lỗi tìm kiếm';
                            nextMap[item.line_id] = null;
                        }

                        return;
                    }

                    // â”€â”€ Build API params â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                    const params = {
                        picker: 1,
                        per_page: 60,
                        allow_variants: 1,
                    };

                    if (parentId) {
                        // Most reliable: get all siblings from same parent
                        params.parent_id = parentId;
                    } else {
                        // Fallback: search by SKU prefix (drop ONLY the last segment,
                        // which typically encodes the attribute value being changed).
                        // e.g. "MR70-MAMBONGRAN-28-RONG" -> "MR70-MAMBONGRAN-28"
                        const skuParts = (item.sku || '').split('-').filter(Boolean);
                        const skuHint = skuParts.length > 2
                            ? skuParts.slice(0, skuParts.length - 1).join('-')
                            : skuParts.join('-');
                        if (skuHint) params.search = skuHint;
                        if (item.category_id) params.category_id = item.category_id;
                    }

                    // Filter by the TARGET attribute value (the one we want to change TO)
                    // Backend uses attributes[id] = value
                    if (targetAttributeId) {
                        params[`attributes[${targetAttributeId}]`] = targetValue;
                    }

                    // Also preserve other attribute values in the search
                    // Map item.product_attributes {attrId -> value} -> attributes[id] = value
                    if (item.product_attributes && typeof item.product_attributes === 'object') {
                        Object.entries(item.product_attributes).forEach(([attrId, attrVal]) => {
                            if (String(attrId) === String(targetAttributeId)) return;
                            if (!attrVal) return;
                            params[`attributes[${attrId}]`] = attrVal;
                        });
                    }

                    // Hard-filter: never propose a configurable parent as a replacement
                    const isVariationProduct = (c) =>
                        c.type !== 'configurable' &&
                        !c.has_variations &&
                        !(c.type === 'variable');

                    try {
                        let response = await productApi.getAll(params);
                        let candidates = (response.data?.data || []).filter(isVariationProduct);
                        let fallbackUsed = false;

                        // If parent_id was used but yielded 0 variations, it might be a bad legacy ID (e.g. bundle ID).
                        // Fallback to the reliable SKU prefix search.
                        if (candidates.length === 0 && params.parent_id) {
                            delete params.parent_id;
                            const skuParts = (item.sku || '').split('-').filter(Boolean);
                            const skuHint = skuParts.length > 2
                                ? skuParts.slice(0, skuParts.length - 1).join('-')
                                : skuParts.join('-');
                            
                            if (skuHint) {
                                params.search = skuHint;
                                if (item.category_id) params.category_id = item.category_id;
                                
                                response = await productApi.getAll(params);
                                candidates = (response.data?.data || []).filter(isVariationProduct);
                                fallbackUsed = true;
                            }
                        }

                        // If we relied on SKU hint fallback, the API's 'search' param also matches 'description' 
                        // and 'name' which can bring in completely unrelated products. We must enforce that 
                        // the candidate's SKU actually starts with our hint.
                        if (!params.parent_id && params.search) {
                            const hintLower = params.search.toLowerCase();
                            candidates = candidates.filter(c => {
                                const cSku = (c.sku || c.display_sku || '').toLowerCase();
                                return cSku.startsWith(hintLower);
                            });
                        }

                        // Attach debug info to the item for rendering
                        item._debug = {
                            parentId,
                            search: params.search,
                            rawCandidates: response.data?.data?.length || 0,
                            filteredCandidates: candidates.length,
                        };

                        if (candidates.length === 0) {
                            // Strict search returned nothing.
                            // We DO NOT fallback to dropping attribute filters because the user explicitly
                            // wants to preserve non-target attributes (e.g., must keep Size=28cm).
                            nextMap[item.line_id] = null;
                            return;
                        }

                        // Score and pick best among strict results
                        // This helps if we didn't have parent_id and relied on SKU hint,
                        // to pick the closest name/sku among those that matched all attributes.
                        const scored = candidates
                            .map(c => ({ c, score: scoreCandidate(item, c, targetAttributeId, attributeById) }))
                            .sort((a, b) => b.score - a.score);

                        // Only accept if it has a decent score (e.g. sibling or good name/sku match)
                        // A strict match from API already ensures attributes are correct.
                        nextMap[item.line_id] = scored[0].score > 0 ? scored[0].c : null;

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
    }, [selectedItems, targetAttributeId, targetValue, targetAttribute, attributeById]);

    // â”€â”€ Confirm handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleConfirm = useCallback(() => {
        const replacements = Object.entries(replacementMap)
            .filter(([, product]) => !!product)
            .map(([lineId, product]) => ({ lineId, product }));
        onApply(replacements);
        onClose();
    }, [replacementMap, onApply, onClose]);

    const matchCount = Object.values(replacementMap).filter(Boolean).length;
    const hasAnyMatch = matchCount > 0;

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />

            {/* Modal */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">swap_horiz</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">Đổi sản phẩm hàng loạt</h3>
                            <p className="text-xs font-medium text-slate-500">Đang chọn {selectedItems.length} sản phẩm</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="p-6">
                    {/* Config area */}
                    <div className="grid grid-cols-2 gap-4 rounded-xl border border-primary/10 bg-primary/[0.02] p-4">
                        <div className="flex flex-col justify-end gap-1.5">
                            <label className="text-[13px] font-bold text-primary/70">Chọn thuộc tính muốn thay đổi</label>
                            <select
                                value={targetAttributeId}
                                onChange={(e) => { setTargetAttributeId(e.target.value); setTargetValue(''); setReplacementMap({}); setPreviewing(false); }}
                                className="w-full rounded-lg border border-primary/10 bg-white px-3 py-2 text-sm font-semibold focus:border-primary/30 focus:outline-none shadow-sm"
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
                                onChange={(e) => { setTargetValue(e.target.value); setReplacementMap({}); setPreviewing(false); }}
                                disabled={!targetAttributeId}
                                className="w-full rounded-lg border border-primary/10 bg-white px-3 py-2 text-sm font-semibold focus:border-primary/30 focus:outline-none shadow-sm disabled:opacity-50"
                            >
                                <option value="">-- Chọn giá trị --</option>
                                {targetAttributeValues.map((val, idx) => (
                                    <option key={`${val}-${idx}`} value={val}>{val}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-span-2 pt-1">
                            <button
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

                    {/* Preview table */}
                    {previewing && (
                        <div className="mt-6 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-bold text-slate-700">Kết quả đối chiếu</h4>
                                {!loading && (
                                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${hasAnyMatch ? 'bg-green-50 text-green-600' : 'bg-rose-50 text-rose-500'}`}>
                                        {matchCount}/{selectedItems.length} khớp
                                    </span>
                                )}
                            </div>

                            <div className="max-h-[380px] overflow-y-auto rounded-xl border border-slate-100 bg-white flex flex-col">
                                {/* Header (Hidden on mobile) */}
                                <div className="hidden sm:grid sm:grid-cols-[1fr_40px_1fr] gap-4 sticky top-0 z-10 bg-slate-50/90 backdrop-blur-md border-b border-slate-100 px-4 py-3">
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sản phẩm hiện tại</div>
                                    <div className="text-center" />
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sản phẩm thay thế</div>
                                </div>

                                {/* Body */}
                                <div className="flex flex-col gap-3 p-3 bg-slate-50/30">
                                    {selectedItems.map((item) => {
                                        const replacement = replacementMap[item.line_id];
                                        const hasReplacement = !!replacement;
                                        const isLoading = loading;

                                        return (
                                            <div key={item.line_id} className={`flex flex-col sm:grid sm:grid-cols-[1fr_40px_1fr] sm:items-center gap-3 sm:gap-4 p-3.5 sm:p-4 rounded-xl border transition-all ${hasReplacement ? 'border-green-200/60 bg-white shadow-sm' : 'border-slate-200 bg-white shadow-sm'}`}>
                                                {/* Source item */}
                                                <div className="flex flex-col gap-1 w-full relative">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5 sm:hidden">Đang có</span>
                                                    <p className="text-[13px] font-bold text-slate-700 leading-snug">{item.name}</p>
                                                    <p className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                                                        <span className="material-symbols-outlined text-[13px]">barcode</span>
                                                        {item.sku}
                                                    </p>
                                                </div>

                                                {/* Arrow */}
                                                <div className="flex justify-center w-full sm:w-auto py-2 sm:py-0 relative">
                                                    <div className="absolute inset-0 flex items-center sm:hidden px-4">
                                                        <div className="w-full border-t border-slate-200 border-dashed"></div>
                                                    </div>
                                                    <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white transition-all ${
                                                        hasReplacement
                                                            ? 'bg-green-100 text-green-600'
                                                            : isLoading
                                                                ? 'bg-slate-100 text-slate-400 animate-pulse'
                                                                : 'bg-slate-100 text-slate-300'
                                                    }`}>
                                                        <span className={`material-symbols-outlined text-[16px] ${!hasReplacement ? 'rotate-90 sm:rotate-0' : ''}`}>
                                                            {hasReplacement ? 'check_circle' : 'chevron_right'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Replacement */}
                                                <div className={`flex flex-col gap-1 w-full sm:p-0 rounded-lg sm:rounded-none sm:bg-transparent border sm:border-0 ${hasReplacement ? 'bg-green-50/50 border-green-200/50 p-3' : 'bg-slate-50 border-slate-200 p-3'}`}>
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 sm:hidden ${hasReplacement ? 'text-green-600' : 'text-slate-400'}`}>Thay bằng</span>
                                                    {hasReplacement ? (
                                                        <>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <p className="text-[13px] font-bold text-primary leading-snug">
                                                                    {replacement.display_name || replacement.name}
                                                                </p>
                                                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 whitespace-nowrap">Đã khớp</span>
                                                            </div>
                                                            <p className="flex items-center flex-wrap gap-1 text-[11px] font-medium text-slate-400">
                                                                <span className="material-symbols-outlined text-[13px]">barcode</span>
                                                                {replacement.display_sku || replacement.sku}
                                                                {replacement.price != null && (
                                                                    <>
                                                                        <span className="text-slate-200">•</span>
                                                                        <span className="material-symbols-outlined text-[13px]">sell</span>
                                                                        {typeof currencyFormatter === 'function'
                                                                            ? currencyFormatter(replacement.price)
                                                                            : replacement.price}
                                                                    </>
                                                                )}
                                                            </p>
                                                        </>
                                                    ) : isLoading ? (
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

                            {/* Hint if nothing matched */}
                            {!loading && !hasAnyMatch && (
                                <p className="text-center text-[12px] font-medium text-slate-400 italic">
                                    Không tìm thấy sản phẩm thay thế nào. Hãy kiểm tra lại các sản phẩm đã được liên kết biến thể trong hệ thống.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                    <div className="text-[12px] text-slate-400">
                        {previewing && !loading && (
                            <span>
                                {hasAnyMatch
                                    ? `Sẵn sàng thay đổi ${matchCount} sản phẩm.`
                                    : 'Không có sản phẩm nào khớp để áp dụng.'}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={loading || !hasAnyMatch}
                            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-700 disabled:opacity-40"
                        >
                            Xác nhận thay đổi {hasAnyMatch ? `(${matchCount})` : ''}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default ProductBulkReplaceModal;
