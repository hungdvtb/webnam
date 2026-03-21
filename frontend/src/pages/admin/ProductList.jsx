import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { Link, useNavigate } from 'react-router-dom';
import { productApi, categoryApi, attributeApi, inventoryApi } from '../../services/api';
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
    { id: 'status', label: 'Bán', minWidth: '60px', align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: '100px', align: 'right', fixed: true },
];

function getPrimaryImage(product) {
    if (!product || !product.images || product.images.length === 0) return null;
    const primary = product.images.find(img => img.is_primary);
    let url = primary?.image_url || product.images[0]?.image_url;
    
    if (url && !url.startsWith('http') && !url.startsWith('data:')) {
        const baseUrl = 'http://localhost:8003';
        url = `${baseUrl}/storage/${url.replace(/^\/storage\//, '').replace(/^\//, '')}`;
    }
    return url || null;
}

function getSupplierFilterLabel(suppliers, supplierId) {
    if (!supplierId) {
        return '';
    }

    if (supplierId === 'unassigned') {
        return 'Chưa gắn nhà cung cấp';
    }

    const supplier = suppliers.find((item) => String(item.id) === String(supplierId));
    if (!supplier) {
        return String(supplierId);
    }

    return supplier.code ? `${supplier.name} - ${supplier.code}` : supplier.name;
}

function getDefaultProductFilters() {
    return {
        search: '',
        category_id: [],
        type: [],
        supplier_ids: [],
        missing_purchase_price: '',
        multiple_suppliers: '',
        is_featured: '',
        is_new: '',
        min_price: '',
        max_price: '',
        min_stock: '',
        max_stock: '',
        start_date: '',
        end_date: '',
        attributes: {},
    };
}

