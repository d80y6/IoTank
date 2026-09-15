import { useState, useEffect } from 'react';

/**
 * Custom hook to track window size and provide breakpoint helpers
 * Aligned with the 9-tier IoTank Responsive Strategy
 */
export const useWindowSize = () => {
    const [windowSize, setWindowSize] = useState({
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
    });

    useEffect(() => {
        const handleResize = () => {
            setWindowSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const width = windowSize.width;

    return {
        ...windowSize,
        isSmallPhone: width <= 360,
        isStandardPhone: width > 360 && width <= 414,
        isLargePhone: width > 414 && width <= 480,
        isMobile: width <= 480,
        isSmallTablet: width > 480 && width <= 600,
        isStandardTablet: width > 600 && width <= 768,
        isLargeTablet: width > 768 && width <= 1024,
        isSmallLaptop: width > 1024 && width <= 1280,
        isStandardLaptop: width > 1280 && width <= 1440,
        isLargeDisplay: width > 1440,
        // Semantic helpers
        isTablet: width > 480 && width <= 1024,
        isDesktop: width > 1024,
    };
};
