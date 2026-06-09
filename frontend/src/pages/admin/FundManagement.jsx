import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { financeApi } from '../../services/api';

const formatCurrency = (val) => {
    return Math.round(Number(val) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + 'đ';
};

const getCompactAccountName = (name) => {
    const value = String(name || '').trim();
    if (!value) return 'TK';
    if (value.length <= 10) return value;

    const words = value.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
        return words.map(word => word[0]).join('').slice(0, 4).toUpperCase();
    }

    return value.slice(0, 10);
};

const NEW_TRANSACTION_CATEGORY_VALUE = '__new_category__';
const ENTRY_PANEL_VISIBILITY_STORAGE_KEY = 'fundManagement.entryPanelVisible';

// Utils cho ngày tháng (có giờ)
const getCurrentDateTime = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatDateString = (dateStr) => {
    if (!dateStr) return '';
    try {
        // Handle YYYY-MM-DD HH:mm:ss to DD/MM/YYYY HH:mm
        const parts = dateStr.split(' ');
        const dParts = parts[0].split('-');
        if (dParts.length === 3) {
            let res = `${dParts[2]}/${dParts[1]}/${dParts[0]}`;
            if (parts[1]) {
                const tParts = parts[1].split(':');
                res += ` ${tParts[0]}:${tParts[1]}`;
            }
            return res;
        }
        return dateStr;
    } catch(e) {
        return dateStr;
    }
};

