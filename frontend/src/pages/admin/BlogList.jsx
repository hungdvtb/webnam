import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blogApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const collator = new Intl.Collator('vi', { sensitivity: 'base' });

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

const formatDate = (value) => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString('vi-VN');
};

const BlogList = () => {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState({
        seo_keyword: 'all',
        is_published: 'all',
        is_starred: 'all',
    });

    const [keywords, setKeywords] = useState([]);
    const [showKeywordForm, setShowKeywordForm] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [newKeywordLoading, setNewKeywordLoading] = useState(false);

    const [selected, setSelected] = useState(new Set());
    const [bulkKeyword, setBulkKeyword] = useState('');

    const [draggingId, setDraggingId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);
    const [reordering, setReordering] = useState(false);

    const navigate = useNavigate();
    const { showModal, showToast } = useUI();

    const reorderLocked = useMemo(
        () => search.trim() !== ''
            || filters.seo_keyword !== 'all'
            || filters.is_published !== 'all'
            || filters.is_starred !== 'all',
        [search, filters]
    );

    const fetchPosts = useCallback(async () => {
        setLoading(true);
        try {
            const params = { per_page: 1000 };
            if (search.trim()) params.search = search.trim();
            if (filters.seo_keyword !== 'all') params.seo_keyword = filters.seo_keyword;
            if (filters.is_published !== 'all') params.is_published = filters.is_published;
            if (filters.is_starred !== 'all') params.is_starred = filters.is_starred;

            const response = await blogApi.getAll(params);
            const list = Array.isArray(response.data?.data) ? response.data.data : [];
            const payloadKeywords = Array.isArray(response.data?.seo_keywords) ? response.data.seo_keywords : [];

            setPosts(list);
            setKeywords(normalizeKeywords([
                ...payloadKeywords,
                ...list.map((post) => ({ keyword: post.seo_keyword })),
            ]));
            setSelected((prev) => {
                const valid = new Set(list.map((post) => post.id));
                return new Set([...prev].filter((id) => valid.has(id)));
            });
        } catch (error) {
            showModal({ title: 'Loi', content: 'Khong the tai danh sach bai viet.', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [filters, search, showModal]);

    const loadKeywords = useCallback(async () => {
        try {
            const response = await blogApi.getSeoKeywords();
            const items = Array.isArray(response.data?.data) ? response.data.data : [];
            setKeywords(normalizeKeywords(items));
        } catch (error) {
            // no-op
        }
    }, []);

    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);

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

    const onFilterChange = (event) => {
        const { name, value } = event.target;
        setFilters((prev) => ({ ...prev, [name]: value }));
    };

    const updatePost = async (id, payload) => {
        try {
            await blogApi.update(id, payload);
            setPosts((prev) => prev.map((post) => (post.id === id ? { ...post, ...payload } : post)));
        } catch (error) {
            showModal({ title: 'Loi', content: 'Khong the cap nhat bai viet.', type: 'error' });
        }
    };

    const deletePost = (post) => {
        showModal({
            title: 'Xac nhan xoa',
            content: `Ban co chac muon xoa bai "${post.title}"?`,
            type: 'warning',
            actionText: 'Xoa bai',
            onAction: async () => {
                try {
                    await blogApi.destroy(post.id);
                    setPosts((prev) => prev.filter((item) => item.id !== post.id));
                    setSelected((prev) => {
                        const next = new Set(prev);
                        next.delete(post.id);
                        return next;
                    });
                    showToast({ message: 'Da xoa bai viet.', type: 'success' });
                } catch (error) {
                    showModal({ title: 'Loi', content: 'Khong the xoa bai viet.', type: 'error' });
                }
            },
        });
    };

    const createKeyword = async (event) => {
        event.preventDefault();
        const keyword = newKeyword.trim();
        if (!keyword) {
            showModal({ title: 'Luu y', content: 'Vui long nhap tu khoa SEO.', type: 'warning' });
            return;
        }

        setNewKeywordLoading(true);
        try {
            const response = await blogApi.createSeoKeyword({ keyword });
            const created = response.data?.keyword || keyword;
            setKeywords((prev) => normalizeKeywords([...prev, { id: response.data?.id ?? null, keyword: created }]));
            setBulkKeyword(created);
            setNewKeyword('');
            setShowKeywordForm(false);
            showToast({ message: 'Da them tu khoa SEO.', type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Khong the them tu khoa SEO.';
            showModal({ title: 'Loi', content: message, type: 'error' });
        } finally {
            setNewKeywordLoading(false);
        }
    };

    const bulkAssignKeyword = async () => {
        const ids = Array.from(selected);
        const keyword = bulkKeyword.trim();
        if (!ids.length) {
            showModal({ title: 'Luu y', content: 'Vui long chon bai viet.', type: 'warning' });
            return;
        }
        if (!keyword) {
            showModal({ title: 'Luu y', content: 'Vui long chon tu khoa SEO.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.bulkSeoKeyword({ ids, operation: 'assign', seo_keyword: keyword });
            setSelected(new Set());
            await fetchPosts();
            await loadKeywords();
            showToast({ message: `Da gan tu khoa cho ${ids.length} bai.`, type: 'success' });
        } catch (error) {
            showModal({ title: 'Loi', content: 'Khong the gan tu khoa hang loat.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const bulkClearKeyword = async () => {
        const ids = Array.from(selected);
        if (!ids.length) {
            showModal({ title: 'Luu y', content: 'Vui long chon bai viet.', type: 'warning' });
            return;
        }

        setBusy(true);
        try {
            await blogApi.bulkSeoKeyword({ ids, operation: 'clear' });
            setSelected(new Set());
            await fetchPosts();
            showToast({ message: `Da xoa tu khoa cho ${ids.length} bai.`, type: 'success' });
        } catch (error) {
            showModal({ title: 'Loi', content: 'Khong the xoa tu khoa hang loat.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const onDragStart = (event, postId) => {
        if (reorderLocked || reordering) return;
        setDraggingId(postId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(postId));
    };

    const onDragOver = (event, postId) => {
        if (reorderLocked || reordering) return;
        event.preventDefault();
        if (dragOverId !== postId) setDragOverId(postId);
    };

    const onDragEnd = () => {
        setDraggingId(null);
        setDragOverId(null);
    };

    const onDrop = async (event, targetId) => {
        if (reorderLocked || reordering) return;
        event.preventDefault();

        const sourceId = draggingId || Number(event.dataTransfer.getData('text/plain'));
        setDraggingId(null);
        setDragOverId(null);

        if (!sourceId || sourceId === targetId) return;

        const from = posts.findIndex((post) => post.id === sourceId);
        const to = posts.findIndex((post) => post.id === targetId);
        if (from < 0 || to < 0) return;

        const reordered = [...posts];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        setPosts(reordered);
        setReordering(true);

        try {
            await blogApi.reorder(reordered.map((post) => post.id));
            showToast({ message: 'Da cap nhat thu tu bai viet.', type: 'success', duration: 1200 });
        } catch (error) {
            showModal({ title: 'Loi', content: 'Khong the sap xep thu tu bai viet.', type: 'error' });
            fetchPosts();
        } finally {
            setReordering(false);
        }
    };

    const openOnWeb = (post) => {
        const slugOrId = post.slug || post.id;
        window.open(`${window.location.origin}/blog/${slugOrId}`, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] p-6 gap-3 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">Bai viet tren web</h1>
                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.16em]">Quan ly bai SEO so luong lon</p>
                </div>
                <div className="flex items-center gap-2">
                    <Link to="/admin/blog/import" className="h-9 px-4 bg-white border border-gold/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center">Import Word</Link>
                    <Link to="/admin/blog/new" className="h-9 px-4 bg-brick text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center">Tao bai moi</Link>
                </div>
            </div>

            <div className="bg-white border border-gold/10 rounded-sm shadow-sm p-3 space-y-2">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                    <form onSubmit={submitSearch} className="lg:col-span-5 flex gap-2">
                        <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Tim theo tieu de, slug, noi dung..." className="h-9 flex-1 bg-stone/5 border border-gold/15 px-3 text-[13px] text-primary focus:outline-none focus:border-primary rounded-sm" />
                        <button type="submit" className="h-9 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber">Tim</button>
                    </form>
                    <select name="seo_keyword" value={filters.seo_keyword} onChange={onFilterChange} className="lg:col-span-3 h-9 bg-stone/5 border border-gold/15 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                        <option value="all">Tat ca tu khoa SEO</option>
                        {keywords.map((item) => <option key={item.keyword} value={item.keyword}>{item.keyword}</option>)}
                    </select>
                    <select name="is_published" value={filters.is_published} onChange={onFilterChange} className="lg:col-span-2 h-9 bg-stone/5 border border-gold/15 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                        <option value="all">Tat ca trang thai</option>
                        <option value="1">Dang hien thi</option>
                        <option value="0">An/Nhap</option>
                    </select>
                    <select name="is_starred" value={filters.is_starred} onChange={onFilterChange} className="lg:col-span-2 h-9 bg-stone/5 border border-gold/15 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                        <option value="all">Tat ca sao</option>
                        <option value="1">Co sao</option>
                        <option value="0">Khong sao</option>
                    </select>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setShowKeywordForm((v) => !v)} className="h-8 px-3 bg-white border border-primary/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest">Them tu khoa SEO</button>
                        <button type="button" onClick={fetchPosts} disabled={loading} className="h-8 px-3 bg-white border border-gold/20 text-stone/70 hover:text-primary rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-60">Lam moi</button>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-stone/45">{posts.length} bai</div>
                </div>

                {showKeywordForm && (
                    <form onSubmit={createKeyword} className="flex items-center gap-2 bg-stone/5 border border-gold/15 p-2 rounded-sm">
                        <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Nhap tu khoa SEO moi..." className="h-8 flex-1 bg-white border border-gold/20 px-3 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm" />
                        <button type="submit" disabled={newKeywordLoading} className="h-8 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber disabled:opacity-60">{newKeywordLoading ? 'Dang luu...' : 'Luu'}</button>
                    </form>
                )}

                {selectedCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2 bg-primary/5 border border-primary/15 rounded-sm p-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">Da chon {selectedCount} bai</span>
                        <select value={bulkKeyword} onChange={(e) => setBulkKeyword(e.target.value)} className="h-8 min-w-[220px] bg-white border border-gold/20 px-2 text-[12px] text-primary focus:outline-none focus:border-primary rounded-sm">
                            <option value="">Chon tu khoa</option>
                            {keywords.map((item) => <option key={`bulk-${item.keyword}`} value={item.keyword}>{item.keyword}</option>)}
                        </select>
                        <button type="button" onClick={bulkAssignKeyword} disabled={busy} className="h-8 px-3 bg-primary text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-umber disabled:opacity-60">Gan tu khoa</button>
                        <button type="button" onClick={bulkClearKeyword} disabled={busy} className="h-8 px-3 bg-white border border-brick/25 text-brick rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-brick/5 disabled:opacity-60">Xoa tu khoa</button>
                    </div>
                )}

                {reorderLocked && (
                    <div className="text-[10px] text-stone/55 italic">Keo tha sap xep chi hoat dong khi khong tim kiem/bo loc.</div>
                )}
            </div>

            <div className="flex-1 overflow-auto bg-white border border-gold/10 rounded-sm shadow-sm">
                <table className="w-full min-w-[1100px] border-collapse">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] border-b border-gold/20">
                        <tr>
                            <th className="w-[44px] py-2"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-primary cursor-pointer" /></th>
                            <th className="w-[52px] text-[10px] uppercase tracking-widest text-primary">Keo</th>
                            <th className="w-[74px] text-[10px] uppercase tracking-widest text-primary">Anh</th>
                            <th className="px-2 text-left text-[10px] uppercase tracking-widest text-primary">Bai viet</th>
                            <th className="w-[120px] text-[10px] uppercase tracking-widest text-primary">Trang thai</th>
                            <th className="w-[86px] text-[10px] uppercase tracking-widest text-primary">Sao</th>
                            <th className="w-[116px] text-[10px] uppercase tracking-widest text-primary">Ngay</th>
                            <th className="w-[230px] text-right pr-3 text-[10px] uppercase tracking-widest text-primary">Tac vu</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading && (
                            <tr><td colSpan="8" className="py-14 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div></td></tr>
                        )}
                        {!loading && posts.length === 0 && (
                            <tr><td colSpan="8" className="py-14 text-center text-stone/45 font-bold uppercase tracking-widest text-xs">Khong co bai viet nao</td></tr>
                        )}
                        {!loading && posts.map((post) => (
                            <tr key={post.id} onDragOver={(e) => onDragOver(e, post.id)} onDrop={(e) => onDrop(e, post.id)} className={`${draggingId === post.id ? 'bg-primary/5' : dragOverId === post.id ? 'bg-gold/10' : 'hover:bg-gold/5'}`}>
                                <td className="text-center py-2"><input type="checkbox" checked={selected.has(post.id)} onChange={() => toggleOne(post.id)} className="h-4 w-4 accent-primary cursor-pointer" /></td>
                                <td className="text-center">
                                    <button type="button" draggable={!reorderLocked && !reordering} onDragStart={(e) => onDragStart(e, post.id)} onDragEnd={onDragEnd} className={`h-7 w-7 inline-flex items-center justify-center rounded-sm border ${reorderLocked ? 'border-stone/15 text-stone/25' : 'border-gold/20 text-stone/50 hover:text-primary'}`} title={reorderLocked ? 'Tat bo loc de keo tha' : 'Keo tha sap xep'}>
                                        <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
                                    </button>
                                </td>
                                <td><div className="w-12 h-12 mx-auto bg-stone/10 border border-gold/20 rounded-sm overflow-hidden"><img src={post.featured_image || 'https://placehold.co/120x120?text=No+Img'} alt={post.title} className="w-full h-full object-cover" /></div></td>
                                <td className="px-2 py-2">
                                    <button type="button" onClick={() => navigate(`/admin/blog/edit/${post.id}`)} className="block text-left text-[14px] font-bold text-primary hover:text-brick truncate" title={post.title}>{post.title}</button>
                                    <div className="text-[10px] text-stone/45 uppercase tracking-wider truncate">slug: {post.slug || '--'}</div>
                                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 border border-gold/25 bg-gold/5 text-umber rounded-sm">{post.seo_keyword || 'Chua gan tu khoa'}</span>
                                </td>
                                <td className="text-center">
                                    <button type="button" onClick={() => updatePost(post.id, { is_published: !post.is_published })} className={`h-7 px-3 rounded-sm text-[10px] font-black uppercase tracking-widest border ${post.is_published ? 'bg-primary text-white border-primary' : 'bg-white text-stone/60 border-gold/20'}`}>{post.is_published ? 'Hien thi' : 'An'}</button>
                                </td>
                                <td className="text-center">
                                    <button type="button" onClick={() => updatePost(post.id, { is_starred: !post.is_starred })} className={`h-8 w-8 inline-flex items-center justify-center rounded-full border ${post.is_starred ? 'bg-gold/15 border-gold/40 text-gold' : 'bg-white border-gold/20 text-stone/40'}`} title={post.is_starred ? 'Bo sao' : 'Gan sao'}>
                                        <span className="material-symbols-outlined text-[18px]">{post.is_starred ? 'star' : 'star_outline'}</span>
                                    </button>
                                </td>
                                <td className="text-center text-[12px] text-stone/80">{formatDate(post.published_at || post.created_at)}</td>
                                <td className="pr-3">
                                    <div className="flex items-center justify-end gap-1">
                                        <button type="button" onClick={() => openOnWeb(post)} className="h-8 px-2.5 border border-gold/20 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest">Xem ngoai web</button>
                                        <button type="button" onClick={() => navigate(`/admin/blog/edit/${post.id}`)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 text-stone/60 hover:text-primary rounded-sm" title="Sua"><span className="material-symbols-outlined text-[16px]">edit_square</span></button>
                                        <button type="button" onClick={() => deletePost(post)} className="h-8 w-8 inline-flex items-center justify-center border border-gold/20 text-stone/60 hover:text-brick rounded-sm" title="Xoa"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default BlogList;
