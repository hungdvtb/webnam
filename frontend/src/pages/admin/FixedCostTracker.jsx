import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { financeApi } from '../../services/api';

const getCurrentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const getCurrentDate = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatDateString = (dateStr) => {
    if (!dateStr) return '';

    try {
        const dateOnly = String(dateStr).split(/[T\s]/)[0];
        const parts = dateOnly.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dateStr;
    } catch {
        return dateStr;
    }
};

const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`;
const normalizeDateValue = (value) => {
    if (!value) return '';
    const dateOnly = String(value).split(/[T\s]/)[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : '';
};
const stripLeadingZeroes = (value) => String(value || '').replace(/^0+(?=\d)/, '');
const thousandsFormattedMoneyPattern = /^\d{1,3}(\.\d{3})+$/;
const decimalMoneyPattern = /^-?\d+(\.\d+)?$/;
const normalizeStoredMoney = (value) => {
    if (value === '' || value === null || typeof value === 'undefined') {
        return '';
    }

    if (typeof value === 'number') {
        return String(Math.round(value));
    }

    const textValue = String(value).trim();
    if (!textValue) {
        return '';
    }

    if (!thousandsFormattedMoneyPattern.test(textValue) && decimalMoneyPattern.test(textValue)) {
        const numericValue = Number(textValue);
        if (Number.isFinite(numericValue)) {
            return String(Math.round(numericValue));
        }
    }

    const integerText = textValue.includes(',') ? textValue.split(',')[0] : textValue;
    return stripLeadingZeroes(integerText.replace(/\D/g, ''));
};
const normalizeMoneyDraft = (value) => {
    let textValue = String(value || '').trim();

    if (textValue.includes(',')) {
        textValue = textValue.split(',')[0];
    } else if (!thousandsFormattedMoneyPattern.test(textValue) && /^\d+\.\d{1,2}$/.test(textValue)) {
        textValue = textValue.split('.')[0];
    }

    return stripLeadingZeroes(textValue.replace(/\D/g, ''));
};
const formatMoneyInput = (value) => {
    const normalizedValue = normalizeStoredMoney(value);
    return normalizedValue
        ? normalizedValue.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
        : '';
};
const normalizeCategoryName = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeComparisonKey = (value) => normalizeCategoryName(value).toLocaleLowerCase('vi-VN');
const resolveAppliedDateValue = (row, fallbackDate = '') => normalizeDateValue(row?.applied_from) || fallbackDate;

const createNewRow = (overrides = {}) => ({
    id: null,
    uid: Math.random().toString(36).slice(2, 11),
    category: '',
    name: '',
    amount: '',
    notes: '',
    applied_from: '',
    ...overrides,
});

const sortCategories = (items = []) => [...items].sort((left, right) => {
    const sortDiff = Number(left?.sort_order || 0) - Number(right?.sort_order || 0);
    if (sortDiff !== 0) {
        return sortDiff;
    }

    return String(left?.name || '').localeCompare(String(right?.name || ''), 'vi');
});

const resolveErrorMessage = (error, fallbackMessage) => (
    error?.response?.data?.message || error?.message || fallbackMessage
);

function CategoryManagerModal({
    open,
    categories,
    draftUsageMap,
    newCategoryName,
    onNewCategoryNameChange,
    onCreateCategory,
    editingCategoryId,
    editingCategoryName,
    onEditingCategoryNameChange,
    onStartEditCategory,
    onCancelEditCategory,
    onSaveCategory,
    onDeleteCategory,
    busyKey,
    onClose,
}) {
    if (!open) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b bg-gray-50 px-5 py-4">
                    <div>
                        <h3 className="text-[16px] font-semibold text-gray-900">Quản lí danh mục chi phí</h3>
                        <p className="mt-1 text-[12px] text-gray-500">Thêm, sửa và xóa danh mục dùng cho ô Danh mục trong bảng chi phí cố định.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="border-b bg-white px-5 py-4">
                    <div className="flex flex-col gap-3 md:flex-row">
                        <input
                            type="text"
                            value={newCategoryName}
                            onChange={(event) => onNewCategoryNameChange(event.target.value)}
                            placeholder="Nhập tên danh mục mới"
                            className="h-10 flex-1 rounded border border-gray-300 px-3 text-[13px] text-gray-800 outline-none transition-colors focus:border-[#b68f54] focus:ring-1 focus:ring-[#b68f54]"
                        />
                        <button
                            type="button"
                            onClick={onCreateCategory}
                            disabled={busyKey === 'create'}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[#b68f54] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#a07c45] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {busyKey === 'create' ? (
                                <>
                                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-white" />
                                    Đang thêm...
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                    Thêm danh mục
                                </>
                            )}
                        </button>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                        Danh mục đang được dùng trong dữ liệu hoặc đang được chọn trên bảng hiện tại sẽ không thể xóa.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto bg-[#fcfcfd] px-5 py-4">
                    {categories.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-[13px] text-gray-500">
                            Chưa có danh mục nào.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {categories.map((category) => {
                                const isEditing = editingCategoryId === category.id;
                                const persistedUsage = Number(category.usage_count || 0);
                                const currentDraftUsage = Number(draftUsageMap[normalizeCategoryName(category.name)] || 0);
                                const draftOnlyUsage = Math.max(currentDraftUsage - persistedUsage, 0);
                                const isDeleteBlocked = persistedUsage > 0 || currentDraftUsage > 0;
                                const editBusyKey = `edit-${category.id}`;
                                const deleteBusyKey = `delete-${category.id}`;

                                return (
                                    <div key={category.id} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <div className="min-w-0 flex-1">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={editingCategoryName}
                                                        onChange={(event) => onEditingCategoryNameChange(event.target.value)}
                                                        className="h-9 w-full rounded border border-gray-300 px-3 text-[13px] text-gray-800 outline-none transition-colors focus:border-[#b68f54] focus:ring-1 focus:ring-[#b68f54]"
                                                        placeholder="Tên danh mục"
                                                    />
                                                ) : (
                                                    <p className="truncate text-[14px] font-medium text-gray-900">{category.name}</p>
                                                )}

                                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600">
                                                        Đang dùng trong dữ liệu: {persistedUsage}
                                                    </span>
                                                    {draftOnlyUsage > 0 && (
                                                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                                                            Đang chọn trên bảng: {draftOnlyUsage}
                                                        </span>
                                                    )}
                                                    {!isDeleteBlocked && (
                                                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                                                            Có thể xóa
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-2">
                                                {isEditing ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={onCancelEditCategory}
                                                            disabled={busyKey === editBusyKey}
                                                            className="inline-flex h-9 items-center justify-center rounded border border-gray-200 px-3 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            Hủy
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => onSaveCategory(category)}
                                                            disabled={busyKey === editBusyKey}
                                                            className="inline-flex h-9 items-center justify-center gap-2 rounded bg-[#b68f54] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#a07c45] disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            {busyKey === editBusyKey ? (
                                                                <>
                                                                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-white" />
                                                                    Đang lưu...
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span className="material-symbols-outlined text-[15px]">save</span>
                                                                    Lưu
                                                                </>
                                                            )}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => onStartEditCategory(category)}
                                                            disabled={busyKey === deleteBusyKey}
                                                            className="inline-flex h-9 items-center justify-center gap-1 rounded border border-gray-200 px-3 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            <span className="material-symbols-outlined text-[15px]">edit</span>
                                                            Sửa
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => onDeleteCategory(category)}
                                                            disabled={busyKey === deleteBusyKey || isDeleteBlocked}
                                                            title={isDeleteBlocked ? 'Danh mục đang được dùng nên không thể xóa.' : 'Xóa danh mục'}
                                                            className="inline-flex h-9 items-center justify-center gap-1 rounded border border-red-200 px-3 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                                                        >
                                                            {busyKey === deleteBusyKey ? (
                                                                <>
                                                                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-current" />
                                                                    Đang xóa...
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span className="material-symbols-outlined text-[15px]">delete</span>
                                                                    Xóa
                                                                </>
                                                            )}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function FixedCostTracker() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
    const [costs, setCosts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [snapshots, setSnapshots] = useState([]);
    const [totalMonthly, setTotalMonthly] = useState(0);
    const [currentDailyRate, setCurrentDailyRate] = useState(0);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [applyDialogOpen, setApplyDialogOpen] = useState(false);
    const [applyDate, setApplyDate] = useState(getCurrentDate());
    const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [categoryBusyKey, setCategoryBusyKey] = useState('');

    const syncCategories = useCallback((nextCategories) => {
        setCategories(sortCategories(nextCategories));
    }, []);

    const fetchCosts = useCallback(async () => {
        setLoading(true);

        try {
            const response = await financeApi.getFixedCostTracker({ month: selectedMonth });
            if (response.data?.status !== 'success') {
                throw new Error('Không thể tải dữ liệu chi phí cố định.');
            }

            const data = response.data.data || {};
            const fetchedCosts = Array.isArray(data.fixed_costs) ? data.fixed_costs : [];

            setCosts(fetchedCosts.length > 0
                ? fetchedCosts.map((item) => ({
                    ...item,
                    amount: normalizeStoredMoney(item.amount),
                    applied_from: normalizeDateValue(item.applied_from),
                }))
                : [createNewRow({ applied_from: `${selectedMonth}-01` })]);
            syncCategories(Array.isArray(data.categories) ? data.categories : []);
            setTotalMonthly(Number(data.total_monthly) || 0);
            setCurrentDailyRate(Number(data.current_daily_rate) || 0);
            setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
        } catch (error) {
            alert(resolveErrorMessage(error, 'Lỗi tải dữ liệu chi phí cố định.'));
        } finally {
            setLoading(false);
        }
    }, [selectedMonth, syncCategories]);

    useEffect(() => {
        fetchCosts();
    }, [fetchCosts]);

    const categoryOptions = useMemo(() => categories.map((category) => category.name), [categories]);
    const defaultAppliedFrom = useMemo(() => {
        const firstSnapshot = snapshots.find((snapshot) => normalizeDateValue(snapshot?.date));
        return normalizeDateValue(firstSnapshot?.date) || `${selectedMonth}-01`;
    }, [selectedMonth, snapshots]);

    const draftCategoryUsageMap = useMemo(() => (
        costs.reduce((accumulator, row) => {
            const key = normalizeCategoryName(row.category);
            if (!key) {
                return accumulator;
            }

            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
        }, {})
    ), [costs]);

    const calculateCurrentTotal = useMemo(() => (
        costs.reduce((sum, item) => sum + (Number(normalizeStoredMoney(item.amount)) || 0), 0)
    ), [costs]);

    const replaceCategoryNameInCosts = useCallback((oldName, newName) => {
        const oldKey = normalizeComparisonKey(oldName);
        const normalizedNewName = normalizeCategoryName(newName);

        setCosts((prevCosts) => prevCosts.map((row) => (
            normalizeComparisonKey(row.category) === oldKey
                ? { ...row, category: normalizedNewName }
                : row
        )));
    }, []);

    const resetCategoryEditor = useCallback(() => {
        setEditingCategoryId(null);
        setEditingCategoryName('');
    }, []);

    const handleAddRow = () => {
        setCosts((prevCosts) => [...prevCosts, createNewRow({ applied_from: defaultAppliedFrom })]);
    };

    const handleRemoveRow = (index) => {
        setCosts((prevCosts) => {
            const nextCosts = [...prevCosts];
            nextCosts.splice(index, 1);
            return nextCosts.length > 0 ? nextCosts : [createNewRow({ applied_from: defaultAppliedFrom })];
        });
    };

    const handleChange = (index, field, value) => {
        setCosts((prevCosts) => prevCosts.map((row, rowIndex) => (
            rowIndex === index ? { ...row, [field]: value } : row
        )));
    };

    const handleCreateCategory = async () => {
        const normalizedName = normalizeCategoryName(newCategoryName);
        if (!normalizedName) {
            alert('Vui lòng nhập tên danh mục.');
            return;
        }

        const duplicatedCategory = categories.some((category) => (
            normalizeComparisonKey(category.name) === normalizeComparisonKey(normalizedName)
        ));

        if (duplicatedCategory) {
            alert('Danh mục này đã tồn tại.');
            return;
        }

        setCategoryBusyKey('create');

        try {
            const response = await financeApi.createFixedCostCategory({ name: normalizedName });
            const createdCategory = response.data?.data?.category;

            if (!createdCategory) {
                throw new Error('Không nhận được dữ liệu danh mục mới.');
            }

            syncCategories([...categories, createdCategory]);
            setNewCategoryName('');
        } catch (error) {
            alert(resolveErrorMessage(error, 'Không thể thêm danh mục.'));
        } finally {
            setCategoryBusyKey('');
        }
    };

    const handleStartEditCategory = (category) => {
        setEditingCategoryId(category.id);
        setEditingCategoryName(category.name);
    };

    const handleSaveCategory = async (category) => {
        const normalizedName = normalizeCategoryName(editingCategoryName);
        if (!normalizedName) {
            alert('Tên danh mục không được để trống.');
            return;
        }

        const duplicatedCategory = categories.some((item) => (
            item.id !== category.id
            && normalizeComparisonKey(item.name) === normalizeComparisonKey(normalizedName)
        ));

        if (duplicatedCategory) {
            alert('Danh mục này đã tồn tại.');
            return;
        }

        const busyKey = `edit-${category.id}`;
        setCategoryBusyKey(busyKey);

        try {
            const response = await financeApi.updateFixedCostCategory(category.id, { name: normalizedName });
            const updatedCategory = response.data?.data?.category;
            const oldName = response.data?.data?.old_name || category.name;

            if (!updatedCategory) {
                throw new Error('Không nhận được dữ liệu danh mục sau khi cập nhật.');
            }

            syncCategories(categories.map((item) => (
                item.id === updatedCategory.id ? updatedCategory : item
            )));
            replaceCategoryNameInCosts(oldName, updatedCategory.name);
            resetCategoryEditor();
        } catch (error) {
            alert(resolveErrorMessage(error, 'Không thể cập nhật danh mục.'));
        } finally {
            setCategoryBusyKey('');
        }
    };

    const handleDeleteCategory = async (category) => {
        const currentDraftUsage = Number(draftCategoryUsageMap[normalizeCategoryName(category.name)] || 0);
        const persistedUsage = Number(category.usage_count || 0);

        if (persistedUsage > 0) {
            alert(`Không thể xóa danh mục "${category.name}" vì đang có ${persistedUsage} khoản chi phí sử dụng danh mục này.`);
            return;
        }

        if (currentDraftUsage > 0) {
            alert(`Không thể xóa danh mục "${category.name}" vì đang được chọn trên bảng hiện tại. Hãy đổi sang danh mục khác trước khi xóa.`);
            return;
        }

        if (!window.confirm(`Bạn có chắc muốn xóa danh mục "${category.name}"?`)) {
            return;
        }

        const busyKey = `delete-${category.id}`;
        setCategoryBusyKey(busyKey);

        try {
            await financeApi.deleteFixedCostCategory(category.id);
            syncCategories(categories.filter((item) => item.id !== category.id));

            if (editingCategoryId === category.id) {
                resetCategoryEditor();
            }
        } catch (error) {
            alert(resolveErrorMessage(error, 'Không thể xóa danh mục.'));
        } finally {
            setCategoryBusyKey('');
        }
    };

    const handleApplyChanges = async () => {
        const hasIncompleteRow = costs.some((item) => {
            const hasAnyValue = Boolean(
                normalizeCategoryName(item.category)
                || normalizeCategoryName(item.name)
                || item.amount !== ''
                || normalizeCategoryName(item.notes)
            );

            const hasRequiredValue = Boolean(
                normalizeCategoryName(item.name)
                && item.amount !== ''
                && item.amount !== null
                && typeof item.amount !== 'undefined'
            );

            return hasAnyValue && !hasRequiredValue;
        });

        if (hasIncompleteRow) {
            alert('Vui lòng nhập đầy đủ tên chi phí và số tiền trước khi lưu.');
            return;
        }

        const validCosts = costs
            .filter((item) => (
                normalizeCategoryName(item.name)
                && item.amount !== ''
                && item.amount !== null
                && typeof item.amount !== 'undefined'
            ))
            .map((item) => ({
                id: item.id,
                category: normalizeCategoryName(item.category),
                name: normalizeCategoryName(item.name),
                amount: Number(normalizeStoredMoney(item.amount)) || 0,
                notes: String(item.notes || '').trim(),
                applied_from: resolveAppliedDateValue(item, defaultAppliedFrom),
            }));

        setSaving(true);

        try {
            const response = await financeApi.applyFixedCosts({
                apply_date: applyDate,
                fixed_costs: validCosts,
            });

            if (response.data?.status !== 'success') {
                throw new Error(response.data?.message || 'Có lỗi xảy ra khi lưu chi phí.');
            }

            alert('Áp dụng thay đổi thành công!');
            setApplyDialogOpen(false);
            await fetchCosts();
        } catch (error) {
            alert(resolveErrorMessage(error, 'Lỗi khi lưu dữ liệu.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] p-4 font-sans md:p-6">
            <div className="mb-4 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <h1 className="text-[18px] font-semibold text-gray-800 md:text-[20px]">
                    Quản lý Chi phí Cố định
                </h1>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                <div className="flex flex-1 items-center gap-6">
                    <div className="flex flex-col">
                        <span className="text-[12px] font-medium uppercase tracking-wider text-gray-500">Tổng chi phí tháng</span>
                        <span className="text-[15px] font-bold text-gray-900">{formatCurrency(totalMonthly)}</span>
                    </div>
                    <div className="h-8 w-px bg-gray-200" />
                    <div className="flex flex-col">
                        <span className="text-[12px] font-medium uppercase tracking-wider text-gray-500">Mức chi phí ngày</span>
                        <span className="text-[15px] font-bold text-[#b68f54]">
                            {formatCurrency(currentDailyRate)}
                            <span className="text-[12px] font-normal text-gray-500">/ngày</span>
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <input
                        type="month"
                        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-[13px] focus:border-[#b68f54] focus:outline-none focus:ring-1 focus:ring-[#b68f54]"
                        value={selectedMonth}
                        onChange={(event) => setSelectedMonth(event.target.value)}
                    />
                    <button
                        type="button"
                        onClick={() => setHistoryOpen(true)}
                        className="whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                        <span className="material-symbols-outlined mr-1 align-middle text-[16px]">history</span>
                        Lịch sử định mức
                    </button>
                </div>
            </div>

            <div className="flex items-center justify-between rounded-t-lg border-x border-t border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={handleAddRow}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Thêm chi phí mới
                    </button>
                    <button
                        type="button"
                        onClick={() => setCategoryDialogOpen(true)}
                        className="inline-flex items-center gap-1 rounded border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                        <span className="material-symbols-outlined text-[16px]">category</span>
                        Quản lí danh mục
                    </button>
                </div>

                <div className="flex items-center gap-4">
                    <span className="text-[13px] text-gray-500">
                        Tạm tính: <strong className="text-gray-900">{formatCurrency(calculateCurrentTotal)}</strong>
                    </span>
                    <button
                        type="button"
                        onClick={() => setApplyDialogOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-sm bg-[#b68f54] px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-[#a07c45]"
                    >
                        <span className="material-symbols-outlined text-[16px]">save</span>
                        Áp dụng thay đổi
                    </button>
                </div>
            </div>

            <div className="relative overflow-hidden rounded-b-lg border border-gray-200 bg-white shadow-sm">
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
                        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    </div>
                )}

                <div className="relative max-h-[600px] overflow-x-auto overflow-y-auto">
                    <table className="min-w-[980px] w-full border-collapse text-left">
                        <thead className="sticky top-0 z-20 border-b border-gray-200 bg-[#f4f6f8] shadow-sm">
                            <tr>
                                <th className="w-1/4 border-r border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700">Danh mục</th>
                                <th className="w-1/4 border-r border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700">Tên chi phí</th>
                                <th className="w-1/5 border-r border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700">Số tiền (VNĐ/tháng)</th>
                                <th className="border-r border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700">Ghi chú</th>
                                <th className="w-40 border-r border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700">Thời gian áp dụng</th>
                                <th className="w-12 px-4 py-2.5 text-center text-[13px] font-semibold text-gray-700" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {costs.map((row, index) => (
                                <tr key={row.id || row.uid} className="group transition-colors hover:bg-gray-50">
                                    <td className="border-r border-gray-100 p-0">
                                        <input
                                            type="text"
                                            list="fixed-cost-category-options"
                                            className="w-full bg-transparent px-4 py-2.5 text-[13px] transition-colors focus:bg-primary/5 focus:outline-none"
                                            placeholder="VD: Mặt bằng"
                                            value={row.category || ''}
                                            onChange={(event) => handleChange(index, 'category', event.target.value)}
                                        />
                                    </td>
                                    <td className="border-r border-gray-100 p-0">
                                        <input
                                            type="text"
                                            className="w-full bg-transparent px-4 py-2.5 text-[13px] font-medium transition-colors focus:bg-primary/5 focus:outline-none"
                                            placeholder="Tên khoản chi..."
                                            value={row.name || ''}
                                            onChange={(event) => handleChange(index, 'name', event.target.value)}
                                        />
                                    </td>
                                    <td className="border-r border-gray-100 p-0">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            className="w-full bg-transparent px-4 py-2.5 text-[13px] transition-colors focus:bg-primary/5 focus:outline-none"
                                            placeholder="0"
                                            value={formatMoneyInput(row.amount)}
                                            onChange={(event) => handleChange(index, 'amount', normalizeMoneyDraft(event.target.value))}
                                        />
                                    </td>
                                    <td className="border-r border-gray-100 p-0">
                                        <input
                                            type="text"
                                            className="w-full bg-transparent px-4 py-2.5 text-[13px] text-gray-600 transition-colors focus:bg-primary/5 focus:outline-none"
                                            placeholder="Ghi chú thêm..."
                                            value={row.notes || ''}
                                            onChange={(event) => handleChange(index, 'notes', event.target.value)}
                                        />
                                    </td>
                                    <td className="border-r border-gray-100 p-0">
                                        <input
                                            type="date"
                                            className="w-full bg-transparent px-4 py-2.5 text-[13px] text-gray-700 transition-colors focus:bg-primary/5 focus:outline-none"
                                            value={resolveAppliedDateValue(row, defaultAppliedFrom)}
                                            onChange={(event) => handleChange(index, 'applied_from', event.target.value)}
                                        />
                                    </td>
                                    <td className="flex h-full items-center justify-center p-2 text-center">
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveRow(index)}
                                            className="rounded p-1 text-red-500 opacity-0 transition-all hover:bg-red-50 hover:text-red-700 group-hover:opacity-100"
                                            title="Xóa dòng"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <datalist id="fixed-cost-category-options">
                    {categoryOptions.map((option) => (
                        <option key={option} value={option} />
                    ))}
                </datalist>
            </div>

            {historyOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
                    onClick={() => setHistoryOpen(false)}
                >
                    <div
                        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
                            <h3 className="text-[15px] font-semibold text-gray-900">Lịch sử định mức hàng ngày</h3>
                            <button
                                type="button"
                                onClick={() => setHistoryOpen(false)}
                                className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>
                        <div className="relative flex-1 overflow-y-auto">
                            <table className="w-full border-collapse text-left">
                                <thead className="sticky top-0 border-b bg-[#f8f9fa] shadow-sm">
                                    <tr>
                                        <th className="w-1/2 px-5 py-2.5 text-[13px] font-semibold text-gray-600">Ngày áp dụng</th>
                                        <th className="px-5 py-2.5 text-right text-[13px] font-semibold text-gray-600">Chi phí định mức</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshots.length === 0 ? (
                                        <tr>
                                            <td colSpan="2" className="px-4 py-8 text-center text-[13px] italic text-gray-500">
                                                Chưa có dữ liệu snapshots trong khoảng thời gian này.
                                            </td>
                                        </tr>
                                    ) : (
                                        snapshots.map((snapshot) => (
                                            <tr key={snapshot.id} className="border-b transition-colors last:border-0 hover:bg-gray-50">
                                                <td className="border-r border-gray-100 px-5 py-2.5 text-[13px] text-gray-700">
                                                    {formatDateString(snapshot.date)}
                                                </td>
                                                <td className="px-5 py-2.5 text-right text-[13px] font-medium text-gray-900">
                                                    {formatCurrency(snapshot.amount)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {applyDialogOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
                    onClick={() => !saving && setApplyDialogOpen(false)}
                >
                    <div
                        className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="border-b bg-gray-50 px-5 py-3">
                            <h3 className="text-[15px] font-semibold text-gray-900">Xác nhận thay đổi chi phí</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-5 text-[13px]">
                            <p className="mb-5 leading-relaxed text-gray-600">
                                Tổng chi phí hàng tháng mới sẽ là <strong className="text-[14px] text-gray-900">{formatCurrency(calculateCurrentTotal)}</strong>.
                                <br />
                                <br />
                                Hệ thống sẽ chia phần này cho số ngày trong tháng để áp dụng vào báo cáo lãi lỗ hàng ngày.
                            </p>

                            <div className="mb-4 rounded border border-blue-100 bg-blue-50 p-3">
                                <label className="mb-2 block font-semibold text-gray-800">
                                    Thực hiện ghi đè định mức từ ngày:
                                </label>
                                <input
                                    type="date"
                                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-[13px] shadow-sm transition-shadow focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    value={applyDate}
                                    onChange={(event) => setApplyDate(event.target.value)}
                                />
                            </div>

                            <p className="flex gap-2 rounded border border-orange-100/70 bg-orange-50/70 p-2.5 text-[12px] text-orange-600">
                                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px]">info</span>
                                <span>
                                    Định mức mới sẽ bắt đầu áp dụng từ ngày bạn chọn. Lịch sử của những ngày trước đó sẽ không bị ảnh hưởng.
                                </span>
                            </p>
                        </div>
                        <div className="flex justify-end gap-3 border-t bg-gray-50 px-5 py-3">
                            <button
                                type="button"
                                onClick={() => !saving && setApplyDialogOpen(false)}
                                disabled={saving}
                                className="rounded border border-gray-200 px-4 py-1.5 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyChanges}
                                disabled={saving}
                                className="flex min-w-[132px] items-center justify-center gap-2 rounded bg-[#b68f54] px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-[#a07c45] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {saving ? (
                                    <>
                                        <span className="h-3 w-3 animate-spin rounded-full border-b-[2px] border-white" />
                                        Đang lưu...
                                    </>
                                ) : (
                                    'Xác nhận áp dụng'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <CategoryManagerModal
                open={categoryDialogOpen}
                categories={categories}
                draftUsageMap={draftCategoryUsageMap}
                newCategoryName={newCategoryName}
                onNewCategoryNameChange={setNewCategoryName}
                onCreateCategory={handleCreateCategory}
                editingCategoryId={editingCategoryId}
                editingCategoryName={editingCategoryName}
                onEditingCategoryNameChange={setEditingCategoryName}
                onStartEditCategory={handleStartEditCategory}
                onCancelEditCategory={resetCategoryEditor}
                onSaveCategory={handleSaveCategory}
                onDeleteCategory={handleDeleteCategory}
                busyKey={categoryBusyKey}
                onClose={() => {
                    if (!categoryBusyKey) {
                        resetCategoryEditor();
                        setNewCategoryName('');
                        setCategoryDialogOpen(false);
                    }
                }}
            />
        </div>
    );
}
