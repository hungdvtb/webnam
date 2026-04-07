import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { categoryApi, attributeApi, productApi, STORAGE_BASE_URL } from '../../services/api';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Tree, getDescendants, isAncestor } from '@minoru/react-dnd-treeview';
import { useUI } from '../../context/UIContext';
import CategoryProductSortModal from '../../components/admin/CategoryProductSortModal';
import CategoryItemPickerModal from '../../components/admin/CategoryItemPickerModal';
import { resolveEntityImageUrl } from '../../utils/mediaUrl';
import {
    buildCategoryPickerGroups,
    normalizeCategoryAssignmentItems,
    normalizeCategoryAssignmentSearchValue,
    normalizeCategoryAssignmentItem,
} from '../../utils/categoryAssignments';

const CustomNode = ({
    node,
    depth,
    isOpen,
    onToggle,
    onEdit,
    onDelete,
    isSelected,
    onSelect,
    isChecked,
    onCheck,
    isDropTarget,
    showOrderInput,
    orderValue,
    onOrderChange,
    orderDisabled,
}) => {
    return (
        <div 
            style={{ paddingLeft: depth * 24 }} 
            className={`flex items-center gap-2 w-full py-2 hover:bg-gold/5 pr-4 border-b border-gold/10 group transition-all relative ${isSelected ? 'bg-gold/10 active-node' : ''} ${isDropTarget ? 'bg-primary/5' : ''}`}
            onClick={() => onSelect(node.id)}
        >
            {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-gold shadow-[0_0_10px_rgba(212,175,55,0.5)]"></div>}
            
            {isDropTarget && (
                <div className="absolute -top-3 left-[50%] -translate-x-1/2 z-[9999] bg-primary text-white text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-sm shadow-2xl animate-bounce flex items-center gap-1.5 border-2 border-white/20">
                    <span className="material-symbols-outlined text-[14px]">subdirectory_arrow_right</span>
                    Chuyển vào: {node.text}
                </div>
            )}
            
            {/* Checkbox for Bulk Actions */}
            <div className="flex items-center justify-center pl-2 pr-1" onClick={(e) => e.stopPropagation()}>
                <input 
                    type="checkbox" 
                    checked={isChecked} 
                    onChange={() => onCheck(node.id)}
                    className="size-4 rounded-sm accent-primary cursor-pointer"
                />
            </div>

            {/* Drag Handle */}
            <div className="flex items-center justify-center text-stone/20 group-hover:text-stone/40 cursor-grab active:cursor-grabbing px-1">
                <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
            </div>

            <div 
                className="flex-1 flex items-center gap-2 cursor-pointer select-none" 
                onClick={(e) => {
                    if (node.droppable) onToggle();
                }}
                onDoubleClick={() => onEdit(node)}
            >
                {node.droppable ? (
                    <span className={`material-symbols-outlined text-stone text-sm transition-transform duration-300 ${isOpen ? 'rotate-90 text-primary' : ''}`}>
                        chevron_right
                    </span>
                ) : (
                    <span className="w-5"></span>
                )}
                <span className={`material-symbols-outlined ${isSelected ? 'text-primary scale-110' : 'text-gold'} transition-all`} style={{ fontSize: '20px' }}>
                    {node.droppable ? (isOpen ? 'folder_open' : 'folder') : 'inventory_2'}
                </span>
                <span className={`font-ui text-primary transition-all ${isSelected ? 'font-black scale-[1.02] translate-x-1' : 'font-bold'}`}>{node.text}</span>
            </div>
            {showOrderInput ? (
                <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <input
                        type="number"
                        min="1"
                        value={orderValue}
                        onChange={(event) => onOrderChange(node.id, event.target.value)}
                        disabled={orderDisabled}
                        className="h-8 w-16 rounded-sm border border-gold/20 bg-white px-2 text-center text-[12px] font-bold text-primary outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:bg-stone-100"
                        title="So thu tu trong cung cap danh muc"
                    />
                </div>
            ) : null}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                    onClick={(e) => { e.stopPropagation(); onEdit(node); }} 
                    className="text-stone hover:text-primary transition-colors p-1" 
                    title="Sửa"
                >
                    <span className="material-symbols-outlined text-sm">edit</span>
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(node); }} 
                    className="text-stone hover:text-brick transition-colors p-1" 
                    title="Xóa"
                >
                    <span className="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
    );
};

const DraggableAttributeItem = ({ attrId, name, index, moveItem }) => {
    const ref = useRef(null);
    const [, drop] = useDrop({
        accept: 'selected-attr',
        hover(item, monitor) {
            if (!ref.current) return;
            const dragIndex = item.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;
            
            moveItem(dragIndex, hoverIndex);
            item.index = hoverIndex;
        },
    });
    const [{ isDragging }, drag] = useDrag({
        type: 'selected-attr',
        item: { attrId, index },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });
    drag(drop(ref));
    return (
        <div ref={ref} className={`flex items-center gap-2 p-1.5 bg-white border border-gold/20 rounded shadow-sm mb-1 cursor-grab active:cursor-grabbing transition-all hover:border-gold/40 ${isDragging ? 'opacity-0' : 'opacity-100'}`}>
             <span className="material-symbols-outlined text-[14px] text-stone/40">drag_indicator</span>
             <span className="text-[11px] font-bold text-primary uppercase tracking-wider truncate">{name}</span>
        </div>
    );
};

const Placeholder = (props) => {
    return (
        <div 
            className="absolute left-0 right-0 h-[2px] bg-primary/60 z-[100] flex items-center" 
            style={{ 
                left: props.depth * 24,
                transform: 'translateY(-50%)' 
            }}
        >
            <div className="w-2.5 h-2.5 rounded-full bg-primary border-2 border-white shadow-sm -ml-1.5" />
            <div className="ml-4 bg-gold text-primary text-[8px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full shadow-md animate-in fade-in zoom-in duration-200 flex items-center gap-1 border border-primary/20">
                <span className="material-symbols-outlined text-[12px]">reorder</span>
                Sắp xếp tại đây
            </div>
        </div>
    );
};

const INITIAL_FORM_DATA = {
    id: null,
    name: '',
    description: '',
    parent_id: '',
    status: 1,
    logo: null,
    logo_url: null,
    banner: null,
    banner_url: null,
    filterable_attribute_ids: [],
    category_items: [],
};

const createInitialFormData = () => ({
    ...INITIAL_FORM_DATA,
    filterable_attribute_ids: [],
    category_items: [],
});

const DEFAULT_IMPORT_MODE = 'replace_all';
const CATEGORY_IMPORT_FIELD_OPTIONS = [
    {
        id: 'name',
        label: 'Ten danh muc',
        description: 'Cap nhat ten danh muc.',
    },
    {
        id: 'description',
        label: 'Mo ta',
        description: 'Cap nhat mo ta danh muc.',
    },
    {
        id: 'tree',
        label: 'Cay danh muc',
        description: 'Cap nhat danh muc cha va thu tu trong cay.',
    },
    {
        id: 'banner',
        label: 'Anh banner',
        description: 'Cap nhat link anh banner va dong bo ve kho online.',
    },
    {
        id: 'logo',
        label: 'Anh nho',
        description: 'Cap nhat link anh nho va dong bo ve kho online.',
    },
];

const resolveCategoryAssetUrl = (value, preferred = 'medium') => {
    if (value && typeof value === 'object') {
        return resolveEntityImageUrl(value, preferred, '');
    }

    if (!value || typeof value !== 'string') {
        return null;
    }

    const cleanPath = value.trim().replace(/^\/+/, '');
    if (!cleanPath) {
        return null;
    }

    if (/^https?:\/\//i.test(cleanPath)) {
        return cleanPath;
    }

    const storagePath = cleanPath.startsWith('storage/')
        ? cleanPath.substring(8)
        : cleanPath;

    return `${STORAGE_BASE_URL}/storage/${storagePath}`;
};

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildImportErrorHtml = (errors = []) => (
    errors
        .map((error) => {
            const rowLabel = error?.row ? `Dòng ${error.row}` : 'Dữ liệu';
            const columnLabel = error?.column ? ` - ${escapeHtml(error.column)}` : '';
            const message = escapeHtml(error?.message || 'Lỗi không xác định.');
            return `${rowLabel}${columnLabel}: ${message}`;
        })
        .join('<br />')
);

const extractFilenameFromDisposition = (headerValue, fallbackFilename) => {
    if (!headerValue) return fallbackFilename;

    const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch?.[1]) {
        try {
            return decodeURIComponent(utfMatch[1]);
        } catch (error) {
            return utfMatch[1];
        }
    }

    const basicMatch = headerValue.match(/filename="?([^"]+)"?/i);
    return basicMatch?.[1] || fallbackFilename;
};

const downloadBlobResponse = (response, fallbackFilename) => {
    const blob = response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data]);
    const filename = extractFilenameFromDisposition(
        response?.headers?.['content-disposition'],
        fallbackFilename,
    );
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
};

const normalizeSortableCategoryProducts = (products) => normalizeCategoryAssignmentItems(products);

const resolveCategoryItemBadgeClasses = (item) => {
    if (item?.item_type === 'bundle_option') {
        return 'bg-amber-100 text-amber-700';
    }

    if (item?.display_type === 'variant' || item?.is_variant_child) {
        return 'bg-emerald-100 text-emerald-700';
    }

    if (item?.product_type === 'bundle') {
        return 'bg-primary/10 text-primary';
    }

    return 'bg-stone-100 text-stone-600';
};

const normalizeTreeParentId = (value) => {
    const numericValue = Number(value);

    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
};

const formatCategoriesForTree = (categories = []) => {
    const normalizedCategories = Array.isArray(categories)
        ? categories.map((category, index) => ({
            ...category,
            id: Number(category.id),
            parent_id: normalizeTreeParentId(category.parent_id),
            order: Number.isFinite(Number(category.order)) ? Number(category.order) : 0,
            __originalIndex: index,
        }))
        : [];

    const childrenByParent = new Map();

    normalizedCategories.forEach((category) => {
        const parentId = normalizeTreeParentId(category.parent_id);
        const siblings = childrenByParent.get(parentId) || [];
        siblings.push(category);
        childrenByParent.set(parentId, siblings);
    });

    childrenByParent.forEach((siblings) => {
        siblings.sort((left, right) => {
            const orderDifference = (left.order ?? 0) - (right.order ?? 0);
            if (orderDifference !== 0) {
                return orderDifference;
            }

            const idDifference = Number(left.id) - Number(right.id);
            if (idDifference !== 0) {
                return idDifference;
            }

            return (left.__originalIndex ?? 0) - (right.__originalIndex ?? 0);
        });
    });

    const orderedCategories = [];
    const visitedIds = new Set();

    const visit = (parentId = 0) => {
        const siblings = childrenByParent.get(parentId) || [];

        siblings.forEach((category) => {
            if (visitedIds.has(category.id)) {
                return;
            }

            visitedIds.add(category.id);
            orderedCategories.push(category);
            visit(category.id);
        });
    };

    visit(0);

    normalizedCategories.forEach((category) => {
        if (!visitedIds.has(category.id)) {
            orderedCategories.push(category);
        }
    });

    return orderedCategories.map(({ __originalIndex, ...category }) => ({
        id: category.id,
        parent: normalizeTreeParentId(category.parent_id),
        text: category.name,
        droppable: true,
        data: {
            ...category,
            parent_id: category.parent_id || null,
        },
    }));
};

const buildSiblingPositionMap = (tree = []) => {
    const nextPositionByParent = new Map();

    return tree.reduce((positions, node) => {
        const parentId = normalizeTreeParentId(node.parent);
        const nextPosition = (nextPositionByParent.get(parentId) ?? 0) + 1;

        nextPositionByParent.set(parentId, nextPosition);
        positions[node.id] = String(nextPosition);

        return positions;
    }, {});
};

const buildCategoryReorderPayload = (tree = []) => {
    const nextOrderByParent = new Map();

    return tree.map((node) => {
        const parentId = normalizeTreeParentId(node.parent);
        const nextOrder = nextOrderByParent.get(parentId) ?? 0;

        nextOrderByParent.set(parentId, nextOrder + 1);

        return {
            id: node.id,
            parent_id: parentId === 0 ? null : parentId,
            order: nextOrder,
        };
    });
};

const parseTreeOrderDraft = (value, fallbackValue) => {
    const parsedValue = Number.parseInt(String(value ?? '').trim(), 10);

    if (!Number.isFinite(parsedValue) || parsedValue < 1) {
        return fallbackValue;
    }

    return parsedValue;
};

