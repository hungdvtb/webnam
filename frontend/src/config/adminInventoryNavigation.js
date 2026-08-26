export const DEFAULT_INVENTORY_SECTION_KEY = 'products';

export const INVENTORY_NAV_ITEMS = [
    { key: 'products', slug: 'ton-kho', label: 'Tồn kho', icon: 'inventory_2' },
    { key: 'imports', slug: 'phieu-nhap', label: 'Phiếu nhập', icon: 'inventory_2' },
    { key: 'shelfLocations', slug: 'vi-tri-ke', label: 'Vị trí kệ', icon: 'shelves' },
    { key: 'replacements', slug: 'ma-thay-the', label: 'Mã thay thế', icon: 'rule' },
    { key: 'replacementLookup', slug: 'tra-ma-kho', label: 'Tra mã kho', icon: 'qr_code_scanner' },
    { key: 'suppliers', slug: 'nha-cung-cap', label: 'Nhà cung cấp', icon: 'storefront' },
    { key: 'supplierPrices', slug: 'gia-nhap-tung-nha', label: 'Giá nhập từng nhà', icon: 'request_quote' },
    { key: 'exports', slug: 'phieu-xuat', label: 'Phiếu xuất', icon: 'shopping_cart' },
    { key: 'returns', slug: 'phieu-hoan', label: 'Phiếu hoàn', icon: 'assignment_return' },
    { key: 'damaged', slug: 'phieu-hong', label: 'Phiếu hỏng', icon: 'broken_image' },
    { key: 'adjustments', slug: 'phieu-dieu-chinh', label: 'Phiếu điều chỉnh', icon: 'tune' },
    { key: 'trash', slug: 'thung-rac', label: 'Thùng rác', icon: 'delete' },
];

const inventoryItemByKey = new Map(INVENTORY_NAV_ITEMS.map((item) => [item.key, item]));
const inventoryItemBySlug = new Map(INVENTORY_NAV_ITEMS.map((item) => [item.slug, item]));

export const resolveInventorySectionKey = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return null;
    if (inventoryItemByKey.has(normalizedValue)) return normalizedValue;
    return inventoryItemBySlug.get(normalizedValue)?.key || null;
};

export const getInventoryNavItem = (value) => {
    const resolvedKey = resolveInventorySectionKey(value);
    return resolvedKey ? inventoryItemByKey.get(resolvedKey) || null : null;
};

export const buildInventoryPath = (value = DEFAULT_INVENTORY_SECTION_KEY) => {
    const resolvedKey = resolveInventorySectionKey(value) || DEFAULT_INVENTORY_SECTION_KEY;
    return `/admin/inventory/${inventoryItemByKey.get(resolvedKey).slug}`;
};
