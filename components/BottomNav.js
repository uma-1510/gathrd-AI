'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function BottomNav() {
  const pathname = usePathname();

  // Original items — untouched
  const items = [
    { href: '/gallery', label: 'Gallery', icon: GalleryIcon  },
    { href: '/people',  label: 'People',  icon: PeopleIcon   },
    { href: '/albums',  label: 'Albums',  icon: AlbumsIcon   },
    { href: '/upload',  label: 'Upload',  icon: UploadIcon   },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700&display=swap');

        .bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          height: 68px; z-index: 1000;
          background: rgba(242,239,233,0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(17,17,17,0.08);
          display: flex; justify-content: space-around; align-items: center;
          padding: 0 8px;
          box-shadow: 0 -4px 24px rgba(0,0,0,0.05);
        }

        /* Hide on desktop — matching original @media intent */
        @media (min-width: 1024px) { .bottom-nav { display: none; } }

        .nav-item {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          text-decoration: none;
          padding: 8px 20px;
          border-radius: 14px;
          transition: background 0.18s;
          position: relative;
          flex: 1; max-width: 90px;
        }
        .nav-item:hover { background: rgba(17,17,17,0.05); }
        .nav-item.active { background: rgba(17,17,17,0.07); }

        .nav-icon {
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.2s;
        }
        .nav-item:hover .nav-icon { transform: translateY(-1px); }

        .nav-label {
          font-family: 'Syne', sans-serif;
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase;
          transition: color 0.18s;
        }

        .active-dot {
          position: absolute; bottom: 5px;
          width: 3px; height: 3px; border-radius: 50%;
          background: #111;
        }
      `}</style>

      <nav className="bottom-nav">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`nav-item${active ? ' active' : ''}`}
            >
              <span className="nav-icon">
                <Icon active={active} />
              </span>
              <span className="nav-label" style={{ color: active ? '#111' : 'rgba(17,17,17,0.38)' }}>
                {label}
              </span>
              {active && <span className="active-dot" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

// ── Minimal SVG icons ─────────────────────────────────────────────────────────
function GalleryIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#111' : 'rgba(17,17,17,0.38)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  );
}
function PeopleIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#111' : 'rgba(17,17,17,0.38)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3"/>
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      <path d="M21 21v-2a4 4 0 0 0-3-3.87"/>
    </svg>
  );
}
function AlbumsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#111' : 'rgba(17,17,17,0.38)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    </svg>
  );
}
function UploadIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#111' : 'rgba(17,17,17,0.38)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}