import React from 'react';

const SortIndicator = ({ colId, sortConfig }) => {
    if (sortConfig.key !== colId || sortConfig.direction === 'none') return null;
    return (
        <span className="material-symbols-outlined text-[14px] text-primary">
            {sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward'}
        </span>
    );
};

export default SortIndicator;
