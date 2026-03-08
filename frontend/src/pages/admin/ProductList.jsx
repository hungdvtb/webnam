import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { productApi, categoryApi, attributeApi } from '../../services/api';

const TYPE_LABELS = {
    simple: { label: 'Simple', cls: 'bg-stone/10 text-stone border-stone/20' },
    configurable: { label: 'Configurable', cls: 'bg-primary/15 text-primary border-primary/30' },
    grouped: { label: 'Grouped', cls: 'bg-umber/15 text-umber border-umber/30' },
    bundle: { label: 'Bundle', cls: 'bg-gold/20 text-gold border-gold/30' },
    virtual: { label: 'Virtual', cls: 'bg-brick/10 text-brick border-brick/20' },
    downloadable: { label: 'Downloadable', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
};

const DEFAULT_COLUMNS = [
    { id: 'id', label: 'ID', minWidth: '60px', fixed: true },
    { id: 'image', label: 'Ảnh', minWidth: '80px', fixed: true },
    { id: 'name', label: 'Phẩm vật', minWidth: '200px', fixed: true },
    { id: 'type', label: 'Loại hình', minWidth: '100px' },
    { id: 'category', label: 'Danh mục', minWidth: '120px' },
    { id: 'price', label: 'Giá bán', minWidth: '120px' },
    { id: 'stock', label: 'Tồn kho', minWidth: '80px' },
    { id: 'is_featured', label: 'Nổi bật', minWidth: '80px', align: 'center' },
    { id: 'is_new', label: 'Mới', minWidth: '80px', align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: '100px', align: 'right', fixed: true },
];

const ProductList = () => {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showColumnSettings, setShowColumnSettings] = useState(false);

    // Column state
    const [visibleColumns, setVisibleColumns] = useState([]);
    const [availableColumns, setAvailableColumns] = useState([]);

    const [pagination, setPagination] = useState({
        current_page: 1,
        last_page: 1,
        total: 0,
        per_page: 20
    });

    const [filters, setFilters] = useState({
        search: '',
        category_id: '',
        type: '',
        is_featured: '',
        is_new: '',
        min_price: '',
        max_price: '',
        min_stock: '',
        max_stock: '',
        start_date: '',
        end_date: '',
        attributes: {} // { attribute_id: [values] }
    });

    useEffect(() => {
        fetchInitialData();
        fetchProducts(1);
    }, []);

    const fetchInitialData = async () => {
        try {
            const [catRes, attrRes] = await Promise.all([
                categoryApi.getAll(),
                attributeApi.getAll()
            ]);
            setCategories(catRes.data);
            setAllAttributes(attrRes.data);

            // Build full column list
            const attrColumns = attrRes.data.map(attr => ({
                id: `attr_${attr.id}`,
                label: attr.name,
                minWidth: '100px',
                isAttribute: true,
                attrId: attr.id
            }));

            const combinedColumns = [...DEFAULT_COLUMNS.slice(0, -1), ...attrColumns, DEFAULT_COLUMNS[DEFAULT_COLUMNS.length - 1]];
            setAvailableColumns(combinedColumns);

            // Try to load from localStorage or set defaults
            const savedColumns = localStorage.getItem('product_list_columns');
            if (savedColumns) {
                setVisibleColumns(JSON.parse(savedColumns));
            } else {
                // Default visible: fixed ones + type, category, price, stock
                const defaultVisible = combinedColumns.filter(c =>
                    c.fixed || ['type', 'category', 'price', 'stock'].includes(c.id)
                ).map(c => c.id);
                setVisibleColumns(defaultVisible);
            }
        } catch (error) {
            console.error("Error fetching initial data", error);
        }
    };

    const fetchProducts = async (page = 1, currentFilters = filters) => {
        setLoading(true);
        try {
            const params = { ...currentFilters, page, per_page: pagination.per_page };

            if (params.attributes) {
                Object.entries(params.attributes).forEach(([id, val]) => {
                    if (val && val.length > 0) {
                        params[`attributes[${id}]`] = Array.isArray(val) ? val.join(',') : val;
                    }
                });
                delete params.attributes;
            }

            Object.keys(params).forEach(key => {
                if (params[key] === '' || params[key] === null || params[key] === undefined) {
                    delete params[key];
                }
            });

            const response = await productApi.getAll(params);
            setProducts(response.data.data);
            setPagination({
                current_page: response.data.current_page,
                last_page: response.data.last_page,
                total: response.data.total,
                per_page: response.data.per_page
            });
        } catch (error) {
            console.error("Error fetching admin products", error);
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleAttributeFilterChange = (attrId, value) => {
        setFilters(prev => {
            const currentValues = prev.attributes[attrId] || [];
            let newValues;

            if (currentValues.includes(value)) {
                newValues = currentValues.filter(v => v !== value);
            } else {
                newValues = [...currentValues, value];
            }

            return {
                ...prev,
                attributes: {
                    ...prev.attributes,
                    [attrId]: newValues
                }
            };
        });
    };

    const handleReset = () => {
        const resetFilters = {
            search: '',
            category_id: '',
            type: '',
            is_featured: '',
            is_new: '',
            min_price: '',
            max_price: '',
            min_stock: '',
            max_stock: '',
            start_date: '',
            end_date: '',
            attributes: {}
        };
        setFilters(resetFilters);
        fetchProducts(1, resetFilters);
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Quý khách có chắc chắn muốn xóa phẩm vật này không?')) return;
        try {
            await productApi.destroy(id);
            fetchProducts(pagination.current_page);
        } catch (error) {
            alert('Có lỗi xảy ra khi xóa sản phẩm.');
        }
    };

    const getPrimaryImage = (product) => {
        const primary = product.images?.find(img => img.is_primary);
        return primary?.image_url || product.images?.[0]?.image_url || null;
    };

    const toggleColumn = (columnId) => {
        let newVisible;
        if (visibleColumns.includes(columnId)) {
            newVisible = visibleColumns.filter(id => id !== columnId);
        } else {
            newVisible = [...visibleColumns, columnId];
        }
        setVisibleColumns(newVisible);
        localStorage.setItem('product_list_columns', JSON.stringify(newVisible));
    };

    const moveColumn = (index, direction) => {
        const newAvailable = [...availableColumns];
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= newAvailable.length) return;

        const temp = newAvailable[index];
        newAvailable[index] = newAvailable[newIndex];
        newAvailable[newIndex] = temp;

        setAvailableColumns(newAvailable);
        // We don't necessarily update visibleColumns order here, but the rendering depends on availableColumns
    };

    const getAttributeValue = (product, attrId) => {
        const valObj = product.attribute_values?.find(av => av.attribute_id === attrId);
        if (!valObj) return '-';

        try {
            const parsed = JSON.parse(valObj.value);
            return Array.isArray(parsed) ? parsed.join(', ') : parsed;
        } catch (e) {
            return valObj.value;
        }
    };

    const renderedColumns = availableColumns.filter(col => visibleColumns.includes(col.id));

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary text-shadow-sm">Quản Lý Phẩm Vật</h1>
                    <p className="text-[10px] font-bold text-stone uppercase tracking-widest mt-1 border-l-2 border-gold pl-2">
                        {pagination.total} sản phẩm tổng cộng
                    </p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={() => setShowColumnSettings(!showColumnSettings)}
                        className={`px-6 py-3 font-ui font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 transition-all border ${showColumnSettings ? 'bg-gold text-white border-gold' : 'bg-white text-gold border-gold/30 hover:bg-gold/5 shadow-sm'}`}
                    >
                        <span className="material-symbols-outlined text-base">view_column</span>
                        Cấu hình cột
                    </button>
                    <Link to="/admin/products/new" className="bg-primary text-white px-8 py-3 font-ui font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-umber transition-all shadow-lg hover:shadow-primary/40 transform hover:-translate-y-0.5 active:translate-y-0 text-[10px]">
                        <span className="material-symbols-outlined text-base">add</span>
                        Thêm phẩm vật mới
                    </Link>
                </div>
            </div>

            {/* Column Settings Panel */}
            {showColumnSettings && (
                <div className="bg-white border-2 border-gold/20 p-8 shadow-2xl animate-in fade-in zoom-in duration-200 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-gold"></div>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-display text-xl font-bold text-primary flex items-center gap-2">
                            <span className="material-symbols-outlined">settings_suggest</span>
                            Tùy chỉnh hiển thị bảng
                        </h3>
                        <button onClick={() => setShowColumnSettings(false)} className="text-stone hover:text-brick transition-colors">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <p className="text-xs text-stone mb-6 italic">Kéo thả để sắp xếp thứ tự hoặc tích chọn để ẩn/hiện các cột thông tin.</p>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {availableColumns.map((col, idx) => (
                            <div
                                key={col.id}
                                className={`p-3 border flex items-center justify-between group transition-all ${visibleColumns.includes(col.id) ? 'border-primary/30 bg-primary/5' : 'border-stone/10 bg-stone/5 opacity-60'}`}
                            >
                                <label className="flex items-center gap-2 cursor-pointer flex-grow">
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.includes(col.id)}
                                        onChange={() => toggleColumn(col.id)}
                                        className="size-3 text-primary rounded border-gold/30"
                                    />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone truncate" title={col.label}>{col.label}</span>
                                </label>
                                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => moveColumn(idx, -1)} disabled={idx === 0} className="size-4 flex items-center justify-center hover:bg-gold/20 rounded disabled:opacity-0"><span className="material-symbols-outlined text-[10px]">keyboard_arrow_up</span></button>
                                    <button onClick={() => moveColumn(idx, 1)} disabled={idx === availableColumns.length - 1} className="size-4 flex items-center justify-center hover:bg-gold/20 rounded disabled:opacity-0"><span className="material-symbols-outlined text-[10px]">keyboard_arrow_down</span></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white border border-gold/10 shadow-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gold/5 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none"></div>

                {/* Filter Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8 items-end">
                    <div className="lg:col-span-2 space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary block">Tìm kiếm</label>
                        <div className="relative">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gold text-lg">search</span>
                            <input
                                type="text"
                                name="search"
                                placeholder="Tên sản phẩm, SKU..."
                                className="w-full bg-stone/5 border border-gold/20 p-3 pl-10 focus:outline-none focus:border-primary font-body text-sm"
                                value={filters.search}
                                onChange={handleFilterChange}
                                onKeyPress={(e) => e.key === 'Enter' && fetchProducts(1)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary block">Danh mục</label>
                        <select
                            name="category_id"
                            className="w-full bg-stone/5 border border-gold/20 p-3 focus:outline-none focus:border-primary font-body text-sm appearance-none"
                            value={filters.category_id}
                            onChange={handleFilterChange}
                        >
                            <option value="">Tất cả danh mục</option>
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary block">Loại hình</label>
                        <select
                            name="type"
                            className="w-full bg-stone/5 border border-gold/20 p-3 focus:outline-none focus:border-primary font-body text-sm appearance-none"
                            value={filters.type}
                            onChange={handleFilterChange}
                        >
                            <option value="">Tất cả loại</option>
                            {Object.entries(TYPE_LABELS).map(([key, info]) => (
                                <option key={key} value={key}>{info.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary block">Trạng thái</label>
                        <select
                            name="is_featured"
                            className="w-full bg-stone/5 border border-gold/20 p-3 focus:outline-none focus:border-primary font-body text-sm appearance-none"
                            value={filters.is_featured}
                            onChange={handleFilterChange}
                        >
                            <option value="">Tất cả (Nổi bật)</option>
                            <option value="1">Sản phẩm nổi bật</option>
                            <option value="0">Sản phẩm thường</option>
                        </select>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => fetchProducts(1)}
                            className="flex-grow bg-primary text-white p-3 font-ui font-bold uppercase tracking-widest text-[10px] hover:bg-umber transition-all shadow-md"
                        >
                            Lọc
                        </button>
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className={`p-3 font-ui font-bold uppercase tracking-widest text-[10px] transition-all border ${showAdvanced ? 'bg-gold text-white border-gold' : 'bg-transparent text-gold border-gold/30 hover:bg-gold/5'}`}
                            title="Bộ lọc nâng cao"
                        >
                            <span className="material-symbols-outlined text-sm">settings_input_component</span>
                        </button>
                        <button
                            onClick={handleReset}
                            className="bg-stone/10 text-stone p-3 font-ui font-bold uppercase tracking-widest text-[10px] hover:bg-stone/20 transition-all border border-stone/20"
                            title="Xóa bộ lọc"
                        >
                            <span className="material-symbols-outlined text-sm">filter_alt_off</span>
                        </button>
                    </div>
                </div>

                {/* Advanced Filters */}
                {showAdvanced && (
                    <div className="mb-8 p-6 bg-stone/5 border-l-4 border-gold space-y-8 animate-in slide-in-from-top duration-300">
                        <div>
                            <h3 className="font-ui text-[10px] font-bold uppercase tracking-widest text-gold flex items-center gap-2 mb-4">
                                <span className="material-symbols-outlined text-sm">straighten</span>
                                Khoảng giới hạn (Range Filters)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <label className="font-ui text-[9px] font-bold uppercase tracking-widest text-primary block">Khoảng giá (VNĐ)</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            name="min_price"
                                            placeholder="Thấp nhất"
                                            className="w-full bg-white border border-gold/20 p-2 text-xs font-mono"
                                            value={filters.min_price}
                                            onChange={handleFilterChange}
                                        />
                                        <span className="text-gold">-</span>
                                        <input
                                            type="number"
                                            name="max_price"
                                            placeholder="Cao nhất"
                                            className="w-full bg-white border border-gold/20 p-2 text-xs font-mono"
                                            value={filters.max_price}
                                            onChange={handleFilterChange}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="font-ui text-[9px] font-bold uppercase tracking-widest text-primary block">Khoảng tồn kho</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            name="min_stock"
                                            placeholder="Tối thiểu"
                                            className="w-full bg-white border border-gold/20 p-2 text-xs font-mono"
                                            value={filters.min_stock}
                                            onChange={handleFilterChange}
                                        />
                                        <span className="text-gold">-</span>
                                        <input
                                            type="number"
                                            name="max_stock"
                                            placeholder="Tối đa"
                                            className="w-full bg-white border border-gold/20 p-2 text-xs font-mono"
                                            value={filters.max_stock}
                                            onChange={handleFilterChange}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="font-ui text-[9px] font-bold uppercase tracking-widest text-primary block">Ngày tạo</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="date"
                                            name="start_date"
                                            className="w-full bg-white border border-gold/20 p-2 text-xs"
                                            value={filters.start_date}
                                            onChange={handleFilterChange}
                                        />
                                        <span className="text-gold">→</span>
                                        <input
                                            type="date"
                                            name="end_date"
                                            className="w-full bg-white border border-gold/20 p-2 text-xs"
                                            value={filters.end_date}
                                            onChange={handleFilterChange}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {allAttributes.filter(a => a.is_filterable).length > 0 && (
                            <div>
                                <div className="flex items-center justify-between mb-4 border-t border-gold/10 pt-6">
                                    <h3 className="font-ui text-[10px] font-bold uppercase tracking-widest text-gold flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">tune</span>
                                        Thuộc tính phẩm vật (Chọn nhiều)
                                    </h3>
                                    <button
                                        onClick={() => setFilters(prev => ({ ...prev, attributes: {} }))}
                                        className="text-[9px] font-bold text-stone uppercase hover:text-brick transition-colors"
                                    >
                                        Xóa các thuộc tính
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                                    {allAttributes.filter(a => a.is_filterable).map(attr => (
                                        <div key={attr.id} className="space-y-3">
                                            <label className="font-ui text-[9px] font-bold uppercase tracking-widest text-primary block border-b border-gold/10 pb-1">{attr.name}</label>
                                            {attr.options && attr.options.length > 0 ? (
                                                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                                                    {attr.options.map(opt => (
                                                        <label key={opt.id} className="flex items-center gap-2 cursor-pointer group">
                                                            <input
                                                                type="checkbox"
                                                                className="size-3 text-primary border-gold/30 rounded focus:ring-primary focus:ring-1"
                                                                checked={(filters.attributes[attr.id] || []).includes(opt.value)}
                                                                onChange={() => handleAttributeFilterChange(attr.id, opt.value)}
                                                            />
                                                            <span className="text-[11px] text-stone group-hover:text-primary transition-colors">{opt.value}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            ) : (
                                                <input
                                                    type="text"
                                                    className="w-full bg-white border border-gold/20 p-2 text-[11px] font-body italic"
                                                    placeholder={`Nhập ${attr.name.toLowerCase()}...`}
                                                    value={filters.attributes[attr.id] || ''}
                                                    onChange={(e) => handleAttributeFilterChange(attr.id, e.target.value)}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Table Section */}
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-max">
                        <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                            <tr>
                                {renderedColumns.map(col => (
                                    <th
                                        key={col.id}
                                        className={`p-4 ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`}
                                        style={{ minWidth: col.minWidth }}
                                    >
                                        {col.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="font-body">
                            {products.map((product) => {
                                const typeInfo = TYPE_LABELS[product.type] || TYPE_LABELS.simple;
                                const imgUrl = getPrimaryImage(product);
                                return (
                                    <tr key={product.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                        {renderedColumns.map(col => {
                                            // Handle each column type
                                            if (col.id === 'id') return <td key={col.id} className="p-4 text-xs text-stone font-mono">#{product.id}</td>;

                                            if (col.id === 'image') return (
                                                <td key={col.id} className="p-4">
                                                    <div className="size-12 bg-background-light flex-shrink-0 border border-gold/10 overflow-hidden shadow-inner">
                                                        {imgUrl ? (
                                                            <img src={imgUrl} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-110" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-stone/30">
                                                                <span className="material-symbols-outlined text-xl">image</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            );

                                            if (col.id === 'name') return (
                                                <td key={col.id} className="p-4">
                                                    <div>
                                                        <p className="font-bold text-primary group-hover:text-gold transition-colors text-sm">{product.name}</p>
                                                        <p className="text-[9px] text-stone font-mono uppercase tracking-wider mt-0.5 opacity-60">{product.sku}</p>
                                                    </div>
                                                </td>
                                            );

                                            if (col.id === 'type') return (
                                                <td key={col.id} className="p-4">
                                                    <span className={`px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${typeInfo.cls} rounded-[1px]`}>
                                                        {typeInfo.label}
                                                    </span>
                                                </td>
                                            );

                                            if (col.id === 'category') return <td key={col.id} className="p-4 italic text-stone text-xs">{product.category?.name}</td>;

                                            if (col.id === 'price') return (
                                                <td key={col.id} className="p-4 font-ui font-bold text-brick text-sm">
                                                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}
                                                </td>
                                            );

                                            if (col.id === 'stock') return (
                                                <td key={col.id} className={`p-4 text-sm font-mono ${product.stock_quantity <= 5 ? 'text-brick font-bold' : 'text-stone'}`}>
                                                    {product.stock_quantity || 0}
                                                </td>
                                            );

                                            if (col.id === 'is_featured') return (
                                                <td key={col.id} className="p-4 text-center">
                                                    {product.is_featured ? (
                                                        <span className="material-symbols-outlined text-gold text-lg drop-shadow-sm">star</span>
                                                    ) : (
                                                        <span className="material-symbols-outlined text-stone/20 text-lg">star</span>
                                                    )}
                                                </td>
                                            );

                                            if (col.id === 'is_new') return (
                                                <td key={col.id} className="p-4 text-center">
                                                    {product.is_new ? (
                                                        <span className="inline-block bg-brick/10 text-brick text-[7px] font-bold uppercase px-1.5 py-0.5 tracking-wider border border-brick/20 rounded-[1px]">New</span>
                                                    ) : (
                                                        <span className="text-stone/20 text-xs">-</span>
                                                    )}
                                                </td>
                                            );

                                            if (col.isAttribute) return (
                                                <td key={col.id} className="p-4 text-xs text-stone italic">
                                                    {getAttributeValue(product, col.attrId)}
                                                </td>
                                            );

                                            if (col.id === 'actions') return (
                                                <td key={col.id} className="p-4 text-right">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                                                        <Link to={`/admin/products/edit/${product.id}`} className="size-8 flex items-center justify-center bg-primary/5 text-primary hover:bg-primary hover:text-white transition-all rounded-full border border-primary/10">
                                                            <span className="material-symbols-outlined text-sm">edit</span>
                                                        </Link>
                                                        <button onClick={() => handleDelete(product.id)} className="size-8 flex items-center justify-center bg-brick/5 text-brick hover:bg-brick hover:text-white transition-all rounded-full border border-brick/10">
                                                            <span className="material-symbols-outlined text-sm">delete</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );

                                            return <td key={col.id}></td>;
                                        })}
                                    </tr>
                                );
                            })}
                            {!loading && products.length === 0 && (
                                <tr>
                                    <td colSpan={renderedColumns.length} className="p-20 text-center text-stone italic font-body">
                                        <span className="material-symbols-outlined text-4xl block mb-2 opacity-20">inventory_2</span>
                                        Không tìm thấy phẩm vật nào phù hợp.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination UI */}
                {!loading && pagination.last_page > 1 && (
                    <div className="mt-8 flex items-center justify-between border-t border-gold/10 pt-6">
                        <p className="text-[10px] font-bold text-stone uppercase tracking-widest">
                            Trang {pagination.current_page} / {pagination.last_page}
                        </p>
                        <div className="flex gap-2">
                            <button
                                disabled={pagination.current_page === 1}
                                onClick={() => fetchProducts(pagination.current_page - 1)}
                                className="size-10 flex items-center justify-center border border-gold/20 text-gold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gold/5 transition-colors"
                            >
                                <span className="material-symbols-outlined text-base">chevron_left</span>
                            </button>

                            {[...Array(pagination.last_page)].map((_, i) => {
                                const page = i + 1;
                                if (page === 1 || page === pagination.last_page || Math.abs(page - pagination.current_page) <= 1) {
                                    return (
                                        <button
                                            key={page}
                                            onClick={() => fetchProducts(page)}
                                            className={`size-10 flex items-center justify-center border font-ui font-bold text-[10px] transition-all ${pagination.current_page === page ? 'bg-primary border-primary text-white shadow-lg' : 'border-gold/20 text-stone hover:bg-gold/5'}`}
                                        >
                                            {page}
                                        </button>
                                    );
                                }
                                if (page === 2 || page === pagination.last_page - 1) {
                                    return <span key={page} className="size-10 flex items-center justify-center text-stone/30">...</span>;
                                }
                                return null;
                            })}

                            <button
                                disabled={pagination.current_page === pagination.last_page}
                                onClick={() => fetchProducts(pagination.current_page + 1)}
                                className="size-10 flex items-center justify-center border border-gold/20 text-gold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gold/5 transition-colors"
                            >
                                <span className="material-symbols-outlined text-base">chevron_right</span>
                            </button>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <div className="size-12 border-4 border-gold/20 border-t-gold rounded-full animate-spin"></div>
                            <span className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Đang nạp phẩm vật...</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductList;
