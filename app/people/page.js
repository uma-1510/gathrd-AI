'use client';

import { useEffect, useState, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';

const THRESHOLD = 0.55;

function euclidean(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s);
}

function averageDescriptor(descriptors) {
  const len = descriptors[0].length;
  const avg = new Array(len).fill(0);
  for (const d of descriptors) for (let i = 0; i < len; i++) avg[i] += d[i];
  return avg.map(v => v / descriptors.length);
}

export default function PeoplePage() {
  const [photos, setPhotos]             = useState([]);
  const [groups, setGroups]             = useState([]);   // face clusters
  const [namedPeople, setNamedPeople]   = useState([]);   // from DB
  const [loading, setLoading]           = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [taggingGroup, setTaggingGroup]   = useState(null);
  const [tagName, setTagName]             = useState('');
  const [saving, setSaving]               = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');

  useEffect(() => {
    Promise.all([loadModels(), fetchPhotos(), fetchPeople()]);
  }, []);

  const loadModels = async () => {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      setModelsLoaded(true);
    } catch (err) {
      console.error('Face models failed:', err);
      setModelsLoaded(true);
    }
  };

  const fetchPhotos = async () => {
    const res = await fetch('/api/photos');
    const data = await res.json();
    return data.photos || [];
  };

  const fetchPeople = async () => {
    const res = await fetch('/api/people');
    const data = await res.json();
    if (data.people) setNamedPeople(data.people);
  };

  useEffect(() => {
    if (!modelsLoaded) return;
    runFaceGrouping();
  }, [modelsLoaded]);

  const runFaceGrouping = async () => {
    setLoading(true);
    const photoList = await fetchPhotos();
    setPhotos(photoList);

    const analyzed = [];
    for (const photo of photoList) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = photo.url;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

        const detections = await faceapi
          .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptors();

        if (!detections.length) continue;

        const main = detections.reduce((a, b) =>
          b.detection.box.width * b.detection.box.height >
          a.detection.box.width * a.detection.box.height ? b : a
        );

        analyzed.push({
          photoId: photo.id,
          url: photo.url,
          filename: photo.filename,
          descriptor: Array.from(main.descriptor),
          faceCount: detections.length,
        });
      } catch {}
    }

    // Cluster by face similarity
    const clusters = [];
    for (const item of analyzed) {
      let best = null, bestDist = Infinity;
      for (const c of clusters) {
        const dist = euclidean(item.descriptor, c.centroid);
        if (dist < THRESHOLD && dist < bestDist) { bestDist = dist; best = c; }
      }
      if (best) {
        best.photos.push(item);
        best.centroid = averageDescriptor(best.photos.map(p => p.descriptor));
      } else {
        clusters.push({ id: Date.now() + clusters.length, photos: [item], centroid: item.descriptor });
      }
    }

    // Sort by photo count
    clusters.sort((a, b) => b.photos.length - a.photos.length);
    setGroups(clusters);
    setLoading(false);
  };

  const saveTag = async (group) => {
    if (!tagName.trim()) return;
    setSaving(true);
    try {
      const centroid = averageDescriptor(group.photos.map(p => p.descriptor));
      const coverUrl = group.photos[0]?.url;
      const photoIds = group.photos.map(p => p.photoId);

      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tagName.trim(),
          faceDescriptor: centroid,
          coverPhotoUrl: coverUrl,
          photoIds,
        }),
      });

      if (res.ok) {
        await fetchPeople();
        setTaggingGroup(null);
        setTagName('');
      }
    } catch (err) {
      console.error('Save tag error:', err);
    }
    setSaving(false);
  };

  const deletePerson = async (personId) => {
    if (!confirm('Remove this person tag?')) return;
    await fetch(`/api/people/${personId}`, { method: 'DELETE' });
    await fetchPeople();
  };

  const filteredGroups = groups.filter(g => {
    if (!searchQuery) return true;
    // Check if any tagged person name matches
    return true; // Show all ungrouped; named people filtered separately
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
        .fu { animation: fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) both; }
        .btn { display:inline-flex; align-items:center; gap:6px; padding:9px 18px; border-radius:100px; border:none; cursor:pointer; font-family:'Syne',sans-serif; font-size:12px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; transition:all 0.18s; }
        .btn:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(0,0,0,0.1); }
        .btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
        .btn-primary { background:#111; color:#f2efe9; }
        .btn-ghost { background:rgba(17,17,17,0.06); color:#111; border:1.5px solid rgba(17,17,17,0.12); }
        .btn-danger { background:rgba(220,38,38,0.07); color:#c0392b; border:1.5px solid rgba(220,38,38,0.18); }
        .person-card { background:#faf8f4; border:1px solid rgba(17,17,17,0.08); border-radius:16px; overflow:hidden; transition:all 0.2s; cursor:pointer; }
        .person-card:hover { transform:translateY(-3px); box-shadow:0 16px 40px rgba(0,0,0,0.1); }
        .face-group { background:#faf8f4; border:1.5px dashed rgba(17,17,17,0.15); border-radius:16px; padding:16px; transition:all 0.2s; }
        .face-group:hover { border-color:rgba(17,17,17,0.35); }
        .tag-input { width:100%; padding:10px 14px; background:rgba(17,17,17,0.04); border:1.5px solid rgba(17,17,17,0.12); border-radius:8px; outline:none; font-family:'Syne',sans-serif; font-size:14px; color:#111; transition:border-color 0.2s; }
        .tag-input:focus { border-color:rgba(17,17,17,0.5); background:#fff; }
        .modal-overlay { position:fixed; inset:0; background:rgba(8,5,3,0.65); z-index:2000; display:flex; align-items:center; justify-content:center; padding:24px; animation:fadeIn 0.15s ease both; }
        .modal-card { background:#faf8f4; border-radius:24px; padding:32px; width:100%; max-width:540px; max-height:82vh; display:flex; flex-direction:column; box-shadow:0 32px 80px rgba(0,0,0,0.22); animation:scaleIn 0.25s cubic-bezier(0.22,1,0.36,1) both; }
        .search-box { width:100%; max-width:360px; padding:11px 16px; background:#fff; border:1.5px solid rgba(17,17,17,0.12); border-radius:100px; outline:none; font-family:'Syne',sans-serif; font-size:13px; color:#111; transition:border-color 0.2s; }
        .search-box:focus { border-color:rgba(17,17,17,0.4); }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft:'240px', marginTop:'62px', padding:'36px 32px', minHeight:'calc(100vh - 62px)', background:'#f2efe9' }}>

        {/* Header */}
        <div className="fu" style={{ marginBottom:36 }}>
          <p style={{ fontSize:11, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(17,17,17,0.35)', marginBottom:6 }}>Your people</p>
          <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:'clamp(26px,3.5vw,40px)', fontWeight:400, fontStyle:'italic', color:'#111', letterSpacing:'-0.02em', marginBottom:8 }}>People & Faces</h1>
          <p style={{ fontSize:13, color:'rgba(17,17,17,0.45)', lineHeight:1.7 }}>
            Tag faces so the AI knows who's who. Once tagged, search "photos with Gautam" or "birthday with mom" and it'll find them instantly.
          </p>
        </div>

        {/* Named People section */}
        {namedPeople.length > 0 && (
          <div style={{ marginBottom:48 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'rgba(17,17,17,0.45)', margin:0 }}>
                Tagged People ({namedPeople.length})
              </h2>
              <input className="search-box" placeholder="Search people…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:16 }}>
              {namedPeople
                .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(person => (
                <div key={person.id} className="person-card">
                  <div style={{ height:140, background:'rgba(17,17,17,0.06)', overflow:'hidden', position:'relative' }}>
                    {person.cover_photo_url
                      ? <img src={person.cover_photo_url} alt={person.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      : <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36 }}>👤</div>
                    }
                  </div>
                  <div style={{ padding:'12px 14px' }}>
                    <div style={{ fontWeight:700, fontSize:14, color:'#111', marginBottom:4 }}>{person.name}</div>
                    <div style={{ fontSize:11, color:'rgba(17,17,17,0.4)', marginBottom:10 }}>{person.photo_count} photo{person.photo_count !== 1 ? 's' : ''}</div>
                    <button className="btn btn-danger" style={{ padding:'5px 12px', fontSize:11 }} onClick={() => deletePerson(person.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detected face groups */}
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'rgba(17,17,17,0.45)', margin:0 }}>
              {loading ? 'Analyzing faces…' : `Detected Faces (${groups.length} group${groups.length !== 1 ? 's' : ''})`}
            </h2>
            {!loading && (
              <button className="btn btn-ghost" onClick={runFaceGrouping} style={{ fontSize:11 }}>
                ↺ Reanalyze
              </button>
            )}
          </div>

          {loading && (
            <div style={{ textAlign:'center', padding:'60px 0', color:'rgba(17,17,17,0.4)' }}>
              <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:18, fontStyle:'italic', marginBottom:8 }}>Detecting and grouping faces…</p>
              <p style={{ fontSize:12 }}>This may take a minute for large galleries</p>
            </div>
          )}

          {!loading && groups.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 0', color:'rgba(17,17,17,0.4)' }}>
              <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:18, fontStyle:'italic' }}>No faces detected in your photos</p>
            </div>
          )}

          {!loading && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px,1fr))', gap:16 }}>
              {filteredGroups.map((group, idx) => (
                <div key={group.id} className="face-group">
                  {/* Photo strip — first 4 */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:12 }}>
                    {group.photos.slice(0, 4).map((p, i) => (
                      <div key={i} style={{ aspectRatio:'1', borderRadius:8, overflow:'hidden', background:'rgba(17,17,17,0.06)' }}>
                        <img src={p.url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:12, color:'rgba(17,17,17,0.45)', marginBottom:10 }}>
                    {group.photos.length} photo{group.photos.length !== 1 ? 's' : ''}
                  </div>

                  {taggingGroup?.id === group.id ? (
                    <div>
                      <input
                        className="tag-input"
                        placeholder="Enter name (e.g. Gautam)"
                        value={tagName}
                        onChange={e => setTagName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveTag(group); if (e.key === 'Escape') { setTaggingGroup(null); setTagName(''); } }}
                        autoFocus
                      />
                      <div style={{ display:'flex', gap:8, marginTop:8 }}>
                        <button className="btn btn-primary" style={{ flex:1, justifyContent:'center' }} onClick={() => saveTag(group)} disabled={saving || !tagName.trim()}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-ghost" onClick={() => { setTaggingGroup(null); setTagName(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="btn btn-primary" style={{ flex:1, justifyContent:'center', fontSize:11 }}
                        onClick={() => { setTaggingGroup(group); setTagName(''); }}>
                        + Tag person
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize:11 }}
                        onClick={() => setSelectedGroup(group)}>
                        View
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Group detail modal */}
      {selectedGroup && (
        <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h2 style={{ fontFamily:"'Instrument Serif',serif", fontSize:24, fontStyle:'italic', color:'#111', margin:0 }}>
                {selectedGroup.photos.length} photos — same person
              </h2>
              <button className="btn btn-ghost" style={{ padding:'6px 12px' }} onClick={() => setSelectedGroup(null)}>✕</button>
            </div>
            <div style={{ overflowY:'auto', flex:1 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10 }}>
                {selectedGroup.photos.map((p, i) => (
                  <div key={i} style={{ aspectRatio:'1', borderRadius:10, overflow:'hidden', background:'rgba(17,17,17,0.06)' }}>
                    <img src={p.url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop:20, borderTop:'1px solid rgba(17,17,17,0.08)', paddingTop:16 }}>
              <input
                className="tag-input"
                placeholder="Tag this person with a name…"
                value={tagName}
                onChange={e => setTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTag(selectedGroup); }}
              />
              <div style={{ display:'flex', gap:10, marginTop:10 }}>
                <button className="btn btn-primary" style={{ flex:1, justifyContent:'center' }}
                  onClick={() => saveTag(selectedGroup)} disabled={saving || !tagName.trim()}>
                  {saving ? 'Saving…' : '+ Tag as person'}
                </button>
                <button className="btn btn-ghost" onClick={() => setSelectedGroup(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}