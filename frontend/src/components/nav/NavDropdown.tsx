import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

interface DropdownLink {
  label: string;
  path: string;
}

interface NavDropdownProps {
  label: string;
  path: string;
  items?: DropdownLink[];
  isActive: boolean;
}

/** A single top-level nav item; if `items` is given it opens a glassmorphic
 * mega-menu panel on hover (fade + slight y-translate, matching the
 * WeEvolveIT reference), closing on a short delay so moving the cursor from
 * the trigger into the panel doesn't flicker it shut. */
export const NavDropdown: React.FC<NavDropdownProps> = ({ label, path, items, isActive }) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasDropdown = Boolean(items && items.length > 0);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div
      className="relative"
      onMouseEnter={hasDropdown ? openNow : undefined}
      onMouseLeave={hasDropdown ? closeSoon : undefined}
    >
      <Link
        to={path}
        onClick={() => setOpen(false)}
        className={`flex items-center space-x-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
          isActive ? 'text-white' : 'text-white/55 hover:text-white'
        }`}
      >
        <span>{label}</span>
        {hasDropdown && (
          <svg
            className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
          >
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </Link>

      {hasDropdown && (
        <div
          className={`absolute left-1/2 top-full z-50 mt-3 w-56 -translate-x-1/2 rounded-2xl border border-white/10 bg-carbon-glass p-2 shadow-2xl backdrop-blur-xl transition-all duration-200 ${
            open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
          }`}
        >
          {items!.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2 text-sm text-white/65 transition-colors hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
