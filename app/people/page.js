'use client';

import { useEffect, useState, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';

// CLUSTERING threshold — how similar faces must be to belong to the same cluster
const CLUSTER_THRESHOLD = 0.58;

// MATCHING threshold — how similar a cluster must be to a NAMED person to show the badge
// This is STRICTER than clustering to avoid false "✓ YASHU" badges on wrong people
const MATCH_THRESHOLD = 0.40;

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

function Spinner({ size = 28 }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid rgba(17,17,17,0.1)`, borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
  );
}

export default function PeoplePage() {
  const [groups,         setGroups]         = useState([]);
  const [namedPeople,    setNamedPeople]    = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [modelsLoaded,   setModelsLoaded]   = useState(false);

  const [tagName,        setTagName]        = useState('');
  const [isMe,           setIsMe]           = useState(false);
  const [taggingId,      setTaggingId]      = useState(null);
  const [saving,         setSaving]         = useState(false);

  const [confirmDelete,  setConfirmDelete]  = useState(null);
  const [deleting,       setDeleting]       = useState(null);

  const [selectedGroup,  setSelectedGroup]  = useState(null);

  const [selectedPerson,   setSelectedPerson]   = useState(null);
  const [personPhotos,     setPersonPhotos]     = useState([]);
  const [loadingPhotos,    setLoadingPhotos]    = useState(false);
  const [editingName,      setEditingName]      = useState(false);
  const [editNameValue,    setEditNameValue]    = useState('');
  const [savingName,       setSavingName]       = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(new Set());
  const [photoSelectMode,  setPhotoSelectMode]  = useState(null);
  const [deletingPhotos,   setDeletingPhotos]   = useState(false);
  const [reassignTarget,   setReassignTarget]   = useState('');
  const [reassigning,      setReassigning]      = useState(false);

  const inputRef    = useRef(null);
  const editNameRef = useRef(null);

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
    } catch { setModelsLoaded(true); }
  };

  useEffect(() => { if (modelsLoaded) runFaceGrouping(); }, [modelsLoaded]);

  const fetchPeople = async () => {
    const res = await fetch('/api/people');
    const data = await res.json();
    if (data.people) setNamedPeople(data.people);
  };

  const runFaceGrouping = async () => {
    setLoading(true);
    const res = await fetch('/api/photos', { cache: 'no-store' });
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
            photoId: photo.id, url: photo.url, filename: photo.filename,
            descriptor: Array.from(det.descriptor),
            box: { x: det.detection.box.x, y: det.detection.box.y, width: det.detection.box.width, height: det.detection.box.height },
          });
        }
      } catch {}
    }

    const clusters = [];
    for (const face of allFaces) {
      let best = null, bestDist = Infinity;
      for (const c of clusters) {
        const dist = euclidean(face.descriptor, c.centroid);
        if (dist < CLUSTER_THRESHOLD && dist < bestDist) { bestDist = dist; best = c; }
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

  // FIX: use MATCH_THRESHOLD (0.40) instead of CLUSTER_THRESHOLD (0.58)
  // This prevents false badge matches on wrong people
  const findExistingTagForCluster = (group) => {
    let bestPerson = null, bestDist = Infinity;
    for (const person of namedPeople) {
      let descriptor = person.face_descriptor;
      if (typeof descriptor === 'string') {
        try { descriptor = JSON.parse(descriptor); } catch { continue; }
      }
      if (!Array.isArray(descriptor) || !descriptor.length) continue;
      const dist = euclidean(group.centroid, descriptor);
      // FIX: use stricter MATCH_THRESHOLD so only genuinely matching clusters get the badge
      if (dist < MATCH_THRESHOLD && dist < bestDist) {
        bestDist = dist;
        bestPerson = person;
      }
    }
    return bestPerson;
  };

  const handleTag = async (group) => {
    if (!tagName.trim()) return;
    setSaving(true);
    try {
      const centroid       = averageDescriptor(group.faces.map(f => f.descriptor));
      const photoIds       = [...new Set(group.faces.map(f => f.photoId))];
      const coverUrl       = group.faces[0]?.url;
      const existingByName = namedPeople.find(p => p.name.toLowerCase() === tagName.trim().toLowerCase());
      const existingByDesc = findExistingTagForCluster(group);
      const existing       = existingByName || existingByDesc;

      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tagName.trim(), faceDescriptor: centroid, coverPhotoUrl: coverUrl, photoIds, existingPersonId: existing?.id, isMe }),
      });
      if (res.ok) {
        await fetchPeople();
        setTaggingId(null); setTagName(''); setIsMe(false); setSelectedGroup(null);
      }
    } catch (err) { console.error('Tag error:', err); }
    setSaving(false);
  };

  const handleDeletePerson = async (person) => {
    setDeleting(person.id);
    try {
      const res = await fetch('/api/people', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: person.id }),
      });
      if (res.ok) { await fetchPeople(); setConfirmDelete(null); setSelectedPerson(null); }
    } catch (err) { console.error('Delete error:', err); }
    setDeleting(null);
  };

  const handlePersonClick = async (person) => {
    setSelectedPerson(person);
    setPersonPhotos([]);
    setSelectedPhotoIds(new Set());
    setPhotoSelectMode(null);
    setEditingName(false);
    setEditNameValue(person.name);
    setLoadingPhotos(true);
    try {
      const res = await fetch(`/api/people/photos?personId=${person.id}`);
      const data = await res.json();
      setPersonPhotos(data.photos || []);
    } catch (err) { console.error('Failed to load person photos:', err); }
    setLoadingPhotos(false);
  };

  const handleSaveName = async () => {
    if (!editNameValue.trim() || !selectedPerson) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/people/${selectedPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editNameValue.trim() }),
      });
      if (res.ok) {
        const updated = { ...selectedPerson, name: editNameValue.trim() };
        setSelectedPerson(updated);
        setNamedPeople(prev => prev.map(p => p.id === selectedPerson.id ? { ...p, name: editNameValue.trim() } : p));
        setEditingName(false);
      }
    } catch (err) { console.error('Save name error:', err); }
    setSavingName(false);
  };

  const handleDeletePhotos = async () => {
    if (!selectedPhotoIds.size || !selectedPerson) return;
    setDeletingPhotos(true);
    try {
      const res = await fetch('/api/people', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: selectedPerson.id, photoIds: [...selectedPhotoIds] }),
      });
      if (res.ok) {
        setPersonPhotos(prev => prev.filter(p => !selectedPhotoIds.has(p.id)));
        setSelectedPhotoIds(new Set());
        setPhotoSelectMode(null);
        const newCount = personPhotos.length - selectedPhotoIds.size;
        setSelectedPerson(prev => ({ ...prev, photo_count: newCount }));
        setNamedPeople(prev => prev.map(p => p.id === selectedPerson.id ? { ...p, photo_count: newCount } : p));
      }
    } catch (err) { console.error('Delete photos error:', err); }
    setDeletingPhotos(false);
  };

  const handleReassign = async () => {
    if (!selectedPhotoIds.size || !reassignTarget.trim() || !selectedPerson) return;
    setReassigning(true);
    try {
      const res = await fetch('/api/people/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPersonId: selectedPerson.id, toPersonName: reassignTarget.trim(), photoIds: [...selectedPhotoIds] }),
      });
      if (res.ok) {
        setPersonPhotos(prev => prev.filter(p => !selectedPhotoIds.has(p.id)));
        setSelectedPhotoIds(new Set());
        setPhotoSelectMode(null);
        setReassignTarget('');
        const newCount = personPhotos.length - selectedPhotoIds.size;
        setSelectedPerson(prev => ({ ...prev, photo_count: newCount }));
        await fetchPeople();
      }
    } catch (err) { console.error('Reassign error:', err); }
    setReassigning(false);
  };

  const togglePhotoSelect = (photoId) => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
      return next;
    });
  };

  const startTagging = (groupId) => {
    setTaggingId(groupId);
    setTagName('');
    setIsMe(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const uniquePhotos = (group) => {
    const seen = new Set();
    return group.faces.filter(f => { if (seen.has(f.photoId)) return false; seen.add(f.photoId); return true; });
  };

  const closePerson = () => {
    setSelectedPerson(null);
    setPersonPhotos([]);
    setSelectedPhotoIds(new Set());
    setPhotoSelectMode(null);
    setEditingName(false);
    setReassignTarget('');
  };

  const s = {
    btn: (primary, danger) => ({
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '8px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
      fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      transition: 'transform 0.15s, box-shadow 0.15s',
      background: danger ? '#dc2626' : primary ? '#111' : 'rgba(17,17,17,0.07)',
      color: danger || primary ? '#fff' : '#111',
      border: (!primary && !danger) ? '1.5px solid rgba(17,17,17,0.12)' : 'none',
    }),
    input: {
      width: '100%', padding: '10px 14px',
      background: 'rgba(17,17,17,0.04)', border: '1.5px solid rgba(17,17,17,0.12)',
      borderRadius: 10, outline: 'none',
      fontFamily: "'Syne', sans-serif", fontSize: 13, color: '#111',
    },
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes scaleIn { from{opacity:0;transform:scale(0.96) translateY(-6px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        .fu { animation: fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) both; }
        .modal-overlay { position:fixed;inset:0;background:rgba(8,5,3,0.75);z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn 0.15s ease both; }
        .modal-card { background:#faf8f4;border-radius:22px;padding:28px;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,0.28);animation:scaleIn 0.22s cubic-bezier(0.22,1,0.36,1) both; }
        .confirm-modal { background:#faf8f4;border-radius:20px;padding:28px;width:100%;max-width:380px;box-shadow:0 32px 80px rgba(0,0,0,0.24);animation:scaleIn 0.2s cubic-bezier(0.22,1,0.36,1) both; }
        .cluster-card { background:#faf8f4;border:1.5px solid rgba(17,17,17,0.08);border-radius:18px;padding:16px;transition:border-color 0.2s,box-shadow 0.2s; }
        .cluster-card:hover { border-color:rgba(17,17,17,0.2);box-shadow:0 8px 24px rgba(0,0,0,0.07); }
        .cluster-card.tagged { border-color:rgba(34,197,94,0.4);background:rgba(34,197,94,0.02); }
        .person-card { background:#faf8f4;border:1px solid rgba(17,17,17,0.08);border-radius:14px;overflow:hidden;transition:transform 0.2s,box-shadow 0.2s;position:relative;cursor:pointer; }
        .person-card:hover { transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,0.09); }
        .person-card:hover .del-btn { opacity:1; }
        .del-btn { position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(220,38,38,0.9);color:#fff;border:none;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;z-index:2; }
        .tag-input { width:100%;padding:10px 14px;background:rgba(17,17,17,0.04);border:1.5px solid rgba(17,17,17,0.12);border-radius:10px;outline:none;font-family:'Syne',sans-serif;font-size:13px;color:#111;transition:border-color 0.2s; }
        .tag-input:focus { border-color:rgba(17,17,17,0.5);background:#fff; }
        .tag-input::placeholder { color:rgba(17,17,17,0.3); }
        .retag-badge { display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:100px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(22,163,74,1);margin-bottom:8px; }
        .is-me-row { display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 10px;background:rgba(17,17,17,0.03);border-radius:8px;border:1px solid rgba(17,17,17,0.08);cursor:pointer;user-select:none; }
        .is-me-row input[type="checkbox"] { width:14px;height:14px;cursor:pointer;accent-color:#111; }
        .is-me-row label { font-size:12px;font-weight:600;color:rgba(17,17,17,0.6);cursor:pointer; }
        .merge-hint { font-size:11px;color:#2563eb;font-weight:600;padding:4px 0;margin-top:4px; }
        .photo-thumb { position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:rgba(17,17,17,0.05);cursor:pointer;transition:transform 0.15s; }
        .photo-thumb:hover { transform:scale(1.03); }
        .photo-thumb.selected { outline:3px solid #2563eb;outline-offset:2px; }
        .photo-thumb .check { position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;background:#2563eb;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700; }
        .photo-thumb .uncheck { position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.85);border:2px solid rgba(17,17,17,0.3); }
        .action-bar { display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid rgba(17,17,17,0.08);margin-top:12px;flex-shrink:0; }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft: '240px', marginTop: '62px', padding: '36px 32px', minHeight: 'calc(100vh - 62px)', background: '#f2efe9' }}>

        <div className="fu" style={{ marginBottom: 36 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 6 }}>Face detection</p>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(26px,3.5vw,40px)', fontWeight: 400, fontStyle: 'italic', color: '#111', marginBottom: 8 }}>People & Faces</h1>
          <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.45)', lineHeight: 1.7, maxWidth: 520 }}>
            Tag face clusters with names. Click a tagged person to view their photos, edit their name, remove wrong photos, or reassign misidentified ones.
          </p>
        </div>

        {/* Tagged people */}
        {namedPeople.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 16 }}>
              Tagged ({namedPeople.length})
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {namedPeople.map(person => (
                <div key={person.id} className="person-card"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px' }}
                  onClick={() => handlePersonClick(person)}>
                  <button className="del-btn" title="Delete person" onClick={e => { e.stopPropagation(); setConfirmDelete(person); }}>✕</button>
                  <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', background: 'rgba(17,17,17,0.06)', flexShrink: 0 }}>
                    {person.cover_photo_url
                      ? <img src={person.cover_photo_url} alt={person.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>}
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {person.name}
                      {person.is_self && <span style={{ fontSize: 9, background: '#111', color: '#f2efe9', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>ME</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(17,17,17,0.4)' }}>{person.photo_count} photo{person.photo_count !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detected clusters */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', margin: 0 }}>
            {loading ? 'Detecting faces…' : `Detected (${groups.length} group${groups.length !== 1 ? 's' : ''})`}
          </p>
          {!loading && <button style={s.btn(false)} onClick={runFaceGrouping}>↺ Re-scan</button>}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <Spinner size={36} />
            <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, fontStyle: 'italic', color: 'rgba(17,17,17,0.45)', marginTop: 20, marginBottom: 6 }}>Scanning all faces…</p>
            <p style={{ fontSize: 12, color: 'rgba(17,17,17,0.35)' }}>This may take a moment for large galleries</p>
          </div>
        )}

        {!loading && groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>👤</div>
            <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, fontStyle: 'italic', color: 'rgba(17,17,17,0.45)' }}>No faces detected</p>
          </div>
        )}

        {!loading && groups.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {groups.map(group => {
              const isTagging      = taggingId === group.id;
              const photoCount     = new Set(group.faces.map(f => f.photoId)).size;
              const existingTag    = findExistingTagForCluster(group);
              const suggestedMerge = tagName.trim()
                ? namedPeople.find(p => p.name.toLowerCase() === tagName.trim().toLowerCase())
                : null;

              return (
                <div key={group.id} className={`cluster-card${existingTag ? ' tagged' : ''}`}>
                  {existingTag && !isTagging && (
                    <div className="retag-badge">✓ {existingTag.name}</div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                    {group.faces.slice(0, 5).map((face, i) => <FaceCrop key={i} url={face.url} box={face.box} />)}
                    {group.faces.length > 5 && (
                      <div style={{ width: 80, height: 80, borderRadius: 10, background: 'rgba(17,17,17,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'rgba(17,17,17,0.45)' }}>
                        +{group.faces.length - 5}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: 'rgba(17,17,17,0.4)', marginBottom: 12 }}>
                    {group.faces.length} appearance{group.faces.length !== 1 ? 's' : ''} · {photoCount} photo{photoCount !== 1 ? 's' : ''}
                  </div>

                  {isTagging ? (
                    <div>
                      <input
                        ref={inputRef}
                        className="tag-input"
                        placeholder={existingTag ? `Currently: ${existingTag.name}` : 'Enter their name…'}
                        value={tagName}
                        onChange={e => setTagName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleTag(group);
                          if (e.key === 'Escape') { setTaggingId(null); setTagName(''); setIsMe(false); }
                        }}
                        list={`plist-${group.id}`}
                      />
                      <datalist id={`plist-${group.id}`}>
                        {namedPeople.map(p => <option key={p.id} value={p.name} />)}
                      </datalist>
                      {suggestedMerge && (
                        <div className="merge-hint">↗ Will merge with "{suggestedMerge.name}" ({suggestedMerge.photo_count} photos)</div>
                      )}
                      <div className="is-me-row" onClick={() => setIsMe(v => !v)}>
                        <input type="checkbox" checked={isMe} onChange={() => setIsMe(v => !v)} id={`isme-${group.id}`} />
                        <label htmlFor={`isme-${group.id}`}>This is me — enable "my photos" in assistant</label>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button style={{ ...s.btn(true), flex: 1, justifyContent: 'center', padding: '8px 12px' }}
                          onClick={() => handleTag(group)} disabled={saving || !tagName.trim()}>
                          {saving ? '…' : suggestedMerge ? 'Merge' : existingTag ? 'Re-tag' : 'Save'}
                        </button>
                        <button style={{ ...s.btn(false), padding: '8px 12px' }}
                          onClick={() => { setTaggingId(null); setTagName(''); setIsMe(false); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ ...s.btn(true), flex: 1, justifyContent: 'center', padding: '8px 12px' }}
                        onClick={() => { startTagging(group.id); if (existingTag) setTagName(existingTag.name); }}>
                        {existingTag ? '✎ Re-tag' : '+ Tag'}
                      </button>
                      <button style={{ ...s.btn(false), padding: '8px 14px' }}
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

      {/* ── Person detail modal ──────────────────────────────────────────── */}
      {selectedPerson && (
        <div className="modal-overlay" onClick={closePerson}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      ref={editNameRef}
                      style={{ ...s.input, flex: 1, fontSize: 16, fontWeight: 700, padding: '6px 12px' }}
                      value={editNameValue}
                      onChange={e => setEditNameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                      autoFocus
                    />
                    <button style={s.btn(true)} onClick={handleSaveName} disabled={savingName}>{savingName ? '…' : 'Save'}</button>
                    <button style={s.btn(false)} onClick={() => setEditingName(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic', color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {selectedPerson.name}
                      {selectedPerson.is_self && <span style={{ fontSize: 10, background: '#111', color: '#f2efe9', borderRadius: 4, padding: '2px 6px', fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>ME</span>}
                    </h2>
                    <button
                      onClick={() => { setEditingName(true); setEditNameValue(selectedPerson.name); setTimeout(() => editNameRef.current?.focus(), 50); }}
                      style={{ background: 'rgba(17,17,17,0.06)', border: '1px solid rgba(17,17,17,0.1)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#111' }}
                    >✎ Edit name</button>
                  </div>
                )}
                <p style={{ fontSize: 11, color: 'rgba(17,17,17,0.4)', marginTop: 4 }}>
                  {personPhotos.length} photo{personPhotos.length !== 1 ? 's' : ''}
                  {selectedPhotoIds.size > 0 && ` · ${selectedPhotoIds.size} selected`}
                </p>
              </div>
              <button style={{ ...s.btn(false), padding: '6px 12px', marginLeft: 12 }} onClick={closePerson}>✕</button>
            </div>

            {!editingName && personPhotos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexShrink: 0, flexWrap: 'wrap' }}>
                <button
                  style={{ ...s.btn(photoSelectMode === 'delete', photoSelectMode === 'delete'), fontSize: 11, padding: '6px 14px' }}
                  onClick={() => { setPhotoSelectMode(photoSelectMode === 'delete' ? null : 'delete'); setSelectedPhotoIds(new Set()); setReassignTarget(''); }}
                >
                  {photoSelectMode === 'delete' ? '✓ Selecting to remove' : '🗑 Remove wrong photos'}
                </button>
                <button
                  style={{ ...s.btn(photoSelectMode === 'reassign'), fontSize: 11, padding: '6px 14px' }}
                  onClick={() => { setPhotoSelectMode(photoSelectMode === 'reassign' ? null : 'reassign'); setSelectedPhotoIds(new Set()); setReassignTarget(''); }}
                >
                  {photoSelectMode === 'reassign' ? '✓ Selecting to reassign' : '↗ Reassign to another person'}
                </button>
                {photoSelectMode && selectedPhotoIds.size > 0 && (
                  <button style={{ ...s.btn(false), fontSize: 11, padding: '6px 14px' }}
                    onClick={() => setSelectedPhotoIds(new Set(personPhotos.map(p => p.id)))}>
                    Select all
                  </button>
                )}
              </div>
            )}

            {photoSelectMode && (
              <div style={{ fontSize: 12, color: 'rgba(17,17,17,0.5)', marginBottom: 10, padding: '8px 12px', background: 'rgba(17,17,17,0.03)', borderRadius: 8, flexShrink: 0 }}>
                {photoSelectMode === 'delete'
                  ? '👆 Tap photos that do NOT belong to this person, then click "Remove selected".'
                  : '👆 Tap photos that belong to a DIFFERENT person, then choose who they belong to.'}
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingPhotos ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>
              ) : personPhotos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'rgba(17,17,17,0.4)', fontSize: 13 }}>
                  No photos linked to {selectedPerson.name}.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                  {personPhotos.map(photo => {
                    const isSelected = selectedPhotoIds.has(photo.id);
                    return (
                      <div key={photo.id} className={`photo-thumb${isSelected ? ' selected' : ''}`}
                        onClick={() => photoSelectMode ? togglePhotoSelect(photo.id) : null}>
                        <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {photoSelectMode && (isSelected ? <div className="check">✓</div> : <div className="uncheck" />)}
                        {photo.place_name && !photoSelectMode && (
                          <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, borderRadius: 4, padding: '1px 5px', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            📍 {photo.place_name}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {photoSelectMode === 'delete' && selectedPhotoIds.size > 0 && (
              <div className="action-bar">
                <button style={s.btn(false, true)} onClick={handleDeletePhotos} disabled={deletingPhotos}>
                  {deletingPhotos ? '…' : `Remove ${selectedPhotoIds.size} photo${selectedPhotoIds.size !== 1 ? 's' : ''} from ${selectedPerson.name}`}
                </button>
                <button style={s.btn(false)} onClick={() => setSelectedPhotoIds(new Set())}>Clear</button>
              </div>
            )}

            {photoSelectMode === 'reassign' && selectedPhotoIds.size > 0 && (
              <div className="action-bar">
                <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(17,17,17,0.5)', whiteSpace: 'nowrap' }}>
                  Move {selectedPhotoIds.size} photo{selectedPhotoIds.size !== 1 ? 's' : ''} to:
                </span>
                <input
                  style={{ ...s.input, flex: 1, minWidth: 120, padding: '7px 12px', fontSize: 12 }}
                  placeholder="Person's name…"
                  value={reassignTarget}
                  onChange={e => setReassignTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleReassign(); }}
                  list="reassign-list"
                />
                <datalist id="reassign-list">
                  {namedPeople.filter(p => p.id !== selectedPerson.id).map(p => <option key={p.id} value={p.name} />)}
                </datalist>
                <button style={s.btn(true)} onClick={handleReassign} disabled={reassigning || !reassignTarget.trim()}>
                  {reassigning ? '…' : 'Move'}
                </button>
                <button style={s.btn(false)} onClick={() => setSelectedPhotoIds(new Set())}>Clear</button>
              </div>
            )}

            {!photoSelectMode && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(17,17,17,0.07)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(17,17,17,0.35)' }}>Remove this person entirely:</span>
                <button style={s.btn(false, true)} onClick={() => setConfirmDelete(selectedPerson)}>
                  Delete "{selectedPerson.name}"
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cluster photos modal ─────────────────────────────────────────── */}
      {selectedGroup && (
        <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 4 }}>
                  {new Set(selectedGroup.faces.map(f => f.photoId)).size} photos
                </p>
                <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic', color: '#111' }}>
                  {findExistingTagForCluster(selectedGroup)?.name || 'Untagged cluster'}
                </h2>
              </div>
              <button style={{ ...s.btn(false), padding: '6px 12px' }} onClick={() => setSelectedGroup(null)}>✕</button>
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
                    placeholder={findExistingTagForCluster(selectedGroup) ? `Currently: ${findExistingTagForCluster(selectedGroup).name}` : 'Enter their name…'}
                    value={tagName} onChange={e => setTagName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { handleTag(selectedGroup); setSelectedGroup(null); }
                      if (e.key === 'Escape') { setTaggingId(null); setTagName(''); setIsMe(false); }
                    }}
                    list="plist-modal"
                  />
                  <datalist id="plist-modal">{namedPeople.map(p => <option key={p.id} value={p.name} />)}</datalist>
                  <div className="is-me-row" style={{ marginTop: 8 }} onClick={() => setIsMe(v => !v)}>
                    <input type="checkbox" checked={isMe} onChange={() => setIsMe(v => !v)} />
                    <label>This is me — enable "my photos" in assistant</label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={{ ...s.btn(true), flex: 1, justifyContent: 'center' }}
                      onClick={() => { handleTag(selectedGroup); setSelectedGroup(null); }} disabled={saving || !tagName.trim()}>
                      {saving ? '…' : 'Save tag'}
                    </button>
                    <button style={s.btn(false)} onClick={() => { setTaggingId(null); setTagName(''); setIsMe(false); }}>Cancel</button>
                  </div>
                </>
              ) : (
                <button style={{ ...s.btn(true), width: '100%', justifyContent: 'center' }}
                  onClick={() => { const ex = findExistingTagForCluster(selectedGroup); startTagging(selectedGroup.id); if (ex) setTagName(ex.name); }}>
                  {findExistingTagForCluster(selectedGroup) ? '✎ Re-tag this person' : '+ Tag this person'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete modal ─────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic', color: '#111', marginBottom: 8 }}>
              Delete "{confirmDelete.name}"?
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.55)', lineHeight: 1.65, marginBottom: 24 }}>
              This removes the tag and all photo links for <strong>{confirmDelete.name}</strong>. The photos themselves are not deleted.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...s.btn(false, true), flex: 1, justifyContent: 'center' }}
                disabled={deleting === confirmDelete.id} onClick={() => handleDeletePerson(confirmDelete)}>
                {deleting === confirmDelete.id ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button style={s.btn(false)} onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}