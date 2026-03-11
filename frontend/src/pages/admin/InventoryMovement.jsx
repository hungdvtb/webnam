import React, { useState, useEffect } from 'react';
import { stockApi, warehouseApi, productApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const InventoryMovement = () => {
    const [movements, setMovements] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const { showModal } = useUI();

    const [formData, setFormData] = useState({
        warehouse_id: '',
        product_id: '',
        type: 'in',
        qty: 0,
        notes: ''
    });

    useEffect(() => {
        fetchInitialData();
        fetchMovements();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && showForm) {
                setShowForm(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showForm]);

    const fetchInitialData = async () => {
        try {
            const [wRes, pRes] = await Promise.all([
                warehouseApi.getAll(),
                productApi.getAll({ per_page: 100 })
            ]);
            setWarehouses(wRes.data);
            setProducts(pRes.data.data || pRes.data);
        } catch (error) {
            console.error("Error loading operational data", error);
        }
    };

    const fetchMovements = async () => {
        setLoading(true);
        try {
            const response = await stockApi.getMovements();
            setMovements(response.data.data || response.data);
        } catch (error) {
            console.error("Error fetching movements", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await stockApi.storeMovement(formData);
            fetchMovements();
            setShowForm(false);
            setFormData({ warehouse_id: '', product_id: '', type: 'in', qty: 0, notes: '' });
        } catch (error) {
            showModal({
                title: 'Lỗi',
                content: error.response?.data?.message || 'Không thể tạo phiếu biến động. Vui lòng kiểm tra lại.',
                type: 'error'
            });
        }
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 8px;
                        height: 8px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: rgba(182, 143, 84, 0.05);
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: rgba(182, 143, 84, 0.2);
                        border-radius: 4px;
                        border: 2px solid transparent;
                        background-clip: content-box;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: rgba(182, 143, 84, 0.4);
                    }
                `}
            </style>

            {/* Header Area */}
            <div className="flex-none bg-[#fcfcfa] pb-4">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-display font-bold text-primary italic">Biến động kho</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Lịch sử nhập xuất và cân đối lượng tồn kho thực tế</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <button
                            onClick={() => setShowForm(true)}
                            className="bg-brick text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Tạo phiếu mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">swap_vert</span>
                        </button>
                        <button
                            onClick={fetchMovements}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                        {movements.length} giao dịch gần nhất
                    </div>
                </div>
            </div>

            {/* Content Area - Scrollable */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%]">Thời gian</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[25%]">Sản Phẩm</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[12%]">Kho</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%] text-center">Loại</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%] text-center">Số lượng</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%]">Ghi chú</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[13%]">Người tạo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="7" className="py-20 text-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                                </td>
                            </tr>
                        ) : movements.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="py-20 text-center text-stone/40 font-bold uppercase tracking-widest italic text-xs">Chưa có dữ liệu biến động</td>
                            </tr>
                        ) : (
                            movements.map(m => (
                                <tr key={m.id} className="hover:bg-gold/5 transition-all group active:bg-gold/10">
                                    <td className="px-4 py-3.5 text-[11px] font-ui font-black text-stone/40 tabular-nums">
                                        {new Date(m.created_at).toLocaleString('vi-VN', { 
                                            day: '2-digit', month: '2-digit', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit'
                                        })}
                                    </td>
                                    <td className="px-4 py-3.5 min-w-0">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-[14px] text-primary truncate group-hover:text-umber transition-colors leading-tight">
                                                {m.product?.name}
                                            </span>
                                            <span className="text-[10px] text-stone/40 font-ui uppercase font-black tracking-widest mt-0.5">
                                                {m.product?.sku}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-[12px] font-bold text-stone-700">{m.warehouse?.name}</td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-[2px] ${
                                            m.type === 'in' ? 'bg-green-50 text-green-700 border-green-200' :
                                            m.type === 'out' ? 'bg-red-50 text-red-700 border-red-200' :
                                            'bg-stone-50 text-primary border-gold/20'
                                        }`}>
                                            {m.type === 'in' ? 'Nhập' : m.type === 'out' ? 'Xuất' : 'K.Kê'}
                                        </span>
                                    </td>
                                    <td className={`px-4 py-3.5 text-center font-ui font-black text-[14px] tabular-nums ${m.qty < 0 ? 'text-brick' : 'text-green-700'}`}>
                                        {m.qty > 0 && m.type !== 'adjustment' ? '+' : ''}{m.qty}
                                    </td>
                                    <td className="px-4 py-3.5 text-[11px] text-stone-500 italic truncate max-w-[150px]">{m.notes || '-'}</td>
                                    <td className="px-4 py-3.5 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className="size-5 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
                                                <span className="material-symbols-outlined text-[12px] text-gold">person</span>
                                            </div>
                                            <span className="text-[11px] font-black text-primary uppercase tracking-tighter truncate">{m.user?.name}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Form Overlay */}
            {showForm && (
                <div className="fixed inset-0 z-[100] bg-stone-900/40 backdrop-blur-[2px] flex items-center justify-center p-6 animate-in fade-in duration-200">
                    <div className="bg-white border border-gold/20 shadow-premium w-full max-w-xl rounded-sm overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 bg-gold/5 border-b border-gold/10 flex justify-between items-center">
                            <h3 className="font-display font-bold text-lg text-primary uppercase italic">Khởi tạo phiếu biến động kho</h3>
                            <button onClick={() => setShowForm(false)} className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-full transition-all">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 grid grid-cols-2 gap-y-6 gap-x-8">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Kho thực hiện</label>
                                <select required value={formData.warehouse_id} onChange={e => setFormData({ ...formData, warehouse_id: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-[13px] focus:outline-none focus:border-primary font-ui rounded-sm appearance-none">
                                    <option value="">Chọn kho...</option>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Loại giao dịch</label>
                                <select required value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-[13px] focus:outline-none focus:border-primary font-ui rounded-sm appearance-none">
                                    <option value="in">Nhập kho (+)</option>
                                    <option value="out">Xuất kho (-)</option>
                                    <option value="adjustment">Kiểm kê / Cân bằng</option>
                                </select>
                            </div>
                            <div className="col-span-2 space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Sản phẩm đích</label>
                                <select required value={formData.product_id} onChange={e => setFormData({ ...formData, product_id: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-[13px] focus:outline-none focus:border-primary font-ui rounded-sm appearance-none">
                                    <option value="">Tìm sản phẩm...</option>
                                    {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Số lượng</label>
                                <input type="number" required value={formData.qty} onChange={e => setFormData({ ...formData, qty: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-[13px] focus:outline-none focus:border-primary font-ui rounded-sm" />
                            </div>
                            <div className="col-span-2 space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Ghi chú chi tiết</label>
                                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-[13px] focus:outline-none focus:border-primary font-body h-24 resize-none rounded-sm" placeholder="Nhập lý do thực hiện phiếu này..."></textarea>
                            </div>
                            <div className="col-span-2 flex justify-end gap-3 mt-4 border-t border-gold/10 pt-6">
                                <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2.5 text-[11px] font-bold uppercase tracking-widest text-stone-500 hover:bg-stone/10 border border-stone/20 rounded-sm">Hủy</button>
                                <button type="submit" className="px-8 py-2.5 bg-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-umber transition-all rounded-sm shadow-sm">Xác nhận phiếu</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InventoryMovement;
