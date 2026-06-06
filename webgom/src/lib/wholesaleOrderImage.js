const IMAGE_WIDTH = 1080;
const OUTER_PADDING = 36;
const CARD_PADDING_X = 48;
const CARD_RADIUS = 26;
const CONTENT_WIDTH = IMAGE_WIDTH - (OUTER_PADDING * 2) - (CARD_PADDING_X * 2);
const THUMB_SIZE = 132;
const ROW_GAP = 14;
const DEFAULT_CANVAS_FONT_FAMILY = "'Roboto', sans-serif";

const formatNumber = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

const normalizeText = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();

const getCanvasFontFamily = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return DEFAULT_CANVAS_FONT_FAMILY;
  }

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles = document.body ? window.getComputedStyle(document.body) : null;
  const fontFamily = normalizeText(rootStyles.getPropertyValue("--font-roboto"))
    || normalizeText(rootStyles.getPropertyValue("--font-body"))
    || normalizeText(bodyStyles?.fontFamily)
    || DEFAULT_CANVAS_FONT_FAMILY;

  return fontFamily;
};

const setCanvasFont = (ctx, weight, size, fontFamily) => {
  ctx.font = `${weight} ${size}px ${fontFamily || DEFAULT_CANVAS_FONT_FAMILY}`;
};

const waitForCanvasFonts = async () => {
  if (typeof document === "undefined" || !document.fonts) {
    return;
  }

  await document.fonts.ready;
};

const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatWholesalePrice = (value) => {
  const price = clampNumber(value);

  if (price <= 0) {
    return "Liên hệ";
  }

  if (price >= 1000 && price % 1000 === 0) {
    return `${formatNumber(price / 1000)}K`;
  }

  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(price);
};

const getItemDisplayTitle = (item = {}) => {
  const name = normalizeText(item.name);
  const parentName = normalizeText(item.parentName);

  return parentName && parentName !== name ? `${parentName} ${name}` : name;
};

const normalizeOrderItems = (items = []) => (
  (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const name = normalizeText(item?.name) || "Sản phẩm";
      const parentName = normalizeText(item?.parentName);
      const quantity = Math.max(clampNumber(item?.quantity), 0);
      const unitPrice = clampNumber(item?.price);
      const lineTotal = unitPrice * quantity;

      return {
        key: normalizeText(item?.key) || `wholesale-order-item-${index}`,
        productName: parentName || name,
        variantName: getItemDisplayTitle({ name, parentName }) || name,
        quantity,
        unitPrice,
        lineTotal,
        imageSrc: normalizeText(item?.imageSrc || item?.image || item?.thumbnailSrc),
      };
    })
    .filter((item) => item.quantity > 0)
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

const wrapText = (ctx, text, maxWidth) => {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return ["-"];
  }

  const words = normalizedText.split(" ");
  const lines = [];
  let currentLine = "";

  const pushLongWord = (word) => {
    let currentWordLine = "";

    Array.from(word).forEach((character) => {
      const candidate = `${currentWordLine}${character}`;

      if (currentWordLine && ctx.measureText(candidate).width > maxWidth) {
        lines.push(currentWordLine);
        currentWordLine = character;
        return;
      }

      currentWordLine = candidate;
    });

    currentLine = currentWordLine;
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

    currentLine = "";
    pushLongWord(word);
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : ["-"];
};

const trimTextToWidth = (ctx, text, maxWidth) => {
  let output = normalizeText(text);

  while (output && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1).trim();
  }

  return output ? `${output}...` : "...";
};

const drawWrappedText = (ctx, text, x, y, maxWidth, lineHeight, options = {}) => {
  const lines = wrapText(ctx, text, maxWidth);
  const maxLines = Math.max(options.maxLines || lines.length, 1);
  const renderedLines = lines.slice(0, maxLines);

  if (lines.length > maxLines) {
    renderedLines[renderedLines.length - 1] = trimTextToWidth(
      ctx,
      renderedLines[renderedLines.length - 1],
      maxWidth,
    );
  }

  ctx.textAlign = options.align || "left";

  renderedLines.forEach((line, index) => {
    ctx.fillText(line, x, y + (index * lineHeight));
  });

  return {
    lines: renderedLines,
    height: renderedLines.length * lineHeight,
  };
};

