import React from 'react';
import { accountApi } from '../services/api';

const AccountSelector = ({ user }) => {
    const [accounts, setAccounts] = React.useState([]);
    const [activeId, setActiveId] = React.useState(localStorage.getItem('activeAccountId') || 'all');

    React.useEffect(() => {
        const cachedAccounts = sessionStorage.getItem('accounts_list');
        if (cachedAccounts) {
            const parsedAccounts = JSON.parse(cachedAccounts);
            setAccounts(parsedAccounts);
            if ((activeId === 'all' || !activeId) && parsedAccounts.length > 0) {
                const firstId = parsedAccounts[0].id;
                localStorage.setItem('activeAccountId', firstId);
                setActiveId(firstId);
                if (activeId === 'all') window.location.reload();
            }
        } else {
            accountApi.getAll().then(res => {
                sessionStorage.setItem('accounts_list', JSON.stringify(res.data));
                setAccounts(res.data);
                if ((activeId === 'all' || !activeId) && res.data.length > 0) {
                    const firstId = res.data[0].id;
                    localStorage.setItem('activeAccountId', firstId);
                    setActiveId(firstId);
                    if (activeId === 'all') window.location.reload();
                }
            }).catch(console.error);
        }
    }, [activeId]);

    const handleAccountChange = (e) => {
        const newId = e.target.value;
        localStorage.setItem('activeAccountId', newId);
        setActiveId(newId);
        window.location.reload();
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
