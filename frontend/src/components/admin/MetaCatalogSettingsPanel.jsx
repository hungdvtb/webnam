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

const feedFields = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'product_type', 'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4'];
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
        : status === 'running'
            ? 'border-blue-200 bg-blue-50 text-blue-700'
        : status === 'skipped'
            ? 'border-stone-200 bg-stone-50 text-stone-600'
            : 'border-red-200 bg-red-50 text-red-700'
);

const progressFromLog = (log) => log?.progress || log?.details?.progress || null;
const progressPercent = (progress) => Math.max(0, Math.min(100, Number(progress?.percent || 0)));
const isRunningLog = (log) => String(log?.status || '').toLowerCase() === 'running';
const runningLogStaleMs = 10 * 60 * 1000;
const isStaleRunningLog = (log) => {
    if (!isRunningLog(log)) return false;
    const progress = progressFromLog(log);
    const lastUpdate = new Date(progress?.updated_at || log?.started_at || '').getTime();
    return Number.isFinite(lastUpdate) && Date.now() - lastUpdate > runningLogStaleMs;
};
const isActiveRunningLog = (log) => isRunningLog(log) && !isStaleRunningLog(log);

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

const resultFromLog = (log) => {
    if (!log) return null;
    const details = log.details || {};

    return {
        dry_run: log.operation === 'dry_run',
        feed_count: log.total_products || 0,
        valid_count: log.valid_products || 0,
        skipped_count: log.skipped_count || details.skipped_count || 0,
        invalid_count: log.invalid_products || log.error_count || 0,
        success_count: log.success_count || log.valid_products || 0,
        create_count: log.create_count || 0,
        update_count: log.update_count || 0,
        delete_count: log.delete_count || 0,
        fallback_count: log.fallback_count || 0,
        product_set_count: log.product_set_count || details.product_set_count || 0,
        product_set_create_count: log.product_set_create_count || details.product_set_create_count || 0,
        product_set_update_count: log.product_set_update_count || details.product_set_update_count || 0,
        product_set_unchanged_count: log.product_set_unchanged_count || details.product_set_unchanged_count || 0,
        product_set_error_count: log.product_set_error_count || details.product_set_error_count || 0,
        request_count: log.success_count || log.valid_products || 0,
        batch_count: Array.isArray(details.batches) ? details.batches.length : 0,
        invalid_entries: details.invalid_entries || [],
        skipped_entries: details.skipped_entries || [],
        fallback_entries: details.fallback_entries || [],
        product_sets: details.product_sets || [],
        product_set_errors: details.product_set_errors || [],
        product_set_sort_note: details.product_set_sort_note || '',
        batches: details.batches || [],
        progress: progressFromLog(log),
        recovered_from_log: true,
        status: log.status || '',
    };
};

const recentOperationLog = (logs, operation, startedAtMs) => {
    const minFinishedAt = Number(startedAtMs || 0) - 30000;

    return (logs || []).find((log) => {
        if (log?.operation !== operation) return false;
        const finishedAt = new Date(log.finished_at || log.started_at || '').getTime();
        return Number.isFinite(finishedAt) && finishedAt >= minFinishedAt;
    }) || null;
};

