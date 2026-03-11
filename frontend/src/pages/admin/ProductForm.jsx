import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productApi, categoryApi, attributeApi, productImageApi, aiApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { compressImage, formatBytes } from '../../utils/imageUtils';

const ItemType = {
    IMAGE: 'image',
};

const DraggableImage = ({ img, index, moveImage, handleSetPrimary, handleDeleteImage, isSelected, toggleSelectImage, isDragSelecting }) => {
    const ref = useRef(null);
    const [, drop] = useDrop({
        accept: ItemType.IMAGE,
        hover(item, monitor) {
            if (!ref.current) return;
            const dragIndex = item.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;
            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;
            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;
            moveImage(dragIndex, hoverIndex);
            item.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag({
        type: ItemType.IMAGE,
        item: () => ({ id: img.id, index }),
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    drag(drop(ref));

    // Get display size (either from file object or cached property)
    const fileSize = img.file ? img.file.size : (img.file_size || 0);
    
    // Extract file name: Use the uploaded file's original name, or extract from URL if it's already saved
    const getFileName = () => {
        if (img.file && img.file.name) return img.file.name;
        if (img.file_name) return img.file_name;
        if (img.image_url) {
            try {
                const parts = img.image_url.split('/');
                return parts[parts.length - 1].split('?')[0]; 
            } catch {
                return `Ảnh #${index + 1}`;
            }
        }
        return `Ảnh #${index + 1}`;
    };
    
    const fileName = getFileName();

    return (
        <div 
            ref={ref}
            className={`group bg-white border rounded shadow-sm overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md image-item-card cursor-pointer select-none relative ${isSelected ? 'ring-2 ring-gold border-gold bg-gold/5' : img.is_primary ? 'border-primary ring-1 ring-primary/20 bg-primary/[0.02]' : 'border-stone/15 hover:border-primary/40'} ${isDragging ? 'opacity-30 scale-95' : 'opacity-100'}`}
            data-id={img.id}
            onMouseDown={(e) => {
                if (e.target.closest('button')) return;
                toggleSelectImage(img.id);
            }}
            onMouseEnter={() => {
                if (isDragSelecting) {
                    toggleSelectImage(img.id, true);
                }
            }}
        >
            {/* Checkmark mark for selection */}
            {isSelected && (
                <div className="absolute top-1 right-1 z-30 bg-gold text-white rounded p-0.5 shadow-sm animate-fade-in-up">
                    <span className="material-symbols-outlined text-[14px]">check</span>
                </div>
            )}

            {/* Image Thumbnail Area - Fixed small ratio */}
            <div className="relative aspect-[4/3] w-full bg-stone/5 overflow-hidden shrink-0">
                <img src={img.image_url} alt={fileName} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                
                {/* Optimizing Overlay */}
                {img.optimizing && (
                    <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] flex flex-col items-center justify-center z-20">
                         <span className="material-symbols-outlined text-[24px] text-primary animate-spin mb-1">refresh</span>
                         <span className="text-[10px] uppercase font-bold text-primary tracking-wider">Đang tối ưu...</span>
                    </div>
                )}

                {/* Action Overlay (Hover) */}
                <div className="absolute inset-0 bg-primary/80 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex flex-col items-center justify-center gap-2 cursor-move">
                    {!img.is_primary && (
                        <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); handleSetPrimary(img.id); }} 
                            className="bg-white text-primary px-3 py-1.5 text-[11px] font-bold uppercase rounded shadow-sm hover:bg-gold hover:text-white transition-colors animate-fade-in-up"
                        >
                            Chọn làm ảnh chính
                        </button>
                    )}
                    <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(img.id); }} 
                        className="bg-brick/90 text-white size-8 flex items-center justify-center rounded-sm hover:bg-brick transition-colors shadow-lg animate-fade-in-up delay-75"
                        title="Xóa ảnh"
                    >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                </div>

                {/* Badges */}
                {img.is_primary && (
                    <div className="absolute top-2 left-2 z-20 bg-gold text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">verified</span>
                        Ảnh đại diện
                    </div>
                )}
                {index === 0 && !img.is_primary && (
                    <div className="absolute top-2 left-2 z-20 bg-primary/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider shadow-sm border border-white/20">
                        Sắp xếp #1
                    </div>
                )}
            </div>

            {/* Info Footer */}
            <div className="flex-1 flex flex-col justify-center px-3 py-2.5 border-t border-stone/10 bg-white text-center cursor-move">
                <p className="text-[12px] font-bold text-primary truncate w-full mb-1" title={fileName}>
                    {fileName}
                </p>
                <div className="flex items-center justify-center">
                    {img.optimizing ? (
                        <span className="text-[11px] italic text-gold animate-pulse">Đang nén...</span>
                    ) : (
                        <span className="text-[11px] font-bold text-stone/50 bg-stone/5 px-2 py-0.5 rounded border border-stone/10 font-mono tracking-tight">
                            {fileSize ? formatBytes(fileSize) : '-- KB'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );};

const formatNumberOutput = (num) => {
    if (num === null || num === undefined || num === '') return '';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const removeAccents = (str) => {
    return str.normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/đ/g, 'd').replace(/Đ/g, 'D');
};

const generateSKUFromName = (name) => {
    if (!name) return '';
    let slug = removeAccents(name);
    slug = slug.replace(/[^a-zA-Z0-9\s-]/g, ''); // Remove special characters
    slug = slug.trim().replace(/\s+/g, '-'); // Spaces to hyphens
    slug = slug.toUpperCase();
    return slug.substring(0, 50); // Limit length
};

const Field = ({ label, children, className = "", labelClassName = "" }) => (
    <div className={`relative border border-stone/30 rounded-sm px-3.5 mb-5 focus-within:border-primary/30 transition-colors flex items-center min-h-[48px] bg-white ${className}`}>
        <label className={`absolute -top-3 left-2 bg-white px-1.5 font-sans text-[14px] font-bold text-orange-700 tracking-tight leading-none ${labelClassName}`}>
            {label}
        </label>
        <div className="w-full flex items-center pt-1 text-[14px]">
            {children}
        </div>
    </div>
);

const SectionTitle = ({ icon, title }) => (
    <div className="flex items-center gap-3 mb-5 border-b border-stone/10 pb-3">
        <span className="material-symbols-outlined text-primary/40 p-2 bg-stone/5 rounded-full text-lg">{icon}</span>
        <h3 className="font-sans text-[16px] font-bold text-primary">{title}</h3>
    </div>
);

const ProductForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal } = useUI();
    const [loading, setLoading] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [typeConfirmed, setTypeConfirmed] = useState(isEdit);
    const [categories, setCategories] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [images, setImages] = useState([]);
    const [selectedImages, setSelectedImages] = useState([]);
    const [isDragSelecting, setIsDragSelecting] = useState(false);

    const [formData, setFormData] = useState({
        type: 'simple',
        name: '',
        category_id: '',
        price: '',
        cost_price: '',
        weight: '',
        description: '',
        is_featured: false,
        is_new: true,
        stock_quantity: 10,
        sku: '',
        meta_title: '',
        meta_description: '',
        meta_keywords: '',
        linked_product_ids: [],
        super_attribute_ids: [],
        custom_attributes: {}
    });

    const handleCancel = useCallback(() => {
        navigate('/admin/products');
    }, [navigate]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // Precedence 1: Don't close form if a global UI Modal is open
                if (document.body.style.overflow === 'hidden') return;

                // Precedence 2: Don't close if focusing on input/textarea/editor that might use ESC
                const active = document.activeElement;
                const isWriting = active && (
                    active.tagName === 'INPUT' || 
                    active.tagName === 'TEXTAREA' || 
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                );
                
                if (isWriting) return;

                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleCancel]);

    useEffect(() => {
        fetchCategories();
        fetchRelatedData();
        if (isEdit) {
            fetchProduct();
        }
    }, [id, isEdit]);
    useEffect(() => {
        return () => {
            // Cleanup object URLs to avoid memory leaks
            images.forEach(img => {
                if (img.image_url && img.image_url.startsWith('blob:')) {
                    URL.revokeObjectURL(img.image_url);
                }
            });
        };
    }, [images]);

    // Keyboard bindings for deletion of selected images
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const active = document.activeElement;
                if (active && (
                    active.tagName === 'INPUT' || 
                    active.tagName === 'TEXTAREA' || 
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                )) return;
                
                if (selectedImages.length > 0) {
                    handleDeleteSelectedImages();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedImages]); // Need selectedImages in deps

    // Global mouse lift to end drag select
    useEffect(() => {
        const handleMouseUp = () => setIsDragSelecting(false);
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, []);

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
                productApi.getAll({ per_page: 500 }), // Increased to check SKU uniqueness better
                attributeApi.getAll()
            ]);
            setAllProducts(prodRes.data.data);
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
                price: data.price ? Math.floor(data.price) : '',
                cost_price: data.cost_price ? Math.floor(data.cost_price) : '',
                weight: data.weight || '',
                description: data.description || '',
                is_featured: !!data.is_featured,
                is_new: !!data.is_new,
                stock_quantity: data.stock_quantity || 0,
                sku: data.sku || '',
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

    const handleAutoGenerateSKU = () => {
        if (!formData.name) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tên sản phẩm trước khi tạo mã tự động.', type: 'warning' });
            return;
        }

        let baseSku = generateSKUFromName(formData.name);
        let finalSku = baseSku;
        let counter = 1;

        // Ensure uniqueness against allProducts
        while (allProducts.some(p => p.sku === finalSku && (!id || p.id != id))) {
            const suffix = counter < 10 ? `0${counter}` : counter;
            finalSku = `${baseSku}-${suffix}`;
            counter++;
        }

        setFormData(prev => ({ ...prev, sku: finalSku }));
    };

    const moveImage = useCallback((dragIndex, hoverIndex) => {
        const newImages = [...images];
        const draggedImage = newImages[dragIndex];
        newImages.splice(dragIndex, 1);
        newImages.splice(hoverIndex, 0, draggedImage);
        
        // Auto update primary status: first image is primary
        const updatedImages = newImages.map((img, idx) => ({
            ...img,
            is_primary: idx === 0
        }));
        setImages(updatedImages);
    }, [images]);

    const handleImageUpload = async (e) => {
        const rawFiles = Array.from(e.target.files);
        if (rawFiles.length === 0) return;

        // Immediately add to list with skeleton/optimizing status
        const newPlaceholders = rawFiles.map((f, i) => ({
            id: `opt_${Date.now()}_${i}`,
            image_url: URL.createObjectURL(f),
            file: f,
            optimizing: true,
            is_primary: false
        }));
        setImages(prev => [...prev, ...newPlaceholders]);

        try {
            const processedImages = await Promise.all(newPlaceholders.map(async (placeholder) => {
                const optimizedFile = await compressImage(placeholder.file);
                return { ...placeholder, file: optimizedFile, optimizing: false };
            }));

            // Final check on primary
            const hasPrimary = images.some(img => img.is_primary);
            const finalImages = processedImages.map((img, i) => ({
                ...img,
                is_primary: !hasPrimary && i === 0 && images.length === 0
            }));

            if (!isEdit) {
                setImages(prev => {
                    const filtered = prev.filter(img => !img.id.toString().startsWith('opt_'));
                    return [...filtered, ...finalImages];
                });
            } else {
                const formDataToUpload = new FormData();
                finalImages.forEach(img => formDataToUpload.append('images[]', img.file));
                const response = await productImageApi.upload(id, formDataToUpload);
                
                setImages(prev => {
                    const filtered = prev.filter(img => !img.id.toString().startsWith('opt_'));
                    return [...filtered, ...response.data];
                });
            }
        } catch (error) {
            console.error("Lỗi tối ưu/tải ảnh:", error);
            alert("Lỗi tối ưu hoặc tải ảnh. Vui lòng thử lại.");
            setImages(prev => prev.filter(img => !img.id.toString().startsWith('opt_')));
        }
    };

    const handleSetPrimary = async (imgId) => {
        try {
            await productImageApi.setPrimary(imgId);
            setImages(images.map(img => ({ ...img, is_primary: img.id === imgId })));
        } catch (error) {
            alert("Lỗi cài đặt ảnh đại diện");
        }
    };

    const handleDeleteImage = async (imgId) => {
        setImages(prev => prev.filter(img => img.id !== imgId));
        setSelectedImages(prev => prev.filter(id => id !== imgId));
        
        if (imgId.toString().startsWith('temp_') || imgId.toString().startsWith('opt_')) return;
        try {
            await productImageApi.destroy(imgId);
        } catch (error) {
            console.error("Lỗi xoá ảnh", error);
        }
    };

    const toggleSelectImage = useCallback((id, forceSelect = false) => {
        setSelectedImages(prev => {
            if (forceSelect && !prev.includes(id)) return [...prev, id];
            if (prev.includes(id) && !forceSelect) return prev.filter(i => i !== id);
            if (!prev.includes(id)) return [...prev, id];
            return prev;
        });
    }, []);

    const handleDeleteSelectedImages = useCallback(() => {
        if (selectedImages.length === 0) return;
        const toDelete = [...selectedImages];
        setSelectedImages([]); // clear
        setImages(prev => prev.filter(img => !toDelete.includes(img.id)));

        toDelete.forEach(async (id) => {
            if (id.toString().startsWith('temp_') || id.toString().startsWith('opt_')) return;
            try {
                await productImageApi.destroy(id);
            } catch(e) { console.error("Lỗi xóa ảnh nhiều", e) }
        });
    }, [selectedImages]);

    const handleCustomAttributeChange = (attrId, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: { ...prev.custom_attributes, [attrId]: value }
        }));
    };

    const handleAIGenerate = async () => {
        if (!formData.name) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tên Sản Phẩm để AI có cơ sở viết mô tả.', type: 'warning' });
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

            setFormData(prev => ({ ...prev, description: response.data.description }));
        } catch (error) {
            showModal({ title: 'Lỗi AI', content: 'Không thể kết nối AI lúc này. Vui lòng thử lại sau.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    const renderAttributeField = (attr) => {
        const value = formData.custom_attributes[attr.id] || (attr.frontend_type === 'multiselect' ? [] : '');
        const commonClass = "w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary text-[14px] font-bold min-h-[32px]";

        switch (attr.frontend_type) {
            case 'textarea':
                return <textarea className={`${commonClass} resize-none pt-2`} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} rows="3" />;
            case 'select':
                return (
                    <div className="w-full flex items-center justify-between">
                        <select className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)}>
                            <option value="">-- Chọn {attr.name} --</option>
                            {(attr.options || []).map(opt => <option key={opt.id} value={opt.value}>{opt.value}</option>)}
                        </select>
                        {attr.swatch_type === 'color' && value && (
                            <div 
                                className="size-4 rounded-full border border-gold/20 shrink-0 ml-2"
                                style={{ backgroundColor: (attr.options?.find(o => o.value === value))?.swatch_value || 'transparent' }}
                            ></div>
                        )}
                    </div>
                );
            case 'multiselect': {
                const selected = Array.isArray(value) ? value : [];
                return (
                    <div className="py-2 w-full space-y-1 max-h-32 overflow-auto text-[14px]">
                        {(attr.options || []).map(opt => (
                            <label key={opt.id} className="flex items-center gap-2 cursor-pointer font-bold text-stone/70 hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(opt.value)}
                                    onChange={(e) => {
                                        const newVal = e.target.checked ? [...selected, opt.value] : selected.filter(v => v !== opt.value);
                                        handleCustomAttributeChange(attr.id, newVal);
                                    }}
                                    className="size-4 text-primary border-stone/30 rounded-sm"
                                />
                                {opt.value}
                            </label>
                        ))}
                    </div>
                );
            }
            case 'boolean':
                return (
                    <div className="flex gap-4 py-2">
                        <label className="flex items-center gap-2 cursor-pointer text-[14px] font-bold text-stone tracking-tighter">
                            <input type="radio" checked={value === '1' || value === 1 || value === true} onChange={() => handleCustomAttributeChange(attr.id, 1)} className="accent-primary" /> Có
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-[14px] font-bold text-stone tracking-tighter">
                            <input type="radio" checked={value === '0' || value === 0 || value === false} onChange={() => handleCustomAttributeChange(attr.id, 0)} className="accent-primary" /> Không
                        </label>
                    </div>
                );
            case 'date':
                return <input type="date" className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
            case 'price':
                return <input type="number" className={`${commonClass} text-brick`} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
            default:
                return <input type="text" className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handlePriceInputChange = (e, field) => {
        const raw = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, [field]: raw }));
    };

    const handleWeightInputChange = (e) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, weight: raw }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            let productId = id;
            if (isEdit) {
                await productApi.update(id, formData);
            } else {
                // For new product, send file objects if any
                const storeData = new FormData();
                Object.entries(formData).forEach(([key, val]) => {
                    if (key === 'custom_attributes') {
                        Object.entries(val).forEach(([attrId, attrVal]) => {
                            if (Array.isArray(attrVal)) {
                                attrVal.forEach(av => storeData.append(`custom_attributes[${attrId}][]`, av));
                            } else {
                                storeData.append(`custom_attributes[${attrId}]`, attrVal);
                            }
                        });
                    } else if (Array.isArray(val)) {
                        val.forEach(v => storeData.append(`${key}[]`, v));
                    } else {
                        storeData.append(key, val);
                    }
                });
                
                // Add pending images
                images.forEach(img => {
                    if (img.file) storeData.append('images[]', img.file);
                });

                const response = await productApi.store(storeData);
                productId = response.data.id;
            }

            // Sync image order if edited or newly created with multiple images
            const realImageIds = images.filter(img => !img.id.toString().startsWith('temp_')).map(img => img.id);
            if (realImageIds.length > 1) {
                await productImageApi.reorder(realImageIds);
            }

            navigate('/admin/products');
        } catch (error) {
            showModal({ title: 'Lỗi', content: error.response?.data?.message || 'Vui lòng kiểm tra lại thông tin.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    // handleCancel handles navigation directly without confirm for a faster experience

    const TYPE_INFO = {
        simple: { label: 'Sản phẩm đơn', icon: 'inventory_2', desc: 'Không có biến thể. VD: Bình gốm cụ thể.' },
        configurable: { label: 'Có biến thể', icon: 'settings_input_component', desc: 'Biến thể theo màu men, nghệ nhân...' },
        grouped: { label: 'Nhóm sản phẩm', icon: 'group_work', desc: 'Nhóm nhiều sản phẩm đơn lại.' },
        bundle: { label: 'Bộ / Combo', icon: 'inventory', desc: 'Combo sản phẩm linh hoạt.' },
        virtual: { label: 'Dịch vụ', icon: 'cloud', desc: 'Phi vật thể, không cần vận chuyển.' },
    };

    if (!isEdit && !typeConfirmed) {
        return (
            <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
                <div className="flex-none bg-[#fcfcfa] pb-8 border-b border-gold/10">
                    <div className="max-w-[1200px] mx-auto flex items-center gap-6">
                        <button 
                            onClick={() => navigate('/admin/products')} 
                            className="size-12 rounded-full border border-gold/20 flex items-center justify-center text-primary hover:bg-gold/10 transition-all group shadow-sm"
                        >
                            <span className="material-symbols-outlined text-[24px] group-hover:-translate-x-1 transition-transform">west</span>
                        </button>
                        <div>
                            <h2 className="text-3xl font-display font-bold text-primary italic uppercase tracking-wider leading-none mb-1">Kiến Tạo Tác Phẩm</h2>
                            <p className="text-[11px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Lựa chọn loại hình sản phẩm để bắt đầu định danh di sản</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar flex items-center justify-center py-12">
                    <div className="max-w-[1200px] w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 px-4">
                        {Object.entries(TYPE_INFO).map(([key, info]) => (
                            <button 
                                key={key} 
                                onClick={() => { setFormData(prev => ({ ...prev, type: key })); setTypeConfirmed(true); }} 
                                className={`text-left p-10 border transition-all hover:shadow-premium group relative overflow-hidden flex flex-col h-full rounded-sm ${formData.type === key ? 'border-primary bg-primary/[0.03] shadow-premium ring-1 ring-primary/20' : 'border-gold/10 bg-white hover:border-primary/40'}`}
                            >
                                <div className="flex items-center gap-4 mb-6 relative z-10">
                                    <div className={`size-14 rounded-full flex items-center justify-center transition-all duration-500 ${formData.type === key ? 'bg-primary text-white scale-110 shadow-lg shadow-primary/20' : 'bg-stone/5 text-primary group-hover:bg-primary/10'}`}>
                                        <span className="material-symbols-outlined text-3xl">{info.icon}</span>
                                    </div>
                                    <h3 className="text-[18px] font-display font-bold text-primary uppercase tracking-tight">{info.label}</h3>
                                </div>
                                <p className="text-stone font-body text-[14px] leading-relaxed opacity-70 mb-8 flex-1 relative z-10">{info.desc}</p>
                                <div className="flex justify-end relative z-10">
                                    <span className={`material-symbols-outlined text-[20px] transition-all duration-300 ${formData.type === key ? 'text-primary' : 'text-stone/20 group-hover:text-primary group-hover:translate-x-1'}`}>arrow_forward</span>
                                </div>
                                <div className={`absolute -right-4 -bottom-4 size-24 border-8 rounded-full transition-all duration-700 opacity-5 ${formData.type === key ? 'border-primary scale-150' : 'border-transparent group-hover:border-primary/20 group-hover:scale-125'}`}></div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
            <style>
                {`
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
                `}
            </style>

            {/* Header Area */}
            <div className="flex-none bg-[#fcfcfa] pb-6 border-b border-gold/10">
                <div className="max-w-[1800px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <button 
                            type="button" 
                            onClick={handleCancel}
                            className="size-10 rounded-full border border-stone/10 flex items-center justify-center text-stone hover:text-brick hover:border-brick/20 bg-white shadow-sm transition-all group"
                            title="Hủy & Thoát"
                        >
                            <span className="material-symbols-outlined text-xl group-hover:-translate-x-0.5 transition-transform">west</span>
                        </button>
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider leading-none mb-1">
                                {isEdit ? 'Biên Tập Tác Phẩm' : 'Khởi Tạo Tác Phẩm Mới'}
                            </h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">
                                {formData.sku ? `SKU: ${formData.sku}` : 'Cấu hình thông tin di sản và thương mại'}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex gap-3 w-full md:w-auto">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="flex-1 md:flex-none px-8 py-2.5 bg-white border border-stone/20 text-stone text-[11px] font-bold uppercase tracking-widest hover:bg-stone/5 transition-all rounded-sm"
                        >
                            Hủy
                        </button>
                        <button
                            form="product-form"
                            type="submit"
                            disabled={loading}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-primary text-white px-10 py-2.5 rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-umber transition-all disabled:opacity-50 shadow-premium-sm"
                        >
                            {loading && <span className="material-symbols-outlined text-sm animate-spin">refresh</span>}
                            {isEdit ? 'Lưu cập nhật' : 'Khởi tạo ngay'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Scrollable Form Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pt-8 pb-12">
                <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-[1800px] mx-auto px-1">
                    <div className="lg:col-span-8 space-y-5">
                        {/* Basic Info */}
                        <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="shopping_bag" title="Thông tin cơ bản" />
                            
                            <div className="grid grid-cols-1 gap-2">
                                <Field label="Tên sản phẩm">
                                    <input 
                                        name="name" 
                                        value={formData.name} 
                                        onChange={handleChange} 
                                        required 
                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[18px] placeholder:text-stone/20"
                                        placeholder="Nhập tên nghệ thuật của tác phẩm..."
                                    />
                                </Field>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Field label="Mã sản phẩm (SKU)" className="group/sku">
                                        <input 
                                            name="sku" 
                                            value={formData.sku} 
                                            onChange={handleChange} 
                                            placeholder="GỐM-VH-001"
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-gold font-bold tracking-widest text-[14px]"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAutoGenerateSKU}
                                            title="Tự động tạo mã thông minh"
                                            className="size-7 flex items-center justify-center bg-stone/5 rounded-full text-stone/40 hover:bg-primary hover:text-white transition-all transform hover:scale-110 shrink-0"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">magic_button</span>
                                        </button>
                                    </Field>
                                    <Field label="Danh mục gốm sứ">
                                        <select 
                                            name="category_id" 
                                            value={formData.category_id} 
                                            onChange={handleChange} 
                                            required
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                        >
                                            <option value="">-- Chọn danh mục --</option>
                                            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                        </select>
                                    </Field>
                                </div>
                            </div>
                        </div>

                        {/* Pricing & Details */}
                        <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="payments" title="Giá và thông số" />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                <Field label="Giá bán lẻ (VNĐ)" className="border-brick/30 bg-brick/[0.02]">
                                    <div className="flex items-center w-full">
                                        <input 
                                            type="text" 
                                            name="price" 
                                            value={formatNumberOutput(formData.price)} 
                                            onChange={(e) => handlePriceInputChange(e, 'price')} 
                                            required 
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-brick font-black text-[16px]"
                                        />
                                        <span className="font-bold text-brick opacity-40 ml-2">₫</span>
                                    </div>
                                </Field>
                                <Field label="Giá nhập (Đối nội)" className="border-primary/20 bg-stone/5">
                                    <div className="flex items-center w-full">
                                        <input 
                                            type="text" 
                                            name="cost_price" 
                                            value={formatNumberOutput(formData.cost_price)} 
                                            onChange={(e) => handlePriceInputChange(e, 'cost_price')} 
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]" 
                                        />
                                        <span className="font-bold text-primary opacity-30 ml-2">₫</span>
                                    </div>
                                </Field>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                <Field label="Khối lượng (gam)">
                                    <input type="text" name="weight" value={formData.weight} onChange={handleWeightInputChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-indigo-700 font-bold text-[15px]" placeholder="VD: 500" />
                                </Field>
                                <Field label="Tồn kho (Stock)">
                                    <input type="number" name="stock_quantity" value={formData.stock_quantity} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-indigo-700 font-bold text-[15px]" />
                                </Field>
                            </div>
                        </div>

                        {/* Images Management */}
                        <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                            <div className="flex justify-between items-center mb-5 border-b border-gold/10 pb-3">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary/40 p-2 bg-stone/5 rounded-full text-lg">photo_library</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary italic uppercase tracking-tight">Thư viện hình ảnh</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedImages.length > 0 && (
                                        <button 
                                            type="button" 
                                            onClick={handleDeleteSelectedImages}
                                            className="flex items-center gap-2 bg-brick text-white px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-widest hover:bg-umber transition-all shadow-premium-sm"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                            Xoá {selectedImages.length} ảnh
                                        </button>
                                    )}
                                    <label className="cursor-pointer bg-primary text-white px-4 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-widest hover:bg-gold transition-all shadow-premium-sm flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                                        Tải ảnh lên
                                        <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                                    </label>
                                </div>
                            </div>
                            
                            <DndProvider backend={HTML5Backend}>
                                <div 
                                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 min-h-[160px] p-2 bg-stone/5 border-2 border-dashed border-gold/10 rounded-sm"
                                    onMouseDown={(e) => {
                                        if (e.target.closest('.image-item-card') || e.target.closest('button') || e.target.closest('input')) return;
                                        setSelectedImages([]);
                                        setIsDragSelecting(true);
                                    }}
                                >
                                    {images.map((img, index) => (
                                        <DraggableImage 
                                            key={img.id} 
                                            img={img} 
                                            index={index} 
                                            moveImage={moveImage} 
                                            handleSetPrimary={handleSetPrimary} 
                                            handleDeleteImage={handleDeleteImage}
                                            isSelected={selectedImages.includes(img.id)}
                                            toggleSelectImage={toggleSelectImage}
                                            isDragSelecting={isDragSelecting}
                                        />
                                    ))}
                                    {images.length === 0 && (
                                        <div className="col-span-full flex flex-col items-center justify-center py-12 text-stone/30">
                                            <span className="material-symbols-outlined text-5xl mb-2">collections</span>
                                            <p className="font-bold italic text-sm">Chưa có hình ảnh nào cho tác phẩm này</p>
                                        </div>
                                    )}
                                </div>
                            </DndProvider>
                        </div>

                        {/* Description */}
                        <div className="bg-white border border-gold/10 shadow-premium-sm rounded-sm overflow-hidden">
                            <div className="flex justify-between items-center p-6 border-b border-gold/10">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary/40 p-2 bg-stone/5 rounded-full text-lg">description</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary italic uppercase tracking-tight">Câu chuyện tác phẩm</h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAIGenerate}
                                    disabled={aiGenerating}
                                    className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all ${aiGenerating ? 'opacity-50' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                >
                                    <span className={`material-symbols-outlined text-[16px] ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                    {aiGenerating ? 'AI đang sáng tác...' : 'AI Viết mô tả'}
                                </button>
                            </div>
                            <div className="p-1 min-h-[400px]">
                                <ReactQuill 
                                    theme="snow" 
                                    value={formData.description} 
                                    onChange={(content) => setFormData(prev => ({ ...prev, description: content }))}
                                    className="h-[400px] mb-12 border-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-4 space-y-5">
                        {/* Status & Options */}
                        <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="toggle_on" title="Trạng thái hiển thị" />
                            <div className="space-y-4">
                                <label className="flex items-center justify-between p-3 bg-stone/5 border border-stone/10 rounded-sm cursor-pointer hover:bg-stone/10 transition-all">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-primary">star</span>
                                        <span className="font-bold text-[13px] text-primary">Tác phẩm nổi bật</span>
                                    </div>
                                    <input type="checkbox" name="is_featured" checked={formData.is_featured} onChange={handleChange} className="size-5 accent-primary" />
                                </label>
                                <label className="flex items-center justify-between p-3 bg-stone/5 border border-stone/10 rounded-sm cursor-pointer hover:bg-stone/10 transition-all">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-primary">new_releases</span>
                                        <span className="font-bold text-[13px] text-primary">Tác phẩm mới ra lò</span>
                                    </div>
                                    <input type="checkbox" name="is_new" checked={formData.is_new} onChange={handleChange} className="size-5 accent-primary" />
                                </label>
                            </div>
                        </div>

                        {/* Custom Attributes */}
                        {allAttributes.filter(a => a.entity_type === 'product').length > 0 && (
                            <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                                <SectionTitle icon="fingerprint" title="Thuộc tính nghệ thuật" />
                                <div className="space-y-1">
                                    {allAttributes.filter(a => a.entity_type === 'product').map(attr => (
                                        <Field key={attr.id} label={attr.name}>
                                            {renderAttributeField(attr)}
                                        </Field>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Related Products */}
                        <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="link" title="Đề xuất liên quan" />
                            <div className="space-y-4">
                                <label className="text-[11px] font-black uppercase tracking-widest text-stone/50 mb-2 block">Gợi ý tác phẩm cùng bộ sưu tập</label>
                                <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2 pr-1">
                                    {allProducts.filter(p => p.id != id).map(prod => (
                                        <label key={prod.id} className="flex items-center gap-3 p-2 bg-stone/5 border border-transparent rounded-sm cursor-pointer hover:bg-gold/5 hover:border-gold/20 transition-all">
                                            <input
                                                type="checkbox"
                                                checked={formData.linked_product_ids.includes(prod.id)}
                                                onChange={(e) => {
                                                    const newVal = e.target.checked 
                                                        ? [...formData.linked_product_ids, prod.id]
                                                        : formData.linked_product_ids.filter(id => id !== prod.id);
                                                    setFormData(prev => ({ ...prev, linked_product_ids: newVal }));
                                                }}
                                                className="size-4 accent-primary"
                                            />
                                            <div className="size-10 bg-white border border-stone/10 p-0.5 rounded shadow-sm">
                                                <img src={prod.thumbnail || 'https://via.placeholder.com/100'} className="w-full h-full object-cover" alt="" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] font-bold text-primary truncate">{prod.name}</p>
                                                <p className="text-[9px] font-black text-gold uppercase">{prod.sku}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* SEO Tools */}
                        <div className="bg-white border border-gold/10 p-6 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="search" title="Tối ưu tìm kiếm (SEO)" />
                            <div className="space-y-1">
                                <Field label="Meta Title">
                                    <input name="meta_title" value={formData.meta_title} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[13px]" placeholder="Tiêu đề hiển thị trên Google..." />
                                </Field>
                                <Field label="Meta Description" className="min-h-[80px]">
                                    <textarea name="meta_description" value={formData.meta_description} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary text-[13px] pt-3 resize-none h-[80px]" placeholder="Mô tả tóm tắt nội dung..." />
                                </Field>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProductForm;
