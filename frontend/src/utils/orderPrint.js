const PRINT_RESOURCE_TIMEOUT_MS = 12_000;
const PRINT_DIALOG_TIMEOUT_MS = 90_000;

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_TOP_MM = 10;
const PAGE_MARGIN_RIGHT_MM = 9;
const PAGE_MARGIN_BOTTOM_MM = 12;
const PAGE_MARGIN_LEFT_MM = 9;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - PAGE_MARGIN_LEFT_MM - PAGE_MARGIN_RIGHT_MM;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - PAGE_MARGIN_TOP_MM - PAGE_MARGIN_BOTTOM_MM;
const MM_TO_PX_FACTOR = 96 / 25.4;
const CONTENT_WIDTH_PX = Math.floor(CONTENT_WIDTH_MM * MM_TO_PX_FACTOR);
const CONTENT_HEIGHT_PX = Math.floor(CONTENT_HEIGHT_MM * MM_TO_PX_FACTOR);
const PAGE_FIT_BUFFER_PX = 8;

const PRINT_FRAME_ID = '__order_print_frame__';
const PDF_FRAME_ID = '__order_pdf_frame__';
const MEASURE_FRAME_ID = '__order_measure_frame__';

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

const getOrderItems = (order = {}) =>
    (Array.isArray(order.items) ? order.items : []).map((item) => {
        const quantity = Number(item?.quantity ?? 0);
        const unitPrice = Number(item?.unit_price ?? item?.price ?? 0);
        const lineTotal = Number(item?.line_total ?? (quantity * unitPrice) ?? 0);

        return {
            name: item?.name || '-',
            sku: item?.sku || '',
            quantity,
            unit_price: unitPrice,
            line_total: lineTotal,
        };
    });

const waitForImages = async (targetWindow) => {
    const images = Array.from(targetWindow.document?.images || []);
    if (!images.length) return;

    await Promise.all(
        images.map(
            (img) =>
                new Promise((resolve) => {
                    if (img.complete) {
                        resolve();
                        return;
                    }

                    let settled = false;
                    const finish = () => {
                        if (settled) return;
                        settled = true;
                        resolve();
                    };

                    const timeoutId = setTimeout(finish, PRINT_RESOURCE_TIMEOUT_MS);
                    img.addEventListener('load', () => {
                        clearTimeout(timeoutId);
                        finish();
                    }, { once: true });
                    img.addEventListener('error', () => {
                        clearTimeout(timeoutId);
                        finish();
                    }, { once: true });
                })
        )
    );
};

const waitForFonts = async (targetWindow) => {
    const fonts = targetWindow.document?.fonts;
    if (fonts?.ready) {
        await withTimeout(fonts.ready, PRINT_RESOURCE_TIMEOUT_MS);
    }
};

const waitForPaint = (targetWindow) =>
    new Promise((resolve) => {
        const raf = targetWindow?.requestAnimationFrame?.bind(targetWindow);
        if (typeof raf !== 'function') {
            setTimeout(resolve, 60);
            return;
        }

        raf(() => raf(resolve));
    });

const createHiddenIframe = (frameId) => {
    const iframe = document.createElement('iframe');
    iframe.id = frameId;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = [
        'position:fixed',
        'left:-10000px',
        'top:0',
        `width:${Math.max(CONTENT_WIDTH_PX + 64, 820)}px`,
        `height:${Math.max(CONTENT_HEIGHT_PX + 64, 1180)}px`,
        'border:0',
        'opacity:0',
        'pointer-events:none',
        'background:#ffffff',
        'z-index:-99999',
    ].join(';');

    document.body.appendChild(iframe);
    return iframe;
};

const removeIframe = (frameId) => {
    document.getElementById(frameId)?.remove();
};

