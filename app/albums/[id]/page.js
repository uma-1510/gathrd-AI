'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Header from '../../../components/Header';
import Sidebar from '../../../components/Sidebar';

export default function AlbumDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();

  const [album, setAlbum]               = useState(null);
  const [albumPhotos, setAlbumPhotos]   = useState([]);
  const [members, setMembers]           = useState([]);
  const [isOwner, setIsOwner]           = useState(false);
  const [canAddPhotos, setCanAddPhotos] = useState(false);
  const [allPhotos, setAllPhotos]       = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [showAddPhotos, setShowAddPhotos] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  const [selectMode, setSelectMode]     = useState(false);
  const [selectedToRemove, setSelectedToRemove] = useState(new Set());
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [downloading, setDownloading]   = useState(false);

  // Comments / chat
  const [showChat, setShowChat]             = useState(false);
  const [comments, setComments]             = useState([]);
  const [commentInput, setCommentInput]     = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const COMMENT_MAX_LEN = 500;
  const COMMENT_LIMIT   = 200;

  useEffect(() => { fetchAlbum(); }, [id]);

  const fetchAlbum = async () => {
    setLoading(true);
    const res = await fetch(`/api/albums/${id}`);
    const data = await res.json();
    if (data.album) {
      setAlbum(data.album);
      setAlbumPhotos(data.photos);
      setMembers(data.members || []);
      setIsOwner(data.isOwner);
      setCanAddPhotos(data.canAddPhotos);
    }
    setLoading(false);
  };

  const fetchAllPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.photos) setAllPhotos(data.photos);
  };

  const openAddPhotos = async () => {
    await fetchAllPhotos();
    setSelectedToAdd(new Set(albumPhotos.map(p => p.id)));
    setShowAddPhotos(true);
  };

  const handleAddPhotos = async () => {
    setSaving(true);
    const currentIds = new Set(albumPhotos.map(p => p.id));
    const toAdd = [...selectedToAdd].filter(pid => !currentIds.has(pid));
    if (toAdd.length > 0) {
      await fetch(`/api/albums/${id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds: toAdd }),
      });
    }
    setShowAddPhotos(false);
    await fetchAlbum();
    setSaving(false);
  };

  const handleRemoveSelected = async () => {
    if (!confirm(`Remove ${selectedToRemove.size} photo(s) from this album?`)) return;
    setSaving(true);
    await fetch(`/api/albums/${id}/photos`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: [...selectedToRemove] }),
    });
    setSelectMode(false);
    setSelectedToRemove(new Set());
    await fetchAlbum();
    setSaving(false);
  };

  const handleDownloadAll = async () => {
    if (albumPhotos.length === 0) return;
    setDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
      const folder = zip.folder(album?.name || 'album');
      await Promise.all(
        albumPhotos.map(async (photo, i) => {
          try {
            const blob = await fetch(photo.url).then(r => r.blob());
            const ext = photo.url.split('.').pop().split('?')[0] || 'jpg';
            folder.file(`${String(i + 1).padStart(3, '0')}_${photo.filename || `photo.${ext}`}`, blob);
          } catch {}
        })
      );
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${album?.name || 'album'}.zip`);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed. Make sure jszip and file-saver are installed:\nnpm install jszip file-saver');
    }
    setDownloading(false);
  };

  // ── Comments ─────────────────────────────────────────────────────────────
  const fetchComments = async () => {
    setLoadingComments(true);
    const res = await fetch(`/api/albums/${id}/comments`);
    const data = await res.json();
    if (data.comments) setComments(data.comments);
    setLoadingComments(false);
  };

  const handleOpenChat = async () => {
    setShowChat(true);
    if (comments.length === 0) await fetchComments();
  };

  const handlePostComment = async () => {
    if (!commentInput.trim() || postingComment) return;
    setPostingComment(true);
    const res = await fetch(`/api/albums/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commentInput.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setComments(prev => [...prev, data.comment]);
      setCommentInput('');
    } else {
      alert(data.error);
    }
    setPostingComment(false);
  };

  const handleDeleteComment = async (commentId) => {
    await fetch(`/api/albums/${id}/comments/${commentId}`, { method: 'DELETE' });
    setComments(prev => prev.filter(c => c.id !== commentId));
  };

  if (loading) return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
      `}</style>
      <Header /><Sidebar />
      <main style={{ marginLeft: '240px', marginTop: '62px', padding: '36px 32px', minHeight: 'calc(100vh - 62px)', background: '#f2efe9', fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.45)' }}>
        Loading…
      </main>
    </>
  );

  if (!album) return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
      `}</style>
      <Header /><Sidebar />
      <main style={{ marginLeft: '240px', marginTop: '62px', padding: '36px 32px', minHeight: 'calc(100vh - 62px)', background: '#f2efe9', fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.45)' }}>
        Album not found.
      </main>
    </>
  );

  const isShared = members.length > 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }

        @keyframes fadeUp  { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96) translateY(-8px); } to { opacity:1; transform:scale(1) translateY(0); } }

        .fu-1 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.14s both; }
        .fu-3 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.22s both; }

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

        .shared-badge {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(17,17,17,0.06); color: rgba(17,17,17,0.6);
          border: 1px solid rgba(17,17,17,0.1);
          border-radius: 100px; padding: 3px 12px;
          font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
        }

        .members-bar {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          padding: 12px 18px; margin-bottom: 28px;
          background: #faf8f4; border: 1px solid rgba(17,17,17,0.08);
          border-radius: 14px;
        }
        .member-chip {
          display: inline-flex; align-items: center; gap: 5px;
          border-radius: 100px; padding: 4px 12px;
          font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
        }
        .member-chip.owner  { background: #111; color: #f2efe9; }
        .member-chip.member { background: rgba(17,17,17,0.06); color: #111; border: 1px solid rgba(17,17,17,0.1); }

        .chat-panel {
          margin-top: 28px;
          background: #faf8f4; border: 1px solid rgba(17,17,17,0.08);
          border-radius: 16px; display: flex; flex-direction: column; max-height: 480px;
        }
        .chat-header {
          padding: 14px 18px; border-bottom: 1px solid rgba(17,17,17,0.07);
          display: flex; justify-content: space-between; align-items: center;
        }
        .chat-title {
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: #111; letter-spacing: 0.04em; text-transform: uppercase;
        }
        .chat-messages { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
        .chat-input-row { padding: 12px 16px; border-top: 1px solid rgba(17,17,17,0.07); display: flex; gap: 8px; }
        .chat-input {
          flex: 1; padding: 10px 14px;
          background: rgba(17,17,17,0.04); border: 1.5px solid rgba(17,17,17,0.12);
          border-radius: 10px; outline: none; resize: none;
          font-family: 'Syne', sans-serif; font-size: 13px; color: #111;
          transition: border-color 0.18s;
        }
        .chat-input:focus { border-color: rgba(17,17,17,0.4); }

        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(10,8,6,0.6); backdrop-filter: blur(6px);
          z-index: 2000; display: flex; align-items: center; justify-content: center;
          padding: 24px; animation: fadeIn 0.18s ease both;
        }
        .modal-card {
          background: #faf8f4; border-radius: 20px;
          width: 100%; max-width: 760px; max-height: 85vh;
          display: flex; flex-direction: column;
          box-shadow: 0 32px 80px rgba(0,0,0,0.22);
          animation: scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both;
        }
        .modal-header {
          padding: 20px 24px; border-bottom: 1px solid rgba(17,17,17,0.07);
          display: flex; justify-content: space-between; align-items: center;
        }
        .modal-title {
          font-family: 'Instrument Serif', serif; font-size: 22px;
          font-weight: 400; font-style: italic; color: #111; margin: 0;
        }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{
        marginLeft: '240px',
        marginTop: '62px',
        padding: '36px 32px',
        minHeight: 'calc(100vh - 62px)',
        background: '#f2efe9',
      }}>

        {/* ── Back + title ──────────────────────────────────────────────── */}
        <div className="fu-1" style={{ marginBottom: 32 }}>
          <button
            onClick={() => router.push('/albums')}
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 20 }}
          >
            ← Back to Albums
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <p style={{
                  fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  color: 'rgba(17,17,17,0.35)', margin: 0,
                }}>
                  {isShared ? 'Shared album' : 'Your album'}
                </p>
                {isShared && (
                  <span className="shared-badge">
                    👥 {members.length} member{members.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <h1 style={{
                fontFamily: "'Instrument Serif', serif",
                fontSize: 'clamp(26px, 3.5vw, 40px)',
                fontWeight: 400, fontStyle: 'italic',
                color: '#111', lineHeight: 1.1, letterSpacing: '-0.02em',
                margin: 0,
              }}>
                {album.name}
              </h1>
              {album.description && (
                <p style={{
                  fontFamily: "'Syne', sans-serif", fontSize: 13,
                  color: 'rgba(17,17,17,0.45)', marginTop: 6, marginBottom: 0,
                }}>
                  {album.description}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="btn btn-ghost"
                onClick={handleDownloadAll}
                disabled={downloading || albumPhotos.length === 0}
              >
                {downloading ? 'Zipping…' : '⬇ Download All'}
              </button>

              {isShared && (
                <button
                  className={`btn ${showChat ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={handleOpenChat}
                >
                  💬 Chat {comments.length > 0 && `(${comments.length})`}
                </button>
              )}

              {isOwner && albumPhotos.length > 0 && (
                <button
                  className={`btn ${selectMode ? 'btn-ghost' : 'btn-ghost'}`}
                  onClick={() => { setSelectMode(!selectMode); setSelectedToRemove(new Set()); }}
                >
                  {selectMode ? 'Cancel' : 'Select'}
                </button>
              )}

              {isOwner && selectMode && selectedToRemove.size > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={handleRemoveSelected}
                  disabled={saving}
                >
                  {saving ? 'Removing…' : `Remove (${selectedToRemove.size})`}
                </button>
              )}

              {canAddPhotos && !selectMode && (
                <button className="btn btn-primary" onClick={openAddPhotos}>
                  + Add Photos
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Members bar ──────────────────────────────────────────────── */}
        {isShared && (
          <div className="members-bar fu-2">
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginRight: 4 }}>
              Members
            </span>
            {members.map(m => (
              <span key={m.username} className={`member-chip ${m.role === 'owner' ? 'owner' : 'member'}`}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: m.role === 'owner' ? 'rgba(255,255,255,0.15)' : 'rgba(17,17,17,0.08)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>
                  {m.username[0].toUpperCase()}
                </span>
                @{m.username}
                {m.role === 'owner' && <span style={{ opacity: 0.6, fontSize: 10 }}>owner</span>}
              </span>
            ))}
            {!isOwner && (
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.35)', marginLeft: 'auto' }}>
                You can add photos · only the owner can remove
              </span>
            )}
          </div>
        )}

        {/* ── Photo grid ───────────────────────────────────────────────── */}
        <div className="fu-3">
          {albumPhotos.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
              {albumPhotos.map(photo => (
                <div
                  key={photo.id}
                  onClick={() => {
                    if (selectMode && isOwner) {
                      setSelectedToRemove(prev => {
                        const next = new Set(prev);
                        next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
                        return next;
                      });
                    } else {
                      setSelectedPhoto(photo);
                    }
                  }}
                  style={{
                    aspectRatio: '1/1', borderRadius: 12, overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: selectedToRemove.has(photo.id)
                      ? '0 0 0 3px #c0392b'
                      : '0 4px 10px rgba(0,0,0,0.08)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    position: 'relative',
                    opacity: selectedToRemove.has(photo.id) ? 0.85 : 1,
                  }}
                  onMouseEnter={e => { if (!selectMode) e.currentTarget.style.transform = 'scale(1.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                  {selectMode && isOwner && (
                    <div style={{
                      position: 'absolute', top: '0.5rem', left: '0.5rem',
                      width: 22, height: 22, borderRadius: '50%',
                      backgroundColor: selectedToRemove.has(photo.id) ? '#c0392b' : 'rgba(255,255,255,0.85)',
                      border: '2px solid white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selectedToRemove.has(photo.id) && <span style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>✓</span>}
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
              <div style={{ fontSize: 36, marginBottom: 12 }}>🖼️</div>
              <p style={{
                fontFamily: "'Instrument Serif', serif",
                fontSize: 20, fontStyle: 'italic',
                color: 'rgba(17,17,17,0.5)', marginBottom: 8,
              }}>
                No photos in this album
              </p>
              {canAddPhotos && (
                <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={openAddPhotos}>
                  + Add Photos
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Chat panel ───────────────────────────────────────────────── */}
        {isShared && showChat && (
          <div className="chat-panel">
            <div className="chat-header">
              <div>
                <span className="chat-title">💬 Album Chat</span>
                <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.38)', marginLeft: 10 }}>
                  {comments.length}/{COMMENT_LIMIT} messages
                </span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowChat(false)}>✕</button>
            </div>

            <div className="chat-messages">
              {loadingComments && (
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.35)', textAlign: 'center' }}>Loading…</p>
              )}
              {!loadingComments && comments.length === 0 && (
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.35)', textAlign: 'center', padding: '16px 0' }}>
                  No messages yet — say something!
                </p>
              )}
              {comments.map(c => {
                const isMine = c.username === session?.user?.username;
                const canDelete = isMine || isOwner;
                return (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                    {!isMine && (
                      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: 'rgba(17,17,17,0.45)', marginBottom: 3 }}>
                        @{c.username}
                      </span>
                    )}
                    <div style={{
                      maxWidth: '75%', padding: '9px 14px',
                      borderRadius: isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: isMine ? '#111' : '#faf8f4',
                      color: isMine ? '#f2efe9' : '#111',
                      border: isMine ? 'none' : '1px solid rgba(17,17,17,0.08)',
                      fontFamily: "'Syne', sans-serif", fontSize: 13,
                      position: 'relative',
                    }}>
                      {c.message}
                      {canDelete && (
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          style={{
                            position: 'absolute', top: -6, right: -6,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'rgba(220,38,38,0.12)', border: 'none',
                            color: '#c0392b', fontSize: 10, cursor: 'pointer',
                            display: 'none', alignItems: 'center', justifyContent: 'center',
                          }}
                          className="delete-comment-btn"
                        >×</button>
                      )}
                    </div>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, color: 'rgba(17,17,17,0.3)', marginTop: 3 }}>
                      {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>

            {comments.length < COMMENT_LIMIT && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(17,17,17,0.07)' }}>
                <div className="chat-input-row" style={{ padding: 0 }}>
                  <textarea
                    className="chat-input"
                    value={commentInput}
                    onChange={e => setCommentInput(e.target.value.slice(0, COMMENT_MAX_LEN))}
                    placeholder="Say something…"
                    rows={1}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handlePostComment}
                    disabled={postingComment || !commentInput.trim()}
                  >
                    {postingComment ? '…' : 'Send'}
                  </button>
                </div>
                <div style={{ textAlign: 'right', fontFamily: "'Syne', sans-serif", fontSize: 11, marginTop: 4, color: commentInput.length > COMMENT_MAX_LEN - 50 ? '#c0392b' : 'rgba(17,17,17,0.3)' }}>
                  {commentInput.length}/{COMMENT_MAX_LEN}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {selectedPhoto && (
        <div
          onClick={() => setSelectedPhoto(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10,8,6,0.9)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative', maxWidth: '95vw', maxHeight: '90vh',
              backgroundColor: '#faf8f4', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
              animation: 'scaleIn 0.25s cubic-bezier(0.22,1,0.36,1) both',
            }}
          >
            <img src={selectedPhoto.url} alt="" style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
            {selectedPhoto.added_by && isShared && (
              <div style={{ padding: '8px 16px', fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.45)', borderTop: '1px solid rgba(17,17,17,0.07)' }}>
                Added by @{selectedPhoto.added_by}
              </div>
            )}
            <button
              onClick={() => setSelectedPhoto(null)}
              style={{ position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: '50%', backgroundColor: 'rgba(10,8,6,0.55)', color: '#f2efe9', border: 'none', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >×</button>
          </div>
        </div>
      )}

      {/* ── Add Photos Modal ──────────────────────────────────────────────── */}
      {showAddPhotos && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Add Photos</h2>
                {!isOwner && (
                  <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.45)', margin: '4px 0 0' }}>
                    You can add photos — only the album owner can remove them
                  </p>
                )}
              </div>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color: 'rgba(17,17,17,0.45)', letterSpacing: '0.05em' }}>
                {selectedToAdd.size} selected
              </span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {allPhotos.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                  {allPhotos.map(photo => {
                    const inAlbum = albumPhotos.some(p => p.id === photo.id);
                    const selected = selectedToAdd.has(photo.id);
                    return (
                      <div
                        key={photo.id}
                        onClick={() => {
                          if (inAlbum) return;
                          setSelectedToAdd(prev => {
                            const next = new Set(prev);
                            next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
                            return next;
                          });
                        }}
                        style={{
                          aspectRatio: '1', borderRadius: 10, overflow: 'hidden',
                          cursor: inAlbum ? 'default' : 'pointer',
                          boxShadow: selected ? '0 0 0 3px #111' : 'none',
                          opacity: inAlbum ? 0.4 : 1,
                          position: 'relative',
                          transition: 'box-shadow 0.15s',
                        }}
                      >
                        <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {selected && !inAlbum && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(17,17,17,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ color: 'white', fontSize: 20, fontWeight: 800 }}>✓</span>
                          </div>
                        )}
                        {inAlbum && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 6px', background: 'rgba(17,17,17,0.55)', fontFamily: "'Syne', sans-serif", fontSize: 10, color: 'white', fontWeight: 700, textAlign: 'center' }}>
                            In album
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.38)', textAlign: 'center', padding: '40px 0' }}>
                  No photos in your gallery yet
                </p>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(17,17,17,0.07)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowAddPhotos(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleAddPhotos}
                disabled={saving || selectedToAdd.size === 0}
              >
                {saving ? 'Saving…' : 'Add to Album'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}