import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api, { orderAiTrainingApi, orderApi, productApi, leadApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import SearchableSelect from '../../components/SearchableSelect';
import OrderSupplementItemsSection from '../../components/admin/OrderSupplementItemsSection';
import OrderAiSearchPanel from '../../components/admin/OrderAiSearchPanel';
import OrderAiRuleManagerModal from '../../components/admin/OrderAiRuleManagerModal';
import ProductBulkReplaceModal from '../../components/admin/ProductBulkReplaceModal';
import {
    ORDER_TYPE_OPTIONS,
    ORDER_TYPE_EXCHANGE_RETURN,
    ORDER_TYPE_PARTIAL_DELIVERY,
    ORDER_TYPE_STANDARD,
    getSupplementReturnStatusLabel,
    getOrderTypeMeta,
    isSpecialOrderType,
    normalizeSupplementReturnStatus,
    normalizeOrderType,
    SUPPLEMENT_RETURN_STATUS_NOT_RETURNED,
} from '../../config/orderTypes';
import {
    DEFAULT_MANUAL_ORDER_SOURCE,
    ORDER_SOURCE_OPTIONS,
    UNKNOWN_ORDER_SOURCE,
    getOrderSourceMeta,
    normalizeOrderSource,
} from '../../config/orderSources';
import { writeLeadListReturnHint } from '../../utils/leadListViewState';
import {
    getOrderItemActualDisplayName,
    getOrderItemActualDisplaySku,
    getOrderItemDisplayName,
    getOrderItemDisplaySku,
    hasOrderItemActualProductOverride,
    getOrderItemSnapshotName,
    getOrderItemSnapshotSku,
} from '../../utils/orderItemDisplay';
import { VN_REGIONS } from '../../data/regions';
import {
    buildRegionPath,
    buildShippingAddress,
    extractCustomerInfoFromText,
    extractAddressDetail,
    parseAdministrativeAddress,
    sortRegionObjects,
    sortRegionStrings,
    validateVietnamesePhone
} from '../../utils/administrativeUnits';
import {
    calculateGrossProfitTotal,
    calculateRoundedImportCostLineTotal,
    formatRoundedImportCost,
    normalizeRoundedImportCostNumber,
} from '../../utils/money';
import { buildOrderAiPickerEntries, buildOrderAiQuickRuleOptions, normalizeOrderAiRules } from '../../utils/orderAiRules';
import { hasAdminPermission } from '../../utils/adminPermissions';

const AdminSection = ({ icon, title, children, className = '', bodyClassName = '' }) => (
    <section className={`bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden ${className}`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.02]">
            <span className="material-symbols-outlined text-[18px] text-primary/50">{icon}</span>
            <h3 className="text-[16px] font-bold leading-[1.45] text-primary">{title}</h3>
        </div>
        <div className={`p-4 space-y-[10px] ${bodyClassName}`}>{children}</div>
    </section>
);

const AdminField = ({ label, children, required = false, className = '' }) => (
    <div className={`space-y-1 ${className}`}>
        <label className="block text-[14px] font-semibold leading-[1.45] text-primary/72">
            {label}
            {required && <span className="text-brick"> *</span>}
        </label>
        {children}
    </div>
);

const Field = ({ label, children, className = '', labelClassName = '', labelStyle }) => (
    React.Children.toArray(children).some((child) => React.isValidElement(child) && child.props?.readOnly && child.props?.name === 'shipping_address')
        ? null
        : (
            <div className={`space-y-1 ${className}`}>
                <label className={`block text-[14px] font-semibold leading-[1.45] text-primary/72 ${labelClassName}`} style={labelStyle}>{label}</label>
                {children}
            </div>
        )
);

const adminInputClassName = 'w-full min-h-[44px] bg-primary/5 border border-primary/10 px-3 rounded-sm text-[14px] leading-[1.55] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all';
const adminTextareaClassName = 'w-full min-h-[96px] bg-primary/5 border border-primary/10 px-3 py-2.5 rounded-sm text-[14px] leading-[1.55] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all resize-none';
const adminRegionFieldClassName = 'group relative min-w-0 min-h-[58px] rounded-sm border border-primary/10 bg-primary/5 px-3 py-2 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-white flex flex-col justify-center';
const adminRegionLabelClassName = 'mb-1 block text-[14px] font-semibold leading-[1.35] text-primary/55 transition-colors pointer-events-none group-focus-within:text-primary';
const adminRegionClearButtonClassName = 'absolute right-2 top-2 z-[5] size-5 rounded-full border border-primary/10 bg-white/90 text-primary/35 hover:text-brick hover:border-brick/20 transition-all flex items-center justify-center shadow-sm';
const adminCustomerLabelStyle = { color: '#d32f2f' };
const defaultQuoteSettings = {
    quote_logo_url: '',
    quote_store_name: '',
    quote_store_address: '',
    quote_store_phone: ''
};
const productSearchHistoryStorageKey = 'order_form_product_search_history';
const productQuickFilterAttributeStorageKey = 'order_form_product_quick_filter_attribute_id';
const productQuickFilterAttribute2MapStorageKey = 'order_form_product_quick_filter_attribute_id_2_map';
const productQuickFilterStateStorageKey = 'order_form_product_quick_filter_state_v1';
const productQuickSetupStorageKey = 'order_form_product_quick_setup_map_v1';
const supportedProductQuickFilterTypes = new Set(['select', 'multiselect']);
const PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE = 'attribute';
const PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE = 'bundle_option_title';
const PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE = 'bundle_title';
const PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS = 'bundle_option_status';
const bundleProductQuickFilterKinds = new Set([
    PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE,
    PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE,
    PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS,
]);
const SEARCH_ENTRY_PRODUCT = 'product';
const SEARCH_ENTRY_VARIATION = 'variation';
const SEARCH_ENTRY_BUNDLE_OPTION = 'bundle_option';
const orderFormColumnOrderStorageKey = 'order_form_column_order';
const orderFormVisibleColumnsStorageKey = 'order_form_visible_columns';
const orderFormColumnWidthsStorageKey = 'order_column_widths';
const orderFormColumnWidthModeStorageKey = 'order_form_column_width_mode';
const orderFormColumnOrderDefaultStorageKey = 'order_form_column_order_default';
const orderFormVisibleColumnsDefaultStorageKey = 'order_form_visible_columns_default';
const orderFormColumnWidthsDefaultStorageKey = 'order_column_widths_default';
const orderFormColumnWidthModeDefaultStorageKey = 'order_form_column_width_mode_default';
const orderFormCostPriceMigrationStorageKey = 'added_cost_price_migrated_form';
const orderFormUnitVisibleMigrationStorageKey = 'added_unit_visible_migrated_form';
const orderFormAvailableToSellVisibleMigrationStorageKey = 'added_available_to_sell_migrated_form';
const ORDER_FORM_AVAILABLE_TO_SELL_TOOLTIP = 'Có thể bán = Tồn kho - SL chờ xuất';
const ORDER_FORM_COLUMN_WIDTH_MODE_AUTO = 'auto';
const ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL = 'manual';
const ORDER_FORM_DEFAULT_COLUMN_IDS = ['selection', 'stt', 'sku', 'name', 'quantity', 'unit', 'available_to_sell', 'price', 'cost_price', 'total', 'actions'];
const ORDER_FORM_REQUIRED_VISIBLE_COLUMN_IDS = ['available_to_sell'];
const ORDER_FORM_TABLE_DRAG_COLUMN_WIDTH = 44;
const ORDER_FORM_DEFAULT_COLUMN_WIDTHS = {
    stt: 48,
    selection: 44,
    sku: 120,
    name: 280,
    quantity: 68,
    unit: 72,
    available_to_sell: 108,
    price: 126,
    cost_price: 126,
    total: 138,
    actions: 68,
};
const ORDER_FORM_TABLE_DENSITY_METRICS = {
    comfortable: {
        defaultWidths: ORDER_FORM_DEFAULT_COLUMN_WIDTHS,
        minWidths: {
            stt: 48,
            selection: 44,
            sku: 104,
            name: 220,
            quantity: 62,
            unit: 62,
            available_to_sell: 96,
            price: 114,
            cost_price: 114,
            total: 132,
            actions: 68,
        },
        growWeights: {
            stt: 0,
            sku: 0.62,
            name: 4.1,
            quantity: 0.4,
            unit: 0.32,
            available_to_sell: 0.9,
            price: 1.12,
            cost_price: 1.06,
            total: 1.28,
            actions: 0,
        },
    },
    compact: {
        defaultWidths: {
            stt: 44,
            selection: 44,
            sku: 112,
            name: 238,
            quantity: 64,
            unit: 62,
            available_to_sell: 100,
            price: 118,
            cost_price: 118,
            total: 132,
            actions: 60,
        },
        minWidths: {
            stt: 42,
            selection: 40,
            sku: 92,
            name: 176,
            quantity: 56,
            unit: 54,
            available_to_sell: 90,
            price: 102,
            cost_price: 102,
            total: 116,
            actions: 56,
        },
        growWeights: {
            stt: 0,
            sku: 0.5,
            name: 3.25,
            quantity: 0.3,
            unit: 0.25,
            available_to_sell: 0.85,
            price: 1.18,
            cost_price: 1.08,
            total: 1.34,
            actions: 0,
        },
    },
    tight: {
        defaultWidths: {
            stt: 40,
            selection: 40,
            sku: 104,
            name: 210,
            quantity: 58,
            unit: 56,
            available_to_sell: 96,
            price: 112,
            cost_price: 112,
            total: 124,
            actions: 56,
        },
        minWidths: {
            stt: 38,
            selection: 36,
            sku: 84,
            name: 148,
            quantity: 50,
            unit: 50,
            available_to_sell: 88,
            price: 96,
            cost_price: 96,
            total: 108,
            actions: 50,
        },
        growWeights: {
            stt: 0,
            sku: 0.4,
            name: 2.65,
            quantity: 0.24,
            unit: 0.22,
            available_to_sell: 0.75,
            price: 1.2,
            cost_price: 1.1,
            total: 1.38,
            actions: 0,
        },
    },
};
const ORDER_FORM_TABLE_DENSITY_PRESETS = {
    comfortable: {
        headerFontSize: 12,
        headerLetterSpacing: '0.08em',
        bodyFontSize: 13,
        bodyMetaFontSize: 11,
        bodyMetaMarginTop: 4,
        bodyPaddingX: 12,
        bodyPaddingY: 10,
        quantityInputWidth: 54,
        quantityInputHeight: 32,
        actionButtonSize: 28,
        actionIconSize: 24,
        rowIconSize: 16,
        copyIconSize: 14,
        badgeFontSize: 9,
        badgePaddingX: 8,
        badgePaddingY: 2,
    },
    compact: {
        headerFontSize: 12,
        headerLetterSpacing: '0.08em',
        bodyFontSize: 13,
        bodyMetaFontSize: 11,
        bodyMetaMarginTop: 4,
        bodyPaddingX: 10,
        bodyPaddingY: 9,
        quantityInputWidth: 54,
        quantityInputHeight: 32,
        actionButtonSize: 28,
        actionIconSize: 24,
        rowIconSize: 16,
        copyIconSize: 14,
        badgeFontSize: 9,
        badgePaddingX: 8,
        badgePaddingY: 2,
    },
    tight: {
        headerFontSize: 12,
        headerLetterSpacing: '0.08em',
        bodyFontSize: 13,
        bodyMetaFontSize: 11,
        bodyMetaMarginTop: 4,
        bodyPaddingX: 8,
        bodyPaddingY: 8,
        quantityInputWidth: 54,
        quantityInputHeight: 32,
        actionButtonSize: 28,
        actionIconSize: 24,
        rowIconSize: 16,
        copyIconSize: 14,
        badgeFontSize: 9,
        badgePaddingX: 8,
        badgePaddingY: 2,
    },
};
const resolveOrderFormTableDensityKey = ({ containerWidth, visibleColumnIds }) => {
    const normalizedContainerWidth = Number(containerWidth) || 0;
    const visibleColumnCount = Array.isArray(visibleColumnIds) ? visibleColumnIds.length : 0;

    if (normalizedContainerWidth > 0) {
        if (normalizedContainerWidth <= 980 || (normalizedContainerWidth <= 1100 && visibleColumnCount >= 9)) {
            return 'tight';
        }

        if (normalizedContainerWidth <= 1240 || (normalizedContainerWidth <= 1360 && visibleColumnCount >= 9)) {
            return 'compact';
        }
    }

    return 'comfortable';
};
const getOrderFormDensityMetrics = (densityKey = 'comfortable') => (
    ORDER_FORM_TABLE_DENSITY_METRICS[densityKey] || ORDER_FORM_TABLE_DENSITY_METRICS.comfortable
);
const getOrderFormDensityPreset = (densityKey = 'comfortable') => (
    ORDER_FORM_TABLE_DENSITY_PRESETS[densityKey] || ORDER_FORM_TABLE_DENSITY_PRESETS.comfortable
);
const autoOpenSupplementItemOrderTypes = new Set([
    ORDER_TYPE_EXCHANGE_RETURN,
    ORDER_TYPE_PARTIAL_DELIVERY,
]);
const quoteCurrencyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const quoteCanvasFontFamily = '"Roboto", sans-serif';
let orderFormLineItemSequence = 0;
const createOrderLineId = (prefix = 'order-item') => {
    orderFormLineItemSequence += 1;
    return `${prefix}-${orderFormLineItemSequence}`;
};
const readOrderFormStorageJson = (storageKey, fallbackValue) => {
    if (typeof window === 'undefined') return fallbackValue;

    try {
        const rawValue = window.localStorage.getItem(storageKey);
        return rawValue ? JSON.parse(rawValue) : fallbackValue;
    } catch (error) {
        console.warn(`Unable to parse ${storageKey}`, error);
        try {
            window.localStorage.removeItem(storageKey);
        } catch { }
        return fallbackValue;
    }
};
const writeOrderFormStorageJson = (storageKey, value) => {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
        console.warn(`Unable to persist ${storageKey}`, error);
    }
};
const readOrderFormStorageValue = (storageKey, fallbackValue = '') => {
    if (typeof window === 'undefined') return fallbackValue;

    try {
        return window.localStorage.getItem(storageKey) ?? fallbackValue;
    } catch (error) {
        console.warn(`Unable to read ${storageKey}`, error);
        return fallbackValue;
    }
};
const writeOrderFormStorageValue = (storageKey, value) => {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(storageKey, value);
    } catch (error) {
        console.warn(`Unable to persist ${storageKey}`, error);
    }
};
const normalizeStoredOrderFormColumnIds = (value) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((columnId) => String(columnId || '').trim())
        .filter((columnId) => ORDER_FORM_DEFAULT_COLUMN_IDS.includes(columnId))
));
const insertOrderFormColumnAfter = (columnIds, columnId, afterColumnId) => {
    if (columnIds.includes(columnId)) {
        return [...columnIds];
    }

    const nextColumnIds = [...columnIds];
    const targetIndex = nextColumnIds.indexOf(afterColumnId);
    nextColumnIds.splice(targetIndex >= 0 ? targetIndex + 1 : nextColumnIds.length, 0, columnId);
    return nextColumnIds;
};
const normalizeStoredOrderFormColumnOrder = (value) => {
    const nextColumnIds = normalizeStoredOrderFormColumnIds(value);

    ORDER_FORM_DEFAULT_COLUMN_IDS.forEach((columnId) => {
        if (!['selection', 'unit', 'available_to_sell'].includes(columnId) && !nextColumnIds.includes(columnId)) {
            nextColumnIds.push(columnId);
        }
    });

    if (!nextColumnIds.includes('selection')) {
        nextColumnIds.unshift('selection');
    }

    if (!nextColumnIds.includes('unit')) {
        const targetIndex = nextColumnIds.indexOf('quantity');
        nextColumnIds.splice(targetIndex >= 0 ? targetIndex + 1 : nextColumnIds.length, 0, 'unit');
    }

    if (!nextColumnIds.includes('available_to_sell')) {
        const afterColumnId = nextColumnIds.includes('unit') ? 'unit' : 'quantity';
        const targetIndex = nextColumnIds.indexOf(afterColumnId);
        nextColumnIds.splice(targetIndex >= 0 ? targetIndex + 1 : nextColumnIds.length, 0, 'available_to_sell');
    }

    return nextColumnIds;
};
const migrateStoredOrderFormColumns = (storedColumns, { storageKey, migrationStorageKey, columnId, afterColumnId }) => {
    const hasCompletedMigration = readOrderFormStorageValue(migrationStorageKey, '');

    if (storedColumns.includes(columnId) || hasCompletedMigration) {
        return storedColumns;
    }

    const migratedColumns = insertOrderFormColumnAfter(storedColumns, columnId, afterColumnId);
    writeOrderFormStorageValue(migrationStorageKey, 'true');
    writeOrderFormStorageJson(storageKey, migratedColumns);
    return migratedColumns;
};
const normalizeStoredOrderFormVisibleColumns = (value) => {
    if (!Array.isArray(value)) {
        return [...ORDER_FORM_DEFAULT_COLUMN_IDS];
    }

    const nextColumnIds = normalizeStoredOrderFormColumnIds(value);
    const normalizedColumnIds = value.length > 0 && nextColumnIds.length === 0
        ? [...ORDER_FORM_DEFAULT_COLUMN_IDS]
        : nextColumnIds;

    if (!normalizedColumnIds.includes('selection')) {
        normalizedColumnIds.unshift('selection');
    }

    let ensuredColumnIds = [...normalizedColumnIds];
    const hasUnitColumn = ensuredColumnIds.includes('unit');

    ORDER_FORM_REQUIRED_VISIBLE_COLUMN_IDS.forEach((columnId) => {
        if (ensuredColumnIds.includes(columnId)) {
            return;
        }

        ensuredColumnIds = insertOrderFormColumnAfter(
            ensuredColumnIds,
            columnId,
            columnId === 'available_to_sell'
                ? (hasUnitColumn || ensuredColumnIds.includes('unit') ? 'unit' : 'quantity')
                : 'quantity'
        );
    });

    return ensuredColumnIds;
};
const normalizeStoredOrderFormColumnWidths = (value) => {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    return Object.fromEntries(
        Object.entries(ORDER_FORM_DEFAULT_COLUMN_WIDTHS).map(([columnId, fallbackWidth]) => {
            const candidateWidth = source[columnId];
            if (candidateWidth === null && fallbackWidth === null) {
                return [columnId, null];
            }

            const normalizedWidth = Number(candidateWidth);
            return [columnId, Number.isFinite(normalizedWidth) && normalizedWidth > 0 ? normalizedWidth : fallbackWidth];
        })
    );
};
const normalizeOrderFormColumnWidthMode = (value) => (
    value === ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL
        ? ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL
        : ORDER_FORM_COLUMN_WIDTH_MODE_AUTO
);
const getStoredOrderFormColumnOrder = () => normalizeStoredOrderFormColumnOrder(
    readOrderFormStorageJson(orderFormColumnOrderStorageKey, ORDER_FORM_DEFAULT_COLUMN_IDS)
);
const getStoredOrderFormVisibleColumns = () => {
    let storedColumns = normalizeStoredOrderFormVisibleColumns(
        readOrderFormStorageJson(orderFormVisibleColumnsStorageKey, ORDER_FORM_DEFAULT_COLUMN_IDS)
    );
    const hasCompletedCostPriceMigration = readOrderFormStorageValue(orderFormCostPriceMigrationStorageKey, '');

    if (!storedColumns.includes('cost_price') && !hasCompletedCostPriceMigration) {
        storedColumns = migrateStoredOrderFormColumns(storedColumns, {
            storageKey: orderFormVisibleColumnsStorageKey,
            migrationStorageKey: orderFormCostPriceMigrationStorageKey,
            columnId: 'cost_price',
            afterColumnId: 'price',
        });
    }

    storedColumns = migrateStoredOrderFormColumns(storedColumns, {
        storageKey: orderFormVisibleColumnsStorageKey,
        migrationStorageKey: orderFormUnitVisibleMigrationStorageKey,
        columnId: 'unit',
        afterColumnId: 'quantity',
    });

    return migrateStoredOrderFormColumns(storedColumns, {
        storageKey: orderFormVisibleColumnsStorageKey,
        migrationStorageKey: orderFormAvailableToSellVisibleMigrationStorageKey,
        columnId: 'available_to_sell',
        afterColumnId: storedColumns.includes('unit') ? 'unit' : 'quantity',
    });
};
const getStoredOrderFormColumnWidths = () => normalizeStoredOrderFormColumnWidths(
    readOrderFormStorageJson(orderFormColumnWidthsStorageKey, ORDER_FORM_DEFAULT_COLUMN_WIDTHS)
);
const getStoredOrderFormColumnWidthMode = () => normalizeOrderFormColumnWidthMode(
    readOrderFormStorageValue(orderFormColumnWidthModeStorageKey, ORDER_FORM_COLUMN_WIDTH_MODE_AUTO)
);
const getOrderFormSystemColumnConfig = () => ({
    order: [...ORDER_FORM_DEFAULT_COLUMN_IDS],
    visible: [...ORDER_FORM_DEFAULT_COLUMN_IDS],
    widths: { ...ORDER_FORM_DEFAULT_COLUMN_WIDTHS },
    widthMode: ORDER_FORM_COLUMN_WIDTH_MODE_AUTO,
});
const getOrderFormPreferredColumnWidth = (
    columnId,
    widthMap = ORDER_FORM_DEFAULT_COLUMN_WIDTHS,
    columnMetrics = ORDER_FORM_TABLE_DENSITY_METRICS.comfortable
) => {
    const densityMetrics = columnMetrics && typeof columnMetrics === 'object'
        ? columnMetrics
        : ORDER_FORM_TABLE_DENSITY_METRICS.comfortable;
    const minWidth = densityMetrics.minWidths?.[columnId] ?? 60;
    const candidateWidth = Number(widthMap?.[columnId]);
    const densityDefaultWidth = Number(densityMetrics.defaultWidths?.[columnId]);
    const fallbackWidth = Number(ORDER_FORM_DEFAULT_COLUMN_WIDTHS[columnId]);

    if (Number.isFinite(candidateWidth) && candidateWidth > 0) {
        return Math.max(minWidth, candidateWidth);
    }

    if (Number.isFinite(densityDefaultWidth) && densityDefaultWidth > 0) {
        return Math.max(minWidth, densityDefaultWidth);
    }

    if (Number.isFinite(fallbackWidth) && fallbackWidth > 0) {
        return Math.max(minWidth, fallbackWidth);
    }

    return minWidth;
};
const fitOrderFormColumnsToViewport = ({
    containerWidth,
    visibleColumnIds,
    preferredWidths,
    columnMetrics = ORDER_FORM_TABLE_DENSITY_METRICS.comfortable,
}) => {
    const orderedColumnIds = (Array.isArray(visibleColumnIds) ? visibleColumnIds : [])
        .map((columnId) => String(columnId || '').trim())
        .filter((columnId) => ORDER_FORM_DEFAULT_COLUMN_IDS.includes(columnId));
    const densityMetrics = columnMetrics && typeof columnMetrics === 'object'
        ? columnMetrics
        : ORDER_FORM_TABLE_DENSITY_METRICS.comfortable;

    if (orderedColumnIds.length === 0) {
        return {};
    }

    const fallbackWidths = Object.fromEntries(
        orderedColumnIds.map((columnId) => [columnId, getOrderFormPreferredColumnWidth(columnId, preferredWidths, densityMetrics)])
    );
    const normalizedContainerWidth = Number(containerWidth);

    if (!Number.isFinite(normalizedContainerWidth) || normalizedContainerWidth <= 0) {
        return fallbackWidths;
    }

    const minimumTableWidth = orderedColumnIds.reduce(
        (sum, columnId) => sum + (densityMetrics.minWidths?.[columnId] ?? 60),
        0
    );
    const targetTableWidth = Math.max(
        minimumTableWidth,
        Math.floor(normalizedContainerWidth - ORDER_FORM_TABLE_DRAG_COLUMN_WIDTH)
    );
    const preferredTableWidth = orderedColumnIds.reduce(
        (sum, columnId) => sum + fallbackWidths[columnId],
        0
    );
    const nextWidths = { ...fallbackWidths };

    if (preferredTableWidth > targetTableWidth) {
        const totalShrinkCapacity = orderedColumnIds.reduce((sum, columnId) => (
            sum + Math.max(0, nextWidths[columnId] - (densityMetrics.minWidths?.[columnId] ?? nextWidths[columnId]))
        ), 0);

        if (totalShrinkCapacity > 0) {
            const overflowWidth = preferredTableWidth - targetTableWidth;
            orderedColumnIds.forEach((columnId) => {
                const minWidth = densityMetrics.minWidths?.[columnId] ?? nextWidths[columnId];
                const shrinkCapacity = Math.max(0, nextWidths[columnId] - minWidth);
                const shrinkWidth = overflowWidth * (shrinkCapacity / totalShrinkCapacity);
                nextWidths[columnId] = Math.max(minWidth, nextWidths[columnId] - shrinkWidth);
            });
        }
    } else if (preferredTableWidth < targetTableWidth) {
        const totalGrowWeight = orderedColumnIds.reduce(
            (sum, columnId) => sum + (densityMetrics.growWeights?.[columnId] ?? 0),
            0
        );

        if (totalGrowWeight > 0) {
            const remainingWidth = targetTableWidth - preferredTableWidth;
            orderedColumnIds.forEach((columnId) => {
                const growWeight = densityMetrics.growWeights?.[columnId] ?? 0;
                if (growWeight > 0) {
                    nextWidths[columnId] += remainingWidth * (growWeight / totalGrowWeight);
                }
            });
        }
    }

    const roundedWidths = Object.fromEntries(
        orderedColumnIds.map((columnId) => [
            columnId,
            Math.max(densityMetrics.minWidths?.[columnId] ?? 60, Math.round(nextWidths[columnId]))
        ])
    );
    const roundedTableWidth = orderedColumnIds.reduce((sum, columnId) => sum + roundedWidths[columnId], 0);
    let remainingDelta = targetTableWidth - roundedTableWidth;

    if (remainingDelta !== 0) {
        const adjustableColumnIds = remainingDelta > 0
            ? orderedColumnIds.filter((columnId) => (densityMetrics.growWeights?.[columnId] ?? 0) > 0)
            : orderedColumnIds.filter((columnId) => (
                roundedWidths[columnId] > (densityMetrics.minWidths?.[columnId] ?? roundedWidths[columnId])
            ));

        if (adjustableColumnIds.length > 0) {
            let cursor = 0;
            const maxIterations = Math.max(orderedColumnIds.length * 8, Math.abs(remainingDelta) * adjustableColumnIds.length * 2);

            while (remainingDelta !== 0 && cursor < maxIterations) {
                const columnId = adjustableColumnIds[cursor % adjustableColumnIds.length];
                const step = remainingDelta > 0 ? 1 : -1;
                const nextWidth = roundedWidths[columnId] + step;
                const minWidth = densityMetrics.minWidths?.[columnId] ?? 60;

                if (step > 0 || nextWidth >= minWidth) {
                    roundedWidths[columnId] = nextWidth;
                    remainingDelta -= step;
                }

                cursor += 1;
            }
        }
    }

    return roundedWidths;
};
const shouldAutoOpenSupplementItemsModal = (value) => autoOpenSupplementItemOrderTypes.has(normalizeOrderType(value));
const sortQuoteTemplates = (templates = []) => [...(Array.isArray(templates) ? templates : [])].sort((a, b) => {
    const sortA = Number(a?.sort_order) || 0;
    const sortB = Number(b?.sort_order) || 0;
    if (sortA !== sortB) return sortA - sortB;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'vi');
});

const normalizeCanvasText = (value) => String(value ?? '').normalize('NFC').trim();
const appendUrlVersion = (url, version) => {
    const normalizedUrl = String(url ?? '').trim();
    const normalizedVersion = String(version ?? '').trim();

    if (!normalizedUrl || !normalizedVersion || normalizedUrl.startsWith('data:')) {
        return normalizedUrl;
    }

    const hashIndex = normalizedUrl.indexOf('#');
    const baseUrl = hashIndex >= 0 ? normalizedUrl.slice(0, hashIndex) : normalizedUrl;
    const hash = hashIndex >= 0 ? normalizedUrl.slice(hashIndex) : '';
    const separator = baseUrl.includes('?') ? '&' : '?';

    return `${baseUrl}${separator}v=${encodeURIComponent(normalizedVersion)}${hash}`;
};
const getQuoteTemplateImageUrl = (template) => appendUrlVersion(template?.image_url, template?.updated_at);
const getQuoteBundleSelectionLabel = (items = []) => {
    const seenLabels = new Set();
    const labels = [];

    (Array.isArray(items) ? items : []).forEach((item) => {
        const options = item?.options || {};
        const isBundleItem = normalizeCanvasText(options?.search_entry_kind) === SEARCH_ENTRY_BUNDLE_OPTION
            || options?.bundle_parent_id
            || options?.bundle_parent_name
            || options?.bundle_option_title
            || options?.bundle_option_post_title;

        if (!isBundleItem) return;

        const parentName = normalizeCanvasText(options?.bundle_parent_name);
        const optionTitle = normalizeCanvasText(options?.bundle_option_title || options?.bundle_option_post_title);
        const parts = [parentName, optionTitle].filter((part, index, source) => (
            part && source.findIndex((candidate) => normalizeProductSearchText(candidate) === normalizeProductSearchText(part)) === index
        ));
        const label = parts.join(' - ');
        const labelKey = normalizeProductSearchText(label);

        if (!label || seenLabels.has(labelKey)) return;
        seenLabels.add(labelKey);
        labels.push(label);
    });

    return labels[0] || '';
};
const getSelectedQuoteTemplateLabel = (template, items = []) => {
    const templateName = normalizeCanvasText(template?.name || 'Chưa đặt tên mẫu');
    const bundleSelectionLabel = getQuoteBundleSelectionLabel(items);

    if (!bundleSelectionLabel) return templateName;

    const normalizedTemplateName = normalizeProductSearchText(templateName);
    const normalizedBundleSelectionLabel = normalizeProductSearchText(bundleSelectionLabel);

    if (
        normalizedTemplateName
        && normalizedBundleSelectionLabel
        && (
            normalizedBundleSelectionLabel.includes(normalizedTemplateName)
            || normalizedTemplateName.includes(normalizedBundleSelectionLabel)
        )
    ) {
        return bundleSelectionLabel;
    }

    return `${templateName} - ${bundleSelectionLabel}`;
};
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const normalizeProductSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const compactProductSearchText = (value) => normalizeProductSearchText(value).replace(/\s+/g, '');
const splitCompactProductSearchTokens = (value) => Array.from(new Set(
    (compactProductSearchText(value).match(/[a-z]+|\d+/g) || [])
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
));
const getCompactProductSearchLeadToken = (value) => {
    const tokens = splitCompactProductSearchTokens(value).filter((token) => /[a-z]/.test(token));
    if (tokens.length === 0) return '';

    return [...tokens].sort((left, right) => right.length - left.length)[0] || '';
};
const isCompactCompositeProductSearch = (value) => {
    const normalizedValue = normalizeProductSearchText(value);
    if (!normalizedValue || normalizedValue.includes(' ')) {
        return false;
    }

    return splitCompactProductSearchTokens(value).length > 1;
};
const tokenizeProductSearch = (value) => {
    const normalizedTokens = normalizeProductSearchText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
    const compactTokens = normalizedTokens.length <= 1 ? splitCompactProductSearchTokens(value) : [];

    return Array.from(new Set(
        compactTokens.length > 1
            ? compactTokens
            : [...normalizedTokens, ...compactTokens]
    )).slice(0, 6);
};
const getStoredProductSearchHistory = () => {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(productSearchHistoryStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === 'string' && item.trim() !== '').slice(0, 8)
            : [];
    } catch (error) {
        console.error('Unable to read product search history', error);
        return [];
    }
};
const getStoredUserStorageId = (user = null) => {
    const directUserId = user?.id ?? user?.user_id ?? user?.email ?? user?.username;
    if (directUserId) return String(directUserId);

    if (typeof window === 'undefined') return 'anonymous';

    try {
        const storedUser = JSON.parse(window.localStorage.getItem('user') || 'null');
        const storedUserId = storedUser?.id ?? storedUser?.user_id ?? storedUser?.email ?? storedUser?.username;
        return storedUserId ? String(storedUserId) : 'anonymous';
    } catch (error) {
        return 'anonymous';
    }
};
const getProductQuickFilterStorageKey = (user = null) => {
    if (typeof window === 'undefined') {
        return `${productQuickFilterStateStorageKey}::anonymous::default::default::order-form`;
    }

    const userId = getStoredUserStorageId(user);
    const activeAccountId = window.localStorage.getItem('activeAccountId') || 'default';
    const activeSiteCode = window.localStorage.getItem('activeSiteCode') || 'default';

    return `${productQuickFilterStateStorageKey}::${userId}::${activeAccountId}::${activeSiteCode}::order-form`;
};
const normalizeStoredQuickFilterValues = (values = []) => (
    Array.isArray(values)
        ? values.map(normalizeQuickFilterOptionValue).filter(Boolean).slice(0, 1)
        : []
);
const normalizeStoredProductQuickFilterState = (value = {}) => {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    return {
        searchTerm: String(source.searchTerm ?? source.search_term ?? '').trim(),
        attributeId: String(source.attributeId ?? source.attribute_id ?? '').trim(),
        values: normalizeStoredQuickFilterValues(source.values),
        attributeId2: String(source.attributeId2 ?? source.attribute_id_2 ?? '').trim(),
        values2: normalizeStoredQuickFilterValues(source.values2),
        quickModeEnabled: Boolean(source.quickModeEnabled ?? source.quick_mode_enabled),
    };
};
const getStoredProductQuickFilterState = (user = null) => {
    if (typeof window === 'undefined') return normalizeStoredProductQuickFilterState();

    try {
        const raw = window.localStorage.getItem(getProductQuickFilterStorageKey(user));
        return normalizeStoredProductQuickFilterState(raw ? JSON.parse(raw) : {});
    } catch (error) {
        console.error('Unable to read product quick filter state', error);
        return normalizeStoredProductQuickFilterState();
    }
};
const persistProductQuickFilterState = (storageKey, state) => {
    if (typeof window === 'undefined' || !storageKey) return;

    const normalizedState = normalizeStoredProductQuickFilterState(state);
    const hasPersistedState = Boolean(
        normalizedState.searchTerm
        || normalizedState.values.length > 0
        || normalizedState.values2.length > 0
        || normalizedState.quickModeEnabled
    );

    try {
        if (!hasPersistedState) {
            window.localStorage.removeItem(storageKey);
            return;
        }

        window.localStorage.setItem(storageKey, JSON.stringify(normalizedState));
    } catch (error) {
        console.error('Unable to persist product quick filter state', error);
    }
};
const resolveProductQuickSetupNamespace = () => {
    if (typeof window === 'undefined') return 'server';

    try {
        const userId = getStoredUserStorageId();
        const activeAccountId = window.localStorage.getItem('activeAccountId') || 'default';
        const activeSiteCode = window.localStorage.getItem('activeSiteCode') || 'default';

        return `${userId}::${activeAccountId}::${activeSiteCode}::order-form`;
    } catch (error) {
        console.error('Unable to resolve product quick setup namespace', error);
        return 'default::default';
    }
};
const buildProductQuickSetupKey = (attributeId, attributeValue) => {
    const normalizedAttributeId = String(attributeId ?? '').trim();
    const normalizedAttributeValue = normalizeQuickFilterOptionValue(attributeValue).toLocaleLowerCase('vi');

    return normalizedAttributeId && normalizedAttributeValue
        ? `${normalizedAttributeId}::${normalizedAttributeValue}`
        : '';
};
const getStoredProductQuickSetupStore = () => {
    if (typeof window === 'undefined') return {};

    try {
        const raw = window.localStorage.getItem(productQuickSetupStorageKey);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.error('Unable to read product quick setup store', error);
        return {};
    }
};
const getProductQuickSetupEntryKey = (entry) => {
    const entryKind = String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;

    if (entryKind === SEARCH_ENTRY_BUNDLE_OPTION) {
        const explicitEntryId = normalizeCanvasText(entry?.entry_id || entry?.id);
        if (explicitEntryId && !/^\d+$/.test(explicitEntryId)) {
            return explicitEntryId;
        }

        const parentProductId = Number(entry?.bundle_parent_id ?? entry?.target_product_id ?? entry?.product_id ?? 0) || 0;
        const optionKey = normalizeCanvasText(
            entry?.bundle_option_key
            || entry?.key
            || entry?.option_key
            || resolveBundleOptionKey(entry)
        );

        return parentProductId > 0 && optionKey
            ? `${SEARCH_ENTRY_BUNDLE_OPTION}-${parentProductId}-${optionKey}`
            : '';
    }

    const productId = Number(entry?.target_product_id ?? entry?.product_id ?? entry?.id ?? 0);
    return Number.isFinite(productId) && productId > 0 ? String(productId) : '';
};
const normalizeStoredProductQuickSetupBundleItems = (items = []) => (
    (Array.isArray(items) ? items : [])
        .map((item) => {
            const productId = Number(item?.product_id ?? item?.target_product_id ?? item?.id ?? 0);
            if (!Number.isFinite(productId) || productId <= 0) return null;

            return {
                ...item,
                id: productId,
                product_id: productId,
                target_product_id: productId,
                base_product_id: Number(item?.base_product_id ?? 0) || undefined,
                sku: String(item?.sku ?? '').trim(),
                display_sku: String(item?.display_sku ?? item?.sku ?? '').trim(),
                name: String(item?.name ?? '').trim(),
                display_name: String(item?.display_name ?? item?.name ?? '').trim(),
                quantity: Math.max(1, Number(item?.quantity) || 1),
                price: Number(item?.price ?? 0) || 0,
                expected_cost: parseMoneyNumber(item?.expected_cost),
                cost_price: resolveProductCostPrice(item),
                unit_name: resolveOrderUnitLabel(item),
                ...resolveInventorySnapshot(item),
                main_image: String(item?.main_image ?? '').trim(),
                option_label: normalizeCanvasText(item?.option_label || item?.variant_label),
                variant_name: normalizeCanvasText(item?.variant_name),
            };
        })
        .filter(Boolean)
);
const normalizeStoredProductQuickSetupItems = (items = []) => {
    const seenEntryKeys = new Set();

    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const entryKind = String(item?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
            const productId = Number(
                item?.target_product_id
                ?? item?.product_id
                ?? item?.bundle_parent_id
                ?? item?.id
                ?? 0
            );
            if (!Number.isFinite(productId) || productId <= 0) return null;

            const entryKey = getProductQuickSetupEntryKey({
                ...item,
                entry_kind: entryKind,
                product_id: productId,
                target_product_id: productId,
            });
            if (!entryKey || seenEntryKeys.has(entryKey)) return null;
            seenEntryKeys.add(entryKey);

            const parentProductId = Number(item?.parent_product_id ?? 0);
            const bundleItems = entryKind === SEARCH_ENTRY_BUNDLE_OPTION
                ? normalizeStoredProductQuickSetupBundleItems(item?.bundle_items)
                : [];
            if (entryKind === SEARCH_ENTRY_BUNDLE_OPTION && bundleItems.length === 0) return null;

            const bundleParentId = Number(item?.bundle_parent_id ?? productId) || productId;
            const bundleOptionTitle = normalizeCanvasText(item?.bundle_option_title || resolveBundleOptionTitle(item));
            const bundleParentName = normalizeCanvasText(item?.bundle_parent_name || item?.parent_product_name || item?.name);
            const displayName = entryKind === SEARCH_ENTRY_BUNDLE_OPTION
                ? (
                    normalizeCanvasText(item?.display_name)
                    || [bundleParentName, bundleOptionTitle].filter(Boolean).join(' - ')
                    || normalizeCanvasText(item?.name)
                )
                : String(item?.display_name ?? item?.name ?? '').trim();

            return {
                id: entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? entryKey : productId,
                entry_id: entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? entryKey : normalizeCanvasText(item?.entry_id),
                product_id: productId,
                target_product_id: productId,
                sku: String(item?.sku ?? '').trim(),
                display_sku: String(item?.display_sku ?? item?.sku ?? '').trim(),
                name: String(item?.name ?? '').trim(),
                display_name: displayName,
                price: Number(item?.price ?? 0) || 0,
                expected_cost: parseMoneyNumber(item?.expected_cost),
                cost_price: resolveProductCostPrice(item),
                unit_name: resolveOrderUnitLabel(item),
                ...resolveInventorySnapshot(item),
                main_image: String(item?.main_image ?? '').trim(),
                type: String(item?.type ?? '').trim(),
                entry_kind: entryKind,
                parent_product_id: Number.isFinite(parentProductId) && parentProductId > 0 ? parentProductId : null,
                parent_product_name: String(item?.parent_product_name ?? '').trim(),
                option_label: String(item?.option_label ?? '').trim(),
                ...(entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? {
                    bundle_parent_id: bundleParentId,
                    bundle_parent_name: bundleParentName,
                    bundle_option_key: normalizeCanvasText(item?.bundle_option_key || resolveBundleOptionKey(item)),
                    bundle_option_title: bundleOptionTitle,
                    raw_bundle_option_title: normalizeCanvasText(item?.raw_bundle_option_title || item?.option_title),
                    bundle_option_status: normalizeCanvasText(item?.bundle_option_status || 'visible'),
                    bundle_title: normalizeCanvasText(item?.bundle_title || item?.bundle_config_title),
                    bundle_config_title: normalizeCanvasText(item?.bundle_config_title || item?.bundle_title),
                    option_post_id: Number(item?.option_post_id) || undefined,
                    option_post_title: normalizeCanvasText(item?.option_post_title),
                    bundle_items: bundleItems,
                    bundle_item_count: bundleItems.length,
                    bundle_quantity_total: bundleItems.reduce((sum, bundleItem) => sum + (Number(bundleItem.quantity) || 0), 0),
                } : {}),
            };
        })
        .filter(Boolean);
};
const normalizeQuickFilterOptionValue = (value) => String(value ?? '').trim();
const parseProductAttributeValueList = (value) => {
    if (Array.isArray(value)) {
        return value.map(normalizeQuickFilterOptionValue).filter(Boolean);
    }

    if (typeof value !== 'string') {
        return value == null ? [] : [normalizeQuickFilterOptionValue(value)].filter(Boolean);
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    if ((trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) || (trimmedValue.startsWith('{') && trimmedValue.endsWith('}'))) {
        try {
            const parsed = JSON.parse(trimmedValue);
            if (Array.isArray(parsed)) {
                return parsed.map(normalizeQuickFilterOptionValue).filter(Boolean);
            }

            if (parsed && typeof parsed === 'object') {
                return Object.values(parsed).map(normalizeQuickFilterOptionValue).filter(Boolean);
            }
        } catch (error) { }
    }

    return [trimmedValue];
};
const buildProductQuickFilterAttributes = (attributes = []) => {
    const normalizedAttributes = attributes
        .filter((attribute) => supportedProductQuickFilterTypes.has(attribute?.frontend_type))
        .map((attribute) => ({
            ...attribute,
            quick_filter_kind: attribute?.quick_filter_kind || PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE,
            options: (attribute.options || [])
                .map((option) => {
                    const value = normalizeQuickFilterOptionValue(option?.value);
                    return {
                        ...option,
                        value,
                        label: normalizeQuickFilterOptionValue(option?.label) || value,
                    };
                })
                .filter((option) => option.value !== '')
        }))
        .filter((attribute) => attribute.options.length > 0);

    const backendPreferredAttributes = normalizedAttributes.filter(
        (attribute) => attribute.is_filterable_backend || attribute.is_filterable || attribute.is_filterable_frontend
    );

    return (backendPreferredAttributes.length > 0 ? backendPreferredAttributes : normalizedAttributes)
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'));
};
const getProductQuickFilterKind = (attribute) => (
    attribute?.quick_filter_kind || PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE
);
const isBundleProductQuickFilterAttribute = (attribute) => (
    bundleProductQuickFilterKinds.has(getProductQuickFilterKind(attribute))
);
const getQuickFilterOptionLabel = (attribute, value) => {
    const normalizedValue = normalizeQuickFilterOptionValue(value);
    if (!attribute || !normalizedValue) return normalizedValue;

    const option = (attribute.options || []).find(
        (candidate) => normalizeQuickFilterOptionValue(candidate?.value) === normalizedValue
    );

    return normalizeQuickFilterOptionValue(option?.label) || normalizedValue;
};
const getBundleQuickFilterStatusLabel = (value) => {
    const normalizedValue = normalizeQuickFilterOptionValue(value).toLowerCase();
    if (normalizedValue === 'visible') return 'Hiển thị website';
    if (normalizedValue === 'internal') return 'Nội bộ';
    return value;
};
const getBundleQuickFilterDisplayValues = (product, attribute) => {
    if (!product || !attribute) return [];

    const kind = getProductQuickFilterKind(attribute);

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE) {
        return [
            product?.bundle_option_title,
            product?.option_post_title,
            product?.raw_bundle_option_title,
        ].map(normalizeQuickFilterOptionValue).filter(Boolean);
    }

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE) {
        return [product?.bundle_title || product?.bundle_config_title]
            .map(normalizeQuickFilterOptionValue)
            .filter(Boolean);
    }

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS) {
        return [getBundleQuickFilterStatusLabel(product?.bundle_option_status)]
            .map(normalizeQuickFilterOptionValue)
            .filter(Boolean);
    }

    return [];
};
const getProductAttributeDisplayValues = (product, attributeId) => {
    if (!attributeId || !product) return [];

    const productAttributeValues = Array.isArray(product?.attribute_values)
        ? product.attribute_values
        : (Array.isArray(product?.attributeValues) ? product.attributeValues : []);
    const inheritedAttributeValues = Array.isArray(product?.parent_attribute_values)
        ? product.parent_attribute_values
        : (Array.isArray(product?.parentAttributeValues) ? product.parentAttributeValues : []);
    const variationAttributeValues = Array.isArray(product?.variations)
        ? product.variations.flatMap((variation) => (
            Array.isArray(variation?.attribute_values)
                ? variation.attribute_values
                : (Array.isArray(variation?.attributeValues) ? variation.attributeValues : [])
        ))
        : [];
    const bundleItemAttributeValues = Array.isArray(product?.bundle_items)
        ? product.bundle_items.flatMap((bundleItem) => (
            Array.isArray(bundleItem?.attribute_values)
                ? bundleItem.attribute_values
                : (Array.isArray(bundleItem?.attributeValues) ? bundleItem.attributeValues : [])
        ))
        : [];
    const bundleOptionAttributeValues = Array.isArray(product?.bundle_options)
        ? product.bundle_options.flatMap((bundleOption) => (
            Array.isArray(bundleOption?.items)
                ? bundleOption.items.flatMap((bundleItem) => (
                    Array.isArray(bundleItem?.attribute_values)
                        ? bundleItem.attribute_values
                        : (Array.isArray(bundleItem?.attributeValues) ? bundleItem.attributeValues : [])
                ))
                : []
        ))
        : [];

    return Array.from(new Set(
        [
            ...inheritedAttributeValues,
            ...productAttributeValues,
            ...variationAttributeValues,
            ...bundleItemAttributeValues,
            ...bundleOptionAttributeValues,
        ]
            .filter((attributeValue) => String(attributeValue?.attribute_id ?? attributeValue?.attribute?.id ?? '') === String(attributeId))
            .flatMap((attributeValue) => parseProductAttributeValueList(attributeValue?.value))
            .filter(Boolean)
    ));
};
const getProductQuickFilterDisplayValues = (product, attribute) => {
    if (!attribute || !product) return [];

    if (isBundleProductQuickFilterAttribute(attribute)) {
        return Array.from(new Set(getBundleQuickFilterDisplayValues(product, attribute)));
    }

    return getProductAttributeDisplayValues(product, attribute?.id);
};
const appendProductQuickFilterParams = (params, attribute, values = []) => {
    const normalizedValues = (Array.isArray(values) ? values : [])
        .map(normalizeQuickFilterOptionValue)
        .filter(Boolean);

    if (!attribute || normalizedValues.length === 0) return;

    const kind = getProductQuickFilterKind(attribute);
    const paramValue = normalizedValues.join(',');

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE) {
        params['bundle_filters[option_title]'] = paramValue;
        return;
    }

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE) {
        params['bundle_filters[bundle_title]'] = paramValue;
        return;
    }

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS) {
        params['bundle_filters[option_status]'] = paramValue;
        return;
    }

    if (attribute.id) {
        params[`attributes[${attribute.id}]`] = paramValue;
    }
};
const buildProductQuickFilterCriterion = (attribute, value) => {
    const normalizedValue = normalizeQuickFilterOptionValue(value);
    if (!attribute || !normalizedValue || !isBundleProductQuickFilterAttribute(attribute)) return null;

    return {
        kind: getProductQuickFilterKind(attribute),
        value: normalizedValue,
        compareValue: normalizeProductSearchText(normalizedValue),
    };
};
const productMatchesBundleQuickFilterCriteria = (entry, criteria = []) => {
    if (!Array.isArray(criteria) || criteria.length === 0) return true;
    if (String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT) !== SEARCH_ENTRY_BUNDLE_OPTION) return false;

    return criteria.every((criterion) => {
        if (!criterion?.kind || !criterion?.compareValue) return true;

        if (criterion.kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE) {
            const values = [
                entry?.bundle_option_title,
                entry?.option_post_title,
                entry?.raw_bundle_option_title,
            ];
            return values.some((value) => normalizeProductSearchText(value) === criterion.compareValue);
        }

        if (criterion.kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE) {
            const values = [entry?.bundle_title, entry?.bundle_config_title];
            return values.some((value) => normalizeProductSearchText(value) === criterion.compareValue);
        }

        if (criterion.kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS) {
            const values = [
                entry?.bundle_option_status,
                getBundleQuickFilterStatusLabel(entry?.bundle_option_status),
            ];
            return values.some((value) => normalizeProductSearchText(value) === criterion.compareValue);
        }

        return true;
    });
};
const productMatchesQuickFilterValue = (product, attribute, value) => {
    const normalizedValue = normalizeQuickFilterOptionValue(value);
    if (!product || !attribute || !normalizedValue) return false;

    const selectedValues = new Set([
        normalizeProductSearchText(normalizedValue),
        normalizeProductSearchText(getQuickFilterOptionLabel(attribute, normalizedValue)),
    ].filter(Boolean));

    if (selectedValues.size === 0) return false;

    return getProductQuickFilterDisplayValues(product, attribute)
        .some((displayValue) => selectedValues.has(normalizeProductSearchText(displayValue)));
};
const buildDependentProductQuickFilterOptions = (products, primaryAttribute, primaryValue, secondaryAttribute) => {
    if (!primaryAttribute || !primaryValue || !secondaryAttribute) {
        return secondaryAttribute?.options || [];
    }

    const availableValues = new Map();

    buildProductSearchEntries(products, { includeNested: true })
        .filter((entry) => productMatchesQuickFilterValue(entry, primaryAttribute, primaryValue))
        .forEach((entry) => {
            getProductQuickFilterDisplayValues(entry, secondaryAttribute).forEach((value) => {
                const normalizedValue = normalizeQuickFilterOptionValue(value);
                const valueKey = normalizeProductSearchText(normalizedValue);
                if (normalizedValue && valueKey && !availableValues.has(valueKey)) {
                    availableValues.set(valueKey, normalizedValue);
                }
            });
        });

    if (availableValues.size === 0) return [];

    const existingOptions = secondaryAttribute.options || [];
    const existingOptionKeys = new Set();
    const filteredOptions = existingOptions.filter((option) => {
        const optionKey = normalizeProductSearchText(option?.value);
        if (!optionKey || !availableValues.has(optionKey)) return false;
        existingOptionKeys.add(optionKey);
        return true;
    });

    const dynamicOptions = Array.from(availableValues.entries())
        .filter(([valueKey]) => !existingOptionKeys.has(valueKey))
        .map(([valueKey, value]) => ({
            id: `${secondaryAttribute.id}-${valueKey}`,
            value,
            label: value,
        }));

    return [...filteredOptions, ...dynamicOptions];
};
const scoreProductSearchResult = (product, rawTerm) => {
    const query = normalizeProductSearchText(rawTerm);
    if (!query) return 1;

    const name = normalizeProductSearchText(product?.display_name || product?.name);
    const compactName = compactProductSearchText(product?.display_name || product?.name);
    const sku = normalizeProductSearchText(product?.display_sku || product?.sku);
    const keywordText = normalizeProductSearchText(
        Array.isArray(product?.search_keywords)
            ? product.search_keywords.join(' ')
            : ''
    );
    const compactSku = compactProductSearchText(product?.display_sku || product?.sku);
    const compactKeywordText = compactProductSearchText(
        Array.isArray(product?.search_keywords)
            ? product.search_keywords.join(' ')
            : ''
    );
    const compactQuery = compactProductSearchText(rawTerm);
    const tokens = tokenizeProductSearch(rawTerm);
    const compactLeadToken = isCompactCompositeProductSearch(rawTerm) ? getCompactProductSearchLeadToken(rawTerm) : '';

    const phraseInName = Boolean(query) && name.includes(query);
    const phraseInCompactName = Boolean(compactQuery) && compactName.includes(compactQuery);
    const phraseInSku = Boolean(query) && sku.includes(query);
    const phraseInCompactSku = Boolean(compactQuery) && compactSku.includes(compactQuery);
    const phraseInKeywords = Boolean(query) && keywordText.includes(query);
    const phraseInCompactKeywords = Boolean(compactQuery) && compactKeywordText.includes(compactQuery);

    const nameTokenMatches = tokens.reduce((count, token) => {
        const compactToken = compactProductSearchText(token);
        return count + Number(name.includes(token) || (compactToken && compactName.includes(compactToken)));
    }, 0);
    const skuTokenMatches = tokens.reduce((count, token) => {
        const compactToken = compactProductSearchText(token);
        return count + Number(sku.includes(token) || (compactToken && compactSku.includes(compactToken)));
    }, 0);
    const keywordTokenMatches = tokens.reduce((count, token) => {
        const compactToken = compactProductSearchText(token);
        return count + Number(
            keywordText.includes(token)
            || (compactToken && compactKeywordText.includes(compactToken))
        );
    }, 0);
    const combinedTokenMatches = tokens.reduce((count, token) => {
        const compactToken = compactProductSearchText(token);
        return count + Number(
            name.includes(token)
            || (compactToken && compactName.includes(compactToken))
            || sku.includes(token)
            || (compactToken && compactSku.includes(compactToken))
            || keywordText.includes(token)
            || (compactToken && compactKeywordText.includes(compactToken))
        );
    }, 0);

    const minimumRelevantMatches = tokens.length <= 1 ? 1 : Math.max(2, tokens.length - 1);
    if (!phraseInName && !phraseInCompactName && !phraseInSku && !phraseInCompactSku && !phraseInKeywords && !phraseInCompactKeywords) {
        if (tokens.length === 0) return 0;
        if (combinedTokenMatches < minimumRelevantMatches) return 0;
    }

    let score = 0;

    if (sku === query || (compactQuery && compactSku === compactQuery)) score += 1500;
    if (name === query) score += 1400;
    if (compactQuery && compactName === compactQuery) score += 1320;
    if (phraseInSku || phraseInCompactSku) score += 880;
    if (phraseInName) score += 820;
    if (phraseInCompactName) score += 780;
    if (phraseInKeywords || phraseInCompactKeywords) score += 540;
    if (sku.startsWith(query) || (compactQuery && compactSku.startsWith(compactQuery))) score += 760;
    if (name.startsWith(query)) score += 700;
    if (compactQuery && compactName.startsWith(compactQuery)) score += 640;
    if (compactLeadToken && compactName.startsWith(compactLeadToken)) score += 520;
    if (compactLeadToken && name.startsWith(compactLeadToken)) score += 420;

    score += combinedTokenMatches * 140;
    score += nameTokenMatches * 50;
    score += skuTokenMatches * 70;
    score += keywordTokenMatches * 65;

    if (tokens.length > 1 && combinedTokenMatches === tokens.length) score += 260;
    if (tokens.length > 1 && nameTokenMatches === tokens.length) score += 120;
    if (tokens.length > 2 && combinedTokenMatches === minimumRelevantMatches) score -= 40;

    return Math.max(score, 0);
};
const formatQuoteMoney = (value) => `${quoteCurrencyFormatter.format(Number(value) || 0)} đ`;
const quoteCanvasPageWidth = 1200;
const ORDER_KIND_META = {
    official: {
        label: 'Đơn hàng',
        shortLabel: 'Đơn hàng',
        icon: 'shopping_cart',
        submitLabel: 'Lưu đơn hàng',
        createTitle: 'Tạo đơn hàng mới',
        editTitle: 'Chỉnh sửa đơn hàng',
    },
    draft: {
        label: 'Đơn nháp',
        shortLabel: 'Đơn nháp',
        icon: 'draft_orders',
        submitLabel: 'Lưu đơn nháp',
        createTitle: 'Tạo đơn nháp',
        editTitle: 'Chỉnh sửa đơn nháp',
    },
};

const getOrderKindMeta = (orderKind) => ORDER_KIND_META[orderKind] || ORDER_KIND_META.official;
const MAIN_ORDER_KIND = 'official';
const DRAFT_ORDER_KIND = 'draft';
const isDraftOrderKind = (orderKind) => String(orderKind || MAIN_ORDER_KIND) === DRAFT_ORDER_KIND;
const getNormalizedOrderKind = (orderKind) => (isDraftOrderKind(orderKind) ? DRAFT_ORDER_KIND : MAIN_ORDER_KIND);
const buildOrderListUrl = (orderKind = MAIN_ORDER_KIND) => (isDraftOrderKind(orderKind) ? '/admin/orders?view=draft' : '/admin/orders');
const hasNonEmptyText = (value) => String(value ?? '').trim() !== '';
const formatDetectionFieldList = (fields = []) => {
    const uniqueFields = [...new Set(fields.filter(Boolean))];
    if (uniqueFields.length === 0) return '';
    if (uniqueFields.length === 1) return uniqueFields[0];
    if (uniqueFields.length === 2) return `${uniqueFields[0]} và ${uniqueFields[1]}`;
    return `${uniqueFields.slice(0, -1).join(', ')} và ${uniqueFields[uniqueFields.length - 1]}`;
};
const buildAddressDetectionFeedback = (confidence, autoFilledFields = []) => {
    const normalizedConfidence = String(confidence || 'none');
    const fieldSummary = formatDetectionFieldList(autoFilledFields);

    if (!fieldSummary) {
        if (normalizedConfidence === 'exact') {
            return {
                type: 'success',
                message: 'Đã nhận diện nhưng không tự điền vì các trường liên quan đã có dữ liệu.',
            };
        }

        return {
            type: 'warning',
            message: normalizedConfidence === 'none'
                ? 'Không tự nhận diện chắc chắn và không tự điền vì các trường liên quan đã có dữ liệu. Vui lòng kiểm tra lại đơn vị hành chính.'
                : 'Đã nhận diện gần đúng nhưng không tự điền vì các trường liên quan đã có dữ liệu. Vui lòng kiểm tra lại trước khi lưu.',
        };
    }

    if (normalizedConfidence === 'exact') {
        return {
            type: 'success',
            message: `Đã tự điền ${fieldSummary}.`,
        };
    }

    return {
        type: 'warning',
        message: normalizedConfidence === 'none'
            ? `Chưa tự nhận diện chắc chắn đơn vị hành chính. Đã tự điền ${fieldSummary}. Vui lòng kiểm tra lại.`
            : `Đã tự điền ${fieldSummary} từ nội dung nhận diện gần đúng. Vui lòng kiểm tra lại trước khi lưu.`,
    };
};
const parseMoneyNumber = (value, fallback = null) => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};
const parseSignedMoneyInputValue = (value) => {
    const rawValue = String(value ?? '').replace(/\s+/g, '');
    if (rawValue === '' || rawValue === '-') {
        return null;
    }

    const isNegative = rawValue.startsWith('-');
    const digits = rawValue.replace(/[^0-9]/g, '');
    if (!digits) {
        return null;
    }

    const numericValue = Number.parseInt(digits, 10);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    return isNegative ? -numericValue : numericValue;
};
const normalizeSignedMoneyInputValue = (value) => {
    const rawValue = String(value ?? '').replace(/\s+/g, '');
    if (rawValue === '') {
        return '';
    }

    const isNegative = rawValue.startsWith('-');
    const digits = rawValue.replace(/[^0-9]/g, '');
    if (!digits) {
        return isNegative ? '-' : '';
    }

    const formattedValue = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number.parseInt(digits, 10) || 0);
    return isNegative ? `-${formattedValue}` : formattedValue;
};
const formatSignedMoneyInputValue = (value) => normalizeSignedMoneyInputValue(parseMoneyNumber(value, 0) || 0);
const resolveSignedMoneyInputCommitValue = (value, fallback = 0) => {
    const parsedValue = parseSignedMoneyInputValue(value);
    if (parsedValue !== null) {
        return parsedValue;
    }

    const rawValue = String(value ?? '').replace(/\s+/g, '');
    return rawValue === '' || rawValue === '-' ? 0 : fallback;
};
const resolveFormattedMoneyCaretPosition = (formattedValue, digitCountBeforeCaret) => {
    if (digitCountBeforeCaret <= 0) {
        return formattedValue.startsWith('-') ? 1 : 0;
    }

    let seenDigits = 0;
    for (let index = 0; index < formattedValue.length; index += 1) {
        if (/\d/.test(formattedValue[index])) {
            seenDigits += 1;
        }

        if (seenDigits >= digitCountBeforeCaret) {
            return index + 1;
        }
    }

    return formattedValue.length;
};
const parseQuantityNumber = (value, fallback = null) => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const numericValue = Number(typeof value === 'string' ? value.replace(',', '.') : value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};
const MIN_ORDER_ITEM_QUANTITY = 0.001;
const normalizeOrderLineQuantity = (value, fallback = 1) => {
    const fallbackValue = Math.max(MIN_ORDER_ITEM_QUANTITY, parseQuantityNumber(fallback, 1) || 1);
    const numericValue = parseQuantityNumber(value, fallbackValue);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return fallbackValue;
    }

    return Number(numericValue.toFixed(3));
};
const normalizeQuantityInputValue = (value) => {
    const rawValue = String(value ?? '').trimStart().replace(/,/g, '.');
    const numericValue = rawValue.replace(/[^0-9.]/g, '');
    if (!numericValue) {
        return '';
    }

    const [integerPartRaw, ...decimalParts] = numericValue.split('.');
    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '') || (decimalParts.length ? '0' : '');
    const decimalPart = decimalParts.join('').slice(0, 3);

    if (decimalParts.length > 0) {
        return `${integerPart || '0'}.${decimalPart}`;
    }

    return integerPart;
};
const parseQuantityInputValue = (value, fallback = 0) => {
    const normalizedValue = normalizeQuantityInputValue(value);
    if (!normalizedValue || normalizedValue === '.') {
        return fallback;
    }

    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};
const nudgeQuantityInputValue = (value, delta, min = 1) => {
    const fallbackValue = delta > 0 ? min - 1 : min + 1;
    const currentValue = parseQuantityInputValue(value, fallbackValue);
    const nextValue = delta > 0
        ? Math.floor(currentValue) + 1
        : Math.ceil(currentValue) - 1;
    return normalizeQuantityInputValue(String(Math.max(min, nextValue)));
};
const handleQuantityInputKeyDown = (event, value, onCommit) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return;
    }

    event.preventDefault();
    onCommit(nudgeQuantityInputValue(value, event.key === 'ArrowUp' ? 1 : -1));
};
const handleQuantityInputPointerDown = (event, value, onCommit) => {
    if (event.button !== undefined && event.button !== 0) {
        return;
    }

    const input = event.currentTarget;
    const rect = input.getBoundingClientRect();
    const spinnerWidth = Math.min(22, rect.width * 0.36);

    if (event.clientX < rect.right - spinnerWidth) {
        return;
    }

    event.preventDefault();
    const delta = event.clientY < rect.top + (rect.height / 2) ? 1 : -1;
    onCommit(nudgeQuantityInputValue(value, delta));
    requestAnimationFrame(() => input.focus());
};
const resolveMoneyValue = (...candidates) => {
    for (const candidate of candidates) {
        const normalizedValue = parseMoneyNumber(candidate);
        if (normalizedValue !== null) {
            return normalizedValue;
        }
    }

    return 0;
};
const resolveDisplayedShippingFee = (source = {}) => {
    const candidates = [
        parseMoneyNumber(source?.display_shipping_fee),
        parseMoneyNumber(source?.internal_shipping_fee),
        parseMoneyNumber(source?.active_shipment?.shipping_cost),
        parseMoneyNumber(source?.activeShipment?.shipping_cost),
        parseMoneyNumber(source?.external_delivery_meta?.shipping_cost),
    ]
        .filter((candidate) => candidate !== null)
        .map((candidate) => Math.max(candidate, 0));

    return candidates.length > 0 ? Math.max(...candidates) : 0;
};

const resolveOutgoingTrackingCode = (source = {}) => String(
    source?.shipping_tracking_code
    || source?.active_shipment?.carrier_tracking_code
    || source?.active_shipment?.tracking_number
    || source?.activeShipment?.carrier_tracking_code
    || source?.activeShipment?.tracking_number
    || ''
).trim();

const buildDefaultReturnTrackingCode = (orderType, trackingCode) => {
    const normalizedCode = String(trackingCode || '').trim();
    if (!normalizedCode) {
        return '';
    }

    if (normalizeOrderType(orderType) === ORDER_TYPE_EXCHANGE_RETURN) {
        return /DH$/i.test(normalizedCode) ? normalizedCode : `${normalizedCode}DH`;
    }

    if (normalizeOrderType(orderType) === ORDER_TYPE_PARTIAL_DELIVERY) {
        return /1P1$/i.test(normalizedCode) ? normalizedCode : `${normalizedCode}1P1`;
    }

    return '';
};

const calculateQuoteItemsSubtotal = (items = []) => (
    (Array.isArray(items) ? items : []).reduce((sum, item) => (
        sum
        + ((parseMoneyNumber(item?.price, 0) || 0) * (parseMoneyNumber(item?.quantity, 0) || 0))
    ), 0)
);
const buildQuotePricingSummary = (formData = {}) => {
    return buildOrderPricingSummary(formData);
    const subtotal = calculateQuoteItemsSubtotal(formData?.items);
    const shippingFee = parseMoneyNumber(formData?.shipping_fee, 0) || 0;
    const discountAmount = parseMoneyNumber(formData?.discount, 0) || 0;
    const totalPayment = subtotal + shippingFee - discountAmount;
    const hasDiscount = discountAmount > 0;
    const extraRows = hasDiscount
        ? [
            ...(shippingFee > 0
                ? [{ key: 'shipping_fee', label: 'Phí vận chuyển', value: shippingFee }]
                : []),
            { key: 'discount', label: 'Chiết khấu/Giảm', value: discountAmount, isDeduction: true },
            { key: 'total_payment', label: 'Tổng thanh toán', value: totalPayment, isEmphasis: true },
        ]
        : [];

    return {
        subtotal,
        shippingFee,
        discountAmount,
        totalPayment,
        hasDiscount,
        extraRows,
    };
};
const buildOrderPricingSummary = (formData = {}) => {
    const subtotal = calculateQuoteItemsSubtotal(formData?.items);
    const shippingFee = resolveDisplayedShippingFee(formData);
    const discountAmount = parseMoneyNumber(formData?.discount, 0) || 0;
    const normalizedOrderType = normalizeOrderType(formData?.order_type);
    const specialOrderType = isSpecialOrderType(normalizedOrderType);
    const basePaymentTotal = subtotal - discountAmount;
    const supplementItemsTotal = specialOrderType
        ? calculateSupplementItemsTotal(formData?.supplement_items)
        : 0;
    const settlementDelta = specialOrderType
        ? (parseMoneyNumber(formData?.settlement_delta, 0) || 0)
        : 0;
    const exchangeRevenueTotal = basePaymentTotal - supplementItemsTotal + settlementDelta;
    const exchangeRefundAmount = normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN
        ? Math.max(0, -exchangeRevenueTotal)
        : 0;
    const totalPayment = normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN
        ? Math.max(0, exchangeRevenueTotal)
        : basePaymentTotal;
    const hasDiscountAdjustment = discountAmount !== 0;
    const hasAdjustment = hasDiscountAdjustment
        || (normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN && (supplementItemsTotal > 0 || settlementDelta !== 0));
    const extraRows = [
        ...(shippingFee > 0
            ? [{ key: 'shipping_fee', label: 'Phí vận chuyển', value: shippingFee }]
            : []),
        ...(hasDiscountAdjustment
            ? [{
                key: 'discount',
                label: 'Chiết khấu/Giảm',
                value: Math.abs(discountAmount),
                prefix: discountAmount > 0 ? '-' : '+',
                isDeduction: discountAmount > 0,
            }]
            : []),
        ...(normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN && supplementItemsTotal > 0
            ? [{
                key: 'exchange_return_items',
                label: 'Hàng trả về',
                value: supplementItemsTotal,
                prefix: '-',
                isDeduction: true,
            }]
            : []),
        ...(normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN && settlementDelta !== 0
            ? [{
                key: 'exchange_settlement_delta',
                label: 'Chênh lệch đổi trả',
                value: Math.abs(settlementDelta),
                prefix: settlementDelta > 0 ? '+' : '-',
                isDeduction: settlementDelta < 0,
            }]
            : []),
        ...((shippingFee > 0 || hasAdjustment)
            ? [{ key: 'total_payment', label: 'Tổng thanh toán', value: totalPayment, isEmphasis: true }]
            : []),
    ];

    return {
        subtotal,
        shippingFee,
        discountAmount,
        totalPayment,
        reportRevenueTotal: normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN ? exchangeRevenueTotal : totalPayment,
        exchangeRefundAmount,
        hasDiscount: hasAdjustment,
        extraRows,
    };
};
const resolveInventorySnapshot = (source, fallbackSource = null) => {
    const fallbackComputedStock = parseQuantityNumber(
        fallbackSource?.computed_stock,
        parseQuantityNumber(fallbackSource?.stock_quantity)
    );
    const fallbackPendingExportQuantity = parseQuantityNumber(fallbackSource?.pending_export_quantity);
    const computedStock = parseQuantityNumber(
        source?.computed_stock,
        parseQuantityNumber(source?.stock_quantity, fallbackComputedStock)
    );
    const pendingExportQuantity = parseQuantityNumber(
        source?.pending_export_quantity,
        fallbackPendingExportQuantity
    );
    const computedAvailableToSell = computedStock !== null && pendingExportQuantity !== null
        ? computedStock - pendingExportQuantity
        : null;
    const availableToSell = parseQuantityNumber(
        source?.available_to_sell,
        computedAvailableToSell ?? parseQuantityNumber(fallbackSource?.available_to_sell)
    );

    return {
        computed_stock: computedStock,
        pending_export_quantity: pendingExportQuantity,
        available_to_sell: availableToSell,
    };
};
const resolveOrderUnitLabel = (...sources) => {
    for (const source of sources) {
        if (!source || typeof source !== 'object') continue;

        const candidates = [
            source.unit_name,
            source.unit_label,
            source.inventory_unit_name,
            source.product_unit_name,
            source.product_unit_snapshot,
            source.unit?.name,
            source.inventory_unit?.name,
            source.parentConfigurable?.unit_name,
            source.parentConfigurable?.unit_label,
            source.parentConfigurable?.inventory_unit_name,
            source.parentConfigurable?.product_unit_name,
            source.parentConfigurable?.product_unit_snapshot,
            source.parentConfigurable?.unit?.name,
            source.parentConfigurable?.inventory_unit?.name,
            source.product?.unit_name,
            source.product?.unit_label,
            source.product?.inventory_unit_name,
            source.product?.product_unit_name,
            source.product?.product_unit_snapshot,
            source.product?.unit?.name,
            source.product?.inventory_unit?.name,
            source.product?.parentConfigurable?.unit_name,
            source.product?.parentConfigurable?.unit_label,
            source.product?.parentConfigurable?.inventory_unit_name,
            source.product?.parentConfigurable?.product_unit_name,
            source.product?.parentConfigurable?.product_unit_snapshot,
            source.product?.parentConfigurable?.unit?.name,
            source.product?.parentConfigurable?.inventory_unit?.name,
        ];

        for (const candidate of candidates) {
            const normalizedCandidate = normalizeCanvasText(candidate);
            if (normalizedCandidate) {
                return normalizedCandidate;
            }
        }
    }

    return '';
};
const getOrderUnitDisplay = (source, fallback = '-') => resolveOrderUnitLabel(source) || fallback;
const hasInventorySnapshot = (source) => {
    const snapshot = resolveInventorySnapshot(source);

    return snapshot.computed_stock !== null
        && snapshot.pending_export_quantity !== null
        && snapshot.available_to_sell !== null;
};
const formatOrderFormQuantity = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(value) || 0);
const buildAvailableToSellCellTitle = (source) => {
    const snapshot = resolveInventorySnapshot(source);

    if (snapshot.computed_stock === null || snapshot.pending_export_quantity === null) {
        return 'Đang đồng bộ Tồn kho và SL chờ xuất';
    }

    return `Tồn kho: ${formatOrderFormQuantity(snapshot.computed_stock)} | SL chờ xuất: ${formatOrderFormQuantity(snapshot.pending_export_quantity)}`;
};
const getAvailableToSellTextClass = (value) => {
    if (value === null) return 'text-primary/25';
    if (value < 0) return 'text-brick';
    if (value === 0) return 'text-amber-600';
    return 'text-emerald-700';
};
const resolveRoundedImportCostValue = (value, fallback = 0) => normalizeRoundedImportCostNumber(value) ?? fallback;
const resolveProductCostPrice = (product, fallback = 0) => resolveRoundedImportCostValue(resolveMoneyValue(
    product?.current_cost_price,
    product?.cost_price,
    product?.expected_cost,
    product?.product?.cost_price,
    product?.product?.expected_cost,
    fallback
), fallback);
const hasProductCostSnapshot = (product) => [
    product?.current_cost_price,
    product?.cost_price,
    product?.expected_cost,
    product?.product?.cost_price,
    product?.product?.expected_cost,
].some((value) => parseMoneyNumber(value) !== null);
const normalizeProductPickerEntry = (product) => {
    if (!product || typeof product !== 'object') return product;

    const inventorySnapshot = resolveInventorySnapshot(product);

    return {
        ...product,
        ...inventorySnapshot,
        price: resolveMoneyValue(product?.price, 0),
        expected_cost: parseMoneyNumber(product?.expected_cost),
        cost_price: resolveProductCostPrice(product),
        unit_name: resolveOrderUnitLabel(product),
        variations: Array.isArray(product?.variations)
            ? product.variations.map((variation) => ({
                ...variation,
                ...resolveInventorySnapshot(variation),
                price: resolveMoneyValue(variation?.price, 0),
                expected_cost: parseMoneyNumber(variation?.expected_cost),
                cost_price: resolveProductCostPrice(variation),
                unit_name: resolveOrderUnitLabel(variation, product),
            }))
            : product?.variations,
        bundle_options: Array.isArray(product?.bundle_options)
            ? product.bundle_options.map((bundleOption) => ({
                ...bundleOption,
                items: Array.isArray(bundleOption?.items)
                    ? bundleOption.items.map((bundleItem) => ({
                        ...bundleItem,
                        ...resolveInventorySnapshot(bundleItem),
                        price: resolveMoneyValue(bundleItem?.price, 0),
                        expected_cost: parseMoneyNumber(bundleItem?.expected_cost),
                        cost_price: resolveProductCostPrice(bundleItem),
                        unit_name: resolveOrderUnitLabel(bundleItem, product),
                    }))
                    : bundleOption?.items,
            }))
            : product?.bundle_options,
    };
};
const calculateItemsCostTotal = (items = []) => items.reduce(
    (sum, item) => sum + calculateRoundedImportCostLineTotal(item?.cost_price, parseMoneyNumber(item?.quantity, 0) || 0),
    0
);
const calculateSupplementItemsTotal = (items = []) => items.reduce(
    (sum, item) => sum + ((parseMoneyNumber(item?.price, 0) || 0) * (parseMoneyNumber(item?.quantity, 0) || 0)),
    0
);
const calculateSupplementItemsCostTotal = (items = []) => items.reduce(
    (sum, item) => sum + calculateRoundedImportCostLineTotal(item?.cost_price, parseMoneyNumber(item?.quantity, 0) || 0),
    0
);
const calculateAutomaticDiscountAdjustment = (orderType, items = []) => (
    normalizeOrderType(orderType) === ORDER_TYPE_PARTIAL_DELIVERY
        ? calculateSupplementItemsTotal(items)
        : 0
);
const calculateEffectiveDiscountValue = (manualDiscount, orderType, items = []) => (
    (parseMoneyNumber(manualDiscount, 0) || 0) + calculateAutomaticDiscountAdjustment(orderType, items)
);
const calculateManualDiscountValue = (effectiveDiscount, orderType, items = []) => (
    normalizeOrderType(orderType) === ORDER_TYPE_PARTIAL_DELIVERY
        ? ((parseMoneyNumber(effectiveDiscount, 0) || 0) - calculateAutomaticDiscountAdjustment(orderType, items))
        : (parseMoneyNumber(effectiveDiscount, 0) || 0)
);
const resolveLoadedDiscountState = (order = {}, orderType, items = [], supplementItems = []) => {
    const rawDiscount = parseMoneyNumber(order?.discount, 0) || 0;
    const rawManualDiscount = parseMoneyNumber(order?.manual_discount, rawDiscount) || 0;

    if (normalizeOrderType(orderType) !== ORDER_TYPE_EXCHANGE_RETURN) {
        return {
            manualDiscount: rawManualDiscount,
            discount: rawDiscount,
        };
    }

    const apiLegacyAdjustment = parseMoneyNumber(order?.legacy_exchange_discount_adjustment, 0) || 0;
    const supplementTotal = calculateSupplementItemsTotal(supplementItems);
    const itemSubtotal = calculateQuoteItemsSubtotal(items);
    const storedTotal = parseMoneyNumber(order?.total_price);
    const legacyAdjustment = apiLegacyAdjustment > 0
        ? apiLegacyAdjustment
        : (
            supplementTotal > 0 && rawDiscount >= supplementTotal
                ? supplementTotal
                : (
                    supplementTotal <= 0
                    && rawDiscount > 0
                    && storedTotal !== null
                    && storedTotal <= 0
                    && itemSubtotal > 0
                    && rawDiscount >= itemSubtotal
                        ? rawDiscount
                        : 0
                )
        );
    const manualDiscount = Math.max(0, rawManualDiscount - legacyAdjustment);

    return {
        manualDiscount,
        discount: manualDiscount,
    };
};
const collectSupplementDeclarationCodes = (items = []) => Array.from(new Set(
    (Array.isArray(items) ? items : [])
        .map((item) => String(item?.sku || '').trim() || (item?.product_id ? `SP#${item.product_id}` : ''))
        .filter(Boolean)
));
const buildCompactSupplementCodeSummary = (codes = []) => {
    if (!Array.isArray(codes) || codes.length === 0) {
        return 'Chưa khai báo';
    }

    if (codes.length <= 2) {
        return codes.join(', ');
    }

    return `${codes.slice(0, 2).join(', ')} +${codes.length - 2}`;
};
const resolveOrderItemCostPrice = (item, useCurrentProductCost = false) => {
    const resolvedValue = useCurrentProductCost
        ? resolveMoneyValue(
            item?.current_cost_price,
            item?.product?.cost_price,
            item?.product?.expected_cost,
            item?.cost_price,
            0
        )
        : resolveMoneyValue(
            item?.cost_price,
            item?.product?.cost_price,
            item?.product?.expected_cost,
            0
        );

    return resolveRoundedImportCostValue(resolvedValue, 0);
};
const getPickerAttributeValues = (product) => (
    Array.isArray(product?.attribute_values)
        ? product.attribute_values
        : (Array.isArray(product?.attributeValues) ? product.attributeValues : [])
);
const buildProductAttributesMap = (product) => {
    const map = {};

    getPickerAttributeValues(product).forEach((attributeValue) => {
        const attributeId = String(attributeValue?.attribute_id ?? attributeValue?.attribute?.id ?? '').trim();
        if (!attributeId || attributeValue?.value === null || attributeValue?.value === undefined) return;
        map[attributeId] = attributeValue.value;
    });

    return Object.keys(map).length > 0 ? map : undefined;
};
const getPickerPrimaryImage = (product) => String(
    product?.main_image
    || product?.primary_image?.url
    || product?.image_url
    || ''
).trim();
const buildAttributeValueSummary = (product) => Array.from(new Set(
    getPickerAttributeValues(product)
        .flatMap((attributeValue) => parseProductAttributeValueList(attributeValue?.value))
        .filter(Boolean)
)).join(' / ');
const buildVariationDisplayName = (parentName, variationName, optionLabel) => {
    const normalizedParentName = normalizeCanvasText(parentName);
    const normalizedVariationName = normalizeCanvasText(variationName);
    const normalizedOptionLabel = normalizeCanvasText(optionLabel);

    if (normalizedVariationName) {
        return normalizedVariationName;
    }

    if (normalizedParentName && normalizedOptionLabel) {
        return `${normalizedParentName} - ${normalizedOptionLabel}`;
    }

    if (normalizedParentName) {
        return normalizedParentName;
    }

    return normalizedVariationName || normalizedParentName || 'Biến thể sản phẩm';
};
const normalizeOrderLineOptions = (options) => {
    if (!options || typeof options !== 'object') {
        return undefined;
    }

    const normalizedOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== null && value !== undefined && value !== '')
    );

    return Object.keys(normalizedOptions).length > 0 ? normalizedOptions : undefined;
};
const mergeOrderLineOptions = (...optionGroups) => {
    let mergedOptions = {};

    optionGroups.forEach((optionGroup) => {
        const normalizedOptions = normalizeOrderLineOptions(optionGroup);
        if (!normalizedOptions) return;
        mergedOptions = {
            ...mergedOptions,
            ...normalizedOptions,
        };
    });

    return Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined;
};
const extractOrderItemOptionsFromProductPayload = (product) => {
    if (!product || typeof product !== 'object') {
        return undefined;
    }

    const parentProductId = Number(product?.parent_product_id) || undefined;
    const parentProductName = normalizeCanvasText(product?.parent_product_name);
    const optionLabel = normalizeCanvasText(product?.option_label);
    const variantName = normalizeCanvasText(product?.variant_name || product?.name);
    const entryKind = normalizeCanvasText(product?.entry_kind);

    if (!parentProductId && !parentProductName && !optionLabel && entryKind !== SEARCH_ENTRY_VARIATION) {
        return undefined;
    }

    return normalizeOrderLineOptions({
        variant_parent_id: parentProductId,
        variant_parent_name: parentProductName,
        variant_label: optionLabel,
        variant_name: variantName,
        search_entry_kind: entryKind || SEARCH_ENTRY_VARIATION,
    });
};
const resolveOrderLineItemDisplayName = ({ name, options, fallbackName = '' }) => {
    const normalizedName = normalizeCanvasText(name);
    const normalizedFallbackName = normalizeCanvasText(fallbackName);
    const normalizedOptions = normalizeOrderLineOptions(options);

    if (normalizedOptions) {
        const variationDisplayName = buildVariationDisplayName(
            normalizedOptions?.variant_parent_name,
            normalizeCanvasText(normalizedOptions?.variant_name) || normalizedFallbackName || normalizedName,
            normalizedOptions?.variant_label
        );

        if (variationDisplayName) {
            return variationDisplayName;
        }
    }

    return normalizedName || normalizedFallbackName || 'Sản phẩm';
};
const resolveBundleOptionTitle = (bundleOption) => normalizeCanvasText(
    bundleOption?.option_post_title
    || bundleOption?.option_title
    || bundleOption?.title
    || 'Mặc định'
);
const resolveBundleOptionKey = (bundleOption) => {
    const explicitKey = normalizeCanvasText(bundleOption?.key);
    if (explicitKey) {
        return explicitKey;
    }

    const optionPostId = Number(bundleOption?.option_post_id) || 0;
    const optionTitle = resolveBundleOptionTitle(bundleOption);

    return optionPostId > 0
        ? `post-${optionPostId}`
        : `title-${compactProductSearchText(optionTitle) || 'default'}`;
};
const normalizeOrderAiItemMeta = (value = null) => {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const matchReasons = Array.isArray(value?.match_reasons)
        ? value.match_reasons.map((reason) => normalizeCanvasText(reason)).filter(Boolean).slice(0, 4)
        : [];
    const confidence = Math.max(0, Math.min(99, Number(value?.confidence ?? 0) || 0));
    const reviewState = normalizeCanvasText(value?.review_state).toLowerCase() === 'confirmed'
        ? 'confirmed'
        : 'pending';

    return {
        source: 'order_ai',
        session_id: normalizeCanvasText(value?.session_id),
        review_state: reviewState,
        source_phrase: normalizeCanvasText(value?.source_phrase),
        confidence,
        confidence_label: normalizeCanvasText(value?.confidence_label) || (confidence >= 85 ? 'Rất cao' : confidence >= 70 ? 'Cao' : confidence >= 50 ? 'Cần rà' : 'Thấp'),
        match_status: normalizeCanvasText(value?.match_status) || 'review',
        matched_rule_label: normalizeCanvasText(value?.matched_rule_label),
        matched_rule_context: normalizeCanvasText(value?.matched_rule_context),
        matched_rule_alias: normalizeCanvasText(value?.matched_rule_alias),
        bonus: Boolean(value?.bonus),
        match_reasons: matchReasons,
        inserted_at: normalizeCanvasText(value?.inserted_at) || new Date().toISOString(),
        confirmed_at: normalizeCanvasText(value?.confirmed_at),
    };
};
const mergeOrderAiItemMeta = (existingMeta, incomingMeta) => {
    const normalizedIncoming = normalizeOrderAiItemMeta(incomingMeta);
    if (!normalizedIncoming) {
        return normalizeOrderAiItemMeta(existingMeta);
    }

    const normalizedExisting = normalizeOrderAiItemMeta(existingMeta);

    return {
        ...(normalizedExisting || {}),
        ...normalizedIncoming,
        review_state: normalizedIncoming.review_state || normalizedExisting?.review_state || 'pending',
        match_reasons: Array.from(new Set([
            ...(normalizedExisting?.match_reasons || []),
            ...(normalizedIncoming.match_reasons || []),
        ])).slice(0, 4),
    };
};
const isOrderAiItem = (item) => Boolean(item?.ai_meta?.source === 'order_ai');
const isPendingOrderAiItem = (item) => isOrderAiItem(item) && item?.ai_meta?.review_state !== 'confirmed';
const applySequentialOrderLineSortOrder = (items = []) => (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    sort_order: index + 1,
}));
const createOrderLineItem = (payload = {}) => {
    const {
        line_id,
        product_id,
        actual_product_id,
        name,
        sku,
        snapshot_name,
        snapshot_sku,
        actual_name,
        actual_sku,
        actual_snapshot_name,
        actual_snapshot_sku,
        unit_name,
        sort_order,
        quantity = 1,
        price = 0,
        cost_price = 0,
        computed_stock = null,
        pending_export_quantity = null,
        available_to_sell = null,
        options = undefined,
        ai_meta = undefined,
        category_id = undefined,
        product_attributes = undefined,
        main_image = '',
        notes = '',
        replaced_from_name = '',
    } = payload || {};
    const normalizedOptions = normalizeOrderLineOptions(options);
    const inventorySnapshot = resolveInventorySnapshot({
        computed_stock,
        pending_export_quantity,
        available_to_sell,
    });
    const normalizedAiMeta = normalizeOrderAiItemMeta(ai_meta);
    const resolvedName = resolveOrderLineItemDisplayName({ name, options: normalizedOptions });
    const resolvedSku = normalizeCanvasText(sku) || 'N/A';
    const resolvedSnapshotName = resolveOrderLineItemDisplayName({
        name: snapshot_name ?? name,
        options: normalizedOptions,
        fallbackName: resolvedName,
    });
    const resolvedSnapshotSku = normalizeCanvasText(snapshot_sku ?? sku) || resolvedSku;
    const resolvedCostPrice = resolveRoundedImportCostValue(cost_price, 0);
    const normalizedActualProductId = Number(actual_product_id) || 0;
    const resolvedActualName = resolveOrderLineItemDisplayName({
        name: actual_name,
        options: normalizedOptions,
        fallbackName: '',
    });
    const resolvedActualSku = normalizeCanvasText(actual_sku) || '';
    const resolvedActualSnapshotName = resolveOrderLineItemDisplayName({
        name: actual_snapshot_name ?? actual_name,
        options: normalizedOptions,
        fallbackName: resolvedActualName,
    });
    const resolvedActualSnapshotSku = normalizeCanvasText(actual_snapshot_sku ?? actual_sku) || resolvedActualSku;

    return {
        line_id: normalizeCanvasText(line_id) || createOrderLineId('order-item'),
        product_id: Number(product_id) || 0,
        actual_product_id: normalizedActualProductId || null,
        name: resolvedName,
        sku: resolvedSku,
        snapshot_name: resolvedSnapshotName,
        snapshot_sku: resolvedSnapshotSku,
        unit_name: resolveOrderUnitLabel(payload, { unit_name }),
        sort_order: Math.max(1, Number(sort_order) || 1),
        quantity: normalizeOrderLineQuantity(quantity),
        price: Number(price) || 0,
        cost_price: resolvedCostPrice,
        base_cost_price: resolveRoundedImportCostValue(payload.base_cost_price, resolvedCostPrice),
        actual_name: normalizedActualProductId > 0 ? resolvedActualName : '',
        actual_sku: normalizedActualProductId > 0 ? resolvedActualSku : '',
        actual_snapshot_name: normalizedActualProductId > 0 ? resolvedActualSnapshotName : '',
        actual_snapshot_sku: normalizedActualProductId > 0 ? resolvedActualSnapshotSku : '',
        computed_stock: inventorySnapshot.computed_stock,
        pending_export_quantity: inventorySnapshot.pending_export_quantity,
        available_to_sell: inventorySnapshot.available_to_sell,
        options: normalizedOptions && Object.keys(normalizedOptions).length > 0 ? normalizedOptions : undefined,
        ai_meta: normalizedAiMeta,
        category_id: Number(category_id) || undefined,
        parent_product_id: Number(payload.parent_product_id ?? normalizedOptions?.variant_parent_id) || undefined,
        product_attributes: product_attributes ? { ...product_attributes } : undefined,
        main_image: String(main_image || payload.primary_image?.url || payload.image_url || '').trim(),
        notes: String(notes || '').trim(),
        replaced_from_name: String(replaced_from_name || '').trim(),
    };
};
const hasActualOrderProductOverride = (item) => hasOrderItemActualProductOverride(item);
const getOrderItemActualNameLabel = (item) => getOrderItemActualDisplayName(item, item?.actual_name || '');
const getOrderItemActualSkuLabel = (item) => getOrderItemActualDisplaySku(item, item?.actual_sku || '');
const getOrderItemEffectiveInventoryProductId = (item) => Number(item?.actual_product_id || item?.product_id || 0);
const getOrderItemEffectiveInventorySku = (item) => (
    hasActualOrderProductOverride(item)
        ? getOrderItemActualSkuLabel(item) || item?.sku || ''
        : item?.sku || ''
);
const getOrderItemEffectiveInventoryName = (item) => (
    hasActualOrderProductOverride(item)
        ? getOrderItemActualNameLabel(item) || item?.name || ''
        : item?.name || ''
);
const buildOrderItemMergeKey = (item) => {
    const options = item?.options || {};

    return [
        Number(item?.product_id) || 0,
        normalizeProductSearchText(options?.bundle_parent_id),
        normalizeProductSearchText(options?.bundle_option_key),
        normalizeProductSearchText(options?.bundle_option_title),
        normalizeProductSearchText(options?.variant_parent_id),
        normalizeProductSearchText(options?.variant_label),
    ].join('::');
};
const resolveLatestOrderItemName = (item, latest = null) => {
    const mergedOptions = mergeOrderLineOptions(
        item?.options,
        extractOrderItemOptionsFromProductPayload(latest)
    );

    return resolveOrderLineItemDisplayName({
        name: latest?.display_name || latest?.name || item?.name,
        options: mergedOptions,
        fallbackName: item?.name,
    });
};
const appendOrderItemsWithMergeResult = (currentItems = [], additions = [], { incrementExisting = false } = {}) => {
    const nextItems = Array.isArray(currentItems) ? [...currentItems] : [];
    const touchedLineIds = [];

    (Array.isArray(additions) ? additions : []).forEach((addition) => {
        const normalizedAddition = createOrderLineItem(addition || {});
        if (!normalizedAddition.product_id) {
            return;
        }

        const mergeKey = buildOrderItemMergeKey(normalizedAddition);
        const existingIndex = nextItems.findIndex((item) => buildOrderItemMergeKey(item) === mergeKey);

        if (existingIndex >= 0) {
            if (!incrementExisting) {
                return;
            }

            const existingItem = nextItems[existingIndex];
            const mergedOptions = mergeOrderLineOptions(existingItem.options, normalizedAddition.options);
            const mergedInventorySnapshot = resolveInventorySnapshot(normalizedAddition, existingItem);
            const incomingSku = normalizeCanvasText(normalizedAddition.sku);
            nextItems[existingIndex] = {
                ...existingItem,
                name: resolveOrderLineItemDisplayName({
                    name: normalizedAddition.name || existingItem.name,
                    options: mergedOptions,
                    fallbackName: existingItem.name,
                }),
                sku: incomingSku && incomingSku !== 'N/A' ? incomingSku : existingItem.sku,
                unit_name: resolveOrderUnitLabel(normalizedAddition, existingItem),
                quantity: normalizeOrderLineQuantity(
                    (Number(existingItem.quantity) || 0) + (Number(normalizedAddition.quantity) || 0)
                ),
                price: Number(normalizedAddition.price ?? existingItem.price ?? 0) || 0,
                cost_price: resolveRoundedImportCostValue(
                    normalizedAddition.cost_price ?? existingItem.cost_price ?? 0,
                    0
                ),
                computed_stock: mergedInventorySnapshot.computed_stock,
                pending_export_quantity: mergedInventorySnapshot.pending_export_quantity,
                available_to_sell: mergedInventorySnapshot.available_to_sell,
                options: mergedOptions,
                ai_meta: mergeOrderAiItemMeta(existingItem.ai_meta, normalizedAddition.ai_meta),
            };
            touchedLineIds.push(nextItems[existingIndex].line_id);
            return;
        }

        nextItems.push(normalizedAddition);
        touchedLineIds.push(normalizedAddition.line_id);
    });

    return {
        items: applySequentialOrderLineSortOrder(nextItems),
        touchedLineIds: Array.from(new Set(touchedLineIds.map((lineId) => normalizeCanvasText(lineId)).filter(Boolean))),
    };
};
const appendOrderItemsWithMerge = (currentItems = [], additions = [], options = {}) => appendOrderItemsWithMergeResult(currentItems, additions, options).items;
const buildOrderItemsFromSearchEntry = (entry) => {
    if (!entry || typeof entry !== 'object') {
        return [];
    }

    const entryKind = String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT);

    if (entryKind === SEARCH_ENTRY_BUNDLE_OPTION) {
        const bundleParentId = Number(entry?.bundle_parent_id) || 0;
        const bundleParentName = normalizeCanvasText(entry?.bundle_parent_name || entry?.parent_product_name || entry?.name);
        const bundleOptionTitle = resolveBundleOptionTitle(entry);
        const bundleOptionKey = normalizeCanvasText(entry?.bundle_option_key || resolveBundleOptionKey(entry));

        return (Array.isArray(entry?.bundle_items) ? entry.bundle_items : [])
            .map((bundleItem) => createOrderLineItem({
                product_id: Number(bundleItem?.product_id ?? bundleItem?.target_product_id ?? bundleItem?.id) || 0,
                name: normalizeCanvasText(bundleItem?.display_name || bundleItem?.name) || 'Sản phẩm bundle',
                sku: normalizeCanvasText(bundleItem?.display_sku || bundleItem?.sku),
                unit_name: resolveOrderUnitLabel(bundleItem),
                quantity: Math.max(1, Number(bundleItem?.quantity) || 1),
                price: Number(bundleItem?.price ?? 0) || 0,
                cost_price: resolveProductCostPrice(bundleItem),
                computed_stock: bundleItem?.computed_stock,
                pending_export_quantity: bundleItem?.pending_export_quantity,
                available_to_sell: bundleItem?.available_to_sell,
                category_id: bundleItem?.category_id,
                product_attributes: bundleItem?.attributes_map || bundleItem?.product_attributes,
                main_image: bundleItem?.main_image || bundleItem?.primary_image?.url || bundleItem?.image_url || '',
                options: {
                    bundle_parent_id: bundleParentId || undefined,
                    bundle_parent_name: bundleParentName,
                    bundle_option_key: bundleOptionKey,
                    bundle_option_title: bundleOptionTitle,
                    bundle_option_post_id: Number(entry?.option_post_id) || undefined,
                    bundle_option_post_title: normalizeCanvasText(entry?.option_post_title),
                    bundle_item_base_product_id: Number(bundleItem?.base_product_id) || undefined,
                    variant_label: normalizeCanvasText(bundleItem?.option_label || bundleItem?.variant_label),
                    variant_name: normalizeCanvasText(bundleItem?.variant_name),
                    search_entry_kind: SEARCH_ENTRY_BUNDLE_OPTION,
                },
            }))
            .filter((item) => item.product_id > 0);
    }

    const targetProductId = Number(entry?.target_product_id ?? entry?.product_id ?? entry?.id) || 0;
    if (!targetProductId) {
        return [];
    }

    const baseOptions = entryKind === SEARCH_ENTRY_VARIATION
        ? {
            variant_parent_id: Number(entry?.parent_product_id) || undefined,
            variant_parent_name: normalizeCanvasText(entry?.parent_product_name),
            variant_label: normalizeCanvasText(entry?.option_label),
            variant_name: normalizeCanvasText(entry?.name),
            search_entry_kind: SEARCH_ENTRY_VARIATION,
        }
        : undefined;

    return [createOrderLineItem({
        product_id: targetProductId,
        name: normalizeCanvasText(entry?.display_name || entry?.name) || `Sản phẩm #${targetProductId}`,
        sku: normalizeCanvasText(entry?.display_sku || entry?.sku),
        unit_name: resolveOrderUnitLabel(entry),
        quantity: 1,
        price: Number(entry?.price ?? 0) || 0,
        cost_price: resolveProductCostPrice(entry),
        computed_stock: entry?.computed_stock,
        pending_export_quantity: entry?.pending_export_quantity,
        available_to_sell: entry?.available_to_sell,
        category_id: entry?.category_id,
        product_attributes: entry?.attributes_map || entry?.product_attributes,
        main_image: entry?.main_image || entry?.primary_image?.url || entry?.image_url || '',
        options: baseOptions,
    })];
};
const canAddSearchEntry = (currentItems = [], entry) => {
    if (!entry || typeof entry !== 'object') {
        return false;
    }

    if (
        String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT) === SEARCH_ENTRY_PRODUCT
        && String(entry?.type || '').trim() === 'configurable'
    ) {
        return false;
    }

    if (String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT) === SEARCH_ENTRY_BUNDLE_OPTION) {
        return true;
    }

    const additions = buildOrderItemsFromSearchEntry(entry);
    if (additions.length === 0) {
        return false;
    }

    return additions.some((addition) => !currentItems.some((item) => (
        buildOrderItemMergeKey(item) === buildOrderItemMergeKey(addition)
    )));
};
const isSearchEntryAlreadyInOrder = (currentItems = [], entry) => {
    if (!entry || typeof entry !== 'object') {
        return false;
    }

    const additions = buildOrderItemsFromSearchEntry(entry);
    if (additions.length === 0) {
        return false;
    }

    return additions.every((addition) => currentItems.some((item) => (
        buildOrderItemMergeKey(item) === buildOrderItemMergeKey(addition)
    )));
};
const buildProductSearchEntries = (products = [], { includeNested = false } = {}) => {
    const entries = [];
    const seenEntryIds = new Set();

    const pushEntry = (entry) => {
        const entryId = normalizeCanvasText(entry?.entry_id);
        if (!entryId || seenEntryIds.has(entryId)) {
            return;
        }

        seenEntryIds.add(entryId);
        entries.push(entry);
    };

    (Array.isArray(products) ? products : []).forEach((rawProduct) => {
        if (!rawProduct || typeof rawProduct !== 'object') {
            return;
        }

        const product = normalizeProductPickerEntry(rawProduct);
        const baseName = normalizeCanvasText(product?.name) || 'Sản phẩm';
        const baseDisplayName = normalizeCanvasText(product?.display_name) || baseName;
        const baseSku = normalizeCanvasText(product?.sku);
        const baseDisplaySku = normalizeCanvasText(product?.display_sku) || baseSku;
        const baseEntry = {
            entry_id: `product-${Number(product?.id ?? product?.product_id) || 0}`,
            entry_kind: SEARCH_ENTRY_PRODUCT,
            id: Number(product?.id ?? product?.product_id) || 0,
            target_product_id: Number(product?.id ?? product?.product_id) || 0,
            name: baseName,
            display_name: baseDisplayName,
            sku: baseSku,
            display_sku: baseDisplaySku,
            price: Number(product?.price ?? 0) || 0,
            expected_cost: parseMoneyNumber(product?.expected_cost),
            cost_price: resolveProductCostPrice(product),
            unit_name: resolveOrderUnitLabel(product),
            ...resolveInventorySnapshot(product),
            type: normalizeCanvasText(product?.type),
            bundle_title: normalizeCanvasText(product?.bundle_title),
            main_image: getPickerPrimaryImage(product),
            attribute_values: getPickerAttributeValues(product),
            search_keywords: [
                baseName,
                baseDisplayName,
                baseSku,
                baseDisplaySku,
                normalizeCanvasText(product?.bundle_title),
                buildAttributeValueSummary(product),
            ].filter(Boolean),
        };

        if (
            baseEntry.id > 0
            && !(baseEntry.type === 'configurable' && Array.isArray(product?.variations) && product.variations.length > 0)
        ) {
            pushEntry(baseEntry);
        }

        if (!includeNested) {
            return;
        }

        (Array.isArray(product?.variations) ? product.variations : []).forEach((variation) => {
            const optionLabel = buildAttributeValueSummary(variation);
            const variationId = Number(variation?.id) || 0;
            if (!variationId) {
                return;
            }

            pushEntry({
                entry_id: `variation-${variationId}`,
                entry_kind: SEARCH_ENTRY_VARIATION,
                id: variationId,
                target_product_id: variationId,
                parent_product_id: baseEntry.id,
                parent_product_name: baseEntry.name,
                name: normalizeCanvasText(variation?.name) || baseEntry.name,
                display_name: buildVariationDisplayName(baseEntry.name, variation?.name, optionLabel),
                sku: normalizeCanvasText(variation?.sku),
                display_sku: normalizeCanvasText(variation?.sku || product?.sku),
                option_label: optionLabel,
                price: Number(variation?.price ?? 0) || 0,
                expected_cost: parseMoneyNumber(variation?.expected_cost),
                cost_price: resolveProductCostPrice(variation),
                unit_name: resolveOrderUnitLabel(variation, product),
                ...resolveInventorySnapshot(variation),
                type: normalizeCanvasText(variation?.type || 'simple'),
                main_image: getPickerPrimaryImage(variation) || baseEntry.main_image,
                attribute_values: getPickerAttributeValues(variation),
                parent_attribute_values: baseEntry.attribute_values,
                search_keywords: [
                    baseEntry.name,
                    normalizeCanvasText(variation?.name),
                    normalizeCanvasText(variation?.sku),
                    optionLabel,
                    buildAttributeValueSummary(variation),
                ].filter(Boolean),
            });
        });

        (Array.isArray(product?.bundle_options) ? product.bundle_options : []).forEach((bundleOption) => {
            const bundleOptionTitle = resolveBundleOptionTitle(bundleOption);
            const bundleOptionKey = resolveBundleOptionKey(bundleOption);
            const bundleItems = (Array.isArray(bundleOption?.items) ? bundleOption.items : [])
                .map((bundleItem) => ({
                    base_product_id: Number(bundleItem?.base_product_id) || undefined,
                    product_id: Number(bundleItem?.product_id ?? bundleItem?.target_product_id ?? bundleItem?.id) || 0,
                    name: normalizeCanvasText(bundleItem?.name) || 'Sản phẩm bundle',
                    display_name: normalizeCanvasText(bundleItem?.display_name || bundleItem?.name) || 'Sản phẩm bundle',
                    sku: normalizeCanvasText(bundleItem?.sku),
                    display_sku: normalizeCanvasText(bundleItem?.display_sku || bundleItem?.sku),
                    quantity: Math.max(1, Number(bundleItem?.quantity) || 1),
                    price: Number(bundleItem?.price ?? 0) || 0,
                    expected_cost: parseMoneyNumber(bundleItem?.expected_cost),
                    cost_price: resolveProductCostPrice(bundleItem),
                    unit_name: resolveOrderUnitLabel(bundleItem, product),
                    ...resolveInventorySnapshot(bundleItem),
                    main_image: getPickerPrimaryImage(bundleItem),
                    attribute_values: getPickerAttributeValues(bundleItem),
                    option_label: normalizeCanvasText(bundleItem?.option_label || bundleItem?.variant_label || buildAttributeValueSummary(bundleItem)),
                    variant_name: normalizeCanvasText(bundleItem?.variant_name),
                }))
                .filter((bundleItem) => bundleItem.product_id > 0);

            if (bundleItems.length === 0) {
                return;
            }

            const firstBundleImage = bundleItems.find((bundleItem) => bundleItem.main_image)?.main_image || baseEntry.main_image;
            const subtotal = Number(bundleOption?.subtotal ?? bundleItems.reduce((sum, bundleItem) => (
                sum + ((Number(bundleItem.price) || 0) * (Number(bundleItem.quantity) || 0))
            ), 0)) || 0;

            pushEntry({
                entry_id: `bundle-option-${baseEntry.id}-${bundleOptionKey}`,
                entry_kind: SEARCH_ENTRY_BUNDLE_OPTION,
                id: `bundle-option-${baseEntry.id}-${bundleOptionKey}`,
                target_product_id: baseEntry.id,
                bundle_parent_id: baseEntry.id,
                bundle_parent_name: baseEntry.name,
                bundle_option_key: bundleOptionKey,
                bundle_option_title: bundleOptionTitle,
                raw_bundle_option_title: normalizeCanvasText(bundleOption?.raw_option_title || bundleOption?.option_title),
                bundle_option_status: normalizeCanvasText(bundleOption?.bundle_option_status || 'visible'),
                bundle_title: baseEntry.bundle_title,
                bundle_config_title: baseEntry.bundle_title,
                option_post_id: Number(bundleOption?.option_post_id) || undefined,
                option_post_title: normalizeCanvasText(bundleOption?.option_post_title),
                name: baseEntry.name,
                display_name: baseEntry.name,
                sku: baseEntry.sku,
                display_sku: baseEntry.sku,
                price: subtotal,
                cost_price: bundleItems.reduce((sum, bundleItem) => (
                    sum + (resolveRoundedImportCostValue(bundleItem.cost_price, 0) * (Number(bundleItem.quantity) || 0))
                ), 0),
                type: baseEntry.type,
                main_image: firstBundleImage,
                bundle_items: bundleItems,
                bundle_item_count: bundleItems.length,
                bundle_quantity_total: bundleItems.reduce((sum, bundleItem) => sum + (Number(bundleItem.quantity) || 0), 0),
                search_keywords: [
                    baseEntry.name,
                    baseEntry.sku,
                    baseEntry.bundle_title,
                    bundleOptionTitle,
                    normalizeCanvasText(bundleOption?.raw_option_title),
                    normalizeCanvasText(bundleOption?.option_post_title),
                ].filter(Boolean),
            });
        });
    });

    return entries;
};
const buildProductQuickSetupEntries = (products = []) => (
    buildProductSearchEntries(products, { includeNested: true })
        .filter((entry) => canAddSearchEntry([], entry))
);
const buildStoredQuickSetupSearchEntries = (items = []) => {
    const entries = [];
    const seenEntryIds = new Set();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const targetProductId = Number(item?.target_product_id ?? item?.product_id ?? item?.id) || 0;
        if (!targetProductId) {
            return;
        }

        const entryKind = String(item?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
        const parentProductId = Number(item?.parent_product_id ?? 0);
        const parentProductName = normalizeCanvasText(item?.parent_product_name);
        const baseName = normalizeCanvasText(item?.name) || 'Sản phẩm';
        const displayName = entryKind === SEARCH_ENTRY_VARIATION
            ? buildVariationDisplayName(parentProductName, baseName, item?.option_label)
            : (normalizeCanvasText(item?.display_name) || baseName);
        const sku = normalizeCanvasText(item?.sku);
        const displaySku = normalizeCanvasText(item?.display_sku) || sku;
        const optionLabel = normalizeCanvasText(item?.option_label);
        const entryId = normalizeCanvasText(item?.entry_id) || `${entryKind}-${targetProductId}`;

        if (seenEntryIds.has(entryId)) {
            return;
        }

        seenEntryIds.add(entryId);
        entries.push({
            ...item,
            entry_id: entryId,
            entry_kind: entryKind,
            id: targetProductId,
            product_id: targetProductId,
            target_product_id: targetProductId,
            name: baseName,
            display_name: displayName,
            sku,
            display_sku: displaySku,
            price: Number(item?.price ?? 0) || 0,
            expected_cost: parseMoneyNumber(item?.expected_cost),
            cost_price: resolveProductCostPrice(item),
            unit_name: resolveOrderUnitLabel(item),
            ...resolveInventorySnapshot(item),
            type: normalizeCanvasText(item?.type),
            main_image: getPickerPrimaryImage(item),
            parent_product_id: Number.isFinite(parentProductId) && parentProductId > 0 ? parentProductId : null,
            parent_product_name: parentProductName,
            option_label: optionLabel,
            search_keywords: [
                baseName,
                displayName,
                sku,
                displaySku,
                parentProductName,
                optionLabel,
            ].filter(Boolean),
        });
    });

    return entries;
};
const getProductQuickSetupEntryId = (entry) => Number(
    entry?.target_product_id
    ?? entry?.product_id
    ?? entry?.bundle_parent_id
    ?? entry?.id
    ?? 0
) || 0;
const mergeProductQuickSetupEntries = (products = [], selectedItems = []) => {
    const fetchedEntries = Array.isArray(products) ? products : [];
    const fetchedMap = new Map();

    fetchedEntries.forEach((entry) => {
        const entryKey = getProductQuickSetupEntryKey(entry);
        if (entryKey && !fetchedMap.has(entryKey)) {
            fetchedMap.set(entryKey, entry);
        }
    });

    const mergedEntries = [];
    const seenEntryKeys = new Set();
    const pushEntry = (entry) => {
        const entryKey = getProductQuickSetupEntryKey(entry);
        if (!entryKey || seenEntryKeys.has(entryKey)) return;

        seenEntryKeys.add(entryKey);
        mergedEntries.push(entry);
    };

    fetchedEntries.forEach((entry) => {
        pushEntry(entry);
    });

    (Array.isArray(selectedItems) ? selectedItems : []).forEach((item) => {
        const entryId = getProductQuickSetupEntryId(item);
        if (entryId <= 0) return;
        const entryKey = getProductQuickSetupEntryKey(item);
        if (!entryKey) return;

        const fallbackEntry = normalizeProductPickerEntry({
            ...item,
            id: item?.id || entryId,
            entry_id: item?.entry_id || entryKey,
            product_id: entryId,
            target_product_id: entryId,
            entry_kind: item?.entry_kind || SEARCH_ENTRY_PRODUCT,
            display_name: item?.display_name || item?.name,
            display_sku: item?.display_sku || item?.sku,
        });

        pushEntry(fetchedMap.get(entryKey) || fallbackEntry);
    });

    return mergedEntries;
};

const waitForNodeImages = async (node) => {
    if (!node) return;

    const images = Array.from(node.querySelectorAll('img'));
    const imagePromises = images.map((image) => {
        if (image.complete) return Promise.resolve();

        return new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        });
    });

    await Promise.all(imagePromises);

    if (document.fonts?.ready) {
        try {
            await document.fonts.ready;
        } catch (error) {
            console.error('Font readiness check failed', error);
        }
    }
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

const loadCanvasImage = async (src) => {
    if (!src) return null;

    try {
        const normalizedSrc = src.startsWith('data:')
            ? src
            : `${String(api.defaults.baseURL || '').replace(/\/+$/, '')}/media/proxy?url=${encodeURIComponent(src)}`;

        const response = await fetch(normalizedSrc, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`IMAGE_FETCH_${response.status}`);
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);

        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = dataUrl;
        });
    } catch (error) {
        console.error('Failed to load canvas image', src, error);
        return null;
    }
};

const wrapCanvasText = (ctx, text, maxWidth) => {
    const normalized = normalizeCanvasText(text);
    if (!normalized) return [''];

    const paragraphs = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const lines = [];

    paragraphs.forEach((paragraph) => {
        const words = paragraph.split(/\s+/);
        let currentLine = '';

        words.forEach((word) => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(testLine).width <= maxWidth || !currentLine) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        });

        if (currentLine) lines.push(currentLine);
    });

    return lines.length ? lines : [''];
};

const fitCanvasText = (ctx, text, maxWidth) => {
    const normalized = normalizeCanvasText(text);
    if (!normalized) return '';
    if (ctx.measureText(normalized).width <= maxWidth) return normalized;

    const ellipsis = '...';
    let endIndex = normalized.length;

    while (endIndex > 0) {
        const candidate = `${normalized.slice(0, endIndex).trim()}${ellipsis}`;
        if (ctx.measureText(candidate).width <= maxWidth) {
            return candidate;
        }
        endIndex -= 1;
    }

    return ellipsis;
};

const drawFittedCanvasText = (ctx, text, x, y, maxWidth, {
    fontWeight = 700,
    maxFontSize = 24,
    minFontSize = 9,
    fontFamily = quoteCanvasFontFamily,
} = {}) => {
    const normalized = normalizeCanvasText(text);
    if (!normalized) return;

    let fontSize = maxFontSize;
    while (fontSize > minFontSize) {
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        if (ctx.measureText(normalized).width <= maxWidth) break;
        fontSize -= 1;
    }

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillText(normalized, x, y);
};

const drawTextLines = (ctx, lines, x, y, lineHeight, align = 'left') => {
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
        ctx.fillText(normalizeCanvasText(line), x, y + (index * lineHeight));
    });
};

const drawImageContain = (ctx, image, x, y, width, height) => {
    if (!image) return;

    const ratio = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    const drawX = x + ((width - drawWidth) / 2);
    const drawY = y + ((height - drawHeight) / 2);

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

const canCopyPngToClipboard = () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!navigator.clipboard?.write || typeof window.ClipboardItem !== 'function') return false;
    if (typeof window.ClipboardItem.supports === 'function') {
        return window.ClipboardItem.supports('image/png');
    }

    return true;
};

const copyPngBlobToClipboard = async (blob) => {
    if (!canCopyPngToClipboard()) {
        const error = new Error('CLIPBOARD_IMAGE_UNSUPPORTED');
        error.code = 'CLIPBOARD_IMAGE_UNSUPPORTED';
        throw error;
    }

    const ClipboardItemConstructor = window.ClipboardItem;
    await navigator.clipboard.write([
        new ClipboardItemConstructor({ 'image/png': blob }),
    ]);
};

const downloadQuoteImageBlob = (blob, customerName) => {
    const safeCustomerName = (customerName || 'khach-le')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'khach-le';

    const link = document.createElement('a');
    link.download = `bao-gia-${safeCustomerName}-${Date.now()}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

const QuoteCaptureSheet = ({ captureRef, quoteSettings, template, formData, orderId, totalQuantity, pricingSummary }) => {
    const headerAddress = [quoteSettings.quote_store_address, quoteSettings.quote_store_phone ? `Điện thoại: ${quoteSettings.quote_store_phone}` : '']
        .filter(Boolean)
        .join('\n');
    const hasLogo = Boolean(quoteSettings.quote_logo_url);
    const sheetTitle = orderId ? `Báo giá đơn #${orderId}` : 'Báo giá sản phẩm';
    const resolvedPricingSummary = pricingSummary || buildOrderPricingSummary(formData);
    const quoteSubtotal = resolvedPricingSummary.subtotal;
    const quoteExtraRows = resolvedPricingSummary.extraRows;

    return (
        <div ref={captureRef} className="w-[1125px] bg-white text-slate-900 shadow-2xl" style={{ fontFamily: 'var(--font-roboto)' }}>
            <div className="border-[2px] border-[#2F1A14]">
                <div className="grid grid-cols-[250px_minmax(0,1fr)] min-h-[210px]">
                    <div className="border-r border-[#2F1A14] flex items-center justify-center p-6">
                        {hasLogo ? (
                            <img src={quoteSettings.quote_logo_url} alt="Logo" className="max-w-full max-h-[150px] object-contain" />
                        ) : (
                            <div className="w-full h-[150px] border border-dashed border-[#C59A6A] flex items-center justify-center text-[#C59A6A] text-[28px] font-bold tracking-[0.2em]">
                                LOGO
                            </div>
                        )}
                    </div>

                    <div className="p-6 flex flex-col justify-center text-center">
                        <div className="text-[16px] font-bold uppercase tracking-[0.06em] leading-snug">
                            {quoteSettings.quote_store_name || 'Thông tin xưởng / cửa hàng'}
                        </div>
                        <div className="mt-4 whitespace-pre-line text-[12px] leading-6">
                            {headerAddress || 'Cấu hình địa chỉ và số điện thoại trong phần Cài đặt web > Báo giá.'}
                        </div>
                        <div className="mt-4 inline-flex self-center border border-[#2F1A14] px-4 py-1 text-[12px] font-bold uppercase tracking-[0.14em]">
                            {sheetTitle}
                        </div>
                    </div>
                </div>

                <table className="w-full border-collapse table-fixed">
                    <thead>
                        <tr className="bg-[#6B0F0F] text-white">
                            <th className="w-[240px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold">Hình ảnh sản phẩm</th>
                            <th className="border border-[#2F1A14] px-3 py-3 text-[12px] font-bold">Tên sản phẩm</th>
                            <th className="w-[84px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-center">SL</th>
                            <th className="w-[96px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-center">ÄVT</th>
                            <th className="w-[150px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-right">Đơn giá</th>
                            <th className="w-[170px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-right">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        {formData.items.map((item, index) => (
                            <tr key={`${template?.id || 'template'}-${item.line_id || item.product_id}-${index}`} className="align-top">
                                {index === 0 && (
                                    <td rowSpan={formData.items.length} className="border border-[#2F1A14] bg-[#8E0B0B] p-4 align-middle">
                                        <div className="flex h-full flex-col items-center justify-between text-white">
                                            <div className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em]">
                                                <span>{quoteSettings.quote_store_name || 'Báo giá'}</span>
                                                <span>{template?.name || 'Mẫu'}</span>
                                            </div>
                                            <div className="mt-4 flex-1 w-full bg-white/10 border border-white/15 p-3">
                                                {template?.image_url ? (
                                                    <img src={getQuoteTemplateImageUrl(template)} alt={template.name} className="h-[220px] w-full object-contain" />
                                                ) : (
                                                    <div className="h-[220px] w-full border border-dashed border-white/30 flex items-center justify-center text-[12px] uppercase tracking-[0.16em]">
                                                        Chưa có ảnh mẫu
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                )}
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] leading-6">{item.name}</td>
                                <td className="border border-[#D5CEC9] px-2 py-3 text-[12px] text-center font-semibold">{item.quantity}</td>
                                <td className="border border-[#D5CEC9] px-2 py-3 text-[12px] text-center font-semibold text-slate-700">{getOrderUnitDisplay(item)}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] text-right">{formatQuoteMoney(item.price)}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] text-right font-semibold">{formatQuoteMoney(item.price * item.quantity)}</td>
                            </tr>
                        ))}
                        <tr className="bg-[#F5E7BF]">
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold uppercase" colSpan={2}>Tổng món</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold text-center">{totalQuantity}</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold text-center">&nbsp;</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold text-center">Tổng tiền</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[13px] font-bold text-right">{formatQuoteMoney(quoteSubtotal)}</td>
                        </tr>
                        {quoteExtraRows.map((row) => (
                            <tr key={row.key} className={row.isEmphasis ? 'bg-[#F5E7BF]' : 'bg-[#FCF8F3]'}>
                                <td className="border border-[#2F1A14] px-4 py-3" colSpan={4}>&nbsp;</td>
                                <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold text-right">{row.label}</td>
                                <td className={`border border-[#2F1A14] px-4 py-3 text-[13px] font-bold text-right ${row.isDeduction ? 'text-[#8E0B0B]' : 'text-slate-900'}`}>
                                    {row.prefix || ''}{formatQuoteMoney(row.value)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ProductSearchOption = ({ product, onSelect, quickFilterAttribute = null, isAlreadyInOrder = false }) => {
    const nameRef = useRef(null);
    const [hasTruncation, setHasTruncation] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const displayName = product?.display_name || product?.name || '---';
    const quickFilterValues = useMemo(
        () => getProductQuickFilterDisplayValues(product, quickFilterAttribute),
        [product, quickFilterAttribute]
    );
    const secondaryMeta = useMemo(() => {
        if (product?.entry_kind === SEARCH_ENTRY_VARIATION) {
            return [
                product?.parent_product_name ? `SP cha: ${product.parent_product_name}` : '',
                product?.option_label ? `Biến thể: ${product.option_label}` : '',
            ].filter(Boolean);
        }

        if (product?.entry_kind === SEARCH_ENTRY_BUNDLE_OPTION) {
            return [
                product?.bundle_parent_name ? `Bundle: ${product.bundle_parent_name}` : '',
                product?.bundle_option_title ? `Tùy chọn: ${product.bundle_option_title}` : '',
                product?.bundle_item_count ? `${product.bundle_item_count} sản phẩm` : '',
            ].filter(Boolean);
        }

        return [];
    }, [product]);

    const checkTruncation = useCallback(() => {
        const nameTruncated = nameRef.current && nameRef.current.scrollWidth > nameRef.current.clientWidth + 1;
        return Boolean(nameTruncated);
    }, []);

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setHasTruncation(checkTruncation());
        });

        const handleResize = () => {
            setHasTruncation(checkTruncation());
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [checkTruncation, displayName]);

    const handleMouseEnter = () => {
        setHasTruncation(checkTruncation());
        setIsHovered(true);
    };

    return (
        <button
            type="button"
            onClick={() => {
                if (isAlreadyInOrder) return;
                onSelect(product);
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setIsHovered(false)}
            aria-disabled={isAlreadyInOrder}
            className={`w-full px-3 py-2.5 text-left border-b border-primary/5 flex items-center gap-3 transition-colors group relative overflow-visible ${isAlreadyInOrder ? 'cursor-not-allowed bg-primary/[0.03] opacity-75' : 'hover:bg-primary/5'}`}
        >
            <div className="size-8 bg-primary/5 rounded-sm flex items-center justify-center text-primary/10 overflow-hidden shrink-0">
                {product.main_image ? <img src={product.main_image} alt="" className="size-full object-cover" /> : <span className="material-symbols-outlined text-sm">image</span>}
            </div>
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p ref={nameRef} className="truncate text-[13px] font-bold tracking-tight text-primary">{displayName}</p>
                    {secondaryMeta.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {secondaryMeta.map((meta) => (
                                <span
                                    key={`${product.entry_id || product.id}-${meta}`}
                                    className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/70"
                                >
                                    {meta}
                                </span>
                            ))}
                        </div>
                    )}
                    {quickFilterAttribute && quickFilterValues.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                            {quickFilterValues.slice(0, 2).map((value) => (
                                <span
                                    key={`${product.entry_id || product.id}-${quickFilterAttribute.id}-${value}`}
                                    className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/70"
                                >
                                    {value}
                                </span>
                            ))}
                            {quickFilterValues.length > 2 && (
                                <span className="text-[10px] font-bold text-primary/35">+{quickFilterValues.length - 2}</span>
                            )}
                        </div>
                    )}
                    {isAlreadyInOrder && (
                        <div className="mt-1">
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-700">
                                Đã có trong đơn
                            </span>
                        </div>
                    )}
                </div>
                <span className="shrink-0 pt-0.5 text-[14px] font-extrabold text-blue-600">{new Intl.NumberFormat('vi-VN').format(product.price)}₫</span>
            </div>

            {isHovered && hasTruncation && (
                <div className="pointer-events-none absolute left-11 right-3 top-1/2 z-[120] -translate-y-1/2 rounded-sm border border-primary/10 bg-white/95 px-3 py-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] ring-1 ring-black/5 backdrop-blur-sm">
                    <div className="text-[12px] font-semibold leading-5 text-[#0F172A] break-words">
                        {displayName}
                    </div>
                </div>
            )}
        </button>
    );
};

const getOrderFormHeaderJustifyClass = (align = 'left') => {
    if (align === 'right') return 'justify-end';
    if (align === 'center') return 'justify-center';
    return 'justify-start';
};

const OrderFormHeaderLabel = ({ label, tooltip = '' }) => (
    <div className="relative inline-flex items-center group/tooltip">
        <span className="order-form-header-label block whitespace-nowrap leading-none text-primary font-black uppercase">{label}</span>
        {tooltip ? (
            <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-[240px] -translate-x-1/2 rounded-sm border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold normal-case tracking-normal text-slate-700 opacity-0 shadow-[0_16px_32px_rgba(15,23,42,0.16)] transition-all duration-150 group-hover/tooltip:opacity-100">
                {tooltip}
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-b-[6px] border-b-white border-x-[6px] border-x-transparent"></span>
            </span>
        ) : null}
    </div>
);

const normalizeOrderAiPreviewItem = (item, index) => ({
    ...item,
    line_key: item?.line_key || `order-ai-preview-${index + 1}`,
    quantity: normalizeOrderLineQuantity(item?.quantity ?? 1),
    suggestions: Array.isArray(item?.suggestions) ? item.suggestions : [],
    selected_entry: item?.selected_entry || null,
});
const createOrderAiLineMeta = (item, sessionId) => normalizeOrderAiItemMeta({
    session_id: sessionId,
    review_state: 'pending',
    source_phrase: item?.source_phrase || item?.parsed_name || '',
    confidence: Number(item?.confidence ?? 0) || 0,
    confidence_label: item?.confidence_label || '',
    match_status: item?.match_status || 'review',
    matched_rule_label: item?.matched_rule?.altar_size_label || '',
    matched_rule_context: item?.matched_rule?.context_label || '',
    matched_rule_alias: item?.matched_rule?.alias || '',
    bonus: Boolean(item?.bonus),
    match_reasons: Array.isArray(item?.match_reasons) ? item.match_reasons : [],
    inserted_at: new Date().toISOString(),
});

const OrderAiLineReplacePanel = ({
    show,
    currentLine = null,
    anchorElement = null,
    searchTerm,
    onSearchTermChange,
    onClose,
    results = [],
    loading = false,
    onSelect,
    currencyFormatter,
    heading = '',
    currentLabel = '',
    searchPlaceholder = '',
    emptyMessage = '',
}) => {
    const isAiLine = isOrderAiItem(currentLine);
    const currentSourceLabel = currentLabel || currentLine?.ai_meta?.source_phrase || currentLine?.name || '';
    const currentVariantLabel = currentLine?.options?.variant_label || '';
    const currentSku = currentLine?.sku || '';
    const panelHeading = heading || (isAiLine ? 'Đổi sản phẩm AI' : 'Đổi sản phẩm');
    const hasSearchTerm = searchTerm.trim().length >= 2;
    const emptyStateMessage = emptyMessage || (hasSearchTerm
        ? 'Không thấy sản phẩm phù hợp, thử đổi từ khóa tìm kiếm.'
        : 'Gõ ít nhất 2 ký tự để tìm sản phẩm thay thế.');
    const [panelPosition, setPanelPosition] = useState({
        left: 16,
        top: 88,
        width: 460,
        maxHeight: 560,
    });

    useLayoutEffect(() => {
        if (!show || typeof window === 'undefined') return undefined;

        const updatePosition = () => {
            const viewportWidth = window.innerWidth || 1280;
            const viewportHeight = window.innerHeight || 720;
            const panelWidth = Math.min(460, Math.max(340, viewportWidth - 24));
            const anchorRect = anchorElement?.getBoundingClientRect?.() || null;
            const preferredLeft = anchorRect ? anchorRect.right + 12 : viewportWidth - panelWidth - 16;
            const left = Math.max(12, Math.min(preferredLeft, viewportWidth - panelWidth - 12));
            const preferredTop = anchorRect ? anchorRect.top - 18 : 88;
            const top = Math.max(76, Math.min(preferredTop, viewportHeight - 320));
            const maxHeight = Math.max(300, viewportHeight - top - 20);

            setPanelPosition({
                left,
                top,
                width: panelWidth,
                maxHeight,
            });
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [anchorElement, show]);

    if (!show) return null;

    const panelContent = (
        <>
            <div className="fixed inset-0 z-[2500] bg-slate-950/10" onClick={onClose} />
            <div
                className="fixed z-[2510] flex flex-col overflow-hidden rounded-sm border border-primary/15 bg-white shadow-[0_22px_48px_rgba(15,23,42,0.18)]"
                style={{
                    left: `${panelPosition.left}px`,
                    top: `${panelPosition.top}px`,
                    width: `${panelPosition.width}px`,
                    maxHeight: `${panelPosition.maxHeight}px`,
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="border-b border-primary/10 bg-primary/[0.03] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">
                                {panelHeading}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex size-9 items-center justify-center rounded-sm border border-primary/10 text-primary/35 transition-all hover:border-primary/20 hover:text-brick"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                    <div className="mt-2 flex h-10 items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-semibold text-primary/65">
                        <span className="material-symbols-outlined shrink-0 text-[16px] text-sky-700/75">quick_reference</span>
                        <span className="truncate text-[12px] font-bold text-primary">
                            {currentSourceLabel || 'Chọn sản phẩm thay thế'}
                        </span>
                        {currentSku && (
                            <span className="shrink-0 rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5 text-[10px] font-black text-primary/55">
                                {currentSku}
                            </span>
                        )}
                        {currentVariantLabel && (
                            <span className="max-w-[150px] truncate rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5 text-[10px] font-black text-primary/55">
                                {currentVariantLabel}
                            </span>
                        )}
                    </div>
                </div>

                <div className="border-b border-primary/10 px-4 py-3">
                    <div className="flex h-11 items-center gap-2 rounded-sm border border-primary/10 bg-primary/[0.03] px-3">
                        <span className="material-symbols-outlined text-[18px] text-primary/35">search</span>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => onSearchTermChange(event.target.value)}
                            placeholder={searchPlaceholder || 'Tìm sản phẩm để đổi nhanh...'}
                            className="h-full w-full bg-transparent text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:outline-none"
                            autoFocus
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                    {loading ? (
                        <div className="px-4 py-8 text-center text-[12px] font-semibold text-primary/45">
                            Đang tìm sản phẩm...
                        </div>
                    ) : results.length > 0 ? (
                        results.map((entry, index) => (
                            <button
                                key={`${entry?.target_product_id || entry?.sku || 'order-ai-replace'}-${index}`}
                                type="button"
                                onClick={() => onSelect(entry)}
                                className="flex w-full items-start justify-between gap-3 border-b border-primary/5 px-4 py-3 text-left transition-all hover:bg-primary/[0.03] last:border-b-0"
                            >
                                <div className="min-w-0">
                                    <div className="text-[13px] font-bold leading-snug text-primary">
                                        {entry?.display_name || entry?.name || 'Sản phẩm'}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-primary/45">
                                        {entry?.display_sku && (
                                            <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">
                                                {entry.display_sku}
                                            </span>
                                        )}
                                        {entry?.option_label && (
                                            <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5">
                                                {entry.option_label}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="shrink-0 text-right text-[12px] font-black text-primary/65">
                                    {currencyFormatter?.format(Number(entry?.price ?? 0) || 0)}đ
                                </div>
                            </button>
                        ))
                    ) : (
                        <div className="px-4 py-4">
                            <div className="flex min-h-10 items-center rounded-sm border border-dashed border-primary/10 bg-primary/[0.02] px-3 text-[12px] font-semibold text-primary/40">
                                <span className="truncate">{emptyStateMessage}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    return typeof document !== 'undefined'
        ? createPortal(panelContent, document.body)
        : panelContent;
};

const OrderForm = () => {
    const { id } = useParams();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const duplicateFromId = queryParams.get('duplicate_from');
    const leadId = queryParams.get('lead_id');
    const returnTo = queryParams.get('return_to');
    const requestedOrderKind = getNormalizedOrderKind(queryParams.get('kind'));
    const isEdit = !!id;
    const navigate = useNavigate();
    const { user } = useAuth();
    const { showModal } = useUI();
    const canCreateOrders = hasAdminPermission(user, 'orders.create');
    const canUpdateOrders = hasAdminPermission(user, 'orders.update');
    const productQuickFilterStorageKey = getProductQuickFilterStorageKey(user);
    const initialProductQuickFilterState = getStoredProductQuickFilterState(user);

    useEffect(() => {
        if ((isEdit && !canUpdateOrders) || (!isEdit && !canCreateOrders)) {
            navigate('/admin/orders', { replace: true });
        }
    }, [canCreateOrders, canUpdateOrders, isEdit, navigate]);

    const [loading, setLoading] = useState(isEdit || !!duplicateFromId);
    const [saving, setSaving] = useState(false);
    const [orderKind, setOrderKind] = useState(() => (
        !isEdit && requestedOrderKind === DRAFT_ORDER_KIND ? DRAFT_ORDER_KIND : MAIN_ORDER_KIND
    ));
    const orderKindMeta = getOrderKindMeta(orderKind);
    const [products, setProducts] = useState([]);
    const [attributes, setAttributes] = useState([]);
    const [orderStatuses, setOrderStatuses] = useState([]);

    const [searchTerm, setSearchTerm] = useState(() => initialProductQuickFilterState.searchTerm);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [searchHistory, setSearchHistory] = useState(() => getStoredProductSearchHistory());
    const [orderAiRules, setOrderAiRules] = useState([]);
    const [orderAiTrainingRules, setOrderAiTrainingRules] = useState([]);
    const [orderAiTrainingRulesLoading, setOrderAiTrainingRulesLoading] = useState(false);
    const [showOrderAiPanel, setShowOrderAiPanel] = useState(false);
    const [showOrderAiRulesModal, setShowOrderAiRulesModal] = useState(false);
    const [orderAiSelectedRuleKey, setOrderAiSelectedRuleKey] = useState('');
    const [orderAiInput, setOrderAiInput] = useState('');
    const [orderAiFile, setOrderAiFile] = useState(null);
    const [orderAiFilePreviewUrl, setOrderAiFilePreviewUrl] = useState('');
    const [orderAiPreview, setOrderAiPreview] = useState(null);
    const [orderAiLastRun, setOrderAiLastRun] = useState(null);
    const [showOrderAiInputReviewModal, setShowOrderAiInputReviewModal] = useState(false);
    const [orderAiLoading, setOrderAiLoading] = useState(false);
    const [orderAiApplying, setOrderAiApplying] = useState(false);
    const [orderAiSavingRules, setOrderAiSavingRules] = useState(false);
    const [orderAiManualPickerLineId, setOrderAiManualPickerLineId] = useState('');
    const [orderAiManualSearchTerm, setOrderAiManualSearchTerm] = useState('');
    const [orderAiManualSearchResults, setOrderAiManualSearchResults] = useState([]);
    const [orderAiManualSearchLoading, setOrderAiManualSearchLoading] = useState(false);
    const [orderAiReplaceLineId, setOrderAiReplaceLineId] = useState('');
    const [orderAiReplaceSearchTerm, setOrderAiReplaceSearchTerm] = useState('');
    const [orderAiReplaceResults, setOrderAiReplaceResults] = useState([]);
    const [orderAiReplaceLoading, setOrderAiReplaceLoading] = useState(false);
    const [actualProductPickerLineId, setActualProductPickerLineId] = useState('');
    const [actualProductPickerSearchTerm, setActualProductPickerSearchTerm] = useState('');
    const [actualProductPickerResults, setActualProductPickerResults] = useState([]);
    const [actualProductPickerLoading, setActualProductPickerLoading] = useState(false);
    const [selectedOrderLineId, setSelectedOrderLineId] = useState('');
    const [showActualProductSection, setShowActualProductSection] = useState(false);
    const [productQuickFilterAttributes, setProductQuickFilterAttributes] = useState([]);
    const [productQuickFilterAttributeId, setProductQuickFilterAttributeId] = useState(() => initialProductQuickFilterState.attributeId);
    const [productQuickFilterValues, setProductQuickFilterValues] = useState(() => initialProductQuickFilterState.values);
    const [productQuickFilterAttributeId2, setProductQuickFilterAttributeId2] = useState(() => initialProductQuickFilterState.attributeId2);
    const [productQuickFilterValues2, setProductQuickFilterValues2] = useState(() => initialProductQuickFilterState.values2);
    const [productQuickSetupStore, setProductQuickSetupStore] = useState(() => getStoredProductQuickSetupStore());
    const [productQuickModeEnabled, setProductQuickModeEnabled] = useState(() => initialProductQuickFilterState.quickModeEnabled);
    const [showProductQuickSetupPanel, setShowProductQuickSetupPanel] = useState(false);
    const [productQuickSetupSearchTerm, setProductQuickSetupSearchTerm] = useState('');
    const [debouncedProductQuickSetupSearchTerm, setDebouncedProductQuickSetupSearchTerm] = useState('');
    const [productQuickSetupProducts, setProductQuickSetupProducts] = useState([]);
    const [productQuickFilterScopeProducts, setProductQuickFilterScopeProducts] = useState([]);
    const [productQuickFilterScopeKey, setProductQuickFilterScopeKey] = useState('');
    const [showProductQuickFilterPanel, setShowProductQuickFilterPanel] = useState(false);
    const [selectedLineItemIds, setSelectedLineItemIds] = useState(new Set());
    const [showBulkReplaceModal, setShowBulkReplaceModal] = useState(false);
    const [showColumnConfig, setShowColumnConfig] = useState(false);
    const [orderFormTableViewportWidth, setOrderFormTableViewportWidth] = useState(0);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isRefreshingItems, setIsRefreshingItems] = useState(false);
    const [isCompactOrderMobileLayout, setIsCompactOrderMobileLayout] = useState(() => {
        if (typeof window === 'undefined') return false;

        return window.matchMedia('(max-width: 1023px)').matches;
    });
    const [quoteSettings, setQuoteSettings] = useState(defaultQuoteSettings);
    const [quoteTemplates, setQuoteTemplates] = useState([]);
    const [showSupplementItemsModal, setShowSupplementItemsModal] = useState(false);
    const [showQuoteTemplatePicker, setShowQuoteTemplatePicker] = useState(false);
    const [quoteTemplateSearch, setQuoteTemplateSearch] = useState('');
    const [quoteCaptureTemplate, setQuoteCaptureTemplate] = useState(null);
    const [leadConversionSummary, setLeadConversionSummary] = useState(null);
    const [notification, setNotification] = useState(null);
    const [copiedText, setCopiedText] = useState(null);
    const [activeTruncatedNameCellKey, setActiveTruncatedNameCellKey] = useState('');
    const captureRef = useRef(null);
    const quoteCaptureRef = useRef(null);
    const orderFormTableViewportRef = useRef(null);
    const lastAutoOpenedSupplementOrderTypeRef = useRef('');
    const lastVisitedProductQuickSetupKeyRef = useRef('');
    const copyFeedbackTimeoutRef = useRef(null);
    const copyNotificationTimeoutRef = useRef(null);
    const productSearchContainerRef = useRef(null);
    const productSearchInputRef = useRef(null);
    const mobileProductSearchToggleButtonRef = useRef(null);
    const mobileProductSearchHistoryStateActiveRef = useRef(false);
    const ignoreNextMobileProductSearchPopRef = useRef(false);
    const previousShowSearchDropdownRef = useRef(false);
    const productSearchAbortRef = useRef(null);
    const productSearchCacheRef = useRef(new Map());
    const productQuickFilterStorageKeyRef = useRef(productQuickFilterStorageKey);
    const skipNextProductQuickFilterPersistRef = useRef(false);
    const productQuickFilterScopeAbortRef = useRef(null);
    const productQuickFilterScopeCacheRef = useRef(new Map());
    const productQuickSetupAbortRef = useRef(null);
    const productQuickSetupCacheRef = useRef(new Map());
    const productQuickSetupListRef = useRef(null);
    const productQuickSetupSearchInputRef = useRef(null);
    const pendingProductQuickSetupViewportRef = useRef(null);
    const orderAiFileInputRef = useRef(null);
    const orderAiLastInputPreviewUrlRef = useRef('');
    const orderAiReplaceAnchorRef = useRef(null);
    const actualProductPickerAnchorRef = useRef(null);
    const actualProductSectionRef = useRef(null);
    const orderItemNameRefs = useRef(new Map());
    const orderAiQuickRuleOptions = useMemo(
        () => buildOrderAiQuickRuleOptions(orderAiTrainingRules.length > 0 ? orderAiTrainingRules : orderAiRules),
        [orderAiRules, orderAiTrainingRules]
    );
    const selectedOrderAiQuickRule = useMemo(
        () => orderAiQuickRuleOptions.find((option) => option.value === orderAiSelectedRuleKey) || null,
        [orderAiQuickRuleOptions, orderAiSelectedRuleKey]
    );

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const handleChange = (event) => {
            setIsCompactOrderMobileLayout(event.matches);
        };

        setIsCompactOrderMobileLayout(mediaQuery.matches);

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        }

        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
    }, []);
    const activeProductQuickFilterAttribute = useMemo(
        () => productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(productQuickFilterAttributeId)) || null,
        [productQuickFilterAttributeId, productQuickFilterAttributes]
    );
    const normalizedProductQuickFilterValues = useMemo(
        () => Array.from(new Set(productQuickFilterValues.map(normalizeQuickFilterOptionValue).filter(Boolean))).slice(0, 1),
        [productQuickFilterValues]
    );

    const activeProductQuickFilterAttribute2 = useMemo(
        () => productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(productQuickFilterAttributeId2)) || null,
        [productQuickFilterAttributeId2, productQuickFilterAttributes]
    );
    const normalizedProductQuickFilterValues2 = useMemo(
        () => Array.from(new Set(productQuickFilterValues2.map(normalizeQuickFilterOptionValue).filter(Boolean))).slice(0, 1),
        [productQuickFilterValues2]
    );

    const activeProductQuickFilterSummary = useMemo(() => {
        if (!activeProductQuickFilterAttribute || normalizedProductQuickFilterValues.length === 0) return '';

        let summary = `${activeProductQuickFilterAttribute.name}: ${getQuickFilterOptionLabel(activeProductQuickFilterAttribute, normalizedProductQuickFilterValues[0])}`;
        if (activeProductQuickFilterAttribute2 && normalizedProductQuickFilterValues2.length > 0) {
            summary += ` | ${activeProductQuickFilterAttribute2.name}: ${getQuickFilterOptionLabel(activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2[0])}`;
        }
        return summary;
    }, [activeProductQuickFilterAttribute, normalizedProductQuickFilterValues, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2]);

    const hasActiveProductQuickFilter = normalizedProductQuickFilterValues.length > 0;
    const activeProductQuickFilterScopeKey = useMemo(() => (
        activeProductQuickFilterAttribute && normalizedProductQuickFilterValues[0]
            ? buildProductQuickSetupKey(activeProductQuickFilterAttribute.id, normalizedProductQuickFilterValues[0])
            : ''
    ), [activeProductQuickFilterAttribute, normalizedProductQuickFilterValues]);
    const isProductQuickFilterScopeReady = Boolean(activeProductQuickFilterScopeKey)
        && productQuickFilterScopeKey === activeProductQuickFilterScopeKey;
    const activeProductQuickFilterAttribute2Options = useMemo(() => {
        if (!activeProductQuickFilterAttribute2) return [];
        if (!activeProductQuickFilterScopeKey) {
            return activeProductQuickFilterAttribute2.options || [];
        }
        if (!isProductQuickFilterScopeReady) return [];

        return buildDependentProductQuickFilterOptions(
            productQuickFilterScopeProducts,
            activeProductQuickFilterAttribute,
            normalizedProductQuickFilterValues[0],
            activeProductQuickFilterAttribute2
        );
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        activeProductQuickFilterScopeKey,
        isProductQuickFilterScopeReady,
        normalizedProductQuickFilterValues,
        productQuickFilterScopeProducts,
    ]);
    const activeProductQuickFilterCount = normalizedProductQuickFilterValues.length + normalizedProductQuickFilterValues2.length;
    const activeProductBundleQuickFilterCriteria = useMemo(() => ([
        buildProductQuickFilterCriterion(activeProductQuickFilterAttribute, normalizedProductQuickFilterValues[0]),
        buildProductQuickFilterCriterion(activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2[0]),
    ].filter(Boolean)), [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
    ]);
    const hasActiveProductBundleQuickFilter = activeProductBundleQuickFilterCriteria.length > 0;
    const activeProductQuickSetupKey = useMemo(() => {
        if (!hasActiveProductQuickFilter) return '';

        let key = buildProductQuickSetupKey(activeProductQuickFilterAttribute?.id, normalizedProductQuickFilterValues[0]);
        if (activeProductQuickFilterAttribute2 && normalizedProductQuickFilterValues2.length > 0) {
            key += `|${buildProductQuickSetupKey(activeProductQuickFilterAttribute2?.id, normalizedProductQuickFilterValues2[0])}`;
        }
        return key;
    }, [activeProductQuickFilterAttribute, hasActiveProductQuickFilter, normalizedProductQuickFilterValues, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2]);
    const activeProductQuickSetupItems = useMemo(() => {
        if (!activeProductQuickSetupKey) return [];

        const namespace = resolveProductQuickSetupNamespace();
        return normalizeStoredProductQuickSetupItems(
            productQuickSetupStore?.[namespace]?.[activeProductQuickSetupKey] || []
        );
    }, [activeProductQuickSetupKey, productQuickSetupStore]);
    const isProductQuickModeToggleDisabled = activeProductQuickSetupItems.length === 0 || hasActiveProductBundleQuickFilter;
    const isProductQuickModeActive = productQuickModeEnabled && activeProductQuickSetupItems.length > 0 && !hasActiveProductBundleQuickFilter;
    const shouldShowProductQuickFilterPanel = showSearchDropdown && showProductQuickFilterPanel && productQuickFilterAttributes.length > 0;
    const syncLatestProductsIntoLocalSources = useCallback((latestMap) => {
        if (!(latestMap instanceof Map) || latestMap.size === 0) return;

        const syncCacheRef = (cacheRef) => {
            cacheRef.current.forEach((entries, key) => {
                const nextEntries = (Array.isArray(entries) ? entries : []).map((product) => {
                    const latest = latestMap.get(Number(product?.id ?? product?.product_id));
                    return latest ? normalizeProductPickerEntry({ ...product, ...latest }) : normalizeProductPickerEntry(product);
                });

                cacheRef.current.set(key, nextEntries);
            });
        };

        syncCacheRef(productSearchCacheRef);
        syncCacheRef(productQuickFilterScopeCacheRef);
        syncCacheRef(productQuickSetupCacheRef);

        setProductQuickFilterScopeProducts((prev) => (
            (Array.isArray(prev) ? prev : []).map((product) => {
                const latest = latestMap.get(Number(product?.id ?? product?.product_id));
                return latest ? normalizeProductPickerEntry({ ...product, ...latest }) : normalizeProductPickerEntry(product);
            })
        ));

        setProductQuickSetupStore((prev) => {
            let hasChanged = false;
            const nextStore = Object.fromEntries(
                Object.entries(prev || {}).map(([namespace, groupMap]) => [
                    namespace,
                    Object.fromEntries(
                        Object.entries(groupMap || {}).map(([groupKey, items]) => [
                            groupKey,
                            (Array.isArray(items) ? items : []).map((item) => {
                                const latest = latestMap.get(Number(item?.product_id ?? item?.id));
                                if (!latest) return item;

                                hasChanged = true;

                                return {
                                    ...item,
                                    sku: latest.sku ?? item?.sku ?? '',
                                    display_sku: item?.display_sku ?? latest.sku ?? item?.sku ?? '',
                                    name: latest.name ?? item?.name ?? '',
                                    display_name: latest.display_name ?? latest.name ?? item?.display_name ?? item?.name ?? '',
                                    price: resolveMoneyValue(latest.price, item?.price, 0),
                                    expected_cost: parseMoneyNumber(latest.expected_cost, parseMoneyNumber(item?.expected_cost)),
                                    cost_price: resolveProductCostPrice({ ...item, ...latest }),
                                    unit_name: resolveOrderUnitLabel(latest, item),
                                    ...resolveInventorySnapshot(latest, item),
                                    main_image: String(latest.main_image ?? item?.main_image ?? '').trim(),
                                    type: latest.type ?? item?.type ?? '',
                                };
                            }),
                        ])
                    ),
                ])
            );

            return hasChanged ? nextStore : prev;
        });
    }, []);
    const applyLatestProductsToOrderState = useCallback((refreshedItems = []) => {
        const refreshedMap = new Map(
            (Array.isArray(refreshedItems) ? refreshedItems : []).map((item) => [Number(item.product_id), item])
        );

        if (refreshedMap.size === 0) {
            return refreshedMap;
        }

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => {
                const latest = refreshedMap.get(Number(item.product_id));
                if (!latest) return item;
                const mergedOptions = mergeOrderLineOptions(
                    item.options,
                    extractOrderItemOptionsFromProductPayload(latest)
                );

                return {
                    ...item,
                    name: resolveLatestOrderItemName({ ...item, options: mergedOptions }, latest),
                    sku: normalizeCanvasText(latest.display_sku || latest.sku) || item.sku,
                    unit_name: resolveOrderUnitLabel(latest, item),
                    price: Number(latest.price ?? item.price ?? 0) || 0,
                    cost_price: resolveProductCostPrice(latest, item.cost_price),
                    options: mergedOptions,
                    ...resolveInventorySnapshot(latest, item),
                };
            });

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        setProducts((prev) => prev.map((product) => {
            const latest = refreshedMap.get(Number(product.id));
            if (!latest) return normalizeProductPickerEntry(product);

            return normalizeProductPickerEntry({
                ...product,
                ...latest,
                sku: latest.sku ?? product.sku,
                name: latest.name ?? product.name,
                price: Number(latest.price ?? product.price ?? 0),
                expected_cost: parseMoneyNumber(latest.expected_cost, parseMoneyNumber(product.expected_cost)),
                cost_price: resolveProductCostPrice(latest, product.cost_price),
                status: latest.status ?? product.status,
            });
        }));

        syncLatestProductsIntoLocalSources(refreshedMap);

        return refreshedMap;
    }, [syncLatestProductsIntoLocalSources]);
    const applyInventorySnapshotToOrderState = useCallback((refreshedItems = []) => {
        const refreshedMap = new Map(
            (Array.isArray(refreshedItems) ? refreshedItems : []).map((item) => [Number(item.product_id), item])
        );

        if (refreshedMap.size === 0) {
            return refreshedMap;
        }

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => {
                const latest = refreshedMap.get(getOrderItemEffectiveInventoryProductId(item));
                if (!latest) return item;
                const currentCostPrice = resolveRoundedImportCostValue(item.cost_price, 0);
                const shouldHydrateCostPrice = currentCostPrice <= 0 && hasProductCostSnapshot(latest);
                const nextCostPrice = shouldHydrateCostPrice
                    ? resolveProductCostPrice(latest, currentCostPrice)
                    : item.cost_price;

                return {
                    ...item,
                    unit_name: resolveOrderUnitLabel(latest, item),
                    cost_price: nextCostPrice,
                    base_cost_price: shouldHydrateCostPrice
                        ? resolveRoundedImportCostValue(latest.cost_price ?? latest.expected_cost, nextCostPrice)
                        : item.base_cost_price,
                    ...resolveInventorySnapshot(latest, item),
                };
            });

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        setProducts((prev) => prev.map((product) => {
            const latest = refreshedMap.get(Number(product.id));
            if (!latest) return normalizeProductPickerEntry(product);

            return normalizeProductPickerEntry({ ...product, ...latest });
        }));

        syncLatestProductsIntoLocalSources(refreshedMap);

        return refreshedMap;
    }, [syncLatestProductsIntoLocalSources]);
    const refreshOrderItemInventorySnapshot = useCallback(async (itemsToRefresh = []) => {
        const normalizedItems = Array.from(new Map(
            (Array.isArray(itemsToRefresh) ? itemsToRefresh : [])
                .map((item) => {
                    const productId = getOrderItemEffectiveInventoryProductId(item);
                    if (!productId) return null;

                    return [productId, {
                        product_id: productId,
                        sku: getOrderItemEffectiveInventorySku(item),
                        name: getOrderItemEffectiveInventoryName(item),
                    }];
                })
                .filter(Boolean)
        ).values());

        if (normalizedItems.length === 0) {
            return;
        }

        try {
            const response = await productApi.refreshOrderItems({ items: normalizedItems });
            applyInventorySnapshotToOrderState(response.data?.items);
        } catch (error) {
            console.error('Error refreshing order item inventory snapshot', error);
        }
    }, [applyInventorySnapshotToOrderState]);

    const navigateBack = useCallback(() => {
        if (returnTo && returnTo.startsWith('/admin/')) {
            navigate(returnTo);
            return;
        }

        if (leadId) {
            navigate('/admin/leads');
            return;
        }

        navigate(buildOrderListUrl(orderKind));
    }, [leadId, navigate, orderKind, returnTo]);

    const COLUMN_DEFS = {
        selection: { label: '', align: 'center' },
        stt: { label: 'STT', align: 'center' },
        sku: { label: 'Mã sản phẩm', align: 'left' },
        name: { label: 'Tên sản phẩm', align: 'left' },
        quantity: { label: 'SL', align: 'center' },
        unit: { label: 'ĐVT', align: 'center' },
        available_to_sell: { label: 'Có thể bán', align: 'center', tooltip: ORDER_FORM_AVAILABLE_TO_SELL_TOOLTIP },
        price: { label: 'Đơn giá', align: 'center' },
        cost_price: { label: 'Giá nhập', align: 'center' },
        total: { label: 'Thành tiền', align: 'right' },
        actions: { label: 'Xoá', align: 'center' }
    };

    const [columnOrder, setColumnOrder] = useState(() => getStoredOrderFormColumnOrder());
    const [visibleColumns, setVisibleColumns] = useState(() => getStoredOrderFormVisibleColumns());
    const [columnWidths, setColumnWidths] = useState(() => getStoredOrderFormColumnWidths());
    const [columnWidthMode, setColumnWidthMode] = useState(() => getStoredOrderFormColumnWidthMode());
    useEffect(() => {
        const normalizedColumnOrder = normalizeStoredOrderFormColumnOrder(columnOrder);
        const hasChanged = normalizedColumnOrder.length !== columnOrder.length
            || normalizedColumnOrder.some((columnId, index) => columnId !== columnOrder[index]);

        if (!hasChanged) {
            return;
        }

        setColumnOrder(normalizedColumnOrder);
        writeOrderFormStorageJson(orderFormColumnOrderStorageKey, normalizedColumnOrder);
    }, [columnOrder]);
    useEffect(() => {
        const normalizedVisibleColumns = normalizeStoredOrderFormVisibleColumns(visibleColumns);
        const hasChanged = normalizedVisibleColumns.length !== visibleColumns.length
            || normalizedVisibleColumns.some((columnId, index) => columnId !== visibleColumns[index]);

        if (!hasChanged) {
            return;
        }

        setVisibleColumns(normalizedVisibleColumns);
        writeOrderFormStorageJson(orderFormVisibleColumnsStorageKey, normalizedVisibleColumns);
    }, [visibleColumns]);
    const desktopVisibleColumnIds = useMemo(
        () => columnOrder.filter((id) => visibleColumns.includes(id)),
        [columnOrder, visibleColumns]
    );
    const desktopTableDensityKey = useMemo(
        () => resolveOrderFormTableDensityKey({
            containerWidth: orderFormTableViewportWidth,
            visibleColumnIds: desktopVisibleColumnIds,
        }),
        [desktopVisibleColumnIds, orderFormTableViewportWidth]
    );
    const desktopTableMetrics = useMemo(
        () => getOrderFormDensityMetrics(desktopTableDensityKey),
        [desktopTableDensityKey]
    );
    const desktopTableDensity = useMemo(
        () => getOrderFormDensityPreset(desktopTableDensityKey),
        [desktopTableDensityKey]
    );
    const desktopAutoColumnWidths = useMemo(
        () => (
            columnWidthMode === ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL
                ? Object.fromEntries(
                    desktopVisibleColumnIds.map((columnId) => [
                        columnId,
                        getOrderFormPreferredColumnWidth(columnId, columnWidths, desktopTableMetrics),
                    ])
                )
                : fitOrderFormColumnsToViewport({
                    containerWidth: orderFormTableViewportWidth,
                    visibleColumnIds: desktopVisibleColumnIds,
                    preferredWidths: columnWidths,
                    columnMetrics: desktopTableMetrics,
                })
        ),
        [columnWidthMode, columnWidths, desktopTableMetrics, desktopVisibleColumnIds, orderFormTableViewportWidth]
    );
    const isUsingManualColumnWidths = columnWidthMode === ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL;
    const desktopTableWidth = useMemo(
        () => desktopVisibleColumnIds.reduce(
            (total, columnId) => total + (
                desktopAutoColumnWidths[columnId] || getOrderFormPreferredColumnWidth(columnId, columnWidths, desktopTableMetrics)
            ),
            ORDER_FORM_TABLE_DRAG_COLUMN_WIDTH
        ),
        [columnWidths, desktopAutoColumnWidths, desktopTableMetrics, desktopVisibleColumnIds]
    );
    const desktopTablePixelWidth = useMemo(
        () => (
            isUsingManualColumnWidths
                ? desktopTableWidth
                : Math.max(orderFormTableViewportWidth || 0, desktopTableWidth)
        ),
        [desktopTableWidth, isUsingManualColumnWidths, orderFormTableViewportWidth]
    );
    const captureDisplayedOrderFormColumnWidths = useCallback(() => {
        const nextWidths = { ...normalizeStoredOrderFormColumnWidths(columnWidths) };

        ORDER_FORM_DEFAULT_COLUMN_IDS.forEach((columnId) => {
            const renderedWidth = desktopAutoColumnWidths[columnId];
            if (Number.isFinite(renderedWidth) && renderedWidth > 0) {
                nextWidths[columnId] = Math.round(renderedWidth);
            }
        });

        return normalizeStoredOrderFormColumnWidths(nextWidths);
    }, [columnWidths, desktopAutoColumnWidths]);
    const desktopTableStyleVars = useMemo(() => ({
        '--order-form-header-font-size': `${desktopTableDensity.headerFontSize}px`,
        '--order-form-header-letter-spacing': desktopTableDensity.headerLetterSpacing,
        '--order-form-body-font-size': `${desktopTableDensity.bodyFontSize}px`,
        '--order-form-body-meta-font-size': `${desktopTableDensity.bodyMetaFontSize}px`,
        '--order-form-body-meta-margin-top': `${desktopTableDensity.bodyMetaMarginTop}px`,
        '--order-form-cell-padding-x': `${desktopTableDensity.bodyPaddingX}px`,
        '--order-form-cell-padding-y': `${desktopTableDensity.bodyPaddingY}px`,
        '--order-form-quantity-input-width': `${desktopTableDensity.quantityInputWidth}px`,
        '--order-form-quantity-input-height': `${desktopTableDensity.quantityInputHeight}px`,
        '--order-form-action-button-size': `${desktopTableDensity.actionButtonSize}px`,
        '--order-form-action-icon-size': `${desktopTableDensity.actionIconSize}px`,
        '--order-form-row-icon-size': `${desktopTableDensity.rowIconSize}px`,
        '--order-form-copy-icon-size': `${desktopTableDensity.copyIconSize}px`,
        '--order-form-badge-font-size': `${desktopTableDensity.badgeFontSize}px`,
        '--order-form-badge-padding-x': `${desktopTableDensity.badgePaddingX}px`,
        '--order-form-badge-padding-y': `${desktopTableDensity.badgePaddingY}px`,
    }), [desktopTableDensity]);

    const [formData, setFormData] = useState({
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        address_detail: '',
        shipping_address: '',
        district: '',
        ward: '',
        source: DEFAULT_MANUAL_ORDER_SOURCE,
        order_type: ORDER_TYPE_STANDARD,
        settlement_delta: 0,
        return_tracking_code: '',
        return_status: SUPPLEMENT_RETURN_STATUS_NOT_RETURNED,
        type: 'Lẻ',
        shipment_status: 'Chưa giao',
        notes: '',
        items: [],
        supplement_items: [],
        custom_attributes: {},
        shipping_fee: 0,
        display_shipping_fee: 0,
        shipping_tracking_code: '',
        active_shipment: null,
        manual_discount: 0,
        discount: 0,
        cost_total: 0,
        status: 'new',
        province: ''
    });
    const [discountInputValue, setDiscountInputValue] = useState(() => formatSignedMoneyInputValue(0));
    const discountInputRef = useRef(null);
    const activeOrderAiReplaceLine = useMemo(
        () => formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(orderAiReplaceLineId)) || null,
        [formData.items, orderAiReplaceLineId]
    );
    const activeActualProductPickerLine = useMemo(
        () => formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(actualProductPickerLineId)) || null,
        [actualProductPickerLineId, formData.items]
    );
    const selectedOrderLine = useMemo(
        () => formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(selectedOrderLineId)) || null,
        [formData.items, selectedOrderLineId]
    );
    const actualProductSectionLine = useMemo(
        () => selectedOrderLine || formData.items[0] || null,
        [formData.items, selectedOrderLine]
    );
    const isActualProductPickerOpenForSectionLine = Boolean(actualProductSectionLine)
        && normalizeCanvasText(actualProductPickerLineId) === normalizeCanvasText(actualProductSectionLine?.line_id);
    useEffect(() => {
        if (!selectedOrderLineId) return;
        if (selectedOrderLine) return;

        setSelectedOrderLineId('');
    }, [selectedOrderLine, selectedOrderLineId]);
    const automaticDiscountAdjustment = useMemo(
        () => calculateAutomaticDiscountAdjustment(formData.order_type, formData.supplement_items),
        [formData.order_type, formData.supplement_items]
    );
    useEffect(() => {
        const nextDiscount = calculateEffectiveDiscountValue(
            formData.manual_discount,
            formData.order_type,
            formData.supplement_items
        );

        setFormData((prev) => (
            prev.discount === nextDiscount
                ? prev
                : { ...prev, discount: nextDiscount }
        ));
    }, [automaticDiscountAdjustment, formData.manual_discount, formData.order_type, formData.supplement_items]);
    useEffect(() => {
        setDiscountInputValue(formatSignedMoneyInputValue(formData.discount));
    }, [formData.discount]);
    const selectedQuickSetupEntryKeys = useMemo(
        () => new Set(activeProductQuickSetupItems.map(getProductQuickSetupEntryKey).filter(Boolean)),
        [activeProductQuickSetupItems]
    );
    const visibleProductQuickSetupProducts = useMemo(() => {
        let filtered = productQuickSetupProducts;

        if (activeProductQuickFilterAttribute2 && normalizedProductQuickFilterValues2[0]) {
            const attrValue2 = String(normalizedProductQuickFilterValues2[0]);
            const selectedValue = normalizeProductSearchText(attrValue2);
            const selectedLabel = normalizeProductSearchText(
                getQuickFilterOptionLabel(activeProductQuickFilterAttribute2, attrValue2)
            );

            filtered = productQuickSetupProducts.filter((product) => {
                const values = getProductQuickFilterDisplayValues(product, activeProductQuickFilterAttribute2);

                // Match if value is exact OR if value is missing (shared item).
                return values.length === 0 || values.some((value) => {
                    const comparableValue = normalizeProductSearchText(value);
                    return comparableValue === selectedValue || comparableValue === selectedLabel;
                });
            });
        }

        return mergeProductQuickSetupEntries(filtered, activeProductQuickSetupItems);
    }, [activeProductQuickSetupItems, productQuickSetupProducts, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2]);
    const syncOrderFormTableViewportWidth = useCallback(() => {
        const viewportNode = orderFormTableViewportRef.current;
        if (!viewportNode) return;

        const nextWidth = Math.round(viewportNode.getBoundingClientRect().width || viewportNode.clientWidth || 0);
        setOrderFormTableViewportWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    }, []);

    useLayoutEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const viewportNode = orderFormTableViewportRef.current;
        if (!viewportNode) {
            return undefined;
        }

        syncOrderFormTableViewportWidth();

        const rafId = window.requestAnimationFrame(syncOrderFormTableViewportWidth);
        const timeoutId = window.setTimeout(syncOrderFormTableViewportWidth, 160);

        let resizeObserver;
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                syncOrderFormTableViewportWidth();
            });
            resizeObserver.observe(viewportNode);
            if (viewportNode.parentElement) {
                resizeObserver.observe(viewportNode.parentElement);
            }
        }

        window.addEventListener('resize', syncOrderFormTableViewportWidth);

        return () => {
            window.cancelAnimationFrame(rafId);
            window.clearTimeout(timeoutId);
            window.removeEventListener('resize', syncOrderFormTableViewportWidth);
            resizeObserver?.disconnect();
        };
    }, [syncOrderFormTableViewportWidth]);

    useLayoutEffect(() => {
        if (typeof window === 'undefined' || isCompactOrderMobileLayout) {
            return undefined;
        }

        const rafId = window.requestAnimationFrame(syncOrderFormTableViewportWidth);
        const timeoutId = window.setTimeout(syncOrderFormTableViewportWidth, 180);

        return () => {
            window.cancelAnimationFrame(rafId);
            window.clearTimeout(timeoutId);
        };
    }, [
        desktopVisibleColumnIds,
        formData.items.length,
        isCompactOrderMobileLayout,
        searchTerm,
        showActualProductSection,
        showColumnConfig,
        syncOrderFormTableViewportWidth,
    ]);

    const captureProductQuickSetupViewport = useCallback(() => {
        if (!showProductQuickSetupPanel) return;

        const listNode = productQuickSetupListRef.current;
        if (!listNode) return;

        pendingProductQuickSetupViewportRef.current = {
            scrollTop: listNode.scrollTop,
            searchWasFocused: document.activeElement === productQuickSetupSearchInputRef.current,
        };
    }, [showProductQuickSetupPanel]);

    useLayoutEffect(() => {
        const pendingViewport = pendingProductQuickSetupViewportRef.current;
        if (!pendingViewport || !showProductQuickSetupPanel) return undefined;

        const restoreViewport = () => {
            const listNode = productQuickSetupListRef.current;
            if (!listNode) return;

            listNode.scrollTop = pendingViewport.scrollTop;

            if (pendingViewport.searchWasFocused && productQuickSetupSearchInputRef.current && document.activeElement !== productQuickSetupSearchInputRef.current) {
                try {
                    productQuickSetupSearchInputRef.current.focus({ preventScroll: true });
                } catch {
                    productQuickSetupSearchInputRef.current.focus();
                }
            }
        };

        restoreViewport();

        const frameId = window.requestAnimationFrame(() => {
            restoreViewport();
            pendingProductQuickSetupViewportRef.current = null;
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [showProductQuickSetupPanel, visibleProductQuickSetupProducts]);

    const [provinces, setProvinces] = useState([]);
    const [districts, setDistricts] = useState([]);
    const [wards, setWards] = useState([]);
    const [regionType, setRegionType] = useState('new');
    const [addressDetection, setAddressDetection] = useState(null);
    const useNewAddress = regionType === 'new';
    const isWardsLoading = false;
    const isDistrictsLoading = false;

    useEffect(() => {
        if (productQuickFilterAttributes.length === 0) {
            return;
        }

        const fallbackAttributeId = String(productQuickFilterAttributes[0]?.id || '');
        const hasCurrentAttribute = productQuickFilterAttributes.some(
            (attribute) => String(attribute.id) === String(productQuickFilterAttributeId)
        );

        if (!hasCurrentAttribute && fallbackAttributeId) {
            setProductQuickFilterAttributeId(fallbackAttributeId);
            setProductQuickFilterValues([]);
            setProductQuickFilterAttributeId2('');
            setProductQuickFilterValues2([]);
            return;
        }

        const currentAttribute = productQuickFilterAttributes.find(
            (attribute) => String(attribute.id) === String(productQuickFilterAttributeId)
        );
        if (
            currentAttribute
            && normalizedProductQuickFilterValues[0]
            && !currentAttribute.options.some((option) => option.value === normalizedProductQuickFilterValues[0])
        ) {
            setProductQuickFilterValues([]);
            setProductQuickFilterValues2([]);
            setProductQuickFilterAttributeId2('');
            return;
        }

        if (productQuickFilterAttributeId2) {
            const secondaryAttribute = productQuickFilterAttributes.find(
                (attribute) => String(attribute.id) === String(productQuickFilterAttributeId2)
            );

            if (!secondaryAttribute || String(productQuickFilterAttributeId2) === String(productQuickFilterAttributeId)) {
                setProductQuickFilterAttributeId2('');
                setProductQuickFilterValues2([]);
                return;
            }

            if (
                normalizedProductQuickFilterValues2[0]
                && !(isProductQuickFilterScopeReady ? activeProductQuickFilterAttribute2Options : secondaryAttribute.options)
                    .some((option) => option.value === normalizedProductQuickFilterValues2[0])
            ) {
                setProductQuickFilterValues2([]);
            }
        }
    }, [
        activeProductQuickFilterAttribute2Options,
        isProductQuickFilterScopeReady,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
        productQuickFilterAttributeId,
        productQuickFilterAttributeId2,
        productQuickFilterAttributes,
    ]);

    useEffect(() => {
        if (productQuickFilterStorageKeyRef.current === productQuickFilterStorageKey) return;

        const storedState = getStoredProductQuickFilterState(user);
        productQuickFilterStorageKeyRef.current = productQuickFilterStorageKey;
        skipNextProductQuickFilterPersistRef.current = true;

        setSearchTerm(storedState.searchTerm);
        setProductQuickFilterAttributeId(storedState.attributeId);
        setProductQuickFilterValues(storedState.values);
        setProductQuickFilterAttributeId2(storedState.attributeId2);
        setProductQuickFilterValues2(storedState.values2);
        setProductQuickModeEnabled(storedState.quickModeEnabled);
        setShowProductQuickFilterPanel(false);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
    }, [productQuickFilterStorageKey, user]);

    useEffect(() => {
        if (skipNextProductQuickFilterPersistRef.current) {
            skipNextProductQuickFilterPersistRef.current = false;
            return;
        }

        persistProductQuickFilterState(productQuickFilterStorageKey, {
            searchTerm,
            attributeId: productQuickFilterAttributeId,
            values: normalizedProductQuickFilterValues,
            attributeId2: productQuickFilterAttributeId2,
            values2: normalizedProductQuickFilterValues2,
            quickModeEnabled: productQuickModeEnabled,
        });
    }, [
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
        productQuickFilterAttributeId,
        productQuickFilterAttributeId2,
        productQuickFilterStorageKey,
        productQuickModeEnabled,
        searchTerm,
    ]);

    useEffect(() => {
        const nextProvinces = sortRegionObjects(VN_REGIONS[regionType] || []);
        setProvinces(nextProvinces);
        setDistricts([]);
        setWards([]);

        setFormData(prev => {
            const provinceExists = nextProvinces.some((province) => province.name === prev.province);
            const nextData = {
                ...prev,
                province: provinceExists ? prev.province : '',
                district: provinceExists && regionType === 'old' ? prev.district : '',
                ward: provinceExists ? prev.ward : ''
            };

            return nextData;
        });
    }, [regionType]);

    const handleProvinceChange = (e) => {
        const provinceName = e.target.value;
        const provinceData = provinces.find((province) => province.name === provinceName);

        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            province: provinceName,
            district: '',
            ward: ''
        }));

        if (regionType === 'old') {
            setDistricts(sortRegionObjects(provinceData?.districts || []));
            setWards([]);
            return;
        }

        setDistricts([]);
        setWards(sortRegionStrings(provinceData?.wards || []));
    };

    const handleDistrictChange = (e) => {
        const districtName = e.target.value;
        const districtData = districts.find((district) => district.name === districtName);

        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            district: districtName,
            ward: ''
        }));
        setWards(sortRegionStrings(districtData?.wards || []));
    };

    const handleWardChange = (e) => {
        const wardName = e.target.value;
        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({ ...prev, ward: wardName }));
    };

    const syncShippingAddress = useCallback((nextData, nextRegionType = regionType) => ({
        ...nextData,
        shipping_address: nextData.shipping_address || nextData.address_detail || ''
    }), [regionType]);

    const clearProvince = useCallback(() => {
        setAddressDetection(null);
        setDistricts([]);
        setWards([]);
        setFormData(prev => syncShippingAddress({
            ...prev,
            province: '',
            district: '',
            ward: ''
        }));
    }, [syncShippingAddress]);

    const clearDistrict = useCallback(() => {
        setAddressDetection(null);
        setWards([]);
        setFormData(prev => syncShippingAddress({
            ...prev,
            district: '',
            ward: ''
        }));
    }, [syncShippingAddress]);

    const clearWard = useCallback(() => {
        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            ward: ''
        }));
    }, [syncShippingAddress]);

    useEffect(() => {
        if (!formData.province) {
            setDistricts([]);
            setWards([]);
            return;
        }

        const provinceData = provinces.find((province) => province.name === formData.province);
        if (!provinceData) return;

        if (regionType === 'old') {
            const nextDistricts = sortRegionObjects(provinceData.districts || []);
            setDistricts(nextDistricts);
            const districtData = nextDistricts.find((district) => district.name === formData.district);
            setWards(sortRegionStrings(districtData?.wards || []));
            return;
        }

        setDistricts([]);
        setWards(sortRegionStrings(provinceData.wards || []));
    }, [formData.province, formData.district, provinces, regionType]);

    const detectAdministrativeAddress = useCallback((rawAddress) => {
        const trimmedAddress = (rawAddress || '').trim();
        if (!trimmedAddress) {
            setAddressDetection(null);
            return;
        }

        const parsed = parseAdministrativeAddress(trimmedAddress, VN_REGIONS);
        const extracted = extractCustomerInfoFromText(trimmedAddress);
        const normalizedConfidence = parsed?.confidence || 'none';
        const detectedCustomerName = String(parsed?.customerName || extracted.customerName || '').trim();
        const detectedCustomerPhone = String(parsed?.customerPhone || extracted.customerPhone || '').trim();
        const detectedAddressText = String(parsed?.addressText || extracted.addressText || trimmedAddress).trim();
        const detectedAddressDetail = String(parsed?.addressDetail || extracted.addressText || trimmedAddress).trim();
        const hasExistingShippingAddress = hasNonEmptyText(formData.shipping_address) || hasNonEmptyText(formData.address_detail);
        const hasExistingAdministrativeInfo = Boolean(
            hasNonEmptyText(formData.province)
            || hasNonEmptyText(formData.district)
            || hasNonEmptyText(formData.ward)
        );
        const hasDetectedAdministrativeInfo = Boolean(
            hasNonEmptyText(parsed?.province)
            || hasNonEmptyText(parsed?.district)
            || hasNonEmptyText(parsed?.ward)
        );
        const autoFilledFields = [];

        if (!hasNonEmptyText(formData.customer_name) && detectedCustomerName) {
            autoFilledFields.push('tên khách hàng');
        }

        if (!hasNonEmptyText(formData.customer_phone) && detectedCustomerPhone) {
            autoFilledFields.push('số điện thoại');
        }

        if (!hasExistingShippingAddress && detectedAddressText) {
            autoFilledFields.push('địa chỉ giao hàng');
        }

        if (parsed && normalizedConfidence !== 'none' && hasDetectedAdministrativeInfo && !hasExistingAdministrativeInfo) {
            autoFilledFields.push('đơn vị hành chính');
        }

        setFormData(prev => ({
            ...prev,
            customer_name: !hasNonEmptyText(formData.customer_name) && detectedCustomerName ? detectedCustomerName : prev.customer_name,
            customer_phone: !hasNonEmptyText(formData.customer_phone) && detectedCustomerPhone ? detectedCustomerPhone : prev.customer_phone,
            shipping_address: !hasExistingShippingAddress && detectedAddressText ? detectedAddressText : prev.shipping_address,
            address_detail: !hasExistingShippingAddress && detectedAddressText ? (detectedAddressDetail || detectedAddressText) : prev.address_detail,
            province: parsed && normalizedConfidence !== 'none' && hasDetectedAdministrativeInfo && !hasExistingAdministrativeInfo ? (parsed.province || '') : prev.province,
            district: parsed && normalizedConfidence !== 'none' && hasDetectedAdministrativeInfo && !hasExistingAdministrativeInfo ? (parsed.district || '') : prev.district,
            ward: parsed && normalizedConfidence !== 'none' && hasDetectedAdministrativeInfo && !hasExistingAdministrativeInfo ? (parsed.ward || '') : prev.ward,
        }));

        if (parsed?.regionType && parsed && normalizedConfidence !== 'none' && hasDetectedAdministrativeInfo && !hasExistingAdministrativeInfo) {
            setRegionType(parsed.regionType);
        }

        setAddressDetection(buildAddressDetectionFeedback(normalizedConfidence, autoFilledFields));
    }, [formData]);

    const handleCancel = useCallback(() => {
        navigateBack();
    }, [navigateBack]);

    const closeProductSearchDropdown = useCallback(() => {
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickFilterPanel(false);
        setShowProductQuickSetupPanel(false);
        productSearchInputRef.current?.blur?.();
    }, []);

    const clearProductSearchInput = useCallback(() => {
        setSearchTerm('');
        setDebouncedSearchTerm('');
        setShowSearchHistory(false);
    }, []);

    const focusProductSearch = useCallback(() => {
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);

        window.requestAnimationFrame(() => {
            productSearchContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            productSearchInputRef.current?.focus();
        });
    }, []);

    const toggleProductSearchPanel = useCallback(() => {
        if (showSearchDropdown) {
            closeProductSearchDropdown();
            return;
        }

        focusProductSearch();
    }, [closeProductSearchDropdown, focusProductSearch, showSearchDropdown]);

    useEffect(() => {
        if (!showSearchDropdown) return undefined;

        const handlePointerDownOutsideSearch = (event) => {
            const container = productSearchContainerRef.current;
            const toggleButton = mobileProductSearchToggleButtonRef.current;
            const target = event.target;

            if (!container || !target || container.contains(target) || toggleButton?.contains?.(target)) {
                return;
            }

            closeProductSearchDropdown();
        };

        document.addEventListener('pointerdown', handlePointerDownOutsideSearch, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDownOutsideSearch, true);
        };
    }, [closeProductSearchDropdown, showSearchDropdown]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            previousShowSearchDropdownRef.current = showSearchDropdown;
            return undefined;
        }

        const wasOpen = previousShowSearchDropdownRef.current;

        if (isCompactOrderMobileLayout && !wasOpen && showSearchDropdown && !mobileProductSearchHistoryStateActiveRef.current) {
            const currentState = window.history.state && typeof window.history.state === 'object'
                ? window.history.state
                : {};
            window.history.pushState({ ...currentState, __orderMobileProductSearchOpen: true }, '', window.location.href);
            mobileProductSearchHistoryStateActiveRef.current = true;
        }

        if (isCompactOrderMobileLayout && wasOpen && !showSearchDropdown && mobileProductSearchHistoryStateActiveRef.current) {
            ignoreNextMobileProductSearchPopRef.current = true;
            mobileProductSearchHistoryStateActiveRef.current = false;
            window.history.back();
        }

        previousShowSearchDropdownRef.current = showSearchDropdown;
        return undefined;
    }, [isCompactOrderMobileLayout, showSearchDropdown]);

    useEffect(() => {
        if (typeof window === 'undefined' || !isCompactOrderMobileLayout) return undefined;

        const handlePopState = () => {
            if (ignoreNextMobileProductSearchPopRef.current) {
                ignoreNextMobileProductSearchPopRef.current = false;
                return;
            }

            if (!mobileProductSearchHistoryStateActiveRef.current) {
                return;
            }

            mobileProductSearchHistoryStateActiveRef.current = false;
            previousShowSearchDropdownRef.current = false;
            setShowSearchDropdown(false);
            setShowSearchHistory(false);
            setShowProductQuickFilterPanel(false);
            setShowProductQuickSetupPanel(false);
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isCompactOrderMobileLayout]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // If a global modal is showing, let it handle ESC first
                if (document.body.style.overflow === 'hidden') return;

                const active = document.activeElement;
                const isWriting = active && (
                    active.tagName === 'INPUT' ||
                    active.tagName === 'TEXTAREA' ||
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                );

                if (isWriting && !showColumnConfig && !showSearchDropdown && !showQuoteTemplatePicker && !orderAiReplaceLineId && !actualProductPickerLineId) return;

                if (showColumnConfig) {
                    setShowColumnConfig(false);
                    return;
                }
                if (showSearchDropdown) {
                    closeProductSearchDropdown();
                    return;
                }
                if (showQuoteTemplatePicker) {
                    setShowQuoteTemplatePicker(false);
                    return;
                }
                if (orderAiReplaceLineId) {
                    setOrderAiReplaceLineId('');
                    setOrderAiReplaceSearchTerm('');
                    setOrderAiReplaceResults([]);
                    setOrderAiReplaceLoading(false);
                    return;
                }
                if (actualProductPickerLineId) {
                    setActualProductPickerLineId('');
                    setActualProductPickerSearchTerm('');
                    setActualProductPickerResults([]);
                    setActualProductPickerLoading(false);
                    actualProductPickerAnchorRef.current = null;
                    return;
                }
                if (showOrderAiInputReviewModal) {
                    setShowOrderAiInputReviewModal(false);
                    return;
                }
                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [actualProductPickerLineId, closeProductSearchDropdown, orderAiReplaceLineId, showColumnConfig, showOrderAiInputReviewModal, showSearchDropdown, showQuoteTemplatePicker, handleCancel]);

    useEffect(() => () => {
        if (copyFeedbackTimeoutRef.current) {
            window.clearTimeout(copyFeedbackTimeoutRef.current);
        }
        if (copyNotificationTimeoutRef.current) {
            window.clearTimeout(copyNotificationTimeoutRef.current);
        }
        if (orderAiLastInputPreviewUrlRef.current) {
            URL.revokeObjectURL(orderAiLastInputPreviewUrlRef.current);
            orderAiLastInputPreviewUrlRef.current = '';
        }
    }, []);

    const showTransientNotification = useCallback((type, message, duration = 2000) => {
        setNotification({ type, message });

        if (copyNotificationTimeoutRef.current) {
            window.clearTimeout(copyNotificationTimeoutRef.current);
        }

        copyNotificationTimeoutRef.current = window.setTimeout(() => setNotification(null), duration);
    }, []);

    const revokeOrderAiLastInputPreview = useCallback(() => {
        if (!orderAiLastInputPreviewUrlRef.current) {
            return;
        }

        URL.revokeObjectURL(orderAiLastInputPreviewUrlRef.current);
        orderAiLastInputPreviewUrlRef.current = '';
    }, []);

    const buildOrderAiLastRunInputSnapshot = useCallback(() => {
        revokeOrderAiLastInputPreview();

        const trimmedText = orderAiInput.trim();
        const inputSnapshot = {
            text: trimmedText,
            image_preview_url: '',
            file_name: orderAiFile?.name || '',
            file_type: orderAiFile?.type || '',
            preferred_rule_label: selectedOrderAiQuickRule?.name || '',
        };

        if (orderAiFile && orderAiFile.type?.startsWith('image/')) {
            const previewUrl = URL.createObjectURL(orderAiFile);
            orderAiLastInputPreviewUrlRef.current = previewUrl;
            inputSnapshot.image_preview_url = previewUrl;
        }

        return inputSnapshot;
    }, [orderAiFile, orderAiInput, revokeOrderAiLastInputPreview, selectedOrderAiQuickRule]);

    const clearOrderAiFile = useCallback(() => {
        setOrderAiFile(null);
        setOrderAiFilePreviewUrl('');
        if (orderAiFileInputRef.current) {
            orderAiFileInputRef.current.value = '';
        }
    }, []);

    const resetOrderAiPreviewState = useCallback(() => {
        setOrderAiPreview(null);
        setOrderAiManualPickerLineId('');
        setOrderAiManualSearchTerm('');
        setOrderAiManualSearchResults([]);
    }, []);

    const closeOrderAiReplacePicker = useCallback(() => {
        orderAiReplaceAnchorRef.current = null;
        setOrderAiReplaceLineId('');
        setOrderAiReplaceSearchTerm('');
        setOrderAiReplaceResults([]);
        setOrderAiReplaceLoading(false);
    }, []);
    const closeActualProductPicker = useCallback(() => {
        actualProductPickerAnchorRef.current = null;
        setActualProductPickerLineId('');
        setActualProductPickerSearchTerm('');
        setActualProductPickerResults([]);
        setActualProductPickerLoading(false);
    }, []);
    const handleSelectOrderLine = useCallback((lineId) => {
        setSelectedOrderLineId((prev) => (
            normalizeCanvasText(prev) === normalizeCanvasText(lineId)
                ? prev
                : normalizeCanvasText(lineId)
        ));
    }, []);
    const handleActualProductSectionLineChange = useCallback((lineId) => {
        closeActualProductPicker();
        handleSelectOrderLine(lineId);
    }, [closeActualProductPicker, handleSelectOrderLine]);
    const handleToggleActualProductSection = useCallback(() => {
        if (showActualProductSection) {
            setShowActualProductSection(false);
            closeActualProductPicker();
            return;
        }

        if (!Array.isArray(formData.items) || formData.items.length === 0) {
            showTransientNotification('error', 'Đơn chưa có sản phẩm để gán sản phẩm gửi thực tế.');
            return;
        }

        const fallbackLine = selectedOrderLine || formData.items[0];
        if (fallbackLine?.line_id) {
            handleSelectOrderLine(fallbackLine.line_id);
        }

        setShowActualProductSection(true);
    }, [closeActualProductPicker, formData.items, handleSelectOrderLine, selectedOrderLine, showActualProductSection, showTransientNotification]);

    const toggleOrderAiPanel = useCallback(() => {
        setShowOrderAiPanel((prev) => !prev);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
        closeOrderAiReplacePicker();
        closeActualProductPicker();
    }, [closeActualProductPicker, closeOrderAiReplacePicker]);
    useEffect(() => {
        if (!showActualProductSection) return;

        if (!Array.isArray(formData.items) || formData.items.length === 0) {
            setShowActualProductSection(false);
            closeActualProductPicker();
            return;
        }

        if (!selectedOrderLine && formData.items[0]?.line_id) {
            setSelectedOrderLineId(normalizeCanvasText(formData.items[0].line_id));
        }
    }, [closeActualProductPicker, formData.items, selectedOrderLine, showActualProductSection]);
    useEffect(() => {
        if (!showActualProductSection || typeof window === 'undefined') {
            return undefined;
        }

        const frameId = window.requestAnimationFrame(() => {
            actualProductSectionRef.current?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'nearest',
            });
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [showActualProductSection]);

    const handleOrderAiSelectedRuleChange = useCallback((nextRuleKey) => {
        setOrderAiSelectedRuleKey(String(nextRuleKey || '').trim());
        resetOrderAiPreviewState();
    }, [resetOrderAiPreviewState]);

    const handleOrderAiFileSelected = useCallback((file) => {
        if (!file) return;
        setOrderAiFile(file);
        resetOrderAiPreviewState();
    }, [resetOrderAiPreviewState]);

    const handleOrderAiFileChange = useCallback((event) => {
        const nextFile = event.target.files?.[0];
        if (!nextFile) return;
        handleOrderAiFileSelected(nextFile);
    }, [handleOrderAiFileSelected]);

    const handleOrderAiPaste = useCallback((event) => {
        const clipboardItems = Array.from(event.clipboardData?.items || []);
        const imageItem = clipboardItems.find((item) => item.type?.startsWith('image/'));
        if (!imageItem) return;

        const imageFile = imageItem.getAsFile();
        if (!imageFile) return;

        event.preventDefault();
        handleOrderAiFileSelected(imageFile);
        showTransientNotification('success', 'Đã gắn ảnh từ clipboard vào ô tìm nhanh bằng AI.');
    }, [handleOrderAiFileSelected, showTransientNotification]);

    const updateOrderAiPreviewItem = useCallback((lineKey, patch) => {
        setOrderAiPreview((prev) => {
            if (!prev || !Array.isArray(prev.items)) return prev;

            return {
                ...prev,
                items: prev.items.map((item) => (
                    item.line_key === lineKey
                        ? { ...item, ...patch }
                        : item
                )),
            };
        });
    }, []);

    const handleSelectOrderAiSuggestion = useCallback((lineKey, entry) => {
        if (!entry) return;

        updateOrderAiPreviewItem(lineKey, {
            selected_entry: entry,
            match_status: 'review',
            confidence: Math.max(60, Number(entry?.confidence ?? 60)),
            confidence_label: entry?.confidence_label || 'Cần rà',
        });
        setOrderAiManualPickerLineId('');
        setOrderAiManualSearchTerm('');
        setOrderAiManualSearchResults([]);
    }, [updateOrderAiPreviewItem]);

    const handleOpenOrderAiManualPicker = useCallback((lineKey, seedTerm = '') => {
        setOrderAiManualPickerLineId(lineKey);
        setOrderAiManualSearchTerm(seedTerm || '');
        setOrderAiManualSearchResults([]);
    }, []);

    const handleOpenOrderAiReplacePicker = useCallback((lineId, seedTerm = '', triggerElement = null) => {
        orderAiReplaceAnchorRef.current = triggerElement;
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
        setOrderAiReplaceLineId(lineId);
        setOrderAiReplaceSearchTerm(seedTerm || '');
        setOrderAiReplaceResults([]);
    }, []);
    const handleOpenActualProductPicker = useCallback((lineId, seedTerm = '', triggerElement = null) => {
        actualProductPickerAnchorRef.current = triggerElement;
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
        setShowActualProductSection(true);
        setActualProductPickerLineId(lineId);
        setActualProductPickerSearchTerm(seedTerm || '');
        setActualProductPickerResults([]);
    }, []);
    const handleToggleActualProductPicker = useCallback((line, triggerElement = null) => {
        const normalizedLineId = normalizeCanvasText(line?.line_id);
        if (!normalizedLineId) return;

        if (normalizeCanvasText(actualProductPickerLineId) === normalizedLineId) {
            closeActualProductPicker();
            return;
        }

        handleSelectOrderLine(normalizedLineId);
        handleOpenActualProductPicker(
            normalizedLineId,
            getOrderItemActualNameLabel(line) || line?.name || line?.sku || '',
            triggerElement
        );
    }, [actualProductPickerLineId, closeActualProductPicker, handleOpenActualProductPicker, handleSelectOrderLine]);

    const handleClearLatestOrderAiRun = useCallback(() => {
        const latestSessionId = normalizeCanvasText(orderAiLastRun?.sessionId);
        const latestLineIds = new Set(
            Array.isArray(orderAiLastRun?.sessionLineIds)
                ? orderAiLastRun.sessionLineIds.map((lineId) => normalizeCanvasText(lineId)).filter(Boolean)
                : []
        );

        if (!latestSessionId && latestLineIds.size === 0) {
            showTransientNotification('error', 'KhÃ´ng cÃ³ káº¿t quáº£ AI gáº§n nháº¥t Ä‘á»ƒ xÃ³a.');
            return;
        }

        let removedCount = 0;
        setFormData((prev) => {
            const nextItems = prev.items.filter((item) => {
                const lineId = normalizeCanvasText(item?.line_id);
                const sessionId = normalizeCanvasText(item?.ai_meta?.session_id);
                const shouldRemove = isOrderAiItem(item)
                    && (latestLineIds.has(lineId) || (latestSessionId && sessionId === latestSessionId));

                if (shouldRemove) {
                    removedCount += 1;
                    return false;
                }

                return true;
            });

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        closeOrderAiReplacePicker();
        if (removedCount > 0) {
            setShowOrderAiInputReviewModal(false);
            setOrderAiLastRun(null);
        }
        showTransientNotification(
            removedCount > 0 ? 'success' : 'error',
            removedCount > 0
                ? `ÄÃ£ xÃ³a ${removedCount} dÃ²ng AI cá»§a láº§n cháº¡y gáº§n nháº¥t.`
                : 'KhÃ´ng tÃ¬m tháº¥y dÃ²ng AI gáº§n nháº¥t Ä‘á»ƒ xÃ³a.'
        );
    }, [closeOrderAiReplacePicker, orderAiLastRun, showTransientNotification]);

    const handleSelectOrderAiLineReplacement = useCallback(async (lineId, entry) => {
        if (!entry) return;

        const replacement = buildOrderItemsFromSearchEntry(entry)[0];
        if (!replacement) {
            showTransientNotification('error', 'Không thể đổi sang sản phẩm đã chọn.');
            return;
        }

        const currentLine = formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(lineId));
        if (!currentLine) {
            closeOrderAiReplacePicker();
            showTransientNotification('error', 'Không tìm thấy dòng sản phẩm cần đổi.');
            return;
        }

        const replacedLineWasAi = isOrderAiItem(currentLine);
        const nextReplacement = createOrderLineItem({
            ...replacement,
            line_id: currentLine.line_id,
            sort_order: currentLine.sort_order,
            quantity: normalizeOrderLineQuantity(currentLine.quantity),
            ai_meta: replacedLineWasAi
                ? mergeOrderAiItemMeta(currentLine.ai_meta, {
                    review_state: currentLine?.ai_meta?.review_state || 'pending',
                    match_status: 'review',
                    confidence: 0,
                    confidence_label: 'Đã đổi tay',
                    match_reasons: ['Đổi sản phẩm tại dòng AI'],
                })
                : undefined,
        });

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => {
                if (normalizeCanvasText(item?.line_id) !== normalizeCanvasText(lineId)) {
                    return item;
                }

                return nextReplacement;
            });

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        closeOrderAiReplacePicker();

        if (nextReplacement && !hasInventorySnapshot(nextReplacement)) {
            await refreshOrderItemInventorySnapshot([nextReplacement]);
        }

        showTransientNotification(
            'success',
            replacedLineWasAi
                ? 'Đã đổi nhanh sản phẩm cho dòng AI.'
                : 'Đã đổi sản phẩm cho dòng trong đơn.'
        );
    }, [closeOrderAiReplacePicker, formData.items, refreshOrderItemInventorySnapshot, showTransientNotification]);

    const handleClearActualProductOverride = useCallback(async (lineId) => {
        const currentLine = formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(lineId));
        if (!currentLine) {
            closeActualProductPicker();
            return;
        }

        const clearedLine = createOrderLineItem({
            ...currentLine,
            actual_product_id: null,
            actual_name: '',
            actual_sku: '',
            actual_snapshot_name: '',
            actual_snapshot_sku: '',
            cost_price: resolveRoundedImportCostValue(currentLine.base_cost_price, currentLine.cost_price),
        });

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => (
                normalizeCanvasText(item?.line_id) === normalizeCanvasText(lineId)
                    ? clearedLine
                    : item
            ));

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        closeActualProductPicker();
        await refreshOrderItemInventorySnapshot([clearedLine]);
        showTransientNotification('success', 'Đã bỏ gửi sản phẩm khác cho dòng đang chọn.');
    }, [closeActualProductPicker, formData.items, refreshOrderItemInventorySnapshot, showTransientNotification]);
    const handleSelectActualProductReplacement = useCallback(async (lineId, entry) => {
        if (!entry) return;

        const replacement = buildOrderItemsFromSearchEntry(entry)[0];
        if (!replacement) {
            showTransientNotification('error', 'Không thể chọn sản phẩm gửi thực tế.');
            return;
        }

        const currentLine = formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(lineId));
        if (!currentLine) {
            closeActualProductPicker();
            showTransientNotification('error', 'Không tìm thấy dòng sản phẩm cần cập nhật.');
            return;
        }

        if (Number(replacement.product_id) === Number(currentLine.product_id)) {
            await handleClearActualProductOverride(lineId);
            return;
        }

        const nextLine = createOrderLineItem({
            ...currentLine,
            actual_product_id: replacement.product_id,
            actual_name: replacement.name,
            actual_sku: replacement.sku,
            actual_snapshot_name: replacement.snapshot_name || replacement.name,
            actual_snapshot_sku: replacement.snapshot_sku || replacement.sku,
            cost_price: resolveRoundedImportCostValue(replacement.cost_price, currentLine.cost_price),
            computed_stock: replacement.computed_stock,
            pending_export_quantity: replacement.pending_export_quantity,
            available_to_sell: replacement.available_to_sell,
        });

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => (
                normalizeCanvasText(item?.line_id) === normalizeCanvasText(lineId)
                    ? nextLine
                    : item
            ));

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        closeActualProductPicker();
        await refreshOrderItemInventorySnapshot([nextLine]);
        showTransientNotification('success', 'Đã gán sản phẩm gửi thực tế cho dòng đã chọn.');
    }, [closeActualProductPicker, formData.items, handleClearActualProductOverride, refreshOrderItemInventorySnapshot, showTransientNotification]);

    const handleRunOrderAiPreview = useCallback(async () => {
        const preferredRuleKey = orderAiSelectedRuleKey.trim();
        const inputSnapshot = buildOrderAiLastRunInputSnapshot();

        if (!orderAiInput.trim() && !orderAiFile && !preferredRuleKey) {
            showTransientNotification('error', 'Nhập nội dung hoặc chọn ảnh để AI xử lý.');
            return;
        }

        setOrderAiLoading(true);
        setOrderAiManualPickerLineId('');
        setOrderAiManualSearchResults([]);

        try {
            const payload = new FormData();
            if (orderAiInput.trim()) {
                payload.append('message', orderAiInput.trim());
            }
            if (orderAiFile) {
                payload.append('attachment', orderAiFile);
            }
            if (preferredRuleKey) {
                payload.append('preferred_rule_key', preferredRuleKey);
            }

            const response = await orderApi.aiPreview(payload);
            const preview = response.data || {};
            const normalizedPreviewItems = Array.isArray(preview.items)
                ? preview.items.map(normalizeOrderAiPreviewItem)
                : [];
            const readyItems = normalizedPreviewItems.filter((item) => item?.selected_entry && Number(item?.quantity) > 0);
            const unresolvedItems = normalizedPreviewItems.filter((item) => !item?.selected_entry);
            const sessionId = `order-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            setOrderAiPreview({
                ...preview,
                items: normalizedPreviewItems,
            });

            if (readyItems.length === 0) {
                setOrderAiLastRun({
                    sessionId: '',
                    sessionLineIds: [],
                    addedCount: 0,
                    touchedCount: 0,
                    reviewCount: 0,
                    unresolvedCount: unresolvedItems.length,
                    unresolvedLabels: unresolvedItems.map((item) => item?.source_phrase || item?.parsed_name || '').filter(Boolean).slice(0, 3),
                    input: inputSnapshot,
                });
                showTransientNotification('error', 'AI chưa ghép được sản phẩm nào để đưa vào bảng hàng.');
                return;
            }

            const additions = readyItems.flatMap((item) => (
                buildOrderItemsFromSearchEntry(item.selected_entry).map((addition, additionIndex) => ({
                    ...addition,
                    line_id: addition?.line_id || `${sessionId}-${item.line_key}-${additionIndex + 1}`,
                    quantity: normalizeOrderLineQuantity(addition?.quantity ?? 1) * normalizeOrderLineQuantity(item.quantity),
                    ai_meta: createOrderAiLineMeta(item, sessionId),
                }))
            ));

            if (additions.length === 0) {
                showTransientNotification('error', 'AI chưa tạo được dòng sản phẩm hợp lệ.');
                return;
            }

            const sessionAdditions = additions.map((addition) => createOrderLineItem(addition));
            const sessionLineIds = sessionAdditions.map((item) => normalizeCanvasText(item?.line_id)).filter(Boolean);
            setFormData((prev) => {
                const nextItems = [...prev.items, ...sessionAdditions];
                const costTotal = calculateItemsCostTotal(nextItems);

                return {
                    ...prev,
                    items: nextItems,
                    cost_total: costTotal,
                };
            });

            const needsInventorySnapshot = sessionAdditions.some((item) => !hasInventorySnapshot(item));
            if (needsInventorySnapshot) {
                await refreshOrderItemInventorySnapshot(sessionAdditions);
            }

            const reviewCount = readyItems.filter((item) => item?.match_status !== 'matched').length;
            const bonusCount = readyItems.filter((item) => item?.bonus).length;

            setOrderAiLastRun({
                sessionId,
                sessionLineIds,
                addedCount: readyItems.length,
                touchedCount: sessionLineIds.length || sessionAdditions.length,
                reviewCount,
                unresolvedCount: unresolvedItems.length,
                unresolvedLabels: unresolvedItems.map((item) => item?.source_phrase || item?.parsed_name || '').filter(Boolean).slice(0, 3),
                altarSizeLabel: preview?.altar_size?.label || '',
                bonusCount,
                input: inputSnapshot,
            });

            setOrderAiInput('');
            setOrderAiSelectedRuleKey('');
            clearOrderAiFile();
            resetOrderAiPreviewState();
            setShowOrderAiPanel(false);

            showTransientNotification(
                'success',
                reviewCount > 0
                    ? `AI đã thêm ${sessionLineIds.length || sessionAdditions.length} dòng. Có ${reviewCount} dòng cần rà nhanh trong bảng hàng.`
                    : `AI đã thêm ${sessionLineIds.length || sessionAdditions.length} dòng vào bảng hàng.`
            );
        } catch (error) {
            console.error('Error running order AI preview', error);
            showModal({
                title: 'Không thể đọc nội dung',
                content: error?.response?.data?.message || 'AI chưa xử lý được nội dung vừa gửi. Hãy thử lại với câu rõ hơn hoặc ảnh nét hơn.',
                type: 'error',
            });
        } finally {
            setOrderAiLoading(false);
        }
    }, [
        buildOrderAiLastRunInputSnapshot,
        clearOrderAiFile,
        orderAiFile,
        orderAiInput,
        orderAiSelectedRuleKey,
        refreshOrderItemInventorySnapshot,
        resetOrderAiPreviewState,
        showModal,
        showTransientNotification,
    ]);

    const handleSaveOrderAiRules = useCallback(async (nextRules) => {
        setOrderAiSavingRules(true);

        try {
            const response = await orderApi.updateAiRules({ rules: nextRules });
            const savedRules = normalizeOrderAiRules(response.data?.rules || []);

            setOrderAiRules(savedRules);
            setShowOrderAiRulesModal(false);
            orderApi.invalidateBootstrap({ mode: 'form' });
            showTransientNotification('success', response.data?.message || 'Đã lưu rule AI.');
        } catch (error) {
            console.error('Error saving order AI rules', error);
            showModal({
                title: 'Không thể lưu rule AI',
                content: error?.response?.data?.message || 'Vui lòng kiểm tra lại dữ liệu rule và thử lại.',
                type: 'error',
            });
        } finally {
            setOrderAiSavingRules(false);
        }
    }, [showModal, showTransientNotification]);

    const toggleLineItemSelection = useCallback((lineId) => {
        setSelectedLineItemIds((prev) => {
            const next = new Set(prev);
            if (next.has(lineId)) {
                next.delete(lineId);
            } else {
                next.add(lineId);
            }
            return next;
        });
    }, []);

    const toggleAllLineItemSelection = useCallback(() => {
        setSelectedLineItemIds((prev) => {
            if (prev.size === formData.items.length) {
                return new Set();
            }
            return new Set(formData.items.map((item) => item.line_id));
        });
    }, [formData.items]);

    const handleBulkReplace = useCallback(() => {
        if (selectedLineItemIds.size === 0) return;
        setShowBulkReplaceModal(true);
    }, [selectedLineItemIds.size]);

    const applyBulkReplacements = useCallback((replacements) => {
        if (!Array.isArray(replacements) || replacements.length === 0) return;

        setFormData((prev) => {
            const nextItems = [...prev.items];
            replacements.forEach(({ lineId, product }) => {
                const index = nextItems.findIndex((item) => item.line_id === lineId);
                if (index === -1) return;

                const originalItem = nextItems[index];

                // Enrich the picker product before building the line item:
                // 1. Build attributes_map from attribute_values array (returned by new picker API)
                // 2. Mark as SEARCH_ENTRY_VARIATION if it has a parent_product_id
                const enrichedProduct = { ...product };
                if (!enrichedProduct.attributes_map && Array.isArray(enrichedProduct.attribute_values)) {
                    const attrMap = {};
                    enrichedProduct.attribute_values.forEach((av) => {
                        if (av?.attribute_id != null && av?.value != null) {
                            attrMap[String(av.attribute_id)] = av.value;
                        }
                    });
                    enrichedProduct.attributes_map = attrMap;
                }
                const parentId = Number(enrichedProduct.parent_product_id) || 0;
                if (parentId > 0 && !enrichedProduct.entry_kind) {
                    enrichedProduct.entry_kind = 'variation';
                    enrichedProduct.parent_product_id = parentId;
                }

                const addition = buildOrderItemsFromSearchEntry(enrichedProduct)[0];
                
                if (addition) {
                    nextItems[index] = {
                        ...addition,
                        line_id: originalItem.line_id,
                        quantity: originalItem.quantity,
                        notes: originalItem.notes,
                        replaced_from_name: originalItem.name,
                        ai_meta: mergeOrderAiItemMeta(originalItem.ai_meta, addition.ai_meta),
                    };
                }
            });
            return { ...prev, items: nextItems };
        });

        setSelectedLineItemIds(new Set());
        showTransientNotification('success', `Đã đổi thành công ${replacements.length} sản phẩm.`);
    }, [buildOrderItemsFromSearchEntry, showTransientNotification]);

    const isAllLineItemsSelected = formData.items.length > 0 && selectedLineItemIds.size === formData.items.length;
    const hasAnyLineItemSelected = selectedLineItemIds.size > 0;

    const handleApplyOrderAiPreview = useCallback(async () => {
        if (!orderAiPreview || !Array.isArray(orderAiPreview.items) || orderAiPreview.items.length === 0) {
            showTransientNotification('error', 'Chưa có kết quả AI để đưa vào đơn.');
            return;
        }

        const readyItems = orderAiPreview.items.filter((item) => item?.selected_entry && Number(item?.quantity) > 0);
        if (readyItems.length === 0) {
            showTransientNotification('error', 'Không có dòng nào đã chọn sản phẩm hợp lệ.');
            return;
        }

        setOrderAiApplying(true);

        try {
            const additions = readyItems.flatMap((item) => (
                buildOrderItemsFromSearchEntry(item.selected_entry).map((addition) => ({
                    ...addition,
                    quantity: normalizeOrderLineQuantity(addition?.quantity ?? 1) * normalizeOrderLineQuantity(item.quantity),
                }))
            ));

            if (additions.length === 0) {
                showTransientNotification('error', 'AI chưa ghép được sản phẩm để thêm vào đơn.');
                return;
            }

            setFormData((prev) => {
                const nextItems = appendOrderItemsWithMerge(prev.items, additions, { incrementExisting: true });
                const costTotal = calculateItemsCostTotal(nextItems);

                return {
                    ...prev,
                    items: nextItems,
                    cost_total: costTotal,
                };
            });

            const needsInventorySnapshot = additions.some((item) => !hasInventorySnapshot(item));
            if (needsInventorySnapshot) {
                await refreshOrderItemInventorySnapshot(additions);
            }

            const bonusCount = readyItems.filter((item) => item?.bonus).length;
            showTransientNotification(
                'success',
                bonusCount > 0
                    ? `Đã thêm ${readyItems.length} dòng vào đơn. Có ${bonusCount} dòng đánh dấu tặng kèm, nếu cần hãy sửa giá bằng tay.`
                    : `Đã thêm ${readyItems.length} dòng vào đơn.`
            );
        } catch (error) {
            console.error('Error applying order AI preview', error);
            showTransientNotification('error', 'Không thể thêm kết quả AI vào đơn.');
        } finally {
            setOrderAiApplying(false);
        }
    }, [orderAiPreview, refreshOrderItemInventorySnapshot, showTransientNotification]);

    useEffect(() => {
        if (!orderAiFile) {
            setOrderAiFilePreviewUrl('');
            return undefined;
        }

        if (!orderAiFile.type?.startsWith('image/')) {
            setOrderAiFilePreviewUrl('');
            return undefined;
        }

        const previewUrl = URL.createObjectURL(orderAiFile);
        setOrderAiFilePreviewUrl(previewUrl);

        return () => {
            URL.revokeObjectURL(previewUrl);
        };
    }, [orderAiFile]);

    useEffect(() => {
        if (!orderAiManualPickerLineId || orderAiManualSearchTerm.trim().length < 2) {
            setOrderAiManualSearchResults([]);
            setOrderAiManualSearchLoading(false);
            return undefined;
        }

        let cancelled = false;
        setOrderAiManualSearchLoading(true);

        const timerId = window.setTimeout(() => {
            productApi.getAll({ picker: 1, per_page: 20, search: orderAiManualSearchTerm.trim() })
                .then((response) => {
                    if (cancelled) return;
                    setOrderAiManualSearchResults(buildOrderAiPickerEntries(response.data?.data || []));
                })
                .catch((error) => {
                    if (cancelled) return;
                    console.error('Error fetching manual AI products', error);
                    setOrderAiManualSearchResults([]);
                })
                .finally(() => {
                    if (!cancelled) {
                        setOrderAiManualSearchLoading(false);
                    }
                });
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
        };
    }, [orderAiManualPickerLineId, orderAiManualSearchTerm]);

    useEffect(() => {
        if (!orderAiReplaceLineId || orderAiReplaceSearchTerm.trim().length < 2) {
            setOrderAiReplaceResults([]);
            setOrderAiReplaceLoading(false);
            return undefined;
        }

        let cancelled = false;
        setOrderAiReplaceLoading(true);

        const timerId = window.setTimeout(() => {
            productApi.getAll({ picker: 1, per_page: 40, search: orderAiReplaceSearchTerm.trim() })
                .then((response) => {
                    if (cancelled) return;
                    setOrderAiReplaceResults(buildOrderAiPickerEntries(response.data?.data || []));
                })
                .catch((error) => {
                    if (cancelled) return;
                    console.error('Error fetching replacement AI products', error);
                    setOrderAiReplaceResults([]);
                })
                .finally(() => {
                    if (!cancelled) {
                        setOrderAiReplaceLoading(false);
                    }
                });
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
        };
    }, [orderAiReplaceLineId, orderAiReplaceSearchTerm]);
    useEffect(() => {
        if (!actualProductPickerLineId || actualProductPickerSearchTerm.trim().length < 2) {
            setActualProductPickerResults([]);
            setActualProductPickerLoading(false);
            return undefined;
        }

        let cancelled = false;
        setActualProductPickerLoading(true);

        const timerId = window.setTimeout(() => {
            productApi.getAll({ picker: 1, per_page: 20, search: actualProductPickerSearchTerm.trim() })
                .then((response) => {
                    if (cancelled) return;
                    setActualProductPickerResults(buildOrderAiPickerEntries(response.data?.data || []));
                })
                .catch((error) => {
                    if (cancelled) return;
                    console.error('Error fetching actual shipped products', error);
                    setActualProductPickerResults([]);
                })
                .finally(() => {
                    if (!cancelled) {
                        setActualProductPickerLoading(false);
                    }
                });
        }, 200);

        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
        };
    }, [actualProductPickerLineId, actualProductPickerSearchTerm]);

    const persistOrderFormColumnLayout = useCallback(({
        order = columnOrder,
        visible = visibleColumns,
        widths = columnWidths,
        widthMode = columnWidthMode,
    } = {}) => {
        writeOrderFormStorageJson(orderFormColumnOrderStorageKey, normalizeStoredOrderFormColumnOrder(order));
        writeOrderFormStorageJson(orderFormVisibleColumnsStorageKey, normalizeStoredOrderFormVisibleColumns(visible));
        writeOrderFormStorageJson(orderFormColumnWidthsStorageKey, normalizeStoredOrderFormColumnWidths(widths));
        writeOrderFormStorageValue(orderFormColumnWidthModeStorageKey, normalizeOrderFormColumnWidthMode(widthMode));
    }, [columnOrder, columnWidthMode, columnWidths, visibleColumns]);

    const applyOrderFormColumnLayout = useCallback(({
        order = columnOrder,
        visible = visibleColumns,
        widths = columnWidths,
        widthMode = columnWidthMode,
    } = {}) => {
        const nextOrder = normalizeStoredOrderFormColumnOrder(order);
        const nextVisibleColumns = normalizeStoredOrderFormVisibleColumns(visible);
        const nextColumnWidths = normalizeStoredOrderFormColumnWidths(widths);
        const nextWidthMode = normalizeOrderFormColumnWidthMode(widthMode);

        setColumnOrder(nextOrder);
        setVisibleColumns(nextVisibleColumns);
        setColumnWidths(nextColumnWidths);
        setColumnWidthMode(nextWidthMode);
        persistOrderFormColumnLayout({
            order: nextOrder,
            visible: nextVisibleColumns,
            widths: nextColumnWidths,
            widthMode: nextWidthMode,
        });
    }, [columnOrder, columnWidthMode, columnWidths, persistOrderFormColumnLayout, visibleColumns]);

    const saveColumnSettingsDefault = useCallback(() => {
        const nextOrder = normalizeStoredOrderFormColumnOrder(columnOrder);
        const nextVisibleColumns = normalizeStoredOrderFormVisibleColumns(visibleColumns);
        const nextColumnWidths = captureDisplayedOrderFormColumnWidths();
        const nextWidthMode = normalizeOrderFormColumnWidthMode(columnWidthMode);

        writeOrderFormStorageJson(orderFormColumnOrderDefaultStorageKey, nextOrder);
        writeOrderFormStorageJson(orderFormVisibleColumnsDefaultStorageKey, nextVisibleColumns);
        writeOrderFormStorageJson(orderFormColumnWidthsDefaultStorageKey, nextColumnWidths);
        writeOrderFormStorageValue(orderFormColumnWidthModeDefaultStorageKey, nextWidthMode);
        applyOrderFormColumnLayout({
            order: nextOrder,
            visible: nextVisibleColumns,
            widths: nextColumnWidths,
            widthMode: nextWidthMode,
        });
        setShowColumnConfig(false);
        alert('Đã lưu cấu hình cột mặc định.');
    }, [applyOrderFormColumnLayout, captureDisplayedOrderFormColumnWidths, columnOrder, columnWidthMode, visibleColumns]);

    const resetColumnSettingsDefault = useCallback(() => {
        const savedDefaultOrder = readOrderFormStorageJson(orderFormColumnOrderDefaultStorageKey, null);
        const savedDefaultVisibleColumns = readOrderFormStorageJson(orderFormVisibleColumnsDefaultStorageKey, null);
        const savedDefaultWidths = readOrderFormStorageJson(orderFormColumnWidthsDefaultStorageKey, null);
        const savedDefaultWidthMode = normalizeOrderFormColumnWidthMode(
            readOrderFormStorageValue(orderFormColumnWidthModeDefaultStorageKey, ORDER_FORM_COLUMN_WIDTH_MODE_AUTO)
        );
        const hasSavedDefault = Array.isArray(savedDefaultOrder)
            || Array.isArray(savedDefaultVisibleColumns)
            || Boolean(savedDefaultWidths && typeof savedDefaultWidths === 'object' && !Array.isArray(savedDefaultWidths));

        if (hasSavedDefault) {
            applyOrderFormColumnLayout({
                order: savedDefaultOrder || ORDER_FORM_DEFAULT_COLUMN_IDS,
                visible: savedDefaultVisibleColumns || ORDER_FORM_DEFAULT_COLUMN_IDS,
                widths: savedDefaultWidths || ORDER_FORM_DEFAULT_COLUMN_WIDTHS,
                widthMode: savedDefaultWidthMode,
            });
            setShowColumnConfig(false);
            alert('Đã khôi phục cấu hình cột mặc định đã lưu.');
            return;
        }

        const systemColumnConfig = getOrderFormSystemColumnConfig();
        applyOrderFormColumnLayout(systemColumnConfig);
        setShowColumnConfig(false);
        alert('Đã khôi phục cấu hình cột về mặc định hệ thống.');
    }, [applyOrderFormColumnLayout]);

    const handlePersistedColumnResize = useCallback((id, e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const baseWidths = captureDisplayedOrderFormColumnWidths();
        const startX = e.clientX;
        const startWidth = baseWidths[id] || e.currentTarget.parentElement.offsetWidth;
        const minWidth = desktopTableMetrics.minWidths?.[id] ?? 50;
        let currentWidth = startWidth;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (moveEvent) => {
            currentWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
            setColumnWidthMode(ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL);
            setColumnWidths({
                ...baseWidths,
                [id]: Math.round(currentWidth),
            });
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            const nextColumnWidths = normalizeStoredOrderFormColumnWidths({
                ...baseWidths,
                [id]: Math.round(currentWidth),
            });

            setColumnWidthMode(ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL);
            setColumnWidths(nextColumnWidths);
            persistOrderFormColumnLayout({
                widths: nextColumnWidths,
                widthMode: ORDER_FORM_COLUMN_WIDTH_MODE_MANUAL,
            });
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [captureDisplayedOrderFormColumnWidths, desktopTableMetrics, persistOrderFormColumnLayout]);

    // handleCancel now handles navigation directly without confirm for a faster experience

    const fetchProducts = useCallback(async (term = '', filterOverrides = {}) => {
        const params = {
            per_page: isCompactCompositeProductSearch(term) ? 200 : 100,
            picker: 1,
        };
        if (term) params.search = term;

        const activeFilterAttribute = filterOverrides.attribute || activeProductQuickFilterAttribute;
        const activeFilterValues = Array.isArray(filterOverrides.values)
            ? filterOverrides.values.map(normalizeQuickFilterOptionValue).filter(Boolean)
            : normalizedProductQuickFilterValues;

        appendProductQuickFilterParams(params, activeFilterAttribute, activeFilterValues);
        appendProductQuickFilterParams(params, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2);

        const activeAccountId = typeof window === 'undefined'
            ? 'default'
            : (window.localStorage.getItem('activeAccountId') || 'default');
        const cacheKey = JSON.stringify({ account_id: activeAccountId, ...params });
        const cachedProducts = productSearchCacheRef.current.get(cacheKey);
        if (Array.isArray(cachedProducts) && cachedProducts.length > 0) {
            setProducts(cachedProducts);
            return;
        }

        productSearchAbortRef.current?.abort();
        const controller = new AbortController();
        productSearchAbortRef.current = controller;

        try {
            const prodRes = await productApi.getAll(params, controller.signal);
            if (controller.signal.aborted) return;

            const nextProducts = Array.isArray(prodRes.data.data)
                ? prodRes.data.data.map((product) => normalizeProductPickerEntry(product))
                : [];
            if (nextProducts.length > 0) {
                productSearchCacheRef.current.set(cacheKey, nextProducts);
            } else {
                productSearchCacheRef.current.delete(cacheKey);
            }
            setProducts(nextProducts);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
            console.error("Error fetching products", error);
        } finally {
            if (productSearchAbortRef.current === controller) {
                productSearchAbortRef.current = null;
            }
        }
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
    ]);

    const pushSearchHistory = useCallback((term) => {
        const trimmedTerm = normalizeCanvasText(term);
        if (trimmedTerm.length < 2) return;

        setSearchHistory((prev) => {
            const next = [
                trimmedTerm,
                ...prev.filter((item) => normalizeProductSearchText(item) !== normalizeProductSearchText(trimmedTerm))
            ].slice(0, 8);

            window.localStorage.setItem(productSearchHistoryStorageKey, JSON.stringify(next));
            return next;
        });
    }, []);

    const clearSearchHistory = useCallback(() => {
        setSearchHistory([]);
        window.localStorage.removeItem(productSearchHistoryStorageKey);
    }, []);

    const handleProductQuickFilterAttributeChange = useCallback((nextAttributeId) => {
        setProductQuickFilterAttributeId(nextAttributeId);
        setProductQuickFilterValues([]);
        setProductQuickFilterValues2([]);
        setProductQuickFilterAttributeId2('');

        setShowProductQuickFilterPanel(true);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const handleProductQuickFilterAttributeChange2 = useCallback((nextAttributeId) => {
        setProductQuickFilterAttributeId2(nextAttributeId);
        setProductQuickFilterValues2([]);
        setShowProductQuickFilterPanel(true);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const openProductQuickFilterPanel = useCallback((event) => {
        event?.stopPropagation?.();
        setShowProductQuickFilterPanel(true);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const toggleProductQuickFilterValue = useCallback((value) => {
        const normalizedValue = normalizeQuickFilterOptionValue(value);
        if (!normalizedValue) return;

        const nextValues = normalizedProductQuickFilterValues[0] === normalizedValue ? [] : [normalizedValue];
        setProductQuickFilterValues(nextValues);

        // If primary value is cleared, clear secondary as well
        if (nextValues.length === 0) {
            setProductQuickFilterValues2([]);
            setProductQuickFilterAttributeId2('');
        }

        // If we have secondary filter, we might want to keep the panel open to choose the secondary value
        setShowProductQuickFilterPanel(nextValues.length === 0 || !normalizedProductQuickFilterValues2[0]);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, [normalizedProductQuickFilterValues, normalizedProductQuickFilterValues2]);

    const toggleProductQuickFilterValue2 = useCallback((value) => {
        const normalizedValue = normalizeQuickFilterOptionValue(value);
        if (!normalizedValue) return;

        const nextValues = normalizedProductQuickFilterValues2[0] === normalizedValue ? [] : [normalizedValue];
        setProductQuickFilterValues2(nextValues);
        setShowProductQuickFilterPanel(nextValues.length === 0);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, [normalizedProductQuickFilterValues2]);

    const clearProductQuickFilterValues = useCallback(() => {
        setSearchTerm('');
        setDebouncedSearchTerm('');
        setProductQuickFilterValues([]);
        setProductQuickFilterValues2([]);
        setProductQuickFilterAttributeId2('');
        setProductQuickModeEnabled(false);
        setShowProductQuickFilterPanel(false);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
        productSearchCacheRef.current.clear();

        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(productQuickFilterStorageKey);
            window.localStorage.removeItem(productQuickFilterAttributeStorageKey);
            window.localStorage.removeItem(productQuickFilterAttribute2MapStorageKey);
        }
    }, [productQuickFilterStorageKey]);

    const saveActiveProductQuickSetupItems = useCallback((items) => {
        if (!activeProductQuickSetupKey) return;

        const namespace = resolveProductQuickSetupNamespace();
        const normalizedItems = normalizeStoredProductQuickSetupItems(items);

        setProductQuickSetupStore((prev) => {
            const next = { ...prev };
            const nextNamespaceStore = { ...(next[namespace] || {}) };

            if (normalizedItems.length > 0) {
                nextNamespaceStore[activeProductQuickSetupKey] = normalizedItems;
                next[namespace] = nextNamespaceStore;
                return next;
            }

            delete nextNamespaceStore[activeProductQuickSetupKey];
            if (Object.keys(nextNamespaceStore).length > 0) {
                next[namespace] = nextNamespaceStore;
            } else {
                delete next[namespace];
            }

            return next;
        });
    }, [activeProductQuickSetupKey]);

    const handleAddProductToQuickSetup = useCallback((product) => {
        if (!product) return;

        const entryKind = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
        const targetProductId = Number(product?.target_product_id ?? product?.product_id ?? product?.id ?? 0);
        if (!Number.isFinite(targetProductId) || targetProductId <= 0) {
            return;
        }

        const entryKey = getProductQuickSetupEntryKey({
            ...product,
            entry_kind: entryKind,
            product_id: targetProductId,
            target_product_id: targetProductId,
        });
        if (!entryKey) return;

        const nextItems = normalizeStoredProductQuickSetupItems([
            ...activeProductQuickSetupItems,
            {
                id: entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? entryKey : targetProductId,
                entry_id: entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? entryKey : product.entry_id,
                product_id: targetProductId,
                target_product_id: targetProductId,
                sku: product.sku,
                display_sku: product.display_sku ?? product.sku,
                name: product.name,
                display_name: product.display_name ?? product.name,
                price: product.price,
                expected_cost: parseMoneyNumber(product?.expected_cost),
                cost_price: resolveProductCostPrice(product),
                unit_name: resolveOrderUnitLabel(product),
                ...resolveInventorySnapshot(product),
                main_image: product.main_image,
                type: product.type,
                entry_kind: entryKind,
                parent_product_id: Number(product?.parent_product_id ?? 0) || null,
                parent_product_name: product.parent_product_name ?? '',
                option_label: product.option_label ?? '',
                ...(entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? {
                    bundle_parent_id: Number(product?.bundle_parent_id ?? targetProductId) || targetProductId,
                    bundle_parent_name: product.bundle_parent_name ?? product.parent_product_name ?? product.name ?? '',
                    bundle_option_key: product.bundle_option_key ?? resolveBundleOptionKey(product),
                    bundle_option_title: product.bundle_option_title ?? resolveBundleOptionTitle(product),
                    raw_bundle_option_title: product.raw_bundle_option_title ?? product.option_title ?? '',
                    bundle_option_status: product.bundle_option_status ?? 'visible',
                    bundle_title: product.bundle_title ?? product.bundle_config_title ?? '',
                    bundle_config_title: product.bundle_config_title ?? product.bundle_title ?? '',
                    option_post_id: Number(product?.option_post_id) || undefined,
                    option_post_title: product.option_post_title ?? '',
                    bundle_items: normalizeStoredProductQuickSetupBundleItems(product.bundle_items),
                    bundle_item_count: Number(product?.bundle_item_count) || undefined,
                    bundle_quantity_total: Number(product?.bundle_quantity_total) || undefined,
                } : {}),
            },
        ]);

        saveActiveProductQuickSetupItems(nextItems);
        setProductQuickModeEnabled(true);
    }, [activeProductQuickSetupItems, saveActiveProductQuickSetupItems]);

    const handleRemoveProductFromQuickSetup = useCallback((entryKey) => {
        const normalizedEntryKey = String(entryKey ?? '').trim();
        if (!normalizedEntryKey) return;

        saveActiveProductQuickSetupItems(
            activeProductQuickSetupItems.filter((item) => getProductQuickSetupEntryKey(item) !== normalizedEntryKey)
        );
    }, [activeProductQuickSetupItems, saveActiveProductQuickSetupItems]);

    const handleToggleProductQuickSetupSelection = useCallback((product, entryKey, isSelected) => {
        captureProductQuickSetupViewport();

        if (isSelected) {
            handleRemoveProductFromQuickSetup(entryKey);
            return;
        }

        handleAddProductToQuickSetup(product);
    }, [captureProductQuickSetupViewport, handleAddProductToQuickSetup, handleRemoveProductFromQuickSetup]);

    const toggleProductQuickMode = useCallback(() => {
        if (isProductQuickModeToggleDisabled) return;

        setProductQuickModeEnabled((prev) => !prev);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, [isProductQuickModeToggleDisabled]);

    const disableProductQuickMode = useCallback((event) => {
        event?.stopPropagation?.();
        setProductQuickModeEnabled(false);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const toggleProductQuickSetupPanel = useCallback((event) => {
        event?.stopPropagation?.();
        setShowProductQuickSetupPanel((prev) => !prev);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
    }, []);

    const fetchProductQuickFilterScopeProducts = useCallback(async () => {
        const activeFilterAttribute = activeProductQuickFilterAttribute;
        const activeFilterValue = normalizedProductQuickFilterValues[0];
        if (!activeFilterAttribute || !activeFilterValue || !activeProductQuickFilterScopeKey) {
            setProductQuickFilterScopeProducts([]);
            setProductQuickFilterScopeKey('');
            return;
        }

        const params = {
            per_page: 200,
            picker: 1,
        };
        appendProductQuickFilterParams(params, activeFilterAttribute, [activeFilterValue]);

        const activeAccountId = typeof window === 'undefined'
            ? 'default'
            : (window.localStorage.getItem('activeAccountId') || 'default');
        const cacheKey = JSON.stringify({
            quick_filter_scope: true,
            account_id: activeAccountId,
            scope_key: activeProductQuickFilterScopeKey,
            ...params,
        });
        const cachedProducts = productQuickFilterScopeCacheRef.current.get(cacheKey);
        if (cachedProducts) {
            setProductQuickFilterScopeProducts(cachedProducts);
            setProductQuickFilterScopeKey(activeProductQuickFilterScopeKey);
            return;
        }

        productQuickFilterScopeAbortRef.current?.abort();
        const controller = new AbortController();
        productQuickFilterScopeAbortRef.current = controller;

        try {
            const response = await productApi.getAll(params, controller.signal);
            if (controller.signal.aborted) return;

            const nextProducts = Array.isArray(response.data.data)
                ? response.data.data.map((product) => normalizeProductPickerEntry(product))
                : [];
            productQuickFilterScopeCacheRef.current.set(cacheKey, nextProducts);
            setProductQuickFilterScopeProducts(nextProducts);
            setProductQuickFilterScopeKey(activeProductQuickFilterScopeKey);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
            console.error('Error fetching quick filter scope products', error);
            setProductQuickFilterScopeProducts([]);
            setProductQuickFilterScopeKey(activeProductQuickFilterScopeKey);
        } finally {
            if (productQuickFilterScopeAbortRef.current === controller) {
                productQuickFilterScopeAbortRef.current = null;
            }
        }
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterScopeKey,
        normalizedProductQuickFilterValues,
    ]);

    const fetchProductQuickSetupProducts = useCallback(async (term = '') => {
        const activeFilterAttribute = activeProductQuickFilterAttribute;
        const activeFilterValue = normalizedProductQuickFilterValues[0];
        if (!activeFilterAttribute || !activeFilterValue) {
            setProductQuickSetupProducts([]);
            return;
        }

        const params = {
            per_page: 24,
            picker: 1,
        };
        appendProductQuickFilterParams(params, activeFilterAttribute, [activeFilterValue]);

        if (term) {
            params.search = term;
        }

        const activeAccountId = typeof window === 'undefined'
            ? 'default'
            : (window.localStorage.getItem('activeAccountId') || 'default');
        const cacheKey = JSON.stringify({ quick_setup: true, account_id: activeAccountId, ...params });
        const cachedProducts = productQuickSetupCacheRef.current.get(cacheKey);
        if (cachedProducts) {
            setProductQuickSetupProducts(cachedProducts);
            return;
        }

        productQuickSetupAbortRef.current?.abort();
        const controller = new AbortController();
        productQuickSetupAbortRef.current = controller;

        try {
            const response = await productApi.getAll(params, controller.signal);
            if (controller.signal.aborted) return;

            const nextProducts = Array.isArray(response.data.data)
                ? buildProductQuickSetupEntries(response.data.data)
                : [];
            productQuickSetupCacheRef.current.set(cacheKey, nextProducts);
            setProductQuickSetupProducts(nextProducts);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
            console.error('Error fetching quick setup products', error);
            setProductQuickSetupProducts([]);
        } finally {
            if (productQuickSetupAbortRef.current === controller) {
                productQuickSetupAbortRef.current = null;
            }
        }
    }, [
        activeProductQuickFilterAttribute,
        normalizedProductQuickFilterValues,
    ]);

    const quickModeSearchEntries = useMemo(
        () => buildStoredQuickSetupSearchEntries(activeProductQuickSetupItems),
        [activeProductQuickSetupItems]
    );

    const rankedSearchProducts = useMemo(() => {
        const searchableEntries = isProductQuickModeActive
            ? quickModeSearchEntries
            : buildProductSearchEntries(products, {
                includeNested: Boolean(searchTerm.trim()) || hasActiveProductBundleQuickFilter,
            });
        const preparedProducts = searchableEntries
            .filter((product) => (
                hasActiveProductBundleQuickFilter
                    ? productMatchesBundleQuickFilterCriteria(product, activeProductBundleQuickFilterCriteria)
                    : true
            ))
            .map((product) => ({
                ...product,
                __alreadyInOrder: isSearchEntryAlreadyInOrder(formData.items, product),
            }))
            .filter((product) => (
                isProductQuickModeActive
                    ? buildOrderItemsFromSearchEntry(product).length > 0
                    : canAddSearchEntry(formData.items, product)
            ));

        if (!searchTerm.trim()) {
            return preparedProducts.slice(0, 50);
        }

        return preparedProducts
            .map((product) => ({
                ...product,
                __searchScore: scoreProductSearchResult(product, searchTerm)
            }))
            .filter((product) => product.__searchScore > 0)
            .sort((left, right) => (
                right.__searchScore - left.__searchScore
                || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
            ))
            .slice(0, 50);
    }, [
        activeProductBundleQuickFilterCriteria,
        formData.items,
        hasActiveProductBundleQuickFilter,
        isProductQuickModeActive,
        products,
        quickModeSearchEntries,
        searchTerm,
    ]);

    useEffect(() => {
        const timerId = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            clearTimeout(timerId);
        };
    }, [searchTerm]);

    useEffect(() => {
        const timerId = setTimeout(() => {
            setDebouncedProductQuickSetupSearchTerm(productQuickSetupSearchTerm);
        }, 250);

        return () => {
            clearTimeout(timerId);
        };
    }, [productQuickSetupSearchTerm]);

    useEffect(() => {
        if (isProductQuickModeActive) return;

        if (showSearchDropdown || debouncedSearchTerm.trim() !== '' || hasActiveProductQuickFilter) {
            fetchProducts(debouncedSearchTerm);
        }
    }, [
        fetchProducts,
        debouncedSearchTerm,
        hasActiveProductQuickFilter,
        isProductQuickModeActive,
        productQuickFilterAttributeId,
        normalizedProductQuickFilterValues,
        showSearchDropdown
    ]);

    useEffect(() => {
        if (!hasActiveProductQuickFilter) {
            productQuickFilterScopeAbortRef.current?.abort();
            setProductQuickFilterScopeProducts([]);
            setProductQuickFilterScopeKey('');
            return;
        }

        const shouldFetchScope = Boolean(
            showSearchDropdown
            || showProductQuickSetupPanel
            || productQuickFilterAttributeId2
            || normalizedProductQuickFilterValues2[0]
        );
        if (!shouldFetchScope) return;

        fetchProductQuickFilterScopeProducts();
    }, [
        fetchProductQuickFilterScopeProducts,
        hasActiveProductQuickFilter,
        normalizedProductQuickFilterValues2,
        productQuickFilterAttributeId2,
        showProductQuickSetupPanel,
        showSearchDropdown,
    ]);

    useEffect(() => {
        if (!showProductQuickSetupPanel || !hasActiveProductQuickFilter) {
            setProductQuickSetupProducts([]);
            return;
        }

        fetchProductQuickSetupProducts(debouncedProductQuickSetupSearchTerm);
    }, [
        debouncedProductQuickSetupSearchTerm,
        fetchProductQuickSetupProducts,
        hasActiveProductQuickFilter,
        showProductQuickSetupPanel,
    ]);

    useEffect(() => {
        if (!showSearchDropdown || debouncedSearchTerm.trim().length < 2) return;
        pushSearchHistory(debouncedSearchTerm);
    }, [debouncedSearchTerm, pushSearchHistory, showSearchDropdown]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            window.localStorage.setItem(productQuickSetupStorageKey, JSON.stringify(productQuickSetupStore));
        } catch (error) {
            console.error('Unable to persist product quick setup store', error);
        }
    }, [productQuickSetupStore]);

    useEffect(() => {
        if (!hasActiveProductQuickFilter) {
            lastVisitedProductQuickSetupKeyRef.current = '';
            setProductQuickModeEnabled(false);
            setShowProductQuickSetupPanel(false);
            setProductQuickSetupSearchTerm('');
            setProductQuickSetupProducts([]);
            return;
        }

        if (lastVisitedProductQuickSetupKeyRef.current !== activeProductQuickSetupKey) {
            lastVisitedProductQuickSetupKeyRef.current = activeProductQuickSetupKey;
            setProductQuickModeEnabled((prev) => prev && activeProductQuickSetupItems.length > 0);
            setShowProductQuickSetupPanel(false);
            return;
        }

        if (productQuickModeEnabled && activeProductQuickSetupItems.length === 0) {
            setProductQuickModeEnabled(false);
        }
    }, [
        activeProductQuickSetupItems.length,
        activeProductQuickSetupKey,
        hasActiveProductQuickFilter,
        productQuickModeEnabled,
    ]);

    useEffect(() => {
        setProductQuickSetupSearchTerm('');
        setProductQuickSetupProducts([]);
    }, [activeProductQuickSetupKey]);

    useEffect(() => {
        if (activeProductQuickSetupItems.length === 0) return;

        let isDisposed = false;

        const refreshActiveQuickSetupItems = async () => {
            try {
                const response = await productApi.refreshOrderItems({
                    items: activeProductQuickSetupItems.map((item) => ({
                        product_id: item.product_id,
                        sku: item.sku,
                        name: item.name,
                    }))
                });

                if (isDisposed) return;

                const refreshedItems = Array.isArray(response.data?.items) ? response.data.items : [];
                if (refreshedItems.length === 0) return;

                syncLatestProductsIntoLocalSources(
                    new Map(refreshedItems.map((item) => [Number(item.product_id), item]))
                );
            } catch (error) {
                if (!isDisposed) {
                    console.error('Error refreshing quick setup products', error);
                }
            }
        };

        refreshActiveQuickSetupItems();

        return () => {
            isDisposed = true;
        };
    }, [activeProductQuickSetupItems, syncLatestProductsIntoLocalSources]);

    useEffect(() => () => {
        productSearchAbortRef.current?.abort();
        productQuickFilterScopeAbortRef.current?.abort();
        productQuickSetupAbortRef.current?.abort();
    }, []);

    const fetchOrderAiTrainingRules = useCallback(async () => {
        setOrderAiTrainingRulesLoading(true);

        try {
            let currentPage = 1;
            let lastPage = 1;
            const nextRules = [];

            do {
                const response = await orderAiTrainingApi.getAll({ page: currentPage, per_page: 100 });
                const payload = response.data || {};
                const pageItems = Array.isArray(payload.data) ? payload.data : [];

                nextRules.push(...pageItems);
                lastPage = Math.max(1, Number(payload.last_page || 1));
                currentPage += 1;
            } while (currentPage <= lastPage);

            setOrderAiTrainingRules(nextRules);
        } catch (error) {
            console.error('Error fetching AI training rules for quick select', error);
            setOrderAiTrainingRules([]);
        } finally {
            setOrderAiTrainingRulesLoading(false);
        }
    }, []);

    const fetchInitialData = useCallback(async () => {
        try {
            const [response, aiRulesResponse] = await Promise.all([
                orderApi.getBootstrapCached({ mode: 'form' }),
                orderApi.getAiRules().catch(() => ({ data: { rules: [] } })),
            ]);
            const bootstrap = response.data || {};

            setOrderStatuses(bootstrap.order_statuses || []);
            setAttributes(bootstrap.order_attributes || []);
            setProductQuickFilterAttributes(buildProductQuickFilterAttributes(bootstrap.product_attributes || []));
            setQuoteSettings((prev) => ({ ...prev, ...(bootstrap.quote_settings || {}) }));
            setQuoteTemplates(sortQuoteTemplates(bootstrap.quote_templates || []));
            setOrderAiRules(normalizeOrderAiRules(aiRulesResponse?.data?.rules || []));
        } catch (error) {
            setProductQuickFilterAttributes([]);
            setOrderAiRules([]);
            console.error("Error fetching order form bootstrap", error);
        }
    }, []);

    const refreshQuoteBootstrap = useCallback(async () => {
        const response = await orderApi.getBootstrap({ mode: 'form' });
        const bootstrap = response.data || {};
        const nextQuoteTemplates = sortQuoteTemplates(bootstrap.quote_templates || []);

        setQuoteSettings((prev) => ({ ...prev, ...(bootstrap.quote_settings || {}) }));
        setQuoteTemplates(nextQuoteTemplates);

        return nextQuoteTemplates;
    }, []);

    const fetchOrder = async (targetId, isDuplicating = false) => {
        try {
            setLoading(true);
            const response = await orderApi.getOneCached(targetId);
            const order = response.data;
            const nextOrderKind = getNormalizedOrderKind(order.order_kind);
            const nextOrderType = normalizeOrderType(order.order_type);

            const customAttrValues = {};
            order.attribute_values?.forEach(av => {
                const code = av.attribute?.code;
                if (code) {
                    try {
                        customAttrValues[code] = JSON.parse(av.value);
                    } catch (e) {
                        customAttrValues[code] = av.value;
                    }
                }
            });

            setOrderKind(isDuplicating ? requestedOrderKind : nextOrderKind);
            setRegionType(order.district ? 'old' : 'new');
            const shouldUseCurrentProductCost = isDuplicating && requestedOrderKind === MAIN_ORDER_KIND;
            const mappedItems = order.items?.map(item => ({
                product_id: item.product_id,
                actual_product_id: !isDuplicating && hasActualOrderProductOverride(item) ? item.actual_product_id : null,
                name: resolveOrderLineItemDisplayName({
                    name: item.product_name_snapshot || item.product?.name || `Sản phẩm #${item.product_id}`,
                    options: item.options || {},
                    fallbackName: item.product?.name || `Sản phẩm #${item.product_id}`,
                }),
                sku: item.product_sku_snapshot || item.product?.sku || `N/A`,
                unit_name: resolveOrderUnitLabel(item, item?.product),
                quantity: parseMoneyNumber(item.quantity, 0) || 0,
                price: parseMoneyNumber(item.price, 0) || 0,
                cost_price: resolveOrderItemCostPrice(item, shouldUseCurrentProductCost)
            })) || [];
            const normalizedMappedItems = order.items?.map((item, index) => createOrderLineItem({
                line_id: item?.id ? `saved-${item.id}` : `saved-${Number(item?.product_id) || 0}-${index + 1}`,
                product_id: item.product_id,
                actual_product_id: !isDuplicating && hasActualOrderProductOverride(item) ? item.actual_product_id : null,
                name: resolveOrderLineItemDisplayName({
                    name: item.product_name_snapshot || item.product?.name || `Sản phẩm #${item.product_id}`,
                    options: item.options || {},
                    fallbackName: item.product?.name || `Sản phẩm #${item.product_id}`,
                }),
                sku: item.product_sku_snapshot || item.product?.sku || 'N/A',
                actual_name: !isDuplicating && hasActualOrderProductOverride(item)
                    ? getOrderItemActualDisplayName(item, item?.actual_product_name_snapshot || '')
                    : '',
                actual_sku: !isDuplicating && hasActualOrderProductOverride(item)
                    ? getOrderItemActualDisplaySku(item, item?.actual_product_sku_snapshot || '')
                    : '',
                actual_snapshot_name: !isDuplicating && hasActualOrderProductOverride(item)
                    ? (item.actual_product_name_snapshot || getOrderItemActualDisplayName(item, ''))
                    : '',
                actual_snapshot_sku: !isDuplicating && hasActualOrderProductOverride(item)
                    ? (item.actual_product_sku_snapshot || getOrderItemActualDisplaySku(item, ''))
                    : '',
                unit_name: resolveOrderUnitLabel(item, item?.product),
                sort_order: Number(item.sort_order) || index + 1,
                quantity: parseMoneyNumber(item.quantity, 0) || 0,
                price: parseMoneyNumber(item.price, 0) || 0,
                cost_price: resolveOrderItemCostPrice(item, shouldUseCurrentProductCost),
                base_cost_price: resolveRoundedImportCostValue(
                    item?.ordered_current_cost_price,
                    item?.product?.cost_price ?? item?.product?.expected_cost ?? item?.cost_price ?? 0
                ),
                options: item.options || {},
                category_id: item.product?.category_id,
                parent_product_id: Number(item.options?.variant_parent_id ?? item.product?.parent_id) || undefined,
                product_attributes: item.product?.attributes_map || item.product?.product_attributes || buildProductAttributesMap(item.product),
            })) || [];
            const resolvedLoadedItems = order.items?.map((item, index) => {
                const fallbackName = `San pham #${item.product_id}`;
                const displayName = resolveOrderLineItemDisplayName({
                    name: getOrderItemDisplayName(item, fallbackName),
                    options: item.options || {},
                    fallbackName,
                });
                const displaySku = getOrderItemDisplaySku(item, 'N/A');
                const snapshotName = resolveOrderLineItemDisplayName({
                    name: getOrderItemSnapshotName(item) || displayName,
                    options: item.options || {},
                    fallbackName: displayName,
                });
                const snapshotSku = getOrderItemSnapshotSku(item) || displaySku;

                return createOrderLineItem({
                    line_id: item?.id ? `saved-${item.id}` : `saved-${Number(item?.product_id) || 0}-${index + 1}`,
                    product_id: item.product_id,
                    actual_product_id: !isDuplicating && hasActualOrderProductOverride(item) ? item.actual_product_id : null,
                    name: displayName,
                    sku: displaySku,
                    snapshot_name: snapshotName,
                    snapshot_sku: snapshotSku,
                    actual_name: !isDuplicating && hasActualOrderProductOverride(item)
                        ? getOrderItemActualDisplayName(item, item?.actual_product_name_snapshot || '')
                        : '',
                    actual_sku: !isDuplicating && hasActualOrderProductOverride(item)
                        ? getOrderItemActualDisplaySku(item, item?.actual_product_sku_snapshot || '')
                        : '',
                    actual_snapshot_name: !isDuplicating && hasActualOrderProductOverride(item)
                        ? (item.actual_product_name_snapshot || getOrderItemActualDisplayName(item, ''))
                        : '',
                    actual_snapshot_sku: !isDuplicating && hasActualOrderProductOverride(item)
                        ? (item.actual_product_sku_snapshot || getOrderItemActualDisplaySku(item, ''))
                        : '',
                    unit_name: resolveOrderUnitLabel(item, item?.product),
                    sort_order: Number(item.sort_order) || index + 1,
                    quantity: parseMoneyNumber(item.quantity, 0) || 0,
                    price: parseMoneyNumber(item.price, 0) || 0,
                    cost_price: resolveOrderItemCostPrice(item, shouldUseCurrentProductCost),
                    base_cost_price: resolveRoundedImportCostValue(
                        item?.ordered_current_cost_price,
                        item?.product?.cost_price ?? item?.product?.expected_cost ?? item?.cost_price ?? 0
                    ),
                    options: item.options || {},
                    category_id: item.product?.category_id,
                    parent_product_id: Number(item.options?.variant_parent_id ?? item.product?.parent_id) || undefined,
                    product_attributes: item.product?.attributes_map || item.product?.product_attributes || buildProductAttributesMap(item.product),
                    main_image: item.product?.main_image || item.main_image || '',
                    notes: item.notes || '',
                    replaced_from_name: item.replaced_from_name || '',
                });
            }) || [];
            const mappedSupplementItems = (order.supplement_items || order.supplementItems || []).map((item) => ({
                product_id: item.product_id,
                name: item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`,
                sku: item.product?.sku || item.product_sku_snapshot || 'N/A',
                quantity: parseMoneyNumber(item.quantity, 0) || 0,
                price: parseMoneyNumber(item.price, 0) || 0,
                cost_price: resolveRoundedImportCostValue(item.cost_price, 0),
                notes: item.notes || '',
            }));
            const resolvedSupplementItems = mappedSupplementItems.map((item, index) => {
                const sourceItem = (order.supplement_items || order.supplementItems || [])[index] || {};

                return {
                    ...item,
                    snapshot_name: getOrderItemSnapshotName(sourceItem) || item.name,
                    snapshot_sku: getOrderItemSnapshotSku(sourceItem) || item.sku,
                };
            });
            const mappedCostTotal = calculateItemsCostTotal(resolvedLoadedItems);
            const loadedDiscountState = resolveLoadedDiscountState(
                order,
                nextOrderType,
                resolvedLoadedItems,
                resolvedSupplementItems
            );
            closeActualProductPicker();
            closeOrderAiReplacePicker();
            setShowActualProductSection(false);
            setSelectedOrderLineId('');
            setFormData({
                customer_name: order.customer_name || '',
                customer_email: order.customer_email || '',
                customer_phone: order.customer_phone || '',
                address_detail: extractAddressDetail({
                    shippingAddress: order.shipping_address || '',
                    province: order.province || '',
                    district: order.district || '',
                    ward: order.ward || '',
                    regionType: order.district ? 'old' : 'new'
                }),
                shipping_address: order.shipping_address || '',
                notes: order.notes || '',
                order_type: nextOrderType,
                settlement_delta: isDuplicating ? 0 : (parseMoneyNumber(order.settlement_delta, 0) || 0),
                return_tracking_code: isDuplicating ? '' : (order.return_tracking_code || order.returnTrackingCode || ''),
                return_status: isDuplicating
                    ? SUPPLEMENT_RETURN_STATUS_NOT_RETURNED
                    : normalizeSupplementReturnStatus(order.return_status || order.returnStatus),
                items: resolvedLoadedItems, /*
                    product_id: item.product_id,
                    name: item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`,
                    sku: item.product?.sku || item.product_sku_snapshot || `N/A`,
                    quantity: item.quantity,
                    price: item.price,
                    cost_price: resolveOrderItemCostPrice(item)
                })) || [], */
                supplement_items: resolvedSupplementItems,
                custom_attributes: customAttrValues,
                shipping_fee: isDuplicating ? 0 : (order.shipping_fee || 0),
                display_shipping_fee: isDuplicating ? 0 : resolveDisplayedShippingFee(order),
                shipping_tracking_code: isDuplicating ? '' : resolveOutgoingTrackingCode(order),
                active_shipment: isDuplicating ? null : (order.active_shipment || order.activeShipment || null),
                manual_discount: loadedDiscountState.manualDiscount,
                discount: loadedDiscountState.discount,
                cost_total: order.cost_total || 0,
                status: isDuplicating ? 'new' : (order.status || 'new'),
                source: normalizeOrderSource(
                    order.source,
                    isDuplicating ? DEFAULT_MANUAL_ORDER_SOURCE : UNKNOWN_ORDER_SOURCE
                ),
                type: order.type || 'Lẻ',
                shipment_status: isDuplicating ? 'Chưa giao' : (order.shipment_status || 'Chưa giao'),
                province: order.province || '',
                district: order.district || '',
                ward: order.ward || ''
            });
            setFormData((prev) => ({
                ...prev,
                items: normalizedMappedItems,
                cost_total: mappedCostTotal,
                supplement_items: mappedSupplementItems,
            }));
            setRegionType(order.district ? 'old' : 'new');
            void refreshOrderItemInventorySnapshot(normalizedMappedItems);

        } catch (error) {
            console.error("Error fetching order", error);
            if (error.response?.status === 404) {
                showModal({ title: 'Lỗi', content: 'Đơn hàng không tồn tại hoặc đã bị xóa.', type: 'error' });
            } else {
                showModal({ title: 'Lỗi', content: 'Không thể tải thông tin đơn hàng.', type: 'error' });
            }
            navigate('/admin/orders');
        } finally {
            setLoading(false);
        }
    };

    const fetchLeadDraft = async (targetLeadId) => {
        try {
            setLoading(true);
            const response = await leadApi.getOrderDraft(targetLeadId);
            const draft = response.data || {};

            if (draft.can_create_order === false) {
                showModal({
                    title: 'Không thể mở lead',
                    content: 'Lead này đã ở trạng thái Đã tạo đơn nên không mở lại form tạo đơn.',
                    type: 'warning'
                });
                navigateBack();
                return;
            }

            setLeadConversionSummary(draft.conversion_summary || null);
            const draftItems = (draft.items || []).map((item) => ({
                product_id: item.product_id,
                name: item.name || item.product_name || `Sản phẩm #${item.product_id}`,
                sku: item.sku || item.product_sku || 'N/A',
                quantity: normalizeOrderLineQuantity(item.quantity),
                price: Number(item.price) || 0,
                cost_price: resolveProductCostPrice(item),
                options: item.options || {}
            }));
            const normalizedDraftItems = (draft.items || []).map((item, index) => createOrderLineItem({
                line_id: `lead-draft-${Number(item?.product_id) || 0}-${index + 1}`,
                product_id: item.product_id,
                name: item.name || item.product_name || `Sản phẩm #${item.product_id}`,
                sku: item.sku || item.product_sku || 'N/A',
                unit_name: resolveOrderUnitLabel(item, item?.product),
                quantity: normalizeOrderLineQuantity(item.quantity),
                price: Number(item.price) || 0,
                cost_price: resolveProductCostPrice(item),
                base_cost_price: resolveProductCostPrice(item),
                computed_stock: item.computed_stock,
                pending_export_quantity: item.pending_export_quantity,
                available_to_sell: item.available_to_sell,
                category_id: item.category_id || item.product?.category_id,
                options: item.options || {},
                main_image: item.main_image || item.product_image || '',
                notes: item.notes || '',
                replaced_from_name: item.replaced_from_name || '',
            }));
            void draftItems;
            const draftCostTotal = calculateItemsCostTotal(normalizedDraftItems);
            closeActualProductPicker();
            closeOrderAiReplacePicker();
            setShowActualProductSection(false);
            setSelectedOrderLineId('');

            setFormData((prev) => syncShippingAddress({
                ...prev,
                customer_name: draft.customer_name || '',
                customer_email: draft.customer_email || '',
                customer_phone: draft.customer_phone || '',
                address_detail: extractAddressDetail({
                    shippingAddress: draft.shipping_address || '',
                    province: draft.province || '',
                    district: draft.district || '',
                    ward: draft.ward || '',
                    regionType: draft.district ? 'old' : 'new'
                }),
                shipping_address: draft.shipping_address || '',
                district: draft.district || '',
                ward: draft.ward || '',
                province: draft.province || '',
                source: normalizeOrderSource(draft.source, UNKNOWN_ORDER_SOURCE),
                order_type: ORDER_TYPE_STANDARD,
                settlement_delta: 0,
                return_tracking_code: '',
                return_status: SUPPLEMENT_RETURN_STATUS_NOT_RETURNED,
                type: draft.type || 'Lẻ',
                shipment_status: draft.shipment_status || 'Chưa giao',
                notes: draft.notes || '',
                items: normalizedDraftItems,
                supplement_items: [],
                custom_attributes: draft.custom_attributes || {},
                shipping_fee: Number(draft.shipping_fee) || 0,
                display_shipping_fee: resolveDisplayedShippingFee(draft),
                shipping_tracking_code: resolveOutgoingTrackingCode(draft),
                active_shipment: draft.active_shipment || draft.activeShipment || null,
                manual_discount: parseMoneyNumber(draft.manual_discount, parseMoneyNumber(draft.discount, 0) || 0) || 0,
                discount: parseMoneyNumber(draft.discount, 0) || 0,
                cost_total: draftCostTotal,
                status: draft.status || 'new'
            }));
            setRegionType(draft.district ? 'old' : 'new');
            void refreshOrderItemInventorySnapshot(normalizedDraftItems);
        } catch (error) {
            console.error('Error fetching lead draft', error);
            showModal({
                title: 'Lỗi',
                content: 'Không thể tải dữ liệu lead để tạo đơn.',
                type: 'error'
            });
            navigateBack();
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInitialData();
        if (isEdit) {
            fetchOrder(id);
        } else if (duplicateFromId) {
            fetchOrder(duplicateFromId, true);
        } else if (leadId) {
            fetchLeadDraft(leadId);
        } else {
            setLoading(false);
        }
    }, [duplicateFromId, fetchInitialData, id, isEdit, leadId]);

    useEffect(() => {
        fetchOrderAiTrainingRules();
    }, [fetchOrderAiTrainingRules]);

    useEffect(() => {
        if (!orderAiSelectedRuleKey) return;
        if (orderAiQuickRuleOptions.some((option) => option.value === orderAiSelectedRuleKey)) return;

        setOrderAiSelectedRuleKey('');
    }, [orderAiQuickRuleOptions, orderAiSelectedRuleKey]);

    function buildOrderMutationPayload(submitOrderKind = null) {
        const normalizedOrderKind = getNormalizedOrderKind(submitOrderKind || orderKind);
        const isMainOrder = !isDraftOrderKind(normalizedOrderKind);

        const normalizedAddressDetail = extractAddressDetail({
            shippingAddress: formData.shipping_address.trim(),
            ward: formData.ward,
            district: formData.district,
            province: formData.province,
            regionType
        });
        const effectiveAddressDetail = normalizedAddressDetail || formData.address_detail.trim() || formData.shipping_address.trim();
        const trimmedCustomerName = String(formData.customer_name || '').trim();
        const trimmedCustomerPhone = String(formData.customer_phone || '').trim();

        if (isMainOrder && !effectiveAddressDetail) {
            alert('Vui lòng nhập địa chỉ giao hàng.');
            return null;
        }

        if (!isMainOrder && !trimmedCustomerName && !trimmedCustomerPhone) {
            alert('Vui lòng nhập tên khách hàng hoặc số điện thoại cho đơn nháp.');
            return null;
        }

        if (trimmedCustomerPhone && !validateVietnamesePhone(trimmedCustomerPhone)) {
            alert('Số điện thoại không hợp lệ.');
            return null;
        }

        const normalizedSupplementItems = specialOrderType
            ? (Array.isArray(formData.supplement_items) ? formData.supplement_items : []).map((item) => ({
                product_id: Number(item.product_id) || 0,
                quantity: Math.max(0, Number(item.quantity) || 0),
                price: Math.max(0, Number(item.price) || 0),
                cost_price: resolveRoundedImportCostValue(item.cost_price, 0),
                name: item.snapshot_name || item.name || '',
                sku: item.snapshot_sku || item.sku || '',
                notes: item.notes || '',
            })).filter((item) => item.product_id && item.quantity > 0)
            : [];

        const normalizedItems = (Array.isArray(formData.items) ? formData.items : [])
            .map((item, index) => ({
                product_id: Number(item.product_id) || 0,
                actual_product_id: hasActualOrderProductOverride(item) ? (Number(item.actual_product_id) || 0) : undefined,
                sort_order: index + 1,
                quantity: Math.max(0, Number(item.quantity) || 0),
                price: Math.max(0, Number(item.price) || 0),
                cost_price: resolveRoundedImportCostValue(item.cost_price, 0),
                name: item.snapshot_name || item.name || '',
                sku: item.snapshot_sku || item.sku || '',
                actual_name: hasActualOrderProductOverride(item)
                    ? (item.actual_snapshot_name || item.actual_name || '')
                    : undefined,
                actual_sku: hasActualOrderProductOverride(item)
                    ? (item.actual_snapshot_sku || item.actual_sku || '')
                    : undefined,
                options: item.options && typeof item.options === 'object' && Object.keys(item.options).length > 0
                    ? item.options
                    : undefined,
            }))
            .filter((item) => item.product_id && item.quantity > 0);

        const submittedDiscount = resolveSignedMoneyInputCommitValue(
            discountInputValue,
            parseMoneyNumber(formData.discount, 0) || 0
        );

        return {
            normalizedOrderKind,
            payload: {
                ...formData,
                customer_name: trimmedCustomerName,
                customer_phone: trimmedCustomerPhone,
                shipping_fee: parseMoneyNumber(formData.shipping_fee, 0) || 0,
                manual_discount: calculateManualDiscountValue(
                    submittedDiscount,
                    normalizedOrderType,
                    formData.supplement_items
                ),
                discount: submittedDiscount,
                source: normalizeOrderSource(formData.source, DEFAULT_MANUAL_ORDER_SOURCE),
                items: normalizedItems,
                order_kind: normalizedOrderKind,
                order_type: normalizedOrderType,
                settlement_delta: specialOrderType ? (parseMoneyNumber(formData.settlement_delta, 0) || 0) : 0,
                return_tracking_code: specialOrderType ? String(formData.return_tracking_code || '').trim() : '',
                return_status: specialOrderType
                    ? normalizeSupplementReturnStatus(formData.return_status)
                    : SUPPLEMENT_RETURN_STATUS_NOT_RETURNED,
                supplement_items: normalizedSupplementItems,
                region_type: regionType,
                lead_id: leadId ? Number(leadId) : undefined,
                address_detail: effectiveAddressDetail,
                shipping_address: isMainOrder
                    ? buildShippingAddress({
                        addressDetail: effectiveAddressDetail,
                        ward: formData.ward,
                        district: formData.district,
                        province: formData.province,
                        regionType
                    })
                    : (formData.shipping_address || effectiveAddressDetail || ''),
                custom_attributes: {
                    ...formData.custom_attributes,
                    region_type: regionType === 'new' ? 'Địa giới mới' : 'Địa giới cũ',
                    full_region_path: buildRegionPath({
                        ward: formData.ward,
                        district: formData.district,
                        province: formData.province,
                        regionType
                    })
                }
            }
        };
    }

    const handleConvertCurrentOrder = async (targetKind) => {
        if (!id) return;

        const mutation = buildOrderMutationPayload(targetKind);
        if (!mutation) return;

        try {
            setSaving(true);
            const normalizedTargetKind = mutation.normalizedOrderKind;
            const response = await orderApi.convert(id, {
                ...mutation.payload,
                target_kind: normalizedTargetKind,
            });
            const convertedOrder = response?.data;
            if (convertedOrder?.id) {
                const savedOrderKind = getNormalizedOrderKind(convertedOrder.order_kind || normalizedTargetKind);
                setOrderKind(savedOrderKind);
                navigate(buildOrderListUrl(savedOrderKind));
            }
        } catch (error) {
            alert(error.response?.data?.message || 'Không thể chuyển loại đơn hiện tại.');
        } finally {
            setSaving(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'address_detail') {
            setAddressDetection(null);
            setFormData(prev => syncShippingAddress({ ...prev, address_detail: value }));
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleOrderTypeChange = (event) => {
        const nextOrderType = normalizeOrderType(event.target.value);

        setFormData((prev) => ({
            ...prev,
            order_type: nextOrderType,
        }));
    };

    const handleSettlementDeltaChange = (event) => {
        const numericValue = Number(event.target.value);
        setFormData((prev) => ({
            ...prev,
            settlement_delta: Number.isFinite(numericValue) ? numericValue : 0,
        }));
    };
    const handleDiscountInputChange = (event) => {
        const rawValue = event.target.value;
        const selectionStart = event.target.selectionStart ?? rawValue.length;
        const digitCountBeforeCaret = rawValue.slice(0, selectionStart).replace(/[^0-9]/g, '').length;
        const normalizedValue = normalizeSignedMoneyInputValue(rawValue);
        const nextCaretPosition = resolveFormattedMoneyCaretPosition(normalizedValue, digitCountBeforeCaret);

        setDiscountInputValue(normalizedValue);
        window.requestAnimationFrame(() => {
            const input = discountInputRef.current;
            if (!input || document.activeElement !== input) {
                return;
            }

            input.setSelectionRange(nextCaretPosition, nextCaretPosition);
        });
    };
    const handleDiscountInputBlur = () => {
        const nextDiscount = resolveSignedMoneyInputCommitValue(
            discountInputValue,
            calculateEffectiveDiscountValue(
                formData.manual_discount,
                formData.order_type,
                formData.supplement_items
            )
        );
        const nextManualDiscount = calculateManualDiscountValue(
            nextDiscount,
            formData.order_type,
            formData.supplement_items
        );

        setFormData((prev) => (
            prev.discount === nextDiscount && prev.manual_discount === nextManualDiscount
                ? prev
                : {
                    ...prev,
                    manual_discount: nextManualDiscount,
                    discount: nextDiscount,
                }
        ));
        setDiscountInputValue(formatSignedMoneyInputValue(nextDiscount));
    };

    const handleShippingAddressChange = (e) => {
        const value = e.target.value;
        setAddressDetection(null);
        setFormData(prev => ({
            ...prev,
            shipping_address: value,
            address_detail: value
        }));
    };

    const handleShippingAddressPaste = (e) => {
        const pastedText = e.clipboardData.getData('text');
        if (!pastedText) return;

        const target = e.currentTarget;
        window.requestAnimationFrame(() => {
            detectAdministrativeAddress(target.value);
        });
    };

    const handleShippingAddressBlur = (e) => {
        detectAdministrativeAddress(e.target.value);
    };

    const hydrateMissingProductCostSnapshot = useCallback(async (product) => {
        const targetProductId = parseInt(product?.target_product_id ?? product?.product_id ?? product?.id, 10);
        if (!targetProductId) return;

        try {
            const response = await productApi.refreshOrderItems({
                items: [{
                    product_id: targetProductId,
                    sku: product?.display_sku || product?.sku || '',
                    name: product?.display_name || product?.name || '',
                }]
            });

            applyLatestProductsToOrderState(response.data?.items);
        } catch (error) {
            console.error('Error hydrating product cost snapshot', error);
        }
    }, [applyLatestProductsToOrderState]);

    const appendProductToOrder = useCallback((product, options = {}) => {
        const itemsToAppend = buildOrderItemsFromSearchEntry(product);
        if (itemsToAppend.length === 0) return;
        const entryKind = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT);

        if (options.trackSearch && searchTerm.trim()) {
            pushSearchHistory(searchTerm);
        }

        setFormData((prev) => {
            const nextItems = appendOrderItemsWithMerge(prev.items, itemsToAppend, {
                incrementExisting: entryKind === SEARCH_ENTRY_BUNDLE_OPTION,
            });

            if (nextItems.length === prev.items.length) {
                return prev; /*
                name: product?.display_name || product?.name || `Sản phẩm #${targetProductId}`,
            */ }
            const costTotal = calculateItemsCostTotal(nextItems);

            return {
                ...prev,
                items: nextItems,
                cost_total: costTotal,
            };
        });

        setShowSearchHistory(false);

        // Always re-sync from the dedicated refresh endpoint after appending.
        // Search/picker results can come from stale in-memory caches, so trusting
        // embedded snapshots here is what leaves "Có thể bán" out of sync.
        void refreshOrderItemInventorySnapshot(itemsToAppend);

        if (entryKind !== SEARCH_ENTRY_BUNDLE_OPTION && !hasProductCostSnapshot(product)) {
            hydrateMissingProductCostSnapshot(product);
        }
    }, [hydrateMissingProductCostSnapshot, pushSearchHistory, refreshOrderItemInventorySnapshot, searchTerm]);

    const addProductById = useCallback((product) => {
        if (!product) return;
        appendProductToOrder(product, { trackSearch: true });
        // Keep search term and dropdown open for consecutive selections
    }, [appendProductToOrder]);

    const updateItem = React.useCallback((index, field, value) => {
        setFormData(prev => {
            const newItems = [...prev.items];
            const nextValue = field === 'cost_price'
                ? resolveRoundedImportCostValue(value, 0)
                : value;
            const currentItem = newItems[index] || {};
            newItems[index] = field === 'cost_price' && !hasActualOrderProductOverride(currentItem)
                ? { ...currentItem, cost_price: nextValue, base_cost_price: nextValue }
                : { ...currentItem, [field]: nextValue };
            const costTotal = calculateItemsCostTotal(newItems);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, []);

    const removeItem = React.useCallback((lineId) => {
        setSelectedOrderLineId((prev) => (
            normalizeCanvasText(prev) === normalizeCanvasText(lineId) ? '' : prev
        ));
        setFormData(prev => {
            const newItems = applySequentialOrderLineSortOrder(prev.items.filter(item => item.line_id !== lineId));
            const costTotal = calculateItemsCostTotal(newItems);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, []);

    const handleRemoveAllItems = useCallback(() => {
        if (formData.items.length === 0) {
            return;
        }

        showModal({
            title: 'Xóa toàn bộ sản phẩm?',
            content: 'Thao tác này sẽ xóa toàn bộ dòng sản phẩm hiện có trong đơn.<br/>Bạn sẽ không thể khôi phục tự động sau khi xác nhận.',
            type: 'warning',
            actionText: 'Xóa tất cả',
            onAction: () => {
                closeOrderAiReplacePicker();
                closeActualProductPicker();
                setShowActualProductSection(false);
                setShowOrderAiInputReviewModal(false);
                setOrderAiLastRun(null);
                setSelectedOrderLineId('');
                setFormData((prev) => ({
                    ...prev,
                    items: [],
                    cost_total: 0,
                }));
                showTransientNotification('success', 'Đã xóa toàn bộ sản phẩm trong đơn.');
            },
        });
    }, [closeActualProductPicker, closeOrderAiReplacePicker, formData.items.length, showModal, showTransientNotification]);

    const pendingOrderAiItems = useMemo(
        () => formData.items.filter((item) => isPendingOrderAiItem(item)),
        [formData.items]
    );
    const confirmedOrderAiItems = useMemo(
        () => formData.items.filter((item) => isOrderAiItem(item) && !isPendingOrderAiItem(item)),
        [formData.items]
    );
    const hasLatestOrderAiInput = Boolean(
        normalizeCanvasText(orderAiLastRun?.input?.text)
        || normalizeCanvasText(orderAiLastRun?.input?.image_preview_url)
        || normalizeCanvasText(orderAiLastRun?.input?.file_name)
        || normalizeCanvasText(orderAiLastRun?.input?.preferred_rule_label)
    );
    const canClearLatestOrderAiRun = Boolean(
        normalizeCanvasText(orderAiLastRun?.sessionId)
        || (Array.isArray(orderAiLastRun?.sessionLineIds)
            && orderAiLastRun.sessionLineIds.some((lineId) => normalizeCanvasText(lineId)))
    );
    const shouldShowOrderAiSummary = pendingOrderAiItems.length > 0 || Boolean(orderAiLastRun);
    const handleConfirmPendingOrderAiItems = useCallback(() => {
        if (pendingOrderAiItems.length === 0) return;

        const confirmedAt = new Date().toISOString();
        setFormData((prev) => ({
            ...prev,
            items: prev.items.map((item) => (
                isPendingOrderAiItem(item)
                    ? {
                        ...item,
                        ai_meta: {
                            ...item.ai_meta,
                            review_state: 'confirmed',
                            confirmed_at: confirmedAt,
                        },
                    }
                    : item
            )),
        }));
        setOrderAiLastRun((prev) => (
            prev
                ? {
                    ...prev,
                    reviewCount: 0,
                }
                : prev
        ));
        showTransientNotification('success', `Đã xác nhận nhanh ${pendingOrderAiItems.length} dòng AI.`);
    }, [pendingOrderAiItems.length, showTransientNotification]);

    const normalizedOrderType = normalizeOrderType(formData.order_type);
    const orderTypeMeta = getOrderTypeMeta(normalizedOrderType);
    const specialOrderType = isSpecialOrderType(normalizedOrderType);
    const outgoingTrackingCode = resolveOutgoingTrackingCode(formData);
    const defaultReturnTrackingCode = buildDefaultReturnTrackingCode(normalizedOrderType, outgoingTrackingCode);
    const quotePricingSummary = buildOrderPricingSummary(formData);
    const subtotalAmount = quotePricingSummary.subtotal;
    const totalPaymentAmount = quotePricingSummary.totalPayment;
    const costTotalAmount = parseMoneyNumber(formData.cost_total, 0) || 0;
    const baseGrossProfitAmount = calculateGrossProfitTotal(totalPaymentAmount, costTotalAmount);
    const supplementItemsTotal = calculateSupplementItemsTotal(formData.supplement_items);
    const supplementItemsCostTotal = calculateSupplementItemsCostTotal(formData.supplement_items);
    const settlementDeltaAmount = parseMoneyNumber(formData.settlement_delta, 0) || 0;
    const reportRevenueTotal = normalizedOrderType === ORDER_TYPE_EXCHANGE_RETURN
        ? (quotePricingSummary.reportRevenueTotal ?? totalPaymentAmount)
        : (normalizedOrderType === ORDER_TYPE_PARTIAL_DELIVERY
            ? (totalPaymentAmount + settlementDeltaAmount)
            : totalPaymentAmount);
    const reportCostTotal = specialOrderType
        ? (costTotalAmount - supplementItemsCostTotal)
        : costTotalAmount;
    const reportProfitTotal = reportRevenueTotal - reportCostTotal;
    const grossProfitAmount = specialOrderType
        ? reportProfitTotal
        : baseGrossProfitAmount;
    const supplementDeclarationCount = Array.isArray(formData.supplement_items)
        ? formData.supplement_items.length
        : 0;
    const supplementDeclarationSkus = collectSupplementDeclarationCodes(formData.supplement_items);
    const supplementDeclarationSkuSummary = buildCompactSupplementCodeSummary(supplementDeclarationSkus);
    const supplementDeclarationSkuTitle = supplementDeclarationSkus.join(', ');
    const normalizedSupplementReturnStatus = normalizeSupplementReturnStatus(formData.return_status);
    const supplementReturnStatusLabel = getSupplementReturnStatusLabel(normalizedSupplementReturnStatus);
    const supplementReturnTrackingCode = String(formData.return_tracking_code || '').trim();
    const supplementReturnTrackingSummary = supplementReturnTrackingCode || 'Chưa có';

    useEffect(() => {
        if (!specialOrderType || !defaultReturnTrackingCode) {
            return;
        }

        setFormData((prev) => {
            if (
                !isSpecialOrderType(prev.order_type)
                || String(prev.return_tracking_code || '').trim()
            ) {
                return prev;
            }

            return {
                ...prev,
                return_tracking_code: defaultReturnTrackingCode,
                return_status: normalizeSupplementReturnStatus(prev.return_status),
            };
        });
    }, [specialOrderType, defaultReturnTrackingCode]);

    useEffect(() => {
        if (!specialOrderType) {
            lastAutoOpenedSupplementOrderTypeRef.current = '';
            setShowSupplementItemsModal(false);
        }
    }, [specialOrderType]);

    useEffect(() => {
        if (!shouldAutoOpenSupplementItemsModal(normalizedOrderType)) return;

        if (showSupplementItemsModal) {
            lastAutoOpenedSupplementOrderTypeRef.current = normalizedOrderType;
            return;
        }

        if (lastAutoOpenedSupplementOrderTypeRef.current === normalizedOrderType) return;

        lastAutoOpenedSupplementOrderTypeRef.current = normalizedOrderType;
        setShowSupplementItemsModal(true);
    }, [normalizedOrderType, showSupplementItemsModal]);

    const captureQuoteImage = async (template) => {
        if (!template) return;

        setIsCapturing(true);
        setShowQuoteTemplatePicker(false);

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('CANVAS_CONTEXT_UNAVAILABLE');

            const pageWidth = quoteCanvasPageWidth;
            const headerHeight = 248;
            const tableHeaderHeight = 52;
            const imageColWidth = 260;
            const qtyColWidth = 92;
            const unitColWidth = 108;
            const priceColWidth = 170;
            const totalColWidth = 180;
            const nameColWidth = pageWidth - imageColWidth - qtyColWidth - unitColWidth - priceColWidth - totalColWidth;
            const xName = imageColWidth;
            const xQty = xName + nameColWidth;
            const xUnit = xQty + qtyColWidth;
            const xPrice = xUnit + unitColWidth;
            const xTotal = xPrice + priceColWidth;
            const bodyStartY = headerHeight + tableHeaderHeight;
            const borderColor = '#D7C7B8';
            const borderStrong = '#B79D86';
            const textPrimary = '#1F2937';
            const textMuted = '#7C6A58';
            const brandDark = '#243447';
            const brandGold = '#C8A56A';
            const headerBg = '#FCF8F3';
            const footerBg = '#F6E7C8';
            const imagePanelBg = '#F9F5EF';
            const subtleBg = '#F8F4EE';

            const measureCanvas = document.createElement('canvas');
            const measureCtx = measureCanvas.getContext('2d');
            if (!measureCtx) throw new Error('MEASURE_CONTEXT_UNAVAILABLE');
            measureCtx.font = `15px ${quoteCanvasFontFamily}`;

            const rowHeights = formData.items.map((item) => {
                const lines = wrapCanvasText(measureCtx, item.name || '', nameColWidth - 30);
                return Math.max(48, (lines.length * 18) + 16);
            });

            const itemsHeight = rowHeights.reduce((sum, height) => sum + height, 0);
            const quoteFooterRows = quotePricingSummary.extraRows;
            const footerRowHeight = 34;
            const footerPaddingY = 10;
            const footerHeight = (footerPaddingY * 2) + ((1 + quoteFooterRows.length) * footerRowHeight);
            const pageHeight = headerHeight + tableHeaderHeight + itemsHeight + footerHeight;

            canvas.width = pageWidth * 2;
            canvas.height = pageHeight * 2;
            canvas.style.width = `${pageWidth}px`;
            canvas.style.height = `${pageHeight}px`;
            ctx.scale(2, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageWidth, pageHeight);

            const [logoImage, templateImage] = await Promise.all([
                loadCanvasImage(quoteSettings.quote_logo_url),
                loadCanvasImage(getQuoteTemplateImageUrl(template))
            ]);

            ctx.direction = 'ltr';
            ctx.fillStyle = headerBg;
            ctx.fillRect(0, 0, pageWidth, headerHeight);
            ctx.fillStyle = brandDark;
            ctx.fillRect(0, 0, pageWidth, 18);
            ctx.fillStyle = brandGold;
            ctx.fillRect(0, 18, pageWidth, 4);

            ctx.strokeStyle = borderStrong;
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, pageWidth - 1, pageHeight - 1);

            const logoCardX = 34;
            const logoCardY = 44;
            const logoCardSize = 176;

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#E6D7C9';
            ctx.lineWidth = 1;
            ctx.fillRect(logoCardX, logoCardY, logoCardSize, logoCardSize);
            ctx.strokeRect(logoCardX, logoCardY, logoCardSize, logoCardSize);

            if (logoImage) {
                drawImageContain(ctx, logoImage, logoCardX + 16, logoCardY + 16, logoCardSize - 32, logoCardSize - 32);
            } else {
                ctx.fillStyle = '#F8F2E8';
                ctx.beginPath();
                ctx.arc(logoCardX + (logoCardSize / 2), logoCardY + (logoCardSize / 2), 48, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = brandGold;
                ctx.font = `700 22px ${quoteCanvasFontFamily}`;
                ctx.textAlign = 'center';
                ctx.fillText('LOGO', logoCardX + (logoCardSize / 2), logoCardY + 74);
                ctx.font = `400 12px ${quoteCanvasFontFamily}`;
                ctx.fillStyle = textMuted;
                ctx.fillText(normalizeCanvasText('Cấu hình trong hệ thống'), logoCardX + (logoCardSize / 2), logoCardY + 102);
            }

            const centerColX = 246;
            const centerColWidth = 600;
            const rightCardX = 884;
            const rightCardWidth = 282;
            const quoteBadgeText = normalizeCanvasText(id ? `Báo giá đơn #${id}` : 'Báo giá sản phẩm');
            const storeName = normalizeCanvasText(quoteSettings.quote_store_name || 'Thông tin cửa hàng / xưởng');
            const addressText = normalizeCanvasText(quoteSettings.quote_store_address || 'Bổ sung địa chỉ cửa hàng trong Cài đặt web > Báo giá');
            const phoneText = normalizeCanvasText(quoteSettings.quote_store_phone || 'Chưa có số điện thoại');
            const selectedTemplateName = getSelectedQuoteTemplateLabel(template, formData.items);
            const customerName = String(formData.customer_name || '').trim();
            const hasCustomerName = customerName !== '';
            const rightCardHeight = hasCustomerName ? 176 : 156;

            ctx.fillStyle = brandDark;
            ctx.font = `800 42px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('BẢNG BÁO GIÁ'), centerColX, 72);

            ctx.fillStyle = textPrimary;
            ctx.font = `700 28px ${quoteCanvasFontFamily}`;
            ctx.fillText(storeName, centerColX, 128);

            ctx.fillStyle = textMuted;
            ctx.font = `400 14px ${quoteCanvasFontFamily}`;
            const addressLines = wrapCanvasText(ctx, addressText, centerColWidth);
            drawTextLines(ctx, addressLines, centerColX, 166, 24, 'left');
            drawTextLines(ctx, [`Điện thoại: ${phoneText}`], centerColX, 166 + (addressLines.length * 24) + 8, 22, 'left');

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#D8C4AF';
            ctx.fillRect(rightCardX, 46, rightCardWidth, rightCardHeight);
            ctx.strokeRect(rightCardX, 46, rightCardWidth, rightCardHeight);

            ctx.fillStyle = subtleBg;
            ctx.fillRect(rightCardX + 18, 64, rightCardWidth - 36, 40);
            ctx.strokeStyle = '#E6D7C9';
            ctx.strokeRect(rightCardX + 18, 64, rightCardWidth - 36, 40);
            ctx.fillStyle = brandDark;
            ctx.font = `700 12px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText(quoteBadgeText.toUpperCase(), rightCardX + (rightCardWidth / 2), 78);

            ctx.textAlign = 'left';
            ctx.fillStyle = textMuted;
            ctx.font = `700 12px ${quoteCanvasFontFamily}`;
            ctx.fillText(normalizeCanvasText('Mẫu đã chọn'), rightCardX + 24, 126);
            ctx.fillStyle = textPrimary;
            drawFittedCanvasText(ctx, selectedTemplateName, rightCardX + 24, 148, rightCardWidth - 48);
            if (hasCustomerName) {
                ctx.fillStyle = textPrimary;
                ctx.font = `700 13px ${quoteCanvasFontFamily}`;
                ctx.fillText(
                    fitCanvasText(ctx, `Tên khách hàng: ${customerName}`, rightCardWidth - 48),
                    rightCardX + 24,
                    176
                );
            }
            ctx.fillStyle = textMuted;
            ctx.font = `400 13px ${quoteCanvasFontFamily}`;
            ctx.fillText(normalizeCanvasText(`Ngày tạo: ${new Date().toLocaleDateString('vi-VN')}`), rightCardX + 24, hasCustomerName ? 198 : 180);

            ctx.fillStyle = brandDark;
            ctx.fillRect(0, headerHeight, pageWidth, tableHeaderHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = `700 13px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText(normalizeCanvasText('Ảnh bộ / mẫu'), imageColWidth / 2, headerHeight + 18);
            ctx.fillText(normalizeCanvasText('Tên sản phẩm'), xName + (nameColWidth / 2), headerHeight + 18);
            ctx.fillText('SL', xQty + (qtyColWidth / 2), headerHeight + 18);
            ctx.fillText(normalizeCanvasText('ĐVT'), xUnit + (unitColWidth / 2), headerHeight + 18);
            ctx.fillText(normalizeCanvasText('Đơn giá'), xPrice + (priceColWidth / 2), headerHeight + 18);
            ctx.fillText(normalizeCanvasText('Thành tiền'), xTotal + (totalColWidth / 2), headerHeight + 18);

            ctx.fillStyle = imagePanelBg;
            ctx.fillRect(0, bodyStartY, imageColWidth, itemsHeight);
            ctx.strokeStyle = borderStrong;
            ctx.strokeRect(0.5, bodyStartY + 0.5, imageColWidth - 1, itemsHeight - 1);

            const imageInset = 22;
            const imageBoxX = imageInset;
            const imageBoxY = bodyStartY + imageInset;
            const imageBoxWidth = imageColWidth - (imageInset * 2);
            const imageBoxHeight = itemsHeight - (imageInset * 2);

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(imageBoxX, imageBoxY, imageBoxWidth, imageBoxHeight);
            ctx.strokeStyle = '#E7D9CB';
            ctx.lineWidth = 1;
            ctx.strokeRect(imageBoxX, imageBoxY, imageBoxWidth, imageBoxHeight);

            if (templateImage) {
                drawImageContain(ctx, templateImage, imageBoxX + 10, imageBoxY + 10, imageBoxWidth - 20, imageBoxHeight - 20);
            } else {
                ctx.fillStyle = '#FBF6EE';
                ctx.fillRect(imageBoxX + 12, imageBoxY + 12, imageBoxWidth - 24, imageBoxHeight - 24);
                ctx.textAlign = 'center';
                ctx.fillStyle = brandDark;
                ctx.font = `700 18px ${quoteCanvasFontFamily}`;
                ctx.fillText(selectedTemplateName, imageBoxX + (imageBoxWidth / 2), imageBoxY + (imageBoxHeight / 2) - 14);
                ctx.fillStyle = textMuted;
                ctx.font = `400 12px ${quoteCanvasFontFamily}`;
                ctx.fillText(normalizeCanvasText('Chưa có ảnh mẫu trong hệ thống'), imageBoxX + (imageBoxWidth / 2), imageBoxY + (imageBoxHeight / 2) + 14);
            }

            let currentY = bodyStartY;
            formData.items.forEach((item, index) => {
                const rowHeight = rowHeights[index];
                const nameLines = wrapCanvasText(ctx, normalizeCanvasText(item.name || ''), nameColWidth - 30);

                ctx.fillStyle = index % 2 === 0 ? '#FFFFFF' : '#FBF8F4';
                ctx.fillRect(xName, currentY, pageWidth - xName, rowHeight);
                ctx.strokeStyle = borderColor;
                ctx.strokeRect(xName + 0.5, currentY + 0.5, nameColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xQty + 0.5, currentY + 0.5, qtyColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xUnit + 0.5, currentY + 0.5, unitColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xPrice + 0.5, currentY + 0.5, priceColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xTotal + 0.5, currentY + 0.5, totalColWidth - 1, rowHeight - 1);

                ctx.fillStyle = textPrimary;
                ctx.font = `400 15px ${quoteCanvasFontFamily}`;
                const nameBlockHeight = nameLines.length * 18;
                const nameTextY = currentY + Math.max(10, (rowHeight - nameBlockHeight) / 2);
                drawTextLines(ctx, nameLines, xName + 14, nameTextY, 18, 'left');

                const valueY = currentY + (rowHeight / 2);
                ctx.textAlign = 'center';
                ctx.font = `400 13px ${quoteCanvasFontFamily}`;
                ctx.textBaseline = 'middle';
                ctx.fillText(String(item.quantity || 0), xQty + (qtyColWidth / 2), valueY);
                ctx.fillText(getOrderUnitDisplay(item), xUnit + (unitColWidth / 2), valueY);

                ctx.textAlign = 'right';
                ctx.fillStyle = textPrimary;
                ctx.font = `400 13px ${quoteCanvasFontFamily}`;
                ctx.fillText(formatQuoteMoney(item.price), xPrice + priceColWidth - 14, valueY);
                ctx.font = `700 13px ${quoteCanvasFontFamily}`;
                ctx.fillText(formatQuoteMoney(item.price * item.quantity), xTotal + totalColWidth - 14, valueY);
                ctx.textBaseline = 'top';

                currentY += rowHeight;
            });

            ctx.fillStyle = footerBg;
            ctx.fillRect(0, bodyStartY + itemsHeight, pageWidth, footerHeight);
            ctx.strokeStyle = borderStrong;
            ctx.strokeRect(0.5, bodyStartY + itemsHeight + 0.5, pageWidth - 1, footerHeight - 1);
            [xQty, xUnit, xPrice, xTotal].forEach((x) => {
                ctx.beginPath();
                ctx.moveTo(x, bodyStartY + itemsHeight);
                ctx.lineTo(x, pageHeight);
                ctx.stroke();
            });

            ctx.fillStyle = textPrimary;
            ctx.font = `700 15px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('Tổng món'), 18, bodyStartY + itemsHeight + 18);
            ctx.textAlign = 'center';
            ctx.fillText(String(quoteTotalQuantity), xQty + (qtyColWidth / 2), bodyStartY + itemsHeight + 18);
            ctx.fillText(normalizeCanvasText('Tổng tiền'), xQty + ((qtyColWidth + priceColWidth) / 2), bodyStartY + itemsHeight + 18);
            ctx.fillStyle = footerBg;
            ctx.fillRect(xQty + 1, bodyStartY + itemsHeight + 1, (xTotal - xQty) - 2, footerHeight - 2);
            ctx.strokeStyle = borderStrong;
            [xQty, xUnit, xPrice, xTotal].forEach((x) => {
                ctx.beginPath();
                ctx.moveTo(x, bodyStartY + itemsHeight);
                ctx.lineTo(x, pageHeight);
                ctx.stroke();
            });
            ctx.fillStyle = textPrimary;
            ctx.font = `700 15px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText(String(quoteTotalQuantity), xQty + (qtyColWidth / 2), bodyStartY + itemsHeight + 18);
            ctx.fillText(normalizeCanvasText('Tá»•ng tiá»n'), xPrice + (priceColWidth / 2), bodyStartY + itemsHeight + 18);
            ctx.fillStyle = footerBg;
            ctx.fillRect(xPrice + 1, bodyStartY + itemsHeight + 1, priceColWidth - 2, footerHeight - 2);
            ctx.strokeStyle = borderStrong;
            [xPrice, xTotal].forEach((x) => {
                ctx.beginPath();
                ctx.moveTo(x, bodyStartY + itemsHeight);
                ctx.lineTo(x, pageHeight);
                ctx.stroke();
            });
            ctx.fillStyle = textPrimary;
            ctx.font = `700 15px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText(normalizeCanvasText('\u0054\u1ed5ng ti\u1ec1n'), xPrice + (priceColWidth / 2), bodyStartY + itemsHeight + 18);
            ctx.textAlign = 'right';
            ctx.fillText(formatQuoteMoney(quoteSubtotal), pageWidth - 18, bodyStartY + itemsHeight + 18);

            ctx.fillStyle = footerBg;
            ctx.fillRect(0, bodyStartY + itemsHeight, pageWidth, footerHeight);
            ctx.strokeStyle = borderStrong;
            ctx.strokeRect(0.5, bodyStartY + itemsHeight + 0.5, pageWidth - 1, footerHeight - 1);
            [xQty, xUnit, xPrice, xTotal].forEach((x) => {
                ctx.beginPath();
                ctx.moveTo(x, bodyStartY + itemsHeight);
                ctx.lineTo(x, pageHeight);
                ctx.stroke();
            });

            const footerFirstRowY = bodyStartY + itemsHeight + footerPaddingY + (footerRowHeight / 2);
            ctx.fillStyle = textPrimary;
            ctx.font = `700 15px ${quoteCanvasFontFamily}`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('Tổng món'), 18, footerFirstRowY);
            ctx.textAlign = 'center';
            ctx.fillText(String(quoteTotalQuantity), xQty + (qtyColWidth / 2), footerFirstRowY);
            ctx.fillText(normalizeCanvasText('Tổng tiền'), xPrice + (priceColWidth / 2), footerFirstRowY);
            ctx.textAlign = 'right';
            ctx.fillText(formatQuoteMoney(subtotalAmount), pageWidth - 18, footerFirstRowY);

            quoteFooterRows.forEach((row, index) => {
                const dividerY = bodyStartY + itemsHeight + footerPaddingY + ((index + 1) * footerRowHeight);
                ctx.beginPath();
                ctx.moveTo(0, dividerY);
                ctx.lineTo(pageWidth, dividerY);
                ctx.stroke();

                const rowY = dividerY + (footerRowHeight / 2);
                ctx.fillStyle = row.isDeduction ? '#8E0B0B' : textPrimary;
                ctx.font = `${row.isEmphasis ? '700' : '600'} 14px ${quoteCanvasFontFamily}`;
                ctx.textAlign = 'center';
                ctx.fillText(normalizeCanvasText(row.label), xPrice + (priceColWidth / 2), rowY);
                ctx.textAlign = 'right';
                ctx.fillText(`${row.isDeduction ? '-' : ''}${formatQuoteMoney(row.value)}`, pageWidth - 18, rowY);
            });
            ctx.textBaseline = 'top';

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));

            if (!blob) {
                throw new Error('QUOTE_CAPTURE_FAILED');
            }

            if (isCompactOrderMobileLayout) {
                downloadQuoteImageBlob(blob, formData.customer_name);
                return;
            }

            try {
                await copyPngBlobToClipboard(blob);
                showTransientNotification('success', 'Đã copy ảnh báo giá');
            } catch (clipErr) {
                console.error('Clipboard copy failed:', clipErr);
                const isUnsupported = clipErr?.code === 'CLIPBOARD_IMAGE_UNSUPPORTED';
                showTransientNotification(
                    'error',
                    isUnsupported
                        ? 'Trình duyệt không hỗ trợ copy ảnh vào clipboard.'
                        : 'Không thể copy ảnh báo giá vào clipboard. Hãy kiểm tra quyền clipboard hoặc dùng trình duyệt hỗ trợ.',
                    4500
                );
            }
        } catch (err) {
            console.error('Quote capture failed', err);
            showModal({ title: 'Lỗi', content: 'Không thể tạo ảnh báo giá. Hãy thử lại.', type: 'error' });
        } finally {
            setIsCapturing(false);
        }
    };

    const handleScreenshot = async () => {
        if (formData.items.length === 0 || isCapturing) return;

        let nextTemplates = quoteTemplates;

        try {
            nextTemplates = await refreshQuoteBootstrap();
        } catch (error) {
            console.error('Error refreshing quote bootstrap', error);
        }

        const availableTemplates = nextTemplates.filter((template) => template.is_active !== false);

        if (availableTemplates.length === 0) {
            showModal({
                title: 'Thiếu cấu hình',
                content: 'Chưa có bộ/mẫu báo giá hoạt động. Vào Cài đặt web > Báo giá để cấu hình trước.',
                type: 'error'
            });
            return;
        }

        setQuoteTemplateSearch('');
        setShowQuoteTemplatePicker(true);
    };

    const handleCopyCellValue = async (text, message, event, copyId) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const value = text == null ? '' : String(text);
        if (!value) return;

        try {
            await navigator.clipboard.writeText(value);
            setCopiedText(copyId || value);
            showTransientNotification('success', `Đã sao chép ${message}: ${value}`);
            if (copyFeedbackTimeoutRef.current) {
                window.clearTimeout(copyFeedbackTimeoutRef.current);
            }

            copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopiedText(null), 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            showTransientNotification('error', 'Không thể sao chép dữ liệu.');
        }
    };

    const setOrderItemNameRef = useCallback((cellKey, node) => {
        if (!cellKey) return;

        if (node) {
            orderItemNameRefs.current.set(cellKey, node);
        } else {
            orderItemNameRefs.current.delete(cellKey);
        }
    }, []);

    const updateActiveTruncatedNameCell = useCallback((cellKey) => {
        const element = orderItemNameRefs.current.get(cellKey);
        const isTruncated = Boolean(element && element.scrollWidth > element.clientWidth + 1);
        setActiveTruncatedNameCellKey(isTruncated ? cellKey : '');
        return isTruncated;
    }, []);

    const clearActiveTruncatedNameCell = useCallback((cellKey) => {
        setActiveTruncatedNameCellKey((currentValue) => (currentValue === cellKey ? '' : currentValue));
    }, []);

    const handleRefreshOrderItems = async (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        if (isRefreshingItems) return;

        if (formData.items.length === 0) {
            showModal({
                title: 'Chưa có sản phẩm',
                content: 'Đơn hiện tại chưa có sản phẩm để làm mới.',
                type: 'info'
            });
            return;
        }

        setIsRefreshingItems(true);

        try {
            const response = await productApi.refreshOrderItems({
                items: formData.items.map((item) => ({
                    product_id: item.product_id,
                    sku: item.sku,
                    name: item.name,
                }))
            });

            const refreshedItems = Array.isArray(response.data?.items) ? response.data.items : [];
            const issues = Array.isArray(response.data?.issues) ? response.data.issues : [];
            applyLatestProductsToOrderState(refreshedItems);

            if (refreshedItems.length > 0) {
                showTransientNotification(
                    'success',
                    issues.length > 0
                        ? `Đã làm mới ${refreshedItems.length} sản phẩm. Có ${issues.length} sản phẩm cần kiểm tra.`
                        : `Đã làm mới ${refreshedItems.length} sản phẩm trong đơn.`
                );
            } else {
                showTransientNotification('error', 'Không tìm thấy dữ liệu sản phẩm để làm mới.');
            }

            if (issues.length > 0) {
                const issueContent = issues
                    .map((issue, index) => {
                        const code = issue.sku ? `<strong>${escapeHtml(issue.sku)}</strong>` : `<strong>#${Number(issue.product_id) || '-'}</strong>`;
                        const name = escapeHtml(issue.name || `Sản phẩm #${issue.product_id}`);
                        const message = escapeHtml(issue.message || 'Sản phẩm đang có vấn đề.');

                        return `${index + 1}. ${code} - ${name}: ${message}`;
                    })
                    .join('<br/>');

                showModal({
                    title: 'Sản phẩm cần kiểm tra',
                    content: issueContent,
                    type: 'warning'
                });
            }
        } catch (error) {
            console.error('Error refreshing order items', error);
            showTransientNotification(
                'error',
                error.response?.data?.message || 'Không thể làm mới sản phẩm trong đơn.'
            );
        } finally {
            setIsRefreshingItems(false);
        }
    };

    const handleSubmit = async (e, submitOrderKind = null) => {
        e?.preventDefault?.();
        const mutation = buildOrderMutationPayload(submitOrderKind);
        if (!mutation) return;

        setSaving(true);
        try {
            const { normalizedOrderKind, payload } = mutation;

            const response = isEdit
                ? await orderApi.update(id, payload)
                : await orderApi.store(payload);
            const savedOrder = response?.data || null;
            const savedOrderKind = getNormalizedOrderKind(savedOrder?.order_kind || payload.order_kind);

            if (leadId) {
                if (savedOrderKind === MAIN_ORDER_KIND && returnTo) {
                    writeLeadListReturnHint(returnTo, {
                        leadId: Number(leadId),
                        orderId: savedOrder?.id || null,
                        orderNumber: savedOrder?.order_number || '',
                        latestNoteExcerpt: savedOrder?.order_number ? 'Đã tạo đơn hàng ' + savedOrder.order_number : '',
                        nextStatusCode: 'da-tao-don',
                        updatedAt: new Date().toISOString(),
                    });
                }
                navigateBack();
            } else if (savedOrderKind === DRAFT_ORDER_KIND) {
                navigate(buildOrderListUrl(savedOrderKind));
            } else if (returnTo) {
                navigateBack();
            } else {
                navigate(buildOrderListUrl(savedOrderKind));
            }
        } catch (error) {
            console.error('Error saving order:', error);
            if (error.response?.data?.errors) {
                console.table(error.response.data.errors);
                const firstError = Object.values(error.response.data.errors)[0][0];
                alert('Lỗi: ' + firstError);
            } else {
                alert('Có lỗi xảy ra khi lưu đơn hàng. Vui lòng kiểm tra console để biết chi tiết.');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleAttributeChange = React.useCallback((code, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: { ...prev.custom_attributes, [code]: value }
        }));
    }, []);

    const handleReorder = React.useCallback((newItems) => {
        setFormData(prev => ({ ...prev, items: applySequentialOrderLineSortOrder(newItems) }));
    }, []);

    const availableQuoteTemplates = quoteTemplates.filter((template) => template.is_active !== false);
    const orderSourceMeta = useMemo(
        () => getOrderSourceMeta(formData.source, UNKNOWN_ORDER_SOURCE),
        [formData.source]
    );
    const normalizedQuoteTemplateSearch = normalizeCanvasText(quoteTemplateSearch).toLowerCase();
    const filteredQuoteTemplates = availableQuoteTemplates.filter((template) => (
        !normalizedQuoteTemplateSearch || normalizeCanvasText(template.name).toLowerCase().includes(normalizedQuoteTemplateSearch)
    ));
    const quoteTotalQuantity = formData.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const quoteSubtotal = quotePricingSummary.subtotal;
    const mobileCustomerSummaryText = [formData.customer_name, formData.customer_phone].filter(Boolean).join(' - ');
    const mobileFooterPrimaryActionTitle = isDraftOrderKind(orderKind) ? 'Lưu nháp' : 'Lưu đơn';
    const mobileFooterSecondaryAction = isEdit
        ? (
            isDraftOrderKind(orderKind)
                ? {
                    title: 'Chốt thành đơn chính',
                    icon: 'task_alt',
                    onClick: () => handleConvertCurrentOrder(MAIN_ORDER_KIND),
                    className: 'border border-primary/10 bg-white text-primary hover:border-primary/25 hover:bg-primary hover:text-white',
                }
                : {
                    title: 'Chuyển sang đơn nháp',
                    icon: 'draft_orders',
                    onClick: () => handleConvertCurrentOrder(DRAFT_ORDER_KIND),
                    className: 'border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-700 hover:text-white',
                }
        )
        : (
            isDraftOrderKind(orderKind)
                ? null
                : {
                    title: 'Lưu nháp',
                    icon: 'draft_orders',
                    onClick: () => handleSubmit(null, DRAFT_ORDER_KIND),
                    className: 'border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-700 hover:text-white',
                }
        );
    const renderOrderNotesField = () => (
        <Field label="Ghi chú" className="min-h-[100px] items-start pt-3">
            <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows="3"
                className={adminTextareaClassName}
                placeholder="Nhập ghi chú cho khách hoặc đơn nháp"
            />
        </Field>
    );
    const renderManualShippingAddressField = () => (
        <Field
            label="Địa chỉ giao hàng (Số nhà, tên đường...)"
            labelStyle={adminCustomerLabelStyle}
            className="min-h-[100px] items-start pt-3"
        >
            <textarea
                name="shipping_address"
                value={formData.shipping_address}
                onChange={handleShippingAddressChange}
                onPaste={handleShippingAddressPaste}
                onBlur={handleShippingAddressBlur}
                rows="3"
                className={adminTextareaClassName}
                placeholder="Dán hoặc nhập địa chỉ để tự nhận diện"
            />
        </Field>
    );
    const leadConversionCard = leadConversionSummary ? (
        <div className="w-full rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
            <div className="mb-[10px] flex items-center gap-2.5 border-b border-primary/10 pb-3">
                <span className="material-symbols-outlined text-primary/40 text-[18px]">conversion_path</span>
                <h3 className="font-sans text-[15px] font-bold uppercase tracking-tight text-primary">Thông tin chuyển đổi</h3>
            </div>

            <div className="space-y-3 text-[13px] text-slate-700">
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Lead</span>
                    <span>{formData.custom_attributes?.lead_number || `#${leadId}`}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Tag</span>
                    <span>{leadConversionSummary.tag || 'Website'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Nguồn</span>
                    <span>{leadConversionSummary.source || leadConversionSummary.tag || 'Website'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Landing URL</span>
                    <div className="min-w-0 break-all">
                        {leadConversionSummary.landing_url ? <a href={leadConversionSummary.landing_url} target="_blank" rel="noreferrer" className="text-primary hover:text-brick">{leadConversionSummary.landing_url}</a> : <span>-</span>}
                    </div>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Trang đặt</span>
                    <div className="min-w-0 break-all">
                        {leadConversionSummary.current_url ? <a href={leadConversionSummary.current_url} target="_blank" rel="noreferrer" className="text-primary hover:text-brick">{leadConversionSummary.current_url}</a> : <span>-</span>}
                    </div>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Referrer</span>
                    <span className="break-all">{leadConversionSummary.referrer || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">UTM source</span>
                    <span>{leadConversionSummary.utm_source || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">UTM medium</span>
                    <span>{leadConversionSummary.utm_medium || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">UTM campaign</span>
                    <span>{leadConversionSummary.utm_campaign || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Link sản phẩm</span>
                    <div className="min-w-0 break-all">
                        {leadConversionSummary.product_link ? <a href={leadConversionSummary.product_link} target="_blank" rel="noreferrer" className="text-primary hover:text-brick">{leadConversionSummary.product_link}</a> : <span>-</span>}
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    const orderAiSummaryBanner = shouldShowOrderAiSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-sky-200 bg-sky-50 px-4 py-3">
            <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">
                    AI đã đổ vào bảng sản phẩm
                </div>
                <div className="mt-1 text-[12px] font-semibold text-slate-700">
                    {orderAiLastRun
                        ? `Lần gần nhất: thêm/cập nhật ${orderAiLastRun.touchedCount || 0} dòng${orderAiLastRun.reviewCount ? `, ${orderAiLastRun.reviewCount} dòng cần rà nhanh` : ''}${orderAiLastRun.unresolvedCount ? `, ${orderAiLastRun.unresolvedCount} dòng chưa ghép` : ''}.`
                        : `Có ${pendingOrderAiItems.length} dòng AI đang chờ duyệt nhanh.`}
                </div>
                {orderAiLastRun?.unresolvedCount > 0 && (
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">
                        {`Chưa ghép: ${(orderAiLastRun.unresolvedLabels || []).join(', ')}`}
                    </div>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {confirmedOrderAiItems.length > 0 && (
                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700">
                        {confirmedOrderAiItems.length} dòng AI đã xác nhận
                    </span>
                )}
                {hasLatestOrderAiInput && (
                    <button
                        type="button"
                        onClick={() => setShowOrderAiInputReviewModal((prev) => !prev)}
                        className="inline-flex h-9 items-center gap-2 rounded-sm border border-sky-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-100/70"
                    >
                        <span className="material-symbols-outlined text-[14px]">history</span>
                        Xem input AI
                    </button>
                )}
                {canClearLatestOrderAiRun && (
                    <button
                        type="button"
                        onClick={handleClearLatestOrderAiRun}
                        className="inline-flex h-9 items-center gap-2 rounded-sm border border-rose-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 transition-all hover:border-rose-300 hover:bg-rose-50"
                    >
                        <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                        Xóa toàn bộ kết quả AI
                    </button>
                )}
                {pendingOrderAiItems.length > 0 && (
                    <button
                        type="button"
                        onClick={handleConfirmPendingOrderAiItems}
                        className="inline-flex h-9 items-center gap-2 rounded-sm bg-sky-700 px-4 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-sky-800"
                    >
                        <span className="material-symbols-outlined text-[14px]">verified</span>
                        {`Xác nhận nhanh ${pendingOrderAiItems.length} dòng AI`}
                    </button>
                )}
            </div>
        </div>
    ) : null;

    const renderProductSearchToolbar = ({ mobile = false } = {}) => {
        const searchBoxClassName = mobile
            ? 'flex min-h-[46px] w-full items-center rounded-[14px] border border-primary/10 bg-white px-3 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-white'
            : 'flex h-10 items-center rounded-sm border border-primary/10 bg-primary/5 px-3 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-white';
        return (
            <div ref={productSearchContainerRef} className={`relative w-full min-w-0 ${mobile ? 'z-[150]' : 'z-[110]'}`}>
                {mobile ? (
                    <div className="space-y-2">
                        {productQuickFilterAttributes.length > 0 && activeProductQuickFilterAttribute && (
                            <div className="rounded-[14px] border border-primary/10 bg-white px-2.5 py-2 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <div className="inline-flex shrink-0 items-center gap-1.5 text-[14px] font-semibold text-primary/55">
                                        <span className="material-symbols-outlined text-[16px]">tune</span>
                                        <span>Lọc nhanh</span>
                                    </div>
                                    <div className="flex flex-1 flex-col gap-2">
                                        <select
                                            value={productQuickFilterAttributeId || ''}
                                            onChange={(event) => handleProductQuickFilterAttributeChange(event.target.value)}
                                            className="h-9 min-w-0 flex-1 rounded-[12px] border border-primary/15 bg-white px-3 text-[14px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                                        >
                                            {productQuickFilterAttributes.map((attribute) => (
                                                <option key={attribute.id} value={attribute.id}>
                                                    Lọc 1: {attribute.name}
                                                </option>
                                            ))}
                                        </select>
                                        {normalizedProductQuickFilterValues[0] && (
                                            <select
                                                value={productQuickFilterAttributeId2 || ''}
                                                onChange={(event) => handleProductQuickFilterAttributeChange2(event.target.value)}
                                                className="h-9 min-w-0 flex-1 rounded-[12px] border border-primary/15 bg-white px-3 text-[14px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                                            >
                                                <option value="">-- Lọc 2 (Mẫu mã) --</option>
                                                {productQuickFilterAttributes
                                                    .filter(attr => String(attr.id) !== String(productQuickFilterAttributeId))
                                                    .map((attribute) => (
                                                        <option key={attribute.id} value={attribute.id}>
                                                            {attribute.name}
                                                        </option>
                                                    ))}
                                            </select>
                                        )}
                                    </div>
                                    {hasActiveProductQuickFilter && (
                                        <button
                                            type="button"
                                            onClick={clearProductQuickFilterValues}
                                            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[12px] border border-primary/10 bg-primary/[0.04] px-2.5 text-[14px] font-semibold text-primary/65 transition-all hover:border-brick/20 hover:text-brick"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                            <span>Xóa lọc</span>
                                        </button>
                                    )}
                                </div>

                                {activeProductQuickFilterAttribute.options?.length > 0 && (
                                    <div className="custom-scrollbar mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
                                        {activeProductQuickFilterAttribute.options.map((option) => {
                                            const isSelected = normalizedProductQuickFilterValues.includes(option.value);

                                            return (
                                                <button
                                                    key={`${activeProductQuickFilterAttribute.id}-${option.id || option.value}`}
                                                    type="button"
                                                    onClick={() => toggleProductQuickFilterValue(option.value)}
                                                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[14px] font-semibold transition-all ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-primary/[0.03] text-primary/70 hover:border-primary/25 hover:bg-white'}`}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">{isSelected ? 'check' : 'add'}</span>
                                                    <span>{option.label || option.value}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {normalizedProductQuickFilterValues[0] && activeProductQuickFilterAttribute2Options.length > 0 && (
                                    <div className="custom-scrollbar mt-1.5 flex items-center gap-1.5 border-t border-primary/5 overflow-x-auto pt-1.5 pb-1">
                                        {activeProductQuickFilterAttribute2Options.map((option) => {
                                            const isSelected = normalizedProductQuickFilterValues2.includes(option.value);

                                            return (
                                                <button
                                                    key={`${activeProductQuickFilterAttribute2.id}-${option.id || option.value}`}
                                                    type="button"
                                                    onClick={() => toggleProductQuickFilterValue2(option.value)}
                                                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[14px] font-semibold transition-all ${isSelected ? 'border-brick bg-brick text-white shadow-sm' : 'border-brick/10 bg-brick/[0.03] text-brick/70 hover:border-brick/25 hover:bg-white'}`}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">{isSelected ? 'check' : 'add'}</span>
                                                    <span>{option.label || option.value}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {hasActiveProductQuickFilter && activeProductQuickFilterSummary && (
                            <div className="rounded-[14px] border border-primary/10 bg-white shadow-sm">
                                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="material-symbols-outlined text-[14px] text-primary/40">bolt</span>
                                        <span className="truncate text-[12px] font-semibold text-primary/45">
                                            {activeProductQuickFilterSummary || 'Lọc nhanh hơn'}
                                        </span>
                                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/55">
                                            {`${activeProductQuickSetupItems.length} SP`}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={toggleProductQuickMode}
                                        disabled={isProductQuickModeToggleDisabled}
                                        className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-[12px] font-semibold shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'}`}
                                    >
                                        <span className="material-symbols-outlined text-[12px]">{isProductQuickModeActive ? 'flash_on' : 'flash_off'}</span>
                                        {isProductQuickModeActive ? 'Đang bật' : 'Đang tắt'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className={searchBoxClassName}>
                            <span className="material-symbols-outlined mr-2 text-[18px] text-primary/40">search</span>
                            <input
                                ref={productSearchInputRef}
                                type="text"
                                placeholder="Gõ mã hoặc tên sản phẩm..."
                                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold leading-[1.35] text-[#0F172A] placeholder:text-primary/30 focus:outline-none"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setShowProductQuickSetupPanel(false);
                                    setShowSearchDropdown(true);
                                    setShowSearchHistory(false);
                                }}
                                onFocus={() => {
                                    setShowProductQuickSetupPanel(false);
                                    setShowSearchDropdown(true);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape' && searchTerm !== '') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        clearProductSearchInput();
                                    }
                                }}
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={clearProductSearchInput}
                                    className="ml-2 text-primary/30 transition-colors hover:text-brick"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className={searchBoxClassName}>
                        <span className="material-symbols-outlined mr-2 text-[16px] text-primary/40">search</span>
                        <input
                            ref={productSearchInputRef}
                            type="text"
                            placeholder="Gõ mã hoặc tên sản phẩm..."
                            className="flex-1 bg-transparent text-[14px] font-medium tracking-tight text-[#0F172A] placeholder:text-primary/30 focus:outline-none"
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setShowProductQuickSetupPanel(false);
                                setShowSearchDropdown(true);
                                setShowSearchHistory(false);
                            }}
                            onFocus={() => {
                                setShowProductQuickSetupPanel(false);
                                setShowSearchDropdown(true);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape' && searchTerm !== '') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    clearProductSearchInput();
                                }
                            }}
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={clearProductSearchInput}
                                className="ml-2 text-primary/30 hover:text-brick"
                            >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowProductQuickSetupPanel(false);
                                setShowSearchDropdown(true);
                                setShowProductQuickFilterPanel(false);
                                setShowSearchHistory((prev) => !prev);
                            }}
                            className="ml-3 border-l border-primary/10 pl-3 text-primary/30 transition-all hover:text-primary"
                            title="Hiển thị lịch sử tìm kiếm"
                        >
                            <span className="material-symbols-outlined text-[15px]">history</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleRefreshOrderItems}
                            className="ml-3 border-l border-primary/10 pl-3 text-primary/30 transition-all hover:text-primary"
                            title="Làm mới sản phẩm trong đơn hiện tại"
                        >
                            <span className={`material-symbols-outlined text-xs ${isRefreshingItems ? 'animate-refresh-spin' : ''}`}>refresh</span>
                        </button>
                        <button
                            type="button"
                            onClick={toggleOrderAiPanel}
                            className={`ml-3 border-l border-primary/10 pl-3 transition-all ${showOrderAiPanel ? 'text-primary' : 'text-primary/30 hover:text-primary'}`}
                            title="Tìm nhanh bằng AI"
                        >
                            <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
                        </button>
                        {productQuickFilterAttributes.length > 0 && (
                            <button
                                type="button"
                                onClick={openProductQuickFilterPanel}
                                className={`relative ml-3 border-l border-primary/10 pl-3 transition-all ${hasActiveProductQuickFilter ? 'text-primary' : 'text-primary/30 hover:text-primary'}`}
                                title="Lọc nhanh theo thuộc tính"
                            >
                                <span className="material-symbols-outlined text-[15px]">tune</span>
                                {hasActiveProductQuickFilter && (
                                    <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-primary px-1 text-center text-[9px] font-black leading-4 text-white">
                                        {activeProductQuickFilterCount}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                )}

                <OrderAiSearchPanel
                    show={showOrderAiPanel}
                    fileInputRef={orderAiFileInputRef}
                    trainingRuleOptions={orderAiQuickRuleOptions}
                    trainingRulesLoading={orderAiTrainingRulesLoading}
                    selectedTrainingRuleValue={orderAiSelectedRuleKey}
                    selectedTrainingRule={selectedOrderAiQuickRule}
                    onTrainingRuleChange={handleOrderAiSelectedRuleChange}
                    inputValue={orderAiInput}
                    onInputChange={setOrderAiInput}
                    onPaste={handleOrderAiPaste}
                    onOpenRules={() => navigate('/admin/ai-training')}
                    onReset={() => {
                        setOrderAiSelectedRuleKey('');
                        setOrderAiInput('');
                        clearOrderAiFile();
                        resetOrderAiPreviewState();
                    }}
                    onFileChange={handleOrderAiFileChange}
                    file={orderAiFile}
                    filePreviewUrl={orderAiFilePreviewUrl}
                    onClearFile={clearOrderAiFile}
                    onRun={handleRunOrderAiPreview}
                    loading={orderAiLoading}
                    lastRun={orderAiLastRun}
                    preview={orderAiPreview}
                    onUpdateItem={updateOrderAiPreviewItem}
                    onOpenManualPicker={handleOpenOrderAiManualPicker}
                    manualPickerLineId={orderAiManualPickerLineId}
                    manualSearchTerm={orderAiManualSearchTerm}
                    onManualSearchTermChange={setOrderAiManualSearchTerm}
                    manualSearchResults={orderAiManualSearchResults}
                    manualSearchLoading={orderAiManualSearchLoading}
                    onSelectSuggestion={handleSelectOrderAiSuggestion}
                    onResetPreview={resetOrderAiPreviewState}
                    onApplyPreview={handleApplyOrderAiPreview}
                    applying={orderAiApplying}
                    currencyFormatter={quoteCurrencyFormatter}
                />

                {!mobile && hasActiveProductQuickFilter && activeProductQuickFilterSummary && (
                    <div className={`mt-2 ${mobile ? 'space-y-0' : 'grid items-start gap-2 lg:grid-cols-[max-content_minmax(0,1fr)_max-content]'}`}>
                        {!mobile && (
                            <button
                                type="button"
                                onClick={openProductQuickFilterPanel}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/15 bg-primary/[0.03] px-2.5 py-1.5 shadow-sm transition-all hover:border-primary/30 hover:bg-white"
                                title="Mở lại bộ lọc nhanh"
                            >
                                <span className="material-symbols-outlined shrink-0 text-[12px] text-primary/35">tune</span>
                                <span className="min-w-0 truncate text-[11px] font-semibold leading-none text-primary/70">
                                    {activeProductQuickFilterSummary}
                                </span>
                            </button>
                        )}
                        <div className={`relative min-w-0 ${mobile ? 'w-full' : 'w-full max-w-[880px] justify-self-start lg:min-w-[760px]'}`}>
                            <div className={`border border-primary/10 bg-white shadow-sm ${mobile ? 'rounded-[14px]' : 'rounded-sm'}`}>
                                <div className={`flex items-center justify-between gap-2 ${mobile ? 'px-2.5 py-2' : 'flex-wrap px-3 py-2'}`}>
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="material-symbols-outlined text-[14px] text-primary/40">bolt</span>
                                        <span className={`${mobile ? 'text-[12px] font-semibold' : 'text-[10px] font-black uppercase tracking-[0.14em]'} text-primary/45`}>
                                            {mobile ? (activeProductQuickFilterSummary || 'Lọc nhanh hơn') : 'Lọc nhanh hơn'}
                                        </span>
                                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/55">
                                            {`${activeProductQuickSetupItems.length} SP`}
                                        </span>
                                    </div>
                                    {mobile ? (
                                        <button
                                            type="button"
                                            onClick={toggleProductQuickMode}
                                            disabled={isProductQuickModeToggleDisabled}
                                            className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-[12px] font-semibold shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'}`}
                                        >
                                            <span className="material-symbols-outlined text-[12px]">{isProductQuickModeActive ? 'flash_on' : 'flash_off'}</span>
                                            {isProductQuickModeActive ? 'Đang bật' : 'Đang tắt'}
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={toggleProductQuickSetupPanel}
                                                className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                            >
                                                <span className="material-symbols-outlined text-[12px]">playlist_add</span>
                                                {showProductQuickSetupPanel ? 'Đóng' : (activeProductQuickSetupItems.length > 0 ? 'Sửa DS' : 'Khai báo nhanh')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={toggleProductQuickMode}
                                                disabled={isProductQuickModeToggleDisabled}
                                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'}`}
                                            >
                                                <span className="material-symbols-outlined text-[12px]">{isProductQuickModeActive ? 'flash_on' : 'flash_off'}</span>
                                                {isProductQuickModeActive ? 'Đang bật' : 'Đang tắt'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {showProductQuickSetupPanel && !mobile && (
                                <div className={`absolute left-0 top-full mt-2 w-full overflow-hidden border border-primary/10 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] ${mobile ? 'z-[170] rounded-[18px]' : 'z-[115] rounded-sm'}`}>
                                    <div className="px-3 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="flex h-9 min-w-[180px] flex-1 items-center rounded-sm border border-primary/10 bg-white px-3 shadow-sm">
                                                <span className="material-symbols-outlined mr-2 text-[15px] text-primary/35">search</span>
                                                <input
                                                    ref={productQuickSetupSearchInputRef}
                                                    type="text"
                                                    value={productQuickSetupSearchTerm}
                                                    onChange={(event) => setProductQuickSetupSearchTerm(event.target.value)}
                                                    placeholder={`Tìm SP trong ${normalizedProductQuickFilterValues[0]}...`}
                                                    className="w-full bg-transparent text-[12px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:outline-none"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowProductQuickSetupPanel(false)}
                                                className="h-9 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                            >
                                                Xong
                                            </button>
                                        </div>

                                        <div className="mt-2 text-[10px] font-semibold text-primary/40">
                                            {activeProductQuickSetupItems.length > 0
                                                ? `Đang lưu ${activeProductQuickSetupItems.length} sản phẩm cho bộ lọc này.`
                                                : 'Chọn vài sản phẩm để tạo lớp lọc nhanh cho thuộc tính đang chọn.'}
                                        </div>

                                        <div ref={productQuickSetupListRef} className="custom-scrollbar mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                                            {visibleProductQuickSetupProducts.length > 0 ? visibleProductQuickSetupProducts.map((product) => {
                                                const targetProductId = Number(product?.target_product_id ?? product?.product_id ?? product?.id);
                                                const setupEntryKey = getProductQuickSetupEntryKey(product);
                                                const entryKind = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT);
                                                const isVariation = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT) === SEARCH_ENTRY_VARIATION;
                                                const isBundleOption = entryKind === SEARCH_ENTRY_BUNDLE_OPTION;
                                                const isSelected = selectedQuickSetupEntryKeys.has(setupEntryKey);

                                                return (
                                                    <button
                                                        key={`setup-product-${setupEntryKey || targetProductId}`}
                                                        type="button"
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => handleToggleProductQuickSetupSelection(product, setupEntryKey, isSelected)}
                                                        className={`w-full rounded-sm border px-3 py-2 text-left transition-all ${isSelected ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary hover:border-primary/25 hover:bg-white'}`}
                                                    >
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="truncate text-[12px] font-semibold text-[#0F172A]">
                                                                    {product.display_name || product.name || '---'}
                                                                </div>
                                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-primary/45">
                                                                    {(product.display_sku || product.sku) && (
                                                                        <span>{product.display_sku || product.sku}</span>
                                                                    )}
                                                                    {isVariation && product.option_label && (
                                                                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">
                                                                            {product.option_label}
                                                                        </span>
                                                                    )}
                                                                    {isBundleOption && product.bundle_option_title && (
                                                                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">
                                                                            Bundle: {product.bundle_option_title}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="shrink-0 text-right">
                                                                <div className="text-[11px] font-black text-blue-600">
                                                                    {quoteCurrencyFormatter.format(Number(product.price || 0))}đ
                                                                </div>
                                                                <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                                                    {isSelected ? 'Đã chọn' : 'Thêm'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            }) : (
                                                <div className="rounded-sm border border-dashed border-primary/10 bg-white px-3 py-6 text-center text-[11px] italic text-primary/35">
                                                    Không có sản phẩm phù hợp với bộ lọc hiện tại.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        {!mobile && (
                            <button
                                type="button"
                                onClick={disableProductQuickMode}
                                disabled={!isProductQuickModeActive}
                                className="inline-flex size-6 shrink-0 items-center justify-center self-center rounded-full border border-primary/10 bg-white text-primary/35 shadow-sm transition-all hover:border-brick/20 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40 lg:size-10"
                                title="Tắt lọc nhanh hơn"
                            >
                                <span className="material-symbols-outlined text-[12px] lg:text-[18px]">close</span>
                            </button>
                        )}
                    </div>
                )}

                {showSearchDropdown && (
                    <div className={`custom-scrollbar absolute left-0 right-0 border border-primary/20 bg-white shadow-2xl ${mobile ? 'top-full z-[165] mt-2 max-h-[65vh] overflow-auto rounded-[20px]' : 'top-full z-[120] mt-1 max-h-[400px] overflow-auto rounded-sm'}`}>
                        {shouldShowProductQuickFilterPanel && !mobile && (
                            <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-3">
                                <div className="flex flex-col gap-2">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="flex items-center gap-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                    Lọc 1
                                                </div>
                                                <select
                                                    value={productQuickFilterAttributeId || ''}
                                                    onChange={(e) => handleProductQuickFilterAttributeChange(e.target.value)}
                                                    className="h-8 min-w-[140px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                                                >
                                                    {productQuickFilterAttributes.map((attribute) => (
                                                        <option key={attribute.id} value={attribute.id}>
                                                            {attribute.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            {normalizedProductQuickFilterValues[0] && (
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                        Lọc 2
                                                    </div>
                                                    <select
                                                        value={productQuickFilterAttributeId2 || ''}
                                                        onChange={(e) => handleProductQuickFilterAttributeChange2(e.target.value)}
                                                        className="h-8 min-w-[140px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                                                    >
                                                        <option value="">-- Chọn mẫu mã --</option>
                                                        {productQuickFilterAttributes
                                                            .filter(attr => String(attr.id) !== String(productQuickFilterAttributeId))
                                                            .map((attribute) => (
                                                                <option key={attribute.id} value={attribute.id}>
                                                                    {attribute.name}
                                                                </option>
                                                            ))}
                                                    </select>
                                                </div>
                                            )}

                                            {hasActiveProductQuickFilter && (
                                                <button
                                                    type="button"
                                                    onClick={clearProductQuickFilterValues}
                                                    className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35 transition-colors hover:text-brick"
                                                >
                                                    Xóa lọc
                                                </button>
                                            )}
                                        </div>
                                        {activeProductQuickFilterAttribute?.options?.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {activeProductQuickFilterAttribute.options.map((option) => {
                                                    const isSelected = normalizedProductQuickFilterValues.includes(option.value);

                                                    return (
                                                        <button
                                                            key={`${activeProductQuickFilterAttribute.id}-${option.id || option.value}`}
                                                            type="button"
                                                            onClick={() => toggleProductQuickFilterValue(option.value)}
                                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-primary/25 hover:bg-primary/5'}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                            <span>{option.label || option.value}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {normalizedProductQuickFilterValues[0] && activeProductQuickFilterAttribute2Options.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-2 border-t border-primary/5 pt-2">
                                                {activeProductQuickFilterAttribute2Options.map((option) => {
                                                    const isSelected = normalizedProductQuickFilterValues2.includes(option.value);

                                                    return (
                                                        <button
                                                            key={`${activeProductQuickFilterAttribute2.id}-${option.id || option.value}`}
                                                            type="button"
                                                            onClick={() => toggleProductQuickFilterValue2(option.value)}
                                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all ${isSelected ? 'border-brick bg-brick text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-brick/25 hover:bg-brick/5'}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                            <span>{option.label || option.value}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                </div>
                            </div>
                        )}
                        {showSearchHistory && (
                            <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className={`${mobile ? 'text-[12px] font-semibold' : 'text-[10px] font-black uppercase tracking-[0.14em]'} text-primary/45`}>
                                        Lịch sử tìm kiếm
                                    </div>
                                    {searchHistory.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={clearSearchHistory}
                                            className={`${mobile ? 'text-[13px] font-semibold' : 'text-[10px] font-bold uppercase tracking-[0.12em]'} text-primary/35 transition-colors hover:text-brick`}
                                        >
                                            Xóa hết
                                        </button>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {searchHistory.length > 0 ? searchHistory.map((term) => (
                                        <button
                                            key={term}
                                            type="button"
                                            onClick={() => {
                                                setSearchTerm(term);
                                                setShowSearchDropdown(true);
                                                setShowSearchHistory(false);
                                            }}
                                            className={`inline-flex items-center gap-1 border border-primary/10 bg-white transition-all hover:border-primary/25 hover:bg-primary/5 ${mobile ? 'rounded-full px-3 py-2 text-[14px] font-semibold text-primary/80' : 'rounded-sm px-2.5 py-1.5 text-[11px] font-semibold text-primary'}`}
                                        >
                                            <span className={`material-symbols-outlined text-primary/35 ${mobile ? 'text-[16px]' : 'text-[13px]'}`}>history</span>
                                            <span className="max-w-[220px] truncate">{term}</span>
                                        </button>
                                    )) : (
                                        <div className={`${mobile ? 'py-3 text-[14px]' : 'py-2 text-[11px]'} italic text-primary/30`}>
                                            Chưa có lịch sử tìm kiếm.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {rankedSearchProducts.map((p) => (
                            <ProductSearchOption
                                key={p.entry_id || p.id}
                                product={p}
                                onSelect={addProductById}
                                quickFilterAttribute={activeProductQuickFilterAttribute}
                                isAlreadyInOrder={Boolean(p.__alreadyInOrder)}
                            />
                        ))}
                        {(searchTerm.trim() !== '' || hasActiveProductQuickFilter) && rankedSearchProducts.length === 0 && (
                            <div className={`p-4 text-center italic text-primary/20 ${mobile ? 'text-[13px] font-semibold' : 'text-[11px] font-black uppercase tracking-widest'}`}>
                                Không có kết quả khả dụng...
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    if (loading) return <div className="p-8 text-center text-[14px] italic leading-[1.55] text-primary">Đang tải dữ liệu...</div>;

    return (
        <div className="relative flex min-h-full flex-col bg-[#fcfcfa] animate-fade-in p-0 pb-32 text-[14px] leading-[1.55] text-[#0F172A] md:p-6 md:pb-6">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .admin-header-title { font-size: 18px !important; font-weight: 800 !important; color: #1B365D !important; letter-spacing: -0.01em !important; line-height: 1.4 !important; }
                .admin-table-header { font-size: 12px !important; font-weight: 700 !important; color: #1B365D !important; letter-spacing: 0 !important; background-color: #F0F4F8 !important; }
                .order-form-table { --order-form-header-font-size: 12px; --order-form-header-letter-spacing: 0.08em; --order-form-body-font-size: 13px; --order-form-body-meta-font-size: 11px; --order-form-body-meta-margin-top: 4px; --order-form-cell-padding-x: 12px; --order-form-cell-padding-y: 10px; --order-form-quantity-input-width: 54px; --order-form-quantity-input-height: 32px; --order-form-action-button-size: 28px; --order-form-action-icon-size: 14px; --order-form-row-icon-size: 16px; --order-form-copy-icon-size: 14px; --order-form-badge-font-size: 9px; --order-form-badge-padding-x: 8px; --order-form-badge-padding-y: 2px; }
                .order-form-table .order-form-header-cell { padding: var(--order-form-cell-padding-y) var(--order-form-cell-padding-x); }
                .order-form-table .order-form-header-cell-tight { padding-left: calc(var(--order-form-cell-padding-x) - 3px); padding-right: calc(var(--order-form-cell-padding-x) - 3px); }
                .order-form-table .order-form-header-label { font-size: var(--order-form-header-font-size); letter-spacing: var(--order-form-header-letter-spacing); }
                .order-form-table .order-form-cell { padding: var(--order-form-cell-padding-y) var(--order-form-cell-padding-x); font-size: var(--order-form-body-font-size); }
                .order-form-table .order-form-cell-tight { padding-left: calc(var(--order-form-cell-padding-x) - 2px); padding-right: calc(var(--order-form-cell-padding-x) - 2px); }
                .order-form-table .order-form-cell-number { white-space: nowrap; }
                .order-form-table .order-form-cell-meta { margin-top: var(--order-form-body-meta-margin-top); font-size: var(--order-form-body-meta-font-size); line-height: 1.35; }
                .order-form-table .order-form-cell-copy-icon { font-size: var(--order-form-copy-icon-size); }
                .order-form-table .order-form-row-icon { font-size: var(--order-form-row-icon-size); }
                .order-form-table .order-form-badge { padding: var(--order-form-badge-padding-y) var(--order-form-badge-padding-x); font-size: var(--order-form-badge-font-size); }
                .order-form-table .order-form-quantity-input { height: var(--order-form-quantity-input-height); max-width: var(--order-form-quantity-input-width); font-size: var(--order-form-body-font-size); }
                .order-form-table .order-form-money-input { height: var(--order-form-quantity-input-height); font-size: var(--order-form-body-font-size); }
                .order-form-table .order-form-action-button { width: var(--order-form-action-button-size); height: var(--order-form-action-button-size); }
                .order-form-table .order-form-action-icon { font-size: var(--order-form-action-icon-size); }
                .order-form-table::-webkit-scrollbar { width: 10px; height: 10px; }
                .order-form-table::-webkit-scrollbar-track { background: #F0F4F8; }
                .order-form-table::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
            `}</style>
            {notification && (
                <div className={`fixed top-6 right-6 z-[2000] p-4 rounded-md shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined">{notification.type === 'error' ? 'report' : 'check_circle'}</span>
                        <span className="font-bold">{notification.message}</span>
                    </div>
                    <button type="button" onClick={() => setNotification(null)} className="ml-2 opacity-50 hover:opacity-100 flex items-center">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            )}
            <div className={`flex-none bg-[#F8FAFC] pb-4 space-y-2 ${isCompactOrderMobileLayout ? 'sticky top-0 z-[140] border-b border-primary/10 bg-[#F8FAFC]/95 pb-3 pt-2 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.45)] backdrop-blur supports-[backdrop-filter]:bg-[#F8FAFC]/88' : ''}`}>
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-2 lg:items-center lg:gap-3">
                        {isCompactOrderMobileLayout ? (
                            <div className="min-w-0 flex-1 lg:hidden">
                                {renderProductSearchToolbar({ mobile: true })}
                            </div>
                        ) : null}
                        <button
                            onClick={handleCancel}
                            className="hidden size-10 shrink-0 items-center justify-center rounded-[14px] border border-primary/10 bg-white text-primary/50 shadow-sm transition-all hover:border-brick/20 hover:text-brick lg:flex lg:size-9 lg:rounded-sm"
                            title="Quay lại"
                        >
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        </button>
                        <div className="hidden lg:block">
                            <div className="flex items-center gap-2 mb-1.5">
                                <h1 className="admin-header-title italic">{isEdit ? orderKindMeta.editTitle : orderKindMeta.createTitle}</h1>
                                <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-white px-3 py-1.5 text-[14px] font-semibold leading-none text-primary/70 shadow-sm">
                                    <span className="material-symbols-outlined text-[12px]">{orderKindMeta.icon}</span>
                                    {orderKindMeta.shortLabel}
                                </span>
                            </div>
                            <p className="font-sans text-[14px] leading-[1.55] text-primary/45">Trang quản trị / Đơn hàng / {isEdit ? ('Chi tiết #' + id) : orderKindMeta.shortLabel}</p>
                        </div>
                    </div>

                    <div className="hidden flex-wrap items-center gap-2 justify-end lg:flex">
                        {specialOrderType && (
                            <button
                                type="button"
                                onClick={() => setShowSupplementItemsModal(true)}
                                className="px-3 h-10 bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-500 hover:border-amber-500 hover:text-white text-[14px] font-semibold rounded-sm transition-all shadow-sm flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                                Khai báo sản phẩm đổi trả
                                {supplementDeclarationCount > 0 && (
                                    <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black leading-none text-amber-700">
                                        {supplementDeclarationCount}
                                    </span>
                                )}
                            </button>
                        )}
                        {isEdit && isDraftOrderKind(orderKind) && (
                            <button type="button" onClick={() => handleConvertCurrentOrder(MAIN_ORDER_KIND)} className="px-3 h-10 bg-white border border-primary/10 text-primary hover:bg-primary hover:text-white text-[14px] font-semibold rounded-sm transition-all">
                                Chốt thành đơn chính
                            </button>
                        )}
                        {isEdit && !isDraftOrderKind(orderKind) && (
                            <button type="button" onClick={() => handleConvertCurrentOrder(DRAFT_ORDER_KIND)} className="px-3 h-10 bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-700 hover:text-white text-[14px] font-semibold rounded-sm transition-all">
                                Chuyển sang đơn nháp
                            </button>
                        )}
                        {!isEdit && !isDraftOrderKind(orderKind) && (
                            <button
                                type="button"
                                onClick={() => handleSubmit(null, DRAFT_ORDER_KIND)}
                                disabled={saving}
                                className="px-3 h-10 bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-700 hover:text-white text-[14px] font-semibold rounded-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Chuyển sang đơn nháp
                            </button>
                        )}
                        <button type="button" onClick={handleCancel} className="px-4 h-10 bg-white border border-primary/10 text-primary/60 hover:text-brick text-[14px] font-semibold rounded-sm transition-all">
                            Hủy
                        </button>
                        <button type="submit" form="order-form" disabled={saving} className="bg-primary text-white px-4 h-10 rounded-sm text-[14px] font-semibold hover:bg-brick transition-all shadow-sm flex items-center gap-2">
                            <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`}>
                                {saving ? 'progress_activity' : 'save'}
                            </span>
                            {saving ? 'Đang lưu' : orderKindMeta.submitLabel}
                        </button>
                    </div>
                </div>
            </div>

            <form id="order-form" onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-[10px] xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)] xl:items-start">
                {/* Left Section: Product Management & Custom Attributes */}
                <div className="flex max-w-full min-w-0 flex-col gap-[10px]">
                    <div className="bg-white border border-primary/10 p-4 shadow-sm rounded-sm">
                        {/* Title & Product Selector Tags */}
                        {!isCompactOrderMobileLayout && (
                            <div className="flex flex-col gap-[10px] border-b border-primary/10 pb-4 xl:flex-row xl:items-start">
                            <div className="relative group">
                                <span className="material-symbols-outlined text-primary/30 p-3 bg-primary/5 rounded-full">shopping_bag</span>
                                <button
                                    type="button"
                                    onClick={handleScreenshot}
                                    disabled={formData.items.length === 0 || isCapturing}
                                    className={`absolute -bottom-1 -right-1 size-6 flex items-center justify-center rounded-full shadow-lg transition-all ${isCapturing ? 'bg-primary animate-pulse' : 'bg-primary hover:bg-primary/90 text-white'} ${formData.items.length === 0 ? 'opacity-0 scale-0' : 'opacity-100 scale-100'}`}
                                    title="Chụp ảnh báo giá cho khách"
                                >
                                    <span className="material-symbols-outlined text-[14px]">{isCapturing ? 'progress_activity' : 'photo_camera'}</span>
                                </button>
                            </div>
                            <div className="relative z-[100] flex-1 min-w-0">
                                <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
                                    {/* Flexible Search Input */}
                                    <div ref={productSearchContainerRef} className="relative z-[110] w-full min-w-0">
                                        <div className="flex items-center bg-primary/5 border border-primary/10 rounded-sm px-3 h-10 focus-within:border-primary/30 focus-within:bg-white transition-all shadow-sm">
                                            <span className="material-symbols-outlined text-[16px] text-primary/40 mr-2">search</span>
                                            <input
                                                ref={productSearchInputRef}
                                                type="text"
                                                placeholder="Gõ mã hoặc tên sản phẩm..."
                                                className="bg-transparent text-[14px] placeholder:text-primary/30 focus:outline-none flex-1 font-medium text-[#0F172A] tracking-tight"
                                                value={searchTerm}
                                                onChange={(e) => {
                                                    setSearchTerm(e.target.value);
                                                    setShowProductQuickSetupPanel(false);
                                                    setShowSearchDropdown(true);
                                                    setShowSearchHistory(false);
                                                }}
                                                onFocus={() => {
                                                    setShowProductQuickSetupPanel(false);
                                                    setShowSearchDropdown(true);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape' && searchTerm !== '') {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        clearProductSearchInput();
                                                    }
                                                }}
                                            />
                                            {searchTerm && (
                                                <button
                                                    type="button"
                                                    onClick={clearProductSearchInput}
                                                    className="text-primary/30 hover:text-brick ml-2"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowProductQuickSetupPanel(false);
                                                    setShowSearchDropdown(true);
                                                    setShowProductQuickFilterPanel(false);
                                                    setShowSearchHistory((prev) => !prev);
                                                }}
                                                className="text-primary/30 hover:text-primary ml-3 border-l border-primary/10 pl-3 transition-all"
                                                title={'Hi\u1ec3n th\u1ecb l\u1ecbch s\u1eed t\u00ecm ki\u1ebfm'}
                                            >
                                                <span className="material-symbols-outlined text-[15px]">history</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleRefreshOrderItems}
                                                className="text-primary/30 hover:text-primary ml-3 border-l border-primary/10 pl-3 transition-all"
                                                title={'L\u00e0m m\u1edbi s\u1ea3n ph\u1ea9m trong \u0111\u01a1n hi\u1ec7n t\u1ea1i'}
                                            >
                                                <span className={`material-symbols-outlined text-xs ${isRefreshingItems ? 'animate-refresh-spin' : ''}`}>refresh</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={toggleOrderAiPanel}
                                                className={`ml-3 border-l border-primary/10 pl-3 transition-all ${showOrderAiPanel ? 'text-primary' : 'text-primary/30 hover:text-primary'}`}
                                                title={'Tìm nhanh bằng AI'}
                                            >
                                                <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
                                            </button>
                                            {productQuickFilterAttributes.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={openProductQuickFilterPanel}
                                                    className={`relative ml-3 border-l border-primary/10 pl-3 transition-all ${hasActiveProductQuickFilter ? 'text-primary' : 'text-primary/30 hover:text-primary'}`}
                                                    title={'Lọc nhanh theo thuộc tính'}
                                                >
                                                    <span className="material-symbols-outlined text-[15px]">tune</span>
                                                    {hasActiveProductQuickFilter && (
                                                        <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-primary px-1 text-center text-[9px] font-black leading-4 text-white">
                                                            {activeProductQuickFilterCount}
                                                        </span>
                                                    )}
                                                </button>
                                            )}
                                        </div>

                                        <OrderAiSearchPanel
                                            show={showOrderAiPanel}
                                            fileInputRef={orderAiFileInputRef}
                                            trainingRuleOptions={orderAiQuickRuleOptions}
                                            trainingRulesLoading={orderAiTrainingRulesLoading}
                                            selectedTrainingRuleValue={orderAiSelectedRuleKey}
                                            selectedTrainingRule={selectedOrderAiQuickRule}
                                            onTrainingRuleChange={handleOrderAiSelectedRuleChange}
                                            inputValue={orderAiInput}
                                            onInputChange={setOrderAiInput}
                                            onPaste={handleOrderAiPaste}
                                            onOpenRules={() => navigate('/admin/ai-training')}
                                            onReset={() => {
                                                setOrderAiSelectedRuleKey('');
                                                setOrderAiInput('');
                                                clearOrderAiFile();
                                                resetOrderAiPreviewState();
                                            }}
                                            onFileChange={handleOrderAiFileChange}
                                            file={orderAiFile}
                                            filePreviewUrl={orderAiFilePreviewUrl}
                                            onClearFile={clearOrderAiFile}
                                            onRun={handleRunOrderAiPreview}
                                            loading={orderAiLoading}
                                            lastRun={orderAiLastRun}
                                            preview={orderAiPreview}
                                            onUpdateItem={updateOrderAiPreviewItem}
                                            onOpenManualPicker={handleOpenOrderAiManualPicker}
                                            manualPickerLineId={orderAiManualPickerLineId}
                                            manualSearchTerm={orderAiManualSearchTerm}
                                            onManualSearchTermChange={setOrderAiManualSearchTerm}
                                            manualSearchResults={orderAiManualSearchResults}
                                            manualSearchLoading={orderAiManualSearchLoading}
                                            onSelectSuggestion={handleSelectOrderAiSuggestion}
                                            onResetPreview={resetOrderAiPreviewState}
                                            onApplyPreview={handleApplyOrderAiPreview}
                                            applying={orderAiApplying}
                                            currencyFormatter={quoteCurrencyFormatter}
                                        />

                                        {hasActiveProductQuickFilter && activeProductQuickFilterSummary && (
                                            <div className="mt-2 grid items-start gap-2 lg:grid-cols-[max-content_minmax(0,1fr)_max-content]">
                                                <button
                                                    type="button"
                                                    onClick={openProductQuickFilterPanel}
                                                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/15 bg-primary/[0.03] px-2.5 py-1.5 shadow-sm transition-all hover:border-primary/30 hover:bg-white"
                                                    title={'Mở lại bộ lọc nhanh'}
                                                >
                                                    <span className="material-symbols-outlined shrink-0 text-[12px] text-primary/35">tune</span>
                                                    <span className="min-w-0 truncate text-[11px] font-semibold leading-none text-primary/70">
                                                        {activeProductQuickFilterSummary}
                                                    </span>
                                                </button>
                                                <div className="relative min-w-0 w-full max-w-[880px] justify-self-start lg:min-w-[760px]">
                                                    <div className="rounded-sm border border-primary/10 bg-white shadow-sm">
                                                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="material-symbols-outlined text-[14px] text-primary/40">bolt</span>
                                                                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                    {'Lọc nhanh hơn'}
                                                                </span>
                                                                <span className="inline-flex items-center rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/55">
                                                                    {`${activeProductQuickSetupItems.length} SP`}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={toggleProductQuickSetupPanel}
                                                                    className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                                                >
                                                                    <span className="material-symbols-outlined text-[12px]">playlist_add</span>
                                                                    {showProductQuickSetupPanel ? 'Đóng' : (activeProductQuickSetupItems.length > 0 ? 'Sửa DS' : 'Khai báo nhanh')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={toggleProductQuickMode}
                                                                    disabled={isProductQuickModeToggleDisabled}
                                                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all ${isProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'} disabled:cursor-not-allowed disabled:opacity-40`}
                                                                >
                                                                    <span className="material-symbols-outlined text-[12px]">{isProductQuickModeActive ? 'flash_on' : 'flash_off'}</span>
                                                                    {isProductQuickModeActive ? 'Đang bật' : 'Đang tắt'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {showProductQuickSetupPanel && (
                                                        <div className="absolute left-0 top-full z-[115] mt-2 w-full overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
                                                            <div className="px-3 py-3">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <div className="flex min-w-[180px] flex-1 items-center rounded-sm border border-primary/10 bg-white px-3 h-9 shadow-sm">
                                                                        <span className="material-symbols-outlined text-[15px] text-primary/35 mr-2">search</span>
                                                                        <input
                                                                            ref={productQuickSetupSearchInputRef}
                                                                            type="text"
                                                                            value={productQuickSetupSearchTerm}
                                                                            onChange={(event) => setProductQuickSetupSearchTerm(event.target.value)}
                                                                            placeholder={`Tìm SP trong ${normalizedProductQuickFilterValues[0]}...`}
                                                                            className="w-full bg-transparent text-[12px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:outline-none"
                                                                        />
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setShowProductQuickSetupPanel(false)}
                                                                        className="h-9 px-3 rounded-sm border border-primary/10 bg-white text-[11px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                                                    >
                                                                        {'Xong'}
                                                                    </button>
                                                                </div>

                                                                <div className="mt-2 text-[10px] font-semibold text-primary/40">
                                                                    {activeProductQuickSetupItems.length > 0
                                                                        ? `Đang lưu ${activeProductQuickSetupItems.length} sản phẩm cho bộ lọc này.`
                                                                        : 'Chọn vài sản phẩm để tạo lớp lọc nhanh cho thuộc tính đang chọn.'}
                                                                </div>

                                                                <div ref={productQuickSetupListRef} className="mt-3 max-h-[420px] overflow-y-auto custom-scrollbar space-y-2 pr-1">
                                                                    {visibleProductQuickSetupProducts.length > 0 ? visibleProductQuickSetupProducts.map((product) => {
                                                                        const targetProductId = Number(product?.target_product_id ?? product?.product_id ?? product?.id);
                                                                        const setupEntryKey = getProductQuickSetupEntryKey(product);
                                                                        const entryKind = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT);
                                                                        const isVariation = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT) === SEARCH_ENTRY_VARIATION;
                                                                        const isBundleOption = entryKind === SEARCH_ENTRY_BUNDLE_OPTION;
                                                                        const isSelected = selectedQuickSetupEntryKeys.has(setupEntryKey);

                                                                        return (
                                                                            <button
                                                                                key={`setup-product-${setupEntryKey || targetProductId}`}
                                                                                type="button"
                                                                                onMouseDown={(event) => event.preventDefault()}
                                                                                onClick={() => handleToggleProductQuickSetupSelection(product, setupEntryKey, isSelected)}
                                                                                className={`w-full rounded-sm border px-3 py-2 text-left transition-all ${isSelected ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary hover:border-primary/25 hover:bg-white'}`}
                                                                            >
                                                                                <div className="flex items-center justify-between gap-3">
                                                                                    <div className="min-w-0">
                                                                                        <div className="truncate text-[12px] font-semibold text-[#0F172A]">
                                                                                            {product.display_name || product.name || '---'}
                                                                                        </div>
                                                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-primary/45">
                                                                                            {(product.display_sku || product.sku) && (
                                                                                                <span>{product.display_sku || product.sku}</span>
                                                                                            )}
                                                                                            {isVariation && product.option_label && (
                                                                                                <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">
                                                                                                    {product.option_label}
                                                                                                </span>
                                                                                            )}
                                                                                            {isBundleOption && product.bundle_option_title && (
                                                                                                <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">
                                                                                                    Bundle: {product.bundle_option_title}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="shrink-0 text-right">
                                                                                        <div className="text-[11px] font-black text-blue-600">
                                                                                            {quoteCurrencyFormatter.format(Number(product.price || 0))}đ
                                                                                        </div>
                                                                                        <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                                                                            {isSelected ? 'Đã chọn' : 'Thêm'}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </button>
                                                                        );
                                                                    }) : (
                                                                        <div className="rounded-sm border border-dashed border-primary/10 bg-white px-3 py-6 text-center text-[11px] italic text-primary/35">
                                                                            {'Không có sản phẩm phù hợp với bộ lọc hiện tại.'}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={disableProductQuickMode}
                                                    disabled={!isProductQuickModeActive}
                                                    className="inline-flex size-6 shrink-0 items-center justify-center self-center rounded-full border border-primary/10 bg-white text-primary/35 shadow-sm transition-all hover:border-brick/20 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40 lg:size-10"
                                                    title={'Tắt lọc nhanh hơn'}
                                                >
                                                    <span className="material-symbols-outlined text-[12px] lg:text-[18px]">close</span>
                                                </button>
                                            </div>
                                        )}

                                        {showSearchDropdown && (
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl rounded-sm z-[120] max-h-[400px] overflow-auto custom-scrollbar">
                                                {shouldShowProductQuickFilterPanel && (
                                                    <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-3">
                                                        <div className="flex flex-col gap-2">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <div className="flex flex-wrap items-center gap-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                            Lọc 1
                                                                        </div>
                                                                        <select
                                                                            value={productQuickFilterAttributeId || ''}
                                                                            onChange={(e) => handleProductQuickFilterAttributeChange(e.target.value)}
                                                                            className="h-8 min-w-[140px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                                                                        >
                                                                            {productQuickFilterAttributes.map((attribute) => (
                                                                                <option key={attribute.id} value={attribute.id}>
                                                                                    {attribute.name}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </div>

                                                                    {normalizedProductQuickFilterValues[0] && (
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                                Lọc 2
                                                                            </div>
                                                                            <select
                                                                                value={productQuickFilterAttributeId2 || ''}
                                                                                onChange={(e) => handleProductQuickFilterAttributeChange2(e.target.value)}
                                                                                className="h-8 min-w-[140px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                                                                            >
                                                                                <option value="">-- Chọn mẫu mã --</option>
                                                                                {productQuickFilterAttributes
                                                                                    .filter(attr => String(attr.id) !== String(productQuickFilterAttributeId))
                                                                                    .map((attribute) => (
                                                                                        <option key={attribute.id} value={attribute.id}>
                                                                                            {attribute.name}
                                                                                        </option>
                                                                                    ))}
                                                                            </select>
                                                                        </div>
                                                                    )}

                                                                    {hasActiveProductQuickFilter && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={clearProductQuickFilterValues}
                                                                            className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35 transition-colors hover:text-brick"
                                                                        >
                                                                            Xóa lọc
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {activeProductQuickFilterAttribute?.options?.length > 0 && (
                                                                <div className="flex flex-wrap gap-2">
                                                                    {activeProductQuickFilterAttribute.options.map((option) => {
                                                                        const isSelected = normalizedProductQuickFilterValues.includes(option.value);

                                                                        return (
                                                                            <button
                                                                                key={`${activeProductQuickFilterAttribute.id}-${option.id || option.value}`}
                                                                                type="button"
                                                                                onClick={() => toggleProductQuickFilterValue(option.value)}
                                                                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-primary/25 hover:bg-primary/5'}`}
                                                                            >
                                                                                <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                                                <span>{option.label || option.value}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            {normalizedProductQuickFilterValues[0] && activeProductQuickFilterAttribute2Options.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-2 border-t border-primary/5 pt-2">
                                                                    {activeProductQuickFilterAttribute2Options.map((option) => {
                                                                        const isSelected = normalizedProductQuickFilterValues2.includes(option.value);

                                                                        return (
                                                                            <button
                                                                                key={`${activeProductQuickFilterAttribute2.id}-${option.id || option.value}`}
                                                                                type="button"
                                                                                onClick={() => toggleProductQuickFilterValue2(option.value)}
                                                                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all ${isSelected ? 'border-brick bg-brick text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-brick/25 hover:bg-brick/5'}`}
                                                                            >
                                                                                <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                                                <span>{option.label || option.value}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                {showSearchHistory && (
                                                    <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-2">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                {'L\u1ecbch s\u1eed t\u00ecm ki\u1ebfm'}
                                                            </div>
                                                            {searchHistory.length > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={clearSearchHistory}
                                                                    className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35 hover:text-brick transition-colors"
                                                                >
                                                                    {'X\u00f3a h\u1ebft'}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {searchHistory.length > 0 ? searchHistory.map((term) => (
                                                                <button
                                                                    key={term}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setSearchTerm(term);
                                                                        setShowSearchDropdown(true);
                                                                        setShowSearchHistory(false);
                                                                    }}
                                                                    className="inline-flex items-center gap-1 rounded-sm border border-primary/10 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:border-primary/25 hover:bg-primary/5 transition-all"
                                                                >
                                                                    <span className="material-symbols-outlined text-[13px] text-primary/35">history</span>
                                                                    <span className="max-w-[220px] truncate">{term}</span>
                                                                </button>
                                                            )) : (
                                                                <div className="py-2 text-[11px] italic text-primary/30">
                                                                    {'Ch\u01b0a c\u00f3 l\u1ecbch s\u1eed t\u00ecm ki\u1ebfm.'}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                {rankedSearchProducts.map((p) => (
                                                    <ProductSearchOption
                                                        key={p.entry_id || p.id}
                                                        product={p}
                                                        onSelect={addProductById}
                                                        quickFilterAttribute={activeProductQuickFilterAttribute}
                                                        isAlreadyInOrder={Boolean(p.__alreadyInOrder)}
                                                    />
                                                ))}
                                                {(searchTerm.trim() !== '' || hasActiveProductQuickFilter) && rankedSearchProducts.length === 0 && (
                                                    <div className="p-4 text-center italic text-primary/20 text-[11px] uppercase font-black tracking-widest">Không có kết quả khả dụng...</div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Scrollable Product Chips - Strictly Single Row */}
                                    <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden custom-scrollbar rounded-sm border border-primary/10 bg-primary/5 px-2 pb-1 h-[42px]">
                                        {formData.items.map((item, index) => (
                                            <div
                                                key={item.line_id || `${item.product_id}-${index}`}
                                                onClick={() => handleSelectOrderLine(item.line_id)}
                                                className={`${hasActualOrderProductOverride(item) ? 'bg-rose-50 hover:bg-rose-100/60 border-rose-200' : 'bg-orange-50 hover:bg-orange-100/50 border-orange-200'} ${normalizeCanvasText(selectedOrderLineId) === normalizeCanvasText(item.line_id) ? 'ring-2 ring-primary/15' : ''} px-3 py-1.5 rounded-sm border flex items-center gap-2 transition-all group/chip relative shadow-sm shrink-0 cursor-pointer`}
                                            >
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className={`text-[10px] font-bold leading-none ${hasActualOrderProductOverride(item) ? 'text-rose-600/45' : 'text-orange-600/40'}`}>{index + 1}.</span>
                                                    <span className={`text-[11px] font-bold leading-none whitespace-nowrap tracking-tight ${hasActualOrderProductOverride(item) ? 'text-rose-700' : 'text-orange-600'}`}>{item.sku || 'N/A'}</span>
                                                    {isOrderAiItem(item) && (
                                                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${isPendingOrderAiItem(item) ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                                                            AI
                                                        </span>
                                                    )}
                                                </div>
                                                <button type="button" onClick={() => removeItem(item.line_id)} className="text-orange-400 hover:text-brick transition-all leading-none transform hover:scale-125">
                                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                                </button>

                                                {/* Name Tooltip on Hover */}
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded shadow-xl opacity-0 group-hover/chip:opacity-100 pointer-events-none transition-all whitespace-nowrap z-[150] border border-white/10 scale-90 group-hover/chip:scale-100 origin-bottom">
                                                    {item.name}
                                                    {item.options?.bundle_parent_name || item.options?.bundle_option_title ? (
                                                        <div className="mt-1 text-[10px] font-medium text-white/80">
                                                            {item.options?.bundle_parent_name ? `Bundle: ${item.options.bundle_parent_name}` : 'Bundle'}
                                                            {item.options?.bundle_option_title ? ` - ${item.options.bundle_option_title}` : ''}
                                                        </div>
                                                    ) : null}
                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-800"></div>
                                                </div>
                                            </div>
                                        ))}
                                        {/* Small spacer to ensure last item is visible */}
                                        <div className="w-4 shrink-0 h-full"></div>
                                    </div>
                                    {shouldShowOrderAiSummary && (
                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-sky-200 bg-sky-50 px-4 py-3">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">
                                                    AI đã đổ vào bảng sản phẩm
                                                </div>
                                                <div className="mt-1 text-[12px] font-semibold text-slate-700">
                                                    {orderAiLastRun
                                                        ? `Lần gần nhất: thêm/cập nhật ${orderAiLastRun.touchedCount || 0} dòng${orderAiLastRun.reviewCount ? `, ${orderAiLastRun.reviewCount} dòng cần rà nhanh` : ''}${orderAiLastRun.unresolvedCount ? `, ${orderAiLastRun.unresolvedCount} dòng chưa ghép` : ''}.`
                                                        : `Có ${pendingOrderAiItems.length} dòng AI đang chờ duyệt nhanh.`}
                                                </div>
                                                {orderAiLastRun?.unresolvedCount > 0 && (
                                                    <div className="mt-1 text-[11px] font-semibold text-slate-500">
                                                        {`Chưa ghép: ${(orderAiLastRun.unresolvedLabels || []).join(', ')}`}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {confirmedOrderAiItems.length > 0 && (
                                                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700">
                                                        {confirmedOrderAiItems.length} dòng AI đã xác nhận
                                                    </span>
                                                )}
                                                {hasLatestOrderAiInput && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowOrderAiInputReviewModal((prev) => !prev)}
                                                        className="inline-flex h-9 items-center gap-2 rounded-sm border border-sky-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-100/70"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">history</span>
                                                        Xem input AI
                                                    </button>
                                                )}
                                                {canClearLatestOrderAiRun && (
                                                    <button
                                                        type="button"
                                                        onClick={handleClearLatestOrderAiRun}
                                                        className="inline-flex h-9 items-center gap-2 rounded-sm border border-rose-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 transition-all hover:border-rose-300 hover:bg-rose-50"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                                                        Xóa toàn bộ kết quả AI
                                                    </button>
                                                )}
                                                {pendingOrderAiItems.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={handleConfirmPendingOrderAiItems}
                                                        className="inline-flex h-9 items-center gap-2 rounded-sm bg-sky-700 px-4 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-sky-800"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">verified</span>
                                                        {`Xác nhận nhanh ${pendingOrderAiItems.length} dòng AI`}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        )}

                        {isCompactOrderMobileLayout && orderAiSummaryBanner ? (
                            <div className="space-y-3 border-b border-primary/10 pb-4 lg:hidden">
                                {orderAiSummaryBanner}
                            </div>
                        ) : null}

                        {showActualProductSection && actualProductSectionLine ? (
                            <div
                                ref={actualProductSectionRef}
                                className={`mt-3 rounded-[18px] border px-4 py-3 shadow-sm ${hasActualOrderProductOverride(actualProductSectionLine) ? 'border-rose-200 bg-rose-50/80' : 'border-primary/10 bg-white'}`}
                            >
                                <div className="flex flex-col gap-3">
                                    {false && (
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Gửi sản phẩm khác</div>
                                            <div className="mt-1 text-[13px] font-semibold leading-[1.5] text-primary/60">
                                                Chọn dòng sản phẩm cần xử lý rồi mở bảng chọn sản phẩm thực gửi.
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleToggleActualProductSection}
                                            className="inline-flex items-center gap-1 self-start rounded-full border border-primary/10 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                            Tắt
                                        </button>
                                    </div>
                                    )}

                                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                                        <div className="min-w-0">
                                            {false && <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Dòng cần xử lý</div>}
                                            <select
                                                value={actualProductSectionLine.line_id || ''}
                                                onChange={(event) => handleActualProductSectionLineChange(event.target.value)}
                                                className="w-full rounded-[14px] border border-primary/10 bg-white px-3 py-2.5 text-[13px] font-semibold text-primary shadow-sm transition-all focus:border-primary/25 focus:outline-none"
                                            >
                                                {formData.items.map((item, index) => (
                                                    <option key={item.line_id || `${item.product_id}-${index}`} value={item.line_id || ''}>
                                                        {`${index + 1}. ${item.sku || 'N/A'} - ${item.name || 'Sản phẩm'}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={(event) => handleToggleActualProductPicker(actualProductSectionLine, event.currentTarget)}
                                                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all ${isActualProductPickerOpenForSectionLine ? 'border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50' : hasActualOrderProductOverride(actualProductSectionLine) ? 'border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50' : 'border-primary/10 bg-white text-primary/55 hover:border-primary/25 hover:text-primary'}`}
                                            >
                                                <span className="material-symbols-outlined text-[14px]">
                                                    {isActualProductPickerOpenForSectionLine ? 'close' : 'local_shipping'}
                                                </span>
                                                {isActualProductPickerOpenForSectionLine
                                                    ? 'Tắt bảng gửi khác'
                                                    : hasActualOrderProductOverride(actualProductSectionLine)
                                                        ? 'Đổi SP thực gửi'
                                                        : 'Chọn SP thực gửi'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleToggleActualProductSection}
                                                className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                                Tắt
                                            </button>
                                            {hasActualOrderProductOverride(actualProductSectionLine) ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handleClearActualProductOverride(actualProductSectionLine.line_id)}
                                                    className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                                                    Bỏ gửi khác
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>

                                    {false && (
                                    <div className="min-w-0 rounded-[14px] border border-primary/10 bg-white/80 px-3 py-3 shadow-sm">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Dòng đang chọn</div>
                                        <div className={`mt-1 truncate text-[14px] font-black leading-[1.35] ${hasActualOrderProductOverride(actualProductSectionLine) ? 'text-rose-700' : 'text-primary'}`}>
                                            {actualProductSectionLine.name || 'Sản phẩm'}
                                        </div>
                                        <div className="mt-1 text-[12px] font-semibold text-primary/50">
                                            {actualProductSectionLine.sku || 'N/A'}
                                        </div>
                                        {hasActualOrderProductOverride(actualProductSectionLine) ? (
                                            <div className="mt-2 text-[12px] font-semibold text-rose-700">
                                                {`Thực gửi: ${getOrderItemActualNameLabel(actualProductSectionLine) || 'Sản phẩm khác'}`}
                                            </div>
                                        ) : (
                                            <div className="mt-2 text-[12px] font-semibold text-primary/45">
                                                Chưa có sản phẩm thực gửi khác cho dòng này.
                                            </div>
                                        )}
                                    </div>
                                    )}
                                </div>
                            </div>
                        ) : null}

                        {false && selectedOrderLine ? (
                            <div className={`mt-3 rounded-[18px] border px-4 py-3 shadow-sm ${hasActualOrderProductOverride(selectedOrderLine) ? 'border-rose-200 bg-rose-50/80' : 'border-primary/10 bg-white'}`}>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Dòng đang chọn</div>
                                        <div className={`mt-1 truncate text-[14px] font-black leading-[1.35] ${hasActualOrderProductOverride(selectedOrderLine) ? 'text-rose-700' : 'text-primary'}`}>
                                            {selectedOrderLine.name || 'Sản phẩm'}
                                        </div>
                                        {hasActualOrderProductOverride(selectedOrderLine) ? (
                                            <div className="mt-1 text-[12px] font-semibold text-rose-700">
                                                {`Thực gửi: ${getOrderItemActualNameLabel(selectedOrderLine) || 'Sản phẩm khác'}`}
                                            </div>
                                        ) : (
                                            <div className="mt-1 text-[12px] font-semibold text-primary/45">Chọn thao tác đặc biệt cho dòng này khi cần gửi sản phẩm khác thực tế.</div>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={(event) => handleOpenActualProductPicker(
                                                selectedOrderLine.line_id,
                                                getOrderItemActualNameLabel(selectedOrderLine) || selectedOrderLine.name || selectedOrderLine.sku || '',
                                                event.currentTarget
                                            )}
                                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all ${hasActualOrderProductOverride(selectedOrderLine) ? 'border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50' : 'border-primary/10 bg-white text-primary/55 hover:border-primary/25 hover:text-primary'}`}
                                        >
                                            <span className="material-symbols-outlined text-[14px]">local_shipping</span>
                                            {hasActualOrderProductOverride(selectedOrderLine) ? 'Đổi SP thực gửi' : 'Gửi SP khác'}
                                        </button>
                                        {hasActualOrderProductOverride(selectedOrderLine) ? (
                                            <button
                                                type="button"
                                                onClick={() => handleClearActualProductOverride(selectedOrderLine.line_id)}
                                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                                                Bỏ gửi khác
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="mt-2 -mx-2 space-y-2 lg:hidden">
                            {formData.items.length === 0 ? (
                                <div className="rounded-[22px] border border-dashed border-primary/15 bg-white px-5 py-10 text-center shadow-sm">
                                    <div className="text-[14px] font-semibold leading-[1.45] text-primary/40">Chưa có sản phẩm</div>
                                    <div className="mt-2 text-[14px] leading-[1.55] text-primary/60">Bấm “Thêm sản phẩm” rồi chọn nhanh để tạo báo giá.</div>
                                </div>
                            ) : (
                                formData.items.map((item, index) => {
                                    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
                                    const canReplaceItem = Boolean(item.line_id);
                                    const isSelectedLine = normalizeCanvasText(selectedOrderLineId) === normalizeCanvasText(item.line_id);
                                    const hasActualOverride = hasActualOrderProductOverride(item);

                                    return (
                                        <div
                                            key={item.line_id || `${item.product_id}-${index}`}
                                            onClick={() => handleSelectOrderLine(item.line_id)}
                                            className={`rounded-[18px] border px-2.5 py-2 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.35)] ${
                                                hasActualOverride
                                                    ? 'border-rose-200 bg-rose-50/70'
                                                    : isPendingOrderAiItem(item)
                                                    ? 'border-amber-200 bg-amber-50/70'
                                                    : isOrderAiItem(item)
                                                        ? 'border-sky-200 bg-sky-50/70'
                                                        : 'border-primary/10 bg-white'
                                            } ${isSelectedLine ? 'ring-2 ring-primary/15' : ''}`}
                                        >
                                            <div className="flex items-start gap-2">
                                                <div
                                                    className="relative flex-none size-12 rounded bg-primary/[0.05] overflow-hidden group cursor-pointer border border-primary/10"
                                                    onClick={(e) => { e.stopPropagation(); toggleLineItemSelection(item.line_id); }}
                                                >
                                                    {item.main_image ? (
                                                        <img src={item.main_image} alt="" className="size-full object-cover" />
                                                    ) : (
                                                        <div className="size-full flex items-center justify-center text-[12px] font-semibold text-primary/40">
                                                            #{index + 1}
                                                        </div>
                                                    )}
                                                    <div className={`absolute inset-0 flex items-center justify-center bg-black/10 transition-opacity ${selectedLineItemIds.has(item.line_id) ? 'opacity-100' : 'opacity-0'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedLineItemIds.has(item.line_id)}
                                                            onChange={() => {}}
                                                            className="size-4 rounded border-white text-primary focus:ring-primary/30 cursor-pointer pointer-events-none"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <div className={`text-[14px] font-black leading-[1.35] ${hasActualOverride ? 'text-rose-700' : 'text-primary'}`}>{item.name || 'Sản phẩm'}</div>
                                                            {item.replaced_from_name && (
                                                                <p className="text-[11px] font-medium text-slate-400 mt-0.5 italic line-through truncate" title={`Đổi từ: ${item.replaced_from_name}`}>
                                                                    {item.replaced_from_name}
                                                                </p>
                                                            )}
                                                            {hasActualOverride ? (
                                                                <div className="mt-1 text-[12px] font-semibold leading-[1.4] text-rose-700">
                                                                    {`Thực gửi: ${getOrderItemActualNameLabel(item) || 'Sản phẩm khác'}`}
                                                                </div>
                                                            ) : null}
                                                            {isOrderAiItem(item) && (
                                                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-none ${isPendingOrderAiItem(item) ? 'border-amber-200 bg-white text-amber-700' : 'border-sky-200 bg-white text-sky-700'}`}>
                                                                        {isPendingOrderAiItem(item) ? 'Ai chờ duyệt' : 'Ai đã ghép'}
                                                                    </span>
                                                                    {item.ai_meta?.confidence_label && (
                                                                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-white px-2.5 py-1 text-[12px] font-semibold leading-none text-primary/55">
                                                                            {item.ai_meta.confidence_label}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="shrink-0 text-right">
                                                            <div className="text-[11px] font-semibold leading-none text-primary/40">Thành tiền</div>
                                                            <div className="mt-1 text-[17px] font-black leading-none text-brick">
                                                                {formatQuoteMoney(itemTotal)}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="mt-1.5 grid grid-cols-[104px_minmax(0,1fr)_40px_40px] items-center gap-1.5">
                                                        <div className="rounded-[13px] border border-primary/10 bg-[#f8fbff] px-1 py-1">
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateItem(index, 'quantity', nudgeQuantityInputValue(item.quantity, -1))}
                                                                    className="inline-flex size-[30px] items-center justify-center rounded-full border border-primary/10 bg-white text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03]"
                                                                >
                                                                    <span className="material-symbols-outlined text-[15px]">remove</span>
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    inputMode="decimal"
                                                                    min="1"
                                                                    step="1"
                                                                    value={item.quantity}
                                                                    onChange={(event) => updateItem(index, 'quantity', normalizeQuantityInputValue(event.target.value))}
                                                                    onPointerDown={(event) => handleQuantityInputPointerDown(
                                                                        event,
                                                                        item.quantity,
                                                                        (nextValue) => updateItem(index, 'quantity', nextValue)
                                                                    )}
                                                                    onKeyDown={(event) => handleQuantityInputKeyDown(
                                                                        event,
                                                                        item.quantity,
                                                                        (nextValue) => updateItem(index, 'quantity', nextValue)
                                                                    )}
                                                                    className="h-[30px] w-full rounded-[11px] border border-primary/10 bg-white px-1.5 text-center text-[13px] font-black text-primary focus:border-primary/25 focus:outline-none"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateItem(index, 'quantity', nudgeQuantityInputValue(item.quantity, 1))}
                                                                    className="inline-flex size-[30px] items-center justify-center rounded-full border border-primary/10 bg-white text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03]"
                                                                >
                                                                    <span className="material-symbols-outlined text-[15px]">add</span>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="flex h-10 items-center rounded-[13px] border border-primary/10 bg-[#f8fbff] px-2.5">
                                                                <input
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    value={new Intl.NumberFormat('vi-VN').format(item.price)}
                                                                    onChange={(event) => {
                                                                        const nextValue = event.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                                        updateItem(index, 'price', parseInt(nextValue, 10) || 0);
                                                                    }}
                                                                    className="h-full w-full bg-transparent text-[13px] font-semibold leading-[1.35] text-primary focus:outline-none"
                                                                />
                                                                <span className="text-[12px] font-semibold text-primary/35">đ</span>
                                                        </div>

                                                        <button
                                                            type="button"
                                                            onClick={(event) => canReplaceItem && handleOpenOrderAiReplacePicker(
                                                                item.line_id,
                                                                item.ai_meta?.source_phrase || item.name || item.sku || '',
                                                                event.currentTarget
                                                            )}
                                                            disabled={!canReplaceItem}
                                                            className="inline-flex size-10 items-center justify-center rounded-[13px] border border-sky-200 bg-white text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                            title={isOrderAiItem(item) ? 'Đổi sản phẩm AI' : 'Đổi sản phẩm'}
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeItem(item.line_id)}
                                                            className="inline-flex size-10 items-center justify-center rounded-[13px] border border-rose-200 bg-white text-rose-700 transition-all hover:bg-rose-50"
                                                            title="Xóa"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">delete_outline</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}

                        </div>

                        {/* Captured Area for Screenshot */}
                        <div ref={captureRef} className="mt-[10px] hidden overflow-hidden rounded-sm border border-primary/10 bg-white shadow-xl lg:block">
                            <div ref={orderFormTableViewportRef} className="relative min-h-[400px] overflow-y-auto overflow-x-auto order-form-table" style={desktopTableStyleVars}>
                                <table className="text-left border-collapse table-fixed" style={{ width: `${desktopTablePixelWidth}px`, minWidth: `${desktopTablePixelWidth}px` }}>
                                    <colgroup>
                                        <col style={{ width: `${ORDER_FORM_TABLE_DRAG_COLUMN_WIDTH}px` }} />
                                        {desktopVisibleColumnIds.map((colId) => (
                                            <col
                                                key={`order-form-col-${colId}`}
                                                style={{ width: `${desktopAutoColumnWidths[colId] || getOrderFormPreferredColumnWidth(colId, columnWidths, desktopTableMetrics)}px` }}
                                            />
                                        ))}
                                    </colgroup>
                                    <thead className="admin-table-header sticky top-0 z-30 shadow-sm border-b border-primary/10">
                                        <tr>
                                            {/* Column Config Header */}
                                            <th
                                                className="order-form-header-cell order-form-header-cell-tight border border-primary/10 bg-[#F0F4F8] shrink-0 relative text-center sticky top-0 z-30"
                                                style={{
                                                    width: `${ORDER_FORM_TABLE_DRAG_COLUMN_WIDTH}px`,
                                                    minWidth: `${ORDER_FORM_TABLE_DRAG_COLUMN_WIDTH}px`,
                                                }}
                                            >
                                                <div className="flex items-center justify-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowColumnConfig(!showColumnConfig)}
                                                        className="size-7 flex items-center justify-center hover:bg-primary/10 rounded-full transition-colors group z-50"
                                                        title="Cấu hình cột"
                                                    >
                                                        <span className="material-symbols-outlined text-primary/30 group-hover:text-primary text-lg">settings_backup_restore</span>
                                                    </button>

                                                    <AnimatePresence>
                                                        {showColumnConfig && (
                                                            <>
                                                                <div className="fixed inset-0 z-[190]" onClick={() => setShowColumnConfig(false)} />
                                                                <motion.div
                                                                    initial={{ opacity: 0, x: -10 }}
                                                                    animate={{ opacity: 1, x: 0 }}
                                                                    exit={{ opacity: 0, x: -10 }}
                                                                    className="absolute top-10 left-0 bg-white border border-primary/10 shadow-2xl rounded-sm p-4 z-[200] w-72 normal-case text-left [&>h4]:hidden"
                                                                >
                                                                    <h4 className="font-sans text-sm font-bold text-primary/50 mb-4">Cấu hình cột hiển thị</h4>
                                                                    <div className="mb-3 flex items-center justify-end gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={saveColumnSettingsDefault}
                                                                            className="inline-flex size-8 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5"
                                                                            title="Lưu mặc định"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[16px]">save</span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={resetColumnSettingsDefault}
                                                                            className="inline-flex size-8 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5"
                                                                            title="Reset mặc định"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                                                                        </button>
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        <Reorder.Group axis="y" values={columnOrder} onReorder={setColumnOrder} className="space-y-1">
                                                                            {columnOrder.map(colId => (
                                                                                <Reorder.Item key={colId} value={colId} className="flex items-center justify-between p-2 hover:bg-primary/5 rounded-sm cursor-grab active:cursor-grabbing border border-transparent hover:border-primary/10 group transition-all">
                                                                                    <div className="flex items-center gap-3">
                                                                                        <span className="material-symbols-outlined text-[16px] text-primary/20 group-hover:text-primary/40">drag_indicator</span>
                                                                                        <span className="text-[12px] font-bold text-primary">{COLUMN_DEFS[colId].label}</span>
                                                                                    </div>
                                                                                    {(() => {
                                                                                        const isRequiredVisibleColumn = ORDER_FORM_REQUIRED_VISIBLE_COLUMN_IDS.includes(colId);
                                                                                        return (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (isRequiredVisibleColumn) {
                                                                                                return;
                                                                                            }
                                                                                            if (visibleColumns.includes(colId)) {
                                                                                                const nextVisibleColumns = normalizeStoredOrderFormVisibleColumns(visibleColumns.filter(c => c !== colId));
                                                                                                setVisibleColumns(nextVisibleColumns);
                                                                                                writeOrderFormStorageJson(orderFormVisibleColumnsStorageKey, nextVisibleColumns);
                                                                                            } else {
                                                                                                const nextVisibleColumns = normalizeStoredOrderFormVisibleColumns([...visibleColumns, colId]);
                                                                                                setVisibleColumns(nextVisibleColumns);
                                                                                                writeOrderFormStorageJson(orderFormVisibleColumnsStorageKey, nextVisibleColumns);
                                                                                            }
                                                                                        }}
                                                                                        disabled={isRequiredVisibleColumn}
                                                                                        title={isRequiredVisibleColumn ? 'Cột bắt buộc hiển thị' : 'Bật/tắt cột'}
                                                                                        className={`material-symbols-outlined text-lg ${isRequiredVisibleColumn ? 'cursor-not-allowed text-primary/25' : visibleColumns.includes(colId) ? 'text-primary' : 'text-primary/10'}`}
                                                                                    >
                                                                                        {visibleColumns.includes(colId) ? 'visibility' : 'visibility_off'}
                                                                                    </button>
                                                                                        );
                                                                                    })()}
                                                                                </Reorder.Item>
                                                                            ))}
                                                                        </Reorder.Group>
                                                                        <div className="hidden">
                                                                            <div className="mb-2 text-[11px] font-semibold leading-[1.45] text-primary/45">
                                                                                Resize cột sẽ tự lưu ngay khi thả chuột. Có thể lưu cấu hình hiện tại làm mặc định riêng.
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={saveColumnSettingsDefault}
                                                                                className="mb-2 inline-flex w-full items-center justify-center gap-1 rounded-sm border border-primary/15 bg-white px-3 py-2 text-[11px] font-bold text-primary transition hover:border-primary hover:bg-primary/5"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[15px]">save</span>
                                                                                Lưu mặc định
                                                                            </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={resetColumnSettingsDefault}
                                                                            className="inline-flex w-full items-center justify-center gap-1 rounded-sm border border-primary/15 bg-white px-3 py-2 text-[11px] font-bold text-primary transition hover:border-primary hover:bg-primary/5"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                                                                            Reset mặc định
                                                                        </button>
                                                                    </div>
                                                                    </div>
                                                                </motion.div>
                                                            </>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </th>
                                            {desktopVisibleColumnIds.map((colId) => {
                                                const def = COLUMN_DEFS[colId];
                                                const width = desktopAutoColumnWidths[colId] || getOrderFormPreferredColumnWidth(colId, columnWidths, desktopTableMetrics);
                                                const isActionColumn = colId === 'actions';
                                                return (
                                                    <th
                                                        key={colId}
                                                        className={`order-form-header-cell border border-primary/10 text-${def.align} relative group/header sticky top-0 z-30 bg-[#F0F4F8]`}
                                                        style={{
                                                            width: `${width}px`,
                                                            minWidth: `${width}px`,
                                                            maxWidth: `${width}px`,
                                                        }}
                                                    >
                                                        <div className={`flex min-w-0 items-center ${getOrderFormHeaderJustifyClass(def.align)}`}>
                                                            {isActionColumn ? (
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <AnimatePresence>
                                                                        {hasAnyLineItemSelected && (
                                                                            <motion.button
                                                                                initial={{ opacity: 0, scale: 0.5 }}
                                                                                animate={{ opacity: 1, scale: 1 }}
                                                                                exit={{ opacity: 0, scale: 0.5 }}
                                                                                type="button"
                                                                                onClick={handleBulkReplace}
                                                                                onMouseDown={(event) => event.stopPropagation()}
                                                                                className="order-form-header-action-icon flex items-center justify-center rounded-sm text-sky-600 transition-all hover:bg-sky-50 hover:text-sky-700"
                                                                                title="Đổi mẫu mã hàng loạt cho các mục đã chọn"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                                                                            </motion.button>
                                                                        )}
                                                                    </AnimatePresence>
                                                                    <button
                                                                        type="button"
                                                                        onClick={handleRemoveAllItems}
                                                                        onMouseDown={(event) => event.stopPropagation()}
                                                                        disabled={formData.items.length === 0}
                                                                        className="order-form-action-button inline-flex items-center justify-center rounded-sm text-primary/30 transition-all hover:bg-rose-50 hover:text-brick disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-primary/30"
                                                                        title="Xóa toàn bộ sản phẩm trong đơn"
                                                                    >
                                                                        <span className="order-form-action-icon material-symbols-outlined">delete_sweep</span>
                                                                    </button>
                                                                </div>
                                                            ) : colId === 'selection' ? (
                                                                <div className="flex items-center justify-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isAllLineItemsSelected}
                                                                        onChange={toggleAllLineItemSelection}
                                                                        className="size-4 rounded border-primary/20 text-primary focus:ring-primary/30 cursor-pointer"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <OrderFormHeaderLabel label={def.label} tooltip={def.tooltip} />
                                                            )}
                                                        </div>
                                                        {/* Resize Handle */}
                                                        <div
                                                            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 z-20 transition-colors opacity-0 group-hover/header:opacity-100"
                                                            onMouseDown={(e) => handlePersistedColumnResize(colId, e)}
                                                        />
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <Reorder.Group axis="y" values={formData.items} onReorder={handleReorder} as="tbody" className="font-sans text-sm font-medium">
                                        {formData.items.map((item, index) => (
                                            <Reorder.Item
                                                key={item.line_id || `${item.product_id}-${index}`}
                                                value={item}
                                                as="tr"
                                                onClick={() => handleSelectOrderLine(item.line_id)}
                                                className={`transition-colors group cursor-grab active:cursor-grabbing active:border-primary/20 ${hasActualOrderProductOverride(item) ? 'bg-rose-50/60 hover:bg-rose-50/80' : isPendingOrderAiItem(item) ? 'bg-amber-50/50 hover:bg-amber-50/70' : isOrderAiItem(item) ? 'bg-sky-50/40 hover:bg-sky-50/60' : 'bg-white hover:bg-primary/[0.01]'} ${normalizeCanvasText(selectedOrderLineId) === normalizeCanvasText(item.line_id) ? 'ring-2 ring-inset ring-primary/15' : ''}`}
                                            >
                                                <td className="order-form-cell order-form-cell-tight border border-primary/10 bg-primary/5 text-center">
                                                    <span className="order-form-row-icon material-symbols-outlined text-primary/10 group-hover:text-primary/30 font-bold">drag_indicator</span>
                                                </td>
                                                {desktopVisibleColumnIds.map(colId => {
                                                    switch (colId) {
                                                        case 'selection':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-tight text-center border border-primary/10">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedLineItemIds.has(item.line_id)}
                                                                        onChange={() => toggleLineItemSelection(item.line_id)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="size-4 rounded border-primary/20 text-primary focus:ring-primary/30 cursor-pointer"
                                                                    />
                                                                </td>
                                                            );
                                                        case 'stt':
                                                            return <td key={colId} className="order-form-cell order-form-cell-tight text-center text-primary/30 font-sans font-bold border border-primary/10">{index + 1}</td>;
                                                        case 'sku':
                                                            return (
                                                                <td key={colId} className="order-form-cell border border-primary/10 relative group/cell">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <p className={`font-sans font-bold leading-none truncate flex-1 min-w-0 ${hasActualOrderProductOverride(item) ? 'text-rose-700' : 'text-primary'}`}>{item.sku || '---'}</p>
                                                                        {item.sku && (
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                                onClick={(e) => handleCopyCellValue(item.sku, 'mã sản phẩm', e, `${item.line_id || item.product_id}-sku-${index}`)}
                                                                                className={`${copiedText === `${item.line_id || item.product_id}-sku-${index}` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`}
                                                                                title="Sao chép mã SP"
                                                                            >
                                                                                <span className="order-form-cell-copy-icon material-symbols-outlined">{copiedText === `${item.line_id || item.product_id}-sku-${index}` ? 'check' : 'content_copy'}</span>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <div className="absolute bottom-full left-4 mb-2 bg-slate-900 text-white p-2 rounded shadow-2xl opacity-0 group-hover/cell:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap text-[11px] font-bold border border-white/10 scale-90 group-hover/cell:scale-100 origin-bottom-left">
                                                                        Mã: {item.sku || 'N/A'}
                                                                        <div className="absolute top-full left-2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-900"></div>
                                                                    </div>
                                                                </td>
                                                                );
                                                        case 'name': {
                                                            const itemNameCellKey = `${item.line_id || item.product_id || index}-name-cell`;
                                                            const nameCopyId = `${item.line_id || item.product_id}-name-${index}`;
                                                            const isNameTooltipVisible = activeTruncatedNameCellKey === itemNameCellKey;

                                                            return (
                                                                <td
                                                                    key={colId}
                                                                    className="order-form-cell border border-primary/10 relative group/cell"
                                                                    onMouseEnter={() => updateActiveTruncatedNameCell(itemNameCellKey)}
                                                                    onMouseLeave={() => clearActiveTruncatedNameCell(itemNameCellKey)}
                                                                >
                                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                                        <div className="flex-1 min-w-0">
                                                                            <p
                                                                                ref={(node) => setOrderItemNameRef(itemNameCellKey, node)}
                                                                                className={`${hasActualOrderProductOverride(item) ? 'text-rose-700' : 'text-primary'} font-bold leading-tight truncate`}
                                                                            >
                                                                                {item.name}
                                                                            </p>
                                                                            {item.replaced_from_name && (
                                                                                <p className="text-[11px] font-medium text-slate-400 mt-0.5 italic line-through truncate" title={`Đổi từ: ${item.replaced_from_name}`}>
                                                                                    {item.replaced_from_name}
                                                                                </p>
                                                                            )}
                                                                            {hasActualOrderProductOverride(item) ? (
                                                                                <div className="order-form-cell-meta truncate font-semibold text-rose-700">
                                                                                    {`Thực gửi: ${getOrderItemActualNameLabel(item) || 'Sản phẩm khác'}`}
                                                                                </div>
                                                                            ) : null}
                                                                            {isOrderAiItem(item) && (
                                                                                <div className="order-form-cell-meta flex flex-wrap items-center gap-1.5">
                                                                                    <span className={`order-form-badge inline-flex items-center rounded-full border font-black uppercase tracking-[0.12em] ${isPendingOrderAiItem(item) ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                                                                                        {isPendingOrderAiItem(item) ? 'AI chờ duyệt' : 'AI'}
                                                                                    </span>
                                                                                    <span className="order-form-badge inline-flex items-center rounded-full border border-primary/10 bg-white font-bold uppercase tracking-[0.08em] text-primary/60">
                                                                                        {item.ai_meta?.confidence_label || 'AI'} {Number(item.ai_meta?.confidence || 0) > 0 ? `${item.ai_meta.confidence}%` : ''}
                                                                                    </span>
                                                                                    {item.ai_meta?.matched_rule_label && (
                                                                                        <span className="order-form-badge inline-flex items-center rounded-full border border-primary/10 bg-white font-bold uppercase tracking-[0.08em] text-primary/55">
                                                                                            Bản {item.ai_meta.matched_rule_label}
                                                                                        </span>
                                                                                    )}
                                                                                    {item.ai_meta?.matched_rule_context && (
                                                                                        <span className="order-form-badge inline-flex items-center rounded-full border border-primary/10 bg-white font-bold uppercase tracking-[0.08em] text-primary/55">
                                                                                            {item.ai_meta.matched_rule_context}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                            {item.options?.bundle_parent_name || item.options?.bundle_option_title ? (
                                                                                <div className="order-form-cell-meta truncate font-semibold text-primary/55">
                                                                                    {item.options?.bundle_parent_name ? `Từ bundle: ${item.options.bundle_parent_name}` : 'Từ bundle'}
                                                                                    {item.options?.bundle_option_title ? ` - ${item.options.bundle_option_title}` : ''}
                                                                                </div>
                                                                            ) : null}
                                                                        </div>
                                                                        {item.name && (
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                                onClick={(e) => handleCopyCellValue(item.name, 'tên sản phẩm', e, nameCopyId)}
                                                                                className={`${copiedText === nameCopyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`}
                                                                                title="Sao chép tên SP"
                                                                            >
                                                                                <span className="order-form-cell-copy-icon material-symbols-outlined">{copiedText === nameCopyId ? 'check' : 'content_copy'}</span>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    {isNameTooltipVisible && (
                                                                        <div className={`absolute left-4 bg-slate-900 text-white p-3 rounded shadow-2xl pointer-events-none z-50 w-80 text-[12px] font-bold border border-white/10 leading-relaxed ${index === 0 ? 'top-full mt-2 origin-top-left' : 'bottom-full mb-2 origin-bottom-left'}`}>
                                                                            <div>{item.name}</div>
                                                                            {hasActualOrderProductOverride(item) ? (
                                                                                <div className="mt-2 border-t border-white/15 pt-2 text-[11px] font-medium text-rose-200">
                                                                                    {`Thực gửi: ${getOrderItemActualNameLabel(item) || 'Sản phẩm khác'}`}
                                                                                </div>
                                                                            ) : null}
                                                                            {isOrderAiItem(item) && (
                                                                                <div className="mt-2 border-t border-white/15 pt-2 text-[11px] font-medium text-white/80">
                                                                                    {`AI: ${item.ai_meta?.source_phrase || 'Tự động ghép'}${item.ai_meta?.match_reasons?.length ? ` - ${item.ai_meta.match_reasons.join(', ')}` : ''}`}
                                                                                </div>
                                                                            )}
                                                                            {item.options?.bundle_parent_name || item.options?.bundle_option_title ? (
                                                                                <div className="mt-2 border-t border-white/15 pt-2 text-[11px] font-medium text-white/80">
                                                                                    {item.options?.bundle_parent_name ? `Bundle gốc: ${item.options.bundle_parent_name}` : 'Bundle gốc'}
                                                                                    {item.options?.bundle_option_title ? ` - ${item.options.bundle_option_title}` : ''}
                                                                                </div>
                                                                            ) : null}
                                                                            <div className={`absolute left-4 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent ${index === 0 ? 'bottom-full border-b-[5px] border-b-slate-900' : 'top-full border-t-[5px] border-t-slate-900'}`}></div>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            );
                                                        }
                                                        case 'quantity':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-tight border border-primary/10 text-center">
                                                                    <input
                                                                        type="number"
                                                                        inputMode="decimal"
                                                                        min="1"
                                                                        step="1"
                                                                        value={item.quantity}
                                                                        onChange={(e) => updateItem(index, 'quantity', normalizeQuantityInputValue(e.target.value))}
                                                                        onPointerDown={(e) => handleQuantityInputPointerDown(
                                                                            e,
                                                                            item.quantity,
                                                                            (nextValue) => updateItem(index, 'quantity', nextValue)
                                                                        )}
                                                                        onKeyDown={(e) => handleQuantityInputKeyDown(
                                                                            e,
                                                                            item.quantity,
                                                                            (nextValue) => updateItem(index, 'quantity', nextValue)
                                                                        )}
                                                                        className="order-form-quantity-input w-full min-w-0 text-center bg-blue-50/50 border-none focus:bg-white focus:ring-1 focus:ring-blue-200 focus:outline-none font-bold rounded-sm shadow-inner text-slate-900"
                                                                    />
                                                                </td>
                                                            );
                                                        case 'unit':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-tight border border-primary/10 text-center">
                                                                    <span className="font-sans font-bold text-primary/65">{getOrderUnitDisplay(item)}</span>
                                                                </td>
                                                            );
                                                        case 'available_to_sell': {
                                                            const availableToSell = parseQuantityNumber(item.available_to_sell);

                                                            return (
                                                                <td
                                                                    key={colId}
                                                                    className="order-form-cell order-form-cell-tight border border-primary/10 text-center"
                                                                    title={buildAvailableToSellCellTitle(item)}
                                                                >
                                                                    <span className={`font-sans font-black ${getAvailableToSellTextClass(availableToSell)}`}>
                                                                        {availableToSell !== null ? formatOrderFormQuantity(availableToSell) : '...'}
                                                                    </span>
                                                                </td>
                                                            );
                                                        }
                                                        case 'price':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-number border border-primary/10">
                                                                    <div className="flex items-center justify-end">
                                                                        <input
                                                                            type="text"
                                                                            value={new Intl.NumberFormat('vi-VN').format(item.price)}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                                                updateItem(index, 'price', parseInt(val) || 0);
                                                                            }}
                                                                            className="order-form-money-input w-full min-w-0 bg-transparent border-none text-right font-sans font-bold text-slate-900 border-b border-blue-100 focus:border-blue-300 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-slate-900/30 text-[11px] ml-1">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'cost_price':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-number border border-primary/10">
                                                                    <div className="flex items-center justify-end">
                                                                        <input
                                                                            type="text"
                                                                            value={formatRoundedImportCost(item.cost_price)}
                                                                            onChange={(e) => {
                                                                                updateItem(index, 'cost_price', normalizeRoundedImportCostNumber(e.target.value) ?? 0);
                                                                            }}
                                                                            className="order-form-money-input w-full min-w-0 bg-transparent border-none text-right font-sans font-bold text-primary/30 border-b border-primary/5 focus:border-primary/10 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-primary text-[10px] ml-1 opacity-10">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'total':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-number border border-primary/10 text-right bg-blue-50/30">
                                                                    <p className="font-sans font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
                                                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(item.price * item.quantity)}<span className="text-[11px] ml-0.5 opacity-40">₫</span>
                                                                    </p>
                                                                </td>
                                                            );
                                                        case 'actions':
                                                            return (
                                                                <td key={colId} className="order-form-cell order-form-cell-tight text-center border border-primary/10 align-top">
                                                                    <div className="flex justify-center">
                                                                        <div className="flex items-center gap-1">
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(event) => event.stopPropagation()}
                                                                                onClick={(event) => handleOpenOrderAiReplacePicker(
                                                                                    item.line_id,
                                                                                    item.ai_meta?.source_phrase || item.name || item.sku || '',
                                                                                    event.currentTarget
                                                                                )}
                                                                                className="order-form-action-button inline-flex items-center justify-center rounded-sm border border-sky-200 bg-sky-50 text-sky-700 opacity-0 translate-x-1 pointer-events-none transition-all hover:border-sky-300 hover:bg-sky-100 group-hover:translate-x-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                                                                                title={isOrderAiItem(item) ? 'Đổi sản phẩm AI' : 'Đổi sản phẩm'}
                                                                            >
                                                                                <span className="order-form-action-icon material-symbols-outlined">swap_horiz</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(event) => event.stopPropagation()}
                                                                                onClick={() => removeItem(item.line_id)}
                                                                                className="order-form-action-button inline-flex items-center justify-center rounded-sm text-primary/20 transition-all hover:bg-rose-50 hover:text-brick"
                                                                                title="Xóa dòng"
                                                                            >
                                                                                <span className="order-form-action-icon material-symbols-outlined">delete_outline</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            );
                                                        default:
                                                            return null;
                                                    }
                                                })}
                                            </Reorder.Item>
                                        ))}
                                        {formData.items.length === 0 && (
                                            <tr>
                                                <td colSpan={desktopVisibleColumnIds.length + 1} className="order-form-cell border border-primary/10 bg-primary/5 py-16 text-center italic text-primary/30 font-bold">Phần này để hiển thị sản phẩm đã chọn...</td>
                                            </tr>
                                        )}
                                    </Reorder.Group>
                                </table>
                            </div>

                            <div className="flex items-center justify-between gap-4 px-4 py-5 border-t border-primary/10 bg-white">
                                <div className="flex min-w-0 items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleToggleActualProductSection}
                                        disabled={formData.items.length === 0}
                                        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] shadow-sm transition-all ${showActualProductSection ? 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100/70' : 'border-primary/10 bg-white text-primary/60 hover:border-primary/25 hover:text-primary'} disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            {showActualProductSection ? 'close' : 'local_shipping'}
                                        </span>
                                        {showActualProductSection ? 'Tắt gửi SP khác' : 'Gửi SP khác'}
                                    </button>
                                    {showActualProductSection ? (
                                        <div className="hidden text-[12px] font-semibold text-primary/45 lg:block">
                                            Đã bật chế độ gửi sản phẩm khác. Chọn dòng trong panel để xử lý nhanh.
                                        </div>
                                    ) : null}
                                </div>
                                <div className="flex items-baseline gap-4">
                                    <span className="font-sans font-bold text-brick/60 text-[12px]">Tổng thanh toán:</span>
                                    <span className="font-sans font-black text-brick text-[32px] leading-none tracking-tighter">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(totalPaymentAmount)}<span className="text-[16px] ml-1 opacity-40 font-bold">₫</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end p-4 border-t border-primary/10 bg-primary/[0.02]">
                            {/* Right: Totals */}
                            <div className="space-y-4 font-sans min-w-[340px]">
                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Tổng tiền sản phẩm:</span>
                                    <span className="font-bold text-blue-600 text-[16px] leading-none">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(subtotalAmount)}₫
                                    </span>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Phí vận chuyển:</span>
                                    <div className="flex items-center gap-1 border-b border-blue-600/10 transition-colors">
                                        <input
                                            type="text"
                                            value={new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(quotePricingSummary.shippingFee)}
                                            readOnly
                                            title="Tự động đồng bộ từ vận đơn hoặc trạng thái gửi hàng."
                                            className="w-24 text-right bg-transparent py-1 font-bold text-blue-600 text-[15px] focus:outline-none cursor-default placeholder:text-blue-600/10"
                                        />
                                        <span className="font-bold text-blue-600 text-[15px]">₫</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Chiết khấu/Giảm:</span>
                                    <div className="flex items-center gap-1 border-b border-blue-600/10 focus-within:border-blue-600/40 transition-colors">
                                        <input
                                            ref={discountInputRef}
                                            type="text"
                                            value={discountInputValue}
                                            onChange={handleDiscountInputChange}
                                            onBlur={handleDiscountInputBlur}
                                            className="w-24 text-right bg-transparent py-1 font-bold text-brick text-[15px] focus:outline-none placeholder:text-blue-600/10"
                                        />
                                        <span className="font-bold text-brick text-[15px]">₫</span>
                                    </div>
                                </div>
                                {normalizedOrderType === ORDER_TYPE_PARTIAL_DELIVERY && automaticDiscountAdjustment > 0 && (
                                    <div className="text-right text-[11px] font-semibold text-blue-600/45" data-screenshot-hide="true">
                                        Da gom hang tra ve: +
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(automaticDiscountAdjustment)} VND
                                    </div>
                                )}

                                <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-blue-600/10" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/30 text-[12px]">Tổng giá vốn nhập:</span>
                                    <div className="flex items-center gap-1 font-bold text-blue-600/50 text-sm">
                                        <span className="bg-blue-600/5 px-2 py-0.5 rounded-sm">{new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(costTotalAmount)}₫</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/30 text-[12px]">Lãi gộp:</span>
                                    <div className="flex items-center gap-1 font-bold text-blue-600/50 text-sm">
                                        <span className="bg-blue-600/5 px-2 py-0.5 rounded-sm">{new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(grossProfitAmount)}₫</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Section: Sidebar Metadata */}
                <div className="flex w-full min-w-0 max-w-full flex-col gap-[10px]">
                    <AnimatePresence initial={false}>
                        {showOrderAiInputReviewModal && hasLatestOrderAiInput && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, height: 0 }}
                                animate={{ opacity: 1, y: 0, height: 'auto' }}
                                exit={{ opacity: 0, y: -10, height: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                className="overflow-hidden"
                            >
                                <div className="bg-white border border-sky-200 p-4 shadow-sm rounded-sm">
                                    <div className="flex items-start justify-between gap-3 border-b border-sky-100 pb-3">
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">
                                                Input AI gần nhất
                                            </div>
                                            <div className="mt-1 text-[12px] font-semibold text-slate-700">
                                                Mở ngay ở cột phải để đối chiếu nhanh với bảng sản phẩm.
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowOrderAiInputReviewModal(false)}
                                            className="inline-flex size-8 items-center justify-center rounded-sm border border-primary/10 text-primary/35 transition-all hover:border-primary/20 hover:text-brick"
                                            title="Đóng"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                        </button>
                                    </div>

                                    <div className="mt-3 space-y-3">
                                        {orderAiLastRun?.input?.preferred_rule_label && (
                                            <div className="rounded-sm border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-700">
                                                {`Mẫu train ưu tiên: ${orderAiLastRun.input.preferred_rule_label}`}
                                            </div>
                                        )}
                                        {orderAiLastRun?.input?.file_name && (
                                            <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2 text-[11px] font-semibold text-primary/60">
                                                {`Tệp đã gửi: ${orderAiLastRun.input.file_name}`}
                                            </div>
                                        )}
                                        {orderAiLastRun?.input?.text && (
                                            <div>
                                                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary/45">
                                                    Nội dung text
                                                </div>
                                                <div className="max-h-60 overflow-auto whitespace-pre-wrap rounded-sm border border-primary/10 bg-primary/[0.02] px-3 py-2 text-[12px] font-semibold leading-relaxed text-slate-700">
                                                    {orderAiLastRun.input.text}
                                                </div>
                                            </div>
                                        )}
                                        {orderAiLastRun?.input?.image_preview_url && (
                                            <div>
                                                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary/45">
                                                    Ảnh đã gửi
                                                </div>
                                                <div className="overflow-hidden rounded-sm border border-primary/10 bg-primary/[0.02] p-2">
                                                    <img
                                                        src={orderAiLastRun.input.image_preview_url}
                                                        alt="AI input"
                                                        className="max-h-[420px] w-full object-contain"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="bg-white border border-primary/10 p-4 shadow-sm rounded-sm">
                        <div className="flex items-center gap-2.5 mb-[10px] border-b border-primary/10 pb-3">
                            <span className="material-symbols-outlined text-primary/40 text-[18px]">assignment</span>
                            <h3 className="font-sans text-[16px] font-bold leading-[1.4] text-primary">Thông tin đơn hàng</h3>
                        </div>

                        <div className="space-y-[10px]">
                            <Field label="Trạng thái">
                                <select
                                    name="status"
                                    value={formData.status}
                                    onChange={handleInputChange}
                                    className={adminInputClassName}
                                >
                                    {orderStatuses.filter(s => s.is_active || (formData.status && s.code.toLowerCase() === formData.status.toLowerCase())).map(s => (
                                        <option key={s.id} value={s.code}>{s.name || s.code}</option>
                                    ))}
                                    {formData.status && !orderStatuses.some(s => s.code.toLowerCase() === formData.status.toLowerCase()) && (
                                        <option value={formData.status}>{formData.status}</option>
                                    )}
                                </select>
                            </Field>
                            <Field label="Loại đơn">
                                <select
                                    name="order_type"
                                    value={normalizedOrderType}
                                    onChange={handleOrderTypeChange}
                                    className={adminInputClassName}
                                >
                                    {ORDER_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label={'Ngu\u1ed3n \u0111\u01a1n'}>
                                <select
                                    name="source"
                                    value={orderSourceMeta.value}
                                    onChange={handleInputChange}
                                    className={adminInputClassName}
                                >
                                    {!ORDER_SOURCE_OPTIONS.some((option) => option.value === orderSourceMeta.value) && (
                                        <option value={orderSourceMeta.value}>{orderSourceMeta.label}</option>
                                    )}
                                    {ORDER_SOURCE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </Field>
                            {specialOrderType && (
                                <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-3 space-y-3">
                                    <p className="text-[12px] font-semibold text-amber-800">
                                        {orderTypeMeta.sectionDescription}
                                    </p>
                                    <Field label={orderTypeMeta.settlementLabel}>
                                        <input
                                            type="number"
                                            step="1000"
                                            value={Number(formData.settlement_delta || 0)}
                                            onChange={handleSettlementDeltaChange}
                                            className={adminInputClassName}
                                            placeholder="Nhập số dương hoặc âm"
                                        />
                                    </Field>
                                    <div className="rounded-sm border border-amber-200/80 bg-white/80 px-3 py-2">
                                        <div className="grid grid-cols-1 gap-2 text-[12px] font-semibold lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-3">
                                            <div
                                                className="min-w-0"
                                                title={supplementDeclarationSkuTitle || 'Chưa khai báo sản phẩm đổi trả.'}
                                            >
                                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-900/55">
                                                    Mã SP đổi trả
                                                </div>
                                                <div className="mt-1 truncate text-amber-900">
                                                    {supplementDeclarationSkuSummary}
                                                </div>
                                            </div>

                                            <div
                                                className="min-w-0"
                                                title={supplementReturnTrackingCode || 'Chưa có mã vận đơn trả về.'}
                                            >
                                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-900/55">
                                                    Mã VĐ trả về
                                                </div>
                                                <div className="mt-1 truncate text-amber-900">
                                                    {supplementReturnTrackingSummary}
                                                </div>
                                            </div>

                                            <div className="min-w-0 lg:text-right">
                                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-900/55">
                                                    Trạng thái
                                                </div>
                                                <div className="mt-1">
                                                    <span className={`inline-flex items-center rounded-sm border px-2.5 py-1 text-[11px] font-black ${normalizedSupplementReturnStatus === SUPPLEMENT_RETURN_STATUS_NOT_RETURNED ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                                        {supplementReturnStatusLabel}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="hidden">
                                            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-900/55">
                                                Mã sản phẩm đổi trả
                                            </div>
                                            {supplementDeclarationSkus.length > 0 ? (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {supplementDeclarationSkus.map((sku) => (
                                                        <span
                                                            key={sku}
                                                            className="inline-flex items-center rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900"
                                                        >
                                                            {sku}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="mt-2 text-[12px] font-semibold text-amber-900/45">
                                                    Chưa khai báo sản phẩm đổi trả.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="rounded-sm border border-amber-200/80 bg-white/70 px-3 py-2">
                                        <div className="flex items-center justify-between gap-3 text-[12px] font-bold">
                                            <span className="text-amber-900/60">Doanh thu báo cáo</span>
                                            <span className="text-amber-900">{new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(reportRevenueTotal)}đ</span>
                                        </div>
                                        <div className="mt-1 flex items-center justify-between gap-3 text-[12px] font-bold">
                                            <span className="text-amber-900/60">Giá vốn báo cáo</span>
                                            <span className="text-amber-900">{new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(reportCostTotal)}đ</span>
                                        </div>
                                        <div className="mt-1 flex items-center justify-between gap-3 text-[12px] font-bold">
                                            <span className="text-amber-900/60">Lãi / lỗ báo cáo</span>
                                            <span className={reportProfitTotal >= 0 ? 'text-emerald-700' : 'text-brick'}>
                                                {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(reportProfitTotal)}đ
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {addressDetection && (
                                <div className={`rounded-sm border px-3 py-2 text-[12px] ${addressDetection.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                    {addressDetection.message}
                                </div>
                            )}

                            <Field label="Địa chỉ giao hàng tự động" className="min-h-[100px] items-start pt-3">
                                <textarea
                                    name="shipping_address"
                                    value={formData.shipping_address}
                                    readOnly
                                    rows="3"
                                    className={`${adminTextareaClassName} bg-slate-50`}
                                    placeholder="Tự động ghép từ thông tin địa chỉ bên dưới"
                                />
                            </Field>

                            <Field label="Nhân viên xử lý">
                                <div className={`${adminInputClassName} flex items-center text-primary/60 bg-slate-50`}>{user?.name || "Super Admin"}</div>
                            </Field>

                            <Field label="Tên khách hàng" labelStyle={adminCustomerLabelStyle}>
                                <input
                                    type="text"
                                    name="customer_name"
                                    value={formData.customer_name}
                                    onChange={handleInputChange}
                                    className={adminInputClassName}
                                    placeholder="Nhập tên khách hàng"
                                />
                            </Field>

                            <Field label="Số điện thoại" labelStyle={adminCustomerLabelStyle}>
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 lg:block">
                                    <input
                                        type="text"
                                        name="customer_phone"
                                        value={formData.customer_phone}
                                        onChange={handleInputChange}
                                        className={`${adminInputClassName} ${formData.customer_phone && !validateVietnamesePhone(formData.customer_phone) ? 'border-brick' : ''}`}
                                        placeholder="Nhập số điện thoại"
                                    />
                                    <button
                                        type="button"
                                        onClick={(event) => handleCopyCellValue(mobileCustomerSummaryText, 'thông tin khách', event, 'customer-summary')}
                                        disabled={!mobileCustomerSummaryText}
                                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm border border-primary/10 bg-white px-4 text-[14px] font-semibold leading-none text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-40 lg:hidden"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                        Sao chép
                                    </button>
                                </div>
                            </Field>

                            <div className="hidden lg:block">
                                {renderManualShippingAddressField()}
                            </div>

                            <div className="lg:hidden">
                                {renderOrderNotesField()}
                            </div>

                            {/* Administrative Selection */}
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[14px] font-semibold leading-[1.45] text-primary/45">Đơn vị hành chính</span>
                                <div
                                    className="flex items-center gap-1 cursor-pointer p-0.5 bg-primary/5 rounded-full border border-primary/10"
                                    onClick={() => setRegionType(useNewAddress ? 'old' : 'new')}
                                >
                                    <div className={`px-3 py-1.5 rounded-full text-[14px] font-semibold leading-none transition-all ${useNewAddress ? 'bg-primary text-white shadow-sm' : 'text-primary/40'}`}>Mới nhất</div>
                                    <div className={`px-3 py-1.5 rounded-full text-[14px] font-semibold leading-none transition-all ${!useNewAddress ? 'bg-orange-600 text-white shadow-sm' : 'text-primary/40'}`}>Cũ</div>
                                </div>
                            </div>

                            <div className={`grid ${useNewAddress ? 'grid-cols-[minmax(0,1.16fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1.24fr)_minmax(0,0.96fr)_minmax(0,1.04fr)]'} gap-[10px] mb-[10px]`}>
                                <div className={adminRegionFieldClassName}>
                                    <span className={adminRegionLabelClassName}>
                                        Tỉnh / Thành phố
                                    </span>
                                    {formData.province && (
                                        <button
                                            type="button"
                                            onClick={clearProvince}
                                            className={adminRegionClearButtonClassName}
                                            title="Xóa Tỉnh/Thành phố"
                                        >
                                            <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                        </button>
                                    )}
                                    <SearchableSelect
                                        options={(provinces || []).map(p => p.name)}
                                        value={formData.province}
                                        name="province"
                                        onChange={handleProvinceChange}
                                        placeholder="Tỉnh..."
                                        variant="admin"
                                    />
                                </div>

                                {!useNewAddress && (
                                    <div className={adminRegionFieldClassName}>
                                        <span className={adminRegionLabelClassName}>
                                            Quận / Huyện
                                        </span>
                                        {formData.district && (
                                            <button
                                                type="button"
                                                onClick={clearDistrict}
                                                className={adminRegionClearButtonClassName}
                                                title="Xóa Quận/Huyện"
                                            >
                                                <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                            </button>
                                        )}
                                        <SearchableSelect
                                            options={districts.map(d => d.name)}
                                            value={formData.district}
                                            name="district"
                                            onChange={handleDistrictChange}
                                            placeholder={useNewAddress ? "-" : (isDistrictsLoading ? "..." : "Quận...")}
                                            disabled={useNewAddress || !formData.province || isDistrictsLoading}
                                            variant="admin"
                                        />
                                    </div>

                                )}
                                <div className={adminRegionFieldClassName}>
                                    <span className={adminRegionLabelClassName}>
                                        Phường / Xã
                                    </span>
                                    {formData.ward && (
                                        <button
                                            type="button"
                                            onClick={clearWard}
                                            className={adminRegionClearButtonClassName}
                                            title="Xóa Phường/Xã"
                                        >
                                            <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                        </button>
                                    )}
                                    <SearchableSelect
                                        options={wards}
                                        value={formData.ward}
                                        name="ward"
                                        onChange={handleWardChange}
                                        placeholder={isWardsLoading ? "..." : "Phường..."}
                                        disabled={(!useNewAddress && !formData.district) || (useNewAddress && !formData.province) || isWardsLoading}
                                        variant="admin"
                                    />
                                </div>
                            </div>

                            <div className="hidden lg:block">
                                {renderOrderNotesField()}
                            </div>

                            <div className="lg:hidden">
                                {renderManualShippingAddressField()}
                            </div>

                            <div className="pt-2 pb-2">
                                <h4 className="font-sans text-[16px] font-bold leading-[1.45] text-primary mb-6 flex items-center justify-center gap-2">
                                    <span className="h-px bg-primary/10 flex-1"></span>
                                    Thông tin bổ sung
                                    <span className="h-px bg-primary/10 flex-1"></span>
                                </h4>
                                <div className="grid grid-cols-1 gap-1">
                                    {attributes.map(attr => (
                                        <Field key={attr.id} label={attr.name}>
                                            <input
                                                type="text"
                                                value={formData.custom_attributes[attr.code] || ''}
                                                onChange={(e) => handleAttributeChange(attr.code, e.target.value)}
                                                className={adminInputClassName}
                                                placeholder={`...`}
                                            />
                                        </Field>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-6">
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="w-full bg-primary/5 text-primary/40 font-sans font-semibold text-[14px] leading-[1.45] py-4 hover:bg-primary/10 transition-all border border-primary/10 rounded-sm"
                                >
                                    Quay về danh sách
                                </button>
                            </div>
                        </div>
                    </div>

                    {leadConversionCard}
                </div>
            </form>

            <div className="fixed inset-x-0 bottom-0 z-[180] border-t border-primary/10 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3 shadow-[0_-18px_40px_-28px_rgba(15,23,42,0.45)] backdrop-blur lg:hidden">
                <div className="flex min-w-0 items-baseline gap-2">
                    <div className="shrink-0 text-[14px] font-semibold leading-none text-primary/45">Tổng tiền hiện tại</div>
                    <div className="min-w-0 truncate text-[24px] font-black leading-none text-brick">
                            {quoteTotalQuantity > 0 ? formatQuoteMoney(totalPaymentAmount) : 'Chưa có sản phẩm'}
                    </div>
                </div>

                <div className={`mt-3 grid gap-2 ${mobileFooterSecondaryAction ? 'grid-cols-5' : 'grid-cols-4'}`}>
                    <button
                        type="button"
                        onClick={() => handleSubmit(null)}
                        disabled={saving}
                        title={mobileFooterPrimaryActionTitle}
                        aria-label={mobileFooterPrimaryActionTitle}
                        className="inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-primary/10 bg-primary/[0.04] px-2 text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${saving ? 'animate-refresh-spin' : ''}`}>
                            {saving ? 'progress_activity' : 'save'}
                        </span>
                    </button>
                    {mobileFooterSecondaryAction && (
                        <button
                            type="button"
                            onClick={mobileFooterSecondaryAction.onClick}
                            disabled={saving}
                            title={mobileFooterSecondaryAction.title}
                            aria-label={mobileFooterSecondaryAction.title}
                            className={`inline-flex min-h-[52px] items-center justify-center rounded-[16px] px-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${mobileFooterSecondaryAction.className}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">{mobileFooterSecondaryAction.icon}</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowBulkReplaceModal(true)}
                        disabled={selectedLineItemIds.size === 0 || saving}
                        title="Đổi hàng loạt"
                        aria-label="Đổi hàng loạt"
                        className="relative inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-primary/10 bg-white px-2 text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                        {selectedLineItemIds.size > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brick px-1 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-[#F8FAFC]">
                                {selectedLineItemIds.size}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={handleScreenshot}
                        disabled={formData.items.length === 0 || isCapturing}
                        title="Tải ảnh"
                        aria-label="Tải ảnh"
                        className="inline-flex min-h-[52px] items-center justify-center rounded-[16px] bg-primary px-2 text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${isCapturing ? 'animate-refresh-spin' : ''}`}>
                            {isCapturing ? 'progress_activity' : 'download'}
                        </span>
                    </button>
                    <button
                        ref={mobileProductSearchToggleButtonRef}
                        type="button"
                        onClick={toggleProductSearchPanel}
                        title="Thêm sản phẩm"
                        aria-label="Thêm sản phẩm"
                        className="inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-primary/10 bg-white px-2 text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03]"
                    >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                </div>
            </div>

            <OrderAiLineReplacePanel
                show={Boolean(orderAiReplaceLineId)}
                currentLine={activeOrderAiReplaceLine}
                anchorElement={orderAiReplaceAnchorRef.current}
                searchTerm={orderAiReplaceSearchTerm}
                onSearchTermChange={setOrderAiReplaceSearchTerm}
                onClose={closeOrderAiReplacePicker}
                results={orderAiReplaceResults}
                loading={orderAiReplaceLoading}
                onSelect={(entry) => handleSelectOrderAiLineReplacement(orderAiReplaceLineId, entry)}
                currencyFormatter={quoteCurrencyFormatter}
            />
            <OrderAiLineReplacePanel
                show={Boolean(actualProductPickerLineId)}
                currentLine={activeActualProductPickerLine}
                anchorElement={actualProductPickerAnchorRef.current}
                searchTerm={actualProductPickerSearchTerm}
                onSearchTermChange={setActualProductPickerSearchTerm}
                onClose={closeActualProductPicker}
                results={actualProductPickerResults}
                loading={actualProductPickerLoading}
                onSelect={(entry) => handleSelectActualProductReplacement(actualProductPickerLineId, entry)}
                currencyFormatter={quoteCurrencyFormatter}
                heading="Gửi sản phẩm khác"
                currentLabel={activeActualProductPickerLine?.name || selectedOrderLine?.name || ''}
                searchPlaceholder="Tìm sản phẩm thực gửi..."
                emptyMessage={actualProductPickerSearchTerm.trim().length >= 2
                    ? 'Không thấy sản phẩm thực gửi phù hợp, thử đổi từ khóa.'
                    : 'Gõ ít nhất 2 ký tự để chọn sản phẩm thực gửi.'}
            />

            <OrderSupplementItemsSection
                open={showSupplementItemsModal}
                orderType={normalizedOrderType}
                items={formData.supplement_items}
                sourceItems={formData.items}
                outgoingTrackingCode={outgoingTrackingCode}
                returnTrackingCode={formData.return_tracking_code}
                returnStatus={formData.return_status}
                onSave={({ items: supplementItems, returnTrackingCode, returnStatus }) => setFormData((prev) => {
                    const nextSupplementItems = Array.isArray(supplementItems) ? supplementItems : [];

                    return {
                        ...prev,
                        supplement_items: nextSupplementItems,
                        discount: calculateEffectiveDiscountValue(
                            prev.manual_discount,
                            prev.order_type,
                            nextSupplementItems
                        ),
                        return_tracking_code: String(returnTrackingCode || '').trim(),
                        return_status: returnStatus,
                    };
                })}
                onClose={() => setShowSupplementItemsModal(false)}
            />

            <AnimatePresence>
                {showQuoteTemplatePicker && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[220] bg-slate-950/35 backdrop-blur-[1px]"
                            onClick={() => setShowQuoteTemplatePicker(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 16 }}
                            className="fixed inset-0 z-[230] flex items-center justify-center p-6"
                        >
                            <div className="w-full max-w-6xl rounded-sm border border-primary/10 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)] overflow-hidden">
                                <div className="flex items-start justify-between gap-4 border-b border-primary/10 bg-primary/[0.02] px-6 py-4">
                                    <div>
                                        <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">Chọn bộ / mẫu báo giá</h3>
                                        <p className="mt-1 text-[12px] text-primary/45">Chọn ảnh đại diện để hệ thống tạo ảnh báo giá dạng bảng cho đơn hàng hiện tại.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setQuoteTemplateSearch('');
                                            setShowQuoteTemplatePicker(false);
                                        }}
                                        className="size-9 rounded-sm border border-primary/10 text-primary/40 hover:text-brick hover:border-brick/20 transition-all flex items-center justify-center"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                </div>

                                <div className="border-b border-primary/10 px-6 py-4 bg-white">
                                    <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                                        <div className="relative w-full lg:max-w-[360px]">
                                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-primary/35">search</span>
                                            <input
                                                type="text"
                                                value={quoteTemplateSearch}
                                                onChange={(e) => setQuoteTemplateSearch(e.target.value)}
                                                placeholder="Tìm nhanh theo tên bộ / mẫu..."
                                                className="w-full h-10 rounded-sm border border-primary/10 bg-primary/[0.02] pl-10 pr-10 text-[13px] text-primary focus:outline-none focus:border-primary/30 focus:bg-white transition-all"
                                            />
                                            {quoteTemplateSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setQuoteTemplateSearch('')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 size-7 rounded-sm text-primary/35 hover:text-brick hover:bg-primary/5 transition-all flex items-center justify-center"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 text-[12px] text-primary/45">
                                            <span className="font-semibold">{filteredQuoteTemplates.length}</span>
                                            <span>mẫu hiển thị</span>
                                            <span className="text-primary/20">/</span>
                                            <span>{availableQuoteTemplates.length} mẫu hoạt động</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="max-h-[68vh] overflow-y-auto p-6 custom-scrollbar">
                                    {filteredQuoteTemplates.length === 0 ? (
                                        <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.02] px-6 py-14 text-center">
                                            <div className="text-[13px] font-bold text-primary">Không tìm thấy mẫu phù hợp</div>
                                            <div className="mt-2 text-[12px] text-primary/45">Thử từ khóa ngắn hơn hoặc xóa bộ lọc để xem toàn bộ mẫu báo giá.</div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                                            {filteredQuoteTemplates.map((template) => (
                                                <button
                                                    key={template.id}
                                                    type="button"
                                                    onClick={() => captureQuoteImage(template)}
                                                    className="group overflow-hidden rounded-sm border border-primary/10 bg-white text-left shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
                                                >
                                                    <div className="aspect-[4/3] bg-stone-50 border-b border-primary/10 overflow-hidden">
                                                        {template.image_url ? (
                                                            <img src={getQuoteTemplateImageUrl(template)} alt={template.name} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-primary/25 uppercase tracking-[0.16em] text-[12px] font-black">
                                                                Chưa có ảnh
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="px-3 py-3">
                                                        <div className="text-[12px] font-black uppercase tracking-[0.1em] text-primary line-clamp-2 min-h-[34px]">{template.name}</div>
                                                        <div className="mt-2 flex items-center justify-between text-[10px] text-primary/45">
                                                            <span>Sẵn sàng tạo ảnh</span>
                                                            <span className="inline-flex items-center gap-1 text-primary">
                                                                Chọn mẫu
                                                                <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {showOrderAiRulesModal && (
                <OrderAiRuleManagerModal
                    rules={orderAiRules}
                    onClose={() => setShowOrderAiRulesModal(false)}
                    onSave={handleSaveOrderAiRules}
                    saving={orderAiSavingRules}
                    showModal={showModal}
                />
            )}

            {quoteCaptureTemplate && (
                <div className="fixed left-[-20000px] top-0 z-[-1]">
                    <QuoteCaptureSheet
                        captureRef={quoteCaptureRef}
                        quoteSettings={quoteSettings}
                        template={quoteCaptureTemplate}
                        formData={formData}
                        orderId={id}
                        totalQuantity={quoteTotalQuantity}
                        pricingSummary={quotePricingSummary}
                    />
                </div>
            )}

            <ProductBulkReplaceModal
                show={showBulkReplaceModal}
                onClose={() => setShowBulkReplaceModal(false)}
                selectedItems={formData.items.filter(item => selectedLineItemIds.has(item.line_id))}
                attributes={productQuickFilterAttributes}
                onApply={applyBulkReplacements}
                currencyFormatter={formatQuoteMoney}
            />
        </div>
    );
};
export default OrderForm;
