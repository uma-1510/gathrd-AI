'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// ── Custom Cursor ─────────────────────────────────────────────────────────────
function Cursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const mouse = useRef({ x: -200, y: -200 });
  const ring = useRef({ x: -200, y: -200 });
  const [hov, setHov] = useState(false);

  useEffect(() => {
    const onMove = (e) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    const onOver = (e) => { if (e.target.closest('a,button,input')) setHov(true); };
    const onOut = (e) => { if (e.target.closest('a,button,input')) setHov(false); };

    let raf;
    const tick = () => {
      ring.current.x += (mouse.current.x - ring.current.x) * 0.1;
      ring.current.y += (mouse.current.y - ring.current.y) * 0.1;

      if (dotRef.current) {
        dotRef.current.style.left = mouse.current.x + 'px';
        dotRef.current.style.top = mouse.current.y + 'px';
      }

      if (ringRef.current) {
        ringRef.current.style.left = ring.current.x + 'px';
        ringRef.current.style.top = ring.current.y + 'px';
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
    };
  }, []);

  return (
    <>
      <div
        ref={dotRef}
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: 9999,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#111',
          transform: 'translate(-50%,-50%)',
        }}
      />
      <div
        ref={ringRef}
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: 9998,
          width: hov ? 40 : 26,
          height: hov ? 40 : 26,
          borderRadius: '50%',
          border: `1.5px solid ${hov ? 'rgba(17,17,17,0.38)' : 'rgba(17,17,17,0.18)'}`,
          transform: 'translate(-50%,-50%)',
          transition: 'width 0.25s,height 0.25s,border-color 0.2s',
        }}
      />
    </>
  );
}

