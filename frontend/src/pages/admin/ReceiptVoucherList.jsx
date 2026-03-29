import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import { receiptVoucherApi } from '../../services/api';
import {
    formatWholeMoneyInput,
    normalizeWholeMoneyDraft,
    normalizeWholeMoneyNumber,
} from '../../utils/money';

const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const dataPanelClass = 'overflow-hidden rounded-md border border-primary/10 bg-white shadow-xl';
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const selectClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 pr-8 text-[13px] text-primary outline-none transition focus:border-primary';
const textAreaClass = 'min-h-[110px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[13px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-black text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const iconButtonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const dangerButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-brick px-4 text-[13px] font-black text-white transition hover:bg-brick/90 disabled:cursor-not-allowed disabled:opacity-60';
const summaryCardClass = 'rounded-sm border border-primary/10 bg-white p-4 shadow-sm';
const checkboxClass = 'h-4 w-4 rounded-sm border-primary/20 accent-primary';
const pageTitle = 'Phiếu thu';

const toDateInputValue = (dateValue = new Date()) => {
    const date = new Date(dateValue);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const shiftDate = (baseDate, offsetDays) => {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offsetDays);
    return toDateInputValue(date);
};

const todayValue = toDateInputValue();

const createDefaultFilters = (view = 'active') => ({
    search: '',
    counterparty_name: '',
    counterparty_phone: '',
    category_id: '',
    payment_method: '',
    status: '',
    date_from: shiftDate(todayValue, -29),
    date_to: todayValue,
    view,
    page: 1,
    per_page: 20,
});

const emptyPagination = {
    current_page: 1,
    last_page: 1,
    per_page: 20,
    total: 0,
};

const normalizePagination = (payload = {}) => ({
    current_page: Number(payload.current_page || 1),
    last_page: Number(payload.last_page || 1),
    per_page: Number(payload.per_page || 20),
    total: Number(payload.total || 0),
});

const createDefaultForm = (bootstrap = {}) => {
    const suggestedWalletId = suggestWalletId('cash', bootstrap.wallets || []);

    return {
        transaction_date: todayValue,
        category_id: '',
        source_name: '',
        counterparty_name: '',
        counterparty_phone: '',
        amount: '',
        payment_method: 'cash',
        wallet_id: suggestedWalletId ? String(suggestedWalletId) : '',
        status: 'draft',
        reference_type: '',
        reference_id: '',
        reference_code: '',
        reference_label: '',
        note: '',
    };
};

const formatMoney = (value) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0))} đ`;

const formatDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN');
};

const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    })}`;
};

const truncateText = (value, maxLength = 80) => {
    const text = String(value || '').trim();
    if (!text) return '-';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const fieldError = (errors, field) => {
    const entry = errors?.[field];
    if (!entry) return '';
    return Array.isArray(entry) ? entry[0] : String(entry);
};

const suggestWalletId = (paymentMethod, wallets = []) => {
    if (!Array.isArray(wallets) || wallets.length === 0) return '';

    const preferredType = paymentMethod === 'cash' ? 'cash' : ['bank_transfer', 'cod', 'card', 'ewallet'].includes(paymentMethod) ? 'bank' : null;
    const candidates = preferredType ? wallets.filter((wallet) => wallet.type === preferredType) : wallets;
    const preferred = candidates.find((wallet) => wallet.is_default) || candidates[0] || wallets[0];

    return preferred?.id ? String(preferred.id) : '';
};

const statusToneMap = {
    draft: 'border-sky-200 bg-sky-50 text-sky-700',
    confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    cancelled: 'border-stone-200 bg-stone-100 text-stone-600',
};

const paymentToneMap = {
    cash: 'border-amber-200 bg-amber-50 text-amber-700',
    bank_transfer: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    cod: 'border-rose-200 bg-rose-50 text-rose-700',
    card: 'border-violet-200 bg-violet-50 text-violet-700',
    ewallet: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    other: 'border-stone-200 bg-stone-100 text-stone-600',
};

const SummaryCard = ({ label, value, subtext, icon }) => (
    <div className={summaryCardClass}>
        <div className="flex items-start justify-between gap-3">
            <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">{label}</p>
                <p className="mt-3 text-[22px] font-black tracking-tight text-primary">{value}</p>
                {subtext ? <p className="mt-2 text-[12px] text-primary/55">{subtext}</p> : null}
            </div>
            <span className="material-symbols-outlined text-[22px] text-primary/30">{icon}</span>
        </div>
    </div>
);

const ModalShell = ({ open, title, onClose, children, footer, maxWidth = 'max-w-5xl' }) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={onClose} />
            <div className={`relative w-full ${maxWidth} overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_24px_80px_-28px_rgba(27,54,93,0.55)]`}>
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <h3 className="text-[18px] font-black text-primary">{title}</h3>
                    <button type="button" onClick={onClose} className={iconButtonClass} title="Đóng">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div className="max-h-[calc(100vh-180px)] overflow-auto px-5 py-5">{children}</div>
                {footer ? <div className="border-t border-primary/10 px-5 py-4">{footer}</div> : null}
            </div>
        </div>
    );
};

const Field = ({ label, required = false, error = '', children }) => (
    <label className="space-y-2">
        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">
            {label}
            {required ? <span className="ml-1 text-brick">*</span> : null}
        </span>
        {children}
        {error ? <p className="text-[11px] font-semibold text-brick">{error}</p> : null}
    </label>
);

