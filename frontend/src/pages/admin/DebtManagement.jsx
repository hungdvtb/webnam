import React, { useState, useEffect, useCallback, useRef } from 'react';
import { financeApi } from '../../services/api';

const formatCurrency = (val) => {
    return Math.round(Number(val) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + 'đ';
};

const getCurrentDateTime = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatDateString = (dateStr) => {
    if (!dateStr) return '';
    try {
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

export default function DebtManagement() {
    const [loading, setLoading] = useState(true);
    const [subjects, setSubjects] = useState([]);
    const [summary, setSummary] = useState({ total_debt: 0, total_monthly_interest: 0 });
    const [activeSubjectId, setActiveSubjectId] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [fundAccounts, setFundAccounts] = useState([]);

    // Subjects Modal
    const [subjectModalOpen, setSubjectModalOpen] = useState(false);
    const [editingSubject, setEditingSubject] = useState({ id: null, name: '', interest_rate_percent: 0, initial_debt: 0 });

    // Stats Modal
    const [statsModalOpen, setStatsModalOpen] = useState(false);

    // Quick Transaction Input
    const [newTx, setNewTx] = useState({
        id: null,
        transaction_date: getCurrentDateTime(),
        type: 'borrow', // borrow, pay_principal, pay_interest
        amount: '',
        note: '',
        fin_account_id: ''
    });
    const [saving, setSaving] = useState(false);

    const loadSubjects = useCallback(async () => {
        try {
            const res = await financeApi.getDebtSubjects();
            if (res.data.status === 'success') {
                setSubjects(res.data.data);
                setSummary(res.data.summary);
                if (!activeSubjectId && res.data.data.length > 0) {
                    setActiveSubjectId(res.data.data[0].id);
                }
            }
        } catch (error) {
            console.error('Lỗi tải danh sách chủ nợ', error);
        }
    }, [activeSubjectId]);

    const loadTransactions = useCallback(async () => {
        if (!activeSubjectId) return;
        setLoading(true);
        try {
            const res = await financeApi.getDebtTransactions(activeSubjectId);
            if (res.data.status === 'success') {
                setTransactions(res.data.data);
            }
        } catch (error) {
            console.error('Lỗi tải lịch sử giao dịch nợ', error);
        } finally {
            setLoading(false);
        }
    }, [activeSubjectId]);

    const loadFundAccounts = async () => {
        try {
            const res = await financeApi.getFundAccounts();
            if (res.data.status === 'success') {
                setFundAccounts(res.data.data);
            }
        } catch (e) {}
    };

    useEffect(() => {
        loadSubjects();
        loadFundAccounts();
    }, [loadSubjects]);

    useEffect(() => {
        loadTransactions();
    }, [loadTransactions]);

    const handleSaveSubject = async () => {
        if (!editingSubject.name) return alert('Vui lòng nhập tên chủ nợ');
        try {
            await financeApi.saveDebtSubject(editingSubject);
            setSubjectModalOpen(false);
            setEditingSubject({ id: null, name: '', interest_rate_percent: 0, initial_debt: 0 });
            loadSubjects();
        } catch (e) {
            alert('Lỗi khi lưu thông tin chủ nợ');
        }
    };

    const handleDeleteSubject = async (id) => {
        if (!window.confirm('Xóa chủ nợ này sẽ xóa toàn bộ lịch sử vay trả liên quan. Tiếp tục?')) return;
        try {
            await financeApi.deleteDebtSubject(id);
            if (activeSubjectId === id) setActiveSubjectId(null);
            loadSubjects();
        } catch (e) {
            alert('Lỗi khi xóa chủ nợ');
        }
    };

    const handleSaveTransaction = async () => {
        if (!activeSubjectId) return;
        if (!newTx.amount) return alert('Vui lòng nhập số tiền');
        if (!newTx.fin_account_id) return alert('Vui lòng chọn tài khoản (Tiền mặt/Ngân hàng) để đồng bộ dòng tiền');
        setSaving(true);
        try {
            const payload = {
                ...newTx,
                debt_subject_id: activeSubjectId,
                transaction_date: newTx.transaction_date.replace('T', ' ') + ':00'
            };
            const res = await financeApi.saveDebtTransaction(payload);
            if (res.data.status === 'success') {
                setNewTx({
                    id: null,
                    transaction_date: getCurrentDateTime(),
                    type: 'borrow',
                    amount: '',
                    note: '',
                    fin_account_id: ''
                });
                loadTransactions();
                loadSubjects(); // Update summary
            }
        } catch (e) {
            alert(e.response?.data?.message || 'Lỗi khi lưu giao dịch');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteTransaction = async (id) => {
        if (!window.confirm('Xóa giao dịch này?')) return;
        try {
            await financeApi.deleteDebtTransaction(id);
            loadTransactions();
            loadSubjects();
        } catch (e) {
            alert('Lỗi khi xóa giao dịch');
        }
    };

    const activeSubject = subjects.find(s => s.id === activeSubjectId);

    return (
        <div className="p-4 md:p-6 bg-[#f8f9fa] min-h-screen font-sans">
            {/* Header */}
            <div className="mb-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="size-10 bg-red-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-red-200">
                        <span className="material-symbols-outlined">account_balance_wallet</span>
                    </div>
                    <h1 className="text-[15px] font-bold text-gray-800 uppercase tracking-tight">Sổ quản lý vay nợ</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setStatsModalOpen(true)}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg border border-gray-200 shadow-sm flex items-center gap-2 transition-all text-[13px] font-bold"
                    >
                        <span className="material-symbols-outlined text-[18px]">analytics</span>
                        Thống kê tổng hợp
                    </button>
                    <button
                        onClick={() => {
                            setEditingSubject({ id: null, name: '', interest_rate_percent: 0, initial_debt: 0 });
                            setSubjectModalOpen(true);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg shadow-md shadow-red-100 flex items-center gap-2 transition-all text-[13px] font-bold"
                    >
                        <span className="material-symbols-outlined text-[18px]">person_add</span>
                        Thêm chủ nợ
                    </button>
                </div>
            </div>

            {/* Top Row: Summary + Creditors */}
            <div className="flex flex-col lg:flex-row gap-4 mb-6 items-stretch">
                {/* Global Stats Group */}
                <div className="flex gap-4 shrink-0">
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm w-[220px]">
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tổng dư nợ hiện tại</p>
                        <h3 className="text-[16px] font-bold text-red-600 truncate">{formatCurrency(summary.total_debt)}</h3>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm w-[220px]">
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tiền lãi trả hàng tháng</p>
                        <h3 className="text-[16px] font-bold text-orange-500 truncate">{formatCurrency(summary.total_monthly_interest)}</h3>
                    </div>
                </div>

                {/* Vertical Divider (Desktop Only) */}
                <div className="hidden lg:block w-px bg-gray-200 my-2 shadow-sm"></div>

                {/* Creditor Cards Scrollable Area */}
                <div className="flex-1 min-w-0 flex items-start">
                    <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar w-full">
                        {subjects.map(sub => (
                            <div
                                key={sub.id}
                                onClick={() => setActiveSubjectId(sub.id)}
                                className={`min-w-[200px] flex-shrink-0 p-3 rounded-xl cursor-pointer transition-all border-2 relative group ${
                                    activeSubjectId === sub.id
                                    ? 'bg-white border-red-500 shadow-md shadow-red-50'
                                    : 'bg-white border-transparent shadow-sm hover:border-gray-200'
                                }`}
                            >
                                <div className="flex justify-between items-start mb-1.5">
                                    <h4 className="text-[14px] font-bold text-gray-800 truncate pr-6">{sub.name}</h4>
                                    <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setEditingSubject(sub); setSubjectModalOpen(true); }}
                                            className="size-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-blue-500"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">edit</span>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteSubject(sub.id); }}
                                            className="size-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">delete</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-0.5">
                                    <div className="flex justify-between text-[12px]">
                                        <span className="text-gray-400">Dư nợ:</span>
                                        <span className="font-bold text-gray-700">{formatCurrency(sub.remaining_debt)}</span>
                                    </div>
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-gray-400">Lãi:</span>
                                        <span className="font-medium text-orange-500">{sub.interest_rate_percent}% | {formatCurrency(sub.monthly_interest)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {subjects.length === 0 && (
                            <div className="text-[13px] text-gray-400 italic py-4">Bấm "Thêm chủ nợ" để quản lý các nguồn vay.</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Transactions Section */}
            {activeSubject && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative flex flex-col max-h-[70vh]">
                    <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[15px] font-bold text-gray-700">Chi tiết lịch sử:</span>
                            <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[13px] font-bold">{activeSubject.name}</span>
                        </div>
                        <div className="text-[13px] text-gray-500">
                            Số dư ban đầu: <span className="font-bold text-gray-700">{formatCurrency(activeSubject.initial_debt)}</span>
                        </div>
                    </div>

                    <div className="overflow-auto custom-scrollbar flex-1 relative">
                        <table className="w-full text-left border-separate border-spacing-0 min-w-[1000px]">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-gray-100 shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)]">
                                    <th className="py-3 px-4 text-[13px] font-bold text-gray-600 border-b border-r border-gray-200 w-44">Thời gian</th>
                                    <th className="py-3 px-4 text-[13px] font-bold text-gray-600 border-b border-r border-gray-200 w-52">Loại giao dịch</th>
                                    <th className="py-3 px-4 text-[13px] font-bold text-gray-600 border-b border-r border-gray-200">Diễn giải</th>
                                    <th className="py-3 px-4 text-[13px] font-bold text-orange-700 border-b border-r border-gray-200 w-36 text-right">Vay Thêm</th>
                                    <th className="py-3 px-4 text-[13px] font-bold text-blue-700 border-b border-r border-gray-200 w-36 text-right">Trả Gốc</th>
                                    <th className="py-3 px-4 text-[13px] font-bold text-green-700 border-b border-r border-gray-200 w-36 text-right">Trả Lãi</th>
                                    <th className="py-3 px-4 text-[13px] font-bold text-gray-800 border-b w-40 text-right bg-gray-200/50">Dư Nợ Còn Lại</th>
                                    <th className="py-3 px-2 text-[13px] font-bold text-gray-600 border-b w-16 text-center">Xóa</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {/* Input Row (Always at Top of list content) */}
                                <tr className="bg-yellow-50/40 sticky top-[42px] z-[5] shadow-sm">
                                    <td className="p-1 px-2 border-r border-gray-200">
                                        <input
                                            type="datetime-local"
                                            className="w-full bg-transparent border-0 focus:ring-0 text-[13px] p-2"
                                            value={newTx.transaction_date}
                                            onChange={e => setNewTx({...newTx, transaction_date: e.target.value})}
                                        />
                                    </td>
                                    <td className="p-1 px-2 border-r border-gray-200 flex flex-col gap-0.5">
                                        <select
                                            className="w-full bg-transparent border-0 focus:ring-0 text-[13px] font-bold p-1 pr-4"
                                            value={newTx.type}
                                            onChange={e => setNewTx({...newTx, type: e.target.value})}
                                        >
                                            <option value="borrow">Vay thêm (+)</option>
                                            <option value="pay_principal">Trả nợ gốc (-)</option>
                                            <option value="pay_interest">Trả tiền lãi (0)</option>
                                        </select>
                                        <select
                                            className={`w-full bg-transparent border-b border-dashed focus:ring-0 text-[11px] p-0 pr-4 italic font-medium ${!newTx.fin_account_id ? 'border-red-300 text-red-400' : 'border-gray-200 text-gray-500'}`}
                                            value={newTx.fin_account_id}
                                            onChange={e => setNewTx({...newTx, fin_account_id: e.target.value})}
                                        >
                                            <option value="">-- BẮT BUỘC CHỌN TÀI KHOẢN --</option>
                                            {fundAccounts.map(acc => <option key={acc.id} value={acc.id}>Thu/Chi vào: {acc.name}</option>)}
                                        </select>
                                    </td>
                                    <td className="p-1 px-2 border-r border-gray-200">
                                        <input
                                            type="text"
                                            placeholder="Ghi chú nội dung (Enter để lưu)..."
                                            className="w-full bg-transparent border-0 focus:ring-0 text-[13px] p-2 placeholder:font-normal placeholder:italic"
                                            value={newTx.note}
                                            onChange={e => setNewTx({...newTx, note: e.target.value})}
                                            onKeyDown={e => e.key === 'Enter' && handleSaveTransaction()}
                                        />
                                    </td>
                                    <td className="p-1 px-2 border-r border-gray-200 bg-orange-50/30">
                                        {newTx.type === 'borrow' && (
                                            <input
                                                type="text"
                                                className="w-full bg-transparent border-0 focus:ring-0 text-[14px] font-bold text-right p-2 text-orange-700"
                                                placeholder="SỐ TIỀN..."
                                                value={newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                                onChange={e => setNewTx({...newTx, amount: e.target.value.replace(/\D/g, '')})}
                                                onKeyDown={e => e.key === 'Enter' && handleSaveTransaction()}
                                            />
                                        )}
                                    </td>
                                    <td className="p-1 px-2 border-r border-gray-200 bg-blue-50/30">
                                        {newTx.type === 'pay_principal' && (
                                            <input
                                                type="text"
                                                className="w-full bg-transparent border-0 focus:ring-0 text-[14px] font-bold text-right p-2 text-blue-700"
                                                placeholder="SỐ TIỀN..."
                                                value={newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                                onChange={e => setNewTx({...newTx, amount: e.target.value.replace(/\D/g, '')})}
                                                onKeyDown={e => e.key === 'Enter' && handleSaveTransaction()}
                                            />
                                        )}
                                    </td>
                                    <td className="p-1 px-2 border-r border-gray-200 bg-green-50/30">
                                        {newTx.type === 'pay_interest' && (
                                            <input
                                                type="text"
                                                className="w-full bg-transparent border-0 focus:ring-0 text-[14px] font-bold text-right p-2 text-green-700"
                                                placeholder="SỐ TIỀN..."
                                                value={newTx.amount ? newTx.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                                                onChange={e => setNewTx({...newTx, amount: e.target.value.replace(/\D/g, '')})}
                                                onKeyDown={e => e.key === 'Enter' && handleSaveTransaction()}
                                            />
                                        )}
                                    </td>
                                    <td className="p-1 px-4 text-right bg-gray-100/30 text-[12px] text-gray-400 italic font-medium">Auto...</td>
                                    <td className="p-1 text-center bg-gray-100/20">
                                        <button
                                            onClick={handleSaveTransaction}
                                            disabled={saving || !newTx.amount}
                                            className="size-8 rounded-lg bg-red-600 text-white flex items-center justify-center hover:bg-red-700 disabled:opacity-30 transition-all mx-auto shadow-sm"
                                        >
                                            {saving ? <div className="animate-spin size-4 border-2 border-white border-t-transparent rounded-full"></div> : <span className="material-symbols-outlined text-[18px]">add</span>}
                                        </button>
                                    </td>
                                </tr>

                                {transactions.length === 0 ? (
                                    <tr><td colSpan="8" className="py-20 text-center text-gray-400 text-[13px] tracking-wide italic leading-relaxed">Chưa có giao dịch nào với {activeSubject.name}.<br/>Vui lòng nhập khoản vay hoặc trả ở dòng vàng phía trên.</td></tr>
                                ) : (
                                    transactions.map(tx => (
                                        <tr key={tx.id} className="hover:bg-gray-50 transition-colors group">
                                            <td className="py-3 px-4 text-[13px] text-gray-500 border-r border-gray-50">{formatDateString(tx.transaction_date)}</td>
                                            <td className="py-3 px-4 text-[13px] border-r border-gray-50">
                                                {tx.type === 'borrow' && <span className="text-orange-600 font-bold bg-orange-50 px-2 py-0.5 rounded-[4px] border border-orange-100 uppercase text-[10px] tracking-wider">Vay mới</span>}
                                                {tx.type === 'pay_principal' && <span className="text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-[4px] border border-blue-100 uppercase text-[10px] tracking-wider">Trả nợ gốc</span>}
                                                {tx.type === 'pay_interest' && <span className="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-[4px] border border-green-100 uppercase text-[10px] tracking-wider">Trả tiền lãi</span>}
                                                {tx.fin_transaction_id && <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-1 font-medium"><span className="material-symbols-outlined text-[12px]">sync_alt</span> Đã tạo phiếu quỹ</div>}
                                            </td>
                                            <td className="py-3 px-4 text-[13px] text-gray-700 font-medium border-r border-gray-50">{tx.note}</td>
                                            <td className="py-3 px-4 text-[14px] font-bold text-right border-r border-gray-50 text-orange-600">
                                                {tx.type === 'borrow' ? formatCurrency(tx.amount) : '-'}
                                            </td>
                                            <td className="py-3 px-4 text-[14px] font-bold text-right border-r border-gray-50 text-blue-600">
                                                {tx.type === 'pay_principal' ? formatCurrency(tx.amount) : '-'}
                                            </td>
                                            <td className="py-3 px-4 text-[14px] font-bold text-right border-r border-gray-50 text-green-600">
                                                {tx.type === 'pay_interest' ? formatCurrency(tx.amount) : '-'}
                                            </td>
                                            <td className="py-3 px-4 text-[14px] font-bold text-right bg-gray-50/40 text-gray-900 font-numeric">
                                                {formatCurrency(tx.running_balance)}
                                            </td>
                                            <td className="py-3 px-1 text-center">
                                                <button
                                                    onClick={() => handleDeleteTransaction(tx.id)}
                                                    className="size-7 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all mx-auto"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Creditor Config Modal */}
            {subjectModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all translate-y-0 scale-100">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="font-bold text-[15px] text-gray-800 uppercase tracking-tight">{editingSubject.id ? 'Sửa thông tin chủ nợ' : 'Khai báo chủ nợ / nguồn vay mới'}</h3>
                            <button onClick={() => setSubjectModalOpen(false)} className="text-gray-400 hover:text-gray-900 transition-colors"><span className="material-symbols-outlined text-[20px]">close</span></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Tên Chủ Nợ / Nguồn Vay</label>
                                <input
                                    type="text"
                                    className="w-full border-gray-200 rounded-lg focus:ring-red-500 focus:border-red-500 text-[13px] py-2.5"
                                    placeholder="VD: Anh Nam, Ngân hàng ACB..."
                                    value={editingSubject.name}
                                    onChange={e => setEditingSubject({...editingSubject, name: e.target.value})}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Lãi suất (% / Tháng)</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full border-gray-200 rounded-lg focus:ring-red-500 focus:border-red-500 text-[13px] py-2.5 pr-8"
                                            value={editingSubject.interest_rate_percent}
                                            onChange={e => setEditingSubject({...editingSubject, interest_rate_percent: e.target.value})}
                                        />
                                        <span className="absolute right-3 top-2.5 text-gray-400 text-[13px]">%</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Dư nợ ban đầu (đ)</label>
                                    <input
                                        type="number"
                                        className="w-full border-gray-200 rounded-lg focus:ring-red-500 focus:border-red-500 text-[13px] py-2.5"
                                        value={editingSubject.initial_debt}
                                        onChange={e => setEditingSubject({...editingSubject, initial_debt: e.target.value})}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button onClick={() => setSubjectModalOpen(false)} className="px-4 py-2 text-[13px] font-bold text-gray-500 hover:text-gray-800 transition-colors uppercase">Hủy bỏ</button>
                            <button
                                onClick={handleSaveSubject}
                                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg text-[13px] font-bold shadow-md shadow-red-100 transition-all uppercase tracking-wide"
                            >
                                {editingSubject.id ? 'Cập nhật ngay' : 'Lưu lại'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Total Summary Statistics Modal */}
            {statsModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-orange-500">query_stats</span>
                                <h3 className="font-bold text-[15px] text-gray-800 uppercase tracking-tight">Thống kê chi tiết vay nợ</h3>
                            </div>
                            <button onClick={() => setStatsModalOpen(false)} className="text-gray-400 hover:text-gray-900"><span className="material-symbols-outlined text-[20px]">close</span></button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-2 gap-6 mb-8">
                                <div className="bg-red-50 p-5 rounded-2xl border border-red-100 text-center">
                                    <p className="text-[11px] font-bold text-red-600/70 uppercase tracking-widest mb-1.5">Tổng nợ tất cả</p>
                                    <h2 className="text-[24px] font-black text-red-700 tracking-tight">{formatCurrency(summary.total_debt)}</h2>
                                </div>
                                <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 text-center">
                                    <p className="text-[11px] font-bold text-orange-600/70 uppercase tracking-widest mb-1.5">Lãi chi trả hàng tháng</p>
                                    <h2 className="text-[24px] font-black text-orange-700 tracking-tight">{formatCurrency(summary.total_monthly_interest)}</h2>
                                </div>
                            </div>

                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50">
                                        <th className="py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">Chủ nợ</th>
                                        <th className="py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-right">Lãi suất</th>
                                        <th className="py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-right">Dư nợ hiện tại</th>
                                        <th className="py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-right">Lãi cần trả hàng tháng</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {subjects.map(sub => (
                                        <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="py-4 px-4 text-[13px] font-bold text-gray-800">{sub.name}</td>
                                            <td className="py-4 px-4 text-[13px] text-right font-medium text-gray-500">{sub.interest_rate_percent}%/tháng</td>
                                            <td className="py-4 px-4 text-[14px] text-right font-bold text-red-600 font-numeric">{formatCurrency(sub.remaining_debt)}</td>
                                            <td className="py-4 px-4 text-[14px] text-right font-bold text-orange-500 font-numeric">{formatCurrency(sub.monthly_interest)}</td>
                                        </tr>
                                    ))}
                                    <tr className="bg-gray-50/80">
                                        <td colSpan="2" className="py-5 px-4 text-[13px] font-black text-gray-900 uppercase">TỔNG CỘNG HÀNG THÁNG</td>
                                        <td className="py-5 px-4 text-[18px] text-right font-black text-red-700 border-t-2 border-red-200 font-numeric">{formatCurrency(summary.total_debt)}</td>
                                        <td className="py-5 px-4 text-[18px] text-right font-black text-orange-700 border-t-2 border-orange-200 font-numeric">{formatCurrency(summary.total_monthly_interest)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100 text-right">
                            <button onClick={() => setStatsModalOpen(false)} className="bg-[#1e293b] text-white px-8 py-2.5 rounded-xl text-[13px] font-bold hover:opacity-90 transition-all uppercase tracking-widest">Đóng bảng</button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx="true">{`
              .font-numeric { font-variant-numeric: tabular-nums; }
            `}</style>
        </div>
    );
}