// ── Floating polaroid memories ────────────────────────────────────────────────
function FloatingMemories() {
  const items = [
    { top: '8%', left: '4%', rotate: -8, delay: 0, scale: 0.88 },
    { top: '18%', left: '78%', rotate: 6, delay: 0.4, scale: 0.92 },
    { top: '55%', left: '2%', rotate: 4, delay: 0.8, scale: 0.82 },
    { top: '68%', left: '80%', rotate: -5, delay: 0.2, scale: 0.95 },
    { top: '82%', left: '22%', rotate: 9, delay: 1.0, scale: 0.85 },
    { top: '6%', left: '42%', rotate: -4, delay: 0.6, scale: 0.78 },
    { top: '78%', left: '60%', rotate: 7, delay: 1.2, scale: 0.9 },
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
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: item.top,
            left: item.left,
            transform: `rotate(${item.rotate}deg) scale(${item.scale})`,
            animation: `floatMem ${7 + i * 0.9}s ease-in-out ${item.delay}s infinite alternate`,
            opacity: 0,
            animationFillMode: 'both',
          }}
        >
          <div
            style={{
              width: 110,
              height: 130,
              background: '#faf8f4',
              boxShadow: '0 4px 20px rgba(0,0,0,0.1),0 1px 4px rgba(0,0,0,0.06)',
              borderRadius: 4,
              padding: '10px 10px 28px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ flex: 1, borderRadius: 2, background: gradients[i % gradients.length], opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Input Field ───────────────────────────────────────────────────────────────
function Field({
  label,
  type,
  name,
  value,
  onChange,
  showToggle,
  toggled,
  onToggle,
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <label
          htmlFor={`field-${name}`}
          style={{
            fontFamily: "'Syne',sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: focused ? '#111' : 'rgba(17,17,17,0.38)',
            transition: 'color 0.2s',
          }}
        >
          {label}
        </label>

        {showToggle && (
          <button
            type="button"
            onClick={onToggle}
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'rgba(17,17,17,0.35)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Syne',sans-serif",
              padding: 0,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(17,17,17,0.35)')}
          >
            {toggled ? 'Hide' : 'Show'}
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
        style={{
          width: '100%',
          padding: '13px 16px',
          background: focused ? '#fff' : 'rgba(17,17,17,0.03)',
          border: `1.5px solid ${focused ? 'rgba(17,17,17,0.5)' : 'rgba(17,17,17,0.11)'}`,
          borderRadius: 10,
          outline: 'none',
          fontFamily: "'Syne',sans-serif",
          fontSize: 14,
          color: '#111',
          transition: 'border-color 0.2s,background 0.2s,box-shadow 0.2s',
          boxShadow: focused ? '0 0 0 3px rgba(17,17,17,0.05)' : 'none',
        }}
      />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get('token');
  const email = searchParams.get('email');

  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  };

  const passwordChecks = {
    minLength: form.password.length >= 6,
    matches:
      form.password.length > 0 &&
      form.confirmPassword.length > 0 &&
      form.password === form.confirmPassword,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (!token || !email) {
      setError('This reset link is invalid or incomplete.');
      setLoading(false);
      return;
    }

    if (!form.password || !form.confirmPassword) {
      setError('Please enter and confirm your new password.');
      setLoading(false);
      return;
    }

    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      setLoading(false);
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password: form.password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to reset password');
        setLoading(false);
        return;
      }

      setSuccess('Password updated successfully. Redirecting to login...');
      setLoading(false);

      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const invalidLink = !token || !email;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:#f2efe9; font-family:'Syne',sans-serif; cursor:none; }
        a, button, input { cursor:none; }
        input::placeholder { color:rgba(17,17,17,0.22); }
        input:-webkit-autofill { -webkit-box-shadow:0 0 0 100px #fff inset; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes floatMem { from{opacity:0.55;transform:translateY(0px)} to{opacity:0.75;transform:translateY(-14px)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .fu-1 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .fu-3 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.25s both; }
        .fu-4 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.33s both; }
        .fu-5 { animation: fadeUp 0.75s cubic-bezier(0.22,1,0.36,1) 0.40s both; }
        .fi { animation: fadeIn 1.2s ease 0.1s both; }
        .spinner { width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite; }
        .primary-btn { width:100%;padding:15px 0;background:#111;color:#f2efe9;border:none;border-radius:100px;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;display:flex;align-items:center;justify-content:center;gap:10px;transition:background 0.2s,transform 0.2s,box-shadow 0.2s;margin-top:6px; }
        .primary-btn:not(:disabled):hover { background:#2a2a2a;transform:scale(1.015);box-shadow:0 8px 28px rgba(0,0,0,0.16); }
        .primary-btn:disabled { background:rgba(17,17,17,0.28);cursor:not-allowed; }
        .secondary-link { color:'#111'; font-weight:700; text-decoration:none; border-bottom:1.5px solid rgba(17,17,17,0.22); padding-bottom:1px; transition:border-color 0.2s; }
        .card { background:rgba(250,248,244,0.82);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(17,17,17,0.07);border-radius:24px;padding:clamp(36px,5vh,52px) clamp(32px,4vw,48px);width:100%;max-width:420px;box-shadow:0 2px 4px rgba(0,0,0,0.04),0 12px 40px rgba(0,0,0,0.08),0 32px 80px rgba(0,0,0,0.06); }
      `}</style>

      <Cursor />

      <div style={{ position: 'fixed', inset: 0, background: '#f2efe9', zIndex: -1 }} />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 70% 60% at 50% 44%,rgba(200,185,160,0.22) 0%,transparent 100%)',
        }}
      />

      <div className={loaded ? 'fi' : ''} style={{ opacity: loaded ? undefined : 0 }}>
        <FloatingMemories />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 10,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          className={loaded ? 'fu-1' : ''}
          style={{ opacity: loaded ? undefined : 0, marginBottom: 28, textAlign: 'center' }}
        >
          <a
            href="/"
            style={{
              fontFamily: "'Syne',sans-serif",
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.05em',
              color: '#111',
              textDecoration: 'none',
            }}
          >
            gathrd
          </a>
        </div>

        <div className={`card ${loaded ? 'fu-2' : ''}`} style={{ opacity: loaded ? undefined : 0 }}>
          <div style={{ marginBottom: 30, textAlign: 'center' }}>
            <h1
              style={{
                fontFamily: "'Instrument Serif',serif",
                fontSize: 'clamp(26px,3vw,34px)',
                fontWeight: 400,
                fontStyle: 'italic',
                color: '#111',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                marginBottom: 8,
              }}
            >
              Reset your password.
            </h1>
            <p
              style={{
                fontFamily: "'Syne',sans-serif",
                fontSize: 13,
                color: 'rgba(17,17,17,0.38)',
                letterSpacing: '0.01em',
              }}
            >
              Choose a new password and get back to your memories
            </p>
          </div>

          {email && (
            <div
              className={loaded ? 'fu-3' : ''}
              style={{
                opacity: loaded ? undefined : 0,
                marginBottom: 18,
                background: 'rgba(17,17,17,0.03)',
                border: '1.5px solid rgba(17,17,17,0.08)',
                color: 'rgba(17,17,17,0.55)',
                padding: '12px 14px',
                borderRadius: 10,
                fontFamily: "'Syne',sans-serif",
                fontSize: 12,
                textAlign: 'center',
                wordBreak: 'break-word',
              }}
            >
              Resetting account: <span style={{ color: '#111', fontWeight: 600 }}>{email}</span>
            </div>
          )}

          {error && (
            <div
              style={{
                background: 'rgba(220,38,38,0.06)',
                border: '1.5px solid rgba(220,38,38,0.18)',
                color: '#dc2626',
                padding: '11px 14px',
                borderRadius: 10,
                fontFamily: "'Syne',sans-serif",
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 20,
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                background: 'rgba(22,163,74,0.06)',
                border: '1.5px solid rgba(22,163,74,0.18)',
                color: '#15803d',
                padding: '11px 14px',
                borderRadius: 10,
                fontFamily: "'Syne',sans-serif",
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 20,
                textAlign: 'center',
              }}
            >
              {success}
            </div>
          )}

          {invalidLink ? (
            <div className={loaded ? 'fu-4' : ''} style={{ opacity: loaded ? undefined : 0 }}>
              <div
                style={{
                  background: 'rgba(17,17,17,0.03)',
                  border: '1.5px solid rgba(17,17,17,0.08)',
                  color: 'rgba(17,17,17,0.6)',
                  padding: '14px 16px',
                  borderRadius: 10,
                  fontFamily: "'Syne',sans-serif",
                  fontSize: 13,
                  marginBottom: 20,
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}
              >
                This reset link is invalid, incomplete, or expired.
              </div>

              <button
                type="button"
                className="primary-btn"
                onClick={() => router.push('/forgot-password')}
              >
                Request new link →
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className={loaded ? 'fu-3' : ''} style={{ opacity: loaded ? undefined : 0 }}>
                <Field
                  label="New Password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  showToggle
                  toggled={showPassword}
                  onToggle={() => setShowPassword((prev) => !prev)}
                />
              </div>

              <div className={loaded ? 'fu-4' : ''} style={{ opacity: loaded ? undefined : 0 }}>
                <Field
                  label="Confirm Password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  showToggle
                  toggled={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((prev) => !prev)}
                />
              </div>

              <div
                style={{
                  marginBottom: 14,
                  marginTop: 8,
                  background: 'rgba(17,17,17,0.03)',
                  border: '1.5px solid rgba(17,17,17,0.08)',
                  borderRadius: 10,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'Syne',sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'rgba(17,17,17,0.35)',
                    marginBottom: 8,
                  }}
                >
                  Password checks
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  <div
                    style={{
                      fontFamily: "'Syne',sans-serif",
                      fontSize: 12,
                      color: passwordChecks.minLength ? '#15803d' : 'rgba(17,17,17,0.42)',
                    }}
                  >
                    {passwordChecks.minLength ? '✓' : '•'} At least 6 characters
                  </div>
                  <div
                    style={{
                      fontFamily: "'Syne',sans-serif",
                      fontSize: 12,
                      color: passwordChecks.matches ? '#15803d' : 'rgba(17,17,17,0.42)',
                    }}
                  >
                    {passwordChecks.matches ? '✓' : '•'} Passwords match
                  </div>
                </div>
              </div>

              <div className={loaded ? 'fu-5' : ''} style={{ opacity: loaded ? undefined : 0, marginTop: 22 }}>
                <button type="submit" disabled={loading} className="primary-btn">
                  {loading ? <><span className="spinner" /> Updating…</> : 'Reset password →'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div
          style={{
            marginTop: 24,
            textAlign: 'center',
            fontFamily: "'Syne',sans-serif",
            fontSize: 13,
            color: 'rgba(17,17,17,0.38)',
          }}
        >
          Remember your password?{' '}
          <a
            href="/login"
            style={{
              color: '#111',
              fontWeight: 700,
              textDecoration: 'none',
              borderBottom: '1.5px solid rgba(17,17,17,0.22)',
              paddingBottom: 1,
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#111')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(17,17,17,0.22)')}
          >
            Sign In
          </a>
        </div>
      </div>
    </>
  );
}