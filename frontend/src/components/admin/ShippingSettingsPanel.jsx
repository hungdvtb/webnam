import React, { useEffect, useMemo, useState } from 'react';
import { shippingApi } from '../../services/api';
import CarrierMappingSettings from '../../pages/admin/CarrierMappingSettings';

const inputClasses = 'w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20';
const labelClasses = 'text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block';
const SHIPPING_SOUND_STORAGE_KEY = 'shipping_notification_settings_v1';

const defaultSoundSettings = {
    enabled: true,
    useDefaultSound: true,
    customAudioDataUrl: '',
    customAudioName: '',
};

const SectionCard = ({ title, icon, children, rightSlot = null }) => (
    <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
        <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
                <h2 className="text-[13px] font-black text-primary uppercase">{title}</h2>
            </div>
            {rightSlot}
        </div>
        <div className="p-6">{children}</div>
    </div>
);

const beep = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
};

const ShippingSettingsPanel = ({ initialTab = 'integrations', onTabChange }) => {
    const [activeTab, setActiveTab] = useState(initialTab);
    const [settings, setSettings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCarrierCode, setSelectedCarrierCode] = useState('viettel_post');
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState(null);
    const [soundSettings, setSoundSettings] = useState(() => {
        const saved = localStorage.getItem(SHIPPING_SOUND_STORAGE_KEY);
        return saved ? JSON.parse(saved) : defaultSoundSettings;
    });

    useEffect(() => {
        onTabChange?.(activeTab);
    }, [activeTab, onTabChange]);

    useEffect(() => {
        setActiveTab((current) => (current === initialTab ? current : initialTab));
    }, [initialTab]);

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const response = await shippingApi.getSettings();
                const carriers = response.data?.carriers || [];
                setSettings(carriers);
                const active = carriers.find((item) => item.carrier_code === selectedCarrierCode) || carriers[0];
                if (active) {
                    setSelectedCarrierCode(active.carrier_code);
                    setForm({
                        ...active.integration,
                        username: active.integration?.username || '',
                        password: '',
                    });
                }
            } catch (error) {
                setMessage({ type: 'error', text: error.response?.data?.message || 'Không thể tải cài đặt vận chuyển.' });
            } finally {
                setLoading(false);
            }
        };

        fetchSettings();
    }, []);

    useEffect(() => {
        localStorage.setItem(SHIPPING_SOUND_STORAGE_KEY, JSON.stringify(soundSettings));
    }, [soundSettings]);

    const selectedCarrier = useMemo(
        () => settings.find((item) => item.carrier_code === selectedCarrierCode) || null,
        [settings, selectedCarrierCode]
    );

    useEffect(() => {
        if (!selectedCarrier) return;
        setForm({
            ...selectedCarrier.integration,
            username: selectedCarrier.integration?.username || '',
            password: '',
        });
    }, [selectedCarrier]);

    const tabs = [
        { id: 'integrations', label: 'Kết nối đơn vị vận chuyển', icon: 'lan' },
        { id: 'mapping', label: 'Mapping đơn vị vận chuyển', icon: 'sync_alt' },
        { id: 'notifications', label: 'Thông báo vận chuyển', icon: 'notifications_active' },
    ];

    const handleInputChange = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        if (!selectedCarrier) return;
        setSaving(true);
        setMessage(null);
        try {
            const payload = {
                ...form,
                is_enabled: !!form.is_enabled,
            };
            await shippingApi.updateIntegration(selectedCarrier.carrier_code, payload);
            const response = await shippingApi.getSettings();
            setSettings(response.data?.carriers || []);
            setMessage({ type: 'success', text: 'Đã lưu cấu hình vận chuyển.' });
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Không thể lưu cấu hình vận chuyển.' });
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!selectedCarrier) return;
        setTesting(true);
        setMessage(null);
        try {
            const response = await shippingApi.testIntegration(selectedCarrier.carrier_code);
            setMessage({ type: 'success', text: response.data?.message || 'Kiểm tra kết nối thành công.' });
            const refreshed = await shippingApi.getSettings();
            setSettings(refreshed.data?.carriers || []);
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Kiểm tra kết nối thất bại.' });
        } finally {
            setTesting(false);
        }
    };

    const handleAudioFile = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            setSoundSettings((prev) => ({
                ...prev,
                useDefaultSound: false,
                customAudioDataUrl: typeof reader.result === 'string' ? reader.result : '',
                customAudioName: file.name,
            }));
        };
        reader.readAsDataURL(file);
    };

    const handlePlayTestSound = () => {
        if (!soundSettings.enabled) return;
        if (!soundSettings.useDefaultSound && soundSettings.customAudioDataUrl) {
            const audio = new Audio(soundSettings.customAudioDataUrl);
            audio.play().catch(() => {});
            return;
        }
        beep();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 flex gap-6 border-b border-primary/10">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative flex items-center gap-2 ${
                            activeTab === tab.id ? 'text-primary' : 'text-primary/40 hover:text-primary/70'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                        {tab.label}
                        {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-6 pb-6 pt-6">

            {message && (
                <div className={`rounded-sm border px-4 py-3 text-[13px] font-bold ${
                    message.type === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-green-200 bg-green-50 text-green-700'
                }`}>
                    {message.text}
                </div>
            )}

            {activeTab === 'integrations' && (
                <div className="space-y-6">
                    <SectionCard icon="local_shipping" title="Danh sách hãng vận chuyển">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                            {settings.map((carrier) => {
                                const connected = carrier.integration?.connection_status === 'connected';
                                const selected = carrier.carrier_code === selectedCarrierCode;

                                return (
                                    <button
                                        key={carrier.carrier_code}
                                        type="button"
                                        onClick={() => setSelectedCarrierCode(carrier.carrier_code)}
                                        className={`rounded-sm border p-4 text-left transition-all ${
                                            selected ? 'border-primary bg-primary/[0.03] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/30'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[13px] font-black text-primary uppercase">{carrier.carrier_name}</p>
                                                <p className="text-[11px] text-primary/50 mt-1">
                                                    {carrier.supports_api ? 'Có hỗ trợ API trong phiên bản này' : 'Placeholder cho giai đoạn sau'}
                                                </p>
                                            </div>
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-black ${
                                                connected ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'
                                            }`}>
                                                {connected ? 'Đã kết nối' : 'Chưa kết nối'}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </SectionCard>

                    {selectedCarrier && (
                        <SectionCard
                            icon="settings_ethernet"
                            title={`Cấu hình ${selectedCarrier.carrier_name}`}
                            rightSlot={
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleTest}
                                        disabled={testing || !selectedCarrier.supports_api}
                                        className="h-9 px-4 rounded-sm border border-primary/20 text-primary text-[11px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all disabled:opacity-50"
                                    >
                                        {testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        disabled={saving || !selectedCarrier.supports_api}
                                        className="h-9 px-4 rounded-sm bg-primary text-white text-[11px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50"
                                    >
                                        {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
                                    </button>
                                </div>
                            }
                        >
                            {!selectedCarrier.supports_api ? (
                                <div className="rounded-sm border border-primary/10 bg-primary/[0.02] p-4 text-[13px] font-bold text-primary/70">
                                    Hãng này đã được chuẩn bị UI và mapping, nhưng phần gửi API chưa bật trong phiên bản hiện tại. ViettelPost là hãng đã kết nối hoàn chỉnh.
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClasses}>Bật kết nối API</label>
                                            <label className="inline-flex items-center gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={!!form.is_enabled}
                                                    onChange={(e) => handleInputChange('is_enabled', e.target.checked)}
                                                    className="size-4 accent-primary"
                                                />
                                                <span className="text-[13px] font-bold text-primary">Cho phép gửi đơn và nhận webhook</span>
                                            </label>
                                        </div>
                                        <div>
                                            <label className={labelClasses}>API base URL</label>
                                            <input className={inputClasses} value={form.api_base_url || 'https://partner.viettelpost.vn'} onChange={(e) => handleInputChange('api_base_url', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Username</label>
                                            <input className={inputClasses} value={form.username || ''} onChange={(e) => handleInputChange('username', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Mật khẩu</label>
                                            <input type="password" className={inputClasses} value={form.password || ''} placeholder={selectedCarrier.integration?.has_password ? 'Để trống nếu không đổi' : ''} onChange={(e) => handleInputChange('password', e.target.value)} />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClasses}>Tên người gửi</label>
                                            <input className={inputClasses} value={form.sender_name || ''} onChange={(e) => handleInputChange('sender_name', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>SĐT người gửi</label>
                                            <input className={inputClasses} value={form.sender_phone || ''} onChange={(e) => handleInputChange('sender_phone', e.target.value)} />
                                        </div>
                                        <div className="lg:col-span-2">
                                            <label className={labelClasses}>Địa chỉ người gửi</label>
                                            <textarea className="w-full min-h-[96px] bg-white border border-primary/20 rounded-sm px-3 py-2 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all resize-none" value={form.sender_address || ''} onChange={(e) => handleInputChange('sender_address', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Tỉnh / thành người gửi</label>
                                            <input className={inputClasses} value={form.sender_province_name || ''} onChange={(e) => handleInputChange('sender_province_name', e.target.value)} placeholder="VD: Hà Nội" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Quận / huyện người gửi</label>
                                            <input className={inputClasses} value={form.sender_district_name || ''} onChange={(e) => handleInputChange('sender_district_name', e.target.value)} placeholder="VD: Gia Lâm" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Phường / xã người gửi</label>
                                            <input className={inputClasses} value={form.sender_ward_name || ''} onChange={(e) => handleInputChange('sender_ward_name', e.target.value)} placeholder="VD: Đa Tốn" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Mã dịch vụ mặc định</label>
                                            <input className={inputClasses} value={form.default_service_code || ''} onChange={(e) => handleInputChange('default_service_code', e.target.value)} placeholder="VD: VCN / VCBO" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Dịch vụ cộng thêm</label>
                                            <input className={inputClasses} value={form.default_service_add || ''} onChange={(e) => handleInputChange('default_service_add', e.target.value)} placeholder="Có thể để trống" />
                                        </div>
                                        <div className="lg:col-span-2">
                                            <label className={labelClasses}>Webhook URL</label>
                                            <input className={inputClasses} value={form.webhook_url || ''} onChange={(e) => handleInputChange('webhook_url', e.target.value)} placeholder="https://your-domain/api/shipments/carriers/viettel-post/webhook" />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </SectionCard>
                    )}
                </div>
            )}

            {activeTab === 'mapping' && (
                <div className="min-h-[720px]">
                    <CarrierMappingSettings embedded />
                </div>
            )}

            {activeTab === 'notifications' && (
                <div className="space-y-6">
                    <SectionCard icon="notifications" title="Chuông cảnh báo đơn có vấn đề vận chuyển">
                        <div className="space-y-6">
                            <div className="flex items-center gap-4">
                                <label className="inline-flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        checked={!!soundSettings.enabled}
                                        onChange={(e) => setSoundSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                                        className="size-4 accent-primary"
                                    />
                                    <span className="text-[13px] font-bold text-primary">Bật âm thanh khi có đơn lỗi mới</span>
                                </label>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div>
                                    <label className={labelClasses}>Nguồn âm thanh</label>
                                    <div className="space-y-3">
                                        <label className="flex items-center gap-3 text-[13px] font-bold text-primary">
                                            <input
                                                type="radio"
                                                checked={!!soundSettings.useDefaultSound}
                                                onChange={() => setSoundSettings((prev) => ({ ...prev, useDefaultSound: true }))}
                                                className="accent-primary"
                                            />
                                            Dùng âm mặc định của hệ thống
                                        </label>
                                        <label className="flex items-center gap-3 text-[13px] font-bold text-primary">
                                            <input
                                                type="radio"
                                                checked={!soundSettings.useDefaultSound}
                                                onChange={() => setSoundSettings((prev) => ({ ...prev, useDefaultSound: false }))}
                                                className="accent-primary"
                                            />
                                            Dùng file âm riêng
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className={labelClasses}>File âm thanh riêng</label>
                                    <div className="flex items-center gap-3">
                                        <label className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all inline-flex items-center cursor-pointer">
                                            Chọn file
                                            <input type="file" accept="audio/*" className="hidden" onChange={handleAudioFile} />
                                        </label>
                                        <span className="text-[12px] font-bold text-primary/60 truncate">
                                            {soundSettings.customAudioName || 'Chưa có file nào được chọn'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button type="button" onClick={handlePlayTestSound} className="h-10 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all">
                                    Phát thử
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSoundSettings(defaultSoundSettings)}
                                    className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all"
                                >
                                    Khôi phục mặc định
                                </button>
                            </div>
                        </div>
                    </SectionCard>
                </div>
            )}
                </div>
            </div>
        </div>
    );
};

export { SHIPPING_SOUND_STORAGE_KEY, defaultSoundSettings, beep };
export default ShippingSettingsPanel;
