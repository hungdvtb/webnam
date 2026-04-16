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

// ─── Resource helpers ────────────────────────────────────────────────────────

/** Chờ tất cả ảnh trong một window load xong. */
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

/** Chờ font load xong. */
const waitForFonts = async (targetWindow) => {
    const fonts = targetWindow.document?.fonts;
    if (fonts?.ready) {
        await withTimeout(fonts.ready, PRINT_RESOURCE_TIMEOUT_MS);
    }
};

/** Chờ 1 frame paint để đảm bảo layout đã render. */
const waitForPaint = (targetWindow) =>
    new Promise((resolve) => {
        const raf = targetWindow?.requestAnimationFrame?.bind(targetWindow);
        if (typeof raf !== 'function') {
            setTimeout(resolve, 60);
            return;
        }
        raf(() => raf(resolve));
    });

// ─── Main-window print với visibility trick ──────────────────────────────────

/**
 * In bằng cách gọi window.print() trên chính trang admin.
 *
 * Cơ chế:
 * 1. Parse HTML đơn hàng → lấy CSS + body content
 * 2. Inject content container vào DOM (off-screen, KHÔNG dùng display:none
 *    vì display:none inline không thể override bằng CSS stylesheet)
 * 3. Inject @media print CSS: ẩn React app (visibility:hidden),
 *    hiện container đơn hàng (visibility:visible + position:fixed)
 * 4. Gọi window.print() — tương đương Ctrl+P
 * 5. Dọn dẹp sau afterprint
 */
const printWithMainWindow = async (html, ownerWin = window) => {
    const ownerDoc = ownerWin.document;

    const STYLE_ID   = '__order_print_style__';
    const CONTENT_ID = '__order_print_content__';

    // Dọn injection cũ nếu còn
    ownerDoc.getElementById(STYLE_ID)?.remove();
    ownerDoc.getElementById(CONTENT_ID)?.remove();

    // Parse HTML để tách <style> và <body> content
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    // Lấy toàn bộ CSS từ HTML đơn hàng
    const rawCss = Array.from(parsed.querySelectorAll('style'))
        .map((s) => s.textContent)
        .join('\n');

    // Tách @page rules ra riêng — Chrome không cho phép @page lồng trong @media print
    const pageRules  = [];
    const otherCss   = rawCss.replace(/@page\s*\{[^}]*\}/g, (m) => { pageRules.push(m); return ''; });

    // Inject style block vào <head>
    const styleEl = ownerDoc.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = `
        /* @page phải ở top-level (không được lồng trong @media print) */
        ${pageRules.join('\n')}

        @media print {
            /* 1. Ẩn toàn bộ React app bằng visibility (KHÔNG dùng display:none
               vì display:none có thể làm mất layout và gây lỗi render) */
            html, body { visibility: hidden !important; }

            /* 2. Hiện ONLY container đơn hàng — children kế thừa visibility:visible */
            #${CONTENT_ID},
            #${CONTENT_ID} * { visibility: visible !important; }

            #${CONTENT_ID} {
                position: fixed !important;
                left: 0 !important;
                top: 0 !important;
                right: 0 !important;
                bottom: auto !important;
                width: 100% !important;
                height: auto !important;
                overflow: visible !important;
                background: #ffffff !important;
            }

            /* 3. CSS nội dung đơn hàng (fonts, tables, v.v.) */
            ${otherCss}
        }
    `;
    ownerDoc.head.appendChild(styleEl);

    // Inject body content — KHÔNG dùng display:none (inline style không thể override bằng CSS)
    // Thay vào đó: đặt ra ngoài viewport bình thường, @media print sẽ kéo về position:fixed
    const contentEl = ownerDoc.createElement('div');
    contentEl.id = CONTENT_ID;
    contentEl.style.cssText = [
        'position:fixed',
        'left:-210mm',     // nằm ngoài màn hình bên trái
        'top:0',
        'width:210mm',
        'overflow:visible',
        // KHÔNG dùng display:none hay visibility:hidden
        // để @media print có thể override được
    ].join(';');
    contentEl.innerHTML = parsed.body?.innerHTML || '';
    ownerDoc.body.appendChild(contentEl);

    // Chờ DOM update
    await delay(200);

    const cleanup = () => {
        try { ownerDoc.getElementById(STYLE_ID)?.remove(); }   catch (_) { /* ignore */ }
        try { ownerDoc.getElementById(CONTENT_ID)?.remove(); } catch (_) { /* ignore */ }
    };

    // Gọi window.print() — tương đương Ctrl+P, driver luôn nhận
    const printResult = await new Promise((resolve) => {
        let settled = false;
        let timeoutId = null;

        const finish = (reason) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            try { ownerWin.removeEventListener('afterprint', handleAfterPrint); } catch (_) { /* ignore */ }
            resolve({ reason });
        };

        const handleAfterPrint = () => finish('afterprint');
        ownerWin.addEventListener('afterprint', handleAfterPrint);
        timeoutId = setTimeout(() => finish('timeout'), 90_000);

        setTimeout(() => {
            try {
                ownerWin.print();
            } catch (err) {
                finish('print-error');
            }
        }, 0);
    });

    cleanup();

    return { close: () => { /* nothing */ }, reason: printResult.reason };
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
    const _title =
        orders.length > 1
            ? `In ${orders.length} đơn hàng`
            : `In đơn #${primaryOrder.order_number || ''}`.trim();

    const html = buildOrderPrintDocument(orders);

    // Dùng main window print — tương đương Ctrl+P, tin cậy nhất với mọi driver
    return printWithMainWindow(html, ownerWindow);
};

