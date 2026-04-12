const PRINT_DIALOG_FALLBACK_MS = 3 * 60 * 1000;
const PRINT_DIALOG_CLOSE_SETTLE_MS = 400;
const PRINT_DIALOG_BLOCKING_THRESHOLD_MS = 350;
const PRINT_DOCUMENT_READY_DELAY_MS = 120;
const PRINT_RESOURCE_TIMEOUT_MS = 10000;

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

const getTimerWindow = (candidateWindow) => {
    if (candidateWindow && !candidateWindow.closed && typeof candidateWindow.setTimeout === 'function') {
        return candidateWindow;
    }

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        return window;
    }

    return globalThis;
};

const delay = (candidateWindow, timeoutMs) => new Promise((resolve) => {
    getTimerWindow(candidateWindow).setTimeout(resolve, timeoutMs);
});

const withTimeout = (promise, candidateWindow, timeoutMs) => Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    delay(candidateWindow, timeoutMs),
]);

const writeHtmlDocument = (targetWindow, html) => {
    if (!targetWindow || targetWindow.closed || !targetWindow.document) {
        throw new Error('Không thể khởi tạo tài liệu in.');
    }

    targetWindow.document.open();
    targetWindow.document.write(html);
    targetWindow.document.close();
};

const buildLoadingPrintDocument = (title = 'Chuẩn bị bản in') => `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
        :root {
            color-scheme: light;
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            min-height: 100%;
            font-family: Roboto, "Segoe UI", Arial, sans-serif;
            background: #f8fafc;
            color: #0f172a;
        }

        body {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
        }

        .print-loader {
            width: min(420px, 100%);
            border: 1px solid #dbe2ea;
            background: #ffffff;
            box-shadow: 0 24px 60px -36px rgba(15, 23, 42, 0.35);
            padding: 28px 30px;
        }

        .print-loader__kicker {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: #64748b;
            margin-bottom: 8px;
        }

        .print-loader__title {
            margin: 0;
            font-size: 24px;
            line-height: 1.2;
            font-weight: 800;
        }

        .print-loader__text {
            margin: 12px 0 0;
            font-size: 14px;
            line-height: 1.7;
            color: #475569;
        }
    </style>
</head>
<body>
    <section class="print-loader">
        <div class="print-loader__kicker">Hệ thống đang chuẩn bị</div>
        <h1 class="print-loader__title">${escapeHtml(title)}</h1>
        <p class="print-loader__text">Vui lòng chờ trong giây lát, nội dung in sẽ tự động hiển thị ngay sau khi dữ liệu và bố cục sẵn sàng.</p>
    </section>
</body>
</html>`;

const closePrintWindow = (targetWindow) => {
    if (!targetWindow || targetWindow.closed || typeof targetWindow.close !== 'function') {
        return;
    }

    targetWindow.close();
};

const waitForWindowLoad = async (targetWindow) => {
    const targetDocument = targetWindow?.document;

    if (!targetWindow || !targetDocument || targetDocument.readyState === 'complete') {
        return;
    }

    await new Promise((resolve) => {
        let settled = false;
        let timeoutId = null;

        const finish = () => {
            if (settled) return;
            settled = true;

            if (timeoutId !== null) {
                getTimerWindow(targetWindow).clearTimeout(timeoutId);
            }

            targetWindow.removeEventListener('load', handleLoad);
            targetDocument.removeEventListener('readystatechange', handleReadyStateChange);
            resolve();
        };

        const handleLoad = () => {
            finish();
        };

        const handleReadyStateChange = () => {
            if (targetDocument.readyState === 'complete') {
                finish();
            }
        };

        timeoutId = getTimerWindow(targetWindow).setTimeout(finish, PRINT_RESOURCE_TIMEOUT_MS);
        targetWindow.addEventListener('load', handleLoad, { once: true });
        targetDocument.addEventListener('readystatechange', handleReadyStateChange);
    });
};

const waitForImageReady = (image, targetWindow) => new Promise((resolve) => {
    if (!image) {
        resolve();
        return;
    }

    if (typeof image.decode === 'function') {
        const decodePromise = image.decode();
        withTimeout(decodePromise, targetWindow, PRINT_RESOURCE_TIMEOUT_MS).then(() => resolve());
        return;
    }

    if (image.complete) {
        resolve();
        return;
    }

    let settled = false;
    let timeoutId = null;

    const finish = () => {
        if (settled) return;
        settled = true;

        if (timeoutId !== null) {
            getTimerWindow(targetWindow).clearTimeout(timeoutId);
        }

        image.removeEventListener('load', handleLoad);
        image.removeEventListener('error', handleError);
        resolve();
    };

    const handleLoad = () => {
        finish();
    };

    const handleError = () => {
        finish();
    };

    timeoutId = getTimerWindow(targetWindow).setTimeout(finish, PRINT_RESOURCE_TIMEOUT_MS);
    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
});

