import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { productApi, categoryApi, attributeApi, productImageApi, aiApi, blogApi, mediaApi, cmsApi, inventoryApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import ReactQuill from 'react-quill-new';
import mammoth from 'mammoth';
import 'react-quill-new/dist/quill.snow.css';
import ImageResize from 'quill-image-resize-module-react';

ReactQuill.Quill.register('modules/imageResize', ImageResize);
window.Quill = ReactQuill.Quill;
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { compressImage, formatBytes } from '../../utils/imageUtils';

const ItemType = {
    IMAGE: 'image',
    BUNDLE_ITEM: 'bundle_item',
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

const DraggableBundleItem = ({ 
    index, 
    optionId, 
    item, 
    moveBundleItem, 
    handleSetDefaultInOption, 
    handleUpdateBundleItemVariant, 
    bundleItemVariants, 
    handleUpdateBundleItemQty, 
    handleRemoveItemFromOption, 
    formatNumberOutput,
    isSortingMode 
}) => {
    const ref = useRef(null);
    const { showToast } = useUI();
    const [, drop] = useDrop({
        accept: `bundle_item_${optionId}`,
        hover(draggedItem, monitor) {
            if (!ref.current) return;
            const dragIndex = draggedItem.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;
            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;
            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;
            moveBundleItem(optionId, dragIndex, hoverIndex);
            draggedItem.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag({
        type: `bundle_item_${optionId}`,
        item: () => ({ id: item.id, index, optionId }),
        canDrag: isSortingMode,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    drag(drop(ref));

    return (
        <tr 
            ref={ref}
            className={`border-b border-stone/5 transition-colors group/row ${isDragging ? 'opacity-30 bg-gold/5' : 'hover:bg-gold/[0.02]'} ${isSortingMode ? 'cursor-move' : ''}`}
        >
            <td className="pl-5 py-3 text-center border-r border-gold/10">
                {isSortingMode ? (
                    <div className="flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-stone/40 group-hover/row:text-gold transition-colors">reorder</span>
                        <span className="text-[11px] font-black text-primary bg-stone/5 w-6 h-6 flex items-center justify-center rounded-full border border-stone/10">
                            {index + 1}
                        </span>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => handleSetDefaultInOption(optionId, item.id)}
                        className={`size-6 mx-auto rounded-full flex items-center justify-center transition-all ${item.is_default ? 'bg-primary text-white shadow-sm' : 'bg-stone/10 text-black/20 hover:bg-stone/20'}`}
                        title={item.is_default ? "Sản phẩm mặc định" : "Đặt làm mặc định"}
                    >
                        <span className="material-symbols-outlined text-[16px]">{item.is_default ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
                    </button>
                )}
            </td>
            <td className="px-3 py-3 border-r border-gold/10">
                <div className="flex items-center gap-3">
                    <img src={item.image_url || 'https://placehold.co/100'} alt="" className="size-10 object-cover rounded border border-stone/10 bg-white" />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <p className="text-[13px] font-bold text-black truncate" title={item.name}>{item.name}</p>
                            <button 
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(item.name);
                                    showToast('Đã sao chép tên sản phẩm', 'success');
                                }}
                                className="opacity-0 group-hover/row:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                title="Sao chép tên"
                            >
                                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                        </div>
                        <div className="flex items-center gap-1">
                            <p className="text-[10px] font-mono text-gold uppercase">{item.sku}</p>
                            <button 
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(item.sku);
                                    showToast('Đã sao chép mã sản phẩm', 'success');
                                }}
                                className="opacity-0 group-hover/row:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                title="Sao chép SKU"
                            >
                                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-3 py-3 border-r border-gold/10">
                {item.type === 'configurable' ? (
                    <select
                        value={item.variant_id || ''}
                        onChange={(e) => handleUpdateBundleItemVariant(optionId, item.id, e.target.value)}
                        className="w-full bg-stone/5 border border-stone/10 rounded px-2 py-1 text-[11px] font-bold text-black focus:outline-none focus:border-gold/30"
                    >
                        <option value="">Chọn biến thể...</option>
                        {(bundleItemVariants[item.id] || []).map(v => (
                            <option key={v.id} value={v.id}>{v.name || (v.attribute_values || []).map(av => av.value).join(' / ')}</option>
                        ))}
                    </select>
                ) : (
                    <span className="text-[11px] text-black/60 italic">Sản phẩm đơn</span>
                )}
            </td>
            <td className="px-3 py-3 text-center border-r border-gold/10">
                <p className="text-[12px] font-black text-black">{formatNumberOutput(item.price)}₫</p>
            </td>
            <td className="px-3 py-3 text-center border-r border-gold/10">
                <div className="flex items-center justify-center gap-1 bg-white border border-stone/10 rounded-full px-2 py-0.5 mx-auto w-fit">
                    <button
                        type="button"
                        onClick={() => handleUpdateBundleItemQty(optionId, item.id, Math.max(1, item.quantity - 1))}
                        className="material-symbols-outlined text-[16px] text-black/40 hover:text-brick"
                    >remove</button>
                    <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleUpdateBundleItemQty(optionId, item.id, e.target.value)}
                        className="w-8 text-center bg-transparent border-none p-0 text-[12px] font-black text-black focus:ring-0"
                    />
                    <button
                        type="button"
                        onClick={() => handleUpdateBundleItemQty(optionId, item.id, item.quantity + 1)}
                        className="material-symbols-outlined text-[16px] text-black/40 hover:text-primary"
                    >add</button>
                </div>
            </td>
            <td className="px-3 py-3 text-right">
                <button
                    type="button"
                    onClick={() => handleRemoveItemFromOption(optionId, item.id)}
                    className="size-8 rounded-full flex items-center justify-center text-black/20 hover:text-brick hover:bg-brick/5 opacity-0 group-hover/row:opacity-100 transition-all"
                >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
            </td>
        </tr>
    );
};


const formatNumberOutput = (num) => {
    if (num === null || num === undefined || num === '') return '';
    // Bỏ phần thập phân, giữ lại số nguyên
    const intValue = Math.floor(Number(num));
    return intValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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

// Quill 2 only accepts registered builtin formats here.
const quillFormats = [
    'header', 'font', 'size',
    'bold', 'italic', 'underline', 'strike', 'blockquote',
    'list', 'indent',
    'link', 'image', 'video',
    'color', 'background',
    'align'
];

const ProductForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const isDuplicate = queryParams.get('mode') === 'duplicate';
    const returnContext = location.state?.returnContext || null;

    const { showModal, showToast } = useUI();
    const { available: aiAvailable, disabledReason } = useAiAvailability();
    const [isSaving, setIsSaving] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiRewriting, setAiRewriting] = useState(false);
    const [typeConfirmed, setTypeConfirmed] = useState(true);
    const [categories, setCategories] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [inventoryUnits, setInventoryUnits] = useState([]);
    const [suggestedProducts, setSuggestedProducts] = useState([]);
    const [suggestedBundleProducts, setSuggestedBundleProducts] = useState([]);
    const [searchingRelated, setSearchingRelated] = useState(false);
    const [searchingBundle, setSearchingBundle] = useState(false);
    const [showRelatedFilters, setShowRelatedFilters] = useState(false);
    const [allAttributes, setAllAttributes] = useState([]);
    const [images, setImages] = useState([]);
    const [selectedImages, setSelectedImages] = useState([]);
    const [isDragSelecting, setIsDragSelecting] = useState(false);
    const [showSlugModal, setShowSlugModal] = useState(false);
    const [tempSlug, setTempSlug] = useState('');
    const [slugError, setSlugError] = useState('');
    const [allBlogPosts, setAllBlogPosts] = useState([]);
    const [blogSearchQuery, setBlogSearchQuery] = useState({}); // { index: query }
    const [isSearchingBlog, setIsSearchingBlog] = useState({}); // { index: loading }
    const [blogResults, setBlogResults] = useState({}); // { index: results }
    const [domains, setDomains] = useState([]);

    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('product_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const searchContainerRef = useRef(null);
    const relatedSearchContainerRef = useRef(null); // For the other search bar
    const supplierDropdownRef = useRef(null);
    const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);

    const [formData, setFormData] = useState({
        type: 'simple',
        name: '',
        category_id: '',
        category_ids: [],
        price: '',
        price_type: 'fixed',
        expected_cost: '',
        cost_price: '',
        weight: '',
        inventory_unit_id: '',
        supplier_ids: [],
        description: '',
        specifications: [], // [{label, value}]
        is_featured: false,
        is_new: true,
        status: true,
        stock_quantity: 10,
        sku: '',
        meta_title: '',
        meta_description: '',
        meta_keywords: '',
        linked_product_ids: [],
        grouped_items: [], // [{id, name, sku, price, quantity, is_required, image_url}]
        super_attribute_ids: [],
        custom_attributes: {},
        video_url: '',
        slug: '',
        additional_info: [], // [{title, post_id, post_title}]
        bundle_title: '',
        site_domain_id: ''
    });

    const [variants, setVariants] = useState([]);
    const [selectedSuperAttributes, setSelectedSuperAttributes] = useState([]);
    const [showVariantConfig, setShowVariantConfig] = useState(false);
    const [refreshingAttributes, setRefreshingAttributes] = useState(false);
    const [bundleOptions, setBundleOptions] = useState([]); // [{ id, title, items: [] }]
    const [showBundleSearch, setShowBundleSearch] = useState(null); // optionId
    const [isSortingBundle, setIsSortingBundle] = useState({}); // { optionId: boolean }
    const [bundleItemVariants, setBundleItemVariants] = useState({}); // { productId: [variants] }
    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

    // Filters for Related Products suggestions
    const [relatedQuery, setRelatedQuery] = useState('');
    const [bundleQuery, setBundleQuery] = useState('');
    const [relatedCategory, setRelatedCategory] = useState('all');
    const [relatedAttrFilter, setRelatedAttrFilter] = useState({}); // { attr_id: value }
    const [showSelectedRelated, setShowSelectedRelated] = useState(false);
    const [selectedProductsData, setSelectedProductsData] = useState([]);
    const [stagedRelatedIds, setStagedRelatedIds] = useState([]);
    const [stagedRelatedData, setStagedRelatedData] = useState([]);

    const [variantTableWidths, setVariantTableWidths] = useState({
        image: 80,
        name: 320,
        sku: 200,
        price: 150,
        expected_cost: 150,
        current_cost: 150,
        weight: 100,
        unit: 96,
        stock: 100,
        actions: 60
    });

    const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
    const quillRef = useRef(null);

    const imageHandler = useCallback(() => {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');
        input.click();

        input.onchange = async () => {
            const file = input.files[0];
            if (file) {
                const formData = new FormData();
                formData.append('image', file);

                try {
                    const res = await mediaApi.upload(formData);
                    const url = res.data.url;
                    
                    const quill = quillRef.current.getEditor();
                    const range = quill.getSelection();
                    quill.insertEmbed(range.index, 'image', url);
                    
                    // Set default width to 100% or allow resizing later
                    quill.setSelection(range.index + 1);
                } catch (error) {
                    showToast('Lỗi khi tải ảnh lên', 'error');
                }
            }
        };
    }, [showToast]);

    const videoHandler = useCallback(() => {
        const url = prompt('Nhập link video (Facebook hoặc YouTube):');
        if (!url) return;

        let embedUrl = url;
        
        // Detect YouTube
        const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        if (ytMatch) {
            embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
        }
        
        // Detect Facebook
        const fbMatch = url.match(/(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:watch\/\?v=|.*\/videos\/|video\.php\?v=)(\d+)/);
        if (fbMatch || url.includes('facebook.com')) {
            embedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
        }

        const quill = quillRef.current.getEditor();
        const range = quill.getSelection();
        quill.insertEmbed(range.index, 'video', embedUrl);
        quill.setSelection(range.index + 1);
    }, []);

    const quillModules = useMemo(() => ({
        toolbar: {
            container: [
                [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                [{ 'align': [] }],
                ['link', 'image', 'video'],
                ['fullscreen'],
                ['clean']
            ],
            handlers: {
                image: imageHandler,
                video: videoHandler,
                fullscreen: () => setIsEditorFullscreen(prev => !prev)
            }
        },
        imageResize: {
            parchment: ReactQuill.Quill.import('parchment'),
            modules: ['Resize', 'DisplaySize', 'Toolbar'],
            video: true
        }
    }), [imageHandler, videoHandler]);

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

    const navigateBackToOrigin = useCallback(() => {
        if (returnContext?.target) {
            navigate(returnContext.target, {
                state: {
                    returnContext,
                },
            });
            return;
        }

        navigate('/admin/products');
    }, [navigate, returnContext]);

    const handleCancel = useCallback(() => {
        navigateBackToOrigin();
    }, [navigateBackToOrigin]);

    const handleCopyContent = useCallback(() => {
        const content = formData.description;
        if (!content) {
            showToast('Nội dung trống', 'warning');
            return;
        }
        navigator.clipboard.writeText(content).then(() => {
            showToast('Đã sao chép toàn bộ nội dung HTML!', 'success');
        }).catch(err => {
            showToast('Lỗi khi sao chép', 'error');
        });
    }, [formData.description, showToast]);

    const handleWordImport = useCallback(async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const arrayBuffer = loadEvent.target.result;
            try {
                const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
                const html = result.value;
                setFormData(prev => ({ ...prev, description: prev.description + html }));
                showToast('Import từ Word thành công!', 'success');
            } catch (err) {
                showToast('Lỗi khi đọc file Word', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
        // Reset input
        e.target.value = '';
    }, [showToast]);

    // Handle replacement and actions for images and videos
    useEffect(() => {
        if (!quillRef.current) return;
        const quill = quillRef.current.getEditor();
        const editorRoot = quill.root;
        const editorContainer = editorRoot.closest('.quill');

        const removeExistingPopups = () => {
            const existing = document.querySelectorAll('.ql-image-actions-popup');
            existing.forEach(el => el.remove());
        };

        const handleEditorClick = (e) => {
            const target = e.target;
            
            // Remove popup if clicking elsewhere
            if (target.tagName !== 'IMG' && !target.closest('.ql-image-actions-popup')) {
                removeExistingPopups();
                return;
            }

            if (target.tagName === 'IMG') {
                e.preventDefault();
                e.stopPropagation();
                removeExistingPopups();
                
                const popup = document.createElement('div');
                popup.className = 'ql-image-actions-popup';
                
                // Position relative to the editor container for better stability
                const rect = target.getBoundingClientRect();
                const containerRect = editorContainer.getBoundingClientRect();
                
                // Position calculations
                const top = rect.top - containerRect.top - 50;
                const left = rect.left - containerRect.left + (rect.width / 2);
                
                popup.style.top = `${top}px`;
                popup.style.left = `${left}px`;
                popup.style.position = 'absolute';
                popup.style.transform = 'translateX(-50%)';
                popup.style.zIndex = '10005';

                // View
                const btnView = document.createElement('button');
                btnView.innerHTML = '<span class="material-symbols-outlined">visibility</span> Xem';
                btnView.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    window.open(target.src, '_blank');
                };

                // Edit/Replace - Keep dimensions
                const btnEdit = document.createElement('button');
                btnEdit.innerHTML = '<span class="material-symbols-outlined">edit</span> Thay ảnh';
                btnEdit.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async () => {
                        const file = input.files[0];
                        if (file) {
                            const uploadData = new FormData();
                            uploadData.append('image', file);
                            try {
                                const res = await mediaApi.upload(uploadData);
                                // Replace src but keep existing width/height/style
                                target.src = res.data.url;
                                // Update form state
                                setFormData(prev => ({ ...prev, description: editorRoot.innerHTML }));
                                showToast('Đã cập nhật ảnh mới, giữ nguyên kích thước', 'success');
                                removeExistingPopups();
                            } catch (err) {
                                showToast('Lỗi khi tải ảnh mới', 'error');
                            }
                        }
                    };
                    input.click();
                };

                // Delete
                const btnDelete = document.createElement('button');
                btnDelete.className = 'delete';
                btnDelete.innerHTML = '<span class="material-symbols-outlined">delete</span> Xóa';
                btnDelete.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (confirm('Xóa ảnh này ra khỏi nội dung?')) {
                        target.remove();
                        setFormData(prev => ({ ...prev, description: editorRoot.innerHTML }));
                        showToast('Đã xóa ảnh', 'success');
                        removeExistingPopups();
                    }
                };

                popup.appendChild(btnView);
                popup.appendChild(btnEdit);
                popup.appendChild(btnDelete);
                
                if (editorContainer) {
                    editorContainer.style.position = 'relative';
                    editorContainer.appendChild(popup);
                }
            }
        };

        const handleEditorDblClick = (e) => {
            const target = e.target;
            const iframe = target.closest('iframe');
            if (iframe && iframe.classList.contains('ql-video')) {
                const newUrl = prompt('Nhập link video mới:', iframe.src);
                if (newUrl && newUrl !== iframe.src) {
                    let finalUrl = newUrl;
                    const ytMatch = newUrl.match(/(?:\/watch\?v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                    if (ytMatch) {
                        finalUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
                    } else if (newUrl.includes('facebook.com')) {
                        finalUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(newUrl)}&show_text=0`;
                    }
                    iframe.src = finalUrl;
                    setFormData(prev => ({ ...prev, description: editorRoot.innerHTML }));
                    showToast('Đã thay video mới', 'success');
                }
            }
        };

        editorRoot.addEventListener('click', handleEditorClick);
        editorRoot.addEventListener('dblclick', handleEditorDblClick);
        
        return () => {
            editorRoot.removeEventListener('click', handleEditorClick);
            editorRoot.removeEventListener('dblclick', handleEditorDblClick);
            removeExistingPopups();
        };
    }, [showToast, mediaApi]);

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
        const handleClickOutside = (event) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (relatedSearchContainerRef.current && !relatedSearchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(event.target)) setSupplierPickerOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const addToSearchHistory = (term) => {
        if (!term || term.trim() === '' || term.length < 2) return;
        setSearchHistory(prev => {
            const filtered = prev.filter(item => item !== term);
            const updated = [term, ...filtered].slice(0, 10);
            localStorage.setItem('product_search_history', JSON.stringify(updated));
            return updated;
        });
    };

    useEffect(() => {
        fetchCategories();
        fetchSuppliers();
        fetchInventoryUnits();
        fetchRelatedData();
        if (isEdit) {
            fetchProduct();
        }
        fetchBlogPosts();
        fetchDomains();
    }, [id, isEdit]);

    useEffect(() => {
        if (!inventoryUnits.length) return;
        setFormData((prev) => {
            if (prev.inventory_unit_id) return prev;
            const preferred = inventoryUnits.find((unit) => unit.is_default) || inventoryUnits[0];
            return preferred ? { ...prev, inventory_unit_id: String(preferred.id) } : prev;
        });
    }, [inventoryUnits]);
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

    const fetchSuppliers = async () => {
        try {
            const response = await inventoryApi.getSuppliers({ per_page: 500 });
            setSuppliers(response.data?.data || []);
        } catch (error) {
            console.error("Error fetching suppliers", error);
        }
    };

    const fetchInventoryUnits = async () => {
        try {
            const response = await inventoryApi.getUnits();
            setInventoryUnits(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error("Error fetching inventory units", error);
        }
    };

    const handleCreateInventoryUnit = async (initialValue = '') => {
        const nextName = window.prompt('Nhập đơn vị tính mới', initialValue)?.trim();
        if (!nextName) return null;

        try {
            const response = await inventoryApi.createUnit({ name: nextName });
            const unit = response.data;

            setInventoryUnits((prev) => {
                const exists = prev.some((item) => String(item.id) === String(unit.id));
                return exists
                    ? prev
                    : [...prev, unit].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
            });

            setFormData((prev) => ({ ...prev, inventory_unit_id: String(unit.id) }));
            showToast({ message: `Đã thêm ĐVT "${unit.name}".`, type: 'success' });
            return unit;
        } catch (error) {
            console.error("Error creating inventory unit", error);
            showToast({ message: 'Không thể tạo đơn vị tính mới.', type: 'error' });
            return null;
        }
    };

    const fetchRelatedData = async () => {
        try {
            const attrRes = await attributeApi.getAll({ active_only: true });
            setAllAttributes(attrRes.data || []);
        } catch (error) {
            console.error("Error fetching related data", error);
        }
    };

    const fetchBlogPosts = async () => {
        try {
            const response = await blogApi.getAll({ per_page: 50 });
            setAllBlogPosts(response.data.data || []);
        } catch (error) {
            console.error("Error fetching blog posts", error);
        }
    };

    const searchBlogPosts = async (index, query) => {
        if (!query || query.trim().length < 2) {
            setBlogResults(prev => ({ ...prev, [index]: [] }));
            return;
        }

        setIsSearchingBlog(prev => ({ ...prev, [index]: true }));
        try {
            const response = await blogApi.getAll({ search: query, per_page: 10 });
            setBlogResults(prev => ({ ...prev, [index]: response.data.data || [] }));
        } catch (error) {
            console.error("Error searching blog posts", error);
        } finally {
            setIsSearchingBlog(prev => ({ ...prev, [index]: false }));
        }
    };

    const fetchDomains = async () => {
        try {
            const response = await cmsApi.domains.getAll();
            setDomains(response.data.filter(d => d.is_active));
        } catch (error) {
            console.error("Error fetching domains", error);
        }
    };

    // Lazy load related products on demand
    const fetchSuggestedProducts = useCallback(async () => {
        const query = (relatedQuery || '').trim();
        const hasSearch = query.length > 0;
        const hasCategory = relatedCategory !== 'all';
        const hasAttrs = Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '');
        
        setSearchingRelated(true);
        try {
            // Sử dụng bộ tham số tối giản nhất tương tự OrderForm để đảm bảo tìm thấy sản phẩm
            const params = {
                per_page: 50
            };

            if (hasSearch) {
                params.search = query;
            }

            if (hasCategory) {
                params.category_ids = String(relatedCategory);
            }

            // Chỉ thêm lọc thuộc tính nếu có
            Object.entries(relatedAttrFilter).forEach(([attrId, val]) => {
                if (val && val !== 'all' && val !== '') {
                    params[`attributes[${attrId}]`] = val;
                }
            });

            // Nếu không có search/filter, dùng danh mục mặc định
            if (!hasSearch && !hasCategory && !hasAttrs && formData.category_id) {
                params.category_ids = String(formData.category_id);
                params.sort_by = 'random';
            }

            const response = await productApi.getAll(params);
            const rawData = response.data?.data || response.data || [];
            const results = (Array.isArray(rawData) ? rawData : []).filter(p => String(p.id) !== String(id || formData.id));
            setSuggestedProducts(results);
        } catch (error) {
            console.error("Error searching products", error);
        } finally {
            setSearchingRelated(false);
        }
    }, [relatedQuery, relatedCategory, relatedAttrFilter, id, formData.id, formData.category_id]);

    // Lazy load bundle items on demand
    const fetchBundleItems = useCallback(async () => {
        if (!bundleQuery) {
            setSuggestedBundleProducts([]);
            return;
        }

        setSearchingBundle(true);
        try {
            const response = await productApi.getAll({
                per_page: 50,
                search: bundleQuery
            });
            const results = (response.data.data || []).filter(p => p.id != id);
            setSuggestedBundleProducts(results);
        } catch (error) {
            console.error("Error searching bundle products", error);
        } finally {
            setSearchingBundle(false);
        }
    }, [bundleQuery, id]);

    // Debounce suggested products search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchSuggestedProducts();
        }, 400);
        return () => clearTimeout(timer);
    }, [fetchSuggestedProducts]);

    // Debounce bundle products search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchBundleItems();
        }, 400);
        return () => clearTimeout(timer);
    }, [fetchBundleItems]);

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

    const filteredSuggestedProducts = useMemo(() => suggestedProducts, [suggestedProducts]);
    const filteredBundleProducts = useMemo(() => suggestedBundleProducts, [suggestedBundleProducts]);

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
            expected_cost: formData.expected_cost,
            current_cost: '',
            weight: formData.weight,
            inventory_unit_id: formData.inventory_unit_id || '',
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
                price_type: data.price_type || 'fixed',
                expected_cost: data.expected_cost ? Math.floor(data.expected_cost) : '',
                cost_price: data.cost_price ? Math.floor(data.cost_price) : '',
                weight: data.weight || '',
                inventory_unit_id: data.inventory_unit_id ? String(data.inventory_unit_id) : '',
                supplier_ids: Array.isArray(data.supplier_ids)
                    ? data.supplier_ids.map((value) => String(value))
                    : Array.isArray(data.suppliers)
                        ? data.suppliers.map((supplier) => String(supplier.id))
                        : (data.supplier_id ? [String(data.supplier_id)] : []),
                description: data.description || '',
                specifications: (() => {
                    if (!data.specifications) return [];
                    try {
                        const parsed = JSON.parse(data.specifications);
                        if (!Array.isArray(parsed)) {
                            return [];
                        }

                        return parsed.map((spec) => ({
                            label: spec?.label ?? '',
                            value: spec?.value ?? '',
                        }));
                    } catch (e) {
                         // Fallback for legacy text data
                        return data.specifications.split('\n')
                            .filter(l => l.trim())
                            .map(l => {
                                const parts = l.split(':');
                                return { 
                                    label: parts[0]?.trim() || 'Thông số', 
                                    value: parts.slice(1).join(':').trim() || l 
                                };
                            });
                    }
                })(),
                is_featured: !!data.is_featured,
                is_new: !!data.is_new,
                status: data.hasOwnProperty('status') ? !!data.status : true,
                stock_quantity: data.stock_quantity || 0,
                sku: data.sku || '',
                meta_title: data.meta_title || '',
                meta_description: data.meta_description || '',
                meta_keywords: data.meta_keywords || '',
                linked_product_ids: data.linked_products ? data.linked_products.map(p => p.id) : [],
                grouped_items: (data.bundle_items || data.grouped_items || []).map(item => ({
                    id: item.id,
                    name: item.name,
                    sku: item.sku,
                    price: item.pivot?.price || item.price,
                    cost_price: item.pivot?.cost_price || item.cost_price,
                    quantity: item.pivot?.quantity || 1,
                    is_required: !!(item.pivot?.is_required),
                    option_title: item.pivot?.option_title || '',
                    is_default: !!(item.pivot?.is_default),
                    image_url: (item.images?.find(img => img.is_primary) || item.images?.[0])?.image_url
                })),
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
                }, {}),
                video_url: data.video_url || '',
                slug: data.slug || '',
                additional_info: (() => {
                    if (!data.additional_info) return [];
                    try {
                        const parsed = typeof data.additional_info === 'string' ? JSON.parse(data.additional_info) : data.additional_info;
                        if (!Array.isArray(parsed)) {
                            return [];
                        }

                        return parsed.map((info) => ({
                            title: info?.title ?? '',
                            post_id: info?.post_id ?? '',
                            post_title: info?.post_title ?? '',
                        }));
                    } catch (e) { return []; }
                })(),
                bundle_title: data.bundle_title || '',
                site_domain_id: data.site_domain_id || ''
            });
            setImages(data.images || []);

            // Handle Bundle Options organization
            if (data.type === 'bundle') {
                const bItems = data.bundle_items || data.grouped_items || [];
                const optionsMap = {};
                bItems.forEach(item => {
                    const title = item.pivot?.option_title || 'Tùy chọn';
                    if (!optionsMap[title]) optionsMap[title] = [];
                    optionsMap[title].push({
                        id: item.id,
                        name: item.name,
                        sku: item.sku,
                        price: item.pivot?.price || item.price,
                        cost_price: item.pivot?.cost_price || item.cost_price,
                        quantity: item.pivot?.quantity || 1,
                        is_required: !!item.pivot?.is_required,
                        is_default: !!item.pivot?.is_default,
                        image_url: (item.images?.find(img => img.is_primary) || item.images?.[0])?.image_url,
                        type: item.type,
                        variant_id: item.pivot?.variant_id || null,
                        variant_label: ''
                    });

                    // Fetch variants if configurable
                    if (item.type === 'configurable') {
                        productApi.getOne(item.id).then(res => {
                            const vars = (res.data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
                            setBundleItemVariants(prev => ({ ...prev, [item.id]: vars }));
                        }).catch(e => console.error(e));
                    }
                });
                setBundleOptions(Object.entries(optionsMap).map(([title, its]) => ({
                    id: Math.random().toString(36).substr(2, 9),
                    title: title ?? '',
                    items: its
                })));
            } else {
                setBundleOptions([]);
            }

            // Handle variants from linked_products with 'super_link' type
            const variantsData = (data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
            const regularLinks = (data.linked_products || []).filter(p => p.pivot?.link_type === 'related');

            const initialIds = Array.from(new Set((regularLinks || []).map(p => p.id)));
            const initialData = Array.from(new Map((regularLinks || []).map(p => [p.id, p])).values());
            
            setFormData(prev => ({
                ...prev,
                linked_product_ids: initialIds
            }));
            setSelectedProductsData(initialData);
            setStagedRelatedIds(initialIds);
            setStagedRelatedData(initialData);

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
                        expected_cost: Math.floor(v.expected_cost || 0),
                        current_cost: Math.floor(v.cost_price || 0),
                        weight: v.weight ?? '',
                        inventory_unit_id: v.inventory_unit_id ? String(v.inventory_unit_id) : (data.inventory_unit_id ? String(data.inventory_unit_id) : ''),
                        stock: v.stock_quantity ?? 0,
                        sku: v.sku ?? '',
                        attributes: attrs,
                        image_url: primaryImage ? primaryImage.image_url : null,
                        label: v.name ?? (v.attribute_values || []).map(av => av.value).join(' / ') ?? ''
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
            navigateBackToOrigin();
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
        // Since allProducts is no longer loaded on start, we rely on the fact that the backend will validate uniqueness anyway.
        // Or if we really want to check here, we could call an API, but for simple auto-gen we'll just add a random suffix if name is too generic.
        while (suggestedProducts.some(p => p.sku === finalSku && (!id || p.id != id))) {
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
    const addSpecRow = () => {
        setFormData(prev => ({
            ...prev,
            specifications: [...prev.specifications, { label: '', value: '' }]
        }));
    };

    const removeSpecRow = (index) => {
        setFormData(prev => ({
            ...prev,
            specifications: prev.specifications.filter((_, i) => i !== index)
        }));
    };

    const updateSpecRow = (index, field, value) => {
        setFormData(prev => {
            const newSpecs = [...prev.specifications];
            newSpecs[index] = { ...newSpecs[index], [field]: value };
            return { ...prev, specifications: newSpecs };
        });
    };

    const addAdditionalInfoRow = () => {
        setFormData(prev => ({
            ...prev,
            additional_info: [...prev.additional_info, { title: '', post_id: '', post_title: '' }]
        }));
    };

    const removeAdditionalInfoRow = (index) => {
        setFormData(prev => ({
            ...prev,
            additional_info: prev.additional_info.filter((_, i) => i !== index)
        }));
    };

    const updateAdditionalInfoRow = (index, field, value, extra = {}) => {
        setFormData(prev => {
            const newInfo = [...prev.additional_info];
            newInfo[index] = { ...newInfo[index], [field]: value, ...extra };
            return { ...prev, additional_info: newInfo };
        });
    };

    const copySpecifications = () => {
        if (!formData.specifications || formData.specifications.length === 0) {
            showToast('Không có thông số nào để copy', 'warning');
            return;
        }
        localStorage.setItem('product_form_clipboard', JSON.stringify({
            type: 'specifications',
            data: formData.specifications
        }));
        showToast('Đã copy bảng thông số kỹ thuật', 'success');
    };

    const pasteSpecifications = () => {
        const saved = localStorage.getItem('product_form_clipboard');
        if (!saved) {
            showToast('Chưa có dữ liệu đã copy', 'error');
            return;
        }
        try {
            const { type, data } = JSON.parse(saved);
            if (!Array.isArray(data)) throw new Error('Invalid data');

            let toPaste = [];
            let success = 0;
            let fail = 0;

            if (type === 'specifications') {
                toPaste = data.map(item => {
                    if (item.label || item.value) { success++; return { label: item.label || '', value: item.value || '' }; }
                    fail++; return null;
                }).filter(Boolean);
            } else if (type === 'additional_info') {
                toPaste = data.map(item => {
                    if (item.title || item.post_title) {
                        success++;
                        return { label: item.title || 'Thông tin', value: item.post_title || '' };
                    }
                    fail++; return null;
                }).filter(Boolean);
            }

            if (toPaste.length > 0) {
                setFormData(prev => ({ ...prev, specifications: [...prev.specifications, ...toPaste] }));
                const msg = type === 'specifications' ? `Đã dán ${success} thông số` : `Đã dán chéo ${success} mục từ Thông tin bổ sung`;
                showToast(msg + (fail > 0 ? `, bỏ qua ${fail} dòng lỗi` : ''), 'success');
            } else {
                showToast('Không tìm thấy dữ liệu hợp lệ để dán', 'warning');
            }
        } catch (e) {
            showToast('Lỗi khi dán dữ liệu', 'error');
        }
    };

    const copyAdditionalInfo = () => {
        if (!formData.additional_info || formData.additional_info.length === 0) {
            showToast('Không có thông tin bổ sung nào để copy', 'warning');
            return;
        }
        localStorage.setItem('product_form_clipboard', JSON.stringify({
            type: 'additional_info',
            data: formData.additional_info
        }));
        showToast('Đã copy bảng thông tin bổ sung', 'success');
    };

    const pasteAdditionalInfo = () => {
        const saved = localStorage.getItem('product_form_clipboard');
        if (!saved) {
            showToast('Chưa có dữ liệu đã copy', 'error');
            return;
        }
        try {
            const { type, data } = JSON.parse(saved);
            if (!Array.isArray(data)) throw new Error('Invalid data');

            let toPaste = [];
            let success = 0;
            let fail = 0;

            if (type === 'additional_info') {
                toPaste = data.map(item => {
                    if (item.title || item.post_title || item.post_id) { success++; return { ...item }; }
                    fail++; return null;
                }).filter(Boolean);
            } else if (type === 'specifications') {
                toPaste = data.map(item => {
                    if (item.label || item.value) {
                        success++;
                        return { title: item.label || 'Thông tin', post_id: '', post_title: item.value || '' };
                    }
                    fail++; return null;
                }).filter(Boolean);
            }

            if (toPaste.length > 0) {
                setFormData(prev => ({ ...prev, additional_info: [...prev.additional_info, ...toPaste] }));
                const msg = type === 'additional_info' ? `Đã dán ${success} mục thông tin` : `Đã dán chéo ${success} mục từ Bảng thông số`;
                showToast(msg + (fail > 0 ? `, bỏ qua ${fail} dòng lỗi` : ''), 'success');
            } else {
                showToast('Không tìm thấy dữ liệu hợp lệ để dán', 'warning');
            }
        } catch (e) {
            showToast('Lỗi khi dán dữ liệu', 'error');
        }
    };

    const handleAIGenerate = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }
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
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }
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
        const value = formData.custom_attributes[attr.id] ?? (attr.frontend_type === 'multiselect' ? [] : '');
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
                // Ensure value is in yyyy-MM-dd format for HTML5 date input
                let formattedDate = value;
                if (value && typeof value === 'string' && value.includes('/')) {
                    const parts = value.split('/');
                    if (parts.length === 3 && parts[2].length === 4) {
                        formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                }
                return <input type="date" className={commonClass} value={formattedDate || ''} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
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
            
            // Create a descriptive SKU based on parent SKU + attribute name/value pairs
            const skuSuffix = selectedSuperAttributes.map(attr => {
                const namePart = removeAccents(attr.name).replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const valPart = removeAccents(combo[attr.id]).replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return `${namePart}-${valPart}`;
            }).join('-');

            return {
                id: `new_${Date.now()}_${index}`,
                sku: `${formData.sku}-${skuSuffix}`,
                price: formData.price,
                expected_cost: formData.expected_cost,
                current_cost: '',
                weight: formData.weight,
                inventory_unit_id: formData.inventory_unit_id || '',
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
        if (field === 'price' || field === 'stock' || field === 'expected_cost' || field === 'weight') {
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

    const toggleSupplierSelection = (supplierId) => {
        const normalizedId = String(supplierId);
        setFormData((prev) => {
            const currentValues = Array.isArray(prev.supplier_ids) ? prev.supplier_ids : [];
            const nextValues = currentValues.includes(normalizedId)
                ? currentValues.filter((value) => value !== normalizedId)
                : [...currentValues, normalizedId];

            return {
                ...prev,
                supplier_ids: nextValues,
            };
        });
    };

    const selectedSuppliers = useMemo(() => {
        const activeIds = new Set((formData.supplier_ids || []).map((value) => String(value)));
        return suppliers.filter((supplier) => activeIds.has(String(supplier.id)));
    }, [formData.supplier_ids, suppliers]);

    const handleAddGroupItem = (product) => {
        if (formData.grouped_items.some(item => item.id === product.id)) {
            showToast({ message: 'Sản phẩm này đã có trong nhóm.', type: 'info' });
            return;
        }

        const primaryImage = product.images?.find(img => img.is_primary) || product.images?.[0];
        const newItem = {
            id: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            quantity: 1,
            is_required: true,
            image_url: primaryImage?.image_url
        };

        setFormData(prev => ({
            ...prev,
            grouped_items: [...prev.grouped_items, newItem]
        }));
    };

    const handleRemoveGroupItem = (id) => {
        setFormData(prev => ({
            ...prev,
            grouped_items: prev.grouped_items.filter(item => item.id !== id)
        }));
    };

    const handleGroupItemChange = (id, field, value) => {
        setFormData(prev => ({
            ...prev,
            grouped_items: prev.grouped_items.map(item =>
                item.id === id ? { ...item, [field]: value } : item
            )
        }));
    };

    // --- Bundle Specific Handlers ---
    const handleAddBundleOption = () => {
        setBundleOptions(prev => [{ id: Math.random().toString(36).substr(2, 9), title: 'Tùy chọn mới', items: [] }, ...prev]);
    };

    const handleRemoveBundleOption = (optionId) => {
        setBundleOptions(prev => prev.filter(o => o.id !== optionId));
    };

    const handleUpdateOptionTitle = (optionId, title) => {
        setBundleOptions(prev => prev.map(o => o.id === optionId ? { ...o, title } : o));
    };

    const handleAddItemToOption = (optionId, product) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            if (o.items.some(it => it.id === product.id && it.variant_id === null && product.type === 'simple')) {
                showToast({ message: 'Sản phẩm này đã có trong tùy chọn.', type: 'info' });
                return o;
            }
            
            // Fetch variants if configurable
            if (product.type === 'configurable' && !bundleItemVariants[product.id]) {
                productApi.getOne(product.id).then(res => {
                    const variants = (res.data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
                    setBundleItemVariants(prev => ({ ...prev, [product.id]: variants }));
                }).catch(e => console.error("Error fetching variants for bundle item", e));
            }

            const primaryImage = product.images?.find(img => img.is_primary) || product.images?.[0];
            const newItem = {
                id: product.id,
                name: product.name,
                sku: product.sku,
                price: product.price,
                cost_price: product.cost_price,
                quantity: 1,
                is_required: true,
                is_default: o.items.length === 0,
                image_url: primaryImage?.image_url,
                type: product.type,
                variant_id: null,
                variant_label: ''
            };
            return { ...o, items: [...o.items, newItem] };
        }));
    };

    const handleRemoveItemFromOption = (optionId, productId) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            const newItems = o.items.filter(it => it.id !== productId);
            // Nếu xóa trúng sp đang là default, đặt sp đầu tiên còn lại làm default
            if (o.items.find(it => it.id === productId)?.is_default && newItems.length > 0) {
                newItems[0].is_default = true;
            }
            return { ...o, items: newItems };
        }));
    };

    const handleSetDefaultInOption = (optionId, productId) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            return {
                ...o,
                items: o.items.map(it => ({ ...it, is_default: it.id === productId }))
            };
        }));
    };

    const handleUpdateBundleItemQty = (optionId, productId, quantity) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            return {
                ...o,
                items: o.items.map(it => it.id === productId ? { ...it, quantity: Math.max(1, parseInt(quantity) || 1) } : it)
            };
        }));
    };

    const handleUpdateBundleItemVariant = (optionId, productId, variantId) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            
            return {
                ...o,
                items: o.items.map(it => {
                    if (it.id !== productId) return it;
                    
                    const variants = bundleItemVariants[productId] || [];
                    const selectedVariant = variants.find(v => v.id === parseInt(variantId));
                    
                    if (!selectedVariant) return { ...it, variant_id: null, variant_label: '' };
                    
                    return {
                        ...it,
                        variant_id: selectedVariant.id,
                        variant_label: selectedVariant.name || (selectedVariant.attribute_values || []).map(av => av.value).join(' / '),
                        sku: selectedVariant.sku,
                        price: selectedVariant.price,
                        cost_price: selectedVariant.cost_price,
                        image_url: (selectedVariant.images?.find(img => img.is_primary) || selectedVariant.images?.[0])?.image_url || it.image_url
                    };
                })
            };
        }));
    };

    const moveBundleItem = (optionId, dragIndex, hoverIndex) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            const newItems = [...o.items];
            const dragItem = newItems[dragIndex];
            newItems.splice(dragIndex, 1);
            newItems.splice(hoverIndex, 0, dragItem);
            return { ...o, items: newItems };
        }));
    };

    const toggleBundleSorting = (optionId) => {
        setIsSortingBundle(prev => ({
            ...prev,
            [optionId]: !prev[optionId]
        }));
    };

    const handleRefreshBundlePrices = async () => {
        if (bundleOptions.length === 0) {
            showToast('Không có sản phẩm nào để làm mới', 'warning');
            return;
        }

        setIsRefreshingPrices(true);
        try {
            const allItems = bundleOptions.flatMap(opt => opt.items);
            const updatedItemsMap = {}; // { key: {price, sku} }
            
            // Collect unique product IDs to fetch
            const productIds = [...new Set(allItems.map(it => it.id))];
            
            await Promise.all(productIds.map(async (pId) => {
                try {
                    const res = await productApi.getOne(pId);
                    const product = res.data;
                    
                    // Root product price
                    updatedItemsMap[pId] = {
                        price: product.price,
                        cost_price: product.cost_price,
                        sku: product.sku
                    };

                    // Variant prices
                    if (product.type === 'configurable') {
                        const variants = (product.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
                        variants.forEach(v => {
                            updatedItemsMap[`${pId}_${v.id}`] = {
                                price: v.price,
                                cost_price: v.cost_price,
                                sku: v.sku
                            };
                        });
                        // Update cache for variant selectors
                        setBundleItemVariants(prev => ({ ...prev, [pId]: variants }));
                    }
                } catch (e) {
                    console.error(`Failed to refresh item ${pId}`, e);
                }
            }));

            setBundleOptions(prev => prev.map(opt => ({
                ...opt,
                items: opt.items.map(item => {
                    const key = item.variant_id ? `${item.id}_${item.variant_id}` : item.id;
                    const updates = updatedItemsMap[key] || updatedItemsMap[item.id];
                    if (updates) {
                        return { ...item, ...updates };
                    }
                    return item;
                })
            })));

            showToast('Đã làm mới giá bán từ sản phẩm gốc.', 'success');
        } catch (error) {
            showToast('Lỗi khi làm mới giá.', 'error');
        } finally {
            setIsRefreshingPrices(false);
        }
    };

    const processVideoLinks = (html) => {
        if (!html) return '';
        // Comprehensive regex for YouTube and Facebook links
        return html.replace(/(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|facebook\.com\/(?:watch\/\?v=|.*\/videos\/|video\.php\?v=))[^\s<"']+)/gi, (match, url, offset, fullString) => {
            // Only skip if it's an attribute value (src, href)
            const before = fullString.substring(Math.max(0, offset - 10), offset).toLowerCase();
            if (before.includes('src=') || before.includes('href=')) {
                return match;
            }
            
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                const idMatch = url.match(/(?:\/watch\?v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                if (idMatch) {
                    return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="https://www.youtube.com/embed/${idMatch[1]}" allowfullscreen="true" frameborder="0" style="width:100%; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
                }
            } else if (url.includes('facebook.com')) {
                const fbEmbed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
                return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="${fbEmbed}" allowfullscreen="true" frameborder="0" style="width:800px; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
            }
            return match;
        });
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
                    if (selectedProductsData.length === 0) {
                        // Gửi tham số tường minh để Backend thực hiện detach/sync
                        submitData.append('clear_linked_products', '1'); 
                    } else {
                        selectedProductsData.forEach((v, idx) => {
                            submitData.append(`linked_product_ids[${idx}][id]`, v.id);
                            if (v.option_title || (v.pivot && v.pivot.option_title)) {
                                submitData.append(`linked_product_ids[${idx}][option_title]`, v.option_title || v.pivot.option_title);
                            }
                        });
                    }
                } else if (key === 'grouped_items') {
                    let itemsToSubmit = val;
                    if (formData.type === 'bundle' && bundleOptions.length > 0) {
                        itemsToSubmit = bundleOptions.flatMap(opt => 
                            opt.items.map(it => ({ ...it, option_title: opt.title }))
                        );
                    }
                    itemsToSubmit.forEach((item, idx) => {
                        submitData.append(`grouped_items[${idx}][id]`, item.id);
                        submitData.append(`grouped_items[${idx}][quantity]`, item.quantity);
                        submitData.append(`grouped_items[${idx}][is_required]`, item.is_required ? '1' : '0');
                        submitData.append(`grouped_items[${idx}][option_title]`, item.option_title || '');
                        submitData.append(`grouped_items[${idx}][is_default]`, item.is_default ? '1' : '0');
                        submitData.append(`grouped_items[${idx}][price]`, item.price || 0);
                        if (item.cost_price !== undefined && item.cost_price !== null) {
                            submitData.append(`grouped_items[${idx}][cost_price]`, item.cost_price);
                        }
                        if (item.variant_id) {
                            submitData.append(`grouped_items[${idx}][variant_id]`, item.variant_id);
                        }
                    });
                } else if (key === 'specifications') {
                    const validSpecs = val.filter(s => s.label.trim() || s.value.trim());
                    submitData.append(key, JSON.stringify(validSpecs));
                } else if (key === 'additional_info') {
                    const validInfo = val.filter(i => i.title.trim() && i.post_id);
                    submitData.append(key, JSON.stringify(validInfo));
                } else if (key === 'supplier_ids') {
                    if (Array.isArray(val) && val.length > 0) {
                        val.forEach((supplierId) => submitData.append('supplier_ids[]', supplierId));
                    } else {
                        submitData.append('clear_supplier_ids', '1');
                    }
                } else if (Array.isArray(val)) {
                    val.forEach(v => submitData.append(`${key}[]`, v));
                } else if (typeof val === 'boolean') {
                    submitData.append(key, val ? '1' : '0');
                } else if (val !== '' && val !== null && val !== undefined) {
                    if (key === 'description') {
                        submitData.append(key, processVideoLinks(val));
                    } else {
                        submitData.append(key, val);
                    }
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
                    submitData.append(`variants[${idx}][expected_cost]`, v.expected_cost || '');
                    submitData.append(`variants[${idx}][weight]`, v.weight || '');
                    submitData.append(`variants[${idx}][inventory_unit_id]`, v.inventory_unit_id || formData.inventory_unit_id || '');
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
            navigateBackToOrigin();
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

            showToast({ message, type: 'error' });
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


    const selectedDomain = useMemo(() => (
        domains.find(d => String(d.id) === String(formData.site_domain_id))
        || domains.find(d => d.is_default)
        || { domain: 'di-san.com' }
    ), [domains, formData.site_domain_id]);

    const previewSlug = useMemo(() => (
        String((showSlugModal ? tempSlug : formData.slug) || formData.slug || '').trim()
    ), [formData.slug, showSlugModal, tempSlug]);

    const baseProductLink = useMemo(() => {
        if (!previewSlug) {
            return '';
        }

        return `https://${selectedDomain.domain}/product/${previewSlug}`;
    }, [previewSlug, selectedDomain]);

    const buildTrackingLink = useCallback((url, source) => {
        if (!url) {
            return '';
        }

        try {
            const trackingUrl = new URL(url);
            trackingUrl.searchParams.set('utm_source', source);
            return trackingUrl.toString();
        } catch (error) {
            return `${url}${url.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(source)}`;
        }
    }, []);

    const trackingLinks = useMemo(() => ([
        {
            key: 'facebook',
            label: 'Link Facebook',
            helper: 'utm_source=facebook',
            url: buildTrackingLink(baseProductLink, 'facebook'),
        },
        {
            key: 'google',
            label: 'Link Google',
            helper: 'utm_source=google',
            url: buildTrackingLink(baseProductLink, 'google'),
        },
        {
            key: 'tiktok',
            label: 'Link TikTok',
            helper: 'utm_source=tiktok',
            url: buildTrackingLink(baseProductLink, 'tiktok'),
        },
    ]), [baseProductLink, buildTrackingLink]);

    const copyTextToClipboard = useCallback((value, successMessage) => {
        if (!value) {
            showToast({ message: 'Sản phẩm chưa có đường dẫn link (slug).', type: 'warning' });
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value)
                .then(() => {
                    showToast({ message: successMessage, type: 'success' });
                })
                .catch(err => {
                    console.error('Copy failed:', err);
                    showToast({ message: 'Lỗi khi sao chép link.', type: 'error' });
                });
            return;
        }

        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast({ message: successMessage, type: 'success' });
        } catch (err) {
            showToast({ message: 'Trình duyệt không hỗ trợ sao chép tự động.', type: 'error' });
        }
        document.body.removeChild(textArea);
    }, [showToast]);

    const handleCopyLink = () => {
        copyTextToClipboard(baseProductLink, 'Đã sao chép link hiển thị của sản phẩm!');
        return;
        const slug = formData.slug;
        if (!slug) {
            showToast({ message: 'Sản phẩm chưa có đường dẫn link (slug).', type: 'warning' });
            return;
        }
        
        const selectedDomain = domains.find(d => String(d.id) === String(formData.site_domain_id)) || domains.find(d => d.is_default) || { domain: 'di-san.com' };
        const fullLink = `https://${selectedDomain.domain}/product/${slug}`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullLink)
                .then(() => {
                    showToast({ message: 'Đã sao chép link sản phẩm thành công!', type: 'success' });
                })
                .catch(err => {
                    console.error('Copy failed:', err);
                    showToast({ message: 'Lỗi khi sao chép link.', type: 'error' });
                });
        } else {
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = fullLink;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showToast({ message: 'Đã sao chép link sản phẩm!', type: 'success' });
            } catch (err) {
                showToast({ message: 'Trình duyệt không hỗ trợ sao chép tự động.', type: 'error' });
            }
            document.body.removeChild(textArea);
        }
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
                            <div className="flex items-center gap-1 lg:gap-2 mt-1">
                                <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none">
                                    {formData.sku ? `SKU: ${formData.sku}` : 'Cấu hình thông tin sản phẩm và thương mại'}
                                </p>
                                <div className="flex items-center gap-1">
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setTempSlug(formData.slug || (formData.name ? formData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') : ''));
                                            setSlugError('');
                                            setShowSlugModal(true);
                                        }}
                                        className="flex items-center gap-1.5 px-2 py-0.5 bg-gold/10 text-gold rounded-full hover:bg-gold/20 transition-all border border-gold/10 group/slug"
                                        title="Quản lý đường dẫn sản phẩm"
                                    >
                                        <span className="material-symbols-outlined text-[14px] group-hover/slug:rotate-12 transition-transform">link</span>
                                        <span className="text-[9px] font-black uppercase tracking-wider">{formData.slug || (formData.name ? 'Tự động tạo...' : 'Thiết lập link')}</span>
                                    </button>
                                    {formData.slug && (
                                        <button 
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCopyLink();
                                            }}
                                            className="size-5 flex items-center justify-center bg-stone/5 text-stone/40 hover:bg-gold hover:text-white rounded-full transition-all group/copy"
                                            title="Sao chép nhanh link sản phẩm"
                                        >
                                            <span className="material-symbols-outlined text-[12px] group-hover/copy:scale-110 transition-transform">content_copy</span>
                                        </button>
                                    )}
                                </div>
                            </div>
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
            <DndProvider backend={HTML5Backend}>
            <div className="flex-1 overflow-y-auto custom-scrollbar pt-4 pb-12">
                <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-4 max-w-[1800px] mx-auto px-1">
                    <div className="lg:col-span-8 space-y-4">
                        {/* Basic Info */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="shopping_bag" title="Thông tin cơ bản" />

                            <div className="grid grid-cols-1 gap-y-8">
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                                    <div>
                                        <Field label={<>Tên sản phẩm <span className="text-brick text-[14px] ml-1">*</span></>}>
                                            <input
                                                name="name"
                                                value={formData.name}
                                                onChange={handleChange}
                                                required
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[16px] placeholder:text-stone/20"
                                                placeholder="Nhập tên nghệ thuật của tác phẩm..."
                                            />
                                        </Field>
                                    </div>

                                    <div>
                                        <Field label={<>Mã sản phẩm (SKU) <span className="text-brick text-[14px] ml-1">*</span></>} className="group/sku border-gold/20">
                                            <input
                                                name="sku"
                                                value={formData.sku}
                                                onChange={handleChange}
                                                required
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
                                    </div>

                                    <div>
                                        <Field label={<>Loại sản phẩm <span className="text-brick text-[14px] ml-1">*</span></>}>
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

                                    <div>
                                        <Field label="Danh mục">
                                            <select
                                                name="category_id"
                                                value={formData.category_id}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setFormData(prev => ({
                                                        ...prev,
                                                        category_id: val,
                                                        category_ids: val ? [parseInt(val)] : []
                                                    }));
                                                }}
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                            >
                                                <option value="">Chọn danh mục</option>
                                                {categories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </Field>
                                    </div>

                                    <div>
                                        <Field label="ĐVT" className="border-primary/20 bg-stone/5">
                                            <div className="flex items-center gap-2 w-full">
                                                <select
                                                    name="inventory_unit_id"
                                                    value={formData.inventory_unit_id || ''}
                                                    onChange={(e) => setFormData((prev) => ({ ...prev, inventory_unit_id: e.target.value }))}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                                >
                                                    <option value="">Chọn ĐVT</option>
                                                    {inventoryUnits.map((unit) => (
                                                        <option key={unit.id} value={unit.id}>{unit.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCreateInventoryUnit()}
                                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-white text-primary/70 transition hover:border-primary/35 hover:text-primary"
                                                    title="Thêm đơn vị tính"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                                </button>
                                            </div>
                                        </Field>
                                    </div>

                                </div>
                            </div>
                        </div>

                        {/* Pricing & Details */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="payments" title="Giá và thông số" />
                            <div className="grid grid-cols-1 gap-y-8">
                                <div className="grid grid-cols-1 gap-4">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                                        <Field label="Giá bán lẻ (VNĐ)" className={`border-brick/30 bg-brick/[0.02] ${formData.price_type === 'sum' ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="price"
                                                    value={formData.price_type === 'sum'
                                                        ? formatNumberOutput(formData.grouped_items.reduce((acc, item) => acc + (item.price * item.quantity), 0))
                                                        : formatNumberOutput(formData.price)}
                                                    onChange={(e) => handlePriceInputChange(e, 'price')}
                                                    required={formData.price_type !== 'sum'}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-brick font-black text-[16px]"
                                                />
                                                <span className="font-bold text-brick opacity-40 ml-2">₫</span>
                                            </div>
                                        </Field>
                                        <Field label="Giá dự kiến" className="border-primary/20 bg-stone/5">
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="expected_cost"
                                                    value={formatNumberOutput(formData.expected_cost)}
                                                    onChange={(e) => handlePriceInputChange(e, 'expected_cost')}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]"
                                                />
                                                <span className="font-bold text-primary opacity-30 ml-2">₫</span>
                                            </div>
                                        </Field>
                                        <Field label="Giá vốn hiện tại" className="border-primary/20 bg-stone/10">
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="cost_price"
                                                    value={formatNumberOutput(formData.cost_price)}
                                                    readOnly
                                                    className="w-full cursor-not-allowed bg-transparent border-none focus:outline-none focus:ring-0 text-primary/70 font-bold text-[15px]"
                                                />
                                                <span className="font-bold text-primary opacity-30 ml-2">₫</span>
                                            </div>
                                        </Field>
                                        <Field label="Khối lượng SP" className="border-primary/20 bg-stone/5">
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
                                        <Field label="Nhà cung cấp" className="border-primary/20 bg-stone/5">
                                            <div className="relative w-full" ref={supplierDropdownRef}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSupplierPickerOpen((prev) => !prev)}
                                                    className="flex w-full items-center justify-between gap-2 bg-transparent text-left"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        {selectedSuppliers.length > 0 ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {selectedSuppliers.slice(0, 2).map((supplier) => (
                                                                    <span key={supplier.id} className="inline-flex max-w-full items-center rounded-full bg-primary/10 px-2 py-1 text-[11px] font-black text-primary">
                                                                        <span className="truncate">{supplier.name}</span>
                                                                    </span>
                                                                ))}
                                                                {selectedSuppliers.length > 2 ? (
                                                                    <span className="inline-flex items-center rounded-full bg-gold/15 px-2 py-1 text-[11px] font-black text-gold">
                                                                        +{selectedSuppliers.length - 2}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        ) : (
                                                            <span className="text-primary/45 font-bold text-[14px]">Chọn nhiều nhà cung cấp</span>
                                                        )}
                                                    </div>
                                                    <span className={`material-symbols-outlined text-[18px] text-primary/40 transition-transform ${supplierPickerOpen ? 'rotate-180' : ''}`}>expand_more</span>
                                                </button>

                                                {supplierPickerOpen ? (
                                                    <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-sm border border-primary/20 bg-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]">
                                                        <div className="flex items-center justify-between border-b border-primary/10 px-3 py-2">
                                                            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/40">Nhà cung cấp</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFormData((prev) => ({ ...prev, supplier_ids: [] }))}
                                                                className="text-[10px] font-black uppercase tracking-[0.14em] text-brick hover:underline"
                                                            >
                                                                Xóa hết
                                                            </button>
                                                        </div>
                                                        <div className="max-h-60 overflow-y-auto py-1">
                                                            {suppliers.length === 0 ? (
                                                                <div className="px-3 py-4 text-[12px] text-primary/45">Chưa có nhà cung cấp trong kho.</div>
                                                            ) : suppliers.map((supplier) => {
                                                                const checked = (formData.supplier_ids || []).includes(String(supplier.id));
                                                                return (
                                                                    <label
                                                                        key={supplier.id}
                                                                        className={`flex cursor-pointer items-start gap-3 px-3 py-2 transition ${checked ? 'bg-primary/5' : 'hover:bg-primary/[0.03]'}`}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={checked}
                                                                            onChange={() => toggleSupplierSelection(supplier.id)}
                                                                            className="mt-0.5 size-4 accent-primary"
                                                                        />
                                                                        <div className="min-w-0">
                                                                            <div className={`truncate text-[13px] ${checked ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}>
                                                                                {supplier.name}
                                                                            </div>
                                                                            <div className="truncate text-[11px] text-primary/40">
                                                                                {supplier.code || supplier.phone || 'Nhà cung cấp từ quản lý kho'}
                                                                            </div>
                                                                        </div>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </Field>
                                    </div>
                                    {['grouped', 'bundle'].includes(formData.type) && (
                                        <div className="max-w-[280px]">
                                            <Field label={formData.type === 'bundle' ? "Loại giá bộ / combo" : "Loại giá nhóm"} className="border-gold/30 bg-gold/[0.02]">
                                                <select
                                                    name="price_type"
                                                    value={formData.price_type}
                                                    onChange={handleChange}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                                >
                                                    <option value="fixed">Cố định</option>
                                                    <option value="sum">Tổng giá các thành phần</option>
                                                </select>
                                            </Field>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-stone/5 p-2 rounded-sm border border-stone/10">
                                        <span className="text-[12px] font-bold text-primary uppercase">Bảng thông số kĩ thuật</span>
                                        <div className="flex items-center gap-1.5">
                                            <button 
                                                type="button"
                                                onClick={copySpecifications}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Sắp chép bảng thông số"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                                Copy
                                            </button>
                                            <button 
                                                type="button"
                                                onClick={pasteSpecifications}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Dán bảng thông số"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_paste</span>
                                                Paste
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={addSpecRow}
                                                className="size-8 bg-primary text-white flex items-center justify-center rounded-sm hover:bg-gold transition-colors shadow-sm"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">add</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                                        {formData.specifications.map((spec, idx) => (
                                            <div key={idx} className="flex gap-2 items-center group animate-fade-in-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                                                <div className="flex-1 grid grid-cols-2 gap-2 border border-stone/15 rounded-sm p-1.5 bg-white shadow-sm transition-all hover:border-primary/30">
                                                    <input 
                                                        placeholder="Nhãn (VD: Kích thước)" 
                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-bold text-primary border-r border-stone/10 placeholder:font-normal placeholder:opacity-30 pr-2"
                                                        value={spec.label ?? ''}
                                                        onChange={(e) => updateSpecRow(idx, 'label', e.target.value)}
                                                    />
                                                    <input 
                                                        placeholder="Giá trị (VD: 20x30cm)" 
                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] text-stone placeholder:opacity-40"
                                                        value={spec.value ?? ''}
                                                        onChange={(e) => updateSpecRow(idx, 'value', e.target.value)}
                                                    />
                                                </div>
                                                <button 
                                                    type="button"
                                                    onClick={() => removeSpecRow(idx)}
                                                    className="size-8 bg-brick/5 text-brick rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-brick hover:text-white transition-all shadow-sm shrink-0"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            </div>
                                        ))}
                                        {formData.specifications.length === 0 && (
                                            <div className="py-8 border-2 border-dashed border-stone/10 rounded-sm flex flex-col items-center justify-center text-stone/30">
                                                <span className="material-symbols-outlined text-[32px] mb-1">table_rows</span>
                                                <p className="text-[11px] font-bold uppercase tracking-widest">Chưa có thông số nào</p>
                                                <button type="button" onClick={addSpecRow} className="mt-2 text-[10px] text-primary hover:text-gold font-black uppercase">Thêm ngay</button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Bảng Thông tin bổ sung */}
                                <div className="space-y-3 mt-8">
                                    <div className="flex justify-between items-center bg-stone/5 p-2 rounded-sm border border-stone/10">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-primary/40 text-[18px]">library_books</span>
                                            <span className="text-[12px] font-bold text-primary uppercase">Thông tin bổ sung</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button 
                                                type="button"
                                                onClick={copyAdditionalInfo}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Sao chép thông tin bổ sung"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                                Copy
                                            </button>
                                            <button 
                                                type="button"
                                                onClick={pasteAdditionalInfo}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Dán thông tin bổ sung"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_paste</span>
                                                Paste
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={addAdditionalInfoRow}
                                                className="size-8 bg-primary text-white flex items-center justify-center rounded-sm hover:bg-gold transition-colors shadow-sm"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">add</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                                        {formData.additional_info.map((info, idx) => (
                                            <div key={idx} className="flex gap-2 items-start group animate-fade-in-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                                                <div className="flex-1 grid grid-cols-2 gap-2 border border-stone/15 rounded-sm p-1.5 bg-white shadow-sm transition-all hover:border-primary/30">
                                                    <input 
                                                        placeholder="Tiêu đề mục (VD: Hướng dẫn sử dụng)" 
                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-bold text-primary border-r border-stone/10 placeholder:font-normal placeholder:opacity-30 pr-2"
                                                        value={info.title ?? ''}
                                                        onChange={(e) => updateAdditionalInfoRow(idx, 'title', e.target.value)}
                                                    />
                                                    
                                                    {/* Blog Post Selector */}
                                                    <div className="relative">
                                                        <div className="flex items-center gap-2 px-2 py-0.5 min-h-[28px]">
                                                            {info.post_id ? (
                                                                <div className="flex-1 flex items-center justify-between overflow-hidden">
                                                                    <span className="text-[12px] font-bold text-gold truncate mr-2" title={info.post_title}>
                                                                        {info.post_title}
                                                                    </span>
                                                                    <button 
                                                                        type="button"
                                                                        onClick={() => updateAdditionalInfoRow(idx, 'post_id', '', { post_title: '' })}
                                                                        className="text-stone/40 hover:text-brick shrink-0"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="flex-1 relative">
                                                                    <input 
                                                                        placeholder="Tìm bài viết trên web..." 
                                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[12px] text-stone italic placeholder:opacity-40"
                                                                        value={blogSearchQuery[idx] || ''}
                                                                        onChange={(e) => {
                                                                            const q = e.target.value;
                                                                            setBlogSearchQuery(prev => ({ ...prev, [idx]: q }));
                                                                            searchBlogPosts(idx, q);
                                                                        }}
                                                                    />
                                                                    {isSearchingBlog[idx] && (
                                                                        <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[12px] animate-spin text-gold">refresh</span>
                                                                    )}
                                                                    
                                                                    {blogResults[idx]?.length > 0 && !info.post_id && (
                                                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone/15 shadow-xl rounded-sm z-[100] max-h-[200px] overflow-y-auto custom-scrollbar">
                                                                            {blogResults[idx].map(post => (
                                                                                <div 
                                                                                    key={post.id}
                                                                                    onClick={() => {
                                                                                        updateAdditionalInfoRow(idx, 'post_id', post.id, { post_title: post.title });
                                                                                        setBlogSearchQuery(prev => ({ ...prev, [idx]: '' }));
                                                                                        setBlogResults(prev => ({ ...prev, [idx]: [] }));
                                                                                    }}
                                                                                    className="px-3 py-2 hover:bg-gold/5 cursor-pointer border-b border-stone/5 last:border-0 transition-colors"
                                                                                >
                                                                                    <p className="text-[11px] font-bold text-primary leading-tight">{post.title}</p>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                            <span className="material-symbols-outlined text-[16px] text-stone/20">search</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button 
                                                    type="button"
                                                    onClick={() => removeAdditionalInfoRow(idx)}
                                                    className="size-8 bg-brick/5 text-brick rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-brick hover:text-white transition-all shadow-sm shrink-0"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            </div>
                                        ))}
                                        {formData.additional_info.length === 0 && (
                                            <div className="py-8 border-2 border-dashed border-stone/10 rounded-sm flex flex-col items-center justify-center text-stone/30">
                                                <span className="material-symbols-outlined text-[32px] mb-1">library_books</span>
                                                <p className="text-[11px] font-bold uppercase tracking-widest">Chưa có thông tin bổ sung</p>
                                                <button type="button" onClick={addAdditionalInfoRow} className="mt-2 text-[10px] text-primary hover:text-gold font-black uppercase">Thêm ngay</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
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
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.expected_cost }}>
                                                        Giá dự kiến
                                                        <div onMouseDown={(e) => handleVariantColumnResize('expected_cost', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.current_cost }}>
                                                        Giá vốn hiện tại
                                                        <div onMouseDown={(e) => handleVariantColumnResize('current_cost', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.weight }}>
                                                        Khối lượng SP
                                                        <div onMouseDown={(e) => handleVariantColumnResize('weight', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.unit }}>
                                                        ĐVT
                                                        <div onMouseDown={(e) => handleVariantColumnResize('unit', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
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
                                                                        value={v.label ?? ''}
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
                                                                        value={v.sku ?? ''}
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
                                                                        value={formatNumberOutput(v.expected_cost)}
                                                                        onChange={(e) => handleVariantChange(index, 'expected_cost', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-primary/30 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full cursor-not-allowed bg-stone/10 border border-transparent pl-2 pr-5 py-2 rounded text-[13px] font-bold text-primary/60 text-center transition-all"
                                                                        value={formatNumberOutput(v.current_cost)}
                                                                        readOnly
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-primary/30 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white pl-2 pr-8 py-1 rounded text-[13px] font-bold text-primary text-center"
                                                                        value={v.weight ?? ''}
                                                                        onChange={(e) => handleVariantChange(index, 'weight', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[9px] opacity-30 font-bold italic">gram</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <select
                                                                    className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white px-2 py-2 rounded text-[12px] font-bold text-primary text-center transition-all"
                                                                    value={v.inventory_unit_id || ''}
                                                                    onChange={async (e) => {
                                                                        if (e.target.value === '__create__') {
                                                                            const newUnit = await handleCreateInventoryUnit();
                                                                            if (newUnit) {
                                                                                handleVariantChange(index, 'inventory_unit_id', String(newUnit.id));
                                                                            }
                                                                            return;
                                                                        }
                                                                        handleVariantChange(index, 'inventory_unit_id', e.target.value);
                                                                    }}
                                                                >
                                                                    <option value="">ĐVT</option>
                                                                    {inventoryUnits.map((unit) => (
                                                                        <option key={unit.id} value={unit.id}>{unit.name}</option>
                                                                    ))}
                                                                    <option value="__create__">+ Thêm mới</option>
                                                                </select>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="flex items-center justify-center">
                                                                    <input
                                                                        type="number"
                                                                        className="w-full bg-[#e0f2fe] border border-transparent focus:border-blue-400 focus:bg-white px-2 py-2 rounded text-[13px] font-black text-blue-700 text-center transition-all"
                                                                        value={v.stock ?? 0}
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

                        {/* Grouped Product Management */}
                        {formData.type === 'grouped' && (
                            <div className="bg-white border border-gold/20 p-5 shadow-premium-sm rounded-sm animate-fade-in mb-8">
                                <SectionTitle 
                                    icon="group_work" 
                                    title="Thiết lập nhóm sản phẩm thành phần" 
                                />

                                <div className="mb-6">
                                    <p className="text-[12px] text-stone/60 mb-4 italic">Tìm kiếm và chọn các sản phẩm đơn hoặc biến thể cụ thể để thêm vào bộ sưu tập này.</p>

                                    <div className="relative">
                                        <div className="flex gap-2 mb-4">
                                            <div className="relative flex-1" ref={searchContainerRef}>
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-stone/40 text-[20px] z-10">search</span>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    placeholder="Tìm theo tên hoặc SKU..."
                                                    value={relatedQuery}
                                                    onChange={(e) => setRelatedQuery(e.target.value)}
                                                    onFocus={() => setShowSearchHistory(true)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            setShowSearchHistory(false);
                                                            addToSearchHistory(relatedQuery);
                                                        }
                                                    }}
                                                    className="w-full pl-10 pr-10 py-2.5 bg-primary/5 border border-primary/10 rounded-sm focus:outline-none focus:border-gold/30 text-[14px] transition-all relative z-0 font-bold"
                                                />
                                                {relatedQuery && (
                                                    <button
                                                        onClick={() => { setRelatedQuery(''); setShowSearchHistory(false); }}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors z-10"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">cancel</span>
                                                    </button>
                                                )}

                                                {showSearchHistory && searchHistory.length > 0 && (
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[70] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                                        <div className="flex justify-between items-center px-3 mb-2 border-b border-primary/10 pb-1">
                                                            <span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest">Tìm kiếm gần đây</span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('product_search_history'); }}
                                                                className="text-[10px] text-brick hover:underline font-bold"
                                                            >Xóa tất cả</button>
                                                        </div>
                                                        <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                                            {searchHistory.map((item, idx) => (
                                                                <div
                                                                    key={idx}
                                                                    className="group flex items-center justify-between px-3 py-2 hover:bg-primary/5 cursor-pointer transition-colors"
                                                                    onClick={() => {
                                                                        setRelatedQuery(item);
                                                                        setShowSearchHistory(false);
                                                                        addToSearchHistory(item);
                                                                    }}
                                                                >
                                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                                        <span className="material-symbols-outlined text-[18px] text-primary/30">history</span>
                                                                        <span className="text-[13px] text-primary truncate font-bold">{item}</span>
                                                                    </div>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const updated = searchHistory.filter(h => h !== item);
                                                                            setSearchHistory(updated);
                                                                            localStorage.setItem('product_search_history', JSON.stringify(updated));
                                                                        }}
                                                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5 text-stone/40"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <select
                                                value={relatedCategory}
                                                onChange={(e) => setRelatedCategory(e.target.value)}
                                                className="px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-sm focus:outline-none focus:border-gold/30 text-[14px] font-bold text-primary"
                                            >
                                                <option value="all">Tất cả danh mục</option>
                                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>

                                        {(relatedQuery.length > 0 || relatedCategory !== 'all') && (
                                            <div className="absolute top-[calc(100%-8px)] left-0 right-0 max-h-[300px] overflow-y-auto bg-white border border-gold/10 shadow-xl rounded-sm z-[60] custom-scrollbar">
                                                {searchingRelated ? (
                                                    <div className="p-8 flex flex-col items-center justify-center text-stone/40">
                                                        <div className="size-6 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-2"></div>
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">Đang tìm...</span>
                                                    </div>
                                                ) : filteredSuggestedProducts.length === 0 ? (
                                                    <div className="p-8 text-center text-stone/40 italic text-[12px]">
                                                        <span className="material-symbols-outlined block text-[24px] mb-1">sentiment_dissatisfied</span>
                                                        Không tìm thấy sản phẩm nào
                                                    </div>
                                                ) : (
                                                    filteredSuggestedProducts.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => {
                                                                handleAddGroupItem(p);
                                                                setRelatedQuery('');
                                                                addToSearchHistory(relatedQuery);
                                                            }}
                                                            className="flex items-center gap-3 p-3 hover:bg-gold/5 cursor-pointer border-b border-stone/5 transition-colors group"
                                                        >
                                                            <div className="size-10 rounded border border-stone/10 bg-stone/5 overflow-hidden shrink-0">
                                                                <img
                                                                    src={(p.images?.find(img => img.is_primary) || p.images?.[0])?.image_url || 'https://placehold.co/100'}
                                                                    alt=""
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="text-[13px] font-bold text-primary leading-tight group-hover:text-gold transition-colors">{p.name}</p>
                                                                <p className="text-[10px] font-mono text-gold uppercase">{p.sku}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-[12px] font-black text-brick">{formatNumberOutput(p.price)}₫</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="grid grid-cols-12 gap-2 px-3 pb-2 border-b border-stone/5">
                                        <div className="col-span-1 text-[10px] font-black uppercase text-black">Ảnh</div>
                                        <div className="col-span-4 text-[10px] font-black uppercase text-black">Sản phẩm</div>
                                        <div className="col-span-2 text-[10px] font-black uppercase text-black text-center">Số lượng</div>
                                        {formData.type === 'bundle' ? (
                                            <div className="col-span-2 text-[10px] font-black uppercase text-black text-right">Tổng giá</div>
                                        ) : (
                                            <div className="col-span-2 text-[10px] font-black uppercase text-black text-center">Bắt buộc?</div>
                                        )}
                                        <div className="col-span-2 text-[10px] font-black uppercase text-black text-right">Giá gốc</div>
                                        <div className="col-span-1"></div>
                                    </div>

                                    {formData.grouped_items.length === 0 ? (
                                        <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-stone/10 rounded-sm bg-stone/[0.02]">
                                            <span className="material-symbols-outlined text-[48px] text-stone/20 mb-2">inventory_2</span>
                                            <p className="text-[13px] font-bold text-stone/40 uppercase tracking-widest">Chưa có thành phần nào</p>
                                            <p className="text-[11px] text-stone/30 mt-1">Sử dụng thanh tìm kiếm phía trên để thêm sản phẩm</p>
                                        </div>
                                    ) : (
                                        formData.grouped_items.map((item, idx) => (
                                            <div key={item.id} className="grid grid-cols-12 gap-2 p-3 bg-stone/[0.03] rounded-sm group/item items-center border border-transparent hover:border-gold/20 transition-all">
                                                <div className="col-span-1">
                                                    <div className="size-10 rounded border border-stone/10 bg-white overflow-hidden">
                                                        <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                                                    </div>
                                                </div>
                                                <div className="col-span-4 min-w-0">
                                                    <div className="flex items-center gap-1">
                                                        <p className="text-[13px] font-bold text-primary truncate" title={item.name}>{item.name}</p>
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(item.name);
                                                                showToast('Đã sao chép tên sản phẩm', 'success');
                                                            }}
                                                            className="opacity-0 group-hover/item:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                                            title="Sao chép tên"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <p className="text-[10px] font-mono text-gold uppercase">{item.sku}</p>
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(item.sku);
                                                                showToast('Đã sao chép mã sản phẩm', 'success');
                                                            }}
                                                            className="opacity-0 group-hover/item:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                                            title="Sao chép SKU"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="col-span-2 flex justify-center">
                                                    <div className="flex items-center gap-1 bg-white border border-stone/10 rounded-full px-2 py-0.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleGroupItemChange(item.id, 'quantity', Math.max(1, item.quantity - 1))}
                                                            className="material-symbols-outlined text-[16px] text-stone/40 hover:text-brick"
                                                        >remove</button>
                                                        <input
                                                            type="number"
                                                            value={item.quantity}
                                                            onChange={(e) => handleGroupItemChange(item.id, 'quantity', parseInt(e.target.value) || 1)}
                                                            className="w-8 text-center bg-transparent border-none p-0 text-[12px] font-black text-primary focus:ring-0"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleGroupItemChange(item.id, 'quantity', item.quantity + 1)}
                                                            className="material-symbols-outlined text-[16px] text-stone/40 hover:text-primary"
                                                        >add</button>
                                                    </div>
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    {formData.type === 'bundle' ? (
                                                        <p className="text-[12px] font-black text-brick">{formatNumberOutput(item.price * item.quantity)}₫</p>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleGroupItemChange(item.id, 'is_required', !item.is_required)}
                                                            className={`size-6 mx-auto rounded-full flex items-center justify-center transition-all ${item.is_required ? 'bg-primary text-white' : 'bg-stone/10 text-stone/40 hover:bg-stone/20'}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">{item.is_required ? 'check' : 'close'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    <p className="text-[12px] font-black text-black">{formatNumberOutput(item.price)}₫</p>
                                                </div>
                                                <div className="col-span-1 flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveGroupItem(item.id)}
                                                        className="size-8 rounded-full flex items-center justify-center text-stone/20 hover:text-brick hover:bg-brick/5 opacity-0 group-hover/item:opacity-100 transition-all"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Bundle Product Management */}
                        {formData.type === 'bundle' && (
                            <div className="bg-white border border-gold/20 p-6 shadow-premium-sm rounded-sm animate-fade-in mb-8">
                                <div className="flex justify-between items-center mb-5 pb-3 border-b border-gold/10">
                                    <div className="flex items-center gap-2.5">
                                        <span className="material-symbols-outlined text-primary/40 p-1.5 bg-stone/5 rounded-full text-base">inventory_2</span>
                                        <h3 className="font-sans text-[15px] font-bold text-primary uppercase tracking-tight">Cấu hình tùy chọn Bộ / Combo</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleRefreshBundlePrices}
                                            disabled={isRefreshingPrices || bundleOptions.length === 0}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-sm transition-all text-[11px] font-bold uppercase tracking-widest ${isRefreshingPrices ? 'bg-stone/10 text-stone/40' : 'bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20'}`}
                                            title="Lấy giá mới nhất từ sản phẩm gốc"
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${isRefreshingPrices ? 'animate-spin' : ''}`}>refresh</span>
                                            {isRefreshingPrices ? 'Đang làm mới...' : 'Làm mới giá'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleAddBundleOption}
                                            className="flex items-center gap-2 bg-gold/10 hover:bg-gold/20 text-gold px-3 py-1.5 rounded-sm transition-all text-[11px] font-black uppercase tracking-widest"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">add_circle</span>
                                            Thêm Tùy chọn mới
                                        </button>
                                    </div>
                                </div>

                                {/* Dynamic Bundle Header/Title */}
                                <div className="mb-4 p-4 bg-primary/[0.02] border border-primary/5 rounded-sm">
                                    <Field label="Tiêu đề hiển thị cho vùng chọn bộ (Frontend)" icon="title">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                name="bundle_title"
                                                value={formData.bundle_title}
                                                onChange={handleChange}
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px] placeholder:text-stone/20"
                                                placeholder="VD: Chọn cấu hình theo ban thờ, Chọn kích thước..."
                                            />
                                            {formData.bundle_title && (
                                                <span className="material-symbols-outlined text-green-500 text-[18px]">verified</span>
                                            )}
                                        </div>
                                    </Field>
                                    <p className="text-[10px] text-stone/40 mt-1.5 ml-1 italic">Văn bản này sẽ hiển thị ngay phía trên các nút chọn cấu hình ngoài trang chủ. Nếu để trống, tiêu đề sẽ tự động được ẩn.</p>
                                </div>

                                <div className="space-y-4">
                                    {bundleOptions.length === 0 ? (
                                        <div className="py-20 flex flex-col items-center justify-center border-2 border-dashed border-gold/10 bg-gold/[0.02] rounded-sm">
                                            <span className="material-symbols-outlined text-[64px] text-gold/20 mb-4 font-thin">grid_view</span>
                                            <p className="text-[14px] font-bold text-gold/40 uppercase tracking-[0.2em] mb-2">Bắt đầu tạo bộ combo</p>
                                            <p className="text-[11px] text-stone/40 italic max-w-sm text-center px-8">Nhấn nút "Thêm Tùy chọn mới" để bắt đầu nhóm các sản phẩm thành từng phần của bộ.</p>
                                        </div>
                                    ) : (
                                        bundleOptions.map((option, optIdx) => (
                                            <div 
                                                key={option.id} 
                                                className={`border border-gold/15 rounded-sm shadow-sm bg-[#fcfaf7]/30 ${showBundleSearch === option.id ? 'relative z-[80]' : 'relative z-10'}`}
                                            >
                                                <div className="bg-[#f2eddf]/40 px-5 py-3 flex items-center gap-4 border-b border-gold/10 rounded-t-sm">
                                                     <div className="size-8 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
                                                        <span className="text-[13px] font-black text-gold">{optIdx + 1}</span>
                                                     </div>
                                                     <div className="flex-1">
                                                        <input
                                                            type="text"
                                                            value={option.title ?? ''}
                                                            onChange={(e) => handleUpdateOptionTitle(option.id, e.target.value)}
                                                            className="w-full bg-transparent border-none p-0 text-[15px] font-black text-primary focus:ring-0"
                                                            placeholder="Nhập tên tùy chọn..."
                                                        />
                                                     </div>
                                                     <div className="flex items-center gap-3">
                                                         <button
                                                            type="button"
                                                            onClick={() => toggleBundleSorting(option.id)}
                                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-black uppercase transition-all ${isSortingBundle[option.id] ? 'bg-amber-500 text-white shadow-premium' : 'bg-gold/10 text-gold hover:bg-gold/20'}`}
                                                            title="Sắp xếp thứ tự sản phẩm"
                                                         >
                                                            <span className="material-symbols-outlined text-[16px]">{isSortingBundle[option.id] ? 'done_all' : 'reorder'}</span>
                                                            {isSortingBundle[option.id] ? 'Xong' : 'Sắp xếp'}
                                                         </button>
                                                         <button
                                                            type="button"
                                                            onClick={() => setShowBundleSearch(showBundleSearch === option.id ? null : option.id)}
                                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-black uppercase transition-all ${showBundleSearch === option.id ? 'bg-primary text-white' : 'bg-gold/10 text-gold hover:bg-gold/20'}`}
                                                         >
                                                            <span className="material-symbols-outlined text-[16px]">{showBundleSearch === option.id ? 'close' : 'add'}</span>
                                                            {showBundleSearch === option.id ? 'Đóng tìm kiếm' : 'Thêm sản phẩm'}
                                                         </button>
                                                         <button
                                                            type="button"
                                                            onClick={() => handleRemoveBundleOption(option.id)}
                                                            className="text-stone/20 hover:text-brick transition-all"
                                                         >
                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                         </button>
                                                     </div>
                                                </div>

                                                {showBundleSearch === option.id && (
                                                    <div className="px-5 py-4 bg-white border-b border-gold/10">
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-stone/30 text-[18px]">search</span>
                                                            <input
                                                                type="text"
                                                                placeholder="Tìm sản phẩm..."
                                                                className="w-full pl-9 pr-4 py-2 bg-stone/[0.02] border border-stone/10 rounded text-[13px] font-bold"
                                                                value={bundleQuery}
                                                                onChange={(e) => setBundleQuery(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        fetchBundleItems();
                                                                    }
                                                                }}
                                                                autoFocus
                                                            />
                                                            {bundleQuery.length > 0 && (
                                                                <div className="absolute top-full left-0 right-0 mt-1 max-h-[200px] overflow-y-auto bg-white border border-gold/15 shadow-xl rounded-sm z-[75] custom-scrollbar">
                                                                    {searchingBundle ? (
                                                                        <div className="p-6 flex flex-col items-center justify-center text-stone/40">
                                                                            <div className="size-5 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-2"></div>
                                                                            <span className="text-[9px] font-bold uppercase tracking-widest">Đang tìm...</span>
                                                                        </div>
                                                                    ) : suggestedBundleProducts.length === 0 ? (
                                                                        <div className="p-6 text-center text-stone/30 italic text-[11px]">Không tìm thấy sản phẩm</div>
                                                                    ) : (
                                                                        suggestedBundleProducts.map(p => (
                                                                            <div key={p.id} onClick={() => handleAddItemToOption(option.id, p)} className="flex items-center gap-3 p-2 hover:bg-gold/5 cursor-pointer border-b border-stone/5 group transition-colors">
                                                                                <img src={(p.images?.find(i => i.is_primary) || p.images?.[0])?.image_url || 'https://placehold.co/100'} alt="" className="size-8 object-cover rounded shadow-sm border border-stone/5" />
                                                                                <div className="flex-1">
                                                                                    <p className="text-[12px] font-bold text-primary truncate leading-tight group-hover:text-gold transition-colors">{p.name}</p>
                                                                                    <p className="text-[10px] font-mono text-gold uppercase">{p.sku}</p>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <p className="text-[11px] font-black text-brick">{formatNumberOutput(p.price)}₫</p>
                                                                                    <button 
                                                                                        type="button"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            navigator.clipboard.writeText(p.sku);
                                                                                            showToast('Đã sao chép mã SP', 'success');
                                                                                        }}
                                                                                        className="opacity-0 group-hover:opacity-100 p-1 text-stone/40 hover:text-gold transition-all"
                                                                                        title="Sao chép mã"
                                                                                    >
                                                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                 <div className="bg-white">
                                                    {option.items.length > 0 && (
                                                        <table className="w-full text-left text-[12px]">
                                                            <thead>
                                                                <tr className="bg-[#f2eddf]/20 text-black border-b border-gold/10">
                                                                    <th className="pl-5 py-2.5 w-16 text-center uppercase font-black tracking-widest text-[10px] border-r border-gold/10">
                                                                        {isSortingBundle[option.id] ? 'Vị trí' : 'Default'}
                                                                    </th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] border-r border-gold/10">Sản phẩm</th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] border-r border-gold/10">Biến thể</th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] text-center border-r border-gold/10">Giá bán</th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] text-center border-r border-gold/10">Số lượng</th>
                                                                    <th className="px-3 py-2 w-12"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {option.items.map((item, idx) => (
                                                                    <DraggableBundleItem 
                                                                        key={item.id}
                                                                        index={idx}
                                                                        optionId={option.id}
                                                                        item={item}
                                                                        moveBundleItem={moveBundleItem}
                                                                        handleSetDefaultInOption={handleSetDefaultInOption}
                                                                        handleUpdateBundleItemVariant={handleUpdateBundleItemVariant}
                                                                        bundleItemVariants={bundleItemVariants}
                                                                        handleUpdateBundleItemQty={handleUpdateBundleItemQty}
                                                                        handleRemoveItemFromOption={handleRemoveItemFromOption}
                                                                        formatNumberOutput={formatNumberOutput}
                                                                        isSortingMode={isSortingBundle[option.id]}
                                                                    />
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
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
                            
                            {/* Image Grid */}
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

                            {/* YouTube Video Link */}
                            <div className="mb-6 px-1 mt-6">
                                <Field label="Link Video YouTube (Tùy chọn)" className="border-red-100 bg-red-50/10">
                                    <div className="flex items-center w-full gap-2 py-1">
                                        <span className="material-symbols-outlined text-red-600/40 text-[20px]">movie</span>
                                        <input
                                            name="video_url"
                                            value={formData.video_url}
                                            onChange={handleChange}
                                            placeholder="VD: https://www.youtube.com/watch?v=..."
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px] placeholder:text-stone/20"
                                        />
                                        {formData.video_url && (
                                            <div className="flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest shadow-sm">
                                                <span className="material-symbols-outlined text-[12px]">verified</span>
                                                Sẵn sàng
                                            </div>
                                        )}
                                    </div>
                                </Field>
                                <p className="text-[10px] text-stone/40 mt-1.5 ml-1 italic">Dán link YouTube vào đây để hiển thị Tab Video trong Gallery sản phẩm ở ngoài trang chủ.</p>
                            </div>
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
                                        disabled={aiRewriting || !aiAvailable}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiRewriting ? 'opacity-50 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                        title={!aiAvailable ? disabledReason : 'Viết lại mô tả bằng AI'}
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${aiRewriting ? 'animate-pulse' : ''}`}>edit_document</span>
                                        {aiRewriting ? 'AI đang viết lại...' : 'AI Viết lại'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAIGenerate}
                                        disabled={aiGenerating || !aiAvailable}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiGenerating ? 'opacity-50 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                        title={!aiAvailable ? disabledReason : 'Tạo mô tả mới bằng AI'}
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                        {aiGenerating ? 'AI đang tạo...' : 'AI Viết mới'}
                                    </button>

                                    <div className="h-6 w-px bg-gold/10 mx-1"></div>

                                    <button
                                        type="button"
                                        onClick={handleCopyContent}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-gold/20 text-gold font-bold text-[11px] uppercase tracking-widest transition-all hover:bg-gold/5 active:scale-95"
                                        title="Copy toàn bộ nội dung"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                        Copy
                                    </button>

                                    <label className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-gold/20 text-gold font-bold text-[11px] uppercase tracking-widest transition-all hover:bg-gold/5 active:scale-95 cursor-pointer" title="Nhập từ file Word (.docx)">
                                        <span className="material-symbols-outlined text-[16px]">description</span>
                                        Import Word
                                        <input type="file" accept=".docx" className="hidden" onChange={handleWordImport} />
                                    </label>

                                    <button
                                        type="button"
                                        onClick={() => setIsEditorFullscreen(!isEditorFullscreen)}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border-2 font-bold text-[11px] uppercase tracking-widest transition-all shadow-md active:scale-95 ${isEditorFullscreen ? 'bg-red-500 border-red-500 text-white' : 'border-primary text-primary hover:bg-primary hover:text-white'}`}
                                        title={isEditorFullscreen ? "Thu nhỏ" : "Phóng to toàn màn hình"}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{isEditorFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
                                        {isEditorFullscreen ? 'ĐÓNG PHÓNG TO' : 'PHÓNG TO EDITOR'}
                                    </button>
                                </div>
                            </div>
                            <div className={`p-1 ${isEditorFullscreen ? 'editor-fullscreen-container' : 'min-h-[400px]'}`}>
                                {isEditorFullscreen && (
                                    <div className="flex justify-between items-center p-3 bg-primary text-white shadow-md">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined">edit_note</span>
                                            <span className="font-bold uppercase tracking-tight text-sm">Chế độ soạn thảo toàn màn hình</span>
                                        </div>
                                        <button 
                                            onClick={() => setIsEditorFullscreen(false)}
                                            className="flex items-center gap-1 px-3 py-1 bg-white/10 hover:bg-white/20 rounded transition-all text-xs font-bold"
                                        >
                                            <span className="material-symbols-outlined text-sm">fullscreen_exit</span>
                                            ĐÓNG PHÓNG TO
                                        </button>
                                    </div>
                                )}
                                <ReactQuill
                                    ref={quillRef}
                                    theme="snow"
                                    value={formData.description}
                                    onChange={(content) => setFormData(prev => ({ ...prev, description: content }))}
                                    modules={quillModules}
                                    formats={quillFormats}
                                    className={`${isEditorFullscreen ? '' : 'h-[400px] mb-12'} border-none`}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-4 space-y-4">
                        {/* Standalone Status Toggle */}
                        <div className="bg-white border border-gold/10 p-4 shadow-premium-sm rounded-sm flex items-center justify-between group transition-all hover:border-gold/30">
                            <div className="flex items-center gap-3">
                                <div className={`size-10 rounded-full flex items-center justify-center transition-all duration-300 ${formData.status ? 'bg-green-50 text-green-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]' : 'bg-stone/5 text-stone/40'}`}>
                                    <span className="material-symbols-outlined text-[20px]">{formData.status ? 'inventory_2' : 'inventory'}</span>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-[13px] font-black text-primary uppercase tracking-tight leading-none">Trạng thái kinh doanh</p>
                                    <p className={`text-[11px] font-bold transition-colors duration-300 ${formData.status ? 'text-green-600' : 'text-stone/40'}`}>
                                        {formData.status ? 'Đang mở bán trên toàn hệ thống' : 'Sản phẩm đang được tạm ẩn'}
                                    </p>
                                </div>
                            </div>
                            <div className="relative">
                                <input 
                                    type="checkbox" 
                                    name="status" 
                                    checked={formData.status} 
                                    onChange={handleChange} 
                                    className="sr-only peer" 
                                    id="main-status-toggle"
                                />
                                <label 
                                    htmlFor="main-status-toggle"
                                    className="block w-14 h-7 bg-stone/20 rounded-full cursor-pointer transition-all duration-300 peer-checked:bg-green-500 relative shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] overflow-hidden"
                                >
                                    <div className="absolute top-1 left-1 bg-white w-5 h-5 rounded-full shadow-md transition-all duration-300 transform peer-checked:translate-x-7 flex items-center justify-center">
                                        <span className={`material-symbols-outlined text-[12px] font-bold transition-colors duration-300 ${formData.status ? 'text-green-500' : 'text-stone/30'}`}>
                                            {formData.status ? 'done' : 'close'}
                                        </span>
                                    </div>
                                    {/* Subtle ON/OFF text inside track */}
                                    <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/40 uppercase transition-opacity duration-300 ${formData.status ? 'opacity-0' : 'opacity-100'}`}>Off</span>
                                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/60 uppercase transition-opacity duration-300 ${formData.status ? 'opacity-100' : 'opacity-0'}`}>On</span>
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
                            <div className="flex justify-between items-center mb-5">
                                <SectionTitle icon="link" title="Đề xuất liên quan" />
                                <div className="flex items-center gap-2">
                                    {(() => {
                                        const hasRelatedChanges = (stagedRelatedIds.length !== formData.linked_product_ids.length || !stagedRelatedIds.every(id => formData.linked_product_ids.includes(id))) || (JSON.stringify(stagedRelatedData.map(p => ({id: p.id, t: p.option_title || ''}))) !== JSON.stringify(selectedProductsData.map(p => ({id: p.id, t: p.option_title || p.pivot?.option_title || ''}))));
                                        return hasRelatedChanges && (
                                        <div className="flex items-center gap-2 mr-2 animate-in fade-in slide-in-from-right-2 duration-300">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStagedRelatedIds([...formData.linked_product_ids]);
                                                    setStagedRelatedData([...selectedProductsData]);
                                                }}
                                                className="px-2 py-1.5 text-[9px] font-black uppercase text-stone/40 hover:text-brick transition-all"
                                            >
                                                Hủy thay đổi
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFormData(prev => ({ ...prev, linked_product_ids: [...stagedRelatedIds] }));
                                                    setSelectedProductsData([...stagedRelatedData]);
                                                    showToast({ message: `Đã ghi nhận ${stagedRelatedIds.length} sản phẩm liên quan. Hãy nhấn "Lưu cập nhật" để hoàn tất.`, type: 'success' });
                                                }}
                                                className="bg-gold px-3 py-1.5 rounded-sm text-white text-[10px] font-black uppercase tracking-widest shadow-premium hover:bg-gold/80 transition-all"
                                            >
                                                Ghi nhận danh sách
                                            </button>
                                        </div>
                                        );
                                    })()}
                                    <button
                                        type="button"
                                        onClick={() => setShowSelectedRelated(!showSelectedRelated)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-sm transition-all text-[11px] font-bold uppercase tracking-widest ${showSelectedRelated ? 'bg-primary text-white shadow-lg' : 'bg-gold/5 text-gold border border-gold/10 hover:bg-gold/10'}`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">{showSelectedRelated ? 'visibility_off' : 'visibility'}</span>
                                        {showSelectedRelated ? 'Đóng DS Đã Chọn' : `Đã chọn (${stagedRelatedIds.length})`}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-4">
                                {/* Search & Filters Area */}
                                <div className="space-y-3 p-3 bg-stone/5 border border-stone/10 rounded-sm">
                                    <div className="flex gap-2">
                                        <div className="relative flex-1" ref={relatedSearchContainerRef}>
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-stone/40 z-10">search</span>
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                placeholder="Tìm theo tên hoặc mã SKU..."
                                                value={relatedQuery}
                                                onChange={(e) => setRelatedQuery(e.target.value)}
                                                onFocus={() => setShowSearchHistory(true)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault(); // Tránh submit form chính
                                                        setShowSearchHistory(false);
                                                        addToSearchHistory(relatedQuery);
                                                        fetchSuggestedProducts(); // Thực hiện tìm kiếm ngay lập tức
                                                    }
                                                }}
                                                className="w-full bg-white border border-stone/20 rounded-sm pl-9 pr-9 py-2 text-[12px] font-bold text-primary focus:outline-none focus:border-gold/30 transition-all shadow-sm relative z-0"
                                            />
                                            {relatedQuery && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setRelatedQuery(''); setShowSearchHistory(false); }}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors z-10"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">cancel</span>
                                                </button>
                                            )}

                                            {showSearchHistory && searchHistory.length > 0 && (
                                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[70] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                                    <div className="flex justify-between items-center px-3 mb-1 border-b border-primary/10 pb-1">
                                                        <span className="text-[9px] font-bold text-primary/40 uppercase tracking-widest">Gần đây</span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('product_search_history'); }}
                                                            className="text-[9px] text-brick hover:underline font-bold"
                                                        >Xóa</button>
                                                    </div>
                                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                        {searchHistory.map((item, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="group flex items-center justify-between px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors"
                                                                onClick={() => {
                                                                    setRelatedQuery(item);
                                                                    setShowSearchHistory(false);
                                                                    addToSearchHistory(item);
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-2 overflow-hidden">
                                                                    <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                                    <span className="text-[11px] text-primary truncate font-bold">{item}</span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const updated = searchHistory.filter(h => h !== item);
                                                                        setSearchHistory(updated);
                                                                        localStorage.setItem('product_search_history', JSON.stringify(updated));
                                                                    }}
                                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5 text-stone/40"
                                                                >
                                                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowRelatedFilters(!showRelatedFilters)}
                                            className={`flex items-center gap-1.5 px-4 py-2 rounded-sm border font-black text-[11px] uppercase tracking-widest transition-all ${showRelatedFilters ? 'bg-primary text-white border-primary shadow-premium' : 'bg-white border-gold/20 text-gold hover:bg-gold/5'}`}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">filter_list</span>
                                            Lọc
                                            {Object.values(relatedAttrFilter).concat([relatedCategory]).some(v => v !== 'all' && v !== '') && (
                                                <span className="size-2 bg-brick rounded-full animate-pulse"></span>
                                            )}
                                        </button>
                                    </div>

                                    {/* Filters Panel */}
                                    {showRelatedFilters && (
                                        <div className="grid grid-cols-1 gap-4 pt-3 mt-3 border-t border-stone/10 animate-in fade-in slide-in-from-top-2 duration-300">
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

                                                {/* Filterable Attributes */}
                                                {allAttributes
                                                    .filter(a => [
                                                        'Chứng chỉ chất lượng', 'Ngày ra lò', 'Đường kính', 
                                                        'Giấy chứng nhận', 'Phí bảo hiểm vận chuyển', 
                                                        'Hàng phi mậu dịch', 'Câu chuyện sản phẩm', 'Loại men'
                                                    ].includes(a.name))
                                                    .map(attr => (
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
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-black uppercase text-stone/30">Auto-search:</span>
                                                    <div className="size-2 bg-gold/40 rounded-full animate-pulse"></div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRelatedCategory('all');
                                                        setRelatedAttrFilter({});
                                                    }}
                                                    className="text-[9px] font-black uppercase text-brick hover:underline px-2 py-1"
                                                >
                                                    Mặc định tất cả
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-2 pr-1 border-t border-stone/10 pt-4">
                                    {showSelectedRelated ? (
                                        <>
                                            <div className="flex justify-between items-center px-1 mb-3">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-brick italic bg-brick/5 px-2 py-0.5 rounded-full">
                                                    Danh sách đang chọn ({stagedRelatedIds.length})
                                                </span>
                                                {stagedRelatedIds.length > 0 && (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setFormData(prev => ({ ...prev, linked_product_ids: [...stagedRelatedIds] }));
                                                                setSelectedProductsData(stagedRelatedData.map(p => ({...p})));
                                                                showToast({ message: `Đã ghi nhận thay đổi! Đừng quên bấm nút "Lưu cập nhật" ở trên cùng để lưu lại.`, type: 'success' });
                                                            }}
                                                            className="bg-gold/10 text-gold hover:bg-gold/20 hover:text-gold-dark px-3 py-1 rounded-[4px] text-[10px] font-bold uppercase transition-all flex items-center gap-1.5"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">save</span>
                                                            Lưu thay đổi
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setStagedRelatedIds([]);
                                                                setStagedRelatedData([]);
                                                            }}
                                                            className="text-[9px] font-black uppercase text-brick hover:underline px-2 py-1"
                                                        >
                                                            Xóa toàn bộ
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {stagedRelatedData.length === 0 ? (
                                                <div className="py-12 text-center text-stone/30 italic text-[11px]">Chưa có sản phẩm nào được chọn.</div>
                                            ) : (
                                                stagedRelatedData.map((prod, idx) => (
                                                    <div key={`${prod.id}-${idx}`} className="flex items-center gap-3 p-2 border rounded-sm bg-gold/5 border-gold/20 shadow-sm relative group">
                                                        <div className="size-10 bg-white border border-stone/10 p-0.5 rounded shadow-sm overflow-hidden flex-shrink-0">
                                                            <img src={(prod.images?.find(img => img.is_primary) || prod.images?.[0])?.image_url || 'https://placehold.co/100'} className="w-full h-full object-cover" alt="" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[12px] font-bold text-primary truncate leading-tight">{prod.name}</p>
                                                            <p className="text-[9px] font-black text-gold uppercase mt-0.5 mb-1">{prod.sku}</p>
                                                            <input
                                                                type="text"
                                                                placeholder="Tên hiển thị frontend (Tùy chỉnh)"
                                                                value={prod.option_title || prod.pivot?.option_title || ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setStagedRelatedData(prev => prev.map(p => String(p.id) === String(prod.id) ? { ...p, option_title: val } : p));
                                                                }}
                                                                className="w-full bg-white border border-stone/20 rounded-sm px-2 py-1 text-[10px] text-primary focus:border-primary/50 focus:outline-none placeholder:text-stone/30"
                                                                title="Nhập tên này để ưu tiên hiển thị trên frontend thay vì tên gốc"
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                const prodIdStr = String(prod.id);
                                                                setStagedRelatedIds(prev => prev.filter(id => String(id) !== prodIdStr));
                                                                setStagedRelatedData(prev => prev.filter(p => String(p.id) !== prodIdStr));
                                                            }}
                                                            className="size-8 rounded-full flex items-center justify-center text-stone/20 hover:text-brick hover:bg-brick/5 transition-all"
                                                            title="Gỡ bỏ khỏi danh sách đang chọn"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex justify-between items-center px-1 mb-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-stone/50">
                                                    {!relatedQuery && relatedCategory === 'all' && !Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '') 
                                                        ? 'Gợi ý tương đương' 
                                                        : `Kết quả (${filteredSuggestedProducts.length})`}
                                                </span>
                                                <div className="flex items-center gap-3">
                                                    {!relatedQuery && relatedCategory === 'all' && !Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '') && (
                                                        <button
                                                            type="button"
                                                            onClick={() => fetchSuggestedProducts()}
                                                            className="flex items-center gap-1 text-[9px] font-bold text-gold hover:underline"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">refresh</span>
                                                            Làm mới
                                                        </button>
                                                    )}
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
                                            </div>

                                            {searchingRelated ? (
                                                <div className="py-12 flex flex-col items-center justify-center text-stone/40">
                                                    <div className="size-8 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-3"></div>
                                                    <span className="text-[11px] font-bold uppercase tracking-widest animate-pulse">Đang tải dữ liệu...</span>
                                                </div>
                                            ) : filteredSuggestedProducts.length > 0 ? (
                                                filteredSuggestedProducts.map(prod => (
                                                    <label key={prod.id} className={`flex items-center gap-3 p-2 border rounded-sm cursor-pointer transition-all ${stagedRelatedIds.includes(prod.id) ? 'bg-gold/10 border-gold/30 shadow-sm' : 'bg-white border-stone/10 hover:bg-gold/5 hover:border-gold/20'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={stagedRelatedIds.includes(prod.id)}
                                                            onChange={(e) => {
                                                                const prodId = prod.id;
                                                                const prodIdStr = String(prodId);
                                                                if (e.target.checked) {
                                                                    setStagedRelatedIds(prev => Array.from(new Set([...prev, prodId])));
                                                                    setStagedRelatedData(prev => {
                                                                        if (prev.some(p => String(p.id) === prodIdStr)) return prev;
                                                                        return [...prev, prod];
                                                                    });
                                                                } else {
                                                                    setStagedRelatedIds(prev => prev.filter(id => String(id) !== prodIdStr));
                                                                    setStagedRelatedData(prev => prev.filter(p => String(p.id) !== prodIdStr));
                                                                }
                                                            }}
                                                            className="size-4 accent-primary"
                                                        />
                                                        <div className="size-10 bg-white border border-stone/10 p-0.5 rounded shadow-sm overflow-hidden flex-shrink-0">
                                                            <img src={(prod.images?.find(img => img.is_primary) || prod.images?.[0])?.image_url || 'https://placehold.co/100'} className="w-full h-full object-cover" alt="" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[12px] font-bold text-primary truncate leading-tight">{prod.name}</p>
                                                            <p className="text-[9px] font-black text-gold uppercase mt-0.5">{prod.sku}</p>
                                                        </div>
                                                    </label>
                                                ))
                                            ) : (relatedQuery || relatedCategory !== 'all' || Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '')) ? (
                                                <div className="py-12 text-center text-stone/30 italic text-[11px]">
                                                    <span className="material-symbols-outlined block text-[24px] mb-1">sentiment_dissatisfied</span>
                                                    Không tìm thấy sản phẩm phù hợp...
                                                </div>
                                            ) : (
                                                <div className="py-12 flex flex-col items-center justify-center text-stone/30 italic text-[11px] border-2 border-dashed border-stone/5 rounded-sm">
                                                    <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">Saved_Search</span>
                                                    <p className="font-bold uppercase tracking-tighter mb-1">Bắt đầu tìm kiếm</p>
                                                    <p className="max-w-[180px] leading-relaxed">Nhập từ khóa hoặc sử dụng bộ lọc để tìm sản phẩm đề xuất</p>
                                                </div>
                                            )}
                                        </>
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
            </DndProvider>

            {/* Slug Management Modal */}
            <AnimatePresence>
                {showSlugModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowSlugModal(false)}
                            className="absolute inset-0 bg-primary/40 backdrop-blur-sm"
                        />
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-lg bg-white shadow-premium-lg rounded-sm overflow-hidden"
                        >
                            <div className="bg-[#fcfaf7] px-6 py-4 border-b border-gold/10 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-gold">link</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary uppercase tracking-tight">Quản lý đường dẫn hiển thị</h3>
                                </div>
                                <button onClick={() => setShowSlugModal(false)} className="text-stone/30 hover:text-brick transition-colors">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>
                            <div className="p-6">
                                <div className="mb-6">
                                    <label className="block text-[11px] font-black uppercase text-stone/40 mb-2 tracking-widest">Xem trước URL sản phẩm</label>
                                    <div 
                                        className="p-4 bg-stone/5 border border-gold/10 rounded-sm flex items-center justify-between group/link cursor-pointer hover:bg-gold/5 transition-all"
                                        onClick={handleCopyLink}
                                        title="Click để sao chép link"
                                    >
                                        <div className="flex items-baseline gap-1 overflow-hidden">
                                            <span className="text-[12px] text-stone/40 shrink-0 font-medium">
                                                {domains.find(d => String(d.id) === String(formData.site_domain_id))?.domain || domains.find(d => d.is_default)?.domain || 'di-san.com'}/product/
                                            </span>
                                            <span className="text-[12px] text-primary font-bold truncate">{tempSlug || '...' }</span>
                                        </div>
                                        <span className="material-symbols-outlined text-[16px] text-stone/30 group-hover/link:text-gold transition-colors">content_copy</span>
                                    </div>
                                    <p className="text-[10px] text-stone/40 mt-2 italic">* Đây là đường dẫn tĩnh để khách hàng truy cập trực tiếp vào sản phẩm.</p>
                                </div>

                                <div className="mb-6 rounded-sm border border-gold/10 bg-[#fcfaf7] p-4">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Link tracking quảng cáo</h4>
                                            <p className="mt-1 text-[11px] text-stone/50">
                                                Hệ thống tự sinh 3 link phụ từ link sản phẩm hiện tại theo UTM.
                                            </p>
                                        </div>
                                        <span className="rounded-full bg-primary/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                            Tự động
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        {trackingLinks.map((trackingLink) => (
                                            <div key={trackingLink.key} className="rounded-sm border border-stone/10 bg-white p-3 shadow-sm">
                                                <div className="mb-2 flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[12px] font-bold text-primary">{trackingLink.label}</div>
                                                        <div className="text-[10px] font-medium text-stone/45">{trackingLink.helper}</div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => copyTextToClipboard(trackingLink.url, `Đã sao chép ${trackingLink.label.toLowerCase()}!`)}
                                                        className="inline-flex items-center gap-1.5 rounded-sm border border-gold/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-all hover:border-gold hover:bg-gold/10"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        Copy
                                                    </button>
                                                </div>
                                                <div className="truncate text-[12px] text-stone/65" title={trackingLink.url || 'Chưa có link tracking'}>
                                                    {trackingLink.url || 'Sản phẩm cần có domain và slug để sinh link tracking.'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="relative border border-stone/30 rounded-sm px-3 focus-within:border-primary/30 transition-colors flex flex-col justify-center min-h-[50px] bg-white">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 font-sans text-[11px] font-black text-gold tracking-widest leading-none uppercase">
                                            Chọn Tên Miền Hiển Thị
                                        </label>
                                        <select 
                                            name="site_domain_id"
                                            value={formData.site_domain_id || ''}
                                            onChange={(e) => setFormData(prev => ({ ...prev, site_domain_id: e.target.value }))}
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[13px] pt-1"
                                        >
                                            <option value="">Sử dụng tên miền mặc định</option>
                                            {domains.map(d => (
                                                <option key={d.id} value={d.id}>{d.domain} {d.is_default ? '(Mặc định)' : ''}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="relative border border-stone/30 rounded-sm px-3 focus-within:border-primary/30 transition-colors flex flex-col justify-center min-h-[50px] bg-white">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 font-sans text-[11px] font-black text-brick tracking-widest leading-none uppercase">
                                            Chỉnh sửa Slug
                                        </label>
                                        <div className="flex items-center gap-2 pt-2">
                                            <input 
                                                type="text"
                                                value={tempSlug}
                                                onChange={(e) => {
                                                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
                                                    setTempSlug(val);
                                                    setSlugError('');
                                                }}
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]"
                                                placeholder="VD: binh-hoa-chu-tinh-tinh-hoa"
                                            />
                                        </div>
                                    </div>
                                    {slugError && <p className="text-[11px] text-brick font-bold">{slugError}</p>}
                                    <div className="bg-amber-50 border border-amber-100 p-3 rounded-sm">
                                        <p className="text-[11px] text-amber-700 leading-relaxed">
                                            <span className="font-bold">Lưu ý:</span> Việc đổi slug sẽ thay đổi URL của sản phẩm. Các link cũ đã chia sẻ hoặc được index bởi Google có thể bị lỗi 404 nếu không có redirect.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 bg-stone/5 border-t border-stone/10 flex justify-end gap-3">
                                <button 
                                    onClick={() => setShowSlugModal(false)}
                                    className="px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-stone hover:text-primary transition-all"
                                >
                                    Hủy bỏ
                                </button>
                                <button 
                                    onClick={() => {
                                        if (!tempSlug.trim()) {
                                            setSlugError('Đường dẫn không được để trống.');
                                            return;
                                        }
                                        setFormData(prev => ({ ...prev, slug: tempSlug }));
                                        setShowSlugModal(false);
                                        showToast({ message: 'Đã cập nhật slug mới cho sản phẩm. Đừng quên nhấn "Lưu cập nhật"!', type: 'info' });
                                    }}
                                    className="px-8 py-2 bg-gold text-white text-[11px] font-bold uppercase tracking-widest rounded-sm hover:bg-gold/80 transition-all shadow-sm"
                                >
                                    Xác nhận thay đổi
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ProductForm;
