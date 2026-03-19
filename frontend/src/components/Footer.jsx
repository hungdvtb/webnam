import React, { useEffect, useState } from 'react';
import { cmsApi } from '../services/api';
import { buildFooterConfig } from '../utils/footerSettings';

const Footer = () => {
    const [footerConfig, setFooterConfig] = useState(buildFooterConfig({}));

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await cmsApi.settings.get();
                setFooterConfig(buildFooterConfig(response.data || {}));
            } catch (error) {
                console.error('Error fetching footer settings', error);
            }
        };

        fetchSettings();
    }, []);

    const {
        logoUrl,
        brandText,
        description,
        hotline,
        email,
        address,
        copyrightText,
        newsletterPlaceholder,
        activeGroups,
    } = footerConfig;

    return (
        <footer className="bg-primary text-background-light pt-20 pb-10 px-6 lg:px-12 border-t-4 border-gold">
            <div className="container mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,1fr))] gap-12 mb-16">
                    <div className="space-y-5">
                        <div className="flex items-center gap-3">
                            <img src={logoUrl || '/logo.png'} alt={brandText} className="h-12 rounded-sm bg-white p-1 object-contain" />
                            <span className="font-display text-xl font-bold uppercase tracking-wider">{brandText}</span>
                        </div>

                        <p className="font-body text-stone/80 text-lg leading-relaxed">
                            {description}
                        </p>

                        <div className="space-y-2 font-ui text-sm text-stone/80">
                            {hotline ? (
                                <a href={`tel:${hotline}`} className="flex items-center gap-2 hover:text-gold transition-colors">
                                    <span className="material-symbols-outlined text-[18px] text-gold">call</span>
                                    {hotline}
                                </a>
                            ) : null}

                            {email ? (
                                <a href={`mailto:${email}`} className="flex items-center gap-2 hover:text-gold transition-colors">
                                    <span className="material-symbols-outlined text-[18px] text-gold">mail</span>
                                    {email}
                                </a>
                            ) : null}

                            {address ? (
                                <div className="flex items-start gap-2">
                                    <span className="material-symbols-outlined text-[18px] text-gold mt-0.5">location_on</span>
                                    <span>{address}</span>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {activeGroups.map((group) => (
                        <div key={group.id}>
                            <h4 className="font-ui font-bold uppercase tracking-widest text-gold text-sm mb-6">{group.title}</h4>
                            <ul className="space-y-3 font-ui text-sm">
                                {group.items.map((item) => (
                                    <li key={item.id}>
                                        <a className="hover:text-gold transition-colors" href={item.link || '#'}>
                                            {item.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}

                    <div>
                        <h4 className="font-ui font-bold uppercase tracking-widest text-gold text-sm mb-6">Bản tin</h4>
                        <p className="font-body text-stone/80 text-sm mb-4">Nhận thông tin về các bộ sưu tập mới nhất và ưu đãi đặc quyền.</p>
                        <div className="flex border-b border-gold py-2">
                            <input type="email" placeholder={newsletterPlaceholder} className="bg-transparent border-none text-white placeholder-stone/50 focus:ring-0 w-full outline-none" />
                            <button className="text-gold hover:text-white transition-colors">
                                <span className="material-symbols-outlined">east</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/10 text-stone/60 font-ui text-xs gap-3">
                    <p>{copyrightText}</p>
                    <div className="flex gap-6 flex-wrap justify-center">
                        {hotline ? <a href={`tel:${hotline}`} className="hover:text-gold transition-colors">Hotline</a> : null}
                        {email ? <a href={`mailto:${email}`} className="hover:text-gold transition-colors">Email</a> : null}
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
