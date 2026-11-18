import { AsyncLocalStorage } from 'node:async_hooks';

export interface DistributedRateLimitOutcome {
  success: boolean;
}

export interface DistributedRateLimitBinding {
  limit: (options: { key: string }) => Promise<DistributedRateLimitOutcome>;
}

export type RateLimitBindingName = 'auth' | 'public';

export interface RateLimiterBindingsContext {
  auth?: DistributedRateLimitBinding;
  public?: DistributedRateLimitBinding;
  runtime?: 'cloudflare-worker' | 'node';
}

const rateLimiterStore = new AsyncLocalStorage<RateLimiterBindingsContext>();
let warnedMissingProdWorkerBinding = false;

export async function runWithRateLimiters<T>(
  bindings: RateLimiterBindingsContext | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!bindings) return fn();
  return rateLimiterStore.run(bindings, fn);
}

export function getActiveRateLimiterBinding(
  name: RateLimitBindingName | undefined
): {
  binding: DistributedRateLimitBinding | undefined;
  runtime: 'cloudflare-worker' | 'node';
} {
  const store = rateLimiterStore.getStore();
  if (!store) {
    return { binding: undefined, runtime: 'node' };
  }
  const binding = name === 'auth' ? store.auth : name === 'public' ? store.public : undefined;
  if (!binding && store.runtime === 'cloudflare-worker' && !warnedMissingProdWorkerBinding) {
    warnedMissingProdWorkerBinding = true;
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'RATE_LIMIT_IN_MEMORY_FALLBACK',
        bindingName: name ?? 'default',
        message:
          'Cloudflare Rate Limiting binding is absent; falling back to per-isolate memory limiter.',
      })
    );
  }
  return {
    binding,
    runtime: store.runtime ?? 'node',
  };
}

export async function checkDistributedRateLimit(params: {
  binding: DistributedRateLimitBinding;
  key: string;
}): Promise<{ allowed: boolean; backend: 'cloudflare-binding' }> {
  const outcome = await params.binding.limit({ key: params.key });
  return {
    allowed: Boolean(outcome?.success),
    backend: 'cloudflare-binding',
  };
}
