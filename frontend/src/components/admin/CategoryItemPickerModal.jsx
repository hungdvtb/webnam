import React, { useEffect } from 'react';

const resolveBadgeClasses = (item) => {
    if (item?.item_type === 'bundle_option') {
        return 'bg-amber-100 text-amber-700';
    }

    if (item?.display_type === 'variant' || item?.is_variant_child) {
        return 'bg-emerald-100 text-emerald-700';
    }

    if (item?.product_type === 'bundle') {
        return 'bg-primary/10 text-primary';
    }

    return 'bg-stone-100 text-stone-600';
};

const renderBundleSummary = (item) => {
    const summaries = Array.isArray(item?.bundle_items_summary)
        ? item.bundle_items_summary.filter((summary) => summary?.name || summary?.sku)
        : [];

    if (summaries.length === 0) {
        return null;
    }

    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {summaries.slice(0, 4).map((summary, index) => (
                <span
                    key={`${item.assignment_key}-summary-${index}`}
                    className="inline-flex max-w-full items-center rounded-full bg-gold/10 px-2 py-1 text-[10px] font-bold text-amber-700"
                >
                    <span className="truncate">
                        {summary.name || 'San pham'}
                        {summary.sku ? ` • ${summary.sku}` : ''}
                    </span>
                </span>
            ))}
            {summaries.length > 4 ? (
                <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold text-stone-500">
                    +{summaries.length - 4}
                </span>
            ) : null}
        </div>
    );
};