const waitForImagesReady = async (targetWindow) => {
    const images = Array.from(targetWindow?.document?.images || []);

    if (!images.length) {
        return;
    }

    await Promise.all(images.map((image) => waitForImageReady(image, targetWindow)));
};

const waitForFontsReady = async (targetWindow) => {
    const fontSet = targetWindow?.document?.fonts;

    if (!fontSet?.ready) {
        return;
    }

    await withTimeout(fontSet.ready, targetWindow, PRINT_RESOURCE_TIMEOUT_MS);
};

const waitForNextPaint = async (targetWindow) => {
    const raf = targetWindow?.requestAnimationFrame?.bind(targetWindow);

    if (typeof raf !== 'function') {
        await delay(targetWindow, 32);
        return;
    }

    await new Promise((resolve) => {
        raf(() => {
            raf(resolve);
        });
    });
};

const waitForPrintableDocument = async (targetWindow) => {
    await waitForWindowLoad(targetWindow);
    await Promise.all([
        waitForFontsReady(targetWindow),
        waitForImagesReady(targetWindow),
    ]);
    await waitForNextPaint(targetWindow);
    await delay(targetWindow, PRINT_DOCUMENT_READY_DELAY_MS);
};

const copyLiveFormValuesIntoClone = (sourceDocument, clonedRoot) => {
    const sourceFields = Array.from(sourceDocument.querySelectorAll('input, textarea, select'));
    const clonedFields = Array.from(clonedRoot.querySelectorAll('input, textarea, select'));

    sourceFields.forEach((field, index) => {
        const clonedField = clonedFields[index];

        if (!clonedField) return;

        const tagName = field.tagName.toLowerCase();

        if (tagName === 'textarea') {
            clonedField.textContent = field.value;
            return;
        }

        if (tagName === 'select') {
            Array.from(clonedField.options || []).forEach((option, optionIndex) => {
                option.selected = optionIndex === field.selectedIndex;
            });
            return;
        }

        clonedField.setAttribute('value', field.value ?? '');

        if (field.type === 'checkbox' || field.type === 'radio') {
            if (field.checked) {
                clonedField.setAttribute('checked', 'checked');
            } else {
                clonedField.removeAttribute('checked');
            }
        }
    });
};

const buildCurrentPagePrintDocument = (sourceWindow = window) => {
    const sourceDocument = sourceWindow?.document;

    if (!sourceDocument?.documentElement) {
        throw new Error('Môi trường hiện tại không hỗ trợ in.');
    }

    const clonedRoot = sourceDocument.documentElement.cloneNode(true);

    clonedRoot.querySelectorAll('script, noscript').forEach((node) => node.remove());
    copyLiveFormValuesIntoClone(sourceDocument, clonedRoot);

    const head = clonedRoot.querySelector('head');

    if (head && !head.querySelector('base')) {
        head.insertAdjacentHTML('afterbegin', `<base href="${escapeHtml(sourceWindow.location.href)}" />`);
    }

    return `<!DOCTYPE html>\n${clonedRoot.outerHTML}`;
};

