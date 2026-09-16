/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';
import { queryClient } from '@/lib/queryClient';
import { normalizeJurisdiction, JurisdictionConfig } from '@/lib/jurisdiction';

export const DEFAULT_JURISDICTION_CODE = import.meta.env.VITE_JURISDICTION || 'GLOBAL';

interface JurisdictionContextType {
    code: string;
    jurisdiction: JurisdictionConfig;
    config: Record<string, unknown>;
    isLoading: boolean;
    error: unknown;
    isGlobal: boolean;
}

const JurisdictionContext = createContext<JurisdictionContextType | undefined>(undefined);

export const JurisdictionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const code = DEFAULT_JURISDICTION_CODE;

    const { data, isLoading, error } = useQuery({
        queryKey: ['jurisdiction', code],
        queryFn: async () => {
            const { data: rpcData, error: rpcError } = await supabase.rpc('get_jurisdiction_config', {
                p_code: code,
            });
            if (rpcError) throw rpcError;
            return rpcData as { jurisdiction?: JurisdictionConfig; config?: Record<string, unknown> } | null;
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });

    const jurisdiction = normalizeJurisdiction(data?.jurisdiction);
    const config = data?.config || {};

    return (
        <JurisdictionContext.Provider value={{
            code,
            jurisdiction,
            config,
            isLoading,
            error,
            isGlobal: jurisdiction.isGlobal !== false,
        }}>
            {children}
        </JurisdictionContext.Provider>
    );
};

export const useJurisdiction = () => {
    const context = useContext(JurisdictionContext);
    if (context === undefined) {
        throw new Error('useJurisdiction must be used within a JurisdictionProvider');
    }
    return context;
};

export const refreshJurisdiction = () => {
    queryClient.invalidateQueries({ queryKey: ['jurisdiction', DEFAULT_JURISDICTION_CODE] });
};