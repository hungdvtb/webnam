import React, { useState, useEffect } from 'react';
import { attributeApi, aiApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const AttributeList = () => {
    const [attributes, setAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const { showModal } = useUI();
    const [formData, setFormData] = useState({
        id: null,
        name: '',
        code: '',
        frontend_type: 'select',
        swatch_type: 'none',
        is_filterable: false,
        is_required: false,
        is_variant: true,
        options: [] // Each option: { value: '', swatch_value: '' }
    });

    const [optionInput, setOptionInput] = useState({ value: '', swatch_value: '' });

    const fetchAttributes = async () => {
        setLoading(true);
        try {
            const res = await attributeApi.getAll();
            setAttributes(res.data);
        } catch (error) {
            console.error('Lỗi khi tải thuộc tính:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAttributes();
    }, []);

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        try {
            if (formData.id) {
                await attributeApi.update(formData.id, formData);
                showModal({ title: 'Thành công', content: 'Đã cập nhật thuộc tính.', type: 'success' });
            } else {
                await attributeApi.store(formData);
                showModal({ title: 'Thành công', content: 'Đã tạo thuộc tính mới.', type: 'success' });
            }
            setIsFormOpen(false);
            fetchAttributes();
        } catch (error) {
            console.error('Lỗi khi lưu:', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu dữ liệu.', type: 'error' });
        }
    };

    const handleEdit = (attr) => {
        setFormData({
            id: attr.id,
            name: attr.name,
            code: attr.code,
            frontend_type: attr.frontend_type,
            swatch_type: attr.swatch_type || 'none',
            is_filterable: attr.is_filterable,
            is_required: attr.is_required,
            is_variant: attr.is_variant,
            options: attr.options ? attr.options.map(o => ({ value: o.value, swatch_value: o.swatch_value || '' })) : []
        });
        setIsFormOpen(true);
    };

    const handleDelete = async (id) => {
        showModal({
            title: 'Xác nhận xóa',
            content: 'Xác nhận xóa thuộc tính này?',
            type: 'warning',
            actionText: 'Xóa',
            onAction: async () => {
                try {
                    await attributeApi.destroy(id);
                    setAttributes(attributes.filter(a => a.id !== id));
                    showModal({ title: 'Thành công', content: 'Đã xóa thuộc tính.', type: 'success' });
                } catch (error) {
                    showModal({ title: 'Lỗi', content: 'Không thể xóa.', type: 'error' });
                }
            }
        });
    };

    const addOption = () => {
        if (optionInput.value.trim()) {
            setFormData({ ...formData, options: [...formData.options, { ...optionInput }] });
            setOptionInput({ value: '', swatch_value: '' });
        }
    };

    const removeOption = (index) => {
        setFormData({ ...formData, options: formData.options.filter((_, i) => i !== index) });
    };

    const handleAIGenerate = async () => {
        if (!formData.name) return alert('Vui lòng nhập tên thuộc tính trước.');
        setAiGenerating(true);
        try {
            const prompt = `Gợi ý 5-8 giá trị phổ biến cho thuộc tính gốm sứ có tên là "${formData.name}". 
            Trả về dạng JSON array của string. 
            Ví dụ nếu là "Kích thước": ["Nhỏ (S)", "Vừa (M)", "Lớn (L)", "Đại (XL)"].
            Nếu là "Chất liệu men": ["Men rạn", "Men lam", "Men ngọc", "Men hỏa biến"].`;

            const response = await aiApi.chat({ message: prompt });
            let values;
            try {
                const jsonMatch = response.data.response.match(/\[[\s\S]*\]/);
                values = JSON.parse(jsonMatch ? jsonMatch[0] : response.data.response);
            } catch (e) { values = []; }

            if (values.length > 0) {
                setFormData(prev => ({
                    ...prev,
                    options: [...prev.options, ...values.map(v => ({ value: v, swatch_value: '' }))]
                }));
                showModal({ title: 'AI Assistant', content: `Đã gợi ý ${values.length} giá trị.`, type: 'success' });
            }
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'AI không khả dụng.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    return (
        <div className="space-y-10 pb-20 animate-fade-in">
            <div className="flex justify-between items-end border-b border-gold/10 pb-8">
                <div className="space-y-2">
                    <h1 className="font-display text-4xl font-bold text-primary italic uppercase tracking-wider">Cấu Hình Thuộc Tính</h1>
                    <p className="font-ui text-xs font-bold uppercase tracking-widest text-gold opacity-60">Định nghĩa đặc tính cho các tuyệt tác gốm sứ</p>
                </div>
                <button
                    onClick={() => {
                        setFormData({ id: null, name: '', code: '', frontend_type: 'select', swatch_type: 'none', is_filterable: true, is_required: false, is_variant: true, options: [] });
                        setIsFormOpen(true);
                    }}
                    className="bg-primary text-white font-ui font-bold uppercase tracking-widest px-8 py-3 hover:bg-umber transition-all shadow-premium flex items-center gap-3"
                >
                    <span className="material-symbols-outlined text-sm">add_circle</span>
                    Thuộc Tính Mới
                </button>
            </div>

            {isFormOpen && (
                <div className="bg-white border border-gold/20 shadow-premium p-10 space-y-8 animate-slide-up">
                    <div className="flex justify-between items-center border-b border-gold/10 pb-6">
                        <h2 className="font-display text-2xl font-bold text-primary uppercase italic">{formData.id ? 'Biên Tập' : 'Khởi Tạo'} Thuộc Tính</h2>
                        <button onClick={() => setIsFormOpen(false)} className="text-stone hover:text-brick transition-colors">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <form onSubmit={handleFormSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                        <div className="lg:col-span-7 space-y-8">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tên Gọi (VD: Màu sắc)</label>
                                    <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm" />
                                </div>
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Mã Code (Dùng cho API)</label>
                                    <input type="text" value={formData.code} disabled={!!formData.id} onChange={e => setFormData({ ...formData, code: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm disabled:opacity-40" placeholder="VD: color" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Kiểu Hiển Thị</label>
                                    <select value={formData.frontend_type} onChange={e => setFormData({ ...formData, frontend_type: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm appearance-none">
                                        <option value="text">Văn bản ngắn (Text)</option>
                                        <option value="select">Danh mục chọn (Select)</option>
                                        <option value="multiselect">Chọn nhiều (Multiselect)</option>
                                        <option value="boolean">Đúng / Sai (Boolean)</option>
                                        <option value="price">Giá tiền (Price)</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Kiểu Swatch (Trực quan)</label>
                                    <select value={formData.swatch_type} onChange={e => setFormData({ ...formData, swatch_type: e.target.value })} className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-sm appearance-none">
                                        <option value="none">Không dùng Swatch</option>
                                        <option value="color">Màu sắc (Color Hex)</option>
                                        <option value="image">Hình ảnh (Thumbnail)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex gap-8 items-center bg-gold/5 p-6 border border-gold/10">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <input type="checkbox" checked={formData.is_variant} onChange={e => setFormData({ ...formData, is_variant: e.target.checked })} className="size-5 accent-primary" />
                                    <span className="font-ui text-xs font-bold uppercase text-primary tracking-widest">Dùng làm biến thể sản phẩm</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <input type="checkbox" checked={formData.is_filterable} onChange={e => setFormData({ ...formData, is_filterable: e.target.checked })} className="size-5 accent-primary" />
                                    <span className="font-ui text-xs font-bold uppercase text-stone tracking-widest">Hiển thị trong bộ lọc</span>
                                </label>
                            </div>
                        </div>

                        <div className="lg:col-span-5 bg-background-light/50 border border-gold/10 p-8 space-y-6">
                            <div className="flex justify-between items-center border-b border-gold/20 pb-4">
                                <h4 className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-primary">Giá Trị Tùy Chọn</h4>
                                <button type="button" onClick={handleAIGenerate} disabled={aiGenerating} className="flex items-center gap-2 text-gold hover:text-primary transition-colors text-[10px] font-bold uppercase">
                                    <span className={`material-symbols-outlined text-sm ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                    AI Suggest
                                </button>
                            </div>

                            <div className="max-h-[300px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                                {formData.options.map((opt, idx) => (
                                    <div key={idx} className="flex items-center gap-3 bg-white border border-gold/20 p-3 shadow-sm group">
                                        {formData.swatch_type === 'color' && (
                                            <div className="size-8 rounded-full border border-gold/30 shadow-inner" style={{ backgroundColor: opt.swatch_value || '#ccc' }}></div>
                                        )}
                                        <div className="flex-1 space-y-1">
                                            <div className="font-body text-sm font-bold text-primary uppercase tracking-wider">{opt.value}</div>
                                            {opt.swatch_value && <div className="text-[9px] text-stone font-ui uppercase">{opt.swatch_value}</div>}
                                        </div>
                                        <button type="button" onClick={() => removeOption(idx)} className="opacity-0 group-hover:opacity-100 p-2 text-stone hover:text-brick transition-all">
                                            <span className="material-symbols-outlined text-sm">delete</span>
                                        </button>
                                    </div>
                                ))}
                                {formData.options.length === 0 && <div className="text-center py-10 text-stone font-body italic text-sm">Chưa có giá trị nào.</div>}
                            </div>

                            <div className="pt-6 border-t border-gold/20 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <input value={optionInput.value} onChange={e => setOptionInput({ ...optionInput, value: e.target.value })} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addOption())} type="text" placeholder="Tên giá trị..." className="bg-white border border-gold/20 p-3 text-xs font-body focus:outline-none focus:border-primary" />
                                    {formData.swatch_type === 'color' ? (
                                        <div className="flex gap-2">
                                            <input type="color" value={optionInput.swatch_value || '#000000'} onChange={e => setOptionInput({ ...optionInput, swatch_value: e.target.value })} className="size-10 bg-transparent cursor-pointer" />
                                            <input type="text" value={optionInput.swatch_value} onChange={e => setOptionInput({ ...optionInput, swatch_value: e.target.value })} placeholder="#Hex..." className="flex-1 bg-white border border-gold/20 px-2 text-[10px] font-ui uppercase" />
                                        </div>
                                    ) : (
                                        <input value={optionInput.swatch_value} onChange={e => setOptionInput({ ...optionInput, swatch_value: e.target.value })} type="text" placeholder="Extra value/URL..." className="bg-white border border-gold/20 p-3 text-xs font-body focus:outline-none focus:border-primary" />
                                    )}
                                </div>
                                <button type="button" onClick={addOption} className="w-full bg-gold/10 text-gold border border-gold/30 py-3 font-ui text-[10px] font-bold uppercase tracking-widest hover:bg-primary hover:text-white transition-all">
                                    Thêm Giá Trị
                                </button>
                            </div>
                        </div>

                        <div className="lg:col-span-12 flex justify-end gap-6 pt-10 border-t border-gold/10 mt-6 font-ui">
                            <button type="button" onClick={() => setIsFormOpen(false)} className="px-10 py-3 text-[10px] font-bold uppercase tracking-widest text-stone hover:text-primary transition-colors border border-stone/20">Hủy</button>
                            <button type="submit" className="px-12 py-3 bg-primary text-white text-[10px] font-bold uppercase tracking-widest hover:bg-umber transition-all shadow-premium">
                                {formData.id ? 'Cập Nhật Thuộc Tính' : 'Lưu Hệ Thống'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Attributes Table */}
            <div className="bg-white border border-gold/10 shadow-premium overflow-hidden animate-slide-up">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gold/5 border-b border-gold/10">
                            <th className="p-6 font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Tên & Mã</th>
                            <th className="p-6 font-ui text-[10px] font-bold uppercase tracking-widest text-primary text-center">Kiểu Nhập</th>
                            <th className="p-6 font-ui text-[10px] font-bold uppercase tracking-widest text-primary text-center">Biến Thể</th>
                            <th className="p-6 font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Giá Trị Mẫu</th>
                            <th className="p-6 font-ui text-[10px] font-bold uppercase tracking-widest text-primary text-right">Thao Tác</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/10">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="p-20 text-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold mx-auto"></div>
                                </td>
                            </tr>
                        ) : attributes.map((attr) => (
                            <tr key={attr.id} className="hover:bg-gold/5 transition-colors group">
                                <td className="p-6">
                                    <div className="flex flex-col">
                                        <span className="font-display text-lg font-bold text-primary">{attr.name}</span>
                                        <span className="text-[10px] text-stone font-ui uppercase tracking-tighter opacity-70">Code: {attr.code}</span>
                                    </div>
                                </td>
                                <td className="p-6 text-center">
                                    <span className="px-3 py-1 bg-gold/5 border border-gold/20 text-[10px] font-bold uppercase tracking-widest text-gold">
                                        {attr.frontend_type}
                                    </span>
                                </td>
                                <td className="p-6 text-center">
                                    {attr.is_variant ? (
                                        <span className="material-symbols-outlined text-green-600">check_circle</span>
                                    ) : (
                                        <span className="material-symbols-outlined text-stone/30">cancel</span>
                                    )}
                                </td>
                                <td className="p-6">
                                    <div className="flex flex-wrap gap-2 max-w-sm">
                                        {attr.options?.slice(0, 4).map((o, i) => (
                                            <span key={i} className="px-2 py-1 bg-white border border-gold/10 text-[9px] font-ui uppercase text-stone leading-none">
                                                {o.value}
                                            </span>
                                        ))}
                                        {attr.options?.length > 4 && <span className="text-[9px] text-gold font-bold italic">+{attr.options.length - 4} khác</span>}
                                        {attr.options?.length === 0 && <span className="text-[10px] text-stone italic opacity-50">N/A</span>}
                                    </div>
                                </td>
                                <td className="p-6 text-right space-x-3">
                                    <button onClick={() => handleEdit(attr)} className="size-9 border border-gold/30 text-gold hover:bg-gold hover:text-white transition-all inline-flex items-center justify-center rounded-sm">
                                        <span className="material-symbols-outlined text-sm">edit</span>
                                    </button>
                                    <button onClick={() => handleDelete(attr.id)} className="size-9 border border-brick/30 text-brick hover:bg-brick hover:text-white transition-all inline-flex items-center justify-center rounded-sm">
                                        <span className="material-symbols-outlined text-sm">delete</span>
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AttributeList;
