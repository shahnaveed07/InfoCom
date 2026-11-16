import { useEffect, useState } from 'react';
import {
  DEMO_PUBLIC_ACADEMY,
  findDemoCourseBySlugOrId,
  getDemoAdmissionCatalog,
  getDemoCourseSummaries,
} from '../shared/demo-public-data';
import type {
  PublicAcademyInfo,
  PublicCourseDetail,
  PublicCourseSummary,
} from '../shared/types';
import {
  ApiError,
  api,
  isBackendUnavailableError,
  type BackendReadinessResult,
  type PublicAdmissionCatalog,
} from './api';

export type PublicDataMode = 'auto' | 'demo' | 'api';
export type PublicDataSource = 'live' | 'demo';

export interface PublicDataConfig {
  mode: PublicDataMode;
  fallbackEnabled: boolean;
}

function readPublicEnv(key: string): string | undefined {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
  if (metaEnv && typeof metaEnv[key] === 'string') {
    return metaEnv[key];
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key];
  }
  return undefined;
}

export function resolvePublicDataConfig(overrides?: Partial<PublicDataConfig>): PublicDataConfig {
  const rawMode = (overrides?.mode ?? readPublicEnv('VITE_PUBLIC_DATA_MODE') ?? 'auto')
    .toString()
    .trim()
    .toLowerCase();
  const mode: PublicDataMode =
    rawMode === 'demo' ? 'demo' : rawMode === 'api' ? 'api' : 'auto';

  let fallbackEnabled = true;
  if (typeof overrides?.fallbackEnabled === 'boolean') {
    fallbackEnabled = overrides.fallbackEnabled;
  } else {
    const rawFallback = readPublicEnv('VITE_ENABLE_PUBLIC_DEMO_FALLBACK');
    if (typeof rawFallback === 'string' && rawFallback.trim().length > 0) {
      fallbackEnabled = rawFallback.trim().toLowerCase() !== 'false';
    }
  }

  return { mode, fallbackEnabled };
}

// ============================================================================
// Runtime Payload Validators
// ============================================================================

export function isValidAcademyPayload(value: unknown): value is PublicAcademyInfo {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    v.name.trim().length > 0 &&
    typeof v.slogan === 'string' &&
    typeof v.address === 'string' &&
    typeof v.currency === 'string'
  );
}

export function isValidCourseSummary(value: unknown): value is PublicCourseSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.code === 'string' &&
    typeof v.slug === 'string' &&
    typeof v.title === 'string' &&
    typeof v.category === 'string' &&
    typeof v.durationWeeks === 'number' &&
    Number.isFinite(v.durationWeeks) &&
    typeof v.moduleCount === 'number' &&
    Array.isArray(v.activeCohorts)
  );
}

export function isValidCoursesCatalogPayload(
  value: unknown
): value is { courses: PublicCourseSummary[]; currency: string; isDemoEnvironment?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.courses) || typeof v.currency !== 'string') return false;
  return v.courses.every(isValidCourseSummary);
}

export function isValidCourseDetailPayload(
  value: unknown
): value is { course: PublicCourseDetail; isDemoEnvironment?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v.course || !isValidCourseSummary(v.course)) return false;
  const detail = v.course as unknown as Record<string, unknown>;
  return Array.isArray(detail.modules) && Array.isArray(detail.learningObjectives);
}

export function isValidAdmissionCatalogPayload(
  value: unknown
): value is PublicAdmissionCatalog {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.academyName === 'string' &&
    typeof v.currency === 'string' &&
    Array.isArray(v.courses) &&
    Array.isArray(v.batches) &&
    Array.isArray(v.feePlans)
  );
}

function makeInvalidPayloadError(message: string): ApiError {
  return new ApiError(message, {
    status: 200,
    contentType: 'application/json',
    code: 'INVALID_PAYLOAD_SHAPE',
    kind: 'invalid_response',
  });
}

// ============================================================================
// Pure Fetchers with Mode & Fallback Semantics (used by Store & Unit Tests)
// ============================================================================

export interface PublicServiceDeps {
  getHealth?: (signal?: AbortSignal) => Promise<{ status: string }>;
  getReadiness?: (signal?: AbortSignal) => Promise<BackendReadinessResult>;
  getPublicAcademy?: (signal?: AbortSignal) => Promise<PublicAcademyInfo>;
  getPublicCourses?: (
    signal?: AbortSignal
  ) => Promise<{ courses: PublicCourseSummary[]; currency: string; isDemoEnvironment?: boolean }>;
  getPublicCourseDetail?: (
    slugOrId: string,
    signal?: AbortSignal
  ) => Promise<{ course: PublicCourseDetail; isDemoEnvironment?: boolean }>;
  fetchPublicAdmissionCatalog?: (signal?: AbortSignal) => Promise<PublicAdmissionCatalog>;
  onWarning?: (warning: string) => void;
}

