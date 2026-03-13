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

    const btnClass = "size-8 flex items-center justify-center border border-primary/30 text-[#0F172A] font-display text-[13px] font-black transition-all rounded-sm hover:border-primary hover:text-primary hover:bg-primary/5 disabled:opacity-30 disabled:pointer-events-none bg-white";
    const activeClass = "bg-primary text-white border-primary shadow-md z-10 scale-105";

    return (
        <div className="flex items-center gap-1.5 font-display">
            <button
                disabled={current_page === 1}
                onClick={() => onPageChange(current_page - 1)}
                className={btnClass}
                title="Trang trước"
            >
                <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>

            {start > 1 && (
                <React.Fragment>
                    <button onClick={() => onPageChange(1)} className={btnClass}>1</button>
                    {start > 2 && <span className="text-primary/40 px-1 text-[13px] font-bold uppercase tracking-tighter">...</span>}
                </React.Fragment>
            )}

            {pages.map(p => (
                <button
                    key={p}
                    onClick={() => onPageChange(p)}
                    className={`${btnClass} ${current_page === p ? activeClass : 'bg-white'}`}
                >
                    {p}
                </button>
            ))}

            {end < last_page && (
                <React.Fragment>
                    {end < last_page - 1 && <span className="text-primary/40 px-1 text-[13px] font-bold uppercase tracking-tighter">...</span>}
                    <button onClick={() => onPageChange(last_page)} className={btnClass}>{last_page}</button>
                </React.Fragment>
            )}

            <button
                disabled={current_page === last_page}
                onClick={() => onPageChange(current_page + 1)}
                className={btnClass}
                title="Trang sau"
            >
                <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
        </div>
    );
};

export default Pagination;
