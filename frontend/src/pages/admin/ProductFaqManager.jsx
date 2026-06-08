import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { categoryApi, productApi, productFaqApi, productGroupApi } from '../../services/api';
import { resolveImageObjectUrl } from '../../utils/mediaUrl';

const STATUS_OPTIONS = [
    { value: 'visible', label: 'Hiển thị' },
    { value: 'hidden', label: 'Ẩn' },
];

const PRODUCT_FILTERS = [
    { value: 'all', label: 'Tất cả' },
    { value: 'with', label: 'Đã có FAQ' },
    { value: 'without', label: 'Chưa có FAQ' },
];

const blankForm = {
    id: null,
    product_id: '',
    product_ids: [],
    category_ids: [],
    product_group_ids: [],
    bundle_product_ids: [],
    apply_all_products: false,
    question: '',
    answer: '',
    youtube_url: '',
    sort_order: '',
    status: 'visible',
    images: [],
    newImages: [],
};

const normalizeCollection = (response) => {
    const payload = response?.data;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
};

const normalizeId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const uniqueIds = (values) => (
    Array.from(new Set((values || []).map(normalizeId).filter(Boolean)))
);

const addUniqueId = (values, id) => uniqueIds([...(values || []), id]);

const removeId = (values, id) => {
    const numericId = normalizeId(id);
    return uniqueIds(values).filter((value) => value !== numericId);
};

const hasId = (values, id) => {
    const numericId = normalizeId(id);
    return numericId ? uniqueIds(values).includes(numericId) : false;
};

const flattenCategories = (items, depth = 0) => (
    (items || []).flatMap((item) => {
        const row = {
            ...item,
            label: `${depth > 0 ? `${'— '.repeat(depth)}` : ''}${item.name || `Danh mục #${item.id}`}`,
        };

        return [row, ...flattenCategories(item.children || [], depth + 1)];
    })
);

const formatDateTime = (value) => {
    if (!value) return '';
    try {
        return new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).format(new Date(value));
    } catch {
        return value;
    }
};

const getStatusLabel = (status) => (
    STATUS_OPTIONS.find((option) => option.value === status)?.label || status || 'Không rõ'
);

const imageThumbUrl = (image) => resolveImageObjectUrl(image, 'thumbnail') || resolveImageObjectUrl(image, 'large');

const sortFaqs = (items) => [...items].sort((first, second) => (
    Number(first.sort_order ?? 0) - Number(second.sort_order ?? 0)
    || Number(first.id ?? 0) - Number(second.id ?? 0)
));

const upsertFaq = (items, faq) => {
    if (!faq?.id) return items;

    let found = false;
    const nextItems = items.map((item) => {
        if (Number(item.id) !== Number(faq.id)) return item;
        found = true;
        return faq;
    });

    if (!found) nextItems.push(faq);
    return sortFaqs(nextItems);
};

const productLabel = (product) => {
    if (!product) return '';
    return `${product.name || `Sản phẩm #${product.id}`}${product.sku ? ` - ${product.sku}` : ''}`;
};

const appendIds = (formData, key, values) => {
    uniqueIds(values).forEach((id) => formData.append(`${key}[]`, String(id)));
};

const firstTargetId = (form, previewProducts = [], selectedProductId = '') => (
    normalizeId(form.product_id)
    || normalizeId(previewProducts[0]?.id)
    || normalizeId(form.product_ids?.[0])
    || normalizeId(selectedProductId)
    || ''
);

