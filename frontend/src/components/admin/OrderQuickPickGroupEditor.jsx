import React, { useEffect, useMemo, useState } from 'react';
import { productApi } from '../../services/api';
import {
    ORDER_QUICK_PICK_MAX_ITEMS,
    getOrderQuickPickAttribute,
    getOrderQuickPickAttributeOptions,
    getOrderQuickPickGroupLabel,
    normalizeOrderQuickPickItems,
} from '../../utils/orderQuickPickGroups';

const groupInputClassName = 'w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20';

const normalizeText = (value) => String(value ?? '').trim();
const normalizeMatchValue = (value) => normalizeText(value).toLocaleLowerCase('vi');

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

const getProductAttributeValues = (product, excludedAttributeId = null) => {
    const attributeValues = Array.isArray(product?.attribute_values) ? product.attribute_values : [];

    return Array.from(new Set(
        attributeValues
            .filter((attributeValue) => (
                excludedAttributeId == null
                    ? true
                    : String(attributeValue?.attribute_id) !== String(excludedAttributeId)
            ))
            .flatMap((attributeValue) => parseAttributeValueList(attributeValue?.value))
            .filter(Boolean)
    ));
};

const buildOptionLabel = (product, excludedAttributeId = null) => {
    const attributeValues = getProductAttributeValues(product, excludedAttributeId);
    if (attributeValues.length > 0) {
        return attributeValues.join(' / ');
    }

    return normalizeText(product?.name);
};

const buildDisplayName = (parentProduct, targetProduct, type, excludedAttributeId = null) => {
    const parentName = normalizeText(parentProduct?.name);
    const targetName = normalizeText(targetProduct?.name);

    if (type !== 'variation') {
        return targetName || parentName;
    }

    const optionLabel = buildOptionLabel(targetProduct, excludedAttributeId);
    if (!parentName) return optionLabel || targetName;
    if (!optionLabel) return parentName;
    if (normalizeMatchValue(optionLabel) === normalizeMatchValue(parentName)) return parentName;

    return `${parentName} - ${optionLabel}`;
};

