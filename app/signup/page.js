'use client';

import { useState, useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// ── Custom Cursor ─────────────────────────────────────────────────────────────
function Cursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const mouse = useRef({ x: -200, y: -200 });
  const ring = useRef({ x: -200, y: -200 });
  const [hov, setHov] = useState(false);

  useEffect(() => {
    const onMove = (e) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    const onOver = (e) => { if (e.target.closest('a,button,input,label')) setHov(true); };
    const onOut  = (e) => { if (e.target.closest('a,button,input,label')) setHov(false); };
    let raf;
    const tick = () => {
      ring.current.x += (mouse.current.x - ring.current.x) * 0.1;
      ring.current.y += (mouse.current.y - ring.current.y) * 0.1;
      if (dotRef.current) {
        dotRef.current.style.left = mouse.current.x + 'px';
        dotRef.current.style.top  = mouse.current.y + 'px';
      }
      if (ringRef.current) {
        ringRef.current.style.left = ring.current.x + 'px';
        ringRef.current.style.top  = ring.current.y + 'px';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout',  onOut);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout',  onOut);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} style={{
        position:'fixed', pointerEvents:'none', zIndex:9999,
        width:7, height:7, borderRadius:'50%', background:'#111',
        transform:'translate(-50%,-50%)', transition:'width 0.2s,height 0.2s',
      }}/>
      <div ref={ringRef} style={{
        position:'fixed', pointerEvents:'none', zIndex:9998,
        width: hov ? 42 : 26, height: hov ? 42 : 26,
        borderRadius:'50%',
        border:`1.5px solid ${hov ? 'rgba(17,17,17,0.4)' : 'rgba(17,17,17,0.2)'}`,
        transform:'translate(-50%,-50%)',
        transition:'width 0.25s,height 0.25s,border-color 0.2s',
      }}/>
    </>
  );
}

// ── Animated left-panel canvas ────────────────────────────────────────────────
function PanelCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let W = cv.width = cv.offsetWidth;
    let H = cv.height = cv.offsetHeight;
    let id;
    const pts = Array.from({ length: 52 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: 18 + Math.random() * 90,
      vx: (Math.random() - 0.5) * 0.13,
      vy: (Math.random() - 0.5) * 0.11,
      hue: Math.random() > 0.55 ? 26 + Math.random() * 20 : 200 + Math.random() * 30,
      alpha: 0.07 + Math.random() * 0.11,
      ph: Math.random() * Math.PI * 2,
    }));
    const draw = () => {
      ctx.fillStyle = '#181210';
      ctx.fillRect(0, 0, W, H);
      // warm light leak top
      const lk = ctx.createRadialGradient(W * 0.65, -H * 0.05, 0, W * 0.65, H * 0.18, W * 0.7);
      lk.addColorStop(0, 'rgba(235,170,65,0.24)'); lk.addColorStop(1, 'rgba(235,170,65,0)');
      ctx.fillStyle = lk; ctx.fillRect(0, 0, W, H);
      // blue bottom
      const bl = ctx.createRadialGradient(W * 0.28, H * 1.1, 0, W * 0.28, H, W * 0.65);
      bl.addColorStop(0, 'rgba(38,76,160,0.15)'); bl.addColorStop(1, 'rgba(38,76,160,0)');
      ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H);
      // bokeh
      pts.forEach(p => {
        p.ph += 0.005; p.x += p.vx + Math.sin(p.ph) * 0.07; p.y += p.vy + Math.cos(p.ph * 0.8) * 0.06;
        if (p.x < -p.r) p.x = W + p.r; if (p.x > W + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = H + p.r; if (p.y > H + p.r) p.y = -p.r;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `hsla(${p.hue},55%,65%,${p.alpha})`);
        g.addColorStop(0.5, `hsla(${p.hue},40%,45%,${p.alpha * 0.4})`);
        g.addColorStop(1, `hsla(${p.hue},30%,30%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      });
      id = requestAnimationFrame(draw);
    };
    draw();
    const onResize = () => { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', display:'block' }} />;
}

// ── Field Component ───────────────────────────────────────────────────────────
function Field({ label, type, name, value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 22 }}>
      <label style={{
        display: 'block', marginBottom: 7,
        fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: focused ? '#111' : 'rgba(17,17,17,0.42)',
        transition: 'color 0.2s',
      }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={type} name={name} value={value}
          onChange={onChange} placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          required
          style={{
            width: '100%', padding: '14px 18px',
            background: focused ? '#fff' : 'rgba(17,17,17,0.03)',
            border: `1.5px solid ${focused ? 'rgba(17,17,17,0.55)' : 'rgba(17,17,17,0.12)'}`,
            borderRadius: 10, outline: 'none',
            fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 400,
            color: '#111',
            transition: 'border-color 0.22s, background 0.22s, box-shadow 0.22s',
            boxShadow: focused ? '0 0 0 3px rgba(17,17,17,0.06)' : 'none',
            letterSpacing: '0.01em',
          }}
        />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Signup() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0); // 0 = idle, 1 = success

  useEffect(() => { const t = setTimeout(() => setLoaded(true), 60); return () => clearTimeout(t); }, []);

  const handleChange = (e) => { setForm({ ...form, [e.target.name]: e.target.value }); setError(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    if (!form.username || !form.email || !form.password) { setError('All fields are required'); setLoading(false); return; }
    if (form.username.length < 3) { setError('Username must be at least 3 characters'); setLoading(false); return; }
    if (!form.email.includes('@')) { setError('Please enter a valid email'); setLoading(false); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return; }

    const res = await fetch('/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Signup failed'); setLoading(false); }
    else { router.push('/login'); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; cursor: none; overflow-x: hidden; }
        a, button, input, label { cursor: none; }
        input::placeholder { color: rgba(17,17,17,0.25); }
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0 100px #fff inset; }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-28px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes checkPop {
          0%   { transform: scale(0) rotate(-10deg); opacity:0; }
          70%  { transform: scale(1.15) rotate(3deg); opacity:1; }
          100% { transform: scale(1) rotate(0deg); opacity:1; }
        }

        .slide-right { animation: slideRight 0.85s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .slide-up-1  { animation: slideUp   0.8s  cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .slide-up-2  { animation: slideUp   0.8s  cubic-bezier(0.22,1,0.36,1) 0.28s both; }
        .slide-up-3  { animation: slideUp   0.8s  cubic-bezier(0.22,1,0.36,1) 0.38s both; }
        .slide-up-4  { animation: slideUp   0.8s  cubic-bezier(0.22,1,0.36,1) 0.48s both; }
        .slide-up-5  { animation: slideUp   0.8s  cubic-bezier(0.22,1,0.36,1) 0.56s both; }

        .spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        .submit-btn {
          width: 100%; padding: 15px 0;
          background: #111; color: #f2efe9;
          border: none; border-radius: 100px;
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          letter-spacing: 0.06em; text-transform: uppercase;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          transition: background 0.22s, transform 0.22s, box-shadow 0.22s;
        }
        .submit-btn:not(:disabled):hover {
          background: #2a2a2a;
          transform: scale(1.015);
          box-shadow: 0 8px 28px rgba(0,0,0,0.18);
        }
        .submit-btn:disabled { background: rgba(17,17,17,0.3); }

        .divider {
          display: flex; align-items: center; gap: 14px;
          margin: 24px 0;
        }
        .divider-line { flex: 1; height: 1px; background: rgba(17,17,17,0.1); }
        .divider-text { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(17,17,17,0.28); }

        .social-btn {
          width: 100%; padding: 13px 0;
          background: transparent;
          border: 1.5px solid rgba(17,17,17,0.14);
          border-radius: 100px;
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 600;
          letter-spacing: 0.03em; color: rgba(17,17,17,0.6);
          display: flex; align-items: center; justify-content: center; gap: 10px;
          transition: border-color 0.2s, color 0.2s, background 0.2s;
          margin-bottom: 10px;
        }
        .social-btn:hover { border-color: rgba(17,17,17,0.45); color: #111; background: rgba(17,17,17,0.02); }
      `}</style>

      <Cursor />

      <div style={{ display: 'flex', minHeight: '100vh' }}>

        {/* ── LEFT PANEL — cinematic visual ── */}
        <div
          className={loaded ? 'slide-right' : ''}
          style={{
            opacity: loaded ? undefined : 0,
            position: 'relative', flex: '0 0 48%',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <PanelCanvas />

          {/* Nav logo */}
          <div style={{ position: 'relative', zIndex: 2, padding: '36px 44px' }}>
            <a href="/" style={{
              fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800,
              letterSpacing: '-0.05em', color: '#fff', textDecoration: 'none',
            }}>gathrd</a>
          </div>

          {/* Bottom caption */}
          <div style={{ position: 'relative', zIndex: 2, padding: '0 44px 48px' }}>
            {/* Gradient above text */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 220,
              background: 'linear-gradient(to top, rgba(8,5,3,0.72) 0%, transparent 100%)',
              zIndex: -1, borderRadius: 0,
            }}/>
            <p style={{
              fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.35)', marginBottom: 10,
            }}>Memory Platform </p>
            <p style={{
              fontFamily: "serif",
              fontSize: 'clamp(22px, 2.4vw, 34px)',
              fontWeight: 400, fontStyle: 'italic',
              color: '#fff', lineHeight: 1.2, letterSpacing: '-0.01em',
            }}>
              Your memories deserve<br />intelligence too.
            </p>

            {/* Feature chips */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 22 }}>
              {['Memory Timeline', 'AI Search', 'Life Graphs'].map(t => (
                <span key={t} style={{
                  fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.42)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 100, padding: '5px 12px',
                }}>{t}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL — form ── */}
        <div style={{
          flex: 1, background: '#f2efe9',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 'clamp(40px, 5vw, 80px) clamp(32px, 6vw, 88px)',
          overflowY: 'auto',
        }}>
          {/* Top link */}
          <div style={{
            position: 'absolute', top: 32, right: 44,
            fontFamily: "'Syne', sans-serif", fontSize: 13,
            color: 'rgba(17,17,17,0.4)',
          }}
          className={loaded ? 'slide-up-1' : ''}
          >
            Already a member?{' '}
            <a href="/login" style={{
              color: '#111', fontWeight: 700, textDecoration: 'none',
              borderBottom: '1.5px solid rgba(17,17,17,0.25)',
              paddingBottom: 1, transition: 'border-color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#111'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(17,17,17,0.25)'}
            >Sign in →</a>
          </div>

          <div style={{ width: '100%', maxWidth: 400 }}>

            {/* Heading */}
            <div className={loaded ? 'slide-up-1' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 36 }}>
              <p style={{
                fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'rgba(17,17,17,0.35)', marginBottom: 10,
              }}>Create account</p>
              <h1 style={{
                fontFamily: "serif",
                fontSize: 'clamp(28px, 3.2vw, 40px)',
                fontWeight: 400, fontStyle: 'italic',
                color: '#111', lineHeight: 1.15, letterSpacing: '-0.02em',
              }}>
                Search your photos<br />intelligently.
              </h1>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.07)',
                border: '1.5px solid rgba(220,38,38,0.2)',
                color: '#dc2626',
                padding: '12px 16px', borderRadius: 10,
                fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 500,
                marginBottom: 22, letterSpacing: '0.01em',
              }}>{error}</div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit}>
              <div className={loaded ? 'slide-up-2' : ''} style={{ opacity: loaded ? undefined : 0 }}>
                <Field label="Username" type="text" name="username"
                  value={form.username} onChange={handleChange} placeholder="yourname" />
              </div>
              <div className={loaded ? 'slide-up-3' : ''} style={{ opacity: loaded ? undefined : 0 }}>
                <Field label="Email" type="email" name="email"
                  value={form.email} onChange={handleChange} placeholder="you@example.com" />
              </div>
              <div className={loaded ? 'slide-up-4' : ''} style={{ opacity: loaded ? undefined : 0 }}>
                <Field label="Password" type="password" name="password"
                  value={form.password} onChange={handleChange} placeholder="Min. 6 characters" />
              </div>

              <div className={loaded ? 'slide-up-5' : ''} style={{ opacity: loaded ? undefined : 0 }}>
                <button type="submit" disabled={loading} className="submit-btn">
                  {loading
                    ? <><span className="spinner" /> Creating account…</>
                    : <>Create account →</>}
                </button>
              </div>
            </form>

            {/* Divider + social */}
            <div className={loaded ? 'slide-up-5' : ''} style={{ opacity: loaded ? undefined : 0, animationDelay: '0.62s' }}>
              <div className="divider">
                <div className="divider-line" />
                <span className="divider-text">or continue with</span>
                <div className="divider-line" />
              </div>

              <button
  className="social-btn"
  type="button"
  onClick={() => signIn('google', { callbackUrl: '/' })}
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
  Continue with Google
</button>
            </div>

            {/* Terms */}
            <p style={{
              fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 500,
              color: 'rgba(17,17,17,0.28)', textAlign: 'center', marginTop: 24,
              lineHeight: 1.7, letterSpacing: '0.02em',
            }}>
              By creating an account, you agree to our{' '}
              <a href="#" style={{ color: 'rgba(17,17,17,0.5)', textDecoration: 'underline' }}>Terms</a>
              {' '}and{' '}
              <a href="#" style={{ color: 'rgba(17,17,17,0.5)', textDecoration: 'underline' }}>Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}