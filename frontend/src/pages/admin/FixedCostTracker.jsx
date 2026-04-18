import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { financeApi } from '../../services/api';

// Helper for 'yyyy-MM'
const getCurrentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Helper for 'yyyy-MM-dd'
const getCurrentDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Helper for 'dd/MM/yyyy' from 'yyyy-MM-dd' string
const formatDateString = (dateStr) => {
    if (!dateStr) return '';
    try {
        const parts = dateStr.split(' ')[0].split('-'); // handle 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss'
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dateStr;
    } catch(e) {
        return dateStr;
    }
};

const CATEGORY_OPTIONS = [
    'Mặt bằng',
    'Nhân sự',
    'Tiện ích (Điện/Nước/Net)',
    'Phần mềm/Dịch vụ',
    'Khấu hao tài sản',
    'Khác'
];

const formatCurrency = (val) => {
    return new Intl.NumberFormat('vi-VN').format(val || 0) + 'đ';
};

export default function FixedCostTracker() {
    // States
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // YYYY-MM format for input month
    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
    const [costs, setCosts] = useState([]);
    const [snapshots, setSnapshots] = useState([]);

    // Stats
    const [totalMonthly, setTotalMonthly] = useState(0);
    const [currentDailyRate, setCurrentDailyRate] = useState(0);

    // Dialog state
    const [historyOpen, setHistoryOpen] = useState(false);
    const [applyDialogOpen, setApplyDialogOpen] = useState(false);
    const [applyDate, setApplyDate] = useState(getCurrentDate());

    const fetchCosts = useCallback(async () => {
        setLoading(true);
        try {
            const res = await financeApi.getFixedCostTracker({ month: selectedMonth });
            if (res.data?.status === 'success') {
                const data = res.data.data;
                const fetchedCosts = data.fixed_costs || [];
                // Add empty row if empty
                if (fetchedCosts.length === 0) {
                    fetchedCosts.push(createNewRow());
                }
                setCosts(fetchedCosts);
                setTotalMonthly(data.total_monthly || 0);
                setCurrentDailyRate(data.current_daily_rate || 0);
                setSnapshots(data.snapshots || []);
            }
        } catch (error) {
            alert('Lỗi tải dữ liệu chi phí cố định');
        } finally {
            setLoading(false);
        }
    }, [selectedMonth]);

    useEffect(() => {
        fetchCosts();
    }, [fetchCosts]);

    const createNewRow = () => ({
        id: null,
        uid: Math.random().toString(36).substr(2, 9), // temp id for UI
        category: '',
        name: '',
        amount: '',
        notes: ''
    });

    const handleAddRow = () => {
        setCosts([...costs, createNewRow()]);
    };

    const handleRemoveRow = (index) => {
        const newCosts = [...costs];
        newCosts.splice(index, 1);
        if (newCosts.length === 0) newCosts.push(createNewRow()); // keep at least 1 row
        setCosts(newCosts);
    };

    const handleChange = (index, field, value) => {
        const newCosts = [...costs];
        newCosts[index][field] = value;
        setCosts(newCosts);
    };

    const calculateCurrentTotal = useMemo(() => {
        return costs.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    }, [costs]);

    const handleApplyChanges = async () => {
        setSaving(true);
        try {
            // Filter valid items
            const validCosts = costs
                .filter(item => item.name && typeof item.amount !== 'undefined' && item.amount !== '')
                .map(item => ({
                    id: item.id,
                    category: item.category,
                    name: item.name,
                    amount: Number(item.amount) || 0,
                    notes: item.notes
                }));

            if (validCosts.length === 0 && costs.length > 1) {
                alert('Vui lòng nhập tên và số tiền');
                return;
            }

            const payload = {
                apply_date: applyDate, // YYYY-MM-DD
                fixed_costs: validCosts
            };

            const res = await financeApi.applyFixedCosts(payload);
            if (res.data?.status === 'success') {
                alert('Áp dụng thay đổi thành công!');
                setApplyDialogOpen(false);
                fetchCosts(); // reload
            } else {
                throw new Error(res.data?.message || 'Có lỗi xảy ra');
            }
        } catch (error) {
            alert(error.response?.data?.message || error.message || 'Lỗi khi lưu dữ liệu');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-4 md:p-6 bg-[#f8f9fa] min-h-screen font-sans">
            {/* Header & Title */}
            <div className="mb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <h1 className="text-[18px] md:text-[20px] font-semibold text-gray-800">
                    Quản lý Chi phí Cố định
                </h1>
            </div>

            {/* Top Slim Bar */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3 mb-4 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-6 flex-1">
                    <div className="flex flex-col">
                        <span className="text-[12px] text-gray-500 font-medium uppercase tracking-wider">Tổng chi phí tháng</span>
                        <span className="text-[15px] font-bold text-gray-900">{formatCurrency(totalMonthly)}</span>
                    </div>
                    <div className="w-px h-8 bg-gray-200"></div>
                    <div className="flex flex-col">
                        <span className="text-[12px] text-gray-500 font-medium uppercase tracking-wider">Mức chi phí ngày</span>
                        <span className="text-[15px] font-bold text-[#b68f54]">{formatCurrency(currentDailyRate)}<span className="text-[12px] text-gray-500 font-normal">/ngày</span></span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <input
                        type="month"
                        className="bg-white border text-[13px] border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:border-[#b68f54]"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                    />
                    <button
                        onClick={() => setHistoryOpen(true)}
                        className="flex items-center gap-1 border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 text-gray-700 text-[13px] transition-colors bg-white font-medium whitespace-nowrap"
                    >
                        <span className="material-symbols-outlined text-[16px]">history</span>
                        Lịch sử định mức
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="bg-white rounded-t-lg border-x border-t border-gray-200 p-3 flex items-center justify-between">
                <button
                    onClick={handleAddRow}
                    className="flex items-center gap-1 text-[13px] text-gray-600 hover:text-gray-900 font-medium px-2 py-1 hover:bg-gray-100 rounded transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Thêm chi phí mới
                </button>

                <div className="flex items-center gap-4">
                    <span className="text-[13px] text-gray-500">
                        Tạm tính: <strong className="text-gray-900">{formatCurrency(calculateCurrentTotal)}</strong>
                    </span>
                    <button
                        onClick={() => setApplyDialogOpen(true)}
                        className="flex items-center gap-1.5 bg-[#b68f54] hover:bg-[#a07c45] text-white text-[13px] px-4 py-1.5 rounded-sm font-medium transition-colors shadow-sm"
                    >
                        <span className="material-symbols-outlined text-[16px]">save</span>
                        Áp dụng thay đổi
                    </button>
                </div>
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-b-lg shadow-sm border border-gray-200 overflow-hidden relative">
                {loading && (
                    <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                )}
                <div className="overflow-x-auto overflow-y-auto max-h-[600px] relative">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead className="bg-[#f4f6f8] sticky top-0 z-20 shadow-sm border-b border-gray-200">
                            <tr>
                                <th className="py-2.5 px-4 text-[13px] font-semibold text-gray-700 w-1/4 border-r border-gray-200">Danh mục</th>
                                <th className="py-2.5 px-4 text-[13px] font-semibold text-gray-700 w-1/4 border-r border-gray-200">Tên chi phí</th>
                                <th className="py-2.5 px-4 text-[13px] font-semibold text-gray-700 w-1/5 border-r border-gray-200">Số tiền (VNĐ/tháng)</th>
                                <th className="py-2.5 px-4 text-[13px] font-semibold text-gray-700 border-r border-gray-200">Ghi chú</th>
                                <th className="py-2.5 px-4 text-[13px] font-semibold text-gray-700 w-12 text-center"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {costs.map((row, index) => (
                                <tr key={row.id || row.uid} className="hover:bg-gray-50 transition-colors group">
                                    <td className="p-0 border-r border-gray-100">
                                        <input
                                            type="text"
                                            list="category-options"
                                            className="w-full text-[13px] px-4 py-2.5 focus:outline-none focus:bg-primary/5 bg-transparent transition-colors"
                                            placeholder="VD: Mặt bằng"
                                            value={row.category || ''}
                                            onChange={(e) => handleChange(index, 'category', e.target.value)}
                                        />
                                        <datalist id="category-options">
                                            {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt} />)}
                                        </datalist>
                                    </td>
                                    <td className="p-0 border-r border-gray-100">
                                        <input
                                            type="text"
                                            className="w-full text-[13px] px-4 py-2.5 focus:outline-none focus:bg-primary/5 bg-transparent font-medium transition-colors"
                                            placeholder="Tên khoản chi..."
                                            value={row.name || ''}
                                            onChange={(e) => handleChange(index, 'name', e.target.value)}
                                        />
                                    </td>
                                    <td className="p-0 border-r border-gray-100">
                                        <input
                                            type="number"
                                            className="w-full text-[13px] px-4 py-2.5 focus:outline-none focus:bg-primary/5 bg-transparent transition-colors"
                                            placeholder="0"
                                            value={row.amount || ''}
                                            onChange={(e) => handleChange(index, 'amount', e.target.value)}
                                        />
                                    </td>
                                    <td className="p-0">
                                        <input
                                            type="text"
                                            className="w-full text-[13px] px-4 py-2.5 focus:outline-none focus:bg-primary/5 bg-transparent text-gray-600 transition-colors"
                                            placeholder="Ghi chú thêm..."
                                            value={row.notes || ''}
                                            onChange={(e) => handleChange(index, 'notes', e.target.value)}
                                        />
                                    </td>
                                    <td className="p-2 text-center h-full flex items-center justify-center">
                                        <button
                                            onClick={() => handleRemoveRow(index)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-1"
                                            title="Xóa dòng"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Lịch sử */}
            {historyOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col overflow-hidden max-h-[80vh]">
                        <div className="px-5 py-3 border-b flex items-center justify-between bg-gray-50">
                            <h3 className="text-[15px] font-semibold text-gray-900">Lịch sử định mức hàng ngày</h3>
                            <button onClick={() => setHistoryOpen(false)} className="text-gray-400 hover:text-gray-700 rounded-full p-1 transition-colors">
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>
                        <div className="overflow-y-auto p-0 flex-1 relative">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#f8f9fa] sticky top-0 shadow-sm border-b">
                                    <tr>
                                        <th className="py-2.5 px-5 text-[13px] font-semibold text-gray-600 w-1/2">Ngày áp dụng</th>
                                        <th className="py-2.5 px-5 text-[13px] font-semibold text-gray-600 text-right">Chi phí định mức</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshots.length === 0 ? (
                                        <tr>
                                            <td colSpan="2" className="py-8 px-4 text-center text-[13px] text-gray-500 italic">
                                                Chưa có dữ liệu snapshots trong khoảng thời gian này.
                                            </td>
                                        </tr>
                                    ) : (
                                        snapshots.map((snap) => (
                                            <tr key={snap.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                                                <td className="py-2.5 px-5 text-[13px] text-gray-700 border-r border-gray-100">
                                                    {formatDateString(snap.date)}
                                                </td>
                                                <td className="py-2.5 px-5 text-[13px] font-medium text-right text-gray-900">
                                                    {formatCurrency(snap.amount)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Apply Changes */}
            {applyDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-5 py-3 border-b bg-gray-50">
                            <h3 className="text-[15px] font-semibold text-gray-900">Xác nhận thay đổi chi phí</h3>
                        </div>
                        <div className="px-5 py-5 overflow-y-auto flex-1 text-[13px]">
                            <p className="text-gray-600 mb-5 leading-relaxed">
                                Tổng chi phí hàng tháng mới sẽ là: <strong className="text-gray-900 text-[14px]">{formatCurrency(calculateCurrentTotal)}</strong>.
                                <br/><br/>Hệ thống sẽ chia phần này cho số ngày trong tháng để áp dụng vào báo cáo lãi lỗ hàng ngày.
                            </p>

                            <div className="bg-blue-50 border border-blue-100 p-3 rounded mb-4">
                                <label className="block font-semibold text-gray-800 mb-2">
                                    Thực hiện ghi đè định mức từ ngày:
                                </label>
                                <input
                                    type="date"
                                    className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm transition-shadow"
                                    value={applyDate}
                                    onChange={(e) => setApplyDate(e.target.value)}
                                />
                            </div>

                            <p className="text-[12px] text-orange-600 bg-orange-50/50 p-2.5 border border-orange-100/50 rounded flex gap-2">
                                <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">info</span>
                                <span>Định mức mới sẽ bắt đầu áp dụng từ ngày bạn chọn. Lịch sử của những ngày trước đó sẽ không bị ảnh hưởng.</span>
                            </p>
                        </div>
                        <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-3">
                            <button
                                onClick={() => !saving && setApplyDialogOpen(false)}
                                disabled={saving}
                                className="px-4 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-100 rounded border border-gray-200 transition-colors disabled:opacity-50"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                onClick={handleApplyChanges}
                                disabled={saving}
                                className="px-4 py-1.5 text-[13px] font-medium text-white bg-[#b68f54] hover:bg-[#a07c45] rounded shadow-sm transition-colors disabled:opacity-50 flex gap-2 items-center min-w-[120px] justify-center"
                            >
                                {saving ? (
                                    <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-[2px] border-white"></div>
                                        Đang lưu...
                                    </>
                                ) : 'Xác nhận áp dụng'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
