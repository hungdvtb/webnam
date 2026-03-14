import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blogApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const BlogList = () => {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { showModal } = useUI();
    const navigate = useNavigate();

    useEffect(() => {
        fetchPosts();
    }, []);

    const fetchPosts = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getAll({ search: searchTerm });
            setPosts(response.data.data);
        } catch (error) {
            console.error("Error fetching admin posts", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = (id) => {
        showModal({
            title: 'Xác nhận xóa',
            content: 'Bạn có chắc chắn muốn xóa bài viết này không? Hành động này không thể hoàn tác.',
            type: 'warning',
            actionText: 'Xóa bài viết',
            onAction: async () => {
                try {
                    await blogApi.destroy(id);
                    setPosts(posts.filter(p => p.id !== id));
                    showModal({ title: 'Thành công', content: 'Đã xóa bài viết.', type: 'success' });
                } catch (error) {
                    showModal({ title: 'Lỗi', content: 'Không thể xóa bài viết.', type: 'error' });
                }
            }
        });
    };

    const toggleStatus = async (post) => {
        try {
            const newStatus = !post.is_published;
            await blogApi.update(post.id, { is_published: newStatus });
            setPosts(posts.map(p => p.id === post.id ? { ...p, is_published: newStatus } : p));
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái.', type: 'error' });
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
                        <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">Cẩm Nang & Tin Tức</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Biên tập nội dung kiến thức và di sản gốm sứ</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <Link
                            to="/admin/blog/new"
                            className="bg-brick text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Soạn thảo bài viết mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">edit_note</span>
                        </Link>
                        <button
                            onClick={fetchPosts}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>

                    {/* Search Bar */}
                    <div className="flex-1 max-w-md relative ml-4">
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gold text-[16px]">search</span>
                        <input
                            type="text"
                            placeholder="Tìm kiếm tiêu đề hoặc nội dung..."
                            className="w-full bg-stone/5 border border-gold/10 px-8 py-1.5 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchPosts()}
                        />
                    </div>

                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em] ml-4">
                        {posts.length} bài viết hiện có
                    </div>
                </div>
            </div>

            {/* Content Area - Blog Table */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[12%]">Tư liệu</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[40%]">Thông tin bài viết</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[18%]">Phát hành</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-center">Trạng thái</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-right text-gold/60">Quản trị</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                                </td>
                            </tr>
                        ) : posts.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center text-stone/40 font-bold uppercase tracking-widest italic text-xs">Không tìm thấy bài viết nào trong kho dữ liệu</td>
                            </tr>
                        ) : (
                            posts.map(post => (
                                <tr key={post.id} className="hover:bg-gold/5 transition-all group active:bg-gold/10">
                                    <td className="px-4 py-3.5">
                                        <div className="relative aspect-square bg-stone/10 border border-gold/20 rounded-sm overflow-hidden group/img shadow-premium-sm">
                                            <img
                                                src={post.featured_image || 'https://placehold.co/200'}
                                                alt={post.title}
                                                className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-700"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity"></div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="flex flex-col max-w-full">
                                            <span 
                                                onClick={() => navigate(`/admin/blog/edit/${post.id}`)}
                                                className="font-bold text-[15px] text-primary truncate leading-tight group-hover:text-brick transition-colors uppercase tracking-tight cursor-pointer"
                                            >
                                                {post.title}
                                            </span>
                                            <span className="text-[10px] text-stone/40 font-ui uppercase tracking-widest mt-1 truncate italic">
                                                Slug: {post.slug}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="flex flex-col">
                                            <span className="text-[12px] font-bold text-stone-600">
                                                {new Date(post.published_at || post.created_at).toLocaleDateString('vi-VN')}
                                            </span>
                                            <span className="text-[9px] text-stone/40 font-black uppercase tracking-tight">Kể chuyện gốm</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <button
                                            onClick={() => toggleStatus(post)}
                                            className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest border rounded-[2px] transition-all active:scale-95 ${post.is_published ? 'bg-primary text-white border-primary shadow-sm' : 'bg-stone/5 text-stone/40 border-gold/20'}`}
                                        >
                                            {post.is_published ? 'Hiển thị' : 'Bản nháp'}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <button 
                                                onClick={() => navigate(`/admin/blog/edit/${post.id}`)}
                                                className="size-9 flex items-center justify-center text-stone/30 hover:text-primary hover:bg-primary/5 rounded-sm transition-all active:scale-90 border border-transparent hover:border-primary/20" 
                                                title="Sửa bài viết"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">edit_square</span>
                                            </button>
                                            <button 
                                                onClick={() => handleDelete(post.id)} 
                                                className="size-9 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-sm transition-all active:scale-90 border border-transparent hover:border-brick/20" 
                                                title="Gỡ bài viết"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete_forever</span>
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

export default BlogList;
