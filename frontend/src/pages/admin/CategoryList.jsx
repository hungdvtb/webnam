import React, { useState, useEffect, useRef } from 'react';
import { categoryApi, attributeApi } from '../../services/api';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Tree } from '@minoru/react-dnd-treeview';

const CustomNode = ({ node, depth, isOpen, onToggle, onEdit, onDelete, isSelected, onSelect, isCheckable, isChecked, onCheck, isDropTarget, allAttributes }) => {
    const layoutLabel = node.data?.display_layout === 'layout_2' ? 'Giao diện 2' : 'Giao diện 1';
    const layoutIcon = node.data?.display_layout === 'layout_2' ? 'view_quilt' : 'view_compact';
    
    // Get filter labels
    const filterIds = node.data?.filterable_attribute_ids || [];
    const filterCount = Array.isArray(filterIds) ? filterIds.length : 0;
    
    // Get all names of filters - Ensure ID comparison handles both string and number
    const filterDisplay = [...new Set(filterIds
        .map(id => {
            const attr = allAttributes.find(a => Number(a.id) === Number(id));
            return attr ? attr.name : null;
        })
        .filter(Boolean))]
        .join(', ') || 'Không có';

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

            {/* Layout & Filter Info */}
            <div className="hidden md:flex items-center gap-6 mr-8">
                {/* Layout Column */}
                <div className="flex flex-col items-center justify-center gap-0.5 w-32 border-x border-gold/5 px-2">
                    <span className="material-symbols-outlined text-[16px] text-primary/40">{layoutIcon}</span>
                    <span className="text-[10px] font-bold uppercase tracking-tight text-primary/60 whitespace-nowrap">{layoutLabel}</span>
                </div>

                {/* Filters Column */}
                <div className="flex flex-col items-center justify-center gap-0.5 min-w-[200px] max-w-[300px] px-2">
                    <span className="material-symbols-outlined text-[16px] text-primary/40">filter_alt</span>
                    <span className={`text-[10px] font-bold tracking-tight uppercase text-center leading-tight ${filterCount > 0 ? 'text-umber' : 'text-stone/20 italic'}`}>
                        {filterDisplay}
                    </span>
                </div>
            </div>

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

const CategoryList = () => {
    const [treeData, setTreeData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterLevel, setFilterLevel] = useState('all'); // 'all', 'root', 'child'
    const [filterStatus, setFilterStatus] = useState('all'); // 'all', '1', '0'
    const [filterLayout, setFilterLayout] = useState('all'); // 'all', 'layout_1', 'layout_2'
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const filterRef = React.useRef(null);
    const treeRef = React.useRef(null);
    const [selectedId, setSelectedId] = useState(null);
    const [isExpandingBranch, setIsExpandingBranch] = useState(false);
    const [isExpandingAll, setIsExpandingAll] = useState(false);
    const [isAllOpen, setIsAllOpen] = useState(false);
    const [openNodes, setOpenNodes] = useState(new Set());
    const [formData, setFormData] = useState({ 
        id: null, name: '', description: '', parent_id: '', status: 1, 
        banner: null, banner_url: null, display_layout: 'layout_1',
        filterable_attribute_ids: []
    });
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isBulkUpdating, setIsBulkUpdating] = useState(false);
    const [allAttributes, setAllAttributes] = useState([]);

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

        // Apply Layout filter
        if (filterLayout === 'layout_1') {
            matchedNodes = matchedNodes.filter(n => n.data.display_layout === 'layout_1' || !n.data.display_layout);
        } else if (filterLayout === 'layout_2') {
            matchedNodes = matchedNodes.filter(n => n.data.display_layout === 'layout_2');
        }

        // Apply Search Query
        if (searchQuery.trim()) {
            const lowerQuery = searchQuery.toLowerCase();
            matchedNodes = matchedNodes.filter(node => node.text.toLowerCase().includes(lowerQuery));
        }
        
        // If no filter is applied, return full tree
        if (!searchQuery.trim() && filterLevel === 'all' && filterStatus === 'all' && filterLayout === 'all') {
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
    }, [treeData, searchQuery, filterLevel, filterStatus, filterLayout]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [catRes, attrRes] = await Promise.all([
                categoryApi.getAll(),
                attributeApi.getAll() // Fetch all to ensure names show even if inactive in this view
            ]);
            
            // Format categories for tree
            const formattedData = catRes.data.map(cat => ({
                id: cat.id,
                parent: cat.parent_id || 0,
                text: cat.name,
                droppable: true,
                data: cat
            }));
            setTreeData(formattedData);

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
            const formattedData = res.data.map(cat => ({
                id: cat.id,
                parent: cat.parent_id || 0,
                text: cat.name,
                droppable: true,
                data: cat
            }));
            setTreeData(formattedData);
        } catch (error) {
            console.error('Error fetching categories:', error);
        }
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isFormOpen) {
                setIsFormOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFormOpen]);

    const handleDrop = async (newTree, options) => {
        if (searchQuery.trim() || filterLevel !== 'all' || filterStatus !== 'all' || filterLayout !== 'all') return; // Disable reorder when filtered

        setTreeData(newTree); // Optimistic UI update

        // Prepare items array for backend: [{ id: 1, parent_id: 0, order: 0 }, ...]
        const itemsToUpdate = newTree.map((node, index) => ({
            id: node.id,
            parent_id: node.parent === 0 ? null : node.parent,
            order: index
        }));

        try {
            await categoryApi.reorder(itemsToUpdate);
        } catch (error) {
            console.error("Lỗi khi lưu vị trí danh mục:", error);
            alert("Lỗi khi lưu cập nhật phân cấp.");
            fetchCategories(); // Revert on error
        }
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        try {
            const data = new FormData();
            data.append('name', formData.name);
            data.append('description', formData.description || '');
            
            // Only append parent_id if it's not root (0 or empty)
            if (formData.parent_id && formData.parent_id !== '0' && formData.parent_id !== '') {
                data.append('parent_id', formData.parent_id);
            }
            
            data.append('status', formData.status);
            data.append('display_layout', formData.display_layout);
            
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

            if (formData.id) {
                await categoryApi.update(formData.id, data);
            } else {
                await categoryApi.store(data);
            }
            setIsFormOpen(false);
            setFormData({ 
                id: null, name: '', description: '', parent_id: '', status: 1, 
                banner: null, banner_url: null, display_layout: 'layout_1',
                filterable_attribute_ids: []
            });
            fetchCategories();
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

    const handleEdit = (node) => {
        const cat = node.data;
        let bannerUrl = null;
        if (cat.banner_path) {
            const cleanPath = cat.banner_path.replace(/^\/+/, '');
            // If it already contains http/https, use it as is
            if (cleanPath.startsWith('http')) {
                bannerUrl = cleanPath;
            } else {
                // Remove 'storage/' if it's already at the beginning to avoid duplication
                const finalPath = cleanPath.startsWith('storage/') ? cleanPath.substring(8) : cleanPath;
                bannerUrl = `http://localhost:8003/storage/${finalPath}`;
            }
        }

        setFormData({
            id: cat.id,
            name: cat.name,
            description: cat.description || '',
            parent_id: cat.parent_id || '',
            status: cat.status,
            banner: cat.banner_path,
            banner_url: bannerUrl,
            display_layout: cat.display_layout || 'layout_1',
            filterable_attribute_ids: (cat.filterable_attribute_ids || []).map(id => Number(id))
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

    const handleBulkUpdateLayout = async (layout) => {
        if (selectedIds.size === 0) return;
        
        setIsBulkUpdating(true);
        try {
            await categoryApi.bulkUpdateLayout({
                ids: Array.from(selectedIds),
                display_layout: layout
            });
            alert(`Đã cập nhật giao diện ${layout === 'layout_1' ? '1' : '2'} cho ${selectedIds.size} danh mục.`);
            setSelectedIds(new Set());
            fetchCategories();
        } catch (error) {
            console.error("Bulk update error:", error);
            alert("Lỗi khi cập nhật giao diện hàng loạt.");
        } finally {
            setIsBulkUpdating(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-stone">Đang tải danh sách...</div>;

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

                    {/* Toolbar */}
                    <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                        <div className="flex gap-1.5 items-center w-full max-w-3xl">
                            <button
                                onClick={() => { setFormData({ id: null, name: '', description: '', parent_id: '', status: 1 }); setIsFormOpen(true); }}
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

                            <div className="w-px h-5 bg-gold/10 mx-1 shrink-0"></div>

                            {/* Filter Button */}
                            <div className="relative shrink-0">
                                <button 
                                    data-filter-btn
                                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                                    className={`flex w-9 h-9 items-center justify-center rounded-sm border transition-all ${(filterLevel !== 'all' || filterStatus !== 'all' || filterLayout !== 'all') ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-white border-gold/20 text-stone hover:border-gold/40 hover:text-primary shadow-sm'}`}
                                    title="Bộ lọc nâng cao"
                                >
                                    <span className="material-symbols-outlined text-[18px]">{(filterLevel !== 'all' || filterStatus !== 'all' || filterLayout !== 'all') ? 'filter_alt' : 'filter_list'}</span>
                                </button>
                                
                                {showFilterMenu && (
                                    <div ref={filterRef} className="absolute left-0 top-full mt-2 w-64 bg-white rounded-sm shadow-[0_0_20px_rgba(0,0,0,0.1)] border border-gold/20 z-50 animate-in fade-in zoom-in-95 duration-200">
                                        <div className="p-3 border-b border-gold/10">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                                                    <span className="material-symbols-outlined text-[14px]">tune</span>
                                                    Tùy chọn lọc
                                                </span>
                                                {(filterLevel !== 'all' || filterStatus !== 'all' || filterLayout !== 'all') && (
                                                    <button 
                                                        onClick={() => { setFilterLevel('all'); setFilterStatus('all'); setFilterLayout('all'); }} 
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
                                                    <option value="root">Chỉ danh mục cha (Gốc)</option>
                                                    <option value="child">Chỉ danh mục con</option>
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
                                                    <option value="0">Đang bị ẩn</option>
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Kiểu giao diện</label>
                                                <select 
                                                    value={filterLayout} 
                                                    onChange={(e) => setFilterLayout(e.target.value)}
                                                    className="w-full bg-stone/5 border border-gold/10 p-2.5 text-[12px] focus:outline-none focus:border-primary font-body rounded-sm"
                                                >
                                                    <option value="all">Tất cả kiểu</option>
                                                    <option value="layout_1">Giao diện 1 (Mặc định)</option>
                                                    <option value="layout_2">Giao diện 2 (Có lọc)</option>
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
                <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                    {/* Tree View Section */}
                    <div className="lg:col-span-8 bg-white border border-gold/10 rounded-sm shadow-sm flex flex-col overflow-hidden relative">
                        <div className="flex-none px-4 py-3 bg-gold/5 border-b border-gold/10 flex justify-between items-center">
                            <h2 className="text-[11px] font-black uppercase tracking-[0.15em] text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined text-[16px]">account_tree</span>
                                Cấu Trúc Cây Danh Mục
                            </h2>
                            
                            <span className="text-[9px] font-black text-stone/30 uppercase tracking-widest italic hidden sm:block">Kéo thả để sắp xếp</span>
                        </div>

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
                            <div className="hidden md:flex items-center gap-6 mr-20">
                                <div className="w-32 text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 text-center">Giao diện</div>
                                <div className="min-w-[200px] max-w-[300px] text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 text-center">Bộ lọc thuộc tính</div>
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
                                        canDrag={() => !searchQuery.trim() && filterLevel === 'all' && filterStatus === 'all' && filterLayout === 'all'}
                                        canDrop={(tree, { dragSource, dropTargetId, isDirectChild }) => {
                                            if (searchQuery.trim() || filterLevel !== 'all' || filterStatus !== 'all' || filterLayout !== 'all') return false;
                                            return true;
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
                                                allAttributes={allAttributes}
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

                        {/* Bulk Action Bar */}
                        {selectedIds.size > 0 && (
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-primary dark:bg-slate-900 text-white px-6 py-4 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.3)] flex items-center gap-6 animate-in slide-in-from-bottom duration-300 z-[100] border border-white/10">
                                <div className="flex items-center gap-3 pr-6 border-r border-white/10">
                                    <div className="text-xl font-bold text-gold">{selectedIds.size}</div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">đã chọn</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mr-2">Cập nhật giao diện:</span>
                                    <button 
                                        disabled={isBulkUpdating}
                                        onClick={() => handleBulkUpdateLayout('layout_1')}
                                        className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full transition-all text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">view_compact</span>
                                        Giao diện 1
                                    </button>
                                    <button 
                                        disabled={isBulkUpdating}
                                        onClick={() => handleBulkUpdateLayout('layout_2')}
                                        className="flex items-center gap-2 bg-gold text-primary hover:bg-white px-4 py-2 rounded-full transition-all text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">view_quilt</span>
                                        Giao diện 2
                                    </button>
                                </div>
                                <button 
                                    onClick={() => setSelectedIds(new Set())}
                                    className="ml-4 size-8 flex items-center justify-center rounded-full hover:bg-brick/20 text-white transition-all"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Right side Form Area */}
                    <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden">
                        {isFormOpen ? (
                            <div className="bg-white border border-gold/20 shadow-premium p-6 rounded-sm animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden">
                                <div className="flex-none flex justify-between items-center border-b border-gold/10 pb-4 mb-6">
                                    <h3 className="font-display font-bold text-lg text-primary uppercase italic">
                                        {formData.id ? 'Cập Nhật' : 'Tạo Mới'}
                                    </h3>
                                    <div className="flex items-center gap-2">
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
                                            onClick={() => setIsFormOpen(false)}
                                            className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-full transition-all"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">close</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-auto custom-scrollbar">
                                    <form id="category-form" onSubmit={handleFormSubmit} className="space-y-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Tên danh mục</label>
                                            <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-sm focus:outline-none focus:border-primary font-body rounded-sm" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Danh mục cha</label>
                                            <select value={formData.parent_id} onChange={e => setFormData({ ...formData, parent_id: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-sm focus:outline-none focus:border-primary font-body rounded-sm appearance-none">
                                                <option value="">-- Là Danh mục gốc --</option>
                                                {(() => {
                                                    const renderOptions = (parentId = 0, prefix = '') => {
                                                        return treeData
                                                            .filter(node => node.parent === parentId && node.id !== formData.id)
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
                                            <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full bg-stone/5 border border-gold/10 p-3 text-sm focus:outline-none focus:border-primary font-body h-32 resize-none rounded-sm"></textarea>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Kiểu hiển thị (Layout)</label>
                                            <div className="grid grid-cols-2 gap-3">
                                                <button 
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, display_layout: 'layout_1' })}
                                                    className={`p-3 border rounded-sm flex flex-col items-center gap-2 transition-all ${formData.display_layout === 'layout_1' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-gold/10 bg-white hover:border-gold/30'}`}
                                                >
                                                    <span className="material-symbols-outlined text-2xl text-stone/40">view_compact</span>
                                                    <span className={`text-[10px] font-black uppercase tracking-widest ${formData.display_layout === 'layout_1' ? 'text-primary' : 'text-stone/40'}`}>Giao diện 1</span>
                                                </button>
                                                <button 
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, display_layout: 'layout_2' })}
                                                    className={`p-3 border rounded-sm flex flex-col items-center gap-2 transition-all ${formData.display_layout === 'layout_2' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-gold/10 bg-white hover:border-gold/30'}`}
                                                >
                                                    <span className="material-symbols-outlined text-2xl text-stone/40">view_quilt</span>
                                                    <span className={`text-[10px] font-black uppercase tracking-widest ${formData.display_layout === 'layout_2' ? 'text-primary' : 'text-stone/40'}`}>Giao diện 2</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-3 bg-gold/5 p-4 border border-gold/10 rounded-sm">
                                            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-primary">Bộ lọc thuộc tính (Chỉ Layout 2)</label>
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
                            <div className="bg-white border border-gold/10 p-6 shadow-sm rounded-sm">
                                <h3 className="text-[11px] font-black text-primary uppercase tracking-[0.2em] border-b border-gold/10 pb-4 mb-4 flex items-center gap-2 italic">
                                    <span className="material-symbols-outlined text-[16px]">info</span>
                                    Thao tác nhanh
                                </h3>
                                <div className="space-y-4">
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
                        )}
                    </div>
                </div>
            </div>
        </DndProvider>
    );
};

export default CategoryList;