const rebuildTreeFromOrderDrafts = (tree = [], draftOrders = {}) => {
    const currentPositions = buildSiblingPositionMap(tree);
    const siblingsByParent = new Map();

    tree.forEach((node, index) => {
        const parentId = normalizeTreeParentId(node.parent);
        const siblings = siblingsByParent.get(parentId) || [];
        const currentPosition = Number(currentPositions[node.id] || siblings.length + 1);

        siblings.push({
            node,
            originalIndex: index,
            currentPosition,
            desiredPosition: parseTreeOrderDraft(draftOrders[node.id], currentPosition),
        });
        siblingsByParent.set(parentId, siblings);
    });

    const reorderedTree = [];
    const visitedIds = new Set();

    const visit = (parentId = 0) => {
        const siblings = [...(siblingsByParent.get(parentId) || [])].sort((left, right) => {
            const desiredDifference = left.desiredPosition - right.desiredPosition;
            if (desiredDifference !== 0) {
                return desiredDifference;
            }

            const currentDifference = left.currentPosition - right.currentPosition;
            if (currentDifference !== 0) {
                return currentDifference;
            }

            return left.originalIndex - right.originalIndex;
        });

        siblings.forEach(({ node }) => {
            if (visitedIds.has(node.id)) {
                return;
            }

            visitedIds.add(node.id);
            reorderedTree.push({
                ...node,
                parent: parentId,
            });
            visit(node.id);
        });
    };

    visit(0);

    tree.forEach((node) => {
        if (!visitedIds.has(node.id)) {
            reorderedTree.push(node);
        }
    });

    return reorderedTree;
};

const reorderSiblingNodesFromDrafts = (nodes = [], draftOrders = {}) => {
    const currentPositions = buildSiblingPositionMap(nodes);

    return [...nodes]
        .map((node, index) => ({
            node,
            originalIndex: index,
            currentPosition: Number(currentPositions[node.id] || (index + 1)),
            desiredPosition: parseTreeOrderDraft(draftOrders[node.id], Number(currentPositions[node.id] || (index + 1))),
        }))
        .sort((left, right) => {
            const desiredDifference = left.desiredPosition - right.desiredPosition;
            if (desiredDifference !== 0) {
                return desiredDifference;
            }

            const currentDifference = left.currentPosition - right.currentPosition;
            if (currentDifference !== 0) {
                return currentDifference;
            }

            return left.originalIndex - right.originalIndex;
        })
        .map(({ node }) => node);
};

