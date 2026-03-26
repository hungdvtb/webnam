import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { orderApi, shipmentApi, warehouseApi } from '../../services/api';
import { useNavigate, useLocation } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';
import { SHIPPING_SOUND_STORAGE_KEY, defaultSoundSettings, beep } from '../../components/admin/ShippingSettingsPanel';
import OrderInventorySlipDrawer from '../../components/admin/OrderInventorySlipDrawer';
import { printOrders } from '../../utils/orderPrint';

const DEFAULT_COLUMNS = [
    { id: 'order_number', label: 'Mã Đơn', minWidth: '140px', fixed: true },
    { id: 'customer', label: 'Khách Hàng', minWidth: '180px' },
    { id: 'province', label: 'Thành phố', minWidth: '130px' },
    { id: 'ward', label: 'Phường', minWidth: '130px' },
    { id: 'shipping_address', label: 'Địa Chỉ', minWidth: '220px' },
    { id: 'items', label: 'Sản Phẩm', minWidth: '250px' },
    { id: 'total_price', label: 'Tổng Tiền', minWidth: '130px' },
    { id: 'created_at', label: 'Ngày Đặt', minWidth: '112px' },
    { id: 'notes', label: 'Ghi Chú Đơn', minWidth: '180px' },
    { id: 'status', label: 'Trạng Thái', minWidth: '120px', align: 'left' },
    { id: 'shipping_carrier_name', label: 'Đơn vị VC', minWidth: '140px' },
    { id: 'shipping_tracking_code', label: 'Mã vận đơn', minWidth: '170px' },
    { id: 'shipping_dispatched_at', label: 'Ngày gửi VC', minWidth: '120px' },
];

DEFAULT_COLUMNS.splice(7, 0, { id: 'inventory_slips', label: 'Phiếu kho', minWidth: '180px' });

const ORDER_TABLE_COLUMNS = [...DEFAULT_COLUMNS];

const EXPORT_SLIP_FILTER_OPTIONS = [
    { value: 'created', label: 'Đã tạo phiếu xuất' },
    { value: 'missing', label: 'Chưa tạo phiếu xuất' },
];

const RETURN_SLIP_FILTER_OPTIONS = [
    { value: 'created', label: 'Đã tạo phiếu hoàn' },
    { value: 'missing', label: 'Chưa tạo phiếu hoàn' },
];

const DAMAGED_SLIP_FILTER_OPTIONS = [
    { value: 'created', label: 'Đã tạo phiếu hỏng' },
    { value: 'missing', label: 'Chưa tạo phiếu hỏng' },
];

const INVENTORY_SLIP_FILTERS = [
    { key: 'export_slip_state', label: 'Phiếu xuất', options: EXPORT_SLIP_FILTER_OPTIONS },
    { key: 'return_slip_state', label: 'Phiếu hoàn', options: RETURN_SLIP_FILTER_OPTIONS },
    { key: 'damaged_slip_state', label: 'Phiếu hỏng', options: DAMAGED_SLIP_FILTER_OPTIONS },
];

/**
 * Hover card that shows full product list for an order.
 * Stays open while mouse moves between trigger and card.
 * Uses Portal for unconstrained positioning and smart repositioning.
 */
