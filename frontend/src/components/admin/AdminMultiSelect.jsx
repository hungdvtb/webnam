import React, { useEffect, useMemo, useRef, useState } from 'react';

const normalizeValueList = (values) => {
    const normalizedValues = Array.isArray(values) ? values : [values];

    return Array.from(
        new Map(
            normalizedValues
                .map((value) => String(value ?? '').trim())
                .filter(Boolean)
                .map((value) => [value, value])
        ).values()
    );
};

const removeAccents = (value) => (
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
);

const defaultGetOptionValue = (option) => option?.id;
const defaultGetOptionLabel = (option) => option?.name || '';

function AdminMultiSelect({
    options = [],
    value = [],
    onChange,
    placeholder = 'Chọn mục...',
    emptyLabel = 'Không có dữ liệu',
    disabled = false,
    className = '',
    compact = false,
    getOptionValue = defaultGetOptionValue,
    getOptionLabel = defaultGetOptionLabel,
}) {
    const containerRef = useRef(null);
    const searchInputRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const normalizedValues = useMemo(() => normalizeValueList(value), [value]);
    const valueLookup = useMemo(() => new Set(normalizedValues), [normalizedValues]);

    const optionEntries = useMemo(() => (
        (Array.isArray(options) ? options : []).map((option, index) => {
            const optionValue = String(getOptionValue(option) ?? '').trim();
            const optionLabel = String(getOptionLabel(option) ?? '').trim();

            return {
                option,
                value: optionValue || `option-${index}`,
                label: optionLabel || optionValue || `Mục ${index + 1}`,
            };
        })
    ), [getOptionLabel, getOptionValue, options]);

    const optionMap = useMemo(() => new Map(
        optionEntries.map((entry) => [entry.value, entry.label])
    ), [optionEntries]);

    const selectedLabels = useMemo(() => (
        normalizedValues
            .map((selectedValue) => optionMap.get(selectedValue) || selectedValue)
            .filter(Boolean)
    ), [normalizedValues, optionMap]);

    const filteredOptions = useMemo(() => {
        const normalizedSearch = removeAccents(searchTerm).toLowerCase().trim();

        if (!normalizedSearch) {
            return optionEntries;
        }

        return optionEntries.filter((entry) => (
            removeAccents(entry.label).toLowerCase().includes(normalizedSearch)
        ));
    }, [optionEntries, searchTerm]);

    useEffect(() => {
        if (!isOpen) {
            setSearchTerm('');
            return;
        }

        const frameId = window.requestAnimationFrame(() => {
            searchInputRef.current?.focus({ preventScroll: true });
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [isOpen]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const updateValues = (nextValues) => {
        onChange(normalizeValueList(nextValues));
    };

    const toggleValue = (targetValue) => {
        if (valueLookup.has(targetValue)) {
            updateValues(normalizedValues.filter((valueItem) => valueItem !== targetValue));
            return;
        }

        updateValues([...normalizedValues, targetValue]);
    };

    const controlClassName = compact
        ? 'h-[40px] rounded-sm border border-primary/15 bg-white px-3 py-2 text-[12px] font-semibold text-primary'
        : 'h-[40px] rounded-sm border border-primary/15 bg-primary/[0.03] px-3 py-2 text-[13px] font-semibold text-primary';
    const dropdownClassName = compact
        ? 'absolute left-0 right-0 top-full z-[160] mt-1 overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl'
        : 'absolute left-0 right-0 top-full z-[160] mt-2 overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl';
    const summaryText = selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder;

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen((prev) => !prev)}
                disabled={disabled}
                className={`flex w-full items-center justify-between gap-3 text-left transition-all ${controlClassName} ${disabled ? 'cursor-not-allowed opacity-50' : isOpen ? 'border-primary/35 ring-1 ring-primary/10' : 'hover:border-primary/30'}`}
            >
                <div className="min-w-0 flex-1">
                    <div
                        className={`block truncate whitespace-nowrap leading-tight ${selectedLabels.length > 0 ? 'text-primary' : 'text-primary/35'}`}
                        title={summaryText}
                    >
                        {summaryText}
                    </div>
                    {selectedLabels.length > 0 ? (
                        <div className="sr-only">
                            {selectedLabels.length} đã chọn
                        </div>
                    ) : null}
                </div>
                <span className={`material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-primary/45 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    expand_more
                </span>
            </button>

            {isOpen ? (
                <div className={dropdownClassName}>
                    <div className="border-b border-primary/10 bg-white p-3">
                        <div className="flex items-center gap-2 rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2">
                            <span className="material-symbols-outlined text-[16px] text-primary/40">search</span>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Tìm danh mục..."
                                className="w-full bg-transparent text-[13px] text-primary placeholder:text-primary/30 focus:outline-none"
                            />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => updateValues(optionEntries.map((entry) => entry.value))}
                                className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary/65 transition-colors hover:text-primary"
                            >
                                Chọn tất cả
                            </button>
                            <button
                                type="button"
                                onClick={() => updateValues([])}
                                className="text-[11px] font-bold uppercase tracking-[0.14em] text-brick transition-colors hover:text-brick/80"
                            >
                                Bỏ chọn hết
                            </button>
                        </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto custom-scrollbar py-1">
                        {filteredOptions.length > 0 ? filteredOptions.map((entry) => {
                            const checked = valueLookup.has(entry.value);

                            return (
                                <label
                                    key={entry.value}
                                    className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors ${checked ? 'bg-primary/[0.04]' : 'hover:bg-primary/[0.03]'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleValue(entry.value)}
                                        className="mt-0.5 size-4 shrink-0 accent-primary"
                                    />
                                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-primary" title={entry.label}>
                                        {entry.label}
                                    </span>
                                </label>
                            );
                        }) : (
                            <div className="px-4 py-6 text-center text-[12px] italic text-primary/35">
                                {emptyLabel}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export default AdminMultiSelect;
