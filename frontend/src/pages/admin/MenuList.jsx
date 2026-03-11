import React, { useState, useEffect } from 'react';
import { menuApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Tree } from '@minoru/react-dnd-treeview';

const CustomNode = ({ node, depth, isOpen, onToggle, onEdit, onDelete }) => {
    return (
        <div style={{ paddingLeft: depth * 24 }} className="flex items-center gap-3 w-full py-3 hover:bg-gold/5 pr-4 border-b border-gold/10 group animate-fade-in">
            <div className="flex-1 flex items-center gap-2 cursor-pointer" onClick={node.droppable ? onToggle : undefined}>
                <div className="size-6 flex items-center justify-center">
                    {node.droppable && (
                        <span className="material-symbols-outlined text-stone text-xs transition-transform duration-300" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                            chevron_right
                        </span>
                    )}
                </div>
                <span className="material-symbols-outlined text-gold text-lg">
                    {node.data?.icon || (node.droppable ? 'folder' : 'link')}
                </span>
                <div className="flex flex-col">
                    <span className="font-ui text-[13px] font-bold text-primary uppercase tracking-wider">{node.text}</span>
                    <span className="text-[10px] text-stone font-body truncate max-w-[200px]">{node.data?.url || '#'}</span>
                </div>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => onEdit(node)} className="size-8 border border-gold/20 text-stone hover:text-primary hover:border-primary transition-all flex items-center justify-center rounded-sm">
                    <span className="material-symbols-outlined text-sm">edit</span>
                </button>
                <button onClick={() => onDelete(node)} className="size-8 border border-brick/20 text-stone hover:text-brick hover:border-brick transition-all flex items-center justify-center rounded-sm">
                    <span className="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
    );
};

