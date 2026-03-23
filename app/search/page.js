'use client';

import { useState, useRef, useEffect } from 'react';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import { useRouter } from 'next/navigation';

const SUGGESTIONS = [
  "Show me photos from my birthday",
  "Photos with Gautam last month",
  "Best photos for Instagram today",
  "Vacation photos from 2024",
  "Photos from December",
  "Clear photos with good expressions",
  "Photos with mom this year",
  "Show me yesterday's photos",
];

export default function Search() {
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState(null);
  const [loading, setLoading]         = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [history, setHistory]         = useState([]);
  const inputRef = useRef(null);
  const router = useRouter();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = async (q) => {
    const trimmed = (q || query).trim();
    if (!trimmed) return;
    setLoading(true);
    setResults(null);
    setQuery(trimmed);
    setHistory(h => [trimmed, ...h.filter(x => x !== trimmed)].slice(0, 10));

    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      setResults({ error: 'Search failed', photos: [] });
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') search();
    if (e.key === 'Escape') { setQuery(''); setResults(null); }
  };

  const IntentBadges = ({ intent }) => {
    if (!intent) return null;
    const badges = [];
    if (intent.dateFilter?.year) badges.push({ label: `Year: ${intent.dateFilter.year}`, color: '#2563eb' });
    if (intent.dateFilter?.month) {
      const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      badges.push({ label: `Month: ${months[intent.dateFilter.month]}`, color: '#2563eb' });
    }
    if (intent.dateFilter?.day) badges.push({ label: `Day: ${intent.dateFilter.day}`, color: '#2563eb' });
    if (intent.dateFilter?.after) badges.push({ label: 'Recent', color: '#2563eb' });
    for (const name of (intent.peopleFilter || [])) badges.push({ label: `Person: ${name}`, color: '#7c3aed' });
    for (const ev of (intent.eventKeywords || [])) badges.push({ label: ev, color: '#059669' });
    if (intent.qualityFilter) badges.push({ label: 'Best quality', color: '#d97706' });

    if (!badges.length) return null;
    return (
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:20 }}>
        {badges.map((b, i) => (
          <span key={i} style={{
            padding:'4px 12px', borderRadius:100,
            background: b.color + '15', color: b.color,
            fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase',
            border:`1px solid ${b.color}30`
          }}>{b.label}</span>
        ))}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .fu { animation: fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .search-input {
          width:100%; padding:18px 24px;
          background:#fff; border:2px solid rgba(17,17,17,0.12);
          border-radius:100px; outline:none;
          font-family:'Syne',sans-serif; font-size:16px; color:#111;
          transition:all 0.2s;
          box-shadow:0 4px 24px rgba(0,0,0,0.06);
        }
        .search-input:focus { border-color:#111; box-shadow:0 4px 32px rgba(0,0,0,0.1); }
        .search-input::placeholder { color:rgba(17,17,17,0.3); }
        .search-btn {
          position:absolute; right:8px; top:50%; transform:translateY(-50%);
          padding:10px 22px; background:#111; color:#f2efe9;
          border:none; border-radius:100px; cursor:pointer;
          font-family:'Syne',sans-serif; font-size:12px; font-weight:700;
          letter-spacing:0.05em; text-transform:uppercase;
          transition:all 0.18s;
        }
        .search-btn:hover { background:#333; }
        .search-btn:disabled { background:rgba(17,17,17,0.3); cursor:not-allowed; }
        .suggestion-chip {
          padding:8px 16px; background:#fff;
          border:1.5px solid rgba(17,17,17,0.1); border-radius:100px;
          font-family:'Syne',sans-serif; font-size:12px; color:rgba(17,17,17,0.6);
          cursor:pointer; transition:all 0.18s; white-space:nowrap;
        }
        .suggestion-chip:hover { border-color:#111; color:#111; background:#f2efe9; }
        .photo-card {
          aspect-ratio:1/1; border-radius:12px; overflow:hidden; cursor:pointer;
          position:relative; transition:transform 0.2s;
          box-shadow:0 4px 12px rgba(0,0,0,0.08);
        }
        .photo-card:hover { transform:scale(1.03); box-shadow:0 12px 32px rgba(0,0,0,0.15); }
        .match-badge {
          position:absolute; top:8px; right:8px;
          padding:3px 8px; border-radius:100px;
          font-family:'Syne',sans-serif; font-size:10px; font-weight:700;
          background:rgba(0,0,0,0.6); color:#fff;
          backdrop-filter:blur(4px);
        }
        .people-badge {
          position:absolute; bottom:8px; left:8px;
          padding:3px 8px; border-radius:100px;
          font-family:'Syne',sans-serif; font-size:10px; font-weight:600;
          background:rgba(17,17,17,0.75); color:#fff;
          backdrop-filter:blur(4px);
        }
        .loading-dot { animation: pulse 1.2s ease infinite; }
        .loading-dot:nth-child(2) { animation-delay:0.2s; }
        .loading-dot:nth-child(3) { animation-delay:0.4s; }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft:'240px', marginTop:'62px', padding:'40px 32px', minHeight:'calc(100vh - 62px)', background:'#f2efe9' }}>

        {/* Search bar */}
        <div className="fu" style={{ maxWidth:700, margin:'0 auto 40px' }}>
          <p style={{ fontSize:11, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(17,17,17,0.35)', marginBottom:6, textAlign:'center' }}>
            Your personal photo AI
          </p>
          <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:'clamp(28px,3.5vw,42px)', fontWeight:400, fontStyle:'italic', color:'#111', textAlign:'center', marginBottom:28, lineHeight:1.15 }}>
            Ask anything about your photos
          </h1>

          <div style={{ position:'relative', marginBottom:20 }}>
            <input
              ref={inputRef}
              className="search-input"
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Show me photos from my birthday 2024…"
            />
            <button className="search-btn" onClick={() => search()} disabled={loading || !query.trim()}>
              {loading ? '…' : 'Search'}
            </button>
          </div>

          {/* Suggestions */}
          {!results && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="suggestion-chip" onClick={() => { setQuery(s); search(s); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign:'center', padding:'60px 0' }}>
            <div style={{ display:'flex', justifyContent:'center', gap:8, marginBottom:16 }}>
              {[0,1,2].map(i => (
                <div key={i} className="loading-dot" style={{ width:10, height:10, borderRadius:'50%', background:'rgba(17,17,17,0.3)' }}/>
              ))}
            </div>
            <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:16, fontStyle:'italic', color:'rgba(17,17,17,0.5)' }}>
              Understanding your query and searching…
            </p>
          </div>
        )}

        {/* Results */}
        {results && !loading && (
          <div className="fu">
            {/* Intent badges */}
            <IntentBadges intent={results.intent} />

            {/* Result count + query echo */}
            <div style={{ marginBottom:24 }}>
              {results.photos?.length > 0 ? (
                <p style={{ fontSize:13, color:'rgba(17,17,17,0.5)' }}>
                  Found <strong style={{ color:'#111' }}>{results.photos.length}</strong> photo{results.photos.length !== 1 ? 's' : ''} for "{results.query}"
                </p>
              ) : (
                <div style={{ textAlign:'center', padding:'60px 24px' }}>
                  <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:20, fontStyle:'italic', color:'rgba(17,17,17,0.45)', marginBottom:8 }}>
                    No photos found
                  </p>
                  <p style={{ fontSize:13, color:'rgba(17,17,17,0.35)', maxWidth:400, margin:'0 auto 24px' }}>
                    Try uploading more photos, or tag people so the AI can find them by name.
                  </p>
                  <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
                    <button style={{ padding:'10px 22px', background:'#111', color:'#f2efe9', border:'none', borderRadius:100, fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:700, cursor:'pointer', letterSpacing:'0.05em', textTransform:'uppercase' }}
                      onClick={() => router.push('/gallery')}>
                      Upload photos
                    </button>
                    <button style={{ padding:'10px 22px', background:'rgba(17,17,17,0.06)', color:'#111', border:'1.5px solid rgba(17,17,17,0.12)', borderRadius:100, fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:700, cursor:'pointer', letterSpacing:'0.05em', textTransform:'uppercase' }}
                      onClick={() => router.push('/people')}>
                      Tag people
                    </button>
                  </div>
                </div>
              )}
            </div>

            {results.photos?.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:14 }}>
                {results.photos.map(photo => (
                  <div key={photo.id} className="photo-card" onClick={() => setSelectedPhoto(photo)}>
                    <img src={photo.url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                    {photo.similarity_pct > 0 && (
                      <div className="match-badge">{photo.similarity_pct}%</div>
                    )}
                    {photo.people?.length > 0 && (
                      <div className="people-badge">{photo.people.join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* New search prompt */}
            {results.photos?.length > 0 && (
              <div style={{ marginTop:32, textAlign:'center' }}>
                <button style={{ padding:'10px 24px', background:'rgba(17,17,17,0.06)', color:'rgba(17,17,17,0.6)', border:'1.5px solid rgba(17,17,17,0.1)', borderRadius:100, fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:600, cursor:'pointer', letterSpacing:'0.04em' }}
                  onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}>
                  ← New search
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Photo lightbox */}
      {selectedPhoto && (
        <div onClick={() => setSelectedPhoto(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative', maxWidth:'95vw', maxHeight:'90vh', background:'white', borderRadius:14, overflow:'hidden', boxShadow:'0 32px 80px rgba(0,0,0,0.5)', display:'flex', flexDirection:'column' }}>
            <img src={selectedPhoto.url} alt="" style={{ maxWidth:'100%', maxHeight:'70vh', objectFit:'contain' }} />
            {selectedPhoto.ai_description && (
              <div style={{ padding:'14px 20px', borderTop:'1px solid #e5e7eb', fontSize:13, color:'#374151', fontStyle:'italic', lineHeight:1.6, maxWidth:600 }}>
                {selectedPhoto.ai_description}
              </div>
            )}
            {selectedPhoto.people?.length > 0 && (
              <div style={{ padding:'8px 20px 14px', display:'flex', gap:8, flexWrap:'wrap' }}>
                {selectedPhoto.people.map(name => (
                  <span key={name} style={{ padding:'4px 12px', background:'#f3f4f6', borderRadius:100, fontSize:12, fontWeight:600, color:'#374151' }}>👤 {name}</span>
                ))}
              </div>
            )}
            <button onClick={() => setSelectedPhoto(null)} style={{ position:'absolute', top:'1rem', right:'1rem', background:'rgba(0,0,0,0.6)', color:'white', border:'none', width:40, height:40, borderRadius:'50%', fontSize:'1.4rem', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
          </div>
        </div>
      )}
    </>
  );
}