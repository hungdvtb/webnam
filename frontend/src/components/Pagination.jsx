import React from 'react';

const Pagination = ({ pagination, onPageChange }) => {
    const { current_page, last_page, total, per_page } = pagination;

    if (last_page <= 1) return null;

    const pages = [];
    const maxVisible = 5;
    
    let start = Math.max(1, current_page - Math.floor(maxVisible / 2));
    let end = Math.min(last_page, start + maxVisible - 1);
    
    if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
        pages.push(i);
    }

    return (
        <div className="flex items-center gap-2">
            <button
                disabled={current_page === 1}
                onClick={() => onPageChange(current_page - 1)}
                className="size-8 flex items-center justify-center border border-gold/20 text-primary disabled:opacity-30 hover:bg-gold/10 transition-colors"
            >
                <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>

            {start > 1 && (
                <>
                    <button onClick={() => onPageChange(1)} className="size-8 flex items-center justify-center border border-gold/20 text-xs font-bold hover:bg-gold/10">1</button>
                    {start > 2 && <span className="text-stone px-1">...</span>}
                </>
            )}

            {pages.map(p => (
                <button
                    key={p}
                    onClick={() => onPageChange(p)}
                    className={`size-8 flex items-center justify-center border text-xs font-bold transition-all ${current_page === p ? 'bg-primary text-white border-primary shadow-lg scale-110' : 'border-gold/20 text-primary hover:bg-gold/10'}`}
                >
                    {p}
                </button>
            ))}

            {end < last_page && (
                <>
                    {end < last_page - 1 && <span className="text-stone px-1">...</span>}
                    <button onClick={() => onPageChange(last_page)} className="size-8 flex items-center justify-center border border-gold/20 text-xs font-bold hover:bg-gold/10">{last_page}</button>
                </>
            )}

            <button
                disabled={current_page === last_page}
                onClick={() => onPageChange(current_page + 1)}
                className="size-8 flex items-center justify-center border border-gold/20 text-primary disabled:opacity-30 hover:bg-gold/10 transition-colors"
            >
                <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
        </div>
    );
};

export default Pagination;
