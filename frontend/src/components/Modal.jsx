import React, { useEffect } from 'react';

const Modal = ({ show, onClose, title, children, type = 'info', actionText = 'Đồng ý', onAction }) => {
    useEffect(() => {
        if (show) {
            document.body.style.overflow = 'hidden';
            
            const handleEsc = (e) => {
                if (e.key === 'Escape') onClose();
            };
            window.addEventListener('keydown', handleEsc);
            return () => {
                document.body.style.overflow = 'unset';
                window.removeEventListener('keydown', handleEsc);
            };
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [show, onClose]);

    if (!show) return null;

    const getTypeStyles = () => {
        switch (type) {
            case 'success': return { icon: 'check_circle', color: 'text-green-600', border: 'border-green-100' };
            case 'error': return { icon: 'error', color: 'text-red-600', border: 'border-red-100' };
            case 'warning': return { icon: 'warning', color: 'text-gold', border: 'border-gold/20' };
            default: return { icon: 'info', color: 'text-primary', border: 'border-primary/10' };
        }
    };

    const styles = getTypeStyles();

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-primary/20 backdrop-blur-sm cursor-pointer"
                onClick={onClose}
            ></div>

            {/* Modal Content */}
            <div className={`relative bg-white w-full max-w-md shadow-premium border-2 ${styles.border} overflow-hidden animate-in zoom-in-95 duration-300`}>
                {/* Decorative gold line */}
                <div className="h-1 bg-gradient-to-r from-gold/0 via-gold to-gold/0 w-full"></div>

                <div className="p-8 space-y-6">
                    <div className="flex items-center gap-4">
                        <span className={`material-symbols-outlined text-4xl ${styles.color}`}>
                            {styles.icon}
                        </span>
                        <div>
                            <h3 className="font-display font-bold text-primary text-xl uppercase tracking-wider">{title}</h3>
                            <div className="h-px bg-gold/10 w-full mt-1"></div>
                        </div>
                    </div>

                    <div className="font-body text-stone leading-relaxed">
                        {children}
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="px-6 py-2 border border-gold/20 font-ui font-bold text-[10px] uppercase tracking-widest text-stone hover:bg-gold/5 transition-all"
                            >
                                Đóng
                            </button>
                        )}
                        {onAction && (
                            <button
                                onClick={() => { onAction(); if (onClose) onClose(); }}
                                className="px-6 py-2 bg-primary text-white font-ui font-bold text-[10px] uppercase tracking-widest hover:bg-umber transition-all"
                            >
                                {actionText}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Modal;
