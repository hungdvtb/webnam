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

    const labelClassName = isAdmin
        ? 'block text-[11px] font-bold uppercase tracking-widest text-primary/70'
        : 'font-ui text-xs font-bold uppercase tracking-widest text-primary block';

    const controlClassName = isAdmin
        ? `w-full h-10 min-w-0 bg-primary/5 border border-primary/10 rounded-sm px-2.5 text-[12px] font-medium text-[#0F172A] transition-all flex items-center justify-between gap-2 ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100' : 'cursor-pointer hover:border-primary/30'} ${isOpen ? 'border-primary/30 ring-1 ring-primary/10 bg-white shadow-sm' : ''}`
        : `${disabled ? 'bg-stone/5 opacity-50 cursor-not-allowed' : 'hover:border-primary'} ${isOpen ? 'border-primary shadow-lg ring-1 ring-primary/10' : ''} ${compact ? 'border-none p-0 font-display text-[11.5px] font-bold' : 'border border-gold/20 p-4 font-body cursor-pointer'} w-full bg-white flex items-center justify-between transition-all`;

    const valueClassName = isAdmin
        ? `min-w-0 flex-1 leading-tight ${!value ? 'text-primary/35' : 'text-[#0F172A]'} truncate`
        : `${compact ? '' : 'text-sm tracking-tight'} ${!value ? 'text-stone/50 italic' : 'text-primary uppercase font-bold'}`;

    const iconClassName = isAdmin
        ? `material-symbols-outlined text-primary/40 text-[18px] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`
        : `material-symbols-outlined text-gold transition-transform duration-300 ${isOpen ? 'rotate-180' : ''} ${compact ? 'text-[16px]' : ''}`;

    const dropdownClassName = isAdmin
        ? 'absolute z-[120] top-full left-0 right-0 mt-1 overflow-hidden rounded-sm border border-primary/20 bg-white shadow-2xl'
        : `absolute z-[105] top-full left-0 right-0 mt-2 bg-white border-2 border-primary shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${compact ? 'min-w-[200px]' : ''}`;

    const searchWrapClassName = isAdmin
        ? 'p-2 border-b border-primary/10 bg-white'
        : 'p-3 border-b border-gold/10 sticky top-0 bg-white';

    const searchBoxClassName = isAdmin
        ? 'flex items-center gap-2 bg-primary/5 px-3 h-9 border border-primary/10 rounded-sm'
        : 'flex items-center gap-2 bg-stone/5 p-2 border border-gold/10';

    const searchInputClassName = isAdmin
        ? 'w-full bg-transparent border-none focus:outline-none text-[13px] text-[#0F172A]'
        : 'w-full bg-transparent border-none focus:outline-none font-body text-sm text-primary';

    const optionClassName = isAdmin
        ? 'px-3 py-2 text-[13px] hover:bg-primary/5 cursor-pointer transition-colors flex items-center justify-between gap-3'
        : 'px-6 py-3 font-body text-sm hover:bg-gold/5 cursor-pointer transition-colors flex justify-between items-center';

    const optionActiveClassName = isAdmin
        ? 'bg-primary/5 text-primary font-bold border-l-2 border-primary'
        : 'bg-gold/10 text-primary font-bold shadow-inner border-l-4 border-gold';

    const emptyStateClassName = isAdmin
        ? 'px-3 py-6 text-center text-primary/40 text-[12px] italic'
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
                    {!isAdmin && !compact && <div className="h-0.5 w-full bg-gradient-to-r from-gold/0 via-gold to-gold/0 mb-2"></div>}

                    <div className={searchWrapClassName}>
                        <div className={searchBoxClassName}>
                            <span className={`material-symbols-outlined ${isAdmin ? 'text-primary/40 text-[16px]' : 'text-gold text-lg'}`}>search</span>
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

                    <div className={`max-h-[250px] overflow-y-auto ${isAdmin ? 'custom-scrollbar' : 'scrollbar-thin scrollbar-thumb-gold/20 scrollbar-track-transparent'}`}>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, index) => {
                                const optionValue = getOptionLabel(option);

                                return (
                                    <div
                                        key={`${optionValue}-${index}`}
                                        className={`${optionClassName} ${value === optionValue ? optionActiveClassName : isAdmin ? 'text-[#0F172A]' : 'text-stone hover:text-primary'}`}
                                        onClick={() => handleSelect(option)}
                                    >
                                        <span className={isAdmin ? 'truncate' : 'uppercase tracking-tight'}>{optionValue}</span>
                                        {value === optionValue && (
                                            <span className={`material-symbols-outlined ${isAdmin ? 'text-primary text-[16px]' : 'text-gold text-sm animate-in fade-in scale-in duration-300'}`}>
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
