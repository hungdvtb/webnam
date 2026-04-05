import React, { useEffect, useMemo, useRef, useState } from 'react';
import { productApi } from '../../services/api';
import {
    buildOrderAiPickerEntries,
    createOrderAiRuleItem,
    formatOrderAiRuleAliases,
    normalizeOrderAiRuleAliasList,
} from '../../utils/orderAiRules';

const inputClassName = 'h-10 w-full rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none';
const textareaClassName = 'min-h-[88px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] font-semibold text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none resize-none';

const formatPrice = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))}đ`;
const normalizePhrasePart = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const splitRulePhrase = (value) => String(value || '').split(/[,\n;]+/).map(normalizePhrasePart).filter(Boolean);

const findSizeLabel = (value) => {
    const match = normalizePhrasePart(value).toLowerCase().match(/(\d+\s*m\s*\d+|\d+\s*cm|\d{3,4})/i);
    if (!match) return '';
    return match[1].replace(/\s+/g, '').toLowerCase();
};

const slugify = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const deriveRuleMetadata = (rulePhrase) => {
    const parts = splitRulePhrase(rulePhrase);
    const sizePhrase = parts.find((part) => Boolean(findSizeLabel(part))) || '';
    const sizeLabel = findSizeLabel(sizePhrase || rulePhrase);
    const contextAliases = parts.filter((part) => part !== sizePhrase);
    const altarSizeAliases = normalizeOrderAiRuleAliasList([sizeLabel, sizePhrase].filter(Boolean));
    const canonicalContext = [...contextAliases].sort((a, b) => a.localeCompare(b, 'vi'));
    const ruleKey = sizeLabel ? slugify([sizeLabel, ...canonicalContext].join('-')) : '';

    return {
        rule_key: ruleKey,
        altar_size_label: sizeLabel,
        altar_size_aliases: altarSizeAliases,
        context_aliases: normalizeOrderAiRuleAliasList(contextAliases),
    };
};

const invalidatePreviewFields = (draft) => ({
    ...draft,
    parsed_result: null,
    parsed_raw_text: '',
    parsed_provider: '',
});

const AiTrainingEditorDrawer = ({
    open,
    form,
    setForm,
    onClose,
    onPreview,
    onSave,
    previewing = false,
    saving = false,
    showModal,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState([]);
    const inputFileRef = useRef(null);

    const selectedMappingKeys = useMemo(
        () => new Set((form?.mapping_items || []).map((item) => `${item.entry_kind}:${item.target_product_id}`)),
        [form?.mapping_items]
    );

    const previewImageUrl = useMemo(() => {
        if (form?.attachment instanceof File) {
            return URL.createObjectURL(form.attachment);
        }
        return form?.input_image_url || '';
    }, [form?.attachment, form?.input_image_url]);

    useEffect(() => () => {
        if (previewImageUrl && previewImageUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewImageUrl);
        }
    }, [previewImageUrl]);

    useEffect(() => {
        const timerId = window.setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 250);
        return () => window.clearTimeout(timerId);
    }, [searchTerm]);

    useEffect(() => {
        if (!open || debouncedSearchTerm.length < 2) {
            setResults([]);
            setSearching(false);
            return undefined;
        }

        let cancelled = false;
        setSearching(true);

        productApi.getAll({ picker: 1, per_page: 20, search: debouncedSearchTerm })
            .then((response) => {
                if (!cancelled) {
                    setResults(buildOrderAiPickerEntries(response.data?.data || []));
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('Error fetching AI training picker products', error);
                    setResults([]);
                }
            })
            .finally(() => {
                if (!cancelled) setSearching(false);
            });

        return () => {
            cancelled = true;
        };
    }, [debouncedSearchTerm, open]);

    if (!open) return null;

    const parsedResult = form?.parsed_result || null;
    const summary = parsedResult?.summary || {};

    const patchForm = (patch, { invalidatePreview = false } = {}) => {
        setForm((prev) => {
            const next = { ...prev, ...patch };
            if (Object.prototype.hasOwnProperty.call(patch, 'rule_phrase')) {
                Object.assign(next, deriveRuleMetadata(next.rule_phrase));
            }
            return invalidatePreview ? invalidatePreviewFields(next) : next;
        });
    };

    const addProduct = (entry) => {
        const key = `${entry.entry_kind}:${entry.target_product_id}`;
        if (selectedMappingKeys.has(key)) {
            showModal?.({
                title: 'Đã có mapping',
                content: 'Sản phẩm này đã có trong dữ liệu train hiện tại.',
                type: 'info',
            });
            return;
        }

        patchForm({
            mapping_items: [
                ...(form?.mapping_items || []),
                createOrderAiRuleItem({
                    ...entry,
                    aliases: normalizeOrderAiRuleAliasList([
                        entry.parent_product_name || entry.display_name || entry.name,
                        entry.option_label,
                    ]),
                }),
            ],
        });
        setSearchTerm('');
        setResults([]);
    };

    const updateMappingItem = (itemId, patch) => {
        patchForm({
            mapping_items: (form?.mapping_items || []).map((item) => (
                item.id === itemId ? { ...item, ...patch } : item
            )),
        });
    };

    const removeMappingItem = (itemId) => {
        patchForm({
            mapping_items: (form?.mapping_items || []).filter((item) => item.id !== itemId),
        });
    };

    const handleAttachmentChange = (event) => {
        const file = event.target.files?.[0] || null;
        patchForm({
            input_type: 'image',
            attachment: file,
            attachment_name: file?.name || '',
            source_name: file?.name || form?.source_name || '',
        }, { invalidatePreview: true });
    };

    const handleSave = () => onSave?.();

    return (
        <div className="fixed inset-0 z-[2400] flex justify-end bg-primary/25 backdrop-blur-sm">
            <button type="button" className="flex-1 cursor-default" onClick={onClose} aria-label="Đóng" />
            <div className="flex h-full w-full max-w-[880px] flex-col overflow-hidden border-l border-primary/10 bg-[#F7F4EE] shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
                <div className="flex items-center justify-between gap-3 border-b border-primary/10 bg-white px-5 py-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/45">Quản lý dữ liệu train AI</div>
                        <div className="mt-1 text-[18px] font-black text-primary">
                            {form?.id ? 'Chỉnh sửa dữ liệu train' : 'Thêm dữ liệu train mới'}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary/60 transition-all hover:text-brick">
                        Đóng
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-5">
                    <div className="space-y-4">
                        <div className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                            <div className="space-y-2">
                                <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Kích thước / rule</label>
                                <input
                                    type="text"
                                    value={form?.rule_phrase || ''}
                                    onChange={(event) => patchForm({ rule_phrase: event.target.value }, { invalidatePreview: true })}
                                    placeholder="Ví dụ: bàn 1m97, men lam"
                                    className={inputClassName}
                                />
                                <div className="text-[11px] font-semibold leading-5 text-primary/45">
                                    Chỉ cần nhập như "bàn 1m97, men lam" hoặc "men lam, bàn 1m97", hệ thống sẽ tự tách kích thước, context và sinh rule key.
                                </div>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {form?.altar_size_label ? (
                                        <span className="rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-primary/65">
                                            Kích thước nhận diện: {form.altar_size_label}
                                        </span>
                                    ) : (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">
                                            Chưa nhận diện được kích thước
                                        </span>
                                    )}
                                    {form?.rule_key ? (
                                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">
                                            Rule key: {form.rule_key}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-center gap-2">
                                {[
                                    { value: 'text', label: 'Text nhập tay' },
                                    { value: 'image', label: 'Ảnh upload' },
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => patchForm({ input_type: option.value }, { invalidatePreview: true })}
                                        className={`inline-flex h-9 items-center rounded-sm px-3 text-[11px] font-black uppercase tracking-[0.12em] transition-all ${
                                            form?.input_type === option.value
                                                ? 'bg-primary text-white'
                                                : 'border border-primary/15 bg-white text-primary/60 hover:border-primary/30 hover:text-primary'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>

                            <div className="mt-4 space-y-3">
                                <div className="space-y-2">
                                    <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Nguồn hiển thị</label>
                                    <input
                                        type="text"
                                        value={form?.source_name || ''}
                                        onChange={(event) => patchForm({ source_name: event.target.value })}
                                        placeholder={form?.input_type === 'image' ? 'Tên file / nguồn ảnh' : 'Ví dụ: note Zalo size 1m97'}
                                        className={inputClassName}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Ghi chú cho AI</label>
                                    <textarea
                                        value={form?.training_note || ''}
                                        onChange={(event) => patchForm({ training_note: event.target.value }, { invalidatePreview: true })}
                                        placeholder="Mô tả ngắn thêm cho AI nếu cần."
                                        className={textareaClassName}
                                    />
                                </div>

                                {form?.input_type === 'text' ? (
                                    <div className="space-y-2">
                                        <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Nội dung train gốc</label>
                                        <textarea
                                            value={form?.input_text || ''}
                                            onChange={(event) => patchForm({ input_text: event.target.value }, { invalidatePreview: true })}
                                            placeholder="Nhập nội dung text đã dùng để train AI..."
                                            className="min-h-[140px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] font-semibold text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none resize-y"
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Ảnh train gốc</label>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <input ref={inputFileRef} type="file" accept="image/*" className="hidden" onChange={handleAttachmentChange} />
                                            <button type="button" onClick={() => inputFileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary/65 transition-all hover:border-primary/30 hover:text-primary">
                                                <span className="material-symbols-outlined text-[15px]">upload_file</span>
                                                Tải ảnh
                                            </button>
                                            {(form?.attachment_name || form?.source_name) && (
                                                <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2 text-[11px] font-semibold text-primary/60">
                                                    {form?.attachment_name || form?.source_name}
                                                </div>
                                            )}
                                        </div>
                                        {previewImageUrl ? (
                                            <div className="overflow-hidden rounded-sm border border-primary/10 bg-[#EEE8DD]">
                                                <img src={previewImageUrl} alt="" className="max-h-[260px] w-full object-contain" />
                                            </div>
                                        ) : (
                                            <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-8 text-center text-[12px] font-semibold text-primary/35">
                                                Chưa có ảnh train cho bản ghi này.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">AI đọc dữ liệu train</div>
                                    <div className="mt-1 text-[12px] font-semibold text-primary/60">Chạy phân tích để lấy nội dung AI đọc được và gợi ý mapping sản phẩm.</div>
                                </div>
                                <button type="button" onClick={onPreview} disabled={previewing} className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-60">
                                    <span className={`material-symbols-outlined text-[16px] ${previewing ? 'animate-spin' : ''}`}>{previewing ? 'progress_activity' : 'auto_awesome'}</span>
                                    {previewing ? 'Đang đọc' : 'AI đọc ngay'}
                                </button>
                            </div>

                            {parsedResult ? (
                                <div className="mt-4 space-y-3">
                                    <div className="grid gap-3 md:grid-cols-4">
                                        <div className="rounded-sm border border-sky-200 bg-sky-50 px-3 py-2">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">Đã map</div>
                                            <div className="mt-1 text-[22px] font-black text-slate-800">{summary.mapped || 0}</div>
                                        </div>
                                        <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Cần rà</div>
                                            <div className="mt-1 text-[22px] font-black text-slate-800">{summary.review || 0}</div>
                                        </div>
                                        <div className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-700">Chưa ghép</div>
                                            <div className="mt-1 text-[22px] font-black text-slate-800">{summary.unresolved || 0}</div>
                                        </div>
                                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/50">Provider</div>
                                            <div className="mt-1 text-[13px] font-black text-slate-800">{form?.parsed_provider || parsedResult?.provider || 'AI'}</div>
                                        </div>
                                    </div>

                                    <div className="rounded-sm border border-primary/10 bg-primary/[0.03] p-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Kết quả AI đã đọc</div>
                                        <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold leading-6 text-[#0F172A]">
                                            {form?.parsed_raw_text || parsedResult?.raw_text || 'Chưa có nội dung đọc được.'}
                                        </div>
                                    </div>

                                    {(parsedResult?.unresolved_items || []).length > 0 && (
                                        <div className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-[12px] font-semibold text-amber-800">
                                            {(parsedResult.unresolved_items || []).map((item) => item?.source_phrase || item?.parsed_name).filter(Boolean).join(', ')}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="mt-4 rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-6 text-center text-[12px] font-semibold text-primary/35">
                                    Chưa có kết quả AI. Hãy chạy "AI đọc ngay" trước khi lưu để dễ kiểm tra lại.
                                </div>
                            )}
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Mapping sản phẩm</div>
                            <div className="mt-1 text-[12px] font-semibold text-primary/60">Bạn có thể sửa alias, số lượng mặc định và gán thêm sản phẩm thủ công trước khi lưu.</div>

                            <div className="mt-3 rounded-sm border border-primary/10 bg-primary/[0.03] px-3">
                                <div className="flex h-10 items-center gap-2">
                                    <span className="material-symbols-outlined text-[16px] text-primary/35">search</span>
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(event) => setSearchTerm(event.target.value)}
                                        placeholder="Tìm sản phẩm để thêm mapping..."
                                        className="w-full bg-transparent text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {debouncedSearchTerm.length >= 2 && (
                                <div className="mt-3 max-h-[220px] space-y-2 overflow-auto rounded-sm border border-primary/10 bg-primary/[0.02] p-2">
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

                            <div className="mt-4 space-y-3">
                                {(form?.mapping_items || []).length > 0 ? (form.mapping_items || []).map((item, index) => (
                                    <div key={item.id} className="rounded-sm border border-primary/10 bg-[#FAF8F3] p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Mapping #{index + 1}</div>
                                                <div className="mt-1 truncate text-[13px] font-bold text-[#0F172A]">{item.display_name || 'Sản phẩm chưa chọn'}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-primary/45">
                                                    {item.display_sku && <span>{item.display_sku}</span>}
                                                    {item.option_label && <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/65">{item.option_label}</span>}
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => removeMappingItem(item.id)} className="inline-flex size-8 items-center justify-center rounded-sm border border-brick/15 text-brick transition-all hover:bg-brick hover:text-white">
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        </div>
                                        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px]">
                                            <div className="space-y-2">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">Alias khách hay gọi</label>
                                                <textarea
                                                    value={formatOrderAiRuleAliases(item.aliases || [])}
                                                    onChange={(event) => updateMappingItem(item.id, { aliases: normalizeOrderAiRuleAliasList(event.target.value) })}
                                                    className={textareaClassName}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">SL mặc định</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={item.default_quantity || 1}
                                                    onChange={(event) => updateMappingItem(item.id, { default_quantity: Math.max(1, Number(event.target.value) || 1) })}
                                                    className={inputClassName}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-6 text-center text-[12px] font-semibold text-primary/35">
                                        Chưa có mapping nào. Hãy chạy AI hoặc gán sản phẩm thủ công.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-white px-5 py-4">
                    <div className="text-[12px] font-semibold text-primary/50">Sửa hoặc xóa dữ liệu ở đây sẽ tác động trực tiếp đến rule AI dùng cho tìm nhanh đơn hàng.</div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary/60 transition-all hover:text-brick">
                            Hủy
                        </button>
                        <button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-60">
                            <span className={`material-symbols-outlined text-[16px] ${saving ? 'animate-spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
                            {saving ? 'Đang lưu' : 'Lưu dữ liệu train'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AiTrainingEditorDrawer;

