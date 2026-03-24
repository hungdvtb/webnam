import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import StoreLocationCards from '../../components/store/StoreLocationCards';

const StoreLocationsPage = () => {
    const { siteInfo, storeLocations = [] } = useOutletContext();
    const activeStores = storeLocations.filter((store) => store.isActive !== false);
    const primaryPhone = siteInfo?.phone || activeStores[0]?.hotline || '';

    return (
        <div className="bg-[linear-gradient(180deg,#f9f5f0_0%,#fff_26%,#fff_100%)]">
            <section className="mx-auto max-w-4xl px-4 pb-10 pt-5 md:pb-14 md:pt-8">
                <div className="rounded-[32px] border border-gold/15 bg-white p-5 shadow-[0_32px_90px_-50px_rgba(27,54,93,0.45)] md:p-7">
                    <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-primary">
                        Hệ thống cửa hàng
                    </span>

                    <h1 className="mt-4 max-w-2xl text-[2rem] font-black leading-[1.05] tracking-tight text-primary md:text-[2.6rem]">
                        Ghé showroom gần bạn, gọi nhanh và mở chỉ đường ngay trên điện thoại.
                    </h1>

                    <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600 md:text-base">
                        Danh sách dưới đây được tối ưu cho mobile: thông tin xếp dọc, nút lớn dễ bấm và bản đồ chỉ mở khi bạn thực sự cần xem.
                    </p>

                    <div className="mt-5 grid grid-cols-1 gap-3">
                        {primaryPhone ? (
                            <a
                                href={`tel:${primaryPhone.replace(/[^\d+]/g, '')}`}
                                className="inline-flex min-h-[56px] items-center justify-center rounded-[22px] bg-primary px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white transition hover:brightness-95"
                            >
                                Gọi hotline: {primaryPhone}
                            </a>
                        ) : null}

                        <Link
                            to="/"
                            className="inline-flex min-h-[56px] items-center justify-center rounded-[22px] border border-gold/20 bg-background-light px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-umber transition hover:border-gold/35 hover:bg-[#f2e8dc]"
                        >
                            Quay về trang chủ
                        </Link>
                    </div>
                </div>
            </section>

            <section className="mx-auto max-w-4xl px-4 pb-14">
                <StoreLocationCards stores={activeStores} mode="page" sitePhone={primaryPhone} />
            </section>
        </div>
    );
};

export default StoreLocationsPage;
