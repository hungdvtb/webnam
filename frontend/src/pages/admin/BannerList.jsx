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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-display font-bold text-primary">Quản lý Banners</h1>
                <Link
                    to="/admin/banners/new"
                    className="bg-primary text-white px-6 py-2 rounded-sm font-ui font-bold uppercase tracking-widest text-xs hover:bg-umber transition-all flex items-center gap-2"
                >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Thêm Banner
                </Link>
            </div>

            <div className="bg-white border border-gold/10 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gold/5 border-b border-gold/10">
                            <th className="p-4 font-ui text-xs font-bold uppercase tracking-widest text-primary">Thứ tự</th>
                            <th className="p-4 font-ui text-xs font-bold uppercase tracking-widest text-primary">Hình ảnh</th>
                            <th className="p-4 font-ui text-xs font-bold uppercase tracking-widest text-primary">Tiêu đề</th>
                            <th className="p-4 font-ui text-xs font-bold uppercase tracking-widest text-primary">Trạng thái</th>
                            <th className="p-4 font-ui text-xs font-bold uppercase tracking-widest text-primary text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/10">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="p-12 text-center">
                                    <div className="flex justify-center flex-col items-center gap-4">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold"></div>
                                        <span className="text-stone font-body text-sm italic">Đang tải danh sách...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : banners.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="p-12 text-center text-stone font-body italic">
                                    Chưa có banner nào.
                                </td>
                            </tr>
                        ) : (
                            banners.map((banner) => (
                                <tr key={banner.id} className="hover:bg-gold/5 transition-colors group">
                                    <td className="p-4">
                                        <span className="font-ui text-sm font-bold text-gold">#{banner.sort_order}</span>
                                    </td>
                                    <td className="p-4">
                                        <div className="w-32 h-16 bg-stone/10 border border-gold/20 overflow-hidden">
                                            <img
                                                src={banner.image_url}
                                                alt={banner.title}
                                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                            />
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-primary text-sm">{banner.title || 'Không có tiêu đề'}</span>
                                            <span className="text-[10px] text-stone uppercase tracking-tighter">{banner.subtitle || 'Không có phụ đề'}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <button
                                            onClick={() => handleToggleActive(banner)}
                                            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:scale-105 transition-transform ${banner.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                            title="Bấm để ẩn/hiện"
                                        >
                                            {banner.is_active ? 'Hiển thị' : 'Ẩn'}
                                        </button>
                                    </td>
                                    <td className="p-4 text-right space-x-2">
                                        <Link
                                            to={`/admin/banners/edit/${banner.id}`}
                                            className="inline-flex items-center justify-center size-8 text-gold hover:bg-gold hover:text-white transition-all border border-gold/30"
                                            title="Chỉnh sửa"
                                        >
                                            <span className="material-symbols-outlined text-sm">edit</span>
                                        </Link>
                                        <button
                                            onClick={() => handleDelete(banner.id)}
                                            className="inline-flex items-center justify-center size-8 text-brick hover:bg-brick hover:text-white transition-all border border-brick/30"
                                            title="Xóa"
                                        >
                                            <span className="material-symbols-outlined text-sm">delete</span>
                                        </button>
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
