interface RateLimitEntry {
  count: number;
  resetTime: number;
  lastAttempt: number;
}

class RateLimiter {
  private attempts = new Map<string, RateLimitEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000, blockDurationMs = 30 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.blockDurationMs = blockDurationMs;
  }

  isBlocked(identifier: string): boolean {
    const entry = this.attempts.get(identifier);
    if (!entry) return false;

    const now = Date.now();
    
    // If the block duration has passed, reset the counter
    if (now > entry.resetTime) {
      this.attempts.delete(identifier);
      return false;
    }

    return entry.count >= this.maxAttempts;
  }

  canAttempt(identifier: string): { allowed: boolean; remainingAttempts: number; resetTime: number | null } {
    const now = Date.now();
    const entry = this.attempts.get(identifier);

    if (!entry) {
      return { allowed: true, remainingAttempts: this.maxAttempts, resetTime: null };
    }

    // Reset window if expired
    if (now > entry.resetTime) {
      this.attempts.delete(identifier);
      return { allowed: true, remainingAttempts: this.maxAttempts - 1, resetTime: null };
    }

    const remainingAttempts = Math.max(0, this.maxAttempts - entry.count);
    const resetTime = entry.count >= this.maxAttempts ? entry.resetTime : null;

    return {
      allowed: entry.count < this.maxAttempts,
      remainingAttempts,
      resetTime
    };
  }

  recordAttempt(identifier: string): void {
    const now = Date.now();
    const entry = this.attempts.get(identifier);

    if (!entry) {
      this.attempts.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
        lastAttempt: now
      });
      return;
    }

    // Reset window if expired
    if (now > entry.resetTime) {
      this.attempts.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
        lastAttempt: now
      });
      return;
    }

    // Increment count
    entry.count++;
    entry.lastAttempt = now;

    // If max attempts just reached, set block duration ONCE — do not extend on repeated attempts
    if (entry.count === this.maxAttempts) {
      entry.resetTime = now + this.blockDurationMs;
    }
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  getRemainingTime(identifier: string): number {
    const entry = this.attempts.get(identifier);
    if (!entry) return 0;
    
    const now = Date.now();
    return Math.max(0, entry.resetTime - now);
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts.entries()) {
      if (now > entry.resetTime) {
        this.attempts.delete(key);
      }
    }
  }
}

// Create instances for different types of rate limiting
export const authRateLimiter = new RateLimiter(5, 15 * 60 * 1000, 30 * 60 * 1000); // 5 attempts per 15min, block for 30min
export const passwordResetRateLimiter = new RateLimiter(3, 60 * 60 * 1000, 60 * 60 * 1000); // 3 attempts per hour, block for 1hour

// L-03 FIX: Guard against duplicate intervals on Vite HMR hot-reloads.
// Without this, each HMR cycle re-executes this module-level side effect,
// accumulating N cleanup intervals where N = number of reloads.
declare global {
    interface Window { __iotank_rate_limiter_cleanup?: boolean; }
}
if (typeof window !== 'undefined' && !window.__iotank_rate_limiter_cleanup) {
    window.__iotank_rate_limiter_cleanup = true;
    setInterval(() => {
        authRateLimiter.cleanup();
        passwordResetRateLimiter.cleanup();
    }, 5 * 60 * 1000);
}

export default RateLimiter;
