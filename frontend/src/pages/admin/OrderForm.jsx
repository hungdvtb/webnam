import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api, { accountApi, orderAiTrainingApi, orderApi, productApi, productReplacementApi, leadApi, cmsApi } from '../../services/api';
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
    getOrderItemCurrentName,
    getOrderItemCurrentSku,
    getOrderItemOriginalName,
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
import { buildOrderAiQuickRuleOptions, normalizeOrderAiRules } from '../../utils/orderAiRules';
import { hasAdminPermission } from '../../utils/adminPermissions';
import {
    copyProductQuickSetupItemsToNamespace,
    findProductQuickSetupItems,
} from '../../utils/orderProductQuickSetup';
import {
    calculateBundleItemsSubtotal,
    resolveBundleOptionEntryPrice,
} from '../../utils/orderBundleOptionPricing';
import { flushUserSettingsSync } from '../../services/userSettingsSync';

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
const orderProductQuickModeDefaultSettingKey = 'order_product_quick_mode_default_enabled';
const PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE = 'attribute';
const PRODUCT_QUICK_SETUP_MODE_MANUAL = 'manual';
const PRODUCT_MANUAL_QUICK_SETUP_FALLBACK_KEY = 'manual::default';
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
const ACTUAL_PRODUCT_PICKER_TAB_MANUAL = 'manual';
const ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE = 'warehouse';
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
const getOrderLineDisplaySequence = (item, index = 0) => {
    const sortOrder = Number(item?.sort_order);
    if (Number.isFinite(sortOrder) && sortOrder > 0) {
        return String(Math.trunc(sortOrder));
    }

    return String((Number(index) || 0) + 1);
};
const getOrderLineOriginalNameLabel = (item) => getOrderItemOriginalName(item, item?.name || '');
const getOrderLineDisplayNameLabel = (item, fallback = 'Sản phẩm') => {
    const productId = Number(item?.product_id) || 0;
    const candidates = [
        item?.name,
        item?.snapshot_name,
        item?.product_name_snapshot,
        item?.display_name,
        item?.original_name,
        getOrderItemCurrentName(item),
        item?.product?.name,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeCanvasText(candidate);
        if (normalized && !isPlaceholderProductName(normalized, productId)) {
            return normalized;
        }
    }

    return normalizeCanvasText(fallback) || 'Sản phẩm';
};
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
const buildOrderLineWarehouseSearchText = (item, index = 0) => normalizeProductSearchText([
    getOrderLineDisplaySequence(item, index),
    getOrderItemDisplaySku(item),
    getOrderItemCurrentSku(item),
    item?.sku,
    item?.display_sku,
    getOrderLineDisplayNameLabel(item),
    getOrderItemActualDisplayName(item),
    item?.name,
].filter(Boolean).join(' '));
const findOrderLineByWarehouseQuery = (items = [], rawQuery = '') => {
    const queryText = normalizeCanvasText(rawQuery);
    if (!queryText) return null;

    const rows = (Array.isArray(items) ? items : [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item && normalizeCanvasText(item?.line_id));
    const digitQuery = queryText.replace(/^0+(?=\d)/, '');

    if (/^\d+$/.test(digitQuery)) {
        const matchedBySequence = rows.find(({ item, index }) => {
            const sequence = getOrderLineDisplaySequence(item, index);
            return sequence === digitQuery || String(index + 1) === digitQuery;
        });

        if (matchedBySequence) {
            return matchedBySequence.item;
        }
    }

    const normalizedQuery = normalizeProductSearchText(queryText);
    if (!normalizedQuery) return null;

    const matchedBySku = rows.find(({ item }) => [
        getOrderItemDisplaySku(item),
        getOrderItemCurrentSku(item),
        item?.sku,
        item?.display_sku,
    ].some((value) => normalizeProductSearchText(value) === normalizedQuery));

    if (matchedBySku) {
        return matchedBySku.item;
    }

    return rows.find(({ item, index }) => buildOrderLineWarehouseSearchText(item, index).includes(normalizedQuery))?.item || null;
};
const normalizeStoreIdentityText = (value) => normalizeProductSearchText(
    String(value ?? '').replace(/[\u0111\u0110]/g, 'd')
);
const getStoreIdentityText = (account = {}) => [
    account?.name,
    account?.site_code,
    account?.domain,
    account?.subdomain,
].map(normalizeStoreIdentityText).filter(Boolean).join(' ');
const compactStoreIdentityText = (account = {}) => getStoreIdentityText(account).replace(/\s+/g, '');
const isDongDaiThanhAccount = (account = {}) => {
    const identityText = getStoreIdentityText(account);
    const compactIdentityText = compactStoreIdentityText(account);

    return identityText.includes('dong dai thanh')
        || compactIdentityText.includes('dongdaithanh')
        || compactIdentityText.includes('gomdaithanhcn2')
        || compactIdentityText.includes('chinhanh2');
};
const isGomDaiThanhAccount = (account = {}) => {
    if (isDongDaiThanhAccount(account)) return false;

    const identityText = getStoreIdentityText(account);
    const compactIdentityText = compactStoreIdentityText(account);

    return (identityText.includes('gom') && identityText.includes('dai thanh'))
        || compactIdentityText.includes('gomsudaithanh')
        || compactIdentityText.includes('gomdaithanh')
        || compactIdentityText.includes('gsdt');
};
const mergeQuoteTemplates = (...templateGroups) => {
    const mergedTemplates = new Map();

    templateGroups.flat().forEach((template) => {
        if (!template || typeof template !== 'object') return;

        const templateId = Number(template.id) || 0;
        const accountId = Number(template.account_id) || 0;
        const fallbackKey = [
            normalizeCanvasText(template.name).toLowerCase(),
            normalizeCanvasText(template.image_url),
        ].join('|');
        const key = templateId > 0
            ? `${accountId || 'account'}:${templateId}`
            : `fallback:${fallbackKey}`;

        if (!mergedTemplates.has(key)) {
            mergedTemplates.set(key, template);
        }
    });

    return sortQuoteTemplates(Array.from(mergedTemplates.values()));
};
const compactProductSearchText = (value) => normalizeProductSearchText(value).replace(/\s+/g, '');
const PRODUCT_PLACEHOLDER_COMPACT_NAMES = new Set(['sanpham', 'sanphambundle']);
const isPlaceholderProductName = (value, productId = 0) => {
    const compactValue = compactProductSearchText(value);
    if (!compactValue) return true;

    const normalizedProductId = Number(productId) || 0;
    return PRODUCT_PLACEHOLDER_COMPACT_NAMES.has(compactValue)
        || (normalizedProductId > 0 && compactValue === `sanpham${normalizedProductId}`);
};
const resolveCatalogProductName = (product, productId = 0) => {
    const candidates = [
        product?.display_name,
        product?.name,
        product?.current_product_name,
        product?.product?.name,
    ];

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeCanvasText(candidate);
        if (normalizedCandidate && !isPlaceholderProductName(normalizedCandidate, productId)) {
            return normalizedCandidate;
        }
    }

    return '';
};
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
const normalizeStoredQuickFilterBoolean = (value, fallbackValue = true) => {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined || value === '') return fallbackValue;

    const normalizedValue = String(value).trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(normalizedValue)) return false;
    if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) return true;

    return fallbackValue;
};
const hasStoredProductQuickModePreference = (user = null) => {
    if (typeof window === 'undefined') return false;

    try {
        const raw = window.localStorage.getItem(getProductQuickFilterStorageKey(user));
        const parsed = raw ? JSON.parse(raw) : null;

        return Boolean(
            parsed
            && typeof parsed === 'object'
            && !Array.isArray(parsed)
            && (
                Object.prototype.hasOwnProperty.call(parsed, 'quickModeEnabled')
                || Object.prototype.hasOwnProperty.call(parsed, 'quick_mode_enabled')
            )
        );
    } catch (error) {
        console.error('Unable to read product quick mode preference', error);
        return false;
    }
};
const getActiveAccountIdForSiteSettings = () => {
    if (typeof window === 'undefined') return '';

    try {
        const activeAccountId = String(window.localStorage.getItem('activeAccountId') || '').trim();
        return activeAccountId && activeAccountId !== 'all' && activeAccountId !== 'default'
            ? activeAccountId
            : '';
    } catch (error) {
        console.error('Unable to resolve active account id for order picker settings', error);
        return '';
    }
};
const normalizeStoredProductQuickFilterState = (value = {}) => {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    return {
        searchTerm: String(source.searchTerm ?? source.search_term ?? '').trim(),
        attributeId: String(source.attributeId ?? source.attribute_id ?? '').trim(),
        values: normalizeStoredQuickFilterValues(source.values),
        attributeId2: String(source.attributeId2 ?? source.attribute_id_2 ?? '').trim(),
        values2: normalizeStoredQuickFilterValues(source.values2),
        quickModeEnabled: normalizeStoredQuickFilterBoolean(source.quickModeEnabled ?? source.quick_mode_enabled, true),
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
    if (typeof window === 'undefined' || !storageKey) return false;

    const normalizedState = normalizeStoredProductQuickFilterState(state);
    const hasPersistedState = Boolean(
        normalizedState.searchTerm
        || normalizedState.values.length > 0
        || normalizedState.values2.length > 0
    );

    try {
        if (!hasPersistedState) {
            if (window.localStorage.getItem(storageKey) === null) {
                return false;
            }

            window.localStorage.removeItem(storageKey);
            return true;
        }

        const serializedState = JSON.stringify(normalizedState);
        if (window.localStorage.getItem(storageKey) === serializedState) {
            return false;
        }

        window.localStorage.setItem(storageKey, serializedState);
        return true;
    } catch (error) {
        console.error('Unable to persist product quick filter state', error);
        return false;
    }
};
const buildProductQuickFilterDurableSignature = (storageKey, state = {}) => {
    const normalizedState = normalizeStoredProductQuickFilterState(state);

    return JSON.stringify({
        storageKey: String(storageKey || ''),
        attributeId: normalizedState.attributeId,
        values: normalizedState.values,
        attributeId2: normalizedState.attributeId2,
        values2: normalizedState.values2,
        quickModeEnabled: normalizedState.quickModeEnabled,
    });
};
const resolveProductQuickSetupNamespace = (user = null) => {
    if (typeof window === 'undefined') return 'server';

    try {
        const userId = getStoredUserStorageId(user);
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
const hasProductQuickSetupStoreEntries = (store = {}) => (
    Object.values(store || {}).some((namespaceStore) => (
        namespaceStore
        && typeof namespaceStore === 'object'
        && !Array.isArray(namespaceStore)
        && Object.keys(namespaceStore).length > 0
    ))
);
const persistProductQuickSetupStore = (store = {}) => {
    if (typeof window === 'undefined') return false;

    try {
        if (!hasProductQuickSetupStoreEntries(store)) {
            if (window.localStorage.getItem(productQuickSetupStorageKey) === null) {
                return false;
            }

            window.localStorage.removeItem(productQuickSetupStorageKey);
            return true;
        }

        const serializedStore = JSON.stringify(store);
        if (window.localStorage.getItem(productQuickSetupStorageKey) === serializedStore) {
            return false;
        }

        window.localStorage.setItem(productQuickSetupStorageKey, serializedStore);
        return true;
    } catch (error) {
        console.error('Unable to persist product quick setup store', error);
        return false;
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
        const optionKey = resolveBundleOptionKey(entry);

        return parentProductId > 0 && optionKey
            ? `${SEARCH_ENTRY_BUNDLE_OPTION}-${parentProductId}-${optionKey}`
            : '';
    }

    const productId = Number(entry?.target_product_id ?? entry?.product_id ?? entry?.id ?? 0);
    return Number.isFinite(productId) && productId > 0 ? String(productId) : '';
};
const getProductSearchEntryDedupeKey = (entry) => {
    const quickSetupKey = getProductQuickSetupEntryKey(entry);
    if (quickSetupKey) return quickSetupKey;

    const entryKind = String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
    const entryId = normalizeCanvasText(entry?.entry_id || entry?.id);
    if (entryId) return `${entryKind}:${entryId}`;

    const sku = normalizeProductSearchText(entry?.display_sku || entry?.sku);
    if (sku) return `${entryKind}:sku:${sku}`;

    const name = normalizeProductSearchText(entry?.display_name || entry?.name);
    return name ? `${entryKind}:name:${name}` : '';
};
const mergeProductSearchEntryLists = (...entryGroups) => {
    const seenKeys = new Set();
    const mergedEntries = [];

    entryGroups.flat().forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;

        const key = getProductSearchEntryDedupeKey(entry);
        if (key && seenKeys.has(key)) return;
        if (key) seenKeys.add(key);

        mergedEntries.push(entry);
    });

    return mergedEntries;
};
const buildLatestProductSnapshotMap = (items = []) => {
    const map = new Map();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const entryKind = String(item?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
        const entryKey = getProductQuickSetupEntryKey(item);
        const productId = Number(item?.product_id ?? item?.target_product_id ?? item?.id ?? 0) || 0;

        if (entryKind === SEARCH_ENTRY_BUNDLE_OPTION && entryKey) {
            map.set(entryKey, item);
            return;
        }

        if (productId > 0) {
            map.set(productId, item);
        }
    });

    return map;
};
const getLatestProductSnapshotForEntry = (entry, latestMap = new Map()) => {
    const entryKey = getProductQuickSetupEntryKey(entry);
    if (entryKey && latestMap.has(entryKey)) {
        return latestMap.get(entryKey);
    }

    const productId = Number(entry?.target_product_id ?? entry?.product_id ?? entry?.bundle_parent_id ?? entry?.id ?? 0) || 0;
    return productId > 0 ? latestMap.get(productId) : undefined;
};
const normalizeAccountId = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.trunc(numericValue) : null;
};
const normalizeAccountRows = (rows = []) => (
    (Array.isArray(rows) ? rows : [])
        .map((account) => {
            const id = normalizeAccountId(account?.id ?? account?.account_id);
            if (!id) return null;

            return {
                ...account,
                id,
                name: normalizeCanvasText(account?.name || account?.store_name || account?.site_name || `Shop #${id}`),
            };
        })
        .filter(Boolean)
);
const getOrderFormActiveAccountId = () => {
    if (typeof window === 'undefined') return null;

    try {
        return normalizeAccountId(window.localStorage.getItem('activeAccountId'));
    } catch (error) {
        console.error('Unable to read active account id', error);
        return null;
    }
};
const getCachedOrderFormAccounts = () => {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.sessionStorage.getItem('accounts_list');
        return normalizeAccountRows(raw ? JSON.parse(raw) : []);
    } catch (error) {
        console.error('Unable to read cached accounts', error);
        return [];
    }
};
const resolveProductSourceFields = (source = {}, fallback = {}) => {
    const rawSource = source && typeof source === 'object' ? source : {};
    const rawFallback = fallback && typeof fallback === 'object' ? fallback : {};
    const productSourceAccountId = normalizeAccountId(
        rawSource.product_source_account_id
        ?? rawSource.source_account_id
        ?? rawSource.productSourceAccount?.id
        ?? rawSource.product_source_account?.id
        ?? rawFallback.product_source_account_id
        ?? rawFallback.source_account_id
        ?? rawFallback.productSourceAccount?.id
        ?? rawFallback.product_source_account?.id
        ?? rawSource.account_id
        ?? rawFallback.account_id
    );
    const inventorySourceAccountId = normalizeAccountId(
        rawSource.inventory_source_account_id
        ?? rawSource.inventorySourceAccount?.id
        ?? rawSource.inventory_source_account?.id
        ?? rawFallback.inventory_source_account_id
        ?? rawFallback.inventorySourceAccount?.id
        ?? rawFallback.inventory_source_account?.id
    );
    const productCatalogAccountId = normalizeAccountId(
        rawSource.product_catalog_account_id
        ?? rawFallback.product_catalog_account_id
        ?? rawSource.account_id
        ?? rawFallback.account_id
    );
    const sourceAccountName = normalizeCanvasText(
        rawSource.product_source_account_name
        || rawSource.source_account_name
        || rawSource.productSourceAccount?.name
        || rawSource.product_source_account?.name
        || rawFallback.product_source_account_name
        || rawFallback.source_account_name
        || rawFallback.productSourceAccount?.name
        || rawFallback.product_source_account?.name
    );

    return {
        source_account_id: productSourceAccountId || undefined,
        product_source_account_id: productSourceAccountId || undefined,
        inventory_source_account_id: inventorySourceAccountId || undefined,
        product_catalog_account_id: productCatalogAccountId || undefined,
        source_account_name: sourceAccountName || undefined,
        product_source_account_name: sourceAccountName || undefined,
    };
};
const getProductSourceAccountId = (source) => (
    resolveProductSourceFields(source).product_source_account_id || null
);
const getProductSourceDisplayName = (source) => (
    resolveProductSourceFields(source).product_source_account_name || ''
);
const buildProductSourcePayload = (source) => {
    const sourceFields = resolveProductSourceFields(source);
    const payload = {};

    ['product_source_account_id', 'inventory_source_account_id', 'source_account_id'].forEach((key) => {
        if (sourceFields[key]) {
            payload[key] = sourceFields[key];
        }
    });

    return payload;
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
                ...resolveProductSourceFields(item),
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
            const bundleOptionPrice = entryKind === SEARCH_ENTRY_BUNDLE_OPTION
                ? resolveBundleOptionEntryPrice(item, bundleItems)
                : (Number(item?.price ?? 0) || 0);

            const bundleParentId = Number(item?.bundle_parent_id ?? productId) || productId;
            const bundleOptionTitle = normalizeCanvasText(item?.bundle_option_title || resolveBundleOptionTitle(item));
            const bundleParentName = normalizeCanvasText(item?.bundle_parent_name || item?.parent_product_name || item?.name);
            const bundleDisplayName = [bundleParentName, bundleOptionTitle]
                .filter((part, index, source) => (
                    part
                    && source.findIndex((candidate) => normalizeProductSearchText(candidate) === normalizeProductSearchText(part)) === index
                ))
                .join(' - ');
            const displayName = entryKind === SEARCH_ENTRY_BUNDLE_OPTION
                ? (
                    bundleDisplayName
                    || normalizeCanvasText(item?.display_name)
                    || normalizeCanvasText(item?.name)
                )
                : String(item?.display_name ?? item?.name ?? '').trim();
            const bundleOptionUid = entryKind === SEARCH_ENTRY_BUNDLE_OPTION
                ? normalizeCanvasText(item?.bundle_option_uid || item?.uid || item?.option_uid)
                : '';

            return {
                id: entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? entryKey : productId,
                entry_id: entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? entryKey : normalizeCanvasText(item?.entry_id),
                product_id: productId,
                target_product_id: productId,
                sku: String(item?.sku ?? '').trim(),
                display_sku: String(item?.display_sku ?? item?.sku ?? '').trim(),
                name: String(item?.name ?? '').trim(),
                display_name: displayName,
                price: bundleOptionPrice,
                expected_cost: parseMoneyNumber(item?.expected_cost),
                cost_price: resolveProductCostPrice(item),
                unit_name: resolveOrderUnitLabel(item),
                ...resolveInventorySnapshot(item),
                ...resolveProductSourceFields(item),
                main_image: String(item?.main_image ?? '').trim(),
                type: String(item?.type ?? '').trim(),
                entry_kind: entryKind,
                parent_product_id: Number.isFinite(parentProductId) && parentProductId > 0 ? parentProductId : null,
                parent_product_name: String(item?.parent_product_name ?? '').trim(),
                option_label: String(item?.option_label ?? '').trim(),
                ...(entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? {
                    bundle_parent_id: bundleParentId,
                    bundle_parent_name: bundleParentName,
                    bundle_option_uid: bundleOptionUid,
                    bundle_option_key: normalizeCanvasText(item?.bundle_option_key || resolveBundleOptionKey(item)),
                    bundle_option_title: bundleOptionTitle,
                    raw_bundle_option_title: normalizeCanvasText(item?.raw_bundle_option_title || item?.option_title),
                    bundle_option_status: normalizeCanvasText(item?.bundle_option_status || 'visible'),
                    bundle_title: normalizeCanvasText(item?.bundle_title || item?.bundle_config_title),
                    bundle_config_title: normalizeCanvasText(item?.bundle_config_title || item?.bundle_title),
                    bundle_option_total_price: bundleOptionPrice,
                    bundle_option_discounted_price: bundleOptionPrice,
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
const dedupeProductQuickFilterOptions = (options = []) => {
    const seenValues = new Set();

    return (Array.isArray(options) ? options : [])
        .filter((option) => {
            const normalizedValue = normalizeProductSearchText(option?.value || option?.label);
            if (!normalizedValue || seenValues.has(normalizedValue)) return false;

            seenValues.add(normalizedValue);
            return true;
        });
};
const buildProductQuickFilterAttributes = (attributes = []) => {
    const normalizedAttributes = attributes
        .filter((attribute) => supportedProductQuickFilterTypes.has(attribute?.frontend_type))
        .map((attribute) => ({
            ...attribute,
            quick_filter_kind: attribute?.quick_filter_kind || PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE,
            options: dedupeProductQuickFilterOptions((attribute.options || [])
                .map((option) => {
                    const value = normalizeQuickFilterOptionValue(option?.value);
                    return {
                        ...option,
                        value,
                        label: normalizeQuickFilterOptionValue(option?.label) || value,
                    };
                })
                .filter((option) => option.value !== ''))
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

    const matchesAttributeId = (attributeValue) => (
        String(attributeValue?.attribute_id ?? attributeValue?.attribute?.id ?? '') === String(attributeId)
    );
    const ownAttributeValues = productAttributeValues.filter(matchesAttributeId);
    const inheritedValuesForAttribute = ownAttributeValues.length > 0
        ? []
        : inheritedAttributeValues.filter(matchesAttributeId);

    return Array.from(new Set(
        [
            ...inheritedValuesForAttribute,
            ...ownAttributeValues,
            ...variationAttributeValues,
            ...bundleItemAttributeValues,
            ...bundleOptionAttributeValues,
        ]
            .filter(matchesAttributeId)
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
const scoreProductQuickFilterPriority = (product, criteria = []) => (
    (Array.isArray(criteria) ? criteria : []).reduce((score, criterion, index) => {
        if (!criterion?.attribute || !criterion?.value) return score;

        return productMatchesQuickFilterValue(product, criterion.attribute, criterion.value)
            ? score + Math.max(1000, 10000 - (index * 1000))
            : score;
    }, 0)
);
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
const ORDER_FORM_LEAVE_GUARD_HISTORY_KEY = '__orderFormLeaveGuard';
const hasNonEmptyText = (value) => String(value ?? '').trim() !== '';
const normalizeOrderFormGuardText = (value) => String(value ?? '').trim();
const normalizeOrderFormGuardNumber = (value) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Number(parsedValue.toFixed(4)) : 0;
};
const normalizeOrderFormGuardValue = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeOrderFormGuardValue(entry));
    }

    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                const normalizedValue = normalizeOrderFormGuardValue(value[key]);
                if (normalizedValue === undefined || normalizedValue === '' || normalizedValue === null) {
                    return result;
                }
                if (Array.isArray(normalizedValue) && normalizedValue.length === 0) {
                    return result;
                }
                if (
                    normalizedValue
                    && typeof normalizedValue === 'object'
                    && !Array.isArray(normalizedValue)
                    && Object.keys(normalizedValue).length === 0
                ) {
                    return result;
                }

                result[key] = normalizedValue;
                return result;
            }, {});
    }

    if (typeof value === 'number') {
        return normalizeOrderFormGuardNumber(value);
    }

    return normalizeOrderFormGuardText(value);
};
const normalizeOrderFormGuardItem = (item = {}) => ({
    product_id: Number(item.product_id) || 0,
    actual_product_id: Number(item.actual_product_id) || 0,
    name: normalizeOrderFormGuardText(item.snapshot_name || item.name),
    sku: normalizeOrderFormGuardText(item.snapshot_sku || item.sku),
    actual_name: normalizeOrderFormGuardText(item.actual_snapshot_name || item.actual_name),
    actual_sku: normalizeOrderFormGuardText(item.actual_snapshot_sku || item.actual_sku),
    quantity: normalizeOrderFormGuardNumber(item.quantity),
    price: normalizeOrderFormGuardNumber(item.price),
    cost_price: normalizeOrderFormGuardNumber(item.cost_price),
    notes: normalizeOrderFormGuardText(item.notes),
    options: normalizeOrderFormGuardValue(item.options || {}),
    source_account_id: normalizeOrderFormGuardText(item.source_account_id || item.product_source_account_id),
    inventory_source_account_id: normalizeOrderFormGuardText(item.inventory_source_account_id),
    profit_center_id: normalizeOrderFormGuardText(item.profit_center_id),
});
const buildOrderFormLeaveGuardSnapshot = ({ formData = {}, orderKind = MAIN_ORDER_KIND, regionType = 'new' } = {}) => JSON.stringify({
    order_kind: getNormalizedOrderKind(orderKind),
    region_type: normalizeOrderFormGuardText(regionType),
    customer_name: normalizeOrderFormGuardText(formData.customer_name),
    customer_email: normalizeOrderFormGuardText(formData.customer_email),
    customer_phone: normalizeOrderFormGuardText(formData.customer_phone),
    address_detail: normalizeOrderFormGuardText(formData.address_detail),
    shipping_address: normalizeOrderFormGuardText(formData.shipping_address),
    province: normalizeOrderFormGuardText(formData.province),
    district: normalizeOrderFormGuardText(formData.district),
    ward: normalizeOrderFormGuardText(formData.ward),
    source: normalizeOrderSource(formData.source, DEFAULT_MANUAL_ORDER_SOURCE),
    sales_channel: normalizeOrderFormGuardText(formData.sales_channel || 'online'),
    profit_center_id: normalizeOrderFormGuardText(formData.profit_center_id),
    order_type: normalizeOrderType(formData.order_type),
    settlement_delta: normalizeOrderFormGuardNumber(formData.settlement_delta),
    return_tracking_code: normalizeOrderFormGuardText(formData.return_tracking_code),
    return_status: normalizeSupplementReturnStatus(formData.return_status),
    type: normalizeOrderFormGuardText(formData.type || 'Lẻ'),
    shipment_status: normalizeOrderFormGuardText(formData.shipment_status || 'Chưa giao'),
    notes: normalizeOrderFormGuardText(formData.notes),
    custom_attributes: normalizeOrderFormGuardValue(formData.custom_attributes || {}),
    shipping_fee: normalizeOrderFormGuardNumber(formData.shipping_fee),
    display_shipping_fee: normalizeOrderFormGuardNumber(formData.display_shipping_fee),
    shipping_tracking_code: normalizeOrderFormGuardText(formData.shipping_tracking_code),
    manual_discount: normalizeOrderFormGuardNumber(formData.manual_discount),
    discount: normalizeOrderFormGuardNumber(formData.discount),
    status: normalizeOrderFormGuardText(formData.status || 'new'),
    items: (Array.isArray(formData.items) ? formData.items : []).map(normalizeOrderFormGuardItem),
    supplement_items: (Array.isArray(formData.supplement_items) ? formData.supplement_items : []).map(normalizeOrderFormGuardItem),
});
const hasMeaningfulOrderFormDraftContent = (formData = {}) => {
    if ((Array.isArray(formData.items) && formData.items.length > 0) || (Array.isArray(formData.supplement_items) && formData.supplement_items.length > 0)) {
        return true;
    }

    const meaningfulTextFields = [
        formData.customer_name,
        formData.customer_email,
        formData.customer_phone,
        formData.address_detail,
        formData.shipping_address,
        formData.province,
        formData.district,
        formData.ward,
        formData.notes,
        formData.shipping_tracking_code,
        formData.return_tracking_code,
    ];

    if (meaningfulTextFields.some(hasNonEmptyText)) {
        return true;
    }

    if (
        normalizeOrderFormGuardNumber(formData.shipping_fee) !== 0
        || normalizeOrderFormGuardNumber(formData.display_shipping_fee) !== 0
        || normalizeOrderFormGuardNumber(formData.manual_discount) !== 0
        || normalizeOrderFormGuardNumber(formData.discount) !== 0
        || normalizeOrderFormGuardNumber(formData.settlement_delta) !== 0
    ) {
        return true;
    }

    return Object.values(formData.custom_attributes || {}).some((value) => {
        const normalizedValue = normalizeOrderFormGuardValue(value);
        if (Array.isArray(normalizedValue)) return normalizedValue.length > 0;
        if (normalizedValue && typeof normalizedValue === 'object') return Object.keys(normalizedValue).length > 0;
        return hasNonEmptyText(normalizedValue);
    });
};
const formatDetectionFieldList = (fields = []) => {
    const uniqueFields = [...new Set(fields.filter(Boolean))];
    if (uniqueFields.length === 0) return '';
    if (uniqueFields.length === 1) return uniqueFields[0];
    if (uniqueFields.length === 2) return `${uniqueFields[0]} và ${uniqueFields[1]}`;
    return `${uniqueFields.slice(0, -1).join(', ')} và ${uniqueFields[uniqueFields.length - 1]}`;
};
const buildAddressDetectionFeedback = (autoFilledFields = []) => {
    const fieldSummary = formatDetectionFieldList(autoFilledFields);

    if (!fieldSummary) {
        return null;
    }

    return {
        type: 'success',
        message: `Đã tự điền ${fieldSummary}.`,
    };
};
const parseMoneyNumber = (value, fallback = null) => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};
const resolveApiErrorMessage = (error, fallback) => {
    const errors = error?.response?.data?.errors;
    if (errors && typeof errors === 'object') {
        const firstError = Object.values(errors).flat().find(Boolean);
        if (firstError) {
            return String(firstError);
        }
    }

    return error?.response?.data?.message || fallback;
};
const normalizeOrderPriceMultiplierDraft = (value) => {
    const rawValue = String(value ?? '');
    let normalizedValue = '';
    let hasDecimalSeparator = false;

    rawValue.split('').forEach((char) => {
        if (/[0-9]/.test(char)) {
            normalizedValue += char;
            return;
        }

        if ((char === '.' || char === ',') && !hasDecimalSeparator) {
            normalizedValue += '.';
            hasDecimalSeparator = true;
        }
    });

    return normalizedValue;
};
const parseOrderPriceMultiplier = (value) => {
    const normalizedValue = normalizeOrderPriceMultiplierDraft(value);
    if (!normalizedValue || normalizedValue === '.') {
        return null;
    }

    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
};
const formatOrderPriceMultiplier = (value) => {
    const numericValue = parseOrderPriceMultiplier(value);
    if (numericValue === null) {
        return 'x-';
    }

    return `x${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(numericValue)}`;
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
const DISCOUNT_INPUT_MODE_AMOUNT = 'amount';
const DISCOUNT_INPUT_MODE_PERCENT = 'percent';
const DISCOUNT_PERCENT_ROUNDING_UNIT = 10000;
const isDiscountPercentInputValue = (value) => String(value ?? '').includes('%');
const normalizeDiscountPercentInputValue = (value) => {
    const rawValue = String(value ?? '').replace(/\s+/g, '');
    if (rawValue === '') {
        return '';
    }

    const isNegative = rawValue.startsWith('-');
    let numberText = '';
    let hasDecimalSeparator = false;

    rawValue.split('').forEach((char) => {
        if (/[0-9]/.test(char)) {
            numberText += char;
            return;
        }

        if ((char === '.' || char === ',') && !hasDecimalSeparator) {
            numberText += ',';
            hasDecimalSeparator = true;
        }
    });

    if (numberText.startsWith(',')) {
        numberText = `0${numberText}`;
    }

    return `${isNegative ? '-' : ''}${numberText}%`;
};
const formatDiscountPercentInputValue = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return '';
    }

    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(numericValue);
};
const stripDiscountPercentSymbol = (value) => normalizeDiscountPercentInputValue(value).replace('%', '');
const parseDiscountPercentInputValue = (value, { requireSymbol = true } = {}) => {
    if (requireSymbol && !isDiscountPercentInputValue(value)) {
        return null;
    }

    const normalizedValue = normalizeDiscountPercentInputValue(value)
        .replace('%', '')
        .replace(',', '.');
    if (normalizedValue === '' || normalizedValue === '-' || normalizedValue === '.' || normalizedValue === '-.') {
        return null;
    }

    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
};
const roundMoneyToNearestUnit = (value, unit = DISCOUNT_PERCENT_ROUNDING_UNIT) => {
    const numericValue = Number(value);
    const normalizedUnit = Number(unit);
    if (!Number.isFinite(numericValue) || !Number.isFinite(normalizedUnit) || normalizedUnit <= 0) {
        return 0;
    }

    const sign = numericValue < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(numericValue) / normalizedUnit) * normalizedUnit;
};
const calculateDiscountAmountFromPercent = (percentValue, baseAmount) => {
    const normalizedPercent = Number(percentValue);
    const normalizedBaseAmount = parseMoneyNumber(baseAmount, 0) || 0;
    if (!Number.isFinite(normalizedPercent) || !Number.isFinite(normalizedBaseAmount)) {
        return 0;
    }

    return roundMoneyToNearestUnit((normalizedBaseAmount * normalizedPercent) / 100);
};
const resolveDiscountInputCommitValue = (value, fallback = 0, baseAmount = 0, inputMode = DISCOUNT_INPUT_MODE_AMOUNT) => {
    if (inputMode === DISCOUNT_INPUT_MODE_PERCENT || isDiscountPercentInputValue(value)) {
        const percentValue = parseDiscountPercentInputValue(value, { requireSymbol: false });
        return percentValue === null ? 0 : calculateDiscountAmountFromPercent(percentValue, baseAmount);
    }

    return resolveSignedMoneyInputCommitValue(value, fallback);
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
const resolveActualReplacementFinancialPreview = (entry, currentLine = null) => {
    const quantity = Math.max(MIN_ORDER_ITEM_QUANTITY, parseQuantityNumber(currentLine?.quantity, 1) || 1);
    const lockedPrice = resolveMoneyValue(
        entry?.locked_price,
        entry?.effective_selling_price,
        currentLine?.price,
        entry?.price,
        0
    );
    const listPrice = resolveMoneyValue(entry?.list_price, entry?.price, 0);
    const costPrice = resolveProductCostPrice(entry, currentLine?.cost_price ?? 0);
    const serverProfitTotal = parseMoneyNumber(entry?.replacement_profit_total);
    const profitTotal = serverProfitTotal !== null
        ? serverProfitTotal
        : ((parseMoneyNumber(lockedPrice, 0) || 0) * quantity) - calculateRoundedImportCostLineTotal(costPrice, quantity);

    return {
        quantity,
        lockedPrice: parseMoneyNumber(lockedPrice, 0) || 0,
        listPrice: parseMoneyNumber(listPrice, 0) || 0,
        costPrice,
        profitTotal,
        priceDelta: (parseMoneyNumber(listPrice, 0) || 0) - (parseMoneyNumber(lockedPrice, 0) || 0),
    };
};
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
    const sourceFields = resolveProductSourceFields(product);

    return {
        ...product,
        ...inventorySnapshot,
        ...sourceFields,
        price: resolveMoneyValue(product?.price, 0),
        expected_cost: parseMoneyNumber(product?.expected_cost),
        cost_price: resolveProductCostPrice(product),
        profit_center_id: Number(product?.profit_center_id) || null,
        unit_name: resolveOrderUnitLabel(product),
        variations: Array.isArray(product?.variations)
            ? product.variations.map((variation) => ({
                ...variation,
                ...resolveInventorySnapshot(variation),
                ...resolveProductSourceFields(variation, sourceFields),
                price: resolveMoneyValue(variation?.price, 0),
                expected_cost: parseMoneyNumber(variation?.expected_cost),
                cost_price: resolveProductCostPrice(variation),
                profit_center_id: Number(variation?.profit_center_id || product?.profit_center_id) || null,
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
                        ...resolveProductSourceFields(bundleItem, sourceFields),
                        price: resolveMoneyValue(bundleItem?.price, 0),
                        expected_cost: parseMoneyNumber(bundleItem?.expected_cost),
                        cost_price: resolveProductCostPrice(bundleItem),
                        profit_center_id: Number(bundleItem?.profit_center_id) || null,
                        unit_name: resolveOrderUnitLabel(bundleItem, product),
                    }))
                    : bundleOption?.items,
            }))
            : product?.bundle_options,
    };
};
const withActualReplacementLineContext = (entry, currentLine = null, { declared = false, groupId = null, original = false, lineNumber = null } = {}) => {
    if (!entry || typeof entry !== 'object') return entry;

    const normalizedEntry = normalizeProductPickerEntry(entry);
    const quantity = Math.max(MIN_ORDER_ITEM_QUANTITY, parseQuantityNumber(currentLine?.quantity, 1) || 1);
    const lockedPrice = parseMoneyNumber(currentLine?.price, 0) || 0;
    const listPrice = resolveMoneyValue(entry?.list_price, entry?.price, normalizedEntry?.price, 0);
    const costPrice = resolveProductCostPrice(normalizedEntry, currentLine?.cost_price ?? 0);
    const profitTotal = (lockedPrice * quantity) - calculateRoundedImportCostLineTotal(costPrice, quantity);
    const normalizedProductId = Number(normalizedEntry?.target_product_id ?? normalizedEntry?.product_id ?? normalizedEntry?.id ?? 0) || 0;
    const currentProductId = Number(currentLine?.product_id ?? currentLine?.target_product_id ?? currentLine?.id ?? 0) || 0;
    const entrySku = normalizeProductSearchText(normalizedEntry?.display_sku || normalizedEntry?.sku);
    const currentSku = normalizeProductSearchText(currentLine?.display_sku || currentLine?.sku);
    const isOriginalProduct = Boolean(original)
        || (normalizedProductId > 0 && currentProductId > 0 && normalizedProductId === currentProductId)
        || Boolean(entrySku && currentSku && entrySku === currentSku);

    return {
        ...normalizedEntry,
        list_price: listPrice,
        locked_price: lockedPrice,
        effective_selling_price: lockedPrice,
        quantity,
        cost_price: costPrice,
        replacement_cost_price: costPrice,
        replacement_profit_total: profitTotal,
        replacement_group_id: groupId || normalizedEntry?.replacement_group_id || entry?.replacement_group_id || null,
        is_declared_replacement: declared || Boolean(normalizedEntry?.is_declared_replacement),
        is_original_order_product: isOriginalProduct,
        source_line_id: currentLine?.line_id || normalizedEntry?.source_line_id || null,
        source_line_number: lineNumber || normalizedEntry?.source_line_number || null,
    };
};
const getActualReplacementEntryKey = (entry) => {
    if (!entry || typeof entry !== 'object') return '';

    const entryKind = String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
    const productId = Number(entry?.target_product_id ?? entry?.product_id ?? entry?.id ?? 0) || 0;
    if (productId > 0) {
        return `${entryKind}:${productId}`;
    }

    const sku = normalizeProductSearchText(entry?.display_sku || entry?.sku);
    return sku ? `${entryKind}:sku:${sku}` : '';
};
const mergeActualProductReplacementEntries = (...entryGroups) => {
    const seenKeys = new Set();
    const mergedEntries = [];

    entryGroups.flat().forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;

        const normalizedEntry = normalizeProductPickerEntry(entry);
        const entryKey = getActualReplacementEntryKey(normalizedEntry);
        if (!entryKey || seenKeys.has(entryKey)) return;

        seenKeys.add(entryKey);
        mergedEntries.push(normalizedEntry);
    });

    return mergedEntries;
};
const getProductReplacementDeclarationSku = (entry) => normalizeCanvasText(entry?.display_sku || entry?.sku);
const getProductReplacementDeclarationName = (entry) => (
    normalizeCanvasText(entry?.display_name || entry?.name) || 'Sản phẩm'
);
const buildProductReplacementDeclarationEntryFromLine = (line) => {
    const productId = Number(line?.product_id ?? line?.target_product_id ?? line?.id ?? 0) || 0;
    const sku = normalizeCanvasText(line?.display_sku || line?.sku);
    if (productId <= 0 && !sku) return null;

    return normalizeProductPickerEntry({
        ...line,
        id: productId || undefined,
        product_id: productId || line?.product_id || undefined,
        target_product_id: productId || line?.target_product_id || undefined,
        entry_kind: SEARCH_ENTRY_PRODUCT,
        display_name: line?.display_name || line?.name,
        display_sku: sku,
        sku,
        price: resolveMoneyValue(line?.price, 0),
        cost_price: resolveProductCostPrice(line),
    });
};
const isBundleOptionPickerEntry = (entry) => (
    String(entry?.entry_kind || '').trim() === SEARCH_ENTRY_BUNDLE_OPTION
);
const getBundleItemProductId = (bundleItem) => Number(
    bundleItem?.product_id
    ?? bundleItem?.target_product_id
    ?? bundleItem?.variant_id
    ?? bundleItem?.id
    ?? 0
) || 0;
const mergeLatestProductSnapshotIntoBundleItem = (bundleItem, latest) => {
    if (!latest || typeof latest !== 'object') {
        return bundleItem;
    }

    const productId = getBundleItemProductId(bundleItem);
    const latestName = resolveCatalogProductName(latest, productId);
    const currentName = normalizeCanvasText(bundleItem?.name);
    const currentDisplayName = normalizeCanvasText(bundleItem?.display_name || bundleItem?.name);
    const shouldHydrateName = latestName && (
        isPlaceholderProductName(currentName, productId)
        || isPlaceholderProductName(currentDisplayName, productId)
    );
    const latestSku = normalizeCanvasText(latest?.display_sku || latest?.sku);
    const currentSku = normalizeCanvasText(bundleItem?.sku);
    const shouldHydrateSku = latestSku && (!currentSku || currentSku === 'N/A');

    return {
        ...bundleItem,
        ...(shouldHydrateName ? {
            name: latestName,
            display_name: latestName,
        } : {}),
        ...(shouldHydrateSku ? {
            sku: latestSku,
            display_sku: latestSku,
        } : {}),
        unit_name: resolveOrderUnitLabel(latest, bundleItem),
        price: resolveMoneyValue(latest?.price, bundleItem?.price, 0),
        cost_price: resolveProductCostPrice(latest, bundleItem?.cost_price),
        expected_cost: parseMoneyNumber(latest?.expected_cost, parseMoneyNumber(bundleItem?.expected_cost)),
        main_image: normalizeCanvasText(latest?.main_image || latest?.primary_image?.url || bundleItem?.main_image),
        ...resolveInventorySnapshot(latest, bundleItem),
        ...resolveProductSourceFields(latest, bundleItem),
    };
};
const mergeLatestProductSnapshotsIntoBundleItems = (bundleItems = [], latestMap = new Map()) => (
    (Array.isArray(bundleItems) ? bundleItems : []).map((bundleItem) => {
        const latest = latestMap.get(getBundleItemProductId(bundleItem));
        return mergeLatestProductSnapshotIntoBundleItem(bundleItem, latest);
    })
);
const mergeLatestProductSnapshotIntoPickerEntry = (entry, latest) => {
    const normalizedEntry = normalizeProductPickerEntry(entry);
    if (!latest || typeof latest !== 'object') {
        return normalizedEntry;
    }

    if (isBundleOptionPickerEntry(normalizedEntry)) {
        const inventorySnapshot = resolveInventorySnapshot(latest, normalizedEntry);
        const latestBundleItems = Array.isArray(latest?.bundle_items) && latest.bundle_items.length > 0
            ? latest.bundle_items
            : normalizedEntry?.bundle_items;
        const bundleOptionPrice = resolveBundleOptionEntryPrice(latest, latestBundleItems);
        const bundleOptionTotalPrice = calculateBundleItemsSubtotal(latestBundleItems);

        return normalizeProductPickerEntry({
            ...normalizedEntry,
            computed_stock: inventorySnapshot.computed_stock,
            pending_export_quantity: inventorySnapshot.pending_export_quantity,
            available_to_sell: inventorySnapshot.available_to_sell,
            unit_name: normalizedEntry?.unit_name || resolveOrderUnitLabel(latest, normalizedEntry),
            main_image: normalizedEntry?.main_image || latest?.main_image || latest?.primary_image?.url || latest?.image_url || '',
            type: normalizedEntry?.type || latest?.type || '',
            bundle_title: normalizedEntry?.bundle_title || latest?.bundle_title || '',
            bundle_config_title: normalizedEntry?.bundle_config_title || normalizedEntry?.bundle_title || latest?.bundle_title || '',
            price: bundleOptionPrice || normalizedEntry?.price,
            expected_cost: parseMoneyNumber(latest?.expected_cost, parseMoneyNumber(normalizedEntry?.expected_cost)),
            cost_price: resolveProductCostPrice(latest, normalizedEntry?.cost_price),
            bundle_option_total_price: bundleOptionTotalPrice || latest?.bundle_option_total_price || normalizedEntry?.bundle_option_total_price,
            bundle_option_discounted_price: bundleOptionPrice || latest?.bundle_option_discounted_price || normalizedEntry?.bundle_option_discounted_price,
            ...resolveProductSourceFields(latest, normalizedEntry),
            bundle_items: latestBundleItems,
        });
    }

    return normalizeProductPickerEntry({ ...normalizedEntry, ...latest });
};
const mergeLatestBundleItemsIntoPickerEntry = (entry, latestMap) => {
    const normalizedEntry = normalizeProductPickerEntry(entry);
    if (!isBundleOptionPickerEntry(normalizedEntry) || !Array.isArray(normalizedEntry?.bundle_items)) {
        return normalizedEntry;
    }

    const mergedBundleItems = mergeLatestProductSnapshotsIntoBundleItems(normalizedEntry.bundle_items, latestMap);
    const bundleOptionPrice = resolveBundleOptionEntryPrice(normalizedEntry, mergedBundleItems);
    const bundleOptionTotalPrice = calculateBundleItemsSubtotal(mergedBundleItems);

    return normalizeProductPickerEntry({
        ...normalizedEntry,
        price: bundleOptionPrice || normalizedEntry.price,
        bundle_option_total_price: bundleOptionTotalPrice || normalizedEntry.bundle_option_total_price,
        bundle_option_discounted_price: bundleOptionPrice || normalizedEntry.bundle_option_discounted_price,
        bundle_items: mergedBundleItems,
    });
};
const calculateItemsCostTotal = (items = []) => items.reduce(
    (sum, item) => sum + calculateRoundedImportCostLineTotal(item?.cost_price, parseMoneyNumber(item?.quantity, 0) || 0),
    0
);
const resolveSingleOrderItemsProfitCenterId = (items = []) => {
    const profitCenterIds = Array.from(new Set(
        (Array.isArray(items) ? items : [])
            .map((item) => Number(item?.profit_center_id) || 0)
            .filter((id) => id > 0)
    ));

    return profitCenterIds.length === 1 ? String(profitCenterIds[0]) : '';
};
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
    const normalizedParentSearch = normalizeProductSearchText(normalizedParentName);
    const normalizedVariationSearch = normalizeProductSearchText(normalizedVariationName);

    if (normalizedVariationName) {
        if (
            normalizedParentName
            && normalizedVariationSearch
            && normalizedVariationSearch !== normalizedParentSearch
            && !normalizedVariationSearch.startsWith(normalizedParentSearch)
        ) {
            return `${normalizedParentName} - ${normalizedVariationName || normalizedOptionLabel}`;
        }

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
const resolveProductSearchVariationDisplayName = (parentName, variationName, optionLabel, providedDisplayName = '') => {
    const normalizedParentName = normalizeCanvasText(parentName);
    const normalizedProvidedDisplayName = normalizeCanvasText(providedDisplayName);
    const normalizedVariationName = normalizeCanvasText(variationName);
    const normalizedParentSearch = normalizeProductSearchText(normalizedParentName);
    const normalizedProvidedSearch = normalizeProductSearchText(normalizedProvidedDisplayName);

    if (normalizedProvidedDisplayName && normalizedParentSearch && normalizedProvidedSearch.includes(normalizedParentSearch)) {
        return normalizedProvidedDisplayName;
    }

    return buildVariationDisplayName(
        normalizedParentName,
        normalizedProvidedDisplayName || normalizedVariationName,
        optionLabel
    );
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
const resolveOrderLineItemDisplayName = ({ name, options, fallbackName = '', preferSubmittedName = false }) => {
    const normalizedName = normalizeCanvasText(name);
    const normalizedFallbackName = normalizeCanvasText(fallbackName);
    const normalizedOptions = normalizeOrderLineOptions(options);

    if (preferSubmittedName && normalizedName) {
        return normalizedName;
    }

    if (normalizedOptions) {
        const optionParentName = normalizeCanvasText(normalizedOptions?.variant_parent_name);
        const optionVariantName = normalizeCanvasText(normalizedOptions?.variant_name);
        const optionLabel = normalizeCanvasText(normalizedOptions?.variant_label);

        if (!optionParentName && !optionVariantName) {
            return normalizedName || normalizedFallbackName || 'Sản phẩm';
        }

        const variationDisplayName = buildVariationDisplayName(
            optionParentName,
            optionVariantName || normalizedName || normalizedFallbackName,
            optionLabel
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
    const explicitUid = normalizeCanvasText(
        bundleOption?.bundle_option_uid
        || bundleOption?.uid
        || bundleOption?.option_uid
    );
    if (explicitUid) {
        return explicitUid.startsWith('uid:') ? explicitUid : `uid:${explicitUid}`;
    }

    const explicitKey = normalizeCanvasText(
        bundleOption?.bundle_option_key
        || bundleOption?.key
        || bundleOption?.option_key
    );
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
const MAX_DELETED_ORDER_LINE_ITEM_BATCHES = 10;
const cloneOrderLineItemSnapshot = (item = {}) => {
    if (!item || typeof item !== 'object') {
        return {};
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(item);
        } catch {
            // Fall back for non-cloneable values.
        }
    }

    return JSON.parse(JSON.stringify(item));
};
const createDeletedOrderLineItemBatch = (items = [], shouldDeleteItem = () => false) => {
    const deletedItems = [];

    (Array.isArray(items) ? items : []).forEach((item, index) => {
        if (!shouldDeleteItem(item, index)) {
            return;
        }

        deletedItems.push({
            index,
            item: cloneOrderLineItemSnapshot(item),
        });
    });

    return {
        id: `deleted-order-items-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        items: deletedItems,
    };
};
const restoreDeletedOrderLineItemBatch = (currentItems = [], deletedItems = []) => {
    const nextItems = Array.isArray(currentItems) ? [...currentItems] : [];
    const existingLineIds = new Set(
        nextItems
            .map((item) => normalizeCanvasText(item?.line_id))
            .filter(Boolean)
    );
    const restoredLineIds = [];

    [...(Array.isArray(deletedItems) ? deletedItems : [])]
        .sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))
        .forEach((entry) => {
            const restoredItem = cloneOrderLineItemSnapshot(entry?.item || {});
            if (!restoredItem || typeof restoredItem !== 'object') {
                return;
            }

            const existingLineId = normalizeCanvasText(restoredItem.line_id);
            if (!existingLineId || existingLineIds.has(existingLineId)) {
                restoredItem.line_id = createOrderLineId('restored-order-item');
            }

            const restoredLineId = normalizeCanvasText(restoredItem.line_id);
            if (restoredLineId) {
                existingLineIds.add(restoredLineId);
                restoredLineIds.push(restoredLineId);
            }

            const targetIndex = Math.min(
                Math.max(Number(entry?.index) || 0, 0),
                nextItems.length
            );
            nextItems.splice(targetIndex, 0, restoredItem);
        });

    return {
        items: applySequentialOrderLineSortOrder(nextItems),
        restoredLineIds,
    };
};
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
        original_name,
        original_sku,
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
        profit_center_id = undefined,
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
    const normalizedProductId = Number(product_id) || 0;
    const submittedName = resolveOrderLineItemDisplayName({
        name,
        options: normalizedOptions,
        preferSubmittedName: true,
    });
    const catalogFallbackName = resolveOrderLineItemDisplayName({
        name: snapshot_name
            ?? original_name
            ?? payload.catalog_name
            ?? payload.current_product_name
            ?? payload.product?.name
            ?? payload.display_name,
        options: normalizedOptions,
        fallbackName: '',
    });
    const resolvedName = isPlaceholderProductName(submittedName, normalizedProductId)
        ? (catalogFallbackName || submittedName)
        : submittedName;
    const resolvedSku = normalizeCanvasText(sku) || 'N/A';
    const rawSnapshotName = resolveOrderLineItemDisplayName({
        name: snapshot_name ?? name,
        options: normalizedOptions,
        fallbackName: resolvedName,
        preferSubmittedName: true,
    });
    const resolvedSnapshotName = isPlaceholderProductName(rawSnapshotName, normalizedProductId)
        ? (catalogFallbackName || resolvedName)
        : rawSnapshotName;
    const resolvedSnapshotSku = normalizeCanvasText(snapshot_sku ?? sku) || resolvedSku;
    const resolvedOriginalName = resolveOrderLineItemDisplayName({
        name: original_name ?? payload.catalog_name ?? payload.current_product_name ?? payload.product?.name ?? resolvedName,
        options: normalizedOptions,
        fallbackName: resolvedName,
    });
    const resolvedOriginalSku = normalizeCanvasText(
        original_sku ?? payload.catalog_sku ?? payload.current_product_sku ?? payload.product?.sku ?? resolvedSku
    ) || resolvedSku;
    const resolvedCostPrice = resolveRoundedImportCostValue(cost_price, 0);
    const normalizedActualProductId = Number(actual_product_id) || 0;
    const resolvedActualName = resolveOrderLineItemDisplayName({
        name: actual_name,
        options: normalizedOptions,
        fallbackName: '',
        preferSubmittedName: true,
    });
    const resolvedActualSku = normalizeCanvasText(actual_sku) || '';
    const resolvedActualSnapshotName = resolveOrderLineItemDisplayName({
        name: actual_snapshot_name ?? actual_name,
        options: normalizedOptions,
        fallbackName: resolvedActualName,
        preferSubmittedName: true,
    });
    const resolvedActualSnapshotSku = normalizeCanvasText(actual_snapshot_sku ?? actual_sku) || resolvedActualSku;
    const sourceFields = resolveProductSourceFields(payload);

    return {
        line_id: normalizeCanvasText(line_id) || createOrderLineId('order-item'),
        product_id: Number(product_id) || 0,
        actual_product_id: normalizedActualProductId || null,
        name: resolvedName,
        sku: resolvedSku,
        snapshot_name: resolvedSnapshotName,
        snapshot_sku: resolvedSnapshotSku,
        original_name: resolvedOriginalName,
        original_sku: resolvedOriginalSku,
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
        profit_center_id: Number(profit_center_id) || null,
        source_account_id: sourceFields.source_account_id,
        product_source_account_id: sourceFields.product_source_account_id,
        inventory_source_account_id: sourceFields.inventory_source_account_id,
        product_catalog_account_id: sourceFields.product_catalog_account_id,
        source_account_name: sourceFields.source_account_name,
        product_source_account_name: sourceFields.product_source_account_name,
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
const OrderLineActualOverrideNotice = ({ item, onClear, className = '' }) => {
    if (!hasActualOrderProductOverride(item)) return null;

    return (
        <div className={`inline-flex max-w-full items-center gap-1.5 ${className}`.trim()}>
            <span className="min-w-0 truncate">
                {`Thực gửi: ${getOrderItemActualNameLabel(item) || 'Sản phẩm khác'}`}
            </span>
            {onClear ? (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onClear(event);
                    }}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded border border-rose-200 bg-white text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50"
                    title="Về mã gốc dòng này"
                    aria-label="Về mã gốc dòng này"
                >
                    <span className="material-symbols-outlined text-[13px] leading-none">undo</span>
                </button>
            ) : null}
        </div>
    );
};
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
const buildProductRefreshPayload = (item, { useEffectiveInventoryProduct = false } = {}) => {
    const options = item?.options || {};
    const productId = useEffectiveInventoryProduct
        ? getOrderItemEffectiveInventoryProductId(item)
        : Number(item?.target_product_id ?? item?.product_id ?? item?.id ?? 0) || 0;

    if (!productId) {
        return null;
    }

    const entryKind = normalizeCanvasText(
        item?.entry_kind
        || options?.search_entry_kind
        || SEARCH_ENTRY_PRODUCT
    );
    const bundleParentId = Number(item?.bundle_parent_id ?? options?.bundle_parent_id ?? 0) || 0;
    const isBundleContext = entryKind === SEARCH_ENTRY_BUNDLE_OPTION
        || bundleParentId > 0
        || normalizeCanvasText(item?.bundle_option_key || options?.bundle_option_key)
        || normalizeCanvasText(item?.bundle_option_uid || options?.bundle_option_uid)
        || normalizeCanvasText(item?.bundle_option_title || options?.bundle_option_title);

    const payload = {
        product_id: productId,
        sku: useEffectiveInventoryProduct ? getOrderItemEffectiveInventorySku(item) : (item?.display_sku || item?.sku || ''),
        name: useEffectiveInventoryProduct ? getOrderItemEffectiveInventoryName(item) : (item?.display_name || item?.name || ''),
        ...buildProductSourcePayload(item),
    };

    if (isBundleContext) {
        payload.entry_kind = SEARCH_ENTRY_BUNDLE_OPTION;
        payload.bundle_parent_id = bundleParentId || Number(item?.target_product_id ?? item?.product_id ?? item?.id ?? 0) || undefined;
        payload.bundle_option_uid = normalizeCanvasText(item?.bundle_option_uid || options?.bundle_option_uid || item?.uid || item?.option_uid) || undefined;
        payload.bundle_option_key = normalizeCanvasText(item?.bundle_option_key || options?.bundle_option_key || resolveBundleOptionKey(item)) || undefined;
        payload.bundle_option_title = normalizeCanvasText(item?.bundle_option_title || options?.bundle_option_title || resolveBundleOptionTitle(item)) || undefined;
        payload.bundle_option_post_id = Number(item?.option_post_id ?? item?.bundle_option_post_id ?? options?.bundle_option_post_id) || undefined;
        payload.bundle_item_base_product_id = Number(item?.bundle_item_base_product_id ?? options?.bundle_item_base_product_id ?? item?.base_product_id) || undefined;
    }

    return payload;
};
const resolveSubmittedOrderItemName = (item, productId = 0) => {
    const normalizedProductId = Number(productId) || Number(item?.product_id) || 0;
    const candidates = [
        item?.snapshot_name,
        item?.name,
        item?.original_name,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeCanvasText(candidate);
        if (normalized && !isPlaceholderProductName(normalized, normalizedProductId)) {
            return normalized;
        }
    }

    return '';
};
const buildOrderItemMergeKey = (item) => {
    const options = item?.options || {};

    return [
        Number(item?.product_id) || 0,
        normalizeProductSearchText(item?.product_source_account_id || item?.source_account_id),
        normalizeProductSearchText(item?.inventory_source_account_id),
        normalizeProductSearchText(options?.bundle_parent_id),
        normalizeProductSearchText(options?.bundle_option_uid),
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
                ...resolveProductSourceFields(normalizedAddition, existingItem),
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
        const bundleOptionUid = normalizeCanvasText(entry?.bundle_option_uid || entry?.uid || entry?.option_uid);

        const bundleItems = Array.isArray(entry?.bundle_items) ? entry.bundle_items : [];

        return bundleItems
            .map((bundleItem) => {
                const productId = getBundleItemProductId(bundleItem);
                const quantity = Math.max(1, Number(bundleItem?.quantity) || 1);
                const unitPrice = Number(bundleItem?.price ?? 0) || 0;
                const bundleItemRawName = normalizeCanvasText(bundleItem?.display_name || bundleItem?.name);
                const bundleItemName = isPlaceholderProductName(bundleItemRawName, productId)
                    ? ''
                    : bundleItemRawName;

                return createOrderLineItem({
                    product_id: productId,
                    name: bundleItemName || (productId ? `Sản phẩm #${productId}` : 'Sản phẩm bundle'),
                    sku: normalizeCanvasText(bundleItem?.display_sku || bundleItem?.sku),
                    unit_name: resolveOrderUnitLabel(bundleItem),
                    quantity,
                    price: unitPrice,
                    cost_price: resolveProductCostPrice(bundleItem),
                    computed_stock: bundleItem?.computed_stock,
                    pending_export_quantity: bundleItem?.pending_export_quantity,
                    available_to_sell: bundleItem?.available_to_sell,
                    ...resolveProductSourceFields(bundleItem, entry),
                    category_id: bundleItem?.category_id,
                    profit_center_id: bundleItem?.profit_center_id,
                    product_attributes: bundleItem?.attributes_map || bundleItem?.product_attributes,
                    main_image: bundleItem?.main_image || bundleItem?.primary_image?.url || bundleItem?.image_url || '',
                    options: {
                        bundle_parent_id: bundleParentId || undefined,
                        bundle_parent_name: bundleParentName,
                        bundle_option_uid: bundleOptionUid || undefined,
                        bundle_option_key: bundleOptionKey,
                        bundle_option_title: bundleOptionTitle,
                        bundle_option_post_id: Number(entry?.option_post_id) || undefined,
                        bundle_option_post_title: normalizeCanvasText(entry?.option_post_title),
                        bundle_item_base_product_id: Number(bundleItem?.base_product_id) || undefined,
                        variant_label: normalizeCanvasText(bundleItem?.option_label || bundleItem?.variant_label),
                        variant_name: normalizeCanvasText(bundleItem?.variant_name),
                        search_entry_kind: SEARCH_ENTRY_BUNDLE_OPTION,
                    },
                });
            })
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
        ...resolveProductSourceFields(entry),
        category_id: entry?.category_id,
        profit_center_id: entry?.profit_center_id,
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
        const productId = Number(product?.id ?? product?.product_id) || 0;
        const rawEntryKind = String(product?.entry_kind || '').trim();
        const isDirectVariationEntry = rawEntryKind === SEARCH_ENTRY_VARIATION || Number(product?.parent_product_id ?? 0) > 0;
        const directParentProductId = Number(
            product?.parent_product_id
            ?? product?.parent?.id
            ?? product?.parent_configurable?.[0]?.id
            ?? product?.parentConfigurable?.[0]?.id
            ?? 0
        ) || null;
        const directParentProductName = normalizeCanvasText(
            product?.parent_product_name
            || product?.parent?.name
            || product?.parent_configurable?.[0]?.name
            || product?.parentConfigurable?.[0]?.name
        );
        const directOptionLabel = normalizeCanvasText(product?.option_label || product?.attribute_summary || buildAttributeValueSummary(product));
        const baseName = normalizeCanvasText(product?.name) || 'Sản phẩm';
        const baseDisplayName = isDirectVariationEntry
            ? resolveProductSearchVariationDisplayName(
                directParentProductName,
                baseName,
                directOptionLabel,
                product?.display_name
            )
            : (normalizeCanvasText(product?.display_name) || baseName);
        const baseSku = normalizeCanvasText(product?.sku);
        const baseDisplaySku = normalizeCanvasText(product?.display_sku) || baseSku;
        const baseSourceFields = resolveProductSourceFields(product);
        const baseServerSearchMatch = Boolean(product?.server_search_match || product?.__server_search_match);
        const baseEntry = {
            entry_id: `${isDirectVariationEntry ? 'variation' : 'product'}-${productId}`,
            entry_kind: isDirectVariationEntry ? SEARCH_ENTRY_VARIATION : SEARCH_ENTRY_PRODUCT,
            id: productId,
            target_product_id: productId,
            parent_product_id: isDirectVariationEntry ? directParentProductId : undefined,
            parent_product_name: isDirectVariationEntry ? directParentProductName : undefined,
            name: baseName,
            display_name: baseDisplayName,
            sku: baseSku,
            display_sku: baseDisplaySku,
            option_label: isDirectVariationEntry ? directOptionLabel : '',
            price: Number(product?.price ?? 0) || 0,
            expected_cost: parseMoneyNumber(product?.expected_cost),
            cost_price: resolveProductCostPrice(product),
            unit_name: resolveOrderUnitLabel(product),
            ...resolveInventorySnapshot(product),
            ...baseSourceFields,
            server_search_match: baseServerSearchMatch,
            type: normalizeCanvasText(product?.type),
            bundle_title: normalizeCanvasText(product?.bundle_title),
            main_image: getPickerPrimaryImage(product),
            attribute_values: getPickerAttributeValues(product),
            search_keywords: [
                baseName,
                baseDisplayName,
                baseSku,
                baseDisplaySku,
                directParentProductName,
                directOptionLabel,
                normalizeCanvasText(product?.bundle_title),
                buildAttributeValueSummary(product),
            ].filter(Boolean),
        };
        const hasBundleOptionRows = Array.isArray(product?.bundle_options)
            && product.bundle_options.some((bundleOption) => (
                Array.isArray(bundleOption?.items) && bundleOption.items.length > 0
            ));
        const shouldExposeBundleParentEntry = !(
            includeNested
            && baseEntry.type === 'bundle'
            && hasBundleOptionRows
        );

        if (
            baseEntry.id > 0
            && shouldExposeBundleParentEntry
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
                parent_product_sku: baseEntry.sku,
                name: normalizeCanvasText(variation?.name) || baseEntry.name,
                display_name: resolveProductSearchVariationDisplayName(
                    baseEntry.name,
                    variation?.name,
                    optionLabel,
                    variation?.display_name
                ),
                sku: normalizeCanvasText(variation?.sku),
                display_sku: normalizeCanvasText(variation?.sku || product?.sku),
                option_label: optionLabel,
                price: Number(variation?.price ?? 0) || 0,
                expected_cost: parseMoneyNumber(variation?.expected_cost),
                cost_price: resolveProductCostPrice(variation),
                unit_name: resolveOrderUnitLabel(variation, product),
                ...resolveInventorySnapshot(variation),
                ...resolveProductSourceFields(variation, baseSourceFields),
                server_search_match: Boolean(variation?.server_search_match || variation?.__server_search_match || baseServerSearchMatch),
                type: normalizeCanvasText(variation?.type || 'simple'),
                main_image: getPickerPrimaryImage(variation) || baseEntry.main_image,
                attribute_values: getPickerAttributeValues(variation),
                parent_attribute_values: baseEntry.attribute_values,
                search_keywords: [
                    baseEntry.name,
                    baseEntry.display_name,
                    baseEntry.sku,
                    baseEntry.display_sku,
                    normalizeCanvasText(variation?.display_name),
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
            const bundleOptionUid = normalizeCanvasText(bundleOption?.bundle_option_uid || bundleOption?.uid || bundleOption?.option_uid);
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
                    ...resolveProductSourceFields(bundleItem, baseSourceFields),
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
            const optionBaseTotal = calculateBundleItemsSubtotal(bundleItems);
            const optionPrice = resolveBundleOptionEntryPrice(bundleOption, bundleItems);
            const optionTotalPrice = optionBaseTotal > 0 ? optionBaseTotal : optionPrice;
            const optionCostTotal = bundleItems.reduce((sum, bundleItem) => (
                sum + (resolveRoundedImportCostValue(bundleItem.cost_price, 0) * (Number(bundleItem.quantity) || 0))
            ), 0);
            const bundleDisplayName = [baseEntry.name, bundleOptionTitle]
                .filter((part, index, source) => (
                    part
                    && source.findIndex((candidate) => normalizeProductSearchText(candidate) === normalizeProductSearchText(part)) === index
                ))
                .join(' - ');

            pushEntry({
                entry_id: `bundle-option-${baseEntry.id}-${bundleOptionKey}`,
                entry_kind: SEARCH_ENTRY_BUNDLE_OPTION,
                id: `bundle-option-${baseEntry.id}-${bundleOptionKey}`,
                target_product_id: baseEntry.id,
                bundle_parent_id: baseEntry.id,
                bundle_parent_name: baseEntry.name,
                bundle_option_uid: bundleOptionUid,
                bundle_option_key: bundleOptionKey,
                bundle_option_title: bundleOptionTitle,
                raw_bundle_option_title: normalizeCanvasText(bundleOption?.raw_option_title || bundleOption?.option_title),
                bundle_option_status: normalizeCanvasText(bundleOption?.bundle_option_status || 'visible'),
                bundle_title: baseEntry.bundle_title,
                bundle_config_title: baseEntry.bundle_title,
                option_post_id: Number(bundleOption?.option_post_id) || undefined,
                option_post_title: normalizeCanvasText(bundleOption?.option_post_title),
                name: baseEntry.name,
                display_name: bundleDisplayName || baseEntry.name,
                sku: baseEntry.sku,
                display_sku: baseEntry.sku,
                price: optionPrice,
                expected_cost: optionCostTotal,
                cost_price: optionCostTotal,
                ...baseSourceFields,
                bundle_option_total_price: optionTotalPrice,
                bundle_option_discounted_price: optionPrice,
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
        const isBundleOptionEntry = entryKind === SEARCH_ENTRY_BUNDLE_OPTION;
        const parentProductId = Number(item?.parent_product_id ?? 0);
        const parentProductName = normalizeCanvasText(item?.parent_product_name);
        const bundleParentId = isBundleOptionEntry ? (Number(item?.bundle_parent_id ?? targetProductId) || targetProductId) : 0;
        const bundleParentName = isBundleOptionEntry
            ? normalizeCanvasText(item?.bundle_parent_name || item?.parent_product_name || item?.name)
            : '';
        const bundleOptionTitle = isBundleOptionEntry
            ? normalizeCanvasText(item?.bundle_option_title || resolveBundleOptionTitle(item))
            : '';
        const rawBundleOptionTitle = isBundleOptionEntry
            ? normalizeCanvasText(item?.raw_bundle_option_title || item?.option_title)
            : '';
        const bundleOptionUid = isBundleOptionEntry
            ? normalizeCanvasText(item?.bundle_option_uid || item?.uid || item?.option_uid)
            : '';
        const bundleTitle = isBundleOptionEntry
            ? normalizeCanvasText(item?.bundle_title || item?.bundle_config_title)
            : '';
        const bundleDisplayName = isBundleOptionEntry
            ? [bundleParentName, bundleOptionTitle]
                .filter((part, index, source) => (
                    part
                    && source.findIndex((candidate) => normalizeProductSearchText(candidate) === normalizeProductSearchText(part)) === index
                ))
                .join(' - ')
            : '';
        const baseName = normalizeCanvasText(item?.name) || bundleParentName || 'Sản phẩm';
        const displayName = isBundleOptionEntry
            ? (bundleDisplayName || normalizeCanvasText(item?.display_name) || baseName)
            : entryKind === SEARCH_ENTRY_VARIATION
                ? resolveProductSearchVariationDisplayName(parentProductName, baseName, item?.option_label, item?.display_name)
                : (normalizeCanvasText(item?.display_name) || baseName);
        const sku = normalizeCanvasText(item?.sku);
        const displaySku = normalizeCanvasText(item?.display_sku) || sku;
        const optionLabel = normalizeCanvasText(item?.option_label);
        const entryId = normalizeCanvasText(item?.entry_id) || `${entryKind}-${targetProductId}`;
        const bundleOptionPrice = isBundleOptionEntry
            ? resolveBundleOptionEntryPrice(item, item?.bundle_items)
            : (Number(item?.price ?? 0) || 0);

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
            price: bundleOptionPrice,
            expected_cost: parseMoneyNumber(item?.expected_cost),
            cost_price: resolveProductCostPrice(item),
            unit_name: resolveOrderUnitLabel(item),
            ...resolveInventorySnapshot(item),
            ...resolveProductSourceFields(item),
            type: normalizeCanvasText(item?.type),
            main_image: getPickerPrimaryImage(item),
            parent_product_id: Number.isFinite(parentProductId) && parentProductId > 0 ? parentProductId : null,
            parent_product_name: parentProductName,
            option_label: optionLabel,
            ...(isBundleOptionEntry ? {
                bundle_parent_id: bundleParentId,
                bundle_parent_name: bundleParentName || baseName,
                bundle_option_uid: bundleOptionUid,
                bundle_option_key: normalizeCanvasText(item?.bundle_option_key || resolveBundleOptionKey(item)),
                bundle_option_title: bundleOptionTitle,
                raw_bundle_option_title: rawBundleOptionTitle,
                bundle_option_status: normalizeCanvasText(item?.bundle_option_status || 'visible'),
                bundle_option_total_price: bundleOptionPrice,
                bundle_option_discounted_price: bundleOptionPrice,
                bundle_title: bundleTitle,
                bundle_config_title: bundleTitle,
                option_post_id: Number(item?.option_post_id) || undefined,
                option_post_title: normalizeCanvasText(item?.option_post_title),
            } : {}),
            search_keywords: [
                baseName,
                displayName,
                sku,
                displaySku,
                parentProductName,
                optionLabel,
                bundleParentName,
                bundleOptionTitle,
                rawBundleOptionTitle,
                normalizeCanvasText(item?.option_post_title),
                bundleTitle,
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
const buildProductQuickSetupRefreshTargets = (items = []) => {
    const targets = [];
    const seenEntryKeys = new Set();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const entryKey = getProductQuickSetupEntryKey(item);
        const productId = getProductQuickSetupEntryId(item);
        if (!entryKey || productId <= 0 || seenEntryKeys.has(entryKey)) return;

        seenEntryKeys.add(entryKey);
        targets.push({ entryKey, productId, ...buildProductSourcePayload(item) });
    });

    return targets;
};
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

const canvasImageCache = new Map();
const CANVAS_IMAGE_CACHE_LIMIT = 60;
const CANVAS_IMAGE_FETCH_TIMEOUT_MS = 8000;

const loadCanvasImage = async (src) => {
    if (!src) return null;

    const cacheKey = String(src);
    if (canvasImageCache.has(cacheKey)) {
        return canvasImageCache.get(cacheKey);
    }

    const imagePromise = (async () => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), CANVAS_IMAGE_FETCH_TIMEOUT_MS);

        try {
            const normalizedSrc = cacheKey.startsWith('data:')
                ? cacheKey
                : `${String(api.defaults.baseURL || '').replace(/\/+$/, '')}/media/proxy?url=${encodeURIComponent(cacheKey)}`;

            const response = await fetch(normalizedSrc, {
                mode: 'cors',
                credentials: 'omit',
                cache: 'force-cache',
                signal: controller.signal,
            });
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
            canvasImageCache.delete(cacheKey);
            console.error('Failed to load canvas image', src, error);
            return null;
        } finally {
            window.clearTimeout(timeoutId);
        }
    })();

    canvasImageCache.set(cacheKey, imagePromise);

    if (canvasImageCache.size > CANVAS_IMAGE_CACHE_LIMIT) {
        canvasImageCache.delete(canvasImageCache.keys().next().value);
    }

    return imagePromise;
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
    const storeName = quoteSettings.quote_store_name || 'Gốm Đại Thành';
    const selectedTemplateName = getSelectedQuoteTemplateLabel(template, formData.items);
    const customerName = String(formData.customer_name || '').trim();
    const createdDate = new Date().toLocaleDateString('vi-VN');
    const resolvedPricingSummary = pricingSummary || buildOrderPricingSummary(formData);
    const quoteSubtotal = resolvedPricingSummary.subtotal;
    const quoteExtraRows = resolvedPricingSummary.extraRows;

    return (
        <div ref={captureRef} className="w-[1200px] bg-white text-slate-900 shadow-2xl" style={{ fontFamily: 'var(--font-roboto)' }}>
            <div className="border-[2px] border-[#2F1A14]">
                <div className="border-b border-[#2F1A14] bg-[#FCF8F3]">
                    <div className="h-[18px] bg-[#243447]" />
                    <div className="h-1 bg-[#C8A56A]" />
                    <div className="grid min-h-[250px] grid-cols-[210px_minmax(0,1fr)_386px] gap-7 px-8 py-7">
                    <div className="flex items-center justify-center">
                        {hasLogo ? (
                            <img src={quoteSettings.quote_logo_url} alt="Logo" className="max-h-[150px] max-w-full object-contain" />
                        ) : (
                            <div className="w-full h-[150px] border border-dashed border-[#C59A6A] flex items-center justify-center text-[#C59A6A] text-[28px] font-bold tracking-[0.2em]">
                                LOGO
                            </div>
                        )}
                    </div>

                    <div className="min-w-0 py-1 text-left">
                        <div className="text-[42px] font-black uppercase leading-none text-[#243447]">
                            BẢNG BÁO GIÁ
                        </div>
                        <div className="mt-7 text-[28px] font-bold leading-tight text-slate-800">
                            {storeName}
                        </div>
                        <div className="mt-5 whitespace-pre-line break-words text-[20px] leading-[1.35] text-[#7C6A58]">
                            {headerAddress || 'Cấu hình địa chỉ và số điện thoại trong phần Cài đặt web > Báo giá.'}
                        </div>
                    </div>

                    <div className="min-w-0 border border-[#D8C4AF] bg-white p-6">
                        <div className="border border-[#E6D7C9] bg-[#F8F4EE] px-4 py-3 text-center text-[20px] font-bold uppercase leading-tight text-[#243447] break-words">
                            {sheetTitle}
                        </div>
                        <div className="mt-5 text-[20px] font-bold leading-tight text-[#7C6A58]">
                            Mẫu đã chọn
                        </div>
                        <div className="mt-2 break-words text-[20px] font-bold leading-tight text-slate-900">
                            {selectedTemplateName}
                        </div>
                        {customerName && (
                            <div className="mt-4 break-words text-[20px] font-bold leading-tight text-slate-900">
                                Tên khách hàng: {customerName}
                            </div>
                        )}
                        <div className="mt-4 break-words text-[20px] font-semibold leading-tight text-[#7C6A58]">
                            Ngày tạo: {createdDate}
                        </div>
                    </div>
                    </div>
                </div>

                <table className="w-full border-collapse table-fixed">
                    <thead>
                        <tr className="bg-[#6B0F0F] text-white">
                            <th className="w-[168px] border border-[#2F1A14] px-3 py-3 text-[25px] font-bold leading-tight">Ảnh bộ / mẫu</th>
                            <th className="w-[58px] border border-[#2F1A14] px-2 py-3 text-[25px] font-bold leading-tight text-center">STT</th>
                            <th className="border border-[#2F1A14] px-3 py-3 text-left text-[25px] font-bold leading-tight">Tên sản phẩm</th>
                            <th className="w-[84px] border border-[#2F1A14] px-3 py-3 text-[25px] font-bold leading-tight text-center">Số lượng</th>
                            <th className="w-[96px] border border-[#2F1A14] px-3 py-3 text-[25px] font-bold leading-tight text-center">Đơn vị tính</th>
                            <th className="w-[150px] border border-[#2F1A14] px-3 py-3 text-[25px] font-bold leading-tight text-right">Đơn giá</th>
                            <th className="w-[170px] border border-[#2F1A14] px-3 py-3 text-[25px] font-bold leading-tight text-right">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        {formData.items.map((item, index) => (
                            <tr key={`${template?.id || 'template'}-${item.line_id || item.product_id}-${index}`} className="align-middle">
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
                                <td className="border border-[#D5CEC9] px-2 py-3 text-[12px] text-center font-semibold text-slate-700">{index + 1}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 align-middle text-[12px] leading-6">
                                    <div className="font-semibold text-slate-900">{item.name}</div>
                                </td>
                                <td className="border border-[#D5CEC9] px-2 py-3 text-[12px] text-center font-semibold">{item.quantity}</td>
                                <td className="border border-[#D5CEC9] px-2 py-3 text-[12px] text-center font-semibold text-slate-700">{getOrderUnitDisplay(item)}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] text-right">{formatQuoteMoney(item.price)}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] text-right font-semibold">{formatQuoteMoney(item.price * item.quantity)}</td>
                            </tr>
                        ))}
                        <tr className="bg-[#F5E7BF]">
                            <td className="border border-[#2F1A14] px-5 py-4 text-[22px] font-bold uppercase leading-tight" colSpan={3}>Tổng món</td>
                            <td className="border border-[#2F1A14] px-5 py-4 text-[22px] font-bold leading-tight text-center">{totalQuantity}</td>
                            <td className="border border-[#2F1A14] px-5 py-4 text-[22px] font-bold leading-tight text-right" colSpan={2}>Tổng tiền</td>
                            <td className="border border-[#2F1A14] px-5 py-4 text-[22px] font-bold leading-tight text-right">{formatQuoteMoney(quoteSubtotal)}</td>
                        </tr>
                        {quoteExtraRows.map((row) => (
                            <tr key={row.key} className={row.isEmphasis ? 'bg-[#F5E7BF]' : 'bg-[#FCF8F3]'}>
                                <td className="border border-[#2F1A14] px-5 py-4" colSpan={4}>&nbsp;</td>
                                <td className="border border-[#2F1A14] px-5 py-4 text-[22px] font-bold leading-tight text-right" colSpan={2}>{row.label}</td>
                                <td className={`border border-[#2F1A14] px-5 py-4 text-[22px] font-bold leading-tight text-right ${row.isDeduction ? 'text-[#8E0B0B]' : 'text-slate-900'}`}>
                                    {row.prefix ?? (row.isDeduction ? '-' : '')}{formatQuoteMoney(row.value)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const failedProductImageUrls = new Set();

const ProductThumb = ({ src, fallback = null, imageClassName = 'size-full object-cover' }) => {
    const normalizedSrc = String(src || '').trim();
    const [failed, setFailed] = useState(() => (
        normalizedSrc !== '' && failedProductImageUrls.has(normalizedSrc)
    ));

    useEffect(() => {
        setFailed(normalizedSrc !== '' && failedProductImageUrls.has(normalizedSrc));
    }, [normalizedSrc]);

    if (!normalizedSrc || failed) {
        return fallback || <span className="material-symbols-outlined text-sm">image</span>;
    }

    return (
        <img
            src={normalizedSrc}
            alt=""
            className={imageClassName}
            loading="lazy"
            decoding="async"
            onError={() => {
                failedProductImageUrls.add(normalizedSrc);
                setFailed(true);
            }}
        />
    );
};

const ProductSearchOption = ({ product, onSelect, quickFilterAttribute = null, isAlreadyInOrder = false, activeAccountId = null }) => {
    const nameRef = useRef(null);
    const [hasTruncation, setHasTruncation] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const displayName = product?.display_name || product?.name || '---';
    const productSourceAccountId = getProductSourceAccountId(product);
    const productSourceName = getProductSourceDisplayName(product);
    const shouldShowSourceBadge = Boolean(
        productSourceName
        && productSourceAccountId
        && normalizeAccountId(activeAccountId)
        && productSourceAccountId !== normalizeAccountId(activeAccountId)
    );
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
                <ProductThumb src={product.main_image} />
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
                    {shouldShowSourceBadge && (
                        <div className="mt-1">
                            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                <span className="material-symbols-outlined text-[11px]">storefront</span>
                                <span>{`\u004e\u0067\u0075\u1ed3\u006e: ${productSourceName}`}</span>
                            </span>
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

const OrderPriceMultiplierModal = ({
    show,
    selectedItems = [],
    onClose,
    onApply,
    currencyFormatter = formatQuoteMoney,
}) => {
    const [saleMultiplierInput, setSaleMultiplierInput] = useState('3');
    const [costMultiplierInput, setCostMultiplierInput] = useState('3');

    const saleMultiplier = parseOrderPriceMultiplier(saleMultiplierInput);
    const costMultiplier = parseOrderPriceMultiplier(costMultiplierInput);
    const isValid = saleMultiplier !== null && costMultiplier !== null && selectedItems.length > 0;
    const previewItems = selectedItems.slice(0, 5).map((item) => {
        const currentSalePrice = parseMoneyNumber(item?.price, 0) || 0;
        const currentCostPrice = parseMoneyNumber(item?.cost_price, 0) || 0;

        return {
            lineId: item?.line_id || `${item?.product_id || 'item'}-${item?.sku || ''}`,
            name: item?.name || 'Sản phẩm',
            currentSalePrice,
            nextSalePrice: saleMultiplier === null ? currentSalePrice : Math.round(currentSalePrice * saleMultiplier),
            currentCostPrice,
            nextCostPrice: costMultiplier === null
                ? currentCostPrice
                : resolveRoundedImportCostValue(currentCostPrice * costMultiplier, 0),
        };
    });

    const handleSubmit = (event) => {
        event.preventDefault();
        if (!isValid) return;

        onApply({
            saleMultiplier,
            costMultiplier,
        });
    };

    const applyPreset = (value) => {
        const nextValue = String(value);
        setSaleMultiplierInput(nextValue);
        setCostMultiplierInput(nextValue);
    };

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.form
                initial={{ opacity: 0, scale: 0.96, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 18 }}
                onSubmit={handleSubmit}
                className="relative w-full max-w-3xl overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.22)]"
            >
                <div className="flex items-start justify-between gap-4 border-b border-primary/10 bg-primary/[0.02] px-6 py-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-3">
                            <div className="inline-flex size-10 items-center justify-center rounded-sm bg-emerald-50 text-emerald-700">
                                <span className="material-symbols-outlined text-[20px]">percent</span>
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">Nhân hệ số giá</h3>
                                <p className="mt-1 text-[12px] font-semibold text-primary/45">
                                    Đang chọn {selectedItems.length} dòng trong đơn hiện tại.
                                </p>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex size-9 items-center justify-center rounded-sm border border-primary/10 text-primary/35 transition-all hover:border-brick/20 hover:text-brick"
                        aria-label="Đóng"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <div className="space-y-5 px-6 py-5">
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Hệ số giá bán</span>
                            <div className="flex h-12 items-center rounded-sm border border-primary/10 bg-primary/[0.03] px-3 focus-within:border-primary/30 focus-within:bg-white">
                                <span className="material-symbols-outlined mr-2 text-[18px] text-emerald-700/70">sell</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={saleMultiplierInput}
                                    onChange={(event) => setSaleMultiplierInput(normalizeOrderPriceMultiplierDraft(event.target.value))}
                                    className="h-full w-full bg-transparent text-[18px] font-black text-primary focus:outline-none"
                                    placeholder="3"
                                    autoFocus
                                />
                                <span className="text-[12px] font-black uppercase tracking-[0.1em] text-primary/30">
                                    {formatOrderPriceMultiplier(saleMultiplierInput)}
                                </span>
                            </div>
                        </label>

                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Hệ số giá nhập</span>
                            <div className="flex h-12 items-center rounded-sm border border-primary/10 bg-primary/[0.03] px-3 focus-within:border-primary/30 focus-within:bg-white">
                                <span className="material-symbols-outlined mr-2 text-[18px] text-sky-700/70">inventory_2</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={costMultiplierInput}
                                    onChange={(event) => setCostMultiplierInput(normalizeOrderPriceMultiplierDraft(event.target.value))}
                                    className="h-full w-full bg-transparent text-[18px] font-black text-primary focus:outline-none"
                                    placeholder="3"
                                />
                                <span className="text-[12px] font-black uppercase tracking-[0.1em] text-primary/30">
                                    {formatOrderPriceMultiplier(costMultiplierInput)}
                                </span>
                            </div>
                        </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {[2, 2.5, 3, 4].map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                onClick={() => applyPreset(preset)}
                                className="inline-flex h-8 items-center rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black text-primary/60 transition-all hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                            >
                                x{preset}
                            </button>
                        ))}
                    </div>

                    <div className="overflow-hidden rounded-sm border border-primary/10">
                        <div className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr] border-b border-primary/10 bg-primary/[0.04] px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-primary/45">
                            <div>Sản phẩm</div>
                            <div className="text-right">Giá bán</div>
                            <div className="text-right">Giá nhập</div>
                        </div>
                        <div className="max-h-[260px] overflow-y-auto">
                            {previewItems.map((item) => (
                                <div key={item.lineId} className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr] gap-3 border-b border-primary/5 px-4 py-3 last:border-b-0">
                                    <div className="min-w-0 text-[12px] font-bold leading-[1.45] text-primary">
                                        <div className="truncate">{item.name}</div>
                                    </div>
                                    <div className="text-right text-[12px] font-bold text-primary/70">
                                        <div>{currencyFormatter(item.currentSalePrice)}</div>
                                        <div className="mt-1 text-emerald-700">{currencyFormatter(item.nextSalePrice)}</div>
                                    </div>
                                    <div className="text-right text-[12px] font-bold text-primary/45">
                                        <div>{currencyFormatter(item.currentCostPrice)}</div>
                                        <div className="mt-1 text-sky-700">{currencyFormatter(item.nextCostPrice)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {selectedItems.length > previewItems.length ? (
                            <div className="border-t border-primary/10 bg-primary/[0.02] px-4 py-2 text-[11px] font-semibold text-primary/40">
                                Còn {selectedItems.length - previewItems.length} dòng khác sẽ áp dụng cùng hệ số.
                            </div>
                        ) : null}
                    </div>

                    {(!saleMultiplier || !costMultiplier) ? (
                        <div className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
                            Nhập hệ số lớn hơn 0 cho cả giá bán và giá nhập.
                        </div>
                    ) : null}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-primary/10 bg-primary/[0.02] px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-10 items-center justify-center rounded-sm border border-primary/10 bg-white px-4 text-[13px] font-bold text-primary/55 transition-all hover:border-primary/25 hover:text-primary"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[13px] font-bold text-white shadow-sm transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[16px]">check</span>
                        Áp dụng hệ số
                    </button>
                </div>
            </motion.form>
        </div>
    );
};

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
    preserveCurrentLinePrice = false,
    showWarehousePickingTab = false,
    activeTab = ACTUAL_PRODUCT_PICKER_TAB_MANUAL,
    onActiveTabChange,
    activeLineNumber = '',
}) => {
    const isAiLine = isOrderAiItem(currentLine);
    const isWarehousePickingTab = showWarehousePickingTab && activeTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE;
    const currentSourceLabel = currentLabel || currentLine?.ai_meta?.source_phrase || currentLine?.name || '';
    const currentVariantLabel = currentLine?.options?.variant_label || '';
    const currentSku = currentLine?.sku || '';
    const currentLineFinancial = preserveCurrentLinePrice
        ? resolveActualReplacementFinancialPreview(currentLine, currentLine)
        : null;
    const formatPanelMoney = (value) => {
        const numericValue = Number(value) || 0;
        if (currencyFormatter && typeof currencyFormatter.format === 'function') {
            return `${currencyFormatter.format(numericValue)}đ`;
        }

        if (typeof currencyFormatter === 'function') {
            return currencyFormatter(numericValue);
        }

        return `${quoteCurrencyFormatter.format(numericValue)}đ`;
    };
    const panelHeading = heading || (isAiLine ? 'Đổi sản phẩm AI' : 'Đổi sản phẩm');
    const hasSearchTerm = searchTerm.trim().length >= (isWarehousePickingTab ? 1 : 2);
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
            const preferredPanelWidth = showWarehousePickingTab ? 560 : 460;
            const panelWidth = Math.min(preferredPanelWidth, Math.max(340, viewportWidth - 24));
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
    }, [anchorElement, show, showWarehousePickingTab]);

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
                    {showWarehousePickingTab && (
                        <div className="mt-3 grid grid-cols-2 gap-1 rounded-sm border border-primary/10 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => onActiveTabChange?.(ACTUAL_PRODUCT_PICKER_TAB_MANUAL)}
                                className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-2 text-[11px] font-black uppercase tracking-[0.1em] transition-all ${activeTab === ACTUAL_PRODUCT_PICKER_TAB_MANUAL ? 'bg-primary text-white shadow-sm' : 'text-primary/45 hover:bg-primary/[0.04] hover:text-primary'}`}
                            >
                                <span className="material-symbols-outlined text-[15px]">search</span>
                                Tìm sản phẩm
                            </button>
                            <button
                                type="button"
                                onClick={() => onActiveTabChange?.(ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE)}
                                className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-2 text-[11px] font-black uppercase tracking-[0.1em] transition-all ${activeTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE ? 'bg-emerald-600 text-white shadow-sm' : 'text-primary/45 hover:bg-emerald-50 hover:text-emerald-700'}`}
                            >
                                <span className="material-symbols-outlined text-[15px]">inventory_2</span>
                                Đổi khi nhặt hàng
                            </button>
                        </div>
                    )}
                    <div className="mt-2 flex min-h-10 flex-wrap items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 py-2 text-[11px] font-semibold text-primary/65">
                        <span className="material-symbols-outlined shrink-0 text-[16px] text-sky-700/75">quick_reference</span>
                        {activeLineNumber && (
                            <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-800">
                                STT {activeLineNumber}
                            </span>
                        )}
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
                        {currentLineFinancial && (
                            <>
                                <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-800">
                                    Giá chốt {formatPanelMoney(currentLineFinancial.lockedPrice)}
                                </span>
                                <span className="shrink-0 rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5 text-[10px] font-black text-primary/55">
                                    SL {formatOrderFormQuantity(currentLineFinancial.quantity)}
                                </span>
                            </>
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
                            placeholder={isWarehousePickingTab ? 'Nhập STT dòng đơn, mã hoặc tên sản phẩm...' : (searchPlaceholder || 'Tìm sản phẩm để đổi nhanh...')}
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
                        results.map((entry, index) => {
                            const financialPreview = preserveCurrentLinePrice
                                ? resolveActualReplacementFinancialPreview(entry, currentLine)
                                : null;
                            const profitClass = financialPreview?.profitTotal < 0
                                ? 'text-brick'
                                : financialPreview?.profitTotal === 0
                                    ? 'text-amber-600'
                                    : 'text-emerald-700';
                            const stockValue = parseQuantityNumber(entry?.available_to_sell, parseQuantityNumber(entry?.stock_quantity));
                            const hasStockValue = stockValue !== null;
                            const rowLineNumber = entry?.source_line_number || activeLineNumber;

                            return (
                                <button
                                    key={`${entry?.target_product_id || entry?.sku || 'order-ai-replace'}-${index}`}
                                    type="button"
                                    onClick={() => onSelect(entry)}
                                    className="flex w-full items-start justify-between gap-3 border-b border-primary/5 px-4 py-3 text-left transition-all hover:bg-primary/[0.03] last:border-b-0"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[13px] font-bold leading-snug text-primary">
                                            {entry?.display_name || entry?.name || 'Sản phẩm'}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-primary/45">
                                            {isWarehousePickingTab && rowLineNumber && (
                                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-black text-sky-800">
                                                    STT {rowLineNumber}
                                                </span>
                                            )}
                                            {entry?.display_sku && (
                                                <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">
                                                    {entry.display_sku}
                                                </span>
                                            )}
                                            {entry?.is_original_order_product && (
                                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-black text-sky-800">
                                                    Mặc định trong bộ
                                                </span>
                                            )}
                                            {entry?.option_label && (
                                                <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5">
                                                    {entry.option_label}
                                                </span>
                                            )}
                                            {entry?.is_declared_replacement && !entry?.is_original_order_product && (
                                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-black text-emerald-700">
                                                    Mã thay thế
                                                </span>
                                            )}
                                            {hasStockValue && (
                                                <span className={`rounded-full border border-primary/10 bg-white px-2 py-0.5 font-black ${getAvailableToSellTextClass(stockValue)}`}>
                                                    Còn {formatOrderFormQuantity(stockValue)}
                                                </span>
                                            )}
                                        </div>
                                        {financialPreview && (
                                            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] font-bold text-primary/45">
                                                <span className="rounded-sm border border-primary/10 bg-white px-2 py-1">
                                                    Niêm yết <b className="text-primary/70">{formatPanelMoney(financialPreview.listPrice)}</b>
                                                </span>
                                                <span className="rounded-sm border border-sky-200 bg-sky-50 px-2 py-1 text-sky-800">
                                                    Giữ đơn <b>{formatPanelMoney(financialPreview.lockedPrice)}</b>
                                                </span>
                                                <span className="rounded-sm border border-primary/10 bg-white px-2 py-1">
                                                    Giá vốn <b className="text-primary/70">{formatPanelMoney(financialPreview.costPrice)}</b>
                                                </span>
                                                <span className="rounded-sm border border-primary/10 bg-white px-2 py-1">
                                                    Lãi <b className={profitClass}>{formatPanelMoney(financialPreview.profitTotal)}</b>
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="shrink-0 text-right text-[12px] font-black text-primary/65">
                                        {financialPreview ? (
                                            <>
                                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-sky-700/60">Giữ</div>
                                                <div className="text-[13px] text-sky-800">{formatPanelMoney(financialPreview.lockedPrice)}</div>
                                                {financialPreview.listPrice !== financialPreview.lockedPrice && (
                                                    <div className="mt-0.5 text-[10px] font-semibold text-primary/35">
                                                        SP {formatPanelMoney(financialPreview.listPrice)}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            formatPanelMoney(entry?.price ?? 0)
                                        )}
                                    </div>
                                </button>
                            );
                        })
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
    const [activeAccountId] = useState(() => getOrderFormActiveAccountId());
    const [productSourceAccounts, setProductSourceAccounts] = useState(() => getCachedOrderFormAccounts());
    const [enabledCrossSellAccountIds, setEnabledCrossSellAccountIds] = useState([]);
    const [showCrossSellSourceDropdown, setShowCrossSellSourceDropdown] = useState(false);
    const [attributes, setAttributes] = useState([]);
    const [orderStatuses, setOrderStatuses] = useState([]);
    const [profitCenters, setProfitCenters] = useState([]);

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
    const [orderAiReplaceActiveTab, setOrderAiReplaceActiveTab] = useState(ACTUAL_PRODUCT_PICKER_TAB_MANUAL);
    const [orderAiReplaceWarehouseSearchTerm, setOrderAiReplaceWarehouseSearchTerm] = useState('');
    const [orderAiReplaceWarehouseResults, setOrderAiReplaceWarehouseResults] = useState([]);
    const [orderAiReplaceWarehouseLoading, setOrderAiReplaceWarehouseLoading] = useState(false);
    const [actualProductPickerLineId, setActualProductPickerLineId] = useState('');
    const [actualProductPickerSearchTerm, setActualProductPickerSearchTerm] = useState('');
    const [actualProductPickerResults, setActualProductPickerResults] = useState([]);
    const [actualProductPickerLoading, setActualProductPickerLoading] = useState(false);
    const [actualProductPickerActiveTab, setActualProductPickerActiveTab] = useState(ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE);
    const [showReplacementDeclarationModal, setShowReplacementDeclarationModal] = useState(false);
    const [replacementDeclarationSource, setReplacementDeclarationSource] = useState(null);
    const [replacementDeclarationGroupId, setReplacementDeclarationGroupId] = useState(null);
    const [replacementDeclarationSourceSearchTerm, setReplacementDeclarationSourceSearchTerm] = useState('');
    const [replacementDeclarationSourceResults, setReplacementDeclarationSourceResults] = useState([]);
    const [replacementDeclarationSourceLoading, setReplacementDeclarationSourceLoading] = useState(false);
    const [replacementDeclarationSearchTerm, setReplacementDeclarationSearchTerm] = useState('');
    const [replacementDeclarationResults, setReplacementDeclarationResults] = useState([]);
    const [replacementDeclarationSearchLoading, setReplacementDeclarationSearchLoading] = useState(false);
    const [replacementDeclarationSelected, setReplacementDeclarationSelected] = useState([]);
    const [replacementDeclarationLookupLoading, setReplacementDeclarationLookupLoading] = useState(false);
    const [replacementDeclarationGroups, setReplacementDeclarationGroups] = useState([]);
    const [replacementDeclarationGroupsSearchTerm, setReplacementDeclarationGroupsSearchTerm] = useState('');
    const [replacementDeclarationGroupsLoading, setReplacementDeclarationGroupsLoading] = useState(false);
    const [replacementDeclarationGroupsReloadKey, setReplacementDeclarationGroupsReloadKey] = useState(0);
    const [replacementDeclarationSaving, setReplacementDeclarationSaving] = useState(false);
    const [selectedOrderLineId, setSelectedOrderLineId] = useState('');
    const [showActualProductSection, setShowActualProductSection] = useState(false);
    const [productQuickFilterAttributes, setProductQuickFilterAttributes] = useState([]);
    const [productQuickFilterAttributeId, setProductQuickFilterAttributeId] = useState(() => initialProductQuickFilterState.attributeId);
    const [productQuickFilterValues, setProductQuickFilterValues] = useState(() => initialProductQuickFilterState.values);
    const [productQuickFilterAttributeId2, setProductQuickFilterAttributeId2] = useState(() => initialProductQuickFilterState.attributeId2);
    const [productQuickFilterValues2, setProductQuickFilterValues2] = useState(() => initialProductQuickFilterState.values2);
    const [productQuickSetupStore, setProductQuickSetupStore] = useState(() => getStoredProductQuickSetupStore());
    const [productQuickModeEnabled, setProductQuickModeEnabled] = useState(() => initialProductQuickFilterState.quickModeEnabled);
    const [productQuickModeDefaultEnabled, setProductQuickModeDefaultEnabled] = useState(true);
    const [showProductQuickSetupPanel, setShowProductQuickSetupPanel] = useState(false);
    const [productQuickSetupMode, setProductQuickSetupMode] = useState(PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE);
    const [manualProductQuickModeEnabled, setManualProductQuickModeEnabled] = useState(false);
    const [productQuickSetupSearchTerm, setProductQuickSetupSearchTerm] = useState('');
    const [debouncedProductQuickSetupSearchTerm, setDebouncedProductQuickSetupSearchTerm] = useState('');
    const [productQuickSetupProducts, setProductQuickSetupProducts] = useState([]);
    const [productQuickSetupLoading, setProductQuickSetupLoading] = useState(false);
    const [productQuickSetupLatestEntries, setProductQuickSetupLatestEntries] = useState([]);
    const [productQuickSetupLatestEntriesScopeKey, setProductQuickSetupLatestEntriesScopeKey] = useState('');
    const [productQuickFilterScopeProducts, setProductQuickFilterScopeProducts] = useState([]);
    const [productQuickFilterScopeKey, setProductQuickFilterScopeKey] = useState('');
    const [showProductQuickFilterPanel, setShowProductQuickFilterPanel] = useState(false);
    const [selectedLineItemIds, setSelectedLineItemIds] = useState(new Set());
    const [deletedLineItemBatches, setDeletedLineItemBatches] = useState([]);
    const [showBulkReplaceModal, setShowBulkReplaceModal] = useState(false);
    const [showPriceMultiplierModal, setShowPriceMultiplierModal] = useState(false);
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
    const [sourceQuoteTemplates, setSourceQuoteTemplates] = useState([]);
    const [sourceQuoteTemplatesLoading, setSourceQuoteTemplatesLoading] = useState(false);
    const [showSupplementItemsModal, setShowSupplementItemsModal] = useState(false);
    const [showQuoteTemplatePicker, setShowQuoteTemplatePicker] = useState(false);
    const [quoteTemplateSearch, setQuoteTemplateSearch] = useState('');
    const [quoteCaptureTemplate, setQuoteCaptureTemplate] = useState(null);
    const [leadConversionSummary, setLeadConversionSummary] = useState(null);
    const [notification, setNotification] = useState(null);
    const [copiedText, setCopiedText] = useState(null);
    const [activeTruncatedNameCellKey, setActiveTruncatedNameCellKey] = useState('');
    const [editingOrderLineName, setEditingOrderLineName] = useState({ lineId: '', value: '' });
    const captureRef = useRef(null);
    const quoteCaptureRef = useRef(null);
    const orderFormTableViewportRef = useRef(null);
    const lastAutoOpenedSupplementOrderTypeRef = useRef('');
    const lastVisitedProductQuickSetupKeyRef = useRef('');
    const copyFeedbackTimeoutRef = useRef(null);
    const copyNotificationTimeoutRef = useRef(null);
    const productSearchContainerRef = useRef(null);
    const productSearchInputRef = useRef(null);
    const crossSellSourceDropdownRef = useRef(null);
    const manualQuickSetupDropdownRef = useRef(null);
    const mobileProductSearchToggleButtonRef = useRef(null);
    const mobileProductSearchHistoryStateActiveRef = useRef(false);
    const ignoreNextMobileProductSearchPopRef = useRef(false);
    const previousShowSearchDropdownRef = useRef(false);
    const productSearchAbortRef = useRef(null);
    const productSearchRequestKeyRef = useRef('');
    const productSearchCacheRef = useRef(new Map());
    const productQuickFilterStorageKeyRef = useRef(productQuickFilterStorageKey);
    const skipNextProductQuickFilterPersistRef = useRef(false);
    const lastProductQuickFilterDurableSignatureRef = useRef(
        buildProductQuickFilterDurableSignature(productQuickFilterStorageKey, initialProductQuickFilterState)
    );
    const productQuickFilterScopeAbortRef = useRef(null);
    const productQuickFilterScopeCacheRef = useRef(new Map());
    const productQuickSetupAbortRef = useRef(null);
    const productQuickSetupCacheRef = useRef(new Map());
    const productQuickSetupRefreshAbortRef = useRef(null);
    const productQuickSetupListRef = useRef(null);
    const productQuickSetupSearchInputRef = useRef(null);
    const pendingProductQuickSetupViewportRef = useRef(null);
    const orderAiFileInputRef = useRef(null);
    const orderAiLastInputPreviewUrlRef = useRef('');
    const orderAiReplaceAnchorRef = useRef(null);
    const actualProductPickerAnchorRef = useRef(null);
    const replacementDeclarationSourceAbortRef = useRef(null);
    const replacementDeclarationSearchAbortRef = useRef(null);
    const replacementDeclarationLookupAbortRef = useRef(null);
    const replacementDeclarationGroupsAbortRef = useRef(null);
    const actualProductSectionRef = useRef(null);
    const orderItemNameRefs = useRef(new Map());
    const profitCenterManualOverrideRef = useRef(false);
    const lineItemSelectionAnchorRef = useRef('');
    const lineItemSelectionDragRef = useRef(null);
    useEffect(() => {
        setDeletedLineItemBatches([]);
    }, [duplicateFromId, id, leadId]);
    const orderAiQuickRuleOptions = useMemo(
        () => buildOrderAiQuickRuleOptions(orderAiTrainingRules.length > 0 ? orderAiTrainingRules : orderAiRules),
        [orderAiRules, orderAiTrainingRules]
    );
    const selectedOrderAiQuickRule = useMemo(
        () => orderAiQuickRuleOptions.find((option) => option.value === orderAiSelectedRuleKey) || null,
        [orderAiQuickRuleOptions, orderAiSelectedRuleKey]
    );

    const productQuickSetupNamespace = resolveProductQuickSetupNamespace(user);
    const crossSellSourceAccounts = useMemo(() => {
        const currentAccountId = normalizeAccountId(activeAccountId);

        return productSourceAccounts.filter((account) => {
            const accountId = normalizeAccountId(account?.id);
            if (!accountId) return false;
            return !currentAccountId || accountId !== currentAccountId;
        });
    }, [activeAccountId, productSourceAccounts]);
    const enabledCrossSellSourceParam = useMemo(() => (
        enabledCrossSellAccountIds
            .map(normalizeAccountId)
            .filter(Boolean)
            .join(',')
    ), [enabledCrossSellAccountIds]);
    const enabledCrossSellAccountIdSet = useMemo(() => new Set(
        enabledCrossSellAccountIds.map(normalizeAccountId).filter(Boolean)
    ), [enabledCrossSellAccountIds]);
    const hasEnabledCrossSellSources = enabledCrossSellAccountIdSet.size > 0;
    const selectedCrossSellSourceAccounts = useMemo(() => (
        crossSellSourceAccounts.filter((account) => enabledCrossSellAccountIdSet.has(normalizeAccountId(account?.id)))
    ), [crossSellSourceAccounts, enabledCrossSellAccountIdSet]);
    const activeProductSourceAccount = useMemo(() => (
        productSourceAccounts.find((account) => normalizeAccountId(account?.id) === normalizeAccountId(activeAccountId)) || null
    ), [activeAccountId, productSourceAccounts]);
    const quoteTemplateSourceAccountIds = useMemo(() => {
        const sourceAccountIds = [];

        selectedCrossSellSourceAccounts
            .filter(isDongDaiThanhAccount)
            .forEach((account) => {
                const accountId = normalizeAccountId(account?.id);
                if (accountId) {
                    sourceAccountIds.push(accountId);
                }
            });

        if (activeProductSourceAccount && isDongDaiThanhAccount(activeProductSourceAccount)) {
            productSourceAccounts
                .filter(isGomDaiThanhAccount)
                .forEach((account) => {
                    const accountId = normalizeAccountId(account?.id);
                    if (accountId && accountId !== normalizeAccountId(activeAccountId)) {
                        sourceAccountIds.push(accountId);
                    }
                });
        }

        return Array.from(new Set(sourceAccountIds));
    }, [activeAccountId, activeProductSourceAccount, productSourceAccounts, selectedCrossSellSourceAccounts]);
    const quoteTemplateSourceAccountKey = useMemo(
        () => quoteTemplateSourceAccountIds.join(','),
        [quoteTemplateSourceAccountIds]
    );
    const visibleProductSourceAccountIds = useMemo(() => new Set([
        normalizeAccountId(activeAccountId),
        ...enabledCrossSellAccountIds.map(normalizeAccountId),
    ].filter(Boolean)), [activeAccountId, enabledCrossSellAccountIds]);
    const isProductSearchEntrySourceEnabled = useCallback((entry) => {
        const sourceAccountId = getProductSourceAccountId(entry);
        return !sourceAccountId || visibleProductSourceAccountIds.size === 0 || visibleProductSourceAccountIds.has(sourceAccountId);
    }, [visibleProductSourceAccountIds]);
    const appendCrossSellSourceParams = useCallback((params = {}) => {
        if (enabledCrossSellSourceParam) {
            params.source_account_ids = enabledCrossSellSourceParam;
        }

        return params;
    }, [enabledCrossSellSourceParam]);
    const buildSourceAwareOrderAiPickerEntries = useCallback((rows = []) => (
        buildProductSearchEntries(rows, { includeNested: true })
            .filter((entry) => canAddSearchEntry([], entry))
    ), []);
    const toggleCrossSellAccount = useCallback((accountId) => {
        const normalizedAccountId = normalizeAccountId(accountId);
        if (!normalizedAccountId) return;

        setEnabledCrossSellAccountIds((prev) => {
            const currentIds = prev.map(normalizeAccountId).filter(Boolean);
            return currentIds.includes(normalizedAccountId)
                ? currentIds.filter((id) => id !== normalizedAccountId)
                : [...currentIds, normalizedAccountId];
        });
        productSearchCacheRef.current.clear();
        productQuickFilterScopeCacheRef.current.clear();
        productQuickSetupCacheRef.current.clear();
        setProducts([]);
        setProductQuickFilterScopeKey('');
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);
    const toggleCrossSellSourceDropdown = useCallback((event) => {
        event?.stopPropagation?.();
        setShowCrossSellSourceDropdown((prev) => !prev);
        if (productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL) {
            setShowProductQuickSetupPanel(false);
        }
    }, [productQuickSetupMode]);

    useEffect(() => {
        if (!showCrossSellSourceDropdown) return undefined;

        const handlePointerDownOutsideSourceDropdown = (event) => {
            const container = crossSellSourceDropdownRef.current;
            const target = event.target;

            if (!container || !target || container.contains(target)) {
                return;
            }

            setShowCrossSellSourceDropdown(false);
        };

        document.addEventListener('pointerdown', handlePointerDownOutsideSourceDropdown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDownOutsideSourceDropdown, true);
        };
    }, [showCrossSellSourceDropdown]);

    const flushProductQuickSettingsNow = useCallback(() => {
        flushUserSettingsSync().catch((error) => {
            console.error('Unable to flush product quick filter settings', error);
        });
    }, []);

    useEffect(() => {
        if (!showProductQuickSetupPanel || productQuickSetupMode !== PRODUCT_QUICK_SETUP_MODE_MANUAL) return undefined;

        const handlePointerDownOutsideManualQuickSetup = (event) => {
            const container = manualQuickSetupDropdownRef.current;
            const target = event.target;

            if (!container || !target || container.contains(target)) {
                return;
            }

            setShowProductQuickSetupPanel(false);
            flushProductQuickSettingsNow();
        };

        document.addEventListener('pointerdown', handlePointerDownOutsideManualQuickSetup, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDownOutsideManualQuickSetup, true);
        };
    }, [flushProductQuickSettingsNow, productQuickSetupMode, showProductQuickSetupPanel]);

    useEffect(() => {
        let isDisposed = false;

        const cachedAccounts = getCachedOrderFormAccounts();
        if (cachedAccounts.length > 0) {
            setProductSourceAccounts(cachedAccounts);
        }

        accountApi.getAll()
            .then((response) => {
                if (isDisposed) return;
                const nextAccounts = normalizeAccountRows(response.data || []);
                setProductSourceAccounts(nextAccounts);

                if (typeof window !== 'undefined') {
                    try {
                        window.sessionStorage.setItem('accounts_list', JSON.stringify(response.data || []));
                    } catch (error) {
                        console.error('Unable to cache accounts for cross sell search', error);
                    }
                }
            })
            .catch((error) => {
                if (!isDisposed) {
                    console.error('Unable to load accounts for cross sell search', error);
                }
            });

        return () => {
            isDisposed = true;
        };
    }, []);

    useEffect(() => {
        let isDisposed = false;

        const loadProductQuickModeDefault = async () => {
            try {
                const response = await cmsApi.settings.get();
                const settings = response.data && typeof response.data === 'object' ? response.data : {};
                const hasBackendDefault = Object.prototype.hasOwnProperty.call(
                    settings,
                    orderProductQuickModeDefaultSettingKey
                );
                const nextDefaultEnabled = normalizeStoredQuickFilterBoolean(
                    settings?.[orderProductQuickModeDefaultSettingKey],
                    true
                );

                if (isDisposed) return;

                setProductQuickModeDefaultEnabled(nextDefaultEnabled);
                if (!hasStoredProductQuickModePreference(user)) {
                    setProductQuickModeEnabled(nextDefaultEnabled);
                }

                if (!hasBackendDefault) {
                    const activeAccountId = getActiveAccountIdForSiteSettings();
                    if (activeAccountId) {
                        cmsApi.settings.update({
                            account_id: activeAccountId,
                            settings: {
                                [orderProductQuickModeDefaultSettingKey]: true,
                            },
                        }).catch((error) => {
                            console.error('Unable to seed order product quick mode default setting', error);
                        });
                    }
                }
            } catch (error) {
                if (isDisposed) return;

                console.error('Unable to load order product quick mode default setting', error);
                setProductQuickModeDefaultEnabled(true);
                if (!hasStoredProductQuickModePreference(user)) {
                    setProductQuickModeEnabled(true);
                }
            }
        };

        loadProductQuickModeDefault();

        return () => {
            isDisposed = true;
        };
    }, [productQuickFilterStorageKey, user]);

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
    const activeProductQuickFilterRankCriteria = useMemo(() => ([
        {
            attribute: activeProductQuickFilterAttribute,
            value: normalizedProductQuickFilterValues[0],
        },
        {
            attribute: activeProductQuickFilterAttribute2,
            value: normalizedProductQuickFilterValues2[0],
        },
    ].filter((criterion) => criterion.attribute && criterion.value)), [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
    ]);
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
    const activeProductQuickSetupLookup = useMemo(() => {
        const namespaceStore = productQuickSetupStore?.[productQuickSetupNamespace];
        if (
            activeProductQuickSetupKey
            && namespaceStore
            && typeof namespaceStore === 'object'
            && !Array.isArray(namespaceStore)
            && Object.prototype.hasOwnProperty.call(namespaceStore, activeProductQuickSetupKey)
            && Array.isArray(namespaceStore[activeProductQuickSetupKey])
        ) {
            return {
                items: namespaceStore[activeProductQuickSetupKey],
                sourceNamespace: productQuickSetupNamespace,
            };
        }

        return findProductQuickSetupItems(
            productQuickSetupStore,
            productQuickSetupNamespace,
            activeProductQuickSetupKey
        );
    }, [activeProductQuickSetupKey, productQuickSetupNamespace, productQuickSetupStore]);
    const activeProductQuickSetupItems = useMemo(() => {
        if (!activeProductQuickSetupKey) return [];

        return normalizeStoredProductQuickSetupItems(
            activeProductQuickSetupLookup.items
        );
    }, [activeProductQuickSetupKey, activeProductQuickSetupLookup]);
    const manualProductQuickSetupLabel = useMemo(() => (
        normalizeCanvasText(searchTerm) || 'DS chung'
    ), [searchTerm]);
    const manualProductQuickSetupKey = useMemo(() => {
        const normalizedSearchKey = normalizeProductSearchText(searchTerm);

        return normalizedSearchKey
            ? `manual::search::${normalizedSearchKey}`
            : PRODUCT_MANUAL_QUICK_SETUP_FALLBACK_KEY;
    }, [searchTerm]);
    const manualProductQuickSetupLookup = useMemo(() => {
        const namespaceStore = productQuickSetupStore?.[productQuickSetupNamespace];
        if (
            manualProductQuickSetupKey
            && namespaceStore
            && typeof namespaceStore === 'object'
            && !Array.isArray(namespaceStore)
            && Object.prototype.hasOwnProperty.call(namespaceStore, manualProductQuickSetupKey)
            && Array.isArray(namespaceStore[manualProductQuickSetupKey])
        ) {
            return {
                items: namespaceStore[manualProductQuickSetupKey],
                sourceNamespace: productQuickSetupNamespace,
            };
        }

        return findProductQuickSetupItems(
            productQuickSetupStore,
            productQuickSetupNamespace,
            manualProductQuickSetupKey
        );
    }, [manualProductQuickSetupKey, productQuickSetupNamespace, productQuickSetupStore]);
    const manualProductQuickSetupItems = useMemo(() => (
        normalizeStoredProductQuickSetupItems(manualProductQuickSetupLookup.items)
    ), [manualProductQuickSetupLookup]);
    const currentProductQuickSetupKey = productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL
        ? manualProductQuickSetupKey
        : activeProductQuickSetupKey;
    const currentProductQuickSetupItems = productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL
        ? manualProductQuickSetupItems
        : activeProductQuickSetupItems;
    const isManualProductQuickModeToggleDisabled = manualProductQuickSetupItems.length === 0;
    const isManualProductQuickModeActive = manualProductQuickModeEnabled && manualProductQuickSetupItems.length > 0;
    const activeProductQuickSetupRefreshKey = useMemo(
        () => JSON.stringify(buildProductQuickSetupRefreshTargets(activeProductQuickSetupItems)),
        [activeProductQuickSetupItems]
    );
    const activeProductQuickSetupRefreshScopeKey = useMemo(() => JSON.stringify({
        setupKey: activeProductQuickSetupKey,
        refreshKey: activeProductQuickSetupRefreshKey,
    }), [activeProductQuickSetupKey, activeProductQuickSetupRefreshKey]);
    useEffect(() => {
        if (!activeProductQuickSetupKey || !productQuickSetupNamespace) return;
        if (!activeProductQuickSetupLookup.sourceNamespace) return;
        if (activeProductQuickSetupLookup.sourceNamespace === productQuickSetupNamespace) return;
        if (activeProductQuickSetupItems.length === 0) return;

        setProductQuickSetupStore((prev) => {
            const existingItems = prev?.[productQuickSetupNamespace]?.[activeProductQuickSetupKey];
            if (Array.isArray(existingItems) && existingItems.length > 0) {
                return prev;
            }

            return copyProductQuickSetupItemsToNamespace(
                prev,
                productQuickSetupNamespace,
                activeProductQuickSetupKey,
                activeProductQuickSetupItems
            );
        });
    }, [
        activeProductQuickSetupItems,
        activeProductQuickSetupKey,
        activeProductQuickSetupLookup.sourceNamespace,
        productQuickSetupNamespace,
    ]);
    const isProductQuickModeToggleDisabled = activeProductQuickSetupItems.length === 0 || hasActiveProductBundleQuickFilter;
    const isProductQuickModeActive = productQuickModeEnabled && activeProductQuickSetupItems.length > 0 && !hasActiveProductBundleQuickFilter;
    const shouldShowProductQuickFilterPanel = showSearchDropdown && showProductQuickFilterPanel && productQuickFilterAttributes.length > 0;
    const syncLatestProductsIntoLocalSources = useCallback((latestMap) => {
        if (!(latestMap instanceof Map) || latestMap.size === 0) return;

        const syncCacheRef = (cacheRef) => {
            cacheRef.current.forEach((entries, key) => {
                const nextEntries = (Array.isArray(entries) ? entries : []).map((product) => {
                    const latest = getLatestProductSnapshotForEntry(product, latestMap);
                    return mergeLatestBundleItemsIntoPickerEntry(
                        mergeLatestProductSnapshotIntoPickerEntry(product, latest),
                        latestMap
                    );
                });

                cacheRef.current.set(key, nextEntries);
            });
        };

        syncCacheRef(productSearchCacheRef);
        syncCacheRef(productQuickFilterScopeCacheRef);
        syncCacheRef(productQuickSetupCacheRef);

        setProductQuickFilterScopeProducts((prev) => (
            (Array.isArray(prev) ? prev : []).map((product) => {
                const latest = getLatestProductSnapshotForEntry(product, latestMap);
                return mergeLatestBundleItemsIntoPickerEntry(
                    mergeLatestProductSnapshotIntoPickerEntry(product, latest),
                    latestMap
                );
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
                                const entryKind = String(item?.entry_kind || SEARCH_ENTRY_PRODUCT).trim() || SEARCH_ENTRY_PRODUCT;
                                const isBundleOptionEntry = entryKind === SEARCH_ENTRY_BUNDLE_OPTION;
                                const latest = getLatestProductSnapshotForEntry(item, latestMap);
                                const mergedBundleItems = isBundleOptionEntry
                                    ? (
                                        Array.isArray(latest?.bundle_items) && latest.bundle_items.length > 0
                                            ? latest.bundle_items
                                            : mergeLatestProductSnapshotsIntoBundleItems(item?.bundle_items, latestMap)
                                    )
                                    : item?.bundle_items;
                                const hasBundleItemsChanged = isBundleOptionEntry
                                    && JSON.stringify(item?.bundle_items || []) !== JSON.stringify(mergedBundleItems || []);
                                if (!latest && !hasBundleItemsChanged) return item;

                                hasChanged = true;

                                if (!latest) {
                                    return {
                                        ...item,
                                        bundle_items: mergedBundleItems,
                                    };
                                }

                                const bundleOptionPrice = isBundleOptionEntry
                                    ? resolveBundleOptionEntryPrice(latest || item, mergedBundleItems)
                                    : 0;
                                const bundleOptionTotalPrice = isBundleOptionEntry
                                    ? calculateBundleItemsSubtotal(mergedBundleItems)
                                    : 0;

                                return {
                                    ...item,
                                    sku: isBundleOptionEntry ? (item?.sku ?? '') : (latest.sku ?? item?.sku ?? ''),
                                    display_sku: isBundleOptionEntry ? (item?.display_sku ?? item?.sku ?? '') : (item?.display_sku ?? latest.sku ?? item?.sku ?? ''),
                                    name: isBundleOptionEntry ? (item?.name ?? '') : (latest.name ?? item?.name ?? ''),
                                    display_name: isBundleOptionEntry
                                        ? (item?.display_name ?? item?.name ?? '')
                                        : (latest.display_name ?? latest.name ?? item?.display_name ?? item?.name ?? ''),
                                    price: isBundleOptionEntry
                                        ? (bundleOptionPrice || Number(item?.price ?? 0) || 0)
                                        : resolveMoneyValue(latest.price, item?.price, 0),
                                    expected_cost: isBundleOptionEntry
                                        ? parseMoneyNumber(latest?.expected_cost, parseMoneyNumber(item?.expected_cost))
                                        : parseMoneyNumber(latest.expected_cost, parseMoneyNumber(item?.expected_cost)),
                                    cost_price: isBundleOptionEntry
                                        ? resolveProductCostPrice(latest, resolveProductCostPrice(item))
                                        : resolveProductCostPrice({ ...item, ...latest }),
                                    unit_name: resolveOrderUnitLabel(latest, item),
                                    ...resolveInventorySnapshot(latest, item),
                                    ...resolveProductSourceFields(latest, item),
                                    main_image: String(latest.main_image ?? item?.main_image ?? '').trim(),
                                    type: latest.type ?? item?.type ?? '',
                                    ...(isBundleOptionEntry ? {
                                        bundle_option_total_price: bundleOptionTotalPrice || latest?.bundle_option_total_price || item?.bundle_option_total_price,
                                        bundle_option_discounted_price: bundleOptionPrice || latest?.bundle_option_discounted_price || item?.bundle_option_discounted_price,
                                        bundle_items: mergedBundleItems,
                                    } : {}),
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
        const refreshedMap = buildLatestProductSnapshotMap(refreshedItems);

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
                const latestName = resolveLatestOrderItemName({ ...item, options: mergedOptions }, latest);
                const latestSku = normalizeCanvasText(latest.display_sku || latest.sku) || item.sku;
                const hasPlaceholderDisplayName = isPlaceholderProductName(item?.name, Number(item?.product_id) || 0);
                const hasCustomDisplayName = Boolean(getOrderLineOriginalNameLabel(item)) && !hasPlaceholderDisplayName;
                const nextName = hasCustomDisplayName ? item.name : latestName;
                const nextSnapshotName = hasCustomDisplayName
                    ? (item.snapshot_name || item.name)
                    : latestName;

                return {
                    ...item,
                    name: nextName,
                    sku: latestSku,
                    snapshot_name: nextSnapshotName,
                    snapshot_sku: hasCustomDisplayName ? (item.snapshot_sku || item.sku) : latestSku,
                    original_name: latestName,
                    original_sku: latestSku,
                    unit_name: resolveOrderUnitLabel(latest, item),
                    price: Number(latest.price ?? item.price ?? 0) || 0,
                    cost_price: resolveProductCostPrice(latest, item.cost_price),
                    options: mergedOptions,
                    ...resolveInventorySnapshot(latest, item),
                    ...resolveProductSourceFields(latest, item),
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
        const refreshedMap = buildLatestProductSnapshotMap(refreshedItems);

        if (refreshedMap.size === 0) {
            return refreshedMap;
        }

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => {
                const latest = refreshedMap.get(getOrderItemEffectiveInventoryProductId(item));
                if (!latest) return item;
                const latestPrice = parseMoneyNumber(latest?.price);
                const shouldHydrateBundlePrice = (
                    normalizeCanvasText(item?.options?.search_entry_kind) === SEARCH_ENTRY_BUNDLE_OPTION
                    || Number(item?.options?.bundle_parent_id ?? 0) > 0
                ) && latestPrice !== null;
                const currentCostPrice = resolveRoundedImportCostValue(item.cost_price, 0);
                const shouldHydrateCostPrice = currentCostPrice <= 0 && hasProductCostSnapshot(latest);
                const nextCostPrice = shouldHydrateCostPrice
                    ? resolveProductCostPrice(latest, currentCostPrice)
                    : item.cost_price;
                const latestProductId = Number(latest?.product_id ?? latest?.id ?? 0) || 0;
                const itemProductId = Number(item?.product_id ?? 0) || 0;
                const latestName = latestProductId === itemProductId
                    ? resolveLatestOrderItemName(item, latest)
                    : '';
                const hasPlaceholderName = isPlaceholderProductName(item?.name, itemProductId);
                const hasPlaceholderSnapshotName = isPlaceholderProductName(item?.snapshot_name, itemProductId);
                const hasPlaceholderOriginalName = isPlaceholderProductName(item?.original_name, itemProductId);
                const shouldHydrateName = latestName
                    && !isPlaceholderProductName(latestName, itemProductId)
                    && (hasPlaceholderName || hasPlaceholderSnapshotName || hasPlaceholderOriginalName)
                    && !hasActualOrderProductOverride(item);
                const latestSku = latestProductId === itemProductId
                    ? normalizeCanvasText(latest?.display_sku || latest?.sku)
                    : '';
                const currentSku = normalizeCanvasText(item?.sku);
                const shouldHydrateSku = latestSku && (!currentSku || currentSku === 'N/A');

                return {
                    ...item,
                    ...(shouldHydrateName ? {
                        name: hasPlaceholderName ? latestName : item?.name,
                        snapshot_name: hasPlaceholderSnapshotName ? latestName : item?.snapshot_name,
                        original_name: hasPlaceholderOriginalName ? latestName : item?.original_name,
                    } : {}),
                    ...(shouldHydrateSku ? {
                        sku: latestSku,
                        snapshot_sku: latestSku,
                        original_sku: latestSku,
                    } : {}),
                    unit_name: resolveOrderUnitLabel(latest, item),
                    price: shouldHydrateBundlePrice ? latestPrice : item.price,
                    cost_price: nextCostPrice,
                    base_cost_price: shouldHydrateCostPrice
                        ? resolveRoundedImportCostValue(latest.cost_price ?? latest.expected_cost, nextCostPrice)
                        : item.base_cost_price,
                    ...resolveInventorySnapshot(latest, item),
                    ...resolveProductSourceFields(latest, item),
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
                    const payload = buildProductRefreshPayload(item, { useEffectiveInventoryProduct: true });
                    if (!payload) return null;

                    const key = payload.entry_kind === SEARCH_ENTRY_BUNDLE_OPTION
                        ? [
                            SEARCH_ENTRY_BUNDLE_OPTION,
                            payload.bundle_parent_id || '',
                            payload.bundle_option_uid || '',
                            payload.bundle_option_key || '',
                            payload.bundle_option_post_id || '',
                            payload.bundle_option_title || '',
                            payload.bundle_item_base_product_id || '',
                            payload.product_id || '',
                        ].join('::')
                        : String(payload.product_id || '');

                    return [key, payload];
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
        sales_channel: 'online',
        profit_center_id: '',
        offline_store_name: '',
        offline_seller_name: '',
        offline_payment_method: '',
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
    const [discountInputMode, setDiscountInputMode] = useState(DISCOUNT_INPUT_MODE_AMOUNT);
    const [discountInputValue, setDiscountInputValue] = useState(() => formatSignedMoneyInputValue(0));
    const discountInputRef = useRef(null);
    useEffect(() => {
        if (profitCenterManualOverrideRef.current) {
            return;
        }

        const nextProfitCenterId = resolveSingleOrderItemsProfitCenterId(formData.items);
        if (String(formData.profit_center_id || '') === nextProfitCenterId) {
            return;
        }

        setFormData((current) => ({
            ...current,
            profit_center_id: resolveSingleOrderItemsProfitCenterId(current.items),
        }));
    }, [formData.items, formData.profit_center_id]);
    const activeOrderAiReplaceLine = useMemo(
        () => formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(orderAiReplaceLineId)) || null,
        [formData.items, orderAiReplaceLineId]
    );
    const activeOrderAiReplaceLineNumber = useMemo(() => {
        const normalizedLineId = normalizeCanvasText(orderAiReplaceLineId);
        if (!normalizedLineId) return '';

        const index = formData.items.findIndex((item) => normalizeCanvasText(item?.line_id) === normalizedLineId);
        return index >= 0 ? getOrderLineDisplaySequence(formData.items[index], index) : '';
    }, [formData.items, orderAiReplaceLineId]);
    const activeActualProductPickerLine = useMemo(
        () => formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(actualProductPickerLineId)) || null,
        [actualProductPickerLineId, formData.items]
    );
    const activeActualProductPickerLineNumber = useMemo(() => {
        const normalizedLineId = normalizeCanvasText(actualProductPickerLineId);
        if (!normalizedLineId) return '';

        const index = formData.items.findIndex((item) => normalizeCanvasText(item?.line_id) === normalizedLineId);
        return index >= 0 ? getOrderLineDisplaySequence(formData.items[index], index) : '';
    }, [actualProductPickerLineId, formData.items]);
    const selectedOrderLine = useMemo(
        () => formData.items.find((item) => normalizeCanvasText(item?.line_id) === normalizeCanvasText(selectedOrderLineId)) || null,
        [formData.items, selectedOrderLineId]
    );
    const actualProductSectionLine = useMemo(
        () => selectedOrderLine || formData.items[0] || null,
        [formData.items, selectedOrderLine]
    );
    const replacementDeclarationSourceKey = useMemo(
        () => getActualReplacementEntryKey(replacementDeclarationSource),
        [replacementDeclarationSource]
    );
    const replacementDeclarationSelectedKeys = useMemo(
        () => new Set(replacementDeclarationSelected.map(getActualReplacementEntryKey).filter(Boolean)),
        [replacementDeclarationSelected]
    );
    const replacementDeclarationSelectedSkus = useMemo(
        () => replacementDeclarationSelected.map(getProductReplacementDeclarationSku).filter(Boolean),
        [replacementDeclarationSelected]
    );
    const isActualProductPickerOpenForSectionLine = Boolean(actualProductSectionLine)
        && normalizeCanvasText(actualProductPickerLineId) === normalizeCanvasText(actualProductSectionLine?.line_id);
    useEffect(() => {
        if (!orderAiReplaceLineId || orderAiReplaceActiveTab !== ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE) return;

        const matchedLine = findOrderLineByWarehouseQuery(formData.items, orderAiReplaceWarehouseSearchTerm);
        const matchedLineId = normalizeCanvasText(matchedLine?.line_id);
        if (!matchedLineId || matchedLineId === normalizeCanvasText(orderAiReplaceLineId)) return;

        setOrderAiReplaceLineId(matchedLineId);
        setSelectedOrderLineId(matchedLineId);
        setOrderAiReplaceWarehouseResults([]);
    }, [
        formData.items,
        orderAiReplaceActiveTab,
        orderAiReplaceLineId,
        orderAiReplaceWarehouseSearchTerm,
    ]);
    useEffect(() => {
        if (!actualProductPickerLineId || actualProductPickerActiveTab !== ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE) return;

        const matchedLine = findOrderLineByWarehouseQuery(formData.items, actualProductPickerSearchTerm);
        const matchedLineId = normalizeCanvasText(matchedLine?.line_id);
        if (!matchedLineId || matchedLineId === normalizeCanvasText(actualProductPickerLineId)) return;

        setActualProductPickerLineId(matchedLineId);
        setSelectedOrderLineId(matchedLineId);
        setActualProductPickerResults([]);
    }, [
        actualProductPickerActiveTab,
        actualProductPickerLineId,
        actualProductPickerSearchTerm,
        formData.items,
    ]);
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
        if (discountInputMode === DISCOUNT_INPUT_MODE_PERCENT) {
            return;
        }

        setDiscountInputValue(formatSignedMoneyInputValue(formData.discount));
    }, [discountInputMode, formData.discount]);
    const selectedQuickSetupEntryKeys = useMemo(
        () => new Set(currentProductQuickSetupItems.map(getProductQuickSetupEntryKey).filter(Boolean)),
        [currentProductQuickSetupItems]
    );
    const visibleProductQuickSetupProducts = useMemo(() => {
        return mergeProductQuickSetupEntries(productQuickSetupProducts, currentProductQuickSetupItems);
    }, [currentProductQuickSetupItems, productQuickSetupProducts]);
    const getCrossSellSourceBadgeLabel = useCallback((item) => {
        const sourceAccountId = getProductSourceAccountId(item);
        if (!sourceAccountId || !normalizeAccountId(activeAccountId) || sourceAccountId === normalizeAccountId(activeAccountId)) {
            return '';
        }

        return getProductSourceDisplayName(item) || `Shop #${sourceAccountId}`;
    }, [activeAccountId]);
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
    const [leavePromptOpen, setLeavePromptOpen] = useState(false);
    const leaveGuardBaselineSnapshotRef = useRef('');
    const leaveGuardBaselineReadyRef = useRef(false);
    const leaveGuardBypassRef = useRef(false);
    const shouldPromptLeaveRef = useRef(false);
    const leaveGuardHistoryActiveRef = useRef(false);
    const latestLeaveGuardSnapshot = useMemo(
        () => buildOrderFormLeaveGuardSnapshot({ formData, orderKind, regionType }),
        [formData, orderKind, regionType]
    );
    const hasNewOrderUnsavedContent = useMemo(
        () => hasMeaningfulOrderFormDraftContent(formData),
        [formData]
    );
    const isExistingOrderDirty = isEdit
        && leaveGuardBaselineReadyRef.current
        && leaveGuardBaselineSnapshotRef.current !== latestLeaveGuardSnapshot;
    const shouldPromptLeave = isCompactOrderMobileLayout && !loading && !saving && (
        isEdit
            ? isExistingOrderDirty
            : hasNewOrderUnsavedContent
    );

    useEffect(() => {
        if (!isCompactOrderMobileLayout) {
            setLeavePromptOpen(false);
        }
    }, [isCompactOrderMobileLayout]);

    useEffect(() => {
        leaveGuardBaselineReadyRef.current = false;
        leaveGuardBaselineSnapshotRef.current = '';
        leaveGuardBypassRef.current = false;
        leaveGuardHistoryActiveRef.current = false;
        setLeavePromptOpen(false);
    }, [duplicateFromId, id, leadId]);

    useEffect(() => {
        if (!isEdit || loading || leaveGuardBaselineReadyRef.current) {
            return;
        }

        leaveGuardBaselineSnapshotRef.current = latestLeaveGuardSnapshot;
        leaveGuardBaselineReadyRef.current = true;
    }, [isEdit, latestLeaveGuardSnapshot, loading]);

    useEffect(() => {
        shouldPromptLeaveRef.current = shouldPromptLeave;
    }, [shouldPromptLeave]);

    const pushLeaveGuardHistoryState = useCallback(() => {
        if (typeof window === 'undefined') return;

        const currentState = window.history.state && typeof window.history.state === 'object'
            ? window.history.state
            : {};

        window.history.pushState(
            { ...currentState, [ORDER_FORM_LEAVE_GUARD_HISTORY_KEY]: true },
            '',
            window.location.href
        );
        leaveGuardHistoryActiveRef.current = true;
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        if (shouldPromptLeave && !leaveGuardHistoryActiveRef.current && !leaveGuardBypassRef.current) {
            pushLeaveGuardHistoryState();
        }

        return undefined;
    }, [pushLeaveGuardHistoryState, shouldPromptLeave]);

    const requestLeaveOrderForm = useCallback(() => {
        if (shouldPromptLeaveRef.current && !leaveGuardBypassRef.current) {
            setLeavePromptOpen(true);
            return;
        }

        leaveGuardBypassRef.current = true;
        navigateBack();
    }, [navigateBack]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleBeforeUnload = (event) => {
            if (!shouldPromptLeaveRef.current || leaveGuardBypassRef.current) {
                return;
            }

            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleLeaveGuardPopState = () => {
            if (leaveGuardBypassRef.current || mobileProductSearchHistoryStateActiveRef.current) {
                return;
            }

            if (!leaveGuardHistoryActiveRef.current) {
                return;
            }

            if (!shouldPromptLeaveRef.current) {
                leaveGuardHistoryActiveRef.current = false;
                window.setTimeout(() => window.history.back(), 0);
                return;
            }

            pushLeaveGuardHistoryState();
            setLeavePromptOpen(true);
        };

        window.addEventListener('popstate', handleLeaveGuardPopState);
        return () => window.removeEventListener('popstate', handleLeaveGuardPopState);
    }, [pushLeaveGuardHistoryState]);

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
        lastProductQuickFilterDurableSignatureRef.current = buildProductQuickFilterDurableSignature(
            productQuickFilterStorageKey,
            storedState
        );
        skipNextProductQuickFilterPersistRef.current = true;

        setSearchTerm(storedState.searchTerm);
        setDebouncedSearchTerm(storedState.searchTerm);
        setProductQuickFilterAttributeId(storedState.attributeId);
        setProductQuickFilterValues(storedState.values);
        setProductQuickFilterAttributeId2(storedState.attributeId2);
        setProductQuickFilterValues2(storedState.values2);
        setProductQuickModeEnabled(
            hasStoredProductQuickModePreference(user)
                ? storedState.quickModeEnabled
                : productQuickModeDefaultEnabled
        );
        setShowProductQuickFilterPanel(false);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
    }, [productQuickFilterStorageKey, productQuickModeDefaultEnabled, user]);

    useEffect(() => {
        if (skipNextProductQuickFilterPersistRef.current) {
            skipNextProductQuickFilterPersistRef.current = false;
            return;
        }

        const nextState = {
            searchTerm,
            attributeId: productQuickFilterAttributeId,
            values: normalizedProductQuickFilterValues,
            attributeId2: productQuickFilterAttributeId2,
            values2: normalizedProductQuickFilterValues2,
            quickModeEnabled: productQuickModeEnabled,
        };
        const didPersist = persistProductQuickFilterState(productQuickFilterStorageKey, nextState);
        const nextDurableSignature = buildProductQuickFilterDurableSignature(productQuickFilterStorageKey, nextState);

        if (didPersist && lastProductQuickFilterDurableSignatureRef.current !== nextDurableSignature) {
            flushProductQuickSettingsNow();
        }

        lastProductQuickFilterDurableSignatureRef.current = nextDurableSignature;
    }, [
        flushProductQuickSettingsNow,
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

        const extracted = extractCustomerInfoFromText(trimmedAddress);
        const detectedCustomerName = String(extracted.customerName || '').trim();
        const detectedCustomerPhone = String(extracted.customerPhone || '').trim();
        const detectedAddressText = String(extracted.addressText || trimmedAddress).trim();
        const hasExistingShippingAddress = hasNonEmptyText(formData.shipping_address) || hasNonEmptyText(formData.address_detail);
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

        setFormData(prev => ({
            ...prev,
            customer_name: !hasNonEmptyText(formData.customer_name) && detectedCustomerName ? detectedCustomerName : prev.customer_name,
            customer_phone: !hasNonEmptyText(formData.customer_phone) && detectedCustomerPhone ? detectedCustomerPhone : prev.customer_phone,
            shipping_address: !hasExistingShippingAddress && detectedAddressText ? detectedAddressText : prev.shipping_address,
            address_detail: !hasExistingShippingAddress && detectedAddressText ? detectedAddressText : prev.address_detail,
        }));

        setAddressDetection(buildAddressDetectionFeedback(autoFilledFields));
    }, [formData]);

    const handleCancel = useCallback(() => {
        requestLeaveOrderForm();
    }, [requestLeaveOrderForm]);

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

                if (isWriting && !showColumnConfig && !showSearchDropdown && !showQuoteTemplatePicker && !orderAiReplaceLineId && !actualProductPickerLineId && !showReplacementDeclarationModal) return;

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
                    setOrderAiReplaceActiveTab(ACTUAL_PRODUCT_PICKER_TAB_MANUAL);
                    setOrderAiReplaceWarehouseSearchTerm('');
                    setOrderAiReplaceWarehouseResults([]);
                    setOrderAiReplaceWarehouseLoading(false);
                    return;
                }
                if (actualProductPickerLineId) {
                    setActualProductPickerLineId('');
                    setActualProductPickerSearchTerm('');
                    setActualProductPickerResults([]);
                    setActualProductPickerLoading(false);
                    setActualProductPickerActiveTab(ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE);
                    actualProductPickerAnchorRef.current = null;
                    return;
                }
                if (showReplacementDeclarationModal) {
                    replacementDeclarationSourceAbortRef.current?.abort();
                    replacementDeclarationSearchAbortRef.current?.abort();
                    replacementDeclarationLookupAbortRef.current?.abort();
                    setShowReplacementDeclarationModal(false);
                    setReplacementDeclarationSource(null);
                    setReplacementDeclarationGroupId(null);
                    setReplacementDeclarationSelected([]);
                    setReplacementDeclarationSourceSearchTerm('');
                    setReplacementDeclarationSourceResults([]);
                    setReplacementDeclarationSourceLoading(false);
                    setReplacementDeclarationSearchTerm('');
                    setReplacementDeclarationResults([]);
                    setReplacementDeclarationSearchLoading(false);
                    setReplacementDeclarationLookupLoading(false);
                    setReplacementDeclarationSaving(false);
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
    }, [actualProductPickerLineId, closeProductSearchDropdown, orderAiReplaceLineId, showColumnConfig, showOrderAiInputReviewModal, showReplacementDeclarationModal, showSearchDropdown, showQuoteTemplatePicker, handleCancel]);

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
        setOrderAiReplaceActiveTab(ACTUAL_PRODUCT_PICKER_TAB_MANUAL);
        setOrderAiReplaceWarehouseSearchTerm('');
        setOrderAiReplaceWarehouseResults([]);
        setOrderAiReplaceWarehouseLoading(false);
    }, []);
    const closeActualProductPicker = useCallback(() => {
        actualProductPickerAnchorRef.current = null;
        setActualProductPickerLineId('');
        setActualProductPickerSearchTerm('');
        setActualProductPickerResults([]);
        setActualProductPickerLoading(false);
        setActualProductPickerActiveTab(ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE);
    }, []);
    const handleActualProductPickerTabChange = useCallback((tab) => {
        const nextTab = tab === ACTUAL_PRODUCT_PICKER_TAB_MANUAL
            ? ACTUAL_PRODUCT_PICKER_TAB_MANUAL
            : ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE;

        setActualProductPickerActiveTab(nextTab);
        setActualProductPickerSearchTerm('');
        setActualProductPickerResults([]);
    }, []);
    const handleOrderAiReplacePickerTabChange = useCallback((tab) => {
        const nextTab = tab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
            ? ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
            : ACTUAL_PRODUCT_PICKER_TAB_MANUAL;

        setOrderAiReplaceActiveTab(nextTab);
        if (nextTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE) {
            setOrderAiReplaceWarehouseSearchTerm('');
            setOrderAiReplaceWarehouseResults([]);
        } else {
            setOrderAiReplaceSearchTerm('');
            setOrderAiReplaceResults([]);
        }
    }, []);
    const closeReplacementDeclarationModal = useCallback(() => {
        replacementDeclarationSourceAbortRef.current?.abort();
        replacementDeclarationSearchAbortRef.current?.abort();
        replacementDeclarationLookupAbortRef.current?.abort();
        replacementDeclarationGroupsAbortRef.current?.abort();
        replacementDeclarationSourceAbortRef.current = null;
        replacementDeclarationSearchAbortRef.current = null;
        replacementDeclarationLookupAbortRef.current = null;
        replacementDeclarationGroupsAbortRef.current = null;
        setShowReplacementDeclarationModal(false);
        setReplacementDeclarationSource(null);
        setReplacementDeclarationGroupId(null);
        setReplacementDeclarationSelected([]);
        setReplacementDeclarationSourceSearchTerm('');
        setReplacementDeclarationSourceResults([]);
        setReplacementDeclarationSourceLoading(false);
        setReplacementDeclarationSearchTerm('');
        setReplacementDeclarationResults([]);
        setReplacementDeclarationSearchLoading(false);
        setReplacementDeclarationLookupLoading(false);
        setReplacementDeclarationGroups([]);
        setReplacementDeclarationGroupsSearchTerm('');
        setReplacementDeclarationGroupsLoading(false);
        setReplacementDeclarationSaving(false);
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
    const handleOpenReplacementDeclarationModal = useCallback((line = null) => {
        const checkedLine = formData.items.find((item) => selectedLineItemIds.has(normalizeCanvasText(item?.line_id)));
        const fallbackLine = line || selectedOrderLine || checkedLine || formData.items[0] || null;
        if (!fallbackLine) {
            showTransientNotification('error', 'Đơn chưa có sản phẩm để khai báo thay thế.');
            return;
        }

        const sourceEntry = buildProductReplacementDeclarationEntryFromLine(fallbackLine);
        if (!sourceEntry || !getProductReplacementDeclarationSku(sourceEntry)) {
            showTransientNotification('error', 'Sản phẩm gốc cần có mã SKU để khai báo thay thế.');
            return;
        }

        closeActualProductPicker();
        closeOrderAiReplacePicker();
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
        setReplacementDeclarationSource(sourceEntry);
        setReplacementDeclarationGroupId(null);
        setReplacementDeclarationSelected([]);
        setReplacementDeclarationSourceSearchTerm('');
        setReplacementDeclarationSourceResults([]);
        setReplacementDeclarationSearchTerm('');
        setReplacementDeclarationResults([]);
        setReplacementDeclarationSearchLoading(false);
        setReplacementDeclarationGroupsSearchTerm('');
        setShowReplacementDeclarationModal(true);
    }, [
        closeActualProductPicker,
        closeOrderAiReplacePicker,
        formData.items,
        selectedLineItemIds,
        selectedOrderLine,
        showTransientNotification,
    ]);
    const handleOpenProductReplacementManager = useCallback(() => {
        closeReplacementDeclarationModal();
        navigate('/admin/inventory/ma-thay-the');
    }, [closeReplacementDeclarationModal, navigate]);

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
        setOrderAiReplaceActiveTab(ACTUAL_PRODUCT_PICKER_TAB_MANUAL);
        setOrderAiReplaceWarehouseSearchTerm('');
        setOrderAiReplaceWarehouseResults([]);
        setOrderAiReplaceWarehouseLoading(false);
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
        setActualProductPickerActiveTab(ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE);
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
            '',
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
            inventory_source_account_id: currentLine.product_source_account_id || currentLine.source_account_id || currentLine.inventory_source_account_id,
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
            inventory_source_account_id: replacement.inventory_source_account_id
                || replacement.product_source_account_id
                || replacement.source_account_id
                || currentLine.inventory_source_account_id,
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
    const handleSelectWarehousePickingReplacement = useCallback(async (lineId, entry) => {
        await handleSelectActualProductReplacement(lineId, entry);
        closeOrderAiReplacePicker();
    }, [closeOrderAiReplacePicker, handleSelectActualProductReplacement]);

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

    const getLineItemSelectionRangeIds = useCallback((startLineId, endLineId) => {
        const lineIds = formData.items
            .map((item) => normalizeCanvasText(item?.line_id))
            .filter(Boolean);
        const startIndex = lineIds.indexOf(normalizeCanvasText(startLineId));
        const endIndex = lineIds.indexOf(normalizeCanvasText(endLineId));

        if (startIndex === -1 || endIndex === -1) {
            return [];
        }

        const fromIndex = Math.min(startIndex, endIndex);
        const toIndex = Math.max(startIndex, endIndex);
        return lineIds.slice(fromIndex, toIndex + 1);
    }, [formData.items]);

    const applyLineItemSelectionPatch = useCallback((lineIds, shouldSelect) => {
        const normalizedLineIds = (Array.isArray(lineIds) ? lineIds : [lineIds])
            .map((lineId) => normalizeCanvasText(lineId))
            .filter(Boolean);

        if (normalizedLineIds.length === 0) return;

        setSelectedLineItemIds((prev) => {
            const next = new Set(prev);
            normalizedLineIds.forEach((lineId) => {
                if (shouldSelect) {
                    next.add(lineId);
                } else {
                    next.delete(lineId);
                }
            });
            return next;
        });
    }, []);

    const handleLineItemSelectionClick = useCallback((event, lineId) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const normalizedLineId = normalizeCanvasText(lineId);
        if (!normalizedLineId) return;

        if (event?.shiftKey && lineItemSelectionAnchorRef.current) {
            const rangeIds = getLineItemSelectionRangeIds(lineItemSelectionAnchorRef.current, normalizedLineId);
            if (rangeIds.length > 0) {
                setSelectedLineItemIds((prev) => {
                    const shouldSelectRange = rangeIds.some((rangeLineId) => !prev.has(rangeLineId));
                    const next = new Set(prev);
                    rangeIds.forEach((rangeLineId) => {
                        if (shouldSelectRange) {
                            next.add(rangeLineId);
                        } else {
                            next.delete(rangeLineId);
                        }
                    });
                    return next;
                });
                setSelectedOrderLineId(normalizedLineId);
                return;
            }
        }

        lineItemSelectionAnchorRef.current = normalizedLineId;
        setSelectedOrderLineId(normalizedLineId);
        setSelectedLineItemIds((prev) => {
            const next = new Set(prev);
            if (next.has(normalizedLineId)) {
                next.delete(normalizedLineId);
            } else {
                next.add(normalizedLineId);
            }
            return next;
        });
    }, [getLineItemSelectionRangeIds]);

    const handleLineItemSelectionPointerDown = useCallback((event, lineId) => {
        if (event?.button !== undefined && event.button !== 0) return;

        event?.preventDefault?.();
        event?.stopPropagation?.();

        const normalizedLineId = normalizeCanvasText(lineId);
        if (!normalizedLineId) return;

        if (event?.shiftKey) {
            lineItemSelectionDragRef.current = null;
            handleLineItemSelectionClick(event, normalizedLineId);
            return;
        }

        const shouldSelect = !selectedLineItemIds.has(normalizedLineId);
        lineItemSelectionAnchorRef.current = normalizedLineId;
        lineItemSelectionDragRef.current = {
            shouldSelect,
            lastLineId: normalizedLineId,
            visitedLineIds: new Set([normalizedLineId]),
        };
        setSelectedOrderLineId(normalizedLineId);
        applyLineItemSelectionPatch(normalizedLineId, shouldSelect);
    }, [applyLineItemSelectionPatch, handleLineItemSelectionClick, selectedLineItemIds]);

    const handleLineItemSelectionDragEnter = useCallback((lineId) => {
        const dragState = lineItemSelectionDragRef.current;
        if (!dragState) return;

        const normalizedLineId = normalizeCanvasText(lineId);
        if (!normalizedLineId) return;

        const rangeIds = getLineItemSelectionRangeIds(dragState.lastLineId, normalizedLineId);
        const nextLineIds = rangeIds.length > 0 ? rangeIds : [normalizedLineId];
        const unvisitedLineIds = nextLineIds.filter((rangeLineId) => !dragState.visitedLineIds.has(rangeLineId));

        if (unvisitedLineIds.length === 0) {
            dragState.lastLineId = normalizedLineId;
            return;
        }

        unvisitedLineIds.forEach((rangeLineId) => dragState.visitedLineIds.add(rangeLineId));
        dragState.lastLineId = normalizedLineId;
        setSelectedOrderLineId(normalizedLineId);
        applyLineItemSelectionPatch(unvisitedLineIds, dragState.shouldSelect);
    }, [applyLineItemSelectionPatch, getLineItemSelectionRangeIds]);

    useEffect(() => {
        const finishLineItemSelectionDrag = () => {
            lineItemSelectionDragRef.current = null;
        };

        window.addEventListener('pointerup', finishLineItemSelectionDrag);
        window.addEventListener('pointercancel', finishLineItemSelectionDrag);
        return () => {
            window.removeEventListener('pointerup', finishLineItemSelectionDrag);
            window.removeEventListener('pointercancel', finishLineItemSelectionDrag);
        };
    }, []);

    useEffect(() => {
        const validLineIds = new Set(
            formData.items
                .map((item) => normalizeCanvasText(item?.line_id))
                .filter(Boolean)
        );

        setSelectedLineItemIds((prev) => {
            let changed = false;
            const next = new Set();
            prev.forEach((lineId) => {
                if (validLineIds.has(lineId)) {
                    next.add(lineId);
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });

        if (lineItemSelectionAnchorRef.current && !validLineIds.has(lineItemSelectionAnchorRef.current)) {
            lineItemSelectionAnchorRef.current = '';
        }
    }, [formData.items]);

    const toggleAllLineItemSelection = useCallback(() => {
        const allLineIds = formData.items
            .map((item) => normalizeCanvasText(item?.line_id))
            .filter(Boolean);

        setSelectedLineItemIds((prev) => {
            const areAllCurrentLineItemsSelected = allLineIds.length > 0
                && allLineIds.every((lineId) => prev.has(lineId));

            if (areAllCurrentLineItemsSelected) {
                lineItemSelectionAnchorRef.current = '';
                return new Set();
            }

            lineItemSelectionAnchorRef.current = allLineIds[0] || '';
            return new Set(allLineIds);
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

    const selectedOrderLineItems = useMemo(
        () => formData.items.filter((item) => selectedLineItemIds.has(normalizeCanvasText(item?.line_id))),
        [formData.items, selectedLineItemIds]
    );
    const isAllLineItemsSelected = formData.items.length > 0 && selectedOrderLineItems.length === formData.items.length;
    const hasAnyLineItemSelected = selectedOrderLineItems.length > 0;
    const lastDeletedLineItemBatch = deletedLineItemBatches[deletedLineItemBatches.length - 1] || null;
    const deletedLineItemRestoreCount = Array.isArray(lastDeletedLineItemBatch?.items)
        ? lastDeletedLineItemBatch.items.length
        : 0;
    const hasDeletedLineItemRestore = deletedLineItemRestoreCount > 0;

    const pushDeletedLineItemBatch = useCallback((batch) => {
        const batchItems = Array.isArray(batch?.items)
            ? batch.items.filter((entry) => entry?.item)
            : [];

        if (batchItems.length === 0) {
            return;
        }

        setDeletedLineItemBatches((prev) => [
            ...prev,
            {
                ...batch,
                items: batchItems,
            },
        ].slice(-MAX_DELETED_ORDER_LINE_ITEM_BATCHES));
    }, []);

    const handleRestoreLastDeletedLineItems = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        if (!lastDeletedLineItemBatch || deletedLineItemRestoreCount === 0) {
            showTransientNotification('error', 'Chưa có sản phẩm vừa xóa để khôi phục.');
            return;
        }

        const restoreResult = restoreDeletedOrderLineItemBatch(formData.items, lastDeletedLineItemBatch.items);
        if (restoreResult.restoredLineIds.length === 0) {
            setDeletedLineItemBatches((prev) => prev.filter((batch) => batch?.id !== lastDeletedLineItemBatch.id));
            showTransientNotification('error', 'Không khôi phục được nhóm sản phẩm vừa xóa.');
            return;
        }

        closeOrderAiReplacePicker();
        closeActualProductPicker();
        setShowOrderAiInputReviewModal(false);
        setFormData((prev) => ({
            ...prev,
            items: restoreResult.items,
            cost_total: calculateItemsCostTotal(restoreResult.items),
        }));
        setDeletedLineItemBatches((prev) => {
            const latestIndex = prev.length - 1;
            if (prev[latestIndex]?.id === lastDeletedLineItemBatch.id) {
                return prev.slice(0, -1);
            }

            return prev.filter((batch) => batch?.id !== lastDeletedLineItemBatch.id);
        });
        setSelectedLineItemIds(new Set(restoreResult.restoredLineIds));
        lineItemSelectionAnchorRef.current = restoreResult.restoredLineIds[0] || '';
        lineItemSelectionDragRef.current = null;
        setSelectedOrderLineId(restoreResult.restoredLineIds[0] || '');
        showTransientNotification('success', `Đã khôi phục ${restoreResult.restoredLineIds.length} sản phẩm vừa xóa.`);
    }, [
        closeActualProductPicker,
        closeOrderAiReplacePicker,
        deletedLineItemRestoreCount,
        formData.items,
        lastDeletedLineItemBatch,
        showTransientNotification,
    ]);

    const handleRemoveSelectedLineItems = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const selectedIds = new Set(
            selectedOrderLineItems
                .map((item) => normalizeCanvasText(item?.line_id))
                .filter(Boolean)
        );
        const selectedCount = selectedIds.size;

        if (selectedCount === 0) {
            showTransientNotification('error', 'Chưa chọn sản phẩm nào để xóa.');
            return;
        }

        showModal({
            title: `Xóa ${selectedCount} sản phẩm đã chọn?`,
            content: `Thao tác này sẽ xóa ${selectedCount} dòng sản phẩm đang được tick khỏi đơn.<br/>Sau khi xóa có thể bấm nút Khôi phục xóa cạnh Nhân hệ số để lấy lại nhóm này.`,
            type: 'warning',
            actionText: 'Xóa đã chọn',
            onAction: () => {
                pushDeletedLineItemBatch(createDeletedOrderLineItemBatch(
                    formData.items,
                    (item) => selectedIds.has(normalizeCanvasText(item?.line_id))
                ));
                closeOrderAiReplacePicker();
                closeActualProductPicker();
                setShowOrderAiInputReviewModal(false);
                if (selectedCount >= formData.items.length) {
                    setShowActualProductSection(false);
                }
                setSelectedOrderLineId((prev) => (
                    selectedIds.has(normalizeCanvasText(prev)) ? '' : prev
                ));
                setEditingOrderLineName((prev) => (
                    selectedIds.has(normalizeCanvasText(prev.lineId))
                        ? { lineId: '', value: '' }
                        : prev
                ));
                setFormData((prev) => {
                    const nextItems = applySequentialOrderLineSortOrder(
                        prev.items.filter((item) => !selectedIds.has(normalizeCanvasText(item?.line_id)))
                    );

                    return {
                        ...prev,
                        items: nextItems,
                        cost_total: calculateItemsCostTotal(nextItems),
                    };
                });
                setSelectedLineItemIds(new Set());
                lineItemSelectionAnchorRef.current = '';
                lineItemSelectionDragRef.current = null;
                showTransientNotification('success', `Đã xóa ${selectedCount} sản phẩm đã chọn.`);
            },
        });
    }, [
        closeActualProductPicker,
        closeOrderAiReplacePicker,
        formData.items,
        pushDeletedLineItemBatch,
        selectedOrderLineItems,
        showModal,
        showTransientNotification,
    ]);

    const priceMultiplierTargetItems = useMemo(
        () => (
            selectedOrderLineItems.length > 0
                ? selectedOrderLineItems
                : (selectedOrderLine ? [selectedOrderLine] : [])
        ),
        [selectedOrderLine, selectedOrderLineItems]
    );
    const hasPriceMultiplierTarget = priceMultiplierTargetItems.length > 0;

    const handleOpenPriceMultiplierModal = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        if (priceMultiplierTargetItems.length === 0) {
            showTransientNotification('error', 'Tick checkbox hoặc bấm chọn 1 dòng sản phẩm để nhân hệ số.');
            return;
        }

        setShowPriceMultiplierModal(true);
    }, [priceMultiplierTargetItems.length, showTransientNotification]);

    const applyPriceMultiplier = useCallback(({ saleMultiplier, costMultiplier }) => {
        const normalizedSaleMultiplier = Number(saleMultiplier);
        const normalizedCostMultiplier = Number(costMultiplier);

        if (
            !Number.isFinite(normalizedSaleMultiplier)
            || normalizedSaleMultiplier <= 0
            || !Number.isFinite(normalizedCostMultiplier)
            || normalizedCostMultiplier <= 0
        ) {
            showTransientNotification('error', 'Hệ số giá bán và giá nhập phải lớn hơn 0.');
            return;
        }

        const selectedIds = new Set(priceMultiplierTargetItems.map((item) => item.line_id));
        const affectedCount = formData.items.filter((item) => selectedIds.has(item.line_id)).length;

        if (affectedCount === 0) {
            setShowPriceMultiplierModal(false);
            showTransientNotification('error', 'Không tìm thấy dòng sản phẩm đã chọn.');
            return;
        }

        setFormData((prev) => {
            const nextItems = prev.items.map((item) => {
                if (!selectedIds.has(item.line_id)) {
                    return item;
                }

                const nextSalePrice = Math.max(0, Math.round((parseMoneyNumber(item.price, 0) || 0) * normalizedSaleMultiplier));
                const nextCostPrice = resolveRoundedImportCostValue((parseMoneyNumber(item.cost_price, 0) || 0) * normalizedCostMultiplier, 0);
                const nextItem = {
                    ...item,
                    price: nextSalePrice,
                    cost_price: nextCostPrice,
                };

                if (!hasActualOrderProductOverride(item)) {
                    nextItem.base_cost_price = nextCostPrice;
                }

                return nextItem;
            });

            return {
                ...prev,
                items: nextItems,
                cost_total: calculateItemsCostTotal(nextItems),
            };
        });

        setSelectedLineItemIds(new Set());
        setShowPriceMultiplierModal(false);
        showTransientNotification(
            'success',
            `Đã nhân hệ số ${affectedCount} dòng: giá bán x${normalizedSaleMultiplier}, giá nhập x${normalizedCostMultiplier}.`
        );
    }, [formData.items, priceMultiplierTargetItems, showTransientNotification]);

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

    const buildReplacementDeclarationSearchParams = useCallback((term = '') => {
        const params = {
            picker: 1,
            fast_picker: 1,
            per_page: isCompactCompositeProductSearch(term) ? 160 : 60,
            quick_filter_enabled: hasActiveProductQuickFilter ? 1 : 0,
        };

        if (term) {
            params.search = term;
            params.filter_bundle_options_by_search = 1;
        }

        if (hasActiveProductQuickFilter) {
            appendProductQuickFilterParams(params, activeProductQuickFilterAttribute, normalizedProductQuickFilterValues);
            appendProductQuickFilterParams(params, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2);
        }

        appendCrossSellSourceParams(params);

        return params;
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        appendCrossSellSourceParams,
        hasActiveProductQuickFilter,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
    ]);
    const normalizeReplacementDeclarationResults = useCallback((rows = [], { excludeSource = false, excludeSelected = false } = {}) => (
        buildSourceAwareOrderAiPickerEntries(rows)
            .filter((entry) => getProductReplacementDeclarationSku(entry))
            .filter((entry) => {
                const entryKey = getActualReplacementEntryKey(entry);
                if (!entryKey) return false;
                if (excludeSource && replacementDeclarationSourceKey && entryKey === replacementDeclarationSourceKey) return false;
                if (excludeSelected && replacementDeclarationSelectedKeys.has(entryKey)) return false;
                return true;
            })
    ), [
        buildSourceAwareOrderAiPickerEntries,
        replacementDeclarationSelectedKeys,
        replacementDeclarationSourceKey,
    ]);
    const getReplacementDeclarationQuickModeRows = useCallback((term = '') => {
        const trimmedTerm = normalizeCanvasText(term);
        const latestEntryMap = new Map();
        (Array.isArray(productQuickSetupLatestEntries) ? productQuickSetupLatestEntries : []).forEach((entry) => {
            const entryKey = getProductQuickSetupEntryKey(entry);
            if (entryKey && !latestEntryMap.has(entryKey)) {
                latestEntryMap.set(entryKey, entry);
            }
        });

        const rows = buildStoredQuickSetupSearchEntries(activeProductQuickSetupItems)
            .map((entry) => latestEntryMap.get(getProductQuickSetupEntryKey(entry)) || entry)
            .filter(isProductSearchEntrySourceEnabled);
        if (!trimmedTerm) {
            return rows.slice(0, 80);
        }

        return rows
            .map((entry) => ({
                ...entry,
                __searchScore: scoreProductSearchResult(entry, trimmedTerm),
            }))
            .filter((entry) => entry.__searchScore > 0)
            .sort((left, right) => (
                right.__searchScore - left.__searchScore
                || String(left?.name || left?.display_name || '').localeCompare(String(right?.name || right?.display_name || ''), 'vi')
            ))
            .slice(0, 80);
    }, [
        activeProductQuickSetupItems,
        isProductSearchEntrySourceEnabled,
        productQuickSetupLatestEntries,
    ]);

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
            productApi.getAll(appendCrossSellSourceParams({ picker: 1, per_page: 20, search: orderAiManualSearchTerm.trim() }))
                .then((response) => {
                    if (cancelled) return;
                    setOrderAiManualSearchResults(buildSourceAwareOrderAiPickerEntries(response.data?.data || []));
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
    }, [appendCrossSellSourceParams, buildSourceAwareOrderAiPickerEntries, orderAiManualPickerLineId, orderAiManualSearchTerm]);

    useEffect(() => {
        if (!orderAiReplaceLineId || orderAiReplaceSearchTerm.trim().length < 2) {
            setOrderAiReplaceResults([]);
            setOrderAiReplaceLoading(false);
            return undefined;
        }

        let cancelled = false;
        setOrderAiReplaceLoading(true);

        const timerId = window.setTimeout(() => {
            productApi.getAll(appendCrossSellSourceParams({ picker: 1, per_page: 40, search: orderAiReplaceSearchTerm.trim() }))
                .then((response) => {
                    if (cancelled) return;
                    setOrderAiReplaceResults(buildSourceAwareOrderAiPickerEntries(response.data?.data || []));
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
    }, [appendCrossSellSourceParams, buildSourceAwareOrderAiPickerEntries, orderAiReplaceLineId, orderAiReplaceSearchTerm]);
    useEffect(() => {
        if (!orderAiReplaceLineId || orderAiReplaceActiveTab !== ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE) {
            setOrderAiReplaceWarehouseResults([]);
            setOrderAiReplaceWarehouseLoading(false);
            return undefined;
        }

        const currentLine = activeOrderAiReplaceLine;
        const canLookupDeclaredReplacements = Boolean(currentLine?.product_id || currentLine?.sku);
        const currentLineSku = getProductReplacementDeclarationSku(currentLine);
        const currentLineSkuKey = normalizeProductSearchText(currentLineSku);
        const currentLineProductId = Number(currentLine?.product_id ?? currentLine?.target_product_id ?? currentLine?.id ?? 0) || 0;
        const buildDeclaredReplacementFallbackEntries = (groups = []) => {
            if (!currentLineSkuKey) return [];

            const matchedGroup = (Array.isArray(groups) ? groups : []).find((group) => (
                (Array.isArray(group?.items) ? group.items : []).some((item) => (
                    normalizeProductSearchText(getProductReplacementDeclarationSku(item)) === currentLineSkuKey
                ))
            ));
            if (!matchedGroup) return [];

            return mergeActualProductReplacementEntries(matchedGroup.items || [])
                .map((entry) => withActualReplacementLineContext(entry, currentLine, {
                    declared: true,
                    groupId: matchedGroup.id || null,
                    lineNumber: activeOrderAiReplaceLineNumber,
                    original: normalizeProductSearchText(getProductReplacementDeclarationSku(entry)) === currentLineSkuKey,
                }));
        };

        if (!canLookupDeclaredReplacements) {
            setOrderAiReplaceWarehouseResults([]);
            setOrderAiReplaceWarehouseLoading(false);
            return undefined;
        }

        let cancelled = false;
        setOrderAiReplaceWarehouseLoading(true);

        const timerId = window.setTimeout(async () => {
            try {
                let entries = [];

                try {
                    const response = await productReplacementApi.lookup({
                        product_id: currentLineSku ? undefined : (currentLineProductId || undefined),
                        sku: currentLineSku || undefined,
                        locked_price: parseMoneyNumber(currentLine?.price, 0) || 0,
                        quantity: parseQuantityNumber(currentLine?.quantity, 1) || 1,
                    });
                    const payload = response.data?.data || {};
                    const suggestions = Array.isArray(payload.suggestions)
                        ? payload.suggestions
                        : (Array.isArray(payload.alternatives) ? payload.alternatives : []);
                    const groupId = payload.group?.id || null;
                    const sourceEntry = payload.product
                        ? withActualReplacementLineContext(payload.product, currentLine, {
                            declared: Boolean(groupId),
                            groupId,
                            original: true,
                            lineNumber: activeOrderAiReplaceLineNumber,
                        })
                        : null;
                    const replacementEntries = suggestions.map((entry) => withActualReplacementLineContext(entry, currentLine, {
                        declared: true,
                        groupId: groupId || entry?.replacement_group_id || null,
                        lineNumber: activeOrderAiReplaceLineNumber,
                    }));

                    entries = mergeActualProductReplacementEntries(sourceEntry ? [sourceEntry] : [], replacementEntries);
                } catch (error) {
                    console.error('Error fetching warehouse replacement products', error);
                }

                if (entries.length === 0 && currentLineSku) {
                    try {
                        const response = await productReplacementApi.getAll({
                            per_page: 10,
                            search: currentLineSku,
                        });
                        entries = buildDeclaredReplacementFallbackEntries(response.data?.data || []);
                    } catch (error) {
                        console.error('Error fetching warehouse replacement groups fallback', error);
                    }
                }

                if (!cancelled) {
                    setOrderAiReplaceWarehouseResults(entries);
                }
            } finally {
                if (!cancelled) {
                    setOrderAiReplaceWarehouseLoading(false);
                }
            }
        }, 80);

        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
        };
    }, [
        activeOrderAiReplaceLine,
        activeOrderAiReplaceLineNumber,
        orderAiReplaceActiveTab,
        orderAiReplaceLineId,
    ]);
    useEffect(() => {
        if (!actualProductPickerLineId) {
            setActualProductPickerResults([]);
            setActualProductPickerLoading(false);
            return undefined;
        }

        const currentLine = activeActualProductPickerLine;
        const searchTerm = actualProductPickerSearchTerm.trim();
        const isWarehousePickingMode = actualProductPickerActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE;
        const manualSearchTerm = isWarehousePickingMode ? '' : searchTerm;
        const hasSearchTerm = manualSearchTerm.length >= 2;
        const canLookupDeclaredReplacements = Boolean(currentLine?.product_id || currentLine?.sku);
        const currentLineSku = getProductReplacementDeclarationSku(currentLine);
        const currentLineSkuKey = normalizeProductSearchText(currentLineSku);
        const currentLineProductId = Number(currentLine?.product_id ?? currentLine?.target_product_id ?? currentLine?.id ?? 0) || 0;
        const buildDeclaredReplacementFallbackEntries = (groups = []) => {
            if (!currentLineSkuKey) return [];

            const matchedGroup = (Array.isArray(groups) ? groups : []).find((group) => (
                (Array.isArray(group?.items) ? group.items : []).some((item) => (
                    normalizeProductSearchText(getProductReplacementDeclarationSku(item)) === currentLineSkuKey
                ))
            ));
            if (!matchedGroup) return [];

            const entries = mergeActualProductReplacementEntries(matchedGroup.items || [])
                .map((entry) => withActualReplacementLineContext(entry, currentLine, {
                    declared: true,
                    groupId: matchedGroup.id || null,
                    lineNumber: activeActualProductPickerLineNumber,
                    original: normalizeProductSearchText(getProductReplacementDeclarationSku(entry)) === currentLineSkuKey,
                }));

            return isWarehousePickingMode
                ? entries
                : entries.filter((entry) => !entry?.is_original_order_product);
        };

        if (!canLookupDeclaredReplacements && !hasSearchTerm) {
            setActualProductPickerResults([]);
            setActualProductPickerLoading(false);
            return undefined;
        }

        let cancelled = false;
        setActualProductPickerLoading(true);

        const timerId = window.setTimeout(async () => {
            const declaredReplacementRequest = canLookupDeclaredReplacements
                ? (async () => {
                    try {
                        const response = await productReplacementApi.lookup({
                            product_id: currentLineSku ? undefined : (currentLineProductId || undefined),
                            sku: currentLineSku || undefined,
                            locked_price: parseMoneyNumber(currentLine?.price, 0) || 0,
                            quantity: parseQuantityNumber(currentLine?.quantity, 1) || 1,
                        });
                        const payload = response.data?.data || {};
                        const suggestions = Array.isArray(payload.suggestions)
                            ? payload.suggestions
                            : (Array.isArray(payload.alternatives) ? payload.alternatives : []);
                        const groupId = payload.group?.id || null;
                        const sourceEntry = isWarehousePickingMode && payload.product
                            ? withActualReplacementLineContext(payload.product, currentLine, {
                                declared: Boolean(groupId),
                                groupId,
                                original: true,
                                lineNumber: activeActualProductPickerLineNumber,
                            })
                            : null;
                        const replacementEntries = suggestions.map((entry) => withActualReplacementLineContext(entry, currentLine, {
                                declared: true,
                                groupId: groupId || entry?.replacement_group_id || null,
                                lineNumber: activeActualProductPickerLineNumber,
                            }));

                        if (sourceEntry || replacementEntries.length > 0) {
                            return mergeActualProductReplacementEntries(sourceEntry ? [sourceEntry] : [], replacementEntries);
                        }
                    } catch (error) {
                        console.error('Error fetching declared replacement products', error);
                    }

                    if (!currentLineSku) {
                        return [];
                    }

                    try {
                        const response = await productReplacementApi.getAll({
                            per_page: 10,
                            search: currentLineSku,
                        });
                        return buildDeclaredReplacementFallbackEntries(response.data?.data || []);
                    } catch (error) {
                        console.error('Error fetching declared replacement groups fallback', error);
                        return [];
                    }
                })()
                : Promise.resolve([]);
            const manualSearchRequest = hasSearchTerm
                ? productApi.getAll(appendCrossSellSourceParams({ picker: 1, per_page: 20, search: manualSearchTerm }))
                    .then((response) => buildSourceAwareOrderAiPickerEntries(response.data?.data || []))
                    .catch((error) => {
                        console.error('Error fetching actual shipped products', error);
                        return [];
                    })
                : Promise.resolve([]);

            try {
                const [declaredReplacementEntries, manualSearchEntries] = await Promise.all([
                    declaredReplacementRequest,
                    manualSearchRequest,
                ]);
                if (cancelled) return;

                setActualProductPickerResults(mergeActualProductReplacementEntries(
                    declaredReplacementEntries,
                    manualSearchEntries
                ));
            } finally {
                if (!cancelled) {
                    setActualProductPickerLoading(false);
                }
            }
        }, hasSearchTerm ? 200 : 80);

        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
        };
    }, [
        actualProductPickerActiveTab,
        actualProductPickerLineId,
        actualProductPickerSearchTerm,
        activeActualProductPickerLine,
        activeActualProductPickerLineNumber,
        appendCrossSellSourceParams,
        buildSourceAwareOrderAiPickerEntries,
    ]);
    useEffect(() => {
        if (!showReplacementDeclarationModal || !replacementDeclarationSourceKey) {
            setReplacementDeclarationGroupId(null);
            setReplacementDeclarationLookupLoading(false);
            return undefined;
        }

        replacementDeclarationLookupAbortRef.current?.abort();
        const controller = new AbortController();
        replacementDeclarationLookupAbortRef.current = controller;
        setReplacementDeclarationLookupLoading(true);
        const sourceSku = getProductReplacementDeclarationSku(replacementDeclarationSource);

        productReplacementApi.lookup({
            product_id: Number(
                sourceSku
                    ? 0
                    : (
                        replacementDeclarationSource?.target_product_id
                        ?? replacementDeclarationSource?.product_id
                        ?? replacementDeclarationSource?.id
                        ?? 0
                    )
            ) || undefined,
            sku: sourceSku || undefined,
        }, controller.signal)
            .then((response) => {
                if (controller.signal.aborted) return;
                const payload = response.data?.data || {};
                const group = payload.group || null;
                const existingEntries = Array.isArray(group?.items)
                    ? group.items
                    : (Array.isArray(payload.suggestions) ? payload.suggestions : []);
                const nextSelected = mergeActualProductReplacementEntries(existingEntries)
                    .filter((entry) => getActualReplacementEntryKey(entry) !== replacementDeclarationSourceKey)
                    .filter((entry) => getProductReplacementDeclarationSku(entry));

                setReplacementDeclarationGroupId(group?.id || null);
                setReplacementDeclarationSelected(nextSelected);
            })
            .catch((error) => {
                if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
                console.error('Error loading replacement declaration group', error);
                setReplacementDeclarationGroupId(null);
                setReplacementDeclarationSelected([]);
            })
            .finally(() => {
                if (replacementDeclarationLookupAbortRef.current === controller) {
                    replacementDeclarationLookupAbortRef.current = null;
                    setReplacementDeclarationLookupLoading(false);
                }
            });

        return () => {
            controller.abort();
        };
    }, [
        replacementDeclarationSource,
        replacementDeclarationSourceKey,
        showReplacementDeclarationModal,
    ]);
    useEffect(() => {
        const term = replacementDeclarationSourceSearchTerm.trim();
        const shouldUseQuickModeRows = showReplacementDeclarationModal
            && isProductQuickModeActive
            && !hasEnabledCrossSellSources;
        const shouldFetch = showReplacementDeclarationModal
            && (term.length >= 2 || hasActiveProductQuickFilter || shouldUseQuickModeRows);
        if (!shouldFetch) {
            replacementDeclarationSourceAbortRef.current?.abort();
            setReplacementDeclarationSourceResults([]);
            setReplacementDeclarationSourceLoading(false);
            return undefined;
        }

        if (shouldUseQuickModeRows) {
            replacementDeclarationSourceAbortRef.current?.abort();
            setReplacementDeclarationSourceResults(
                normalizeReplacementDeclarationResults(getReplacementDeclarationQuickModeRows(term))
            );
            setReplacementDeclarationSourceLoading(false);
            return undefined;
        }

        replacementDeclarationSourceAbortRef.current?.abort();
        const controller = new AbortController();
        replacementDeclarationSourceAbortRef.current = controller;
        setReplacementDeclarationSourceLoading(true);

        const timerId = window.setTimeout(() => {
            productApi.getAll(buildReplacementDeclarationSearchParams(term), controller.signal)
                .then((response) => {
                    if (controller.signal.aborted) return;
                    setReplacementDeclarationSourceResults(
                        normalizeReplacementDeclarationResults(response.data?.data || [])
                    );
                })
                .catch((error) => {
                    if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
                    console.error('Error searching replacement source products', error);
                    setReplacementDeclarationSourceResults([]);
                })
                .finally(() => {
                    if (replacementDeclarationSourceAbortRef.current === controller) {
                        replacementDeclarationSourceAbortRef.current = null;
                        setReplacementDeclarationSourceLoading(false);
                    }
                });
        }, 220);

        return () => {
            controller.abort();
            window.clearTimeout(timerId);
        };
    }, [
        buildReplacementDeclarationSearchParams,
        getReplacementDeclarationQuickModeRows,
        hasActiveProductQuickFilter,
        hasEnabledCrossSellSources,
        isProductQuickModeActive,
        normalizeReplacementDeclarationResults,
        replacementDeclarationSourceSearchTerm,
        showReplacementDeclarationModal,
    ]);
    useEffect(() => {
        const term = replacementDeclarationSearchTerm.trim();
        const shouldUseQuickModeRows = showReplacementDeclarationModal
            && Boolean(replacementDeclarationSourceKey)
            && isProductQuickModeActive
            && !hasEnabledCrossSellSources;
        const shouldFetch = showReplacementDeclarationModal
            && Boolean(replacementDeclarationSourceKey)
            && (term.length >= 2 || hasActiveProductQuickFilter || shouldUseQuickModeRows);
        if (!shouldFetch) {
            replacementDeclarationSearchAbortRef.current?.abort();
            setReplacementDeclarationResults([]);
            setReplacementDeclarationSearchLoading(false);
            return undefined;
        }

        if (shouldUseQuickModeRows) {
            replacementDeclarationSearchAbortRef.current?.abort();
            setReplacementDeclarationResults(
                normalizeReplacementDeclarationResults(getReplacementDeclarationQuickModeRows(term), {
                    excludeSource: true,
                    excludeSelected: true,
                })
            );
            setReplacementDeclarationSearchLoading(false);
            return undefined;
        }

        replacementDeclarationSearchAbortRef.current?.abort();
        const controller = new AbortController();
        replacementDeclarationSearchAbortRef.current = controller;
        setReplacementDeclarationSearchLoading(true);

        const timerId = window.setTimeout(() => {
            productApi.getAll(buildReplacementDeclarationSearchParams(term), controller.signal)
                .then((response) => {
                    if (controller.signal.aborted) return;
                    setReplacementDeclarationResults(
                        normalizeReplacementDeclarationResults(response.data?.data || [], {
                            excludeSource: true,
                            excludeSelected: true,
                        })
                    );
                })
                .catch((error) => {
                    if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
                    console.error('Error searching replacement products', error);
                    setReplacementDeclarationResults([]);
                })
                .finally(() => {
                    if (replacementDeclarationSearchAbortRef.current === controller) {
                        replacementDeclarationSearchAbortRef.current = null;
                        setReplacementDeclarationSearchLoading(false);
                    }
                });
        }, 220);

        return () => {
            controller.abort();
            window.clearTimeout(timerId);
        };
    }, [
        buildReplacementDeclarationSearchParams,
        getReplacementDeclarationQuickModeRows,
        hasActiveProductQuickFilter,
        hasEnabledCrossSellSources,
        isProductQuickModeActive,
        normalizeReplacementDeclarationResults,
        replacementDeclarationSearchTerm,
        replacementDeclarationSourceKey,
        showReplacementDeclarationModal,
    ]);
    useEffect(() => {
        if (!showReplacementDeclarationModal) {
            replacementDeclarationGroupsAbortRef.current?.abort();
            setReplacementDeclarationGroupsLoading(false);
            return undefined;
        }

        replacementDeclarationGroupsAbortRef.current?.abort();
        const controller = new AbortController();
        replacementDeclarationGroupsAbortRef.current = controller;
        const search = replacementDeclarationGroupsSearchTerm.trim();

        setReplacementDeclarationGroupsLoading(true);
        const timerId = window.setTimeout(() => {
            productReplacementApi.getAll({
                per_page: 30,
                search: search || undefined,
            }, controller.signal)
                .then((response) => {
                    if (controller.signal.aborted) return;
                    setReplacementDeclarationGroups(
                        Array.isArray(response.data?.data) ? response.data.data : []
                    );
                })
                .catch((error) => {
                    if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
                    console.error('Error loading replacement declaration groups', error);
                    setReplacementDeclarationGroups([]);
                })
                .finally(() => {
                    if (replacementDeclarationGroupsAbortRef.current === controller) {
                        replacementDeclarationGroupsAbortRef.current = null;
                        setReplacementDeclarationGroupsLoading(false);
                    }
                });
        }, search ? 220 : 80);

        return () => {
            controller.abort();
            window.clearTimeout(timerId);
        };
    }, [
        replacementDeclarationGroupsReloadKey,
        replacementDeclarationGroupsSearchTerm,
        showReplacementDeclarationModal,
    ]);

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
        const shouldApplyQuickFilter = Boolean(filterOverrides.applyQuickFilter);
        const shouldRankQuickFilter = Boolean(filterOverrides.rankQuickFilter);
        const shouldSendQuickFilterParams = shouldApplyQuickFilter || shouldRankQuickFilter;
        const params = {
            per_page: isCompactCompositeProductSearch(term) ? 200 : 100,
            picker: 1,
            fast_picker: 1,
            quick_filter_enabled: shouldApplyQuickFilter ? 1 : 0,
        };
        if (term) {
            params.search = term;
            params.filter_bundle_options_by_search = 1;
        }
        if (shouldRankQuickFilter && !shouldApplyQuickFilter) {
            params.quick_filter_rank = 1;
        }

        if (shouldSendQuickFilterParams) {
            const activeFilterAttribute = filterOverrides.attribute || activeProductQuickFilterAttribute;
            const activeFilterValues = Array.isArray(filterOverrides.values)
                ? filterOverrides.values.map(normalizeQuickFilterOptionValue).filter(Boolean)
                : normalizedProductQuickFilterValues;

            appendProductQuickFilterParams(params, activeFilterAttribute, activeFilterValues);
            appendProductQuickFilterParams(params, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2);
        }
        appendCrossSellSourceParams(params);

        const activeAccountId = typeof window === 'undefined'
            ? 'default'
            : (window.localStorage.getItem('activeAccountId') || 'default');
        const cacheKey = JSON.stringify({ account_id: activeAccountId, ...params });
        productSearchRequestKeyRef.current = cacheKey;
        productSearchAbortRef.current?.abort();
        const shouldUseProductSearchCache = normalizeCanvasText(term) === '';

        if (shouldUseProductSearchCache && productSearchCacheRef.current.has(cacheKey)) {
            const cachedProducts = productSearchCacheRef.current.get(cacheKey);
            setProducts(cachedProducts);
            return;
        }

        const controller = new AbortController();
        productSearchAbortRef.current = controller;
        setProducts([]);

        try {
            const prodRes = await productApi.getAll(params, controller.signal);
            if (controller.signal.aborted || productSearchRequestKeyRef.current !== cacheKey) return;

            const nextProducts = Array.isArray(prodRes.data.data)
                ? prodRes.data.data.map((product) => ({
                    ...normalizeProductPickerEntry(product),
                    server_search_match: normalizeCanvasText(term) !== '',
                }))
                : [];
            if (shouldUseProductSearchCache) {
                productSearchCacheRef.current.set(cacheKey, nextProducts);
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
        appendCrossSellSourceParams,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
    ]);
    const handleSelectReplacementDeclarationSource = useCallback((entry) => {
        const sourceEntry = normalizeProductPickerEntry(entry);
        if (!sourceEntry || !getProductReplacementDeclarationSku(sourceEntry)) {
            showTransientNotification('error', 'Sản phẩm gốc cần có mã SKU để khai báo thay thế.');
            return;
        }

        setReplacementDeclarationSource(sourceEntry);
        setReplacementDeclarationGroupId(null);
        setReplacementDeclarationSelected([]);
        setReplacementDeclarationSourceSearchTerm('');
        setReplacementDeclarationSourceResults([]);
        setReplacementDeclarationSearchTerm('');
        setReplacementDeclarationResults([]);
    }, [showTransientNotification]);
    const handleAddReplacementDeclarationProduct = useCallback((entry) => {
        const replacementEntry = normalizeProductPickerEntry(entry);
        const sku = getProductReplacementDeclarationSku(replacementEntry);
        const entryKey = getActualReplacementEntryKey(replacementEntry);
        if (!sku || !entryKey) {
            showTransientNotification('error', 'Sản phẩm thay thế cần có mã SKU.');
            return;
        }

        if (entryKey === replacementDeclarationSourceKey) {
            showTransientNotification('error', 'Mã thay thế phải khác mã sản phẩm gốc.');
            return;
        }

        setReplacementDeclarationSelected((prev) => (
            prev.some((item) => getActualReplacementEntryKey(item) === entryKey)
                ? prev
                : [...prev, replacementEntry]
        ));
        setReplacementDeclarationSearchTerm('');
        setReplacementDeclarationResults([]);
    }, [replacementDeclarationSourceKey, showTransientNotification]);
    const handleRemoveReplacementDeclarationProduct = useCallback((entryKey) => {
        const normalizedKey = normalizeCanvasText(entryKey);
        setReplacementDeclarationSelected((prev) => (
            prev.filter((entry) => getActualReplacementEntryKey(entry) !== normalizedKey)
        ));
    }, []);
    const handleEditReplacementDeclarationGroup = useCallback((group) => {
        const groupEntries = mergeActualProductReplacementEntries(group?.items || [])
            .filter((entry) => getProductReplacementDeclarationSku(entry));
        if (groupEntries.length < 2) {
            showTransientNotification('error', 'Nhóm này chưa đủ 2 mã sản phẩm để sửa nhanh.');
            return;
        }

        const nextSource = groupEntries[0];
        setReplacementDeclarationSource(nextSource);
        setReplacementDeclarationGroupId(group?.id || null);
        setReplacementDeclarationSelected(groupEntries.slice(1));
        setReplacementDeclarationSourceSearchTerm('');
        setReplacementDeclarationSourceResults([]);
        setReplacementDeclarationSearchTerm('');
        setReplacementDeclarationResults([]);
        setReplacementDeclarationLookupLoading(false);
    }, [showTransientNotification]);
    const handleSaveReplacementDeclaration = useCallback(async (eventOrOptions = {}) => {
        eventOrOptions?.preventDefault?.();
        const closeAfterSave = eventOrOptions?.closeAfterSave === true;
        const sourceSku = getProductReplacementDeclarationSku(replacementDeclarationSource);
        const selectedSkus = replacementDeclarationSelectedSkus;
        const skus = Array.from(new Set([sourceSku, ...selectedSkus].map(normalizeCanvasText).filter(Boolean)));

        if (skus.length < 2) {
            showTransientNotification('error', 'Chọn ít nhất 1 sản phẩm thay thế khác mã gốc.');
            return;
        }

        setReplacementDeclarationSaving(true);
        try {
            const payload = { skus };
            let response;
            if (replacementDeclarationGroupId) {
                response = await productReplacementApi.update(replacementDeclarationGroupId, payload);
            } else {
                response = await productReplacementApi.create(payload);
            }
            const savedGroup = response?.data?.data || null;
            if (savedGroup?.id) {
                const currentSourceKey = getActualReplacementEntryKey(replacementDeclarationSource);
                const savedEntries = mergeActualProductReplacementEntries(savedGroup.items || [])
                    .filter((entry) => getProductReplacementDeclarationSku(entry));
                setReplacementDeclarationGroupId(savedGroup.id);
                if (savedEntries.length > 0 && currentSourceKey) {
                    setReplacementDeclarationSelected(
                        savedEntries.filter((entry) => getActualReplacementEntryKey(entry) !== currentSourceKey)
                    );
                }
            }

            showTransientNotification('success', 'Đã lưu khai báo sản phẩm thay thế.');
            setReplacementDeclarationGroupsReloadKey((prev) => prev + 1);
            if (closeAfterSave) {
                closeReplacementDeclarationModal();
            }
        } catch (error) {
            console.error('Error saving product replacements from order form', error);
            showTransientNotification(
                'error',
                resolveApiErrorMessage(error, 'Không thể lưu khai báo sản phẩm thay thế.'),
                3200
            );
        } finally {
            setReplacementDeclarationSaving(false);
        }
    }, [
        closeReplacementDeclarationModal,
        replacementDeclarationGroupId,
        replacementDeclarationSelectedSkus,
        replacementDeclarationSource,
        showTransientNotification,
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
        productSearchCacheRef.current.clear();
        setProducts([]);

        setShowProductQuickFilterPanel(true);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const handleProductQuickFilterAttributeChange2 = useCallback((nextAttributeId) => {
        setProductQuickFilterAttributeId2(nextAttributeId);
        setProductQuickFilterValues2([]);
        productSearchCacheRef.current.clear();
        setProducts([]);
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
        productSearchCacheRef.current.clear();
        setProducts([]);

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
        productSearchCacheRef.current.clear();
        setProducts([]);
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
        setProductQuickModeEnabled(productQuickModeDefaultEnabled);
        setShowProductQuickFilterPanel(false);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
        productSearchCacheRef.current.clear();
        setProducts([]);

        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(productQuickFilterStorageKey);
            window.localStorage.removeItem(productQuickFilterAttributeStorageKey);
            window.localStorage.removeItem(productQuickFilterAttribute2MapStorageKey);
        }
    }, [productQuickFilterStorageKey, productQuickModeDefaultEnabled]);
    const handleReplacementDeclarationQuickFilterAttributeChange = useCallback((nextAttributeId) => {
        setProductQuickFilterAttributeId(nextAttributeId);
        setProductQuickFilterValues([]);
        setProductQuickFilterValues2([]);
        setProductQuickFilterAttributeId2('');
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
    }, []);
    const handleReplacementDeclarationQuickFilterAttributeChange2 = useCallback((nextAttributeId) => {
        setProductQuickFilterAttributeId2(nextAttributeId);
        setProductQuickFilterValues2([]);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
    }, []);
    const toggleReplacementDeclarationQuickFilterValue = useCallback((value) => {
        const normalizedValue = normalizeQuickFilterOptionValue(value);
        if (!normalizedValue) return;

        const nextValues = normalizedProductQuickFilterValues[0] === normalizedValue ? [] : [normalizedValue];
        setProductQuickFilterValues(nextValues);
        if (nextValues.length === 0) {
            setProductQuickFilterValues2([]);
            setProductQuickFilterAttributeId2('');
        }
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
    }, [normalizedProductQuickFilterValues]);
    const toggleReplacementDeclarationQuickFilterValue2 = useCallback((value) => {
        const normalizedValue = normalizeQuickFilterOptionValue(value);
        if (!normalizedValue) return;

        setProductQuickFilterValues2(
            normalizedProductQuickFilterValues2[0] === normalizedValue ? [] : [normalizedValue]
        );
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
    }, [normalizedProductQuickFilterValues2]);
    const clearReplacementDeclarationQuickFilterValues = useCallback(() => {
        setProductQuickFilterValues([]);
        setProductQuickFilterValues2([]);
        setProductQuickFilterAttributeId2('');
        setProductQuickModeEnabled(productQuickModeDefaultEnabled);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
        setShowProductQuickSetupPanel(false);
        setShowProductQuickFilterPanel(false);
        productSearchCacheRef.current.clear();
    }, [productQuickModeDefaultEnabled]);

    const saveCurrentProductQuickSetupItems = useCallback((items) => {
        if (!currentProductQuickSetupKey || !productQuickSetupNamespace) return;

        const normalizedItems = normalizeStoredProductQuickSetupItems(items);

        setProductQuickSetupStore((prev) => {
            const next = { ...prev };
            const nextNamespaceStore = { ...(next[productQuickSetupNamespace] || {}) };

            if (normalizedItems.length > 0) {
                nextNamespaceStore[currentProductQuickSetupKey] = normalizedItems;
                next[productQuickSetupNamespace] = nextNamespaceStore;
                return next;
            }

            delete nextNamespaceStore[currentProductQuickSetupKey];
            if (Object.keys(nextNamespaceStore).length > 0) {
                next[productQuickSetupNamespace] = nextNamespaceStore;
            } else {
                delete next[productQuickSetupNamespace];
            }

            return next;
        });
    }, [currentProductQuickSetupKey, productQuickSetupNamespace]);

    const syncLatestQuickSetupEntriesIntoActiveStore = useCallback((latestEntries = [], options = {}) => {
        if (!activeProductQuickSetupKey || !productQuickSetupNamespace) return;

        const shouldPruneMissing = Boolean(options?.pruneMissing);
        const latestEntryMap = new Map();
        (Array.isArray(latestEntries) ? latestEntries : []).forEach((entry) => {
            const entryKey = getProductQuickSetupEntryKey(entry);
            if (entryKey && !latestEntryMap.has(entryKey)) {
                latestEntryMap.set(entryKey, entry);
            }
        });

        if (latestEntryMap.size === 0 && !shouldPruneMissing) return;

        setProductQuickSetupStore((prev) => {
            const namespaceStore = prev?.[productQuickSetupNamespace] || {};
            const currentItems = Array.isArray(namespaceStore?.[activeProductQuickSetupKey])
                ? namespaceStore[activeProductQuickSetupKey]
                : [];
            if (currentItems.length === 0) return prev;

            const normalizedCurrentItems = normalizeStoredProductQuickSetupItems(currentItems);
            const nextItems = normalizeStoredProductQuickSetupItems(
                normalizedCurrentItems.map((item) => {
                    const latestEntry = latestEntryMap.get(getProductQuickSetupEntryKey(item));
                    if (!latestEntry && shouldPruneMissing) {
                        return null;
                    }

                    return latestEntry || item;
                }).filter(Boolean)
            );

            if (JSON.stringify(normalizedCurrentItems) === JSON.stringify(nextItems)) {
                return prev;
            }

            if (nextItems.length === 0) {
                return {
                    ...prev,
                    [productQuickSetupNamespace]: {
                        ...namespaceStore,
                        [activeProductQuickSetupKey]: [],
                    },
                };
            }

            return {
                ...prev,
                [productQuickSetupNamespace]: {
                    ...namespaceStore,
                    [activeProductQuickSetupKey]: nextItems,
                },
            };
        });
    }, [activeProductQuickSetupKey, productQuickSetupNamespace]);

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
            ...currentProductQuickSetupItems,
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
                ...resolveProductSourceFields(product),
                main_image: product.main_image,
                type: product.type,
                entry_kind: entryKind,
                parent_product_id: Number(product?.parent_product_id ?? 0) || null,
                parent_product_name: product.parent_product_name ?? '',
                option_label: product.option_label ?? '',
                ...(entryKind === SEARCH_ENTRY_BUNDLE_OPTION ? {
                    bundle_parent_id: Number(product?.bundle_parent_id ?? targetProductId) || targetProductId,
                    bundle_parent_name: product.bundle_parent_name ?? product.parent_product_name ?? product.name ?? '',
                    bundle_option_uid: product.bundle_option_uid ?? product.uid ?? product.option_uid ?? '',
                    bundle_option_key: product.bundle_option_key ?? resolveBundleOptionKey(product),
                    bundle_option_title: product.bundle_option_title ?? resolveBundleOptionTitle(product),
                    raw_bundle_option_title: product.raw_bundle_option_title ?? product.option_title ?? '',
                    bundle_option_status: product.bundle_option_status ?? 'visible',
                    bundle_title: product.bundle_title ?? product.bundle_config_title ?? '',
                    bundle_config_title: product.bundle_config_title ?? product.bundle_title ?? '',
                    bundle_option_total_price: resolveMoneyValue(product?.bundle_option_total_price, product?.price, 0),
                    bundle_option_discounted_price: resolveMoneyValue(product?.bundle_option_discounted_price, product?.price, 0),
                    option_post_id: Number(product?.option_post_id) || undefined,
                    option_post_title: product.option_post_title ?? '',
                    bundle_items: normalizeStoredProductQuickSetupBundleItems(product.bundle_items),
                    bundle_item_count: Number(product?.bundle_item_count) || undefined,
                    bundle_quantity_total: Number(product?.bundle_quantity_total) || undefined,
                } : {}),
            },
        ]);

        saveCurrentProductQuickSetupItems(nextItems);
        if (productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL) {
            setProductQuickModeEnabled(false);
            setManualProductQuickModeEnabled(true);
        } else {
            setManualProductQuickModeEnabled(false);
            setProductQuickModeEnabled(true);
        }
    }, [currentProductQuickSetupItems, productQuickSetupMode, saveCurrentProductQuickSetupItems]);

    const handleRemoveProductFromQuickSetup = useCallback((entryKey) => {
        const normalizedEntryKey = String(entryKey ?? '').trim();
        if (!normalizedEntryKey) return;

        saveCurrentProductQuickSetupItems(
            currentProductQuickSetupItems.filter((item) => getProductQuickSetupEntryKey(item) !== normalizedEntryKey)
        );
    }, [currentProductQuickSetupItems, saveCurrentProductQuickSetupItems]);

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

        if (!productQuickModeEnabled) {
            setManualProductQuickModeEnabled(false);
        }
        setProductQuickModeEnabled((prev) => !prev);
        productSearchCacheRef.current.clear();
        setProducts([]);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, [isProductQuickModeToggleDisabled, productQuickModeEnabled]);

    const disableProductQuickMode = useCallback((event) => {
        event?.stopPropagation?.();
        setProductQuickModeEnabled(false);
        productSearchCacheRef.current.clear();
        setProducts([]);
        setShowProductQuickSetupPanel(false);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const toggleProductQuickSetupPanel = useCallback((event) => {
        event?.stopPropagation?.();
        if (showProductQuickSetupPanel) {
            flushProductQuickSettingsNow();
        }
        setProductQuickSetupMode(PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE);
        setShowProductQuickSetupPanel((prev) => !prev);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
    }, [flushProductQuickSettingsNow, showProductQuickSetupPanel]);

    const toggleManualProductQuickSetupPanel = useCallback((event) => {
        event?.stopPropagation?.();
        if (showProductQuickSetupPanel) {
            flushProductQuickSettingsNow();
        }
        setProductQuickSetupMode(PRODUCT_QUICK_SETUP_MODE_MANUAL);
        setShowProductQuickSetupPanel((prev) => (
            productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL ? !prev : true
        ));
        setProductQuickSetupSearchTerm((currentTerm) => (
            normalizeCanvasText(currentTerm) || normalizeCanvasText(searchTerm)
        ));
        setShowCrossSellSourceDropdown(false);
        setShowSearchDropdown(false);
        setShowSearchHistory(false);
    }, [flushProductQuickSettingsNow, productQuickSetupMode, searchTerm, showProductQuickSetupPanel]);

    const saveAndCloseProductQuickSetupPanel = useCallback((event) => {
        event?.stopPropagation?.();
        setShowProductQuickSetupPanel(false);
        flushProductQuickSettingsNow();
    }, [flushProductQuickSettingsNow]);

    const toggleManualProductQuickMode = useCallback((event) => {
        event?.stopPropagation?.();
        if (isManualProductQuickModeToggleDisabled) return;

        if (!manualProductQuickModeEnabled) {
            setProductQuickModeEnabled(false);
        }
        setManualProductQuickModeEnabled((prev) => !prev);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, [isManualProductQuickModeToggleDisabled, manualProductQuickModeEnabled]);

    const disableManualProductQuickMode = useCallback((event) => {
        event?.stopPropagation?.();
        setManualProductQuickModeEnabled(false);
        setShowSearchDropdown(true);
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
        appendCrossSellSourceParams(params);

        const activeAccountId = typeof window === 'undefined'
            ? 'default'
            : (window.localStorage.getItem('activeAccountId') || 'default');
        const cacheKey = JSON.stringify({
            quick_filter_scope: true,
            account_id: activeAccountId,
            scope_key: activeProductQuickFilterScopeKey,
            ...params,
        });
        productQuickFilterScopeAbortRef.current?.abort();

        const cachedProducts = productQuickFilterScopeCacheRef.current.get(cacheKey);
        if (cachedProducts) {
            setProductQuickFilterScopeProducts(cachedProducts);
            setProductQuickFilterScopeKey(activeProductQuickFilterScopeKey);
            return;
        }

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
        appendCrossSellSourceParams,
        normalizedProductQuickFilterValues,
    ]);

    const fetchProductQuickSetupProducts = useCallback(async (term = '') => {
        const isManualQuickSetup = productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL;
        const activeFilterAttribute = activeProductQuickFilterAttribute;
        const activeFilterValue = normalizedProductQuickFilterValues[0];
        if (!isManualQuickSetup && (!activeFilterAttribute || !activeFilterValue)) {
            setProductQuickSetupProducts([]);
            setProductQuickSetupLoading(false);
            return;
        }

        const params = {
            per_page: 200,
            picker: 1,
            quick_filter_enabled: isManualQuickSetup ? 0 : 1,
        };
        if (isManualQuickSetup) {
            params.fast_picker = 1;
        } else {
            appendProductQuickFilterParams(params, activeFilterAttribute, [activeFilterValue]);
            appendProductQuickFilterParams(params, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2);
        }
        appendCrossSellSourceParams(params);

        if (term) {
            params.search = term;
            params.filter_bundle_options_by_search = 1;
        }

        const activeAccountId = typeof window === 'undefined'
            ? 'default'
            : (window.localStorage.getItem('activeAccountId') || 'default');
        const cacheKey = JSON.stringify({
            quick_setup: true,
            quick_setup_mode: productQuickSetupMode,
            account_id: activeAccountId,
            ...params,
        });
        productQuickSetupAbortRef.current?.abort();

        const cachedProducts = productQuickSetupCacheRef.current.get(cacheKey);
        if (cachedProducts) {
            setProductQuickSetupProducts(cachedProducts);
            setProductQuickSetupLoading(false);
            return;
        }

        const controller = new AbortController();
        productQuickSetupAbortRef.current = controller;
        setProductQuickSetupLoading(true);
        let partialProducts = [];

        try {
            const firstResponse = await productApi.getAll(params, controller.signal);
            if (controller.signal.aborted) return;

            const allRows = Array.isArray(firstResponse.data.data)
                ? [...firstResponse.data.data]
                : [];
            const lastPage = Math.max(1, Number(firstResponse.data.last_page) || 1);
            partialProducts = buildProductQuickSetupEntries(allRows);
            setProductQuickSetupProducts(partialProducts);

            const remainingPages = Array.from(
                { length: Math.max(0, lastPage - 1) },
                (_, index) => index + 2
            );
            const pageBatchSize = 4;

            for (let pageIndex = 0; pageIndex < remainingPages.length; pageIndex += pageBatchSize) {
                const pageBatch = remainingPages.slice(pageIndex, pageIndex + pageBatchSize);
                const pageResponses = await Promise.all(
                    pageBatch.map((page) => productApi.getAll({ ...params, page }, controller.signal))
                );

                if (controller.signal.aborted) return;

                pageResponses.forEach((pageResponse) => {
                    if (Array.isArray(pageResponse.data.data)) {
                        allRows.push(...pageResponse.data.data);
                    }
                });

                partialProducts = buildProductQuickSetupEntries(allRows);
                setProductQuickSetupProducts(partialProducts);
            }

            productQuickSetupCacheRef.current.set(cacheKey, partialProducts);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
            console.error('Error fetching quick setup products', error);
            setProductQuickSetupProducts(partialProducts);
        } finally {
            if (productQuickSetupAbortRef.current === controller) {
                productQuickSetupAbortRef.current = null;
                setProductQuickSetupLoading(false);
            }
        }
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        appendCrossSellSourceParams,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
        productQuickSetupMode,
    ]);

    useEffect(() => {
        productQuickSetupRefreshAbortRef.current?.abort();

        if (!isProductQuickModeActive) {
            setProductQuickSetupLatestEntries([]);
            setProductQuickSetupLatestEntriesScopeKey('');
            return undefined;
        }

        let refreshTargets = [];
        try {
            refreshTargets = JSON.parse(activeProductQuickSetupRefreshKey);
        } catch (error) {
            refreshTargets = [];
        }

        const selectedProductIds = Array.from(new Set(
            (Array.isArray(refreshTargets) ? refreshTargets : [])
                .map((target) => Number(target?.productId) || 0)
                .filter((productId) => productId > 0)
        ));
        const selectedSourceAccountIds = Array.from(new Set(
            (Array.isArray(refreshTargets) ? refreshTargets : [])
                .map((target) => normalizeAccountId(target?.product_source_account_id ?? target?.source_account_id))
                .filter(Boolean)
        ));
        const activeEntryKeys = new Set(
            (Array.isArray(refreshTargets) ? refreshTargets : [])
                .map((target) => normalizeCanvasText(target?.entryKey))
                .filter(Boolean)
        );

        if (selectedProductIds.length === 0 || activeEntryKeys.size === 0) {
            setProductQuickSetupLatestEntries([]);
            setProductQuickSetupLatestEntriesScopeKey(activeProductQuickSetupRefreshScopeKey);
            return undefined;
        }

        const controller = new AbortController();
        productQuickSetupRefreshAbortRef.current = controller;

        const refreshQuickSetupEntries = async () => {
            try {
                const sourceAccountIds = Array.from(new Set([
                    ...enabledCrossSellAccountIds.map(normalizeAccountId),
                    ...selectedSourceAccountIds,
                ].filter(Boolean)));
                const params = {
                    picker: 1,
                    fast_picker: 1,
                    quick_filter_enabled: hasActiveProductQuickFilter ? 1 : 0,
                    allow_variants: 1,
                    selected_ids: selectedProductIds.join(','),
                    per_page: Math.min(Math.max(selectedProductIds.length, 1), 200),
                };
                if (hasActiveProductQuickFilter) {
                    appendProductQuickFilterParams(params, activeProductQuickFilterAttribute, normalizedProductQuickFilterValues);
                    appendProductQuickFilterParams(params, activeProductQuickFilterAttribute2, normalizedProductQuickFilterValues2);
                }
                if (sourceAccountIds.length > 0) {
                    params.source_account_ids = sourceAccountIds.join(',');
                }

                const response = await productApi.getAll(params, controller.signal);
                if (controller.signal.aborted) return;

                const latestEntries = Array.isArray(response.data.data)
                    ? buildProductQuickSetupEntries(response.data.data)
                        .filter((entry) => activeEntryKeys.has(getProductQuickSetupEntryKey(entry)))
                    : [];

                setProductQuickSetupLatestEntries(latestEntries);
                setProductQuickSetupLatestEntriesScopeKey(activeProductQuickSetupRefreshScopeKey);
                syncLatestQuickSetupEntriesIntoActiveStore(latestEntries, { pruneMissing: hasActiveProductQuickFilter });
            } catch (error) {
                if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
                console.error('Error refreshing quick setup bundle entries', error);
                setProductQuickSetupLatestEntries([]);
                setProductQuickSetupLatestEntriesScopeKey(activeProductQuickSetupRefreshScopeKey);
            } finally {
                if (productQuickSetupRefreshAbortRef.current === controller) {
                    productQuickSetupRefreshAbortRef.current = null;
                }
            }
        };

        refreshQuickSetupEntries();

        return () => {
            controller.abort();
        };
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        activeProductQuickSetupRefreshKey,
        activeProductQuickSetupRefreshScopeKey,
        enabledCrossSellAccountIds,
        hasActiveProductQuickFilter,
        isProductQuickModeActive,
        normalizedProductQuickFilterValues,
        normalizedProductQuickFilterValues2,
        syncLatestQuickSetupEntriesIntoActiveStore,
    ]);

    const storedQuickModeSearchEntries = useMemo(
        () => buildStoredQuickSetupSearchEntries(activeProductQuickSetupItems),
        [activeProductQuickSetupItems]
    );
    const latestQuickModeEntryMap = useMemo(() => {
        const entryMap = new Map();
        (Array.isArray(productQuickSetupLatestEntries) ? productQuickSetupLatestEntries : []).forEach((entry) => {
            const entryKey = getProductQuickSetupEntryKey(entry);
            if (entryKey && !entryMap.has(entryKey)) {
                entryMap.set(entryKey, entry);
            }
        });
        return entryMap;
    }, [productQuickSetupLatestEntries]);
    const isProductQuickSetupLatestScopeReady = productQuickSetupLatestEntriesScopeKey === activeProductQuickSetupRefreshScopeKey;
    const quickModeSearchEntries = useMemo(() => {
        if (!isProductQuickSetupLatestScopeReady) {
            return [];
        }

        if (latestQuickModeEntryMap.size === 0 && !hasActiveProductQuickFilter) {
            return storedQuickModeSearchEntries.filter(isProductSearchEntrySourceEnabled);
        }

        const entries = storedQuickModeSearchEntries
            .map((entry) => latestQuickModeEntryMap.get(getProductQuickSetupEntryKey(entry)))
            .filter(Boolean);

        return entries.filter(isProductSearchEntrySourceEnabled);
    }, [
        hasActiveProductQuickFilter,
        isProductQuickSetupLatestScopeReady,
        isProductSearchEntrySourceEnabled,
        latestQuickModeEntryMap,
        storedQuickModeSearchEntries,
    ]);
    const manualQuickModeSearchEntries = useMemo(() => (
        buildStoredQuickSetupSearchEntries(manualProductQuickSetupItems)
            .filter(isProductSearchEntrySourceEnabled)
    ), [isProductSearchEntrySourceEnabled, manualProductQuickSetupItems]);
    const shouldRankInactiveProductQuickFilters = !isProductQuickModeActive
        && !isManualProductQuickModeActive
        && activeProductQuickFilterRankCriteria.length > 0;

    const rankedSearchProducts = useMemo(() => {
        const quickFilterRankCriteria = shouldRankInactiveProductQuickFilters
            ? activeProductQuickFilterRankCriteria
            : [];
        const shouldUseManualQuickModeEntries = isManualProductQuickModeActive;
        const shouldUseQuickModeEntries = !shouldUseManualQuickModeEntries
            && isProductQuickModeActive
            && !hasEnabledCrossSellSources;
        const serverSearchEntries = buildProductSearchEntries(products, {
            includeNested: Boolean(searchTerm.trim()),
        });
        const searchableEntries = shouldUseManualQuickModeEntries
            ? manualQuickModeSearchEntries
            : shouldUseQuickModeEntries
            ? (
                searchTerm.trim()
                    ? mergeProductSearchEntryLists(quickModeSearchEntries, serverSearchEntries)
                    : quickModeSearchEntries
            )
            : serverSearchEntries;
        const preparedProducts = searchableEntries
            .map((product) => ({
                ...product,
                __alreadyInOrder: isSearchEntryAlreadyInOrder(formData.items, product),
            }))
            .filter((product) => (
                shouldUseManualQuickModeEntries || shouldUseQuickModeEntries
                    ? buildOrderItemsFromSearchEntry(product).length > 0
                    : canAddSearchEntry(formData.items, product)
            ));

        if (!searchTerm.trim()) {
            if (quickFilterRankCriteria.length === 0) {
                return preparedProducts.slice(0, 50);
            }

            return preparedProducts
                .map((product) => ({
                    ...product,
                    __quickFilterScore: scoreProductQuickFilterPriority(product, quickFilterRankCriteria),
                }))
                .sort((left, right) => (
                    right.__quickFilterScore - left.__quickFilterScore
                    || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
                ))
                .slice(0, 50);
        }

        return preparedProducts
            .map((product) => {
                const searchScore = scoreProductSearchResult(product, searchTerm);
                const serverMatchedSearch = Boolean(product?.server_search_match || product?.__server_search_match);

                return {
                    ...product,
                    __searchScore: serverMatchedSearch ? Math.max(searchScore, 1) : searchScore,
                    __quickFilterScore: searchScore > 0
                        ? scoreProductQuickFilterPriority(product, quickFilterRankCriteria)
                        : 0,
                };
            })
            .filter((product) => product.__searchScore > 0)
            .sort((left, right) => (
                right.__quickFilterScore - left.__quickFilterScore
                || right.__searchScore - left.__searchScore
                || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
            ))
            .slice(0, 50);
    }, [
        activeProductQuickFilterRankCriteria,
        formData.items,
        hasEnabledCrossSellSources,
        isManualProductQuickModeActive,
        isProductQuickModeActive,
        manualQuickModeSearchEntries,
        products,
        quickModeSearchEntries,
        searchTerm,
        shouldRankInactiveProductQuickFilters,
    ]);

    const productSearchEmptyMessage = useMemo(() => {
        const hasSearchText = searchTerm.trim() !== '';

        if (isManualProductQuickModeActive && hasSearchText) {
            return 'Kh\u00f4ng c\u00f3 s\u1ea3n ph\u1ea9m trong DS nhanh th\u1ee7 c\u00f4ng kh\u1edbp t\u1eeb kh\u00f3a hi\u1ec7n t\u1ea1i.';
        }

        if (isManualProductQuickModeActive) {
            return 'DS nhanh th\u1ee7 c\u00f4ng \u0111ang b\u1eadt nh\u01b0ng ch\u01b0a c\u00f3 s\u1ea3n ph\u1ea9m kh\u1ea3 d\u1ee5ng.';
        }

        if (isProductQuickModeActive && hasSearchText) {
            return 'Không có sản phẩm trong lọc nhanh khớp từ khóa hiện tại.';
        }

        if (isProductQuickModeActive) {
            return 'Bộ lọc nhanh đang bật nhưng danh sách đã lưu không còn sản phẩm khả dụng.';
        }

        if (hasSearchText) {
            return 'Không có sản phẩm khớp từ khóa hiện tại.';
        }

        return 'Không có sản phẩm khả dụng để hiển thị.';
    }, [isManualProductQuickModeActive, isProductQuickModeActive, searchTerm]);

    const shouldShowProductSearchEmptyState = rankedSearchProducts.length === 0
        && (searchTerm.trim() !== '' || isProductQuickModeActive || isManualProductQuickModeActive);

    useEffect(() => {
        const timerId = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            clearTimeout(timerId);
        };
    }, [searchTerm]);

    useEffect(() => {
        if (searchTerm !== debouncedSearchTerm) {
            setProducts([]);
        }
    }, [debouncedSearchTerm, searchTerm]);

    useEffect(() => {
        const timerId = setTimeout(() => {
            setDebouncedProductQuickSetupSearchTerm(productQuickSetupSearchTerm);
        }, 250);

        return () => {
            clearTimeout(timerId);
        };
    }, [productQuickSetupSearchTerm]);

    useEffect(() => {
        if (isManualProductQuickModeActive) return;
        const hasSearchText = debouncedSearchTerm.trim() !== '';
        if (isProductQuickModeActive && !hasEnabledCrossSellSources && !hasSearchText) return;

        if (showSearchDropdown || debouncedSearchTerm.trim() !== '') {
            fetchProducts(debouncedSearchTerm, {
                applyQuickFilter: isProductQuickModeActive && hasActiveProductQuickFilter,
                rankQuickFilter: shouldRankInactiveProductQuickFilters,
            });
        }
    }, [
        fetchProducts,
        debouncedSearchTerm,
        enabledCrossSellSourceParam,
        hasActiveProductQuickFilter,
        hasEnabledCrossSellSources,
        isManualProductQuickModeActive,
        isProductQuickModeActive,
        shouldRankInactiveProductQuickFilters,
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
            || (showProductQuickSetupPanel && productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE)
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
        productQuickSetupMode,
        showProductQuickSetupPanel,
        showSearchDropdown,
    ]);

    useEffect(() => {
        const canUseCurrentQuickSetupPanel = productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL
            || hasActiveProductQuickFilter;

        if (!showProductQuickSetupPanel || !canUseCurrentQuickSetupPanel) {
            setProductQuickSetupProducts([]);
            setProductQuickSetupLoading(false);
            return;
        }

        fetchProductQuickSetupProducts(debouncedProductQuickSetupSearchTerm);
    }, [
        debouncedProductQuickSetupSearchTerm,
        fetchProductQuickSetupProducts,
        hasActiveProductQuickFilter,
        productQuickSetupMode,
        showProductQuickSetupPanel,
    ]);

    useEffect(() => {
        if (!showSearchDropdown || debouncedSearchTerm.trim().length < 2) return;
        pushSearchHistory(debouncedSearchTerm);
    }, [debouncedSearchTerm, pushSearchHistory, showSearchDropdown]);

    useEffect(() => {
        if (persistProductQuickSetupStore(productQuickSetupStore)) {
            flushProductQuickSettingsNow();
        }
    }, [flushProductQuickSettingsNow, productQuickSetupStore]);

    useEffect(() => {
        if (!hasActiveProductQuickFilter) {
            lastVisitedProductQuickSetupKeyRef.current = '';
            if (productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE) {
                setShowProductQuickSetupPanel(false);
            }
            setProductQuickSetupSearchTerm('');
            setProductQuickSetupProducts([]);
            setProductQuickSetupLoading(false);
            return;
        }

        if (
            productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE
            && lastVisitedProductQuickSetupKeyRef.current !== activeProductQuickSetupKey
        ) {
            lastVisitedProductQuickSetupKeyRef.current = activeProductQuickSetupKey;
            setShowProductQuickSetupPanel(false);
            return;
        }
    }, [
        activeProductQuickSetupKey,
        hasActiveProductQuickFilter,
        productQuickSetupMode,
    ]);

    useEffect(() => {
        if (productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL) {
            setProductQuickSetupSearchTerm(normalizeCanvasText(searchTerm));
            setProductQuickSetupProducts([]);
            setProductQuickSetupLoading(false);
            return;
        }

        setProductQuickSetupSearchTerm('');
        setProductQuickSetupProducts([]);
        setProductQuickSetupLoading(false);
    }, [currentProductQuickSetupKey, productQuickSetupMode, searchTerm]);

    useEffect(() => {
        if (activeProductQuickSetupItems.length === 0) return;

        let isDisposed = false;

        const refreshActiveQuickSetupItems = async () => {
            try {
                const response = await productApi.refreshOrderItems({
                    items: activeProductQuickSetupItems
                        .map((item) => buildProductRefreshPayload(item))
                        .filter(Boolean)
                });

                if (isDisposed) return;

                const refreshedItems = Array.isArray(response.data?.items) ? response.data.items : [];
                if (refreshedItems.length === 0) return;

                syncLatestProductsIntoLocalSources(
                    buildLatestProductSnapshotMap(refreshedItems)
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
        productQuickSetupRefreshAbortRef.current?.abort();
        replacementDeclarationSourceAbortRef.current?.abort();
        replacementDeclarationSearchAbortRef.current?.abort();
        replacementDeclarationLookupAbortRef.current?.abort();
        replacementDeclarationGroupsAbortRef.current?.abort();
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
            setProfitCenters(bootstrap.profit_centers || []);
            setProductQuickFilterAttributes(buildProductQuickFilterAttributes(bootstrap.product_attributes || []));
            setQuoteSettings((prev) => ({ ...prev, ...(bootstrap.quote_settings || {}) }));
            setQuoteTemplates(sortQuoteTemplates(bootstrap.quote_templates || []));
            setOrderAiRules(normalizeOrderAiRules(aiRulesResponse?.data?.rules || []));
        } catch (error) {
            setProductQuickFilterAttributes([]);
            setProfitCenters([]);
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

    const loadSourceQuoteTemplates = useCallback(async (accountIds = quoteTemplateSourceAccountIds) => {
        const normalizedAccountIds = Array.from(new Set(
            (Array.isArray(accountIds) ? accountIds : [])
                .map(normalizeAccountId)
                .filter(Boolean)
        ));

        if (normalizedAccountIds.length === 0) {
            return [];
        }

        const response = await orderApi.getBootstrap({
            mode: 'form',
            quote_source_account_ids: normalizedAccountIds.join(','),
        });
        const bootstrap = response.data || {};

        return sortQuoteTemplates(bootstrap.quote_templates || []);
    }, [quoteTemplateSourceAccountIds]);

    const refreshSourceQuoteTemplates = useCallback(async () => {
        if (quoteTemplateSourceAccountIds.length === 0) {
            setSourceQuoteTemplates([]);
            setSourceQuoteTemplatesLoading(false);
            return [];
        }

        setSourceQuoteTemplatesLoading(true);

        try {
            const nextQuoteTemplates = await loadSourceQuoteTemplates(quoteTemplateSourceAccountIds);
            setSourceQuoteTemplates(nextQuoteTemplates);
            return nextQuoteTemplates;
        } finally {
            setSourceQuoteTemplatesLoading(false);
        }
    }, [loadSourceQuoteTemplates, quoteTemplateSourceAccountIds]);

    useEffect(() => {
        let isDisposed = false;

        if (quoteTemplateSourceAccountIds.length === 0) {
            setSourceQuoteTemplates([]);
            setSourceQuoteTemplatesLoading(false);
            return undefined;
        }

        setSourceQuoteTemplatesLoading(true);

        loadSourceQuoteTemplates(quoteTemplateSourceAccountIds)
            .then((nextQuoteTemplates) => {
                if (!isDisposed) {
                    setSourceQuoteTemplates(nextQuoteTemplates);
                }
            })
            .catch((error) => {
                if (!isDisposed) {
                    console.error('Error loading source quote templates', error);
                    setSourceQuoteTemplates([]);
                }
            })
            .finally(() => {
                if (!isDisposed) {
                    setSourceQuoteTemplatesLoading(false);
                }
            });

        return () => {
            isDisposed = true;
        };
    }, [loadSourceQuoteTemplates, quoteTemplateSourceAccountIds, quoteTemplateSourceAccountKey]);

    const fetchOrder = async (targetId, isDuplicating = false) => {
        try {
            setLoading(true);
            const response = await orderApi.getOne(targetId);
            const order = response.data;
            const nextOrderKind = getNormalizedOrderKind(order.order_kind);
            const nextOrderType = normalizeOrderType(order.order_type);
            profitCenterManualOverrideRef.current = !isDuplicating && Boolean(order.profit_center_id);

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
                profit_center_id: item.product?.profit_center_id || item.product?.parent_configurable?.profit_center_id,
                ...resolveProductSourceFields(item),
                parent_product_id: Number(item.options?.variant_parent_id ?? item.product?.parent_id) || undefined,
                product_attributes: item.product?.attributes_map || item.product?.product_attributes || buildProductAttributesMap(item.product),
            })) || [];
            const resolvedLoadedItems = order.items?.map((item, index) => {
                const fallbackName = `San pham #${item.product_id}`;
                const displayName = resolveOrderLineItemDisplayName({
                    name: getOrderItemDisplayName(item, fallbackName),
                    options: item.options || {},
                    fallbackName,
                    preferSubmittedName: Boolean(getOrderItemSnapshotName(item)),
                });
                const displaySku = getOrderItemDisplaySku(item, 'N/A');
                const originalName = resolveOrderLineItemDisplayName({
                    name: getOrderItemCurrentName(item) || item.product?.name || '',
                    options: item.options || {},
                    fallbackName: '',
                });
                const originalSku = getOrderItemCurrentSku(item) || item.product?.sku || '';
                const snapshotName = resolveOrderLineItemDisplayName({
                    name: getOrderItemSnapshotName(item) || displayName,
                    options: item.options || {},
                    fallbackName: displayName,
                    preferSubmittedName: Boolean(getOrderItemSnapshotName(item)),
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
                    original_name: originalName || displayName,
                    original_sku: originalSku || displaySku,
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
                    profit_center_id: item.product?.profit_center_id || item.product?.parent_configurable?.profit_center_id,
                    ...resolveProductSourceFields(item),
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
                sales_channel: isDuplicating ? 'online' : (order.sales_channel || 'online'),
                profit_center_id: isDuplicating ? '' : (order.profit_center_id || ''),
                offline_store_name: isDuplicating ? '' : (order.offline_store_name || ''),
                offline_seller_name: isDuplicating ? '' : (order.offline_seller_name || ''),
                offline_payment_method: isDuplicating ? '' : (order.offline_payment_method || ''),
                type: order.type || 'Lẻ',
                shipment_status: isDuplicating ? 'Chưa giao' : (order.shipment_status || 'Chưa giao'),
                province: order.province || '',
                district: order.district || '',
                ward: order.ward || ''
            });
            setFormData((prev) => ({
                ...prev,
                items: resolvedLoadedItems,
                cost_total: mappedCostTotal,
                supplement_items: resolvedSupplementItems,
            }));
            setRegionType(order.district ? 'old' : 'new');
            void refreshOrderItemInventorySnapshot(resolvedLoadedItems);

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
                original_name: item.product_name || item.product?.name || item.name || '',
                original_sku: item.product_sku || item.product?.sku || item.sku || '',
                unit_name: resolveOrderUnitLabel(item, item?.product),
                quantity: normalizeOrderLineQuantity(item.quantity),
                price: Number(item.price) || 0,
                cost_price: resolveProductCostPrice(item),
                base_cost_price: resolveProductCostPrice(item),
                computed_stock: item.computed_stock,
                pending_export_quantity: item.pending_export_quantity,
                available_to_sell: item.available_to_sell,
                category_id: item.category_id || item.product?.category_id,
                ...resolveProductSourceFields(item),
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
        const isOfflineOrder = false;

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

        if (isMainOrder && !isOfflineOrder && !effectiveAddressDetail) {
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
            .map((item, index) => {
                const productId = Number(item.product_id) || 0;
                const actualProductId = Number(item.actual_product_id) || 0;

                return {
                    product_id: productId,
                    actual_product_id: hasActualOrderProductOverride(item) ? actualProductId : undefined,
                    sort_order: index + 1,
                    quantity: Math.max(0, Number(item.quantity) || 0),
                    price: Math.max(0, Number(item.price) || 0),
                    cost_price: resolveRoundedImportCostValue(item.cost_price, 0),
                    name: resolveSubmittedOrderItemName(item, productId),
                    sku: item.snapshot_sku || item.sku || '',
                    actual_name: hasActualOrderProductOverride(item)
                        ? resolveSubmittedOrderItemName({
                            snapshot_name: item.actual_snapshot_name,
                            name: item.actual_name,
                            original_name: item.actual_original_name,
                            product_id: actualProductId,
                        }, actualProductId)
                        : undefined,
                    actual_sku: hasActualOrderProductOverride(item)
                        ? (item.actual_snapshot_sku || item.actual_sku || '')
                        : undefined,
                    ...buildProductSourcePayload(item),
                    options: item.options && typeof item.options === 'object' && Object.keys(item.options).length > 0
                        ? item.options
                        : undefined,
                };
            })
            .filter((item) => item.product_id && item.quantity > 0);

        const submittedDiscount = resolveDiscountInputCommitValue(
            discountInputValue,
            parseMoneyNumber(formData.discount, 0) || 0,
            calculateQuoteItemsSubtotal(formData.items),
            discountInputMode
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
                sales_channel: 'online',
                profit_center_id: Number(formData.profit_center_id) || null,
                offline_store_name: '',
                offline_seller_name: '',
                offline_payment_method: '',
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
                shipping_address: isMainOrder && !isOfflineOrder
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
        if (name === 'profit_center_id') {
            profitCenterManualOverrideRef.current = true;
        }
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
    const commitDiscountValue = (nextDiscount) => {
        const normalizedDiscount = parseMoneyNumber(nextDiscount, 0) || 0;
        const nextManualDiscount = calculateManualDiscountValue(
            normalizedDiscount,
            formData.order_type,
            formData.supplement_items
        );

        setFormData((prev) => (
            prev.discount === normalizedDiscount && prev.manual_discount === nextManualDiscount
                ? prev
                : {
                    ...prev,
                    manual_discount: nextManualDiscount,
                    discount: normalizedDiscount,
                }
        ));
    };
    const focusDiscountInput = (selectText = false) => {
        window.requestAnimationFrame(() => {
            const input = discountInputRef.current;
            if (!input) {
                return;
            }

            input.focus();
            if (selectText) {
                input.select();
            }
        });
    };
    const handleDiscountInputModeChange = (nextMode) => {
        if (![DISCOUNT_INPUT_MODE_AMOUNT, DISCOUNT_INPUT_MODE_PERCENT].includes(nextMode)) {
            return;
        }

        const subtotal = calculateQuoteItemsSubtotal(formData.items);
        const currentDiscount = resolveDiscountInputCommitValue(
            discountInputValue,
            parseMoneyNumber(formData.discount, 0) || 0,
            subtotal,
            discountInputMode
        );

        if (nextMode === DISCOUNT_INPUT_MODE_PERCENT) {
            const currentPercentValue = subtotal > 0 && currentDiscount !== 0
                ? (currentDiscount / subtotal) * 100
                : null;

            setDiscountInputMode(DISCOUNT_INPUT_MODE_PERCENT);
            setDiscountInputValue(currentPercentValue === null ? '' : formatDiscountPercentInputValue(currentPercentValue));
            focusDiscountInput(true);
            return;
        }

        commitDiscountValue(currentDiscount);
        setDiscountInputMode(DISCOUNT_INPUT_MODE_AMOUNT);
        setDiscountInputValue(formatSignedMoneyInputValue(currentDiscount));
        focusDiscountInput(true);
    };
    const handleDiscountInputChange = (event) => {
        const rawValue = event.target.value;
        const selectionStart = event.target.selectionStart ?? rawValue.length;
        const digitCountBeforeCaret = rawValue.slice(0, selectionStart).replace(/[^0-9]/g, '').length;
        const shouldUsePercentMode = discountInputMode === DISCOUNT_INPUT_MODE_PERCENT || isDiscountPercentInputValue(rawValue);
        const normalizedValue = shouldUsePercentMode
            ? stripDiscountPercentSymbol(rawValue)
            : normalizeSignedMoneyInputValue(rawValue);
        const nextCaretPosition = shouldUsePercentMode
            ? normalizedValue.length
            : resolveFormattedMoneyCaretPosition(normalizedValue, digitCountBeforeCaret);

        if (shouldUsePercentMode && discountInputMode !== DISCOUNT_INPUT_MODE_PERCENT) {
            setDiscountInputMode(DISCOUNT_INPUT_MODE_PERCENT);
        }

        setDiscountInputValue(normalizedValue);
        if (shouldUsePercentMode) {
            const percentValue = parseDiscountPercentInputValue(normalizedValue, { requireSymbol: false });
            if (percentValue !== null) {
                commitDiscountValue(calculateDiscountAmountFromPercent(percentValue, calculateQuoteItemsSubtotal(formData.items)));
            }
        }

        window.requestAnimationFrame(() => {
            const input = discountInputRef.current;
            if (!input || document.activeElement !== input) {
                return;
            }

            input.setSelectionRange(nextCaretPosition, nextCaretPosition);
        });
    };
    const handleDiscountInputBlur = () => {
        const nextDiscount = resolveDiscountInputCommitValue(
            discountInputValue,
            calculateEffectiveDiscountValue(
                formData.manual_discount,
                formData.order_type,
                formData.supplement_items
            ),
            calculateQuoteItemsSubtotal(formData.items),
            discountInputMode
        );
        commitDiscountValue(nextDiscount);
        setDiscountInputValue(
            discountInputMode === DISCOUNT_INPUT_MODE_PERCENT
                ? stripDiscountPercentSymbol(discountInputValue)
                : formatSignedMoneyInputValue(nextDiscount)
        );
    };
    useEffect(() => {
        if (discountInputMode !== DISCOUNT_INPUT_MODE_PERCENT) {
            return;
        }

        const percentValue = parseDiscountPercentInputValue(discountInputValue, { requireSymbol: false });
        if (percentValue === null) {
            return;
        }

        const nextDiscount = calculateDiscountAmountFromPercent(percentValue, calculateQuoteItemsSubtotal(formData.items));
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
    }, [discountInputMode, discountInputValue, formData.items, formData.order_type, formData.supplement_items]);

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
                    ...buildProductSourcePayload(product),
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

    const openOrderLineNameEditor = useCallback((item, event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        setActiveTruncatedNameCellKey('');
        setEditingOrderLineName({
            lineId: item?.line_id || '',
            value: item?.name || '',
        });
    }, []);

    const cancelOrderLineNameEditor = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        setEditingOrderLineName({ lineId: '', value: '' });
    }, []);

    const commitOrderLineNameEditor = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const lineId = normalizeCanvasText(editingOrderLineName.lineId);
        const nextName = normalizeCanvasText(editingOrderLineName.value);

        if (!lineId) {
            setEditingOrderLineName({ lineId: '', value: '' });
            return;
        }

        if (!nextName) {
            showTransientNotification('error', 'Tên sản phẩm không được để trống.');
            return;
        }

        setFormData((prev) => ({
            ...prev,
            items: prev.items.map((item) => (
                normalizeCanvasText(item?.line_id) === lineId
                    ? {
                        ...item,
                        original_name: item.original_name || item.name,
                        original_sku: item.original_sku || item.sku,
                        name: nextName,
                        snapshot_name: nextName,
                    }
                    : item
            )),
        }));
        setEditingOrderLineName({ lineId: '', value: '' });
        showTransientNotification('success', 'Đã sửa tên sản phẩm cho đơn này.');
    }, [editingOrderLineName.lineId, editingOrderLineName.value, showTransientNotification]);

    const removeItem = React.useCallback((lineId) => {
        const normalizedLineId = normalizeCanvasText(lineId);
        if (!normalizedLineId) {
            return;
        }

        const deletedBatch = createDeletedOrderLineItemBatch(
            formData.items,
            (item) => normalizeCanvasText(item?.line_id) === normalizedLineId
        );
        if (deletedBatch.items.length === 0) {
            return;
        }

        pushDeletedLineItemBatch(deletedBatch);
        if (lineItemSelectionAnchorRef.current === normalizedLineId) {
            lineItemSelectionAnchorRef.current = '';
        }
        lineItemSelectionDragRef.current = null;
        setSelectedOrderLineId((prev) => (
            normalizeCanvasText(prev) === normalizedLineId ? '' : prev
        ));
        setEditingOrderLineName((prev) => (
            normalizeCanvasText(prev.lineId) === normalizedLineId
                ? { lineId: '', value: '' }
                : prev
        ));
        setSelectedLineItemIds((prev) => {
            if (!prev.has(normalizedLineId)) {
                return prev;
            }

            const next = new Set(prev);
            next.delete(normalizedLineId);
            return next;
        });
        setFormData(prev => {
            const newItems = applySequentialOrderLineSortOrder(prev.items.filter(item => normalizeCanvasText(item?.line_id) !== normalizedLineId));
            const costTotal = calculateItemsCostTotal(newItems);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, [formData.items, pushDeletedLineItemBatch]);

    const handleRemoveAllItems = useCallback(() => {
        if (formData.items.length === 0) {
            return;
        }

        showModal({
            title: 'Xóa toàn bộ sản phẩm?',
            content: 'Thao tác này sẽ xóa toàn bộ dòng sản phẩm hiện có trong đơn.<br/>Sau khi xóa có thể bấm nút Khôi phục xóa cạnh Nhân hệ số để lấy lại nhóm này.',
            type: 'warning',
            actionText: 'Xóa tất cả',
            onAction: () => {
                pushDeletedLineItemBatch(createDeletedOrderLineItemBatch(formData.items, () => true));
                closeOrderAiReplacePicker();
                closeActualProductPicker();
                setShowActualProductSection(false);
                setShowOrderAiInputReviewModal(false);
                setOrderAiLastRun(null);
                setSelectedOrderLineId('');
                setSelectedLineItemIds(new Set());
                lineItemSelectionAnchorRef.current = '';
                lineItemSelectionDragRef.current = null;
                setFormData((prev) => ({
                    ...prev,
                    items: [],
                    cost_total: 0,
                }));
                showTransientNotification('success', 'Đã xóa toàn bộ sản phẩm trong đơn.');
            },
        });
    }, [closeActualProductPicker, closeOrderAiReplacePicker, formData.items, pushDeletedLineItemBatch, showModal, showTransientNotification]);

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
    const selectableProfitCenters = profitCenters;
    const outgoingTrackingCode = resolveOutgoingTrackingCode(formData);
    const defaultReturnTrackingCode = buildDefaultReturnTrackingCode(normalizedOrderType, outgoingTrackingCode);
    const quotePricingSummary = buildOrderPricingSummary(formData);
    const subtotalAmount = quotePricingSummary.subtotal;
    const totalPaymentAmount = quotePricingSummary.totalPayment;
    const discountPercentPreviewValue = discountInputMode === DISCOUNT_INPUT_MODE_PERCENT
        ? parseDiscountPercentInputValue(discountInputValue, { requireSymbol: false })
        : null;
    const discountPercentPreviewAmount = discountPercentPreviewValue !== null
        ? calculateDiscountAmountFromPercent(discountPercentPreviewValue, subtotalAmount)
        : null;
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
            const tableHeaderHeight = 76;
            const imageColWidth = 182;
            const indexColWidth = 58;
            const qtyColWidth = 112;
            const unitColWidth = 135;
            const priceColWidth = 125;
            const totalColWidth = 150;
            const nameColWidth = pageWidth - imageColWidth - indexColWidth - qtyColWidth - unitColWidth - priceColWidth - totalColWidth;
            const xIndex = imageColWidth;
            const xName = xIndex + indexColWidth;
            const xQty = xName + nameColWidth;
            const xUnit = xQty + qtyColWidth;
            const xPrice = xUnit + unitColWidth;
            const xTotal = xPrice + priceColWidth;
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
            const tableHeaderFontSize = 25;
            const rowTextFontSize = 20;
            const rowLineHeight = 28;
            const rowMinHeight = 66;
            const rowPaddingY = 16;
            const nameCellPaddingX = 18;
            const numericCellPaddingX = 16;
            const footerRowHeight = 58;
            const footerPaddingY = 14;
            const footerTextFontSize = 20;
            const footerTitleFontSize = footerTextFontSize;
            const logoCardX = 34;
            const logoCardY = 44;
            const logoCardSize = 176;
            const centerColX = 246;
            const rightCardX = 780;
            const rightCardY = 46;
            const rightCardWidth = 386;
            const headerColumnGap = 28;
            const centerColWidth = rightCardX - centerColX - headerColumnGap;
            const headerBottomPadding = 34;
            const addressFontSize = 20;
            const addressLineHeight = 28;
            const phoneFontSize = 20;
            const phoneLineHeight = 28;
            const rightTitleFontSize = 20;
            const rightTitleLineHeight = 26;
            const rightLabelFontSize = 20;
            const rightLabelLineHeight = 26;
            const rightValueFontSize = 20;
            const rightValueLineHeight = 27;
            const rightMetaFontSize = 20;
            const rightMetaLineHeight = 27;
            const rightCardPaddingX = 24;
            const rightCardPaddingY = 18;
            const rightInnerWidth = rightCardWidth - (rightCardPaddingX * 2);
            const quoteBadgeText = normalizeCanvasText(id ? `Báo giá đơn #${id}` : 'Báo giá sản phẩm');
            const storeName = normalizeCanvasText(quoteSettings.quote_store_name || 'Gốm Đại Thành');
            const addressText = normalizeCanvasText(quoteSettings.quote_store_address || 'Bổ sung địa chỉ cửa hàng trong Cài đặt web > Báo giá');
            const phoneText = normalizeCanvasText(quoteSettings.quote_store_phone || 'Chưa có số điện thoại');
            const selectedTemplateName = getSelectedQuoteTemplateLabel(template, formData.items);
            const customerName = String(formData.customer_name || '').trim();
            const hasCustomerName = customerName !== '';
            const createdDateText = normalizeCanvasText(`Ngày tạo: ${new Date().toLocaleDateString('vi-VN')}`);

            const measureCanvas = document.createElement('canvas');
            const measureCtx = measureCanvas.getContext('2d');
            if (!measureCtx) throw new Error('MEASURE_CONTEXT_UNAVAILABLE');
            measureCtx.font = `400 ${addressFontSize}px ${quoteCanvasFontFamily}`;
            const addressLines = wrapCanvasText(measureCtx, addressText, centerColWidth);
            measureCtx.font = `600 ${phoneFontSize}px ${quoteCanvasFontFamily}`;
            const phoneLines = wrapCanvasText(measureCtx, `Điện thoại: ${phoneText}`, centerColWidth);
            measureCtx.font = `700 ${rightTitleFontSize}px ${quoteCanvasFontFamily}`;
            const rightTitleLines = wrapCanvasText(measureCtx, quoteBadgeText.toUpperCase(), rightInnerWidth - 28);
            measureCtx.font = `700 ${rightValueFontSize}px ${quoteCanvasFontFamily}`;
            const rawSelectedTemplateLines = wrapCanvasText(measureCtx, selectedTemplateName, rightInnerWidth);
            const selectedTemplateLines = rawSelectedTemplateLines.length > 2
                ? [
                    rawSelectedTemplateLines[0],
                    fitCanvasText(measureCtx, rawSelectedTemplateLines.slice(1).join(' '), rightInnerWidth),
                ]
                : rawSelectedTemplateLines;
            const rightTitleBoxHeight = Math.max(64, (rightTitleLines.length * rightTitleLineHeight) + 28);
            const selectedTemplateBlockHeight = rightLabelLineHeight + 8 + (selectedTemplateLines.length * rightValueLineHeight);
            const customerBlockHeight = hasCustomerName ? rightMetaLineHeight + 14 : 0;
            const rightCardHeight = rightCardPaddingY
                + rightTitleBoxHeight
                + 22
                + selectedTemplateBlockHeight
                + customerBlockHeight
                + rightMetaLineHeight
                + rightCardPaddingY;
            const leftInfoBottomY = 166
                + (addressLines.length * addressLineHeight)
                + 12
                + (phoneLines.length * phoneLineHeight);
            const headerHeight = Math.ceil(Math.max(
                248,
                logoCardY + logoCardSize,
                leftInfoBottomY,
                rightCardY + rightCardHeight,
            ) + headerBottomPadding);
            const bodyStartY = headerHeight + tableHeaderHeight;
            measureCtx.font = `400 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;

            const rowHeights = formData.items.map((item) => {
                measureCtx.font = `400 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;
                const lines = wrapCanvasText(measureCtx, item.name || '', nameColWidth - (nameCellPaddingX * 2));

                return Math.max(rowMinHeight, (lines.length * rowLineHeight) + (rowPaddingY * 2));
            });

            const itemsHeight = rowHeights.reduce((sum, height) => sum + height, 0);
            const quoteFooterRows = quotePricingSummary.extraRows;
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

            ctx.fillStyle = brandDark;
            ctx.font = `800 42px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('BẢNG BÁO GIÁ'), centerColX, 72);

            ctx.fillStyle = textPrimary;
            ctx.font = `700 28px ${quoteCanvasFontFamily}`;
            ctx.fillText(storeName, centerColX, 128);

            ctx.fillStyle = textMuted;
            ctx.font = `400 ${addressFontSize}px ${quoteCanvasFontFamily}`;
            drawTextLines(ctx, addressLines, centerColX, 166, addressLineHeight, 'left');
            ctx.font = `600 ${phoneFontSize}px ${quoteCanvasFontFamily}`;
            drawTextLines(ctx, phoneLines, centerColX, 166 + (addressLines.length * addressLineHeight) + 12, phoneLineHeight, 'left');

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#D8C4AF';
            ctx.fillRect(rightCardX, rightCardY, rightCardWidth, rightCardHeight);
            ctx.strokeRect(rightCardX, rightCardY, rightCardWidth, rightCardHeight);

            const rightContentX = rightCardX + rightCardPaddingX;
            const rightTitleBoxX = rightContentX;
            const rightTitleBoxY = rightCardY + rightCardPaddingY;
            ctx.fillStyle = subtleBg;
            ctx.fillRect(rightTitleBoxX, rightTitleBoxY, rightInnerWidth, rightTitleBoxHeight);
            ctx.strokeStyle = '#E6D7C9';
            ctx.strokeRect(rightTitleBoxX, rightTitleBoxY, rightInnerWidth, rightTitleBoxHeight);
            ctx.fillStyle = brandDark;
            ctx.font = `700 ${rightTitleFontSize}px ${quoteCanvasFontFamily}`;
            drawTextLines(
                ctx,
                rightTitleLines,
                rightCardX + (rightCardWidth / 2),
                rightTitleBoxY + 14,
                rightTitleLineHeight,
                'center'
            );

            let rightContentY = rightTitleBoxY + rightTitleBoxHeight + 22;
            ctx.fillStyle = textMuted;
            ctx.font = `700 ${rightLabelFontSize}px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(normalizeCanvasText('Mẫu đã chọn'), rightContentX, rightContentY);
            rightContentY += rightLabelLineHeight + 8;

            ctx.fillStyle = textPrimary;
            ctx.font = `700 ${rightValueFontSize}px ${quoteCanvasFontFamily}`;
            drawTextLines(ctx, selectedTemplateLines, rightContentX, rightContentY, rightValueLineHeight, 'left');
            rightContentY += (selectedTemplateLines.length * rightValueLineHeight) + 14;

            if (hasCustomerName) {
                ctx.fillStyle = textPrimary;
                ctx.font = `700 ${rightMetaFontSize}px ${quoteCanvasFontFamily}`;
                ctx.fillText(
                    fitCanvasText(ctx, `Tên khách hàng: ${customerName}`, rightInnerWidth),
                    rightContentX,
                    rightContentY
                );
                rightContentY += rightMetaLineHeight + 14;
            }

            ctx.fillStyle = textMuted;
            ctx.font = `600 ${rightMetaFontSize}px ${quoteCanvasFontFamily}`;
            ctx.fillText(fitCanvasText(ctx, createdDateText, rightInnerWidth), rightContentX, rightContentY);

            ctx.fillStyle = brandDark;
            ctx.fillRect(0, headerHeight, pageWidth, tableHeaderHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = `700 ${tableHeaderFontSize}px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const tableHeaderTextY = headerHeight + (tableHeaderHeight / 2);
            ctx.fillText(normalizeCanvasText('Ảnh bộ / mẫu'), imageColWidth / 2, tableHeaderTextY);
            ctx.fillText(normalizeCanvasText('STT'), xIndex + (indexColWidth / 2), tableHeaderTextY);
            ctx.fillText(normalizeCanvasText('Tên sản phẩm'), xName + (nameColWidth / 2), tableHeaderTextY);
            ctx.fillText(normalizeCanvasText('S\u1ed1 l\u01b0\u1ee3ng'), xQty + (qtyColWidth / 2), tableHeaderTextY);
            ctx.fillText(normalizeCanvasText('\u0110\u01a1n v\u1ecb t\u00ednh'), xUnit + (unitColWidth / 2), tableHeaderTextY);
            ctx.fillText(normalizeCanvasText('Đơn giá'), xPrice + (priceColWidth / 2), tableHeaderTextY);
            ctx.fillText(normalizeCanvasText('Thành tiền'), xTotal + (totalColWidth / 2), tableHeaderTextY);
            ctx.textBaseline = 'top';

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
                ctx.font = `400 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;
                const nameLines = wrapCanvasText(ctx, normalizeCanvasText(item.name || ''), nameColWidth - (nameCellPaddingX * 2));

                ctx.fillStyle = index % 2 === 0 ? '#FFFFFF' : '#FBF8F4';
                ctx.fillRect(xIndex, currentY, pageWidth - xIndex, rowHeight);
                ctx.strokeStyle = borderColor;
                ctx.strokeRect(xIndex + 0.5, currentY + 0.5, indexColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xName + 0.5, currentY + 0.5, nameColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xQty + 0.5, currentY + 0.5, qtyColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xUnit + 0.5, currentY + 0.5, unitColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xPrice + 0.5, currentY + 0.5, priceColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xTotal + 0.5, currentY + 0.5, totalColWidth - 1, rowHeight - 1);

                ctx.fillStyle = textPrimary;
                ctx.font = `400 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;
                const nameTextHeight = nameLines.length * rowLineHeight;
                const nameBlockHeight = nameTextHeight;
                const nameTextY = currentY + ((rowHeight - nameBlockHeight) / 2);
                drawTextLines(ctx, nameLines, xName + nameCellPaddingX, nameTextY, rowLineHeight, 'left');

                const valueY = currentY + (rowHeight / 2);
                ctx.textAlign = 'center';
                ctx.font = `400 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;
                ctx.textBaseline = 'middle';
                ctx.fillText(String(index + 1), xIndex + (indexColWidth / 2), valueY);
                ctx.fillText(String(item.quantity || 0), xQty + (qtyColWidth / 2), valueY);
                ctx.fillText(getOrderUnitDisplay(item), xUnit + (unitColWidth / 2), valueY);

                ctx.textAlign = 'right';
                ctx.fillStyle = textPrimary;
                ctx.font = `400 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;
                ctx.fillText(formatQuoteMoney(item.price), xPrice + priceColWidth - numericCellPaddingX, valueY);
                ctx.font = `700 ${rowTextFontSize}px ${quoteCanvasFontFamily}`;
                ctx.fillText(formatQuoteMoney(item.price * item.quantity), xTotal + totalColWidth - numericCellPaddingX, valueY);
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
            ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
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
            ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
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
            ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
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
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
            ctx.fillText(normalizeCanvasText('Tổng món'), 18, footerFirstRowY);
            ctx.textAlign = 'center';
            ctx.fillText(String(quoteTotalQuantity), xQty + (qtyColWidth / 2), footerFirstRowY);
            ctx.textAlign = 'right';
            ctx.font = `700 ${footerTitleFontSize}px ${quoteCanvasFontFamily}`;
            ctx.fillText(normalizeCanvasText('Tổng tiền'), xTotal - numericCellPaddingX, footerFirstRowY);
            ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
            ctx.fillText(formatQuoteMoney(subtotalAmount), pageWidth - numericCellPaddingX, footerFirstRowY);

            quoteFooterRows.forEach((row, index) => {
                const dividerY = bodyStartY + itemsHeight + footerPaddingY + ((index + 1) * footerRowHeight);
                ctx.beginPath();
                ctx.moveTo(0, dividerY);
                ctx.lineTo(pageWidth, dividerY);
                ctx.stroke();

                const rowY = dividerY + (footerRowHeight / 2);
                ctx.fillStyle = row.isDeduction ? '#8E0B0B' : textPrimary;
                ctx.textAlign = 'right';
                ctx.font = `${row.isEmphasis ? '700' : '600'} ${footerTitleFontSize}px ${quoteCanvasFontFamily}`;
                ctx.fillText(normalizeCanvasText(row.label), xTotal - numericCellPaddingX, rowY);
                ctx.font = `${row.isEmphasis ? '700' : '600'} ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
                ctx.fillText(`${row.isDeduction ? '-' : ''}${formatQuoteMoney(row.value)}`, pageWidth - numericCellPaddingX, rowY);
            });
            ctx.textBaseline = 'top';

            const normalizedFooterTopY = bodyStartY + itemsHeight;
            ctx.fillStyle = footerBg;
            ctx.fillRect(0, normalizedFooterTopY, pageWidth, footerHeight);
            ctx.strokeStyle = borderStrong;
            ctx.strokeRect(0.5, normalizedFooterTopY + 0.5, pageWidth - 1, footerHeight - 1);
            [xQty, xUnit, xTotal].forEach((x) => {
                ctx.beginPath();
                ctx.moveTo(x, normalizedFooterTopY);
                ctx.lineTo(x, pageHeight);
                ctx.stroke();
            });

            const normalizedFooterFirstRowY = normalizedFooterTopY + footerPaddingY + (footerRowHeight / 2);
            ctx.fillStyle = textPrimary;
            ctx.textBaseline = 'middle';
            ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('Tổng món'), numericCellPaddingX, normalizedFooterFirstRowY);
            ctx.textAlign = 'center';
            ctx.fillText(String(quoteTotalQuantity), xQty + (qtyColWidth / 2), normalizedFooterFirstRowY);
            ctx.textAlign = 'right';
            ctx.fillText(normalizeCanvasText('Tổng tiền'), xTotal - numericCellPaddingX, normalizedFooterFirstRowY);
            ctx.fillText(formatQuoteMoney(subtotalAmount), pageWidth - numericCellPaddingX, normalizedFooterFirstRowY);

            quoteFooterRows.forEach((row, index) => {
                const dividerY = normalizedFooterTopY + footerPaddingY + ((index + 1) * footerRowHeight);
                ctx.beginPath();
                ctx.moveTo(0, dividerY);
                ctx.lineTo(pageWidth, dividerY);
                ctx.stroke();

                const rowY = dividerY + (footerRowHeight / 2);
                ctx.fillStyle = row.isDeduction ? '#8E0B0B' : textPrimary;
                ctx.textAlign = 'right';
                ctx.font = `700 ${footerTextFontSize}px ${quoteCanvasFontFamily}`;
                ctx.fillText(normalizeCanvasText(row.label), xTotal - numericCellPaddingX, rowY);
                ctx.fillText(`${row.prefix ?? (row.isDeduction ? '-' : '')}${formatQuoteMoney(row.value)}`, pageWidth - numericCellPaddingX, rowY);
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

        let currentSourceQuoteTemplates = sourceQuoteTemplates;

        if (quoteTemplateSourceAccountIds.length > 0) {
            try {
                currentSourceQuoteTemplates = await refreshSourceQuoteTemplates();
            } catch (error) {
                console.error('Error refreshing source quote templates', error);
            }
        }

        const availableTemplates = mergeQuoteTemplates(quoteTemplates, currentSourceQuoteTemplates)
            .filter((template) => template.is_active !== false);

        if (availableTemplates.length === 0) {
            let refreshedTemplates = [];
            try {
                refreshedTemplates = await refreshQuoteBootstrap();
            } catch (error) {
                console.error('Error refreshing quote bootstrap', error);
            }

            if (quoteTemplateSourceAccountIds.length > 0) {
                try {
                    currentSourceQuoteTemplates = await refreshSourceQuoteTemplates();
                } catch (error) {
                    console.error('Error refreshing source quote templates', error);
                }
            }

            const refreshedAvailableTemplates = mergeQuoteTemplates(refreshedTemplates, currentSourceQuoteTemplates)
                .filter((template) => template.is_active !== false);
            if (refreshedAvailableTemplates.length > 0) {
                setQuoteTemplateSearch('');
                setShowQuoteTemplatePicker(true);
                return;
            }

            showModal({
                title: 'Thiếu cấu hình',
                content: 'Chưa có bộ/mẫu báo giá hoạt động. Vào Cài đặt web > Báo giá để cấu hình trước.',
                type: 'error'
            });
            return;
        }

        setQuoteTemplateSearch('');
        setShowQuoteTemplatePicker(true);
        refreshQuoteBootstrap().catch((error) => {
            console.error('Error refreshing quote bootstrap', error);
        });
        if (quoteTemplateSourceAccountIds.length > 0) {
            refreshSourceQuoteTemplates().catch((error) => {
                console.error('Error refreshing source quote templates', error);
            });
        }
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
                items: formData.items
                    .map((item) => buildProductRefreshPayload(item, { useEffectiveInventoryProduct: true }))
                    .filter(Boolean)
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

            leaveGuardBypassRef.current = true;
            leaveGuardBaselineSnapshotRef.current = latestLeaveGuardSnapshot;
            leaveGuardBaselineReadyRef.current = true;

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

    const handleLeavePromptStay = useCallback(() => {
        setLeavePromptOpen(false);
    }, []);

    const handleLeavePromptDiscard = useCallback(() => {
        leaveGuardBypassRef.current = true;
        leaveGuardHistoryActiveRef.current = false;
        setLeavePromptOpen(false);
        navigateBack();
    }, [navigateBack]);

    const handleLeavePromptSave = useCallback(() => {
        setLeavePromptOpen(false);
        handleSubmit(null);
    }, [handleSubmit]);

    const handleAttributeChange = React.useCallback((code, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: { ...prev.custom_attributes, [code]: value }
        }));
    }, []);

    const handleReorder = React.useCallback((newItems) => {
        setFormData(prev => ({ ...prev, items: applySequentialOrderLineSortOrder(newItems) }));
    }, []);

    const mergedQuoteTemplates = useMemo(
        () => mergeQuoteTemplates(quoteTemplates, sourceQuoteTemplates),
        [quoteTemplates, sourceQuoteTemplates]
    );
    const availableQuoteTemplates = mergedQuoteTemplates.filter((template) => template.is_active !== false);
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
                placeholder="Dán hoặc nhập địa chỉ giao hàng"
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

    const renderCrossSellSourceToggles = useCallback(({ mobile = false, fill = false } = {}) => {
        if (crossSellSourceAccounts.length === 0) return null;

        const selectedCount = selectedCrossSellSourceAccounts.length;
        const summaryLabel = selectedCount === 0
            ? '\u004e\u0067\u0075\u1ed3\u006e \u0053\u0050'
            : selectedCount === 1
                ? selectedCrossSellSourceAccounts[0].name
                : `${selectedCount} \u006e\u0067\u0075\u1ed3\u006e \u0053\u0050`;
        const statusLabel = selectedCount === 0
            ? '\u0043\u0068\u1ec9 \u0073\u0068\u006f\u0070 \u0068\u0069\u1ec7\u006e \u0074\u1ea1\u0069'
            : selectedCount === 1
                ? '\u0110\u0061\u006e\u0067 \u0078\u0065\u006d \u0074\u0068\u00eam 1 \u0073\u0068\u006f\u0070'
                : `\u0110\u0061\u006e\u0067 \u0078\u0065\u006d \u0074\u0068\u00eam ${selectedCount} \u0073\u0068\u006f\u0070`;
        const buttonClassName = [
            'relative inline-flex h-10 min-w-0 items-center justify-between gap-2 border px-3 text-left shadow-sm transition-all',
            fill || mobile ? 'w-full' : 'w-auto max-w-full',
            mobile ? 'rounded-[14px]' : 'rounded-sm',
            selectedCount > 0
                ? 'border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-400 hover:bg-white'
                : 'border-primary/10 bg-primary/5 text-primary/65 hover:border-primary/25 hover:bg-white hover:text-primary',
        ].join(' ');

        return (
            <div ref={crossSellSourceDropdownRef} className={`relative min-w-0 ${fill || mobile ? 'w-full' : 'max-w-full'}`}>
                <button
                    type="button"
                    onClick={toggleCrossSellSourceDropdown}
                    className={buttonClassName}
                    title={statusLabel}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="material-symbols-outlined shrink-0 text-[17px]">storefront</span>
                        <span className="min-w-0">
                            <span className="block truncate text-[12px] font-black leading-none">{summaryLabel}</span>
                            <span className="mt-1 block truncate text-[10px] font-semibold leading-none opacity-60">{statusLabel}</span>
                        </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                        {selectedCount > 0 && (
                            <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-sky-600 px-1.5 text-[10px] font-black leading-[18px] text-white">
                                {selectedCount}
                            </span>
                        )}
                        <span className={`material-symbols-outlined text-[16px] transition-transform ${showCrossSellSourceDropdown ? 'rotate-180' : ''}`}>expand_more</span>
                    </span>
                </button>

                {showCrossSellSourceDropdown && (
                    <div className={`absolute top-full z-[180] mt-2 w-[320px] max-w-[calc(100vw-48px)] overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.18)] ${mobile ? 'left-0' : 'right-0'}`}>
                        <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-primary/45">
                                        {'\u0058\u0065\u006d \u0073\u1ea3\u006e \u0070\u0068\u1ea9\u006d \u0073\u0068\u006f\u0070 \u006b\u0068\u00e1\u0063'}
                                    </div>
                                    <div className="mt-1 truncate text-[11px] font-semibold text-primary/45">{statusLabel}</div>
                                </div>
                                {selectedCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setEnabledCrossSellAccountIds([]);
                                            productSearchCacheRef.current.clear();
                                            productQuickFilterScopeCacheRef.current.clear();
                                            productQuickSetupCacheRef.current.clear();
                                        }}
                                        className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35 transition-colors hover:text-brick"
                                    >
                                        {'\u0054\u1eaft\u0074'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="custom-scrollbar max-h-[240px] overflow-y-auto p-2">
                            {crossSellSourceAccounts.map((account) => {
                                const accountId = normalizeAccountId(account?.id);
                                const isEnabled = enabledCrossSellAccountIdSet.has(accountId);

                                return (
                                    <button
                                        key={`cross-source-${accountId}`}
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            toggleCrossSellAccount(accountId);
                                        }}
                                        className={`mb-1 flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-left transition-all last:mb-0 ${isEnabled ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-transparent bg-white text-primary/70 hover:border-primary/10 hover:bg-primary/[0.03] hover:text-primary'}`}
                                    >
                                        <span className={`material-symbols-outlined shrink-0 text-[18px] ${isEnabled ? 'text-sky-600' : 'text-primary/35'}`}>
                                            {isEnabled ? 'check_box' : 'check_box_outline_blank'}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[12px] font-bold">{account.name}</span>
                                            <span className="mt-0.5 block text-[10px] font-semibold opacity-55">
                                                {isEnabled ? '\u0110\u0061\u006e\u0067 \u0062\u1ead\u0074 \u0074\u00ec\u006d \u0073\u1ea3\u006e \u0070\u0068\u1ea9\u006d' : '\u0042\u1ea5\u006d \u0111\u1ec3 \u0078\u0065\u006d \u0073\u1ea3\u006e \u0070\u0068\u1ea9\u006d'}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    }, [
        crossSellSourceAccounts,
        enabledCrossSellAccountIdSet,
        selectedCrossSellSourceAccounts,
        showCrossSellSourceDropdown,
        toggleCrossSellAccount,
        toggleCrossSellSourceDropdown,
    ]);

    const renderManualQuickSetupControl = ({ mobile = false } = {}) => {
        const isOpen = showProductQuickSetupPanel && productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_MANUAL;
        const savedCount = manualProductQuickSetupItems.length;
        const statusLabel = isManualProductQuickModeActive
            ? '\u0110ang l\u1ecdc DS n\u00e0y'
            : savedCount > 0
                ? `${savedCount} SP \u0111\u00e3 l\u01b0u`
                : 'Khai b\u00e1o DS';
        const contextLabel = normalizeCanvasText(manualProductQuickSetupLabel);

        return (
            <div ref={manualQuickSetupDropdownRef} className={`relative min-w-0 ${mobile ? 'w-full' : 'w-[170px] shrink-0'}`}>
                <button
                    type="button"
                    onClick={toggleManualProductQuickSetupPanel}
                    className={`inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 border px-3 text-left shadow-sm transition-all ${mobile ? 'rounded-[14px]' : 'rounded-sm'} ${isManualProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700 hover:border-green-300 hover:bg-white' : 'border-primary/10 bg-primary/5 text-primary/65 hover:border-primary/25 hover:bg-white hover:text-primary'}`}
                    title="L\u1ecdc nhanh th\u1ee7 c\u00f4ng"
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="material-symbols-outlined shrink-0 text-[17px]">bolt</span>
                        <span className="min-w-0">
                            <span className="block truncate text-[12px] font-black leading-none">{'L\u1ecdc nhanh'}</span>
                            <span className="mt-1 block truncate text-[10px] font-semibold leading-none opacity-60">{statusLabel}</span>
                        </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                        {savedCount > 0 && (
                            <span className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-black leading-[18px] text-white ${isManualProductQuickModeActive ? 'bg-green-600' : 'bg-primary/70'}`}>
                                {savedCount}
                            </span>
                        )}
                        <span className={`material-symbols-outlined text-[16px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>expand_more</span>
                    </span>
                </button>

                {isOpen && (
                    <div className={`absolute top-full z-[185] mt-2 w-[420px] max-w-[calc(100vw-48px)] overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.18)] ${mobile ? 'left-0' : 'right-0'}`}>
                        <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-primary/45">
                                        {'DS nhanh th\u1ee7 c\u00f4ng'}
                                    </div>
                                    <div className="mt-1 truncate text-[11px] font-semibold text-primary/45">
                                        {contextLabel ? `Theo t\u1eeb kh\u00f3a: ${contextLabel}` : 'D\u00f9ng khi ch\u01b0a c\u00f3 b\u1ed9 l\u1ecdc thu\u1ed9c t\u00ednh'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleManualProductQuickMode}
                                    disabled={isManualProductQuickModeToggleDisabled}
                                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isManualProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'}`}
                                >
                                    {isManualProductQuickModeActive ? '\u0110ang b\u1eadt' : '\u0110ang t\u1eaft'}
                                </button>
                            </div>
                        </div>
                        <div className="p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex h-9 min-w-[180px] flex-1 items-center rounded-sm border border-primary/10 bg-white px-3 shadow-sm">
                                    <span className="material-symbols-outlined mr-2 text-[15px] text-primary/35">search</span>
                                    <input
                                        ref={productQuickSetupSearchInputRef}
                                        type="text"
                                        value={productQuickSetupSearchTerm}
                                        onChange={(event) => setProductQuickSetupSearchTerm(event.target.value)}
                                        placeholder={contextLabel ? `T\u00ecm SP cho ${contextLabel}...` : 'T\u00ecm SP \u0111\u1ec3 th\u00eam v\u00e0o DS nhanh...'}
                                        className="w-full bg-transparent text-[12px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:outline-none"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={saveAndCloseProductQuickSetupPanel}
                                    className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                >
                                    <span className="material-symbols-outlined text-[14px]">save</span>
                                    {'L\u01b0u'}
                                </button>
                            </div>
                            <div className="mt-2 text-[10px] font-semibold text-primary/40">
                                {savedCount > 0
                                    ? `\u0110ang l\u01b0u ${savedCount} s\u1ea3n ph\u1ea9m trong DS nhanh n\u00e0y.`
                                    : 'Ch\u1ecdn s\u1ea3n ph\u1ea9m hay d\u00f9ng \u0111\u1ec3 l\u1ea7n sau b\u1eadt L\u1ecdc nhanh l\u00e0 hi\u1ec7n ri\u00eang DS n\u00e0y.'}
                            </div>
                            {productQuickSetupLoading && (
                                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/10 bg-primary/[0.03] px-2.5 py-1 text-[10px] font-bold text-primary/45">
                                    <span className="material-symbols-outlined animate-refresh-spin text-[12px]">refresh</span>
                                    {'\u0110ang t\u1ea3i s\u1ea3n ph\u1ea9m...'}
                                </div>
                            )}
                            <div ref={productQuickSetupListRef} className="custom-scrollbar mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                                {visibleProductQuickSetupProducts.length > 0 ? visibleProductQuickSetupProducts.map((product) => {
                                    const targetProductId = Number(product?.target_product_id ?? product?.product_id ?? product?.id);
                                    const setupEntryKey = getProductQuickSetupEntryKey(product);
                                    const entryKind = String(product?.entry_kind || SEARCH_ENTRY_PRODUCT);
                                    const isVariation = entryKind === SEARCH_ENTRY_VARIATION;
                                    const isBundleOption = entryKind === SEARCH_ENTRY_BUNDLE_OPTION;
                                    const isSelected = selectedQuickSetupEntryKeys.has(setupEntryKey);

                                    return (
                                        <button
                                            key={`manual-setup-product-${setupEntryKey || targetProductId}`}
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
                                                        {quoteCurrencyFormatter.format(Number(product.price || 0))}{'\u0111'}
                                                    </div>
                                                    <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                                        {isSelected ? '\u0110\u00e3 ch\u1ecdn' : 'Th\u00eam'}
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                }) : (
                                    <div className="rounded-sm border border-dashed border-primary/10 bg-white px-3 py-6 text-center text-[11px] italic text-primary/35">
                                        {'Kh\u00f4ng c\u00f3 s\u1ea3n ph\u1ea9m ph\u00f9 h\u1ee3p v\u1edbi t\u1eeb kh\u00f3a hi\u1ec7n t\u1ea1i.'}
                                    </div>
                                )}
                            </div>
                            {isManualProductQuickModeActive && (
                                <button
                                    type="button"
                                    onClick={disableManualProductQuickMode}
                                    className="mt-3 inline-flex h-8 items-center gap-1 rounded-sm border border-brick/15 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-brick/70 transition-all hover:border-brick/30 hover:text-brick"
                                >
                                    <span className="material-symbols-outlined text-[13px]">close</span>
                                    {'T\u1eaft l\u1ecdc nhanh'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderProductSourceQuickControls = ({ mobile = false, fill = false } = {}) => {
        const sourceControl = renderCrossSellSourceToggles({ mobile, fill: true });

        return (
            <div className={`flex min-w-0 items-center gap-2 ${fill || mobile ? 'w-full' : 'max-w-full'}`}>
                {sourceControl && (
                    <div className="min-w-0 flex-1">
                        {sourceControl}
                    </div>
                )}
                {renderManualQuickSetupControl({ mobile })}
            </div>
        );
    };

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

                {renderProductSourceQuickControls({ mobile, fill: true })}

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

                            {showProductQuickSetupPanel && productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE && !mobile && (
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
                                                onClick={saveAndCloseProductQuickSetupPanel}
                                                className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">save</span>
                                                Lưu
                                            </button>
                                        </div>

                                        <div className="mt-2 text-[10px] font-semibold text-primary/40">
                                            {activeProductQuickSetupItems.length > 0
                                                ? `Đang lưu ${activeProductQuickSetupItems.length} sản phẩm cho bộ lọc này.`
                                                : 'Chọn vài sản phẩm để tạo lớp lọc nhanh cho thuộc tính đang chọn.'}
                                        </div>
                                        {productQuickSetupLoading && (
                                            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/10 bg-primary/[0.03] px-2.5 py-1 text-[10px] font-bold text-primary/45">
                                                <span className="material-symbols-outlined animate-refresh-spin text-[12px]">refresh</span>
                                                Đang tải thêm sản phẩm...
                                            </div>
                                        )}

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
                                quickFilterAttribute={isProductQuickModeActive ? activeProductQuickFilterAttribute : null}
                                isAlreadyInOrder={Boolean(p.__alreadyInOrder)}
                                activeAccountId={activeAccountId}
                            />
                        ))}
                        {shouldShowProductSearchEmptyState && (
                            <div className={`p-4 text-center italic text-primary/20 ${mobile ? 'text-[13px] font-semibold' : 'text-[11px] font-black uppercase tracking-widest'}`}>
                                {productSearchEmptyMessage}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderReplacementDeclarationQuickFilterControls = () => {
        if (!productQuickFilterAttributes.length || !activeProductQuickFilterAttribute) {
            return null;
        }

        return (
            <div className="rounded-sm border border-primary/10 bg-white px-3 py-3 shadow-sm">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-primary/45">
                            <span className="material-symbols-outlined text-[14px]">tune</span>
                            Lọc nhanh
                        </div>
                        <select
                            value={productQuickFilterAttributeId || ''}
                            onChange={(event) => handleReplacementDeclarationQuickFilterAttributeChange(event.target.value)}
                            className="h-9 min-w-[160px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
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
                                onChange={(event) => handleReplacementDeclarationQuickFilterAttributeChange2(event.target.value)}
                                className="h-9 min-w-[160px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:border-primary/30 focus:outline-none"
                            >
                                <option value="">-- Lọc 2 --</option>
                                {productQuickFilterAttributes
                                    .filter(attr => String(attr.id) !== String(productQuickFilterAttributeId))
                                    .map((attribute) => (
                                        <option key={attribute.id} value={attribute.id}>
                                            {attribute.name}
                                        </option>
                                    ))}
                            </select>
                        )}
                        {hasActiveProductQuickFilter && (
                            <button
                                type="button"
                                onClick={clearReplacementDeclarationQuickFilterValues}
                                className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/10 bg-primary/[0.03] px-3 text-[10px] font-black uppercase tracking-[0.12em] text-primary/50 transition-all hover:border-brick/20 hover:text-brick"
                            >
                                <span className="material-symbols-outlined text-[13px]">close</span>
                                Xóa lọc
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={toggleProductQuickMode}
                            disabled={isProductQuickModeToggleDisabled}
                            title={isProductQuickModeToggleDisabled ? 'Chưa có DS lọc nhanh để bật' : 'Bật/tắt lọc nhanh hơn'}
                            className={`inline-flex h-9 items-center gap-1 rounded-sm border px-3 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isProductQuickModeActive ? 'border-green-200 bg-green-50 text-green-700 hover:border-green-300 hover:bg-green-100' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'}`}
                        >
                            <span className="material-symbols-outlined text-[13px]">{isProductQuickModeActive ? 'flash_on' : 'flash_off'}</span>
                            {isProductQuickModeActive ? 'Đang bật' : 'Đang tắt'}
                            {activeProductQuickSetupItems.length > 0 ? (
                                <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] leading-none ${isProductQuickModeActive ? 'bg-green-700 text-white' : 'bg-primary/10 text-primary/45'}`}>
                                    {activeProductQuickSetupItems.length}
                                </span>
                            ) : null}
                        </button>
                    </div>
                    {hasActiveProductQuickFilter && activeProductQuickFilterSummary ? (
                        <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-primary/10 bg-primary/[0.03] px-3 py-1 text-[11px] font-semibold text-primary/60">
                            <span className="material-symbols-outlined text-[13px]">bolt</span>
                            <span className="truncate">{activeProductQuickFilterSummary}</span>
                        </div>
                    ) : null}
                </div>

                {activeProductQuickFilterAttribute.options?.length > 0 && (
                    <div className="custom-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
                        {activeProductQuickFilterAttribute.options.map((option) => {
                            const isSelected = normalizedProductQuickFilterValues.includes(option.value);

                            return (
                                <button
                                    key={`${activeProductQuickFilterAttribute.id}-${option.id || option.value}`}
                                    type="button"
                                    onClick={() => toggleReplacementDeclarationQuickFilterValue(option.value)}
                                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-all ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-primary/25 hover:bg-primary/5'}`}
                                >
                                    <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                    <span>{option.label || option.value}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {normalizedProductQuickFilterValues[0] && activeProductQuickFilterAttribute2Options.length > 0 && (
                    <div className="custom-scrollbar mt-2 flex gap-1.5 overflow-x-auto border-t border-primary/5 pt-2 pb-1">
                        {activeProductQuickFilterAttribute2Options.map((option) => {
                            const isSelected = normalizedProductQuickFilterValues2.includes(option.value);

                            return (
                                <button
                                    key={`${activeProductQuickFilterAttribute2.id}-${option.id || option.value}`}
                                    type="button"
                                    onClick={() => toggleReplacementDeclarationQuickFilterValue2(option.value)}
                                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-all ${isSelected ? 'border-brick bg-brick text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-brick/25 hover:bg-brick/5'}`}
                                >
                                    <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                    <span>{option.label || option.value}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderReplacementDeclarationProductRow = (entry, {
        actionLabel = 'Chọn',
        disabled = false,
        onSelect = () => {},
        selected = false,
    } = {}) => {
        const sku = getProductReplacementDeclarationSku(entry);
        const name = getProductReplacementDeclarationName(entry);
        const stockValue = parseQuantityNumber(entry?.available_to_sell, parseQuantityNumber(entry?.stock_quantity));
        const hasStockValue = stockValue !== null;
        const entryKind = String(entry?.entry_kind || SEARCH_ENTRY_PRODUCT);
        const isBundleOption = entryKind === SEARCH_ENTRY_BUNDLE_OPTION;
        const isVariation = entryKind === SEARCH_ENTRY_VARIATION;

        return (
            <button
                type="button"
                onClick={() => {
                    if (!disabled) onSelect(entry);
                }}
                disabled={disabled}
                className={`group flex w-full items-start justify-between gap-3 border-b border-primary/5 px-3 py-3 text-left transition-all last:border-b-0 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-primary/[0.03]'}`}
            >
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-black leading-[1.35] text-primary">
                        {name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-primary/45">
                        {sku && (
                            <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5">
                                {sku}
                            </span>
                        )}
                        {isVariation && entry?.option_label ? (
                            <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">
                                {entry.option_label}
                            </span>
                        ) : null}
                        {isBundleOption && entry?.bundle_option_title ? (
                            <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">
                                Bundle: {entry.bundle_option_title}
                            </span>
                        ) : null}
                        {hasStockValue ? (
                            <span className={`rounded-full border border-primary/10 bg-white px-2 py-0.5 font-black ${getAvailableToSellTextClass(stockValue)}`}>
                                Còn {formatOrderFormQuantity(stockValue)}
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <div className="text-[12px] font-black text-blue-600">
                        {formatQuoteMoney(resolveMoneyValue(entry?.price, 0))}
                    </div>
                    <div className={`mt-1 text-[10px] font-black uppercase tracking-[0.12em] ${selected ? 'text-emerald-700' : 'text-primary/35 group-hover:text-primary/60'}`}>
                        {actionLabel}
                    </div>
                </div>
            </button>
        );
    };

    const canSaveReplacementDeclaration = Boolean(replacementDeclarationSourceKey)
        && replacementDeclarationSelectedSkus.length > 0
        && !replacementDeclarationLookupLoading
        && !replacementDeclarationSaving;
    const replacementDeclarationModal = showReplacementDeclarationModal && typeof document !== 'undefined'
        ? createPortal((
            <>
                <div
                    className="fixed inset-0 z-[2520] bg-slate-950/35 backdrop-blur-[1px]"
                    onClick={closeReplacementDeclarationModal}
                />
                <div className="fixed inset-0 z-[2530] flex items-center justify-center p-3 md:p-6">
                    <div
                        className="flex max-h-[calc(100vh-32px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-primary/10 bg-[#F8FAFC] px-4 py-3 md:px-5">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Khai báo kho</div>
                                <h3 className="mt-1 text-[16px] font-black leading-tight text-primary">Khai báo sản phẩm thay thế</h3>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleOpenProductReplacementManager}
                                    className="hidden h-9 items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/60 transition-all hover:border-primary/25 hover:text-primary sm:inline-flex"
                                >
                                    <span className="material-symbols-outlined text-[15px]">table_rows</span>
                                    Bảng mã thay thế
                                </button>
                                <button
                                    type="button"
                                    onClick={closeReplacementDeclarationModal}
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/35 transition-all hover:border-brick/20 hover:text-brick"
                                    title="Đóng"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>
                        </div>

                        <div className="border-b border-primary/10 px-4 py-3 md:px-5">
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                                <div className="min-w-0">
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Sản phẩm gốc đang khai báo</div>
                                    <div className="mt-1 truncate text-[14px] font-black leading-[1.35] text-primary">
                                        {getProductReplacementDeclarationName(replacementDeclarationSource)}
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-primary/45">
                                        {getProductReplacementDeclarationSku(replacementDeclarationSource) ? (
                                            <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">
                                                {getProductReplacementDeclarationSku(replacementDeclarationSource)}
                                            </span>
                                        ) : null}
                                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-black text-sky-700">
                                            {replacementDeclarationGroupId ? `Đang sửa nhóm #${replacementDeclarationGroupId}` : 'Nhóm mới'}
                                        </span>
                                        {replacementDeclarationLookupLoading ? (
                                            <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 font-black text-primary/40">
                                                Đang tải nhóm cũ
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-2 text-right">
                                    <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Trong nhóm</div>
                                    <div className="mt-1 text-[20px] font-black leading-none text-primary">
                                        {replacementDeclarationSelectedSkus.length + (replacementDeclarationSourceKey ? 1 : 0)}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="custom-scrollbar flex-1 overflow-y-auto bg-[#F8FAFC] p-4 md:p-5">
                            <div className="space-y-3">
                                {renderProductSourceQuickControls({ fill: true })}
                                {renderReplacementDeclarationQuickFilterControls()}

                                <div className="grid gap-3 xl:grid-cols-2">
                                    <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm">
                                        <div className="border-b border-primary/10 px-3 py-3">
                                            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Tìm sản phẩm gốc</div>
                                            <div className="flex h-10 items-center rounded-sm border border-primary/10 bg-primary/[0.03] px-3 transition-all focus-within:border-primary/30 focus-within:bg-white">
                                                <span className="material-symbols-outlined mr-2 text-[16px] text-primary/35">search</span>
                                                <input
                                                    type="text"
                                                    value={replacementDeclarationSourceSearchTerm}
                                                    onChange={(event) => setReplacementDeclarationSourceSearchTerm(event.target.value)}
                                                    placeholder="Gõ mã hoặc tên sản phẩm gốc..."
                                                    className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/30 focus:outline-none"
                                                />
                                                {replacementDeclarationSourceSearchTerm ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setReplacementDeclarationSourceSearchTerm('');
                                                            setReplacementDeclarationSourceResults([]);
                                                        }}
                                                        className="ml-2 text-primary/30 transition-all hover:text-brick"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="custom-scrollbar max-h-[300px] overflow-y-auto">
                                            {replacementDeclarationSourceLoading ? (
                                                <div className="px-3 py-5 text-center text-[12px] font-semibold text-primary/40">Đang tìm sản phẩm...</div>
                                            ) : replacementDeclarationSourceResults.length > 0 ? (
                                                replacementDeclarationSourceResults.slice(0, 12).map((entry, index) => {
                                                    const entryKey = getActualReplacementEntryKey(entry);
                                                    const isCurrentSource = entryKey && entryKey === replacementDeclarationSourceKey;

                                                    return (
                                                        <React.Fragment key={`${entryKey || getProductReplacementDeclarationSku(entry) || 'source'}-${index}`}>
                                                            {renderReplacementDeclarationProductRow(entry, {
                                                                actionLabel: isCurrentSource ? 'Đang chọn' : 'Chọn gốc',
                                                                disabled: isCurrentSource,
                                                                onSelect: handleSelectReplacementDeclarationSource,
                                                                selected: isCurrentSource,
                                                            })}
                                                        </React.Fragment>
                                                    );
                                                })
                                            ) : (
                                                <div className="px-3 py-8 text-center text-[12px] font-semibold leading-[1.45] text-primary/35">
                                                    Gõ từ khóa hoặc chọn lọc nhanh để đổi sản phẩm gốc.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm">
                                        <div className="border-b border-primary/10 px-3 py-3">
                                            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Tìm sản phẩm thay thế</div>
                                            <div className="flex h-10 items-center rounded-sm border border-primary/10 bg-primary/[0.03] px-3 transition-all focus-within:border-primary/30 focus-within:bg-white">
                                                <span className="material-symbols-outlined mr-2 text-[16px] text-primary/35">search</span>
                                                <input
                                                    type="text"
                                                    value={replacementDeclarationSearchTerm}
                                                    onChange={(event) => setReplacementDeclarationSearchTerm(event.target.value)}
                                                    disabled={!replacementDeclarationSourceKey}
                                                    placeholder="Gõ mã hoặc tên sản phẩm thay thế..."
                                                    className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/30 focus:outline-none disabled:cursor-not-allowed"
                                                />
                                                {replacementDeclarationSearchTerm ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setReplacementDeclarationSearchTerm('');
                                                            setReplacementDeclarationResults([]);
                                                        }}
                                                        className="ml-2 text-primary/30 transition-all hover:text-brick"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="custom-scrollbar max-h-[300px] overflow-y-auto">
                                            {replacementDeclarationSearchLoading ? (
                                                <div className="px-3 py-5 text-center text-[12px] font-semibold text-primary/40">Đang tìm mã thay thế...</div>
                                            ) : replacementDeclarationResults.length > 0 ? (
                                                replacementDeclarationResults.slice(0, 12).map((entry, index) => {
                                                    const entryKey = getActualReplacementEntryKey(entry);

                                                    return (
                                                        <React.Fragment key={`${entryKey || getProductReplacementDeclarationSku(entry) || 'replacement'}-${index}`}>
                                                            {renderReplacementDeclarationProductRow(entry, {
                                                                actionLabel: 'Thêm vào nhóm',
                                                                onSelect: handleAddReplacementDeclarationProduct,
                                                            })}
                                                        </React.Fragment>
                                                    );
                                                })
                                            ) : (
                                                <div className="px-3 py-8 text-center text-[12px] font-semibold leading-[1.45] text-primary/35">
                                                    Chọn sản phẩm gốc rồi gõ mã, tên hoặc dùng lọc nhanh để thêm mã thay thế.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Các mã thay qua lại</div>
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            <div className="text-[11px] font-semibold text-primary/40">
                                                Gốc + {replacementDeclarationSelectedSkus.length} mã thay thế
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSaveReplacementDeclaration}
                                                disabled={!canSaveReplacementDeclaration}
                                                className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-[10px] font-black uppercase tracking-[0.12em] text-white shadow-sm transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-45"
                                            >
                                                <span className={`material-symbols-outlined text-[13px] ${replacementDeclarationSaving ? 'animate-refresh-spin' : ''}`}>
                                                    {replacementDeclarationSaving ? 'progress_activity' : 'save'}
                                                </span>
                                                Lưu nhóm
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid gap-2 lg:grid-cols-2">
                                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2">
                                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/35">Mã gốc</div>
                                            <div className="mt-1 truncate text-[13px] font-black text-primary">
                                                {getProductReplacementDeclarationName(replacementDeclarationSource)}
                                            </div>
                                            <div className="mt-1 text-[11px] font-semibold text-primary/45">
                                                {getProductReplacementDeclarationSku(replacementDeclarationSource) || 'Chưa có SKU'}
                                            </div>
                                        </div>

                                        {replacementDeclarationSelected.length > 0 ? (
                                            replacementDeclarationSelected.map((entry, index) => {
                                                const entryKey = getActualReplacementEntryKey(entry);

                                                return (
                                                    <div
                                                        key={`${entryKey || getProductReplacementDeclarationSku(entry) || 'selected'}-${index}`}
                                                        className="flex min-w-0 items-start justify-between gap-3 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[13px] font-black text-emerald-900">
                                                                {getProductReplacementDeclarationName(entry)}
                                                            </div>
                                                            <div className="mt-1 text-[11px] font-semibold text-emerald-800/60">
                                                                {getProductReplacementDeclarationSku(entry)}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveReplacementDeclarationProduct(entryKey)}
                                                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-emerald-300/70 bg-white text-emerald-700 transition-all hover:border-brick/30 hover:text-brick"
                                                            title="Bỏ khỏi nhóm"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="rounded-sm border border-dashed border-primary/10 bg-white px-3 py-6 text-center text-[12px] font-semibold text-primary/35">
                                                Chưa thêm mã thay thế.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                                    <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)_auto] lg:items-center">
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Nhóm đã tạo</div>
                                            <div className="mt-1 text-[11px] font-semibold text-primary/40">
                                                Bấm Sửa để nạp nhóm lên trên rồi thêm/bớt mã.
                                            </div>
                                        </div>
                                        <div className="flex h-9 min-w-0 items-center rounded-sm border border-primary/10 bg-primary/[0.03] px-3 transition-all focus-within:border-primary/30 focus-within:bg-white">
                                            <span className="material-symbols-outlined mr-2 text-[15px] text-primary/35">search</span>
                                            <input
                                                type="text"
                                                value={replacementDeclarationGroupsSearchTerm}
                                                onChange={(event) => setReplacementDeclarationGroupsSearchTerm(event.target.value)}
                                                placeholder="Tìm nhóm hoặc mã..."
                                                className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-primary placeholder:text-primary/30 focus:outline-none"
                                            />
                                            {replacementDeclarationGroupsSearchTerm ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setReplacementDeclarationGroupsSearchTerm('')}
                                                    className="ml-2 text-primary/30 transition-all hover:text-brick"
                                                >
                                                    <span className="material-symbols-outlined text-[13px]">close</span>
                                                </button>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleSaveReplacementDeclaration}
                                            disabled={!canSaveReplacementDeclaration}
                                            className="inline-flex h-9 items-center justify-center gap-1 rounded-sm bg-primary px-3 text-[10px] font-black uppercase tracking-[0.12em] text-white shadow-sm transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-45"
                                        >
                                            <span className={`material-symbols-outlined text-[14px] ${replacementDeclarationSaving ? 'animate-refresh-spin' : ''}`}>
                                                {replacementDeclarationSaving ? 'progress_activity' : 'save'}
                                            </span>
                                            Lưu nhóm
                                        </button>
                                    </div>

                                    <div className="custom-scrollbar max-h-[220px] overflow-y-auto rounded-sm border border-primary/10">
                                        {replacementDeclarationGroupsLoading ? (
                                            <div className="px-3 py-5 text-center text-[12px] font-semibold text-primary/40">Đang tải nhóm đã tạo...</div>
                                        ) : replacementDeclarationGroups.length > 0 ? (
                                            replacementDeclarationGroups.map((group) => {
                                                const groupItems = Array.isArray(group?.items) ? group.items : [];
                                                const isEditingGroup = Number(replacementDeclarationGroupId || 0) === Number(group?.id || 0);
                                                const expression = normalizeCanvasText(group?.expression)
                                                    || groupItems.map(getProductReplacementDeclarationSku).filter(Boolean).join(' = ');

                                                return (
                                                    <div
                                                        key={`replacement-declaration-group-${group?.id}`}
                                                        className={`grid gap-3 border-b border-primary/5 px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(150px,0.9fr)_minmax(0,2fr)_auto] lg:items-start ${isEditingGroup ? 'bg-amber-50/70' : 'bg-white'}`}
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[13px] font-black text-primary">
                                                                {group?.name || `Nhóm #${group?.id}`}
                                                            </div>
                                                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-primary/40">
                                                                <span>{groupItems.length || group?.items_count || 0} mã</span>
                                                                {isEditingGroup ? (
                                                                    <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 font-black text-amber-700">
                                                                        Đang sửa
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[12px] font-semibold text-primary/55" title={expression}>
                                                                {expression || 'Chưa có mã'}
                                                            </div>
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {groupItems.slice(0, 8).map((item) => {
                                                                    const sku = getProductReplacementDeclarationSku(item);
                                                                    const stockValue = parseQuantityNumber(item?.available_to_sell, parseQuantityNumber(item?.stock_quantity));

                                                                    return (
                                                                        <span
                                                                            key={`${group?.id}-${sku || item?.product_id || item?.id}`}
                                                                            className="inline-flex max-w-[190px] items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5 text-[10px] font-bold text-primary/60"
                                                                            title={getProductReplacementDeclarationName(item)}
                                                                        >
                                                                            <span className="truncate">{sku || 'N/A'}</span>
                                                                            {stockValue !== null ? (
                                                                                <span className={getAvailableToSellTextClass(stockValue)}>
                                                                                    {formatOrderFormQuantity(stockValue)}
                                                                                </span>
                                                                            ) : null}
                                                                        </span>
                                                                    );
                                                                })}
                                                                {groupItems.length > 8 ? (
                                                                    <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/35">
                                                                        +{groupItems.length - 8}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 items-center justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleEditReplacementDeclarationGroup(group)}
                                                                disabled={groupItems.length < 2}
                                                                className={`inline-flex h-8 items-center gap-1 rounded-sm border px-3 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-45 ${isEditingGroup ? 'border-amber-200 bg-white text-amber-700' : 'border-primary/10 bg-white text-primary/60 hover:border-primary/25 hover:text-primary'}`}
                                                            >
                                                                <span className="material-symbols-outlined text-[13px]">edit</span>
                                                                Sửa
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="px-3 py-8 text-center text-[12px] font-semibold text-primary/35">
                                                Chưa có nhóm mã thay thế phù hợp.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 border-t border-primary/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
                            <div className="text-[11px] font-semibold leading-[1.45] text-primary/40">
                                Sau khi lưu, các mã trong nhóm có thể thay thế 2 chiều khi gửi hàng.
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={closeReplacementDeclarationModal}
                                    className="inline-flex h-10 items-center justify-center rounded-sm border border-primary/10 bg-white px-4 text-[12px] font-black uppercase tracking-[0.12em] text-primary/50 transition-all hover:border-primary/25 hover:text-primary"
                                >
                                    Hủy
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveReplacementDeclaration}
                                    disabled={!canSaveReplacementDeclaration}
                                    className="inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-[0.12em] text-white shadow-sm transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    <span className={`material-symbols-outlined text-[16px] ${replacementDeclarationSaving ? 'animate-refresh-spin' : ''}`}>
                                        {replacementDeclarationSaving ? 'progress_activity' : 'save'}
                                    </span>
                                    Lưu nhóm
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        ), document.body)
        : null;

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
            {isCompactOrderMobileLayout && leavePromptOpen && (
                <div className="fixed inset-0 z-[2600] flex items-end justify-center bg-slate-950/35 px-3 py-0 backdrop-blur-[2px] sm:items-center sm:py-6">
                    <div className="w-full max-w-md overflow-hidden rounded-t-[22px] border border-primary/10 bg-white shadow-2xl sm:rounded-sm">
                        <div className="border-b border-primary/10 bg-primary/[0.03] px-5 py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Đơn chưa lưu</div>
                            <h3 className="mt-1 text-[18px] font-black text-primary">Lưu đơn trước khi thoát?</h3>
                            <p className="mt-2 text-[13px] font-semibold leading-relaxed text-primary/55">
                                {isEdit
                                    ? 'Đơn này đang có thay đổi chưa lưu. Lưu lại rồi thoát, hoặc thoát không lưu các thay đổi.'
                                    : 'Đơn mới đang có dữ liệu. Lưu lại rồi thoát, hoặc thoát không lưu nếu muốn bỏ đơn này.'}
                            </p>
                        </div>
                        <div className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto]">
                            <button
                                type="button"
                                onClick={handleLeavePromptSave}
                                disabled={saving}
                                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] bg-primary px-4 text-[13px] font-black uppercase tracking-[0.08em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-55 sm:col-span-2"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${saving ? 'animate-refresh-spin' : ''}`}>
                                    {saving ? 'progress_activity' : 'save'}
                                </span>
                                Lưu rồi thoát
                            </button>
                            <button
                                type="button"
                                onClick={handleLeavePromptDiscard}
                                disabled={saving}
                                className="inline-flex min-h-[42px] items-center justify-center rounded-[14px] border border-rose-200 bg-rose-50 px-4 text-[12px] font-black uppercase tracking-[0.08em] text-rose-700 transition-all hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
                            >
                                Thoát không lưu
                            </button>
                            <button
                                type="button"
                                onClick={handleLeavePromptStay}
                                disabled={saving}
                                className="inline-flex min-h-[42px] items-center justify-center rounded-[14px] border border-primary/10 bg-white px-4 text-[12px] font-black uppercase tracking-[0.08em] text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-55"
                            >
                                Ở lại
                            </button>
                        </div>
                    </div>
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

                                                    {showProductQuickSetupPanel && productQuickSetupMode === PRODUCT_QUICK_SETUP_MODE_ATTRIBUTE && (
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
                                                                        onClick={saveAndCloseProductQuickSetupPanel}
                                                                        className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">save</span>
                                                                        {'Lưu'}
                                                                    </button>
                                                                </div>

                                                                <div className="mt-2 text-[10px] font-semibold text-primary/40">
                                                                    {activeProductQuickSetupItems.length > 0
                                                                        ? `Đang lưu ${activeProductQuickSetupItems.length} sản phẩm cho bộ lọc này.`
                                                                        : 'Chọn vài sản phẩm để tạo lớp lọc nhanh cho thuộc tính đang chọn.'}
                                                                </div>
                                                                {productQuickSetupLoading && (
                                                                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/10 bg-primary/[0.03] px-2.5 py-1 text-[10px] font-bold text-primary/45">
                                                                        <span className="material-symbols-outlined animate-refresh-spin text-[12px]">refresh</span>
                                                                        Đang tải thêm sản phẩm...
                                                                    </div>
                                                                )}

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
                                                        quickFilterAttribute={isProductQuickModeActive ? activeProductQuickFilterAttribute : null}
                                                        isAlreadyInOrder={Boolean(p.__alreadyInOrder)}
                                                        activeAccountId={activeAccountId}
                                                    />
                                                ))}
                                                {shouldShowProductSearchEmptyState && (
                                                    <div className="p-4 text-center italic text-primary/20 text-[11px] uppercase font-black tracking-widest">{productSearchEmptyMessage}</div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Source picker + selected product chips */}
                                    <div className="relative z-[105] flex w-full min-w-0 items-center gap-2">
                                        {renderProductSourceQuickControls({ fill: formData.items.length === 0 })}
                                        {formData.items.length > 0 && (
                                            <div className="custom-scrollbar flex h-[42px] min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden rounded-sm border border-primary/10 bg-primary/5 px-2 pb-1">
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
                                        )}
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
                                                onClick={() => handleOpenReplacementDeclarationModal(actualProductSectionLine)}
                                                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700 shadow-sm transition-all hover:border-amber-300 hover:bg-amber-100"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">rule</span>
                                                Khai báo thay thế
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
                                                '',
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
                                    const isEditingName = normalizeCanvasText(editingOrderLineName.lineId) === normalizeCanvasText(item.line_id);
                                    const originalNameLabel = getOrderLineOriginalNameLabel(item);
                                    const sourceBadgeLabel = getCrossSellSourceBadgeLabel(item);

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
                                                    onClick={(event) => handleLineItemSelectionClick(event, item.line_id)}
                                                >
                                                    <ProductThumb
                                                        src={item.main_image}
                                                        fallback={(
                                                            <div className="size-full flex items-center justify-center text-[12px] font-semibold text-primary/40">
                                                                #{index + 1}
                                                            </div>
                                                        )}
                                                    />
                                                    <div className={`absolute inset-0 flex items-center justify-center bg-black/10 transition-opacity ${selectedLineItemIds.has(normalizeCanvasText(item?.line_id)) ? 'opacity-100' : 'opacity-0'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedLineItemIds.has(normalizeCanvasText(item?.line_id))}
                                                            onChange={() => {}}
                                                            className="size-4 rounded border-white text-primary focus:ring-primary/30 cursor-pointer pointer-events-none"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            {isEditingName ? (
                                                                <div
                                                                    className="flex min-w-0 items-center gap-1.5"
                                                                    onClick={(event) => event.stopPropagation()}
                                                                    onPointerDown={(event) => event.stopPropagation()}
                                                                >
                                                                    <input
                                                                        type="text"
                                                                        value={editingOrderLineName.value}
                                                                        onChange={(event) => setEditingOrderLineName((prev) => ({ ...prev, value: event.target.value }))}
                                                                        onKeyDown={(event) => {
                                                                            if (event.key === 'Enter') {
                                                                                commitOrderLineNameEditor(event);
                                                                            }
                                                                            if (event.key === 'Escape') {
                                                                                cancelOrderLineNameEditor(event);
                                                                            }
                                                                        }}
                                                                        className="h-9 min-w-0 flex-1 rounded-[12px] border border-primary/15 bg-white px-2.5 text-[13px] font-black text-primary shadow-inner focus:border-primary/30 focus:outline-none"
                                                                        autoFocus
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={commitOrderLineNameEditor}
                                                                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-emerald-200 bg-emerald-50 text-emerald-700"
                                                                        title="Lưu tên"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">check</span>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={cancelOrderLineNameEditor}
                                                                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-primary/10 bg-white text-primary/35"
                                                                        title="Hủy sửa tên"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="group/name-actions flex min-w-0 items-start gap-1.5">
                                                                    <div className={`min-w-0 flex-1 text-[14px] font-black leading-[1.35] ${hasActualOverride ? 'text-rose-700' : 'text-primary'}`}>{item.name || 'Sản phẩm'}</div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(event) => handleToggleActualProductPicker(item, event.currentTarget)}
                                                                        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-[10px] border bg-white transition-all hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 ${
                                                                            hasActualOverride
                                                                                ? 'border-rose-200 text-rose-700'
                                                                                : 'border-primary/10 text-primary/30 opacity-0 group-hover/name-actions:opacity-100'
                                                                        }`}
                                                                        title={hasActualOverride ? 'Đổi sản phẩm thực gửi' : 'Thay sản phẩm khác'}
                                                                        aria-label={hasActualOverride ? 'Đổi sản phẩm thực gửi' : 'Thay sản phẩm khác'}
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">local_shipping</span>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(event) => openOrderLineNameEditor(item, event)}
                                                                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-primary/10 bg-white text-primary/35 transition-all hover:border-primary/25 hover:text-primary"
                                                                        title="Sửa tên trong đơn này"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">edit</span>
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {item.replaced_from_name && (
                                                                <p className="text-[11px] font-medium text-slate-400 mt-0.5 italic line-through truncate" title={`Đổi từ: ${item.replaced_from_name}`}>
                                                                    {item.replaced_from_name}
                                                                </p>
                                                            )}
                                                            {originalNameLabel ? (
                                                                <div className="mt-1 truncate text-[11px] font-semibold leading-[1.35] text-primary/40">
                                                                    {`\u0054\u00ean g\u1ed1c: ${originalNameLabel}`}
                                                                </div>
                                                            ) : null}
                                                            {sourceBadgeLabel ? (
                                                                <div className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-semibold leading-none text-sky-700">
                                                                    <span className="material-symbols-outlined text-[12px]">storefront</span>
                                                                    <span className="truncate">{`\u004e\u0067\u0075\u1ed3\u006e: ${sourceBadgeLabel}`}</span>
                                                                </div>
                                                            ) : null}
                                                            {hasActualOverride ? (
                                                                <OrderLineActualOverrideNotice
                                                                    item={item}
                                                                    onClear={() => { void handleClearActualProductOverride(item.line_id); }}
                                                                    className="mt-1 text-[12px] font-semibold leading-[1.4] text-rose-700"
                                                                />
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
                                                                            <>
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
                                                                            <motion.button
                                                                                initial={{ opacity: 0, scale: 0.5 }}
                                                                                animate={{ opacity: 1, scale: 1 }}
                                                                                exit={{ opacity: 0, scale: 0.5 }}
                                                                                type="button"
                                                                                onClick={handleOpenPriceMultiplierModal}
                                                                                onMouseDown={(event) => event.stopPropagation()}
                                                                                className="order-form-header-action-icon flex items-center justify-center rounded-sm text-emerald-700 transition-all hover:bg-emerald-50 hover:text-emerald-800"
                                                                                title="Nhân hệ số giá bán/giá nhập cho các mục đã chọn"
                                                                                data-screenshot-hide="true"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px]">percent</span>
                                                                            </motion.button>
                                                                            <motion.button
                                                                                initial={{ opacity: 0, scale: 0.5 }}
                                                                                animate={{ opacity: 1, scale: 1 }}
                                                                                exit={{ opacity: 0, scale: 0.5 }}
                                                                                type="button"
                                                                                onClick={handleRemoveSelectedLineItems}
                                                                                onMouseDown={(event) => event.stopPropagation()}
                                                                                className="order-form-header-action-icon flex items-center justify-center rounded-sm text-rose-700 transition-all hover:bg-rose-50 hover:text-brick"
                                                                                title="Xóa các mục đã chọn"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px]">delete_outline</span>
                                                                            </motion.button>
                                                                            </>
                                                                        )}
                                                                    </AnimatePresence>
                                                                    {!hasAnyLineItemSelected && (
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
                                                                    )}
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
                                                onPointerEnter={() => handleLineItemSelectionDragEnter(item.line_id)}
                                                className={`transition-colors group cursor-grab active:cursor-grabbing active:border-primary/20 ${hasActualOrderProductOverride(item) ? 'bg-rose-50/60 hover:bg-rose-50/80' : isPendingOrderAiItem(item) ? 'bg-amber-50/50 hover:bg-amber-50/70' : isOrderAiItem(item) ? 'bg-sky-50/40 hover:bg-sky-50/60' : 'bg-white hover:bg-primary/[0.01]'} ${normalizeCanvasText(selectedOrderLineId) === normalizeCanvasText(item.line_id) ? 'ring-2 ring-inset ring-primary/15' : ''}`}
                                            >
                                                <td className="order-form-cell order-form-cell-tight border border-primary/10 bg-primary/5 text-center">
                                                    <span className="order-form-row-icon material-symbols-outlined text-primary/10 group-hover:text-primary/30 font-bold">drag_indicator</span>
                                                </td>
                                                {desktopVisibleColumnIds.map(colId => {
                                                    switch (colId) {
                                                        case 'selection':
                                                            return (
                                                                <td
                                                                    key={colId}
                                                                    className="order-form-cell order-form-cell-tight select-none cursor-pointer text-center border border-primary/10"
                                                                    onPointerDown={(event) => handleLineItemSelectionPointerDown(event, item.line_id)}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedLineItemIds.has(normalizeCanvasText(item?.line_id))}
                                                                        readOnly
                                                                        onClick={(event) => {
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                        }}
                                                                        onKeyDown={(event) => {
                                                                            if (event.key === ' ' || event.key === 'Enter') {
                                                                                handleLineItemSelectionClick(event, item.line_id);
                                                                            }
                                                                        }}
                                                                        aria-label={`Chọn dòng sản phẩm ${index + 1}`}
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
                                                            const isEditingName = normalizeCanvasText(editingOrderLineName.lineId) === normalizeCanvasText(item.line_id);
                                                            const originalNameLabel = getOrderLineOriginalNameLabel(item);
                                                            const displayNameLabel = getOrderLineDisplayNameLabel(item);
                                                            const sourceBadgeLabel = getCrossSellSourceBadgeLabel(item);

                                                            return (
                                                                <td
                                                                    key={colId}
                                                                    className="order-form-cell border border-primary/10 relative group/cell"
                                                                    onMouseEnter={() => {
                                                                        if (!isEditingName) {
                                                                            updateActiveTruncatedNameCell(itemNameCellKey);
                                                                        }
                                                                    }}
                                                                    onMouseLeave={() => clearActiveTruncatedNameCell(itemNameCellKey)}
                                                                >
                                                                    {isEditingName ? (
                                                                        <div
                                                                            className="flex min-w-0 items-center gap-1.5"
                                                                            onPointerDown={(event) => event.stopPropagation()}
                                                                            onClick={(event) => event.stopPropagation()}
                                                                            data-screenshot-hide="true"
                                                                        >
                                                                            <input
                                                                                type="text"
                                                                                value={editingOrderLineName.value}
                                                                                onChange={(event) => setEditingOrderLineName((prev) => ({ ...prev, value: event.target.value }))}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter') {
                                                                                        commitOrderLineNameEditor(event);
                                                                                    }
                                                                                    if (event.key === 'Escape') {
                                                                                        cancelOrderLineNameEditor(event);
                                                                                    }
                                                                                }}
                                                                                className="h-9 min-w-0 flex-1 rounded-sm border border-primary/15 bg-white px-2 text-[13px] font-bold text-primary shadow-inner focus:border-primary/30 focus:outline-none"
                                                                                autoFocus
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={commitOrderLineNameEditor}
                                                                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100"
                                                                                title="Lưu tên"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[16px]">check</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={cancelOrderLineNameEditor}
                                                                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/35 transition-all hover:border-brick/20 hover:text-brick"
                                                                                title="Hủy sửa tên"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                                        <div className="flex-1 min-w-0">
                                                                            <p
                                                                                ref={(node) => setOrderItemNameRef(itemNameCellKey, node)}
                                                                                className={`${hasActualOrderProductOverride(item) ? 'text-rose-700' : 'text-primary'} font-bold leading-tight truncate`}
                                                                            >
                                                                                {displayNameLabel}
                                                                            </p>
                                                                            {originalNameLabel ? (
                                                                                <p className="order-form-cell-meta truncate font-semibold text-primary/35">
                                                                                    {`\u0054\u00ean g\u1ed1c: ${originalNameLabel}`}
                                                                                </p>
                                                                            ) : null}
                                                                            {sourceBadgeLabel ? (
                                                                                <div className="order-form-cell-meta inline-flex max-w-full items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                                                                                    <span className="material-symbols-outlined text-[12px]">storefront</span>
                                                                                    <span className="truncate">{`\u004e\u0067\u0075\u1ed3\u006e: ${sourceBadgeLabel}`}</span>
                                                                                </div>
                                                                            ) : null}
                                                                            {item.replaced_from_name && (
                                                                                <p className="text-[11px] font-medium text-slate-400 mt-0.5 italic line-through truncate" title={`Đổi từ: ${item.replaced_from_name}`}>
                                                                                    {item.replaced_from_name}
                                                                                </p>
                                                                            )}
                                                                            {hasActualOrderProductOverride(item) ? (
                                                                                <OrderLineActualOverrideNotice
                                                                                    item={item}
                                                                                    onClear={() => { void handleClearActualProductOverride(item.line_id); }}
                                                                                    className="order-form-cell-meta font-semibold text-rose-700"
                                                                                />
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
                                                                        <div className="flex shrink-0 items-center gap-0.5" data-screenshot-hide="true">
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                                onClick={(e) => handleToggleActualProductPicker(item, e.currentTarget)}
                                                                                className={`${hasActualOrderProductOverride(item) ? 'text-rose-700 opacity-100' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-amber-700 p-0.5 rounded transition-all shrink-0`}
                                                                                title={hasActualOrderProductOverride(item) ? 'Đổi sản phẩm thực gửi' : 'Thay sản phẩm khác'}
                                                                                aria-label={hasActualOrderProductOverride(item) ? 'Đổi sản phẩm thực gửi' : 'Thay sản phẩm khác'}
                                                                            >
                                                                                <span className="order-form-cell-copy-icon material-symbols-outlined">local_shipping</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                                onClick={(e) => openOrderLineNameEditor(item, e)}
                                                                                className="p-0.5 text-primary/20 opacity-0 transition-all hover:text-primary group-hover/cell:opacity-100"
                                                                                title="Sửa tên trong đơn này"
                                                                            >
                                                                                <span className="order-form-cell-copy-icon material-symbols-outlined">edit</span>
                                                                            </button>
                                                                        {displayNameLabel && (
                                                                            <button
                                                                                type="button"
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                                onClick={(e) => handleCopyCellValue(displayNameLabel, 'tên sản phẩm', e, nameCopyId)}
                                                                                className={`${copiedText === nameCopyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`}
                                                                                title="Sao chép tên SP"
                                                                            >
                                                                                <span className="order-form-cell-copy-icon material-symbols-outlined">{copiedText === nameCopyId ? 'check' : 'content_copy'}</span>
                                                                            </button>
                                                                        )}
                                                                        </div>
                                                                    </div>
                                                                    )}
                                                                    {!isEditingName && isNameTooltipVisible && (
                                                                        <div className={`absolute left-4 bg-slate-900 text-white p-3 rounded shadow-2xl pointer-events-none z-50 w-80 text-[12px] font-bold border border-white/10 leading-relaxed ${index === 0 ? 'top-full mt-2 origin-top-left' : 'bottom-full mb-2 origin-bottom-left'}`}>
                                                                            <div>{displayNameLabel}</div>
                                                                            {originalNameLabel ? (
                                                                                <div className="mt-2 border-t border-white/15 pt-2 text-[11px] font-medium text-white/70">
                                                                                    {`\u0054\u00ean g\u1ed1c: ${originalNameLabel}`}
                                                                                </div>
                                                                            ) : null}
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
                                <div className="flex min-w-0 flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleToggleActualProductSection}
                                        disabled={formData.items.length === 0}
                                        title={showActualProductSection ? 'Tắt gửi SP khác' : 'Gửi SP khác'}
                                        aria-label={showActualProductSection ? 'Tắt gửi SP khác' : 'Gửi SP khác'}
                                        className={`inline-flex size-10 items-center justify-center rounded-full border shadow-sm transition-all ${showActualProductSection ? 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100/70' : 'border-primary/10 bg-white text-primary/60 hover:border-primary/25 hover:text-primary'} disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            {showActualProductSection ? 'close' : 'local_shipping'}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleOpenReplacementDeclarationModal()}
                                        disabled={formData.items.length === 0}
                                        title="Khai báo SP thay thế"
                                        aria-label="Khai báo SP thay thế"
                                        className="inline-flex size-10 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition-all hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">rule</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleOpenProductReplacementManager}
                                        title="Bảng mã thay thế"
                                        aria-label="Bảng mã thay thế"
                                        className="inline-flex size-10 items-center justify-center rounded-full border border-primary/10 bg-white text-primary/60 shadow-sm transition-all hover:border-primary/25 hover:text-primary"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">table_rows</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleOpenPriceMultiplierModal}
                                        disabled={!hasPriceMultiplierTarget}
                                        title="Nhân hệ số"
                                        aria-label="Nhân hệ số"
                                        className="relative inline-flex size-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                                        data-screenshot-hide="true"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">percent</span>
                                        {hasPriceMultiplierTarget ? (
                                            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-700 px-1 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-white">
                                                {priceMultiplierTargetItems.length}
                                            </span>
                                        ) : null}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRestoreLastDeletedLineItems}
                                        disabled={!hasDeletedLineItemRestore}
                                        className="relative inline-flex size-10 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition-all hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
                                        title={hasDeletedLineItemRestore ? `Khôi phục ${deletedLineItemRestoreCount} sản phẩm vừa xóa` : 'Chưa có sản phẩm vừa xóa để khôi phục'}
                                        aria-label="Khôi phục xóa"
                                        data-screenshot-hide="true"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">undo</span>
                                        {hasDeletedLineItemRestore ? (
                                            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sky-700 px-1 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-white">
                                                {deletedLineItemRestoreCount}
                                            </span>
                                        ) : null}
                                    </button>
                                    {hasAnyLineItemSelected ? (
                                        <button
                                            type="button"
                                            onClick={handleRemoveSelectedLineItems}
                                            title="Xóa đã chọn"
                                            aria-label="Xóa đã chọn"
                                            className="relative inline-flex size-10 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50"
                                            data-screenshot-hide="true"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">delete_outline</span>
                                            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-700 px-1 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-white">
                                                {selectedOrderLineItems.length}
                                            </span>
                                        </button>
                                    ) : null}
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
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1">
                                            <div className="flex items-center gap-1 border-b border-blue-600/10 focus-within:border-blue-600/40 transition-colors">
                                                <input
                                                    ref={discountInputRef}
                                                    type="text"
                                                    value={discountInputValue}
                                                    onChange={handleDiscountInputChange}
                                                    onBlur={handleDiscountInputBlur}
                                                    title="Nhập số tiền giảm hoặc phần trăm, ví dụ 15%"
                                                    className="w-24 text-right bg-transparent py-1 font-bold text-brick text-[15px] focus:outline-none placeholder:text-blue-600/10"
                                                />
                                                <span className="min-w-[12px] font-bold text-brick text-[15px]">
                                                    {discountInputMode === DISCOUNT_INPUT_MODE_PERCENT ? '%' : '₫'}
                                                </span>
                                            </div>
                                            <div className="ml-1 inline-flex overflow-hidden rounded-full border border-blue-600/10 bg-white shadow-sm">
                                                <button
                                                    type="button"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => handleDiscountInputModeChange(DISCOUNT_INPUT_MODE_AMOUNT)}
                                                    title="Nhập giảm bằng số tiền"
                                                    className={`inline-flex h-7 w-8 items-center justify-center text-[12px] font-black transition-all ${discountInputMode === DISCOUNT_INPUT_MODE_AMOUNT ? 'bg-brick text-white' : 'text-blue-600/45 hover:bg-blue-50 hover:text-blue-600'}`}
                                                >
                                                    ₫
                                                </button>
                                                <button
                                                    type="button"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => handleDiscountInputModeChange(DISCOUNT_INPUT_MODE_PERCENT)}
                                                    title="Nhập giảm bằng phần trăm"
                                                    className={`inline-flex h-7 w-8 items-center justify-center text-[12px] font-black transition-all ${discountInputMode === DISCOUNT_INPUT_MODE_PERCENT ? 'bg-brick text-white' : 'text-blue-600/45 hover:bg-blue-50 hover:text-blue-600'}`}
                                                >
                                                    %
                                                </button>
                                            </div>
                                        </div>
                                        {discountInputMode === DISCOUNT_INPUT_MODE_PERCENT && discountPercentPreviewAmount !== null && (
                                            <div className="text-right text-[11px] font-semibold text-brick/55">
                                                = {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(discountPercentPreviewAmount)}₫
                                            </div>
                                        )}
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
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
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
                            </div>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <Field label="Người quản lý lãi lỗ">
                                    <select
                                        name="profit_center_id"
                                        value={formData.profit_center_id || ''}
                                        onChange={handleInputChange}
                                        className={adminInputClassName}
                                    >
                                        <option value="">Chưa gắn quản lý</option>
                                        {selectableProfitCenters.map((center) => (
                                            <option key={center.id} value={center.id}>
                                                {center.manager_name ? `${center.manager_name} - ${center.name}` : center.name}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="NV chốt">
                                    <div className={`${adminInputClassName} flex items-center text-primary/60 bg-slate-50`}>{user?.name || "Super Admin"}</div>
                                </Field>
                            </div>
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

                <div className={`mt-3 grid gap-2 ${mobileFooterSecondaryAction ? 'grid-cols-8' : 'grid-cols-7'}`}>
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
                        onClick={() => handleOpenReplacementDeclarationModal()}
                        disabled={formData.items.length === 0 || saving}
                        title="Khai báo SP thay thế"
                        aria-label="Khai báo SP thay thế"
                        className="inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-amber-200 bg-amber-50 px-2 text-amber-700 transition-all hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">rule</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowBulkReplaceModal(true)}
                        disabled={!hasAnyLineItemSelected || saving}
                        title="Đổi hàng loạt"
                        aria-label="Đổi hàng loạt"
                        className="relative inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-primary/10 bg-white px-2 text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                        {hasAnyLineItemSelected && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brick px-1 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-[#F8FAFC]">
                                {selectedOrderLineItems.length}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenPriceMultiplierModal}
                        disabled={!hasPriceMultiplierTarget || saving}
                        title="Nhân hệ số"
                        aria-label="Nhân hệ số"
                        className="relative inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-emerald-200 bg-emerald-50 px-2 text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">percent</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleRestoreLastDeletedLineItems}
                        disabled={!hasDeletedLineItemRestore || saving}
                        title={hasDeletedLineItemRestore ? `Khôi phục ${deletedLineItemRestoreCount} sản phẩm vừa xóa` : 'Chưa có sản phẩm vừa xóa để khôi phục'}
                        aria-label="Khôi phục xóa"
                        className="relative inline-flex min-h-[52px] items-center justify-center rounded-[16px] border border-sky-200 bg-sky-50 px-2 text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">undo</span>
                        {hasDeletedLineItemRestore && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sky-700 px-1 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-[#F8FAFC]">
                                {deletedLineItemRestoreCount}
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

            {replacementDeclarationModal}

            <OrderAiLineReplacePanel
                show={Boolean(orderAiReplaceLineId)}
                currentLine={activeOrderAiReplaceLine}
                anchorElement={orderAiReplaceAnchorRef.current}
                searchTerm={orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? orderAiReplaceWarehouseSearchTerm
                    : orderAiReplaceSearchTerm}
                onSearchTermChange={orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? setOrderAiReplaceWarehouseSearchTerm
                    : setOrderAiReplaceSearchTerm}
                onClose={closeOrderAiReplacePicker}
                results={orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? orderAiReplaceWarehouseResults
                    : orderAiReplaceResults}
                loading={orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? orderAiReplaceWarehouseLoading
                    : orderAiReplaceLoading}
                onSelect={(entry) => (
                    orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                        ? handleSelectWarehousePickingReplacement(orderAiReplaceLineId, entry)
                        : handleSelectOrderAiLineReplacement(orderAiReplaceLineId, entry)
                )}
                currencyFormatter={quoteCurrencyFormatter}
                showWarehousePickingTab
                activeTab={orderAiReplaceActiveTab}
                onActiveTabChange={handleOrderAiReplacePickerTabChange}
                activeLineNumber={activeOrderAiReplaceLineNumber}
                preserveCurrentLinePrice={orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE}
                emptyMessage={orderAiReplaceActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? 'Dòng này chưa có nhóm mã thay thế. Có thể gõ STT dòng khác để tra tiếp.'
                    : (orderAiReplaceSearchTerm.trim().length >= 2
                        ? 'Không thấy sản phẩm phù hợp, thử đổi từ khóa.'
                        : 'Gõ ít nhất 2 ký tự để tìm sản phẩm thay thế.')}
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
                searchPlaceholder={actualProductPickerActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? 'Nhập STT dòng đơn, mã hoặc tên sản phẩm...'
                    : 'Tìm sản phẩm thực gửi...'}
                preserveCurrentLinePrice
                showWarehousePickingTab
                activeTab={actualProductPickerActiveTab}
                onActiveTabChange={handleActualProductPickerTabChange}
                activeLineNumber={activeActualProductPickerLineNumber}
                emptyMessage={actualProductPickerActiveTab === ACTUAL_PRODUCT_PICKER_TAB_WAREHOUSE
                    ? 'Dòng này chưa có nhóm mã thay thế. Kho có thể gõ STT dòng khác để tra tiếp.'
                    : (actualProductPickerSearchTerm.trim().length >= 2
                        ? 'Không thấy sản phẩm thực gửi phù hợp, thử đổi từ khóa.'
                        : 'Gõ ít nhất 2 ký tự để tìm sản phẩm thực gửi thủ công.')}
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
                                            {sourceQuoteTemplatesLoading && (
                                                <>
                                                    <span className="font-semibold text-sky-600">{'\u0110ang t\u1ea3i m\u1eabu ngu\u1ed3n...'}</span>
                                                    <span className="text-primary/20">/</span>
                                                </>
                                            )}
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
                                                    key={`${template.account_id || 'quote'}-${template.id || normalizeCanvasText(template.name)}`}
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
                selectedItems={selectedOrderLineItems}
                attributes={productQuickFilterAttributes}
                onApply={applyBulkReplacements}
                currencyFormatter={formatQuoteMoney}
            />
            <OrderPriceMultiplierModal
                show={showPriceMultiplierModal}
                onClose={() => setShowPriceMultiplierModal(false)}
                selectedItems={priceMultiplierTargetItems}
                onApply={applyPriceMultiplier}
                currencyFormatter={formatQuoteMoney}
            />
        </div>
    );
};
export default OrderForm;