const loadHtmlIntoIframe = async (iframe, html) => {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    const iframeWin = iframe.contentWindow;

    if (!iframeDoc || !iframeWin) {
        throw new Error('Khong the khoi tao khung in PDF.');
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    await new Promise((resolve) => {
        const startedAt = Date.now();

        const finish = () => resolve();
        const checkReadyState = () => {
            if (iframeDoc.readyState === 'complete') {
                finish();
                return;
            }

            if (Date.now() - startedAt >= PRINT_RESOURCE_TIMEOUT_MS) {
                finish();
                return;
            }

            setTimeout(checkReadyState, 30);
        };

        checkReadyState();
    });

    await waitForImages(iframeWin);
    await waitForFonts(iframeWin);
    await waitForPaint(iframeWin);
    await delay(40);

    return { iframeDoc, iframeWin };
};

const renderOrderRows = (items = [], startIndex = 0, measurement = false) => {
    if (!items.length) {
        return `<tr><td colspan="5" class="empty-state">Don hang khong co san pham.</td></tr>`;
    }

    return items
        .map((item, index) => `
        <tr${measurement ? ' data-measure-row="true"' : ''}>
            <td class="col-index"><div class="cell-center"><span class="cell-text">${startIndex + index + 1}</span></div></td>
            <td class="col-name">
                <div class="product-cell">
                    <div class="product-name"><span class="product-text">${escapeHtml(item.name || '-')}</span></div>
                    ${item.sku ? `<div class="product-sku"><span class="product-sku-text">SKU: ${escapeHtml(item.sku)}</span></div>` : ''}
                </div>
            </td>
            <td class="col-qty"><div class="cell-center"><span class="cell-text">${escapeHtml(item.quantity ?? 0)}</span></div></td>
            <td class="col-money"><div class="cell-money"><span class="cell-text">${escapeHtml(formatCurrency(item.unit_price))}</span></div></td>
            <td class="col-money"><div class="cell-money cell-money--total"><span class="cell-text">${escapeHtml(formatCurrency(item.line_total))}</span></div></td>
        </tr>`)
        .join('');
};

const renderTableHead = (measurement = false) => `
    <thead${measurement ? ' data-measure-table-head="true"' : ''}>
        <tr>
            <th class="col-index"><div class="head-cell"><span class="head-text">STT</span></div></th>
            <th class="col-name"><div class="head-cell"><span class="head-text">San pham</span></div></th>
            <th class="col-qty"><div class="head-cell"><span class="head-text">So luong</span></div></th>
            <th class="col-money"><div class="head-cell"><span class="head-text">Don gia</span></div></th>
            <th class="col-money"><div class="head-cell"><span class="head-text">Thanh tien</span></div></th>
        </tr>
    </thead>`;

const renderFullHeader = (order, printedAt, pageNumber, pageCount, measurement = false) => `
    <div class="page-top page-top--full"${measurement ? ' data-measure-top="first"' : ''}>
        <div class="page-header">
            <div class="page-header__main">
                <div class="page-kicker">IN DON HANG</div>
                <h1 class="page-order-code">Don #${escapeHtml(order.order_number || '-')}</h1>
            </div>
            <div class="page-header__meta">
                <div class="page-meta-block">
                    <span class="page-meta-label">Ngay in</span>
                    <span class="page-meta-value">${escapeHtml(printedAt || '-')}</span>
                </div>
                ${pageCount > 1 ? `
                    <div class="page-meta-block">
                        <span class="page-meta-label">Trang</span>
                        <span class="page-meta-value">${pageNumber}/${pageCount}</span>
                    </div>` : ''}
            </div>
        </div>

        <div class="detail-stack">
            <div class="detail-row detail-row--contact">
                <div class="detail-split">
                    <div class="detail-inline detail-inline--grow">
                        <div class="detail-label"><span class="detail-text">Khach hang</span></div>
                        <div class="detail-value detail-value--truncate"><span class="detail-text detail-text--value">${escapeHtml(order.customer_name || '-')}</span></div>
                    </div>
                    <div class="detail-inline detail-inline--phone">
                        <div class="detail-divider" aria-hidden="true"></div>
                        <div class="detail-label"><span class="detail-text">SDT</span></div>
                        <div class="detail-value detail-value--phone"><span class="detail-text detail-text--value">${escapeHtml(order.customer_phone || '-')}</span></div>
                    </div>
                </div>
            </div>
            <div class="detail-row detail-row--text">
                <div class="detail-label"><span class="detail-text">Dia chi</span></div>
                <div class="detail-value detail-value--wrap"><span class="detail-text detail-text--value">${escapeHtml(order.shipping_address || '-')}</span></div>
            </div>
            <div class="detail-row detail-row--text">
                <div class="detail-label"><span class="detail-text">Ghi chu</span></div>
                <div class="detail-value detail-value--wrap"><span class="detail-text detail-text--value">${escapeHtml(order.notes || 'Khong co ghi chu.')}</span></div>
            </div>
        </div>
    </div>`;

const renderContinuationHeader = (order, pageNumber, pageCount, measurement = false) => `
    <div class="page-top page-top--continuation"${measurement ? ' data-measure-top="continuation"' : ''}>
        <span class="continue-code">Don #${escapeHtml(order.order_number || '-')}</span>
        <span class="continue-meta">Trang ${pageNumber}/${pageCount}</span>
    </div>`;

const renderSummary = (order, measurement = false) => `
    <div class="summary-row"${measurement ? ' data-measure-summary="true"' : ''}>
        <div class="summary-box">
            <div class="summary-label"><span class="summary-text">Tong thanh toan:</span></div>
            <div class="summary-value"><span class="summary-text summary-text--value">${escapeHtml(formatCurrency(order.total_payment))}</span></div>
        </div>
    </div>`;

const renderOrderPage = ({
    order,
    printedAt,
    items,
    startIndex,
    isFirstPage,
    isLastPage,
    pageNumber,
    pageCount,
    isDocumentLast,
    measurementPageType = '',
}) => {
    const measurement = Boolean(measurementPageType);
    const pageClasses = [
        'print-page',
        isDocumentLast ? 'print-page--last' : '',
    ].filter(Boolean).join(' ');

    const pageAttrs = measurementPageType
        ? ` data-measure-page="${measurementPageType}"`
        : '';

    return `
        <section class="${pageClasses}"${pageAttrs}>
            <div class="page-shell">
                ${isFirstPage
                    ? renderFullHeader(order, printedAt, pageNumber, pageCount, measurement)
                    : renderContinuationHeader(order, pageNumber, pageCount, measurement)}
                <div class="table-wrap">
                    <table class="items-table">
                        ${renderTableHead(measurement)}
                        <tbody>
                            ${renderOrderRows(items, startIndex, measurement)}
                        </tbody>
                    </table>
                </div>
                ${isLastPage ? renderSummary(order, measurement) : ''}
            </div>
        </section>`;
};

const getOrderPrintStyles = () => `
    :root {
        color-scheme: light;
        --page-width: ${CONTENT_WIDTH_MM}mm;
        --page-height: ${CONTENT_HEIGHT_MM}mm;
        --page-bg: #ffffff;
        --page-text: #0f172a;
        --page-muted: #64748b;
        --page-border: #d7dde5;
        --page-border-strong: #111827;
        --page-header-bg: #f8fafc;
        --page-row-bg: #fcfcfd;
    }

    * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    html, body {
        margin: 0;
        padding: 0;
        background: #f1f5f9;
        color: var(--page-text);
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 11px;
        line-height: 1.35;
    }

    body {
        padding: 12px;
    }

    body.measurement-mode {
        padding: 0;
        background: #ffffff;
    }

    .print-document {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .print-page {
        width: var(--page-width);
        height: var(--page-height);
        margin: 0 auto;
        background: var(--page-bg);
        box-shadow: 0 16px 40px -30px rgba(15, 23, 42, 0.35);
        overflow: hidden;
    }

    .page-shell {
        height: var(--page-height);
        display: flex;
        flex-direction: column;
    }

    body.measurement-mode .print-document {
        gap: 0;
    }

    body.measurement-mode .print-page {
        height: auto;
        min-height: auto;
        margin: 0 0 12px 0;
        box-shadow: none;
        break-after: auto;
        page-break-after: auto;
    }

    body.measurement-mode .page-shell {
        height: auto;
        min-height: 0;
    }

    .page-top {
        flex: 0 0 auto;
    }

    .page-top--full {
        margin-bottom: 8px;
    }

    .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 9px;
        border-bottom: 1.4px solid var(--page-border-strong);
    }

    .page-header__main {
        flex: 1 1 auto;
        min-width: 0;
    }

    .page-kicker {
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--page-muted);
    }

    .page-order-code {
        margin: 4px 0 0;
        padding: 1px 0 3px;
        font-size: 20px;
        line-height: 1.12;
        font-weight: 800;
        letter-spacing: -0.03em;
        white-space: nowrap;
        overflow: visible;
    }

    .page-header__meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        flex: 0 0 auto;
        white-space: nowrap;
        text-align: right;
    }

    .page-meta-block {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .page-meta-label {
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--page-muted);
    }

    .page-meta-value {
        font-size: 10px;
        font-weight: 700;
        color: var(--page-text);
    }

    .detail-stack {
        display: grid;
        gap: 5px;
        margin-top: 6px;
    }

    .detail-row {
        border: 1px solid var(--page-border);
        padding: 4px 7px;
        min-height: 29px;
        display: flex;
        align-items: stretch;
        gap: 8px;
    }

    .detail-row--text {
        align-items: center;
    }

    .detail-row--contact {
        align-items: center;
    }

    .detail-split {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: 6px 12px;
        align-items: stretch;
    }

    .detail-inline {
        display: flex;
        align-items: stretch;
        gap: 7px;
        min-width: 0;
        min-height: 100%;
    }

    .detail-inline--grow {
        flex: 1 1 62%;
        align-items: center;
    }

    .detail-inline--phone {
        flex: 0 1 auto;
        align-self: stretch;
    }

    .detail-divider {
        width: 1px;
        height: 14px;
        background: var(--page-border);
        flex: 0 0 1px;
    }

    .detail-label {
        font-size: 8.4px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--page-muted);
        white-space: nowrap;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        align-self: stretch;
    }

    .detail-value {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        align-self: stretch;
        font-size: 10.8px;
        font-weight: 700;
        color: var(--page-text);
        line-height: 1.22;
    }

    .detail-text {
        display: block;
        line-height: 1;
        transform: translateY(-0.06em);
    }

    .detail-text--value {
        line-height: 1.14;
        transform: translateY(-0.04em);
    }

    .detail-value--truncate {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        overflow-wrap: anywhere;
        line-height: 1.22;
    }

    .detail-value--phone {
        flex: 0 0 auto;
        white-space: nowrap;
    }

    .detail-value--wrap {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .page-top--continuation {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding-bottom: 6px;
        margin-bottom: 8px;
        border-bottom: 1px solid #cbd5e1;
    }

    .continue-code {
        min-width: 0;
        font-size: 13px;
        line-height: 1.12;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .continue-meta {
        flex: 0 0 auto;
        font-size: 8.4px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--page-muted);
        white-space: nowrap;
    }

    .table-wrap {
        flex: 0 0 auto;
    }

    .items-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }

    .items-table thead {
        display: table-header-group;
    }

    .items-table tbody tr {
        break-inside: avoid;
        page-break-inside: avoid;
    }

    .items-table th,
    .items-table td {
        border: 1px solid var(--page-border);
        vertical-align: middle;
    }

    .items-table th {
        padding: 0;
        background: var(--page-header-bg);
        font-size: 8px;
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #475569;
    }

    .items-table td {
        padding: 0;
        font-size: 10.5px;
        line-height: 1.18;
        vertical-align: middle;
    }

    .items-table tbody tr:nth-child(even) td {
        background: var(--page-row-bg);
    }

    .col-index {
        width: 6.5%;
        text-align: center;
    }

    .col-name {
        width: 50.5%;
    }

    .col-qty {
        width: 11.5%;
        text-align: center;
    }

    .col-money {
        width: 15.75%;
        text-align: right;
        white-space: nowrap;
    }

    .head-cell {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 25px;
        padding: 5px 6px;
        width: 100%;
    }

    .head-text {
        display: block;
        line-height: 1;
        transform: translateY(-0.05em);
    }

    .cell-center {
        display: flex;
        width: 100%;
        min-height: 28px;
        padding: 5px 6px;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        font-weight: 700;
    }

    .cell-money {
        display: flex;
        width: 100%;
        min-height: 28px;
        padding: 5px 6px;
        box-sizing: border-box;
        align-items: center;
        justify-content: flex-end;
        font-weight: 700;
    }

    .cell-text {
        display: block;
        line-height: 1;
        transform: translateY(-0.06em);
    }

    .cell-money--total {
        font-weight: 800;
    }

    .product-cell {
        display: flex;
        width: 100%;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        min-height: 28px;
        padding: 5px 6px;
        box-sizing: border-box;
    }

    .product-name {
        font-weight: 700;
        overflow-wrap: anywhere;
    }

    .product-text {
        display: block;
        line-height: 1.16;
        transform: translateY(-0.04em);
    }

    .product-sku {
        font-size: 8.1px;
        line-height: 1.15;
        color: var(--page-muted);
        overflow-wrap: anywhere;
    }

    .product-sku-text {
        display: block;
        line-height: 1.05;
        transform: translateY(-0.03em);
    }

    .empty-state {
        padding: 14px 10px;
        text-align: center;
        font-style: italic;
        color: var(--page-muted);
    }

    .summary-row {
        margin-top: auto;
        padding-top: 10px;
        display: flex;
        justify-content: flex-end;
    }

    body.measurement-mode .summary-row {
        margin-top: 10px;
        padding-top: 0;
    }

    .summary-box {
        max-width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1.8px solid var(--page-border-strong);
        padding: 8px 12px;
        min-height: 36px;
        white-space: nowrap;
    }

    .summary-label {
        display: flex;
        align-items: center;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--page-text);
    }

    .summary-value {
        display: flex;
        align-items: center;
        font-size: 19px;
        line-height: 1;
        font-weight: 800;
        color: var(--page-text);
    }

    .summary-text {
        display: block;
        line-height: 1;
        transform: translateY(-0.05em);
    }

    .summary-text--value {
        transform: translateY(-0.04em);
    }

    @page {
        size: A4 portrait;
        margin: ${PAGE_MARGIN_TOP_MM}mm ${PAGE_MARGIN_RIGHT_MM}mm ${PAGE_MARGIN_BOTTOM_MM}mm ${PAGE_MARGIN_LEFT_MM}mm;
    }

    @media print {
        html,
        body {
            padding: 0;
            background: #ffffff;
        }

        .print-document {
            display: block;
        }

        .print-page {
            margin: 0 auto;
            box-shadow: none;
            break-after: page;
            page-break-after: always;
        }

        .print-page--last {
            break-after: auto;
            page-break-after: auto;
        }
    }

    @media screen and (max-width: 860px) {
        body {
            padding: 8px;
        }

        .print-page {
            width: 100%;
            height: auto;
            min-height: auto;
        }

        .page-shell {
            height: auto;
            min-height: 0;
        }

        .page-header {
            flex-wrap: wrap;
        }

        .page-header__meta {
            align-items: flex-start;
            text-align: left;
        }

        .detail-split {
            grid-template-columns: 1fr;
        }

        .detail-inline--phone {
            justify-content: flex-start;
        }

        .detail-divider {
            display: none;
        }

        .page-order-code,
        .continue-code {
            white-space: normal;
        }

        .items-table {
            table-layout: auto;
        }

        .col-index,
        .col-name,
        .col-qty,
        .col-money {
            width: auto;
        }

        .summary-box {
            width: 100%;
            justify-content: space-between;
        }
    }
`;

const buildHtmlDocument = (pages = [], { measurement = false } = {}) => `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>In don hang</title>
    <style>${getOrderPrintStyles()}</style>
</head>
<body class="${measurement ? 'measurement-mode' : ''}">
    <main class="print-document">
        ${pages.join('')}
    </main>
</body>
</html>`;

const measureOrderLayout = async (order, printedAt) => {
    removeIframe(MEASURE_FRAME_ID);
    const iframe = createHiddenIframe(MEASURE_FRAME_ID);

    try {
        const items = getOrderItems(order);
        const measurementHtml = buildHtmlDocument([
            renderOrderPage({
                order,
                printedAt,
                items,
                startIndex: 0,
                isFirstPage: true,
                isLastPage: true,
                pageNumber: 1,
                pageCount: 1,
                isDocumentLast: false,
                measurementPageType: 'first',
            }),
            renderOrderPage({
                order,
                printedAt,
                items: [],
                startIndex: 0,
                isFirstPage: false,
                isLastPage: true,
                pageNumber: 2,
                pageCount: 2,
                isDocumentLast: true,
                measurementPageType: 'continuation',
            }),
        ], { measurement: true });

        const { iframeDoc } = await loadHtmlIntoIframe(iframe, measurementHtml);

        const firstPage = iframeDoc.querySelector('[data-measure-page="first"]');
        const continuationPage = iframeDoc.querySelector('[data-measure-page="continuation"]');

        if (!firstPage || !continuationPage) {
            throw new Error('Khong the do kich thuoc trang in.');
        }

        const firstTop = firstPage.querySelector('[data-measure-top="first"]');
        const continuationTop = continuationPage.querySelector('[data-measure-top="continuation"]');
        const tableHead = firstPage.querySelector('[data-measure-table-head="true"]');
        const summary = firstPage.querySelector('[data-measure-summary="true"]');

        if (!firstTop || !continuationTop || !tableHead || !summary) {
            throw new Error('Khong the do kich thuoc bo cuc don hang.');
        }

        const rowHeights = Array.from(firstPage.querySelectorAll('[data-measure-row="true"]'))
            .map((row) => Math.ceil(row.getBoundingClientRect().height));

        return {
            fullHeaderHeight: Math.ceil(firstTop.getBoundingClientRect().height),
            continuationHeaderHeight: Math.ceil(continuationTop.getBoundingClientRect().height),
            tableHeadHeight: Math.ceil(tableHead.getBoundingClientRect().height),
            summaryHeight: Math.ceil(summary.getBoundingClientRect().height),
            rowHeights,
        };
    } finally {
        iframe.remove();
    }
};

const sumRange = (prefix, start, end) => prefix[end + 1] - prefix[start];

const paginateOrder = (order, metrics, printedAt) => {
    const items = getOrderItems(order);
    if (!items.length) {
        return [{
            order,
            printedAt,
            items: [],
            startIndex: 0,
            isFirstPage: true,
            isLastPage: true,
            pageNumber: 1,
            pageCount: 1,
        }];
    }

    const rowHeights = metrics.rowHeights.length
        ? metrics.rowHeights
        : items.map(() => 32);

    const safeSinglePageCapacity = Math.max(
        1,
        CONTENT_HEIGHT_PX - metrics.fullHeaderHeight - metrics.tableHeadHeight - metrics.summaryHeight - PAGE_FIT_BUFFER_PX
    );
    const safeFirstPageCapacity = Math.max(
        1,
        CONTENT_HEIGHT_PX - metrics.fullHeaderHeight - metrics.tableHeadHeight - PAGE_FIT_BUFFER_PX
    );
    const safeContinuationCapacity = Math.max(
        1,
        CONTENT_HEIGHT_PX - metrics.continuationHeaderHeight - metrics.tableHeadHeight - PAGE_FIT_BUFFER_PX
    );
    const safeLastContinuationCapacity = Math.max(
        1,
        CONTENT_HEIGHT_PX - metrics.continuationHeaderHeight - metrics.tableHeadHeight - metrics.summaryHeight - PAGE_FIT_BUFFER_PX
    );

    const prefix = [0];
    rowHeights.forEach((height) => {
        prefix.push(prefix[prefix.length - 1] + height);
    });

    const memo = new Map();
    const lastIndex = rowHeights.length - 1;

    const solve = (startIndex, isFirstPage) => {
        const memoKey = `${startIndex}-${isFirstPage ? 1 : 0}`;
        if (memo.has(memoKey)) {
            return memo.get(memoKey);
        }

        if (startIndex > lastIndex) {
            const emptyResult = [];
            memo.set(memoKey, emptyResult);
            return emptyResult;
        }

        const lastPageCapacity = isFirstPage
            ? safeSinglePageCapacity
            : safeLastContinuationCapacity;

        if (sumRange(prefix, startIndex, lastIndex) <= lastPageCapacity) {
            const singleResult = [{ start: startIndex, end: lastIndex }];
            memo.set(memoKey, singleResult);
            return singleResult;
        }

        const currentPageCapacity = isFirstPage
            ? safeFirstPageCapacity
            : safeContinuationCapacity;

        let usedHeight = 0;
        let bestResult = null;

        for (let endIndex = startIndex; endIndex < lastIndex; endIndex += 1) {
            usedHeight += rowHeights[endIndex];

            if (usedHeight > currentPageCapacity && endIndex > startIndex) {
                break;
            }

            if (usedHeight > currentPageCapacity && endIndex === startIndex) {
                const forcedTail = solve(endIndex + 1, false);
                const forcedResult = [{ start: startIndex, end: endIndex }, ...forcedTail];
                memo.set(memoKey, forcedResult);
                return forcedResult;
            }

            const tail = solve(endIndex + 1, false);
            if (tail) {
                bestResult = [{ start: startIndex, end: endIndex }, ...tail];
            }
        }

        const fallbackResult = bestResult || [{ start: startIndex, end: lastIndex }];
        memo.set(memoKey, fallbackResult);
        return fallbackResult;
    };

    const ranges = solve(0, true);

    return ranges.map((range, index) => ({
        order,
        printedAt,
        items: items.slice(range.start, range.end + 1),
        startIndex: range.start,
        isFirstPage: index === 0,
        isLastPage: index === ranges.length - 1,
        pageNumber: index + 1,
        pageCount: ranges.length,
    }));
};

const buildPaginatedPages = async (orders = []) => {
    const printedAt = formatDateTime(new Date().toISOString());
    const allPages = [];

    for (const order of orders) {
        const metrics = await measureOrderLayout(order, printedAt);
        const orderPages = paginateOrder(order, metrics, printedAt);
        allPages.push(...orderPages);
    }

    return allPages;
};

export const buildOrderPrintDocument = async (orders = []) => {
    const pages = await buildPaginatedPages(orders);
    const htmlPages = pages.map((page, index) =>
        renderOrderPage({
            ...page,
            isDocumentLast: index === pages.length - 1,
        })
    );

    return buildHtmlDocument(htmlPages);
};

const printWithIframe = async (html) => {
    removeIframe(PRINT_FRAME_ID);
    const iframe = createHiddenIframe(PRINT_FRAME_ID);

    try {
        const { iframeWin } = await loadHtmlIntoIframe(iframe, html);

        const printResult = await new Promise((resolve) => {
            let settled = false;
            let timeoutId = null;

            const finish = (reason) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                try {
                    iframeWin.removeEventListener('afterprint', handleAfterPrint);
                } catch (_) {
                    // Ignore cleanup errors.
                }
                resolve({ reason });
            };

            const handleAfterPrint = () => finish('afterprint');

            iframeWin.addEventListener('afterprint', handleAfterPrint);
            timeoutId = setTimeout(() => finish('timeout'), PRINT_DIALOG_TIMEOUT_MS);

            setTimeout(() => {
                try {
                    iframeWin.focus();
                    iframeWin.print();
                } catch (_) {
                    finish('print-error');
                }
            }, 0);
        });

        return {
            reason: printResult.reason,
            close: () => removeIframe(PRINT_FRAME_ID),
        };
    } catch (error) {
        iframe.remove();
        throw error;
    }
};

