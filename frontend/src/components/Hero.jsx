import React from 'react';
import { motion } from 'framer-motion';

const Hero = () => {
    return (
        <section className="relative w-full overflow-hidden bg-background-dark h-[60vh]">
            {/* Background Image with slow zoom effect */}
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[10s] ease-out hover:scale-105"
                style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDxyxuenD-UTiSSDUsliBib3rtgLHsYtiaH9MZN635eMD2i5g6jBh21b_i4PS_GT-soo2VMNLwfy-Oq73sxuHpQzbLd0Q_s9D1BH0YlxEqdZH8QEUgJYgO69GgRJ7_S90Z0flvVhLFMtyRI4JYn5oDhNjJMOQQaPXYg1SOZi9xdBl-CuNrWoXgMx6FnoRXcNlQW805WC7pDVrZpAcA2C5nFT-F8aUk5Y9RG_yhTxI8LujIcyvaI3MKicA_JeOFP3EJ48T_0LzUsYQM')" }}
            >
            </div>
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10"></div>
            {/* Hero Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="max-w-4xl space-y-6"
                >
                    <div className="flex items-center justify-center gap-4 text-white/80 mb-4">
                        <div className="h-[1px] w-12 bg-gold"></div>
                        <span className="font-ui text-sm tracking-[0.2em] uppercase text-gold">Since 1450</span>
                        <div className="h-[1px] w-12 bg-gold"></div>
                    </div>
                    <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-white tracking-tight leading-tight">
                        Tinh Hoa Đất Việt
                    </h1>
                    <p className="font-body text-xl md:text-2xl text-white/90 italic font-light max-w-2xl mx-auto">
                        Nơi lưu giữ hồn cốt gốm sứ ngàn năm, kết tinh từ lửa và đất mẹ.
                    </p>
                    <div className="pt-8">
                        <button className="group relative inline-flex items-center justify-center px-8 py-3 overflow-hidden font-ui font-semibold tracking-widest text-white transition duration-300 ease-out border-2 border-gold/70 rounded-sm hover:border-gold hover:bg-primary/20">
                            <span className="absolute inset-0 flex items-center justify-center w-full h-full text-white duration-300 -translate-x-full bg-primary group-hover:translate-x-0 ease transition-transform">
                                <span className="material-symbols-outlined">arrow_forward</span>
                            </span>
                            <span className="absolute flex items-center justify-center w-full h-full text-white transition-all duration-300 transform group-hover:translate-x-full ease">
                                Xem Bộ Sưu Tập
                            </span>
                            <span className="relative invisible">Xem Bộ Sưu Tập</span>
                        </button>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};

export default Hero;
