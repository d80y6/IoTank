/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ThemeMode, ColorBlindMode } from '@/types';

interface ThemeContextType {
    theme: ThemeMode;
    colorBlindMode: ColorBlindMode;
    setTheme: (theme: ThemeMode) => void;
    setColorBlindMode: (mode: ColorBlindMode) => void;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
    // Restore user's saved preference, defaulting to 'light' if none set
    const [theme, setThemeState] = useState<ThemeMode>(() => {
        const stored = localStorage.getItem('iotank-theme');
        return (stored === 'dark' || stored === 'light') ? stored as ThemeMode : 'light';
    });

    const [colorBlindMode, setColorBlindModeState] = useState<ColorBlindMode>(() => {
        const stored = localStorage.getItem('iotank-colorblind-mode');
        return (stored as ColorBlindMode) || 'none';
    });

    // Apply theme to document root
    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-theme', theme);
        localStorage.setItem('iotank-theme', theme);
    }, [theme]);

    // Apply colorblind mode
    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-colorblind', colorBlindMode);
        localStorage.setItem('iotank-colorblind-mode', colorBlindMode);
    }, [colorBlindMode]);

    const setTheme = (newTheme: ThemeMode) => {
        setThemeState(newTheme);
    };

    const setColorBlindMode = (mode: ColorBlindMode) => {
        setColorBlindModeState(mode);
    };

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    const value: ThemeContextType = {
        theme,
        colorBlindMode,
        setTheme,
        setColorBlindMode,
        toggleTheme,
    };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
