import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';

const Login = () => {
    const [credentials, setCredentials] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        setCredentials({ ...credentials, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const response = await authApi.login(credentials);
            localStorage.setItem('token', response.data.token);
            localStorage.setItem('user', JSON.stringify(response.data.user));
            
            if (response.data.user.is_admin) {
                navigate('/admin');
            } else {
                navigate('/dashboard');
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Đăng nhập thất bại. Vui lòng thử lại.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-[80vh] flex items-center justify-center bg-background-light py-20 px-6">
            <div className="w-full max-w-md bg-white border border-gold/20 p-8 lg:p-12 shadow-xl relative overflow-hidden">
                {/* Decorative Pattern */}
                <div className="absolute top-0 right-0 w-24 h-24 text-gold/10 pointer-events-none">
                    <span className="material-symbols-outlined text-8xl">local_florist</span>
                </div>

                <div className="text-center mb-10">
                    <h1 className="font-display text-3xl font-bold text-primary mb-2 uppercase tracking-tight">Kính Chào Quý Khách</h1>
                    <p className="font-body text-stone italic">Đăng nhập để trải nghiệm tinh hoa gốm Việt</p>
                </div>

                {error && (
                    <div className="bg-brick/10 border-l-4 border-brick p-4 mb-6 text-brick text-sm font-ui">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={credentials.email}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border-gold/30 border-b p-3 focus:outline-none focus:border-primary transition-all font-body text-lg"
                            placeholder="username@example.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Mật Khẩu</label>
                        <input
                            type="password"
                            name="password"
                            value={credentials.password}
                            onChange={handleChange}
                            required
                            className="w-full bg-background-light border-gold/30 border-b p-3 focus:outline-none focus:border-primary transition-all font-body text-lg"
                            placeholder="********"
                        />
                    </div>

                    <div className="flex justify-end">
                        <Link to="#" className="text-stone text-xs font-ui hover:text-primary transition-colors">Quên mật khẩu?</Link>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary text-white font-ui font-bold uppercase tracking-widest py-4 hover:bg-umber transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <span>Đăng Nhập</span>
                                <span className="material-symbols-outlined text-sm">login</span>
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-10 text-center space-y-4">
                    <div className="flex items-center gap-4 text-stone/40">
                        <div className="h-[1px] flex-1 bg-current"></div>
                        <span className="text-[10px] uppercase tracking-widest">Hoặc</span>
                        <div className="h-[1px] flex-1 bg-current"></div>
                    </div>
                    <p className="font-ui text-sm text-stone">
                        Chưa có tài khoản? <Link to="/register" className="text-primary font-bold border-b border-primary hover:text-gold hover:border-gold transition-all">Đăng ký ngay</Link>
                    </p>
                </div>
            </div>
        </main>
    );
};

export default Login;
