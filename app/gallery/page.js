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

  const tileRefs = useRef({});

  const [selectedIndex, setSelectedIndex] = useState(null);

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
      .catch(() => setModels(true));
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

      const dominant = Object.entries(main.expressions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        name: file.name,
        faceCount: detections.length,
        dominantEmotion: dominant,
        descriptor: Array.from(main.descriptor),
      };
    } catch {
      return { name: file.name, faceCount: 0, dominantEmotion: null, descriptor: null };
    }
  };

  // ── Re-analyze emotions ───────────────────────────────────────────────────
  const handleReanalyze = async () => {
    if (!modelsLoaded || reanalyzing) return;
    setReanalyzing(true);
    setReanalyzeMsg('');
    setReanalyzeProgress({ done: 0, total: photos.length });

    const BATCH = 5;
    let totalUpdated = 0;

    for (let i = 0; i < photos.length; i += BATCH) {
      const batch = photos.slice(i, i + BATCH);
      try {
        const results = await Promise.all(
          batch.map(async (photo) => {
            if (photo.mime_type?.startsWith('video/')) return null;
            try {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.src = photo.url;
              await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
              const detections = await faceapi
                .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceExpressions()
                .withFaceDescriptors();
              if (!detections.length) return { photoId: photo.id, faceCount: 0, dominantEmotion: null, descriptor: null };
              const main = detections.reduce((a, b) =>
                b.detection.box.width * b.detection.box.height > a.detection.box.width * a.detection.box.height ? b : a
              );
              const dominant = Object.entries(main.expressions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
              return { photoId: photo.id, faceCount: detections.length, dominantEmotion: dominant, descriptor: Array.from(main.descriptor) };
            } catch { return null; }
          })
        );

        const valid = results.filter(Boolean);
        if (valid.length > 0) {
          const res = await fetch('/api/photos/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: valid }),
          });
          const d = await res.json();
          totalUpdated += d.updated ?? 0;
        }
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

  // ── Upload handler ────────────────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const imageFiles = files.filter(f => !isVideoFile(f));
    const videoFiles = files.filter(f => isVideoFile(f));

    setUploading(true);
    setStatus(`Processing ${files.length} file${files.length > 1 ? 's' : ''}…`);

    try {
      let faceResults = [];
      if (imageFiles.length > 0) {
        if (modelsLoaded) {
          setStatus(`Analysing faces in ${imageFiles.length} photo${imageFiles.length > 1 ? 's' : ''}…`);
          faceResults = await Promise.all(imageFiles.map(detectFaces));
        } else {
          faceResults = imageFiles.map(f => ({ name: f.name, faceCount: 0, dominantEmotion: null, descriptor: null }));
        }
      }

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
      const res = await fetch(`/api/photos/${editingLocation}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeName: locationInput.trim() }),
      });
      if (res.ok) {
        // Update the selected photo state immediately so UI reflects new location
        const newPlace = locationInput.trim();
        setSelected(prev => prev ? { ...prev, place_name: newPlace } : prev);
        // Also update the photos list so the gallery reflects it
        setPhotos(prev => prev.map(p => p.id === editingLocation ? { ...p, place_name: newPlace } : p));
      }
    } catch (err) {
      console.error('Save location error:', err);
    }
    setSavingLocation(false);
    setEditingLocation(null);
    setLocationInput('');
  };

  const startEditLocation = () => {
    if (!selectedPhoto) return;
    setEditingLocation(selectedPhoto.id);
    setLocationInput(selectedPhoto.place_name || '');
  };

  const cancelEditLocation = () => {
    setEditingLocation(null);
    setLocationInput('');
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
    setSelectedIndex(null);
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
        style={{ marginLeft: '0', marginTop: '64px', padding: '1.5rem', paddingBottom: '90px', minHeight: 'calc(100vh - 64px - 90px)', backgroundColor: '#f2efe9', transition: 'margin-left 0.3s' }}
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

            {!selectMode && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', backgroundColor: uploading ? '#9ca3af' : '#2563eb', color: 'white', borderRadius: '8px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}>
                {uploading ? uploadStatus || 'Uploading…' : '+ Upload'}
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
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: uploadStatus.startsWith('✓') ? '#f0fdf4' : '#fef2f2', border: `1px solid ${uploadStatus.startsWith('✓') ? '#bbf7d0' : '#fecaca'}`, borderRadius: '8px', color: uploadStatus.startsWith('✓') ? '#166534' : '#991b1b', fontSize: '0.9rem' }}>
            {uploadStatus}
          </div>
        )}
        {reanalyzeMsg && (
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontSize: '0.9rem' }}>
            {reanalyzeMsg}
          </div>
        )}
        {deleteError && (
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '0.9rem' }}>
            {deleteError}
          </div>
        )}

        {/* ── Photo grid ──────────────────────────────────────────────── */}
        {photos.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
            {photos.map(photo => {
              const isVideo = photo.mime_type?.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv)$/i.test(photo.filename || '');
              return (
                <div
                  key={photo.id}
                  ref={el => { if (el) tileRefs.current[photo.id] = el; }}
                  onClick={() => {
                    if (selectMode) {
                      toggleSelect(photo.id);
                    } else {
                      const idx = photos.indexOf(photo);
                      setSelected(photo);
                      setSelectedIndex(idx);
                      setTimeout(() => {
                        tileRefs.current[photo.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }, 50);
                    }
                  }}
                  style={{
                    aspectRatio: '1/1', borderRadius: '12px', overflow: 'hidden',
                    cursor: 'pointer', position: 'relative',
                    boxShadow: selectedIds.has(photo.id) ? '0 0 0 3px #2563eb' : '0 4px 12px rgba(0,0,0,0.1)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    opacity: selectMode && !selectedIds.has(photo.id) ? 0.85 : 1,
                  }}
                  onMouseEnter={e => { if (!selectMode) e.currentTarget.style.transform = 'scale(1.03)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  {isVideo ? (
                    <video src={photo.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                  ) : (
                    <img src={photo.url} alt={photo.ai_description || photo.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}

                  {/* Selection indicator */}
                  {selectMode && (
                    <div style={{
                      position: 'absolute', top: '0.5rem', left: '0.5rem',
                      width: 22, height: 22, borderRadius: '50%',
                      backgroundColor: selectedIds.has(photo.id) ? '#2563eb' : 'rgba(255,255,255,0.85)',
                      border: '2px solid white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selectedIds.has(photo.id) && <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✓</span>}
                    </div>
                  )}

                  {/* Location badge on thumbnail */}
                  {photo.place_name && !selectMode && (
                    <div style={{
                      position: 'absolute', bottom: 6, left: 6,
                      background: 'rgba(0,0,0,0.55)',
                      backdropFilter: 'blur(4px)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      padding: '2px 7px',
                      borderRadius: '20px',
                      maxWidth: 'calc(100% - 12px)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      📍 {photo.place_name}
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
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '960px', width: '100%' }}>

              {/* ← Prev */}
              <button
                onClick={() => {
                  if (selectedIndex === null || photos.length <= 1) return;
                  const prev = (selectedIndex - 1 + photos.length) % photos.length;
                  const photo = photos[prev];
                  setSelected(photo);
                  setSelectedIndex(prev);
                  setTimeout(() => tileRefs.current[photo.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                }}
                disabled={photos.length <= 1}
                style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: '#faf8f4', border: '1.5px solid rgba(17,17,17,0.12)', color: '#111', fontSize: 22, cursor: photos.length <= 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: photos.length <= 1 ? 0.2 : 1, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
                onMouseEnter={e => { if (photos.length > 1) e.currentTarget.style.transform = 'scale(1.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >‹</button>

              {/* Card */}
              <div style={{ background: '#faf8f4', borderRadius: '16px', overflow: 'hidden', flex: 1, minWidth: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

                {/* Close button */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={closeLightbox}
                    style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >×</button>
                </div>

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
                <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', background: '#faf8f4' }}>
                  {selectedPhoto.ai_description && (
                    <p style={{ margin: '0 0 1rem', color: '#111', lineHeight: 1.5 }}>{selectedPhoto.ai_description}</p>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                    {selectedPhoto.filename && (
                      <span style={{ fontSize: '0.8rem', color: 'rgba(17,17,17,0.45)' }}>📄 {selectedPhoto.filename}</span>
                    )}
                    {selectedPhoto.date_taken && (
                      <span style={{ fontSize: '0.8rem', color: 'rgba(17,17,17,0.45)' }}>📅 {formatDate(selectedPhoto.date_taken)}</span>
                    )}
                    {selectedPhoto.dominant_emotion && EMOTION_EMOJI[selectedPhoto.dominant_emotion] && (
                      <span style={{ fontSize: '0.8rem', color: 'rgba(17,17,17,0.45)' }}>{EMOTION_EMOJI[selectedPhoto.dominant_emotion]} {selectedPhoto.dominant_emotion}</span>
                    )}
                  </div>

                  {/* ── Location section ── */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    {editingLocation === selectedPhoto.id ? (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          value={locationInput}
                          onChange={e => setLocationInput(e.target.value)}
                          placeholder="e.g. Paris, France"
                          style={{ flex: 1, padding: '0.45rem 0.75rem', border: '1.5px solid rgba(17,17,17,0.2)', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', background: '#fff', color: '#111' }}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveLocation(); if (e.key === 'Escape') cancelEditLocation(); }}
                          autoFocus
                        />
                        <button
                          onClick={handleSaveLocation}
                          disabled={savingLocation || !locationInput.trim()}
                          style={{ padding: '0.45rem 0.9rem', background: savingLocation ? 'rgba(17,17,17,0.3)' : '#111', color: '#f2efe9', border: 'none', borderRadius: '8px', cursor: savingLocation ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                        >
                          {savingLocation ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEditLocation}
                          style={{ padding: '0.45rem 0.75rem', background: '#f2efe9', color: '#111', border: '1px solid rgba(17,17,17,0.12)', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {selectedPhoto.place_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(17,17,17,0.06)', border: '1px solid rgba(17,17,17,0.12)', color: '#111', borderRadius: '100px', padding: '0.3rem 0.8rem', fontSize: '0.82rem', fontWeight: 600 }}>
                            📍 {selectedPhoto.place_name}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.82rem', color: 'rgba(17,17,17,0.35)', fontStyle: 'italic' }}>
                            No location set
                          </span>
                        )}
                        <button
                          onClick={startEditLocation}
                          style={{ background: 'none', border: 'none', color: 'rgba(17,17,17,0.45)', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline', padding: 0 }}
                        >
                          {selectedPhoto.place_name ? 'Edit location' : '+ Add location'}
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
                      style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid rgba(17,17,17,0.15)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff', color: '#111', outline: 'none' }}
                      onKeyDown={e => e.key === 'Enter' && handleShare()}
                    />
                    <button onClick={handleShare} disabled={sharing} style={{ padding: '0.5rem 1rem', background: '#111', color: '#f2efe9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                      {sharing ? '…' : 'Share'}
                    </button>
                  </div>
                  {shareMsg && <p style={{ fontSize: '0.85rem', color: shareMsg.startsWith('✓') ? '#166534' : '#991b1b', margin: '0 0 0.75rem' }}>{shareMsg}</p>}

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete([selectedPhoto.id])}
                    disabled={deleting}
                    style={{ padding: '0.5rem 1rem', background: deleting ? 'rgba(17,17,17,0.06)' : 'rgba(220,38,38,0.07)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '8px', cursor: deleting ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                  >
                    {deleting ? 'Deleting…' : '🗑 Delete photo'}
                  </button>
                </div>
              </div>

              {/* → Next */}
              <button
                onClick={() => {
                  if (selectedIndex === null || photos.length <= 1) return;
                  const next = (selectedIndex + 1) % photos.length;
                  const photo = photos[next];
                  setSelected(photo);
                  setSelectedIndex(next);
                  setTimeout(() => tileRefs.current[photo.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                }}
                disabled={photos.length <= 1}
                style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: '#faf8f4', border: '1.5px solid rgba(17,17,17,0.12)', color: '#111', fontSize: 22, cursor: photos.length <= 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: photos.length <= 1 ? 0.2 : 1, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
                onMouseEnter={e => { if (photos.length > 1) e.currentTarget.style.transform = 'scale(1.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >›</button>

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