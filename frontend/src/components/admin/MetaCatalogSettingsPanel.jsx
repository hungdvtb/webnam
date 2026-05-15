import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { metaCatalogApi } from '../../services/api';

const defaultSettings = {
    enabled: false,
    app_id: '1211212674332829',
    catalog_id: '903223896075838',
    access_token: '',
    graph_api_version: 'v25.0',
    brand: 'Gốm Đại Thành',
    currency: 'VND',
    fallback_image_url: '',
    delete_stale: true,
    sync_frequency: 'hourly',
    has_access_token: false,
    feed_links: {
        csv: 'https://gomdaithanh.com/meta-feed.csv',
        xml: 'https://gomdaithanh.com/meta-feed.xml',
    },
};

const feedFields = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'product_type', 'custom_label_0'];
const compactNumber = (value) => Number(value || 0).toLocaleString('vi-VN');
const formatTime = (value) => {
    if (!value) return 'Chưa có';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Chưa có';
    return date.toLocaleString('vi-VN', { hour12: false });
};

const operationLabel = (operation) => ({
    dry_run: 'Dry-run',
    sync_live: 'Sync live',
    scheduled_sync: 'Sync tự động',
    feed_check: 'Kiểm tra feed',
}[operation] || operation || '');

const statusClasses = (status) => (
    status === 'success'
        ? 'border-green-200 bg-green-50 text-green-700'
        : status === 'skipped'
            ? 'border-stone-200 bg-stone-50 text-stone-600'
            : 'border-red-200 bg-red-50 text-red-700'
);

const StatBox = ({ label, value, tone = 'primary' }) => {
    const toneClasses = {
        primary: 'border-primary/10 bg-white text-primary',
        green: 'border-green-100 bg-green-50 text-green-700',
        red: 'border-red-100 bg-red-50 text-red-700',
        amber: 'border-amber-100 bg-amber-50 text-amber-700',
    };

    return (
        <div className={`rounded-sm border px-4 py-3 ${toneClasses[tone] || toneClasses.primary}`}>
            <p className="text-[10px] font-black uppercase tracking-wider opacity-60">{label}</p>
            <p className="mt-1 text-xl font-black">{compactNumber(value)}</p>
        </div>
    );
};

