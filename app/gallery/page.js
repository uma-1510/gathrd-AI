'use client';

import { useState, useEffect } from 'react';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

export default function Gallery() {
  const [selectedPhoto, setSelectedPhoto]     = useState(null);
  const [photos, setPhotos]                   = useState([]);
  const [uploading, setUploading]             = useState(false);
  const [selectMode, setSelectMode]           = useState(false);
  const [selectedIds, setSelectedIds]         = useState(new Set());
  const [deleting, setDeleting]               = useState(false);
  const [shareUsername, setShareUsername]     = useState('');
  const [sharing, setSharing]                 = useState(false);
  const [shareMsg, setShareMsg]               = useState('');

  useEffect(() => { fetchPhotos(); }, []);

  // ── Original handlers — untouched ──
  const fetchPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.photos) setPhotos(data.photos);
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const formData = new FormData();
    files.forEach((file) => formData.append('photos', file));
    const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.photos) await fetchPhotos();
    setUploading(false);
  };

  const toggleSelectMode = () => { setSelectMode(!selectMode); setSelectedIds(new Set()); };
  const toggleSelect = (id) => { const s = new Set(selectedIds); s.has(id) ? s.delete(id) : s.add(id); setSelectedIds(s); };
  const selectAll = () => { if (selectedIds.size === photos.length) setSelectedIds(new Set()); else setSelectedIds(new Set(photos.map(p => p.id))); };

  const handleDelete = async (idsToDelete) => {
    if (!confirm(`Delete ${idsToDelete.length} photo${idsToDelete.length > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    const res = await fetch('/api/photos/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: idsToDelete }),
    });
    if (res.ok) { await fetchPhotos(); setSelectedIds(new Set()); setSelectMode(false); setSelectedPhoto(null); }
    setDeleting(false);
  };

  const handleShare = async () => {
    if (!shareUsername.trim()) return;
    setSharing(true);
    setShareMsg('');
    const res = await fetch('/api/share/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: selectedPhoto.id, shareWith: shareUsername.trim() }),
    });
    const data = await res.json();
    if (res.ok) { setShareMsg(`✓ Shared with ${shareUsername}`); setShareUsername(''); }
    else setShareMsg(`✗ ${data.error}`);
    setSharing(false);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }

        @keyframes fadeUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn {
          from { opacity:0; transform:scale(0.97) translateY(-6px); }
          to   { opacity:1; transform:scale(1)    translateY(0); }
        }

        .fu-1 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.12s both; }
        .fu-3 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.2s  both; }

        /* Toolbar buttons */
        .tb-btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 10px 18px; border-radius: 100px;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          border: none; cursor: pointer;
          transition: transform 0.18s, box-shadow 0.18s, background 0.18s;
        }
        .tb-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.1); }
        .tb-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }

        .tb-btn-primary   { background: #111; color: #f2efe9; }
        .tb-btn-ghost     { background: rgba(17,17,17,0.06); color: #111; border: 1.5px solid rgba(17,17,17,0.12); }
        .tb-btn-ghost:hover { background: rgba(17,17,17,0.1); }
        .tb-btn-danger    { background: rgba(220,38,38,0.08); color: #c0392b; border: 1.5px solid rgba(220,38,38,0.2); }
        .tb-btn-danger:hover { background: rgba(220,38,38,0.14); }

        /* Upload label styled as button */
        .upload-label {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 10px 20px; border-radius: 100px;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          background: #111; color: #f2efe9; cursor: pointer;
          transition: background 0.18s, transform 0.18s, box-shadow 0.18s;
        }
        .upload-label:hover { background: #2a2a2a; transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.14); }
        .upload-label.disabled { background: rgba(17,17,17,0.3); cursor: not-allowed; transform: none; box-shadow: none; }

        /* Photo grid */
        .photo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        .photo-tile {
          aspect-ratio: 1/1; border-radius: 12px; overflow: hidden;
          cursor: pointer; position: relative;
          border: 1.5px solid transparent;
          transition: transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s, border-color 0.18s;
          background: rgba(17,17,17,0.05);
        }
        .photo-tile:hover { transform: scale(1.03); box-shadow: 0 12px 32px rgba(0,0,0,0.12); }
        .photo-tile.selected { border-color: #111; box-shadow: 0 0 0 2px #111; opacity: 0.88; }
        .photo-tile img { width:100%; height:100%; object-fit:cover; display:block; }

        .select-check {
          position: absolute; top: 8px; left: 8px;
          width: 20px; height: 20px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.9);
          background: rgba(255,255,255,0.25);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
          transition: background 0.15s;
        }
        .select-check.checked {
          background: #111; border-color: #111;
        }

        /* Lightbox */
        .lightbox-overlay {
          position: fixed; inset:0;
          background: rgba(8,5,3,0.92);
          z-index: 2000;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: fadeIn 0.18s ease both;
        }
        .lightbox-card {
          position: relative;
          max-width: 92vw; max-height: 92vh;
          background: #faf8f4;
          border-radius: 20px; overflow: hidden;
          box-shadow: 0 40px 80px rgba(0,0,0,0.5);
          display: flex; flex-direction: column;
          animation: scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both;
        }
        .lightbox-img { max-width:100%; max-height:68vh; object-fit:contain; display:block; }
        .lightbox-bar {
          padding: 16px 20px;
          border-top: 1px solid rgba(17,17,17,0.08);
          background: #faf8f4;
          display: flex; flex-direction: column; gap: 12px;
        }
        .lightbox-close {
          position: absolute; top:12px; right:12px;
          width:36px; height:36px; border-radius:50%;
          background: rgba(17,17,17,0.55); border:none;
          color:#f2efe9; font-size:16px; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          transition: background 0.18s;
        }
        .lightbox-close:hover { background: rgba(17,17,17,0.8); }

        /* Share input */
        .share-row { display:flex; gap:8px; align-items:center; }
        .share-input {
          flex:1; padding:10px 14px;
          background: rgba(17,17,17,0.04);
          border: 1.5px solid rgba(17,17,17,0.12);
          border-radius: 100px; outline:none;
          font-family:'Syne',sans-serif; font-size:13px; color:#111;
          transition: border-color 0.2s, background 0.2s;
        }
        .share-input:focus { border-color: rgba(17,17,17,0.5); background:#fff; }
        .share-input::placeholder { color:rgba(17,17,17,0.28); }

        /* Empty state */
        .empty-state {
          text-align:center; padding:80px 24px;
          animation: fadeIn 0.6s ease 0.1s both;
        }
        .empty-icon {
          width:64px; height:64px; border-radius:18px;
          background: rgba(17,17,17,0.05);
          border: 1.5px solid rgba(17,17,17,0.08);
          display:flex; align-items:center; justify-content:center;
          margin:0 auto 20px;
        }
      `}</style>

      <Header />
      <Sidebar />
      <BottomNav />

      {/* Original main layout — marginLeft/marginTop preserved */}
      <main style={{
        marginLeft: '0', marginTop: '62px',
        padding: '32px 28px', paddingBottom: '90px',
        minHeight: 'calc(100vh - 62px)', background: '#f2efe9',
        transition: 'margin-left 0.3s ease',
      }} className="lg:ml-[240px] lg:p-10 lg:pb-10">

        {/* Page header */}
        <div className="fu-1" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:32, flexWrap:'wrap', gap:16 }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:11, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(17,17,17,0.35)', marginBottom:6 }}>
              Your memories
            </p>
            <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:'clamp(26px,3.5vw,40px)', fontWeight:400, fontStyle:'italic', color:'#111', lineHeight:1.1, letterSpacing:'-0.02em' }}>
              Gallery
            </h1>
          </div>

          {/* Toolbar — original button logic preserved exactly */}
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {photos.length > 0 && (
              <button className="tb-btn tb-btn-ghost" onClick={toggleSelectMode}>
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
            {selectMode && (
              <>
                <button className="tb-btn tb-btn-ghost" onClick={selectAll}>
                  {selectedIds.size === photos.length ? 'Deselect all' : 'Select all'}
                </button>
                {selectedIds.size > 0 && (
                  <button
                    className="tb-btn tb-btn-danger"
                    onClick={() => handleDelete([...selectedIds])}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : `Delete (${selectedIds.size})`}
                  </button>
                )}
              </>
            )}
            {!selectMode && (
              <label className={`upload-label${uploading ? ' disabled' : ''}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {uploading ? 'Uploading…' : 'Upload'}
                <input type="file" accept="image/*" multiple onChange={handleFileChange} disabled={uploading} style={{ display:'none' }} />
              </label>
            )}
          </div>
        </div>

        {/* Photo grid or empty */}
        {photos.length > 0 ? (
          <div className="fu-2">
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'rgba(17,17,17,0.38)', marginBottom:16 }}>
              {photos.length} photo{photos.length !== 1 ? 's' : ''}
              {selectMode && selectedIds.size > 0 && (
                <span style={{ color:'#111', marginLeft:10 }}>{selectedIds.size} selected</span>
              )}
            </p>
            <div className="photo-grid">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className={`photo-tile${selectedIds.has(photo.id) ? ' selected' : ''}`}
                  onClick={() => {
                    if (selectMode) toggleSelect(photo.id);
                    else { setSelectedPhoto(photo); setShareMsg(''); setShareUsername(''); }
                  }}
                >
                  <img src={photo.url} alt="" />
                  {selectMode && (
                    <div className={`select-check${selectedIds.has(photo.id) ? ' checked' : ''}`}>
                      {selectedIds.has(photo.id) && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#f2efe9" strokeWidth="2.2" strokeLinecap="round"><polyline points="2,6 5,9 10,3"/></svg>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(17,17,17,0.35)" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:20, fontStyle:'italic', color:'rgba(17,17,17,0.45)', marginBottom:8 }}>No photos yet</p>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.35)' }}>Upload some memories to get started</p>
          </div>
        )}
      </main>

      {/* ── Lightbox — original onClick/stopPropagation/handleDelete/handleShare preserved ── */}
      {selectedPhoto && (
        <div className="lightbox-overlay" onClick={() => setSelectedPhoto(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            <img src={selectedPhoto.url} alt="" className="lightbox-img" />

            <div className="lightbox-bar">
              {/* Delete button — original handler */}
              <button
                className="tb-btn tb-btn-danger"
                style={{ alignSelf:'flex-start' }}
                onClick={() => handleDelete([selectedPhoto.id])}
                disabled={deleting}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>

              {/* Share — original handleShare, original state */}
              <div className="share-row">
                <input
                  className="share-input"
                  type="text"
                  value={shareUsername}
                  onChange={(e) => { setShareUsername(e.target.value); setShareMsg(''); }}
                  placeholder="Share with username…"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleShare(); }}
                />
                <button
                  className="tb-btn tb-btn-primary"
                  onClick={handleShare}
                  disabled={sharing || !shareUsername.trim()}
                  style={{ flexShrink:0 }}
                >
                  {sharing ? '…' : 'Share'}
                </button>
              </div>
              {shareMsg && (
                <p style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:500, color: shareMsg.startsWith('✓') ? '#2d8a5e' : '#c0392b', margin:0 }}>
                  {shareMsg}
                </p>
              )}
            </div>

            <button className="lightbox-close" onClick={() => setSelectedPhoto(null)}>✕</button>
          </div>
        </div>
      )}
    </>
  );
}