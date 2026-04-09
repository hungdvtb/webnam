export const ADMIN_PERMISSION_OPTIONS = [
    { id: 'dashboard', label: 'Tong quan' },
    { id: 'accounts', label: 'Danh sach cua hang' },
    { id: 'products', label: 'Quan ly san pham' },
    { id: 'categories', label: 'Danh muc san pham' },
    { id: 'orders', label: 'Quan ly don hang' },
    { id: 'customers', label: 'Quan ly khach hang' },
    { id: 'leads', label: 'Xu ly lead' },
    { id: 'inventory', label: 'Quan ly ton kho' },
    { id: 'warehouses', label: 'Quan ly kho van' },
    { id: 'attributes', label: 'Thuoc tinh' },
    { id: 'settings', label: 'Cau hinh website' },
    { id: 'menus', label: 'Menu va dieu huong' },
    { id: 'users', label: 'Quan ly nguoi dung' },
    { id: 'blog', label: 'Bai viet tren web' },
    { id: 'reports', label: 'Bao cao va phan tich' },
];

export const LEGACY_ADMIN_PERMISSION_IDS = ADMIN_PERMISSION_OPTIONS.map((permission) => permission.id);

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

export function normalizeAdminPermissions(user) {
    if (!user || user.is_admin) {
        return [];
    }

    const parsedPermissions = parsePermissionPayload(user.permissions);
    const effectivePermissions = parsedPermissions === null
        ? LEGACY_ADMIN_PERMISSION_IDS
        : parsedPermissions;

    return effectivePermissions.filter((permission) => typeof permission === 'string' && permission.trim());
}
