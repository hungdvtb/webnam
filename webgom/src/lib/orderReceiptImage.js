const IMAGE_WIDTH = 1080;
const OUTER_PADDING = 48;
const CARD_PADDING_X = 64;
const CARD_PADDING_Y = 56;
const CARD_RADIUS = 30;
const HEADER_HEIGHT = 176;
const CONTENT_WIDTH = IMAGE_WIDTH - (OUTER_PADDING * 2) - (CARD_PADDING_X * 2);
const PRODUCT_COLUMN_WIDTH = 376;
const QUANTITY_COLUMN_WIDTH = 88;
const UNIT_PRICE_COLUMN_WIDTH = 160;
const TOTAL_COLUMN_WIDTH = 184;
const PRODUCT_TABLE_GAP = 16;
const TABLE_WIDTH = PRODUCT_COLUMN_WIDTH
  + QUANTITY_COLUMN_WIDTH
  + UNIT_PRICE_COLUMN_WIDTH
  + TOTAL_COLUMN_WIDTH
  + (PRODUCT_TABLE_GAP * 3);

const currencyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const ADDRESS_LINE_HEIGHT = 32;
const SUPPORT_NOTICE_LINE_HEIGHT = 30;
const renderLegacyHeaderNote = false;
const renderLegacyContactBlock = false;

const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

export const formatReceiptCurrency = (value) => currencyFormatter.format(clampNumber(value));

export const getReceiptAddress = (formData = {}) => (
  [
    formData?.address,
    formData?.ward,
    formData?.district,
    formData?.province,
  ]
    .filter(Boolean)
    .join(', ')
);

export const getReceiptPhone = (formData = {}) => (
  String(formData?.phone || formData?.customer_phone || '').trim()
);

const getReceiptSupportMessage = (supportHotline = '') => {
  const hotline = String(supportHotline || '').trim();

  if (hotline) {
    return `Trong quá trình giao hàng nếu có vấn đề gì, anh chị vui lòng liên hệ với bộ phận CSKH bên em theo số Hotline ${hotline} ạ`;
  }

  return 'Trong quá trình giao hàng nếu có vấn đề gì, anh chị vui lòng liên hệ với bộ phận CSKH bên em để được hỗ trợ ạ.';
};

export const getReceiptOrderDate = (value) => {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return dateFormatter.format(new Date());
  }

  return dateFormatter.format(date);
};

export const getReceiptUnitPrice = (item = {}) => {
  if (Array.isArray(item?.groupedItems) && item.groupedItems.length > 0) {
    return item.groupedItems.reduce(
      (sum, groupedItem) => (
        sum + (clampNumber(groupedItem?.price) * Math.max(clampNumber(groupedItem?.qty, 1), 1))
      ),
      0
    );
  }

  return clampNumber(item?.price);
};

