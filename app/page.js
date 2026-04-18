'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';

const MOOD_PALETTE = {
  happy:     { bg: '#fef9ec', accent: '#f59e0b', label: '😊 Happy'     },
  excited:   { bg: '#fff1f2', accent: '#f43f5e', label: '🎉 Exciting'  },
  surprised: { bg: '#f0fdf4', accent: '#22c55e', label: '✨ Surprising' },
  calm:      { bg: '#eff6ff', accent: '#3b82f6', label: '🌿 Calm'      },
  neutral:   { bg: '#f8f7f4', accent: '#9ca3af', label: '📷 Memories'  },
  sad:       { bg: '#f5f3ff', accent: '#8b5cf6', label: '💜 Reflective' },
};

function moodStyle(mood) { return MOOD_PALETTE[mood] ?? MOOD_PALETTE.neutral; }
function photoLabel(n) { const count = parseInt(n, 10) || 0; return `${count} photo${count !== 1 ? 's' : ''}`; }

function MemoryReelCard({ reel, onClick }) {
  return (
    <div onClick={onClick}
      style={{ minWidth: 280, borderRadius: 18, overflow: 'hidden', background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', cursor: 'pointer', transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s', flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = '0 24px 48px rgba(0,0,0,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ height: 210, background: '#111', position: 'relative', overflow: 'hidden' }}>
        <video src={reel.recap_url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} muted playsInline autoPlay loop />
        <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderRadius: 100, padding: '3px 10px', fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 600, color: '#111', letterSpacing: '0.02em' }}>▶ Memory Reel</div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 19, fontStyle: 'italic', color: '#111', marginBottom: 4, lineHeight: 1.2 }}>{reel.title}</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(17,17,17,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{reel.date || 'Memory'}</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.5)', marginBottom: 8 }}>{reel.place_name || 'Memory highlight'}</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.5)' }}>{photoLabel(reel.count)}</div>
      </div>
    </div>
  );
}

function MemoryCard({ memory, onClick }) {
  const palette = moodStyle(memory.dominant_mood);
  return (
    <div onClick={onClick}
      style={{ minWidth: 220, borderRadius: 18, overflow: 'hidden', background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', cursor: 'pointer', transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s', flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = '0 24px 48px rgba(0,0,0,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ height: 160, background: palette.bg, position: 'relative', overflow: 'hidden' }}>
        {memory.cover_url
          ? <img src={memory.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>📷</div>}
        <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderRadius: 100, padding: '3px 10px', fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 600, color: '#111', letterSpacing: '0.02em' }}>
          {moodStyle(memory.dominant_mood).label}
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 17, fontStyle: 'italic', color: '#111', marginBottom: 2, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memory.title}</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(17,17,17,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{memory.date_label}</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.5)' }}>{photoLabel(memory.photo_count)}</div>
      </div>
    </div>
  );
}

