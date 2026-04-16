/**
 * orderPrint.js — Luồng in đơn hàng tin cậy
 *
 * Logic:
 * 1. Mở popup window
 * 2. Ghi HTML vào popup
 * 3. Chờ tài nguyên load (ảnh, font)
 * 4. Gọi popup.print() — trình duyệt sẽ hiện hộp thoại in chuẩn
 * 5. Chờ sự kiện afterprint (hoặc timeout 10 phút) rồi resolve
 * 6. KHÔNG bao giờ tự báo "in không thành công" do heuristic sai
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const PRINT_RESOURCE_TIMEOUT_MS = 12_000;   // max chờ load ảnh/font
const PRINT_SESSION_TIMEOUT_MS  = 10 * 60 * 1000; // 10 phút — fallback nếu afterprint không fire

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (value) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })
        .format(Number(value || 0));

const formatDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    })}`;
};

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) =>
    Promise.race([
        Promise.resolve(promise).catch(() => undefined),
        delay(ms),
    ]);

// ─── Popup management ────────────────────────────────────────────────────────

/**
 * Tạo Blob URL từ HTML string, mở popup với URL đó.
 * Đây là cách đáng tin cậy nhất để print với driver máy in thật (Canon, HP, Brother...).
 * Blob URL cho popup một origin hợp lệ, tránh lỗi "In không thành công" khi dùng about:blank.
 *
 * @returns {{ popup: Window, blobUrl: string } | null}
 */
const openPrintPopup = (ownerWindow = window, html) => {
    if (typeof ownerWindow?.open !== 'function') return null;

    // Tạo blob URL từ HTML
    let blobUrl = null;
    try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        blobUrl = URL.createObjectURL(blob);
    } catch (_) {
        blobUrl = null;
    }

    const name = `order_print_${Date.now()}`;

    // Mở popup với blob URL (hoặc about:blank nếu Blob không được hỗ trợ)
    const popup = ownerWindow.open(
        blobUrl || 'about:blank',
        name,
        'width=1200,height=850,left=80,top=60,scrollbars=yes,resizable=yes,toolbar=no,menubar=no'
    );

    if (!popup) {
        // Popup bị chặn — giải phóng blob URL
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return null;
    }

    // Nếu không có blob URL, fallback dùng document.write
    if (!blobUrl) {
        try {
            popup.document.open();
            popup.document.write(html);
            popup.document.close();
        } catch (_) {
            // ignore — trình duyệt có thể block document.write
        }
    }

    return { popup, blobUrl };
};

/**
 * Chờ popup load xong sau khi navigate tới blob URL.
 */
const waitForPopupLoad = (popup) =>
    new Promise((resolve) => {
        if (!popup || popup.closed) { resolve(); return; }

        const doc = popup.document;
        if (doc && doc.readyState === 'complete') { resolve(); return; }

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(tid);
            resolve();
        };

        const tid = setTimeout(finish, PRINT_RESOURCE_TIMEOUT_MS);
        popup.addEventListener('load', finish, { once: true });
    });

/**
 * Chờ tất cả ảnh trong popup load xong.
 */
const waitForImages = async (targetWindow) => {
    const images = Array.from(targetWindow.document?.images || []);
    if (!images.length) return;

    await Promise.all(
        images.map(
            (img) =>
                new Promise((resolve) => {
                    if (img.complete) { resolve(); return; }

                    let done = false;
                    const finish = () => { if (!done) { done = true; resolve(); } };
                    const tid = setTimeout(finish, PRINT_RESOURCE_TIMEOUT_MS);

                    img.addEventListener('load',  () => { clearTimeout(tid); finish(); }, { once: true });
                    img.addEventListener('error', () => { clearTimeout(tid); finish(); }, { once: true });
                })
        )
    );
};

/**
 * Chờ font load xong.
 */
const waitForFonts = async (targetWindow) => {
    const fonts = targetWindow.document?.fonts;
    if (fonts?.ready) {
        await withTimeout(fonts.ready, PRINT_RESOURCE_TIMEOUT_MS);
    }
};

/**
 * Chờ 1 frame paint để đảm bảo layout đã render.
 */
const waitForPaint = (targetWindow) =>
    new Promise((resolve) => {
        const raf = targetWindow?.requestAnimationFrame?.bind(targetWindow);
        if (typeof raf !== 'function') {
            setTimeout(resolve, 60);
            return;
        }
        raf(() => raf(resolve));
    });

