import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import { useUI } from '../../context/UIContext';
import { useTableColumns } from '../../hooks/useTableColumns';
import { categoryApi, inventoryApi, orderApi, productApi } from '../../services/api';

const emptyPagination = { current_page: 1, last_page: 1, total: 0, per_page: 20 };
const todayValue = new Date().toISOString().slice(0, 10);
const tableViewportClass = 'max-h-[calc(100vh-310px)] overflow-auto';
const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const inputClass = 'h-8 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const selectClass = `${inputClass} pr-8`;
const primaryButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-brick px-3 text-[12px] font-bold text-white transition hover:bg-umber disabled:cursor-not-allowed disabled:opacity-60';
const ghostButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-bold text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const dangerButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-brick/20 bg-white px-3 text-[12px] font-bold text-brick transition hover:bg-brick hover:text-white disabled:cursor-not-allowed disabled:opacity-60';
const iconButton = (active) => `inline-flex h-8 w-8 items-center justify-center rounded-sm border transition ${active ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/5'}`;
const checkboxClass = 'size-4 rounded border-primary/20 accent-primary';

const tabs = [
    ['overview', 'Tổng quan'],
    ['products', 'Sản phẩm'],
    ['suppliers', 'Nhà cung cấp'],
    ['imports', 'Phiếu nhập'],
    ['exports', 'Phiếu xuất bán'],
    ['returns', 'Phiếu hàng hoàn'],
    ['damaged', 'Phiếu hàng hỏng'],
    ['adjustments', 'Phiếu điều chỉnh'],
    ['lots', 'Lô hàng'],
    ['trash', 'Thùng rác'],
];

const documentTypeMap = { returns: 'return', damaged: 'damaged', adjustments: 'adjustment' };
const documentTitleMap = { returns: 'Phiếu hàng hoàn', damaged: 'Phiếu hàng hỏng', adjustments: 'Phiếu điều chỉnh' };
const pageSizeOptions = [20, 50, 100, 500];
const getStoredPageSize = (key) => {
    if (typeof window === 'undefined') return 20;
    const raw = Number(localStorage.getItem(`inventory_page_size_${key}`) || 20);
    return pageSizeOptions.includes(raw) ? raw : 20;
};

const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))}đ`;
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
};
const normalizeSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();

const createLine = (overrides = {}) => ({
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    product_id: '',
    product_name: '',
    product_sku: '',
    quantity: '1',
    unit_cost: '',
    notes: '',
    update_supplier_price: false,
    stock_bucket: 'sellable',
    direction: 'in',
    ...overrides,
});

const createSupplierForm = (supplier = null) => ({
    id: supplier?.id || null,
    code: supplier?.code || '',
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    address: supplier?.address || '',
    notes: supplier?.notes || '',
    status: supplier?.status ?? true,
});

const createImportForm = (data = null) => ({
    id: data?.id || null,
    supplier_id: data?.supplier_id ? String(data.supplier_id) : '',
    import_date: data?.import_date ? String(data.import_date).slice(0, 10) : todayValue,
    notes: data?.notes || '',
    update_supplier_prices: Boolean(data?.update_supplier_prices),
    items: (data?.items || []).length
        ? data.items.map((item) => createLine({
            product_id: item.product_id,
            product_name: item.product?.name || item.product_name_snapshot || '',
            product_sku: item.product?.sku || item.product_sku_snapshot || '',
            quantity: String(item.quantity || 1),
            unit_cost: String(Math.round(Number(item.unit_cost || 0))),
            notes: item.notes || '',
            update_supplier_price: Boolean(item.price_was_updated),
        }))
        : [createLine()],
});

const createDocumentForm = (tabKey, data = null) => ({
    id: data?.id || null,
    type: documentTypeMap[tabKey],
    document_date: data?.document_date ? String(data.document_date).slice(0, 10) : todayValue,
    supplier_id: data?.supplier_id ? String(data.supplier_id) : '',
    notes: data?.notes || '',
    items: (data?.items || []).length
        ? data.items.map((item) => createLine({
            product_id: item.product_id,
            product_name: item.product?.name || item.product_name_snapshot || '',
            product_sku: item.product?.sku || item.product_sku_snapshot || '',
            quantity: String(item.quantity || 1),
            unit_cost: item.unit_cost != null ? String(Math.round(Number(item.unit_cost || 0))) : '',
            notes: item.notes || '',
            stock_bucket: item.stock_bucket || 'sellable',
            direction: item.direction || 'in',
        }))
        : [createLine()],
});

const productColumns = [
    { id: 'sku', label: 'Mã', minWidth: 150 },
    { id: 'name', label: 'Tên sản phẩm', minWidth: 250 },
    { id: 'type_label', label: 'Loại', minWidth: 150 },
    { id: 'total_imported', label: 'Tổng nhập', minWidth: 110, align: 'right' },
    { id: 'total_exported', label: 'Tổng xuất bán', minWidth: 125, align: 'right' },
    { id: 'total_returned', label: 'Tổng hoàn', minWidth: 110, align: 'right' },
    { id: 'total_damaged', label: 'Tổng hỏng', minWidth: 110, align: 'right' },
    { id: 'stock_quantity', label: 'Tồn bán được', minWidth: 120, align: 'right' },
    { id: 'damaged_quantity', label: 'Tồn hỏng', minWidth: 110, align: 'right' },
    { id: 'expected_cost', label: 'Giá dự kiến', minWidth: 120, align: 'right' },
    { id: 'current_cost', label: 'Giá vốn hiện tại', minWidth: 130, align: 'right' },
    { id: 'inventory_value', label: 'Thành tiền tồn', minWidth: 140, align: 'right' },
    { id: 'price_status', label: 'Trạng thái giá', minWidth: 150 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const supplierColumns = [
    { id: 'name', label: 'Nhà cung cấp', minWidth: 220 },
    { id: 'code', label: 'Mã', minWidth: 120 },
    { id: 'phone', label: 'Điện thoại', minWidth: 135 },
    { id: 'prices_count', label: 'Bảng giá', minWidth: 95, align: 'right' },
    { id: 'import_slips_count', label: 'Số phiếu nhập', minWidth: 115, align: 'right' },
    { id: 'imported_quantity_total', label: 'Tổng số lượng', minWidth: 115, align: 'right' },
    { id: 'imported_amount_total', label: 'Tổng tiền nhập', minWidth: 135, align: 'right' },
    { id: 'actions', label: 'Thao tác', minWidth: 135, align: 'center' },
];

const supplierPriceBaseColumns = [
    { id: 'sku', label: 'Mã sản phẩm', minWidth: 150 },
    { id: 'name', label: 'Tên sản phẩm', minWidth: 280 },
    { id: 'price', label: 'Giá bán', minWidth: 110, align: 'right' },
    { id: 'supplier_unit_cost', label: 'Giá dự kiến', minWidth: 160, align: 'right' },
    { id: 'current_cost', label: 'Giá vốn hiện tại', minWidth: 125, align: 'right' },
    { id: 'supplier_price_updated_at', label: 'Sửa gần nhất', minWidth: 150, align: 'center' },
];

const importColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'supplier', label: 'Nhà cung cấp', minWidth: 220 },
    { id: 'date', label: 'Ngày nhập', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'Tổng số lượng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Tổng tiền', minWidth: 130, align: 'right' },
    { id: 'note', label: 'Ghi chú', minWidth: 200 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const exportColumns = [
    { id: 'code', label: 'Mã đơn', minWidth: 140 },
    { id: 'customer', label: 'Khách hàng', minWidth: 220 },
    { id: 'date', label: 'Ngày tạo', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'revenue', label: 'Doanh thu', minWidth: 120, align: 'right' },
    { id: 'cost', label: 'Giá vốn', minWidth: 120, align: 'right' },
    { id: 'profit', label: 'Lãi gộp', minWidth: 120, align: 'right' },
    { id: 'status', label: 'Trạng thái', minWidth: 120 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const documentColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'supplier', label: 'Nhà cung cấp', minWidth: 200 },
    { id: 'date', label: 'Ngày', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'Số lượng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Giá trị', minWidth: 120, align: 'right' },
    { id: 'note', label: 'Ghi chú', minWidth: 200 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const lotColumns = [
    { id: 'code', label: 'Mã lô', minWidth: 150 },
    { id: 'product', label: 'Sản phẩm', minWidth: 250 },
    { id: 'date', label: 'Ngày nhập', minWidth: 150 },
    { id: 'qty', label: 'Số lượng lô', minWidth: 110, align: 'right' },
    { id: 'remaining', label: 'Còn lại', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Giá nhập', minWidth: 110, align: 'right' },
    { id: 'source', label: 'Nguồn', minWidth: 180 },
];

const trashColumns = [
    { id: 'code', label: 'Mã', minWidth: 140 },
    { id: 'product', label: 'Sản phẩm', minWidth: 250 },
    { id: 'date', label: 'Ngày xóa', minWidth: 150 },
    { id: 'price_status', label: 'Trạng thái giá', minWidth: 140 },
    { id: 'actions', label: 'Thao tác', minWidth: 190, align: 'center' },
];

const PanelHeader = ({ title, description, toggles = [], actions = null }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/10 px-3 py-2.5">
        <div>
            <div className="text-[13px] font-black text-primary">{title}</div>
            {description ? <div className="text-[11px] text-primary/45">{description}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
            {toggles.map((toggle) => (
                <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                    <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                </button>
            ))}
            {actions}
        </div>
    </div>
);

const FilterPanel = ({ children, actions }) => (
    <div className="border-b border-primary/10 bg-[#fbfcfe] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
            {children}
            <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </div>
    </div>
);

const SummaryPanel = ({ items }) => (
    <div className="border-b border-primary/10 bg-white px-3 py-2.5">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => (
                <div key={item.label} className="rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2">
                    <div className="truncate text-[11px] font-semibold text-primary/55">{item.label}</div>
                    <div className="mt-1 truncate text-[15px] font-black text-primary">{item.value}</div>
                </div>
            ))}
        </div>
    </div>
);

const CellText = ({ primary, secondary = null, mono = false }) => (
    <div className="min-w-0">
        <div className={`truncate font-semibold text-primary ${mono ? 'font-mono text-[12px]' : ''}`}>{primary}</div>
        {secondary ? <div className="mt-0.5 truncate text-[11px] text-primary/45">{secondary}</div> : null}
    </div>
);

const IndeterminateCheckbox = ({ checked, indeterminate = false, onChange, disabled = false, title = '' }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.indeterminate = Boolean(indeterminate && !checked);
        }
    }, [checked, indeterminate]);

    return (
        <input
            ref={inputRef}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            title={title}
            className={`${checkboxClass} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        />
    );
};

const ModalShell = ({ open, title, onClose, children, footer, maxWidth = 'max-w-5xl' }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
            <div className={`w-full ${maxWidth} overflow-hidden rounded-sm bg-white shadow-2xl`} onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <div className="text-[24px] font-black text-primary">{title}</div>
                    <button type="button" onClick={onClose} className="text-primary/35 transition hover:text-primary">
                        <span className="material-symbols-outlined text-[28px]">close</span>
                    </button>
                </div>
                <div className="max-h-[72vh] overflow-auto px-5 py-4">{children}</div>
                {footer ? <div className="border-t border-primary/10 px-5 py-4">{footer}</div> : null}
            </div>
        </div>
    );
};

