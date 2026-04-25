import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { productApi } from '../../services/api';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Extract the parent product id from an order line item.
 *  Order line items store it in multiple possible locations. */
const resolveItemParentId = (item) => {
    const direct = Number(item?.parent_product_id);
    if (direct > 0) return direct;

    // Also check inside options (set by buildOrderItemsFromSearchEntry for variations)
    const fromOptions = Number(item?.options?.variant_parent_id);
    if (fromOptions > 0) return fromOptions;

    return null;
};

/** Tokenise a product name for similarity scoring */
const tokenise = (name = '') =>
    name
        .toLowerCase()
        .replace(/[()[\]/]/g, ' ')
        .split(/[\s\-–]+/)
        .map(t => t.trim())
        .filter(t => t.length > 1);

/** Return the longest shared SKU prefix length (split by '-') */
const skuPrefixMatchCount = (skuA = '', skuB = '') => {
    const a = skuA.toLowerCase().split('-');
    const b = skuB.toLowerCase().split('-');
    let count = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] === b[i]) count++;
        else break;
    }
    return count;
};

/** Score a candidate product against the source item.
 *  Higher = better match. */
const scoreCandidate = (item, candidate, targetAttributeId, attributeById) => {
    let score = 0;

    const itemParentId = resolveItemParentId(item);
    const candidateParentId =
        Number(candidate.parent_product_id) ||
        Number(candidate.variant_parent_id) ||
        Number(candidate.options?.variant_parent_id) ||
        null;

    // ── 1. Sibling bonus (same parent → definitely the right family)
    if (itemParentId && candidateParentId && itemParentId === candidateParentId) {
        score += 10_000;
    }

    // ── 2. Configurable/parent penalty (never want to swap to the parent itself)
    if (candidate.type === 'configurable' || candidate.has_variations) {
        score -= 8_000;
    }

    // ── 3. Being a variation is a positive signal
    if (candidate.type === 'variation' || candidateParentId) {
        score += 300;
    }

    // ── 4. Attribute consistency (preserve non-target attributes like Size)
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
                    score += 2_000; // same value → big reward (e.g. same Size)
                } else {
                    score -= 1_000; // different value → penalty
                }
            }
        });
    }

    // ── 5. Name token similarity
    const itemTokens = tokenise(item.name);
    const candTokens = tokenise(candidate.display_name || candidate.name);
    if (itemTokens.length > 0) {
        const matched = itemTokens.filter(t => candTokens.includes(t)).length;
        const ratio = matched / itemTokens.length;
        score += Math.round(ratio * 600);
        if (ratio >= 0.8) score += 200;
    }

    // ── 6. SKU prefix similarity
    const prefixLen = skuPrefixMatchCount(item.sku, candidate.sku || candidate.display_sku);
    score += prefixLen * 250;

    // ── 7. Category match
    if (item.category_id && Number(candidate.category_id) === Number(item.category_id)) {
        score += 150;
    }

    return score;
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const ProductBulkReplaceModal = ({
    show,
    onClose,
    selectedItems,
    attributes = [],
    onApply,
    currencyFormatter,
}) => {
    const [targetAttributeId, setTargetAttributeId] = useState('');
    const [targetValue, setTargetValue] = useState('');
    const [replacementMap, setReplacementMap] = useState({}); // line_id → candidate | null
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [errors, setErrors] = useState({}); // line_id → error message

    // Reset state when modal is closed / re-opened
    useEffect(() => {
        if (!show) {
            setReplacementMap({});
            setPreviewing(false);
            setErrors({});
        }
    }, [show]);

    // Attributes eligible for bulk replacement
    const availableAttributes = useMemo(() => {
        if (!Array.isArray(attributes)) return [];
        return attributes.filter(attr => {
            const type = attr.frontend_type || attr.type;
            return type === 'select' || type === 'multiselect';
        });
    }, [attributes]);

    // Build a lookup map: attrId → attribute object (with .code)
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

    // ── Search handler ──────────────────────────────────────────────────────
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

                    // ── Build API params ──────────────────────────────────
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
                        // e.g. "MR70-MAMBONGRAN-28-RONG" → "MR70-MAMBONGRAN-28"
                        const skuParts = (item.sku || '').split('-').filter(Boolean);
                        const skuHint = skuParts.length > 2
                            ? skuParts.slice(0, skuParts.length - 1).join('-')
                            : skuParts.join('-');
                        if (skuHint) params.search = skuHint;
                        if (item.category_id) params.category_id = item.category_id;
                    }

                    // Filter by the TARGET attribute value (the one we want to change TO)
                    // Backend uses attrs[code] = value
                    if (targetAttribute?.code) {
                        params[`attrs[${targetAttribute.code}]`] = targetValue;
                    }

                    // Also preserve other attribute values in the search
                    // Map item.product_attributes {attrId → value} → attrs[code] = value
                    if (item.product_attributes && typeof item.product_attributes === 'object') {
                        Object.entries(item.product_attributes).forEach(([attrId, attrVal]) => {
                            if (String(attrId) === String(targetAttributeId)) return;
                            if (!attrVal) return;
                            const attrDef = attributeById[String(attrId)];
                            if (attrDef?.code) {
                                params[`attrs[${attrDef.code}]`] = attrVal;
                            }
                        });
                    }

                    // Hard-filter: never propose a configurable parent as a replacement
                    const isVariationProduct = (c) =>
                        c.type !== 'configurable' &&
                        !c.has_variations &&
                        !(c.type === 'variable');

                    try {
                        const response = await productApi.getAll(params);
                        const candidates = (response.data?.data || []).filter(isVariationProduct);

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

    // ── Confirm handler ─────────────────────────────────────────────────────
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
                        <div className="space-y-1.5">
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
                        <div className="space-y-1.5">
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

                            <div className="max-h-[380px] overflow-y-auto rounded-xl border border-slate-100">
                                <table className="w-full text-left">
                                    <thead className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur-md border-b border-slate-100">
                                        <tr>
                                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Sản phẩm hiện tại</th>
                                            <th className="w-10 px-0 py-3 text-center" />
                                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Sản phẩm thay thế</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {selectedItems.map((item) => {
                                            const replacement = replacementMap[item.line_id];
                                            const hasReplacement = !!replacement;
                                            const isLoading = loading;

                                            return (
                                                <tr key={item.line_id} className="hover:bg-slate-50/70 transition-colors">
                                                    {/* Source item */}
                                                    <td className="px-4 py-3.5">
                                                        <div className="flex flex-col gap-1">
                                                            <p className="text-[13px] font-bold text-slate-700 leading-snug">{item.name}</p>
                                                            <p className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                                                                <span className="material-symbols-outlined text-[13px]">barcode</span>
                                                                {item.sku}
                                                            </p>
                                                        </div>
                                                    </td>

                                                    {/* Arrow */}
                                                    <td className="px-0 py-3.5 text-center">
                                                        <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                                                            hasReplacement
                                                                ? 'bg-green-50 text-green-500'
                                                                : isLoading
                                                                    ? 'bg-slate-50 text-slate-300 animate-pulse'
                                                                    : 'bg-slate-50 text-slate-200'
                                                        }`}>
                                                            <span className="material-symbols-outlined text-[16px]">
                                                                {hasReplacement ? 'check_circle' : 'chevron_right'}
                                                            </span>
                                                        </div>
                                                    </td>

                                                    {/* Replacement */}
                                                    <td className="px-4 py-3.5">
                                                        {hasReplacement ? (
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="text-[13px] font-bold text-primary leading-snug">
                                                                        {replacement.display_name || replacement.name}
                                                                    </p>
                                                                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-600">Đã khớp</span>
                                                                </div>
                                                                <p className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
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
                                                            </div>
                                                        ) : isLoading ? (
                                                            <div className="space-y-2">
                                                                <div className="h-3 w-36 animate-pulse rounded bg-slate-100" />
                                                                <div className="h-2.5 w-24 animate-pulse rounded bg-slate-100" />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5 text-rose-400 italic">
                                                                <span className="material-symbols-outlined text-[15px]">error</span>
                                                                <span className="text-[12px] font-medium">
                                                                    {errors[item.line_id] || 'Không tìm thấy mẫu tương ứng'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
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