// ─── Core print function ─────────────────────────────────────────────────────

/**
 * Gọi hộp thoại in trong popup, resolve sau khi afterprint fire (hoặc timeout).
 *
 * Quan trọng:
 * - KHÔNG reject / throw khi sau khi user bấm Hủy trong hộp thoại in —
 *   đó là hành động hợp lệ, không phải lỗi.
 * - KHÔNG dùng focus/blur heuristic vì không tin cậy với máy in thật.
 * - afterprint event được fire bởi trình duyệt sau khi hộp thoại in đóng,
 *   dù user bấm In hay Hủy.
 */
const triggerPrint = (popupWindow) =>
    new Promise((resolve) => {
        let settled = false;
        let timeoutId = null;

        const finish = (reason) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            popupWindow.removeEventListener('afterprint', handleAfterPrint);
            resolve({ reason });
        };

        const handleAfterPrint = () => finish('afterprint');

        // Fallback: nếu afterprint không bao giờ fire (một số trình duyệt/máy in cũ)
        timeoutId = setTimeout(() => finish('timeout'), PRINT_SESSION_TIMEOUT_MS);

        popupWindow.addEventListener('afterprint', handleAfterPrint);

        // Gọi print sau một tick để listener đã được gắn
        setTimeout(() => {
            try {
                popupWindow.focus();
                popupWindow.print();
            } catch (err) {
                // Nếu print() bị block (rất hiếm), vẫn resolve để không treo UI
                finish('print-error');
            }
        }, 0);
    });

/**
 * Hàm in chính — tạo Blob URL, mở popup, chờ load, gọi hộp thoại in.
 *
 * Tại sao dùng Blob URL thay vì about:blank + document.write:
 * - Blob URL cho popup một origin hợp lệ (blob:https://...)
 * - Chrome/Edge xử lý print job đúng với driver máy in thật (Canon, HP, Brother...)
 * - about:blank + document.write có thể gây lỗi "In không thành công" với một số driver
 *
 * @param {string} html        - HTML document đầy đủ cần in
 * @param {string} [title]     - tiêu đề
 * @param {Window} [ownerWin]  - window của trang admin (mặc định: window)
 * @returns {{ close: () => void, reason: string }}
 * @throws {Error} chỉ khi popup bị chặn hoặc Blob không được hỗ trợ
 */
const printHtmlInPopup = async (html, title = 'In đơn hàng', ownerWin = window) => {
    const result = openPrintPopup(ownerWin, html);

    if (!result) {
        throw new Error(
            'Không thể mở cửa sổ in. ' +
            'Trình duyệt đang chặn popup — vui lòng cho phép popup từ trang này và thử lại.\n\n' +
            'Cách bật: Thanh địa chỉ → click biểu tượng bị chặn → "Luôn cho phép".'
        );
    }

    const { popup, blobUrl } = result;

    // Dọn dẹp blob URL sau khi dùng xong
    const releaseBlobUrl = () => {
        if (blobUrl) {
            try { URL.revokeObjectURL(blobUrl); } catch (_) { /* ignore */ }
        }
    };

    // Chờ popup load xong (quan trọng với blob URL vì phải chờ navigate)
    await waitForPopupLoad(popup);

    // Chờ ảnh + font sau khi document ready
    await Promise.all([waitForImages(popup), waitForFonts(popup)]);
    await waitForPaint(popup);

    // Delay nhỏ để layout settle hoàn toàn trước khi in
    // Quan trọng với Canon LBP 6030 — driver cần thời gian khởi tạo
    await delay(300);

    // Gọi hộp thoại in (luôn resolve, không bao giờ reject)
    const printResult = await triggerPrint(popup);

    const close = () => {
        releaseBlobUrl();
        try {
            if (!popup.closed) popup.close();
        } catch (_) {
            // ignore
        }
    };

    return { close, reason: printResult.reason };
};

// ─── HTML builders ───────────────────────────────────────────────────────────

const renderOrderRows = (items = []) => {
    if (!items.length) {
        return `<tr><td colspan="5" class="empty-state">Đơn hàng không có sản phẩm.</td></tr>`;
    }

    return items
        .map(
            (item, index) => `
        <tr>
            <td class="col-index">${index + 1}</td>
            <td class="col-name">
                <div class="product-name">${escapeHtml(item.name || '-')}</div>
                ${item.sku ? `<div class="product-sku">SKU: ${escapeHtml(item.sku)}</div>` : ''}
            </td>
            <td class="col-qty">${escapeHtml(item.quantity ?? 0)}</td>
            <td class="col-money">${escapeHtml(formatCurrency(item.unit_price))}</td>
            <td class="col-money">${escapeHtml(formatCurrency(item.line_total))}</td>
        </tr>`
        )
        .join('');
};