const MetaCatalogSettingsPanel = ({ SectionCard, inputClasses, labelClasses, showModal }) => {
    const [settings, setSettings] = useState(defaultSettings);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [checkingFeed, setCheckingFeed] = useState('');
    const [runningDryRun, setRunningDryRun] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState('');
    const [checkRemoteUrls, setCheckRemoteUrls] = useState(false);
    const [dryRunResult, setDryRunResult] = useState(null);
    const [syncResult, setSyncResult] = useState(null);
    const [feedCheckResult, setFeedCheckResult] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const response = await metaCatalogApi.getSettings();
            setSettings((prev) => ({
                ...prev,
                ...(response.data?.settings || {}),
                access_token: '',
            }));
            setLogs(response.data?.latest_logs || []);
        } catch (error) {
            showModal({
                title: 'Lỗi',
                content: error.response?.data?.message || 'Không thể tải cấu hình Meta Catalog.',
                type: 'error',
            });
        } finally {
            setLoading(false);
        }
    }, [showModal]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const feedLinks = useMemo(() => ([
        { id: 'csv', title: 'CSV', url: settings.feed_links?.csv || defaultSettings.feed_links.csv },
        { id: 'xml', title: 'XML', url: settings.feed_links?.xml || defaultSettings.feed_links.xml },
    ]), [settings.feed_links]);

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setSettings((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const refreshLogs = async () => {
        try {
            const response = await metaCatalogApi.getLogs({ per_page: 10 });
            setLogs(response.data?.data || []);
        } catch {
            // Log refresh is secondary to the action result.
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload = {
                ...settings,
                access_token: settings.access_token || '',
            };
            const response = await metaCatalogApi.updateSettings(payload);
            setSettings((prev) => ({
                ...prev,
                ...(response.data?.settings || {}),
                access_token: '',
            }));
            setLogs(response.data?.latest_logs || logs);
            showModal({ title: 'Thành công', content: 'Đã lưu cấu hình Meta Catalog.', type: 'success' });
        } catch (error) {
            showModal({
                title: 'Lỗi',
                content: error.response?.data?.message || 'Không thể lưu cấu hình Meta Catalog.',
                type: 'error',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = async (url) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopiedUrl(url);
            setTimeout(() => setCopiedUrl(''), 1800);
        } catch {
            showModal({ title: 'Lỗi', content: 'Không thể copy link.', type: 'error' });
        }
    };

    const handleCheckFeed = async (format) => {
        setCheckingFeed(format);
        try {
            const response = await metaCatalogApi.checkFeed(format);
            setFeedCheckResult(response.data?.result || null);
            await refreshLogs();
            showModal({ title: 'Feed hợp lệ', content: `Feed ${format.toUpperCase()} trả về hợp lệ.`, type: 'success' });
        } catch (error) {
            setFeedCheckResult(error.response?.data?.log?.details?.details || null);
            await refreshLogs();
            showModal({
                title: 'Feed lỗi',
                content: error.response?.data?.message || 'Không thể kiểm tra feed.',
                type: 'error',
            });
        } finally {
            setCheckingFeed('');
        }
    };

    const handleDryRun = async () => {
        setRunningDryRun(true);
        setSyncResult(null);
        try {
            const response = await metaCatalogApi.dryRun({ check_remote_urls: checkRemoteUrls });
            setDryRunResult(response.data?.result || null);
            setSettings((prev) => ({ ...prev, ...(response.data?.settings || {}), access_token: '' }));
            await refreshLogs();
            showModal({ title: 'Dry-run hoàn tất', content: 'Dữ liệu đã sẵn sàng để đồng bộ Meta.', type: 'success' });
        } catch (error) {
            const result = error.response?.data?.result || error.response?.data?.log?.details || null;
            if (result) {
                setDryRunResult(result);
            }
            await refreshLogs();
            showModal({
                title: 'Dry-run còn lỗi',
                content: error.response?.data?.message || 'Vẫn còn sản phẩm chưa đủ dữ liệu để đồng bộ.',
                type: 'error',
            });
        } finally {
            setRunningDryRun(false);
        }
    };

    const handleSyncNow = async () => {
        if (!dryRunResult || Number(dryRunResult.invalid_count || 0) > 0) {
            showModal({ title: 'Chưa thể đồng bộ', content: 'Cần chạy dry-run và xử lý hết lỗi nghiêm trọng trước.', type: 'error' });
            return;
        }

        if (!window.confirm('Đồng bộ live lên Meta Catalog ngay bây giờ?')) {
            return;
        }

        setSyncing(true);
        try {
            const response = await metaCatalogApi.syncNow();
            setSyncResult(response.data?.result || null);
            setSettings((prev) => ({ ...prev, ...(response.data?.settings || {}), access_token: '' }));
            await refreshLogs();
            showModal({ title: 'Đồng bộ thành công', content: 'Đã gửi dữ liệu sản phẩm lên Meta Catalog.', type: 'success' });
        } catch (error) {
            await refreshLogs();
            showModal({
                title: 'Đồng bộ thất bại',
                content: error.response?.data?.message || 'Không thể đồng bộ lên Meta Catalog.',
                type: 'error',
            });
        } finally {
            setSyncing(false);
        }
    };

    const canSync = dryRunResult && Number(dryRunResult.invalid_count || 0) === 0 && !runningDryRun && !syncing;
    const latestRun = settings.last_run || null;

    if (loading) {
        return (
            <SectionCard icon="sync" title="Meta Catalog">
                <div className="py-10 text-center text-[13px] font-bold text-primary/40">Đang tải cấu hình...</div>
            </SectionCard>
        );
    }

    return (
        <div className="space-y-6">
            <SectionCard
                icon="settings"
                title="Cấu hình Meta Catalog"
                rightSlot={(
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="h-9 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50"
                    >
                        {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
                    </button>
                )}
            >
                <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="flex items-center gap-3 rounded-sm border border-primary/10 bg-primary/[0.02] px-4 py-3">
                            <input type="checkbox" name="enabled" checked={Boolean(settings.enabled)} onChange={handleChange} className="size-4 accent-primary" />
                            <span className="text-[13px] font-black text-primary">Bật đồng bộ tự động</span>
                        </label>
                        <div>
                            <label className={labelClasses}>Catalog ID</label>
                            <input name="catalog_id" value={settings.catalog_id || ''} onChange={handleChange} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>App ID</label>
                            <input name="app_id" value={settings.app_id || ''} onChange={handleChange} className={inputClasses} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                            <label className={labelClasses}>Access Token</label>
                            <input
                                type="password"
                                name="access_token"
                                value={settings.access_token || ''}
                                onChange={handleChange}
                                className={inputClasses}
                                placeholder={settings.has_access_token ? 'Đã lưu token, nhập token mới nếu muốn thay đổi' : 'Nhập System User Access Token'}
                            />
                        </div>
                        <div>
                            <label className={labelClasses}>Tần suất tự động</label>
                            <select name="sync_frequency" value={settings.sync_frequency || 'hourly'} onChange={handleChange} className={inputClasses}>
                                <option value="hourly">Hàng giờ</option>
                                <option value="six_hours">6 tiếng</option>
                                <option value="daily">Hàng ngày</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>Brand</label>
                            <input name="brand" value={settings.brand || ''} onChange={handleChange} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Tiền tệ</label>
                            <input name="currency" value={settings.currency || 'VND'} onChange={handleChange} className={inputClasses} />
                        </div>
                        <label className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-4 py-3 mt-6">
                            <input type="checkbox" name="delete_stale" checked={Boolean(settings.delete_stale)} onChange={handleChange} className="size-4 accent-primary" />
                            <span className="text-[13px] font-black text-primary">Xóa sản phẩm không còn trên web</span>
                        </label>
                    </div>

                    <div>
                        <label className={labelClasses}>Ảnh dự phòng</label>
                        <input
                            name="fallback_image_url"
                            value={settings.fallback_image_url || ''}
                            onChange={handleChange}
                            className={inputClasses}
                            placeholder="META_CATALOG_FALLBACK_IMAGE_URL"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="rounded-sm border border-primary/10 bg-white px-4 py-3 text-primary">
                            <p className="text-[10px] font-black uppercase tracking-wider text-primary/40">Lần chạy gần nhất</p>
                            <p className="mt-1 text-[13px] font-black">{latestRun ? operationLabel(latestRun.operation) : 'Chưa có'}</p>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-4 py-3 text-primary">
                            <p className="text-[10px] font-black uppercase tracking-wider text-primary/40">Thời gian gần nhất</p>
                            <p className="mt-1 text-[13px] font-black">{formatTime(latestRun?.finished_at)}</p>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-4 py-3 text-primary">
                            <p className="text-[10px] font-black uppercase tracking-wider text-primary/40">Lần chạy tiếp theo</p>
                            <p className="mt-1 text-[13px] font-black">{formatTime(settings.next_run_at)}</p>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard icon="rss_feed" title="Nguồn cấp sản phẩm">
                <div className="space-y-4">
                    {feedLinks.map((feed) => (
                        <div key={feed.id} className="grid grid-cols-1 gap-3 rounded-sm border border-primary/10 bg-white p-4 md:grid-cols-[80px_minmax(0,1fr)_auto] md:items-center">
                            <p className="text-[13px] font-black uppercase text-primary">{feed.title}</p>
                            <input readOnly value={feed.url} className={`${inputClasses} font-mono text-[12px]`} onFocus={(event) => event.target.select()} />
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={() => handleCopy(feed.url)} className="h-10 px-3 rounded-sm border border-primary/20 bg-white text-primary text-[12px] font-black uppercase inline-flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[18px]">{copiedUrl === feed.url ? 'check' : 'content_copy'}</span>
                                    {copiedUrl === feed.url ? 'Đã copy' : 'Copy link'}
                                </button>
                                <button type="button" onClick={() => window.open(feed.url, '_blank', 'noopener,noreferrer')} className="h-10 px-3 rounded-sm border border-primary/20 bg-white text-primary text-[12px] font-black uppercase inline-flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                    Mở link
                                </button>
                                <button type="button" onClick={() => handleCheckFeed(feed.id)} disabled={checkingFeed === feed.id} className="h-10 px-3 rounded-sm bg-primary text-white text-[12px] font-black uppercase inline-flex items-center gap-2 disabled:opacity-50">
                                    <span className="material-symbols-outlined text-[18px]">fact_check</span>
                                    {checkingFeed === feed.id ? 'Đang kiểm tra...' : 'Kiểm tra feed'}
                                </button>
                            </div>
                        </div>
                    ))}

                    {feedCheckResult && (
                        <div className={`rounded-sm border px-4 py-3 text-[13px] font-bold ${feedCheckResult.errors?.length ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-700'}`}>
                            Feed {String(feedCheckResult.format || '').toUpperCase()}: HTTP {feedCheckResult.http_status || '-'} · {compactNumber(feedCheckResult.bytes)} bytes
                            {feedCheckResult.errors?.length ? ` · ${feedCheckResult.errors.join('; ')}` : ''}
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard icon="rule_settings" title="Quy tắc dữ liệu gửi sang Meta">
                <div className="flex flex-wrap gap-2">
                    {feedFields.map((field) => (
                        <span key={field} className="rounded-sm border border-primary/10 bg-stone-50 px-3 py-1.5 font-mono text-[12px] font-bold text-primary/70">{field}</span>
                    ))}
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px] font-bold text-primary/70">
                    <div>availability luôn là <span className="font-black text-primary">in stock</span></div>
                    <div>condition luôn là <span className="font-black text-primary">new</span></div>
                    <div>brand luôn là <span className="font-black text-primary">Gốm Đại Thành</span></div>
                    <div>Không gửi tồn kho thực tế sang Meta</div>
                </div>
            </SectionCard>

            <SectionCard
                icon="plagiarism"
                title="Kiểm tra dữ liệu trước khi đồng bộ"
                rightSlot={(
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-[12px] font-black text-primary/60">
                            <input type="checkbox" checked={checkRemoteUrls} onChange={(event) => setCheckRemoteUrls(event.target.checked)} className="size-4 accent-primary" />
                            Kiểm tra ảnh/link HTTP
                        </label>
                        <button type="button" onClick={handleDryRun} disabled={runningDryRun} className="h-9 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50">
                            {runningDryRun ? 'Đang kiểm tra...' : 'Kiểm tra dữ liệu / Dry run'}
                        </button>
                    </div>
                )}
            >
                <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <StatBox label="Tổng sản phẩm" value={dryRunResult?.feed_count || 0} />
                        <StatBox label="Hợp lệ" value={dryRunResult?.valid_count || 0} tone="green" />
                        <StatBox label="Lỗi" value={dryRunResult?.invalid_count || 0} tone={Number(dryRunResult?.invalid_count || 0) > 0 ? 'red' : 'green'} />
                        <StatBox label="Dùng ảnh fallback" value={dryRunResult?.fallback_count || 0} tone={Number(dryRunResult?.fallback_count || 0) > 0 ? 'amber' : 'primary'} />
                        <StatBox label="Batch dự kiến" value={dryRunResult?.batch_count || 0} />
                    </div>

                    {dryRunResult?.invalid_entries?.length > 0 && (
                        <div className="overflow-x-auto rounded-sm border border-red-100">
                            <table className="w-full text-left text-[12px]">
                                <thead className="bg-red-50 text-red-700">
                                    <tr>
                                        <th className="px-4 py-3 font-black uppercase">SKU</th>
                                        <th className="px-4 py-3 font-black uppercase">Tên sản phẩm</th>
                                        <th className="px-4 py-3 font-black uppercase">Danh mục</th>
                                        <th className="px-4 py-3 font-black uppercase">Lý do lỗi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-red-100 bg-white">
                                    {dryRunResult.invalid_entries.map((entry) => (
                                        <tr key={entry.id}>
                                            <td className="px-4 py-3 font-mono font-bold text-primary">{entry.id}</td>
                                            <td className="px-4 py-3 font-bold text-primary">{entry.title}</td>
                                            <td className="px-4 py-3 text-primary/70">{entry.product_type || '-'}</td>
                                            <td className="px-4 py-3 text-red-700 font-bold">{(entry.errors || []).join('; ')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {dryRunResult?.fallback_entries?.length > 0 && (
                        <div className="rounded-sm border border-amber-100 bg-amber-50 px-4 py-3">
                            <p className="text-[12px] font-black uppercase tracking-wider text-amber-700">Sản phẩm đang dùng ảnh fallback</p>
                            <p className="mt-2 text-[13px] font-bold text-amber-700">
                                {dryRunResult.fallback_entries.map((entry) => entry.id).join(', ')}
                            </p>
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard
                icon="cloud_sync"
                title="Đồng bộ lên Meta"
                rightSlot={(
                    <button type="button" onClick={handleSyncNow} disabled={!canSync} className="h-9 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed">
                        {syncing ? 'Đang đồng bộ...' : 'Đồng bộ lên Meta ngay'}
                    </button>
                )}
            >
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <StatBox label="Tạo mới" value={syncResult?.create_count || 0} tone="green" />
                    <StatBox label="Cập nhật" value={syncResult?.update_count || 0} />
                    <StatBox label="Xóa khỏi Meta" value={syncResult?.delete_count || 0} tone="amber" />
                    <StatBox label="Lỗi" value={syncResult?.invalid_count || 0} tone={Number(syncResult?.invalid_count || 0) > 0 ? 'red' : 'green'} />
                    <StatBox label="Sản phẩm gửi" value={syncResult?.request_count || 0} />
                </div>
                {!canSync && (
                    <p className="mt-4 rounded-sm border border-primary/10 bg-stone-50 px-4 py-3 text-[13px] font-bold text-primary/50">
                        Nút sync live chỉ mở sau khi dry-run hoàn tất và không còn lỗi nghiêm trọng.
                    </p>
                )}
            </SectionCard>

            <SectionCard icon="history" title="Log đồng bộ">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-[12px]">
                        <thead className="bg-primary/[0.02] text-primary/50">
                            <tr>
                                <th className="px-4 py-3 font-black uppercase">Thời gian</th>
                                <th className="px-4 py-3 font-black uppercase">Loại</th>
                                <th className="px-4 py-3 font-black uppercase">Người bấm</th>
                                <th className="px-4 py-3 font-black uppercase">Tổng</th>
                                <th className="px-4 py-3 font-black uppercase">Thành công</th>
                                <th className="px-4 py-3 font-black uppercase">Lỗi</th>
                                <th className="px-4 py-3 font-black uppercase">Trạng thái</th>
                                <th className="px-4 py-3 font-black uppercase">Chi tiết</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/5 bg-white">
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="px-4 py-10 text-center text-primary/35">Chưa có log Meta Catalog.</td>
                                </tr>
                            ) : logs.map((log) => (
                                <tr key={log.id}>
                                    <td className="px-4 py-3 font-bold text-primary">{formatTime(log.finished_at)}</td>
                                    <td className="px-4 py-3 font-black text-primary">{operationLabel(log.operation)}</td>
                                    <td className="px-4 py-3 text-primary/70">{log.user?.name || log.user?.email || 'Hệ thống'}</td>
                                    <td className="px-4 py-3 font-mono text-primary">{compactNumber(log.total_products)}</td>
                                    <td className="px-4 py-3 font-mono text-green-700">{compactNumber(log.success_count || log.valid_products)}</td>
                                    <td className="px-4 py-3 font-mono text-red-700">{compactNumber(log.error_count || log.invalid_products)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`rounded-sm border px-2 py-1 text-[10px] font-black uppercase ${statusClasses(log.status)}`}>{log.status}</span>
                                    </td>
                                    <td className="px-4 py-3 max-w-[360px] truncate text-primary/60" title={log.summary || log.error_message || ''}>
                                        {log.summary || log.error_message || '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </SectionCard>
        </div>
    );
};

export default MetaCatalogSettingsPanel;
