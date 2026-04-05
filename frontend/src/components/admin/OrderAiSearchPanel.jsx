import React from 'react';
import SearchableSelect from '../SearchableSelect';

const OrderAiSearchPanel = ({
    show,
    fileInputRef,
    inputValue,
    onInputChange,
    onPaste,
    onOpenRules,
    onReset,
    onFileChange,
    file,
    onClearFile,
    onRun,
    loading,
    lastRun,
    trainingRuleOptions = [],
    selectedTrainingRuleValue = '',
    selectedTrainingRule = null,
    onTrainingRuleChange,
    trainingRulesLoading = false,
}) => {
    if (!show) return null;

    return (
        <div className="mt-3 rounded-sm border border-primary/10 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 bg-primary/[0.02] px-3 py-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">
                        Tìm nhanh bằng AI
                    </div>
                    <div className="mt-1 text-[12px] font-semibold text-primary/70">
                        AI sẽ đọc nội dung, tự ghép sản phẩm và đổ thẳng vào bảng hàng.
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onOpenRules}
                        className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/15 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-primary/65 transition-all hover:border-primary/30 hover:text-primary"
                    >
                        <span className="material-symbols-outlined text-[14px]">school</span>
                        Dữ liệu train AI
                    </button>
                    <button
                        type="button"
                        onClick={onReset}
                        className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-primary/45 transition-all hover:text-brick"
                    >
                        <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                        Làm mới
                    </button>
                </div>
            </div>

            <div className="space-y-3 p-3">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <SearchableSelect
                        variant="admin"
                        options={trainingRuleOptions}
                        value={selectedTrainingRuleValue}
                        name="order_ai_training_rule"
                        placeholder={trainingRulesLoading ? 'Đang tải mẫu train AI...' : 'Chọn nhanh mẫu train AI đã lưu...'}
                        disabled={trainingRulesLoading || trainingRuleOptions.length === 0}
                        getOptionValue={(option) => option?.value || ''}
                        getOptionSearchText={(option) => option?.search_text || option?.name || ''}
                        onChange={(event) => onTrainingRuleChange?.(event.target.value)}
                    />
                    {selectedTrainingRuleValue ? (
                        <button
                            type="button"
                            onClick={() => onTrainingRuleChange?.('')}
                            className="inline-flex h-10 items-center justify-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-primary/45 transition-all hover:border-primary/25 hover:text-brick"
                        >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                            Bỏ mẫu
                        </button>
                    ) : (
                        <div className="hidden md:block" />
                    )}
                </div>

                <div className="rounded-sm border border-primary/10 bg-primary/[0.02] px-3 py-2 text-[11px] font-semibold text-primary/55">
                    {selectedTrainingRule
                        ? `Đang ưu tiên map theo mẫu "${selectedTrainingRule.name}"${selectedTrainingRule.subtitle ? ` • ${selectedTrainingRule.subtitle}` : ''}. Bạn có thể nhập thêm như "lọ hoa, mâm bồng" để AI ghép đúng theo bộ này.`
                        : 'Để trống nếu muốn AI tự suy đoán như hiện tại. Chọn mẫu trước nếu cần ép AI map theo đúng bộ đã train.'}
                </div>

                <textarea
                    value={inputValue}
                    onChange={(event) => onInputChange(event.target.value)}
                    onPaste={onPaste}
                    placeholder="Ví dụ: men lam, 2 bát 18 cả đế, 1 đèn, 1 ống..."
                    className="min-h-[84px] w-full rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2 text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/25 focus:border-primary/35 focus:outline-none"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,.pdf"
                            onChange={onFileChange}
                            className="hidden"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex h-9 items-center gap-2 rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/65 transition-all hover:border-primary/30 hover:text-primary"
                        >
                            <span className="material-symbols-outlined text-[15px]">upload_file</span>
                            Tải ảnh / PDF
                        </button>
                        {file && (
                            <div className="inline-flex items-center gap-2 rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2 text-[11px] font-semibold text-primary/65">
                                <span className="material-symbols-outlined text-[14px]">attach_file</span>
                                <span className="max-w-[220px] truncate">{file.name}</span>
                                <button
                                    type="button"
                                    onClick={onClearFile}
                                    className="inline-flex items-center text-primary/35 transition-all hover:text-brick"
                                >
                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onRun}
                        disabled={loading}
                        className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-brick disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className={`material-symbols-outlined text-[15px] ${loading ? 'animate-spin' : ''}`}>
                            {loading ? 'progress_activity' : 'auto_awesome'}
                        </span>
                        {loading ? 'Đang xử lý' : 'AI thêm ngay vào đơn'}
                    </button>
                </div>

                <div className="rounded-sm border border-primary/10 bg-primary/[0.02] px-3 py-2 text-[11px] font-semibold text-primary/55">
                    Các dòng AI thêm vào bảng sẽ được đánh dấu để bạn kiểm tra nhanh và xác nhận một chạm.
                </div>

                {lastRun && (
                    <div className="rounded-sm border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                        {`Lần gần nhất: thêm/cập nhật ${lastRun.touchedCount || 0} dòng${lastRun.reviewCount ? `, ${lastRun.reviewCount} dòng cần rà` : ''}${lastRun.unresolvedCount ? `, ${lastRun.unresolvedCount} dòng chưa ghép` : ''}.`}
                    </div>
                )}
            </div>
        </div>
    );
};

export default OrderAiSearchPanel;
