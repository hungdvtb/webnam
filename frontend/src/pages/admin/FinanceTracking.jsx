import React, { useEffect, useState } from 'react';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import { financeApi } from '../../services/api';

const topTabs = [
    { id: 'overview', label: 'Tổng quan', icon: 'dashboard' },
    { id: 'transactions', label: 'Thu chi', icon: 'receipt_long' },
    { id: 'cash', label: 'Quỹ tiền mặt', icon: 'payments' },
    { id: 'bank', label: 'Ngân hàng', icon: 'account_balance' },
    { id: 'loans', label: 'Vay nợ', icon: 'currency_exchange' },
    { id: 'fixed', label: 'Chi phí cố định', icon: 'event_repeat' },
    { id: 'catalogs', label: 'Danh mục', icon: 'palette' },
    { id: 'reports', label: 'Báo cáo', icon: 'monitoring' },
];

const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const selectClass = `${inputClass} pr-8`;
const textareaClass = 'min-h-[110px] rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const iconButtonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5';
const dangerIconButtonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-sm border border-brick/20 bg-white text-brick transition hover:bg-brick hover:text-white';
const tabButtonClass = (active) => `inline-flex items-center gap-2 rounded-sm px-3 py-2 text-[13px] font-bold transition ${active ? 'bg-primary text-white shadow-sm' : 'border border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/5'}`;

const todayValue = new Date().toISOString().slice(0, 10);
const defaultFromValue = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const emptyPagination = { current_page: 1, last_page: 1, total: 0, per_page: 20, data: [] };

const createTransactionForm = () => ({
    id: null,
    direction: 'in',
    category_id: '',
    wallet_id: '',
    payment_method: 'cash',
    transaction_date: `${todayValue}T09:00`,
    amount: '',
    counterparty_type: '',
    counterparty_name: '',
    reference_type: '',
    reference_id: '',
    content: '',
    note: '',
    status: 'confirmed',
    file: null,
    remove_attachment: false,
});

const createWalletForm = (type = 'cash') => ({
    id: null,
    name: '',
    type,
    bank_name: '',
    account_number: '',
    currency: 'VND',
    opening_balance: '0',
    color: type === 'cash' ? '#f97316' : '#2563eb',
    note: '',
    is_default: false,
    is_active: true,
});

const createTransferForm = () => ({
    from_wallet_id: '',
    to_wallet_id: '',
    transfer_date: `${todayValue}T10:00`,
    amount: '',
    status: 'confirmed',
    content: 'Chuyển tiền nội bộ',
    note: '',
});

const createLoanForm = () => ({
    id: null,
    type: 'borrowed',
    status: 'active',
    counterparty_name: '',
    counterparty_contact: '',
    principal_amount: '',
    interest_rate: '',
    interest_type: 'percent',
    start_date: todayValue,
    due_date: '',
    disbursed_wallet_id: '',
    note: '',
    create_disbursement: true,
});

const createLoanPaymentForm = () => ({
    wallet_id: '',
    payment_date: `${todayValue}T10:00`,
    principal_amount: '',
    interest_amount: '',
    total_amount: '',
    status: 'confirmed',
    payment_method: 'bank_transfer',
    note: '',
});

const createFixedExpenseForm = () => ({
    id: null,
    category_id: '',
    default_wallet_id: '',
    name: '',
    amount: '',
    frequency: 'monthly',
    interval_value: 1,
    reminder_days: 3,
    status: 'active',
    start_date: todayValue,
    next_due_date: '',
    note: '',
});

const createCatalogForm = () => ({
    id: null,
    group_key: 'income_type',
    name: '',
    color: '#0f766e',
    is_active: true,
    sort_order: 0,
});

function formatMoney(value) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value, withTime = false) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return withTime ? date.toLocaleString('vi-VN') : date.toLocaleDateString('vi-VN');
}

function buildFormData(payload) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (value instanceof File) formData.append(key, value);
        else if (typeof value === 'boolean') formData.append(key, value ? '1' : '0');
        else formData.append(key, value);
    });
    return formData;
}

const SectionHeader = ({ title, subtitle, actions }) => (
    <div className="flex flex-col gap-3 border-b border-primary/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
            <h2 className="text-[18px] font-black text-primary">{title}</h2>
            {subtitle ? <p className="mt-1 text-[12px] text-primary/55">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
);

const StatCard = ({ label, value, icon, tone = 'white' }) => {
    const toneMap = {
        primary: 'bg-primary text-white',
        brick: 'bg-brick text-white',
        gold: 'bg-gold text-primary',
        white: 'bg-white text-primary border border-primary/10',
    };
    return (
        <div className={`rounded-sm p-4 shadow-sm ${toneMap[tone] || toneMap.white}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${tone === 'white' ? 'text-primary/50' : 'opacity-80'}`}>{label}</p>
                    <p className="mt-3 text-[22px] font-black tracking-tight">{value}</p>
                </div>
                <span className="material-symbols-outlined text-[28px] opacity-90">{icon}</span>
            </div>
        </div>
    );
};

const StatusPill = ({ label, color }) => (
    <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide" style={{ backgroundColor: `${color || '#CBD5E1'}20`, color: color || '#475569' }}>
        {label}
    </span>
);

const ModalShell = ({ open, title, onClose, children, footer, maxWidth = 'max-w-3xl' }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-primary/35 backdrop-blur-[2px]" onClick={onClose} />
            <div className={`relative w-full ${maxWidth} overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_24px_80px_-28px_rgba(27,54,93,0.55)]`}>
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <h3 className="text-[18px] font-black text-primary">{title}</h3>
                    <button type="button" onClick={onClose} className={iconButtonClass} title="Đóng">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div className="max-h-[72vh] overflow-y-auto px-5 py-5">{children}</div>
                {footer ? <div className="border-t border-primary/10 px-5 py-4">{footer}</div> : null}
            </div>
        </div>
    );
};

const EmptyState = ({ message }) => <div className="px-5 py-10 text-center text-[13px] font-semibold text-primary/45">{message}</div>;

