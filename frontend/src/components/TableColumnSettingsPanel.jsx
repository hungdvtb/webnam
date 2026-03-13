import React, { useState } from 'react';

/**
 * Shared UI panel for configuring table columns.
 * Mirrors the stylish design used in Product and Order lists.
 */
const TableColumnSettingsPanel = ({
    availableColumns,
    visibleColumns,
    toggleColumn,
    setAvailableColumns,
    resetDefault,
    saveAsDefault,
    onClose,
    storageKey
}) => {
    const [draggedItemIndex, setDraggedItemIndex] = useState(null);

    const handleDragStart = (e, index) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Visual feedback
        e.currentTarget.style.opacity = '0.5';
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, index) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        const newAvailable = [...availableColumns];
        const draggedItem = newAvailable[draggedItemIndex];
        
        // Remove old and insert new
        newAvailable.splice(draggedItemIndex, 1);
        newAvailable.splice(index, 0, draggedItem);

        setAvailableColumns(newAvailable);
        localStorage.setItem(`${storageKey}_column_order`, JSON.stringify(newAvailable.map(c => c.id)));
        setDraggedItemIndex(null);
    };

    const handleDragEnd = (e) => {
        e.currentTarget.style.opacity = '1';
        setDraggedItemIndex(null);
    };

    return (
        <div className="bg-white border-b border-primary/10 p-4 shadow-lg animate-in slide-in-from-top-2 duration-200 rounded-b-md">
            <div className="flex justify-between items-center mb-3">
                <h3 className="font-display font-bold text-primary uppercase text-[16px] tracking-wider">Cấu hình hiển thị cột</h3>
                <div className="flex items-center gap-2">
                    <p className="text-[11px] text-primary uppercase tracking-widest font-bold opacity-40 mr-2 italic">Kéo thả để đổi thứ tự</p>
                    <button
                        onClick={resetDefault}
                        className="bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm hover:bg-primary/10 transition-all flex items-center gap-1 border border-primary/20"
                    >
                        <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                        MẶC ĐỊNH
                    </button>
                    <button
                        onClick={saveAsDefault}
                        className="bg-white text-primary text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm hover:bg-primary/5 transition-all flex items-center gap-1 border border-primary/30"
                    >
                        <span className="material-symbols-outlined text-[16px]">save</span>
                        LƯU LÀM MẶC ĐỊNH
                    </button>
                    <button
                        onClick={onClose}
                        className="bg-primary text-white text-[10px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-sm hover:bg-primary/90 transition-all flex items-center gap-1 shadow-md shadow-primary/20"
                    >
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        XÁC NHẬN
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                {availableColumns.map((col, idx) => (
                    <div
                        key={col.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 p-1.5 border transition-all rounded-sm cursor-move ${visibleColumns.includes(col.id) ? 'bg-primary/5 border-primary/20 shadow-sm' : 'bg-primary/5 border-primary/10 opacity-60 hover:opacity-100 hover:border-primary/30'}`}
                    >
                        <input
                            type="checkbox"
                            id={`check-${storageKey}-${col.id}`}
                            checked={visibleColumns.includes(col.id)}
                            onChange={() => toggleColumn(col.id)}
                            className="size-3 text-primary border-primary/30 rounded cursor-pointer mt-0.5"
                        />
                        <label htmlFor={`check-${storageKey}-${col.id}`} className="text-sm text-primary truncate cursor-pointer select-none font-bold">
                            {col.label}
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TableColumnSettingsPanel;