const getReceiptItems = (cartItems = []) => (
  cartItems.map((item, index) => {
    const quantity = Math.max(clampNumber(item?.quantity, 1), 1);
    const unitPrice = getReceiptUnitPrice(item);

    return {
      key: item?.cartKey || item?.id || `receipt-item-${index}`,
      name: String(item?.name || 'Sản phẩm trong đơn hàng').trim() || 'Sản phẩm trong đơn hàng',
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
    };
  })
);

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  const nextRadius = Math.max(Math.min(radius, width / 2, height / 2), 0);

  ctx.beginPath();
  ctx.moveTo(x + nextRadius, y);
  ctx.lineTo(x + width - nextRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  ctx.lineTo(x + width, y + height - nextRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  ctx.lineTo(x + nextRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  ctx.lineTo(x, y + nextRadius);
  ctx.quadraticCurveTo(x, y, x + nextRadius, y);
  ctx.closePath();
};

const fillRoundedRect = (ctx, x, y, width, height, radius, fillStyle) => {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
};

const strokeRoundedRect = (ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) => {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
};

const withShadow = (ctx, options, callback) => {
  ctx.save();
  ctx.shadowColor = options?.color || 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = options?.blur || 24;
  ctx.shadowOffsetX = options?.offsetX || 0;
  ctx.shadowOffsetY = options?.offsetY || 18;
  callback();
  ctx.restore();
};

const wrapText = (ctx, text, maxWidth) => {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();

  if (!normalizedText) {
    return ['-'];
  }

  const words = normalizedText.split(' ');
  const lines = [];
  let currentLine = '';

  const pushLongWordLines = (word) => {
    let currentWordLine = '';

    Array.from(word).forEach((character) => {
      const candidate = `${currentWordLine}${character}`;

      if (currentWordLine && ctx.measureText(candidate).width > maxWidth) {
        lines.push(currentWordLine);
        currentWordLine = character;
        return;
      }

      currentWordLine = candidate;
    });

    if (currentWordLine) {
      currentLine = currentWordLine;
    }
  };

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (!currentLine || ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);

    if (ctx.measureText(word).width <= maxWidth) {
      currentLine = word;
      return;
    }

    currentLine = '';
    pushLongWordLines(word);
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : ['-'];
};

const drawWrappedText = (ctx, text, x, y, maxWidth, lineHeight, options = {}) => {
  const lines = wrapText(ctx, text, maxWidth);
  const align = options?.align || 'left';
  const maxLines = Math.max(options?.maxLines || lines.length, 1);
  const renderedLines = lines.slice(0, maxLines);

  if (align === 'center') {
    ctx.textAlign = 'center';
  } else if (align === 'right') {
    ctx.textAlign = 'right';
  } else {
    ctx.textAlign = 'left';
  }

  renderedLines.forEach((line, index) => {
    ctx.fillText(line, x, y + (index * lineHeight));
  });

  return {
    lines: renderedLines,
    height: renderedLines.length * lineHeight,
  };
};

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  return canvas;
};

const canvasToBlob = (canvas) => (
  new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Canvas blob generation failed.'));
      }, 'image/png');
      return;
    }

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1] || '';
      const bytes = atob(base64);
      const array = new Uint8Array(bytes.length);

      for (let index = 0; index < bytes.length; index += 1) {
        array[index] = bytes.charCodeAt(index);
      }

      resolve(new Blob([array], { type: 'image/png' }));
    } catch (error) {
      reject(error);
    }
  })
);

const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1000);
};

const buildReceiptMetrics = (ctx, options = {}) => {
  const items = getReceiptItems(options.cartItems);
  const address = getReceiptAddress(options.formData);
  const addressLabelWidth = 170;
  const supportMessage = getReceiptSupportMessage(options.supportHotline);

  ctx.font = '600 24px Arial, sans-serif';
  const addressLines = wrapText(
    ctx,
    address || 'Khách chưa để lại địa chỉ.',
    CONTENT_WIDTH - addressLabelWidth - 24
  );

  ctx.font = '500 22px Arial, sans-serif';
  const supportMessageLines = wrapText(
    ctx,
    supportMessage,
    CONTENT_WIDTH - 48
  );

  ctx.font = '700 26px Arial, sans-serif';
  const rowMetrics = items.map((item) => {
    const nameLines = wrapText(ctx, item.name, PRODUCT_COLUMN_WIDTH - 8);

    return {
      ...item,
      nameLines,
      height: Math.max(70, 32 + (nameLines.length * 32)),
    };
  });

  const productsHeight = rowMetrics.reduce((sum, item) => sum + item.height, 0);
  const contactBoxHeight = 208
    + (Math.max(addressLines.length - 1, 0) * ADDRESS_LINE_HEIGHT)
    + (Math.max(supportMessageLines.length - 1, 0) * SUPPORT_NOTICE_LINE_HEIGHT);

  const canvasHeight = Math.max(
    1260,
    OUTER_PADDING * 2
      + HEADER_HEIGHT
      + CARD_PADDING_Y * 2
      + 120
      + 112
      + 84
      + 68
      + productsHeight
      + 44
      + contactBoxHeight
      + 56
  );

  return {
    items,
    rowMetrics,
    addressLines,
    supportMessage,
    supportMessageLines,
    contactBoxHeight,
    canvasHeight,
  };
};

