import React, { useState, useEffect, useCallback } from 'react';
import { cmsApi, mediaApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { motion, AnimatePresence } from 'framer-motion';

const SiteSettings = () => {
    const { showModal } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('contact');
    const [settings, setSettings] = useState({
        site_name: '',
        contact_phone: '',
        contact_email: '',
        facebook_link: '',
        zalo_link: '',
        messenger_link: '',
        tiktok_link: '',
        youtube_link: '',
        // Pixel & Tracking
        fb_pixel_id: '',
        fb_pixel_active: false,
        ga_id: '',
        ga_active: false,
        tt_pixel_id: '',
        tt_pixel_active: false,
        // Bank Information
        bank_name: '',
        bank_account_number: '',
        bank_account_name: '',
        bank_transfer_template: 'Thanh toan don hang {order_number}',
        bank_qr_code: '',
    });

    const [domains, setDomains] = useState([]);
    const [newDomain, setNewDomain] = useState('');
    const [editingDomain, setEditingDomain] = useState(null);

    const activeAccountId = localStorage.getItem('activeAccountId');

    const fetchDomains = useCallback(async () => {
        try {
            const response = await cmsApi.domains.getAll();
            setDomains(response.data);
        } catch (error) {
            console.error("Error fetching domains", error);
        }
    }, []);

    const fetchSettings = useCallback(async () => {
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
    }, []);

    useEffect(() => {
        fetchSettings();
        fetchDomains();
    }, [fetchSettings, fetchDomains]);

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
            showModal({ title: 'Lỗi', content: 'Vui lòng chọn Account Id trước khi lưu.', type: 'error' });
            return;
        }

        setSaving(true);
        try {
            await cmsApi.settings.update({
                account_id: activeAccountId,
                settings: settings
            });
            showModal({ title: 'Thành công', content: 'Đã lưu cài đặt.', type: 'success' });
        } catch (error) {
            console.error("Error saving settings", error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu cài đặt.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    // Domain handlers
    const handleAddDomain = async () => {
        if (!newDomain) return;
        try {
            await cmsApi.domains.store({ domain: newDomain, is_default: domains.length === 0 });
            setNewDomain('');
            fetchDomains();
            showModal({ title: 'Thành công', content: 'Đã thêm tên miền mới.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: error.response?.data?.message || 'Không thể thêm tên miền.', type: 'error' });
        }
    };

    const handleToggleActive = async (domain) => {
        if (domain.is_default && domain.is_active) {
            showModal({ title: 'Cảnh báo', content: 'Không thể tắt tên miền mặc định. Vui lòng thiết lập tên miền khác làm mặc định trước.', type: 'error' });
            return;
        }
        try {
            await cmsApi.domains.update(domain.id, { ...domain, is_active: !domain.is_active });
            fetchDomains();
            showModal({ title: 'Thành công', content: `Đã ${!domain.is_active ? 'kích hoạt' : 'tạm dừng'} tên miền.`, type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái.', type: 'error' });
        }
    };

    const handleSetDefault = async (domainId) => {
        try {
            await cmsApi.domains.update(domainId, { is_default: true });
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể thiết lập mặc định.', type: 'error' });
        }
    };

    const handleDeleteDomain = async (id) => {
        if (!window.confirm('Bạn có chắc muốn xóa tên miền này?')) return;
        try {
            await cmsApi.domains.destroy(id);
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể xóa tên miền.', type: 'error' });
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const inputClasses = "w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20";
    const labelClasses = "text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block";

    return (
        <div className="flex flex-col bg-[#fcfcfa] animate-fade-in p-6 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                `}
            </style>

            {/* Header Area */}
            <div className="flex justify-between items-center mb-8">
                <div className="flex flex-col">
                    <h1 className="text-2xl font-black text-primary uppercase tracking-tight italic">Cài đặt web</h1>
                    <p className="text-[10px] font-black text-primary/40 uppercase tracking-[0.2em] mt-1 italic font-sans">Quản lý định danh, liên lạc và tài chính</p>
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
                        LƯU THAY ĐỔI
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-8 mb-6 border-b border-primary/10">
                {[
                    { id: 'contact', title: 'Liên hệ & Mạng xã hội', icon: 'contact_support' },
                    { id: 'pixel', title: 'Pixel & Tracking', icon: 'analytics' },
                    { id: 'domains', title: 'Quản lý tên miền', icon: 'language' },
                    { id: 'bank', title: 'Cài đặt STK', icon: 'account_balance' }
                ].map(tab => (
                    <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative flex items-center gap-2 ${activeTab === tab.id ? 'text-primary' : 'text-primary/40 hover:text-primary/70'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                        {tab.title}
                        {activeTab === tab.id && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-12">
                <div className="max-w-5xl space-y-6">
                    {/* CONTACT TAB */}
                    {activeTab === 'contact' && (
                        <div className="space-y-6">
                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">person_pin</span>
                                    <h2 className="text-[13px] font-black text-primary uppercase">Kênh liên lạc chính</h2>
                                </div>
                                <div className="p-6 grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên Website / Thương hiệu</label>
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
                            </div>

                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">share</span>
                                    <h2 className="text-[13px] font-black text-primary uppercase">Liên đề mạng xã hội & Nút nổi</h2>
                                </div>
                                <div className="p-6 grid grid-cols-2 gap-6">
                                    <div className="space-y-1">
                                        <label className={labelClasses}>Zalo URL (Số điện thoại hoặc Link)</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/30 font-bold text-[12px]">Zalo.me/</span>
                                            <input type="text" name="zalo_link" value={settings.zalo_link} onChange={handleChange} className={`${inputClasses} pl-[65px]`} placeholder="0123456789" />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className={labelClasses}>Facebook Page URL</label>
                                        <input type="text" name="facebook_link" value={settings.facebook_link} onChange={handleChange} className={inputClasses} placeholder="https://facebook.com/yourpage" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={labelClasses}>Messenger URL</label>
                                        <input type="text" name="messenger_link" value={settings.messenger_link} onChange={handleChange} className={inputClasses} placeholder="https://m.me/yourid" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={labelClasses}>TikTok URL</label>
                                        <input type="text" name="tiktok_link" value={settings.tiktok_link} onChange={handleChange} className={inputClasses} placeholder="https://tiktok.com/@yourid" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className={labelClasses}>YouTube Channel URL</label>
                                        <input type="text" name="youtube_link" value={settings.youtube_link} onChange={handleChange} className={inputClasses} placeholder="https://youtube.com/@yourchannel" />
                                    </div>
                                </div>
                                <div className="mx-6 mb-6 p-4 bg-primary/[0.02] border border-primary/5 rounded-sm">
                                    <p className="text-[11px] text-primary/60 italic">** Các link trên sẽ được sử dụng để hiển thị các nút liên hệ nổi (Floating Buttons) trên website chính để khách hàng có thể liên hệ trực tiếp với bạn qua Messenger, Zalo, v.v.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PIXEL & TRACKING TAB */}
                    {activeTab === 'pixel' && (
                        <div className="space-y-6">
                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary text-[20px]">ads_click</span>
                                        <h2 className="text-[13px] font-black text-primary uppercase">Facebook Pixel</h2>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] font-black uppercase ${settings.fb_pixel_active ? 'text-green-500' : 'text-primary/30'}`}>
                                            {settings.fb_pixel_active ? 'Đang bật' : 'Đang tắt'}
                                        </span>
                                        <button 
                                            onClick={() => setSettings(prev => ({ ...prev, fb_pixel_active: !prev.fb_pixel_active }))}
                                            className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.fb_pixel_active ? 'bg-green-500' : 'bg-stone-300'}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.fb_pixel_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <label className={labelClasses}>Facebook Pixel ID</label>
                                    <input 
                                        type="text" 
                                        name="fb_pixel_id" 
                                        value={settings.fb_pixel_id} 
                                        onChange={handleChange} 
                                        className={inputClasses} 
                                        placeholder="VD: 123456789012345" 
                                    />
                                    <p className="text-[10px] text-primary/40 mt-2 italic font-medium">Hệ thống sẽ tự động chèn script vào thẻ {'<head>'} khi bạn bật trạng thái.</p>
                                </div>
                            </div>

                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary text-[20px]">analytics</span>
                                        <h2 className="text-[13px] font-black text-primary uppercase">Google Analytics</h2>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] font-black uppercase ${settings.ga_active ? 'text-green-500' : 'text-primary/30'}`}>
                                            {settings.ga_active ? 'Đang bật' : 'Đang tắt'}
                                        </span>
                                        <button 
                                            onClick={() => setSettings(prev => ({ ...prev, ga_active: !prev.ga_active }))}
                                            className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.ga_active ? 'bg-green-500' : 'bg-stone-300'}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.ga_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <label className={labelClasses}>Google Tracking ID (G-XXXXX)</label>
                                    <input 
                                        type="text" 
                                        name="ga_id" 
                                        value={settings.ga_id} 
                                        onChange={handleChange} 
                                        className={inputClasses} 
                                        placeholder="VD: G-H1J2K3L4" 
                                    />
                                </div>
                            </div>

                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary text-[20px]">music_note</span>
                                        <h2 className="text-[13px] font-black text-primary uppercase">TikTok Pixel</h2>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] font-black uppercase ${settings.tt_pixel_active ? 'text-green-500' : 'text-primary/30'}`}>
                                            {settings.tt_pixel_active ? 'Đang bật' : 'Đang tắt'}
                                        </span>
                                        <button 
                                            onClick={() => setSettings(prev => ({ ...prev, tt_pixel_active: !prev.tt_pixel_active }))}
                                            className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.tt_pixel_active ? 'bg-green-500' : 'bg-stone-300'}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.tt_pixel_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <label className={labelClasses}>TikTok Pixel ID</label>
                                    <input 
                                        type="text" 
                                        name="tt_pixel_id" 
                                        value={settings.tt_pixel_id} 
                                        onChange={handleChange} 
                                        className={inputClasses} 
                                        placeholder="VD: C1234567890ABCDE" 
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DOMAINS TAB */}
                    {activeTab === 'domains' && (
                        <div className="space-y-6">
                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary text-[20px]">language</span>
                                        <h2 className="text-[13px] font-black text-primary uppercase">Thêm tên miền mới</h2>
                                    </div>
                                </div>
                                <div className="p-6 flex gap-4">
                                    <div className="flex-1">
                                        <input 
                                            type="text" 
                                            value={newDomain} 
                                            onChange={(e) => setNewDomain(e.target.value)} 
                                            className={inputClasses} 
                                            placeholder="VD: gômdaithanh.vn hoặc shop.gomdaithanh.com"
                                            onKeyPress={(e) => e.key === 'Enter' && handleAddDomain()}
                                        />
                                    </div>
                                    <button 
                                        onClick={handleAddDomain}
                                        className="bg-primary text-white p-2 px-6 rounded-sm font-bold text-[13px] hover:bg-gold transition-colors flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">add</span>
                                        THÊM
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
                                <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">list</span>
                                    <h2 className="text-[13px] font-black text-primary uppercase">Danh sách tên miền của bạn</h2>
                                </div>
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
                                            ) : domains.map(domain => (
                                                <tr key={domain.id} className="hover:bg-primary/[0.01] transition-colors">
                                                    <td className="px-6 py-4">
                                                        <span className="text-[13px] font-bold text-primary">{domain.domain}</span>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex justify-center">
                                                            <button 
                                                                onClick={() => handleToggleActive(domain)}
                                                                className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${domain.is_active ? 'bg-green-500' : 'bg-stone-300'}`}
                                                            >
                                                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${domain.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        {domain.is_default ? (
                                                            <span className="material-symbols-outlined text-gold text-[20px]">verified</span>
                                                        ) : (
                                                            <button 
                                                                onClick={() => handleSetDefault(domain.id)}
                                                                className="text-[10px] font-black uppercase text-primary/30 hover:text-gold transition-colors underline underline-offset-4"
                                                            >
                                                                Đặt mặc định
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button 
                                                                onClick={() => handleDeleteDomain(domain.id)}
                                                                className="size-8 rounded-sm border border-brick/20 text-brick flex items-center justify-center hover:bg-brick hover:text-white transition-all shadow-sm"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* BANK TAB */}
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
