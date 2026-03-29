import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blogApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const collator = new Intl.Collator('vi', { sensitivity: 'base' });

const DEFAULT_FILTERS = {
    category_id: 'all',
    uncategorized_only: 'all',
    seo_keyword: 'all',
    is_published: 'all',
    is_starred: 'all',
    is_system: 'all',
};

const normalizeKeywords = (items = []) => {
    const map = new Map();

    items.forEach((item) => {
        const raw = typeof item === 'string' ? item : item?.keyword;
        const keyword = String(raw || '').trim();
        if (!keyword) return;

        const key = keyword.toLowerCase();
        if (!map.has(key)) {
            map.set(key, { id: item?.id ?? null, keyword });
        }
    });

    return Array.from(map.values()).sort((a, b) => collator.compare(a.keyword, b.keyword));
};

const normalizeCategories = (items = []) => {
    const map = new Map();

    items.forEach((item) => {
        const id = Number(item?.id || 0);
        const name = String(item?.name || '').trim();
        const slug = String(item?.slug || '').trim();
        const sortOrder = Number(item?.sort_order || 0);

        if (!id || !name) return;
        map.set(id, { id, name, slug, sort_order: sortOrder });
    });

    return Array.from(map.values()).sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return collator.compare(a.name, b.name);
    });
};

const formatDate = (value) => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString('vi-VN');
};

const extractFilenameFromDisposition = (disposition, fallback) => {
    const raw = String(disposition || '');
    const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        try {
            return decodeURIComponent(utf8Match[1]);
        } catch {
            return utf8Match[1];
        }
    }

    const basicMatch = raw.match(/filename="?([^"]+)"?/i);
    return basicMatch?.[1] || fallback;
};

const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

const readBlobErrorPayload = async (blob) => {
    if (!(blob instanceof Blob)) {
        return { error: '', errors: [] };
    }

    try {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        return {
            error: parsed?.error || '',
            errors: Array.isArray(parsed?.errors) ? parsed.errors : [],
        };
    } catch {
        return { error: '', errors: [] };
    }
};

