import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams, useParams, useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';

const DEFAULT_SORT_OPTIONS = [
    { value: 'newest', label: 'Mới nhất' },
    { value: 'price_asc', label: 'Giá tăng dần' },
    { value: 'price_desc', label: 'Giá giảm dần' },
    { value: 'name_asc', label: 'Tên A-Z' },
    { value: 'popular', label: 'Nổi bật' },
];

const LAYOUT_TWO_SORT_OPTIONS = [
    { value: 'popular', label: 'Ưu tiên nổi bật' },
    { value: 'newest', label: 'Mới nhất' },
    { value: 'price_asc', label: 'Giá tăng dần' },
    { value: 'price_desc', label: 'Giá giảm dần' },
];

const FILTER_LABELS = {
    duongkinh: 'Chọn đường kính',
    loai_men: 'Chọn loại men',
};

const FALLBACK_PRODUCT_IMAGE = 'https://placehold.co/800x1000/F5EEE2/1B365D?text=San+pham';

const formatCurrency = (value) => {
    const amount = Number(value || 0);
    return amount > 0 ? `${amount.toLocaleString('vi-VN')}đ` : 'Liên hệ';
};

const normalizeImageUrl = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed || trimmed === '/' || trimmed === '#') {
        return '';
    }

    return trimmed;
};

const resolveProductImage = (product) => {
    const candidates = [
        product?.main_image,
        product?.primary_image?.url,
        product?.primary_image?.path,
    ];

    return candidates.map(normalizeImageUrl).find(Boolean) || FALLBACK_PRODUCT_IMAGE;
};

const findCategoryBySlug = (categories = [], slug) => {
    for (const category of categories) {
        if (category.slug === slug) {
            return category;
        }

        const childMatch = findCategoryBySlug(category.children || [], slug);
        if (childMatch) {
            return childMatch;
        }
    }

    return null;
};

const buildPaginationPages = (current, last) => {
    if (!last || last <= 1) {
        return [];
    }

    if (last <= 7) {
        return Array.from({ length: last }, (_, index) => index + 1);
    }

    if (current <= 4) {
        return Array.from({ length: 7 }, (_, index) => index + 1);
    }

    if (current >= last - 3) {
        return Array.from({ length: 7 }, (_, index) => last - 6 + index);
    }

    return Array.from({ length: 7 }, (_, index) => current - 3 + index);
};

const readAttributeParams = (params) => {
    const result = {};

    params.forEach((value, key) => {
        const match = key.match(/^attrs\[(.+)\]$/);
        if (match && value) {
            result[match[1]] = value;
        }
    });

    return result;
};

