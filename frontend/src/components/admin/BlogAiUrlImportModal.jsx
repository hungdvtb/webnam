import React, { useEffect, useMemo, useRef, useState } from 'react';
import { blogApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const formatDateTime = (value) => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('vi-VN');
};

const statusLabel = (status) => {
    switch (String(status || '').toLowerCase()) {
    case 'pending':
        return 'Chờ xử lý';
    case 'scanning':
        return 'Đang quét';
    case 'scanned':
        return 'Đã quét';
    case 'running':
        return 'Đang tạo';
    case 'paused':
        return 'Tạm dừng';
    case 'processing':
        return 'Đang tạo';
    case 'completed':
        return 'OK';
    case 'completed_with_errors':
        return 'Xong có lỗi';
    case 'failed':
        return 'Lỗi';
    default:
        return status || '--';
    }
};

const statusClassName = (status) => {
    switch (String(status || '').toLowerCase()) {
    case 'completed':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'failed':
        return 'border-brick/25 bg-brick/5 text-brick';
    case 'processing':
    case 'running':
    case 'scanning':
        return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'paused':
    case 'completed_with_errors':
        return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
        return 'border-gold/20 bg-white text-stone/65';
    }
};

const levelClassName = (level) => {
    switch (String(level || '').toLowerCase()) {
    case 'error':
        return 'border-brick/30 bg-brick/5 text-brick';
    case 'warning':
        return 'border-amber-600/25 bg-amber-50 text-amber-700';
    default:
        return 'border-gold/20 bg-white text-stone/80';
    }
};

const normalizeIntegerInput = (value) => String(value || '').replace(/[^0-9]/g, '');

