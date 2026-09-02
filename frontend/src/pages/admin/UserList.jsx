import React, { useEffect, useMemo, useState } from 'react';
import { accountApi, financeApi, userApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
    ADMIN_ACTION_OPTIONS,
    ADMIN_CHANGE_PASSWORD_PERMISSION,
    ADMIN_DATA_PERMISSION_OPTIONS,
    ADMIN_PERMISSION_OPTIONS,
    ADMIN_ROLE_OPTIONS,
    ADMIN_SPECIAL_PERMISSION_OPTIONS,
    accountAccessesFromUser,
    dataPermissionsForRole,
    hasAdminPermission,
    normalizeAdminPermissions,
    permissionsForRole,
} from '../../utils/adminPermissions';

const emptyFormData = {
    id: null,
    name: '',
    email: '',
    password: '',
    status: 1,
    account_accesses: [],
};

const emptyPasswordFormData = {
    password: '',
    password_confirmation: '',
};

const labelForModule = (moduleId) => (
    ADMIN_PERMISSION_OPTIONS.find((module) => module.id === moduleId)?.label || moduleId
);

const labelForRole = (role) => (
    ADMIN_ROLE_OPTIONS.find((option) => option.id === role)?.label || role || 'Tùy chỉnh'
);

const cleanPermissionLabel = (value) => String(value ?? '').trim();

const labelForAccess = (access) => cleanPermissionLabel(access.permission_label) || labelForRole(access.role);

const defaultPermissionLabel = (userName, role = 'employee') => (
    cleanPermissionLabel(userName) || labelForRole(role)
);

const permissionId = (moduleId, actionId) => `${moduleId}.${actionId}`;
const PROFIT_SCOPE_ALL = 'profit.scope.all';
const LEGACY_PROFIT_SCOPE_CHANNEL_PREFIX = 'profit.scope.channel.';
const PROFIT_SCOPE_MANAGER_PREFIX = 'profit.scope.manager.';
const PROFIT_SCOPE_CENTER_PREFIX = 'profit.scope.center.';
const isProfitScopePermission = (permission) => (
    permission === PROFIT_SCOPE_ALL
    || String(permission || '').startsWith(LEGACY_PROFIT_SCOPE_CHANNEL_PREFIX)
    || String(permission || '').startsWith(PROFIT_SCOPE_MANAGER_PREFIX)
    || String(permission || '').startsWith(PROFIT_SCOPE_CENTER_PREFIX)
);
const profitScopeManagerToken = (managerId) => `${PROFIT_SCOPE_MANAGER_PREFIX}${managerId}`;

const moduleIdsFromDetailedPermissions = (permissions = []) => Array.from(new Set(
    permissions
        .map((permission) => String(permission || '').split('.')[0])
        .filter((moduleId) => ADMIN_PERMISSION_OPTIONS.some((module) => module.id === moduleId))
));

const normalizeAccessPayload = (access) => ({
    account_id: Number(access.account_id),
    role: access.role || 'custom',
    permission_label: access.permission_label == null ? '' : String(access.permission_label),
    status: Number(access.status ?? 1) === 1 ? 1 : 0,
    permissions: Array.isArray(access.permissions) ? access.permissions : [],
    data_permissions: Array.isArray(access.data_permissions) ? access.data_permissions : [],
});

const accessForAccount = (account, role = 'employee', userName = '') => ({
    account_id: Number(account.id),
    role,
    permission_label: defaultPermissionLabel(userName, role),
    status: 1,
    permissions: permissionsForRole(role),
    data_permissions: dataPermissionsForRole(role),
});

