import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import Modal from '../components/Modal';

const UIContext = createContext();

export const UIProvider = ({ children }) => {
    const [modal, setModal] = useState({
        show: false,
        title: '',
        content: '',
        type: 'info', // success, error, warning, info
        onAction: null,
        actionText: 'Đồng ý'
    });

    const showModal = useCallback(({ title, content, type = 'info', onAction = null, actionText = 'Đồng ý' }) => {
        setModal({
            show: true,
            title,
            content,
            type,
            onAction,
            actionText
        });
    }, []);

    const hideModal = useCallback(() => {
        setModal(prev => ({ ...prev, show: false }));
    }, []);

    const value = useMemo(() => ({
        showModal,
        hideModal
    }), [showModal, hideModal]);

    return (
        <UIContext.Provider value={value}>
            {children}
            <Modal
                show={modal.show}
                onClose={hideModal}
                title={modal.title}
                type={modal.type}
                actionText={modal.actionText}
                onAction={modal.onAction}
            >
                <div
                    className="whitespace-pre-line"
                    dangerouslySetInnerHTML={{ __html: modal.content }}
                />
            </Modal>
        </UIContext.Provider>
    );
};

export const useUI = () => {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};
