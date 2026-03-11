'use client';

import { useState, useEffect } from 'react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';

export default function Home() {
  // ── Original state & data fetching — untouched ──
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/photos')
      .then(res => res.json())
      .then(data => { if (data.photos) setPhotos(data.photos); });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');

        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }

        @keyframes fadeUp {
          from { opacity:0; transform:translateY(16px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }

        .fu-1 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .fu-3 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.25s both; }
        .fu-4 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.35s both; }

        .photo-card {
          height: 260px;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid rgba(17,17,17,0.07);
          transition: transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s;
          cursor: pointer;
          background: rgba(17,17,17,0.04);
        }
        .photo-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 20px 48px rgba(0,0,0,0.12);
        }
        .photo-card img {
          width:100%; height:100%; object-fit:cover; display:block;
          transition: transform 0.4s cubic-bezier(0.22,1,0.36,1);
        }
        .photo-card:hover img { transform: scale(1.04); }

        .action-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 26px;
          border: none; border-radius: 100px;
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 700;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .action-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        }
        .action-btn-primary {
          background: #111; color: #f2efe9;
        }
        .action-btn-secondary {
          background: rgba(17,17,17,0.06);
          border: 1.5px solid rgba(17,17,17,0.12);
          color: #111;
        }
        .action-btn-secondary:hover {
          background: rgba(17,17,17,0.09);
        }

        .empty-state {
          text-align: center;
          padding: 80px 24px;
          animation: fadeIn 0.8s ease 0.2s both;
        }
        .empty-icon {
          width: 72px; height: 72px; border-radius: 20px;
          background: rgba(17,17,17,0.05);
          border: 1.5px solid rgba(17,17,17,0.08);
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; margin: 0 auto 24px;
        }

        /* Lightbox */
        .lightbox {
          position: fixed; inset:0;
          background: rgba(10,8,6,0.92);
          z-index: 2000;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          animation: fadeIn 0.2s ease both;
        }
        .lightbox-inner {
          position: relative;
          max-width: 95vw; max-height: 90vh;
          border-radius: 16px; overflow: hidden;
          box-shadow: 0 40px 80px rgba(0,0,0,0.5);
          animation: fadeUp 0.3s cubic-bezier(0.22,1,0.36,1) both;
        }
        .lightbox-close {
          position: absolute; top: 14px; right: 14px;
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(242,239,233,0.15);
          border: 1px solid rgba(242,239,233,0.2);
          color: #f2efe9; font-size: 18px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background 0.18s;
          font-family: 'Syne', sans-serif;
        }
        .lightbox-close:hover { background: rgba(242,239,233,0.25); }
      `}</style>

      <Header />
      <Sidebar />

      {/* ── Original layout structure preserved ── */}
      <main style={{
        marginLeft: '240px',
        marginTop: '62px',
        padding: '40px 36px',
        minHeight: 'calc(100vh - 62px)',
        transition: 'margin-left 0.28s ease',
        background: '#f2efe9',
      }}>

        {/* Page header */}
        <div className={loaded ? 'fu-1' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 40 }}>
          <p style={{
            fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'rgba(17,17,17,0.35)', marginBottom: 8,
          }}>Your gallery</p>
          <h1 style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: 'clamp(28px, 3.5vw, 44px)',
            fontWeight: 400, fontStyle: 'italic',
            color: '#111', lineHeight: 1.12, letterSpacing: '-0.02em',
            marginBottom: 10,
          }}>
            Welcome back.
          </h1>
          <p style={{
            fontFamily: "'Syne', sans-serif", fontSize: 14,
            color: 'rgba(17,17,17,0.45)', maxWidth: 480, lineHeight: 1.7,
          }}>
            Organize, discover, and share your memories with AI-powered features.
          </p>
        </div>

        {/* ── Original conditional: photos or empty state ── */}
        {photos.length > 0 ? (
          <>
            {/* Photo grid — original map, original onClick */}
            <div
              className={loaded ? 'fu-2' : ''}
              style={{
                opacity: loaded ? undefined : 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '18px',
              }}
            >
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="photo-card"
                  onClick={() => setSelectedPhoto(photo)}
                >
                  <img src={photo.url} alt="" />
                </div>
              ))}
            </div>

            {/* Action buttons — original onClick handlers preserved (no-op currently) */}
            <div
              className={loaded ? 'fu-3' : ''}
              style={{ opacity: loaded ? undefined : 0, marginTop: 36, display: 'flex', gap: 12, flexWrap: 'wrap' }}
            >
              <button className="action-btn action-btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Create Album
              </button>
              <button className="action-btn action-btn-secondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
                Share Album
              </button>
            </div>
          </>
        ) : (
          // Original empty state — link to /gallery preserved
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <p style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 22, fontStyle: 'italic',
              color: 'rgba(17,17,17,0.5)', marginBottom: 10,
            }}>No photos yet</p>
            <p style={{
              fontFamily: "'Syne', sans-serif", fontSize: 13,
              color: 'rgba(17,17,17,0.38)', lineHeight: 1.7,
            }}>
              Go to{' '}
              <a href="/gallery" style={{
                color: '#111', fontWeight: 700,
                textDecoration: 'none',
                borderBottom: '1.5px solid rgba(17,17,17,0.25)',
                paddingBottom: 1,
              }}>Gallery</a>
              {' '}to upload your first photo
            </p>
          </div>
        )}
      </main>

      {/* ── Lightbox — original onClick logic preserved exactly ── */}
      {selectedPhoto && (
        <div
          className="lightbox"
          onClick={() => setSelectedPhoto(null)}
        >
          <div
            className="lightbox-inner"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedPhoto.url}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', display: 'block' }}
            />
            <button
              className="lightbox-close"
              onClick={() => setSelectedPhoto(null)}
            >✕</button>
          </div>
        </div>
      )}
    </>
  );
}