const UserList = () => {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [profitCentersByAccount, setProfitCentersByAccount] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [passwordTarget, setPasswordTarget] = useState(null);
    const [formMode, setFormMode] = useState('create');
    const [formData, setFormData] = useState(emptyFormData);
    const [passwordFormData, setPasswordFormData] = useState(emptyPasswordFormData);

    const canManageUsers = currentUser?.is_admin || hasAdminPermission(currentUser, 'users.manage');
    const canChangePasswords = currentUser?.is_admin || hasAdminPermission(currentUser, ADMIN_CHANGE_PASSWORD_PERMISSION);

    const selectedAccessMap = useMemo(() => {
        const map = new Map();
        formData.account_accesses.forEach((access) => {
            map.set(Number(access.account_id), normalizeAccessPayload(access));
        });
        return map;
    }, [formData.account_accesses]);

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && isFormOpen) {
                setIsFormOpen(false);
            }
            if (event.key === 'Escape' && passwordTarget) {
                setPasswordTarget(null);
                setPasswordFormData(emptyPasswordFormData);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFormOpen, passwordTarget]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [usersResponse, accountsResponse] = await Promise.all([
                userApi.getAll(),
                accountApi.getAll(),
            ]);
            const nextUsers = Array.isArray(usersResponse.data) ? usersResponse.data : [];
            const nextAccounts = Array.isArray(accountsResponse.data) ? accountsResponse.data : [];
            setUsers(nextUsers);
            setAccounts(nextAccounts);

            const centerResults = await Promise.all(nextAccounts.map(async (account) => {
                try {
                    const response = await financeApi.getProfitCenters({ account_id: account.id });
                    return [Number(account.id), response?.data?.profit_centers || []];
                } catch (error) {
                    return [Number(account.id), []];
                }
            }));
            setProfitCentersByAccount(Object.fromEntries(centerResults));
        } catch (error) {
            console.error('Error fetching users/accounts:', error);
            setProfitCentersByAccount({});
        } finally {
            setLoading(false);
        }
    };

    const openNewForm = () => {
        setFormData(emptyFormData);
        setFormMode('create');
        setIsFormOpen(true);
    };

    const handleEdit = (user) => {
        setFormData({
            id: user.id,
            name: user.name || '',
            email: user.email || '',
            password: '',
            status: Number(user.status ?? 1) === 1 ? 1 : 0,
            account_accesses: accountAccessesFromUser(user).map(normalizeAccessPayload),
        });
        setFormMode('edit');
        setIsFormOpen(true);
    };

    const openPasswordForm = (user) => {
        setPasswordTarget(user);
        setPasswordFormData(emptyPasswordFormData);
    };

    const closePasswordForm = () => {
        setPasswordTarget(null);
        setPasswordFormData(emptyPasswordFormData);
    };

    const submitPasswordForm = async (event) => {
        event.preventDefault();
        if (passwordSaving || !passwordTarget) return;

        if (passwordFormData.password !== passwordFormData.password_confirmation) {
            alert('Mật khẩu xác nhận chưa khớp.');
            return;
        }

        setPasswordSaving(true);
        try {
            await userApi.changePassword(passwordTarget.id, passwordFormData);
            closePasswordForm();
        } catch (error) {
            console.error('Error changing user password:', error);
            alert(error.response?.data?.message || 'Không thể đổi mật khẩu.');
        } finally {
            setPasswordSaving(false);
        }
    };

    const updateAccess = (accountId, updater) => {
        const numericAccountId = Number(accountId);
        setFormData((current) => ({
            ...current,
            account_accesses: current.account_accesses.map((access) => (
                Number(access.account_id) === numericAccountId
                    ? normalizeAccessPayload(updater(normalizeAccessPayload(access)))
                    : access
            )),
        }));
    };

    const toggleAccount = (account) => {
        const accountId = Number(account.id);
        setFormData((current) => {
            const exists = current.account_accesses.some((access) => Number(access.account_id) === accountId);
            return {
                ...current,
                account_accesses: exists
                    ? current.account_accesses.filter((access) => Number(access.account_id) !== accountId)
                    : [...current.account_accesses, accessForAccount(account, 'employee', current.name)],
            };
        });
    };

    const changePermissionLabel = (accountId, permissionLabel) => {
        updateAccess(accountId, (access) => ({
            ...access,
            permission_label: permissionLabel,
        }));
    };

    const changeRole = (accountId, role) => {
        updateAccess(accountId, (access) => ({
            ...access,
            role,
            permissions: role === 'custom' ? access.permissions : permissionsForRole(role),
            data_permissions: role === 'custom' ? access.data_permissions : dataPermissionsForRole(role),
        }));
    };

    const togglePermission = (accountId, permission) => {
        updateAccess(accountId, (access) => ({
            ...access,
            role: 'custom',
            permissions: access.permissions.includes(permission)
                ? access.permissions.filter((item) => item !== permission)
                : [...access.permissions, permission],
        }));
    };

    const toggleModule = (accountId, moduleId) => {
        updateAccess(accountId, (access) => {
            const modulePermissions = ADMIN_ACTION_OPTIONS.map((action) => permissionId(moduleId, action.id));
            const hasAll = modulePermissions.every((permission) => access.permissions.includes(permission));
            return {
                ...access,
                role: 'custom',
                permissions: hasAll
                    ? access.permissions.filter((permission) => !modulePermissions.includes(permission))
                    : Array.from(new Set([...access.permissions, ...modulePermissions])),
            };
        });
    };

    const toggleDataPermission = (accountId, permission) => {
        updateAccess(accountId, (access) => ({
            ...access,
            role: 'custom',
            data_permissions: access.data_permissions.includes(permission)
                ? access.data_permissions.filter((item) => item !== permission)
                : [...access.data_permissions, permission],
        }));
    };

    const toggleProfitScope = (accountId, scopeToken) => {
        updateAccess(accountId, (access) => {
            const basePermissions = (access.data_permissions || []).filter((permission) => !isProfitScopePermission(permission));
            let scopePermissions = (access.data_permissions || []).filter(isProfitScopePermission);

            if (scopeToken === PROFIT_SCOPE_ALL) {
                scopePermissions = scopePermissions.includes(PROFIT_SCOPE_ALL) ? [] : [PROFIT_SCOPE_ALL];
            } else {
                scopePermissions = scopePermissions
                    .filter((permission) => permission !== PROFIT_SCOPE_ALL);
                scopePermissions = scopePermissions.includes(scopeToken)
                    ? scopePermissions.filter((permission) => permission !== scopeToken)
                    : [...scopePermissions, scopeToken];
            }

            const nextBasePermissions = scopePermissions.length > 0
                ? (basePermissions.includes('profit.view') ? basePermissions : [...basePermissions, 'profit.view'])
                : basePermissions.filter((permission) => permission !== 'profit.view');

            return {
                ...access,
                role: 'custom',
                permissions: scopePermissions.length > 0 && !access.permissions.includes('reports.view')
                    ? [...access.permissions, 'reports.view']
                    : access.permissions,
                data_permissions: Array.from(new Set([...nextBasePermissions, ...scopePermissions])),
            };
        });
    };

    const submitForm = async (event) => {
        event.preventDefault();
        if (saving) return;

        setSaving(true);
        try {
            const allDetailedPermissions = formData.account_accesses.flatMap((access) => access.permissions || []);
            const payload = {
                ...formData,
                account_ids: formData.account_accesses.map((access) => Number(access.account_id)),
                account_accesses: formData.account_accesses.map(normalizeAccessPayload),
                permissions: moduleIdsFromDetailedPermissions(allDetailedPermissions),
            };
            if (formMode === 'edit') {
                delete payload.password;
            }

            if (formMode === 'create') {
                await userApi.store(payload);
            } else {
                await userApi.update(formData.id, payload);
            }

            setIsFormOpen(false);
            await fetchInitialData();
        } catch (error) {
            console.error('Error saving user:', error);
            alert(error.response?.data?.message || 'Không thể lưu tài khoản.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id, name) => {
        if (!window.confirm(`Xóa tài khoản ${name}?`)) {
            return;
        }

        try {
            await userApi.destroy(id);
            await fetchInitialData();
        } catch (error) {
            console.error('Error deleting user:', error);
            alert(error.response?.data?.message || 'Không thể xóa tài khoản.');
        }
    };

    if (!canManageUsers) {
        return <div className="p-8 text-center text-brick">Bạn không có quyền truy cập trang này.</div>;
    }

    return (
        <div className="absolute inset-0 z-10 flex h-full w-full flex-col overflow-hidden bg-[#fcfcfa] p-6 animate-fade-in">
            <div className="flex-none bg-[#fcfcfa] pb-4">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h1 className="font-display text-2xl font-bold italic text-primary">Danh sách quản trị</h1>
                        <p className="mt-1 text-[10px] font-black uppercase leading-none tracking-[0.2em] text-stone/40">
                            Phân quyền người dùng theo từng cửa hàng
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between rounded-sm border border-gold/10 bg-white p-2 shadow-sm">
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={openNewForm}
                            className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary p-1.5 text-white shadow-sm transition-all hover:bg-umber"
                            title="Thêm quản trị viên"
                        >
                            <span className="material-symbols-outlined text-[18px]">person_add</span>
                        </button>
                        <button
                            type="button"
                            onClick={fetchInitialData}
                            className={`flex h-9 w-9 items-center justify-center rounded-sm border border-primary bg-primary p-1.5 text-white transition-all hover:bg-umber ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-stone/40">
                        {users.length} tài khoản quản trị
                    </div>
                </div>
            </div>

            <div className="relative flex-1 overflow-auto rounded-sm border border-gold/10 bg-white shadow-sm">
                <table className="w-full table-fixed border-collapse text-left">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="w-[26%] px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary">Nhân sự</th>
                            <th className="w-[24%] px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary">Quyền chức năng</th>
                            <th className="w-[28%] px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary">Cửa hàng</th>
                            <th className="w-[12%] px-4 py-3 text-center font-ui text-[11px] font-black uppercase tracking-widest text-primary">Trạng thái</th>
                            <th className="w-[10%] px-4 py-3 text-right font-ui text-[11px] font-black uppercase tracking-widest text-gold/60">#</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center">
                                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                                </td>
                            </tr>
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="py-20 text-center text-xs font-bold uppercase tracking-widest text-stone/40">
                                    Chưa có quản trị viên
                                </td>
                            </tr>
                        ) : users.map((item) => {
                            const modules = normalizeAdminPermissions(item);
                            const accesses = accountAccessesFromUser(item);

                            return (
                                <tr key={item.id} className="group transition-all hover:bg-gold/5">
                                    <td className="px-4 py-3.5">
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-gold/20 bg-gold/5 text-xs font-black text-gold transition-all group-hover:bg-gold group-hover:text-white">
                                                {String(item.name || '?').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-[14px] font-bold leading-tight text-primary">{item.name}</div>
                                                <div className="mt-0.5 truncate text-[10px] text-stone/40">{item.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        {item.is_admin ? (
                                            <span className="rounded-[2px] border border-gold/20 bg-gold/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gold">
                                                Quản trị hệ thống
                                            </span>
                                        ) : (
                                            <div className="flex max-w-[260px] flex-wrap gap-1">
                                                {modules.length > 0 ? modules.slice(0, 4).map((moduleId) => (
                                                    <span key={moduleId} className="border border-gold/10 bg-[#fcf8f1] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-tighter text-stone/50">
                                                        {labelForModule(moduleId)}
                                                    </span>
                                                )) : (
                                                    <span className="text-[10px] font-bold italic text-brick/50">Chưa cấp quyền</span>
                                                )}
                                                {modules.length > 4 && <span className="text-[9px] font-black text-gold/50">+{modules.length - 4}</span>}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3.5">
                                        {item.is_admin ? (
                                            <span className="text-[11px] font-medium uppercase tracking-tighter text-stone/30">Toàn bộ hệ thống</span>
                                        ) : (
                                            <div className="flex max-h-16 flex-col gap-0.5 overflow-hidden">
                                                {accesses.length > 0 ? accesses.slice(0, 3).map((access) => {
                                                    const account = item.accounts?.find((accountItem) => Number(accountItem.id) === Number(access.account_id));
                                                    return (
                                                        <div key={access.account_id} className="flex items-center gap-1.5">
                                                            <span className="size-1 shrink-0 rounded-full bg-gold/40" />
                                                            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-primary/70">{account?.name || `Cửa hàng #${access.account_id}`}</span>
                                                            <span className="max-w-[120px] shrink-0 truncate text-[9px] font-black uppercase text-stone/30">{labelForAccess(access)}</span>
                                                        </div>
                                                    );
                                                }) : (
                                                    <span className="text-[10px] italic text-brick/50">Chưa gắn cửa hàng</span>
                                                )}
                                                {accesses.length > 3 && <span className="pl-2 text-[9px] font-black text-stone/30">+{accesses.length - 3} cửa hàng</span>}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className={`rounded-[2px] border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${Number(item.status ?? 1) === 1 ? 'border-primary/20 bg-primary/5 text-primary' : 'border-brick/20 bg-brick/5 text-brick'}`}>
                                            {Number(item.status ?? 1) === 1 ? 'Đang hoạt động' : 'Đã khóa'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        {!item.is_admin ? (
                                            <div className="flex items-center justify-end gap-1">
                                                <button type="button" onClick={() => handleEdit(item)} className="flex size-8 items-center justify-center rounded-sm text-stone/30 transition-all hover:bg-primary/5 hover:text-primary" title="Phân quyền">
                                                    <span className="material-symbols-outlined text-[18px]">rule_settings</span>
                                                </button>
                                                {canChangePasswords && (
                                                    <button type="button" onClick={() => openPasswordForm(item)} className="flex size-8 items-center justify-center rounded-sm text-stone/30 transition-all hover:bg-primary/5 hover:text-primary" title="Đổi mật khẩu">
                                                        <span className="material-symbols-outlined text-[18px]">vpn_key</span>
                                                    </button>
                                                )}
                                                <button type="button" onClick={() => handleDelete(item.id, item.name)} className="flex size-8 items-center justify-center rounded-sm text-stone/30 transition-all hover:bg-brick/5 hover:text-brick" title="Xóa tài khoản">
                                                    <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="pr-2 text-[10px] font-black uppercase tracking-widest text-stone/20">Không chỉnh sửa</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {isFormOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/60 p-6 backdrop-blur-sm">
                    <form onSubmit={submitForm} className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-gold/30 bg-[#fcfcfa] shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                        <div className="flex shrink-0 items-center justify-between bg-primary px-8 py-5 text-white">
                            <div>
                                <h3 className="font-display text-xl font-bold uppercase italic leading-none">
                                    {formMode === 'edit' ? 'Cập nhật phân quyền' : 'Tạo nhân sự mới'}
                                </h3>
                                <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                                    Quyền theo từng cửa hàng và dữ liệu nhạy cảm
                                </p>
                            </div>
                            <button type="button" onClick={() => setIsFormOpen(false)} className="flex size-10 items-center justify-center rounded-full text-white/50 transition-all hover:bg-white/10 hover:text-white">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="flex-1 space-y-8 overflow-auto p-8">
                            <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
                                <label className="space-y-1.5">
                                    <span className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Họ tên</span>
                                    <input required type="text" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} className="w-full rounded-sm border border-gold/20 bg-stone/5 p-3 text-[14px] font-bold text-primary transition-all focus:border-gold focus:bg-white focus:outline-none" />
                                </label>
                                <label className="space-y-1.5">
                                    <span className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Email</span>
                                    <input required type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} className="w-full rounded-sm border border-gold/20 bg-stone/5 p-3 text-[14px] font-bold text-primary transition-all focus:border-gold focus:bg-white focus:outline-none" />
                                </label>
                                {formMode === 'create' && (
                                <label className="space-y-1.5">
                                    <span className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Mật khẩu {formMode === 'edit' ? '(bỏ trống nếu giữ nguyên)' : ''}</span>
                                    <input required minLength="6" type="password" value={formData.password} onChange={(event) => setFormData({ ...formData, password: event.target.value })} className="w-full rounded-sm border border-gold/20 bg-stone/5 p-3 text-[14px] font-bold text-primary transition-all focus:border-gold focus:bg-white focus:outline-none" />
                                </label>
                                )}
                                <label className="flex items-end">
                                    <span className="flex w-full cursor-pointer items-center gap-3 rounded-sm border border-gold/20 bg-stone/5 p-3 transition-all hover:border-gold">
                                        <span className={`flex size-5 items-center justify-center rounded-sm border-2 ${formData.status === 1 ? 'border-primary bg-primary' : 'border-gold/20 bg-white'}`}>
                                            {formData.status === 1 && <span className="material-symbols-outlined text-[16px] text-white">check</span>}
                                        </span>
                                        <input type="checkbox" checked={formData.status === 1} onChange={(event) => setFormData({ ...formData, status: event.target.checked ? 1 : 0 })} className="hidden" />
                                        <span className="font-ui text-[11px] font-black uppercase tracking-widest text-primary/60">Cho phép hoạt động</span>
                                    </span>
                                </label>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <h4 className="shrink-0 font-display text-sm font-bold uppercase italic text-primary">Cửa hàng và quyền chi tiết</h4>
                                    <div className="h-px flex-1 bg-gold/20" />
                                </div>

                                <div className="space-y-4">
                                    {accounts.map((account) => {
                                        const access = selectedAccessMap.get(Number(account.id));
                                        const isSelected = Boolean(access);
                                        const accountProfitCenters = profitCentersByAccount[Number(account.id)] || [];
                                        const accountProfitManagers = Array.from(new Map(
                                            accountProfitCenters
                                                .filter((center) => center.manager_user_id)
                                                .map((center) => [
                                                    Number(center.manager_user_id),
                                                    center.manager_name || `QL #${center.manager_user_id}`,
                                                ])
                                        )).map(([id, name]) => ({ id, name }));

                                        return (
                                            <section key={account.id} className={`rounded-sm border ${isSelected ? 'border-primary/25 bg-white' : 'border-gold/10 bg-white/70'}`}>
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/10 p-4">
                                                    <label className="flex min-w-0 cursor-pointer items-center gap-3">
                                                        <span className={`flex size-5 shrink-0 items-center justify-center rounded-sm border-2 ${isSelected ? 'border-primary bg-primary' : 'border-gold/30 bg-white'}`}>
                                                            {isSelected && <span className="material-symbols-outlined text-[16px] text-white">check</span>}
                                                        </span>
                                                        <input type="checkbox" checked={isSelected} onChange={() => toggleAccount(account)} className="hidden" />
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-[14px] font-black text-primary">{account.name}</span>
                                                            <span className="block text-[10px] font-mono uppercase tracking-widest text-stone/35">{account.site_code || 'NO-CODE'}</span>
                                                        </span>
                                                    </label>

                                                    {isSelected && (
                                                        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                                                            <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-sm border border-gold/20 bg-[#fcfcfa] px-3 py-2 md:max-w-xs">
                                                                <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-primary/40">Tên quyền</span>
                                                                <input
                                                                    type="text"
                                                                    value={access.permission_label}
                                                                    onChange={(event) => changePermissionLabel(account.id, event.target.value)}
                                                                    placeholder={labelForRole(access.role)}
                                                                    className="min-w-0 flex-1 bg-transparent text-[12px] font-bold text-primary outline-none placeholder:text-stone/30"
                                                                />
                                                            </label>
                                                            <select value={access.role} onChange={(event) => changeRole(account.id, event.target.value)} className="h-9 rounded-sm border border-gold/20 bg-[#fcfcfa] px-3 text-[11px] font-black uppercase tracking-wider text-primary focus:border-gold focus:outline-none">
                                                                {ADMIN_ROLE_OPTIONS.map((role) => (
                                                                    <option key={role.id} value={role.id}>{role.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    )}
                                                </div>

                                                {isSelected && (
                                                    <div className="space-y-5 p-4">
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full min-w-[780px] border-collapse text-left">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="w-[210px] border-b border-gold/10 pb-2 text-[10px] font-black uppercase tracking-widest text-primary/45">Nhóm quyền</th>
                                                                        {ADMIN_ACTION_OPTIONS.map((action) => (
                                                                            <th key={action.id} className="border-b border-gold/10 px-2 pb-2 text-center text-[10px] font-black uppercase tracking-widest text-primary/45">
                                                                                {action.label}
                                                                            </th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {ADMIN_PERMISSION_OPTIONS.map((module) => {
                                                                        const moduleActionIds = ADMIN_ACTION_OPTIONS.map((action) => permissionId(module.id, action.id));
                                                                        const selectedCount = moduleActionIds.filter((id) => access.permissions.includes(id)).length;

                                                                        return (
                                                                            <tr key={module.id} className="border-b border-gold/5 last:border-0">
                                                                                <td className="py-2 pr-3">
                                                                                    <button type="button" onClick={() => toggleModule(account.id, module.id)} className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-gold/5">
                                                                                        <span className="truncate text-[12px] font-bold text-primary">{module.label}</span>
                                                                                        <span className="text-[9px] font-black text-stone/35">{selectedCount}/{ADMIN_ACTION_OPTIONS.length}</span>
                                                                                    </button>
                                                                                </td>
                                                                                {ADMIN_ACTION_OPTIONS.map((action) => {
                                                                                    const id = permissionId(module.id, action.id);
                                                                                    const checked = access.permissions.includes(id);
                                                                                    return (
                                                                                        <td key={id} className="px-2 py-2 text-center">
                                                                                            <button type="button" onClick={() => togglePermission(account.id, id)} className={`mx-auto flex size-7 items-center justify-center rounded-sm border transition-all ${checked ? 'border-primary bg-primary text-white' : 'border-gold/20 bg-white text-transparent hover:border-gold'}`} title={`${module.label} - ${action.label}`}>
                                                                                                <span className="material-symbols-outlined text-[15px]">check</span>
                                                                                            </button>
                                                                                        </td>
                                                                                    );
                                                                                })}
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        <div className="space-y-2 border-t border-gold/10 pt-4">
                                                            <div className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/45">Quyền đặc biệt</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {ADMIN_SPECIAL_PERMISSION_OPTIONS.map((permission) => {
                                                                    const checked = access.permissions.includes(permission.id);
                                                                    return (
                                                                        <button key={permission.id} type="button" onClick={() => togglePermission(account.id, permission.id)} className={`rounded-sm border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${checked ? 'border-primary bg-primary text-white' : 'border-gold/20 bg-white text-primary/55 hover:border-gold'}`}>
                                                                            {permission.label}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-wrap gap-2 border-t border-gold/10 pt-4">
                                                            {ADMIN_DATA_PERMISSION_OPTIONS.map((permission) => {
                                                                const checked = access.data_permissions.includes(permission.id);
                                                                return (
                                                                    <button key={permission.id} type="button" onClick={() => toggleDataPermission(account.id, permission.id)} className={`rounded-sm border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${checked ? 'border-primary bg-primary text-white' : 'border-gold/20 bg-white text-primary/55 hover:border-gold'}`}>
                                                                        {permission.label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>

                                                        <div className="space-y-3 border-t border-gold/10 pt-4">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div>
                                                                    <div className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/45">Phạm vi lãi lỗ</div>
                                                                    <div className="mt-0.5 text-[11px] font-medium text-stone/45">Áp dụng theo người quản lý cho báo cáo ngày, tháng và drilldown đơn hàng.</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {[
                                                                    { id: PROFIT_SCOPE_ALL, label: 'Tổng' },
                                                                ].map((scope) => {
                                                                    const checked = access.data_permissions.includes(scope.id);
                                                                    return (
                                                                        <button key={scope.id} type="button" onClick={() => toggleProfitScope(account.id, scope.id)} className={`rounded-sm border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gold/20 bg-white text-primary/55 hover:border-gold'}`}>
                                                                            {scope.label}
                                                                        </button>
                                                                    );
                                                                })}
                                                                {accountProfitManagers.map((manager) => {
                                                                    const token = profitScopeManagerToken(manager.id);
                                                                    const checked = access.data_permissions.includes(token);
                                                                    return (
                                                                        <button key={token} type="button" onClick={() => toggleProfitScope(account.id, token)} className={`rounded-sm border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gold/20 bg-white text-primary/55 hover:border-gold'}`}>
                                                                            {manager.name}
                                                                        </button>
                                                                    );
                                                                })}
                                                                {accountProfitManagers.length === 0 && (
                                                                    <span className="self-center text-[10px] font-bold uppercase tracking-wider text-stone/35">
                                                                        Chưa có người quản lý
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </section>
                                        );
                                    })}

                                    {accounts.length === 0 && (
                                        <div className="rounded-sm border border-dashed border-gold/30 py-8 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-stone/30">
                                            Hệ thống chưa có cửa hàng
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex shrink-0 justify-end gap-3 border-t border-gold/20 bg-stone/5 px-8 py-6">
                            <button type="button" onClick={() => setIsFormOpen(false)} className="rounded-sm px-8 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone/40 transition-all hover:bg-brick/5 hover:text-brick">
                                Bỏ qua
                            </button>
                            <button type="submit" disabled={saving} className="rounded-sm bg-primary px-10 py-2.5 text-[11px] font-black uppercase tracking-widest text-white shadow-premium transition-all hover:bg-umber disabled:opacity-60">
                                {saving ? 'Đang lưu...' : formMode === 'edit' ? 'Cập nhật' : 'Tạo người dùng'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {passwordTarget && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-900/60 p-6 backdrop-blur-sm">
                    <form onSubmit={submitPasswordForm} className="w-full max-w-lg overflow-hidden rounded-sm border border-gold/30 bg-[#fcfcfa] shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                        <div className="flex items-center justify-between bg-primary px-7 py-5 text-white">
                            <div>
                                <h3 className="font-display text-lg font-bold uppercase italic leading-none">Đổi mật khẩu</h3>
                                <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                                    {passwordTarget.name}
                                </p>
                            </div>
                            <button type="button" onClick={closePasswordForm} className="flex size-10 items-center justify-center rounded-full text-white/50 transition-all hover:bg-white/10 hover:text-white">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="space-y-5 p-7">
                            <label className="space-y-1.5">
                                <span className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Mật khẩu mới</span>
                                <input required minLength="6" type="password" value={passwordFormData.password} onChange={(event) => setPasswordFormData({ ...passwordFormData, password: event.target.value })} className="w-full rounded-sm border border-gold/20 bg-stone/5 p-3 text-[14px] font-bold text-primary transition-all focus:border-gold focus:bg-white focus:outline-none" />
                            </label>
                            <label className="space-y-1.5">
                                <span className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Nhập lại mật khẩu</span>
                                <input required minLength="6" type="password" value={passwordFormData.password_confirmation} onChange={(event) => setPasswordFormData({ ...passwordFormData, password_confirmation: event.target.value })} className="w-full rounded-sm border border-gold/20 bg-stone/5 p-3 text-[14px] font-bold text-primary transition-all focus:border-gold focus:bg-white focus:outline-none" />
                            </label>
                        </div>

                        <div className="flex justify-end gap-3 border-t border-gold/20 bg-stone/5 px-7 py-5">
                            <button type="button" onClick={closePasswordForm} className="rounded-sm px-6 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone/40 transition-all hover:bg-brick/5 hover:text-brick">
                                Bỏ qua
                            </button>
                            <button type="submit" disabled={passwordSaving} className="rounded-sm bg-primary px-8 py-2.5 text-[11px] font-black uppercase tracking-widest text-white shadow-premium transition-all hover:bg-umber disabled:opacity-60">
                                {passwordSaving ? 'Đang lưu...' : 'Cập nhật'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default UserList;
