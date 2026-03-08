import React, { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import ProductCard from '../ProductCard';
import SectionHeader from './SectionHeader';

const ProductSlider = ({ title, subtitle, products = [], loading = false }) => {
    const [constraints, setConstraints] = useState({ left: 0, right: 0 });
    const carouselRef = useRef(null);

    useEffect(() => {
        if (carouselRef.current) {
            setConstraints({
                left: -(carouselRef.current.scrollWidth - carouselRef.current.offsetWidth + 40),
                right: 0
            });
        }
    }, [products, loading]);

    if (loading) {
        return (
            <div className="py-20 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold mx-auto"></div>
            </div>
        );
    }

    if (products.length === 0) return null;

    return (
        <section className="py-24 bg-background-light overflow-hidden group">
            <div className="container mx-auto px-6 lg:px-12">
                <SectionHeader title={title} subtitle={subtitle} />

                <div className="relative cursor-grab active:cursor-grabbing overflow-visible">
                    <motion.div
                        ref={carouselRef}
                        drag="x"
                        dragConstraints={constraints}
                        className="flex gap-8 lg:gap-12"
                        whileTap={{ cursor: "grabbing" }}
                    >
                        {products.map(product => (
                            <motion.div
                                key={product.id}
                                className="min-w-[300px] md:min-w-[350px] lg:min-w-[400px]"
                                whileHover={{ y: -10 }}
                                transition={{ duration: 0.3 }}
                            >
                                <ProductCard
                                    product={{
                                        ...product,
                                        image: product.images?.[0]?.image_url || 'https://via.placeholder.com/400'
                                    }}
                                />
                            </motion.div>
                        ))}
                    </motion.div>

                    {/* Visual Hint */}
                    <div className="flex justify-center mt-12 gap-3 opacity-20 group-hover:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-gold animate-bounce-x">keyboard_double_arrow_left</span>
                        <span className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Kéo để xem thêm</span>
                        <span className="material-symbols-outlined text-gold animate-bounce-x">keyboard_double_arrow_right</span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductSlider;
