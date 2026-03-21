'use client';

import { useState, useEffect } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

export default function Gallery() {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [shareUsername, setShareUsername] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [personGroups, setPersonGroups] = useState([]);

  useEffect(() => {
    fetchPhotos();
  }, []);

  useEffect(() => {
    const loadModels = async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);
        setModelsLoaded(true);
      } catch (err) {
        console.error('Failed to load face models:', err);
      }
    };

    loadModels();
  }, []);

  const fetchPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.photos) setPhotos(data.photos);
  };

  const euclideanDistance = (d1, d2) => {
    let sum = 0;
    for (let i = 0; i < d1.length; i++) {
      const diff = d1[i] - d2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  };

  const groupFaces = (results, threshold = 0.6) => {
    const groups = [];

    for (const item of results) {
      let matchedGroup = null;
      let bestDistance = Infinity;

      for (const group of groups) {
        const dist = euclideanDistance(item.descriptor, group.representativeDescriptor);
        if (dist < threshold && dist < bestDistance) {
          bestDistance = dist;
          matchedGroup = group;
        }
      }

      if (matchedGroup) {
        matchedGroup.photos.push({
          name: item.name,
          previewUrl: item.previewUrl,
          faceCount: item.faceCount,
        });
      } else {
        groups.push({
          label: `Person ${groups.length + 1}`,
          representativeDescriptor: item.descriptor,
          photos: [
            {
              name: item.name,
              previewUrl: item.previewUrl,
              faceCount: item.faceCount,
            },
          ],
        });
      }
    }

    return groups;
  };

  const extractFaceData = async (file) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrl;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const detections = await faceapi
      .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!detections.length) {
      return {
        name: file.name,
        previewUrl: objectUrl,
        descriptor: null,
        faceCount: 0,
      };
    }

    const mainFace = detections.reduce((largest, current) => {
      const largestBox = largest.detection.box;
      const currentBox = current.detection.box;
      const largestArea = largestBox.width * largestBox.height;
      const currentArea = currentBox.width * currentBox.height;
      return currentArea > largestArea ? current : largest;
    });

    return {
      name: file.name,
      previewUrl: objectUrl,
      descriptor: Array.from(mainFace.descriptor),
      faceCount: detections.length,
    };
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (!modelsLoaded) {
      alert('AI models are still loading. Try again in a second.');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      const faceResults = [];

      for (const file of files) {
        const result = await extractFaceData(file);
        faceResults.push(result);
        formData.append('photos', file);
      }

      const validFaceResults = faceResults.filter((r) => r.descriptor);
      const grouped = groupFaces(validFaceResults, 0.6);
      setPersonGroups(grouped);

      const res = await fetch('/api/photos/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.photos) await fetchPhotos();
    } catch (err) {
      console.error('Face grouping/upload error:', err);
      alert('Something went wrong during face grouping or upload.');
    }

    setUploading(false);
  };

  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const selectAll = () => {
    if (selectedIds.size === photos.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(photos.map((p) => p.id)));
  };

  const handleDelete = async (idsToDelete) => {
    if (!confirm(`Delete ${idsToDelete.length} photo${idsToDelete.length > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    const res = await fetch('/api/photos/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: idsToDelete }),
    });
    if (res.ok) {
      await fetchPhotos();
      setSelectedIds(new Set());
      setSelectMode(false);
      setSelectedPhoto(null);
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
    if (res.ok) {
      setShareMsg(`✓ Shared with ${shareUsername}`);
      setShareUsername('');
    } else {
      setShareMsg(`✗ ${data.error}`);
    }
    setSharing(false);
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
          transition: 'margin-left 0.3s ease',
        }}
        className="lg:ml-[240px] lg:p-10 lg:pb-10"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <h1 style={{ fontSize: '2rem', fontWeight: '700', margin: 0, color: '#111827' }}>
            Your Gallery
          </h1>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {photos.length > 0 && (
              <button
                onClick={toggleSelectMode}
                style={{
                  padding: '0.8rem 1.25rem',
                  backgroundColor: selectMode ? '#f3f4f6' : 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}

            {selectMode && (
              <>
                <button
                  onClick={selectAll}
                  style={{
                    padding: '0.8rem 1.25rem',
                    backgroundColor: 'white',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  {selectedIds.size === photos.length ? 'Deselect All' : 'Select All'}
                </button>

                {selectedIds.size > 0 && (
                  <button
                    onClick={() => handleDelete([...selectedIds])}
                    disabled={deleting}
                    style={{
                      padding: '0.8rem 1.25rem',
                      backgroundColor: deleting ? '#9ca3af' : '#dc2626',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: '600',
                      cursor: deleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {deleting ? 'Deleting...' : `Delete (${selectedIds.size})`}
                  </button>
                )}
              </>
            )}

            {!selectMode && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.8rem 1.5rem',
                  backgroundColor: uploading ? '#9ca3af' : '#2563eb',
                  color: 'white',
                  borderRadius: '8px',
                  fontWeight: '600',
                  cursor: uploading || !modelsLoaded ? 'not-allowed' : 'pointer',
                }}
              >
                <span>
                  {uploading
                    ? 'Grouping faces + Uploading...'
                    : modelsLoaded
                    ? 'Upload Photos'
                    : 'Loading AI models...'}
                </span>
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

        {personGroups.length > 0 && (
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '1.25rem',
              marginBottom: '2rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
          >
            <h2 style={{ marginTop: 0, color: '#111827' }}>Grouped by Person</h2>
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              {personGroups.map((group) => (
                <div key={group.label}>
                  <h3 style={{ marginBottom: '0.75rem', color: '#2563eb' }}>
                    {group.label} ({group.photos.length} photo{group.photos.length > 1 ? 's' : ''})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
                    {group.photos.map((photo, idx) => (
                      <div
                        key={`${group.label}-${idx}`}
                        style={{
                          backgroundColor: '#f8fafc',
                          borderRadius: '10px',
                          padding: '0.5rem',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                        }}
                      >
                        <img
                          src={photo.previewUrl}
                          alt={photo.name}
                          style={{
                            width: '100%',
                            aspectRatio: '1/1',
                            objectFit: 'cover',
                            borderRadius: '8px',
                            marginBottom: '0.5rem',
                          }}
                        />
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#374151', wordBreak: 'break-word' }}>
                          {photo.name}
                        </p>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                          {photo.faceCount} face(s) detected
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {photos.length > 0 ? (
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: '600', color: '#4b5563', marginBottom: '1.25rem' }}>
              Your Photos ({photos.length})
              {selectMode && selectedIds.size > 0 && (
                <span style={{ fontSize: '1rem', color: '#2563eb', marginLeft: '0.75rem' }}>
                  {selectedIds.size} selected
                </span>
              )}
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '1rem',
              }}
            >
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => {
                    if (selectMode) toggleSelect(photo.id);
                    else {
                      setSelectedPhoto(photo);
                      setShareMsg('');
                      setShareUsername('');
                    }
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
                  onMouseEnter={(e) => {
                    if (!selectMode) e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {selectMode && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '0.5rem',
                        left: '0.5rem',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        backgroundColor: selectedIds.has(photo.id)
                          ? '#2563eb'
                          : 'rgba(255,255,255,0.8)',
                        border: '2px solid white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }}
                    >
                      {selectedIds.has(photo.id) && (
                        <span style={{ color: 'white', fontSize: '13px', fontWeight: 'bold' }}>✓</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '6rem 1rem', color: '#6b7280' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>No photos yet</p>
            <p>Upload some memories to get started</p>
          </div>
        )}
      </main>

      {selectedPhoto && (
        <div
          onClick={() => setSelectedPhoto(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.9)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '95vw',
              maxHeight: '90vh',
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
              style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
            />

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
                    fontWeight: '600',
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
                  onChange={(e) => {
                    setShareUsername(e.target.value);
                    setShareMsg('');
                  }}
                  placeholder="Share with username..."
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.9rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleShare();
                  }}
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
                    fontWeight: '600',
                    cursor: sharing ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sharing ? '...' : '🔗 Share'}
                </button>
              </div>

              {shareMsg && (
                <p
                  style={{
                    margin: '0.5rem 0 0',
                    fontSize: '0.85rem',
                    color: shareMsg.startsWith('✓') ? '#10b981' : '#dc2626',
                  }}
                >
                  {shareMsg}
                </p>
              )}
            </div>

            <button
              onClick={() => setSelectedPhoto(null)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: 'white',
                border: 'none',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                fontSize: '1.6rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}