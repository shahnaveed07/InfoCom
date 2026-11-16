import React from 'react';

export const OFFICIAL_BRAND_LOGO_PATH = '/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg';

interface BrandCrestProps {
  logoDataUrl?: string | null;
  name?: string;
  sizeClass?: string;
  darkSurface?: boolean;
}

/**
 * Renders the supplied official IGS — InfoCom Global Services logo (or admin-uploaded override),
 * preserving its original proportions cleanly on light or dark surfaces.
 */
export function BrandCrest({
  logoDataUrl,
  name = 'IGS — InfoCom Global Services',
  sizeClass = 'h-10 w-auto',
  darkSurface = false,
}: BrandCrestProps) {
  const src =
    logoDataUrl && logoDataUrl.trim().length > 0
      ? logoDataUrl.trim()
      : OFFICIAL_BRAND_LOGO_PATH;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md overflow-hidden shrink-0 ${
        darkSurface
          ? 'bg-[#EAEAE8] px-1.5 py-0.5 border border-slate-700/70'
          : 'bg-[#EAEAE8] border border-slate-200/80'
      }`}
    >
      <img
        src={src}
        alt={`${name} official logo`}
        className={`${sizeClass} object-contain shrink-0 block`}
      />
    </span>
  );
}