const CategoryItemPickerRow = ({
    item,
    selectedMap,
    onToggleItem,
    depth = 0,
}) => {
    const selectedItem = selectedMap.get(item.assignment_key);
    const checked = selectedMap.has(item.assignment_key);
    const disabled = selectedItem?.is_removable === false;
    const leftPaddingClass = depth > 0 ? 'pl-12' : 'pl-4';
    const optionKeyText = item.option_key_display || item.bundle_option_key || '';

    return (
        <label
            className={`block cursor-pointer border-t border-gold/10 px-4 py-3 transition ${
                checked ? 'bg-primary/[0.04]' : 'hover:bg-gold/[0.04]'
            } ${disabled ? 'cursor-not-allowed opacity-80' : ''}`}
        >
            <div className={`flex items-start gap-3 ${leftPaddingClass}`}>
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggleItem(item)}
                    className="mt-1 size-4 accent-primary"
                />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-bold text-primary">
                            {item.item_type === 'bundle_option'
                                ? (item.bundle_option_title || item.name || 'Tuy chon bundle')
                                : (item.name || 'San pham')}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${resolveBadgeClasses(item)}`}>
                            {item.display_label}
                        </span>
                        {disabled ? (
                            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-stone-500">
                                Khoa boi danh muc chinh
                            </span>
                        ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-stone/55">
                        {item.item_type === 'bundle_option' ? (
                            <span>Bundle: {item.bundle_parent_name || 'San pham bundle'}</span>
                        ) : item.variant_parent_name ? (
                            <span>Cha: {item.variant_parent_name}</span>
                        ) : null}
                        {item.sku ? <span>SKU: {item.sku}</span> : null}
                        {item.item_type === 'bundle_option' && optionKeyText ? (
                            <span>Option: {optionKeyText}</span>
                        ) : null}
                        {item.item_type === 'bundle_option' && item.bundle_items_count > 0 ? (
                            <span>{item.bundle_items_count} thanh phan</span>
                        ) : null}
                    </div>

                    {item.item_type === 'bundle_option' ? renderBundleSummary(item) : null}
                </div>
            </div>
        </label>
    );
};

const CategoryItemPickerModal = ({
    open,
    onClose,
    searchQuery,
    onSearchChange,
    groups,
    selectedItemMap,
    onToggleItem,
    isLoading = false,
    minQueryLength = 2,
}) => {
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    const selectedCount = selectedItemMap.size;
    const trimmedQuery = String(searchQuery || '').trim();
    const needsMoreChars = trimmedQuery.length > 0 && trimmedQuery.length < minQueryLength;

    return (
        <div
            className="fixed inset-0 z-[1250] overflow-y-auto bg-primary/30 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="mx-auto flex min-h-full max-w-5xl items-center justify-center">
                <div
                    className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-sm border border-gold/15 bg-white shadow-[0_30px_80px_rgba(17,24,39,0.22)]"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="border-b border-gold/10 bg-gold/5 px-6 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                                    <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                                    Chon san pham cho danh muc
                                </div>
                                <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-stone/60">
                                    Tim theo ten san pham, SKU, ten bien the hoac ten tuy chon bundle. Tuy chon bundle duoc hien thi rieng de tranh gan nham voi san pham bundle cha.
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                    {selectedCount} item da chon
                                </span>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex h-10 items-center gap-2 rounded-sm border border-gold/15 px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:border-primary hover:text-primary"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                    Dong
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 flex h-11 items-center gap-2 rounded-sm border border-gold/15 bg-white px-3 shadow-sm shadow-gold/5">
                            <span className="material-symbols-outlined text-[18px] text-stone/35">search</span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => onSearchChange(event.target.value)}
                                placeholder="Tim ten san pham, SKU, bien the, tuy chon bundle..."
                                autoComplete="off"
                                className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-stone/35"
                            />
                            {searchQuery ? (
                                <button
                                    type="button"
                                    onClick={() => onSearchChange('')}
                                    className="flex h-8 w-8 items-center justify-center rounded-full text-stone/45 transition-colors hover:bg-stone-100 hover:text-brick"
                                    title="Xoa tu khoa tim kiem"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {trimmedQuery.length === 0 ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center opacity-65">
                                <span className="material-symbols-outlined text-[52px] text-stone/40">manage_search</span>
                                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                    Nhap tu khoa de tim item can gan
                                </p>
                                <p className="max-w-md text-[12px] leading-relaxed text-stone/55">
                                    Ban co the tim nhanh theo ten san pham, ma SKU, ten bien the va ten tuy chon bundle.
                                </p>
                            </div>
                        ) : needsMoreChars ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center opacity-70">
                                <span className="material-symbols-outlined text-[52px] text-stone/40">short_text</span>
                                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                    Nhap it nhat {minQueryLength} ky tu
                                </p>
                            </div>
                        ) : isLoading ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 opacity-50">
                                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary"></div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone/50">
                                    Dang tim item
                                </p>
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center opacity-70">
                                <span className="material-symbols-outlined text-[52px] text-stone/40">search_off</span>
                                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                    Khong tim thay ket qua phu hop
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gold/10">
                                {groups.map((group) => (
                                    <div key={group.product.assignment_key} className="bg-white">
                                        <div className="border-b border-gold/10 bg-stone/5 px-4 py-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                                                    {group.product.product_type === 'bundle'
                                                        ? 'Bundle'
                                                        : (group.product.product_type === 'configurable' ? 'San pham co bien the' : 'San pham')}
                                                </span>
                                                {group.variations.length > 0 ? (
                                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700">
                                                        {group.variations.length} bien the
                                                    </span>
                                                ) : null}
                                                {group.bundleOptions.length > 0 ? (
                                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700">
                                                        {group.bundleOptions.length} tuy chon bundle
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>

                                        <CategoryItemPickerRow
                                            item={group.product}
                                            selectedMap={selectedItemMap}
                                            onToggleItem={onToggleItem}
                                        />

                                        {group.variations.map((variation) => (
                                            <CategoryItemPickerRow
                                                key={variation.assignment_key}
                                                item={variation}
                                                selectedMap={selectedItemMap}
                                                onToggleItem={onToggleItem}
                                                depth={1}
                                            />
                                        ))}

                                        {group.bundleOptions.map((option) => (
                                            <CategoryItemPickerRow
                                                key={option.assignment_key}
                                                item={option}
                                                selectedMap={selectedItemMap}
                                                onToggleItem={onToggleItem}
                                                depth={1}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CategoryItemPickerModal;