/**
 * Đóng session in (iframe cleanup).
 */
export const closePrintSession = (session) => {
    if (!session) return;
    if (typeof session.close === 'function') {
        session.close();
    }
};

/**
 * (Legacy / không dùng trong luồng chính)
 */
export const printCurrentPage = async (sourceWindow = window) => {
    const ownerDoc = sourceWindow.document || document;
    const title = ownerDoc?.title || 'In đơn hàng';

    return printHtmlInIframe(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${
            ownerDoc.body?.innerHTML || ''
        }</body></html>`,
        ownerDoc
    );
};

/**
 * (Legacy) — Chuẩn bị popup trước rồi dùng sau.
 * Giữ export để không break import cũ — nhưng giờ chỉ trả về null
 * vì luồng mới không cần pre-warm popup.
 */
export const preparePrintPopupWindow = () => null;

// ─── PDF Export ───────────────────────────────────────────────────────────────

/**
 * Tạo file PDF từ danh sách đơn hàng và download luôn về máy.
 *
 * Cách hoạt động:
 * 1. Build HTML document giống như in
 * 2. Render vào hidden iframe (kích thước A4)
 * 3. Dùng html2canvas chụp từng trang
 * 4. Ghép vào PDF bằng jsPDF
 * 5. Auto download file .pdf
 *
 * @param {Array}  orders    - mảng đơn hàng từ API
 * @param {string} [filename]
 */
export const exportOrderPdf = async (orders = [], filename) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error('Không có dữ liệu đơn hàng để xuất PDF.');
    }

    // Lazy-load libraries để không làm nặng bundle khi không dùng
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
    ]);

    const html = buildOrderPrintDocument(orders);

    // Tạo iframe ẩn kích thước A4 để render HTML
    const iframeId = '__order_pdf_export_frame__';
    document.getElementById(iframeId)?.remove();

    const iframe = document.createElement('iframe');
    iframe.id = iframeId;
    // A4 at 96 DPI: 794 x 1123 px
    iframe.style.cssText = [
        'position:fixed',
        'left:-900px',
        'top:0',
        'width:794px',
        'height:1123px',
        'border:none',
        'overflow:hidden',
        'z-index:-99999',
    ].join(';');
    document.body.appendChild(iframe);

    // Ghi HTML vào iframe
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) { iframe.remove(); throw new Error('Không thể khởi tạo iframe PDF.'); }
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Chờ load xong
    await new Promise((resolve) => {
        if (iframeDoc.readyState === 'complete') { resolve(); return; }
        iframe.addEventListener('load', resolve, { once: true });
        setTimeout(resolve, 12_000);
    });
    await delay(300);

    // Tìm tất cả các trang đơn hàng trong iframe
    const iframeWin = iframe.contentWindow;
    const sheets = Array.from(iframeDoc.querySelectorAll('.order-sheet, .order-sheet-last'));
    if (!sheets.length) {
        iframe.remove();
        throw new Error('Không tìm thấy nội dung đơn hàng để xuất PDF.');
    }

    // Khởi tạo jsPDF với khổ A4
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];

        // Chụp từng trang bằng html2canvas
        const canvas = await html2canvas(sheet, {
            scale:         2,              // 2x để ảnh nét hơn
            useCORS:       true,
            allowTaint:    true,
            backgroundColor: '#ffffff',
            windowWidth:   794,
            windowHeight:  1123,
            scrollX:       0,
            scrollY:       0,
            logging:       false,
            foreignObjectRendering: false,
            onclone: (cloneDoc) => {
                // Đảm bảo tất cả nội dung hiện khi chụp
                cloneDoc.querySelectorAll('*').forEach((el) => {
                    el.style.visibility = 'visible';
                });
            },
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.92);

        // Thêm trang mới (trừ trang đầu tiên)
        if (i > 0) pdf.addPage();

        // Scale ảnh vừa khổ A4, giữ tỉ lệ
        const imgW = pdfW;
        const imgH = (canvas.height * imgW) / canvas.width;
        const finalH = Math.min(imgH, pdfH);

        pdf.addImage(imgData, 'JPEG', 0, 0, imgW, finalH);
    }

    iframe.remove();

    // Tên file
    const defaultName = orders.length === 1
        ? `don-hang-${orders[0].order_number || 'unknown'}.pdf`
        : `don-hang-${orders.length}-orders.pdf`;

    pdf.save(filename || defaultName);
};
