import React, { useEffect, useMemo, useState } from 'react';
import { productApi, reviewApi } from '../../services/api';

const STATUS_OPTIONS = [
    { value: '', label: 'Tất cả trạng thái' },
    { value: 'pending', label: 'Chờ duyệt' },
    { value: 'visible', label: 'Đang hiển thị' },
    { value: 'hidden', label: 'Đã ẩn' },
];

const TYPE_OPTIONS = [
    { value: '', label: 'Tất cả loại' },
    { value: 'review', label: 'Đánh giá' },
    { value: 'reply', label: 'Phản hồi' },
];

const SOURCE_OPTIONS = [
    { value: '', label: 'Tất cả nguồn' },
    { value: 'customer_web', label: 'Khách gửi từ website' },
    { value: 'admin_manual', label: 'Mẫu admin' },
    { value: 'admin_import', label: 'Import JSON' },
    { value: 'admin_sample', label: 'Bình luận ảo/test' },
];

const EXPORT_SOURCE_OPTIONS = [
    { value: 'admin_created', label: 'Chỉ đánh giá mẫu/import' },
    { value: 'all', label: 'Tất cả nguồn' },
    { value: 'customer_web', label: 'Chỉ khách gửi từ website' },
];

const STATUS_BADGE_CLASS = {
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    visible: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    hidden: 'border-slate-200 bg-slate-100 text-slate-600',
};

const SOURCE_BADGE_CLASS = {
    customer_web: 'border-sky-200 bg-sky-50 text-sky-700',
    admin_manual: 'border-violet-200 bg-violet-50 text-violet-700',
    admin_import: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
    admin_sample: 'border-orange-200 bg-orange-50 text-orange-700',
};

const initialFilters = {
    search: '',
    product: '',
    rating: '',
    status: '',
    type: '',
    source_type: '',
    unread_only: false,
    created_from: '',
    created_to: '',
};

const blankForm = {
    id: null,
    product_id: '',
    parent_id: '',
    customer_name: '',
    rating: 5,
    comment: '',
    status: 'visible',
    created_at: '',
    author_type: 'guest',
};

const BULK_IMPORT_SAMPLE = JSON.stringify([
    {
        product_id: 123,
        sku: 'SKU-NEU-CO',
        customer_name: 'Nguyễn Văn A',
        rating: 5,
        comment: 'Sản phẩm đóng gói cẩn thận, màu men đẹp và giống hình.',
        created_at: '2026-05-20 09:30:00',
        replies: [
            {
                admin_name: 'Gốm Đại Thành',
                comment: 'Cảm ơn anh/chị đã phản hồi. Shop rất vui khi sản phẩm phù hợp với nhu cầu của gia đình.',
                created_at: '2026-05-20 10:05:00',
            },
        ],
    },
], null, 2);

const BULK_FILE_PREVIEW_MAX_BYTES = 1000000;

const normalizeProducts = (response) => {
    const payload = response?.data;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
};

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

const toDatetimeLocal = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const normalizeReviewForm = (review) => ({
    id: review?.id || null,
    product_id: review?.product_id ? String(review.product_id) : '',
    parent_id: review?.parent_id ? String(review.parent_id) : '',
    customer_name: review?.customer_name || '',
    rating: Number(review?.rating || 5),
    comment: review?.comment || '',
    status: review?.status || 'visible',
    created_at: toDatetimeLocal(review?.created_at) || toDatetimeLocal(new Date().toISOString()),
    author_type: review?.author_type || 'guest',
});

const getStatusLabel = (status) => (
    STATUS_OPTIONS.find((item) => item.value === status)?.label || status || 'Không rõ'
);

const getSourceLabel = (sourceType) => (
    SOURCE_OPTIONS.find((item) => item.value === sourceType)?.label || 'Không rõ nguồn'
);

const maskPhoneNumbers = (value) => String(value || '').replace(/(?<!\d)(\+?84|0)\d{8,10}(?!\d)/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 9) {
        return match;
    }

    return `${digits.slice(0, 3)}${'*'.repeat(Math.max(3, digits.length - 6))}${digits.slice(-3)}`;
});

const renderStars = (rating) => (
    <span className="inline-flex items-center text-amber-400">
        {[1, 2, 3, 4, 5].map((star) => (
            <span
                key={star}
                className={`material-symbols-outlined text-[17px] leading-none ${star <= Number(rating || 0) ? '' : 'opacity-20'}`}
                style={{ fontVariationSettings: "'FILL' 1" }}
            >
                star
            </span>
        ))}
    </span>
);

const getDownloadFilename = (headers = {}, fallback = 'product-reviews.json') => {
    const disposition = headers?.['content-disposition'] || headers?.['Content-Disposition'] || '';
    const match = String(disposition).match(/filename="?([^"]+)"?/i);

    return match?.[1] || fallback;
};

