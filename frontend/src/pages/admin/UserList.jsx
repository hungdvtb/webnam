import React, { useState, useEffect } from 'react';
import { userApi, accountApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const PAGE_PERMISSIONS = [
    { id: 'dashboard', label: 'Tổng quan' },
    { id: 'accounts', label: 'Danh sách cửa hàng' },
    { id: 'products', label: 'Quản lý sản phẩm' },
    { id: 'categories', label: 'Danh mục sản phẩm' },
    { id: 'orders', label: 'Quản lý đơn hàng (Đơn hàng)' },
    { id: 'customers', label: 'Quản lý khách hàng' },
    { id: 'inventory', label: 'Quản lý Tồn kho' },
    { id: 'warehouses', label: 'Quản lý Kho vận' },
    { id: 'attributes', label: 'Thuộc tính' },
    { id: 'settings', label: 'Cấu hình Website' },
    { id: 'menus', label: 'Menu & Điều hướng' },
    { id: 'banners', label: 'Banner & Quảng cáo' },
    { id: 'users', label: 'Quản lý Người dùng' },
];

const UserList = () => {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [formMode, setFormMode] = useState('create');

    const [formData, setFormData] = useState({
        id: null,
        name: '',
        email: '',
        password: '',
        status: 1,
        permissions: [],
        account_ids: []
    });

    useEffect(() => {
        fetchInitialData();
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

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [uRes, aRes] = await Promise.all([
                userApi.getAll(),
                accountApi.getAll()
            ]);
            setUsers(uRes.data);
            setAccounts(aRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        try {
            if (formMode === 'create') {
                await userApi.store(formData);
            } else {
                await userApi.update(formData.id, formData);
            }
            setIsFormOpen(false);
            fetchInitialData();
        } catch (error) {
            console.error('Lỗi khi lưu user:', error);
            alert('Lỗi: ' + (error.response?.data?.message || 'Có lỗi xảy ra. Vui lòng kiểm tra lại email.'));
        }
    };

    const handleEdit = (u) => {
        let perms = [];
        try {
            perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions || []);
        } catch(e) {}
        
        setFormData({
            id: u.id,
            name: u.name,
            email: u.email,
            password: '', // blank password on edit means no change
            status: u.status,
            permissions: perms,
            account_ids: u.accounts?.map(acc => acc.id) || []
        });
        setFormMode('edit');
        setIsFormOpen(true);
    };

    const openNewForm = () => {
        setFormData({
            id: null,
            name: '',
            email: '',
            password: '',
            status: 1,
            permissions: [],
            account_ids: []
        });
        setFormMode('create');
        setIsFormOpen(true);
    };

    const handleDelete = async (id, name) => {
        if (window.confirm(`Bạn có chắc muốn xoá tài khoản: ${name}?`)) {
            try {
                await userApi.destroy(id);
                fetchInitialData();
            } catch (error) {
                console.error('Lỗi khi xoá user:', error);
                alert('Lỗi: ' + (error.response?.data?.message || 'Không thể xoá tài khoản này.'));
            }
        }
    };

    const togglePermission = (permId) => {
        setFormData(prev => ({
            ...prev,
            permissions: prev.permissions.includes(permId)
                ? prev.permissions.filter(p => p !== permId)
                : [...prev.permissions, permId]
        }));
    };

    const toggleAccount = (accId) => {
        setFormData(prev => ({
            ...prev,
            account_ids: prev.account_ids.includes(accId)
                ? prev.account_ids.filter(id => id !== accId)
                : [...prev.account_ids, accId]
        }));
    };

    if (!currentUser?.is_admin) {
        return <div className="p-8 text-center text-brick">Bạn không có quyền truy cập trang này.</div>;
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
                        <h1 className="text-2xl font-display font-bold text-primary italic">Danh sách quản trị</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Phân quyền người dùng và phạm vi quản lý cửa hàng</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <button
                            onClick={openNewForm}
                            className="bg-primary text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Thêm quản trị viên"
                        >
                            <span className="material-symbols-outlined text-[18px]">person_add</span>
                        </button>
                        <button
                            onClick={fetchInitialData}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                        {users.length} tài quản quản trị hệ thống
                    </div>
                </div>
            </div>

            {/* Content Area - User Table */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[25%]">Nhân sự</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[25%]">Phạm vi quyền hạn</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[20%]">Token / Cửa hàng</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-center">Trạng thái</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-right text-gold/60">#</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                                </td>
                            </tr>
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center text-stone/40 font-bold uppercase tracking-widest italic text-xs">Chưa có quản trị viên</td>
                            </tr>
                        ) : (
                            users.map(u => {
                                let perms = [];
                                try { perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions || []); } catch(e){}
                                return (
                                    <tr key={u.id} className="hover:bg-gold/5 transition-all group active:bg-gold/10">
                                        <td className="px-4 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <div className="size-9 rounded-full bg-gold/5 border border-gold/20 flex items-center justify-center text-gold font-black text-xs shrink-0 group-hover:bg-gold group-hover:text-white transition-all">
                                                    {u.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-bold text-[14px] text-primary truncate group-hover:text-umber transition-colors leading-tight">{u.name}</span>
                                                    <span className="text-[10px] text-stone/40 font-ui truncate mt-0.5">{u.email}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3.5">
                                            {u.is_admin ? (
                                                <span className="px-2 py-0.5 bg-gold/10 text-gold text-[9px] font-black uppercase tracking-widest border border-gold/20 rounded-[2px]">Super Administrator</span>
                                            ) : (
                                                <div className="flex flex-wrap gap-1 max-w-[220px]">
                                                    {perms.length > 0 ? perms.slice(0,3).map(p => (
                                                        <span key={p} className="px-1.5 py-0.5 bg-[#fcf8f1] border border-gold/10 text-[8px] font-black uppercase tracking-tighter text-stone/50 hover:bg-gold/10 transition-colors">
                                                            {PAGE_PERMISSIONS.find(o => o.id === p)?.label.split(' (')[0] || p}
                                                        </span>
                                                    )) : <span className="text-brick/50 text-[10px] font-bold italic">Chưa cấp quyền</span>}
                                                    {perms.length > 3 && <span className="text-[9px] font-ui font-black text-gold/40">+{perms.length - 3}</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3.5">
                                            {u.is_admin ? (
                                                <span className="text-[11px] text-stone/30 italic font-medium uppercase tracking-tighter">Toàn quyền hệ thống</span>
                                            ) : (
                                                <div className="flex flex-col gap-0.5 max-h-12 overflow-hidden">
                                                    {u.accounts?.length > 0 ? u.accounts.slice(0, 2).map(acc => (
                                                        <div key={acc.id} className="flex items-center gap-1">
                                                            <div className="size-1 bg-gold/40 rounded-full shrink-0"></div>
                                                            <span className="text-[11px] font-bold text-primary/70 truncate">{acc.name}</span>
                                                        </div>
                                                    )) : <span className="text-brick/50 text-[10px] italic">Chưa gắn cửa hàng</span>}
                                                    {u.accounts?.length > 2 && <span className="text-[9px] text-stone/30 font-black pl-2">+{u.accounts.length - 2} more...</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3.5 text-center">
                                            <span className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest border rounded-[2px] ${u.status === 1 ? 'bg-primary/5 text-primary border-primary/20' : 'bg-brick/5 text-brick border-brick/20'}`}>
                                                {u.status === 1 ? 'Active' : 'Locked'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5 text-right">
                                            {!u.is_admin ? (
                                                <div className="flex items-center justify-end gap-1">
                                                    <button onClick={() => handleEdit(u)} className="size-8 flex items-center justify-center text-stone/30 hover:text-primary hover:bg-primary/5 rounded-sm transition-all active:scale-90" title="Phân quyền">
                                                        <span className="material-symbols-outlined text-[18px]">rule_settings</span>
                                                    </button>
                                                    <button onClick={() => handleDelete(u.id, u.name)} className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-sm transition-all active:scale-90" title="Xóa tài khoản">
                                                        <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="text-[10px] text-stone/20 font-black uppercase tracking-widest italic pr-2">Readonly</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Form Modal Overlay */}
            {isFormOpen && (
                <div className="fixed inset-0 z-[100] bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                    <div className="bg-[#fcfcfa] border border-gold/30 shadow-[0_20px_50px_rgba(0,0,0,0.3)] w-full max-w-4xl rounded-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                        <div className="px-8 py-5 bg-primary text-white flex justify-between items-center shrink-0">
                            <div className="flex flex-col">
                                <h3 className="font-display font-bold text-xl uppercase italic leading-none">{formMode === 'edit' ? 'Hiệu chỉnh đặc quyền' : 'Khai báo nhân sự mới'}</h3>
                                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mt-1.5">Phân định vai trò và phạm vi quản trị</p>
                            </div>
                            <button onClick={() => setIsFormOpen(false)} className="size-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <form onSubmit={handleFormSubmit} className="flex-1 overflow-auto custom-scrollbar p-8 space-y-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Họ tên nhân sự</label>
                                    <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: Nguyễn Thành Nam" />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Email / Account</label>
                                    <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: nam.nt@webnam.vn" />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">
                                        Mật mã truy cập {formMode === 'edit' && <span className="text-[9px] text-stone/30 font-black italic lowercase">(Để trống nếu giữ nguyên)</span>}
                                    </label>
                                    <input required={formMode === 'create'} minLength="6" type="text" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="Min. 6 chars" />
                                </div>

                                <div className="space-y-1.5 flex flex-col justify-end">
                                    <label className="flex items-center gap-3 cursor-pointer group bg-stone/5 border border-gold/20 p-3 rounded-sm hover:border-gold transition-all select-none">
                                        <div className={`size-5 border-2 rounded-sm flex items-center justify-center transition-all ${formData.status === 1 ? 'bg-primary border-primary' : 'bg-white border-gold/20'}`}>
                                            {formData.status === 1 && <span className="material-symbols-outlined text-white text-[16px] font-black">check</span>}
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            checked={formData.status === 1} 
                                            onChange={e => setFormData({...formData, status: e.target.checked ? 1 : 0})} 
                                            className="hidden"
                                        />
                                        <span className="font-ui text-[11px] font-black uppercase tracking-widest text-primary/60 group-hover:text-primary transition-colors">Cho phép hoạt động</span>
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <h4 className="font-display font-bold text-primary uppercase text-sm italic shrink-0">Phân quyền chức năng</h4>
                                    <div className="h-px bg-gold/20 flex-1"></div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {PAGE_PERMISSIONS.map(perm => (
                                        <label key={perm.id} className={`flex items-center gap-2.5 p-2.5 rounded-sm border transition-all cursor-pointer group ${formData.permissions.includes(perm.id) ? 'bg-gold/5 border-gold/30' : 'bg-white border-gold/10 hover:border-gold/30'}`}>
                                            <div className={`size-4 border rounded-[2px] flex items-center justify-center transition-all ${formData.permissions.includes(perm.id) ? 'bg-primary border-primary text-white scale-110' : 'bg-white border-gold/20'}`}>
                                                {formData.permissions.includes(perm.id) && <span className="material-symbols-outlined text-[10px] font-black">check</span>}
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={formData.permissions.includes(perm.id)}
                                                onChange={() => togglePermission(perm.id)}
                                                className="hidden"
                                            />
                                            <span className={`text-[11px] font-bold uppercase tracking-tight transition-colors ${formData.permissions.includes(perm.id) ? 'text-primary' : 'text-stone/40 group-hover:text-stone/60'}`}>{perm.label.split(' (')[0]}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <h4 className="font-display font-bold text-primary uppercase text-sm italic shrink-0">Phạm vi dữ liệu (Cửa hàng)</h4>
                                    <div className="h-px bg-gold/20 flex-1"></div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {accounts.map(acc => (
                                        <label key={acc.id} className={`flex items-center gap-3 p-4 border rounded-sm transition-all cursor-pointer group shadow-sm ${formData.account_ids.includes(acc.id) ? 'bg-primary text-white border-primary ring-2 ring-primary/10' : 'bg-white text-primary border-gold/10 hover:border-gold'}`}>
                                            <div className={`size-5 border-2 rounded-full flex items-center justify-center transition-all ${formData.account_ids.includes(acc.id) ? 'bg-white border-white scale-110' : 'bg-white border-gold/20'}`}>
                                                {formData.account_ids.includes(acc.id) && <span className="material-symbols-outlined text-primary text-[14px] font-black">check</span>}
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={formData.account_ids.includes(acc.id)}
                                                onChange={() => toggleAccount(acc.id)}
                                                className="hidden"
                                            />
                                            <div className="flex flex-col min-w-0">
                                                <span className={`text-[13px] font-bold truncate ${formData.account_ids.includes(acc.id) ? 'text-white' : 'text-primary'}`}>{acc.name}</span>
                                                <span className={`text-[9px] font-mono uppercase tracking-widest ${formData.account_ids.includes(acc.id) ? 'text-white/60' : 'text-stone/40'}`}>{acc.site_code || 'No-Code'}</span>
                                            </div>
                                        </label>
                                    ))}
                                    {accounts.length === 0 && <div className="col-span-full py-4 text-center border border-dashed border-gold/30 rounded-sm text-[11px] font-bold text-stone/30 uppercase tracking-[0.2em]">Hệ thống chưa có data cửa hàng</div>}
                                </div>
                            </div>
                        </form>
                        
                        <div className="px-8 py-6 bg-stone/5 border-t border-gold/20 flex justify-end gap-3 shrink-0">
                            <button type="button" onClick={() => setIsFormOpen(false)} className="px-8 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone/40 hover:text-brick hover:bg-brick/5 rounded-sm transition-all">Bỏ qua</button>
                            <button onClick={handleFormSubmit} className="bg-primary text-white px-10 py-2.5 text-[11px] font-black uppercase tracking-widest hover:bg-umber transition-all rounded-sm shadow-premium active:scale-95">
                                {formMode === 'edit' ? 'Cập nhật phân quyền' : 'Kích hoạt nhân sự'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserList;
