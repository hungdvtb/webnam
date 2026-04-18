import React, { useState, useRef } from 'react';
import axios from 'axios';

const ViettelPostTrackingImportModal = ({ isOpen, onClose, onRefresh }) => {
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
            const token = localStorage.getItem('token');
            const response = await axios.post('/api/shipments/import-tracking/viettel-post', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'Authorization': `Bearer ${token}`
                }
            });

            setResult(response.data);
            if (onRefresh) onRefresh();
        } catch (err) {
            setError(err.response?.data?.message || 'Có lỗi xảy ra khi xử lý file.');
        } finally {
            setUploading(false);
        }
    };

    const resetModal = () => {
        setFile(null);
        setResult(null);
        setError(null);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div 
                className="absolute inset-0 bg-primary/40 backdrop-blur-md animate-in fade-in duration-300"
                onClick={() => !uploading && onClose()}
            />
            
            <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                                <span className="material-symbols-outlined text-[28px]">sync_alt</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">Đồng bộ mã vận đơn VTP</h3>
                                <p className="text-sm text-emerald-100 opacity-80 uppercase tracking-widest font-black text-[10px] mt-0.5">Cập nhật mã VĐ & Tiền ship</p>
                            </div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>

                <div className="p-8">
                    {!result ? (
                        <div className="space-y-6">
                            <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-100 italic">
                                <p className="text-[13px] text-emerald-800 leading-relaxed">
                                    Dùng file kết quả tải về từ Web Viettel Post. Hệ thống sẽ tự khớp mã đơn và **tạo vận đơn** để đơn hàng nhảy sang trang Quản lý vận đơn.
                                </p>
                            </div>
                            {/* Upload Area */}
                            <div 
                                onClick={() => !uploading && fileInputRef.current?.click()}
                                className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all cursor-pointer ${
                                    file 
                                    ? 'border-emerald-400 bg-emerald-50/50' 
                                    : 'border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/30'
                                }`}
                            >
                                <input 
                                    type="file" 
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden" 
                                    accept=".xlsx,.xls"
                                />
                                
                                <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-all duration-500 ${
                                    file ? 'bg-emerald-500 text-white scale-110 shadow-lg' : 'bg-white text-slate-400 group-hover:text-emerald-500 group-hover:scale-105 shadow-sm'
                                }`}>
                                    <span className="material-symbols-outlined text-[32px]">
                                        {file ? 'description' : 'upload_file'}
                                    </span>
                                </div>
                                
                                {file ? (
                                    <div className="text-center animate-in slide-in-from-bottom-2">
                                        <p className="font-bold text-slate-700 mb-1">{file.name}</p>
                                        <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); resetModal(); }}
                                            className="mt-4 text-xs font-bold text-rose-500 hover:underline"
                                        >Thay đổi file</button>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <p className="font-bold text-slate-700 mb-1">Kéo thả file kết quả VTP vào đây</p>
                                        <p className="text-xs text-slate-400 uppercase tracking-wider font-black">Hỗ trợ .xlsx, .xls</p>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-600 border border-rose-100 animate-in shake-2">
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
                                    : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xl shadow-emerald-200'
                                }`}
                            >
                                {uploading ? (
                                    <div className="flex items-center gap-3">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                        <span>Đang xử lý dữ liệu...</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span>Bắt đầu đồng bộ</span>
                                        <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">sync</span>
                                    </div>
                                )}
                            </button>
                        </div>
                    ) : (
                        /* Result Area */
                        <div className="space-y-6 animate-in fade-in duration-500">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-slate-400 mb-1">Tổng dòng</p>
                                    <p className="text-3xl font-black text-slate-800">{result.total_rows}</p>
                                </div>
                                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-emerald-500 mb-1">Thành công</p>
                                    <p className="text-3xl font-black text-emerald-700">{result.success}</p>
                                </div>
                                <div className="rounded-2xl bg-amber-50 border border-amber-100 p-5 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-amber-500 mb-1">Không thấy đơn</p>
                                    <p className="text-3xl font-black text-amber-700">{result.not_found}</p>
                                </div>
                                <div className="rounded-2xl bg-rose-50 border border-rose-100 p-5 text-center">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-rose-500 mb-1">Lỗi</p>
                                    <p className="text-3xl font-black text-rose-700">{result.failed}</p>
                                </div>
                            </div>

                            {result.errors?.length > 0 && (
                                <div className="max-h-40 overflow-y-auto rounded-xl bg-orange-50 border border-orange-100 p-4 custom-scrollbar">
                                    <p className="text-xs font-bold text-orange-700 mb-2 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[16px]">warning</span>
                                        Chi tiết:
                                    </p>
                                    <ul className="space-y-1">
                                        {result.errors.map((err, i) => (
                                            <li key={i} className="text-[12px] text-orange-600 font-medium">• {err}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <button
                                onClick={resetModal}
                                className="h-14 w-full rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-900 transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-2"
                            >
                                <span className="material-symbols-outlined">restart_alt</span>
                                Đồng bộ file khác
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ViettelPostTrackingImportModal;
