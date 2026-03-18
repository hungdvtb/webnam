import React, { useState, useEffect } from 'react';
import { cmsApi, mediaApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { motion } from 'framer-motion';

const SiteSettings = () => {
    const { showModal } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('ui');
    const [settings, setSettings] = useState({
        site_name: '',
        contact_phone: '',
        contact_email: '',
        footer_text: '',
        about_story_title: '',
        about_story_content: '',
        // Bank Information
        bank_name: '',
        bank_account_number: '',
        bank_account_name: '',
        bank_transfer_template: 'Thanh toan don hang {order_number}',
        bank_qr_code: '',
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

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const uploadData = new FormData();
            uploadData.append('image', file);
            const response = await mediaApi.upload(uploadData);
            if (response.data.success) {
                setSettings(prev => ({
                    ...prev,
                    bank_qr_code: response.data.url
                }));
            } else {
                showModal({ title: 'Lỗi', content: 'Tải ảnh thất bại.', type: 'error' });
            }
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể tải ảnh.', type: 'error' });
        }
    };

    const handleRemoveQrCode = () => {
        setSettings(prev => ({ ...prev, bank_qr_code: '' }));
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const inputClasses = "w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all";
    const labelClasses = "text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block";

    return (
        <div className="flex flex-col bg-[#fcfcfa] animate-fade-in p-6 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 6px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: #f1f5f9;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: #cbd5e1;
                        border-radius: 3px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: #94a3b8;
                    }
                `}
            </style>

            {/* Header Area */}
            <div className="flex justify-between items-center mb-8">
                <div className="flex flex-col">
                    <h1 className="text-2xl font-black text-primary uppercase tracking-tight italic">Cài đặt web</h1>
                    <p className="text-[10px] font-black text-primary/40 uppercase tracking-[0.2em] mt-1 italic">Thiết lập tham số vận hành và thông tin thương hiệu</p>
                </div>
                
                <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="bg-primary text-white px-8 py-2.5 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                    {saving ? (
                        <div className="animate-spin size-4 border-2 border-white/20 border-t-white rounded-full"></div>
                    ) : (
                        <span className="material-symbols-outlined text-[18px]">save</span>
                    )}
                    LƯU THAY ĐỔI
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-8 mb-6 border-b border-primary/10">
                <button 
                    onClick={() => setActiveTab('ui')}
                    className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative ${activeTab === 'ui' ? 'text-primary' : 'text-primary/40 hover:text-primary/70'}`}
                >
                    Giao diện & Chân trang
                    {activeTab === 'ui' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
                <button 
                    onClick={() => setActiveTab('bank')}
                    className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative ${activeTab === 'bank' ? 'text-primary' : 'text-primary/40 hover:text-primary/70'}`}
                >
                    Cài đặt STK
                    {activeTab === 'bank' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-12">
                <div className="max-w-5xl space-y-6">
                    {activeTab === 'ui' && (
                        <>
                            {/* General Information Card */}
                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">info</span>
                                    <h2 className="text-[13px] font-black text-primary uppercase">Thông tin cơ bản</h2>
                                </div>
                                <div className="p-6 grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên Website</label>
                                        <input
                                            type="text"
                                            name="site_name"
                                            value={settings.site_name}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="Nhập tên website..."
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Số điện thoại liên hệ</label>
                                        <input
                                            type="text"
                                            name="contact_phone"
                                            value={settings.contact_phone}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="0123 456 789"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Email liên hệ</label>
                                        <input
                                            type="email"
                                            name="contact_email"
                                            value={settings.contact_email}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="contact@example.com"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Bản quyền chân trang (Copyright)</label>
                                        <input
                                            type="text"
                                            name="footer_text"
                                            value={settings.footer_text}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="© 2024 Gốm Đại Thành"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Footer Management Card */}
                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">view_quilt</span>
                                    <h2 className="text-[13px] font-black text-primary uppercase">Cấu hình Footer</h2>
                                </div>
                                <div className="p-6 space-y-6">
                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClasses}>Logo Footer (URL)</label>
                                            <input
                                                type="text"
                                                name="footer_brand_logo"
                                                value={settings.footer_brand_logo}
                                                onChange={handleChange}
                                                className={inputClasses}
                                                placeholder="/images/logo-footer.png"
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Mô tả thương hiệu ở Footer</label>
                                            <textarea
                                                name="footer_brand_desc"
                                                value={settings.footer_brand_desc}
                                                onChange={handleChange}
                                                className={`${inputClasses} h-20 py-2 resize-none`}
                                            />
                                        </div>
                                    </div>
                                    <hr className="border-primary/5" />
                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClasses}>Tiêu đề cột 1 (Khám phá)</label>
                                            <input
                                                type="text"
                                                name="footer_column_1_title"
                                                value={settings.footer_column_1_title}
                                                onChange={handleChange}
                                                className={inputClasses}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Tiêu đề cột 2 (Hỗ trợ)</label>
                                            <input
                                                type="text"
                                                name="footer_column_2_title"
                                                value={settings.footer_column_2_title}
                                                onChange={handleChange}
                                                className={inputClasses}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 bg-primary/[0.02] p-4 rounded-sm border border-primary/5">
                                        <div>
                                            <label className={labelClasses}>Facebook URL</label>
                                            <input name="footer_social_facebook" value={settings.footer_social_facebook} onChange={handleChange} className={inputClasses} />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Instagram URL</label>
                                            <input name="footer_social_instagram" value={settings.footer_social_instagram} onChange={handleChange} className={inputClasses} />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Pinterest URL</label>
                                            <input name="footer_social_pinterest" value={settings.footer_social_pinterest} onChange={handleChange} className={inputClasses} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Home Story Card */}
                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">history_edu</span>
                                    <h2 className="text-[13px] font-black text-primary uppercase">Câu chuyện thương hiệu (Trang chủ)</h2>
                                </div>
                                <div className="p-6 space-y-6">
                                    <div>
                                        <label className={labelClasses}>Tiêu đề chính</label>
                                        <input
                                            type="text"
                                            name="about_story_title"
                                            value={settings.about_story_title}
                                            onChange={handleChange}
                                            className={`${inputClasses} font-black text-[15px] h-12`}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Nội dung chi tiết</label>
                                        <textarea
                                            name="about_story_content"
                                            value={settings.about_story_content}
                                            onChange={handleChange}
                                            rows="8"
                                            className={`${inputClasses} h-48 py-4 leading-relaxed font-medium text-[14px]`}
                                            placeholder="Kể lại câu chuyện tinh hoa đất Việt..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === 'bank' && (
                        <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                            <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary text-[20px]">account_balance</span>
                                <h2 className="text-[13px] font-black text-primary uppercase">Thông tin tài khoản nhận tiền</h2>
                            </div>
                            <div className="p-6 space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên ngân hàng</label>
                                        <input type="text" name="bank_name" value={settings.bank_name || ''} onChange={handleChange} className={inputClasses} placeholder="Vietcombank, Techcombank..." />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Số tài khoản</label>
                                        <input type="text" name="bank_account_number" value={settings.bank_account_number || ''} onChange={handleChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Tên chủ tài khoản</label>
                                        <input type="text" name="bank_account_name" value={settings.bank_account_name || ''} onChange={handleChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Nội dung chuyển khoản mặc định</label>
                                        <input type="text" name="bank_transfer_template" value={settings.bank_transfer_template || ''} onChange={handleChange} className={inputClasses} />
                                        <p className="text-[10px] text-primary/40 mt-1 italic font-medium">Biến tự động: {'{order_number}'}</p>
                                    </div>
                                </div>

                                <div className="border-t border-primary/5 pt-6">
                                    <label className={labelClasses}>Mã QR Chuyển khoản</label>
                                    <div className="mt-4 flex flex-col items-center">
                                        {settings.bank_qr_code ? (
                                            <div className="relative group">
                                                <div className="w-48 h-48 bg-white border border-primary/10 p-2 rounded-sm shadow-inner flex items-center justify-center overflow-hidden">
                                                    <img src={settings.bank_qr_code} alt="QR Code" className="max-w-full max-h-full object-contain" />
                                                </div>
                                                <div className="absolute inset-0 bg-primary/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all rounded-sm gap-4">
                                                    <label className="cursor-pointer bg-white text-primary p-2 rounded-full hover:bg-gold transition-colors shadow-lg">
                                                        <span className="material-symbols-outlined text-[20px]">edit</span>
                                                        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                                    </label>
                                                    <button onClick={handleRemoveQrCode} className="bg-white text-primary p-2 rounded-full hover:bg-stone-100 transition-colors shadow-lg">
                                                        <span className="material-symbols-outlined text-[20px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <label className="w-full max-w-md h-32 border-2 border-dashed border-primary/20 rounded-sm flex flex-col items-center justify-center cursor-pointer hover:bg-primary/[0.02] hover:border-primary/40 transition-all group">
                                                <span className="material-symbols-outlined text-primary/30 text-[32px] group-hover:scale-110 transition-transform">add_photo_alternate</span>
                                                <span className="text-[13px] font-bold text-primary/60 mt-2">Nhấn để tải lên ảnh QR ngân hàng</span>
                                                <span className="text-[11px] text-primary/30">Hỗ trợ định dạng ảnh JPG, PNG</span>
                                                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SiteSettings;