const drawInfoPair = (ctx, label, value, x, y) => {
  ctx.textAlign = 'left';
  ctx.font = '600 22px Arial, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(label, x, y);

  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillStyle = '#1B365D';
  ctx.fillText(value, x, y + 36);
};

export const downloadOrderReceiptImage = async ({
  orderNumber,
  formData,
  cartItems,
  cartTotal,
  discount,
  createdAt,
  supportHotline,
}) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Order receipt image can only be generated in the browser.');
  }

  const orderDate = getReceiptOrderDate(createdAt);
  const items = getReceiptItems(cartItems);

  if (items.length === 0) {
    throw new Error('Missing order items for receipt image.');
  }

  const phone = getReceiptPhone(formData) || 'Khách chưa để lại số điện thoại.';
  const addressText = getReceiptAddress(formData) || 'Khách chưa để lại địa chỉ.';
  const total = Math.max(clampNumber(cartTotal) - clampNumber(discount), 0);
  const tempCanvas = createCanvas(IMAGE_WIDTH, 1200);
  const tempContext = tempCanvas.getContext('2d');

  if (!tempContext) {
    throw new Error('Unable to initialize receipt drawing context.');
  }

  const metrics = buildReceiptMetrics(tempContext, {
    cartItems,
    formData,
    supportHotline,
  });
  const canvas = createCanvas(IMAGE_WIDTH, metrics.canvasHeight);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to initialize receipt drawing context.');
  }

  const cardX = OUTER_PADDING;
  const cardY = OUTER_PADDING;
  const cardWidth = IMAGE_WIDTH - (OUTER_PADDING * 2);
  const cardHeight = metrics.canvasHeight - (OUTER_PADDING * 2);
  const contentX = cardX + CARD_PADDING_X;
  const contentRight = cardX + cardWidth - CARD_PADDING_X;
  const contentTop = cardY + HEADER_HEIGHT + CARD_PADDING_Y;

  ctx.fillStyle = '#F5EFE4';
  ctx.fillRect(0, 0, IMAGE_WIDTH, metrics.canvasHeight);

  withShadow(ctx, { color: 'rgba(15, 23, 42, 0.12)', blur: 28, offsetY: 18 }, () => {
    fillRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, CARD_RADIUS, '#FFFFFF');
  });
  strokeRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, CARD_RADIUS, 'rgba(197, 160, 89, 0.32)', 2);

  fillRoundedRect(ctx, cardX, cardY, cardWidth, HEADER_HEIGHT, CARD_RADIUS, '#1B365D');
  ctx.fillStyle = '#C5A059';
  ctx.fillRect(cardX, cardY, cardWidth, 4);
  ctx.fillRect(cardX, cardY + HEADER_HEIGHT - 4, cardWidth, 4);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.arc(cardX + 112, cardY + 92, 96, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cardX + cardWidth - 90, cardY + 58, 84, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#F8F2E6';
  ctx.font = '700 18px Arial, sans-serif';
  ctx.fillText('GỐM ĐẠI THÀNH', contentX, cardY + 48);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px Arial, sans-serif';
  ctx.fillText('ẢNH ĐƠN HÀNG', contentX, cardY + 102);

  if (renderLegacyHeaderNote) {
    ctx.font = '500 23px Arial, sans-serif';
  ctx.fillStyle = '#D8E1EE';
  ctx.fillText('Lưu để tiện đối chiếu khi nhận hàng hoặc gửi qua Zalo.', contentX, cardY + 138);

  }

  const summaryBoxWidth = 286;
  const summaryBoxHeight = 108;
  const summaryBoxX = contentRight - summaryBoxWidth;
  const summaryBoxY = contentTop - 4;

  fillRoundedRect(ctx, summaryBoxX, summaryBoxY, summaryBoxWidth, summaryBoxHeight, 24, '#F9F5EE');
  strokeRoundedRect(ctx, summaryBoxX, summaryBoxY, summaryBoxWidth, summaryBoxHeight, 24, 'rgba(197, 160, 89, 0.24)');

  ctx.textAlign = 'left';
  ctx.font = '700 18px Arial, sans-serif';
  ctx.fillStyle = '#7C5B26';
  ctx.fillText('TỔNG THANH TOÁN', summaryBoxX + 24, summaryBoxY + 34);

  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillStyle = '#1B365D';
  ctx.fillText(formatReceiptCurrency(total), summaryBoxX + 24, summaryBoxY + 74);

  drawInfoPair(ctx, 'Mã đơn hàng', `#${String(orderNumber || '').replace(/^#/, '') || '---'}`, contentX, contentTop + 20);
  drawInfoPair(ctx, 'Ngày đặt', orderDate, contentX + 260, contentTop + 20);

  const reminderBoxY = contentTop + 124;
  fillRoundedRect(ctx, contentX, reminderBoxY, CONTENT_WIDTH, 84, 22, '#F8F3EA');
  strokeRoundedRect(ctx, contentX, reminderBoxY, CONTENT_WIDTH, 84, 22, 'rgba(197, 160, 89, 0.18)');
  ctx.fillStyle = '#5B6B83';
  ctx.font = '600 24px Arial, sans-serif';
  drawWrappedText(
    ctx,
    'Anh chị vui lòng tải ảnh đơn hàng về để khi nhận hàng tiện so sánh.',
    contentX + 24,
    reminderBoxY + 34,
    CONTENT_WIDTH - 48,
    30
  );

  const tableHeaderY = reminderBoxY + 128;
  ctx.fillStyle = '#1B365D';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillText('Sản phẩm trong đơn', contentX, tableHeaderY);

  const tableTop = tableHeaderY + 34;
  fillRoundedRect(ctx, contentX, tableTop, TABLE_WIDTH, 58, 18, '#F4EEE4');

  ctx.fillStyle = '#6B7280';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SẢN PHẨM', contentX + 22, tableTop + 36);
  ctx.textAlign = 'center';
  ctx.fillText('SL', contentX + PRODUCT_COLUMN_WIDTH + (QUANTITY_COLUMN_WIDTH / 2) + PRODUCT_TABLE_GAP, tableTop + 36);
  ctx.textAlign = 'right';
  ctx.fillText(
    'ĐƠN GIÁ',
    contentX + PRODUCT_COLUMN_WIDTH + PRODUCT_TABLE_GAP + QUANTITY_COLUMN_WIDTH + PRODUCT_TABLE_GAP + UNIT_PRICE_COLUMN_WIDTH,
    tableTop + 36
  );
  ctx.fillText('THÀNH TIỀN', contentX + TABLE_WIDTH - 22, tableTop + 36);

  let currentRowY = tableTop + 70;

  metrics.rowMetrics.forEach((item, index) => {
    const rowBackground = index % 2 === 0 ? '#FFFFFF' : '#FCFAF6';
    fillRoundedRect(ctx, contentX, currentRowY, TABLE_WIDTH, item.height, 16, rowBackground);
    strokeRoundedRect(ctx, contentX, currentRowY, TABLE_WIDTH, item.height, 16, 'rgba(226, 232, 240, 0.85)');

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1F2937';
    ctx.font = '700 26px Arial, sans-serif';
    drawWrappedText(
      ctx,
      `${String(index + 1).padStart(2, '0')}. ${item.name}`,
      contentX + 20,
      currentRowY + 32,
      PRODUCT_COLUMN_WIDTH - 12,
      32
    );

    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = '700 24px Arial, sans-serif';
    ctx.fillText(
      String(item.quantity),
      contentX + PRODUCT_COLUMN_WIDTH + PRODUCT_TABLE_GAP + (QUANTITY_COLUMN_WIDTH / 2),
      currentRowY + (item.height / 2) + 8
    );

    ctx.textAlign = 'right';
    ctx.font = '600 23px Arial, sans-serif';
    ctx.fillText(
      formatReceiptCurrency(item.unitPrice),
      contentX + PRODUCT_COLUMN_WIDTH + PRODUCT_TABLE_GAP + QUANTITY_COLUMN_WIDTH + PRODUCT_TABLE_GAP + UNIT_PRICE_COLUMN_WIDTH,
      currentRowY + (item.height / 2) + 8
    );
    ctx.font = '700 23px Arial, sans-serif';
    ctx.fillStyle = '#1B365D';
    ctx.fillText(
      formatReceiptCurrency(item.lineTotal),
      contentX + TABLE_WIDTH - 22,
      currentRowY + (item.height / 2) + 8
    );

    currentRowY += item.height + 12;
  });

  const contactBoxY = currentRowY + 12;
  const contactBoxHeight = metrics.contactBoxHeight;
  fillRoundedRect(ctx, contentX, contactBoxY, CONTENT_WIDTH, contactBoxHeight, 24, '#FBF7F0');
  strokeRoundedRect(ctx, contentX, contactBoxY, CONTENT_WIDTH, contactBoxHeight, 24, 'rgba(197, 160, 89, 0.2)');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#1B365D';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillText('Thông tin giao hàng', contentX + 24, contactBoxY + 38);

  ctx.font = '600 24px Arial, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('Số điện thoại', contentX + 24, contactBoxY + 80);
  ctx.fillStyle = '#1F2937';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText(phone, contentX + 194, contactBoxY + 80);

  ctx.font = '600 24px Arial, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('Địa chỉ', contentX + 24, contactBoxY + 124);
  ctx.fillStyle = '#1F2937';
  ctx.font = '600 24px Arial, sans-serif';
  drawWrappedText(
    ctx,
    addressText,
    contentX + 194,
    contactBoxY + 124,
    CONTENT_WIDTH - 218,
    ADDRESS_LINE_HEIGHT
  );

  const supportTextY = contactBoxY
    + 168
    + (Math.max(metrics.addressLines.length - 1, 0) * ADDRESS_LINE_HEIGHT);
  ctx.fillStyle = '#5B6B83';
  ctx.font = '500 22px Arial, sans-serif';
  drawWrappedText(
    ctx,
    metrics.supportMessage,
    contentX + 24,
    supportTextY,
    CONTENT_WIDTH - 48,
    SUPPORT_NOTICE_LINE_HEIGHT
  );

  if (renderLegacyContactBlock) {
    const contactBoxY = currentRowY + 12;
  const contactBoxHeight = 142 + (Math.max(metrics.addressLines.length - 1, 0) * 32);
  fillRoundedRect(ctx, contentX, contactBoxY, CONTENT_WIDTH, contactBoxHeight, 24, '#FBF7F0');
  strokeRoundedRect(ctx, contentX, contactBoxY, CONTENT_WIDTH, contactBoxHeight, 24, 'rgba(197, 160, 89, 0.2)');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#1B365D';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillText('Thông tin khách đặt', contentX + 24, contactBoxY + 38);

  ctx.font = '600 24px Arial, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('Số điện thoại', contentX + 24, contactBoxY + 80);
  ctx.fillStyle = '#1F2937';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText(phone, contentX + 194, contactBoxY + 80);

  ctx.font = '600 24px Arial, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('Địa chỉ', contentX + 24, contactBoxY + 124);
  ctx.fillStyle = '#1F2937';
  ctx.font = '600 24px Arial, sans-serif';
  drawWrappedText(
    ctx,
    getReceiptAddress(formData) || 'Khách chưa để lại địa chỉ.',
    contentX + 194,
    contactBoxY + 124,
    CONTENT_WIDTH - 218,
    32
  );

  const footerY = cardY + cardHeight - 48;
  ctx.fillStyle = '#7C8799';
  ctx.font = '500 19px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Ảnh đơn hàng được tạo từ trang cảm ơn sau khi đặt hàng thành công.', contentX, footerY);

  }

  const fileNameOrder = String(orderNumber || 'don-hang').replace(/[^a-zA-Z0-9-_]/g, '') || 'don-hang';
  const blob = await canvasToBlob(canvas);

  downloadBlob(blob, `${fileNameOrder}-don-hang.png`);
};
