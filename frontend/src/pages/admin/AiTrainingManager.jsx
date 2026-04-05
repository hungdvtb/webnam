import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useUI } from '../../context/UIContext';
import AiTrainingEditorDrawer from '../../components/admin/AiTrainingEditorDrawer';
import { orderAiTrainingApi } from '../../services/api';
import { createOrderAiRuleItem, normalizeOrderAiRuleAliasList } from '../../utils/orderAiRules';

const panelClassName = 'rounded-sm border border-primary/10 bg-white shadow-sm';
const inputClassName = 'h-10 w-full rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none';

const formatDateTime = (value) => {
    if (!value) return 'Chưa có';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Chưa có';

    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

const normalizePhrasePart = (value) => String(value || '').trim().replace(/\s+/g, ' ');

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

const buildRulePhrase = (record) => {
    const sizeAliases = normalizeOrderAiRuleAliasList(record?.altar_size_aliases || []);
    const preferredSizePhrase = sizeAliases.find((alias) => findSizeLabel(alias) && normalizePhrasePart(alias).toLowerCase() !== findSizeLabel(alias))
        || sizeAliases[0]
        || record?.altar_size_label
        || '';
    const contextAliases = normalizeOrderAiRuleAliasList(record?.context_aliases || []);

    return [preferredSizePhrase, ...contextAliases]
        .map(normalizePhrasePart)
        .filter(Boolean)
        .join(', ');
};

const splitDefinitionLines = (value) => String(value || '')
    .split(/\r?\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);

const mergeDefinitionTexts = (...values) => Array.from(new Set(
    values.flatMap((value) => splitDefinitionLines(value))
)).join('\n');

const createEmptyForm = (inputType = 'text') => ({
    id: null,
    rule_phrase: '',
    rule_key: '',
    altar_size_label: '',
    altar_size_aliases: [],
    context_aliases: [],
    input_type: inputType,
    source_name: '',
    training_note: '',
    definition_text: '',
    input_text: '',
    input_image_url: '',
    input_image_mime: '',
    attachment: null,
    attachment_name: '',
    parsed_result: null,
    parsed_raw_text: '',
    parsed_provider: '',
    mapping_items: [],
    trained_at: '',
});

const hydrateForm = (record) => ({
    id: record?.id ?? null,
    rule_phrase: buildRulePhrase(record),
    rule_key: String(record?.rule_key || '').trim(),
    altar_size_label: String(record?.altar_size_label || '').trim(),
    altar_size_aliases: normalizeOrderAiRuleAliasList(record?.altar_size_aliases || []),
    context_aliases: normalizeOrderAiRuleAliasList(record?.context_aliases || []),
    input_type: record?.input_type === 'image' ? 'image' : 'text',
    source_name: String(record?.source_name || '').trim(),
    training_note: String(record?.training_note || '').trim(),
    definition_text: String(record?.definition_text || '').trim(),
    input_text: String(record?.input_text || '').trim(),
    input_image_url: String(record?.input_image_url || '').trim(),
    input_image_mime: String(record?.input_image_mime || '').trim(),
    attachment: null,
    attachment_name: '',
    parsed_result: record?.parsed_result || null,
    parsed_raw_text: String(record?.parsed_raw_text || record?.ai_result?.raw_text || '').trim(),
    parsed_provider: String(record?.parsed_provider || record?.ai_result?.provider || '').trim(),
    mapping_items: (record?.mapping_items || []).map((item) => createOrderAiRuleItem(item)),
    trained_at: String(record?.trained_at || '').trim(),
});

const buildMultipartPayload = (form) => {
    const payload = new FormData();
    payload.append('rule_key', String(form?.rule_key || '').trim());
    payload.append('altar_size_label', String(form?.altar_size_label || '').trim());
    payload.append('input_type', form?.input_type === 'image' ? 'image' : 'text');
    payload.append('source_name', String(form?.source_name || '').trim());
    payload.append('training_note', String(form?.training_note || '').trim());
    payload.append('input_text', String(form?.input_text || '').trim());
    payload.append('parsed_raw_text', String(form?.parsed_raw_text || '').trim());
    payload.append('parsed_provider', String(form?.parsed_provider || '').trim());
    payload.append('trained_at', String(form?.trained_at || '').trim());
    payload.append('altar_size_aliases', JSON.stringify(form?.altar_size_aliases || []));
    payload.append('context_aliases', JSON.stringify(form?.context_aliases || []));
    payload.append('mapping_items', JSON.stringify((form?.mapping_items || []).map((item) => ({
        ...item,
        aliases: normalizeOrderAiRuleAliasList(item?.aliases || []),
    }))));
    payload.append('parsed_result', JSON.stringify(form?.parsed_result || null));

    if (form?.attachment instanceof File) {
        payload.append('attachment', form.attachment);
    }

    return payload;
};

const AiTrainingManager = () => {
    const { showModal, showToast } = useUI();
    const [filters, setFilters] = useState({ search: '', altar_size: '', input_type: 'all', page: 1 });
    const [records, setRecords] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedRecord, setSelectedRecord] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [form, setForm] = useState(() => createEmptyForm('text'));
    const [previewing, setPreviewing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [definitionText, setDefinitionText] = useState('');
    const [definitionSavedText, setDefinitionSavedText] = useState('');
    const [definitionUpdatedAt, setDefinitionUpdatedAt] = useState('');
    const [definitionLoading, setDefinitionLoading] = useState(true);
    const [definitionSaving, setDefinitionSaving] = useState(false);

    const loadList = useCallback(async (activeFilters) => {
        setLoading(true);
        try {
            const response = await orderAiTrainingApi.getAll({
                search: activeFilters.search || undefined,
                altar_size: activeFilters.altar_size || undefined,
                input_type: activeFilters.input_type === 'all' ? undefined : activeFilters.input_type,
                page: activeFilters.page,
                per_page: 20,
            });
            const payload = response.data || {};
            const nextRecords = Array.isArray(payload.data) ? payload.data : [];

            setRecords(nextRecords);
            setPagination({
                current_page: Number(payload.current_page || 1),
                last_page: Number(payload.last_page || 1),
                total: Number(payload.total || nextRecords.length),
            });
            setSelectedId((prev) => (nextRecords.some((item) => item.id === prev) ? prev : (nextRecords[0]?.id ?? null)));
        } catch (error) {
            console.error('Error fetching AI training records', error);
            setRecords([]);
            setPagination({ current_page: 1, last_page: 1, total: 0 });
        } finally {
            setLoading(false);
        }
    }, []);

    const loadDetail = useCallback(async (id) => {
        if (!id) {
            setSelectedRecord(null);
            return;
        }

        setDetailLoading(true);
        try {
            const response = await orderAiTrainingApi.getOne(id);
            setSelectedRecord(response.data?.data || null);
        } catch (error) {
            console.error('Error fetching AI training detail', error);
            setSelectedRecord(null);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const loadDefinitionGlossary = useCallback(async () => {
        setDefinitionLoading(true);
        try {
            const response = await orderAiTrainingApi.getDefinitions();
            const payload = response.data?.data || {};
            const nextDefinitionText = String(payload.definition_text || '').trim();

            setDefinitionText(nextDefinitionText);
            setDefinitionSavedText(nextDefinitionText);
            setDefinitionUpdatedAt(String(payload.updated_at || '').trim());
        } catch (error) {
            console.error('Error fetching shared AI definitions', error);
            setDefinitionText('');
            setDefinitionSavedText('');
            setDefinitionUpdatedAt('');
        } finally {
            setDefinitionLoading(false);
        }
    }, []);

    useEffect(() => {
        const timerId = window.setTimeout(() => loadList(filters), 220);
        return () => window.clearTimeout(timerId);
    }, [filters, loadList]);

    useEffect(() => {
        loadDetail(selectedId);
    }, [selectedId, loadDetail]);

    useEffect(() => {
        loadDefinitionGlossary();
    }, [loadDefinitionGlossary]);

    const canSave = useMemo(() => (
        String(form?.rule_key || '').trim()
        && String(form?.altar_size_label || '').trim()
        && Array.isArray(form?.mapping_items)
        && form.mapping_items.length > 0
    ), [form]);
    const definitionEntriesCount = useMemo(
        () => splitDefinitionLines(definitionText).length,
        [definitionText]
    );
    const hasDefinitionChanges = definitionText.trim() !== definitionSavedText.trim();

    const appendLegacyDefinitions = useCallback((value) => {
        const mergedText = mergeDefinitionTexts(definitionText, value);
        setDefinitionText(mergedText);
        showToast?.({ type: 'success', message: 'Đã nạp định nghĩa cũ vào khu từ điển chung. Hãy bấm lưu để áp dụng.' });
    }, [definitionText, showToast]);

    const openCreateDrawer = (inputType) => {
        setForm(createEmptyForm(inputType));
        setEditorOpen(true);
    };

    const openEditDrawer = () => {
        if (!selectedRecord) return;
        setForm(hydrateForm(selectedRecord));
        setEditorOpen(true);
    };

    const handlePreview = async () => {
        if (!String(form?.altar_size_label || '').trim()) {
            showModal?.({
                title: 'Thiếu kích thước',
                content: 'Hãy nhập rule theo dạng "bàn 1m97, men lam" để hệ thống nhận ra kích thước ban thờ.',
                type: 'error',
            });
            return;
        }

        if (form?.input_type === 'text' && !String(form?.input_text || '').trim()) {
            showModal?.({ title: 'Thiếu text train', content: 'Hãy nhập nội dung text để AI phân tích.', type: 'error' });
            return;
        }

        if (form?.input_type === 'image' && !(form?.attachment instanceof File)) {
            showModal?.({
                title: 'Thiếu ảnh mới',
                content: String(form?.input_image_url || '').trim()
                    ? 'Nếu muốn AI đọc lại ảnh, hãy tải ảnh mới để cập nhật dữ liệu.'
                    : 'Hãy tải ảnh trước khi chạy AI.',
                type: 'error',
            });
            return;
        }

        setPreviewing(true);
        try {
            const payload = new FormData();
            payload.append('altar_size_label', String(form?.altar_size_label || '').trim());
            payload.append('input_type', form?.input_type === 'image' ? 'image' : 'text');
            payload.append(
                'input_text',
                form?.input_type === 'text'
                    ? String(form?.input_text || '').trim()
                    : String(form?.training_note || form?.rule_phrase || '').trim()
            );
            payload.append('definition_text', mergeDefinitionTexts(definitionText, form?.definition_text));

            if (form?.attachment instanceof File) {
                payload.append('attachment', form.attachment);
            }

            const response = await orderAiTrainingApi.preview(payload);
            const preview = response.data || {};

            setForm((prev) => ({
                ...prev,
                rule_key: String(prev.rule_key || '').trim() || String(preview.rule_key_suggestion || slugify(`${prev.altar_size_label}-${(preview.context_aliases || [])[0] || ''}`)).trim(),
                source_name: String(preview?.source?.name || prev.source_name || '').trim(),
                altar_size_aliases: prev.altar_size_aliases?.length ? prev.altar_size_aliases : normalizeOrderAiRuleAliasList(preview?.altar_size?.aliases || []),
                context_aliases: prev.context_aliases?.length ? prev.context_aliases : normalizeOrderAiRuleAliasList(preview?.context_aliases || []),
                parsed_result: preview?.parsed_result || preview,
                parsed_raw_text: String(preview?.raw_text || '').trim(),
                parsed_provider: String(preview?.provider || '').trim(),
                mapping_items: Array.isArray(preview?.items)
                    ? preview.items.map((item) => createOrderAiRuleItem({
                        ...item,
                        aliases: normalizeOrderAiRuleAliasList([...(item?.aliases || []), item?.parsed_name, item?.source_phrase]),
                    }))
                    : prev.mapping_items,
            }));

            showToast?.({ type: 'success', message: 'AI đã đọc xong dữ liệu train.' });
        } catch (error) {
            console.error('Error previewing AI training data', error);
            showModal?.({
                title: 'Không thể đọc dữ liệu train',
                content: error?.response?.data?.message || 'AI chưa đọc được dữ liệu vừa nhập.',
                type: 'error',
            });
        } finally {
            setPreviewing(false);
        }
    };

    const handleSaveDefinitions = async () => {
        setDefinitionSaving(true);
        try {
            const response = await orderAiTrainingApi.updateDefinitions({
                definition_text: definitionText,
            });
            const payload = response.data?.data || {};
            const nextDefinitionText = String(payload.definition_text || '').trim();

            setDefinitionText(nextDefinitionText);
            setDefinitionSavedText(nextDefinitionText);
            setDefinitionUpdatedAt(String(payload.updated_at || '').trim());
            showToast?.({ type: 'success', message: response.data?.message || 'Đã lưu từ điển AI dùng chung.' });
        } catch (error) {
            console.error('Error saving shared AI definitions', error);
            showModal?.({
                title: 'Không thể lưu từ điển AI',
                content: error?.response?.data?.message || 'Vui lòng kiểm tra lại phần định nghĩa và thử lại.',
                type: 'error',
            });
        } finally {
            setDefinitionSaving(false);
        }
    };

    const handleSave = async () => {
        if (!canSave) {
            showModal?.({
                title: 'Thiếu dữ liệu',
                content: 'Cần có rule hợp lệ, kích thước ban thờ và ít nhất 1 mapping sản phẩm trước khi lưu.',
                type: 'error',
            });
            return;
        }

        setSaving(true);
        try {
            const payload = buildMultipartPayload(form);
            const response = form?.id
                ? await orderAiTrainingApi.update(form.id, payload)
                : await orderAiTrainingApi.create(payload);
            const savedRecord = response.data?.data || null;

            setEditorOpen(false);
            if (savedRecord?.id) {
                setSelectedId(savedRecord.id);
            }
            await loadList({ ...filters });
            if (savedRecord?.id) {
                await loadDetail(savedRecord.id);
            }

            showToast?.({ type: 'success', message: response.data?.message || 'Đã lưu dữ liệu train AI.' });
        } catch (error) {
            console.error('Error saving AI training record', error);
            showModal?.({
                title: 'Không thể lưu dữ liệu train',
                content: error?.response?.data?.message || 'Hãy kiểm tra lại dữ liệu train và thử lại.',
                type: 'error',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedRecord || deleting) return;
        if (!window.confirm(`Xóa dữ liệu train "${selectedRecord.rule_key}"? AI sẽ ngừng dùng rule này ngay sau khi xóa.`)) {
            return;
        }

        setDeleting(true);
        try {
            await orderAiTrainingApi.destroy(selectedRecord.id);
            setSelectedRecord(null);
            setSelectedId(null);
            await loadList({ ...filters });
            showToast?.({ type: 'success', message: 'Đã xóa dữ liệu train AI.' });
        } catch (error) {
            console.error('Error deleting AI training record', error);
            showModal?.({
                title: 'Không thể xóa dữ liệu train',
                content: error?.response?.data?.message || 'Vui lòng thử lại sau.',
                type: 'error',
            });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/45">AI Search / Train Bàn Thờ</div>
                    <h1 className="mt-1 text-[24px] font-black text-primary">Quản lý dữ liệu train AI</h1>
                    <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-6 text-primary/60">
                        Mỗi bản ghi lưu input gốc, kết quả AI đọc được, mapping sản phẩm và rule key. Sửa hoặc xóa tại đây sẽ áp dụng ngay cho logic AI tìm nhanh đơn hàng.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => openCreateDrawer('text')} className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/30 hover:bg-primary/[0.04]">
                        <span className="material-symbols-outlined text-[16px]">text_fields</span>
                        Thêm text train
                    </button>
                    <button type="button" onClick={() => openCreateDrawer('image')} className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick">
                        <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                        Thêm ảnh train
                    </button>
                </div>
            </div>

            <div className={`${panelClassName} p-4`}>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px]">
                    <div className="space-y-3">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Từ điển AI dùng chung</div>
                            <div className="mt-1 text-[18px] font-black text-primary">Quản lý từ gọi vùng miền / viết tắt / tên quen</div>
                            <p className="mt-2 text-[13px] font-semibold leading-6 text-primary/60">
                                Khu này áp dụng chung cho lúc train dữ liệu và lúc “Tìm nhanh bằng AI”. Ví dụ: <span className="font-black text-primary/70">bình bông = lọ hoa</span>, <span className="font-black text-primary/70">ml = men lam</span>.
                            </p>
                        </div>
                        <textarea
                            value={definitionText}
                            onChange={(event) => setDefinitionText(event.target.value)}
                            placeholder={`Ví dụ:\nbình bông = lọ hoa\nml = men lam\nmâm trái cây = mâm bồng`}
                            className="min-h-[176px] w-full rounded-sm border border-primary/15 bg-[#FAF8F3] px-3 py-3 text-[13px] font-semibold leading-6 text-[#0F172A] shadow-sm transition-all focus:border-primary/35 focus:outline-none resize-y"
                        />
                    </div>

                    <div className="rounded-sm border border-primary/10 bg-[#FAF8F3] p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Áp dụng</div>
                        <div className="mt-2 text-[13px] font-semibold leading-6 text-primary/65">
                            Train text
                            <br />
                            Train ảnh
                            <br />
                            Tìm nhanh bằng AI
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <div className="rounded-sm border border-primary/10 bg-white px-3 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Số dòng định nghĩa</div>
                                <div className="mt-1 text-[22px] font-black text-primary">{definitionEntriesCount}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-white px-3 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Cập nhật gần nhất</div>
                                <div className="mt-1 text-[12px] font-semibold leading-5 text-primary/60">
                                    {definitionLoading ? 'Đang tải...' : formatDateTime(definitionUpdatedAt)}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 text-[11px] font-semibold leading-5 text-primary/45">
                            Mỗi dòng theo dạng <span className="font-black text-primary/65">từ khách hay gọi = tên chuẩn</span>. Khi sửa xong, bấm lưu để toàn bộ AI dùng ngay.
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSaveDefinitions}
                                disabled={definitionLoading || definitionSaving || !hasDefinitionChanges}
                                className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <span className={`material-symbols-outlined text-[16px] ${definitionSaving ? 'animate-spin' : ''}`}>{definitionSaving ? 'progress_activity' : 'save'}</span>
                                {definitionSaving ? 'Đang lưu' : 'Lưu từ điển AI'}
                            </button>
                            <button
                                type="button"
                                onClick={loadDefinitionGlossary}
                                disabled={definitionLoading || definitionSaving}
                                className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/30 hover:bg-primary/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined text-[16px]">refresh</span>
                                Tải lại
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className={`${panelClassName} p-4`}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_180px_170px_auto]">
                    <input type="text" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value, page: 1 }))} placeholder="Tìm theo rule key, text train, ghi chú..." className={inputClassName} />
                    <input type="text" value={filters.altar_size} onChange={(event) => setFilters((prev) => ({ ...prev, altar_size: event.target.value, page: 1 }))} placeholder="Lọc kích thước" className={inputClassName} />
                    <select value={filters.input_type} onChange={(event) => setFilters((prev) => ({ ...prev, input_type: event.target.value, page: 1 }))} className={inputClassName}>
                        <option value="all">Tất cả loại dữ liệu</option>
                        <option value="text">Text</option>
                        <option value="image">Ảnh</option>
                    </select>
                    <button type="button" onClick={() => loadList(filters)} className="inline-flex h-10 items-center justify-center rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/30 hover:bg-primary/[0.04]">
                        Tải lại
                    </button>
                </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                <div className={panelClassName}>
                    <div className="flex items-center justify-between gap-3 border-b border-primary/10 bg-primary/[0.02] px-4 py-3">
                        <div className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Danh sách dữ liệu train</div>
                        <div className="text-[11px] font-semibold text-primary/45">{pagination.total} bản ghi</div>
                    </div>
                    <div className="min-h-[520px]">
                        {loading ? (
                            <div className="px-4 py-10 text-center text-[13px] font-semibold text-primary/45">Đang tải dữ liệu train...</div>
                        ) : records.length === 0 ? (
                            <div className="px-4 py-10 text-center text-[13px] font-semibold text-primary/35">Chưa có dữ liệu train nào khớp bộ lọc hiện tại.</div>
                        ) : (
                            <div className="divide-y divide-primary/10">
                                {records.map((record) => (
                                    <button key={record.id} type="button" onClick={() => setSelectedId(record.id)} className={`grid w-full gap-3 px-4 py-4 text-left transition-all hover:bg-primary/[0.025] md:grid-cols-[minmax(0,1.1fr)_120px_140px_170px] ${selectedId === record.id ? 'bg-sky-50/80' : 'bg-white'}`}>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="truncate text-[13px] font-black text-primary">{record.rule_key}</div>
                                                <span className="rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-primary/65">{record.input_type === 'image' ? 'Ảnh' : 'Text'}</span>
                                            </div>
                                            <div className="mt-1 text-[12px] font-semibold text-[#0F172A]">{record.altar_size_label}</div>
                                            <div className="mt-2 line-clamp-2 text-[12px] font-semibold text-primary/50">{record.input_excerpt || 'Không có preview nội dung.'}</div>
                                        </div>
                                        <div className="text-[12px] font-semibold text-primary/60">
                                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/35">Map</div>
                                            <div className="mt-1">{record.items_count || 0} SP</div>
                                            <div className="mt-1 line-clamp-2 text-[11px] text-primary/45">{(record.mapping_summary || []).join(', ')}</div>
                                        </div>
                                        <div className="text-[12px] font-semibold text-primary/60">
                                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/35">Tạo</div>
                                            <div className="mt-1">{formatDateTime(record.created_at)}</div>
                                        </div>
                                        <div className="text-[12px] font-semibold text-primary/60">
                                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/35">Cập nhật</div>
                                            <div className="mt-1">{formatDateTime(record.updated_at)}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-primary/10 px-4 py-3">
                        <div className="text-[11px] font-semibold text-primary/45">{`Trang ${pagination.current_page} / ${pagination.last_page}`}</div>
                        <div className="flex items-center gap-2">
                            <button type="button" disabled={pagination.current_page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))} className="inline-flex h-9 items-center rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/60 transition-all hover:text-primary disabled:cursor-not-allowed disabled:opacity-35">
                                Trước
                            </button>
                            <button type="button" disabled={pagination.current_page >= pagination.last_page} onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(pagination.last_page, prev.page + 1) }))} className="inline-flex h-9 items-center rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/60 transition-all hover:text-primary disabled:cursor-not-allowed disabled:opacity-35">
                                Sau
                            </button>
                        </div>
                    </div>
                </div>

                <div className={panelClassName}>
                    <div className="flex items-center justify-between gap-3 border-b border-primary/10 bg-primary/[0.02] px-4 py-3">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Chi tiết dữ liệu train</div>
                            <div className="mt-1 text-[16px] font-black text-primary">{selectedRecord?.rule_key || 'Chưa chọn bản ghi'}</div>
                        </div>
                        {selectedRecord && (
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={openEditDrawer} className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/15 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/30 hover:bg-primary/[0.04]">
                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                    Sửa
                                </button>
                                <button type="button" onClick={handleDelete} disabled={deleting} className="inline-flex h-9 items-center gap-1 rounded-sm border border-brick/15 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-brick transition-all hover:bg-brick hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                                    <span className="material-symbols-outlined text-[14px]">delete</span>
                                    Xóa
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="min-h-[520px] p-4">
                        {detailLoading ? (
                            <div className="py-10 text-center text-[13px] font-semibold text-primary/45">Đang tải chi tiết...</div>
                        ) : !selectedRecord ? (
                            <div className="py-10 text-center text-[13px] font-semibold text-primary/35">Chọn một dữ liệu train ở bảng bên trái để xem chi tiết.</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="rounded-sm border border-primary/10 bg-[#FAF8F3] px-3 py-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Kích thước / rule</div>
                                        <div className="mt-2 text-[15px] font-black text-primary">{selectedRecord.altar_size_label}</div>
                                        <div className="mt-1 text-[12px] font-semibold text-primary/55">{selectedRecord.rule_key}</div>
                                        {(selectedRecord.context_aliases || []).length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {(selectedRecord.context_aliases || []).map((alias) => (
                                                    <span key={alias} className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-primary/60">{alias}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="rounded-sm border border-primary/10 bg-[#FAF8F3] px-3 py-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Thời gian</div>
                                        <div className="mt-2 text-[12px] font-semibold text-primary/60">Tạo: {formatDateTime(selectedRecord.created_at)}</div>
                                        <div className="mt-1 text-[12px] font-semibold text-primary/60">Cập nhật: {formatDateTime(selectedRecord.updated_at)}</div>
                                        <div className="mt-1 text-[12px] font-semibold text-primary/60">Loại dữ liệu: {selectedRecord.input_type === 'image' ? 'Ảnh upload' : 'Text nhập tay'}</div>
                                    </div>
                                </div>

                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Nội dung gốc</div>
                                    {selectedRecord.input_type === 'image' ? (
                                        selectedRecord.input_image_url ? (
                                            <div className="mt-3 overflow-hidden rounded-sm border border-primary/10 bg-[#EEE8DD]">
                                                <img src={selectedRecord.input_image_url} alt="" className="max-h-[280px] w-full object-contain" />
                                            </div>
                                        ) : (
                                            <div className="mt-3 text-[12px] font-semibold text-primary/35">Không còn ảnh gốc.</div>
                                        )
                                    ) : (
                                        <div className="mt-3 whitespace-pre-wrap rounded-sm border border-primary/10 bg-[#FAF8F3] px-3 py-3 text-[12px] font-semibold leading-6 text-[#0F172A]">
                                            {selectedRecord.input_text || 'Không có text gốc.'}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Kết quả AI đã đọc</div>
                                    <div className="mt-3 whitespace-pre-wrap rounded-sm border border-primary/10 bg-[#FAF8F3] px-3 py-3 text-[12px] font-semibold leading-6 text-[#0F172A]">
                                        {selectedRecord.ai_result?.raw_text || selectedRecord.parsed_raw_text || 'Chưa có kết quả AI.'}
                                    </div>
                                    {(selectedRecord.ai_result?.result?.extracted_items || []).length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {(selectedRecord.ai_result.result.extracted_items || []).map((item) => (
                                                <span key={item.line_key} className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800">
                                                    {`${item.quantity || 1} x ${item.parsed_name || item.source_phrase}`}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {String(selectedRecord.definition_text || '').trim() && (
                                    <div className="rounded-sm border border-amber-200 bg-amber-50 p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-800/70">Định nghĩa riêng theo mẫu cũ</div>
                                                <div className="mt-1 text-[12px] font-semibold leading-6 text-amber-900/80">
                                                    Bản ghi này đang có định nghĩa riêng từ dữ liệu cũ. Phần quản lý chính hiện nằm ở khu “Từ điển AI dùng chung”.
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => appendLegacyDefinitions(selectedRecord.definition_text)}
                                                className="inline-flex h-9 items-center gap-2 rounded-sm border border-amber-300 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800 transition-all hover:bg-amber-100"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">playlist_add</span>
                                                Nạp lên từ điển chung
                                            </button>
                                        </div>
                                        <div className="mt-3 whitespace-pre-wrap rounded-sm border border-amber-200 bg-white px-3 py-3 text-[12px] font-semibold leading-6 text-[#0F172A]">
                                            {selectedRecord.definition_text}
                                        </div>
                                    </div>
                                )}

                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/35">Sản phẩm đã map</div>
                                    <div className="mt-3 space-y-3">
                                        {(selectedRecord.mapping_items || []).length > 0 ? (selectedRecord.mapping_items || []).map((item) => (
                                            <div key={item.id} className="rounded-sm border border-primary/10 bg-[#FAF8F3] px-3 py-3">
                                                <div className="text-[13px] font-black text-[#0F172A]">{item.display_name}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-primary/50">
                                                    {item.display_sku && <span>{item.display_sku}</span>}
                                                    {item.option_label && <span>{item.option_label}</span>}
                                                    <span>SL mặc định: {item.default_quantity || 1}</span>
                                                </div>
                                                {(item.aliases || []).length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {(item.aliases || []).map((alias) => (
                                                            <span key={alias} className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-primary/60">{alias}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )) : (
                                            <div className="text-[12px] font-semibold text-primary/35">Chưa có mapping sản phẩm.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <AiTrainingEditorDrawer
                open={editorOpen}
                form={form}
                setForm={setForm}
                onClose={() => setEditorOpen(false)}
                onPreview={handlePreview}
                onSave={handleSave}
                previewing={previewing}
                saving={saving}
                showModal={showModal}
            />
        </div>
    );
};

export default AiTrainingManager;

