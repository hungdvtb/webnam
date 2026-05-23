export const ADMIN_PERMISSION_OPTIONS = [
    { id: 'dashboard', label: 'Tổng quan' },
    { id: 'accounts', label: 'Danh sách cửa hàng' },
    { id: 'products', label: 'Quản lý sản phẩm' },
    { id: 'categories', label: 'Danh mục sản phẩm' },
    { id: 'orders', label: 'Quản lý đơn hàng' },
    { id: 'customers', label: 'Quản lý khách hàng' },
    { id: 'leads', label: 'Xử lý lead' },
    { id: 'inventory', label: 'Quản lý tồn kho' },
    { id: 'warehouses', label: 'Quản lý kho vận' },
    { id: 'attributes', label: 'Thuộc tính' },
    { id: 'settings', label: 'Cấu hình website' },
    { id: 'menus', label: 'Menu và điều hướng' },
    { id: 'users', label: 'Quản lý người dùng' },
    { id: 'blog', label: 'Bài viết trên web' },
    { id: 'reports', label: 'Báo cáo và phân tích' },
    { id: 'payroll', label: 'Công và lương' },
];

export const ADMIN_ACTION_OPTIONS = [
    { id: 'view', label: 'Xem' },
    { id: 'create', label: 'Thêm' },
    { id: 'update', label: 'Sửa' },
    { id: 'delete_soft', label: 'Xóa mềm' },
    { id: 'delete_permanent', label: 'Xóa vĩnh viễn' },
    { id: 'export', label: 'Xuất file' },
];

export const ADMIN_DATA_PERMISSION_OPTIONS = [
    { id: 'cost.view', label: 'Xem giá nhập / giá vốn' },
    { id: 'profit.view', label: 'Xem lãi gộp / lợi nhuận' },
    { id: 'finance.view', label: 'Xem dữ liệu tài chính' },
];

export const ADMIN_ROLE_OPTIONS = [
    { id: 'owner', label: 'Chủ / Toàn quyền' },
    { id: 'manager', label: 'Quản lý' },
    { id: 'sale', label: 'Nhân viên sale' },
    { id: 'warehouse', label: 'Nhân viên kho' },
    { id: 'viewer', label: 'Chỉ xem' },
    { id: 'custom', label: 'Tùy chỉnh' },
];

export const LEGACY_ADMIN_PERMISSION_IDS = ADMIN_PERMISSION_OPTIONS.map((permission) => permission.id);
export const ADMIN_DETAILED_PERMISSION_IDS = ADMIN_PERMISSION_OPTIONS.flatMap((module) => (
    ADMIN_ACTION_OPTIONS.map((action) => `${module.id}.${action.id}`)
)).concat('users.manage');

const ADMIN_MODULE_IDS = new Set(LEGACY_ADMIN_PERMISSION_IDS);
const ROLE_ALIASES = {
    owner: 'owner',
    manager: 'manager',
    staff: 'sale',
    sale: 'sale',
    sales: 'sale',
    warehouse: 'warehouse',
    viewer: 'viewer',
    custom: 'custom',
};

function normalizeRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    return ROLE_ALIASES[normalized] || 'custom';
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function modulePermissions(modules, actions) {
    return unique(modules.flatMap((module) => (
        ADMIN_MODULE_IDS.has(module)
            ? actions.map((action) => `${module}.${action}`)
            : []
    )));
}

export function permissionsForRole(role) {
    switch (normalizeRole(role)) {
        case 'owner':
            return ADMIN_PERMISSION_OPTIONS.flatMap((module) => ADMIN_ACTION_OPTIONS.map((action) => `${module.id}.${action.id}`));
        case 'manager':
            return modulePermissions([
                'dashboard',
                'products',
                'categories',
                'orders',
                'customers',
                'leads',
                'inventory',
                'warehouses',
                'attributes',
                'settings',
                'menus',
                'blog',
                'reports',
                'payroll',
            ], ['view', 'create', 'update', 'delete_soft', 'export']);
        case 'sale':
            return unique([
                ...modulePermissions(['dashboard'], ['view']),
                ...modulePermissions(['orders'], ['view', 'create', 'update', 'delete_soft', 'export']),
                ...modulePermissions(['products', 'inventory', 'warehouses'], ['view']),
                ...modulePermissions(['customers', 'leads'], ['view', 'create', 'update']),
            ]);
        case 'warehouse':
            return unique([
                ...modulePermissions(['dashboard', 'orders', 'products'], ['view']),
                ...modulePermissions(['inventory', 'warehouses'], ['view', 'create', 'update', 'delete_soft', 'export']),
            ]);
        case 'viewer':
            return modulePermissions(['dashboard', 'products', 'orders', 'customers', 'leads', 'inventory', 'warehouses'], ['view']);
        default:
            return [];
    }
}