const createCanvas = (width, height) => {
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  return canvas;
};

const canvasToBlob = (canvas) => (
  new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error("Canvas blob generation failed."));
        }, "image/png");
      } catch (error) {
        reject(error);
      }
      return;
    }

    try {
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1] || "";
      const bytes = atob(base64);
      const array = new Uint8Array(bytes.length);

      for (let index = 0; index < bytes.length; index += 1) {
        array[index] = bytes.charCodeAt(index);
      }

      resolve(new Blob([array], { type: "image/png" }));
    } catch (error) {
      reject(error);
    }
  })
);

const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();

  window.setTimeout(() => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, 60000);
};

const resolveBrowserImageUrl = (src = "") => {
  const normalized = normalizeText(src);

  if (!normalized || typeof window === "undefined") {
    return "";
  }

  if (normalized.startsWith("//")) {
    return `${window.location.protocol}${normalized}`;
  }

  if (normalized.startsWith("/")) {
    return `${window.location.origin}${normalized}`;
  }

  return normalized;
};

const loadCanvasImage = (src = "") => (
  new Promise((resolve) => {
    const imageUrl = resolveBrowserImageUrl(src);

    if (!imageUrl || typeof window === "undefined") {
      resolve(null);
      return;
    }

    const image = new window.Image();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => finish(null), 6000);

    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.decoding = "async";

    if (!/^data:image\//i.test(imageUrl) && !/^blob:/i.test(imageUrl)) {
      image.crossOrigin = "anonymous";
    }

    image.src = imageUrl;
  })
);

const loadOrderImages = async (items = []) => {
  const imageCache = new Map();

  await Promise.all(items.map(async (item) => {
    const imageUrl = resolveBrowserImageUrl(item.imageSrc);

    if (!imageUrl) {
      return;
    }

    if (!imageCache.has(imageUrl)) {
      imageCache.set(imageUrl, loadCanvasImage(imageUrl));
    }

    const image = await imageCache.get(imageUrl);
    item.loadedImage = image || null;
  }));
};

