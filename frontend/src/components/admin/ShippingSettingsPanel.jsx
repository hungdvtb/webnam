import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { shippingApi, warehouseApi } from '../../services/api';
import CarrierMappingSettings from '../../pages/admin/CarrierMappingSettings';

const inputClasses = 'w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20';
const textareaClasses = 'w-full min-h-[96px] bg-white border border-primary/20 rounded-sm px-3 py-2 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all resize-none';
const labelClasses = 'text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block';
const SHIPPING_SOUND_STORAGE_KEY = 'shipping_notification_settings_v1';

const defaultSoundSettings = {
    enabled: true,
    useDefaultSound: true,
    customAudioDataUrl: '',
    customAudioName: '',
};

const defaultWarehouseForm = {
    name: '',
    code: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    province_name: '',
    district_name: '',
    ward_name: '',
    is_active: true,
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

const WarehouseEditorModal = ({ open, editingWarehouse, form, saving, onChange, onClose, onSubmit }) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-primary/45 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-3xl rounded-sm bg-white shadow-2xl border border-primary/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-primary/10 bg-primary/[0.03] flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/40">Kho gui van chuyen</p>
                        <h3 className="text-[18px] font-black text-primary mt-1">
                            {editingWarehouse ? 'Cap nhat kho gui' : 'Tao kho gui moi'}
                        </h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-primary/30 hover:text-primary">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <form onSubmit={onSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div>
                            <label className={labelClasses}>Ten kho</label>
                            <input className={inputClasses} value={form.name} onChange={(e) => onChange('name', e.target.value)} required />
                        </div>
                        <div>
                            <label className={labelClasses}>Ma kho</label>
                            <input className={inputClasses} value={form.code} onChange={(e) => onChange('code', e.target.value)} required disabled={!!editingWarehouse} />
                        </div>
                        <div>
                            <label className={labelClasses}>Nguoi phu trach</label>
                            <input className={inputClasses} value={form.contact_name} onChange={(e) => onChange('contact_name', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClasses}>SDT kho</label>
                            <input className={inputClasses} value={form.phone} onChange={(e) => onChange('phone', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClasses}>Email</label>
                            <input className={inputClasses} value={form.email} onChange={(e) => onChange('email', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClasses}>Tinh / thanh</label>
                            <input className={inputClasses} value={form.province_name} onChange={(e) => onChange('province_name', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClasses}>Quan / huyen</label>
                            <input className={inputClasses} value={form.district_name} onChange={(e) => onChange('district_name', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClasses}>Phuong / xa</label>
                            <input className={inputClasses} value={form.ward_name} onChange={(e) => onChange('ward_name', e.target.value)} />
                        </div>
                        <div className="lg:col-span-2">
                            <label className={labelClasses}>Dia chi chi tiet</label>
                            <textarea className={textareaClasses} value={form.address} onChange={(e) => onChange('address', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClasses}>Ten thanh pho noi bo</label>
                            <input className={inputClasses} value={form.city} onChange={(e) => onChange('city', e.target.value)} />
                        </div>
                        <div className="flex items-end">
                            <label className="inline-flex items-center gap-3 h-10">
                                <input type="checkbox" checked={!!form.is_active} onChange={(e) => onChange('is_active', e.target.checked)} className="size-4 accent-primary" />
                                <span className="text-[13px] font-bold text-primary">Kho dang hoat dong</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-primary/10 pt-5">
                        <button type="button" onClick={onClose} className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wide hover:bg-primary/5">
                            Huy
                        </button>
                        <button type="submit" disabled={saving} className="h-10 px-5 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wide hover:bg-primary/90 disabled:opacity-50">
                            {saving ? 'Dang luu...' : editingWarehouse ? 'Cap nhat kho' : 'Tao kho'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const WarehouseCard = ({ warehouse, isDefault, onChooseDefault, onEdit, onDelete }) => (
    <div className={`rounded-sm border p-4 transition-all ${isDefault ? 'border-primary bg-primary/[0.04] shadow-sm' : 'border-primary/10 bg-white'}`}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13px] font-black text-primary truncate">{warehouse.name}</p>
                    <span className="px-2 py-1 rounded-full bg-primary/[0.06] text-primary text-[10px] font-black">{warehouse.code}</span>
                    {isDefault && <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-[10px] font-black">Mac dinh</span>}
                    {!warehouse.is_active && <span className="px-2 py-1 rounded-full bg-stone-100 text-stone-500 text-[10px] font-black">Tam ngung</span>}
                </div>
                <div className="mt-3 space-y-1 text-[12px] text-primary/60 font-bold">
                    <p>{warehouse.contact_name || 'Chua co nguoi phu trach'}{warehouse.phone ? ` • ${warehouse.phone}` : ''}</p>
                    <p className="line-clamp-2">{warehouse.address || 'Chua cap nhat dia chi chi tiet'}</p>
                    <p>{[warehouse.ward_name, warehouse.district_name, warehouse.province_name].filter(Boolean).join(', ') || 'Chua du tinh / huyen / xa'}</p>
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => onChooseDefault(warehouse.id)} className="size-9 rounded-sm border border-primary/20 text-primary hover:bg-primary/5 flex items-center justify-center" title="Dat lam kho mac dinh">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                </button>
                <button type="button" onClick={() => onEdit(warehouse)} className="size-9 rounded-sm border border-primary/20 text-primary hover:bg-primary/5 flex items-center justify-center" title="Sua kho">
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
                <button type="button" onClick={() => onDelete(warehouse)} className="size-9 rounded-sm border border-red-200 text-red-600 hover:bg-red-50 flex items-center justify-center" title="Xoa kho">
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
            </div>
        </div>
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

const getCarrierConnectionMeta = (carrier) => {
    const status = carrier.integration?.connection_status;
    const hasApiKey = !!carrier.integration?.has_api_key;
    const isEnabled = !!carrier.integration?.is_enabled;

    if (status === 'connected') {
        return {
            label: 'Da ket noi',
            className: 'bg-green-100 text-green-700',
        };
    }

    if (isEnabled && hasApiKey) {
        return {
            label: 'Da cau hinh',
            className: 'bg-amber-100 text-amber-700',
        };
    }

    return {
        label: 'Chua ket noi',
        className: 'bg-stone-100 text-stone-500',
    };
};

const renderTabContent = ({
    activeTab,
    settings,
    selectedCarrier,
    selectedCarrierCode,
    setSelectedCarrierCode,
    form,
    handleInputChange,
    warehouses,
    defaultWarehouse,
    handleTest,
    testing,
    handleSave,
    saving,
    openCreateWarehouse,
    openEditWarehouse,
    handleDeleteWarehouse,
    soundSettings,
    setSoundSettings,
    handleAudioFile,
    handlePlayTestSound,
}) => {
    if (activeTab === 'integrations') {
        return (
            <div className="space-y-6">
                <SectionCard icon="local_shipping" title="Danh sach hang van chuyen">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        {settings.map((carrier) => {
                            const connectionMeta = getCarrierConnectionMeta(carrier);
                            const selected = carrier.carrier_code === selectedCarrierCode;

                            return (
                                <button
                                    key={carrier.carrier_code}
                                    type="button"
                                    onClick={() => setSelectedCarrierCode(carrier.carrier_code)}
                                    className={`rounded-sm border p-4 text-left transition-all ${selected ? 'border-primary bg-primary/[0.03] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/30'}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[13px] font-black text-primary uppercase">{carrier.carrier_name}</p>
                                            <p className="text-[11px] text-primary/50 mt-1">
                                                {carrier.supports_api ? 'Co ho tro API trong phien ban nay' : 'Placeholder cho giai doan sau'}
                                            </p>
                                        </div>
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-black ${connectionMeta.className}`}>
                                            {connectionMeta.label}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>

                {selectedCarrier && (
                    <>
                        <SectionCard
                            icon="settings_ethernet"
                            title={`Cau hinh ${selectedCarrier.carrier_name}`}
                            rightSlot={
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={handleTest} disabled={testing || !selectedCarrier.supports_api} className="h-9 px-4 rounded-sm border border-primary/20 text-primary text-[11px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all disabled:opacity-50">
                                        {testing ? 'Dang kiem tra...' : 'Kiem tra ket noi'}
                                    </button>
                                    <button type="button" onClick={handleSave} disabled={saving || !selectedCarrier.supports_api} className="h-9 px-4 rounded-sm bg-primary text-white text-[11px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50">
                                        {saving ? 'Dang luu...' : 'Luu cau hinh'}
                                    </button>
                                </div>
                            }
                        >
                            {!selectedCarrier.supports_api ? (
                                <div className="rounded-sm border border-primary/10 bg-primary/[0.02] p-4 text-[13px] font-bold text-primary/70">
                                    Hang nay da duoc chuan bi UI va mapping, nhung phan gui API chua bat trong phien ban hien tai. ViettelPost la hang da ket noi hoan chinh.
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClasses}>Bat ket noi API</label>
                                            <label className="inline-flex items-center gap-3">
                                                <input type="checkbox" checked={!!form.is_enabled} onChange={(e) => handleInputChange('is_enabled', e.target.checked)} className="size-4 accent-primary" />
                                                <span className="text-[13px] font-bold text-primary">Cho phep gui don va nhan webhook</span>
                                            </label>
                                        </div>
                                        <div>
                                            <label className={labelClasses}>API base URL</label>
                                            <input className={inputClasses} value={form.api_base_url || 'https://partner.viettelpost.vn'} onChange={(e) => handleInputChange('api_base_url', e.target.value)} />
                                        </div>
                                        <div className="lg:col-span-2">
                                            <label className={labelClasses}>Che do xac thuc</label>
                                            <div className="flex flex-wrap items-center gap-5">
                                                <label className="inline-flex items-center gap-2 text-[13px] font-bold text-primary">
                                                    <input type="radio" checked={(form.auth_mode || 'api_key') === 'api_key'} onChange={() => handleInputChange('auth_mode', 'api_key')} className="accent-primary" />
                                                    API key / Token
                                                </label>
                                                <label className="inline-flex items-center gap-2 text-[13px] font-bold text-primary">
                                                    <input type="radio" checked={(form.auth_mode || 'api_key') === 'credentials'} onChange={() => handleInputChange('auth_mode', 'credentials')} className="accent-primary" />
                                                    Username + Password
                                                </label>
                                            </div>
                                        </div>
                                        <div className="lg:col-span-2">
                                            {(form.auth_mode || 'api_key') === 'api_key' ? (
                                                <>
                                                    <label className={labelClasses}>Token tao don / Client token</label>
                                                    <input className={inputClasses} value={form.api_key || ''} placeholder={selectedCarrier.integration?.has_api_key ? 'De trong neu khong doi client token hien tai' : 'Dan client token ViettelPost vao day'} onChange={(e) => handleInputChange('api_key', e.target.value)} />
                                                    <div className="mt-2 space-y-2">
                                                        <p className="text-[12px] font-bold text-primary/55">He thong se dung truc tiep token tao don cua tai khoan client ViettelPost ban cung cap de tinh phi va tao van don.</p>
                                                        {selectedCarrier.integration?.has_api_key && !form.api_key && (
                                                            <div className="inline-flex max-w-full items-center gap-2 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-[12px] font-bold text-green-700">
                                                                <span className="material-symbols-outlined text-[16px]">verified</span>
                                                                <span className="break-words">Client token hien tai da duoc luu an toan. De trong neu ban khong muon thay token.</span>
                                                            </div>
                                                        )}
                                                        <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-700">
                                                            Khong dung token partner tong quat. ViettelPost yeu cau token tao don cua tai khoan client cho cac API getPriceAll va createOrderNlp.
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                    <div>
                                                        <label className={labelClasses}>Username ViettelPost</label>
                                                        <input className={inputClasses} value={form.username || ''} placeholder="So dien thoai / username doi tac" onChange={(e) => handleInputChange('username', e.target.value)} />
                                                    </div>
                                                    <div>
                                                        <label className={labelClasses}>Password ViettelPost</label>
                                                        <input type="password" className={inputClasses} value={form.password || ''} placeholder={selectedCarrier.integration?.has_password ? 'De trong neu khong doi mat khau hien tai' : 'Nhap password ViettelPost'} onChange={(e) => handleInputChange('password', e.target.value)} />
                                                        <div className="mt-2 space-y-2">
                                                            <p className="text-[12px] font-bold text-primary/55">He thong se dang nhap Login va ownerconnect de lay token dai han tu dong.</p>
                                                            {selectedCarrier.integration?.has_password && !form.password && (
                                                                <div className="inline-flex max-w-full items-center gap-2 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-[12px] font-bold text-green-700">
                                                                    <span className="material-symbols-outlined text-[16px]">verified</span>
                                                                    <span className="break-words">Mat khau hien tai da duoc luu an toan. De trong neu ban khong muon thay mat khau.</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Ma dich vu mac dinh</label>
                                            <input className={inputClasses} value={form.default_service_code || ''} onChange={(e) => handleInputChange('default_service_code', e.target.value)} placeholder="VD: VCN / VCBO" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Dich vu cong them</label>
                                            <input className={inputClasses} value={form.default_service_add || ''} onChange={(e) => handleInputChange('default_service_add', e.target.value)} placeholder="Co the de trong" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Kho mac dinh khi gui don</label>
                                            <select className={inputClasses} value={form.default_warehouse_id || ''} onChange={(e) => handleInputChange('default_warehouse_id', e.target.value)}>
                                                <option value="">Chua chon kho mac dinh</option>
                                                {warehouses.map((warehouse) => (
                                                    <option key={warehouse.id} value={warehouse.id}>
                                                        {warehouse.name}{warehouse.is_active ? '' : ' (Tam ngung)'}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="lg:col-span-2">
                                            <label className={labelClasses}>Webhook URL</label>
                                            <input className={inputClasses} value={form.webhook_url || ''} onChange={(e) => handleInputChange('webhook_url', e.target.value)} placeholder="https://your-domain/api/shipments/carriers/viettel-post/webhook" />
                                        </div>
                                    </div>

                                    <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] px-4 py-4">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Kho dang duoc chon mac dinh</p>
                                        {defaultWarehouse ? (
                                            <div className="mt-3">
                                                <p className="text-[14px] font-black text-primary">{defaultWarehouse.name}</p>
                                                <p className="text-[12px] font-bold text-primary/60 mt-1">
                                                    {defaultWarehouse.contact_name || 'Chua co nguoi phu trach'}{defaultWarehouse.phone ? ` • ${defaultWarehouse.phone}` : ''}
                                                </p>
                                                <p className="text-[12px] text-primary/55 mt-1">
                                                    {defaultWarehouse.address || 'Chua co dia chi'}{defaultWarehouse.address ? ' • ' : ''}{[defaultWarehouse.ward_name, defaultWarehouse.district_name, defaultWarehouse.province_name].filter(Boolean).join(', ')}
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="mt-3 text-[13px] font-bold text-primary/45">Chua chon kho mac dinh. Khi gui don he thong se yeu cau chon kho hoac fallback cau hinh cu neu con du lieu.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </SectionCard>

                        <SectionCard
                            icon="warehouse"
                            title="Kho gui hang"
                            rightSlot={
                                <button type="button" onClick={openCreateWarehouse} className="h-9 px-4 rounded-sm bg-primary text-white text-[11px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all">
                                    Them kho
                                </button>
                            }
                        >
                            {warehouses.length === 0 ? (
                                <div className="rounded-sm border border-dashed border-primary/20 bg-primary/[0.02] px-6 py-12 text-center">
                                    <p className="text-[14px] font-black text-primary">Chua co kho gui nao</p>
                                    <p className="text-[12px] font-bold text-primary/50 mt-2">Tao kho gui de co the chon kho mac dinh va dung khi day don sang don vi van chuyen.</p>
                                    <button type="button" onClick={openCreateWarehouse} className="mt-4 h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wide hover:bg-primary/5">
                                        Tao kho dau tien
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                    {warehouses.map((warehouse) => (
                                        <WarehouseCard
                                            key={warehouse.id}
                                            warehouse={warehouse}
                                            isDefault={String(form.default_warehouse_id || '') === String(warehouse.id)}
                                            onChooseDefault={handleInputChange.bind(null, 'default_warehouse_id')}
                                            onEdit={openEditWarehouse}
                                            onDelete={handleDeleteWarehouse}
                                        />
                                    ))}
                                </div>
                            )}
                        </SectionCard>
                    </>
                )}
            </div>
        );
    }

    if (activeTab === 'mapping') {
        return (
            <div className="min-h-[720px]">
                <CarrierMappingSettings embedded />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SectionCard icon="notifications" title="Chuong canh bao don co van de van chuyen">
                <div className="space-y-6">
                    <div className="flex items-center gap-4">
                        <label className="inline-flex items-center gap-3">
                            <input type="checkbox" checked={!!soundSettings.enabled} onChange={(e) => setSoundSettings((prev) => ({ ...prev, enabled: e.target.checked }))} className="size-4 accent-primary" />
                            <span className="text-[13px] font-bold text-primary">Bat am thanh khi co don loi moi</span>
                        </label>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div>
                            <label className={labelClasses}>Nguon am thanh</label>
                            <div className="space-y-3">
                                <label className="flex items-center gap-3 text-[13px] font-bold text-primary">
                                    <input type="radio" checked={!!soundSettings.useDefaultSound} onChange={() => setSoundSettings((prev) => ({ ...prev, useDefaultSound: true }))} className="accent-primary" />
                                    Dung am mac dinh cua he thong
                                </label>
                                <label className="flex items-center gap-3 text-[13px] font-bold text-primary">
                                    <input type="radio" checked={!soundSettings.useDefaultSound} onChange={() => setSoundSettings((prev) => ({ ...prev, useDefaultSound: false }))} className="accent-primary" />
                                    Dung file am rieng
                                </label>
                            </div>
                        </div>
                        <div>
                            <label className={labelClasses}>File am thanh rieng</label>
                            <div className="flex items-center gap-3">
                                <label className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all inline-flex items-center cursor-pointer">
                                    Chon file
                                    <input type="file" accept="audio/*" className="hidden" onChange={handleAudioFile} />
                                </label>
                                <span className="text-[12px] font-bold text-primary/60 truncate">
                                    {soundSettings.customAudioName || 'Chua co file nao duoc chon'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={handlePlayTestSound} className="h-10 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all">
                            Phat thu
                        </button>
                        <button type="button" onClick={() => setSoundSettings(defaultSoundSettings)} className="h-10 px-4 rounded-sm border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all">
                            Khoi phuc mac dinh
                        </button>
                    </div>
                </div>
            </SectionCard>
        </div>
    );
};

const ShippingSettingsPanel = ({ initialTab = 'integrations', onTabChange }) => {
    const [activeTab, setActiveTab] = useState(initialTab);
    const [settings, setSettings] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCarrierCode, setSelectedCarrierCode] = useState('viettel_post');
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState(null);
    const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
    const [warehouseSaving, setWarehouseSaving] = useState(false);
    const [editingWarehouse, setEditingWarehouse] = useState(null);
    const [warehouseForm, setWarehouseForm] = useState(defaultWarehouseForm);
    const [soundSettings, setSoundSettings] = useState(() => {
        const saved = localStorage.getItem(SHIPPING_SOUND_STORAGE_KEY);
        return saved ? JSON.parse(saved) : defaultSoundSettings;
    });

    const hydrateCarrierForm = useCallback((carrier) => {
        if (!carrier) return;
        setForm({
            ...carrier.integration,
            auth_mode: carrier.integration?.auth_mode || 'api_key',
            api_key: '',
            default_warehouse_id: carrier.integration?.default_warehouse_id || '',
        });
    }, []);

    const loadSettings = useCallback(async (nextCarrierCode = null) => {
        const response = await shippingApi.getSettings();
        const carriers = response.data?.carriers || [];
        const warehouseList = response.data?.warehouses || [];
        setSettings(carriers);
        setWarehouses(warehouseList);

        const carrierCode = nextCarrierCode || selectedCarrierCode;
        const activeCarrier = carriers.find((item) => item.carrier_code === carrierCode) || carriers[0] || null;
        if (activeCarrier) {
            setSelectedCarrierCode(activeCarrier.carrier_code);
            hydrateCarrierForm(activeCarrier);
        }
    }, [hydrateCarrierForm, selectedCarrierCode]);

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
                await loadSettings();
            } catch (error) {
                setMessage({ type: 'error', text: error.response?.data?.message || 'Khong the tai cai dat van chuyen.' });
            } finally {
                setLoading(false);
            }
        };

        fetchSettings();
    }, [loadSettings]);

    useEffect(() => {
        localStorage.setItem(SHIPPING_SOUND_STORAGE_KEY, JSON.stringify(soundSettings));
    }, [soundSettings]);

    const selectedCarrier = useMemo(
        () => settings.find((item) => item.carrier_code === selectedCarrierCode) || null,
        [settings, selectedCarrierCode]
    );

    useEffect(() => {
        if (selectedCarrier) {
            hydrateCarrierForm(selectedCarrier);
        }
    }, [selectedCarrier, hydrateCarrierForm]);

    const defaultWarehouse = useMemo(
        () => warehouses.find((warehouse) => String(warehouse.id) === String(form.default_warehouse_id || '')) || null,
        [warehouses, form.default_warehouse_id]
    );

    const tabs = [
        { id: 'integrations', label: 'Ket noi don vi van chuyen', icon: 'lan' },
        { id: 'mapping', label: 'Mapping don vi van chuyen', icon: 'sync_alt' },
        { id: 'notifications', label: 'Thong bao van chuyen', icon: 'notifications_active' },
    ];

    const handleInputChange = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        if (!selectedCarrier) return;
        setSaving(true);
        setMessage(null);
        try {
            await shippingApi.updateIntegration(selectedCarrier.carrier_code, {
                ...form,
                is_enabled: !!form.is_enabled,
                auth_mode: form.auth_mode || 'api_key',
                default_warehouse_id: form.default_warehouse_id ? Number(form.default_warehouse_id) : null,
            });
            await loadSettings(selectedCarrier.carrier_code);
            setMessage({ type: 'success', text: 'Da luu cau hinh van chuyen.' });
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Khong the luu cau hinh van chuyen.' });
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
            setMessage({ type: 'success', text: response.data?.message || 'Kiem tra ket noi thanh cong.' });
            await loadSettings(selectedCarrier.carrier_code);
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Kiem tra ket noi that bai.' });
        } finally {
            setTesting(false);
        }
    };

    const openCreateWarehouse = () => {
        setEditingWarehouse(null);
        setWarehouseForm(defaultWarehouseForm);
        setWarehouseModalOpen(true);
    };

    const openEditWarehouse = (warehouse) => {
        setEditingWarehouse(warehouse);
        setWarehouseForm({
            name: warehouse.name || '',
            code: warehouse.code || '',
            contact_name: warehouse.contact_name || '',
            phone: warehouse.phone || '',
            email: warehouse.email || '',
            address: warehouse.address || '',
            city: warehouse.city || '',
            province_name: warehouse.province_name || '',
            district_name: warehouse.district_name || '',
            ward_name: warehouse.ward_name || '',
            is_active: warehouse.is_active ?? true,
        });
        setWarehouseModalOpen(true);
    };

    const handleWarehouseFieldChange = (key, value) => {
        setWarehouseForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleWarehouseSubmit = async (event) => {
        event.preventDefault();
        setWarehouseSaving(true);
        setMessage(null);
        try {
            const payload = {
                ...warehouseForm,
                city: warehouseForm.city || warehouseForm.province_name || '',
            };
            if (editingWarehouse) {
                await warehouseApi.update(editingWarehouse.id, payload);
            } else {
                await warehouseApi.store(payload);
            }
            setWarehouseModalOpen(false);
            setEditingWarehouse(null);
            setWarehouseForm(defaultWarehouseForm);
            await loadSettings(selectedCarrierCode);
            setMessage({ type: 'success', text: editingWarehouse ? 'Da cap nhat kho gui.' : 'Da tao kho gui moi.' });
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Khong the luu kho gui.' });
        } finally {
            setWarehouseSaving(false);
        }
    };

    const handleDeleteWarehouse = async (warehouse) => {
        if (!window.confirm(`Xoa kho "${warehouse.name}"?`)) return;
        try {
            await warehouseApi.destroy(warehouse.id);
            if (String(form.default_warehouse_id || '') === String(warehouse.id)) {
                setForm((prev) => ({ ...prev, default_warehouse_id: '' }));
            }
            await loadSettings(selectedCarrierCode);
            setMessage({ type: 'success', text: 'Da xoa kho gui.' });
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Khong the xoa kho gui dang duoc su dung.' });
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
        <>
            <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 flex gap-6 border-b border-primary/10">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative flex items-center gap-2 ${activeTab === tab.id ? 'text-primary' : 'text-primary/40 hover:text-primary/70'}`}
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
                            <div className={`rounded-sm border px-4 py-3 text-[13px] font-bold ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                                {message.text}
                            </div>
                        )}
                        {renderTabContent({
                            activeTab,
                            settings,
                            selectedCarrier,
                            selectedCarrierCode,
                            setSelectedCarrierCode,
                            form,
                            handleInputChange,
                            warehouses,
                            defaultWarehouse,
                            handleTest,
                            testing,
                            handleSave,
                            saving,
                            openCreateWarehouse,
                            openEditWarehouse,
                            handleDeleteWarehouse,
                            soundSettings,
                            setSoundSettings,
                            handleAudioFile,
                            handlePlayTestSound,
                        })}
                    </div>
                </div>
            </div>

            <WarehouseEditorModal
                open={warehouseModalOpen}
                editingWarehouse={editingWarehouse}
                form={warehouseForm}
                saving={warehouseSaving}
                onChange={handleWarehouseFieldChange}
                onClose={() => {
                    setWarehouseModalOpen(false);
                    setEditingWarehouse(null);
                    setWarehouseForm(defaultWarehouseForm);
                }}
                onSubmit={handleWarehouseSubmit}
            />
        </>
    );
};

export { SHIPPING_SOUND_STORAGE_KEY, defaultSoundSettings, beep };
export default ShippingSettingsPanel;
