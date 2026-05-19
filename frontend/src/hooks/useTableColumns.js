import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const parseWidthValue = (value, fallback = 0) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.replace('px', ''), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
};

const readJsonFromStorage = (key, fallback = null) => {
    if (typeof window === 'undefined') return fallback;

    try {
        const saved = window.localStorage.getItem(key);
        return saved ? JSON.parse(saved) : fallback;
    } catch (error) {
        console.warn(`Cannot parse table column setting: ${key}`, error);
        return fallback;
    }
};

const writeJsonToStorage = (key, value) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(value));
};

const removeStorageItem = (key) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
};

const readStoredColumnWidths = (storageKey) => {
    const saved = readJsonFromStorage(`${storageKey}_column_widths`, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
};

const sortColumnsBySavedOrder = (columns, orderIds) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return [...columns];
    }

    return [...columns].sort((first, second) => {
        const firstIndex = orderIds.indexOf(first.id);
        const secondIndex = orderIds.indexOf(second.id);
        if (firstIndex === -1 && secondIndex === -1) return 0;
        if (firstIndex === -1) return 1;
        if (secondIndex === -1) return -1;
        return firstIndex - secondIndex;
    });
};

const getSystemVisibleColumnIds = (columns) => {
    const allIds = columns.map((column) => column.id);
    const defaultVisibleIds = columns
        .filter((column) => !column.hidden)
        .map((column) => column.id);

    return defaultVisibleIds.length > 0 ? defaultVisibleIds : allIds;
};

