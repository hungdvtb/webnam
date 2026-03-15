import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cmsApi } from '../services/api';
import siteConfig from '../config/site';

const Hero = () => {
    const [banners, setBanners] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBanners = async () => {
            try {
                const response = await cmsApi.banners.getAll({
                    site_code: siteConfig.SITE_CODE
                });
                setBanners(response.data);
            } catch (error) {
                console.error("Error fetching banners", error);
            } finally {
                setLoading(false);
            }
        };
        fetchBanners();
    }, []);

    // Simple auto-slide if multiple banners
    useEffect(() => {
        if (banners.length > 1) {
            const timer = setInterval(() => {
                setCurrentIndex((prev) => (prev + 1) % banners.length);
            }, 6000); // 6 seconds per slide
            return () => clearInterval(timer);
        }
    }, [banners]);

    if (loading && banners.length === 0) {
        return <section className="w-full bg-background-dark h-[60vh] animate-pulse" />;
    }

    const currentBanner = banners[currentIndex] || {
        title: 'Tinh Hoa Đất Việt',
        subtitle: 'Nơi lưu giữ hồn cốt gốm sứ ngàn năm, kết tinh từ lửa và đất mẹ.',
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxyxuenD-UTiSSDUsliBib3rtgLHsYtiaH9MZN635eMD2i5g6jBh21b_i4PS_GT-soo2VMNLwfy-Oq73sxuHpQzbLd0Q_s9D1BH0YlxEqdZH8QEUgJYgO69GgRJ7_S90Z0flvVhLFMtyRI4JYn5oDhNjJMOQQaPXYg1SOZi9xdBl-CuNrWoXgMx6FnoRXcNlQW805WC7pDVrZpAcA2C5nFT-F8aUk5Y9RG_yhTxI8LujIcyvaI3MKicA_JeOFP3EJ48T_0LzUsYQM',
        button_text: 'Xem Bộ Sưu Tập',
        link_url: '/shop'
    };

    const bannerImageUrl = currentBanner.image_url || 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxyxuenD-UTiSSDUsliBib3rtgLHsYtiaH9MZN635eMD2i5g6jBh21b_i4PS_GT-soo2VMNLwfy-Oq73sxuHpQzbLd0Q_s9D1BH0YlxEqdZH8QEUgJYgO69GgRJ7_S90Z0flvVhLFMtyRI4JYn5oDhNjJMOQQaPXYg1SOZi9xdBl-CuNrWoXgMx6FnoRXcNlQW805WC7pDVrZpAcA2C5nFT-F8aUk5Y9RG_yhTxI8LujIcyvaI3MKicA_JeOFP3EJ48T_0LzUsYQM';

    return (
        <section className="relative w-full overflow-hidden bg-background-dark h-[60vh] lg:h-[70vh]">
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentIndex}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.5 }}
                    className="absolute inset-0"
                >
                    {/* Background Image with slow zoom effect */}
                    <motion.div
                        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                        style={{ backgroundImage: `url('${bannerImageUrl}')` }}
                        animate={{ scale: [1, 1.05] }}
                        transition={{ duration: 10, ease: "linear", repeat: 0 }}
                    />

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>

                    {/* Hero Content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.2 }}
                            className="max-w-4xl space-y-6"
                        >
                            <div className="flex items-center justify-center gap-4 text-white/80 mb-4">
                                <div className="h-[0.5px] w-12 bg-gold/50"></div>
                                <span className="font-ui text-xs tracking-[0.3em] uppercase text-gold">Di Sản Việt Nam</span>
                                <div className="h-[0.5px] w-12 bg-gold/50"></div>
                            </div>

                            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-white tracking-tight leading-tight">
                                {currentBanner.title}
                            </h1>

                            <p className="font-body text-lg md:text-xl text-white/90 italic font-light max-w-2xl mx-auto leading-relaxed">
                                {currentBanner.subtitle}
                            </p>

                            {currentBanner.button_text && (
                                <div className="pt-10">
                                    <a
                                        href={currentBanner.link_url || '/shop'}
                                        className="group relative inline-flex items-center justify-center px-10 py-4 overflow-hidden font-ui font-semibold tracking-widest text-white transition duration-300 ease-out border-2 border-gold/70 rounded-sm hover:border-gold hover:bg-primary/20"
                                    >
                                        <span className="absolute inset-0 flex items-center justify-center w-full h-full text-white duration-300 -translate-x-full bg-primary group-hover:translate-x-0 ease transition-transform">
                                            <span className="material-symbols-outlined">arrow_forward</span>
                                        </span>
                                        <span className="absolute flex items-center justify-center w-full h-full text-white transition-all duration-300 transform group-hover:translate-x-full ease">
                                            {currentBanner.button_text}
                                        </span>
                                        <span className="relative invisible">{currentBanner.button_text}</span>
                                    </a>
                                </div>
                            )}
                        </motion.div>
                    </div>
                </motion.div>
            </AnimatePresence>

            {/* Slider Dots if multiple banners */}
            {banners.length > 1 && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-3 z-10">
                    {banners.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setCurrentIndex(idx)}
                            className={`h-1.5 transition-all duration-500 rounded-full ${currentIndex === idx ? 'w-8 bg-gold' : 'w-2 bg-white/30 hover:bg-white/60'}`}
                        />
                    ))}
                </div>
            )}
        </section>
    );
};

export default Hero;
