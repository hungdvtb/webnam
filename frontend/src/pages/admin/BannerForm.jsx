import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { cmsApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const BannerForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal } = useUI();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [banner, setBanner] = useState({
        account_id: localStorage.getItem('activeAccountId') || '',
        title: '',
        subtitle: '',
        image_url: '',
        link_url: '',
        button_text: '',
        sort_order: 0,
        is_active: true
    });

    const handleAIGenerate = async () => {
        setAiGenerating(true);
        try {
            const prompt = `Hãy viết một tiêu đề (Title) và phụ đề (Subtitle) cực kỳ sang trọng, cuốn hút và mang đậm chất nghệ thuật gốm sứ Bát Tràng cho một Banner quảng cáo trên trang chủ. 
            Yêu cầu:
            1. Ngôn ngữ: Tiếng Việt, sử dụng từ ngữ hoa mỹ, đậm phong thái "Artisan" và "Luxury".
            2. Tiêu đề không quá 8 từ, phụ đề không quá 20 từ.
            3. Trả về kết quả dưới dạng JSON: { "title": "...", "subtitle": "...", "button": "..." }
            Ví dụ: { "title": "BÁT TRÀNG - TINH HOA TỰ CỔ", "subtitle": "Mỗi tác phẩm là một câu chuyện tình ca của đất và lửa, gìn giữ hồn cốt dân tộc qua nghìn năm.", "button": "Khám Phá Di Sản" }`;

            const response = await aiApi.chat({ message: prompt });
            let aiData;
            try {
                const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
                aiData = JSON.parse(jsonMatch ? jsonMatch[0] : response.data.response);
            } catch (e) {
                aiData = { title: "TINH HOA GỐM VIỆT", subtitle: "Di sản nghìn năm truyền đời", button: "Xem Ngay" };
            }

            setBanner(prev => ({
                ...prev,
                title: aiData.title || prev.title,
                subtitle: aiData.subtitle || prev.subtitle,
                button_text: aiData.button || prev.button_text
            }));

            showModal({ title: 'Thành công', content: 'AI đã sáng tạo ra thông điệp thương hiệu đẳng cấp!', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi AI', content: 'Không thể kết nối AI.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    useEffect(() => {
        if (isEdit) {
            setLoading(true);
            cmsApi.banners.getOne(id)
                .then(res => {
                    setBanner(res.data);
                })
                .catch(err => {
                    console.error("Error fetching banner", err);
                    showModal({
                        title: 'Lỗi',
                        content: 'Không thể tải thông tin banner.',
                        type: 'error'
                    });
                })
                .finally(() => setLoading(false));
        }
    }, [id, isEdit]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setBanner(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (isEdit) {
                await cmsApi.banners.update(id, banner);
                showModal({
                    title: 'Thành công',
                    content: 'Đã cập nhật banner.',
                    type: 'success'
                });
            } else {
                await cmsApi.banners.store(banner);
                showModal({
                    title: 'Thành công',
                    content: 'Đã thêm banner mới.',
                    type: 'success'
                });
            }
            navigate('/admin/banners');
        } catch (error) {
            console.error("Error saving banner", error);
            showModal({
                title: 'Lỗi',
                content: 'Không thể lưu banner.',
                type: 'error'
            });
        } finally {
            setSaving(false);
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
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/admin/banners" className="p-2 hover:bg-gold/10 rounded-full transition-colors">
                        <span className="material-symbols-outlined text-primary">arrow_back</span>
                    </Link>
                    <h1 className="text-2xl font-display font-bold text-primary">
                        {isEdit ? 'Chỉnh sửa Banner' : 'Thêm Banner mới'}
                    </h1>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="bg-white border border-gold/10 shadow-sm p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Tiêu đề</label>
                            <button
                                type="button"
                                onClick={handleAIGenerate}
                                disabled={aiGenerating}
                                className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 transition-all ${aiGenerating ? 'text-gold opacity-50 cursor-wait' : 'text-gold hover:text-primary active:scale-95'}`}
                            >
                                <span className={`material-symbols-outlined text-sm ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                {aiGenerating ? 'Đang viết...' : 'AI Sáng Tạo Content'}
                            </button>
                        </div>
                        <input
                            type="text"
                            name="title"
                            value={banner.title}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-gold font-body text-sm font-bold text-primary uppercase tracking-wider"
                            placeholder="Nhập tiêu đề hoặc để AI gợi ý..."
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Phụ đề</label>
                        <input
                            type="text"
                            name="subtitle"
                            value={banner.subtitle}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-gold font-body text-sm"
                            placeholder="Nhập mô tả ngắn dưới tiêu đề"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Hình ảnh Banner (URL)</label>
                    <div className="flex gap-4 items-start">
                        <div className="flex-grow space-y-2">
                            <input
                                type="text"
                                name="image_url"
                                required
                                value={banner.image_url}
                                onChange={handleChange}
                                className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-gold font-body text-sm"
                                placeholder="Dán link ảnh chất lượng cao (1920x800)"
                            />
                            <p className="text-[10px] text-stone italic">Nên sử dụng ảnh ngang có tỉ lệ 16:9 hoặc rộng hơn để tối ưu thẩm mỹ.</p>
                        </div>
                        {banner.image_url && (
                            <div className="w-40 aspect-video bg-gold/5 border border-gold/20 overflow-hidden flex-shrink-0">
                                <img src={banner.image_url} className="w-full h-full object-cover" alt="Preview banner" />
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Đường dẫn (Link)</label>
                        <input
                            type="text"
                            name="link_url"
                            value={banner.link_url}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-gold font-body text-sm"
                            placeholder="Vídụ: /shop hoặc /about"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Nút hành động</label>
                        <input
                            type="text"
                            name="button_text"
                            value={banner.button_text}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-gold font-body text-sm"
                            placeholder="Vídụ: Xem ngay"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Thứ tự hiển thị</label>
                        <input
                            type="number"
                            name="sort_order"
                            value={banner.sort_order}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-3 focus:outline-none focus:border-gold font-body text-sm"
                        />
                    </div>
                </div>

                <div className="flex items-center space-x-3 pt-4 border-t border-gold/10">
                    <input
                        type="checkbox"
                        id="is_active"
                        name="is_active"
                        checked={banner.is_active}
                        onChange={handleChange}
                        className="size-4 accent-gold"
                    />
                    <label htmlFor="is_active" className="font-ui text-xs font-bold uppercase tracking-widest text-primary cursor-pointer">
                        Đang hoạt động (Hiển thị ra trang chủ)
                    </label>
                </div>

                {!banner.account_id && (
                    <div className="p-4 bg-brick/10 border border-brick/20 text-brick text-xs font-bold italic">
                        Lưu ý: Bạn cần chọn Account Id trong hệ thống hoặc đảm bảo activeAccountId đã thiết lập.
                    </div>
                )}

                <div className="flex justify-end gap-4 pt-10">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/banners')}
                        className="px-8 py-3 bg-stone/10 text-stone font-ui font-bold uppercase tracking-widest text-xs hover:bg-stone/20 transition-all"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="px-10 py-3 bg-primary text-white font-ui font-bold uppercase tracking-widest text-xs hover:bg-umber transition-all flex items-center gap-2"
                    >
                        {saving && <span className="animate-spin size-3 border-2 border-white/30 border-t-white rounded-full"></span>}
                        {isEdit ? 'Cập nhật' : 'Thêm banner'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default BannerForm;
