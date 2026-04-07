'use client';

import { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

const EMOTION_EMOJI = {
  happy: '😊', excited: '🎉', surprised: '😮',
  calm: '😌', neutral: '😐', sad: '😢',
  fearful: '😨', angry: '😠', disgusted: '🤢',
};

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mov'];
const isVideoFile = (file) => VIDEO_TYPES.includes(file.type) || /\.(mp4|mov|avi|webm|mkv)$/i.test(file.name);

export default function Gallery() {
  const [photos, setPhotos]           = useState([]);
  const [selectedPhoto, setSelected]  = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setStatus]     = useState('');
  const [selectMode, setSelectMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting]       = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [shareUsername, setShareUser] = useState('');
  const [sharing, setSharing]         = useState(false);
  const [shareMsg, setShareMsg]       = useState('');
  const [modelsLoaded, setModels]     = useState(false);

  // Re-analysis state
  const [reanalyzing, setReanalyzing]             = useState(false);
  const [reanalyzeMsg, setReanalyzeMsg]           = useState('');
  const [reanalyzeProgress, setReanalyzeProgress] = useState(null);

  // Location edit state
  const [editingLocation, setEditingLocation] = useState(null);
  const [locationInput, setLocationInput]     = useState('');
  const [savingLocation, setSavingLocation]   = useState(false);

  useEffect(() => { fetchPhotos(); }, []);

  // ── Load face-api models in background — upload is NOT gated on this ──────
  useEffect(() => {
    Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      faceapi.nets.faceExpressionNet.loadFromUri('/models'),
    ])
      .then(() => setModels(true))
      .catch(() => setModels(true)); // fail silently — upload still works without face detection
  }, []);

  const fetchPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.photos) setPhotos(data.photos);
  };

  // ── detectFaces — skipped gracefully if models not ready ─────────────────
  const detectFaces = async (file) => {
    if (!modelsLoaded || isVideoFile(file)) {
      return { name: file.name, faceCount: 0, dominantEmotion: null, descriptor: null };
    }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions()
        .withFaceDescriptors();

      URL.revokeObjectURL(url);

      if (!detections.length) {
        return { name: file.name, faceCount: 0, dominantEmotion: null, descriptor: null };
      }

      const main = detections.reduce((a, b) =>
        b.detection.box.width * b.detection.box.height >
        a.detection.box.width * a.detection.box.height ? b : a
      );

      const dominantEmotion = Object.entries(main.expressions)
        .sort(([, a], [, b]) => b - a)[0][0];

      return {
        name: file.name,
        faceCount: detections.length,
        descriptor: Array.from(main.descriptor),
        dominantEmotion,
      };
    } catch {
      return { name: file.name, faceCount: 0, dominantEmotion: null, descriptor: null };
    }
  };

  // ── detectFacesFromUrl — for re-analysing existing photos ─────────────────
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

      if (!detections.length) return { photoId, faceCount: 0, dominantEmotion: null };

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

  // ── Re-analyse all photos for emotion data ────────────────────────────────
  const handleReanalyze = async () => {
    if (!modelsLoaded || !photos.length) return;
    setReanalyzing(true);
    setReanalyzeMsg('');
    setReanalyzeProgress({ done: 0, total: photos.length });

    const BATCH = 10;
    let totalUpdated = 0;

    for (let i = 0; i < photos.length; i += BATCH) {
      const batch = photos.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(p => detectFacesFromUrl(p.id, p.url)));

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

    await fetchPhotos();
    setReanalyzing(false);
    setReanalyzeProgress(null);
    setReanalyzeMsg(`✓ Done — updated ${totalUpdated} photo${totalUpdated !== 1 ? 's' : ''} with emotion data`);
    setTimeout(() => setReanalyzeMsg(''), 6000);
  };

  // ── Upload handler — works immediately, face detection optional ───────────
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const imageFiles = files.filter(f => !isVideoFile(f));
    const videoFiles = files.filter(f => isVideoFile(f));

    setUploading(true);
    setStatus(`Processing ${files.length} file${files.length > 1 ? 's' : ''}…`);

    try {
      // Run face detection on images only (skip if models not loaded yet)
      let faceResults = [];
      if (imageFiles.length > 0) {
        if (modelsLoaded) {
          setStatus(`Analysing faces in ${imageFiles.length} photo${imageFiles.length > 1 ? 's' : ''}…`);
          faceResults = await Promise.all(imageFiles.map(detectFaces));
        } else {
          // Models still loading — skip face detection, upload proceeds
          faceResults = imageFiles.map(f => ({ name: f.name, faceCount: 0, dominantEmotion: null, descriptor: null }));
        }
      }

      // Videos get empty face results
      const videoResults = videoFiles.map(f => ({ name: f.name, faceCount: 0, dominantEmotion: null, descriptor: null }));

      const formData = new FormData();
      files.forEach(f => formData.append('photos', f));
      formData.append('faceResults', JSON.stringify([...faceResults, ...videoResults]));

      setStatus('Uploading & generating AI captions…');
      const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.photos) {
        await fetchPhotos();
        const photoCount = data.photos.filter(p => !p.isVideo).length;
        const vidCount   = data.photos.filter(p => p.isVideo).length;
        const parts = [];
        if (photoCount > 0) parts.push(`${photoCount} photo${photoCount > 1 ? 's' : ''}`);
        if (vidCount > 0)   parts.push(`${vidCount} video${vidCount > 1 ? 's' : ''}`);
        setStatus(`✓ ${parts.join(' & ')} uploaded`);
        setTimeout(() => setStatus(''), 4000);
      } else {
        setStatus('Upload failed — ' + (data.error || 'unknown error'));
      }
    } catch (err) {
      console.error('Upload error:', err);
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
    setDeleteError('');
    try {
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
      } else {
        const data = await res.json();
        setDeleteError(data.error || 'Delete failed');
        setTimeout(() => setDeleteError(''), 5000);
      }
    } catch {
      setDeleteError('Delete failed — check your connection');
      setTimeout(() => setDeleteError(''), 5000);
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

  // ── Save manual location ──────────────────────────────────────────────────
  const handleSaveLocation = async () => {
    if (!locationInput.trim() || !editingLocation) return;
    setSavingLocation(true);
    try {
      await fetch(`/api/photos/${editingLocation}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeName: locationInput.trim() }),
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
      <Header />
      <Sidebar />
      <BottomNav />

      <main
        style={{ marginLeft: '0', marginTop: '64px', padding: '1.5rem', paddingBottom: '90px', minHeight: 'calc(100vh - 64px - 90px)', backgroundColor: '#f8fafc', transition: 'margin-left 0.3s' }}
        className="lg:ml-[240px] lg:p-10 lg:pb-10"
      >
        {/* ── Header row ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: 0, color: '#111827' }}>Your Gallery</h1>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>

            {modelsLoaded && photos.length > 0 && !selectMode && (
              <button
                onClick={handleReanalyze}
                disabled={reanalyzing}
                style={{ padding: '0.8rem 1.25rem', backgroundColor: reanalyzing ? '#e0e7ff' : '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', borderRadius: '8px', fontWeight: 600, cursor: reanalyzing ? 'not-allowed' : 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {reanalyzing ? (
                  <>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    {reanalyzeProgress ? `${reanalyzeProgress.done}/${reanalyzeProgress.total}` : 'Analysing…'}
                  </>
                ) : '🔍 Re-analyse Emotions'}
              </button>
            )}

            {photos.length > 0 && (
              <button
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
                style={{ padding: '0.8rem 1.25rem', backgroundColor: selectMode ? '#f3f4f6' : 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}

            {selectMode && selectedIds.size > 0 && (
              <button
                onClick={() => handleDelete([...selectedIds])}
                disabled={deleting}
                style={{ padding: '0.8rem 1.25rem', backgroundColor: deleting ? '#9ca3af' : '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}
              >
                {deleting ? 'Deleting…' : `Delete (${selectedIds.size})`}
              </button>
            )}

            {/* ── Upload button — always enabled, no longer gated on modelsLoaded ── */}
            {!selectMode && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', backgroundColor: uploading ? '#9ca3af' : '#2563eb', color: 'white', borderRadius: '8px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}>
                {uploading
                  ? uploadStatus || 'Uploading…'
                  : modelsLoaded ? '+ Upload' : '+ Upload'}
                {/* accept both images and videos */}
                <input
                  type="file"
                  accept="image/*,video/mp4,video/quicktime,video/x-msvideo,video/webm"
                  multiple
                  onChange={handleFileChange}
                  disabled={uploading}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>
        </div>

        {/* ── Status banners ──────────────────────────────────────────── */}
        {uploadStatus && !uploading && (
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: uploadStatus.startsWith('✓') ? '#f0fdf4' : '#fef2f2', border: `1px solid ${uploadStatus.startsWith('✓') ? '#bbf7d0' : '#fecaca'}`, borderRadius: '8px', color: uploadStatus.startsWith('✓') ? '#166534' : '#dc2626', fontWeight: 600 }}>
            {uploadStatus}
          </div>
        )}

        {deleteError && (
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontWeight: 600 }}>
            ✗ {deleteError}
          </div>
        )}

        {reanalyzeMsg && (
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: reanalyzeMsg.startsWith('✓') ? '#f0fdf4' : '#fef3c7', border: `1px solid ${reanalyzeMsg.startsWith('✓') ? '#bbf7d0' : '#fde68a'}`, borderRadius: '8px', color: reanalyzeMsg.startsWith('✓') ? '#166534' : '#92400e', fontWeight: 600 }}>
            {reanalyzeMsg}
          </div>
        )}

        {/* ── Face models loading hint (non-blocking) ───────────────── */}
        {!modelsLoaded && (
          <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#92400e', fontSize: '0.8rem' }}>
            ⏳ Loading face detection models in the background — upload works now, face tagging will activate shortly
          </div>
        )}

        {/* ── Photo grid ──────────────────────────────────────────────── */}
        {photos.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
            {photos.map((photo) => {
              const isVideo = photo.mime_type?.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv)$/i.test(photo.filename || '');
              return (
                <div
                  key={photo.id}
                  onClick={() => {
                    if (selectMode) toggleSelect(photo.id);
                    else setSelected(photo);
                  }}
                  style={{
                    position: 'relative',
                    aspectRatio: '1/1',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: selectedIds.has(photo.id)
                      ? '0 0 0 3px #2563eb'
                      : '0 2px 8px rgba(0,0,0,0.1)',
                    backgroundColor: '#e5e7eb',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}
                >
                  {isVideo ? (
                    <video
                      src={photo.url}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={photo.url}
                      alt={photo.ai_description || photo.filename}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      loading="lazy"
                    />
                  )}

                  {/* Video badge */}
                  {isVideo && (
                    <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.65)', color: 'white', borderRadius: 6, padding: '2px 7px', fontSize: '0.72rem', fontWeight: 700 }}>
                      ▶ VIDEO
                    </div>
                  )}

                  {/* Select checkbox */}
                  {selectMode && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 22, height: 22, borderRadius: '50%',
                      backgroundColor: selectedIds.has(photo.id) ? '#2563eb' : 'rgba(255,255,255,0.85)',
                      border: '2px solid white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selectedIds.has(photo.id) && <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✓</span>}
                    </div>
                  )}

                  {/* Emotion badge */}
                  {photo.dominant_emotion && EMOTION_EMOJI[photo.dominant_emotion] && !selectMode && (
                    <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: '1.1rem', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
                      {EMOTION_EMOJI[photo.dominant_emotion]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', color: '#6b7280' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📷</div>
            <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>No photos yet</p>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>Upload photos or videos to get started</p>
          </div>
        )}

        {/* ── Lightbox ──────────────────────────────────────────────── */}
        {selectedPhoto && (
          <div
            onClick={closeLightbox}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: 'white', borderRadius: '16px', overflow: 'hidden', maxWidth: '900px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            >
              {/* Media */}
              <div style={{ flex: 1, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '60vh', overflow: 'hidden' }}>
                {selectedPhoto.mime_type?.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv)$/i.test(selectedPhoto.filename || '') ? (
                  <video
                    src={selectedPhoto.url}
                    controls
                    autoPlay
                    style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }}
                  />
                ) : (
                  <img
                    src={selectedPhoto.url}
                    alt={selectedPhoto.ai_description || selectedPhoto.filename}
                    style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }}
                  />
                )}
              </div>

              {/* Info panel */}
              <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
                {selectedPhoto.ai_description && (
                  <p style={{ margin: '0 0 1rem', color: '#374151', lineHeight: 1.5 }}>{selectedPhoto.ai_description}</p>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                  {selectedPhoto.filename && <span>📄 {selectedPhoto.filename}</span>}
                  {selectedPhoto.date_taken && <span>📅 {formatDate(selectedPhoto.date_taken)}</span>}
                  {selectedPhoto.dominant_emotion && EMOTION_EMOJI[selectedPhoto.dominant_emotion] && (
                    <span>{EMOTION_EMOJI[selectedPhoto.dominant_emotion]} {selectedPhoto.dominant_emotion}</span>
                  )}
                </div>

                {/* Location */}
                <div style={{ marginBottom: '1rem' }}>
                  {editingLocation === selectedPhoto.id ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        value={locationInput}
                        onChange={e => setLocationInput(e.target.value)}
                        placeholder="Enter location…"
                        style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.85rem' }}
                        onKeyDown={e => e.key === 'Enter' && handleSaveLocation()}
                        autoFocus
                      />
                      <button onClick={handleSaveLocation} disabled={savingLocation} style={{ padding: '0.5rem 0.75rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        {savingLocation ? '…' : 'Save'}
                      </button>
                      <button onClick={() => { setEditingLocation(null); setLocationInput(''); }} style={{ padding: '0.5rem 0.75rem', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                        📍 {selectedPhoto.place_name || 'No location'}
                      </span>
                      <button
                        onClick={() => { setEditingLocation(selectedPhoto.id); setLocationInput(selectedPhoto.place_name || ''); }}
                        style={{ fontSize: '0.75rem', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {/* Share */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    value={shareUsername}
                    onChange={e => setShareUser(e.target.value)}
                    placeholder="Share with username…"
                    style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.85rem' }}
                    onKeyDown={e => e.key === 'Enter' && handleShare()}
                  />
                  <button onClick={handleShare} disabled={sharing} style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    {sharing ? '…' : 'Share'}
                  </button>
                </div>
                {shareMsg && <p style={{ fontSize: '0.85rem', color: shareMsg.startsWith('✓') ? '#166534' : '#dc2626', margin: '0 0 0.75rem' }}>{shareMsg}</p>}

                {/* Delete single photo */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button onClick={closeLightbox} style={{ padding: '0.6rem 1.25rem', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    Close
                  </button>
                  <button
                    onClick={() => { closeLightbox(); handleDelete([selectedPhoto.id]); }}
                    style={{ padding: '0.6rem 1.25rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}