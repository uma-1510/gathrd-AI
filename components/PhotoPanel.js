// components/PhotoPanel.js
// Slide-in right panel replacing the lightbox in gallery.
// Shows full intelligence: score breakdown, AI description,
// people, location, caption generator.
'use client';
import { useState } from 'react';
import { scoreTier } from '@/lib/scoring';

export default function PhotoPanel({ photo, onClose, onLocationSave }) {
  const [tab, setTab]             = useState('info');    // 'info' | 'caption'
  const [platform, setPlatform]   = useState('instagram');
  const [caption, setCaption]     = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied]       = useState(false);

  if (!photo) return null;

  const tier = scoreTier(photo.content_score || 0);

  const scoreFactors = [
    { label: 'Emotion',    value: photo.dominant_emotion || 'none', positive: ['happy','excited','surprised'].includes(photo.dominant_emotion) },
    { label: 'Faces',      value: `${photo.face_count || 0} detected`, positive: (photo.face_count || 0) > 0 },
    { label: 'Resolution', value: photo.width && photo.height ? `${Math.round((photo.width * photo.height) / 1_000_000 * 10) / 10} MP` : 'unknown', positive: (photo.width * photo.height) > 2_000_000 },
    { label: 'Location',   value: photo.place_name || 'none', positive: !!photo.place_name },
    { label: 'People',     value: photo.people?.length > 0 ? photo.people.join(', ') : 'untagged', positive: photo.people?.length > 0 },
  ];

  const generateCaption = async () => {
    setGenerating(true);
    setCaption('');
    try {
      const res = await fetch('/api/photos/caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: photo.id, platform }),
      });
      const data = await res.json();
      setCaption(data.caption || 'Could not generate caption.');
    } catch {
      setCaption('Something went wrong. Try again.');
    }
    setGenerating(false);
  };

  const copyCaption = () => {
    navigator.clipboard.writeText(caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <style>{`
        .panel-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          z-index: 2000;
          display: flex; justify-content: flex-end;
        }
        .panel-body {
          width: min(480px, 100vw);
          height: 100vh;
          background: #faf8f4;
          display: flex; flex-direction: column;
          box-shadow: -8px 0 40px rgba(0,0,0,0.15);
          animation: slideInRight 0.25s cubic-bezier(0.22,1,0.36,1) both;
          overflow-y: auto;
        }
        @keyframes slideInRight {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .panel-tab {
          flex: 1; padding: 10px; background: transparent;
          border: none; border-bottom: 2px solid transparent;
          font-family: 'Syne', sans-serif; font-size: 12px;
          font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: rgba(17,17,17,0.4);
          cursor: pointer; transition: color 0.15s, border-color 0.15s;
        }
        .panel-tab.active {
          color: #111; border-bottom-color: #111;
        }
        .factor-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid rgba(17,17,17,0.06);
          font-family: 'Syne', sans-serif; font-size: 12px;
        }
        .factor-label { color: rgba(17,17,17,0.45); }
        .factor-value { font-weight: 600; color: #111; max-width: 220px; text-align: right; word-break: break-word; }
        .caption-area {
          width: 100%; min-height: 120px;
          background: rgba(17,17,17,0.04);
          border: 1px solid rgba(17,17,17,0.1);
          border-radius: 10px; padding: 12px;
          font-family: 'Syne', sans-serif; font-size: 13px;
          color: #111; line-height: 1.6; resize: none;
        }
        .platform-btn {
          padding: 7px 14px; border-radius: 100px;
          border: 1px solid rgba(17,17,17,0.12);
          font-family: 'Syne', sans-serif; font-size: 11px;
          font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; cursor: pointer;
          transition: all 0.15s;
          background: transparent; color: rgba(17,17,17,0.5);
        }
        .platform-btn.active {
          background: #111; color: #f2efe9; border-color: #111;
        }
      `}</style>

      <div className="panel-overlay" onClick={onClose}>
        <div className="panel-body" onClick={e => e.stopPropagation()}>

          {/* Image */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img
              src={photo.url}
              alt=""
              style={{ width: '100%', maxHeight: 320, objectFit: 'cover', display: 'block' }}
            />
            <button
              onClick={onClose}
              style={{
                position: 'absolute', top: 12, right: 12,
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)', border: 'none',
                color: 'white', fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>

            {/* Score badge */}
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              background: tier.bg, border: `1px solid ${tier.color}`,
              borderRadius: 100, padding: '5px 12px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: tier.color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {tier.label}
              </span>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 800, color: tier.color }}>
                {photo.content_score || 0}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(17,17,17,0.08)', flexShrink: 0 }}>
            <button className={`panel-tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>
              Intelligence
            </button>
            <button className={`panel-tab${tab === 'caption' ? ' active' : ''}`} onClick={() => setTab('caption')}>
              Caption
            </button>
          </div>

          {/* Tab: Intelligence */}
          {tab === 'info' && (
            <div style={{ padding: '20px 20px 32px', flex: 1 }}>

              {/* AI description */}
              {photo.ai_description && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 8 }}>
                    What AI sees
                  </p>
                  <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 15, fontStyle: 'italic', color: '#111', lineHeight: 1.6, margin: 0 }}>
                    {photo.ai_description}
                  </p>
                </div>
              )}

              {/* Score breakdown */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 8 }}>
                  Score breakdown
                </p>
                {scoreFactors.map(f => (
                  <div className="factor-row" key={f.label}>
                    <span className="factor-label">{f.label}</span>
                    <span className="factor-value" style={{ color: f.positive ? '#16a34a' : f.value === 'none' || f.value === 'untagged' ? '#9ca3af' : '#111' }}>
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Meta */}
              <div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 8 }}>
                  Details
                </p>
                {photo.date_taken && (
                  <div className="factor-row">
                    <span className="factor-label">Date taken</span>
                    <span className="factor-value">{new Date(photo.date_taken).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                )}
                {photo.camera_make && (
                  <div className="factor-row">
                    <span className="factor-label">Camera</span>
                    <span className="factor-value">{photo.camera_make} {photo.camera_model || ''}</span>
                  </div>
                )}
                {photo.place_name && (
                  <div className="factor-row">
                    <span className="factor-label">Location</span>
                    <span className="factor-value">{photo.place_name}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab: Caption generator */}
          {tab === 'caption' && (
            <div style={{ padding: '20px 20px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

              <div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 10 }}>
                  Platform
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['instagram', 'linkedin', 'twitter', 'threads'].map(p => (
                    <button
                      key={p}
                      className={`platform-btn${platform === p ? ' active' : ''}`}
                      onClick={() => { setPlatform(p); setCaption(''); }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={generateCaption}
                disabled={generating}
                style={{
                  padding: '12px', background: generating ? 'rgba(17,17,17,0.15)' : '#111',
                  color: '#f2efe9', border: 'none', borderRadius: 12,
                  fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700,
                  cursor: generating ? 'not-allowed' : 'pointer',
                }}
              >
                {generating ? 'Generating…' : `Generate ${platform} caption`}
              </button>

              {caption && (
                <>
                  <textarea
                    className="caption-area"
                    value={caption}
                    onChange={e => setCaption(e.target.value)}
                    rows={6}
                  />
                  <button
                    onClick={copyCaption}
                    style={{
                      padding: '10px', background: copied ? '#16a34a' : 'rgba(17,17,17,0.06)',
                      color: copied ? 'white' : '#111',
                      border: '1px solid rgba(17,17,17,0.12)', borderRadius: 10,
                      fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {copied ? '✓ Copied!' : 'Copy to clipboard'}
                  </button>
                </>
              )}

              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.35)', lineHeight: 1.6, margin: 0 }}>
                Caption is generated from your photo's AI description, detected emotion, location, and tagged people.
              </p>
            </div>
          )}

        </div>
      </div>
    </>
  );
}