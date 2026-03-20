import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { leadApi } from '../../services/api';

const inputClassName = 'w-full h-10 rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] shadow-sm transition-all focus:border-primary/30 focus:outline-none';
const textareaClassName = 'w-full min-h-[132px] rounded-sm border border-primary/10 bg-white px-3 py-2 text-[13px] text-[#0F172A] shadow-sm transition-all focus:border-primary/30 focus:outline-none resize-none';
const buttonClassName = 'inline-flex h-10 items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 text-[12px] font-black uppercase tracking-[0.08em] text-primary/80 shadow-sm transition-all hover:border-primary/30 hover:text-primary';
const iconButtonClassName = 'relative inline-flex size-10 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/70 shadow-sm transition-all hover:border-primary/30 hover:text-primary';
const MAX_NOTIFICATION_ITEMS = 12;
const emptyFilters = { status: '', tag: '', date_from: '', date_to: '' };

const formatMoney = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;

const parsePageParam = (value) => {
    const page = Number.parseInt(value, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
};

const normalizeSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();

const areFiltersEqual = (left, right) => (
    left.status === right.status
    && left.tag === right.tag
    && left.date_from === right.date_from
    && left.date_to === right.date_to
);

const buildFiltersFromParams = (searchParams) => ({
    status: searchParams.get('status') || '',
    tag: searchParams.get('tag') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
});

const buildQueryParams = (page, filters, quickSearch) => {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (filters.status) params.set('status', filters.status);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    if (quickSearch.trim()) params.set('search', quickSearch.trim());
    return params;
};

const leadMatchesSearch = (lead, search) => {
    const normalizedSearch = normalizeSearchText(search);
    if (!normalizedSearch) return true;

    const values = [
        lead?.lead_number,
        lead?.customer_name,
        lead?.phone,
        lead?.email,
        lead?.address,
        lead?.product_summary,
        lead?.latest_note_excerpt,
        lead?.order_number,
        lead?.tag,
        lead?.link_url,
        ...(Array.isArray(lead?.items)
            ? lead.items.flatMap((item) => [item?.product_name, item?.product_sku])
            : []),
    ];

    return values.some((value) => normalizeSearchText(value).includes(normalizedSearch));
};

const leadMatchesFilters = (lead, filters, quickSearch) => {
    if (!leadMatchesSearch(lead, quickSearch)) return false;

    if (filters.status) {
        const matchesStatus = String(lead?.lead_status_id ?? lead?.status_config?.id ?? '') === String(filters.status)
            || String(lead?.status ?? '') === String(filters.status)
            || String(lead?.status_config?.code ?? '') === String(filters.status);

        if (!matchesStatus) return false;
    }

    if (filters.tag && String(lead?.tag ?? '') !== String(filters.tag)) return false;

    const placedDate = String(lead?.placed_date || '').slice(0, 10);
    if (filters.date_from && placedDate && placedDate < filters.date_from) return false;
    if (filters.date_to && placedDate && placedDate > filters.date_to) return false;

    return true;
};

const mergeLeadCollections = (incoming, current, perPage = 20) => {
    const map = new Map();
    [...incoming, ...current].forEach((lead) => {
        if (lead?.id) map.set(lead.id, lead);
    });

    return Array.from(map.values())
        .sort((left, right) => {
            const leftTime = new Date(left?.placed_at || left?.created_at || 0).getTime();
            const rightTime = new Date(right?.placed_at || right?.created_at || 0).getTime();

            if (leftTime === rightTime) return Number(right?.id || 0) - Number(left?.id || 0);
            return rightTime - leftTime;
        })
        .slice(0, perPage);
};

const mergeNotificationItems = (incoming, current) => {
    const map = new Map();
    [...incoming, ...current].forEach((lead) => {
        if (lead?.id) map.set(lead.id, lead);
    });

    return Array.from(map.values())
        .sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0))
        .slice(0, MAX_NOTIFICATION_ITEMS);
};

const ProductCell = ({ lead }) => {
    if (Array.isArray(lead?.items) && lead.items.length > 0) {
        return (
            <div className="space-y-1">
                {lead.items.slice(0, 2).map((item) => (
                    <div key={item.id || `${item.product_sku}-${item.product_name}`} className="text-[13px] text-[#0F172A]">
                        <span className="font-semibold">{item.product_name || item.product_sku || 'Không có sản phẩm'}</span>
                        {item.product_sku ? <span className="text-primary/50"> ({item.product_sku})</span> : null}
                        <span className="text-primary/60"> x{item.quantity || 1}</span>
                    </div>
                ))}
                {lead.items.length > 2 ? (
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                        +{lead.items.length - 2} sản phẩm khác
                    </div>
                ) : null}
            </div>
        );
    }

    return <div className="text-[13px] text-primary/50">{lead?.product_summary || 'Không có sản phẩm'}</div>;
};