export default function ProductReviewManager() {
    const [filters, setFilters] = useState(initialFilters);
    const [reviews, setReviews] = useState([]);
    const [meta, setMeta] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [form, setForm] = useState(blankForm);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [bulkPayload, setBulkPayload] = useState(BULK_IMPORT_SAMPLE);
    const [bulkFile, setBulkFile] = useState(null);
    const [bulkFileNotice, setBulkFileNotice] = useState('');
    const [bulkStatus, setBulkStatus] = useState('visible');
    const [bulkMode, setBulkMode] = useState('append');
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);
    const [isExportOpen, setIsExportOpen] = useState(false);
    const [exportScope, setExportScope] = useState('all');
    const [exportProductIds, setExportProductIds] = useState([]);
    const [exportSourceScope, setExportSourceScope] = useState('admin_created');
    const [exportStatus, setExportStatus] = useState('');
    const [exportSaving, setExportSaving] = useState(false);
    const [sampleSeeding, setSampleSeeding] = useState(false);
    const [unreadSummary, setUnreadSummary] = useState({ total: 0, reviews: 0, replies: 0 });
    const [productSearch, setProductSearch] = useState('');
    const [products, setProducts] = useState([]);

    const selectedProduct = useMemo(() => (
        products.find((product) => String(product.id) === String(form.product_id)) || null
    ), [form.product_id, products]);

    const selectedExportProducts = useMemo(() => (
        products.filter((product) => exportProductIds.includes(Number(product.id)))
    ), [exportProductIds, products]);

    const loadReviews = (page = meta.current_page || 1, filterOverride = null) => {
        setLoading(true);
        setError('');

        reviewApi.adminList({
            ...(filterOverride || filters),
            page,
            per_page: 20,
        })
            .then((response) => {
                const payload = response.data;
                const nextUnreadSummary = payload?.unread_summary || { total: 0, reviews: 0, replies: 0 };
                setReviews(Array.isArray(payload?.data) ? payload.data : []);
                setMeta({
                    current_page: payload?.current_page || 1,
                    last_page: payload?.last_page || 1,
                    total: payload?.total || 0,
                });
                setUnreadSummary(nextUnreadSummary);

                if (Number(nextUnreadSummary.total || 0) > 0) {
                    reviewApi.markSeen()
                        .then((markResponse) => {
                            const total = Number(markResponse?.data?.total || 0);
                            window.dispatchEvent(new CustomEvent('admin:review-unread-updated', {
                                detail: { total },
                            }));
                        })
                        .catch(() => {});
                }
            })
            .catch((err) => {
                setError(err?.response?.data?.message || 'Không thể tải danh sách đánh giá.');
            })
            .finally(() => setLoading(false));
    };

    const loadProducts = (search = '') => {
        productApi.getAll({ search, per_page: 12 })
            .then((response) => setProducts(normalizeProducts(response)))
            .catch(() => setProducts([]));
    };

    useEffect(() => {
        loadReviews(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => loadProducts(productSearch), 250);
        return () => window.clearTimeout(timeoutId);
    }, [productSearch]);

    const updateFilter = (key, value) => {
        setFilters((current) => ({ ...current, [key]: value }));
    };

    const updateForm = (key, value) => {
        setForm((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const openCreateForm = () => {
        setForm({
            ...blankForm,
            created_at: toDatetimeLocal(new Date().toISOString()),
        });
        setIsFormOpen(true);
        setMessage('');
        setError('');
    };

    const openEditForm = (review) => {
        setForm(normalizeReviewForm(review));
        if (review?.product && !products.some((product) => Number(product.id) === Number(review.product.id))) {
            setProducts((current) => [review.product, ...current]);
        }
        setIsFormOpen(true);
        setMessage('');
        setError('');
    };

    const openReplyForm = (review) => {
        const targetParentId = review.parent_id || review.id;
        const targetProduct = review.product;
        setForm({
            ...blankForm,
            product_id: review.product_id ? String(review.product_id) : '',
            parent_id: targetParentId ? String(targetParentId) : '',
            customer_name: 'Quản trị viên',
            author_type: 'admin',
            status: 'visible',
            created_at: toDatetimeLocal(new Date().toISOString()),
        });
        if (targetProduct && !products.some((product) => Number(product.id) === Number(targetProduct.id))) {
            setProducts((current) => [targetProduct, ...current]);
        }
        setIsFormOpen(true);
        setMessage('');
        setError('');
    };

    const saveReview = (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        setMessage('');

        const payload = {
            product_id: Number(form.product_id),
            parent_id: form.parent_id ? Number(form.parent_id) : null,
            customer_name: form.customer_name,
            rating: Number(form.rating),
            comment: form.comment,
            status: form.status,
            created_at: form.created_at || null,
            author_type: form.author_type,
        };

        const request = form.id
            ? reviewApi.adminUpdate(form.id, payload)
            : reviewApi.adminCreate(payload);

        request
            .then((response) => {
                setMessage(response?.data?.message || 'Đã lưu đánh giá.');
                setIsFormOpen(false);
                loadReviews(form.id ? meta.current_page : 1);
            })
            .catch((err) => {
                const errors = err?.response?.data?.errors;
                const firstError = errors ? Object.values(errors).flat()[0] : null;
                setError(firstError || err?.response?.data?.message || 'Không thể lưu đánh giá.');
            })
            .finally(() => setSaving(false));
    };

    const openBulkImport = () => {
        setIsBulkImportOpen(true);
        setBulkResult(null);
        setBulkFileNotice('');
        setMessage('');
        setError('');
    };

    const openExportDialog = () => {
        setIsExportOpen(true);
        setMessage('');
        setError('');
        if (products.length === 0) {
            loadProducts(productSearch);
        }
    };

    const toggleExportProduct = (productId) => {
        const normalizedId = Number(productId);
        setExportProductIds((current) => (
            current.includes(normalizedId)
                ? current.filter((id) => id !== normalizedId)
                : [...current, normalizedId]
        ));
    };

    const loadBulkJsonFile = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setBulkFile(file);
        setBulkResult(null);
        setError('');

        const fileSizeMb = (file.size / 1024 / 1024).toFixed(2);
        if (file.size > BULK_FILE_PREVIEW_MAX_BYTES) {
            setBulkPayload('');
            setBulkFileNotice(`Đã chọn ${file.name} (${fileSizeMb} MB). File lớn sẽ được gửi trực tiếp, không cần dán vào ô JSON.`);
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            setBulkPayload(String(reader.result || ''));
            setBulkFileNotice(`Đã chọn ${file.name} (${fileSizeMb} MB). Có thể bấm nhập ngay hoặc chỉnh nội dung trong ô JSON bên dưới.`);
        };
        reader.onerror = () => {
            setBulkFile(null);
            setBulkFileNotice('');
            setError('Không thể đọc file JSON.');
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const importBulkReviews = (event) => {
        event.preventDefault();
        if (!bulkFile && !String(bulkPayload || '').trim()) {
            setError('Chọn file JSON hoặc dán nội dung JSON trước khi nhập.');
            return;
        }

        if (bulkMode === 'replace' && !window.confirm('Chế độ cập nhật sẽ xóa đánh giá mẫu/import cũ của các sản phẩm có trong JSON, nhưng giữ đánh giá thật của khách. Tiếp tục?')) {
            return;
        }

        setBulkSaving(true);
        setBulkResult(null);
        setError('');
        setMessage('');

        const requestData = bulkFile ? new FormData() : {
            payload: bulkPayload,
            default_status: bulkStatus,
            mode: bulkMode,
        };

        if (bulkFile) {
            requestData.append('import_file', bulkFile);
            requestData.append('default_status', bulkStatus);
            requestData.append('mode', bulkMode);
        }

        reviewApi.adminBulkImport(requestData)
            .then((response) => {
                const result = response?.data?.result || {};
                setBulkResult(result);
                setMessage(`Đã nhập ${result.created_reviews || 0} đánh giá và ${result.created_replies || 0} phản hồi.`);
                loadReviews(1, { ...filters, status: bulkStatus });
            })
            .catch((err) => {
                const errors = err?.response?.data?.errors;
                const firstError = errors ? Object.values(errors).flat()[0] : null;
                setError(firstError || err?.response?.data?.message || 'Không thể nhập đánh giá hàng loạt.');
            })
            .finally(() => setBulkSaving(false));
    };

    const exportReviews = (event) => {
        event.preventDefault();

        if (exportScope === 'selected' && exportProductIds.length === 0) {
            setError('Chọn ít nhất 1 sản phẩm để export.');
            return;
        }

        setExportSaving(true);
        setError('');
        setMessage('');

        reviewApi.adminExport({
            source_scope: exportSourceScope,
            status: exportStatus || undefined,
            product_ids: exportScope === 'selected' ? exportProductIds : undefined,
        })
            .then((response) => {
                const blob = new Blob([response.data], { type: 'application/json;charset=utf-8' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = getDownloadFilename(response.headers, 'product-reviews.json');
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
                setMessage('Đã xuất file JSON đánh giá.');
                setIsExportOpen(false);
            })
            .catch((err) => {
                setError(err?.response?.data?.message || 'Không thể export đánh giá.');
            })
            .finally(() => setExportSaving(false));
    };

    const seedSampleReviews = () => {
        setSampleSeeding(true);
        setError('');
        setMessage('');

        reviewApi.seedSample({
            min: 70,
            max: 100,
            years: 4,
            status: 'visible',
            replace: true,
        })
            .then((response) => {
                const summary = response?.data?.summary || {};
                setMessage(`Đã tạo bình luận ảo/test: ${summary.reviews || 0} đánh giá, ${summary.replies || 0} phản hồi cho ${summary.products || 0} sản phẩm.`);
                const nextFilters = {
                    ...filters,
                    source_type: 'admin_sample',
                    status: 'visible',
                    type: 'review',
                };
                setFilters(nextFilters);
                loadReviews(1, nextFilters);
            })
            .catch((err) => {
                setError(err?.response?.data?.message || 'Không thể tạo bình luận ảo/test.');
            })
            .finally(() => setSampleSeeding(false));
    };

    const setStatus = (review, nextStatus) => {
        const request = nextStatus === 'visible' ? reviewApi.approve(review.id) : reviewApi.hide(review.id);
        request
            .then(() => {
                setMessage(nextStatus === 'visible' ? 'Đã duyệt hiển thị.' : 'Đã ẩn khỏi website.');
                loadReviews(meta.current_page);
            })
            .catch((err) => setError(err?.response?.data?.message || 'Không thể cập nhật trạng thái.'));
    };

    const deleteReview = (review) => {
        if (!window.confirm('Xóa đánh giá/phản hồi này?')) {
            return;
        }

        reviewApi.adminDelete(review.id)
            .then(() => {
                setMessage('Đã xóa đánh giá/phản hồi.');
                loadReviews(meta.current_page);
            })
            .catch((err) => setError(err?.response?.data?.message || 'Không thể xóa đánh giá.'));
    };

    const resetFilters = () => {
        setFilters(initialFilters);
        loadReviews(1, initialFilters);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-lg border border-primary/10 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gold">Sản phẩm</p>
                    <h1 className="mt-1 text-2xl font-black text-primary">Quản lý đánh giá & bình luận</h1>
                    <p className="mt-2 text-sm text-stone-500">
                        Xem, thêm mẫu, sửa nội dung, duyệt hoặc ẩn đánh giá và phản hồi của khách.
                    </p>
                    {unreadSummary.total > 0 ? (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-brick/20 bg-brick/5 px-3 py-1 text-xs font-black text-brick">
                            <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                            {unreadSummary.total} bình luận/đánh giá mới chưa xem
                        </div>
                    ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={openExportDialog}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-primary/10 bg-white px-5 py-2.5 text-sm font-black text-primary shadow-sm transition hover:bg-primary hover:text-white"
                    >
                        <span className="material-symbols-outlined text-[20px]">download</span>
                        Xuất JSON
                    </button>
                    <button
                        type="button"
                        onClick={seedSampleReviews}
                        disabled={sampleSeeding}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-5 py-2.5 text-sm font-black text-orange-700 shadow-sm transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                        {sampleSeeding ? 'Đang tạo...' : 'Tạo đánh giá mẫu cho tất cả sản phẩm'}
                    </button>
                    <button
                        type="button"
                        onClick={openBulkImport}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-primary/10 bg-white px-5 py-2.5 text-sm font-black text-primary shadow-sm transition hover:bg-primary hover:text-white"
                    >
                        <span className="material-symbols-outlined text-[20px]">content_paste_go</span>
                        Import JSON
                    </button>
                    <button
                        type="button"
                        onClick={openCreateForm}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:brightness-95"
                    >
                        <span className="material-symbols-outlined text-[20px]">add_comment</span>
                        Thêm đánh giá mẫu
                    </button>
                </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-primary/10 bg-white p-4 shadow-sm lg:grid-cols-6">
                <input
                    value={filters.search}
                    onChange={(event) => updateFilter('search', event.target.value)}
                    placeholder="Tìm tên, nội dung, sản phẩm..."
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40 lg:col-span-2"
                />
                <input
                    value={filters.product}
                    onChange={(event) => updateFilter('product', event.target.value)}
                    placeholder="Lọc theo sản phẩm/SKU"
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                />
                <select
                    value={filters.rating}
                    onChange={(event) => updateFilter('rating', event.target.value)}
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                >
                    <option value="">Tất cả sao</option>
                    {[5, 4, 3, 2, 1].map((rating) => (
                        <option key={rating} value={rating}>{rating} sao</option>
                    ))}
                </select>
                <select
                    value={filters.status}
                    onChange={(event) => updateFilter('status', event.target.value)}
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                >
                    {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <select
                    value={filters.type}
                    onChange={(event) => updateFilter('type', event.target.value)}
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                >
                    {TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <select
                    value={filters.source_type}
                    onChange={(event) => updateFilter('source_type', event.target.value)}
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                >
                    {SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <label className="flex min-h-11 items-center gap-2 rounded-md border border-primary/10 px-3 text-sm font-bold text-primary">
                    <input
                        type="checkbox"
                        checked={Boolean(filters.unread_only)}
                        onChange={(event) => updateFilter('unread_only', event.target.checked)}
                    />
                    Chưa xem
                </label>
                <input
                    type="date"
                    value={filters.created_from}
                    onChange={(event) => updateFilter('created_from', event.target.value)}
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                />
                <input
                    type="date"
                    value={filters.created_to}
                    onChange={(event) => updateFilter('created_to', event.target.value)}
                    className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                />
                <div className="flex gap-2 lg:col-span-4">
                    <button
                        type="button"
                        onClick={() => loadReviews(1)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-white"
                    >
                        <span className="material-symbols-outlined text-[18px]">search</span>
                        Lọc
                    </button>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/10 px-4 text-sm font-bold text-primary"
                    >
                        <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                        Xóa lọc
                    </button>
                </div>
            </div>

            {message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

            <div className="overflow-hidden rounded-lg border border-primary/10 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-primary/10 px-4 py-3">
                    <p className="text-sm font-bold text-primary">Tổng {meta.total} mục</p>
                    {loading ? <span className="text-xs font-bold uppercase tracking-widest text-stone-400">Đang tải...</span> : null}
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-primary/10 text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-stone-500">
                            <tr>
                                <th className="px-4 py-3">Nội dung</th>
                                <th className="px-4 py-3">Sản phẩm</th>
                                <th className="px-4 py-3">Sao</th>
                                <th className="px-4 py-3">Trạng thái</th>
                                <th className="px-4 py-3">Nguồn</th>
                                <th className="px-4 py-3">Ngày tạo</th>
                                <th className="px-4 py-3 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/10">
                            {reviews.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-10 text-center text-stone-400">
                                        Chưa có đánh giá/phản hồi phù hợp.
                                    </td>
                                </tr>
                            ) : reviews.map((review) => (
                                <tr key={review.id} className="align-top">
                                    <td className="max-w-[32rem] px-4 py-3">
                                        <div className="flex items-start gap-3">
                                            <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${review.parent_id ? 'bg-slate-800' : 'bg-primary'}`}>
                                                {review.parent_id ? 'R' : 'Đ'}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <strong className="text-primary">{maskPhoneNumbers(review.display_name || review.customer_name || 'Khách hàng')}</strong>
                                                    {review.is_unread ? (
                                                        <span className="rounded-full bg-brick px-2 py-0.5 text-[11px] font-black text-white">Mới</span>
                                                    ) : null}
                                                    {review.parent_id ? (
                                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Phản hồi</span>
                                                    ) : null}
                                                    {review.is_anonymous ? (
                                                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-600">Ẩn danh</span>
                                                    ) : null}
                                                </div>
                                                {review.parent ? (
                                                    <p className="mt-1 line-clamp-1 text-xs text-stone-400">
                                                        Trả lời: {maskPhoneNumbers(review.parent.customer_name)} - {maskPhoneNumbers(review.parent.comment)}
                                                    </p>
                                                ) : null}
                                                <p className="mt-2 line-clamp-3 leading-6 text-stone-700">{maskPhoneNumbers(review.comment)}</p>
                                                <p className="mt-1 text-xs text-stone-400">{review.helpful_count || 0} lượt like</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="max-w-[18rem] font-bold text-stone-800">{review.product?.name || 'Không rõ'}</p>
                                        {review.product?.sku ? <p className="mt-1 text-xs text-stone-400">SKU: {review.product.sku}</p> : null}
                                    </td>
                                    <td className="px-4 py-3">
                                        {review.parent_id ? <span className="text-stone-400">-</span> : renderStars(review.rating)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_BADGE_CLASS[review.status] || STATUS_BADGE_CLASS.pending}`}>
                                            {getStatusLabel(review.status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${SOURCE_BADGE_CLASS[review.source_type] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                            {review.source_label || getSourceLabel(review.source_type)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-stone-500">{formatDateTime(review.created_at)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-2">
                                            {!review.parent_id ? (
                                                <button
                                                    type="button"
                                                    onClick={() => openReplyForm(review)}
                                                    className="inline-flex size-9 items-center justify-center rounded-full border border-primary/10 text-primary hover:bg-primary/5"
                                                    title="Trả lời"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">reply</span>
                                                </button>
                                            ) : null}
                                            {review.status !== 'visible' ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setStatus(review, 'visible')}
                                                    className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                    title="Duyệt hiển thị"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">visibility</span>
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setStatus(review, 'hidden')}
                                                    className="inline-flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                                                    title="Ẩn"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">visibility_off</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => openEditForm(review)}
                                                className="inline-flex size-9 items-center justify-center rounded-full border border-primary/10 text-primary hover:bg-primary/5"
                                                title="Sửa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deleteReview(review)}
                                                className="inline-flex size-9 items-center justify-center rounded-full border border-red-200 text-red-600 hover:bg-red-50"
                                                title="Xóa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between border-t border-primary/10 px-4 py-3">
                    <button
                        type="button"
                        disabled={meta.current_page <= 1}
                        onClick={() => loadReviews(meta.current_page - 1)}
                        className="rounded-md border border-primary/10 px-3 py-2 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Trước
                    </button>
                    <span className="text-sm font-bold text-stone-500">
                        Trang {meta.current_page}/{meta.last_page}
                    </span>
                    <button
                        type="button"
                        disabled={meta.current_page >= meta.last_page}
                        onClick={() => loadReviews(meta.current_page + 1)}
                        className="rounded-md border border-primary/10 px-3 py-2 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Sau
                    </button>
                </div>
            </div>

            {isExportOpen ? (
                <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:items-center">
                    <form
                        onSubmit={exportReviews}
                        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-primary/10 pb-4">
                            <div>
                                <h2 className="text-xl font-black text-primary">Xuất JSON đánh giá</h2>
                                <p className="mt-1 text-sm text-stone-500">
                                    File xuất ra là mảng JSON phẳng, có thể import lại trực tiếp sang web khác.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsExportOpen(false)}
                                className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 text-primary"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-4 grid gap-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="flex min-h-11 items-center gap-2 rounded-md border border-primary/10 px-3 text-sm font-bold text-primary">
                                    <input
                                        type="radio"
                                        name="exportScope"
                                        checked={exportScope === 'all'}
                                        onChange={() => setExportScope('all')}
                                    />
                                    Export tất cả sản phẩm
                                </label>
                                <label className="flex min-h-11 items-center gap-2 rounded-md border border-primary/10 px-3 text-sm font-bold text-primary">
                                    <input
                                        type="radio"
                                        name="exportScope"
                                        checked={exportScope === 'selected'}
                                        onChange={() => setExportScope('selected')}
                                    />
                                    Chọn sản phẩm để export
                                </label>
                            </div>

                            {exportScope === 'selected' ? (
                                <div className="grid gap-3 rounded-lg border border-primary/10 bg-slate-50 p-3">
                                    <input
                                        value={productSearch}
                                        onChange={(event) => setProductSearch(event.target.value)}
                                        placeholder="Gõ tên hoặc SKU để tìm sản phẩm"
                                        className="min-h-11 rounded-md border border-primary/10 px-3 text-sm outline-none focus:border-primary/40"
                                    />
                                    <div className="max-h-56 overflow-y-auto rounded-md border border-primary/10 bg-white">
                                        {products.length === 0 ? (
                                            <p className="px-3 py-3 text-sm text-stone-500">Chưa có sản phẩm phù hợp.</p>
                                        ) : products.map((product) => {
                                            const checked = exportProductIds.includes(Number(product.id));

                                            return (
                                                <label
                                                    key={product.id}
                                                    className="flex cursor-pointer items-center gap-3 border-b border-primary/5 px-3 py-2 text-sm last:border-b-0 hover:bg-primary/5"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleExportProduct(product.id)}
                                                    />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate font-bold text-primary">{product.name}</span>
                                                        {product.sku ? <span className="block text-xs text-stone-500">SKU: {product.sku}</span> : null}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <p className="text-xs font-bold text-stone-500">
                                        Đã chọn {exportProductIds.length} sản phẩm
                                        {selectedExportProducts.length > 0 ? `: ${selectedExportProducts.map((product) => product.sku || product.name).join(', ')}` : ''}
                                    </p>
                                </div>
                            ) : null}

                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="grid gap-1 text-sm font-bold text-primary">
                                    Nguồn đánh giá
                                    <select
                                        value={exportSourceScope}
                                        onChange={(event) => setExportSourceScope(event.target.value)}
                                        className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                    >
                                        {EXPORT_SOURCE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="grid gap-1 text-sm font-bold text-primary">
                                    Trạng thái
                                    <select
                                        value={exportStatus}
                                        onChange={(event) => setExportStatus(event.target.value)}
                                        className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                    >
                                        {STATUS_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>

                        <div className="mt-5 flex justify-end gap-3 border-t border-primary/10 pt-4">
                            <button
                                type="button"
                                onClick={() => setIsExportOpen(false)}
                                className="min-h-11 rounded-full border border-primary/10 px-5 text-sm font-black text-primary"
                            >
                                Hủy
                            </button>
                            <button
                                type="submit"
                                disabled={exportSaving}
                                className="min-h-11 rounded-full bg-primary px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {exportSaving ? 'Đang xuất...' : 'Tải file JSON'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}

            {isBulkImportOpen ? (
                <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:items-center">
                    <form
                        onSubmit={importBulkReviews}
                        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-primary/10 pb-4">
                            <div>
                                <h2 className="text-xl font-black text-primary">Import JSON đánh giá hàng loạt</h2>
                                <p className="mt-1 text-sm text-stone-500">Hỗ trợ product_id, sku, slug hoặc product_name; mỗi đánh giá có thể kèm replies của admin.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsBulkImportOpen(false)}
                                className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 text-primary"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-4 grid gap-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="flex min-h-11 items-center gap-2 rounded-md border border-primary/10 px-3 text-sm font-bold text-primary">
                                    <input
                                        type="radio"
                                        name="bulkMode"
                                        checked={bulkMode === 'append'}
                                        onChange={() => setBulkMode('append')}
                                    />
                                    Thêm mới đánh giá
                                </label>
                                <label className="flex min-h-11 items-center gap-2 rounded-md border border-primary/10 px-3 text-sm font-bold text-primary">
                                    <input
                                        type="radio"
                                        name="bulkMode"
                                        checked={bulkMode === 'replace'}
                                        onChange={() => setBulkMode('replace')}
                                    />
                                    Cập nhật/thay đánh giá cũ
                                </label>
                            </div>
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <label className="grid gap-1 text-sm font-bold text-primary">
                                    Trạng thái sau khi nhập
                                    <select
                                        value={bulkStatus}
                                        onChange={(event) => setBulkStatus(event.target.value)}
                                        className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                    >
                                        <option value="visible">Đang hiển thị</option>
                                        <option value="pending">Chờ duyệt</option>
                                        <option value="hidden">Ẩn</option>
                                    </select>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBulkFile(null);
                                        setBulkFileNotice('');
                                        setBulkPayload(BULK_IMPORT_SAMPLE);
                                    }}
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-primary/10 px-4 text-sm font-black text-primary"
                                >
                                    <span className="material-symbols-outlined text-[18px]">data_object</span>
                                    Dùng mẫu
                                </button>
                            </div>

                            <label className="grid gap-1 text-sm font-bold text-primary">
                                Hoặc chọn file JSON
                                <input
                                    type="file"
                                    accept="application/json,.json"
                                    onChange={loadBulkJsonFile}
                                    className="min-h-11 rounded-md border border-primary/10 px-3 py-2 font-normal text-stone-700 outline-none focus:border-primary/40"
                                />
                            </label>

                            {bulkFileNotice ? (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                                    {bulkFileNotice}
                                </div>
                            ) : null}

                            <label className="grid gap-1 text-sm font-bold text-primary">
                                JSON từ ChatGPT
                                <textarea
                                    required={!bulkFile}
                                    value={bulkPayload}
                                    onChange={(event) => {
                                        setBulkFile(null);
                                        setBulkFileNotice('');
                                        setBulkPayload(event.target.value);
                                    }}
                                    rows={18}
                                    spellCheck={false}
                                    className="font-mono rounded-md border border-primary/10 px-3 py-3 text-xs font-normal leading-6 text-stone-700 outline-none focus:border-primary/40"
                                />
                            </label>

                            {bulkResult ? (
                                <div className="rounded-lg border border-primary/10 bg-slate-50 px-4 py-3 text-sm text-stone-600">
                                    <p className="font-bold text-primary">
                                        Đã tạo {bulkResult.created_reviews || 0} đánh giá, {bulkResult.created_replies || 0} phản hồi; bỏ qua {bulkResult.skipped || 0} mục.
                                    </p>
                                    {Number(bulkResult.deleted_existing || 0) > 0 ? (
                                        <p className="mt-1 text-xs font-bold text-amber-700">
                                            Chế độ cập nhật đã thay {bulkResult.deleted_existing} đánh giá mẫu/import cũ trong {bulkResult.replaced_products || 0} sản phẩm.
                                        </p>
                                    ) : null}
                                    {Array.isArray(bulkResult.errors) && bulkResult.errors.length > 0 ? (
                                        <ul className="mt-2 list-disc space-y-1 pl-5">
                                            {bulkResult.errors.slice(0, 8).map((item, index) => (
                                                <li key={`${item}-${index}`}>{item}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-5 flex justify-end gap-3 border-t border-primary/10 pt-4">
                            <button
                                type="button"
                                onClick={() => setIsBulkImportOpen(false)}
                                className="min-h-11 rounded-full border border-primary/10 px-5 text-sm font-black text-primary"
                            >
                                Hủy
                            </button>
                            <button
                                type="submit"
                                disabled={bulkSaving}
                                className="min-h-11 rounded-full bg-primary px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {bulkSaving ? 'Đang nhập...' : 'Nhập hàng loạt'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}

            {isFormOpen ? (
                <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:items-center">
                    <form
                        onSubmit={saveReview}
                        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-primary/10 pb-4">
                            <div>
                                <h2 className="text-xl font-black text-primary">
                                    {form.id ? 'Sửa đánh giá/bình luận' : form.parent_id ? 'Thêm phản hồi' : 'Thêm đánh giá mẫu'}
                                </h2>
                                <p className="mt-1 text-sm text-stone-500">Có thể chỉnh tên, sao, nội dung, thời gian và trạng thái hiển thị.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsFormOpen(false)}
                                className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 text-primary"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <label className="grid gap-1 text-sm font-bold text-primary md:col-span-2">
                                Tìm/chọn sản phẩm
                                <input
                                    value={productSearch}
                                    onChange={(event) => setProductSearch(event.target.value)}
                                    placeholder="Gõ tên hoặc SKU để tìm"
                                    className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                />
                                <select
                                    required
                                    value={form.product_id}
                                    onChange={(event) => updateForm('product_id', event.target.value)}
                                    className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                >
                                    <option value="">Chọn sản phẩm</option>
                                    {products.map((product) => (
                                        <option key={product.id} value={product.id}>
                                            {product.name} {product.sku ? `- ${product.sku}` : ''}
                                        </option>
                                    ))}
                                    {selectedProduct && !products.some((product) => Number(product.id) === Number(selectedProduct.id)) ? (
                                        <option value={selectedProduct.id}>{selectedProduct.name}</option>
                                    ) : null}
                                </select>
                            </label>

                            <label className="grid gap-1 text-sm font-bold text-primary">
                                Tên hiển thị
                                <input
                                    value={form.customer_name}
                                    onChange={(event) => updateForm('customer_name', event.target.value)}
                                    placeholder="VD: Nguyễn Văn A"
                                    className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40 disabled:bg-slate-50"
                                />
                            </label>

                            <label className="grid gap-1 text-sm font-bold text-primary">
                                Trạng thái
                                <select
                                    value={form.status}
                                    onChange={(event) => updateForm('status', event.target.value)}
                                    className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                >
                                    {STATUS_OPTIONS.filter((option) => option.value).map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>

                            {!form.parent_id ? (
                                <label className="grid gap-1 text-sm font-bold text-primary">
                                    Số sao
                                    <select
                                        value={form.rating}
                                        onChange={(event) => updateForm('rating', Number(event.target.value))}
                                        className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                    >
                                        {[5, 4, 3, 2, 1].map((rating) => (
                                            <option key={rating} value={rating}>{rating} sao</option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}

                            <label className="grid gap-1 text-sm font-bold text-primary">
                                Thời gian
                                <input
                                    type="datetime-local"
                                    value={form.created_at}
                                    onChange={(event) => updateForm('created_at', event.target.value)}
                                    className="min-h-11 rounded-md border border-primary/10 px-3 font-normal text-stone-700 outline-none focus:border-primary/40"
                                />
                            </label>

                            {form.parent_id ? (
                                <div className="rounded-md border border-primary/10 bg-slate-50 px-3 py-2 text-sm text-stone-500 md:col-span-2">
                                    Đang tạo/sửa phản hồi cho đánh giá #{form.parent_id}
                                </div>
                            ) : null}

                            <label className="grid gap-1 text-sm font-bold text-primary md:col-span-2">
                                Nội dung
                                <textarea
                                    required
                                    value={form.comment}
                                    onChange={(event) => updateForm('comment', event.target.value)}
                                    rows={6}
                                    maxLength={3000}
                                    placeholder="Nhập nội dung đánh giá hoặc phản hồi..."
                                    className="rounded-md border border-primary/10 px-3 py-3 font-normal leading-6 text-stone-700 outline-none focus:border-primary/40"
                                />
                                <span className="text-right text-xs text-stone-400">{form.comment.length}/3000</span>
                            </label>
                        </div>

                        <div className="mt-5 flex justify-end gap-3 border-t border-primary/10 pt-4">
                            <button
                                type="button"
                                onClick={() => setIsFormOpen(false)}
                                className="min-h-11 rounded-full border border-primary/10 px-5 text-sm font-black text-primary"
                            >
                                Hủy
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="min-h-11 rounded-full bg-primary px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? 'Đang lưu...' : 'Lưu'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </div>
    );
}
