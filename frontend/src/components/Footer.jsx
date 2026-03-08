import React, { useState, useEffect } from 'react';
import { cmsApi } from '../services/api';

const Footer = () => {
    const [settings, setSettings] = useState({
        footer_brand_logo: '/logo.png',
        footer_brand_desc: 'Tôn vinh nét đẹp văn hóa truyền thống qua từng đường nét gốm sứ thủ công tinh xảo.',
        footer_column_1_title: 'Khám Phá',
        footer_column_2_title: 'Hỗ Trợ',
        footer_social_instagram: '#',
        footer_social_facebook: '#',
        footer_social_pinterest: '#',
        footer_text: '© 2024 Gốm Sứ Đại Thành. Bảo lưu mọi quyền.'
    });

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await cmsApi.settings.get();
                if (response.data) {
                    setSettings(prev => ({ ...prev, ...response.data }));
                }
            } catch (error) {
                console.error("Error fetching footer settings", error);
            }
        };
        fetchSettings();
    }, []);

    return (
        <footer className="bg-primary text-background-light pt-20 pb-10 px-6 lg:px-12 border-t-4 border-gold">
            <div className="container mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
                    {/* Brand */}
                    <div className="col-span-1 md:col-span-1 space-y-4">
                        <div className="flex items-center gap-3">
                            <img src={settings.footer_brand_logo || "/logo.png"} alt="Logo" className="h-12 rounded-sm bg-white p-1" />
                            <span className="font-display text-xl font-bold uppercase tracking-wider">{settings.site_name || "Gốm Sứ Đại Thành"}</span>
                        </div>
                        <p className="font-body text-stone/80 text-lg leading-relaxed">
                            {settings.footer_brand_desc}
                        </p>
                    </div>
                    {/* Links 1 */}
                    <div>
                        <h4 className="font-ui font-bold uppercase tracking-widest text-gold text-sm mb-6">{settings.footer_column_1_title}</h4>
                        <ul className="space-y-3 font-ui text-sm">
                            <li><a className="hover:text-gold transition-colors" href="/about">Về Chúng Tôi</a></li>
                            <li><a className="hover:text-gold transition-colors" href="#">Nghệ Nhân</a></li>
                            <li><a className="hover:text-gold transition-colors" href="#">Blog Di Sản</a></li>
                            <li><a className="hover:text-gold transition-colors" href="#">Tuyển Dụng</a></li>
                        </ul>
                    </div>
                    {/* Links 2 */}
                    <div>
                        <h4 className="font-ui font-bold uppercase tracking-widest text-gold text-sm mb-6">{settings.footer_column_2_title}</h4>
                        <ul className="space-y-3 font-ui text-sm">
                            <li><a className="hover:text-gold transition-colors" href="#">Chính Sách Vận Chuyển</a></li>
                            <li><a className="hover:text-gold transition-colors" href="#">Đổi Trả & Bảo Hành</a></li>
                            <li><a className="hover:text-gold transition-colors" href="#">Hướng Dẫn Mua Hàng</a></li>
                            <li><a className="hover:text-gold transition-colors" href="/contact">Liên Hệ</a></li>
                        </ul>
                    </div>
                    {/* Newsletter */}
                    <div>
                        <h4 className="font-ui font-bold uppercase tracking-widest text-gold text-sm mb-6">Bản Tin</h4>
                        <p className="font-body text-stone/80 text-sm mb-4">Nhận thông tin về các bộ sưu tập mới nhất.</p>
                        <div className="flex border-b border-gold py-2">
                            <input type="email" placeholder="Email của bạn..." className="bg-transparent border-none text-white placeholder-stone/50 focus:ring-0 w-full" />
                            <button className="text-gold hover:text-white transition-colors">
                                <span className="material-symbols-outlined">east</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/10 text-stone/60 font-ui text-xs">
                    <p>{settings.footer_text}</p>
                    <div className="flex gap-6 mt-4 md:mt-0">
                        <a href={settings.footer_social_instagram} target="_blank" rel="noreferrer" className="hover:text-gold transition-colors">Instagram</a>
                        <a href={settings.footer_social_facebook} target="_blank" rel="noreferrer" className="hover:text-gold transition-colors">Facebook</a>
                        <a href={settings.footer_social_pinterest} target="_blank" rel="noreferrer" className="hover:text-gold transition-colors">Pinterest</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
