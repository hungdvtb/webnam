import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8002/api',
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

// Interceptor to add Bearer token if present
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const productApi = {
    getAll: (params) => api.get('/products', { params }),
    getOne: (id) => api.get(`/products/${id}`),
    store: (data) => api.post('/products', data),
    update: (id, data) => api.put(`/products/${id}`, data),
    destroy: (id) => api.delete(`/products/${id}`),
};

export const categoryApi = {
    getAll: () => api.get('/categories'),
    getOne: (id) => api.get(`/categories/${id}`),
};

export const authApi = {
    login: (credentials) => api.post('/login', credentials),
    register: (data) => api.post('/register', data),
    logout: () => api.post('/logout'),
    getUser: () => api.get('/user'),
};

export const cartApi = {
    get: () => api.get('/cart'),
    add: (data) => api.post('/cart/add', data),
    update: (data) => api.post('/cart/update', data),
    remove: (cartItemId) => api.post('/cart/remove', { cart_item_id: cartItemId }),
};

export const orderApi = {
    getAll: () => api.get('/orders'),
    create: (data) => api.post('/orders', data),
    getOne: (id) => api.get(`/orders/${id}`),
};

export default api;
