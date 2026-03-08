import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SectionHeader from './SectionHeader';

const TabContent = ({
    title,
    subtitle,
    tabs = [],
    initialTabIndex = 0
}) => {
    const [activeTab, setActiveTab] = useState(initialTabIndex);

    if (tabs.length === 0) return null;

    return (
        <section className="py-24 bg-white px-6 lg:px-12 border-y border-gold/10">
            <div className="container mx-auto max-w-6xl">
                <SectionHeader title={title} subtitle={subtitle} />

                {/* Tab Navigation */}
                <div className="flex flex-wrap justify-center border-b border-gold/10 mb-16 gap-4 md:gap-12 pb-2 overflow-x-auto hide-scrollbar whitespace-nowrap">
                    {tabs.map((tab, idx) => (
                        <button
                            key={idx}
                            onClick={() => setActiveTab(idx)}
                            className={`relative px-6 py-4 font-ui text-[11px] font-bold uppercase tracking-[0.2em] transition-all
                                ${activeTab === idx ? 'text-primary' : 'text-stone hover:text-primary opacity-60 hover:opacity-100'}`}
                        >
                            {tab.label}
                            {activeTab === idx && (
                                <motion.div
                                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-gold"
                                    layoutId="tab-underline"
                                    transition={{ duration: 0.3, ease: "easeOut" }}
                                />
                            )}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="min-h-[400px]">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.4, ease: "easeInOut" }}
                            className="bg-background-light p-8 lg:p-16 border border-gold/10 relative overflow-hidden group"
                        >
                            {/* Decorative Background Icon */}
                            <div className="absolute right-0 bottom-0 pointer-events-none opacity-[0.03] rotate-[-15deg] group-hover:rotate-[0deg] transition-transform duration-1000">
                                <span className="material-symbols-outlined text-[300px] text-primary">cloud</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
                                <div className="space-y-6">
                                    <div className="h-10 w-10 bg-gold/20 flex items-center justify-center text-gold">
                                        <span className="material-symbols-outlined text-sm">{tabs[activeTab].icon || 'filter_vintage'}</span>
                                    </div>
                                    <h3 className="font-display text-3xl lg:text-4xl font-bold text-primary uppercase italic tracking-tight">{tabs[activeTab].title}</h3>
                                    <p className="font-body text-lg text-stone italic border-l-4 border-gold/30 pl-6 py-2 leading-relaxed opacity-90">{tabs[activeTab].description}</p>
                                    <div className="pt-4">
                                        <a href={tabs[activeTab].link || "#"} className="bg-primary text-white font-ui text-[10px] font-bold uppercase tracking-widest px-10 py-4 hover:bg-umber transition-all shadow-premium">Xem Chi Tiết</a>
                                    </div>
                                </div>
                                <div className="relative group/image">
                                    <div className="absolute inset-0 border border-gold translate-x-3 translate-y-3 group-hover/image:translate-x-0 group-hover/image:translate-y-0 transition-transform"></div>
                                    <img
                                        src={tabs[activeTab].image || "https://images.unsplash.com/photo-1595180630321-df62a690e515?auto=format&fit=crop&q=80&w=800"}
                                        alt={tabs[activeTab].label}
                                        className="w-full h-[400px] object-cover relative z-10 shadow-premium"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </section>
    );
};

export default TabContent;
