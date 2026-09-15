/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Input Sanitization and Validation Utilities
 * Protects against XSS, injection attacks, and invalid data
 */

import DOMPurify from 'dompurify';

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param dirty - Potentially unsafe HTML string
 * @returns Sanitized HTML string safe for rendering
 */
export function sanitizeHTML(dirty: string): string {
    return DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
        ALLOWED_ATTR: ['href', 'title', 'target'],
        ALLOW_DATA_ATTR: false,
    });
}

/**
 * Sanitizes plain text input
 * @param input - User input string
 * @param maxLength - Maximum allowed length (default: 1000)
 * @returns Sanitized string
 */
export function sanitizeText(input: string, maxLength: number = 1000): string {
    if (typeof input !== 'string') {
        return '';
    }

    // Remove any HTML tags
    const withoutTags = input.replace(/<[^>]*>/g, '');

    // Trim whitespace
    const trimmed = withoutTags.trim();

    // Limit length
    return trimmed.substring(0, maxLength);
}

/**
 * Validates and sanitizes a number
 * @param value - Value to validate
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Validated number or null if invalid
 */
export function validateNumber(
    value: any,
    min: number = -Infinity,
    max: number = Infinity
): number | null {
    const num = parseFloat(value);

    if (isNaN(num)) {
        return null;
    }

    if (num < min || num > max) {
        return null;
    }

    return num;
}

/**
 * Validates an email address
 * @param email - Email string to validate
 * @returns true if valid email format
 */
export function validateEmail(email: string): boolean {
    if (typeof email !== 'string') {
        return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validates a UUID string
 * @param uuid - UUID string to validate
 * @returns true if valid UUID format
 */
export function validateUUID(uuid: string): boolean {
    if (typeof uuid !== 'string') {
        return false;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

/**
 * Sanitizes a URL to prevent javascript: and data: URIs
 * @param url - URL string to sanitize
 * @returns Sanitized URL or empty string if invalid
 */
export function sanitizeURL(url: string): string {
    if (typeof url !== 'string') {
        return '';
    }

    const trimmed = url.trim();

    // Block dangerous protocols
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    const lowerURL = trimmed.toLowerCase();

    for (const protocol of dangerousProtocols) {
        if (lowerURL.startsWith(protocol)) {
            return '';
        }
    }

    // Only allow http, https, and relative URLs
    if (trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('./') ||
        trimmed.startsWith('../')) {
        return trimmed;
    }

    return '';
}

/**
 * Validates a date string
 * @param dateString - Date string to validate
 * @returns Date object if valid, null otherwise
 */
export function validateDate(dateString: string): Date | null {
    if (typeof dateString !== 'string') {
        return null;
    }

    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
        return null;
    }

    // Check if date is within reasonable range (1900 - 2100)
    const year = date.getFullYear();
    if (year < 1900 || year > 2100) {
        return null;
    }

    return date;
}

/**
 * Sanitizes object keys to prevent prototype pollution
 * @param obj - Object to sanitize
 * @returns Sanitized object
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): Partial<T> {
    const sanitized: Partial<T> = {};

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && !dangerousKeys.includes(key)) {
            sanitized[key] = obj[key];
        }
    }

    return sanitized;
}

/**
 * Rate limiting helper - checks if action is allowed
 * @param key - Unique identifier for the action
 * @param maxAttempts - Maximum attempts allowed
 * @param windowMs - Time window in milliseconds
 * @returns true if action is allowed
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
    key: string,
    maxAttempts: number = 5,
    windowMs: number = 60000
): boolean {
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || record.resetTime < now) {
        rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
        return true;
    }

    if (record.count >= maxAttempts) {
        return false;
    }

    record.count++;
    return true;
}

/**
 * Cleans up expired rate limit records
 */
export function cleanupRateLimits(): void {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (record.resetTime < now) {
            rateLimitStore.delete(key);
        }
    }
}

// Run cleanup every 5 minutes
if (typeof window !== 'undefined') {
    setInterval(cleanupRateLimits, 5 * 60 * 1000);
}