const BlogAiUrlImportModal = ({ open, onClose, onCompleted }) => {
    const { showModal, showToast } = useUI();
    const [sourceUrl, setSourceUrl] = useState('');
    const [maxAiRequests, setMaxAiRequests] = useState('20');
    const [maxArchivePages, setMaxArchivePages] = useState('120');
    const [scanning, setScanning] = useState(false);
    const [running, setRunning] = useState(false);
    const [pauseRequested, setPauseRequested] = useState(false);
    const [recentJobs, setRecentJobs] = useState([]);
    const [currentJob, setCurrentJob] = useState(null);
    const [loadingRecentJobs, setLoadingRecentJobs] = useState(false);
    const pauseRequestedRef = useRef(false);

    const items = useMemo(() => (Array.isArray(currentJob?.items) ? currentJob.items : []), [currentJob?.items]);
    const sortedLogs = useMemo(() => {
        const logs = Array.isArray(currentJob?.logs) ? currentJob.logs : [];
        return [...logs].sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
    }, [currentJob?.logs]);

    const counts = useMemo(() => {
        const base = { total: items.length, pending: 0, processing: 0, completed: 0, failed: 0 };
        items.forEach((item) => {
            const status = String(item?.status || '').toLowerCase();
            if (status === 'pending') base.pending += 1;
            if (status === 'processing') base.processing += 1;
            if (status === 'completed') base.completed += 1;
            if (status === 'failed') base.failed += 1;
        });
        return base;
    }, [items]);

    const loadRecentJobs = async () => {
        setLoadingRecentJobs(true);
        try {
            const response = await blogApi.listAiUrlJobs({ limit: 6 });
            const nextJobs = Array.isArray(response.data?.data) ? response.data.data : [];
            setRecentJobs(nextJobs);
            if (!currentJob && nextJobs[0]) {
                const detailResponse = await blogApi.getAiUrlJob(nextJobs[0].id);
                setCurrentJob(detailResponse.data?.data || nextJobs[0]);
            }
        } catch {
            // no-op
        } finally {
            setLoadingRecentJobs(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        loadRecentJobs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const refreshCurrentJob = async (jobId = currentJob?.id) => {
        if (!jobId) return null;
        const response = await blogApi.getAiUrlJob(jobId);
        const nextJob = response.data?.data || null;
        if (nextJob) setCurrentJob(nextJob);
        return nextJob;
    };

    const handleOpenExistingJob = async (jobId) => {
        try {
            await refreshCurrentJob(jobId);
        } catch {
            showModal({
                title: 'Không tải được tiến trình',
                content: 'Không thể lấy chi tiết tiến trình URL này lúc này.',
                type: 'error',
            });
        }
    };

    const handleScan = async () => {
        const normalizedUrl = sourceUrl.trim();
        if (!normalizedUrl) {
            showModal({
                title: 'Cần link đối thủ',
                content: 'Hãy nhập link trang tin tức hoặc archive bài viết của đối thủ.',
                type: 'warning',
            });
            return;
        }

        const payload = {
            source_url: normalizedUrl,
            max_ai_requests: Number.parseInt(maxAiRequests || '20', 10),
            max_archive_pages: Number.parseInt(maxArchivePages || '120', 10),
        };

        if (!Number.isFinite(payload.max_ai_requests) || payload.max_ai_requests < 1) {
            showModal({ title: 'Giới hạn request chưa hợp lệ', content: 'Request AI tối đa phải từ 1 trở lên.', type: 'warning' });
            return;
        }

        setScanning(true);
        try {
            const createResponse = await blogApi.createAiUrlJob(payload);
            const createdJob = createResponse.data?.data || null;
            if (!createdJob?.id) throw new Error('CREATE_URL_JOB_FAILED');

            setCurrentJob(createdJob);
            const scanResponse = await blogApi.scanAiUrlJob(createdJob.id);
            const scannedJob = scanResponse.data?.data || null;
            if (scannedJob) setCurrentJob(scannedJob);
            await loadRecentJobs();

            showToast({
                type: 'success',
                message: `Đã quét được ${scannedJob?.items?.length || scannedJob?.cluster_count || 0} bài viết.`,
            });
        } catch (error) {
            const message = error?.response?.data?.message
                || error?.response?.data?.error
                || 'Không thể quét URL này.';
            showModal({ title: 'Quét URL thất bại', content: message, type: 'error' });
        } finally {
            setScanning(false);
        }
    };

    const runCreateLoop = async () => {
        if (!currentJob?.id) {
            showModal({ title: 'Chưa có danh sách bài', content: 'Hãy quét URL trước khi tạo bài.', type: 'warning' });
            return;
        }

        pauseRequestedRef.current = false;
        setPauseRequested(false);
        setRunning(true);
        let activeJobId = currentJob.id;

        try {
            let shouldContinue = true;

            while (shouldContinue && !pauseRequestedRef.current) {
                const response = await blogApi.processNextAiUrlJob(activeJobId);
                const nextJob = response.data?.data || null;
                if (nextJob) {
                    setCurrentJob(nextJob);
                    activeJobId = nextJob.id;
                }

                if (response.data?.paused) {
                    shouldContinue = false;
                    showToast({ type: 'warning', message: response.data?.message || 'Đã tạm dừng tiến trình.' });
                    break;
                }

                if (response.data?.done) {
                    shouldContinue = false;
                    showToast({ type: 'success', message: 'Đã xử lý hết danh sách bài đang chờ.' });
                    onCompleted?.(nextJob);
                    break;
                }
            }

            if (pauseRequestedRef.current) {
                const pauseResponse = await blogApi.pauseAiUrlJob(activeJobId);
                const pausedJob = pauseResponse.data?.data || null;
                if (pausedJob) setCurrentJob(pausedJob);
                setPauseRequested(false);
                showToast({ type: 'warning', message: 'Đã tạm dừng sau bài đang chạy.' });
            }

            await loadRecentJobs();
            await refreshCurrentJob(activeJobId);
        } catch (error) {
            const message = error?.response?.data?.message
                || error?.response?.data?.error
                || 'Không thể tạo bài từ danh sách URL lúc này.';
            showModal({ title: 'Tiến trình bị lỗi', content: message, type: 'error' });
            if (activeJobId) {
                try {
                    await blogApi.pauseAiUrlJob(activeJobId);
                    await refreshCurrentJob(activeJobId);
                } catch {
                    // no-op
                }
            }
        } finally {
            setRunning(false);
            pauseRequestedRef.current = false;
            setPauseRequested(false);
        }
    };

    const handlePause = () => {
        pauseRequestedRef.current = true;
        setPauseRequested(true);
    };

    const handleResetFailed = async () => {
        if (!currentJob?.id) return;

        try {
            const response = await blogApi.resetFailedAiUrlJob(currentJob.id);
            const nextJob = response.data?.data || null;
            if (nextJob) setCurrentJob(nextJob);
            showToast({ type: 'success', message: 'Đã đưa các bài lỗi về trạng thái chờ chạy lại.' });
        } catch {
            showModal({ title: 'Không thể reset lỗi', content: 'Hãy thử tải lại tiến trình rồi thao tác lại.', type: 'error' });
        }
    };

    if (!open) return null;

    const summary = currentJob?.summary || {};
    const canCreate = Boolean(currentJob?.id && counts.total > 0 && counts.pending > 0 && !running && !pauseRequested && !scanning);

    return (
        <div className="fixed inset-0 z-[90] bg-primary/40 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={onClose}>
            <div className="w-full max-w-7xl bg-[#fcfcfa] border border-gold/20 rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[92vh]" onClick={(event) => event.stopPropagation()}>
                <div className="px-5 py-4 border-b border-gold/15 flex items-start justify-between gap-4 bg-white">
                    <div>
                        <h3 className="text-[18px] font-bold text-primary uppercase tracking-wide">Tạo bài AI từ URL đối thủ</h3>
                        <p className="text-[11px] text-stone/55 mt-1">Quét toàn bộ link bài viết trước, sau đó tạo từng bài một. Bài tạo ra luôn là bản nháp.</p>
                    </div>
                    <button type="button" onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-brick">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 min-h-0">
                    <div className="lg:col-span-4 border-r border-gold/10 bg-white/70 p-5 space-y-4 overflow-auto">
                        <div className="border border-dashed border-gold/25 rounded-sm p-4 bg-gold/5 space-y-3">
                            <label className="block">
                                <div className="text-[11px] text-stone/70 mb-1">Link trang tin tức đối thủ</div>
                                <input
                                    type="url"
                                    value={sourceUrl}
                                    onChange={(event) => setSourceUrl(event.target.value)}
                                    placeholder="https://xuonggomsuviet.vn/tin-tuc"
                                    className="w-full h-10 px-3 rounded-sm border border-gold/20 bg-white text-[13px] text-primary placeholder:text-stone/35 focus:outline-none focus:ring-2 focus:ring-gold/25"
                                />
                            </label>

                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <div className="text-[11px] text-stone/70 mb-1">Request AI tối đa</div>
                                    <input
                                        type="number"
                                        min="1"
                                        value={maxAiRequests}
                                        onChange={(event) => setMaxAiRequests(normalizeIntegerInput(event.target.value))}
                                        className="w-full h-10 px-3 rounded-sm border border-gold/20 bg-white text-[13px] text-primary focus:outline-none focus:ring-2 focus:ring-gold/25"
                                    />
                                </label>
                                <label className="block">
                                    <div className="text-[11px] text-stone/70 mb-1">Trang archive tối đa</div>
                                    <input
                                        type="number"
                                        min="1"
                                        value={maxArchivePages}
                                        onChange={(event) => setMaxArchivePages(normalizeIntegerInput(event.target.value))}
                                        className="w-full h-10 px-3 rounded-sm border border-gold/20 bg-white text-[13px] text-primary focus:outline-none focus:ring-2 focus:ring-gold/25"
                                    />
                                </label>
                            </div>

                            <div className="text-[11px] text-stone/55">
                                Bước 1 quét tất cả bài tìm được trong các trang phân trang. Bước 2 tạo từng bài một để dễ tạm dừng và theo dõi lỗi.
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleScan}
                                    disabled={scanning || running}
                                    className="h-9 px-4 bg-white border border-primary/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-60"
                                >
                                    {scanning ? 'Đang quét...' : 'Quét bài'}
                                </button>
                                <button
                                    type="button"
                                    onClick={runCreateLoop}
                                    disabled={!canCreate}
                                    className="h-9 px-4 bg-primary text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-60"
                                >
                                    Tạo / tạo tiếp
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePause}
                                    disabled={!running || pauseRequested}
                                    className="h-9 px-4 bg-amber-600 text-white hover:bg-amber-700 rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                                >
                                    {pauseRequested ? 'Đang dừng...' : 'Tạm dừng'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetFailed}
                                    disabled={!currentJob?.id || counts.failed === 0 || running || scanning}
                                    className="h-9 px-4 bg-white border border-brick/25 text-brick hover:bg-brick/5 rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                                >
                                    Chạy lại lỗi
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[12px] font-bold uppercase tracking-widest text-primary">Tiến trình URL gần đây</div>
                                <button type="button" onClick={loadRecentJobs} className="text-[10px] uppercase tracking-widest text-stone/60 hover:text-primary">
                                    {loadingRecentJobs ? 'Đang tải...' : 'Tải lại'}
                                </button>
                            </div>

                            <div className="space-y-2">
                                {recentJobs.length === 0 ? (
                                    <div className="border border-gold/15 rounded-sm bg-stone/5 p-3 text-[12px] text-stone/60 italic">
                                        Chưa có tiến trình URL nào.
                                    </div>
                                ) : recentJobs.map((job) => (
                                    <button
                                        key={job.id}
                                        type="button"
                                        onClick={() => handleOpenExistingJob(job.id)}
                                        className={`w-full text-left border rounded-sm p-3 transition-colors ${currentJob?.id === job.id ? 'border-primary bg-primary/5' : 'border-gold/15 bg-white hover:bg-gold/5'}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[12px] font-semibold text-primary truncate">{job.source_url || job.source_filename}</div>
                                            <span className={`text-[10px] uppercase tracking-widest border rounded-sm px-2 py-0.5 ${statusClassName(job.status)}`}>{statusLabel(job.status)}</span>
                                        </div>
                                        <div className="mt-2 text-[11px] text-stone/60">
                                            {job.summary?.completed_items || 0} OK / {job.summary?.pending_items || 0} chờ / {job.summary?.failed_items || 0} lỗi
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-8 p-5 flex flex-col min-h-0 overflow-hidden">
                        {!currentJob ? (
                            <div className="flex-1 border border-dashed border-gold/20 rounded-sm bg-white flex items-center justify-center text-[13px] text-stone/55">
                                Nhập URL rồi bấm "Quét bài" để lấy danh sách bài viết.
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Trạng thái</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{statusLabel(currentJob.status)}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Tổng bài quét</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{counts.total}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">OK</div>
                                        <div className="mt-2 text-[14px] font-semibold text-emerald-700">{counts.completed}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Chưa chạy</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{counts.pending}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Lỗi</div>
                                        <div className="mt-2 text-[14px] font-semibold text-brick">{counts.failed}</div>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="border border-gold/15 rounded-sm bg-white p-3 text-[12px] text-stone/70 break-words">
                                        <div><span className="font-semibold text-primary">URL:</span> {currentJob.source_url || currentJob.source_filename}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Model:</span> {currentJob.ai_model || 'Chưa có'}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3 text-[12px] text-stone/70">
                                        <div><span className="font-semibold text-primary">Request AI:</span> {summary.ai_requests_used || 0}/{summary.max_ai_requests || currentJob.max_ai_requests || 20}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Bắt đầu:</span> {formatDateTime(currentJob.started_at)}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Kết thúc:</span> {formatDateTime(currentJob.finished_at)}</div>
                                    </div>
                                </div>

                                <div className="mt-4 flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-3 overflow-hidden">
                                    <div className="xl:col-span-8 border border-gold/15 rounded-sm bg-white overflow-hidden flex flex-col min-h-0">
                                        <div className="px-4 py-3 border-b border-gold/10 flex items-center justify-between gap-3">
                                            <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Danh sách bài đã quét</div>
                                            <div className="text-[11px] text-stone/55">{items.length} bài</div>
                                        </div>
                                        <div className="flex-1 overflow-auto bg-[#fdfcf8]">
                                            {items.length === 0 ? (
                                                <div className="p-4 text-[12px] text-stone/55 italic">Chưa có bài nào. Hãy bấm quét bài trước.</div>
                                            ) : items.map((item) => (
                                                <div key={item.id} className="grid grid-cols-[54px_1fr_96px] gap-3 border-b border-gold/10 px-3 py-2.5 items-start">
                                                    <div className="text-[11px] font-bold text-stone/45 pt-1">#{item.position}</div>
                                                    <div className="min-w-0">
                                                        <div className="text-[12px] font-semibold text-primary truncate">{item.generated_title || item.source_title || item.source_url}</div>
                                                        <div className="mt-1 text-[10px] text-stone/45 truncate">{item.source_url}</div>
                                                        {item.last_error ? (
                                                            <div className="mt-1 text-[11px] text-brick line-clamp-2">{item.last_error}</div>
                                                        ) : null}
                                                    </div>
                                                    <div className={`text-center text-[10px] font-bold uppercase tracking-widest border rounded-sm px-2 py-1 ${statusClassName(item.status)}`}>
                                                        {statusLabel(item.status)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="xl:col-span-4 border border-gold/15 rounded-sm bg-white overflow-hidden flex flex-col min-h-0">
                                        <div className="px-4 py-3 border-b border-gold/10 flex items-center justify-between gap-3">
                                            <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Log xử lý</div>
                                            <div className="text-[11px] text-stone/55">{sortedLogs.length}</div>
                                        </div>
                                        <div className="flex-1 overflow-auto p-3 space-y-2 bg-[#fdfcf8]">
                                            {sortedLogs.length === 0 ? (
                                                <div className="text-[12px] text-stone/55 italic">Chưa có log nào.</div>
                                            ) : sortedLogs.map((log) => (
                                                <div key={log.id} className={`border rounded-sm p-2.5 ${levelClassName(log.level)}`}>
                                                    <div className="text-[12px] font-semibold break-words">{log.message}</div>
                                                    <div className="mt-2 text-[10px] text-stone/55">
                                                        {formatDateTime(log.created_at)}
                                                        {log.step ? ` · ${log.step}` : ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BlogAiUrlImportModal;
