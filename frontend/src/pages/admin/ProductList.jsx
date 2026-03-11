import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { productApi, categoryApi, attributeApi } from '../../services/api';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';

const TYPE_LABELS = {
    simple: { label: 'Sản phẩm đơn', cls: 'bg-stone/10 text-stone border-stone/20' },
    configurable: { label: 'Sản phẩm có biến thể', cls: 'bg-primary/15 text-primary border-primary/30' },
    grouped: { label: 'Nhóm sản phẩm', cls: 'bg-umber/15 text-umber border-umber/30' },
    bundle: { label: 'Bộ sản phẩm (Combo)', cls: 'bg-gold/20 text-gold border-gold/30' },
    virtual: { label: 'Dịch vụ/Phi vật thể', cls: 'bg-brick/10 text-brick border-brick/20' },
    downloadable: { label: 'Tài liệu/Dữ liệu số', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
};

const DEFAULT_COLUMNS = [
    { id: 'sku', label: 'Mã SP', minWidth: '130px', fixed: true },
    { id: 'name', label: 'Tên Sản Phẩm', minWidth: '220px', fixed: true },
    { id: 'cost_price', label: 'Giá nhập', minWidth: '120px' },
    { id: 'price', label: 'Giá bán', minWidth: '120px' },
    { id: 'image', label: 'Ảnh', minWidth: '80px' },
    { id: 'type', label: 'Loại hình', minWidth: '110px' },
    { id: 'category', label: 'Danh mục', minWidth: '120px' },
    { id: 'stock', label: 'Tồn kho', minWidth: '80px' },
    { id: 'is_featured', label: 'Nổi bật', minWidth: '80px', align: 'center' },
    { id: 'is_new', label: 'Mới', minWidth: '80px', align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: '100px', align: 'right', fixed: true },
];

function getPrimaryImage(product) {
    const primary = product.images?.find(img => img.is_primary);
    return primary?.image_url || product.images?.[0]?.image_url || null;
}

const ProductList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const filterRef = useRef(null);
    const columnSettingsRef = useRef(null);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState([]);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const [isTrashView, setIsTrashView] = useState(false);
    const [copiedText, setCopiedText] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);

    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState("");
    const [justUpdatedId, setJustUpdatedId] = useState(null);

    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState({
        search: '', category_id: '', type: '', is_featured: '', is_new: '',
        min_price: '', max_price: '', min_stock: '', max_stock: '', start_date: '', end_date: '',
        attributes: {}
    });

    const [sortConfig, setSortConfig] = useState(() => {
        const saved = localStorage.getItem('product_list_sort');
        return saved ? JSON.parse(saved) : { key: 'created_at', direction: 'desc', phase: 1 };
    });

    const {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
        setAvailableColumns,
        setVisibleColumns
    } = useTableColumns('product_list', DEFAULT_COLUMNS);

    useEffect(() => {
        fetchInitialData();
        fetchProducts(1);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterRef.current && !filterRef.current.contains(event.target) && !event.target.closest('[data-filter-btn]')) setShowAdvanced(false);
            if (columnSettingsRef.current && !columnSettingsRef.current.contains(event.target) && !event.target.closest('[data-column-settings-btn]')) setShowColumnSettings(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => { if (e.key === 'Escape') { setShowAdvanced(false); setShowColumnSettings(false); setPreviewImage(null); } };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => { fetchProducts(1); }, [isTrashView]);

    const fetchInitialData = async () => {
        try {
            const [catRes, attrRes] = await Promise.all([categoryApi.getAll(), attributeApi.getAll()]);
            setCategories(catRes.data || []);
            setAllAttributes(attrRes.data || []);

            const attrColumns = (attrRes.data || []).map(attr => ({
                id: `attr_${attr.id}`,
                label: attr.name,
                minWidth: '150px',
                isAttribute: true,
                attrId: attr.id
            }));

            const combinedColumns = [...DEFAULT_COLUMNS.slice(0, -1), ...attrColumns, DEFAULT_COLUMNS[DEFAULT_COLUMNS.length - 1]];

            const savedOrder = localStorage.getItem('product_list_column_order');
            let sortedColumns = [...combinedColumns];
            if (savedOrder) {
                const orderIds = JSON.parse(savedOrder);
                sortedColumns = [...combinedColumns].sort((a, b) => {
                    const indexA = orderIds.indexOf(a.id);
                    const indexB = orderIds.indexOf(b.id);
                    if (indexA === -1 && indexB === -1) return 0;
                    if (indexA === -1) return 1;
                    if (indexB === -1) return -1;
                    return indexA - indexB;
                });
            }
            setAvailableColumns(sortedColumns);

            const savedVisible = localStorage.getItem('product_list_columns');
            if (savedVisible) {
                setVisibleColumns(JSON.parse(savedVisible));
            } else {
                setVisibleColumns(sortedColumns.map(c => c.id));
            }
        } catch (error) { console.error("Error fetching initial data", error); }
    };

    const fetchProducts = async (page = 1, currentFilters = filters, currentSort = sortConfig) => {
        setLoading(true);
        try {
            const params = {
                ...currentFilters, page, per_page: pagination.per_page, trashed: isTrashView ? 1 : 0,
                sort_by: currentSort.direction === 'none' ? 'id' : currentSort.key,
                sort_order: currentSort.direction === 'none' ? 'desc' : currentSort.direction
            };

            if (params.attributes) {
                Object.entries(params.attributes).forEach(([id, val]) => {
                    if (val && (Array.isArray(val) ? val.length > 0 : val !== '')) {
                        params[`attributes[${id}]`] = Array.isArray(val) ? val.join(',') : val;
                    }
                });
                delete params.attributes;
            }

            const response = await productApi.getAll(params);
            setProducts(response.data.data);
            setPagination({
                current_page: response.data.current_page,
                last_page: response.data.last_page,
                total: response.data.total,
                per_page: response.data.per_page
            });
        } catch (error) { console.error("Error fetching products", error); } finally { setLoading(false); }
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleAttributeFilterChange = (attrId, value) => {
        setFilters(prev => {
            const currentValues = prev.attributes[attrId] || [];
            let newValues;
            if (currentValues.includes(value)) newValues = currentValues.filter(v => v !== value);
            else newValues = [...currentValues, value];
            return { ...prev, attributes: { ...prev.attributes, [attrId]: newValues } };
        });
    };

    const handleReset = () => {
        const resetFilters = { search: '', category_id: '', type: '', is_featured: '', is_new: '', min_price: '', max_price: '', min_stock: '', max_stock: '', start_date: '', end_date: '', attributes: {} };
        const defaultSort = { key: 'id', direction: 'desc', phase: 1 };
        setFilters(resetFilters);
        setSortConfig(defaultSort);
        fetchProducts(1, resetFilters, defaultSort);
    };

    const handleRefresh = () => fetchProducts(1);

    const toggleSelectAll = () => {
        if (selectedIds.length === products.length) setSelectedIds([]);
        else setSelectedIds(products.map(p => p.id));
    };

    const toggleSelectProduct = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
    };

    const handleBulkDelete = async () => {
        if (!window.confirm(`Xóa ${selectedIds.length} sản phẩm?`)) return;
        setLoading(true);
        try {
            await Promise.all(selectedIds.map(id => productApi.destroy(id, isTrashView)));
            setSelectedIds([]);
            fetchProducts(pagination.current_page);
        } catch (error) { alert("Lỗi khi xóa!"); } finally { setLoading(false); }
    };

    const handleBulkRestore = async () => {
        if (!window.confirm(`Khôi phục ${selectedIds.length} sản phẩm?`)) return;
        setLoading(true);
        try {
            await Promise.all(selectedIds.map(id => productApi.restore(id)));
            setSelectedIds([]);
            fetchProducts(pagination.current_page);
        } catch (error) { alert("Lỗi khi khôi phục!"); } finally { setLoading(false); }
    };

    const handleBulkDuplicate = async () => {
        setLoading(true);
        try {
            await Promise.all(selectedIds.map(id => productApi.duplicate(id)));
            setSelectedIds([]);
            fetchProducts(pagination.current_page);
        } catch (error) { alert("Lỗi khi nhân bản!"); } finally { setLoading(false); }
    };

    const handleCopy = (text, e) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedText(text);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleSaveInlineEdit = async () => {
        if (!editingCell) return;
        const { id, field } = editingCell;
        try {
            setLoading(true);
            await productApi.update(id, { [field]: editValue });
            setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: editValue } : p));
            setJustUpdatedId(id);
            setTimeout(() => setJustUpdatedId(null), 2000);
        } catch (error) { alert("Lỗi!"); } finally { setEditingCell(null); setLoading(false); }
    };

    const handleSort = (columnId) => {
        const validSortColumns = ['id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 'created_at', 'type'];
        let key = columnId === 'stock' ? 'stock_quantity' : columnId;
        if (key === 'actions') return;
        if (!validSortColumns.includes(key)) return;

        let newSort;
        if (sortConfig.key !== key) {
            newSort = { key, direction: 'desc', phase: 1 };
        } else {
            const nextPhase = ((sortConfig.phase || 1) % 3) + 1;
            if (nextPhase === 3) newSort = { key: 'id', direction: 'desc', phase: 1 };
            else newSort = { key, direction: nextPhase === 2 ? 'asc' : 'desc', phase: nextPhase };
        }
        setSortConfig(newSort);
        localStorage.setItem('product_list_sort', JSON.stringify(newSort));
        fetchProducts(1, filters, newSort);
    };

    const getAttributeValue = (product, attrId) => {
        const valObj = product.attribute_values?.find(av => av.attribute_id === attrId);
        if (!valObj) return '-';
        try {
            const parsed = JSON.parse(valObj.value);
            return Array.isArray(parsed) ? parsed.join(', ') : parsed;
        } catch (e) { return valObj.value; }
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .table-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
                .table-scrollbar::-webkit-scrollbar-track { background: rgba(182, 143, 84, 0.05); }
                .table-scrollbar::-webkit-scrollbar-thumb { background: rgba(182, 143, 84, 0.2); border-radius: 4px; background-clip: content-box; border: 2px solid transparent; }
                .table-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(182, 143, 84, 0.4); border: 2px solid transparent; background-clip: content-box; }
                .sticky-col-0 { position: sticky; left: 0; z-index: 10; background: #fcfcfa; }
                .sticky-col-1 { position: sticky; left: 40px; z-index: 10; background: #fcfcfa; }
                .sticky-col-2 { position: sticky; left: 170px; z-index: 10; background: #fcfcfa; }
                tr:hover .sticky-col-0, tr:hover .sticky-col-1, tr:hover .sticky-col-2 { background-color: #f9f7f2 !important; }
                tr.bg-gold\/10 .sticky-col-0, tr.bg-gold\/10 .sticky-col-1, tr.bg-gold\/10 .sticky-col-2 { background-color: #f7f1e6 !important; }
            `}</style>

            <div className="flex-none bg-[#fcfcfa] pb-4 space-y-2">
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-display font-bold text-primary italic">Quản lý sản phẩm</h1>
                    <AccountSelector user={user} />
                </div>

                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center gap-2">
                    <div className="flex gap-1.5 items-center">
                        {!isTrashView && (
                            <button onClick={() => navigate('/admin/products/new')} className="bg-brick text-white p-1.5 hover:bg-umber transition-all rounded-sm w-9 h-9" title="Thêm mới"><span className="material-symbols-outlined text-[18px]">add</span></button>
                        )}
                        <button data-filter-btn onClick={() => setShowAdvanced(!showAdvanced)} className={`p-1.5 border transition-all rounded-sm w-9 h-9 ${showAdvanced ? 'bg-primary text-white' : 'bg-white text-primary border-gold/20'}`}><span className="material-symbols-outlined text-[18px]">filter_alt</span></button>
                        <button disabled={selectedIds.length === 0} onClick={handleBulkDuplicate} className={`p-1.5 border rounded-sm w-9 h-9 ${selectedIds.length > 0 ? 'bg-primary text-white' : 'bg-stone/10 text-stone/40 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                        <button onClick={handleRefresh} disabled={loading} className="bg-primary text-white p-1.5 rounded-sm w-9 h-9"><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span></button>
                        <button data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-1.5 border rounded-sm w-9 h-9 ${showColumnSettings ? 'bg-gold text-white' : 'bg-white text-gold border-gold/30'}`}><span className="material-symbols-outlined text-[18px]">settings_suggest</span></button>
                        <button onClick={() => setIsTrashView(!isTrashView)} className={`p-1.5 border rounded-sm w-9 h-9 ${isTrashView ? 'bg-stone text-white' : 'bg-white text-stone'}`}><span className="material-symbols-outlined text-[18px]">{isTrashView ? 'arrow_back' : 'delete'}</span></button>
                    </div>

                    {selectedIds.length > 0 && (
                        <div className="flex gap-1 items-center bg-gold/5 p-1 rounded-sm border border-gold/20">
                            <button onClick={isTrashView ? handleBulkRestore : handleBulkDelete} className={`p-1 rounded-sm w-8 h-8 ${isTrashView ? 'text-primary' : 'text-brick'}`}><span className="material-symbols-outlined text-[18px]">{isTrashView ? 'restore_from_trash' : 'delete_sweep'}</span></button>
                            <button onClick={() => setSelectedIds([])} className="text-gold p-1 rounded-sm w-8 h-8"><span className="material-symbols-outlined text-[18px]">cancel</span></button>
                            <span className="text-[11px] font-bold text-gold px-1">{selectedIds.length} đã chọn</span>
                        </div>
                    )}

                    <div className="flex-1 relative">
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gold text-[16px]">search</span>
                        <input type="text" placeholder="Tìm kiếm..." className="w-full bg-stone/5 border border-gold/10 px-8 py-1.5 rounded-sm text-[14px]" value={filters.search} onChange={handleFilterChange} onKeyPress={(e) => e.key === 'Enter' && fetchProducts(1)} />
                    </div>
                </div>
            </div>

            {showAdvanced && (
                <div ref={filterRef} className="bg-white border-b-2 border-primary/20 p-4 shadow-lg mb-4 rounded-b-md animate-in slide-in-from-top-2">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="font-bold text-primary flex items-center gap-2"><span className="material-symbols-outlined">tune</span>Bộ lọc nâng cao</h4>
                        <div className="flex gap-4">
                            <button onClick={handleReset} className="text-sm font-bold text-stone-400">Xóa tất cả</button>
                            <button onClick={() => { fetchProducts(1); setShowAdvanced(false); }} className="bg-primary text-white px-6 py-1.5 rounded font-bold text-sm">Xác nhận</button>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <select name="category_id" value={filters.category_id} onChange={handleFilterChange} className="border p-2 rounded text-sm"><option value="">Tất cả danh mục</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                        <select name="type" value={filters.type} onChange={handleFilterChange} className="border p-2 rounded text-sm"><option value="">Tất cả loại</option>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                        <div className="flex gap-1"><input type="number" name="min_stock" placeholder="Kho từ" className="border p-2 rounded text-sm w-1/2" value={filters.min_stock} onChange={handleFilterChange} /><input type="number" name="max_stock" placeholder="đến" className="border p-2 rounded text-sm w-1/2" value={filters.max_stock} onChange={handleFilterChange} /></div>
                        <input type="date" name="start_date" className="border p-2 rounded text-sm" value={filters.start_date} onChange={handleFilterChange} />
                        <input type="date" name="end_date" className="border p-2 rounded text-sm" value={filters.end_date} onChange={handleFilterChange} />
                    </div>
                    {allAttributes.filter(a => a.is_filterable).length > 0 && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
                            {allAttributes.filter(a => a.is_filterable).map(attr => (
                                <div key={attr.id} className="space-y-1">
                                    <label className="text-xs font-bold text-stone/60">{attr.name}</label>
                                    <div className="flex flex-wrap gap-1 border p-1 rounded max-h-24 overflow-auto bg-stone/5">
                                        {attr.options?.map(opt => (
                                            <button key={opt.id} onClick={() => handleAttributeFilterChange(attr.id, opt.value)} className={`px-2 py-0.5 text-[10px] rounded border ${filters.attributes[attr.id]?.includes(opt.value) ? 'bg-primary text-white border-primary' : 'bg-white border-stone/20'}`}>{opt.value}</button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {showColumnSettings && (
                <div ref={columnSettingsRef}>
                    <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="product_list" />
                </div>
            )}

            <div className="flex-1 bg-white border border-stone/20 shadow-xl overflow-auto table-scrollbar relative rounded-md">
                <table className="text-left border-collapse table-fixed min-w-full" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="bg-[#fcfcfa] text-[11px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 shadow-sm border-b border-stone/20">
                        <tr>
                            <th className="p-3 w-10 bg-[#fcfcfa] border border-stone/20 sticky-col-0"><input type="checkbox" checked={products.length > 0 && selectedIds.length === products.length} onChange={toggleSelectAll} className="size-4 accent-primary" /></th>
                            {renderedColumns.map((col, idx) => (
                                <th key={col.id} draggable={col.id !== 'actions'} onDragStart={(e) => handleHeaderDragStart(e, idx)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, idx)} onDoubleClick={() => handleSort(col.id)} className={`px-3 py-2.5 border border-stone/20 cursor-move hover:bg-gold/5 relative group ${col.id === 'sku' ? 'sticky-col-1' : col.id === 'name' ? 'sticky-col-2' : ''}`} style={{ width: columnWidths[col.id] || col.minWidth }}>
                                    <div className={`flex items-center gap-1.5 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''}`}>
                                        {col.id !== 'actions' && <span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 text-gold">drag_indicator</span>}
                                        <span className="truncate">{col.label}</span>
                                        <SortIndicator colId={col.id === 'stock' ? 'stock_quantity' : col.id} sortConfig={sortConfig} />
                                    </div>
                                    {col.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(col.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {products.map(product => (
                            <tr key={product.id} onClick={() => toggleSelectProduct(product.id)} className={`transition-all group cursor-pointer ${selectedIds.includes(product.id) ? 'bg-gold/10' : 'hover:bg-gold/5'}`}>
                                <td className="p-3 border border-stone/20 sticky-col-0"><input type="checkbox" checked={selectedIds.includes(product.id)} readOnly className="size-4 accent-primary" /></td>
                                {renderedColumns.map(col => {
                                    const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                    if (col.id === 'image') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20"><div className="size-10 bg-stone/5 border rounded overflow-hidden" onClick={(e) => { e.stopPropagation(); const url = getPrimaryImage(product); if (url) setPreviewImage({ url, name: product.name }); }}><img src={getPrimaryImage(product) || ''} className="w-full h-full object-cover" /></div></td>;
                                    if (col.id === 'sku') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 sticky-col-1 font-mono font-bold text-[13px] text-primary">{product.sku}</td>;
                                    if (col.id === 'name') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 sticky-col-2 font-bold text-[13px] text-primary truncate">{product.name}</td>;
                                    if (col.id === 'price') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 text-brick font-bold">{new Intl.NumberFormat('vi-VN').format(Math.floor(product.price))}₫</td>;
                                    if (col.id === 'stock') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 font-black text-stone-700">{product.stock_quantity || 0}</td>;
                                    if (col.id === 'category') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 text-stone-600 truncate">{product.category?.name || '-'}</td>;
                                    if (col.id === 'type') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${TYPE_LABELS[product.type]?.cls || ''}`}>{TYPE_LABELS[product.type]?.label || product.type}</span></td>;
                                    if (col.id === 'is_featured' || col.id === 'is_new') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 text-center">{product[col.id] ? <span className="material-symbols-outlined text-gold">check_circle</span> : <span className="material-symbols-outlined text-stone-300">circle</span>}</td>;
                                    if (col.id === 'actions') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 text-right"><div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); navigate(`/admin/products/edit/${product.id}`); }} className="p-1 hover:text-primary"><span className="material-symbols-outlined text-[18px]">edit</span></button><button onClick={(e) => { e.stopPropagation(); handleDelete(product.id); }} className="p-1 hover:text-brick"><span className="material-symbols-outlined text-[18px]">delete</span></button></div></td>;
                                    if (col.isAttribute) return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 text-stone-600 truncate">{getAttributeValue(product, col.attrId)}</td>;
                                    return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-stone/20 text-stone-600 truncate">{String(product[col.id] ?? '-')}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex-none mt-4 flex justify-between items-center text-xs text-stone border-t-2 border-primary/20 pt-4">
                <div className="flex items-center gap-4">
                    <select className="border rounded p-1 font-bold text-primary" value={pagination.per_page} onChange={(e) => fetchProducts(1, filters, { ...sortConfig, per_page: e.target.value })}>
                        <option value="20">20 / trang</option><option value="50">50 / trang</option><option value="100">100 / trang</option>
                    </select>
                    <span>Hiển thị {products.length} / {pagination.total}</span>
                </div>
                <Pagination pagination={pagination} onPageChange={(page) => fetchProducts(page)} />
            </div>

            {previewImage && (
                <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 scrollbar-hide" onClick={() => setPreviewImage(null)}>
                    <img src={previewImage.url} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                </div>
            )}
        </div>
    );
};

export default ProductList;
