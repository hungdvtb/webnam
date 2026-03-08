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
            <div className="space-y-10 pb-20 animate-fade-in">
                {/* Header Section */}
                <div className="flex justify-between items-end border-b border-gold/10 pb-8">
                    <div className="space-y-2">
                        <h1 className="font-display text-4xl font-bold text-primary italic uppercase tracking-wider">Hệ Thống Điều Hướng</h1>
                        <p className="font-ui text-xs font-bold uppercase tracking-widest text-gold opacity-60">Quản lý Menu và các liên kết đa tầng</p>
                    </div>
                    <button
                        onClick={() => { setMenuFormData({ id: null, name: '', code: '', is_active: true }); setIsMenuFormOpen(true); }}
                        className="bg-primary text-white font-ui font-bold uppercase tracking-widest px-8 py-3 hover:bg-umber transition-all shadow-premium flex items-center gap-3"
                    >
                        <span className="material-symbols-outlined text-sm">add_circle</span>
                        Menu Mới
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                    {/* Left Column: Menu List */}
                    <div className="lg:col-span-4 bg-white border border-gold/10 shadow-premium overflow-hidden">
                        <div className="bg-gold/5 p-4 border-b border-gold/10">
                            <h3 className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Danh sách Menu</h3>
                        </div>
                        <div className="divide-y divide-gold/10">
                            {menus.map(menu => (
                                <div key={menu.id} className={`p-6 flex items-center justify-between group cursor-pointer transition-all ${selectedMenu?.id === menu.id ? 'bg-primary/5' : 'hover:bg-gold/5'}`} onClick={() => fetchMenuDetails(menu.id)}>
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <div className="font-display text-lg font-bold text-primary group-hover:text-gold transition-colors">{menu.name}</div>
                                            {menu.is_active && <span className="px-1.5 py-0.5 bg-green-50 text-green-600 border border-green-200 text-[8px] font-bold uppercase tracking-widest">Active</span>}
                                        </div>
                                        <div className="text-[10px] text-stone font-ui uppercase tracking-tighter opacity-70">Code: {menu.code}</div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                        <button onClick={(e) => { e.stopPropagation(); setMenuFormData(menu); setIsMenuFormOpen(true); }} className="text-stone hover:text-primary"><span className="material-symbols-outlined text-sm">settings</span></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteMenu(menu.id); }} className="text-stone hover:text-brick"><span className="material-symbols-outlined text-sm">delete</span></button>
                                    </div>
                                </div>
                            ))}
                            {menus.length === 0 && !loading && <div className="p-10 text-center text-stone italic text-sm">Chưa có menu nào.</div>}
                        </div>
                    </div>

                    {/* Right Column: Item Management */}
                    <div className="lg:col-span-8 space-y-8">
                        {selectedMenu ? (
                            <div className="bg-white border border-gold/10 shadow-premium p-8 space-y-8 animate-slide-up">
                                <div className="flex justify-between items-center border-b border-gold/10 pb-6">
                                    <div className="space-y-1">
                                        <h2 className="font-display text-2xl font-bold text-primary uppercase italic">{selectedMenu.name}</h2>
                                        <p className="text-[10px] text-stone font-ui uppercase font-bold tracking-widest">Hiệu chỉnh các mục liên kết</p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => { setItemFormData({ id: null, title: '', url: '', target: '_self', icon: '', children: [] }); setIsItemFormOpen(true); }} className="px-6 py-2 border border-gold/30 text-gold hover:bg-gold hover:text-white transition-all font-ui text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">add</span> Thêm Mục
                                        </button>
                                        <button onClick={handleSaveItems} disabled={saving} className="px-10 py-3 bg-primary text-white hover:bg-umber transition-all font-ui text-[10px] font-bold uppercase tracking-widest shadow-premium flex items-center gap-2 disabled:opacity-50">
                                            <span className="material-symbols-outlined text-sm">{saving ? 'sync' : 'save'}</span>
                                            {saving ? 'Đang lưu...' : 'Lưu Cấu Trúc'}
                                        </button>
                                    </div>
                                </div>

                                <div className="min-h-[400px] bg-background-light/30 border border-gold/10 p-4">
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
                                        classes={{ root: "tree-root", draggingSource: "opacity-30", placeholder: "bg-gold/10 h-10 my-1" }}
                                    />
                                    {treeData.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-20 text-stone space-y-4">
                                            <span className="material-symbols-outlined text-5xl opacity-20">account_tree</span>
                                            <p className="font-body text-sm italic">Menu chưa có mục liên kết nào. Hãy bắt đầu bằng cách thêm mới.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white border-2 border-dashed border-gold/10 p-20 flex flex-col items-center justify-center text-stone space-y-6">
                                <span className="material-symbols-outlined text-6xl opacity-10">touch_app</span>
                                <p className="font-display text-xl italic text-center">Chọn một Menu bên trái để bắt đầu hiệu chỉnh cấu trúc điều hướng</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Modals/Dialogs */}
                {isMenuFormOpen && (
                    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white max-w-md w-full shadow-premium border border-gold/20 p-8 space-y-8 animate-slide-up">
                            <div className="flex justify-between items-center border-b border-gold/10 pb-4">
                                <h3 className="font-display text-xl font-bold text-primary uppercase italic">{menuFormData.id ? 'Cập Nhật' : 'Tạo Menu'}</h3>
                                <button onClick={() => setIsMenuFormOpen(false)} className="text-stone hover:text-brick"><span className="material-symbols-outlined">close</span></button>
                            </div>
                            <form onSubmit={handleMenuSubmit} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tên Menu</label>
                                    <input required type="text" value={menuFormData.name} onChange={e => setMenuFormData({ ...menuFormData, name: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm" placeholder="VD: Menu Chính" />
                                </div>
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Mã Code (Dùng cho API)</label>
                                    <input required type="text" value={menuFormData.code} onChange={e => setMenuFormData({ ...menuFormData, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm" placeholder="VD: main_menu" />
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        id="is_active"
                                        checked={menuFormData.is_active}
                                        onChange={e => setMenuFormData({ ...menuFormData, is_active: e.target.checked })}
                                        className="size-4 border-gold/40 text-primary focus:ring-primary"
                                    />
                                    <label htmlFor="is_active" className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary cursor-pointer">Sử dụng cho Header (Active)</label>
                                </div>
                                <button type="submit" className="w-full bg-primary text-white py-4 font-ui text-[10px] font-bold uppercase tracking-widest hover:bg-umber shadow-premium transition-all">Lưu thông tin</button>
                            </form>
                        </div>
                    </div>
                )}

                {isItemFormOpen && (
                    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white max-w-lg w-full shadow-premium border border-gold/20 p-8 space-y-8 animate-slide-up">
                            <div className="flex justify-between items-center border-b border-gold/10 pb-4">
                                <h3 className="font-display text-xl font-bold text-primary uppercase italic">Chi Tiết Mục Menu</h3>
                                <button onClick={() => setIsItemFormOpen(false)} className="text-stone hover:text-brick"><span className="material-symbols-outlined">close</span></button>
                            </div>
                            <form onSubmit={handleItemSubmit} className="space-y-6">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tiêu đề hiển thị</label>
                                        <input required type="text" value={itemFormData.title} onChange={e => setItemFormData({ ...itemFormData, title: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Icon (Material Symbol)</label>
                                        <input type="text" value={itemFormData.icon} onChange={e => setItemFormData({ ...itemFormData, icon: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm" placeholder="VD: home" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Đường dẫn (URL)</label>
                                    <input type="text" value={itemFormData.url} onChange={e => setItemFormData({ ...itemFormData, url: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm" placeholder="VD: /shop, https://..." />
                                </div>
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Mục tiêu (Target)</label>
                                    <select value={itemFormData.target} onChange={e => setItemFormData({ ...itemFormData, target: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm appearance-none">
                                        <option value="_self">Chuyển hướng (Mặc định)</option>
                                        <option value="_blank">Mở tab mới</option>
                                    </select>
                                </div>
                                <button type="submit" className="w-full bg-primary text-white py-4 font-ui text-[10px] font-bold uppercase tracking-widest hover:bg-umber shadow-premium transition-all">Lưu Mục Này</button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </DndProvider>
    );
};

export default MenuList;
