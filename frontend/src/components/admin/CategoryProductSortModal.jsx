import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { normalizeCategoryAssignmentSearchValue } from '../../utils/categoryAssignments';
import { formatWholeMoneyInput } from '../../utils/money';

const buildProductSearchValue = (product) => normalizeCategoryAssignmentSearchValue(
    product?.search_text
        || [
            product?.name,
            product?.sku,
            product?.product_id,
            product?.admin_product_id,
            product?.category_name,
            product?.bundle_parent_name,
            product?.bundle_option_title,
            product?.variant_parent_name,
        ].filter((value) => value !== null && value !== undefined && value !== '').join(' ')
);

const resolveDisplayBadgeClasses = (product) => {
    if (product?.item_type === 'bundle_option') {
        return 'bg-amber-100 text-amber-700';
    }

    if (product?.display_type === 'variant' || product?.is_variant_child) {
        return 'bg-emerald-100 text-emerald-700';
    }

    if (product?.product_type === 'bundle') {
        return 'bg-primary/10 text-primary';
    }

    return 'bg-stone-100 text-stone-600';
};

const formatCategoryItemPrice = (item) => {
    const value = item?.current_price ?? item?.bundle_option_discounted_price ?? item?.price;
    const formatted = formatWholeMoneyInput(value);

    return formatted ? `${formatted} VND` : '';
};

const canRemoveCategoryProduct = (product = {}) => (
    product?.is_removable !== false
    && !(product?.item_type === 'product' && product?.is_primary_category)
);

const getCategoryProductRemoveTitle = (product = {}) => (
    canRemoveCategoryProduct(product)
        ? 'Go khoi danh muc'
        : 'San pham dang la danh muc chinh nen khong the go tai day'
);

