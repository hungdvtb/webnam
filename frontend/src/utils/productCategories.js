export function normalizeCategoryIds(values = []) {
    const normalizedValues = Array.isArray(values) ? values : [values];

    return Array.from(
        new Map(
            normalizedValues
                .map((value) => String(value ?? '').trim())
                .filter(Boolean)
                .map((value) => [value, value])
        ).values()
    );
}

export function getProductCategoryIds(product) {
    return normalizeCategoryIds([
        product?.category_id,
        ...(Array.isArray(product?.category_ids) ? product.category_ids : []),
        ...(Array.isArray(product?.categories) ? product.categories.map((category) => category?.id) : []),
    ]);
}

export function getCategoryNamesByIds(categoryIds = [], categories = []) {
    const categoryMap = new Map(
        (Array.isArray(categories) ? categories : [])
            .map((category) => [String(category?.id ?? '').trim(), String(category?.name ?? '').trim()])
            .filter(([id, name]) => id && name)
    );

    return normalizeCategoryIds(categoryIds)
        .map((categoryId) => categoryMap.get(categoryId))
        .filter(Boolean);
}

export function getProductCategoryNames(product, categories = []) {
    const relationCategoryMap = new Map(
        (Array.isArray(product?.categories) ? product.categories : [])
            .map((category) => [String(category?.id ?? '').trim(), String(category?.name ?? '').trim()])
            .filter(([id, name]) => id && name)
    );
    const fallbackCategoryMap = new Map(
        (Array.isArray(categories) ? categories : [])
            .map((category) => [String(category?.id ?? '').trim(), String(category?.name ?? '').trim()])
            .filter(([id, name]) => id && name)
    );

    return getProductCategoryIds(product)
        .map((categoryId) => relationCategoryMap.get(categoryId) || fallbackCategoryMap.get(categoryId))
        .filter(Boolean);
}

export function formatCategorySummary(categoryNames = [], emptyLabel = 'Chưa gắn danh mục') {
    const normalizedNames = (Array.isArray(categoryNames) ? categoryNames : [])
        .map((name) => String(name ?? '').trim())
        .filter(Boolean);

    return normalizedNames.length > 0 ? normalizedNames.join(', ') : emptyLabel;
}