const drawImageCover = (ctx, image, x, y, width, height, radius, fontFamily) => {
  if (!image) {
    fillRoundedRect(ctx, x, y, width, height, radius, "#F4EEE4");
    strokeRoundedRect(ctx, x, y, width, height, radius, "rgba(23, 47, 80, 0.12)", 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#A68249";
    setCanvasFont(ctx, 800, 20, fontFamily);
    ctx.fillText("ẢNH", x + (width / 2), y + (height / 2) + 7);
    return;
  }

  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sourceWidth = sourceHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  ctx.restore();
  strokeRoundedRect(ctx, x, y, width, height, radius, "rgba(23, 47, 80, 0.12)", 2);
};

const drawInfoPill = (ctx, label, value, x, y, width, fontFamily) => {
  fillRoundedRect(ctx, x, y, width, 70, 18, "#FBF7F0");
  strokeRoundedRect(ctx, x, y, width, 70, 18, "rgba(166, 75, 42, 0.14)", 2);

  ctx.textAlign = "left";
  setCanvasFont(ctx, 800, 18, fontFamily);
  ctx.fillStyle = "#A64B2A";
  ctx.fillText(label, x + 22, y + 27);

  setCanvasFont(ctx, 900, 28, fontFamily);
  ctx.fillStyle = "#172F50";
  drawWrappedText(ctx, value, x + 22, y + 56, width - 44, 30, { maxLines: 1 });
};

const buildMetrics = (ctx, items = [], fontFamily = DEFAULT_CANVAS_FONT_FAMILY) => {
  const textWidth = CONTENT_WIDTH - THUMB_SIZE - 30 - 224;

  return items.map((item) => {
    setCanvasFont(ctx, 900, 29, fontFamily);
    const productLines = wrapText(ctx, item.productName, textWidth).slice(0, 2);
    setCanvasFont(ctx, 800, 24, fontFamily);
    const variantLines = wrapText(ctx, item.variantName, textWidth).slice(0, 2);
    const textHeight = 36 + (productLines.length * 34) + 12 + (variantLines.length * 30);
    const rowHeight = Math.max(174, textHeight + 52);

    return {
      ...item,
      productLines,
      variantLines,
      rowHeight,
    };
  });
};

const renderWholesaleCanvas = ({ items, total, contactPhone, withImages = true }) => {
  const fontFamily = getCanvasFontFamily();
  const tempCanvas = createCanvas(IMAGE_WIDTH, 1200);
  const tempContext = tempCanvas.getContext("2d");

  if (!tempContext) {
    throw new Error("Unable to initialize wholesale order image context.");
  }

  const metrics = buildMetrics(tempContext, items, fontFamily);
  const rowsHeight = metrics.reduce((sum, item) => sum + item.rowHeight, 0) + (Math.max(metrics.length - 1, 0) * ROW_GAP);
  const canvasHeight = Math.max(980, 426 + rowsHeight + 190);
  const canvas = createCanvas(IMAGE_WIDTH, canvasHeight);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Unable to initialize wholesale order image context.");
  }

  const cardX = OUTER_PADDING;
  const cardY = OUTER_PADDING;
  const cardWidth = IMAGE_WIDTH - (OUTER_PADDING * 2);
  const cardHeight = canvasHeight - (OUTER_PADDING * 2);
  const contentX = cardX + CARD_PADDING_X;
  const contentRight = cardX + cardWidth - CARD_PADDING_X;

  ctx.fillStyle = "#F5EFE4";
  ctx.fillRect(0, 0, IMAGE_WIDTH, canvasHeight);

  ctx.save();
  ctx.shadowColor = "rgba(9, 20, 36, 0.16)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 18;
  fillRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, CARD_RADIUS, "#FFFFFF");
  ctx.restore();
  strokeRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, CARD_RADIUS, "rgba(166, 75, 42, 0.16)", 2);

  fillRoundedRect(ctx, contentX, cardY + 42, CONTENT_WIDTH, 158, 24, "#172F50");
  ctx.fillStyle = "#F8F2E6";
  setCanvasFont(ctx, 900, 20, fontFamily);
  ctx.textAlign = "left";
  ctx.fillText("ĐƠN HÀNG SỈ TẠM TÍNH", contentX + 30, cardY + 84);
  setCanvasFont(ctx, 900, 30, fontFamily);
  ctx.fillText("Tổng tiền đơn đặt", contentX + 30, cardY + 124);
  ctx.fillStyle = "#FFFFFF";
  setCanvasFont(ctx, 900, 54, fontFamily);
  ctx.textAlign = "right";
  ctx.fillText(formatWholesalePrice(total), contentRight - 30, cardY + 132);

  const contactValue = normalizeText(contactPhone) || "Chưa cấu hình SĐT liên hệ";
  drawInfoPill(ctx, "SĐT LIÊN HỆ", contactValue, contentX, cardY + 222, Math.floor((CONTENT_WIDTH - 14) * 0.48), fontFamily);
  drawInfoPill(ctx, "SỐ DÒNG HÀNG", `${formatNumber(items.length)} mẫu`, contentX + Math.floor((CONTENT_WIDTH + 14) * 0.48), cardY + 222, CONTENT_WIDTH - Math.floor((CONTENT_WIDTH + 14) * 0.48), fontFamily);

  const listTitleY = cardY + 342;
  ctx.textAlign = "left";
  ctx.fillStyle = "#172F50";
  setCanvasFont(ctx, 900, 32, fontFamily);
  ctx.fillText("Danh sách sản phẩm", contentX, listTitleY);

  let rowY = listTitleY + 36;

  metrics.forEach((item, index) => {
    const rowBackground = index % 2 === 0 ? "#FFFFFF" : "#FCFAF6";

    fillRoundedRect(ctx, contentX, rowY, CONTENT_WIDTH, item.rowHeight, 22, rowBackground);
    strokeRoundedRect(ctx, contentX, rowY, CONTENT_WIDTH, item.rowHeight, 22, "rgba(226, 232, 240, 0.96)", 2);

    drawImageCover(
      ctx,
      withImages ? item.loadedImage : null,
      contentX + 18,
      rowY + 21,
      THUMB_SIZE,
      THUMB_SIZE,
      18,
      fontFamily,
    );

    const textX = contentX + 18 + THUMB_SIZE + 28;
    const amountX = contentRight - 24;
    const textWidth = amountX - textX - 196;

    ctx.textAlign = "left";
    ctx.fillStyle = "#172F50";
    setCanvasFont(ctx, 900, 29, fontFamily);
    drawWrappedText(ctx, item.productName, textX, rowY + 48, textWidth, 34, { maxLines: 2 });

    ctx.fillStyle = "#64748B";
    setCanvasFont(ctx, 800, 21, fontFamily);
    ctx.fillText("Mẫu/size", textX, rowY + 122);
    ctx.fillStyle = "#1F2937";
    setCanvasFont(ctx, 800, 24, fontFamily);
    drawWrappedText(ctx, item.variantName, textX + 108, rowY + 122, textWidth - 108, 30, { maxLines: 2 });

    ctx.textAlign = "right";
    ctx.fillStyle = "#64748B";
    setCanvasFont(ctx, 800, 22, fontFamily);
    ctx.fillText(`SL: ${formatNumber(item.quantity)}`, amountX, rowY + 58);
    ctx.fillText(formatWholesalePrice(item.unitPrice), amountX, rowY + 94);
    ctx.fillStyle = "#B42318";
    setCanvasFont(ctx, 900, 30, fontFamily);
    ctx.fillText(formatWholesalePrice(item.lineTotal), amountX, rowY + 138);

    rowY += item.rowHeight + ROW_GAP;
  });

  const totalY = rowY + 12;
  fillRoundedRect(ctx, contentX, totalY, CONTENT_WIDTH, 96, 24, "#FFF4EA");
  strokeRoundedRect(ctx, contentX, totalY, CONTENT_WIDTH, 96, 24, "rgba(166, 75, 42, 0.22)", 2);
  ctx.textAlign = "left";
  ctx.fillStyle = "#7C4A22";
  setCanvasFont(ctx, 900, 28, fontFamily);
  ctx.fillText("Tổng cộng", contentX + 30, totalY + 58);
  ctx.textAlign = "right";
  ctx.fillStyle = "#B42318";
  setCanvasFont(ctx, 900, 42, fontFamily);
  ctx.fillText(formatWholesalePrice(total), contentRight - 30, totalY + 61);

  ctx.textAlign = "left";
  ctx.fillStyle = "#7C8799";
  setCanvasFont(ctx, 700, 19, fontFamily);
  ctx.fillText("Ảnh tạo từ Bảng giá sỉ Gốm Đại Thành, dùng để gửi Zalo xác nhận đơn.", contentX, totalY + 132);

  return canvas;
};

const buildFileTimestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("")
    + "-"
    + [
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join("");
};

export const downloadWholesaleOrderImage = async ({
  items = [],
  total = 0,
  contactPhone = "",
} = {}) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Wholesale order image can only be generated in the browser.");
  }

  const normalizedItems = normalizeOrderItems(items);

  if (normalizedItems.length === 0) {
    throw new Error("Missing wholesale order items.");
  }

  const normalizedTotal = clampNumber(total)
    || normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);

  await waitForCanvasFonts();
  await loadOrderImages(normalizedItems);

  let canvas = renderWholesaleCanvas({
    items: normalizedItems,
    total: normalizedTotal,
    contactPhone,
    withImages: true,
  });
  let blob;

  try {
    blob = await canvasToBlob(canvas);
  } catch {
    canvas = renderWholesaleCanvas({
      items: normalizedItems,
      total: normalizedTotal,
      contactPhone,
      withImages: false,
    });
    blob = await canvasToBlob(canvas);
  }

  downloadBlob(blob, `don-hang-si-${buildFileTimestamp()}.png`);
};