const defaultDeps: Required<PublicServiceDeps> = {
  getHealth: (signal) => api.getHealth(signal),
  getReadiness: (signal) => api.getReadiness(signal),
  getPublicAcademy: (signal) => api.getPublicAcademy(signal),
  getPublicCourses: (signal) => api.getPublicCourses(signal),
  getPublicCourseDetail: (slugOrId, signal) => api.getPublicCourseDetail(slugOrId, signal),
  fetchPublicAdmissionCatalog: (signal) => api.fetchPublicAdmissionCatalog(signal),
  onWarning: (msg) => {
    console.warn(`[IGS public-data] ${msg}`);
  },
};

export interface PublicCatalogResult {
  courses: PublicCourseSummary[];
  currency: string;
  source: PublicDataSource;
  isDemoEnvironment: boolean;
  readiness: BackendReadinessResult;
  warning?: string;
}

export async function fetchPublicCatalogWithFallback(
  options?: {
    config?: Partial<PublicDataConfig>;
    deps?: PublicServiceDeps;
    signal?: AbortSignal;
  }
): Promise<PublicCatalogResult> {
  const config = resolvePublicDataConfig(options?.config);
  const deps = { ...defaultDeps, ...(options?.deps ?? {}) };

  if (config.mode === 'demo') {
    return {
      courses: getDemoCourseSummaries(),
      currency: DEMO_PUBLIC_ACADEMY.currency,
      source: 'demo',
      isDemoEnvironment: false,
      readiness: { backendReachable: false, databaseReady: false, status: 'offline' },
    };
  }

  try {
    const raw = await deps.getPublicCourses(options?.signal);
    if (!isValidCoursesCatalogPayload(raw)) {
      throw makeInvalidPayloadError('Malformed public courses catalog response.');
    }
    return {
      courses: raw.courses,
      currency: raw.currency || 'INR',
      source: 'live',
      isDemoEnvironment: Boolean(raw.isDemoEnvironment),
      readiness: { backendReachable: true, databaseReady: true, status: 'ready' },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }

    const readiness = await deps
      .getReadiness(options?.signal)
      .catch((): BackendReadinessResult => ({
        backendReachable: false,
        databaseReady: false,
        status: 'offline',
      }));

    if (config.mode === 'auto' && config.fallbackEnabled && shouldFallbackToDemo(err, readiness)) {
      const warning =
        err instanceof Error
          ? `Using local demo catalog (${err.message}).`
          : 'Using local demo catalog while backend connects.';
      deps.onWarning(warning);
      return {
        courses: getDemoCourseSummaries(),
        currency: DEMO_PUBLIC_ACADEMY.currency,
        source: 'demo',
        isDemoEnvironment: false,
        readiness,
        warning,
      };
    }

    throw err;
  }
}

export interface PublicAcademyResult {
  academy: PublicAcademyInfo;
  source: PublicDataSource;
}

