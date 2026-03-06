import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productApi, categoryApi } from '../../services/api';

const ProductForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);

    const [formData, setFormData] = useState({
        name: '',
        category_id: '',
        price: '',
        description: '',
        is_featured: false,
        is_new: true,
        stock_quantity: 10,
        sku: ''
    });

    useEffect(() => {
        fetchCategories();
        if (isEdit) {
            fetchProduct();
        }
    }, [id]);

    const fetchCategories = async () => {
        try {
            const response = await categoryApi.getAll();
            setCategories(response.data);
        } catch (error) {
            console.error("Error fetching categories", error);
        }
    };

    const fetchProduct = async () => {
        try {
            const response = await productApi.getOne(id);
            const data = response.data;
            setFormData({
                name: data.name,
                category_id: data.category_id,
                price: data.price,
                description: data.description || '',
                is_featured: !!data.is_featured,
                is_new: !!data.is_new,
                stock_quantity: data.stock_quantity || 0,
                sku: data.sku || ''
            });
        } catch (error) {
            alert('Không thể tải thông tin sản phẩm.');
            navigate('/admin/products');
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isEdit) {
                await productApi.update(id, formData);
                alert('Cập nhật phẩm vật thành công!');
            } else {
                await productApi.store(formData);
                alert('Thêm phẩm vật mới thành công!');
            }
            navigate('/admin/products');
        } catch (error) {
            alert('Có lỗi xảy ra: ' + (error.response?.data?.message || 'Vui lòng kiểm tra lại thông tin.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl space-y-8 animate-fade-in">
            <div className="flex items-center gap-4">
                <Link to="/admin/products" className="size-10 rounded-full border border-gold/20 flex items-center justify-center text-primary hover:bg-gold/10 transition-colors">
                    <span className="material-symbols-outlined text-sm">west</span>
                </Link>
                <h1 className="text-3xl font-display font-bold text-primary">
                    {isEdit ? 'Hiệu Chỉnh Phẩm Vật' : 'Tạo Phẩm Vật Mới'}
                </h1>
            </div>

            <form onSubmit={handleSubmit} className="bg-white border-2 border-gold p-10 shadow-2xl space-y-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Basic Info */}
                    <div className="md:col-span-2 space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Tên Phẩm Vật</label>
                        <input
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body text-lg"
                            placeholder="Vinh Hoa Phú Quý..."
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Danh Mục</label>
                        <select
                            name="category_id"
                            value={formData.category_id}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                        >
                            <option value="">-- Chọn danh mục --</option>
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Mã SKU</label>
                        <input
                            name="sku"
                            value={formData.sku}
                            onChange={handleChange}
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                            placeholder="GM-VH-001"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Giá Niêm Yết (VND)</label>
                        <input
                            type="number"
                            name="price"
                            value={formData.price}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-ui font-bold text-brick"
                            placeholder="2800000"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Số Lượng Tồn Kho</label>
                        <input
                            type="number"
                            name="stock_quantity"
                            value={formData.stock_quantity}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                            placeholder="10"
                        />
                    </div>

                    <div className="md:col-span-2 space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Mô Tả Sản Phẩm</label>
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            rows="6"
                            className="w-full bg-background-light border border-gold/20 p-4 focus:outline-none focus:border-primary font-body resize-none"
                            placeholder="Mô tả về chất men, họa tiết, ý nghĩa tâm linh..."
                        ></textarea>
                    </div>

                    <div className="md:col-span-2 flex gap-12 pt-4">
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                name="is_featured"
                                checked={formData.is_featured}
                                onChange={handleChange}
                                className="size-5 text-primary focus:ring-primary rounded-sm border-gold/30"
                            />
                            <span className="font-ui text-sm font-bold text-stone group-hover:text-primary transition-colors">Sản phẩm nổi bật</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                name="is_new"
                                checked={formData.is_new}
                                onChange={handleChange}
                                className="size-5 text-primary focus:ring-primary rounded-sm border-gold/30"
                            />
                            <span className="font-ui text-sm font-bold text-stone group-hover:text-primary transition-colors">Gốm phẩm mới về</span>
                        </label>
                    </div>
                </div>

                <div className="pt-10 border-t border-gold/10 flex justify-end gap-6">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/products')}
                        className="px-8 py-4 font-ui font-bold uppercase tracking-widest text-stone hover:text-brick transition-colors"
                    >
                        Hủy bỏ
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-primary text-white px-12 py-4 font-ui font-bold uppercase tracking-widest hover:bg-umber transition-all shadow-xl shadow-primary/20 flex items-center gap-3"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <span>{isEdit ? 'Lưu Thay Đổi' : 'Xác Nhận Tạo Mới'}</span>
                                <span className="material-symbols-outlined text-sm">check_circle</span>
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ProductForm;
