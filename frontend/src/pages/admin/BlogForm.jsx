import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactQuill from 'react-quill-new';
import { blogApi, aiApi } from '../../services/api';
import BlogMediaGalleryModal from '../../components/admin/BlogMediaGalleryModal';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import {
    GALLERY_BLOCK_CLASS,
    readGalleryItemsFromNode,
    registerBlogMediaGalleryBlot,
} from '../../utils/blogMediaGallery';
import 'react-quill-new/dist/quill.snow.css';

const Quill = ReactQuill.Quill;
registerBlogMediaGalleryBlot(Quill);

const BlogForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal, showToast } = useUI();
    const { available: aiAvailable, disabledReason } = useAiAvailability();
    const quillRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [categories, setCategories] = useState([]);
    const [mediaModalState, setMediaModalState] = useState({
        open: false,
        items: [],
        insertIndex: null,
        editing: false,
    });
    const [formData, setFormData] = useState({
        title: '',
        slug: '',
        blog_category_id: '',
        seo_keyword: '',
        excerpt: '',
        content: '',
        featured_image: '',
        is_published: true,
        is_starred: false,
        published_at: '',
        is_system: false,
    });

    useEffect(() => {
        loadCategories();
        if (isEdit) {
            fetchPost();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        const quill = quillRef.current?.getEditor();

        if (!quill) {
            return undefined;
        }

        const root = quill.root;

        const handleGalleryClick = (event) => {
            const galleryNode = event.target.closest(`.${GALLERY_BLOCK_CLASS}`);

            if (!galleryNode || !root.contains(galleryNode)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const blot = Quill.find(galleryNode);
            const blotIndex = blot ? quill.getIndex(blot) : Math.max(quill.getLength() - 1, 0);

            setMediaModalState({
                open: true,
                items: readGalleryItemsFromNode(galleryNode),
                insertIndex: blotIndex,
                editing: true,
            });
        };

        root.addEventListener('click', handleGalleryClick);

        return () => {
            root.removeEventListener('click', handleGalleryClick);
        };
    }, []);

    const loadCategories = async () => {
        try {
            const response = await blogApi.getCategories();
            setCategories(Array.isArray(response.data?.data) ? response.data.data : []);
        } catch (error) {
            console.error('Error loading categories', error);
        }
    };

    const fetchPost = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getOne(id);
            const data = response.data;

            setFormData({
                title: data.title || '',
                slug: data.slug || '',
                blog_category_id: data.blog_category_id ? String(data.blog_category_id) : '',
                seo_keyword: data.seo_keyword || '',
                excerpt: data.excerpt || '',
                content: data.content || '',
                featured_image: data.featured_image || '',
                is_published: data.is_published ?? true,
                is_starred: data.is_starred || false,
                published_at: data.published_at ? new Date(data.published_at).toISOString().split('T')[0] : '',
                is_system: Boolean(data.is_system),
            });
        } catch (error) {
            console.error('Error fetching post', error);
            showModal({ title: 'Lỗi', content: 'Không thể tải thông tin bài viết.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const syncEditorContent = (quill) => {
        if (!quill) {
            return;
        }

        setFormData((prev) => ({
            ...prev,
            content: quill.root.innerHTML,
        }));
    };

    const openMediaModal = (options = {}) => {
        const quill = quillRef.current?.getEditor();
        const range = quill?.getSelection(true);
        const fallbackIndex = typeof range?.index === 'number'
            ? range.index
            : Math.max((quill?.getLength() ?? 1) - 1, 0);

        setMediaModalState({
            open: true,
            items: Array.isArray(options.items) ? options.items : [],
            insertIndex: typeof options.index === 'number' ? options.index : fallbackIndex,
            editing: Boolean(options.editing),
        });
    };

    const closeMediaModal = () => {
        setMediaModalState((prev) => ({
            ...prev,
            open: false,
        }));
    };

    const handleSaveMediaGallery = (items) => {
        const quill = quillRef.current?.getEditor();

        if (!quill) {
            return;
        }

        const selection = quill.getSelection(true);
        let insertIndex = typeof mediaModalState.insertIndex === 'number'
            ? mediaModalState.insertIndex
            : Math.max(quill.getLength() - 1, 0);

        if (mediaModalState.editing) {
            quill.deleteText(insertIndex, 1, 'user');
        } else if (selection) {
            insertIndex = selection.index;
            if (selection.length > 0) {
                quill.deleteText(selection.index, selection.length, 'user');
            }
        }

        quill.insertEmbed(insertIndex, 'mediaGallery', items, 'user');

        if (quill.getText(insertIndex + 1, 1) !== '\n') {
            quill.insertText(insertIndex + 1, '\n', 'user');
        }

        quill.setSelection(Math.min(insertIndex + 2, quill.getLength()), 0, 'silent');
        syncEditorContent(quill);
        closeMediaModal();

        showToast({
            message: mediaModalState.editing
                ? 'Đã cập nhật block media trong nội dung bài viết.'
                : 'Đã chèn block media vào đúng vị trí con trỏ.',
            type: 'success',
        });
    };

    const handleRemoveMediaGallery = () => {
        const quill = quillRef.current?.getEditor();

        if (!quill || typeof mediaModalState.insertIndex !== 'number') {
            closeMediaModal();
            return;
        }

        quill.deleteText(mediaModalState.insertIndex, 1, 'user');
        syncEditorContent(quill);
        closeMediaModal();

        showToast({
            message: 'Đã xóa block media khỏi nội dung bài viết.',
            type: 'success',
        });
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
            const payload = {
                title: formData.title,
                slug: formData.slug,
                blog_category_id: formData.blog_category_id ? Number(formData.blog_category_id) : null,
                seo_keyword: formData.seo_keyword,
                excerpt: formData.excerpt,
                content: formData.content,
                featured_image: formData.featured_image,
                is_published: formData.is_published,
                is_starred: formData.is_starred,
                published_at: formData.published_at || null,
            };

            if (isEdit) {
                await blogApi.update(id, payload);
                showModal({ title: 'Thành công', content: 'Đã cập nhật bài viết.', type: 'success' });
            } else {
                await blogApi.store(payload);
                showModal({ title: 'Thành công', content: 'Đã tạo bài viết mới.', type: 'success' });
            }

            navigate('/admin/blog');
        } catch (error) {
            console.error('Error saving post', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu bài viết. Vui lòng kiểm tra lại.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleAIGenerate = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }

        setAiGenerating(true);

        try {
            const selectedCategory = categories.find((category) => String(category.id) === String(formData.blog_category_id));
            const prompt = [
                'Bạn là biên tập viên SEO tiếng Việt cho website bán hàng.',
                'Hãy tạo một bài viết blog mới và trả về DUY NHẤT JSON hợp lệ theo cấu trúc:',
                '{"title":"...","seo_keyword":"...","excerpt":"...","content":"..."}',
                'Yêu cầu bắt buộc:',
                '- title hấp dẫn, đúng chính tả, có giá trị SEO.',
                '- seo_keyword ngắn gọn, sát chủ đề bài.',
                '- excerpt dài 140-180 ký tự.',
                '- content là HTML hợp lệ với các thẻ p, h2, h3, ul, li, strong.',
                '- Nội dung khoảng 700-1000 từ, văn phong tự nhiên, bán hàng vừa phải, có giá trị thực tế.',
                '- Có mở bài, phần thân theo cụm ý rõ ràng, kết bài và lời kêu gọi hành động nhẹ.',
                '- Không nhắc rằng bạn là AI.',
                `Tiêu đề gợi ý hiện tại: ${formData.title || 'Chưa có, hãy tự đề xuất tiêu đề phù hợp.'}`,
                `Từ khóa SEO gợi ý: ${formData.seo_keyword || 'Chưa có, hãy tự đề xuất.'}`,
                `Tóm tắt hiện tại: ${formData.excerpt || 'Chưa có.'}`,
                `Danh mục bài viết: ${selectedCategory?.name || 'Chưa chọn danh mục'}`,
            ].join('\n');

            const response = await aiApi.generateContent({ prompt });

            let aiData;
            try {
                const raw = response.data?.text || response.data?.response || '{}';
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                aiData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
            } catch {
                const fallback = response.data?.text || response.data?.response || '';
                aiData = {
                    title: formData.title || 'Bài viết mới',
                    seo_keyword: formData.seo_keyword || '',
                    excerpt: fallback.slice(0, 180),
                    content: `<p>${fallback}</p>`,
                };
            }

            setFormData((prev) => ({
                ...prev,
                title: aiData.title || prev.title,
                seo_keyword: aiData.seo_keyword || prev.seo_keyword,
                excerpt: aiData.excerpt || prev.excerpt,
                content: aiData.content || prev.content,
                is_published: true,
            }));

            showModal({ title: 'Thành công', content: 'AI đã tạo bản thảo bài viết.', type: 'success' });
        } catch {
            showModal({ title: 'Lỗi AI', content: 'Không thể kết nối AI lúc này.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    const quillModules = {
        toolbar: {
            container: [
                [{ header: [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
                ['link', 'image', 'video', 'mediaGallery'],
                ['clean'],
            ],
            handlers: {
                mediaGallery: () => openMediaModal(),
            },
        },
    };

    const quillFormats = [
        'header',
        'bold', 'italic', 'underline', 'strike', 'blockquote',
        'list', 'bullet', 'indent',
        'link', 'image', 'video', 'mediaGallery',
    ];

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in pb-20">
                <div className="flex justify-between items-end gap-6 border-b border-gold/10 pb-8">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">
                                {isEdit ? 'Cập Nhật Bài Viết' : 'Tạo Bài Viết Mới'}
                            </h1>
                            {formData.is_system && (
                                <span className="inline-flex items-center rounded-sm border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                                    Bài hệ thống
                                </span>
                            )}
                        </div>
                        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone/40">
                            {formData.is_system
                                ? 'Bài hệ thống luôn tồn tại, chỉ nên chỉnh phần nội dung hiển thị'
                                : 'Mặc định bài mới được hiển thị ngay trên website'}
                        </p>
                    </div>

                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => navigate('/admin/blog')}
                            className="border border-stone/20 px-8 py-3 text-[10px] font-bold uppercase tracking-widest text-stone transition-colors hover:text-primary"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-primary px-10 py-3 font-ui text-[10px] font-bold uppercase tracking-widest text-white shadow-premium transition-all hover:bg-umber disabled:opacity-50"
                        >
                            {loading ? 'Đang lưu...' : isEdit ? 'Cập Nhật' : 'Đăng Bài'}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
                    <div className="space-y-8 lg:col-span-8">
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tiêu Đề Bài Viết</label>
                            <input
                                type="text"
                                name="title"
                                value={formData.title}
                                onChange={handleChange}
                                required
                                disabled={formData.is_system}
                                className={`w-full border border-gold/20 p-5 font-display text-2xl text-primary shadow-sm ${formData.is_system ? 'cursor-not-allowed bg-stone/5 opacity-80' : 'bg-white focus:border-primary focus:outline-none'}`}
                                placeholder="VD: Bí quyết chọn gốm Bát Tràng"
                            />
                            {formData.is_system && (
                                <p className="text-[10px] italic text-stone/55">Tiêu đề bài hệ thống được giữ cố định để đồng bộ trang chính sách.</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Slug</label>
                            <input
                                type="text"
                                name="slug"
                                value={formData.slug}
                                readOnly
                                className="w-full border border-gold/20 bg-stone/5 p-4 font-body text-sm text-stone/70 shadow-sm focus:outline-none"
                                placeholder="Slug sẽ được tạo tự động"
                            />
                            <p className="text-[10px] italic text-stone/55">Slug được tạo tự động. Với bài hệ thống, slug được cố định để hệ thống luôn nhận diện đúng bài.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Danh Mục Bài Viết</label>
                            <select
                                name="blog_category_id"
                                value={formData.blog_category_id}
                                onChange={handleChange}
                                className="w-full border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                            >
                                <option value="">Chưa gắn danh mục</option>
                                {categories.map((category) => (
                                    <option key={category.id} value={String(category.id)}>
                                        {category.name}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] italic text-stone/55">Danh mục này sẽ được sử dụng cho bộ lọc tab ngoài frontend.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Từ Khóa SEO Chính</label>
                            <input
                                type="text"
                                name="seo_keyword"
                                value={formData.seo_keyword}
                                onChange={handleChange}
                                className="w-full border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                                placeholder="VD: gốm bát tràng phòng khách"
                            />
                            <p className="text-[10px] italic text-stone/55">Mỗi bài nên gắn một từ khóa SEO chính để theo dõi kết quả.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tóm Tắt Ngắn (Excerpt)</label>
                            <textarea
                                name="excerpt"
                                value={formData.excerpt}
                                onChange={handleChange}
                                rows="3"
                                className="w-full resize-none border border-gold/20 bg-white p-4 font-body text-sm italic text-umber shadow-sm focus:border-primary focus:outline-none"
                                placeholder="Đoạn mô tả ngắn để thu hút độc giả..."
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="mb-1 flex items-center justify-between">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Nội Dung Chi Tiết</label>
                                <button
                                    type="button"
                                    onClick={handleAIGenerate}
                                    disabled={aiGenerating || !aiAvailable}
                                    className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest shadow-sm transition-all ${aiGenerating
                                        ? 'cursor-wait animate-pulse bg-gold/10 text-gold'
                                        : !aiAvailable
                                            ? 'cursor-not-allowed bg-stone-300 text-stone-100'
                                            : 'bg-gradient-to-r from-primary to-umber text-white hover:scale-105 active:scale-95'
                                        }`}
                                    title={!aiAvailable ? disabledReason : 'Tạo tiêu đề và nội dung bằng AI'}
                                >
                                    <span className={`material-symbols-outlined text-xs ${aiGenerating ? 'animate-spin' : ''}`}>
                                        {aiGenerating ? 'progress_activity' : 'auto_awesome'}
                                    </span>
                                    {aiGenerating ? 'Đang viết bài...' : 'Viết bằng AI'}
                                </button>
                            </div>

                            {!aiAvailable ? (
                                <p className="text-[11px] italic text-amber-700">{disabledReason}</p>
                            ) : null}

                            <div className="quill-premium-wrapper border border-gold/20 bg-white shadow-sm">
                                <ReactQuill
                                    ref={quillRef}
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

                    <div className="space-y-8 lg:col-span-4">
                        <div className="space-y-6 border border-gold/20 bg-white p-6 shadow-premium">
                            <div className="space-y-4">
                                <label className="font-ui flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                                    <span className="material-symbols-outlined text-xs">image</span>
                                    Ảnh Đại Diện
                                </label>

                                <div className="group relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden border-2 border-dashed border-gold/20 bg-gold/5">
                                    {formData.featured_image ? (
                                        <>
                                            <img src={formData.featured_image} className="h-full w-full object-cover" alt="Preview" />
                                            <div className="absolute inset-0 flex items-center justify-center gap-4 bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100">
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData((prev) => ({ ...prev, featured_image: '' }))}
                                                    className="rounded-full bg-white/90 p-2 text-brick transition-transform hover:scale-110"
                                                >
                                                    <span className="material-symbols-outlined text-sm">delete</span>
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="space-y-2 p-6 text-center">
                                            <span className="material-symbols-outlined text-3xl text-gold opacity-40">add_photo_alternate</span>
                                            <p className="font-ui text-[10px] uppercase tracking-widest text-stone">Chưa có ảnh đại diện</p>
                                        </div>
                                    )}
                                </div>

                                <input
                                    type="text"
                                    name="featured_image"
                                    value={formData.featured_image}
                                    onChange={handleChange}
                                    className="w-full border border-gold/10 bg-gold/5 p-3 font-body text-xs italic focus:border-primary focus:outline-none"
                                    placeholder="Dán URL ảnh tại đây..."
                                />
                            </div>

                            <div className="h-px bg-gold/10"></div>

                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Trạng Thái Đăng</label>
                                    <label className="relative inline-flex cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            name="is_published"
                                            checked={formData.is_published}
                                            onChange={handleChange}
                                            className="peer sr-only"
                                        />
                                        <div className="after:content-[''] w-11 rounded-full bg-stone/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:bg-white after:transition-all peer-checked:bg-gold peer-checked:after:translate-x-full h-6"></div>
                                    </label>
                                </div>

                                <div className="flex items-center justify-between">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Đánh Dấu Sao</label>
                                    <label className="relative inline-flex cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            name="is_starred"
                                            checked={formData.is_starred}
                                            onChange={handleChange}
                                            className="peer sr-only"
                                        />
                                        <div className="after:content-[''] w-11 rounded-full bg-stone/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:bg-white after:transition-all peer-checked:bg-gold peer-checked:after:translate-x-full h-6"></div>
                                    </label>
                                </div>

                                <div className="space-y-3">
                                    <label className="font-ui flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                                        <span className="material-symbols-outlined text-xs">schedule</span>
                                        Lịch Đăng (Tùy chọn)
                                    </label>
                                    <input
                                        type="date"
                                        name="published_at"
                                        value={formData.published_at}
                                        onChange={handleChange}
                                        className="w-full border border-gold/10 bg-gold/5 p-3 font-ui text-[10px] font-bold uppercase tracking-widest focus:border-primary focus:outline-none"
                                    />
                                    <p className="text-[9px] italic text-stone">De trong neu muon hien thi ngay sau khi bat Trạng Thái Đăng.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>

            {mediaModalState.open ? (
                <BlogMediaGalleryModal
                    open={mediaModalState.open}
                    initialItems={mediaModalState.items}
                    editing={mediaModalState.editing}
                    onClose={closeMediaModal}
                    onSave={handleSaveMediaGallery}
                    onRemoveBlock={mediaModalState.editing ? handleRemoveMediaGallery : null}
                />
            ) : null}
        </>
    );
};

export default BlogForm;
