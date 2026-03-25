const PRINT_DIALOG_FALLBACK_MS = 3 * 60 * 1000;

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
}).format(Number(value || 0));

const formatDateTime = (value) => {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    })}`;
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderOrderRows = (items = []) => {
    if (!items.length) {
        return `
            <tr>
                <td colspan="5" class="empty-state">Đơn hàng không có sản phẩm.</td>
            </tr>
        `;
    }

    return items.map((item, index) => `
        <tr>
            <td class="col-index">${index + 1}</td>
            <td class="col-name">
                <div class="product-name">${escapeHtml(item.name || '-')}</div>
                ${item.sku ? `<div class="product-sku">SKU: ${escapeHtml(item.sku)}</div>` : ''}
            </td>
            <td class="col-qty">${escapeHtml(item.quantity ?? 0)}</td>
            <td class="col-money">${escapeHtml(formatCurrency(item.unit_price))}</td>
            <td class="col-money">${escapeHtml(formatCurrency(item.line_total))}</td>
        </tr>
    `).join('');
};

export const buildOrderPrintDocument = (orders = []) => {
    const printedAt = formatDateTime(new Date().toISOString());

    const sections = orders.map((order, orderIndex) => `
        <section class="order-sheet ${orderIndex === orders.length - 1 ? 'order-sheet-last' : ''}">
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
        </section>
    `).join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>In đơn hàng</title>
    <style>
        @page {
            size: A4 landscape;
            margin: 10mm;
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            background: #ffffff;
            font-size: 12px;
        }

        body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .order-sheet {
            padding: 2mm 0;
            page-break-after: always;
            break-after: page;
        }

        .order-sheet-last {
            page-break-after: auto;
            break-after: auto;
        }

        .sheet-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 10px;
            border-bottom: 2px solid #111827;
            padding-bottom: 8px;
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
            line-height: 1.4;
        }

        .sheet-meta span {
            font-weight: 700;
            color: #6b7280;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin-bottom: 10px;
        }

        .info-card {
            border: 1px solid #d1d5db;
            padding: 8px 10px;
            min-height: 60px;
        }

        .info-card-wide {
            grid-column: span 2;
        }

        .info-card-full {
            grid-column: 1 / -1;
            min-height: 76px;
        }

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
        }

        .info-value-wrap {
            white-space: pre-wrap;
            word-break: break-word;
        }

        .items-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }

        .items-table thead {
            display: table-header-group;
        }

        .items-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
        }

        .items-table th,
        .items-table td {
            border: 1px solid #d1d5db;
            padding: 7px 8px;
            vertical-align: top;
        }

        .items-table th {
            background: #f3f4f6;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: #374151;
        }

        .col-index {
            width: 44px;
            text-align: center;
        }

        .col-name {
            width: auto;
        }

        .col-qty {
            width: 78px;
            text-align: center;
        }

        .col-money {
            width: 130px;
            text-align: right;
            white-space: nowrap;
        }

        .product-name {
            font-weight: 700;
            line-height: 1.45;
            word-break: break-word;
        }

        .product-sku {
            margin-top: 3px;
            font-size: 10px;
            color: #6b7280;
        }

        .empty-state {
            padding: 16px 12px;
            text-align: center;
            color: #6b7280;
            font-style: italic;
        }

        .summary-row {
            display: flex;
            justify-content: flex-end;
            margin-top: 10px;
        }

        .summary-box {
            min-width: 280px;
            border: 2px solid #111827;
            padding: 10px 12px;
        }

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
    </style>
</head>
<body>
    ${sections}
</body>
</html>`;
};

export const printOrders = (orders = []) => new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        reject(new Error('Môi trường hiện tại không hỗ trợ in.'));
        return;
    }

    if (!Array.isArray(orders) || orders.length === 0) {
        reject(new Error('Không có dữ liệu đơn hàng để in.'));
        return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.right = '0';
    iframe.style.bottom = '0';

    let settled = false;

    const cleanup = () => {
        window.setTimeout(() => {
            iframe.remove();
        }, 0);
    };

    const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ completed: true });
    };

    const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error('Không thể mở hộp thoại in.'));
    };

    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDocument = frameWindow?.document;

    if (!frameWindow || !frameDocument) {
        fail(new Error('Không thể khởi tạo tài liệu in.'));
        return;
    }

    try {
        frameDocument.open();
        frameDocument.write(buildOrderPrintDocument(orders));
        frameDocument.close();
    } catch (error) {
        fail(error);
        return;
    }

    window.setTimeout(() => {
        if (settled) return;

        const timeoutId = window.setTimeout(() => {
            finish();
        }, PRINT_DIALOG_FALLBACK_MS);

        frameWindow.onafterprint = () => {
            window.clearTimeout(timeoutId);
            finish();
        };

        try {
            frameWindow.focus();
            frameWindow.print();
        } catch (error) {
            window.clearTimeout(timeoutId);
            fail(error);
        }
    }, 150);
});
