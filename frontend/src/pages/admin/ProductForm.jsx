import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productApi, categoryApi, attributeApi, productImageApi, aiApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

const ProductForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal } = useUI();
    const [loading, setLoading] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [typeConfirmed, setTypeConfirmed] = useState(isEdit); // On edit, type is already set
    const [categories, setCategories] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [images, setImages] = useState([]);

    const handleAIGenerate = async () => {
        if (!formData.name) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tên Phẩm Vật để AI có cơ sở viết mô tả.', type: 'warning' });
            return;
        }

        setAiGenerating(true);
        try {
            const categoryName = categories.find(c => c.id == formData.category_id)?.name || 'Gốm sứ';
            const attrData = {};
            Object.entries(formData.custom_attributes).forEach(([id, val]) => {
                const attr = allAttributes.find(a => a.id == id);
                if (attr && val) attrData[attr.name] = val;
            });

            const response = await aiApi.generateProductDescription({
                name: formData.name,
                category: categoryName,
                attributes: attrData
            });

            setFormData(prev => ({
                ...prev,
                description: response.data.description
            }));

            showModal({ title: 'Thành công', content: 'AI đã hoàn thành bản thảo mô tả nghệ thuật!', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi AI', content: 'Không thể kết nối AI lúc này. Vui lòng thử lại sau.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    const [formData, setFormData] = useState({
        type: 'simple',
        name: '',
        category_id: '',
        price: '',
        description: '',
        is_featured: false,
        is_new: true,
        stock_quantity: 10,
        sku: '',
        special_price: '',
        special_price_from: '',
        special_price_to: '',
        meta_title: '',
        meta_description: '',
        meta_keywords: '',
        linked_product_ids: [],
        super_attribute_ids: [],
        custom_attributes: {} // { attrId: value }
    });

    useEffect(() => {
        fetchCategories();
        fetchRelatedData();
        if (isEdit) {
            fetchProduct();
        }
    }, [id]);

    const fetchCategories = async () => {
        try {
            const response = await categoryApi.getAll();
            setCategories(response.data);
        } catch (error) {
            console.error("Error fetching categories", error);
        }
    };

    const fetchRelatedData = async () => {
        try {
            const [prodRes, attrRes] = await Promise.all([
                productApi.getAll({ per_page: 100 }),
                attributeApi.getAll()
            ]);
            const otherProds = prodRes.data.data.filter(p => !id || p.id != id);
            setAllProducts(otherProds);
            setAllAttributes(attrRes.data);
        } catch (error) {
            console.error("Error fetching related data", error);
        }
    };

    const fetchProduct = async () => {
        try {
            const response = await productApi.getOne(id);
            const data = response.data;
            setFormData({
                type: data.type || 'simple',
                name: data.name,
                category_id: data.category_id,
                price: data.price,
                description: data.description || '',
                is_featured: !!data.is_featured,
                is_new: !!data.is_new,
                stock_quantity: data.stock_quantity || 0,
                sku: data.sku || '',
                special_price: data.special_price || '',
                special_price_from: data.special_price_from ? data.special_price_from.split(' ')[0] : '',
                special_price_to: data.special_price_to ? data.special_price_to.split(' ')[0] : '',
                meta_title: data.meta_title || '',
                meta_description: data.meta_description || '',
                meta_keywords: data.meta_keywords || '',
                linked_product_ids: data.linked_products ? data.linked_products.map(p => p.id) : [],
                super_attribute_ids: data.super_attributes ? data.super_attributes.map(a => a.id) : [],
                custom_attributes: (data.attribute_values || []).reduce((acc, curr) => {
                    let val = curr.value;
                    try {
                        if (val && (val.startsWith('[') || val.startsWith('{'))) {
                            val = JSON.parse(val);
                        }
                    } catch (e) { }
                    acc[curr.attribute_id] = val;
                    return acc;
                }, {})
            });
            setImages(data.images || []);
        } catch (error) {
            alert('Không thể tải thông tin sản phẩm.');
            navigate('/admin/products');
        }
    };

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        if (!isEdit) {
            showModal({
                title: 'Lưu ý',
                content: 'Vui lòng tạo sản phẩm trước khi tải ảnh lên.',
                type: 'warning'
            });
            return;
        }

        const formDataToUpload = new FormData();
        files.forEach(file => {
            formDataToUpload.append('images[]', file);
        });

        setLoading(true);
        try {
            const response = await productImageApi.upload(id, formDataToUpload);
            setImages([...images, ...response.data]);
        } catch (error) {
            alert("Lỗi tải ảnh");
        } finally {
            setLoading(false);
        }
    };

    const handleSetPrimary = async (imgId) => {
        try {
            await productImageApi.setPrimary(imgId);
            setImages(images.map(img => ({
                ...img,
                is_primary: img.id === imgId
            })));
        } catch (error) {
            alert("Lỗi cài đặt ảnh đại diện");
        }
    };

    const handleDeleteImage = async (imgId) => {
        if (!window.confirm("Xoá ảnh này?")) return;
        try {
            await productImageApi.destroy(imgId);
            setImages(images.filter(img => img.id !== imgId));
        } catch (error) {
            alert("Lỗi xoá ảnh");
        }
    };

    const handleCustomAttributeChange = (attrId, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: {
                ...prev.custom_attributes,
                [attrId]: value
            }
        }));
    };

    const renderAttributeField = (attr) => {
        const value = formData.custom_attributes[attr.id] || (attr.frontend_type === 'multiselect' ? [] : '');
        const commonClass = "w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body";

        switch (attr.frontend_type) {
            case 'textarea':
                return <textarea className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} rows="3" />;
            case 'select':
                return (
                    <div className="space-y-3">
                        <select className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)}>
                            <option value="">-- Chọn {attr.name} --</option>
                            {(attr.options || []).map(opt => <option key={opt.id} value={opt.value}>{opt.value}</option>)}
                        </select>
                        {attr.swatch_type === 'color' && value && (
                            <div className="flex items-center gap-2 px-3 py-1 bg-gold/5 border border-gold/10 w-fit">
                                <div
                                    className="size-4 rounded-full border border-gold/20"
                                    style={{ backgroundColor: (attr.options?.find(o => o.value === value))?.swatch_value || 'transparent' }}
                                ></div>
                                <span className="text-[10px] font-bold text-primary uppercase">{value}</span>
                            </div>
                        )}
                    </div>
                );
            case 'multiselect':
                const selected = Array.isArray(value) ? value : [];
                return (
                    <div className="space-y-2 max-h-40 overflow-y-auto p-4 border border-gold/10 bg-background-light">
                        {(attr.options || []).map(opt => (
                            <label key={opt.id} className="flex items-center gap-2 cursor-pointer font-body text-sm">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(opt.value)}
                                    onChange={(e) => {
                                        const newVal = e.target.checked
                                            ? [...selected, opt.value]
                                            : selected.filter(v => v !== opt.value);
                                        handleCustomAttributeChange(attr.id, newVal);
                                    }}
                                    className="size-4 text-primary"
                                />
                                {opt.value}
                            </label>
                        ))}
                    </div>
                );
            case 'boolean':
                return (
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" checked={value === '1' || value === 1 || value === true} onChange={() => handleCustomAttributeChange(attr.id, 1)} /> Yes
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" checked={value === '0' || value === 0 || value === false} onChange={() => handleCustomAttributeChange(attr.id, 0)} /> No
                        </label>
                    </div>
                );
            case 'date':
                return <input type="date" className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
            case 'price':
                return <input type="number" className={`${commonClass} font-bold text-brick`} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
            default:
                return <input type="text" className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isEdit) {
                await productApi.update(id, formData);
                showModal({
                    title: 'Thành công',
                    content: 'Cập nhật sản phẩm thành công!',
                    type: 'success',
                    onAction: () => navigate('/admin/products')
                });
            } else {
                await productApi.store(formData);
                showModal({
                    title: 'Thành công',
                    content: 'Thêm sản phẩm mới thành công!',
                    type: 'success',
                    onAction: () => navigate('/admin/products')
                });
            }
        } catch (error) {
            showModal({
                title: 'Lỗi',
                content: error.response?.data?.message || 'Vui lòng kiểm tra lại thông tin.',
                type: 'error'
            });
        } finally {
            setLoading(false);
        }
    };

    const TYPE_INFO = {
        simple: { label: 'Simple Product', icon: 'inventory_2', desc: 'Sản phẩm đơn lẻ, không có biến thể. VD: Bình gốm cụ thể.' },
        configurable: { label: 'Configurable Product', icon: 'settings_input_component', desc: 'Sản phẩm có biến thể theo thuộc tính Select/Multiselect (màu men, nghệ nhân...). Tạo ma trận sản phẩm con.' },
        grouped: { label: 'Grouped Product', icon: 'group_work', desc: 'Nhóm nhiều sản phẩm đơn lại thành bộ sưu tập.' },
        bundle: { label: 'Bundle Product', icon: 'inventory', desc: 'Combo sản phẩm với các tuỳ chọn linh hoạt cho khách.' },
        virtual: { label: 'Virtual Product', icon: 'cloud', desc: 'Dịch vụ, khoá học, trải nghiệm — không cần vận chuyển.' },
    };

    // Step 1: Choose type (only for new products)
    if (!isEdit && !typeConfirmed) {
        return (
            <div className="max-w-screen-lg mx-auto py-16 px-4 animate-fade-in">
                <div className="flex items-center gap-4 mb-12">
                    <Link to="/admin/products" className="size-10 rounded-full border border-gold/20 flex items-center justify-center text-primary hover:bg-gold/10 transition-colors">
                        <span className="material-symbols-outlined text-sm">west</span>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-display font-bold text-primary">Bước 1: Chọn Loại Sản Phẩm</h1>
                        <p className="text-[10px] font-bold text-stone uppercase tracking-widest mt-1">Loại sản phẩm không thể thay đổi sau khi tạo</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.entries(TYPE_INFO).map(([key, info]) => (
                        <button
                            key={key}
                            onClick={() => {
                                setFormData(prev => ({ ...prev, type: key }));
                                setTypeConfirmed(true);
                            }}
                            className={`text-left p-8 border-2 transition-all hover:shadow-premium group ${formData.type === key
                                ? 'border-primary bg-primary/5 shadow-premium'
                                : 'border-gold/10 bg-white hover:border-primary/40'
                                }`}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div className={`size-12 rounded-full flex items-center justify-center transition-colors ${formData.type === key ? 'bg-primary text-white' : 'bg-background-light text-primary group-hover:bg-primary/10'
                                    }`}>
                                    <span className="material-symbols-outlined">{info.icon}</span>
                                </div>
                                <h3 className="font-ui text-sm font-bold uppercase tracking-widest text-primary">{info.label}</h3>
                            </div>
                            <p className="text-stone font-body text-sm leading-relaxed">{info.desc}</p>
                            {key === 'configurable' && (
                                <div className="mt-4 p-3 bg-gold/5 border border-gold/10 text-[10px] text-stone font-ui uppercase tracking-wider">
                                    <span className="material-symbols-outlined text-gold text-xs align-middle mr-1">info</span>
                                    Yêu cầu thuộc tính kiểu Select hoặc Multiselect
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-screen-xl mx-auto py-10 px-4 animate-fade-in">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Link to="/admin/products" className="size-10 rounded-full border border-gold/20 flex items-center justify-center text-primary hover:bg-gold/10 transition-colors">
                        <span className="material-symbols-outlined text-sm">west</span>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-display font-bold text-primary">
                            {isEdit ? 'Hiệu Chỉnh Phẩm Vật' : 'Tạo Phẩm Vật Mới'}
                        </h1>
                        <div className="flex items-center gap-3 mt-1">
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest border ${isEdit ? 'bg-stone/5 text-stone border-stone/20' : 'bg-primary/10 text-primary border-primary/20'
                                }`}>
                                <span className="material-symbols-outlined text-xs">{TYPE_INFO[formData.type]?.icon}</span>
                                {TYPE_INFO[formData.type]?.label}
                                {isEdit && <span className="material-symbols-outlined text-xs ml-1 opacity-50">lock</span>}
                            </div>
                            {isEdit && <span className="text-[10px] font-bold text-stone uppercase tracking-widest">ID: #{id} | SKU: {formData.sku}</span>}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {!isEdit && (
                        <button
                            type="button"
                            onClick={() => setTypeConfirmed(false)}
                            className="text-stone hover:text-primary transition-colors font-ui text-xs font-bold uppercase tracking-widest flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-sm">arrow_back</span>
                            Đổi loại
                        </button>
                    )}
                    <button
                        form="product-form"
                        type="submit"
                        disabled={loading}
                        className="bg-primary text-white px-10 py-4 rounded-full font-ui font-bold text-sm uppercase tracking-widest hover:bg-umber transition-all disabled:opacity-50 shadow-premium"
                    >
                        {loading ? 'Đang lưu...' : (isEdit ? 'Lưu Thay Đổi' : 'Thăng Phẩm Mới')}
                    </button>
                </div>
            </div>

            <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                {/* Column 1: Core Content */}
                <div className="bg-white border-2 border-primary/5 p-10 shadow-premium space-y-8">

                    <div className="space-y-2">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tên Phẩm Vật</label>
                        <input
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-display text-2xl"
                            placeholder="VD: Bình Hút Lộc Vinh Hoa..."
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Mã SKU</label>
                            <input
                                name="sku"
                                value={formData.sku}
                                onChange={handleChange}
                                className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-ui"
                                placeholder="GM-VH-001"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Danh Mục Gốm</label>
                            <select
                                name="category_id"
                                value={formData.category_id}
                                onChange={handleChange}
                                required
                                className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                            >
                                <option value="">-- Chọn danh mục --</option>
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Giá Niêm Yết (VND)</label>
                                <input
                                    type="number"
                                    name="price"
                                    value={formData.price}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-ui font-bold text-brick text-xl"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-brick">Giá Khuyến Mãi (Tùy chọn)</label>
                                <input
                                    type="number"
                                    name="special_price"
                                    value={formData.special_price}
                                    onChange={handleChange}
                                    className="w-full bg-brick/5 border border-brick/20 p-4 focus:outline-none focus:border-brick font-ui font-bold text-brick"
                                />
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Số Lượng Tồn</label>
                                <input
                                    type="number"
                                    name="stock_quantity"
                                    value={formData.stock_quantity}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-2">
                                    <label className="font-ui text-[8px] font-bold uppercase tracking-widest text-stone">Từ ngày</label>
                                    <input type="date" name="special_price_from" value={formData.special_price_from} onChange={handleChange} className="w-full bg-background-light border border-gold/10 p-2 text-xs focus:outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="font-ui text-[8px] font-bold uppercase tracking-widest text-stone">Đến ngày</label>
                                    <input type="date" name="special_price_to" value={formData.special_price_to} onChange={handleChange} className="w-full bg-background-light border border-gold/10 p-2 text-xs focus:outline-none" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-12 pt-4">
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                name="is_featured"
                                checked={formData.is_featured}
                                onChange={handleChange}
                                className="size-5 text-primary focus:ring-primary rounded-sm border-gold/30"
                            />
                            <span className="font-ui text-[10px] font-bold text-stone uppercase tracking-widest group-hover:text-primary transition-colors">Sản phẩm nổi bật</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                name="is_new"
                                checked={formData.is_new}
                                onChange={handleChange}
                                className="size-5 text-primary focus:ring-primary rounded-sm border-gold/30"
                            />
                            <span className="font-ui text-[10px] font-bold text-stone uppercase tracking-widest group-hover:text-primary transition-colors">Tác phẩm mới</span>
                        </label>
                    </div>
                    {/* SEO & Meta Section */}
                    <div className="bg-white border-2 border-primary/5 p-10 shadow-premium space-y-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="material-symbols-outlined text-primary">search</span>
                            <h3 className="font-display font-bold text-primary text-xl">Tối Ưu SEO & Meta</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Meta Title</label>
                                <input
                                    name="meta_title"
                                    value={formData.meta_title}
                                    onChange={handleChange}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                                    placeholder="Tiêu đề hiển thị trên Google..."
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Meta Keywords</label>
                                <input
                                    name="meta_keywords"
                                    value={formData.meta_keywords}
                                    onChange={handleChange}
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                                    placeholder="VD: gốm bát tràng, bình hút lộc, phong thủy..."
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Meta Description</label>
                                <textarea
                                    name="meta_description"
                                    value={formData.meta_description}
                                    onChange={handleChange}
                                    rows="3"
                                    className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body resize-none"
                                    placeholder="Mô tả ngắn hiển thị trên kết quả tìm kiếm..."
                                ></textarea>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2 pt-6 border-t border-gold/10">
                        <div className="flex justify-between items-center mb-1">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Mô Tả Chế Tác</label>
                            <button
                                type="button"
                                onClick={handleAIGenerate}
                                disabled={aiGenerating}
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all shadow-sm ${aiGenerating
                                    ? 'bg-gold/10 text-gold animate-pulse cursor-wait'
                                    : 'bg-gradient-to-r from-primary to-umber text-white hover:scale-105 active:scale-95'
                                    }`}
                            >
                                <span className={`material-symbols-outlined text-xs ${aiGenerating ? 'animate-spin' : ''}`}>
                                    {aiGenerating ? 'progress_activity' : 'auto_awesome'}
                                </span>
                                {aiGenerating ? 'Đang Sáng Tạo...' : 'AI Viết Mô Tả'}
                            </button>
                        </div>
                        <div className="bg-white border border-gold/20 shadow-sm quill-premium-wrapper">
                            <ReactQuill
                                theme="snow"
                                value={formData.description}
                                onChange={(val) => setFormData(prev => ({ ...prev, description: val }))}
                                modules={{
                                    toolbar: [
                                        [{ 'header': [1, 2, false] }],
                                        ['bold', 'italic', 'underline'],
                                        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                                        ['link', 'clean']
                                    ],
                                }}
                                className="font-body"
                                style={{ height: '300px', marginBottom: '50px' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Column 2: Attributes & Media */}
                <div className="space-y-10">
                    {/* EAV Attributes Section */}
                    <div className="bg-white border-2 border-primary/5 p-10 shadow-premium space-y-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="material-symbols-outlined text-primary">tune</span>
                            <h3 className="font-display font-bold text-primary text-xl">Thuộc Tính Chi Tiết (EAV)</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            {allAttributes.map(attr => (
                                <div key={attr.id} className="space-y-2">
                                    <label className="block text-[10px] font-bold text-stone uppercase tracking-widest">{attr.name}</label>
                                    {renderAttributeField(attr)}
                                </div>
                            ))}
                            {allAttributes.length === 0 && (
                                <p className="col-span-2 text-stone italic text-sm py-4 text-center border-2 border-dashed border-gold/10">
                                    Chưa có thuộc tính mở rộng nào được cấu hình.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Image Management Section */}
                    <div className="bg-white border-2 border-primary/5 p-10 shadow-premium space-y-6">
                        <div className="flex items-center justify-between border-b border-gold/10 pb-4">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">image</span>
                                <h3 className="font-display font-bold text-primary text-xl">Thư Viện Ảnh (S3)</h3>
                            </div>
                            {isEdit && (
                                <label className="bg-primary text-white px-4 py-2 rounded-full font-ui font-bold text-[10px] uppercase tracking-widest cursor-pointer hover:bg-umber transition-all flex items-center gap-2">
                                    <span className="material-symbols-outlined text-sm">upload</span>
                                    Tải ảnh
                                    <input type="file" multiple className="hidden" onChange={handleImageUpload} accept="image/*" />
                                </label>
                            )}
                        </div>

                        {isEdit ? (
                            <div className="grid grid-cols-3 gap-4">
                                {images.map((img) => (
                                    <div key={img.id} className={`group relative aspect-square border-2 transition-all ${img.is_primary ? 'border-primary' : 'border-gold/10 hover:border-gold/40'}`}>
                                        <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                                        {img.is_primary && (
                                            <div className="absolute top-0 left-0 bg-primary text-white px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest">
                                                Ảnh Chính
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-primary/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                            {!img.is_primary && (
                                                <button type="button" onClick={() => handleSetPrimary(img.id)} className="bg-white text-primary px-2 py-1 rounded-full text-[8px] font-bold uppercase hover:bg-gold transition-colors">Đặt làm chính</button>
                                            )}
                                            <button type="button" onClick={() => handleDeleteImage(img.id)} className="bg-brick text-white size-7 rounded-full flex items-center justify-center hover:bg-red-700 transition-colors">
                                                <span className="material-symbols-outlined text-xs">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {images.length === 0 && (
                                    <div className="col-span-full py-12 text-center border-2 border-dashed border-gold/10 text-stone font-body italic">
                                        Chưa có hình ảnh nào.
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-background-light p-6 text-center border-2 border-dashed border-gold/20">
                                <p className="text-stone font-body text-xs italic uppercase tracking-widest">Tải lên sau khi khởi tạo sản phẩm</p>
                            </div>
                        )}
                    </div>

                    {/* Configurable/Grouped Specific UI */}
                    {(formData.type === 'configurable' || formData.type === 'grouped') && (
                        <div className="bg-white border-2 border-primary/5 p-10 shadow-premium space-y-6">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">account_tree</span>
                                <h3 className="font-display font-bold text-primary text-xl">
                                    {formData.type === 'configurable' ? 'Cấu Hình Biến Thể' : 'Liên Kết Sản Phẩm'}
                                </h3>
                            </div>

                            {formData.type === 'configurable' && (
                                <div className="space-y-4">
                                    <label className="block text-[10px] font-bold text-stone uppercase tracking-widest">Chọn các thuộc tính làm biến thể:</label>
                                    <div className="flex flex-wrap gap-3">
                                        {allAttributes
                                            .filter(attr => attr.is_variant)
                                            .map(attr => (
                                                <label key={attr.id} className={`flex items-center gap-2 px-4 py-2 border cursor-pointer transition-all ${formData.super_attribute_ids.includes(attr.id) ? 'bg-primary text-white border-primary' : 'bg-background-light border-gold/10 text-stone hover:border-primary'}`}>
                                                    <input
                                                        type="checkbox"
                                                        className="hidden"
                                                        checked={formData.super_attribute_ids.includes(attr.id)}
                                                        onChange={(e) => {
                                                            const ids = e.target.checked
                                                                ? [...formData.super_attribute_ids, attr.id]
                                                                : formData.super_attribute_ids.filter(aid => aid !== attr.id);
                                                            setFormData({ ...formData, super_attribute_ids: ids });
                                                        }}
                                                    />
                                                    <span className="font-ui text-xs font-bold uppercase tracking-widest">{attr.name}</span>
                                                </label>
                                            ))
                                        }
                                    </div>
                                    <p className="text-[10px] text-stone italic">Chọn các thuộc tính kiểu 'Select' hoặc 'Multiselect' để tạo ma trận biến thể.</p>
                                </div>
                            )}

                            <div className="space-y-4 pt-6 border-t border-gold/10">
                                <label className="block text-[10px] font-bold text-stone uppercase tracking-widest">Gán sản phẩm con vào nhóm:</label>
                                <div className="max-h-[400px] overflow-y-auto space-y-3 p-6 bg-background-light border border-gold/10 custom-scrollbar">
                                    {allProducts.filter(p => !p.id || p.id !== parseInt(id)).map(p => (
                                        <label key={p.id} className={`flex items-center gap-4 p-3 border transition-all cursor-pointer group ${formData.linked_product_ids.includes(p.id) ? 'bg-primary/5 border-primary/30 shadow-sm' : 'bg-white border-gold/10 hover:border-primary/30'}`}>
                                            <div className="relative">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.linked_product_ids.includes(p.id)}
                                                    onChange={(e) => {
                                                        const ids = e.target.checked
                                                            ? [...formData.linked_product_ids, p.id]
                                                            : formData.linked_product_ids.filter(pid => pid !== p.id);
                                                        setFormData({ ...formData, linked_product_ids: ids });
                                                    }}
                                                    className="size-5 text-primary accent-primary"
                                                />
                                            </div>

                                            <div className="size-12 bg-stone/10 border border-gold/10 overflow-hidden">
                                                {p.images?.[0] ? (
                                                    <img src={p.images[0].image_url} alt="" className="size-full object-cover" />
                                                ) : (
                                                    <div className="size-full flex items-center justify-center text-[10px] text-stone">No Image</div>
                                                )}
                                            </div>

                                            <div className="flex-1 flex flex-col">
                                                <span className="font-body text-xs font-bold text-primary group-hover:text-primary transition-colors">{p.name}</span>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[9px] text-stone uppercase font-ui tracking-wider">{p.sku}</span>
                                                    <span className="text-[9px] text-brick font-bold uppercase font-ui">{new Intl.NumberFormat().format(p.price)}đ</span>
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                    {allProducts.length === 0 && <div className="text-center py-10 text-stone italic text-xs">Không tìm thấy sản phẩm khả dụng.</div>}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </form>
        </div>
    );
};

export default ProductForm;
