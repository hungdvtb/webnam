import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cmsApi, mediaApi, quoteTemplateApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const defaultSettings = {
    site_name: '',
    contact_phone: '',
    contact_email: '',
    facebook_link: '',
    zalo_link: '',
    messenger_link: '',
    tiktok_link: '',
    youtube_link: '',
    fb_pixel_id: '',
    fb_pixel_active: false,
    ga_id: '',
    ga_active: false,
    tt_pixel_id: '',
    tt_pixel_active: false,
    bank_name: '',
    bank_account_number: '',
    bank_account_name: '',
    bank_transfer_template: 'Thanh toan don hang {order_number}',
    bank_qr_code: '',
    quote_logo_url: '',
    quote_store_name: '',
    quote_store_address: '',
    quote_store_phone: '',
};

const inputClasses = 'w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20';
const textareaClasses = 'w-full min-h-[96px] bg-white border border-primary/20 rounded-sm px-3 py-2 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20 resize-none';
const labelClasses = 'text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block';

const SectionCard = ({ icon, title, children, rightSlot = null }) => (
    <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
        <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
                <h2 className="text-[13px] font-black text-primary uppercase">{title}</h2>
            </div>
            {rightSlot}
        </div>
        <div className="p-6">{children}</div>
    </div>
);

const ImageUploadCard = ({ imageUrl, onUpload, onRemove, emptyLabel, previewClassName = 'h-40' }) => (
    <div className="space-y-3">
        {imageUrl ? (
            <div className="relative group">
                <div className={`w-full ${previewClassName} bg-stone-50 border border-primary/10 rounded-sm overflow-hidden flex items-center justify-center`}>
                    <img src={imageUrl} alt="" className="w-full h-full object-contain" />
                </div>
                <div className="absolute inset-0 bg-primary/45 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all">
                    <label className="cursor-pointer h-10 px-4 rounded-sm bg-white text-primary text-[12px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg">
                        <span className="material-symbols-outlined text-[18px]">upload</span>
                        Đổi ảnh
                        <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
                    </label>
                    <button
                        type="button"
                        onClick={onRemove}
                        className="h-10 px-4 rounded-sm bg-white text-brick text-[12px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg"
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                        Xóa
                    </button>
                </div>
            </div>
        ) : (
            <label className={`w-full ${previewClassName} border-2 border-dashed border-primary/20 rounded-sm flex flex-col items-center justify-center cursor-pointer hover:bg-primary/[0.02] hover:border-primary/40 transition-all group`}>
                <span className="material-symbols-outlined text-primary/30 text-[34px] group-hover:scale-110 transition-transform">add_photo_alternate</span>
                <span className="mt-2 text-[12px] font-black uppercase tracking-wider text-primary/60 text-center px-4">{emptyLabel}</span>
                <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
            </label>
        )}
    </div>
);

