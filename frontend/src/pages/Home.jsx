import React, { useState, useEffect } from 'react';
import Hero from '../components/Hero';
import ProductSlider from '../components/cms/ProductSlider';
import TabContent from '../components/cms/TabContent';
import Banner from '../components/cms/Banner';
import { productApi, cmsApi } from '../services/api';
import siteConfig from '../config/site';

const Home = () => {
    const [featuredProducts, setFeaturedProducts] = useState([]);
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [prodRes, settingsRes] = await Promise.all([
                    productApi.getAll({ featured: 1, per_page: 8, site_code: siteConfig.SITE_CODE }),
                    cmsApi.settings.get({ site_code: siteConfig.SITE_CODE })
                ]);
                setFeaturedProducts(prodRes.data.data);
                setSettings(settingsRes.data);
            } catch (error) {
                console.error("Error fetching data", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const homeTabs = [
        {
            label: "Gốm Thủ Công",
            title: "Tâm Hồn Trong Từng Thớ Đất",
            description: "Quy trình chế tác thủ công 100% từ khâu nhào đất đến khi thành phẩm. Mỗi sản phẩm là một câu chuyện riêng biệt của người nghệ nhân.",
            image: "https://images.unsplash.com/photo-1595180630321-df62a690e515?auto=format&fit=crop&q=80&w=800",
            icon: "handyman",
            link: "/about"
        },
        {
            label: "Men Cổ Phục Dựng",
            title: "Sống Lại Những Tuyệt Tác",
            description: "Phục dựng các loại men quý hiếm từ triều Lý, Trần, Lê như men Lam, men Rạn, men Ngọc. Đem vẻ đẹp vương giả vào không gian sống hiện đại.",
            image: "https://lh3.googleusercontent.com/aida-public/AB6AXuDxyxuenD-UTiSSDUsliBib3rtgLHsYtiaH9MZN635eMD2i5g6jBh21b_i4PS_GT-soo2VMNLwfy-Oq73sxuHpQzbLd0Q_s9D1BH0YlxEqdZH8QEUgJYgO69GgRJ7_S90Z0flvVhLFMtyRI4JYn5oDhNjJMOQQaPXYg1SOZi9xdBl-CuNrWoXgMx6FnoRXcNlQW805WC7pDVrZpAcA2C5nFT-F8aUk5Y9RG_yhTxI8LujIcyvaI3MKicA_JeOFP3EJ48T_0LzUsYQM",
            icon: "history_edu",
            link: "/blog"
        },
        {
            label: "Nghi Thức Trà Đạo",
            title: "Hương Trà & Cốt Gốm",
            description: "Bộ sưu tập ấm chén trà được thiết kế chuyên biệt cho những người yêu trà. Khả năng giữ nhiệt và cảm quan tuyệt vời trên tay.",
            image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&q=80&w=800",
            icon: "emoji_food_beverage",
            link: "/shop?category=tra-dao"
        }
    ];

    return (
        <div className="flex flex-col animate-fade-in">
            <Hero />

            <ProductSlider
                title="Báu Vật Mới"
                subtitle="Những tác phẩm vừa rời lò nung với men màu độc bản, kết tinh từ tay nghề nghệ nhân."
                products={featuredProducts}
                loading={loading}
            />

            <Banner
                title="Đặc Quyền Hội Viên"
                subtitle="Nhận ngay ưu đãi 15% cho hóa đơn đầu tiên và đặc quyền tham quan xưởng gốm Bát Tràng."
                image="https://images.unsplash.com/photo-1594732163339-38b438257008?auto=format&fit=crop&q=80&w=1200"
                buttonText="Tham Gia Ngay"
                buttonLink="/register"
                height="500px"
                overlayOpacity="0.4"
                alignment="right"
            />

            <TabContent
                title="Cốt Cách & Di Sản"
                subtitle="Khám phá những giá trị cốt lõi làm nên thương hiệu Gốm Sứ Đại Thành."
                tabs={homeTabs}
            />

            {/* Subtle Brand Quote */}
            <div className="py-20 bg-background-light text-center border-t border-gold/10">
                <div className="max-w-xl mx-auto space-y-4">
                    <span className="material-symbols-outlined text-gold opacity-50 text-4xl">format_quote</span>
                    <p className="font-display text-2xl text-primary italic lowercase tracking-tight">"Gốm không chỉ là đất, gốm là lời thì thầm của thời gian và lửa."</p>
                    <div className="h-[0.5px] w-20 bg-gold/50 mx-auto"></div>
                </div>
            </div>
        </div>
    );
};

export default Home;
