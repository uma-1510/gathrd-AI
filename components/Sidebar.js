'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';


const navItems = [
  { href: '/',        label: 'Home',          icon: HomeIcon    },
  { href: '/gallery', label: 'Gallery',        icon: GalleryIcon },
  { href: '/albums',  label: 'Albums',         icon: AlbumsIcon  },
  { href: '/groups',  label: 'Groups',         icon: GroupsIcon  },
  { href: '/shared',  label: 'Shared With Me', icon: SharedIcon  },
  { href: '/people',  label: 'People',         icon: PeopleIcon  },
  // { href: '/search',  label: 'Search & Filter',icon: SearchIcon  },
  { href: '/agent', label: 'AI Assistant', icon: AgentIcon },
];

export default function Sidebar() {
  const pathname  = usePathname();
  const { data: session } = useSession();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap');

        .sidebar {
          position: fixed; top: 62px; left: 0; bottom: 0; width: 240px;
          background: rgba(245,242,236,0.96);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-right: 1px solid rgba(17,17,17,0.08);
          padding: 20px 12px 100px;
          overflow-y: auto; z-index: 900;
          display: flex; flex-direction: column;
        }
        .sidebar::-webkit-scrollbar { width: 0; }

        @keyframes slideInLeft {
          from { opacity:0; transform:translateX(-12px); }
          to   { opacity:1; transform:translateX(0); }
        }

        .nav-link {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 10px;
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 500;
          letter-spacing: 0.01em;
          color: rgba(17,17,17,0.45);
          text-decoration: none;
          transition: background 0.18s, color 0.18s;
          border: 1px solid transparent;
        }
        .nav-link:hover {
          background: rgba(17,17,17,0.05);
          color: #111;
        }
        .nav-link.active {
          background: #111;
          color: #f2efe9;
          font-weight: 700;
          box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        }
        .nav-link.active svg { opacity: 1; }
        .nav-link svg { opacity: 0.55; transition: opacity 0.18s; flex-shrink: 0; }
        .nav-link:hover svg { opacity: 0.85; }

        .active-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(242,239,233,0.7);
          margin-left: auto; flex-shrink: 0;
        }

        .nav-label {
          flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .section-gap { height: 8px; }

        .admin-link {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 10px;
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 600;
          letter-spacing: 0.01em;
          color: rgba(17,17,17,0.5);
          text-decoration: none;
          background: rgba(17,17,17,0.04);
          border: 1.5px solid rgba(17,17,17,0.1);
          transition: background 0.18s, color 0.18s, border-color 0.18s;
          margin-top: 8px;
        }
        .admin-link:hover {
          background: rgba(17,17,17,0.08);
          color: #111; border-color: rgba(17,17,17,0.22);
        }
        .admin-link.active {
          background: #111; color: #f2efe9;
          border-color: transparent;
        }

        .sidebar-footer {
          position: absolute; bottom: 0; left: 0; right: 0;
          padding: 16px 12px;
          border-top: 1px solid rgba(17,17,17,0.07);
          background: rgba(245,242,236,0.98);
        }
        .footer-inner {
          padding: 12px 14px; border-radius: 12px;
          background: rgba(17,17,17,0.04);
          border: 1px solid rgba(17,17,17,0.07);
          display: flex; align-items: center; gap: 10px;
        }
        .footer-wordmark {
          font-family: 'Syne', sans-serif;
          font-size: 14px; font-weight: 800;
          letter-spacing: -0.04em; color: #111;
        }
        .footer-version {
          font-family: 'Syne', sans-serif;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: rgba(17,17,17,0.3);
          margin-left: auto;
        }
      `}</style>

      <aside className="sidebar">
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {/* Original navItems map — href and label untouched */}
          {navItems.map(({ href, label, icon: Icon }, i) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`nav-link${active ? ' active' : ''}`}
                style={{ animationDelay: `${i * 0.04}s`, animation: `slideInLeft 0.4s ease ${i * 0.04}s both` }}
              >
                <Icon active={active} />
                <span className="nav-label">{label}</span>
                {active && <span className="active-dot" />}
              </Link>
            );
          })}

          <div className="section-gap" />

          {/* Original admin check — condition untouched */}
          {session?.user?.role === 'admin' && (
            <Link
              href="/admin"
              className={`admin-link${pathname === '/admin' ? ' active' : ''}`}
            >
              <AdminIcon active={pathname === '/admin'} />
              <span className="nav-label">Admin Dashboard</span>
              {pathname === '/admin' && <span className="active-dot" />}
            </Link>
          )}
        </nav>

        {/* Footer — original "GathRd v1.0" text preserved */}
        <div className="sidebar-footer">
          <div className="footer-inner">
            <span className="footer-wordmark">gathrd</span>
            <span className="footer-version">v1.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const ic = (active) => ({ stroke: active ? '#f2efe9' : 'rgba(17,17,17,0.7)', strokeWidth: '1.8', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' });

function HomeIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
}
function GalleryIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
}
function AlbumsIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
}
function GroupsIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>;
}
function SharedIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}
function PeopleIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;
}
function SearchIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function AdminIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>;
}
function AgentIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...ic(active)}><path d="M12 2a8 8 0 0 1 8 8c0 3.5-2 6.5-5 7.7V20h-6v-2.3C6 16.5 4 13.5 4 10a8 8 0 0 1 8-8z"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/></svg>;
}