const ProductCard = ({ product, onConsult, categoryLabel }) => {
    const [imgLoaded, setImgLoaded] = useState(false);
    const hasDiscount = Number(product?.current_price || 0) < Number(product?.price || 0);
    const primaryPrice = formatCurrency(product?.current_price || product?.price);
    const secondaryPrice = hasDiscount ? formatCurrency(product?.price) : null;
    const cardCategory = product?.category?.name || categoryLabel || 'Sản phẩm gốm sứ';
    const badge = product?.is_featured
        ? {
            label: 'Bán chạy',
            className: 'bg-[#c89b45] text-white',
        }
        : product?.is_new
            ? {
                label: 'Mới',
                className: 'bg-emerald-600 text-white',
            }
            : null;

    return (
        <article className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-[#eee2d1] bg-white shadow-[0_18px_38px_-28px_rgba(27,54,93,0.42)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_26px_42px_-22px_rgba(27,54,93,0.34)]">
            <Link
                to={`/san-pham/${product.slug || product.id}`}
                className="relative block aspect-[4/5] overflow-hidden bg-[linear-gradient(180deg,#f7f0e6_0%,#efe3d3_100%)]"
            >
                {!imgLoaded ? <div className="absolute inset-0 animate-pulse bg-stone-200/80" /> : null}
                <img
                    src={resolveProductImage(product)}
                    alt={product.name}
                    loading="lazy"
                    onLoad={() => setImgLoaded(true)}
                    onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = FALLBACK_PRODUCT_IMAGE;
                        setImgLoaded(true);
                    }}
                    className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.03] ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/18 to-transparent" />
                {badge ? (
                    <span className={`absolute right-3 top-3 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] shadow-lg ${badge.className}`}>
                        {badge.label}
                    </span>
                ) : null}
            </Link>

            <div className="flex flex-1 flex-col gap-2.5 px-3.5 pb-3.5 pt-3 md:px-4 md:pb-4 md:pt-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c08d40]">
                    {cardCategory}
                </p>

                <Link to={`/san-pham/${product.slug || product.id}`}>
                    <h3 className="line-clamp-2 min-h-[2.7rem] text-[15px] font-black leading-[1.34] text-primary transition-colors group-hover:text-[#284f86] md:min-h-[3rem] md:text-[18px]">
                        {product.name}
                    </h3>
                </Link>

                <div className="mt-auto space-y-1">
                    <p className="text-[18px] font-black leading-none text-[#c08d40] md:text-[22px]">
                        {primaryPrice}
                    </p>
                    {secondaryPrice ? (
                        <p className="text-[11px] font-medium text-stone-400 line-through">
                            {secondaryPrice}
                        </p>
                    ) : (
                        <p className="text-[11px] font-medium leading-relaxed text-stone-400">
                            {product?.is_featured ? 'Được chọn nhiều cho không gian thờ' : 'Gốm thủ công tuyển chọn'}
                        </p>
                    )}
                </div>

                <div className="mt-1 flex items-center gap-2">
                    <Link
                        to={`/san-pham/${product.slug || product.id}`}
                        className="flex-1 rounded-[16px] bg-primary px-3 py-2.5 text-center text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:brightness-95"
                    >
                        Xem chi tiết
                    </Link>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.preventDefault();
                            onConsult?.(product);
                        }}
                        className="rounded-[16px] border border-[#eadfce] px-3 py-2.5 text-[11px] font-bold text-primary transition-all hover:bg-[#f8f3eb]"
                    >
                        Tư vấn
                    </button>
                </div>
            </div>
        </article>
    );
};

const FilterBlock = ({ index, label, children }) => (
    <div className="space-y-2 md:space-y-3">
        <div className="flex items-center gap-2 md:gap-3">
            <span className="inline-flex min-w-[28px] items-center justify-center rounded-lg bg-[#f5ecde] px-1.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-[#bc8b3e] md:min-w-[36px] md:rounded-xl md:px-2 md:py-1.5 md:text-[11px] md:tracking-[0.12em]">
                {String(index).padStart(2, '0')}
            </span>
            <p className="text-[10px] font-black uppercase leading-none tracking-[0.12em] text-[#bc8b3e] md:text-[13px] md:tracking-[0.18em]">
                {label}
            </p>
        </div>
        {children}
    </div>
);

