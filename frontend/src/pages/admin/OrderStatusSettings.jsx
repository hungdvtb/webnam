import React, { useState, useEffect } from 'react';
import { orderStatusApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { Reorder, motion } from 'framer-motion';

const OrderStatusSettings = () => {
    const { showModal } = useUI();
    const [statuses, setStatuses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingStatus, setEditingStatus] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        color: '#666666',
        sort_order: 0,
        is_default: false,
        is_active: true
    });

    const activeAccountId = localStorage.getItem('activeAccountId');

    const fetchStatuses = async () => {
        setLoading(true);
        try {
            const response = await orderStatusApi.getAll();
            setStatuses(response.data);
        } catch (error) {
            console.error("Error fetching statuses", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatuses();
    }, []);

    const handleEdit = (e, status) => {
        e.stopPropagation();
        setEditingStatus(status);
        setFormData({
            name: status.name,
            code: status.code,
            color: status.color,
            sort_order: status.sort_order,
            is_default: status.is_default,
            is_active: status.is_active
        });
        setShowForm(true);
    };

    const handleAddNew = () => {
        setEditingStatus(null);
        setFormData({
            name: '',
            code: '',
            color: '#666666',
            sort_order: statuses.length + 1,
            is_default: false,
            is_active: true
        });
        setShowForm(true);
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (!window.confirm("Bạn có chắc chắn muốn xóa trạng thái này? Một số đơn hàng có thể đang sử dụng nó.")) return;
        
        try {
            await orderStatusApi.destroy(id);
            showModal({ title: 'Thành công', content: 'Đã xóa trạng thái.', type: 'success' });
            fetchStatuses();
        } catch (error) {
            showModal({ title: 'Lỗi', content: error.response?.data?.message || 'Không thể xóa trạng thái.', type: 'error' });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (editingStatus) {
                await orderStatusApi.update(editingStatus.id, formData);
            } else {
                await orderStatusApi.store({ ...formData, account_id: activeAccountId });
            }
            showModal({ title: 'Thành công', content: 'Đã lưu trạng thái.', type: 'success' });
            setShowForm(false);
            fetchStatuses();
        } catch (error) {
            alert(error.response?.data?.message || "Có lỗi xảy ra");
        } finally {
            setSaving(false);
        }
    };

    const handleReorder = async (newOrder) => {
        const oldIds = statuses.map(s => s.id);
        const newIds = newOrder.map(s => s.id);
        
        // Optimistic update
        setStatuses(newOrder.map((s, idx) => ({ ...s, sort_order: idx + 1 })));

        if (JSON.stringify(oldIds) === JSON.stringify(newIds)) return;

        try {
            await orderStatusApi.reorder(newIds);
        } catch (error) {
            console.error("Error reordering statuses", error);
            // Revert if failed
            fetchStatuses();
        }
    };

    const toggleActive = async (status) => {
        try {
            await orderStatusApi.update(status.id, { ...status, is_active: !status.is_active });
            fetchStatuses();
        } catch (error) {
            console.error("Error toggling active status", error);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold"></div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-20 animate-fade-in">
            <div className="flex justify-between items-center bg-white p-6 border border-stone/10 shadow-sm">
                <div>
                    <h1 className="font-ui text-xl font-bold text-primary tracking-tight">Cấu hình trạng thái đơn hàng</h1>
                    <p className="text-stone/60 text-xs mt-1">Kéo thả để sắp xếp thứ tự hiển thị của các trạng thái.</p>
                </div>
                <button 
                    onClick={handleAddNew}
                    className="px-6 py-2.5 bg-primary text-white font-ui font-bold uppercase tracking-widest text-[12px] hover:bg-umber transition-all flex items-center gap-2 shadow-sm"
                >
                    <span className="material-symbols-outlined text-sm">add</span> Thêm mới
                </button>
            </div>

            {showForm && (
                <div className="bg-white border border-gold/20 shadow-premium p-8 animate-in fade-in slide-in-from-top-4 duration-300">
                    <h3 className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-4 mb-8">
                        {editingStatus ? 'Cập nhật trạng thái' : 'Thêm trạng thái mới'}
                    </h3>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tên hiển thị</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                                    placeholder="Ví dụ: Đang đóng gói"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Mã trạng thái (duy nhất)</label>
                                <input
                                    type="text"
                                    required
                                    disabled={!!editingStatus}
                                    value={formData.code}
                                    onChange={(e) => setFormData({...formData, code: e.target.value})}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm disabled:opacity-50"
                                    placeholder="Ví dụ: packing"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Màu sắc hiển thị</label>
                                <div className="flex gap-4 items-center">
                                    <input
                                        type="color"
                                        value={formData.color}
                                        onChange={(e) => setFormData({...formData, color: e.target.value})}
                                        className="size-12 rounded cursor-pointer border-none bg-transparent"
                                    />
                                    <input
                                        type="text"
                                        value={formData.color}
                                        onChange={(e) => setFormData({...formData, color: e.target.value})}
                                        className="flex-grow bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-mono text-sm uppercase"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Thứ tự hiển thị (tự động khi kéo thả)</label>
                                <input
                                    type="number"
                                    value={formData.sort_order}
                                    onChange={(e) => setFormData({...formData, sort_order: parseInt(e.target.value)})}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 pt-4">
                            <input
                                type="checkbox"
                                id="is_default"
                                checked={formData.is_default}
                                onChange={(e) => setFormData({...formData, is_default: e.target.checked})}
                                className="size-4 border-gold/30 text-gold focus:ring-gold"
                            />
                            <label htmlFor="is_default" className="text-sm font-sans text-stone">Đặt làm mặc định cho đơn hàng mới</label>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="is_active_form"
                                checked={formData.is_active}
                                onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                                className="size-4 border-gold/30 text-gold focus:ring-gold"
                            />
                            <label htmlFor="is_active_form" className="text-sm font-sans text-stone">Kích hoạt trạng thái (Hiển thị trong các bộ chọn)</label>
                        </div>

                        <div className="flex justify-end gap-4 pt-4 border-t border-gold/10">
                            <button
                                type="button"
                                onClick={() => setShowForm(false)}
                                className="px-8 py-3 bg-stone/10 text-stone font-ui font-bold uppercase tracking-widest text-[10px] hover:bg-stone/20 transition-all"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-12 py-3 bg-primary text-white font-ui font-bold uppercase tracking-widest text-[10px] hover:bg-umber transition-all flex items-center gap-2"
                            >
                                {saving && <span className="animate-spin size-3 border-2 border-white/30 border-t-white rounded-full"></span>}
                                {editingStatus ? 'Cập nhật' : 'Thêm mới'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="bg-white border border-stone/10 shadow-sm overflow-hidden">
                <div className="bg-stone/5 border-b border-stone/10 p-4 grid grid-cols-12 gap-4 font-bold text-blue-500 text-[14px] uppercase tracking-widest whitespace-nowrap">
                    <div className="col-span-1"></div>
                    <div className="col-span-1">Thứ tự</div>
                    <div className="col-span-5">Trạng thái</div>
                    <div className="col-span-2">Mã code</div>
                    <div className="col-span-3 text-right">Thao tác</div>
                </div>
                
                <Reorder.Group axis="y" values={statuses} onReorder={handleReorder} className="divide-y divide-stone/5">
                    {statuses.map((status) => (
                        <Reorder.Item 
                            key={status.id} 
                            value={status} 
                            className="bg-white hover:bg-stone/5 transition-colors cursor-grab active:cursor-grabbing"
                        >
                            <div className="p-4 grid grid-cols-12 gap-4 items-center">
                                <div className="col-span-1 flex justify-center text-stone/20">
                                    <span className="material-symbols-outlined">drag_indicator</span>
                                </div>
                                <div className="col-span-1 text-stone/50 font-mono text-xs">
                                    {status.sort_order}
                                </div>
                                <div className="col-span-5">
                                    <div className="flex items-center gap-3 whitespace-nowrap">
                                        <div className="size-4 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }}></div>
                                        <span className={`font-bold ${status.is_active ? 'text-primary' : 'text-stone/40 line-through'}`}>{status.name}</span>
                                        {status.is_default && (
                                            <span className="bg-gold/10 text-gold text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest flex-shrink-0">Mặc định</span>
                                        )}
                                        {status.is_system && (
                                            <span className="bg-stone/10 text-stone text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest flex-shrink-0">Hệ thống</span>
                                        )}
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <code className="bg-stone/10 px-2 py-0.5 rounded text-xs text-stone/70">{status.code}</code>
                                </div>
                                <div className="col-span-3 text-right">
                                    <div className="flex justify-end gap-1">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); toggleActive(status); }}
                                            className={`size-8 flex items-center justify-center transition-colors rounded ${status.is_active ? 'hover:bg-green-50 text-green-600' : 'hover:bg-stone-100 text-stone/40'}`}
                                            title={status.is_active ? "Đang hiện - Nhấn để ẩn" : "Đang ẩn - Nhấn để hiện"}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">
                                                {status.is_active ? 'visibility' : 'visibility_off'}
                                            </span>
                                        </button>
                                        <button 
                                            onClick={(e) => handleEdit(e, status)}
                                            className="size-8 flex items-center justify-center hover:bg-primary/10 text-primary transition-colors rounded"
                                            title="Sửa"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">edit</span>
                                        </button>
                                        {!status.is_system && (
                                            <button 
                                                onClick={(e) => handleDelete(e, status.id)}
                                                className="size-8 flex items-center justify-center hover:bg-brick/10 text-brick transition-colors rounded"
                                                title="Xóa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </Reorder.Item>
                    ))}
                </Reorder.Group>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 p-4 flex gap-3">
                <span className="material-symbols-outlined text-amber-500">info</span>
                <p className="text-xs text-amber-800 leading-relaxed font-sans">
                    <strong>Mẹo:</strong> Bạn có thể nhấn giữ vào bất kỳ trạng thái nào và kéo lên hoặc xuống để thay đổi thứ tự hiển thị của chúng trong danh sách đơn hàng và bộ lọc. Hệ thống sẽ tự động lưu lại vị trí mới.
                </p>
            </div>
        </div>
    );
};

export default OrderStatusSettings;
