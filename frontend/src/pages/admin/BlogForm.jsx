import React, { useState, useEffect } from 'react';
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
        seo_keyword: '',
        excerpt: '',
        content: '',
        featured_image: '',
        is_published: true,
        is_starred: false,
        published_at: '',
    });

    useEffect(() => {
        if (isEdit) {
            fetchPost();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const fetchPost = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getOne(id);
            const data = response.data;

            setFormData({
                title: data.title || '',
                seo_keyword: data.seo_keyword || '',
                excerpt: data.excerpt || '',
                content: data.content || '',
                featured_image: data.featured_image || '',
                is_published: data.is_published ?? true,
                is_starred: data.is_starred || false,
                published_at: data.published_at ? new Date(data.published_at).toISOString().split('T')[0] : '',
            });
        } catch (error) {
            console.error('Error fetching post', error);
            showModal({ title: 'Loi', content: 'Khong the tai thong tin bai viet.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);

        try {
            if (isEdit) {
                await blogApi.update(id, formData);
                showModal({ title: 'Thanh cong', content: 'Da cap nhat bai viet.', type: 'success' });
            } else {
                await blogApi.store(formData);
                showModal({ title: 'Thanh cong', content: 'Da tao bai viet moi.', type: 'success' });
            }

            navigate('/admin/blog');
        } catch (error) {
            console.error('Error saving post', error);
            showModal({ title: 'Loi', content: 'Khong the luu bai viet. Vui long kiem tra lai.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleAIGenerate = async () => {
        if (!formData.title) {
            showModal({ title: 'Luu y', content: 'Vui long nhap tieu de de AI tao noi dung.', type: 'warning' });
            return;
        }

        setAiGenerating(true);

        try {
            const prompt = `Viet bai blog chuan SEO bang tieng Viet voi tieu de: "${formData.title}".\n`
                + `Yeu cau: co H2/H3, van phong trang trong, khoang 600-900 tu, tra ve JSON {"excerpt":"...","content":"..."}.`
                + `content phai la HTML hop le voi the p, h2, h3, ul, li, strong.`;

            const response = await aiApi.chat({ message: prompt });

            let aiData;
            try {
                const raw = response.data?.response || '{}';
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                aiData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
            } catch {
                const fallback = response.data?.response || '';
                aiData = {
                    excerpt: fallback.slice(0, 180),
                    content: `<p>${fallback}</p>`,
                };
            }

            setFormData((prev) => ({
                ...prev,
                excerpt: aiData.excerpt || prev.excerpt,
                content: aiData.content || prev.content,
                is_published: true,
            }));

            showModal({ title: 'Thanh cong', content: 'AI da tao ban thao bai viet.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Loi AI', content: 'Khong the ket noi AI luc nay.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    const quillModules = {
        toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike', 'blockquote'],
            [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
            ['link', 'image', 'video'],
            ['clean'],
        ],
    };

    const quillFormats = [
        'header',
        'bold', 'italic', 'underline', 'strike', 'blockquote',
        'list', 'bullet', 'indent',
        'link', 'image', 'video',
    ];

    return (
        <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in pb-20">
            <div className="flex justify-between items-end gap-6 border-b border-gold/10 pb-8">
                <div>
                    <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">
                        {isEdit ? 'Cap Nhat Bai Viet' : 'Tao Bai Viet Moi'}
                    </h1>
                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.18em] mt-2">
                        Mac dinh bai moi duoc hien thi ngay tren website
                    </p>
                </div>

                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/blog')}
                        className="px-8 py-3 text-[10px] font-bold uppercase tracking-widest text-stone hover:text-primary transition-colors border border-stone/20"
                    >
                        Huy
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-primary text-white font-ui font-bold uppercase tracking-widest px-10 py-3 hover:bg-umber transition-all shadow-premium disabled:opacity-50"
                    >
                        {loading ? 'Dang luu...' : isEdit ? 'Cap Nhat' : 'Dang Bai'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                <div className="lg:col-span-8 space-y-8">
                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tieu De Bai Viet</label>
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            className="w-full bg-white border border-gold/20 p-5 focus:outline-none focus:border-primary font-display text-2xl text-primary shadow-sm"
                            placeholder="VD: Bi quyet chon gom Bat Trang"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tu Khoa SEO Chinh</label>
                        <input
                            type="text"
                            name="seo_keyword"
                            value={formData.seo_keyword}
                            onChange={handleChange}
                            className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm text-primary shadow-sm"
                            placeholder="VD: gom bat trang phong khach"
                        />
                        <p className="text-[10px] text-stone/55 italic">Moi bai nen gan mot tu khoa SEO chinh de theo doi ket qua.</p>
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tom Tat Ngan (Excerpt)</label>
                        <textarea
                            name="excerpt"
                            value={formData.excerpt}
                            onChange={handleChange}
                            rows="3"
                            className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm italic text-umber shadow-sm resize-none"
                            placeholder="Doan mo ta ngan de thu hut doc gia..."
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center mb-1">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Noi Dung Chi Tiet</label>
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
                                {aiGenerating ? 'Dang tao noi dung...' : 'AI tao content'}
                            </button>
                        </div>

                        <div className="bg-white border border-gold/20 shadow-sm quill-premium-wrapper">
                            <ReactQuill
                                theme="snow"
                                value={formData.content}
                                onChange={(content) => setFormData((prev) => ({ ...prev, content }))}
                                modules={quillModules}
                                formats={quillFormats}
                                className="font-body text-lg"
                                style={{ height: '500px', marginBottom: '50px' }}
                            />
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-4 space-y-8">
                    <div className="bg-white border border-gold/20 shadow-premium p-6 space-y-6">
                        <div className="space-y-4">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">image</span>
                                Anh Dai Dien
                            </label>

                            <div className="aspect-[16/9] w-full bg-gold/5 border-2 border-dashed border-gold/20 flex items-center justify-center relative overflow-hidden group">
                                {formData.featured_image ? (
                                    <>
                                        <img src={formData.featured_image} className="w-full h-full object-cover" alt="Preview" />
                                        <div className="absolute inset-0 bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                                            <button
                                                type="button"
                                                onClick={() => setFormData((prev) => ({ ...prev, featured_image: '' }))}
                                                className="bg-white/90 p-2 rounded-full text-brick hover:scale-110 transition-transform"
                                            >
                                                <span className="material-symbols-outlined text-sm">delete</span>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center space-y-2 p-6">
                                        <span className="material-symbols-outlined text-3xl text-gold opacity-40">add_photo_alternate</span>
                                        <p className="text-[10px] text-stone font-ui uppercase tracking-widest">Chua co anh dai dien</p>
                                    </div>
                                )}
                            </div>

                            <input
                                type="text"
                                name="featured_image"
                                value={formData.featured_image}
                                onChange={handleChange}
                                className="w-full bg-gold/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-xs italic"
                                placeholder="Dan URL anh tai day..."
                            />
                        </div>

                        <div className="h-px bg-gold/10"></div>

                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Trang Thai Dang</label>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        name="is_published"
                                        checked={formData.is_published}
                                        onChange={handleChange}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-stone/20 rounded-full peer peer-checked:bg-gold peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Danh Dau Sao</label>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        name="is_starred"
                                        checked={formData.is_starred}
                                        onChange={handleChange}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-stone/20 rounded-full peer peer-checked:bg-gold peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                                </label>
                            </div>

                            <div className="space-y-3">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs">schedule</span>
                                    Lich Dang (Tuy chon)
                                </label>
                                <input
                                    type="date"
                                    name="published_at"
                                    value={formData.published_at}
                                    onChange={handleChange}
                                    className="w-full bg-gold/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-ui text-[10px] font-bold uppercase tracking-widest"
                                />
                                <p className="text-[9px] text-stone italic">De trong neu muon hien thi ngay sau khi bat Trang Thai Dang.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    );
};

export default BlogForm;
