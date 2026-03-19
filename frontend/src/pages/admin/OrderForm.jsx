import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { orderApi, productApi, attributeApi, orderStatusApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import { toPng, toBlob } from 'html-to-image';
import SearchableSelect from '../../components/SearchableSelect';
import { VN_REGIONS } from '../../data/regions';
import {
    buildRegionPath,
    buildShippingAddress,
    extractCustomerInfoFromText,
    extractAddressDetail,
    parseAdministrativeAddress,
    sortRegionObjects,
    sortRegionStrings,
    validateVietnamesePhone
} from '../../utils/administrativeUnits';

const AdminSection = ({ icon, title, children, className = '', bodyClassName = '' }) => (
    <section className={`bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden ${className}`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.02]">
            <span className="material-symbols-outlined text-[18px] text-primary/50">{icon}</span>
            <h3 className="text-[13px] font-black uppercase tracking-[0.1em] text-primary">{title}</h3>
        </div>
        <div className={`p-4 space-y-[10px] ${bodyClassName}`}>{children}</div>
    </section>
);

const AdminField = ({ label, children, required = false, className = '' }) => (
    <div className={`space-y-1 ${className}`}>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-primary/70">
            {label}
            {required && <span className="text-brick"> *</span>}
        </label>
        {children}
    </div>
);

const Field = ({ label, children, className = '' }) => (
    React.Children.toArray(children).some((child) => React.isValidElement(child) && child.props?.readOnly && child.props?.name === 'shipping_address')
        ? null
        : (
            <div className={`space-y-1 ${className}`}>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-primary/70">{label}</label>
                {children}
            </div>
        )
);

const adminInputClassName = 'w-full h-10 bg-primary/5 border border-primary/10 px-3 rounded-sm text-[14px] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all';
const adminTextareaClassName = 'w-full min-h-[88px] bg-primary/5 border border-primary/10 px-3 py-2 rounded-sm text-[14px] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all resize-none';
const adminRegionFieldClassName = 'group relative min-w-0 min-h-[42px] rounded-sm border border-primary/10 bg-primary/5 px-2 py-1 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-white flex flex-col justify-center';
const adminRegionLabelClassName = 'mb-1 block text-[8px] font-bold uppercase tracking-widest leading-none text-slate-400 transition-colors pointer-events-none group-focus-within:text-primary';
const adminRegionClearButtonClassName = 'absolute right-1.5 top-1.5 z-[5] size-4 rounded-full border border-primary/10 bg-white/90 text-primary/35 hover:text-brick hover:border-brick/20 transition-all flex items-center justify-center shadow-sm';

const ProductSearchOption = ({ product, onSelect }) => {
    const skuRef = useRef(null);
    const nameRef = useRef(null);
    const [hasTruncation, setHasTruncation] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const checkTruncation = useCallback(() => {
        const skuTruncated = skuRef.current && skuRef.current.scrollWidth > skuRef.current.clientWidth + 1;
        const nameTruncated = nameRef.current && nameRef.current.scrollWidth > nameRef.current.clientWidth + 1;
        return Boolean(skuTruncated || nameTruncated);
    }, []);

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setHasTruncation(checkTruncation());
        });

        const handleResize = () => {
            setHasTruncation(checkTruncation());
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [checkTruncation, product.name, product.sku]);

    const handleMouseEnter = () => {
        setHasTruncation(checkTruncation());
        setIsHovered(true);
    };

    return (
        <button
            type="button"
            onClick={() => onSelect(product.id)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setIsHovered(false)}
            className="w-full px-3 py-2.5 text-left hover:bg-primary/5 border-b border-primary/5 flex items-center gap-3 transition-colors group relative overflow-visible"
        >
            <div className="size-8 bg-primary/5 rounded-sm flex items-center justify-center text-primary/10 overflow-hidden shrink-0">
                {product.main_image ? <img src={product.main_image} alt="" className="size-full object-cover" /> : <span className="material-symbols-outlined text-sm">image</span>}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5 gap-3">
                    <span ref={skuRef} className="text-[13px] font-bold text-primary truncate tracking-tight">{product.sku || '---'}</span>
                    <span className="text-[14px] font-extrabold text-blue-600 shrink-0 ml-4">{new Intl.NumberFormat('vi-VN').format(product.price)}₫</span>
                </div>
                <p ref={nameRef} className="text-[12px] text-primary/50 truncate font-medium">{product.name || '---'}</p>
            </div>

            {isHovered && hasTruncation && (
                <div className="pointer-events-none absolute left-11 right-3 top-1/2 z-[120] -translate-y-1/2 rounded-sm border border-primary/10 bg-white/95 px-3 py-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] ring-1 ring-black/5 backdrop-blur-sm">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45 break-all">
                        {product.sku || '---'}
                    </div>
                    <div className="mt-1 text-[12px] font-semibold leading-5 text-[#0F172A] break-words">
                        {product.name || '---'}
                    </div>
                </div>
            )}
        </button>
    );
};

