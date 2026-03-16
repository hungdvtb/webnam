import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { blogApi, aiApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

const BlogForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal } = useUI();
    const [loading, setLoading] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        excerpt: '',
        content: '',
        featured_image: '',
        is_published: false,
        published_at: ''
    });

    const editorRef = useRef(null);

    useEffect(() => {
        if (isEdit) {
            fetchPost();
        }
    }, [id]);

    const fetchPost = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getOne(id);
            const data = response.data;
            setFormData({
                title: data.title || '',
                excerpt: data.excerpt || '',
                content: data.content || '',
                featured_image: data.featured_image || '',
                is_published: data.is_published || false,
                published_at: data.published_at ? new Date(data.published_at).toISOString().split('T')[0] : ''
            });
        } catch (error) {
            console.error("Error fetching post", error);
            showModal({ title: 'Lỗi', content: 'Không thể tải thông tin bài viết.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isEdit) {
                await blogApi.update(id, formData);
                showModal({ title: 'Thành công', content: 'Đã cập nhật bài viết.', type: 'success' });
            } else {
                await blogApi.store(formData);
                showModal({ title: 'Thành công', content: 'Đã tạo bài viết mới.', type: 'success' });
            }
            navigate('/admin/blog');
        } catch (error) {
            console.error("Error saving post", error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu bài viết. Vui lòng kiểm tra lại.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleAIGenerate = async () => {
        if (!formData.title) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tiêu Đề để AI có cơ sở viết nội dung.', type: 'warning' });
            return;
        }

        setAiGenerating(true);
        try {
            // Note: We'll use a generic AI chat or a dedicated endpoint if we add one.
            // For now, let's assume we can use the chat API with a specific prompt.
            const prompt = `Hãy viết một bài blog chuyên sâu, nghệ thuật và hấp dẫn về chủ đề gốm sứ Bát Tràng có tiêu đề: "${formData.title}". 
            Yêu cầu:
            1. Ngôn ngữ trang trọng, giàu tính văn hóa và nghệ thuật.
            2. Bao gồm các tiêu đề phụ (H2, H3).
            3. Định dạng bằng HTML (sử dụng các thẻ <p>, <h2>, <h3>, <ul>, <li>, <strong>).
            4. Viết khoảng 500-800 từ.
            5. Tạo thêm một đoạn tóm tắt ngắn (excerpt) cho bài viết này.
            Trả về kết quả dưới dạng JSON có cấu trúc: { "excerpt": "...", "content": "..." }`;

            const response = await aiApi.chat({ message: prompt });

            // AI responses might need parsing if it outputs raw string instead of pure JSON
            let aiData;
            try {
                const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
                aiData = JSON.parse(jsonMatch ? jsonMatch[0] : response.data.response);
            } catch (e) {
                aiData = { content: response.data.response, excerpt: response.data.response.substring(0, 150) };
            }

            setFormData(prev => ({
                ...prev,
                content: aiData.content || prev.content,
                excerpt: aiData.excerpt || prev.excerpt
            }));

            showModal({ title: 'Thành công', content: 'AI đã hoàn thành bản thảo bài viết trên web!', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi AI', content: 'Không thể kết nối AI lúc này. Vui lòng thử lại sau.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    const quillModules = {
        toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike', 'blockquote'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
            ['link', 'image', 'video'],
            ['clean']
        ],
    };

    const quillFormats = [
        'header',
        'bold', 'italic', 'underline', 'strike', 'blockquote',
        'list', 'bullet', 'indent',
        'link', 'image', 'video'
    ];

    return (
        <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in pb-20">
            <div className="flex justify-between items-end gap-6 border-b border-gold/10 pb-8">

                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/blog')}
                        className="px-8 py-3 text-[10px] font-bold uppercase tracking-widest text-stone hover:text-primary transition-colors border border-stone/20"
                    >
                        Hủy bỏ
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-primary text-white font-ui font-bold uppercase tracking-widest px-10 py-3 hover:bg-umber transition-all shadow-premium disabled:opacity-50"
                    >
                        {loading ? 'Đang lưu...' : (isEdit ? 'Cập Nhật Bài Viết' : 'Đăng Bài Viết')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                <div className="lg:col-span-8 space-y-8">
                    {/* Title input */}
                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tiêu Đề Bài Viết</label>
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            className="w-full bg-white border border-gold/20 p-5 focus:outline-none focus:border-primary font-display text-2xl text-primary shadow-sm"
                            placeholder="VD: Nghệ thuật men rạn nghìn năm tuổi..."
                        />
                    </div>

                    {/* Excerpt */}
                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tóm Tắt Ngắn (Excerpt)</label>
                        <textarea
                            name="excerpt"
                            value={formData.excerpt}
                            onChange={handleChange}
                            rows="3"
                            className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm italic text-umber shadow-sm resize-none"
                            placeholder="Đoạn dẫn nhập ngắn để thu hút độc giả..."
                        />
                    </div>

                    {/* Content Editor */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center mb-1">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Nội Dung Chi Tiết</label>
                            <button
                                type="button"
                                onClick={handleAIGenerate}
                                disabled={aiGenerating}
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all shadow-sm ${aiGenerating
                                    ? 'bg-gold/10 text-gold animate-pulse cursor-wait'
                                    : 'bg-gradient-to-r from-primary to-umber text-white hover:scale-105 active:scale-95'
                                    }`}
                            >
                                <span className={`material-symbols-outlined text-xs ${aiGenerating ? 'animate-spin' : ''}`}>
                                    {aiGenerating ? 'progress_activity' : 'auto_awesome'}
                                </span>
                                {aiGenerating ? 'Đang Biên Tập...' : 'AI Viết Content'}
                            </button>
                        </div>

                        <div className="bg-white border border-gold/20 shadow-sm quill-premium-wrapper">
                            <ReactQuill
                                theme="snow"
                                value={formData.content}
                                onChange={(content) => setFormData(prev => ({ ...prev, content }))}
                                modules={quillModules}
                                formats={quillFormats}
                                className="font-body text-lg"
                                style={{ height: '500px', marginBottom: '50px' }}
                            />
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-4 space-y-8">
                    {/* Featured Image */}
                    <div className="bg-white border border-gold/20 shadow-premium p-6 space-y-6">
                        <div className="space-y-4">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">image</span>
                                Hình Ảnh Bìa
                            </label>
                            <div className="aspect-[16/9] w-full bg-gold/5 border-2 border-dashed border-gold/20 flex flex-col items-center justify-center relative overflow-hidden group">
                                {formData.featured_image ? (
                                    <>
                                        <img src={formData.featured_image} className="w-full h-full object-cover" alt="Preview" />
                                        <div className="absolute inset-0 bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                                            <button type="button" onClick={() => setFormData({ ...formData, featured_image: '' })} className="bg-white/90 p-2 rounded-full text-brick hover:scale-110 transition-transform">
                                                <span className="material-symbols-outlined text-sm">delete</span>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center space-y-2 p-6">
                                        <span className="material-symbols-outlined text-3xl text-gold opacity-40">add_photo_alternate</span>
                                        <p className="text-[10px] text-stone font-ui uppercase tracking-widest">Chưa có ảnh đại diện</p>
                                    </div>
                                )}
                            </div>
                            <input
                                type="text"
                                name="featured_image"
                                value={formData.featured_image}
                                onChange={handleChange}
                                className="w-full bg-gold/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-xs italic"
                                placeholder="Dán link ảnh tại đây..."
                            />
                        </div>

                        <div className="h-px bg-gold/10"></div>

                        {/* Status & Date */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Trạng Thái Đăng</label>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        name="is_published"
                                        checked={formData.is_published}
                                        onChange={handleChange}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-stone/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gold"></div>
                                </label>
                            </div>

                            <div className="space-y-4">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs">schedule</span>
                                    Lịch Đăng (Tùy chọn)
                                </label>
                                <input
                                    type="date"
                                    name="published_at"
                                    value={formData.published_at}
                                    onChange={handleChange}
                                    className="w-full bg-gold/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-ui text-[10px] font-bold uppercase tracking-widest"
                                />
                                <p className="text-[9px] text-stone italic">Để trống nếu muốn đăng ngay lập tức khi kích hoạt Trạng Thái Hiển Thị.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    );
};

export default BlogForm;
