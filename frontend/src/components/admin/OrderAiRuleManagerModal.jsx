import React, { useEffect, useMemo, useRef, useState } from 'react';
import { orderApi, productApi } from '../../services/api';
import {
    buildOrderAiPickerEntries,
    createOrderAiRuleGroup,
    createOrderAiRuleItem,
    formatOrderAiRuleAliases,
    normalizeOrderAiRuleAliasList,
    normalizeOrderAiRules,
} from '../../utils/orderAiRules';

const inputClassName = 'h-10 w-full rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none';
const textareaClassName = 'min-h-[74px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] font-semibold text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none resize-none';
const formatPrice = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))}đ`;
const formatTrainedAt = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ''
        : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
};

const mergeRuleItems = (currentItems = [], nextItems = []) => {
    const nextMap = new Map(currentItems.map((item, index) => [`${item.entry_kind}:${item.target_product_id}`, index]));
    const merged = [...currentItems];
    nextItems.forEach((item) => {
        const key = `${item.entry_kind}:${item.target_product_id}`;
        const existingIndex = nextMap.get(key);
        if (existingIndex === undefined) {
            nextMap.set(key, merged.length);
            merged.push(item);
            return;
        }
        merged[existingIndex] = createOrderAiRuleItem({
            ...merged[existingIndex],
            ...item,
            aliases: normalizeOrderAiRuleAliasList([...(merged[existingIndex]?.aliases || []), ...(item?.aliases || [])]),
        });
    });
    return merged;
};

const RuleGroupCard = ({ group, index, onChange, onRemove, showModal }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState([]);
    const [trainLoading, setTrainLoading] = useState(false);
    const [trainPreview, setTrainPreview] = useState(null);
    const [selectedTrainFileName, setSelectedTrainFileName] = useState('');
    const trainFileRef = useRef(null);
    const selectedKeys = useMemo(() => new Set((group?.items || []).map((item) => `${item.entry_kind}:${item.target_product_id}`)), [group?.items]);

    useEffect(() => {
        const timerId = window.setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 250);
        return () => window.clearTimeout(timerId);
    }, [searchTerm]);

    useEffect(() => {
        if (debouncedSearchTerm.length < 2) {
            setSearching(false);
            setResults([]);
            return undefined;
        }
        let cancelled = false;
        setSearching(true);
        productApi.getAll({ picker: 1, per_page: 20, search: debouncedSearchTerm })
            .then((response) => {
                if (!cancelled) setResults(buildOrderAiPickerEntries(response.data?.data || []));
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('Error fetching AI rule products', error);
                    setResults([]);
                }
            })
            .finally(() => {
                if (!cancelled) setSearching(false);
            });
        return () => { cancelled = true; };
    }, [debouncedSearchTerm]);

    const updateGroup = (patch) => onChange({ ...group, ...patch });

    const addProduct = (entry) => {
        const key = `${entry.entry_kind}:${entry.target_product_id}`;
        if (selectedKeys.has(key)) {
            showModal?.({ title: 'Đã tồn tại', content: 'Sản phẩm này đã có trong rule của kích thước ban thờ này.', type: 'info' });
            return;
        }
        updateGroup({
            items: [...(group?.items || []), createOrderAiRuleItem({ ...entry, aliases: [entry.parent_product_name || entry.display_name || entry.name].filter(Boolean) })],
        });
        setSearchTerm('');
        setResults([]);
    };

    const updateItem = (itemId, patch) => {
        updateGroup({ items: (group?.items || []).map((item) => (item.id === itemId ? { ...item, ...patch } : item)) });
    };

    const removeItem = (itemId) => {
        updateGroup({ items: (group?.items || []).filter((item) => item.id !== itemId) });
    };

    const clearTrainFile = () => {
        if (trainFileRef.current) trainFileRef.current.value = '';
        setSelectedTrainFileName('');
        setTrainPreview(null);
    };

    const runTrainFromImage = async () => {
        const altarSizeLabel = String(group?.altar_size_label || '').trim();
        const file = trainFileRef.current?.files?.[0] || null;
        if (!altarSizeLabel) {
            showModal?.({ title: 'Thiếu kích thước ban thờ', content: 'Hãy nhập kích thước ban thờ trước khi dạy AI.', type: 'error' });
            return;
        }
        if (!file) {
            showModal?.({ title: 'Chưa có ảnh', content: 'Hãy tải ảnh hoặc PDF để AI học nhanh.', type: 'error' });
            return;
        }
        setTrainLoading(true);
        try {
            const payload = new FormData();
            payload.append('altar_size_label', altarSizeLabel);
            payload.append('attachment', file);
            if (String(group?.training_note || '').trim()) payload.append('message', String(group.training_note).trim());
            const response = await orderApi.aiRuleTrainPreview(payload);
            setTrainPreview(response.data || null);
        } catch (error) {
            console.error('Error training AI rule from image', error);
            showModal?.({
                title: 'Không thể đọc ảnh dạy AI',
                content: error?.response?.data?.message || 'AI chưa đọc được ảnh vừa tải lên. Hãy thử ảnh rõ hơn hoặc thêm ghi chú ngắn.',
                type: 'error',
            });
        } finally {
            setTrainLoading(false);
        }
    };

    const applyTrainPreview = (mode) => {
        const previewItems = Array.isArray(trainPreview?.items) ? trainPreview.items : [];
        if (previewItems.length === 0) {
            showModal?.({ title: 'Chưa có gợi ý', content: 'AI chưa gợi ý được sản phẩm nào để lưu vào rule.', type: 'info' });
            return;
        }
        const previewContextAliases = normalizeOrderAiRuleAliasList(trainPreview?.context_aliases ?? []);
        const normalized = previewItems.map((item) => createOrderAiRuleItem({
            ...item,
            aliases: normalizeOrderAiRuleAliasList([...(item?.aliases || []), item?.parsed_name, item?.source_phrase, item?.display_name]),
        }));
        updateGroup({
            items: mode === 'append' ? mergeRuleItems(group?.items || [], normalized) : normalized,
            context_aliases: previewContextAliases.length > 0
                ? (mode === 'append'
                    ? normalizeOrderAiRuleAliasList([...(group?.context_aliases || []), ...previewContextAliases])
                    : previewContextAliases)
                : (group?.context_aliases || []),
            training_source_type: 'image',
            training_source_name: String(trainPreview?.source?.name || selectedTrainFileName || group?.training_source_name || '').trim(),
            training_note: String(group?.training_note || trainPreview?.source?.note || '').trim(),
            training_raw_text: String(trainPreview?.raw_text || '').trim(),
            trained_at: new Date().toISOString(),
        });
        setTrainPreview(null);
        setSelectedTrainFileName('');
        if (trainFileRef.current) trainFileRef.current.value = '';
    };

    return (
        <div className="rounded-sm border border-primary/10 bg-primary/[0.02] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 px-4 py-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Rule Ban Thờ #{index + 1}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <div className="text-[15px] font-black text-primary">{group?.altar_size_label || 'Chưa đặt tên kích thước'}</div>
                        {group?.context_aliases?.[0] && <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-primary/65">{group.context_aliases[0]}</span>}
                        {group?.training_source_type === 'image' && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">Đã học từ ảnh</span>}
                    </div>
                    {(group?.training_source_name || group?.trained_at) && <div className="mt-1 text-[11px] font-semibold text-primary/55">{`${group?.training_source_name ? `Nguồn: ${group.training_source_name}` : 'Nguồn: AI học từ ảnh'}${group?.trained_at ? ` • ${formatTrainedAt(group.trained_at)}` : ''}`}</div>}
                </div>
                <button type="button" onClick={onRemove} className="inline-flex h-9 items-center gap-1 rounded-sm border border-brick/15 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-brick transition-all hover:bg-brick hover:text-white">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    Xóa
                </button>
            </div>

                <div className="space-y-4 p-4">
                    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="space-y-2">
                            <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Kích thước ban thờ</label>
                            <input type="text" value={group?.altar_size_label || ''} onChange={(event) => updateGroup({ altar_size_label: event.target.value })} placeholder="Ví dụ: 1m97" className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                            <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Alias kích thước</label>
                            <textarea value={formatOrderAiRuleAliases(group?.altar_size_aliases || [])} onChange={(event) => updateGroup({ altar_size_aliases: normalizeOrderAiRuleAliasList(event.target.value) })} placeholder="Ví dụ: 1m97, 197, bàn 1m97" className={textareaClassName} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Dòng men / thuộc tính áp dụng</label>
                        <textarea value={formatOrderAiRuleAliases(group?.context_aliases || [])} onChange={(event) => updateGroup({ context_aliases: normalizeOrderAiRuleAliasList(event.target.value) })} placeholder="Ví dụ: men lam, men rạn, vẽ vàng, hàng kỹ..." className={textareaClassName} />
                        <div className="text-[11px] font-semibold text-primary/45">Dùng để tách nhiều rule cùng một kích thước. Ví dụ: bàn 1m97 men lam sẽ khác bàn 1m97 men rạn.</div>
                    </div>

                <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Thêm sản phẩm vào rule</div>
                        <div className="mt-1 text-[12px] font-semibold text-primary/65">Tìm tên sản phẩm, SKU hoặc size rồi bấm để gán vào kích thước ban thờ này.</div>
                        <div className="mt-3 rounded-sm border border-primary/10 bg-primary/[0.03] px-3">
                            <div className="flex h-10 items-center gap-2">
                                <span className="material-symbols-outlined text-[16px] text-primary/35">search</span>
                                <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Tìm sản phẩm để ghép..." className="w-full bg-transparent text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:outline-none" />
                            </div>
                        </div>
                        {debouncedSearchTerm.length >= 2 && (
                            <div className="mt-3 max-h-[260px] space-y-2 overflow-auto rounded-sm border border-primary/10 bg-primary/[0.02] p-2">
                                {searching && <div className="px-3 py-4 text-center text-[11px] font-semibold text-primary/45">Đang tìm sản phẩm...</div>}
                                {!searching && results.map((entry) => (
                                    <button key={`${entry.entry_kind}-${entry.target_product_id}`} type="button" onClick={() => addProduct(entry)} className="w-full rounded-sm border border-primary/10 bg-white px-3 py-2 text-left transition-all hover:border-primary/30 hover:bg-primary/[0.02]">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-[13px] font-bold text-[#0F172A]">{entry.display_name}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-primary/45">
                                                    {entry.display_sku && <span>{entry.display_sku}</span>}
                                                    {entry.option_label && <span className="rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">{entry.option_label}</span>}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-[12px] font-black text-blue-600">{formatPrice(entry.price)}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Học nhanh từ ảnh</div>
                        <div className="mt-1 text-[12px] font-semibold text-primary/65">Tải ảnh bộ đồ thờ, ảnh chat, ảnh note hoặc PDF để AI gợi ý nhanh bộ sản phẩm cho size này.</div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input ref={trainFileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(event) => setSelectedTrainFileName(event.target.files?.[0]?.name || '')} />
                            <button type="button" onClick={() => trainFileRef.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/65 transition-all hover:border-primary/30 hover:text-primary">
                                <span className="material-symbols-outlined text-[15px]">upload_file</span>
                                Tải ảnh mẫu
                            </button>
                            {(selectedTrainFileName || group?.training_source_name) && (
                                <div className="inline-flex items-center gap-2 rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2 text-[11px] font-semibold text-primary/65">
                                    <span className="material-symbols-outlined text-[14px]">attach_file</span>
                                    <span className="max-w-[220px] truncate">{selectedTrainFileName || group.training_source_name}</span>
                                    {selectedTrainFileName && (
                                        <button type="button" onClick={clearTrainFile} className="inline-flex items-center text-primary/35 transition-all hover:text-brick">
                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="mt-3 space-y-2">
                            <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Ghi chú cho AI</label>
                            <textarea value={group?.training_note || ''} onChange={(event) => updateGroup({ training_note: event.target.value })} placeholder="Ví dụ: ảnh này là bộ đồ thờ men lam cho bàn 1m97, ưu tiên lọ hoa và mâm bồng đúng size." className={textareaClassName} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-[11px] font-semibold text-primary/50">AI sẽ đọc ảnh, gợi ý sản phẩm và chờ bạn xác nhận trước khi lưu rule.</div>
                            <button type="button" onClick={runTrainFromImage} disabled={trainLoading} className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-60">
                                <span className={`material-symbols-outlined text-[15px] ${trainLoading ? 'animate-spin' : ''}`}>{trainLoading ? 'progress_activity' : 'auto_awesome'}</span>
                                {trainLoading ? 'Đang đọc ảnh' : 'AI gợi ý từ ảnh'}
                            </button>
                        </div>
                        {trainPreview && (
                            <div className="mt-3 rounded-sm border border-sky-200 bg-sky-50 p-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">Gợi ý từ ảnh</div>
                                <div className="mt-1 text-[12px] font-semibold text-slate-700">{`AI gợi ý ${trainPreview?.summary?.mapped || 0} sản phẩm${trainPreview?.summary?.review ? `, ${trainPreview.summary.review} dòng cần rà` : ''}${trainPreview?.summary?.unresolved ? `, ${trainPreview.summary.unresolved} dòng chưa ghép` : ''}.`}</div>
                                {(trainPreview?.context_aliases || []).length > 0 && <div className="mt-2 flex flex-wrap gap-2">{trainPreview.context_aliases.map((contextAlias) => <span key={contextAlias} className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">{contextAlias}</span>)}</div>}
                                {trainPreview?.raw_text && <div className="mt-1 line-clamp-2 text-[11px] font-semibold text-slate-500">{trainPreview.raw_text}</div>}
                                <div className="mt-3 max-h-[220px] space-y-2 overflow-auto">
                                    {(trainPreview?.items || []).map((item) => (
                                        <div key={item.id} className="rounded-sm border border-sky-100 bg-white px-3 py-2">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-[13px] font-bold text-[#0F172A]">{item.display_name}</div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-primary/45">
                                                        <span>SL mặc định: {item.default_quantity || 1}</span>
                                                        {item.display_sku && <span>{item.display_sku}</span>}
                                                        {item.option_label && <span className="rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">{item.option_label}</span>}
                                                    </div>
                                                </div>
                                                <div className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">{`${item.confidence_label || 'Cần rà'}${Number(item.confidence || 0) > 0 ? ` ${item.confidence}%` : ''}`}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {(trainPreview?.unresolved_items || []).length > 0 && <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">{`Chưa ghép: ${(trainPreview.unresolved_items || []).map((item) => item?.source_phrase || item?.parsed_name).filter(Boolean).join(', ')}`}</div>}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button type="button" onClick={() => applyTrainPreview('replace')} className="inline-flex h-8 items-center gap-1 rounded-sm bg-sky-700 px-3 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-sky-800">Ghi đè theo ảnh</button>
                                    <button type="button" onClick={() => applyTrainPreview('append')} className="inline-flex h-8 items-center gap-1 rounded-sm border border-sky-200 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700 transition-all hover:border-sky-300">Gộp vào rule</button>
                                    <button type="button" onClick={() => setTrainPreview(null)} className="inline-flex h-8 items-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-primary/55 transition-all hover:text-brick">Bỏ gợi ý</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {(group?.items || []).length > 0 ? (
                    <div className="space-y-3">
                        {(group.items || []).map((item, itemIndex) => (
                            <div key={item.id} className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Mapping #{itemIndex + 1}</div>
                                        <div className="mt-1 text-[13px] font-bold text-[#0F172A]">{item.display_name || 'Sản phẩm chưa chọn'}</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-primary/45">
                                            {item.display_sku && <span>{item.display_sku}</span>}
                                            {item.option_label && <span className="rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/65">{item.option_label}</span>}
                                        </div>
                                    </div>
                                    <button type="button" onClick={() => removeItem(item.id)} className="inline-flex size-8 items-center justify-center rounded-sm border border-brick/15 text-brick transition-all hover:bg-brick hover:text-white" title="Xóa mapping">
                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
                                </div>
                                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px]">
                                    <div className="space-y-2">
                                        <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Từ khóa khách hay gọi</label>
                                        <textarea value={formatOrderAiRuleAliases(item.aliases || [])} onChange={(event) => updateItem(item.id, { aliases: normalizeOrderAiRuleAliasList(event.target.value) })} placeholder="Ví dụ: lọ hoa, lục bình, mâm bồng..." className={textareaClassName} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">SL mặc định</label>
                                        <input type="number" min="1" value={item.default_quantity || 1} onChange={(event) => updateItem(item.id, { default_quantity: Math.max(1, Number(event.target.value) || 1) })} className={inputClassName} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-sm border border-dashed border-primary/15 bg-white px-4 py-6 text-center text-[12px] font-semibold text-primary/35">Chưa có sản phẩm nào được dạy cho kích thước ban thờ này.</div>
                )}
            </div>
        </div>
    );
};

const OrderAiRuleManagerModal = ({ rules, onClose, onSave, saving = false, showModal }) => {
    const [draftRules, setDraftRules] = useState(() => normalizeOrderAiRules(rules || []));
    useEffect(() => setDraftRules(normalizeOrderAiRules(rules || [])), [rules]);
    const updateGroup = (groupId, nextGroup) => setDraftRules((prev) => prev.map((group) => (group.id === groupId ? nextGroup : group)));
    const addGroup = () => setDraftRules((prev) => [...prev, createOrderAiRuleGroup()]);
    const removeGroup = (groupId) => setDraftRules((prev) => prev.filter((group) => group.id !== groupId));
    const handleSave = () => onSave?.(normalizeOrderAiRules(draftRules).filter((group) => group.altar_size_label));

    return (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-primary/30 px-4 py-6 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 bg-primary/[0.02] px-5 py-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/45">Dạy AI Theo Kích Thước Ban Thờ</div>
                        <div className="mt-1 text-[18px] font-black text-primary">Quy tắc ghép sản phẩm theo từng kích thước</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={addGroup} className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/30 hover:bg-primary/[0.04]">
                            <span className="material-symbols-outlined text-[16px]">add_circle</span>
                            Thêm kích thước
                        </button>
                        <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary/60 transition-all hover:text-brick">Đóng</button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-5">
                    <div className="space-y-4">
                        {draftRules.length > 0 ? draftRules.map((group, index) => (
                            <RuleGroupCard key={group.id} group={group} index={index} onChange={(nextGroup) => updateGroup(group.id, nextGroup)} onRemove={() => removeGroup(group.id)} showModal={showModal} />
                        )) : (
                            <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.02] px-6 py-10 text-center">
                                <div className="text-[13px] font-bold text-primary">Chưa có rule nào được khai báo.</div>
                                <div className="mt-2 text-[12px] font-semibold text-primary/45">Bấm &quot;Thêm kích thước&quot; để dạy AI ghép sản phẩm theo từng size ban thờ.</div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-white px-5 py-4">
                    <div className="text-[12px] font-semibold text-primary/50">Mỗi rule nên có alias rõ ràng, ví dụ: &quot;lọ hoa&quot;, &quot;mâm bồng&quot;, &quot;ống hương&quot;, &quot;kỷ ngai 5&quot;.</div>
                    <button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-60">
                        <span className={`material-symbols-outlined text-[16px] ${saving ? 'animate-spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
                        {saving ? 'Đang lưu' : 'Lưu rule AI'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OrderAiRuleManagerModal;