export default function ProductFaqManager() {
    const [productPanelSearch, setProductPanelSearch] = useState('');
    const [productPanelFilter, setProductPanelFilter] = useState('with');
    const [faqProducts, setFaqProducts] = useState([]);
    const [loadingFaqProducts, setLoadingFaqProducts] = useState(false);

    const [targetSearch, setTargetSearch] = useState('');
    const [targetCategoryId, setTargetCategoryId] = useState('');
    const [targetProducts, setTargetProducts] = useState([]);
    const [loadingTargetProducts, setLoadingTargetProducts] = useState(false);
    const [categories, setCategories] = useState([]);
    const [productGroups, setProductGroups] = useState([]);

    const [selectedProductId, setSelectedProductId] = useState('');
    const [selectedProductInfo, setSelectedProductInfo] = useState(null);
    const [faqs, setFaqs] = useState([]);
    const [loadingFaqs, setLoadingFaqs] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [form, setForm] = useState(blankForm);
    const [targetPreview, setTargetPreview] = useState({ total: 0, data: [] });
    const [loadingTargetPreview, setLoadingTargetPreview] = useState(false);
    const [expandedTargetPanel, setExpandedTargetPanel] = useState(null);
    const [saving, setSaving] = useState(false);
    const [draggingId, setDraggingId] = useState(null);

    const selectedProduct = useMemo(() => (
        (selectedProductInfo && String(selectedProductInfo.id) === String(selectedProductId) ? selectedProductInfo : null)
        || faqProducts.find((product) => String(product.id) === String(selectedProductId))
        || null
    ), [faqProducts, selectedProductId, selectedProductInfo]);

    const selectedProductGroups = useMemo(() => (
        productGroups.filter((group) => hasId(form.product_group_ids, group.id))
    ), [productGroups, form.product_group_ids]);

    const targetPayload = useMemo(() => ({
        product_id: firstTargetId({
            product_id: form.product_id,
            product_ids: form.product_ids,
        }, [], selectedProductId),
        product_ids: uniqueIds(form.product_ids),
        category_ids: uniqueIds(form.category_ids),
        product_group_ids: uniqueIds(form.product_group_ids),
        bundle_product_ids: uniqueIds(form.bundle_product_ids),
        apply_all_products: Boolean(form.apply_all_products),
    }), [
        selectedProductId,
        form.product_id,
        form.apply_all_products,
        form.product_ids,
        form.category_ids,
        form.product_group_ids,
        form.bundle_product_ids,
    ]);

    const loadFaqProductPanel = (search = productPanelSearch, filter = productPanelFilter) => {
        setLoadingFaqProducts(true);
        return productFaqApi.adminProducts({
            search,
            faq_filter: filter,
            per_page: 60,
        })
            .then((response) => setFaqProducts(normalizeCollection(response)))
            .catch(() => setFaqProducts([]))
            .finally(() => setLoadingFaqProducts(false));
    };

    const loadFaqs = (productId = selectedProductId) => {
        if (!productId) {
            setFaqs([]);
            setSelectedProductInfo(null);
            return Promise.resolve([]);
        }

        setLoadingFaqs(true);
        setError('');
        return productFaqApi.adminList({ product_id: productId })
            .then((response) => {
                const payload = response?.data || {};
                const nextFaqs = Array.isArray(payload.data) ? payload.data : [];
                setFaqs(nextFaqs);
                setSelectedProductInfo(payload.product || null);
                return nextFaqs;
            })
            .catch((err) => {
                setFaqs([]);
                setSelectedProductInfo(null);
                setError(err?.response?.data?.message || 'Không thể tải danh sách hỏi đáp.');
                throw err;
            })
            .finally(() => setLoadingFaqs(false));
    };

    const loadTargetProducts = useCallback((search = '', categoryId = '') => {
        setLoadingTargetProducts(true);
        const params = { search, per_page: 20, summary: 1, parent_only: 1 };
        const normalizedCategoryId = normalizeId(categoryId);
        if (normalizedCategoryId) {
            params.category_id = normalizedCategoryId;
        }

        productApi.getAll(params)
            .then((response) => setTargetProducts(normalizeCollection(response)))
            .catch(() => setTargetProducts([]))
            .finally(() => setLoadingTargetProducts(false));
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            void loadFaqProductPanel(productPanelSearch, productPanelFilter);
        }, 250);
        return () => window.clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productPanelSearch, productPanelFilter]);

    useEffect(() => {
        void loadFaqs(selectedProductId).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedProductId]);

    useEffect(() => {
        categoryApi.getAll()
            .then((response) => setCategories(flattenCategories(normalizeCollection(response))))
            .catch(() => setCategories([]));

        productGroupApi.getAll()
            .then((response) => setProductGroups(normalizeCollection(response)))
            .catch(() => setProductGroups([]));
    }, []);

    useEffect(() => {
        if (!isFormOpen) return undefined;
        const timeoutId = window.setTimeout(() => loadTargetProducts(targetSearch, targetCategoryId), 250);
        return () => window.clearTimeout(timeoutId);
    }, [isFormOpen, targetSearch, targetCategoryId, loadTargetProducts]);

    useEffect(() => {
        if (!isFormOpen) return undefined;

        const hasAnyTarget = targetPayload.apply_all_products
            || targetPayload.product_ids.length > 0
            || targetPayload.category_ids.length > 0
            || targetPayload.product_group_ids.length > 0
            || targetPayload.bundle_product_ids.length > 0
            || normalizeId(targetPayload.product_id);

        if (!hasAnyTarget) {
            setTargetPreview({ total: 0, data: [] });
            return undefined;
        }

        setLoadingTargetPreview(true);
        const timeoutId = window.setTimeout(() => {
            productFaqApi.resolveTargets(targetPayload)
                .then((response) => {
                    const data = normalizeCollection(response);
                    setTargetPreview({
                        total: Number(response?.data?.total ?? data.length),
                        data,
                    });
                })
                .catch(() => setTargetPreview({ total: 0, data: [] }))
                .finally(() => setLoadingTargetPreview(false));
        }, 200);

        return () => window.clearTimeout(timeoutId);
    }, [
        isFormOpen,
        targetPayload,
    ]);

    const updateForm = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const selectProduct = (product) => {
        setSelectedProductId(String(product.id));
        setSelectedProductInfo(product);
        setMessage('');
        setError('');
    };

    const openCreateForm = () => {
        if (!selectedProductId) {
            setError('Chọn sản phẩm trước khi thêm hỏi đáp.');
            return;
        }

        setForm({
            ...blankForm,
            product_id: String(selectedProductId),
            product_ids: uniqueIds([selectedProductId]),
            sort_order: String(faqs.length + 1),
        });
        if (selectedProduct) {
            setTargetProducts((current) => (
                current.some((product) => Number(product.id) === Number(selectedProduct.id))
                    ? current
                    : [selectedProduct, ...current]
            ));
        }
        setTargetSearch('');
        setTargetCategoryId('');
        setTargetPreview({ total: 0, data: [] });
        setMessage('');
        setError('');
        setIsFormOpen(true);
    };

    const openEditForm = (faq) => {
        const appliedProducts = Array.isArray(faq.applied_products) ? faq.applied_products : [];
        const appliedIds = uniqueIds(
            Array.isArray(faq.applied_product_ids) && faq.applied_product_ids.length > 0
                ? faq.applied_product_ids
                : [faq.product_id || selectedProductId]
        );

        setForm({
            ...blankForm,
            id: faq.id || null,
            product_id: String(faq.product_id || appliedIds[0] || selectedProductId || ''),
            product_ids: appliedIds,
            question: faq.question || '',
            answer: faq.answer || '',
            youtube_url: faq.youtube_url || '',
            sort_order: String(faq.sort_order ?? ''),
            status: faq.status || 'visible',
            images: Array.isArray(faq.images) ? faq.images : [],
            newImages: [],
        });
        setTargetProducts((current) => {
            const merged = [...appliedProducts, ...(faq.product ? [faq.product] : []), ...current];
            const seen = new Set();
            return merged.filter((product) => {
                const id = normalizeId(product?.id);
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
        });
        setTargetSearch('');
        setTargetCategoryId('');
        setTargetPreview({ total: appliedProducts.length, data: appliedProducts });
        setMessage('');
        setError('');
        setIsFormOpen(true);
    };

    const closeForm = () => {
        setIsFormOpen(false);
        setForm(blankForm);
        setTargetPreview({ total: 0, data: [] });
        setExpandedTargetPanel(null);
    };

    const toggleTargetProduct = (product) => {
        const id = normalizeId(product?.id);
        if (!id) return;
        setTargetProducts((current) => (
            current.some((item) => Number(item.id) === id) ? current : [product, ...current]
        ));
        setForm((current) => ({
            ...current,
            product_id: hasId(current.product_ids, id)
                ? (normalizeId(current.product_id) === id ? String(removeId(current.product_ids, id)[0] || '') : current.product_id)
                : (current.product_id || String(id)),
            product_ids: hasId(current.product_ids, id)
                ? removeId(current.product_ids, id)
                : addUniqueId(current.product_ids, id),
        }));
    };

    const removeExistingImage = (index) => {
        setForm((current) => ({
            ...current,
            images: current.images.filter((_, imageIndex) => imageIndex !== index),
        }));
    };

    const clearTargets = () => {
        setForm((current) => ({
            ...current,
            product_ids: [],
            category_ids: [],
            product_group_ids: [],
            bundle_product_ids: [],
            apply_all_products: false,
            product_id: '',
        }));
    };

    const buildFormData = () => {
        const formData = new FormData();
        const primaryId = firstTargetId(form, targetPreview.data, selectedProductId);

        if (primaryId) {
            formData.append('product_id', String(primaryId));
        }
        appendIds(formData, 'product_ids', form.product_ids);
        appendIds(formData, 'category_ids', form.category_ids);
        appendIds(formData, 'product_group_ids', form.product_group_ids);
        appendIds(formData, 'bundle_product_ids', form.bundle_product_ids);
        formData.append('apply_all_products', form.apply_all_products ? '1' : '0');
        formData.append('question', form.question);
        formData.append('answer', form.answer);
        formData.append('youtube_url', form.youtube_url || '');
        formData.append('sort_order', form.sort_order || '0');
        formData.append('status', form.status || 'visible');
        formData.append('existing_images', JSON.stringify(form.images || []));
        (form.newImages || []).forEach((file) => {
            formData.append('images[]', file);
        });

        return formData;
    };

    const saveFaq = (event) => {
        event.preventDefault();
        const hasAnyTarget = targetPayload.apply_all_products
            || targetPayload.product_ids.length > 0
            || targetPayload.category_ids.length > 0
            || targetPayload.product_group_ids.length > 0
            || targetPayload.bundle_product_ids.length > 0
            || normalizeId(targetPayload.product_id);

        if (!hasAnyTarget) {
            setError('Chọn ít nhất một sản phẩm để áp dụng FAQ.');
            return;
        }

        setSaving(true);
        setMessage('');
        setError('');

        const request = form.id
            ? productFaqApi.adminUpdate(form.id, buildFormData())
            : productFaqApi.adminCreate(buildFormData());

        request
            .then(async (response) => {
                const savedFaq = response?.data?.faq || null;
                if (!savedFaq?.id) {
                    throw new Error('API không trả về FAQ vừa lưu.');
                }

                const appliedIds = uniqueIds(savedFaq.applied_product_ids || [savedFaq.product_id]);
                const nextProductId = appliedIds.includes(Number(selectedProductId))
                    ? String(selectedProductId)
                    : String(appliedIds[0] || savedFaq.product_id || selectedProductId);

                setMessage(response?.data?.message || 'Đã lưu hỏi đáp khách hàng.');
                closeForm();

                if (nextProductId !== String(selectedProductId)) {
                    setSelectedProductId(nextProductId);
                    setSelectedProductInfo(savedFaq.applied_products?.find((product) => Number(product.id) === Number(nextProductId)) || savedFaq.product || null);
                } else {
                    setFaqs((current) => upsertFaq(current, savedFaq));
                    if (savedFaq.product) {
                        setSelectedProductInfo(savedFaq.product);
                    }
                }

                await Promise.all([
                    loadFaqs(nextProductId),
                    loadFaqProductPanel(productPanelSearch, productPanelFilter),
                ]);
            })
            .catch((err) => {
                const errors = err?.response?.data?.errors;
                const firstError = errors ? Object.values(errors).flat()[0] : null;
                setError(firstError || err?.response?.data?.message || err?.message || 'Không thể lưu hỏi đáp.');
            })
            .finally(() => setSaving(false));
    };

    const deleteFaq = (faq) => {
        if (!window.confirm('Xóa FAQ này khỏi tất cả sản phẩm đã áp dụng?')) {
            return;
        }

        productFaqApi.adminDelete(faq.id)
            .then((response) => {
                setMessage(response?.data?.message || 'Đã xóa hỏi đáp.');
                setFaqs((current) => current.filter((item) => Number(item.id) !== Number(faq.id)));
                void loadFaqProductPanel(productPanelSearch, productPanelFilter);
            })
            .catch((err) => setError(err?.response?.data?.message || 'Không thể xóa hỏi đáp.'));
    };

    const reorderFaqs = (targetId) => {
        const sourceId = draggingId;
        setDraggingId(null);
        if (!sourceId || !targetId || sourceId === targetId) return;

        const fromIndex = faqs.findIndex((item) => Number(item.id) === Number(sourceId));
        const toIndex = faqs.findIndex((item) => Number(item.id) === Number(targetId));
        if (fromIndex < 0 || toIndex < 0) return;

        const nextFaqs = [...faqs];
        const [moved] = nextFaqs.splice(fromIndex, 1);
        nextFaqs.splice(toIndex, 0, moved);
        setFaqs(nextFaqs);

        productFaqApi.reorder({
            product_id: Number(selectedProductId),
            ids: nextFaqs.map((item) => item.id),
        })
            .then((response) => {
                const nextData = response?.data?.data;
                if (Array.isArray(nextData)) {
                    setFaqs(nextData);
                }
                setMessage(response?.data?.message || 'Đã cập nhật thứ tự hỏi đáp.');
            })
            .catch((err) => {
                setError(err?.response?.data?.message || 'Không thể sắp xếp hỏi đáp.');
                void loadFaqs(selectedProductId).catch(() => {});
            });
    };

    const renderSourceChip = (label, onRemove) => (
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-white px-3 py-1 text-xs font-bold text-primary">
            {label}
            <button type="button" onClick={onRemove} className="inline-flex size-5 items-center justify-center rounded-full text-stone-400 hover:bg-slate-100 hover:text-red-600">
                <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
        </span>
    );

    const isPanelExpanded = (panel) => expandedTargetPanel === panel;
    const targetPanelClass = (panel, collapsedClass = 'grid gap-2') => (
        isPanelExpanded(panel)
            ? 'fixed inset-x-4 bottom-6 top-6 z-[160] mx-auto flex w-[min(980px,calc(100vw-2rem))] flex-col gap-3 overflow-hidden rounded-xl border border-primary/10 bg-white p-5 shadow-2xl'
            : collapsedClass
    );
    const targetPanelListClass = (panel, collapsedMaxHeight) => (
        `grid gap-1 overflow-y-auto rounded-md border border-primary/10 bg-white p-2 ${isPanelExpanded(panel) ? 'min-h-0 flex-1' : collapsedMaxHeight}`
    );
    const renderPanelHeader = (panel, title, subtitle = null) => (
        <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
                <p className="text-sm font-black text-primary">{title}</p>
                {subtitle ? <p className="mt-0.5 text-xs font-bold text-stone-500">{subtitle}</p> : null}
            </div>
            <button
                type="button"
                onClick={() => setExpandedTargetPanel((current) => (current === panel ? null : panel))}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/10 bg-white text-primary hover:bg-primary hover:text-white"
                title={isPanelExpanded(panel) ? 'Thu nhỏ' : 'Phóng to'}
            >
                <span className="material-symbols-outlined text-[18px]">{isPanelExpanded(panel) ? 'close_fullscreen' : 'open_in_full'}</span>
            </button>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-lg border border-primary/10 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gold">Sản phẩm</p>
                    <h1 className="mt-1 text-2xl font-black text-primary">Hỏi đáp khách hàng</h1>
                    <p className="mt-1 text-sm text-stone-500">Quản lý FAQ theo từng sản phẩm hoặc dùng chung cho nhiều sản phẩm.</p>
                </div>
                <button
                    type="button"
                    onClick={openCreateForm}
                    disabled={!selectedProductId}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-black text-white shadow-sm transition hover:bg-brick disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <span className="material-symbols-outlined text-[18px]">add_circle</span>
                    Thêm câu hỏi
                </button>
            </div>

            {message ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                    {message}
                </div>
            ) : null}
            {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                    {error}
                </div>
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
                <section className="rounded-lg border border-primary/10 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-black text-primary">Sản phẩm đã có hỏi đáp</h2>
                            <p className="mt-1 text-sm text-stone-500">Bấm vào sản phẩm để sửa, xóa hoặc sắp xếp FAQ.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void loadFaqProductPanel(productPanelSearch, productPanelFilter)}
                            disabled={loadingFaqProducts}
                            className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 text-primary disabled:opacity-50"
                            title="Tải lại"
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loadingFaqProducts ? 'animate-spin' : ''}`}>
                                {loadingFaqProducts ? 'progress_activity' : 'refresh'}
                            </span>
                        </button>
                    </div>

                    <div className="mt-4 grid gap-3">
                        <input
                            value={productPanelSearch}
                            onChange={(event) => setProductPanelSearch(event.target.value)}
                            placeholder="Tìm theo tên, SKU hoặc mã sản phẩm"
                            className="min-h-11 rounded-md border border-primary/10 px-3 text-sm text-stone-700 outline-none focus:border-primary/40"
                        />
                        <div className="flex flex-wrap gap-2">
                            {PRODUCT_FILTERS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setProductPanelFilter(option.value)}
                                    className={`rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.08em] transition ${
                                        productPanelFilter === option.value
                                            ? 'border-primary bg-primary text-white'
                                            : 'border-primary/10 bg-white text-primary hover:bg-primary/5'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 grid max-h-[640px] gap-2 overflow-y-auto pr-1">
                        {loadingFaqProducts ? (
                            <div className="flex min-h-44 items-center justify-center rounded-lg bg-slate-50 text-sm font-bold text-stone-500">
                                Đang tải sản phẩm...
                            </div>
                        ) : faqProducts.length === 0 ? (
                            <div className="flex min-h-44 flex-col items-center justify-center rounded-lg bg-slate-50 p-6 text-center">
                                <span className="material-symbols-outlined text-4xl text-primary/35">inventory_2</span>
                                <p className="mt-3 text-sm font-bold text-stone-500">Không có sản phẩm phù hợp.</p>
                            </div>
                        ) : faqProducts.map((product) => {
                            const active = String(product.id) === String(selectedProductId);
                            return (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => selectProduct(product)}
                                    className={`w-full rounded-lg border p-3 text-left transition ${
                                        active
                                            ? 'border-primary bg-primary text-white shadow-sm'
                                            : 'border-primary/10 bg-white hover:border-primary/30 hover:bg-primary/5'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className={`line-clamp-2 text-sm font-black ${active ? 'text-white' : 'text-primary'}`}>{product.name}</p>
                                            <p className={`mt-1 text-xs ${active ? 'text-white/75' : 'text-stone-500'}`}>
                                                {product.sku ? `SKU: ${product.sku}` : 'Chưa có SKU'}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${
                                            active ? 'bg-white text-primary' : 'bg-gold/10 text-gold'
                                        }`}>
                                            {Number(product.faq_count || 0)} FAQ
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="rounded-lg border border-primary/10 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-primary/10 pb-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h2 className="text-lg font-black text-primary">
                                {selectedProduct ? selectedProduct.name : 'Danh sách FAQ của sản phẩm'}
                            </h2>
                            <p className="mt-1 text-sm text-stone-500">
                                {selectedProduct?.sku ? `SKU: ${selectedProduct.sku}` : 'Chọn sản phẩm ở panel bên trái.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void loadFaqs(selectedProductId).catch(() => {})}
                            disabled={!selectedProductId || loadingFaqs}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-primary/10 px-4 text-xs font-black uppercase tracking-[0.12em] text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <span className={`material-symbols-outlined text-[17px] ${loadingFaqs ? 'animate-spin' : ''}`}>
                                {loadingFaqs ? 'progress_activity' : 'refresh'}
                            </span>
                            Tải lại
                        </button>
                    </div>

                    {!selectedProductId ? (
                        <div className="mt-4 flex min-h-56 items-center justify-center rounded-lg bg-slate-50 p-6 text-center text-sm font-bold text-stone-500">
                            Chọn sản phẩm để bắt đầu quản lý hỏi đáp.
                        </div>
                    ) : loadingFaqs ? (
                        <div className="mt-4 flex min-h-56 items-center justify-center rounded-lg bg-slate-50 p-6 text-center text-sm font-bold text-stone-500">
                            Đang tải hỏi đáp...
                        </div>
                    ) : faqs.length === 0 ? (
                        <div className="mt-4 flex min-h-56 flex-col items-center justify-center rounded-lg bg-slate-50 p-6 text-center">
                            <span className="material-symbols-outlined text-4xl text-primary/35">contact_support</span>
                            <p className="mt-3 text-sm font-bold text-stone-500">Sản phẩm này chưa có câu hỏi nào.</p>
                            <button
                                type="button"
                                onClick={openCreateForm}
                                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-black text-white"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                Thêm câu hỏi đầu tiên
                            </button>
                        </div>
                    ) : (
                        <div className="mt-4 grid gap-3">
                            {faqs.map((faq, index) => (
                                <article
                                    key={faq.id}
                                    draggable
                                    onDragStart={() => setDraggingId(faq.id)}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={() => reorderFaqs(faq.id)}
                                    className={`rounded-lg border bg-white p-4 shadow-sm transition ${Number(draggingId) === Number(faq.id) ? 'border-gold opacity-70' : 'border-primary/10'}`}
                                >
                                    <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start">
                                        <div className="flex items-center gap-2 text-primary/45">
                                            <span className="material-symbols-outlined cursor-grab text-[22px]">drag_indicator</span>
                                            <span className="text-xs font-black">#{index + 1}</span>
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${faq.status === 'visible' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                                                    {getStatusLabel(faq.status)}
                                                </span>
                                                {Number(faq.applied_count || 0) > 1 ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-gold/20 bg-gold/10 px-2.5 py-1 text-[11px] font-black text-gold">
                                                        <span className="material-symbols-outlined text-[14px]">hub</span>
                                                        {faq.applied_count} sản phẩm
                                                    </span>
                                                ) : null}
                                                {faq.youtube_url ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700">
                                                        <span className="material-symbols-outlined text-[14px]">play_circle</span>
                                                        Video
                                                    </span>
                                                ) : null}
                                                {Array.isArray(faq.images) && faq.images.length > 0 ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-primary/5 px-2.5 py-1 text-[11px] font-black text-primary">
                                                        <span className="material-symbols-outlined text-[14px]">image</span>
                                                        {faq.images.length} ảnh
                                                    </span>
                                                ) : null}
                                            </div>
                                            <h3 className="mt-2 line-clamp-2 text-base font-black leading-6 text-primary">{faq.question}</h3>
                                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-stone-600">{faq.answer}</p>
                                            <p className="mt-2 text-xs text-stone-400">Cập nhật: {formatDateTime(faq.updated_at || faq.created_at)}</p>
                                        </div>
                                        <div className="flex items-center gap-2 md:justify-end">
                                            <button
                                                type="button"
                                                onClick={() => openEditForm(faq)}
                                                className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 text-primary transition hover:bg-primary hover:text-white"
                                                title="Sửa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deleteFaq(faq)}
                                                className="inline-flex size-10 items-center justify-center rounded-full border border-red-100 text-red-600 transition hover:bg-red-600 hover:text-white"
                                                title="Xóa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {isFormOpen ? (
                <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:items-center">
                    <form
                        onSubmit={saveFaq}
                        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-primary/10 pb-4">
                            <div>
                                <h2 className="text-xl font-black text-primary">
                                    {form.id ? 'Sửa hỏi đáp khách hàng' : 'Thêm hỏi đáp khách hàng'}
                                </h2>
                                <p className="mt-1 text-sm text-stone-500">Nội dung FAQ dùng chung sẽ cập nhật đồng loạt cho các sản phẩm đã áp dụng.</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeForm}
                                className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 text-primary"
                                title="Đóng"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        {expandedTargetPanel ? (
                            <button
                                type="button"
                                className="fixed inset-0 z-[150] bg-slate-950/35"
                                aria-label="Thu nhỏ khu vực đang phóng to"
                                onClick={() => setExpandedTargetPanel(null)}
                            />
                        ) : null}

                        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)]">
                            <div className="grid gap-4">
                                <label className="grid gap-1 text-sm font-bold text-primary">
                                    Câu hỏi khách hàng
                                    <textarea
                                        required
                                        value={form.question}
                                        onChange={(event) => updateForm('question', event.target.value)}
                                        rows={3}
                                        maxLength={1000}
                                        placeholder="VD: Sản phẩm này có dùng được trong lò vi sóng không?"
                                        className="rounded-md border border-primary/10 px-3 py-3 font-normal leading-6 text-stone-700 outline-none focus:border-primary/40"
                                    />
                                    <span className="text-right text-xs text-stone-400">{form.question.length}/1000</span>
                                </label>

                                <label className="grid gap-1 text-sm font-bold text-primary">
                                    Câu trả lời của shop
                                    <textarea
                                        required
                                        value={form.answer}
                                        onChange={(event) => updateForm('answer', event.target.value)}
                                        rows={8}
                                        maxLength={12000}
                                        placeholder="Nhập câu trả lời chi tiết cho khách hàng..."
                                        className="rounded-md border border-primary/10 px-3 py-3 font-normal leading-6 text-stone-700 outline-none focus:border-primary/40"
                                    />
                                    <span className="text-right text-xs text-stone-400">{form.answer.length}/12000</span>
                                </label>

                                <div className="grid gap-3 md:grid-cols-2">
                                    <label className="grid gap-1 text-sm font-bold text-primary">
                                        Link Youtube
                                        <input
                                            value={form.youtube_url}
                                            onChange={(event) => updateForm('youtube_url', event.target.value)}
                                            placeholder="https://www.youtube.com/watch?v=..."
                                            className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                        />
                                    </label>

                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="grid gap-1 text-sm font-bold text-primary">
                                            Thứ tự
                                            <input
                                                type="number"
                                                min="0"
                                                value={form.sort_order}
                                                onChange={(event) => updateForm('sort_order', event.target.value)}
                                                className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                            />
                                        </label>
                                        <label className="grid gap-1 text-sm font-bold text-primary">
                                            Trạng thái
                                            <select
                                                value={form.status}
                                                onChange={(event) => updateForm('status', event.target.value)}
                                                className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                            >
                                                {STATUS_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                </div>

                                <div className="grid gap-3">
                                    <label className="grid gap-1 text-sm font-bold text-primary">
                                        Ảnh đính kèm
                                        <input
                                            type="file"
                                            multiple
                                            accept="image/jpeg,image/png,image/jpg,image/gif,image/webp,image/avif,image/svg+xml"
                                            onChange={(event) => updateForm('newImages', Array.from(event.target.files || []))}
                                            className="min-h-11 rounded-md border border-primary/10 px-3 py-2 font-normal text-stone-700 outline-none focus:border-primary/40"
                                        />
                                    </label>

                                    {Array.isArray(form.images) && form.images.length > 0 ? (
                                        <div className="grid gap-2">
                                            <p className="text-xs font-black uppercase tracking-[0.12em] text-stone-400">Ảnh đang dùng</p>
                                            <div className="flex flex-wrap gap-2">
                                                {form.images.map((image, index) => {
                                                    const thumbUrl = imageThumbUrl(image);
                                                    return (
                                                        <div key={`${thumbUrl}-${index}`} className="relative size-20 overflow-hidden rounded-lg border border-primary/10 bg-slate-50">
                                                            {thumbUrl ? <img src={thumbUrl} alt="" className="h-full w-full object-cover" /> : null}
                                                            <button
                                                                type="button"
                                                                onClick={() => removeExistingImage(index)}
                                                                className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-slate-950/70 text-white"
                                                            >
                                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : null}

                                    {form.newImages.length > 0 ? (
                                        <div className="rounded-lg border border-primary/10 bg-slate-50 px-4 py-3 text-sm text-stone-600">
                                            <p className="font-bold text-primary">Ảnh mới sẽ tải lên khi lưu:</p>
                                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                                {form.newImages.map((file) => (
                                                    <li key={`${file.name}-${file.size}`}>{file.name}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <aside className="grid content-start gap-4 rounded-lg border border-primary/10 bg-slate-50 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-base font-black text-primary">Áp dụng cho sản phẩm</h3>
                                        <p className="mt-1 text-xs font-bold text-stone-500">
                                            {loadingTargetPreview ? 'Đang kiểm tra...' : `${targetPreview.total} sản phẩm đã chọn`}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={clearTargets}
                                        className="rounded-full border border-primary/10 bg-white px-3 py-2 text-xs font-black text-primary"
                                    >
                                        Xóa chọn
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => updateForm('apply_all_products', !form.apply_all_products)}
                                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-black ${
                                        form.apply_all_products
                                            ? 'border-primary bg-primary text-white'
                                            : 'border-primary/10 bg-white text-primary'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[18px]">{form.apply_all_products ? 'check_box' : 'check_box_outline_blank'}</span>
                                    Áp dụng cho tất cả sản phẩm
                                </button>

                                <div className={targetPanelClass('products')}>
                                    <div className={`grid gap-2 ${categories.length > 0 ? 'md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)_auto]' : 'md:grid-cols-[minmax(0,1fr)_auto]'} md:items-end`}>
                                        {categories.length > 0 ? (
                                            <label className="text-sm font-bold text-primary">
                                                Chọn theo danh mục
                                                <select
                                                    value={targetCategoryId}
                                                    onChange={(event) => setTargetCategoryId(event.target.value)}
                                                    className="mt-1 min-h-10 w-full rounded-md border border-primary/10 bg-white px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                                >
                                                    <option value="">Tất cả danh mục</option>
                                                    {categories.map((category) => (
                                                        <option key={category.id} value={category.id}>{category.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                        ) : null}
                                        <label className="text-sm font-bold text-primary">
                                            Tìm sản phẩm
                                            <input
                                                value={targetSearch}
                                                onChange={(event) => setTargetSearch(event.target.value)}
                                                placeholder="Gõ tên, SKU hoặc mã sản phẩm"
                                                className="mt-1 min-h-10 w-full rounded-md border border-primary/10 bg-white px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setExpandedTargetPanel((current) => (current === 'products' ? null : 'products'))}
                                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/10 bg-white text-primary hover:bg-primary hover:text-white"
                                            title={isPanelExpanded('products') ? 'Thu nhỏ' : 'Phóng to'}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">{isPanelExpanded('products') ? 'close_fullscreen' : 'open_in_full'}</span>
                                        </button>
                                    </div>
                                    <div className={targetPanelListClass('products', 'max-h-44')}>
                                        {loadingTargetProducts ? (
                                            <p className="px-2 py-3 text-sm font-bold text-stone-500">Đang tải...</p>
                                        ) : targetProducts.length === 0 ? (
                                            <p className="px-2 py-3 text-sm font-bold text-stone-500">Không có sản phẩm.</p>
                                        ) : targetProducts.map((product) => (
                                            <button
                                                key={product.id}
                                                type="button"
                                                onClick={() => toggleTargetProduct(product)}
                                                className={`flex items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm ${
                                                    hasId(form.product_ids, product.id) ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="min-w-0 line-clamp-1">{productLabel(product)}</span>
                                                <span className="material-symbols-outlined shrink-0 text-[18px]">
                                                    {hasId(form.product_ids, product.id) ? 'close' : 'add'}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {productGroups.length > 0 ? (
                                    <div className="grid gap-2">
                                        <label className="text-sm font-bold text-primary">
                                            Chọn theo nhóm sản phẩm
                                            <select
                                                value=""
                                                onChange={(event) => {
                                                    const id = normalizeId(event.target.value);
                                                    if (id) updateForm('product_group_ids', addUniqueId(form.product_group_ids, id));
                                                }}
                                                className="mt-1 min-h-10 w-full rounded-md border border-primary/10 bg-white px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                            >
                                                <option value="">Chọn nhóm</option>
                                                {productGroups.map((group) => (
                                                    <option key={group.id} value={group.id}>{group.name || `Nhóm #${group.id}`}</option>
                                                ))}
                                            </select>
                                        </label>
                                        {selectedProductGroups.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {selectedProductGroups.map((group) => renderSourceChip(
                                                    group.name || `Nhóm #${group.id}`,
                                                    () => updateForm('product_group_ids', removeId(form.product_group_ids, group.id))
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}

                                <div className={targetPanelClass('selected', 'grid gap-2 rounded-md border border-primary/10 bg-white p-3')}>
                                    {renderPanelHeader('selected', 'Sản phẩm đã chọn', loadingTargetPreview ? 'Đang tải danh sách...' : `${targetPreview.total} sản phẩm`)}
                                    {loadingTargetPreview ? (
                                        <div className="flex min-h-24 items-center justify-center text-sm font-bold text-stone-500">Đang tải danh sách...</div>
                                    ) : targetPreview.data.length === 0 ? (
                                        <div className="flex min-h-24 items-center justify-center text-sm font-bold text-stone-500">Chưa chọn sản phẩm.</div>
                                    ) : (
                                        <div className={targetPanelListClass('selected', 'max-h-56')}>
                                            {targetPreview.data.slice(0, 80).map((product) => {
                                                const canRemoveProduct = hasId(form.product_ids, product.id) && !form.apply_all_products;

                                                return (
                                                    <div key={product.id} className="flex items-center justify-between gap-3 rounded bg-slate-50 px-2 py-2 text-sm">
                                                        <span className="min-w-0 line-clamp-1 font-bold text-primary">{productLabel(product)}</span>
                                                        {canRemoveProduct ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateForm('product_ids', removeId(form.product_ids, product.id))}
                                                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-white hover:text-red-600"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                            {targetPreview.total > 80 ? (
                                                <p className="px-2 py-1 text-xs font-bold text-stone-500">+{targetPreview.total - 80} sản phẩm khác</p>
                                            ) : null}
                                        </div>
                                    )}
                                </div>
                            </aside>
                        </div>

                        <div className="mt-5 flex justify-end gap-3 border-t border-primary/10 pt-4">
                            <button
                                type="button"
                                onClick={closeForm}
                                className="min-h-11 rounded-full border border-primary/10 px-5 text-sm font-black text-primary"
                            >
                                Hủy
                            </button>
                            <button
                                type="submit"
                                disabled={saving || loadingTargetPreview}
                                className="min-h-11 rounded-full bg-primary px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? 'Đang lưu...' : 'Lưu hỏi đáp'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </div>
    );
}
