import React, { useEffect, useMemo, useState } from 'react';
import { categoryApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const makeClientId = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const slugify = (value) => (
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0111/g, 'd')
        .replace(/\u0110/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
);

const nodeKey = (node) => node?.client_id || (node?.id ? `id:${node.id}` : '');

const normalizeNode = (node = {}, index = 0) => {
    const key = node.id ? `id:${node.id}` : (node.client_id || makeClientId());
    const title = node.title || node.name || '';

    return {
        id: node.id || null,
        client_id: key,
        parent_key: node.parent_key || (node.parent_id ? `id:${node.parent_id}` : ''),
        title,
        slug: node.slug || slugify(title),
        status: node.status !== false,
        sort_order: Number.isFinite(Number(node.sort_order)) ? Number(node.sort_order) : index,
        category_ids: Array.isArray(node.category_ids)
            ? node.category_ids.map((id) => Number(id)).filter(Boolean)
            : [],
    };
};

const sourceLabel = (category) => [
    category?.account_name || category?.site_code || `Account #${category?.account_id || ''}`,
    category?.store_name,
].filter(Boolean).join(' / ');

const PublicCategoryTreeModal = ({ open, onClose, domains = [] }) => {
    const { showToast } = useUI();
    const [selectedDomainId, setSelectedDomainId] = useState('');
    const [sourceCategories, setSourceCategories] = useState([]);
    const [nodes, setNodes] = useState([]);
    const [activeNodeKey, setActiveNodeKey] = useState('');
    const [sourceSearch, setSourceSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const domainOptions = useMemo(() => (
        Array.isArray(domains) ? domains.filter((domain) => domain?.id) : []
    ), [domains]);

    const sourceCategoryById = useMemo(() => new Map(
        sourceCategories.map((category) => [Number(category.id), category])
    ), [sourceCategories]);

    const activeNode = useMemo(() => (
        nodes.find((node) => nodeKey(node) === activeNodeKey) || null
    ), [activeNodeKey, nodes]);

    const mappedCategoryIds = useMemo(() => new Set(
        nodes.flatMap((node) => node.category_ids || []).map((id) => Number(id))
    ), [nodes]);

    const filteredSources = useMemo(() => {
        const keyword = sourceSearch.trim().toLowerCase();

        if (!keyword) {
            return sourceCategories;
        }

        return sourceCategories.filter((category) => [
            category.name,
            category.slug,
            category.account_name,
            category.site_code,
            category.store_name,
        ].filter(Boolean).join(' ').toLowerCase().includes(keyword));
    }, [sourceCategories, sourceSearch]);

    useEffect(() => {
        if (!open) {
            return;
        }

        if (!selectedDomainId && domainOptions.length > 0) {
            setSelectedDomainId(String(domainOptions[0].id));
        }
    }, [domainOptions, open, selectedDomainId]);

    useEffect(() => {
        if (!activeNodeKey) {
            return;
        }

        if (!nodes.some((node) => nodeKey(node) === activeNodeKey)) {
            setActiveNodeKey('');
        }
    }, [activeNodeKey, nodes]);

    useEffect(() => {
        if (!open || !selectedDomainId) {
            return;
        }

        let cancelled = false;
        setLoading(true);
        categoryApi.publicTree.get(selectedDomainId)
            .then((response) => {
                if (cancelled) {
                    return;
                }

                setSourceCategories(Array.isArray(response.data?.source_categories) ? response.data.source_categories : []);
                setNodes((Array.isArray(response.data?.nodes) ? response.data.nodes : []).map(normalizeNode));
                setActiveNodeKey('');
            })
            .catch((error) => {
                console.error('Failed to load public category tree', error);
                showToast({ message: 'Không tải được cây danh mục public.', type: 'error' });
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, selectedDomainId, showToast]);

    if (!open) {
        return null;
    }

    const addBlankNode = () => {
        const title = 'Danh mục public mới';
        const nextNode = normalizeNode({
            client_id: makeClientId(),
            title,
            slug: `${slugify(title)}-${nodes.length + 1}`,
            category_ids: [],
        }, nodes.length);

        setNodes((current) => [...current, nextNode]);
        setActiveNodeKey(nextNode.client_id);
    };

    const addSourceCategory = (category) => {
        const categoryId = Number(category.id);
        if (!categoryId) {
            return;
        }

        if (activeNode) {
            setNodes((current) => current.map((node) => (
                nodeKey(node) === activeNodeKey
                    ? { ...node, category_ids: Array.from(new Set([...(node.category_ids || []), categoryId])) }
                    : node
            )));
            return;
        }

        const nextNode = normalizeNode({
            client_id: makeClientId(),
            title: category.name,
            slug: category.slug || slugify(category.name),
            category_ids: [categoryId],
        }, nodes.length);

        setNodes((current) => [...current, nextNode]);
        setActiveNodeKey(nextNode.client_id);
    };

    const mergeSameNameSources = () => {
        const groups = new Map();
        const groupKeyByCategoryId = new Map();
        sourceCategories.forEach((category) => {
            const key = slugify(category.name);
            if (!key) {
                return;
            }
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(category);
            groupKeyByCategoryId.set(Number(category.id), key);
        });

        const nodeKeyByGroupKey = new Map();
        const groupedNodes = Array.from(groups.entries())
            .filter(([, items]) => items.length > 0)
            .map(([groupKey, items], index) => {
                const node = normalizeNode({
                    client_id: makeClientId(),
                    title: items[0].name,
                    slug: items[0].slug || slugify(items[0].name),
                    category_ids: items.map((item) => Number(item.id)).filter(Boolean),
                }, index);
                nodeKeyByGroupKey.set(groupKey, nodeKey(node));

                return {
                    ...node,
                    _groupKey: groupKey,
                    _sourceItems: items,
                };
            });

        const nextNodes = groupedNodes.map(({ _groupKey: groupKey, _sourceItems: sourceItems, ...node }) => {
            const parentGroupKey = (sourceItems || [])
                .map((item) => groupKeyByCategoryId.get(Number(item.parent_id)))
                .find((candidate) => candidate && candidate !== groupKey && nodeKeyByGroupKey.has(candidate));

            return {
                ...node,
                parent_key: parentGroupKey ? nodeKeyByGroupKey.get(parentGroupKey) : '',
            };
        });

        if (nextNodes.length === 0 && sourceCategories.length > 0) {
            const fallbackNodes = sourceCategories.map((category, index) => normalizeNode({
                client_id: makeClientId(),
                title: category.name,
                slug: category.slug || slugify(category.name),
                category_ids: [Number(category.id)].filter(Boolean),
            }, index));

            setNodes(fallbackNodes);
            setActiveNodeKey(fallbackNodes[0]?.client_id || '');
            return;
        }

        setNodes(nextNodes);
        setActiveNodeKey(nextNodes[0]?.client_id || '');
    };

    const updateNode = (key, updates) => {
        setNodes((current) => current.map((node) => (
            nodeKey(node) === key ? { ...node, ...updates } : node
        )));
    };

    const removeNode = (key) => {
        setNodes((current) => current
            .filter((node) => nodeKey(node) !== key)
            .map((node) => (node.parent_key === key ? { ...node, parent_key: '' } : node)));
    };

    const removeCategoryFromNode = (key, categoryId) => {
        setNodes((current) => current.map((node) => (
            nodeKey(node) === key
                ? { ...node, category_ids: (node.category_ids || []).filter((id) => Number(id) !== Number(categoryId)) }
                : node
        )));
    };

    const moveNodeToPosition = (key, rawPosition) => {
        const normalizedPosition = String(rawPosition).trim();
        if (normalizedPosition === '') {
            return;
        }

        const targetPosition = Number(normalizedPosition);
        if (!Number.isFinite(targetPosition)) {
            return;
        }

        setNodes((current) => {
            const currentIndex = current.findIndex((node) => nodeKey(node) === key);
            if (currentIndex < 0) {
                return current;
            }

            const targetIndex = Math.min(
                Math.max(Math.trunc(targetPosition) - 1, 0),
                current.length - 1
            );
            if (targetIndex === currentIndex) {
                return current;
            }

            const next = [...current];
            const [movedNode] = next.splice(currentIndex, 1);
            next.splice(targetIndex, 0, movedNode);
            return next;
        });
    };

    const saveTree = async () => {
        if (!selectedDomainId) {
            return;
        }

        const previousKeys = new Set();
        const payloadNodes = nodes.map((node, index) => {
            const key = nodeKey(node);
            const parentKey = previousKeys.has(node.parent_key) ? node.parent_key : '';
            previousKeys.add(key);

            return {
                id: node.id || null,
                client_id: key,
                parent_key: parentKey,
                title: node.title,
                slug: node.slug,
                status: node.status,
                sort_order: index,
                category_ids: node.category_ids || [],
            };
        });

        setSaving(true);
        try {
            const response = await categoryApi.publicTree.update(selectedDomainId, { nodes: payloadNodes });
            setNodes((Array.isArray(response.data?.nodes) ? response.data.nodes : []).map(normalizeNode));
            setActiveNodeKey('');
            showToast({ message: 'Đã lưu cây danh mục public.', type: 'success' });
        } catch (error) {
            console.error('Failed to save public category tree', error);
            showToast({ message: 'Không lưu được cây danh mục public.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-primary/45 p-4 backdrop-blur-sm">
            <div className="flex h-[86vh] w-full max-w-7xl flex-col overflow-hidden rounded-sm border border-gold/20 bg-[#fcfcfa] shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/15 bg-white px-5 py-4">
                    <div>
                        <h2 className="flex items-center gap-2 font-display text-lg font-bold italic text-primary">
                            <span className="material-symbols-outlined text-[20px]">account_tree</span>
                            Sắp xếp danh mục public
                        </h2>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-stone/40">
                            Áp dụng cho domain dùng chung nhiều cửa hàng
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={selectedDomainId}
                            onChange={(event) => setSelectedDomainId(event.target.value)}
                            className="h-9 min-w-[260px] rounded-sm border border-gold/20 bg-white px-3 text-[12px] font-bold text-primary outline-none focus:border-primary"
                            disabled={loading || saving}
                        >
                            {domainOptions.length === 0 ? (
                                <option value="">Chưa có domain</option>
                            ) : domainOptions.map((domain) => (
                                <option key={domain.id} value={domain.id}>
                                    {domain.domain || `Domain #${domain.id}`}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={saveTree}
                            disabled={!selectedDomainId || saving || loading}
                            className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-all hover:bg-umber disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <span className={`material-symbols-outlined text-[16px] ${saving ? 'animate-spin' : ''}`}>
                                {saving ? 'sync' : 'save'}
                            </span>
                            Lưu cây public
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex size-9 items-center justify-center rounded-sm border border-gold/20 bg-white text-stone transition-all hover:border-brick hover:text-brick"
                            disabled={saving}
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
                    <div className="flex min-h-0 flex-col border-r border-gold/10 bg-white">
                        <div className="border-b border-gold/10 p-4">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Danh mục nguồn</div>
                                <button
                                    type="button"
                                    onClick={mergeSameNameSources}
                                    disabled={loading || sourceCategories.length === 0}
                                    className="inline-flex h-8 items-center gap-1 rounded-sm border border-gold/20 px-3 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-gold/5 disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[14px]">merge_type</span>
                                    Gộp cùng tên
                                </button>
                            </div>
                            <div className="relative mt-3">
                                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-stone/45">search</span>
                                <input
                                    value={sourceSearch}
                                    onChange={(event) => setSourceSearch(event.target.value)}
                                    placeholder="Tìm danh mục nguồn..."
                                    className="h-9 w-full rounded-sm border border-gold/20 bg-white pl-9 pr-3 text-[12px] font-medium text-primary outline-none focus:border-primary"
                                />
                            </div>
                            {activeNode ? (
                                <div className="mt-3 rounded-sm border border-primary/10 bg-primary/[0.04] px-3 py-2 text-[11px] font-bold text-primary">
                                    Đang gộp vào: {activeNode.title}
                                </div>
                            ) : null}
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            {loading ? (
                                <div className="flex h-full items-center justify-center text-[12px] font-bold text-stone/45">Đang tải...</div>
                            ) : filteredSources.length === 0 ? (
                                <div className="rounded-sm border border-dashed border-gold/20 p-5 text-center text-[12px] font-bold text-stone/45">
                                    Không có danh mục nguồn
                                </div>
                            ) : filteredSources.map((category) => {
                                const mapped = mappedCategoryIds.has(Number(category.id));

                                return (
                                    <div key={category.id} className="mb-2 rounded-sm border border-gold/10 bg-[#fcfcfa] p-3 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-[13px] font-bold text-primary" style={{ paddingLeft: `${Math.min(Number(category.depth || 0), 4) * 12}px` }}>
                                                    {category.name}
                                                </div>
                                                <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-stone/45">
                                                    {sourceLabel(category)}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => addSourceCategory(category)}
                                                className={`flex size-8 shrink-0 items-center justify-center rounded-sm border transition-all ${mapped ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gold/20 bg-white text-primary hover:bg-primary hover:text-white'}`}
                                                title={activeNode ? 'Gộp vào mục đang chọn' : 'Tạo mục public mới'}
                                            >
                                                <span className="material-symbols-outlined text-[17px]">{mapped ? 'done' : 'add'}</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-col bg-[#faf8f3]">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/10 bg-white p-4">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Cây ngoài website</div>
                                <div className="mt-1 text-[11px] font-bold text-stone/45">{nodes.length} mục public</div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setActiveNodeKey('')}
                                    className="inline-flex h-8 items-center gap-1 rounded-sm border border-gold/20 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-stone hover:text-primary"
                                >
                                    <span className="material-symbols-outlined text-[14px]">backspace</span>
                                    Bỏ chọn
                                </button>
                                <button
                                    type="button"
                                    onClick={addBlankNode}
                                    className="inline-flex h-8 items-center gap-1 rounded-sm bg-brick px-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-umber"
                                >
                                    <span className="material-symbols-outlined text-[14px]">add</span>
                                    Thêm mục
                                </button>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            {nodes.length === 0 ? (
                                <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gold/25 bg-white text-center text-[12px] font-bold text-stone/45">
                                    Chưa có cây public. Bấm + ở danh mục nguồn để tạo.
                                </div>
                            ) : nodes.map((node, index) => {
                                const key = nodeKey(node);
                                const selected = key === activeNodeKey;
                                const parentOptions = nodes.slice(0, index);

                                return (
                                    <div
                                        key={key}
                                        onClick={() => setActiveNodeKey(key)}
                                        className={`mb-3 rounded-sm border bg-white p-3 shadow-sm transition-all ${selected ? 'border-primary ring-2 ring-primary/10' : 'border-gold/10 hover:border-gold/30'}`}
                                    >
                                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[72px_minmax(0,1fr)_190px_105px]">
                                            <div>
                                                <label className="text-[9px] font-black uppercase tracking-widest text-stone/40">STT</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max={nodes.length}
                                                    value={index + 1}
                                                    onClick={(event) => event.stopPropagation()}
                                                    onFocus={(event) => event.target.select()}
                                                    onChange={(event) => moveNodeToPosition(key, event.target.value)}
                                                    className="mt-1 h-9 w-full rounded-sm border border-gold/20 px-2 text-center text-[13px] font-black text-primary outline-none focus:border-primary"
                                                    title="Nhap so thu tu"
                                                />
                                            </div>
                                            <div className="min-w-0">
                                                <label className="text-[9px] font-black uppercase tracking-widest text-stone/40">Tên public</label>
                                                <input
                                                    value={node.title}
                                                    onChange={(event) => updateNode(key, {
                                                        title: event.target.value,
                                                        slug: node.slug ? node.slug : slugify(event.target.value),
                                                    })}
                                                    className="mt-1 h-9 w-full rounded-sm border border-gold/20 px-3 text-[13px] font-bold text-primary outline-none focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black uppercase tracking-widest text-stone/40">Slug</label>
                                                <input
                                                    value={node.slug}
                                                    onChange={(event) => updateNode(key, { slug: slugify(event.target.value) })}
                                                    className="mt-1 h-9 w-full rounded-sm border border-gold/20 px-3 text-[12px] font-bold text-primary outline-none focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black uppercase tracking-widest text-stone/40">Trạng thái</label>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        updateNode(key, { status: !node.status });
                                                    }}
                                                    className={`mt-1 flex h-9 w-full items-center justify-center rounded-sm border text-[10px] font-black uppercase tracking-widest ${node.status ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone/20 bg-stone/5 text-stone/50'}`}
                                                >
                                                    {node.status ? 'Hiện' : 'Ẩn'}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[190px_minmax(0,1fr)_48px]">
                                            <div>
                                                <label className="text-[9px] font-black uppercase tracking-widest text-stone/40">Danh mục cha</label>
                                                <select
                                                    value={node.parent_key || ''}
                                                    onChange={(event) => updateNode(key, { parent_key: event.target.value })}
                                                    className="mt-1 h-9 w-full rounded-sm border border-gold/20 bg-white px-2 text-[12px] font-bold text-primary outline-none focus:border-primary"
                                                >
                                                    <option value="">Cấp gốc</option>
                                                    {parentOptions.map((parentNode) => (
                                                        <option key={nodeKey(parentNode)} value={nodeKey(parentNode)}>
                                                            {parentNode.title || 'Chưa đặt tên'}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="min-w-0">
                                                <label className="text-[9px] font-black uppercase tracking-widest text-stone/40">Danh mục nguồn đã gộp</label>
                                                <div className="mt-1 flex min-h-9 flex-wrap items-center gap-2 rounded-sm border border-gold/10 bg-gold/5 px-2 py-1">
                                                    {(node.category_ids || []).length === 0 ? (
                                                        <span className="text-[11px] font-bold text-stone/40">Chưa map danh mục nguồn</span>
                                                    ) : node.category_ids.map((categoryId) => {
                                                        const category = sourceCategoryById.get(Number(categoryId));

                                                        return (
                                                            <span key={categoryId} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-gold/20 bg-white px-2 py-1 text-[10px] font-bold text-primary">
                                                                <span className="truncate">{category?.name || `#${categoryId}`}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        removeCategoryFromNode(key, categoryId);
                                                                    }}
                                                                    className="text-stone/40 hover:text-brick"
                                                                >
                                                                    <span className="material-symbols-outlined text-[13px]">close</span>
                                                                </button>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="flex items-end justify-end">
                                                <button type="button" onClick={(event) => { event.stopPropagation(); removeNode(key); }} className="flex size-9 items-center justify-center rounded-sm border border-brick/20 bg-white text-brick hover:bg-brick hover:text-white">
                                                    <span className="material-symbols-outlined text-[17px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default PublicCategoryTreeModal;
