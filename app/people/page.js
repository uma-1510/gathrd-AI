'use client';

import { useEffect, useState } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

const STORAGE_KEY = 'people-group-names';

export default function People() {
  const [groups, setGroups] = useState([]);
  const [otherUploads, setOtherUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editedName, setEditedName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedNames, setSavedNames] = useState({});

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setSavedNames(JSON.parse(stored));
      } catch (err) {
        console.error('Failed to parse saved names:', err);
      }
    }
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

  useEffect(() => {
    if (!modelsLoaded) return;
    fetchAndGroupPhotos();
  }, [modelsLoaded, savedNames]);

  const fetchAndGroupPhotos = async () => {
    try {
      setLoading(true);

      const res = await fetch('/api/photos');
      const data = await res.json();
      const fetchedPhotos = data.photos || [];

      const analyzed = [];
      const leftovers = [];

      for (const photo of fetchedPhotos) {
        const result = await extractFaceData(photo);
        if (result) {
          analyzed.push(result);
        } else {
          leftovers.push(photo);
        }
      }

      const grouped = groupFaces(analyzed, 0.58, 0.55).map((group, index) => {
        const groupId = createGroupId(group.photos);
        return {
          ...group,
          id: groupId,
          label: savedNames[groupId] || `🙂 Person ${index + 1}`,
          coverPhoto: group.photos[0],
        };
      });

      setGroups(grouped);
      setOtherUploads(leftovers);
    } catch (err) {
      console.error('People page error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      img.onload = () => resolve(img);
      img.onerror = reject;
    });

  const extractFaceData = async (photo) => {
    try {
      const img = await loadImage(photo.url);

      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (!detections.length) return null;

      const mainFace = detections.reduce((largest, current) => {
        const l = largest.detection.box;
        const c = current.detection.box;
        return c.width * c.height > l.width * l.height ? current : largest;
      });

      return {
        ...photo,
        descriptor: Array.from(mainFace.descriptor),
        faceCount: detections.length,
      };
    } catch (err) {
      console.error(`Failed analyzing ${photo.filename || photo.id}:`, err);
      return null;
    }
  };

  const euclideanDistance = (d1, d2) => {
    let sum = 0;
    for (let i = 0; i < d1.length; i++) {
      const diff = d1[i] - d2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  };

  const averageDescriptor = (descriptors) => {
    const length = descriptors[0].length;
    const avg = new Array(length).fill(0);

    for (const desc of descriptors) {
      for (let i = 0; i < length; i++) {
        avg[i] += desc[i];
      }
    }

    for (let i = 0; i < length; i++) {
      avg[i] /= descriptors.length;
    }

    return avg;
  };

  const groupFaces = (items, centerThreshold = 0.58, memberThreshold = 0.55) => {
    const grouped = [];

    for (const item of items) {
      let matchedGroup = null;
      let bestDistance = Infinity;

      for (const group of grouped) {
        const centerDist = euclideanDistance(item.descriptor, group.centerDescriptor);

        if (centerDist >= centerThreshold) continue;

        let minMemberDist = Infinity;
        for (const existingPhoto of group.photos) {
          const memberDist = euclideanDistance(item.descriptor, existingPhoto.descriptor);
          if (memberDist < minMemberDist) {
            minMemberDist = memberDist;
          }
        }

        if (minMemberDist < memberThreshold && centerDist < bestDistance) {
          bestDistance = centerDist;
          matchedGroup = group;
        }
      }

      if (matchedGroup) {
        matchedGroup.photos.push(item);
        matchedGroup.centerDescriptor = averageDescriptor(
          matchedGroup.photos.map((photo) => photo.descriptor)
        );
      } else {
        grouped.push({
          photos: [item],
          centerDescriptor: item.descriptor,
        });
      }
    }

    return grouped;
  };

  const createGroupId = (photos) => {
    return photos
      .map((photo) => photo.id)
      .sort((a, b) => a - b)
      .join('-');
  };

  const startEditing = (group, e) => {
    e.stopPropagation();
    setEditingGroupId(group.id);
    setEditedName(group.label);
  };

  const saveLabel = (groupId) => {
    const trimmed = editedName.trim();

    if (!trimmed) {
      setEditingGroupId(null);
      setEditedName('');
      return;
    }

    const updatedSavedNames = {
      ...savedNames,
      [groupId]: trimmed,
    };

    setSavedNames(updatedSavedNames);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSavedNames));

    const updatedGroups = groups.map((group) =>
      group.id === groupId ? { ...group, label: trimmed } : group
    );

    setGroups(updatedGroups);

    if (selectedGroup && selectedGroup.id === groupId) {
      const updatedSelected = updatedGroups.find((g) => g.id === groupId);
      setSelectedGroup(updatedSelected || null);
    }

    setEditingGroupId(null);
    setEditedName('');
  };

  const filteredGroups = groups.filter((group) =>
    group.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredOtherUploads = otherUploads.filter((photo) =>
    `${photo.filename || ''}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        }}
        className="lg:ml-[240px] lg:p-10 lg:pb-10"
      >
        <h1 style={{ fontSize: '2rem', color: '#111827', marginBottom: '0.5rem' }}>
          👥 People & Other Uploads
        </h1>

        <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
          Human faces are grouped as people. Uploads that are not confidently grouped appear in Other Uploads.
        </p>

        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 Search people or uploads..."
            style={{
              width: '100%',
              maxWidth: '420px',
              padding: '0.85rem 1rem',
              borderRadius: '12px',
              border: '1px solid #d1d5db',
              fontSize: '0.95rem',
              outline: 'none',
              backgroundColor: 'white',
              color: '#111827',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#2563eb')}
            onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
          />
        </div>

        {!modelsLoaded && <p style={{ color: '#6b7280' }}>⏳ Loading AI models...</p>}

        {modelsLoaded && loading && (
          <p style={{ color: '#6b7280' }}>🤖 Analyzing uploads and organizing them...</p>
        )}

        {modelsLoaded && !loading && filteredGroups.length === 0 && filteredOtherUploads.length === 0 && (
          <div style={{ color: '#6b7280' }}>
            😕 No matching people or uploads found.
          </div>
        )}

        {filteredGroups.length > 0 && (
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.5rem', color: '#111827', marginBottom: '1rem' }}>
              👥 People
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '1.25rem',
              }}
            >
              {filteredGroups.map((group) => (
                <div
                  key={group.id}
                  onClick={() => setSelectedGroup(group)}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    cursor: 'pointer',
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = '0 10px 24px rgba(0,0,0,0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                  }}
                >
                  <img
                    src={group.coverPhoto.url}
                    alt={group.label}
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      objectFit: 'cover',
                    }}
                  />

                  <div style={{ padding: '0.9rem 1rem' }}>
                    {editingGroupId === group.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
                      >
                        <input
                          type="text"
                          value={editedName}
                          onChange={(e) => setEditedName(e.target.value)}
                          placeholder="🙂 Enter name"
                          style={{
                            padding: '0.55rem 0.7rem',
                            borderRadius: '8px',
                            border: '1px solid #d1d5db',
                            fontSize: '0.9rem',
                          }}
                        />

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => saveLabel(group.id)}
                            style={{
                              flex: 1,
                              padding: '0.5rem 0.75rem',
                              backgroundColor: '#2563eb',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontWeight: '600',
                              cursor: 'pointer',
                            }}
                          >
                            ✅ Save
                          </button>

                          <button
                            onClick={() => {
                              setEditingGroupId(null);
                              setEditedName('');
                            }}
                            style={{
                              flex: 1,
                              padding: '0.5rem 0.75rem',
                              backgroundColor: '#f3f4f6',
                              color: '#374151',
                              border: 'none',
                              borderRadius: '8px',
                              fontWeight: '600',
                              cursor: 'pointer',
                            }}
                          >
                            ❌ Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            fontWeight: '700',
                            color: '#111827',
                            marginBottom: '0.25rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                          }}
                        >
                          <span>{group.label}</span>

                          <button
                            onClick={(e) => startEditing(group, e)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '1rem',
                            }}
                            title="Rename"
                          >
                            ✏️
                          </button>
                        </div>

                        <div style={{ fontSize: '0.9rem', color: '#6b7280' }}>
                          📷 {group.photos.length} photo{group.photos.length > 1 ? 's' : ''}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredOtherUploads.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', color: '#111827', marginBottom: '1rem' }}>
              📦 Other Uploads
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '1rem',
              }}
            >
              {filteredOtherUploads.map((photo) => (
                <div
                  key={photo.id}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '0.75rem',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                >
                  <img
                    src={photo.url}
                    alt={photo.filename || 'upload'}
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      objectFit: 'cover',
                      borderRadius: '10px',
                      marginBottom: '0.5rem',
                    }}
                  />

                  <div
                    style={{
                      fontSize: '0.82rem',
                      color: '#374151',
                      wordBreak: 'break-word',
                      fontWeight: '600',
                    }}
                  >
                    {photo.filename || 'Untitled upload'}
                  </div>

                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    Not confidently grouped
                  </div>

                  {photo.width && photo.height && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📐 {photo.width} × {photo.height}
                    </div>
                  )}

                  {photo.format && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      🧾 {String(photo.format).toUpperCase()}
                    </div>
                  )}

                  {photo.file_size && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📦 {(photo.file_size / 1024).toFixed(1)} KB
                    </div>
                  )}

                  {photo.camera_model && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📷 {photo.camera_model}
                    </div>
                  )}

                  {photo.date_taken && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      🕒 {new Date(photo.date_taken).toLocaleString()}
                    </div>
                  )}

                  {photo.latitude && photo.longitude && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📍 {Number(photo.latitude).toFixed(4)}, {Number(photo.longitude).toFixed(4)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {selectedGroup && (
        <div
          onClick={() => setSelectedGroup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              width: 'min(1000px, 95vw)',
              maxHeight: '90vh',
              overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h2 style={{ margin: 0, color: '#111827' }}>{selectedGroup.label}</h2>
                <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.9rem' }}>
                  🖼 {selectedGroup.photos.length} grouped photo
                  {selectedGroup.photos.length > 1 ? 's' : ''}
                </p>
              </div>

              <button
                onClick={() => setSelectedGroup(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.75rem',
                  cursor: 'pointer',
                  color: '#6b7280',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                padding: '1.25rem',
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '1rem',
              }}
            >
              {selectedGroup.photos.map((photo) => (
                <div
                  key={photo.id}
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    padding: '0.6rem',
                  }}
                >
                  <img
                    src={photo.url}
                    alt={photo.filename || 'photo'}
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      objectFit: 'cover',
                      borderRadius: '10px',
                      marginBottom: '0.5rem',
                    }}
                  />

                  <div
                    style={{
                      fontSize: '0.82rem',
                      color: '#374151',
                      wordBreak: 'break-word',
                      fontWeight: '600',
                    }}
                  >
                    {photo.filename}
                  </div>

                  {photo.faceCount && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      👤 {photo.faceCount} face(s)
                    </div>
                  )}

                  {photo.width && photo.height && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📐 {photo.width} × {photo.height}
                    </div>
                  )}

                  {photo.format && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      🧾 {String(photo.format).toUpperCase()}
                    </div>
                  )}

                  {photo.file_size && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📦 {(photo.file_size / 1024).toFixed(1)} KB
                    </div>
                  )}

                  {photo.camera_model && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📷 {photo.camera_model}
                    </div>
                  )}

                  {photo.date_taken && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      🕒 {new Date(photo.date_taken).toLocaleString()}
                    </div>
                  )}

                  {photo.latitude && photo.longitude && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      📍 {Number(photo.latitude).toFixed(4)}, {Number(photo.longitude).toFixed(4)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}