const OrderProductsPortal = ({
    items,
    copiedText,
    onCopy,
    anchorRef,
    visible,
    onClose
}) => {
    const [position, setPosition] = useState(null);
    const portalRef = useRef(null);

    const updatePosition = useCallback(() => {
        if (!anchorRef.current) return;

        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const cardWidth = 600;

        // Start below the main header area (approx 120px from top)
        let top = 120;
        let left = viewportWidth / 2 - cardWidth / 2;

        // Ensure it doesn't overflow bottom
        const maxHeight = viewportHeight - 160;

        setPosition({ top, left, width: cardWidth, maxHeight });
    }, [items.length]);

    useEffect(() => {
        if (visible) {
            updatePosition();
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true);
            return () => {
                window.removeEventListener('resize', updatePosition);
                window.removeEventListener('scroll', updatePosition, true);
            };
        }
    }, [visible, updatePosition]);

    if (!visible || !items?.length) return null;

    return createPortal(
        <div className="fixed inset-0 z-[99998] flex items-start justify-start pointer-events-none">
            {/* Backdrop for focus */}
            <div
                className="absolute inset-0 bg-primary/5 backdrop-blur-[2px] pointer-events-auto animate-in fade-in duration-300"
                onClick={onClose}
            />

            <div
                ref={portalRef}
                style={{
                    position: 'fixed',
                    top: position?.top || 120,
                    left: position?.left || 0,
                    width: position?.width || 600,
                    maxHeight: position?.maxHeight || '75vh',
                    zIndex: 99999,
                    visibility: position ? 'visible' : 'hidden'
                }}
                className="bg-white border border-primary/20 shadow-[0_25px_70px_-15px_rgba(27,54,93,0.4)] rounded-sm flex flex-col pointer-events-auto animate-in fade-in zoom-in-95 slide-in-from-top-8 duration-500 origin-top"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between bg-white sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-sm bg-primary/5 flex items-center justify-center border border-primary/10">
                            <span className="material-symbols-outlined text-primary text-[24px]">shopping_cart_checkout</span>
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-primary/40 uppercase tracking-[0.2em] leading-tight mb-0.5">Danh sách đầy đủ</p>
                            <h3 className="text-[16px] font-extrabold text-primary tracking-tight">Chi tiết {items.length} sản phẩm</h3>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-brick/10 hover:text-brick text-primary/30 transition-all flex items-center justify-center">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* Sub-header columns */}
                <div className="px-6 py-2.5 bg-primary/5 flex items-center gap-4 border-b border-primary/10">
                    <div className="w-12 text-center text-[10px] font-black text-primary/40 uppercase tracking-widest">SL</div>
                    <div className="flex-1 text-[10px] font-black text-primary/40 uppercase tracking-widest text-left">Thông tin sản phẩm</div>
                    <div className="w-32 text-right text-[10px] font-black text-primary/40 uppercase tracking-widest px-4">Đơn giá</div>
                </div>

                {/* Items List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1 bg-[#FCFDFF]">
                    {items.map((item, idx) => {
                        const name = item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`;
                        const sku = item.product?.sku || item.product_sku_snapshot || null;
                        const price = item.price ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price) : null;

                        return (
                            <div key={idx} className="flex items-center gap-4 px-4 py-3 transition-all group/item">
                                <div className="w-12 shrink-0 flex justify-center">
                                    <div className="flex h-8 min-w-[36px] items-center justify-center rounded-sm border border-orange-200 bg-orange-50 px-2 text-[13px] font-black leading-none text-orange-600">
                                        {item.quantity}x
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 group/name_p">
                                        <span className="text-[14px] font-bold text-primary truncate block" title={name}>{name}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onCopy(name, e); }}
                                            className={`p-1 rounded-sm hover:bg-primary/10 opacity-0 group-hover/name_p:opacity-100 transition-all ${copiedText === name ? 'text-green-500 opacity-100' : 'text-primary/30'}`}
                                            title="Sao chép tên"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">{copiedText === name ? 'check_circle' : 'content_copy'}</span>
                                        </button>
                                    </div>
                                    {sku && (
                                        <div className="flex items-center gap-2 group/sku_p mt-0.5">
                                            <span className="text-[12px] font-mono font-black text-orange-600/70 tracking-tight">#{sku}</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onCopy(sku, e); }}
                                                className={`p-0.5 rounded-sm hover:bg-primary/10 opacity-0 group-hover/sku_p:opacity-100 transition-all ${copiedText === sku ? 'text-green-500 opacity-100' : 'text-primary/30'}`}
                                                title="Sao chép mã"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">{copiedText === sku ? 'check_circle' : 'content_copy'}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="w-32 shrink-0 text-right px-4">
                                    {price ? (
                                        <span className="text-[15px] text-brick font-black tracking-tighter">{price}</span>
                                    ) : (
                                        <span className="text-[12px] text-primary/30 italic">Li?n h?</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-primary/10 bg-primary/5 flex justify-between items-center rounded-b-sm">
                    <span className="text-[10px] text-primary/40 font-black uppercase tracking-[0.1em]">Nh?n ESC ho?c click v?ng x?m ?? ??ng</span>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-primary/40 font-black uppercase">T?ng s?n ph?m:</span>
                        <span className="text-[13px] text-primary font-black px-2 py-0.5 bg-white border border-primary/20 rounded-sm">{items.length}</span>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const StatusDropdownPortal = ({ order, orderStatuses, onUpdate, anchorRef, visible, onClose, statusMenuRef }) => {
    const [position, setPosition] = useState(null);
    useEffect(() => {
        if (visible && anchorRef.current) {
            const updatePosition = () => {
                const rect = anchorRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const dropdownWidth = 260;
                const estimatedHeight = Math.min(orderStatuses.length * 48 + 50, viewportHeight * 0.6);
                let top = rect.bottom + 6;
                let left = rect.left + (rect.width / 2) - (dropdownWidth / 2);
                let placement = 'bottom';
                if (viewportHeight - rect.bottom < (estimatedHeight + 10) && rect.top > viewportHeight - rect.bottom) { top = rect.top - 6; placement = 'top'; }
                left = Math.max(10, Math.min(left, window.innerWidth - dropdownWidth - 20));
                setPosition({ top, left, placement });
            };
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
            return () => { window.removeEventListener('scroll', updatePosition, true); window.removeEventListener('resize', updatePosition); };
        }
    }, [visible, anchorRef, orderStatuses]);

    if (!visible) return null;

    return createPortal(
        <div ref={statusMenuRef} style={{ position: 'fixed', top: position?.top || 0, left: position?.left || 0, transform: position?.placement === 'top' ? 'translateY(-100%)' : 'none', zIndex: 999999, width: 260, opacity: position ? 1 : 0 }} className={`bg-white border border-primary/10 shadow-22xl rounded-sm py-2 overflow-hidden ${position?.placement === 'top' ? 'origin-bottom' : 'origin-top'}`} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-2.5 border-b border-primary/5 mb-1 flex items-center gap-2.5 opacity-40"><span className="material-symbols-outlined text-[16px]">swap_vert</span><p className="text-[10px] font-black uppercase tracking-[0.2em]">Cập nhật trạng thái</p></div>
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                {orderStatuses.map(s => (
                    <button key={s.id} onClick={() => { onUpdate(order.id, s.code); onClose(); }} className={`w-full flex items-center justify-between px-5 py-3.5 text-sm transition-all hover:bg-primary/5 relative ${order.status === s.code ? 'bg-primary/5 text-primary font-bold' : 'text-primary'}`}>
                        <div className="flex items-center gap-4"><div className="w-4 h-4 rounded-full border-2 border-white ring-1 ring-primary/10" style={{ backgroundColor: s.color }}></div><span className="truncate text-[14px] font-bold">{s.name}</span></div>
                        {order.status === s.code && <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-primary font-bold">check</span></div>}
                    </button>
                ))}
            </div>
        </div>,
        document.body
    );
};

const SHIPPING_ALERT_SEEN_STORAGE_KEY = 'order_shipping_alert_seen_v1';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const formatMoney = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value || 0));

const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })}`;
};

const formatDateTimeParts = (value) => {
    if (!value) return { date: '-', time: '', text: '-' };

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        const rawText = String(value).trim();
        const [datePart = rawText, timePart = ''] = rawText.split(/\s+/, 2);
        return { date: datePart, time: timePart, text: rawText || '-' };
    }

    const datePart = date.toLocaleDateString('vi-VN');
    const timePart = date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    return {
        date: datePart,
        time: timePart,
        text: `${datePart} ${timePart}`,
    };
};

const getCompactColumnLabelLines = (columnId, label) => {
    if (columnId === 'created_at') return ['Ngày', 'đặt'];
    if (columnId === 'shipping_dispatched_at') return ['Ngày gửi', 'VC'];
    return [label];
};

const MAIN_ORDER_KIND = 'official';
const DRAFT_ORDER_KIND = 'draft';
const CANCEL_DISPATCH_ALLOWED_SHIPMENT_STATUSES = new Set([
    'created',
    'waiting_pickup',
    'picked_up',
    'shipped',
    'in_transit',
    'out_for_delivery',
]);
const CANCEL_DISPATCH_BLOCKED_ORDER_STATUSES = new Set([
    'completed',
    'pending_return',
    'returned',
    'cancelled',
]);
const CANCEL_DISPATCH_STATUS_LABELS = {
    created: 'Mới tạo',
    waiting_pickup: 'Chờ lấy hàng',
    picked_up: 'Đã lấy hàng',
    shipped: 'Đã gửi hàng',
    in_transit: 'Đang trung chuyển',
    out_for_delivery: 'Đang giao hàng',
    delivered: 'Giao thành công',
    delivery_failed: 'Giao thất bại',
    returning: 'Đang hoàn',
    returned: 'Đã hoàn',
    canceled: 'Đã hủy',
};

const isDraftOrder = (orderKind) => String(orderKind || MAIN_ORDER_KIND) === DRAFT_ORDER_KIND;
const getTargetListView = (orderKind) => (isDraftOrder(orderKind) ? 'draft' : 'main');
const buildOrderListUrl = (view = 'main') => {
    if (view === 'draft') return '/admin/orders?view=draft';
    if (view === 'trash') return '/admin/orders?view=trash';
    return '/admin/orders';
};

const getCancelDispatchEligibility = (order) => {
    if (!order) {
        return {
            eligible: false,
            reason: 'Không tìm thấy đơn hàng trong danh sách hiện tại.',
        };
    }

    if (String(order.order_kind || MAIN_ORDER_KIND) !== MAIN_ORDER_KIND) {
        return {
            eligible: false,
            reason: 'Chỉ hỗ trợ hủy gửi vận chuyển cho đơn hàng chính.',
        };
    }

    if (order.type === 'inventory_export') {
        return {
            eligible: false,
            reason: 'Phiếu xuất nội bộ không thuộc luồng gửi vận chuyển để rollback.',
        };
    }

    if (CANCEL_DISPATCH_BLOCKED_ORDER_STATUSES.has(String(order.status || ''))) {
        return {
            eligible: false,
            reason: 'Đơn đang ở trạng thái không hợp lệ để rollback gửi vận chuyển.',
        };
    }

    const activeShipment = order.active_shipment || null;
    if (activeShipment) {
        const shipmentStatus = String(activeShipment.shipment_status || '');
        if (!CANCEL_DISPATCH_ALLOWED_SHIPMENT_STATUSES.has(shipmentStatus)) {
            return {
                eligible: false,
                reason: `Vận đơn đang ở trạng thái "${CANCEL_DISPATCH_STATUS_LABELS[shipmentStatus] || shipmentStatus || 'không xác định'}" nên chưa thể hủy gửi.`,
            };
        }

        return { eligible: true, reason: '' };
    }

    const hasLegacyDispatchMarker = Boolean(
        order.shipping_tracking_code
        || order.shipping_carrier_code
        || order.shipping_carrier_name
        || order.shipping_dispatched_at
        || order.shipping_status
    );

    if (hasLegacyDispatchMarker) {
        return { eligible: true, reason: '' };
    }

    return {
        eligible: false,
        reason: 'Đơn này chưa được gửi sang đơn vị vận chuyển.',
    };
};

const LIST_VIEW_META = {
    main: {
        listTitle: 'Quản lý đơn hàng',
        emptyTitle: 'Không tìm thấy đơn hàng nào',
        emptyDescription: 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm',
        selectedLabel: 'đơn hàng',
        createTitle: 'Tạo đơn hàng mới',
    },
    draft: {
        listTitle: 'Đơn nháp',
        emptyTitle: 'Chưa có đơn nháp',
        emptyDescription: 'Các đơn đã chuyển sang đơn nháp sẽ hiển thị tại đây',
        selectedLabel: 'đơn nháp',
        createTitle: 'Tạo đơn hàng mới',
    },
    trash: {
        listTitle: 'Thùng rác đơn hàng',
        emptyTitle: 'Thùng rác đang trống',
        emptyDescription: 'Các đơn đã chuyển vào thùng rác sẽ hiển thị tại đây',
        selectedLabel: 'đơn trong thùng rác',
        createTitle: 'Tạo đơn hàng mới',
    },
};

const inventorySlipToneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-primary/15 bg-primary/[0.04] text-primary/70',
};

const inventorySlipChipClasses = {
    export: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    return: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    damaged: 'border-rose-200 bg-rose-50 text-rose-700',
};

const getAlertSignature = (alert) => `${alert.id}:${alert.shipping_issue_code || alert.active_shipment?.problem_code || 'issue'}`;

const playShippingNotificationSound = (settings) => {
    if (!settings?.enabled) return;
    if (!settings.useDefaultSound && settings.customAudioDataUrl) {
        const audio = new Audio(settings.customAudioDataUrl);
        audio.play().catch(() => {});
        return;
    }
    beep();
};

const getOrderCustomerPhoneTextClass = (order) => {
    if (order?.has_duplicate_phone_with_matching_product || order?.duplicate_phone_color === 'blue') {
        return 'text-blue-700';
    }

    if (order?.has_duplicate_phone || order?.duplicate_phone_color === 'red') {
        return 'text-red-600';
    }

    return 'text-[#111]';
};

const ShippingAlertsPopover = ({ alerts, unreadCount, onClose, onOpenOrder, onMarkAllSeen }) => (
    <div className="absolute top-full left-0 mt-2 w-[360px] rounded-sm border border-primary/15 bg-white shadow-2xl z-[70] overflow-hidden">
        <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between gap-3">
            <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/40">Cảnh báo vận chuyển</p>
                <p className="text-[13px] font-bold text-primary mt-1">{unreadCount} đơn đang cần xử lý</p>
            </div>
            <div className="flex items-center gap-2">
                <button type="button" onClick={onMarkAllSeen} className="text-[11px] font-black uppercase tracking-wide text-primary hover:text-primary/70">
                    Đã xem
                </button>
                <button type="button" onClick={onClose} className="text-primary/30 hover:text-primary">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
            {alerts.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] font-bold text-primary/40">Chưa có cảnh báo vận chuyển.</div>
            ) : (
                alerts.map((alert) => (
                    <button
                        key={getAlertSignature(alert)}
                        type="button"
                        onClick={() => onOpenOrder(alert)}
                        className="w-full text-left px-4 py-3 border-b border-primary/10 hover:bg-primary/[0.03] transition-all"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex w-2.5 h-2.5 rounded-full bg-brick shrink-0 mt-1"></span>
                                    <p className="text-[13px] font-black text-primary truncate">{alert.order_number}</p>
                                </div>
                                <p className="text-[12px] font-bold text-primary/70 mt-1 truncate">{alert.customer_name || 'Khách hàng chưa rõ'}</p>
                                <p className="text-[12px] text-brick font-semibold mt-1 line-clamp-2">{alert.shipping_issue_message || alert.active_shipment?.problem_message || 'Đơn đang có vấn đề vận chuyển cần kiểm tra.'}</p>
                                <p className="text-[11px] text-primary/40 mt-2 truncate">
                                    {alert.shipping_tracking_code || alert.active_shipment?.carrier_tracking_code || 'Chưa có mã vận đơn'}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[11px] font-bold text-primary/40">{formatDateTime(alert.shipping_issue_detected_at || alert.active_shipment?.problem_detected_at)}</p>
                                <span className="inline-flex mt-2 px-2 py-1 rounded-full bg-brick/10 text-brick text-[10px] font-black uppercase tracking-wide">Có vấn đề</span>
                            </div>
                        </div>
                    </button>
                ))
            )}
        </div>
    </div>
);

const ShippingDispatchModal = ({
    open,
    carriers,
    warehouses,
    carrierCode,
    onCarrierChange,
    warehouseId,
    onWarehouseChange,
    preview,
    loadingPreview,
    submitting,
    onClose,
    onSubmit,
}) => {
    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-4xl rounded-sm bg-white shadow-2xl border border-primary/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between gap-4 bg-primary/[0.02]">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/40">G?i ??n v? v?n chuy?n</p>
                        <h3 className="text-[18px] font-black text-primary mt-1">Chọn hãng và gửi hàng loạt</h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-primary/30 hover:text-primary">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                            <label className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/50 block mb-2">??n v? v?n chuy?n</label>
                            <div className="grid grid-cols-1 gap-3">
                                {carriers.map((carrier) => (
                                    <button
                                        key={carrier.carrier_code}
                                        type="button"
                                        onClick={() => onCarrierChange(carrier.carrier_code)}
                                        className={`rounded-sm border px-4 py-3 text-left transition-all ${
                                            carrierCode === carrier.carrier_code ? 'border-primary bg-primary/[0.04] shadow-sm' : 'border-primary/10 hover:border-primary/30'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[13px] font-black text-primary">{carrier.carrier_name}</p>
                                                <p className="text-[11px] text-primary/40 mt-1">{carrier.webhook_url || 'Đã kết nối API'}</p>
                                            </div>
                                            {carrier.default_warehouse_name && (
                                                <span className="px-2 py-1 rounded-full bg-primary/[0.06] text-primary text-[10px] font-black">
                                                    {carrier.default_warehouse_name}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/50 block mb-2">Kho gửi hàng</label>
                            <select
                                value={warehouseId || ''}
                                onChange={(e) => onWarehouseChange(e.target.value)}
                                className="w-full h-11 rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary"
                            >
                                <option value="">Dùng kho mặc định đã cấu hình</option>
                                {warehouses.map((warehouse) => (
                                    <option key={warehouse.id} value={warehouse.id}>
                                        {warehouse.name}{warehouse.is_active ? '' : ' (Tạm ngưng)'}
                                    </option>
                                ))}
                            </select>
                            <div className="mt-3 rounded-sm border border-primary/10 bg-white px-4 py-3 min-h-[92px]">
                                {preview?.warehouse ? (
                                    <>
                                        <p className="text-[13px] font-black text-primary">{preview.warehouse.name}</p>
                                        <p className="text-[12px] text-primary/60 mt-1">
                                            {preview.warehouse.contact_name || 'Chưa có người phụ trách'}{preview.warehouse.phone ? ` - ${preview.warehouse.phone}` : ''}
                                        </p>
                                        <p className="text-[12px] text-primary/50 mt-1">
                                            {preview.warehouse.address || 'Chưa có địa chỉ'}{preview.warehouse.address ? ' - ' : ''}{[preview.warehouse.ward_name, preview.warehouse.district_name, preview.warehouse.province_name].filter(Boolean).join(', ')}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-[12px] text-primary/45 font-bold">Chưa chọn kho override. Hệ thống sẽ dùng kho mặc định của đơn vị vận chuyển nếu đã cấu hình.</p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] p-4">
                        {loadingPreview ? (
                            <div className="py-10 flex items-center justify-center">
                                <div className="w-8 h-8 border-4 border-primary/10 border-t-primary rounded-full animate-refresh-spin"></div>
                            </div>
                        ) : preview ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="rounded-sm border border-green-200 bg-green-50 px-4 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-700/60">C? th? g?i</p>
                                        <p className="text-[20px] font-black text-green-700 mt-1">{preview.valid_count || 0}</p>
                                    </div>
                                    <div className="rounded-sm border border-red-200 bg-red-50 px-4 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-700/60">L?i d? li?u</p>
                                        <p className="text-[20px] font-black text-red-700 mt-1">{preview.invalid_count || 0}</p>
                                    </div>
                                    <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Phí dự kiến</p>
                                        <p className="text-[20px] font-black text-primary mt-1">{formatMoney(preview.estimated_shipping_fee || 0)}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div className="rounded-sm border border-primary/10 bg-white">
                                        <div className="px-4 py-3 border-b border-primary/10">
                                            <p className="text-[12px] font-black text-primary uppercase tracking-wide">??n h?p l?</p>
                                        </div>
                                        <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-primary/10">
                                            {(preview.valid_orders || []).length === 0 ? (
                                                <div className="px-4 py-6 text-[13px] text-primary/40">Kh?ng c? ??n h?p l?.</div>
                                            ) : (
                                                (preview.valid_orders || []).map((item) => (
                                                    <div key={item.id} className="px-4 py-3">
                                                        <p className="text-[13px] font-black text-primary">{item.order_number}</p>
                                                        <p className="text-[12px] text-primary/50 mt-1">{item.customer_name}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                    <div className="rounded-sm border border-primary/10 bg-white">
                                        <div className="px-4 py-3 border-b border-primary/10">
                                            <p className="text-[12px] font-black text-primary uppercase tracking-wide">??n ch?a th? g?i</p>
                                        </div>
                                        <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-primary/10">
                                            {(preview.invalid_orders || []).length === 0 ? (
                                                <div className="px-4 py-6 text-[13px] text-primary/40">T?t c? ??n ?? s?n s?ng.</div>
                                            ) : (
                                                (preview.invalid_orders || []).map((item) => (
                                                    <div key={item.id} className="px-4 py-3">
                                                        <p className="text-[13px] font-black text-primary">{item.order_number}</p>
                                                        <p className="text-[12px] text-brick mt-1">{item.reason}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="py-10 text-center text-[13px] font-bold text-primary/40">?ang chu?n b? danh s?ch ??n g?i v?n chuy?n...</div>
                        )}
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-primary/10 bg-white flex items-center justify-end gap-3">
                    <button type="button" onClick={onClose} className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wide hover:bg-primary/5">
                        Đóng
                    </button>
                    <button
                        type="button"
                        onClick={onSubmit}
                        disabled={submitting || loadingPreview || !preview || !(preview.valid_count > 0)}
                        className="h-10 px-5 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wide hover:bg-primary/90 disabled:opacity-50"
                    >
                        {submitting ? 'Đang gửi...' : 'Gửi sang đơn vị vận chuyển'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const QuickShipmentModal = ({
    open,
    rows,
    blockedOrders,
    carrierOptions,
    submitting,
    onFieldChange,
    onClose,
    onSubmit,
}) => {
    if (!open) return null;

    const editableRows = rows.filter((row) => !row.locked);
    const hasInvalidRow = editableRows.some((row) => (
        !row.tracking_number?.trim()
        || !row.carrier_name?.trim()
        || row.shipping_cost === ''
        || Number(row.shipping_cost) < 0
    ));

    return createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-5xl rounded-sm bg-white shadow-2xl border border-primary/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between gap-4 bg-primary/[0.02]">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-sm bg-primary/5 border border-primary/10 flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-[22px]">flash_on</span>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/40">Gửi vận chuyển nhanh</p>
                            <h3 className="text-[18px] font-black text-primary mt-1">Nhập tay thông tin gửi hàng, không gọi API</h3>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="text-primary/30 hover:text-primary">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Đơn được chọn</p>
                            <p className="text-[20px] font-black text-primary mt-1">{rows.length + blockedOrders.length}</p>
                        </div>
                        <div className="rounded-sm border border-green-200 bg-green-50 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-700/60">Có thể gửi nhanh</p>
                            <p className="text-[20px] font-black text-green-700 mt-1">{editableRows.length}</p>
                        </div>
                        <div className="rounded-sm border border-red-200 bg-red-50 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-700/60">Đã có vận đơn</p>
                            <p className="text-[20px] font-black text-red-700 mt-1">{blockedOrders.length}</p>
                        </div>
                    </div>

                    <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-700/80">Luồng tạm thời</p>
                        <p className="text-[12px] text-amber-800 font-semibold mt-1">
                            Tính năng này chỉ lưu tay mã vận đơn, đơn vị vận chuyển và tiền ship để tạo vận đơn nội bộ, không gửi đơn sang API hãng vận chuyển.
                        </p>
                    </div>

                    {blockedOrders.length > 0 && (
                        <div className="rounded-sm border border-red-200 bg-red-50 px-4 py-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-red-700/70">Đơn đã có vận đơn nên bị khóa</p>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                {blockedOrders.map((row) => (
                                    <div key={row.id} className="rounded-sm border border-red-200 bg-white px-3 py-3">
                                        <p className="text-[13px] font-black text-primary">{row.order_number}</p>
                                        <p className="text-[12px] text-primary/60 mt-1">{row.customer_name || 'Chưa có tên khách'}</p>
                                        <p className="text-[12px] text-red-600 font-semibold mt-2">
                                            {row.locked_message || 'Đơn này đã được gửi vận chuyển trước đó.'}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="rounded-sm border border-primary/10 overflow-hidden">
                        <div className="px-4 py-3 border-b border-primary/10 bg-[#fcfcfa] flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/40">Danh sách nhập liệu</p>
                                <p className="text-[12px] text-primary/55 mt-1">Nếu chọn nhiều đơn, mỗi đơn nhập mã vận đơn riêng. Đơn vị vận chuyển và phí ship có thể giống nhau hoặc khác nhau.</p>
                            </div>
                            <div className="text-[11px] font-bold text-primary/40 whitespace-nowrap">
                                {editableRows.length} dòng cần nhập
                            </div>
                        </div>

                        {editableRows.length === 0 ? (
                            <div className="px-4 py-10 text-center text-[13px] font-bold text-primary/40">
                                Không còn đơn hợp lệ để gửi vận chuyển nhanh.
                            </div>
                        ) : (
                            <div className="divide-y divide-primary/10">
                                {editableRows.map((row) => (
                                    <div key={row.id} className="px-4 py-4 grid grid-cols-1 xl:grid-cols-[220px,1fr,240px,180px] gap-4 items-start">
                                        <div className="rounded-sm border border-primary/10 bg-primary/[0.02] px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/35">Đơn hàng</p>
                                            <p className="text-[14px] font-black text-primary mt-1">{row.order_number}</p>
                                            <p className="text-[12px] text-primary/60 mt-1">{row.customer_name || 'Chưa có tên khách'}</p>
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/50 block mb-2">Mã vận đơn</label>
                                            <input
                                                type="text"
                                                value={row.tracking_number}
                                                onChange={(event) => onFieldChange(row.id, 'tracking_number', event.target.value)}
                                                placeholder="Nhập mã vận đơn"
                                                className="w-full h-11 rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/50 block mb-2">Đơn vị vận chuyển</label>
                                            <input
                                                type="text"
                                                list="quick-dispatch-carriers"
                                                value={row.carrier_name}
                                                onChange={(event) => onFieldChange(row.id, 'carrier_name', event.target.value)}
                                                placeholder="Ví dụ: Giao Hàng Nhanh"
                                                className="w-full h-11 rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/50 block mb-2">Tiền ship</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1000"
                                                value={row.shipping_cost}
                                                onChange={(event) => onFieldChange(row.id, 'shipping_cost', event.target.value)}
                                                placeholder="0"
                                                className="w-full h-11 rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <datalist id="quick-dispatch-carriers">
                        {carrierOptions.map((carrier) => (
                            <option key={carrier.id || carrier.code || carrier.name} value={carrier.name} />
                        ))}
                    </datalist>
                </div>

                <div className="px-6 py-4 border-t border-primary/10 bg-white flex items-center justify-between gap-3">
                    <p className="text-[11px] text-primary/45 font-bold">
                        Lưu xong hệ thống sẽ chuyển đơn sang trạng thái đang giao hàng và tạo vận đơn trong màn quản lý vận đơn.
                    </p>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={onClose} className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wide hover:bg-primary/5">
                            Đóng
                        </button>
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={submitting || editableRows.length === 0 || hasInvalidRow}
                            className="h-10 px-5 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wide hover:bg-primary/90 disabled:opacity-50"
                        >
                            {submitting ? 'Đang lưu...' : 'Lưu gửi vận chuyển nhanh'}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const OrderList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const filterRef = useRef(null);
    const columnSettingsRef = useRef(null);
    const [orderStatuses, setOrderStatuses] = useState([]);
    const [orders, setOrders] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const initialListParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const [currentView, setCurrentView] = useState(() => {
        const view = initialListParams.get('view');
        return ['draft', 'trash'].includes(view) ? view : 'main';
    });
    const [copiedText, setCopiedText] = useState(null);
    const [statusMenuOrderId, setStatusMenuOrderId] = useState(null);
    const [productPopupOrderId, setProductPopupOrderId] = useState(null);
    const [inventorySlipOrderId, setInventorySlipOrderId] = useState(null);
    const productPopupAnchorRef = useRef(null);
    const statusMenuAnchorRef = useRef(null);
    const statusMenuRef = useRef(null);

    const [notification, setNotification] = useState(null);
    const [printingOrders, setPrintingOrders] = useState(false);
    const [shippingAlerts, setShippingAlerts] = useState([]);
    const [showShippingAlerts, setShowShippingAlerts] = useState(false);
    const [shippingAlertUnread, setShippingAlertUnread] = useState([]);
    const [shippingSoundSettings, setShippingSoundSettings] = useState(() => {
        const saved = localStorage.getItem(SHIPPING_SOUND_STORAGE_KEY);
        return saved ? JSON.parse(saved) : defaultSoundSettings;
    });
    const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
    const [dispatchPreview, setDispatchPreview] = useState(null);
    const [dispatchPreviewLoading, setDispatchPreviewLoading] = useState(false);
    const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
    const [cancelDispatchSubmitting, setCancelDispatchSubmitting] = useState(false);
    const [quickDispatchModalOpen, setQuickDispatchModalOpen] = useState(false);
    const [quickDispatchSubmitting, setQuickDispatchSubmitting] = useState(false);
    const [quickDispatchRows, setQuickDispatchRows] = useState({});
    const [connectedCarriers, setConnectedCarriers] = useState([]);
    const [manualCarrierOptions, setManualCarrierOptions] = useState([]);
    const [selectedCarrierCode, setSelectedCarrierCode] = useState('');
    const [dispatchWarehouses, setDispatchWarehouses] = useState([]);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('order_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [tempFilters, setTempFilters] = useState(null);
    const [openAttrId, setOpenAttrId] = useState(null);
    const searchContainerRef = useRef(null);
    const shippingAlertRef = useRef(null);
    const previousUnreadRef = useRef([]);
    const orderRequestAbortRef = useRef(null);

    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState({
        search: localStorage.getItem('order_list_search_current') || '',
        status: [],
        customer_name: '',
        order_number: '',
        created_at_from: '',
        created_at_to: '',
        customer_phone: '',
        shipping_address: '',
        shipping_carrier_code: '',
        export_slip_state: '',
        return_slip_state: '',
        damaged_slip_state: '',
        shipping_dispatched_from: '',
        shipping_dispatched_to: '',
        attributes: {}
    });

    const [sortConfig, setSortConfig] = useState(() => {
        const saved = localStorage.getItem('order_list_sort');
        return saved ? JSON.parse(saved) : { key: 'created_at', direction: 'desc', phase: 1 };
    });

    const {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
        setAvailableColumns,
        setVisibleColumns
    } = useTableColumns('order_list', ORDER_TABLE_COLUMNS);

    const [hasLoadedOrdersOnce, setHasLoadedOrdersOnce] = useState(false);
    const isTrashView = currentView === 'trash';
    const isDraftView = currentView === 'draft';
    const isMainView = currentView === 'main';
    const currentViewMeta = LIST_VIEW_META[currentView] || LIST_VIEW_META.main;
    const statusMap = useMemo(
        () => new Map(orderStatuses.map((status) => [String(status.code), status])),
        [orderStatuses]
    );
    const carrierMap = useMemo(
        () => new Map(connectedCarriers.map((carrier) => [String(carrier.carrier_code), carrier])),
        [connectedCarriers]
    );
    const attributeMap = useMemo(
        () => new Map(allAttributes.map((attribute) => [Number(attribute.id), attribute])),
        [allAttributes]
    );
    const activeStatusMenuOrder = useMemo(
        () => orders.find((order) => String(order.id) === String(statusMenuOrderId)) || null,
        [orders, statusMenuOrderId]
    );
    const activeProductPopupOrder = useMemo(
        () => orders.find((order) => order.id === productPopupOrderId) || null,
        [orders, productPopupOrderId]
    );
    const selectedOrderMap = useMemo(
        () => new Map(orders.map((order) => [String(order.id), order])),
        [orders]
    );

    const buildQuickDispatchRows = useCallback((ids, existingRows = {}) => (
        ids.reduce((accumulator, id) => {
            const key = String(id);
            const order = selectedOrderMap.get(key);
            const previousRow = existingRows[key] || {};

            accumulator[key] = {
                tracking_number: previousRow.tracking_number ?? '',
                carrier_name: previousRow.carrier_name ?? order?.shipping_carrier_name ?? '',
                shipping_cost: previousRow.shipping_cost ?? '',
            };

            return accumulator;
        }, {})
    ), [selectedOrderMap]);

    const quickDispatchOrderRows = useMemo(
        () => selectedIds.map((id) => {
            const key = String(id);
            const order = selectedOrderMap.get(key);
            const row = quickDispatchRows[key] || {};
            const activeShipment = order?.active_shipment || null;

            return {
                id,
                order_number: order?.order_number || `??n #${id}`,
                customer_name: order?.customer_name || '',
                tracking_number: row.tracking_number ?? '',
                carrier_name: row.carrier_name ?? '',
                shipping_cost: row.shipping_cost ?? '',
                locked: Boolean(activeShipment),
                locked_message: activeShipment
                    ? `?? c? v?n ??n ${activeShipment.shipment_number || activeShipment.carrier_tracking_code || ''}`.trim()
                    : '',
            };
        }),
        [quickDispatchRows, selectedIds, selectedOrderMap]
    );

    const quickDispatchBlockedOrders = useMemo(
        () => quickDispatchOrderRows.filter((row) => row.locked),
        [quickDispatchOrderRows]
    );

    const quickDispatchEditableRows = useMemo(
        () => quickDispatchOrderRows.filter((row) => !row.locked),
        [quickDispatchOrderRows]
    );
    const selectedCancelDispatchState = useMemo(() => {
        const details = selectedIds.map((id) => {
            const order = selectedOrderMap.get(String(id));
            const eligibility = getCancelDispatchEligibility(order);

            return {
                id,
                order,
                ...eligibility,
            };
        });

        const validOrders = details.filter((item) => item.eligible);
        const invalidOrders = details.filter((item) => !item.eligible);

        return {
            details,
            validOrders,
            invalidOrders,
            validCount: validOrders.length,
            invalidCount: invalidOrders.length,
            canSubmit: validOrders.length > 0 && invalidOrders.length === 0,
            firstInvalidReason: invalidOrders[0]?.reason || '',
        };
    }, [selectedIds, selectedOrderMap]);

    const fetchInitialData = async () => {
        try {
            const response = await orderApi.getBootstrap({ mode: 'list' });
            const bootstrap = response.data || {};
            const nextStatuses = bootstrap.order_statuses || [];
            const nextAttributes = bootstrap.order_attributes || [];
            const nextCarriers = bootstrap.connected_carriers || [];

            setOrderStatuses(nextStatuses);
            setAllAttributes(nextAttributes);
            setConnectedCarriers(nextCarriers);

            const attrColumns = nextAttributes.map(attr => ({
                id: `attr_${attr.id}`,
                label: attr.name,
                minWidth: '150px',
                isAttribute: true,
                attrId: attr.id
            }));

            const combinedColumns = [...ORDER_TABLE_COLUMNS, ...attrColumns];

            const savedOrder = localStorage.getItem('order_list_column_order');
            let sortedColumns = [...combinedColumns];
            if (savedOrder) {
                const orderIds = JSON.parse(savedOrder);
                sortedColumns = [...combinedColumns].sort((a, b) => {
                    const idxA = orderIds.indexOf(a.id);
                    const idxB = orderIds.indexOf(b.id);
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }
            setAvailableColumns(sortedColumns);

            const savedVisible = localStorage.getItem('order_list_columns');
            const allColumnIds = sortedColumns.map((column) => column.id);
            if (savedVisible) {
                const savedIds = JSON.parse(savedVisible);
                const nextVisible = allColumnIds.filter((id) => savedIds.includes(id));
                const mergedVisible = [...nextVisible, ...allColumnIds.filter((id) => !nextVisible.includes(id))];
                setVisibleColumns(mergedVisible);
                localStorage.setItem('order_list_columns', JSON.stringify(mergedVisible));
            } else {
                setVisibleColumns(allColumnIds);
            }
            orderApi.preloadBootstrap({ mode: 'form' });
        } catch (error) { console.error("Error initial data", error); }
    };

    const addToSearchHistory = (term) => {
        if (!term?.trim() || term.length < 2) return;
        setSearchHistory(prev => {
            const updated = [term, ...prev.filter(h => h !== term)].slice(0, 10);
            localStorage.setItem('order_search_history', JSON.stringify(updated));
            return updated;
        });
    };

    const fetchOrders = useCallback(async (page = 1, currentFilters = filters, perPage = pagination.per_page, currentSort = sortConfig) => {
        orderRequestAbortRef.current?.abort();
        const controller = new AbortController();
        orderRequestAbortRef.current = controller;
        setLoading(true);
        try {
            const params = {
                page, per_page: perPage, trashed: isTrashView ? 1 : 0,
                sort_by: currentSort.direction === 'none' ? 'created_at' : currentSort.key,
                sort_order: currentSort.direction === 'none' ? 'desc' : currentSort.direction
            };
            if (isDraftView) params.order_kind = DRAFT_ORDER_KIND;

            if (currentFilters.search?.trim()) params.search = currentFilters.search.trim();
            if (currentFilters.status?.length) params.status = currentFilters.status.join(',');
            if (currentFilters.customer_name?.trim()) params.customer_name = currentFilters.customer_name.trim();
            if (currentFilters.order_number) params.order_number = currentFilters.order_number;
            if (currentFilters.customer_phone) params.customer_phone = currentFilters.customer_phone;
            if (currentFilters.shipping_address) params.shipping_address = currentFilters.shipping_address;
            if (currentFilters.created_at_from) params.created_at_from = currentFilters.created_at_from;
            if (currentFilters.created_at_to) params.created_at_to = currentFilters.created_at_to;
            if (currentFilters.shipping_carrier_code) params.shipping_carrier_code = currentFilters.shipping_carrier_code;
            if (currentFilters.export_slip_state) params.export_slip_state = currentFilters.export_slip_state;
            if (currentFilters.return_slip_state) params.return_slip_state = currentFilters.return_slip_state;
            if (currentFilters.damaged_slip_state) params.damaged_slip_state = currentFilters.damaged_slip_state;
            if (currentFilters.shipping_dispatched_from) params.shipping_dispatched_from = currentFilters.shipping_dispatched_from;
            if (currentFilters.shipping_dispatched_to) params.shipping_dispatched_to = currentFilters.shipping_dispatched_to;

            if (currentFilters.attributes) {
                Object.entries(currentFilters.attributes).forEach(([id, val]) => {
                    if (val && (Array.isArray(val) ? val.length > 0 : val !== '')) {
                        params[`attr_order_${id}`] = Array.isArray(val) ? val.join(',') : val;
                    }
                });
            }

            const response = await orderApi.getAll(params, controller.signal);
            if (controller.signal.aborted) return;
            setOrders(response.data.data);
            setPagination({ current_page: response.data.current_page, last_page: response.data.last_page, total: response.data.total, per_page: response.data.per_page });
            setHasLoadedOrdersOnce(true);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
            console.error("Error fetching orders", error);
            setNotification({ type: 'error', message: 'Kh?ng th? t?i danh s?ch ??n h?ng' });
        } finally {
            if (orderRequestAbortRef.current === controller) {
                orderRequestAbortRef.current = null;
                setLoading(false);
            }
        }
    }, [filters, isDraftView, isTrashView, pagination.per_page, sortConfig]);

    useEffect(() => { fetchInitialData(); }, []);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const nextView = params.get('view');
        setCurrentView(['draft', 'trash'].includes(nextView) ? nextView : 'main');
    }, [location.search]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (filters.search !== localStorage.getItem('order_list_search_current')) {
                if (filters.search) {
                    localStorage.setItem('order_list_search_current', filters.search);
                    fetchOrders(1);
                    addToSearchHistory(filters.search);
                } else if (localStorage.getItem('order_list_search_current')) {
                    localStorage.removeItem('order_list_search_current');
                    fetchOrders(1);
                }
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [filters.search]);

    useEffect(() => {
        setSelectedIds([]);
        setStatusMenuOrderId(null);
        setProductPopupOrderId(null);
        setInventorySlipOrderId(null);
    }, [currentView]);

    useEffect(() => { fetchOrders(1); }, [currentView]);

    useEffect(() => {
        return () => {
            orderRequestAbortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (filterRef.current && !filterRef.current.contains(e.target) && !e.target.closest('[data-filter-btn]')) setShowFilters(false);
            if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target) && !e.target.closest('[data-column-settings-btn]')) setShowColumnSettings(false);
            if (statusMenuRef.current && !statusMenuRef.current.contains(e.target) && !e.target.closest('[data-status-edit-btn]')) setStatusMenuOrderId(null);
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) setShowSearchHistory(false);
            if (!e.target.closest('[data-attr-dropdown]')) setOpenAttrId(null);
            if (shippingAlertRef.current && !shippingAlertRef.current.contains(e.target) && !e.target.closest('[data-shipping-alert-btn]')) setShowShippingAlerts(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem(SHIPPING_SOUND_STORAGE_KEY);
        setShippingSoundSettings(saved ? JSON.parse(saved) : defaultSoundSettings);
    }, []);

    const markShippingAlertsSeen = useCallback((alertsToMark = shippingAlerts) => {
        const currentSeen = new Set(JSON.parse(localStorage.getItem(SHIPPING_ALERT_SEEN_STORAGE_KEY) || '[]'));
        alertsToMark.forEach((alert) => currentSeen.add(getAlertSignature(alert)));
        const seenList = Array.from(currentSeen).slice(-300);
        localStorage.setItem(SHIPPING_ALERT_SEEN_STORAGE_KEY, JSON.stringify(seenList));
        setShippingAlertUnread((current) => current.filter((alert) => !alertsToMark.some((item) => getAlertSignature(item) === getAlertSignature(alert))));
    }, [shippingAlerts]);

    const fetchShippingAlerts = useCallback(async () => {
        try {
            const response = await orderApi.getShippingAlerts({ per_page: 20 });
            const incomingAlerts = response.data?.data || [];
            const seen = new Set(JSON.parse(localStorage.getItem(SHIPPING_ALERT_SEEN_STORAGE_KEY) || '[]'));
            const unread = incomingAlerts.filter((alert) => !seen.has(getAlertSignature(alert)));

            setShippingAlerts(incomingAlerts);
            setShippingAlertUnread(unread);

            const previousSignatures = new Set(previousUnreadRef.current.map(getAlertSignature));
            const newUnread = unread.filter((alert) => !previousSignatures.has(getAlertSignature(alert)));
            if (newUnread.length > 0) {
                playShippingNotificationSound(shippingSoundSettings);
                setNotification({
                    type: 'error',
                    message: `${newUnread.length} ??n c? c?nh b?o v?n chuy?n m?i.`,
                });
            }
            previousUnreadRef.current = unread;
        } catch (error) {
            console.error('Shipping alert polling failed', error);
        }
    }, [shippingSoundSettings]);

    useEffect(() => {
        if (!hasLoadedOrdersOnce) return;
        fetchShippingAlerts();
        const intervalId = window.setInterval(fetchShippingAlerts, 15000);
        return () => window.clearInterval(intervalId);
    }, [fetchShippingAlerts, hasLoadedOrdersOnce]);

    useEffect(() => {
        if (!dispatchModalOpen || !selectedCarrierCode) return;
        const activeCarrier = carrierMap.get(String(selectedCarrierCode));
        setSelectedWarehouseId((current) => {
            if (current) return current;
            return activeCarrier?.default_warehouse_id ? String(activeCarrier.default_warehouse_id) : '';
        });
    }, [carrierMap, dispatchModalOpen, selectedCarrierCode]);

    useEffect(() => {
        if (!dispatchModalOpen || !selectedCarrierCode || selectedIds.length === 0) return;

        const loadPreview = async () => {
            setDispatchPreviewLoading(true);
            try {
                const response = await orderApi.dispatchPreview({
                    order_ids: selectedIds,
                    carrier_code: selectedCarrierCode,
                    warehouse_id: selectedWarehouseId || null,
                });
                setDispatchPreview(response.data);
            } catch (error) {
                setDispatchPreview(null);
                setNotification({
                    type: 'error',
                    message: error.response?.data?.message || 'Kh?ng th? t?i preview g?i v?n chuy?n.',
                });
            } finally {
                setDispatchPreviewLoading(false);
            }
        };

        loadPreview();
    }, [dispatchModalOpen, selectedCarrierCode, selectedIds, selectedWarehouseId]);

    const handleTempFilterChange = (e) => {
        const { name, value } = e.target;
        setTempFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleTempAttributeFilterChange = (attrId, value) => {
        setTempFilters(prev => {
            const current = (prev.attributes?.[attrId] || []);
            const currentArray = Array.isArray(current) ? current : (current ? [current] : []);
            const updated = currentArray.includes(value) ? currentArray.filter(v => v !== value) : [...currentArray, value];
            return { ...prev, attributes: { ...prev.attributes, [attrId]: updated } };
        });
    };

    const applyFilters = () => {
        setFilters(tempFilters);
        setShowFilters(false);
        fetchOrders(1, tempFilters);
    };

    const removeFilter = (key, value = null) => {
        setFilters(prev => {
            let nf = { ...prev };
            if (key === 'attributes') { nf.attributes = { ...prev.attributes }; delete nf.attributes[value.attrId]; }
            else if (key === 'status') { nf.status = []; }
            else if (key === 'date') { nf.created_at_from = ''; nf.created_at_to = ''; }
            else if (key === 'shipping_date') { nf.shipping_dispatched_from = ''; nf.shipping_dispatched_to = ''; }
            else { nf[key] = ''; }
            fetchOrders(1, nf);
            return nf;
        });
    };

    const handleReset = () => {
        const rf = {
            search: '',
            status: [],
            customer_name: '',
            order_number: '',
            created_at_from: '',
            created_at_to: '',
            customer_phone: '',
            shipping_address: '',
            shipping_carrier_code: '',
            export_slip_state: '',
            return_slip_state: '',
            damaged_slip_state: '',
            shipping_dispatched_from: '',
            shipping_dispatched_to: '',
            attributes: {},
        };
        setFilters(rf);
        setSortConfig({ key: 'created_at', direction: 'desc', phase: 1 });
        fetchOrders(1, rf);
    };

    const handleRefresh = () => fetchOrders(1);

    const handleDispatchCarrierChange = (carrierCode) => {
        setSelectedCarrierCode(carrierCode);
        const nextCarrier = carrierMap.get(String(carrierCode));
        setSelectedWarehouseId(nextCarrier?.default_warehouse_id ? String(nextCarrier.default_warehouse_id) : '');
    };

    const openDispatchModal = async () => {
        if (!selectedIds.length) return;
        try {
            const carrierPromise = connectedCarriers.length
                ? Promise.resolve({ data: connectedCarriers })
                : orderApi.getConnectedCarriers();
            const [carrierResponse, warehouseResponse] = await Promise.all([
                carrierPromise,
                warehouseApi.getAll({ active_only: 1 }),
            ]);
            const carriers = carrierResponse.data || [];
            const warehouses = warehouseResponse.data || [];
            setConnectedCarriers(carriers);
            setDispatchWarehouses(warehouses);
            if (!carriers.length) {
                setNotification({ type: 'error', message: 'Ch?a c? ??n v? v?n chuy?n n?o ???c k?t n?i API.' });
                return;
            }
            const fallbackCarrier = carriers.find((carrier) => carrier.carrier_code === selectedCarrierCode) || carriers[0];
            setSelectedCarrierCode(fallbackCarrier.carrier_code);
            setSelectedWarehouseId(fallbackCarrier.default_warehouse_id ? String(fallbackCarrier.default_warehouse_id) : '');
            setDispatchModalOpen(true);
        } catch (error) {
            setNotification({ type: 'error', message: error.response?.data?.message || 'Kh?ng th? t?i danh s?ch ??n v? v?n chuy?n.' });
        }
    };

    const closeDispatchModal = () => {
        setDispatchModalOpen(false);
        setDispatchPreview(null);
        setDispatchPreviewLoading(false);
        setSelectedWarehouseId('');
    };

    const handleDispatchOrders = async () => {
        if (!selectedCarrierCode || !selectedIds.length) return;
        setDispatchSubmitting(true);
        try {
            const response = await orderApi.dispatch({
                order_ids: selectedIds,
                carrier_code: selectedCarrierCode,
                warehouse_id: selectedWarehouseId || null,
            });
            const { success_count = 0, failed_count = 0, results = [] } = response.data || {};
            const firstFailed = results.find((item) => item.success === false && item.message);
            setNotification({
                type: failed_count > 0 ? 'error' : 'success',
                message: `?? g?i ${success_count} ??n sang v?n chuy?n${failed_count > 0 ? `, ${failed_count} ??n l?i` : ''}.${firstFailed ? ` ${firstFailed.order_number}: ${firstFailed.message}` : ''}`,
            });
            setSelectedIds([]);
            closeDispatchModal();
            fetchOrders(pagination.current_page);
            fetchShippingAlerts();
        } catch (error) {
            setNotification({ type: 'error', message: error.response?.data?.message || 'Kh?ng th? g?i ??n sang ??n v? v?n chuy?n.' });
        } finally {
            setDispatchSubmitting(false);
        }
    };

    const handleCancelDispatchOrders = async () => {
        if (!selectedCancelDispatchState.canSubmit || cancelDispatchSubmitting) {
            if (selectedCancelDispatchState.invalidCount > 0) {
                setNotification({
                    type: 'error',
                    message: selectedCancelDispatchState.firstInvalidReason || 'Có đơn không hợp lệ để hủy gửi vận chuyển.',
                });
            }
            return;
        }

        const confirmMessage = selectedCancelDispatchState.validCount === 1
            ? 'Hủy gửi vận chuyển cho đơn đã chọn? Đơn sẽ về trạng thái "Đơn mới", xóa mã vận đơn và xóa liên kết vận chuyển hiện tại.'
            : `Hủy gửi vận chuyển cho ${selectedCancelDispatchState.validCount} đơn đã chọn? Các đơn sẽ được đưa về trạng thái "Đơn mới" và xóa liên kết vận chuyển hiện tại.`;

        if (!window.confirm(confirmMessage)) {
            return;
        }

        setCancelDispatchSubmitting(true);

        try {
            const response = await orderApi.cancelDispatch({
                order_ids: selectedIds,
            });
            const {
                success_count: successCount = 0,
                failed_count: failedCount = 0,
                results = [],
            } = response.data || {};
            const failedResults = results.filter((item) => item.success === false);
            const failedIds = failedResults.map((item) => item.order_id);
            const firstFailed = failedResults.find((item) => item.message);

            setNotification({
                type: failedCount > 0 ? 'error' : 'success',
                message: `Đã hủy gửi vận chuyển ${successCount} đơn${failedCount > 0 ? `, ${failedCount} đơn lỗi` : ''}.${firstFailed ? ` ${firstFailed.order_number || `#${firstFailed.order_id}`}: ${firstFailed.message}` : ''}`,
            });

            if (successCount > 0) {
                fetchOrders(pagination.current_page);
                fetchShippingAlerts();
            }

            if (failedIds.length > 0) {
                setSelectedIds(failedIds);
                return;
            }

            setSelectedIds([]);
        } catch (error) {
            setNotification({
                type: 'error',
                message: error.response?.data?.message || 'Không thể hủy gửi vận chuyển cho các đơn đã chọn.',
            });
        } finally {
            setCancelDispatchSubmitting(false);
        }
    };

    const handleQuickDispatchFieldChange = (orderId, field, value) => {
        const key = String(orderId);
        setQuickDispatchRows((previous) => ({
            ...previous,
            [key]: {
                ...(previous[key] || {}),
                [field]: value,
            },
        }));
    };

    const openQuickDispatchModal = async () => {
        if (!selectedIds.length) return;

        setQuickDispatchRows((previous) => buildQuickDispatchRows(selectedIds, previous));

        try {
            if (!manualCarrierOptions.length) {
                const response = await shipmentApi.getCarriers();
                setManualCarrierOptions(response.data || []);
            }
        } catch (error) {
            setNotification({
                type: 'error',
                message: error.response?.data?.message || 'Kh?ng th? t?i danh s?ch ??n v? v?n chuy?n g?i ?.',
            });
        } finally {
            setQuickDispatchModalOpen(true);
        }
    };

    const closeQuickDispatchModal = () => {
        setQuickDispatchModalOpen(false);
        setQuickDispatchSubmitting(false);
        setQuickDispatchRows({});
    };

    const handleQuickDispatchOrders = async () => {
        if (!quickDispatchEditableRows.length) return;

        const shipments = quickDispatchEditableRows.map((row) => ({
            order_id: row.id,
            tracking_number: row.tracking_number.trim(),
            carrier_name: row.carrier_name.trim(),
            shipping_cost: Number(row.shipping_cost),
        }));

        const invalidRow = shipments.find((row) => (
            !row.tracking_number
            || !row.carrier_name
            || Number.isNaN(row.shipping_cost)
            || row.shipping_cost < 0
        ));

        if (invalidRow) {
            setNotification({
                type: 'error',
                message: 'Vui l?ng nh?p ??y ?? m? v?n ??n, ??n v? v?n chuy?n v? ti?n ship h?p l? cho t?ng ??n.',
            });
            return;
        }

        setQuickDispatchSubmitting(true);

        try {
            const response = await orderApi.quickDispatch({ shipments });
            const {
                success_count: successCount = 0,
                failed_count: failedCount = 0,
                results = [],
            } = response.data || {};
            const failedResults = results.filter((item) => item.success === false);
            const failedIds = failedResults.map((item) => item.order_id);
            const firstFailed = failedResults.find((item) => item.message);

            setNotification({
                type: failedCount > 0 ? 'error' : 'success',
                message: `?? g?i v?n chuy?n nhanh ${successCount} ??n${failedCount > 0 ? `, ${failedCount} ??n l?i` : ''}.${firstFailed ? ` ${firstFailed.order_number || `#${firstFailed.order_id}`}: ${firstFailed.message}` : ''}`,
            });

            if (successCount > 0) {
                fetchOrders(pagination.current_page);
                fetchShippingAlerts();
            }

            if (failedIds.length > 0) {
                setSelectedIds(failedIds);
                setQuickDispatchRows((previous) => buildQuickDispatchRows(failedIds, previous));
                return;
            }

            setSelectedIds([]);
            closeQuickDispatchModal();
        } catch (error) {
            setNotification({
                type: 'error',
                message: error.response?.data?.message || 'Kh?ng th? l?u g?i v?n chuy?n nhanh.',
            });
        } finally {
            setQuickDispatchSubmitting(false);
        }
    };

    const handleOpenShippingAlert = (alert) => {
        markShippingAlertsSeen([alert]);
        setShowShippingAlerts(false);
        const nextFilters = {
            ...filters,
            search: alert.shipping_tracking_code || alert.order_number || filters.search,
        };
        setFilters(nextFilters);
        fetchOrders(1, nextFilters);
    };

    const handleSort = (colId) => {
        let key = colId === 'customer' ? 'customer_name' : colId;
        const valid = ['id', 'order_number', 'customer_name', 'created_at', 'total_price', 'status'];
        if (!valid.includes(key)) return;
        let ns;
        if (sortConfig.key !== key) ns = { key, direction: 'desc', phase: 1 };
        else {
            const np = ((sortConfig.phase || 1) % 3) + 1;
            if (np === 3) ns = { key: 'created_at', direction: 'desc', phase: 1 };
            else ns = { key, direction: np === 2 ? 'asc' : 'desc', phase: np };
        }
        setSortConfig(ns);
        localStorage.setItem('order_list_sort', JSON.stringify(ns));
        fetchOrders(1, filters, pagination.per_page, ns);
    };

    const handleQuickStatusUpdate = async (id, s) => {
        try {
            await orderApi.updateStatus(id, s);
            await fetchOrders(pagination.current_page || 1, filters, pagination.per_page, sortConfig);
            setStatusMenuOrderId(null);
            setNotification({ type: 'success', message: '?? c?p nh?t tr?ng th?i ??n h?ng' });
        } catch (e) {
            console.error("Status update error", e);
            const errorMsg = e.response?.data?.message || 'L?i c?p nh?t tr?ng th?i';
            setNotification({ type: 'error', message: errorMsg });
        }
    };

    const handleBulkPrint = async () => {
        if (!selectedIds.length || printingOrders) return;

        const ids = [...selectedIds];

        try {
            setPrintingOrders(true);

            const response = await orderApi.getPrintData(ids);
            const printableOrders = response?.data?.data || [];

            if (!printableOrders.length) {
                throw new Error('Không có đơn hàng hợp lệ để in.');
            }

            await printOrders(printableOrders);

            const markResponse = await orderApi.markPrinted(ids);
            const markSummary = markResponse?.data || {};
            const updatedCount = Number(markSummary.updated_count || 0);
            const preservedCount = Number(markSummary.preserved_count || 0);
            const ignoredCount = Number(markSummary.ignored_count || 0);
            const messageParts = [`Đã mở in ${printableOrders.length} đơn`];

            if (updatedCount > 0) {
                messageParts.push(`${updatedCount} đơn chuyển sang "Đã in"`);
            }

            if (preservedCount > 0) {
                messageParts.push(`${preservedCount} đơn giữ nguyên trạng thái vì đang ở luồng giao hàng hoặc đã in`);
            }

            if (ignoredCount > 0) {
                messageParts.push(`${ignoredCount} đơn nháp hoặc đơn mẫu không đổi trạng thái`);
            }

            await fetchOrders(pagination.current_page || 1, filters, pagination.per_page, sortConfig);
            setSelectedIds([]);
            setNotification({ type: 'success', message: messageParts.join('. ') });
        } catch (error) {
            console.error('Print orders error', error);
            setNotification({
                type: 'error',
                message: error.response?.data?.message || error.message || 'Không thể in đơn hàng.',
            });
        } finally {
            setPrintingOrders(false);
        }
    };

    const currentListUrl = useMemo(() => buildOrderListUrl(currentView), [currentView]);

    const navigateToListView = useCallback((nextView = 'main') => {
        navigate(buildOrderListUrl(nextView));
    }, [navigate]);

    const exitSpecialListView = useCallback(() => {
        setCurrentView('main');
        setSelectedIds([]);
        setStatusMenuOrderId(null);
        setProductPopupOrderId(null);
        setInventorySlipOrderId(null);
        setShowFilters(false);
        setShowColumnSettings(false);
        navigate(buildOrderListUrl('main'));
    }, [navigate]);

    const handleCreateOrder = useCallback(() => {
        orderApi.preloadBootstrap({ mode: 'form' });
        navigate(`/admin/orders/new?return_to=${encodeURIComponent(currentListUrl)}`);
    }, [currentListUrl, navigate]);

    const warmOrderEditor = useCallback((orderId) => {
        orderApi.preloadBootstrap({ mode: 'form' });
        if (orderId) {
            orderApi.preloadOne(orderId);
        }
    }, []);

    const openOrderEditor = useCallback((orderId, options = {}) => {
        const returnTo = options.returnTo || currentListUrl;

        warmOrderEditor(orderId);
        navigate(`/admin/orders/edit/${orderId}?return_to=${encodeURIComponent(returnTo)}`);
    }, [currentListUrl, navigate, warmOrderEditor]);

    const handleBulkDelete = async () => {
        if (!selectedIds.length) return;
        if (!window.confirm('X?a ??n h?ng ?? ch?n?')) return;
        try {
            setLoading(true);
            await orderApi.bulkDelete(selectedIds, false);
            setNotification({ type: 'success', message: `?? x?a ${selectedIds.length} ??n` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'L?i x?a' }); } finally { setLoading(false); }
    };

    const handleBulkRestore = async () => {
        if (!selectedIds.length) return;
        try {
            setLoading(true);
            await orderApi.bulkRestore(selectedIds);
            setNotification({ type: 'success', message: `?? kh?i ph?c ${selectedIds.length} ??n` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'L?i kh?i ph?c' }); } finally { setLoading(false); }
    };

    const handleBulkForceDelete = async () => {
        if (!selectedIds.length) return;
        if (!window.confirm('X?a v?nh vi?n?')) return;
        try {
            setLoading(true);
            await orderApi.bulkDelete(selectedIds, true);
            setNotification({ type: 'success', message: `?? x?a v?nh vi?n ${selectedIds.length} ??n` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'L?i x?a' }); } finally { setLoading(false); }
    };

    const handleBulkDuplicate = useCallback(async () => {
        if (!selectedIds.length) return;

        try {
            setLoading(true);

            if (selectedIds.length === 1) {
                const response = await orderApi.duplicate(selectedIds[0], {
                    target_kind: DRAFT_ORDER_KIND,
                });
                const duplicatedOrderId = response?.data?.id;

                setSelectedIds([]);

                if (duplicatedOrderId) {
                    openOrderEditor(duplicatedOrderId, {
                        returnTo: buildOrderListUrl('draft'),
                    });
                    return;
                }
            } else {
                await orderApi.bulkDuplicate(selectedIds, DRAFT_ORDER_KIND);
            }

            setNotification({
                type: 'success',
                message: `Đã sao chép ${selectedIds.length} đơn thành đơn nháp mới`,
            });
            setSelectedIds([]);

            if (isDraftView) {
                fetchOrders(1);
                return;
            }

            navigateToListView('draft');
        } catch (error) {
            setNotification({
                type: 'error',
                message: error.response?.data?.message || 'Lỗi sao chép đơn hàng',
            });
        } finally {
            setLoading(false);
        }
    }, [fetchOrders, isDraftView, navigateToListView, openOrderEditor, selectedIds]);

    const handleBulkConvert = async (targetKind) => {
        if (!selectedIds.length) return;
        try {
            setLoading(true);
            await orderApi.bulkConvert(selectedIds, targetKind);
            const targetView = getTargetListView(targetKind);
            setNotification({ type: 'success', message: targetView === 'draft' ? `Đã chuyển ${selectedIds.length} đơn sang đơn nháp` : `Đã chốt ${selectedIds.length} đơn thành đơn chính` });
            setSelectedIds([]);
            navigateToListView(targetView);
        } catch (e) {
            setNotification({ type: 'error', message: e.response?.data?.message || 'Lỗi chuyển nhóm đơn' });
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = (t, e) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(t);
        setCopiedText(t);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const getStatusStyle = (s) => {
        const f = statusMap.get(String(s));
        return f ? { backgroundColor: `${f.color}15`, color: f.color, borderColor: `${f.color}30` } : {};
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === orders.length && orders.length > 0) setSelectedIds([]);
        else setSelectedIds(orders.map(o => o.id));
    };

    const toggleSelectOrder = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

    const activeCount = () => {
        let c = 0;
        if (filters.status?.length) c++;
        if (filters.customer_name) c++;
        if (filters.order_number) c++;
        if (filters.customer_phone) c++;
        if (filters.shipping_carrier_code) c++;
        INVENTORY_SLIP_FILTERS.forEach(({ key }) => {
            if (filters[key]) c++;
        });
        if (filters.created_at_from || filters.created_at_to) c++;
        if (filters.shipping_dispatched_from || filters.shipping_dispatched_to) c++;
        if (filters.attributes) c += Object.keys(filters.attributes).length;
        return c;
    };

    const { listTitle, emptyTitle, emptyDescription, selectedLabel, createTitle } = currentViewMeta;

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .admin-page-container { font-family: 'Inter', sans-serif; display: flex; flex-direction: column; height: 100%; background-color: #F8FAFC; }
                .admin-header-title { font-size: 15px !important; font-weight: 800 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
                .admin-text-13 { font-size: 13px !important; color: #0F172A !important; }
                .admin-table-header { font-size: 11px !important; font-weight: 900 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.15em !important; background-color: #F0F4F8 !important; }
                .sticky-col-0 { position: sticky; left: 0; z-index: 10; background: #FCFEFF; border-right: 2px solid #E2E8F0 !important; }
                .sticky-col-1 { position: sticky; left: 48px; z-index: 10; background: #FCFEFF; border-right: 1px solid #E2E8F0 !important; }
                tr:hover .sticky-col-0, tr:hover .sticky-col-1 { background-color: #F1F5F9 !important; }
                tr.bg-primary\/5 .sticky-col-0, tr.bg-primary\/5 .sticky-col-1 { background-color: #E2E8F0 !important; }
                .table-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
                .table-scrollbar::-webkit-scrollbar-track { background: #F0F4F8; }
                .table-scrollbar::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
            `}</style>

            {notification && (
                <div className={`fixed top-6 right-6 z-[100] p-4 rounded-sm shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    <span className="material-symbols-outlined">{notification.type === 'error' ? 'report' : 'check_circle'}</span>
                    <span className="font-bold">{notification.message}</span>
                    <button onClick={() => setNotification(null)} className="ml-2 opacity-50 hover:opacity-100"><span className="material-symbols-outlined">close</span></button>
                </div>
            )}

            <div className="flex-none bg-[#F8FAFC] pb-4 space-y-2">
                <div className="flex justify-between items-center">
                    <h1 className="admin-header-title italic">{listTitle}</h1>
                    <AccountSelector user={user} />
                </div>

                <div className="bg-white border border-primary/10 p-2 shadow-sm rounded-sm flex items-center gap-2">
                    <div className="flex gap-2 items-center flex-wrap">
                        {!isTrashView && (
                            <button type="button" onClick={handleCreateOrder} title={createTitle} className="bg-brick text-white p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all hover:bg-umber">
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                        )}

                        {!isMainView && (
                            <button
                                type="button"
                                onClick={exitSpecialListView}
                                title="Quay lại bảng đơn hàng"
                                className="h-9 px-3 rounded-sm border border-primary/15 bg-white text-primary flex items-center gap-1.5 transition-all hover:bg-primary hover:text-white shadow-sm"
                            >
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                <span className="text-[12px] font-semibold whitespace-nowrap">Đơn hàng</span>
                            </button>
                        )}

                        <div className="flex items-center gap-1 rounded-sm border border-primary/10 bg-[#FCFEFF] p-1">
                            <button type="button" onClick={() => navigateToListView('draft')} title="Đơn nháp" className={`h-9 w-9 rounded-sm flex items-center justify-center transition-all ${isDraftView ? 'bg-primary text-white shadow-sm' : 'text-primary/60 hover:bg-primary/5'}`}>
                                <span className="material-symbols-outlined text-[18px]">draft_orders</span>
                            </button>
                            <button type="button" onClick={() => navigateToListView('trash')} title="Thùng rác" className={`h-9 w-9 rounded-sm flex items-center justify-center transition-all ${isTrashView ? 'bg-primary text-white shadow-sm' : 'text-primary/60 hover:bg-primary/5'}`}>
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </div>

                        <div className="w-[1px] h-6 bg-primary/20 mx-1"></div>

                        <button data-filter-btn onClick={() => { if (!showFilters) setTempFilters({ ...filters }); setShowFilters(!showFilters); }} className={`p-1.5 border transition-all rounded-sm w-9 h-9 flex items-center justify-center ${showFilters || activeCount() > 0 ? 'bg-primary text-white border-primary shadow-inner' : 'bg-white text-primary border-primary/20 hover:bg-primary/5'}`} title="Bộ lọc nâng cao"><span className="material-symbols-outlined text-[18px]">filter_alt</span></button>

                        {isTrashView ? (
                            <>
                                <button onClick={handleBulkDuplicate} disabled={selectedIds.length === 0} title="Sao chép đơn hàng" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-white text-primary border-primary/20 hover:bg-primary/5 shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                                <button onClick={handleBulkRestore} disabled={selectedIds.length === 0} title="Khôi phục" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-green-600/10 text-green-600 border-green-600/20 hover:bg-green-600 hover:text-white shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">restore_from_trash</span></button>
                                <button onClick={handleBulkForceDelete} disabled={selectedIds.length === 0} title="Xóa vĩnh viễn" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-brick/10 text-brick border-brick/20 hover:bg-brick hover:text-white shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">delete_forever</span></button>
                            </>
                        ) : (
                            <>
                                <button onClick={handleBulkDuplicate} disabled={selectedIds.length === 0} title="Sao chép đơn hàng" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-white text-primary border-primary/20 hover:bg-primary/5 shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                                {isDraftView
                                    ? <button onClick={() => handleBulkConvert(MAIN_ORDER_KIND)} disabled={selectedIds.length === 0} title="Chốt thành đơn chính" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary hover:text-white shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">published_with_changes</span></button>
                                    : <button onClick={() => handleBulkConvert(DRAFT_ORDER_KIND)} disabled={selectedIds.length === 0} title="Chuyển sang đơn nháp" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-700 hover:text-white shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">drive_file_move</span></button>}
                                <button onClick={handleBulkPrint} disabled={selectedIds.length === 0 || printingOrders} title="In đơn" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 && !printingOrders ? 'bg-white text-primary border-primary/20 hover:bg-primary/5 shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className={`material-symbols-outlined text-[18px] ${printingOrders ? 'animate-refresh-spin' : ''}`}>{printingOrders ? 'progress_activity' : 'local_printshop'}</span></button>
                                <button onClick={handleBulkDelete} disabled={selectedIds.length === 0} title="Chuyển vào thùng rác" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-brick/10 text-brick border-brick/20 hover:bg-brick hover:text-white shadow-sm' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">delete</span></button>
                            </>
                        )}

                        {isMainView && (
                            <div className="relative" ref={shippingAlertRef}>
                                <button type="button" data-shipping-alert-btn onClick={() => setShowShippingAlerts((current) => !current)} className={`p-1.5 border rounded-sm w-9 h-9 flex items-center justify-center transition-all ${showShippingAlerts || shippingAlertUnread.length > 0 ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-primary border-primary/20 hover:bg-primary/5'}`} title="Cảnh báo vận chuyển">
                                    <span className="material-symbols-outlined text-[18px]">notifications_active</span>
                                    {shippingAlertUnread.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brick text-white text-[10px] font-black flex items-center justify-center">{shippingAlertUnread.length}</span>}
                                </button>
                                {showShippingAlerts && <ShippingAlertsPopover alerts={shippingAlerts} unreadCount={shippingAlertUnread.length} onClose={() => setShowShippingAlerts(false)} onOpenOrder={handleOpenShippingAlert} onMarkAllSeen={() => markShippingAlertsSeen()} />}
                            </div>
                        )}
                        <button onClick={handleRefresh} disabled={loading} title="Làm mới" className="bg-white text-primary border border-primary/20 p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center hover:bg-primary/5"><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span></button>
                        <button data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-1.5 border rounded-sm w-9 h-9 flex items-center justify-center transition-all ${showColumnSettings ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-primary border-primary/30 hover:bg-primary/5'}`} title="Cấu hình hiển thị cột"><span className="material-symbols-outlined text-[18px]">settings_suggest</span></button>

                        {isMainView && <>
                            <button type="button" onClick={openDispatchModal} disabled={selectedIds.length === 0} title="Gửi đơn vị vận chuyển" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-primary text-white border-primary hover:bg-primary/90' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">local_shipping</span></button>
                            <button
                                type="button"
                                onClick={handleCancelDispatchOrders}
                                disabled={!selectedCancelDispatchState.canSubmit || cancelDispatchSubmitting}
                                title={
                                    selectedIds.length === 0
                                        ? 'Chọn đơn đã gửi vận chuyển để hủy'
                                        : selectedCancelDispatchState.canSubmit
                                            ? 'Hủy gửi vận chuyển'
                                            : (selectedCancelDispatchState.firstInvalidReason || 'Chỉ khả dụng khi toàn bộ đơn đã chọn đang ở trạng thái có thể rollback')
                                }
                                className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${
                                    selectedCancelDispatchState.canSubmit && !cancelDispatchSubmitting
                                        ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-600 hover:text-white'
                                        : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'
                                }`}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${cancelDispatchSubmitting ? 'animate-refresh-spin' : ''}`}>
                                    {cancelDispatchSubmitting ? 'progress_activity' : 'undo'}
                                </span>
                            </button>
                            <button type="button" onClick={openQuickDispatchModal} disabled={selectedIds.length === 0} title="Gửi vận chuyển nhanh" className={`h-9 w-9 rounded-sm border flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-white text-primary border-primary/20 hover:bg-primary/5' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">flash_on</span></button>
                        </>}

                        {selectedIds.length > 0 && (
                            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-primary/10">
                                <span className="text-[11px] font-bold text-primary/40 whitespace-nowrap">{selectedIds.length} {selectedLabel}</span>
                                <button onClick={() => setSelectedIds([])} className="p-1 text-primary/40 hover:text-brick" title="Hủy chọn"><span className="material-symbols-outlined text-[16px]">close</span></button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 relative" ref={searchContainerRef}>
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-primary/40 text-[16px] pointer-events-none z-10">search</span>
                        <input type="text" autoComplete="off" placeholder="Tìm tên, mã, SĐT khách..." className="w-full bg-primary/5 border border-primary/10 px-8 py-1.5 rounded-sm text-[14px] focus:outline-none focus:border-primary/30 transition-all relative z-0" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onFocus={() => setShowSearchHistory(true)} onKeyDown={(e) => { if (e.key === 'Enter') { setShowSearchHistory(false); addToSearchHistory(filters.search); } }} />
                        {filters.search && <button onClick={() => { setFilters(prev => ({ ...prev, search: '' })); setShowSearchHistory(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors"><span className="material-symbols-outlined text-[16px]">cancel</span></button>}
                        {showSearchHistory && searchHistory.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[60] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="flex justify-between items-center px-3 mb-2 border-b border-primary/10 pb-1"><span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest">Tìm kiếm gần đây</span><button onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('order_search_history'); }} className="text-[10px] text-brick hover:underline font-bold">Xóa tất cả</button></div>
                                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                    {searchHistory.map((h, i) => (
                                        <div key={i} className="group flex items-center justify-between px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors" onClick={() => { setFilters({ ...filters, search: h }); setShowSearchHistory(false); }}>
                                            <div className="flex items-center gap-2 overflow-hidden"><span className="material-symbols-outlined text-[16px] text-primary/30">history</span><span className="text-[13px] text-[#0F172A] truncate font-medium">{h}</span></div>
                                            <button onClick={(e) => { e.stopPropagation(); const updated = searchHistory.filter(x => x !== h); setSearchHistory(updated); localStorage.setItem('order_search_history', JSON.stringify(updated)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5"><span className="material-symbols-outlined text-[14px]">close</span></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showFilters && tempFilters && (
                <div ref={filterRef} className="bg-white border border-primary/20 p-5 shadow-2xl mb-4 rounded-sm animate-in slide-in-from-top-4 duration-300 relative z-50 text-[#0F172A]">
                    <div className="flex justify-between items-center mb-6 pb-3 border-b border-primary/10">
                        <h4 className="font-bold text-primary flex items-center gap-2 text-[15px]"><span className="material-symbols-outlined text-[20px]">tune</span> Cấu hình bộ lọc đơn hàng</h4>
                        <div className="flex gap-4">
                            <button onClick={handleReset} className="text-[13px] font-bold text-primary/40 hover:text-brick transition-colors">Thiết lập lại</button>
                            <button onClick={applyFilters} className="bg-primary text-white px-8 py-2 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all">Áp dụng bộ lọc</button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm overflow-hidden mb-6 bg-primary/[0.02]">
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Tên khách</label>
                            <input name="customer_name" type="text" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.customer_name} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Mã đơn</label>
                            <input name="order_number" type="text" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.order_number} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">SĐT khách</label>
                            <input name="customer_phone" type="text" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.customer_phone} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Trạng thái</label>
                            <div className="relative">
                                <select name="status" className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer appearance-none" value={tempFilters.status[0] || ''} onChange={(e) => setTempFilters({ ...tempFilters, status: e.target.value ? [e.target.value] : [] })}>
                                    <option value="">Tất cả</option>
                                    {orderStatuses.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 pointer-events-none text-[18px]">
                                    expand_more
                                </span>
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày đặt</label>
                            <div className="flex gap-2 items-center h-10">
                                <input name="created_at_from" type="date" className="flex-1 h-full bg-white border border-primary/10 rounded-sm px-2 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.created_at_from} onChange={handleTempFilterChange} />
                                <span className="text-primary/20">-</span>
                                <input name="created_at_to" type="date" className="flex-1 h-full bg-white border border-primary/10 rounded-sm px-2 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.created_at_to} onChange={handleTempFilterChange} />
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Đơn vị vận chuyển</label>
                            <div className="relative">
                                <select
                                    name="shipping_carrier_code"
                                    className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer appearance-none"
                                    value={tempFilters.shipping_carrier_code}
                                    onChange={handleTempFilterChange}
                                >
                                    <option value="">Tất cả</option>
                                    {connectedCarriers.map((carrier) => (
                                        <option key={carrier.carrier_code} value={carrier.carrier_code}>
                                            {carrier.carrier_name}
                                        </option>
                                    ))}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 pointer-events-none text-[18px]">
                                    expand_more
                                </span>
                            </div>
                        </div>
                        {INVENTORY_SLIP_FILTERS.map(({ key, label, options }) => (
                            <div key={key} className="p-4 border-r border-b border-primary/10 space-y-1.5">
                                <label className="text-[13px] font-medium text-stone-600">{label}</label>
                                <div className="relative">
                                    <select
                                        name={key}
                                        className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer appearance-none"
                                        value={tempFilters[key]}
                                        onChange={handleTempFilterChange}
                                    >
                                        <option value="">Tất cả</option>
                                        {options.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                    <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 pointer-events-none text-[18px]">
                                        expand_more
                                    </span>
                                </div>
                            </div>
                        ))}
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày gửi vận chuyển</label>
                            <div className="flex gap-2 items-center h-10">
                                <input name="shipping_dispatched_from" type="date" className="flex-1 h-full bg-white border border-primary/10 rounded-sm px-2 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.shipping_dispatched_from} onChange={handleTempFilterChange} />
                                <span className="text-primary/20">-</span>
                                <input name="shipping_dispatched_to" type="date" className="flex-1 h-full bg-white border border-primary/10 rounded-sm px-2 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.shipping_dispatched_to} onChange={handleTempFilterChange} />
                            </div>
                        </div>
                    </div>
                    {allAttributes.length > 0 && (
                        <div className="mt-8 pt-6 border-t border-primary/10">
                        <h5 className="text-[15px] font-bold text-[#0F172A] mb-4">Lọc theo thuộc tính</h5>
                            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm bg-primary/[0.02]">
                                {allAttributes.map((a) => (
                                    <div key={a.id} className="p-4 space-y-2.5 border-r border-b border-primary/10 relative">
                                        <label className="text-[11px] font-bold text-stone-500 uppercase tracking-[0.15em]">{a.name}</label>
                                        <div className="relative" data-attr-dropdown>
                                            <button 
                                                onClick={() => setOpenAttrId(openAttrId === a.id ? null : a.id)}
                                                className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === a.id ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                            >
                                                <span className="truncate text-[13px] font-bold text-primary">
                                                    {(tempFilters.attributes[a.id] || []).length > 0 
                                                        ? `${a.name}: ${(tempFilters.attributes[a.id] || []).length}` 
                                                        : `Chọn ${a.name}...`}
                                                </span>
                                                <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === a.id ? 'rotate-180' : ''}`}>
                                                    expand_more
                                                </span>
                                            </button>

                                            {openAttrId === a.id && (
                                                <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                                        {(tempFilters.attributes[a.id] || []).length > 0 && (
                                                            <button 
                                                                className="w-full px-3 py-2 text-left text-[11px] font-black text-brick hover:bg-brick/5 border-b border-primary/5 mb-1 uppercase tracking-widest flex items-center gap-2"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTempFilters(prev => ({
                                                                        ...prev,
                                                                        attributes: { ...prev.attributes, [a.id]: [] }
                                                                    }));
                                                                }}
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">backspace</span>
                                    Xóa các mục đã chọn
                                                            </button>
                                                        )}
                                                        {a.options?.length > 0 ? (
                                                            a.options.map(opt => (
                                                                <label 
                                                                    key={opt.id}
                                                                    className="px-3 py-2.5 hover:bg-primary/5 cursor-pointer flex items-center gap-3 group transition-colors select-none"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <div className="relative flex items-center">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={(tempFilters.attributes[a.id] || []).includes(opt.value)}
                                                                            onChange={() => handleTempAttributeFilterChange(a.id, opt.value)}
                                                                            className="w-4 h-4 accent-primary cursor-pointer rounded-sm border-2 border-primary/20"
                                                                        />
                                                                    </div>
                                                                    <span className={`text-[13px] transition-all ${(tempFilters.attributes[a.id] || []).includes(opt.value) ? 'font-bold text-primary' : 'text-stone-600'}`}>
                                                                        {opt.value}
                                                                    </span>
                                                                </label>
                                                            ))
                                                        ) : (
                        <div className="px-4 py-6 text-center text-stone-400 italic text-[12px]">Không có dữ liệu</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeCount() > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4 bg-primary/5 p-2 border border-primary/10 rounded-sm animate-in fade-in duration-300">
                    <span className="text-[13px] font-bold text-primary px-1 mr-1 border-r border-primary/20 flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">filter_list</span>Đang lọc:</span>
                    {filters.status?.length > 0 && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Trạng thái:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.status.map((s) => statusMap.get(String(s))?.name || s).join(', ')}</span>
                            <button onClick={() => removeFilter('status')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {filters.customer_name && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Khách:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.customer_name}</span>
                            <button onClick={() => removeFilter('customer_name')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {(filters.created_at_from || filters.created_at_to) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Ngày:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.created_at_from || '?'} â†’ {filters.created_at_to || '?'}</span>
                            <button onClick={() => removeFilter('date')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {filters.shipping_carrier_code && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Vận chuyển:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{carrierMap.get(String(filters.shipping_carrier_code))?.carrier_name || filters.shipping_carrier_code}</span>
                            <button onClick={() => removeFilter('shipping_carrier_code')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {INVENTORY_SLIP_FILTERS.map(({ key, label, options }) => (
                        filters[key] ? (
                            <div key={key} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                                <span className="text-[11px] text-primary/40">{label}:</span>
                                <span className="text-[13px] font-bold text-[#0F172A]">{options.find((option) => option.value === filters[key])?.label || filters[key]}</span>
                                <button onClick={() => removeFilter(key)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                            </div>
                        ) : null
                    ))}
                    {(filters.shipping_dispatched_from || filters.shipping_dispatched_to) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Ngày gửi VC:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.shipping_dispatched_from || '?'} → {filters.shipping_dispatched_to || '?'}</span>
                            <button onClick={() => removeFilter('shipping_date')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {filters.attributes && Object.entries(filters.attributes).map(([id, v]) => {
                        if (!v) return null;
                        const a = attributeMap.get(parseInt(id, 10));
                        return (
                            <div key={id} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                                <span className="text-[11px] text-primary/40">{a?.name}:</span>
                                <span className="text-[13px] font-bold text-[#0F172A]">{v}</span>
                                <button onClick={() => removeFilter('attributes', { attrId: id })} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                            </div>
                        );
                    })}
                    <button onClick={handleReset} className="ml-auto text-[13px] font-bold text-brick hover:underline px-2 pr-1 border-primary/20">X?a t?t c? b? l?c</button>
                </div>
            )}

            {showColumnSettings && <div ref={columnSettingsRef}><TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="order_list" /></div>}

            <div className="flex-1 bg-white border border-primary/10 shadow-xl overflow-auto table-scrollbar relative rounded-sm">
                <table className="text-left border-collapse table-fixed min-w-full admin-text-13" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="admin-table-header sticky top-0 z-20 shadow-sm border-b border-primary/10">
                        <tr>
                            <th className="p-3 w-12 admin-table-header border border-primary/20 sticky-col-0">
                                <label className="flex items-center justify-center text-primary font-black">
                                    <input aria-label="Chọn tất cả đơn hàng" type="checkbox" checked={orders.length > 0 && selectedIds.length === orders.length} onChange={toggleSelectAll} className="size-4 accent-primary" />
                                </label>
                            </th>
                            {renderedColumns.map((c, i) => (
                                <th key={c.id} draggable onDragStart={(e) => handleHeaderDragStart(e, i)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, i)} onDoubleClick={() => handleSort(c.id)} className={`px-3 py-2.5 border border-primary/10 cursor-move hover:bg-primary/5 relative group ${c.id === 'order_number' ? 'sticky-col-1' : ''}`} style={{ width: columnWidths[c.id] || c.minWidth }}>
                                    <div className={`flex items-center gap-1.5 ${c.align === 'center' ? 'justify-center' : c.align === 'right' ? 'justify-end' : ''}`}><span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 text-primary">drag_indicator</span><span className={`text-primary font-black ${c.id === 'created_at' || c.id === 'shipping_dispatched_at' ? 'leading-[1.05]' : 'truncate'}`}>{(c.id === 'created_at' || c.id === 'shipping_dispatched_at') ? <span className="flex flex-col"><span className="whitespace-nowrap">{getCompactColumnLabelLines(c.id, c.label)[0]}</span><span className="whitespace-nowrap">{getCompactColumnLabelLines(c.id, c.label)[1]}</span></span> : c.label}</span><SortIndicator colId={c.id === 'customer' ? 'customer_name' : c.id} sortConfig={sortConfig} /></div>
                                    <div onMouseDown={(e) => handleColumnResize(c.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length === 0 && !loading ? (
                            <tr>
                                <td colSpan={renderedColumns.length + 1} className="p-12 text-center">
                                    <div className="flex flex-col items-center gap-2 text-primary/40">
                                        <span className="material-symbols-outlined text-[48px]">inventory_2</span>
                                        <p className="font-bold text-[15px]">{emptyTitle}</p>
                                        <p className="text-[13px]">{emptyDescription}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            orders.map(o => (
                                <tr key={o.id} onDoubleClick={() => { if (!isTrashView) openOrderEditor(o.id); }} onClick={() => toggleSelectOrder(o.id)} className={`transition-all group cursor-pointer ${selectedIds.includes(o.id) ? 'bg-primary/10' : 'hover:bg-primary/5'}`}>
                                    <td className="p-3 w-12 border border-primary/20 sticky-col-0 group-hover:bg-primary/5 transition-colors">
                                        <div className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(o.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={() => toggleSelectOrder(o.id)}
                                                className="size-4 accent-primary cursor-pointer"
                                                aria-label={`Ch?n ??n ${o.order_number}`}
                                            />
                                        </div>
                                    </td>
                                    {renderedColumns.map(c => {
                                        const cs = { width: columnWidths[c.id] || c.minWidth };
                                        if (c.id === 'order_number') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 sticky-col-1 font-mono font-bold text-primary group transition-colors">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="min-w-0 flex flex-col">
                                                        <span className="truncate">{o.order_number}</span>
                                                    </div>
                                                    <button onClick={(e) => handleCopy(o.order_number, e)} className={`opacity-0 group-hover:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.order_number ? 'text-green-500 opacity-100' : 'text-primary/20'}`}><span className="material-symbols-outlined text-[14px]">{copiedText === o.order_number ? 'check' : 'content_copy'}</span></button>
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'customer') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 group/customer_cell relative">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center justify-between group/name_c">
                                                        <span className="font-bold text-[#111] truncate">{o.customer_name}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(o.customer_name, e); }} className={`opacity-0 group-hover/name_c:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.customer_name ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">{copiedText === o.customer_name ? 'check' : 'content_copy'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center justify-between group/phone_c">
                                                        <span className={`text-[11px] font-black truncate ${getOrderCustomerPhoneTextClass(o)}`}>{o.customer_phone}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(o.customer_phone, e); }} className={`opacity-0 group-hover/phone_c:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.customer_phone ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[12px]">{copiedText === o.customer_phone ? 'check' : 'content_copy'}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'province') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 group/province_cell relative text-primary font-bold">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{o.province || '-'}</span>
                                                    {o.province && <button onClick={(e) => { e.stopPropagation(); handleCopy(o.province, e); }} className={`opacity-0 group-hover/province_cell:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.province ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                    </button>}
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'ward') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 group/ward_cell relative text-primary font-bold">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{o.ward || '-'}</span>
                                                    {o.ward && <button onClick={(e) => { e.stopPropagation(); handleCopy(o.ward, e); }} className={`opacity-0 group-hover/ward_cell:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.ward ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                    </button>}
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'items') {
                                            const rawItems = o.items || [];
                                            const hasMany = rawItems.length > 2;

                                            // Smart re-ordering based on search query
                                            let itemsToShow = [...rawItems];
                                            if (filters.search && filters.search.trim()) {
                                                const query = filters.search.toLowerCase().trim();
                                                const matches = itemsToShow.filter(item => {
                                                    const name = (item.product?.name || item.product_name_snapshot || '').toLowerCase();
                                                    const sku = (item.product?.sku || item.product_sku_snapshot || '').toLowerCase();
                                                    return name.includes(query) || sku.includes(query);
                                                });
                                                const nonMatches = itemsToShow.filter(item => {
                                                    const name = (item.product?.name || item.product_name_snapshot || '').toLowerCase();
                                                    const sku = (item.product?.sku || item.product_sku_snapshot || '').toLowerCase();
                                                    return !name.includes(query) && !sku.includes(query);
                                                });
                                                itemsToShow = [...matches, ...nonMatches];
                                            }

                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 align-top relative group/item_cell">
                                                    <div className="flex flex-col h-full">
                                                        <div className={`max-h-[110px] overflow-y-auto custom-scrollbar space-y-3 flex-1 ${hasMany ? 'pr-8' : 'pr-1'}`}>
                                                            {itemsToShow.map((item, idx) => {
                                                                const itemName = item.product?.name || item.product_name_snapshot || '...';
                                                                const itemSku = item.product?.sku || item.product_sku_snapshot || '';

                                                                // Check if this item is a match to highlight
                                                                const isMatch = filters.search && (
                                                                    itemName.toLowerCase().includes(filters.search.toLowerCase().trim()) ||
                                                                    itemSku.toLowerCase().includes(filters.search.toLowerCase().trim())
                                                                );

                                                                const skuToneClass = isMatch ? 'text-orange-600' : 'text-orange-600/60';
                                                                const itemNameClass = isMatch ? 'font-black text-primary' : 'font-bold text-primary';

                                                                return (
                                                                    <div key={idx} className="flex items-start gap-2.5 relative">
                                                                        <div className="shrink-0 mt-0.5 w-10">
                                                                            <div className="flex h-6 min-w-[34px] items-center justify-center rounded-sm border border-orange-200 bg-orange-50 px-1.5 text-[12px] font-black leading-none text-orange-600">
                                                                                {item.quantity}x
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex items-center gap-1.5 group/name">
                                                                                <span className={`truncate text-[13px] block ${itemNameClass}`} title={itemName}>{itemName}</span>
                                                                                <button onClick={(e) => { e.stopPropagation(); handleCopy(itemName, e); }} className="opacity-0 group-hover/name:opacity-100 p-0.5 hover:text-primary transition-all text-primary/30 flex shrink-0"><span className="material-symbols-outlined text-[14px]">content_copy</span></button>
                                                                            </div>
                                                                            {itemSku && (
                                                                                <div className="flex items-center gap-1.5 group/sku mt-0.5">
                                                                                    <span className={`truncate font-black text-[13px] block ${skuToneClass}`} title={itemSku}>{itemSku}</span>
                                                                                    <button onClick={(e) => { e.stopPropagation(); handleCopy(itemSku, e); }} className="opacity-0 group-hover/sku:opacity-100 p-0.5 hover:text-primary transition-all text-primary/30 flex shrink-0"><span className="material-symbols-outlined text-[14px]">content_copy</span></button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        {hasMany && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    productPopupAnchorRef.current = e.currentTarget;
                                                                    setProductPopupOrderId(o.id);
                                                                }}
                                                                className="absolute right-1 bottom-1 w-7 h-7 bg-primary text-white rounded-sm flex items-center justify-center hover:bg-primary-700 transition-all shadow-md z-10 opacity-0 group-hover/item_cell:opacity-100"
                                                                title="Xem đầy đủ danh sách"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">visibility</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'total_price') {
                                            const formattedPrice = new Intl.NumberFormat('vi-VN').format(Math.floor(o.total_price));
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 font-black text-brick group/price relative">
                                                    <div className="flex items-center justify-between">
                                                        <span>{formattedPrice}₫</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(formattedPrice.replace(/\./g, ''), e); }} className={`opacity-0 group-hover/price:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === formattedPrice.replace(/\./g, '') ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'inventory_slips') {
                                            const isDraftRow = isDraftOrder(o.order_kind);
                                            if (isDraftRow) {
                                                return (
                                                    <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20">
                                                        <span className="inline-flex items-center gap-1 rounded-sm border border-primary/10 bg-primary/[0.03] px-2 py-1 text-[11px] font-black text-primary/45">
                                                            <span className="material-symbols-outlined text-[13px]">inventory_2</span>
                                                            Không dùng phiếu kho
                                                        </span>
                                                    </td>
                                                );
                                            }

                                            const summary = o.inventory_slip_summary || {
                                                label: 'Chưa tạo phiếu',
                                                tone: 'slate',
                                                required_quantity: 0,
                                                exported_quantity: 0,
                                                return_slip_count: 0,
                                                damaged_slip_count: 0,
                                                export_slip_count: 0,
                                                quick_summary: 'Chưa có dữ liệu phiếu kho.',
                                            };

                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setInventorySlipOrderId(o.id);
                                                        }}
                                                        title={summary.quick_summary || 'Xem chi tiết phiếu kho'}
                                                        className="group/slip flex w-full flex-col items-start gap-1 rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2 text-left transition hover:border-primary/25 hover:bg-white"
                                                    >
                                                        <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-black ${inventorySlipToneClasses[summary.tone] || inventorySlipToneClasses.slate}`}>
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                {summary.state === 'fulfilled' ? 'verified' : summary.state === 'partial' ? 'rule' : 'inventory_2'}
                                                            </span>
                                                            {summary.label}
                                                        </span>
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <span className="text-[11px] font-black text-primary/65">
                                                                {formatNumber(summary.exported_quantity || 0)}/{formatNumber(summary.required_quantity || 0)}
                                                            </span>
                                                            {(summary.export_slip_count || 0) > 0 && <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-black ${inventorySlipChipClasses.export}`}>PX {formatNumber(summary.export_slip_count)}</span>}
                                                            {(summary.return_slip_count || 0) > 0 && <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-black ${inventorySlipChipClasses.return}`}>Hoàn {formatNumber(summary.return_slip_count)}</span>}
                                                            {(summary.damaged_slip_count || 0) > 0 && <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-black ${inventorySlipChipClasses.damaged}`}>Hỏng {formatNumber(summary.damaged_slip_count)}</span>}
                                                        </div>
                                                    </button>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'status') {
                                            const isDraftRow = isDraftOrder(o.order_kind);
                                            const statusName = isDraftRow ? 'Đơn nháp' : (statusMap.get(String(o.status))?.name || o.status);
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-left group/status relative">
                                                    <div className="flex items-center justify-start gap-1">
                                                        {!isTrashView && !isDraftRow ? (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    statusMenuAnchorRef.current = e.currentTarget;
                                                                    setStatusMenuOrderId(o.id);
                                                                }}
                                                                data-status-edit-btn
                                                                className="px-2 py-1 rounded-sm text-[11px] font-black border transition-all hover:scale-105 active:scale-95 shadow-sm group/status-btn flex items-center gap-1.5"
                                                                style={getStatusStyle(o.status)}
                                                            >
                                                                <span className="truncate">{statusName}</span>
                                                                <span className="material-symbols-outlined text-[16px] leading-none opacity-40 group-hover/status-btn:opacity-100 transition-opacity">expand_more</span>
                                                            </button>
                                                        ) : (
                                                            <span className={`px-2 py-1 rounded-sm text-[11px] font-black border inline-flex items-center gap-1.5 shadow-sm ${isDraftRow ? 'border-sky-200 bg-sky-50 text-sky-700' : ''}`} style={isDraftRow ? undefined : getStatusStyle(o.status)}>
                                                                <span className="truncate">{statusName}</span>
                                                            </span>
                                                        )}
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(statusName, e); }} className={`opacity-0 group-hover/status:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === statusName ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[13px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'shipping_carrier_name') {
                                            if (isDraftOrder(o.order_kind)) {
                                                return <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary/30 font-bold">-</td>;
                                            }
                                            const issueMessage = o.shipping_issue_message || o.active_shipment?.problem_message;
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary font-bold">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="truncate">{o.shipping_carrier_name || o.active_shipment?.carrier_name || '-'}</span>
                                                        {issueMessage && (
                                                            <span className="inline-flex items-center gap-1 text-[11px] text-brick font-black truncate">
                                                                <span className="material-symbols-outlined text-[14px]">error</span>
                                                                {issueMessage}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'shipping_tracking_code') {
                                            if (isDraftOrder(o.order_kind)) {
                                                return <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary/30 font-mono font-bold">-</td>;
                                            }
                                            const trackingCode = o.shipping_tracking_code || o.active_shipment?.carrier_tracking_code || '-';
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 font-mono text-primary font-bold group/tracking">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="truncate">{trackingCode}</span>
                                                        {trackingCode !== '-' && (
                                                            <button onClick={(e) => { e.stopPropagation(); handleCopy(trackingCode, e); }} className={`opacity-0 group-hover/tracking:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === trackingCode ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'shipping_dispatched_at') {
                                            if (isDraftOrder(o.order_kind)) {
                                                return <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary/30 font-bold">-</td>;
                                            }
                                            const dispatchedAt = o.shipping_dispatched_at || o.active_shipment?.shipped_at || null;
                                            const dispatchedAtDisplay = formatDateTimeParts(dispatchedAt);
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary font-bold">
                                                    <div className="flex min-w-0 flex-col leading-[1.15]">
                                                        <span className="whitespace-nowrap">{dispatchedAtDisplay.date}</span>
                                                        {dispatchedAtDisplay.time && <span className="whitespace-nowrap">{dispatchedAtDisplay.time}</span>}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.isAttribute) {
                                            const attrVal = (o.attribute_values?.find(av => av.attribute_id === c.attrId)?.value || '-');
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 truncate text-primary font-black group/attr relative">
                                                    <div className="flex items-center justify-between">
                                                        <span className="truncate">{attrVal}</span>
                                                        {attrVal !== '-' && <button onClick={(e) => { e.stopPropagation(); handleCopy(attrVal, e); }} className={`opacity-0 group-hover/attr:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === attrVal ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'created_at') {
                                            const dateDisplay = formatDateTimeParts(o.created_at);
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary font-black italic group/date relative">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex min-w-0 flex-col leading-[1.15]">
                                                            <span className="whitespace-nowrap">{dateDisplay.date}</span>
                                                            {dateDisplay.time && <span className="whitespace-nowrap">{dateDisplay.time}</span>}
                                                        </div>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(dateDisplay.text, e); }} className={`mt-0.5 opacity-0 group-hover/date:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === dateDisplay.text ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        const cellVal = o[c.id] || '-';
                                        return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 truncate text-primary font-black italic group/gen relative">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{cellVal}</span>
                                                    {cellVal !== '-' && <button onClick={(e) => { e.stopPropagation(); handleCopy(cellVal, e); }} className={`opacity-0 group-hover/gen:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === cellVal ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                    </button>}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                {loading && <div className="absolute inset-0 bg-white/40 flex items-center justify-center z-50"><div className="w-8 h-8 border-4 border-gold/10 border-t-gold rounded-full animate-refresh-spin"></div></div>}
            </div>

            <div className="flex-none mt-4 flex justify-between items-center text-[13px] font-bold text-primary/40 border-t border-primary/10 pt-4">
                <div className="flex items-center gap-4"><span>Hiển thị {orders.length} / {pagination.total}</span><div className="flex items-center gap-2"><span>Số dòng:</span><select value={pagination.per_page} onChange={(e) => fetchOrders(1, filters, parseInt(e.target.value))} className="bg-transparent border-none outline-none font-black text-primary cursor-pointer">{[20, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}</select></div></div>
                <Pagination pagination={pagination} onPageChange={(page) => fetchOrders(page)} />
            </div>

            <StatusDropdownPortal
                order={activeStatusMenuOrder}
                orderStatuses={orderStatuses}
                onUpdate={handleQuickStatusUpdate}
                anchorRef={statusMenuAnchorRef}
                visible={!!statusMenuOrderId}
                onClose={() => setStatusMenuOrderId(null)}
                statusMenuRef={statusMenuRef}
            />
            <OrderProductsPortal items={activeProductPopupOrder?.items || []} copiedText={copiedText} onCopy={handleCopy} anchorRef={productPopupAnchorRef} visible={!!productPopupOrderId} onClose={() => setProductPopupOrderId(null)} />
            <ShippingDispatchModal
                open={dispatchModalOpen}
                carriers={connectedCarriers}
                warehouses={dispatchWarehouses}
                carrierCode={selectedCarrierCode}
                onCarrierChange={handleDispatchCarrierChange}
                warehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                preview={dispatchPreview}
                loadingPreview={dispatchPreviewLoading}
                submitting={dispatchSubmitting}
                onClose={closeDispatchModal}
                onSubmit={handleDispatchOrders}
            />
            <QuickShipmentModal
                open={quickDispatchModalOpen}
                rows={quickDispatchEditableRows}
                blockedOrders={quickDispatchBlockedOrders}
                carrierOptions={manualCarrierOptions}
                submitting={quickDispatchSubmitting}
                onFieldChange={handleQuickDispatchFieldChange}
                onClose={closeQuickDispatchModal}
                onSubmit={handleQuickDispatchOrders}
            />
            <OrderInventorySlipDrawer
                open={!!inventorySlipOrderId}
                orderId={inventorySlipOrderId}
                onClose={() => setInventorySlipOrderId(null)}
                onUpdated={() => fetchOrders(pagination.current_page || 1)}
                onNotify={setNotification}
            />
        </div>
    );
};

export default OrderList;