const SiteSettings = () => {
    const { showModal } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('contact');
    const [settings, setSettings] = useState(defaultSettings);
    const [domains, setDomains] = useState([]);
    const [newDomain, setNewDomain] = useState('');
    const [quoteTemplates, setQuoteTemplates] = useState([]);
    const [quoteTemplateDraft, setQuoteTemplateDraft] = useState({ name: '', image_url: '' });
    const [savingQuoteTemplateId, setSavingQuoteTemplateId] = useState(null);

    const activeAccountId = localStorage.getItem('activeAccountId');

    const fetchDomains = useCallback(async () => {
        try {
            const response = await cmsApi.domains.getAll();
            setDomains(response.data || []);
        } catch (error) {
            console.error('Error fetching domains', error);
        }
    }, []);

    const fetchQuoteTemplates = useCallback(async () => {
        try {
            const response = await quoteTemplateApi.getAll();
            setQuoteTemplates(response.data || []);
        } catch (error) {
            console.error('Error fetching quote templates', error);
        }
    }, []);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const response = await cmsApi.settings.get();
            setSettings((prev) => ({ ...prev, ...(response.data || {}) }));
        } catch (error) {
            console.error('Error fetching settings', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
        fetchDomains();
        fetchQuoteTemplates();
    }, [fetchSettings, fetchDomains, fetchQuoteTemplates]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings((prev) => ({ ...prev, [name]: value }));
    };

    const uploadImage = async (file) => {
        const uploadData = new FormData();
        uploadData.append('image', file);
        const response = await mediaApi.upload(uploadData);
        if (!response.data?.success || !response.data?.url) {
            throw new Error('UPLOAD_FAILED');
        }
        return response.data.url;
    };

    const handleImageUpload = async (e, onSuccess) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        try {
            const url = await uploadImage(file);
            onSuccess(url);
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể tải ảnh lên.', type: 'error' });
        }
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (!activeAccountId) {
            showModal({ title: 'Lỗi', content: 'Vui lòng chọn account trước khi lưu.', type: 'error' });
            return;
        }

        setSaving(true);
        try {
            await cmsApi.settings.update({
                account_id: activeAccountId,
                settings,
            });
            showModal({ title: 'Thành công', content: 'Đã lưu cấu hình.', type: 'success' });
        } catch (error) {
            console.error('Error saving settings', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu cấu hình.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleAddDomain = async () => {
        if (!newDomain.trim()) return;
        try {
            await cmsApi.domains.store({ domain: newDomain.trim(), is_default: domains.length === 0 });
            setNewDomain('');
            fetchDomains();
            showModal({ title: 'Thành công', content: 'Đã thêm tên miền.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: error.response?.data?.message || 'Không thể thêm tên miền.', type: 'error' });
        }
    };

    const handleToggleActive = async (domain) => {
        if (domain.is_default && domain.is_active) {
            showModal({ title: 'Cảnh báo', content: 'Không thể tắt tên miền mặc định.', type: 'error' });
            return;
        }
        try {
            await cmsApi.domains.update(domain.id, { ...domain, is_active: !domain.is_active });
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái tên miền.', type: 'error' });
        }
    };

    const handleSetDefault = async (domainId) => {
        try {
            await cmsApi.domains.update(domainId, { is_default: true });
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể đặt mặc định.', type: 'error' });
        }
    };

    const handleDeleteDomain = async (domainId) => {
        if (!window.confirm('Bạn có chắc muốn xóa tên miền này?')) return;
        try {
            await cmsApi.domains.destroy(domainId);
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể xóa tên miền.', type: 'error' });
        }
    };

    const handleCreateQuoteTemplate = async () => {
        if (!quoteTemplateDraft.name.trim()) {
            showModal({ title: 'Thiếu dữ liệu', content: 'Nhập tên bộ/mẫu trước khi thêm.', type: 'error' });
            return;
        }

        setSavingQuoteTemplateId('draft');
        try {
            await quoteTemplateApi.store({
                name: quoteTemplateDraft.name.trim(),
                image_url: quoteTemplateDraft.image_url || '',
                is_active: true,
                sort_order: quoteTemplates.length,
            });
            setQuoteTemplateDraft({ name: '', image_url: '' });
            fetchQuoteTemplates();
            showModal({ title: 'Thành công', content: 'Đã thêm bộ/mẫu báo giá.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể thêm bộ/mẫu báo giá.', type: 'error' });
        } finally {
            setSavingQuoteTemplateId(null);
        }
    };

    const updateQuoteTemplateState = (templateId, patch) => {
        setQuoteTemplates((prev) => prev.map((template) => (
            template.id === templateId ? { ...template, ...patch } : template
        )));
    };

    const handleSaveQuoteTemplate = async (template) => {
        if (!template.name?.trim()) {
            showModal({ title: 'Thiếu dữ liệu', content: 'Tên bộ/mẫu không được để trống.', type: 'error' });
            return;
        }

        setSavingQuoteTemplateId(template.id);
        try {
            await quoteTemplateApi.update(template.id, {
                name: template.name.trim(),
                image_url: template.image_url || '',
                sort_order: Number(template.sort_order) || 0,
                is_active: Boolean(template.is_active),
            });
            fetchQuoteTemplates();
            showModal({ title: 'Thành công', content: 'Đã lưu bộ/mẫu báo giá.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể lưu bộ/mẫu báo giá.', type: 'error' });
        } finally {
            setSavingQuoteTemplateId(null);
        }
    };

    const handleDeleteQuoteTemplate = async (templateId) => {
        if (!window.confirm('Bạn có chắc muốn xóa bộ/mẫu báo giá này?')) return;

        setSavingQuoteTemplateId(templateId);
        try {
            await quoteTemplateApi.destroy(templateId);
            fetchQuoteTemplates();
            showModal({ title: 'Thành công', content: 'Đã xóa bộ/mẫu báo giá.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể xóa bộ/mẫu báo giá.', type: 'error' });
        } finally {
            setSavingQuoteTemplateId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const tabs = [
        { id: 'contact', title: 'Liên hệ & Mạng xã hội', icon: 'contact_support' },
        { id: 'pixel', title: 'Pixel & Tracking', icon: 'analytics' },
        { id: 'domains', title: 'Quản lý tên miền', icon: 'language' },
        { id: 'bank', title: 'Cài đặt STK', icon: 'account_balance' },
        { id: 'quote', title: 'Báo giá', icon: 'image' },
    ];

    return (
        <div className="flex flex-col bg-[#fcfcfa] animate-fade-in p-6 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                `}
            </style>

            <div className="flex justify-between items-center mb-8">
                <div className="flex flex-col">
                    <h1 className="text-2xl font-black text-primary uppercase tracking-tight italic">Cài đặt web</h1>
                    <p className="text-[10px] font-black text-primary/40 uppercase tracking-[0.2em] mt-1 italic font-sans">Quản lý liên hệ, thanh toán và mẫu báo giá</p>
                </div>

                {activeTab !== 'domains' && (
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
                        Lưu thay đổi
                    </button>
                )}
            </div>

            <div className="flex gap-8 mb-6 border-b border-primary/10">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative flex items-center gap-2 ${activeTab === tab.id ? 'text-primary' : 'text-primary/40 hover:text-primary/70'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                        {tab.title}
                        {activeTab === tab.id && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-12">
                <div className="max-w-5xl space-y-6">
                    {activeTab === 'contact' && (
                        <div className="space-y-6">
                            <SectionCard icon="person_pin" title="Kênh liên hệ chính">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên website / Thương hiệu</label>
                                        <input type="text" name="site_name" value={settings.site_name} onChange={handleChange} className={inputClasses} placeholder="Gốm Đại Thành" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Hotline hỗ trợ</label>
                                        <input type="text" name="contact_phone" value={settings.contact_phone} onChange={handleChange} className={inputClasses} placeholder="0123 456 789" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className={labelClasses}>Email liên hệ</label>
                                        <input type="email" name="contact_email" value={settings.contact_email} onChange={handleChange} className={inputClasses} placeholder="contact@domain.com" />
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard icon="share" title="Liên kết mạng xã hội">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Zalo URL</label>
                                        <input type="text" name="zalo_link" value={settings.zalo_link} onChange={handleChange} className={inputClasses} placeholder="https://zalo.me/0123456789" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Facebook page URL</label>
                                        <input type="text" name="facebook_link" value={settings.facebook_link} onChange={handleChange} className={inputClasses} placeholder="https://facebook.com/yourpage" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Messenger URL</label>
                                        <input type="text" name="messenger_link" value={settings.messenger_link} onChange={handleChange} className={inputClasses} placeholder="https://m.me/yourpage" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>TikTok URL</label>
                                        <input type="text" name="tiktok_link" value={settings.tiktok_link} onChange={handleChange} className={inputClasses} placeholder="https://tiktok.com/@yourid" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className={labelClasses}>YouTube URL</label>
                                        <input type="text" name="youtube_link" value={settings.youtube_link} onChange={handleChange} className={inputClasses} placeholder="https://youtube.com/@yourchannel" />
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'pixel' && (
                        <div className="space-y-6">
                            {[
                                { key: 'fb', icon: 'ads_click', title: 'Facebook Pixel', idName: 'fb_pixel_id', activeName: 'fb_pixel_active', placeholder: 'VD: 123456789012345' },
                                { key: 'ga', icon: 'analytics', title: 'Google Analytics', idName: 'ga_id', activeName: 'ga_active', placeholder: 'VD: G-ABCDEFG123' },
                                { key: 'tt', icon: 'music_note', title: 'TikTok Pixel', idName: 'tt_pixel_id', activeName: 'tt_pixel_active', placeholder: 'VD: C1234567890ABCDE' },
                            ].map((item) => (
                                <SectionCard
                                    key={item.key}
                                    icon={item.icon}
                                    title={item.title}
                                    rightSlot={(
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] font-black uppercase ${settings[item.activeName] ? 'text-green-500' : 'text-primary/30'}`}>
                                                {settings[item.activeName] ? 'Đang bật' : 'Đang tắt'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setSettings((prev) => ({ ...prev, [item.activeName]: !prev[item.activeName] }))}
                                                className={`relative inline-flex h-5 w-10 rounded-full transition-colors ${settings[item.activeName] ? 'bg-green-500' : 'bg-stone-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 mt-0.5 ${settings[item.activeName] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                            </button>
                                        </div>
                                    )}
                                >
                                    <label className={labelClasses}>{item.title} ID</label>
                                    <input type="text" name={item.idName} value={settings[item.idName]} onChange={handleChange} className={inputClasses} placeholder={item.placeholder} />
                                </SectionCard>
                            ))}
                        </div>
                    )}

                    {activeTab === 'domains' && (
                        <div className="space-y-6">
                            <SectionCard icon="language" title="Thêm tên miền mới">
                                <div className="flex gap-4">
                                    <input
                                        type="text"
                                        value={newDomain}
                                        onChange={(e) => setNewDomain(e.target.value)}
                                        className={inputClasses}
                                        placeholder="VD: gomdaithanh.vn hoặc shop.gomdaithanh.com"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleAddDomain();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddDomain}
                                        className="bg-primary text-white px-6 rounded-sm font-bold text-[13px] hover:bg-primary/90 transition-colors flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">add</span>
                                        Thêm
                                    </button>
                                </div>
                            </SectionCard>

                            <SectionCard icon="list" title="Danh sách tên miền">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-primary/[0.01] border-b border-primary/5">
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider">Tên miền</th>
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider text-center">Trạng thái</th>
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider text-center">Mặc định</th>
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider text-right">Thao tác</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-primary/5">
                                            {domains.length === 0 ? (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-12 text-center text-primary/30 text-[13px] italic">Chưa có tên miền nào được cấu hình.</td>
                                                </tr>
                                            ) : domains.map((domain) => (
                                                <tr key={domain.id} className="hover:bg-primary/[0.01] transition-colors">
                                                    <td className="px-6 py-4 text-[13px] font-bold text-primary">{domain.domain}</td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex justify-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleActive(domain)}
                                                                className={`relative inline-flex h-5 w-10 rounded-full transition-colors ${domain.is_active ? 'bg-green-500' : 'bg-stone-300'}`}
                                                            >
                                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 mt-0.5 ${domain.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        {domain.is_default ? (
                                                            <span className="material-symbols-outlined text-gold text-[20px]">verified</span>
                                                        ) : (
                                                            <button type="button" onClick={() => handleSetDefault(domain.id)} className="text-[10px] font-black uppercase text-primary/30 hover:text-gold transition-colors underline underline-offset-4">
                                                                Đặt mặc định
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteDomain(domain.id)}
                                                            className="size-8 rounded-sm border border-brick/20 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all shadow-sm"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'bank' && (
                        <SectionCard icon="account_balance" title="Thông tin tài khoản nhận tiền">
                            <div className="space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên ngân hàng</label>
                                        <input type="text" name="bank_name" value={settings.bank_name} onChange={handleChange} className={inputClasses} placeholder="Vietcombank, Techcombank..." />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Số tài khoản</label>
                                        <input type="text" name="bank_account_number" value={settings.bank_account_number} onChange={handleChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Tên chủ tài khoản</label>
                                        <input type="text" name="bank_account_name" value={settings.bank_account_name} onChange={handleChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Nội dung chuyển khoản mặc định</label>
                                        <input type="text" name="bank_transfer_template" value={settings.bank_transfer_template} onChange={handleChange} className={inputClasses} />
                                        <p className="text-[10px] text-primary/40 mt-1 italic font-medium">Biến tự động: {'{order_number}'}</p>
                                    </div>
                                </div>

                                <div className="border-t border-primary/5 pt-6">
                                    <label className={labelClasses}>Mã QR chuyển khoản</label>
                                    <div className="max-w-md">
                                        <ImageUploadCard
                                            imageUrl={settings.bank_qr_code}
                                            onUpload={(e) => handleImageUpload(e, (url) => setSettings((prev) => ({ ...prev, bank_qr_code: url })))}
                                            onRemove={() => setSettings((prev) => ({ ...prev, bank_qr_code: '' }))}
                                            emptyLabel="Tải ảnh QR ngân hàng"
                                            previewClassName="h-52"
                                        />
                                    </div>
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    {activeTab === 'quote' && (
                        <div className="space-y-6">
                            <SectionCard icon="badge" title="Thông tin đầu trang báo giá">
                                <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6">
                                    <div>
                                        <label className={labelClasses}>Logo báo giá</label>
                                        <ImageUploadCard
                                            imageUrl={settings.quote_logo_url}
                                            onUpload={(e) => handleImageUpload(e, (url) => setSettings((prev) => ({ ...prev, quote_logo_url: url })))}
                                            onRemove={() => setSettings((prev) => ({ ...prev, quote_logo_url: '' }))}
                                            emptyLabel="Tải logo dùng chung"
                                            previewClassName="h-56"
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className={labelClasses}>Tên xưởng / cửa hàng</label>
                                            <input type="text" name="quote_store_name" value={settings.quote_store_name} onChange={handleChange} className={inputClasses} placeholder="Xưởng sản xuất gốm sứ..." />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Địa chỉ</label>
                                            <textarea name="quote_store_address" value={settings.quote_store_address} onChange={handleChange} className={textareaClasses} placeholder="Nhập địa chỉ hiển thị trên ảnh báo giá..." />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Số điện thoại</label>
                                            <input type="text" name="quote_store_phone" value={settings.quote_store_phone} onChange={handleChange} className={inputClasses} placeholder="0866..." />
                                        </div>
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon="collections"
                                title="Ảnh đại diện theo bộ / mẫu"
                                rightSlot={<span className="text-[11px] font-bold text-primary/40">Dùng khi chụp ảnh báo giá từ đơn hàng</span>}
                            >
                                <div className="space-y-4">
                                    <div className="grid grid-cols-[minmax(0,1fr)_260px_auto] gap-4 items-end border border-dashed border-primary/20 rounded-sm p-4 bg-primary/[0.02]">
                                        <div>
                                            <label className={labelClasses}>Tên bộ / mẫu mới</label>
                                            <input
                                                type="text"
                                                value={quoteTemplateDraft.name}
                                                onChange={(e) => setQuoteTemplateDraft((prev) => ({ ...prev, name: e.target.value }))}
                                                className={inputClasses}
                                                placeholder="VD: Men rạn, Men lam, Vẽ vàng..."
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Ảnh đại diện</label>
                                            <div className="flex gap-2">
                                                <label className="h-10 px-4 rounded-sm border border-primary/20 bg-white text-primary text-[12px] font-black uppercase tracking-wider inline-flex items-center gap-2 cursor-pointer hover:bg-primary/[0.02]">
                                                    <span className="material-symbols-outlined text-[18px]">upload</span>
                                                    Tải ảnh
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => handleImageUpload(e, (url) => setQuoteTemplateDraft((prev) => ({ ...prev, image_url: url })))}
                                                    />
                                                </label>
                                                {quoteTemplateDraft.image_url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setQuoteTemplateDraft((prev) => ({ ...prev, image_url: '' }))}
                                                        className="h-10 px-4 rounded-sm border border-brick/20 bg-white text-brick text-[12px] font-black uppercase tracking-wider"
                                                    >
                                                        Xóa ảnh
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleCreateQuoteTemplate}
                                            disabled={savingQuoteTemplateId === 'draft'}
                                            className="h-10 px-5 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            {savingQuoteTemplateId === 'draft' ? 'Đang lưu...' : 'Thêm mẫu'}
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {quoteTemplates.length === 0 ? (
                                            <div className="border border-primary/10 rounded-sm px-4 py-10 text-center text-[13px] text-primary/35 italic">
                                                Chưa có bộ / mẫu báo giá nào.
                                            </div>
                                        ) : quoteTemplates.map((template) => (
                                            <div key={template.id} className="grid grid-cols-[240px_minmax(0,1fr)] gap-5 border border-primary/10 rounded-sm p-4">
                                                <ImageUploadCard
                                                    imageUrl={template.image_url}
                                                    onUpload={(e) => handleImageUpload(e, (url) => updateQuoteTemplateState(template.id, { image_url: url }))}
                                                    onRemove={() => updateQuoteTemplateState(template.id, { image_url: '' })}
                                                    emptyLabel="Tải ảnh đại diện bộ / mẫu"
                                                    previewClassName="h-44"
                                                />

                                                <div className="space-y-4">
                                                    <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-4">
                                                        <div>
                                                            <label className={labelClasses}>Tên bộ / mẫu</label>
                                                            <input
                                                                type="text"
                                                                value={template.name || ''}
                                                                onChange={(e) => updateQuoteTemplateState(template.id, { name: e.target.value })}
                                                                className={inputClasses}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelClasses}>Thứ tự</label>
                                                            <input
                                                                type="number"
                                                                value={template.sort_order ?? 0}
                                                                onChange={(e) => updateQuoteTemplateState(template.id, { sort_order: e.target.value })}
                                                                className={inputClasses}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelClasses}>Trạng thái</label>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateQuoteTemplateState(template.id, { is_active: !template.is_active })}
                                                                className={`w-full h-10 rounded-sm border text-[12px] font-black uppercase tracking-wider transition-all ${template.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-stone-50 text-primary/40'}`}
                                                            >
                                                                {template.is_active ? 'Đang dùng' : 'Tạm tắt'}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="text-[12px] text-primary/45 leading-5">
                                                            Ảnh này sẽ được dùng làm ảnh đại diện bên trái trong ảnh báo giá khi chọn đúng bộ / mẫu ở màn hình đơn hàng.
                                                        </p>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteQuoteTemplate(template.id)}
                                                                disabled={savingQuoteTemplateId === template.id}
                                                                className="h-10 px-4 rounded-sm border border-brick/20 bg-white text-brick text-[12px] font-black uppercase tracking-wider hover:bg-brick hover:text-white transition-all disabled:opacity-50"
                                                            >
                                                                Xóa
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSaveQuoteTemplate(template)}
                                                                disabled={savingQuoteTemplateId === template.id}
                                                                className="h-10 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50"
                                                            >
                                                                {savingQuoteTemplateId === template.id ? 'Đang lưu...' : 'Lưu mẫu'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SiteSettings;
