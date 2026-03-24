'use client';

import { useEffect, useState, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';

const THRESHOLD = 0.52;

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function averageDescriptor(descriptors) {
  const len = descriptors[0].length;
  const avg = new Array(len).fill(0);
  for (const d of descriptors) for (let i = 0; i < len; i++) avg[i] += d[i];
  return avg.map(v => v / descriptors.length);
}

function FaceCrop({ url, box }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!url || !box) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      const pad = Math.max(box.width, box.height) * 0.3;
      const sx = Math.max(0, box.x - pad);
      const sy = Math.max(0, box.y - pad);
      const sw = Math.min(img.width - sx, box.width + pad * 2);
      const sh = Math.min(img.height - sy, box.height + pad * 2);
      c.width = 80; c.height = 80;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 80, 80);
    };
    img.src = url;
  }, [url, box]);
  return (
    <canvas ref={canvasRef}
      style={{ width: 80, height: 80, borderRadius: 10, objectFit: 'cover', display: 'block', background: 'rgba(17,17,17,0.06)' }}
    />
  );
}

export default function PeoplePage() {
  const [groups,       setGroups]       = useState([]);
  const [namedPeople,  setNamedPeople]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [tagName,      setTagName]      = useState('');
  const [taggingId,    setTaggingId]    = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [deleting,     setDeleting]     = useState(null); // personId being deleted
  const [confirmDelete, setConfirmDelete] = useState(null); // person object awaiting confirm
  const [selectedGroup, setSelectedGroup] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { loadModels(); fetchPeople(); }, []);

  const loadModels = async () => {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        faceapi.nets.faceExpressionNet.loadFromUri('/models'),
      ]);
      setModelsLoaded(true);
    } catch (err) {
      console.error('Face models failed:', err);
      setModelsLoaded(true);
    }
  };

  useEffect(() => { if (modelsLoaded) runFaceGrouping(); }, [modelsLoaded]);

  const fetchPeople = async () => {
    const res = await fetch('/api/people');
    const data = await res.json();
    if (data.people) setNamedPeople(data.people);
  };

  const runFaceGrouping = async () => {
    setLoading(true);
    const res = await fetch('/api/photos');
    const data = await res.json();
    const photoList = data.photos || [];
    const allFaces = [];

    for (const photo of photoList) {
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

        for (const det of detections) {
          allFaces.push({
            photoId:    photo.id,
            url:        photo.url,
            filename:   photo.filename,
            descriptor: Array.from(det.descriptor),
            box: {
              x: det.detection.box.x, y: det.detection.box.y,
              width: det.detection.box.width, height: det.detection.box.height,
            },
          });
        }
      } catch {}
    }

    const clusters = [];
    for (const face of allFaces) {
      let best = null, bestDist = Infinity;
      for (const c of clusters) {
        const dist = euclidean(face.descriptor, c.centroid);
        if (dist < THRESHOLD && dist < bestDist) { bestDist = dist; best = c; }
      }
      if (best) {
        best.faces.push(face);
        best.centroid = averageDescriptor(best.faces.map(f => f.descriptor));
      } else {
        clusters.push({ id: `cluster-${Date.now()}-${clusters.length}`, faces: [face], centroid: face.descriptor });
      }
    }

    clusters.sort((a, b) => b.faces.length - a.faces.length);
    setGroups(clusters);
    setLoading(false);
  };

  // ── Match a cluster to an already-tagged person (for the "Re-tag" flow) ──
  // Returns the person record if this cluster's centroid is close to a known person.
  const findExistingTagForCluster = (group) => {
    // We can't run the DB matcher client-side, but we can check if any
    // namedPeople has the same cover photo as one of the cluster's photos —
    // that's a reliable signal that this cluster was previously tagged.
    const clusterPhotoUrls = new Set(group.faces.map(f => f.url));
    return namedPeople.find(p => p.cover_photo_url && clusterPhotoUrls.has(p.cover_photo_url)) || null;
  };

  // ── Tag (or re-tag) a cluster ─────────────────────────────────────────────
  const handleTag = async (group) => {
    if (!tagName.trim()) return;
    setSaving(true);
    try {
      const centroid  = averageDescriptor(group.faces.map(f => f.descriptor));
      const photoIds  = [...new Set(group.faces.map(f => f.photoId))];
      const coverUrl  = group.faces[0]?.url;

      // If this cluster was previously tagged, send the old person's id so
      // the API can clean up the old record before writing the new one.
      const existing  = findExistingTagForCluster(group);
      const oldPersonId = existing ? existing.id : undefined;

      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tagName.trim(),
          faceDescriptor: centroid,
          coverPhotoUrl: coverUrl,
          photoIds,
          oldPersonId,   // ← tells API to overwrite the old tag
        }),
      });

      if (res.ok) {
        await fetchPeople();
        setTaggingId(null);
        setTagName('');
        setSelectedGroup(null);
      }
    } catch (err) {
      console.error('Tag error:', err);
    }
    setSaving(false);
  };

  // ── Delete a tagged person entirely ──────────────────────────────────────
  const handleDelete = async (person) => {
    setDeleting(person.id);
    try {
      const res = await fetch('/api/people', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: person.id }),
      });
      if (res.ok) {
        await fetchPeople();
        setConfirmDelete(null);
      }
    } catch (err) {
      console.error('Delete error:', err);
    }
    setDeleting(null);
  };

  const startTagging = (groupId) => {
    setTaggingId(groupId);
    setTagName('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const uniquePhotos = (group) => {
    const seen = new Set();
    return group.faces.filter(f => {
      if (seen.has(f.photoId)) return false;
      seen.add(f.photoId); return true;
    });
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }

        @keyframes fadeUp  { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96) translateY(-6px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes spin    { to { transform: rotate(360deg); } }
        .fu { animation: fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) both; }

        .btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 18px; border-radius: 100px; border: none; cursor: pointer;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          transition: transform 0.18s, box-shadow 0.18s, opacity 0.18s;
        }
        .btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.1); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: #111; color: #f2efe9; }
        .btn-ghost   { background: rgba(17,17,17,0.06); color: #111; border: 1.5px solid rgba(17,17,17,0.12); }
        .btn-ghost:hover:not(:disabled) { background: rgba(17,17,17,0.1); }
        .btn-danger  { background: #dc2626; color: #fff; }
        .btn-danger-ghost { background: rgba(220,38,38,0.07); color: #dc2626; border: 1.5px solid rgba(220,38,38,0.2); }
        .btn-danger-ghost:hover:not(:disabled) { background: rgba(220,38,38,0.13); }

        .cluster-card {
          background: #faf8f4; border: 1.5px solid rgba(17,17,17,0.08);
          border-radius: 18px; padding: 16px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .cluster-card:hover { border-color: rgba(17,17,17,0.2); box-shadow: 0 8px 24px rgba(0,0,0,0.07); }

        .person-card {
          background: #faf8f4; border: 1px solid rgba(17,17,17,0.08);
          border-radius: 14px; overflow: hidden;
          transition: transform 0.2s, box-shadow 0.2s;
          position: relative;
        }
        .person-card:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,0,0,0.09); }
        .person-card:hover .delete-btn { opacity: 1; }

        /* Delete button hidden until card hover */
        .delete-btn {
          position: absolute; top: 8px; right: 8px;
          width: 28px; height: 28px; border-radius: 50%;
          background: rgba(220,38,38,0.9); color: #fff;
          border: none; cursor: pointer; font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.2s, transform 0.15s;
          z-index: 2;
        }
        .delete-btn:hover { transform: scale(1.1); }

        .tag-input {
          width: 100%; padding: 10px 14px;
          background: rgba(17,17,17,0.04); border: 1.5px solid rgba(17,17,17,0.12);
          border-radius: 10px; outline: none;
          font-family: 'Syne', sans-serif; font-size: 13px; color: #111;
          transition: border-color 0.2s, background 0.2s;
        }
        .tag-input:focus { border-color: rgba(17,17,17,0.5); background: #fff; }
        .tag-input::placeholder { color: rgba(17,17,17,0.3); }

        /* Retag badge on cluster cards */
        .retag-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 100px;
          background: rgba(17,17,17,0.06); border: 1px solid rgba(17,17,17,0.1);
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: rgba(17,17,17,0.5);
          margin-bottom: 8px;
        }

        .modal-overlay {
          position: fixed; inset: 0; background: rgba(8,5,3,0.72);
          z-index: 2000; display: flex; align-items: center; justify-content: center;
          padding: 24px; animation: fadeIn 0.15s ease both;
        }
        .modal-card {
          background: #faf8f4; border-radius: 22px; padding: 28px;
          width: 100%; max-width: 600px; max-height: 82vh;
          display: flex; flex-direction: column;
          box-shadow: 0 32px 80px rgba(0,0,0,0.24);
          animation: scaleIn 0.25s cubic-bezier(0.22,1,0.36,1) both;
        }

        /* Confirm delete modal */
        .confirm-modal {
          background: #faf8f4; border-radius: 20px; padding: 28px 28px 24px;
          width: 100%; max-width: 380px;
          box-shadow: 0 32px 80px rgba(0,0,0,0.24);
          animation: scaleIn 0.2s cubic-bezier(0.22,1,0.36,1) both;
        }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft: '240px', marginTop: '62px', padding: '36px 32px', minHeight: 'calc(100vh - 62px)', background: '#f2efe9' }}>

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="fu" style={{ marginBottom: 36 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 6 }}>
            Face detection
          </p>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(26px,3.5vw,40px)', fontWeight: 400, fontStyle: 'italic', color: '#111', letterSpacing: '-0.02em', marginBottom: 8 }}>
            People & Faces
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.45)', lineHeight: 1.7, maxWidth: 520 }}>
            Every face is detected and grouped automatically. Tag a group with a name — hover a tag to delete it, or re-tag to overwrite.
          </p>
        </div>

        {/* ── Tagged people section ─────────────────────────────────────── */}
        {namedPeople.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 16 }}>
              Tagged ({namedPeople.length})
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {namedPeople.map(person => (
                <div key={person.id} className="person-card"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px' }}>

                  {/* ── Delete button (appears on hover via CSS) */}
                  <button
                    className="delete-btn"
                    title={`Delete tag "${person.name}"`}
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(person); }}
                  >
                    ✕
                  </button>

                  <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', background: 'rgba(17,17,17,0.06)', flexShrink: 0 }}>
                    {person.cover_photo_url
                      ? <img src={person.cover_photo_url} alt={person.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
                    }
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: '#111' }}>{person.name}</div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.4)' }}>
                      {person.photo_count} photo{person.photo_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Detected face clusters ────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', margin: 0 }}>
            {loading ? 'Detecting faces…' : `Detected (${groups.length} group${groups.length !== 1 ? 's' : ''})`}
          </p>
          {!loading && (
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={runFaceGrouping}>
              ↺ Re-scan
            </button>
          )}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ width: 36, height: 36, border: '3px solid rgba(17,17,17,0.1)', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
            <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, fontStyle: 'italic', color: 'rgba(17,17,17,0.45)', marginBottom: 6 }}>
              Scanning all faces in your photos…
            </p>
            <p style={{ fontSize: 12, color: 'rgba(17,17,17,0.35)' }}>This may take a moment for large galleries</p>
          </div>
        )}

        {!loading && groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>👤</div>
            <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, fontStyle: 'italic', color: 'rgba(17,17,17,0.45)', marginBottom: 6 }}>No faces detected</p>
            <p style={{ fontSize: 12, color: 'rgba(17,17,17,0.35)' }}>Upload photos with people to see them here</p>
          </div>
        )}

        {/* Face cluster grid */}
        {!loading && groups.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {groups.map(group => {
              const isTagging   = taggingId === group.id;
              const photoCount  = new Set(group.faces.map(f => f.photoId)).size;
              const existingTag = findExistingTagForCluster(group); // null or person record

              return (
                <div key={group.id} className="cluster-card">

                  {/* Previously tagged badge */}
                  {existingTag && !isTagging && (
                    <div className="retag-badge">
                      ✓ Tagged as <strong style={{ marginLeft: 3 }}>{existingTag.name}</strong>
                    </div>
                  )}

                  {/* Face crops */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                    {group.faces.slice(0, 5).map((face, i) => (
                      <FaceCrop key={i} url={face.url} box={face.box} />
                    ))}
                    {group.faces.length > 5 && (
                      <div style={{ width: 80, height: 80, borderRadius: 10, background: 'rgba(17,17,17,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: 'rgba(17,17,17,0.45)' }}>
                        +{group.faces.length - 5}
                      </div>
                    )}
                  </div>

                  {/* Meta */}
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.4)', marginBottom: 12 }}>
                    {group.faces.length} appearance{group.faces.length !== 1 ? 's' : ''} · {photoCount} photo{photoCount !== 1 ? 's' : ''}
                  </div>

                  {/* Tag input or action buttons */}
                  {isTagging ? (
                    <div>
                      <input
                        ref={inputRef}
                        className="tag-input"
                        placeholder={existingTag ? `Rename "${existingTag.name}"…` : 'Enter their name…'}
                        value={tagName}
                        onChange={e => setTagName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleTag(group);
                          if (e.key === 'Escape') { setTaggingId(null); setTagName(''); }
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '8px 12px' }}
                          onClick={() => handleTag(group)} disabled={saving || !tagName.trim()}>
                          {saving ? '…' : existingTag ? 'Re-tag' : 'Save'}
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '8px 12px' }}
                          onClick={() => { setTaggingId(null); setTagName(''); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {/* "Re-tag" label when already tagged, "+ Tag" when fresh */}
                      <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '8px 12px' }}
                        onClick={() => startTagging(group.id)}>
                        {existingTag ? '✎ Re-tag' : '+ Tag'}
                      </button>
                      <button className="btn btn-ghost" style={{ padding: '8px 14px' }}
                        onClick={() => setSelectedGroup(group)}>
                        Photos
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Photo grid modal ──────────────────────────────────────────────── */}
      {selectedGroup && (
        <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
              <div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 4 }}>
                  {new Set(selectedGroup.faces.map(f => f.photoId)).size} photos
                </p>
                <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic', color: '#111' }}>
                  {findExistingTagForCluster(selectedGroup)?.name || 'All appearances'}
                </h2>
              </div>
              <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => setSelectedGroup(null)}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {uniquePhotos(selectedGroup).map((face, i) => (
                  <div key={i} style={{ aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: 'rgba(17,17,17,0.05)' }}>
                    <img src={face.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(17,17,17,0.08)', flexShrink: 0 }}>
              {taggingId === selectedGroup.id ? (
                <>
                  <input ref={inputRef} className="tag-input"
                    placeholder={findExistingTagForCluster(selectedGroup) ? `Rename "${findExistingTagForCluster(selectedGroup).name}"…` : 'Enter their name…'}
                    value={tagName}
                    onChange={e => setTagName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { handleTag(selectedGroup); setSelectedGroup(null); }
                      if (e.key === 'Escape') { setTaggingId(null); setTagName(''); }
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => { handleTag(selectedGroup); setSelectedGroup(null); }}
                      disabled={saving || !tagName.trim()}>
                      {saving ? '…' : 'Save tag'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => { setTaggingId(null); setTagName(''); }}>Cancel</button>
                  </div>
                </>
              ) : (
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => startTagging(selectedGroup.id)}>
                  {findExistingTagForCluster(selectedGroup) ? '✎ Re-tag this person' : '+ Tag this person'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete modal ──────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic', color: '#111', marginBottom: 8 }}>
              Delete "{confirmDelete.name}"?
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.55)', lineHeight: 1.65, marginBottom: 24 }}>
              This removes the tag and all photo links for <strong>{confirmDelete.name}</strong>. The photos themselves are not deleted. You can re-tag the cluster at any time.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }}
                disabled={deleting === confirmDelete.id}
                onClick={() => handleDelete(confirmDelete)}>
                {deleting === confirmDelete.id ? 'Deleting…' : 'Yes, delete tag'}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}