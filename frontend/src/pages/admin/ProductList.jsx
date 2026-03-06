import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { productApi } from '../../services/api';

const ProductList = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const response = await productApi.getAll({ search, per_page: 50 });
            setProducts(response.data.data);
        } catch (error) {
            console.error("Error fetching admin products", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Quý khách có chắc chắn muốn xóa phẩm vật này không?')) return;
        try {
            await productApi.destroy(id);
            fetchProducts();
        } catch (error) {
            alert('Có lỗi xảy ra khi xóa sản phẩm.');
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-display font-bold text-primary">Danh Sách Phẩm Vật</h1>
                <Link to="/admin/products/new" className="bg-primary text-white px-8 py-3 font-ui font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-umber transition-all shadow-lg shadow-primary/20">
                    <span className="material-symbols-outlined text-base">add</span>
                    Thêm phẩm vật mới
                </Link>
            </div>

            <div className="bg-white border border-gold/10 shadow-2xl p-6">
                <div className="flex gap-4 mb-8">
                    <div className="relative flex-grow max-w-md">
                        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gold">search</span>
                        <input
                            type="text"
                            placeholder="Tìm kiếm sản phẩm..."
                            className="w-full bg-background-light border border-gold/20 p-4 pl-12 focus:outline-none focus:border-primary font-body italic"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && fetchProducts()}
                        />
                    </div>
                    <button
                        onClick={fetchProducts}
                        className="bg-gold/10 text-primary border border-gold/30 px-6 font-ui font-bold uppercase tracking-tighter text-xs hover:bg-gold/20"
                    >
                        Lọc dữ liệu
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                            <tr>
                                <th className="p-4 w-16">ID</th>
                                <th className="p-4">Phẩm vật</th>
                                <th className="p-4">Danh mục</th>
                                <th className="p-4">Giá bán</th>
                                <th className="p-4">Tồn kho</th>
                                <th className="p-4 text-center">Nổi bật</th>
                                <th className="p-4 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="font-body">
                            {products.map((product) => (
                                <tr key={product.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                    <td className="p-4 text-xs text-stone font-ui">#{product.id}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-4">
                                            <div className="size-12 bg-background-light flex-shrink-0 border border-gold/10 overflow-hidden">
                                                <img src={product.images?.[0]?.image_url} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-primary group-hover:text-gold transition-colors">{product.name}</p>
                                                <p className="text-[10px] text-stone italic uppercase tracking-tighter">{product.sku}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 italic text-stone">{product.category?.name}</td>
                                    <td className="p-4 font-ui font-bold text-primary">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}</td>
                                    <td className="p-4 italic text-stone">{product.stock_quantity || 0} món</td>
                                    <td className="p-4 text-center">
                                        {product.is_featured ? (
                                            <span className="material-symbols-outlined text-gold">star</span>
                                        ) : (
                                            <span className="material-symbols-outlined text-stone/20">star</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right space-x-2">
                                        <Link to={`/admin/products/edit/${product.id}`} className="text-primary hover:text-gold transition-colors inline-block">
                                            <span className="material-symbols-outlined text-xl">edit_square</span>
                                        </Link>
                                        <button onClick={() => handleDelete(product.id)} className="text-stone hover:text-brick transition-colors">
                                            <span className="material-symbols-outlined text-xl">delete_forever</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {loading && (
                                <tr>
                                    <td colSpan="7" className="p-12 text-center text-gold italic">Đang bốc gốm...</td>
                                </tr>
                            )}
                            {!loading && products.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="p-12 text-center text-stone italic">Không tìm thấy phẩm vật nào.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ProductList;
