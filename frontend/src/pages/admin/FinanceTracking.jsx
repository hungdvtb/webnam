import React, { useEffect, useMemo, useRef, useState } from 'react';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import { useAuth } from '../../context/AuthContext';
import { financeApi } from '../../services/api';
import {
    formatWholeMoneyInput,
    normalizeWholeMoneyDraft,
    normalizeWholeMoneyNumber,
} from '../../utils/money';

const pageTitle = 'Quan ly tien';
const panelClass = 'overflow-hidden rounded-[28px] border border-primary/10 bg-white shadow-[0_24px_80px_-40px_rgba(15,23,42,0.42)]';
const inputClass = 'h-12 w-full rounded-2xl border border-primary/15 bg-white px-4 text-[14px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const selectClass = 'h-12 w-full appearance-none rounded-2xl border border-primary/15 bg-white px-4 pr-10 text-[14px] text-primary outline-none transition focus:border-primary';
const textareaClass = 'min-h-[112px] w-full rounded-2xl border border-primary/15 bg-white px-4 py-3 text-[14px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const primaryButtonClass = 'inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-[14px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-primary/15 bg-white px-5 text-[14px] font-black text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const iconButtonClass = 'inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const todayValue = toDateInputValue();

const emptyPagination = {
    current_page: 1,
    last_page: 1,
    per_page: 20,
    total: 0,
};

const emptyCashbook = {
    overview: {
        total_current_money: 0,
        cash_total: 0,
        bank_total: 0,
        cash_accounts: [],
        bank_accounts: [],
    },
    options: {
        wallets: [],
        categories: {
            income: [],
            expense: [],
        },
        voucher_types: [],
        statuses: [],
    },
    summary: {
        total_records: 0,
        income_total: 0,
        expense_total: 0,
        transfer_total: 0,
    },
    pagination: emptyPagination,
    data: [],
};

const voucherToneMap = {
    income: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    expense: 'border-rose-200 bg-rose-50 text-rose-700',
    transfer: 'border-indigo-200 bg-indigo-50 text-indigo-700',
};

const statusToneMap = {
    confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    draft: 'border-sky-200 bg-sky-50 text-sky-700',
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    cancelled: 'border-stone-200 bg-stone-100 text-stone-600',
};

const rangeOptions = [
    { key: '7d', label: '7 ngay' },
    { key: '30d', label: '30 ngay' },
    { key: 'month', label: 'Thang nay' },
    { key: 'all', label: 'Tat ca' },
];

function toDateInputValue(dateValue = new Date()) {
    const date = new Date(dateValue);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDate(baseDate, offsetDays) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offsetDays);
    return toDateInputValue(date);
}

function createDefaultFilters() {
    return {
        range_key: '30d',
        range: '',
        date_from: shiftDate(todayValue, -29),
        date_to: todayValue,
        voucher_type: '',
        wallet_id: '',
        keyword: '',
        page: 1,
        per_page: 20,
    };
}

function resolveRangeValues(rangeKey) {
    if (rangeKey === '7d') {
        return {
            range_key: '7d',
            range: '',
            date_from: shiftDate(todayValue, -6),
            date_to: todayValue,
        };
    }

    if (rangeKey === 'month') {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

        return {
            range_key: 'month',
            range: '',
            date_from: toDateInputValue(firstDay),
            date_to: todayValue,
        };
    }

    if (rangeKey === 'all') {
        return {
            range_key: 'all',
            range: 'all',
            date_from: '',
            date_to: '',
        };
    }

    return {
        range_key: '30d',
        range: '',
        date_from: shiftDate(todayValue, -29),
        date_to: todayValue,
    };
}

function formatMoney(value) {
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0))} đ`;
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    })}`;
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN');
}

function createEntryForm(wallets = []) {
    const activeWallets = wallets.filter((wallet) => wallet.is_active);
    const firstCash = activeWallets.find((wallet) => wallet.type === 'cash' && wallet.is_default)
        || activeWallets.find((wallet) => wallet.type === 'cash')
        || activeWallets[0]
        || null;
    const firstBank = activeWallets.find((wallet) => wallet.type === 'bank' && wallet.is_default)
        || activeWallets.find((wallet) => wallet.type === 'bank')
        || activeWallets.find((wallet) => wallet.id !== firstCash?.id)
        || activeWallets[0]
        || null;
    const secondWallet = activeWallets.find((wallet) => wallet.id !== firstBank?.id)
        || activeWallets.find((wallet) => wallet.id !== firstCash?.id)
        || null;

    return {
        mode: 'create',
        entry_kind: 'transaction',
        entry_id: null,
        voucher_type: 'expense',
        can_change_voucher_type: true,
        transaction_date: todayValue,
        wallet_id: firstCash ? String(firstCash.id) : '',
        from_wallet_id: firstBank ? String(firstBank.id) : firstCash ? String(firstCash.id) : '',
        to_wallet_id: secondWallet ? String(secondWallet.id) : firstCash ? String(firstCash.id) : '',
        category_id: '',
        amount: '',
        content: '',
        counterparty_name: '',
        note: '',
        status: 'confirmed',
    };
}

function createWalletForm(wallet = null) {
    if (!wallet) {
        return {
            id: null,
            type: 'bank',
            name: '',
            bank_name: '',
            account_number: '',
            opening_balance: '',
            note: '',
            is_active: true,
            is_default: false,
        };
    }

    return {
        id: wallet.id,
        type: wallet.type || 'bank',
        name: wallet.name || '',
        bank_name: wallet.bank_name || '',
        account_number: wallet.account_number || '',
        opening_balance: String(Math.round(Number(wallet.opening_balance || 0))),
        note: wallet.note || '',
        is_active: Boolean(wallet.is_active),
        is_default: Boolean(wallet.is_default),
    };
}

