import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Modal from '../components/Modal';

const UIContext = createContext();

export const UIProvider = ({ children }) => {
    const [modal, setModal] = useState({
        show: false,
        title: '',
        content: '',
        type: 'info',
        onAction: null,
        actionText: 'Đồng ý',
    });
    const [toasts, setToasts] = useState([]);

    const showModal = useCallback(({ title, content, type = 'info', onAction = null, actionText = 'Đồng ý' }) => {
        setModal({
            show: true,
            title,
            content,
            type,
            onAction,
            actionText,
        });
    }, []);

    const hideModal = useCallback(() => {
        setModal((prev) => ({ ...prev, show: false }));
    }, []);

    const showToast = useCallback((args, secondArg) => {
        let message;
        let type = 'info';
        let duration = 2000;

        if (typeof args === 'object' && args !== null && !React.isValidElement(args)) {
            message = args.message;
            type = args.type || 'info';
            duration = args.duration || 2000;
        } else {
            message = args;
            type = secondArg || 'info';
        }

        const id = Date.now();
        setToasts([{ id, message, type }]);

        setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, duration);
    }, []);

    const value = useMemo(() => ({
        showModal,
        hideModal,
        showToast,
        showNotification: showToast,
    }), [showModal, hideModal, showToast]);

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
                <div className="whitespace-pre-line" dangerouslySetInnerHTML={{ __html: modal.content }} />
            </Modal>

            <div className="pointer-events-none fixed right-5 top-5 z-[9999] flex flex-col gap-3">
                <AnimatePresence>
                    {toasts.map((toast) => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, x: 50, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 20, scale: 0.95 }}
                            className={`pointer-events-auto flex min-w-[300px] items-start gap-4 rounded-sm border-l-4 bg-white p-4 shadow-premium-lg ${
                                toast.type === 'success'
                                    ? 'border-green-500'
                                    : toast.type === 'error'
                                        ? 'border-brick'
                                        : toast.type === 'warning'
                                            ? 'border-gold'
                                            : 'border-primary'
                            }`}
                        >
                            <span
                                className={`material-symbols-outlined ${
                                    toast.type === 'success'
                                        ? 'text-green-500'
                                        : toast.type === 'error'
                                            ? 'text-brick'
                                            : toast.type === 'warning'
                                                ? 'text-gold'
                                                : 'text-primary'
                                }`}
                            >
                                {toast.type === 'success'
                                    ? 'check_circle'
                                    : toast.type === 'error'
                                        ? 'error'
                                        : toast.type === 'warning'
                                            ? 'warning'
                                            : 'info'}
                            </span>
                            <div className="flex-1">
                                <div className="text-[13px] font-bold leading-tight text-primary">{toast.message}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
                                className="text-stone/30 transition-colors hover:text-primary"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
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
