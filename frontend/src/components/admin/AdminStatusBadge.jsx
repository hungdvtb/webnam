import React from 'react';
import { DEFAULT_STATUS_BADGE_COLOR, getStatusBadgeStyle } from '../../utils/statusBadge';

const AdminStatusBadge = ({
    as: Component = 'span',
    color,
    label,
    lines,
    icon,
    className = '',
    textClassName = '',
    iconClassName = '',
    style,
    children,
    title,
    ...props
}) => {
    const resolvedLines = Array.isArray(lines) && lines.length
        ? lines.filter(Boolean)
        : [label || '-'];
    const isMultiline = !children && resolvedLines.length > 1;
    const mergedClassName = ['admin-order-status-badge', className].filter(Boolean).join(' ');
    const mergedTextClassName = [
        'admin-order-status-badge__text',
        isMultiline ? 'admin-order-status-badge__text--multiline' : 'truncate',
        textClassName,
    ].filter(Boolean).join(' ');

    return (
        <Component
            className={mergedClassName}
            style={{ ...getStatusBadgeStyle(color, DEFAULT_STATUS_BADGE_COLOR), ...style }}
            title={title || resolvedLines.join(' ')}
            {...props}
        >
            <span className={mergedTextClassName}>
                {children || resolvedLines.map((line, index) => (
                    <span key={`${line}-${index}`} className={isMultiline ? 'whitespace-nowrap' : ''}>
                        {line}
                    </span>
                ))}
            </span>
            {icon ? (
                <span className={`admin-order-status-badge__icon material-symbols-outlined ${iconClassName}`.trim()}>
                    {icon}
                </span>
            ) : null}
        </Component>
    );
};

export default AdminStatusBadge;