export const preparePrintPopupWindow = (ownerWindow = window, options = {}) => {
    if (typeof ownerWindow?.open !== 'function') {
        return null;
    }

    const title = options.title || 'Chuẩn bị bản in';
    const windowName = `order-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const popup = ownerWindow.open('', windowName, 'popup=yes,width=1280,height=900,left=120,top=80,scrollbars=yes,resizable=yes');

    if (!popup) {
        return null;
    }

    writeHtmlDocument(popup, buildLoadingPrintDocument(title));

    return popup;
};

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
        </section>
    `).join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>In đơn hàng</title>
    <style>
        :root {
            color-scheme: light;
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            padding: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #111827;
            background: #ffffff;
            font-size: 12px;
            line-height: 1.5;
        }

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
            overflow-wrap: anywhere;
        }

        .info-value-wrap {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
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
            background: #f8fafc;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: #374151;
        }

        .col-index {
            width: 7%;
            text-align: center;
        }

        .col-name {
            width: 49%;
        }

        .col-qty {
            width: 12%;
            text-align: center;
        }

        .col-money {
            width: 16%;
            text-align: right;
            white-space: nowrap;
        }

        .product-name {
            font-weight: 700;
            line-height: 1.45;
            overflow-wrap: anywhere;
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
            margin-top: 12px;
        }

        .summary-box {
            width: min(100%, 320px);
            border: 2px solid #111827;
            padding: 10px 12px;
            margin-left: auto;
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

        @media screen {
            html,
            body {
                background: #eef2f7;
            }

            body {
                padding: 16px;
            }

            .order-sheet {
                max-width: 1180px;
                margin: 0 auto 16px;
                border: 1px solid #d1d5db;
                background: #ffffff;
                box-shadow: 0 24px 60px -40px rgba(15, 23, 42, 0.35);
            }

            .order-sheet__inner {
                padding: 16px 18px 18px;
            }
        }

        @media print {
            html,
            body {
                background: #ffffff;
            }

            body {
                padding: 0;
            }

            .order-sheet {
                margin: 0;
                border: none;
                box-shadow: none;
                background: transparent;
            }
        }

        @media (max-width: 900px) {
            .sheet-meta {
                min-width: 0;
                width: 100%;
                text-align: left;
            }

            .info-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .info-card-wide,
            .info-card-full {
                grid-column: span 2;
            }
        }

        @media (max-width: 640px) {
            .info-grid {
                grid-template-columns: 1fr;
            }

            .info-card-wide,
            .info-card-full {
                grid-column: auto;
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
            }
        }
    </style>
</head>
<body>
    ${sections}
</body>
</html>`;
};

const waitForPrintDialogToClose = ({
    ownerWindow = window,
    printWindow = ownerWindow,
    triggerPrint,
    cleanup = () => {},
    cleanupDelayMs = 0,
}) => new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let focusTimerId = null;
    let didTriggerPrint = false;
    let didLoseFocus = false;
    let mediaQueryList = null;
    let cleanupScheduled = false;

    const scheduleCleanup = () => {
        if (cleanupScheduled) return;
        cleanupScheduled = true;

        getTimerWindow(ownerWindow).setTimeout(() => {
            cleanup();
        }, cleanupDelayMs);
    };

    const teardown = () => {
        getTimerWindow(ownerWindow).clearTimeout(timeoutId);
        getTimerWindow(ownerWindow).clearTimeout(focusTimerId);
        ownerWindow.removeEventListener('afterprint', handleAfterPrint);
        ownerWindow.removeEventListener('focus', handleFocus);
        ownerWindow.removeEventListener('blur', handleBlur);
        ownerWindow.document?.removeEventListener('visibilitychange', handleVisibilityChange);

        if (printWindow !== ownerWindow && typeof printWindow?.removeEventListener === 'function') {
            printWindow.removeEventListener('afterprint', handleAfterPrint);
        }

        if (mediaQueryList) {
            if (typeof mediaQueryList.removeEventListener === 'function') {
                mediaQueryList.removeEventListener('change', handleMediaQueryChange);
            } else if (typeof mediaQueryList.removeListener === 'function') {
                mediaQueryList.removeListener(handleMediaQueryChange);
            }
        }
    };

    const finish = (reason = 'closed') => {
        if (settled) return;
        settled = true;
        teardown();
        scheduleCleanup();
        resolve({
            dialogClosed: true,
            reason,
        });
    };

    const fail = (error) => {
        if (settled) return;
        settled = true;
        teardown();
        scheduleCleanup();
        reject(error instanceof Error ? error : new Error('Không thể mở hộp thoại in.'));
    };

    const handleAfterPrint = () => {
        finish('afterprint');
    };

    const handleBlur = () => {
        if (!didTriggerPrint) return;
        didLoseFocus = true;
    };

    const handleFocus = () => {
        if (!didTriggerPrint) return;

        getTimerWindow(ownerWindow).clearTimeout(focusTimerId);
        focusTimerId = getTimerWindow(ownerWindow).setTimeout(() => {
            if (didLoseFocus) {
                finish('focus');
            }
        }, PRINT_DIALOG_CLOSE_SETTLE_MS);
    };

    const handleVisibilityChange = () => {
        if (!didTriggerPrint) return;

        if (ownerWindow.document?.visibilityState === 'hidden') {
            didLoseFocus = true;
            return;
        }

        if (didLoseFocus) {
            getTimerWindow(ownerWindow).clearTimeout(focusTimerId);
            focusTimerId = getTimerWindow(ownerWindow).setTimeout(() => {
                finish('visibilitychange');
            }, PRINT_DIALOG_CLOSE_SETTLE_MS);
        }
    };

    const handleMediaQueryChange = (event) => {
        if (!didTriggerPrint) return;

        if (event.matches) {
            didLoseFocus = true;
            return;
        }

        finish('mediaquery');
    };

    ownerWindow.addEventListener('afterprint', handleAfterPrint);
    ownerWindow.addEventListener('focus', handleFocus);
    ownerWindow.addEventListener('blur', handleBlur);
    ownerWindow.document?.addEventListener('visibilitychange', handleVisibilityChange);

    if (printWindow !== ownerWindow && typeof printWindow?.addEventListener === 'function') {
        printWindow.addEventListener('afterprint', handleAfterPrint);
    }

    if (typeof ownerWindow.matchMedia === 'function') {
        mediaQueryList = ownerWindow.matchMedia('print');

        if (typeof mediaQueryList.addEventListener === 'function') {
            mediaQueryList.addEventListener('change', handleMediaQueryChange);
        } else if (typeof mediaQueryList.addListener === 'function') {
            mediaQueryList.addListener(handleMediaQueryChange);
        }
    }

    timeoutId = getTimerWindow(ownerWindow).setTimeout(() => {
        finish('timeout');
    }, PRINT_DIALOG_FALLBACK_MS);

    try {
        didTriggerPrint = true;
        const triggerStartedAt = Date.now();
        triggerPrint();
        const triggerDurationMs = Date.now() - triggerStartedAt;

        if (triggerDurationMs >= PRINT_DIALOG_BLOCKING_THRESHOLD_MS) {
            getTimerWindow(ownerWindow).clearTimeout(focusTimerId);
            focusTimerId = getTimerWindow(ownerWindow).setTimeout(() => {
                finish('blocking-return');
            }, PRINT_DIALOG_CLOSE_SETTLE_MS);
        }
    } catch (error) {
        fail(error);
    }
});

const printHtmlDocument = async ({
    sourceWindow = window,
    printWindow,
    html,
    title = 'In đơn hàng',
}) => {
    if (!sourceWindow?.document) {
        throw new Error('Môi trường hiện tại không hỗ trợ in.');
    }

    const targetWindow = printWindow || preparePrintPopupWindow(sourceWindow, { title });

    if (!targetWindow || targetWindow.closed) {
        throw new Error('Không thể mở cửa sổ in. Vui lòng kiểm tra chặn popup và thử lại.');
    }

    writeHtmlDocument(targetWindow, html);
    await waitForPrintableDocument(targetWindow);

    const printResult = await waitForPrintDialogToClose({
        ownerWindow: targetWindow,
        printWindow: targetWindow,
        triggerPrint: () => {
            targetWindow.focus?.();
            targetWindow.print();
        },
    });

    return {
        ...printResult,
        close: () => closePrintWindow(targetWindow),
        targetWindow,
    };
};

export const closePrintSession = (session) => {
    if (!session) return;

    if (typeof session.close === 'function') {
        session.close();
        return;
    }

    closePrintWindow(session?.targetWindow);
};

export const printCurrentPage = async (sourceWindow = window, options = {}) => {
    if (typeof sourceWindow === 'undefined' || typeof sourceWindow?.document === 'undefined') {
        throw new Error('Môi trường hiện tại không hỗ trợ in.');
    }

    const title = sourceWindow.document?.title || 'In đơn hàng';
    const html = buildCurrentPagePrintDocument(sourceWindow);

    return printHtmlDocument({
        sourceWindow,
        printWindow: options.printWindow,
        html,
        title,
    });
};

export const printOrders = async (orders = [], options = {}) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('Môi trường hiện tại không hỗ trợ in.');
    }

    if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error('Không có dữ liệu đơn hàng để in.');
    }

    const primaryOrder = orders[0] || {};
    const title = orders.length > 1
        ? `In ${orders.length} đơn hàng`
        : `In đơn #${primaryOrder.order_number || ''}`.trim();

    return printHtmlDocument({
        sourceWindow: options.ownerWindow || window,
        printWindow: options.printWindow,
        html: buildOrderPrintDocument(orders),
        title,
    });
};