const LayoutTwoFilterCard = ({
    filters,
    priceFilter,
    sort,
    featured,
    onSelectFilter,
    onUpdateParam,
    onReset,
    searchParams,
}) => {
    const hasAppliedFilter = featured || Object.keys(readAttributeParams(searchParams)).length > 0;

    return (
        <section className="rounded-[22px] border border-[#f1e7d9] bg-white p-3 shadow-[0_22px_48px_-32px_rgba(27,54,93,0.28)] md:rounded-[28px] md:p-6">
            <div className="grid gap-2.5 md:grid-cols-2 md:gap-4 xl:grid-cols-4 xl:gap-6">
                {filters.map((filter, index) => {
                    const value = searchParams.get(`attrs[${filter.code}]`) || '';

                    return (
                        <FilterBlock
                            key={filter.code}
                            index={index + 1}
                            label={FILTER_LABELS[filter.code] || filter.name}
                        >
                            <div className="relative">
                                <select
                                    value={value}
                                    onChange={(event) => onSelectFilter(filter.code, event.target.value)}
                                    className="min-h-[42px] w-full appearance-none rounded-[14px] border border-[#d9dde5] bg-[#fcfaf7] px-3 py-2 pr-9 text-[13px] font-semibold text-stone-700 outline-none transition focus:border-primary focus:bg-white md:min-h-[52px] md:rounded-[18px] md:px-4 md:py-3 md:pr-11 md:text-sm"
                                >
                                    <option value="">{`Tất cả ${filter.name.toLowerCase()}`}</option>
                                    {filter.options.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                            {typeof option.count === 'number' ? ` (${option.count})` : ''}
                                        </option>
                                    ))}
                                </select>
                                <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-primary md:right-4 md:text-[20px]">
                                    expand_more
                                </span>
                            </div>
                        </FilterBlock>
                    );
                })}

                <FilterBlock index={filters.length + 1} label="Sắp xếp giá tiền">
                    <div className="relative">
                        <select
                            value={sort}
                            onChange={(event) => onUpdateParam('sort', event.target.value)}
                            className="min-h-[42px] w-full appearance-none rounded-[14px] border border-[#d9dde5] bg-[#fcfaf7] px-3 py-2 pr-9 text-[13px] font-semibold text-stone-700 outline-none transition focus:border-primary focus:bg-white md:min-h-[52px] md:rounded-[18px] md:px-4 md:py-3 md:pr-11 md:text-sm"
                        >
                            {LAYOUT_TWO_SORT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                                ))}
                        </select>
                        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-primary md:right-4 md:text-[20px]">
                            expand_more
                        </span>
                    </div>
                </FilterBlock>

                <FilterBlock index={filters.length + 2} label="Chọn nhu cầu">
                    <div className="grid grid-cols-2 gap-1.5 md:gap-2.5">
                        <button
                            type="button"
                            onClick={() => onUpdateParam('featured', '')}
                            className={`min-h-[40px] rounded-[14px] px-2.5 py-2 text-[11px] font-black leading-tight transition-all md:min-h-[52px] md:rounded-[18px] md:px-4 md:py-3 md:text-sm ${
                                !featured
                                    ? 'bg-primary text-white shadow-md'
                                    : 'border border-[#e7dccb] bg-[#faf6f0] text-stone-500'
                            }`}
                        >
                            Tất cả sản phẩm
                        </button>
                        <button
                            type="button"
                            onClick={() => onUpdateParam('featured', featured ? '' : '1')}
                            className={`min-h-[40px] rounded-[14px] px-2.5 py-2 text-[11px] font-black leading-tight transition-all md:min-h-[52px] md:rounded-[18px] md:px-4 md:py-3 md:text-sm ${
                                featured
                                    ? 'bg-primary text-white shadow-md'
                                    : 'border border-[#e7dccb] bg-[#faf6f0] text-stone-500'
                            }`}
                        >
                            Sản phẩm nổi bật
                        </button>
                    </div>
                </FilterBlock>
            </div>

            <div className="mt-3 flex flex-col gap-2 border-t border-[#f0e7da] pt-3 text-[10px] text-stone-500 md:mt-4 md:gap-3 md:pt-4 md:text-xs md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                    {priceFilter?.min ? (
                        <span className="rounded-full bg-[#faf4ea] px-2.5 py-1 font-semibold text-[#9a7740] md:px-3 md:py-1.5">
                            Giá từ {formatCurrency(priceFilter.min)} đến {formatCurrency(priceFilter.max)}
                        </span>
                    ) : null}
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 font-semibold text-stone-600 md:px-3 md:py-1.5">
                        Bộ lọc tối ưu cho màn hình nhỏ
                    </span>
                </div>

                {hasAppliedFilter ? (
                    <button
                        type="button"
                        onClick={onReset}
                        className="self-start rounded-full border border-[#e2d4bf] px-2.5 py-1 font-bold uppercase tracking-[0.08em] text-[#9b7840] transition hover:bg-[#faf4ea] md:self-auto md:px-3 md:py-1.5 md:tracking-[0.12em]"
                    >
                        Xóa lọc nhanh
                    </button>
                ) : null}
            </div>
        </section>
    );
};