const SkippedProductsTable = ({ entries = [] }) => {
    if (!entries.length) {
        return null;
    }

    return (
        <div className="overflow-x-auto rounded-sm border border-amber-100">
            <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-[12px] font-black uppercase tracking-wider text-amber-700">Sản phẩm bị bỏ qua</p>
                <p className="text-[12px] font-bold text-amber-700">{compactNumber(entries.length)} sản phẩm</p>
            </div>
            <table className="w-full text-left text-[12px]">
                <thead className="bg-amber-50/60 text-amber-700">
                    <tr>
                        <th className="px-4 py-3 font-black uppercase">SKU</th>
                        <th className="px-4 py-3 font-black uppercase">Tên sản phẩm</th>
                        <th className="px-4 py-3 font-black uppercase">Lý do bỏ qua</th>
                        <th className="px-4 py-3 font-black uppercase">Chỉnh sửa</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-amber-100 bg-white">
                    {entries.map((entry, index) => {
                        const editUrl = entry.admin_edit_url || (entry.product_id ? `/admin/products/edit/${entry.product_id}` : '');
                        return (
                            <tr key={`${entry.id || entry.product_id || index}-${index}`}>
                                <td className="px-4 py-3 font-mono font-bold text-primary">{entry.id || `product-${entry.product_id || '-'}`}</td>
                                <td className="px-4 py-3 font-bold text-primary">{entry.title || '-'}</td>
                                <td className="px-4 py-3 text-amber-700 font-bold">{(entry.errors || []).join('; ') || '-'}</td>
                                <td className="px-4 py-3">
                                    {editUrl ? (
                                        <a href={editUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-sm border border-primary/20 px-3 text-[11px] font-black uppercase text-primary hover:bg-primary hover:text-white">
                                            <span className="material-symbols-outlined text-[16px]">edit_square</span>
                                            Mở
                                        </a>
                                    ) : (
                                        <span className="text-primary/35">-</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

const ProductSetsTable = ({ sets = [], errors = [] }) => {
    if (!sets.length && !errors.length) {
        return null;
    }

    const rows = sets.length
        ? sets
        : errors.map((error, index) => ({
            id: '',
            name: error.name || `product-set-${index + 1}`,
            action: 'error',
            error: error.error || '',
        }));

    const actionLabel = (action) => ({
        created: 'Tạo mới',
        updated: 'Cập nhật',
        unchanged: 'Đã có',
        planned: 'Dự kiến',
        error: 'Lỗi',
    }[action] || action || '-');

    return (
        <div className="overflow-x-auto rounded-sm border border-primary/10">
            <div className="flex items-center justify-between gap-3 border-b border-primary/10 bg-primary/[0.02] px-4 py-3">
                <p className="text-[12px] font-black uppercase tracking-wider text-primary">Nhóm sản phẩm / Product Set</p>
                <p className="text-[12px] font-bold text-primary/60">{compactNumber(rows.length)} nhóm</p>
            </div>
            <table className="w-full text-left text-[12px]">
                <thead className="bg-primary/[0.02] text-primary/50">
                    <tr>
                        <th className="px-4 py-3 font-black uppercase">Danh mục website</th>
                        <th className="px-4 py-3 font-black uppercase">Loại</th>
                        <th className="px-4 py-3 font-black uppercase">Số sản phẩm</th>
                        <th className="px-4 py-3 font-black uppercase">Product Set ID</th>
                        <th className="px-4 py-3 font-black uppercase">Trạng thái</th>
                        <th className="px-4 py-3 font-black uppercase">Bộ lọc</th>
                        <th className="px-4 py-3 font-black uppercase">Lỗi</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-primary/5 bg-white">
                    {rows.map((set, index) => {
                        const filterText = set.filter
                            ? (set.type === 'child'
                                ? `custom_label_0 = ${set.name || '-'}`
                                : `custom_label_1 hoặc custom_label_0 = ${set.name || '-'}`)
                            : '-';
                        return (
                            <tr key={`${set.id || set.name || index}-${index}`}>
                                <td className="px-4 py-3 font-bold text-primary">{set.name || '-'}</td>
                                <td className="px-4 py-3 font-bold text-primary/70">{set.type === 'child' ? 'Danh mục con' : 'Danh mục cha'}</td>
                                <td className="px-4 py-3 font-mono text-primary">{compactNumber(set.product_count || 0)}</td>
                                <td className="px-4 py-3 font-mono text-primary/70">{set.id || '-'}</td>
                                <td className="px-4 py-3 font-black text-primary">{actionLabel(set.action)}</td>
                                <td className="px-4 py-3 text-primary/60">{filterText}</td>
                                <td className="px-4 py-3 text-red-700">{set.error || '-'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
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

    const refreshLogs = useCallback(async () => {
        try {
            const response = await metaCatalogApi.getLogs({ per_page: 10 });
            const nextLogs = response.data?.data || [];
            setLogs(nextLogs);
            return nextLogs;
        } catch {
            // Log refresh is secondary to the action result.
            return [];
        }
    }, []);

    useEffect(() => {
        if (!logs.some(isActiveRunningLog)) {
            return undefined;
        }

        const timer = window.setInterval(() => {
            refreshLogs();
        }, 5000);

        return () => window.clearInterval(timer);
    }, [logs, refreshLogs]);

    const refreshLogsLater = (delays = []) => {
        delays.forEach((delay) => {
            window.setTimeout(() => {
                refreshLogs();
            }, delay);
        });
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
        const startedAtMs = Date.now();
        setRunningDryRun(true);
        setSyncResult(null);
        try {
            const response = await metaCatalogApi.dryRun({ check_remote_urls: checkRemoteUrls });
            const result = response.data?.result || null;
            setDryRunResult(result);
            setSettings((prev) => ({ ...prev, ...(response.data?.settings || {}), access_token: '' }));
            await refreshLogs();
            const skippedCount = Number(result?.skipped_count || 0);
            showModal({
                title: 'Dry-run hoàn tất',
                content: skippedCount > 0
                    ? `Có ${compactNumber(skippedCount)} sản phẩm bị bỏ qua. Các sản phẩm đủ điều kiện vẫn có thể sync Meta.`
                    : 'Tất cả sản phẩm trong phạm vi website đều đủ điều kiện sync Meta.',
                type: 'success',
            });
        } catch (error) {
            const result = error.response?.data?.result || error.response?.data?.log?.details || null;
            if (result) {
                setDryRunResult(result);
            }
            const latestLogs = await refreshLogs();
            const recoveredResult = resultFromLog(recentOperationLog(latestLogs, 'dry_run', startedAtMs));
            if (!result && recoveredResult && Number(recoveredResult.invalid_count || 0) === 0) {
                setDryRunResult(recoveredResult);
                const skippedCount = Number(recoveredResult.skipped_count || 0);
                showModal({
                    title: 'Dry-run hoàn tất',
                    content: skippedCount > 0
                        ? `Backend đã chạy xong. Có ${compactNumber(skippedCount)} sản phẩm bị bỏ qua; các sản phẩm đủ điều kiện vẫn có thể sync Meta.`
                        : 'Backend đã chạy xong và tất cả sản phẩm trong phạm vi website đều đủ điều kiện sync Meta.',
                    type: 'success',
                });
                return;
            }

            showModal({
                title: 'Dry-run thất bại',
                content: error.response?.data?.message || 'Không thể chạy kiểm tra dữ liệu Meta Catalog.',
                type: 'error',
            });
        } finally {
            setRunningDryRun(false);
        }
    };

    const handleSyncNow = async () => {
        if (!dryRunResult || Number(dryRunResult.invalid_count || 0) > 0) {
            showModal({ title: 'Chưa thể đồng bộ', content: 'Cần chạy dry-run thành công trước. Sản phẩm bị bỏ qua không chặn sync live.', type: 'error' });
            return;
        }

        if (!window.confirm('Đồng bộ live lên Meta Catalog ngay bây giờ?')) {
            return;
        }

        const startedAtMs = Date.now();
        setSyncing(true);
        try {
            const response = await metaCatalogApi.syncNow();
            const queued = response.status === 202 || response.data?.queued;
            const result = response.data?.log ? resultFromLog(response.data.log) : (response.data?.result || null);
            setSyncResult(result);
            setSettings((prev) => ({ ...prev, ...(response.data?.settings || {}), access_token: '' }));
            await refreshLogs();
            if (queued) {
                refreshLogsLater([3000, 10000, 30000]);
                showModal({ title: 'Đã bắt đầu đồng bộ', content: 'Backend đang đồng bộ Meta Catalog ở nền. Bảng log sẽ tự cập nhật khi hoàn tất.', type: 'success' });
            } else {
                showModal({ title: 'Đồng bộ thành công', content: 'Đã gửi dữ liệu sản phẩm lên Meta Catalog.', type: 'success' });
            }
        } catch (error) {
            const result = error.response?.data?.result || null;
            if (result) {
                setSyncResult(result);
            }
            const latestLogs = await refreshLogs();
            const recoveredLog = recentOperationLog(latestLogs, 'sync_live', startedAtMs);
            const recoveredResult = resultFromLog(recoveredLog);
            if (!result && recoveredResult && ['running', 'success'].includes(String(recoveredResult.status || ''))) {
                setSyncResult(recoveredResult);
                refreshLogsLater([3000, 10000, 30000]);
                showModal({
                    title: recoveredResult.status === 'success' ? 'Đồng bộ thành công' : 'Đã bắt đầu đồng bộ',
                    content: recoveredResult.status === 'success'
                        ? 'Backend đã đồng bộ Meta Catalog xong.'
                        : 'Backend đang đồng bộ Meta Catalog ở nền. Bảng log sẽ tự cập nhật khi hoàn tất.',
                    type: 'success',
                });
                return;
            }

            showModal({
                title: 'Đồng bộ thất bại',
                content: error.response?.data?.message || 'Không thể đồng bộ lên Meta Catalog.',
                type: 'error',
            });
        } finally {
            setSyncing(false);
        }
    };

    const runningSyncLog = logs.find((log) => log.operation === 'sync_live' && isActiveRunningLog(log));
    const runningProgress = progressFromLog(runningSyncLog);
    const syncDisplayResult = runningSyncLog ? resultFromLog(runningSyncLog) : syncResult;
    const canSync = dryRunResult && Number(dryRunResult.invalid_count || 0) === 0 && !runningDryRun && !syncing && !runningSyncLog;
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
                        <label className={labelClasses}>Ảnh dự phòng lưu cấu hình</label>
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
                        <StatBox label="Đủ điều kiện" value={dryRunResult?.valid_count || 0} tone="green" />
                        <StatBox label="Bị bỏ qua" value={dryRunResult?.skipped_count || 0} tone={Number(dryRunResult?.skipped_count || 0) > 0 ? 'amber' : 'green'} />
                        <StatBox label="Lỗi thật sự" value={dryRunResult?.invalid_count || 0} tone={Number(dryRunResult?.invalid_count || 0) > 0 ? 'red' : 'green'} />
                        <StatBox label="Batch dự kiến" value={dryRunResult?.batch_count || 0} />
                    </div>

                    <SkippedProductsTable entries={dryRunResult?.skipped_entries || []} />
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
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-11 gap-3">
                    <StatBox label="Tổng sản phẩm" value={syncDisplayResult?.feed_count || dryRunResult?.feed_count || 0} />
                    <StatBox label="Đủ điều kiện" value={syncDisplayResult?.valid_count || dryRunResult?.valid_count || 0} tone="green" />
                    <StatBox label="Tạo mới" value={syncDisplayResult?.create_count || 0} tone="green" />
                    <StatBox label="Cập nhật" value={syncDisplayResult?.update_count || 0} />
                    <StatBox label="Xóa khỏi Meta" value={syncDisplayResult?.delete_count || 0} tone="amber" />
                    <StatBox label="Bị bỏ qua" value={syncDisplayResult?.skipped_count || dryRunResult?.skipped_count || 0} tone={Number(syncDisplayResult?.skipped_count || dryRunResult?.skipped_count || 0) > 0 ? 'amber' : 'green'} />
                    <StatBox label="Lỗi thật sự" value={syncDisplayResult?.invalid_count || 0} tone={Number(syncDisplayResult?.invalid_count || 0) > 0 ? 'red' : 'green'} />
                    <StatBox label="Nhóm sản phẩm" value={syncDisplayResult?.product_set_count || 0} />
                    <StatBox label="Nhóm tạo mới" value={syncDisplayResult?.product_set_create_count || 0} tone="green" />
                    <StatBox label="Nhóm cập nhật" value={syncDisplayResult?.product_set_update_count || 0} />
                    <StatBox label="Nhóm lỗi" value={syncDisplayResult?.product_set_error_count || 0} tone={Number(syncDisplayResult?.product_set_error_count || 0) > 0 ? 'red' : 'green'} />
                </div>
                {runningSyncLog && (
                    <div className="mt-4 rounded-sm border border-blue-100 bg-blue-50 px-4 py-3 text-primary">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[12px] font-black uppercase tracking-wider text-blue-700">Đang đồng bộ Meta</p>
                            <p className="text-[12px] font-black text-blue-700">{progressPercent(runningProgress)}%</p>
                        </div>
                        <div className="mt-2 h-2 rounded-sm bg-white">
                            <div className="h-2 rounded-sm bg-blue-600 transition-all duration-300" style={{ width: `${progressPercent(runningProgress)}%` }} />
                        </div>
                        <p className="mt-2 text-[12px] font-bold text-blue-700">{runningProgress?.message || runningSyncLog.summary || 'Backend đang chạy đồng bộ Meta.'}</p>
                    </div>
                )}
                <div className="mt-5">
                    <SkippedProductsTable entries={syncDisplayResult?.skipped_entries || []} />
                </div>
                <div className="mt-5">
                    <ProductSetsTable sets={syncDisplayResult?.product_sets || []} errors={syncDisplayResult?.product_set_errors || []} />
                </div>
                {syncDisplayResult?.product_set_sort_note && (
                    <p className="mt-4 rounded-sm border border-primary/10 bg-stone-50 px-4 py-3 text-[13px] font-bold text-primary/50">
                        {syncDisplayResult.product_set_sort_note}
                    </p>
                )}
                {!canSync && (
                    <p className="mt-4 rounded-sm border border-primary/10 bg-stone-50 px-4 py-3 text-[13px] font-bold text-primary/50">
                        Nút sync live mở sau khi dry-run hoàn tất. Sản phẩm thiếu ảnh/danh mục hoặc đang OFF sẽ tự bị bỏ qua.
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
                                <th className="px-4 py-3 font-black uppercase">Bỏ qua</th>
                                <th className="px-4 py-3 font-black uppercase">Lỗi</th>
                                <th className="px-4 py-3 font-black uppercase">Trạng thái</th>
                                <th className="px-4 py-3 font-black uppercase">Chi tiết</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/5 bg-white">
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="px-4 py-10 text-center text-primary/35">Chưa có log Meta Catalog.</td>
                                </tr>
                            ) : logs.map((log) => {
                                const progress = progressFromLog(log);
                                const detailText = isStaleRunningLog(log)
                                    ? 'Job running qua 10 phut khong cap nhat, co the da bi dung. Co the bam dong bo lai.'
                                    : isRunningLog(log) && progress
                                        ? `${progress.message || log.summary || 'Backend dang chay'} (${progressPercent(progress)}%)`
                                        : (log.summary || log.error_message || '-');

                                return (
                                <tr key={log.id}>
                                    <td className="px-4 py-3 font-bold text-primary">{formatTime(log.finished_at || log.started_at)}</td>
                                    <td className="px-4 py-3 font-black text-primary">{operationLabel(log.operation)}</td>
                                    <td className="px-4 py-3 text-primary/70">{log.user?.name || log.user?.email || 'Hệ thống'}</td>
                                    <td className="px-4 py-3 font-mono text-primary">{compactNumber(log.total_products)}</td>
                                    <td className="px-4 py-3 font-mono text-green-700">{compactNumber(log.success_count || log.valid_products)}</td>
                                    <td className="px-4 py-3 font-mono text-amber-700">{compactNumber(log.skipped_count || 0)}</td>
                                    <td className="px-4 py-3 font-mono text-red-700">{compactNumber(log.error_count || log.invalid_products)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`rounded-sm border px-2 py-1 text-[10px] font-black uppercase ${statusClasses(log.status)}`}>{log.status}</span>
                                    </td>
                                    <td className="px-4 py-3 max-w-[360px] truncate text-primary/60" title={detailText}>
                                        {detailText}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </SectionCard>
        </div>
    );
};

export default MetaCatalogSettingsPanel;