const FinanceTracking = () => {
    const [activeTab, setActiveTab] = useState('overview');
    const [globalFilters, setGlobalFilters] = useState({ date_from: defaultFromValue, date_to: todayValue });
    const [dashboard, setDashboard] = useState({ summary: {} });
    const [options, setOptions] = useState({ catalogs: {}, wallets: [], recent_orders: [], recent_loans: [] });
    const [transactions, setTransactions] = useState(emptyPagination);
    const [wallets, setWallets] = useState({ data: [], summary: {} });
    const [transfers, setTransfers] = useState(emptyPagination);
    const [loans, setLoans] = useState(emptyPagination);
    const [fixedExpenses, setFixedExpenses] = useState(emptyPagination);
    const [catalogs, setCatalogs] = useState({ data: [], groups: {} });
    const [reports, setReports] = useState({ monthly_cash_flow: [], income_by_category: [], expense_by_category: [] });
    const [transactionFilters, setTransactionFilters] = useState({ search: '', status: '', direction: '', wallet_id: '', category_id: '', include_deleted: false });
    const [transferFilters] = useState({ status: '', wallet_id: '' });
    const [loanFilters] = useState({ search: '', status: '', type: '' });
    const [fixedFilters] = useState({ search: '', status: '' });
    const [catalogFilters, setCatalogFilters] = useState({ group_key: '', is_active: '' });
    const [transactionPage, setTransactionPage] = useState(1);
    const [transferPage, setTransferPage] = useState(1);
    const [loanPage, setLoanPage] = useState(1);
    const [fixedPage, setFixedPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [ledgerData, setLedgerData] = useState(null);
    const [transactionModal, setTransactionModal] = useState({ open: false, form: createTransactionForm() });
    const [walletModal, setWalletModal] = useState({ open: false, form: createWalletForm() });
    const [transferModal, setTransferModal] = useState({ open: false, form: createTransferForm() });
    const [loanModal, setLoanModal] = useState({ open: false, form: createLoanForm() });
    const [loanPaymentModal, setLoanPaymentModal] = useState({ open: false, loan: null, form: createLoanPaymentForm() });
    const [fixedExpenseModal, setFixedExpenseModal] = useState({ open: false, form: createFixedExpenseForm() });
    const [fixedPaymentModal, setFixedPaymentModal] = useState({ open: false, expense: null, form: { wallet_id: '', payment_date: `${todayValue}T10:00`, amount: '', payment_method: 'bank_transfer', counterparty_name: '', content: '', note: '', file: null } });
    const [catalogModal, setCatalogModal] = useState({ open: false, form: createCatalogForm() });

    const statusOptions = options.catalogs?.transaction_status || [];
    const incomeCategories = options.catalogs?.income_type || [];
    const expenseCategories = options.catalogs?.expense_type || [];
    const fixedExpenseCategories = options.catalogs?.fixed_expense_type || [];
    const loanStatuses = options.catalogs?.loan_status || [];
    const walletOptions = options.wallets || [];

    useEffect(() => {
        let ignore = false;

        async function load() {
            setLoading(true);
            try {
                const [dashboardRes, optionsRes, transactionsRes, walletsRes, transfersRes, loansRes, fixedRes, catalogsRes, reportsRes] = await Promise.all([
                    financeApi.getDashboard(globalFilters),
                    financeApi.getOptions(),
                    financeApi.getTransactions({ ...globalFilters, ...transactionFilters, page: transactionPage }),
                    financeApi.getWallets(globalFilters),
                    financeApi.getTransfers({ ...globalFilters, ...transferFilters, page: transferPage }),
                    financeApi.getLoans({ ...loanFilters, page: loanPage }),
                    financeApi.getFixedExpenses({ ...fixedFilters, page: fixedPage }),
                    financeApi.getCatalogs(catalogFilters),
                    financeApi.getReports(globalFilters),
                ]);

                if (ignore) return;
                setDashboard(dashboardRes.data || { summary: {} });
                setOptions(optionsRes.data || { catalogs: {}, wallets: [] });
                setTransactions(transactionsRes.data || emptyPagination);
                setWallets(walletsRes.data || { data: [], summary: {} });
                setTransfers(transfersRes.data || emptyPagination);
                setLoans(loansRes.data || emptyPagination);
                setFixedExpenses(fixedRes.data || emptyPagination);
                setCatalogs(catalogsRes.data || { data: [], groups: {} });
                setReports(reportsRes.data || {});
            } catch (error) {
                setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể tải dữ liệu tài chính.' });
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        load();
        return () => { ignore = true; };
    }, [globalFilters, transactionFilters, transferFilters, loanFilters, fixedFilters, catalogFilters, transactionPage, transferPage, loanPage, fixedPage, reloadKey]);

    const pushSuccess = (message) => setNotice({ type: 'success', message });
    const refreshData = () => setReloadKey((prev) => prev + 1);
    const currentCategoryOptions = transactionModal.form.direction === 'in' ? incomeCategories : expenseCategories;

    const openEditTransaction = (item) => {
        setTransactionModal({
            open: true,
            form: {
                id: item.id,
                direction: item.direction || 'in',
                category_id: item.category_id ? String(item.category_id) : '',
                wallet_id: item.wallet_id ? String(item.wallet_id) : '',
                payment_method: item.payment_method || 'cash',
                transaction_date: item.transaction_date ? item.transaction_date.slice(0, 16) : `${todayValue}T09:00`,
                amount: item.amount,
                counterparty_type: item.counterparty_type || '',
                counterparty_name: item.counterparty_name || '',
                reference_type: item.reference_type || '',
                reference_id: item.reference_id ? String(item.reference_id) : '',
                content: item.content || '',
                note: item.note || '',
                status: item.status || 'confirmed',
                file: null,
                remove_attachment: false,
            },
        });
    };

    const handleTransactionSubmit = async () => {
        setSaving(true);
        try {
            const payload = buildFormData({
                ...transactionModal.form,
                amount: Number(transactionModal.form.amount || 0),
                attachment: transactionModal.form.file,
            });

            if (transactionModal.form.id) await financeApi.updateTransaction(transactionModal.form.id, payload);
            else await financeApi.createTransaction(payload);

            pushSuccess(transactionModal.form.id ? 'Đã cập nhật phiếu thu chi.' : 'Đã tạo phiếu thu chi.');
            refreshData();
            setTransactionModal({ open: false, form: createTransactionForm() });
            setTransactionPage(1);
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể lưu phiếu thu chi.' });
        } finally {
            setSaving(false);
        }
    };

    const handleWalletSubmit = async () => {
        setSaving(true);
        try {
            const payload = { ...walletModal.form, opening_balance: Number(walletModal.form.opening_balance || 0) };
            if (walletModal.form.id) await financeApi.updateWallet(walletModal.form.id, payload);
            else await financeApi.createWallet(payload);
            pushSuccess(walletModal.form.id ? 'Đã cập nhật tài khoản quỹ.' : 'Đã tạo tài khoản quỹ.');
            refreshData();
            setWalletModal({ open: false, form: createWalletForm(walletModal.form.type) });
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể lưu tài khoản quỹ.' });
        } finally {
            setSaving(false);
        }
    };

    const handleTransferSubmit = async () => {
        setSaving(true);
        try {
            await financeApi.createTransfer({ ...transferModal.form, amount: Number(transferModal.form.amount || 0) });
            pushSuccess('Đã tạo giao dịch chuyển tiền.');
            refreshData();
            setTransferModal({ open: false, form: createTransferForm() });
            setTransferPage(1);
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể tạo chuyển tiền nội bộ.' });
        } finally {
            setSaving(false);
        }
    };

    const handleLoanSubmit = async () => {
        setSaving(true);
        try {
            const payload = {
                ...loanModal.form,
                principal_amount: Number(loanModal.form.principal_amount || 0),
                interest_rate: loanModal.form.interest_rate === '' ? '' : Number(loanModal.form.interest_rate),
            };
            if (loanModal.form.id) await financeApi.updateLoan(loanModal.form.id, payload);
            else await financeApi.createLoan(payload);
            pushSuccess(loanModal.form.id ? 'Đã cập nhật khoản vay.' : 'Đã tạo khoản vay.');
            refreshData();
            setLoanModal({ open: false, form: createLoanForm() });
            setLoanPage(1);
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể lưu khoản vay.' });
        } finally {
            setSaving(false);
        }
    };

    const handleLoanPaymentSubmit = async () => {
        if (!loanPaymentModal.loan) return;
        setSaving(true);
        try {
            await financeApi.createLoanPayment(loanPaymentModal.loan.id, {
                ...loanPaymentModal.form,
                principal_amount: Number(loanPaymentModal.form.principal_amount || 0),
                interest_amount: Number(loanPaymentModal.form.interest_amount || 0),
                total_amount: Number(loanPaymentModal.form.total_amount || 0),
            });
            pushSuccess('Đã ghi nhận thanh toán khoản vay.');
            refreshData();
            setLoanPaymentModal({ open: false, loan: null, form: createLoanPaymentForm() });
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể lưu thanh toán khoản vay.' });
        } finally {
            setSaving(false);
        }
    };

    const handleFixedExpenseSubmit = async () => {
        setSaving(true);
        try {
            const payload = { ...fixedExpenseModal.form, amount: Number(fixedExpenseModal.form.amount || 0) };
            if (fixedExpenseModal.form.id) await financeApi.updateFixedExpense(fixedExpenseModal.form.id, payload);
            else await financeApi.createFixedExpense(payload);
            pushSuccess(fixedExpenseModal.form.id ? 'Đã cập nhật chi phí cố định.' : 'Đã tạo chi phí cố định.');
            refreshData();
            setFixedExpenseModal({ open: false, form: createFixedExpenseForm() });
            setFixedPage(1);
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể lưu chi phí cố định.' });
        } finally {
            setSaving(false);
        }
    };

    const handleFixedPaymentSubmit = async () => {
        if (!fixedPaymentModal.expense) return;
        setSaving(true);
        try {
            const payload = buildFormData({
                ...fixedPaymentModal.form,
                amount: Number(fixedPaymentModal.form.amount || fixedPaymentModal.expense.amount || 0),
                attachment: fixedPaymentModal.form.file,
            });
            await financeApi.payFixedExpense(fixedPaymentModal.expense.id, payload);
            pushSuccess('Đã ghi nhận thanh toán chi phí cố định.');
            refreshData();
            setFixedPaymentModal({ open: false, expense: null, form: { wallet_id: '', payment_date: `${todayValue}T10:00`, amount: '', payment_method: 'bank_transfer', counterparty_name: '', content: '', note: '', file: null } });
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể thanh toán chi phí cố định.' });
        } finally {
            setSaving(false);
        }
    };

    const handleCatalogSubmit = async () => {
        setSaving(true);
        try {
            if (catalogModal.form.id) await financeApi.updateCatalog(catalogModal.form.id, catalogModal.form);
            else await financeApi.createCatalog(catalogModal.form);
            pushSuccess(catalogModal.form.id ? 'Đã cập nhật danh mục.' : 'Đã tạo danh mục.');
            refreshData();
            setCatalogModal({ open: false, form: createCatalogForm() });
        } catch (error) {
            setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể lưu danh mục.' });
        } finally {
            setSaving(false);
        }
    };

    const loadLedger = async (walletId) => {
        try {
            const response = await financeApi.getWalletLedger(walletId, globalFilters);
            setLedgerData(response.data);
        } catch {
            setNotice({ type: 'error', message: 'Không thể tải lịch sử quỹ.' });
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/45">Theo dõi tài chính</p>
                    <h1 className="text-[30px] font-black tracking-tight text-primary">Theo dõi tài chính</h1>
                    <p className="max-w-3xl text-[13px] text-primary/60">Quản lý thu chi, quỹ tiền mặt, tài khoản ngân hàng, tổng tài sản, vay nợ, chi phí cố định và báo cáo tài chính trên cùng một màn hình.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <AccountSelector />
                </div>
            </div>

            <div className={`${panelClass} p-4`}>
                <div className="grid gap-3 lg:grid-cols-[repeat(2,minmax(0,180px))_auto]">
                    <input type="date" value={globalFilters.date_from} onChange={(event) => setGlobalFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={inputClass} />
                    <input type="date" value={globalFilters.date_to} onChange={(event) => setGlobalFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={inputClass} />
                    <div className="flex flex-wrap items-center gap-2">
                        {topTabs.map((tab) => (
                            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={tabButtonClass(activeTab === tab.id)}>
                                <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {notice ? (
                <div className={`rounded-sm border px-4 py-3 text-[13px] font-semibold ${notice.type === 'error' ? 'border-brick/25 bg-brick/10 text-brick' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {notice.message}
                </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Tổng thu" value={formatMoney(dashboard.summary?.total_income)} icon="south_west" tone="primary" />
                <StatCard label="Tổng chi" value={formatMoney(dashboard.summary?.total_expense)} icon="north_east" tone="brick" />
                <StatCard label="Tiền mặt" value={formatMoney(dashboard.summary?.cash_balance)} icon="payments" />
                <StatCard label="Tiền ngân hàng" value={formatMoney(dashboard.summary?.bank_balance)} icon="account_balance" />
                <StatCard label="Tổng tài sản" value={formatMoney(dashboard.summary?.total_assets)} icon="inventory" tone="gold" />
            </div>

            {activeTab === 'overview' ? (
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <StatCard label="Tiền hàng" value={formatMoney(dashboard.summary?.inventory_value)} icon="deployed_code" />
                        <StatCard label="Tiền sắp về" value={formatMoney(dashboard.summary?.money_coming_soon)} icon="schedule_send" />
                        <StatCard label="Công nợ thuần" value={formatMoney(dashboard.summary?.net_debt)} icon="difference" />
                        <StatCard label="Vay nợ" value={formatMoney(dashboard.summary?.loan_liability)} icon="currency_exchange" />
                        <StatCard label="Lãi lỗ" value={formatMoney(dashboard.summary?.profit_loss)} icon="monitoring" />
                    </div>

                    <div className="grid gap-5 xl:grid-cols-3">
                        <div className={panelClass}>
                            <SectionHeader title="Khoản sắp đến hạn" subtitle="Chi phí cố định cần xử lý sớm" />
                            {loading ? <EmptyState message="Đang tải..." /> : (dashboard.due_fixed_expenses?.length ? (
                                <div className="divide-y divide-primary/10">
                                    {dashboard.due_fixed_expenses.map((item) => (
                                        <div key={item.id} className="px-5 py-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-[13px] font-black text-primary">{item.name}</p>
                                                    <p className="mt-1 text-[12px] text-primary/55">{item.category_name || 'Chưa phân loại'} • Hạn {formatDate(item.next_due_date)}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[13px] font-black text-brick">{formatMoney(item.amount)}</p>
                                                    <p className="mt-1 text-[11px] text-primary/45">{item.days_until_due} ngày</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : <EmptyState message="Chưa có chi phí cố định đến hạn." />)}
                        </div>

                        <div className={panelClass}>
                            <SectionHeader title="Đơn hàng chưa thu đủ" subtitle="Tiền sắp về từ đơn hàng và công nợ" />
                            {loading ? <EmptyState message="Đang tải..." /> : (dashboard.outstanding_orders?.length ? (
                                <div className="divide-y divide-primary/10">
                                    {dashboard.outstanding_orders.map((item) => (
                                        <div key={item.id} className="px-5 py-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-[13px] font-black text-primary">{item.order_number}</p>
                                                    <p className="mt-1 text-[12px] text-primary/55">{item.customer_name || 'Khách lẻ'} • {item.status}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[13px] font-black text-primary">{formatMoney(item.outstanding_amount)}</p>
                                                    <p className="mt-1 text-[11px] text-primary/45">Đã thu {formatMoney(item.paid_amount)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : <EmptyState message="Không có đơn hàng đang treo công nợ." />)}
                        </div>

                        <div className={panelClass}>
                            <SectionHeader title="Nhật ký gần đây" subtitle="Các thay đổi mới nhất trong phân hệ tài chính" />
                            {loading ? <EmptyState message="Đang tải..." /> : (dashboard.activity_logs?.length ? (
                                <div className="divide-y divide-primary/10">
                                    {dashboard.activity_logs.map((log) => (
                                        <div key={log.id} className="px-5 py-4">
                                            <p className="text-[13px] font-black text-primary">{log.subject_type} #{log.subject_id}</p>
                                            <p className="mt-1 text-[12px] text-primary/60">{log.action} • {log.user_name || 'Hệ thống'}</p>
                                            <p className="mt-1 text-[11px] text-primary/40">{formatDate(log.created_at, true)}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : <EmptyState message="Chưa có lịch sử thay đổi." />)}
                        </div>
                    </div>
                </div>
            ) : null}

            {activeTab === 'transactions' ? (
                <div className={panelClass}>
                    <SectionHeader
                        title="Bảng thu chi"
                        subtitle="Tự động cộng trừ vào quỹ tiền mặt hoặc tài khoản ngân hàng khi phiếu được xác nhận"
                        actions={(
                            <>
                                <input className={`${inputClass} w-[220px]`} placeholder="Tìm mã, đối tượng, nội dung..." value={transactionFilters.search} onChange={(event) => { setTransactionPage(1); setTransactionFilters((prev) => ({ ...prev, search: event.target.value })); }} />
                                <select className={selectClass} value={transactionFilters.direction} onChange={(event) => { setTransactionPage(1); setTransactionFilters((prev) => ({ ...prev, direction: event.target.value })); }}>
                                    <option value="">Tất cả hướng</option>
                                    <option value="in">Thu</option>
                                    <option value="out">Chi</option>
                                </select>
                                <select className={selectClass} value={transactionFilters.status} onChange={(event) => { setTransactionPage(1); setTransactionFilters((prev) => ({ ...prev, status: event.target.value })); }}>
                                    <option value="">Tất cả trạng thái</option>
                                    {statusOptions.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}
                                </select>
                                <button type="button" className={iconButtonClass} title="Tạo phiếu" onClick={() => setTransactionModal({ open: true, form: createTransactionForm() })}>
                                    <span className="material-symbols-outlined text-[18px]">add</span>
                                </button>
                            </>
                        )}
                    />
                    <div className="overflow-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#f6f9fc]">
                                <tr>
                                    {['Mã', 'Ngày', 'Loại', 'Số tiền', 'Phương thức', 'Tài khoản', 'Đối tượng', 'Nội dung', 'Ghi chú', 'File', 'Trạng thái', 'Thao tác'].map((label) => (
                                        <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.data?.length ? transactions.data.map((item) => (
                                    <tr key={item.id} className="hover:bg-primary/[0.03]">
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.code}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatDate(item.transaction_date, true)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={item.category_name || (item.direction === 'in' ? 'Thu khác' : 'Chi khác')} color={item.category_color} /></td>
                                        <td className={`border-b border-r border-primary/10 px-3 py-3 text-[13px] font-black ${item.direction === 'in' ? 'text-emerald-600' : 'text-brick'}`}>{formatMoney(item.amount)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/70">{item.payment_method || '-'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.wallet_name || '-'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.counterparty_name || '-'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.content || '-'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/65">{item.note || '-'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-center">{item.attachment_url ? <a href={item.attachment_url} target="_blank" rel="noreferrer" className="text-primary underline">Xem</a> : '-'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={item.status} color={item.status === 'confirmed' ? '#16a34a' : item.status === 'pending' ? '#f59e0b' : '#64748b'} /></td>
                                        <td className="border-b border-primary/10 px-3 py-3">
                                            <div className="flex items-center gap-2">
                                                {!item.deleted_at ? (
                                                    <>
                                                        <button type="button" className={iconButtonClass} title="Sửa phiếu" onClick={() => openEditTransaction(item)}><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                        <button type="button" className={dangerIconButtonClass} title="Xóa mềm" onClick={() => financeApi.deleteTransaction(item.id).then(() => { pushSuccess('Đã xóa mềm phiếu thu chi.'); refreshData(); }).catch(() => setNotice({ type: 'error', message: 'Không thể xóa phiếu.' }))}><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                                    </>
                                                ) : (
                                                    <button type="button" className={iconButtonClass} title="Khôi phục" onClick={() => financeApi.restoreTransaction(item.id).then(() => { pushSuccess('Đã khôi phục phiếu.'); refreshData(); }).catch(() => setNotice({ type: 'error', message: 'Không thể khôi phục phiếu.' }))}><span className="material-symbols-outlined text-[18px]">restore_from_trash</span></button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )) : <tr><td colSpan={12}><EmptyState message="Chưa có phiếu thu chi." /></td></tr>}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between border-t border-primary/10 px-5 py-4">
                        <div className="text-[12px] font-semibold text-primary/55">Tổng thu: {formatMoney(transactions.summary?.total_in)} • Tổng chi: {formatMoney(transactions.summary?.total_out)}</div>
                        <Pagination pagination={transactions} onPageChange={setTransactionPage} />
                    </div>
                </div>
            ) : null}

            {activeTab === 'cash' || activeTab === 'bank' ? (
                <div className="space-y-5">
                    <div className={panelClass}>
                        <SectionHeader
                            title={activeTab === 'cash' ? 'Quỹ tiền mặt' : 'Tài khoản ngân hàng'}
                            subtitle={activeTab === 'cash' ? 'Theo dõi số dư đầu kỳ, thu, chi, cuối kỳ và lịch sử biến động quỹ.' : 'Quản lý nhiều tài khoản ngân hàng và chuyển tiền nội bộ.'}
                            actions={(
                                <>
                                    <button type="button" className={iconButtonClass} title={activeTab === 'cash' ? 'Thêm quỹ tiền mặt' : 'Thêm tài khoản ngân hàng'} onClick={() => setWalletModal({ open: true, form: createWalletForm(activeTab === 'cash' ? 'cash' : 'bank') })}>
                                        <span className="material-symbols-outlined text-[18px]">add</span>
                                    </button>
                                    {activeTab === 'bank' ? <button type="button" className={iconButtonClass} title="Chuyển tiền nội bộ" onClick={() => setTransferModal({ open: true, form: createTransferForm() })}><span className="material-symbols-outlined text-[18px]">swap_horiz</span></button> : null}
                                </>
                            )}
                        />
                        <div className="overflow-auto">
                            <table className="w-full border-collapse">
                                <thead className="bg-[#f6f9fc]">
                                    <tr>
                                        {['Mã', 'Tên', 'Loại', 'Số dư đầu kỳ', 'Thu kỳ này', 'Chi kỳ này', 'Số dư cuối kỳ', 'Ghi chú', 'Thao tác'].map((label) => (
                                            <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {wallets.data?.filter((item) => item.type === (activeTab === 'cash' ? 'cash' : 'bank')).map((item) => (
                                        <tr key={item.id}>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.code}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.name}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/65">{item.bank_name || (item.type === 'cash' ? 'Tiền mặt' : 'Ngân hàng')}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-primary">{formatMoney(item.period_summary?.opening_balance ?? item.opening_balance)}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-emerald-600">{formatMoney(item.period_summary?.period_inflow ?? 0)}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-brick">{formatMoney(item.period_summary?.period_outflow ?? 0)}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[13px] font-black text-primary">{formatMoney(item.current_balance)}</td>
                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/65">{item.note || '-'}</td>
                                            <td className="border-b border-primary/10 px-3 py-3">
                                                <div className="flex items-center gap-2">
                                                    <button type="button" className={iconButtonClass} title="Xem lịch sử" onClick={() => loadLedger(item.id)}><span className="material-symbols-outlined text-[18px]">history</span></button>
                                                    <button type="button" className={iconButtonClass} title="Sửa tài khoản" onClick={() => setWalletModal({ open: true, form: { ...item, opening_balance: item.opening_balance } })}><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                    {activeTab === 'cash' ? <button type="button" className={iconButtonClass} title="Điều chỉnh quỹ" onClick={() => setTransactionModal({ open: true, form: { ...createTransactionForm(), direction: 'in', wallet_id: String(item.id), transaction_type: 'adjustment', content: `Điều chỉnh ${item.name}`, payment_method: 'cash' } })}><span className="material-symbols-outlined text-[18px]">tune</span></button> : null}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {activeTab === 'bank' ? (
                        <div className={panelClass}>
                            <SectionHeader title="Chuyển tiền nội bộ" subtitle="Lịch sử điều chuyển giữa các tài khoản ngân hàng và quỹ." />
                            <div className="overflow-auto">
                                <table className="w-full border-collapse">
                                    <thead className="bg-[#f6f9fc]">
                                        <tr>
                                            {['Mã', 'Ngày', 'Từ tài khoản', 'Đến tài khoản', 'Số tiền', 'Nội dung', 'Trạng thái', 'Thao tác'].map((label) => (
                                                <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transfers.data?.length ? transfers.data.map((item) => (
                                            <tr key={item.id}>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.code}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatDate(item.transfer_date, true)}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.from_wallet_name}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.to_wallet_name}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[13px] font-black text-primary">{formatMoney(item.amount)}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/65">{item.content || '-'}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={item.status} color={item.status === 'confirmed' ? '#16a34a' : '#64748b'} /></td>
                                                <td className="border-b border-primary/10 px-3 py-3"><button type="button" className={dangerIconButtonClass} title="Xóa mềm" onClick={() => financeApi.deleteTransfer(item.id).then(() => { pushSuccess('Đã xóa giao dịch chuyển tiền.'); refreshData(); }).catch(() => setNotice({ type: 'error', message: 'Không thể xóa giao dịch chuyển tiền.' }))}><span className="material-symbols-outlined text-[18px]">delete</span></button></td>
                                            </tr>
                                        )) : <tr><td colSpan={8}><EmptyState message="Chưa có giao dịch chuyển tiền nội bộ." /></td></tr>}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex justify-end border-t border-primary/10 px-5 py-4"><Pagination pagination={transfers} onPageChange={setTransferPage} /></div>
                        </div>
                    ) : null}

                    {ledgerData ? (
                        <div className={panelClass}>
                            <SectionHeader title={`Lịch sử biến động • ${ledgerData.wallet?.name || ''}`} subtitle="Xem số dư đầu kỳ, thu, chi và số dư chạy theo từng chứng từ." actions={<button type="button" className={iconButtonClass} title="Đóng" onClick={() => setLedgerData(null)}><span className="material-symbols-outlined text-[18px]">close</span></button>} />
                            <div className="grid gap-4 border-b border-primary/10 px-5 py-4 md:grid-cols-4">
                                <StatCard label="Số dư đầu kỳ" value={formatMoney(ledgerData.summary?.opening_balance)} icon="hourglass_empty" />
                                <StatCard label="Thu" value={formatMoney(ledgerData.summary?.period_inflow)} icon="south_west" />
                                <StatCard label="Chi" value={formatMoney(ledgerData.summary?.period_outflow)} icon="north_east" />
                                <StatCard label="Cuối kỳ" value={formatMoney(ledgerData.summary?.closing_balance)} icon="account_balance_wallet" tone="gold" />
                            </div>
                            <div className="overflow-auto">
                                <table className="w-full border-collapse">
                                    <thead className="bg-[#f6f9fc]">
                                        <tr>
                                            {['Ngày', 'Mã', 'Nội dung', 'Thu', 'Chi', 'Số dư chạy'].map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledgerData.data?.map((item) => (
                                            <tr key={item.id}>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatDate(item.transaction_date, true)}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.code}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.content || item.note || '-'}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-emerald-600">{item.direction === 'in' ? formatMoney(item.amount) : '-'}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-brick">{item.direction === 'out' ? formatMoney(item.amount) : '-'}</td>
                                                <td className="border-b border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{formatMoney(item.running_balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {activeTab === 'loans' ? (
                <div className={panelClass}>
                    <SectionHeader title="Quản lý vay nợ" subtitle="Theo dõi gốc, lãi, lịch sử trả và liên kết phiếu thu chi." actions={<button type="button" className={iconButtonClass} title="Tạo khoản vay" onClick={() => setLoanModal({ open: true, form: createLoanForm() })}><span className="material-symbols-outlined text-[18px]">add</span></button>} />
                    <div className="overflow-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#f6f9fc]">
                                <tr>
                                    {['Mã', 'Loại', 'Đối tượng', 'Gốc', 'Đã trả gốc', 'Lãi đã trả', 'Còn lại', 'Hạn trả', 'Trạng thái', 'Lịch sử', 'Thao tác'].map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {loans.data?.length ? loans.data.map((item) => (
                                    <tr key={item.id}>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.code}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.type === 'borrowed' ? 'Đi vay' : 'Cho vay'}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.counterparty_name}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-primary">{formatMoney(item.principal_amount)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatMoney(item.principal_paid)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatMoney(item.interest_paid)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[13px] font-black text-brick">{formatMoney(item.outstanding_principal)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatDate(item.due_date)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={loanStatuses.find((status) => status.code === item.status)?.name || item.status} color={loanStatuses.find((status) => status.code === item.status)?.color} /></td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/65">{item.payments?.slice(0, 2).map((payment) => `${formatDate(payment.payment_date)} • ${formatMoney(payment.total_amount)}`).join(' | ') || 'Chưa có'}</td>
                                        <td className="border-b border-primary/10 px-3 py-3">
                                            <div className="flex items-center gap-2">
                                                <button type="button" className={iconButtonClass} title="Ghi nhận thanh toán" onClick={() => setLoanPaymentModal({ open: true, loan: item, form: { ...createLoanPaymentForm(), wallet_id: item.disbursed_wallet_id ? String(item.disbursed_wallet_id) : '' } })}><span className="material-symbols-outlined text-[18px]">payments</span></button>
                                                <button type="button" className={iconButtonClass} title="Sửa khoản vay" onClick={() => setLoanModal({ open: true, form: { ...item, disbursed_wallet_id: item.disbursed_wallet_id ? String(item.disbursed_wallet_id) : '', create_disbursement: true } })}><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                <button type="button" className={dangerIconButtonClass} title="Xóa mềm" onClick={() => financeApi.deleteLoan(item.id).then(() => { pushSuccess('Đã xóa khoản vay.'); refreshData(); }).catch(() => setNotice({ type: 'error', message: 'Không thể xóa khoản vay.' }))}><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                            </div>
                                        </td>
                                    </tr>
                                )) : <tr><td colSpan={11}><EmptyState message="Chưa có khoản vay nào." /></td></tr>}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex justify-end border-t border-primary/10 px-5 py-4"><Pagination pagination={loans} onPageChange={setLoanPage} /></div>
                </div>
            ) : null}

            {activeTab === 'fixed' ? (
                <div className={panelClass}>
                    <SectionHeader title="Chi phí cố định" subtitle="Khai báo chi phí lặp lại, nhắc thanh toán và thống kê theo tháng." actions={<button type="button" className={iconButtonClass} title="Tạo chi phí cố định" onClick={() => setFixedExpenseModal({ open: true, form: createFixedExpenseForm() })}><span className="material-symbols-outlined text-[18px]">add</span></button>} />
                    <div className="overflow-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#f6f9fc]">
                                <tr>
                                    {['Mã', 'Tên', 'Loại', 'Số tiền', 'Chu kỳ', 'Hạn tiếp theo', 'Nhắc trước', 'Trạng thái', 'Thao tác'].map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {fixedExpenses.data?.length ? fixedExpenses.data.map((item) => (
                                    <tr key={item.id}>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.code}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.name}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={item.category_name || 'Chưa phân loại'} color={item.category_color} /></td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[13px] font-black text-primary">{formatMoney(item.amount)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.frequency} / {item.interval_value}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{formatDate(item.next_due_date)}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.reminder_days} ngày</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={item.status} color={item.status === 'active' ? '#16a34a' : '#64748b'} /></td>
                                        <td className="border-b border-primary/10 px-3 py-3">
                                            <div className="flex items-center gap-2">
                                                <button type="button" className={iconButtonClass} title="Thanh toán" onClick={() => setFixedPaymentModal({ open: true, expense: item, form: { wallet_id: item.default_wallet_id ? String(item.default_wallet_id) : '', payment_date: `${todayValue}T10:00`, amount: item.amount, payment_method: 'bank_transfer', counterparty_name: item.name, content: item.name, note: item.note || '', file: null } })}><span className="material-symbols-outlined text-[18px]">task_alt</span></button>
                                                <button type="button" className={iconButtonClass} title="Sửa" onClick={() => setFixedExpenseModal({ open: true, form: { ...item, default_wallet_id: item.default_wallet_id ? String(item.default_wallet_id) : '', category_id: item.category_id ? String(item.category_id) : '' } })}><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                <button type="button" className={dangerIconButtonClass} title="Xóa mềm" onClick={() => financeApi.deleteFixedExpense(item.id).then(() => { pushSuccess('Đã xóa chi phí cố định.'); refreshData(); }).catch(() => setNotice({ type: 'error', message: 'Không thể xóa chi phí cố định.' }))}><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                            </div>
                                        </td>
                                    </tr>
                                )) : <tr><td colSpan={9}><EmptyState message="Chưa có chi phí cố định." /></td></tr>}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex justify-end border-t border-primary/10 px-5 py-4"><Pagination pagination={fixedExpenses} onPageChange={setFixedPage} /></div>
                </div>
            ) : null}

            {activeTab === 'catalogs' ? (
                <div className={panelClass}>
                    <SectionHeader title="Danh mục tài chính" subtitle="Thêm, sửa, tắt và đổi màu các loại thu chi, trạng thái và nhóm chi phí." actions={<><select className={selectClass} value={catalogFilters.group_key} onChange={(event) => setCatalogFilters((prev) => ({ ...prev, group_key: event.target.value }))}><option value="">Tất cả nhóm</option>{Object.entries(catalogs.groups || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="button" className={iconButtonClass} title="Tạo danh mục" onClick={() => setCatalogModal({ open: true, form: createCatalogForm() })}><span className="material-symbols-outlined text-[18px]">add</span></button></>} />
                    <div className="overflow-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#f6f9fc]">
                                <tr>
                                    {['Nhóm', 'Tên', 'Mã', 'Màu', 'Trạng thái', 'Hệ thống', 'Thao tác'].map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {catalogs.data?.length ? catalogs.data.map((item) => (
                                    <tr key={item.id}>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.group_label}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{item.name}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary/70">{item.code}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><span className="inline-flex h-6 w-12 rounded-sm border border-primary/10" style={{ backgroundColor: item.color || '#CBD5E1' }} /></td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3"><StatusPill label={item.is_active ? 'Đang dùng' : 'Đã tắt'} color={item.is_active ? '#16a34a' : '#64748b'} /></td>
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.is_system ? 'Có' : 'Không'}</td>
                                        <td className="border-b border-primary/10 px-3 py-3"><div className="flex items-center gap-2"><button type="button" className={iconButtonClass} title="Sửa" onClick={() => setCatalogModal({ open: true, form: item })}><span className="material-symbols-outlined text-[18px]">edit</span></button>{!item.is_system ? <button type="button" className={dangerIconButtonClass} title="Xóa mềm" onClick={() => financeApi.deleteCatalog(item.id).then(() => { pushSuccess('Đã xóa danh mục.'); refreshData(); }).catch((error) => setNotice({ type: 'error', message: error.response?.data?.message || 'Không thể xóa danh mục.' }))}><span className="material-symbols-outlined text-[18px]">delete</span></button> : null}</div></td>
                                    </tr>
                                )) : <tr><td colSpan={7}><EmptyState message="Chưa có danh mục nào." /></td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}

            {activeTab === 'reports' ? (
                <div className="space-y-5">
                    <div className="grid gap-5 xl:grid-cols-2">
                        <div className={panelClass}>
                            <SectionHeader title="Dòng tiền theo tháng" subtitle="So sánh thu chi và chênh lệch từng tháng." />
                            <div className="overflow-auto">
                                <table className="w-full border-collapse">
                                    <thead className="bg-[#f6f9fc]">
                                        <tr>{['Tháng', 'Thu', 'Chi', 'Chênh lệch'].map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">{label}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {reports.monthly_cash_flow?.map((row) => (
                                            <tr key={row.month}>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{row.label}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-emerald-600 font-semibold">{formatMoney(row.income)}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-brick font-semibold">{formatMoney(row.expense)}</td>
                                                <td className="border-b border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{formatMoney(row.net)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className={panelClass}>
                            <SectionHeader title="Cơ cấu thu chi" subtitle="Tổng hợp theo loại thu và loại chi trong khoảng thời gian đã lọc." />
                            <div className="grid gap-4 p-5 md:grid-cols-2">
                                <div>
                                    <p className="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-primary/50">Loại thu</p>
                                    <div className="space-y-2">
                                        {reports.income_by_category?.map((row) => <div key={row.label} className="flex items-center justify-between rounded-sm border border-primary/10 px-3 py-2"><span className="text-[12px] font-semibold text-primary">{row.label}</span><span className="text-[12px] font-black text-emerald-600">{formatMoney(row.amount)}</span></div>)}
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-primary/50">Loại chi</p>
                                    <div className="space-y-2">
                                        {reports.expense_by_category?.map((row) => <div key={row.label} className="flex items-center justify-between rounded-sm border border-primary/10 px-3 py-2"><span className="text-[12px] font-semibold text-primary">{row.label}</span><span className="text-[12px] font-black text-brick">{formatMoney(row.amount)}</span></div>)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            <ModalShell open={transactionModal.open} title={transactionModal.form.id ? 'Sửa phiếu thu chi' : 'Tạo phiếu thu chi'} onClose={() => setTransactionModal({ open: false, form: createTransactionForm() })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setTransactionModal({ open: false, form: createTransactionForm() })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleTransactionSubmit} disabled={saving}><span className="material-symbols-outlined text-[18px]">{saving ? 'hourglass_top' : 'save'}</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <select className={selectClass} value={transactionModal.form.direction} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, direction: event.target.value, category_id: '' } }))}><option value="in">Thu</option><option value="out">Chi</option></select>
                    <select className={selectClass} value={transactionModal.form.category_id} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, category_id: event.target.value } }))}><option value="">Chọn loại</option>{currentCategoryOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} type="datetime-local" value={transactionModal.form.transaction_date} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, transaction_date: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Số tiền" value={transactionModal.form.amount} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, amount: event.target.value } }))} />
                    <select className={selectClass} value={transactionModal.form.wallet_id} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, wallet_id: event.target.value } }))}><option value="">Không gắn tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} placeholder="Phương thức" value={transactionModal.form.payment_method} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, payment_method: event.target.value } }))} />
                    <input className={inputClass} placeholder="Đối tượng" value={transactionModal.form.counterparty_name} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, counterparty_name: event.target.value } }))} />
                    <select className={selectClass} value={transactionModal.form.status} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.value } }))}>{statusOptions.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
                    <select className={selectClass} value={transactionModal.form.reference_type} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, reference_type: event.target.value, reference_id: '' } }))}><option value="">Không liên kết</option><option value="order">Đơn hàng</option></select>
                    {transactionModal.form.reference_type === 'order' ? <select className={selectClass} value={transactionModal.form.reference_id} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, reference_id: event.target.value } }))}><option value="">Chọn đơn hàng</option>{options.recent_orders?.map((order) => <option key={order.id} value={order.id}>{order.order_number} • {order.customer_name}</option>)}</select> : <input className={inputClass} placeholder="Loại đối tượng" value={transactionModal.form.counterparty_type} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, counterparty_type: event.target.value } }))} />}
                    <input className={`${inputClass} md:col-span-2`} placeholder="Nội dung" value={transactionModal.form.content} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, content: event.target.value } }))} />
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={transactionModal.form.note} onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                    <input className={`${inputClass} md:col-span-2 py-2`} type="file" onChange={(event) => setTransactionModal((prev) => ({ ...prev, form: { ...prev.form, file: event.target.files?.[0] || null } }))} />
                </div>
            </ModalShell>

            <ModalShell open={walletModal.open} title={walletModal.form.id ? 'Sửa tài khoản quỹ' : 'Tạo tài khoản quỹ'} onClose={() => setWalletModal({ open: false, form: createWalletForm(walletModal.form.type || 'cash') })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setWalletModal({ open: false, form: createWalletForm(walletModal.form.type || 'cash') })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleWalletSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <input className={inputClass} placeholder="Tên tài khoản" value={walletModal.form.name} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} />
                    <select className={selectClass} value={walletModal.form.type} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, type: event.target.value } }))}><option value="cash">Quỹ tiền mặt</option><option value="bank">Tài khoản ngân hàng</option></select>
                    {walletModal.form.type === 'bank' ? <input className={inputClass} placeholder="Tên ngân hàng" value={walletModal.form.bank_name} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, bank_name: event.target.value } }))} /> : null}
                    {walletModal.form.type === 'bank' ? <input className={inputClass} placeholder="Số tài khoản" value={walletModal.form.account_number} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, account_number: event.target.value } }))} /> : null}
                    <input className={inputClass} type="number" placeholder="Số dư đầu kỳ" value={walletModal.form.opening_balance} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, opening_balance: event.target.value } }))} />
                    <input className={inputClass} type="color" value={walletModal.form.color} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, color: event.target.value } }))} />
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={walletModal.form.note} onChange={(event) => setWalletModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                </div>
            </ModalShell>

            <ModalShell open={transferModal.open} title="Chuyển tiền nội bộ" onClose={() => setTransferModal({ open: false, form: createTransferForm() })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setTransferModal({ open: false, form: createTransferForm() })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleTransferSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <select className={selectClass} value={transferModal.form.from_wallet_id} onChange={(event) => setTransferModal((prev) => ({ ...prev, form: { ...prev.form, from_wallet_id: event.target.value } }))}><option value="">Từ tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select className={selectClass} value={transferModal.form.to_wallet_id} onChange={(event) => setTransferModal((prev) => ({ ...prev, form: { ...prev.form, to_wallet_id: event.target.value } }))}><option value="">Đến tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} type="datetime-local" value={transferModal.form.transfer_date} onChange={(event) => setTransferModal((prev) => ({ ...prev, form: { ...prev.form, transfer_date: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Số tiền" value={transferModal.form.amount} onChange={(event) => setTransferModal((prev) => ({ ...prev, form: { ...prev.form, amount: event.target.value } }))} />
                    <input className={`${inputClass} md:col-span-2`} placeholder="Nội dung" value={transferModal.form.content} onChange={(event) => setTransferModal((prev) => ({ ...prev, form: { ...prev.form, content: event.target.value } }))} />
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={transferModal.form.note} onChange={(event) => setTransferModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                </div>
            </ModalShell>

            <ModalShell open={loanModal.open} title={loanModal.form.id ? 'Sửa khoản vay' : 'Tạo khoản vay'} onClose={() => setLoanModal({ open: false, form: createLoanForm() })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setLoanModal({ open: false, form: createLoanForm() })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleLoanSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <select className={selectClass} value={loanModal.form.type} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, type: event.target.value } }))}><option value="borrowed">Đi vay</option><option value="lent">Cho vay</option></select>
                    <select className={selectClass} value={loanModal.form.status} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.value } }))}>{loanStatuses.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
                    <input className={inputClass} placeholder="Đối tượng" value={loanModal.form.counterparty_name} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, counterparty_name: event.target.value } }))} />
                    <input className={inputClass} placeholder="Liên hệ" value={loanModal.form.counterparty_contact} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, counterparty_contact: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Số tiền gốc" value={loanModal.form.principal_amount} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, principal_amount: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Lãi suất" value={loanModal.form.interest_rate} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, interest_rate: event.target.value } }))} />
                    <input className={inputClass} type="date" value={loanModal.form.start_date} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, start_date: event.target.value } }))} />
                    <input className={inputClass} type="date" value={loanModal.form.due_date} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, due_date: event.target.value } }))} />
                    <select className={selectClass} value={loanModal.form.disbursed_wallet_id} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, disbursed_wallet_id: event.target.value } }))}><option value="">Không gắn tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select className={selectClass} value={loanModal.form.interest_type} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, interest_type: event.target.value } }))}><option value="percent">Phần trăm</option><option value="fixed">Cố định</option></select>
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={loanModal.form.note} onChange={(event) => setLoanModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                </div>
            </ModalShell>

            <ModalShell open={loanPaymentModal.open} title="Ghi nhận thanh toán khoản vay" onClose={() => setLoanPaymentModal({ open: false, loan: null, form: createLoanPaymentForm() })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setLoanPaymentModal({ open: false, loan: null, form: createLoanPaymentForm() })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleLoanPaymentSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <select className={selectClass} value={loanPaymentModal.form.wallet_id} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, wallet_id: event.target.value } }))}><option value="">Chọn tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} type="datetime-local" value={loanPaymentModal.form.payment_date} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, payment_date: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Gốc trả" value={loanPaymentModal.form.principal_amount} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, principal_amount: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Lãi trả" value={loanPaymentModal.form.interest_amount} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, interest_amount: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Tổng thanh toán" value={loanPaymentModal.form.total_amount} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, total_amount: event.target.value } }))} />
                    <input className={inputClass} placeholder="Phương thức" value={loanPaymentModal.form.payment_method} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, payment_method: event.target.value } }))} />
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={loanPaymentModal.form.note} onChange={(event) => setLoanPaymentModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                </div>
            </ModalShell>

            <ModalShell open={fixedExpenseModal.open} title={fixedExpenseModal.form.id ? 'Sửa chi phí cố định' : 'Tạo chi phí cố định'} onClose={() => setFixedExpenseModal({ open: false, form: createFixedExpenseForm() })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setFixedExpenseModal({ open: false, form: createFixedExpenseForm() })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleFixedExpenseSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <input className={inputClass} placeholder="Tên chi phí" value={fixedExpenseModal.form.name} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} />
                    <select className={selectClass} value={fixedExpenseModal.form.category_id} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, category_id: event.target.value } }))}><option value="">Chọn loại chi phí</option>{fixedExpenseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} type="number" placeholder="Số tiền" value={fixedExpenseModal.form.amount} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, amount: event.target.value } }))} />
                    <select className={selectClass} value={fixedExpenseModal.form.frequency} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, frequency: event.target.value } }))}><option value="daily">Hàng ngày</option><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option><option value="quarterly">Hàng quý</option><option value="yearly">Hàng năm</option></select>
                    <input className={inputClass} type="number" placeholder="Chu kỳ lặp" value={fixedExpenseModal.form.interval_value} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, interval_value: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Nhắc trước (ngày)" value={fixedExpenseModal.form.reminder_days} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, reminder_days: event.target.value } }))} />
                    <input className={inputClass} type="date" value={fixedExpenseModal.form.start_date} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, start_date: event.target.value } }))} />
                    <input className={inputClass} type="date" value={fixedExpenseModal.form.next_due_date} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, next_due_date: event.target.value } }))} />
                    <select className={selectClass} value={fixedExpenseModal.form.default_wallet_id} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, default_wallet_id: event.target.value } }))}><option value="">Không gắn tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} placeholder="Trạng thái" value={fixedExpenseModal.form.status} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.value } }))} />
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={fixedExpenseModal.form.note} onChange={(event) => setFixedExpenseModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                </div>
            </ModalShell>

            <ModalShell open={fixedPaymentModal.open} title="Thanh toán chi phí cố định" onClose={() => setFixedPaymentModal({ open: false, expense: null, form: { wallet_id: '', payment_date: `${todayValue}T10:00`, amount: '', payment_method: 'bank_transfer', counterparty_name: '', content: '', note: '', file: null } })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setFixedPaymentModal({ open: false, expense: null, form: { wallet_id: '', payment_date: `${todayValue}T10:00`, amount: '', payment_method: 'bank_transfer', counterparty_name: '', content: '', note: '', file: null } })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleFixedPaymentSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <select className={selectClass} value={fixedPaymentModal.form.wallet_id} onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, wallet_id: event.target.value } }))}><option value="">Chọn tài khoản</option>{walletOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <input className={inputClass} type="datetime-local" value={fixedPaymentModal.form.payment_date} onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, payment_date: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Số tiền" value={fixedPaymentModal.form.amount} onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, amount: event.target.value } }))} />
                    <input className={inputClass} placeholder="Phương thức" value={fixedPaymentModal.form.payment_method} onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, payment_method: event.target.value } }))} />
                    <input className={`${inputClass} md:col-span-2`} placeholder="Nội dung" value={fixedPaymentModal.form.content} onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, content: event.target.value } }))} />
                    <textarea className={`${textareaClass} md:col-span-2`} placeholder="Ghi chú" value={fixedPaymentModal.form.note} onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, note: event.target.value } }))} />
                    <input className={`${inputClass} md:col-span-2 py-2`} type="file" onChange={(event) => setFixedPaymentModal((prev) => ({ ...prev, form: { ...prev.form, file: event.target.files?.[0] || null } }))} />
                </div>
            </ModalShell>

            <ModalShell open={catalogModal.open} title={catalogModal.form.id ? 'Sửa danh mục' : 'Tạo danh mục'} onClose={() => setCatalogModal({ open: false, form: createCatalogForm() })} footer={<div className="flex justify-end gap-2"><button type="button" className={iconButtonClass} title="Hủy" onClick={() => setCatalogModal({ open: false, form: createCatalogForm() })}><span className="material-symbols-outlined text-[18px]">close</span></button><button type="button" className={iconButtonClass} title="Lưu" onClick={handleCatalogSubmit}><span className="material-symbols-outlined text-[18px]">save</span></button></div>}>
                <div className="grid gap-3 md:grid-cols-2">
                    <select className={selectClass} value={catalogModal.form.group_key} onChange={(event) => setCatalogModal((prev) => ({ ...prev, form: { ...prev.form, group_key: event.target.value } }))}>{Object.entries(catalogs.groups || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                    <input className={inputClass} placeholder="Tên danh mục" value={catalogModal.form.name} onChange={(event) => setCatalogModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} />
                    <input className={inputClass} type="color" value={catalogModal.form.color} onChange={(event) => setCatalogModal((prev) => ({ ...prev, form: { ...prev.form, color: event.target.value } }))} />
                    <input className={inputClass} type="number" placeholder="Thứ tự" value={catalogModal.form.sort_order} onChange={(event) => setCatalogModal((prev) => ({ ...prev, form: { ...prev.form, sort_order: event.target.value } }))} />
                </div>
            </ModalShell>
        </div>
    );
};

export default FinanceTracking;
