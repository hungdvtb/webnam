const getNodeKey = (value, fallback) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value);
};

export function buildCategoryTree(categories = []) {
  const source = Array.isArray(categories) ? categories : [];
  const nodesByKey = new Map();
  const roots = [];

  source.forEach((category, index) => {
    const name = String(category?.name || "").trim();
    const slug = String(category?.slug || "").trim();

    if (!name || !slug) {
      return;
    }

    const nodeKey = getNodeKey(category?.id, `generated-${index}`);
    const parentKey =
      category?.parent_id === undefined || category?.parent_id === null || category?.parent_id === ""
        ? null
        : String(category.parent_id);

    nodesByKey.set(nodeKey, {
      ...category,
      name,
      slug,
      children: [],
      _nodeKey: nodeKey,
      _parentKey: parentKey,
    });
  });

  source.forEach((category, index) => {
    const nodeKey = getNodeKey(category?.id, `generated-${index}`);
    const node = nodesByKey.get(nodeKey);

    if (!node) {
      return;
    }

    const parentNode = node._parentKey ? nodesByKey.get(node._parentKey) : null;

    if (parentNode) {
      parentNode.children.push(node);
      return;
    }

    roots.push(node);
  });

  return roots;
}

export function flattenCategoryBranch(nodes = [], level = 1) {
  const flattened = [];

  const walk = (branchNodes, branchLevel) => {
    branchNodes.forEach((node) => {
      flattened.push({
        ...node,
        level: branchLevel,
      });

      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, branchLevel + 1);
      }
    });
  };

  walk(Array.isArray(nodes) ? nodes : [], level);

  return flattened;
}

export function branchContainsSlug(node, slug = "") {
  const targetSlug = String(slug || "").trim();

  if (!node || !targetSlug) {
    return false;
  }

  if (node.slug === targetSlug) {
    return true;
  }

  return Array.isArray(node.children)
    ? node.children.some((childNode) => branchContainsSlug(childNode, targetSlug))
    : false;
}

export function findCategoryPathBySlug(nodes = [], slug = "") {
  const targetSlug = String(slug || "").trim();

  if (!targetSlug) {
    return [];
  }

  const walk = (branchNodes, currentPath = []) => {
    for (const node of branchNodes) {
      const nextPath = [...currentPath, node];

      if (node.slug === targetSlug) {
        return nextPath;
      }

      if (Array.isArray(node.children) && node.children.length > 0) {
        const nestedPath = walk(node.children, nextPath);

        if (nestedPath.length > 0) {
          return nestedPath;
        }
      }
    }

    return [];
  };

  return walk(Array.isArray(nodes) ? nodes : []);
}

export function getSelectedParentIdForSlug(nodes = [], slug = "") {
  const path = findCategoryPathBySlug(nodes, slug);

  if (!path.length) {
    return null;
  }

  const rootNode = path[0];
  const activeNode = path[path.length - 1];

  if (path.length > 1) {
    return rootNode?._nodeKey || null;
  }

  if (Array.isArray(activeNode?.children) && activeNode.children.length > 0) {
    return activeNode._nodeKey;
  }

  return null;
}

export function orderRootCategories(nodes = [], prioritizedId = null) {
  const rootNodes = Array.isArray(nodes) ? nodes : [];

  if (!prioritizedId) {
    return rootNodes;
  }

  const selectedNode = rootNodes.find((node) => node._nodeKey === prioritizedId);

  if (!selectedNode) {
    return rootNodes;
  }

  return [
    selectedNode,
    ...rootNodes.filter((node) => node._nodeKey !== prioritizedId),
  ];
}
