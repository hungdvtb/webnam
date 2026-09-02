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
    { id: 'payroll', label: 'Quản lí nhân sự' },
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
    { id: 'customer_phone.view', label: 'Xem SĐT khách hàng' },
];

export const ADMIN_PROFIT_SCOPE_ALL_PERMISSION = 'profit.scope.all';
export const ADMIN_CHANGE_PASSWORD_PERMISSION = 'users.change_password';
export const ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS = {
    view: 'inventory.shelf_locations.view',
    create: 'inventory.shelf_locations.create',
    update: 'inventory.shelf_locations.update',
    delete_soft: 'inventory.shelf_locations.delete_soft',
};
export const ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS = {
    view: 'inventory.replacements.view',
    create: 'inventory.replacements.create',
    update: 'inventory.replacements.update',
    delete_soft: 'inventory.replacements.delete_soft',
};
export const ADMIN_INVENTORY_REPLACEMENT_LOOKUP_PERMISSION = 'inventory.replacement_lookup.view';

export const ADMIN_SPECIAL_PERMISSION_OPTIONS = [
    { id: ADMIN_CHANGE_PASSWORD_PERMISSION, label: 'Đổi mật khẩu quản trị' },
    { id: ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.view, label: 'Vị trí kệ - Xem' },
    { id: ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.create, label: 'Vị trí kệ - Thêm' },
    { id: ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.update, label: 'Vị trí kệ - Sửa' },
    { id: ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.delete_soft, label: 'Vị trí kệ - Xóa' },
    { id: ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.view, label: 'Mã thay thế - Xem' },
    { id: ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.create, label: 'Mã thay thế - Thêm' },
    { id: ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.update, label: 'Mã thay thế - Sửa' },
    { id: ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.delete_soft, label: 'Mã thay thế - Xóa' },
    { id: ADMIN_INVENTORY_REPLACEMENT_LOOKUP_PERMISSION, label: 'Tra mã kho' },
];

export const ADMIN_ROLE_OPTIONS = [
    { id: 'owner', label: 'Chủ / Toàn quyền' },
    { id: 'manager', label: 'Quản lý' },
    { id: 'sale', label: 'Nhân viên sale' },
    { id: 'warehouse', label: 'Nhân viên kho' },
    { id: 'employee', label: 'Nhân viên' },
    { id: 'viewer', label: 'Chỉ xem' },
    { id: 'custom', label: 'Tùy chỉnh' },
];

export const LEGACY_ADMIN_PERMISSION_IDS = ADMIN_PERMISSION_OPTIONS.map((permission) => permission.id);
export const ADMIN_DETAILED_PERMISSION_IDS = ADMIN_PERMISSION_OPTIONS.flatMap((module) => (
    ADMIN_ACTION_OPTIONS.map((action) => `${module.id}.${action.id}`)
)).concat('users.manage', ...ADMIN_SPECIAL_PERMISSION_OPTIONS.map((permission) => permission.id));

const ADMIN_MODULE_IDS = new Set(LEGACY_ADMIN_PERMISSION_IDS);
const ADMIN_ACTION_IDS = new Set(ADMIN_ACTION_OPTIONS.map((action) => action.id));
const ROLE_ALIASES = {
    owner: 'owner',
    manager: 'manager',
    staff: 'sale',
    sale: 'sale',
    sales: 'sale',
    warehouse: 'warehouse',
    employee: 'employee',
    nhan_vien: 'employee',
    nhanvien: 'employee',
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

function moduleFromDetailedPermission(permission) {
    if (permission === 'users.manage') {
        return 'users';
    }

    const segments = String(permission || '').split('.');
    if (segments.length !== 2) {
        return null;
    }

    const [module, action] = segments;
    return ADMIN_MODULE_IDS.has(module) && ADMIN_ACTION_IDS.has(action) ? module : null;
}

function fallbackModulePermissionForFeaturePermission(permission) {
    const segments = String(permission || '').split('.');
    if (segments.length < 3) {
        return null;
    }

    const module = segments[0];
    const action = segments[segments.length - 1];
    if (!ADMIN_MODULE_IDS.has(module) || !ADMIN_ACTION_IDS.has(action)) {
        return null;
    }

    return `${module}.${action}`;
}

export function permissionsForRole(role) {
    switch (normalizeRole(role)) {
        case 'owner':
            return unique([
                ...ADMIN_PERMISSION_OPTIONS.flatMap((module) => ADMIN_ACTION_OPTIONS.map((action) => `${module.id}.${action.id}`)),
                ...ADMIN_SPECIAL_PERMISSION_OPTIONS.map((permission) => permission.id),
            ]);
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
        case 'employee':
            return unique([
                ...modulePermissions(['dashboard'], ['view']),
                ...modulePermissions(['orders'], ['view', 'create', 'update', 'export']),
                ...modulePermissions(['payroll'], ['view']),
                ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.view,
                ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.create,
                ADMIN_INVENTORY_SHELF_LOCATION_PERMISSIONS.update,
                ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.view,
                ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.create,
                ADMIN_INVENTORY_REPLACEMENT_PERMISSIONS.update,
                ADMIN_INVENTORY_REPLACEMENT_LOOKUP_PERMISSION,
            ]);
        case 'viewer':
            return modulePermissions(['dashboard', 'products', 'orders', 'customers', 'leads', 'inventory', 'warehouses'], ['view']);
        default:
            return [];
    }
}

export function dataPermissionsForRole(role) {
    const normalizedRole = normalizeRole(role);

    if (['owner', 'manager'].includes(normalizedRole)) {
        return [...ADMIN_DATA_PERMISSION_OPTIONS.map((permission) => permission.id), ADMIN_PROFIT_SCOPE_ALL_PERMISSION];
    }

    if (['sale', 'warehouse', 'viewer'].includes(normalizedRole)) {
        return ['customer_phone.view'];
    }

    return [];
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
            expanded.push('users.manage', 'users.view', ADMIN_CHANGE_PASSWORD_PERMISSION);
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
        permission_label: account.pivot?.permission_label || '',
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

    const modules = detailedPermissions.map((permission) => {
        return moduleFromDetailedPermission(permission);
    });

    if (hasPayrollScopedAccess(user, accountId)) {
        modules.push('payroll');
    }

    return unique(modules);
}

export function hasAdminPermission(user, permission, accountId = readActiveAccountId()) {
    if (!user) return false;
    if (user.is_admin) return true;

    if (permission === 'payroll.view' && hasPayrollScopedAccess(user, accountId)) {
        return true;
    }

    const permissions = normalizeDetailedAdminPermissions(user, accountId);
    if (permissions.includes(permission)) return true;

    const [module] = String(permission || '').split('.');
    if (permission === 'users.manage') {
        return permissions.includes('users.update') || permissions.includes('users.*');
    }

    const fallbackModulePermission = fallbackModulePermissionForFeaturePermission(permission);
    if (fallbackModulePermission && permissions.includes(fallbackModulePermission)) {
        return true;
    }

    return permissions.includes(`${module}.*`);
}

function hasPayrollScopedAccess(user, accountId = readActiveAccountId()) {
    const scopedAccountIds = Array.isArray(user?.payroll_access_account_ids)
        ? user.payroll_access_account_ids.map((id) => String(id))
        : [];

    if (scopedAccountIds.length === 0) {
        return false;
    }

    const selectedAccountId = String(accountId || '').trim();
    return selectedAccountId ? scopedAccountIds.includes(selectedAccountId) : true;
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