const Pagination = ({ page, pagination, onUpdateParam, compact = false }) => {
    const pages = buildPaginationPages(page, pagination.last);

    if (pages.length === 0) {
        return null;
    }

    return (
        <div className={`flex items-center justify-center gap-2 ${compact ? 'mt-8' : 'mt-10'}`}>
            {page > 1 ? (
                <button
                    type="button"
                    onClick={() => onUpdateParam('page', page - 1)}
                    className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-2xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-600 transition hover:bg-stone-50"
                >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                </button>
            ) : null}

            {pages.map((item) => (
                <button
                    key={item}
                    type="button"
                    onClick={() => onUpdateParam('page', item)}
                    className={`flex min-h-[42px] min-w-[42px] items-center justify-center rounded-2xl px-3 text-sm font-bold transition ${
                        item === page
                            ? 'bg-primary text-white shadow-md'
                            : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                    }`}
                >
                    {item}
                </button>
            ))}

            {page < pagination.last ? (
                <button
                    type="button"
                    onClick={() => onUpdateParam('page', page + 1)}
                    className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-2xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-600 transition hover:bg-stone-50"
                >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                </button>
            ) : null}
        </div>
    );
};

const EmptyState = ({ isLayoutTwo = false, onReset }) => (
    <div className={`text-center ${isLayoutTwo ? 'rounded-[28px] border border-dashed border-[#e7dac4] bg-white px-6 py-14' : 'py-20 opacity-40'}`}>
        <span className={`material-symbols-outlined mb-3 block ${isLayoutTwo ? 'text-5xl text-[#c59e63]' : 'text-6xl text-stone-300'}`}>
            inventory_2
        </span>
        <p className={`font-bold ${isLayoutTwo ? 'text-xl text-primary' : 'text-lg text-stone-700'}`}>
            Không tìm thấy sản phẩm
        </p>
        <p className="mt-1 text-sm text-stone-500">
            Thử thay đổi bộ lọc hoặc quay lại danh sách đầy đủ để xem thêm lựa chọn.
        </p>
        {isLayoutTwo ? (
            <button
                type="button"
                onClick={onReset}
                className="mt-5 rounded-full border border-[#dfcfb7] px-5 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-[#9a7740] transition hover:bg-[#faf4ea]"
            >
                Xóa toàn bộ bộ lọc
            </button>
        ) : null}
    </div>
);

