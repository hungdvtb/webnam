import React, { useState, useRef } from 'react';
import { shipmentApi } from '../../services/api';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const SHIPPING_MAPPING_REFRESH_EVENT = 'shipping:mapping-refresh';
const SHIPPING_MAPPING_REFRESH_KEY = 'shippingMappingRefreshToken';

const ViettelPostReconcileModal = ({ isOpen, onClose, onRefresh }) => {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    if (!isOpen) return null;

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile && (selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls'))) {
            setFile(selectedFile);
            setError(null);
        } else {
            setError('Vui lòng chọn file Excel (.xlsx hoặc .xls)');
            setFile(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        setUploading(true);
        setError(null);
        setResult(null);
        try {
            const response = await shipmentApi.reconcileViettelPost(formData);
            setResult(response.data);
            notifyMappingRefresh();
            if (onRefresh) onRefresh();
        } catch (err) {
            setError(err.response?.data?.message || 'Có lỗi xảy ra khi xử lý file.');
        } finally {
            setUploading(false);
        }
    };

    const notifyMappingRefresh = () => {
        const payload = {
            source: 'viettel_post_reconcile',
            carrier_code: 'viettel_post',
            refreshed_at: Date.now(),
        };

        try {
            window.localStorage.setItem(SHIPPING_MAPPING_REFRESH_KEY, JSON.stringify(payload));
        } catch (storageError) {
            console.warn('Unable to persist mapping refresh token', storageError);
        }

        window.dispatchEvent(new CustomEvent(SHIPPING_MAPPING_REFRESH_EVENT, { detail: payload }));
    };

    const resetModal = () => {
        setFile(null);
        setResult(null);
        setError(null);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const s = result; // shorthand

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div
                className="absolute inset-0 bg-primary/40 backdrop-blur-md animate-in fade-in duration-300"
                onClick={() => !uploading && onClose()}
            />

            <div className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="bg-gradient-to-r from-violet-600 to-indigo-700 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                                <span className="material-symbols-outlined text-[28px]">account_balance_wallet</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">Đối soát Viettel Post</h3>
                                <p className="text-sm text-violet-100 opacity-80 uppercase tracking-widest font-black text-[10px] mt-0.5">Import bảng kê Excel</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>

                <div className="p-8 max-h-[80vh] overflow-y-auto custom-scrollbar">
                    {!result ? (
                        <div className="space-y-6">
                            {/* Upload Area */}
                            <div
                                onClick={() => !uploading && fileInputRef.current?.click()}
                                className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all cursor-pointer ${
                                    file
                                    ? 'border-violet-400 bg-violet-50/50'
                                    : 'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/30'
                                }`}
                            >
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
                                <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-all duration-500 ${
                                    file ? 'bg-violet-500 text-white scale-110 shadow-lg' : 'bg-white text-slate-400 group-hover:text-violet-500 group-hover:scale-105 shadow-sm'
                                }`}>
                                    <span className="material-symbols-outlined text-[32px]">{file ? 'description' : 'upload_file'}</span>
                                </div>
                                {file ? (
                                    <div className="text-center animate-in slide-in-from-bottom-2">
                                        <p className="font-bold text-slate-700 mb-1">{file.name}</p>
                                        <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                                        <button onClick={(e) => { e.stopPropagation(); resetModal(); }} className="mt-4 text-xs font-bold text-rose-500 hover:underline">Thay đổi file</button>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <p className="font-bold text-slate-700 mb-1">Kéo thả hoặc click để chọn file</p>
                                        <p className="text-xs text-slate-400 uppercase tracking-wider font-black">Hỗ trợ .xlsx, .xls</p>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-600 border border-rose-100">
                                    <span className="material-symbols-outlined text-[18px]">error</span>
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={handleUpload}
                                disabled={!file || uploading}
                                className={`group relative flex h-14 w-full items-center justify-center overflow-hidden rounded-xl font-bold transition-all ${
                                    !file || uploading
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-200'
                                }`}
                            >
                                {uploading ? (
                                    <div className="flex items-center gap-3">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                        <span>Đang xử lý dữ liệu...</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span>Bắt đầu đối soát</span>
                                        <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
                                    </div>
                                )}
                            </button>
                        </div>
                    ) : (
                        /* ─── Result Area ─────────────────────────────────── */
                        <div className="space-y-4 animate-in fade-in duration-500">

                            {/* Total rows */}
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 flex items-center justify-between">
                                <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">Tổng dòng đọc</p>
                                <p className="text-2xl font-black text-slate-800">{s.total_rows}</p>
                            </div>

                            {/* Row 1: Received COD + In-progress */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-emerald-500 mb-1">✓ Đã nhận COD</p>
                                    <p className="text-3xl font-black text-emerald-700">{s.received_cod ?? 0}</p>
                                </div>
                                <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-blue-400 mb-1">⏳ Đang xử lý</p>
                                    <p className="text-3xl font-black text-blue-600">{s.in_progress ?? 0}</p>
                                </div>
                            </div>

                            {/* Unreconciled / No COD blocks */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-amber-500 mb-1">⚠ Chưa đối soát</p>
                                    <p className="text-3xl font-black text-amber-700">{s.unreconciled_cod ?? 0}</p>
                                </div>
                                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-slate-400 mb-1">Không có COD</p>
                                    <p className="text-3xl font-black text-slate-600">{s.no_cod ?? 0}</p>
                                </div>
                            </div>

                            {/* Not found */}
                            <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4 flex items-center justify-between">
                                <p className="text-[10px] uppercase tracking-widest font-black text-rose-500">✗ Không thấy trong hệ thống</p>
                                <p className="text-2xl font-black text-rose-700">{s.not_found}</p>
                            </div>

                            {/* Return block — DH + 1P1 with cost */}
                            {((s.return_exchange ?? 0) + (s.return_partial ?? 0)) > 0 && (
                                <div className="rounded-2xl border border-purple-100 bg-purple-50 p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-purple-500 mb-3">↩ Đơn đổi / Hoàn 1 phần</p>
                                    <div className="space-y-2">
                                        {(s.return_exchange ?? 0) > 0 && (
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="font-semibold text-purple-700">
                                                    Đổi hàng (DH) — {s.return_exchange} đơn
                                                </span>
                                                <span className="font-black text-rose-600">-{fmt(s.return_exchange_cost)}đ</span>
                                            </div>
                                        )}
                                        {(s.return_partial ?? 0) > 0 && (
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="font-semibold text-purple-700">
                                                    Giao 1 phần (1P1) — {s.return_partial} đơn
                                                </span>
                                                <span className="font-black text-rose-600">-{fmt(s.return_partial_cost)}đ</span>
                                            </div>
                                        )}
                                        <div className="pt-2 border-t border-purple-100 flex items-center justify-between text-sm">
                                            <span className="text-slate-500 text-xs">Tổng chi phí hoàn</span>
                                            <span className="font-black text-rose-600 text-base">
                                                -{fmt((s.return_exchange_cost ?? 0) + (s.return_partial_cost ?? 0))}đ
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Errors */}
                            {s.errors?.length > 0 && (
                                <div className="max-h-40 overflow-y-auto rounded-xl bg-orange-50 border border-orange-100 p-4 custom-scrollbar">
                                    <p className="text-xs font-bold text-orange-700 mb-2 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[16px]">warning</span>
                                        Các lỗi phát sinh:
                                    </p>
                                    <ul className="space-y-1">
                                        {s.errors.map((err, i) => (
                                            <li key={i} className="text-[12px] text-orange-600 font-medium whitespace-pre-wrap leading-relaxed">• {err}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <button
                                onClick={resetModal}
                                className="h-14 w-full rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-900 transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-2"
                            >
                                <span className="material-symbols-outlined">restart_alt</span>
                                Đối soát file mới
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ViettelPostReconcileModal;