const createQuickPickItem = (parentProduct, targetProduct, type, excludedAttributeId = null) => ({
    id: `order-quick-pick-item-${targetProduct.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    target_product_id: Number(targetProduct.id),
    parent_product_id: type === 'variation' ? Number(parentProduct?.id || 0) || null : null,
    type,
    display_name: buildDisplayName(parentProduct, targetProduct, type, excludedAttributeId),
    display_sku: normalizeText(targetProduct?.sku || parentProduct?.sku),
    option_label: type === 'variation' ? buildOptionLabel(targetProduct, excludedAttributeId) : '',
    main_image: normalizeText(parentProduct?.main_image || targetProduct?.main_image),
    price: Number(targetProduct?.price ?? 0) || 0,
    cost_price: Number(targetProduct?.cost_price ?? 0) || 0,
    order: 999,
});

const OrderQuickPickGroupEditor = ({
    group,
    attributes,
    onChange,
    onMove,
    onRemove,
    showModal,
    disableMoveUp = false,
    disableMoveDown = false,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);

    const groupAttribute = useMemo(
        () => getOrderQuickPickAttribute(attributes, group?.attribute_id),
        [attributes, group?.attribute_id]
    );
    const attributeOptions = useMemo(
        () => getOrderQuickPickAttributeOptions(attributes, group?.attribute_id),
        [attributes, group?.attribute_id]
    );
    const selectedProductIds = useMemo(
        () => new Set((group?.items || []).map((item) => Number(item?.target_product_id)).filter(Boolean)),
        [group?.items]
    );
    const canSearch = Boolean(group?.attribute_id) && Boolean(group?.attribute_value);

    useEffect(() => {
        const timerId = window.setTimeout(() => {
            setDebouncedSearchTerm(searchTerm.trim());
        }, 250);

        return () => window.clearTimeout(timerId);
    }, [searchTerm]);

    useEffect(() => {
        if (!canSearch || debouncedSearchTerm.length < 2) {
            setSearchResults([]);
            setSearching(false);
            return undefined;
        }

        let cancelled = false;
        const params = {
            per_page: 12,
            picker: 1,
            search: debouncedSearchTerm,
            [`attributes[${group.attribute_id}]`]: group.attribute_value,
        };

        setSearching(true);

        productApi.getAll(params)
            .then((response) => {
                if (cancelled) return;
                setSearchResults(Array.isArray(response.data?.data) ? response.data.data : []);
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Error fetching quick pick products', error);
                setSearchResults([]);
            })
            .finally(() => {
                if (!cancelled) {
                    setSearching(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [canSearch, debouncedSearchTerm, group.attribute_id, group.attribute_value]);

    const updateGroup = (patch) => {
        onChange({
            ...group,
            ...patch,
        });
    };

    const handleAttributeChange = (event) => {
        const nextAttributeId = String(event.target.value || '');
        const nextOptions = getOrderQuickPickAttributeOptions(attributes, nextAttributeId);

        updateGroup({
            attribute_id: nextAttributeId,
            attribute_value: String(nextOptions[0]?.value || ''),
            items: [],
        });
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleAttributeValueChange = (event) => {
        updateGroup({
            attribute_value: String(event.target.value || ''),
            items: [],
        });
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleAddItem = (item) => {
        const targetProductId = Number(item?.target_product_id);
        if (!Number.isFinite(targetProductId) || targetProductId <= 0) return;

        if (selectedProductIds.has(targetProductId)) {
            showModal({
                title: 'Đã tồn tại',
                content: 'Sản phẩm này đã có trong nhóm chọn nhanh.',
                type: 'info',
            });
            return;
        }

        if ((group?.items || []).length >= ORDER_QUICK_PICK_MAX_ITEMS) {
            showModal({
                title: 'Đã đạt giới hạn',
                content: `Mỗi nhóm chỉ nên có tối đa ${ORDER_QUICK_PICK_MAX_ITEMS} sản phẩm hay dùng.`,
                type: 'warning',
            });
            return;
        }

        updateGroup({
            items: normalizeOrderQuickPickItems([...(group?.items || []), item]),
        });
    };

    const handleRemoveItem = (itemId) => {
        updateGroup({
            items: normalizeOrderQuickPickItems((group?.items || []).filter((item) => item.id !== itemId)),
        });
    };

    const handleMoveItem = (itemId, direction) => {
        const items = [...(group?.items || [])];
        const currentIndex = items.findIndex((item) => item.id === itemId);
        if (currentIndex === -1) return;

        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= items.length) return;

        const [picked] = items.splice(currentIndex, 1);
        items.splice(nextIndex, 0, picked);

        updateGroup({
            items: normalizeOrderQuickPickItems(items),
        });
    };

    return (
        <div className="rounded-sm border border-primary/10 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 bg-primary/[0.02] px-5 py-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/35">Nhóm chọn nhanh</p>
                    <h3 className="text-[16px] font-black text-primary leading-tight truncate">
                        {getOrderQuickPickGroupLabel(group, attributes)}
                    </h3>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onMove('up')}
                        disabled={disableMoveUp}
                        className="size-9 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04] disabled:opacity-35 disabled:cursor-not-allowed"
                        title="Di chuyển lên"
                    >
                        <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onMove('down')}
                        disabled={disableMoveDown}
                        className="size-9 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04] disabled:opacity-35 disabled:cursor-not-allowed"
                        title="Di chuyển xuống"
                    >
                        <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                    </button>
                    <button
                        type="button"
                        onClick={onRemove}
                        className="size-9 rounded-sm border border-brick/20 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all"
                        title="Xóa nhóm"
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>
            </div>

            <div className="space-y-5 p-5">
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,220px)_minmax(0,220px)_minmax(0,1fr)] gap-4">
                    <div>
                        <label className="text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block">Thuộc tính lọc</label>
                        <select
                            value={group?.attribute_id || ''}
                            onChange={handleAttributeChange}
                            className={groupInputClassName}
                        >
                            {attributes.map((attribute) => (
                                <option key={attribute.id} value={attribute.id}>
                                    {attribute.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block">Giá trị áp dụng</label>
                        <select
                            value={group?.attribute_value || ''}
                            onChange={handleAttributeValueChange}
                            className={groupInputClassName}
                            disabled={attributeOptions.length === 0}
                        >
                            {attributeOptions.length > 0 ? attributeOptions.map((option) => (
                                <option key={`${group?.attribute_id || 'attribute'}-${option.id || option.value}`} value={option.value}>
                                    {option.value}
                                </option>
                            )) : (
                                <option value="">Chưa có giá trị</option>
                            )}
                        </select>
                    </div>

                    <div>
                        <label className="text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block">
                            Tìm sản phẩm cho nhóm này
                        </label>
                        <div className="flex items-center gap-2 rounded-sm border border-dashed border-primary/20 bg-primary/[0.02] px-3 h-10">
                            <span className="material-symbols-outlined text-[16px] text-primary/35">search</span>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder={canSearch ? 'Gõ mã hoặc tên sản phẩm...' : 'Chọn thuộc tính và giá trị trước'}
                                className="w-full bg-transparent text-[13px] font-semibold text-primary placeholder:text-primary/25 focus:outline-none"
                                disabled={!canSearch}
                            />
                            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/35">
                                {(group?.items || []).length}/{ORDER_QUICK_PICK_MAX_ITEMS}
                            </span>
                        </div>
                        {groupAttribute && (
                            <p className="mt-2 text-[11px] text-primary/45 leading-5">
                                Kết quả tìm kiếm sẽ tự lọc theo <strong className="font-black">{groupAttribute.name}</strong> = <strong className="font-black">{group?.attribute_value || '...'}</strong>.
                            </p>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-5">
                    <div className="rounded-sm border border-primary/10 bg-primary/[0.02]">
                        <div className="flex items-center justify-between gap-3 border-b border-primary/10 px-4 py-3">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Nguồn thêm sản phẩm</p>
                                <h4 className="text-[13px] font-black text-primary">Kết quả tìm kiếm</h4>
                            </div>
                            {searching && (
                                <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-primary/45">
                                    <span className="size-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                                    Đang tải
                                </div>
                            )}
                        </div>

                        <div className="max-h-[420px] overflow-y-auto custom-scrollbar p-4 space-y-3">
                            {!canSearch && (
                                <div className="rounded-sm border border-dashed border-primary/15 bg-white px-4 py-8 text-center text-[12px] italic text-primary/35">
                                    Chọn thuộc tính và giá trị trước khi thêm sản phẩm.
                                </div>
                            )}

                            {canSearch && debouncedSearchTerm.length < 2 && (
                                <div className="rounded-sm border border-dashed border-primary/15 bg-white px-4 py-8 text-center text-[12px] italic text-primary/35">
                                    Gõ ít nhất 2 ký tự để tìm sản phẩm phù hợp cho nhóm này.
                                </div>
                            )}

                            {canSearch && debouncedSearchTerm.length >= 2 && !searching && searchResults.length === 0 && (
                                <div className="rounded-sm border border-dashed border-primary/15 bg-white px-4 py-8 text-center text-[12px] italic text-primary/35">
                                    Không tìm thấy sản phẩm phù hợp với bộ lọc hiện tại.
                                </div>
                            )}

                            {searchResults.map((product) => {
                                const hasVariations = Array.isArray(product?.variations) && product.variations.length > 0;
                                const showBaseAddButton = !(String(product?.type || '') === 'configurable' && hasVariations);
                                const baseProductSelected = selectedProductIds.has(Number(product.id));

                                return (
                                    <div key={product.id} className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="size-14 rounded-sm bg-primary/5 border border-primary/10 overflow-hidden shrink-0 flex items-center justify-center">
                                                {product.main_image ? (
                                                    <img src={product.main_image} alt="" className="size-full object-cover" />
                                                ) : (
                                                    <span className="material-symbols-outlined text-primary/20">image</span>
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-[12px] font-black text-primary truncate">{product.sku || '---'}</p>
                                                        <h5 className="text-[13px] font-bold text-[#0F172A] leading-5">{product.name || '---'}</h5>
                                                        <p className="mt-1 text-[11px] font-semibold text-blue-600">
                                                            {new Intl.NumberFormat('vi-VN').format(Number(product.price || 0))}đ
                                                        </p>
                                                    </div>

                                                    {showBaseAddButton ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAddItem(createQuickPickItem(product, product, 'product', group?.attribute_id))}
                                                            disabled={baseProductSelected}
                                                            className={`h-9 px-3 rounded-sm text-[11px] font-black uppercase tracking-[0.12em] transition-all ${baseProductSelected ? 'border border-green-200 bg-green-50 text-green-700 cursor-not-allowed' : 'bg-primary text-white hover:bg-primary/90'}`}
                                                        >
                                                            {baseProductSelected ? 'Đã chọn' : 'Thêm nhanh'}
                                                        </button>
                                                    ) : (
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/35">
                                                            Chọn 1 size bên dưới
                                                        </div>
                                                    )}
                                                </div>

                                                {hasVariations && (
                                                    <div className="mt-3 rounded-sm border border-primary/10 bg-primary/[0.02] p-3">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">
                                                            Size / phiên bản dùng nhanh
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {product.variations.map((variation) => {
                                                                const variationItem = createQuickPickItem(product, variation, 'variation', group?.attribute_id);
                                                                const variationSelected = selectedProductIds.has(Number(variation.id));

                                                                return (
                                                                    <button
                                                                        key={`${product.id}-${variation.id}`}
                                                                        type="button"
                                                                        onClick={() => handleAddItem(variationItem)}
                                                                        disabled={variationSelected}
                                                                        className={`rounded-sm border px-3 py-2 text-left transition-all ${variationSelected ? 'border-green-200 bg-green-50 text-green-700 cursor-not-allowed' : 'border-primary/10 bg-white text-primary hover:border-primary/25 hover:bg-primary/5'}`}
                                                                    >
                                                                        <div className="text-[11px] font-black">{variationItem.option_label || variationItem.display_sku || 'Phiên bản'}</div>
                                                                        <div className="mt-1 text-[10px] font-semibold text-primary/55">{variationItem.display_sku || product.sku || '---'}</div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-sm border border-primary/10 bg-primary/[0.02]">
                        <div className="border-b border-primary/10 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Danh sách đang dùng</p>
                            <h4 className="text-[13px] font-black text-primary">SP hay dùng của nhóm này</h4>
                        </div>

                        <div className="max-h-[420px] overflow-y-auto custom-scrollbar p-4 space-y-3">
                            {(group?.items || []).length === 0 ? (
                                <div className="rounded-sm border border-dashed border-primary/15 bg-white px-4 py-8 text-center text-[12px] italic text-primary/35">
                                    Chưa có sản phẩm nào. Tìm ở khung bên trái rồi bấm thêm.
                                </div>
                            ) : (
                                (group.items || []).map((item, index) => (
                                    <div key={item.id} className="rounded-sm border border-primary/10 bg-white px-3 py-3 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="size-12 rounded-sm bg-primary/5 border border-primary/10 overflow-hidden shrink-0 flex items-center justify-center">
                                                {item.main_image ? (
                                                    <img src={item.main_image} alt="" className="size-full object-cover" />
                                                ) : (
                                                    <span className="material-symbols-outlined text-primary/20">image</span>
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">
                                                        Mục #{index + 1}
                                                    </p>
                                                    <span className="text-[11px] font-black text-blue-600">
                                                        {new Intl.NumberFormat('vi-VN').format(Number(item.price || 0))}đ
                                                    </span>
                                                </div>
                                                <h5 className="mt-1 text-[13px] font-bold text-[#0F172A] leading-5">
                                                    {item.display_name || item.name || '---'}
                                                </h5>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <span className="text-[11px] font-semibold text-primary/55">{item.display_sku || item.sku || '---'}</span>
                                                    {item.option_label && (
                                                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/70">
                                                            {item.option_label}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleMoveItem(item.id, 'up')}
                                                disabled={index === 0}
                                                className="size-8 rounded-sm border border-primary/15 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04] disabled:opacity-35 disabled:cursor-not-allowed"
                                                title="Đưa lên"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleMoveItem(item.id, 'down')}
                                                disabled={index === (group.items || []).length - 1}
                                                className="size-8 rounded-sm border border-primary/15 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04] disabled:opacity-35 disabled:cursor-not-allowed"
                                                title="Đưa xuống"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveItem(item.id)}
                                                className="size-8 rounded-sm border border-brick/20 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all"
                                                title="Xóa khỏi nhóm"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderQuickPickGroupEditor;
