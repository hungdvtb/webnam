import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import Modal from '../components/Modal';
import { AnimatePresence, motion } from 'framer-motion';

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

    const [toasts, setToasts] = useState([]);

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

    const showToast = useCallback((args, secondArg) => {
        let message, type = 'info', duration = 2000;
        
        if (typeof args === 'object' && args !== null && !React.isValidElement(args)) {
            message = args.message;
            type = args.type || 'info';
            duration = args.duration || 2000;
        } else {
            message = args;
            type = secondArg || 'info';
        }

        const id = Date.now();
        // Clear previous toasts to avoid overlapping/stacking
        setToasts([{ id, message, type }]);
        
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    const value = useMemo(() => ({
        showModal,
        hideModal,
        showToast
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
                <div
                    className="whitespace-pre-line"
                    dangerouslySetInnerHTML={{ __html: modal.content }}
                />
            </Modal>

            {/* Toast Container */}
            <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, x: 50, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 20, scale: 0.95 }}
                            className={`pointer-events-auto min-w-[300px] p-4 rounded-sm shadow-premium-lg border-l-4 flex items-start gap-4 ${
                                toast.type === 'success' ? 'bg-white border-green-500' : 
                                toast.type === 'error' ? 'bg-white border-brick' :
                                toast.type === 'warning' ? 'bg-white border-gold' : 'bg-white border-primary'
                            }`}
                        >
                            <span className={`material-symbols-outlined ${
                                toast.type === 'success' ? 'text-green-500' : 
                                toast.type === 'error' ? 'text-brick' :
                                toast.type === 'warning' ? 'text-gold' : 'text-primary'
                            }`}>
                                {toast.type === 'success' ? 'check_circle' : 
                                 toast.type === 'error' ? 'error' :
                                 toast.type === 'warning' ? 'warning' : 'info'}
                            </span>
                            <div className="flex-1">
                                <div className="text-[13px] font-bold text-primary leading-tight">{toast.message}</div>
                            </div>
                            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="text-stone/30 hover:text-primary transition-colors">
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
