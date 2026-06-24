import React, { useEffect, useMemo, useState } from 'react';
import { financeApi, userApi } from '../../services/api';

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const emptyCenterForm = {
    id: null,
    name: '',
    code: '',
    channel: 'shared',
    manager_user_id: '',
    description: '',
    is_active: true,
    sort_order: 0,
};

const createEmptyMappingRow = () => ({
    platform: 'facebook',
    external_account_id: '',
    external_account_name: '',
    profit_center_id: '',
    effective_from: todayInputDate(),
    effective_to: '',
    allocation_percent: 100,
    is_active: true,
});

const PLATFORM_OPTIONS = [
    { value: 'facebook', label: 'Facebook' },
    { value: 'google', label: 'Google' },
];

const platformLabel = (value) => PLATFORM_OPTIONS.find((item) => item.value === value)?.label || value || '-';
const adAccountKey = (account) => `${account.platform || 'facebook'}:${account.external_account_id || ''}`;

const ProfitCenterManager = () => {
    const [profitCenters, setProfitCenters] = useState([]);
    const [adMappings, setAdMappings] = useState([]);
    const [availableAdAccounts, setAvailableAdAccounts] = useState([]);
    const [users, setUsers] = useState([]);
    const [centerForm, setCenterForm] = useState(emptyCenterForm);
    const [mappingDraft, setMappingDraft] = useState(createEmptyMappingRow());
    const [quickAssignment, setQuickAssignment] = useState({
        platform: 'facebook',
        profit_center_id: '',
        effective_from: todayInputDate(),
        selected_keys: [],
        search: '',
    });
    const [loading, setLoading] = useState(true);
    const [savingCenter, setSavingCenter] = useState(false);
    const [savingMappings, setSavingMappings] = useState(false);
    const [error, setError] = useState('');

    const activeCenters = useMemo(
        () => profitCenters.filter((center) => center.is_active),
        [profitCenters]
    );

    const filteredAvailableAdAccounts = useMemo(() => {
        const search = quickAssignment.search.trim().toLowerCase();

        return availableAdAccounts
            .filter((account) => (account.platform || 'facebook') === quickAssignment.platform)
            .filter((account) => {
                if (!search) return true;

                return [
                    account.external_account_id,
                    account.external_account_name,
                ].some((value) => String(value || '').toLowerCase().includes(search));
            });
    }, [availableAdAccounts, quickAssignment.platform, quickAssignment.search]);

    const selectedQuickAccounts = useMemo(
        () => availableAdAccounts.filter((account) => quickAssignment.selected_keys.includes(adAccountKey(account))),
        [availableAdAccounts, quickAssignment.selected_keys]
    );

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const [centerResponse, usersResponse] = await Promise.all([
                financeApi.getProfitCenters(),
                userApi.getAll().catch(() => ({ data: [] })),
            ]);

            setProfitCenters(centerResponse?.data?.profit_centers || []);
            setAdMappings(centerResponse?.data?.ad_account_mappings || []);
            setAvailableAdAccounts(centerResponse?.data?.available_ad_accounts || []);
            setUsers(Array.isArray(usersResponse?.data) ? usersResponse.data : []);
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Không thể tải cấu hình nhóm quản lý lãi lỗ.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const resetCenterForm = () => setCenterForm(emptyCenterForm);

    const submitCenter = async (event) => {
        event.preventDefault();
        if (savingCenter) return;

        setSavingCenter(true);
        setError('');
        try {
            const payload = {
                ...centerForm,
                channel: 'shared',
                manager_user_id: Number(centerForm.manager_user_id) || null,
                sort_order: Number(centerForm.sort_order) || 0,
                is_active: Boolean(centerForm.is_active),
            };

            if (centerForm.id) {
                await financeApi.updateProfitCenter(centerForm.id, payload);
            } else {
                await financeApi.createProfitCenter(payload);
            }

            resetCenterForm();
            await loadData();
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Không thể lưu nhóm quản lý lãi lỗ.');
        } finally {
            setSavingCenter(false);
        }
    };

    const editCenter = (center) => {
        setCenterForm({
            id: center.id,
            name: center.name || '',
            code: center.code || '',
            channel: 'shared',
            manager_user_id: center.manager_user_id || '',
            description: center.description || '',
            is_active: Boolean(center.is_active),
            sort_order: Number(center.sort_order || 0),
        });
    };

    const deleteCenter = async (center) => {
        if (!window.confirm(`Xóa nhóm ${center.name}?`)) return;

        try {
            await financeApi.deleteProfitCenter(center.id);
            await loadData();
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Không thể xóa nhóm quản lý lãi lỗ.');
        }
    };

    const updateMapping = (index, field, value) => {
        setAdMappings((current) => current.map((row, rowIndex) => (
            rowIndex === index ? { ...row, [field]: value } : row
        )));
    };

    const toggleQuickAccount = (account) => {
        const key = adAccountKey(account);
        setQuickAssignment((current) => ({
            ...current,
            selected_keys: current.selected_keys.includes(key)
                ? current.selected_keys.filter((item) => item !== key)
                : [...current.selected_keys, key],
        }));
    };

    const addQuickMappings = () => {
        if (!quickAssignment.profit_center_id) {
            setError('Chọn nhóm quản lý trước khi gán nhanh tài khoản quảng cáo.');
            return;
        }

        if (!quickAssignment.effective_from) {
            setError('Chọn ngày bắt đầu hiệu lực trước khi gán nhanh.');
            return;
        }

        if (selectedQuickAccounts.length === 0) {
            setError('Tick ít nhất một tài khoản quảng cáo để gán nhanh.');
            return;
        }

        if (quickAssignment.selected_keys.length < 0 && !mappingDraft.effective_from) {
            setError('Chọn ngày bắt đầu hiệu lực trước khi thêm mapping.');
            return;
        }

        setError('');
        setAdMappings((current) => {
            const existingKeys = new Set(current.map((row) => [
                row.platform || 'facebook',
                String(row.external_account_id || '').replace(/\D+/g, '') || String(row.external_account_id || ''),
                row.effective_from || '',
            ].join(':')));

            const nextRows = selectedQuickAccounts
                .map((account) => ({
                    platform: account.platform || quickAssignment.platform,
                    external_account_id: account.external_account_id || '',
                    external_account_name: account.external_account_name || '',
                    profit_center_id: quickAssignment.profit_center_id,
                    effective_from: quickAssignment.effective_from,
                    effective_to: '',
                    allocation_percent: 100,
                    is_active: true,
                }))
                .filter((row) => {
                    const key = [
                        row.platform || 'facebook',
                        String(row.external_account_id || '').replace(/\D+/g, '') || String(row.external_account_id || ''),
                        row.effective_from || '',
                    ].join(':');

                    if (existingKeys.has(key)) return false;
                    existingKeys.add(key);
                    return true;
                });

            return [...current, ...nextRows];
        });

        setQuickAssignment((current) => ({ ...current, selected_keys: [] }));
    };

    const addMappingDraft = () => {
        if (!String(mappingDraft.external_account_id || '').trim()) {
            setError('Nhập ID tài khoản quảng cáo trước khi thêm.');
            return;
        }

        if (!mappingDraft.effective_from) {
            setError('Chọn ngày bắt đầu hiệu lực trước khi thêm mapping.');
            return;
        }

        setError('');
        setAdMappings((current) => [...current, { ...mappingDraft }]);
        setMappingDraft(createEmptyMappingRow());
    };

    const removeMapping = (index) => {
        setAdMappings((current) => current.filter((_, rowIndex) => rowIndex !== index));
    };

    const saveMappings = async () => {
        setSavingMappings(true);
        setError('');
        try {
            const rows = adMappings
                .filter((row) => String(row.external_account_id || '').trim())
                .map((row) => ({
                    id: row.id,
                    platform: row.platform || 'facebook',
                    external_account_id: String(row.external_account_id || '').trim(),
                    external_account_name: String(row.external_account_name || '').trim(),
                    profit_center_id: Number(row.profit_center_id) || null,
                    effective_from: row.effective_from || '1900-01-01',
                    effective_to: row.effective_to || null,
                    allocation_percent: Number(row.allocation_percent) || 100,
                    is_active: Boolean(row.is_active),
                }));

            const response = await financeApi.saveAdAccountProfitCenterMappings(rows);
            setAdMappings(response?.data?.ad_account_mappings || rows);
            await loadData();
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Không thể lưu mapping tài khoản quảng cáo.');
        } finally {
            setSavingMappings(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div>
                    <h1 className="text-xl font-bold text-gray-800">Người quản lý lãi lỗ</h1>
                    <p className="mt-1 text-[12px] font-medium text-gray-400">Quản lý nhóm phụ trách và tài khoản quảng cáo theo từng người quản lý.</p>
                </div>
                <button
                    type="button"
                    onClick={loadData}
                    disabled={loading}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-gray-800 px-3 text-[13px] font-bold text-white transition hover:bg-gray-900 disabled:opacity-60"
                >
                    <span className={`material-symbols-outlined text-[17px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                    Làm mới
                </button>
            </div>

            {error ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
                    {error}
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="text-[15px] font-black uppercase tracking-wide text-gray-700">Danh sách nhóm quản lý</h2>
                        <button
                            type="button"
                            onClick={resetCenterForm}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50"
                            title="Tạo nhóm mới"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                    </div>

                    <form onSubmit={submitCenter} className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-2">
                        <label className="space-y-1">
                            <span className="text-[11px] font-bold uppercase text-gray-400">Tên nhóm</span>
                            <input
                                required
                                value={centerForm.name}
                                onChange={(event) => setCenterForm((current) => ({ ...current, name: event.target.value }))}
                                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none focus:border-emerald-400"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-[11px] font-bold uppercase text-gray-400">Mã</span>
                            <input
                                value={centerForm.code}
                                onChange={(event) => setCenterForm((current) => ({ ...current, code: event.target.value }))}
                                placeholder="Tự sinh nếu bỏ trống"
                                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none focus:border-emerald-400"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-[11px] font-bold uppercase text-gray-400">Người quản lý</span>
                            <select
                                value={centerForm.manager_user_id || ''}
                                onChange={(event) => setCenterForm((current) => ({ ...current, manager_user_id: event.target.value }))}
                                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none focus:border-emerald-400"
                            >
                                <option value="">Chưa gắn</option>
                                {users.map((item) => (
                                    <option key={item.id} value={item.id}>{item.name || item.email}</option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1">
                            <span className="text-[11px] font-bold uppercase text-gray-400">Thứ tự</span>
                            <input
                                type="number"
                                value={centerForm.sort_order}
                                onChange={(event) => setCenterForm((current) => ({ ...current, sort_order: event.target.value }))}
                                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none focus:border-emerald-400"
                            />
                        </label>
                        <label className="flex items-end">
                            <span className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3">
                                <input
                                    type="checkbox"
                                    checked={Boolean(centerForm.is_active)}
                                    onChange={(event) => setCenterForm((current) => ({ ...current, is_active: event.target.checked }))}
                                    className="rounded border-gray-300 text-emerald-600"
                                />
                                <span className="text-[12px] font-bold uppercase text-gray-500">Đang dùng</span>
                            </span>
                        </label>
                        <label className="space-y-1 md:col-span-2">
                            <span className="text-[11px] font-bold uppercase text-gray-400">Ghi chú</span>
                            <textarea
                                value={centerForm.description}
                                onChange={(event) => setCenterForm((current) => ({ ...current, description: event.target.value }))}
                                rows={2}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 outline-none focus:border-emerald-400"
                            />
                        </label>
                        <div className="flex justify-end gap-2 md:col-span-2">
                            <button type="button" onClick={resetCenterForm} className="rounded-lg px-3 py-2 text-[12px] font-bold uppercase text-gray-400 hover:bg-white">Bỏ chọn</button>
                            <button type="submit" disabled={savingCenter} className="rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-bold uppercase text-white hover:bg-emerald-700 disabled:opacity-60">
                                {savingCenter ? 'Đang lưu...' : centerForm.id ? 'Cập nhật nhóm' : 'Tạo nhóm'}
                            </button>
                        </div>
                    </form>

                    <div className="space-y-2">
                        {profitCenters.map((center) => (
                            <div key={center.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-[14px] font-bold text-gray-800">{center.name}</span>
                                        {!center.is_active ? <span className="rounded-md bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">Tắt</span> : null}
                                    </div>
                                    <div className="mt-1 text-[12px] font-medium text-gray-400">
                                        {center.manager_name ? `QL: ${center.manager_name}` : 'Chưa gắn quản lý'}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <button type="button" onClick={() => editCenter(center)} className="inline-flex size-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-700" title="Sửa">
                                        <span className="material-symbols-outlined text-[18px]">edit</span>
                                    </button>
                                    <button type="button" onClick={() => deleteCenter(center)} className="inline-flex size-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="Xóa">
                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!loading && profitCenters.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-[13px] font-medium text-gray-400">Chưa có nhóm quản lý lãi lỗ.</div>
                        ) : null}
                    </div>
                </section>

                <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-[15px] font-black uppercase tracking-wide text-gray-700">Tài khoản quảng cáo theo người quản lý</h2>
                            <p className="mt-1 text-[12px] font-medium text-gray-400">Nhập ID account đang đồng bộ trong cấu hình Facebook/Google Ads.</p>
                        </div>
                        <button
                            type="button"
                            onClick={saveMappings}
                            disabled={savingMappings}
                            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gray-800 px-3 text-[13px] font-bold text-white transition hover:bg-gray-900 disabled:opacity-60"
                        >
                            <span className="material-symbols-outlined text-[17px]">save</span>
                            {savingMappings ? 'Đang lưu...' : 'Lưu mapping'}
                        </button>
                    </div>


                    <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h3 className="text-[13px] font-black uppercase tracking-wide text-emerald-800">Gán nhanh từ tài khoản đã kết nối</h3>
                                <p className="mt-1 text-[12px] font-medium text-emerald-700/70">Tick nhiều tài khoản, chọn mảng và ngày bắt đầu hiệu lực.</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-emerald-700 shadow-sm">
                                Đã chọn {selectedQuickAccounts.length} TK
                            </span>
                        </div>
                        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[120px_minmax(0,1fr)_180px_160px_auto]">
                            <select
                                value={quickAssignment.platform}
                                onChange={(event) => setQuickAssignment((current) => ({ ...current, platform: event.target.value, selected_keys: [] }))}
                                className="h-10 rounded-lg border border-emerald-100 bg-white px-2 text-[13px] font-medium text-gray-700 outline-none"
                            >
                                {PLATFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <input
                                value={quickAssignment.search}
                                onChange={(event) => setQuickAssignment((current) => ({ ...current, search: event.target.value }))}
                                placeholder="Tìm theo ID hoặc tên tài khoản"
                                className="h-10 rounded-lg border border-emerald-100 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none"
                            />
                            <select
                                value={quickAssignment.profit_center_id || ''}
                                onChange={(event) => setQuickAssignment((current) => ({ ...current, profit_center_id: event.target.value }))}
                                className="h-10 rounded-lg border border-emerald-100 bg-white px-2 text-[13px] font-medium text-gray-700 outline-none"
                            >
                                <option value="">Chọn mảng</option>
                                {activeCenters.map((center) => <option key={center.id} value={center.id}>{center.manager_name ? `${center.manager_name} - ${center.name}` : center.name}</option>)}
                            </select>
                            <input
                                type="date"
                                value={quickAssignment.effective_from}
                                onChange={(event) => setQuickAssignment((current) => ({ ...current, effective_from: event.target.value }))}
                                className="h-10 rounded-lg border border-emerald-100 bg-white px-2 text-[13px] font-medium text-gray-700 outline-none"
                            />
                            <button type="button" onClick={addQuickMappings} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-[13px] font-bold text-white hover:bg-emerald-700">
                                <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                                Thêm mốc
                            </button>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-emerald-100 bg-white">
                            {filteredAvailableAdAccounts.map((account) => {
                                const key = adAccountKey(account);
                                const checked = quickAssignment.selected_keys.includes(key);
                                return (
                                    <label key={key} className={`flex cursor-pointer items-center gap-3 border-b border-gray-50 px-3 py-2 text-[13px] last:border-b-0 ${checked ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleQuickAccount(account)}
                                            className="rounded border-gray-300 text-emerald-600"
                                        />
                                        <span className="min-w-[88px] rounded-md bg-gray-100 px-2 py-1 text-center text-[11px] font-black uppercase text-gray-600">{platformLabel(account.platform)}</span>
                                        <span className="font-mono font-bold text-gray-700">{account.external_account_id}</span>
                                        <span className="min-w-0 flex-1 truncate text-gray-500">{account.external_account_name || 'Chưa có tên gợi nhớ'}</span>
                                        {account.is_mapped ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">Đã có lịch sử</span> : null}
                                    </label>
                                );
                            })}
                            {!loading && filteredAvailableAdAccounts.length === 0 ? (
                                <div className="px-4 py-6 text-center text-[13px] font-medium text-gray-400">Chưa có tài khoản phù hợp. Có thể nhập tay bên dưới.</div>
                            ) : null}
                        </div>
                    </div>

                    <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_180px_150px_auto]">
                        <select
                            value={mappingDraft.platform}
                            onChange={(event) => setMappingDraft((current) => ({ ...current, platform: event.target.value }))}
                            className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-[13px] font-medium text-gray-700 outline-none"
                        >
                            {PLATFORM_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <input
                            value={mappingDraft.external_account_id}
                            onChange={(event) => setMappingDraft((current) => ({ ...current, external_account_id: event.target.value }))}
                            placeholder="ID tài khoản quảng cáo"
                            className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none"
                        />
                        <input
                            value={mappingDraft.external_account_name}
                            onChange={(event) => setMappingDraft((current) => ({ ...current, external_account_name: event.target.value }))}
                            placeholder="Tên gợi nhớ"
                            className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 outline-none"
                        />
                        <select
                            value={mappingDraft.profit_center_id || ''}
                            onChange={(event) => setMappingDraft((current) => ({ ...current, profit_center_id: event.target.value }))}
                            className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-[13px] font-medium text-gray-700 outline-none"
                        >
                            <option value="">Chưa gắn</option>
                            {activeCenters.map((center) => (
                                <option key={center.id} value={center.id}>{center.manager_name ? `${center.manager_name} - ${center.name}` : center.name}</option>
                            ))}
                        </select>
                        <input
                            type="date"
                            value={mappingDraft.effective_from || ''}
                            onChange={(event) => setMappingDraft((current) => ({ ...current, effective_from: event.target.value }))}
                            className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-[13px] font-medium text-gray-700 outline-none"
                        />
                        <button type="button" onClick={addMappingDraft} className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-3 text-white hover:bg-emerald-700">
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-gray-100">
                        <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
                            <thead className="bg-gray-50 text-[11px] font-black uppercase tracking-wide text-gray-400">
                                <tr>
                                    <th className="px-3 py-3">Nền tảng</th>
                                    <th className="px-3 py-3">Account ID</th>
                                    <th className="px-3 py-3">Tên</th>
                                    <th className="px-3 py-3">Nhóm quản lý</th>
                                    <th className="px-3 py-3">Từ ngày</th>
                                    <th className="px-3 py-3">Đến ngày</th>
                                    <th className="px-3 py-3 text-center">Hoạt động</th>
                                    <th className="px-3 py-3 text-right">#</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {adMappings.map((row, index) => (
                                    <tr key={row.id || `${row.platform}-${row.external_account_id}-${index}`}>
                                        <td className="px-3 py-2">
                                            <select value={row.platform || 'facebook'} onChange={(event) => updateMapping(index, 'platform', event.target.value)} className="h-9 w-full rounded-lg border border-gray-200 px-2">
                                                {PLATFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{platformLabel(option.value)}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <input value={row.external_account_id || ''} onChange={(event) => updateMapping(index, 'external_account_id', event.target.value)} className="h-9 w-full rounded-lg border border-gray-200 px-2 font-mono" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input value={row.external_account_name || ''} onChange={(event) => updateMapping(index, 'external_account_name', event.target.value)} className="h-9 w-full rounded-lg border border-gray-200 px-2" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <select value={row.profit_center_id || ''} onChange={(event) => updateMapping(index, 'profit_center_id', event.target.value)} className="h-9 w-full rounded-lg border border-gray-200 px-2">
                                                <option value="">Chưa gắn</option>
                                                {activeCenters.map((center) => <option key={center.id} value={center.id}>{center.manager_name ? `${center.manager_name} - ${center.name}` : center.name}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="date" value={row.effective_from || '1900-01-01'} onChange={(event) => updateMapping(index, 'effective_from', event.target.value)} className="h-9 w-full rounded-lg border border-gray-200 px-2" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <input type="date" value={row.effective_to || ''} onChange={(event) => updateMapping(index, 'effective_to', event.target.value)} className="h-9 w-full rounded-lg border border-gray-200 px-2" />
                                                {row.is_current ? <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-600">Đang áp dụng</span> : null}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <input type="checkbox" checked={Boolean(row.is_active)} onChange={(event) => updateMapping(index, 'is_active', event.target.checked)} className="rounded border-gray-300 text-emerald-600" />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button type="button" onClick={() => removeMapping(index)} className="inline-flex size-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600">
                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {!loading && adMappings.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-10 text-center text-[13px] font-medium text-gray-400">
                                            Chưa có tài khoản quảng cáo nào được gắn nhóm quản lý.
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default ProfitCenterManager;
