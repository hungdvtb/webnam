"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { WholesaleSearchForm } from "./WholesaleControls";
import WholesaleProductRow from "./WholesaleProductRow";
import styles from "./wholesale.module.css";

const formatNumber = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

const TABLE_COLUMNS = [
  "Media",
  "Sản phẩm",
  "Thông tin",
  "Giá sỉ",
  "Tồn kho",
  "Số lượng",
  "Thành tiền",
  "Đặt hàng",
];

const formatWholesalePrice = (value) => {
  const price = Number(value || 0);

  if (!Number.isFinite(price) || price <= 0) {
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

const normalizeText = (value = "") => String(value ?? "").trim();

const clampQuantity = (value, stock = 0) => {
  const parsed = Number.parseInt(String(value || 0), 10);
  const quantity = Number.isFinite(parsed) ? parsed : 0;
  const stockLimit = Math.max(0, Math.floor(Number(stock || 0)));

  if (stockLimit > 0) {
    return Math.min(Math.max(quantity, 0), stockLimit);
  }

  return Math.max(quantity, 0);
};

const buildOrderMessage = (items = [], total = 0) => {
  const lines = [
    "Tôi muốn đặt hàng theo bảng giá sỉ:",
    "",
    ...items.map((item, index) => (
      `${index + 1}. ${item.parentName && item.parentName !== item.name ? `${item.parentName} - ` : ""}${item.name}`
      + ` | SL: ${formatNumber(item.quantity)}`
      + ` | Giá: ${formatWholesalePrice(item.price)}`
      + ` | Thành tiền: ${formatWholesalePrice(item.price * item.quantity)}`
    )),
    "",
    `Tổng tạm tính: ${formatWholesalePrice(total)}`,
  ];

  return lines.join("\n");
};

export default function WholesaleOrderTable({
  rows = [],
  contactHref = "",
  currentSearch = "",
}) {
  const [orderItems, setOrderItems] = useState({});
  const [expandAllOpen, setExpandAllOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [copyState, setCopyState] = useState("");
  const stickyScopeRef = useRef(null);
  const orderSummaryRef = useRef(null);
  const columnHeaderRef = useRef(null);
  const columnHeaderScrollerRef = useRef(null);
  const tableScrollerRef = useRef(null);
  const hasRows = rows.length > 0;

  const selectedItems = useMemo(
    () => Object.values(orderItems)
      .filter((item) => Number(item.quantity || 0) > 0)
      .sort((left, right) => String(left.key).localeCompare(String(right.key))),
    [orderItems],
  );
  const selectedLineCount = selectedItems.length;
  const selectedQuantity = selectedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const orderTotal = selectedItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
  const orderMessage = useMemo(() => buildOrderMessage(selectedItems, orderTotal), [selectedItems, orderTotal]);

  useEffect(() => {
    const scope = stickyScopeRef.current?.closest("[data-wholesale-page]") || document.documentElement;
    const controls = document.querySelector('[data-wholesale-sticky-layer="controls"]');
    const orderSummary = orderSummaryRef.current;
    const columnHeader = columnHeaderRef.current;
    const stickyVars = [
      "--wholesale-sticky-controls-height",
      "--wholesale-sticky-summary-height",
      "--wholesale-sticky-column-header-height",
    ];
    let frameId = 0;

    const readHeight = (element) => (
      element ? Math.ceil(element.getBoundingClientRect().height) : 0
    );

    const updateStickyOffsets = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        scope.style.setProperty(stickyVars[0], `${readHeight(controls)}px`);
        scope.style.setProperty(stickyVars[1], `${readHeight(orderSummary)}px`);
        scope.style.setProperty(stickyVars[2], `${readHeight(columnHeader)}px`);
      });
    };

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateStickyOffsets)
      : null;

    [controls, orderSummary, columnHeader].forEach((element) => {
      if (element && observer) {
        observer.observe(element);
      }
    });

    updateStickyOffsets();
    window.addEventListener("resize", updateStickyOffsets);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateStickyOffsets);
      observer?.disconnect();
      stickyVars.forEach((name) => scope.style.removeProperty(name));
    };
  }, [hasRows]);

  useEffect(() => {
    const headerScroller = columnHeaderScrollerRef.current;
    const tableScroller = tableScrollerRef.current;

    if (!headerScroller || !tableScroller) {
      return undefined;
    }

    let syncing = false;
    const syncScroll = (source, target) => {
      if (syncing) {
        return;
      }

      syncing = true;
      target.scrollLeft = source.scrollLeft;
      window.requestAnimationFrame(() => {
        syncing = false;
      });
    };
    const handleTableScroll = () => syncScroll(tableScroller, headerScroller);
    const handleHeaderScroll = () => syncScroll(headerScroller, tableScroller);

    tableScroller.addEventListener("scroll", handleTableScroll, { passive: true });
    headerScroller.addEventListener("scroll", handleHeaderScroll, { passive: true });

    return () => {
      tableScroller.removeEventListener("scroll", handleTableScroll);
      headerScroller.removeEventListener("scroll", handleHeaderScroll);
    };
  }, [hasRows]);

  const setOrderQuantity = (item, nextQuantity) => {
    if (!item?.key) {
      return;
    }

    const quantity = clampQuantity(nextQuantity, item.stock);

    setOrderItems((current) => {
      const updated = { ...current };

      if (quantity <= 0) {
        delete updated[item.key];
        return updated;
      }

      updated[item.key] = {
        ...item,
        quantity,
      };
      return updated;
    });
  };

  const addOrderItem = (item) => {
    if (!item?.key) {
      return;
    }

    const currentQuantity = Number(orderItems[item.key]?.quantity || 0);
    setOrderQuantity(item, currentQuantity + 1);
  };

  const copyOrderMessage = async () => {
    if (!orderMessage) {
      return;
    }

    try {
      await navigator.clipboard.writeText(orderMessage);
      setCopyState("Đã sao chép");
      window.setTimeout(() => setCopyState(""), 1800);
    } catch {
      setCopyState("Không sao chép được");
      window.setTimeout(() => setCopyState(""), 1800);
    }
  };

  return (
    <div ref={stickyScopeRef}>
      <div
        ref={orderSummaryRef}
        className={styles.orderSummaryBar}
        data-wholesale-sticky-layer="summary"
      >
        <div className={styles.orderSummaryMeta}>
          <span className="material-symbols-outlined" aria-hidden="true">shopping_cart</span>
          <strong>{selectedLineCount > 0 ? `Đã chọn ${formatNumber(selectedLineCount)} mẫu` : "Chưa chọn mẫu"}</strong>
          <span>{formatNumber(selectedQuantity)} sản phẩm</span>
          <b>Tạm tính {orderTotal > 0 ? formatWholesalePrice(orderTotal) : "-"}</b>
        </div>
        <div className={styles.orderSummaryTools}>
          <WholesaleSearchForm currentSearch={currentSearch} className={styles.tableSearchForm} />
          <button
            type="button"
            className={`${styles.expandAllButton} ${expandAllOpen ? styles.expandAllButtonActive : ""}`}
            onClick={() => setExpandAllOpen((current) => !current)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {expandAllOpen ? "unfold_less" : "unfold_more"}
            </span>
            <span className={styles.expandAllLabel}>
              {expandAllOpen ? "Thu gọn tất cả mẫu và size" : "Hiển thị tất cả mẫu và size"}
            </span>
          </button>
        </div>
        <button
          type="button"
          className={styles.orderSummaryButton}
          onClick={() => setIsOrderModalOpen(true)}
          disabled={selectedLineCount === 0}
        >
          <span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>
          Đặt hàng
        </button>
      </div>

      {!hasRows ? (
        <div className={styles.emptyState}>
          <span className="material-symbols-outlined" aria-hidden="true">search_off</span>
          <h2>Chưa tìm thấy sản phẩm phù hợp</h2>
          <p>Thử đổi từ khóa hoặc chọn danh mục khác để xem thêm mẫu sỉ.</p>
          <Link href="/bang-gia-si">Xóa bộ lọc</Link>
        </div>
      ) : (
        <>
      <div
        ref={columnHeaderRef}
        className={styles.columnHeaderViewport}
        data-wholesale-sticky-layer="column-header"
      >
        <div ref={columnHeaderScrollerRef} className={styles.columnHeaderScroller}>
          <div className={styles.columnHeaderRow} role="row">
            {TABLE_COLUMNS.map((column) => (
              <div key={column} className={styles.columnHeaderCell} role="columnheader">
                {column}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div ref={tableScrollerRef} className={styles.tableScroller}>
        <table className={styles.priceTable}>
          <colgroup>
            <col className={styles.mediaColumn} />
            <col className={styles.productColumn} />
            <col className={styles.infoColumn} />
            <col className={styles.priceColumn} />
            <col className={styles.stockColumn} />
            <col className={styles.quantityColumn} />
            <col className={styles.amountColumn} />
            <col className={styles.orderColumn} />
          </colgroup>
          <thead>
            <tr>
              <th>Media</th>
              <th>Sản phẩm</th>
              <th>Thông tin</th>
              <th>Giá sỉ</th>
              <th>Tồn kho</th>
              <th>Số lượng</th>
              <th>Thành tiền</th>
              <th>Đặt hàng</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <WholesaleProductRow
                key={row.key}
                product={row.product}
                imageSrc={row.imageSrc}
                galleryImages={row.galleryImages}
                videoHref={row.videoHref}
                videoItems={row.videoItems}
                wholesalePrice={row.wholesalePrice}
                stock={row.stock}
                orderItems={orderItems}
                onSetOrderQuantity={setOrderQuantity}
                onAddOrderItem={addOrderItem}
                expandAll={expandAllOpen}
              />
            ))}
          </tbody>
        </table>
      </div>

      {isOrderModalOpen ? (
        <div className={styles.orderModalOverlay} role="dialog" aria-modal="true" aria-label="Xác nhận đặt hàng">
          <button
            type="button"
            className={styles.orderModalBackdrop}
            aria-label="Đóng xác nhận đặt hàng"
            onClick={() => setIsOrderModalOpen(false)}
          />
          <section className={styles.orderModal}>
            <header className={styles.orderModalHeader}>
              <div>
                <p>Đơn hàng tạm tính</p>
                <h2>Xác nhận đặt hàng</h2>
              </div>
              <button type="button" className={styles.orderModalClose} aria-label="Đóng" onClick={() => setIsOrderModalOpen(false)}>
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </header>

            <div className={styles.orderModalBody}>
              <div className={styles.orderItemsList}>
                {selectedItems.map((item) => {
                  const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
                  const itemTitle = normalizeText(item.parentName && item.parentName !== item.name
                    ? `${item.parentName} - ${item.name}`
                    : item.name);

                  return (
                    <div key={item.key} className={styles.orderItem}>
                      <div>
                        <strong>{itemTitle}</strong>
                        <span className={styles.orderItemFormula}>
                          {formatNumber(item.quantity)} x {formatWholesalePrice(item.price)} = <b>{formatWholesalePrice(lineTotal)}</b>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.orderTotalRow}>
                <span>Tổng tạm tính</span>
                <strong>{formatWholesalePrice(orderTotal)}</strong>
              </div>

              <textarea
                className={styles.orderMessageBox}
                value={orderMessage}
                readOnly
                rows={Math.min(Math.max(selectedItems.length + 4, 6), 10)}
              />
            </div>

            <footer className={styles.orderModalFooter}>
              <button type="button" className={styles.copyOrderButton} onClick={copyOrderMessage}>
                <span className="material-symbols-outlined" aria-hidden="true">content_copy</span>
                {copyState || "Sao chép nội dung"}
              </button>
              <a
                href={contactHref || "#wholesale-table"}
                className={styles.zaloOrderButton}
                target={contactHref ? "_blank" : undefined}
                rel={contactHref ? "noreferrer" : undefined}
                onClick={copyOrderMessage}
              >
                <span className="material-symbols-outlined" aria-hidden="true">send</span>
                Gửi qua Zalo
              </a>
              <button type="button" className={styles.continueOrderButton} onClick={() => setIsOrderModalOpen(false)}>
                Tiếp tục chọn
              </button>
            </footer>
          </section>
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}
