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
        <div className="space-y-8 animate-fade-in">
            <div className="flex justify-between items-end pb-8 border-b border-gold/10">
                <div className="space-y-2">
                    <h1 className="font-display text-4xl font-bold text-primary italic uppercase tracking-wider">Cẩm Nang & Tin Tức</h1>
                    <p className="font-ui text-xs font-bold uppercase tracking-widest text-gold opacity-60">Biên tập nội dung kiến thức gốm sứ</p>
                </div>
                <Link
                    to="/admin/blog/new"
                    className="bg-primary text-white font-ui font-bold uppercase tracking-widest px-8 py-3 hover:bg-umber transition-all shadow-premium h-fit flex items-center gap-2"
                >
                    <span className="material-symbols-outlined text-sm">edit_note</span>
                    Soạn Thảo Bài Mới
                </Link>
            </div>

            <div className="bg-white border border-gold/20 shadow-premium overflow-hidden">
                <div className="p-6 border-b border-gold/10 flex flex-col md:flex-row gap-4 justify-between items-center bg-gold/5">
                    <div className="relative w-full md:w-96">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-gold pointer-events-none">search</span>
                        <input
                            type="text"
                            placeholder="Tìm kiếm tiêu đề bài viết..."
                            className="w-full pl-12 pr-4 py-3 bg-white border border-gold/20 focus:outline-none focus:border-primary font-body text-sm transition-all italic text-umber shadow-inner"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchPosts()}
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gold/20 bg-gold/5">
                                <th className="px-6 py-4 font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Hình ảnh</th>
                                <th className="px-6 py-4 font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tiêu đề</th>
                                <th className="px-6 py-4 font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Ngày đăng</th>
                                <th className="px-6 py-4 font-ui text-[10px] font-bold uppercase tracking-widest text-primary text-center">Trạng thái</th>
                                <th className="px-6 py-4 font-ui text-[10px] font-bold uppercase tracking-widest text-primary text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gold/10">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold mx-auto"></div>
                                    </td>
                                </tr>
                            ) : posts.length > 0 ? (
                                posts.map(post => (
                                    <tr key={post.id} className="hover:bg-gold/5 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="size-16 relative border border-gold/20 overflow-hidden bg-stone/5 shadow-premium">
                                                <img
                                                    src={post.featured_image || 'https://via.placeholder.com/200'}
                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                    alt={post.title}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <p className="font-bold text-primary text-base line-clamp-1 group-hover:text-brick transition-colors">{post.title}</p>
                                                <p className="text-[10px] text-stone font-ui uppercase tracking-tighter italic">Slug: {post.slug}</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="font-ui text-[10px] text-stone uppercase tracking-widest">
                                                {new Date(post.published_at || post.created_at).toLocaleDateString('vi-VN')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <button
                                                onClick={() => toggleStatus(post)}
                                                className={`px-3 py-1 rounded-sm text-[8px] font-bold uppercase tracking-widest transition-all ${post.is_published
                                                        ? 'bg-brick/10 text-brick border border-brick/40'
                                                        : 'bg-stone/10 text-stone border border-stone/20'
                                                    }`}
                                            >
                                                {post.is_published ? 'Hiển thị' : 'Nháp'}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => navigate(`/admin/blog/edit/${post.id}`)}
                                                    className="p-2 text-primary hover:bg-primary/10 transition-all rounded-sm"
                                                    title="Chỉnh sửa"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">edit_square</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(post.id)}
                                                    className="p-2 text-stone hover:text-brick hover:bg-brick/10 transition-all rounded-sm"
                                                    title="Xóa bài"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center text-stone font-body italic py-40">
                                        <span className="material-symbols-outlined block text-5xl mb-4 opacity-20">auto_stories</span>
                                        Chưa có bài viết nào được tìm thấy.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default BlogList;
