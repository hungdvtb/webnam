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
    case 'running':
        return 'Đang xử lý';
    case 'completed':
        return 'Hoàn tất';
    case 'completed_with_errors':
        return 'Hoàn tất có lỗi';
    case 'failed':
        return 'Thất bại';
    default:
        return status || '--';
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

const levelLabel = (level) => {
    switch (String(level || '').toLowerCase()) {
    case 'error':
        return 'Lỗi';
    case 'warning':
        return 'Cần chú ý';
    default:
        return 'Thông tin';
    }
};

const BlogAiBulkModal = ({ open, onClose, onCompleted }) => {
    const { showModal, showToast } = useUI();
    const [selectedFile, setSelectedFile] = useState(null);
    const [requestedPostCount, setRequestedPostCount] = useState('');
    const [creatingJob, setCreatingJob] = useState(false);
    const [runningJob, setRunningJob] = useState(false);
    const [recentJobs, setRecentJobs] = useState([]);
    const [currentJob, setCurrentJob] = useState(null);
    const [loadingRecentJobs, setLoadingRecentJobs] = useState(false);
    const fileInputRef = useRef(null);

    const loadRecentJobs = async () => {
        setLoadingRecentJobs(true);
        try {
            const response = await blogApi.listAiBulkJobs({ limit: 6 });
            const items = Array.isArray(response.data?.data) ? response.data.data : [];
            setRecentJobs(items);
            if (!currentJob && items[0]) {
                const detailResponse = await blogApi.getAiBulkJob(items[0].id);
                setCurrentJob(detailResponse.data?.data || items[0]);
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

    useEffect(() => {
        if (!open || !currentJob?.id) return undefined;
        const normalizedStatus = String(currentJob.status || '').toLowerCase();
        if (!['pending', 'running'].includes(normalizedStatus)) return undefined;

        const intervalId = window.setInterval(async () => {
            try {
                const response = await blogApi.getAiBulkJob(currentJob.id);
                const nextJob = response.data?.data || null;
                if (!nextJob) return;

                setCurrentJob(nextJob);

                const finalStatus = String(nextJob.status || '').toLowerCase();
                if (!['pending', 'running'].includes(finalStatus)) {
                    setRunningJob(false);
                    window.clearInterval(intervalId);

                    if (['completed', 'completed_with_errors'].includes(finalStatus)) {
                        showToast({
                            message: finalStatus === 'completed'
                                ? 'Đã tạo bài AI từ Excel xong.'
                                : 'Tiến trình đã xong, nhưng có một vài cụm bị lỗi.',
                            type: finalStatus === 'completed' ? 'success' : 'warning',
                        });
                        onCompleted?.(nextJob);
                    }
                }
            } catch {
                // no-op
            }
        }, 2500);

        return () => window.clearInterval(intervalId);
    }, [currentJob?.id, currentJob?.status, onCompleted, open, showToast]);

    const sortedLogs = useMemo(() => {
        const logs = Array.isArray(currentJob?.logs) ? currentJob.logs : [];
        return [...logs].sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
    }, [currentJob?.logs]);

    const handleChooseFile = () => {
        fileInputRef.current?.click?.();
    };

    const handleFileChange = (event) => {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        setSelectedFile(file);
    };

    const handleRequestedPostCountChange = (event) => {
        const rawValue = String(event.target.value || '');
        if (rawValue === '') {
            setRequestedPostCount('');
            return;
        }

        const sanitized = rawValue.replace(/[^0-9]/g, '');
        setRequestedPostCount(sanitized);
    };

    const handleOpenExistingJob = async (jobId) => {
        try {
            const response = await blogApi.getAiBulkJob(jobId);
            setCurrentJob(response.data?.data || null);
        } catch {
            showModal({
                title: 'Không tải được tiến trình',
                content: 'Không thể lấy chi tiết tiến trình này lúc này.',
                type: 'error',
            });
        }
    };

    const handleStart = async () => {
        if (!selectedFile) {
            showModal({
                title: 'Cần file keyword',
                content: 'Hãy chọn file .xlsx hoặc .csv chứa danh sách keyword.',
                type: 'warning',
            });
            return;
        }

        if (requestedPostCount !== '') {
            const parsedRequestedPostCount = Number.parseInt(requestedPostCount, 10);
            if (!Number.isFinite(parsedRequestedPostCount) || parsedRequestedPostCount < 1) {
                showModal({
                    title: 'Số bài chưa hợp lệ',
                    content: 'Nhập số bài muốn tạo từ 1 trở lên, hoặc để trống để hệ thống tự quyết định theo cụm keyword.',
                    type: 'warning',
                });
                return;
            }
        }

        const formData = new FormData();
        formData.append('file', selectedFile);
        if (requestedPostCount !== '') {
            formData.append('requested_post_count', requestedPostCount);
        }

        setCreatingJob(true);

        try {
            const createResponse = await blogApi.createAiBulkJob(formData);
            const createdJob = createResponse.data?.data || null;

            if (!createdJob?.id) {
                throw new Error('CREATE_JOB_FAILED');
            }

            setCurrentJob(createdJob);
            setRunningJob(true);
            setSelectedFile(null);
            setRequestedPostCount('');

            blogApi.runAiBulkJob(createdJob.id)
                .then((response) => {
                    const nextJob = response.data?.data || createdJob;
                    setCurrentJob(nextJob);
                    setRunningJob(false);
                    loadRecentJobs();
                })
                .catch((error) => {
                    setRunningJob(false);
                    const message = error?.response?.data?.message
                        || error?.response?.data?.error
                        || 'Không thể bắt đầu tiến trình AI từ Excel.';
                    showModal({
                        title: 'Không thể xử lý file',
                        content: message,
                        type: 'error',
                    });
                });

            await loadRecentJobs();
        } catch (error) {
            const message = error?.response?.data?.message
                || error?.response?.data?.error
                || 'Không thể tạo tiến trình AI từ Excel.';
            showModal({
                title: 'Tạo tiến trình thất bại',
                content: message,
                type: 'error',
            });
        } finally {
            setCreatingJob(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[90] bg-primary/40 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={onClose}>
            <div className="w-full max-w-6xl bg-[#fcfcfa] border border-gold/20 rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[92vh]" onClick={(event) => event.stopPropagation()}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    onChange={handleFileChange}
                />

                <div className="px-5 py-4 border-b border-gold/15 flex items-start justify-between gap-4 bg-white">
                    <div>
                        <h3 className="text-[18px] font-bold text-primary uppercase tracking-wide">Tạo bài AI từ Excel</h3>
                        <p className="text-[11px] text-stone/55 mt-1">Tải file keyword lên, hệ thống sẽ tự gom cụm, tạo danh mục, viết bài, chèn liên kết nội bộ và lưu bài nháp.</p>
                    </div>
                    <button type="button" onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center border border-gold/20 rounded-sm text-stone/60 hover:text-brick">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 min-h-0">
                    <div className="lg:col-span-4 border-r border-gold/10 bg-white/70 p-5 space-y-4 overflow-auto">
                        <div className="border border-dashed border-gold/25 rounded-sm p-4 bg-gold/5 space-y-3">
                            <div className="text-[11px] text-stone/70">File keyword</div>
                            <div className="text-[13px] font-semibold text-primary break-words">
                                {selectedFile ? selectedFile.name : 'Chưa chọn file'}
                            </div>
                            <div className="text-[11px] text-stone/55">
                                Hỗ trợ `.xlsx` và `.csv`. Cần có cột keyword và search volume.
                            </div>
                            <label className="block">
                                <div className="text-[11px] text-stone/70 mb-1">Số bài muốn tạo</div>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    inputMode="numeric"
                                    value={requestedPostCount}
                                    onChange={handleRequestedPostCountChange}
                                    placeholder="Để trống = tự động theo cụm"
                                    className="w-full h-10 px-3 rounded-sm border border-gold/20 bg-white text-[13px] text-primary placeholder:text-stone/35 focus:outline-none focus:ring-2 focus:ring-gold/25"
                                />
                            </label>
                            <div className="text-[11px] text-stone/55">
                                Nếu nhập `50`, hệ thống sẽ ưu tiên 50 cụm keyword mạnh nhất sau khi phân tích và gom nhóm.
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={handleChooseFile} className="h-9 px-4 bg-white border border-gold/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest">
                                    Chọn file
                                </button>
                                <button
                                    type="button"
                                    onClick={handleStart}
                                    disabled={creatingJob || runningJob}
                                    className="h-9 px-4 bg-primary text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-60"
                                >
                                    {creatingJob || runningJob ? 'Đang xử lý...' : 'Bắt đầu tạo bài'}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[12px] font-bold uppercase tracking-widest text-primary">Tiến trình gần đây</div>
                                <button type="button" onClick={loadRecentJobs} className="text-[10px] uppercase tracking-widest text-stone/60 hover:text-primary">
                                    {loadingRecentJobs ? 'Đang tải...' : 'Tải lại'}
                                </button>
                            </div>

                            <div className="space-y-2">
                                {recentJobs.length === 0 ? (
                                    <div className="border border-gold/15 rounded-sm bg-stone/5 p-3 text-[12px] text-stone/60 italic">
                                        Chưa có tiến trình nào.
                                    </div>
                                ) : recentJobs.map((job) => (
                                    <button
                                        key={job.id}
                                        type="button"
                                        onClick={() => handleOpenExistingJob(job.id)}
                                        className={`w-full text-left border rounded-sm p-3 transition-colors ${currentJob?.id === job.id ? 'border-primary bg-primary/5' : 'border-gold/15 bg-white hover:bg-gold/5'}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[12px] font-semibold text-primary truncate">{job.source_filename}</div>
                                            <span className="text-[10px] uppercase tracking-widest text-stone/60">{statusLabel(job.status)}</span>
                                        </div>
                                        <div className="mt-2 text-[11px] text-stone/60">
                                            {job.posts_created || job.summary?.posts_updated || job.summary?.skipped_duplicates
                                                ? `${job.posts_created || 0} bài mới / ${job.summary?.posts_updated || 0} cập nhật / ${job.summary?.skipped_duplicates || 0} bỏ qua`
                                                : 'Chưa có kết quả'}
                                        </div>
                                        <div className="mt-1 text-[11px] text-stone/50">
                                            Mục tiêu: {job.requested_post_count || 'Tự động'}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-8 p-5 flex flex-col min-h-0 overflow-hidden">
                        {!currentJob ? (
                            <div className="flex-1 border border-dashed border-gold/20 rounded-sm bg-white flex items-center justify-center text-[13px] text-stone/55">
                                Chọn file mới hoặc mở một tiến trình gần đây để xem log.
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Trạng thái</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{statusLabel(currentJob.status)}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Cụm đã xử lý</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{currentJob.processed_clusters || 0}/{currentJob.cluster_count || 0}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Bài nháp</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{currentJob.posts_created || 0} mới</div>
                                        <div className="text-[11px] text-stone/55">{currentJob.summary?.posts_updated || 0} cập nhật</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Bỏ qua</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{currentJob.summary?.skipped_duplicates || 0}</div>
                                        <div className="text-[11px] text-stone/55">cụm trùng ý</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3">
                                        <div className="text-[10px] uppercase tracking-widest text-stone/55">Danh mục</div>
                                        <div className="mt-2 text-[14px] font-semibold text-primary">{currentJob.categories_created || 0}</div>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="border border-gold/15 rounded-sm bg-white p-3 text-[12px] text-stone/70">
                                        <div><span className="font-semibold text-primary">File:</span> {currentJob.source_filename}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Keyword:</span> {currentJob.unique_keywords || 0} duy nhất / {currentJob.total_keywords || 0} dòng</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Mục tiêu:</span> {currentJob.requested_post_count || 'Tự động theo cụm'}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Model:</span> {currentJob.ai_model || 'Fallback/template nếu cần'}</div>
                                    </div>
                                    <div className="border border-gold/15 rounded-sm bg-white p-3 text-[12px] text-stone/70">
                                        <div><span className="font-semibold text-primary">Bắt đầu:</span> {formatDateTime(currentJob.started_at)}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Kết thúc:</span> {formatDateTime(currentJob.finished_at)}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Cụm ứng viên:</span> {currentJob.metadata?.total_cluster_candidates || currentJob.cluster_count || 0}</div>
                                        <div className="mt-1"><span className="font-semibold text-primary">Lỗi:</span> {currentJob.posts_failed || 0} cụm</div>
                                    </div>
                                </div>

                                {Array.isArray(currentJob.errors) && currentJob.errors.length > 0 ? (
                                    <div className="mt-4 border border-brick/20 bg-brick/5 rounded-sm p-3">
                                        <div className="text-[11px] font-bold uppercase tracking-widest text-brick">Cụm bị lỗi</div>
                                        <div className="mt-2 space-y-2 max-h-[120px] overflow-auto pr-1">
                                            {currentJob.errors.map((errorMessage, index) => (
                                                <div key={`${errorMessage}-${index}`} className="text-[12px] text-brick">
                                                    {errorMessage}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                <div className="mt-4 flex-1 min-h-0 border border-gold/15 rounded-sm bg-white overflow-hidden flex flex-col">
                                    <div className="px-4 py-3 border-b border-gold/10 flex items-center justify-between gap-3">
                                        <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Log xử lý</div>
                                        <div className="text-[11px] text-stone/55">{sortedLogs.length} dòng log</div>
                                    </div>
                                    <div className="flex-1 overflow-auto p-4 space-y-2 bg-[#fdfcf8]">
                                        {sortedLogs.length === 0 ? (
                                            <div className="text-[12px] text-stone/55 italic">Chưa có log nào.</div>
                                        ) : sortedLogs.map((log) => (
                                            <div key={log.id} className={`border rounded-sm p-3 ${levelClassName(log.level)}`}>
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="text-[12px] font-semibold">
                                                        {log.message}
                                                    </div>
                                                    <div className="text-[10px] uppercase tracking-widest whitespace-nowrap">
                                                        {levelLabel(log.level)}
                                                    </div>
                                                </div>
                                                <div className="mt-2 text-[11px] text-stone/60">
                                                    {formatDateTime(log.created_at)}
                                                    {log.step ? ` • ${log.step}` : ''}
                                                </div>
                                            </div>
                                        ))}
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

export default BlogAiBulkModal;