const OrderForm = () => {
    const { id } = useParams();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const duplicateFromId = queryParams.get('duplicate_from');
    const isEdit = !!id;
    const navigate = useNavigate();
    const { user } = useAuth();
    const { showModal } = useUI();

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
        address_detail: '',
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
        status: 'new',
        province: ''
    });

    const [provinces, setProvinces] = useState([]);
    const [districts, setDistricts] = useState([]);
    const [wards, setWards] = useState([]);
    const [regionType, setRegionType] = useState('new');
    const [addressDetection, setAddressDetection] = useState(null);
    const useNewAddress = regionType === 'new';
    const isWardsLoading = false;
    const isDistrictsLoading = false;

    useEffect(() => {
        fetchInitialData();
        if (isEdit) {
            fetchOrder(id);
        } else if (duplicateFromId) {
            fetchOrder(duplicateFromId, true);
        }
    }, [id, duplicateFromId]);

    useEffect(() => {
        const nextProvinces = sortRegionObjects(VN_REGIONS[regionType] || []);
        setProvinces(nextProvinces);
        setDistricts([]);
        setWards([]);

        setFormData(prev => {
            const provinceExists = nextProvinces.some((province) => province.name === prev.province);
            const nextData = {
                ...prev,
                province: provinceExists ? prev.province : '',
                district: provinceExists && regionType === 'old' ? prev.district : '',
                ward: provinceExists ? prev.ward : ''
            };

            return nextData;
        });
    }, [regionType]);

    const handleProvinceChange = (e) => {
        const provinceName = e.target.value;
        const provinceData = provinces.find((province) => province.name === provinceName);

        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            province: provinceName,
            district: '',
            ward: ''
        }));

        if (regionType === 'old') {
            setDistricts(sortRegionObjects(provinceData?.districts || []));
            setWards([]);
            return;
        }

        setDistricts([]);
        setWards(sortRegionStrings(provinceData?.wards || []));
    };

    const handleDistrictChange = (e) => {
        const districtName = e.target.value;
        const districtData = districts.find((district) => district.name === districtName);

        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            district: districtName,
            ward: ''
        }));
        setWards(sortRegionStrings(districtData?.wards || []));
    };

    const handleWardChange = (e) => {
        const wardName = e.target.value;
        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({ ...prev, ward: wardName }));
    };

    const syncShippingAddress = useCallback((nextData, nextRegionType = regionType) => ({
        ...nextData,
        shipping_address: nextData.shipping_address || nextData.address_detail || ''
    }), [regionType]);

    const clearProvince = useCallback(() => {
        setAddressDetection(null);
        setDistricts([]);
        setWards([]);
        setFormData(prev => syncShippingAddress({
            ...prev,
            province: '',
            district: '',
            ward: ''
        }));
    }, [syncShippingAddress]);

    const clearDistrict = useCallback(() => {
        setAddressDetection(null);
        setWards([]);
        setFormData(prev => syncShippingAddress({
            ...prev,
            district: '',
            ward: ''
        }));
    }, [syncShippingAddress]);

    const clearWard = useCallback(() => {
        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            ward: ''
        }));
    }, [syncShippingAddress]);

    useEffect(() => {
        if (!formData.province) {
            setDistricts([]);
            setWards([]);
            return;
        }

        const provinceData = provinces.find((province) => province.name === formData.province);
        if (!provinceData) return;

        if (regionType === 'old') {
            const nextDistricts = sortRegionObjects(provinceData.districts || []);
            setDistricts(nextDistricts);
            const districtData = nextDistricts.find((district) => district.name === formData.district);
            setWards(sortRegionStrings(districtData?.wards || []));
            return;
        }

        setDistricts([]);
        setWards(sortRegionStrings(provinceData.wards || []));
    }, [formData.province, formData.district, provinces, regionType]);

    const detectAdministrativeAddress = useCallback((rawAddress) => {
        const trimmedAddress = (rawAddress || '').trim();
        if (!trimmedAddress) {
            setAddressDetection(null);
            return;
        }

        const parsed = parseAdministrativeAddress(trimmedAddress, VN_REGIONS);
        const extracted = extractCustomerInfoFromText(trimmedAddress);

        if (!parsed || parsed.confidence === 'none') {
            setAddressDetection({
                type: 'warning',
                message: 'Không tự nhận diện chắc chắn. Vui lòng kiểm tra lại đơn vị hành chính.'
            });
            setFormData(prev => ({
                ...prev,
                customer_name: extracted.customerName || prev.customer_name,
                customer_phone: extracted.customerPhone || prev.customer_phone,
                province: '',
                district: '',
                ward: '',
                shipping_address: extracted.addressText || trimmedAddress,
                address_detail: extracted.addressText || trimmedAddress
            }));
            return;
        }

        setRegionType(parsed.regionType);
        setFormData(prev => syncShippingAddress({
            ...prev,
            customer_name: parsed.customerName || prev.customer_name,
            customer_phone: parsed.customerPhone || prev.customer_phone,
            shipping_address: parsed.addressText,
            address_detail: parsed.addressDetail,
            province: parsed.province,
            district: parsed.district || '',
            ward: parsed.ward || ''
        }, parsed.regionType));
        setAddressDetection({
            type: parsed.confidence === 'exact' ? 'success' : 'warning',
            message: parsed.confidence === 'exact'
                ? 'Đã tự nhận diện địa chỉ và điền sẵn thông tin khách hàng.'
                : 'Đã tự nhận diện gần đúng. Vui lòng kiểm tra lại trước khi lưu.'
        });
    }, [syncShippingAddress]);

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
                attributeApi.getAll({ entity_type: 'order', active_only: true })
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

            setRegionType(order.district ? 'old' : 'new');
            setFormData({
                customer_name: order.customer_name || '',
                customer_email: order.customer_email || '',
                customer_phone: order.customer_phone || '',
                address_detail: extractAddressDetail({
                    shippingAddress: order.shipping_address || '',
                    province: order.province || '',
                    district: order.district || '',
                    ward: order.ward || '',
                    regionType: order.district ? 'old' : 'new'
                }),
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
                shipment_status: isDuplicating ? 'Chưa giao' : (order.shipment_status || 'Chưa giao'),
                province: order.province || '',
                district: order.district || '',
                ward: order.ward || ''
            });
            setRegionType(order.district ? 'old' : 'new');

        } catch (error) {
            console.error("Error fetching order", error);
            if (error.response?.status === 404) {
                showModal({ title: 'Lỗi', content: 'Đơn hàng không tồn tại hoặc đã bị xóa.', type: 'error' });
            } else {
                showModal({ title: 'Lỗi', content: 'Không thể tải thông tin đơn hàng.', type: 'error' });
            }
            navigate('/admin/orders');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'address_detail') {
            setAddressDetection(null);
            setFormData(prev => syncShippingAddress({ ...prev, address_detail: value }));
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleShippingAddressChange = (e) => {
        const value = e.target.value;
        setAddressDetection(null);
        setFormData(prev => ({
            ...prev,
            shipping_address: value,
            address_detail: value
        }));
    };

    const handleShippingAddressPaste = (e) => {
        const pastedText = e.clipboardData.getData('text');
        if (!pastedText) return;

        e.preventDefault();
        detectAdministrativeAddress(pastedText);
    };

    const handleShippingAddressBlur = (e) => {
        detectAdministrativeAddress(e.target.value);
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
        
        // Validate location
        const isLocValid = regionType === 'new'
            ? (formData.province && formData.ward)
            : (formData.province && formData.district && formData.ward);

        if (!isLocValid) {
            alert(regionType === 'new' ? 'Vui lòng chọn Tỉnh/Thành phố và Phường/Xã.' : 'Vui lòng chọn đầy đủ Tỉnh, Quận và Phường.');
            return;
        }

        const normalizedAddressDetail = extractAddressDetail({
            shippingAddress: formData.shipping_address.trim(),
            ward: formData.ward,
            district: formData.district,
            province: formData.province,
            regionType
        });
        const effectiveAddressDetail = normalizedAddressDetail || formData.address_detail.trim() || formData.shipping_address.trim();

        if (!effectiveAddressDetail) {
            alert('Vui lòng nhập địa chỉ giao hàng.');
            return;
        }

        if (formData.customer_phone && !validateVietnamesePhone(formData.customer_phone)) {
            alert('Số điện thoại không hợp lệ.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...formData,
                address_detail: effectiveAddressDetail,
                shipping_address: buildShippingAddress({
                    addressDetail: effectiveAddressDetail,
                    ward: formData.ward,
                    district: formData.district,
                    province: formData.province,
                    regionType
                }),
                custom_attributes: {
                    ...formData.custom_attributes,
                    region_type: regionType === 'new' ? 'Địa giới mới' : 'Địa giới cũ',
                    full_region_path: buildRegionPath({
                        ward: formData.ward,
                        district: formData.district,
                        province: formData.province,
                        regionType
                    })
                }
            };

            if (isEdit) {
                await orderApi.update(id, payload);
            } else {
                await orderApi.store(payload);
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
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-y-auto">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .admin-header-title { font-size: 15px !important; font-weight: 800 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
                .admin-table-header { font-size: 11px !important; font-weight: 900 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.15em !important; background-color: #F0F4F8 !important; }
                .order-form-table::-webkit-scrollbar { width: 10px; height: 10px; }
                .order-form-table::-webkit-scrollbar-track { background: #F0F4F8; }
                .order-form-table::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
            `}</style>
            <div className="flex-none bg-[#F8FAFC] pb-4 space-y-2">
                <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleCancel}
                        className="size-9 flex items-center justify-center bg-white border border-primary/10 text-primary/50 hover:text-brick hover:border-brick/20 rounded-sm shadow-sm transition-all"
                        title="Quay lại"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    </button>
                    <div>
                        <h1 className="admin-header-title italic">
                            {isEdit ? "Chỉnh sửa đơn hàng" : "Tạo đơn hàng mới"}
                        </h1>
                        <p className="font-sans text-[12px] font-medium text-primary/40">Trang quản trị / Đơn hàng / {isEdit ? `Chi tiết #${id}` : "Thêm mới"}</p>
                    </div>
                </div>

                {/* Close/Action buttons like OrderList */}
                <div className="flex items-center gap-2">
                     <button
                        type="button"
                        onClick={handleCancel}
                        className="px-4 h-9 bg-white border border-primary/10 text-primary/60 hover:text-brick text-[12px] font-semibold rounded-sm transition-all"
                    >
                        Hủy thoát
                    </button>
                    <button
                        type="submit"
                        form="order-form"
                        disabled={saving}
                        className="bg-primary text-white px-4 h-9 rounded-sm text-[12px] font-semibold hover:bg-brick transition-all shadow-sm flex items-center gap-2"
                    >
                        <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`}>
                            {saving ? 'progress_activity' : 'save'}
                        </span>
                        {saving ? 'Đang lưu' : 'Lưu dữ liệu'}
                    </button>
                </div>
            </div>

                <div className="hidden bg-white border border-primary/10 p-2 shadow-sm rounded-sm flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-primary/40">receipt_long</span>
                        <span className="text-[13px] font-bold text-primary">Biên tập đơn hàng</span>
                    </div>
                    <div className="flex lg:hidden items-center gap-2">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="px-3 h-9 bg-white border border-primary/10 text-primary/60 hover:text-brick text-[12px] font-semibold rounded-sm transition-all"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            form="order-form"
                            disabled={saving}
                            className="bg-primary text-white px-3 h-9 rounded-sm text-[12px] font-semibold hover:bg-brick transition-all shadow-sm flex items-center gap-2"
                        >
                            <span className={`material-symbols-outlined text-[16px] ${saving ? 'animate-spin' : ''}`}>
                                {saving ? 'progress_activity' : 'save'}
                            </span>
                            Lưu
                        </button>
                    </div>
                </div>
            </div>

            <form id="order-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-[10px] flex-1 min-h-0">
                {/* Left Section: Product Management & Custom Attributes */}
                <div className="flex flex-col gap-[10px] max-w-full min-w-0">
                    <div className="bg-white border border-primary/10 p-4 shadow-sm rounded-sm">
                        {/* Title & Product Selector Tags */}
                        <div className="flex flex-col xl:flex-row xl:items-center gap-[10px] border-b border-primary/10 pb-4">
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
                            <div className="flex-1 flex flex-col xl:flex-row gap-[10px] xl:items-center relative z-[100] min-w-0">
                                {/* Flexible Search Input */}
                                <div className="relative min-w-[320px] flex-1">
                                    <div className="flex items-center bg-primary/5 border border-primary/10 rounded-sm px-3 h-10 focus-within:border-primary/30 focus-within:bg-white transition-all shadow-sm">
                                        <span className="material-symbols-outlined text-[16px] text-primary/40 mr-2">search</span>
                                        <input
                                            type="text"
                                            placeholder="Gõ mã hoặc tên sản phẩm..."
                                            className="bg-transparent text-[14px] placeholder:text-primary/30 focus:outline-none flex-1 font-medium text-[#0F172A] tracking-tight"
                                            value={searchTerm}
                                            onChange={(e) => {
                                                setSearchTerm(e.target.value);
                                                setShowSearchDropdown(true);
                                            }}
                                            onFocus={() => setShowSearchDropdown(true)}
                                            onClick={() => setShowSearchDropdown(true)}
                                        />
                                        {searchTerm && (
                                            <button type="button" onClick={() => setSearchTerm('')} className="text-primary/30 hover:text-brick ml-2">
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                fetchProducts();
                                            }}
                                            className="text-primary/30 hover:text-primary ml-3 border-l border-primary/10 pl-3 transition-all"
                                            title="Làm mới danh sách sản phẩm"
                                        >
                                            <span className="material-symbols-outlined text-xs">refresh</span>
                                        </button>
                                    </div>

                                    {showSearchDropdown && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl rounded-sm z-[100] max-h-[400px] overflow-auto custom-scrollbar">
                                            {products
                                                .filter(p => !formData.items.some(item => item.product_id === p.id))
                                                .slice(0, 50)
                                                .map(p => (
                                                    <ProductSearchOption
                                                        key={p.id}
                                                        product={p}
                                                        onSelect={addProductById}
                                                    />
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
                                <div className="flex-[3] flex flex-nowrap gap-2 items-center overflow-x-auto overflow-y-hidden custom-scrollbar pb-1 border border-primary/10 bg-primary/5 rounded-sm px-2 h-[42px] min-w-0">
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
                        <div ref={captureRef} className="bg-white mt-[10px] rounded-sm shadow-xl border border-primary/10 overflow-hidden">
                            <div className="relative min-h-[400px] overflow-auto order-form-table">
                                <table className="w-full text-left border-collapse table-fixed lg:table-auto">
                                    <thead className="admin-table-header sticky top-0 z-30 shadow-sm border-b border-primary/10">
                                        <tr>
                                            {/* Column Config Header */}
                                            <th className="w-12 border border-primary/10 bg-[#F0F4F8] shrink-0 relative text-center sticky top-0 z-30">
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
                                                                    <h4 className="font-sans text-sm font-bold text-primary/50 mb-4">Cấu hình cột hiển thị</h4>
                                                                    <div className="space-y-1">
                                                                        <Reorder.Group axis="y" values={columnOrder} onReorder={setColumnOrder} className="space-y-1">
                                                                            {columnOrder.map(colId => (
                                                                                 <Reorder.Item key={colId} value={colId} className="flex items-center justify-between p-2 hover:bg-primary/5 rounded-sm cursor-grab active:cursor-grabbing border border-transparent hover:border-primary/10 group transition-all">
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
                                                        className={`py-3 px-4 border border-primary/10 text-${def.align} relative group/header sticky top-0 z-30 bg-[#F0F4F8]`}
                                                        style={width ? { width: `${width}px` } : { width: 'auto' }}
                                                    >
                                                          <span className="block whitespace-nowrap text-primary font-black uppercase tracking-[0.15em]">{def.label}</span>
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
                                                            return <td key={colId} className="py-2.5 text-center text-primary/30 font-sans text-[12px] font-bold border border-primary/10">{index + 1}</td>;
                                                        case 'sku':
                                                            return (
                                                <td key={colId} className="py-2.5 px-4 border border-primary/10 relative group/cell">
                                                    <p className="font-sans text-[13px] text-primary font-bold leading-none truncate max-w-[120px]">{item.sku || '---'}</p>
                                                    {/* Tooltip */}
                                                    <div className="absolute bottom-full left-4 mb-2 bg-slate-900 text-white p-2 rounded shadow-2xl opacity-0 group-hover/cell:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap text-[11px] font-bold border border-white/10 scale-90 group-hover/cell:scale-100 origin-bottom-left">
                                                        Mã: {item.sku || 'N/A'}
                                                        <div className="absolute top-full left-2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-900"></div>
                                                    </div>
                                                </td>
                                                            );
                                                        case 'name':
                                                            return (
                                               <td key={colId} className="py-2.5 px-4 border border-primary/10 relative group/cell">
                                                    <p className="text-primary font-bold text-[13px] leading-tight truncate max-w-[300px]">{item.name}</p>
                                                    {/* Tooltip */}
                                                    <div className="absolute bottom-full left-4 mb-2 bg-slate-900 text-white p-3 rounded shadow-2xl opacity-0 group-hover/cell:opacity-100 pointer-events-none transition-all z-50 w-80 text-[12px] font-bold border border-white/10 scale-95 group-hover/cell:scale-100 origin-bottom-left leading-relaxed">
                                                        {item.name}
                                                        <div className="absolute top-full left-4 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-900"></div>
                                                    </div>
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
                                                                             className="w-full h-8 bg-transparent border-none text-right font-sans text-[13px] font-bold text-slate-900 border-b border-blue-100 focus:border-blue-300 transition-all rounded-none px-1"
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
                                                                            className="w-full bg-transparent border-none text-right font-sans text-[13px] font-bold text-primary/30 border-b border-primary/5 focus:border-primary/10 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-primary text-[10px] ml-1 opacity-10">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'total':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-6 border border-primary/10 text-right bg-blue-50/30">
                                                                    <p className="font-sans text-[13px] font-extrabold text-slate-900 tracking-tight">
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

                            <div className="flex justify-end px-4 py-5 border-t border-primary/10 bg-white">
                                <div className="flex items-baseline gap-4">
                                    <span className="font-sans font-bold text-brick/60 text-[12px]">Tổng thanh toán:</span>
                                    <span className="font-sans font-black text-brick text-[32px] leading-none tracking-tighter">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(calculateTotal())}<span className="text-[16px] ml-1 opacity-40 font-bold">₫</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end p-4 border-t border-primary/10 bg-primary/[0.02]">
                            {/* Right: Totals */}
                            <div className="space-y-4 font-sans min-w-[340px]">
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
                <div className="w-full min-w-0 max-w-full flex flex-col gap-[10px]">
                    <div className="bg-white border border-primary/10 p-4 shadow-sm rounded-sm">
                        <div className="flex items-center gap-2.5 mb-[10px] border-b border-primary/10 pb-3">
                            <span className="material-symbols-outlined text-primary/40 text-[18px]">assignment</span>
                            <h3 className="font-sans text-[15px] font-bold text-primary uppercase tracking-tight">Thông tin đơn hàng</h3>
                        </div>

                        <div className="space-y-[10px]">
                            <Field label="Trạng thái">
                            <select
                                name="status"
                                value={formData.status}
                                onChange={handleInputChange}
                                className={adminInputClassName}
                            >
                                {orderStatuses.filter(s => s.is_active || (formData.status && s.code.toLowerCase() === formData.status.toLowerCase())).map(s => (
                                    <option key={s.id} value={s.code}>{s.name || s.code}</option>
                                ))}
                                {formData.status && !orderStatuses.some(s => s.code.toLowerCase() === formData.status.toLowerCase()) && (
                                    <option value={formData.status}>{formData.status}</option>
                                )}
                            </select>
                        </Field>
                        {addressDetection && (
                            <div className={`rounded-sm border px-3 py-2 text-[12px] ${addressDetection.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                {addressDetection.message}
                            </div>
                        )}

                        <Field label="Địa chỉ giao hàng tự động" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="shipping_address"
                                value={formData.shipping_address}
                                readOnly
                                rows="3"
                                className={`${adminTextareaClassName} bg-slate-50`}
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Nhân viên xử lý">
                            <div className={`${adminInputClassName} flex items-center text-primary/60 bg-slate-50`}>{user?.name || "Super Admin"}</div>
                        </Field>

                        <Field label="Tên khách hàng">
                            <input
                                type="text"
                                name="customer_name"
                                value={formData.customer_name}
                                onChange={handleInputChange}
                                className={adminInputClassName}
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Số điện thoại">
                            <input
                                type="text"
                                name="customer_phone"
                                value={formData.customer_phone}
                                onChange={handleInputChange}
                                className={`${adminInputClassName} ${formData.customer_phone && !validateVietnamesePhone(formData.customer_phone) ? 'border-brick' : ''}`}
                                placeholder="..."
                            />
                        </Field>

                        {/* Administrative Selection */}
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-black text-primary/40 uppercase tracking-widest leading-none">Đơn vị hành chính</span>
                            <div 
                                className="flex items-center gap-1 cursor-pointer p-0.5 bg-primary/5 rounded-full border border-primary/10"
                                onClick={() => setRegionType(useNewAddress ? 'old' : 'new')}
                            >
                                <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all ${useNewAddress ? 'bg-primary text-white shadow-sm' : 'text-primary/40'}`}>Mới nhất</div>
                                <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all ${!useNewAddress ? 'bg-orange-600 text-white shadow-sm' : 'text-primary/40'}`}>Cũ</div>
                            </div>
                        </div>

                        <div className={`grid ${useNewAddress ? 'grid-cols-[minmax(0,1.16fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1.24fr)_minmax(0,0.96fr)_minmax(0,1.04fr)]'} gap-[10px] mb-[10px]`}>
                            <div className={adminRegionFieldClassName}>
                                <span className={adminRegionLabelClassName}>
                                    Tỉnh / Thành phố
                                </span>
                                {formData.province && (
                                    <button
                                        type="button"
                                        onClick={clearProvince}
                                        className={adminRegionClearButtonClassName}
                                        title="Xóa Tỉnh/Thành phố"
                                    >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                    </button>
                                )}
                                <SearchableSelect
                                    options={(provinces || []).map(p => p.name)}
                                    value={formData.province}
                                    name="province"
                                    onChange={handleProvinceChange}
                                    placeholder="Tỉnh..."
                                    variant="admin"
                                />
                            </div>

                            {!useNewAddress && (
                            <div className={adminRegionFieldClassName}>
                                <span className={adminRegionLabelClassName}>
                                    Quận / Huyện
                                </span>
                                {formData.district && (
                                    <button
                                        type="button"
                                        onClick={clearDistrict}
                                        className={adminRegionClearButtonClassName}
                                        title="Xóa Quận/Huyện"
                                    >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                    </button>
                                )}
                                <SearchableSelect
                                    options={districts.map(d => d.name)}
                                    value={formData.district}
                                    name="district"
                                    onChange={handleDistrictChange}
                                    placeholder={useNewAddress ? "-" : (isDistrictsLoading ? "..." : "Quận...")}
                                    disabled={useNewAddress || !formData.province || isDistrictsLoading}
                                    variant="admin"
                                />
                            </div>

                            )}
                            <div className={adminRegionFieldClassName}>
                                <span className={adminRegionLabelClassName}>
                                    Phường / Xã
                                </span>
                                {formData.ward && (
                                    <button
                                        type="button"
                                        onClick={clearWard}
                                        className={adminRegionClearButtonClassName}
                                        title="Xóa Phường/Xã"
                                    >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                    </button>
                                )}
                                <SearchableSelect
                                    options={wards}
                                    value={formData.ward}
                                    name="ward"
                                    onChange={handleWardChange}
                                    placeholder={isWardsLoading ? "..." : "Phường..."}
                                    disabled={(!useNewAddress && !formData.district) || (useNewAddress && !formData.province) || isWardsLoading}
                                    variant="admin"
                                />
                            </div>
                        </div>

                        <Field label="Địa chỉ giao hàng (Số nhà, tên đường...)" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="shipping_address"
                                value={formData.shipping_address}
                                onChange={handleShippingAddressChange}
                                onPaste={handleShippingAddressPaste}
                                onBlur={handleShippingAddressBlur}
                                rows="3"
                                className={adminTextareaClassName}
                                placeholder="Dán hoặc nhập địa chỉ để tự nhận diện..."
                            />
                        </Field>

                        <Field label="Ghi chú đơn hàng" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleInputChange}
                                rows="3"
                                className={adminTextareaClassName}
                                placeholder="..."
                            />
                        </Field>

                        <div className="pt-2 pb-2">
                            <h4 className="font-sans text-[15px] font-bold text-primary mb-6 flex items-center justify-center gap-2 uppercase tracking-[0.1em]">
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
                                            className={adminInputClassName}
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
                                className="w-full bg-primary/5 text-primary/40 font-sans font-bold text-[12px] py-4 hover:bg-primary/10 transition-all border border-primary/10 rounded-sm uppercase tracking-widest"
                            >
                                Quay về danh sách
                            </button>
                        </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default OrderForm;
