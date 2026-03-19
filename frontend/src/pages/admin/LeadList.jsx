import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { leadApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';

const inputClassName = 'w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition-all focus:border-primary/40';
const buttonClassName = 'inline-flex items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:bg-primary/[0.04]';
const formatMoney = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));

const ProductCell = ({ lead }) => (
    <div className="group relative max-w-[260px]">
        <p className="truncate text-[13px] font-semibold text-slate-800" title={lead.product_summary || lead.product_summary_short || ''}>
            {lead.product_summary_short || lead.product_summary || 'Kh�ng c� s?n ph?m'}
        </p>
        <div className="pointer-events-none absolute left-0 top-full z-20 hidden w-[360px] rounded-sm border border-primary/15 bg-white p-3 text-[12px] leading-6 text-slate-700 shadow-xl group-hover:block">
            {lead.product_summary || lead.product_summary_short || 'Kh�ng c� s?n ph?m'}
        </div>
    </div>
);

const FilterPanel = ({ filters, onChange, statuses, tags, onApply, onReset }) => (
    <div className="grid grid-cols-1 gap-4 border border-primary/10 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-5">
        <input value={filters.search} onChange={(e) => onChange('search', e.target.value)} className={inputClassName} placeholder="T�m t�n, sdt, s?n ph?m, m� lead, link..." />
        <select value={filters.status} onChange={(e) => onChange('status', e.target.value)} className={inputClassName}>
            <option value="">T?t c? tr?ng th�i</option>
            {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>
        <select value={filters.tag} onChange={(e) => onChange('tag', e.target.value)} className={inputClassName}>
            <option value="">T?t c? tag</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <input type="datetime-local" value={filters.date_from} onChange={(e) => onChange('date_from', e.target.value)} className={inputClassName} />
        <input type="datetime-local" value={filters.date_to} onChange={(e) => onChange('date_to', e.target.value)} className={inputClassName} />
        <div className="flex items-center gap-2 xl:col-span-5">
            <button type="button" onClick={onApply} className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-[0.14em] text-white">L?c</button>
            <button type="button" onClick={onReset} className={buttonClassName}>�?t l?i</button>
        </div>
    </div>
);

const NotesModal = ({ lead, open, onClose, staffs, currentUserName, onSaved }) => {
    const [notes, setNotes] = useState([]);
    const [content, setContent] = useState('');
    const [staffName, setStaffName] = useState(currentUserName || '');

    const loadNotes = useCallback(async () => {
        if (!lead?.id) return;
        const response = await leadApi.getNotes(lead.id);
        setNotes(response.data?.data || []);
    }, [lead?.id]);

    useEffect(() => {
        if (open) {
            setContent('');
            setStaffName(currentUserName || '');
            loadNotes();
        }
    }, [open, loadNotes, currentUserName]);

    if (!open || !lead) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
            <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <div>
                        <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">L?ch s? ghi ch�</h3>
                        <p className="mt-1 text-[12px] text-slate-500">{lead.customer_name} - {lead.phone}</p>
                    </div>
                    <button type="button" onClick={onClose} className="size-9 rounded-full border border-primary/10 text-primary/60">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="overflow-y-auto border-r border-primary/10 p-5">
                        {notes.length === 0 ? <div className="py-12 text-center text-[12px] text-primary/40 italic">Chua c� ghi ch� n�o.</div> : (
                            <div className="space-y-4">
                                {notes.map((note) => (
                                    <div key={note.id} className="relative border-l-2 border-primary/20 pl-5">
                                        <span className="absolute -left-[7px] top-1 size-3 rounded-full bg-primary" />
                                        <div className="rounded-sm border border-primary/10 bg-primary/[0.02] p-4">
                                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-primary/45">
                                                <span>{note.staff_name || 'Nh�n vi�n'}</span>
                                                <span>{note.created_label}</span>
                                            </div>
                                            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">{note.content}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="space-y-4 p-5">
                        <select value={staffName} onChange={(e) => setStaffName(e.target.value)} className={inputClassName}>
                            <option value="">Ch?n nh�n vi�n</option>
                            {staffs.map((staff) => <option key={staff.id} value={staff.name}>{staff.name}</option>)}
                        </select>
                        <textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[220px] w-full rounded-sm border border-primary/15 bg-white px-3 py-3 text-[13px] leading-6 text-slate-800 outline-none focus:border-primary/40" placeholder="Nh?p ghi ch� x? l� lead..." />
                        <button type="button" onClick={async () => {
                            if (!content.trim()) return;
                            await leadApi.addNote(lead.id, { content: content.trim(), staff_name: staffName || currentUserName || 'Nh�n vi�n' });
                            await loadNotes();
                            setContent('');
                            onSaved();
                        }} className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-[0.14em] text-white">Luu ghi ch�</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LeadSettingsModal = ({ open, onClose, statuses, staffs, tagRules, onReload }) => {
    const [statusRows, setStatusRows] = useState([]);
    const [staffRows, setStaffRows] = useState([]);
    const [tagRuleRows, setTagRuleRows] = useState([]);

    useEffect(() => {
        setStatusRows(statuses);
        setStaffRows(staffs);
        setTagRuleRows(tagRules);
    }, [statuses, staffs, tagRules]);

    if (!open) return null;

    const persistStatus = async (row) => {
        const payload = { name: row.name, code: row.code, color: row.color, blocks_order_create: Boolean(row.blocks_order_create) };
        if (String(row.id).startsWith('new-')) await leadApi.createStatus(payload);
        else await leadApi.updateStatusConfig(row.id, payload);
        await onReload();
    };

    const persistStaff = async (row) => {
        const payload = { name: row.name };
        if (String(row.id).startsWith('new-')) await leadApi.createStaff(payload);
        else await leadApi.updateStaff(row.id, payload);
        await onReload();
    };

    const persistTagRule = async (row) => {
        const payload = { tag: row.tag, match_type: row.match_type, pattern: row.pattern, priority: Number(row.priority) || 0 };
        if (String(row.id).startsWith('new-')) await leadApi.createTagRule(payload);
        else await leadApi.updateTagRule(row.id, payload);
        await onReload();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
            <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <div>
                        <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">C�i d?t lead</h3>
                        <p className="mt-1 text-[12px] text-slate-500">Qu?n l� tr?ng th�i, nh�n vi�n v� quy t?c g?n tag theo link.</p>
                    </div>
                    <button type="button" onClick={onClose} className="size-9 rounded-full border border-primary/10 text-primary/60"><span className="material-symbols-outlined">close</span></button>
                </div>
                <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-5 xl:grid-cols-3">
                    <div className="space-y-3 rounded-sm border border-primary/10 p-4">
                        <div className="flex items-center justify-between"><h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Tr?ng th�i</h4><button type="button" onClick={() => setStatusRows((prev) => [...prev, { id: `new-${Date.now()}`, name: '', code: '', color: '#2563eb', blocks_order_create: false }])} className={buttonClassName}>Th�m</button></div>
                        {statusRows.map((row) => <div key={row.id} className="space-y-2 rounded-sm border border-primary/10 p-3"><input value={row.name || ''} onChange={(e) => setStatusRows((prev) => prev.map((item) => item.id === row.id ? { ...item, name: e.target.value } : item))} className={inputClassName} placeholder="T�n tr?ng th�i" /><div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2"><input value={row.code || ''} onChange={(e) => setStatusRows((prev) => prev.map((item) => item.id === row.id ? { ...item, code: e.target.value } : item))} className={inputClassName} placeholder="Code" /><input value={row.color || ''} onChange={(e) => setStatusRows((prev) => prev.map((item) => item.id === row.id ? { ...item, color: e.target.value } : item))} className={inputClassName} placeholder="#2563eb" /></div><label className="flex items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={Boolean(row.blocks_order_create)} onChange={(e) => setStatusRows((prev) => prev.map((item) => item.id === row.id ? { ...item, blocks_order_create: e.target.checked } : item))} /> Ch?n m? form t?o don</label><div className="flex gap-2"><button type="button" onClick={() => persistStatus(row)} className="inline-flex items-center rounded-sm bg-primary px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white">Luu</button><button type="button" onClick={async () => { if (String(row.id).startsWith('new-')) setStatusRows((prev) => prev.filter((item) => item.id !== row.id)); else { await leadApi.deleteStatusConfig(row.id); await onReload(); } }} className="inline-flex items-center rounded-sm border border-brick/20 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-brick">X�a</button></div></div>)}
                    </div>
                    <div className="space-y-3 rounded-sm border border-primary/10 p-4">
                        <div className="flex items-center justify-between"><h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Nh�n vi�n</h4><button type="button" onClick={() => setStaffRows((prev) => [...prev, { id: `new-${Date.now()}`, name: '' }])} className={buttonClassName}>Th�m</button></div>
                        {staffRows.map((row) => <div key={row.id} className="flex items-center gap-2 rounded-sm border border-primary/10 p-3"><input value={row.name || ''} onChange={(e) => setStaffRows((prev) => prev.map((item) => item.id === row.id ? { ...item, name: e.target.value } : item))} className={inputClassName} placeholder="T�n nh�n vi�n" /><button type="button" onClick={() => persistStaff(row)} className="inline-flex items-center rounded-sm bg-primary px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white">Luu</button><button type="button" onClick={async () => { if (String(row.id).startsWith('new-')) setStaffRows((prev) => prev.filter((item) => item.id !== row.id)); else { await leadApi.deleteStaff(row.id); await onReload(); } }} className="inline-flex items-center rounded-sm border border-brick/20 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-brick">X�a</button></div>)}
                    </div>
                    <div className="space-y-3 rounded-sm border border-primary/10 p-4">
                        <div className="flex items-center justify-between"><h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Tag theo link</h4><button type="button" onClick={() => setTagRuleRows((prev) => [...prev, { id: `new-${Date.now()}`, tag: '', match_type: 'contains', pattern: '', priority: 0 }])} className={buttonClassName}>Th�m</button></div>
                        {tagRuleRows.map((row) => <div key={row.id} className="space-y-2 rounded-sm border border-primary/10 p-3"><div className="grid grid-cols-2 gap-2"><input value={row.tag || ''} onChange={(e) => setTagRuleRows((prev) => prev.map((item) => item.id === row.id ? { ...item, tag: e.target.value } : item))} className={inputClassName} placeholder="Tag" /><select value={row.match_type || 'contains'} onChange={(e) => setTagRuleRows((prev) => prev.map((item) => item.id === row.id ? { ...item, match_type: e.target.value } : item))} className={inputClassName}><option value="contains">Contains</option><option value="exact">Exact</option><option value="starts_with">Starts with</option><option value="ends_with">Ends with</option><option value="regex">Regex</option></select></div><input value={row.pattern || ''} onChange={(e) => setTagRuleRows((prev) => prev.map((item) => item.id === row.id ? { ...item, pattern: e.target.value } : item))} className={inputClassName} placeholder="V� d?: fbclid ho?c utm_source=facebook" /><div className="flex gap-2"><input type="number" value={row.priority || 0} onChange={(e) => setTagRuleRows((prev) => prev.map((item) => item.id === row.id ? { ...item, priority: Number(e.target.value) || 0 } : item))} className={`${inputClassName} max-w-[120px]`} /><button type="button" onClick={() => persistTagRule(row)} className="inline-flex items-center rounded-sm bg-primary px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white">Luu</button><button type="button" onClick={async () => { if (String(row.id).startsWith('new-')) setTagRuleRows((prev) => prev.filter((item) => item.id !== row.id)); else { await leadApi.deleteTagRule(row.id); await onReload(); } }} className="inline-flex items-center rounded-sm border border-brick/20 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-brick">X�a</button></div></div>)}
                    </div>
                </div>
            </div>
        </div>
    );
};

const LeadList = () => {
    const navigate = useNavigate();
    const { showToast } = useUI();
    const { user } = useAuth();
    const [leads, setLeads] = useState([]);
    const [statuses, setStatuses] = useState([]);
    const [staffs, setStaffs] = useState([]);
    const [tagRules, setTagRules] = useState([]);
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [notesLead, setNotesLead] = useState(null);
    const [latestId, setLatestId] = useState(0);
    const [newLeadItems, setNewLeadItems] = useState([]);
    const [newLeadCount, setNewLeadCount] = useState(0);
    const [filters, setFilters] = useState({ search: '', status: '', tag: '', date_from: '', date_to: '' });

    const reloadSettings = useCallback(async () => {
        const [staffRes, tagRuleRes, statusRes] = await Promise.all([leadApi.getStaffs(), leadApi.getTagRules(), leadApi.getStatuses()]);
        setStaffs(staffRes.data || []);
        setTagRules(tagRuleRes.data || []);
        setStatuses(statusRes.data || []);
    }, []);

    const fetchLeads = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const response = await leadApi.getAll({ page, per_page: pagination.per_page, search: filters.search || undefined, status: filters.status || undefined, tag: filters.tag || undefined, date_from: filters.date_from || undefined, date_to: filters.date_to || undefined });
            setLeads(response.data.data || []);
            setPagination({ current_page: response.data.current_page, last_page: response.data.last_page, total: response.data.total, per_page: response.data.per_page });
            setStatuses(response.data.statuses || []);
            setTags(response.data.tags || []);
            setLatestId(response.data.latest_id || 0);
        } catch (error) {
            console.error('Failed to fetch leads', error);
            showToast('Kh�ng th? t?i b?ng lead.', 'error');
        } finally {
            setLoading(false);
        }
    }, [filters, pagination.per_page, showToast]);

    useEffect(() => { fetchLeads(1); reloadSettings(); }, [fetchLeads, reloadSettings]);

    useEffect(() => {
        const intervalId = window.setInterval(async () => {
            if (!latestId) return;
            try {
                const response = await leadApi.realtime({ after_id: latestId || 0 });
                const items = response.data?.items || [];
                if (items.length > 0) {
                    setLatestId(response.data.latest_id || latestId);
                    setNewLeadItems((prev) => [...items.reverse(), ...prev].slice(0, 10));
                    setNewLeadCount((prev) => prev + items.length);
                    showToast(`C� ${items.length} lead m?i v?a v�o b?ng x? l�.`, 'success');
                    fetchLeads(1);
                }
            } catch (error) {
                console.error('Realtime lead polling failed', error);
            }
        }, 8000);
        return () => window.clearInterval(intervalId);
    }, [latestId, fetchLeads, showToast]);

    const activeStatusLabel = useMemo(() => !filters.status ? 'T?t c? lead' : (statuses.find((status) => String(status.id) === String(filters.status))?.name || 'T?t c? lead'), [filters.status, statuses]);

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-[#fcfcfa] p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-black uppercase tracking-tight text-primary">X? l� lead</h1><p className="mt-1 text-[11px] font-black uppercase tracking-[0.2em] text-primary/35">Lead don h�ng t? website d? realtime v? sale dashboard</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setNewLeadCount(0)} className="relative inline-flex size-10 items-center justify-center rounded-full border border-primary/15 bg-white text-primary shadow-sm"><span className="material-symbols-outlined text-[20px]">notifications</span>{newLeadCount > 0 ? <span className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-brick px-1.5 py-0.5 text-center text-[10px] font-black text-white">{newLeadCount}</span> : null}</button><button type="button" onClick={() => setFiltersOpen((prev) => !prev)} className={buttonClassName}><span className="material-symbols-outlined text-[18px]">filter_alt</span>B? l?c</button><button type="button" onClick={() => setSettingsOpen(true)} className={buttonClassName}><span className="material-symbols-outlined text-[18px]">settings</span>C�i d?t lead</button><button type="button" onClick={() => fetchLeads(pagination.current_page)} className={buttonClassName}><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>L�m m?i</button></div></div>
            <div className="mb-4 flex flex-wrap gap-2"><button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: '' }))} className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] ${!filters.status ? 'bg-primary text-white' : 'border border-primary/15 bg-white text-primary/65'}`}>T?t c? ({pagination.total})</button>{statuses.map((status) => <button key={status.id} type="button" onClick={() => setFilters((prev) => ({ ...prev, status: String(status.id) }))} className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] ${String(filters.status) === String(status.id) ? 'bg-primary text-white' : 'border border-primary/15 bg-white text-primary/65'}`}>{status.name} ({status.count || 0})</button>)}</div>
            {filtersOpen ? <div className="mb-4"><FilterPanel filters={filters} statuses={statuses} tags={tags} onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))} onApply={() => fetchLeads(1)} onReset={() => { const reset = { search: '', status: '', tag: '', date_from: '', date_to: '' }; setFilters(reset); window.setTimeout(() => fetchLeads(1), 0); }} /></div> : null}
            <div className="mb-4 flex items-center justify-between rounded-sm border border-primary/10 bg-white px-4 py-3 shadow-sm"><div><p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tr?ng th�i dang xem</p><p className="mt-1 text-[14px] font-bold text-slate-800">{activeStatusLabel}</p></div><div className="text-right"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">T?ng lead</p><p className="mt-1 text-[18px] font-black text-primary">{pagination.total}</p></div></div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm"><div className="h-full overflow-auto"><table className="w-full min-w-[1420px] border-collapse text-left"><thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-primary/10 text-[11px] font-black uppercase tracking-[0.14em] text-primary/45"><th className="px-4 py-3">Th?i gian d?t</th><th className="px-4 py-3">S?n ph?m / b? s?n ph?m</th><th className="px-4 py-3">T�n kh�ch h�ng</th><th className="px-4 py-3">S? di?n tho?i</th><th className="px-4 py-3">�?a ch?</th><th className="px-4 py-3">Tag</th><th className="px-4 py-3">Tr?ng th�i don</th><th className="px-4 py-3">Ghi ch�</th><th className="px-4 py-3">Link</th></tr></thead><tbody>{loading ? <tr><td colSpan={9} className="px-4 py-16 text-center text-[12px] text-primary/40">�ang t?i d? li?u lead...</td></tr> : leads.length === 0 ? <tr><td colSpan={9} className="px-4 py-16 text-center text-[12px] text-primary/40 italic">Chua c� lead n�o ph� h?p b? l?c hi?n t?i.</td></tr> : leads.map((lead) => <tr key={lead.id} onDoubleClick={() => { if (lead.status_config?.blocks_order_create) { showToast('Lead d� ? tr?ng th�i �� t?o don, kh�ng m? l?i form t?o don.', 'warning'); return; } navigate(`/admin/orders/new?lead_id=${lead.id}`, { state: { leadSummary: lead } }); }} className="cursor-pointer border-b border-primary/5 transition-colors hover:bg-primary/[0.02]"><td className="px-4 py-3 align-top text-[12px] text-slate-600"><div>{lead.placed_date || '-'}</div><div className="mt-1 font-semibold text-slate-800">{lead.placed_time || '--:--:--'}</div></td><td className="px-4 py-3 align-top"><ProductCell lead={lead} /></td><td className="px-4 py-3 align-top text-[13px] font-semibold text-slate-800">{lead.customer_name || '-'}</td><td className="px-4 py-3 align-top text-[13px] font-semibold text-slate-800">{lead.phone || '-'}</td><td className="max-w-[280px] px-4 py-3 align-top text-[13px] leading-6 text-slate-600">{lead.address || '-'}</td><td className="px-4 py-3 align-top"><span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-primary">{lead.tag || 'Website'}</span></td><td className="px-4 py-3 align-top"><select value={lead.status_config?.id || ''} onChange={async (e) => { await leadApi.update(lead.id, { lead_status_id: Number(e.target.value) || null }); fetchLeads(pagination.current_page); }} className="min-w-[170px] rounded-sm border border-primary/15 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 outline-none">{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></td><td className="px-4 py-3 align-top"><button type="button" onClick={(e) => { e.stopPropagation(); setNotesLead(lead); }} className="text-left text-[12px] text-primary hover:text-brick"><div className="font-black uppercase tracking-[0.12em]">Chi ti?t</div><div className="mt-1 max-w-[220px] truncate text-[12px] text-slate-500">{lead.latest_note_excerpt || 'Chua c� ghi ch�'}</div></button></td><td className="px-4 py-3 align-top">{lead.link_url ? <a href={lead.link_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-[0.12em] text-primary hover:text-brick">M? link<span className="material-symbols-outlined text-[16px]">open_in_new</span></a> : <span className="text-[12px] text-slate-400">-</span>}</td></tr>)}</tbody></table></div></div>
            <div className="mt-4 flex items-center justify-between"><p className="text-[12px] text-primary/45">K�ch d�p v�o m?t lead d? m? form t?o don. T?ng gi� tr? lead dang xem: {formatMoney(leads.reduce((sum, item) => sum + Number(item.total_amount || 0), 0))}d</p><Pagination pagination={pagination} onPageChange={(page) => fetchLeads(page)} /></div>
            <NotesModal lead={notesLead} open={Boolean(notesLead)} onClose={() => setNotesLead(null)} staffs={staffs} currentUserName={user?.name || ''} onSaved={() => fetchLeads(pagination.current_page)} />
            <LeadSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} statuses={statuses} staffs={staffs} tagRules={tagRules} onReload={async () => { await reloadSettings(); await fetchLeads(1); }} />
        </div>
    );
};

export default LeadList;
