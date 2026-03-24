'use client';

import { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

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

  // Re-analysis state
  const [reanalyzing, setReanalyzing]   = useState(false);
  const [reanalyzeMsg, setReanalyzeMsg] = useState('');
  const [reanalyzeProgress, setReanalyzeProgress] = useState(null); // { done, total }

  useEffect(() => { fetchPhotos(); }, []);

  // ── Load ALL required face-api models including faceExpressionNet ──────────
  // Previously faceExpressionNet was missing — that's why dominantEmotion was
  // always null. All four models are needed for full emotion detection.
  useEffect(() => {
    Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      faceapi.nets.faceExpressionNet.loadFromUri('/models'), // ← was missing
    ])
      .then(() => setModels(true))
      .catch((err) => {
        console.error('Face model load error:', err);
        setModels(true); // allow upload even if models fail
      });
  }, []);

  const fetchPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.photos) setPhotos(data.photos);
  };

  // ── detectFaces — now correctly detects and returns dominant emotion ────────
  const detectFaces = async (file) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions()   // ← was missing — this is what gives emotions
        .withFaceDescriptors();

      URL.revokeObjectURL(url);

      if (!detections.length) {
        return { name: file.name, faceCount: 0, dominantEmotion: null, descriptor: null };
      }

      // Pick the largest (most prominent) face
      const main = detections.reduce((a, b) =>
        b.detection.box.width * b.detection.box.height >
        a.detection.box.width * a.detection.box.height ? b : a
      );

      // Get dominant emotion — the expression key with the highest score
      const expressions = main.expressions; // { happy: 0.97, sad: 0.01, ... }
      const dominantEmotion = Object.entries(expressions)
        .sort(([, a], [, b]) => b - a)[0][0];

      return {
        name: file.name,
        faceCount: detections.length,
        descriptor: Array.from(main.descriptor),
        dominantEmotion, // ← now actually set, was hardcoded null before
      };
    } catch (err) {
      console.error('detectFaces error:', err);
      return { name: file.name, faceCount: 0, dominantEmotion: null, descriptor: null };
    }
  };

  // ── detectFacesFromUrl — used for re-analysing existing photos ──────────────
  const detectFacesFromUrl = async (photoId, url) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions()
        .withFaceDescriptors();

      if (!detections.length) {
        return { photoId, faceCount: 0, dominantEmotion: null };
      }

      const main = detections.reduce((a, b) =>
        b.detection.box.width * b.detection.box.height >
        a.detection.box.width * a.detection.box.height ? b : a
      );

      const dominantEmotion = Object.entries(main.expressions)
        .sort(([, a], [, b]) => b - a)[0][0];

      return { photoId, faceCount: detections.length, dominantEmotion };
    } catch {
      return { photoId, faceCount: 0, dominantEmotion: null };
    }
  };

  // ── Re-analyse all existing photos that have no emotion data ─────────────────
  // Runs client-side face detection on every photo, then POSTs results
  // to /api/photos/analyze in batches of 10.
  const handleReanalyze = async () => {
    if (!modelsLoaded) {
      setReanalyzeMsg('Face models still loading, please wait…');
      return;
    }
    if (!photos.length) {
      setReanalyzeMsg('No photos to analyse.');
      return;
    }

    setReanalyzing(true);
    setReanalyzeMsg('');
    setReanalyzeProgress({ done: 0, total: photos.length });

    const BATCH = 10;
    let totalUpdated = 0;

    for (let i = 0; i < photos.length; i += BATCH) {
      const batch = photos.slice(i, i + BATCH);

      const results = await Promise.all(
        batch.map(p => detectFacesFromUrl(p.id, p.url))
      );

      // POST batch to analyze route
      try {
        const res = await fetch('/api/photos/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ results }),
        });
        const data = await res.json();
        totalUpdated += data.updated ?? 0;
      } catch (err) {
        console.error('Batch analyze failed:', err);
      }

      setReanalyzeProgress({ done: Math.min(i + BATCH, photos.length), total: photos.length });
    }

    // Refresh photos so emotion badges show up
    await fetchPhotos();
    setReanalyzing(false);
    setReanalyzeProgress(null);
    setReanalyzeMsg(`✓ Done — updated ${totalUpdated} photo${totalUpdated !== 1 ? 's' : ''} with emotion data`);
    setTimeout(() => setReanalyzeMsg(''), 6000);
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setStatus(`Analysing ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    try {
      const faceResults = await Promise.all(files.map(detectFaces));
      const formData = new FormData();
      files.forEach(f => formData.append('photos', f));
      formData.append('faceResults', JSON.stringify(faceResults));
      setStatus('Uploading & generating AI captions…');
      const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.photos) {
        await fetchPhotos();
        setStatus(`✓ ${data.photos.length} photo${data.photos.length > 1 ? 's' : ''} uploaded`);
        setTimeout(() => setStatus(''), 4000);
      } else {
        setStatus('Upload failed');
      }
    } catch {
      setStatus('Something went wrong');
    }
    setUploading(false);
    e.target.value = '';
  };

  const toggleSelect = (id) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const handleDelete = async (ids) => {
    if (!confirm(`Delete ${ids.length} photo${ids.length > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    const res = await fetch('/api/photos/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ids }),
    });
    if (res.ok) {
      await fetchPhotos();
      setSelectedIds(new Set());
      setSelectMode(false);
      setSelected(null);
    }
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
    if (res.ok) { setShareMsg(`✓ Shared with ${shareUsername}`); setShareUser(''); }
    else setShareMsg(`✗ ${data.error}`);
    setSharing(false);
  };

  // ── Emotion badge helper ──────────────────────────────────────────────────
  const EMOTION_EMOJI = {
    happy: '😊', excited: '🎉', surprised: '😮',
    calm: '😌', neutral: '😐', sad: '😢',
    fearful: '😨', angry: '😠', disgusted: '🤢',
  };

  return (
    <>
      <Header />
      <Sidebar />
      <BottomNav />

      <main
        style={{
          marginLeft: '0',
          marginTop: '64px',
          padding: '1.5rem',
          paddingBottom: '90px',
          minHeight: 'calc(100vh - 64px - 90px)',
          backgroundColor: '#f8fafc',
          transition: 'margin-left 0.3s',
        }}
        className="lg:ml-[240px] lg:p-10 lg:pb-10"
      >
        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: 0, color: '#111827' }}>
            Your Gallery
          </h1>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>

            {/* Re-analyse button — only shown when models are loaded */}
            {modelsLoaded && photos.length > 0 && !selectMode && (
              <button
                onClick={handleReanalyze}
                disabled={reanalyzing}
                title="Re-run emotion detection on all existing photos"
                style={{
                  padding: '0.8rem 1.25rem',
                  backgroundColor: reanalyzing ? '#e0e7ff' : '#eef2ff',
                  color: '#4f46e5',
                  border: '1px solid #c7d2fe',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: reanalyzing ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                {reanalyzing ? (
                  <>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    {reanalyzeProgress
                      ? `${reanalyzeProgress.done}/${reanalyzeProgress.total}`
                      : 'Analysing…'}
                  </>
                ) : (
                  <>🔍 Re-analyse Emotions</>
                )}
              </button>
            )}

            {/* Select / Cancel */}
            {photos.length > 0 && (
              <button
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
                style={{
                  padding: '0.8rem 1.25rem',
                  backgroundColor: selectMode ? '#f3f4f6' : 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}

            {/* Delete selected */}
            {selectMode && selectedIds.size > 0 && (
              <button
                onClick={() => handleDelete([...selectedIds])}
                disabled={deleting}
                style={{
                  padding: '0.8rem 1.25rem',
                  backgroundColor: deleting ? '#9ca3af' : '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                {deleting ? 'Deleting…' : `Delete (${selectedIds.size})`}
              </button>
            )}

            {/* Upload */}
            {!selectMode && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.8rem 1.5rem',
                  backgroundColor: uploading || !modelsLoaded ? '#9ca3af' : '#2563eb',
                  color: 'white',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: uploading || !modelsLoaded ? 'not-allowed' : 'pointer',
                }}
              >
                {uploading
                  ? uploadStatus || 'Uploading…'
                  : modelsLoaded ? 'Upload Photos' : 'Loading AI…'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  disabled={uploading || !modelsLoaded}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>
        </div>

        {/* ── Status banners ──────────────────────────────────────────────── */}
        {uploadStatus && !uploading && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem',
            backgroundColor: uploadStatus.startsWith('✓') ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${uploadStatus.startsWith('✓') ? '#bbf7d0' : '#fecaca'}`,
            borderRadius: '8px',
            color: uploadStatus.startsWith('✓') ? '#166534' : '#dc2626',
            fontWeight: 600,
          }}>
            {uploadStatus}
          </div>
        )}

        {reanalyzeMsg && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem',
            backgroundColor: reanalyzeMsg.startsWith('✓') ? '#f0fdf4' : '#fef3c7',
            border: `1px solid ${reanalyzeMsg.startsWith('✓') ? '#bbf7d0' : '#fde68a'}`,
            borderRadius: '8px',
            color: reanalyzeMsg.startsWith('✓') ? '#166534' : '#92400e',
            fontWeight: 600,
          }}>
            {reanalyzeMsg}
          </div>
        )}

        {/* ── Photo grid ──────────────────────────────────────────────────── */}
        {photos.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '1rem',
          }}>
            {photos.map(photo => (
              <div
                key={photo.id}
                onClick={() => {
                  if (selectMode) toggleSelect(photo.id);
                  else { setSelected(photo); setShareMsg(''); setShareUser(''); }
                }}
                style={{
                  aspectRatio: '1/1',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: selectedIds.has(photo.id)
                    ? '0 0 0 3px #2563eb'
                    : '0 4px 10px rgba(0,0,0,0.1)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  position: 'relative',
                  opacity: selectedIds.has(photo.id) ? 0.85 : 1,
                }}
                onMouseEnter={e => { if (!selectMode) e.currentTarget.style.transform = 'scale(1.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <img
                  src={photo.url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />

                {/* Selection checkbox */}
                {selectMode && (
                  <div style={{
                    position: 'absolute', top: '0.5rem', left: '0.5rem',
                    width: 22, height: 22, borderRadius: '50%',
                    backgroundColor: selectedIds.has(photo.id) ? '#2563eb' : 'rgba(255,255,255,0.8)',
                    border: '2px solid white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selectedIds.has(photo.id) && (
                      <span style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>✓</span>
                    )}
                  </div>
                )}

                {/* Emotion badge — only shown when emotion is detected */}
                {!selectMode && photo.dominant_emotion && photo.dominant_emotion !== 'neutral' && (
                  <div style={{
                    position: 'absolute', bottom: '0.4rem', right: '0.4rem',
                    background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(4px)',
                    borderRadius: '100px',
                    padding: '2px 7px',
                    fontSize: 12,
                    color: 'white',
                    fontWeight: 600,
                    lineHeight: 1.6,
                  }}>
                    {EMOTION_EMOJI[photo.dominant_emotion] ?? ''} {photo.dominant_emotion}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '6rem 1rem', color: '#6b7280' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>No photos yet</p>
            <p>Upload some memories to get started</p>
          </div>
        )}
      </main>

      {/* ── Lightbox + share panel ──────────────────────────────────────── */}
      {selectedPhoto && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.9)',
            zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '95vw', maxHeight: '90vh',
              backgroundColor: 'white',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <img
              src={selectedPhoto.url}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }}
            />

            {/* AI description */}
            {selectedPhoto.ai_description && (
              <div style={{
                padding: '8px 16px',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
                fontSize: '0.82rem',
                color: '#374151',
                fontStyle: 'italic',
              }}>
                {selectedPhoto.ai_description}
              </div>
            )}

            {/* Emotion row */}
            {selectedPhoto.dominant_emotion && (
              <div style={{
                padding: '6px 16px',
                backgroundColor: '#f0f9ff',
                borderBottom: '1px solid #e0f2fe',
                fontSize: '0.82rem',
                color: '#0369a1',
                fontWeight: 600,
              }}>
                {EMOTION_EMOJI[selectedPhoto.dominant_emotion] ?? ''} Emotion detected:{' '}
                <span style={{ textTransform: 'capitalize' }}>{selectedPhoto.dominant_emotion}</span>
                {selectedPhoto.face_count > 0 && (
                  <span style={{ marginLeft: 12, color: '#64748b', fontWeight: 400 }}>
                    · {selectedPhoto.face_count} face{selectedPhoto.face_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #e5e7eb', backgroundColor: 'white' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <button
                  onClick={() => handleDelete([selectedPhoto.id])}
                  disabled={deleting}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#fee2e2',
                    color: '#dc2626',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  🗑 Delete
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  value={shareUsername}
                  onChange={e => { setShareUser(e.target.value); setShareMsg(''); }}
                  placeholder="Share with username…"
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.9rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') handleShare(); }}
                />
                <button
                  onClick={handleShare}
                  disabled={sharing || !shareUsername.trim()}
                  style={{
                    padding: '0.6rem 1.1rem',
                    backgroundColor: sharing ? '#9ca3af' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: sharing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {sharing ? '…' : 'Share'}
                </button>
              </div>

              {shareMsg && (
                <p style={{
                  marginTop: '0.5rem', fontSize: '0.85rem', fontWeight: 600,
                  color: shareMsg.startsWith('✓') ? '#166534' : '#dc2626',
                }}>
                  {shareMsg}
                </p>
              )}
            </div>

            {/* Close */}
            <button
              onClick={() => setSelected(null)}
              style={{
                position: 'absolute', top: '0.75rem', right: '0.75rem',
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: 'white',
                border: 'none',
                width: '36px', height: '36px',
                borderRadius: '50%',
                fontSize: '1.4rem',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}