export const useTableColumns = (storageKey, defaultColumns, options = {}) => {
    const resetDefaultToSystem = options.resetDefaultToSystem === true;
    const [visibleColumns, setVisibleColumns] = useState([]);
    const [availableColumns, setAvailableColumns] = useState([]);
    const [columnWidths, setColumnWidths] = useState(() => readStoredColumnWidths(storageKey));
    const [draggedItemIndex, setDraggedItemIndex] = useState(null);
    const [resizingColumnId, setResizingColumnId] = useState(null);
    const columnWidthsStorageKeyRef = useRef(storageKey);

    const getColumnMinWidth = useCallback((columnId) => {
        const matchedColumn = defaultColumns.find((column) => column.id === columnId);
        return Math.max(parseWidthValue(matchedColumn?.minWidth, 96), 56);
    }, [defaultColumns]);

    useEffect(() => {
        const savedOrder = readJsonFromStorage(`${storageKey}_column_order`, []);
        const orderIds = Array.isArray(savedOrder) ? savedOrder : [];
        const sortedColumns = sortColumnsBySavedOrder(defaultColumns, orderIds);

        setAvailableColumns(sortedColumns);

        const savedVisible = readJsonFromStorage(`${storageKey}_columns`, null);
        const allIds = sortedColumns.map((column) => column.id);
        const fallbackVisibleIds = getSystemVisibleColumnIds(sortedColumns);

        if (Array.isArray(savedVisible)) {
            const nextVisible = savedVisible.filter((id) => allIds.includes(id));
            const knownIds = (orderIds.length > 0 ? orderIds : savedVisible).filter((id) => allIds.includes(id));
            const addedVisibleIds = sortedColumns
                .filter((column) => !column.hidden && !knownIds.includes(column.id) && !nextVisible.includes(column.id))
                .map((column) => column.id);
            const sanitizedVisible = [...nextVisible, ...addedVisibleIds];
            const nextVisibleColumns = sanitizedVisible.length > 0 ? sanitizedVisible : fallbackVisibleIds;
            setVisibleColumns(nextVisibleColumns);
            writeJsonToStorage(`${storageKey}_columns`, nextVisibleColumns);
        } else {
            setVisibleColumns(fallbackVisibleIds);
            writeJsonToStorage(`${storageKey}_columns`, fallbackVisibleIds);
        }
    }, [storageKey, defaultColumns]);

    useEffect(() => {
        setColumnWidths((prev) => {
            const storedWidths = Object.keys(prev || {}).length === 0
                ? readStoredColumnWidths(storageKey)
                : {};
            const sourceWidths = columnWidthsStorageKeyRef.current === storageKey
                ? prev
                : readStoredColumnWidths(storageKey);
            const widthsToSanitize = columnWidthsStorageKeyRef.current === storageKey && Object.keys(storedWidths).length > 0
                ? storedWidths
                : sourceWidths;

            columnWidthsStorageKeyRef.current = storageKey;

            const next = Object.entries(widthsToSanitize || {}).reduce((result, [columnId, width]) => {
                const minWidth = getColumnMinWidth(columnId);
                result[columnId] = Math.max(minWidth, parseWidthValue(width, minWidth));
                return result;
            }, {});

            if (JSON.stringify(next) !== JSON.stringify(widthsToSanitize || {})) {
                writeJsonToStorage(`${storageKey}_column_widths`, next);
                return next;
            }

            return widthsToSanitize;
        });
    }, [getColumnMinWidth, storageKey]);

    const renderedColumns = useMemo(
        () => availableColumns.filter((column) => visibleColumns.includes(column.id)),
        [availableColumns, visibleColumns]
    );

    const toggleColumn = useCallback((columnId) => {
        setVisibleColumns((prev) => {
            const next = prev.includes(columnId) ? prev.filter((id) => id !== columnId) : [...prev, columnId];
            writeJsonToStorage(`${storageKey}_columns`, next);
            return next;
        });
    }, [storageKey]);

    const handleColumnResize = useCallback((columnId, event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const minWidth = getColumnMinWidth(columnId);
        const startWidth = Math.max(
            minWidth,
            parseWidthValue(columnWidths[columnId], 0) || event.currentTarget.parentElement.offsetWidth
        );

        let currentWidth = startWidth;
        setResizingColumnId(columnId);
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
            setResizingColumnId(null);
            setColumnWidths((prev) => {
                const next = { ...prev, [columnId]: currentWidth };
                writeJsonToStorage(`${storageKey}_column_widths`, next);
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
        writeJsonToStorage(`${storageKey}_column_order`, nextColumns.map((column) => column.id));
        setDraggedItemIndex(null);
    }, [availableColumns, visibleColumns, draggedItemIndex, storageKey]);

    const totalTableWidth = useMemo(() => renderedColumns.reduce((total, column) => {
        const width = columnWidths[column.id] || column.minWidth;
        return total + parseWidthValue(width, parseWidthValue(column.minWidth, 120));
    }, 40), [renderedColumns, columnWidths]);

    const resetDefault = useCallback(() => {
        if (!resetDefaultToSystem) {
            const savedDefaultColumns = readJsonFromStorage(`${storageKey}_columns_default`, null);
            const savedDefaultOrder = readJsonFromStorage(`${storageKey}_column_order_default`, null);
            const savedDefaultWidths = readJsonFromStorage(`${storageKey}_column_widths_default`, null);

            if (Array.isArray(savedDefaultColumns)) {
                setVisibleColumns(savedDefaultColumns);
                writeJsonToStorage(`${storageKey}_columns`, savedDefaultColumns);
            }

            if (Array.isArray(savedDefaultOrder)) {
                const nextColumns = sortColumnsBySavedOrder(defaultColumns, savedDefaultOrder);
                setAvailableColumns(nextColumns);
                writeJsonToStorage(`${storageKey}_column_order`, savedDefaultOrder);
            }

            if (savedDefaultWidths && typeof savedDefaultWidths === 'object' && !Array.isArray(savedDefaultWidths)) {
                setColumnWidths(savedDefaultWidths);
                writeJsonToStorage(`${storageKey}_column_widths`, savedDefaultWidths);
            }

            if (!savedDefaultColumns && !savedDefaultOrder && !savedDefaultWidths) {
                removeStorageItem(`${storageKey}_column_order`);
                removeStorageItem(`${storageKey}_columns`);
                removeStorageItem(`${storageKey}_column_widths`);
                if (typeof window !== 'undefined') {
                    window.location.reload();
                }
            }

            return;
        }

        const systemColumns = [...defaultColumns];
        const systemVisibleColumns = getSystemVisibleColumnIds(systemColumns);
        const systemColumnOrder = systemColumns.map((column) => column.id);

        setVisibleColumns(systemVisibleColumns);
        setAvailableColumns(systemColumns);
        setColumnWidths({});
        setDraggedItemIndex(null);

        writeJsonToStorage(`${storageKey}_columns`, systemVisibleColumns);
        writeJsonToStorage(`${storageKey}_column_order`, systemColumnOrder);
        removeStorageItem(`${storageKey}_column_widths`);
        removeStorageItem(`${storageKey}_columns_default`);
        removeStorageItem(`${storageKey}_column_order_default`);
        removeStorageItem(`${storageKey}_column_widths_default`);
    }, [storageKey, defaultColumns, resetDefaultToSystem]);

    const saveAsDefault = useCallback(() => {
        const columnIds = availableColumns.map((column) => column.id);
        const normalizedVisibleColumns = visibleColumns.filter((columnId) => columnIds.includes(columnId));

        writeJsonToStorage(`${storageKey}_columns`, normalizedVisibleColumns);
        writeJsonToStorage(`${storageKey}_column_order`, columnIds);
        writeJsonToStorage(`${storageKey}_column_widths`, columnWidths);
        writeJsonToStorage(`${storageKey}_columns_default`, normalizedVisibleColumns);
        writeJsonToStorage(`${storageKey}_column_order_default`, columnIds);
        writeJsonToStorage(`${storageKey}_column_widths_default`, columnWidths);
        window.alert('Đã lưu cấu hình cột mặc định.');
    }, [storageKey, visibleColumns, availableColumns, columnWidths]);

    return {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        resizingColumnId,
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
