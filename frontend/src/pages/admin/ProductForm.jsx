import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
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
            const hoverMiddleX = (hoverBoundingRect.right - hoverBoundingRect.left) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientX = clientOffset.x - hoverBoundingRect.left;
            if (dragIndex < hoverIndex && hoverClientX < hoverMiddleX) return;
            if (dragIndex > hoverIndex && hoverClientX > hoverMiddleX) return;
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
            className={`group bg-white border rounded shadow-sm overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md image-item-card cursor-pointer select-none relative shrink-0 w-[calc(100%/8-12px)] min-w-[120px] ${isSelected ? 'ring-2 ring-gold border-gold bg-gold/5' : img.is_primary ? 'border-primary ring-1 ring-primary/20 bg-primary/[0.02]' : 'border-stone/15 hover:border-primary/40'} ${isDragging ? 'opacity-30 scale-95' : 'opacity-100'}`}
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
                <img src={img.image_url || null} alt={fileName} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />

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
            <div className="flex-1 flex flex-col justify-center px-2 py-1.5 border-t border-stone/10 bg-white text-center cursor-move">
                <p className="text-[10px] font-bold text-primary truncate w-full mb-0.5" title={fileName}>
                    {fileName}
                </p>
                <div className="flex items-center justify-center">
                    {img.optimizing ? (
                        <span className="text-[9px] italic text-gold animate-pulse">Đang nén...</span>
                    ) : (
                        <span className="text-[9px] font-bold text-stone/40 bg-stone/5 px-1.5 py-0.5 rounded border border-stone/10 font-mono tracking-tight">
                            {fileSize ? formatBytes(fileSize) : '-- KB'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

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
    <div className={`relative border border-stone/30 rounded-sm px-3 focus-within:border-primary/30 transition-colors flex items-center min-h-[40px] bg-white ${className}`}>
        <label className={`absolute -top-3 left-2 bg-white px-1.5 font-sans text-[13px] font-bold text-orange-700 tracking-tight leading-none ${labelClassName}`}>
            {label}
        </label>
        <div className="w-full flex items-center pt-0.5 text-[14px]">
            {children}
        </div>
    </div>
);

const SectionTitle = ({ icon, title }) => (
    <div className="flex items-center gap-2.5 mb-6 border-b border-stone/10 pb-2">
        <span className="material-symbols-outlined text-primary/40 p-1.5 bg-stone/5 rounded-full text-base">{icon}</span>
        <h3 className="font-sans text-[15px] font-bold text-primary uppercase tracking-tight">{title}</h3>
    </div>
);

const ProductForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const isDuplicate = queryParams.get('mode') === 'duplicate';

    const { showModal, showToast } = useUI();
    const [isSaving, setIsSaving] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiRewriting, setAiRewriting] = useState(false);
    const [typeConfirmed, setTypeConfirmed] = useState(true);
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
        category_ids: [],
        price: '',
        cost_price: '',
        weight: '',
        description: '',
        specifications: '',
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

    const [variants, setVariants] = useState([]);
    const [selectedSuperAttributes, setSelectedSuperAttributes] = useState([]);
    const [showVariantConfig, setShowVariantConfig] = useState(false);
    const [refreshingAttributes, setRefreshingAttributes] = useState(false);

    // Filters for Related Products suggestions
    const [relatedQuery, setRelatedQuery] = useState('');
    const [relatedCategory, setRelatedCategory] = useState('all');
    const [relatedAttrFilter, setRelatedAttrFilter] = useState({}); // { attr_id: value }

    const [variantTableWidths, setVariantTableWidths] = useState({
        image: 80,
        name: 320,
        sku: 200,
        price: 150,
        cost_price: 150,
        weight: 100,
        stock: 100,
        actions: 60
    });

    const handleVariantColumnResize = useCallback((colId, e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = variantTableWidths[colId];

        const onMouseMove = (moveEvent) => {
            const newWidth = Math.max(colId === 'actions' || colId === 'image' ? 40 : 60, startWidth + (moveEvent.clientX - startX));
            setVariantTableWidths(prev => ({ ...prev, [colId]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [variantTableWidths]);

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
                attributeApi.getAll({ active_only: true })
            ]);
            setAllProducts(prodRes.data.data);
            setAllAttributes(attrRes.data || []);
        } catch (error) {
            console.error("Error fetching related data", error);
        }
    };

    const handleRefreshAttributes = async () => {
        setRefreshingAttributes(true);
        try {
            const response = await attributeApi.getAll({ active_only: true });
            setAllAttributes(response.data || []);

            // Sync current selection if attributes were updated
            if (selectedSuperAttributes.length > 0) {
                setSelectedSuperAttributes(prev => {
                    return prev.map(selected => {
                        const updated = (response.data || []).find(a => a.id === selected.id);
                        return updated ? { ...updated, selected_values: selected.selected_values } : selected;
                    });
                });
            }
            showModal({ title: 'Thành công', content: 'Đã cập nhật danh sách thuộc tính mới nhất.', type: 'success', autoClose: 2000 });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể làm mới danh sách thuộc tính.', type: 'error' });
        } finally {
            setRefreshingAttributes(false);
        }
    };

    const filteredSuggestedProducts = useMemo(() => {
        return allProducts.filter(p => {
            // Exclude current product
            if (p.id == id) return false;

            // Search by name/SKU
            if (relatedQuery) {
                const q = removeAccents(relatedQuery.toLowerCase());
                const name = removeAccents(p.name.toLowerCase());
                const sku = removeAccents((p.sku || '').toLowerCase());
                if (!name.includes(q) && !sku.includes(q)) return false;
            }

            // Category filter
            if (relatedCategory !== 'all') {
                if (p.category_id != relatedCategory) {
                    // Also check additional categories
                    const inExtra = (p.categories || []).some(c => c.id == relatedCategory);
                    if (!inExtra) return false;
                }
            }

            // Attribute filter
            const hasAttrFilters = Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '');
            if (hasAttrFilters) {
                for (const [attrId, filterVal] of Object.entries(relatedAttrFilter)) {
                    if (filterVal === 'all' || filterVal === '') continue;

                    const pValue = (p.attribute_values || []).find(av => av.attribute_id == attrId);
                    if (!pValue || pValue.value != filterVal) return false;
                }
            }

            return true;
        });
    }, [allProducts, id, relatedQuery, relatedCategory, relatedAttrFilter]);

    const handleResetVariants = () => {
        setVariants([]);
        setSelectedSuperAttributes([]);
        setShowVariantConfig(true);
    };

    const handleAddManualVariant = () => {
        const newV = {
            id: `manual_${Date.now()}`,
            sku: `${formData.sku}-${variants.length + 1}`,
            price: formData.price,
            cost_price: formData.cost_price,
            weight: formData.weight,
            stock: 10,
            attributes: {},
            label: 'Biến thể tùy chỉnh'
        };
        setVariants(prev => [...prev, newV]);
    };

    const fetchProduct = async () => {
        try {
            const response = await productApi.getOne(id);
            const data = response.data;
            setFormData({
                type: data.type || 'simple',
                name: data.name,
                category_id: data.category_id || '',
                category_ids: data.categories ? data.categories.map(c => c.id) : [],
                price: data.price ? Math.floor(data.price) : '',
                cost_price: data.cost_price ? Math.floor(data.cost_price) : '',
                weight: data.weight || '',
                description: data.description || '',
                specifications: data.specifications || '',
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

            // Handle variants from linked_products with 'super_link' type
            const variantsData = (data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
            const regularLinks = (data.linked_products || []).filter(p => p.pivot?.link_type !== 'super_link');

            setFormData(prev => ({
                ...prev,
                linked_product_ids: regularLinks.map(p => p.id)
            }));

            if (variantsData.length > 0) {
                const loadedVariants = variantsData.map(v => {
                    const attrs = (v.attribute_values || []).reduce((acc, av) => {
                        acc[av.attribute_id] = av.value;
                        return acc;
                    }, {});
                    const primaryImage = v.images?.find(img => img.is_primary) || v.images?.[0];
                    return {
                        ...v,
                        price: Math.floor(v.price),
                        cost_price: Math.floor(v.cost_price || 0),
                        weight: v.weight || 0,
                        stock: v.stock_quantity,
                        attributes: attrs,
                        image_url: primaryImage ? primaryImage.image_url : null,
                        label: v.name || (v.attribute_values || []).map(av => av.value).join(' / ')
                    };
                });

                setVariants(loadedVariants);

                // Reconstruct selected values from variants
                const superAttrs = (data.super_attributes || []).map(sa => {
                    const uniqueVals = new Set();
                    loadedVariants.forEach(variant => {
                        if (variant.attributes[sa.id]) {
                            uniqueVals.add(variant.attributes[sa.id]);
                        }
                    });
                    return {
                        ...sa,
                        selected_values: Array.from(uniqueVals)
                    };
                });

                setSelectedSuperAttributes(superAttrs);
                setShowVariantConfig(true); // Tự động hiển thị danh sách biến thể / bảng cấu hình
            }
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
            } catch (e) { console.error("Lỗi xóa ảnh nhiều", e) }
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

    const handleAIRewrite = async () => {
        if (!formData.description || formData.description.trim() === '' || formData.description === '<p><br></p>') {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập định dạng thô hoặc copy nội dung vào khung mô tả trước khi yêu cầu AI viết lại.', type: 'warning' });
            return;
        }

        // Bóc tách hình ảnh (nhất là base64) ra thành placeholder để giảm siêu nhẹ payload gửi lên AI
        const extractedImages = [];
        let modifiedHtml = formData.description.replace(/<img[^>]*>/gi, (match) => {
            const placeholder = `__IMG_PLACEHOLDER_${extractedImages.length}__`;
            extractedImages.push({ placeholder, originalTag: match });
            return `<img src="${placeholder}" />`;
        });

        setAiRewriting(true);
        try {
            const response = await aiApi.rewriteProductDescription({
                content: modifiedHtml
            });

            let finalHtml = response.data.description;

            // Phục hồi lại toàn bộ thẻ hình ảnh gốc
            extractedImages.forEach(({ placeholder, originalTag }) => {
                // Thay thế thẻ hình ảnh placeholder mà AI có thể đã chỉnh sửa lại các thuộc tính khác (nếu có)
                finalHtml = finalHtml.replace(new RegExp(`<img[^>]+src="${placeholder}"[^>]*>`, 'gi'), originalTag);
                // Fallback: nếu bằng cách nào đó chỉ còn sót lại đoạn text placeholder
                finalHtml = finalHtml.replace(placeholder, originalTag);
            });

            setFormData(prev => ({ ...prev, description: finalHtml }));
        } catch (error) {
            console.error("Rewrite Error:", error.response?.data || error);
            const errMessage = error.response?.data?.message || 'Không thể kết nối AI (Có thể nội dung quá dài/quá tải). Vui lòng thử lại sau.';
            showModal({ title: 'Lỗi AI', content: errMessage, type: 'error' });
        } finally {
            setAiRewriting(false);
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

        if (name === 'type' && value === 'configurable' && variants.length === 0) {
            setShowVariantConfig(true);
        }
    };

    const handlePriceInputChange = (e, field) => {
        const raw = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, [field]: raw }));
    };

    const generateVariants = () => {
        if (selectedSuperAttributes.length === 0) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn ít nhất một thuộc tính để tạo biến thể.', type: 'warning' });
            return;
        }

        // Check if all selected attributes have values
        const invalidAttr = selectedSuperAttributes.find(attr => !attr.selected_values || attr.selected_values.length === 0);
        if (invalidAttr) {
            showModal({ title: 'Lưu ý', content: `Vui lòng chọn giá trị cho thuộc tính "${invalidAttr.name}".`, type: 'warning' });
            return;
        }

        // Cartesian product engine
        const combinations = selectedSuperAttributes.reduce((acc, attr) => {
            const results = [];
            attr.selected_values.forEach(val => {
                if (acc.length === 0) {
                    results.push({ [attr.id]: val });
                } else {
                    acc.forEach(prev => {
                        results.push({ ...prev, [attr.id]: val });
                    });
                }
            });
            return results;
        }, []);

        const newVariants = combinations.map((combo, index) => {
            const attrLabel = selectedSuperAttributes.map(attr => combo[attr.id]).join(' / ');
            return {
                id: `new_${Date.now()}_${index}`,
                sku: `${formData.sku}-${index + 1}`,
                price: formData.price,
                cost_price: formData.cost_price,
                weight: formData.weight,
                stock: 10,
                attributes: combo,
                label: `${formData.name} - ${attrLabel}`
            };
        });

        setVariants(newVariants);
        setShowVariantConfig(false);
    };

    const handleVariantChange = (index, field, value) => {
        const updated = [...variants];
        if (field === 'price' || field === 'stock' || field === 'cost_price' || field === 'weight') {
            value = value.toString().replace(/[^0-9]/g, '');
        }
        updated[index][field] = value;
        setVariants(updated);
    };

    const handleVariantImageUpload = (index, e) => {
        const file = e.target.files[0];
        if (!file) return;

        const updated = [...variants];
        updated[index].image_file = file;
        updated[index].image_url = URL.createObjectURL(file);
        updated[index].remove_image = false;
        setVariants(updated);
    };

    const handleRemoveVariantImage = (index) => {
        const updated = [...variants];
        updated[index].image_file = null;
        updated[index].image_url = null;
        updated[index].remove_image = true;
        setVariants(updated);
    };

    const removeVariant = (index) => {
        setVariants(variants.filter((_, i) => i !== index));
    };

    const handleWeightInputChange = (e) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, weight: raw }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const submitData = new FormData();

            // Build FormData from state
            Object.entries(formData).forEach(([key, val]) => {
                if (key === 'custom_attributes') {
                    Object.entries(val).forEach(([attrId, attrVal]) => {
                        if (Array.isArray(attrVal)) {
                            attrVal.forEach(av => submitData.append(`custom_attributes[${attrId}][]`, av));
                        } else {
                            submitData.append(`custom_attributes[${attrId}]`, attrVal);
                        }
                    });
                } else if (key === 'super_attribute_ids') {
                    selectedSuperAttributes.forEach(attr => submitData.append('super_attribute_ids[]', attr.id));
                } else if (key === 'linked_product_ids') {
                    val.forEach(v => submitData.append('linked_product_ids[]', v));
                } else if (Array.isArray(val)) {
                    val.forEach(v => submitData.append(`${key}[]`, v));
                } else if (typeof val === 'boolean') {
                    submitData.append(key, val ? '1' : '0');
                } else if (val !== '' && val !== null && val !== undefined) {
                    submitData.append(key, val);
                }
            });

            // Add variants if configurable
            if (formData.type === 'configurable') {
                variants.forEach((v, idx) => {
                    // If variant already has an ID, send it for update
                    if (v.id && !v.id.toString().startsWith('new_') && !v.id.toString().startsWith('manual_')) {
                        submitData.append(`variants[${idx}][id]`, v.id);
                    }
                    submitData.append(`variants[${idx}][sku]`, v.sku);
                    submitData.append(`variants[${idx}][name]`, v.label); // Send label as name
                    submitData.append(`variants[${idx}][price]`, v.price);
                    submitData.append(`variants[${idx}][cost_price]`, v.cost_price || '');
                    submitData.append(`variants[${idx}][weight]`, v.weight || '');
                    submitData.append(`variants[${idx}][stock_quantity]`, v.stock);

                    if (v.image_file) {
                        submitData.append(`variants[${idx}][image]`, v.image_file);
                    }
                    if (v.remove_image) {
                        submitData.append(`variants[${idx}][remove_image]`, 'true');
                    }

                    Object.entries(v.attributes).forEach(([attrId, attrVal]) => {
                        submitData.append(`variants[${idx}][attributes][${attrId}]`, attrVal);
                    });
                });
            }

            // Add images
            // 1. Existing image IDs to keep
            const existingImageIds = images.filter(img => !img.file).map(img => img.id);
            existingImageIds.forEach(id => submitData.append('existing_image_ids[]', id));

            // 2. New files to upload
            images.forEach(img => {
                if (img.file) submitData.append('images[]', img.file);
            });

            let response;
            if (isEdit) {
                // For updates, we use POST but can add method override if needed
                // productApi.update is already POST /api/products/:id
                response = await productApi.update(id, submitData);
            } else {
                response = await productApi.store(submitData);
            }

            const productId = response.data.id;

            // Sync image order if edited or newly created with multiple images
            const realImageIds = images.filter(img => !img.id.toString().startsWith('temp_')).map(img => img.id);
            if (realImageIds.length > 1) {
                await productImageApi.reorder(realImageIds);
            }

            showToast({ message: 'Sản phẩm đã được lưu thành công!', type: 'success' });
            navigate('/admin/products');
        } catch (error) {
            console.error("Save error:", error.response?.data);
            const data = error.response?.data;
            let message = data?.message || 'Vui lòng kiểm tra lại thông tin.';

            if (data?.errors) {
                const errorList = Object.values(data.errors).flat();
                if (errorList.length > 0) {
                    message = (
                        <div className="text-left">
                            <p className="font-bold mb-2">{data.message}</p>
                            <ul className="list-disc pl-4 space-y-1 text-[12px]">
                                {errorList.map((err, i) => <li key={i}>{err}</li>)}
                            </ul>
                        </div>
                    );
                }
            }

            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setIsSaving(false);
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

            {/* Premium Header - Sticky */}
            <div className="flex-none sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gold/10 px-6 py-3">
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
                                {isDuplicate ? 'Nhân bản sản phẩm' : (isEdit ? 'Chỉnh sửa sản phẩm' : 'Tạo sản phẩm mới')}
                            </h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">
                                {formData.sku ? `SKU: ${formData.sku}` : 'Cấu hình thông tin sản phẩm và thương mại'}
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
                            disabled={isSaving}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-primary text-white px-10 py-2.5 rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-umber transition-all disabled:opacity-50 shadow-premium-sm"
                        >
                            {isSaving && <span className="material-symbols-outlined text-sm animate-spin">refresh</span>}
                            {isDuplicate ? 'Lưu nhân bản' : (isEdit ? 'Lưu cập nhật' : 'Tạo ngay')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Scrollable Form Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pt-4 pb-12">
                <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-4 max-w-[1800px] mx-auto px-1">
                    <div className="lg:col-span-8 space-y-4">
                        {/* Basic Info */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="shopping_bag" title="Thông tin cơ bản" />

                            <div className="grid grid-cols-1 gap-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Field label="Tên sản phẩm">
                                        <input
                                            name="name"
                                            value={formData.name}
                                            onChange={handleChange}
                                            required
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[16px] placeholder:text-stone/20"
                                            placeholder="Nhập tên nghệ thuật của tác phẩm..."
                                        />
                                    </Field>

                                    <Field label="Loại sản phẩm">
                                        <select
                                            name="type"
                                            value={formData.type}
                                            onChange={handleChange}
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                        >
                                            {Object.entries(TYPE_INFO).map(([key, info]) => (
                                                <option key={key} value={key}>{info.label}</option>
                                            ))}
                                        </select>
                                    </Field>
                                </div>

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
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-black uppercase tracking-widest text-stone/50 ml-2">Danh mục chính & Phụ (Chọn nhiều)</label>
                                        <div className="border border-stone/30 rounded-sm p-3 bg-white max-h-[160px] overflow-y-auto custom-scrollbar">
                                            <div className="grid grid-cols-1 gap-2">
                                                {categories.map(cat => {
                                                    const isSelected = formData.category_ids.includes(cat.id);
                                                    const isPrimary = formData.category_id == cat.id;
                                                    return (
                                                        <div key={cat.id} className="flex items-center justify-between group/cat">
                                                            <label className="flex items-center gap-2 cursor-pointer text-[13px] font-bold text-primary flex-1">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={(e) => {
                                                                        const checked = e.target.checked;
                                                                        setFormData(prev => {
                                                                            let newIds = checked
                                                                                ? [...prev.category_ids, cat.id]
                                                                                : prev.category_ids.filter(id => id !== cat.id);

                                                                            // If unchecking the primary, pick the next available as primary
                                                                            let newPrimary = prev.category_id;
                                                                            if (!checked && isPrimary) {
                                                                                newPrimary = newIds.length > 0 ? newIds[0] : '';
                                                                            } else if (checked && !newPrimary) {
                                                                                newPrimary = cat.id;
                                                                            }

                                                                            return { ...prev, category_ids: newIds, category_id: newPrimary };
                                                                        });
                                                                    }}
                                                                    className="size-4 accent-primary rounded-sm transition-all"
                                                                />
                                                                <span className={isSelected ? 'text-primary' : 'text-stone/40'}>{cat.name}</span>
                                                            </label>
                                                            {isSelected && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setFormData({ ...formData, category_id: cat.id })}
                                                                    className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.1em] transition-all ${isPrimary ? 'bg-gold text-white shadow-sm' : 'bg-stone/5 text-stone/40 hover:bg-gold/10 hover:text-gold'}`}
                                                                >
                                                                    {isPrimary ? 'Danh mục chính' : 'Đặt làm chính'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {formData.category_ids.length === 0 && (
                                            <p className="text-[10px] text-brick font-bold ml-2 italic">* Vui lòng chọn ít nhất một danh mục</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Pricing & Details */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="payments" title="Giá và thông số" />
                            <div className="grid grid-cols-1 gap-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
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
                                    <Field label="Khối lượng sản phẩm" className="border-primary/20 bg-stone/5">
                                        <div className="flex items-center w-full">
                                            <input
                                                type="text"
                                                name="weight"
                                                value={formData.weight}
                                                onChange={handleWeightInputChange}
                                                placeholder="0"
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]"
                                            />
                                            <span className="font-bold text-primary opacity-30 ml-2 italic">gram</span>
                                        </div>
                                    </Field>
                                </div>

                                <Field label="Thông số chi tiết" className="min-h-[80px] items-start pt-3">
                                    <textarea
                                        name="specifications"
                                        value={formData.specifications}
                                        onChange={handleChange}
                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px] resize-none h-[80px]"
                                        placeholder="Nhập kích thước, chất liệu, xuất xứ..."
                                    />
                                </Field>
                            </div>
                        </div>

                        {/* Variant Management - Only for Configurable Products */}
                        {formData.type === 'configurable' && (
                            <div className="bg-white border border-purple-200 p-5 shadow-premium-sm rounded-sm">
                                <div className="flex justify-between items-center mb-6 border-b border-purple-100 pb-2">
                                    <div className="flex items-center gap-2.5">
                                        <span className="material-symbols-outlined text-purple-600/40 p-1.5 bg-purple-50 rounded-full text-base">account_tree</span>
                                        <h3 className="font-sans text-[15px] font-bold text-purple-900 uppercase tracking-tight">Quản lý biến thể</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {variants.length > 0 && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={handleAddManualVariant}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-purple-200 text-purple-600 rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm"
                                                    title="Thêm một biến thể mới thủ công"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">add_box</span>
                                                    Thêm biến thể
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleResetVariants}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-brick/20 text-brick rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-brick/5 transition-all shadow-sm"
                                                    title="Xóa toàn bộ biến thể để tạo lại"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                                                    Xóa hết & Reset
                                                </button>
                                            </>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleRefreshAttributes}
                                            disabled={refreshingAttributes}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-purple-200 text-purple-600 rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm disabled:opacity-50"
                                            title="Tải lại danh sách thuộc tính"
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${refreshingAttributes ? 'animate-spin' : ''}`}>sync</span>
                                            {refreshingAttributes ? 'Đang làm mới...' : 'Làm mới thuộc tính'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowVariantConfig(!showVariantConfig)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-purple-700 transition-all shadow-sm"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">{showVariantConfig ? 'close' : 'settings'}</span>
                                            {showVariantConfig ? 'Đóng cấu hình' : 'Cấu hình biến thể'}
                                        </button>
                                    </div>
                                </div>

                                {showVariantConfig && (
                                    <div className="mb-8 p-4 bg-purple-50/50 border border-purple-100 rounded-sm space-y-6 animate-fade-in">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-4">
                                                <label className="text-[11px] font-black uppercase tracking-widest text-purple-900/40">1. Chọn thuộc tính tạo biến thể</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {allAttributes.filter(a => a.frontend_type === 'select' || a.frontend_type === 'multiselect').map(attr => {
                                                        const isSelected = selectedSuperAttributes.some(sa => sa.id === attr.id);
                                                        return (
                                                            <button
                                                                key={attr.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (isSelected) {
                                                                        setSelectedSuperAttributes(prev => prev.filter(sa => sa.id !== attr.id));
                                                                    } else {
                                                                        setSelectedSuperAttributes(prev => [...prev, { ...attr, selected_values: [] }]);
                                                                    }
                                                                }}
                                                                className={`flex items-center gap-2 p-2 border rounded-sm text-[12px] font-bold transition-all ${isSelected ? 'bg-purple-600 border-purple-600 text-white shadow-md' : 'bg-white border-stone/20 text-stone hover:border-purple-300'}`}
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">{isSelected ? 'check_box' : 'check_box_outline_blank'}</span>
                                                                {attr.name}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <label className="text-[11px] font-black uppercase tracking-widest text-purple-900/40">2. Chọn giá trị cho từng thuộc tính</label>
                                                <div className="space-y-3">
                                                    {selectedSuperAttributes.length === 0 ? (
                                                        <p className="text-[12px] italic text-stone/40 py-4">Chưa chọn thuộc tính nào...</p>
                                                    ) : (
                                                        selectedSuperAttributes.map((attr, idx) => (
                                                            <div key={attr.id} className="p-3 bg-white border border-purple-100 rounded-sm shadow-sm">
                                                                <div className="flex justify-between items-center mb-2">
                                                                    <p className="text-[12px] font-black text-purple-900 uppercase m-0">{attr.name}</p>
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const updated = [...selectedSuperAttributes];
                                                                                updated[idx].selected_values = (attr.options || []).map(o => o.value);
                                                                                setSelectedSuperAttributes(updated);
                                                                            }}
                                                                            className="px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors"
                                                                        >
                                                                            Chọn tất cả
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const updated = [...selectedSuperAttributes];
                                                                                updated[idx].selected_values = [];
                                                                                setSelectedSuperAttributes(updated);
                                                                            }}
                                                                            className="px-2 py-0.5 text-[10px] font-bold bg-stone-100 text-stone-600 hover:bg-stone-200 rounded transition-colors"
                                                                        >
                                                                            Bỏ chọn tất cả
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {(attr.options || []).map(opt => {
                                                                        const isValSelected = attr.selected_values?.includes(opt.value);
                                                                        return (
                                                                            <button
                                                                                key={opt.id}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const updated = [...selectedSuperAttributes];
                                                                                    const vals = updated[idx].selected_values || [];
                                                                                    updated[idx].selected_values = isValSelected
                                                                                        ? vals.filter(v => v !== opt.value)
                                                                                        : [...vals, opt.value];
                                                                                    setSelectedSuperAttributes(updated);
                                                                                }}
                                                                                className={`px-3 py-1 text-[11px] font-bold rounded-full border transition-all ${isValSelected ? 'bg-purple-100 border-purple-400 text-purple-800' : 'bg-stone/5 border-transparent text-stone/60 hover:bg-stone/10'}`}
                                                                            >
                                                                                {opt.value}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-4 border-t border-purple-100">
                                            <button
                                                type="button"
                                                onClick={generateVariants}
                                                className="flex items-center gap-2 px-6 py-2 bg-purple-900 text-white rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
                                            >
                                                Tạo tổ hợp biến thể
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {variants.length > 0 ? (
                                    <div className="overflow-x-auto border border-stone/10 rounded-sm custom-scrollbar bg-white">
                                        <table className="w-full text-left border-collapse" style={{ tableLayout: 'fixed' }}>
                                            <thead>
                                                <tr className="bg-stone/5 text-[10px] font-black uppercase tracking-widest text-stone/50 border-b border-stone/10">
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.image }}>
                                                        Ảnh
                                                        <div onMouseDown={(e) => handleVariantColumnResize('image', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.name }}>
                                                        Tên & Phân loại
                                                        <div onMouseDown={(e) => handleVariantColumnResize('name', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.sku }}>
                                                        Mã SKU
                                                        <div onMouseDown={(e) => handleVariantColumnResize('sku', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.price }}>
                                                        Giá bán (VNĐ)
                                                        <div onMouseDown={(e) => handleVariantColumnResize('price', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.cost_price }}>
                                                        Giá nhập
                                                        <div onMouseDown={(e) => handleVariantColumnResize('cost_price', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.weight }}>
                                                        Khối lượng
                                                        <div onMouseDown={(e) => handleVariantColumnResize('weight', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.stock }}>
                                                        Kho hàng
                                                        <div onMouseDown={(e) => handleVariantColumnResize('stock', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3" style={{ width: variantTableWidths.actions }}></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-stone/20">
                                                {variants.map((v, index) => {
                                                    const parentPrimaryImage = images.find(img => img.is_primary) || images[0];
                                                    const displayImageUrl = v.image_url || parentPrimaryImage?.image_url;

                                                    return (
                                                        <tr key={v.id} className="hover:bg-purple-50/30 transition-colors">
                                                            <td className="px-3 py-2 border-r border-stone/20 text-center">
                                                                <div className="relative group/vimg mx-auto size-16 bg-white border border-stone/15 rounded flex items-center justify-center overflow-hidden shadow-sm">
                                                                    {displayImageUrl ? (
                                                                        <img src={displayImageUrl || 'https://placehold.co/100'} className="w-full h-full object-cover" alt="" />
                                                                    ) : (
                                                                        <span className="material-symbols-outlined text-stone/20 text-2xl">image</span>
                                                                    )}

                                                                    {/* Variant image actions overlay */}
                                                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/vimg:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                                                                        <label className="cursor-pointer text-white hover:text-gold transition-colors">
                                                                            <span className="material-symbols-outlined text-[18px]">{v.image_url ? 'edit' : 'add_a_photo'}</span>
                                                                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleVariantImageUpload(index, e)} />
                                                                        </label>
                                                                        {v.image_url && (
                                                                            <button type="button" onClick={() => handleRemoveVariantImage(index)} className="text-white hover:text-brick transition-colors">
                                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    {/* Badge if inheriting from parent */}
                                                                    {!v.image_url && parentPrimaryImage && (
                                                                        <div className="absolute bottom-0 right-0 left-0 bg-gold/90 text-white text-[8px] py-0.5 font-bold uppercase tracking-tighter text-center">Kế thừa cha</div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative group/vname">
                                                                    <textarea
                                                                        rows={1}
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white px-2 py-1.5 rounded text-[12px] font-bold text-primary text-center transition-all resize-none overflow-hidden min-h-[32px] custom-scrollbar h-auto"
                                                                        value={v.label}
                                                                        onChange={(e) => {
                                                                            handleVariantChange(index, 'label', e.target.value);
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onFocus={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onBlur={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                        }}
                                                                        placeholder="Tên biến thể"
                                                                    />
                                                                    {v.label && v.label.length > 30 && (
                                                                        <div className="absolute invisible group-hover/vname:visible z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[300px] bg-primary text-white text-[11px] p-2.5 rounded shadow-2xl pointer-events-none animate-fade-in border border-white/10">
                                                                            <p className="font-bold border-b border-white/20 pb-1 mb-1 opacity-60 uppercase text-[9px]">Xem đầy đủ tên:</p>
                                                                            {v.label}
                                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-primary"></div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative group/vsku">
                                                                    <textarea
                                                                        rows={1}
                                                                        className="w-full bg-[#f4f6f8] border border-transparent focus:border-purple-300 focus:bg-white px-2 py-1.5 rounded text-[12px] font-mono font-bold text-stone-600 text-center transition-all resize-none shadow-inner overflow-hidden min-h-[32px] flex items-center justify-center leading-[32px]"
                                                                        value={v.sku}
                                                                        onChange={(e) => {
                                                                            handleVariantChange(index, 'sku', e.target.value);
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onFocus={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onBlur={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                        }}
                                                                    />
                                                                    {v.sku && v.sku.length > 20 && (
                                                                        <div className="absolute invisible group-hover/vsku:visible z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[250px] bg-gold text-white text-[11px] p-2.5 rounded shadow-2xl pointer-events-none animate-fade-in border border-white/10 translate-y-[-5px]">
                                                                            <p className="font-bold border-b border-white/20 pb-1 mb-1 opacity-80 uppercase text-[9px]">Mã SKU đầy đủ:</p>
                                                                            <span className="font-mono">{v.sku}</span>
                                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gold"></div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-[#fcf8f0] border border-transparent focus:border-brick/50 focus:bg-white pl-2 pr-5 py-2 rounded text-[13px] font-black text-brick text-center transition-all"
                                                                        value={formatNumberOutput(v.price)}
                                                                        onChange={(e) => handleVariantChange(index, 'price', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-brick/40 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-primary/50 focus:bg-white pl-2 pr-5 py-2 rounded text-[13px] font-bold text-primary text-center transition-all"
                                                                        value={formatNumberOutput(v.cost_price)}
                                                                        onChange={(e) => handleVariantChange(index, 'cost_price', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-primary/30 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white pl-2 pr-8 py-1 rounded text-[13px] font-bold text-primary text-center"
                                                                        value={v.weight}
                                                                        onChange={(e) => handleVariantChange(index, 'weight', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[9px] opacity-30 font-bold italic">gram</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="flex items-center justify-center">
                                                                    <input
                                                                        type="number"
                                                                        className="w-full bg-[#e0f2fe] border border-transparent focus:border-blue-400 focus:bg-white px-2 py-2 rounded text-[13px] font-black text-blue-700 text-center transition-all"
                                                                        value={v.stock}
                                                                        onChange={(e) => handleVariantChange(index, 'stock', e.target.value)}
                                                                    />
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeVariant(index)}
                                                                    className="text-stone/30 hover:text-brick transition-colors"
                                                                >
                                                                    <span className="material-symbols-outlined text-[20px]">delete</span>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 bg-stone/5 border-2 border-dashed border-purple-100 rounded-sm">
                                        <span className="material-symbols-outlined text-4xl text-purple-200 mb-3">account_tree</span>
                                        <p className="text-[13px] font-bold text-stone/40 italic">Chưa có biến thể nào được tạo...</p>
                                        <p className="text-[11px] text-stone/30 mt-1">Bấm "Cấu hình biến thể" để bắt đầu</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Images Management */}
                        <div className="bg-white border border-gold/10 p-4 shadow-premium-sm rounded-sm">
                            <div className="flex justify-between items-center mb-4 border-b border-gold/10 pb-2">
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
                                    className="flex flex-nowrap overflow-x-auto gap-3 min-h-[140px] p-3 bg-stone/5 border-2 border-dashed border-gold/10 rounded-sm items-start custom-scrollbar"
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
                            <div className="flex justify-between items-center p-4 border-b border-gold/10">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary/40 p-2 bg-stone/5 rounded-full text-lg">description</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary italic uppercase tracking-tight">Mô tả sản phẩm</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleAIRewrite}
                                        disabled={aiRewriting}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiRewriting ? 'opacity-50 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${aiRewriting ? 'animate-pulse' : ''}`}>edit_document</span>
                                        {aiRewriting ? 'AI đang viết lại...' : 'AI Viết lại'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAIGenerate}
                                        disabled={aiGenerating}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiGenerating ? 'opacity-50 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                        {aiGenerating ? 'AI đang tạo...' : 'AI Viết mới'}
                                    </button>
                                </div>
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

                    <div className="lg:col-span-4 space-y-4">
                        {/* Status & Options */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
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
                            <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                                <SectionTitle icon="fingerprint" title="Thuộc tính nghệ thuật" />
                                <div className="grid grid-cols-1 gap-y-10">
                                    {allAttributes.filter(a => a.entity_type === 'product').map(attr => (
                                        <Field key={attr.id} label={attr.name}>
                                            {renderAttributeField(attr)}
                                        </Field>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Related Products */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="link" title="Đề xuất liên quan" />
                            <div className="space-y-4">
                                {/* Search & Filters Area */}
                                <div className="space-y-3 p-3 bg-stone/5 border border-stone/10 rounded-sm">
                                    {/* Name & SKU Search */}
                                    <div className="relative">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-stone/40">search</span>
                                        <input
                                            type="text"
                                            placeholder="Tìm theo tên hoặc mã SKU..."
                                            value={relatedQuery}
                                            onChange={(e) => setRelatedQuery(e.target.value)}
                                            className="w-full bg-white border border-stone/20 rounded-sm pl-9 pr-3 py-2 text-[12px] font-bold text-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all shadow-sm"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        {/* Category Filter */}
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black uppercase text-stone/40 px-1">Danh mục</span>
                                            <select
                                                value={relatedCategory}
                                                onChange={(e) => setRelatedCategory(e.target.value)}
                                                className="w-full bg-white border border-stone/20 rounded-sm px-2 py-1.5 text-[11px] font-bold text-primary focus:outline-none"
                                            >
                                                <option value="all">Tất cả danh mục</option>
                                                {categories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* All Filterable Attributes */}
                                        {allAttributes.filter(a => a.is_filterable || a.is_filterable_backend).map(attr => (
                                            <div key={attr.id} className="space-y-1">
                                                <span className="text-[9px] font-black uppercase text-stone/40 px-1">{attr.name}</span>
                                                <select
                                                    value={relatedAttrFilter[attr.id] || 'all'}
                                                    onChange={(e) => setRelatedAttrFilter(prev => ({ ...prev, [attr.id]: e.target.value }))}
                                                    className="w-full bg-white border border-stone/20 rounded-sm px-2 py-1.5 text-[11px] font-bold text-primary focus:outline-none"
                                                >
                                                    <option value="all">Tất cả {attr.name}</option>
                                                    {(attr.options || []).map(opt => (
                                                        <option key={opt.id} value={opt.value}>{opt.value}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2 pr-1 border-t border-stone/10 pt-4">
                                    <div className="flex justify-between items-center px-1 mb-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-stone/50">Kết quả ({filteredSuggestedProducts.length})</span>
                                        {Object.values(relatedAttrFilter).concat([relatedQuery, relatedCategory]).some(v => v !== 'all' && v !== '') && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setRelatedQuery('');
                                                    setRelatedCategory('all');
                                                    setRelatedAttrFilter({});
                                                }}
                                                className="text-[9px] font-bold text-brick hover:underline"
                                            >
                                                Xóa lọc
                                            </button>
                                        )}
                                    </div>

                                    {filteredSuggestedProducts.length > 0 ? (
                                        filteredSuggestedProducts.map(prod => (
                                            <label key={prod.id} className={`flex items-center gap-3 p-2 border rounded-sm cursor-pointer transition-all ${formData.linked_product_ids.includes(prod.id) ? 'bg-gold/10 border-gold/30 shadow-sm' : 'bg-white border-stone/10 hover:bg-gold/5 hover:border-gold/20'}`}>
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
                                                <div className="size-10 bg-white border border-stone/10 p-0.5 rounded shadow-sm overflow-hidden flex-shrink-0">
                                                    <img src={prod.images?.[0]?.image_url || 'https://placehold.co/100'} className="w-full h-full object-cover" alt="" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[12px] font-bold text-primary truncate leading-tight">{prod.name}</p>
                                                    <p className="text-[9px] font-black text-gold uppercase mt-0.5">{prod.sku}</p>
                                                </div>
                                            </label>
                                        ))
                                    ) : (
                                        <div className="py-8 text-center text-stone/30 italic text-[11px]">
                                            <span className="material-symbols-outlined block text-[24px] mb-1">sentiment_dissatisfied</span>
                                            Không tìm thấy sản phẩm phù hợp...
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* SEO Tools */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="search" title="Tối ưu tìm kiếm (SEO)" />
                            <div className="grid grid-cols-1 gap-y-10">
                                <Field label="Meta Title">
                                    <input name="meta_title" value={formData.meta_title} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[13px]" placeholder="Tiêu đề hiển thị trên Google..." />
                                </Field>
                                <Field label="Meta Description" className="min-h-[80px] items-start pt-3">
                                    <textarea name="meta_description" value={formData.meta_description} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary text-[13px] resize-none h-[80px]" placeholder="Mô tả tóm tắt nội dung..." />
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