const FilterPanel = ({ filters, draftFilters, statuses, tags, onDraftChange, onApply, onReset }) => (
    <div className="grid gap-4 border-t border-primary/10 bg-[#f8fafc] px-4 py-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Trạng thái</label>
            <select
                value={draftFilters.status}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, status: event.target.value }))}
                className={inputClassName}
            >
                <option value="">Tất cả trạng thái</option>
                {statuses.map((status) => (
                    <option key={status.id} value={status.id}>{status.name}</option>
                ))}
            </select>
        </div>

        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tag</label>
            <select
                value={draftFilters.tag}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, tag: event.target.value }))}
                className={inputClassName}
            >
                <option value="">Tất cả tag</option>
                {tags.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                ))}
            </select>
        </div>

        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Từ ngày</label>
            <input
                type="date"
                value={draftFilters.date_from}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, date_from: event.target.value }))}
                className={inputClassName}
            />
        </div>

        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Đến ngày</label>
            <input
                type="date"
                value={draftFilters.date_to}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, date_to: event.target.value }))}
                className={inputClassName}
            />
        </div>

        <div className="flex items-end gap-2">
            <button type="button" onClick={onApply} className={`${buttonClassName} bg-primary text-white hover:bg-primary/90 hover:text-white`}>
                Áp dụng
            </button>
            <button type="button" onClick={() => onReset(filters)} className={buttonClassName}>
                Đặt lại
            </button>
        </div>
    </div>
);

