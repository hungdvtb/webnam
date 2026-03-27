import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

const Register = () => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        password_confirmation: ''
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { setUser } = useAuth();

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const response = await authApi.register(formData);
            localStorage.setItem('token', response.data.token);
            localStorage.setItem('user', JSON.stringify(response.data.user));
            setUser(response.data.user);
            navigate('/dashboard');
        } catch (err) {
            setError(err.response?.data?.message || 'Đăng ký thất bại. Vui lòng kiểm tra lại thông tin.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-[80vh] flex items-center justify-center bg-background-light py-20 px-6">
            <div className="w-full max-w-md bg-white border border-gold/20 p-8 lg:p-12 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-24 h-24 text-gold/10 pointer-events-none rotate-180">
                    <span className="material-symbols-outlined text-8xl">local_florist</span>
                </div>

                <div className="text-center mb-10">
                    <h1 className="font-display text-3xl font-bold text-primary mb-2 uppercase tracking-tight">Tham Gia Cùng Chúng Tôi</h1>
                    <p className="font-body text-stone italic">Trở thành một phần của cộng đồng yêu gốm Việt</p>
                </div>

                {error && (
                    <div className="bg-brick/10 border-l-4 border-brick p-4 mb-6 text-brick text-sm font-ui">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-1">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Họ và Tên</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border-gold/30 border-b p-3 focus:outline-none focus:border-primary transition-all font-body text-lg"
                            placeholder="Nguyễn Văn A"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border-gold/30 border-b p-3 focus:outline-none focus:border-primary transition-all font-body text-lg"
                            placeholder="username@example.com"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Mật Khẩu</label>
                        <input
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border-gold/30 border-b p-3 focus:outline-none focus:border-primary transition-all font-body text-lg"
                            placeholder="********"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Xác Nhận Mật Khẩu</label>
                        <input
                            type="password"
                            name="password_confirmation"
                            value={formData.password_confirmation}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border-gold/30 border-b p-3 focus:outline-none focus:border-primary transition-all font-body text-lg"
                            placeholder="********"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary text-white font-ui font-bold uppercase tracking-widest py-4 mt-4 hover:bg-umber transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <span>Đăng Ký Tài Khoản</span>
                                <span className="material-symbols-outlined text-sm">person_add</span>
                            </>
                        )}
                    </button>
                </form>

                <p className="mt-10 text-center font-ui text-sm text-stone">
                    Đã có tài khoản? <Link to="/login" className="text-primary font-bold border-b border-primary hover:text-gold hover:border-gold transition-all">Đăng nhập</Link>
                </p>
            </div>
        </main>
    );
};

export default Register;
