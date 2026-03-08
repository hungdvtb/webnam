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
        <div className="max-w-5xl mx-auto space-y-6 pb-20 animate-fade-in">
            <h1 className="text-4xl font-display font-bold text-primary italic uppercase tracking-widest border-b border-gold/10 pb-6">Cấu hình Hệ thống</h1>

            <form onSubmit={handleSubmit} className="space-y-8">
                {/* General Settings */}
                <div className="bg-white border border-gold/10 shadow-premium p-8 space-y-8">
                    <h3 className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-4">Thông tin cơ bản</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tên Website</label>
                            <input
                                type="text"
                                name="site_name"
                                value={settings.site_name}
                                onChange={handleChange}
                                className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Email liên hệ</label>
                            <input
                                type="email"
                                name="contact_email"
                                value={settings.contact_email}
                                onChange={handleChange}
                                className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Số điện thoại</label>
                            <input
                                type="text"
                                name="contact_phone"
                                value={settings.contact_phone}
                                onChange={handleChange}
                                className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Chân trang (Copyright text)</label>
                            <input
                                type="text"
                                name="footer_text"
                                value={settings.footer_text}
                                onChange={handleChange}
                                className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer Section Manager */}
                <div className="bg-white border border-gold/10 shadow-premium p-8 space-y-8">
                    <h3 className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-4">Quản lý Footer (Chân trang)</h3>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Logo Footer (URL)</label>
                                <input
                                    type="text"
                                    name="footer_brand_logo"
                                    value={settings.footer_brand_logo}
                                    onChange={handleChange}
                                    placeholder="/logo.png"
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Mô tả ngắn Footer</label>
                                <input
                                    type="text"
                                    name="footer_brand_desc"
                                    value={settings.footer_brand_desc}
                                    onChange={handleChange}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tiêu đề Cột 1</label>
                                <input
                                    type="text"
                                    name="footer_column_1_title"
                                    value={settings.footer_column_1_title}
                                    onChange={handleChange}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tiêu đề Cột 2</label>
                                <input
                                    type="text"
                                    name="footer_column_2_title"
                                    value={settings.footer_column_2_title}
                                    onChange={handleChange}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-4 pt-4">
                            <h4 className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Mạng xã hội</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="flex items-center gap-3 bg-background-light border border-gold/10 p-2">
                                    <span className="material-symbols-outlined text-gold">photo_camera</span>
                                    <input name="footer_social_instagram" value={settings.footer_social_instagram} onChange={handleChange} className="bg-transparent border-none text-xs w-full focus:ring-0" placeholder="Instagram URL" />
                                </div>
                                <div className="flex items-center gap-3 bg-background-light border border-gold/10 p-2">
                                    <span className="material-symbols-outlined text-gold">facebook</span>
                                    <input name="footer_social_facebook" value={settings.footer_social_facebook} onChange={handleChange} className="bg-transparent border-none text-xs w-full focus:ring-0" placeholder="Facebook URL" />
                                </div>
                                <div className="flex items-center gap-3 bg-background-light border border-gold/10 p-2">
                                    <span className="material-symbols-outlined text-gold">palette</span>
                                    <input name="footer_social_pinterest" value={settings.footer_social_pinterest} onChange={handleChange} className="bg-transparent border-none text-xs w-full focus:ring-0" placeholder="Pinterest URL" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white border border-gold/10 shadow-premium p-8 space-y-8">
                    <h3 className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-4">Nội dung Trang Chủ (Story Section)</h3>
                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tiêu đề bài viết</label>
                        <input
                            type="text"
                            name="about_story_title"
                            value={settings.about_story_title}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-gold font-body text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Nội dung bài viết</label>
                        <textarea
                            name="about_story_content"
                            value={settings.about_story_content}
                            onChange={handleChange}
                            rows="4"
                            className="w-full bg-background-light border border-gold/20 p-8 focus:outline-none focus:border-gold font-body text-sm h-40 resize-none"
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <button
                        type="submit"
                        disabled={saving}
                        className="px-12 py-4 bg-primary text-white font-ui font-bold uppercase tracking-widest text-xs hover:bg-umber transition-all flex items-center gap-2 shadow-premium"
                    >
                        {saving && <span className="animate-spin size-4 border-2 border-white/30 border-t-white rounded-full"></span>}
                        LƯU CÀI ĐẶT
                    </button>
                </div>
            </form>
        </div>
    );
};

export default SiteSettings;
