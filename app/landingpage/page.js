'use client';

import { useEffect, useState, useRef } from 'react';

// Floating polaroids — reused from login page for consistency
function FloatingMemories() {
  const items = [
    { top: '10%', left: '3%',  rotate: -7, delay: 0,   scale: 0.85 },
    { top: '15%', left: '80%', rotate:  5, delay: 0.3, scale: 0.9  },
    { top: '60%', left: '1%',  rotate:  4, delay: 0.7, scale: 0.8  },
    { top: '65%', left: '82%', rotate: -6, delay: 0.2, scale: 0.92 },
    { top: '80%', left: '25%', rotate:  8, delay: 0.9, scale: 0.82 },
    { top: '5%',  left: '45%', rotate: -3, delay: 0.5, scale: 0.75 },
    { top: '75%', left: '62%', rotate:  6, delay: 1.1, scale: 0.88 },
  ];
  const gradients = [
    'linear-gradient(135deg, #d4c5b0 0%, #b8a898 100%)',
    'linear-gradient(135deg, #b8c8d4 0%, #9ab0bc 100%)',
    'linear-gradient(135deg, #c8b8a8 0%, #b0a090 100%)',
    'linear-gradient(135deg, #c4d0c0 0%, #a8b8a4 100%)',
    'linear-gradient(135deg, #d0c0b0 0%, #b8a8a0 100%)',
    'linear-gradient(135deg, #b8c4d0 0%, #a0aeb8 100%)',
    'linear-gradient(135deg, #ccc0b0 0%, #b4a898 100%)',
  ];
  return (
    <div style={{ position:'fixed', inset:0, overflow:'hidden', pointerEvents:'none', zIndex:0 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          position:'absolute', top: item.top, left: item.left,
          transform: `rotate(${item.rotate}deg) scale(${item.scale})`,
          animation: `floatMem ${7 + i * 0.9}s ease-in-out ${item.delay}s infinite alternate`,
          opacity: 0, animationFillMode: 'both',
        }}>
          <div style={{
            width: 100, height: 118,
            background: '#faf8f4',
            boxShadow: '0 4px 20px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)',
            borderRadius: 3, padding: '9px 9px 26px',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ flex:1, borderRadius:2, background: gradients[i % gradients.length], opacity:0.65 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 60); return () => clearTimeout(t); }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:#f2efe9; font-family:'Syne',sans-serif; cursor:none; overflow:hidden; }
        a, button { cursor: none; }

        @keyframes fadeUp {
          from { opacity:0; transform:translateY(20px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes floatMem {
          from { opacity:0.5; transform:translateY(0px); }
          to   { opacity:0.7; transform:translateY(-14px); }
        }

        .fu-1 { animation: fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.18s both; }
        .fu-3 { animation: fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.30s both; }
        .fu-4 { animation: fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.42s both; }
        .fi   { animation: fadeIn 1.2s ease 0.05s both; }

        .btn-signin {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 14px 30px;
          background: #111; color: #f2efe9;
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          border-radius: 100px; text-decoration: none;
          transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
        }
        .btn-signin:hover {
          background: #2a2a2a;
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(0,0,0,0.15);
        }

        .btn-signup {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 30px;
          background: transparent;
          border: 1.5px solid rgba(17,17,17,0.2);
          color: rgba(17,17,17,0.7);
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 600;
          letter-spacing: 0.04em;
          border-radius: 100px; text-decoration: none;
          transition: border-color 0.2s, color 0.2s, transform 0.2s, background 0.2s;
        }
        .btn-signup:hover {
          border-color: rgba(17,17,17,0.5); color: #111;
          background: rgba(17,17,17,0.04);
          transform: translateY(-2px);
        }

        .feature-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px;
          background: rgba(17,17,17,0.05);
          border: 1px solid rgba(17,17,17,0.1);
          border-radius: 100px;
          font-family: 'Syne', sans-serif;
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: rgba(17,17,17,0.45);
        }
      `}</style>

      {/* Background */}
      <div style={{ position:'fixed', inset:0, background:'#f2efe9', zIndex:-1 }} />
      <div style={{
        position:'fixed', inset:0, zIndex:0, pointerEvents:'none',
        background:'radial-gradient(ellipse 65% 55% at 50% 48%, rgba(200,185,160,0.2) 0%, transparent 100%)',
      }} />

      {/* Floating polaroids */}
      <div className={loaded ? 'fi' : ''} style={{ opacity: loaded ? undefined : 0 }}>
        <FloatingMemories />
      </div>

      {/* ── Main content ── */}
      <div style={{
        position: 'relative', zIndex: 10,
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px',
        textAlign: 'center',
      }}>

        {/* Logo */}
        <div className={loaded ? 'fu-1' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 40 }}>
          <span style={{
            fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800,
            letterSpacing: '-0.05em', color: '#111',
          }}>gathrd</span>
        </div>

        {/* Eyebrow */}
        <div className={loaded ? 'fu-2' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 20 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'rgba(17,17,17,0.35)',
            background: 'rgba(17,17,17,0.05)',
            border: '1px solid rgba(17,17,17,0.09)',
            borderRadius: 100, padding: '6px 16px',
          }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:'rgba(17,17,17,0.35)', display:'inline-block' }}/>
            AI-Powered Memory Platform
          </span>
        </div>

        {/* Headline */}
        <div className={loaded ? 'fu-2' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 20 }}>
          <h1 style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: 'clamp(36px, 6vw, 72px)',
            fontWeight: 400, fontStyle: 'italic',
            color: '#111', lineHeight: 1.1, letterSpacing: '-0.025em',
          }}>
            Your memories deserve<br />intelligence too.
          </h1>
        </div>

        {/* Subheading — original text preserved */}
        <div className={loaded ? 'fu-3' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 44 }}>
          <p style={{
            fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 400,
            color: 'rgba(17,17,17,0.45)', lineHeight: 1.75, maxWidth: 460,
          }}>
            Ask questions about your photos, create memory graphs,<br />and relive your memories.
          </p>
        </div>

        {/* CTA buttons — original hrefs preserved exactly */}
        <div className={loaded ? 'fu-4' : ''} style={{
          opacity: loaded ? undefined : 0,
          display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center',
          marginBottom: 52,
        }}>
          {/* Original href="/login" */}
          <a href="/login" className="btn-signin">Sign in →</a>
          {/* Original href="/signup" */}
          <a href="/signup" className="btn-signup">Create account</a>
        </div>

        {/* Feature chips */}
        <div className={loaded ? 'fu-4' : ''} style={{
          opacity: loaded ? undefined : 0, animationDelay: '0.48s',
          display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {['Memory Timeline', 'AI Search', 'Shared Albums', 'Life Graphs'].map(f => (
            <span key={f} className="feature-chip">✦ {f}</span>
          ))}
        </div>
      </div>
    </>
  );
}