const LoadingGrid = ({ compact = false }) => (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 ${compact ? 'md:gap-5' : 'md:gap-4'}`}>
        {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-[24px] border border-stone-100 bg-white">
                <div className="aspect-[4/5] animate-pulse bg-stone-200" />
                <div className="space-y-2 p-4">
                    <div className="h-3 w-20 animate-pulse rounded bg-stone-200" />
                    <div className="h-4 w-4/5 animate-pulse rounded bg-stone-200" />
                    <div className="h-4 w-2/5 animate-pulse rounded bg-stone-200" />
                </div>
            </div>
        ))}
    </div>
);

const StorefrontProducts = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { slug: routeCategorySlug } = useParams();
    const { categories } = useOutletContext();

    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({});
    const [consultProduct, setConsultProduct] = useState(null);
    const [showFilter, setShowFilter] = useState(false);
    const [availableFilters, setAvailableFilters] = useState([]);
    const [categoryDetail, setCategoryDetail] = useState(null);

    const categoryQuerySlug = searchParams.get('category') || '';
    const activeCategorySlug = routeCategorySlug || categoryQuerySlug;
    const searchParamsString = searchParams.toString();
    const search = searchParams.get('search') || '';
    const featured = searchParams.get('featured');
    const sort = searchParams.get('sort') || 'newest';
    const pageParam = Number.parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

    const currentCategory = categoryDetail || findCategoryBySlug(categories, activeCategorySlug);
    const isLayoutTwo = categoryDetail?.display_layout === 'layout_2';
    const activeSortOptions = isLayoutTwo ? LAYOUT_TWO_SORT_OPTIONS : DEFAULT_SORT_OPTIONS;
    const categoryTitle = currentCategory?.name || (search ? `Kết quả: "${search}"` : 'Tất cả sản phẩm');
    const categoryDescription = currentCategory?.description || 'Khám phá bộ sưu tập tuyển chọn với bố cục được tối ưu cho mobile, dễ lướt và dễ so sánh.';
    const layoutTwoFilters = availableFilters.filter((filter) => ['select', 'multiselect'].includes(filter.type));
    const priceFilter = availableFilters.find((filter) => filter.type === 'price_range');

    const fetchProducts = useCallback(async () => {
        setLoading(true);

        try {
            let nextCategoryDetail = null;

            if (activeCategorySlug) {
                try {
                    const categoryResponse = await api.get(`/web-api/categories/${activeCategorySlug}`);
                    nextCategoryDetail = categoryResponse.data;
                } catch (categoryError) {
                    console.error('Failed to load category detail', categoryError);
                }
            }

            setCategoryDetail(nextCategoryDetail);

            const params = new URLSearchParams(searchParamsString);
            if (activeCategorySlug) {
                params.set('category', activeCategorySlug);
            } else {
                params.delete('category');
            }

            params.set('sort', sort);
            params.set('page', String(page));
            params.set('per_page', nextCategoryDetail?.display_layout === 'layout_2' ? '24' : '20');

            const endpoint = nextCategoryDetail?.display_layout === 'layout_2' ? '/web-api/products' : '/storefront/products';
            const response = await api.get(`${endpoint}?${params.toString()}`);
            const payload = response.data || {};

            setProducts(payload.data || []);
            setPagination({
                current: payload.current_page || 1,
                last: payload.last_page || 1,
                total: payload.total || 0,
            });
            setAvailableFilters(Array.isArray(payload.available_filters) ? payload.available_filters : []);
        } catch (error) {
            console.error('Failed to load products', error);
            setProducts([]);
            setPagination({ current: 1, last: 1, total: 0 });
            setAvailableFilters([]);
        } finally {
            setLoading(false);
        }
    }, [activeCategorySlug, page, searchParamsString, sort]);

    useEffect(() => {
        fetchProducts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [fetchProducts]);

    useEffect(() => {
        setShowFilter(false);
    }, [routeCategorySlug, categoryQuerySlug, searchParamsString]);

    const updateParam = (key, value) => {
        const params = new URLSearchParams(searchParams);

        if (value === undefined || value === null || value === '') {
            params.delete(key);
        } else {
            params.set(key, String(value));
        }

        if (key !== 'page') {
            params.delete('page');
        }

        setSearchParams(params);
    };

    const updateAttributeFilter = (code, value) => {
        updateParam(`attrs[${code}]`, value);
    };

    const resetLayoutTwoFilters = () => {
        const params = new URLSearchParams(searchParams);

        Array.from(params.keys()).forEach((key) => {
            if (key.startsWith('attrs[')) {
                params.delete(key);
            }
        });

        params.delete('featured');
        params.delete('page');
        params.set('sort', 'popular');
        setSearchParams(params);
    };

    return (
        <div className="animate-fade-in">
            <div className={`${isLayoutTwo ? 'bg-[linear-gradient(180deg,#faf5ed_0%,#fffdfb_100%)]' : 'border-b border-stone-100 bg-stone-50'}`}>
                <div className={`mx-auto max-w-7xl px-4 ${isLayoutTwo ? 'py-4 md:py-5' : 'py-3'}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-stone-500">
                        <Link to="/" className="hover:text-primary">Trang chủ</Link>
                        <span>/</span>
                        {activeCategorySlug ? (
                            <>
                                <Link to="/san-pham" className="hover:text-primary">Cửa hàng</Link>
                                <span>/</span>
                                <span className="font-bold text-stone-800">{categoryTitle}</span>
                            </>
                        ) : (
                            <span className="font-bold text-stone-800">{categoryTitle}</span>
                        )}
                    </div>
                </div>
            </div>

            {isLayoutTwo ? (
                <div className="mx-auto max-w-7xl px-4 py-5 md:py-8">
                    <section className="rounded-[30px] bg-[linear-gradient(180deg,rgba(250,245,237,0.98)_0%,rgba(255,255,255,1)_100%)] px-4 py-5 md:px-7 md:py-7">
                        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                            <div className="border-l-4 border-[#c59d63] pl-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#bc8b3e]">
                                    Giao diện danh mục 2
                                </p>
                                <h1 className="mt-2 text-[31px] font-black leading-[1.02] text-primary md:text-[56px]">
                                    {categoryTitle}
                                </h1>
                                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-500 md:text-base">
                                    {categoryDescription}
                                </p>
                            </div>

                            <div className="flex min-w-[180px] items-center gap-3 self-start rounded-[22px] bg-white/90 px-4 py-3 shadow-[0_16px_34px_-28px_rgba(27,54,93,0.5)]">
                                <span className="material-symbols-outlined text-[28px] text-[#c59d63]">inventory_2</span>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">
                                        Sản phẩm hiển thị
                                    </p>
                                    <p className="text-xl font-black text-primary">
                                        {pagination.total || 0}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <div className="mt-4 md:mt-6">
                        <LayoutTwoFilterCard
                            filters={layoutTwoFilters}
                            priceFilter={priceFilter}
                            sort={sort}
                            featured={featured}
                            onSelectFilter={updateAttributeFilter}
                            onUpdateParam={updateParam}
                            onReset={resetLayoutTwoFilters}
                            searchParams={searchParams}
                        />
                    </div>

                    <section className="mt-5 md:mt-8">
                        {loading ? (
                            <LoadingGrid compact />
                        ) : products.length === 0 ? (
                            <EmptyState isLayoutTwo onReset={resetLayoutTwoFilters} />
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
                                    {products.map((product) => (
                                        <ProductCard
                                            key={product.id}
                                            product={product}
                                            onConsult={setConsultProduct}
                                            categoryLabel={categoryTitle}
                                        />
                                    ))}
                                </div>
                                <Pagination page={page} pagination={pagination} onUpdateParam={updateParam} compact />
                            </>
                        )}
                    </section>
                </div>
            ) : (
                <div className="mx-auto max-w-7xl px-4 py-6 md:py-8">
                    <div className="mb-6 flex items-center justify-between gap-4">
                        <div>
                            <h1 className="text-xl font-black uppercase tracking-tight text-stone-900 md:text-2xl">
                                {categoryTitle}
                            </h1>
                            <p className="mt-1 text-xs font-medium text-stone-500">
                                {pagination.total || 0} sản phẩm
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowFilter((previous) => !previous)}
                                className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-700 md:hidden"
                            >
                                <span className="material-symbols-outlined text-sm">tune</span>
                                Lọc
                            </button>
                            <select
                                value={sort}
                                onChange={(event) => updateParam('sort', event.target.value)}
                                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-700 outline-none"
                            >
                                {activeSortOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex gap-6">
                        <aside className={`${showFilter ? 'block' : 'hidden'} w-full shrink-0 md:block md:w-56`}>
                            <div className="rounded-2xl border border-stone-100 bg-white p-4">
                                <h3 className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone-800">
                                    Danh mục
                                </h3>
                                <div className="space-y-1">
                                    <Link
                                        to="/san-pham"
                                        className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                                            !activeCategorySlug
                                                ? 'bg-primary/5 font-bold text-primary'
                                                : 'text-stone-600 hover:bg-stone-50'
                                        }`}
                                    >
                                        Tất cả
                                    </Link>
                                    {(categories || []).map((category) => (
                                        <Link
                                            key={category.id}
                                            to={`/danh-muc/${category.slug}`}
                                            className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                                                activeCategorySlug === category.slug
                                                    ? 'bg-primary/5 font-bold text-primary'
                                                    : 'text-stone-600 hover:bg-stone-50'
                                            }`}
                                        >
                                            {category.name}
                                            {category.products_count > 0 ? (
                                                <span className="ml-1 text-[10px] text-stone-400">
                                                    ({category.products_count})
                                                </span>
                                            ) : null}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </aside>

                        <section className="min-w-0 flex-1">
                            {loading ? (
                                <LoadingGrid />
                            ) : products.length === 0 ? (
                                <EmptyState />
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
                                        {products.map((product) => (
                                            <ProductCard
                                                key={product.id}
                                                product={product}
                                                onConsult={setConsultProduct}
                                                categoryLabel={categoryTitle}
                                            />
                                        ))}
                                    </div>
                                    <Pagination page={page} pagination={pagination} onUpdateParam={updateParam} />
                                </>
                            )}
                        </section>
                    </div>
                </div>
            )}

            <LeadFormModal
                show={!!consultProduct}
                onClose={() => setConsultProduct(null)}
                product={consultProduct}
            />
        </div>
    );
};

export default StorefrontProducts;
