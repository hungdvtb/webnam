import React, { useEffect, useRef, useState } from 'react';
import { inventoryApi } from '../../services/api';
import { formatReturnOrderCurrency } from '../../config/returnOrderStatus';

const inputClass = 'h-11 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10';

const flattenInventoryProducts = (products = []) => {
    const flattened = [];
    const seen = new Set();

    (products || []).forEach((product) => {
        if (Array.isArray(product?.variants) && product.variants.length > 0) {
            product.variants.forEach((variant) => {
                const id = Number(variant?.id || 0);
                if (!id || seen.has(id)) return;
                seen.add(id);
                flattened.push({
                    ...variant,
                    parent_name: product.name,
                    parent_sku: product.sku,
                });
            });
            return;
        }

        const id = Number(product?.id || 0);
        if (!id || seen.has(id)) return;
        seen.add(id);
        flattened.push(product);
    });

    return flattened;
};

const buildProductLabel = (product) => {
    if (!product) return '';
    return `${product.name || 'San pham'}${product.sku ? ` - ${product.sku}` : ''}`;
};

const ProductLookupField = ({ value, onSelect, placeholder = 'Tim san pham de them...' }) => {
    const containerRef = useRef(null);
    const [query, setQuery] = useState(() => buildProductLabel(value));
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setQuery(buildProductLabel(value));
    }, [value?.id]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
                setQuery(buildProductLabel(value));
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [value]);

    useEffect(() => {
        if (!open) return undefined;

        const keyword = query.trim();
        if (!keyword) {
            setResults([]);
            setLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const response = await inventoryApi.getProducts({
                    search: keyword,
                    quick_search: keyword,
                    with_variants: 1,
                    variant_scope: 'roots',
                    per_page: 20,
                    picker: 1,
                    without_summary: 1,
                }, controller.signal);

                setResults(flattenInventoryProducts(response.data?.data || []));
            } catch (error) {
                if (error?.code !== 'ERR_CANCELED') setResults([]);
            } finally {
                setLoading(false);
            }
        }, 220);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [open, query]);

    return (
        <div className="relative" ref={containerRef}>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={query}
                    onFocus={() => setOpen(true)}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setOpen(true);
                    }}
                    placeholder={placeholder}
                    className={inputClass}
                />
                {value ? (
                    <button
                        type="button"
                        onClick={() => {
                            onSelect(null);
                            setQuery('');
                            setResults([]);
                            setOpen(false);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/50 transition-all hover:border-primary/30 hover:text-primary"
                        title="Bo chon"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                ) : null}
            </div>

            {open ? (
                <div className="absolute left-0 right-0 top-full z-[120] mt-2 overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl">
                    <div className="max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="px-4 py-6 text-center text-[12px] font-semibold text-primary/45">Dang tim san pham...</div>
                        ) : results.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[12px] font-semibold text-primary/35">Khong co ket qua phu hop.</div>
                        ) : (
                            results.map((product) => (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => {
                                        onSelect(product);
                                        setQuery(buildProductLabel(product));
                                        setOpen(false);
                                    }}
                                    className="flex w-full flex-col gap-1 border-b border-primary/5 px-4 py-3 text-left transition-all hover:bg-primary/5"
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="truncate text-[13px] font-bold text-[#0F172A]">{product.name}</span>
                                        <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.2em] text-primary/40">{product.sku || 'No SKU'}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
                                        {product.parent_name ? <span>Bien the cua {product.parent_name}</span> : null}
                                        <span>Ton {product.stock_quantity ?? 0}</span>
                                        <span>Gia {formatReturnOrderCurrency(product.price)}d</span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default ProductLookupField;
