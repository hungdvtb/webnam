import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { cmsApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';

const BannerForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal } = useUI();
    const { available: aiAvailable, disabledReason } = useAiAvailability();
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
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }
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
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
            {/* Sticky Header */}
            <div className="flex-none bg-[#fcfcfa] pb-6 border-b border-gold/10">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => navigate('/admin/banners')}
                            className="size-10 rounded-full border border-gold/20 flex items-center justify-center text-primary hover:bg-gold/10 transition-all group"
                        >
                            <span className="material-symbols-outlined text-[20px] group-hover:-translate-x-0.5 transition-transform">west</span>
                        </button>
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">
                                {isEdit ? 'Biên Tập Banner' : 'Tạo Banner Mới'}
                            </h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Cấu hình trình diễn hình ảnh tại trang chủ</p>
                        </div>
                    </div>
                    
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/admin/banners')}
                            className="px-8 py-2.5 bg-white border border-stone/20 text-stone text-[11px] font-bold uppercase tracking-widest hover:bg-stone/5 transition-all rounded-sm"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            form="banner-form"
                            type="submit"
                            disabled={saving}
                            className="px-10 py-2.5 bg-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-umber transition-all flex items-center gap-2 rounded-sm shadow-premium-sm disabled:opacity-50"
                        >
                            {saving && <span className="animate-spin size-3 border-2 border-white/30 border-t-white rounded-full"></span>}
                            {isEdit ? 'Cập nhật thay đổi' : 'Khởi tạo ngay'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pt-8">
                <div className="max-w-4xl mx-auto">
                    <form id="banner-form" onSubmit={handleSubmit} className="bg-white border border-gold/10 shadow-premium p-8 space-y-8 rounded-sm">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-primary/60">Tiêu đề Banner</label>
                                    <button
                                        type="button"
                                        onClick={handleAIGenerate}
                                        disabled={aiGenerating || !aiAvailable}
                                        className={`text-[9px] font-black uppercase tracking-[0.1em] flex items-center gap-1.5 transition-all ${aiGenerating ? 'text-gold opacity-50' : 'text-gold hover:text-primary active:scale-95'}`}
                                        title={!aiAvailable ? disabledReason : 'Tạo nội dung banner bằng AI'}
                                    >
                                        <span className={`material-symbols-outlined text-[14px] ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                        {aiGenerating ? 'Đang soạn...' : 'AI Sáng Tạo Content'}
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    name="title"
                                    value={banner.title}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-4 focus:outline-none focus:border-primary font-display text-[15px] font-bold text-primary uppercase tracking-wider rounded-sm"
                                    placeholder="Nhập tiêu đề hoặc dùng AI..."
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-primary/60">Thông điệp phụ (Subtitle)</label>
                                <input
                                    type="text"
                                    name="subtitle"
                                    value={banner.subtitle}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-4 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm"
                                    placeholder="Ví dụ: Di sản nghìn năm từ tinh hoa làng nghề..."
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase tracking-widest text-primary/60 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">image</span>
                                Liên kết hình ảnh (URL)
                            </label>
                            <div className="flex flex-col md:flex-row gap-6 items-start">
                                <div className="flex-grow w-full space-y-2">
                                    <input
                                        type="text"
                                        name="image_url"
                                        required
                                        value={banner.image_url}
                                        onChange={handleChange}
                                        className="w-full bg-stone/5 border border-gold/10 p-4 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm"
                                        placeholder="Vui lòng dán link ảnh từ thư viện hoặc URL ngoài..."
                                    />
                                    <div className="p-3 bg-gold/5 border-l-2 border-gold/30 rounded-r-sm">
                                        <p className="text-[11px] text-stone-500 italic leading-relaxed">
                                            Khuyến nghị: Sử dụng ảnh có độ phân giải 1920x800 pixel để đạt độ sắc nét tối đa trên mọi màn hình.
                                        </p>
                                    </div>
                                </div>
                                {banner.image_url && (
                                    <div className="w-full md:w-64 aspect-video bg-stone/10 border border-gold/20 overflow-hidden flex-shrink-0 rounded-sm shadow-premium-sm group">
                                        <img src={banner.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt="Preview banner" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-primary/60 italic">Điều hướng (Link URL)</label>
                                <input
                                    type="text"
                                    name="link_url"
                                    value={banner.link_url}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-4 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm"
                                    placeholder="VD: /san-pham-noi-bat"
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-primary/60 italic">Tên nút Call-to-action</label>
                                <input
                                    type="text"
                                    name="button_text"
                                    value={banner.button_text}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-4 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm"
                                    placeholder="VD: Xem bộ sưu tập"
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-primary/60 italic">Vị trí ưu tiên</label>
                                <input
                                    type="number"
                                    name="sort_order"
                                    value={banner.sort_order}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-4 focus:outline-none focus:border-primary font-mono text-[14px] rounded-sm"
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        <div className="flex items-center space-x-4 pt-6 mt-4 border-t border-gold/5">
                            <label className="relative flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    name="is_active"
                                    checked={banner.is_active}
                                    onChange={handleChange}
                                    className="size-5 accent-primary rounded-sm border-gold/20"
                                />
                                <span className="text-[11px] font-black uppercase tracking-widest text-primary group-hover:text-umber transition-colors">
                                    Đang Kích Hoạt (Hiển thị ngay lập tức)
                                </span>
                            </label>
                        </div>

                        {!banner.account_id && (
                            <div className="p-4 bg-brick/[0.03] border border-brick/10 rounded-sm flex gap-3 text-brick">
                                <span className="material-symbols-outlined text-[18px]">warning</span>
                                <p className="text-[11px] font-bold uppercase tracking-tight leading-relaxed">
                                    Cảnh báo: Banner chưa được gắn với Tài khoản quản trị. Vui lòng kiểm tra lại cấu hình Account ID.
                                </p>
                            </div>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default BannerForm;
