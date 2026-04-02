import React, { createContext, useState, useEffect, useContext } from 'react';
import { authApi } from '../services/api';
import {
    clearSyncedUserSettingsCache,
    flushUserSettingsSync,
    stopUserSettingsSync,
} from '../services/userSettingsSync';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    const response = await authApi.getUser();
                    setUser(response.data);
                } catch (error) {
                    console.error("Auth check failed", error);
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    stopUserSettingsSync();
                    clearSyncedUserSettingsCache();
                }
            }
            setLoading(false);
        };
        checkAuth();
    }, []);

    const logout = async () => {
        try {
            await flushUserSettingsSync();
            await authApi.logout();
        } catch (error) {
            console.error("Logout error", error);
        } finally {
            stopUserSettingsSync();
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            clearSyncedUserSettingsCache();
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider value={{ user, setUser, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
