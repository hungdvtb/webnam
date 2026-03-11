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

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && showForm) {
                resetForm();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showForm]);

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
                        <h1 className="text-2xl font-display font-bold text-primary italic">Hệ thống kho vận</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Quản lý trung tâm lưu kho và điểm điều phối hàng hóa</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <button
                            onClick={() => setShowForm(true)}
                            className="bg-primary text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Thêm kho mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">add_home</span>
                        </button>
                        <button
                            onClick={fetchWarehouses}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                        {warehouses.length} trung tâm kho vận hiện hữu
                    </div>
                </div>
            </div>

            {/* Content Area - Warehouse Table */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%]">Mã Kho</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[25%]">Tên Cơ Sở</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[20%]">Người Phụ Trách</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[25%]">Địa Chỉ</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-center">Tình Trạng</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%] text-right text-gold/60">#</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="6" className="py-20 text-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                                </td>
                            </tr>
                        ) : warehouses.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="py-20 text-center text-stone/40 font-bold uppercase tracking-widest italic text-xs">Chưa có trung tâm kho vận nào</td>
                            </tr>
                        ) : (
                            warehouses.map(wh => (
                                <tr key={wh.id} className="hover:bg-gold/5 transition-all group active:bg-gold/10">
                                    <td className="px-4 py-3.5 font-ui font-black text-[12px] text-primary/40 uppercase tracking-tighter group-hover:text-primary transition-colors">
                                        {wh.code}
                                    </td>
                                    <td className="px-4 py-3.5 italic">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-[14px] text-primary truncate group-hover:text-umber transition-colors leading-tight">{wh.name}</span>
                                            <span className="text-[10px] text-stone/30 font-ui uppercase tracking-widest mt-0.5">Physical Warehouse</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-[13px] text-primary/70">{wh.contact_name || '---'}</span>
                                            <span className="text-[10px] text-stone/40 font-ui font-medium tracking-tight mt-0.5">{wh.phone || 'No phone'}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="text-[11px] text-stone/50 font-body leading-relaxed line-clamp-2 italic" title={wh.address}>
                                            {wh.address || 'Chưa cập nhật địa chỉ'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest border rounded-[2px] ${wh.is_active ? 'bg-primary/5 text-primary border-primary/20' : 'bg-brick/5 text-brick border-brick/20'}`}>
                                            {wh.is_active ? 'Online' : 'Offline'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button onClick={() => handleEdit(wh)} className="size-8 flex items-center justify-center text-stone/30 hover:text-primary hover:bg-primary/5 rounded-sm transition-all active:scale-90" title="Cập nhật">
                                                <span className="material-symbols-outlined text-[18px]">edit_square</span>
                                            </button>
                                            <button onClick={() => handleDelete(wh.id)} className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-sm transition-all active:scale-90" title="Xóa kho">
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Form Modal Overlay */}
            {showForm && (
                <div className="fixed inset-0 z-[100] bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                    <div className="bg-[#fcfcfa] border border-gold/30 shadow-[0_20px_50px_rgba(0,0,0,0.3)] w-full max-w-3xl rounded-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                        <div className="px-8 py-5 bg-primary text-white flex justify-between items-center shrink-0">
                            <div className="flex flex-col">
                                <h3 className="font-display font-bold text-xl uppercase italic leading-none">{editingId ? 'Hiệu chỉnh thông số kho' : 'Thiết lập kho vận mới'}</h3>
                                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mt-1.5">Khai báo địa chỉ và thông tin vận hành kho</p>
                            </div>
                            <button onClick={resetForm} className="size-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="flex-1 overflow-auto custom-scrollbar p-8 space-y-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Tên trung tâm kho</label>
                                    <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: Kho Tổng Miền Bắc" />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Mã định danh (Code)</label>
                                    <input required disabled={!!editingId} value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-black text-primary/60 focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white font-ui uppercase" placeholder="VD: WH-001" />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Nhân sự phụ trách</label>
                                    <input value={formData.contact_name} onChange={e => setFormData({ ...formData, contact_name: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: Nguyễn Thành Trung" />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">HOTLINE liên hệ</label>
                                    <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white font-ui" placeholder="09xx xxx xxx" />
                                </div>

                                <div className="col-span-full space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Địa chỉ chi tiết</label>
                                    <textarea value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-4 text-[14px] font-medium text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white min-h-[100px] resize-none leading-relaxed" placeholder="Số nhà, tên đường, quận/huyện, tỉnh..." />
                                </div>

                                <div className="col-span-full py-2">
                                    <label className="flex items-center gap-3 cursor-pointer group bg-stone/5 border border-gold/20 p-3 rounded-sm hover:border-gold transition-all select-none w-fit pr-10">
                                        <div className={`size-5 border-2 rounded-sm flex items-center justify-center transition-all ${formData.is_active ? 'bg-primary border-primary' : 'bg-white border-gold/20'}`}>
                                            {formData.is_active && <span className="material-symbols-outlined text-white text-[16px] font-black">check</span>}
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            checked={formData.is_active} 
                                            onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                                            className="hidden"
                                        />
                                        <span className="font-ui text-[11px] font-black uppercase tracking-widest text-primary/60 group-hover:text-primary transition-colors">Kho đang trong tình trạng hoạt động</span>
                                    </label>
                                </div>
                            </div>
                        </form>
                        
                        <div className="px-8 py-6 bg-stone/5 border-t border-gold/20 flex justify-end gap-3 shrink-0">
                            <button type="button" onClick={resetForm} className="px-8 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone/40 hover:text-brick hover:bg-brick/5 rounded-sm transition-all">Bỏ qua</button>
                            <button onClick={handleSubmit} className="bg-primary text-white px-10 py-2.5 text-[11px] font-black uppercase tracking-widest hover:bg-umber transition-all rounded-sm shadow-premium active:scale-95">
                                {editingId ? 'Cập nhật cơ sở' : 'Khởi tạo kho vận'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WarehouseList;