export const printOrders = async (orders = [], options = {}) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error('Khong co du lieu don hang de in.');
    }

    const ownerWindow = options.ownerWindow || window;
    if (ownerWindow !== window) {
        // The current implementation always prints from the active browser window.
    }

    const html = await buildOrderPrintDocument(orders);
    return printWithIframe(html);
};

export const closePrintSession = (session) => {
    if (!session) return;
    if (typeof session.close === 'function') {
        session.close();
    }
};

export const printCurrentPage = async (sourceWindow = window) => {
    const ownerDoc = sourceWindow.document || document;
    const title = ownerDoc?.title || 'In don hang';

    return printWithIframe(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${
            ownerDoc.body?.innerHTML || ''
        }</body></html>`
    );
};

export const preparePrintPopupWindow = () => null;

export const exportOrderPdf = async (orders = [], filename) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error('Khong co du lieu don hang de xuat PDF.');
    }

    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
    ]);

    const html = await buildOrderPrintDocument(orders);

    removeIframe(PDF_FRAME_ID);
    const iframe = createHiddenIframe(PDF_FRAME_ID);

    try {
        const { iframeDoc } = await loadHtmlIntoIframe(iframe, html);
        const pages = Array.from(iframeDoc.querySelectorAll('.print-page'));

        if (!pages.length) {
            throw new Error('Khong tim thay noi dung don hang de xuat PDF.');
        }

        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

        for (let index = 0; index < pages.length; index += 1) {
            const page = pages[index];
            const renderWidthPx = Math.max(
                Math.ceil(page.offsetWidth || 0),
                Math.ceil(page.clientWidth || 0),
                Math.ceil(page.scrollWidth || 0),
                CONTENT_WIDTH_PX
            );
            const renderHeightPx = Math.max(
                Math.ceil(page.offsetHeight || 0),
                Math.ceil(page.clientHeight || 0),
                Math.ceil(page.scrollHeight || 0),
                CONTENT_HEIGHT_PX
            );
            const canvas = await html2canvas(page, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                width: renderWidthPx,
                height: renderHeightPx,
                windowWidth: renderWidthPx,
                windowHeight: renderHeightPx,
                scrollX: 0,
                scrollY: 0,
                logging: false,
                foreignObjectRendering: false,
            });

            if (index > 0) {
                pdf.addPage();
            }

            const renderHeightMm = Math.min(
                CONTENT_HEIGHT_MM,
                (canvas.height * CONTENT_WIDTH_MM) / canvas.width
            );

            pdf.addImage(
                canvas.toDataURL('image/png'),
                'PNG',
                PAGE_MARGIN_LEFT_MM,
                PAGE_MARGIN_TOP_MM,
                CONTENT_WIDTH_MM,
                renderHeightMm,
                undefined,
                'FAST'
            );
        }

        const defaultName = orders.length === 1
            ? `don-hang-${orders[0].order_number || 'unknown'}.pdf`
            : `don-hang-${orders.length}-orders.pdf`;

        pdf.save(filename || defaultName);
    } finally {
        iframe.remove();
    }
};
