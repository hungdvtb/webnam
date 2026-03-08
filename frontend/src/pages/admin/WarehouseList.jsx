import React, { useState, useEffect } from 'react';
import { warehouseApi } from '../../services/api';

const WarehouseList = () => {
    const [warehouses, setWarehouses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        contact_name: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        is_active: true
    });

    useEffect(() => {
        fetchWarehouses();
    }, []);

    const fetchWarehouses = async () => {
        setLoading(true);
        try {
            const response = await warehouseApi.getAll();
            setWarehouses(response.data);
        } catch (error) {
            console.error("Error fetching warehouses", error);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (warehouse) => {
        setEditingId(warehouse.id);
        setFormData({
            name: warehouse.name,
            code: warehouse.code,
            contact_name: warehouse.contact_name || '',
            phone: warehouse.phone || '',
            email: warehouse.email || '',
            address: warehouse.address || '',
            city: warehouse.city || '',
            is_active: warehouse.is_active
        });
        setShowForm(true);
    };

    const resetForm = () => {
        setFormData({
            name: '',
            code: '',
            contact_name: '',
            phone: '',
            email: '',
            address: '',
            city: '',
            is_active: true
        });
        setEditingId(null);
        setShowForm(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingId) {
                await warehouseApi.update(editingId, formData);
            } else {
                await warehouseApi.store(formData);
            }
            fetchWarehouses();
            resetForm();
        } catch (error) {
            alert('Lỗi: ' + (error.response?.data?.message || 'Có lỗi xảy ra'));
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Bạn có chắc chắn muốn xoá kho này?')) return;
        try {
            await warehouseApi.destroy(id);
            fetchWarehouses();
        } catch (error) {
            alert('Không thể xoá kho đang có dữ liệu vận hành.');
        }
    };

    return (
        <div className="space-y-8 p-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary italic">Quản Lý Kho Vận</h1>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold mt-1">Hệ thống phân phối & tồn kho</p>
                </div>
                {!showForm && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="bg-primary text-white px-8 py-3 font-ui font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-umber transition-all shadow-premium"
                    >
                        <span className="material-symbols-outlined text-base">add_home</span>
                        Thiết lập kho mới
                    </button>
                )}
            </div>

            {showForm && (
                <div className="bg-white border border-gold/20 shadow-premium p-8 animate-slide-up">
                    <div className="flex justify-between items-center mb-6 border-b border-gold/10 pb-4">
                        <h3 className="font-display font-bold text-xl text-primary">{editingId ? 'Cập Nhật Thông Tin Kho' : 'Thêm Kho Mới'}</h3>
                        <button onClick={resetForm} className="text-stone hover:text-brick transition-colors">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Tên Kho</label>
                            <input
                                required
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-body"
                                placeholder="VD: Kho Tổng Hà Nội"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Mã Kho (Duy nhất)</label>
                            <input
                                required
                                disabled={!!editingId}
                                value={formData.code}
                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-ui uppercase"
                                placeholder="VD: WH-HN-01"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Người Phụ Trách</label>
                            <input
                                value={formData.contact_name}
                                onChange={e => setFormData({ ...formData, contact_name: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-body"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Số Điện Thoại</label>
                            <input
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-ui"
                            />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <label className="text-[10px] font-bold text-stone uppercase tracking-widest">Địa Chỉ</label>
                            <textarea
                                value={formData.address}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-primary font-body h-24 resize-none"
                            />
                        </div>
                        <div className="flex items-center gap-4 py-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.is_active}
                                    onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                                    className="size-5 text-primary focus:ring-primary border-gold/30 rounded"
                                />
                                <span className="text-xs font-bold text-stone uppercase tracking-widest">Đang hoạt động</span>
                            </label>
                        </div>
                        <div className="col-span-2 flex justify-end gap-4 border-t border-gold/10 pt-6">
                            <button type="button" onClick={resetForm} className="px-8 py-3 border border-gold/30 text-stone font-ui font-bold uppercase tracking-widest text-xs hover:bg-gold/5 transition-colors">Huỷ</button>
                            <button type="submit" className="px-8 py-3 bg-primary text-white font-ui font-bold uppercase tracking-widest text-xs hover:bg-umber transition-all shadow-lg shadow-primary/20">Lưu Thông Tin</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="bg-white border border-gold/10 shadow-2xl">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                        <tr>
                            <th className="p-4">Mã Kho</th>
                            <th className="p-4">Tên Kho</th>
                            <th className="p-4">Liên Hệ</th>
                            <th className="p-4">Địa Chỉ</th>
                            <th className="p-4 text-center">Trạng Thái</th>
                            <th className="p-4 text-right">Thao Tác</th>
                        </tr>
                    </thead>
                    <tbody className="font-body">
                        {warehouses.map(wh => (
                            <tr key={wh.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                <td className="p-4 font-ui font-bold text-primary">{wh.code}</td>
                                <td className="p-4 font-bold">{wh.name}</td>
                                <td className="p-4">
                                    <div className="flex flex-col">
                                        <span className="text-sm">{wh.contact_name}</span>
                                        <span className="text-[10px] text-stone font-ui">{wh.phone}</span>
                                    </div>
                                </td>
                                <td className="p-4 italic text-stone text-sm">{wh.address}</td>
                                <td className="p-4 text-center">
                                    <span className={`px-3 py-1 text-[9px] font-bold uppercase tracking-widest border ${wh.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                        {wh.is_active ? 'Hoạt Động' : 'Tạm Dừng'}
                                    </span>
                                </td>
                                <td className="p-4 text-right space-x-3">
                                    <button onClick={() => handleEdit(wh)} className="text-primary hover:text-gold transition-colors">
                                        <span className="material-symbols-outlined text-xl">edit_square</span>
                                    </button>
                                    <button onClick={() => handleDelete(wh.id)} className="text-stone hover:text-brick transition-colors">
                                        <span className="material-symbols-outlined text-xl">delete</span>
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!loading && warehouses.length === 0 && (
                            <tr>
                                <td colSpan="6" className="p-12 text-center text-gold italic">Chưa có kho vận nào được thiết lập.</td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan="6" className="p-12 text-center text-primary italic">Đang tải danh sách kho...</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default WarehouseList;
