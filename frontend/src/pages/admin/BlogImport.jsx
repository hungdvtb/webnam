import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blogApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const TEMPLATE_RULES = [
    'Moi bai bat dau bang ===POST=== va ket thuc bang ===END_POST===.',
    'Bat buoc co TITLE va phan CONTENT_HTML.',
    'Co the bo trong SLUG de he thong tu sinh.',
    'SEO_KEYWORD la tu khoa SEO chinh cho bai viet.',
    'STARRED nhan yes/no, PUBLISHED nhan yes/no (mac dinh yes).',
    'EXCERPT va CONTENT_HTML la phan nhieu dong, ket thuc bang marker ket thuc tuong ung.',
];

const SAMPLE_BLOCK = `===POST===
TITLE: Cach chon gom Bat Trang cho phong khach
SLUG: cach-chon-gom-bat-trang-cho-phong-khach
SEO_KEYWORD: gom bat trang phong khach
FEATURED_IMAGE: https://example.com/anh-1.jpg
STARRED: yes
PUBLISHED: yes
EXCERPT:
Goi y cach chon gom dep, hop menh va de bai tri.
===EXCERPT_END===
CONTENT_HTML:
<h2>Vi sao nen chon gom Bat Trang?</h2>
<p>Doan van mo dau...</p>
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
            showModal({ title: 'Loi', content: 'Khong the tai file mau Word.', type: 'error' });
        } finally {
            setDownloadingTemplate(false);
        }
    };

    const handleImport = async (event) => {
        event.preventDefault();

        if (!file) {
            showModal({ title: 'Luu y', content: 'Vui long chon file Word (.docx) truoc khi import.', type: 'warning' });
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            setImporting(true);
            const response = await blogApi.importWord(formData);
            setResult(response.data);
            showModal({ title: 'Thanh cong', content: `Import xong. Da tao ${response.data.created} bai viet.`, type: 'success' });
        } catch (error) {
            const message = error?.response?.data?.error || 'Import that bai. Vui long kiem tra dung file mau.';
            const errors = error?.response?.data?.errors;
            if (errors && Array.isArray(errors) && errors.length > 0) {
                setResult({
                    total_blocks: 0,
                    created: 0,
                    skipped: errors.length,
                    errors,
                });
            }
            showModal({ title: 'Loi import', content: message, type: 'error' });
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-[#fcfcfa] p-6 overflow-auto">
            <div className="max-w-5xl mx-auto space-y-6 pb-16">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">Import bai viet tu Word</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.18em] mt-1">
                            Ho tro tach nhieu bai viet trong 1 file docx duy nhat
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link
                            to="/admin/blog"
                            className="h-9 px-4 bg-white border border-gold/20 text-stone/70 hover:text-primary hover:border-primary/25 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center"
                        >
                            Quay lai danh sach
                        </Link>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/blog/new')}
                            className="h-9 px-4 bg-primary text-white hover:bg-umber rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center"
                        >
                            Tao bai thu cong
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <div className="lg:col-span-3 bg-white border border-gold/15 rounded-sm shadow-sm p-5 space-y-4">
                        <h2 className="font-ui text-[11px] uppercase tracking-widest font-black text-primary">Tai file mau va import</h2>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleTemplateDownload}
                                disabled={downloadingTemplate}
                                className="h-10 px-4 bg-white border border-primary/25 text-primary hover:bg-primary/5 rounded-sm text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-60"
                            >
                                <span className="material-symbols-outlined text-[16px]">download</span>
                                {downloadingTemplate ? 'Dang tai mau...' : 'Tai file mau Word'}
                            </button>
                        </div>

                        <form onSubmit={handleImport} className="space-y-4">
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-stone/55 mb-2">Chon file .docx</span>
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
                                {importing ? 'Dang import...' : 'Import bai viet'}
                            </button>
                        </form>

                        {result && (
                            <div className="border border-gold/15 bg-gold/5 rounded-sm p-4 space-y-2">
                                <h3 className="font-ui text-[10px] uppercase tracking-widest font-black text-primary">Ket qua import</h3>
                                <p className="text-sm text-stone/80">Tong block: <strong>{result.total_blocks ?? 0}</strong></p>
                                <p className="text-sm text-stone/80">Da tao: <strong>{result.created ?? 0}</strong></p>
                                <p className="text-sm text-stone/80">Bo qua: <strong>{result.skipped ?? 0}</strong></p>

                                {Array.isArray(result.errors) && result.errors.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-bold text-brick uppercase tracking-widest mt-2">Danh sach loi:</p>
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
                        <h2 className="font-ui text-[11px] uppercase tracking-widest font-black text-primary">Quy tac tach bai</h2>
                        <ul className="space-y-2 text-[12px] text-stone/80">
                            {TEMPLATE_RULES.map((item) => (
                                <li key={item} className="leading-relaxed">- {item}</li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="bg-white border border-gold/15 rounded-sm shadow-sm p-5 space-y-3">
                    <h2 className="font-ui text-[11px] uppercase tracking-widest font-black text-primary">Mau block bai viet</h2>
                    <pre className="whitespace-pre-wrap break-words bg-stone/5 border border-gold/10 p-4 text-[11px] text-stone/80 leading-relaxed">
                        {SAMPLE_BLOCK}
                    </pre>
                </div>
            </div>
        </div>
    );
};

export default BlogImport;
