import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blogApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const TEMPLATE_RULES = [
    'Mỗi bài bắt đầu bằng ===POST=== và kết thúc bằng ===END_POST===.',
    'Bắt buộc có TITLE và phần CONTENT_HTML.',
    'Có thể bỏ trống SLUG để hệ thống tự sinh.',
    'SEO_KEYWORD là từ khóa SEO chính cho bài viết.',
    'STARRED nhận yes/no, PUBLISHED nhận yes/no (mặc định yes).',
    'EXCERPT và CONTENT_HTML là phần nhiều dòng, kết thúc bằng marker kết thúc tương ứng.',
];

const SAMPLE_BLOCK = `===POST===
TITLE: Cách chọn gốm Bát Tràng cho phòng khách
SLUG: cach-chon-gom-bat-trang-cho-phong-khach
SEO_KEYWORD: gốm bát tràng phòng khách
FEATURED_IMAGE: https://example.com/anh-1.jpg
STARRED: yes
PUBLISHED: yes
EXCERPT:
Gợi ý cách chọn gốm đẹp, hợp mệnh và dễ bài trí.
===EXCERPT_END===
CONTENT_HTML:
<h2>Vì sao nên chọn gốm Bát Tràng?</h2>
<p>Đoạn văn mở đầu...</p>
===CONTENT_END===
===END_POST===`;

const BlogImport = () => {
    const [file, setFile] = useState(null);
    const [importing, setImporting] = useState(false);
    const [downloadingTemplate, setDownloadingTemplate] = useState(false);
    const [result, setResult] = useState(null);

    const navigate = useNavigate();
    const { showModal } = useUI();

    const handleTemplateDownload = async () => {
        try {
            setDownloadingTemplate(true);
            const response = await blogApi.downloadImportTemplate();
            const blob = new Blob([response.data], {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });

            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'mau-import-bai-viet-seo.docx';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể tải file mẫu Word.', type: 'error' });
        } finally {
            setDownloadingTemplate(false);
        }
    };

    const handleImport = async (event) => {
        event.preventDefault();

        if (!file) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn file Word (.docx) trước khi import.', type: 'warning' });
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            setImporting(true);
            const response = await blogApi.importWord(formData);
            setResult(response.data);
            showModal({ title: 'Thành công', content: `Import xong. Đã tạo ${response.data.created} bài viết.`, type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Import thất bại. Vui lòng kiểm tra đúng file mẫu.';
            const errors = error?.response?.data?.errors;
            if (errors && Array.isArray(errors) && errors.length > 0) {
                setResult({
                    total_blocks: 0,
                    created: 0,
                    skipped: errors.length,
                    errors,
                });
            }
            showModal({ title: 'Lỗi import', content: message, type: 'error' });
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-[#fcfcfa] p-6 overflow-auto">
            <div className="max-w-5xl mx-auto space-y-6 pb-16">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">Import bài viết từ Word</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.18em] mt-1">
                            Hỗ trợ tách nhiều bài viết trong 1 file docx duy nhất
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link
                            to="/admin/blog"
                            className="h-9 px-4 bg-white border border-gold/20 text-stone/70 hover:text-primary hover:border-primary/25 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center"
                        >
                            Quay lại danh sách
                        </Link>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/blog/new')}
                            className="h-9 px-4 bg-primary text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center"
                        >
                            Tạo bài thủ công
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <div className="lg:col-span-3 bg-white border border-gold/15 rounded-sm shadow-sm p-5 space-y-4">
                        <h2 className="font-ui text-[11px] uppercase tracking-widest font-black text-primary">Tải file mẫu và import</h2>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleTemplateDownload}
                                disabled={downloadingTemplate}
                                className="h-10 px-4 bg-white border border-primary/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-60"
                            >
                                <span className="material-symbols-outlined text-[16px]">download</span>
                                {downloadingTemplate ? 'Đang tải mẫu...' : 'Tải file mẫu Word'}
                            </button>
                        </div>

                        <form onSubmit={handleImport} className="space-y-4">
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-stone/55 mb-2">Chọn file .docx</span>
                                <input
                                    type="file"
                                    accept=".docx"
                                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                                    className="block w-full border border-gold/20 bg-stone/5 p-3 text-sm text-primary"
                                />
                            </label>

                            <button
                                type="submit"
                                disabled={importing}
                                className="h-10 px-5 bg-brick text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-60"
                            >
                                <span className={`material-symbols-outlined text-[16px] ${importing ? 'animate-spin' : ''}`}>
                                    {importing ? 'progress_activity' : 'upload'}
                                </span>
                                {importing ? 'Đang import...' : 'Import bài viết'}
                            </button>
                        </form>

                        {result && (
                            <div className="border border-gold/15 bg-gold/5 rounded-sm p-4 space-y-2">
                                <h3 className="font-ui text-[10px] uppercase tracking-widest font-black text-primary">Kết quả import</h3>
                                <p className="text-sm text-stone/80">Tổng block: <strong>{result.total_blocks ?? 0}</strong></p>
                                <p className="text-sm text-stone/80">Đã tạo: <strong>{result.created ?? 0}</strong></p>
                                <p className="text-sm text-stone/80">Bỏ qua: <strong>{result.skipped ?? 0}</strong></p>

                                {Array.isArray(result.errors) && result.errors.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-bold text-brick uppercase tracking-widest mt-2">Danh sách lỗi:</p>
                                        <ul className="mt-1 space-y-1 text-xs text-stone/80">
                                            {result.errors.map((item, idx) => (
                                                <li key={`${item}-${idx}`}>- {item}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-2 bg-white border border-gold/15 rounded-sm shadow-sm p-5 space-y-4">
                        <h2 className="font-ui text-[11px] uppercase tracking-widest font-black text-primary">Quy tắc tách bài</h2>
                        <ul className="space-y-2 text-[12px] text-stone/80">
                            {TEMPLATE_RULES.map((item) => (
                                <li key={item} className="leading-relaxed">- {item}</li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="bg-white border border-gold/15 rounded-sm shadow-sm p-5 space-y-3">
                    <h2 className="font-ui text-[11px] uppercase tracking-widest font-black text-primary">Mẫu block bài viết</h2>
                    <pre className="whitespace-pre-wrap break-words bg-stone/5 border border-gold/10 p-4 text-[11px] text-stone/80 leading-relaxed">
                        {SAMPLE_BLOCK}
                    </pre>
                </div>
            </div>
        </div>
    );
};

export default BlogImport;