const MenuList = () => {
    const [menus, setMenus] = useState([]);
    const [selectedMenu, setSelectedMenu] = useState(null);
    const [treeData, setTreeData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isMenuFormOpen, setIsMenuFormOpen] = useState(false);
    const [isItemFormOpen, setIsItemFormOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const { showModal } = useUI();

    const [menuFormData, setMenuFormData] = useState({ id: null, name: '', code: '', is_active: true });
    const [itemFormData, setItemFormData] = useState({ id: null, title: '', url: '', target: '_self', icon: '', children: [] });

    const fetchMenus = async () => {
        setLoading(true);
        try {
            const res = await menuApi.getAll();
            setMenus(res.data);
        } catch (error) {
            console.error('Error fetching menus:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchMenuDetails = async (id) => {
        try {
            const res = await menuApi.getOne(id);
            const menu = res.data;
            setSelectedMenu(menu);

            // Flatten nested items for the Tree component
            const flattened = flattenItems(menu.root_items || []);
            setTreeData(flattened);
        } catch (error) {
            console.error('Error fetching menu items:', error);
        }
    };

    const flattenItems = (items, parentId = 0) => {
        let result = [];
        items.forEach(item => {
            result.push({
                id: item.id,
                parent: parentId,
                text: item.title,
                droppable: true,
                data: item
            });
            if (item.children && item.children.length > 0) {
                result = result.concat(flattenItems(item.children, item.id));
            }
        });
        return result;
    };

    const unflattenItems = (flatData) => {
        const map = {};
        const roots = [];
        flatData.forEach((node, index) => {
            map[node.id] = { ...node.data, title: node.text, order: index, children: [] };
        });
        flatData.forEach(node => {
            if (node.parent === 0) {
                roots.push(map[node.id]);
            } else if (map[node.parent]) {
                map[node.parent].children.push(map[node.id]);
            }
        });
        return roots;
    };

    useEffect(() => {
        fetchMenus();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (isMenuFormOpen) setIsMenuFormOpen(false);
                if (isItemFormOpen) setIsItemFormOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMenuFormOpen, isItemFormOpen]);

    const handleMenuSubmit = async (e) => {
        e.preventDefault();
        try {
            if (menuFormData.id) {
                await menuApi.update(menuFormData.id, menuFormData);
                showModal({ title: 'Thành công', content: 'Đã cập nhật thông tin menu.', type: 'success' });
            } else {
                await menuApi.store(menuFormData);
                showModal({ title: 'Thành công', content: 'Đã tạo menu mới.', type: 'success' });
            }
            setIsMenuFormOpen(false);
            fetchMenus();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể lưu menu.', type: 'error' });
        }
    };

    const handleSaveItems = async () => {
        if (!selectedMenu) return;
        setSaving(true);
        try {
            const nestedItems = unflattenItems(treeData);
            await menuApi.saveItems(selectedMenu.id, nestedItems);
            showModal({ title: 'Thành công', content: 'Đã lưu cấu trúc menu.', type: 'success' });
            fetchMenuDetails(selectedMenu.id);
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể lưu cấu trúc.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleItemSubmit = (e) => {
        e.preventDefault();
        const newItem = { ...itemFormData };

        if (itemFormData._internalId) {
            // Updating existing item in tree
            setTreeData(treeData.map(node =>
                node.id === itemFormData._internalId
                    ? { ...node, text: newItem.title, data: { ...node.data, ...newItem } }
                    : node
            ));
        } else {
            // Adding new item
            const id = 'new_' + Math.random();
            const newNode = {
                id: id,
                parent: 0,
                text: newItem.title,
                droppable: true,
                data: { ...newItem, id: null } // id: null so backend creates new
            };
            setTreeData([...treeData, newNode]);
        }
        setIsItemFormOpen(false);
        setItemFormData({ id: null, title: '', url: '', target: '_self', icon: '', children: [] });
    };

    const handleDeleteMenu = (id) => {
        showModal({
            title: 'Xóa Menu',
            content: 'Bạn có chắc muốn xóa menu này? Tất cả các mục bên trong sẽ bị mất.',
            type: 'warning',
            actionText: 'Xóa',
            onAction: async () => {
                try {
                    await menuApi.destroy(id);
                    setMenus(menus.filter(m => m.id !== id));
                    if (selectedMenu?.id === id) setSelectedMenu(null);
                } catch (error) {
                    showModal({ title: 'Lỗi', content: 'Không thể xóa.', type: 'error' });
                }
            }
        });
    };

    const handleDrop = (newTree) => setTreeData(newTree);

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
                        .tree-root {
                            height: 100%;
                            overflow-y: auto;
                        }
                    `}
                </style>

                {/* Header Area */}
                <div className="flex-none bg-[#fcfcfa] pb-4">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-display font-bold text-primary italic">Menu & Điều hướng</h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Quản lý cấu trúc cây thư mục và liên kết hệ thống</p>
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                        <div className="flex gap-1.5 items-center">
                            <button
                                onClick={() => { setMenuFormData({ id: null, name: '', code: '', is_active: true }); setIsMenuFormOpen(true); }}
                                className="bg-primary text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                                title="Thêm Menu mới"
                            >
                                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                            </button>
                            <button
                                onClick={fetchMenus}
                                className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                                title="Làm mới"
                                disabled={loading}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            </button>
                        </div>
                        <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                            {menus.length} tập hợp menu liên kết
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex gap-6 min-h-0 overflow-hidden">
                    {/* Left Panel: Menu List */}
                    <div className="w-80 flex flex-col bg-white border border-gold/10 rounded-sm shadow-sm overflow-hidden">
                        <div className="px-5 py-3 bg-stone/5 border-b border-gold/10 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-primary">list_alt</span>
                            <span className="text-[11px] font-black uppercase tracking-widest text-primary">Danh sách Menu</span>
                        </div>
                        <div className="flex-1 overflow-auto custom-scrollbar divide-y divide-gold/5">
                            {loading ? (
                                <div className="py-20 text-center">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                                </div>
                            ) : menus.length === 0 ? (
                                <div className="py-20 text-center text-stone/30 font-bold uppercase tracking-widest text-[9px] italic">Chưa có menu</div>
                            ) : (
                                menus.map(menu => (
                                    <div 
                                        key={menu.id} 
                                        className={`px-5 py-4 cursor-pointer group transition-all relative ${selectedMenu?.id === menu.id ? 'bg-[#fcf8f1]' : 'hover:bg-gold/5'}`}
                                        onClick={() => fetchMenuDetails(menu.id)}
                                    >
                                        {selectedMenu?.id === menu.id && <div className="absolute inset-y-0 left-0 w-1 bg-primary"></div>}
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between">
                                                <span className={`font-bold text-[14px] truncate leading-tight transition-colors ${selectedMenu?.id === menu.id ? 'text-primary' : 'text-stone/60 group-hover:text-primary'}`}>
                                                    {menu.name}
                                                </span>
                                                {menu.is_active && <div className="size-1.5 bg-primary rounded-full shadow-[0_0_8px_rgba(182,143,84,0.6)]"></div>}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[9px] font-mono text-stone/30 uppercase tracking-tighter">Code: {menu.code}</span>
                                                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={(e) => { e.stopPropagation(); setMenuFormData(menu); setIsMenuFormOpen(true); }} className="text-stone/30 hover:text-primary transition-colors">
                                                        <span className="material-symbols-outlined text-[14px]">settings</span>
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteMenu(menu.id); }} className="text-stone/30 hover:text-brick transition-colors">
                                                        <span className="material-symbols-outlined text-[14px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Right Panel: Detail & Items Tree */}
                    <div className="flex-1 flex flex-col bg-white border border-gold/10 rounded-sm shadow-sm overflow-hidden min-w-0">
                        {selectedMenu ? (
                            <>
                                <div className="px-6 py-4 border-b border-gold/10 flex items-center justify-between bg-white shrink-0">
                                    <div className="flex flex-col min-w-0">
                                        <div className="flex items-center gap-3">
                                            <h2 className="font-display text-lg font-bold text-primary uppercase italic truncate whitespace-nowrap">{selectedMenu.name}</h2>
                                            <div className="h-4 w-px bg-gold/20"></div>
                                            <span className="text-[10px] text-stone/40 font-black uppercase tracking-widest hidden sm:block">Hierarchy Management</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 px-1">
                                        <button 
                                            onClick={() => { setItemFormData({ id: null, title: '', url: '', target: '_self', icon: '', children: [] }); setIsItemFormOpen(true); }} 
                                            className="px-3 py-1.5 bg-[#fcf8f1] border border-gold/20 text-primary hover:bg-gold/10 transition-all font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 rounded-[2px]"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">add</span> Root Item
                                        </button>
                                        <button 
                                            onClick={handleSaveItems} 
                                            disabled={saving} 
                                            className="px-5 py-1.5 bg-primary text-white hover:bg-umber transition-all font-black text-[9px] uppercase tracking-widest shadow-sm flex items-center gap-1.5 rounded-[2px] disabled:opacity-50"
                                        >
                                            {saving ? <span className="animate-spin size-3.5 border-2 border-white/20 border-t-white rounded-full"></span> : <span className="material-symbols-outlined text-[16px]">save</span>}
                                            Sync structure
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-auto custom-scrollbar p-6 bg-stone/5">
                                    <div className="bg-white border border-gold/10 shadow-sm min-h-full">
                                        <Tree
                                            tree={treeData}
                                            rootId={0}
                                            render={(node, { depth, isOpen, onToggle }) => (
                                                <CustomNode
                                                    node={node}
                                                    depth={depth}
                                                    isOpen={isOpen}
                                                    onToggle={onToggle}
                                                    onEdit={(node) => {
                                                        setItemFormData({ ...node.data, _internalId: node.id });
                                                        setIsItemFormOpen(true);
                                                    }}
                                                    onDelete={(node) => {
                                                        showModal({
                                                            title: 'Xác nhận xóa',
                                                            content: `Xóa mục "${node.text}" và tất cả con của nó?`,
                                                            type: 'warning',
                                                            actionText: 'Xóa',
                                                            onAction: () => setTreeData(treeData.filter(n => n.id !== node.id && n.parent !== node.id))
                                                        });
                                                    }}
                                                />
                                            )}
                                            onDrop={handleDrop}
                                            classes={{ root: "tree-root pb-40", draggingSource: "opacity-30 grayscale blur-[1px]", placeholder: "bg-gold/10 h-10 border-2 border-dashed border-gold/20 rounded-sm my-1 mx-4" }}
                                        />
                                        {treeData.length === 0 && (
                                            <div className="flex flex-col items-center justify-center py-32 text-stone/20 space-y-4">
                                                <span className="material-symbols-outlined text-6xl">account_tree</span>
                                                <p className="font-bold text-[10px] uppercase tracking-[0.2em] italic">Chưa có liên kết con cho menu này</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-stone/10 bg-stone/5 p-20">
                                <span className="material-symbols-outlined text-[120px]">ads_click</span>
                                <p className="font-display text-2xl italic text-center mt-6">Chọn phân hệ menu để bắt đầu quản trị cấu trúc điều hướng</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Menu Form Modal */}
                {isMenuFormOpen && (
                    <div className="fixed inset-0 z-[100] bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                        <div className="bg-[#fcfcfa] border border-gold/30 shadow-premium w-full max-w-md rounded-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                            <div className="px-8 py-5 bg-primary text-white flex justify-between items-center shrink-0">
                                <div className="flex flex-col">
                                    <h3 className="font-display font-bold text-xl uppercase italic leading-none">{menuFormData.id ? 'Cập nhật phân hệ' : 'Khai báo Menu mới'}</h3>
                                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mt-1.5">Tham số định danh cho API và Front-end</p>
                                </div>
                                <button onClick={() => setIsMenuFormOpen(false)} className="size-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all">
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                            <form onSubmit={handleMenuSubmit} className="p-8 space-y-6">
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Tên hiển thị nội bộ</label>
                                    <input required type="text" value={menuFormData.name} onChange={e => setMenuFormData({ ...menuFormData, name: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: Menu chân trang" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Mã định danh (Slug)</label>
                                    <input required type="text" value={menuFormData.code} onChange={e => setMenuFormData({ ...menuFormData, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-mono font-bold text-primary/60 focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: footer_main" />
                                </div>
                                <div className="py-2">
                                    <label className="flex items-center gap-3 cursor-pointer group bg-stone/5 border border-gold/20 p-3 rounded-sm hover:border-gold transition-all select-none">
                                        <div className={`size-5 border-2 rounded-sm flex items-center justify-center transition-all ${menuFormData.is_active ? 'bg-primary border-primary' : 'bg-white border-gold/20'}`}>
                                            {menuFormData.is_active && <span className="material-symbols-outlined text-white text-[16px] font-black">check</span>}
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            checked={menuFormData.is_active} 
                                            onChange={e => setMenuFormData({ ...menuFormData, is_active: e.target.checked })}
                                            className="hidden"
                                        />
                                        <span className="font-ui text-[11px] font-black uppercase tracking-widest text-primary/60 group-hover:text-primary transition-colors italic">Chế độ phân phối API</span>
                                    </label>
                                </div>
                                <div className="pt-4 flex justify-end gap-3 shrink-0 border-t border-gold/10">
                                    <button onClick={handleMenuSubmit} className="bg-primary text-white w-full py-3 text-[11px] font-black uppercase tracking-widest hover:bg-umber transition-all rounded-sm shadow-premium active:scale-95">Lưu thông tin</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Item Form Modal */}
                {isItemFormOpen && (
                    <div className="fixed inset-0 z-[100] bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                        <div className="bg-[#fcfcfa] border border-gold/30 shadow-premium w-full max-w-lg rounded-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                            <div className="px-8 py-5 bg-primary text-white flex justify-between items-center shrink-0">
                                <div className="flex flex-col">
                                    <h3 className="font-display font-bold text-xl uppercase italic leading-none">Cấu hình liên kết</h3>
                                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mt-1.5">Chi tiết mục tiêu và hình ảnh đại diện</p>
                                </div>
                                <button onClick={() => setIsItemFormOpen(false)} className="size-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all">
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                            <form onSubmit={handleItemSubmit} className="p-8 space-y-6">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                        <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Nhãn hiển thị</label>
                                        <input required type="text" value={itemFormData.title} onChange={e => setItemFormData({ ...itemFormData, title: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: Trang chủ" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Icon (Symbol name)</label>
                                        <input type="text" value={itemFormData.icon} onChange={e => setItemFormData({ ...itemFormData, icon: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-medium text-stone/60 focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: home" />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Địa chỉ liên kết (URL)</label>
                                    <input type="text" value={itemFormData.url} onChange={e => setItemFormData({ ...itemFormData, url: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-mono text-primary focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white" placeholder="VD: /shop/ban-an" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="font-ui text-[10px] font-black uppercase tracking-widest text-primary/40">Hành vi mở trang</label>
                                    <div className="relative">
                                        <select value={itemFormData.target} onChange={e => setItemFormData({ ...itemFormData, target: e.target.value })} className="w-full bg-stone/5 border border-gold/20 p-3 text-[14px] font-bold text-primary/70 focus:outline-none focus:border-gold rounded-sm transition-all focus:bg-white appearance-none">
                                            <option value="_self">Chuyển hướng (Tab hiện tại)</option>
                                            <option value="_blank">Mở mới (Tab mới)</option>
                                        </select>
                                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-stone/30 pointer-events-none text-sm">expand_more</span>
                                    </div>
                                </div>
                                <div className="pt-4 flex justify-end gap-3 shrink-0 border-t border-gold/10">
                                    <button type="submit" className="bg-primary text-white w-full py-3 text-[11px] font-black uppercase tracking-widest hover:bg-umber transition-all rounded-sm shadow-premium active:scale-95">Chấp nhận mục này</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </DndProvider>
    );
};

export default MenuList;
