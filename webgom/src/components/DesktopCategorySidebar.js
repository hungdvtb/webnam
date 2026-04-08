"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { branchContainsSlug, buildCategoryTree } from "@/lib/categoryNavigation";
import styles from "../app/products/products.module.css";

function getExpandedNodesMap(nodes = []) {
  const nextExpandedNodes = {};

  const walk = (branchNodes) => {
    branchNodes.forEach((node) => {
      if (Array.isArray(node.children) && node.children.length > 0) {
        nextExpandedNodes[node._nodeKey] = true;
        walk(node.children);
      }
    });
  };

  walk(Array.isArray(nodes) ? nodes : []);
  return nextExpandedNodes;
}

function CategoryTreeNode({ node, currentCategorySlug, expandedNodes, onToggle }) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isExpanded = hasChildren ? expandedNodes[node._nodeKey] !== false : false;
  const isActive = currentCategorySlug === node.slug;
  const isBranchActive = !isActive && branchContainsSlug(node, currentCategorySlug);
  const toggleLabel = isExpanded ? "Thu gọn" : "Mở rộng";

  return (
    <div className={styles.categoryTreeNode}>
      <div className={styles.categoryRow}>
        <Link
          href={`/products?category=${node.slug}`}
          className={[
            styles.checkboxItem,
            styles.categoryLink,
            isActive ? styles.categoryLinkActive : "",
            isBranchActive ? styles.categoryLinkBranchActive : "",
          ].filter(Boolean).join(" ")}
        >
          <span className={`material-symbols-outlined ${styles.categoryLinkIcon}`} aria-hidden="true">
            {isActive ? "check_box" : "check_box_outline_blank"}
          </span>
          <span className={styles.categoryLinkLabel}>{node.name}</span>
          <span className={`${styles.count} ${styles.categoryLinkCount}`}>({node.products_count || 0})</span>
        </Link>

        {hasChildren && (
          <button
            type="button"
            className={styles.categoryToggle}
            aria-expanded={isExpanded}
            aria-label={`${toggleLabel} danh mục ${node.name}`}
            onClick={() => onToggle(node._nodeKey)}
          >
            <span
              className={`material-symbols-outlined ${styles.categoryToggleIcon} ${
                isExpanded ? styles.categoryToggleIconExpanded : ""
              }`}
              aria-hidden="true"
            >
              expand_more
            </span>
          </button>
        )}
      </div>

      {hasChildren && (
        <div
          className={`${styles.categoryChildrenRegion} ${
            isExpanded ? styles.categoryChildrenRegionExpanded : ""
          }`}
        >
          <div className={styles.categoryChildrenInner}>
            <div className={styles.categoryChildrenList}>
              {node.children.map((childNode) => (
                <CategoryTreeNode
                  key={childNode._nodeKey}
                  node={childNode}
                  currentCategorySlug={currentCategorySlug}
                  expandedNodes={expandedNodes}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DesktopCategorySidebar({ categories, currentCategorySlug }) {
  const categoryTree = buildCategoryTree(categories);
  const [expandedNodes, setExpandedNodes] = useState(() => getExpandedNodesMap(categoryTree));

  useEffect(() => {
    setExpandedNodes(getExpandedNodesMap(buildCategoryTree(categories)));
  }, [categories]);

  if (!categoryTree.length) {
    return null;
  }

  return (
    <div className={styles.sidebarSection}>
      <h3 className={styles.sidebarTitle}>Danh mục</h3>

      <div className={styles.categoryTree}>
        {categoryTree.map((node) => (
          <CategoryTreeNode
            key={node._nodeKey}
            node={node}
            currentCategorySlug={currentCategorySlug}
            expandedNodes={expandedNodes}
            onToggle={(nodeKey) =>
              setExpandedNodes((currentExpandedNodes) => ({
                ...currentExpandedNodes,
                [nodeKey]: !currentExpandedNodes[nodeKey],
              }))
            }
          />
        ))}
      </div>
    </div>
  );
}
