import React from 'react';
import type { PublicDataSource } from '../../utils/public-data';

interface DemoPreviewBannerProps {
  source: PublicDataSource;
  isDemoEnvironment?: boolean;
  variant?: 'site' | 'detail';
  className?: string;
}

export function DemoPreviewBanner({
  source,
  isDemoEnvironment = false,
  variant = 'site',
  className = '',
}: DemoPreviewBannerProps) {
  if (source === 'demo') {
    return (
      <div
        role="status"
        data-testid="demo-preview-banner"
        className={`px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-950 space-y-0.5 ${className}`}
      >
        <p className="font-semibold tracking-wide uppercase text-[11px] text-amber-900">
          DEMO PREVIEW
        </p>
        <p>
          The public website is currently displaying sample course information while the IGS backend is being connected. Course titles, syllabus, fees and schedules are illustrative and are not confirmed official institute offerings.
        </p>
      </div>
    );
  }

  if (isDemoEnvironment) {
    return (
      <div
        role="status"
        data-testid="dev-sample-banner"
        className={`px-4 py-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-950 ${className}`}
      >
        {variant === 'detail' ? (
          <>
            <strong>Development Sample Program:</strong> This syllabus is a seeded development fixture (<code>NODE_ENV=development</code>) and is excluded automatically in production environments.
          </>
        ) : (
          <>
            <strong>Development Sample Catalog:</strong> Marked sample programs come from the local development seed (<code>NODE_ENV=development</code>) and are excluded automatically in production.
          </>
        )}
      </div>
    );
  }

  return null;
}
