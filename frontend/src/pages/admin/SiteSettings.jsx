import React, { useState, useEffect } from 'react';
import { cmsApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const SiteSettings = () => {
    const { showModal } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        site_name: '',
        contact_phone: '',
        contact_email: '',
        footer_text: '',
        about_story_title: '',
        about_story_content: '',
        // Footer management
        footer_brand_logo: '',
        footer_brand_desc: 'Tôn vinh nét đẹp văn hóa truyền thống qua từng đường nét gốm sứ thủ công tinh xảo.',
        footer_column_1_title: 'Khám Phá',
        footer_column_2_title: 'Hỗ Trợ',
        footer_social_instagram: '#',
        footer_social_facebook: '#',
        footer_social_pinterest: '#',
    });

    const activeAccountId = localStorage.getItem('activeAccountId');

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const response = await cmsApi.settings.get();
                setSettings(prev => ({
                    ...prev,
                    ...response.data
                }));
            } catch (error) {
                console.error("Error fetching settings", error);
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!activeAccountId) {
            showModal({
                title: 'Lỗi',
                content: 'Vui lòng chọn Account Id trước khi lưu.',
                type: 'error'
            });
            return;
        }

        setSaving(true);
        try {
            await cmsApi.settings.update({
                account_id: activeAccountId,
                settings: settings
            });
            showModal({
                title: 'Thành công',
                content: 'Đã lưu cài đặt giao diện.',
                type: 'success'
            });
        } catch (error) {
            console.error("Error saving settings", error);
            showModal({
                title: 'Lỗi',
                content: 'Không thể lưu cài đặt.',
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
                        <h1 className="text-2xl font-display font-bold text-primary italic">Cấu hình hệ thống</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] mt-1 italic">Thiết lập tham số vận hành và thông tin thương hiệu</p>
                    </div>
                </div>

                {/* Toolbar Context */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-stone/5 border border-gold/10 rounded-sm">
                            <span className="material-symbols-outlined text-[16px] text-gold">info</span>
                            <span className="text-[11px] font-bold text-stone/60 uppercase tracking-widest leading-none">Cài đặt Site & Footer</span>
                        </div>
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="bg-primary text-white border border-primary px-4 py-1.5 hover:bg-umber transition-all flex items-center justify-center gap-2 rounded-sm shadow-sm active:scale-95 disabled:opacity-50"
                    >
                        {saving ? (
                            <span className="animate-spin size-4 border-2 border-white/20 border-t-white rounded-full"></span>
                        ) : (
                            <span className="material-symbols-outlined text-[18px]">save</span>
                        )}
                        <span className="text-[10px] font-black uppercase tracking-widest">Lưu thay đổi</span>
                    </button>
                </div>
            </div>

            {/* Content Area - Scrollable Form */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                <form onSubmit={handleSubmit} className="space-y-6 max-w-6xl">
                    {/* General Settings Card */}
                    <div className="bg-white border border-gold/10 shadow-sm overflow-hidden rounded-sm">
                        <div className="px-6 py-3 bg-stone/5 border-b border-gold/10 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">app_settings_alt</span>
                            <h3 className="font-ui text-[11px] font-black uppercase tracking-[0.1em] text-primary">Thông tin cơ bản</h3>
                        </div>
                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                            <div className="space-y-1.5">
                                <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Tên Website</label>
                                <input
                                    type="text"
                                    name="site_name"
                                    value={settings.site_name}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm transition-all focus:bg-white"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Email liên hệ</label>
                                <input
                                    type="email"
                                    name="contact_email"
                                    value={settings.contact_email}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm transition-all focus:bg-white"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Số điện thoại</label>
                                <input
                                    type="text"
                                    name="contact_phone"
                                    value={settings.contact_phone}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm transition-all focus:bg-white"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Chân trang (Copyright text)</label>
                                <input
                                    type="text"
                                    name="footer_text"
                                    value={settings.footer_text}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm transition-all focus:bg-white"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer Section Manager Card */}
                    <div className="bg-white border border-gold/10 shadow-sm overflow-hidden rounded-sm">
                        <div className="px-6 py-3 bg-stone/5 border-b border-gold/10 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">view_quilt</span>
                            <h3 className="font-ui text-[11px] font-black uppercase tracking-[0.1em] text-primary">Quản lý Footer (Chân trang)</h3>
                        </div>
                        <div className="p-8 space-y-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Logo Footer (URL)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            name="footer_brand_logo"
                                            value={settings.footer_brand_logo}
                                            onChange={handleChange}
                                            placeholder="/logo.png"
                                            className="flex-1 bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm"
                                        />
                                        {settings.footer_brand_logo && (
                                            <div className="size-11 bg-white border border-gold/10 rounded-sm flex items-center justify-center p-1 shrink-0 overflow-hidden">
                                                <img src={settings.footer_brand_logo} alt="Preview" className="max-w-full max-h-full object-contain" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Mô tả ngắn Footer</label>
                                    <textarea
                                        name="footer_brand_desc"
                                        value={settings.footer_brand_desc}
                                        onChange={handleChange}
                                        className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[13px] h-[44px] resize-none rounded-sm"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-4 border-t border-gold/5">
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Tiêu đề Cột 1</label>
                                    <input
                                        type="text"
                                        name="footer_column_1_title"
                                        value={settings.footer_column_1_title}
                                        onChange={handleChange}
                                        className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Tiêu đề Cột 2</label>
                                    <input
                                        type="text"
                                        name="footer_column_2_title"
                                        value={settings.footer_column_2_title}
                                        onChange={handleChange}
                                        className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4 pt-6">
                                <h4 className="font-ui text-[10px] font-black uppercase tracking-[0.2em] text-stone/30">Mạng xã hội tích hợp</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="flex items-center gap-3 bg-stone/5 border border-gold/10 px-4 py-3 rounded-sm group focus-within:border-primary transition-all">
                                        <span className="material-symbols-outlined text-[20px] text-stone/30 group-focus-within:text-primary">photo_camera</span>
                                        <input name="footer_social_instagram" value={settings.footer_social_instagram} onChange={handleChange} className="bg-transparent border-none text-[12px] w-full focus:ring-0 p-0 placeholder:text-stone/20" placeholder="Instagram URL" />
                                    </div>
                                    <div className="flex items-center gap-3 bg-stone/5 border border-gold/10 px-4 py-3 rounded-sm group focus-within:border-primary transition-all">
                                        <span className="material-symbols-outlined text-[20px] text-stone/30 group-focus-within:text-primary">facebook</span>
                                        <input name="footer_social_facebook" value={settings.footer_social_facebook} onChange={handleChange} className="bg-transparent border-none text-[12px] w-full focus:ring-0 p-0 placeholder:text-stone/20" placeholder="Facebook URL" />
                                    </div>
                                    <div className="flex items-center gap-3 bg-stone/5 border border-gold/10 px-4 py-3 rounded-sm group focus-within:border-primary transition-all">
                                        <span className="material-symbols-outlined text-[20px] text-stone/30 group-focus-within:text-primary">share</span>
                                        <input name="footer_social_pinterest" value={settings.footer_social_pinterest} onChange={handleChange} className="bg-transparent border-none text-[12px] w-full focus:ring-0 p-0 placeholder:text-stone/20" placeholder="Pinterest URL" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Story Section Card */}
                    <div className="bg-white border border-gold/10 shadow-sm overflow-hidden rounded-sm">
                        <div className="px-6 py-3 bg-stone/5 border-b border-gold/10 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">auto_stories</span>
                            <h3 className="font-ui text-[11px] font-black uppercase tracking-[0.1em] text-primary">Nội dung Trang Chủ (Story Section)</h3>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-1.5">
                                <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Tiêu đề bài viết</label>
                                <input
                                    type="text"
                                    name="about_story_title"
                                    value={settings.about_story_title}
                                    onChange={handleChange}
                                    className="w-full bg-stone/5 border border-gold/10 p-3 focus:outline-none focus:border-primary font-display font-bold text-[16px] text-primary rounded-sm transition-all"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="font-ui text-[10px] font-black uppercase tracking-widest text-stone/40">Nội dung câu chuyện</label>
                                <textarea
                                    name="about_story_content"
                                    value={settings.about_story_content}
                                    onChange={handleChange}
                                    rows="6"
                                    className="w-full bg-stone/5 border border-gold/10 p-6 focus:outline-none focus:border-primary font-body text-[14px] leading-relaxed resize-none rounded-sm transition-all min-h-[160px]"
                                    placeholder="Nội dung truyền cảm hứng về thương hiệu..."
                                />
                            </div>
                        </div>
                    </div>

                    {/* Final Action (Extra redundant but helpful bottom bar) */}
                    <div className="flex justify-start gap-4 p-8 bg-gold/5 border border-gold/10 rounded-sm italic text-stone/40 text-[11px] font-medium">
                        <span className="material-symbols-outlined text-[16px]">verified_user</span>
                        Mọi thay đổi sẽ có hiệu lực ngay lập tức trên giao diện cửa hàng sau khi nhấn nút lưu bên trên.
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SiteSettings;
