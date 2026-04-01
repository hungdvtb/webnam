import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AIChatWidget from '../components/AIChatWidget';
import { rememberLeadAttribution } from '../utils/leadAttribution';

const Layout = () => {
    const location = useLocation();

    useEffect(() => {
        rememberLeadAttribution();
    }, [location.pathname, location.search, location.hash]);

    return (
        <div className="mobile-type-scope flex min-h-screen flex-col bg-background-light text-umber antialiased selection:bg-primary/20 selection:text-primary">
            <Navbar />
            <main className="flex-grow">
                <Outlet />
            </main>
            <Footer />
            <AIChatWidget />
        </div>
    );
};

export default Layout;