function mapRowToEntryForm(row) {
    return {
        mode: 'edit',
        entry_kind: row.entry_kind,
        entry_id: row.entry_id,
        voucher_type: row.voucher_type,
        can_change_voucher_type: Boolean(row.can_change_voucher_type),
        transaction_date: row.transaction_date ? String(row.transaction_date).slice(0, 10) : todayValue,
        wallet_id: row.wallet_id ? String(row.wallet_id) : '',
        from_wallet_id: row.source_wallet_id ? String(row.source_wallet_id) : '',
        to_wallet_id: row.destination_wallet_id ? String(row.destination_wallet_id) : '',
        category_id: row.category_id ? String(row.category_id) : '',
        amount: String(Math.round(Number(row.amount || 0))),
        content: row.content || '',
        counterparty_name: row.related_party || row.counterparty_name || '',
        note: row.note || '',
        status: row.status || 'confirmed',
    };
}

function SummaryCard({ label, value, subtext, icon }) {
    return (
        <div className="rounded-[28px] border border-primary/10 bg-white p-5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.5)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/45">{label}</p>
                    <p className="mt-3 text-[28px] font-black tracking-tight text-primary">{value}</p>
                    {subtext ? <p className="mt-2 text-[12px] leading-5 text-primary/55">{subtext}</p> : null}
                </div>
                <span className="material-symbols-outlined text-[28px] text-primary/25">{icon}</span>
            </div>
        </div>
    );
}

function Field({ label, required = false, children, helper }) {
    return (
        <label className="space-y-2.5">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/45">
                {label}
                {required ? <span className="ml-1 text-brick">*</span> : null}
            </span>
            {children}
            {helper ? <p className="text-[12px] text-primary/45">{helper}</p> : null}
        </label>
    );
}

function ModalShell({ open, title, onClose, children, footer, maxWidth = 'max-w-5xl' }) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={onClose} />
            <div className={`relative w-full ${maxWidth} overflow-hidden rounded-[30px] border border-primary/10 bg-white shadow-[0_36px_120px_-48px_rgba(15,23,42,0.65)]`}>
                <div className="flex items-center justify-between border-b border-primary/10 px-6 py-5">
                    <div>
                        <h3 className="text-[22px] font-black tracking-tight text-primary">{title}</h3>
                        <p className="mt-1 text-[13px] text-primary/55">Them, sua, tat hoat dong hoac xoa tai khoan tien.</p>
                    </div>
                    <button type="button" onClick={onClose} className={iconButtonClass}>
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div className="max-h-[calc(100vh-180px)] overflow-auto px-6 py-6">{children}</div>
                {footer ? <div className="border-t border-primary/10 px-6 py-4">{footer}</div> : null}
            </div>
        </div>
    );
}

