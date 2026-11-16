import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import type { PublicAcademyInfo, UserPublic } from '../../shared/types';
import { BrandCrest } from './BrandCrest';

interface PublicLayoutProps {
  academy: PublicAcademyInfo | null;
  currentUser: UserPublic | null;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { to: '/courses', label: 'Programs' },
  { to: '/about', label: 'About' },
  { to: '/admissions', label: 'Admissions' },
  { to: '/verify-certificate', label: 'Verify Certificate' },
  { to: '/contact', label: 'Contact' },
] as const;

export function PublicLayout({
  academy,
  currentUser,
  children,
}: PublicLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const instituteName = academy?.name || 'IGS — InfoCom Global Services';
  const slogan = academy?.slogan || 'Learn Today, Build Tomorrow.';
  const address =
    academy?.address ||
    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

  const portalLabel = currentUser ? 'Open Portal' : 'Portal Login';
  const portalHref = currentUser ? '/portal' : '/login';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strictly 3-zone top bar: Brand — 5 single-line nav links — 1 primary CTA */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="flex items-center gap-3 text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-md"
          >
            <BrandCrest
              logoDataUrl={academy?.logoDataUrl}
              name={instituteName}
              sizeClass="h-10 w-auto max-w-[128px]"
            />
            <span className="font-display text-base sm:text-lg font-bold tracking-tight whitespace-nowrap">
              {instituteName}
            </span>
          </Link>

          <nav
            aria-label="Primary website navigation"
            className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                    isActive
                      ? 'text-blue-900 border-blue-800 font-semibold'
                      : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to={portalHref}
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {portalLabel}
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="lg:hidden p-2 rounded-md text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `block px-3 py-2.5 text-sm font-medium rounded-md ${
                    isActive
                      ? 'bg-blue-50 text-blue-900'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="pt-2 border-t border-slate-200">
              <Link
                to={portalHref}
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center px-4 py-2.5 text-xs font-semibold text-white bg-blue-900 rounded-md"
              >
                {portalLabel}
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-slate-900 text-slate-300 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-5 space-y-3">
            <div className="flex items-center gap-3 text-white">
              <BrandCrest
                logoDataUrl={academy?.logoDataUrl}
                name={instituteName}
                sizeClass="h-12 w-auto max-w-[150px]"
                darkSurface
              />
              <div>
                <p className="font-display text-base font-semibold tracking-tight">
                  {instituteName}
                </p>
                <p className="text-xs text-blue-300">Computer Institute · {slogan}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-md">
              {address}
            </p>
          </div>

          <div className="md:col-span-3 space-y-2.5 text-xs">
            <p className="font-display font-semibold text-white text-sm">Institute</p>
            <ul className="space-y-2 text-slate-400">
              <li>
                <Link to="/courses" className="hover:text-white transition-colors">
                  Published Programs
                </Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-white transition-colors">
                  About Sopore Campus
                </Link>
              </li>
              <li>
                <Link to="/admissions" className="hover:text-white transition-colors">
                  Admissions Application
                </Link>
              </li>
              <li>
                <Link to="/verify-certificate" className="hover:text-white transition-colors">
                  Certificate Verification
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4 space-y-2.5 text-xs">
            <p className="font-display font-semibold text-white text-sm">Campus &amp; Portal</p>
            <div className="space-y-1.5 text-slate-400">
              <p>{address}</p>
              {academy?.phone && academy.phone.trim().length > 0 && (
                <p>
                  Phone:{' '}
                  <a
                    href={`tel:${academy.phone.trim()}`}
                    className="text-slate-200 hover:text-white font-mono"
                  >
                    {academy.phone.trim()}
                  </a>
                </p>
              )}
              {academy?.email && academy.email.trim().length > 0 && (
                <p>
                  Email:{' '}
                  <a
                    href={`mailto:${academy.email.trim()}`}
                    className="text-slate-200 hover:text-white"
                  >
                    {academy.email.trim()}
                  </a>
                </p>
              )}
              {academy?.website && academy.website.trim().length > 0 && (
                <p>
                  Website:{' '}
                  <a
                    href={academy.website.trim()}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-200 hover:text-white"
                  >
                    {academy.website.trim()}
                  </a>
                </p>
              )}
            </div>
            <div className="pt-2">
              <Link
                to={portalHref}
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-md transition-colors"
              >
                {portalLabel}
              </Link>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              &copy; {new Date().getFullYear()} {instituteName}. All rights reserved.
            </span>
            <span>Sopore, Jammu &amp; Kashmir · Academic Management &amp; Student Portal</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
