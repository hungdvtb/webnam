import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

const ProductCard = ({ product }) => {
    const { addToCart } = useCart();
    const { user } = useAuth();
    const navigate = useNavigate();

    const handleAddToCart = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) {
            navigate('/login');
            return;
        }
        await addToCart(product.id, 1);
        navigate('/cart');
    };

    return (
        <div className="group flex flex-col items-center gap-6">
            <Link to={`/details/${product.id}`} className="relative w-full aspect-[4/5] overflow-hidden p-2 bg-white shadow-sm hover-lift cursor-pointer">
                <div className="w-full h-full border-2 border-gold/20 overflow-hidden relative">
                    <img
                        alt={product.name}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                        src={product.image || "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&q=80&w=800"}
                    />
                    {/* Add to Cart Overlay */}
                    <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-primary/90 backdrop-blur-sm p-4 text-center">
                        <button
                            onClick={handleAddToCart}
                            className="text-white font-ui text-sm uppercase tracking-wider font-bold flex items-center justify-center gap-2 w-full hover:text-gold transition-colors"
                        >
                            <span className="material-symbols-outlined text-lg">add_shopping_cart</span>
                            Thêm vào giỏ
                        </button>
                    </div>
                </div>
                {/* Badge */}
                {product.is_new && (
                    <div className="absolute top-4 left-4 bg-brick text-white text-xs font-ui font-bold px-2 py-1 uppercase tracking-wider z-10">
                        Mới
                    </div>
                )}
            </Link>
            <div className="text-center space-y-2">
                <Link to={`/details/${product.id}`} className="font-display text-2xl text-umber font-bold group-hover:text-primary transition-colors cursor-pointer block">
                    {product.name}
                </Link>
                <p className="font-body text-lg italic text-brick">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}
                </p>
            </div>
        </div>
    );
};

export default ProductCard;