const ProductList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const filterRef = useRef(null);
    const columnSettingsRef = useRef(null);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState([]);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const [copiedText, setCopiedText] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);
    const [expandedRows, setExpandedRows] = useState([]);

    const toggleExpandRow = (productId, e) => {
        if (e) e.stopPropagation();
        setExpandedRows(prev => 
            prev.includes(productId) 
                ? prev.filter(id => id !== productId) 
                : [...prev, productId]
        );
    };


    const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
    const [bulkUpdateData, setBulkUpdateData] = useState({});
    const [lastBulkUpdateLogId, setLastBulkUpdateLogId] = useState(null);
    const [openAttrId, setOpenAttrId] = useState(null);

    const [editingProductId, setEditingProductId] = useState(null);
    const [editForm, setEditForm] = useState({ price: '', cost_price: '' });
    const [savingId, setSavingId] = useState(null);

    const handleStartQuickEdit = (p, e) => {
        e.stopPropagation();
        setEditingProductId(p.id);
        setEditForm({
            price: Math.floor(p.price || 0),
            cost_price: Math.floor(p.cost_price || 0)
        });
    };

    const handleCancelQuickEdit = (e) => {
        if (e) e.stopPropagation();
        setEditingProductId(null);
        setEditForm({ price: '', cost_price: '' });
    };

    const handleSaveQuickEdit = async (e) => {
        e.stopPropagation();
        if (!editingProductId) return;
        
        setSavingId(editingProductId);
        try {
            const response = await productApi.update(editingProductId, {
                price: editForm.price,
                cost_price: editForm.cost_price
            });
            
            // Update local state
            setProducts(prev => prev.map(p => {
                if (p.id === editingProductId) return { ...p, ...response.data };
                if (p.linked_products) {
                    return {
                        ...p,
                        linked_products: p.linked_products.map(child => 
                            child.id === editingProductId ? { ...child, ...response.data } : child
                        )
                    };
                }
                return p;
            }));
            
            setNotification({ type: 'success', message: 'Cập nhật giá thành công' });
            setTimeout(() => setNotification(null), 3000);
            handleCancelQuickEdit();
        } catch (err) {
            setNotification({ type: 'error', message: 'Lỗi khi cập nhật giá: ' + (err.response?.data?.message || err.message) });
        } finally {
            setSavingId(null);
        }
    };

    const [notification, setNotification] = useState(null);

    // PERSISTENCE LOGIC: Load state from localStorage on init
    const getSavedState = () => {
        const saved = localStorage.getItem('product_management_persistent_state');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error("Error parsing saved product list state", e);
            }
        }
        return null;
    };

    const savedState = getSavedState();

    const [pagination, setPagination] = useState({ 
        current_page: savedState?.page || 1, 
        last_page: 1, 
        total: 0, 
        per_page: savedState?.perPage || 20 
    });

    const [isTrashView, setIsTrashView] = useState(savedState?.isTrashView || false);

    // Sanitize saved filters to ensure category_id and type are always arrays (legacy compatibility)
    const getInitialFilters = () => {
        const baseFilters = { ...getDefaultProductFilters(), ...(savedState?.filters || {}) };
        
        if (baseFilters.category_id && !Array.isArray(baseFilters.category_id)) {
            if (typeof baseFilters.category_id === 'string') {
                baseFilters.category_id = baseFilters.category_id.trim() === '' ? [] : baseFilters.category_id.split(',').filter(Boolean);
            } else {
                baseFilters.category_id = [baseFilters.category_id].filter(Boolean);
            }
        } else if (!baseFilters.category_id) {
            baseFilters.category_id = [];
        }
        
        if (baseFilters.type && !Array.isArray(baseFilters.type)) {
            if (typeof baseFilters.type === 'string') {
                baseFilters.type = baseFilters.type.trim() === '' ? [] : baseFilters.type.split(',').filter(Boolean);
            } else {
                baseFilters.type = [baseFilters.type].filter(Boolean);
            }
        } else if (!baseFilters.type) {
            baseFilters.type = [];
        }

        if (baseFilters.supplier_ids && !Array.isArray(baseFilters.supplier_ids)) {
            if (typeof baseFilters.supplier_ids === 'string') {
                baseFilters.supplier_ids = baseFilters.supplier_ids.trim() === '' ? [] : baseFilters.supplier_ids.split(',').filter(Boolean);
            } else {
                baseFilters.supplier_ids = [baseFilters.supplier_ids].filter(Boolean);
            }
        } else if (!baseFilters.supplier_ids) {
            baseFilters.supplier_ids = [];
        }

        if (baseFilters.supplier_id != null && baseFilters.supplier_id !== '') {
            baseFilters.supplier_ids = Array.from(new Set([...(baseFilters.supplier_ids || []), String(baseFilters.supplier_id)]));
        }

        delete baseFilters.supplier_id;

        if (!baseFilters.attributes || typeof baseFilters.attributes !== 'object') {
            baseFilters.attributes = {};
        }
        
        return baseFilters;
    };

    const [filters, setFilters] = useState(getInitialFilters());

    const [sortConfig, setSortConfig] = useState(savedState?.sortConfig || { 
        key: 'created_at', 
        direction: 'desc', 
        phase: 1 
    });

    // PERSISTENCE LOGIC: Save state whenever it changes
    useEffect(() => {
        const stateToSave = {
            filters,
            sortConfig,
            page: pagination.current_page,
            perPage: pagination.per_page,
            isTrashView
        };
        localStorage.setItem('product_management_persistent_state', JSON.stringify(stateToSave));
    }, [filters, sortConfig, pagination.current_page, pagination.per_page, isTrashView]);

    const [trashCount, setTrashCount] = useState(0);

    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('product_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [tempFilters, setTempFilters] = useState(null);
    const searchContainerRef = useRef(null);

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
        // Load with persisted page/filters
        fetchProducts(pagination.current_page);
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
            const lastSearchStored = localStorage.getItem('product_list_search_current_term');
            if (filters.search !== lastSearchStored) {
                if (filters.search && filters.search.trim() !== '') {
                    localStorage.setItem('product_list_search_current_term', filters.search);
                    fetchProducts(1);
                    addToSearchHistory(filters.search);
                } else if (lastSearchStored !== null) {
                    localStorage.removeItem('product_list_search_current_term');
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
            const [catRes, attrRes, supplierRes] = await Promise.all([
                categoryApi.getAll(),
                attributeApi.getAll({ active_only: true }),
                inventoryApi.getSuppliers({ per_page: 500 }),
            ]);
            setCategories(catRes.data || []);
            setAllAttributes(attrRes.data || []);
            setSuppliers(supplierRes.data?.data || []);

            const attrColumns = (attrRes.data || []).map(attr => ({
                id: `attr_${attr.id}`,
                label: attr.name,
                minWidth: '150px',
                isAttribute: true,
                attrId: attr.id
            }));

            const supplierCodeColumn = { id: 'supplier_product_code', label: 'Mã NCC', minWidth: '130px' };
            const baseColumns = DEFAULT_COLUMNS.some((column) => column.id === 'supplier_product_code')
                ? DEFAULT_COLUMNS
                : [...DEFAULT_COLUMNS.slice(0, -1), supplierCodeColumn, DEFAULT_COLUMNS[DEFAULT_COLUMNS.length - 1]];
            const combinedColumns = [...baseColumns.slice(0, -1), ...attrColumns, baseColumns[baseColumns.length - 1]];

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
                const savedIds = JSON.parse(savedVisible);
                const mergedVisible = [
                    ...combinedColumns.map((column) => column.id).filter((id) => savedIds.includes(id)),
                    ...combinedColumns.map((column) => column.id).filter((id) => !savedIds.includes(id)),
                ];
                setVisibleColumns(mergedVisible);
                localStorage.setItem('product_list_columns', JSON.stringify(mergedVisible));
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
                page,
                per_page: limit,
                is_trash: isTrashView ? 1 : 0,
                sort_by: currentSort.direction === 'none' ? 'id' : currentSort.key,
                sort_order: currentSort.direction === 'none' ? 'desc' : currentSort.direction
            };

            if (currentFilters.search) {
                params.search = currentFilters.search;
            }

            if (Array.isArray(currentFilters.category_id) && currentFilters.category_id.length > 0) {
                params.category_ids = currentFilters.category_id.join(',');
            }

            if (Array.isArray(currentFilters.type) && currentFilters.type.length > 0) {
                params.type = currentFilters.type.join(',');
            }

            if (Array.isArray(currentFilters.supplier_ids) && currentFilters.supplier_ids.length > 0) {
                params.supplier_ids = currentFilters.supplier_ids.join(',');
            }

            if (currentFilters.missing_purchase_price) {
                params.missing_purchase_price = 1;
            }

            if (currentFilters.multiple_suppliers) {
                params.multiple_suppliers = 1;
            }

            ['is_featured', 'is_new', 'min_price', 'max_price', 'min_stock', 'max_stock', 'start_date', 'end_date'].forEach((key) => {
                if (currentFilters[key] !== '' && currentFilters[key] !== null && currentFilters[key] !== undefined) {
                    params[key] = currentFilters[key];
                }
            });

            if (currentFilters.attributes) {
                Object.entries(currentFilters.attributes).forEach(([id, val]) => {
                    if (val && (Array.isArray(val) ? val.length > 0 : val !== '')) {
                        params[`attributes[${id}]`] = Array.isArray(val) ? val.join(',') : val;
                    }
                });
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

    const handleTempMultiSelectChange = (name, value) => {
        setTempFilters(prev => {
            const currentValues = prev[name] || [];
            let newValues;
            if (currentValues.includes(value)) newValues = currentValues.filter(v => v !== value);
            else newValues = [...currentValues, value];
            return { ...prev, [name]: newValues };
        });
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
            } else if (key === 'category_id') {
                newFilters.category_id = (Array.isArray(prev.category_id) ? prev.category_id : []).filter(id => id !== value);
            } else if (key === 'type') {
                newFilters.type = (Array.isArray(prev.type) ? prev.type : []).filter(t => t !== value);
            } else if (key === 'supplier_ids') {
                newFilters.supplier_ids = (Array.isArray(prev.supplier_ids) ? prev.supplier_ids : []).filter(id => id !== value);
            } else if (key === 'stock') {
                newFilters.min_stock = '';
                newFilters.max_stock = '';
            } else if (key === 'date') {
                newFilters.start_date = '';
                newFilters.end_date = '';
            } else if (key === 'missing_purchase_price' || key === 'multiple_suppliers') {
                newFilters[key] = '';
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
        const resetFilters = getDefaultProductFilters();
        const defaultSort = { key: 'created_at', direction: 'desc', phase: 1 };
        
        localStorage.removeItem('product_management_persistent_state');
        localStorage.removeItem('product_list_search_current_term');
        
        setFilters(resetFilters);
        setTempFilters(resetFilters);
        setSortConfig(defaultSort);
        setPagination(prev => ({ ...prev, current_page: 1 }));
        setIsTrashView(false);
        
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
        // Initial load skip is handled by the main useEffect(fetchInitialData)
        // But if isTrashView changes manually, we refresh
        if (handleInitialFetch.current) {
            fetchProducts(1);
        }
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

    const toggleBulkSupplierSelection = (supplierId) => {
        setBulkUpdateData((prev) => {
            const currentSupplierIds = Array.isArray(prev.supplier_ids) ? prev.supplier_ids : [];
            const normalizedId = String(supplierId);

            return {
                ...prev,
                supplier_ids: currentSupplierIds.includes(normalizedId)
                    ? currentSupplierIds.filter((id) => id !== normalizedId)
                    : [...currentSupplierIds, normalizedId]
            };
        });
    };

    const handleBulkUpdateAttributesSubmit = async () => {
        // Separate basic info from attributes
        const basicInfoFields = ['category_id', 'category_ids', 'price', 'cost_price', 'stock_quantity', 'supplier_ids', 'is_featured', 'is_new', 'status', 'type'];
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

    const handleCopy = (text, message, e, copyId) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedText(copyId || text);
        if (message) {
            setNotification({ type: 'success', message: `Đã sao chép ${message}: ${text}` });
            setTimeout(() => setNotification(null), 2000);
        }
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleCopyAll = (p, e) => {
        if (e) e.stopPropagation();
        
        const typeLabel = TYPE_LABELS[p.type]?.label || p.type;
        const catName = p.category?.name || '-';
        const price = p.price ? `${new Intl.NumberFormat('vi-VN').format(p.price)}₫` : '0₫';
        const costPrice = p.cost_price ? `${new Intl.NumberFormat('vi-VN').format(p.cost_price)}₫` : '0₫';
        const stock = p.stock_quantity || 0;
        
        let attrsStr = '';
        if (p.attribute_values && p.attribute_values.length > 0) {
            attrsStr = '\n' + p.attribute_values.map(av => {
                const attr = allAttributes.find(a => String(a.id) === String(av.attribute_id));
                const label = attr ? attr.name : `Attr ${av.attribute_id}`;
                let val = av.value;
                try {
                    const parsed = JSON.parse(val);
                    val = Array.isArray(parsed) ? parsed.join(', ') : parsed;
                } catch(e) {}
                return `${label}: ${val}`;
            }).join('\n');
        }

        const text = `Tên SP: ${p.name}\nMã SP: ${p.sku}\nLoại: ${typeLabel}\nDanh mục: ${catName}\nGiá bán: ${price}\nGiá nhập: ${costPrice}\nKho: ${stock}\nThông số: ${p.specifications || '-'}${attrsStr}`;
        
        navigator.clipboard.writeText(text);
        setCopiedText('all_' + p.id);
        setNotification({ type: 'success', message: 'Đã sao chép toàn bộ thuộc tính sản phẩm' });
        setTimeout(() => setNotification(null), 2000);
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
        const validSortColumns = ['id', 'sku', 'supplier_product_code', 'name', 'price', 'cost_price', 'stock_quantity', 'created_at', 'type'];
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
                tr.bg-primary\/5 .sticky-col-0, tr.bg-primary\/5 .sticky-col-1, tr.bg-primary\/5 .sticky-col-2 { background-color: #E2E8F0 !important; }
                .table-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
                .table-scrollbar::-webkit-scrollbar-track { background: #F0F4F8; }
                .table-scrollbar::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
                  /* Parent & Child Product Styles - Simplified */
                .row-parent { 
                    background-color: #FFFFFF !important;
                    position: relative;
                }
                .row-parent:hover {
                    background-color: #FFFBF0 !important; /* Light gold tint for hover */
                }
                .row-parent .sticky-col-0, .row-parent .sticky-col-1, .row-parent .sticky-col-2 { 
                    background-color: white !important; 
                }
                .row-parent:hover .sticky-col-0, .row-parent:hover .sticky-col-1, .row-parent:hover .sticky-col-2 { 
                    background-color: #FFFBF0 !important; 
                }
                
                .row-child { 
                    background-color: #f1f5f9 !important;
                    position: relative;
                }
                .row-child:hover {
                    background-color: #e2e8f0 !important;
                }
                .row-child .sticky-col-0, .row-child .sticky-col-1, .row-child .sticky-col-2 { 
                    background-color: #f1f5f9 !important; 
                }
                .row-child:hover .sticky-col-0, .row-child:hover .sticky-col-1, .row-child:hover .sticky-col-2 { 
                    background-color: #e2e8f0 !important; 
                }
                
                /* Standard row hover fixes for sticky columns */
                tr:hover .sticky-col-0, tr:hover .sticky-col-1, tr:hover .sticky-col-2 {
                    background-color: #FFFBF0 !important;
                }
                tr.bg-gold\/10 .sticky-col-0, tr.bg-gold\/10 .sticky-col-1, tr.bg-gold\/10 .sticky-col-2 {
                    background-color: #fef3c7 !important;
                }
                
                .row-child .child-indent { 
                    padding-left: 32px !important; 
                }
                
                .expand-btn {
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .expand-btn:hover {
                    background-color: #9C845A;
                    color: white;
                    transform: scale(1.1);
                }
                
                .row-empty-child {
                    background-color: #fff1f2 !important;
                }
                
                .quick-edit-input {
                    display: inline-block !important;
                    width: auto !important;
                    min-width: 80px !important;
                    max-width: 100px !important;
                    background: white !important;
                    border: 2px solid #9C845A !important;
                    border-radius: 4px !important;
                    padding: 2px 6px !important;
                    font-size: 13px !important;
                    font-weight: 800 !important;
                    color: #1B365D !important;
                    outline: none !important;
                }
                
                .quick-edit-btn {
                    padding: 4px;
                    border-radius: 4px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    background: transparent;
                    border: none;
                }
                .quick-edit-btn:hover {
                    background-color: rgba(156, 132, 90, 0.1);
                    color: #9C845A;
                }
                .quick-save-btn {
                    color: #059669;
                }
                .quick-save-btn:hover {
                    background-color: #ecfdf5;
                }
                .quick-cancel-btn {
                    color: #dc2626;
                }
                .quick-cancel-btn:hover {
                    background-color: #fef2f2;
                }

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
                            placeholder="Tìm SKU / tên / mã NCC..."
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
                            <button onClick={() => setTempFilters((prev) => ({ ...getDefaultProductFilters(), search: prev?.search || '' }))} className="text-[13px] font-bold text-primary/40 hover:text-brick transition-colors">Thiết lập lại</button>
                            <button onClick={applyFilters} className="bg-primary text-white px-8 py-2 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all">Áp dụng bộ lọc</button>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 border-t border-l border-primary/10 rounded-sm mb-6 bg-primary/[0.02]">
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Danh mục</label>
                            <div className="relative" data-attr-dropdown>
                                <button 
                                    onClick={() => setOpenAttrId(openAttrId === 'category' ? null : 'category')}
                                    className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === 'category' ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                >
                                    <span className="truncate text-[13px] font-bold text-primary">
                                        {(tempFilters.category_id || []).length > 0 
                                            ? `Danh mục: ${(tempFilters.category_id || []).length}` 
                                            : `Chọn danh mục...`}
                                    </span>
                                    <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === 'category' ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {openAttrId === 'category' && (
                                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                            <div className="flex border-b border-primary/5 mb-1 px-1 gap-1">
                                                <button 
                                                    className="flex-1 py-1.5 text-[10px] font-black text-primary hover:bg-primary/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({
                                                            ...prev,
                                                            category_id: ['uncategorized', ...categories.map(c => String(c.id))]
                                                        }));
                                                    }}
                                                >Chọn tất cả</button>
                                                <button 
                                                    className="flex-1 py-1.5 text-[10px] font-black text-brick hover:bg-brick/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({ ...prev, category_id: [] }));
                                                    }}
                                                >Xóa hết</button>
                                            </div>
                                            <label className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={(tempFilters.category_id || []).includes('uncategorized')}
                                                    onChange={() => handleTempMultiSelectChange('category_id', 'uncategorized')}
                                                    className="w-4 h-4 accent-primary"
                                                />
                                                <span className={`text-[13px] ${(tempFilters.category_id || []).includes('uncategorized') ? 'font-bold text-primary' : 'text-stone-600'}`}>Chưa gắn danh mục</span>
                                            </label>
                                            {categories.map(c => (
                                                <label key={c.id} className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={(tempFilters.category_id || []).includes(String(c.id))}
                                                        onChange={() => handleTempMultiSelectChange('category_id', String(c.id))}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <span className={`text-[13px] ${(tempFilters.category_id || []).includes(String(c.id)) ? 'font-bold text-primary' : 'text-stone-600'}`}>{c.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Loại sản phẩm</label>
                            <div className="relative" data-attr-dropdown>
                                <button 
                                    onClick={() => setOpenAttrId(openAttrId === 'type' ? null : 'type')}
                                    className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === 'type' ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                >
                                    <span className="truncate text-[13px] font-bold text-primary">
                                        {(tempFilters.type || []).length > 0 
                                            ? `Loại: ${(tempFilters.type || []).length}` 
                                            : `Chọn loại...`}
                                    </span>
                                    <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === 'type' ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {openAttrId === 'type' && (
                                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                            <div className="flex border-b border-primary/5 mb-1 px-1 gap-1">
                                                <button 
                                                    className="flex-1 py-1.5 text-[10px] font-black text-primary hover:bg-primary/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({
                                                            ...prev,
                                                            type: Object.keys(TYPE_LABELS)
                                                        }));
                                                    }}
                                                >Chọn tất cả</button>
                                                <button 
                                                    className="flex-1 py-1.5 text-[10px] font-black text-brick hover:bg-brick/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({ ...prev, type: [] }));
                                                    }}
                                                >Xóa hết</button>
                                            </div>
                                            {Object.entries(TYPE_LABELS).map(([k, v]) => (
                                                <label key={k} className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={(tempFilters.type || []).includes(k)}
                                                        onChange={() => handleTempMultiSelectChange('type', k)}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <span className={`text-[13px] ${(tempFilters.type || []).includes(k) ? 'font-bold text-primary' : 'text-stone-600'}`}>{v.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Nhà cung cấp</label>
                            <div className="relative" data-attr-dropdown>
                                <button
                                    onClick={() => setOpenAttrId(openAttrId === 'supplier' ? null : 'supplier')}
                                    className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === 'supplier' ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                >
                                    <span className="truncate text-[13px] font-bold text-primary">
                                        {(tempFilters.supplier_ids || []).length > 0
                                            ? `NCC: ${(tempFilters.supplier_ids || []).length}`
                                            : 'Chọn nhà cung cấp...'}
                                    </span>
                                    <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === 'supplier' ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {openAttrId === 'supplier' && (
                                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[220px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                            <div className="flex border-b border-primary/5 mb-1 px-1 gap-1">
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-primary hover:bg-primary/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters((prev) => ({
                                                            ...prev,
                                                            supplier_ids: suppliers.map((supplier) => String(supplier.id)),
                                                        }));
                                                    }}
                                                >Chọn tất cả</button>
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-brick hover:bg-brick/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters((prev) => ({ ...prev, supplier_ids: [] }));
                                                    }}
                                                >Xóa hết</button>
                                            </div>
                                            <label className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={(tempFilters.supplier_ids || []).includes('unassigned')}
                                                    onChange={() => handleTempMultiSelectChange('supplier_ids', 'unassigned')}
                                                    className="w-4 h-4 accent-primary"
                                                />
                                                <span className={`text-[13px] ${(tempFilters.supplier_ids || []).includes('unassigned') ? 'font-bold text-primary' : 'text-stone-600'}`}>Chưa gắn nhà cung cấp</span>
                                            </label>
                                            {suppliers.map((supplier) => (
                                                <label key={supplier.id} className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(tempFilters.supplier_ids || []).includes(String(supplier.id))}
                                                        onChange={() => handleTempMultiSelectChange('supplier_ids', String(supplier.id))}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <span className={`text-[13px] ${(tempFilters.supplier_ids || []).includes(String(supplier.id)) ? 'font-bold text-primary' : 'text-stone-600'}`}>
                                                        {supplier.code ? `${supplier.name} - ${supplier.code}` : supplier.name}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Giá nhập</label>
                            <select
                                name="missing_purchase_price"
                                value={tempFilters.missing_purchase_price || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả trạng thái giá nhập</option>
                                <option value="1">Chưa có giá nhập</option>
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Nguồn nhập</label>
                            <select
                                name="multiple_suppliers"
                                value={tempFilters.multiple_suppliers || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả sản phẩm</option>
                                <option value="1">Có nhiều nhà cung cấp</option>
                            </select>
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

                    {allAttributes.filter(a => a.is_filterable_backend).length > 0 && (
                        <div className="mt-8 pt-6 border-t border-primary/10">
                            <h5 className="text-[15px] font-bold text-[#111] mb-4">Lọc theo thuộc tính</h5>
                            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm bg-primary/[0.02]">
                                {allAttributes.filter(a => a.is_filterable_backend).map((attr) => (
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
            {(
                (filters.category_id || []).length > 0
                || (filters.type || []).length > 0
                || (filters.supplier_ids || []).length > 0
                || Boolean(filters.missing_purchase_price)
                || Boolean(filters.multiple_suppliers)
                || Boolean(filters.min_stock)
                || Boolean(filters.max_stock)
                || Boolean(filters.start_date)
                || Boolean(filters.end_date)
                || Object.values(filters.attributes || {}).some(arr => arr.length > 0)
            ) && (
                <div className="flex flex-wrap items-center gap-2 mb-4 bg-primary/5 p-2 border border-primary/10 rounded-sm animate-in fade-in duration-300">
                    <span className="text-[13px] font-bold text-primary px-1 mr-1 border-r border-primary/20">Bộ lọc đang hoạt động:</span>
                    
                    {filters.category_id && Array.isArray(filters.category_id) && filters.category_id.length > 0 && filters.category_id.map(id => (
                        <div key={id} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Danh mục:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{id === 'uncategorized' ? 'Chưa gắn danh mục' : categories.find(c => String(c.id) === String(id))?.name}</span>
                            <button onClick={() => removeFilter('category_id', id)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    ))}
                    
                    {filters.type && Array.isArray(filters.type) && filters.type.length > 0 && filters.type.map(t => (
                        <div key={t} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Loại:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{TYPE_LABELS[t]?.label}</span>
                            <button onClick={() => removeFilter('type', t)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    ))}

                    {filters.supplier_ids && Array.isArray(filters.supplier_ids) && filters.supplier_ids.length > 0 && filters.supplier_ids.map((supplierId) => (
                        <div key={supplierId} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">NCC:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{getSupplierFilterLabel(suppliers, supplierId)}</span>
                            <button onClick={() => removeFilter('supplier_ids', supplierId)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    ))}

                    {filters.missing_purchase_price && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Giá nhập:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">Chưa có giá nhập</span>
                            <button onClick={() => removeFilter('missing_purchase_price')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {filters.multiple_suppliers && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Nguồn nhập:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">Có nhiều nhà cung cấp</span>
                            <button onClick={() => removeFilter('multiple_suppliers')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
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
                            products.map(product => {
                                const isParent = product.type === 'configurable' || product.type === 'grouped';
                                const isChild = product.parent_products?.length > 0;
                                const isExpanded = expandedRows.includes(product.id);
                                const children = product.type === 'grouped' ? (product.grouped_items || []) : (product.variations || []);
                                
                                const renderRow = (p, isSubRow = false) => {
                                    const pIsParent = p.type === 'configurable' || p.type === 'grouped';
                                    const pIsChild = isSubRow || p.parent_products?.length > 0;
                                    
                                    // Custom aggregate price display for parent products
                                    let displayCostPrice = p.cost_price;
                                    let displayPrice = p.price;
                                    const pVariants = p.variations || [];
                                    
                                    if (pIsParent && !isSubRow) {
                                        if (p.type === 'grouped') {
                                            const components = p.grouped_items || [];
                                            if (components.length > 0) {
                                                // Calculate sum of cost prices for Grouped Product
                                                displayCostPrice = components.reduce((sum, item) => sum + (Number(item.cost_price || 0) * (item.pivot?.quantity || 1)), 0);
                                                
                                                // Calculate sum of selling prices (if price_type is 'sum')
                                                if (p.price_type === 'sum') {
                                                    displayPrice = components.reduce((sum, item) => sum + (Number(item.price || 0) * (item.pivot?.quantity || 1)), 0);
                                                }
                                            }
                                        } else if (pVariants.length > 0) {
                                            // Existing logic for Configurable products
                                            const vCostPrices = pVariants.map(v => v.cost_price);
                                            const firstCost = vCostPrices[0];
                                            const allCostSame = vCostPrices.every(cp => cp !== null && cp !== undefined && Number(cp) === Number(firstCost));
                                            displayCostPrice = allCostSame ? firstCost : null;

                                            const vPrices = pVariants.map(v => v.price);
                                            const firstPrice = vPrices[0];
                                            const allPriceSame = vPrices.every(pr => pr !== null && pr !== undefined && Number(pr) === Number(firstPrice));
                                            displayPrice = allPriceSame ? firstPrice : null;
                                        }
                                    }
                                    
                                    return (
                                        <motion.tr
                                            key={p.id}
                                            initial={isSubRow ? { opacity: 0, y: -10 } : false}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            onClick={() => toggleSelectProduct(p.id)}
                                            onDoubleClick={() => navigate(`/admin/products/edit/${p.id}`)}
                                            className={`transition-all group cursor-pointer ${
                                                selectedIds.includes(p.id) ? 'bg-gold/10' : 
                                                pIsParent ? 'row-parent' : 
                                                pIsChild ? 'row-child' : 'hover:bg-gold/5'
                                            }`}
                                        >
                                            <td className="p-3 border border-primary/20 sticky-col-0" onDoubleClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-2">
                                                    {!isSubRow && pIsParent ? (
                                                        <button 
                                                            onClick={(e) => toggleExpandRow(p.id, e)} 
                                                            className={`size-6 flex items-center justify-center rounded-full border border-gold/30 text-gold transition-all expand-btn ${isExpanded ? 'bg-gold text-white rotate-90' : 'bg-white'}`}
                                                            title={isExpanded ? 'Thu gọn' : (p.type === 'grouped' ? 'Xem thành phần' : 'Xem biến thể')}
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                                        </button>
                                                    ) : !isSubRow ? (
                                                        <div className="size-6" /> // Spacer for non-configurable items
                                                    ) : null}
                                                    <input type="checkbox" checked={selectedIds.includes(p.id)} readOnly className="size-4 accent-primary" />
                                                </div>
                                            </td>
                                            {renderedColumns.map(col => {
                                                const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                                
                                                if (col.id === 'images') return <td key={col.id} style={cellStyle} className={`px-3 py-2 border border-primary/20 ${pIsChild ? 'bg-primary/[0.01]' : ''}`}><div className="size-10 bg-primary/5 border rounded overflow-hidden" onClick={(e) => { e.stopPropagation(); const url = getPrimaryImage(p); if (url) setPreviewImage({ url, name: p.name }); }}><img src={getPrimaryImage(p) || null} className="w-full h-full object-cover" alt="" /></div></td>;
                                                
                                                if (col.id === 'sku') return (
                                                    <td key={col.id} style={cellStyle} className={`px-3 py-2 border border-primary/20 sticky-col-1 font-mono font-bold text-primary group/cell ${pIsChild ? 'text-primary/60' : ''}`}>
                                                        <div className="flex items-center justify-between">
                                                            <span className="truncate">{p.sku}</span>
                                                            <button onClick={(e) => handleCopy(p.sku, 'mã sản phẩm', e, `${p.id}-sku`)} className={`${copiedText === `${p.id}-sku` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép mã SP">
                                                                <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-sku` ? 'check' : 'content_copy'}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                );
                                                
                                                if (col.id === 'name') return (
                                                    <td key={col.id} style={cellStyle} className={`px-3 py-2 border border-primary/20 sticky-col-2 font-bold group/cell ${pIsParent ? 'text-primary' : 'text-[#111]'} ${pIsChild ? 'child-indent' : ''}`}>
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <div className="flex flex-col gap-1 flex-1 overflow-hidden">
                                                                 <div className="flex items-center gap-2">
                                                                    <span className={`truncate ${pIsParent ? 'text-[14px] font-black uppercase tracking-tight' : 'text-[13px] font-bold'}`}>{p.name}</span>
                                                                    {isSubRow && product.type === 'grouped' && p.pivot && (
                                                                        <div className="flex items-center gap-1 shrink-0">
                                                                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-sm text-[10px] font-black">x{p.pivot.quantity}</span>
                                                                            {!p.pivot.is_required && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm text-[10px] font-black uppercase tracking-tighter">Tùy chọn</span>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button onClick={(e) => handleCopy(p.name, 'tên sản phẩm', e, `${p.id}-name`)} className={`${copiedText === `${p.id}-name` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all`} title="Sao chép tên SP">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-name` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                                
                                                if (col.id === 'supplier_product_code') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[12px] font-mono font-bold text-primary/80">
                                                        {p.supplier_product_code ? (
                                                            <span className="block truncate" title={p.supplier_product_code}>{p.supplier_product_code}</span>
                                                        ) : '--'}
                                                    </td>
                                                );

                                                if (col.id === 'cost_price') {
                                                    const isEditing = editingProductId === p.id;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#334155] font-bold tracking-tight group/cell">
                                                            <div className="flex items-center justify-between">
                                                                {isEditing ? (
                                                                    <div className="flex flex-col gap-1">
                                                                        <input type="number" className="w-24 border border-primary/20 rounded px-1.5 py-0.5 text-[11px] font-bold outline-none focus:border-primary" value={editForm.cost_price} onChange={(e) => setEditForm(prev => ({...prev, cost_price: e.target.value}))} onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickEdit(e)} autoFocus />
                                                                        <div className="flex gap-2">
                                                                            <button onClick={handleSaveQuickEdit} className="text-green-600 text-[10px] font-bold uppercase">Lưu</button>
                                                                            <button onClick={handleCancelQuickEdit} className="text-brick text-[10px] font-bold uppercase">Hủy</button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <React.Fragment>
                                                                        <span>{displayCostPrice ? new Intl.NumberFormat('vi-VN').format(Math.floor(displayCostPrice)) + '₫' : (pIsParent && pVariants.length > 0 ? '--' : (p.cost_price ? new Intl.NumberFormat('vi-VN').format(Math.floor(p.cost_price)) + '₫' : '--'))}</span>
                                                                        <div className="flex gap-1 shrink-0">
                                                                            {pIsChild && !isEditing && (
                                                                                <button onClick={(e) => handleStartQuickEdit(p, e)} className="quick-edit-btn opacity-0 group-hover/cell:opacity-100" title="Sửa nhanh giá nhập">
                                                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                                                </button>
                                                                            )}
                                                                            {p.cost_price && (
                                                                                <button onClick={(e) => handleCopy(String(Math.floor(displayCostPrice || p.cost_price)), 'giá nhập', e, `${p.id}-cost`)} className={`${copiedText === `${p.id}-cost` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all ml-1`} title="Sao chép giá nhập">
                                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-cost` ? 'check' : 'content_copy'}</span>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </React.Fragment>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }

                                                if (col.id === 'price') {
                                                    const isEditing = editingProductId === p.id;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-brick font-black tracking-tight group/cell">
                                                            <div className="flex items-center justify-between">
                                                                {isEditing ? (
                                                                    <div className="flex items-center gap-1 w-full">
                                                                        <input 
                                                                            type="number" 
                                                                            className="quick-edit-input" 
                                                                            value={editForm.price} 
                                                                            onChange={e => setEditForm({...editForm, price: Math.floor(e.target.value)})}
                                                                            onClick={e => e.stopPropagation()}
                                                                            onDoubleClick={e => { e.stopPropagation(); e.target.select(); }}
                                                                        />
                                                                        <div className="flex flex-col gap-0.5">
                                                                            <button 
                                                                                onClick={handleSaveQuickEdit} 
                                                                                disabled={savingId === p.id}
                                                                                className="quick-edit-btn quick-save-btn" 
                                                                                title="Lưu"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px] font-bold">{savingId === p.id ? 'sync' : 'check'}</span>
                                                                            </button>
                                                                            <button 
                                                                                onClick={handleCancelQuickEdit} 
                                                                                className="quick-edit-btn quick-cancel-btn" 
                                                                                title="Hủy"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <React.Fragment>
                                                                        <span>{displayPrice ? new Intl.NumberFormat('vi-VN').format(Math.floor(displayPrice)) + '₫' : (pIsParent && pVariants.length > 0 ? '--' : (p.price ? new Intl.NumberFormat('vi-VN').format(Math.floor(p.price)) + '₫' : '--'))}</span>
                                                                        <div className="flex gap-1 shrink-0">
                                                                            {pIsChild && !isEditing && (
                                                                                <button onClick={(e) => handleStartQuickEdit(p, e)} className="quick-edit-btn opacity-0 group-hover/cell:opacity-100" title="Sửa nhanh giá bán">
                                                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                                                </button>
                                                                            )}
                                                                            {p.price && (
                                                                                <button onClick={(e) => handleCopy(String(Math.floor(displayPrice || p.price)), 'giá bán', e, `${p.id}-price`)} className={`${copiedText === `${p.id}-price` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all ml-1`} title="Sao chép giá bán">
                                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-price` ? 'check' : 'content_copy'}</span>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </React.Fragment>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }

                                                if (col.id === 'stock') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 font-black text-primary group/cell">
                                                        <div className="flex items-center justify-between">
                                                            <span>{p.stock_quantity || 0}</span>
                                                            <button onClick={(e) => handleCopy(String(p.stock_quantity || 0), 'số lượng tồn kho', e, `${p.id}-stock`)} className={`${copiedText === `${p.id}-stock` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép tồn kho">
                                                                <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-stock` ? 'check' : 'content_copy'}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                );
                                                if (col.id === 'category') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#1e293b] font-medium truncate group/cell">
                                                         <div className="flex items-center justify-between">
                                                            <span className="truncate">{p.category?.name || '-'}</span>
                                                            {p.category?.name && (
                                                                <button onClick={(e) => handleCopy(p.category.name, 'danh mục', e, `${p.id}-cat`)} className={`${copiedText === `${p.id}-cat` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép danh mục">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-cat` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                                if (col.id === 'type') {
                                                    const typeLabel = TYPE_LABELS[p.type]?.label || p.type;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 group/cell">
                                                            <div className="flex items-center justify-between">
                                                                <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold border ${TYPE_LABELS[p.type]?.cls || ''}`}>{typeLabel}</span>
                                                                <button onClick={(e) => handleCopy(typeLabel, 'loại sản phẩm', e, `${p.id}-type`)} className={`${copiedText === `${p.id}-type` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép loại sản phẩm">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-type` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'specifications') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-primary/70 italic group/cell">
                                                        <div className="flex items-center justify-between">
                                                            <span className="truncate max-w-[150px]" title={p.specifications}>{p.specifications || '-'}</span>
                                                            {p.specifications && (
                                                                <button onClick={(e) => handleCopy(p.specifications, 'thông số kỹ thuật', e, `${p.id}-spec`)} className={`${copiedText === `${p.id}-spec` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-spec` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                                if (col.id === 'status') {
                                                    const statusText = p.status ? 'Bật' : 'Tắt';
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center group/cell">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold ${p.status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{statusText}</span>
                                                                <button onClick={(e) => handleCopy(statusText, 'trạng thái', e, `${p.id}-status`)} className={`${copiedText === `${p.id}-status` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép trạng thái">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-status` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'is_featured' || col.id === 'is_new') {
                                                    const val = p[col.id];
                                                    const text = val ? 'Có' : 'Không';
                                                    const label = col.id === 'is_featured' ? 'nổi bật' : 'mới';
                                                    const copyId = `${p.id}-${col.id}`;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center group/cell">
                                                            <div className="flex items-center justify-center gap-2">
                                                                {val ? <span className="material-symbols-outlined text-gold">check_circle</span> : <span className="material-symbols-outlined text-primary/30">circle</span>}
                                                                <button onClick={(e) => handleCopy(text, label, e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title={`Sao chép ${label}`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'actions') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-right">
                                                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {isTrashView ? (
                                                                <React.Fragment>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleRestore(p.id); }} className="p-1 hover:text-green-600" title="Khôi phục"><span className="material-symbols-outlined text-[18px]">restore</span></button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="p-1 hover:text-brick" title="Xóa vĩnh viễn"><span className="material-symbols-outlined text-[18px]">delete_forever</span></button>
                                                                </React.Fragment>
                                                            ) : (
                                                                <React.Fragment>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(p.id); }} className="p-1 hover:text-gold" title="Nhân bản"><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                                                                    <button onClick={(e) => { e.stopPropagation(); navigate(`/admin/products/edit/${p.id}`); }} className="p-1 hover:text-primary" title="Sửa"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="p-1 hover:text-brick" title="Xóa"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                                                </React.Fragment>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                                if (col.isAttribute) {
                                                    const val = getAttributeValue(p, col.attrId);
                                                    const copyId = `${p.id}-${col.id}`;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] truncate group/cell">
                                                            <div className="flex items-center justify-between">
                                                                <span className="truncate">{val}</span>
                                                                {val && val !== '-' && (
                                                                    <button onClick={(e) => handleCopy(val, col.label || 'thuộc tính', e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title={`Sao chép ${col.label}`}>
                                                                        <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                const defaultVal = String(p[col.id] ?? '-');
                                                const copyId = `${p.id}-${col.id}`;
                                                return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] truncate group/cell">
                                                        <div className="flex items-center justify-between">
                                                            <span className="truncate">{defaultVal}</span>
                                                            {defaultVal !== '-' && (
                                                                <button onClick={(e) => handleCopy(defaultVal, col.label || 'dữ liệu', e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title={`Sao chép ${col.label}`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </motion.tr>
                                    );
                                };

                                return (
                                    <React.Fragment key={product.id}>
                                        {renderRow(product)}
                                        <AnimatePresence>
                                            {isExpanded && (
                                                <React.Fragment>
                                                    {children.length > 0 ? (
                                                        children.map(child => renderRow(child, true))
                                                    ) : (
                                                        <motion.tr 
                                                            initial={{ opacity: 0, height: 0 }}
                                                            animate={{ opacity: 1, height: 'auto' }}
                                                            exit={{ opacity: 0, height: 0 }}
                                                            className="row-child row-empty-child"
                                                        >
                                                            <td className="p-3 border border-primary/20 sticky-col-0" />
                                                            <td colSpan={renderedColumns.length} className="px-8 py-5 border border-primary/20 text-red-400 italic text-[12px] font-bold flex items-center gap-2">
                                                                <span className="material-symbols-outlined text-[16px]">info</span>
                                                                {product.type === 'grouped' ? 'Nhóm sản phẩm này hiện chưa có thành phần nào' : 'Sản phẩm này hiện chưa được cấu hình biến thể chi tiết'}
                                                            </td>
                                                        </motion.tr>
                                                    )}
                                                </React.Fragment>
                                            )}
                                        </AnimatePresence>
                                    </React.Fragment>
                                );
                            })


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

                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Nhà cung cấp</label>
                                        <div className="rounded-sm border border-primary/20 bg-primary/5 p-2">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <span className="text-[11px] font-bold text-primary/55">
                                                    {(bulkUpdateData.supplier_ids || []).length > 0
                                                        ? `Đã chọn ${(bulkUpdateData.supplier_ids || []).length} nhà cung cấp`
                                                        : '-- Bỏ qua --'}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setBulkUpdateData({ ...bulkUpdateData, supplier_ids: [] })}
                                                    className="text-[11px] font-bold text-brick hover:underline"
                                                >
                                                    Xóa chọn
                                                </button>
                                            </div>
                                            <div className="max-h-32 space-y-1 overflow-y-auto rounded-sm bg-white p-2">
                                                {suppliers.map((supplier) => (
                                                    <label key={supplier.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[12px] text-primary hover:bg-primary/5">
                                                        <input
                                                            type="checkbox"
                                                            checked={(bulkUpdateData.supplier_ids || []).includes(String(supplier.id))}
                                                            onChange={() => toggleBulkSupplierSelection(supplier.id)}
                                                            className="size-4 accent-primary"
                                                        />
                                                        <span className="truncate">
                                                            {supplier.code ? `${supplier.name} - ${supplier.code}` : supplier.name}
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
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
