export const ACTIVE_ACCOUNT_CHANGED_EVENT = 'admin:active-account-changed';

export const readActiveAccountId = () => {
    if (typeof window === 'undefined') {
        return '';
    }

    const storedValue = String(window.localStorage.getItem('activeAccountId') || '').trim();

    if (!storedValue || storedValue === 'all') {
        return '';
    }

    return storedValue;
};

export const dispatchActiveAccountChanged = (accountId) => {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent(ACTIVE_ACCOUNT_CHANGED_EVENT, {
        detail: {
            accountId: String(accountId || '').trim(),
        },
    }));
};