const ProductLookupInput = ({ supplierId = null, onSelect, placeholder = 'Tìm sản phẩm theo mã hoặc tên', buttonLabel = 'Chọn' }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            return undefined;
        }

        let active = true;
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const response = await inventoryApi.getProducts({
                    search: trimmed,
                    with_variants: 1,
                    per_page: 8,
                    supplier_id: supplierId || undefined,
                });

                const flattened = [];
                (response.data.data || []).forEach((product) => {
                    if (product.has_variants && Array.isArray(product.variants) && product.variants.length) {
                        product.variants.forEach((variant) => {
                            flattened.push({ ...variant, parent_name: product.name, parent_sku: product.sku });
                        });
                    } else {
                        flattened.push(product);
                    }
                });

                if (active) setResults(flattened.slice(0, 10));
            } catch (error) {
                if (active) setResults([]);
            } finally {
                if (active) setLoading(false);
            }
        }, 250);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [query, supplierId]);

    return (
        <div className="space-y-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className={`w-full ${inputClass}`} />
            {query.trim().length >= 2 ? (
                <div className="overflow-hidden rounded-sm border border-primary/10">
                    <div className="max-h-56 overflow-auto">
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tìm sản phẩm...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không có sản phẩm phù hợp.</div> : null}
                        {!loading && results.map((row) => (
                            <button
                                key={row.id}
                                type="button"
                                onClick={() => {
                                    onSelect(row);
                                    setQuery('');
                                    setResults([]);
                                }}
                                className="flex w-full items-center justify-between border-b border-primary/10 px-3 py-2 text-left transition last:border-b-0 hover:bg-primary/[0.04]"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-[13px] font-semibold text-primary">{row.name}</div>
                                    <div className="truncate text-[11px] text-primary/45">{row.sku}{row.parent_name ? ` | Thuộc: ${row.parent_name}` : ''}</div>
                                </div>
                                <div className="ml-3 shrink-0 text-[12px] font-semibold text-primary/70">{buttonLabel}</div>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const InventoryTable = ({
    storageKey,
    columns,
    rows,
    renderCell,
    loading,
    pagination,
    onPageChange,
    footer,
    rowKey = 'id',
    rowClassName,
    settingsOpen = false,
    onCloseSettings,
    currentPerPage = 20,
    onPerPageChange,
}) => {
    const {
        availableColumns,
        visibleColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        setAvailableColumns,
        resetDefault,
        saveAsDefault,
    } = useTableColumns(storageKey, columns);

    return (
        <div className={panelClass}>
            {settingsOpen ? (
                <TableColumnSettingsPanel
                    availableColumns={availableColumns}
                    visibleColumns={visibleColumns}
                    toggleColumn={toggleColumn}
                    setAvailableColumns={setAvailableColumns}
                    resetDefault={resetDefault}
                    saveAsDefault={saveAsDefault}
                    onClose={onCloseSettings}
                    storageKey={storageKey}
                />
            ) : null}
            <div className={tableViewportClass}>
                <table className="w-full border-collapse table-fixed" style={{ minWidth: `${Math.max(totalTableWidth, 900)}px` }}>
                    <thead className="sticky top-0 z-10 bg-[#f6f9fc]">
                        <tr>
                            {renderedColumns.map((column, index) => (
                                <th
                                    key={column.id}
                                    draggable={column.draggable !== false}
                                    onDragStart={column.draggable === false ? undefined : (event) => handleHeaderDragStart(event, index)}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={column.draggable === false ? undefined : (event) => handleHeaderDrop(event, index)}
                                    className="relative border-b border-r border-primary/10 px-3 py-3 text-center text-[12px] font-bold text-primary"
                                    style={{ width: columnWidths[column.id] || column.minWidth }}
                                >
                                    <span className="block truncate">{column.headerRender ? column.headerRender() : column.label}</span>
                                    <div onMouseDown={(event) => handleColumnResize(column.id, event)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize transition hover:bg-brick/20" title="Kéo để đổi độ rộng cột" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? <tr><td colSpan={renderedColumns.length} className="px-4 py-10 text-center text-[13px] text-primary/55">Đang tải dữ liệu...</td></tr> : null}
                        {!loading && rows.length === 0 ? <tr><td colSpan={renderedColumns.length} className="px-4 py-10 text-center text-[13px] text-primary/55">Không có dữ liệu.</td></tr> : null}
                        {!loading && rows.map((row) => {
                            const key = typeof rowKey === 'function' ? rowKey(row) : row[rowKey];
                            return (
                                <tr key={key} className={rowClassName ? rowClassName(row) : 'hover:bg-primary/[0.02]'}>
                                    {renderedColumns.map((column) => (
                                        <td key={`${key}_${column.id}`} className={`overflow-hidden border-b border-r border-primary/10 px-3 py-2.5 text-[13px] text-primary ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}>
                                            <div className="min-w-0 overflow-hidden text-ellipsis">{renderCell(row, column.id)}</div>
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 px-3 py-3">
                <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-[12px] text-primary/55">
                        <span>Hiển thị</span>
                        <select
                            value={currentPerPage}
                            onChange={(event) => onPerPageChange?.(Number(event.target.value))}
                            className="h-8 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-semibold text-primary outline-none focus:border-primary"
                        >
                            {pageSizeOptions.map((size) => <option key={size} value={size}>{size} dòng</option>)}
                        </select>
                    </label>
                    <div className="text-[12px] text-primary/55">{footer}</div>
                </div>
                {pagination ? <Pagination pagination={pagination} onPageChange={onPageChange} /> : null}
            </div>
        </div>
    );
};

const InventoryMovement = () => {
    const navigate = useNavigate();
    const { showToast } = useUI();

    const [activeTab, setActiveTab] = useState('products');
    const [dashboard, setDashboard] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [productSummary, setProductSummary] = useState(null);
    const [suppliers, setSuppliers] = useState([]);
    const [supplierSummary, setSupplierSummary] = useState(null);
    const [selectedSupplierId, setSelectedSupplierId] = useState(null);
    const [supplierCatalog, setSupplierCatalog] = useState([]);
    const [imports, setImports] = useState([]);
    const [exportsData, setExportsData] = useState([]);
    const [returnsData, setReturnsData] = useState([]);
    const [damagedData, setDamagedData] = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [lots, setLots] = useState([]);
    const [trashItems, setTrashItems] = useState([]);

    const [productPagination, setProductPagination] = useState(emptyPagination);
    const [supplierPagination, setSupplierPagination] = useState(emptyPagination);
    const [supplierCatalogPagination, setSupplierCatalogPagination] = useState(emptyPagination);
    const [importPagination, setImportPagination] = useState(emptyPagination);
    const [exportPagination, setExportPagination] = useState(emptyPagination);
    const [returnPagination, setReturnPagination] = useState(emptyPagination);
    const [damagedPagination, setDamagedPagination] = useState(emptyPagination);
    const [adjustmentPagination, setAdjustmentPagination] = useState(emptyPagination);
    const [lotPagination, setLotPagination] = useState(emptyPagination);
    const [trashPagination, setTrashPagination] = useState(emptyPagination);

    const [loading, setLoading] = useState({
        overview: false, products: false, suppliers: false, supplierCatalog: false, imports: false, exports: false,
        returns: false, damaged: false, adjustments: false, lots: false, trash: false, saving: false,
        supplierModal: false, importModal: false, documentModal: false,
    });

    const [openPanels, setOpenPanels] = useState({
        overview: { stats: true },
        products: { filters: false, stats: false, columns: false },
        suppliers: { filters: false, stats: false, columns: false },
        supplierPrices: { filters: false, stats: false, columns: false },
        imports: { filters: false, stats: false, columns: false },
        exports: { filters: false, stats: false, columns: false },
        returns: { filters: false, stats: false, columns: false },
        damaged: { filters: false, stats: false, columns: false },
        adjustments: { filters: false, stats: false, columns: false },
        lots: { filters: false, stats: false, columns: false },
        trash: { filters: false, stats: false, columns: false },
    });

    const [productFilters, setProductFilters] = useState({ search: '', status: '', cost_source: '', type: '', category_id: '', variant_scope: '', date_from: '', date_to: '' });
    const [supplierFilters, setSupplierFilters] = useState({ search: '', status: '', month: '', date_from: '', date_to: '' });
    const [supplierCatalogFilters, setSupplierCatalogFilters] = useState({ sku: '', name: '', category_id: '', type: '', variant_scope: 'roots' });
    const [supplierQuickSearch, setSupplierQuickSearch] = useState('');
    const [simpleFilters, setSimpleFilters] = useState({
        imports: { search: '', date_from: '', date_to: '' },
        exports: { search: '', date_from: '', date_to: '' },
        returns: { search: '', date_from: '', date_to: '' },
        damaged: { search: '', date_from: '', date_to: '' },
        adjustments: { search: '', date_from: '', date_to: '' },
        lots: { search: '', date_from: '', date_to: '' },
        trash: { search: '', date_from: '', date_to: '' },
    });

    const [expandedGroups, setExpandedGroups] = useState({});
    const [selectedPriceIds, setSelectedPriceIds] = useState({});
    const [priceDrafts, setPriceDrafts] = useState({});
    const [savingPriceIds, setSavingPriceIds] = useState({});
    const [supplierDetailOpen, setSupplierDetailOpen] = useState({});
    const [groupPriceDrafts, setGroupPriceDrafts] = useState({});
    const [bulkPrice, setBulkPrice] = useState('');
    const [bulkNote, setBulkNote] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [showPasteBox, setShowPasteBox] = useState(false);
    const [supplierModal, setSupplierModal] = useState({ open: false, form: createSupplierForm() });
    const [importModal, setImportModal] = useState({ open: false, form: createImportForm() });
    const [documentModal, setDocumentModal] = useState({ open: false, tabKey: 'returns', form: createDocumentForm('returns') });
    const [pageSizes, setPageSizes] = useState(() => ({
        products: getStoredPageSize('products'),
        suppliers: getStoredPageSize('suppliers'),
        supplierPrices: getStoredPageSize('supplierPrices'),
        imports: getStoredPageSize('imports'),
        exports: getStoredPageSize('exports'),
        returns: getStoredPageSize('returns'),
        damaged: getStoredPageSize('damaged'),
        adjustments: getStoredPageSize('adjustments'),
        lots: getStoredPageSize('lots'),
        trash: getStoredPageSize('trash'),
    }));

    const setFlag = (key, value) => setLoading((prev) => ({ ...prev, [key]: value }));
    const fail = (error, fallback) => {
        const message = error?.response?.data?.errors ? Object.values(error.response.data.errors).flat().join('\n') : (error?.response?.data?.message || fallback);
        showToast({ type: 'error', message });
    };
    const pageState = (setter, response) => setter({
        current_page: response.data.current_page,
        last_page: response.data.last_page,
        total: response.data.total,
        per_page: Number(response.data.per_page),
    });

    const togglePanel = (section, panel) => {
        setOpenPanels((prev) => ({ ...prev, [section]: { ...prev[section], [panel]: !prev[section]?.[panel] } }));
    };
    const updatePageSize = (key, size) => {
        const nextSize = pageSizeOptions.includes(size) ? size : 20;
        setPageSizes((prev) => ({ ...prev, [key]: nextSize }));
        localStorage.setItem(`inventory_page_size_${key}`, String(nextSize));
        return nextSize;
    };

    const updateLine = (setter, index, field, value) => {
        setter((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                items: prev.form.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
            },
        }));
    };

    const addLine = (setter) => {
        setter((prev) => ({ ...prev, form: { ...prev.form, items: [...prev.form.items, createLine()] } }));
    };

    const removeLine = (setter, index) => {
        setter((prev) => {
            const nextItems = prev.form.items.filter((_, itemIndex) => itemIndex !== index);
            return { ...prev, form: { ...prev.form, items: nextItems.length ? nextItems : [createLine()] } };
        });
    };

    const attachProductToLine = (setter, index, product) => {
        setter((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                items: prev.form.items.map((item, itemIndex) => itemIndex === index ? {
                    ...item,
                    product_id: product.id,
                    product_name: product.name,
                    product_sku: product.sku,
                    unit_cost: String(Math.round(Number(product.supplier_unit_cost ?? product.current_cost ?? product.expected_cost ?? 0))),
                } : item),
            },
        }));
    };

    const fetchOverview = async () => {
        setFlag('overview', true);
        try {
            const response = await inventoryApi.getDashboard();
            setDashboard(response.data);
        } catch (error) {
            fail(error, 'Không thể tải tổng quan kho.');
        } finally {
            setFlag('overview', false);
        }
    };

    const fetchProducts = async (page = 1, perPage = pageSizes.products) => {
        setFlag('products', true);
        try {
            const response = await inventoryApi.getProducts({ ...productFilters, page, per_page: perPage });
            setProducts(response.data.data || []);
            setProductSummary(response.data.summary || null);
            pageState(setProductPagination, response);
        } catch (error) {
            fail(error, 'Không thể tải sản phẩm kho.');
        } finally {
            setFlag('products', false);
        }
    };

    const fetchSuppliers = async (page = 1, perPage = pageSizes.suppliers) => {
        setFlag('suppliers', true);
        try {
            const response = await inventoryApi.getSuppliers({ ...supplierFilters, page, per_page: perPage });
            const rows = response.data.data || [];
            setSuppliers(rows);
            setSupplierSummary(response.data.summary || null);
            pageState(setSupplierPagination, response);
            setSelectedSupplierId((prev) => rows.some((item) => item.id === prev) ? prev : (rows[0]?.id || null));
        } catch (error) {
            fail(error, 'Không thể tải nhà cung cấp.');
        } finally {
            setFlag('suppliers', false);
        }
    };

    const fetchSupplierCatalog = async (page = 1, perPage = pageSizes.supplierPrices) => {
        if (!selectedSupplierId) return;
        setFlag('supplierCatalog', true);
        try {
            const response = await inventoryApi.getProducts({
                ...supplierCatalogFilters,
                supplier_id: selectedSupplierId,
                quick_search: supplierQuickSearch.trim(),
                with_variants: 1,
                page,
                per_page: perPage,
            });
            setSupplierCatalog(response.data.data || []);
            pageState(setSupplierCatalogPagination, response);
        } catch (error) {
            fail(error, 'Không thể tải bảng giá nhà cung cấp.');
        } finally {
            setFlag('supplierCatalog', false);
        }
    };

    const fetchSimple = async (key, apiCall, setter, paginationSetter, page = 1, perPage = pageSizes[key] || 20) => {
        setFlag(key, true);
        try {
            const response = await apiCall(page, perPage);
            setter(response.data.data || []);
            pageState(paginationSetter, response);
        } catch (error) {
            fail(error, 'Không thể tải dữ liệu kho.');
        } finally {
            setFlag(key, false);
        }
    };

    const fetchImports = (page = 1, perPage = pageSizes.imports) => fetchSimple('imports', (currentPage, currentPerPage) => inventoryApi.getImports({ ...simpleFilters.imports, page: currentPage, per_page: currentPerPage }), setImports, setImportPagination, page, perPage);
    const fetchExports = (page = 1, perPage = pageSizes.exports) => fetchSimple('exports', (currentPage, currentPerPage) => inventoryApi.getExports({ ...simpleFilters.exports, page: currentPage, per_page: currentPerPage }), setExportsData, setExportPagination, page, perPage);
    const fetchDocuments = (type, page = 1, perPage = pageSizes[{ return: 'returns', damaged: 'damaged', adjustment: 'adjustments' }[type]]) => {
        const map = { return: ['returns', setReturnsData, setReturnPagination], damaged: ['damaged', setDamagedData, setDamagedPagination], adjustment: ['adjustments', setAdjustments, setAdjustmentPagination] };
        const [key, setter, paginationSetter] = map[type];
        return fetchSimple(key, (currentPage, currentPerPage) => inventoryApi.getDocuments(type, { ...simpleFilters[key], page: currentPage, per_page: currentPerPage }), setter, paginationSetter, page, perPage);
    };
    const fetchLots = (page = 1, perPage = pageSizes.lots) => fetchSimple('lots', (currentPage, currentPerPage) => inventoryApi.getBatches({ ...simpleFilters.lots, page: currentPage, per_page: currentPerPage, remaining_only: 1 }), setLots, setLotPagination, page, perPage);
    const fetchTrash = (page = 1, perPage = pageSizes.trash) => fetchSimple('trash', (currentPage, currentPerPage) => inventoryApi.getProducts({ ...simpleFilters.trash, page: currentPage, per_page: currentPerPage, trash: 1 }), setTrashItems, setTrashPagination, page, perPage);

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const response = await categoryApi.getAll();
                setCategories(Array.isArray(response.data) ? response.data : (response.data?.data || []));
            } catch (error) {
                fail(error, 'Không thể tải danh mục.');
            }
        };

        loadCategories();
        fetchOverview();
    }, []);

    useEffect(() => {
        if (activeTab === 'products') fetchProducts(productPagination.current_page || 1);
        if (activeTab === 'suppliers') fetchSuppliers(supplierPagination.current_page || 1);
        if (activeTab === 'imports') fetchImports(importPagination.current_page || 1);
        if (activeTab === 'exports') fetchExports(exportPagination.current_page || 1);
        if (activeTab === 'returns') fetchDocuments('return', returnPagination.current_page || 1);
        if (activeTab === 'damaged') fetchDocuments('damaged', damagedPagination.current_page || 1);
        if (activeTab === 'adjustments') fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
        if (activeTab === 'lots') fetchLots(lotPagination.current_page || 1);
        if (activeTab === 'trash') fetchTrash(trashPagination.current_page || 1);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'suppliers') return;
        if (selectedSupplierId) {
            fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
        } else {
            setSupplierCatalog([]);
            setSupplierCatalogPagination(emptyPagination);
        }
    }, [activeTab, selectedSupplierId]);

    useEffect(() => {
        setSelectedPriceIds({});
        setPriceDrafts({});
        setSavingPriceIds({});
        setExpandedGroups({});
        setGroupPriceDrafts({});
        setBulkPrice('');
        setBulkNote('');
        setPasteText('');
    }, [selectedSupplierId]);

    useEffect(() => {
        if (activeTab !== 'suppliers') return undefined;
        const timer = setTimeout(() => {
            fetchSuppliers(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, supplierFilters.search]);

    useEffect(() => {
        if (activeTab !== 'suppliers' || !selectedSupplierId) return undefined;
        const timer = setTimeout(() => {
            fetchSupplierCatalog(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, selectedSupplierId, supplierQuickSearch, supplierCatalogFilters.sku, supplierCatalogFilters.name]);

    const ensureSuppliersLoaded = async () => {
        if (suppliers.length > 0) return;
        await fetchSuppliers(1);
    };

    const currentSupplier = useMemo(
        () => suppliers.find((item) => item.id === selectedSupplierId) || null,
        [selectedSupplierId, suppliers]
    );

    const supplierCatalogItemRows = useMemo(() => {
        const rows = [];
        supplierCatalog.forEach((product) => {
            if (product.has_variants) {
                (product.variants || []).forEach((variant) => {
                    rows.push({
                        ...variant,
                        row_kind: 'item',
                        row_id: `variant_${variant.id}`,
                        group_name: product.name,
                        parent_group_id: product.id,
                    });
                });
            } else {
                rows.push({ ...product, row_kind: 'item', row_id: `item_${product.id}` });
            }
        });
        return rows;
    }, [supplierCatalog]);

    const supplierRows = useMemo(() => {
        const rows = [];
        const normalizedQuickSearch = normalizeSearchText(supplierQuickSearch);
        const matchesQuickSearch = (row, extraFields = []) => {
            if (!normalizedQuickSearch) return true;
            return [row?.sku, row?.name, row?.parent_name, row?.parent_sku, ...extraFields]
                .some((value) => normalizeSearchText(value).includes(normalizedQuickSearch));
        };

        supplierCatalog.forEach((product) => {
            if (product.has_variants) {
                const variants = product.variants || [];
                const productMatches = matchesQuickSearch(product);
                const matchedVariants = normalizedQuickSearch
                    ? variants.filter((variant) => matchesQuickSearch(variant, [product.name, product.sku]))
                    : variants;
                if (!productMatches && normalizedQuickSearch && matchedVariants.length === 0) {
                    return;
                }

                rows.push({
                    ...product,
                    row_kind: 'group',
                    row_id: `group_${product.id}`,
                    visible_variant_count: productMatches ? variants.length : matchedVariants.length,
                });

                const shouldShowVariants = normalizedQuickSearch
                    ? (productMatches ? variants : matchedVariants)
                    : (expandedGroups[product.id] ? variants : []);

                shouldShowVariants.forEach((variant) => {
                    rows.push({
                        ...variant,
                        row_kind: 'item',
                        row_id: `variant_${variant.id}`,
                        group_name: product.name,
                        parent_group_id: product.id,
                    });
                });
            } else if (matchesQuickSearch(product)) {
                rows.push({ ...product, row_kind: 'item', row_id: `item_${product.id}` });
            }
        });
        return rows;
    }, [expandedGroups, supplierCatalog, supplierQuickSearch]);

    const allSupplierItemIdSet = useMemo(
        () => new Set(supplierCatalogItemRows.map((row) => row.id)),
        [supplierCatalogItemRows]
    );
    const visibleSupplierItemIds = useMemo(
        () => supplierRows.filter((row) => row.row_kind === 'item').map((row) => row.id),
        [supplierRows]
    );
    const allVisibleSelected = visibleSupplierItemIds.length > 0 && visibleSupplierItemIds.every((id) => selectedPriceIds[id]);
    const someVisibleSelected = !allVisibleSelected && visibleSupplierItemIds.some((id) => selectedPriceIds[id]);

    useEffect(() => {
        const validItemIds = new Set(supplierCatalogItemRows.map((row) => String(row.id)));
        const validGroupIds = new Set(
            supplierCatalog.filter((product) => product.has_variants).map((product) => String(product.id))
        );
        const pruneStateMap = (prev, allowedIds) => {
            let changed = false;
            const next = Object.entries(prev).reduce((result, [key, value]) => {
                if (allowedIds.has(String(key))) {
                    result[key] = value;
                    return result;
                }
                changed = true;
                return result;
            }, {});

            return changed ? next : prev;
        };

        setSelectedPriceIds((prev) => pruneStateMap(prev, validItemIds));
        setPriceDrafts((prev) => pruneStateMap(prev, validItemIds));
        setSavingPriceIds((prev) => pruneStateMap(prev, validItemIds));
        setGroupPriceDrafts((prev) => pruneStateMap(prev, validGroupIds));
        setExpandedGroups((prev) => pruneStateMap(prev, validGroupIds));
    }, [supplierCatalog, supplierCatalogItemRows]);

    const selectedIds = useMemo(
        () => Object.entries(selectedPriceIds)
            .filter(([id, checked]) => checked && allSupplierItemIdSet.has(Number(id)))
            .map(([id]) => Number(id)),
        [allSupplierItemIdSet, selectedPriceIds]
    );
    const getVariantIdsByGroup = (groupId) => (supplierCatalog.find((item) => item.id === groupId)?.variants || []).map((variant) => variant.id);
    const getGroupSelectionState = (groupId) => {
        const ids = getVariantIdsByGroup(groupId);
        const checkedCount = ids.filter((id) => selectedPriceIds[id]).length;

        return {
            checked: ids.length > 0 && checkedCount === ids.length,
            indeterminate: checkedCount > 0 && checkedCount < ids.length,
        };
    };
    const setItemSelected = (itemId, checked) => {
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            if (checked) {
                next[itemId] = true;
            } else {
                delete next[itemId];
            }
            return next;
        });
    };
    const toggleAllVisibleSelections = (checked) => {
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            visibleSupplierItemIds.forEach((id) => {
                if (checked) {
                    next[id] = true;
                } else {
                    delete next[id];
                }
            });
            return next;
        });
    };
    const patchSupplierCatalogRow = (productId, updates) => {
        setSupplierCatalog((prev) => prev.map((product) => {
            if (product.id === productId) {
                return { ...product, ...updates };
            }
            if (Array.isArray(product.variants) && product.variants.length) {
                return {
                    ...product,
                    variants: product.variants.map((variant) => (
                        variant.id === productId ? { ...variant, ...updates } : variant
                    )),
                };
            }
            return product;
        }));
    };

    const markGroupSelected = (groupId, checked = true) => {
        const ids = getVariantIdsByGroup(groupId);
        if (!ids.length) return;
        setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            ids.forEach((id) => {
                if (checked) {
                    next[id] = true;
                } else {
                    delete next[id];
                }
            });
            return next;
        });
    };

    const supplierPriceColumns = useMemo(() => [
        {
            id: 'select',
            label: '',
            minWidth: 56,
            align: 'center',
            draggable: false,
            headerRender: () => (
                <IndeterminateCheckbox
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    disabled={visibleSupplierItemIds.length === 0}
                    onChange={(event) => toggleAllVisibleSelections(event.target.checked)}
                    title="Chọn tất cả dòng đang hiển thị"
                />
            ),
        },
        ...supplierPriceBaseColumns,
    ], [allVisibleSelected, someVisibleSelected, visibleSupplierItemIds]);

    const applyPriceToIds = async (ids, cleaned) => {
        if (!selectedSupplierId || !ids.length || !cleaned) return false;
        try {
            const numericValue = Number(cleaned);
            await inventoryApi.bulkSupplierPrices(selectedSupplierId, {
                items: supplierCatalogItemRows.filter((row) => ids.includes(row.id)).map((row) => ({
                    product_id: row.id,
                    unit_cost: numericValue,
                    notes: bulkNote || null,
                })),
            });
            setSupplierCatalog((prev) => prev.map((product) => ({
                ...product,
                supplier_unit_cost: ids.includes(product.id) ? numericValue : product.supplier_unit_cost,
                supplier_price_updated_at: ids.includes(product.id) ? new Date().toISOString() : product.supplier_price_updated_at,
                variants: Array.isArray(product.variants)
                    ? product.variants.map((variant) => ids.includes(variant.id) ? { ...variant, supplier_unit_cost: numericValue, supplier_price_updated_at: new Date().toISOString() } : variant)
                    : product.variants,
            })));
            setPriceDrafts((prev) => {
                const next = { ...prev };
                ids.forEach((id) => { next[id] = cleaned; });
                return next;
            });
            return true;
        } catch (error) {
            fail(error, 'Không thể áp giá hàng loạt.');
            return false;
        }
    };

    const applyBulkPrice = async () => {
        const cleaned = bulkPrice.replace(/[^0-9]/g, '');
        if (!selectedSupplierId || !selectedIds.length || !cleaned) return showToast({ type: 'warning', message: 'Hãy chọn dòng và nhập giá.' });
        const success = await applyPriceToIds(selectedIds, cleaned);
        if (success) {
            showToast({ type: 'success', message: 'Đã áp giá cho các dòng đã chọn.' });
        }
    };

    const applyGroupPrice = async (groupId) => {
        const cleaned = String(groupPriceDrafts[groupId] ?? bulkPrice).replace(/[^0-9]/g, '');
        const ids = getVariantIdsByGroup(groupId);
        if (!ids.length || !cleaned) return showToast({ type: 'warning', message: 'Hãy nhập giá hàng loạt trước.' });
        setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            ids.forEach((id) => { next[id] = true; });
            return next;
        });
        const success = await applyPriceToIds(ids, cleaned);
        if (success) {
            showToast({ type: 'success', message: 'Đã áp giá cho toàn bộ biến thể.' });
        }
    };

    const applyPaste = () => {
        const skuMap = new Map(supplierCatalogItemRows.map((row) => [String(row.sku || '').toUpperCase(), row]));
        const nextDrafts = {};
        const nextSelected = {};
        pasteText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
            const parts = line.split(/\t|,|;/).map((item) => item.trim()).filter(Boolean);
            if (parts.length < 2) return;
            const matched = skuMap.get(parts[0].toUpperCase());
            if (!matched) return;
            const cleaned = parts[1].replace(/[^0-9]/g, '');
            if (!cleaned) return;
            nextDrafts[matched.id] = cleaned;
            nextSelected[matched.id] = true;
        });
        setPriceDrafts((prev) => ({ ...prev, ...nextDrafts }));
        setSelectedPriceIds((prev) => ({ ...prev, ...nextSelected }));
    };

    const saveSingleSupplierPrice = async (row, explicitValue = null) => {
        const rawValue = explicitValue ?? priceDrafts[row.id] ?? row.supplier_unit_cost ?? '';
        const cleaned = String(rawValue).replace(/[^0-9]/g, '');
        if (!selectedSupplierId || row.row_kind === 'group' || cleaned === '') return;
        const numericValue = Number(cleaned);
        if (Number(row.supplier_unit_cost || 0) === numericValue && row.supplier_price_id) return;

        setSavingPriceIds((prev) => ({ ...prev, [row.id]: true }));
        try {
            const response = row.supplier_price_id
                ? await inventoryApi.updateSupplierPrice(selectedSupplierId, row.supplier_price_id, { unit_cost: numericValue, notes: null })
                : await inventoryApi.createSupplierPrice(selectedSupplierId, { product_id: row.id, unit_cost: numericValue, notes: null });

            const updatedAt = response.data?.updated_at || new Date().toISOString();
            const priceId = response.data?.id || row.supplier_price_id;

            patchSupplierCatalogRow(row.id, {
                supplier_unit_cost: numericValue,
                supplier_price_id: priceId,
                supplier_price_updated_at: updatedAt,
            });
            setPriceDrafts((prev) => ({ ...prev, [row.id]: String(numericValue) }));
        } catch (error) {
            fail(error, 'Không thể lưu giá dự kiến.');
        } finally {
            setSavingPriceIds((prev) => ({ ...prev, [row.id]: false }));
        }
    };

    const saveSupplierPrices = async () => {
        if (!selectedSupplierId || !selectedIds.length) return showToast({ type: 'warning', message: 'Hãy chọn ít nhất một dòng giá.' });
        setFlag('saving', true);
        try {
            await inventoryApi.bulkSupplierPrices(selectedSupplierId, {
                items: supplierCatalogItemRows.filter((row) => selectedIds.includes(row.id)).map((row) => ({
                    product_id: row.id,
                    unit_cost: Number(priceDrafts[row.id] ?? row.supplier_unit_cost ?? 0),
                    notes: bulkNote || null,
                })),
            });
            showToast({ type: 'success', message: 'Đã cập nhật bảng giá nhà cung cấp.' });
            fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
            fetchSuppliers(supplierPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể cập nhật bảng giá nhà cung cấp.');
        } finally {
            setFlag('saving', false);
        }
    };

    const removeProduct = async (id) => {
        if (!window.confirm('Chuyển sản phẩm này vào thùng rác?')) return;
        try {
            await productApi.destroy(id);
            showToast({ type: 'success', message: 'Đã chuyển sản phẩm vào thùng rác.' });
            fetchProducts(productPagination.current_page || 1);
            fetchTrash(trashPagination.current_page || 1);
            fetchOverview();
        } catch (error) {
            fail(error, 'Không thể xóa sản phẩm.');
        }
    };

    const restoreProduct = async (id) => {
        try {
            await productApi.restore(id);
            showToast({ type: 'success', message: 'Đã khôi phục sản phẩm.' });
            fetchTrash(trashPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
        } catch (error) {
            fail(error, 'Không thể khôi phục sản phẩm.');
        }
    };

    const forceDeleteProduct = async (id) => {
        if (!window.confirm('Xóa vĩnh viễn sản phẩm này?')) return;
        try {
            await productApi.forceDelete(id);
            showToast({ type: 'success', message: 'Đã xóa vĩnh viễn sản phẩm.' });
            fetchTrash(trashPagination.current_page || 1);
            fetchOverview();
        } catch (error) {
            fail(error, 'Không thể xóa vĩnh viễn sản phẩm.');
        }
    };

    const openCreateSupplier = async () => {
        await ensureSuppliersLoaded();
        setSupplierModal({ open: true, form: createSupplierForm() });
    };
    const openEditSupplier = (supplier) => setSupplierModal({ open: true, form: createSupplierForm(supplier) });

    const saveSupplier = async () => {
        const form = supplierModal.form;
        if (!form.name.trim()) return showToast({ type: 'warning', message: 'Vui lòng nhập tên nhà cung cấp.' });
        setFlag('supplierModal', true);
        try {
            const payload = { code: form.code || null, name: form.name.trim(), phone: form.phone || null, email: form.email || null, address: form.address || null, notes: form.notes || null, status: form.status ? 1 : 0 };
            let savedSupplierId = form.id;
            if (form.id) {
                const response = await inventoryApi.updateSupplier(form.id, payload);
                savedSupplierId = response.data?.id || form.id;
                showToast({ type: 'success', message: 'Đã cập nhật nhà cung cấp.' });
            } else {
                const response = await inventoryApi.createSupplier(payload);
                savedSupplierId = response.data?.id || null;
                showToast({ type: 'success', message: 'Đã tạo nhà cung cấp.' });
            }
            setSupplierModal({ open: false, form: createSupplierForm() });
            if (savedSupplierId) {
                setSelectedSupplierId(savedSupplierId);
                setSupplierDetailOpen((prev) => ({ ...prev, [savedSupplierId]: true }));
            }
            fetchSuppliers(supplierPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể lưu nhà cung cấp.');
        } finally {
            setFlag('supplierModal', false);
        }
    };

    const deleteSupplier = async (supplier) => {
        if (!window.confirm(`Xóa nhà cung cấp "${supplier.name}"?`)) return;
        try {
            await inventoryApi.deleteSupplier(supplier.id);
            showToast({ type: 'success', message: 'Đã xóa nhà cung cấp.' });
            fetchSuppliers(supplierPagination.current_page || 1);
            if (selectedSupplierId === supplier.id) setSelectedSupplierId(null);
        } catch (error) {
            fail(error, 'Không thể xóa nhà cung cấp.');
        }
    };

    const openCreateImport = async () => {
        await ensureSuppliersLoaded();
        setImportModal({ open: true, form: createImportForm({ supplier_id: selectedSupplierId || null }) });
    };

    const openEditImport = async (row) => {
        await ensureSuppliersLoaded();
        setFlag('importModal', true);
        try {
            const response = await inventoryApi.getImport(row.id);
            setImportModal({ open: true, form: createImportForm(response.data) });
        } catch (error) {
            fail(error, 'Không thể tải phiếu nhập để sửa.');
        } finally {
            setFlag('importModal', false);
        }
    };

    const saveImport = async () => {
        const form = importModal.form;
        if (!form.supplier_id) return showToast({ type: 'warning', message: 'Vui lòng chọn nhà cung cấp.' });
        const items = form.items.filter((item) => item.product_id).map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity || 0),
            unit_cost: Number(item.unit_cost || 0),
            notes: item.notes || null,
            update_supplier_price: Boolean(item.update_supplier_price),
        })).filter((item) => item.product_id && item.quantity > 0);
        if (!items.length) return showToast({ type: 'warning', message: 'Phiếu nhập cần ít nhất một dòng sản phẩm.' });

        setFlag('saving', true);
        try {
            const payload = { supplier_id: Number(form.supplier_id), import_date: form.import_date, notes: form.notes || null, update_supplier_prices: Boolean(form.update_supplier_prices), items };
            if (form.id) {
                await inventoryApi.updateImport(form.id, payload);
                showToast({ type: 'success', message: 'Đã cập nhật phiếu nhập.' });
            } else {
                await inventoryApi.createImport(payload);
                showToast({ type: 'success', message: 'Đã tạo phiếu nhập.' });
            }
            setImportModal({ open: false, form: createImportForm() });
            fetchImports(importPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
            fetchSuppliers(supplierPagination.current_page || 1);
            if (selectedSupplierId) fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể lưu phiếu nhập.');
        } finally {
            setFlag('saving', false);
        }
    };

    const deleteImport = async (row) => {
        if (!window.confirm(`Xóa phiếu nhập ${row.import_number}?`)) return;
        try {
            await inventoryApi.deleteImport(row.id);
            showToast({ type: 'success', message: 'Đã xóa phiếu nhập.' });
            fetchImports(importPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa phiếu nhập.');
        }
    };

    const openCreateDocument = async (tabKey) => {
        await ensureSuppliersLoaded();
        setDocumentModal({ open: true, tabKey, form: createDocumentForm(tabKey) });
    };

    const openEditDocument = async (tabKey, row) => {
        await ensureSuppliersLoaded();
        setFlag('documentModal', true);
        try {
            const response = await inventoryApi.getDocument(documentTypeMap[tabKey], row.id);
            setDocumentModal({ open: true, tabKey, form: createDocumentForm(tabKey, response.data) });
        } catch (error) {
            fail(error, 'Không thể tải phiếu để sửa.');
        } finally {
            setFlag('documentModal', false);
        }
    };

    const saveDocument = async () => {
        const { tabKey, form } = documentModal;
        const type = documentTypeMap[tabKey];
        const items = form.items.filter((item) => item.product_id).map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity || 0),
            notes: item.notes || null,
            unit_cost: item.unit_cost !== '' ? Number(item.unit_cost || 0) : null,
            stock_bucket: item.stock_bucket,
            direction: item.direction,
        })).filter((item) => item.product_id && item.quantity > 0);
        if (!items.length) return showToast({ type: 'warning', message: 'Phiếu kho cần ít nhất một dòng sản phẩm.' });

        setFlag('saving', true);
        try {
            const payload = {
                document_date: form.document_date,
                supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
                notes: form.notes || null,
                items: items.map((item) => {
                    const base = { product_id: item.product_id, quantity: item.quantity, notes: item.notes };
                    if (type === 'return') base.unit_cost = item.unit_cost ?? 0;
                    if (type === 'adjustment') {
                        base.stock_bucket = item.stock_bucket;
                        base.direction = item.direction;
                        if (item.unit_cost != null) base.unit_cost = item.unit_cost;
                    }
                    return base;
                }),
            };
            if (form.id) {
                await inventoryApi.updateDocument(type, form.id, payload);
                showToast({ type: 'success', message: 'Đã cập nhật phiếu kho.' });
            } else {
                await inventoryApi.createDocument(type, payload);
                showToast({ type: 'success', message: 'Đã tạo phiếu kho.' });
            }
            setDocumentModal({ open: false, tabKey, form: createDocumentForm(tabKey) });
            if (type === 'return') fetchDocuments('return', returnPagination.current_page || 1);
            if (type === 'damaged') fetchDocuments('damaged', damagedPagination.current_page || 1);
            if (type === 'adjustment') fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể lưu phiếu kho.');
        } finally {
            setFlag('saving', false);
        }
    };

    const deleteDocument = async (tabKey, row) => {
        if (!window.confirm(`Xóa ${documentTitleMap[tabKey].toLowerCase()} ${row.document_number}?`)) return;
        try {
            await inventoryApi.deleteDocument(documentTypeMap[tabKey], row.id);
            showToast({ type: 'success', message: 'Đã xóa phiếu kho.' });
            if (tabKey === 'returns') fetchDocuments('return', returnPagination.current_page || 1);
            if (tabKey === 'damaged') fetchDocuments('damaged', damagedPagination.current_page || 1);
            if (tabKey === 'adjustments') fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa phiếu kho.');
        }
    };

    const deleteExport = async (row) => {
        if (!window.confirm(`Xóa đơn ${row.order_number}?`)) return;
        try {
            await orderApi.destroy(row.id);
            showToast({ type: 'success', message: 'Đã xóa phiếu xuất bán.' });
            fetchExports(exportPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa phiếu xuất bán.');
        }
    };

    const overviewItems = useMemo(() => {
        const summary = dashboard?.summary;
        if (!summary) return [];
        return [
            { label: 'Sản phẩm đang bán', value: formatNumber(summary.active_products) },
            { label: 'Tồn bán được', value: formatNumber(summary.total_units) },
            { label: 'Tồn hỏng', value: formatNumber(summary.damaged_units) },
            { label: 'Giá trị tồn', value: formatCurrency(summary.stock_value) },
            { label: 'Nhà cung cấp', value: formatNumber(summary.supplier_count) },
            { label: 'Nhập 30 ngày', value: formatCurrency(summary.imports_total) },
            { label: 'Trả hàng 30 ngày', value: formatCurrency(summary.returns_total) },
            { label: 'Hỏng 30 ngày', value: formatCurrency(summary.damaged_total) },
            { label: 'Lãi gộp 30 ngày', value: formatCurrency(summary.exports_profit) },
        ];
    }, [dashboard]);

    const productSummaryItems = useMemo(() => !productSummary ? [] : [
        { label: 'Tổng mã', value: formatNumber(productSummary.total_products) },
        { label: 'Tổng nhập', value: formatNumber(productSummary.total_imported) },
        { label: 'Tổng xuất bán', value: formatNumber(productSummary.total_exported) },
        { label: 'Tổng hoàn', value: formatNumber(productSummary.total_returned) },
        { label: 'Tổng hỏng', value: formatNumber(productSummary.total_damaged) },
        { label: 'Tồn bán được', value: formatNumber(productSummary.total_sellable_stock) },
        { label: 'Tồn hỏng', value: formatNumber(productSummary.total_damaged_stock) },
        { label: 'Tổng giá trị tồn', value: formatCurrency(productSummary.total_inventory_value) },
    ], [productSummary]);

    const supplierSummaryItems = useMemo(() => !supplierSummary ? [] : [
        { label: 'Tổng nhà cung cấp', value: formatNumber(supplierSummary.total_suppliers) },
        { label: 'Tổng phiếu nhập', value: formatNumber(supplierSummary.total_import_slips) },
        { label: 'Tổng số lượng nhập', value: formatNumber(supplierSummary.total_imported_quantity) },
        { label: 'Tổng tiền nhập', value: formatCurrency(supplierSummary.total_imported_amount) },
    ], [supplierSummary]);

    const supplierPriceSummaryItems = useMemo(() => {
        return [
            { label: 'Nhà cung cấp', value: currentSupplier?.name || 'Chưa chọn' },
            { label: 'Dòng đã chọn', value: formatNumber(selectedIds.length) },
            { label: 'Dòng đang hiển thị', value: formatNumber(visibleSupplierItemIds.length) },
            { label: 'Dòng đã nhập giá', value: formatNumber(Object.keys(priceDrafts).length) },
        ];
    }, [currentSupplier?.name, priceDrafts, selectedIds.length, visibleSupplierItemIds.length]);

    const supplierPriceSummaryCards = useMemo(() => {
        const itemRows = supplierRows.filter((row) => row.row_kind === 'item');
        const pricedRows = itemRows.filter((row) => Number(priceDrafts[row.id] ?? row.supplier_unit_cost ?? 0) > 0);
        return [
            { label: 'Nhà cung cấp', value: currentSupplier?.name || 'Chưa chọn' },
            { label: 'Mã đang hiển thị', value: formatNumber(itemRows.length) },
            { label: 'Đã có giá dự kiến', value: formatNumber(pricedRows.length) },
            { label: 'Chưa có giá', value: formatNumber(Math.max(itemRows.length - pricedRows.length, 0)) },
            { label: 'Đang chọn sửa nhanh', value: formatNumber(selectedIds.length) },
            { label: 'Tổng tiền nhập', value: formatCurrency(currentSupplier?.imported_amount_total || 0) },
        ];
    }, [currentSupplier?.imported_amount_total, currentSupplier?.name, priceDrafts, selectedIds.length, supplierRows]);

    const simpleSummaryMap = useMemo(() => ({
        imports: [
            { label: 'Tổng phiếu', value: formatNumber(importPagination.total) },
            { label: 'Số lượng trang', value: formatNumber(imports.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            { label: 'Tiền trang', value: formatCurrency(imports.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
        ],
        exports: [
            { label: 'Tổng đơn', value: formatNumber(exportPagination.total) },
            { label: 'Doanh thu trang', value: formatCurrency(exportsData.reduce((sum, row) => sum + Number(row.total_price || 0), 0)) },
            { label: 'Giá vốn trang', value: formatCurrency(exportsData.reduce((sum, row) => sum + Number(row.cost_total || 0), 0)) },
            { label: 'Lãi gộp trang', value: formatCurrency(exportsData.reduce((sum, row) => sum + Number(row.profit_total || 0), 0)) },
        ],
        returns: [
            { label: 'Tổng phiếu', value: formatNumber(returnPagination.total) },
            { label: 'Số lượng trang', value: formatNumber(returnsData.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            { label: 'Giá trị trang', value: formatCurrency(returnsData.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
        ],
        damaged: [
            { label: 'Tổng phiếu', value: formatNumber(damagedPagination.total) },
            { label: 'Số lượng trang', value: formatNumber(damagedData.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            { label: 'Giá trị trang', value: formatCurrency(damagedData.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
        ],
        adjustments: [
            { label: 'Tổng phiếu', value: formatNumber(adjustmentPagination.total) },
            { label: 'Số lượng trang', value: formatNumber(adjustments.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            { label: 'Giá trị trang', value: formatCurrency(adjustments.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
        ],
        lots: [
            { label: 'Tổng lô', value: formatNumber(lotPagination.total) },
            { label: 'Tổng số lượng', value: formatNumber(lots.reduce((sum, row) => sum + Number(row.quantity || 0), 0)) },
            { label: 'Còn lại', value: formatNumber(lots.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0)) },
        ],
        trash: [
            { label: 'Tổng sản phẩm', value: formatNumber(trashPagination.total) },
            { label: 'Trang hiện tại', value: formatNumber(trashItems.length) },
        ],
    }), [adjustmentPagination.total, adjustments, damagedData, damagedPagination.total, exportPagination.total, exportsData, importPagination.total, imports, lotPagination.total, lots, returnPagination.total, returnsData, trashItems.length, trashPagination.total]);

    const productCell = (row, columnId) => {
        if (columnId === 'sku') return <CellText primary={row.sku} secondary={row.is_variant && row.parent_name ? `Thuộc: ${row.parent_name}` : null} mono />;
        if (columnId === 'name') return <CellText primary={row.name} secondary={row.category_name || 'Chưa phân loại'} />;
        if (columnId === 'expected_cost') return row.expected_cost != null ? formatCurrency(row.expected_cost) : '-';
        if (columnId === 'current_cost') return row.current_cost != null ? formatCurrency(row.current_cost) : '-';
        if (columnId === 'inventory_value') return formatCurrency(row.inventory_value);
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => navigate(`/admin/products/edit/${row.id}`)} className={ghostButton}>Sửa</button><button type="button" onClick={() => removeProduct(row.id)} className={dangerButton}>Xóa</button></div>;
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const supplierCell = (row, columnId) => {
        if (columnId === 'name') return <button type="button" onClick={() => setSelectedSupplierId(row.id)} className={`w-full text-left ${selectedSupplierId === row.id ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}><CellText primary={row.name} secondary={row.email || row.phone || 'Chưa có liên hệ'} /></button>;
        if (columnId === 'imported_amount_total') return formatCurrency(row.imported_amount_total || 0);
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditSupplier(row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteSupplier(row)} className={dangerButton}>Xóa</button></div>;
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const supplierPriceCell = (row, columnId) => {
        if (row.row_kind === 'group') {
            const groupSelection = getGroupSelectionState(row.id);
            if (columnId === 'select') {
                return (
                    <IndeterminateCheckbox
                        checked={groupSelection.checked}
                        indeterminate={groupSelection.indeterminate}
                        onChange={(event) => markGroupSelected(row.id, event.target.checked)}
                        title="Chọn toàn bộ biến thể của nhóm"
                    />
                );
            }
            if (columnId === 'sku') return <button type="button" onClick={() => setExpandedGroups((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="inline-flex min-w-0 items-center gap-1 font-black text-primary"><span className="material-symbols-outlined text-[18px]">{expandedGroups[row.id] ? 'expand_more' : 'chevron_right'}</span><span className="truncate">{row.sku}</span></button>;
            if (columnId === 'name') return <CellText primary={row.name} secondary={supplierQuickSearch.trim() ? `${formatNumber(row.visible_variant_count || 0)} / ${formatNumber(row.variant_count || 0)} biến thể khớp` : `${formatNumber(row.variant_count || 0)} biến thể`} />;
            if (columnId === 'price') return row.price != null ? formatCurrency(row.price) : '-';
            if (columnId === 'supplier_unit_cost') {
                return (
                    <div className="flex items-center gap-2">
                        <input
                            value={groupPriceDrafts[row.id] ?? ''}
                            onChange={(event) => setGroupPriceDrafts((prev) => ({ ...prev, [row.id]: event.target.value.replace(/[^0-9]/g, '') }))}
                            placeholder="Giá nhóm"
                            className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                        />
                        <button type="button" onClick={() => applyGroupPrice(row.id)} className={ghostButton}>Áp nhóm</button>
                    </div>
                );
            }
            if (columnId === 'current_cost') return row.current_cost != null ? formatCurrency(row.current_cost) : '-';
            if (columnId === 'supplier_price_updated_at') return '-';
            return '-';
        }
        if (columnId === 'select') {
            return (
                <input
                    type="checkbox"
                    checked={Boolean(selectedPriceIds[row.id])}
                    onChange={(event) => setItemSelected(row.id, event.target.checked)}
                    className={checkboxClass}
                    title="Chọn dòng giá dự kiến"
                />
            );
        }
        if (columnId === 'sku') return <CellText primary={row.sku} secondary={row.group_name || row.parent_name || null} mono />;
        if (columnId === 'name') return <CellText primary={row.name} />;
        if (columnId === 'price') return row.price != null ? formatCurrency(row.price) : '-';
        if (columnId === 'current_cost') return row.current_cost != null ? formatCurrency(row.current_cost) : '-';
        if (columnId === 'supplier_unit_cost') return (
            <div className="flex items-center gap-2">
                <input
                    value={priceDrafts[row.id] ?? (row.supplier_unit_cost ?? '')}
                    onChange={(event) => setPriceDrafts((prev) => ({ ...prev, [row.id]: event.target.value.replace(/[^0-9]/g, '') }))}
                    onBlur={() => saveSingleSupplierPrice(row)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            saveSingleSupplierPrice(row, event.currentTarget.value);
                        }
                    }}
                    className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                />
                {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Đang lưu...</span> : null}
            </div>
        );
        if (columnId === 'supplier_price_updated_at') return row.supplier_price_updated_at ? formatDateTime(row.supplier_price_updated_at) : '-';
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const renderImportCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.import_number} mono />;
        if (columnId === 'supplier') return <CellText primary={row.supplier?.name || row.supplier_name || '-'} />;
        if (columnId === 'date') return formatDateTime(row.import_date);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditImport(row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteImport(row)} className={dangerButton}>Xóa</button></div>;
        return '-';
    };

    const renderExportCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.order_number} mono />;
        if (columnId === 'customer') return <CellText primary={row.customer_name || '-'} secondary={row.customer_phone || row.source || '-'} />;
        if (columnId === 'date') return formatDateTime(row.created_at);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'revenue') return formatCurrency(row.total_price || 0);
        if (columnId === 'cost') return formatCurrency(row.cost_total || 0);
        if (columnId === 'profit') return <span className="font-black text-emerald-600">{formatCurrency(row.profit_total || 0)}</span>;
        if (columnId === 'status') return row.status || '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => navigate(`/admin/orders/edit/${row.id}`)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteExport(row)} className={dangerButton}>Xóa</button></div>;
        return '-';
    };

    const renderDocumentCell = (row, columnId, tabKey) => {
        if (columnId === 'code') return <CellText primary={row.document_number} mono />;
        if (columnId === 'supplier') return <CellText primary={row.supplier?.name || '-'} />;
        if (columnId === 'date') return formatDateTime(row.document_date);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditDocument(tabKey, row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteDocument(tabKey, row)} className={dangerButton}>Xóa</button></div>;
        return '-';
    };

    const renderLotCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.batch_number} mono />;
        if (columnId === 'product') return <CellText primary={row.product?.name || '-'} secondary={row.product?.sku || '-'} />;
        if (columnId === 'date') return formatDateTime(row.received_at);
        if (columnId === 'qty') return formatNumber(row.quantity || 0);
        if (columnId === 'remaining') return formatNumber(row.remaining_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.unit_cost || 0);
        if (columnId === 'source') return row.source_label || row.source_name || row.meta?.source_name || '-';
        return '-';
    };

    const renderTrashCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.sku} mono />;
        if (columnId === 'product') return <CellText primary={row.name} />;
        if (columnId === 'date') return formatDateTime(row.deleted_at);
        if (columnId === 'price_status') return row.price_status || '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => restoreProduct(row.id)} className={ghostButton}>Khôi phục</button><button type="button" onClick={() => forceDeleteProduct(row.id)} className={dangerButton}>Xóa hẳn</button></div>;
        return '-';
    };

    const tabRows = { imports, exports: exportsData, returns: returnsData, damaged: damagedData, adjustments, lots, trash: trashItems };
    const tabPagination = { imports: importPagination, exports: exportPagination, returns: returnPagination, damaged: damagedPagination, adjustments: adjustmentPagination, lots: lotPagination, trash: trashPagination };
    const tabLoading = { imports: loading.imports, exports: loading.exports, returns: loading.returns, damaged: loading.damaged, adjustments: loading.adjustments, lots: loading.lots, trash: loading.trash };
    const tabFetch = { imports: fetchImports, exports: fetchExports, returns: (page) => fetchDocuments('return', page), damaged: (page) => fetchDocuments('damaged', page), adjustments: (page) => fetchDocuments('adjustment', page), lots: fetchLots, trash: fetchTrash };

    const renderSimpleTab = (tabKey) => {
        const filters = simpleFilters[tabKey];
        const columns = tabKey === 'imports' ? importColumns : tabKey === 'exports' ? exportColumns : tabKey === 'lots' ? lotColumns : tabKey === 'trash' ? trashColumns : documentColumns;
        const renderCell = tabKey === 'imports' ? renderImportCell : tabKey === 'exports' ? renderExportCell : tabKey === 'lots' ? renderLotCell : tabKey === 'trash' ? renderTrashCell : (row, columnId) => renderDocumentCell(row, columnId, tabKey);
        const extraActions = <>{tabKey === 'imports' ? <button type="button" onClick={openCreateImport} className={primaryButton}>Tạo phiếu</button> : null}{tabKey === 'exports' ? <button type="button" onClick={() => navigate('/admin/orders/new')} className={primaryButton}>Tạo phiếu</button> : null}{['returns', 'damaged', 'adjustments'].includes(tabKey) ? <button type="button" onClick={() => openCreateDocument(tabKey)} className={primaryButton}>Tạo phiếu</button> : null}</>;

        return (
            <div className="space-y-3">
                <div className={panelClass}>
                    <PanelHeader
                        title={tabKey === 'imports' ? 'Danh sách phiếu nhập' : tabKey === 'exports' ? 'Danh sách phiếu xuất bán' : tabKey === 'lots' ? 'Danh sách lô hàng' : tabKey === 'trash' ? 'Thùng rác sản phẩm' : documentTitleMap[tabKey]}
                        toggles={[
                            { id: `${tabKey}_filters`, icon: 'filter_alt', label: 'Bộ lọc', active: openPanels[tabKey].filters, onClick: () => togglePanel(tabKey, 'filters') },
                            { id: `${tabKey}_stats`, icon: 'monitoring', label: 'Thống kê', active: openPanels[tabKey].stats, onClick: () => togglePanel(tabKey, 'stats') },
                            { id: `${tabKey}_columns`, icon: 'view_column', label: 'Cài đặt cột', active: openPanels[tabKey].columns, onClick: () => togglePanel(tabKey, 'columns') },
                        ]}
                        actions={extraActions}
                    />
                    {openPanels[tabKey].filters ? <FilterPanel actions={<button type="button" onClick={() => tabFetch[tabKey](1)} className={primaryButton}>Lọc</button>}><input value={filters.search} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], search: event.target.value } }))} placeholder="Tìm nhanh" className={`w-[240px] ${inputClass}`} /><input type="date" value={filters.date_from} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], date_from: event.target.value } }))} className={`w-[145px] ${inputClass}`} /><input type="date" value={filters.date_to} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], date_to: event.target.value } }))} className={`w-[145px] ${inputClass}`} /></FilterPanel> : null}
                    {openPanels[tabKey].stats ? <SummaryPanel items={simpleSummaryMap[tabKey] || []} /> : null}
                    <InventoryTable storageKey={`inventory_${tabKey}_table`} columns={columns} rows={tabRows[tabKey]} renderCell={renderCell} loading={tabLoading[tabKey]} pagination={tabPagination[tabKey]} onPageChange={tabFetch[tabKey]} footer={`Kết quả: ${formatNumber(tabPagination[tabKey].total)}`} settingsOpen={openPanels[tabKey].columns} onCloseSettings={() => togglePanel(tabKey, 'columns')} currentPerPage={pageSizes[tabKey]} onPerPageChange={(value) => {
                        const nextSize = updatePageSize(tabKey, value);
                        if (tabKey === 'returns') return fetchDocuments('return', 1, nextSize);
                        if (tabKey === 'damaged') return fetchDocuments('damaged', 1, nextSize);
                        if (tabKey === 'adjustments') return fetchDocuments('adjustment', 1, nextSize);
                        return tabFetch[tabKey](1, nextSize);
                    }} />
                </div>
            </div>
        );
    };

    const importLineTotal = useMemo(() => importModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0), [importModal.form.items]);
    const documentLineTotal = useMemo(() => documentModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0), [documentModal.form.items]);

    return (
        <div className="space-y-4 px-5 pb-6 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[16px] font-black uppercase tracking-[0.18em] text-primary">Quản lý kho</div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => navigate('/admin/products/new')} className={primaryButton}><span className="material-symbols-outlined text-[18px]">add</span>Tạo sản phẩm</button>
                    <button type="button" onClick={openCreateImport} className={ghostButton}><span className="material-symbols-outlined text-[18px]">inventory_2</span>Tạo phiếu nhập</button>
                    <button type="button" onClick={() => navigate('/admin/orders/new')} className={ghostButton}><span className="material-symbols-outlined text-[18px]">shopping_cart</span>Tạo phiếu xuất</button>
                </div>
            </div>
            <div className={`${panelClass} p-2`}><div className="flex flex-nowrap gap-2 overflow-x-auto">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 shrink-0 rounded-sm border px-4 text-[12px] font-black transition ${activeTab === key ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary/35 hover:bg-primary/[0.03]'}`}>{label}</button>)}</div></div>
            {activeTab === 'overview' ? <div className={panelClass}><PanelHeader title="Tổng quan kho" toggles={[{ id: 'overview_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.overview.stats, onClick: () => togglePanel('overview', 'stats') }]} />{openPanels.overview.stats ? <SummaryPanel items={overviewItems} /> : null}</div> : null}
            {activeTab === 'products' ? <div className={panelClass}><PanelHeader title="Sản phẩm kho" toggles={[{ id: 'products_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.products.filters, onClick: () => togglePanel('products', 'filters') }, { id: 'products_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.products.stats, onClick: () => togglePanel('products', 'stats') }, { id: 'products_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.products.columns, onClick: () => togglePanel('products', 'columns') }]} actions={<button type="button" onClick={() => navigate('/admin/products/new')} className={primaryButton}>Tạo sản phẩm</button>} />{openPanels.products.filters ? <FilterPanel actions={<button type="button" onClick={() => fetchProducts(1)} className={primaryButton}>Lọc</button>}><input value={productFilters.search} onChange={(event) => setProductFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Tìm mã hoặc tên" className={`w-[220px] ${inputClass}`} /><select value={productFilters.status} onChange={(event) => setProductFilters((prev) => ({ ...prev, status: event.target.value }))} className={`w-[150px] ${selectClass}`}><option value="">Tất cả trạng thái bán</option><option value="active">Đang bán</option><option value="inactive">Ngừng bán</option></select><select value={productFilters.cost_source} onChange={(event) => setProductFilters((prev) => ({ ...prev, cost_source: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Tất cả trạng thái giá</option><option value="actual">Đang dùng giá vốn</option><option value="expected">Đang dùng giá dự kiến</option><option value="empty">Chưa có giá</option></select><select value={productFilters.type} onChange={(event) => setProductFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option><option value="simple">Sản phẩm thường</option><option value="configurable">Sản phẩm có biến thể</option></select><select value={productFilters.category_id} onChange={(event) => setProductFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={productFilters.variant_scope} onChange={(event) => setProductFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">Có biến thể / không</option><option value="has_variants">Có biến thể</option><option value="no_variants">Không có biến thể</option><option value="only_variants">Chỉ biến thể con</option><option value="roots">Chỉ sản phẩm gốc</option></select><input type="date" value={productFilters.date_from} onChange={(event) => setProductFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={`w-[145px] ${inputClass}`} /><input type="date" value={productFilters.date_to} onChange={(event) => setProductFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={`w-[145px] ${inputClass}`} /></FilterPanel> : null}{openPanels.products.stats ? <SummaryPanel items={productSummaryItems} /> : null}<InventoryTable storageKey="inventory_products_table" columns={productColumns} rows={products} renderCell={productCell} loading={loading.products} pagination={productPagination} onPageChange={fetchProducts} footer={`Kết quả: ${formatNumber(productPagination.total)} mã`} settingsOpen={openPanels.products.columns} onCloseSettings={() => togglePanel('products', 'columns')} currentPerPage={pageSizes.products} onPerPageChange={(value) => fetchProducts(1, updatePageSize('products', value))} /></div> : null}
            {activeTab === 'suppliers' ? (
                <div className="grid items-start gap-3 xl:grid-cols-[300px,minmax(0,1fr)]">
                    <div className={`${panelClass} self-start`}>
                        <div className="border-b border-primary/10 px-3 py-2.5">
                            <input value={supplierFilters.search} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Tìm nhà cung cấp" className={`w-full ${inputClass}`} />
                        </div>
                        <div className="max-h-[280px] overflow-auto">
                            {loading.suppliers ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tải nhà cung cấp...</div> : null}
                            {!loading.suppliers && suppliers.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không có nhà cung cấp.</div> : null}
                            {!loading.suppliers && suppliers.map((supplier) => {
                                const isSelected = selectedSupplierId === supplier.id;
                                const isOpen = Boolean(supplierDetailOpen[supplier.id]);

                                return (
                                    <div key={supplier.id} className="border-b border-primary/10 last:border-b-0">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedSupplierId(supplier.id);
                                                setSupplierDetailOpen((prev) => ({ ...prev, [supplier.id]: !prev[supplier.id] }));
                                            }}
                                            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition ${isSelected ? 'bg-primary/[0.05]' : 'hover:bg-primary/[0.02]'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[18px] transition ${isOpen ? 'rotate-0 text-primary' : 'text-primary/45'}`}>{isOpen ? 'expand_more' : 'chevron_right'}</span>
                                            <span className={`min-w-0 flex-1 truncate text-[13px] ${isSelected ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}>{supplier.name}</span>
                                            {isSelected ? <span className="rounded-full bg-primary/[0.08] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">Đang chọn</span> : null}
                                        </button>
                                        {isOpen ? (
                                            <div className="space-y-3 border-t border-primary/10 bg-[#fbfcfe] px-3 py-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-[13px] font-black text-primary">{supplier.name}</div>
                                                        <div className="text-[11px] text-primary/45">{supplier.code || 'Chưa có mã nhà cung cấp'}</div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button type="button" onClick={() => openEditSupplier(supplier)} className={ghostButton}>Sửa</button>
                                                        <button type="button" onClick={() => deleteSupplier(supplier)} className={dangerButton}>Xóa</button>
                                                    </div>
                                                </div>
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Điện thoại</div>
                                                        <div className="mt-1 font-semibold text-primary">{supplier.phone || 'Chưa có số điện thoại'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Email</div>
                                                        <div className="mt-1 break-all font-semibold text-primary">{supplier.email || 'Chưa có email'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70 sm:col-span-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Địa chỉ</div>
                                                        <div className="mt-1 font-semibold text-primary">{supplier.address || 'Chưa có địa chỉ'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70 sm:col-span-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chú</div>
                                                        <div className="mt-1 leading-relaxed text-primary/70">{supplier.notes || 'Chưa có ghi chú'}</div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Bảng giá</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.prices_count || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Phiếu nhập</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.import_slips_count || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Số lượng nhập</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.imported_quantity_total || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Tiền nhập</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatCurrency(supplier.imported_amount_total || 0)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 px-3 py-3">
                            <label className="inline-flex items-center gap-2 text-[12px] text-primary/55">
                                <span>Hiển thị</span>
                                <select value={pageSizes.suppliers} onChange={(event) => fetchSuppliers(1, updatePageSize('suppliers', Number(event.target.value)))} className="h-8 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-semibold text-primary outline-none focus:border-primary">
                                    {pageSizeOptions.map((size) => <option key={size} value={size}>{size} dòng</option>)}
                                </select>
                            </label>
                            <Pagination pagination={supplierPagination} onPageChange={fetchSuppliers} />
                        </div>
                    </div>

                    <div className={panelClass}>
                        <PanelHeader
                            title={currentSupplier ? `Bảng giá dự kiến - ${currentSupplier.name}` : 'Bảng giá dự kiến'}
                            actions={
                                <>
                                    <button type="button" onClick={openCreateSupplier} className={primaryButton}><span className="material-symbols-outlined text-[18px]">add</span>Thêm mới</button>
                                    <div className="relative w-[220px] min-w-[220px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                        <input
                                            value={supplierQuickSearch}
                                            onChange={(event) => setSupplierQuickSearch(event.target.value)}
                                            placeholder="Tìm mã / tên sản phẩm"
                                            disabled={!selectedSupplierId}
                                            className={`w-full pl-9 ${inputClass}`}
                                        />
                                    </div>
                                    <input value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value.replace(/[^0-9]/g, ''))} placeholder="Giá áp chọn" disabled={!selectedSupplierId} className={`w-[125px] ${inputClass}`} />
                                    <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!selectedSupplierId} className={ghostButton}>{showPasteBox ? 'Ẩn dán nhanh' : 'Dán nhanh'}</button>
                                    <button type="button" onClick={applyBulkPrice} disabled={!selectedSupplierId || !selectedIds.length} className={ghostButton}>Áp giá chọn</button>
                                    {[
                                        { id: 'supplierPrices_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.supplierPrices.filters, onClick: () => togglePanel('supplierPrices', 'filters') },
                                        { id: 'supplierPrices_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.supplierPrices.stats, onClick: () => togglePanel('supplierPrices', 'stats') },
                                        { id: 'supplierPrices_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.supplierPrices.columns, onClick: () => togglePanel('supplierPrices', 'columns') },
                                    ].map((toggle) => (
                                        <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                                            <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                                        </button>
                                    ))}
                                </>
                            }
                        />
                        {openPanels.supplierPrices.filters ? (
                            <FilterPanel actions={<button type="button" onClick={() => fetchSupplierCatalog(1)} className={primaryButton}>Lọc</button>}>
                                <input value={supplierCatalogFilters.sku} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, sku: event.target.value }))} placeholder="Lọc theo mã sản phẩm" className={`w-[170px] ${inputClass}`} />
                                <input value={supplierCatalogFilters.name} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, name: event.target.value }))} placeholder="Lọc theo tên sản phẩm" className={`w-[180px] ${inputClass}`} />
                                <select value={supplierCatalogFilters.category_id} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                                <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option><option value="simple">Sản phẩm thường</option><option value="configurable">Sản phẩm có biến thể</option></select>
                                <select value={supplierCatalogFilters.variant_scope} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Sản phẩm thường / biến thể</option><option value="no_variants">Sản phẩm thường</option><option value="only_variants">Biến thể</option><option value="has_variants">Nhóm có biến thể</option><option value="roots">Nhóm gốc</option></select>
                            </FilterPanel>
                        ) : null}
                        {openPanels.supplierPrices.stats ? <SummaryPanel items={supplierPriceSummaryCards} /> : null}
                        {showPasteBox ? <div className="border-b border-primary/10 px-3 py-2.5"><div className="mb-2 text-[12px] text-primary/55">Dán theo mẫu: `SKU TAB Giá` hoặc `SKU,Giá`</div><div className="flex gap-3"><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} className="min-h-[88px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" placeholder={'SKU-01\t120000\nSKU-02\t150000'} /><button type="button" onClick={applyPaste} className={primaryButton}>Nhận giá</button></div></div> : null}
                        <InventoryTable storageKey="inventory_supplier_prices_table_v2" columns={supplierPriceColumns} rows={supplierRows} renderCell={supplierPriceCell} loading={loading.supplierCatalog} pagination={supplierCatalogPagination} onPageChange={fetchSupplierCatalog} footer={`Hiển thị ${formatNumber(visibleSupplierItemIds.length)} / ${formatNumber(supplierCatalogPagination.total)} sản phẩm`} rowKey="row_id" rowClassName={(row) => row.row_kind === 'group' ? 'bg-[#f9fafb]' : (selectedPriceIds[row.id] ? 'bg-primary/[0.04]' : 'hover:bg-primary/[0.02]')} settingsOpen={openPanels.supplierPrices.columns} onCloseSettings={() => togglePanel('supplierPrices', 'columns')} currentPerPage={pageSizes.supplierPrices} onPerPageChange={(value) => fetchSupplierCatalog(1, updatePageSize('supplierPrices', value))} />
                    </div>
                </div>
            ) : null}
            {['imports', 'exports', 'returns', 'damaged', 'adjustments', 'lots', 'trash'].includes(activeTab) ? renderSimpleTab(activeTab) : null}
            <ModalShell open={supplierModal.open} title={supplierModal.form.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={() => setSupplierModal({ open: false, form: createSupplierForm() })} maxWidth="max-w-3xl" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setSupplierModal({ open: false, form: createSupplierForm() })} className={ghostButton}>Hủy</button><button type="button" onClick={saveSupplier} className={primaryButton} disabled={loading.supplierModal}>{loading.supplierModal ? 'Đang lưu' : 'Lưu nhà cung cấp'}</button></div>}><div className="grid gap-3 md:grid-cols-2"><input value={supplierModal.form.code} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, code: event.target.value } }))} placeholder="Mã nhà cung cấp" className={inputClass} /><input value={supplierModal.form.name} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} placeholder="Tên nhà cung cấp" className={inputClass} /><input value={supplierModal.form.phone} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, phone: event.target.value } }))} placeholder="Số điện thoại" className={inputClass} /><input value={supplierModal.form.email} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, email: event.target.value } }))} placeholder="Email" className={inputClass} /><input value={supplierModal.form.address} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, address: event.target.value } }))} placeholder="Địa chỉ" className={`md:col-span-2 ${inputClass}`} /><textarea value={supplierModal.form.notes} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú" className="min-h-[120px] rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary md:col-span-2" /><label className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary"><input type="checkbox" checked={supplierModal.form.status} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.checked } }))} className="size-4 accent-primary" />Đang sử dụng</label></div></ModalShell>
            <ModalShell open={importModal.open} title={importModal.form.id ? 'Sửa phiếu nhập' : 'Tạo phiếu nhập'} onClose={() => setImportModal({ open: false, form: createImportForm() })} footer={<div className="flex items-center justify-between gap-3"><div className="text-[13px] font-black text-primary">Tổng phiếu: {formatCurrency(importLineTotal)}</div><div className="flex gap-2"><button type="button" onClick={() => setImportModal({ open: false, form: createImportForm() })} className={ghostButton}>Hủy</button><button type="button" onClick={saveImport} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Đang lưu' : 'Lưu phiếu nhập'}</button></div></div>}><div className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><select value={importModal.form.supplier_id} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, supplier_id: event.target.value } }))} className={selectClass}><option value="">Chọn nhà cung cấp</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><input type="date" value={importModal.form.import_date} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, import_date: event.target.value } }))} className={inputClass} /><label className="inline-flex h-8 items-center gap-2 rounded-sm border border-primary/15 px-3 text-[13px] font-semibold text-primary"><input type="checkbox" checked={importModal.form.update_supplier_prices} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, update_supplier_prices: event.target.checked } }))} className="size-4 accent-primary" />Cập nhật lại bảng giá</label></div><ProductLookupInput supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null} onSelect={(product) => { const index = importModal.form.items.findIndex((item) => !item.product_id); const targetIndex = index >= 0 ? index : importModal.form.items.length; if (index < 0) addLine(setImportModal); attachProductToLine(setImportModal, targetIndex, product); }} buttonLabel="Thêm vào phiếu" /><div className="overflow-hidden rounded-sm border border-primary/10"><table className="w-full border-collapse"><thead className="bg-[#f6f9fc]"><tr>{['Sản phẩm', 'Số lượng', 'Giá nhập', 'Cập nhật giá', 'Ghi chú', 'Xóa'].map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary">{label}</th>)}</tr></thead><tbody>{importModal.form.items.map((item, index) => <tr key={item.key}><td className="border-b border-r border-primary/10 px-3 py-2"><div className="space-y-2">{item.product_id ? <CellText primary={item.product_name || '-'} secondary={item.product_sku || '-'} /> : <div className="text-[12px] text-primary/45">Chưa chọn sản phẩm</div>}<ProductLookupInput supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null} onSelect={(product) => attachProductToLine(setImportModal, index, product)} placeholder="Đổi sản phẩm" buttonLabel="Chọn" /></div></td><td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.quantity} onChange={(event) => updateLine(setImportModal, index, 'quantity', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td><td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.unit_cost} onChange={(event) => updateLine(setImportModal, index, 'unit_cost', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td><td className="border-b border-r border-primary/10 px-3 py-2 text-center"><input type="checkbox" checked={item.update_supplier_price} onChange={(event) => updateLine(setImportModal, index, 'update_supplier_price', event.target.checked)} className="size-4 accent-primary" /></td><td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.notes} onChange={(event) => updateLine(setImportModal, index, 'notes', event.target.value)} className={`w-full ${inputClass}`} placeholder="Ghi chú" /></td><td className="border-b border-primary/10 px-3 py-2 text-center"><button type="button" onClick={() => removeLine(setImportModal, index)} className={dangerButton}>Xóa</button></td></tr>)}</tbody></table></div><div className="flex justify-between gap-2"><button type="button" onClick={() => addLine(setImportModal)} className={ghostButton}>Thêm dòng</button><textarea value={importModal.form.notes} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú phiếu nhập" className="min-h-[96px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" /></div></div></ModalShell>
            <ModalShell open={documentModal.open} title={documentModal.form.id ? `Sửa ${documentTitleMap[documentModal.tabKey]}` : `Tạo ${documentTitleMap[documentModal.tabKey]}`} onClose={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })} footer={<div className="flex items-center justify-between gap-3"><div className="text-[13px] font-black text-primary">{documentModal.tabKey === 'damaged' ? `Tổng số lượng: ${formatNumber(documentModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}` : `Tổng giá trị tạm tính: ${formatCurrency(documentLineTotal)}`}</div><div className="flex gap-2"><button type="button" onClick={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })} className={ghostButton}>Hủy</button><button type="button" onClick={saveDocument} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Đang lưu' : 'Lưu phiếu'}</button></div></div>}><div className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><input type="date" value={documentModal.form.document_date} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, document_date: event.target.value } }))} className={inputClass} /><select value={documentModal.form.supplier_id} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, supplier_id: event.target.value } }))} className={selectClass}><option value="">Không gắn nhà cung cấp</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><div className="flex items-center rounded-sm border border-primary/15 px-3 text-[13px] font-semibold text-primary">{documentTitleMap[documentModal.tabKey]}</div></div><ProductLookupInput supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null} onSelect={(product) => { const index = documentModal.form.items.findIndex((item) => !item.product_id); const targetIndex = index >= 0 ? index : documentModal.form.items.length; if (index < 0) addLine(setDocumentModal); attachProductToLine(setDocumentModal, targetIndex, product); }} buttonLabel="Thêm vào phiếu" /><div className="overflow-hidden rounded-sm border border-primary/10"><table className="w-full border-collapse"><thead className="bg-[#f6f9fc]"><tr>{['Sản phẩm', 'Số lượng', documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? 'Giá vốn' : null, documentModal.tabKey === 'adjustments' ? 'Loại tồn' : null, documentModal.tabKey === 'adjustments' ? 'Hướng' : null, 'Ghi chú', 'Xóa'].filter(Boolean).map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary">{label}</th>)}</tr></thead><tbody>{documentModal.form.items.map((item, index) => <tr key={item.key}><td className="border-b border-r border-primary/10 px-3 py-2"><div className="space-y-2">{item.product_id ? <CellText primary={item.product_name || '-'} secondary={item.product_sku || '-'} /> : <div className="text-[12px] text-primary/45">Chưa chọn sản phẩm</div>}<ProductLookupInput supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null} onSelect={(product) => attachProductToLine(setDocumentModal, index, product)} placeholder="Đổi sản phẩm" buttonLabel="Chọn" /></div></td><td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.quantity} onChange={(event) => updateLine(setDocumentModal, index, 'quantity', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td>{documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.unit_cost} onChange={(event) => updateLine(setDocumentModal, index, 'unit_cost', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td> : null}{documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><select value={item.stock_bucket} onChange={(event) => updateLine(setDocumentModal, index, 'stock_bucket', event.target.value)} className={`w-full ${selectClass}`}><option value="sellable">Tồn bán được</option><option value="damaged">Tồn hỏng</option></select></td> : null}{documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><select value={item.direction} onChange={(event) => updateLine(setDocumentModal, index, 'direction', event.target.value)} className={`w-full ${selectClass}`}><option value="in">Cộng</option><option value="out">Trừ</option></select></td> : null}<td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.notes} onChange={(event) => updateLine(setDocumentModal, index, 'notes', event.target.value)} className={`w-full ${inputClass}`} placeholder="Ghi chú" /></td><td className="border-b border-primary/10 px-3 py-2 text-center"><button type="button" onClick={() => removeLine(setDocumentModal, index)} className={dangerButton}>Xóa</button></td></tr>)}</tbody></table></div><div className="flex justify-between gap-2"><button type="button" onClick={() => addLine(setDocumentModal)} className={ghostButton}>Thêm dòng</button><textarea value={documentModal.form.notes} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú phiếu kho" className="min-h-[96px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" /></div></div></ModalShell>
        </div>
    );
};

export default InventoryMovement;
