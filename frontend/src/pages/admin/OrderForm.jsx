import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { orderApi, productApi, attributeApi, orderStatusApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import { toPng, toBlob } from 'html-to-image';

const Field = ({ label, children, className = "" }) => (
    <div className={`relative border border-primary/5 rounded-sm px-4 py-2.5 mb-4 focus-within:border-primary/20 focus-within:bg-white shadow-sm transition-all flex flex-col justify-center min-h-[56px] bg-primary/[0.03] group ${className}`}>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-2 pointer-events-none group-focus-within:text-primary transition-colors">
            {label}
        </span>
        <div className="w-full flex items-center">
            {children}
        </div>
    </div>
);

const OrderForm = () => {
    const { id } = useParams();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const duplicateFromId = queryParams.get('duplicate_from');
    const isEdit = !!id;
    const navigate = useNavigate();
    const { user } = useAuth();

    const [loading, setLoading] = useState(isEdit || !!duplicateFromId);
    const [saving, setSaving] = useState(false);
    const [products, setProducts] = useState([]);
    const [attributes, setAttributes] = useState([]);
    const [orderStatuses, setOrderStatuses] = useState([]);

    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [showColumnConfig, setShowColumnConfig] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const captureRef = useRef(null);

    const COLUMN_DEFS = {
        stt: { label: 'STT', width: 'w-12', align: 'center' },
        sku: { label: 'Mã sản phẩm', width: 'w-40', align: 'left' },
        name: { label: 'Tên sản phẩm', width: '', align: 'left' },
        quantity: { label: 'Số lượng', width: 'w-24', align: 'center' },
        price: { label: 'Đơn giá', width: 'w-44', align: 'center' },
        cost_price: { label: 'Giá nhập', width: 'w-44', align: 'center' },
        total: { label: 'Thành tiền', width: 'w-48', align: 'right' },
        actions: { label: 'Xoá', width: 'w-12', align: 'center' }
    };

    const [columnOrder, setColumnOrder] = useState(() => {
        const saved = localStorage.getItem('order_form_column_order');
        let order = saved ? JSON.parse(saved) : ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
        if (order && !order.includes('cost_price')) order.splice(order.indexOf('price') + 1, 0, 'cost_price');
        return order;
    });
    const [visibleColumns, setVisibleColumns] = useState(() => {
        const saved = localStorage.getItem('order_form_visible_columns');
        let visible = saved ? JSON.parse(saved) : ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
        if (visible && !visible.includes('cost_price') && !localStorage.getItem('added_cost_price_migrated_form')) {
            visible.splice(visible.indexOf('price') + 1, 0, 'cost_price');
            localStorage.setItem('added_cost_price_migrated_form', 'true');
        }
        return visible;
    });
    const [columnWidths, setColumnWidths] = useState(() => {
        const saved = localStorage.getItem('order_column_widths');
        return saved ? JSON.parse(saved) : {
            stt: 50,
            sku: 150,
            name: null, // Flexible
            quantity: 90,
            price: 150,
            cost_price: 150,
            total: 170,
            actions: 60
        };
    });

    const [formData, setFormData] = useState({
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        shipping_address: '',
        district: '',
        ward: '',
        source: 'Website',
        type: 'Lẻ',
        shipment_status: 'Chưa giao',
        notes: '',
        items: [],
        custom_attributes: {},
        shipping_fee: 0,
        discount: 0,
        cost_total: 0,
        status: 'new'
    });

    useEffect(() => {
        fetchInitialData();
        if (isEdit) {
            fetchOrder(id);
        } else if (duplicateFromId) {
            fetchOrder(duplicateFromId, true);
        }
    }, [id, duplicateFromId]);

    const handleCancel = useCallback(() => {
        navigate('/admin/orders');
    }, [navigate]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // If a global modal is showing, let it handle ESC first
                if (document.body.style.overflow === 'hidden') return;

                const active = document.activeElement;
                const isWriting = active && (
                    active.tagName === 'INPUT' ||
                    active.tagName === 'TEXTAREA' ||
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                );

                if (isWriting && !showColumnConfig && !showSearchDropdown) return;

                if (showColumnConfig) {
                    setShowColumnConfig(false);
                    return;
                }
                if (showSearchDropdown) {
                    setShowSearchDropdown(false);
                    return;
                }
                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showColumnConfig, showSearchDropdown, handleCancel]);

    const saveColumnSettings = () => {
        localStorage.setItem('order_form_column_order', JSON.stringify(columnOrder));
        localStorage.setItem('order_form_visible_columns', JSON.stringify(visibleColumns));
        localStorage.setItem('order_column_widths', JSON.stringify(columnWidths));
        setShowColumnConfig(false);
        alert('Đã lưu cấu hình bảng làm mặc định!');
    };

    const handleColumnResize = (id, e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = columnWidths[id] || (e.currentTarget.parentElement.offsetWidth);

        const onMouseMove = (moveEvent) => {
            const newWidth = Math.max(50, startWidth + (moveEvent.clientX - startX));
            setColumnWidths(prev => ({ ...prev, [id]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    // handleCancel now handles navigation directly without confirm for a faster experience

    const fetchProducts = async (term = '') => {
        try {
            const params = { per_page: 50 };
            if (term) params.search = term;
            const prodRes = await productApi.getAll(params);
            setProducts(prodRes.data.data || []);
        } catch (error) {
            console.error("Error fetching products", error);
        }
    };

    useEffect(() => {
        const timerId = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 500);

        return () => {
            clearTimeout(timerId);
        };
    }, [searchTerm]);

    useEffect(() => {
        // Fetch products only if search term changes or dropdown is visible
        if (showSearchDropdown || searchTerm.trim() !== '') {
            fetchProducts(debouncedSearchTerm);
        }
    }, [debouncedSearchTerm]);

    const fetchInitialData = async () => {
        try {
            // Fetch statuses first and independently
            const statusRes = await orderStatusApi.getAll();
            setOrderStatuses(statusRes.data || []);
        } catch (error) {
            console.error("Error fetching order statuses", error);
        }

        try {
            const [prodRes, attrRes] = await Promise.all([
                productApi.getAll({ per_page: 50 }),
                attributeApi.getAll({ entity_type: 'order' })
            ]);
            setProducts(prodRes.data.data || []);
            setAttributes(attrRes.data || []);
        } catch (error) {
            console.error("Error fetching products/attributes", error);
        }
    };

    const fetchOrder = async (targetId, isDuplicating = false) => {
        try {
            setLoading(true);
            const response = await orderApi.getOne(targetId);
            const order = response.data;

            const customAttrValues = {};
            order.attribute_values?.forEach(av => {
                const code = av.attribute?.code;
                if (code) {
                    try {
                        customAttrValues[code] = JSON.parse(av.value);
                    } catch (e) {
                        customAttrValues[code] = av.value;
                    }
                }
            });

            setFormData({
                customer_name: order.customer_name || '',
                customer_email: order.customer_email || '',
                customer_phone: order.customer_phone || '',
                shipping_address: order.shipping_address || '',
                notes: order.notes || '',
                items: order.items?.map(item => ({
                    product_id: item.product_id,
                    name: item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`,
                    sku: item.product?.sku || item.product_sku_snapshot || `N/A`,
                    quantity: item.quantity,
                    price: item.price,
                    cost_price: item.cost_price || item.product?.cost_price || 0
                })) || [],
                custom_attributes: customAttrValues,
                shipping_fee: order.shipping_fee || 0,
                discount: order.discount || 0,
                cost_total: order.cost_total || 0,
                status: isDuplicating ? 'new' : (order.status || 'new'),
                source: order.source || 'Website',
                type: order.type || 'Lẻ',
                shipment_status: isDuplicating ? 'Chưa giao' : (order.shipment_status || 'Chưa giao')
            });
        } catch (error) {
            console.error("Error fetching order", error);
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };


    const addProductById = (productId) => {
        if (!productId) return;
        const product = products.find(p => p.id === parseInt(productId));
        if (!product) return;

        if (formData.items.some(item => item.product_id === product.id)) return;

        const newItems = [...formData.items, {
            product_id: product.id,
            name: product.name,
            sku: product.sku,
            quantity: 1,
            price: product.price,
            cost_price: product.cost_price || 0
        }];

        const costTotal = newItems.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);

        setFormData(prev => ({
            ...prev,
            items: newItems,
            cost_total: costTotal
        }));
        // Keep search term and dropdown open for consecutive selections
    };

    const updateItem = React.useCallback((index, field, value) => {
        setFormData(prev => {
            const newItems = [...prev.items];
            newItems[index] = { ...newItems[index], [field]: value };
            const costTotal = newItems.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, []);

    const removeItem = React.useCallback((id) => {
        setFormData(prev => {
            const newItems = prev.items.filter(item => item.product_id !== id);
            const costTotal = newItems.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, []);

    const calculateSubtotal = () => {
        return formData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    };

    const calculateTotal = () => {
        return calculateSubtotal() + Number(formData.shipping_fee) - Number(formData.discount);
    };

    const handleScreenshot = async () => {
        if (!captureRef.current) return;
        setIsCapturing(true);

        const element = captureRef.current;
        
        // --- STAGE 1: Force UI Stability ---
        // Save original states
        const originalStyle = element.style.cssText;
        const stickyElements = element.querySelectorAll('.sticky');
        const stickyStyles = Array.from(stickyElements).map(el => el.style.cssText);
        
        try {
            // --- STAGE 2: Force Natural Dimensions ---
            // Set styles that force the element to its full content height
            element.style.position = 'relative';
            element.style.height = 'auto';
            element.style.maxHeight = 'none';
            element.style.overflow = 'visible';
            element.style.width = `${element.offsetWidth}px`;
            element.style.backgroundColor = '#ffffff';
            element.style.zIndex = '9999';

            // Fix sticky elements which mess up the bounding box in most libraries
            stickyElements.forEach(el => {
                el.style.position = 'static';
                el.style.backgroundColor = '#f8fafc'; 
            });

            // Wait for layout to reflow and settle
            await new Promise(resolve => setTimeout(resolve, 300));

            // CRITICAL: Calculate the REAL height including all hidden content and paddings
            const realHeight = element.scrollHeight;
            const realWidth = element.scrollWidth;

            const options = {
                backgroundColor: '#ffffff',
                cacheBust: true,
                pixelRatio: 2, // High resolution
                width: realWidth,
                height: realHeight,
                style: {
                    margin: '0',
                    padding: '0', // We already have padding in the DOM
                    borderRadius: '0'
                },
                filter: (node) => {
                    const isNode = node instanceof HTMLElement;
                    if (!isNode) return true;
                    
                    // Remove UI buttons and interactive icons
                    const text = node.innerText || '';
                    if (node.tagName === 'BUTTON') return false;
                    if (node.classList.contains('material-symbols-outlined') && 
                        (text.includes('delete') || text.includes('settings') || text.includes('refresh') || text.includes('drag'))) {
                        return false;
                    }
                    if (node.getAttribute('data-screenshot-hide') === 'true') return false;
                    
                    return true;
                }
            };

            // Capture the full content
            const blob = await toBlob(element, options);

            if (blob) {
                // Clipboard integration
                try {
                    const data = [new ClipboardItem({ 'image/png': blob })];
                    await navigator.clipboard.write(data);
                } catch (clipErr) {
                    console.error('Clipboard copy failed:', clipErr);
                }

                // Automatic Download
                const link = document.createElement('a');
                link.download = `bao-gia-${formData.customer_name || 'khach-le'}-${new Date().getTime()}.png`;
                link.href = URL.createObjectURL(blob);
                link.click();
            }
        } catch (err) {
            console.error('Screenshot failed', err);
            alert('Lỗi tạo ảnh báo giá. Hãy thử lại.');
        } finally {
            // --- STAGE 3: Restore Original UI ---
            element.style.cssText = originalStyle;
            stickyElements.forEach((el, i) => {
                el.style.cssText = stickyStyles[i];
            });
            setIsCapturing(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (isEdit) {
                await orderApi.update(id, formData);
            } else {
                await orderApi.store(formData);
            }
            navigate('/admin/orders');
        } catch (error) {
            console.error("Error saving order:", error);
            if (error.response?.data?.errors) {
                console.table(error.response.data.errors);
                const firstError = Object.values(error.response.data.errors)[0][0];
                alert(`Lỗi: ${firstError}`);
            } else {
                alert("Có lỗi xảy ra khi lưu đơn hàng. Vui lòng kiểm tra console để biết chi tiết.");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleAttributeChange = React.useCallback((code, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: { ...prev.custom_attributes, [code]: value }
        }));
    }, []);

    const handleReorder = React.useCallback((newItems) => {
        setFormData(prev => ({ ...prev, items: newItems }));
    }, []);

    if (loading) return <div className="p-8 text-center italic text-primary">Đang tải dữ liệu...</div>;

    return (
        <div className="bg-[#F8FAFC] min-h-screen p-6 animate-fade-in pb-24 relative">
            {/* Header Section synchronized with OrderList */}
            <div className="flex justify-between items-center mb-8 pb-4 border-b-2 border-primary/10">
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleCancel}
                        className="size-10 flex items-center justify-center bg-white border border-primary/10 text-primary/40 hover:text-brick hover:border-brick/20 rounded-sm shadow-sm transition-all group"
                        title="Quay lại"
                    >
                        <span className="material-symbols-outlined text-lg">arrow_back</span>
                    </button>
                    <div>
                        <h1 className="font-display text-[16px] font-bold text-primary leading-none mb-1">
                            {isEdit ? "Chỉnh sửa đơn hàng" : "Tạo đơn hàng mới"}
                        </h1>
                        <p className="font-display text-[11px] font-medium text-primary/40">Trang quản trị / Đơn hàng / {isEdit ? `Chi tiết #${id}` : "Thêm mới"}</p>
                    </div>
                </div>

                {/* Close/Action buttons like OrderList */}
                <div className="flex items-center gap-2">
                     <button
                        type="button"
                        onClick={handleCancel}
                        className="px-4 py-2 bg-white border border-primary/10 text-primary/60 hover:text-brick text-[12px] font-semibold rounded-sm transition-all"
                    >
                        Hủy thoát
                    </button>
                    <button
                        type="submit"
                        form="order-form"
                        disabled={saving}
                        className="bg-primary text-white px-6 py-2 rounded-sm text-[12px] font-semibold hover:bg-brick transition-all shadow-lg flex items-center gap-2"
                    >
                        <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`}>
                            {saving ? 'progress_activity' : 'save'}
                        </span>
                        {saving ? 'Đang lưu' : 'Lưu dữ liệu'}
                    </button>
                </div>
            </div>

            <form id="order-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-[1800px] mx-auto">
                {/* Left Section: Product Management & Custom Attributes */}
                <div className="lg:col-span-8 space-y-8">
                    <div className="bg-white border border-primary/10 px-8 pb-8 pt-1 shadow-xl rounded-md">
                        {/* Title & Product Selector Tags */}
                        <div className="flex items-center gap-4 mb-6 pt-4 border-b border-primary/5 pb-4">
                            <div className="relative group">
                                <span className="material-symbols-outlined text-primary/30 p-3 bg-primary/5 rounded-full">shopping_bag</span>
                                <button
                                    type="button"
                                    onClick={handleScreenshot}
                                    disabled={formData.items.length === 0 || isCapturing}
                                    className={`absolute -bottom-1 -right-1 size-6 flex items-center justify-center rounded-full shadow-lg transition-all ${isCapturing ? 'bg-primary animate-pulse' : 'bg-primary hover:bg-primary/90 text-white'} ${formData.items.length === 0 ? 'opacity-0 scale-0' : 'opacity-100 scale-100'}`}
                                    title="Chụp ảnh báo giá cho khách"
                                >
                                    <span className="material-symbols-outlined text-[14px]">{isCapturing ? 'progress_activity' : 'photo_camera'}</span>
                                </button>
                            </div>
                            <div className="flex-1 flex gap-6 items-center relative z-[100] min-w-0">
                                {/* Flexible Search Input */}
                                <div className="relative min-w-[340px] flex-1">
                                    <div className="flex items-center bg-blue-50/50 border border-dashed border-blue-200 rounded-sm px-4 py-2 focus-within:border-blue-400 focus-within:bg-white transition-all group shadow-sm">
                                        <span className="material-symbols-outlined text-sm text-slate-900/40 mr-2">search</span>
                                        <input
                                            type="text"
                                            placeholder="Gõ mã hoặc tên sản phẩm..."
                                            className="bg-transparent text-[13px] placeholder:text-slate-900/20 focus:outline-none flex-1 font-bold text-slate-900 tracking-tight"
                                            value={searchTerm}
                                            onChange={(e) => {
                                                setSearchTerm(e.target.value);
                                                setShowSearchDropdown(true);
                                            }}
                                            onFocus={() => setShowSearchDropdown(true)}
                                            onClick={() => setShowSearchDropdown(true)}
                                        />
                                        {searchTerm && (
                                            <button type="button" onClick={() => setSearchTerm('')} className="text-slate-900/30 hover:text-brick ml-2">
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                fetchProducts();
                                            }}
                                            className="text-slate-900/10 hover:text-slate-900 ml-3 border-l border-slate-900/10 pl-3 transition-all"
                                            title="Làm mới danh sách sản phẩm"
                                        >
                                            <span className="material-symbols-outlined text-xs">refresh</span>
                                        </button>
                                    </div>

                                    {showSearchDropdown && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/10 shadow-2xl rounded-sm z-[100] max-h-[400px] overflow-auto custom-scrollbar">
                                            {products
                                                .filter(p => !formData.items.some(item => item.product_id === p.id))
                                                .slice(0, 50)
                                                .map(p => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => addProductById(p.id)}
                                                        className="w-full p-3 text-left hover:bg-primary/5 border-b border-primary/5 flex items-center gap-3 transition-colors"
                                                    >
                                                        <div className="size-8 bg-primary/5 rounded-sm flex items-center justify-center text-primary/10 overflow-hidden shrink-0">
                                                            {p.main_image ? <img src={p.main_image} alt="" className="size-full object-cover" /> : <span className="material-symbols-outlined text-sm">image</span>}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex justify-between items-center mb-0.5">
                                                                <span className="text-[13px] font-bold text-primary truncate tracking-wider">{p.sku || '---'}</span>
                                                                 <span className="text-[14px] font-extrabold text-blue-600 shrink-0 ml-4">{new Intl.NumberFormat('vi-VN').format(p.price)}₫</span>
                                                            </div>
                                                            <p className="text-[12px] text-primary/50 truncate font-medium">{p.name}</p>
                                                        </div>
                                                    </button>
                                                ))}
                                            {searchTerm.trim() !== '' && products.filter(p => !formData.items.some(item => item.product_id === p.id)).length === 0 && (
                                                <div className="p-4 text-center italic text-primary/20 text-[11px] uppercase font-black tracking-widest">Không có kết quả khả dụng...</div>
                                            )}
                                        </div>
                                    )}
                                    {showSearchDropdown && (
                                        <div className="fixed inset-0 z-[90]" onClick={() => setShowSearchDropdown(false)} />
                                    )}
                                </div>

                                {/* Scrollable Product Chips - Strictly Single Row */}
                                <div className="flex-[3] flex flex-nowrap gap-2 items-center overflow-x-auto overflow-y-hidden custom-scrollbar-horizontal pb-1 border-l border-blue-100/50 pl-4 h-[52px] min-w-0 mask-fade-right">
                                    {formData.items.map((item, index) => (
                                        <div key={item.product_id} className="bg-orange-50 hover:bg-orange-100/50 px-3 py-1.5 rounded-sm border border-orange-200 flex items-center gap-2 transition-all group/chip relative shadow-sm shrink-0">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <span className="text-[10px] text-orange-600/40 font-bold leading-none">{index + 1}.</span>
                                                <span className="text-[11px] text-orange-600 font-bold leading-none whitespace-nowrap tracking-tight">{item.sku || 'N/A'}</span>
                                            </div>
                                            <button type="button" onClick={() => removeItem(item.product_id)} className="text-orange-400 hover:text-brick transition-all leading-none transform hover:scale-125">
                                                <span className="material-symbols-outlined text-[12px]">close</span>
                                            </button>

                                            {/* Name Tooltip on Hover */}
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded shadow-xl opacity-0 group-hover/chip:opacity-100 pointer-events-none transition-all whitespace-nowrap z-[150] border border-white/10 scale-90 group-hover/chip:scale-100 origin-bottom">
                                                {item.name}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-800"></div>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Small spacer to ensure last item is visible */}
                                    <div className="w-4 shrink-0 h-full"></div>
                                </div>
                            </div>
                        </div>

                             {/* Captured Area for Screenshot */}
                        <div ref={captureRef} className="bg-white px-12 pb-12 pt-6 -mx-12 rounded-sm shadow-sm border border-primary/5">
                            <div className="relative min-h-[400px]">
                                <table className="w-full text-left border-collapse table-fixed lg:table-auto">
                                    <thead className="font-display text-[11px] font-extrabold text-blue-600 bg-blue-50 sticky top-0 z-30 shadow-sm border-b border-blue-100">
                                        <tr>
                                            {/* Column Config Header */}
                                            <th className="w-12 border border-blue-100 bg-blue-50 shrink-0 relative text-center sticky top-0 z-30">
                                                <div className="flex items-center justify-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowColumnConfig(!showColumnConfig)}
                                                        className="size-7 flex items-center justify-center hover:bg-primary/10 rounded-full transition-colors group z-50"
                                                        title="Cấu hình cột"
                                                    >
                                                        <span className="material-symbols-outlined text-primary/30 group-hover:text-primary text-lg">settings_backup_restore</span>
                                                    </button>

                                                    <AnimatePresence>
                                                        {showColumnConfig && (
                                                            <>
                                                                <div className="fixed inset-0 z-[190]" onClick={() => setShowColumnConfig(false)} />
                                                                <motion.div
                                                                    initial={{ opacity: 0, x: -10 }}
                                                                    animate={{ opacity: 1, x: 0 }}
                                                                    exit={{ opacity: 0, x: -10 }}
                                                                    className="absolute top-10 left-0 bg-white border border-primary/10 shadow-2xl rounded-sm p-4 z-[200] w-64 normal-case text-left"
                                                                >
                                                                    <h4 className="font-display text-sm font-bold text-primary/50 mb-4">Cấu hình cột hiển thị</h4>
                                                                    <div className="space-y-1">
                                                                        <Reorder.Group axis="y" values={columnOrder} onReorder={setColumnOrder} className="space-y-1">
                                                                            {columnOrder.map(colId => (
                                                                                 <Reorder.Item key={colId} value={colId} className="flex items-center justify-between p-2 hover:bg-blue-50 rounded-sm cursor-grab active:cursor-grabbing border border-transparent hover:border-blue-100 group transition-all">
                                                                                    <div className="flex items-center gap-3">
                                                                                        <span className="material-symbols-outlined text-[16px] text-primary/20 group-hover:text-primary/40">drag_indicator</span>
                                                                                         <span className="text-[12px] font-bold text-primary">{COLUMN_DEFS[colId].label}</span>
                                                                                    </div>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (visibleColumns.includes(colId)) {
                                                                                                setVisibleColumns(visibleColumns.filter(c => c !== colId));
                                                                                                localStorage.setItem('order_form_visible_columns', JSON.stringify(visibleColumns.filter(c => c !== colId)));
                                                                                            } else {
                                                                                                setVisibleColumns([...visibleColumns, colId]);
                                                                                                localStorage.setItem('order_form_visible_columns', JSON.stringify([...visibleColumns, colId]));
                                                                                            }
                                                                                        }}
                                                                                        className={`material-symbols-outlined text-lg ${visibleColumns.includes(colId) ? 'text-primary' : 'text-primary/10'}`}
                                                                                    >
                                                                                        {visibleColumns.includes(colId) ? 'visibility' : 'visibility_off'}
                                                                                    </button>
                                                                                </Reorder.Item>
                                                                            ))}
                                                                        </Reorder.Group>
                                                                                                            <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const defOrder = ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
                                                                                const defVisible = ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
                                                                                const defWidths = { stt: 50, sku: 150, name: null, quantity: 90, price: 150, cost_price: 150, total: 170, actions: 60 };
                                                                                setColumnOrder(defOrder);
                                                                                setVisibleColumns(defVisible);
                                                                                setColumnWidths(defWidths);
                                                                            }}
                                                                            className="py-2 text-[12px] font-bold text-primary/40 hover:bg-primary/5 rounded-sm transition-all"
                                                                        >
                                                                            Mặc định
                                                                        </button>
                                                                    </div>
                                                                </motion.div>
                                                            </>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </th>
                                            {columnOrder.filter(id => visibleColumns.includes(id)).map((colId, idx) => {
                                                const def = COLUMN_DEFS[colId];
                                                const width = columnWidths[colId];
                                                return (
                                                    <th
                                                        key={colId}
                                                        className={`py-4 px-4 border border-blue-100 text-${def.align} relative group/header sticky top-0 z-30 bg-blue-50`}
                                                        style={width ? { width: `${width}px` } : { width: 'auto' }}
                                                    >
                                                          <span className="block whitespace-nowrap font-display text-[10px] font-black text-blue-600/60 uppercase tracking-[0.15em]">{def.label}</span>
                                                        {/* Resize Handle */}
                                                        <div
                                                            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 z-20 transition-colors opacity-0 group-hover/header:opacity-100"
                                                            onMouseDown={(e) => handleColumnResize(colId, e)}
                                                        />
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <Reorder.Group axis="y" values={formData.items} onReorder={handleReorder} as="tbody" className="font-sans text-sm font-medium">
                                        {formData.items.map((item, index) => (
                                            <Reorder.Item
                                                key={item.product_id}
                                                value={item}
                                                as="tr"
                                                className="hover:bg-primary/[0.01] transition-colors group cursor-grab active:cursor-grabbing active:border-primary/20 bg-white"
                                            >
                                                <td className="border border-primary/10 bg-primary/5 text-center">
                                                    <span className="material-symbols-outlined text-[16px] text-primary/10 group-hover:text-primary/30 font-bold">drag_indicator</span>
                                                </td>
                                                {columnOrder.filter(id => visibleColumns.includes(id)).map(colId => {
                                                    switch (colId) {
                                                        case 'stt':
                                                            return <td key={colId} className="py-2.5 text-center text-primary/30 font-display text-[12px] font-bold border border-primary/10">{index + 1}</td>;
                                                        case 'sku':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-4 border border-primary/10">
                                                                    <p className="font-display text-[13px] text-primary font-bold leading-none">{item.sku || '---'}</p>
                                                                </td>
                                                            );
                                                        case 'name':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-4 border border-primary/10">
                                                                    <p className="text-primary font-bold text-[13px] leading-tight">{item.name}</p>
                                                                </td>
                                                            );
                                                        case 'quantity':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-3 border border-primary/10 text-center">
                                                                    <input
                                                                        type="number"
                                                                        value={item.quantity}
                                                                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 0)}
                                                                         className="w-16 h-8 text-center bg-blue-50/50 border-none focus:bg-white focus:ring-1 focus:ring-blue-200 focus:outline-none text-[13px] font-bold rounded-sm shadow-inner text-slate-900"
                                                                    />
                                                                </td>
                                                            );
                                                        case 'price':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-4 border border-primary/10">
                                                                    <div className="flex items-center justify-end">
                                                                        <input
                                                                            type="text"
                                                                            value={new Intl.NumberFormat('vi-VN').format(item.price)}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                                                updateItem(index, 'price', parseInt(val) || 0);
                                                                            }}
                                                                             className="w-full h-8 bg-transparent border-none text-right font-display text-[13px] font-bold text-slate-900 border-b border-blue-100 focus:border-blue-300 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-slate-900/30 text-[11px] ml-1">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'cost_price':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-4 border border-primary/10">
                                                                    <div className="flex items-center justify-end">
                                                                        <input
                                                                            type="text"
                                                                            value={new Intl.NumberFormat('vi-VN').format(item.cost_price)}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                                                updateItem(index, 'cost_price', parseInt(val) || 0);
                                                                            }}
                                                                            className="w-full bg-transparent border-none text-right font-display text-[13px] font-bold text-primary/30 border-b border-primary/5 focus:border-primary/10 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-primary text-[10px] ml-1 opacity-10">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'total':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-6 border border-primary/10 text-right bg-blue-50/30">
                                                                    <p className="font-display text-[13px] font-extrabold text-slate-900 tracking-tight">
                                                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(item.price * item.quantity)}<span className="text-[11px] ml-0.5 opacity-40">₫</span>
                                                                    </p>
                                                                </td>
                                                            );
                                                        case 'actions':
                                                            return (
                                                                <td key={colId} className="py-2.5 text-center border border-primary/10">
                                                                    <button type="button" onClick={() => removeItem(item.product_id)} className="text-primary/10 hover:text-brick transition-all transform hover:scale-125">
                                                                        <span className="material-symbols-outlined text-[20px]">delete_outline</span>
                                                                    </button>
                                                                </td>
                                                            );
                                                        default:
                                                            return null;
                                                    }
                                                })}
                                            </Reorder.Item>
                                        ))}
                                        {formData.items.length === 0 && (
                                            <tr>
                                                <td colSpan={visibleColumns.length + 1} className="py-16 text-center italic text-primary/30 text-[12px] font-bold border border-primary/10 bg-primary/5">Phần này để hiển thị sản phẩm đã chọn...</td>
                                            </tr>
                                        )}
                                    </Reorder.Group>
                                </table>
                            </div>

                            <div className="flex justify-end pt-8 border-t-2 border-primary/10 mt-2">
                                <div className="flex items-baseline gap-4">
                                    <span className="font-display font-bold text-brick/60 text-[12px]">Tổng thanh toán:</span>
                                    <span className="font-display font-black text-brick text-[32px] leading-none tracking-tighter">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(calculateTotal())}<span className="text-[16px] ml-1 opacity-40 font-bold">₫</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-primary/10 section-summary bg-primary/5 -mx-12 px-12 pb-8 rounded-b-md">
                            {/* Right: Totals */}
                            <div className="space-y-4 font-display min-w-[340px]">
                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Tổng tiền sản phẩm:</span>
                                    <span className="font-bold text-blue-600 text-[16px] leading-none">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(calculateSubtotal())}₫
                                    </span>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Phí vận chuyển:</span>
                                    <div className="flex items-center gap-1 border-b border-blue-600/10 focus-within:border-blue-600/40 transition-colors">
                                        <input
                                            type="text"
                                            value={new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(formData.shipping_fee)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                setFormData(prev => ({ ...prev, shipping_fee: parseInt(val) || 0 }));
                                            }}
                                             className="w-24 text-right bg-transparent py-1 font-bold text-blue-600 text-[15px] focus:outline-none placeholder:text-blue-600/10"
                                         />
                                         <span className="font-bold text-blue-600 text-[15px]">₫</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Chiết khấu/Giảm:</span>
                                    <div className="flex items-center gap-1 border-b border-blue-600/10 focus-within:border-blue-600/40 transition-colors">
                                        <input
                                            type="text"
                                            value={new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(formData.discount)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                setFormData(prev => ({ ...prev, discount: parseInt(val) || 0 }));
                                            }}
                                             className="w-24 text-right bg-transparent py-1 font-bold text-brick text-[15px] focus:outline-none placeholder:text-blue-600/10"
                                         />
                                         <span className="font-bold text-brick text-[15px]">₫</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-blue-600/10" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/30 text-[12px]">Tổng giá vốn nhập:</span>
                                    <div className="flex items-center gap-1 font-bold text-blue-600/50 text-sm">
                                        <span className="bg-blue-600/5 px-2 py-0.5 rounded-sm">{new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(formData.cost_total)}₫</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Section: Sidebar Metadata */}
                <div className="lg:col-span-4">
                    <div className="bg-white border border-primary/10 p-6 shadow-22xl rounded-sm sticky top-6">
                        <div className="flex items-center gap-3 mb-8 pb-4 border-b border-primary/5">
                            <div className="size-8 bg-primary/5 rounded-sm flex items-center justify-center">
                                <span className="material-symbols-outlined text-primary text-[20px]">assignment</span>
                            </div>
                            <h3 className="font-display text-[15px] font-bold text-primary">Thông tin đơn hàng</h3>
                        </div>

                        <Field label="Trạng thái">
                            <select
                                name="status"
                                value={formData.status}
                                onChange={handleInputChange}
                                className="w-full bg-transparent focus:outline-none font-display text-[13px] font-bold text-primary appearance-none cursor-pointer"
                            >
                                {orderStatuses.filter(s => s.is_active || (formData.status && s.code.toLowerCase() === formData.status.toLowerCase())).map(s => (
                                    <option key={s.id} value={s.code}>{s.name || s.code}</option>
                                ))}
                                {formData.status && !orderStatuses.some(s => s.code.toLowerCase() === formData.status.toLowerCase()) && (
                                    <option value={formData.status}>{formData.status}</option>
                                )}
                            </select>
                        </Field>

                        <Field label="Nhân viên xử lý">
                            <p className="font-display text-[13px] font-bold text-primary/60 leading-none">{user?.name || "Super Admin"}</p>
                        </Field>

                        <Field label="Tên khách hàng">
                            <input
                                type="text"
                                name="customer_name"
                                value={formData.customer_name}
                                onChange={handleInputChange}
                                className="w-full bg-transparent focus:outline-none font-display font-bold text-[13px] text-primary"
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Số điện thoại">
                            <input
                                type="text"
                                name="customer_phone"
                                value={formData.customer_phone}
                                onChange={handleInputChange}
                                className="w-full bg-transparent focus:outline-none font-display font-bold text-[13px] text-primary"
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Địa chỉ giao hàng" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="shipping_address"
                                value={formData.shipping_address}
                                onChange={handleInputChange}
                                rows="3"
                                className="w-full bg-transparent focus:outline-none font-display font-bold text-[13px] resize-none leading-relaxed text-primary/80"
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Ghi chú đơn hàng" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleInputChange}
                                rows="3"
                                    className="w-full bg-transparent focus:outline-none font-display font-bold text-[13px] leading-relaxed text-primary"
                                placeholder="..."
                            />
                        </Field>

                        <div className="pt-2 pb-2">
                            <h4 className="font-display text-[15px] font-bold text-primary mb-6 flex items-center justify-center gap-2 uppercase tracking-[0.1em]">
                                <span className="h-px bg-primary/10 flex-1"></span>
                                Thông tin bổ sung
                                <span className="h-px bg-primary/10 flex-1"></span>
                            </h4>
                            <div className="grid grid-cols-1 gap-1">
                                {attributes.map(attr => (
                                    <Field key={attr.id} label={attr.name}>
                                        <input
                                            type="text"
                                            value={formData.custom_attributes[attr.code] || ''}
                                            onChange={(e) => handleAttributeChange(attr.code, e.target.value)}
                                            className="w-full bg-transparent focus:outline-none font-display font-bold text-[13px] text-primary"
                                            placeholder={`...`}
                                        />
                                    </Field>
                                ))}
                            </div>
                        </div>

                        <div className="pt-6">
                            <button
                                type="button"
                                onClick={() => navigate('/admin/orders')}
                                className="w-full bg-primary/5 text-primary/40 font-display font-bold text-[12px] py-4 hover:bg-primary/10 transition-all border border-primary/10 rounded-sm"
                            >
                                Quay về danh sách
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default OrderForm;
