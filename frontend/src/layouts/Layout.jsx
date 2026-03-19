import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AIChatWidget from '../components/AIChatWidget';
import { rememberLeadAttribution } from '../utils/leadAttribution';

const Layout = () => {
    useEffect(() => {
        rememberLeadAttribution();
    }, []);

    return (
        <div className="flex flex-col min-h-screen bg-background-light text-umber antialiased selection:bg-primary/20 selection:text-primary">
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
