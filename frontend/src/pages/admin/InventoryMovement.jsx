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
        <div className="space-y-8 p-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary italic">Nhập Xuất & Kiểm Kê</h1>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold mt-1">Lịch sử biến động tồn kho realtime</p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="bg-primary text-white px-8 py-3 font-ui font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-umber transition-all shadow-premium"
                >
                    <span className="material-symbols-outlined text-base">swap_vert</span>
                    Tạo phiếu biến động
                </button>
            </div>

            {showForm && (
                <div className="bg-white border border-gold/20 shadow-premium p-8 animate-slide-up">
                    <div className="flex justify-between items-center mb-6 border-b border-gold/10 pb-4">
                        <h3 className="font-display font-bold text-xl text-primary">Phiếu Nhập / Xuất / Kiểm Kê</h3>
                        <button onClick={() => setShowForm(false)} className="text-stone">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Kho thực hiện</label>
                            <select
                                required
                                value={formData.warehouse_id}
                                onChange={e => setFormData({ ...formData, warehouse_id: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-ui"
                            >
                                <option value="">Chọn kho...</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Loại giao dịch</label>
                            <select
                                required
                                value={formData.type}
                                onChange={e => setFormData({ ...formData, type: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-ui"
                            >
                                <option value="in">Nhập kho (+)</option>
                                <option value="out">Xuất kho (-)</option>
                                <option value="adjustment">Kiểm kê / Cân bằng (Set)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Sản phẩm</label>
                            <select
                                required
                                value={formData.product_id}
                                onChange={e => setFormData({ ...formData, product_id: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-ui"
                            >
                                <option value="">Chọn sản phẩm...</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Số lượng</label>
                            <input
                                type="number"
                                required
                                value={formData.qty}
                                onChange={e => setFormData({ ...formData, qty: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-ui"
                            />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Ghi chú lý do</label>
                            <textarea
                                value={formData.notes}
                                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-body h-20 resize-none"
                                placeholder="Lý do nhập hàng, sai số kiểm kê..."
                            />
                        </div>
                        <div className="col-span-2 flex justify-end gap-4 border-t border-gold/10 pt-6">
                            <button type="button" onClick={() => setShowForm(false)} className="px-8 py-3 border border-gold/30 text-stone font-ui font-bold uppercase tracking-widest text-xs">Huỷ</button>
                            <button type="submit" className="px-8 py-3 bg-primary text-white font-ui font-bold uppercase tracking-widest text-xs">Xác nhận phiếu</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="bg-white border border-gold/10 shadow-2xl">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                        <tr>
                            <th className="p-4">Thời gian</th>
                            <th className="p-4">Sản Phẩm</th>
                            <th className="p-4">Kho</th>
                            <th className="p-4">Loại</th>
                            <th className="p-4">Số lượng</th>
                            <th className="p-4">Ghi chú</th>
                            <th className="p-4">Người thực hiện</th>
                        </tr>
                    </thead>
                    <tbody className="font-body">
                        {movements.map(m => (
                            <tr key={m.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors">
                                <td className="p-4 text-xs text-stone">{new Date(m.created_at).toLocaleString('vi-VN')}</td>
                                <td className="p-4">
                                    <div className="flex flex-col">
                                        <span className="font-bold text-sm">{m.product?.name}</span>
                                        <span className="text-[10px] text-stone font-ui uppercase">{m.product?.sku}</span>
                                    </div>
                                </td>
                                <td className="p-4 text-sm font-bold">{m.warehouse?.name}</td>
                                <td className="p-4">
                                    <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border ${m.type === 'in' ? 'bg-green-50 text-green-700 border-green-200' :
                                        m.type === 'out' ? 'bg-red-50 text-red-700 border-red-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                        }`}>
                                        {m.type === 'in' ? 'Nhập' : m.type === 'out' ? 'Xuất' : 'Kiểm kê'}
                                    </span>
                                </td>
                                <td className={`p-4 font-ui font-bold ${m.qty < 0 ? 'text-brick' : 'text-green-700'}`}>
                                    {m.qty > 0 && m.type !== 'adjustment' ? '+' : ''}{m.qty}
                                </td>
                                <td className="p-4 text-xs italic text-stone max-w-xs truncate">{m.notes}</td>
                                <td className="p-4 text-xs font-bold uppercase text-primary">{m.user?.name}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InventoryMovement;
