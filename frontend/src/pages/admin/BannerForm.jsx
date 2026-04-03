import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { aiApi, cmsApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import { resolveEntityImageUrl, resolveMediaUrl } from '../../utils/mediaUrl';

const createInitialBannerState = () => ({
    account_id: localStorage.getItem('activeAccountId') || '',
    title: '',
    subtitle: '',
    image_url: '',
    image: null,
    link_url: '',
    button_text: '',
    sort_order: 0,
    is_active: true,
});

const BannerForm = () => {
    const { id } = useParams();
    const isEdit = Boolean(id);
    const navigate = useNavigate();
    const { showModal } = useUI();
    const { available: aiAvailable, disabledReason } = useAiAvailability();

    const [loading, setLoading] = useState(isEdit);
    const [saving, setSaving] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [previewUrl, setPreviewUrl] = useState('');
    const [banner, setBanner] = useState(createInitialBannerState);

    useEffect(() => {
        if (!isEdit) {
            return;
        }

        let cancelled = false;

        cmsApi.banners.getOne(id)
            .then((response) => {
                if (cancelled) {
                    return;
                }

                setBanner({
                    ...createInitialBannerState(),
                    ...response.data,
                    image: null,
                });
                setPreviewUrl(resolveEntityImageUrl(response.data, 'large'));
            })
            .catch(() => {
                showModal({
                    title: 'Lá»—i',
                    content: 'KhÃ´ng thá»ƒ táº£i thÃ´ng tin banner.',
                    type: 'error',
                });
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [id, isEdit, showModal]);

    useEffect(() => () => {
        if (previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
        }
    }, [previewUrl]);

    const handleAIGenerate = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chÆ°a sáºµn sÃ ng', content: disabledReason, type: 'warning' });
            return;
        }

        setAiGenerating(true);

        try {
            const prompt = 'Viết title, subtitle và button text cao cấp cho banner gốm sứ Bát Tràng. Trả về JSON với keys: title, subtitle, button.';
            const response = await aiApi.chat({ message: prompt });
            const jsonMatch = String(response?.data?.response || '').match(/\{[\s\S]*\}/);
            const aiData = JSON.parse(jsonMatch ? jsonMatch[0] : response.data.response);

            setBanner((prev) => ({
                ...prev,
                title: aiData.title || prev.title,
                subtitle: aiData.subtitle || prev.subtitle,
                button_text: aiData.button || prev.button_text,
            }));
        } catch {
            showModal({
                title: 'Lá»—i AI',
                content: 'KhÃ´ng thá»ƒ táº¡o ná»™i dung banner lÃºc nÃ y.',
                type: 'error',
            });
        } finally {
            setAiGenerating(false);
        }
    };

    const handleFieldChange = (event) => {
        const { name, value, type, checked } = event.target;

        setBanner((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));

        if (name === 'image_url' && !(banner.image instanceof File)) {
            setPreviewUrl(resolveMediaUrl(value));
        }
    };

    const handleImageUpload = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        if (previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
        }

        const nextPreviewUrl = URL.createObjectURL(file);

        setBanner((prev) => ({
            ...prev,
            image: file,
        }));
        setPreviewUrl(nextPreviewUrl);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSaving(true);

        try {
            const submitData = new FormData();
            submitData.append('account_id', String(banner.account_id || ''));
            submitData.append('title', banner.title || '');
            submitData.append('subtitle', banner.subtitle || '');
            submitData.append('image_url', banner.image instanceof File ? '' : (banner.image_url || ''));
            submitData.append('link_url', banner.link_url || '');
            submitData.append('button_text', banner.button_text || '');
            submitData.append('sort_order', String(banner.sort_order || 0));
            submitData.append('is_active', banner.is_active ? '1' : '0');

            if (banner.image instanceof File) {
                submitData.append('image', banner.image);
            }

            if (isEdit) {
                await cmsApi.banners.update(id, submitData);
            } else {
                await cmsApi.banners.store(submitData);
            }

            showModal({
                title: 'ThÃ nh cÃ´ng',
                content: isEdit ? 'ÄÃ£ cáº­p nháº­t banner.' : 'ÄÃ£ thÃªm banner má»›i.',
                type: 'success',
            });

            navigate('/admin/banners');
        } catch {
            showModal({
                title: 'Lá»—i',
                content: 'KhÃ´ng thá»ƒ lÆ°u banner.',
                type: 'error',
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gold" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-5xl p-6">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-display font-bold italic text-primary">
                        {isEdit ? 'BiÃªn Táº­p Banner' : 'Táº¡o Banner Má»›i'}
                    </h1>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-stone/45">
                        Upload trực tiếp lên R2 hoặc import từ URL
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/banners')}
                        className="border border-stone/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-stone transition hover:border-primary hover:text-primary"
                    >
                        Há»§y
                    </button>
                    <button
                        type="submit"
                        form="banner-form"
                        disabled={saving}
                        className="bg-primary px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-umber disabled:opacity-50"
                    >
                        {saving ? 'Äang lÆ°u...' : isEdit ? 'Cáº­p nháº­t' : 'Táº¡o banner'}
                    </button>
                </div>
            </div>

            <form id="banner-form" onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-6 rounded-sm border border-gold/10 bg-white p-6 shadow-premium">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/60">TiÃªu Ä‘á»</label>
                                <button
                                    type="button"
                                    onClick={handleAIGenerate}
                                    disabled={aiGenerating || !aiAvailable}
                                    title={!aiAvailable ? disabledReason : 'Tạo nội dung bằng AI'}
                                    className="text-[10px] font-black uppercase tracking-[0.16em] text-gold transition hover:text-primary disabled:opacity-50"
                                >
                                    {aiGenerating ? 'Äang táº¡o...' : 'AI Content'}
                                </button>
                            </div>
                            <input
                                type="text"
                                name="title"
                                value={banner.title}
                                onChange={handleFieldChange}
                                className="w-full border border-gold/10 bg-stone/5 p-4 text-sm text-primary outline-none transition focus:border-primary"
                                placeholder="Tiêu đề banner"
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/60">Subtitle</label>
                            <input
                                type="text"
                                name="subtitle"
                                value={banner.subtitle}
                                onChange={handleFieldChange}
                                className="w-full border border-gold/10 bg-stone/5 p-4 text-sm outline-none transition focus:border-primary"
                                placeholder="Thông điệp phụ"
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/60">Ảnh banner</label>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="inline-flex cursor-pointer items-center gap-2 border border-gold/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-primary transition hover:border-primary hover:bg-primary hover:text-white">
                                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                                Tải ảnh lên
                                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                            </label>
                            <span className="text-xs text-stone/55">Ảnh sẽ được resize `thumbnail`, `medium`, `large` và lưu trên Cloudflare R2.</span>
                        </div>
                        <input
                            type="text"
                            name="image_url"
                            value={banner.image_url}
                            onChange={handleFieldChange}
                            className="w-full border border-gold/10 bg-stone/5 p-4 text-sm outline-none transition focus:border-primary"
                            placeholder="Hoặc dán URL ảnh hiện có để import lên R2"
                        />
                    </div>

                    <div className="grid gap-6 md:grid-cols-3">
                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/60">Link URL</label>
                            <input
                                type="text"
                                name="link_url"
                                value={banner.link_url}
                                onChange={handleFieldChange}
                                className="w-full border border-gold/10 bg-stone/5 p-4 text-sm outline-none transition focus:border-primary"
                                placeholder="/san-pham-noi-bat"
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/60">Button text</label>
                            <input
                                type="text"
                                name="button_text"
                                value={banner.button_text}
                                onChange={handleFieldChange}
                                className="w-full border border-gold/10 bg-stone/5 p-4 text-sm outline-none transition focus:border-primary"
                                placeholder="KhÃ¡m phÃ¡"
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/60">Sort order</label>
                            <input
                                type="number"
                                name="sort_order"
                                value={banner.sort_order}
                                onChange={handleFieldChange}
                                className="w-full border border-gold/10 bg-stone/5 p-4 text-sm outline-none transition focus:border-primary"
                            />
                        </div>
                    </div>

                    <label className="inline-flex items-center gap-3 text-sm text-primary">
                        <input
                            type="checkbox"
                            name="is_active"
                            checked={banner.is_active}
                            onChange={handleFieldChange}
                            className="size-4 accent-primary"
                        />
                        Banner đang kích hoạt
                    </label>
                </div>

                <aside className="rounded-sm border border-gold/10 bg-white p-6 shadow-premium">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Preview</p>
                    <div className="mt-4 overflow-hidden rounded-sm border border-gold/15 bg-stone/5">
                        <div className="aspect-[16/9]">
                            {previewUrl ? (
                                <img src={previewUrl} alt={banner.title || 'Banner preview'} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-stone/35">
                                    <span className="material-symbols-outlined text-[42px]">image</span>
                                </div>
                            )}
                        </div>
                        <div className="space-y-2 border-t border-gold/10 p-4">
                            <p className="font-display text-lg font-bold text-primary">{banner.title || 'ChÆ°a cÃ³ tiÃªu Ä‘á»'}</p>
                            <p className="text-sm text-stone/70">{banner.subtitle || 'ChÆ°a cÃ³ subtitle'}</p>
                        </div>
                    </div>
                </aside>
            </form>
        </div>
    );
};

export default BannerForm;
