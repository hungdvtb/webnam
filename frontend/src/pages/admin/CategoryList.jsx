import React, { useState, useEffect } from 'react';
import { categoryApi } from '../../services/api';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Tree } from '@minoru/react-dnd-treeview';

const CustomNode = ({ node, depth, isOpen, onToggle, onEdit, onDelete }) => {
    return (
        <div style={{ paddingLeft: depth * 24 }} className="flex items-center gap-2 w-full py-2 hover:bg-gold/5 pr-4 border-b border-gold/10 group">
            <div 
                className="flex-1 flex items-center gap-2 cursor-pointer select-none" 
                onClick={node.droppable ? onToggle : undefined}
                onDoubleClick={() => onEdit(node)}
            >
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
    const [formData, setFormData] = useState({ id: null, name: '', description: '', parent_id: '', status: 1, banner: null, banner_url: null });

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
            setFormData({ id: null, name: '', description: '', parent_id: '', status: 1, banner: null, banner_url: null });
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
            banner_url: bannerUrl
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
                            <h1 className="text-2xl font-display font-bold text-primary italic">Phân loại sản phẩm</h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Quản lý cấu trúc danh mục và phân cấp</p>
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                        <div className="flex gap-1.5 items-center">
                            <button
                                onClick={() => { setFormData({ id: null, name: '', description: '', parent_id: '', status: 1 }); setIsFormOpen(true); }}
                                className="bg-brick text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                                title="Thêm danh mục mới"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                            <button
                                onClick={fetchCategories}
                                className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                                title="Làm mới"
                                disabled={loading}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            </button>
                        </div>
                        <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
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
                            <span className="text-[9px] font-black text-stone/30 uppercase tracking-widest italic">Kéo thả để sắp xếp</span>
                        </div>
                        
                        <div className="flex-1 overflow-auto custom-scrollbar p-4">
                            {loading ? (
                                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                                    <span className="text-[11px] font-black text-stone/30 uppercase tracking-[0.2em]">Đang tải dữ liệu...</span>
                                </div>
                            ) : treeData.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center gap-3 opacity-30">
                                    <span className="material-symbols-outlined text-[60px]">inventory_2</span>
                                    <span className="text-[12px] font-bold italic uppercase tracking-widest">Chưa có danh mục nào</span>
                                </div>
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
                                        <div className="bg-primary text-white px-4 py-2 font-ui font-bold shadow-xl border border-gold/30 rounded-sm scale-110">
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
                    </div>

                    {/* Right side Form Area */}
                    <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden">
                        {isFormOpen ? (
                            <div className="bg-white border border-gold/20 shadow-premium p-6 rounded-sm animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden">
                                <div className="flex-none flex justify-between items-center border-b border-gold/10 pb-4 mb-6">
                                    <h3 className="font-display font-bold text-lg text-primary uppercase italic">
                                        {formData.id ? 'Cập Nhật' : 'Tạo Mới'}
                                    </h3>
                                    <button
                                        onClick={() => setIsFormOpen(false)}
                                        className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-full transition-all"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">close</span>
                                    </button>
                                </div>
                                <div className="flex-1 overflow-auto custom-scrollbar">
                                    <form onSubmit={handleFormSubmit} className="space-y-6">
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

                                        <button type="submit" className="w-full bg-primary text-white font-ui text-[11px] font-bold uppercase tracking-widest py-3.5 mt-4 hover:bg-umber transition-all shadow-sm rounded-sm">
                                            {formData.id ? 'Lưu cập nhật' : 'Khởi tạo ngay'}
                                        </button>
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
