import React, { useState, useEffect } from 'react';
import { attributeApi, aiApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import { motion, Reorder, AnimatePresence } from 'framer-motion';

const AttributeList = () => {
    const [activeTab, setActiveTab] = useState('product'); // 'product' or 'order'
    const [attributes, setAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const { showModal } = useUI();
    const { available: aiAvailable, disabledReason } = useAiAvailability();
    const [formData, setFormData] = useState({
        id: null,
        name: '',
        entity_type: 'product',
        code: '',
        frontend_type: 'select',
        swatch_type: 'none',
        is_filterable: false,
        is_filterable_frontend: true,
        is_filterable_backend: true,
        is_required: false,
        is_variant: true,
        status: true,
        options: [] // Each option: { value: '', swatch_value: '' }
    });

    const [optionInput, setOptionInput] = useState({ value: '', swatch_value: '' });
    const [searchTerm, setSearchTerm] = useState('');

    const fetchAttributes = async () => {
        setLoading(true);
        try {
            const res = await attributeApi.getAll({ entity_type: activeTab });
            setAttributes(res.data);
        } catch (error) {
            console.error('Lỗi khi tải thuộc tính:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAttributes();
    }, [activeTab]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isFormOpen) {
                setIsFormOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFormOpen]);

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
            entity_type: attr.entity_type || 'product',
            code: attr.code,
            frontend_type: attr.frontend_type,
            swatch_type: attr.swatch_type || 'none',
            is_filterable: attr.is_filterable,
            is_filterable_frontend: attr.id ? attr.is_filterable_frontend : true,
            is_filterable_backend: attr.id ? attr.is_filterable_backend : true,
            is_required: attr.is_required,
            is_variant: attr.is_variant,
            status: attr.id ? !!attr.status : true,
            options: attr.options ? attr.options.map(o => ({ 
                id: o.id || Math.random().toString(36).substr(2, 9),
                value: o.value, 
                swatch_value: o.swatch_value || '' 
            })) : []
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

    const handleQuickToggle = async (attr, field = 'status') => {
        try {
            const newValue = !attr[field];
            await attributeApi.update(attr.id, { ...attr, [field]: newValue });
            setAttributes(attributes.map(a => a.id === attr.id ? { ...a, [field]: newValue } : a));
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái.', type: 'error' });
        }
    };

    const StatusBadge = ({ value, onClick, activeLabel = "Có", inactiveLabel = "Không", activeColor = "bg-green-500", activeText = "text-white" }) => (
        <button
            onClick={onClick}
            className={`px-3 py-1 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all shadow-sm transform active:scale-95 ${
                value 
                ? `${activeColor} ${activeText} border border-green-600/20` 
                : 'bg-stone/10 text-stone/40 border border-stone/20'
            }`}
        >
            {value ? activeLabel : inactiveLabel}
        </button>
    );

    const addOption = () => {
        if (optionInput.value.trim()) {
            setFormData({ 
                ...formData, 
                options: [...formData.options, { 
                    ...optionInput, 
                    id: Math.random().toString(36).substr(2, 9) 
                }] 
            });
            setOptionInput({ value: '', swatch_value: '' });
        }
    };

    const removeOption = (id) => {
        setFormData({ ...formData, options: formData.options.filter(o => o.id !== id) });
    };

    const handleAIGenerate = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }
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

    const filteredAttributes = attributes.filter(attr => 
        attr.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        attr.code.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
            <style>
                {`
                    @keyframes refresh-spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    .animate-refresh-spin {
                        animation: refresh-spin 0.8s linear infinite;
                    }

                    .custom-scrollbar::-webkit-scrollbar {
                        width: 8px;
                        height: 8px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: rgba(182, 143, 84, 0.05);
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: rgba(182, 143, 84, 0.2);
                        border-radius: 4px;
                        border: 2px solid transparent;
                        background-clip: content-box;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: rgba(182, 143, 84, 0.4);
                    }

                    .table-grid {
                        border-collapse: collapse;
                    }
                    .table-grid th, .table-grid td {
                        border: 1px solid rgba(182, 143, 84, 0.15);
                    }
                `}
            </style>

            {/* Header Area */}
            <div className="flex-none bg-[#fcfcfa] pb-4">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-display font-bold text-primary italic">Cấu hình thuộc tính</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Định nghĩa đặc tính cho sản phẩm và đơn hàng</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex bg-white border border-gold/10 p-0.5 rounded-sm shadow-sm h-10">
                            <button 
                                onClick={() => setActiveTab('product')}
                                className={`px-4 flex items-center gap-2 font-ui text-[10px] font-black uppercase tracking-widest transition-all rounded-sm ${activeTab === 'product' ? 'bg-primary text-white shadow-sm' : 'text-stone/60 hover:text-primary hover:bg-gold/5'}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                                Sản phẩm
                            </button>
                            <button 
                                onClick={() => setActiveTab('order')}
                                className={`px-4 flex items-center gap-2 font-ui text-[10px] font-black uppercase tracking-widest transition-all rounded-sm ${activeTab === 'order' ? 'bg-primary text-white shadow-sm' : 'text-stone/60 hover:text-primary hover:bg-gold/5'}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                                Đơn hàng
                            </button>
                        </div>
                    </div>
                </div>

                {/* Toolbar like ProductList */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <button
                            onClick={() => {
                                setFormData({ 
                                    id: null, 
                                    name: '', 
                                    entity_type: activeTab, 
                                    code: '', 
                                    frontend_type: 'select', 
                                    swatch_type: 'none', 
                                    is_filterable: activeTab === 'product', 
                                    is_filterable_frontend: true, 
                                    is_filterable_backend: true, 
                                    is_required: false, 
                                    is_variant: activeTab === 'product', 
                                    options: [] 
                                });
                                setIsFormOpen(true);
                            }}
                            className="bg-brick text-white p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 shadow-sm"
                            title="Thêm thuộc tính mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>

                        <button
                            onClick={fetchAttributes}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới danh sách"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span>
                        </button>
                    </div>

                    {/* Search Bar like ProductList */}
                    <div className="flex-1 max-w-md relative ml-4">
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gold text-[16px]">search</span>
                        <input
                            type="text"
                            placeholder="Tìm tên hoặc mã thuộc tính..."
                            className="w-full bg-stone/5 border border-gold/10 px-8 py-1.5 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em] ml-4">
                        {filteredAttributes.length} / {attributes.length} Thuộc tính
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative flex flex-col gap-4">
                {isFormOpen && (
                    <div className="absolute inset-0 z-50 bg-[#fcfcfa]/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white border border-gold/20 shadow-[0_15px_50px_-12px_rgba(0,0,0,0.25)] w-full max-w-4xl mx-auto rounded-md overflow-hidden flex flex-col max-h-full">
                            <div className="flex-none px-6 py-4 bg-gold/5 border-b border-gold/10 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-primary text-[18px]">{formData.id ? 'edit_note' : 'add_box'}</span>
                                    </div>
                                    <h2 className="font-display text-lg font-bold text-primary uppercase italic">{formData.id ? 'Biên Tập' : 'Khởi Tạo'} Thuộc Tính</h2>
                                </div>
                                <button onClick={() => setIsFormOpen(false)} className="w-8 h-8 flex items-center justify-center text-stone/40 hover:text-brick hover:bg-brick/5 transition-all rounded-full">
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                                <form onSubmit={handleFormSubmit} id="attribute-form" className="grid grid-cols-1 md:grid-cols-12 gap-8">
                                    <div className="md:col-span-7 space-y-6">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Tên Gọi (VD: Màu sắc)</label>
                                                <input 
                                                    required type="text" 
                                                    value={formData.name} 
                                                    onChange={e => setFormData({ ...formData, name: e.target.value })} 
                                                    className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm" 
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Mã Code (Dùng cho API)</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.code} 
                                                    disabled={!!formData.id} 
                                                    onChange={e => setFormData({ ...formData, code: e.target.value })} 
                                                    className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm disabled:opacity-40" 
                                                    placeholder="VD: color" 
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Kiểu Hiển Thị</label>
                                                <select 
                                                    value={formData.frontend_type} 
                                                    onChange={e => setFormData({ ...formData, frontend_type: e.target.value })} 
                                                    className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm appearance-none"
                                                >
                                                    <option value="text">Văn bản ngắn (Text)</option>
                                                    <option value="select">Danh mục chọn (Select)</option>
                                                    <option value="multiselect">Chọn nhiều (Multiselect)</option>
                                                    <option value="boolean">Đúng / Sai (Boolean)</option>
                                                    <option value="price">Giá tiền (Price)</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-stone/50">Nút Bấm Trực Quan</label>
                                                <select 
                                                    value={formData.swatch_type} 
                                                    onChange={e => setFormData({ ...formData, swatch_type: e.target.value })} 
                                                    className="w-full bg-stone/5 border border-gold/10 px-4 py-2.5 focus:outline-none focus:border-primary font-body text-sm rounded-sm appearance-none"
                                                >
                                                    <option value="none">Không dùng hiệu ứng</option>
                                                    <option value="color">Hiển thị Ô màu</option>
                                                    <option value="image">Hiển thị Hình ảnh</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-6 items-center bg-gold/5 p-4 border border-gold/10 rounded-sm">
                                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                                <div className="relative flex items-center">
                                                    <input type="checkbox" checked={formData.is_variant} onChange={e => setFormData({ ...formData, is_variant: e.target.checked })} className="size-4 accent-primary rounded-sm" />
                                                </div>
                                                <span className="text-[11px] font-bold uppercase text-primary tracking-wider">Biến thể</span>
                                            </label>
                                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                                <input type="checkbox" checked={formData.is_filterable_frontend} onChange={e => setFormData({ ...formData, is_filterable_frontend: e.target.checked })} className="size-4 accent-primary rounded-sm" />
                                                <span className="text-[11px] font-bold uppercase text-stone-600 tracking-wider">Lọc trên Web</span>
                                            </label>
                                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                                <input type="checkbox" checked={formData.is_filterable_backend} onChange={e => setFormData({ ...formData, is_filterable_backend: e.target.checked })} className="size-4 accent-primary rounded-sm" />
                                                <span className="text-[11px] font-bold uppercase text-stone-600 tracking-wider">Lọc Nội Bộ</span>
                                            </label>
                                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                                <input type="checkbox" checked={formData.status} onChange={e => setFormData({ ...formData, status: e.target.checked })} className="size-4 accent-primary rounded-sm" />
                                                <span className="text-[11px] font-bold uppercase text-stone-600 tracking-wider">Hoạt động</span>
                                            </label>
                                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                                <input type="checkbox" checked={formData.is_required} onChange={e => setFormData({ ...formData, is_required: e.target.checked })} className="size-4 accent-primary rounded-sm" />
                                                <span className="text-[11px] font-bold uppercase text-stone-600 tracking-wider">Bắt buộc</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div className="md:col-span-5 bg-stone/5 border border-gold/10 p-5 space-y-4 rounded-sm">
                                        <div className="flex justify-between items-center border-b border-stone/20 pb-3">
                                            <h4 className="text-[11px] font-black uppercase tracking-[0.15em] text-primary">Giá Trị Tùy Chọn</h4>
                                            <button 
                                                type="button" 
                                                onClick={handleAIGenerate} 
                                                disabled={aiGenerating || !aiAvailable} 
                                                className="flex items-center gap-1.5 text-gold hover:text-primary transition-colors text-[9px] font-black uppercase"
                                                title={!aiAvailable ? disabledReason : 'Gợi ý giá trị bằng AI'}
                                            >
                                                <span className={`material-symbols-outlined text-[16px] ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                                Gợi ý AI
                                            </button>
                                        </div>

                                        <Reorder.Group 
                                            axis="y" 
                                            values={formData.options} 
                                            onReorder={(newOrder) => setFormData({ ...formData, options: newOrder })}
                                            className="max-h-[220px] overflow-y-auto pr-1 space-y-2 custom-scrollbar"
                                        >
                                            <AnimatePresence initial={false}>
                                                {formData.options.map((opt) => (
                                                    <Reorder.Item 
                                                        key={opt.id} 
                                                        value={opt}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9 }}
                                                        className="flex items-center gap-2 bg-white border border-stone/10 p-2 rounded-sm group hover:border-gold/30 transition-colors cursor-grab active:cursor-grabbing"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px] text-stone/20 group-hover:text-gold transition-colors">drag_indicator</span>
                                                        {formData.swatch_type === 'color' && (
                                                            <div className="size-6 rounded-full border border-stone/20 shadow-sm shrink-0" style={{ backgroundColor: opt.swatch_value || '#ccc' }}></div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-[12px] font-bold text-stone-700 truncate">{opt.value}</div>
                                                            {opt.swatch_value && <div className="text-[9px] text-stone/40 font-mono uppercase truncate">{opt.swatch_value}</div>}
                                                        </div>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => removeOption(opt.id)} 
                                                            className="opacity-0 group-hover:opacity-100 p-1 text-stone/30 hover:text-brick transition-all"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                                        </button>
                                                    </Reorder.Item>
                                                ))}
                                            </AnimatePresence>
                                            {formData.options.length === 0 && <div className="text-center py-8 text-stone/30 font-body italic text-[12px]">Chưa có giá trị nào</div>}
                                        </Reorder.Group>

                                        <div className="pt-4 border-t border-stone/20 space-y-3">
                                            <div className="flex gap-2">
                                                <input 
                                                    value={optionInput.value} 
                                                    onChange={e => setOptionInput({ ...optionInput, value: e.target.value })} 
                                                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addOption())} 
                                                    type="text" placeholder="Tên..." 
                                                    className="flex-1 bg-white border border-stone/20 px-3 py-2 text-[12px] font-body focus:outline-none focus:border-primary rounded-sm shadow-inner" 
                                                />
                                                {formData.swatch_type === 'color' && (
                                                    <input 
                                                        type="color" 
                                                        value={optionInput.swatch_value || '#000000'} 
                                                        onChange={e => setOptionInput({ ...optionInput, swatch_value: e.target.value })} 
                                                        className="size-9 bg-transparent cursor-pointer shrink-0" 
                                                    />
                                                )}
                                            </div>
                                            <button type="button" onClick={addOption} className="w-full bg-gold/10 text-gold border border-gold/20 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-white transition-all rounded-sm">
                                                Ghi nhận giá trị
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>

                            <div className="flex-none px-6 py-4 bg-stone/5 border-t border-gold/10 flex justify-end gap-3">
                                <button 
                                    type="button" 
                                    onClick={() => setIsFormOpen(false)} 
                                    className="px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-stone-500 hover:bg-stone/10 transition-all border border-stone/20 rounded-sm"
                                >
                                    Đóng
                                </button>
                                <button 
                                    form="attribute-form"
                                    type="submit" 
                                    className="px-8 py-2 bg-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-umber transition-all shadow-sm rounded-sm"
                                >
                                    {formData.id ? 'Lưu cập nhật' : 'Khởi tạo ngay'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                    <table className="w-full table-grid table-scrollbar text-left min-w-[800px]">
                        <thead className="sticky top-0 z-20 bg-gold/5 backdrop-blur-sm">
                            <tr>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-1/4">Tên & Mã Thuộc Tính</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-center w-40">Phân Loại</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-center w-32">Biến Thể</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-center w-32">Lọc Web</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-center w-32">Lọc Nội Bộ</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-center w-32">Bắt Buộc</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-center w-32">Trạng Thái</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary">Danh Sách Giá Trị</th>
                                <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary text-right w-36">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gold/10">
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="p-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                                            <span className="text-[11px] font-black text-stone/30 uppercase tracking-[0.2em]">Đang tải dữ liệu...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : attributes.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="p-20 text-center">
                                        <div className="flex flex-col items-center gap-3 opacity-30">
                                            <span className="material-symbols-outlined text-[60px]">inventory_2</span>
                                            <span className="text-[12px] font-bold italic uppercase tracking-widest">Không tìm thấy thuộc tính nào khớp với từ khóa</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredAttributes.map((attr) => (
                                <tr 
                                    key={attr.id} 
                                    onDoubleClick={() => handleEdit(attr)}
                                    className="hover:bg-gold/5 transition-colors group cursor-pointer select-none"
                                >
                                    <td className="px-4 py-3.5">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-display text-[15px] font-bold text-primary group-hover:text-umber transition-colors tracking-tight uppercase">{attr.name}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] font-black text-stone/40 bg-stone/5 px-1.5 py-0.5 rounded border border-stone/10 tracking-widest uppercase italic">CODE: {attr.code}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className="px-2.5 py-1 bg-gold/5 border border-gold/20 text-[10px] font-black uppercase tracking-widest text-gold rounded-full shadow-sm">
                                            {attr.frontend_type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <div className="flex justify-center">
                                            <StatusBadge 
                                                value={attr.is_variant} 
                                                onClick={(e) => { e.stopPropagation(); handleQuickToggle(attr, 'is_variant'); }}
                                                activeColor="bg-primary"
                                            />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <div className="flex justify-center">
                                            <StatusBadge 
                                                value={attr.is_filterable_frontend} 
                                                onClick={(e) => { e.stopPropagation(); handleQuickToggle(attr, 'is_filterable_frontend'); }}
                                                activeColor="bg-blue-600"
                                            />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <div className="flex justify-center">
                                            <StatusBadge 
                                                value={attr.is_filterable_backend} 
                                                onClick={(e) => { e.stopPropagation(); handleQuickToggle(attr, 'is_filterable_backend'); }}
                                                activeColor="bg-amber-500"
                                            />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <div className="flex justify-center">
                                            <StatusBadge 
                                                value={attr.is_required} 
                                                onClick={(e) => { e.stopPropagation(); handleQuickToggle(attr, 'is_required'); }}
                                                activeColor="bg-brick"
                                            />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <div className="flex justify-center">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleQuickToggle(attr); }} 
                                                className={`relative w-11 h-5.5 rounded-full transition-colors duration-200 focus:outline-none shadow-inner border border-gold/10 ${attr.status ? 'bg-green-500' : 'bg-stone/20'}`}
                                            >
                                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${attr.status ? 'translate-x-5.5' : 'translate-x-0'}`}></div>
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="flex flex-wrap gap-1.5 max-w-md">
                                            {attr.options?.slice(0, 5).map((o, i) => (
                                                <span key={i} className="px-2 py-1 bg-white border border-stone/15 text-[10px] font-bold uppercase text-stone-600 rounded-sm shadow-sm group-hover:border-gold/30 transition-colors">
                                                    {o.value}
                                                </span>
                                            ))}
                                            {attr.options?.length > 5 && (
                                                <span className="px-2 py-1 bg-stone/5 border border-stone/10 text-[9px] font-black text-gold uppercase tracking-tighter rounded-full italic">
                                                    +{attr.options.length - 5}
                                                </span>
                                            )}
                                            {attr.options?.length === 0 && <span className="text-[11px] text-stone/30 italic">No values defined</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">

                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleEdit(attr); }} 
                                                className="w-9 h-9 border border-gold/30 text-gold hover:bg-gold hover:text-white transition-all flex items-center justify-center rounded-sm shadow-sm active:scale-90"
                                                title="Sửa thuộc tính"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDelete(attr.id); }} 
                                                className="w-9 h-9 border border-brick/30 text-brick hover:bg-brick hover:text-white transition-all flex items-center justify-center rounded-sm shadow-sm active:scale-90"
                                                title="Xóa thuộc tính"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AttributeList;
