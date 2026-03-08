import React, { useState, useEffect } from 'react';
import { categoryApi } from '../../services/api';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Tree } from '@minoru/react-dnd-treeview';

const CustomNode = ({ node, depth, isOpen, onToggle, onEdit, onDelete }) => {
    return (
        <div style={{ paddingLeft: depth * 24 }} className="flex items-center gap-2 w-full py-2 hover:bg-gold/5 pr-4 border-b border-gold/10 group">
            <div className="flex-1 flex items-center gap-2 cursor-pointer" onClick={node.droppable ? onToggle : undefined}>
                {node.droppable && (
                    <span className="material-symbols-outlined text-stone text-sm">
                        {isOpen ? 'expand_more' : 'chevron_right'}
                    </span>
                )}
                {!node.droppable && <span className="w-5"></span>}
                <span className="material-symbols-outlined text-gold" style={{ fontSize: '20px' }}>
                    {node.droppable ? 'folder' : 'inventory_2'}
                </span>
                <span className="font-ui text-primary font-bold">{node.text}</span>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onEdit(node)} className="text-stone hover:text-primary transition-colors p-1" title="Sửa">
                    <span className="material-symbols-outlined text-sm">edit</span>
                </button>
                <button onClick={() => onDelete(node)} className="text-stone hover:text-brick transition-colors p-1" title="Xóa">
                    <span className="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>
    );
};

const CategoryList = () => {
    const [treeData, setTreeData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [formData, setFormData] = useState({ id: null, name: '', description: '', parent_id: '', status: 1 });

    const fetchCategories = async () => {
        setLoading(true);
        try {
            const res = await categoryApi.getAll();
            // Data maps to Tree format: { id: number/string, parent: number/string, text: string, droppable: boolean, data: any }
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
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    const handleDrop = async (newTree, options) => {
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
            const payload = { ...formData };
            if (!payload.parent_id || payload.parent_id === '0') payload.parent_id = null;

            if (formData.id) {
                await categoryApi.update(formData.id, payload);
            } else {
                await categoryApi.store(payload);
            }
            setIsFormOpen(false);
            setFormData({ id: null, name: '', description: '', parent_id: '', status: 1 });
            fetchCategories();
        } catch (error) {
            console.error("Lỗi khi lưu danh mục:", error);
            alert("Đã xảy ra lỗi.");
        }
    };

    const handleEdit = (node) => {
        const cat = node.data;
        setFormData({
            id: cat.id,
            name: cat.name,
            description: cat.description || '',
            parent_id: cat.parent_id || '',
            status: cat.status
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

    if (loading) return <div className="p-8 text-center text-stone">Đang tải danh sách...</div>;

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="space-y-6">
                <div className="flex justify-between items-center bg-white p-6 shadow-sm border border-gold/10">
                    <div>
                        <h2 className="text-2xl font-display font-bold text-primary uppercase">Quản lý Danh Mục</h2>
                        <p className="text-stone font-body text-sm italic mt-1">Kéo thả để sắp xếp phân cấp các danh mục sản phẩm.</p>
                    </div>
                    <button
                        onClick={() => { setFormData({ id: null, name: '', description: '', parent_id: '', status: 1 }); setIsFormOpen(true); }}
                        className="bg-primary text-white px-6 py-2 uppercase font-ui font-bold text-xs tracking-widest hover:bg-umber transition-all flex items-center gap-2 shadow-md shadow-primary/20"
                    >
                        <span className="material-symbols-outlined text-sm">add</span> Thêm Danh Mục
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    {/* Tree View Section */}
                    <div className="lg:col-span-2 bg-white p-6 shadow-sm border border-gold/10 min-h-[400px]">
                        <div className="font-ui text-sm font-bold uppercase tracking-widest mb-6 border-b border-gold/20 pb-2 text-primary">Cấu Trúc Cây Danh Mục</div>

                        {treeData.length === 0 ? (
                            <div className="text-stone text-center py-10 italic">Chưa có danh mục nào.</div>
                        ) : (
                            <Tree
                                tree={treeData}
                                rootId={0}
                                render={(node, options) => (
                                    <CustomNode
                                        node={node}
                                        {...options}
                                        onEdit={handleEdit}
                                        onDelete={handleDelete}
                                    />
                                )}
                                dragPreviewRender={(monitorProps) => (
                                    <div className="bg-primary text-white px-4 py-2 font-ui font-bold shadow-xl border border-gold/30">
                                        {monitorProps.item.text}
                                    </div>
                                )}
                                onDrop={handleDrop}
                                classes={{
                                    root: "w-full",
                                    draggingSource: "opacity-30",
                                    dropTarget: "bg-gold/10",
                                }}
                            />
                        )}
                    </div>

                    {/* Right side helper / Form space */}
                    <div className="lg:col-span-1 space-y-6">
                        {isFormOpen ? (
                            <div className="bg-white p-6 shadow-sm border border-gold/10 animate-fade-in relative">
                                <button
                                    onClick={() => setIsFormOpen(false)}
                                    className="absolute top-4 right-4 text-stone hover:text-brick"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                                <h3 className="font-ui font-bold text-primary uppercase tracking-widest border-b border-gold/20 pb-4 mb-4">
                                    {formData.id ? 'Sửa Danh Mục' : 'Tạo Mới'}
                                </h3>
                                <form onSubmit={handleFormSubmit} className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Tên danh mục</label>
                                        <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Danh mục cha</label>
                                        <select value={formData.parent_id} onChange={e => setFormData({ ...formData, parent_id: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body">
                                            <option value="">-- Là Danh mục gốc (Gốc) --</option>
                                            {(() => {
                                                const renderOptions = (parentId = 0, prefix = '') => {
                                                    // Filter out the category being edited and its children (optimistically ignoring deep descendants in dropdown)
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
                                    <div className="space-y-1">
                                        <label className="font-ui text-xs font-bold uppercase tracking-wider text-primary">Mô tả (tuỳ chọn)</label>
                                        <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full bg-background-light border border-gold/30 p-2 text-sm focus:outline-none focus:border-primary font-body h-20 resize-none"></textarea>
                                    </div>

                                    <button type="submit" className="w-full bg-primary text-white font-ui text-xs font-bold uppercase tracking-widest py-3 mt-4 hover:bg-umber transition-colors">
                                        {formData.id ? 'Cập Nhật' : 'Tạo Mới'}
                                    </button>
                                </form>
                            </div>
                        ) : (
                            <div className="bg-white p-6 shadow-sm border border-gold/10">
                                <h3 className="font-ui font-bold text-primary uppercase tracking-widest border-b border-gold/20 pb-4 mb-4">Hướng Dẫn</h3>
                                <ul className="text-stone font-body text-sm space-y-3 leading-relaxed list-disc list-inside">
                                    <li>Kéo và thả mục bất kỳ để thay đổi vị trí.</li>
                                    <li>Kéo thư mục và thả vào một thư mục khác để biến nó thành thư mục con.</li>
                                    <li>Cảnh báo: Nếu bạn xóa danh mục cha, các danh mục con bên trong nó cũng bị xóa.</li>
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DndProvider>
    );
};

export default CategoryList;
