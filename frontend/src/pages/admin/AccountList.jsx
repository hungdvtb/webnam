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
            } else if (formMode === 'create_super') {
                const payload = {
                    account_name: formData.name,
                    domain: formData.domain || null,
                    subdomain: formData.subdomain || null,
                    site_code: formData.site_code || null,
                    ai_api_key: formData.ai_api_key,
                    user_name: formData.user_name,
                    user_email: formData.user_email,
                    user_password: formData.user_password
                };
                await accountApi.storeWithUser(payload);
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

    const handleDelete = async (id) => {
        if (window.confirm("Bạn có chắc chắn muốn xoá cửa hàng này?")) {
            try {
                await accountApi.destroy(id);
                fetchAccounts();
            } catch (error) {
                alert("Không thể xoá cửa hàng này.");
            }
        }
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
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center bg-white p-6 shadow-sm border border-gold/10">
                <div>
                    <h2 className="text-2xl font-display font-bold text-primary uppercase">Quản lý Cửa Hàng (Accounts)</h2>
                    <p className="text-stone font-body text-sm italic mt-1">Giám sát các chi nhánh, cấu hình tên miền hệ thống.</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={() => openNewForm(false)}
                        className="bg-primary text-white px-6 py-2 uppercase font-ui font-bold text-xs tracking-widest hover:bg-umber transition-all flex items-center gap-2 shadow-md shadow-primary/20"
                    >
                        <span className="material-symbols-outlined text-sm">add</span> Cửa Hàng Của Mình
                    </button>
                    {user?.is_admin && (
                        <button
                            onClick={() => openNewForm(true)}
                            className="bg-gold text-white px-6 py-2 uppercase font-ui font-bold text-xs tracking-widest hover:bg-gold/80 transition-all flex items-center gap-2 shadow-md shadow-gold/20"
                        >
                            <span className="material-symbols-outlined text-sm">add_business</span> Tạo Account (Super Admin)
                        </button>
                    )}
                </div>
            </div>

            {isFormOpen && (
                <div className="bg-white p-6 shadow-sm border border-gold/10 relative">
                    <button onClick={() => setIsFormOpen(false)} className="absolute top-4 right-4 text-stone hover:text-brick">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                    <h3 className="font-ui font-bold text-primary uppercase tracking-widest border-b border-gold/20 pb-4 mb-6">
                        {formMode === 'edit' ? 'Sửa thông tin cửa hàng' : (formMode === 'create_super' ? 'Tạo Cửa Hàng + Tài Khoản Admin Mới (Super Admin)' : 'Cấu hình cửa hàng của bạn')}
                    </h3>

                    <form onSubmit={handleFormSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1">
                                <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Tên Cửa Hàng</label>
                                <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" placeholder="VD: Chi nhánh Hà Nội" />
                            </div>

                            <div className="space-y-1">
                                <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Mã Nhận Diện (Site Code)</label>
                                <input type="text" value={formData.site_code} onChange={e => setFormData({ ...formData, site_code: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-mono" placeholder="VD: GOM_DAI_THANH_01" />
                            </div>

                            <div className="space-y-1">
                                <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Tên Miền (Custom Domain)</label>
                                <input type="text" value={formData.domain} onChange={e => setFormData({ ...formData, domain: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" placeholder="VD: store.com" />
                            </div>

                            <div className="space-y-1">
                                <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Tên miền phụ (Subdomain)</label>
                                <input type="text" value={formData.subdomain} onChange={e => setFormData({ ...formData, subdomain: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" placeholder="VD: shop-hanoi" />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-wider text-gold flex items-center gap-2">
                                    <span className="material-symbols-outlined text-sm">key</span>
                                    Gemini AI API Key (Cho tính năng Chat Tư Vấn)
                                </label>
                                <input
                                    type="text"
                                    value={formData.ai_api_key}
                                    onChange={e => setFormData({ ...formData, ai_api_key: e.target.value })}
                                    className="w-full bg-gold/5 border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-mono"
                                    placeholder="Dán API Key từ Google AI Studio tại đây..."
                                />
                                <p className="text-[10px] text-stone mt-1 italic">Mỗi cửa hàng có thể dùng API Key riêng để quản lý chi phí & bảo mật.</p>
                            </div>
                        </div>

                        {formMode === 'create_super' && (
                            <div className="border border-gold/20 p-6 bg-background-light mt-6 space-y-4">
                                <h4 className="font-ui font-bold text-gold uppercase text-sm border-b border-gold/20 pb-2 mb-4">Thông tin Tài Khoản Owner (Tạo Tự Động)</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-1">
                                        <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Họ Tên Đầu Mối</label>
                                        <input required type="text" value={formData.user_name} onChange={e => setFormData({ ...formData, user_name: e.target.value })} className="w-full bg-white border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" placeholder="VD: Nguyễn Văn A" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Email Đăng Nhập</label>
                                        <input required type="email" value={formData.user_email} onChange={e => setFormData({ ...formData, user_email: e.target.value })} className="w-full bg-white border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" placeholder="VD: abc@store.com" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Mật Khẩu Mặc Định</label>
                                        <input required type="text" minLength="6" value={formData.user_password} onChange={e => setFormData({ ...formData, user_password: e.target.value })} className="w-full bg-white border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" placeholder="Tối thiểu 6 ký tự" />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="pt-4 border-t border-gold/10 flex justify-end gap-3">
                            <button type="button" onClick={() => setIsFormOpen(false)} className="px-8 py-3 font-ui text-xs font-bold uppercase tracking-widest text-stone hover:text-primary transition-colors">Hủy</button>
                            <button type="submit" className="bg-primary text-white px-8 py-3 font-ui text-xs font-bold uppercase tracking-widest hover:bg-umber transition-colors shadow-lg shadow-primary/20">
                                {formMode === 'edit' ? 'Cập Nhật Cửa Hàng' : (formMode === 'create_super' ? 'Tạo Cửa Hàng & Account Admin' : 'Tạo Cửa Hàng Mới')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="text-center py-20">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {accounts.map(acc => (
                        <div key={acc.id} className="bg-white border border-gold/20 shadow-sm p-6 hover:shadow-md hover:border-gold/40 transition-all relative group flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start mb-4">
                                    <div className="size-12 bg-background-light border border-gold/20 rounded-full flex items-center justify-center text-primary shrink-0 shadow-inner">
                                        <span className="material-symbols-outlined">store</span>
                                    </div>
                                    <span className={`px-2 py-1 text-[10px] uppercase font-bold tracking-wider ${acc.status ? 'bg-primary/10 text-primary' : 'bg-brick/10 text-brick'}`}>
                                        {acc.status ? 'Hoạt động' : 'Tạm dừng'}
                                    </span>
                                </div>

                                <h3 className="text-xl font-display font-bold text-primary mb-1">{acc.name}</h3>
                                {acc.site_code && (
                                    <div className="inline-block bg-gold/10 text-gold px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded mt-1">
                                        CODE: {acc.site_code}
                                    </div>
                                )}

                                <div className="space-y-2 mt-4 font-body text-sm text-stone border-t border-gold/10 pt-4 cursor-text">
                                    {acc.domain && (
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm text-gold">language</span>
                                            <a href={`http://${acc.domain}`} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors hover:underline" onClick={e => e.stopPropagation()}>
                                                {acc.domain}
                                            </a>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm text-gold">link</span>
                                        <span className="font-mono text-xs">{acc.subdomain}.webnam.com</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm text-gold">manage_accounts</span>
                                        <span>User quản lý: <b>{acc.users?.length || 0}</b> người</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gold/5">
                                        <span className={`material-symbols-outlined text-sm ${acc.ai_api_key ? 'text-green-600' : 'text-stone opacity-50'}`}>
                                            {acc.ai_api_key ? 'verified_user' : 'no_encryption'}
                                        </span>
                                        <span className={`text-[10px] font-bold uppercase tracking-widest ${acc.ai_api_key ? 'text-green-600' : 'text-stone opacity-50'}`}>
                                            AI Key: {acc.ai_api_key ? 'Đã thiết lập' : 'Chưa cấu hình'}
                                        </span>
                                    </div>
                                    {user?.is_admin && acc.users?.length > 0 && (
                                        <div className="flex flex-col gap-1 mt-2 text-xs border-t border-gold/5 pt-2">
                                            {acc.users.map(u => (
                                                <div key={u.id} className="text-stone">✦ {u.email} <span className="opacity-60 text-[9px]">({u.pivot?.role})</span></div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6 border-t border-gold/10 pt-4 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEdit(acc)} className="text-stone hover:text-primary flex items-center gap-1 text-[10px] font-bold uppercase transition-colors">
                                    <span className="material-symbols-outlined text-xs">edit</span> Sửa
                                </button>
                                <button onClick={() => handleDelete(acc.id)} className="text-stone hover:text-brick flex items-center gap-1 text-[10px] font-bold uppercase transition-colors">
                                    <span className="material-symbols-outlined text-xs">delete</span> Xóa
                                </button>
                            </div>
                        </div>
                    ))}

                    {accounts.length === 0 && (
                        <div className="col-span-full py-20 text-center text-stone italic border-2 border-dashed border-gold/10 bg-white shadow-inner">
                            Bạn chưa quản lý tài khoản/cửa hàng nào.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AccountList;
