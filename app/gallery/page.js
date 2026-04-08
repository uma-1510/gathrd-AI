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

  const fetchMedia = async () => {
    try {
      const [photosRes, videosRes] = await Promise.all([
        fetch('/api/photos'),
        fetch('/api/videos'),
      ]);

      const photosData = await photosRes.json().catch(() => ({}));
      const videosData = await videosRes.json().catch(() => ({}));

      if (!photosRes.ok) {
        console.error('Photos fetch failed:', photosData);
      }

      if (!videosRes.ok) {
        console.error('Videos fetch failed:', videosData);
      }

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

      const combined = [...photos, ...videos].sort(
        (a, b) =>
          new Date(b.date_taken || b.uploaded_at || 0) -
          new Date(a.date_taken || a.uploaded_at || 0)
      );

      setItems(combined);
    } catch (err) {
      console.error('FETCH MEDIA ERROR:', err);
    }
  };

  const uploadPhotos = async (files) => {
    if (!files.length) return 0;

    const formData = new FormData();
    files.forEach((file) => formData.append('photos', file));
    formData.append('faceResults', JSON.stringify([]));

    const res = await fetch('/api/photos/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Photo upload failed');
    }

    return data.photos?.length || files.length;
  };

  const uploadOneVideo = async (file) => {
    const createRes = await fetch('/api/videos/create-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name }),
    });

    const createData = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      throw new Error(createData.error || 'Failed to create video upload');
    }

    const { path, token } = createData;

    const { error: uploadError } = await supabase.storage
      .from('videos')
      .uploadToSignedUrl(path, token, file);

    if (uploadError) {
      throw new Error(uploadError.message || 'Video upload failed');
    }

    const saveRes = await fetch('/api/videos/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: path }),
    });

    const saveData = await saveRes.json().catch(() => ({}));

    if (!saveRes.ok) {
      throw new Error(saveData.error || 'Video save failed');
    }
  };

  const uploadVideos = async (files) => {
    let count = 0;

    for (const file of files) {
      await uploadOneVideo(file);
      count += 1;
    }

    return count;
  };

  const handleUpload = async (files) => {
    if (!files?.length) return;

    setUploading(true);
    setStatus(`Processing ${files.length} file${files.length > 1 ? 's' : ''}…`);

    try {
      const allFiles = Array.from(files);
      const photoFiles = allFiles.filter((file) => !isVideoFile(file));
      const videoFiles = allFiles.filter((file) => isVideoFile(file));

      const photoCount = await uploadPhotos(photoFiles);
      const videoCount = await uploadVideos(videoFiles);

      await fetchMedia();

      setUploadMsg(
        `Uploaded ${photoCount} photo${photoCount !== 1 ? 's' : ''} and ${videoCount} video${videoCount !== 1 ? 's' : ''}`
      );
    } catch (err) {
      console.error('Upload error:', err);
      setStatus('Something went wrong');
    }
    setUploading(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
      const selectedItems = items.filter((item) => selectedIds.has(item.id));

      await Promise.all(
        selectedItems.map((item) => {
          if (item.media_type === 'video') {
            return fetch(`/api/videos/${item.id}`, { method: 'DELETE' });
          }

          return fetch('/api/photos/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photoIds: [item.id] }),
          });
        })
      );

      setSelectedIds(new Set());
      setSelectMode(false);
      setSelectedIndex(null);

      await fetchMedia();
    } catch (err) {
      console.error('DELETE ERROR:', err);
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '2rem',
          }}
        >
          <div>
            <p style={{ fontSize: 12, color: 'rgba(17,17,17,0.45)', marginBottom: 6 }}>
              Your memories
            </p>
            <h1 style={{ fontSize: 32, margin: 0 }}>Gallery</h1>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                setSelectMode(!selectMode);
                setSelectedIds(new Set());
              }}
              style={{
                padding: '0.7rem 1rem',
                borderRadius: 8,
                border: '1px solid rgba(17,17,17,0.15)',
                background: selectMode ? '#111' : '#fff',
                color: selectMode ? '#fff' : '#111',
                cursor: 'pointer',
              }}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>

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

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleUpload(Array.from(e.dataTransfer.files || []));
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '2px dashed rgba(17,17,17,0.12)',
            borderRadius: 12,
            padding: '1.5rem',
            textAlign: 'center',
            marginBottom: '2rem',
            cursor: 'pointer',
            background: 'rgba(17,17,17,0.02)',
          }}
        >
          Drop photos & videos here or click to upload
        </div>

        <p style={{ marginBottom: '1rem' }}>Total items: {items.length}</p>

        {items.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {items.map((item, i) => (
              <div
                key={`${item.media_type}-${item.id}`}
                onClick={() => (selectMode ? toggleSelect(item.id) : setSelectedIndex(i))}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: selectedIds.has(item.id)
                    ? '0 0 0 3px #2563eb'
                    : '0 2px 8px rgba(0,0,0,0.08)',
                }}
              >
                {isVideoItem(item) ? (
                  <video
                    src={item.url || ''}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                      background: '#111',
                    }}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={item.url || ''}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                )}

                {isVideoItem(item) && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      right: 8,
                      color: '#fff',
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

                {selectMode && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: selectedIds.has(item.id)
                        ? '#2563eb'
                        : 'rgba(255,255,255,0.9)',
                      border: '2px solid white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selectedIds.has(item.id) && (
                      <span style={{ color: '#fff', fontSize: 12 }}>✓</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '5rem 2rem',
              color: 'rgba(17,17,17,0.35)',
            }}
          >
            No media yet
          </div>
        )}
      </main>

      {selectedItem && (
        <div
          onClick={() => setSelectedIndex(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,8,6,0.92)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            style={{
              position: 'fixed',
              left: 16,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 24,
              cursor: 'pointer',
            }}
          >
            ‹
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            style={{
              position: 'fixed',
              right: 16,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 24,
              cursor: 'pointer',
            }}
          >
            ›
          </button>

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#faf8f4',
              borderRadius: 16,
              overflow: 'hidden',
              maxWidth: 900,
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                flex: 1,
                background: '#111',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                maxHeight: '70vh',
              }}
            >
              {isVideoItem(selectedItem) ? (
                <video
                  src={selectedItem.url || ''}
                  controls
                  autoPlay
                  playsInline
                  style={{
                    maxWidth: '100%',
                    maxHeight: '70vh',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <img
                  src={selectedItem.url || ''}
                  alt=""
                  style={{
                    maxWidth: '100%',
                    maxHeight: '70vh',
                    objectFit: 'contain',
                  }}
                />
              )}
            </div>

            <div style={{ padding: '1rem 1.25rem' }}>
              <div style={{ marginBottom: '0.75rem', fontWeight: 600 }}>
                {selectedItem.filename || selectedItem.storage_path || selectedItem.id}
              </div>

              {selectedItem.ai_description && (
                <p style={{ marginBottom: '0.75rem', color: '#374151' }}>
                  {selectedItem.ai_description}
                </p>
              )}

              {!isVideoItem(selectedItem) && (
                <div
                  style={{
                    fontSize: '0.9rem',
                    color: '#444',
                    lineHeight: 1.7,
                    marginBottom: '1rem',
                  }}
                >
                  <div><strong>Date taken:</strong> {selectedItem.date_taken || 'N/A'}</div>
                  <div><strong>Uploaded at:</strong> {selectedItem.uploaded_at || 'N/A'}</div>
                  <div><strong>Place:</strong> {selectedItem.place_name || 'N/A'}</div>
                  <div><strong>Camera make:</strong> {selectedItem.camera_make || 'N/A'}</div>
                  <div><strong>Camera model:</strong> {selectedItem.camera_model || 'N/A'}</div>
                  <div><strong>Width:</strong> {selectedItem.width || 'N/A'}</div>
                  <div><strong>Height:</strong> {selectedItem.height || 'N/A'}</div>
                  <div><strong>Format:</strong> {selectedItem.format || 'N/A'}</div>
                  <div><strong>Latitude:</strong> {selectedItem.latitude || 'N/A'}</div>
                  <div><strong>Longitude:</strong> {selectedItem.longitude || 'N/A'}</div>
                  <div><strong>Face count:</strong> {selectedItem.face_count ?? 'N/A'}</div>
                  <div><strong>Emotion:</strong> {selectedItem.dominant_emotion || 'N/A'}</div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setSelectedIndex(null)}
                  style={{
                    padding: '0.6rem 1.25rem',
                    borderRadius: 8,
                    border: 'none',
                    background: '#f3f4f6',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
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