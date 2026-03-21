import React, { useState } from 'react';

const TableColumnSettingsPanel = ({
    availableColumns,
    visibleColumns,
    toggleColumn,
    setAvailableColumns,
    resetDefault,
    saveAsDefault,
    onClose,
    storageKey,
}) => {
    const [draggedItemIndex, setDraggedItemIndex] = useState(null);

    const handleDragStart = (event, index) => {
        setDraggedItemIndex(index);
        event.dataTransfer.effectAllowed = 'move';
        event.currentTarget.style.opacity = '0.5';
    };

    const handleDrop = (event, index) => {
        event.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        const nextColumns = [...availableColumns];
        const draggedColumn = nextColumns[draggedItemIndex];
        nextColumns.splice(draggedItemIndex, 1);
        nextColumns.splice(index, 0, draggedColumn);

        setAvailableColumns(nextColumns);
        localStorage.setItem(`${storageKey}_column_order`, JSON.stringify(nextColumns.map((column) => column.id)));
        setDraggedItemIndex(null);
    };

    return (
        <div className="rounded-b-sm border-t border-primary/10 bg-white px-3 py-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-[14px] font-black text-primary">Cài đặt cột</h3>
                    <p className="text-[11px] text-primary/50">Kéo thả để đổi thứ tự, chọn để ẩn hoặc hiện cột.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={resetDefault}
                        className="inline-flex h-8 items-center gap-1 rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-bold text-primary transition hover:border-primary hover:bg-primary/5"
                    >
                        <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                        Mặc định
                    </button>
                    <button
                        type="button"
                        onClick={saveAsDefault}
                        className="inline-flex h-8 items-center gap-1 rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-bold text-primary transition hover:border-primary hover:bg-primary/5"
                    >
                        <span className="material-symbols-outlined text-[16px]">save</span>
                        Lưu mặc định
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-[11px] font-bold text-white transition hover:bg-primary/90"
                    >
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        Xong
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                {availableColumns.map((column, index) => (
                    <label
                        key={column.id}
                        draggable
                        onDragStart={(event) => handleDragStart(event, index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, index)}
                        onDragEnd={(event) => {
                            event.currentTarget.style.opacity = '1';
                            setDraggedItemIndex(null);
                        }}
                        className={`flex cursor-move items-center gap-2 rounded-sm border px-2 py-2 text-[12px] transition ${
                            visibleColumns.includes(column.id)
                                ? 'border-primary/15 bg-primary/[0.04] text-primary'
                                : 'border-primary/10 bg-stone-50 text-primary/55'
                        }`}
                    >
                        <input
                            type="checkbox"
                            id={`check-${storageKey}-${column.id}`}
                            checked={visibleColumns.includes(column.id)}
                            onChange={() => toggleColumn(column.id)}
                            className="size-3.5 cursor-pointer accent-primary"
                        />
                        <span className="truncate font-semibold">{column.label}</span>
                    </label>
                ))}
            </div>
        </div>
    );
};

export default TableColumnSettingsPanel;
