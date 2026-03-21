import { useCallback, useEffect, useMemo, useState } from 'react';

const parseWidthValue = (value, fallback = 0) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.replace('px', ''), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
};

export const useTableColumns = (storageKey, defaultColumns) => {
    const [visibleColumns, setVisibleColumns] = useState([]);
    const [availableColumns, setAvailableColumns] = useState([]);
    const [columnWidths, setColumnWidths] = useState(() => {
        const saved = localStorage.getItem(`${storageKey}_column_widths`);
        return saved ? JSON.parse(saved) : {};
    });
    const [draggedItemIndex, setDraggedItemIndex] = useState(null);

    const getColumnMinWidth = useCallback((columnId) => {
        const matchedColumn = defaultColumns.find((column) => column.id === columnId);
        return Math.max(parseWidthValue(matchedColumn?.minWidth, 96), 56);
    }, [defaultColumns]);

    useEffect(() => {
        const savedOrder = localStorage.getItem(`${storageKey}_column_order`);
        let sortedColumns = [...defaultColumns];

        if (savedOrder) {
            const orderIds = JSON.parse(savedOrder);
            sortedColumns = [...defaultColumns].sort((first, second) => {
                const firstIndex = orderIds.indexOf(first.id);
                const secondIndex = orderIds.indexOf(second.id);
                if (firstIndex === -1 && secondIndex === -1) return 0;
                if (firstIndex === -1) return 1;
                if (secondIndex === -1) return -1;
                return firstIndex - secondIndex;
            });
        }

        setAvailableColumns(sortedColumns);

        const savedVisible = localStorage.getItem(`${storageKey}_columns`);
        const allIds = sortedColumns.map((column) => column.id);

        if (savedVisible) {
            const savedIds = JSON.parse(savedVisible);
            const nextVisible = allIds.filter((id) => savedIds.includes(id));
            const missingIds = allIds.filter((id) => !nextVisible.includes(id));
            const merged = [...nextVisible, ...missingIds];
            setVisibleColumns(merged);
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(merged));
        } else {
            setVisibleColumns(allIds);
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(allIds));
        }
    }, [storageKey, defaultColumns]);

    useEffect(() => {
        setColumnWidths((prev) => {
            const next = Object.entries(prev || {}).reduce((result, [columnId, width]) => {
                const minWidth = getColumnMinWidth(columnId);
                result[columnId] = Math.max(minWidth, parseWidthValue(width, minWidth));
                return result;
            }, {});

            if (JSON.stringify(next) !== JSON.stringify(prev || {})) {
                localStorage.setItem(`${storageKey}_column_widths`, JSON.stringify(next));
                return next;
            }

            return prev;
        });
    }, [getColumnMinWidth, storageKey]);

    const renderedColumns = useMemo(
        () => availableColumns.filter((column) => visibleColumns.includes(column.id)),
        [availableColumns, visibleColumns]
    );

    const toggleColumn = useCallback((columnId) => {
        setVisibleColumns((prev) => {
            const next = prev.includes(columnId) ? prev.filter((id) => id !== columnId) : [...prev, columnId];
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(next));
            return next;
        });
    }, [storageKey]);

    const handleColumnResize = useCallback((columnId, event) => {
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const minWidth = getColumnMinWidth(columnId);
        const startWidth = Math.max(
            minWidth,
            parseWidthValue(columnWidths[columnId], 0) || event.currentTarget.parentElement.offsetWidth
        );

        let currentWidth = startWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (moveEvent) => {
            currentWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
            setColumnWidths((prev) => ({ ...prev, [columnId]: currentWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setColumnWidths((prev) => {
                const next = { ...prev, [columnId]: currentWidth };
                localStorage.setItem(`${storageKey}_column_widths`, JSON.stringify(next));
                return next;
            });
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [columnWidths, getColumnMinWidth, storageKey]);

    const handleHeaderDragStart = useCallback((event, index) => {
        setDraggedItemIndex(index);
        event.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleHeaderDrop = useCallback((event, targetIndex) => {
        event.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

        const currentRendered = availableColumns.filter((column) => visibleColumns.includes(column.id));
        const draggedColumn = currentRendered[draggedItemIndex];
        const targetColumn = currentRendered[targetIndex];
        if (!draggedColumn || !targetColumn) return;

        const nextColumns = [...availableColumns];
        const draggedAvailableIndex = nextColumns.findIndex((column) => column.id === draggedColumn.id);
        nextColumns.splice(draggedAvailableIndex, 1);
        const targetAvailableIndex = nextColumns.findIndex((column) => column.id === targetColumn.id);
        nextColumns.splice(targetAvailableIndex, 0, draggedColumn);

        setAvailableColumns(nextColumns);
        localStorage.setItem(`${storageKey}_column_order`, JSON.stringify(nextColumns.map((column) => column.id)));
        setDraggedItemIndex(null);
    }, [availableColumns, visibleColumns, draggedItemIndex, storageKey]);

    const totalTableWidth = useMemo(() => renderedColumns.reduce((total, column) => {
        const width = columnWidths[column.id] || column.minWidth;
        return total + parseWidthValue(width, parseWidthValue(column.minWidth, 120));
    }, 40), [renderedColumns, columnWidths]);

    const resetDefault = useCallback(() => {
        const savedDefaultColumns = localStorage.getItem(`${storageKey}_columns_default`);
        const savedDefaultOrder = localStorage.getItem(`${storageKey}_column_order_default`);
        const savedDefaultWidths = localStorage.getItem(`${storageKey}_column_widths_default`);

        if (savedDefaultColumns) {
            const columns = JSON.parse(savedDefaultColumns);
            setVisibleColumns(columns);
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(columns));
        }

        if (savedDefaultOrder) {
            const orderIds = JSON.parse(savedDefaultOrder);
            const nextColumns = [...defaultColumns].sort((first, second) => {
                const firstIndex = orderIds.indexOf(first.id);
                const secondIndex = orderIds.indexOf(second.id);
                if (firstIndex === -1 && secondIndex === -1) return 0;
                if (firstIndex === -1) return 1;
                if (secondIndex === -1) return -1;
                return firstIndex - secondIndex;
            });
            setAvailableColumns(nextColumns);
            localStorage.setItem(`${storageKey}_column_order`, JSON.stringify(orderIds));
        }

        if (savedDefaultWidths) {
            const widths = JSON.parse(savedDefaultWidths);
            setColumnWidths(widths);
            localStorage.setItem(`${storageKey}_column_widths`, JSON.stringify(widths));
        }

        if (!savedDefaultColumns && !savedDefaultOrder && !savedDefaultWidths) {
            localStorage.removeItem(`${storageKey}_column_order`);
            localStorage.removeItem(`${storageKey}_columns`);
            localStorage.removeItem(`${storageKey}_column_widths`);
            window.location.reload();
        }
    }, [storageKey, defaultColumns]);

    const saveAsDefault = useCallback(() => {
        localStorage.setItem(`${storageKey}_columns_default`, JSON.stringify(visibleColumns));
        localStorage.setItem(`${storageKey}_column_order_default`, JSON.stringify(availableColumns.map((column) => column.id)));
        localStorage.setItem(`${storageKey}_column_widths_default`, JSON.stringify(columnWidths));
        window.alert('Đã lưu cấu hình cột mặc định.');
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
        setVisibleColumns,
    };
};
