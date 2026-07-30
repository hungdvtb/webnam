import React from 'react';
import { accountApi } from '../services/api';
import { flushUserSettingsSync } from '../services/userSettingsSync';
import {
    dispatchActiveAccountChanged,
    readActiveAccountId,
} from '../utils/activeAccount';

const parseCachedAccounts = (value) => {
    if (!value) {
        return [];
    }

    try {
        const parsedValue = JSON.parse(value);
        return Array.isArray(parsedValue) ? parsedValue : [];
    } catch (error) {
        console.warn('Cannot parse cached accounts list.', error);
        return [];
    }
};

const persistActiveSiteCode = (accounts, accountId) => {
    const selectedAccount = accounts.find((account) => String(account.id) === String(accountId));
    const siteCode = String(selectedAccount?.site_code || '').trim();

    if (siteCode) {
        localStorage.setItem('activeSiteCode', siteCode);
        return;
    }

    localStorage.removeItem('activeSiteCode');
};

const AccountSelector = ({ reloadOnAutoSelect = true }) => {
    const [accounts, setAccounts] = React.useState([]);
    const [activeId, setActiveId] = React.useState(() => readActiveAccountId() || 'all');

    const commitActiveAccount = React.useCallback(async (nextId, shouldReload = false, accountList = []) => {
        const normalizedId = String(nextId || '').trim();
        if (!normalizedId) {
            return;
        }

        persistActiveSiteCode(accountList, normalizedId);
        localStorage.setItem('activeAccountId', normalizedId);
        setActiveId(normalizedId);
        dispatchActiveAccountChanged(normalizedId);

        if (shouldReload) {
            await flushUserSettingsSync();
            window.location.reload();
        }
    }, []);

    React.useEffect(() => {
        const cachedAccounts = sessionStorage.getItem('accounts_list');
        if (cachedAccounts) {
            const parsedAccounts = parseCachedAccounts(cachedAccounts);
            setAccounts(parsedAccounts);
            if ((activeId === 'all' || !activeId) && parsedAccounts.length > 0) {
                const firstId = String(parsedAccounts[0].id || '').trim();
                void commitActiveAccount(firstId, reloadOnAutoSelect && activeId === 'all', parsedAccounts);
            } else {
                persistActiveSiteCode(parsedAccounts, activeId);
            }
        } else {
            accountApi.getAll().then(res => {
                sessionStorage.setItem('accounts_list', JSON.stringify(res.data));
                setAccounts(res.data);
                if ((activeId === 'all' || !activeId) && res.data.length > 0) {
                    const firstId = String(res.data[0].id || '').trim();
                    void commitActiveAccount(firstId, reloadOnAutoSelect && activeId === 'all', res.data);
                } else {
                    persistActiveSiteCode(res.data, activeId);
                }
            }).catch(console.error);
        }
    }, [activeId, commitActiveAccount, reloadOnAutoSelect]);

    const handleAccountChange = async (e) => {
        const newId = e.target.value;
        await commitActiveAccount(newId, true, accounts);
    };

    return (
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-gold/30 rounded-sm shadow-sm relative group hover:border-gold transition-colors">
            <span className="material-symbols-outlined text-[18px] text-primary group-hover:text-gold transition-colors">store</span>
            <select
                value={activeId}
                onChange={handleAccountChange}
                className="bg-transparent text-sm font-body font-bold text-primary focus:outline-none pr-6 max-w-[250px] truncate cursor-pointer appearance-none"
            >
                {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gold/50 flex">
                <span className="material-symbols-outlined text-xs">expand_more</span>
            </div>
        </div>
    );
};

export default AccountSelector;