export const buildOrderPrintDocument = (orders = []) => {
    const printedAt = formatDateTime(new Date().toISOString());

    const sections = orders
        .map(
            (order, orderIndex) => `
        <section class="order-sheet ${orderIndex === orders.length - 1 ? 'order-sheet-last' : ''}">
            <div class="order-sheet__inner">
                <header class="sheet-header">
                    <div>
                        <div class="sheet-kicker">In đơn hàng</div>
                        <h1 class="sheet-title">Đơn #${escapeHtml(order.order_number || '-')}</h1>
                    </div>
                    <div class="sheet-meta">
                        <div><span>Ngày in:</span> ${escapeHtml(printedAt || '-')}</div>
                        <div><span>Khách hàng:</span> ${escapeHtml(order.customer_name || '-')}</div>
                    </div>
                </header>

                <section class="info-grid">
                    <article class="info-card">
                        <div class="info-label">Mã đơn</div>
                        <div class="info-value">${escapeHtml(order.order_number || '-')}</div>
                    </article>
                    <article class="info-card">
                        <div class="info-label">Tên khách hàng</div>
                        <div class="info-value">${escapeHtml(order.customer_name || '-')}</div>
                    </article>
                    <article class="info-card">
                        <div class="info-label">Số điện thoại</div>
                        <div class="info-value">${escapeHtml(order.customer_phone || '-')}</div>
                    </article>
                    <article class="info-card info-card-wide">
                        <div class="info-label">Địa chỉ</div>
                        <div class="info-value info-value-wrap">${escapeHtml(order.shipping_address || '-')}</div>
                    </article>
                    <article class="info-card info-card-full">
                        <div class="info-label">Ghi chú đơn hàng</div>
                        <div class="info-value info-value-wrap">${escapeHtml(order.notes || 'Không có ghi chú.')}</div>
                    </article>
                </section>

                <table class="items-table">
                    <thead>
                        <tr>
                            <th class="col-index">STT</th>
                            <th class="col-name">Sản phẩm</th>
                            <th class="col-qty">Số lượng</th>
                            <th class="col-money">Đơn giá</th>
                            <th class="col-money">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderOrderRows(order.items)}
                    </tbody>
                </table>

                <div class="summary-row">
                    <div class="summary-box">
                        <div class="summary-label">Tổng thanh toán</div>
                        <div class="summary-value">${escapeHtml(formatCurrency(order.total_payment))}</div>
                    </div>
                </div>
            </div>
        </section>`
        )
        .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>In đơn hàng</title>
    <style>
        :root { color-scheme: light; }

        * { box-sizing: border-box; }

        html, body {
            margin: 0;
            padding: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #111827;
            background: #ffffff;
            font-size: 12px;
            line-height: 1.5;
        }

        /* ── Page setup ── */
        @page {
            margin: 12mm 10mm;
        }

        /* ── Order sheets ── */
        .order-sheet {
            page-break-after: always;
            break-after: page;
        }
        .order-sheet-last {
            page-break-after: auto;
            break-after: auto;
        }
        .order-sheet__inner {
            padding: 0;
        }

        /* ── Header ── */
        .sheet-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 14px;
            flex-wrap: wrap;
            margin-bottom: 12px;
            border-bottom: 2px solid #111827;
            padding-bottom: 10px;
        }
        .sheet-kicker {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: #6b7280;
            margin-bottom: 4px;
        }
        .sheet-title {
            margin: 0;
            font-size: 24px;
            line-height: 1.1;
            font-weight: 800;
        }
        .sheet-meta {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 220px;
            text-align: right;
            font-size: 11px;
            line-height: 1.45;
        }
        .sheet-meta span {
            font-weight: 700;
            color: #6b7280;
        }

        /* ── Info grid ── */
        .info-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin-bottom: 12px;
        }
        .info-card {
            border: 1px solid #d1d5db;
            padding: 8px 10px;
            min-height: 60px;
        }
        .info-card-wide  { grid-column: span 2; }
        .info-card-full  { grid-column: 1 / -1; min-height: 76px; }
        .info-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            color: #6b7280;
            margin-bottom: 5px;
        }
        .info-value {
            font-size: 13px;
            font-weight: 700;
            line-height: 1.45;
            overflow-wrap: anywhere;
        }
        .info-value-wrap {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        /* ── Items table ── */
        .items-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        .items-table thead { display: table-header-group; }
        .items-table tr    { break-inside: avoid; page-break-inside: avoid; }
        .items-table th,
        .items-table td {
            border: 1px solid #d1d5db;
            padding: 7px 8px;
            vertical-align: top;
        }
        .items-table th {
            background: #f8fafc;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: #374151;
        }
        .col-index { width: 7%;  text-align: center; }
        .col-name  { width: 49%; }
        .col-qty   { width: 12%; text-align: center; }
        .col-money { width: 16%; text-align: right; white-space: nowrap; }
        .product-name { font-weight: 700; line-height: 1.45; overflow-wrap: anywhere; }
        .product-sku  { margin-top: 3px; font-size: 10px; color: #6b7280; }
        .empty-state  { padding: 16px 12px; text-align: center; color: #6b7280; font-style: italic; }

        /* ── Summary ── */
        .summary-row  { display: flex; justify-content: flex-end; margin-top: 12px; }
        .summary-box  { width: min(100%, 320px); border: 2px solid #111827; padding: 10px 12px; margin-left: auto; }
        .summary-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            color: #6b7280;
            margin-bottom: 4px;
        }
        .summary-value {
            font-size: 22px;
            font-weight: 800;
            text-align: right;
            line-height: 1.2;
        }

        /* ── Screen-only decoration ── */
        @media screen {
            html, body { background: #eef2f7; }
            body { padding: 16px; }
            .order-sheet {
                max-width: 1180px;
                margin: 0 auto 16px;
                border: 1px solid #d1d5db;
                background: #ffffff;
                box-shadow: 0 24px 60px -40px rgba(15,23,42,.35);
            }
            .order-sheet__inner { padding: 16px 18px 18px; }
        }

        /* ── Print overrides ── */
        @media print {
            html, body { background: #ffffff; padding: 0; }
            .order-sheet { margin: 0; border: none; box-shadow: none; background: transparent; }
        }

        /* ── Responsive (screen only) ── */
        @media (max-width: 900px) {
            .sheet-meta { min-width: 0; width: 100%; text-align: left; }
            .info-grid  { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .info-card-wide, .info-card-full { grid-column: span 2; }
        }
        @media (max-width: 640px) {
            .info-grid  { grid-template-columns: 1fr; }
            .info-card-wide, .info-card-full { grid-column: auto; }
            .items-table { table-layout: auto; }
            .col-index, .col-name, .col-qty, .col-money { width: auto; }
            .summary-box { width: 100%; }
        }
    </style>
</head>
<body>
    ${sections}
</body>
</html>`;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mở cửa sổ in chuẩn của trình duyệt với danh sách đơn hàng.
 *
 * @param {Array}  orders          - mảng đơn hàng từ API
 * @param {Object} [options]
 * @param {Window} [options.ownerWindow] - parent window (mặc định: global window)
 * @returns {{ close: () => void, reason: string }}
 * @throws {Error} chỉ khi popup bị chặn
 */
export const printOrders = async (orders = [], options = {}) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error('Không có dữ liệu đơn hàng để in.');
    }

    const ownerWindow = options.ownerWindow || window;
    const primaryOrder = orders[0] || {};
    const title =
        orders.length > 1
            ? `In ${orders.length} đơn hàng`
            : `In đơn #${primaryOrder.order_number || ''}`.trim();

    const html = buildOrderPrintDocument(orders);

    return printHtmlInPopup(html, title, ownerWindow);
};

/**
 * Đóng session in (popup window).
 */
export const closePrintSession = (session) => {
    if (!session) return;
    if (typeof session.close === 'function') {
        session.close();
    }
};

/**
 * (Legacy / không dùng trong luồng chính) — In trang hiện tại
 */
export const printCurrentPage = async (sourceWindow = window) => {
    const title = sourceWindow.document?.title || 'In đơn hàng';

    return printHtmlInPopup(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${
            sourceWindow.document.body?.innerHTML || ''
        }</body></html>`,
        title,
        sourceWindow
    );
};

/**
 * (Legacy) — Chuẩn bị popup trước rồi dùng sau.
 * Giữ export để không break import cũ — nhưng giờ chỉ trả về null
 * vì luồng mới không cần pre-warm popup.
 */
export const preparePrintPopupWindow = () => null;