export async function fetchPublicAcademyWithFallback(options?: {
  config?: Partial<PublicDataConfig>;
  deps?: PublicServiceDeps;
  signal?: AbortSignal;
}): Promise<PublicAcademyResult> {
  const config = resolvePublicDataConfig(options?.config);
  const deps = { ...defaultDeps, ...(options?.deps ?? {}) };

  if (config.mode === 'demo') {
    return { academy: DEMO_PUBLIC_ACADEMY, source: 'demo' };
  }

  try {
    const raw = await deps.getPublicAcademy(options?.signal);
    if (!isValidAcademyPayload(raw)) {
      throw makeInvalidPayloadError('Malformed public academy overview response.');
    }
    return { academy: raw, source: 'live' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (config.mode === 'auto' && config.fallbackEnabled && isFallbackableError(err)) {
      return { academy: DEMO_PUBLIC_ACADEMY, source: 'demo' };
    }
    throw err;
  }
}

export interface PublicCourseDetailResult {
  course: PublicCourseDetail;
  source: PublicDataSource;
  isDemoEnvironment: boolean;
  warning?: string;
}

function isFallbackableError(err: unknown): boolean {
  if (isBackendUnavailableError(err)) return true;
  // Treat plain network TypeError from fetch as unavailable
  if (err instanceof TypeError) return true;
  return false;
}

function shouldFallbackToDemo(err: unknown, readiness?: BackendReadinessResult): boolean {
  if (isFallbackableError(err)) return true;
  if (readiness && !readiness.databaseReady) return true;
  return false;
}

export async function fetchPublicCourseDetailWithFallback(
  slugOrId: string,
  options?: {
    config?: Partial<PublicDataConfig>;
    deps?: PublicServiceDeps;
    signal?: AbortSignal;
  }
): Promise<PublicCourseDetailResult> {
  const config = resolvePublicDataConfig(options?.config);
  const deps = { ...defaultDeps, ...(options?.deps ?? {}) };

  if (config.mode === 'demo') {
    const demoMatch = findDemoCourseBySlugOrId(slugOrId);
    if (!demoMatch) {
      throw new ApiError('Published program not found.', {
        status: 404,
        contentType: 'application/json',
        code: 'PROGRAM_NOT_FOUND',
        kind: 'not_found',
      });
    }
    return {
      course: demoMatch,
      source: 'demo',
      isDemoEnvironment: false,
    };
  }

  try {
    const raw = await deps.getPublicCourseDetail(slugOrId, options?.signal);
    if (!isValidCourseDetailPayload(raw)) {
      throw makeInvalidPayloadError('Malformed course detail response.');
    }
    return {
      course: raw.course,
      source: 'live',
      isDemoEnvironment: Boolean(raw.isDemoEnvironment),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }

    // Genuine backend JSON 404 for an unknown course MUST NOT fall back to demo
    if (err instanceof ApiError && err.kind === 'not_found') {
      throw err;
    }

    if (config.mode === 'auto' && config.fallbackEnabled && isFallbackableError(err)) {
      const demoMatch = findDemoCourseBySlugOrId(slugOrId);
      if (!demoMatch) {
        // Never display an unmatched slug or wrong course from demo data
        throw new ApiError('Published program not found.', {
          status: 404,
          contentType: 'application/json',
          code: 'PROGRAM_NOT_FOUND',
          kind: 'not_found',
        });
      }
      const warning =
        err instanceof Error
          ? `Showing sample course syllabus (${err.message}).`
          : 'Showing sample course syllabus while backend connects.';
      deps.onWarning(warning);
      return {
        course: demoMatch,
        source: 'demo',
        isDemoEnvironment: false,
        warning,
      };
    }

    throw err;
  }
}

export interface PublicAdmissionCatalogResult {
  catalog: PublicAdmissionCatalog;
  source: PublicDataSource;
  backendAvailableForSubmission: boolean;
}

export async function fetchPublicAdmissionCatalogWithFallback(options?: {
  config?: Partial<PublicDataConfig>;
  deps?: PublicServiceDeps;
  signal?: AbortSignal;
}): Promise<PublicAdmissionCatalogResult> {
  const config = resolvePublicDataConfig(options?.config);
  const deps = { ...defaultDeps, ...(options?.deps ?? {}) };

  if (config.mode === 'demo') {
    return {
      catalog: getDemoAdmissionCatalog(),
      source: 'demo',
      backendAvailableForSubmission: false,
    };
  }

  try {
    const raw = await deps.fetchPublicAdmissionCatalog(options?.signal);
    if (!isValidAdmissionCatalogPayload(raw)) {
      throw makeInvalidPayloadError('Malformed public admission catalog response.');
    }
    return {
      catalog: raw,
      source: 'live',
      backendAvailableForSubmission: true,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (config.mode === 'auto' && config.fallbackEnabled && isFallbackableError(err)) {
      return {
        catalog: getDemoAdmissionCatalog(),
        source: 'demo',
        backendAvailableForSubmission: false,
      };
    }
    throw err;
  }
}

// ============================================================================
// Shared Public Site Store (Deduplicated Fetching + Controlled Backoff Recovery)
// ============================================================================

export interface PublicSiteSnapshot {
  initialized: boolean;
  loading: boolean;
  academy: PublicAcademyInfo;
  courses: PublicCourseSummary[];
  currency: string;
  source: PublicDataSource;
  isDemoEnvironment: boolean;
  readiness: BackendReadinessResult;
  error: string;
  errorKind?: ApiError['kind'];
}

const BACKOFF_SCHEDULE_MS = [4000, 8000, 15000, 30000];
const LIVE_REVALIDATE_INTERVAL_MS = 45000;

class PublicSiteStore {
  private snapshot: PublicSiteSnapshot = {
    initialized: false,
    loading: true,
    academy: DEMO_PUBLIC_ACADEMY,
    courses: [],
    currency: 'INR',
    source: 'live',
    isDemoEnvironment: false,
    readiness: { backendReachable: false, databaseReady: false, status: 'offline' },
    error: '',
  };

  private listeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private revalidateTimer: ReturnType<typeof setInterval> | null = null;
  private failureCount = 0;
  private activeSubscribers = 0;

  getSnapshot(): PublicSiteSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.activeSubscribers += 1;

    if (!this.snapshot.initialized && !this.inFlight) {
      void this.refresh();
    }
    this.ensureRevalidateLoop();

    return () => {
      this.listeners.delete(listener);
      this.activeSubscribers = Math.max(0, this.activeSubscribers - 1);
      if (this.activeSubscribers === 0) {
        this.clearTimers();
      }
    };
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private clearTimers() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.revalidateTimer) {
      clearInterval(this.revalidateTimer);
      this.revalidateTimer = null;
    }
  }

  private ensureRevalidateLoop() {
    const config = resolvePublicDataConfig();
    if (config.mode !== 'auto') return;
    if (this.revalidateTimer || typeof window === 'undefined') return;

    this.revalidateTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (!this.inFlight && this.activeSubscribers > 0) {
        void this.refresh({ background: true });
      }
    }, LIVE_REVALIDATE_INTERVAL_MS);
  }

  private scheduleRetry() {
    const config = resolvePublicDataConfig();
    if (config.mode !== 'auto' || this.activeSubscribers === 0) return;
    if (this.retryTimer) return;

    const idx = Math.min(this.failureCount - 1, BACKOFF_SCHEDULE_MS.length - 1);
    const delayMs = BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.activeSubscribers > 0) {
        void this.refresh({ background: true });
      }
    }, delayMs);
  }

  async refresh(opts?: { background?: boolean; signal?: AbortSignal }): Promise<void> {
    if (this.inFlight) return this.inFlight;

    if (!opts?.background && !this.snapshot.initialized) {
      this.snapshot = { ...this.snapshot, loading: true };
      this.emit();
    }

    this.inFlight = (async () => {
      try {
        const [catalogRes, academyRes] = await Promise.all([
          fetchPublicCatalogWithFallback({ signal: opts?.signal }),
          fetchPublicAcademyWithFallback({ signal: opts?.signal }).catch(() => ({
            academy: DEMO_PUBLIC_ACADEMY,
            source: 'demo' as const,
          })),
        ]);

        const recovered = catalogRes.source === 'live';
        if (recovered) {
          this.failureCount = 0;
          if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
          }
        } else {
          this.failureCount += 1;
          this.scheduleRetry();
        }

        this.snapshot = {
          initialized: true,
          loading: false,
          academy: academyRes.academy,
          courses: catalogRes.courses,
          currency: catalogRes.currency,
          source: catalogRes.source,
          isDemoEnvironment: catalogRes.isDemoEnvironment,
          readiness: catalogRes.readiness,
          error: '',
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        this.failureCount += 1;
        this.scheduleRetry();
        this.snapshot = {
          ...this.snapshot,
          initialized: true,
          loading: false,
          courses: [],
          source: 'live',
          isDemoEnvironment: false,
          error:
            err instanceof Error
              ? err.message
              : 'Unable to load published institute programs right now.',
          errorKind: err instanceof ApiError ? err.kind : undefined,
        };
      } finally {
        this.inFlight = null;
        this.emit();
      }
    })();

    return this.inFlight;
  }

  /** Used only by unit tests to reset singleton store between cases */
  _resetForTest() {
    this.clearTimers();
    this.inFlight = null;
    this.failureCount = 0;
    this.snapshot = {
      initialized: false,
      loading: true,
      academy: DEMO_PUBLIC_ACADEMY,
      courses: [],
      currency: 'INR',
      source: 'live',
      isDemoEnvironment: false,
      readiness: { backendReachable: false, databaseReady: false, status: 'offline' },
      error: '',
    };
  }
}

export const publicSiteStore = new PublicSiteStore();

export function usePublicSiteData() {
  const [state, setState] = useState<PublicSiteSnapshot>(() => publicSiteStore.getSnapshot());

  useEffect(() => {
    const sync = () => setState(publicSiteStore.getSnapshot());
    sync();
    const unsub = publicSiteStore.subscribe(sync);
    return unsub;
  }, []);

  return {
    ...state,
    refresh: (opts?: { background?: boolean }) => publicSiteStore.refresh(opts),
  };
}
