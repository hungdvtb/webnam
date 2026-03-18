import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { productApi, wishlistApi, reviewApi } from '../services/api';
import ProductCard from '../components/ProductCard';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';

const ProductDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { addToCart } = useCart();
    const [product, setProduct] = useState(null);
    const [relatedProducts, setRelatedProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedAttributes, setSelectedAttributes] = useState({});
    const [currentVariant, setCurrentVariant] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [inWishlist, setInWishlist] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [activeTab, setActiveTab] = useState('description');
    const [selectedImage, setSelectedImage] = useState(0);
    const [newReview, setNewReview] = useState({ rating: 5, comment: '' });

    const { user } = useAuth();
    const { showModal } = useUI();

    useEffect(() => {
        const fetchProduct = async () => {
            setLoading(true);
            try {
                const response = await productApi.getOne(id);
                setProduct(response.data);
                setReviews(response.data.approved_reviews || []);

                // If configurable, set default variant or first available attributes
                if (response.data.type === 'configurable' && response.data.super_attributes?.length > 0) {
                    // Start with empty but could pre-select if needed
                }

                // Check wishlist status if user logged in
                if (user) {
                    const wishRes = await wishlistApi.get();
                    const isWish = wishRes.data.some(w => w.product_id === parseInt(id));
                    setInWishlist(isWish);
                }

                // Fetch related products (same category)
                if (response.data.category_id) {
                    const relatedResponse = await productApi.getAll({
                        category_id: response.data.category_id,
                        per_page: 3
                    });
                    setRelatedProducts(relatedResponse.data.data.filter(p => p.id !== parseInt(id)));
                }
            } catch (error) {
                console.error("Error fetching product", error);
            } finally {
                setLoading(false);
            }
        };
        fetchProduct();
        window.scrollTo(0, 0);
    }, [id, user]);

    // Update variant based on attribute selection
    useEffect(() => {
        if (product?.type === 'configurable' && product.linked_products) {
            const found = product.linked_products.find(child => {
                return product.super_attributes.every(attr => {
                    const childVal = child.attribute_values?.find(av => av.attribute_id === attr.id)?.value;
                    return selectedAttributes[attr.id] === childVal;
                });
            });
            setCurrentVariant(found || null);
            if (found && found.images?.length > 0) {
                // Optionally switch to variant image
                // const idx = product.images.findIndex(img => img.image_url === found.images[0].image_url);
                // if (idx !== -1) setSelectedImage(idx);
            }
        }
    }, [selectedAttributes, product]);

    const handleAttributeSelect = (attrId, value) => {
        setSelectedAttributes(prev => ({
            ...prev,
            [attrId]: value
        }));
    };

    const handleWishlistToggle = async () => {
        if (!user) {
            navigate('/login');
            return;
        }
        try {
            const res = await wishlistApi.toggle(product.id);
            setInWishlist(res.data.in_wishlist);
        } catch (error) {
            console.error("Wishlist error", error);
        }
    };

    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        try {
            await reviewApi.store(product.id, newReview);
            showModal({
                title: 'Thành công',
                content: 'Cảm ơn bạn! Đánh giá của bạn sẽ hiện sau khi được duyệt.',
                type: 'success'
            });
            setNewReview({ rating: 5, comment: '' });
        } catch (error) {
            showModal({
                title: 'Lỗi',
                content: 'Không thể gửi đánh giá. Vui lòng thử lại sau.',
                type: 'error'
            });
        }
    };

    const handleAddToCart = async () => {
        if (!user) {
            navigate('/login');
            return;
        }

        // Validation for configurable
        if (product.type === 'configurable' && !currentVariant) {
            showModal({
                title: 'Lưu ý',
                content: 'Vui lòng chọn đầy đủ các tùy chọn (Kích thước, Màu sắc...) trước khi thêm vào giỏ.',
                type: 'warning'
            });
            return;
        }

        const buyId = (product.type === 'configurable' && currentVariant) ? currentVariant.id : product.id;
        const success = await addToCart(buyId, quantity);
        if (success) {
            showModal({
                title: 'Giỏ hàng',
                content: 'Đã thêm sản phẩm vào giỏ hàng!',
                type: 'success',
                actionText: 'Đến giỏ hàng',
                onAction: () => navigate('/cart')
            });
        }
    };

    const handleBuyNow = async () => {
        if (!user) {
            navigate('/login');
            return;
        }
        const buyId = (product.type === 'configurable' && currentVariant) ? currentVariant.id : product.id;
        const success = await addToCart(buyId, quantity);
        if (success) {
            navigate('/cart');
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-background-light">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
            </div>
        );
    }

    if (!product) {
        return <div className="text-center py-20 bg-background-light">Sản phẩm không tồn tại.</div>;
    }

    const images = (product.images && product.images.length > 0)
        ? product.images.map(img => ({ ...img, image_url: img.image_url || 'https://placehold.co/800' }))
        : [{ image_url: 'https://placehold.co/800' }];
    const parseSpecifications = (specString) => {
        if (!specString) return [];
        
        // Handle JSON if possible
        try {
            if (typeof specString === 'string' && (specString.trim().startsWith('{') || specString.trim().startsWith('['))) {
                const parsed = JSON.parse(specString);
                if (Array.isArray(parsed)) {
                    return [{ key: 'Thông số chi tiết', value: parsed.join(', ') }];
                }
                return Object.entries(parsed).map(([key, value]) => ({ 
                    key, 
                    value: typeof value === 'object' ? JSON.stringify(value) : value 
                }));
            }
        } catch (e) { }

        // Standard line parsing
        return specString.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                const colonIndex = line.indexOf(':');
                if (colonIndex !== -1) {
                    return {
                        key: line.substring(0, colonIndex).trim(),
                        value: line.substring(colonIndex + 1).trim()
                    };
                }
                return { key: '', value: line };
            });
    };

    return (
        <main className="w-full max-w-[1280px] mx-auto px-6 lg:px-12 py-12 bg-background-light">
            {/* Breadcrumbs */}
            <nav className="mb-10 font-ui text-xs text-stone uppercase tracking-widest">
                <ol className="flex items-center gap-2">
                    <li><Link to="/" className="hover:text-primary transition-colors">Trang Chủ</Link></li>
                    <li className="text-gold">/</li>
                    <li><Link to="/shop" className="hover:text-primary transition-colors">Cửa Hàng</Link></li>
                    <li className="text-gold">/</li>
                    <li className="text-primary font-bold">{product.name}</li>
                </ol>
            </nav>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
                {/* Image Gallery */}
                <div className="lg:col-span-7 space-y-4">
                    <div className="relative aspect-square bg-white border-2 border-gold/20 overflow-hidden group cursor-zoom-in">
                        <img
                            src={images[selectedImage].image_url}
                            alt={product.name}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        />
                        {isSale && (
                            <div className="absolute top-6 left-6 bg-brick text-white px-4 py-2 font-ui font-bold text-xs uppercase tracking-widest shadow-lg">
                                Ưu Đãi
                            </div>
                        )}
                        {product.type === 'group' && (
                            <div className="absolute top-6 left-6 bg-primary text-white px-4 py-2 font-ui font-bold text-xs uppercase tracking-widest shadow-lg">
                                Combo Tiết Kiệm
                            </div>
                        )}
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hidden">
                        {images.map((img, idx) => (
                            <button
                                key={idx}
                                className={`flex-shrink-0 w-24 h-24 border-2 transition-all ${selectedImage === idx ? 'border-gold' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                onClick={() => setSelectedImage(idx)}
                            >
                                <img src={img.image_url} className="w-full h-full object-cover" alt="" />
                            </button>
                        ))}
                    </div>
                </div>

                {/* Product Info */}
                <div className="lg:col-span-5 space-y-8">
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <div className="flex justify-between items-start">
                                <span className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-gold">{product.category?.name}</span>
                                <div className="flex items-center gap-1 text-gold text-xs font-bold">
                                    <span className="material-symbols-outlined text-[14px]">star</span>
                                    {parseFloat(product.average_rating || 0).toFixed(1)} ({reviews.length})
                                </div>
                            </div>
                            <h1 className="text-primary font-display text-4xl lg:text-5xl font-bold leading-tight mb-2">{product.name}</h1>
                            
                            {/* SKU & Stock Row */}
                            <div className="flex items-center gap-2 text-[11px] font-ui uppercase tracking-widest text-stone mb-6">
                                <span>Mã {product.type === 'bundle' || product.type === 'group' ? 'bộ' : 'sản phẩm'}: <strong>{currentVariant ? currentVariant.sku : product.sku || 'N/A'}</strong></span>
                                <span className="size-1 rounded-full bg-gold/50 mx-1"></span>
                                <span className="text-[#00A381] font-bold flex items-center gap-1.5">
                                    <span className="size-1.5 bg-[#00A381] rounded-full"></span>
                                    Sẵn sàng giao ngay
                                </span>
                            </div>

                            {/* Bundle / Option Quick Selection moved exactly under SKU */}
                            {product?.type === 'bundle' && (
                                (() => {
                                    const relatedFromLinks = (product.linked_products || []).filter(p => p.pivot?.link_type === 'related');
                                    const allOptions = [product, ...relatedFromLinks];
                                    const uniqueOptions = Array.from(new Map(allOptions.map(b => [b.id, b])).values());
                                    
                                    if (uniqueOptions.length <= 1) return null;
                                    return (
                                        <div className="mb-8">
                                            <div className="flex flex-wrap gap-2">
                                                {uniqueOptions.map(bundle => {
                                                    const isSelected = bundle.id === product.id;
                                                    return (
                                                        <button
                                                            key={bundle.id}
                                                            onClick={() => {
                                                                if (!isSelected) {
                                                                    navigate(`/product/${bundle.slug}`);
                                                                }
                                                            }}
                                                            className={`px-4 py-2 border transition-all text-sm font-bold shadow-sm ${
                                                                isSelected 
                                                                    ? 'border-[#8e5229] bg-[#8e5229]/5 text-[#8e5229] shadow-inner' 
                                                                    : 'border-stone-300 bg-white hover:border-[#8e5229] hover:bg-stone-50 cursor-pointer text-stone-700'
                                                            }`}
                                                            title={bundle.name}
                                                        >
                                                            {bundle.name.replace(/Bộ đồ thờ men lam Bát Tràng - Demo Bundle|Bộ đồ thờ|Combo /i, '').trim() || bundle.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            {isSale ? (
                                <>
                                    <p className="font-body text-4xl text-brick italic">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(currentVariant ? currentVariant.current_price : product.current_price)}</p>
                                    <p className="font-body text-xl text-stone line-through">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(displayPrice)}</p>
                                </>
                            ) : (
                                <p className="font-body text-4xl text-brick italic">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(displayPrice)}</p>
                            )}
                        </div>
                    </div>

                    {/* Detailed Specifications Box */}
                    <div className="bg-white border border-gold/20 p-6 rounded-sm space-y-4 shadow-sm relative overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-gold/10 pb-3 mb-4">
                            <span className="material-symbols-outlined text-primary text-xl">info</span>
                            <h3 className="font-display font-bold text-xs uppercase tracking-[0.15em] text-primary">Thông số chi tiết</h3>
                        </div>
                        <div className="space-y-3.5">
                            <div className="flex justify-between items-start text-[11px] group">
                                <span className="text-stone/50 font-medium w-1/3 uppercase tracking-tighter">Tên & Phân loại</span>
                                <span className="text-primary font-bold w-2/3 text-right">{product.name}</span>
                            </div>
                            <div className="flex justify-between items-start text-[11px] group border-t border-gold/5 pt-3.5">
                                <span className="text-stone/50 font-medium w-1/3 uppercase tracking-tighter">Mã SKU</span>
                                <span className="text-primary font-bold w-2/3 text-right font-mono">{product.sku}</span>
                            </div>
                            {product.weight && (
                                <div className="flex justify-between items-start text-[11px] group border-t border-gold/5 pt-3.5">
                                    <span className="text-stone/50 font-medium w-1/3 uppercase tracking-tighter">Khối lượng</span>
                                    <span className="text-primary font-bold w-2/3 text-right">{product.weight} gram</span>
                                </div>
                            )}

                            {/* Attributes */}
                            {(product.attribute_values || []).map(av => (
                                <div key={av.id} className="flex justify-between items-start text-[11px] group border-t border-gold/5 pt-3.5">
                                    <span className="text-stone/50 font-medium w-1/3 uppercase tracking-tighter">{av.attribute?.name}</span>
                                    <span className="text-primary font-bold w-2/3 text-right uppercase tracking-tighter">
                                        {(() => {
                                            try {
                                                if (av.value && (av.value.startsWith('[') || av.value.startsWith('{'))) {
                                                    const parsed = JSON.parse(av.value);
                                                    return Array.isArray(parsed) ? parsed.join(', ') : av.value;
                                                }
                                            } catch (e) { }
                                            return av.value === '1' ? 'Có' : (av.value === '0' ? 'Không' : av.value);
                                        })()}
                                    </span>
                                </div>
                            ))}

                            {/* From Specifications Area */}
                            {parseSpecifications(product.specifications).map((spec, idx) => (
                                <div key={`spec-${idx}`} className="flex justify-between items-start text-[11px] group border-t border-gold/5 pt-3.5">
                                    <span className="text-stone/50 font-medium w-1/3 uppercase tracking-tighter">{spec.key || 'Thông số chi tiết'}</span>
                                    <span className="text-primary font-bold w-2/3 text-right whitespace-pre-wrap leading-relaxed">{spec.value}</span>
                                </div>
                            ))}
                        </div>
                        <div className="absolute -bottom-10 -right-10 size-32 bg-gold/5 rounded-full blur-3xl pointer-events-none"></div>
                    </div>

                    {/* Grouped Product - Items List */}
                    {product.type === 'group' && product.linked_products?.length > 0 && (
                        <div className="bg-gold/5 border border-gold/20 p-8 space-y-6 relative overflow-hidden group/combo">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <span className="material-symbols-outlined text-6xl">auto_awesome_motion</span>
                            </div>
                            <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
                                <span className="material-symbols-outlined text-primary">collections_bookmark</span>
                                <h4 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-primary">Bộ Sản Phẩm Hội Tụ</h4>
                            </div>

                            <div className="space-y-4">
                                {product.linked_products.map((item, idx) => (
                                    <div key={idx} className="flex items-center gap-6 p-3 bg-white/50 border border-transparent hover:border-gold/30 hover:bg-white transition-all shadow-sm group">
                                        <div className="size-16 relative bg-white border border-gold/10 overflow-hidden shrink-0">
                                            <img
                                                src={item.main_image || 'https://placehold.co/200'}
                                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                alt={item.name}
                                            />
                                            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            <h5 className="font-bold text-xs text-primary truncate uppercase tracking-wider">{item.name}</h5>
                                            <p className="text-[10px] text-stone mt-1">SKU: {item.sku}</p>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-bold text-brick italic">
                                                {new Intl.NumberFormat('vi-VN').format(item.price)}đ
                                            </div>
                                            <div className="flex items-center justify-end gap-1 mt-1 text-[8px] font-bold text-gold uppercase tracking-tighter">
                                                <span className="material-symbols-outlined text-[10px]">check_circle</span>
                                                Sẵn sàng
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-primary/5 p-4 border border-primary/10 flex items-center justify-between">
                                <span className="font-ui text-[10px] font-bold text-primary uppercase tracking-[0.2em]">Tổng giá trị Combo:</span>
                                <span className="font-body text-xl font-bold text-brick italic">
                                    {new Intl.NumberFormat('vi-VN').format(displayPrice)}đ
                                </span>
                            </div>

                            <p className="text-[10px] text-primary/60 italic text-center font-ui uppercase tracking-widest">
                                * Tiết kiệm hơn 15% so với mua lẻ từng món
                            </p>
                        </div>
                    )}

                    {/* Configurable Product - Options */}
                    {product.type === 'configurable' && product.super_attributes?.length > 0 && (
                        <div className="space-y-8 pt-8 border-t border-gold/10">
                            {product.super_attributes.map(attr => (
                                <div key={attr.id} className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <div className="size-1.5 rounded-full bg-gold"></div>
                                            <label className="font-ui text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{attr.name}</label>
                                        </div>
                                        {selectedAttributes[attr.id] && (
                                            <span className="text-[10px] text-stone font-bold uppercase tracking-widest bg-gold/5 px-2 py-0.5 border border-gold/10 italic">
                                                Đã chọn: {selectedAttributes[attr.id]}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-4">
                                        {/* Get unique values from children for this attribute */}
                                        {[...new Set(product.linked_products?.map(child =>
                                            child.attribute_values?.find(av => av.attribute_id === attr.id)?.value
                                        ).filter(v => v))].map(val => {
                                            const option = attr.options?.find(opt => opt.value === val);
                                            const isSelected = selectedAttributes[attr.id] === val;

                                            return (
                                                <button
                                                    key={val}
                                                    onClick={() => handleAttributeSelect(attr.id, val)}
                                                    title={val}
                                                    className={`relative transition-all duration-300 ${isSelected ? 'shadow-premium -translate-y-1' : 'hover:border-gold/60 hover:-translate-y-0.5'}`}
                                                >
                                                    {attr.swatch_type === 'color' ? (
                                                        <div className={`p-1 rounded-full border-2 ${isSelected ? 'border-primary' : 'border-gold/20'}`}>
                                                            <div
                                                                className="size-8 rounded-full shadow-inner"
                                                                style={{ backgroundColor: option?.swatch_value || '#ccc' }}
                                                            />
                                                        </div>
                                                    ) : attr.swatch_type === 'image' ? (
                                                        <div className={`p-1 border-2 ${isSelected ? 'border-primary' : 'border-gold/20'}`}>
                                                            <img
                                                                src={option?.swatch_value || 'https://placehold.co/40'}
                                                                className="size-10 object-cover"
                                                                alt={val}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className={`px-6 py-2.5 border text-xs font-bold uppercase tracking-widest ${isSelected ? 'border-primary bg-primary text-white' : 'border-gold/20 text-stone'}`}>
                                                            {val}
                                                        </div>
                                                    )}

                                                    {isSelected && (
                                                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-primary rounded-full"></div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-6 pt-4">
                        <div className="flex items-center gap-6">
                            <span className="font-ui text-sm font-bold uppercase tracking-widest">Số Lượng:</span>
                            <div className="flex items-center border border-gold rounded-sm h-12 w-32 bg-white">
                                <button
                                    className="w-10 h-full flex items-center justify-center text-primary hover:bg-gold/10 transition-colors"
                                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                >
                                    <span className="material-symbols-outlined text-sm">remove</span>
                                </button>
                                <input
                                    className="w-full h-full text-center border-none bg-transparent font-ui font-bold text-primary focus:ring-0"
                                    type="text"
                                    value={quantity}
                                    readOnly
                                />
                                <button
                                    className="w-10 h-full flex items-center justify-center text-primary hover:bg-gold/10 transition-colors"
                                    onClick={() => setQuantity(quantity + 1)}
                                >
                                    <span className="material-symbols-outlined text-sm">add</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <button
                                onClick={handleAddToCart}
                                className="flex-1 bg-primary text-white font-ui font-bold uppercase tracking-widest py-4 px-8 hover:bg-umber transition-all flex items-center justify-center gap-3 shadow-lg shadow-primary/20"
                            >
                                <span>Thêm Vào Giỏ</span>
                                <span className="material-symbols-outlined text-base">shopping_cart</span>
                            </button>
                            <button
                                onClick={handleWishlistToggle}
                                className={`w-14 h-14 flex items-center justify-center border border-gold transition-all ${inWishlist ? 'bg-gold text-white' : 'text-gold hover:bg-gold hover:text-white'}`}
                            >
                                <span className="material-symbols-outlined">{inWishlist ? 'heart_check' : 'favorite'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4">
                        <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-gold mt-0.5">verified</span>
                            <div>
                                <h4 className="font-ui text-xs font-bold uppercase text-primary mb-1">Chính Hãng</h4>
                                <p className="font-body text-xs text-stone">100% thủ công mỹ nghệ.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-gold mt-0.5">local_shipping</span>
                            <div>
                                <h4 className="font-ui text-xs font-bold uppercase text-primary mb-1">Vận Chuyển</h4>
                                <p className="font-body text-xs text-stone">Giao hàng toàn quốc an toàn.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs Section */}
            <div className="mt-28 border-t border-gold/10 pt-16">
                <div className="flex justify-center border-b border-gold/10 mb-12 flex-wrap gap-2">
                    {[
                        { id: 'description', label: 'Mô Tả Sản Phẩm' },
                        { id: 'spec', label: 'Thông Số Kỹ Thuật' },
                        { id: 'reviews', label: `Đánh Giá (${reviews.length})` },
                        { id: 'meaning', label: 'Ý Nghĩa Văn Hóa' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            className={`px-8 py-4 font-ui text-sm font-bold uppercase tracking-widest transition-all ${activeTab === tab.id ? 'text-primary border-b-2 border-gold font-bold' : 'text-stone hover:text-primary'}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="max-w-3xl mx-auto font-body text-lg leading-relaxed text-umber/80 min-h-[200px]">
                    {activeTab === 'description' && (
                        <div className="animate-fade-in">
                            <div
                                className="font-body text-lg leading-[2] text-umber/80 space-y-6 quill-view-styles"
                                dangerouslySetInnerHTML={{ __html: product.description || "Tác phẩm được chế tác hoàn toàn thủ công tại làng nghề Bát Tràng danh tiếng, trải qua quá trình nung ở nhiệt độ 1300°C để loại bỏ hoàn toàn tạp chất." }}
                            />
                        </div>
                    )}
                    {activeTab === 'spec' && (
                        <div className="animate-fade-in">
                            <ul className="space-y-4">
                                <li className="flex justify-between border-b border-gold/10 pb-4">
                                    <span className="font-ui font-bold text-xs uppercase tracking-widest text-stone/60">Tên & Phân loại:</span>
                                    <span className="text-primary font-bold text-sm text-right">{product.name}</span>
                                </li>
                                <li className="flex justify-between border-b border-gold/10 pb-4">
                                    <span className="font-ui font-bold text-xs uppercase tracking-widest text-stone/60">Mã hiệu (SKU):</span>
                                    <span className="text-primary font-bold text-sm font-mono text-right">{product.sku}</span>
                                </li>
                                {product.weight && (
                                    <li className="flex justify-between border-b border-gold/10 pb-4">
                                        <span className="font-ui font-bold text-xs uppercase tracking-widest text-stone/60">Khối lượng:</span>
                                        <span className="text-primary font-bold text-sm text-right">{product.weight} gram</span>
                                    </li>
                                )}
                                {(product.attribute_values || []).map(av => (
                                    <li key={av.id} className="flex justify-between border-b border-gold/10 pb-4">
                                        <span className="font-ui font-bold text-xs uppercase tracking-widest text-stone/60">{av.attribute?.name || 'Thuộc tính'}:</span>
                                        <span className="text-primary font-bold text-sm text-right">
                                            {(() => {
                                                try {
                                                    if (av.value && (av.value.startsWith('[') || av.value.startsWith('{'))) {
                                                        const parsed = JSON.parse(av.value);
                                                        return Array.isArray(parsed) ? parsed.join(', ') : av.value;
                                                    }
                                                } catch (e) { }
                                                return av.value === '1' ? 'Có' : (av.value === '0' ? 'Không' : av.value);
                                            })()}
                                        </span>
                                    </li>
                                ))}
                                {parseSpecifications(product.specifications).map((spec, idx) => (
                                    <li key={`tab-spec-${idx}`} className="flex justify-between border-b border-gold/10 pb-4">
                                        <span className="font-ui font-bold text-xs uppercase tracking-widest text-stone/60">{spec.key || 'Khác'}:</span>
                                        <span className="text-primary font-bold text-sm text-right whitespace-pre-wrap">{spec.value}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {activeTab === 'reviews' && (
                        <div className="animate-fade-in space-y-12">
                            <div className="space-y-8">
                                {reviews.map(rev => (
                                    <div key={rev.id} className="border-b border-gold/10 pb-6">
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-3">
                                                <div className="size-10 bg-primary/5 rounded-full flex items-center justify-center text-primary font-bold">
                                                    {(rev.customer_name || rev.user?.name || 'K').charAt(0)}
                                                </div>
                                                <span className="font-bold text-primary">{rev.customer_name || rev.user?.name}</span>
                                            </div>
                                            <div className="flex text-gold">
                                                {[...Array(5)].map((_, i) => (
                                                    <span key={i} className={`material-symbols-outlined text-sm ${i < rev.rating ? 'fill-current' : 'opacity-20'}`}>star</span>
                                                ))}
                                            </div>
                                        </div>
                                        <p className="text-sm text-stone pl-13 italic">"{rev.comment}"</p>
                                        <span className="text-[10px] text-stone font-ui uppercase mt-2 block pl-13">{new Date(rev.created_at).toLocaleDateString()}</span>
                                    </div>
                                ))}
                                {reviews.length === 0 && <p className="text-center text-gold italic">Chưa có đánh giá nào cho sản phẩm này.</p>}
                            </div>

                            <div className="bg-background-light p-8 border border-gold/20 shadow-inner">
                                <h4 className="font-display text-xl text-primary font-bold mb-6 text-center">Gửi Đánh Giá Của Bạn</h4>
                                <form onSubmit={handleReviewSubmit} className="space-y-6">
                                    <div className="flex flex-col items-center gap-3">
                                        <label className="font-ui text-xs font-bold uppercase tracking-widest">Chất lượng sản phẩm</label>
                                        <div className="flex gap-2">
                                            {[1, 2, 3, 4, 5].map(s => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => setNewReview({ ...newReview, rating: s })}
                                                    className={`material-symbols-outlined text-2xl transition-colors ${s <= newReview.rating ? 'text-gold' : 'text-stone/30'}`}
                                                >
                                                    star
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <textarea
                                            required
                                            className="w-full bg-white border border-gold/30 p-4 focus:outline-none focus:border-primary font-body text-sm h-32 resize-none"
                                            placeholder="Cảm nhận của bạn về độ tinh xảo, chất men..."
                                            value={newReview.comment}
                                            onChange={e => setNewReview({ ...newReview, comment: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex justify-center">
                                        <button type="submit" className="bg-primary text-white font-ui font-bold uppercase tracking-widest px-12 py-3 hover:bg-umber transition-all">Gửi Đánh Giá</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                    {activeTab === 'meaning' && (
                        <div className="animate-fade-in italic">
                            Biểu tượng của sự thăng tiến và trường thọ. Họa tiết trên sản phẩm không chỉ mang giá trị thẩm mỹ mà còn chứa đựng lời chúc may mắn, tài lộc cho gia chủ. Xứng đáng là bảo vật truyền đời hoặc món quà ngoại giao đẳng cấp.
                        </div>
                    )}
                </div>
            </div>

            {/* Related Products */}
            {relatedProducts.length > 0 && (
                <div className="mt-32 border-t border-gold/10 pt-16">
                    <div className="flex items-center justify-between mb-12">
                        <h3 className="font-display text-3xl font-bold text-primary uppercase">Sản Phẩm Tương Tự</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                        {relatedProducts.map(p => (
                            <ProductCard key={p.id} product={p} />
                        ))}
                    </div>
                </div>
            )}
        </main>
    );
};

export default ProductDetail;
