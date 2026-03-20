import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import ShippingSettingsPanel from '../../components/admin/ShippingSettingsPanel';

const ShippingSettingsPage = () => {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get('tab') || 'integrations';

    const handleTabChange = useCallback((tab) => {
        setSearchParams((currentParams) => {
            const next = new URLSearchParams(currentParams);
            if ((next.get('tab') || 'integrations') === tab) {
                return next;
            }
            next.set('tab', tab);
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    return (
        <div className="flex flex-col bg-[#fcfcfa] animate-fade-in p-6 w-full h-full overflow-hidden">
            <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/40">Cấu hình hệ thống</p>
                    <h1 className="text-[24px] font-black italic text-primary tracking-tight mt-2">Cài đặt vận chuyển</h1>
                    <p className="text-[13px] font-bold text-primary/50 mt-2">Quản lý kết nối hãng, mapping vận chuyển và thông báo giao vận trong cùng một màn hình.</p>
                </div>
                <div className="shrink-0">
                    <AccountSelector user={user} />
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
                <ShippingSettingsPanel initialTab={activeTab} onTabChange={handleTabChange} />
            </div>
        </div>
    );
};

export default ShippingSettingsPage;
