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
    simple: { label: 'Sản phẩm đơn', cls: 'bg-primary/10 text-primary border-primary/30' },
    configurable: { label: 'Sản phẩm có biến thể', cls: 'bg-primary/10 text-primary border-primary/20' },
    grouped: { label: 'Nhóm sản phẩm', cls: 'bg-umber/10 text-umber border-umber/20' },
    bundle: { label: 'Bộ sản phẩm (Combo)', cls: 'bg-gold/15 text-gold border-gold/30' },
    virtual: { label: 'Dịch vụ/Phi vật thể', cls: 'bg-brick/10 text-brick border-brick/20' },
    downloadable: { label: 'Tài liệu/Dữ liệu số', cls: 'bg-blue-50 text-blue-900 border-blue-200' },
};

const DEFAULT_COLUMNS = [
    { id: 'sku', label: 'Mã SP', minWidth: '130px', fixed: true },
    { id: 'name', label: 'Tên Sản Phẩm', minWidth: '220px', fixed: true },
    { id: 'specifications', label: 'Thông số', minWidth: '150px' },
    { id: 'cost_price', label: 'Giá nhập', minWidth: '120px' },
    { id: 'price', label: 'Giá bán', minWidth: '120px' },
    { id: 'images', label: 'Ảnh', minWidth: '80px' },
    { id: 'type', label: 'Loại hình', minWidth: '110px' },
    { id: 'category', label: 'Danh mục', minWidth: '120px' },
    { id: 'stock', label: 'Tồn kho', minWidth: '80px' },
    { id: 'is_featured', label: 'Nổi bật', minWidth: '80px', align: 'center' },
    { id: 'is_new', label: 'Mới', minWidth: '80px', align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: '100px', align: 'right', fixed: true },
];

