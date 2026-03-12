'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';

export default function Albums() {
  const router = useRouter();

  // ── Original state — untouched ──
  const [albums, setAlbums]                     = useState([]);
  const [showCreate, setShowCreate]             = useState(false);
  const [newAlbum, setNewAlbum]                 = useState({ name: '', description: '' });
  const [creating, setCreating]                 = useState(false);
  const [deleting, setDeleting]                 = useState(null);
  const [sharingAlbum, setSharingAlbum]         = useState(null);
  const [albumShareUsername, setAlbumShareUsername] = useState('');
  const [albumShareMsg, setAlbumShareMsg]       = useState('');
  const [albumSharing, setAlbumSharing]         = useState(false);

  useEffect(() => { fetchAlbums(); }, []);

  // ── Original handlers — untouched ──
  const fetchAlbums = async () => {
    const res = await fetch('/api/albums');
    const data = await res.json();
    if (data.albums) setAlbums(data.albums);
  };

  const handleCreate = async () => {
    if (!newAlbum.name.trim()) return;
    setCreating(true);
    const res = await fetch('/api/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAlbum),
    });
    const data = await res.json();
    if (data.album) {
      await fetchAlbums();
      setNewAlbum({ name: '', description: '' });
      setShowCreate(false);
    }
    setCreating(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this album? Photos will not be deleted.')) return;
    setDeleting(id);
    await fetch(`/api/albums/${id}`, { method: 'DELETE' });
    await fetchAlbums();
    setDeleting(null);
  };

  const handleShareAlbum = async () => {
    if (!albumShareUsername.trim()) return;
    setAlbumSharing(true);
    setAlbumShareMsg('');
    const res = await fetch('/api/share/album', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId: sharingAlbum.id, shareWith: albumShareUsername.trim() }),
    });
    const data = await res.json();
    if (res.ok) { setAlbumShareMsg(`✓ Shared with ${albumShareUsername}`); setAlbumShareUsername(''); }
    else setAlbumShareMsg(`✗ ${data.error}`);
    setAlbumSharing(false);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing:border-box; }
        body { background:#f2efe9; font-family:'Syne',sans-serif; }

        @keyframes fadeUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn {
          from { opacity:0; transform:scale(0.96) translateY(-8px); }
          to   { opacity:1; transform:scale(1)    translateY(0); }
        }

        .fu-1 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.14s both; }

        /* Buttons */
        .btn {
          display:inline-flex; align-items:center; gap:7px;
          padding:11px 22px; border-radius:100px; border:none; cursor:pointer;
          font-family:'Syne',sans-serif; font-size:12px; font-weight:700;
          letter-spacing:0.05em; text-transform:uppercase;
          transition:transform 0.18s, box-shadow 0.18s, background 0.18s;
        }
        .btn:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(0,0,0,0.1); }
        .btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; box-shadow:none; }
        .btn-primary   { background:#111; color:#f2efe9; }
        .btn-ghost     { background:rgba(17,17,17,0.06); color:#111; border:1.5px solid rgba(17,17,17,0.12); }
        .btn-ghost:hover { background:rgba(17,17,17,0.1); }
        .btn-danger    { background:rgba(220,38,38,0.08); color:#c0392b; border:1.5px solid rgba(220,38,38,0.18); }
        .btn-danger:hover { background:rgba(220,38,38,0.14); }
        .btn-share     { background:rgba(17,17,17,0.05); color:rgba(17,17,17,0.6); border:1.5px solid rgba(17,17,17,0.1); }
        .btn-share:hover { background:rgba(17,17,17,0.09); color:#111; }

        /* Album card */
        .album-card {
          background:#faf8f4;
          border:1px solid rgba(17,17,17,0.07);
          border-radius:16px; overflow:hidden;
          cursor:pointer;
          transition:transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s;
        }
        .album-card:hover {
          transform:translateY(-5px);
          box-shadow:0 20px 48px rgba(0,0,0,0.1);
        }
        .album-cover {
          height:170px; overflow:hidden;
          background:rgba(17,17,17,0.06);
          display:flex; align-items:center; justify-content:center;
        }
        .album-cover img { width:100%; height:100%; object-fit:cover; display:block; transition:transform 0.4s; }
        .album-card:hover .album-cover img { transform:scale(1.05); }
        .album-info { padding:14px 16px; }
        .album-name {
          font-family:'Syne',sans-serif; font-size:14px; font-weight:700; color:#111;
          margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .album-desc {
          font-family:'Syne',sans-serif; font-size:12px; color:rgba(17,17,17,0.42);
          margin-bottom:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .album-meta {
          display:flex; justify-content:space-between; align-items:center; gap:8px;
          flex-wrap:wrap;
        }
        .album-count {
          font-family:'Syne',sans-serif; font-size:11px; font-weight:600;
          letter-spacing:0.08em; text-transform:uppercase; color:rgba(17,17,17,0.35);
        }

        /* Modal */
        .modal-overlay {
          position:fixed; inset:0;
          background:rgba(8,5,3,0.65); z-index:2000;
          display:flex; align-items:center; justify-content:center; padding:24px;
          animation: fadeIn 0.18s ease both;
        }
        .modal-card {
          background:#faf8f4;
          border:1px solid rgba(17,17,17,0.08);
          border-radius:24px; padding:clamp(28px,4vw,40px);
          width:100%; max-width:440px;
          box-shadow:0 32px 80px rgba(0,0,0,0.22);
          animation: scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both;
        }
        .modal-title {
          font-family:'Instrument Serif',serif;
          font-size:clamp(22px,2.5vw,28px);
          font-weight:400; font-style:italic; color:#111;
          letter-spacing:-0.02em; margin-bottom:24px;
        }

        /* Form fields */
        .field { margin-bottom:18px; }
        .field-label {
          display:block; margin-bottom:7px;
          font-family:'Syne',sans-serif; font-size:11px; font-weight:600;
          letter-spacing:0.12em; text-transform:uppercase; color:rgba(17,17,17,0.42);
        }
        .field-input, .field-textarea {
          width:100%; padding:12px 16px;
          background:rgba(17,17,17,0.04);
          border:1.5px solid rgba(17,17,17,0.11);
          border-radius:10px; outline:none;
          font-family:'Syne',sans-serif; font-size:14px; color:#111;
          transition:border-color 0.2s, background 0.2s, box-shadow 0.2s;
        }
        .field-input:focus, .field-textarea:focus {
          border-color:rgba(17,17,17,0.5); background:#fff;
          box-shadow:0 0 0 3px rgba(17,17,17,0.05);
        }
        .field-input::placeholder, .field-textarea::placeholder { color:rgba(17,17,17,0.25); }
        .field-textarea { resize:vertical; min-height:80px; }

        .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:24px; }

        /* Share input row */
        .share-row { display:flex; gap:8px; margin-bottom:10px; }
        .share-input {
          flex:1; padding:11px 16px;
          background:rgba(17,17,17,0.04);
          border:1.5px solid rgba(17,17,17,0.12);
          border-radius:100px; outline:none;
          font-family:'Syne',sans-serif; font-size:13px; color:#111;
          transition:border-color 0.2s, background 0.2s;
        }
        .share-input:focus { border-color:rgba(17,17,17,0.5); background:#fff; }
        .share-input::placeholder { color:rgba(17,17,17,0.28); }

        /* Empty state */
        .empty-state { text-align:center; padding:80px 24px; animation: fadeIn 0.6s ease 0.1s both; }
        .empty-icon {
          width:64px; height:64px; border-radius:18px;
          background:rgba(17,17,17,0.05); border:1.5px solid rgba(17,17,17,0.08);
          display:flex; align-items:center; justify-content:center;
          margin:0 auto 20px;
        }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft:'240px', marginTop:'62px', padding:'36px 32px', minHeight:'calc(100vh - 62px)', background:'#f2efe9' }}>

        {/* Page header */}
        <div className="fu-1" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:36, flexWrap:'wrap', gap:16 }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:11, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(17,17,17,0.35)', marginBottom:6 }}>
              Your collections
            </p>
            <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:'clamp(26px,3.5vw,40px)', fontWeight:400, fontStyle:'italic', color:'#111', lineHeight:1.1, letterSpacing:'-0.02em' }}>
              Albums
            </h1>
          </div>
          {/* Original onClick preserved */}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Album
          </button>
        </div>

        {/* Albums grid */}
        {albums.length > 0 ? (
          <div className="fu-2" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:'18px' }}>
            {albums.map((album) => (
              <div key={album.id} className="album-card">
                {/* Cover — original router.push preserved */}
                <div className="album-cover" onClick={() => router.push(`/albums/${album.id}`)}>
                  {album.cover_url
                    ? <img src={album.cover_url} alt="" />
                    : <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(17,17,17,0.2)" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  }
                </div>

                <div className="album-info">
                  {/* Original router.push preserved */}
                  <div className="album-name" onClick={() => router.push(`/albums/${album.id}`)}>
                    {album.name}
                  </div>
                  {album.description && (
                    <div className="album-desc">{album.description}</div>
                  )}
                  <div className="album-meta">
                    <span className="album-count">{album.photo_count} photo{album.photo_count !== '1' ? 's' : ''}</span>
                    <div style={{ display:'flex', gap:6 }}>
                      {/* Share — original onClick preserved */}
                      <button
                        className="btn btn-share"
                        style={{ padding:'6px 14px', fontSize:11 }}
                        onClick={(e) => { e.stopPropagation(); setSharingAlbum(album); setAlbumShareMsg(''); setAlbumShareUsername(''); }}
                      >
                        Share
                      </button>
                      {/* Delete — original onClick preserved */}
                      <button
                        className="btn btn-danger"
                        style={{ padding:'6px 14px', fontSize:11 }}
                        onClick={(e) => { e.stopPropagation(); handleDelete(album.id); }}
                        disabled={deleting === album.id}
                      >
                        {deleting === album.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(17,17,17,0.3)" strokeWidth="1.6" strokeLinecap="round"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            </div>
            <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:20, fontStyle:'italic', color:'rgba(17,17,17,0.45)', marginBottom:8 }}>No albums yet</p>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.35)' }}>Create an album to organise your photos</p>
          </div>
        )}
      </main>

      {/* ── Create Album Modal — original handleCreate preserved ── */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Create new album</h2>

            <div className="field">
              <label className="field-label">Album name *</label>
              <input
                className="field-input"
                type="text"
                value={newAlbum.name}
                onChange={(e) => setNewAlbum({ ...newAlbum, name: e.target.value })}
                placeholder="e.g. Summer 2025"
              />
            </div>
            <div className="field">
              <label className="field-label">Description (optional)</label>
              <textarea
                className="field-textarea"
                value={newAlbum.description}
                onChange={(e) => setNewAlbum({ ...newAlbum, description: e.target.value })}
                placeholder="What's this album about?"
                rows={3}
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => { setShowCreate(false); setNewAlbum({ name:'', description:'' }); }}
              >Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !newAlbum.name.trim()}
              >{creating ? 'Creating…' : 'Create album'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share Album Modal — original handleShareAlbum preserved ── */}
      {sharingAlbum && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth:400 }}>
            <h2 className="modal-title">Share album</h2>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.45)', marginBottom:20 }}>
              "{sharingAlbum.name}"
            </p>

            <div className="share-row">
              <input
                className="share-input"
                type="text"
                value={albumShareUsername}
                onChange={(e) => { setAlbumShareUsername(e.target.value); setAlbumShareMsg(''); }}
                placeholder="Enter username…"
                onKeyDown={(e) => { if (e.key === 'Enter') handleShareAlbum(); }}
              />
              <button
                className="btn btn-primary"
                style={{ flexShrink:0 }}
                onClick={handleShareAlbum}
                disabled={albumSharing || !albumShareUsername.trim()}
              >{albumSharing ? '…' : 'Share'}</button>
            </div>

            {albumShareMsg && (
              <p style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:500, color: albumShareMsg.startsWith('✓') ? '#2d8a5e' : '#c0392b', marginBottom:12 }}>
                {albumShareMsg}
              </p>
            )}

            <button
              className="btn btn-ghost"
              style={{ width:'100%', justifyContent:'center', marginTop:4 }}
              onClick={() => { setSharingAlbum(null); setAlbumShareUsername(''); setAlbumShareMsg(''); }}
            >Close</button>
          </div>
        </div>
      )}
    </>
  );
}