export default function FundManagement() {
    const {
        isMobileSidebarOpen = false,
        isSidebarDrawerMode = false,
        toggleMobileSidebar
    } = useOutletContext() || {};
    const [loading, setLoading] = useState(true);
    const [entryPanelVisible, setEntryPanelVisible] = useState(() => {
        if (typeof window === 'undefined') return true;

        try {
            return window.localStorage.getItem(ENTRY_PANEL_VISIBILITY_STORAGE_KEY) !== 'hidden';
        } catch {
            return true;
        }
    });

    // Data
    const [accounts, setAccounts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [transactions, setTransactions] = useState([]);

    // Stats
    const [summary, setSummary] = useState({ total: 0, cash: 0, bank: 0 });

    // Tabs ('all', 'cash', 'bank')
    const [activeTab, setActiveTab] = useState('all');

    // Quick Input Row State
    const [newTx, setNewTx] = useState({
        id: null,
        transaction_date: getCurrentDateTime(),
        description: '',
        fin_account_id: '',
        fin_category_id: '',
        type: 'income',
        amount: '',
        notes: '',
        new_category_name: ''
    });

    const [saving, setSaving] = useState(false);
    const amountInputRef = useRef(null);
    const incomeInputRef = useRef(null);
    const expenseInputRef = useRef(null);

    // Modals
    const [reportOpen, setReportOpen] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [reportFilter, setReportFilter] = useState({
        start_date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        end_date: getCurrentDateTime().split('T')[0],
        fin_account_ids: [],
        type: 'all' // 'all' | 'income' | 'expense'
    });

    // Advanced Filtering & Search
    const [filterOpen, setFilterOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [advFilter, setAdvFilter] = useState({
        account_id: '',
        category_id: '',
        start_date: '',
        end_date: '',
        tx_type: ''
    });

    // Transfer Fund Modal
    const [transferOpen, setTransferOpen] = useState(false);
    const [transferData, setTransferData] = useState({
        from_account_id: '',
        to_account_id: '',
        amount: '',
        transaction_date: getCurrentDateTime(),
        notes: ''
    });
    const [transferring, setTransferring] = useState(false);

    const [categoryModalOpen, setCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState({ id: null, name: '', type: 'expense', color: '#f44336' });
    const [draggingCategoryId, setDraggingCategoryId] = useState(null);
    const [dragOverCategoryId, setDragOverCategoryId] = useState(null);
    const [reorderingCategories, setReorderingCategories] = useState(false);

    const [accountModalOpen, setAccountModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState({ id: null, name: '', type: 'bank', initial_balance: 0 });
    const modalScrollYRef = useRef(0);
    const modalHistoryPushedRef = useRef(false);

    useEffect(() => {
        try {
            window.localStorage.setItem(
                ENTRY_PANEL_VISIBILITY_STORAGE_KEY,
                entryPanelVisible ? 'visible' : 'hidden'
            );
        } catch {
            // Ignore private-mode or storage quota failures; the toggle still works for this session.
        }
    }, [entryPanelVisible]);

    const restoreFundScreenScroll = useCallback(() => {
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: modalScrollYRef.current, left: 0, behavior: 'auto' });
        });
    }, []);

    const closeAllFundModals = useCallback(() => {
        setCategoryModalOpen(false);
        setAccountModalOpen(false);
        setTransferOpen(false);
        setReportOpen(false);
        setFilterOpen(false);
        setDraggingCategoryId(null);
        setDragOverCategoryId(null);
        restoreFundScreenScroll();
    }, [restoreFundScreenScroll]);

    const openFundModal = useCallback((setModalOpen) => {
        modalScrollYRef.current = window.scrollY || document.documentElement.scrollTop || 0;
        setModalOpen(true);

        if (!modalHistoryPushedRef.current) {
            window.history.pushState({ ...(window.history.state || {}), fundManagementModal: true }, '');
            modalHistoryPushedRef.current = true;
        }
    }, []);

    const closeFundModal = useCallback(() => {
        if (modalHistoryPushedRef.current && window.history.state?.fundManagementModal) {
            modalHistoryPushedRef.current = false;
            closeAllFundModals();
            window.history.back();
            return;
        }

        modalHistoryPushedRef.current = false;
        closeAllFundModals();
    }, [closeAllFundModals]);

    useEffect(() => {
        const handleModalBack = () => {
            if (!modalHistoryPushedRef.current) return;
            modalHistoryPushedRef.current = false;
            closeAllFundModals();
        };

        window.addEventListener('popstate', handleModalBack);
        return () => window.removeEventListener('popstate', handleModalBack);
    }, [closeAllFundModals]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [summaryRes, accountsRes, categoriesRes, txRes] = await Promise.all([
                financeApi.getFundSummary(),
                financeApi.getFundAccounts(),
                financeApi.getFundCategories(),
                financeApi.getFundTransactions({
                    type: ['all', 'cash', 'bank'].includes(activeTab) ? activeTab : undefined,
                    account_id: !['all', 'cash', 'bank'].includes(activeTab) ? activeTab : advFilter.account_id,
                    category_id: advFilter.category_id,
                    tx_type: advFilter.tx_type,
                    start_date: advFilter.start_date,
                    end_date: advFilter.end_date,
                    search: searchQuery
                })
            ]);

            if (summaryRes.data.status === 'success') {
                setSummary(summaryRes.data.data);
            }
            if (accountsRes.data.status === 'success') {
                setAccounts(accountsRes.data.data);
                if (!newTx.fin_account_id && !newTx.id && accountsRes.data.data.length > 0) {
                    setNewTx(prev => ({ ...prev, fin_account_id: accountsRes.data.data[0].id }));
                }
            }
            if (categoriesRes.data.status === 'success') {
                setCategories(categoriesRes.data.data);
            }
            if (txRes.data.status === 'success') {
                setTransactions(txRes.data.data.data || txRes.data.data);
            }
        } catch (error) {
            console.error('Lỗi tải dữ liệu', error);
            alert('Lỗi tải dữ liệu Sổ cái');
        } finally {
            setLoading(false);
        }
    }, [activeTab, advFilter, searchQuery]);

    const handleTransfer = async (e) => {
        e.preventDefault();
        if (!transferData.from_account_id || !transferData.to_account_id || !transferData.amount) {
            alert('Vui lòng điền đầy đủ thông tin chuyển quỹ');
            return;
        }
        setTransferring(true);
        try {
            const payload = { ...transferData, transaction_date: transferData.transaction_date.replace('T', ' ') + ':00' };
            await financeApi.transferFunds(payload);
            closeFundModal();
            setTransferData({ from_account_id: '', to_account_id: '', amount: '', transaction_date: getCurrentDateTime(), notes: '' });
            loadData();
        } catch (error) {
            alert(error.response?.data?.message || 'Lỗi chuyển quỹ');
        } finally {
            setTransferring(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Tự động chọn tài khoản khi đổi Tab lọc
    useEffect(() => {
        if (!newTx.id && accounts.length > 0) {
            if (activeTab === 'cash') {
                const cashAcc = accounts.find(a => a.type === 'cash');
                if (cashAcc) setNewTx(prev => ({ ...prev, fin_account_id: cashAcc.id }));
            } else if (activeTab === 'bank') {
                const bankAcc = accounts.find(a => a.type === 'bank');
                if (bankAcc) setNewTx(prev => ({ ...prev, fin_account_id: bankAcc.id }));
            } else if (!isNaN(activeTab)) {
                // specific account ID
                setNewTx(prev => ({ ...prev, fin_account_id: parseInt(activeTab) }));
            }
        }
    }, [activeTab, accounts]);

    const findCategoryById = useCallback((categoryId) => (
        categories.find(category => String(category.id) === String(categoryId))
    ), [categories]);

    const filteredTransactionCategories = useMemo(() => (
        categories.filter(category => category.type === newTx.type)
    ), [categories, newTx.type]);

    const selectedTransactionCategory = useMemo(() => {
        const category = findCategoryById(newTx.fin_category_id);
        return category?.type === newTx.type ? category : null;
    }, [findCategoryById, newTx.fin_category_id, newTx.type]);

    const transactionCategorySelectValue = newTx.fin_category_id === NEW_TRANSACTION_CATEGORY_VALUE
        ? NEW_TRANSACTION_CATEGORY_VALUE
        : selectedTransactionCategory?.id || '';

    const applyTransactionType = useCallback((nextType, extra = {}) => {
        const normalizedType = nextType === 'expense' ? 'expense' : 'income';

        setNewTx(prev => {
            const selectedCategory = findCategoryById(prev.fin_category_id);
            const typeChanged = prev.type !== normalizedType;
            const shouldKeepCategory = !typeChanged || selectedCategory?.type === normalizedType;

            return {
                ...prev,
                ...extra,
                type: normalizedType,
                fin_category_id: shouldKeepCategory ? prev.fin_category_id : '',
                new_category_name: shouldKeepCategory ? prev.new_category_name : ''
            };
        });
    }, [findCategoryById]);

    const handleTransactionTypeChange = useCallback((nextType) => {
        applyTransactionType(nextType);
    }, [applyTransactionType]);

    const handleTransactionAmountChange = useCallback((nextType, value) => {
        applyTransactionType(nextType, { amount: value.replace(/\D/g, '') });
    }, [applyTransactionType]);

    const handleTransactionCategorySelectChange = useCallback((value) => {
        setNewTx(prev => {
            if (value === NEW_TRANSACTION_CATEGORY_VALUE) {
                return { ...prev, fin_category_id: NEW_TRANSACTION_CATEGORY_VALUE, new_category_name: prev.new_category_name || '' };
            }

            if (!value) {
                return { ...prev, fin_category_id: '', new_category_name: '' };
            }

            const matched = categories.find(category => category.type === prev.type && String(category.id) === String(value));

            if (matched) {
                return { ...prev, fin_category_id: matched.id, new_category_name: '' };
            }

            return { ...prev, fin_category_id: '', new_category_name: '' };
        });
    }, [categories]);

    const handleNewTransactionCategoryNameChange = useCallback((value) => {
        setNewTx(prev => ({
            ...prev,
            fin_category_id: NEW_TRANSACTION_CATEGORY_VALUE,
            new_category_name: value
        }));
    }, []);

    useEffect(() => {
        if (!newTx.fin_category_id || newTx.fin_category_id === NEW_TRANSACTION_CATEGORY_VALUE || categories.length === 0) return;

        const selectedCategory = findCategoryById(newTx.fin_category_id);
        if (selectedCategory?.type === newTx.type) return;

        setNewTx(prev => {
            if (!prev.fin_category_id) return prev;
            if (prev.fin_category_id === NEW_TRANSACTION_CATEGORY_VALUE) return prev;

            const currentCategory = findCategoryById(prev.fin_category_id);
            if (currentCategory?.type === prev.type) return prev;

            return { ...prev, fin_category_id: '', new_category_name: '' };
        });
    }, [categories.length, findCategoryById, newTx.fin_category_id, newTx.type]);

    const handleSaveTransaction = async (e) => {
        e?.preventDefault();
        if (!newTx.description || !newTx.amount) {
            alert('Vui lòng nhập diễn giải và số tiền');
            return;
        }

        setSaving(true);
        try {
            // Convert datetime-local value (YYYY-MM-DDTHH:mm) to Laravel format (YYYY-MM-DD HH:mm:ss)
            const selectedCategory = findCategoryById(newTx.fin_category_id);
            const categoryMatchesType = selectedCategory?.type === newTx.type;
            const payload = {
                ...newTx,
                fin_category_id: categoryMatchesType ? newTx.fin_category_id : '',
                new_category_name: categoryMatchesType ? '' : newTx.new_category_name,
                transaction_date: newTx.transaction_date.replace('T', ' ') + ':00'
            };

            const res = await financeApi.saveFundTransaction(payload);
            if (res.data.status === 'success') {
                // Reset form
                setNewTx({
                    id: null,
                    transaction_date: getCurrentDateTime(),
                    description: '',
                    fin_account_id: accounts.length > 0 ? accounts[0].id : '',
                    fin_category_id: '',
                    type: 'income',
                    amount: '',
                    notes: '',
                    new_category_name: ''
                });
                // Reload
                await loadData();
            } else {
                throw new Error(res.data.message);
            }
        } catch (error) {
            alert(error.response?.data?.message || error.message || 'Lỗi khi lưu giao dịch');
        } finally {
            setSaving(false);
        }
    };

    const handleEditTransaction = (tx) => {
        setEntryPanelVisible(true);

        // Chuyển format YYYY-MM-DD HH:mm:ss sang YYYY-MM-DDTHH:mm
        let dt = tx.transaction_date;
        if (dt.includes(' ')) {
            dt = dt.substring(0, 16).replace(' ', 'T');
        }

        const categoryType = tx.category?.type || findCategoryById(tx.fin_category_id)?.type;
        const categoryMatchesType = !categoryType || categoryType === tx.type;

        setNewTx({
            id: tx.id,
            transaction_date: dt,
            description: tx.description,
            fin_account_id: tx.fin_account_id,
            fin_category_id: categoryMatchesType ? (tx.fin_category_id || '') : '',
            type: tx.type,
            amount: tx.amount,
            notes: tx.notes || '',
            new_category_name: ''
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteTransaction = async (id) => {
        if (!window.confirm('Bạn có chắc muốn xóa giao dịch này? Số dư sẽ được cập nhật lại.')) return;
        try {
            await financeApi.deleteFundTransaction(id);
            loadData();
        } catch (error) {
            alert('Lỗi khi xóa giao dịch');
        }
    };

    const handleUpdateInitialBalance = async (accountId, balance) => {
        const val = prompt('Nhập số dư đầu kỳ cho tài khoản này:', balance);
        if (val === null) return; // Cancelled
        if (isNaN(val)) { alert('Vui lòng nhập số hợp lệ'); return; }

        try {
            await financeApi.updateFundAccountInitial(accountId, { initial_balance: val });
            loadData();
        } catch(e) {
            alert('Lỗi cập nhật số dư đầu kỳ');
        }
    };

    const persistCategoryOrder = async (nextCategories) => {
        const normalizedCategories = nextCategories.map((category, index) => ({
            ...category,
            sort_order: index + 1
        }));

        setCategories(normalizedCategories);
        setReorderingCategories(true);

        try {
            const response = await financeApi.reorderFundCategories(
                normalizedCategories.map(category => category.id)
            );
            if (response.data.status === 'success') {
                setCategories(response.data.data);
            }
        } catch (error) {
            alert(error.response?.data?.message || 'Không thể lưu thứ tự hạng mục');
            await loadData();
        } finally {
            setReorderingCategories(false);
        }
    };

    const moveCategoryToIndex = (categoryId, targetIndex) => {
        if (reorderingCategories) return;

        const sourceIndex = categories.findIndex(category => category.id === categoryId);
        const boundedTargetIndex = Math.max(0, Math.min(targetIndex, categories.length - 1));
        if (sourceIndex < 0 || sourceIndex === boundedTargetIndex) return;

        const nextCategories = [...categories];
        const [movedCategory] = nextCategories.splice(sourceIndex, 1);
        nextCategories.splice(boundedTargetIndex, 0, movedCategory);
        persistCategoryOrder(nextCategories);
    };

    const handleCategoryDragStart = (event, categoryId) => {
        if (reorderingCategories) {
            event.preventDefault();
            return;
        }

        setDraggingCategoryId(categoryId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(categoryId));
    };

    const handleCategoryDrop = (event, targetCategoryId) => {
        event.preventDefault();
        const sourceCategoryId = draggingCategoryId
            ?? Number(event.dataTransfer.getData('text/plain'));
        const targetIndex = categories.findIndex(category => category.id === targetCategoryId);

        setDraggingCategoryId(null);
        setDragOverCategoryId(null);
        if (sourceCategoryId && targetIndex >= 0) {
            moveCategoryToIndex(Number(sourceCategoryId), targetIndex);
        }
    };

    const loadReport = async () => {
        try {
            const res = await financeApi.getFundReport(reportFilter);
            if (res.data.status === 'success') {
                setReportData(res.data.data);
            }
        } catch (error) {
            alert('Lỗi khi tải báo cáo thống kê');
        }
    };

    useEffect(() => {
        if (reportOpen) {
            loadReport();
        }
    }, [reportOpen, reportFilter]);

    const renderTransactionCard = (tx) => {
        const isIncome = tx.type === 'income';
        const categoryColor = tx.category?.color || '#94a3b8';

        return (
            <article
                key={tx.id}
                className={`rounded-lg border bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md lg:p-3 ${
                    newTx.id === tx.id ? 'border-orange-300 ring-1 ring-orange-100' : 'border-gray-200'
                }`}
            >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold leading-5 text-gray-500">
                        <span className="shrink-0 text-gray-600">{formatDateString(tx.transaction_date)}</span>
                        <span className="shrink-0 text-gray-300">|</span>
                        <span className="min-w-0 truncate text-gray-800">{tx.account?.name || 'Chưa có tài khoản'}</span>
                        <span className="shrink-0 text-gray-300">|</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase leading-4 ${
                            isIncome ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                            {isIncome ? 'Thu' : 'Chi'}
                        </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => handleEditTransaction(tx)}
                            className="group/edit relative flex size-9 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200 lg:size-8"
                            title="Sửa"
                            aria-label="Sửa giao dịch"
                        >
                            <span className="material-symbols-outlined text-[18px] lg:text-[17px]">edit</span>
                            <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/edit:block group-focus-visible/edit:block group-active/edit:block">
                                Sửa
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="group/delete relative flex size-9 items-center justify-center rounded-md border border-red-100 bg-red-50 text-red-600 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 lg:size-8"
                            title="Xóa"
                            aria-label="Xóa giao dịch"
                        >
                            <span className="material-symbols-outlined text-[18px] lg:text-[17px]">delete</span>
                            <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/delete:block group-focus-visible/delete:block group-active/delete:block">
                                Xóa
                            </span>
                        </button>
                    </div>
                </div>

                <div className="mt-2 space-y-1">
                    <p className="line-clamp-2 break-words text-[13px] font-medium leading-[18px] text-gray-800 lg:line-clamp-1" title={tx.description}>
                        {tx.description}
                    </p>

                    {tx.category ? (
                        <span
                            className="inline-flex max-w-full items-center gap-1.5 text-[11px] font-semibold leading-4 text-gray-400"
                        >
                            <span className="size-1.5 shrink-0 rounded-full" style={{backgroundColor: categoryColor}}></span>
                            <span className="min-w-0 truncate">{tx.category.name}</span>
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium italic leading-4 text-gray-400">
                            <span className="size-1.5 shrink-0 rounded-full bg-gray-300"></span>
                            Chưa phân loại
                        </span>
                    )}
                </div>

                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-gray-100 pt-1.5">
                    <p className={`min-w-0 break-words text-[15px] font-extrabold leading-5 tracking-tight ${
                        isIncome ? 'text-green-600' : 'text-red-600'
                    }`}>
                        <span className="mr-1 text-[11px] font-bold uppercase text-gray-500">{isIncome ? 'Thu' : 'Chi'}:</span>
                        {formatCurrency(tx.amount)}
                    </p>
                    <p className="min-w-0 break-words text-right text-[12px] font-bold leading-5 text-gray-600">
                        <span className="font-semibold text-gray-500">Tồn:</span> {formatCurrency(tx.balance_after)}
                    </p>
                </div>
            </article>
        );
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] p-2 pt-1.5 font-sans sm:p-4 md:p-6">
            {/* Header & Title */}
            <div className="mb-1.5 flex min-w-0 items-center gap-1.5 lg:mb-4 lg:gap-4">
                {isSidebarDrawerMode && (
                    <button
                        type="button"
                        onClick={toggleMobileSidebar}
                        aria-expanded={isMobileSidebarOpen}
                        aria-controls="admin-mobile-sidebar"
                        className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-primary/10 bg-white px-2 text-primary shadow-[0_8px_22px_rgba(27,54,93,0.08)] transition-colors hover:bg-primary hover:text-white lg:hidden"
                    >
                        <span className="material-symbols-outlined text-[20px] leading-none">{isMobileSidebarOpen ? 'close' : 'menu'}</span>
                        <span className="hidden text-[11px] font-bold uppercase tracking-[0.08em] sm:inline">Menu</span>
                    </button>
                )}
                <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-tight text-gray-800 lg:flex-none lg:text-[20px]">
                    Quản lý dòng tiền
                </h1>
                <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
                    <button
                        onClick={() => openFundModal(setCategoryModalOpen)}
                        className="group relative flex size-8 items-center justify-center rounded border border-blue-100 bg-blue-50 text-blue-600 transition hover:bg-blue-100 sm:size-9 lg:h-auto lg:w-auto lg:border-0 lg:px-3 lg:py-1 lg:text-[13px] lg:font-medium"
                        title="Quản lý hạng mục"
                        aria-label="Quản lý hạng mục"
                    >
                        <span className="material-symbols-outlined text-[18px] lg:hidden">category</span>
                        <span className="hidden lg:inline">Quản lý hạng mục</span>
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block group-focus-visible:block group-active:block lg:hidden">Hạng mục</span>
                    </button>
                    <button
                        onClick={() => openFundModal(setAccountModalOpen)}
                        className="group relative flex size-8 items-center justify-center rounded border border-orange-100 bg-orange-50 text-orange-600 transition hover:bg-orange-100 sm:size-9 lg:h-auto lg:w-auto lg:border-0 lg:px-3 lg:py-1 lg:text-[13px] lg:font-medium"
                        title="Số dư đầu kỳ"
                        aria-label="Số dư đầu kỳ"
                    >
                        <span className="material-symbols-outlined text-[18px] lg:hidden">account_balance_wallet</span>
                        <span className="hidden lg:inline">Số dư đầu kỳ</span>
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block group-focus-visible:block group-active:block lg:hidden">Đầu kỳ</span>
                    </button>
                    <button
                        onClick={() => openFundModal(setTransferOpen)}
                        className="group relative flex size-8 items-center justify-center rounded border border-teal-100 bg-teal-50 text-teal-600 transition hover:bg-teal-100 sm:size-9 lg:h-auto lg:w-auto lg:gap-1 lg:border-0 lg:px-3 lg:py-1 lg:text-[13px] lg:font-medium"
                        title="Chuyển quỹ"
                        aria-label="Chuyển quỹ"
                    >
                        <span className="material-symbols-outlined text-[18px] lg:text-[16px]">swap_horiz</span>
                        <span className="hidden lg:inline">Chuyển quỹ</span>
                        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block group-focus-visible:block group-active:block lg:hidden">Chuyển quỹ</span>
                    </button>
                    <button
                        onClick={() => openFundModal(setReportOpen)}
                        className="group relative flex size-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 sm:hidden"
                        title="Thống kê số dư"
                        aria-label="Thống kê số dư"
                    >
                        <span className="material-symbols-outlined text-[19px]">bar_chart</span>
                        <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block group-focus-visible:block group-active:block">Thống kê</span>
                    </button>
                </div>
            </div>

            {/* Thẻ Thống Kê Nhanh (Slim Cards) */}
            <div className="mb-2 grid grid-cols-3 gap-1.5 sm:mb-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 lg:gap-4">
                {/* Tổng số dư */}
                <div className="relative min-w-0 overflow-hidden rounded-lg border border-gray-100 bg-white p-2 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:col-span-2 sm:p-4 lg:col-span-1">
                    <div className="absolute left-0 top-0 h-full w-0.5 bg-blue-500 sm:w-1"></div>
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-4">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 sm:size-10">
                            <span className="material-symbols-outlined text-[17px] sm:text-[24px]">account_balance_wallet</span>
                        </div>
                        <div className="min-w-0">
                            <p className="mb-0.5 hidden text-[12px] font-semibold uppercase tracking-wider text-gray-500 sm:block">Tổng số dư</p>
                            <h3 className="break-words text-[12px] font-bold leading-tight text-gray-900 sm:text-[16px]">{formatCurrency(summary.total)}</h3>
                        </div>
                    </div>
                </div>

                {/* Tiền mặt */}
                <div className="relative min-w-0 overflow-hidden rounded-lg border border-gray-100 bg-white p-2 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:p-4">
                    <div className="absolute left-0 top-0 h-full w-0.5 bg-green-500 sm:w-1"></div>
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-4">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600 sm:size-10">
                            <span className="material-symbols-outlined text-[17px] sm:text-[24px]">payments</span>
                        </div>
                        <div className="min-w-0">
                            <p className="mb-0.5 hidden text-[12px] font-semibold uppercase tracking-wider text-gray-500 sm:block">Tiền mặt</p>
                            <h3 className="break-words text-[12px] font-bold leading-tight text-gray-900 sm:text-[16px]">{formatCurrency(summary.cash)}</h3>
                        </div>
                    </div>
                </div>

                {/* Ngân hàng */}
                <div className="relative min-w-0 overflow-hidden rounded-lg border border-gray-100 bg-white p-2 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:p-4">
                    <div className="absolute left-0 top-0 h-full w-0.5 bg-purple-500 sm:w-1"></div>
                    <div className="flex min-w-0 items-center justify-between">
                        <div className="flex min-w-0 items-center gap-1.5 sm:gap-4">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-purple-50 text-purple-600 sm:size-10">
                                <span className="material-symbols-outlined text-[17px] sm:text-[24px]">account_balance</span>
                            </div>
                            <div className="min-w-0">
                                <p className="mb-0.5 hidden text-[12px] font-semibold uppercase tracking-wider text-gray-500 sm:block">Ngân hàng</p>
                                <h3 className="break-words text-[12px] font-bold leading-tight text-gray-900 sm:text-[16px]">{formatCurrency(summary.bank)}</h3>
                            </div>
                        </div>
                        {/* Nút xem báo cáo biểu đồ */}
                        <button
                        onClick={() => openFundModal(setReportOpen)}
                            className="hidden items-center justify-center rounded-full border border-gray-200 bg-gray-50 p-2 text-gray-600 shadow-sm transition-colors hover:bg-gray-100 sm:flex"
                            title="Báo cáo thu chi"
                        >
                            <span className="material-symbols-outlined text-[20px]">bar_chart</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="mb-3 space-y-2 lg:mb-4 lg:flex lg:items-center lg:gap-2 lg:space-y-0">
                <div className="custom-scrollbar -mx-2 flex gap-1.5 overflow-x-auto px-2 pb-1 lg:mx-0 lg:flex-1 lg:gap-2 lg:px-0">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium transition-colors lg:h-auto lg:px-4 lg:py-1.5 lg:text-[13px] ${activeTab === 'all' ? 'bg-[#1e293b] text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                        title="Tất cả chung"
                    >
                        <span className="material-symbols-outlined text-[15px] lg:hidden">apps</span>
                        <span className="lg:hidden">Tất cả</span>
                        <span className="hidden lg:inline">Tất cả chung</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('cash')}
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium transition-colors lg:h-auto lg:px-4 lg:py-1.5 lg:text-[13px] ${activeTab === 'cash' ? 'bg-[#1e293b] text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                        title="Tất cả Tiền mặt"
                    >
                        <span className="material-symbols-outlined text-[15px] lg:hidden">payments</span>
                        <span className="lg:hidden">TM</span>
                        <span className="hidden lg:inline">Tất cả Tiền mặt</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('bank')}
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium transition-colors lg:h-auto lg:px-4 lg:py-1.5 lg:text-[13px] ${activeTab === 'bank' ? 'bg-[#1e293b] text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                        title="Tất cả Ngân hàng"
                    >
                        <span className="material-symbols-outlined text-[15px] lg:hidden">account_balance</span>
                        <span className="lg:hidden">NH</span>
                        <span className="hidden lg:inline">Tất cả Ngân hàng</span>
                    </button>
                    {accounts.map(acc => (
                        <button
                            key={acc.id}
                            onClick={() => setActiveTab(acc.id.toString())}
                            className={`inline-flex h-8 max-w-[128px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium transition-colors lg:h-auto lg:max-w-none lg:px-4 lg:py-1.5 lg:text-[13px] ${activeTab === acc.id.toString() ? 'bg-orange-600 text-white' : 'border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
                            title={acc.name}
                        >
                            <span className="material-symbols-outlined text-[15px] lg:hidden">{acc.type === 'cash' ? 'payments' : 'account_balance'}</span>
                            <span className="min-w-0 truncate lg:hidden">{getCompactAccountName(acc.name)}</span>
                            <span className="hidden lg:inline">{acc.name}</span>
                        </button>
                    ))}

                    <button
                        onClick={() => loadData()}
                        className="ml-0 flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 lg:ml-auto"
                        title="Làm mới dữ liệu"
                        aria-label="Làm mới dữ liệu"
                    >
                        <span className={`material-symbols-outlined text-[19px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                    </button>

                    <button
                        onClick={() => openFundModal(setFilterOpen)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                        title="Bộ lọc nâng cao"
                        aria-label="Bộ lọc nâng cao"
                    >
                        <span className="material-symbols-outlined text-[19px]">tune</span>
                    </button>
                </div>

                <div className="flex w-full items-center gap-2 lg:w-[300px] lg:shrink-0">
                    <div className="relative min-w-0 flex-1">
                    <span className="material-symbols-outlined absolute left-3 text-[18px] text-gray-400">search</span>
                    <input
                        type="text"
                        placeholder="Tìm diễn giải, ghi chú..."
                        className="h-9 w-full rounded-full border border-gray-200 py-2 pl-9 pr-4 text-[13px] transition-all focus:border-blue-500 focus:outline-none lg:h-auto lg:py-1.5"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    </div>
                    <button
                        type="button"
                        onClick={() => setEntryPanelVisible((visible) => !visible)}
                        aria-pressed={!entryPanelVisible}
                        className={`flex h-9 w-10 shrink-0 items-center justify-center rounded-full border text-[13px] shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-200 lg:h-8 lg:w-9 ${
                            entryPanelVisible
                                ? 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                : 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                        title={entryPanelVisible ? 'Chỉ xem danh sách giao dịch' : 'Hiện form thêm giao dịch mới'}
                        aria-label={entryPanelVisible ? 'Chỉ xem danh sách giao dịch' : 'Hiện form thêm giao dịch mới'}
                    >
                        <span className="material-symbols-outlined text-[20px]">
                            {entryPanelVisible ? 'view_list' : 'visibility'}
                        </span>
                    </button>
                </div>
            </div>

            {/* Bảng Dòng Tiền (Spreadsheet-style) */}
            <div className="relative overflow-hidden rounded-lg border-0 bg-transparent shadow-none lg:border lg:border-gray-200 lg:bg-white lg:shadow-sm">
                {loading && (
                    <div className="absolute inset-x-0 top-0 z-30 flex h-[70vh] items-center justify-center bg-white/60 backdrop-blur-[1px] lg:inset-0 lg:h-auto">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                )}

                {/* Mobile/Tablet quick input and transaction cards */}
                <div className={`${entryPanelVisible ? 'space-y-3' : 'space-y-2'} lg:hidden`}>
                    {entryPanelVisible && (
                    <form
                        onSubmit={handleSaveTransaction}
                        className={`rounded-lg border p-4 shadow-sm ${
                            newTx.id
                                ? 'border-orange-300 bg-orange-50/60'
                                : 'border-amber-200 bg-amber-50/60'
                        }`}
                    >
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[14px] font-bold text-gray-800">
                                    {newTx.id ? 'Cập nhật giao dịch' : 'Thêm giao dịch mới'}
                                </p>
                                <p className="mt-0.5 text-[12px] text-gray-500">Tồn quỹ được tự động tính sau khi lưu.</p>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                newTx.type === 'income'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                            }`}>
                                {newTx.type === 'income' ? 'KHOẢN THU' : 'KHOẢN CHI'}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                            <label className="block min-w-0">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Thời gian</span>
                                <input
                                    type="datetime-local"
                                    className="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-2 text-[12px] font-medium text-gray-800 outline-none focus:border-blue-500 sm:min-h-11 sm:px-3 sm:py-2 sm:text-[14px]"
                                    value={newTx.transaction_date}
                                    onChange={(e) => setNewTx({...newTx, transaction_date: e.target.value})}
                                />
                            </label>

                            <label className="block min-w-0">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Tài khoản</span>
                                <select
                                    className="h-10 min-w-0 w-full rounded-md border border-gray-200 bg-white px-2 text-[12px] font-medium text-gray-800 outline-none focus:border-blue-500 sm:min-h-11 sm:px-3 sm:py-2 sm:text-[14px]"
                                    value={newTx.fin_account_id}
                                    onChange={(e) => setNewTx({...newTx, fin_account_id: e.target.value})}
                                >
                                    <option value="">Chọn tài khoản</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                                    ))}
                                </select>
                            </label>

                            <div className="col-span-2">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Loại giao dịch</span>
                                <div className="grid grid-cols-2 rounded-md border border-gray-200 bg-white p-1">
                                    <button
                                        type="button"
                                        onClick={() => handleTransactionTypeChange('income')}
                                        className={`min-h-10 rounded px-3 text-[13px] font-bold transition-colors ${
                                            newTx.type === 'income'
                                                ? 'bg-green-100 text-green-700'
                                                : 'text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >
                                        Thu
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleTransactionTypeChange('expense')}
                                        className={`min-h-10 rounded px-3 text-[13px] font-bold transition-colors ${
                                            newTx.type === 'expense'
                                                ? 'bg-red-100 text-red-700'
                                                : 'text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >
                                        Chi
                                    </button>
                                </div>
                            </div>

                            <label className="col-span-2 block">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Hạng mục</span>
                                <select
                                    className="min-h-11 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-500"
                                    value={transactionCategorySelectValue}
                                    onChange={(e) => handleTransactionCategorySelectChange(e.target.value)}
                                >
                                    <option value="">-- Chọn hạng mục --</option>
                                    {filteredTransactionCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                    <option value={NEW_TRANSACTION_CATEGORY_VALUE}>+ Nhập hạng mục mới</option>
                                </select>
                                {newTx.fin_category_id === NEW_TRANSACTION_CATEGORY_VALUE && (
                                    <input
                                        type="text"
                                        className="mt-2 min-h-11 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-500"
                                        placeholder="Tên hạng mục mới"
                                        value={newTx.new_category_name}
                                        onChange={(e) => handleNewTransactionCategoryNameChange(e.target.value)}
                                    />
                                )}
                            </label>

                            <label className="col-span-2 block">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Diễn giải</span>
                                <input
                                    type="text"
                                    className="min-h-11 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[14px] font-medium text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400 focus:border-blue-500"
                                    placeholder="Nhập nội dung giao dịch"
                                    value={newTx.description}
                                    onChange={(e) => setNewTx({...newTx, description: e.target.value})}
                                />
                            </label>

                            <label className="col-span-2 block">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">
                                    Số tiền {newTx.type === 'income' ? 'thu' : 'chi'}
                                </span>
                                <div className="relative">
                                    <input
                                        ref={amountInputRef}
                                        type="text"
                                        inputMode="numeric"
                                        className={`min-h-12 w-full rounded-md border bg-white py-2 pl-3 pr-10 text-right text-[18px] font-bold outline-none ${
                                            newTx.type === 'income'
                                                ? 'border-green-200 text-green-700 focus:border-green-500'
                                                : 'border-red-200 text-red-700 focus:border-red-500'
                                        }`}
                                        placeholder="0"
                                        value={newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                        onChange={(e) => setNewTx({...newTx, amount: e.target.value.replace(/\D/g, '')})}
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-gray-400">đ</span>
                                </div>
                            </label>
                        </div>

                        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            {newTx.id && (
                                <button
                                    type="button"
                                    onClick={() => setNewTx({
                                        id: null,
                                        transaction_date: getCurrentDateTime(),
                                        description: '',
                                        fin_account_id: accounts.length > 0 ? accounts[0].id : '',
                                        fin_category_id: '',
                                        type: 'income',
                                        amount: '',
                                        notes: '',
                                        new_category_name: ''
                                    })}
                                    className="min-h-11 rounded-md border border-gray-200 bg-white px-4 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
                                >
                                    Hủy sửa
                                </button>
                            )}
                            <button
                                type="submit"
                                disabled={saving || !newTx.amount || !newTx.description}
                                className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#1e293b] px-5 text-[14px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-30"
                            >
                                {saving
                                    ? <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                                    : <span className="material-symbols-outlined text-[18px]">{newTx.id ? 'check' : 'add'}</span>
                                }
                                {newTx.id ? 'Cập nhật giao dịch' : 'Lưu giao dịch'}
                            </button>
                        </div>
                    </form>
                    )}

                    {transactions.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-[13px] font-medium tracking-wide text-gray-400">
                            Chưa có giao dịch nào!
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {transactions.map(renderTransactionCard)}
                        </div>
                    )}
                </div>

                <div className="relative hidden max-h-[650px] overflow-y-auto custom-scrollbar lg:block">
                    {entryPanelVisible && (
                    <div className="overflow-x-auto border-b border-gray-200">
                    <table className="w-full text-left border-collapse min-w-[1120px]">
                        <thead className="bg-[#f8f9fa] sticky top-0 z-20 shadow-sm border-b border-gray-200">
                            <tr>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200 w-[160px]">Thời gian (Giờ/Ngày)</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200 w-[130px]">Tài khoản</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200 w-[120px]">Loại giao dịch</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200 w-[150px]">Hạng mục</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200">Diễn giải</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-green-700 border-r border-gray-200 w-[130px] text-right bg-green-50/30">Thu</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-red-700 border-r border-gray-200 w-[130px] text-right bg-red-50/30">Chi</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-blue-800 border-r border-gray-200 w-[130px] text-right bg-blue-50/30">Tồn</th>
                                <th className="py-3 px-2 text-[13px] font-bold text-gray-700 w-16 text-center">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {/* Dòng thêm mới nhanh (Quick Input) */}
                            <tr className={`${newTx.id ? 'bg-orange-50/40 border-2 border-orange-300' : 'bg-yellow-50/40'} border-b border-gray-300 relative`}>
                                <td className="p-1 border-r border-gray-200">
                                    <input
                                        type="datetime-local"
                                        className="w-full text-[13px] px-1 py-2 focus:outline-none focus:bg-white bg-transparent transition-colors font-medium text-gray-800"
                                        value={newTx.transaction_date}
                                        onChange={(e) => setNewTx({...newTx, transaction_date: e.target.value})}
                                    />
                                </td>
                                <td className="p-1 border-r border-gray-200">
                                    <select
                                        className="w-full text-[13px] px-1 py-2 focus:outline-none focus:bg-white bg-transparent font-medium"
                                        value={newTx.fin_account_id}
                                        onChange={(e) => setNewTx({...newTx, fin_account_id: e.target.value})}
                                    >
                                        <option value="">-- Chọn TK --</option>
                                        {accounts.map(acc => (
                                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="p-1 border-r border-gray-200">
                                    <div className="grid grid-cols-2 rounded border border-gray-200 bg-white p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => handleTransactionTypeChange('income')}
                                            className={`min-h-8 rounded text-[12px] font-bold transition-colors ${
                                                newTx.type === 'income'
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'text-gray-500 hover:bg-gray-50'
                                            }`}
                                        >
                                            Thu
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleTransactionTypeChange('expense')}
                                            className={`min-h-8 rounded text-[12px] font-bold transition-colors ${
                                                newTx.type === 'expense'
                                                    ? 'bg-red-100 text-red-700'
                                                    : 'text-gray-500 hover:bg-gray-50'
                                            }`}
                                        >
                                            Chi
                                        </button>
                                    </div>
                                </td>
                                <td className="p-1 border-r border-gray-200">
                                    <div className="relative">
                                        <select
                                            className="w-full text-[13px] px-2 py-2 focus:outline-none focus:bg-white bg-transparent"
                                            value={transactionCategorySelectValue}
                                            onChange={(e) => handleTransactionCategorySelectChange(e.target.value)}
                                        >
                                            <option value="">-- Chọn mục --</option>
                                            {filteredTransactionCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                            <option value={NEW_TRANSACTION_CATEGORY_VALUE}>+ Mục mới</option>
                                        </select>
                                        {newTx.fin_category_id === NEW_TRANSACTION_CATEGORY_VALUE && (
                                            <input
                                                type="text"
                                                className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[12px] focus:border-blue-500 focus:outline-none"
                                                placeholder="Tên hạng mục mới"
                                                value={newTx.new_category_name}
                                                onChange={(e) => handleNewTransactionCategoryNameChange(e.target.value)}
                                            />
                                        )}
                                    </div>
                                </td>
                                <td className="p-1 border-r border-gray-200">
                                    <input
                                        type="text"
                                        className="w-full text-[13px] px-2 py-2 focus:outline-none focus:bg-white bg-transparent font-medium text-gray-900 placeholder:font-normal"
                                        placeholder="Nhập diễn giải (bấm Enter để lưu)..."
                                        value={newTx.description}
                                        onChange={(e) => setNewTx({...newTx, description: e.target.value})}
                                        onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); handleSaveTransaction(); } }}
                                    />
                                </td>
                                <td className="p-1 border-r border-gray-200 bg-green-50/20">
                                    <div className="flex items-center">
                                        <div className="w-8 flex border-r border-gray-200 h-full cursor-pointer opacity-40 hover:opacity-100 pr-1" title="Khoản THU" onClick={() => handleTransactionTypeChange('income')}>
                                            <input type="radio" readOnly checked={newTx.type === 'income'} className="cursor-pointer mx-auto" />
                                        </div>
                                        <input
                                            ref={incomeInputRef}
                                            type="text"
                                            className={`w-full text-[13px] px-1 py-2 focus:outline-none focus:bg-white bg-transparent text-right font-bold ${newTx.type === 'income' ? 'text-green-700' : 'text-gray-300'}`}
                                            placeholder={newTx.type === 'income' ? "Số tiền THU..." : ""}
                                            value={newTx.type === 'income' && newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                            onChange={(e) => handleTransactionAmountChange('income', e.target.value)}
                                            onKeyDown={(e) => { if(e.key === 'Enter') handleSaveTransaction(e); }}
                                        />
                                    </div>
                                </td>
                                <td className="p-1 border-r border-gray-200 bg-red-50/20">
                                    <div className="flex items-center">
                                        <div className="w-8 flex border-r border-gray-200 h-full cursor-pointer opacity-40 hover:opacity-100 pr-1" title="Khoản CHI" onClick={() => handleTransactionTypeChange('expense')}>
                                            <input type="radio" readOnly checked={newTx.type === 'expense'} className="cursor-pointer mx-auto" />
                                        </div>
                                        <input
                                            ref={expenseInputRef}
                                            type="text"
                                            className={`w-full text-[13px] px-1 py-2 focus:outline-none focus:bg-white bg-transparent text-right font-bold ${newTx.type === 'expense' ? 'text-red-700' : 'text-gray-300'}`}
                                            placeholder={newTx.type === 'expense' ? "Số tiền CHI..." : ""}
                                            value={newTx.type === 'expense' && newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                            onChange={(e) => handleTransactionAmountChange('expense', e.target.value)}
                                            onKeyDown={(e) => { if(e.key === 'Enter') handleSaveTransaction(e); }}
                                        />
                                    </div>
                                </td>
                                <td className="p-1 border-r border-gray-200 text-right bg-blue-50/20 px-2 text-[12px] text-gray-500 flex items-center justify-end font-medium italic">
                                    Tự động tính
                                </td>
                                <td className="p-1 text-center bg-gray-50/50 flex flex-col items-center justify-center h-full gap-1">
                                    <button
                                        onClick={handleSaveTransaction}
                                        disabled={saving || !newTx.amount || !newTx.description}
                                        className="text-white hover:opacity-90 disabled:opacity-30 bg-[#1e293b] rounded w-[26px] h-[26px] flex items-center justify-center transition-opacity mx-auto"
                                        title={newTx.id ? "Cập nhật" : "Lưu giao dịch"}
                                    >
                                        {saving ? <div className="animate-spin rounded-full h-3 w-3 border-b-[2px] border-white"></div> : <span className="material-symbols-outlined text-[16px]">{newTx.id ? 'check' : 'add'}</span>}
                                    </button>
                                    {newTx.id && (
                                        <button
                                            onClick={() => setNewTx({
                                                id: null,
                                                transaction_date: getCurrentDateTime(),
                                                description: '',
                                                fin_account_id: accounts.length > 0 ? accounts[0].id : '',
                                                fin_category_id: '',
                                                type: 'income',
                                                amount: '',
                                                notes: '',
                                                new_category_name: ''
                                            })}
                                            className="text-gray-500 hover:text-red-500 text-[11px] underline"
                                        >
                                            Hủy sửa
                                        </button>
                                    )}
                                </td>
                            </tr>

                        </tbody>
                    </table>
                    </div>
                    )}

                    <div className="bg-[#f8f9fa] p-4">
                        {transactions.length === 0 ? (
                            <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-[13px] font-medium tracking-wide text-gray-400">
                                Chưa có giao dịch nào!
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                                {transactions.map(renderTransactionCard)}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal Quản lý Hạng mục */}
            {categoryModalOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm animate-fade-in lg:items-center lg:p-4">
                    <div className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-white shadow-2xl lg:h-auto lg:max-h-[90vh] lg:max-w-2xl lg:rounded-xl">
                        <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-gray-50 px-3 py-2.5 lg:px-5">
                            <h3 className="min-w-0 truncate text-[15px] font-bold lg:text-[16px]">Cấu hình Hạng mục Thu Chi</h3>
                            <button
                                type="button"
                                onClick={closeFundModal}
                                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-100"
                            >
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Quay lại
                            </button>
                        </div>

                        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_7.25rem] gap-x-2 gap-y-1.5 border-b bg-white p-2.5 sm:grid-cols-[minmax(0,1fr)_8rem] lg:flex lg:items-end lg:gap-3 lg:p-4">
                            <div className="min-w-0 lg:flex-1">
                                <label className="mb-0.5 block text-[10px] font-bold uppercase text-gray-500 lg:text-[11px]">Tên Hạng mục</label>
                                <input
                                    type="text"
                                    className="h-9 w-full rounded border border-gray-200 px-2 text-[13px] outline-none focus:border-blue-500"
                                    value={editingCategory.name}
                                    onChange={e => setEditingCategory({...editingCategory, name: e.target.value})}
                                    placeholder="Nhập tên..."
                                />
                            </div>
                            <div className="min-w-0 lg:w-32">
                                <label className="mb-0.5 block text-[10px] font-bold uppercase text-gray-500 lg:text-[11px]">Loại</label>
                                <select
                                    className="h-9 w-full rounded border border-gray-200 px-2 text-[13px] outline-none focus:border-blue-500"
                                    value={editingCategory.type}
                                    onChange={e => setEditingCategory({...editingCategory, type: e.target.value})}
                                >
                                    <option value="expense">Chi phí</option>
                                    <option value="income">Doanh thu</option>
                                </select>
                            </div>
                            <div className="min-w-0 lg:w-16">
                                <label className="mb-0.5 block text-[10px] font-bold uppercase text-gray-500 lg:text-[11px]">Màu sắc</label>
                                <input
                                    type="color"
                                    className="h-9 w-full cursor-pointer rounded border border-gray-200 bg-white p-1 lg:border-0 lg:p-0"
                                    value={editingCategory.color}
                                    onChange={e => setEditingCategory({...editingCategory, color: e.target.value})}
                                />
                            </div>
                            <div className="flex min-w-0 items-end gap-1.5 lg:w-auto">
                                <button
                                    type="button"
                                    className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded bg-blue-600 px-2 text-[13px] font-bold text-white hover:bg-blue-700 lg:flex-none lg:px-4 lg:font-medium"
                                    onClick={async () => {
                                        if(!editingCategory.name) return alert('Nhập tên');
                                        await financeApi.saveFundCategory(editingCategory);
                                        setEditingCategory({id: null, name: '', type: 'expense', color: '#f44336'});
                                        loadData();
                                    }}
                                >
                                    <span className="material-symbols-outlined text-[17px]">{editingCategory.id ? 'check' : 'add'}</span>
                                    <span className="truncate">{editingCategory.id ? 'Cập nhật' : 'Thêm mới'}</span>
                                </button>
                                {editingCategory.id && (
                                    <button
                                        type="button"
                                        className="flex size-9 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                                        onClick={() => setEditingCategory({id: null, name: '', type: 'expense', color: '#f44336'})}
                                        title="Hủy sửa"
                                        aria-label="Hủy sửa"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-white p-3 custom-scrollbar lg:p-5">
                            <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-gray-500">
                                <span className="min-w-0">Nhập STT hoặc kéo biểu tượng để sắp xếp.</span>
                                {reorderingCategories && <span className="shrink-0 font-medium text-blue-600">Đang lưu...</span>}
                            </div>

                            <div className="space-y-1.5 lg:hidden">
                                {categories.map((c, index) => (
                                    <article
                                        key={c.id}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = 'move';
                                            setDragOverCategoryId(c.id);
                                        }}
                                        onDragLeave={() => {
                                            if (dragOverCategoryId === c.id) setDragOverCategoryId(null);
                                        }}
                                        onDrop={(event) => handleCategoryDrop(event, c.id)}
                                        className={`flex min-w-0 items-center gap-1.5 rounded-md border bg-white px-2 py-1.5 transition-colors ${
                                            dragOverCategoryId === c.id && draggingCategoryId !== c.id
                                                ? 'border-blue-300 bg-blue-50'
                                                : 'border-gray-200'
                                        } ${draggingCategoryId === c.id ? 'opacity-50' : ''}`}
                                    >
                                            <button
                                                type="button"
                                                draggable={!reorderingCategories}
                                                disabled={reorderingCategories}
                                                onDragStart={(event) => handleCategoryDragStart(event, c.id)}
                                                onDragEnd={() => {
                                                    setDraggingCategoryId(null);
                                                    setDragOverCategoryId(null);
                                                }}
                                                className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                                                title="Kéo để sắp xếp"
                                                aria-label="Kéo để sắp xếp"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
                                            </button>

                                            <input
                                                key={`mobile-${c.id}-${index}`}
                                                type="number"
                                                min="1"
                                                max={categories.length}
                                                defaultValue={index + 1}
                                                disabled={reorderingCategories}
                                                onFocus={(event) => event.target.select()}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') event.currentTarget.blur();
                                                }}
                                                onBlur={(event) => {
                                                    const requestedPosition = Number.parseInt(event.currentTarget.value, 10);
                                                    if (!Number.isFinite(requestedPosition)) {
                                                        event.currentTarget.value = index + 1;
                                                        return;
                                                    }

                                                    const targetIndex = Math.max(
                                                        0,
                                                        Math.min(requestedPosition - 1, categories.length - 1)
                                                    );
                                                    event.currentTarget.value = targetIndex + 1;
                                                    moveCategoryToIndex(c.id, targetIndex);
                                                }}
                                                className="h-8 w-9 shrink-0 rounded border border-gray-200 bg-white px-1 text-center text-[12px] font-bold text-gray-700 outline-none focus:border-blue-500 disabled:bg-gray-100"
                                                title="Nhập vị trí mới rồi nhấn Enter"
                                                aria-label="STT"
                                            />

                                            <span className="size-2.5 shrink-0 rounded-full" style={{backgroundColor: c.color}}></span>
                                            <span className="min-w-0 flex-1 truncate text-[13px] font-bold leading-5" style={{color: c.color}}>{c.name}</span>
                                            {c.type === 'income'
                                                ? <span className="shrink-0 rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-bold text-green-600">Thu</span>
                                                : <span className="shrink-0 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">Chi</span>
                                            }
                                            <div className="ml-0.5 flex shrink-0 items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setEditingCategory(c)}
                                                className="flex size-8 items-center justify-center rounded border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100"
                                                title="Sửa"
                                                aria-label="Sửa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if(window.confirm('Xóa hạng mục này? Các giao dịch cũ sẽ bị mất phân loại.')){
                                                        await financeApi.deleteFundCategory(c.id);
                                                        loadData();
                                                    }
                                                }}
                                                className="flex size-8 items-center justify-center rounded border border-red-100 bg-red-50 text-red-600 hover:bg-red-100"
                                                title="Xóa"
                                                aria-label="Xóa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>

                            <div className="hidden lg:block">
                                <table className="w-full table-fixed border-collapse text-left">
                                    <thead className="bg-[#fcfcfa]">
                                        <tr>
                                            <th className="w-28 border-b px-3 py-2.5 text-[12px] uppercase text-gray-500">STT</th>
                                            <th className="border-b px-3 py-2.5 text-[12px] uppercase text-gray-500">Tên hạng mục</th>
                                            <th className="w-24 border-b px-3 py-2.5 text-[12px] uppercase text-gray-500">Loại</th>
                                            <th className="w-20 border-b border-gray-200 px-3 py-2.5 text-right">Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y text-[13px]">
                                        {categories.map((c, index) => (
                                            <tr
                                                key={c.id}
                                                onDragOver={(event) => {
                                                    event.preventDefault();
                                                    event.dataTransfer.dropEffect = 'move';
                                                    setDragOverCategoryId(c.id);
                                                }}
                                                onDragLeave={() => {
                                                    if (dragOverCategoryId === c.id) setDragOverCategoryId(null);
                                                }}
                                                onDrop={(event) => handleCategoryDrop(event, c.id)}
                                                className={`transition-colors ${
                                                    dragOverCategoryId === c.id && draggingCategoryId !== c.id
                                                        ? 'bg-blue-50'
                                                        : 'hover:bg-gray-50'
                                                } ${draggingCategoryId === c.id ? 'opacity-50' : ''}`}
                                            >
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            draggable={!reorderingCategories}
                                                            disabled={reorderingCategories}
                                                            onDragStart={(event) => handleCategoryDragStart(event, c.id)}
                                                            onDragEnd={() => {
                                                                setDraggingCategoryId(null);
                                                                setDragOverCategoryId(null);
                                                            }}
                                                            className="flex size-7 cursor-grab items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                                                            title="Kéo để sắp xếp"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
                                                        </button>
                                                        <input
                                                            key={`desktop-${c.id}-${index}`}
                                                            type="number"
                                                            min="1"
                                                            max={categories.length}
                                                            defaultValue={index + 1}
                                                            disabled={reorderingCategories}
                                                            onFocus={(event) => event.target.select()}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter') event.currentTarget.blur();
                                                            }}
                                                            onBlur={(event) => {
                                                                const requestedPosition = Number.parseInt(event.currentTarget.value, 10);
                                                                if (!Number.isFinite(requestedPosition)) {
                                                                    event.currentTarget.value = index + 1;
                                                                    return;
                                                                }

                                                                const targetIndex = Math.max(
                                                                    0,
                                                                    Math.min(requestedPosition - 1, categories.length - 1)
                                                                );
                                                                event.currentTarget.value = targetIndex + 1;
                                                                moveCategoryToIndex(c.id, targetIndex);
                                                            }}
                                                            className="h-7 w-12 rounded border border-gray-200 bg-white px-1 text-center font-semibold text-gray-700 outline-none focus:border-blue-500 disabled:bg-gray-100"
                                                            title="Nhập vị trí mới rồi nhấn Enter"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2.5 font-medium">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <div className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor: c.color}}></div>
                                                        <span className="min-w-0 truncate" style={{color: c.color}}>{c.name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    {c.type === 'income' ? <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-600">THU</span> : <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">CHI</span>}
                                                </td>
                                                <td className="px-3 py-2.5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button type="button" onClick={() => setEditingCategory(c)} className="text-gray-400 hover:text-blue-500"><span className="material-symbols-outlined text-[16px]">edit</span></button>
                                                        <button type="button" onClick={async () => {
                                                            if(window.confirm('Xóa hạng mục này? Các giao dịch cũ sẽ bị mất phân loại.')){
                                                                await financeApi.deleteFundCategory(c.id);
                                                                loadData();
                                                            }
                                                        }} className="text-gray-400 hover:text-red-500"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Quản lý Tài khoản (Số dư đầu kỳ) */}
            {accountModalOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4">
                    <div className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-xl">
                        <div className="px-5 py-3 border-b flex justify-between items-center bg-gray-50 shrink-0">
                            <h3 className="font-bold text-[16px]">Quản lý Tài Khoản & Số dư đầu kỳ</h3>
                            <button onClick={closeFundModal} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Đóng
                            </button>
                        </div>

                        <div className="grid shrink-0 grid-cols-2 gap-2 border-b bg-white p-3 sm:flex sm:items-end sm:gap-3 sm:p-4">
                            <div className="col-span-2 min-w-0 sm:flex-1">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Tên TK (Ngân hàng, Quỹ...)</label>
                                <input type="text" className="w-full text-[13px] border rounded px-3 py-2" value={editingAccount.name} onChange={e => setEditingAccount({...editingAccount, name: e.target.value})} placeholder="E.g., ACB, VCB, Quỹ cửa hàng..."/>
                            </div>
                            <div className="min-w-0 sm:w-36">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Loại</label>
                                <select className="w-full text-[13px] border rounded px-3 py-2" value={editingAccount.type} onChange={e => setEditingAccount({...editingAccount, type: e.target.value})}>
                                    <option value="bank">Ngân hàng</option>
                                    <option value="cash">Tiền mặt</option>
                                </select>
                            </div>
                            <div className="min-w-0 sm:w-36 sm:flex-shrink-0">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Số dư đầu kỳ (đ)</label>
                                <input disabled={editingAccount.id} type="number" className="w-full text-[13px] border rounded px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400" value={editingAccount.initial_balance} onChange={e => setEditingAccount({...editingAccount, initial_balance: e.target.value})} />
                            </div>
                            <button
                                className="col-span-2 h-[38px] flex-shrink-0 rounded bg-orange-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-orange-700 sm:col-span-1"
                                onClick={async () => {
                                    if(!editingAccount.name) return alert('Nhập tên');
                                    let res = await financeApi.saveFundAccount(editingAccount);
                                    if(res.data.status === 'success' && !editingAccount.id && Number(editingAccount.initial_balance) !== 0) {
                                        await financeApi.updateFundAccountInitial(res.data.data.id, { initial_balance: editingAccount.initial_balance });
                                    }
                                    setEditingAccount({id: null, name: '', type: 'bank', initial_balance: 0});
                                    loadData();
                                }}
                            >
                                {editingAccount.id ? 'Cập nhật' : 'Thêm TK'}
                            </button>
                            {editingAccount.id && <button className="col-span-2 px-2 text-[13px] text-gray-500 underline hover:text-gray-800 sm:col-span-1" onClick={() => setEditingAccount({id: null, name: '', type: 'bank', initial_balance: 0})}>Hủy</button>}
                        </div>

                        <div className="flex-1 overflow-auto bg-white p-3 custom-scrollbar sm:p-5">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#fcfcfa]">
                                    <tr>
                                        <th className="py-2.5 px-3 border-b text-[12px] uppercase text-gray-500">Tài khoản</th>
                                        <th className="py-2.5 px-3 border-b text-[12px] uppercase text-gray-500 w-24">Loại</th>
                                        <th className="py-2.5 px-3 border-b text-[12px] uppercase text-gray-500 text-right w-40">Số dư đầu kỳ (Sửa)</th>
                                        <th className="py-2.5 px-3 border-b border-gray-200 text-right w-20">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y text-[13px]">
                                    {accounts.map((acc) => (
                                        <tr key={acc.id} className="hover:bg-gray-50 group">
                                            <td className="py-2.5 px-3 font-medium text-gray-800 flex items-center gap-2">
                                                {acc.type === 'cash' ? <span className="material-symbols-outlined text-[16px] text-green-600">payments</span> : <span className="material-symbols-outlined text-[16px] text-purple-600">account_balance</span>}
                                                {acc.name}
                                            </td>
                                            <td className="py-2.5 px-3 text-gray-500">
                                                {acc.type === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}
                                            </td>
                                            <td className="py-2.5 px-3 text-right">
                                                <input
                                                    type="text"
                                                    className="w-[120px] text-right border border-transparent hover:border-gray-300 focus:border-orange-500 focus:bg-white bg-transparent rounded outline-none p-1 font-bold text-gray-800 transition"
                                                    defaultValue={Math.round(Number(acc.initial_balance) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                                                    onFocus={(e) => {
                                                        e.target.value = Math.round(Number(acc.initial_balance) || 0); // Show raw on focus
                                                    }}
                                                    onBlur={async (e) => {
                                                        const val = Number(e.target.value.replace(/\D/g, ''));
                                                        // Format it visually
                                                        e.target.value = val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                                                        if(val == acc.initial_balance) return;
                                                        await financeApi.updateFundAccountInitial(acc.id, { initial_balance: val });
                                                        loadData();
                                                    }}
                                                    onKeyDown={(e) => { if(e.key === 'Enter') e.target.blur(); }}
                                                />
                                            </td>
                                            <td className="py-2.5 px-3 text-right flex items-center justify-end gap-2 text-gray-400 group-hover:text-gray-700">
                                                <button onClick={() => setEditingAccount({id: acc.id, name: acc.name, type: acc.type, initial_balance: acc.initial_balance})} className="hover:text-blue-500"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                <button onClick={async () => {
                                                    if(window.confirm(`Xóa tài khoản ${acc.name} vĩnh viễn?`)){
                                                        try {
                                                            await financeApi.deleteFundAccount(acc.id); loadData();
                                                        } catch(e) { alert(e.response?.data?.message || 'Có lỗi xảy ra'); }
                                                    }
                                                }} className="hover:text-red-500"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-4 text-[12px] text-gray-500 italic">* Lưu ý: Để sửa "Số dư đầu kỳ", bạn chỉ cần click thẳng vào ô số tiền ở trên, gõ số mới và bấm phím Enter.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Báo cáo thống kê */}
            {reportOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4">
                    <div className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-xl">
                        {/* Header */}
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="size-10 flex items-center justify-center rounded-full bg-blue-50 text-blue-600">
                                    <span className="material-symbols-outlined">donut_small</span>
                                </div>
                                <h3 className="min-w-0 truncate text-[16px] font-bold tracking-tight text-gray-900 sm:text-[18px]">Bảng Thống kê Thu - Chi</h3>
                            </div>
                            <button onClick={closeFundModal} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-100">
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Đóng
                            </button>
                        </div>
                        {/* Body */}
                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-gray-50/50">
                            {/* Filter Bar */}
                            <div className="bg-white p-4 rounded-lg border border-gray-200/60 shadow-sm mb-6 flex flex-col gap-4">
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[13px] font-semibold text-gray-600 uppercase tracking-wide">Từ:</span>
                                        <input
                                            type="date"
                                            className="border border-gray-300 rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-500"
                                            value={reportFilter.start_date}
                                            onChange={(e) => setReportFilter({...reportFilter, start_date: e.target.value})}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[13px] font-semibold text-gray-600 uppercase tracking-wide">Đến:</span>
                                        <input
                                            type="date"
                                            className="border border-gray-300 rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-500"
                                            value={reportFilter.end_date}
                                            onChange={(e) => setReportFilter({...reportFilter, end_date: e.target.value})}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 pt-2 border-t border-gray-100">
                                    <span className="text-[13px] font-semibold text-gray-600 uppercase tracking-wide mt-1 whitespace-nowrap">Tài khoản:</span>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => setReportFilter({...reportFilter, fin_account_ids: []})}
                                            className={`px-3 py-1 rounded text-[12px] font-medium border transition-colors ${reportFilter.fin_account_ids.length === 0 ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                                        >
                                            Tất cả (Chung)
                                        </button>
                                        {accounts.map(acc => (
                                            <button
                                                key={acc.id}
                                                onClick={() => {
                                                    const ids = [...reportFilter.fin_account_ids];
                                                    if (ids.includes(acc.id)) {
                                                        setReportFilter({...reportFilter, fin_account_ids: ids.filter(i => i !== acc.id)});
                                                    } else {
                                                        setReportFilter({...reportFilter, fin_account_ids: [...ids, acc.id]});
                                                    }
                                                }}
                                                className={`px-3 py-1 rounded text-[12px] font-medium border transition-colors ${reportFilter.fin_account_ids.includes(acc.id) ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                            >
                                                {acc.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {reportData && (
                                <div className="space-y-6">
                                    {/* Metrics summary */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div
                                            onClick={() => setReportFilter({...reportFilter, type: reportFilter.type === 'income' ? 'all' : 'income'})}
                                            className={`p-4 rounded-xl shadow-sm flex items-center justify-between cursor-pointer transition-all ${
                                                reportFilter.type === 'income' ? 'bg-green-50 border-2 border-green-500' : 'bg-white border border-green-100 hover:border-green-300'
                                            }`}
                                        >
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-widest text-green-600/70 mb-1">Tổng Thu (Kỳ này)</p>
                                                <h4 className="text-[20px] font-bold text-green-700">{formatCurrency(reportData.total_income)}</h4>
                                            </div>
                                            <span className="material-symbols-outlined text-[32px] text-green-100">trending_up</span>
                                        </div>
                                        <div
                                            onClick={() => setReportFilter({...reportFilter, type: reportFilter.type === 'expense' ? 'all' : 'expense'})}
                                            className={`p-4 rounded-xl shadow-sm flex items-center justify-between cursor-pointer transition-all ${
                                                reportFilter.type === 'expense' ? 'bg-red-50 border-2 border-red-500' : 'bg-white border border-red-100 hover:border-red-300'
                                            }`}
                                        >
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-widest text-red-600/70 mb-1">Tổng Chi (Kỳ này)</p>
                                                <h4 className="text-[20px] font-bold text-red-700">{formatCurrency(reportData.total_expense)}</h4>
                                            </div>
                                            <span className="material-symbols-outlined text-[32px] text-red-100">trending_down</span>
                                        </div>
                                    </div>

                                    {/* Table Detail */}
                                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                                        <div className="px-4 py-3 border-b border-gray-100 bg-[#f8f9fa]">
                                            <h4 className="text-[14px] font-bold text-gray-800">Chi tiết theo hạng mục</h4>
                                        </div>
                                        <div className="overflow-x-auto">
                                        <table className="w-full min-w-[560px] text-left">
                                            <thead className="bg-[#fcfcfa] border-b">
                                                <tr>
                                                    <th className="px-4 py-2.5 text-[12px] font-bold text-gray-500 uppercase tracking-wider">Hạng mục</th>
                                                    <th className="px-4 py-2.5 text-[12px] font-bold text-gray-500 uppercase tracking-wider w-24 text-center">Thu / Chi</th>
                                                    <th className="px-4 py-2.5 text-[12px] font-bold text-gray-500 uppercase tracking-wider text-right">Tổng tiền</th>
                                                    <th className="px-4 py-2.5 text-[12px] font-bold text-gray-500 uppercase tracking-wider text-right w-24">Tỷ trọng</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {reportData.report.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="4" className="py-8 text-center text-[13px] text-gray-400 italic">Không có dữ liệu trong khoảng thời gian này</td>
                                                    </tr>
                                                ) : (
                                                    <React.Fragment>
                                                        {(reportFilter.type === 'all' || reportFilter.type === 'income') && reportData.report.filter(i => i.type === 'income').length > 0 && (
                                                            <React.Fragment>
                                                                <tr className="bg-green-50/50">
                                                                    <td colSpan="4" className="px-4 py-2 text-[12px] font-bold text-green-800 tracking-wide uppercase">CÁC KHOẢN THU</td>
                                                                </tr>
                                                                {reportData.report.filter(i => i.type === 'income').map((item, idx) => {
                                                                    const percent = reportData.total_income > 0 ? (item.amount / reportData.total_income * 100).toFixed(1) : 0;
                                                                    return (
                                                                        <tr key={`inc-${idx}`} className="hover:bg-gray-50 transition-colors">
                                                                            <td className="px-4 py-3">
                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="size-3 rounded-full" style={{backgroundColor: item.color || '#ccc'}}></div>
                                                                                    <span className="text-[13px] font-medium text-gray-800">{item.name}</span>
                                                                                </div>
                                                                                <div className="w-full bg-gray-100 h-1 mt-2 rounded-full overflow-hidden">
                                                                                    <div className="h-full rounded-full" style={{width: `${percent}%`, backgroundColor: item.color || '#ccc'}}></div>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Thu</span>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-[14px] font-bold text-right tracking-tight text-green-600">
                                                                                {formatCurrency(item.amount)}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right">
                                                                                <span className="text-[12px] font-semibold text-gray-600">{percent}%</span>
                                                                            </td>
                                                                </tr>
                                                                    );
                                                                })}
                                                            </React.Fragment>
                                                        )}

                                                        {(reportFilter.type === 'all' || reportFilter.type === 'expense') && reportData.report.filter(i => i.type === 'expense').length > 0 && (
                                                            <React.Fragment>
                                                                <tr className="bg-red-50/50">
                                                                    <td colSpan="4" className="px-4 py-2 text-[12px] font-bold text-red-800 tracking-wide uppercase">CÁC KHOẢN CHI</td>
                                                                </tr>
                                                                {reportData.report.filter(i => i.type === 'expense').map((item, idx) => {
                                                                    const percent = reportData.total_expense > 0 ? (item.amount / reportData.total_expense * 100).toFixed(1) : 0;
                                                                    return (
                                                                        <tr key={`exp-${idx}`} className="hover:bg-gray-50 transition-colors">
                                                                            <td className="px-4 py-3">
                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="size-3 rounded-full" style={{backgroundColor: item.color || '#ccc'}}></div>
                                                                                    <span className="text-[13px] font-medium text-gray-800">{item.name}</span>
                                                                                </div>
                                                                                <div className="w-full bg-gray-100 h-1 mt-2 rounded-full overflow-hidden">
                                                                                    <div className="h-full rounded-full" style={{width: `${percent}%`, backgroundColor: item.color || '#ccc'}}></div>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Chi</span>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-[14px] font-bold text-right tracking-tight text-red-600">
                                                                                {formatCurrency(item.amount)}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right">
                                                                                <span className="text-[12px] font-semibold text-gray-600">{percent}%</span>
                                                                            </td>
                                                                </tr>
                                                                    );
                                                                })}
                                                            </React.Fragment>
                                                        )}
                                                    </React.Fragment>
                                                )}
                                            </tbody>
                                        </table>
                                        </div>
                                    </div>

                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Modal Tìm kiếm/Lọc nâng cao */}
            {filterOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
                    <div className="max-h-[100dvh] w-full max-w-lg overflow-hidden rounded-none bg-white shadow-2xl transition-all duration-200 sm:max-h-[90vh] sm:rounded-xl">
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-3 sm:px-5">
                            <h3 className="flex min-w-0 items-center gap-2 truncate text-[15px] font-bold">
                                <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                                Bộ lọc nâng cao
                            </h3>
                            <button onClick={closeFundModal} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Đóng
                            </button>
                        </div>
                        <div className="grid max-h-[calc(100dvh-132px)] grid-cols-2 gap-4 overflow-y-auto p-4 custom-scrollbar sm:max-h-none sm:p-5">
                            <div className="col-span-2 sm:col-span-1">
                                <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Tài khoản</label>
                                <select className="w-full text-[13px] border rounded px-3 py-2" value={advFilter.account_id} onChange={e => setAdvFilter({...advFilter, account_id: e.target.value})}>
                                    <option value="">-- Tất cả --</option>
                                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                                </select>
                            </div>
                            <div className="col-span-2 sm:col-span-1">
                                <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Loại Thu/Chi</label>
                                <select className="w-full text-[13px] border rounded px-3 py-2" value={advFilter.tx_type} onChange={e => setAdvFilter({...advFilter, tx_type: e.target.value})}>
                                    <option value="">-- Tất cả --</option>
                                    <option value="income">Chỉ Thu</option>
                                    <option value="expense">Chỉ Chi</option>
                                </select>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Hạng mục</label>
                                <select className="w-full text-[13px] border rounded px-3 py-2" value={advFilter.category_id} onChange={e => setAdvFilter({...advFilter, category_id: e.target.value})}>
                                    <option value="">-- Tất cả --</option>
                                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name} ({cat.type === 'income' ? 'Thu' : 'Chi'})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Từ ngày</label>
                                <input type="date" className="w-full text-[13px] border rounded px-3 py-2" value={advFilter.start_date} onChange={e => setAdvFilter({...advFilter, start_date: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Đến ngày</label>
                                <input type="date" className="w-full text-[13px] border rounded px-3 py-2" value={advFilter.end_date} onChange={e => setAdvFilter({...advFilter, end_date: e.target.value})} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 border-t bg-gray-50 p-4">
                            <button
                                className="text-[13px] text-gray-600 hover:text-gray-900 underline"
                                onClick={() => setAdvFilter({account_id: '', category_id: '', start_date: '', end_date: '', tx_type: ''})}
                            >
                                Xóa bộ lọc
                            </button>
                            <button
                                className="bg-[#1e293b] text-white px-5 py-2 rounded text-[13px] font-medium hover:opacity-90 transition-opacity"
                                onClick={closeFundModal}
                            >
                                Áp dụng
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Chuyển quỹ */}
            {transferOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
                    <div className="max-h-[100dvh] w-full max-w-md overflow-hidden rounded-none bg-white shadow-2xl transition-all duration-200 sm:max-h-[90vh] sm:rounded-xl">
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-3 sm:px-5">
                            <h3 className="flex min-w-0 items-center gap-2 truncate text-[15px] font-bold">
                                <span className="material-symbols-outlined text-[20px] text-teal-600">swap_horiz</span>
                                Chuyển quỹ nội bộ
                            </h3>
                            <button onClick={closeFundModal} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Đóng
                            </button>
                        </div>
                        <form onSubmit={handleTransfer}>
                            <div className="max-h-[calc(100dvh-132px)] space-y-4 overflow-y-auto p-4 custom-scrollbar sm:max-h-none sm:p-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Từ tài khoản</label>
                                        <select className="w-full text-[13px] border rounded px-3 py-2" required value={transferData.from_account_id} onChange={e => setTransferData({...transferData, from_account_id: e.target.value})}>
                                            <option value="">-- Chọn nguồn --</option>
                                            {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Đến tài khoản</label>
                                        <select className="w-full text-[13px] border rounded px-3 py-2" required value={transferData.to_account_id} onChange={e => setTransferData({...transferData, to_account_id: e.target.value})}>
                                            <option value="">-- Chọn đích --</option>
                                            {accounts.filter(a => a.id != transferData.from_account_id).map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Số tiền chuyển (đ)</label>
                                    <input
                                        type="text"
                                        className="w-full text-[16px] font-bold border rounded px-3 py-2 text-blue-700"
                                        placeholder="0"
                                        required
                                        value={transferData.amount ? transferData.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                        onChange={(e) => setTransferData({...transferData, amount: e.target.value.replace(/\D/g, '')})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Thời gian</label>
                                    <input type="datetime-local" className="w-full text-[13px] border rounded px-3 py-2" required value={transferData.transaction_date} onChange={e => setTransferData({...transferData, transaction_date: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-[12px] font-bold text-gray-500 uppercase mb-1">Ghi chú diễn giải</label>
                                    <textarea className="w-full text-[13px] border rounded px-3 py-2" rows="2" placeholder="Nội dung chuyển tiền..." value={transferData.notes} onChange={e => setTransferData({...transferData, notes: e.target.value})}></textarea>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t bg-gray-50 p-4">
                                <button
                                    type="button"
                                    onClick={closeFundModal}
                                    className="inline-flex h-10 items-center justify-center rounded border border-gray-200 bg-white px-4 text-[13px] font-bold text-gray-700 hover:bg-gray-100"
                                >
                                    Đóng
                                </button>
                                <button
                                    type="submit"
                                    disabled={transferring}
                                    className="bg-teal-600 text-white px-6 py-2 rounded text-[13px] font-bold hover:bg-teal-700 disabled:opacity-50 transition-all flex items-center gap-2"
                                >
                                    {transferring ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <span className="material-symbols-outlined text-[18px]">send</span>}
                                    Xác nhận chuyển quỹ
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