export default function FinanceTracking() {
    const { user } = useAuth();
    const formRef = useRef(null);
    const [cashbook, setCashbook] = useState(emptyCashbook);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [walletSubmitting, setWalletSubmitting] = useState(false);
    const [notice, setNotice] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [filters, setFilters] = useState(() => createDefaultFilters());
    const [draftFilters, setDraftFilters] = useState(() => createDefaultFilters());
    const [entryForm, setEntryForm] = useState(() => createEntryForm());
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [walletModalOpen, setWalletModalOpen] = useState(false);
    const [walletForm, setWalletForm] = useState(() => createWalletForm());
    const [walletMode, setWalletMode] = useState('create');

    useEffect(() => {
        document.title = `${pageTitle} | Admin`;
    }, []);

    useEffect(() => {
        let ignore = false;

        async function loadCashbook() {
            setLoading(true);

            try {
                const response = await financeApi.getCashbook({
                    date_from: filters.range_key === 'all' ? undefined : filters.date_from || undefined,
                    date_to: filters.range_key === 'all' ? undefined : filters.date_to || undefined,
                    range: filters.range_key === 'all' ? 'all' : undefined,
                    voucher_type: filters.voucher_type || undefined,
                    wallet_id: filters.wallet_id || undefined,
                    keyword: filters.keyword || undefined,
                    page: filters.page,
                    per_page: filters.per_page,
                });

                if (ignore) return;

                const payload = response.data || emptyCashbook;
                setCashbook({
                    ...emptyCashbook,
                    ...payload,
                    overview: { ...emptyCashbook.overview, ...(payload.overview || {}) },
                    options: {
                        ...emptyCashbook.options,
                        ...(payload.options || {}),
                        categories: {
                            ...emptyCashbook.options.categories,
                            ...(payload.options?.categories || {}),
                        },
                    },
                    summary: { ...emptyCashbook.summary, ...(payload.summary || {}) },
                    pagination: { ...emptyPagination, ...(payload.pagination || {}) },
                    data: payload.data || [],
                });

                setEntryForm((previous) => {
                    if (previous.mode === 'edit') return previous;
                    const nextForm = createEntryForm(payload.options?.wallets || []);

                    return {
                        ...nextForm,
                        voucher_type: previous.voucher_type || nextForm.voucher_type,
                        wallet_id: previous.wallet_id || nextForm.wallet_id,
                        from_wallet_id: previous.from_wallet_id || nextForm.from_wallet_id,
                        to_wallet_id: previous.to_wallet_id || nextForm.to_wallet_id,
                    };
                });
            } catch (error) {
                if (!ignore) {
                    setNotice({
                        type: 'error',
                        message: error.response?.data?.message || 'Khong the tai module quan ly tien.',
                    });
                }
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        loadCashbook();

        return () => {
            ignore = true;
        };
    }, [filters, reloadKey]);

    const wallets = cashbook.options.wallets || [];
    const incomeCategories = cashbook.options.categories?.income || [];
    const expenseCategories = cashbook.options.categories?.expense || [];
    const currentCategories = entryForm.voucher_type === 'income' ? incomeCategories : expenseCategories;
    const activeWalletFilter = wallets.find((wallet) => String(wallet.id) === String(filters.wallet_id));
    const isEditingEntry = entryForm.mode === 'edit';

    const bankCards = useMemo(
        () => (cashbook.overview.bank_accounts || []).map((wallet) => ({
            ...wallet,
            subtitle: wallet.subtitle || [wallet.bank_name, wallet.account_number ? `•••• ${String(wallet.account_number).slice(-4)}` : null]
                .filter(Boolean)
                .join(' • '),
        })),
        [cashbook.overview.bank_accounts]
    );

    const visibleWallets = useMemo(
        () => wallets.filter((wallet) => wallet.is_active),
        [wallets]
    );

    const handleImmediateFilter = (updates) => {
        const nextDraft = {
            ...draftFilters,
            ...updates,
            page: 1,
        };

        setDraftFilters(nextDraft);
        setFilters(nextDraft);
    };

    const handleSearchSubmit = () => {
        setFilters((previous) => ({
            ...previous,
            keyword: draftFilters.keyword,
            page: 1,
        }));
    };

    const resetFilters = () => {
        const defaults = createDefaultFilters();
        setDraftFilters(defaults);
        setFilters(defaults);
    };

    const handleRangeChange = (rangeKey) => {
        handleImmediateFilter({
            ...resolveRangeValues(rangeKey),
        });
    };

    const handleDateFilterChange = (field, value) => {
        handleImmediateFilter({
            range_key: 'custom',
            range: '',
            [field]: value,
        });
    };

    const handlePageChange = (page) => {
        setFilters((previous) => ({ ...previous, page }));
        setDraftFilters((previous) => ({ ...previous, page }));
    };

    const handlePerPageChange = (value) => {
        const perPage = Number(value || 20);
        const next = {
            ...draftFilters,
            page: 1,
            per_page: perPage,
        };

        setDraftFilters(next);
        setFilters(next);
    };

    const resetEntryForm = () => {
        setEntryForm(createEntryForm(wallets));
        setShowAdvanced(false);
    };

    const scrollToForm = () => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const updateEntryField = (field, value) => {
        setEntryForm((previous) => ({
            ...previous,
            [field]: value,
        }));
    };

    const handleVoucherTypeChange = (voucherType) => {
        if (isEditingEntry && !entryForm.can_change_voucher_type) return;

        const defaultForm = createEntryForm(wallets);

        setEntryForm((previous) => ({
            ...previous,
            voucher_type: voucherType,
            entry_kind: voucherType === 'transfer' ? 'transfer' : 'transaction',
            wallet_id: voucherType === 'transfer' ? previous.wallet_id : (previous.wallet_id || defaultForm.wallet_id),
            from_wallet_id: voucherType === 'transfer' ? (previous.from_wallet_id || defaultForm.from_wallet_id) : previous.from_wallet_id,
            to_wallet_id: voucherType === 'transfer' ? (previous.to_wallet_id || defaultForm.to_wallet_id) : previous.to_wallet_id,
            category_id: voucherType === 'transfer' ? '' : previous.category_id,
        }));
    };

    const openEditEntry = (row) => {
        if (!row.can_edit) {
            setNotice({
                type: 'error',
                message: 'Dong giao dich nay duoc tao tu dong, vui long sua tai phan he goc cua no.',
            });
            return;
        }

        setEntryForm(mapRowToEntryForm(row));
        setShowAdvanced(Boolean(row.counterparty_name || row.note || row.category_id));
        scrollToForm();
    };

    const handleDeleteEntry = async (row) => {
        if (!row.can_delete) {
            setNotice({
                type: 'error',
                message: 'Dong giao dich nay khong the xoa tai man hinh nay.',
            });
            return;
        }

        const confirmed = window.confirm('Xoa dong giao dich nay?');
        if (!confirmed) return;

        try {
            await financeApi.deleteCashbookEntry(row.entry_kind, row.entry_id);
            setNotice({ type: 'success', message: 'Da xoa giao dich.' });
            if (entryForm.mode === 'edit' && entryForm.entry_id === row.entry_id && entryForm.entry_kind === row.entry_kind) {
                resetEntryForm();
            }
            setReloadKey((previous) => previous + 1);
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Khong the xoa giao dich.',
            });
        }
    };

    const handleEntrySubmit = async () => {
        const amount = normalizeWholeMoneyNumber(entryForm.amount);

        if (!amount || amount <= 0) {
            setNotice({ type: 'error', message: 'So tien phai lon hon 0.' });
            return;
        }

        if (entryForm.voucher_type === 'transfer') {
            if (!entryForm.from_wallet_id || !entryForm.to_wallet_id) {
                setNotice({ type: 'error', message: 'Can chon du tai khoan chuyen va nhan.' });
                return;
            }
        } else if (!entryForm.wallet_id) {
            setNotice({ type: 'error', message: 'Can chon tai khoan tien.' });
            return;
        }

        setSubmitting(true);

        try {
            const payload = {
                voucher_type: entryForm.voucher_type,
                transaction_date: entryForm.transaction_date,
                wallet_id: entryForm.voucher_type === 'transfer' ? undefined : Number(entryForm.wallet_id),
                from_wallet_id: entryForm.voucher_type === 'transfer' ? Number(entryForm.from_wallet_id) : undefined,
                to_wallet_id: entryForm.voucher_type === 'transfer' ? Number(entryForm.to_wallet_id) : undefined,
                category_id: entryForm.voucher_type === 'transfer' || !entryForm.category_id ? undefined : Number(entryForm.category_id),
                amount,
                content: entryForm.content.trim(),
                counterparty_name: entryForm.voucher_type === 'transfer' ? undefined : entryForm.counterparty_name.trim(),
                note: entryForm.note.trim(),
                status: entryForm.status,
            };

            if (isEditingEntry) {
                await financeApi.updateCashbookEntry(entryForm.entry_kind, entryForm.entry_id, payload);
                setNotice({ type: 'success', message: 'Da cap nhat giao dich.' });
            } else {
                await financeApi.createCashbookEntry(payload);
                setNotice({ type: 'success', message: 'Da luu giao dich moi.' });
            }

            resetEntryForm();
            setReloadKey((previous) => previous + 1);
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Khong the luu giao dich.',
            });
        } finally {
            setSubmitting(false);
        }
    };

    const openWalletModal = () => {
        setWalletMode('create');
        setWalletForm(createWalletForm());
        setWalletModalOpen(true);
    };

    const editWallet = (wallet) => {
        setWalletMode('edit');
        setWalletForm(createWalletForm(wallet));
    };

    const updateWalletField = (field, value) => {
        setWalletForm((previous) => ({
            ...previous,
            [field]: value,
        }));
    };

    const submitWallet = async () => {
        const openingBalance = normalizeWholeMoneyNumber(walletForm.opening_balance) ?? 0;

        if (!walletForm.name.trim()) {
            setNotice({ type: 'error', message: 'Can nhap ten tai khoan.' });
            return;
        }

        if (walletForm.type === 'bank' && !walletForm.bank_name.trim()) {
            setNotice({ type: 'error', message: 'Can nhap ten ngan hang.' });
            return;
        }

        setWalletSubmitting(true);

        try {
            const payload = {
                name: walletForm.name.trim(),
                type: walletForm.type,
                bank_name: walletForm.type === 'bank' ? walletForm.bank_name.trim() : '',
                account_number: walletForm.type === 'bank' ? walletForm.account_number.trim() : '',
                opening_balance: openingBalance,
                note: walletForm.note.trim(),
                is_active: walletForm.is_active,
                is_default: walletForm.is_default,
            };

            if (walletMode === 'edit' && walletForm.id) {
                await financeApi.updateWallet(walletForm.id, payload);
                setNotice({ type: 'success', message: 'Da cap nhat tai khoan tien.' });
            } else {
                await financeApi.createWallet(payload);
                setNotice({ type: 'success', message: 'Da tao tai khoan tien moi.' });
            }

            setWalletModalOpen(false);
            setWalletMode('create');
            setWalletForm(createWalletForm());
            setReloadKey((previous) => previous + 1);
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Khong the luu tai khoan tien.',
            });
        } finally {
            setWalletSubmitting(false);
        }
    };

    const deleteWallet = async () => {
        if (!walletForm.id) return;

        const confirmed = window.confirm('Xoa tai khoan tien nay?');
        if (!confirmed) return;

        setWalletSubmitting(true);

        try {
            await financeApi.deleteWallet(walletForm.id);
            setNotice({ type: 'success', message: 'Da xoa tai khoan tien.' });
            setWalletMode('create');
            setWalletForm(createWalletForm());
            setWalletModalOpen(false);
            setReloadKey((previous) => previous + 1);
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Khong the xoa tai khoan tien.',
            });
        } finally {
            setWalletSubmitting(false);
        }
    };

    return (
        <div className="space-y-6 pb-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-primary/45">
                        <span>Tai chinh</span>
                        <span>/</span>
                        <span className="text-primary">Quan ly tien</span>
                    </div>
                    <div>
                        <h1 className="text-[34px] font-black tracking-tight text-primary">{pageTitle}</h1>
                        <p className="mt-2 max-w-3xl text-[14px] leading-6 text-primary/60">
                            Mo ra la thay ngay tong tien hien co, tien mat, tong tien ngan hang va lich su thu chi chuyen quy trong mot noi duy nhat.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <AccountSelector />
                    <button type="button" className={secondaryButtonClass} onClick={openWalletModal}>
                        <span className="material-symbols-outlined text-[18px]">account_balance</span>
                        <span>Tai khoan tien</span>
                    </button>
                </div>
            </div>

            {notice ? (
                <div className={`rounded-[22px] border px-4 py-3 text-[13px] font-semibold ${notice.type === 'error' ? 'border-brick/20 bg-brick/10 text-brick' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {notice.message}
                </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
                <SummaryCard
                    label="Tong tien hien co"
                    value={formatMoney(cashbook.overview.total_current_money)}
                    subtext="Tong so du tien mat va cac tai khoan ngan hang dang hoat dong."
                    icon="savings"
                />
                <SummaryCard
                    label="Tien mat"
                    value={formatMoney(cashbook.overview.cash_total)}
                    subtext={(cashbook.overview.cash_accounts || []).length ? `${cashbook.overview.cash_accounts.length} tai khoan tien mat` : 'Chua co quy tien mat'}
                    icon="payments"
                />
                <SummaryCard
                    label="Tong tien ngan hang"
                    value={formatMoney(cashbook.overview.bank_total)}
                    subtext={(cashbook.overview.bank_accounts || []).length ? `${cashbook.overview.bank_accounts.length} tai khoan ngan hang` : 'Chua co tai khoan ngan hang'}
                    icon="account_balance"
                />
            </div>

            <div className={panelClass}>
                <div className="border-b border-primary/10 px-5 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[20px] font-black tracking-tight text-primary">So du tung tai khoan ngan hang</h2>
                            <p className="mt-1 text-[13px] text-primary/55">Cham vao tung tai khoan de loc rieng lich su giao dich cua tai khoan do.</p>
                        </div>
                        {activeWalletFilter ? (
                            <button type="button" className={secondaryButtonClass} onClick={() => handleImmediateFilter({ wallet_id: '' })}>
                                <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
                                <span>Bo loc {activeWalletFilter.name}</span>
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
                    {bankCards.length ? bankCards.map((wallet) => {
                        const isActive = String(filters.wallet_id) === String(wallet.id);

                        return (
                            <button
                                key={wallet.id}
                                type="button"
                                onClick={() => handleImmediateFilter({ wallet_id: isActive ? '' : String(wallet.id) })}
                                className={`rounded-[24px] border px-4 py-4 text-left transition ${isActive ? 'border-primary bg-primary/[0.06] shadow-[0_20px_60px_-44px_rgba(15,23,42,0.8)]' : 'border-primary/10 bg-white hover:border-primary/35 hover:bg-primary/[0.03]'}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/45">Tai khoan</p>
                                        <p className="mt-2 text-[16px] font-black text-primary">{wallet.name}</p>
                                        <p className="mt-2 text-[12px] text-primary/50">{wallet.subtitle || 'Ngan hang'}</p>
                                    </div>
                                    <span className="material-symbols-outlined text-[22px] text-primary/25">account_balance</span>
                                </div>
                                <p className="mt-4 text-[24px] font-black tracking-tight text-primary">{formatMoney(wallet.current_balance)}</p>
                            </button>
                        );
                    }) : (
                        <div className="rounded-[24px] border border-dashed border-primary/15 bg-primary/[0.03] px-5 py-6 text-[13px] font-semibold text-primary/55 md:col-span-2 xl:col-span-4">
                            Chua co tai khoan ngan hang nao. Bam "Tai khoan tien" de tao moi.
                        </div>
                    )}
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
                <section ref={formRef} className={`${panelClass} xl:sticky xl:top-4 xl:self-start`}>
                    <div className="border-b border-primary/10 px-5 py-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/45">Nhap nhanh</p>
                                <h2 className="mt-2 text-[24px] font-black tracking-tight text-primary">
                                    {isEditingEntry ? 'Dang sua giao dich' : 'Them giao dich moi'}
                                </h2>
                                <p className="mt-2 text-[13px] leading-6 text-primary/55">
                                    Chon loai phieu, chon tai khoan, nhap so tien, dien noi dung va bam luu.
                                </p>
                            </div>
                            {isEditingEntry ? (
                                <button type="button" className={secondaryButtonClass} onClick={resetEntryForm}>
                                    <span className="material-symbols-outlined text-[18px]">add</span>
                                    <span>Phieu moi</span>
                                </button>
                            ) : null}
                        </div>
                        <p className="mt-3 text-[12px] font-semibold text-primary/45">Nguoi tao: {user?.name || 'He thong'}</p>
                    </div>

                    <div className="space-y-5 p-5">
                        <div className="grid grid-cols-3 gap-2 rounded-[24px] bg-[#f6f9fc] p-2">
                            {[
                                { value: 'income', label: 'Thu', icon: 'south_west' },
                                { value: 'expense', label: 'Chi', icon: 'north_east' },
                                { value: 'transfer', label: 'Chuyen quy', icon: 'sync_alt' },
                            ].map((option) => {
                                const active = entryForm.voucher_type === option.value;

                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleVoucherTypeChange(option.value)}
                                        className={`flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-[18px] px-3 py-2 text-center text-[12px] font-black transition ${active ? 'bg-primary text-white shadow-[0_18px_44px_-28px_rgba(15,23,42,0.7)]' : 'bg-white text-primary/60'} ${isEditingEntry && !entryForm.can_change_voucher_type && !active ? 'opacity-50' : ''}`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{option.icon}</span>
                                        <span>{option.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {entryForm.voucher_type === 'transfer' ? (
                            <>
                                <Field label="Tai khoan chuyen" required>
                                    <div className="relative">
                                        <select className={selectClass} value={entryForm.from_wallet_id} onChange={(event) => updateEntryField('from_wallet_id', event.target.value)}>
                                            <option value="">Chon tai khoan chuyen</option>
                                            {visibleWallets.map((wallet) => (
                                                <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                                            ))}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                    </div>
                                </Field>
                                <Field label="Tai khoan nhan" required>
                                    <div className="relative">
                                        <select className={selectClass} value={entryForm.to_wallet_id} onChange={(event) => updateEntryField('to_wallet_id', event.target.value)}>
                                            <option value="">Chon tai khoan nhan</option>
                                            {visibleWallets.map((wallet) => (
                                                <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                                            ))}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                    </div>
                                </Field>
                            </>
                        ) : (
                            <Field label="Tai khoan tien" required>
                                <div className="relative">
                                    <select className={selectClass} value={entryForm.wallet_id} onChange={(event) => updateEntryField('wallet_id', event.target.value)}>
                                        <option value="">Chon tai khoan</option>
                                        {visibleWallets.map((wallet) => (
                                            <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                                        ))}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                        )}

                        <Field label="So tien" required>
                            <input
                                type="text"
                                value={formatWholeMoneyInput(entryForm.amount)}
                                onChange={(event) => updateEntryField('amount', normalizeWholeMoneyDraft(event.target.value))}
                                className="h-14 w-full rounded-[22px] border border-primary/15 bg-white px-4 text-right text-[26px] font-black tracking-tight text-primary outline-none transition placeholder:text-primary/25 focus:border-primary"
                                inputMode="numeric"
                                placeholder="0"
                            />
                        </Field>

                        <Field label="Noi dung" required>
                            <input
                                type="text"
                                value={entryForm.content}
                                onChange={(event) => updateEntryField('content', event.target.value)}
                                className={inputClass}
                                placeholder={entryForm.voucher_type === 'transfer' ? 'Vi du: Chuyen von ve quy mat' : 'Vi du: Thu tien khach, chi ship, nap tai khoan...'}
                            />
                        </Field>

                        <button
                            type="button"
                            className="inline-flex items-center gap-2 text-[13px] font-black text-primary/65"
                            onClick={() => setShowAdvanced((previous) => !previous)}
                        >
                            <span className="material-symbols-outlined text-[18px]">{showAdvanced ? 'expand_less' : 'expand_more'}</span>
                            <span>{showAdvanced ? 'An phan mo rong' : 'Mo rong them truong it dung'}</span>
                        </button>

                        {showAdvanced ? (
                            <div className="space-y-4 rounded-[24px] border border-primary/10 bg-[#f8fbff] p-4">
                                <Field label="Ngay">
                                    <input type="date" className={inputClass} value={entryForm.transaction_date} onChange={(event) => updateEntryField('transaction_date', event.target.value)} />
                                </Field>

                                {entryForm.voucher_type !== 'transfer' ? (
                                    <>
                                        <Field label="Doi tuong lien quan">
                                            <input
                                                type="text"
                                                value={entryForm.counterparty_name}
                                                onChange={(event) => updateEntryField('counterparty_name', event.target.value)}
                                                className={inputClass}
                                                placeholder="Ten khach, doi tac, nguoi giao tien..."
                                            />
                                        </Field>

                                        <Field label="Danh muc">
                                            <div className="relative">
                                                <select className={selectClass} value={entryForm.category_id} onChange={(event) => updateEntryField('category_id', event.target.value)}>
                                                    <option value="">Khong bat buoc</option>
                                                    {currentCategories.map((category) => (
                                                        <option key={category.id} value={category.id}>{category.name}</option>
                                                    ))}
                                                </select>
                                                <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                            </div>
                                        </Field>
                                    </>
                                ) : null}

                                <Field label="Ghi chu">
                                    <textarea
                                        className={textareaClass}
                                        value={entryForm.note}
                                        onChange={(event) => updateEntryField('note', event.target.value)}
                                        placeholder="Thong tin bo sung, ma doi soat, ghi chu noi bo..."
                                    />
                                </Field>
                            </div>
                        ) : null}
                    </div>

                    <div className="sticky bottom-0 border-t border-primary/10 bg-white/95 px-5 py-4 backdrop-blur-sm">
                        <div className="flex flex-col gap-3">
                            <button type="button" className={`${primaryButtonClass} w-full h-14 text-[15px]`} onClick={handleEntrySubmit} disabled={submitting}>
                                <span className="material-symbols-outlined text-[20px]">{submitting ? 'hourglass_top' : 'save'}</span>
                                <span>{isEditingEntry ? 'Luu cap nhat giao dich' : 'Luu giao dich ngay'}</span>
                            </button>
                            {isEditingEntry ? (
                                <button type="button" className={`${secondaryButtonClass} w-full`} onClick={resetEntryForm} disabled={submitting}>
                                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                                    <span>Huy sua va tao phieu moi</span>
                                </button>
                            ) : null}
                        </div>
                    </div>
                </section>

                <div className="space-y-6">
                    <section className={panelClass}>
                        <div className="border-b border-primary/10 px-5 py-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <h2 className="text-[22px] font-black tracking-tight text-primary">Bo loc nhanh</h2>
                                    <p className="mt-1 text-[13px] text-primary/55">Loc theo thoi gian, loai phieu, tai khoan va tu khoa noi dung.</p>
                                </div>
                                <button type="button" className={secondaryButtonClass} onClick={resetFilters}>
                                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                                    <span>Dat lai</span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-5 p-5">
                            <div className="flex flex-wrap gap-2">
                                {rangeOptions.map((option) => {
                                    const active = draftFilters.range_key === option.key;

                                    return (
                                        <button
                                            key={option.key}
                                            type="button"
                                            onClick={() => handleRangeChange(option.key)}
                                            className={`rounded-full px-4 py-2 text-[12px] font-black uppercase tracking-[0.14em] transition ${active ? 'bg-primary text-white shadow-[0_18px_42px_-28px_rgba(15,23,42,0.75)]' : 'border border-primary/10 bg-white text-primary/55 hover:border-primary/35 hover:text-primary'}`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <Field label="Tu ngay">
                                    <input type="date" className={inputClass} value={draftFilters.date_from} onChange={(event) => handleDateFilterChange('date_from', event.target.value)} />
                                </Field>
                                <Field label="Den ngay">
                                    <input type="date" className={inputClass} value={draftFilters.date_to} onChange={(event) => handleDateFilterChange('date_to', event.target.value)} />
                                </Field>
                                <Field label="Loai phieu">
                                    <div className="relative">
                                        <select className={selectClass} value={draftFilters.voucher_type} onChange={(event) => handleImmediateFilter({ voucher_type: event.target.value })}>
                                            <option value="">Tat ca</option>
                                            {(cashbook.options.voucher_types || []).map((item) => (
                                                <option key={item.value} value={item.value}>{item.label}</option>
                                            ))}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                    </div>
                                </Field>
                                <Field label="Tai khoan">
                                    <div className="relative">
                                        <select className={selectClass} value={draftFilters.wallet_id} onChange={(event) => handleImmediateFilter({ wallet_id: event.target.value })}>
                                            <option value="">Tat ca</option>
                                            {wallets.map((wallet) => (
                                                <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                                            ))}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                    </div>
                                </Field>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                                <Field label="Tu khoa noi dung">
                                    <input
                                        type="text"
                                        className={inputClass}
                                        value={draftFilters.keyword}
                                        onChange={(event) => setDraftFilters((previous) => ({ ...previous, keyword: event.target.value }))}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                handleSearchSubmit();
                                            }
                                        }}
                                        placeholder="Tim theo noi dung, doi tuong, ma giao dich..."
                                    />
                                </Field>
                                <button type="button" className={`${primaryButtonClass} mt-[28px]`} onClick={handleSearchSubmit}>
                                    <span className="material-symbols-outlined text-[18px]">search</span>
                                    <span>Loc ngay</span>
                                </button>
                            </div>
                        </div>
                    </section>

                    <section className={panelClass}>
                        <div className="border-b border-primary/10 px-5 py-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <h2 className="text-[22px] font-black tracking-tight text-primary">Bang giao dich chung</h2>
                                    <p className="mt-1 text-[13px] text-primary/55">
                                        {activeWalletFilter ? `Dang loc theo tai khoan ${activeWalletFilter.name}.` : 'Tat ca thu, chi va chuyen quy hien trong mot luong duy nhat.'}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-black text-emerald-700">Thu: {formatMoney(cashbook.summary.income_total)}</span>
                                    <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-black text-rose-700">Chi: {formatMoney(cashbook.summary.expense_total)}</span>
                                    <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-black text-indigo-700">Chuyen quy: {formatMoney(cashbook.summary.transfer_total)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 p-5">
                            <div className="grid gap-3 md:hidden">
                                {loading ? (
                                    <div className="rounded-[24px] border border-primary/10 bg-primary/[0.03] px-5 py-8 text-center text-[13px] font-semibold text-primary/55">
                                        Dang tai giao dich...
                                    </div>
                                ) : !cashbook.data.length ? (
                                    <div className="rounded-[24px] border border-dashed border-primary/15 bg-primary/[0.03] px-5 py-8 text-center text-[13px] font-semibold text-primary/55">
                                        Khong co giao dich nao theo bo loc hien tai.
                                    </div>
                                ) : cashbook.data.map((row) => (
                                    <div key={row.entry_key} className="rounded-[24px] border border-primary/10 bg-white p-4 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.45)]">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${voucherToneMap[row.voucher_type] || voucherToneMap.expense}`}>
                                                    {row.voucher_type_label}
                                                </span>
                                                <p className="mt-3 text-[16px] font-black text-primary">{row.content || 'Khong co noi dung'}</p>
                                                <p className="mt-2 text-[12px] text-primary/55">{formatDateTime(row.transaction_date)}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button type="button" className={iconButtonClass} onClick={() => openEditEntry(row)} disabled={!row.can_edit}>
                                                    <span className="material-symbols-outlined text-[18px]">edit</span>
                                                </button>
                                                <button type="button" className={iconButtonClass} onClick={() => handleDeleteEntry(row)} disabled={!row.can_delete}>
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid gap-3 rounded-[20px] bg-[#f8fbff] p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">So tien</span>
                                                <span className="text-[20px] font-black tracking-tight text-primary">{formatMoney(row.amount)}</span>
                                            </div>
                                            <div className="text-[12px] text-primary/65">
                                                {row.voucher_type === 'transfer'
                                                    ? `${row.source_wallet_name || '-'} → ${row.destination_wallet_name || '-'}`
                                                    : row.wallet_name || '-'}
                                            </div>
                                            {row.related_party ? <div className="text-[12px] text-primary/65">Doi tuong: {row.related_party}</div> : null}
                                            {row.note ? <div className="text-[12px] leading-5 text-primary/60">{row.note}</div> : null}
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${statusToneMap[row.status] || statusToneMap.confirmed}`}>{row.status_label}</span>
                                                <span className="text-[11px] font-semibold text-primary/45">Tao boi {row.created_by_name || 'He thong'}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="hidden overflow-hidden rounded-[24px] border border-primary/10 md:block">
                                <div className="overflow-auto">
                                    <table className="min-w-full border-collapse">
                                        <thead className="bg-[#f6f9fc]">
                                            <tr>
                                                {['Ngay', 'Loai', 'Tai khoan', 'Tai khoan nhan', 'So tien', 'Noi dung', 'Doi tuong', 'Nguoi tao', ''].map((label) => (
                                                    <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">
                                                        {label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {loading ? (
                                                <tr>
                                                    <td colSpan={9} className="px-5 py-10 text-center text-[13px] font-semibold text-primary/55">
                                                        Dang tai bang giao dich...
                                                    </td>
                                                </tr>
                                            ) : !cashbook.data.length ? (
                                                <tr>
                                                    <td colSpan={9} className="px-5 py-10 text-center text-[13px] font-semibold text-primary/55">
                                                        Khong co giao dich nao theo bo loc hien tai.
                                                    </td>
                                                </tr>
                                            ) : cashbook.data.map((row) => (
                                                <tr key={row.entry_key} className="odd:bg-white even:bg-primary/[0.02]">
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-primary">{formatDateTime(row.transaction_date)}</td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3">
                                                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${voucherToneMap[row.voucher_type] || voucherToneMap.expense}`}>
                                                            {row.voucher_type_label}
                                                        </span>
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">
                                                        {row.voucher_type === 'transfer' ? row.source_wallet_name || '-' : row.wallet_name || '-'}
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">
                                                        {row.voucher_type === 'transfer' ? row.destination_wallet_name || '-' : '-'}
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatMoney(row.amount)}</td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">
                                                        <p className="font-semibold text-primary">{row.content || '-'}</p>
                                                        {row.note ? <p className="mt-1 text-primary/45">{row.note}</p> : null}
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{row.related_party || '-'}</td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">
                                                        <p>{row.created_by_name || 'He thong'}</p>
                                                        <span className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${statusToneMap[row.status] || statusToneMap.confirmed}`}>{row.status_label}</span>
                                                    </td>
                                                    <td className="border-b border-primary/10 px-3 py-3">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button type="button" className={iconButtonClass} onClick={() => openEditEntry(row)} disabled={!row.can_edit}>
                                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                                            </button>
                                                            <button type="button" className={iconButtonClass} onClick={() => handleDeleteEntry(row)} disabled={!row.can_delete}>
                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 border-t border-primary/10 pt-4 text-[13px] font-semibold text-primary/45 md:flex-row md:items-center md:justify-between">
                                <div className="flex flex-wrap items-center gap-4">
                                    <span>Hien thi {cashbook.data.length} / {cashbook.pagination.total}</span>
                                    <div className="flex items-center gap-2">
                                        <span>So dong:</span>
                                        <select value={filters.per_page} onChange={(event) => handlePerPageChange(event.target.value)} className="rounded-xl border border-primary/15 bg-white px-3 py-2 font-black text-primary outline-none">
                                            {[20, 50, 100].map((value) => (
                                                <option key={value} value={value}>{value}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <Pagination pagination={cashbook.pagination} onPageChange={handlePageChange} />
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            <ModalShell
                open={walletModalOpen}
                title="Tai khoan tien"
                onClose={() => setWalletModalOpen(false)}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className={secondaryButtonClass} onClick={() => setWalletModalOpen(false)}>
                            Dong
                        </button>
                        {walletMode === 'edit' && walletForm.id ? (
                            <button type="button" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-brick px-5 text-[14px] font-black text-white transition hover:bg-brick/90 disabled:cursor-not-allowed disabled:opacity-60" onClick={deleteWallet} disabled={walletSubmitting}>
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                <span>Xoa tai khoan</span>
                            </button>
                        ) : null}
                        <button type="button" className={primaryButtonClass} onClick={submitWallet} disabled={walletSubmitting}>
                            <span className="material-symbols-outlined text-[18px]">{walletSubmitting ? 'hourglass_top' : 'save'}</span>
                            <span>{walletMode === 'edit' ? 'Cap nhat tai khoan' : 'Tao tai khoan moi'}</span>
                        </button>
                    </div>
                )}
            >
                <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                    <div className="space-y-3">
                        <button type="button" className={`${secondaryButtonClass} w-full`} onClick={() => { setWalletMode('create'); setWalletForm(createWalletForm()); }}>
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            <span>Tao tai khoan moi</span>
                        </button>

                        <div className="space-y-3">
                            {wallets.map((wallet) => {
                                const active = walletForm.id === wallet.id && walletMode === 'edit';

                                return (
                                    <button
                                        key={wallet.id}
                                        type="button"
                                        onClick={() => editWallet(wallet)}
                                        className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${active ? 'border-primary bg-primary/[0.05]' : 'border-primary/10 bg-white hover:border-primary/30 hover:bg-primary/[0.03]'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[15px] font-black text-primary">{wallet.name}</p>
                                                <p className="mt-1 text-[12px] text-primary/45">{wallet.subtitle || (wallet.type === 'cash' ? 'Tien mat' : 'Ngan hang')}</p>
                                            </div>
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${wallet.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>
                                                {wallet.is_active ? 'Dang dung' : 'Tam tat'}
                                            </span>
                                        </div>
                                        <p className="mt-3 text-[18px] font-black tracking-tight text-primary">{formatMoney(wallet.current_balance)}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Loai tai khoan" required>
                                <div className="relative">
                                    <select className={selectClass} value={walletForm.type} onChange={(event) => updateWalletField('type', event.target.value)}>
                                        <option value="cash">Tien mat</option>
                                        <option value="bank">Ngan hang</option>
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-primary/30">expand_more</span>
                                </div>
                            </Field>
                            <Field label="Ten tai khoan" required>
                                <input type="text" className={inputClass} value={walletForm.name} onChange={(event) => updateWalletField('name', event.target.value)} placeholder={walletForm.type === 'cash' ? 'Vi du: Quy tien mat' : 'Vi du: VCB cong ty'} />
                            </Field>
                        </div>

                        {walletForm.type === 'bank' ? (
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Ten ngan hang" required>
                                    <input type="text" className={inputClass} value={walletForm.bank_name} onChange={(event) => updateWalletField('bank_name', event.target.value)} placeholder="Vietcombank, MB, Techcombank..." />
                                </Field>
                                <Field label="So tai khoan">
                                    <input type="text" className={inputClass} value={walletForm.account_number} onChange={(event) => updateWalletField('account_number', event.target.value)} placeholder="Khong bat buoc" />
                                </Field>
                            </div>
                        ) : null}

                        <Field label="So du dau ky">
                            <input
                                type="text"
                                className={inputClass}
                                inputMode="numeric"
                                value={formatWholeMoneyInput(walletForm.opening_balance)}
                                onChange={(event) => updateWalletField('opening_balance', normalizeWholeMoneyDraft(event.target.value))}
                                placeholder="0"
                            />
                        </Field>

                        <Field label="Ghi chu">
                            <textarea className={textareaClass} value={walletForm.note} onChange={(event) => updateWalletField('note', event.target.value)} placeholder="Thong tin them ve tai khoan nay..." />
                        </Field>

                        <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex items-center gap-3 rounded-[20px] border border-primary/10 bg-[#f8fbff] px-4 py-4 text-[14px] font-semibold text-primary">
                                <input type="checkbox" checked={walletForm.is_active} onChange={(event) => updateWalletField('is_active', event.target.checked)} className="h-4 w-4 rounded border-primary/20 accent-primary" />
                                <span>Dang hoat dong</span>
                            </label>
                            <label className="flex items-center gap-3 rounded-[20px] border border-primary/10 bg-[#f8fbff] px-4 py-4 text-[14px] font-semibold text-primary">
                                <input type="checkbox" checked={walletForm.is_default} onChange={(event) => updateWalletField('is_default', event.target.checked)} className="h-4 w-4 rounded border-primary/20 accent-primary" />
                                <span>Mac dinh theo loai</span>
                            </label>
                        </div>
                    </div>
                </div>
            </ModalShell>
        </div>
    );
}
