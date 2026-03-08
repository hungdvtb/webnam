import React from 'react';
import { motion } from 'framer-motion';

const Banner = ({
    title,
    subtitle,
    image,
    buttonText,
    buttonLink = "#",
    height = "400px",
    overlayOpacity = "0.5",
    alignment = "center"
}) => {
    const alignClasses = {
        left: "items-start text-left pl-12 lg:pl-24",
        center: "items-center text-center",
        right: "items-end text-right pr-12 lg:pr-24"
    };

    return (
        <section
            className="relative w-full overflow-hidden transition-all duration-700 hover:scale-[1.01] shadow-premium group"
            style={{ height }}
        >
            <div
                className="absolute inset-0 bg-cover bg-fixed bg-center transition-transform duration-1000 group-hover:scale-110"
                style={{ backgroundImage: `url('${image}')` }}
            >
                <div
                    className="absolute inset-0 bg-black"
                    style={{ opacity: overlayOpacity }}
                />
            </div>

            <div className={`absolute inset-0 flex flex-col justify-center px-6 ${alignClasses[alignment]}`}>
                <motion.div
                    className="max-w-3xl space-y-4"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8 }}
                >
                    <h2 className="font-display text-4xl md:text-6xl font-bold text-white uppercase italic tracking-tighter shadow-sm">{title}</h2>
                    {subtitle && <p className="font-body text-lg text-white/90 italic max-w-xl shadow-sm">{subtitle}</p>}
                    {buttonText && (
                        <div className="pt-6">
                            <a
                                href={buttonLink}
                                className="inline-flex items-center gap-3 bg-white text-primary px-10 py-3 font-ui font-bold uppercase tracking-widest text-xs hover:bg-gold hover:text-white transition-all shadow-xl"
                            >
                                {buttonText}
                                <span className="material-symbols-outlined text-sm">arrow_outward</span>
                            </a>
                        </div>
                    )}
                </motion.div>
            </div>
        </section>
    );
};

export default Banner;
