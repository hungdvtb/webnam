import React, { useEffect, useState } from 'react';

const CategorySubSortModal = ({
    open,
    onClose,
    parentCategory,
    childNodes,
    isSaving,
    onSave,
}) => {
    const [draftOrders, setDraftOrders] = useState({});
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, onClose]);

    useEffect(() => {
        if (!open) return;

        // Initialize drafts from current childNodes order
        const initialDrafts = {};
        childNodes.forEach((node, index) => {
            initialDrafts[node.id] = String(index + 1);
        });
        setDraftOrders(initialDrafts);
        setSearchQuery('');
    }, [open, childNodes]);

    if (!open) return null;

    const totalNodes = childNodes.length;
    const filteredNodes = searchQuery.trim()
        ? childNodes.filter(node => 
            node.text.toLowerCase().includes(searchQuery.toLowerCase()) || 
            String(node.id).includes(searchQuery)
          )
        : childNodes;

    const isDirty = childNodes.some((node, index) => {
        const currentPos = String(index + 1);
        const draftPos = draftOrders[node.id] || currentPos;
        return draftPos !== currentPos;
    });

    const handleDraftChange = (id, value) => {
        if (value !== '' && !/^\d+$/.test(value)) return;
        setDraftOrders(prev => ({ ...prev, [id]: value }));
    };

    const handleMoveToPosition = (id, targetPos) => {
        const parsedPos = parseInt(targetPos, 10);
        if (isNaN(parsedPos)) return;

        const safePos = Math.min(Math.max(parsedPos, 1), totalNodes);
        
        // Reorder sub-array
        const nextNodes = [...childNodes];
        const currentIndex = nextNodes.findIndex(n => n.id === id);
        if (currentIndex === -1) return;

        const [movedItem] = nextNodes.splice(currentIndex, 1);
        nextNodes.splice(safePos - 1, 0, movedItem);

        // Update drafts to match new order
        const nextDrafts = {};
        nextNodes.forEach((node, idx) => {
            nextDrafts[node.id] = String(idx + 1);
        });
        setDraftOrders(nextDrafts);
    };

    const handleSave = () => {
        // Create the ordered list based on draft positions
        const ordered = [...childNodes].sort((a, b) => {
            const posA = parseInt(draftOrders[a.id] || 0, 10);
            const posB = parseInt(draftOrders[b.id] || 0, 10);
            return posA - posB;
        });

        onSave(ordered);
    };

    return (
        <div 
            className="fixed inset-0 z-[1200] overflow-y-auto bg-primary/25 p-4 backdrop-blur-sm flex items-center justify-center font-ui"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div 
                className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm border border-gold/15 bg-white shadow-2xl"
                onMouseDown={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="border-b border-gold/10 bg-gold/5 px-6 py-5 flex-none">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                                <span className="material-symbols-outlined text-[18px]">format_list_numbered</span>
                                Bảng sắp xếp danh mục con
                            </div>
                            <h3 className="mt-2 text-xl font-black text-primary italic">
                                {parentCategory?.text || 'Danh mục'}
                            </h3>
                            <p className="mt-1 text-[11px] text-stone/50 leading-relaxed max-w-2xl">
                                Thay đổi số thứ tự (STT) để sắp xếp vị trí hiển thị của các danh mục con trực tiếp. Sau đó nhấn "Lưu STT" để áp dụng.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                {totalNodes} danh mục con
                            </span>
                            <button 
                                onClick={onClose}
                                className="size-8 flex items-center justify-center text-stone/30 hover:text-brick hover:bg-brick/5 rounded-full transition-all"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                    </div>

                    <div className="mt-5 flex gap-4 items-center">
                        <div className="flex-1 relative">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone/30 text-[18px]">search</span>
                            <input 
                                type="text"
                                placeholder="Tìm nhanh danh mục con..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full h-10 pl-10 pr-4 bg-white border border-gold/15 rounded-sm text-[13px] focus:outline-none focus:border-primary transition-all placeholder:italic placeholder:font-normal"
                            />
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <button 
                                onClick={() => {
                                    const resetDrafts = {};
                                    childNodes.forEach((n, i) => resetDrafts[n.id] = String(i + 1));
                                    setDraftOrders(resetDrafts);
                                }}
                                disabled={!isDirty || isSaving}
                                className="h-10 px-4 rounded-sm border border-gold/20 text-[11px] font-black uppercase tracking-[0.12em] text-stone/60 hover:bg-gold/5 disabled:opacity-30"
                            >
                                Hoàn tác
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={!isDirty || isSaving}
                                className="h-10 px-6 rounded-sm bg-brick text-white text-[11px] font-black uppercase tracking-[0.12em] hover:bg-umber disabled:opacity-30 flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined text-[16px]">{isSaving ? 'sync' : 'save'}</span>
                                {isSaving ? 'Đang lưu...' : 'Lưu STT'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Table Body */}
                <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full border-collapse">
                        <thead className="sticky top-0 bg-white shadow-sm z-10 border-b border-gold/10">
                            <tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-stone/40">
                                <th className="px-6 py-4 w-24 text-center">STT Hiện Tại</th>
                                <th className="px-4 py-4">Tên Danh Mục</th>
                                <th className="px-4 py-4 w-40">Nhập STT Mới</th>
                                <th className="px-6 py-4 w-32 text-center">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredNodes.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-stone/40 italic text-sm">
                                        Không tìm thấy danh mục nào phù hợp.
                                    </td>
                                </tr>
                            ) : (
                                filteredNodes.map((node, index) => {
                                    const currentPos = childNodes.findIndex(n => n.id === node.id) + 1;
                                    const draftValue = draftOrders[node.id] || String(currentPos);
                                    const isModified = draftValue !== String(currentPos);

                                    return (
                                        <tr key={node.id} className={`border-b border-gold/5 transition-colors hover:bg-gold/5 ${isModified ? 'bg-amber-50/50' : ''}`}>
                                            <td className="px-6 py-4 text-center">
                                                <span className="inline-flex min-w-10 h-8 items-center justify-center rounded-full bg-primary/5 text-[11px] font-black text-primary">
                                                    #{currentPos}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="text-[13px] font-bold text-primary">{node.text}</div>
                                                <div className="text-[10px] text-stone/40 mt-0.5 font-medium flex gap-3">
                                                    <span>ID: {node.id}</span>
                                                    <span>Slug: {node.data?.slug || '--'}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <input 
                                                        type="number"
                                                        min="1"
                                                        max={totalNodes}
                                                        value={draftValue}
                                                        onChange={e => handleDraftChange(node.id, e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleMoveToPosition(node.id, draftValue)}
                                                        disabled={isSaving}
                                                        className="h-9 w-20 border border-gold/20 rounded-sm text-center text-[12px] font-bold text-primary focus:border-primary focus:outline-none transition-all"
                                                    />
                                                    <span className="text-[9px] font-bold text-stone/30 uppercase tracking-tighter">Enter để đổi</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <button 
                                                        onClick={() => handleMoveToPosition(node.id, currentPos - 1)}
                                                        disabled={currentPos <= 1 || isSaving}
                                                        className="size-8 flex items-center justify-center border border-gold/15 rounded-sm text-stone/50 hover:text-primary hover:border-primary disabled:opacity-20 transition-all font-ui"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => handleMoveToPosition(node.id, currentPos + 1)}
                                                        disabled={currentPos >= totalNodes || isSaving}
                                                        className="size-8 flex items-center justify-center border border-gold/15 rounded-sm text-stone/50 hover:text-primary hover:border-primary disabled:opacity-20 transition-all font-ui"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-white border-t border-gold/10 flex items-center justify-between flex-none">
                    <div className="text-[11px] text-stone/40 italic">
                        * Nhập số thứ tự mới rồi nhấn Enter, hoặc dùng mũi tên để di chuyển danh mục.
                    </div>
                    {isDirty && (
                        <div className="text-[10px] font-black uppercase tracking-[0.1em] text-amber-600 animate-pulse">
                            Bạn đang có thay đổi chưa lưu
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CategorySubSortModal;
