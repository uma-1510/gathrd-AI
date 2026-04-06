'use client';

import { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';
import PhotoPanel from '@/components/PhotoPanel';


const EMOTION_EMOJI = {
  happy: '😊', excited: '🎉', surprised: '😮',
  calm: '😌', neutral: '😐', sad: '😢',
  fearful: '😨', angry: '😠', disgusted: '🤢',
};

export default function Gallery() {
  const [photos, setPhotos]           = useState([]);
  const [selectedPhoto, setSelected]  = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setStatus]     = useState('');
  const [selectMode, setSelectMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting]       = useState(false);
  const [shareUsername, setShareUser] = useState('');
  const [sharing, setSharing]         = useState(false);
  const [shareMsg, setShareMsg]       = useState('');
  const [modelsLoaded, setModels]     = useState(false);
  const [filterMode, setFilterMode]           = useState(null);

  // Re-analsis state
  const [reanalyzing, setReanalyzing]             = useState(false);
  const [reanalyzeMsg, setReanalyzeMsg]           = useState('');
  const [reanalyzeProgress, setReanalyzeProgress] = useState(null);

  // Location edit state
  const [editingLocation, setEditingLocation] = useState(null);
  const [locationInput, setLocationInput]     = useState('');
  const [savingLocation, setSavingLocation]   = useState(false);

const displayPhotos = filterMode === 'top'
  ? photos.filter(p => (p.content_score || 0) >= 80)
  : photos;

  useEffect(() => { fetchPhotos(); }, []);

  // ── Load ALL four face-api models including faceExpressionNet ─────────────
  useEffect(() => {
    Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      faceapi.nets.faceExpressionNet.loadFromUri('/models'),
    ])
      .then(() => setModels(true))
      .catch(() => setModels(true));
  }, []);

  const fetchPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.photos) setPhotos(data.photos);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} photo(s)? This cannot be undone.`)) return;
    setDeleting(true);
    await Promise.all([...selectedIds].map(id =>
      fetch(`/api/photos/${id}`, { method: 'DELETE' })
    ));
    setSelectMode(false);
    setSelectedIds(new Set());
    await fetchPhotos();
    setDeleting(false);
  };

  const handleShare = async () => {
    if (!shareUsername.trim() || !selectedPhoto) return;
    setSharing(true);
    setShareMsg('');
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: selectedPhoto.id, shareWith: shareUsername.trim() }),
    });
    const data = await res.json();
    setShareMsg(res.ok ? `✓ Shared with @${shareUsername.trim()}` : `✗ ${data.error}`);
    if (res.ok) setShareUser('');
    setSharing(false);
  };

  const handleReanalyze = async () => {
    if (!modelsLoaded || reanalyzing) return;
    setReanalyzing(true);
    setReanalyzeMsg('');
    setReanalyzeProgress(null);

    const toProcess = photos.filter(p => !p.dominant_emotion || p.dominant_emotion === 'neutral');
    let done = 0;

    for (const photo of toProcess) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = photo.url; });
        const detections = await faceapi
          .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceExpressions();
        if (detections.length > 0) {
          const expressions = detections[0].expressions;
          const dominant = Object.entries(expressions).sort((a, b) => b[1] - a[1])[0][0];
          await fetch(`/api/photos/${photo.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dominant_emotion: dominant }),
          });
        }
      } catch {}
      done++;
      setReanalyzeProgress({ done, total: toProcess.length });
    }

    setReanalyzeMsg(`✓ Done — ${toProcess.length} photos processed`);
    setReanalyzing(false);
    await fetchPhotos();
  };

  const handleSaveLocation = async () => {
    if (!editingLocation || !selectedPhoto) return;
    setSavingLocation(true);
    try {
      await fetch(`/api/photos/${selectedPhoto.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_name: locationInput.trim() }),
      });
      setSelected(prev => prev ? { ...prev, place_name: locationInput.trim() } : prev);
      await fetchPhotos();
      setEditingLocation(null);
      setLocationInput('');
    } catch (err) {
      console.error('Save location error:', err);
    }
    setSavingLocation(false);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch { return null; }
  };

  const closeLightbox = () => {
    setSelected(null);
    setEditingLocation(null);
    setLocationInput('');
    setShareMsg('');
    setShareUser('');
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }

        @keyframes fadeUp  { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96) translateY(-8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes spin    { to { transform: rotate(360deg); } }

        .fu-1 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.14s both; }

        .btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 11px 22px; border-radius: 100px; border: none; cursor: pointer;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          transition: transform 0.18s, box-shadow 0.18s, background 0.18s;
        }
        .btn:hover    { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.1); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-primary  { background: #111; color: #f2efe9; }
        .btn-ghost    { background: rgba(17,17,17,0.06); color: #111; border: 1.5px solid rgba(17,17,17,0.12); }
        .btn-ghost:hover { background: rgba(17,17,17,0.1); }
        .btn-danger   { background: rgba(220,38,38,0.07); color: #c0392b; border: 1.5px solid rgba(220,38,38,0.18); }
        .btn-danger:hover { background: rgba(220,38,38,0.12); }
        .btn-sm { padding: 7px 14px; font-size: 11px; }

        .reanalyze-status {
          padding: 10px 16px; border-radius: 10px; font-family: 'Syne', sans-serif;
          font-size: 12px; font-weight: 600; margin-bottom: 20px;
        }
        .reanalyze-status.ok  { background: rgba(17,17,17,0.05); color: rgba(17,17,17,0.6); border: 1px solid rgba(17,17,17,0.1); }
        .reanalyze-status.err { background: rgba(220,38,38,0.06); color: #c0392b; border: 1px solid rgba(220,38,38,0.15); }

        .lightbox-meta-row {
          padding: 6px 16px;
          border-bottom: 1px solid rgba(17,17,17,0.07);
          background: #faf8f4;
          font-family: 'Syne', sans-serif;
          font-size: 12px; color: rgba(17,17,17,0.55);
          display: flex; align-items: center; gap: 8; flex-wrap: wrap;
        }

        .location-input {
          flex: 1; padding: 7px 12px;
          border: 1.5px solid rgba(17,17,17,0.12);
          border-radius: 10px; outline: none;
          font-family: 'Syne', sans-serif; font-size: 12px; color: #111;
          background: rgba(17,17,17,0.03);
          transition: border-color 0.18s;
        }
        .location-input:focus { border-color: rgba(17,17,17,0.4); }

        .share-input {
          flex: 1; padding: 10px 14px;
          border: 1.5px solid rgba(17,17,17,0.12);
          border-radius: 10px; outline: none;
          font-family: 'Syne', sans-serif; font-size: 13px; color: #111;
          background: rgba(17,17,17,0.03);
          transition: border-color 0.18s;
        }
        .share-input:focus { border-color: rgba(17,17,17,0.4); }
        .share-input::placeholder { color: rgba(17,17,17,0.3); }
      `}</style>

      <Header />
      <Sidebar />
      <BottomNav />

      <main style={{
        marginLeft: '240px',
        marginTop: '62px',
        padding: '36px 32px',
        paddingBottom: '90px',
        minHeight: 'calc(100vh - 62px)',
        background: '#f2efe9',
      }}>

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="fu-1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{
              fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'rgba(17,17,17,0.35)', marginBottom: 6,
            }}>
              Your photos
            </p>
            <h1 style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 'clamp(26px, 3.5vw, 40px)',
              fontWeight: 400, fontStyle: 'italic',
              color: '#111', lineHeight: 1.1, letterSpacing: '-0.02em',
            }}>
              Gallery
            </h1>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {modelsLoaded && photos.length > 0 && !selectMode && (
              <button
                className="btn btn-ghost"
                onClick={handleReanalyze}
                disabled={reanalyzing}
              >
                {reanalyzing ? (
                  <>
                    <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #111', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    {reanalyzeProgress ? `${reanalyzeProgress.done}/${reanalyzeProgress.total}` : 'Analysing…'}
                  </>
                ) : '🔍 Re-analyse'}
              </button>
            )}

            {/* ── Top picks filter ─────────────────────────────────────────── */}
{photos.length > 0 && !selectMode && (
  <button
    onClick={() => setFilterMode(filterMode === 'top' ? null : 'top')}
    style={{
      padding: '0.8rem 1.25rem',
      backgroundColor: filterMode === 'top' ? '#111' : 'white',
      color: filterMode === 'top' ? '#f2efe9' : '#374151',
      border: '1px solid #d1d5db',
      borderRadius: '8px', fontWeight: 600, cursor: 'pointer',
    }}
  >
    {filterMode === 'top' ? '✦ Showing top picks' : '✦ Top picks'}
  </button>
)}



            {photos.length > 0 && (
              <button
                className={`btn ${selectMode ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}

            {selectMode && selectedIds.size > 0 && (
              <button
                className="btn btn-danger"
                onClick={handleDeleteSelected}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </button>
            )}
          </div>
        </div>

        {/* ── Re-analyse status ──────────────────────────────────────────── */}
        {reanalyzeMsg && (
          <div className={`reanalyze-status ${reanalyzeMsg.startsWith('✓') ? 'ok' : 'err'}`}>
            {reanalyzeMsg}
          </div>
        )}

        {/* ── Photo grid ────────────────────────────────────────────────── */}
        <div className="fu-2">
          {/* Top picks filter derived from photos array */}
{(() => { var displayPhotos = filterMode === 'top' ? photos.filter(p => (p.content_score || 0) >= 80) : photos; return null; })()}
          {displayPhotos.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
              {displayPhotos.map(photo => (
                <div
                  key={photo.id}
                  onClick={() => {
                    if (selectMode) toggleSelect(photo.id);
                    else { setSelected(photo); setShareMsg(''); setShareUser(''); setEditingLocation(null); setLocationInput(''); }
                  }}
                  style={{
                    aspectRatio: '1/1', borderRadius: '12px', overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: selectedIds.has(photo.id)
                      ? '0 0 0 3px #111'
                      : '0 4px 10px rgba(0,0,0,0.08)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    position: 'relative',
                    opacity: selectedIds.has(photo.id) ? 0.85 : 1,
                  }}
                  onMouseEnter={e => { if (!selectMode) e.currentTarget.style.transform = 'scale(1.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                  {selectMode && (
                    <div style={{
                      position: 'absolute', top: '0.5rem', left: '0.5rem',
                      width: 22, height: 22, borderRadius: '50%',
                      backgroundColor: selectedIds.has(photo.id) ? '#111' : 'rgba(255,255,255,0.85)',
                      border: '2px solid white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selectedIds.has(photo.id) && <span style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>✓</span>}
                    </div>
                  )}

                  {!selectMode && photo.dominant_emotion && photo.dominant_emotion !== 'neutral' && (
                    <div style={{
                      position: 'absolute', bottom: '0.4rem', right: '0.4rem',
                      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                      borderRadius: '100px', padding: '2px 7px',
                      fontSize: 11, color: 'white', fontWeight: 600,
                    }}>
                      {EMOTION_EMOJI[photo.dominant_emotion] ?? ''} {photo.dominant_emotion}
                    </div>
                  )}
                  {!selectMode && photo.dominant_emotion && photo.dominant_emotion !== 'neutral' && (
  <div style={{ position: 'absolute', bottom: '0.4rem', right: '0.4rem', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', borderRadius: '100px', padding: '2px 7px', fontSize: 11, color: 'white', fontWeight: 600 }}>
    {EMOTION_EMOJI[photo.dominant_emotion] ?? ''} {photo.dominant_emotion}
  </div>
)}

{/* ← ADD THIS RIGHT HERE, after the emotion badge */}
{!selectMode && (photo.content_score || 0) >= 80 && (
  <div style={{
    position: 'absolute', top: '0.4rem', left: '0.4rem',
    background: 'rgba(22,163,74,0.9)',
    backdropFilter: 'blur(4px)',
    borderRadius: 100, padding: '2px 8px',
    fontSize: 10, color: 'white', fontWeight: 700,
    letterSpacing: '0.04em',
  }}>
    ✦ Top pick
  </div>
)}

                  {!selectMode && photo.place_name && (
                    <div style={{
                      position: 'absolute',
                      bottom: (photo.dominant_emotion && photo.dominant_emotion !== 'neutral') ? '1.8rem' : '0.4rem',
                      left: '0.4rem', right: '0.4rem',
                      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                      borderRadius: '100px', padding: '2px 7px',
                      fontSize: 10, color: 'white', fontWeight: 600,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      📍 {photo.place_name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              textAlign: 'center', padding: '80px 24px',
              background: '#faf8f4', borderRadius: 18,
              border: '1px solid rgba(17,17,17,0.07)',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
              <p style={{
                fontFamily: "'Instrument Serif', serif",
                fontSize: 20, fontStyle: 'italic',
                color: 'rgba(17,17,17,0.5)', marginBottom: 8,
              }}>
                No photos yet
              </p>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)' }}>
                Upload some memories to get started
              </p>
            </div>
          )}
        </div>
      </main>

      {/* ── Lightbox ────────────────────────────────────────────────────── */}
      {selectedPhoto && (
        <div
          onClick={closeLightbox}
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(10,8,6,0.9)',
            zIndex: 2000, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative', maxWidth: '95vw', maxHeight: '90vh',
              backgroundColor: '#faf8f4', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
              display: 'flex', flexDirection: 'column',
              animation: 'scaleIn 0.25s cubic-bezier(0.22,1,0.36,1) both',
            }}
          >
            {/* Photo */}
            <img src={selectedPhoto.url} alt="" style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain' }} />

            {/* Date row */}
            {(selectedPhoto.date_taken || selectedPhoto.uploaded_at) && (
              <div className="lightbox-meta-row">
                🗓 {formatDate(selectedPhoto.date_taken || selectedPhoto.uploaded_at)}
                {selectedPhoto.date_taken && selectedPhoto.uploaded_at && (
                  <span style={{ fontSize: 11, color: 'rgba(17,17,17,0.38)' }}>
                    · uploaded {formatDate(selectedPhoto.uploaded_at)}
                  </span>
                )}
              </div>
            )}

            {/* Location row */}
            <div className="lightbox-meta-row">
              📍{' '}
              {selectedPhoto.place_name ? (
                <>
                  {selectedPhoto.place_name}
                  <button
                    onClick={() => { setEditingLocation(selectedPhoto.id); setLocationInput(selectedPhoto.place_name); }}
                    style={{ marginLeft: 4, background: 'none', border: 'none', color: 'rgba(17,17,17,0.5)', cursor: 'pointer', fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, padding: 0, textDecoration: 'underline' }}
                  >
                    Edit
                  </button>
                </>
              ) : (
                <span style={{ color: 'rgba(17,17,17,0.4)' }}>
                  No location —{' '}
                  <button
                    onClick={() => setEditingLocation(selectedPhoto.id)}
                    style={{ background: 'none', border: 'none', color: '#111', cursor: 'pointer', fontWeight: 700, padding: 0, fontSize: 12, fontFamily: "'Syne', sans-serif", textDecoration: 'underline' }}
                  >
                    Add location
                  </button>
                </span>
              )}
            </div>

            {/* Location edit */}
            {editingLocation === selectedPhoto.id && (
              <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(17,17,17,0.07)', background: '#faf8f4', display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="location-input"
                  value={locationInput}
                  onChange={e => setLocationInput(e.target.value)}
                  placeholder="e.g. New York, USA"
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveLocation();
                    if (e.key === 'Escape') { setEditingLocation(null); setLocationInput(''); }
                  }}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveLocation}
                  disabled={savingLocation || !locationInput.trim()}
                >
                  {savingLocation ? '…' : 'Save'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setEditingLocation(null); setLocationInput(''); }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Share row */}
            <div style={{ padding: '12px 16px', background: '#faf8f4' }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 8 }}>
                Share with
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="share-input"
                  value={shareUsername}
                  onChange={e => setShareUser(e.target.value)}
                  placeholder="@username"
                  onKeyDown={e => { if (e.key === 'Enter') handleShare(); }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleShare}
                  disabled={sharing || !shareUsername.trim()}
                >
                  {sharing ? '…' : 'Share'}
                </button>
              </div>
              {shareMsg && (
                <p style={{
                  marginTop: 8, fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600,
                  color: shareMsg.startsWith('✓') ? '#2d8a5e' : '#c0392b',
                }}>
                  {shareMsg}
                </p>
              )}
            </div>

            {/* Close */}
            {selectedPhoto && (
  <PhotoPanel
    photo={{ ...selectedPhoto, people: selectedPhoto.people || [] }}
    onClose={() => { setSelected(null); }}
    onLocationSave={fetchPhotos}
  />
)}
            <button
              onClick={closeLightbox}
              style={{
                position: 'absolute', top: 12, right: 12,
                width: 34, height: 34, borderRadius: '50%',
                background: 'rgba(10,8,6,0.55)', border: 'none',
                color: '#f2efe9', fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >✕</button>
          </div>
        </div>
      )}
    </>
  );
}