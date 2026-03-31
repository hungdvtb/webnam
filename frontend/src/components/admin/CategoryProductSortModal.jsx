import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

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
}) => {
    const currentPosition = index + 1;

    return (
        <tr
            draggable={!disabled}
            onDragStart={() => {
                if (!disabled) {
                    onDragStart(product.id);
                }
            }}
            onDragEnter={(event) => {
                if (disabled) {
                    return;
                }

                event.preventDefault();
                onDragEnter(product.id);
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
                onDrop(product.id);
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
                                to={`/admin/products/edit/${product.id}`}
                                className="truncate text-[13px] font-bold text-primary transition-colors hover:text-umber"
                            >
                                {product.name}
                            </Link>
                            {product.is_primary_category ? (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-primary">
                                    Danh mục chính
                                </span>
                            ) : (
                                <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700">
                                    Gắn thêm
                                </span>
                            )}
                            {!product.status ? (
                                <span className="rounded-full bg-brick/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-brick">
                                    Đang ẩn
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-stone/55">
                            <span>SKU: {product.sku || '--'}</span>
                            <span>ID: {product.id}</span>
                            {product.category_name ? <span>Chính: {product.category_name}</span> : null}
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
                        onChange={(event) => onDraftPositionChange(product.id, event.target.value)}
                        onBlur={() => onPositionCommit(product.id)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                onPositionCommit(product.id);
                            }
                        }}
                        disabled={disabled}
                        className="h-10 w-20 rounded-sm border border-gold/15 bg-white px-3 text-center text-[13px] font-bold text-primary outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:bg-stone-100"
                    />
                    <span className="text-[10px] text-stone/50">
                        Nhập số rồi nhấn Enter
                    </span>
                </div>
            </td>
            <td className="px-3 py-3">
                <div className="flex items-center justify-center gap-1">
                    <button
                        type="button"
                        onClick={() => onMoveUp(product.id)}
                        disabled={disabled || index === 0}
                        className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Đưa lên"
                    >
                        <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onMoveDown(product.id)}
                        disabled={disabled || index === total - 1}
                        className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Đưa xuống"
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
    onRefresh,
    onReset,
    onSave,
}) => {
    const [positionDrafts, setPositionDrafts] = useState({});

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
                products.map((product, index) => [product.id, String(index + 1)]),
            ),
        );
    }, [products, open]);

    if (!open) {
        return null;
    }

    const isBusy = isLoading || isSaving;
    const categoryName = category?.name || 'Danh mục';
    const totalProducts = products.length;

    const handleClose = () => {
        onDragEnd();
        onClose();
    };

    const handlePositionCommit = (productId) => {
        const currentIndex = products.findIndex((product) => product.id === productId);
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
                                    Bảng sắp xếp sản phẩm
                                </div>
                                <h3 className="mt-2 truncate text-xl font-black text-primary">
                                    {categoryName}
                                </h3>
                                <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-stone/60">
                                    Kéo thả trực tiếp trong bảng hoặc nhập số thứ tự để đưa sản phẩm tới đúng vị trí nhanh hơn.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                    {category?.products_count ?? totalProducts} sản phẩm
                                </span>
                                {isDirty ? (
                                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">
                                        Chưa lưu thay đổi
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                                        Đã đồng bộ
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-[11px] text-stone/55">
                                {isLoading ? 'Đang tải sản phẩm...' : 'Nhập số thứ tự rồi nhấn Enter để chuyển nhanh.'}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={onRefresh}
                                    disabled={isBusy}
                                    className="flex h-10 items-center gap-2 rounded-sm border border-gold/15 px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <span className={`material-symbols-outlined text-[16px] ${isBusy ? 'animate-spin' : ''}`}>refresh</span>
                                    Tải lại
                                </button>
                                <button
                                    type="button"
                                    onClick={onReset}
                                    disabled={!isDirty || isBusy}
                                    className="flex h-10 items-center gap-2 rounded-sm border border-gold/15 px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[16px]">history</span>
                                    Hoàn tác
                                </button>
                                <button
                                    type="button"
                                    onClick={onSave}
                                    disabled={!isDirty || isBusy}
                                    className="flex h-10 items-center gap-2 rounded-sm bg-brick px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-umber disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[16px]">save</span>
                                    {isSaving ? 'Đang lưu' : 'Lưu thứ tự'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="flex h-10 items-center gap-2 rounded-sm border border-gold/15 px-3 text-[11px] font-black uppercase tracking-[0.12em] text-stone/70 transition-colors hover:border-primary hover:text-primary"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                    Đóng
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {isLoading ? (
                            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 opacity-50">
                                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary"></div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone/50">
                                    Đang tải sản phẩm
                                </p>
                            </div>
                        ) : totalProducts === 0 ? (
                            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center opacity-60">
                                <span className="material-symbols-outlined text-[48px] text-stone/40">inventory</span>
                                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                    Danh mục này chưa có sản phẩm
                                </p>
                                <p className="max-w-md text-[12px] leading-relaxed text-stone/55">
                                    Khi danh mục đã được gắn sản phẩm, bảng sắp xếp sẽ hiển thị tại đây để bạn kéo thả hoặc nhập số thứ tự.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full border-collapse">
                                    <thead className="sticky top-0 z-10 bg-white">
                                        <tr className="border-b border-gold/10 text-left text-[10px] font-black uppercase tracking-[0.16em] text-stone/55">
                                            <th className="w-14 px-3 py-3 text-center">Kéo</th>
                                            <th className="w-24 px-3 py-3 text-center">Vị trí</th>
                                            <th className="px-3 py-3">Sản phẩm</th>
                                            <th className="w-56 px-3 py-3">Nhập số thứ tự</th>
                                            <th className="w-32 px-3 py-3 text-center">Tác vụ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {products.map((product, index) => (
                                            <CategoryProductSortRow
                                                key={product.id}
                                                product={product}
                                                index={index}
                                                total={totalProducts}
                                                draftPosition={positionDrafts[product.id]}
                                                isDragging={draggingProductId === product.id}
                                                isDropTarget={dragOverProductId === product.id && draggingProductId !== product.id}
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
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gold/10 bg-white px-6 py-4 text-[11px] text-stone/55">
                        Frontend sẽ dùng đúng thứ tự này sau khi bạn bấm <span className="font-black uppercase tracking-[0.12em] text-primary">Lưu thứ tự</span>.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CategoryProductSortModal;