export default function ReceiptVoucherList() {
    const [bootstrap, setBootstrap] = useState({
        statuses: [],
        payment_methods: [],
        reference_types: [],
        receipt_types: [],
        wallets: [],
        recent_orders: [],
        recent_shipments: [],
        recent_return_documents: [],
    });
    const [filters, setFilters] = useState(() => createDefaultFilters());
    const [draftFilters, setDraftFilters] = useState(() => createDefaultFilters());
    const [pagination, setPagination] = useState(emptyPagination);
    const [receipts, setReceipts] = useState([]);
    const [summary, setSummary] = useState({
        total_records: 0,
        confirmed_count: 0,
        draft_count: 0,
        cancelled_count: 0,
        trash_count: 0,
        total_amount: 0,
        cash_amount: 0,
        bank_transfer_amount: 0,
        cod_amount: 0,
        main_groups: [],
    });
    const [loadingBootstrap, setLoadingBootstrap] = useState(true);
    const [loadingTable, setLoadingTable] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [notice, setNotice] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [modalState, setModalState] = useState({
        open: false,
        mode: 'create',
        loading: false,
        receiptId: null,
    });
    const [formState, setFormState] = useState(() => createDefaultForm());
    const [formErrors, setFormErrors] = useState({});
    const requestIdRef = useRef(0);

    useEffect(() => {
        document.title = 'Phiếu thu | Admin';
    }, []);

    useEffect(() => {
        let ignore = false;

        async function loadBootstrap() {
            setLoadingBootstrap(true);

            try {
                const response = await receiptVoucherApi.getBootstrap();
                if (ignore) return;

                const payload = response.data || {};
                setBootstrap({
                    statuses: payload.statuses || [],
                    payment_methods: payload.payment_methods || [],
                    reference_types: payload.reference_types || [],
                    receipt_types: payload.receipt_types || [],
                    wallets: payload.wallets || [],
                    recent_orders: payload.recent_orders || [],
                    recent_shipments: payload.recent_shipments || [],
                    recent_return_documents: payload.recent_return_documents || [],
                });
                setFormState(createDefaultForm(payload));
            } catch (error) {
                if (!ignore) {
                    setNotice({
                        type: 'error',
                        message: error.response?.data?.message || 'Không thể tải dữ liệu nền cho Phiếu thu.',
                    });
                }
            } finally {
                if (!ignore) setLoadingBootstrap(false);
            }
        }

        loadBootstrap();

        return () => {
            ignore = true;
        };
    }, []);

    useEffect(() => {
        const nextRequestId = requestIdRef.current + 1;
        requestIdRef.current = nextRequestId;

        async function loadReceipts() {
            setLoadingTable(true);

            try {
                const response = await receiptVoucherApi.getAll({
                    search: filters.search,
                    counterparty_name: filters.counterparty_name,
                    counterparty_phone: filters.counterparty_phone,
                    category_id: filters.category_id || undefined,
                    payment_method: filters.payment_method || undefined,
                    status: filters.status || undefined,
                    date_from: filters.date_from || undefined,
                    date_to: filters.date_to || undefined,
                    view: filters.view,
                    page: filters.page,
                    per_page: filters.per_page,
                });

                if (requestIdRef.current !== nextRequestId) return;

                const payload = response.data || {};
                setReceipts(payload.data || []);
                setPagination(normalizePagination(payload));
                setSummary({
                    total_records: Number(payload.summary?.total_records || 0),
                    confirmed_count: Number(payload.summary?.confirmed_count || 0),
                    draft_count: Number(payload.summary?.draft_count || 0),
                    cancelled_count: Number(payload.summary?.cancelled_count || 0),
                    trash_count: Number(payload.summary?.trash_count || 0),
                    total_amount: Number(payload.summary?.total_amount || 0),
                    cash_amount: Number(payload.summary?.cash_amount || 0),
                    bank_transfer_amount: Number(payload.summary?.bank_transfer_amount || 0),
                    cod_amount: Number(payload.summary?.cod_amount || 0),
                    main_groups: payload.summary?.main_groups || [],
                });
            } catch (error) {
                if (requestIdRef.current !== nextRequestId) return;

                setNotice({
                    type: 'error',
                    message: error.response?.data?.message || 'Không thể tải danh sách Phiếu thu.',
                });
            } finally {
                if (requestIdRef.current === nextRequestId) {
                    setLoadingTable(false);
                }
            }
        }

        loadReceipts();
    }, [filters, reloadKey]);

    useEffect(() => {
        setSelectedIds([]);
    }, [receipts, filters.view]);

    const receiptTypeMap = useMemo(
        () => Object.fromEntries((bootstrap.receipt_types || []).map((item) => [String(item.id), item])),
        [bootstrap.receipt_types]
    );

    const paymentMethodMap = useMemo(
        () => Object.fromEntries((bootstrap.payment_methods || []).map((item) => [String(item.value), item])),
        [bootstrap.payment_methods]
    );

    const statusMap = useMemo(
        () => Object.fromEntries((bootstrap.statuses || []).map((item) => [String(item.value), item])),
        [bootstrap.statuses]
    );

    const defaultFilterSnapshot = useMemo(() => createDefaultFilters(filters.view), [filters.view]);

    const activeAdvancedFilterCount = useMemo(() => (
        [
            Boolean(filters.counterparty_name),
            Boolean(filters.counterparty_phone),
            Boolean(filters.category_id),
            Boolean(filters.payment_method),
            Boolean(filters.status),
            Boolean(filters.date_from && filters.date_from !== defaultFilterSnapshot.date_from),
            Boolean(filters.date_to && filters.date_to !== defaultFilterSnapshot.date_to),
        ].filter(Boolean).length
    ), [defaultFilterSnapshot.date_from, defaultFilterSnapshot.date_to, filters]);

    const pageIds = receipts.map((receipt) => receipt.id);
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    const pageStartIndex = (pagination.current_page - 1) * pagination.per_page;

    const referenceOptions = useMemo(() => {
        if (formState.reference_type === 'order') {
            return (bootstrap.recent_orders || []).map((order) => ({
                value: String(order.id),
                label: `${order.code} • ${order.customer_name || 'Khách'}${order.customer_phone ? ` • ${order.customer_phone}` : ''}`,
                code: order.code,
                referenceLabel: order.customer_name || order.code,
            }));
        }

        if (formState.reference_type === 'shipment') {
            return (bootstrap.recent_shipments || []).map((shipment) => ({
                value: String(shipment.id),
                label: `${shipment.code || `Vận đơn #${shipment.id}`} • ${shipment.customer_name || 'Khách'}${shipment.customer_phone ? ` • ${shipment.customer_phone}` : ''}`,
                code: shipment.code || `#${shipment.id}`,
                referenceLabel: shipment.customer_name || shipment.code || `Vận đơn #${shipment.id}`,
            }));
        }

        if (formState.reference_type === 'return_slip') {
            return (bootstrap.recent_return_documents || []).map((document) => ({
                value: String(document.id),
                label: `${document.code || `Phiếu #${document.id}`} • ${document.document_date || '-'}`,
                code: document.code || `#${document.id}`,
                referenceLabel: 'Phiếu hoàn',
            }));
        }

        return [];
    }, [bootstrap.recent_orders, bootstrap.recent_return_documents, bootstrap.recent_shipments, formState.reference_type]);

    const modalTitle = modalState.mode === 'create'
        ? 'Tạo mới Phiếu thu'
        : modalState.mode === 'edit'
            ? 'Cập nhật Phiếu thu'
            : 'Chi tiết Phiếu thu';

    const isReadOnlyModal = modalState.mode === 'view';

    const updateDraftFilter = (field, value) => {
        setDraftFilters((previous) => ({ ...previous, [field]: value }));
    };

    const applyFilters = (overrides = {}) => {
        const nextFilters = {
            ...draftFilters,
            ...overrides,
            page: overrides.page || 1,
        };
        setFilters(nextFilters);
        setDraftFilters(nextFilters);
    };

    const refreshTable = () => {
        setReloadKey((previous) => previous + 1);
    };

    const toggleTrashView = () => {
        const nextView = filters.view === 'trash' ? 'active' : 'trash';
        const nextFilters = {
            ...draftFilters,
            view: nextView,
            page: 1,
        };
        setDraftFilters(nextFilters);
        setFilters(nextFilters);
    };

    const handlePageChange = (page) => {
        setFilters((previous) => ({ ...previous, page }));
        setDraftFilters((previous) => ({ ...previous, page }));
    };

    const handlePerPageChange = (value) => {
        const perPage = Number(value || 20);
        const nextFilters = {
            ...draftFilters,
            per_page: perPage,
            page: 1,
        };
        setDraftFilters(nextFilters);
        setFilters(nextFilters);
    };

    const toggleSelectOne = (id) => {
        setSelectedIds((previous) => (
            previous.includes(id)
                ? previous.filter((item) => item !== id)
                : [...previous, id]
        ));
    };

    const toggleSelectAllPage = () => {
        setSelectedIds((previous) => (
            allPageSelected
                ? previous.filter((id) => !pageIds.includes(id))
                : Array.from(new Set([...previous, ...pageIds]))
        ));
    };

    const openCreateModal = () => {
        setModalState({ open: true, mode: 'create', loading: false, receiptId: null });
        setFormState(createDefaultForm(bootstrap));
        setFormErrors({});
    };

    const openReceiptModal = async (mode, receiptId) => {
        setModalState({ open: true, mode, loading: true, receiptId });
        setFormErrors({});

        try {
            const response = await receiptVoucherApi.getOne(receiptId);
            const payload = response.data || {};
            setFormState({
                transaction_date: payload.transaction_date ? payload.transaction_date.slice(0, 10) : todayValue,
                category_id: payload.category_id ? String(payload.category_id) : '',
                source_name: payload.source_name || '',
                counterparty_name: payload.counterparty_name || '',
                counterparty_phone: payload.counterparty_phone || '',
                amount: normalizeWholeMoneyDraft(payload.amount),
                payment_method: payload.payment_method || 'cash',
                wallet_id: payload.wallet_id ? String(payload.wallet_id) : '',
                status: payload.status || 'draft',
                reference_type: payload.reference_type || '',
                reference_id: payload.reference_id ? String(payload.reference_id) : '',
                reference_code: payload.reference_code || '',
                reference_label: payload.reference_label || '',
                note: payload.note || '',
            });
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể tải chi tiết Phiếu thu.',
            });
            setModalState({ open: false, mode: 'create', loading: false, receiptId: null });
        } finally {
            setModalState((previous) => ({ ...previous, loading: false }));
        }
    };

    const closeModal = () => {
        if (submitting) return;
        setModalState({ open: false, mode: 'create', loading: false, receiptId: null });
        setFormErrors({});
    };

    const updateFormField = (field, value) => {
        setFormState((previous) => ({ ...previous, [field]: value }));
        setFormErrors((previous) => ({ ...previous, [field]: undefined }));
    };

    const handlePaymentMethodChange = (value) => {
        setFormState((previous) => ({
            ...previous,
            payment_method: value,
            wallet_id: previous.wallet_id || suggestWalletId(value, bootstrap.wallets || []),
        }));
        setFormErrors((previous) => ({ ...previous, payment_method: undefined }));
    };

    const handleReferenceTypeChange = (value) => {
        setFormState((previous) => ({
            ...previous,
            reference_type: value,
            reference_id: '',
            reference_code: '',
            reference_label: '',
        }));
        setFormErrors((previous) => ({
            ...previous,
            reference_type: undefined,
            reference_id: undefined,
            reference_code: undefined,
            reference_label: undefined,
        }));
    };

    const handleReferenceSelect = (value) => {
        const selected = referenceOptions.find((option) => option.value === value);

        setFormState((previous) => ({
            ...previous,
            reference_id: value,
            reference_code: selected?.code || '',
            reference_label: selected?.referenceLabel || '',
        }));
        setFormErrors((previous) => ({ ...previous, reference_id: undefined }));
    };

    const buildSubmitPayload = () => ({
        transaction_date: formState.transaction_date,
        category_id: formState.category_id ? Number(formState.category_id) : null,
        source_name: formState.source_name.trim(),
        counterparty_name: formState.counterparty_name.trim(),
        counterparty_phone: formState.counterparty_phone.trim() || null,
        amount: normalizeWholeMoneyNumber(formState.amount),
        payment_method: formState.payment_method,
        wallet_id: formState.wallet_id ? Number(formState.wallet_id) : null,
        status: formState.status,
        reference_type: formState.reference_type || null,
        reference_id: formState.reference_id ? Number(formState.reference_id) : null,
        reference_code: formState.reference_code.trim() || null,
        reference_label: formState.reference_label.trim() || null,
        note: formState.note.trim() || null,
    });

    const submitModal = async () => {
        setSubmitting(true);
        setFormErrors({});

        try {
            const payload = buildSubmitPayload();

            if (modalState.mode === 'edit' && modalState.receiptId) {
                await receiptVoucherApi.update(modalState.receiptId, payload);
                setNotice({ type: 'success', message: 'Đã cập nhật Phiếu thu.' });
            } else {
                await receiptVoucherApi.create(payload);
                setNotice({ type: 'success', message: 'Đã tạo mới Phiếu thu.' });
            }

            closeModal();
            refreshTable();
        } catch (error) {
            setFormErrors(error.response?.data?.errors || {});
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể lưu Phiếu thu.',
            });
        } finally {
            setSubmitting(false);
        }
    };

    const softDeleteReceipt = async (id) => {
        if (!window.confirm('Đưa Phiếu thu này vào thùng rác?')) return;

        try {
            await receiptVoucherApi.destroy(id);
            setNotice({ type: 'success', message: 'Đã chuyển Phiếu thu vào thùng rác.' });
            refreshTable();
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể xóa mềm Phiếu thu.',
            });
        }
    };

    const restoreReceipt = async (id) => {
        try {
            await receiptVoucherApi.restore(id);
            setNotice({ type: 'success', message: 'Đã khôi phục Phiếu thu.' });
            refreshTable();
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể khôi phục Phiếu thu.',
            });
        }
    };

    const forceDeleteReceipt = async (id) => {
        if (!window.confirm('Xóa vĩnh viễn Phiếu thu này? Thao tác không thể hoàn tác.')) return;

        try {
            await receiptVoucherApi.forceDelete(id);
            setNotice({ type: 'success', message: 'Đã xóa vĩnh viễn Phiếu thu.' });
            refreshTable();
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể xóa vĩnh viễn Phiếu thu.',
            });
        }
    };

    const runBulkAction = async (action) => {
        if (selectedIds.length === 0) return;

        const confirmationMap = {
            delete: 'Đưa các Phiếu thu đã chọn vào thùng rác?',
            restore: 'Khôi phục các Phiếu thu đã chọn?',
            force: 'Xóa vĩnh viễn các Phiếu thu đã chọn? Thao tác không thể hoàn tác.',
        };

        if (!window.confirm(confirmationMap[action])) return;

        try {
            if (action === 'delete') {
                await receiptVoucherApi.bulkDelete(selectedIds);
                setNotice({ type: 'success', message: 'Đã đưa các Phiếu thu đã chọn vào thùng rác.' });
            } else if (action === 'restore') {
                await receiptVoucherApi.bulkRestore(selectedIds);
                setNotice({ type: 'success', message: 'Đã khôi phục các Phiếu thu đã chọn.' });
            } else {
                await receiptVoucherApi.bulkForceDelete(selectedIds);
                setNotice({ type: 'success', message: 'Đã xóa vĩnh viễn các Phiếu thu đã chọn.' });
            }

            setSelectedIds([]);
            refreshTable();
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể thực hiện thao tác hàng loạt.',
            });
        }
    };

    const renderStatusBadge = (status, deletedAt = null) => (
        <div className="space-y-1">
            <span className={`inline-flex items-center rounded-sm border px-2 py-1 text-[11px] font-black ${statusToneMap[status] || statusToneMap.draft}`}>
                {statusMap[status]?.label || status || 'Nháp'}
            </span>
            {deletedAt ? <p className="text-[10px] text-primary/40">Xóa lúc {formatDateTime(deletedAt)}</p> : null}
        </div>
    );

    const renderReferenceCell = (receipt) => {
        const reference = receipt.reference;

        if (!reference?.summary) {
            return <span className="text-primary/30">-</span>;
        }

        const content = (
            <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-sm border border-primary/10 bg-primary/[0.03] px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary/55">
                        {reference.type_label || 'Liên kết'}
                    </span>
                    {reference.status ? <span className="text-[10px] font-semibold text-primary/45">{reference.status}</span> : null}
                </div>
                <p className="text-[12px] font-black text-primary">{reference.code || reference.label}</p>
                {reference.label && reference.label !== reference.code ? (
                    <p className="text-[11px] text-primary/55">{reference.label}</p>
                ) : null}
            </div>
        );

        return reference.route ? (
            <Link to={reference.route} className="block rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2 transition hover:border-primary/25 hover:bg-white">
                {content}
            </Link>
        ) : (
            <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2">
                {content}
            </div>
        );
    };

    if (loadingBootstrap && !bootstrap.statuses.length && !bootstrap.receipt_types.length) {
        return (
            <div className="flex h-[70vh] items-center justify-center">
                <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-4 shadow-xl">
                    <div className="h-7 w-7 animate-refresh-spin rounded-full border-4 border-primary/10 border-t-primary" />
                    <span className="text-[13px] font-black uppercase tracking-[0.16em] text-primary">Đang tải Phiếu thu</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">
                        <span>Tài chính</span>
                        <span>/</span>
                        <span className="text-primary">{pageTitle}</span>
                    </div>
                    <div>
                        <h1 className="text-[28px] font-black tracking-tight text-primary">{pageTitle}</h1>
                        <p className="mt-1 max-w-4xl text-[13px] text-primary/60">
                            Theo dõi toàn bộ khoản thu, quản lý trạng thái phiếu, lọc nhanh theo thời gian và đối tượng nộp mà không thay đổi luồng thao tác hiện có.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <AccountSelector />
                    <button type="button" className={primaryButtonClass} onClick={openCreateModal}>
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        <span>Tạo mới</span>
                    </button>
                </div>
            </div>

            {notice ? (
                <div className={`rounded-sm border px-4 py-3 text-[13px] font-semibold ${notice.type === 'error' ? 'border-brick/25 bg-brick/10 text-brick' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {notice.message}
                </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SummaryCard label="Tổng số phiếu" value={summary.total_records} subtext={`${summary.confirmed_count} đã xác nhận`} icon="receipt_long" />
                <SummaryCard label="Tổng tiền đã thu" value={formatMoney(summary.total_amount)} subtext={`${summary.draft_count} nháp / ${summary.cancelled_count} hủy`} icon="payments" />
                <SummaryCard label="Tiền mặt" value={formatMoney(summary.cash_amount)} subtext="Đã xác nhận" icon="account_balance_wallet" />
                <SummaryCard label="Chuyển khoản" value={formatMoney(summary.bank_transfer_amount)} subtext="Đã xác nhận" icon="account_balance" />
                <SummaryCard label="COD" value={formatMoney(summary.cod_amount)} subtext={`${summary.trash_count} trong thùng rác`} icon="local_shipping" />
            </div>

            {summary.main_groups.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-primary/10 bg-primary/5 p-2">
                    <span className="px-2 text-[11px] font-black uppercase tracking-[0.14em] text-primary/40">Nhóm thu chính</span>
                    {summary.main_groups.slice(0, 5).map((group) => (
                        <span key={`${group.category_id || 'uncategorized'}-${group.category_name}`} className="inline-flex items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] font-bold text-primary shadow-sm">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.category_color || '#1b365d' }} />
                            <span>{group.category_name}</span>
                            <span className="text-primary/45">{formatMoney(group.total_amount)}</span>
                        </span>
                    ))}
                </div>
            ) : null}

            <div className={panelClass}>
                <div className="flex flex-col gap-4 px-4 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className={primaryButtonClass} onClick={openCreateModal}>
                                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                                <span>Tạo mới</span>
                            </button>
                            <button type="button" className={secondaryButtonClass} onClick={() => setShowFilterPanel((previous) => !previous)}>
                                <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                                <span>Bộ lọc{activeAdvancedFilterCount ? ` (${activeAdvancedFilterCount})` : ''}</span>
                            </button>
                            <button type="button" className={secondaryButtonClass} onClick={refreshTable}>
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                                <span>Làm mới</span>
                            </button>
                            <button type="button" className={`${secondaryButtonClass} ${filters.view === 'trash' ? '!border-brick/30 !bg-brick/5 !text-brick' : ''}`} onClick={toggleTrashView}>
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                <span>Thùng rác{summary.trash_count ? ` (${summary.trash_count})` : ''}</span>
                            </button>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="relative min-w-[280px]">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                <input
                                    type="text"
                                    value={draftFilters.search}
                                    onChange={(event) => updateDraftFilter('search', event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') applyFilters();
                                    }}
                                    placeholder="Mã phiếu, khách, SĐT, mã liên kết..."
                                    className={`${inputClass} w-full pl-10`}
                                />
                            </div>
                            <button type="button" className={secondaryButtonClass} onClick={() => applyFilters()}>
                                <span className="material-symbols-outlined text-[18px]">manage_search</span>
                                <span>Tìm nhanh</span>
                            </button>
                        </div>
                    </div>

                    {selectedIds.length ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-primary/10 bg-[#f8fbff] px-3 py-3">
                            <span className="text-[12px] font-black text-primary">Đã chọn {selectedIds.length} dòng</span>
                            {filters.view === 'trash' ? (
                                <>
                                    <button type="button" className={secondaryButtonClass} onClick={() => runBulkAction('restore')}>
                                        <span className="material-symbols-outlined text-[18px]">restore_from_trash</span>
                                        <span>Khôi phục</span>
                                    </button>
                                    <button type="button" className={dangerButtonClass} onClick={() => runBulkAction('force')}>
                                        <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                        <span>Xóa vĩnh viễn</span>
                                    </button>
                                </>
                            ) : (
                                <button type="button" className={dangerButtonClass} onClick={() => runBulkAction('delete')}>
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                    <span>Xóa mềm</span>
                                </button>
                            )}
                        </div>
                    ) : null}

                    {showFilterPanel ? (
                        <div className="grid gap-4 rounded-sm border border-primary/10 bg-primary/[0.02] p-4 md:grid-cols-2 xl:grid-cols-4">
                            <Field label="Tên khách">
                                <input type="text" value={draftFilters.counterparty_name} onChange={(event) => updateDraftFilter('counterparty_name', event.target.value)} className={`${inputClass} w-full`} placeholder="Nguyễn Văn A" />
                            </Field>
                            <Field label="Số điện thoại">
                                <input type="text" value={draftFilters.counterparty_phone} onChange={(event) => updateDraftFilter('counterparty_phone', event.target.value)} className={`${inputClass} w-full`} placeholder="090..." />
                            </Field>
                            <Field label="Loại thu">
                                <div className="relative">
                                    <select value={draftFilters.category_id} onChange={(event) => updateDraftFilter('category_id', event.target.value)} className={`${selectClass} w-full appearance-none`}>
                                        <option value="">Tất cả</option>
                                        {(bootstrap.receipt_types || []).map((type) => (
                                            <option key={type.id} value={type.id}>{type.name}</option>
                                        ))}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Phương thức thu">
                                <div className="relative">
                                    <select value={draftFilters.payment_method} onChange={(event) => updateDraftFilter('payment_method', event.target.value)} className={`${selectClass} w-full appearance-none`}>
                                        <option value="">Tất cả</option>
                                        {(bootstrap.payment_methods || []).map((method) => (
                                            <option key={method.value} value={method.value}>{method.label}</option>
                                        ))}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Trạng thái">
                                <div className="relative">
                                    <select value={draftFilters.status} onChange={(event) => updateDraftFilter('status', event.target.value)} className={`${selectClass} w-full appearance-none`}>
                                        <option value="">Tất cả</option>
                                        {(bootstrap.statuses || []).map((status) => (
                                            <option key={status.value} value={status.value}>{status.label}</option>
                                        ))}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Từ ngày">
                                <input type="date" value={draftFilters.date_from} onChange={(event) => updateDraftFilter('date_from', event.target.value)} className={`${inputClass} w-full`} />
                            </Field>
                            <Field label="Đến ngày">
                                <input type="date" value={draftFilters.date_to} onChange={(event) => updateDraftFilter('date_to', event.target.value)} className={`${inputClass} w-full`} />
                            </Field>
                            <div className="flex flex-wrap items-end gap-2 xl:col-span-2">
                                <button type="button" className={secondaryButtonClass} onClick={() => applyFilters()}>
                                    <span className="material-symbols-outlined text-[18px]">check</span>
                                    <span>Áp dụng</span>
                                </button>
                                <button
                                    type="button"
                                    className={secondaryButtonClass}
                                    onClick={() => {
                                        const next = createDefaultFilters(filters.view);
                                        setDraftFilters(next);
                                        setFilters(next);
                                    }}
                                >
                                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                                    <span>Đặt lại</span>
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className={dataPanelClass}>
                <div className="relative overflow-auto table-scrollbar">
                    <table className="min-w-[1680px] border-collapse text-left">
                        <thead className="sticky top-0 z-20 bg-[#F8FAFC] shadow-sm">
                            <tr>
                                <th className="border-b border-r border-primary/10 px-3 py-3 text-center text-[12px] font-black text-primary">
                                    <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAllPage} className={checkboxClass} />
                                </th>
                                {['STT', 'Mã phiếu thu', 'Ngày thu', 'Loại thu', 'Nguồn thu', 'Đối tượng nộp', 'Liên kết', 'Số tiền', 'Phương thức', 'Người tạo', 'Ghi chú', 'Trạng thái', ''].map((label) => (
                                    <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary last:border-r-0">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {receipts.length === 0 && !loadingTable ? (
                                <tr>
                                    <td colSpan={13} className="px-6 py-16 text-center">
                                        <div className="mx-auto max-w-lg space-y-3">
                                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/5 text-primary/25">
                                                <span className="material-symbols-outlined text-[34px]">payments</span>
                                            </div>
                                            <h3 className="text-[22px] font-black text-primary">Chưa có Phiếu thu trong bộ lọc này</h3>
                                            <p className="text-[14px] leading-6 text-primary/55">Thử đổi khoảng thời gian, bộ lọc hoặc tạo phiếu thu mới để bắt đầu theo dõi thu tiền.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                receipts.map((receipt, index) => {
                                    const isSelected = selectedIds.includes(receipt.id);
                                    const receiptType = receiptTypeMap[String(receipt.category_id)];
                                    const paymentMethod = paymentMethodMap[String(receipt.payment_method)];

                                    return (
                                        <tr key={receipt.id} className={`border-b border-primary/10 ${isSelected ? 'bg-primary/[0.04]' : 'odd:bg-white even:bg-primary/[0.02] hover:bg-gold/5'}`}>
                                            <td className="border-r border-primary/10 px-3 py-3 text-center">
                                                <input type="checkbox" checked={isSelected} onChange={() => toggleSelectOne(receipt.id)} className={checkboxClass} />
                                            </td>
                                            <td className="border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{pageStartIndex + index + 1}</td>
                                            <td className="border-r border-primary/10 px-3 py-3">
                                                <div className="space-y-1">
                                                    <p className="font-black text-primary">{receipt.code}</p>
                                                    <p className="text-[10px] text-primary/40">{receipt.reference?.type_label || 'Thu độc lập'}</p>
                                                </div>
                                            </td>
                                            <td className="border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-primary">{formatDate(receipt.receipt_date)}</td>
                                            <td className="border-r border-primary/10 px-3 py-3">
                                                <span className="inline-flex items-center gap-2 rounded-sm border px-2 py-1 text-[11px] font-black" style={{ borderColor: `${receiptType?.color || '#1b365d'}33`, backgroundColor: `${receiptType?.color || '#1b365d'}12`, color: receiptType?.color || '#1b365d' }}>
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: receiptType?.color || '#1b365d' }} />
                                                    {receipt.category_name || 'Chưa phân loại'}
                                                </span>
                                            </td>
                                            <td className="border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{truncateText(receipt.source_name, 42)}</td>
                                            <td className="border-r border-primary/10 px-3 py-3">
                                                <div className="space-y-1">
                                                    <p className="text-[12px] font-black text-primary">{receipt.counterparty_name || '-'}</p>
                                                    <p className="text-[11px] text-primary/55">{receipt.counterparty_phone || '-'}</p>
                                                </div>
                                            </td>
                                            <td className="border-r border-primary/10 px-3 py-3">{renderReferenceCell(receipt)}</td>
                                            <td className="border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatMoney(receipt.amount)}</td>
                                            <td className="border-r border-primary/10 px-3 py-3">
                                                <span className={`inline-flex items-center rounded-sm border px-2 py-1 text-[11px] font-black ${paymentToneMap[receipt.payment_method] || paymentToneMap.other}`}>
                                                    {paymentMethod?.label || receipt.payment_method_label || receipt.payment_method || 'Khác'}
                                                </span>
                                            </td>
                                            <td className="border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{receipt.created_by_name || '-'}</td>
                                            <td className="border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{truncateText(receipt.note, 68)}</td>
                                            <td className="border-r border-primary/10 px-3 py-3">{renderStatusBadge(receipt.status, filters.view === 'trash' ? receipt.deleted_at : null)}</td>
                                            <td className="px-3 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button type="button" className={iconButtonClass} title="Xem chi tiết" onClick={() => openReceiptModal('view', receipt.id)}>
                                                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                                                    </button>
                                                    {filters.view === 'trash' ? (
                                                        <>
                                                            <button type="button" className={iconButtonClass} title="Khôi phục" onClick={() => restoreReceipt(receipt.id)}>
                                                                <span className="material-symbols-outlined text-[18px]">restore_from_trash</span>
                                                            </button>
                                                            <button type="button" className={iconButtonClass} title="Xóa vĩnh viễn" onClick={() => forceDeleteReceipt(receipt.id)}>
                                                                <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button type="button" className={iconButtonClass} title="Chỉnh sửa" onClick={() => openReceiptModal('edit', receipt.id)}>
                                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                                            </button>
                                                            <button type="button" className={iconButtonClass} title="Xóa mềm" onClick={() => softDeleteReceipt(receipt.id)}>
                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>

                    {loadingTable ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/65 backdrop-blur-[1px]">
                            <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-3 shadow-xl">
                                <div className="h-6 w-6 animate-refresh-spin rounded-full border-4 border-primary/10 border-t-primary" />
                                <span className="text-[13px] font-black uppercase tracking-[0.16em] text-primary">Đang tải bảng</span>
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="flex flex-col gap-3 border-t border-primary/10 px-4 py-4 text-[13px] font-bold text-primary/45 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap items-center gap-4">
                        <span>Hiển thị {receipts.length} / {pagination.total}</span>
                        <div className="flex items-center gap-2">
                            <span>Số dòng:</span>
                            <select value={filters.per_page} onChange={(event) => handlePerPageChange(event.target.value)} className="rounded-sm border border-primary/10 bg-white px-2 py-1 font-black text-primary outline-none">
                                {[20, 50, 100].map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <Pagination pagination={pagination} onPageChange={handlePageChange} />
                </div>
            </div>

            <ModalShell
                open={modalState.open}
                title={modalTitle}
                onClose={closeModal}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className={secondaryButtonClass} onClick={closeModal}>
                            Đóng
                        </button>
                        {modalState.mode === 'view' && filters.view !== 'trash' && modalState.receiptId ? (
                            <button type="button" className={primaryButtonClass} onClick={() => openReceiptModal('edit', modalState.receiptId)}>
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                <span>Sửa</span>
                            </button>
                        ) : null}
                        {!isReadOnlyModal ? (
                            <button type="button" className={primaryButtonClass} onClick={submitModal} disabled={submitting || modalState.loading}>
                                <span className="material-symbols-outlined text-[18px]">{submitting ? 'hourglass_top' : 'save'}</span>
                                <span>{modalState.mode === 'edit' ? 'Cập nhật' : 'Lưu Phiếu thu'}</span>
                            </button>
                        ) : null}
                    </div>
                )}
            >
                {modalState.loading ? (
                    <div className="flex min-h-[240px] items-center justify-center">
                        <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-3 shadow-xl">
                            <div className="h-6 w-6 animate-refresh-spin rounded-full border-4 border-primary/10 border-t-primary" />
                            <span className="text-[13px] font-black uppercase tracking-[0.16em] text-primary">Đang tải chi tiết</span>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <Field label="Ngày thu" required error={fieldError(formErrors, 'transaction_date')}>
                                <input type="date" value={formState.transaction_date} onChange={(event) => updateFormField('transaction_date', event.target.value)} className={`${inputClass} w-full`} disabled={isReadOnlyModal} />
                            </Field>
                            <Field label="Loại thu" error={fieldError(formErrors, 'category_id')}>
                                <div className="relative">
                                    <select value={formState.category_id} onChange={(event) => updateFormField('category_id', event.target.value)} className={`${selectClass} w-full appearance-none`} disabled={isReadOnlyModal}>
                                        <option value="">Chọn loại thu</option>
                                        {(bootstrap.receipt_types || []).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Phương thức thu" required error={fieldError(formErrors, 'payment_method')}>
                                <div className="relative">
                                    <select value={formState.payment_method} onChange={(event) => handlePaymentMethodChange(event.target.value)} className={`${selectClass} w-full appearance-none`} disabled={isReadOnlyModal}>
                                        {(bootstrap.payment_methods || []).map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Trạng thái" required error={fieldError(formErrors, 'status')}>
                                <div className="relative">
                                    <select value={formState.status} onChange={(event) => updateFormField('status', event.target.value)} className={`${selectClass} w-full appearance-none`} disabled={isReadOnlyModal}>
                                        {(bootstrap.statuses || []).map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
                            <Field label="Nguồn thu" required error={fieldError(formErrors, 'source_name')}>
                                <input type="text" value={formState.source_name} onChange={(event) => updateFormField('source_name', event.target.value)} className={`${inputClass} w-full`} placeholder="Ví dụ: Thu từ đơn online, thu COD..." disabled={isReadOnlyModal} />
                            </Field>
                            <Field label="Đối tượng nộp" required error={fieldError(formErrors, 'counterparty_name')}>
                                <input type="text" value={formState.counterparty_name} onChange={(event) => updateFormField('counterparty_name', event.target.value)} className={`${inputClass} w-full`} placeholder="Tên khách / đối tác" disabled={isReadOnlyModal} />
                            </Field>
                            <Field label="Số điện thoại" error={fieldError(formErrors, 'counterparty_phone')}>
                                <input type="text" value={formState.counterparty_phone} onChange={(event) => updateFormField('counterparty_phone', event.target.value)} className={`${inputClass} w-full`} placeholder="090..." disabled={isReadOnlyModal} />
                            </Field>
                            <Field label="Số tiền" required error={fieldError(formErrors, 'amount')}>
                                <input type="text" value={formatWholeMoneyInput(formState.amount)} onChange={(event) => updateFormField('amount', normalizeWholeMoneyDraft(event.target.value))} className={`${inputClass} w-full text-right font-black`} inputMode="numeric" placeholder="0" disabled={isReadOnlyModal} />
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <Field label="Quỹ nhận" error={fieldError(formErrors, 'wallet_id')}>
                                <div className="relative">
                                    <select value={formState.wallet_id} onChange={(event) => updateFormField('wallet_id', event.target.value)} className={`${selectClass} w-full appearance-none`} disabled={isReadOnlyModal}>
                                        <option value="">Tự gợi ý theo phương thức</option>
                                        {(bootstrap.wallets || []).map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Loại liên kết" error={fieldError(formErrors, 'reference_type')}>
                                <div className="relative">
                                    <select value={formState.reference_type} onChange={(event) => handleReferenceTypeChange(event.target.value)} className={`${selectClass} w-full appearance-none`} disabled={isReadOnlyModal}>
                                        <option value="">Không liên kết</option>
                                        {(bootstrap.reference_types || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            {['order', 'shipment', 'return_slip'].includes(formState.reference_type) ? (
                                <Field label="Chọn liên kết" error={fieldError(formErrors, 'reference_id')}>
                                    <div className="relative">
                                        <select value={formState.reference_id} onChange={(event) => handleReferenceSelect(event.target.value)} className={`${selectClass} w-full appearance-none`} disabled={isReadOnlyModal}>
                                            <option value="">Chọn dữ liệu liên quan</option>
                                            {referenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                    </div>
                                </Field>
                            ) : null}
                            {['debt', 'other'].includes(formState.reference_type) ? (
                                <>
                                    <Field label="Mã liên kết" error={fieldError(formErrors, 'reference_code')}>
                                        <input type="text" value={formState.reference_code} onChange={(event) => updateFormField('reference_code', event.target.value)} className={`${inputClass} w-full`} placeholder="VD: CN-0001" disabled={isReadOnlyModal} />
                                    </Field>
                                    <Field label="Nhãn liên kết" error={fieldError(formErrors, 'reference_label')}>
                                        <input type="text" value={formState.reference_label} onChange={(event) => updateFormField('reference_label', event.target.value)} className={`${inputClass} w-full`} placeholder="Mô tả công nợ / liên kết" disabled={isReadOnlyModal} />
                                    </Field>
                                </>
                            ) : null}
                            {formState.reference_type === 'return_slip' ? (
                                <Field label="Nhãn liên kết" error={fieldError(formErrors, 'reference_label')}>
                                    <input type="text" value={formState.reference_label} onChange={(event) => updateFormField('reference_label', event.target.value)} className={`${inputClass} w-full`} placeholder="Phiếu hoàn" disabled={isReadOnlyModal} />
                                </Field>
                            ) : null}
                        </div>

                        <Field label="Ghi chú" error={fieldError(formErrors, 'note')}>
                            <textarea value={formState.note} onChange={(event) => updateFormField('note', event.target.value)} className={textAreaClass} placeholder="Ghi chú thêm về khoản thu này..." disabled={isReadOnlyModal} />
                        </Field>

                        {isReadOnlyModal ? (
                            <div className="grid gap-4 rounded-sm border border-primary/10 bg-[#f8fbff] p-4 md:grid-cols-4">
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Số tiền</p>
                                    <p className="mt-2 text-[18px] font-black text-primary">{formatMoney(normalizeWholeMoneyNumber(formState.amount) || 0)}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Phương thức</p>
                                    <p className="mt-2 text-[14px] font-black text-primary">{paymentMethodMap[formState.payment_method]?.label || formState.payment_method || '-'}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Trạng thái</p>
                                    <p className="mt-2 text-[14px] font-black text-primary">{statusMap[formState.status]?.label || formState.status || '-'}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Quỹ nhận</p>
                                    <p className="mt-2 text-[14px] font-black text-primary">{bootstrap.wallets.find((wallet) => String(wallet.id) === formState.wallet_id)?.name || 'Tự động / không gắn quỹ'}</p>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            </ModalShell>
        </div>
    );
}