const CategoryProductSortRow = ({
    product,
    index,
    total,
    draftPosition,
    isDragging,
    isDropTarget,
    disabled,
    onDraftPositionChange,
    onPositionCommit,
    onDragStart,
    onDragEnter,
    onDrop,
    onDragEnd,
    onMoveUp,
    onMoveDown,
    onRemove,
}) => {
    const currentPosition = index + 1;
    const productKey = product.assignment_key || product.id;
    const priceText = product.item_type === 'bundle_option' ? formatCategoryItemPrice(product) : '';
    const optionKeyText = product.option_key_display || product.bundle_option_key || '';
    const canRemove = canRemoveCategoryProduct(product);

    return (
        <tr
            draggable={!disabled}
            onDragStart={() => {
                if (!disabled) {
                    onDragStart(productKey);
                }
            }}
            onDragEnter={(event) => {
                if (disabled) {
                    return;
                }

                event.preventDefault();
                onDragEnter(productKey);
            }}
            onDragOver={(event) => {
                if (!disabled) {
                    event.preventDefault();
                }
            }}
            onDrop={(event) => {
                if (disabled) {
                    return;
                }

                event.preventDefault();
                onDrop(productKey);
            }}
            onDragEnd={onDragEnd}
            className={`border-b border-gold/10 align-top transition-colors ${
                isDropTarget ? 'bg-primary/5' : 'hover:bg-gold/5'
            } ${isDragging ? 'opacity-40' : ''}`}
        >
            <td className="px-3 py-3">
                <div className="flex items-center justify-center text-stone/40">
                    <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
                </div>
            </td>
            <td className="px-3 py-3 text-center">
                <span className="inline-flex min-w-12 items-center justify-center rounded-full bg-stone/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-stone/70">
                    #{currentPosition}
                </span>
            </td>
            <td className="px-3 py-3">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-gold/10 text-primary">
                        {product.main_image ? (
                            <img
                                src={product.main_image}
                                alt={product.name}
                                className="h-full w-full rounded-sm object-cover"
                            />
                        ) : (
                            <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                to={`/admin/products/edit/${product.admin_product_id || product.product_id}`}
                                className="truncate text-[13px] font-bold text-primary transition-colors hover:text-umber"
                            >
                                {product.item_type === 'bundle_option'
                                    ? (product.bundle_option_title || product.name)
                                    : product.name}
                            </Link>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${resolveDisplayBadgeClasses(product)}`}>
                                {product.display_label || 'San pham'}
                            </span>
                            {product.is_primary_category && product.item_type === 'product' ? (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-primary">
                                    Danh muc chinh
                                </span>
                            ) : product.item_type === 'product' ? (
                                <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700">
                                    Gan them
                                </span>
                            ) : null}
                            {!product.status ? (
                                <span className="rounded-full bg-brick/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-brick">
                                    Dang an
                                </span>
                            ) : null}
                        </div>
                        {product.item_type === 'bundle_option' ? (
                            <p className="mt-1 text-[11px] font-semibold text-primary/70">
                                Bundle: {product.bundle_parent_name || 'San pham bundle'}
                            </p>
                        ) : product.variant_parent_name ? (
                            <p className="mt-1 text-[11px] font-semibold text-primary/70">
                                Thuoc: {product.variant_parent_name}
                            </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-stone/55">
                            <span>SKU: {product.display_sku || product.sku || '--'}</span>
                            {product.item_type === 'bundle_option' ? (
                                <span>Option: {optionKeyText || '--'}</span>
                            ) : null}
                            {priceText ? <span>Gia sau giam: {priceText}</span> : null}
                            <span>ID: {product.product_id || product.admin_product_id || '--'}</span>
                            {product.item_type === 'bundle_option' && product.bundle_items_count > 0 ? (
                                <span>{product.bundle_items_count} thanh phan</span>
                            ) : null}
                            {product.category_name ? <span>Chinh: {product.category_name}</span> : null}
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        min="1"
                        max={total}
                        value={draftPosition ?? String(currentPosition)}
                        onChange={(event) => onDraftPositionChange(productKey, event.target.value)}
                        onBlur={() => onPositionCommit(productKey)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                onPositionCommit(productKey);
                            }
                        }}
                        disabled={disabled}
                        className="h-10 w-20 rounded-sm border border-gold/15 bg-white px-3 text-center text-[13px] font-bold text-primary outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:bg-stone-100"
                    />
                    <span className="text-[10px] text-stone/50">
                        Nhap so roi nhan Enter
                    </span>
                </div>
            </td>
            <td className="px-3 py-3">
                <div className="flex items-center justify-center gap-1">
                    <button
                        type="button"
                        onClick={() => onRemove(productKey)}
                        disabled={disabled || !canRemove}
                        className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-brick hover:text-brick disabled:cursor-not-allowed disabled:opacity-30"
                        title={getCategoryProductRemoveTitle(product)}
                    >
                        <span className="material-symbols-outlined text-[16px]">remove_circle</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onMoveUp(productKey)}
                        disabled={disabled || index === 0}
                        className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Dua len"
                    >
                        <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onMoveDown(productKey)}
                        disabled={disabled || index === total - 1}
                        className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Dua xuong"
                    >
                        <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                    </button>
                </div>
            </td>
        </tr>
    );
};

const CategoryProductSortModal = ({
    open,
    onClose,
    category,
    products,
    isLoading,
    isSaving,
    isDirty,
    draggingProductId,
    dragOverProductId,
    onDragStart,
    onDragEnter,
    onDrop,
    onDragEnd,
    onMoveUp,
    onMoveDown,
    onMoveToPosition,
    onRemove,
    onRefresh,
    onReset,
    onSave,
}) => {
    const [positionDrafts, setPositionDrafts] = useState({});
    const [searchQuery, setSearchQuery] = useState('');

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

    useEffect(() => {
        if (!open) {
            return;
        }

        setPositionDrafts(
            Object.fromEntries(
                products.map((product, index) => [product.assignment_key || product.id, String(index + 1)]),
            ),
        );
    }, [products, open]);

    useEffect(() => {
        setSearchQuery('');
    }, [open, category?.id]);

    if (!open) {
        return null;
    }

    const isBusy = isLoading || isSaving;
    const categoryName = category?.name || 'Danh muc';
    const totalProducts = products.length;
    const normalizedSearchQuery = normalizeCategoryAssignmentSearchValue(searchQuery);
    const filteredProducts = normalizedSearchQuery
        ? products.filter((product) => buildProductSearchValue(product).includes(normalizedSearchQuery))
        : products;
    const productPositions = new Map(
        products.map((product, index) => [product.assignment_key || product.id, index]),
    );

    const handleClose = () => {
        onDragEnd();
        onClose();
    };

    const handlePositionCommit = (productId) => {
        const currentIndex = products.findIndex((product) => (product.assignment_key || product.id) === productId);
        if (currentIndex < 0) {
            return;
        }

        const fallbackValue = String(currentIndex + 1);
        const rawValue = positionDrafts[productId] ?? fallbackValue;
        const parsedValue = Number.parseInt(rawValue, 10);

        if (!Number.isFinite(parsedValue)) {
            setPositionDrafts((previous) => ({
                ...previous,
                [productId]: fallbackValue,
            }));
            return;
        }

        const nextPosition = Math.min(Math.max(parsedValue, 1), totalProducts);

        setPositionDrafts((previous) => ({
            ...previous,
            [productId]: String(nextPosition),
        }));
        onMoveToPosition(productId, nextPosition);
    };

    const helperText = isLoading
        ? 'Dang tai item...'
        : normalizedSearchQuery
            ? `Hien thi ${filteredProducts.length}/${totalProducts} item khop. Vi tri van la thu tu that trong danh muc.`
            : 'Nhap so thu tu roi nhan Enter de chuyen nhanh.';

    return (
        <div
            className="fixed inset-0 z-[1200] overflow-y-auto bg-primary/25 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    handleClose();
                }
            }}
        >
            <div className="mx-auto flex min-h-full max-w-6xl items-center justify-center">
                <div
                    className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-sm border border-gold/15 bg-white shadow-[0_30px_80px_rgba(17,24,39,0.22)]"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="border-b border-gold/10 bg-gold/5 px-6 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                                    <span className="material-symbols-outlined text-[18px]">table_rows</span>
                                    Bang sap xep san pham
                                </div>
                                <h3 className="mt-2 truncate text-xl font-black text-primary">
                                    {categoryName}
                                </h3>
                                <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-stone/60">
                                    Keo tha truc tiep trong bang hoac nhap so thu tu de dua item toi dung vi tri nhanh hon.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                    {isDirty ? totalProducts : (category?.items_count ?? category?.products_count ?? totalProducts)} item
                                </span>
                                {normalizedSearchQuery ? (
                                    <span className="rounded-full bg-gold/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">
                                        {filteredProducts.length} khop tim kiem
                                    </span>
                                ) : null}
                                {isDirty ? (
                                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">
                                        Chua luu thay doi
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                                        Da dong bo
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="mt-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <label className="text-[10px] font-black uppercase tracking-[0.16em] text-stone/55">
                                    Tim nhanh item
                                </label>
                                <div className="text-[11px] text-stone/55">
                                    {helperText}
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex h-11 items-center gap-2 rounded-sm border border-gold/15 bg-white px-3 shadow-sm shadow-gold/5">
                                        <span className="material-symbols-outlined text-[18px] text-stone/35">search</span>
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(event) => setSearchQuery(event.target.value)}
                                            placeholder="Tim theo ten, SKU, bien the hoac tuy chon bundle"
                                            autoComplete="off"
                                            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-stone/35"
                                        />
                                        {searchQuery ? (
                                            <button
                                                type="button"
                                                onClick={() => setSearchQuery('')}
                                                className="flex h-8 w-8 items-center justify-center rounded-full text-stone/45 transition-colors hover:bg-stone-100 hover:text-brick"
                                                title="Xoa tu khoa tim kiem"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-gold/15 bg-white p-1 shadow-sm shadow-gold/5 lg:flex-nowrap lg:shrink-0">
                                    <button
                                        type="button"
                                        onClick={onRefresh}
                                        disabled={isBusy}
                                        className="flex h-10 items-center gap-2 rounded-sm px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${isBusy ? 'animate-spin' : ''}`}>refresh</span>
                                        Tai lai
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onReset}
                                        disabled={!isDirty || isBusy}
                                        className="flex h-10 items-center gap-2 rounded-sm px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">history</span>
                                        Hoan tac
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onSave}
                                        disabled={!isDirty || isBusy}
                                        className="flex h-10 items-center gap-2 rounded-sm bg-brick px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-umber disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">save</span>
                                        {isSaving ? 'Dang luu' : 'Luu thay doi'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        className="flex h-10 items-center gap-2 rounded-sm px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:bg-primary/5 hover:text-primary"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                        Dong
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {isLoading ? (
                            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 opacity-50">
                                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary"></div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone/50">
                                    Dang tai item
                                </p>
                            </div>
                        ) : totalProducts === 0 ? (
                            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center opacity-60">
                                <span className="material-symbols-outlined text-[48px] text-stone/40">inventory</span>
                                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                    Danh muc nay chua co item
                                </p>
                                <p className="max-w-md text-[12px] leading-relaxed text-stone/55">
                                    Khi danh muc da duoc gan san pham, bien the hoac tuy chon bundle, bang sap xep se hien thi tai day.
                                </p>
                            </div>
                        ) : filteredProducts.length === 0 ? (
                            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center opacity-70">
                                <span className="material-symbols-outlined text-[48px] text-stone/40">search_off</span>
                                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                    Khong tim thay item phu hop
                                </p>
                                <p className="max-w-md text-[12px] leading-relaxed text-stone/55">
                                    Thu lai voi ten san pham, SKU hoac ten tuy chon bundle khac.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="flex h-10 items-center gap-2 rounded-sm border border-gold/15 px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:border-primary hover:text-primary"
                                >
                                    <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                                    Xoa tim kiem
                                </button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full border-collapse">
                                    <thead className="sticky top-0 z-10 bg-white">
                                        <tr className="border-b border-gold/10 text-left text-[10px] font-black uppercase tracking-[0.16em] text-stone/55">
                                            <th className="w-14 px-3 py-3 text-center">Keo</th>
                                            <th className="w-24 px-3 py-3 text-center">Vi tri</th>
                                            <th className="px-3 py-3">San pham</th>
                                            <th className="w-56 px-3 py-3">Nhap so thu tu</th>
                                            <th className="w-44 px-3 py-3 text-center">Tac vu</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredProducts.map((product) => {
                                            const productKey = product.assignment_key || product.id;

                                            return (
                                                <CategoryProductSortRow
                                                    key={productKey}
                                                    product={product}
                                                    index={productPositions.get(productKey) ?? 0}
                                                    total={totalProducts}
                                                    draftPosition={positionDrafts[productKey]}
                                                    isDragging={draggingProductId === productKey}
                                                    isDropTarget={dragOverProductId === productKey && draggingProductId !== productKey}
                                                    disabled={isBusy}
                                                    onDraftPositionChange={(productId, value) => {
                                                        setPositionDrafts((previous) => ({
                                                            ...previous,
                                                            [productId]: value,
                                                        }));
                                                    }}
                                                    onPositionCommit={handlePositionCommit}
                                                    onDragStart={onDragStart}
                                                    onDragEnter={onDragEnter}
                                                    onDrop={onDrop}
                                                    onDragEnd={onDragEnd}
                                                    onMoveUp={onMoveUp}
                                                    onMoveDown={onMoveDown}
                                                    onRemove={onRemove}
                                                />
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gold/10 bg-white px-6 py-4 text-[11px] text-stone/55">
                        Frontend se dung danh sach va thu tu nay sau khi ban bam <span className="font-black uppercase tracking-[0.12em] text-primary">Luu thay doi</span>.
                        {' '}
                        {normalizedSearchQuery ? 'Bang dang hien thi ban loc, nhung so vi tri van la thu tu that.' : ''}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CategoryProductSortModal;
