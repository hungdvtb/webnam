import { useState, useEffect, useCallback, useMemo } from 'react';

const parseWidthValue = (value, fallback = 0) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.replace('px', ''), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
};

/**
 * Custom hook to manage table columns (visibility, reordering, resizing, persistence)
 * @param {string} storageKey - Unique key for localStorage
 * @param {Array} defaultColumns - Initial column configuration
 */
export const useTableColumns = (storageKey, defaultColumns) => {
    const [visibleColumns, setVisibleColumns] = useState([]);
    const [availableColumns, setAvailableColumns] = useState([]);
    const [columnWidths, setColumnWidths] = useState(() => {
        const saved = localStorage.getItem(`${storageKey}_column_widths`);
        return saved ? JSON.parse(saved) : {};
    });
    const [draggedItemIndex, setDraggedItemIndex] = useState(null);

    const getColumnMinWidth = useCallback((colId) => {
        const matchedColumn = defaultColumns.find((column) => column.id === colId);
        return Math.max(parseWidthValue(matchedColumn?.minWidth, 120), 80);
    }, [defaultColumns]);

    useEffect(() => {
        const savedOrder = localStorage.getItem(`${storageKey}_column_order`);
        let sortedColumns = [...defaultColumns];
        if (savedOrder) {
            const orderIds = JSON.parse(savedOrder);
            sortedColumns = [...defaultColumns].sort((a, b) => {
                const indexA = orderIds.indexOf(a.id);
                const indexB = orderIds.indexOf(b.id);
                if (indexA === -1 && indexB === -1) return 0;
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
        }
        setAvailableColumns(sortedColumns);

        const savedVisible = localStorage.getItem(`${storageKey}_columns`);
        const allIds = sortedColumns.map(c => c.id);
        if (savedVisible) {
            const savedIds = JSON.parse(savedVisible);
            const missingIds = allIds.filter(id => !savedIds.includes(id));
            if (missingIds.length > 0) {
                 const updated = [...savedIds, ...missingIds];
                 setVisibleColumns(updated);
                 localStorage.setItem(`${storageKey}_columns`, JSON.stringify(updated));
            } else {
                setVisibleColumns(savedIds);
            }
        } else {
            setVisibleColumns(allIds);
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(allIds));
        }
    }, [storageKey, defaultColumns]);

    useEffect(() => {
        setColumnWidths((prev) => {
            const next = Object.entries(prev || {}).reduce((accumulator, [colId, width]) => {
                accumulator[colId] = Math.max(getColumnMinWidth(colId), parseWidthValue(width, getColumnMinWidth(colId)));
                return accumulator;
            }, {});

            if (JSON.stringify(next) !== JSON.stringify(prev || {})) {
                localStorage.setItem(`${storageKey}_column_widths`, JSON.stringify(next));
                return next;
            }

            return prev;
        });
    }, [getColumnMinWidth, storageKey]);

    const renderedColumns = useMemo(() => {
        return availableColumns.filter(col => visibleColumns.includes(col.id));
    }, [availableColumns, visibleColumns]);

    const toggleColumn = useCallback((colId) => {
        setVisibleColumns(prev => {
            const next = prev.includes(colId) ? prev.filter(id => id !== colId) : [...prev, colId];
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(next));
            return next;
        });
    }, [storageKey]);

    const handleColumnResize = useCallback((colId, e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const minWidth = getColumnMinWidth(colId);
        const startWidth = Math.max(
            minWidth,
            parseWidthValue(columnWidths[colId], 0) || e.currentTarget.parentElement.offsetWidth
        );
        
        let currentWidth = startWidth;
        const onMouseMove = (moveEvent) => {
            currentWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
            setColumnWidths(prev => ({ ...prev, [colId]: currentWidth }));
        };
        
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setColumnWidths(prev => {
                const final = { ...prev, [colId]: currentWidth };
                localStorage.setItem(`${storageKey}_column_widths`, JSON.stringify(final));
                return final;
            });
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [columnWidths, getColumnMinWidth, storageKey]);

    const handleHeaderDragStart = useCallback((e, index) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleHeaderDrop = useCallback((e, targetIndex) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

        const currentRendered = availableColumns.filter(c => visibleColumns.includes(c.id));
        const draggedCol = currentRendered[draggedItemIndex];
        const targetCol = currentRendered[targetIndex];

        if (!draggedCol || !targetCol) return;

        const newAvailable = [...availableColumns];
        const draggedIdxInAvailable = newAvailable.findIndex(c => c.id === draggedCol.id);
        newAvailable.splice(draggedIdxInAvailable, 1);
        
        const targetIdxInAvailable = newAvailable.findIndex(c => c.id === targetCol.id);
        newAvailable.splice(targetIdxInAvailable, 0, draggedCol);
        
        setAvailableColumns(newAvailable);
        localStorage.setItem(`${storageKey}_column_order`, JSON.stringify(newAvailable.map(c => c.id)));
        setDraggedItemIndex(null);
    }, [availableColumns, visibleColumns, draggedItemIndex, storageKey]);

    const totalTableWidth = useMemo(() => {
        return renderedColumns.reduce((acc, col) => {
            const width = columnWidths[col.id] || col.minWidth;
            const numericWidth = typeof width === 'string' ? parseInt(width.replace('px', '')) : (width || 0);
            return acc + numericWidth;
        }, 40); // 40px for checkbox column
    }, [renderedColumns, columnWidths]);

    const resetDefault = useCallback(() => {
        const savedDefaultCols = localStorage.getItem(`${storageKey}_columns_default`);
        const savedDefaultOrder = localStorage.getItem(`${storageKey}_column_order_default`);
        const savedDefaultWidths = localStorage.getItem(`${storageKey}_column_widths_default`);

        if (savedDefaultCols) {
            const cols = JSON.parse(savedDefaultCols);
            setVisibleColumns(cols);
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(cols));
        }
        if (savedDefaultOrder) {
            const orderIds = JSON.parse(savedDefaultOrder);
            const newAvailable = [...defaultColumns].sort((a, b) => {
                const idxA = orderIds.indexOf(a.id);
                const idxB = orderIds.indexOf(b.id);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
            setAvailableColumns(newAvailable);
            localStorage.setItem(`${storageKey}_column_order`, JSON.stringify(orderIds));
        }
        if (savedDefaultWidths) {
            const widths = JSON.parse(savedDefaultWidths);
            setColumnWidths(widths);
            localStorage.setItem(`${storageKey}_column_widths`, JSON.stringify(widths));
        }

        if (!savedDefaultCols && !savedDefaultOrder && !savedDefaultWidths) {
            localStorage.removeItem(`${storageKey}_column_order`);
            localStorage.removeItem(`${storageKey}_columns`);
            localStorage.removeItem(`${storageKey}_column_widths`);
            window.location.reload();
        }
    }, [storageKey, defaultColumns]);

    const saveAsDefault = useCallback(() => {
        localStorage.setItem(`${storageKey}_columns_default`, JSON.stringify(visibleColumns));
        localStorage.setItem(`${storageKey}_column_order_default`, JSON.stringify(availableColumns.map(c => c.id)));
        localStorage.setItem(`${storageKey}_column_widths_default`, JSON.stringify(columnWidths));
        alert('Đã lưu cấu hình mặc định của bạn!');
    }, [storageKey, visibleColumns, availableColumns, columnWidths]);

    return {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
        setAvailableColumns,
        setVisibleColumns
    };
};
