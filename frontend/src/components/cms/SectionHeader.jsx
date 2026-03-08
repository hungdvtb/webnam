import React from 'react';

const SectionHeader = ({ title, subtitle, centered = true }) => {
    return (
        <div className={`mb-16 ${centered ? 'text-center' : 'text-left'}`}>
            <div className={`flex items-center gap-4 ${centered ? 'justify-center' : 'justify-start'}`}>
                <span className="material-symbols-outlined text-gold opacity-60">cloud</span>
                <h2 className="text-primary font-display text-4xl md:text-5xl font-bold tracking-tight px-4 uppercase italic">{title}</h2>
                <span className="material-symbols-outlined text-gold opacity-60">cloud</span>
            </div>
            {subtitle && <p className="font-body text-lg text-stone italic mt-4 max-w-2xl mx-auto">{subtitle}</p>}
        </div>
    );
};

export default SectionHeader;
