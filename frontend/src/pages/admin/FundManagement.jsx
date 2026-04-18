import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { financeApi } from '../../services/api';

const formatCurrency = (val) => {
    return Math.round(Number(val) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + 'đ';
};

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
    const [loading, setLoading] = useState(true);

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

    const [accountModalOpen, setAccountModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState({ id: null, name: '', type: 'bank', initial_balance: 0 });

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
            setTransferOpen(false);
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

    const handleSaveTransaction = async (e) => {
        e?.preventDefault();
        if (!newTx.description || !newTx.amount) {
            alert('Vui lòng nhập diễn giải và số tiền');
            return;
        }

        setSaving(true);
        try {
            // Convert datetime-local value (YYYY-MM-DDTHH:mm) to Laravel format (YYYY-MM-DD HH:mm:ss)
            const payload = {
                ...newTx,
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
        // Chuyển format YYYY-MM-DD HH:mm:ss sang YYYY-MM-DDTHH:mm
        let dt = tx.transaction_date;
        if (dt.includes(' ')) {
            dt = dt.substring(0, 16).replace(' ', 'T');
        }

        setNewTx({
            id: tx.id,
            transaction_date: dt,
            description: tx.description,
            fin_account_id: tx.fin_account_id,
            fin_category_id: tx.fin_category_id || '',
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

    return (
        <div className="p-4 md:p-6 bg-[#f8f9fa] min-h-screen font-sans">
            {/* Header & Title */}
            <div className="mb-4 flex flex-col md:flex-row items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">
                        Quản lý dòng tiền
                    </h1>
                    <button onClick={() => setCategoryModalOpen(true)} className="text-[13px] text-blue-600 font-medium bg-blue-50 px-3 py-1 rounded hover:bg-blue-100 transition">
                        Quản lý hạng mục
                    </button>
                    <button onClick={() => setAccountModalOpen(true)} className="text-[13px] text-orange-600 font-medium bg-orange-50 px-3 py-1 rounded hover:bg-orange-100 transition">
                        Số dư đầu kỳ
                    </button>
                    <button onClick={() => setTransferOpen(true)} className="text-[13px] text-teal-600 font-medium bg-teal-50 px-3 py-1 rounded hover:bg-teal-100 transition flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                        Chuyển quỹ
                    </button>
                </div>
            </div>

            {/* Thẻ Thống Kê Nhanh (Slim Cards) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {/* Tổng số dư */}
                <div className="bg-white rounded-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-100 p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center size-10 rounded-full bg-blue-50 text-blue-600">
                            <span className="material-symbols-outlined">account_balance_wallet</span>
                        </div>
                        <div>
                            <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Tổng số dư</p>
                            <h3 className="text-[16px] font-bold text-gray-900">{formatCurrency(summary.total)}</h3>
                        </div>
                    </div>
                </div>

                {/* Tiền mặt */}
                <div className="bg-white rounded-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-100 p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center size-10 rounded-full bg-green-50 text-green-600">
                            <span className="material-symbols-outlined">payments</span>
                        </div>
                        <div>
                            <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Tiền mặt</p>
                            <h3 className="text-[16px] font-bold text-gray-900">{formatCurrency(summary.cash)}</h3>
                        </div>
                    </div>
                </div>

                {/* Ngân hàng */}
                <div className="bg-white rounded-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-100 p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center size-10 rounded-full bg-purple-50 text-purple-600">
                                <span className="material-symbols-outlined">account_balance</span>
                            </div>
                            <div>
                                <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Ngân hàng</p>
                                <h3 className="text-[16px] font-bold text-gray-900">{formatCurrency(summary.bank)}</h3>
                            </div>
                        </div>
                        {/* Nút xem báo cáo biểu đồ */}
                        <button
                            onClick={() => setReportOpen(true)}
                            className="bg-gray-50 hover:bg-gray-100 text-gray-600 p-2 rounded-full transition-colors flex items-center justify-center shadow-sm border border-gray-200"
                            title="Báo cáo thu chi"
                        >
                            <span className="material-symbols-outlined text-[20px]">bar_chart</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-2 mb-4 overflow-x-auto custom-scrollbar pb-1">
                <button
                    onClick={() => setActiveTab('all')}
                    className={`whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${activeTab === 'all' ? 'bg-[#1e293b] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
                >
                    Tất cả chung
                </button>
                <button
                    onClick={() => setActiveTab('cash')}
                    className={`whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${activeTab === 'cash' ? 'bg-[#1e293b] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
                >
                    Tất cả Tiền mặt
                </button>
                <button
                    onClick={() => setActiveTab('bank')}
                    className={`whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${activeTab === 'bank' ? 'bg-[#1e293b] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
                >
                    Tất cả Ngân hàng
                </button>
                {accounts.map(acc => (
                    <button
                        key={acc.id}
                        onClick={() => setActiveTab(acc.id.toString())}
                        className={`whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${activeTab === acc.id.toString() ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'}`}
                    >
                        {acc.name}
                    </button>
                ))}

                <button
                    onClick={() => loadData()}
                    className="ml-auto bg-white border border-gray-200 hover:bg-gray-50 p-1.5 rounded-full flex items-center justify-center transition-colors shadow-sm"
                    title="Làm mới dữ liệu"
                >
                    <span className={`material-symbols-outlined text-[20px] text-gray-600 ${loading ? 'animate-spin' : ''}`}>sync</span>
                </button>

                <button
                    onClick={() => setFilterOpen(true)}
                    className="bg-white border border-gray-200 hover:bg-gray-50 p-1.5 rounded-full flex items-center justify-center transition-colors shadow-sm"
                    title="Bộ lọc nâng cao"
                >
                    <span className="material-symbols-outlined text-[20px] text-gray-600">tune</span>
                </button>

                <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3 text-[18px] text-gray-400">search</span>
                    <input
                        type="text"
                        placeholder="Tìm diễn giải, ghi chú..."
                        className="pl-9 pr-4 py-1.5 rounded-full text-[13px] border border-gray-200 focus:outline-none focus:border-blue-500 w-[200px] md:w-[250px] transition-all"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* Bảng Dòng Tiền (Spreadsheet-style) */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden relative">
                {loading && (
                    <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center backdrop-blur-[1px]">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                )}
                <div className="overflow-x-auto max-h-[650px] relative custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1020px]">
                        <thead className="bg-[#f8f9fa] sticky top-0 z-20 shadow-sm border-b border-gray-200">
                            <tr>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200 w-[160px]">Thời gian (Giờ/Ngày)</th>
                                <th className="py-3 px-3 text-[13px] font-bold text-gray-700 border-r border-gray-200 w-[130px]">Tài khoản</th>
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
                                    <div className="relative">
                                        <input
                                            type="text"
                                            list="fin-categories"
                                            className="w-full text-[13px] px-2 py-2 focus:outline-none focus:bg-white bg-transparent placeholder-gray-400"
                                            placeholder="Chọn hoặc nhập mới"
                                            value={newTx.new_category_name || (categories.find(c => c.id == newTx.fin_category_id)?.name || '')}
                                            onChange={(e) => {
                                                const matched = categories.find(c => c.name === e.target.value || c.id == e.target.value);
                                                if (matched) {
                                                    setNewTx({...newTx, fin_category_id: matched.id, new_category_name: '', type: matched.type});
                                                } else {
                                                    setNewTx({...newTx, fin_category_id: '', new_category_name: e.target.value});
                                                }
                                            }}
                                        />
                                        <datalist id="fin-categories">
                                            {categories.map(cat => <option key={cat.id} value={cat.name} />)}
                                        </datalist>
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
                                        <div className="w-8 flex border-r border-gray-200 h-full cursor-pointer opacity-40 hover:opacity-100 pr-1" title="Khoản THU" onClick={() => setNewTx({...newTx, type: 'income'})}>
                                            <input type="radio" readOnly checked={newTx.type === 'income'} className="cursor-pointer mx-auto" />
                                        </div>
                                        <input
                                            ref={incomeInputRef}
                                            type="text"
                                            className={`w-full text-[13px] px-1 py-2 focus:outline-none focus:bg-white bg-transparent text-right font-bold ${newTx.type === 'income' ? 'text-green-700' : 'text-gray-300'}`}
                                            placeholder={newTx.type === 'income' ? "Số tiền THU..." : ""}
                                            value={newTx.type === 'income' && newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                            onChange={(e) => setNewTx({...newTx, amount: e.target.value.replace(/\D/g, ''), type: 'income'})}
                                            onKeyDown={(e) => { if(e.key === 'Enter') handleSaveTransaction(e); }}
                                        />
                                    </div>
                                </td>
                                <td className="p-1 border-r border-gray-200 bg-red-50/20">
                                    <div className="flex items-center">
                                        <div className="w-8 flex border-r border-gray-200 h-full cursor-pointer opacity-40 hover:opacity-100 pr-1" title="Khoản CHI" onClick={() => setNewTx({...newTx, type: 'expense'})}>
                                            <input type="radio" readOnly checked={newTx.type === 'expense'} className="cursor-pointer mx-auto" />
                                        </div>
                                        <input
                                            ref={expenseInputRef}
                                            type="text"
                                            className={`w-full text-[13px] px-1 py-2 focus:outline-none focus:bg-white bg-transparent text-right font-bold ${newTx.type === 'expense' ? 'text-red-700' : 'text-gray-300'}`}
                                            placeholder={newTx.type === 'expense' ? "Số tiền CHI..." : ""}
                                            value={newTx.type === 'expense' && newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                            onChange={(e) => setNewTx({...newTx, amount: e.target.value.replace(/\D/g, ''), type: 'expense'})}
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

                            {/* Lịch sử giao dịch */}
                            {transactions.length === 0 ? (
                                <tr><td colSpan="8" className="py-12 text-center text-[13px] text-gray-400 font-medium tracking-wide">Chưa có giao dịch nào!</td></tr>
                            ) : (
                                transactions.map((tx) => (
                                    <tr key={tx.id} className={`hover:bg-blue-50/30 transition-colors group cursor-default ${newTx.id === tx.id ? 'bg-orange-50/20' : ''}`}>
                                        <td className="py-2.5 px-3 text-[13px] text-gray-600 border-r border-gray-100">{formatDateString(tx.transaction_date)}</td>
                                        <td className="py-2.5 px-3 text-[13px] border-r border-gray-100 flex items-center gap-2">
                                            {tx.account?.type === 'cash'
                                                ? <span className="material-symbols-outlined text-[14px] text-green-600">payments</span>
                                                : <span className="material-symbols-outlined text-[14px] text-purple-600">account_balance</span>
                                            }
                                            <span className="font-medium text-gray-700 truncate max-w-[100px]">{tx.account?.name}</span>
                                        </td>
                                        <td className="py-2.5 px-3 text-[13px] border-r border-gray-100 truncate">
                                            {tx.category ? (
                                                <span className="px-2 py-0.5 rounded-[4px] text-[12px] font-medium border"
                                                    style={{color: tx.category.color, borderColor: tx.category.color + '40', backgroundColor: tx.category.color + '10'}}
                                                >
                                                    {tx.category.name}
                                                </span>
                                            ) : <span className="text-gray-400 italic text-[12px]">Chưa PT</span>}
                                        </td>
                                        <td className="py-2.5 px-3 text-[13px] text-gray-800 border-r border-gray-100 font-medium">{tx.description}</td>

                                        <td className="py-2.5 px-3 text-[13px] font-bold text-right border-r border-gray-100 tracking-tight">
                                            {tx.type === 'income' ? <span className="text-green-600">{formatCurrency(tx.amount)}</span> : <span className="text-gray-300">-</span>}
                                        </td>
                                        <td className="py-2.5 px-3 text-[13px] font-bold text-right border-r border-gray-100 tracking-tight">
                                            {tx.type === 'expense' ? <span className="text-red-600">{formatCurrency(tx.amount)}</span> : <span className="text-gray-300">-</span>}
                                        </td>

                                        <td className="py-2.5 px-3 text-[13px] font-bold text-right text-gray-900 border-r border-gray-100 bg-blue-50/10 tracking-tight">
                                            {formatCurrency(tx.balance_after)}
                                        </td>

                                        <td className="py-2.5 px-1 text-center text-gray-400 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1">
                                            <button
                                                onClick={() => handleEditTransaction(tx)}
                                                className="hover:text-blue-600 hover:bg-blue-50 p-1 rounded transition-all"
                                                title="Sửa"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">edit</span>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTransaction(tx.id)}
                                                className="hover:text-red-500 hover:bg-red-50 p-1 rounded transition-all"
                                                title="Xóa"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Quản lý Hạng mục */}
            {categoryModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-5 py-3 border-b flex justify-between items-center bg-gray-50 shrink-0">
                            <h3 className="font-bold text-[16px]">Cấu hình Hạng mục Thu Chi</h3>
                            <button onClick={() => setCategoryModalOpen(false)} className="text-gray-500 hover:text-gray-900"><span className="material-symbols-outlined">close</span></button>
                        </div>

                        <div className="p-4 bg-white border-b shrink-0 flex gap-3 items-end">
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Tên Hạng mục</label>
                                <input type="text" className="w-full text-[13px] border rounded px-3 py-2" value={editingCategory.name} onChange={e => setEditingCategory({...editingCategory, name: e.target.value})} placeholder="Nhập tên..."/>
                            </div>
                            <div className="w-32">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Loại</label>
                                <select className="w-full text-[13px] border rounded px-3 py-2" value={editingCategory.type} onChange={e => setEditingCategory({...editingCategory, type: e.target.value})}>
                                    <option value="expense">Chi phí</option>
                                    <option value="income">Doanh thu</option>
                                </select>
                            </div>
                            <div className="w-16">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Màu sắc</label>
                                <input type="color" className="w-full h-[38px] p-0 border-0 rounded cursor-pointer" value={editingCategory.color} onChange={e => setEditingCategory({...editingCategory, color: e.target.value})} />
                            </div>
                            <button
                                className="bg-blue-600 text-white px-4 py-2 rounded text-[13px] font-medium hover:bg-blue-700 h-[38px]"
                                onClick={async () => {
                                    if(!editingCategory.name) return alert('Nhập tên');
                                    await financeApi.saveFundCategory(editingCategory);
                                    setEditingCategory({id: null, name: '', type: 'expense', color: '#f44336'});
                                    loadData();
                                }}
                            >
                                {editingCategory.id ? 'Cập nhật' : 'Thêm mới'}
                            </button>
                            {editingCategory.id && <button className="text-gray-500 text-[13px] underline px-2 hover:text-gray-800" onClick={() => setEditingCategory({id: null, name: '', type: 'expense', color: '#f44336'})}>Hủy sửa</button>}
                        </div>

                        <div className="p-5 flex-1 overflow-y-auto custom-scrollbar bg-white">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#fcfcfa]">
                                    <tr>
                                        <th className="py-2.5 px-3 border-b text-[12px] uppercase text-gray-500">Tên hạng mục</th>
                                        <th className="py-2.5 px-3 border-b text-[12px] uppercase text-gray-500 w-24">Loại</th>
                                        <th className="py-2.5 px-3 border-b border-gray-200 text-right w-20">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y text-[13px]">
                                    {categories.map((c) => (
                                        <tr key={c.id} className="hover:bg-gray-50">
                                            <td className="py-2.5 px-3 font-medium flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full" style={{backgroundColor: c.color}}></div>
                                                <span style={{color: c.color}}>{c.name}</span>
                                            </td>
                                            <td className="py-2.5 px-3">
                                                {c.type === 'income' ? <span className="text-green-600 font-bold text-[11px] bg-green-50 px-2 py-0.5 border border-green-200 rounded">THU</span> : <span className="text-red-600 font-bold text-[11px] bg-red-50 border border-red-200 px-2 py-0.5 rounded">CHI</span>}
                                            </td>
                                            <td className="py-2.5 px-3 text-right flex items-center justify-end gap-2">
                                                <button onClick={() => setEditingCategory(c)} className="text-gray-400 hover:text-blue-500"><span className="material-symbols-outlined text-[16px]">edit</span></button>
                                                <button onClick={async () => {
                                                    if(window.confirm('Xóa hạng mục này? Các giao dịch cũ sẽ bị mất phân loại.')){
                                                        await financeApi.deleteFundCategory(c.id);
                                                        loadData();
                                                    }
                                                }} className="text-gray-400 hover:text-red-500"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Quản lý Tài khoản (Số dư đầu kỳ) */}
            {accountModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-5 py-3 border-b flex justify-between items-center bg-gray-50 shrink-0">
                            <h3 className="font-bold text-[16px]">Quản lý Tài Khoản & Số dư đầu kỳ</h3>
                            <button onClick={() => setAccountModalOpen(false)} className="text-gray-500 hover:text-gray-900"><span className="material-symbols-outlined">close</span></button>
                        </div>

                        <div className="p-4 bg-white border-b shrink-0 flex gap-3 items-end">
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Tên TK (Ngân hàng, Quỹ...)</label>
                                <input type="text" className="w-full text-[13px] border rounded px-3 py-2" value={editingAccount.name} onChange={e => setEditingAccount({...editingAccount, name: e.target.value})} placeholder="E.g., ACB, VCB, Quỹ cửa hàng..."/>
                            </div>
                            <div className="w-36">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Loại</label>
                                <select className="w-full text-[13px] border rounded px-3 py-2" value={editingAccount.type} onChange={e => setEditingAccount({...editingAccount, type: e.target.value})}>
                                    <option value="bank">Ngân hàng</option>
                                    <option value="cash">Tiền mặt</option>
                                </select>
                            </div>
                            <div className="w-36 flex-shrink-0">
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Số dư đầu kỳ (đ)</label>
                                <input disabled={editingAccount.id} type="number" className="w-full text-[13px] border rounded px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400" value={editingAccount.initial_balance} onChange={e => setEditingAccount({...editingAccount, initial_balance: e.target.value})} />
                            </div>
                            <button
                                className="bg-orange-600 text-white px-4 py-2 rounded text-[13px] font-medium hover:bg-orange-700 h-[38px] flex-shrink-0"
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
                            {editingAccount.id && <button className="text-gray-500 text-[13px] underline px-2 hover:text-gray-800" onClick={() => setEditingAccount({id: null, name: '', type: 'bank', initial_balance: 0})}>Hủy</button>}
                        </div>

                        <div className="p-5 flex-1 overflow-y-auto custom-scrollbar bg-white">
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
                            <div className="flex items-center gap-3">
                                <div className="size-10 flex items-center justify-center rounded-full bg-blue-50 text-blue-600">
                                    <span className="material-symbols-outlined">donut_small</span>
                                </div>
                                <h3 className="text-[18px] font-bold text-gray-900 tracking-tight">Bảng Thống kê Thu - Chi</h3>
                            </div>
                            <button onClick={() => setReportOpen(false)} className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full p-2 transition-colors">
                                <span className="material-symbols-outlined text-[20px]">close</span>
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
                                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                        <div className="px-4 py-3 border-b border-gray-100 bg-[#f8f9fa]">
                                            <h4 className="text-[14px] font-bold text-gray-800">Chi tiết theo hạng mục</h4>
                                        </div>
                                        <table className="w-full text-left">
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
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Modal Tìm kiếm/Lọc nâng cao */}
            {filterOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden transition-all duration-200">
                        <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="font-bold text-[15px] flex items-center gap-2">
                                <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                                Bộ lọc nâng cao
                            </h3>
                            <button onClick={() => setFilterOpen(false)} className="text-gray-400 hover:text-gray-900"><span className="material-symbols-outlined">close</span></button>
                        </div>
                        <div className="p-5 grid grid-cols-2 gap-4">
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
                        <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
                            <button
                                className="text-[13px] text-gray-600 hover:text-gray-900 underline"
                                onClick={() => setAdvFilter({account_id: '', category_id: '', start_date: '', end_date: '', tx_type: ''})}
                            >
                                Xóa bộ lọc
                            </button>
                            <button
                                className="bg-[#1e293b] text-white px-5 py-2 rounded text-[13px] font-medium hover:opacity-90 transition-opacity"
                                onClick={() => setFilterOpen(false)}
                            >
                                Áp dụng
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Chuyển quỹ */}
            {transferOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden transition-all duration-200">
                        <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="font-bold text-[15px] flex items-center gap-2">
                                <span className="material-symbols-outlined text-[20px] text-teal-600">swap_horiz</span>
                                Chuyển quỹ nội bộ
                            </h3>
                            <button onClick={() => setTransferOpen(false)} className="text-gray-400 hover:text-gray-900"><span className="material-symbols-outlined">close</span></button>
                        </div>
                        <form onSubmit={handleTransfer}>
                            <div className="p-5 space-y-4">
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
                            <div className="p-4 bg-gray-50 border-t flex justify-end">
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