const CategoryProductRow = ({
    product,
    index,
    isFirst,
    isLast,
    isDragging,
    isDropTarget,
    onDragStart,
    onDragEnter,
    onDrop,
    onDragEnd,
    onMoveUp,
    onMoveDown,
}) => (
    <div
        draggable
        onDragStart={() => onDragStart(product.assignment_key)}
        onDragEnter={(event) => {
            event.preventDefault();
            onDragEnter(product.assignment_key);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
            event.preventDefault();
            onDrop(product.assignment_key);
        }}
        onDragEnd={onDragEnd}
        className={`rounded-sm border transition-all ${
            isDropTarget
                ? 'border-primary bg-primary/5 shadow-md'
                : 'border-gold/10 bg-white hover:border-gold/30'
        } ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
        <div className="flex items-center gap-3 p-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-gold/10 text-primary">
                {product.main_image ? (
                    <img
                        src={product.main_image}
                        alt={product.name}
                        className="h-full w-full rounded-sm object-cover"
                    />
                ) : (
                    <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                )}
            </div>

            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-stone/5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-stone/60">
                    <span className="material-symbols-outlined text-[14px]">drag_indicator</span>
                    #{index + 1}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            to={`/admin/products/edit/${product.admin_product_id || product.product_id}`}
                            className="truncate text-[13px] font-bold text-primary transition-colors hover:text-umber"
                        >
                            {product.item_type === 'bundle_option'
                                ? (product.bundle_option_title || product.name)
                                : product.name}
                        </Link>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${
                            product.item_type === 'bundle_option'
                                ? 'bg-amber-100 text-amber-700'
                                : (product.display_type === 'variant' || product.is_variant_child)
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : (product.product_type === 'bundle'
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-stone-100 text-stone-600')
                        }`}>
                            {product.display_label || 'San pham'}
                        </span>
                        {product.is_primary_category && product.item_type === 'product' ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-primary">
                                Danh mục chính
                            </span>
                        ) : product.item_type === 'product' ? (
                            <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700">
                                Gắn thêm
                            </span>
                        ) : null}
                        {!product.status ? (
                            <span className="rounded-full bg-brick/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-brick">
                                Đang ẩn
                            </span>
                        ) : null}
                    </div>

                    {product.item_type === 'bundle_option' ? (
                        <p className="mt-1 text-[11px] font-semibold text-primary/70">
                            Bundle: {product.bundle_parent_name || 'San pham bundle'}
                        </p>
                    ) : product.variant_parent_name ? (
                        <p className="mt-1 text-[11px] font-semibold text-primary/70">
                            Thuoc: {product.variant_parent_name}
                        </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-stone/55">
                        <span>SKU: {product.sku || '--'}</span>
                        <span>ID: {product.product_id || product.admin_product_id || '--'}</span>
                        {product.category_name ? <span>Chính: {product.category_name}</span> : null}
                        {product.item_type === 'bundle_option' && product.bundle_items_count > 0 ? (
                            <span>{product.bundle_items_count} thanh phan</span>
                        ) : null}
                    </div>
                    {product.item_type === 'bundle_option' && Array.isArray(product.bundle_items_summary) && product.bundle_items_summary.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {product.bundle_items_summary.slice(0, 3).map((summary, summaryIndex) => (
                                <span
                                    key={`${product.assignment_key}-summary-${summaryIndex}`}
                                    className="inline-flex max-w-full items-center rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700"
                                >
                                    <span className="truncate">
                                        {summary.name || 'San pham'}
                                        {summary.sku ? ` - ${summary.sku}` : ''}
                                    </span>
                                </span>
                            ))}
                            {product.bundle_items_summary.length > 3 ? (
                                <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold text-stone-500">
                                    +{product.bundle_items_summary.length - 3}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    onClick={onMoveUp}
                    disabled={isFirst}
                    className="flex h-8 w-8 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    title="Đưa lên"
                >
                    <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                </button>
                <button
                    type="button"
                    onClick={onMoveDown}
                    disabled={isLast}
                    className="flex h-8 w-8 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    title="Đưa xuống"
                >
                    <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                </button>
            </div>
        </div>
    </div>
);

const CategoryList = () => {
    const { showModal, showToast } = useUI();
    const [treeData, setTreeData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterLevel, setFilterLevel] = useState('all'); // 'all', 'root', 'child'
    const [filterStatus, setFilterStatus] = useState('all'); // 'all', '1', '0'
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const filterRef = React.useRef(null);
    const treeRef = React.useRef(null);
    const [selectedId, setSelectedId] = useState(null);
    const [isExpandingBranch, setIsExpandingBranch] = useState(false);
    const [isExpandingAll, setIsExpandingAll] = useState(false);
    const [isAllOpen, setIsAllOpen] = useState(false);
    const [openNodes, setOpenNodes] = useState(new Set());
    const [isTreeOrderMode, setIsTreeOrderMode] = useState(false);
    const [treeOrderDrafts, setTreeOrderDrafts] = useState({});
    const [treeOrderSaving, setTreeOrderSaving] = useState(false);
    const [selectedChildOrderDrafts, setSelectedChildOrderDrafts] = useState({});
    const [selectedChildOrderSaving, setSelectedChildOrderSaving] = useState(false);
    const [formData, setFormData] = useState(createInitialFormData);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [allAttributes, setAllAttributes] = useState([]);
    const [selectedCategoryMeta, setSelectedCategoryMeta] = useState(null);
    const [categoryProducts, setCategoryProducts] = useState([]);
    const [categoryProductsLoading, setCategoryProductsLoading] = useState(false);
    const [categoryProductsSaving, setCategoryProductsSaving] = useState(false);
    const [categoryProductsDirty, setCategoryProductsDirty] = useState(false);
    const [draggingProductId, setDraggingProductId] = useState(null);
    const [dragOverProductId, setDragOverProductId] = useState(null);
    const [isCategorySortModalOpen, setIsCategorySortModalOpen] = useState(false);
    const [isCategoryItemPickerOpen, setIsCategoryItemPickerOpen] = useState(false);
    const [categoryItemPickerMode, setCategoryItemPickerMode] = useState('form');
    const [categoryItemSearchQuery, setCategoryItemSearchQuery] = useState('');
    const [categoryItemSearchLoading, setCategoryItemSearchLoading] = useState(false);
    const [categoryItemPickerGroups, setCategoryItemPickerGroups] = useState([]);
    const importInputRef = useRef(null);
    const categoryItemSearchRequestRef = useRef(0);
    const [isExportingExcel, setIsExportingExcel] = useState(false);
    const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
    const [isImportingExcel, setIsImportingExcel] = useState(false);
    const [showImportConfigModal, setShowImportConfigModal] = useState(false);
    const [pendingImportFile, setPendingImportFile] = useState(null);
    const [importMode, setImportMode] = useState(DEFAULT_IMPORT_MODE);
    const [importUpdateFieldIds, setImportUpdateFieldIds] = useState([]);
    const isSelectiveImport = importMode === 'update_selected_fields';
    const canReorderTree = !searchQuery.trim() && filterLevel === 'all' && filterStatus === 'all';

    // Close dropdowns on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterRef.current && !filterRef.current.contains(event.target) && !event.target.closest('[data-filter-btn]')) {
                setShowFilterMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredTreeData = React.useMemo(() => {
        let matchedNodes = treeData;

        // Apply Status filter
        if (filterStatus === '1') {
            matchedNodes = matchedNodes.filter(n => n.data.status === 1);
        } else if (filterStatus === '0') {
            matchedNodes = matchedNodes.filter(n => n.data.status === 0);
        }

        // Apply Level filter
        if (filterLevel === 'root') {
            matchedNodes = matchedNodes.filter(n => n.parent === 0 || n.parent === null);
        } else if (filterLevel === 'child') {
            matchedNodes = matchedNodes.filter(n => n.parent !== 0 && n.parent !== null);
        }

        // Apply Search Query
        if (searchQuery.trim()) {
            const lowerQuery = searchQuery.toLowerCase();
            matchedNodes = matchedNodes.filter(node => node.text.toLowerCase().includes(lowerQuery));
        }
        
        // If no filter is applied, return full tree
        if (!searchQuery.trim() && filterLevel === 'all' && filterStatus === 'all') {
            return treeData;
        }

        // Find all their parents
        const includeIds = new Set(matchedNodes.map(node => node.id));
        
        // Helper to add parent recursively
        const addParent = (parentId) => {
            if (parentId === 0 || parentId === null) return;
            if (!includeIds.has(parentId)) {
                includeIds.add(parentId);
                const parentNode = treeData.find(n => n.id === parentId);
                if (parentNode) {
                    addParent(parentNode.parent);
                }
            }
        };

        matchedNodes.forEach(node => {
            addParent(node.parent);
        });
        
        return treeData.filter(node => includeIds.has(node.id));
    }, [treeData, searchQuery, filterLevel, filterStatus]);

    const siblingPositionMap = React.useMemo(
        () => buildSiblingPositionMap(treeData),
        [treeData],
    );

    const isTreeOrderDirty = React.useMemo(() => {
        if (!isTreeOrderMode) {
            return false;
        }

        return treeData.some((node) => {
            const fallbackValue = siblingPositionMap[node.id] ?? '';
            return String(treeOrderDrafts[node.id] ?? fallbackValue) !== String(fallbackValue);
        });
    }, [isTreeOrderMode, siblingPositionMap, treeData, treeOrderDrafts]);

    const selectedCategoryNode = React.useMemo(
        () => treeData.find((node) => node.id === selectedId) || null,
        [treeData, selectedId],
    );

    const selectedChildNodes = React.useMemo(() => {
        if (!selectedCategoryNode) {
            return [];
        }

        return treeData.filter((node) => normalizeTreeParentId(node.parent) === selectedCategoryNode.id);
    }, [selectedCategoryNode, treeData]);

    const selectedChildPositionMap = React.useMemo(
        () => buildSiblingPositionMap(selectedChildNodes),
        [selectedChildNodes],
    );

    const isSelectedChildOrderDirty = React.useMemo(() => {
        if (!selectedCategoryNode || selectedChildNodes.length === 0) {
            return false;
        }

        return selectedChildNodes.some((node) => {
            const fallbackValue = selectedChildPositionMap[node.id] ?? '';
            return String(selectedChildOrderDrafts[node.id] ?? fallbackValue) !== String(fallbackValue);
        });
    }, [selectedCategoryNode, selectedChildNodes, selectedChildOrderDrafts, selectedChildPositionMap]);

    const blockedParentIds = React.useMemo(() => {
        if (!formData.id) {
            return new Set();
        }

        return new Set([
            formData.id,
            ...getDescendants(treeData, formData.id).map((node) => node.id),
        ]);
    }, [treeData, formData.id]);

    const selectedCategoryItemMap = React.useMemo(
        () => new Map(
            normalizeCategoryAssignmentItems(formData.category_items)
                .map((item) => [item.assignment_key, item])
        ),
        [formData.category_items],
    );

    const selectedCategoryItems = React.useMemo(
        () => Array.from(selectedCategoryItemMap.values()),
        [selectedCategoryItemMap],
    );

    const setFormCategoryItems = (updater) => {
        setFormData((previous) => {
            const currentItems = normalizeCategoryAssignmentItems(previous.category_items);
            const nextItems = typeof updater === 'function'
                ? updater(currentItems)
                : updater;

            return {
                ...previous,
                category_items: normalizeCategoryAssignmentItems(nextItems),
            };
        });
    };

    const toggleFormCategoryItem = (rawItem) => {
        const normalizedItem = normalizeCategoryAssignmentItem(rawItem);

        if (!normalizedItem.assignment_key || !normalizedItem.product_id) {
            return;
        }

        setFormCategoryItems((currentItems) => {
            const existingItem = currentItems.find((item) => item.assignment_key === normalizedItem.assignment_key);

            if (existingItem) {
                if (existingItem.is_removable === false) {
                    return currentItems;
                }

                return currentItems.filter((item) => item.assignment_key !== normalizedItem.assignment_key);
            }

            return [...currentItems, normalizedItem];
        });
    };

    const removeFormCategoryItem = (assignmentKey) => {
        setFormCategoryItems((currentItems) => currentItems.filter((item) => (
            item.assignment_key !== assignmentKey || item.is_removable === false
        )));
    };

    const directSelectedItemMap = React.useMemo(() => new Map(
        categoryProducts.map((item) => [item.assignment_key, item])
    ), [categoryProducts]);

    const toggleDirectCategoryItem = (rawItem) => {
        const normalizedItem = normalizeCategoryAssignmentItem(rawItem);
        if (!normalizedItem.assignment_key || !normalizedItem.product_id) return;

        setCategoryProducts(currentItems => {
            const existingItemIndex = currentItems.findIndex(item => item.assignment_key === normalizedItem.assignment_key);
            if (existingItemIndex > -1) {
                if (currentItems[existingItemIndex].is_removable === false || currentItems[existingItemIndex].is_primary_category) return currentItems;
                const next = [...currentItems];
                next.splice(existingItemIndex, 1);
                return next;
            }
            return [...currentItems, { ...normalizedItem, display_label: normalizedItem.display_label || 'Sản phẩm' }];
        });
        setCategoryProductsDirty(true);
    };

    const resetCategoryItemPickerState = () => {
        categoryItemSearchRequestRef.current += 1;
        setCategoryItemSearchQuery('');
        setCategoryItemSearchLoading(false);
        setCategoryItemPickerGroups([]);
    };

    const closeCategoryItemPicker = () => {
        setIsCategoryItemPickerOpen(false);
        resetCategoryItemPickerState();
    };

    const closeCategoryForm = () => {
        setIsFormOpen(false);
        closeCategoryItemPicker();
    };

    const openCategoryCreateForm = () => {
        setFormData(createInitialFormData());
        resetCategoryItemPickerState();
        setIsCategoryItemPickerOpen(false);
        setIsFormOpen(true);
    };

    const fetchCategoryProductsData = async (categoryId) => {
        const response = await categoryApi.getProducts(categoryId);

        return {
            category: response.data?.category || null,
            products: normalizeSortableCategoryProducts(response.data?.products),
        };
    };

    useEffect(() => {
        if (!isTreeOrderMode) {
            return;
        }

        setTreeOrderDrafts((previous) => {
            const nextDrafts = {};
            let hasChanges = Object.keys(previous).length !== treeData.length;

            treeData.forEach((node) => {
                const fallbackValue = siblingPositionMap[node.id] ?? '';
                const nextValue = previous[node.id] ?? fallbackValue;
                nextDrafts[node.id] = nextValue;

                if (previous[node.id] !== nextValue) {
                    hasChanges = true;
                }
            });

            return hasChanges ? nextDrafts : previous;
        });
    }, [isTreeOrderMode, siblingPositionMap, treeData]);

    useEffect(() => {
        if (!isTreeOrderMode || canReorderTree) {
            return;
        }

        setIsTreeOrderMode(false);
        setTreeOrderDrafts(siblingPositionMap);
    }, [canReorderTree, isTreeOrderMode, siblingPositionMap]);

    useEffect(() => {
        setSelectedChildOrderDrafts(selectedChildPositionMap);
    }, [selectedId, selectedChildPositionMap]);

    const loadCategoryProducts = async (categoryId = selectedId) => {
        if (!categoryId) {
            setSelectedCategoryMeta(null);
            setCategoryProducts([]);
            setCategoryProductsDirty(false);
            return;
        }

        setCategoryProductsLoading(true);
        try {
            const payload = await fetchCategoryProductsData(categoryId);
            setSelectedCategoryMeta(payload.category);
            setCategoryProducts(payload.products);
            setCategoryProductsDirty(false);
        } catch (error) {
            console.error('Error loading category products:', error);
            setSelectedCategoryMeta(null);
            setCategoryProducts([]);
            showModal({
                title: 'Lỗi',
                content: 'Không thể tải danh sách sản phẩm trong danh mục này.',
                type: 'error',
            });
        } finally {
            setCategoryProductsLoading(false);
        }
    };

    useEffect(() => {
        if (!isCategoryItemPickerOpen) {
            return;
        }

        const normalizedQuery = normalizeCategoryAssignmentSearchValue(categoryItemSearchQuery);

        if (normalizedQuery.length < 2) {
            categoryItemSearchRequestRef.current += 1;
            setCategoryItemSearchLoading(false);
            setCategoryItemPickerGroups([]);
            return undefined;
        }

        const requestId = categoryItemSearchRequestRef.current + 1;
        categoryItemSearchRequestRef.current = requestId;

        const timer = window.setTimeout(async () => {
            setCategoryItemSearchLoading(true);

            try {
                const response = await productApi.getAll({
                    picker: true,
                    per_page: 50,
                    search: categoryItemSearchQuery.trim(),
                });

                if (categoryItemSearchRequestRef.current !== requestId) {
                    return;
                }

                const rawProducts = Array.isArray(response.data?.data) ? response.data.data : [];
                setCategoryItemPickerGroups(buildCategoryPickerGroups(rawProducts, categoryItemSearchQuery));
            } catch (error) {
                console.error('Error searching category items:', error);

                if (categoryItemSearchRequestRef.current === requestId) {
                    setCategoryItemPickerGroups([]);
                }
            } finally {
                if (categoryItemSearchRequestRef.current === requestId) {
                    setCategoryItemSearchLoading(false);
                }
            }
        }, 250);

        return () => {
            window.clearTimeout(timer);
        };
    }, [categoryItemSearchQuery, isCategoryItemPickerOpen]);

    const applyFormattedTreeData = (formattedData, { reloadProducts = true } = {}) => {
        setTreeData(formattedData);

        const availableIds = new Set(formattedData.map((node) => node.id));

        setSelectedIds((previous) => {
            const next = new Set(Array.from(previous).filter((id) => availableIds.has(id)));
            return next.size === previous.size ? previous : next;
        });

        const selectedStillExists = selectedId
            ? formattedData.some((node) => node.id === selectedId)
            : false;

        if (selectedStillExists) {
            if (reloadProducts) {
                loadCategoryProducts(selectedId);
            }
        } else {
            setSelectedId(null);
            setSelectedCategoryMeta(null);
            setCategoryProducts([]);
            setCategoryProductsDirty(false);
            setIsCategorySortModalOpen(false);
        }

        if (formData.id && !formattedData.some((node) => node.id === formData.id)) {
            setIsFormOpen(false);
            setFormData(createInitialFormData());
        }
    };

    const moveCategoryProduct = (fromIndex, toIndex) => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= categoryProducts.length || toIndex >= categoryProducts.length) {
            return;
        }

        setCategoryProducts((previous) => {
            const next = [...previous];
            const [movedItem] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, movedItem);
            return next;
        });
        setCategoryProductsDirty(true);
    };

    const saveCategoryProductOrder = async () => {
        if (!selectedId || categoryProductsSaving || !categoryProductsDirty) {
            return;
        }

        setCategoryProductsSaving(true);
        try {
            const response = await categoryApi.reorderProducts(
                selectedId,
                categoryProducts.map((product) => ({
                    item_type: product.item_type,
                    product_id: product.product_id,
                    bundle_option_key: product.bundle_option_key || '',
                    bundle_option_post_id: product.bundle_option_post_id || null,
                    bundle_option_title: product.bundle_option_title || null,
                })),
            );

            setSelectedCategoryMeta(response.data?.category || null);
            setCategoryProducts(normalizeSortableCategoryProducts(response.data?.products));
            setCategoryProductsDirty(false);
            showToast({ message: 'Đã lưu thứ tự sản phẩm trong danh mục.', type: 'success' });
        } catch (error) {
            console.error('Error saving category product order:', error);
            showModal({
                title: 'Lỗi',
                content: error?.response?.data?.message || 'Không thể lưu thứ tự sản phẩm trong danh mục.',
                type: 'error',
            });
        } finally {
            setCategoryProductsSaving(false);
        }
    };

    const moveCategoryProductByOffset = (productId, offset) => {
        const currentIndex = categoryProducts.findIndex((product) => product.assignment_key === productId);
        if (currentIndex < 0) {
            return;
        }

        moveCategoryProduct(currentIndex, currentIndex + offset);
    };

    const moveCategoryProductToPosition = (productId, position) => {
        const currentIndex = categoryProducts.findIndex((product) => product.assignment_key === productId);
        if (currentIndex < 0) {
            return;
        }

        const targetIndex = Math.min(
            Math.max(Number(position) - 1, 0),
            Math.max(categoryProducts.length - 1, 0),
        );

        moveCategoryProduct(currentIndex, targetIndex);
    };

    const resetCategoryProductDragState = () => {
        setDraggingProductId(null);
        setDragOverProductId(null);
    };

    const closeCategorySortModal = () => {
        resetCategoryProductDragState();
        setIsCategorySortModalOpen(false);
    };

    const handleCategoryProductDragStart = (productId) => {
        setDraggingProductId(productId);
        setDragOverProductId(productId);
    };

    const handleCategoryProductDrop = (targetProductId) => {
        if (!draggingProductId || draggingProductId === targetProductId) {
            resetCategoryProductDragState();
            return;
        }

        const fromIndex = categoryProducts.findIndex((product) => product.assignment_key === draggingProductId);
        const toIndex = categoryProducts.findIndex((product) => product.assignment_key === targetProductId);

        moveCategoryProduct(fromIndex, toIndex);
        resetCategoryProductDragState();
    };

    const persistTreeOrder = async (nextTree, successMessage) => {
        setTreeOrderSaving(true);

        try {
            const response = await categoryApi.reorder(buildCategoryReorderPayload(nextTree));
            const responseCategories = Array.isArray(response.data?.categories)
                ? response.data.categories
                : null;

            if (responseCategories) {
                applyFormattedTreeData(formatCategoriesForTree(responseCategories), { reloadProducts: false });
            } else {
                applyFormattedTreeData(nextTree, { reloadProducts: false });
            }

            showToast({
                message: successMessage,
                type: 'success',
            });

            return true;
        } catch (error) {
            console.error('Category tree reorder error:', error);
            showModal({
                title: 'Lỗi',
                content: error?.response?.data?.message || 'Không thể lưu thứ tự cây danh mục.',
                type: 'error',
            });
            await fetchCategories();
            return false;
        } finally {
            setTreeOrderSaving(false);
        }
    };

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [catRes, attrRes] = await Promise.all([
                categoryApi.getAll(),
                attributeApi.getAll() // Fetch all to ensure names show even if inactive in this view
            ]);

            applyFormattedTreeData(formatCategoriesForTree(catRes.data), { reloadProducts: false });

            // Set attributes for selection
            setAllAttributes(attrRes.data || []);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const res = await categoryApi.getAll();
            applyFormattedTreeData(formatCategoriesForTree(res.data));
        } catch (error) {
            console.error('Error fetching categories:', error);
            showModal({
                title: 'Lỗi',
                content: 'Không thể tải lại danh sách danh mục.',
                type: 'error',
            });
        }
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isFormOpen && !isCategoryItemPickerOpen) {
                closeCategoryForm();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeCategoryForm, isCategoryItemPickerOpen, isFormOpen]);

    useEffect(() => {
        if (!selectedId) {
            setSelectedCategoryMeta(null);
            setCategoryProducts([]);
            setCategoryProductsDirty(false);
            setIsCategorySortModalOpen(false);
            return;
        }

        loadCategoryProducts(selectedId);
    }, [selectedId]);

    useEffect(() => {
        if (!selectedId) {
            return;
        }

        const selectedStillExists = treeData.some((node) => node.id === selectedId);
        if (!selectedStillExists) {
            setSelectedId(null);
            setSelectedCategoryMeta(null);
            setCategoryProducts([]);
            setCategoryProductsDirty(false);
        }
    }, [treeData, selectedId]);

    const handleTreeOrderDraftChange = (categoryId, value) => {
        if (value !== '' && !/^\d+$/.test(value)) {
            return;
        }

        setTreeOrderDrafts((previous) => ({
            ...previous,
            [categoryId]: value,
        }));
    };

    const openTreeOrderMode = () => {
        if (!canReorderTree || treeOrderSaving) {
            showModal({
                title: 'Khong the sap xep',
                content: 'Hay tat tim kiem va bo loc truoc khi sap xep danh muc theo so thu tu.',
                type: 'warning',
            });
            return;
        }

        setTreeOrderDrafts(siblingPositionMap);
        setIsTreeOrderMode(true);
    };

    const closeTreeOrderMode = () => {
        setTreeOrderDrafts(siblingPositionMap);
        setIsTreeOrderMode(false);
    };

    const saveTreeOrderDrafts = async () => {
        if (!isTreeOrderMode || treeOrderSaving) {
            return;
        }

        if (!isTreeOrderDirty) {
            setIsTreeOrderMode(false);
            return;
        }

        const nextTree = rebuildTreeFromOrderDrafts(treeData, treeOrderDrafts);
        applyFormattedTreeData(nextTree, { reloadProducts: false });

        const saved = await persistTreeOrder(nextTree, 'Da luu thu tu danh muc.');
        if (saved) {
            setTreeOrderDrafts(buildSiblingPositionMap(nextTree));
            setIsTreeOrderMode(false);
        }
    };

    const handleSelectedChildOrderDraftChange = (categoryId, value) => {
        if (value !== '' && !/^\d+$/.test(value)) {
            return;
        }

        setSelectedChildOrderDrafts((previous) => ({
            ...previous,
            [categoryId]: value,
        }));
    };

    const resetSelectedChildOrderDrafts = () => {
        setSelectedChildOrderDrafts(selectedChildPositionMap);
    };

    const saveSelectedChildOrder = async () => {
        if (!selectedCategoryNode || selectedChildNodes.length === 0 || selectedChildOrderSaving) {
            return;
        }

        if (!isSelectedChildOrderDirty) {
            return;
        }

        const orderedChildren = reorderSiblingNodesFromDrafts(selectedChildNodes, selectedChildOrderDrafts);
        setSelectedChildOrderSaving(true);

        try {
            const response = await categoryApi.reorder(
                orderedChildren.map((node, index) => ({
                    id: node.id,
                    parent_id: selectedCategoryNode.id,
                    order: index,
                })),
            );

            const responseCategories = Array.isArray(response.data?.categories)
                ? response.data.categories
                : null;

            if (responseCategories) {
                applyFormattedTreeData(formatCategoriesForTree(responseCategories), { reloadProducts: false });
            } else {
                await fetchCategories();
            }

            showToast({
                message: `Đã lưu thứ tự danh mục con của "${selectedCategoryNode.text}".`,
                type: 'success',
            });
        } catch (error) {
            console.error('Child category order save error:', error);
            showModal({
                title: 'Lỗi',
                content: error?.response?.data?.message || 'Không thể lưu thứ tự danh mục con.',
                type: 'error',
            });
            await fetchCategories();
        } finally {
            setSelectedChildOrderSaving(false);
        }
    };

    const handleDrop = async (newTree) => {
        if (!canReorderTree || isTreeOrderMode || treeOrderSaving) {
            return;
        }

        applyFormattedTreeData(newTree, { reloadProducts: false });
        await persistTreeOrder(newTree, 'Da luu thu tu keo tha danh muc.');
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        try {
            const data = new FormData();
            const payloadCategoryItems = normalizeCategoryAssignmentItems(formData.category_items).map((item) => ({
                item_type: item.item_type,
                product_id: item.product_id,
                bundle_option_key: item.bundle_option_key || '',
                bundle_option_post_id: item.bundle_option_post_id || null,
                bundle_option_title: item.bundle_option_title || null,
            }));
            data.append('name', formData.name);
            data.append('description', formData.description || '');
            data.append('category_items', JSON.stringify(payloadCategoryItems));
            
            // Only append parent_id if it's not root (0 or empty)
            if (formData.parent_id && formData.parent_id !== '0' && formData.parent_id !== '') {
                data.append('parent_id', formData.parent_id);
            }
            
            data.append('status', formData.status);
            // Handle array of attributes
            if (formData.filterable_attribute_ids && formData.filterable_attribute_ids.length > 0) {
                formData.filterable_attribute_ids.forEach((attrId) => {
                    data.append('filterable_attribute_ids[]', attrId);
                });
            } else {
                data.append('clear_attributes', 'true');
            }
            
            if (formData.banner instanceof File) {
                data.append('banner', formData.banner);
            } else if (formData.banner === null && formData.id) {
                data.append('remove_banner', 'true');
            }

            if (formData.logo instanceof File) {
                data.append('logo', formData.logo);
            } else if (formData.logo === null && formData.id) {
                data.append('remove_logo', 'true');
            }

            const response = formData.id
                ? await categoryApi.update(formData.id, data)
                : await categoryApi.store(data);
            const savedCategoryId = Number(response?.data?.id || formData.id || 0) || null;

            closeCategoryForm();
            setFormData(createInitialFormData());
            await fetchCategories();

            if (savedCategoryId) {
                setSelectedId(savedCategoryId);
            }

            showToast({
                message: 'Da luu danh muc va item trong danh muc.',
                type: 'success',
            });
        } catch (error) {
            console.error("Lỗi khi lưu danh mục:", error);
            const message = error.response?.data?.message || error.message;
            const validationErrors = error.response?.data?.errors;
            
            if (validationErrors) {
                const errorText = Object.values(validationErrors).flat().join('\n');
                alert(`Lỗi xác thực:\n${errorText}`);
            } else {
                alert(`Đã xảy ra lỗi: ${message}`);
            }
        }
    };

    const handleEdit = async (node) => {
        const cat = node.data;
        const bannerUrl = resolveCategoryAssetUrl(cat.banner_image || cat.banner_path, 'medium');
        const logoUrl = resolveCategoryAssetUrl(cat.logo_image || cat.logo_path, 'thumbnail');
        let categoryItems = [];

        if (Number(selectedId) === Number(cat.id) && !categoryProductsLoading) {
            categoryItems = categoryProducts;
        } else {
            try {
                const payload = await fetchCategoryProductsData(cat.id);
                categoryItems = payload.products;
            } catch (error) {
                console.error('Error loading category items for edit form:', error);
                showModal({
                    title: 'Lá»—i',
                    content: 'KhÃ´ng thá»ƒ táº£i danh sÃ¡ch item trong danh má»¥c. Báº¡n váº«n cÃ³ thá»ƒ sá»­a thÃ´ng tin khÃ¡c.',
                    type: 'error',
                });
            }
        }

        resetCategoryItemPickerState();
        setIsCategoryItemPickerOpen(false);

        setFormData({
            id: cat.id,
            name: cat.name,
            description: cat.description || '',
            parent_id: cat.parent_id || '',
            status: cat.status,
            logo: cat.logo_path,
            logo_url: logoUrl,
            banner: cat.banner_path,
            banner_url: bannerUrl,
            filterable_attribute_ids: (cat.filterable_attribute_ids || []).map(id => Number(id)),
            category_items: normalizeCategoryAssignmentItems(categoryItems),
        });
        setIsFormOpen(true);
    };

    const handleDelete = async (node) => {
        if (window.confirm(`Bạn có chắc muốn xóa danh mục "${node.text}"? Tất cả danh mục con cũng sẽ bị xóa.`)) {
            try {
                await categoryApi.destroy(node.id);
                fetchCategories();
            } catch (error) {
                console.error("Lỗi khi xóa:", error);
                alert("Không thể xóa danh mục này.");
            }
        }
    };

    const handleCheck = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleBulkCheck = (checked) => {
        if (checked) {
            setSelectedIds(new Set(filteredTreeData.map(n => n.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleBulkDelete = () => {
        if (selectedIds.size === 0 || isBulkDeleting) return;

        const ids = Array.from(selectedIds);
        const selectedCount = ids.length;

        showModal({
            title: 'Xóa danh mục đã chọn',
            content: `Bạn có chắc muốn xóa <strong>${selectedCount}</strong> danh mục đã chọn?<br /><br />Nếu trong số đó có danh mục cha, toàn bộ danh mục con bên trong cũng sẽ bị xóa theo.`,
            type: 'warning',
            actionText: 'Xóa danh mục',
            onAction: async () => {
                setIsBulkDeleting(true);
                try {
                    await categoryApi.bulkDelete(ids);
                    setSelectedIds(new Set());
                    showToast({
                        message: `Đã xóa ${selectedCount} danh mục đã chọn.`,
                        type: 'success',
                    });
                    await fetchCategories();
                } catch (error) {
                    console.error('Bulk delete error:', error);
                    showModal({
                        title: 'Lỗi',
                        content: error?.response?.data?.message || 'Không thể xóa các danh mục đã chọn.',
                        type: 'error',
                    });
                } finally {
                    setIsBulkDeleting(false);
                }
            },
        });
    };

    const handleDownloadTemplate = async () => {
        setIsDownloadingTemplate(true);
        try {
            const response = await categoryApi.downloadImportTemplate();
            downloadBlobResponse(response, 'mau-import-danh-muc-san-pham.xlsx');
        } catch (error) {
            console.error('Template download error:', error);
            showModal({
                title: 'Lỗi',
                content: error?.response?.data?.message || 'Không thể tải file mẫu Excel.',
                type: 'error',
            });
        } finally {
            setIsDownloadingTemplate(false);
        }
    };

    const handleDownloadExcel = async () => {
        setIsExportingExcel(true);
        try {
            const response = await categoryApi.downloadExcel(
                selectedIds.size > 0 ? { ids: Array.from(selectedIds) } : undefined
            );
            downloadBlobResponse(response, 'danh-muc-san-pham.xlsx');
            if (selectedIds.size > 0) {
                showToast({
                    message: `Da xuat ${selectedIds.size} danh muc da chon kem cay lien quan.`,
                    type: 'success',
                    duration: 2500,
                });
            }
        } catch (error) {
            console.error('Category export error:', error);
            showModal({
                title: 'Lỗi',
                content: error?.response?.data?.message || 'Không thể xuất Excel danh mục sản phẩm.',
                type: 'error',
            });
        } finally {
            setIsExportingExcel(false);
        }
    };

    const handleOpenImportPicker = () => {
        if (isImportingExcel) return;
        importInputRef.current?.click();
    };

    const resetImportConfig = () => {
        setPendingImportFile(null);
        setImportMode(DEFAULT_IMPORT_MODE);
        setImportUpdateFieldIds([]);
        setShowImportConfigModal(false);
    };

    const closeImportConfigModal = () => {
        if (isImportingExcel) return;
        resetImportConfig();
    };

    const handleImportModeChange = (nextMode) => {
        setImportMode(nextMode);
        if (nextMode !== 'update_selected_fields') {
            setImportUpdateFieldIds([]);
        }
    };

    const toggleImportUpdateField = (fieldId) => {
        setImportUpdateFieldIds((prev) => (
            prev.includes(fieldId)
                ? prev.filter((id) => id !== fieldId)
                : [...prev, fieldId]
        ));
    };

    const handleSelectAllImportFields = () => {
        setImportUpdateFieldIds(CATEGORY_IMPORT_FIELD_OPTIONS.map((option) => option.id));
    };

    const handleClearImportFields = () => {
        setImportUpdateFieldIds([]);
    };

    const handleImportFileChange = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        setPendingImportFile(file);
        setImportMode(DEFAULT_IMPORT_MODE);
        setImportUpdateFieldIds([]);
        setShowImportConfigModal(true);
    };

    const handleSubmitImportExcel = async () => {
        if (!pendingImportFile) {
            return;
        }

        if (isSelectiveImport && importUpdateFieldIds.length === 0) {
            showModal({
                title: 'Thieu truong cap nhat',
                content: 'Hay chon it nhat 1 truong can cap nhat truoc khi import.',
                type: 'warning',
            });
            return;
        }

        const data = new FormData();
        data.append('file', pendingImportFile);
        data.append('mode', importMode);

        if (isSelectiveImport) {
            importUpdateFieldIds.forEach((fieldId) => data.append('update_fields[]', fieldId));
        }

        setIsImportingExcel(true);
        try {
            const response = await categoryApi.importExcel(data);
            showToast({
                message: response?.data?.message || 'Import Excel thÃ nh cÃ´ng.',
                type: 'success',
                duration: 3500,
            });
            resetImportConfig();
            await fetchCategories();
        } catch (error) {
            console.error('Category import error:', error);
            const importErrors = Array.isArray(error?.response?.data?.errors)
                ? error.response.data.errors
                : [];

            showModal({
                title: 'Import Excel tháº¥t báº¡i',
                content: importErrors.length > 0
                    ? buildImportErrorHtml(importErrors)
                    : (error?.response?.data?.message || 'KhÃ´ng thá»ƒ import file Excel.'),
                type: 'error',
            });
        } finally {
            setIsImportingExcel(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-stone">Dang tai danh sach...</div>;

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
                <style>
                    {`
                        .custom-scrollbar::-webkit-scrollbar {
                            width: 8px;
                            height: 8px;
                        }
                        .custom-scrollbar::-webkit-scrollbar-track {
                            background: rgba(182, 143, 84, 0.05);
                        }
                        .custom-scrollbar::-webkit-scrollbar-thumb {
                            background: rgba(182, 143, 84, 0.2);
                            border-radius: 4px;
                            border: 2px solid transparent;
                            background-clip: content-box;
                        }
                        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                            background: rgba(182, 143, 84, 0.4);
                        }
                        .category-content-grid {
                            height: 100%;
                            min-height: 0;
                            display: grid;
                            grid-template-columns: minmax(0, 1fr);
                            gap: 1.5rem;
                        }
                        .category-panel {
                            min-width: 0;
                            min-height: 0;
                        }
                        @media (min-width: 1200px) {
                            .category-content-grid {
                                grid-template-columns: minmax(0, 1.16fr) minmax(0, 0.92fr) minmax(0, 0.92fr);
                            }
                        }
                    `}
                </style>

                {/* Header Area */}
                <div className="flex-none bg-[#fcfcfa] pb-4">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-display font-bold text-primary italic">Danh mục sản phẩm</h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Quản lý cấu trúc danh mục và phân cấp</p>
                        </div>
                    </div>

                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="hidden"
                        onChange={handleImportFileChange}
                    />

                    {showImportConfigModal && (
                        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4" onClick={closeImportConfigModal}>
                            <div
                                className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-sm bg-white p-6 shadow-2xl"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                                    <div>
                                        <h2 className="flex items-center gap-2 text-lg font-bold text-primary">
                                            <span className="material-symbols-outlined">upload_file</span>
                                            Import Excel danh muc
                                        </h2>
                                        <p className="mt-2 text-[13px] text-primary/65">
                                            Chon che do import va xac dinh dung cac truong duoc phep cap nhat tu file Excel.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={closeImportConfigModal}
                                        className="text-gray-500 hover:text-brick disabled:opacity-40"
                                        disabled={isImportingExcel}
                                    >
                                        <span className="material-symbols-outlined">close</span>
                                    </button>
                                </div>

                                <div className="mt-4 rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">File da chon</div>
                                    <div className="mt-1 break-all text-[13px] font-bold text-primary">{pendingImportFile?.name || 'Chua co file'}</div>
                                </div>

                                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                                    {[
                                        {
                                            value: 'replace_all',
                                            label: 'Import day du',
                                            description: 'Doi chieu lai ten, mo ta, cay danh muc va anh theo file export/import.',
                                        },
                                        {
                                            value: 'update_selected_fields',
                                            label: 'Cap nhat 1 phan',
                                            description: 'Chi cac truong duoc tick moi duoc cap nhat. Cac truong khac giu nguyen.',
                                        },
                                    ].map((option) => {
                                        const checked = importMode === option.value;

                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleImportModeChange(option.value)}
                                                className={`rounded-sm border px-4 py-4 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-[14px] font-bold text-primary">{option.label}</div>
                                                        <div className="mt-1 text-[12px] leading-5 text-primary/60">{option.description}</div>
                                                    </div>
                                                    <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                        {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {isSelectiveImport ? (
                                    <>
                                        <div className="mt-4 flex flex-wrap items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={handleSelectAllImportFields}
                                                className="rounded-sm border border-primary/20 px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary/5"
                                            >
                                                Chon tat ca
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleClearImportFields}
                                                className="rounded-sm border border-primary/20 px-3 py-1.5 text-[12px] font-bold text-brick hover:bg-brick/5"
                                            >
                                                Bo chon tat ca
                                            </button>
                                            <p className="text-[12px] text-primary/60">
                                                Dang chon <strong>{importUpdateFieldIds.length}</strong> truong cap nhat.
                                            </p>
                                        </div>

                                        <div className="mt-4 grid max-h-[320px] grid-cols-1 gap-3 overflow-y-auto pr-1 custom-scrollbar sm:grid-cols-2">
                                            {CATEGORY_IMPORT_FIELD_OPTIONS.map((option) => {
                                                const checked = importUpdateFieldIds.includes(option.id);

                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        onClick={() => toggleImportUpdateField(option.id)}
                                                        className={`rounded-sm border px-4 py-3 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="text-[13px] font-bold text-primary">{option.label}</div>
                                                                <div className="mt-1 text-[11px] leading-5 text-primary/55">{option.description}</div>
                                                            </div>
                                                            <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                                {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </>
                                ) : (
                                    <div className="mt-4 rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3 text-[13px] text-primary/70">
                                        He thong se dung file Excel de khoi phuc lai ten, mo ta, cay danh muc va anh theo dung du lieu co trong file.
                                    </div>
                                )}

                                <div className="mt-6 flex flex-col gap-3 border-t border-primary/10 pt-4 md:flex-row md:items-center md:justify-between">
                                    <p className="text-[12px] text-primary/60">
                                        Ma danh muc duoc dung de nhan dien danh muc da ton tai. Anh import se duoc dong bo ve kho online cua he thong.
                                    </p>
                                    <div className="flex justify-end gap-3">
                                        <button
                                            type="button"
                                            onClick={closeImportConfigModal}
                                            className="rounded-sm border border-primary/20 px-4 py-2 text-[13px] font-bold text-primary hover:bg-primary/5"
                                            disabled={isImportingExcel}
                                        >
                                            Huy
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSubmitImportExcel}
                                            className="flex items-center gap-2 rounded-sm bg-primary px-6 py-2 text-[13px] font-bold text-white hover:bg-primary/90 disabled:opacity-60"
                                            disabled={isImportingExcel || !pendingImportFile || (isSelectiveImport && importUpdateFieldIds.length === 0)}
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${isImportingExcel ? 'animate-spin' : ''}`}>
                                                {isImportingExcel ? 'sync' : 'upload_file'}
                                            </span>
                                            Bat dau import
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Toolbar */}
                    <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                        <div className="flex gap-1.5 items-center w-full max-w-3xl">
                            <button
                                onClick={openCategoryCreateForm}
                                className="bg-brick text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm shrink-0"
                                title="Thêm danh mục mới"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                            <button
                                onClick={fetchCategories}
                                className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shrink-0 ${loading ? 'opacity-70' : ''}`}
                                title="Làm mới"
                                disabled={loading}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            </button>
                            <button
                                onClick={handleBulkDelete}
                                className={`relative border p-1.5 transition-all flex items-center justify-center rounded-sm w-9 h-9 shrink-0 shadow-sm ${
                                    selectedIds.size > 0
                                        ? 'bg-brick text-white border-brick hover:bg-umber hover:border-umber'
                                        : 'bg-white border-gold/20 text-stone/35'
                                } ${isBulkDeleting ? 'opacity-70' : ''}`}
                                title={selectedIds.size > 0 ? `Xóa ${selectedIds.size} danh mục đã chọn` : 'Chọn danh mục để xóa'}
                                disabled={selectedIds.size === 0 || isBulkDeleting}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${isBulkDeleting ? 'animate-pulse' : ''}`}>delete</span>
                                {selectedIds.size > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-gold px-1 text-center text-[9px] font-black leading-[18px] text-primary shadow-sm">
                                        {selectedIds.size}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={handleDownloadTemplate}
                                className={`bg-white border border-gold/20 p-1.5 hover:border-gold/40 hover:text-primary transition-all flex items-center justify-center rounded-sm w-9 h-9 shrink-0 shadow-sm ${isDownloadingTemplate ? 'text-primary' : 'text-stone'}`}
                                title="Táº£i file máº«u Excel"
                                disabled={isDownloadingTemplate}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${isDownloadingTemplate ? 'animate-spin' : ''}`}>
                                    {isDownloadingTemplate ? 'sync' : 'description'}
                                </span>
                            </button>

                            <button
                                onClick={handleDownloadExcel}
                                className={`bg-white border border-gold/20 p-1.5 hover:border-gold/40 hover:text-primary transition-all flex items-center justify-center rounded-sm w-9 h-9 shrink-0 shadow-sm ${isExportingExcel ? 'text-primary' : 'text-stone'}`}
                                title={selectedIds.size > 0 ? `Xuáº¥t ${selectedIds.size} danh má»¥c Ä‘Ã£ chá»n` : 'Xuáº¥t Excel'}
                                disabled={isExportingExcel}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${isExportingExcel ? 'animate-spin' : ''}`}>
                                    {isExportingExcel ? 'sync' : 'download'}
                                </span>
                            </button>

                            <button
                                onClick={handleOpenImportPicker}
                                className={`bg-white border border-gold/20 p-1.5 hover:border-gold/40 hover:text-primary transition-all flex items-center justify-center rounded-sm w-9 h-9 shrink-0 shadow-sm ${isImportingExcel ? 'text-primary' : 'text-stone'}`}
                                title="Import Excel"
                                disabled={isImportingExcel}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${isImportingExcel ? 'animate-spin' : ''}`}>
                                    {isImportingExcel ? 'sync' : 'upload_file'}
                                </span>
                            </button>

                            <div className="w-px h-5 bg-gold/10 mx-1 shrink-0"></div>

                            {/* Filter Button */}
                            <div className="relative shrink-0">
                                <button 
                                    data-filter-btn
                                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                                    className={`flex w-9 h-9 items-center justify-center rounded-sm border transition-all ${(filterLevel !== 'all' || filterStatus !== 'all') ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-white border-gold/20 text-stone hover:border-gold/40 hover:text-primary shadow-sm'}`}
                                    title="Bộ lọc nâng cao"
                                >
                                    <span className="material-symbols-outlined text-[18px]">{(filterLevel !== 'all' || filterStatus !== 'all') ? 'filter_alt' : 'filter_list'}</span>
                                </button>
                                
                                {showFilterMenu && (
                                    <div ref={filterRef} className="absolute left-0 top-full mt-2 w-64 bg-white rounded-sm shadow-[0_0_20px_rgba(0,0,0,0.1)] border border-gold/20 z-50 animate-in fade-in zoom-in-95 duration-200">
                                        <div className="p-3 border-b border-gold/10">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                                                    <span className="material-symbols-outlined text-[14px]">tune</span>
                                                    Tùy chọn lọc
                                                </span>
                                                {(filterLevel !== 'all' || filterStatus !== 'all') && (
                                                    <button 
                                                        onClick={() => { setFilterLevel('all'); setFilterStatus('all'); }} 
                                                        className="text-[10px] text-brick hover:underline font-bold"
                                                    >
                                                        Xóa lọc
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="p-3 space-y-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Cấp danh mục</label>
                                                <select 
                                                    value={filterLevel} 
                                                    onChange={(e) => setFilterLevel(e.target.value)}
                                                    className="w-full bg-stone/5 border border-gold/10 p-2.5 text-[12px] focus:outline-none focus:border-primary font-body rounded-sm"
                                                >
                                                    <option value="all">Tất cả cấp</option>
                                                    <option value="root">Danh mục gốc</option>
                                                    <option value="child">Danh mục con</option>
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Trạng thái hiển thị</label>
                                                <select 
                                                    value={filterStatus} 
                                                    onChange={(e) => setFilterStatus(e.target.value)}
                                                    className="w-full bg-stone/5 border border-gold/10 p-2.5 text-[12px] focus:outline-none focus:border-primary font-body rounded-sm"
                                                >
                                                    <option value="all">Tất cả trạng thái</option>
                                                    <option value="1">Đang hiển thị</option>
                                                    <option value="0">Đang ẩn</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button 
                                onClick={async () => {
                                    if (!selectedId) return;
                                    setIsExpandingBranch(true);
                                    
                                    if (openNodes.has(selectedId)) {
                                        treeRef.current?.close(selectedId);
                                        setOpenNodes(prev => {
                                            const next = new Set(prev);
                                            next.delete(selectedId);
                                            return next;
                                        });
                                    } else {
                                        treeRef.current?.open(selectedId);
                                        setOpenNodes(prev => new Set(prev).add(selectedId));
                                    }
                                    
                                    setTimeout(() => setIsExpandingBranch(false), 600);
                                }}
                                disabled={!selectedId || isExpandingBranch}
                                className={`w-9 h-9 flex items-center justify-center rounded-sm border transition-all ${selectedId ? (isExpandingBranch ? 'bg-amber-500 border-amber-500 text-white scale-95' : 'bg-white border-gold/40 text-primary shadow-sm hover:bg-gold/5 active:scale-90') : 'bg-stone/5 border-stone/10 text-stone/30 cursor-not-allowed opacity-50'}`}
                                title={openNodes.has(selectedId) ? "Thu gọn nhánh đang chọn" : "Mở rộng nhánh đang chọn"}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${isExpandingBranch ? 'animate-spin' : ''}`}>
                                    {isExpandingBranch ? 'sync' : (openNodes.has(selectedId) ? 'collapse_content' : 'expand_content')}
                                </span>
                            </button>
                            <button 
                                onClick={() => {
                                    setIsExpandingAll(true);
                                    if (isAllOpen) {
                                        treeRef.current?.closeAll();
                                        setIsAllOpen(false);
                                        setOpenNodes(new Set());
                                    } else {
                                        treeRef.current?.openAll();
                                        setIsAllOpen(true);
                                        // When opening all, we could mark all folders as open, but for toggle simplicity 
                                        // we just track the global state
                                    }
                                    setTimeout(() => setIsExpandingAll(false), 800);
                                }}
                                disabled={isExpandingAll}
                                className={`w-9 h-9 flex items-center justify-center transition-all shadow-sm rounded-sm border ${isExpandingAll ? 'bg-amber-600 border-amber-600 text-white' : (isAllOpen ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200' : 'bg-primary text-white border-primary hover:bg-umber hover:border-umber active:scale-90')}`}
                                title={isAllOpen ? "Thu gọn toàn bộ cây" : "Mở rộng toàn bộ cây"}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${isExpandingAll ? 'animate-spin' : ''}`}>
                                    {isExpandingAll ? 'sync' : (isAllOpen ? 'collapse_all' : 'expand_all')}
                                </span>
                            </button>

                            <div className="w-px h-5 bg-gold/10 mx-1 shrink-0"></div>

                            {/* Search Bar */}
                            <div className="relative w-full sm:max-w-md bg-white border border-gold/20 rounded-sm hover:border-gold/40 transition-colors focus-within:bg-white focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 shadow-sm flex items-center h-9">
                                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-stone">search</span>
                                <input 
                                    type="text" 
                                    placeholder="Tìm theo tên danh mục..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full h-full pl-9 pr-8 text-[12px] bg-transparent focus:outline-none rounded-sm font-medium placeholder:font-normal placeholder:italic placeholder:text-stone/40 transition-all font-body"
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-stone/40 hover:text-brick flex items-center justify-center p-0.5 bg-white rounded-full shadow-sm"
                                        title="Xóa tìm kiếm"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em] hidden sm:block shrink-0">
                            {treeData.length} danh mục đã khởi tạo
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 min-h-0 overflow-hidden pt-2">
                    <div className="category-content-grid">
                        {/* Tree View Section */}
                        <div className="category-panel relative flex h-full flex-col overflow-hidden rounded-sm border border-gold/10 bg-white shadow-sm">
                        <div className="flex-none px-4 py-3 bg-gold/5 border-b border-gold/10 flex justify-between items-center">
                            <h2 className="text-[11px] font-black uppercase tracking-[0.15em] text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined text-[16px]">account_tree</span>
                                Cấu Trúc Cây Danh Mục
                            </h2>
                            
                            <div className="flex items-center gap-2">
                                {isTreeOrderMode ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={saveTreeOrderDrafts}
                                            disabled={treeOrderSaving || !isTreeOrderDirty}
                                            className={`inline-flex h-8 items-center gap-1 rounded-sm border px-3 text-[10px] font-black uppercase tracking-[0.14em] transition-all ${
                                                treeOrderSaving
                                                    ? 'border-primary bg-primary text-white opacity-80'
                                                    : 'border-primary/20 bg-primary text-white hover:bg-umber hover:border-umber'
                                            }`}
                                        >
                                            <span className={`material-symbols-outlined text-[14px] ${treeOrderSaving ? 'animate-spin' : ''}`}>
                                                {treeOrderSaving ? 'sync' : 'save'}
                                            </span>
                                            Lưu STT
                                        </button>
                                        <button
                                            type="button"
                                            onClick={closeTreeOrderMode}
                                            disabled={treeOrderSaving}
                                            className="inline-flex h-8 items-center gap-1 rounded-sm border border-gold/20 bg-white px-3 text-[10px] font-black uppercase tracking-[0.14em] text-stone transition-all hover:border-gold/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                            Hủy
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={openTreeOrderMode}
                                        disabled={!canReorderTree || treeOrderSaving}
                                        className={`inline-flex h-8 items-center gap-1 rounded-sm border px-3 text-[10px] font-black uppercase tracking-[0.14em] transition-all ${
                                            canReorderTree && !treeOrderSaving
                                                ? 'border-primary/20 bg-white text-primary hover:border-primary hover:bg-primary/5'
                                                : 'border-gold/10 bg-stone/5 text-stone/35'
                                        }`}
                                        title={canReorderTree ? 'Mở chế độ sắp xếp theo số thứ tự' : 'Tắt tìm kiếm và bộ lọc trước khi sắp xếp'}
                                    >
                                        <span className="material-symbols-outlined text-[14px]">format_list_numbered</span>
                                        Sắp xếp số
                                    </button>
                                )}
                                <span className="hidden text-[9px] font-black uppercase tracking-widest italic text-stone/30 sm:block">
                                    {isTreeOrderMode
                                        ? (isTreeOrderDirty ? 'Nhập số theo từng cấp rồi lưu' : 'Nhập số theo từng cấp')
                                        : (canReorderTree ? 'Kéo thả để sắp xếp' : 'Tắt bộ lọc để sắp xếp')}
                                </span>
                            </div>
                        </div>

                        {selectedCategoryNode ? (
                            <div className="flex-none border-b border-gold/10 px-4 py-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                                            <span className="material-symbols-outlined text-[16px]">format_list_numbered</span>
                                            Sắp xếp danh mục con
                                        </h4>
                                        <p className="mt-1 text-[11px] leading-relaxed text-stone/55">
                                            Chọn số thứ tự cho các danh mục con trực tiếp của &quot;{selectedCategoryNode.text}&quot;, rồi lưu.
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={resetSelectedChildOrderDrafts}
                                            disabled={!isSelectedChildOrderDirty || selectedChildOrderSaving}
                                            className="rounded-sm border border-gold/15 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                                        >
                                            Hoàn tác STT con
                                        </button>
                                        <button
                                            type="button"
                                            onClick={saveSelectedChildOrder}
                                            disabled={selectedChildNodes.length === 0 || !isSelectedChildOrderDirty || selectedChildOrderSaving}
                                            className="rounded-sm bg-brick px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-umber disabled:opacity-40"
                                        >
                                            {selectedChildOrderSaving ? 'Đang lưu' : 'Lưu STT con'}
                                        </button>
                                    </div>
                                </div>

                                {selectedChildNodes.length === 0 ? (
                                    <div className="mt-3 rounded-sm border border-dashed border-gold/20 bg-stone/5 px-3 py-3 text-[11px] text-stone/50">
                                        Danh mục này hiện chưa có danh mục con trực tiếp để sắp xếp.
                                    </div>
                                ) : (
                                    <div className="mt-3 space-y-2">
                                        {selectedChildNodes.map((childNode) => {
                                            const currentPosition = selectedChildPositionMap[childNode.id] ?? '';
                                            const draftValue = selectedChildOrderDrafts[childNode.id] ?? currentPosition;
                                            const isActive = String(draftValue) !== String(currentPosition);

                                            return (
                                                <div
                                                    key={`child-order-${childNode.id}`}
                                                    className={`flex items-center gap-3 rounded-sm border px-3 py-2 transition-colors ${
                                                        isActive
                                                            ? 'border-amber-200 bg-amber-50/70'
                                                            : 'border-gold/10 bg-white'
                                                    }`}
                                                >
                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-[11px] font-black text-primary">
                                                        {currentPosition}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-[12px] font-bold text-primary">
                                                            {childNode.text}
                                                        </div>
                                                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-stone/50">
                                                            <span>ID: {childNode.id}</span>
                                                            {childNode.data?.slug ? <span>Slug: {childNode.data.slug}</span> : null}
                                                            <span className={Number(childNode.data?.status ?? 0) === 1 ? 'text-emerald-700' : 'text-stone-500'}>
                                                                {Number(childNode.data?.status ?? 0) === 1 ? 'Đang hiển thị' : 'Đang ẩn'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-stone/45">
                                                            STT
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={draftValue}
                                                            onChange={(event) => handleSelectedChildOrderDraftChange(childNode.id, event.target.value)}
                                                            disabled={selectedChildOrderSaving}
                                                            className="h-9 w-16 rounded-sm border border-gold/20 bg-white px-2 text-center text-[12px] font-bold text-primary outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:bg-stone-100"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : null}

                        {/* Column Headers */}
                        <div className="flex-none px-4 py-2 bg-gold/5 border-b border-gold/10 flex items-center">
                            <div className="flex items-center justify-center pl-2 pr-1">
                                <input 
                                    type="checkbox" 
                                    checked={selectedIds.size > 0 && selectedIds.size === filteredTreeData.length}
                                    onChange={(e) => handleBulkCheck(e.target.checked)}
                                    className="size-4 rounded-sm accent-primary cursor-pointer"
                                />
                            </div>
                            <div className="flex-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary/40 pl-11">Tên Danh Mục</div>
                            {isTreeOrderMode ? (
                                <div className="w-20 text-center text-[10px] font-black uppercase tracking-[0.2em] text-primary/60">
                                    STT
                                </div>
                            ) : null}
                            <div className="hidden">
                                <div className="min-w-[120px] max-w-[160px] text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 text-center">Bộ lọc</div>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-auto custom-scrollbar p-4">
                            {loading ? (
                                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                                    <span className="text-[11px] font-black text-stone/30 uppercase tracking-[0.2em]">Đang tải dữ liệu...</span>
                                </div>
                            ) : filteredTreeData.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center gap-3 opacity-30">
                                    <span className="material-symbols-outlined text-[60px]">search_off</span>
                                    <span className="text-[12px] font-bold italic uppercase tracking-widest">Không tìm thấy danh mục</span>
                                </div>
                            ) : (
                                    <Tree
                                        ref={treeRef}
                                        tree={filteredTreeData}
                                        rootId={0}
                                        canDrag={() => canReorderTree && !isTreeOrderMode && !treeOrderSaving}
                                        canDrop={(tree, { dragSourceId, dropTargetId }) => {
                                            if (!canReorderTree || isTreeOrderMode || treeOrderSaving) return false;

                                            if (dragSourceId === undefined || dragSourceId === null) {
                                                return undefined;
                                            }

                                            if (dragSourceId === dropTargetId) {
                                                return false;
                                            }

                                            if (isAncestor(tree, dragSourceId, dropTargetId)) {
                                                return false;
                                            }

                                            return undefined;
                                        }}
                                        sort={false}
                                        insertDroppableFirst={false}
                                        dropTargetOffset={35}
                                        render={(node, options) => (
                                            <CustomNode
                                                node={node}
                                                {...options}
                                                isDropTarget={options.isDropTarget}
                                                onEdit={handleEdit}
                                                onDelete={handleDelete}
                                                isSelected={selectedId === node.id}
                                                onSelect={(id) => setSelectedId(id)}
                                                isChecked={selectedIds.has(node.id)}
                                                onCheck={handleCheck}
                                                showOrderInput={isTreeOrderMode}
                                                orderValue={treeOrderDrafts[node.id] ?? siblingPositionMap[node.id] ?? ''}
                                                onOrderChange={handleTreeOrderDraftChange}
                                                orderDisabled={treeOrderSaving}
                                            />
                                        )}
                                        renderPlaceholder={(props) => <Placeholder {...props} />}
                                        dragPreviewRender={(monitorProps) => (
                                            <div className="bg-primary text-white px-4 py-2 font-ui font-bold shadow-xl border border-gold/30 rounded-sm scale-110 flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[18px]">drag_pan</span>
                                                {monitorProps.item.text}
                                            </div>
                                        )}
                                        onDrop={handleDrop}
                                        classes={{
                                            root: "w-full py-2",
                                            draggingSource: "opacity-30",
                                            dropTarget: "bg-primary/5 border-2 border-primary border-dashed !rounded-sm",
                                            placeholder: "relative h-0"
                                        }}
                                    />
                            )}
                        </div>

                        {false && (
                            <div className="absolute bottom-6 left-1/2 z-[100] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-[1.5rem] border border-white/10 bg-primary px-4 py-3 text-white shadow-[0_10px_40px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom duration-300">
                                <div className="flex items-center gap-3 border-r border-white/10 pr-4">
                                    <div className="text-xl font-bold text-gold">{selectedIds.size}</div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">đã chọn</div>
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-2">
                                    <button
                                        disabled={isBulkDeleting}
                                        onClick={handleBulkDelete}
                                        className="flex items-center gap-2 rounded-full bg-brick px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition-all hover:bg-[#8f2d1d] disabled:opacity-50"
                                    >
                                        <span className={`material-symbols-outlined text-[18px] ${isBulkDeleting ? 'animate-pulse' : ''}`}>delete</span>
                                        {isBulkDeleting ? 'Đang xóa' : 'Xóa'}
                                    </button>
                                </div>
                                <button 
                                    disabled={isBulkDeleting}
                                    onClick={() => setSelectedIds(new Set())}
                                    className="size-8 flex items-center justify-center rounded-full hover:bg-brick/20 text-white transition-all disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Update Form Area */}
                    <div className="category-panel min-w-0">
                        {isFormOpen ? (
                            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-gold/20 bg-white p-6 shadow-premium animate-in slide-in-from-right duration-300">
                                <div className="mb-6 flex-none border-b border-gold/10 pb-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h3 className="font-display font-bold text-lg text-primary uppercase italic">
                                                Cập Nhật
                                            </h3>
                                            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-stone/35">
                                                {formData.id ? 'Chỉnh sửa danh mục đang chọn' : 'Tạo mới danh mục'}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                        <button 
                                            type="submit" 
                                            form="category-form"
                                            className="bg-brick text-white font-ui text-[10px] font-bold uppercase tracking-widest px-4 py-2 hover:bg-umber transition-all shadow-md rounded-sm flex items-center gap-2 active:scale-95"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">save</span>
                                            {formData.id ? 'Lưu lại' : 'Tạo mới'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={closeCategoryForm}
                                            className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-full transition-all"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">close</span>
                                        </button>
                                    </div>
                                </div>
                                </div>
                                <div className="flex-1 overflow-auto custom-scrollbar">
                                    <form id="category-form" onSubmit={handleFormSubmit} className="space-y-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Tên danh mục</label>
                                            <input
                                                required
                                                type="text"
                                                value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                className="w-full bg-stone/5 border border-gold/10 p-3 text-sm focus:outline-none focus:border-primary font-body rounded-sm"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Danh mục cha</label>
                                            <select
                                                value={formData.parent_id}
                                                onChange={e => setFormData({ ...formData, parent_id: e.target.value })}
                                                className="w-full bg-stone/5 border border-gold/10 p-3 text-sm focus:outline-none focus:border-primary font-body rounded-sm appearance-none"
                                            >
                                                <option value="">-- Là Danh mục gốc --</option>
                                                {(() => {
                                                    const renderOptions = (parentId = 0, prefix = '') => {
                                                        return treeData
                                                            .filter(node => node.parent === parentId && !blockedParentIds.has(node.id))
                                                            .map(node => (
                                                                <React.Fragment key={node.id}>
                                                                    <option value={node.id}>
                                                                        {prefix}{node.text}
                                                                    </option>
                                                                    {renderOptions(node.id, prefix + '— ')}
                                                                </React.Fragment>
                                                            ));
                                                    };
                                                    return renderOptions();
                                                })()}
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Mô tả chi tiết</label>
                                            <textarea
                                                value={formData.description}
                                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                                className="w-full bg-stone/5 border border-gold/10 p-3 text-sm focus:outline-none focus:border-primary font-body h-32 resize-none rounded-sm"
                                            />
                                        </div>

                                        <div className="space-y-3 rounded-sm border border-gold/10 bg-gold/5 p-4">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-primary">San pham trong danh muc</label>
                                                    <p className="mt-1 text-[10px] leading-relaxed text-stone/55">
                                                        Chon san pham don, bien the hoac tung tuy chon bundle/combo de gan rieng cho danh muc nay.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => { setCategoryItemPickerMode('form'); setIsCategoryItemPickerOpen(true); }}
                                                    className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary/20 bg-white px-3 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-colors hover:border-primary hover:bg-primary/5"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">add_circle</span>
                                                    Chon san pham
                                                </button>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-primary">
                                                    {selectedCategoryItems.length} item da chon
                                                </span>
                                                {selectedCategoryItems.some((item) => item.item_type === 'bundle_option') ? (
                                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-700">
                                                        Co tuy chon bundle
                                                    </span>
                                                ) : null}
                                                {selectedCategoryItems.some((item) => item.display_type === 'variant' || item.is_variant_child) ? (
                                                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">
                                                        Co bien the
                                                    </span>
                                                ) : null}
                                            </div>

                                            {selectedCategoryItems.length === 0 ? (
                                                <div className="rounded-sm border border-dashed border-gold/20 bg-white/80 px-3 py-4 text-[11px] leading-relaxed text-stone/50">
                                                    Chua co item nao duoc gan vao danh muc nay. Bam "Chon san pham" de tim va them san pham, bien the hoac tuy chon bundle.
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {selectedCategoryItems.map((item) => (
                                                        <div
                                                            key={item.assignment_key}
                                                            className="rounded-sm border border-gold/10 bg-white px-3 py-3"
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <div className="truncate text-[12px] font-bold text-primary">
                                                                            {item.item_type === 'bundle_option'
                                                                                ? (item.bundle_option_title || item.name || 'Tuy chon bundle')
                                                                                : (item.name || 'San pham')}
                                                                        </div>
                                                                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${resolveCategoryItemBadgeClasses(item)}`}>
                                                                            {item.display_label || 'San pham'}
                                                                        </span>
                                                                        {item.is_removable === false ? (
                                                                            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-stone-500">
                                                                                Khoa boi danh muc chinh
                                                                            </span>
                                                                        ) : null}
                                                                    </div>

                                                                    {item.item_type === 'bundle_option' ? (
                                                                        <p className="mt-1 text-[11px] font-semibold text-primary/70">
                                                                            Bundle: {item.bundle_parent_name || 'San pham bundle'}
                                                                        </p>
                                                                    ) : item.variant_parent_name ? (
                                                                        <p className="mt-1 text-[11px] font-semibold text-primary/70">
                                                                            Thuoc: {item.variant_parent_name}
                                                                        </p>
                                                                    ) : null}

                                                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-stone/55">
                                                                        {item.sku ? <span>SKU: {item.sku}</span> : null}
                                                                        <span>ID: {item.product_id || '--'}</span>
                                                                        {item.item_type === 'bundle_option' && item.bundle_items_count > 0 ? (
                                                                            <span>{item.bundle_items_count} thanh phan</span>
                                                                        ) : null}
                                                                    </div>

                                                                    {item.item_type === 'bundle_option' && Array.isArray(item.bundle_items_summary) && item.bundle_items_summary.length > 0 ? (
                                                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                                                            {item.bundle_items_summary.slice(0, 3).map((summary, summaryIndex) => (
                                                                                <span
                                                                                    key={`${item.assignment_key}-form-summary-${summaryIndex}`}
                                                                                    className="inline-flex max-w-full items-center rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700"
                                                                                >
                                                                                    <span className="truncate">
                                                                                        {summary.name || 'San pham'}
                                                                                        {summary.sku ? ` - ${summary.sku}` : ''}
                                                                                    </span>
                                                                                </span>
                                                                            ))}
                                                                            {item.bundle_items_summary.length > 3 ? (
                                                                                <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold text-stone-500">
                                                                                    +{item.bundle_items_summary.length - 3}
                                                                                </span>
                                                                            ) : null}
                                                                        </div>
                                                                    ) : null}
                                                                </div>

                                                                {item.is_removable === false ? (
                                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500" title="Item nay dang khoa boi danh muc chinh">
                                                                        <span className="material-symbols-outlined text-[16px]">lock</span>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeFormCategoryItem(item.assignment_key)}
                                                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone/45 transition-colors hover:bg-brick/5 hover:text-brick"
                                                                        title="Go item khoi danh muc"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {false && (
                                        <div className="space-y-3 bg-gold/5 p-4 border border-gold/10 rounded-sm">
                                            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-primary">Bộ lọc thuộc tính</label>
                                                <span className="text-[9px] text-stone/40 italic">Chọn các thuộc tính hiển thị</span>
                                            </div>
                                            
                                            <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                                                {allAttributes.filter(a => a.entity_type === 'product').map(attr => (
                                                    <label key={attr.id} className="flex items-center gap-3 cursor-pointer group hover:bg-white/50 p-1.5 rounded transition-colors select-none">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={formData.filterable_attribute_ids?.some(id => Number(id) === Number(attr.id))}
                                                            onChange={e => {
                                                                const checked = e.target.checked;
                                                                setFormData(prev => {
                                                                    const currentList = Array.isArray(prev.filterable_attribute_ids) ? prev.filterable_attribute_ids : [];
                                                                    let newList;
                                                                    if (checked) {
                                                                        // Add as Number and ensure uniqueness
                                                                        newList = currentList.some(id => Number(id) === Number(attr.id))
                                                                            ? currentList
                                                                            : [...currentList, Number(attr.id)];
                                                                    } else {
                                                                        // Remove all instances via Number comparison
                                                                        newList = currentList.filter(id => Number(id) !== Number(attr.id));
                                                                    }
                                                                    return {
                                                                        ...prev,
                                                                        filterable_attribute_ids: newList
                                                                    };
                                                                });
                                                            }}
                                                            className="size-4 accent-primary rounded-sm shadow-sm"
                                                        />
                                                        <div className="flex flex-col">
                                                            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider group-hover:text-primary transition-colors leading-tight">{attr.name}</span>
                                                            <span className="text-[9px] text-slate-400 font-mono tracking-tighter uppercase leading-tight">{attr.code}</span>
                                                        </div>
                                                    </label>
                                                ))}
                                                {allAttributes.length === 0 && <div className="text-[10px] text-stone/40 italic py-2">Chưa có thuộc tính sản phẩm nào.</div>}
                                            </div>

                                            {/* Order selected attributes */}
                                            {formData.filterable_attribute_ids?.length > 1 && (
                                                <div className="mt-4 pt-3 border-t border-gold/10">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-primary mb-2 block">Thứ tự hiển thị ngoài web</label>
                                                    <div className="flex flex-col">
                                                        {formData.filterable_attribute_ids.map((id, idx) => {
                                                            const attr = allAttributes.find(a => Number(a.id) === Number(id));
                                                            if (!attr) return null;
                                                            return (
                                                                <DraggableAttributeItem 
                                                                    key={id}
                                                                    attrId={id}
                                                                    name={attr.name}
                                                                    index={idx}
                                                                    moveItem={(dragIndex, hoverIndex) => {
                                                                        setFormData(prev => {
                                                                            const newList = [...prev.filterable_attribute_ids];
                                                                            const draggedItem = newList[dragIndex];
                                                                            newList.splice(dragIndex, 1);
                                                                            newList.splice(hoverIndex, 0, draggedItem);
                                                                            return { ...prev, filterable_attribute_ids: newList };
                                                                        });
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    <p className="text-[9px] text-stone/40 italic mt-1">Kéo thả để thay đổi vị trí bộ lọc trên website</p>
                                                </div>
                                            )}
                                        </div>
                                        )}

                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between gap-3">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Logo nho danh muc</label>
                                                <span className="text-[9px] italic text-stone/40">Hien thi trong the danh muc ngoai web</span>
                                            </div>
                                            <div className="flex flex-col gap-3">
                                                {formData.logo_url && (
                                                    <div className="relative group/img flex h-32 items-center justify-center overflow-hidden rounded-sm border border-gold/10 bg-stone/5">
                                                        <img src={formData.logo_url} alt="Logo Preview" className="max-h-[88px] max-w-[88px] object-contain" />
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => document.getElementById('logo-upload').click()}
                                                                className="size-8 rounded-full bg-white text-primary hover:bg-gold transition-colors flex items-center justify-center"
                                                                title="Thay anh"
                                                            >
                                                                <span className="material-symbols-outlined text-sm">edit</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFormData({ ...formData, logo: null, logo_url: null })}
                                                                className="size-8 rounded-full bg-white text-brick hover:bg-brick hover:text-white transition-colors flex items-center justify-center"
                                                                title="Go anh"
                                                            >
                                                                <span className="material-symbols-outlined text-sm">delete</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                <input
                                                    id="logo-upload"
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={e => {
                                                        const file = e.target.files[0];
                                                        if (file) {
                                                            setFormData({ ...formData, logo: file, logo_url: URL.createObjectURL(file) });
                                                        }
                                                    }}
                                                />
                                                {!formData.logo_url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => document.getElementById('logo-upload').click()}
                                                        className="w-full h-20 border-2 border-dashed border-gold/20 hover:border-gold/40 hover:bg-gold/5 transition-all flex flex-col items-center justify-center gap-1 rounded-sm text-stone/40"
                                                    >
                                                        <span className="material-symbols-outlined text-xl">image</span>
                                                        <span className="text-[10px] font-bold uppercase tracking-wider">Tai len logo nho</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Ảnh banner danh mục</label>
                                            <div className="flex flex-col gap-3">
                                                {formData.banner_url && (
                                                    <div className="relative group/img w-full h-32 bg-stone/5 border border-gold/10 rounded-sm overflow-hidden">
                                                        <img src={formData.banner_url} alt="Banner Preview" className="w-full h-full object-cover" />
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                            <button 
                                                                type="button"
                                                                onClick={() => document.getElementById('banner-upload').click()}
                                                                className="size-8 rounded-full bg-white text-primary hover:bg-gold transition-colors flex items-center justify-center"
                                                                title="Thay ảnh"
                                                            >
                                                                <span className="material-symbols-outlined text-sm">edit</span>
                                                            </button>
                                                            <button 
                                                                type="button"
                                                                onClick={() => setFormData({ ...formData, banner: null, banner_url: null })}
                                                                className="size-8 rounded-full bg-white text-brick hover:bg-brick hover:text-white transition-colors flex items-center justify-center"
                                                                title="Gỡ ảnh"
                                                            >
                                                                <span className="material-symbols-outlined text-sm">delete</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                <input 
                                                    id="banner-upload"
                                                    type="file" 
                                                    accept="image/*"
                                                    className="hidden" 
                                                    onChange={e => {
                                                        const file = e.target.files[0];
                                                        if (file) {
                                                            setFormData({ ...formData, banner: file, banner_url: URL.createObjectURL(file) });
                                                        }
                                                    }}
                                                />
                                                {!formData.banner_url && (
                                                    <button 
                                                        type="button"
                                                        onClick={() => document.getElementById('banner-upload').click()}
                                                        className="w-full h-20 border-2 border-dashed border-gold/20 hover:border-gold/40 hover:bg-gold/5 transition-all flex flex-col items-center justify-center gap-1 rounded-sm text-stone/40"
                                                    >
                                                        <span className="material-symbols-outlined text-xl">upload_file</span>
                                                        <span className="text-[10px] font-bold uppercase tracking-wider">Tải lên ảnh banner</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                    </form>
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full min-h-0 flex-col rounded-sm border border-gold/10 bg-white p-6 shadow-sm">
                                <div className="flex-none border-b border-gold/10 pb-4">
                                    <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-primary italic">
                                        <span className="material-symbols-outlined text-[16px]">edit_square</span>
                                        Cập Nhật
                                    </h3>
                                    <p className="mt-2 text-[11px] leading-relaxed text-stone/55">
                                        Chọn một danh mục từ khối bên trái hoặc bấm nút thêm mới để bắt đầu chỉnh sửa.
                                    </p>
                                </div>
                                <div className="flex-1 overflow-auto custom-scrollbar">
                                    <div className="space-y-4 pt-4 pr-1">
                                        <div className="flex gap-3 items-start group">
                                            <div className="size-5 rounded flex items-center justify-center bg-gold/10 text-gold group-hover:bg-gold group-hover:text-white transition-all shrink-0">
                                                <span className="material-symbols-outlined text-[14px]">drag_indicator</span>
                                            </div>
                                            <p className="text-[12px] text-stone-600 font-body leading-relaxed transition-colors">Kéo và thả mục bất kỳ để thay đổi vị trí hiển thị.</p>
                                        </div>
                                        <div className="flex gap-3 items-start group">
                                            <div className="size-5 rounded flex items-center justify-center bg-gold/10 text-gold group-hover:bg-gold group-hover:text-white transition-all shrink-0">
                                                <span className="material-symbols-outlined text-[14px]">folder_zip</span>
                                            </div>
                                            <p className="text-[12px] text-stone-600 font-body leading-relaxed transition-colors">Thả một thư mục vào thư mục khác để thiết lập cha-con.</p>
                                        </div>
                                        <div className="pt-4 border-t border-gold/5 flex gap-3 items-start opacity-60 italic">
                                             <span className="material-symbols-outlined text-[16px] text-brick">warning</span>
                                             <p className="text-[11px] text-brick font-body">Xóa danh mục cha sẽ xóa toàn bộ con bên trong.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                        <div className="category-panel flex h-full min-h-[320px] flex-col overflow-hidden rounded-sm border border-gold/10 bg-white shadow-sm">
                            <div className="flex items-start justify-between gap-3 border-b border-gold/10 bg-gold/5 px-4 py-4">
                                <div>
                                    <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-primary flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                                        Sản phẩm trong danh mục
                                    </h3>
                                    <p className="mt-1 text-[11px] leading-relaxed text-stone/60">
                                        {selectedCategoryNode
                                            ? `Đang quản lí thứ tự hiển thị của "${selectedCategoryNode.text}".`
                                            : 'Chọn một danh mục ở cây bên trái để xem và sắp xếp sản phẩm.'}
                                    </p>
                                </div>

                                {selectedCategoryNode ? (
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCategoryItemPickerMode('direct');
                                                setIsCategoryItemPickerOpen(true);
                                            }}
                                            disabled={categoryProductsLoading || categoryProductsSaving}
                                            className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-40"
                                            title="Thêm sản phẩm vào danh mục"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">add_circle</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsCategorySortModalOpen(true)}
                                            disabled={categoryProductsLoading}
                                            className="flex h-9 items-center gap-2 rounded-sm border border-gold/15 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                                            title="Mở bảng sắp xếp sản phẩm"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">table_rows</span>
                                            Bảng sắp xếp
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(selectedCategoryNode)}
                                            className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary"
                                            title="Sửa danh mục đang chọn"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">edit</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => loadCategoryProducts(selectedId)}
                                            disabled={categoryProductsLoading || categoryProductsSaving}
                                            className="flex h-9 w-9 items-center justify-center rounded-sm border border-gold/15 text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                                            title="Tải lại danh sách sản phẩm"
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${(categoryProductsLoading || categoryProductsSaving) ? 'animate-spin' : ''}`}>refresh</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => loadCategoryProducts(selectedId)}
                                            disabled={!categoryProductsDirty || categoryProductsLoading || categoryProductsSaving}
                                            className="rounded-sm border border-gold/15 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-stone/60 transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                                        >
                                            Hoàn tác
                                        </button>
                                        <button
                                            type="button"
                                            onClick={saveCategoryProductOrder}
                                            disabled={!categoryProductsDirty || categoryProductsLoading || categoryProductsSaving}
                                            className="rounded-sm bg-brick px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-umber disabled:opacity-40"
                                        >
                                            {categoryProductsSaving ? 'Đang lưu' : 'Lưu thứ tự'}
                                        </button>
                                    </div>
                                ) : null}
                            </div>

                            {selectedCategoryNode ? (
                                <div className="flex flex-wrap items-center gap-2 border-b border-gold/10 px-4 py-3">
                                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-primary">
                                        {selectedCategoryMeta?.items_count ?? selectedCategoryMeta?.products_count ?? categoryProducts.length} item
                                    </span>
                                    <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${
                                        Number(selectedCategoryMeta?.status ?? selectedCategoryNode.data?.status ?? 0) === 1
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-stone-100 text-stone-500'
                                    }`}>
                                        {Number(selectedCategoryMeta?.status ?? selectedCategoryNode.data?.status ?? 0) === 1 ? 'Đang hiển thị' : 'Đang ẩn'}
                                    </span>
                                    {categoryProductsDirty ? (
                                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-700">
                                            Chưa lưu thay đổi
                                        </span>
                                    ) : (
                                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">
                                            Đồng bộ frontend
                                        </span>
                                    )}
                                </div>
                            ) : null}

                            <div className="flex-1 overflow-auto custom-scrollbar p-4">
                                {!selectedCategoryNode ? (
                                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center opacity-50">
                                        <span className="material-symbols-outlined text-[48px] text-stone/40">touch_app</span>
                                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                            Chọn một danh mục để bắt đầu
                                        </p>
                                        <p className="max-w-[280px] text-[12px] leading-relaxed text-stone/55">
                                            Sau khi chọn, bạn sẽ thấy ngay danh sách sản phẩm đang nằm trong danh mục đó và có thể kéo thả để đổi thứ tự.
                                        </p>
                                    </div>
                                ) : categoryProductsLoading ? (
                                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 opacity-40">
                                        <div className="h-9 w-9 animate-spin rounded-full border-b-2 border-primary"></div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone/50">
                                            Đang tải sản phẩm
                                        </p>
                                    </div>
                                ) : categoryProducts.length === 0 ? (
                                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center opacity-50">
                                        <span className="material-symbols-outlined text-[44px] text-stone/40">inventory</span>
                                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-stone/50">
                                            Danh mục này chưa có sản phẩm
                                        </p>
                                        <p className="max-w-[280px] text-[12px] leading-relaxed text-stone/55">
                                            Khi sản phẩm đã được gắn vào danh mục, danh sách sẽ xuất hiện tại đây để bạn sắp xếp thứ tự hiển thị ngoài frontend.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {categoryProducts.map((product, index) => (
                                            <CategoryProductRow
                                                key={product.assignment_key}
                                                product={product}
                                                index={index}
                                                isFirst={index === 0}
                                                isLast={index === categoryProducts.length - 1}
                                                isDragging={draggingProductId === product.assignment_key}
                                                isDropTarget={dragOverProductId === product.assignment_key && draggingProductId !== product.assignment_key}
                                                onDragStart={handleCategoryProductDragStart}
                                                onDragEnter={setDragOverProductId}
                                                onDrop={handleCategoryProductDrop}
                                                onDragEnd={() => {
                                                    resetCategoryProductDragState();
                                                }}
                                                onMoveUp={() => moveCategoryProductByOffset(product.assignment_key, -1)}
                                                onMoveDown={() => moveCategoryProductByOffset(product.assignment_key, 1)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>

                            {selectedCategoryNode ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gold/10 px-4 py-3 text-[10px] text-stone/50">
                                    <span>Kéo thả hoặc dùng nút lên/xuống, sau đó bấm "Lưu thứ tự".</span>
                                    <span className="font-bold uppercase tracking-[0.14em]">
                                        Frontend dùng đúng thứ tự này
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
            <CategoryItemPickerModal
                open={isCategoryItemPickerOpen}
                onClose={closeCategoryItemPicker}
                searchQuery={categoryItemSearchQuery}
                onSearchChange={setCategoryItemSearchQuery}
                groups={categoryItemPickerGroups}
                selectedItemMap={categoryItemPickerMode === 'direct' ? directSelectedItemMap : selectedCategoryItemMap}
                onToggleItem={categoryItemPickerMode === 'direct' ? toggleDirectCategoryItem : toggleFormCategoryItem}
                isLoading={categoryItemSearchLoading}
            />
            <CategoryProductSortModal
                open={isCategorySortModalOpen}
                onClose={closeCategorySortModal}
                category={selectedCategoryMeta}
                products={categoryProducts}
                isLoading={categoryProductsLoading}
                isSaving={categoryProductsSaving}
                isDirty={categoryProductsDirty}
                draggingProductId={draggingProductId}
                dragOverProductId={dragOverProductId}
                onDragStart={handleCategoryProductDragStart}
                onDragEnter={setDragOverProductId}
                onDrop={handleCategoryProductDrop}
                onDragEnd={resetCategoryProductDragState}
                onMoveUp={(productId) => moveCategoryProductByOffset(productId, -1)}
                onMoveDown={(productId) => moveCategoryProductByOffset(productId, 1)}
                onMoveToPosition={moveCategoryProductToPosition}
                onRefresh={() => loadCategoryProducts(selectedId)}
                onReset={() => loadCategoryProducts(selectedId)}
                onSave={saveCategoryProductOrder}
            />
        </DndProvider>
    );
};

export default CategoryList;
