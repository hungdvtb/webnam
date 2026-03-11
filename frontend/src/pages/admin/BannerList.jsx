import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cmsApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const BannerList = () => {
    const [banners, setBanners] = useState([]);
    const [loading, setLoading] = useState(true);
    const { showModal } = useUI();

    const fetchBanners = async () => {
        setLoading(true);
        try {
            const response = await cmsApi.banners.getAll();
            setBanners(response.data);
        } catch (error) {
            console.error("Error fetching banners", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBanners();
    }, []);

    const handleDelete = async (id) => {
        showModal({
            title: 'Xác nhận xóa',
            content: 'Bạn có chắc chắn muốn xóa banner này?',
            type: 'warning',
            actionText: 'Xóa',
            onAction: async () => {
                try {
                    await cmsApi.banners.destroy(id);
                    setBanners(banners.filter(b => b.id !== id));
                    showModal({
                        title: 'Thành công',
                        content: 'Đã xóa banner.',
                        type: 'success'
                    });
                } catch (error) {
                    showModal({
                        title: 'Lỗi',
                        content: 'Không thể xóa banner.',
                        type: 'error'
                    });
                }
            }
        });
    };
    const handleToggleActive = async (banner) => {
        try {
            const updated = { ...banner, is_active: !banner.is_active };
            await cmsApi.banners.update(banner.id, updated);
            setBanners(prev => prev.map(b => b.id === banner.id ? updated : b));
        } catch (error) {
            console.error("Error toggling banner status", error);
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
                        <h1 className="text-2xl font-display font-bold text-primary italic">Portfolio & Banners</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Quản lý nội dung trình chiếu và hình ảnh thương hiệu</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <Link
                            to="/admin/banners/new"
                            className="bg-primary text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Thêm Banner mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </Link>
                        <button
                            onClick={fetchBanners}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                        {banners.length} slide đang được cấu hình
                    </div>
                </div>
            </div>

            {/* Content Area - Banner Table */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%]">STT</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[30%]">Tác phẩm / Hình ảnh</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[35%]">Thông điệp cốt lõi</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-center">Trạng thái</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%] text-right text-gold/60">#</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                                </td>
                            </tr>
                        ) : banners.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center text-stone/40 font-bold uppercase tracking-widest italic text-xs">Chưa có banner nào trong danh mục</td>
                            </tr>
                        ) : (
                            banners.map(banner => (
                                <tr key={banner.id} className="hover:bg-gold/5 transition-all group active:bg-gold/10">
                                    <td className="px-4 py-3.5 font-ui font-black text-[14px] text-primary/40 uppercase tracking-tighter group-hover:text-primary transition-colors">
                                        #{banner.sort_order || 0}
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="relative w-full aspect-[21/9] bg-stone/10 border border-gold/20 rounded-sm overflow-hidden group/img">
                                            <img
                                                src={banner.image_url}
                                                alt={banner.title}
                                                className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-700"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity"></div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 italic">
                                        <div className="flex flex-col max-w-full">
                                            <span className="font-bold text-[14px] text-primary truncate leading-tight group-hover:text-umber transition-colors uppercase tracking-tight">
                                                {banner.title || 'Untitled Banner'}
                                            </span>
                                            <span className="text-[10px] text-stone/40 font-ui uppercase tracking-widest mt-1 truncate">
                                                {banner.subtitle || 'No subtitle provided'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <button
                                            onClick={() => handleToggleActive(banner)}
                                            className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest border rounded-[2px] transition-all active:scale-95 ${banner.is_active ? 'bg-primary text-white border-primary shadow-sm' : 'bg-stone/5 text-stone/40 border-gold/20'}`}
                                        >
                                            {banner.is_active ? 'Công khai' : 'Lưu trữ'}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Link to={`/admin/banners/edit/${banner.id}`} className="size-8 flex items-center justify-center text-stone/30 hover:text-primary hover:bg-primary/5 rounded-sm transition-all active:scale-90" title="Chỉnh sửa">
                                                <span className="material-symbols-outlined text-[18px]">edit_square</span>
                                            </Link>
                                            <button onClick={() => handleDelete(banner.id)} className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-sm transition-all active:scale-90" title="Gỡ bỏ">
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
        </div>
    );
};

export default BannerList;