export function dataPermissionsForRole(role) {
    return ['owner', 'manager'].includes(normalizeRole(role))
        ? ADMIN_DATA_PERMISSION_OPTIONS.map((permission) => permission.id)
        : [];
}

function parsePermissionPayload(rawPermissions) {
    if (Array.isArray(rawPermissions)) {
        return rawPermissions;
    }

    if (typeof rawPermissions === 'string') {
        const trimmed = rawPermissions.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return null;
        }
    }

    if (rawPermissions === null || rawPermissions === undefined) {
        return null;
    }

    return [];
}

function readActiveAccountId() {
    if (typeof window === 'undefined') {
        return '';
    }

    const value = String(window.localStorage.getItem('activeAccountId') || '').trim();
    return value && value !== 'all' ? value : '';
}

export function expandLegacyAdminPermissions(rawPermissions) {
    const parsedPermissions = parsePermissionPayload(rawPermissions);
    const effectivePermissions = parsedPermissions === null
        ? LEGACY_ADMIN_PERMISSION_IDS
        : parsedPermissions;

    const expanded = [];
    effectivePermissions.forEach((permission) => {
        const id = String(permission || '').trim();
        if (!id) return;

        if (id.includes('.')) {
            expanded.push(id);
            return;
        }

        if (!ADMIN_MODULE_IDS.has(id)) return;

        if (id === 'users') {
            expanded.push('users.manage', 'users.view');
            return;
        }

        const actions = ['dashboard', 'reports'].includes(id)
            ? ['view', 'export']
            : ['view', 'create', 'update', 'delete_soft', 'export'];

        actions.forEach((action) => expanded.push(`${id}.${action}`));
    });

    return unique(expanded);
}

export function accountAccessesFromUser(user) {
    if (!user || !Array.isArray(user.accounts)) {
        return [];
    }

    return user.accounts.map((account) => ({
        account_id: account.id,
        role: normalizeRole(account.pivot?.role || 'custom'),
        status: account.pivot?.status ?? 1,
        permissions: parsePermissionPayload(account.pivot?.permissions) || [],
        data_permissions: parsePermissionPayload(account.pivot?.data_permissions) || [],
    }));
}

export function normalizeDetailedAdminPermissions(user, accountId = readActiveAccountId()) {
    if (!user || user.is_admin) {
        return [];
    }

    const accesses = accountAccessesFromUser(user);
    const selectedAccountId = String(accountId || '').trim();

    const matchingAccesses = selectedAccountId
        ? accesses.filter((access) => String(access.account_id) === selectedAccountId)
        : accesses;

    const detailedFromAccount = matchingAccesses
        .filter((access) => Number(access.status ?? 1) === 1)
        .flatMap((access) => access.permissions || []);

    if (detailedFromAccount.length > 0) {
        return unique(detailedFromAccount);
    }

    return expandLegacyAdminPermissions(user.permissions);
}

export function normalizeAdminPermissions(user, accountId = readActiveAccountId()) {
    if (!user || user.is_admin) {
        return [];
    }

    const detailedPermissions = normalizeDetailedAdminPermissions(user, accountId);

    return unique(detailedPermissions.map((permission) => {
        const [module] = String(permission || '').split('.');
        return ADMIN_MODULE_IDS.has(module) ? module : null;
    }));
}

export function hasAdminPermission(user, permission, accountId = readActiveAccountId()) {
    if (!user) return false;
    if (user.is_admin) return true;

    const permissions = normalizeDetailedAdminPermissions(user, accountId);
    if (permissions.includes(permission)) return true;

    const [module] = String(permission || '').split('.');
    if (permission === 'users.manage') {
        return permissions.includes('users.update') || permissions.includes('users.*');
    }

    return permissions.includes(`${module}.*`);
}

export function hasAdminDataPermission(user, permission, accountId = readActiveAccountId()) {
    if (!user) return false;
    if (user.is_admin) return true;

    const accesses = accountAccessesFromUser(user);
    const selectedAccountId = String(accountId || '').trim();
    const matchingAccesses = selectedAccountId
        ? accesses.filter((access) => String(access.account_id) === selectedAccountId)
        : accesses;

    return matchingAccesses.some((access) => (
        Number(access.status ?? 1) === 1
        && (access.data_permissions || []).includes(permission)
    ));
}
