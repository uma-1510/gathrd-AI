'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import supabase from '@/lib/supabaseBrowser';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

const VIDEO_TYPES = [
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/webm', 'video/mov', 'video/x-matroska',
];

const isVideoFile = (file) =>
  VIDEO_TYPES.includes(file?.type) ||
  /\.(mp4|mov|avi|webm|mkv)$/i.test(file?.name || '');

const isVideoItem = (item) =>
  item?.media_type === 'video' ||
  item?.mime_type?.startsWith('video/') ||
  /\.(mp4|mov|avi|webm|mkv)$/i.test(item?.filename || '');

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  // FIX: manual location state
  const [manualLocation, setManualLocation] = useState('');
  const [showLocationInput, setShowLocationInput] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // FIX: manual location edit for existing photo
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  const fileInputRef = useRef(null);

  const selectedItem = useMemo(
    () => (selectedIndex !== null ? items[selectedIndex] : null),
    [items, selectedIndex]
  );

  useEffect(() => { fetchMedia(); }, []);

  // When lightbox opens, pre-fill location input
  useEffect(() => {
    if (selectedItem) {
      setLocationInput(selectedItem.place_name || '');
      setEditingLocation(false);
    }
  }, [selectedItem?.id]);

  const fetchMedia = async () => {
    try {
      const [photosRes, videosRes] = await Promise.all([
        fetch('/api/photos'),
        fetch('/api/videos'),
      ]);
      const photosData = await photosRes.json().catch(() => ({}));
      const videosData = await videosRes.json().catch(() => ({}));
      const photos = (photosData.photos || []).map(p => ({ ...p, media_type: 'photo' }));
      const videos = (videosData.videos || []).map(v => ({ ...v, media_type: 'video' }));
      const combined = [...photos, ...videos].sort(
        (a, b) => new Date(b.date_taken || b.uploaded_at || 0) - new Date(a.date_taken || a.uploaded_at || 0)
      );
      setItems(combined);
    } catch (err) {
      console.error('FETCH MEDIA ERROR:', err);
    }
  };

  const uploadPhotos = async (files, location) => {
    if (!files.length) return 0;
    const formData = new FormData();
    files.forEach(file => formData.append('photos', file));
    formData.append('faceResults', JSON.stringify([]));
    // FIX: send manual location to API
    if (location) formData.append('manualLocation', location);

    const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Photo upload failed');
    return data.photos?.length || files.length;
  };

  const uploadOneVideo = async (file, location) => {
    const createRes = await fetch('/api/videos/create-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok) throw new Error(createData.error || 'Failed to create video upload');
    const { path, token } = createData;
    const { error: uploadError } = await supabase.storage.from('videos').uploadToSignedUrl(path, token, file);
    if (uploadError) throw new Error(uploadError.message || 'Video upload failed');
    const saveRes = await fetch('/api/videos/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: path, place_name: location || null }),
    });
    const saveData = await saveRes.json().catch(() => ({}));
    if (!saveRes.ok) throw new Error(saveData.error || 'Video save failed');
  };

  const uploadVideos = async (files, location) => {
    let count = 0;
    for (const file of files) { await uploadOneVideo(file, location); count++; }
    return count;
  };

  // FIX: intercept upload — ask for location before uploading
  const handleFilesSelected = (files) => {
    if (!files?.length) return;
    setPendingFiles(Array.from(files));
    setManualLocation('');
    setShowLocationInput(true);
  };

  const handleUpload = async (location) => {
    const files = pendingFiles;
    if (!files?.length) return;
    setShowLocationInput(false);
    setPendingFiles(null);
    setUploading(true);
    setUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);

    try {
      const photoFiles = files.filter(f => !isVideoFile(f));
      const videoFiles = files.filter(f => isVideoFile(f));
      const photoCount = await uploadPhotos(photoFiles, location);
      const videoCount = await uploadVideos(videoFiles, location);
      await fetchMedia();
      setUploadStatus(`Uploaded ${photoCount} photo${photoCount !== 1 ? 's' : ''} and ${videoCount} video${videoCount !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('UPLOAD ERROR:', err);
      setUploadStatus(err?.message || 'Something went wrong while uploading');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // FIX: save location for an existing photo
  const handleSaveLocation = async () => {
    if (!selectedItem || !locationInput.trim()) return;
    setSavingLocation(true);
    try {
      await fetch(`/api/photos/${selectedItem.id}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_name: locationInput.trim() }),
      });
      // Update local state immediately
      setItems(prev => prev.map(item =>
        item.id === selectedItem.id ? { ...item, place_name: locationInput.trim() } : item
      ));
      setEditingLocation(false);
    } catch (err) {
      console.error('Save location error:', err);
    }
    setSavingLocation(false);
  };

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const handleDelete = async (ids) => {
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} item${ids.length !== 1 ? 's' : ''}?`)) return;
    setDeleting(true); setDeleteError('');
    try {
      const selectedItems = items.filter(item => ids.includes(item.id));
      await Promise.all(selectedItems.map(item =>
        item.media_type === 'video'
          ? fetch(`/api/videos/${item.id}`, { method: 'DELETE' })
          : fetch('/api/photos/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: [item.id] }) })
      ));
      setSelectedIds(new Set()); setSelectMode(false); setSelectedIndex(null);
      await fetchMedia();
    } catch (err) { console.error('DELETE ERROR:', err); setDeleteError('Failed to delete selected items'); }
    finally { setDeleting(false); }
  };

  const goPrev = () => {
    if (selectedIndex === null || !items.length) return;
    setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
  };
  const goNext = () => {
    if (selectedIndex === null || !items.length) return;
    setSelectedIndex(prev => (prev + 1) % items.length);
  };
  const closeLightbox = () => setSelectedIndex(null);

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return null; }
  };

  const inputStyle = {
    padding: '8px 12px', borderRadius: 8, border: '1.5px solid rgba(17,17,17,0.15)',
    fontFamily: 'inherit', fontSize: 13, outline: 'none', width: '100%', background: '#fff',
  };

  const btnStyle = (primary) => ({
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    background: primary ? '#111' : 'rgba(17,17,17,0.07)',
    color: primary ? '#fff' : '#111',
  });

  return (
    <>
      <Header />
      <Sidebar />
      <BottomNav />

      <main
        style={{ marginLeft: '0', marginTop: '64px', padding: '1.5rem', paddingBottom: '90px', minHeight: 'calc(100vh - 64px - 90px)', backgroundColor: '#f2efe9', transition: 'margin-left 0.3s' }}
        className="lg:ml-[240px] lg:p-10 lg:pb-10"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <div>
            <p style={{ fontSize: 12, color: 'rgba(17,17,17,0.45)', marginBottom: 6 }}>Your memories</p>
            <h1 style={{ fontSize: 32, margin: 0 }}>Gallery</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
              style={{ padding: '0.7rem 1rem', borderRadius: 8, border: '1px solid rgba(17,17,17,0.15)', background: selectMode ? '#111' : '#fff', color: selectMode ? '#fff' : '#111', cursor: 'pointer' }}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
            {selectMode && selectedIds.size > 0 && (
              <button onClick={() => handleDelete([...selectedIds])} disabled={deleting}
                style={{ padding: '0.7rem 1rem', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>
                {deleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
              </button>
            )}
            <label style={{ padding: '0.7rem 1rem', borderRadius: 8, background: uploading ? '#9ca3af' : '#111', color: '#fff', cursor: uploading ? 'not-allowed' : 'pointer' }}>
              {uploading ? 'Uploading...' : '+ Upload'}
              <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                disabled={uploading} onChange={e => handleFilesSelected(Array.from(e.target.files || []))} />
            </label>
          </div>
        </div>

        {uploadStatus && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fff', borderRadius: 8, border: '1px solid rgba(17,17,17,0.1)' }}>
            {uploadStatus}
          </div>
        )}

        {deleteError && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', color: '#991b1b' }}>
            {deleteError}
          </div>
        )}

        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFilesSelected(Array.from(e.dataTransfer.files || [])); }}
          onClick={() => fileInputRef.current?.click()}
          style={{ border: '2px dashed rgba(17,17,17,0.12)', borderRadius: 12, padding: '1.5rem', textAlign: 'center', marginBottom: '2rem', cursor: 'pointer', background: 'rgba(17,17,17,0.02)' }}
        >
          Drop photos & videos here or click to upload
        </div>

        <p style={{ marginBottom: '1rem' }}>Total items: {items.length}</p>

        {items.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {items.map((item, i) => (
              <div key={`${item.media_type}-${item.id}`}
                onClick={() => selectMode ? toggleSelect(item.id) : setSelectedIndex(i)}
                style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', boxShadow: selectedIds.has(item.id) ? '0 0 0 3px #2563eb' : '0 2px 8px rgba(0,0,0,0.08)' }}
              >
                {isVideoItem(item) ? (
                  <video src={item.url || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#111' }} muted playsInline preload="metadata" />
                ) : (
                  <img src={item.url || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
                {item.place_name && (
                  <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', maxWidth: 'calc(100% - 16px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📍 {item.place_name}
                  </div>
                )}
                {isVideoItem(item) && (
                  <div style={{ position: 'absolute', top: 8, right: 8, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: '4px 8px', fontSize: 12 }}>VIDEO</div>
                )}
                {selectMode && (
                  <div style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: '50%', background: selectedIds.has(item.id) ? '#2563eb' : 'rgba(255,255,255,0.9)', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selectedIds.has(item.id) && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'rgba(17,17,17,0.35)' }}>No media yet</div>
        )}
      </main>

      {/* ── Manual location modal — shown before upload ───────────────────── */}
      {showLocationInput && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#faf8f4', borderRadius: 18, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: '#111' }}>
              Where were these taken?
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.5)', marginBottom: 16, lineHeight: 1.5 }}>
              If your photos have GPS data we'll use that automatically. Otherwise enter a location here — or skip.
            </p>
            <input
              style={inputStyle}
              placeholder="e.g. Boston, MA or Elm Park"
              value={manualLocation}
              onChange={e => setManualLocation(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleUpload(manualLocation.trim() || null); }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button style={{ ...btnStyle(true), flex: 1 }} onClick={() => handleUpload(manualLocation.trim() || null)}>
                Upload
              </button>
              <button style={btnStyle(false)} onClick={() => { setShowLocationInput(false); setPendingFiles(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ──────────────────────────────────────────────────────── */}
      {selectedItem && (
        <div onClick={closeLightbox} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <button onClick={e => { e.stopPropagation(); goPrev(); }} style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 24, cursor: 'pointer' }}>‹</button>
          <button onClick={e => { e.stopPropagation(); goNext(); }} style={{ position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)', width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 24, cursor: 'pointer' }}>›</button>

          <div onClick={e => e.stopPropagation()} style={{ background: '#faf8f4', borderRadius: 16, overflow: 'hidden', maxWidth: 900, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '60vh' }}>
              {isVideoItem(selectedItem) ? (
                <video src={selectedItem.url || ''} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
              ) : (
                <img src={selectedItem.url || ''} alt="" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
              )}
            </div>

            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto' }}>
              {selectedItem.ai_description && (
                <p style={{ marginBottom: '0.75rem', color: '#374151', fontSize: 13, lineHeight: 1.6, fontStyle: 'italic' }}>
                  {selectedItem.ai_description}
                </p>
              )}

              {/* ── Metadata grid ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13, color: '#444', marginBottom: '1rem' }}>
                {formatDate(selectedItem.date_taken) && (
                  <div><span style={{ color: 'rgba(17,17,17,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date taken</span><br />{formatDate(selectedItem.date_taken)}</div>
                )}
                {formatDate(selectedItem.uploaded_at) && (
                  <div><span style={{ color: 'rgba(17,17,17,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uploaded</span><br />{formatDate(selectedItem.uploaded_at)}</div>
                )}
                {selectedItem.camera_make && (
                  <div><span style={{ color: 'rgba(17,17,17,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Camera</span><br />{[selectedItem.camera_make, selectedItem.camera_model].filter(Boolean).join(' ')}</div>
                )}
                {selectedItem.dominant_emotion && (
                  <div><span style={{ color: 'rgba(17,17,17,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Emotion</span><br />{selectedItem.dominant_emotion}</div>
                )}
                {(selectedItem.width && selectedItem.height) && (
                  <div><span style={{ color: 'rgba(17,17,17,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resolution</span><br />{selectedItem.width} × {selectedItem.height}</div>
                )}
                {selectedItem.face_count > 0 && (
                  <div><span style={{ color: 'rgba(17,17,17,0.4)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Faces</span><br />{selectedItem.face_count}</div>
                )}
              </div>

              {/* ── Location row with manual edit ── */}
              <div style={{ marginBottom: '1rem', padding: '10px 12px', background: 'rgba(17,17,17,0.03)', borderRadius: 10, border: '1px solid rgba(17,17,17,0.08)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(17,17,17,0.4)', marginBottom: 6 }}>📍 Location</div>
                {editingLocation ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      value={locationInput}
                      onChange={e => setLocationInput(e.target.value)}
                      placeholder="Enter location…"
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveLocation(); if (e.key === 'Escape') setEditingLocation(false); }}
                      autoFocus
                    />
                    <button style={btnStyle(true)} onClick={handleSaveLocation} disabled={savingLocation}>
                      {savingLocation ? '…' : 'Save'}
                    </button>
                    <button style={btnStyle(false)} onClick={() => setEditingLocation(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, color: selectedItem.place_name ? '#111' : 'rgba(17,17,17,0.3)' }}>
                      {selectedItem.place_name || 'No location — click to add'}
                    </span>
                    <button
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(17,17,17,0.07)', cursor: 'pointer', fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}
                      onClick={() => { setLocationInput(selectedItem.place_name || ''); setEditingLocation(true); }}
                    >
                      {selectedItem.place_name ? '✎ Edit' : '+ Add'}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={closeLightbox} style={{ padding: '0.6rem 1.25rem', borderRadius: 8, border: 'none', background: '#f3f4f6', cursor: 'pointer' }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}