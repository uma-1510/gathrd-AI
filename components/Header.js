'use client';
import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const { data: session } = useSession();
  const [showMenu, setShowMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // const navLinks = [
  //   { href: '/gallery', label: 'Gallery' },
  //   { href: '/upload',  label: 'Upload'  },
  // ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');

        .header-root {
          position: fixed; top: 0; left: 0; right: 0; height: 62px; z-index: 1000;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 32px;
          background: rgba(242,239,233,0.88);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(17,17,17,0.07);
          transition: box-shadow 0.3s;
        }
        .header-root.scrolled {
          box-shadow: 0 4px 24px rgba(0,0,0,0.06);
        }

        .header-logo {
          font-family: 'Syne', sans-serif;
          font-size: 20px; font-weight: 800;
          letter-spacing: -0.05em; color: #111;
          text-decoration: none;
        }

        .header-nav {
          display: flex; align-items: center; gap: 4px;
          list-style: none;
          margin: 0; padding: 0;
        }
        .header-nav a {
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 500;
          letter-spacing: 0.01em;
          color: rgba(17,17,17,0.45);
          text-decoration: none;
          padding: 7px 14px;
          border-radius: 100px;
          transition: color 0.18s, background 0.18s;
        }
        .header-nav a:hover { color: #111; background: rgba(17,17,17,0.05); }
        .header-nav a.active {
          color: #111; font-weight: 600;
          background: rgba(17,17,17,0.07);
        }

        .header-search-btn {
          display: flex; align-items: center; justify-content: center;
          width: 36px; height: 36px;
          border-radius: 50%;
          border: 1px solid transparent;
          background: transparent;
          text-decoration: none;
          transition: background 0.18s, border-color 0.18s;
          margin-right: 4px;
          flex-shrink: 0;
        }
        .header-search-btn:hover {
          background: rgba(17,17,17,0.07);
          border-color: rgba(17,17,17,0.1);
        }
        .header-search-btn.active {
          background: rgba(17,17,17,0.09);
        }

        .avatar-btn {
          display: flex; align-items: center; gap: 8px;
          background: rgba(17,17,17,0.05);
          border: 1.5px solid rgba(17,17,17,0.1);
          border-radius: 100px;
          padding: 5px 14px 5px 5px;
          cursor: pointer;
          transition: background 0.18s, border-color 0.18s;
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 600; color: #111;
        }
        .avatar-btn:hover {
          background: rgba(17,17,17,0.08);
          border-color: rgba(17,17,17,0.2);
        }
        .avatar-circle {
          width: 28px; height: 28px; border-radius: 50%;
          background: #111;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Syne', sans-serif;
          font-size: 12px; font-weight: 700; color: #f2efe9;
          flex-shrink: 0;
        }
        .chevron {
          font-size: 9px; color: rgba(17,17,17,0.4);
          transition: transform 0.2s;
        }
        .chevron.open { transform: rotate(180deg); }

        @keyframes menuIn {
          from { opacity:0; transform: scale(0.96) translateY(-6px); }
          to   { opacity:1; transform: scale(1)    translateY(0); }
        }
        .dropdown {
          position: absolute; top: calc(100% + 8px); right: 0;
          background: rgba(250,248,244,0.97);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 16px; min-width: 192px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
          overflow: hidden;
          animation: menuIn 0.22s cubic-bezier(0.22,1,0.36,1) both;
          transform-origin: top right;
        }
        .dropdown-header {
          padding: 14px 16px 10px;
          border-bottom: 1px solid rgba(17,17,17,0.07);
        }
        .dropdown-label {
          font-family: 'Syne', sans-serif;
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: rgba(17,17,17,0.35); margin-bottom: 2px;
        }
        .dropdown-name {
          font-family: 'Syne', sans-serif;
          font-size: 14px; font-weight: 700; color: #111;
        }
        .dropdown-btn {
          width: 100%; padding: 12px 16px;
          background: none; border: none;
          text-align: left; cursor: pointer;
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 600;
          color: #c0392b;
          transition: background 0.15s;
          display: flex; align-items: center; gap: 8px;
        }
        .dropdown-btn:hover { background: rgba(220,38,38,0.05); }
      `}</style>

      <header className={`header-root${scrolled ? ' scrolled' : ''}`}>

        {/* Logo */}
        <Link href="/" className="header-logo">gathrd</Link>

        {/* Nav links */}
        {/* <ul className="header-nav">
          {navLinks.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} className={pathname === href ? 'active' : ''}>{label}</Link>
            </li>
          ))}
        </ul> */}

        {/* Right side: search icon + avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* Search icon */}
          <Link
            href="/search"
            className={`header-search-btn${pathname === '/search' ? ' active' : ''}`}
            title="Search"
          >
            <svg
              width="17" height="17" viewBox="0 0 24 24" fill="none"
              stroke={pathname === '/search' ? '#111' : 'rgba(17,17,17,0.55)'}
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </Link>

          {/* User menu */}
          {session && (
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button className="avatar-btn" onClick={() => setShowMenu(!showMenu)}>
                <div className="avatar-circle">
                  {session.user.username?.[0]?.toUpperCase()}
                </div>
                {session.user.username}
                <span className={`chevron${showMenu ? ' open' : ''}`}>▼</span>
              </button>

              {showMenu && (
                <div className="dropdown">
                  <div className="dropdown-header">
                    <div className="dropdown-label">Signed in as</div>
                    <div className="dropdown-name">{session.user.username}</div>
                  </div>
                  <button
                    className="dropdown-btn"
                    onClick={() => signOut({ callbackUrl: '/login' })}
                  >
                    <span>↩</span> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </header>
    </>
  );
}