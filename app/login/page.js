'use client';

import { useState, useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// ── Custom Cursor ─────────────────────────────────────────────────────────────
function Cursor() {
  const dotRef  = useRef(null);
  const ringRef = useRef(null);
  const mouse   = useRef({ x: -200, y: -200 });
  const ring    = useRef({ x: -200, y: -200 });
  const [hov, setHov] = useState(false);

  useEffect(() => {
    const onMove = (e) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    const onOver = (e) => { if (e.target.closest('a,button,input')) setHov(true); };
    const onOut  = (e) => { if (e.target.closest('a,button,input')) setHov(false); };

    let raf;
    const tick = () => {
      ring.current.x += (mouse.current.x - ring.current.x) * 0.1;
      ring.current.y += (mouse.current.y - ring.current.y) * 0.1;
      if (dotRef.current)  { dotRef.current.style.left  = mouse.current.x + 'px'; dotRef.current.style.top  = mouse.current.y + 'px'; }
      if (ringRef.current) { ringRef.current.style.left = ring.current.x  + 'px'; ringRef.current.style.top = ring.current.y  + 'px'; }
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
      <div ref={dotRef}  style={{ position:'fixed', pointerEvents:'none', zIndex:9999, width:7,  height:7,  borderRadius:'50%', background:'#111', transform:'translate(-50%,-50%)' }} />
      <div ref={ringRef} style={{ position:'fixed', pointerEvents:'none', zIndex:9998, width: hov?40:26, height: hov?40:26, borderRadius:'50%', border:`1.5px solid ${hov?'rgba(17,17,17,0.38)':'rgba(17,17,17,0.18)'}`, transform:'translate(-50%,-50%)', transition:'width 0.25s,height 0.25s,border-color 0.2s' }} />
    </>
  );
}

// ── Floating polaroid memories ────────────────────────────────────────────────
function FloatingMemories() {
  const items = [
    { top:'8%',  left:'4%',  rotate:-8, delay:0,   scale:0.88 },
    { top:'18%', left:'78%', rotate: 6, delay:0.4,  scale:0.92 },
    { top:'55%', left:'2%',  rotate: 4, delay:0.8,  scale:0.82 },
    { top:'68%', left:'80%', rotate:-5, delay:0.2,  scale:0.95 },
    { top:'82%', left:'22%', rotate: 9, delay:1.0,  scale:0.85 },
    { top:'6%',  left:'42%', rotate:-4, delay:0.6,  scale:0.78 },
    { top:'78%', left:'60%', rotate: 7, delay:1.2,  scale:0.9  },
  ];
  const gradients = [
    'linear-gradient(135deg,#d4c5b0 0%,#b8a898 100%)',
    'linear-gradient(135deg,#b8c8d4 0%,#9ab0bc 100%)',
    'linear-gradient(135deg,#c8b8a8 0%,#b0a090 100%)',
    'linear-gradient(135deg,#c4d0c0 0%,#a8b8a4 100%)',
    'linear-gradient(135deg,#d0c0b0 0%,#b8a8a0 100%)',
    'linear-gradient(135deg,#b8c4d0 0%,#a0aeb8 100%)',
    'linear-gradient(135deg,#ccc0b0 0%,#b4a898 100%)',
  ];
  return (
    <div style={{ position:'fixed', inset:0, overflow:'hidden', pointerEvents:'none', zIndex:0 }}>
      {items.map((item, i) => (
        <div key={i} style={{ position:'absolute', top:item.top, left:item.left, transform:`rotate(${item.rotate}deg) scale(${item.scale})`, animation:`floatMem ${7+i*0.9}s ease-in-out ${item.delay}s infinite alternate`, opacity:0, animationFillMode:'both' }}>
          <div style={{ width:110, height:130, background:'#faf8f4', boxShadow:'0 4px 20px rgba(0,0,0,0.1),0 1px 4px rgba(0,0,0,0.06)', borderRadius:4, padding:'10px 10px 28px', display:'flex', flexDirection:'column' }}>
            <div style={{ flex:1, borderRadius:2, background:gradients[i%gradients.length], opacity:0.7 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Input Field ───────────────────────────────────────────────────────────────
// FIX: "Forgot?" button is now a sibling of the label span, NOT inside a <label> element.
// A button inside a <label> gets its click intercepted by the label's default behavior.
function Field({ label, type, name, value, onChange, onForgot }) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ marginBottom: 18 }}>
      {/* FIX: use <div> wrapper instead of <label> so button click works */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
        <label
          htmlFor={`field-${name}`}
          style={{ fontFamily:"'Syne',sans-serif", fontSize:11, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color: focused ? '#111' : 'rgba(17,17,17,0.38)', transition:'color 0.2s' }}
        >
          {label}
        </label>
        {name === 'password' && onForgot && (
          <button
            type="button"
            onClick={() => { console.log('forgot clicked'); window.location.href = '/forgot-password'; }}
            style={{ fontSize:11, fontWeight:500, letterSpacing:'0.04em', color:'rgba(17,17,17,0.35)', background:'none', border:'none', cursor:'pointer', textTransform:'none', fontFamily:"'Syne',sans-serif", padding:0, lineHeight:1 }}
            onMouseEnter={e => e.currentTarget.style.color = '#111'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(17,17,17,0.35)'}
          >
            Forgot?
          </button>
        )}
      </div>

      <input
        id={`field-${name}`}
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        required
        style={{ width:'100%', padding:'13px 16px', background: focused?'#fff':'rgba(17,17,17,0.03)', border:`1.5px solid ${focused?'rgba(17,17,17,0.5)':'rgba(17,17,17,0.11)'}`, borderRadius:10, outline:'none', fontFamily:"'Syne',sans-serif", fontSize:14, color:'#111', transition:'border-color 0.2s,background 0.2s,box-shadow 0.2s', boxShadow: focused?'0 0 0 3px rgba(17,17,17,0.05)':'none' }}
      />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Login() {
  const router = useRouter();

  const [form, setForm]       = useState({ username:'', password:'' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  const handleChange = (e) => { setForm({ ...form, [e.target.name]: e.target.value }); setError(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    if (!form.username || !form.password) { setError('Please enter username and password'); setLoading(false); return; }
    const res = await signIn('credentials', { username:form.username, password:form.password, redirect:false });
    if (res?.error) { setError('Invalid username or password'); setLoading(false); }
    else { router.push('/'); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:#f2efe9; font-family:'Syne',sans-serif; cursor:none; }
        a, button, input { cursor:none; }
        input::placeholder { color:rgba(17,17,17,0.22); }
        input:-webkit-autofill { -webkit-box-shadow:0 0 0 100px #fff inset; }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes floatMem { from{opacity:0.55;transform:translateY(0px)} to{opacity:0.75;transform:translateY(-14px)} }
        @keyframes spin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .fu-1 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .fu-3 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.25s both; }
        .fu-4 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.33s both; }
        .fu-5 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.40s both; }
        .fi   { animation: fadeIn 1.2s ease 0.1s both; }
        .spinner { width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite; }
        .sign-in-btn { width:100%;padding:15px 0;background:#111;color:#f2efe9;border:none;border-radius:100px;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;display:flex;align-items:center;justify-content:center;gap:10px;transition:background 0.2s,transform 0.2s,box-shadow 0.2s;margin-top:6px; }
        .sign-in-btn:not(:disabled):hover { background:#2a2a2a;transform:scale(1.015);box-shadow:0 8px 28px rgba(0,0,0,0.16); }
        .sign-in-btn:disabled { background:rgba(17,17,17,0.28);cursor:not-allowed; }
        .google-btn { display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:13px 0;background:transparent;border:1.5px solid rgba(17,17,17,0.13);border-radius:100px;font-family:'Syne',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.03em;color:rgba(17,17,17,0.55);transition:border-color 0.2s,color 0.2s,background 0.2s; }
        .google-btn:hover { border-color:rgba(17,17,17,0.4);color:#111;background:rgba(17,17,17,0.02); }
        .card { background:rgba(250,248,244,0.82);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(17,17,17,0.07);border-radius:24px;padding:clamp(36px,5vh,52px) clamp(32px,4vw,48px);width:100%;max-width:420px;box-shadow:0 2px 4px rgba(0,0,0,0.04),0 12px 40px rgba(0,0,0,0.08),0 32px 80px rgba(0,0,0,0.06); }
      `}</style>

      <Cursor />

      <div style={{ position:'fixed', inset:0, background:'#f2efe9', zIndex:-1 }} />
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none', background:'radial-gradient(ellipse 70% 60% at 50% 44%,rgba(200,185,160,0.22) 0%,transparent 100%)' }} />

      <div className={loaded ? 'fi' : ''} style={{ opacity: loaded ? undefined : 0 }}>
        <FloatingMemories />
      </div>

      <div style={{ position:'relative', zIndex:10, minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px' }}>

        {/* Logo */}
        <div className={loaded ? 'fu-1' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom:28, textAlign:'center' }}>
          <a href="/" style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, letterSpacing:'-0.05em', color:'#111', textDecoration:'none' }}>
            gathrd
          </a>
        </div>

        {/* Card */}
        <div className={`card ${loaded ? 'fu-2' : ''}`} style={{ opacity: loaded ? undefined : 0 }}>

          <div style={{ marginBottom:30, textAlign:'center' }}>
            <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:'clamp(26px,3vw,34px)', fontWeight:400, fontStyle:'italic', color:'#111', letterSpacing:'-0.02em', lineHeight:1.15, marginBottom:8 }}>
              Welcome back.
            </h1>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.38)', letterSpacing:'0.01em' }}>
              Sign in to your memories
            </p>
          </div>

          {error && (
            <div style={{ background:'rgba(220,38,38,0.06)', border:'1.5px solid rgba(220,38,38,0.18)', color:'#dc2626', padding:'11px 14px', borderRadius:10, fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:500, marginBottom:20, textAlign:'center' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className={loaded ? 'fu-3' : ''} style={{ opacity: loaded ? undefined : 0 }}>
              <Field label="Username" type="text" name="username" value={form.username} onChange={handleChange} />
            </div>
            <div className={loaded ? 'fu-4' : ''} style={{ opacity: loaded ? undefined : 0 }}>
              <Field label="Password" type="password" name="password" value={form.password} onChange={handleChange} onForgot={() => {}} />
            </div>
            <div className={loaded ? 'fu-5' : ''} style={{ opacity: loaded ? undefined : 0, marginTop:22 }}>
              <button type="submit" disabled={loading} className="sign-in-btn">
                {loading ? <><span className="spinner" /> Signing in…</> : 'Sign in →'}
              </button>
            </div>
          </form>

          <div style={{ display:'flex', alignItems:'center', gap:14, margin:'22px 0' }}>
            <div style={{ flex:1, height:1, background:'rgba(17,17,17,0.09)' }} />
            <span style={{ fontFamily:"'Syne',sans-serif", fontSize:10, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'rgba(17,17,17,0.26)' }}>or</span>
            <div style={{ flex:1, height:1, background:'rgba(17,17,17,0.09)' }} />
          </div>

          <button type="button" className="google-btn" onClick={() => signIn('google', { callbackUrl:'/' })}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

        </div>

        {/* Sign up link */}
        <div style={{ marginTop:24, textAlign:'center', fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.38)' }}>
          Don&apos;t have an account?{' '}
          <a href="/signup"
            style={{ color:'#111', fontWeight:700, textDecoration:'none', borderBottom:'1.5px solid rgba(17,17,17,0.22)', paddingBottom:1, transition:'border-color 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor='#111'}
            onMouseLeave={e => e.currentTarget.style.borderColor='rgba(17,17,17,0.22)'}
          >
            Sign Up
          </a>
        </div>

      </div>
    </>
  );
}