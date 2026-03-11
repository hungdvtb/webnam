import React, { useState, useEffect } from 'react';
import { accountApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const AccountList = () => {
    const { user } = useAuth();
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);

    // Mode can be: 'edit', 'create_normal', 'create_super'
    const [formMode, setFormMode] = useState('create_normal');

    const [formData, setFormData] = useState({
        id: null,
        name: '',
        domain: '',
        subdomain: '',
        site_code: '',
        status: true,
        ai_api_key: '',
        user_name: '',
        user_email: '',
        user_password: ''
    });

    const fetchAccounts = async () => {
        setLoading(true);
        try {
            const res = await accountApi.getAll();
            setAccounts(res.data);
        } catch (error) {
            console.error('Lỗi khi tải danh sách cửa hàng:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isFormOpen) {
                setIsFormOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFormOpen]);

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        try {
            if (formMode === 'edit') {
                const payload = {
                    name: formData.name,
                    domain: formData.domain || null,
                    subdomain: formData.subdomain || null,
                    site_code: formData.site_code || null,
                    status: formData.status,
                    ai_api_key: formData.ai_api_key
                };
                await accountApi.update(formData.id, payload);
            } else {
                const payload = {
                    name: formData.name,
                    domain: formData.domain || null,
                    subdomain: formData.subdomain || null,
                    site_code: formData.site_code || null,
                    status: formData.status,
                    ai_api_key: formData.ai_api_key
                };
                await accountApi.store(payload);
            }

            setIsFormOpen(false);
            fetchAccounts();
        } catch (error) {
            console.error('Lỗi khi lưu cửa hàng:', error);
            alert('Lỗi: ' + (error.response?.data?.message || 'Có thể email, domain hoặc subdomain đã tồn tại.'));
        }
    };

    const handleEdit = (acc) => {
        setFormData({
            ...formData,
            id: acc.id,
            name: acc.name,
            domain: acc.domain || '',
            subdomain: acc.subdomain || '',
            site_code: acc.site_code || '',
            status: acc.status,
            ai_api_key: acc.ai_api_key || ''
        });
        setFormMode('edit');
        setIsFormOpen(true);
    };

    const handleToggleStatus = async (acc) => {
        if (window.confirm(`Bạn có chắc chắn muốn ${acc.status ? 'ẩn' : 'hiện'} cửa hàng này?`)) {
            try {
                const payload = {
                    name: acc.name,
                    domain: acc.domain || null,
                    subdomain: acc.subdomain || null,
                    site_code: acc.site_code || null,
                    status: !acc.status,
                    ai_api_key: acc.ai_api_key
                };
                await accountApi.update(acc.id, payload);
                fetchAccounts();
            } catch (error) {
                alert("Không thể cập nhật trạng thái cửa hàng.");
            }
        }
    };

    const handleAccess = (id) => {
        localStorage.setItem('activeAccountId', id);
        window.location.href = '/admin';
    };

    const openNewForm = (isSuperAdminCreate = false) => {
        setFormData({
            id: null,
            name: '',
            domain: '',
            subdomain: '',
            site_code: '',
            status: true,
            user_name: '',
            user_email: '',
            user_password: ''
        });
        setFormMode(isSuperAdminCreate ? 'create_super' : 'create_normal');
        setIsFormOpen(true);
    };

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
                        <h1 className="text-2xl font-display font-bold text-primary italic">Danh sách cửa hàng</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Quản lý các chi nhánh và kênh bán hàng của bạn</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <button
                            onClick={() => openNewForm(false)}
                            className="bg-brick text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Thêm cửa hàng mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                        <button
                            onClick={fetchAccounts}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                        {accounts.length} Cửa hàng đang quản lý
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto custom-scrollbar relative">
                {isFormOpen && (
                    <div className="absolute inset-0 z-50 bg-[#fcfcfa]/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white border border-gold/20 shadow-[0_15px_50px_-12px_rgba(0,0,0,0.25)] w-full max-w-2xl mx-auto rounded-md overflow-hidden flex flex-col">
                            <div className="flex-none px-6 py-4 bg-gold/5 border-b border-gold/10 flex justify-between items-center">
                                <h2 className="font-display text-lg font-bold text-primary uppercase italic">
                                    {formMode === 'edit' ? 'Cấu Hình Cửa Hàng' : 'Khởi Tạo Cửa Hàng'}
                                </h2>
                                <button
                                    onClick={() => setIsFormOpen(false)}
                                    className="w-8 h-8 flex items-center justify-center text-stone/40 hover:text-brick hover:bg-brick/5 transition-all rounded-full"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                                <form onSubmit={handleFormSubmit} id="account-form" className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Tên Cửa Hàng</label>
                                        <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Mã Nhận Diện (Site Code)</label>
                                        <input type="text" value={formData.site_code} onChange={e => setFormData({ ...formData, site_code: e.target.value })} className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-mono text-xs rounded-sm" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Tên Miền (Custom Domain)</label>
                                        <input type="text" value={formData.domain} onChange={e => setFormData({ ...formData, domain: e.target.value })} className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Subdomain</label>
                                        <input type="text" value={formData.subdomain} onChange={e => setFormData({ ...formData, subdomain: e.target.value })} className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm" />
                                    </div>
                                    <div className="md:col-span-2 space-y-1.5 bg- gold/5 p-4 border border-gold/10 rounded-sm">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                            <span className="material-symbols-outlined text-[16px]">key</span>
                                            Gemini AI API Key
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.ai_api_key}
                                            onChange={e => setFormData({ ...formData, ai_api_key: e.target.value })}
                                            className="w-full bg-white border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-mono text-xs rounded-sm"
                                            placeholder="Paste Key here..."
                                        />
                                        <p className="text-[9px] text-stone/40 italic font-medium">Cấu hình riêng để sử dụng tính năng AI Advisor cho cửa hàng này.</p>
                                    </div>
                                </form>
                            </div>

                            <div className="flex-none px-6 py-4 bg-stone/5 border-t border-gold/10 flex justify-end gap-3">
                                <button type="button" onClick={() => setIsFormOpen(false)} className="px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-stone-500 hover:bg-stone/10 transition-all border border-stone/20 rounded-sm">Hủy</button>
                                <button form="account-form" type="submit" className="px-8 py-2 bg-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-umber transition-all shadow-sm rounded-sm">
                                    {formMode === 'edit' ? 'Lưu cập nhật' : 'Khởi tạo ngay'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                        <span className="text-[11px] font-black text-stone/30 uppercase tracking-[0.2em]">Đang tải dữ liệu...</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-1">
                        {accounts.map(acc => (
                            <div key={acc.id} className="bg-white border border-gold/10 rounded-sm shadow-sm p-5 hover:border-gold/40 transition-all group flex flex-col justify-between relative">
                                <div className="absolute top-4 right-4 bg-stone/5 border border-stone/10 px-2 py-0.5 rounded-full z-10">
                                    <span className={`text-[8px] font-black uppercase tracking-widest ${acc.status ? 'text-green-600' : 'text-brick'}`}>
                                        {acc.status ? 'Online' : 'Offline'}
                                    </span>
                                </div>

                                <div>
                                    <div className="size-10 bg-gold/5 border border-gold/10 rounded-sm flex items-center justify-center text-primary mb-4">
                                        <span className="material-symbols-outlined text-[20px]">storefront</span>
                                    </div>
                                    <h3 className="text-[15px] font-display font-bold text-primary group-hover:text-umber transition-colors uppercase tracking-tight leading-tight">{acc.name}</h3>
                                    {acc.site_code && (
                                        <div className="text-[9px] font-black text-stone/40 bg-stone/5 px-1.5 py-0.5 rounded border border-stone/10 tracking-[0.1em] uppercase italic mt-1.5 inline-block">
                                            Site: {acc.site_code}
                                        </div>
                                    )}

                                    <div className="mt-5 space-y-2 pt-4 border-t border-gold/5">
                                        <div className="flex items-center gap-2.5 text-[12px] text-stone-600">
                                            <span className="material-symbols-outlined text-[16px] text-gold/60">link</span>
                                            <span className="font-mono text-[11px] truncate w-full">{acc.subdomain}.webnam.com</span>
                                        </div>
                                        {acc.domain && (
                                            <div className="flex items-center gap-2.5 text-[12px] text-stone-600">
                                                <span className="material-symbols-outlined text-[16px] text-gold/60">language</span>
                                                <span className="truncate hover:text-primary cursor-pointer w-full italic" onClick={() => window.open(`http://${acc.domain}`, '_blank')}>
                                                    {acc.domain}
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2.5 text-[12px] text-stone-600">
                                            <span className="material-symbols-outlined text-[16px] text-gold/60">group</span>
                                            <span className="font-body"><b>{acc.users?.length || 0}</b> quản trị viên</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-6 flex items-center justify-between gap-2 border-t border-stone/5 pt-4">
                                    <button onClick={() => handleAccess(acc.id)} className="flex-1 h-8 bg-gold text-white hover:bg-primary transition-all flex items-center justify-center gap-1.5 rounded-sm shadow-sm text-[10px] font-black uppercase tracking-widest active:scale-95">
                                        <span className="material-symbols-outlined text-[14px]">login</span>
                                        Truy cập
                                    </button>
                                    <div className="flex gap-1.5">
                                        <button onClick={() => handleEdit(acc)} className="size-8 border border-gold/30 text-gold hover:bg-gold hover:text-white transition-all flex items-center justify-center rounded-sm" title="Chỉnh sửa">
                                            <span className="material-symbols-outlined text-[16px]">edit</span>
                                        </button>
                                        <button onClick={() => handleToggleStatus(acc)} className="size-8 border border-brick/30 text-brick hover:bg-brick hover:text-white transition-all flex items-center justify-center rounded-sm" title={acc.status ? "Tạm khóa" : "Kích hoạt"}>
                                            <span className="material-symbols-outlined text-[16px]">{acc.status ? 'visibility_off' : 'visibility'}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {accounts.length === 0 && (
                            <div className="col-span-full py-20 flex flex-col items-center justify-center gap-3 opacity-20">
                                <span className="material-symbols-outlined text-[64px]">store_slash</span>
                                <span className="text-[14px] font-bold uppercase tracking-widest italic">Bạn chưa quản lý tài khoản nào</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AccountList;
