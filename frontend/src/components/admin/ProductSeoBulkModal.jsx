import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isRetryableRequestError, productSeoBulkApi } from '../../services/api';
import { resolveAiRequestError } from '../../utils/aiError';

const RUN_ACTIVE_STATUSES = ['queued', 'running'];
const RUN_FINAL_STATUSES = ['completed', 'completed_with_errors', 'failed'];
const BASE_POLL_DELAY_MS = 2500;
const MAX_POLL_DELAY_MS = 15000;
const RECOVERY_DELAYS_MS = [750, 1500, 3000];

const formatDateTime = (value) => {
    if (!value) return '--';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';

    return date.toLocaleString('vi-VN');
};

const isRunActive = (status) => RUN_ACTIVE_STATUSES.includes(String(status || '').toLowerCase());

const waitForDelay = (delayMs) => new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
});

const buildRunRequestKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `seo-bulk-${crypto.randomUUID()}`;
    }

    return `seo-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const runStatusLabel = (status) => {
    switch (String(status || '').toLowerCase()) {
    case 'queued':
        return 'Da xep hang';
    case 'running':
        return 'Dang xu ly';
    case 'completed':
        return 'Hoan tat';
    case 'completed_with_errors':
        return 'Hoan tat co muc loi';
    case 'failed':
        return 'Khong hoan tat';
    default:
        return status || '--';
    }
};

const itemStatusLabel = (status) => {
    switch (String(status || '').toLowerCase()) {
    case 'queued':
        return 'Cho xu ly';
    case 'processing':
        return 'Dang tao SEO';
    case 'retrying':
        return 'Cho thu lai';
    case 'completed':
        return 'Hoan tat';
    case 'failed':
        return 'Can kiem tra';
    default:
        return status || '--';
    }
};

const statusBadgeClassName = (status) => {
    switch (String(status || '').toLowerCase()) {
    case 'completed':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'processing':
    case 'running':
        return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'retrying':
        return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'failed':
    case 'completed_with_errors':
        return 'border-red-200 bg-red-50 text-red-700';
    default:
        return 'border-slate-200 bg-slate-50 text-slate-700';
    }
};

const ProductSeoBulkModal = ({
    open,
    onClose,
    selectedProductIds = [],
    initialSelectedIds = null,
    currentRunId = null,
    autoStartToken = null,
    onRunChange,
    onCompleted,
}) => {
    // initialSelectedIds overrides selectedProductIds if provided (used when opening from product list)
    const effectiveSelectedIds = initialSelectedIds !== null ? initialSelectedIds : selectedProductIds;

    const [currentRun, setCurrentRun] = useState(null);
    const [loadingRun, setLoadingRun] = useState(false);
    const [creatingRun, setCreatingRun] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [transientMessage, setTransientMessage] = useState('');
    const [lastProcessedCount, setLastProcessedCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [pollRetryCount, setPollRetryCount] = useState(0);
    const autoStartedTokenRef = useRef(null);
    const completedRunIdRef = useRef(null);
    const pollTimeoutRef = useRef(null);
    const loadRequestIdRef = useRef(0);
    const createRequestKeyRef = useRef(null);

    const effectiveRunId = currentRun?.id || currentRunId || null;

    const clearPollingTimeout = useCallback(() => {
        if (pollTimeoutRef.current) {
            window.clearTimeout(pollTimeoutRef.current);
            pollTimeoutRef.current = null;
        }
    }, []);

    const notifyRunChange = useCallback((run) => {
        setCurrentRun(run);

        const processed = Number(run?.completed_items || 0) + Number(run?.failed_items || 0);

        if (processed > lastProcessedCount) {
            setLastProcessedCount(processed);
            setErrorMessage('');
            setTransientMessage('');
        }

        if (run?.request_key) {
            createRequestKeyRef.current = run.request_key;
        }

        if (run?.id) {
            onRunChange?.(run);
        }

        const normalizedStatus = String(run?.status || '').toLowerCase();
        if (run?.id && RUN_FINAL_STATUSES.includes(normalizedStatus) && completedRunIdRef.current !== run.id) {
            completedRunIdRef.current = run.id;
            onCompleted?.(run);
        }
    }, [onCompleted, onRunChange, lastProcessedCount]);

    const recoverRunByRequestKey = useCallback(async (requestKey) => {
        if (!requestKey) {
            return null;
        }

        for (let attemptIndex = 0; attemptIndex <= RECOVERY_DELAYS_MS.length; attemptIndex += 1) {
            try {
                const response = await productSeoBulkApi.listRuns({
                    limit: 1,
                    request_key: requestKey,
                });
                const [run] = Array.isArray(response.data?.data) ? response.data.data : [];

                if (run?.id) {
                    return run;
                }
            } catch (error) {
                if (!isRetryableRequestError(error)) {
                    throw error;
                }
            }

            if (attemptIndex < RECOVERY_DELAYS_MS.length) {
                await waitForDelay(RECOVERY_DELAYS_MS[attemptIndex]);
            }
        }

        return null;
    }, []);

    const loadRun = useCallback(async (runId, { silent = false } = {}) => {
        if (!runId) {
            return null;
        }

        const requestId = loadRequestIdRef.current + 1;
        loadRequestIdRef.current = requestId;

        if (!silent) {
            setLoadingRun(true);
        }

        try {
            const response = await productSeoBulkApi.getRun(runId, {
                page,
                per_page: 25,
                status: statusFilter || undefined,
                search: search || undefined,
            });

            if (loadRequestIdRef.current !== requestId) {
                return null;
            }

            const run = response.data?.data || null;
            if (!run) {
                throw new Error('RUN_NOT_FOUND');
            }

            setErrorMessage('');
            setTransientMessage('');
            setPollRetryCount(0);
            notifyRunChange(run);

            return run;
        } catch (error) {
            if (loadRequestIdRef.current !== requestId) {
                return null;
            }

            const resolvedMessage = resolveAiRequestError(error, 'Khong the tai tien trinh SEO AI hang loat.');

            if (isRetryableRequestError(error)) {
                setTransientMessage(resolvedMessage);
            } else {
                setErrorMessage(resolvedMessage);
            }

            setPollRetryCount((previousCount) => Math.min(previousCount + 1, 4));
            return null;
        } finally {
            if (!silent && loadRequestIdRef.current === requestId) {
                setLoadingRun(false);
            }
        }
    }, [notifyRunChange, page, search, statusFilter]);

    const resetRunFilters = useCallback(() => {
        setPage(1);
        setStatusFilter('');
        setSearch('');
        setSearchInput('');
    }, []);

    const startRun = useCallback(async () => {
        if (!Array.isArray(effectiveSelectedIds) || effectiveSelectedIds.length === 0) {
            return;
        }

        const requestKey = createRequestKeyRef.current || buildRunRequestKey();
        createRequestKeyRef.current = requestKey;

        setCreatingRun(true);
        setErrorMessage('');
        setTransientMessage('');

        try {
            const response = await productSeoBulkApi.createRun({
                product_ids: effectiveSelectedIds,
                request_key: requestKey,
            });

            const run = response.data?.data || null;
            if (!run?.id) {
                throw new Error('CREATE_RUN_FAILED');
            }

            setPollRetryCount(0);
            resetRunFilters();
            notifyRunChange(run);
        } catch (error) {
            if (isRetryableRequestError(error)) {
                const recoveredRun = await recoverRunByRequestKey(requestKey);

                if (recoveredRun?.id) {
                    setErrorMessage('');
                    setTransientMessage('Ket noi vua bi thay doi, da noi lai dung tien trinh SEO AI vua tao.');
                    setPollRetryCount(0);
                    resetRunFilters();
                    notifyRunChange(recoveredRun);
                    return;
                }
            }

            setErrorMessage(resolveAiRequestError(error, 'Khong the tao tien trinh SEO AI hang loat.'));
        } finally {
            setCreatingRun(false);
        }
    }, [notifyRunChange, recoverRunByRequestKey, resetRunFilters, effectiveSelectedIds]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        if (
            autoStartToken
            && autoStartedTokenRef.current !== autoStartToken
            && Array.isArray(effectiveSelectedIds)
            && effectiveSelectedIds.length > 0
        ) {
            autoStartedTokenRef.current = autoStartToken;
            createRequestKeyRef.current = buildRunRequestKey();
            startRun();

            return undefined;
        }

        if (effectiveRunId) {
            loadRun(effectiveRunId);
        }

        return undefined;
    }, [autoStartToken, effectiveRunId, loadRun, open, effectiveSelectedIds, startRun]);

    useEffect(() => {
        clearPollingTimeout();

        if (!open || !effectiveRunId || !isRunActive(currentRun?.status)) {
            return undefined;
        }

        const delayMs = pollRetryCount > 0
            ? Math.min(BASE_POLL_DELAY_MS * (2 ** pollRetryCount), MAX_POLL_DELAY_MS)
            : BASE_POLL_DELAY_MS;

        pollTimeoutRef.current = window.setTimeout(() => {
            loadRun(effectiveRunId, { silent: true });
        }, delayMs);

        return clearPollingTimeout;
    }, [clearPollingTimeout, currentRun, effectiveRunId, loadRun, open, pollRetryCount]);

    useEffect(() => () => {
        clearPollingTimeout();
    }, [clearPollingTimeout]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleOnline = async () => {
            setTransientMessage('');
            setPollRetryCount(0);

            if (effectiveRunId) {
                await loadRun(effectiveRunId, { silent: true });
                return;
            }

            if (createRequestKeyRef.current) {
                const recoveredRun = await recoverRunByRequestKey(createRequestKeyRef.current);

                if (recoveredRun?.id) {
                    notifyRunChange(recoveredRun);
                }
            }
        };

        window.addEventListener('online', handleOnline);

        return () => {
            window.removeEventListener('online', handleOnline);
        };
    }, [effectiveRunId, loadRun, notifyRunChange, open, recoverRunByRequestKey]);

    const handleApplyFilters = (event) => {
        event?.preventDefault?.();
        setPage(1);
        setSearch(searchInput.trim());
    };

    const items = Array.isArray(currentRun?.items) ? currentRun.items : [];
    const itemsMeta = currentRun?.items_meta || {};
    const processedItems = Number(currentRun?.processed_items || 0);
    const totalItems = Number(currentRun?.total_items || 0);
    const workerStatus = currentRun?.worker || null;
    const progressPercent = totalItems > 0
        ? Math.max(0, Math.min(100, Number(currentRun?.progress_percent || ((processedItems / totalItems) * 100))))
        : 0;

    const showQueueWorkerHint = useMemo(() => {
        if (!currentRun || String(currentRun.status || '').toLowerCase() !== 'queued') {
            return false;
        }

        if (workerStatus?.required === false || workerStatus?.running) {
            return false;
        }

        if (String(workerStatus?.state || '').toLowerCase() === 'error') {
            return true;
        }

        const createdAt = currentRun.created_at ? new Date(currentRun.created_at) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime())) {
            return false;
        }

        return (Date.now() - createdAt.getTime()) > 20000;
    }, [currentRun, workerStatus]);

    const statCards = [
        { label: 'Tong san pham', value: totalItems, tone: 'text-slate-800' },
        { label: 'Hoan tat', value: Number(currentRun?.completed_items || 0), tone: 'text-emerald-700' },
        { label: 'Dang tao SEO', value: Number(currentRun?.processing_items || 0), tone: 'text-sky-700' },
        { label: 'Cho thu lai', value: Number(currentRun?.retrying_items || 0), tone: 'text-amber-700' },
        { label: 'Can kiem tra', value: Number(currentRun?.failed_items || 0), tone: 'text-red-700' },
    ];

    if (!open) {
        return null;
    }

    const handleCancelRun = async () => {
        if (!effectiveRunId || !window.confirm('Ban co chac chan muon dung tien trinh dang chay?')) {
            return;
        }

        setCreatingRun(true);
        setErrorMessage('');
        try {
            const response = await productSeoBulkApi.cancelRun(effectiveRunId);
            const run = response.data?.data || null;
            if (run) {
                notifyRunChange(run);
            }
        } catch (error) {
            setErrorMessage(resolveAiRequestError(error, 'Khong the dung tien trinh.'));
        } finally {
            setCreatingRun(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[140] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded w-full max-w-7xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-primary/10 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-[18px] font-black text-[#0F172A]">SEO AI Hang Loat</h3>
                        <p className="text-[12px] text-primary/60 mt-1">
                            He thong tu xu ly tung san pham, tu dong thu lai khi gap loi tam thoi tu AI
                            hoac luc trinh duyet doi mang.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {isRunActive(currentRun?.status) && (
                            <button
                                type="button"
                                onClick={handleCancelRun}
                                disabled={creatingRun || loadingRun}
                                className="flex items-center justify-center h-8 px-4 border border-brick text-brick text-[12px] font-bold rounded hover:bg-brick/5 transition-colors disabled:opacity-50"
                            >
                                Dung chay
                            </button>
                        )}
                        <button type="button" onClick={onClose} className="text-gray-500 hover:text-brick">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>

                <div className="px-5 py-4 border-b border-primary/10 bg-slate-50/70">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-bold ${statusBadgeClassName(currentRun?.status)}`}>
                            <span className="material-symbols-outlined text-[16px]">
                                {creatingRun || loadingRun ? 'sync' : 'monitoring'}
                            </span>
                            {currentRun ? runStatusLabel(currentRun.status) : (creatingRun ? 'Dang tao tien trinh' : 'Chua co tien trinh')}
                        </div>
                        <div className="text-[12px] text-primary/60">
                            Run ID: <span className="font-mono font-bold text-primary/80">{currentRun?.id || '--'}</span>
                        </div>
                        <div className="text-[12px] text-primary/60">
                            Bat dau: <span className="font-semibold text-primary/80">{formatDateTime(currentRun?.started_at || currentRun?.created_at)}</span>
                        </div>
                        <div className="text-[12px] text-primary/60">
                            Ket thuc: <span className="font-semibold text-primary/80">{formatDateTime(currentRun?.finished_at)}</span>
                        </div>
                    </div>

                    <div className="mt-4">
                        <div className="flex items-center justify-between text-[12px] text-primary/60 mb-1.5">
                            <span>Tien do</span>
                            <span className="font-bold text-primary/80">{processedItems}/{totalItems} san pham - {progressPercent.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                            <div
                                className="h-full bg-emerald-500 transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                        {statCards.map((card) => (
                            <div key={card.label} className="rounded border border-primary/10 bg-white px-3 py-3">
                                <div className="text-[11px] uppercase tracking-wide text-primary/45">{card.label}</div>
                                <div className={`text-[20px] font-black mt-1 ${card.tone}`}>{card.value}</div>
                            </div>
                        ))}
                    </div>

                    {showQueueWorkerHint && (
                        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] text-amber-800">
                            Tien trinh dang nam o trang thai xep hang qua lau hoac worker dang loi.
                            Neu can, co the kiem tra worker bang script <span className="font-mono font-bold">backend/run-product-seo-bulk-worker.cmd</span>.
                            {workerStatus?.last_error ? (
                                <div className="mt-2 text-red-700 whitespace-pre-line">
                                    {workerStatus.last_error}
                                </div>
                            ) : null}
                        </div>
                    )}

                    {transientMessage && (
                        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] text-amber-800 whitespace-pre-line">
                            {transientMessage}
                        </div>
                    )}

                    {errorMessage && (
                        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-3 text-[12px] text-red-700 whitespace-pre-line">
                            {errorMessage}
                        </div>
                    )}
                </div>

                <div className="px-5 py-4 border-b border-primary/10">
                    <form className="flex flex-col lg:flex-row gap-3" onSubmit={handleApplyFilters}>
                        <div className="flex-1">
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(event) => setSearchInput(event.target.value)}
                                placeholder="Tim theo SKU hoac ten san pham"
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-semibold text-[#0F172A] focus:outline-none focus:border-primary"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(event) => {
                                setStatusFilter(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 min-w-[180px] bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-semibold text-[#0F172A] focus:outline-none focus:border-primary"
                        >
                            <option value="">Tat ca trang thai</option>
                            <option value="queued">Cho xu ly</option>
                            <option value="processing">Dang tao SEO</option>
                            <option value="retrying">Cho thu lai</option>
                            <option value="completed">Hoan tat</option>
                            <option value="failed">Can kiem tra</option>
                        </select>
                        <button
                            type="submit"
                            className="h-10 px-4 rounded-sm bg-primary text-white font-bold text-[13px] hover:opacity-90"
                        >
                            Loc
                        </button>
                    </form>
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                    <table className="min-w-full text-[13px]">
                        <thead className="sticky top-0 z-10 bg-slate-100/95 text-primary/70">
                            <tr>
                                <th className="px-3 py-3 text-left font-black uppercase tracking-wide border-b border-primary/10">STT</th>
                                <th className="px-3 py-3 text-left font-black uppercase tracking-wide border-b border-primary/10">San pham</th>
                                <th className="px-3 py-3 text-left font-black uppercase tracking-wide border-b border-primary/10">Trang thai</th>
                                <th className="px-3 py-3 text-left font-black uppercase tracking-wide border-b border-primary/10">Lan thu</th>
                                <th className="px-3 py-3 text-left font-black uppercase tracking-wide border-b border-primary/10">Thong tin</th>
                                <th className="px-3 py-3 text-left font-black uppercase tracking-wide border-b border-primary/10">Cap nhat</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-primary/50 border-b border-primary/10">
                                        {loadingRun || creatingRun ? 'Dang tai tien trinh...' : 'Khong co san pham nao khop bo loc hien tai.'}
                                    </td>
                                </tr>
                            ) : items.map((item) => (
                                <tr key={item.id} className="border-b border-primary/10 align-top">
                                    <td className="px-3 py-3 text-primary/55 font-bold">{item.position}</td>
                                    <td className="px-3 py-3">
                                        <div className="font-black text-[#0F172A]">{item.product_name || `San pham #${item.product_id}`}</div>
                                        <div className="text-[11px] text-primary/50 mt-1">
                                            {item.product_sku || '--'} • ID {item.product_id}
                                        </div>
                                    </td>
                                    <td className="px-3 py-3">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-black ${statusBadgeClassName(item.status)}`}>
                                            {itemStatusLabel(item.status)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-primary/70 font-semibold">
                                        {item.attempt_count}/{item.max_attempts}
                                        {item.next_retry_at ? (
                                            <div className="text-[11px] text-amber-700 mt-1">
                                                Thu lai luc {formatDateTime(item.next_retry_at)}
                                            </div>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-3">
                                        {item.last_error ? (
                                            <div className="text-[12px] text-red-700 whitespace-pre-line">
                                                {item.last_error}
                                            </div>
                                        ) : (
                                            <div className="text-[12px] text-primary/45">
                                                {item.last_model ? `Model: ${item.last_model}` : '--'}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-3 text-[12px] text-primary/55">
                                        <div>Bat dau: {formatDateTime(item.started_at)}</div>
                                        <div className="mt-1">Xong: {formatDateTime(item.finished_at)}</div>
                                        <div className="mt-1">Cap nhat: {formatDateTime(item.updated_at)}</div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="px-5 py-4 border-t border-primary/10 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="text-[12px] text-primary/55">
                        Hien thi {itemsMeta.from || 0}-{itemsMeta.to || 0} / {itemsMeta.total || 0} san pham
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={creatingRun || loadingRun || Number(itemsMeta.current_page || 1) <= 1}
                            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                            className="px-3 py-2 border border-primary/20 rounded-sm text-[12px] font-bold text-primary disabled:opacity-40"
                        >
                            Trang truoc
                        </button>
                        <div className="text-[12px] text-primary/60 font-semibold">
                            Trang {itemsMeta.current_page || 1}/{itemsMeta.last_page || 1}
                        </div>
                        <button
                            type="button"
                            disabled={creatingRun || loadingRun || Number(itemsMeta.current_page || 1) >= Number(itemsMeta.last_page || 1)}
                            onClick={() => setPage((prev) => prev + 1)}
                            className="px-3 py-2 border border-primary/20 rounded-sm text-[12px] font-bold text-primary disabled:opacity-40"
                        >
                            Trang sau
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductSeoBulkModal;