const BlogList = () => {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [importingBundle, setImportingBundle] = useState(false);
    const [exportingBundle, setExportingBundle] = useState(false);
    const [importResult, setImportResult] = useState(null);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [tempFilters, setTempFilters] = useState(DEFAULT_FILTERS);
    const [showFilterPanel, setShowFilterPanel] = useState(false);

    const [keywords, setKeywords] = useState([]);
    const [managedKeywords, setManagedKeywords] = useState([]);
    const [categories, setCategories] = useState([]);

    const [showKeywordModal, setShowKeywordModal] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [newKeywordLoading, setNewKeywordLoading] = useState(false);
    const [editingKeywordId, setEditingKeywordId] = useState(null);
    const [editingKeywordValue, setEditingKeywordValue] = useState('');

    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategorySlug, setNewCategorySlug] = useState('');
    const [newCategoryLoading, setNewCategoryLoading] = useState(false);
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [editingCategorySlug, setEditingCategorySlug] = useState('');

    const [selected, setSelected] = useState(new Set());
    const [bulkKeyword, setBulkKeyword] = useState('');
    const [bulkCategoryId, setBulkCategoryId] = useState('');

    const [draggingPostId, setDraggingPostId] = useState(null);
    const [dragOverPostId, setDragOverPostId] = useState(null);
    const [reorderingPosts, setReorderingPosts] = useState(false);

    const [draggingCategoryId, setDraggingCategoryId] = useState(null);
    const [dragOverCategoryId, setDragOverCategoryId] = useState(null);
    const [reorderingCategories, setReorderingCategories] = useState(false);

    const filterRef = useRef(null);
    const importInputRef = useRef(null);

    const navigate = useNavigate();
    const { showModal, showToast } = useUI();

    const keywordUsageMap = useMemo(() => {
        const map = new Map();
        posts.forEach((post) => {
            const key = String(post?.seo_keyword || '').trim().toLowerCase();
            if (!key) return;
            map.set(key, (map.get(key) || 0) + 1);
        });
        return map;
    }, [posts]);

    const categoryNameMap = useMemo(() => {
        const map = new Map();
        categories.forEach((category) => map.set(category.id, category.name));
        return map;
    }, [categories]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filters.category_id !== 'all') count += 1;
        if (filters.uncategorized_only !== 'all') count += 1;
        if (filters.seo_keyword !== 'all') count += 1;
        if (filters.is_published !== 'all') count += 1;
        if (filters.is_starred !== 'all') count += 1;
        if (filters.is_system !== 'all') count += 1;
        return count;
    }, [filters]);

    const reorderLocked = useMemo(
        () => search.trim() !== ''
            || filters.category_id !== 'all'
            || filters.uncategorized_only !== 'all'
            || filters.seo_keyword !== 'all'
            || filters.is_published !== 'all'
            || filters.is_starred !== 'all'
            || filters.is_system !== 'all',
        [search, filters]
    );

    const fetchPosts = useCallback(async () => {
        setLoading(true);
        try {
            const params = { per_page: 1000 };
            if (search.trim()) params.search = search.trim();
            if (filters.uncategorized_only === '1') {
                params.category_id = 'uncategorized';
            } else if (filters.category_id !== 'all') {
                params.category_id = filters.category_id;
            }
            if (filters.seo_keyword !== 'all') params.seo_keyword = filters.seo_keyword;
            if (filters.is_published !== 'all') params.is_published = filters.is_published;
            if (filters.is_starred !== 'all') params.is_starred = filters.is_starred;
            if (filters.is_system !== 'all') params.is_system = filters.is_system;

            const response = await blogApi.getAll(params);
            const list = Array.isArray(response.data?.data) ? response.data.data : [];
            const payloadKeywords = Array.isArray(response.data?.seo_keywords) ? response.data.seo_keywords : [];
            const payloadCategories = Array.isArray(response.data?.categories) ? response.data.categories : [];

            setPosts(list);
            const normalizedManagedKeywords = normalizeKeywords(payloadKeywords);
            setManagedKeywords(normalizedManagedKeywords);
            setKeywords(normalizeKeywords([
                ...normalizedManagedKeywords,
                ...list.map((post) => ({ keyword: post.seo_keyword })),
            ]));
            setCategories(normalizeCategories(payloadCategories));

            setSelected((prev) => {
                const valid = new Set(list.map((post) => post.id));
                return new Set([...prev].filter((id) => valid.has(id)));
            });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể tải danh sách bài viết.', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [filters, search, showModal]);

    const loadKeywords = useCallback(async () => {
        try {
            const response = await blogApi.getSeoKeywords();
            const items = Array.isArray(response.data?.data) ? response.data.data : [];
            const normalizedManagedKeywords = normalizeKeywords(items);
            setManagedKeywords(normalizedManagedKeywords);
            setKeywords(normalizeKeywords([
                ...normalizedManagedKeywords,
                ...posts.map((post) => ({ keyword: post.seo_keyword })),
            ]));
        } catch (error) {
            // no-op
        }
    }, [posts]);

    const loadCategories = useCallback(async () => {
        try {
            const response = await blogApi.getCategories();
            const items = Array.isArray(response.data?.data) ? response.data.data : [];
            setCategories(normalizeCategories(items));
        } catch (error) {
            // no-op
        }
    }, []);

    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!showFilterPanel) return;
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (
                filterRef.current
                && !filterRef.current.contains(target)
                && !target.closest('[data-blog-filter-btn]')
            ) {
                setShowFilterPanel(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showFilterPanel]);

    const postIds = useMemo(() => posts.map((post) => post.id), [posts]);
    const selectedCount = selected.size;
    const allChecked = postIds.length > 0 && postIds.every((id) => selected.has(id));

    const toggleOne = (id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        setSelected((prev) => {
            if (allChecked) {
                const next = new Set(prev);
                postIds.forEach((id) => next.delete(id));
                return next;
            }
            return new Set([...prev, ...postIds]);
        });
    };

    const submitSearch = (event) => {
        event.preventDefault();
        setSearch(searchInput);
    };

    const activeFilterTags = useMemo(() => {
        const tags = [];
        if (filters.category_id !== 'all') {
            const name = categoryNameMap.get(Number(filters.category_id)) || 'Danh mục';
            tags.push({ key: 'category_id', label: `Danh mục: ${name}` });
        }
        if (filters.uncategorized_only === '1') {
            tags.push({ key: 'uncategorized_only', label: 'Chỉ lấy bài chưa gắn danh mục' });
        }
        if (filters.seo_keyword !== 'all') {
            tags.push({ key: 'seo_keyword', label: `Từ khóa: ${filters.seo_keyword}` });
        }
        if (filters.is_published !== 'all') {
            tags.push({ key: 'is_published', label: `Trạng thái: ${filters.is_published === '1' ? 'Hiển thị' : 'Ẩn'}` });
        }
        if (filters.is_starred !== 'all') {
            tags.push({ key: 'is_starred', label: `Sao: ${filters.is_starred === '1' ? 'Có sao' : 'Không sao'}` });
        }
        if (filters.is_system !== 'all') {
            tags.push({ key: 'is_system', label: `Loại: ${filters.is_system === '1' ? 'Bài hệ thống' : 'Bài thường'}` });
        }
        return tags;
    }, [categoryNameMap, filters]);

    const toggleFilterPanel = () => {
        setShowFilterPanel((prev) => {
            const next = !prev;
            if (next) {
                setTempFilters(filters);
            }
            return next;
        });
    };

    const onTempFilterChange = (event) => {
        const { name, value } = event.target;
        setTempFilters((prev) => {
            const next = { ...prev, [name]: value };
            if (name === 'uncategorized_only' && value === '1') {
                next.category_id = 'all';
            }
            if (name === 'category_id' && value !== 'all') {
                next.uncategorized_only = 'all';
            }
            return next;
        });
    };

    const applyFilters = () => {
        setFilters({ ...tempFilters });
        setShowFilterPanel(false);
    };

    const resetFilters = () => {
        setTempFilters(DEFAULT_FILTERS);
        setFilters(DEFAULT_FILTERS);
    };

    const removeFilterTag = (key) => {
        setFilters((prev) => ({ ...prev, [key]: DEFAULT_FILTERS[key] }));
    };

    const updatePost = async (id, payload) => {
        try {
            await blogApi.update(id, payload);
            const hasCategoryUpdate = Object.prototype.hasOwnProperty.call(payload, 'blog_category_id');
            setPosts((prev) => prev.map((post) => (
                post.id === id
                    ? {
                        ...post,
                        ...payload,
                        category: hasCategoryUpdate
                            ? (
                                payload.blog_category_id
                                    ? {
                                        id: Number(payload.blog_category_id),
                                        name: categoryNameMap.get(Number(payload.blog_category_id)) || post.category?.name || '',
                                    }
                                    : null
                            )
                            : post.category,
                    }
                    : post
            )));
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật bài viết.', type: 'error' });
        }
    };

    const deletePost = (post) => {
        if (post?.is_system) {
            showModal({
                title: 'Không thể xóa',
                content: 'Bài hệ thống luôn phải tồn tại trong hệ thống. Bạn chỉ có thể chỉnh sửa nội dung.',
                type: 'warning',
            });
            return;
        }

        showModal({
            title: 'Xác nhận xóa',
            content: `Bạn có chắc muốn xóa bài "${post.title}"?`,
            type: 'warning',
            actionText: 'Xóa bài',
            onAction: async () => {
                try {
                    await blogApi.destroy(post.id);
                    setPosts((prev) => prev.filter((item) => item.id !== post.id));
                    setSelected((prev) => {
                        const next = new Set(prev);
                        next.delete(post.id);
                        return next;
                    });
                    showToast({ message: 'Đã xóa bài viết.', type: 'success' });
                } catch (error) {
                    showModal({ title: 'Lỗi', content: 'Không thể xóa bài viết.', type: 'error' });
                }
            },
        });
    };

    const createKeyword = async (event) => {
        event.preventDefault();
        const keyword = newKeyword.trim();
        if (!keyword) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập từ khóa SEO.', type: 'warning' });
            return;
        }

        setNewKeywordLoading(true);
        try {
            const response = await blogApi.createSeoKeyword({ keyword });
            const created = response.data?.keyword || keyword;
            setBulkKeyword(created);
            setNewKeyword('');
            await loadKeywords();
            await fetchPosts();
            showToast({ message: 'Đã thêm từ khóa SEO.', type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Không thể thêm từ khóa SEO.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setNewKeywordLoading(false);
        }
    };

    const startEditKeyword = (keywordItem) => {
        if (!keywordItem?.id) {
            showModal({ title: 'Lưu ý', content: 'Từ khóa này chưa có trong danh sách quản lý.', type: 'warning' });
            return;
        }
        setEditingKeywordId(keywordItem.id);
        setEditingKeywordValue(keywordItem.keyword);
    };

    const cancelEditKeyword = () => {
        setEditingKeywordId(null);
        setEditingKeywordValue('');
    };

    const saveKeyword = async () => {
        const keyword = editingKeywordValue.trim();
        if (!editingKeywordId || !keyword) {
            showModal({ title: 'Lưu ý', content: 'Từ khóa SEO không được để trống.', type: 'warning' });
            return;
        }

        const current = managedKeywords.find((item) => item.id === editingKeywordId);
        const oldKeyword = current?.keyword || '';

        setBusy(true);
        try {
            const response = await blogApi.updateSeoKeyword(editingKeywordId, { keyword });
            const nextKeyword = String(response.data?.keyword || keyword).trim();

            if (oldKeyword && filters.seo_keyword === oldKeyword) {
                setFilters((prev) => ({ ...prev, seo_keyword: nextKeyword }));
            }
            if (oldKeyword && tempFilters.seo_keyword === oldKeyword) {
                setTempFilters((prev) => ({ ...prev, seo_keyword: nextKeyword }));
            }
            if (oldKeyword && bulkKeyword === oldKeyword) {
                setBulkKeyword(nextKeyword);
            }

            cancelEditKeyword();
            await loadKeywords();
            await fetchPosts();
            showToast({ message: 'Đã cập nhật từ khóa SEO.', type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Không thể cập nhật từ khóa SEO.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const removeKeyword = (keywordItem) => {
        if (!keywordItem?.id) {
            showModal({ title: 'Lưu ý', content: 'Từ khóa này không có ID để xóa.', type: 'warning' });
            return;
        }

        showModal({
            title: 'Xóa từ khóa SEO',
            content: `Bạn có chắc muốn xóa từ khóa "${keywordItem.keyword}"? Các bài đang gắn từ khóa này sẽ được bỏ gắn.`,
            type: 'warning',
            actionText: 'Xóa',
            onAction: async () => {
                try {
                    await blogApi.deleteSeoKeyword(keywordItem.id);
                    if (filters.seo_keyword === keywordItem.keyword) {
                        setFilters((prev) => ({ ...prev, seo_keyword: 'all' }));
                    }
                    if (tempFilters.seo_keyword === keywordItem.keyword) {
                        setTempFilters((prev) => ({ ...prev, seo_keyword: 'all' }));
                    }
                    if (bulkKeyword === keywordItem.keyword) {
                        setBulkKeyword('');
                    }
                    await loadKeywords();
                    await fetchPosts();
                    showToast({ message: 'Đã xóa từ khóa SEO.', type: 'success' });
                } catch (error) {
                    const message = error?.response?.data?.error || 'Không thể xóa từ khóa SEO.';
                    showModal({ title: 'Lỗi', content: message, type: 'error' });
                }
            },
        });
    };

    const createCategory = async (event) => {
        event.preventDefault();
        const name = newCategoryName.trim();
        const slug = newCategorySlug.trim();
        if (!name) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập tên danh mục.', type: 'warning' });
            return;
        }

        setNewCategoryLoading(true);
        try {
            await blogApi.createCategory({ name, slug: slug || undefined });
            setNewCategoryName('');
            setNewCategorySlug('');
            await loadCategories();
            await fetchPosts();
            showToast({ message: 'Đã thêm danh mục bài viết.', type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Không thể thêm danh mục.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setNewCategoryLoading(false);
        }
    };

    const startEditCategory = (category) => {
        setEditingCategoryId(category.id);
        setEditingCategoryName(category.name);
        setEditingCategorySlug(category.slug || '');
    };

    const cancelEditCategory = () => {
        setEditingCategoryId(null);
        setEditingCategoryName('');
        setEditingCategorySlug('');
    };

    const saveCategory = async () => {
        const name = editingCategoryName.trim();
        const slug = editingCategorySlug.trim();
        if (!editingCategoryId || !name) {
            showModal({ title: 'Lưu ý', content: 'Tên danh mục không được để trống.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.updateCategory(editingCategoryId, { name, slug: slug || undefined });
            cancelEditCategory();
            await loadCategories();
            await fetchPosts();
            showToast({ message: 'Đã cập nhật danh mục.', type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Không thể cập nhật danh mục.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const removeCategory = (category) => {
        showModal({
            title: 'Xóa danh mục',
            content: `Bạn có chắc muốn xóa danh mục "${category.name}"? Các bài đang gắn sẽ trở về chưa phân loại.`,
            type: 'warning',
            actionText: 'Xóa',
            onAction: async () => {
                try {
                    await blogApi.deleteCategory(category.id);
                    await loadCategories();
                    await fetchPosts();
                    showToast({ message: 'Đã xóa danh mục.', type: 'success' });
                } catch (error) {
                    const message = error?.response?.data?.error || 'Không thể xóa danh mục.';
                    showModal({ title: 'Lỗi', content: message, type: 'error' });
                }
            },
        });
    };

    const bulkAssignKeyword = async () => {
        const ids = Array.from(selected);
        const keyword = bulkKeyword.trim();
        if (!ids.length) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn bài viết.', type: 'warning' });
            return;
        }
        if (!keyword) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn từ khóa SEO.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.bulkSeoKeyword({ ids, operation: 'assign', seo_keyword: keyword });
            setSelected(new Set());
            await fetchPosts();
            await loadKeywords();
            showToast({ message: `Đã gắn từ khóa cho ${ids.length} bài.`, type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể gắn từ khóa hàng loạt.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const bulkClearKeyword = async () => {
        const ids = Array.from(selected);
        if (!ids.length) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn bài viết.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.bulkSeoKeyword({ ids, operation: 'clear' });
            setSelected(new Set());
            await fetchPosts();
            showToast({ message: `Đã xóa từ khóa cho ${ids.length} bài.`, type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể xóa từ khóa hàng loạt.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const bulkAssignCategory = async () => {
        const ids = Array.from(selected);
        if (!ids.length) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn bài viết.', type: 'warning' });
            return;
        }
        if (!bulkCategoryId) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn danh mục để gắn.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.bulkCategory({
                ids,
                operation: 'assign',
                blog_category_id: Number(bulkCategoryId),
            });
            setSelected(new Set());
            await fetchPosts();
            showToast({ message: `Đã gắn danh mục cho ${ids.length} bài.`, type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Không thể gắn danh mục hàng loạt.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const bulkClearCategory = async () => {
        const ids = Array.from(selected);
        if (!ids.length) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn bài viết.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.bulkCategory({ ids, operation: 'clear' });
            setSelected(new Set());
            await fetchPosts();
            showToast({ message: `Đã xóa danh mục cho ${ids.length} bài.`, type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Không thể xóa danh mục hàng loạt.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const onPostDragStart = (event, postId) => {
        if (reorderLocked || reorderingPosts) return;
        setDraggingPostId(postId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(postId));
    };

    const onPostDragOver = (event, postId) => {
        if (reorderLocked || reorderingPosts) return;
        event.preventDefault();
        if (dragOverPostId !== postId) setDragOverPostId(postId);
    };

    const onPostDragEnd = () => {
        setDraggingPostId(null);
        setDragOverPostId(null);
    };

    const onPostDrop = async (event, targetId) => {
        if (reorderLocked || reorderingPosts) return;
        event.preventDefault();

        const sourceId = draggingPostId || Number(event.dataTransfer.getData('text/plain'));
        setDraggingPostId(null);
        setDragOverPostId(null);
        if (!sourceId || sourceId === targetId) return;

        const from = posts.findIndex((post) => post.id === sourceId);
        const to = posts.findIndex((post) => post.id === targetId);
        if (from < 0 || to < 0) return;

        const reordered = [...posts];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        setPosts(reordered);
        setReorderingPosts(true);

        try {
            await blogApi.reorder(reordered.map((post) => post.id));
            showToast({ message: 'Đã cập nhật thứ tự bài viết.', type: 'success', duration: 1200 });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể sắp xếp thứ tự bài viết.', type: 'error' });
            fetchPosts();
        } finally {
            setReorderingPosts(false);
        }
    };

    const onCategoryDragStart = (event, categoryId) => {
        if (reorderingCategories) return;
        setDraggingCategoryId(categoryId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(categoryId));
    };

    const onCategoryDragOver = (event, categoryId) => {
        if (reorderingCategories) return;
        event.preventDefault();
        if (dragOverCategoryId !== categoryId) setDragOverCategoryId(categoryId);
    };

    const onCategoryDragEnd = () => {
        setDraggingCategoryId(null);
        setDragOverCategoryId(null);
    };

    const onCategoryDrop = async (event, targetId) => {
        if (reorderingCategories) return;
        event.preventDefault();

        const sourceId = draggingCategoryId || Number(event.dataTransfer.getData('text/plain'));
        setDraggingCategoryId(null);
        setDragOverCategoryId(null);
        if (!sourceId || sourceId === targetId) return;

        const from = categories.findIndex((category) => category.id === sourceId);
        const to = categories.findIndex((category) => category.id === targetId);
        if (from < 0 || to < 0) return;

        const reordered = [...categories];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        setCategories(reordered);
        setReorderingCategories(true);

        try {
            await blogApi.reorderCategories(reordered.map((category) => category.id));
            showToast({ message: 'Đã cập nhật thứ tự danh mục.', type: 'success', duration: 1200 });
            await loadCategories();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể sắp xếp danh mục.', type: 'error' });
            loadCategories();
        } finally {
            setReorderingCategories(false);
        }
    };

    const openOnWeb = (post) => {
        const slugOrId = post.slug || post.id;
        window.open(`${window.location.origin}/blog/${slugOrId}`, '_blank', 'noopener,noreferrer');
    };

    const triggerImportPicker = () => {
        importInputRef.current?.click?.();
    };

    const handleExportBundle = async (ids = [], fallbackName = 'blog-export.zip') => {
        setExportingBundle(true);

        try {
            const payload = ids.length > 0 ? { ids } : {};
            const response = await blogApi.exportBundle(payload);
            const filename = extractFilenameFromDisposition(
                response.headers?.['content-disposition'],
                fallbackName
            );

            downloadBlob(response.data, filename);
            showToast({
                message: ids.length > 0
                    ? `Đã tải gói export cho ${ids.length} bài viết.`
                    : 'Đã tải gói export toàn bộ bài viết.',
                type: 'success',
            });
        } catch (error) {
            const blobPayload = await readBlobErrorPayload(error?.response?.data);
            const message = blobPayload.error
                || blobPayload.errors?.[0]
                || 'Không thể export bài viết lúc này.';
            showModal({ title: 'Lỗi export', content: message, type: 'error' });
        } finally {
            setExportingBundle(false);
        }
    };

    const handleImportBundleChange = async (event) => {
        const file = event.target.files?.[0] || null;
        event.target.value = '';

        if (!file) {
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        setImportingBundle(true);
        try {
            const response = await blogApi.importBundle(formData);
            const payload = response.data || {};
            setImportResult(payload);
            setSelected(new Set());
            await fetchPosts();
            await loadCategories();
            await loadKeywords();
            showModal({
                title: 'Import thành công',
                content: `Đã import ${payload.created ?? 0} bài mới và cập nhật ${payload.updated ?? 0} bài hệ thống.`,
                type: 'success',
            });
        } catch (error) {
            const payload = error?.response?.data || {};
            const errors = Array.isArray(payload?.errors) ? payload.errors : [];
            setImportResult({
                total_rows: 0,
                created: 0,
                updated: 0,
                categories_created: 0,
                assets_imported: 0,
                errors,
            });
            showModal({
                title: 'Lỗi import',
                content: payload?.error || errors[0] || 'Không thể import gói Excel lúc này.',
                type: 'error',
            });
        } finally {
            setImportingBundle(false);
        }
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] p-6 gap-3 overflow-hidden">
            <input
                ref={importInputRef}
                type="file"
                accept=".zip"
                onChange={handleImportBundleChange}
                className="hidden"
            />
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">Bài viết trên web</h1>
                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.16em]">Quản lý bài viết gọn, nhanh cho kho nội dung lớn</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => handleExportBundle([], 'blog-export-all.zip')}
                        disabled={exportingBundle || importingBundle}
                        className="h-9 px-4 bg-white border border-gold/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center disabled:opacity-60"
                    >
                        {exportingBundle ? 'Đang xuất...' : 'Xuất tất cả'}
                    </button>
                    <button
                        type="button"
                        onClick={triggerImportPicker}
                        disabled={importingBundle || exportingBundle}
                        className="h-9 px-4 bg-white border border-gold/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center disabled:opacity-60"
                    >
                        {importingBundle ? 'Đang import...' : 'Nhập gói Excel'}
                    </button>
                    <Link to="/admin/blog/new" className="h-9 px-4 bg-brick text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center">Tạo bài mới</Link>
                </div>
            </div>

            <div className="bg-white border border-gold/10 rounded-sm shadow-sm p-3 space-y-3">
                <div className="flex flex-col xl:flex-row xl:items-center gap-2">
                    <form onSubmit={submitSearch} className="flex-1 flex gap-2 min-w-[260px]">
                        <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Tìm theo tiêu đề, slug, nội dung..." className="h-9 flex-1 bg-stone/5 border border-gold/15 px-3 text-[13px] text-primary focus:outline-none focus:border-primary rounded-sm" />
                        <button type="submit" className="h-9 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber">Tìm</button>
                    </form>

                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative" ref={filterRef}>
                            <button
                                type="button"
                                data-blog-filter-btn
                                onClick={toggleFilterPanel}
                                className={`h-9 px-3 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5 border ${showFilterPanel || activeFilterCount > 0 ? 'bg-primary text-white border-primary' : 'bg-white text-primary border-primary/25 hover:bg-primary/5'}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">filter_alt</span>
                                Bộ lọc
                                {activeFilterCount > 0 && (
                                    <span className="h-5 min-w-[20px] px-1 rounded-full bg-white/20 text-white text-[10px] inline-flex items-center justify-center">
                                        {activeFilterCount}
                                    </span>
                                )}
                            </button>

                            {showFilterPanel && (
                                <div className="absolute right-0 top-full mt-2 w-[330px] bg-white border border-primary/20 shadow-2xl rounded-sm p-3 z-40 space-y-3">
                                    <div className="flex items-center justify-between border-b border-primary/10 pb-2">
                                        <div className="text-[12px] font-black uppercase tracking-widest text-primary">Bộ lọc bài viết</div>
                                        <button type="button" onClick={resetFilters} className="text-[10px] font-bold uppercase tracking-widest text-stone/50 hover:text-brick">Reset</button>
                                    </div>

                                    <div className="space-y-2.5">
                                        <div>
                                            <label className="block text-[10px] font-black uppercase tracking-widest text-stone/50 mb-1">Danh mục</label>
                                            <select name="category_id" value={tempFilters.category_id} onChange={onTempFilterChange} disabled={tempFilters.uncategorized_only === '1'} className="h-9 w-full bg-stone/5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm disabled:opacity-55">
                                                <option value="all">Tất cả danh mục</option>
                                                {categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-black uppercase tracking-widest text-stone/50 mb-1">Bài chưa gắn danh mục</label>
                                            <select name="uncategorized_only" value={tempFilters.uncategorized_only} onChange={onTempFilterChange} className="h-9 w-full bg-stone/5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                                                <option value="all">Tất cả</option>
                                                <option value="1">Chỉ lấy bài chưa gắn danh mục</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-black uppercase tracking-widest text-stone/50 mb-1">Từ khóa SEO</label>
                                            <select name="seo_keyword" value={tempFilters.seo_keyword} onChange={onTempFilterChange} className="h-9 w-full bg-stone/5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                                                <option value="all">Tất cả từ khóa</option>
                                                {keywords.map((item) => <option key={item.keyword} value={item.keyword}>{item.keyword}</option>)}
                                            </select>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-widest text-stone/50 mb-1">Trạng thái</label>
                                                <select name="is_published" value={tempFilters.is_published} onChange={onTempFilterChange} className="h-9 w-full bg-stone/5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                                                    <option value="all">Tất cả</option>
                                                    <option value="1">Hiển thị</option>
                                                    <option value="0">Ẩn</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-widest text-stone/50 mb-1">Đánh dấu sao</label>
                                                <select name="is_starred" value={tempFilters.is_starred} onChange={onTempFilterChange} className="h-9 w-full bg-stone/5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                                                    <option value="all">Tất cả</option>
                                                    <option value="1">Có sao</option>
                                                    <option value="0">Không sao</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-black uppercase tracking-widest text-stone/50 mb-1">Loại bài</label>
                                            <select name="is_system" value={tempFilters.is_system} onChange={onTempFilterChange} className="h-9 w-full bg-stone/5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                                                <option value="all">Tất cả bài viết</option>
                                                <option value="1">Chỉ bài hệ thống</option>
                                                <option value="0">Chỉ bài thường</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-end gap-2 pt-1">
                                        <button type="button" onClick={() => setShowFilterPanel(false)} className="h-8 px-3 bg-white border border-gold/20 rounded-sm text-[10px] font-bold uppercase tracking-widest text-stone/60">Đóng</button>
                                        <button type="button" onClick={applyFilters} className="h-8 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest">Áp dụng</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button type="button" onClick={async () => { setShowCategoryModal(true); await loadCategories(); }} className="h-9 px-3 bg-white border border-primary/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest">Quản lý danh mục</button>
                        <button type="button" onClick={async () => { setShowKeywordModal(true); await loadKeywords(); }} className="h-9 px-3 bg-white border border-primary/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest">Quản lý từ khóa SEO</button>
                        <button type="button" onClick={fetchPosts} disabled={loading} className="h-9 w-9 inline-flex items-center justify-center bg-white border border-gold/20 text-stone/70 hover:text-primary rounded-sm disabled:opacity-60" title="Làm mới">
                            <span className={`material-symbols-outlined text-[17px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                </div>

                {activeFilterTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 bg-primary/5 border border-primary/15 rounded-sm p-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">Đang lọc</span>
                        {activeFilterTags.map((tag) => (
                            <div key={tag.key} className="inline-flex items-center gap-1 bg-white border border-primary/20 rounded-sm px-2 py-1">
                                <span className="text-[10px] font-semibold text-primary">{tag.label}</span>
                                <button type="button" onClick={() => removeFilterTag(tag.key)} className="text-primary/50 hover:text-brick inline-flex items-center">
                                    <span className="material-symbols-outlined text-[13px]">close</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {importResult && (
                    <div className="border border-gold/15 bg-gold/5 rounded-sm p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-widest text-primary">
                            <span>Kết quả import</span>
                            <span>Tổng dòng: {importResult.total_rows ?? 0}</span>
                            <span>Tạo mới: {importResult.created ?? 0}</span>
                            <span>Cập nhật: {importResult.updated ?? 0}</span>
                            <span>Danh mục mới: {importResult.categories_created ?? 0}</span>
                            <span>Ảnh đã nạp: {importResult.assets_imported ?? 0}</span>
                        </div>
                        {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
                            <div className="space-y-1">
                                {importResult.errors.slice(0, 12).map((item, idx) => (
                                    <div key={`${item}-${idx}`} className="text-[12px] text-brick">{item}</div>
                                ))}
                                {importResult.errors.length > 12 && (
                                    <div className="text-[11px] text-stone/55 italic">Còn {importResult.errors.length - 12} lỗi khác trong gói import.</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-stone/45">{posts.length} bài</div>
                    {selectedCount > 0 && (
                        <button type="button" onClick={() => setSelected(new Set())} className="h-8 px-3 bg-white border border-gold/20 text-stone/60 rounded-sm text-[10px] font-bold uppercase tracking-widest hover:text-brick">Bỏ chọn</button>
                    )}
                </div>

                {selectedCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2 bg-primary/5 border border-primary/15 rounded-sm p-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">Đã chọn {selectedCount} bài</span>

                        <button
                            type="button"
                            onClick={() => handleExportBundle(Array.from(selected), `blog-export-${selectedCount}-posts.zip`)}
                            disabled={busy || exportingBundle || importingBundle}
                            className="h-8 px-3 bg-white border border-primary/25 text-primary rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-primary/5 disabled:opacity-60"
                        >
                            {exportingBundle ? 'Đang xuất...' : 'Xuất đã chọn'}
                        </button>
                        <select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)} className="h-8 min-w-[200px] bg-white border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                            <option value="">Chọn danh mục</option>
                            {categories.map((category) => <option key={`bulk-cat-${category.id}`} value={String(category.id)}>{category.name}</option>)}
                        </select>
                        <button type="button" onClick={bulkAssignCategory} disabled={busy} className="h-8 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber disabled:opacity-60">Gắn danh mục</button>
                        <button type="button" onClick={bulkClearCategory} disabled={busy} className="h-8 px-3 bg-white border border-brick/25 text-brick rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-brick/5 disabled:opacity-60">Xóa danh mục</button>

                        <select value={bulkKeyword} onChange={(e) => setBulkKeyword(e.target.value)} className="h-8 min-w-[200px] bg-white border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                            <option value="">Chọn từ khóa SEO</option>
                            {keywords.map((item) => <option key={`bulk-key-${item.keyword}`} value={item.keyword}>{item.keyword}</option>)}
                        </select>
                        <button type="button" onClick={bulkAssignKeyword} disabled={busy} className="h-8 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber disabled:opacity-60">Gắn từ khóa</button>
                        <button type="button" onClick={bulkClearKeyword} disabled={busy} className="h-8 px-3 bg-white border border-brick/25 text-brick rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-brick/5 disabled:opacity-60">Xóa từ khóa</button>
                    </div>
                )}

                {reorderLocked && (
                    <div className="text-[10px] text-stone/55 italic">Kéo thả sắp xếp bài viết chỉ hoạt động khi không tìm kiếm/bộ lọc.</div>
                )}
            </div>

            <div className="flex-1 overflow-auto bg-white border border-gold/10 rounded-sm shadow-sm">
                <table className="w-full min-w-[1260px] border-collapse">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] border-b border-gold/20">
                        <tr>
                            <th className="w-[44px] py-2"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-primary cursor-pointer" /></th>
                            <th className="w-[52px] text-[10px] uppercase tracking-widest text-primary">Kéo</th>
                            <th className="w-[74px] text-[10px] uppercase tracking-widest text-primary">Ảnh</th>
                            <th className="px-2 text-left text-[10px] uppercase tracking-widest text-primary">Bài viết</th>
                            <th className="w-[250px] text-left text-[10px] uppercase tracking-widest text-primary">Danh mục</th>
                            <th className="w-[116px] text-[10px] uppercase tracking-widest text-primary">Trạng thái</th>
                            <th className="w-[86px] text-[10px] uppercase tracking-widest text-primary">Sao</th>
                            <th className="w-[116px] text-[10px] uppercase tracking-widest text-primary">Ngày</th>
                            <th className="w-[220px] text-right pr-3 text-[10px] uppercase tracking-widest text-primary">Tác vụ</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading && (
                            <tr><td colSpan="9" className="py-14 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div></td></tr>
                        )}
                        {!loading && posts.length === 0 && (
                            <tr><td colSpan="9" className="py-14 text-center text-stone/45 font-bold uppercase tracking-widest text-xs">Không có bài viết nào</td></tr>
                        )}
                        {!loading && posts.map((post) => (
                            <tr key={post.id} onDragOver={(e) => onPostDragOver(e, post.id)} onDrop={(e) => onPostDrop(e, post.id)} className={`${draggingPostId === post.id ? 'bg-primary/5' : dragOverPostId === post.id ? 'bg-gold/10' : 'hover:bg-gold/5'}`}>
                                <td className="text-center py-2"><input type="checkbox" checked={selected.has(post.id)} onChange={() => toggleOne(post.id)} className="h-4 w-4 accent-primary cursor-pointer" /></td>
                                <td className="text-center">
                                    <button type="button" draggable={!reorderLocked && !reorderingPosts} onDragStart={(e) => onPostDragStart(e, post.id)} onDragEnd={onPostDragEnd} className={`h-7 w-7 inline-flex items-center justify-center rounded-sm border ${reorderLocked ? 'border-stone/15 text-stone/25' : 'border-gold/20 text-stone/50 hover:text-primary'}`} title={reorderLocked ? 'Tắt bộ lọc để kéo thả' : 'Kéo thả sắp xếp'}>
                                        <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
                                    </button>
                                </td>
                                <td><div className="w-12 h-12 mx-auto bg-stone/10 border border-gold/20 rounded-sm overflow-hidden"><img src={post.featured_image || 'https://placehold.co/120x120?text=No+Img'} alt={post.title} className="w-full h-full object-cover" /></div></td>
                                <td className="px-2 py-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => navigate(`/admin/blog/edit/${post.id}`)} className="block max-w-full text-left text-[14px] font-bold text-primary hover:text-brick truncate" title={post.title}>{post.title}</button>
                                        {post.is_system && (
                                            <span className="inline-flex items-center rounded-sm border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                                                Bài hệ thống
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-stone/45 uppercase tracking-wider truncate">slug: {post.slug || '--'}</div>
                                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 border border-gold/25 bg-gold/5 text-umber rounded-sm">{post.seo_keyword || 'Chưa gắn từ khóa'}</span>
                                </td>
                                <td className="px-2 py-2">
                                    <div className="flex flex-col gap-1">
                                        <select value={post.blog_category_id ? String(post.blog_category_id) : ''} onChange={(e) => updatePost(post.id, { blog_category_id: e.target.value ? Number(e.target.value) : null })} className="h-8 w-full bg-white border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                                            <option value="">Chưa gắn danh mục</option>
                                            {categories.map((category) => <option key={`row-cat-${category.id}`} value={String(category.id)}>{category.name}</option>)}
                                        </select>
                                        <span className="text-[10px] text-stone/55">{post.category?.name || 'Không có danh mục'}</span>
                                    </div>
                                </td>
                                <td className="text-center">
                                    <button type="button" onClick={() => updatePost(post.id, { is_published: !post.is_published })} className={`h-7 px-3 rounded-sm text-[10px] font-black uppercase tracking-widest border ${post.is_published ? 'bg-primary text-white border-primary' : 'bg-white text-stone/60 border-gold/20'}`}>{post.is_published ? 'Hiển thị' : 'Ẩn'}</button>
                                </td>
                                <td className="text-center">
                                    <button type="button" onClick={() => updatePost(post.id, { is_starred: !post.is_starred })} className={`h-8 w-8 inline-flex items-center justify-center rounded-full border ${post.is_starred ? 'bg-gold/15 border-gold/40 text-gold' : 'bg-white border-gold/20 text-stone/40'}`} title={post.is_starred ? 'Bỏ sao' : 'Gắn sao'}>
                                        <span className="material-symbols-outlined text-[18px]">{post.is_starred ? 'star' : 'star_outline'}</span>
                                    </button>
                                </td>
                                <td className="text-center text-[12px] text-stone/80">{formatDate(post.published_at || post.created_at)}</td>
                                <td className="pr-3">
                                    <div className="flex items-center justify-end gap-1">
                                        <button type="button" onClick={() => openOnWeb(post)} className="h-8 px-2.5 border border-gold/20 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest">Xem ngoài web</button>
                                        <button
                                            type="button"
                                            onClick={() => handleExportBundle([post.id], `blog-export-${post.slug || post.id}.zip`)}
                                            disabled={exportingBundle || importingBundle}
                                            className="h-8 px-2.5 border border-gold/20 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-60"
                                        >
                                            Xuất
                                        </button>
                                        <button type="button" onClick={() => navigate(`/admin/blog/edit/${post.id}`)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 text-stone/60 hover:text-primary rounded-sm" title="Sửa"><span className="material-symbols-outlined text-[16px]">edit_square</span></button>
                                        {post.is_system ? (
                                            <button type="button" disabled className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 bg-stone/5 text-stone/25 rounded-sm cursor-not-allowed" title="Bài hệ thống không thể xóa"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                        ) : (
                                            <button type="button" onClick={() => deletePost(post)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 text-stone/60 hover:text-brick rounded-sm" title="Xóa"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showCategoryModal && (
                <div className="fixed inset-0 z-[80] bg-primary/35 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={() => { setShowCategoryModal(false); cancelEditCategory(); }}>
                    <div className="w-full max-w-4xl bg-white border border-gold/20 rounded-sm shadow-2xl max-h-[86vh] overflow-hidden flex flex-col" onClick={(event) => event.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-gold/15 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[16px] font-bold text-primary uppercase tracking-wide">Quản lý danh mục bài viết</h3>
                                <p className="text-[10px] text-stone/50 uppercase tracking-widest">Kéo thả để sắp xếp thứ tự hiển thị ngoài frontend</p>
                            </div>
                            <button type="button" onClick={() => { setShowCategoryModal(false); cancelEditCategory(); }} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-brick">
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <div className="p-4 space-y-3 overflow-hidden flex-1 min-h-0">
                            <form onSubmit={createCategory} className="grid grid-cols-1 md:grid-cols-12 gap-2 bg-stone/5 border border-gold/15 p-2 rounded-sm">
                                <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Tên danh mục..." className="h-9 md:col-span-5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm" />
                                <input value={newCategorySlug} onChange={(e) => setNewCategorySlug(e.target.value)} placeholder="slug (tùy chọn)" className="h-9 md:col-span-5 border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm" />
                                <button type="submit" disabled={newCategoryLoading} className="h-9 md:col-span-2 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-60">
                                    {newCategoryLoading ? 'Đang lưu...' : 'Thêm danh mục'}
                                </button>
                            </form>

                            <div className="text-[10px] text-stone/55 italic">Danh sách danh mục ({categories.length})</div>

                            <div className="space-y-1.5 overflow-auto pr-1 max-h-[52vh]">
                                {categories.length === 0 && <div className="text-[12px] text-stone/60 italic">Chưa có danh mục nào.</div>}
                                {categories.map((category) => {
                                    const editing = editingCategoryId === category.id;
                                    return (
                                        <div key={category.id} draggable={!editing && !reorderingCategories} onDragStart={(e) => onCategoryDragStart(e, category.id)} onDragOver={(e) => onCategoryDragOver(e, category.id)} onDrop={(e) => onCategoryDrop(e, category.id)} onDragEnd={onCategoryDragEnd} className={`bg-white border px-2 py-1.5 rounded-sm flex items-center gap-2 ${dragOverCategoryId === category.id ? 'border-gold/50 bg-gold/5' : 'border-gold/15'}`}>
                                            <span className="material-symbols-outlined text-[16px] text-stone/45 cursor-grab">drag_indicator</span>
                                            {editing ? (
                                                <>
                                                    <input value={editingCategoryName} onChange={(e) => setEditingCategoryName(e.target.value)} className="h-8 flex-1 min-w-[120px] border border-gold/20 px-2 text-[12px] text-primary rounded-sm focus:outline-none focus:border-primary" />
                                                    <input value={editingCategorySlug} onChange={(e) => setEditingCategorySlug(e.target.value)} className="h-8 w-[180px] border border-gold/20 px-2 text-[12px] text-primary rounded-sm focus:outline-none focus:border-primary" />
                                                    <button type="button" onClick={saveCategory} className="h-8 px-2.5 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest">Lưu</button>
                                                    <button type="button" onClick={cancelEditCategory} className="h-8 px-2.5 border border-gold/20 text-stone/70 rounded-sm text-[10px] font-bold uppercase tracking-widest">Bỏ</button>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[12px] text-primary font-semibold truncate">{category.name}</div>
                                                        <div className="text-[10px] text-stone/50 truncate">/{category.slug}</div>
                                                    </div>
                                                    <button type="button" onClick={() => startEditCategory(category)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-primary"><span className="material-symbols-outlined text-[15px]">edit</span></button>
                                                    <button type="button" onClick={() => removeCategory(category)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-brick"><span className="material-symbols-outlined text-[15px]">delete</span></button>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showKeywordModal && (
                <div className="fixed inset-0 z-[80] bg-primary/35 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={() => { setShowKeywordModal(false); cancelEditKeyword(); }}>
                    <div className="w-full max-w-3xl bg-white border border-gold/20 rounded-sm shadow-2xl max-h-[86vh] overflow-hidden flex flex-col" onClick={(event) => event.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-gold/15 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[16px] font-bold text-primary uppercase tracking-wide">Quản lý từ khóa SEO</h3>
                                <p className="text-[10px] text-stone/50 uppercase tracking-widest">Thêm, sửa, xóa danh sách từ khóa dùng cho bài viết</p>
                            </div>
                            <button type="button" onClick={() => { setShowKeywordModal(false); cancelEditKeyword(); }} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-brick">
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <div className="p-4 space-y-3 overflow-hidden flex-1 min-h-0">
                            <form onSubmit={createKeyword} className="flex items-center gap-2 bg-stone/5 border border-gold/15 p-2 rounded-sm">
                                <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Nhập từ khóa SEO mới..." className="h-9 flex-1 bg-white border border-gold/20 px-3 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm" />
                                <button type="submit" disabled={newKeywordLoading} className="h-9 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber disabled:opacity-60">{newKeywordLoading ? 'Đang lưu...' : 'Thêm'}</button>
                            </form>

                            <div className="text-[10px] text-stone/55 italic">Danh sách từ khóa ({managedKeywords.length})</div>

                            <div className="space-y-1.5 overflow-auto pr-1 max-h-[52vh]">
                                {managedKeywords.length === 0 && <div className="text-[12px] text-stone/60 italic">Chưa có từ khóa nào trong danh sách quản lý.</div>}
                                {managedKeywords.map((item) => {
                                    const editing = editingKeywordId === item.id;
                                    const usage = keywordUsageMap.get(item.keyword.toLowerCase()) || 0;

                                    return (
                                        <div key={item.id || item.keyword} className="bg-white border border-gold/15 px-2 py-1.5 rounded-sm flex items-center gap-2">
                                            {editing ? (
                                                <>
                                                    <input value={editingKeywordValue} onChange={(e) => setEditingKeywordValue(e.target.value)} className="h-8 flex-1 border border-gold/20 px-2 text-[12px] text-primary rounded-sm focus:outline-none focus:border-primary" />
                                                    <button type="button" onClick={saveKeyword} className="h-8 px-2.5 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest">Lưu</button>
                                                    <button type="button" onClick={cancelEditKeyword} className="h-8 px-2.5 border border-gold/20 text-stone/70 rounded-sm text-[10px] font-bold uppercase tracking-widest">Bỏ</button>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[12px] text-primary font-semibold truncate">{item.keyword}</div>
                                                        <div className="text-[10px] text-stone/50">Đang được dùng trong {usage} bài</div>
                                                    </div>
                                                    <button type="button" onClick={() => startEditKeyword(item)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-primary" title="Sửa"><span className="material-symbols-outlined text-[15px]">edit</span></button>
                                                    <button type="button" onClick={() => removeKeyword(item)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-brick" title="Xóa"><span className="material-symbols-outlined text-[15px]">delete</span></button>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BlogList;
