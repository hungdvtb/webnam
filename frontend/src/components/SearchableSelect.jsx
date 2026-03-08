import React, { useState, useRef, useEffect } from 'react';

const SearchableSelect = ({
    options,
    value,
    onChange,
    placeholder = 'Chọn một mục...',
    label,
    name,
    disabled = false,
    required = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef(null);

    const removeAccents = (str) => {
        if (!str) return '';
        return str.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/g, "d")
            .replace(/Đ/g, "D");
    };

    // Filter options based on search term (accent-insensitive)
    const filteredOptions = options.filter(option => {
        const target = typeof option === 'string' ? option : option.name;
        const normalizedTarget = removeAccents(target || '').toLowerCase();
        const normalizedSearch = removeAccents(searchTerm).toLowerCase();
        return normalizedTarget.includes(normalizedSearch);
    });

    // Close dropdown on click outside
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
        const selectedValue = typeof option === 'string' ? option : option.name;
        // Mocking an event object for compatibility with common change handlers
        onChange({ target: { name, value: selectedValue } });
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div className="space-y-2 relative" ref={containerRef}>
            {label && (
                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary block">
                    {label} {required && <span className="text-red-500">*</span>}
                </label>
            )}

            <div
                className={`w-full bg-white border border-gold/20 p-4 font-body cursor-pointer flex justify-between items-center transition-all ${disabled ? 'bg-stone/5 opacity-50 cursor-not-allowed' : 'hover:border-primary'} ${isOpen ? 'border-primary shadow-lg ring-1 ring-primary/10' : ''}`}
                onClick={() => !disabled && setIsOpen(!isOpen)}
            >
                <span className={!value ? 'text-stone/50 italic' : 'text-primary uppercase font-bold text-sm tracking-tight'}>
                    {value || placeholder}
                </span>
                <span className={`material-symbols-outlined text-gold transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                    expand_more
                </span>
            </div>

            {/* Dropdown Menu */}
            {isOpen && !disabled && (
                <div className="absolute z-[100] top-full left-0 right-0 mt-2 bg-white border-2 border-primary shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                    {/* Decorative gold line */}
                    <div className="h-0.5 bg-gradient-to-r from-gold/0 via-gold to-gold/0 w-full mb-2"></div>

                    <div className="p-3 border-b border-gold/10 sticky top-0 bg-white">
                        <div className="flex items-center gap-2 bg-stone/5 p-2 border border-gold/10">
                            <span className="material-symbols-outlined text-gold text-lg">search</span>
                            <input
                                type="text"
                                className="w-full bg-transparent border-none focus:outline-none font-body text-sm text-primary"
                                placeholder="Tìm kiếm nhanh..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="max-h-[250px] overflow-y-auto scrollbar-thin scrollbar-thumb-gold/20 scrollbar-track-transparent">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, index) => {
                                const optionValue = typeof option === 'string' ? option : option.name;
                                return (
                                    <div
                                        key={index}
                                        className={`px-6 py-3 font-body text-sm hover:bg-gold/5 cursor-pointer transition-colors flex justify-between items-center ${value === optionValue ? 'bg-gold/10 text-primary font-bold shadow-inner border-l-4 border-gold' : 'text-stone hover:text-primary'}`}
                                        onClick={() => handleSelect(option)}
                                    >
                                        <span className="uppercase tracking-tight">{optionValue}</span>
                                        {value === optionValue && (
                                            <span className="material-symbols-outlined text-gold text-sm animate-in fade-in scale-in duration-300">check</span>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="px-6 py-8 text-center text-stone italic text-xs font-ui uppercase tracking-widest opacity-50">
                                Không tìm thấy kết quả
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
