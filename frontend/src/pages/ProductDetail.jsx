import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { productApi } from '../services/api';
import ProductCard from '../components/ProductCard';
import { useCart } from '../context/CartContext';

const ProductDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { addToCart } = useCart();
    const [product, setProduct] = useState(null);
    const [relatedProducts, setRelatedProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [quantity, setQuantity] = useState(1);
    const [activeTab, setActiveTab] = useState('description');
    const [selectedImage, setSelectedImage] = useState(0);

    useEffect(() => {
        const fetchProduct = async () => {
            setLoading(true);
            try {
                const response = await productApi.getOne(id);
                setProduct(response.data);

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
    }, [id]);

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

    const images = product.images.length > 0 ? product.images : [{ image_url: 'https://via.placeholder.com/800' }];

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
                    <div className="space-y-2">
                        <span className="font-ui text-xs font-bold uppercase tracking-[0.2em] text-gold">{product.category?.name}</span>
                        <h1 className="text-primary font-display text-4xl lg:text-5xl font-bold leading-tight">{product.name}</h1>
                        <p className="font-body text-3xl text-brick italic pt-2">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}</p>
                    </div>

                    <div className="py-6 border-y border-gold/10 relative">
                        <span className="absolute -left-2 top-4 text-gold/20 text-6xl font-display leading-none">“</span>
                        <p className="font-body text-lg text-umber/80 italic leading-relaxed pl-6 relative z-10">
                            {product.description || "Nét vẽ thủ công tỉ mỉ, tái hiện tinh hoa đất Việt qua từng đường nét gốm sứ tinh xảo."}
                        </p>
                    </div>

                    <div className="space-y-6 pt-4">
                        <div className="flex items-center gap-6">
                            <span className="font-ui text-sm font-bold uppercase tracking-widest">Số Lượng:</span>
                            <div className="flex items-center border border-gold rounded-sm h-12 w-32">
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
                            <button className="w-14 h-14 flex items-center justify-center border border-gold text-gold hover:bg-gold hover:text-white transition-all">
                                <span className="material-symbols-outlined">favorite</span>
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
                <div className="flex justify-center border-b border-gold/10 mb-12">
                    {[
                        { id: 'description', label: 'Mô Tả Sản Phẩm' },
                        { id: 'spec', label: 'Thông Số Kỹ Thuật' },
                        { id: 'meaning', label: 'Ý Nghĩa Văn Hóa' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            className={`px-8 py-4 font-ui text-sm font-bold uppercase tracking-widest transition-all ${activeTab === tab.id ? 'text-primary border-b-2 border-gold' : 'text-stone hover:text-primary'}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="max-w-3xl mx-auto font-body text-lg leading-relaxed text-umber/80 min-h-[200px]">
                    {activeTab === 'description' && (
                        <div className="animate-fade-in">
                            <p className="first-letter:text-5xl first-letter:font-display first-letter:font-bold first-letter:text-primary first-letter:mr-3 first-letter:float-left first-letter:leading-none">
                                {product.description || "Tác phẩm được chế tác hoàn toàn thủ công tại làng nghề Bát Tràng danh tiếng, trải qua quá trình nung ở nhiệt độ 1300°C để loại bỏ hoàn toàn tạp chất."}
                            </p>
                            <p className="mt-4">
                                Lớp men cổ truyền được các nghệ nhân phục dựng công phu, tạo nên độ sâu thẳm tựa như đáy đại dương, bền màu vĩnh cửu với thời gian. Cốt gốm dày dặn, âm thanh khi gõ vào trong trẻo như chuông ngân, chứng tỏ độ kết tinh cao của đất sét cao lanh thượng hạng.
                            </p>
                        </div>
                    )}
                    {activeTab === 'spec' && (
                        <div className="animate-fade-in">
                            <ul className="space-y-4">
                                <li className="flex border-b border-gold/5 pb-2">
                                    <span className="font-ui font-bold w-40 text-sm uppercase">Kích thước:</span>
                                    <span>H: 45cm | W: 25cm</span>
                                </li>
                                <li className="flex border-b border-gold/5 pb-2">
                                    <span className="font-ui font-bold w-40 text-sm uppercase">Chất liệu:</span>
                                    <span>Gốm sứ tráng men cao cấp</span>
                                </li>
                                <li className="flex border-b border-gold/5 pb-2">
                                    <span className="font-ui font-bold w-40 text-sm uppercase">Trọng lượng:</span>
                                    <span>~3.5kg</span>
                                </li>
                                <li className="flex border-b border-gold/5 pb-2">
                                    <span className="font-ui font-bold w-40 text-sm uppercase">Xuất xứ:</span>
                                    <span>Bát Tràng - Gia Lâm - Hà Nội</span>
                                </li>
                            </ul>
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
                            <ProductCard key={p.id} product={{
                                ...p,
                                image: p.images?.[0]?.image_url || 'https://via.placeholder.com/400'
                            }} />
                        ))}
                    </div>
                </div>
            )}
        </main>
    );
};

export default ProductDetail;
