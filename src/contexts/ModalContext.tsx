import React, { createContext, useContext, useState, ReactNode } from 'react';

type ModalType = 'shift-close' | 'shift-open' | 'delivery' | 'order' | 'report' | 'support-setup' | 'support-docs' | 'support-diagnostics' | 'refill_verification' | null;

interface ModalContextType {
    activeModal: ModalType;
    modalData: any;
    openModal: (type: ModalType, data?: any) => void;
    closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [activeModal, setActiveModal] = useState<ModalType>(null);
    const [modalData, setModalData] = useState<any>(null);

    const openModal = (type: ModalType, data: any = null) => {
        setActiveModal(type);
        setModalData(data);
    };

    const closeModal = () => {
        setActiveModal(null);
        setModalData(null);
    };

    // [AUTOMATION PROTOCOL]: Listen for global system-modal events
    // This allows the Alert Engine to 'pop' modals automatically
    React.useEffect(() => {
        const handler = (e: any) => {
            const { modalType, data } = e.detail || {};
            if (modalType) {
                setActiveModal(modalType as ModalType);
                if (data) setModalData(data);
            }
        };
        window.addEventListener('system-modal', handler);
        return () => window.removeEventListener('system-modal', handler);
    }, []);

    return (
        <ModalContext.Provider value={{ activeModal, modalData, openModal, closeModal }}>
            {children}
        </ModalContext.Provider>
    );
};

export const useModals = () => {
    const context = useContext(ModalContext);
    if (!context) {
        throw new Error('useModals must be used within a ModalProvider');
    }
    return context;
};
