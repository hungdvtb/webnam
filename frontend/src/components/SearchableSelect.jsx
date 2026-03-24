import React, { useEffect, useMemo, useRef, useState } from 'react';

const removeAccents = (str) => {
    if (!str) return '';

    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
};

const getOptionLabel = (option) => (typeof option === 'string' ? option : option?.name || '');

const SearchableSelect = ({
    options = [],
    value,
    onChange,
    placeholder = 'Chọn một mục...',
    label,
    name,
    disabled = false,
    required = false,
    compact = false,
    className = '',
    variant = 'storefront'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef(null);

    const filteredOptions = useMemo(() => {
        const filtered = options.filter((option) => {
            const target = getOptionLabel(option);
            const normalizedTarget = removeAccents(target).toLowerCase();
            const normalizedSearch = removeAccents(searchTerm).toLowerCase();

            return normalizedTarget.includes(normalizedSearch);
        });

        if (!value) return filtered;

        const selectedIndex = filtered.findIndex((option) => getOptionLabel(option) === value);
        if (selectedIndex <= 0) return filtered;

        return [
            filtered[selectedIndex],
            ...filtered.slice(0, selectedIndex),
            ...filtered.slice(selectedIndex + 1)
        ];
    }, [options, searchTerm, value]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (option) => {
        const selectedValue = getOptionLabel(option);
        onChange({ target: { name, value: selectedValue } });
        setIsOpen(false);
        setSearchTerm('');
    };

    const isAdmin = variant === 'admin';
    const isLegacyMobile = variant === 'legacy-mobile';

    const labelClassName = isAdmin
        ? 'block text-[11px] font-bold uppercase tracking-widest text-primary/70'
        : isLegacyMobile
            ? 'block text-[11px] font-black uppercase tracking-[0.18em] text-stone-700'
            : 'font-ui text-xs font-bold uppercase tracking-widest text-primary block';

    const controlClassName = isAdmin
        ? `w-full h-10 min-w-0 bg-primary/5 border border-primary/10 rounded-sm px-2.5 text-[12px] font-medium text-[#0F172A] transition-all flex items-center justify-between gap-2 ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100' : 'cursor-pointer hover:border-primary/30'} ${isOpen ? 'border-primary/30 ring-1 ring-primary/10 bg-white shadow-sm' : ''}`
        : isLegacyMobile
            ? `min-h-[52px] w-full rounded-2xl border px-4 py-3 text-sm font-medium transition-all flex items-center justify-between gap-3 ${disabled ? 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 opacity-70' : 'cursor-pointer border-stone-200 bg-stone-50 text-stone-800 hover:border-primary/40 hover:bg-white'} ${isOpen ? 'border-primary bg-white shadow-lg ring-2 ring-primary/10' : ''}`
            : `${disabled ? 'bg-stone/5 opacity-50 cursor-not-allowed' : 'hover:border-primary'} ${isOpen ? 'border-primary shadow-lg ring-1 ring-primary/10' : ''} ${compact ? 'border-none p-0 font-display text-[11.5px] font-bold' : 'border border-gold/20 p-4 font-body cursor-pointer'} w-full bg-white flex items-center justify-between transition-all`;

    const valueClassName = isAdmin
        ? `min-w-0 flex-1 leading-tight ${!value ? 'text-primary/35' : 'text-[#0F172A]'} truncate`
        : isLegacyMobile
            ? `min-w-0 flex-1 truncate text-sm leading-snug ${!value ? 'text-stone-400' : 'text-stone-900'}`
            : `${compact ? '' : 'text-sm tracking-tight'} ${!value ? 'text-stone/50 italic' : 'text-primary uppercase font-bold'}`;

    const iconClassName = isAdmin
        ? `material-symbols-outlined text-primary/40 text-[18px] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`
        : isLegacyMobile
            ? `material-symbols-outlined text-[20px] text-stone-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary' : ''}`
            : `material-symbols-outlined text-gold transition-transform duration-300 ${isOpen ? 'rotate-180' : ''} ${compact ? 'text-[16px]' : ''}`;

    const dropdownClassName = isAdmin
        ? 'absolute z-[120] top-full left-0 right-0 mt-1 overflow-hidden rounded-sm border border-primary/20 bg-white shadow-2xl'
        : isLegacyMobile
            ? 'absolute z-[120] top-full left-0 right-0 mt-2 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl'
            : `absolute z-[105] top-full left-0 right-0 mt-2 bg-white border-2 border-primary shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${compact ? 'min-w-[200px]' : ''}`;

    const searchWrapClassName = isAdmin
        ? 'p-2 border-b border-primary/10 bg-white'
        : isLegacyMobile
            ? 'sticky top-0 border-b border-stone-100 bg-white p-3'
            : 'p-3 border-b border-gold/10 sticky top-0 bg-white';

    const searchBoxClassName = isAdmin
        ? 'flex items-center gap-2 bg-primary/5 px-3 h-9 border border-primary/10 rounded-sm'
        : isLegacyMobile
            ? 'flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5'
            : 'flex items-center gap-2 bg-stone/5 p-2 border border-gold/10';

    const searchInputClassName = isAdmin
        ? 'w-full bg-transparent border-none focus:outline-none text-[13px] text-[#0F172A]'
        : isLegacyMobile
            ? 'w-full bg-transparent border-none text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none'
            : 'w-full bg-transparent border-none focus:outline-none font-body text-sm text-primary';

    const optionClassName = isAdmin
        ? 'px-3 py-2 text-[13px] hover:bg-primary/5 cursor-pointer transition-colors flex items-center justify-between gap-3'
        : isLegacyMobile
            ? 'flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-primary/5'
            : 'px-6 py-3 font-body text-sm hover:bg-gold/5 cursor-pointer transition-colors flex justify-between items-center';

    const optionActiveClassName = isAdmin
        ? 'bg-primary/5 text-primary font-bold border-l-2 border-primary'
        : isLegacyMobile
            ? 'border-l-2 border-primary bg-primary/5 text-primary font-bold'
            : 'bg-gold/10 text-primary font-bold shadow-inner border-l-4 border-gold';

    const emptyStateClassName = isAdmin
        ? 'px-3 py-6 text-center text-primary/40 text-[12px] italic'
        : isLegacyMobile
            ? 'px-4 py-6 text-center text-xs font-medium text-stone-400'
            : 'px-6 py-8 text-center text-stone italic text-xs font-ui uppercase tracking-widest opacity-50';

    return (
        <div className={`${isAdmin ? 'space-y-1' : 'space-y-2'} relative ${className}`} ref={containerRef}>
            {label && (
                <label className={labelClassName}>
                    {label} {required && <span className="text-red-500">*</span>}
                </label>
            )}

            <div className={controlClassName} onClick={() => !disabled && setIsOpen((prev) => !prev)}>
                <span className={valueClassName} title={value || placeholder}>{value || placeholder}</span>
                <span className={iconClassName}>expand_more</span>
            </div>

            {isOpen && !disabled && (
                <div className={dropdownClassName}>
                    {!isAdmin && !compact && !isLegacyMobile && <div className="mb-2 h-0.5 w-full bg-gradient-to-r from-gold/0 via-gold to-gold/0"></div>}

                    <div className={searchWrapClassName}>
                        <div className={searchBoxClassName}>
                            <span className={`material-symbols-outlined ${isAdmin ? 'text-primary/40 text-[16px]' : isLegacyMobile ? 'text-stone-400 text-[18px]' : 'text-gold text-lg'}`}>search</span>
                            <input
                                type="text"
                                className={searchInputClassName}
                                placeholder={isAdmin ? 'Tìm nhanh...' : 'Tìm kiếm nhanh...'}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className={`max-h-[250px] overflow-y-auto ${isAdmin ? 'custom-scrollbar' : isLegacyMobile ? 'custom-scrollbar' : 'scrollbar-thin scrollbar-thumb-gold/20 scrollbar-track-transparent'}`}>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, index) => {
                                const optionValue = getOptionLabel(option);

                                return (
                                    <div
                                        key={`${optionValue}-${index}`}
                                        className={`${optionClassName} ${value === optionValue ? optionActiveClassName : isAdmin ? 'text-[#0F172A]' : 'text-stone hover:text-primary'}`}
                                        onClick={() => handleSelect(option)}
                                    >
                                        <span className={isAdmin ? 'truncate' : isLegacyMobile ? 'truncate leading-snug' : 'uppercase tracking-tight'}>{optionValue}</span>
                                        {value === optionValue && (
                                            <span className={`material-symbols-outlined ${isAdmin ? 'text-primary text-[16px]' : isLegacyMobile ? 'text-primary text-[18px]' : 'text-gold text-sm animate-in fade-in scale-in duration-300'}`}>
                                                check
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className={emptyStateClassName}>Không tìm thấy kết quả</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
