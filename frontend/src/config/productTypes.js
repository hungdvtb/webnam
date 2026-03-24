export const ACTIVE_PRODUCT_TYPE_OPTIONS = [
    { value: 'simple', label: 'Sản phẩm đơn' },
    { value: 'configurable', label: 'Có biến thể' },
    { value: 'bundle', label: 'Bộ / Combo' },
    { value: 'grouped', label: 'Nhóm sản phẩm' },
];

export const ACTIVE_PRODUCT_TYPE_KEYS = ACTIVE_PRODUCT_TYPE_OPTIONS.map((option) => option.value);
export const ACTIVE_PRODUCT_TYPE_SET = new Set(ACTIVE_PRODUCT_TYPE_KEYS);

export const sanitizeActiveProductTypeValues = (values) => {
    const source = Array.isArray(values)
        ? values
        : values == null
            ? []
            : [values];

    return Array.from(
        new Set(
            source
                .map((value) => String(value).trim())
                .filter(Boolean)
                .filter((value) => ACTIVE_PRODUCT_TYPE_SET.has(value))
        )
    );
};

export const PRODUCT_TYPE_FORM_META = {
    simple: { label: 'Sản phẩm đơn', icon: 'inventory_2', desc: 'Không có biến thể. VD: Bình gốm cụ thể.' },
    configurable: { label: 'Có biến thể', icon: 'settings_input_component', desc: 'Biến thể theo màu men, nghệ nhân...' },
    bundle: { label: 'Bộ / Combo', icon: 'inventory', desc: 'Combo sản phẩm linh hoạt.' },
    grouped: { label: 'Nhóm sản phẩm', icon: 'group_work', desc: 'Nhóm nhiều sản phẩm đơn lại.' },
};

export const PRODUCT_TYPE_META = {
    simple: { label: 'Sản phẩm đơn', cls: 'bg-primary/10 text-primary border-primary/30' },
    configurable: { label: 'Có biến thể', cls: 'bg-primary/10 text-primary border-primary/20' },
    bundle: { label: 'Bộ / Combo', cls: 'bg-gold/15 text-gold border-gold/30' },
    grouped: { label: 'Nhóm sản phẩm', cls: 'bg-umber/10 text-umber border-umber/20' },
    downloadable: { label: 'Tài liệu số', cls: 'bg-blue-50 text-blue-900 border-blue-200' },
};

export const PRODUCT_TYPE_LABELS = Object.fromEntries(
    Object.entries(PRODUCT_TYPE_META).map(([value, meta]) => [value, meta.label])
);