function AlbumCard({ album, onPin, router, compact = false }) {
  const [pinning, setPinning] = useState(false);
  const handlePin = async (e) => {
    e.stopPropagation();
    setPinning(true);
    await fetch(`/api/albums/${album.id}/pin`, { method: 'PATCH' });
    onPin?.();
    setPinning(false);
  };
  return (
    <div onClick={() => router.push(`/albums/${album.id}`)}
      style={{ borderRadius: compact ? 14 : 18, overflow: 'hidden', background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', cursor: 'pointer', transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-5px)'; e.currentTarget.style.boxShadow = '0 20px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ height: compact ? 130 : 160, background: 'rgba(17,17,17,0.05)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {album.cover_url
          ? <img src={album.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(17,17,17,0.2)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>}
        <button onClick={handlePin} disabled={pinning} title={album.pinned ? 'Unpin album' : 'Pin to home'}
          style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%', background: album.pinned ? 'rgba(17,17,17,0.85)' : 'rgba(255,255,255,0.75)', backdropFilter: 'blur(8px)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, transition: 'background 0.18s, transform 0.18s', opacity: pinning ? 0.5 : 1 }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          {album.pinned ? '📌' : '📍'}
        </button>
      </div>
      <div style={{ padding: compact ? '10px 12px' : '14px 16px' }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: compact ? 13 : 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
          {album.pinned && <span style={{ color: '#f59e0b', marginRight: 5, fontSize: 11 }}>📌</span>}
          {album.name}
        </div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(17,17,17,0.38)', letterSpacing: '0.06em' }}>{photoLabel(album.photo_count)}</div>
      </div>
    </div>
  );
}

// FIX: removed photo_ids guard — fetch photos by memory id directly
// The /api/memories/[id]/photos route handles the date-range fallback
function MemoryModal({ memory, onClose }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    // FIX: was checking memory?.photo_ids?.length which is never set by /api/home
    // Now just checks memory.id exists and always fetches
    if (!memory?.id) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/memories/${memory.id}/photos`)
      .then(r => r.json())
      .then(d => { if (d.photos) setPhotos(d.photos); })
      .catch(err => console.error('Memory photos fetch error:', err))
      .finally(() => setLoading(false));
  }, [memory?.id]);

  if (!memory) return null;
  const palette = moodStyle(memory.dominant_mood);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,0.88)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'fadeIn 0.2s ease both' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860, maxHeight: '90vh', background: '#faf8f4', borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both' }}>
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid rgba(17,17,17,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: palette.bg }}>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: palette.accent, marginBottom: 6 }}>{memory.date_label}</p>
            <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 28, fontWeight: 400, fontStyle: 'italic', color: '#111', lineHeight: 1.1, marginBottom: 6 }}>{memory.title}</h2>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.45)' }}>{photoLabel(memory.photo_count)} · {moodStyle(memory.dominant_mood).label}</p>
          </div>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(17,17,17,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#111', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)' }}>Loading photos…</div>
          ) : photos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)' }}>No photos found for this memory</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {photos.map(photo => (
                <div key={photo.id} onClick={() => setSelectedPhoto(photo)}
                  style={{ aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedPhoto && (
        <div onClick={() => setSelectedPhoto(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <img src={selectedPhoto.url} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, objectFit: 'contain', display: 'block' }} />
            <button onClick={() => setSelectedPhoto(null)} style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: '50%', background: 'rgba(242,239,233,0.15)', border: 'none', color: '#f2efe9', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReelModal({ reel, onClose }) {
  if (!reel?.recap_url) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,0.92)', zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'fadeIn 0.2s ease both' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#111', borderRadius: 24, overflow: 'hidden', width: '100%', maxWidth: 430, position: 'relative', animation: 'scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both' }}>
        <video src={reel.recap_url} controls autoPlay playsInline style={{ width: '100%', maxHeight: '85vh', display: 'block', background: '#000' }} />
        <div style={{ padding: '14px 16px', background: '#111' }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic', color: '#f2efe9', marginBottom: 4 }}>{reel.title}</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(242,239,233,0.65)' }}>{reel.date || 'Memory'} · {reel.place_name || 'Memory highlight'}</div>
        </div>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: '50%', background: 'rgba(242,239,233,0.15)', border: 'none', color: '#f2efe9', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
      <div>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 4 }}>{eyebrow}</p>
        <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(20px, 2.5vw, 26px)', fontWeight: 400, fontStyle: 'italic', color: '#111', lineHeight: 1.1 }}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function StatChip({ emoji, value, label }) {
  return (
    <div style={{ background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', borderRadius: 14, padding: '16px 20px', minWidth: 100 }}>
      <div style={{ fontSize: 22, marginBottom: 8 }}>{emoji}</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: '#111', lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(17,17,17,0.38)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

// ── Inner component that uses useSearchParams ─────────────────────────────────
function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [memoryReels, setMemoryReels] = useState([]);
  const [selectedReel, setSelectedReel] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newAlbum, setNewAlbum] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  const [showShare, setShowShare] = useState(false);
  const [shareAlbumId, setShareAlbumId] = useState('');
  const [shareUsername, setShareUsername] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState('');

  useEffect(() => { const t = setTimeout(() => setLoaded(true), 60); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (searchParams.get('create') === 'true') setShowCreate(true);
    if (searchParams.get('share') === 'true') setShowShare(true);
  }, [searchParams]);

  const fetchHome = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/home');
      const d = await res.json();
      if (!d.error) setData(d);
    } catch (e) { console.error('Home fetch failed:', e); }
    finally { setLoading(false); }
  };

  const fetchMemoryReels = async () => {
    try {
      const res = await fetch('/api/memory-highlights');
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { console.error('Memory reels fetch failed:', d.error); return; }
      setMemoryReels((d.highlights || []).filter(item => item.has_recap && item.recap_url));
    } catch (e) { console.error('Memory reels fetch error:', e); }
  };

  useEffect(() => { fetchHome(); fetchMemoryReels(); }, []);

  const handleCreate = async () => {
    if (!newAlbum.name.trim()) return;
    setCreating(true); setCreateMsg('');
    const res = await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAlbum) });
    const d = await res.json();
    if (d.album) {
      setCreateMsg('✓ Album created!');
      setNewAlbum({ name: '', description: '' });
      setTimeout(() => { setShowCreate(false); setCreateMsg(''); fetchHome(); }, 800);
    } else { setCreateMsg('✗ ' + (d.error ?? 'Something went wrong')); }
    setCreating(false);
  };

  const handleShare = async () => {
    if (!shareUsername.trim() || !shareAlbumId) return;
    setSharing(true); setShareMsg('');
    const res = await fetch('/api/share/album', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ albumId: shareAlbumId, shareWith: shareUsername.trim() }) });
    const d = await res.json();
    if (res.ok) { setShareMsg(`✓ Shared with ${shareUsername}`); setShareUsername(''); }
    else { setShareMsg('✗ ' + (d.error ?? 'Something went wrong')); }
    setSharing(false);
  };

  const stats = data?.stats ?? {};
  const memories = data?.memories ?? [];
  const pinnedAlbums = data?.pinnedAlbums ?? [];
  const recentAlbums = data?.recentAlbums ?? [];
  const pinnedIds = new Set(pinnedAlbums.map(a => a.id));
  const unpinnedRecent = recentAlbums.filter(a => !pinnedIds.has(a.id));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96) translateY(-8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes shimmer { from { background-position: -400px 0; } to { background-position: 400px 0; } }
        .fu-1 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .fu-3 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.25s both; }
        .fu-4 { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.35s both; }
        .memory-strip { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; -ms-overflow-style: none; scrollbar-width: none; }
        .memory-strip::-webkit-scrollbar { display: none; }
        .btn { display: inline-flex; align-items: center; gap: 7px; padding: 11px 22px; border-radius: 100px; border: none; cursor: pointer; font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; transition: transform 0.18s, box-shadow 0.18s, background 0.18s; }
        .btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.1); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-primary { background: #111; color: #f2efe9; }
        .btn-ghost { background: rgba(17,17,17,0.06); color: #111; border: 1.5px solid rgba(17,17,17,0.12); }
        .btn-ghost:hover { background: rgba(17,17,17,0.1); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(10,8,6,0.6); backdrop-filter: blur(6px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.2s ease both; }
        .modal-card { background: #faf8f4; border-radius: 24px; padding: 32px; width: 100%; max-width: 440px; animation: scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both; }
        .modal-title { font-family: 'Instrument Serif', serif; font-size: 24px; font-weight: 400; font-style: italic; color: #111; margin-bottom: 24px; }
        .field { margin-bottom: 18px; }
        .field-label { display: block; font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(17,17,17,0.45); margin-bottom: 8px; }
        .field-input, .field-textarea, .field-select { width: 100%; padding: 12px 16px; background: rgba(17,17,17,0.04); border: 1.5px solid rgba(17,17,17,0.12); border-radius: 12px; outline: none; font-family: 'Syne', sans-serif; font-size: 13px; color: #111; transition: border-color 0.2s, background 0.2s; }
        .field-input:focus, .field-textarea:focus, .field-select:focus { border-color: rgba(17,17,17,0.5); background: #fff; }
        .field-textarea { resize: vertical; min-height: 80px; }
        .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
        .skeleton { background: linear-gradient(90deg, rgba(17,17,17,0.06) 25%, rgba(17,17,17,0.1) 50%, rgba(17,17,17,0.06) 75%); background-size: 400px 100%; animation: shimmer 1.4s infinite; border-radius: 14px; }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft: '240px', marginTop: '62px', padding: '40px 36px', minHeight: 'calc(100vh - 62px)', background: '#f2efe9' }}>

        <div className={loaded ? 'fu-1' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 8 }}>Your gallery</p>
              <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 400, fontStyle: 'italic', color: '#111', lineHeight: 1.12, letterSpacing: '-0.02em' }}>Welcome back.</h1>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Album
              </button>
              <button className="btn btn-ghost" onClick={() => setShowShare(true)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                Share Album
              </button>
            </div>
          </div>
        </div>

        <div className={loaded ? 'fu-2' : ''} style={{ opacity: loaded ? undefined : 0, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 48 }}>
          {loading ? [1,2,3,4].map(i => <div key={i} className="skeleton" style={{ width: 120, height: 88 }} />) : (
            <>
              <StatChip emoji="📷" value={stats.total_photos ?? 0} label="Photos" />
              <StatChip emoji="🗂️" value={stats.total_albums ?? 0} label="Albums" />
              <StatChip emoji="✨" value={stats.total_memories ?? 0} label="Memories" />
              <StatChip emoji="🆕" value={stats.photos_this_month ?? 0} label="This month" />
            </>
          )}
        </div>

        <section className={loaded ? 'fu-3' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 52 }}>
          <SectionHeading eyebrow="Auto-generated" title="Memory Reels" />
          {memoryReels.length === 0 ? (
            <div style={{ background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', borderRadius: 18, padding: '40px 32px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🎞️</div>
              <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontStyle: 'italic', color: 'rgba(17,17,17,0.5)', marginBottom: 8 }}>No memory reels yet</p>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)' }}>Once your recap videos are generated, they will appear here</p>
            </div>
          ) : (
            <div className="memory-strip">
              {memoryReels.map(reel => <MemoryReelCard key={reel.id} reel={reel} onClick={() => setSelectedReel(reel)} />)}
            </div>
          )}
        </section>

        <section className={loaded ? 'fu-3' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 52 }}>
          <SectionHeading eyebrow="Auto-generated" title="Memory Timeline"
            action={memories.length > 0 && <button className="btn btn-ghost" style={{ padding: '8px 18px', fontSize: 11 }} onClick={() => router.push('/gallery')}>View all photos →</button>}
          />
          {loading ? (
            <div style={{ display: 'flex', gap: 16 }}>{[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ minWidth: 220, height: 240 }} />)}</div>
          ) : memories.length === 0 ? (
            <div style={{ background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', borderRadius: 18, padding: '40px 32px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
              <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontStyle: 'italic', color: 'rgba(17,17,17,0.5)', marginBottom: 8 }}>No memories yet</p>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)' }}>Upload photos to the gallery and your memories will appear here</p>
              <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => router.push('/gallery')}>Go to Gallery</button>
            </div>
          ) : (
            <div className="memory-strip">
              {memories.map(memory => <MemoryCard key={memory.id} memory={memory} onClick={() => setSelectedMemory(memory)} />)}
            </div>
          )}
        </section>

        {(loading || pinnedAlbums.length > 0) && (
          <section className={loaded ? 'fu-4' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 52 }}>
            <SectionHeading eyebrow="Pinned" title="Favourite Albums"
              action={<button className="btn btn-ghost" style={{ padding: '8px 18px', fontSize: 11 }} onClick={() => router.push('/albums')}>All albums →</button>}
            />
            {loading ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 210 }} />)}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {pinnedAlbums.map(album => <AlbumCard key={album.id} album={album} router={router} onPin={fetchHome} />)}
              </div>
            )}
          </section>
        )}

        <section className={loaded ? 'fu-4' : ''} style={{ opacity: loaded ? undefined : 0, marginBottom: 52 }}>
          <SectionHeading eyebrow="Recently updated" title="Your Albums"
            action={<button className="btn btn-ghost" style={{ padding: '8px 18px', fontSize: 11 }} onClick={() => router.push('/albums')}>Manage albums →</button>}
          />
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ height: 190 }} />)}
            </div>
          ) : unpinnedRecent.length === 0 && pinnedAlbums.length === 0 ? (
            <div style={{ background: '#faf8f4', border: '1px solid rgba(17,17,17,0.07)', borderRadius: 18, padding: '40px 32px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗂️</div>
              <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontStyle: 'italic', color: 'rgba(17,17,17,0.5)', marginBottom: 8 }}>No albums yet</p>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)' }}>Create an album to organise your photos</p>
              <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => setShowCreate(true)}>Create your first album</button>
            </div>
          ) : unpinnedRecent.length === 0 ? (
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)', padding: '20px 0' }}>All your albums are pinned above ✨</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              {unpinnedRecent.map(album => <AlbumCard key={album.id} album={album} router={router} onPin={fetchHome} compact />)}
            </div>
          )}
        </section>
      </main>

      {selectedMemory && <MemoryModal memory={selectedMemory} onClose={() => setSelectedMemory(null)} />}
      {selectedReel && <ReelModal reel={selectedReel} onClose={() => setSelectedReel(null)} />}

      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Create new album</h2>
            <div className="field">
              <label className="field-label">Album name *</label>
              <input className="field-input" type="text" value={newAlbum.name} onChange={e => setNewAlbum({ ...newAlbum, name: e.target.value })} placeholder="e.g. Summer 2025" onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Description (optional)</label>
              <textarea className="field-textarea" value={newAlbum.description} onChange={e => setNewAlbum({ ...newAlbum, description: e.target.value })} placeholder="What's this album about?" rows={3} />
            </div>
            {createMsg && <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600, color: createMsg.startsWith('✓') ? '#2d8a5e' : '#c0392b', marginBottom: 8 }}>{createMsg}</p>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setNewAlbum({ name:'', description:'' }); setCreateMsg(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newAlbum.name.trim()}>{creating ? 'Creating…' : 'Create album'}</button>
            </div>
          </div>
        </div>
      )}

      {showShare && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Share an album</h2>
            <div className="field">
              <label className="field-label">Album</label>
              <select className="field-select" value={shareAlbumId} onChange={e => setShareAlbumId(e.target.value)}>
                <option value="">Choose an album…</option>
                {[...pinnedAlbums, ...unpinnedRecent].map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Share with username</label>
              <input className="field-input" type="text" value={shareUsername} onChange={e => { setShareUsername(e.target.value); setShareMsg(''); }} placeholder="Enter username…" onKeyDown={e => { if (e.key === 'Enter') handleShare(); }} />
            </div>
            {shareMsg && <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600, color: shareMsg.startsWith('✓') ? '#2d8a5e' : '#c0392b', marginBottom: 8 }}>{shareMsg}</p>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setShowShare(false); setShareUsername(''); setShareAlbumId(''); setShareMsg(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleShare} disabled={sharing || !shareUsername.trim() || !shareAlbumId}>{sharing ? 'Sharing…' : 'Share'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Default export wraps with Suspense (required for useSearchParams in Next.js 15+)
export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}