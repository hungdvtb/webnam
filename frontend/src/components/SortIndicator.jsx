import React from 'react';

const SortIndicator = ({ colId, sortConfig, showNeutral = false }) => {
    const isActive = sortConfig?.key === colId && sortConfig?.direction !== 'none';

    if (!isActive && !showNeutral) return null;

    return (
        <span className="inline-flex flex-col items-center justify-center text-[9px] leading-none">
            <span className={isActive && sortConfig.direction === 'asc' ? 'text-primary' : 'text-primary/25'}>↑</span>
            <span className={isActive && sortConfig.direction === 'desc' ? 'text-primary' : 'text-primary/25'}>↓</span>
        </span>
    );
};

export default SortIndicator;