function getPrimaryImage(product) {
    const primary = product.images?.find(img => img.is_primary);
    let url = primary?.image_url || product.images?.[0]?.image_url || null;
    
    if (url && !url.startsWith('http') && !url.startsWith('data:')) {
        // Chèn base URL cho ảnh từ Laravel storage
        const baseUrl = 'http://localhost:8003';
        url = `${baseUrl}/storage/${url.replace(/^\/storage\//, '').replace(/^\//, '')}`;
    }
    return url;
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

    const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
    const [bulkUpdateData, setBulkUpdateData] = useState({});
    const [openAttrId, setOpenAttrId] = useState(null);

    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState("");
    const [justUpdatedId, setJustUpdatedId] = useState(null);
    const [notification, setNotification] = useState(null);
    const [lastBulkUpdateLogId, setLastBulkUpdateLogId] = useState(null);

    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [trashCount, setTrashCount] = useState(0);
    const [filters, setFilters] = useState(() => {
        const savedSearch = localStorage.getItem('product_list_search_current');
        return {
            search: savedSearch || '', category_id: '', type: '', is_featured: '', is_new: '',
            min_price: '', max_price: '', min_stock: '', max_stock: '', start_date: '', end_date: '',
            attributes: {}
        };
    });

    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('product_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [tempFilters, setTempFilters] = useState(null);
    const searchContainerRef = useRef(null);

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
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (!event.target.closest('[data-attr-dropdown]')) setOpenAttrId(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (filters.search !== localStorage.getItem('product_list_search_current') || !filters.search) {
                if (filters.search) {
                    localStorage.setItem('product_list_search_current', filters.search);
                    fetchProducts(1);
                    addToSearchHistory(filters.search);
                } else {
                    localStorage.removeItem('product_list_search_current');
                    fetchProducts(1);
                }
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [filters.search]);

    useEffect(() => {
        if (!isTrashView) fetchTrashCount();
    }, [isTrashView, products]);

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

    const fetchTrashCount = async () => {
        try {
            const response = await productApi.getAll({ is_trash: 1, per_page: 1 });
            setTrashCount(response.data.total || 0);
        } catch (error) { console.error("Error fetching trash count", error); }
    };

    const fetchProducts = async (page = 1, currentFilters = filters, currentSort = sortConfig, limit = pagination.per_page) => {
        setLoading(true);
        try {
            const params = {
                ...currentFilters,
                page,
                per_page: limit,
                is_trash: isTrashView ? 1 : 0,
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
                per_page: parseInt(response.data.per_page)
            });
        } catch (error) { console.error("Error fetching products", error); } finally { setLoading(false); }
    };

    const handleTempFilterChange = (e) => {
        const { name, value } = e.target;
        setTempFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleTempAttributeFilterChange = (attrId, value) => {
        setTempFilters(prev => {
            const currentValues = prev.attributes[attrId] || [];
            let newValues;
            if (currentValues.includes(value)) newValues = currentValues.filter(v => v !== value);
            else newValues = [...currentValues, value];
            return { ...prev, attributes: { ...prev.attributes, [attrId]: newValues } };
        });
    };

    const applyFilters = () => {
        setFilters(tempFilters);
        setShowAdvanced(false);
        fetchProducts(1, tempFilters);
    };

    const removeFilter = (key, value = null) => {
        setFilters(prev => {
            let newFilters = { ...prev };
            if (key === 'attributes') {
                const currentVals = prev.attributes[value.attrId] || [];
                const newVals = currentVals.filter(v => v !== value.val);
                newFilters.attributes = { ...prev.attributes, [value.attrId]: newVals };
            } else if (key === 'stock') {
                newFilters.min_stock = '';
                newFilters.max_stock = '';
            } else if (key === 'date') {
                newFilters.start_date = '';
                newFilters.end_date = '';
            } else {
                newFilters[key] = '';
            }
            fetchProducts(1, newFilters);
            return newFilters;
        });
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
            const updated = { ...prev, attributes: { ...prev.attributes, [attrId]: newValues } };
            fetchProducts(1, updated);
            return updated;
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

    const addToSearchHistory = (term) => {
        if (!term || term.trim() === '' || term.length < 2) return;
        setSearchHistory(prev => {
            const filtered = prev.filter(item => item !== term);
            const updated = [term, ...filtered].slice(0, 10);
            localStorage.setItem('product_search_history', JSON.stringify(updated));
            return updated;
        });
    };

    const handleInitialFetch = useRef(false);
    useEffect(() => {
        if (!handleInitialFetch.current) {
            fetchInitialData();
            handleInitialFetch.current = true;
        }
    }, []);

    useEffect(() => {
        fetchProducts(1);
    }, [isTrashView]);

    const handleDelete = async (id) => {
        if (!window.confirm(isTrashView ? "Bạn có chắc muốn xóa VĨNH VIỄN sản phẩm này? Hành động này không thể hoàn tác." : "Chuyển sản phẩm này vào thùng rác?")) return;
        setLoading(true);
        try {
            if (isTrashView) await productApi.forceDelete(id);
            else await productApi.destroy(id);

            setNotification({ type: 'success', message: isTrashView ? 'Đã xóa vĩnh viễn sản phẩm' : 'Đã chuyển vào thùng rác' });

            // If current page is now empty, go back one page
            const newPage = (products.length === 1 && pagination.current_page > 1)
                ? pagination.current_page - 1
                : pagination.current_page;

            fetchProducts(newPage);
            if (!isTrashView) fetchTrashCount();
        } catch (error) {
            console.error("Delete error:", error);
            setNotification({ type: 'error', message: 'Lỗi khi thực hiện thao tác!' });
        } finally { setLoading(false); }
    };

    const handleRestore = async (id) => {
        setLoading(true);
        try {
            await productApi.restore(id);
            setNotification({ type: 'success', message: 'Đã khôi phục sản phẩm' });
            fetchProducts(pagination.current_page);
        } catch (error) { setNotification({ type: 'error', message: 'Lỗi khi khôi phục!' }); } finally { setLoading(false); }
    };

    const handleBulkDelete = async () => {
        if (!window.confirm(isTrashView ? `Xóa vĩnh viễn ${selectedIds.length} sản phẩm?` : `Xóa ${selectedIds.length} sản phẩm?`)) return;
        setLoading(true);
        try {
            if (isTrashView) await productApi.bulkForceDelete(selectedIds);
            else await productApi.bulkDelete(selectedIds);
            setSelectedIds([]);
            fetchProducts(1);
            setNotification({ type: 'success', message: 'Thao tác thành công' });
        } catch (error) { setNotification({ type: 'error', message: "Lỗi thực hiện!" }); } finally { setLoading(false); }
    };

    const handleBulkRestore = async () => {
        if (!window.confirm(`Khôi phục ${selectedIds.length} sản phẩm?`)) return;
        setLoading(true);
        try {
            await productApi.bulkRestore(selectedIds);
            setSelectedIds([]);
            fetchProducts(1);
            setNotification({ type: 'success', message: 'Đã khôi phục thành công' });
        } catch (error) { setNotification({ type: 'error', message: "Lỗi thực hiện!" }); } finally { setLoading(false); }
    };

    const handleDuplicate = async (id) => {
        setLoading(true);
        try {
            const response = await productApi.duplicate(id);
            const newProduct = response.data;
            navigate(`/admin/products/edit/${newProduct.id}?mode=duplicate`);
        } catch (error) {
            console.error("Duplicate error:", error);
            const msg = error.response?.data?.message || "Lỗi khi nhân bản sản phẩm!";
            setNotification({ type: 'error', message: msg });
        } finally { setLoading(false); }
    };

    const handleBulkDuplicate = async () => {
        if (selectedIds.length === 1) {
            handleDuplicate(selectedIds[0]);
            return;
        }
        setLoading(true);
        try {
            const results = await Promise.all(selectedIds.map(id => productApi.duplicate(id)));
            const count = results.length;
            setSelectedIds([]);
            fetchProducts(1); // Back to page 1 to see the new copies
            setNotification({ type: 'success', message: `Đã nhân bản thành công ${count} sản phẩm.` });
            setTimeout(() => setNotification(null), 5000);
        } catch (error) {
            console.error("Duplicate error:", error);
            const msg = error.response?.data?.message || "Lỗi khi nhân bản sản phẩm!";
            setNotification({ type: 'error', message: msg });
        } finally { setLoading(false); }
    };

    const handleBulkUpdateAttributesSubmit = async () => {
        // Separate basic info from attributes
        const basicInfoFields = ['category_id', 'category_ids', 'price', 'cost_price', 'stock_quantity', 'is_featured', 'is_new', 'status', 'type'];
        const basic_info = {};
        const attributes = {};
        
        for (const key in bulkUpdateData) {
            const val = bulkUpdateData[key];
            if (val !== '' && val !== null && (!Array.isArray(val) || val.length > 0)) {
                if (basicInfoFields.includes(key)) {
                    basic_info[key] = val;
                } else {
                    attributes[key] = val;
                }
            }
        }
        
        if (Object.keys(basic_info).length === 0 && Object.keys(attributes).length === 0) {
            setNotification({ type: 'error', message: 'Vui lòng chọn hoặc nhập ít nhất 1 thông tin để cập nhật!' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        setLoading(true);
        try {
            const response = await productApi.bulkUpdateAttributes({
                ids: selectedIds,
                basic_info,
                attributes
            });
            setShowBulkUpdateModal(false);
            setBulkUpdateData({});
            setSelectedIds([]);
            setLastBulkUpdateLogId(response.data.log_id);
            fetchProducts(pagination.current_page);
            setNotification({ 
                type: 'success', 
                message: 'Cập nhật hàng loạt thành công!',
                action: 'undo'
            });
            setTimeout(() => setNotification(null), 10000); // Longer timeout to allow undo
        } catch (error) {
            console.error("Bulk update error:", error);
            const msg = error.response?.data?.message || (error.response?.status === 422 ? 'Dữ liệu không hợp lệ!' : 'Lỗi cập nhật sản phẩm!');
            setNotification({ type: 'error', message: msg });
            setTimeout(() => setNotification(null), 4000);
        } finally { setLoading(false); }
    };

    const handleUndoBulkUpdate = async () => {
        if (!lastBulkUpdateLogId) return;
        setLoading(true);
        try {
            await productApi.bulkUpdateUndo(lastBulkUpdateLogId);
            setLastBulkUpdateLogId(null);
            fetchProducts(pagination.current_page);
            setNotification({ type: 'success', message: 'Đã hoàn tác cập nhật thành công!' });
            setTimeout(() => setNotification(null), 4000);
        } catch (error) {
            console.error("Undo error:", error);
            setNotification({ type: 'error', message: 'Lỗi khi hoàn tác!' });
            setTimeout(() => setNotification(null), 4000);
        } finally { setLoading(false); }
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
                .admin-page-container { font-family: 'Inter', sans-serif; display: flex; flex-direction: column; height: 100%; background-color: #F8FAFC; }
                .admin-header-title { font-size: 15px !important; font-weight: 800 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
                .admin-text-13 { font-size: 13px !important; color: #0F172A !important; }
                .admin-table-header { font-size: 11px !important; font-weight: 900 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.15em !important; background-color: #F0F4F8 !important; }
                .sticky-col-0 { position: sticky; left: 0; z-index: 10; background: #FCFEFF; border-right: 2px solid #E2E8F0 !important; }
                .sticky-col-1 { position: sticky; left: 40px; z-index: 10; background: #FCFEFF; border-right: 1px solid #E2E8F0 !important; }
                .sticky-col-2 { position: sticky; left: 170px; z-index: 10; background: #FCFEFF; border-right: 2px solid #E2E8F0 !important; }
                tr:hover .sticky-col-0, tr:hover .sticky-col-1, tr:hover .sticky-col-2 { background-color: #F1F5F9 !important; }
                tr.bg-primary\/5 .sticky-col-0, tr.bg-primary\/5 .sticky-col-1, tr.bg-primary\/5 .sticky-col-2 { background-color: #E2E8F0 !important; }
                .table-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
                .table-scrollbar::-webkit-scrollbar-track { background: #F0F4F8; }
                .table-scrollbar::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
            `}</style>

            {notification && (
                <div className={`fixed top-6 right-6 z-[2000] p-4 rounded-md shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined">{notification.type === 'error' ? 'report' : 'check_circle'}</span>
                        <span className="font-bold">{notification.message}</span>
                    </div>
                    {notification.action === 'undo' && (
                        <button 
                            onClick={handleUndoBulkUpdate}
                            className="bg-white text-primary border border-primary/20 hover:bg-primary hover:text-white px-3 py-1 rounded-sm text-[11px] font-black uppercase tracking-tighter transition-all shadow-sm"
                        >
                            Hoàn tác (Undo)
                        </button>
                    )}
                    <button onClick={() => setNotification(null)} className="ml-2 opacity-50 hover:opacity-100 flex items-center"><span className="material-symbols-outlined text-[18px]">close</span></button>
                </div>
            )}

            <div className="flex-none bg-[#F8FAFC] pb-4 space-y-2">
                <div className="flex justify-between items-center">
                    <h1 className="admin-header-title italic">Quản lý sản phẩm</h1>
                    <AccountSelector user={user} />
                </div>

                <div className="bg-white border border-primary/10 p-2 shadow-sm rounded-sm flex flex-wrap items-center gap-2">
                    <div className="flex gap-1 items-center">
                        {!isTrashView && (
                            <button 
                                onClick={() => navigate('/admin/products/new')} 
                                className="bg-brick text-white px-3 h-9 flex items-center gap-2 hover:bg-umber transition-all rounded-sm shadow-sm font-bold text-[11px] uppercase tracking-wider shrink-0"
                                title="Thêm sản phẩm mới"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                <span className="hidden sm:inline">Tạo mới</span>
                            </button>
                        )}
                        <button onClick={handleRefresh} disabled={loading} className="p-1.5 border border-primary/10 bg-white text-primary rounded-sm w-9 h-9 hover:bg-primary/5 transition-all" title="Tải lại dữ liệu"><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span></button>
                        <button data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-1.5 border rounded-sm w-9 h-9 ${showColumnSettings ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-primary border-primary/30 hover:bg-primary/5'}`} title="Cấu hình hiển thị cột"><span className="material-symbols-outlined text-[18px]">settings_suggest</span></button>
                        <button 
                            data-filter-btn 
                            onClick={() => {
                                if (!showAdvanced) setTempFilters({ ...filters });
                                setShowAdvanced(!showAdvanced);
                            }} 
                            className={`p-1.5 border transition-all rounded-sm w-9 h-9 ${showAdvanced ? 'bg-primary text-white border-primary shadow-inner' : 'bg-white text-primary border-primary/20 hover:bg-primary/5'}`} 
                            title="Bộ lọc nâng cao"
                        >
                            <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                        </button>
                        
                        <div className="h-6 w-px bg-primary/20 mx-1"></div>

                        {/* Nhóm thao tác hàng loạt */}
                        <div className="flex gap-1 items-center border-primary/10 pr-1">
                            <button 
                                disabled={selectedIds.length === 0} 
                                onClick={handleBulkDuplicate} 
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                title="Nhân bản các mục đã chọn"
                            >
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                            </button>
                            <button 
                                disabled={selectedIds.length === 0 || isTrashView} 
                                onClick={() => setShowBulkUpdateModal(true)} 
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 && !isTrashView ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                title="Cập nhật thuộc tính hàng loạt"
                            >
                                <span className="material-symbols-outlined text-[18px]">tune</span>
                            </button>
                            <button 
                                disabled={selectedIds.length === 0} 
                                onClick={isTrashView ? handleBulkRestore : handleBulkDelete} 
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 ? (isTrashView ? 'bg-green-600/10 text-green-600 hover:bg-green-600 hover:text-white shadow-sm' : 'bg-brick/10 text-brick hover:bg-brick hover:text-white shadow-sm') : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                title={isTrashView ? "Khôi phục đã chọn" : "Xóa các mục đã chọn"}
                            >
                                <span className="material-symbols-outlined text-[18px]">{isTrashView ? 'restore_from_trash' : 'delete_sweep'}</span>
                            </button>
                            {isTrashView && (
                                <button 
                                    disabled={selectedIds.length === 0} 
                                    onClick={handleBulkForceDelete} 
                                    className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 ? 'bg-brick/10 text-brick hover:bg-brick hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                    title="Xóa vĩnh viễn đã chọn"
                                >
                                    <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                </button>
                            )}
                            {selectedIds.length > 0 && (
                                <div className="flex items-center gap-1 ml-1 pl-2 border-l border-primary/10">
                                    <span className="text-[11px] font-bold text-primary/40 whitespace-nowrap">{selectedIds.length} chọn</span>
                                    <button onClick={() => setSelectedIds([])} className="p-1 text-primary/40 hover:text-brick" title="Hủy chọn"><span className="material-symbols-outlined text-[16px]">close</span></button>
                                </div>
                            )}
                        </div>

                        <div className="h-6 w-px bg-primary/20 mx-1"></div>

                        <button 
                            onClick={() => setIsTrashView(!isTrashView)} 
                            className={`p-1.5 border rounded-sm w-9 h-9 transition-all relative ${isTrashView ? 'bg-primary text-white border-primary shadow-inner' : 'bg-white text-primary/60 border border-primary/20 hover:text-primary hover:border-primary'}`}
                            title={isTrashView ? "Quay lại sản phẩm hiện có" : "Xem sản phẩm đã xóa"}
                        >
                            <span className="material-symbols-outlined text-[18px]">{isTrashView ? 'arrow_back' : 'inventory_2'}</span>
                        </button>
                    </div>

                    <div className="flex-1 relative" ref={searchContainerRef}>
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-primary/40 text-[16px] pointer-events-none z-10">search</span>
                        <input
                            type="text"
                            name="search"
                            autoComplete="off"
                            placeholder="Tìm kiếm sản phẩm..."
                            className="w-full bg-primary/5 border border-primary/10 px-8 py-1.5 rounded-sm text-[14px] focus:outline-none focus:border-primary/30 transition-all relative z-0"
                            value={filters.search}
                            onChange={handleFilterChange}
                            onFocus={() => setShowSearchHistory(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    setShowSearchHistory(false);
                                    fetchProducts(1);
                                    addToSearchHistory(filters.search);
                                }
                            }}
                        />
                        {filters.search && (
                            <button onClick={() => { setFilters(prev => ({ ...prev, search: '' })); setShowSearchHistory(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors">
                                <span className="material-symbols-outlined text-[16px]">cancel</span>
                            </button>
                        )}

                        {showSearchHistory && searchHistory.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[60] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="flex justify-between items-center px-3 mb-2 border-b border-primary/10 pb-1">
                                    <span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest">Tìm kiếm gần đây</span>
                                    <button onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('product_search_history'); }} className="text-[10px] text-brick hover:underline font-bold">Xóa tất cả</button>
                                </div>
                                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                    {searchHistory.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className="group flex items-center justify-between px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors"
                                            onClick={() => {
                                                setFilters(prev => ({ ...prev, search: item }));
                                                setShowSearchHistory(false);
                                                // Fetch will be triggered by useEffect
                                            }}
                                        >
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                <span className="text-[13px] text-[#0F172A] truncate font-medium">{item}</span>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const updated = searchHistory.filter(h => h !== item);
                                                    setSearchHistory(updated);
                                                    localStorage.setItem('product_search_history', JSON.stringify(updated));
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showAdvanced && tempFilters && (
                <div ref={filterRef} className="bg-white border border-primary/20 p-5 shadow-2xl mb-4 rounded-sm animate-in slide-in-from-top-4 duration-300 relative z-50 text-[#0F172A]">
                    <div className="flex justify-between items-center mb-6 pb-3 border-b border-primary/10">
                        <h4 className="font-bold text-primary flex items-center gap-2 text-[15px]"><span className="material-symbols-outlined text-[20px]">tune</span> Cấu hình bộ lọc sản phẩm</h4>
                        <div className="flex gap-4">
                            <button onClick={() => { const r = { ...filters, category_id: '', type: '', min_stock: '', max_stock: '', start_date: '', end_date: '', attributes: {} }; setTempFilters(r); }} className="text-[13px] font-bold text-primary/40 hover:text-brick transition-colors">Thiết lập lại</button>
                            <button onClick={applyFilters} className="bg-primary text-white px-8 py-2 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all">Áp dụng bộ lọc</button>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm mb-6 bg-primary/[0.02]">
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Danh mục</label>
                            <div className="relative">
                                <select name="category_id" value={tempFilters.category_id} onChange={handleTempFilterChange} className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary transition-all appearance-none cursor-pointer">
                                    <option value="">Tất cả danh mục</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 pointer-events-none text-[18px]">
                                    expand_more
                                </span>
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Loại sản phẩm</label>
                            <div className="relative">
                                <select name="type" value={tempFilters.type} onChange={handleTempFilterChange} className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary transition-all appearance-none cursor-pointer">
                                    <option value="">Tất cả loại hình</option>
                                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 pointer-events-none text-[18px]">
                                    expand_more
                                </span>
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Tồn kho</label>
                            <div className="flex items-center gap-2 h-10">
                                <input type="number" name="min_stock" placeholder="Từ" className="w-1/2 h-full bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.min_stock} onChange={handleTempFilterChange} />
                                <span className="text-primary/30 font-bold">-</span>
                                <input type="number" name="max_stock" placeholder="Đến" className="w-1/2 h-full bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.max_stock} onChange={handleTempFilterChange} />
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày tạo (Từ)</label>
                            <input type="date" name="start_date" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.start_date} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày tạo (Đến)</label>
                            <input type="date" name="end_date" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.end_date} onChange={handleTempFilterChange} />
                        </div>
                    </div>

                    {allAttributes.filter(a => a.is_filterable).length > 0 && (
                        <div className="mt-8 pt-6 border-t border-primary/10">
                            <h5 className="text-[15px] font-bold text-[#111] mb-4">Lọc theo thuộc tính</h5>
                            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm bg-primary/[0.02]">
                                {allAttributes.filter(a => a.is_filterable).map((attr) => (
                                    <div key={attr.id} className="p-4 space-y-2.5 border-r border-b border-primary/10 relative">
                                        <label className="text-[11px] font-bold text-stone-500 uppercase tracking-[0.15em]">{attr.name}</label>
                                        <div className="relative" data-attr-dropdown>
                                            <button 
                                                onClick={() => setOpenAttrId(openAttrId === attr.id ? null : attr.id)}
                                                className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === attr.id ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                            >
                                                <span className="truncate text-[13px] font-bold text-primary">
                                                    {(tempFilters.attributes[attr.id] || []).length > 0 
                                                        ? `${attr.name}: ${(tempFilters.attributes[attr.id] || []).length}` 
                                                        : `Chọn ${attr.name}...`}
                                                </span>
                                                <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === attr.id ? 'rotate-180' : ''}`}>
                                                    expand_more
                                                </span>
                                            </button>

                                            {openAttrId === attr.id && (
                                                <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                                        {(tempFilters.attributes[attr.id] || []).length > 0 && (
                                                            <button 
                                                                className="w-full px-3 py-2 text-left text-[11px] font-black text-brick hover:bg-brick/5 border-b border-primary/5 mb-1 uppercase tracking-widest flex items-center gap-2"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTempFilters(prev => ({
                                                                        ...prev,
                                                                        attributes: { ...prev.attributes, [attr.id]: [] }
                                                                    }));
                                                                }}
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">backspace</span>
                                                                Xóa các mục đã chọn
                                                            </button>
                                                        )}
                                                        {attr.options?.length > 0 ? (
                                                            attr.options.map(opt => (
                                                                <label 
                                                                    key={opt.id}
                                                                    className="px-3 py-2.5 hover:bg-primary/5 cursor-pointer flex items-center gap-3 group transition-colors select-none"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <div className="relative flex items-center">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={(tempFilters.attributes[attr.id] || []).includes(opt.value)}
                                                                            onChange={() => handleTempAttributeFilterChange(attr.id, opt.value)}
                                                                            className="w-4 h-4 accent-primary cursor-pointer rounded-sm border-2 border-primary/20"
                                                                        />
                                                                    </div>
                                                                    <span className={`text-[13px] transition-all ${(tempFilters.attributes[attr.id] || []).includes(opt.value) ? 'font-bold text-primary' : 'text-stone-600'}`}>
                                                                        {opt.value}
                                                                    </span>
                                                                </label>
                                                            ))
                                                        ) : (
                                                            <div className="px-4 py-6 text-center text-stone-400 italic text-[12px]">Không có dữ liệu</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Hiển thị các chip điều kiện đang lọc */}
            {(filters.category_id || filters.type || filters.min_stock || filters.max_stock || filters.start_date || filters.end_date || Object.values(filters.attributes).some(arr => arr.length > 0)) && (
                <div className="flex flex-wrap items-center gap-2 mb-4 bg-primary/5 p-2 border border-primary/10 rounded-sm animate-in fade-in duration-300">
                    <span className="text-[13px] font-bold text-primary px-1 mr-1 border-r border-primary/20">Bộ lọc đang hoạt động:</span>
                    
                    {filters.category_id && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Danh mục:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{categories.find(c => String(c.id) === String(filters.category_id))?.name}</span>
                            <button onClick={() => removeFilter('category_id')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    
                    {filters.type && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Loại:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{TYPE_LABELS[filters.type]?.label}</span>
                            <button onClick={() => removeFilter('type')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.min_stock || filters.max_stock) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Kho:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.min_stock || 0} → {filters.max_stock || '∞'}</span>
                            <button onClick={() => removeFilter('stock')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.start_date || filters.end_date) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Ngày tạo:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.start_date || '...'} → {filters.end_date || '...'}</span>
                            <button onClick={() => removeFilter('date')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {Object.entries(filters.attributes).map(([attrId, vals]) => 
                        vals.map(val => (
                            <div key={`${attrId}-${val}`} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                                <span className="text-[11px] text-primary/40">{allAttributes.find(a => String(a.id) === String(attrId))?.name}:</span>
                                <span className="text-[13px] font-bold text-[#0F172A]">{val}</span>
                                <button onClick={() => removeFilter('attributes', { attrId, val })} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                            </div>
                        ))
                    )}

                    <button onClick={handleReset} className="ml-auto text-[13px] font-bold text-brick hover:underline px-2 pr-1 border-primary/20">Xóa tất cả bộ lọc</button>
                </div>
            )}

            {showColumnSettings && (
                <div ref={columnSettingsRef}>
                    <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="product_list" />
                </div>
            )}

            <div className="flex-1 bg-white border border-primary/10 shadow-xl overflow-auto table-scrollbar relative rounded-md">
                <table className="text-left border-collapse table-fixed min-w-full admin-text-13" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="admin-table-header sticky top-0 z-20 shadow-sm border-b border-primary/10">
                        <tr>
                            <th className="p-3 w-10 admin-table-header border border-primary/20 sticky-col-0"><input type="checkbox" checked={products.length > 0 && selectedIds.length === products.length} onChange={toggleSelectAll} className="size-4 accent-primary" /></th>
                            {renderedColumns.map((col, idx) => (
                                <th key={col.id} draggable={col.id !== 'actions'} onDragStart={(e) => handleHeaderDragStart(e, idx)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, idx)} onDoubleClick={() => handleSort(col.id)} className={`px-3 py-2.5 border border-primary/10 cursor-move hover:bg-primary/5 relative group ${col.id === 'sku' ? 'sticky-col-1' : col.id === 'name' ? 'sticky-col-2' : ''}`} style={{ width: columnWidths[col.id] || col.minWidth }}>
                                    <div className={`flex items-center gap-1.5 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''}`}>
                                        {col.id !== 'actions' && <span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 text-primary">drag_indicator</span>}
                                        <span className="truncate text-primary font-black">{col.label}</span>
                                        <SortIndicator colId={col.id === 'stock' ? 'stock_quantity' : col.id} sortConfig={sortConfig} />
                                    </div>
                                    {col.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(col.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {products.length === 0 ? (
                            <tr>
                                <td colSpan={renderedColumns.length + 1} className="p-12 text-center">
                                    <div className="flex flex-col items-center gap-2 text-primary/40">
                                        <span className="material-symbols-outlined text-[48px]">inventory_2</span>
                                        <p className="font-bold text-[15px]">Không tìm thấy sản phẩm nào</p>
                                        <p className="text-[13px]">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            products.map(product => (
                                <tr
                                    key={product.id}
                                    onClick={() => toggleSelectProduct(product.id)}
                                    onDoubleClick={() => navigate(`/admin/products/edit/${product.id}`)}
                                    className={`transition-all group cursor-pointer ${selectedIds.includes(product.id) ? 'bg-gold/10' : 'hover:bg-gold/5'}`}
                                >
                                    <td className="p-3 border border-primary/20 sticky-col-0" onDoubleClick={(e) => e.stopPropagation()}>
                                        <input type="checkbox" checked={selectedIds.includes(product.id)} readOnly className="size-4 accent-primary" />
                                    </td>
                                    {renderedColumns.map(col => {
                                        const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                        if (col.id === 'images') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20"><div className="size-10 bg-primary/5 border rounded overflow-hidden" onClick={(e) => { e.stopPropagation(); const url = getPrimaryImage(product); if (url) setPreviewImage({ url, name: product.name }); }}><img src={getPrimaryImage(product) || ''} className="w-full h-full object-cover" /></div></td>;
                                        if (col.id === 'sku') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 sticky-col-1 font-mono font-bold text-primary group">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{product.sku}</span>
                                                    <button onClick={(e) => handleCopy(product.sku, e)} className={`${copiedText === product.sku ? 'text-green-600' : 'text-primary/40 opacity-0 group-hover:opacity-100'} hover:text-primary p-0.5 rounded transition-all`}>
                                                        <span className="material-symbols-outlined text-[14px]">{copiedText === product.sku ? 'check' : 'content_copy'}</span>
                                                    </button>
                                                </div>
                                            </td>
                                        );
                                        if (col.id === 'name') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 sticky-col-2 font-bold text-[#111] group">
                                                <div className="flex items-center justify-between gap-1 overflow-hidden">
                                                    <span className="truncate flex-1">{product.name}</span>
                                                    <button onClick={(e) => handleCopy(product.name, e)} className={`${copiedText === product.name ? 'text-green-600' : 'text-primary/40 opacity-0 group-hover:opacity-100'} hover:text-primary p-0.5 rounded transition-all`}>
                                                        <span className="material-symbols-outlined text-[14px]">{copiedText === product.name ? 'check' : 'content_copy'}</span>
                                                    </button>
                                                </div>
                                            </td>
                                        );
                                        if (col.id === 'cost_price') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] font-bold tracking-tight">{product.cost_price ? new Intl.NumberFormat('vi-VN').format(Math.floor(product.cost_price)) + '₫' : '--'}</td>;
                                        if (col.id === 'price') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-brick font-bold tracking-tight">{product.price ? new Intl.NumberFormat('vi-VN').format(Math.floor(product.price)) + '₫' : '--'}</td>;
                                        if (col.id === 'stock') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 font-black text-primary">{product.stock_quantity || 0}</td>;
                                        if (col.id === 'category') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] font-medium truncate">{product.category?.name || '-'}</td>;
                                        if (col.id === 'type') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20"><span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold border ${TYPE_LABELS[product.type]?.cls || ''}`}>{TYPE_LABELS[product.type]?.label || product.type}</span></td>;
                                        if (col.id === 'specifications') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-primary/70 italic group">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate max-w-[150px]" title={product.specifications}>{product.specifications || '-'}</span>
                                                    {product.specifications && (
                                                        <button onClick={(e) => handleCopy(product.specifications, e)} className={`${copiedText === product.specifications ? 'text-green-600' : 'text-primary/40 opacity-0 group-hover:opacity-100'} hover:text-primary p-0.5 rounded transition-all`}>
                                                            <span className="material-symbols-outlined text-[14px]">{copiedText === product.specifications ? 'check' : 'content_copy'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                        if (col.id === 'is_featured' || col.id === 'is_new') return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center">{product[col.id] ? <span className="material-symbols-outlined text-gold">check_circle</span> : <span className="material-symbols-outlined text-primary/30">circle</span>}</td>;
                                        if (col.id === 'actions') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-right">
                                                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {isTrashView ? (
                                                        <React.Fragment>
                                                            <button onClick={(e) => { e.stopPropagation(); handleRestore(product.id); }} className="p-1 hover:text-green-600" title="Khôi phục"><span className="material-symbols-outlined text-[18px]">restore</span></button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(product.id); }} className="p-1 hover:text-brick" title="Xóa vĩnh viễn"><span className="material-symbols-outlined text-[18px]">delete_forever</span></button>
                                                        </React.Fragment>
                                                    ) : (
                                                        <React.Fragment>
                                                            <button onClick={(e) => { e.stopPropagation(); handleDuplicate(product.id); }} className="p-1 hover:text-gold" title="Nhân bản"><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                                                            <button onClick={(e) => { e.stopPropagation(); navigate(`/admin/products/edit/${product.id}`); }} className="p-1 hover:text-primary" title="Sửa"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(product.id); }} className="p-1 hover:text-brick" title="Xóa"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                                        </React.Fragment>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                        if (col.isAttribute) return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] truncate">{getAttributeValue(product, col.attrId)}</td>;
                                        return <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] truncate">{String(product[col.id] ?? '-')}</td>;
                                    })}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex-none mt-4 flex justify-between items-center admin-text-13 border-t-2 border-primary/10 pt-4">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-primary/80 uppercase text-[10px] tracking-widest">Hiển thị:</span>
                        <select className="border border-primary/20 rounded px-2 py-1 font-bold text-primary bg-white outline-none focus:border-primary transition-colors" value={pagination.per_page} onChange={(e) => { const lp = parseInt(e.target.value); fetchProducts(1, filters, sortConfig, lp); }}>
                            <option value="20">20 dòng</option>
                            <option value="50">50 dòng</option>
                            <option value="100">100 dòng</option>
                        </select>
                    </div>
                    <span className="text-[#111] font-bold italic">Tổng cộng: {pagination.total} sản phẩm</span>
                </div>
                <Pagination pagination={pagination} onPageChange={(page) => fetchProducts(page)} />
            </div>

            {previewImage && (
                <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 scrollbar-hide" onClick={() => setPreviewImage(null)}>
                    <img src={previewImage.url} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                </div>
            )}

            {showBulkUpdateModal && (
                <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded p-6 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-4 border-b border-primary/10 pb-4">
                            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined">tune</span> Cập nhật thuộc tính hàng loạt
                            </h2>
                            <button onClick={() => setShowBulkUpdateModal(false)} className="text-gray-500 hover:text-brick">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 space-y-4">
                            <div className="bg-primary/5 border border-primary/20 text-primary p-3 rounded-sm text-[13px] mb-4">
                                <strong>Lưu ý:</strong> Đang chọn <strong>{selectedIds.length}</strong> sản phẩm. Bất kỳ giá trị nào bạn nhập ở đây sẽ ghi đè lên các sản phẩm được chọn. Để trống nếu bạn không muốn thay đổi thuộc tính đó.
                            </div>

                            <section className="space-y-4">
                                <h3 className="text-[14px] font-black text-primary uppercase tracking-widest border-l-4 border-brick pl-2 mb-3">Thông tin cơ bản</h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:items-center">
                                    <label className="text-[13px] font-bold text-primary/80">Danh mục chính</label>
                                    <div className="md:col-span-3">
                                        <select 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            value={bulkUpdateData.category_id || ''} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, category_id: e.target.value})}
                                        >
                                            <option value="">-- Bỏ qua --</option>
                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Giá nhập</label>
                                        <input 
                                            type="number" 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            placeholder="VNĐ"
                                            value={bulkUpdateData.cost_price || ''} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, cost_price: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Giá bán</label>
                                        <input 
                                            type="number" 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            placeholder="VNĐ"
                                            value={bulkUpdateData.price || ''} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, price: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Tồn kho</label>
                                        <input 
                                            type="number" 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            placeholder="Số lượng"
                                            value={bulkUpdateData.stock_quantity || ''} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, stock_quantity: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Loại sản phẩm</label>
                                        <select 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            value={bulkUpdateData.type || ''} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, type: e.target.value})}
                                        >
                                            <option value="">-- Bỏ qua --</option>
                                            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-primary/5 p-3 rounded-sm">
                                    <div className="flex items-center gap-3">
                                        <label className="text-[13px] font-bold text-primary/80 whitespace-nowrap">Nổi bật:</label>
                                        <select 
                                            className="flex-1 bg-white border border-primary/20 px-2 py-1 rounded-sm text-[12px] focus:border-primary"
                                            value={bulkUpdateData.is_featured === undefined ? '' : bulkUpdateData.is_featured} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, is_featured: e.target.value === '' ? undefined : e.target.value === '1'})}
                                        >
                                            <option value="">-- Giữ nguyên --</option>
                                            <option value="1">Bật</option>
                                            <option value="0">Tắt</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-[13px] font-bold text-primary/80 whitespace-nowrap">Mới:</label>
                                        <select 
                                            className="flex-1 bg-white border border-primary/20 px-2 py-1 rounded-sm text-[12px] focus:border-primary"
                                            value={bulkUpdateData.is_new === undefined ? '' : bulkUpdateData.is_new} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, is_new: e.target.value === '' ? undefined : e.target.value === '1'})}
                                        >
                                            <option value="">-- Giữ nguyên --</option>
                                            <option value="1">Bật</option>
                                            <option value="0">Tắt</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-[13px] font-bold text-primary/80 whitespace-nowrap">Trạng thái:</label>
                                        <select 
                                            className="flex-1 bg-white border border-primary/20 px-2 py-1 rounded-sm text-[12px] focus:border-primary"
                                            value={bulkUpdateData.status === undefined ? '' : bulkUpdateData.status} 
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, status: e.target.value === '' ? undefined : e.target.value === '1'})}
                                        >
                                            <option value="">-- Giữ nguyên --</option>
                                            <option value="1">Kích hoạt</option>
                                            <option value="0">Tắt</option>
                                        </select>
                                    </div>
                                </div>
                            </section>

                            <section className="pt-4 space-y-4">
                                <h3 className="text-[14px] font-black text-primary uppercase tracking-widest border-l-4 border-brick pl-2 mb-3">Thuộc tính mở rộng</h3>

                            {allAttributes.map(attr => {
                                const val = bulkUpdateData[attr.id] || '';
                                return (
                                    <div key={attr.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 md:items-center">
                                        <label className="text-[13px] font-bold text-primary/80">{attr.name}</label>
                                        <div className="md:col-span-3">
                                            {attr.frontend_type === 'select' ? (
                                                <select 
                                                    className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                                    value={val} 
                                                    onChange={e => setBulkUpdateData({...bulkUpdateData, [attr.id]: e.target.value})}
                                                >
                                                    <option value="">-- Bỏ qua --</option>
                                                    {attr.options?.map(opt => <option key={opt.id} value={opt.value}>{opt.value}</option>)}
                                                </select>
                                            ) : attr.frontend_type === 'multiselect' ? (
                                                <div className="flex flex-wrap gap-2 text-[13px]">
                                                    {attr.options?.map(opt => {
                                                        const isChecked = Array.isArray(val) && val.includes(opt.value);
                                                        return (
                                                            <label key={opt.id} className="flex items-center gap-1 cursor-pointer">
                                                                <input 
                                                                    type="checkbox" 
                                                                    className="accent-primary"
                                                                    checked={isChecked}
                                                                    onChange={e => {
                                                                        const curVals = Array.isArray(val) ? val : [];
                                                                        const newVals = e.target.checked ? [...curVals, opt.value] : curVals.filter(v => v !== opt.value);
                                                                        setBulkUpdateData({...bulkUpdateData, [attr.id]: newVals});
                                                                    }}
                                                                /> {opt.value}
                                                            </label>
                                                        )
                                                    })}
                                                </div>
                                            ) : (
                                                <input 
                                                    type="text" 
                                                    className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                                    placeholder="Nhập giá trị hoặc để trống bỏ qua..."
                                                    value={val} 
                                                    onChange={e => setBulkUpdateData({...bulkUpdateData, [attr.id]: e.target.value})}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            </section>
                        </div>

                        <div className="mt-6 pt-4 border-t border-primary/10 flex justify-end gap-3 shrink-0">
                            <button 
                                onClick={() => setShowBulkUpdateModal(false)} 
                                className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5"
                            >Hủy bỏ</button>
                            <button 
                                onClick={handleBulkUpdateAttributesSubmit} 
                                className="px-6 py-2 bg-primary text-white rounded-sm font-bold text-[13px] hover:bg-primary/90 flex items-center gap-2"
                                disabled={loading}
                            >
                                {loading ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">save</span>}
                                Áp dụng {selectedIds.length} SP
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductList;