const NotesModal = ({ lead, onClose, onSaved, currentUserName }) => {
    const { showModal, showToast } = useUI();
    const [notes, setNotes] = useState([]);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const fetchNotes = useCallback(async () => {
        try {
            setLoading(true);
            const response = await leadApi.getNotes(lead.id);
            setNotes(response.data?.data || []);
        } catch (error) {
            console.error('Failed to load lead notes', error);
            showModal({ title: 'Lỗi', content: 'Không thể tải lịch sử ghi chú.', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [lead.id, showModal]);

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!content.trim()) {
            showToast({ message: 'Vui lòng nhập nội dung ghi chú.', type: 'warning' });
            return;
        }

        try {
            setSaving(true);
            const response = await leadApi.addNote(lead.id, { content: content.trim() });
            const nextNote = response.data;
            setNotes((prev) => [nextNote, ...prev]);
            setContent('');
            showToast({ message: 'Đã lưu ghi chú lead.', type: 'success' });
            onSaved?.(nextNote);
        } catch (error) {
            console.error('Failed to save lead note', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu ghi chú lead.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4">
            <div className="w-full max-w-5xl overflow-hidden rounded-sm border border-primary/10 bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-primary/10 px-6 py-5">
                    <div>
                        <h2 className="text-[24px] font-black uppercase tracking-[0.06em] text-primary">Lịch sử ghi chú</h2>
                        <p className="mt-1 text-[13px] text-primary/55">
                            {lead.customer_name || 'Khách chưa có tên'}
                            {lead.phone ? ` - ${lead.phone}` : ''}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className={iconButtonClassName} title="Đóng">
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="grid gap-0 lg:grid-cols-[1.35fr_0.85fr]">
                    <div className="max-h-[520px] overflow-y-auto border-b border-primary/10 p-6 lg:border-b-0 lg:border-r">
                        {loading ? (
                            <div className="py-10 text-center text-[13px] font-semibold text-primary/55">Đang tải ghi chú...</div>
                        ) : notes.length === 0 ? (
                            <div className="py-10 text-center text-[13px] font-semibold text-primary/55">Chưa có ghi chú nào cho lead này.</div>
                        ) : (
                            <div className="space-y-4">
                                {notes.map((note) => (
                                    <div key={note.id} className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">
                                            <span>{note.staff_name || 'Nhân viên'}</span>
                                            <span>{note.created_label || ''}</span>
                                        </div>
                                        <div className="whitespace-pre-wrap text-[13px] leading-6 text-[#0F172A]">{note.content}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4 p-6">
                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/50">Người ghi chú</div>
                            <div className="mt-1 text-[14px] font-semibold text-[#0F172A]">{currentUserName || 'Nhân viên'}</div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Nội dung ghi chú</label>
                            <textarea
                                value={content}
                                onChange={(event) => setContent(event.target.value)}
                                className={textareaClassName}
                                placeholder="Nhập ghi chú xử lý lead..."
                            />
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="inline-flex h-11 items-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-[0.08em] text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className="material-symbols-outlined text-[18px]">save</span>
                                {saving ? 'Đang lưu...' : 'Lưu ghi chú'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

const LeadSettingsModal = ({ open, onClose, statuses, staffs, tagRules, onReload }) => {
    const { showModal, showToast } = useUI();
    const [tab, setTab] = useState('status');
    const [statusForm, setStatusForm] = useState({ name: '', code: '', color: '#1f3b73', blocks_order_create: false, is_default: false, is_active: true });
    const [staffForm, setStaffForm] = useState({ name: '', is_active: true });
    const [tagRuleForm, setTagRuleForm] = useState({ tag: '', match_type: 'contains', pattern: '', priority: 0, notes: '', is_active: true });
    const [busy, setBusy] = useState(false);

    if (!open) return null;

    const handleDelete = async (type, item) => {
        try {
            setBusy(true);
            if (type === 'status') await leadApi.deleteStatusConfig(item.id);
            if (type === 'staff') await leadApi.deleteStaff(item.id);
            if (type === 'tag-rule') await leadApi.deleteTagRule(item.id);
            showToast({ message: 'Đã xóa cấu hình lead.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to delete lead setting', error);
            const message = error?.response?.data?.message || 'Không thể xóa cấu hình này.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleCreateStatus = async (event) => {
        event.preventDefault();
        try {
            setBusy(true);
            await leadApi.createStatus(statusForm);
            setStatusForm({ name: '', code: '', color: '#1f3b73', blocks_order_create: false, is_default: false, is_active: true });
            showToast({ message: 'Đã thêm trạng thái lead.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to create lead status', error);
            showModal({ title: 'Lỗi', content: 'Không thể thêm trạng thái lead.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleCreateStaff = async (event) => {
        event.preventDefault();
        try {
            setBusy(true);
            await leadApi.createStaff(staffForm);
            setStaffForm({ name: '', is_active: true });
            showToast({ message: 'Đã thêm nhân viên lead.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to create lead staff', error);
            showModal({ title: 'Lỗi', content: 'Không thể thêm nhân viên lead.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleCreateTagRule = async (event) => {
        event.preventDefault();
        try {
            setBusy(true);
            await leadApi.createTagRule(tagRuleForm);
            setTagRuleForm({ tag: '', match_type: 'contains', pattern: '', priority: 0, notes: '', is_active: true });
            showToast({ message: 'Đã thêm quy tắc tag.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to create tag rule', error);
            showModal({ title: 'Lỗi', content: 'Không thể thêm quy tắc tag.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
            <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-primary/10 bg-white shadow-2xl">
                <div className="flex items-center justify-between gap-4 border-b border-primary/10 px-6 py-5">
                    <div>
                        <h2 className="text-[24px] font-black uppercase tracking-[0.06em] text-primary">Cài đặt lead</h2>
                        <p className="mt-1 text-[13px] text-primary/55">Quản lý trạng thái, nhân viên và quy tắc gắn tag.</p>
                    </div>
                    <button type="button" onClick={onClose} className={iconButtonClassName} title="Đóng">
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="flex gap-2 border-b border-primary/10 px-6 py-3">
                    {[
                        { key: 'status', label: 'Trạng thái' },
                        { key: 'staff', label: 'Nhân viên' },
                        { key: 'tag-rule', label: 'Quy tắc tag' },
                    ].map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => setTab(item.key)}
                            className={`rounded-sm px-4 py-2 text-[12px] font-black uppercase tracking-[0.08em] transition-all ${
                                tab === item.key ? 'bg-primary text-white' : 'border border-primary/10 bg-white text-primary/70'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="border-b border-primary/10 p-6 lg:border-b-0 lg:border-r">
                        {tab === 'status' ? (
                            <form onSubmit={handleCreateStatus} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tên trạng thái</label>
                                    <input value={statusForm.name} onChange={(event) => setStatusForm((prev) => ({ ...prev, name: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Mã trạng thái</label>
                                    <input value={statusForm.code} onChange={(event) => setStatusForm((prev) => ({ ...prev, code: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Màu hiển thị</label>
                                    <input type="color" value={statusForm.color} onChange={(event) => setStatusForm((prev) => ({ ...prev, color: event.target.value }))} className="h-10 w-full rounded-sm border border-primary/10 bg-white px-2" />
                                </div>
                                <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                    <input type="checkbox" checked={statusForm.blocks_order_create} onChange={(event) => setStatusForm((prev) => ({ ...prev, blocks_order_create: event.target.checked }))} />
                                    Chặn tạo đơn khi lead ở trạng thái này
                                </label>
                                <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                    <input type="checkbox" checked={statusForm.is_default} onChange={(event) => setStatusForm((prev) => ({ ...prev, is_default: event.target.checked }))} />
                                    Đặt làm trạng thái mặc định
                                </label>
                                <button type="submit" disabled={busy} className={`${buttonClassName} bg-primary text-white hover:text-white`}>
                                    Thêm trạng thái
                                </button>
                            </form>
                        ) : null}

                        {tab === 'staff' ? (
                            <form onSubmit={handleCreateStaff} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tên nhân viên</label>
                                    <input value={staffForm.name} onChange={(event) => setStaffForm((prev) => ({ ...prev, name: event.target.value }))} className={inputClassName} />
                                </div>
                                <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                    <input type="checkbox" checked={staffForm.is_active} onChange={(event) => setStaffForm((prev) => ({ ...prev, is_active: event.target.checked }))} />
                                    Đang hoạt động
                                </label>
                                <button type="submit" disabled={busy} className={`${buttonClassName} bg-primary text-white hover:text-white`}>
                                    Thêm nhân viên
                                </button>
                            </form>
                        ) : null}

                        {tab === 'tag-rule' ? (
                            <form onSubmit={handleCreateTagRule} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tag</label>
                                    <input value={tagRuleForm.tag} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, tag: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Kiểu khớp</label>
                                    <select value={tagRuleForm.match_type} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, match_type: event.target.value }))} className={inputClassName}>
                                        <option value="contains">Chứa</option>
                                        <option value="equals">Bằng đúng</option>
                                        <option value="regex">Regex</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Mẫu so khớp</label>
                                    <input value={tagRuleForm.pattern} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, pattern: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Ghi chú</label>
                                    <textarea value={tagRuleForm.notes} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, notes: event.target.value }))} className={textareaClassName} />
                                </div>
                                <button type="submit" disabled={busy} className={`${buttonClassName} bg-primary text-white hover:text-white`}>
                                    Thêm quy tắc
                                </button>
                            </form>
                        ) : null}
                    </div>

                    <div className="min-h-0 overflow-y-auto p-6">
                        {tab === 'status' ? (
                            <div className="space-y-3">
                                {statuses.map((status) => (
                                    <div key={status.id} className="flex items-start justify-between gap-4 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex size-3 rounded-full" style={{ backgroundColor: status.color || '#1f3b73' }} />
                                                <div className="text-[14px] font-bold text-[#0F172A]">{status.name}</div>
                                            </div>
                                            <div className="mt-1 text-[12px] text-primary/55">{status.code}</div>
                                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                                                {status.is_default ? <span>Mặc định</span> : null}
                                                {status.blocks_order_create ? <span>Chặn tạo đơn</span> : null}
                                                {!status.is_active ? <span>Đang tắt</span> : null}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => handleDelete('status', status)} className={buttonClassName}>Xóa</button>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {tab === 'staff' ? (
                            <div className="space-y-3">
                                {staffs.map((staff) => (
                                    <div key={staff.id} className="flex items-center justify-between gap-4 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div>
                                            <div className="text-[14px] font-bold text-[#0F172A]">{staff.name}</div>
                                            <div className="mt-1 text-[12px] text-primary/55">{staff.is_active ? 'Đang hoạt động' : 'Đang tắt'}</div>
                                        </div>
                                        <button type="button" onClick={() => handleDelete('staff', staff)} className={buttonClassName}>Xóa</button>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {tab === 'tag-rule' ? (
                            <div className="space-y-3">
                                {tagRules.map((rule) => (
                                    <div key={rule.id} className="flex items-start justify-between gap-4 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div className="space-y-1">
                                            <div className="text-[14px] font-bold text-[#0F172A]">{rule.tag}</div>
                                            <div className="text-[12px] text-primary/55">{rule.match_type} - {rule.pattern}</div>
                                            {rule.notes ? <div className="text-[13px] text-[#0F172A]">{rule.notes}</div> : null}
                                        </div>
                                        <button type="button" onClick={() => handleDelete('tag-rule', rule)} className={buttonClassName}>Xóa</button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
};

const LeadList = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const { showModal, showToast } = useUI();

    const [loading, setLoading] = useState(true);
    const [statuses, setStatuses] = useState([]);
    const [staffs, setStaffs] = useState([]);
    const [tagRules, setTagRules] = useState([]);
    const [tags, setTags] = useState([]);
    const [leads, setLeads] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 20, total: 0 });
    const [latestId, setLatestId] = useState(0);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [notesLead, setNotesLead] = useState(null);
    const [newLeadItems, setNewLeadItems] = useState([]);
    const [newLeadCount, setNewLeadCount] = useState(0);
    const [page, setPage] = useState(parsePageParam(searchParams.get('page')));
    const [filters, setFilters] = useState(() => buildFiltersFromParams(searchParams));
    const [draftFilters, setDraftFilters] = useState(() => buildFiltersFromParams(searchParams));
    const [quickSearch, setQuickSearch] = useState(searchParams.get('search') || '');
    const [debouncedQuickSearch, setDebouncedQuickSearch] = useState(searchParams.get('search') || '');
    const [highlightedLeadId, setHighlightedLeadId] = useState(null);
    const [pendingFocusLeadId, setPendingFocusLeadId] = useState(null);

    const notificationPanelRef = useRef(null);
    const latestIdRef = useRef(0);
    const pageRef = useRef(page);
    const filtersRef = useRef(filters);
    const searchRef = useRef(debouncedQuickSearch);
    const paginationRef = useRef(pagination);
    const leadsRef = useRef(leads);
    const fetchSeqRef = useRef(0);
    const abortControllerRef = useRef(null);
    const highlightTimeoutRef = useRef(null);

    const totalAcrossStatuses = useMemo(
        () => statuses.reduce((sum, status) => sum + Number(status.count || 0), 0),
        [statuses]
    );

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedQuickSearch(quickSearch.trim());
        }, 300);

        return () => window.clearTimeout(timer);
    }, [quickSearch]);

    useEffect(() => {
        const nextPage = parsePageParam(searchParams.get('page'));
        const nextFilters = buildFiltersFromParams(searchParams);
        const nextSearch = searchParams.get('search') || '';

        setPage((prev) => (prev === nextPage ? prev : nextPage));
        setFilters((prev) => (areFiltersEqual(prev, nextFilters) ? prev : nextFilters));
        setDraftFilters((prev) => (areFiltersEqual(prev, nextFilters) ? prev : nextFilters));
        setQuickSearch((prev) => (prev === nextSearch ? prev : nextSearch));
        setDebouncedQuickSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    }, [searchParams]);

    useEffect(() => { pageRef.current = page; }, [page]);
    useEffect(() => { filtersRef.current = filters; }, [filters]);
    useEffect(() => { searchRef.current = debouncedQuickSearch; }, [debouncedQuickSearch]);
    useEffect(() => { paginationRef.current = pagination; }, [pagination]);
    useEffect(() => { leadsRef.current = leads; }, [leads]);
    useEffect(() => { latestIdRef.current = latestId; }, [latestId]);

    useEffect(() => {
        const nextParams = buildQueryParams(page, filters, debouncedQuickSearch);
        const nextSearchString = nextParams.toString();
        const currentSearchString = location.search.startsWith('?') ? location.search.slice(1) : location.search;

        if (nextSearchString !== currentSearchString) {
            setSearchParams(nextParams, { replace: true });
        }
    }, [page, filters, debouncedQuickSearch, location.search, setSearchParams]);

    const focusLeadRow = useCallback((leadId) => {
        if (!leadId) return false;
        const row = document.getElementById(`lead-row-${leadId}`);
        if (!row) return false;

        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedLeadId(leadId);

        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = window.setTimeout(() => {
            setHighlightedLeadId((prev) => (prev === leadId ? null : prev));
        }, 2200);

        return true;
    }, []);

    const reloadSettings = useCallback(async () => {
        try {
            const [staffResponse, tagRuleResponse, statusResponse] = await Promise.all([
                leadApi.getStaffs(),
                leadApi.getTagRules(),
                leadApi.getStatuses(),
            ]);

            setStaffs(staffResponse.data || []);
            setTagRules(tagRuleResponse.data || []);
            setStatuses((prev) => {
                const nextStatuses = statusResponse.data || [];
                return nextStatuses.length ? nextStatuses : prev;
            });
        } catch (error) {
            console.error('Failed to reload lead settings', error);
        }
    }, []);

    const fetchLeads = useCallback(async (targetPage = pageRef.current, options = {}) => {
        const { silent = false, replaceData = true } = options;
        const requestId = ++fetchSeqRef.current;

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        if (!silent) setLoading(true);

        try {
            const response = await leadApi.getAll({
                page: targetPage,
                per_page: paginationRef.current.per_page || 20,
                ...filtersRef.current,
                search: searchRef.current || undefined,
            }, controller.signal);

            if (requestId !== fetchSeqRef.current) return null;

            const payload = response.data || {};
            const nextLeads = payload.data || [];

            setPagination({
                current_page: payload.current_page || targetPage,
                last_page: payload.last_page || 1,
                per_page: payload.per_page || paginationRef.current.per_page || 20,
                total: payload.total || 0,
            });
            setStatuses(payload.statuses || []);
            setTags(payload.tags || []);
            setLatestId(payload.latest_id || 0);
            if (replaceData) setLeads(nextLeads);

            return payload;
        } catch (error) {
            if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return null;
            console.error('Failed to fetch leads', error);
            if (!silent) showModal({ title: 'Lỗi', content: 'Không thể tải danh sách lead.', type: 'error' });
            return null;
        } finally {
            if (!silent) setLoading(false);
        }
    }, [showModal]);

    useEffect(() => {
        fetchLeads(page, { silent: false, replaceData: true });
    }, [page, filters, debouncedQuickSearch, fetchLeads]);

    useEffect(() => {
        reloadSettings();
    }, [reloadSettings]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (notificationPanelRef.current && !notificationPanelRef.current.contains(event.target)) {
                setNotificationsOpen(false);
            }
        };

        if (notificationsOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [notificationsOpen]);

    useEffect(() => {
        let isDisposed = false;

        const pollRealtime = async () => {
            try {
                const response = await leadApi.realtime({ after_id: latestIdRef.current || 0 });
                if (isDisposed) return;

                const payload = response.data || {};
                const incoming = payload.items || [];
                const nextLatestId = payload.latest_id || latestIdRef.current || 0;

                if (nextLatestId > latestIdRef.current) setLatestId(nextLatestId);
                if (!incoming.length) return;

                setNewLeadItems((prev) => mergeNotificationItems(incoming, prev));
                setNewLeadCount((prev) => prev + incoming.length);
                showToast({
                    message: incoming.length === 1
                        ? 'Có 1 lead mới vừa vào bảng xử lý.'
                        : `Có ${incoming.length} lead mới vừa vào bảng xử lý.`,
                    type: 'info',
                    duration: 2500,
                });

                const activePage = pageRef.current;
                const activeFilters = filtersRef.current;
                const activeSearch = searchRef.current;
                const matchedIncoming = incoming.filter((lead) => leadMatchesFilters(lead, activeFilters, activeSearch));

                if (activePage === 1 && matchedIncoming.length > 0) {
                    setLeads((prev) => mergeLeadCollections(matchedIncoming, prev, paginationRef.current.per_page || 20));
                }

                fetchLeads(activePage, { silent: true, replaceData: activePage === 1 && matchedIncoming.length === 0 });
            } catch (error) {
                console.error('Lead realtime polling failed', error);
            }
        };

        const intervalId = window.setInterval(pollRealtime, 2000);
        pollRealtime();

        return () => {
            isDisposed = true;
            window.clearInterval(intervalId);
        };
    }, [fetchLeads, showToast]);

    useEffect(() => {
        if (!pendingFocusLeadId) return;
        if (focusLeadRow(pendingFocusLeadId)) setPendingFocusLeadId(null);
    }, [focusLeadRow, leads, pendingFocusLeadId]);

    useEffect(() => () => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    }, []);

    const handleApplyFilters = () => {
        setPage(1);
        setFilters(draftFilters);
    };

    const handleResetFilters = useCallback(() => {
        setDraftFilters(emptyFilters);
        setFilters(emptyFilters);
        setPage(1);
    }, []);

    const handleStatusTabClick = (statusId) => {
        const nextFilters = { ...filtersRef.current, status: statusId ? String(statusId) : '' };
        setDraftFilters(nextFilters);
        setFilters(nextFilters);
        setPage(1);
    };

    const handleRefresh = () => {
        fetchLeads(pageRef.current, { silent: false, replaceData: true });
    };

    const handleLeadStatusChange = async (lead, nextStatusId) => {
        try {
            const response = await leadApi.update(lead.id, { lead_status_id: Number(nextStatusId) });
            const updatedLead = response.data;
            setLeads((prev) => prev.map((item) => (item.id === lead.id ? updatedLead : item)));
            fetchLeads(pageRef.current, { silent: true, replaceData: false });
            showToast({ message: 'Đã cập nhật trạng thái lead.', type: 'success', duration: 1500 });
        } catch (error) {
            console.error('Failed to update lead status', error);
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái lead.', type: 'error' });
        }
    };

    const handleOpenOrderForm = (lead) => {
        if (lead?.status_config?.blocks_order_create) {
            showModal({ title: 'Không thể tạo đơn', content: 'Trạng thái hiện tại của lead đang chặn thao tác tạo đơn.', type: 'warning' });
            return;
        }

        const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
        navigate(`/admin/orders/new?lead_id=${lead.id}&return_to=${returnTo}`);
    };

    const handleNotificationItemClick = (lead) => {
        setNotificationsOpen(false);
        setNewLeadCount(0);

        const existsInCurrentPage = leadsRef.current.some((item) => item.id === lead.id);
        if (pageRef.current !== 1 || !existsInCurrentPage) {
            setPendingFocusLeadId(lead.id);
            setPage(1);
            return;
        }

        focusLeadRow(lead.id);
    };

    const handleNoteSaved = (savedNote) => {
        setLeads((prev) => prev.map((lead) => (
            lead.id === notesLead?.id
                ? { ...lead, latest_note_excerpt: savedNote.latest_note_excerpt || savedNote.content }
                : lead
        )));
    };

    const tabItems = useMemo(() => ([
        { id: '', label: 'Tất cả', count: totalAcrossStatuses },
        ...statuses.map((status) => ({ id: String(status.id), label: status.name, count: Number(status.count || 0) })),
    ]), [statuses, totalAcrossStatuses]);

    return (
        <div className="min-h-full bg-[#fcfcfa] p-6">
            <div className="mx-auto max-w-[1600px] space-y-5">
                <div className="space-y-1">
                    <h1 className="text-[34px] font-black uppercase tracking-[0.04em] text-primary">Xử lý lead</h1>
                    <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-primary/45">
                        Lead đơn hàng từ website đổ realtime về sale dashboard
                    </p>
                </div>

                <div className="flex flex-wrap gap-3">
                    {tabItems.map((item) => {
                        const active = String(filters.status || '') === String(item.id || '');
                        return (
                            <button
                                key={String(item.id || 'all')}
                                type="button"
                                onClick={() => handleStatusTabClick(item.id)}
                                className={`rounded-full border px-4 py-3 text-[12px] font-black uppercase tracking-[0.08em] transition-all ${
                                    active
                                        ? 'border-primary bg-primary text-white shadow-sm'
                                        : 'border-primary/10 bg-white text-primary/70 hover:border-primary/25 hover:text-primary'
                                }`}
                            >
                                {item.label} ({item.count})
                            </button>
                        );
                    })}
                </div>

                <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-primary/10 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative" ref={notificationPanelRef}>
                                <button
                                    type="button"
                                    onClick={() => setNotificationsOpen((prev) => !prev)}
                                    className={iconButtonClassName}
                                    title="Thông báo lead mới"
                                >
                                    <span className="material-symbols-outlined text-[20px]">notifications</span>
                                    {newLeadCount > 0 ? (
                                        <span className="absolute -right-1 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-brick px-1.5 py-0.5 text-[10px] font-black text-white">
                                            {newLeadCount > 99 ? '99+' : newLeadCount}
                                        </span>
                                    ) : null}
                                </button>

                                {notificationsOpen ? (
                                    <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[360px] rounded-sm border border-primary/10 bg-white shadow-2xl">
                                        <div className="flex items-center justify-between border-b border-primary/10 px-4 py-3">
                                            <div>
                                                <div className="text-[13px] font-black uppercase tracking-[0.08em] text-primary">Lead mới về</div>
                                                <div className="text-[12px] text-primary/55">Badge sẽ tự xóa khi bạn đánh dấu đã xem.</div>
                                            </div>
                                            <button type="button" onClick={() => setNewLeadCount(0)} className="text-[12px] font-bold text-primary hover:text-brick">
                                                Đã xem
                                            </button>
                                        </div>

                                        <div className="max-h-[360px] overflow-y-auto">
                                            {newLeadItems.length === 0 ? (
                                                <div className="px-4 py-6 text-center text-[13px] text-primary/55">Chưa có lead mới.</div>
                                            ) : newLeadItems.map((lead) => (
                                                <button
                                                    key={lead.id}
                                                    type="button"
                                                    onClick={() => handleNotificationItemClick(lead)}
                                                    className="flex w-full items-start justify-between gap-3 border-b border-primary/10 px-4 py-3 text-left transition-all last:border-b-0 hover:bg-primary/[0.04]"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-[13px] font-bold text-[#0F172A]">{lead.customer_name || 'Khách chưa có tên'}</div>
                                                        <div className="mt-1 text-[12px] text-primary/60">{lead.phone || 'Chưa có số điện thoại'}</div>
                                                        <div className="mt-1 truncate text-[12px] text-primary/50">{lead.product_summary || 'Không có sản phẩm'}</div>
                                                    </div>
                                                    <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                                                        {lead.placed_time || lead.placed_date || 'Mới'}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <button type="button" onClick={() => setFiltersOpen((prev) => !prev)} className={buttonClassName}>
                                <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                                Bộ lọc
                            </button>

                            <button type="button" onClick={() => setSettingsOpen(true)} className={buttonClassName}>
                                <span className="material-symbols-outlined text-[18px]">settings</span>
                                Cài đặt lead
                            </button>

                            <button type="button" onClick={handleRefresh} className={buttonClassName}>
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                                Làm mới
                            </button>
                        </div>

                        <div className="w-full xl:ml-auto xl:max-w-[420px]">
                            <div className="relative">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                <input
                                    value={quickSearch}
                                    onChange={(event) => {
                                        setQuickSearch(event.target.value);
                                        setPage(1);
                                    }}
                                    className={`${inputClassName} pl-10`}
                                    placeholder="Tìm nhanh theo khách, SĐT, địa chỉ, mã đơn, ghi chú, sản phẩm..."
                                />
                            </div>
                        </div>
                    </div>

                    {filtersOpen ? (
                        <FilterPanel
                            filters={filters}
                            draftFilters={draftFilters}
                            statuses={statuses}
                            tags={tags}
                            onDraftChange={setDraftFilters}
                            onApply={handleApplyFilters}
                            onReset={handleResetFilters}
                        />
                    ) : null}

                    <div className="overflow-x-auto">
                        <table className="min-w-full table-fixed border-collapse">
                            <thead>
                                <tr className="border-b border-primary/10 bg-[#f8fafc] text-left">
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Thời gian đặt</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Sản phẩm</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Tên khách hàng</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Số điện thoại</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Địa chỉ</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Tag</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Trạng thái đơn</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Ghi chú</th>
                                    <th className="px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">Link</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55">
                                            Đang tải danh sách lead...
                                        </td>
                                    </tr>
                                ) : leads.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55">
                                            Không tìm thấy lead phù hợp với bộ lọc hiện tại.
                                        </td>
                                    </tr>
                                ) : leads.map((lead) => (
                                    <tr
                                        key={lead.id}
                                        id={`lead-row-${lead.id}`}
                                        className={`border-b border-primary/10 align-top transition-all ${
                                            highlightedLeadId === lead.id ? 'bg-amber-50' : 'bg-white hover:bg-primary/[0.025]'
                                        }`}
                                        onDoubleClick={() => handleOpenOrderForm(lead)}
                                    >
                                        <td className="px-4 py-4 text-[13px] text-[#0F172A]">
                                            <div>{lead.placed_date || '-'}</div>
                                            <div className="mt-1 font-semibold text-primary/60">{lead.placed_time || '-'}</div>
                                            {lead.order_number ? (
                                                <div className="mt-2 text-[11px] font-black uppercase tracking-[0.08em] text-primary/40">{lead.order_number}</div>
                                            ) : null}
                                        </td>
                                        <td className="px-4 py-4"><ProductCell lead={lead} /></td>
                                        <td className="px-4 py-4 text-[13px] font-semibold text-[#0F172A]">{lead.customer_name || 'Khách chưa có tên'}</td>
                                        <td className="px-4 py-4 text-[13px] font-semibold text-[#0F172A]">{lead.phone || '-'}</td>
                                        <td className="px-4 py-4 text-[13px] text-[#0F172A]">{lead.address || '-'}</td>
                                        <td className="px-4 py-4">
                                            <span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-primary">
                                                {lead.tag || 'Website'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <select
                                                value={lead.status_config?.id || ''}
                                                onChange={(event) => handleLeadStatusChange(lead, event.target.value)}
                                                className={`${inputClassName} min-w-[190px]`}
                                            >
                                                {statuses.map((status) => (
                                                    <option key={status.id} value={status.id}>{status.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-4 py-4">
                                            <button type="button" onClick={() => setNotesLead(lead)} className="text-left">
                                                <div className="text-[12px] font-black uppercase tracking-[0.08em] text-primary">Chi tiết</div>
                                                <div className="mt-1 max-w-[220px] truncate text-[13px] text-primary/60">{lead.latest_note_excerpt || 'Chưa có ghi chú'}</div>
                                            </button>
                                        </td>
                                        <td className="px-4 py-4">
                                            {lead.link_url ? (
                                                <a
                                                    href={lead.link_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-[0.08em] text-primary transition-all hover:text-brick"
                                                >
                                                    Mở link
                                                    <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                                                </a>
                                            ) : (
                                                <span className="text-[13px] text-primary/40">Không có link</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-col gap-4 border-t border-primary/10 px-4 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="text-[13px] font-semibold text-primary/60">
                            Tổng giá trị lead đang xem: <span className="font-black text-primary">{formatMoney(leads.reduce((sum, lead) => sum + Number(lead.total_amount || 0), 0))}</span>
                        </div>
                        <div className="flex flex-col items-start gap-3 md:items-end">
                            <div className="text-[13px] font-semibold text-primary/60">
                                Tổng số đơn: <span className="font-black text-primary">{pagination.total || 0}</span>
                            </div>
                            <Pagination pagination={pagination} onPageChange={(nextPage) => setPage(nextPage)} />
                        </div>
                    </div>
                </div>
            </div>

            {notesLead ? (
                <NotesModal
                    lead={notesLead}
                    onClose={() => setNotesLead(null)}
                    onSaved={handleNoteSaved}
                    currentUserName={user?.name || ''}
                />
            ) : null}

            <LeadSettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                statuses={statuses}
                staffs={staffs}
                tagRules={tagRules}
                onReload={async () => {
                    await reloadSettings();
                    await fetchLeads(pageRef.current, { silent: true, replaceData: true });
                }}
            />
        </div>
    );
};

export default LeadList;
