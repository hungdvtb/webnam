import React from 'react';

const About = () => {
    return (
        <main className="flex-grow bg-paper">
            {/* Hero / Intro Section */}
            <section className="py-20 px-6 lg:px-12 max-w-4xl mx-auto text-center">
                <div className="flex justify-center mb-6 text-gold">
                    <span className="material-symbols-outlined text-4xl">spa</span>
                </div>
                <h1 className="font-display font-bold text-4xl md:text-5xl text-primary mb-6">Cốt Cách & Di Sản</h1>
                <p className="font-body text-xl md:text-2xl text-stone italic leading-relaxed">
                    "Hành trình vạn dặm bắt đầu từ nắm đất sét thô sơ, qua lửa đỏ ngàn độ, kết tinh thành tuyệt tác gốm sứ trường tồn cùng thời gian."
                </p>
                <div className="w-24 h-[1px] bg-gold mx-auto mt-10"></div>
            </section>

            {/* Story Section 1: The Earth */}
            <section className="py-16 lg:py-24 px-6 lg:px-12 max-w-[1440px] mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 items-center">
                    <div className="relative group">
                        <div className="absolute inset-0 bg-primary/5 translate-x-4 translate-y-4 -z-10 rounded-sm"></div>
                        <img
                            alt="Artisan shaping clay"
                            className="w-full h-[500px] object-cover border-[3px] border-double border-gold sepia-[0.3] shadow-lg transition-transform duration-700 group-hover:scale-[1.01]"
                            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCAmWuhlj6v18-kv_iqL4Z5wUSejtZz21hkMijUaHIDTqehrM9fIFFI_UDWx5-sc2ehkRzl6QmwIh8JPDAUskjETXwUV7mLz7Fmu5lrBY9IR920k_CJVRB44EgstYB72Pu2gSlh7-0AjX0QkxmqMDhJ9BNquPPCv-QeNjiPYRZKBCEUBWAV1J_HpZImm20TV4v0ormAFmW9KzFI_qo0BhFs_t0QcuQwG0v-1lbTOmyr8Hvamx5xWBd_dlRUDABl4-cgkWxvhwpUOnY"
                        />
                        <div className="absolute bottom-4 left-4 bg-paper px-4 py-2 border border-gold/50 shadow-sm">
                            <span className="font-ui text-xs text-stone uppercase tracking-wider">Hình ảnh tư liệu, 1986</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-6">
                        <span className="font-ui text-brick font-bold uppercase tracking-widest text-sm">Khởi Nguồn</span>
                        <h2 className="font-display font-bold text-3xl md:text-4xl text-umber">Hồn Đất, Tình Người</h2>
                        <p className="font-body text-lg text-umber/80 leading-loose">
                            Mỗi tác phẩm tại Di Sản Gốm Việt bắt đầu từ những thớ đất sét trắng tinh khiết, được chọn lọc kỹ lưỡng từ vùng đất linh thiêng bên bờ sông Hồng. Đất phải được phơi sương, nhào nặn qua bàn tay chai sần của những nghệ nhân lão luyện.
                        </p>
                        <p className="font-body text-lg text-umber/80 leading-loose">
                            Chúng tôi tin rằng, đất có hồn. Người nghệ nhân không chỉ tạo hình, mà còn đang trò chuyện, thổi vào đất những tâm tư, nguyện vọng về một cuộc sống bình an và thịnh vượng.
                        </p>
                    </div>
                </div>
            </section>

            {/* Story Section 2: The Fire */}
            <section className="py-16 lg:py-24 px-6 lg:px-12 max-w-[1440px] mx-auto mb-20">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 items-center">
                    <div className="flex flex-col gap-6 order-2 lg:order-1">
                        <span className="font-ui text-brick font-bold uppercase tracking-widest text-sm">Hỏa Biến</span>
                        <h2 className="font-display font-bold text-3xl md:text-4xl text-umber">Vũ Điệu Của Lửa 1300°C</h2>
                        <p className="font-body text-lg text-umber/80 leading-loose">
                            Nếu đất là xương thịt, thì lửa chính là linh hồn. Gốm Men Lam và Men Rạn của chúng tôi trải qua quá trình nung khử khắc nghiệt ở nhiệt độ 1300°C. Ở nhiệt độ này, tạp chất bị loại bỏ hoàn toàn, lớp men chảy ra, hòa quyện vào cốt gốm tạo nên độ sâu thăm thẳm.
                        </p>
                        <p className="font-body text-lg text-umber/80 leading-loose">
                            "Hỏa biến" là khoảnh khắc kỳ diệu khi màu sắc của gốm được quyết định bởi ngọn lửa. Không có hai chiếc bình nào giống hệt nhau, bởi mỗi lần lửa múa là một lần tạo tác độc bản ra đời.
                        </p>
                    </div>
                    <div className="relative group order-1 lg:order-2">
                        <div className="absolute inset-0 bg-gold/10 -translate-x-4 -translate-y-4 -z-10 rounded-sm"></div>
                        <img
                            alt="Ceramic texture"
                            className="w-full h-[500px] object-cover border-[3px] border-double border-gold shadow-lg transition-transform duration-700 group-hover:scale-[1.01]"
                            src="https://lh3.googleusercontent.com/aida-public/AB6AXuB3KEMRqjxODaNDmtyysQItfnODlberw9v-mQOA3rSgQBdEMvUH1ZIwZGqz2F4vZNFq6vZA6u8q5tah3r6eFygYTW3oTTopPiwc2TS4ezdeKeB5T_YcNNBVOP5fbHO3j6LdWI3E4yG-lDcv0WyzYnVjgkxIJU4JIfPzpNYrCjK4Rr9q3o2AhRvGXSmZjws310WPwA2dyjgGjPq9ZPyFvgLL9MXzAY9MAgAUgvhYbPQJ5BlNciMqP04n-T_Gnpc6IqvpI5Q8aq1AY-c"
                        />
                    </div>
                </div>
            </section>

            {/* Contact Section */}
            <section id="contact" className="bg-primary text-white py-20 lg:py-32 relative overflow-hidden">
                <div className="max-w-[1440px] mx-auto px-6 lg:px-12 relative z-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
                        <div className="lg:col-span-7 flex flex-col gap-12">
                            <div>
                                <h2 className="font-display font-bold text-3xl md:text-4xl mb-4">Ghé Thăm Phòng Trưng Bày</h2>
                                <p className="font-body text-xl text-white/80 max-w-xl">
                                    Nơi quý khách có thể tận tay chạm vào cốt gốm mát lạnh và chiêm ngưỡng những tuyệt tác nghệ thuật.
                                </p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 font-ui text-sm">
                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <span className="material-symbols-outlined text-gold mt-1">location_on</span>
                                        <div>
                                            <h3 className="font-bold text-gold uppercase tracking-wider mb-1">Địa Chỉ</h3>
                                            <p className="text-white/90 leading-relaxed">Xóm 2, Giang Cao,<br />Bát Tràng, Gia Lâm, Hà Nội</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <span className="material-symbols-outlined text-gold mt-1">call</span>
                                        <div>
                                            <h3 className="font-bold text-gold uppercase tracking-wider mb-1">Điện Thoại</h3>
                                            <p className="text-white/90">(+84) 987 654 321</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <span className="material-symbols-outlined text-gold mt-1">mail</span>
                                        <div>
                                            <h3 className="font-bold text-gold uppercase tracking-wider mb-1">Email</h3>
                                            <p className="text-white/90">lienhe@disangomviet.com</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <span className="material-symbols-outlined text-gold mt-1">schedule</span>
                                        <div>
                                            <h3 className="font-bold text-gold uppercase tracking-wider mb-1">Giờ Mở Cửa</h3>
                                            <p className="text-white/90">08:00 - 18:00 (Tất cả các ngày)</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Map or Illustration Placeholder */}
                        <div className="lg:col-span-5">
                            <div className="relative aspect-[4/5] w-full border border-gold/30 rounded p-6 bg-primary/50 backdrop-blur-sm flex items-center justify-center">
                                <div className="text-center space-y-4">
                                    <span className="material-symbols-outlined text-6xl text-gold">map</span>
                                    <h3 className="font-display text-xl text-white">Bản Đồ Bát Tràng</h3>
                                    <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="inline-block border-b border-gold text-gold font-ui text-sm uppercase tracking-widest pb-1">Xem trên Google Maps</a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
};

export default About;
