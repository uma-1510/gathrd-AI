'use client';

import { useState, useRef, useEffect } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useRouter } from 'next/navigation';

// ── Agentic tool labels ──────────────────────────────────────────────────────
const TOOL_LABELS = {
  search_photos:         'Searching photos',
  get_album:             'Opening album',
  list_albums:           'Listing albums',
  create_album:          'Creating album',
  share_album:           'Sharing album',
  ask_user_confirmation: 'Requesting confirmation',
  find_duplicates:       'Scanning for duplicates',
  delete_photos:         'Deleting photos',
  get_people_stats:      'Analysing people',
  build_highlight_reel:  'Building highlight reel',
  prepare_download:      'Preparing download',
};

// ── Agentic queries: if the query matches these, skip the search grid and go
//    straight to agent mode (chat + step tracker). Add more patterns as needed.
const AGENT_PATTERNS = [
  /\b(create|make|build|start)\b.*(album|highlight|reel)/i,
  /\b(share|send)\b/i,
  /\b(delete|remove|clean)\b/i,
  /\bduplicate/i,
  /\bdownload\b/i,
  /\bwho (do i|have i)\b/i,
  /\bmost photos with\b/i,
];

const isAgenticQuery = (q) => AGENT_PATTERNS.some(p => p.test(q));

// ── ZIP download (client-side, jszip + file-saver) ───────────────────────────
async function triggerZipDownload(photos, zipName) {
  try {
    const [{ default: JSZip }, { saveAs }] = await Promise.all([
      import('jszip'),
      import('file-saver'),
    ]);
    const zip    = new JSZip();
    const folder = zip.folder(zipName);
    await Promise.all(
      photos.map(async (photo, i) => {
        try {
          const blob = await fetch(photo.url).then(r => r.blob());
          const ext  = photo.filename?.split('.').pop() || 'jpg';
          folder.file(
            `${String(i + 1).padStart(3, '0')}_${photo.filename || `photo_${i + 1}.${ext}`}`,
            blob
          );
        } catch {}
      })
    );
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${zipName}.zip`);
  } catch (err) {
    console.error('[agent] zip download failed:', err);
  }
}

// ── Suggestions ──────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Show me photos from my birthday",
  "Who do I take the most photos with?",
  "Photos with Gautam last month",
  "Find duplicate photos in my Barcelona album",
  "Create a highlight of me with my daughter from this past year",
  "Download all photos from the Family Summer album",
  "Best photos for Instagram today",
  "Photos from December",
];

// ── Intent badges (from search API) ─────────────────────────────────────────
function IntentBadges({ intent }) {
  if (!intent) return null;
  const badges = [];
  if (intent.dateFilter?.year)  badges.push({ label: `Year: ${intent.dateFilter.year}`,  color: '#2563eb' });
  if (intent.dateFilter?.month) {
    const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    badges.push({ label: `Month: ${months[intent.dateFilter.month]}`, color: '#2563eb' });
  }
  if (intent.dateFilter?.day)   badges.push({ label: `Day: ${intent.dateFilter.day}`,    color: '#2563eb' });
  if (intent.dateFilter?.after) badges.push({ label: 'Recent',                            color: '#2563eb' });
  for (const name of (intent.peopleFilter  || [])) badges.push({ label: `Person: ${name}`, color: '#7c3aed' });
  for (const ev   of (intent.eventKeywords || [])) badges.push({ label: ev,                color: '#059669' });
  if (intent.qualityFilter) badges.push({ label: 'Best quality', color: '#d97706' });
  if (!badges.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {badges.map((b, i) => (
        <span key={i} style={{
          padding: '4px 12px', borderRadius: 100,
          background: b.color + '15', color: b.color,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          border: `1px solid ${b.color}30`,
        }}>{b.label}</span>
      ))}
    </div>
  );
}

// ── Step tracker (agent mode) ────────────────────────────────────────────────
function StepTracker({ steps }) {
  if (!steps?.length) return null;
  return (
    <div style={{
      background: 'rgba(17,17,17,0.03)',
      border: '1px solid rgba(17,17,17,0.07)',
      borderRadius: 12, padding: '12px 16px',
      marginBottom: 12, maxWidth: '72%',
    }}>
      {steps.map((step, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
          fontFamily: "'Syne', sans-serif", fontSize: 12,
          color: step.result?.error ? '#dc2626' : 'rgba(17,17,17,0.55)',
          borderBottom: i < steps.length - 1 ? '1px solid rgba(17,17,17,0.05)' : 'none',
        }}>
          <span style={{ fontSize: 10 }}>{step.result?.error ? '✗' : '✓'}</span>
          <span style={{ flex: 1 }}>
            {TOOL_LABELS[step.tool] || step.tool}
            {step.result?.count             != null && ` — ${step.result.count} photos`}
            {step.result?.album_name                 && ` — "${step.result.album_name}"`}
            {step.result?.duplicate_pairs   != null  && ` — ${step.result.duplicate_pairs} pairs found`}
            {step.result?.deleted           != null  && ` — ${step.result.deleted} deleted`}
            {step.result?.selected_count    != null  && ` — ${step.result.selected_count} selected`}
            {step.result?.error                      && `: ${step.result.error}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Confirmation modal ───────────────────────────────────────────────────────
function ConfirmModal({ confirmation, onConfirm, onCancel }) {
  const colors = {
    low:    { bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)',  label: 'Safe' },
    medium: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  label: 'Review' },
    high:   { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   label: 'Permanent' },
  };
  const c = colors[confirmation.severity] || colors.medium;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(4px)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: '#faf8f4', borderRadius: 20, padding: 28,
        width: 'min(500px, 100%)', border: '1px solid rgba(17,17,17,0.1)',
      }}>
        <div style={{
          display: 'inline-block', background: c.bg,
          border: `1px solid ${c.border}`, borderRadius: 100,
          padding: '4px 12px', fontFamily: "'Syne', sans-serif",
          fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', marginBottom: 16,
        }}>{c.label}</div>
        <p style={{
          fontFamily: "'Instrument Serif', serif", fontSize: 20,
          fontStyle: 'italic', color: '#111', marginBottom: 8, lineHeight: 1.3,
        }}>{confirmation.message}</p>
        {confirmation.action_preview && (
          <p style={{
            fontFamily: "'Syne', sans-serif", fontSize: 13,
            color: 'rgba(17,17,17,0.5)', marginBottom: 24, lineHeight: 1.6,
          }}>{confirmation.action_preview}</p>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onConfirm} style={{
            flex: 1, padding: 12, background: '#111', color: '#f2efe9',
            border: 'none', borderRadius: 12, fontFamily: "'Syne', sans-serif",
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Yes, proceed</button>
          <button onClick={onCancel} style={{
            flex: 1, padding: 12, background: 'transparent',
            border: '1px solid rgba(17,17,17,0.15)', borderRadius: 12,
            fontFamily: "'Syne', sans-serif", fontSize: 13,
            color: 'rgba(17,17,17,0.6)', cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Photo lightbox ───────────────────────────────────────────────────────────
function Lightbox({ photo, onClose }) {
  if (!photo) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      zIndex: 2000, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '1rem',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'relative', maxWidth: '95vw', maxHeight: '90vh',
        background: 'white', borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
      }}>
        <img src={photo.url} alt="" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
        {photo.ai_description && (
          <div style={{
            padding: '14px 20px', borderTop: '1px solid #e5e7eb',
            fontSize: 13, color: '#374151', fontStyle: 'italic', lineHeight: 1.6, maxWidth: 600,
          }}>{photo.ai_description}</div>
        )}
        {photo.people?.length > 0 && (
          <div style={{ padding: '8px 20px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photo.people.map(name => (
              <span key={name} style={{
                padding: '4px 12px', background: '#f3f4f6', borderRadius: 100,
                fontSize: 12, fontWeight: 600, color: '#374151',
              }}>👤 {name}</span>
            ))}
          </div>
        )}
        <button onClick={onClose} style={{
          position: 'absolute', top: '1rem', right: '1rem',
          background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none',
          width: 40, height: 40, borderRadius: '50%', fontSize: '1.4rem',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>
    </div>
  );
}

// ── Chat message (agent mode) ────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 16 }}>
      <div style={{
        maxWidth: '72%',
        background: isUser ? '#111' : 'rgba(250,248,244,0.9)',
        color: isUser ? '#f2efe9' : '#111',
        border: isUser ? 'none' : '1px solid rgba(17,17,17,0.08)',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '12px 16px',
        fontFamily: "'Syne', sans-serif", fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
      }}>{msg.content}</div>
    </div>
  );
}

// ── MODE PILL ────────────────────────────────────────────────────────────────
function ModePill({ mode }) {
  const label = mode === 'agent' ? '⚡ Agent mode' : '🔍 Search mode';
  const color = mode === 'agent' ? '#7c3aed' : '#059669';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', borderRadius: 100,
      background: color + '12', border: `1px solid ${color}30`,
      fontFamily: "'Syne', sans-serif", fontSize: 11,
      fontWeight: 700, letterSpacing: '0.08em', color,
      transition: 'all 0.3s',
    }}>{label}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function AgentPage() {
  const router = useRouter();

  // shared input
  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef  = useRef(null);
  const bottomRef = useRef(null);

  // mode: 'idle' | 'search' | 'agent'
  const [mode, setMode] = useState('idle');

  // ── search state ──
  const [searchResults,  setSearchResults]  = useState(null);
  const [selectedPhoto,  setSelectedPhoto]  = useState(null);

  // ── agent state ──
  const [messages,      setMessages]      = useState([]);
  const [history,       setHistory]       = useState([]);
  const [pendingSteps,  setPendingSteps]  = useState(null);
  const [confirmation,  setConfirmation]  = useState(null);
  const [pendingHistory,setPendingHistory]= useState(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, searchResults, loading]);

  // ── reset to idle ────────────────────────────────────────────────────────
  const reset = () => {
    setMode('idle');
    setQuery('');
    setSearchResults(null);
    setMessages([]);
    setHistory([]);
    setPendingSteps(null);
    setConfirmation(null);
    inputRef.current?.focus();
  };

  // ── unified submit ───────────────────────────────────────────────────────
  const submit = async (text, resumeHistory = null) => {
    const q = (text || query).trim();
    if (!q || loading) return;
    setQuery('');

    // decide mode
    if (isAgenticQuery(q)) {
      await runAgent(q, resumeHistory);
    } else {
      await runSearch(q);
    }
  };

  // ── SEARCH ───────────────────────────────────────────────────────────────
  const runSearch = async (q) => {
    setMode('search');
    setLoading(true);
    setSearchResults(null);
    setPendingSteps(null);
    try {
      const tz  = new Date().getTimezoneOffset();
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&tz=${tz}`);
      const data = await res.json();
      setSearchResults(data);
    } catch {
      setSearchResults({ error: 'Search failed', photos: [] });
    }
    setLoading(false);
  };

  // ── "Do more with these photos" — escalate to agent with context ─────────
  const escalateToAgent = (prompt) => {
    const ctx = searchResults?.photos?.length
      ? `I found ${searchResults.photos.length} photos. Now: ${prompt}`
      : prompt;
    setSearchResults(null);
    runAgent(ctx);
  };

  // ── AGENT ────────────────────────────────────────────────────────────────
  const runAgent = async (text, resumeHistory = null) => {
    setMode('agent');
    setLoading(true);
    setPendingSteps(null);
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_history: resumeHistory || history,
        }),
      });
      const data = await res.json();

      if (data.conversation_history) setHistory(data.conversation_history);

      // zip download
      const downloadStep = data.steps?.find(s => s.result?.__type === 'DOWNLOAD_READY');
      if (downloadStep) {
        triggerZipDownload(
          downloadStep.result.photos,
          downloadStep.result.zip_name || 'gathrd-export'
        );
      }

      // confirmation pause
      if (data.status === 'needs_confirmation') {
        setPendingSteps(data.steps);
        setPendingHistory(data.conversation_history);
        setConfirmation(data.confirmation);
        setLoading(false);
        return;
      }

      if (data.steps?.length) setPendingSteps(data.steps);
      setMessages(prev => [...prev, { role: 'assistant', content: data.message || 'Done.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    }
    setLoading(false);
  };

  const handleConfirm = () => {
    setConfirmation(null);
    const resumeHistory = [
      ...(pendingHistory || history),
      { role: 'user', content: 'Yes, confirmed. Please proceed.' },
    ];
    setHistory(resumeHistory);
    setMessages(prev => [...prev, { role: 'user', content: 'Yes, confirmed.' }]);
    runAgent('Yes, confirmed. Please proceed.', resumeHistory);
  };

  const handleCancel = () => {
    setConfirmation(null);
    setMessages(prev => [...prev, { role: 'assistant', content: 'Cancelled. No changes were made.' }]);
    setLoading(false);
  };

  // ── RENDER ───────────────────────────────────────────────────────────────
  const isIdle   = mode === 'idle';
  const isSearch = mode === 'search';
  const isAgent  = mode === 'agent';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }

        @keyframes fadeUp   { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse    { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }
        @keyframes shimmer  { 0%,100%{opacity:1} 50%{opacity:0.4} }

        .fu { animation: fadeUp 0.45s cubic-bezier(0.22,1,0.36,1) both; }

        /* ── unified input ── */
        .smart-input {
          width: 100%; padding: 18px 130px 18px 24px;
          background: #fff; border: 2px solid rgba(17,17,17,0.12);
          border-radius: 100px; outline: none;
          font-family: 'Syne', sans-serif; font-size: 15px; color: #111;
          transition: all 0.2s;
          box-shadow: 0 4px 24px rgba(0,0,0,0.06);
          resize: none; line-height: 1.5;
        }
        .smart-input:focus { border-color: #111; box-shadow: 0 4px 32px rgba(0,0,0,0.1); }
        .smart-input::placeholder { color: rgba(17,17,17,0.3); }

        .send-btn {
          position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
          padding: 10px 22px; background: #111; color: #f2efe9;
          border: none; border-radius: 100px; cursor: pointer;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase; transition: all 0.18s;
          white-space: nowrap;
        }
        .send-btn:hover   { background: #333; }
        .send-btn:disabled { background: rgba(17,17,17,0.25); cursor: not-allowed; }

        .clear-btn {
          position: absolute; right: 108px; top: 50%; transform: translateY(-50%);
          background: rgba(17,17,17,0.08); border: none; width: 28px; height: 28px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: rgba(17,17,17,0.4); font-size: 13px; transition: all 0.15s;
        }
        .clear-btn:hover { background: rgba(17,17,17,0.15); color: #111; }

        /* ── suggestion chips ── */
        .chip {
          padding: 8px 16px; background: #fff;
          border: 1.5px solid rgba(17,17,17,0.1); border-radius: 100px;
          font-family: 'Syne', sans-serif; font-size: 12px; color: rgba(17,17,17,0.6);
          cursor: pointer; transition: all 0.18s; white-space: nowrap;
        }
        .chip:hover { border-color: #111; color: #111; background: #f2efe9; }

        /* ── photo grid ── */
        .photo-card {
          aspect-ratio: 1/1; border-radius: 12px; overflow: hidden; cursor: pointer;
          position: relative; transition: transform 0.2s;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .photo-card:hover { transform: scale(1.03); box-shadow: 0 12px 32px rgba(0,0,0,0.15); }
        .match-badge  { position: absolute; top: 8px; right: 8px; padding: 3px 8px; border-radius: 100px; font-family: 'Syne',sans-serif; font-size: 10px; font-weight: 700; background: rgba(0,0,0,0.6); color: #fff; backdrop-filter: blur(4px); }
        .people-badge { position: absolute; bottom: 8px; left: 8px; padding: 3px 8px; border-radius: 100px; font-family: 'Syne',sans-serif; font-size: 10px; font-weight: 600; background: rgba(17,17,17,0.75); color: #fff; backdrop-filter: blur(4px); }

        /* ── agent actions bar ── */
        .action-chip {
          padding: 7px 14px;
          background: rgba(17,17,17,0.05); border: 1px solid rgba(17,17,17,0.09);
          border-radius: 100px; font-family: 'Syne', sans-serif;
          font-size: 12px; color: rgba(17,17,17,0.6);
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .action-chip:hover { background: rgba(17,17,17,0.1); color: #111; }

        .loading-dot { animation: shimmer 1.2s ease infinite; }
        .loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .loading-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>

      <Header />
      <Sidebar />

      {confirmation && (
        <ConfirmModal
          confirmation={confirmation}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      <Lightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />

      <main style={{
        marginLeft: 240, marginTop: 62,
        minHeight: 'calc(100vh - 62px)',
        background: '#f2efe9',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 160px' }}>

          {/* ── IDLE: hero + suggestions ─────────────────────────────── */}
          {isIdle && (
            <div className="fu" style={{ maxWidth: 680, margin: '60px auto 0', textAlign: 'center' }}>
              <p style={{
                fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'rgba(17,17,17,0.35)', marginBottom: 12,
              }}>✦ Gathrd AI</p>
              <h1 style={{
                fontFamily: "'Instrument Serif', serif",
                fontSize: 'clamp(28px,3.5vw,44px)', fontWeight: 400,
                fontStyle: 'italic', color: '#111', lineHeight: 1.15, marginBottom: 12,
              }}>Search, ask, organise.</h1>
              <p style={{
                fontFamily: "'Syne', sans-serif", fontSize: 14,
                color: 'rgba(17,17,17,0.45)', marginBottom: 36, lineHeight: 1.7,
              }}>
                Type a search query to find photos instantly, or ask me to do something — create albums, share, find duplicates, download, and more.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="chip" onClick={() => submit(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* ── SEARCH: results ──────────────────────────────────────── */}
          {isSearch && (
            <div style={{ maxWidth: 860, margin: '0 auto' }}>

              {/* loading */}
              {loading && (
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
                    {[0,1,2].map(i => (
                      <div key={i} className="loading-dot" style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(17,17,17,0.3)' }}/>
                    ))}
                  </div>
                  <p style={{ fontFamily: "'Instrument Serif',serif", fontSize: 16, fontStyle: 'italic', color: 'rgba(17,17,17,0.5)' }}>
                    Understanding your query…
                  </p>
                </div>
              )}

              {/* results */}
              {searchResults && !loading && (
                <div className="fu">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                    <ModePill mode="search" />
                    <IntentBadges intent={searchResults.intent} />
                  </div>

                  {searchResults.photos?.length > 0 ? (
                    <>
                      <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.5)', marginBottom: 20 }}>
                        Found <strong style={{ color: '#111' }}>{searchResults.photos.length}</strong> photo{searchResults.photos.length !== 1 ? 's' : ''} for &ldquo;{searchResults.query}&rdquo;
                      </p>

                      {/* photo grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 14, marginBottom: 32 }}>
                        {searchResults.photos.map(photo => (
                          <div key={photo.id} className="photo-card" onClick={() => setSelectedPhoto(photo)}>
                            <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            {photo.similarity_pct > 0 && <div className="match-badge">{photo.similarity_pct}%</div>}
                            {photo.people?.length > 0 && <div className="people-badge">{photo.people.join(', ')}</div>}
                          </div>
                        ))}
                      </div>

                      {/* ── Escalation bar — do more with these results ── */}
                      <div style={{
                        background: 'rgba(255,255,255,0.7)',
                        border: '1px solid rgba(17,17,17,0.09)',
                        borderRadius: 16, padding: '16px 20px',
                        marginBottom: 16,
                      }}>
                        <p style={{
                          fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700,
                          letterSpacing: '0.1em', textTransform: 'uppercase',
                          color: 'rgba(17,17,17,0.35)', marginBottom: 12,
                        }}>Do more with these photos</p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {[
                            'Create an album from these',
                            'Download all as ZIP',
                            'Find duplicates',
                            'Share with someone',
                          ].map((action, i) => (
                            <button key={i} className="action-chip" onClick={() => escalateToAgent(action)}>
                              {action}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    /* no results */
                    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                      <p style={{ fontFamily: "'Instrument Serif',serif", fontSize: 20, fontStyle: 'italic', color: 'rgba(17,17,17,0.45)', marginBottom: 8 }}>
                        No photos found
                      </p>
                      <p style={{ fontSize: 13, color: 'rgba(17,17,17,0.35)', maxWidth: 400, margin: '0 auto 24px' }}>
                        Try uploading more photos, or tag people so the AI can find them by name.
                      </p>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button onClick={() => router.push('/gallery')} style={{
                          padding: '10px 22px', background: '#111', color: '#f2efe9',
                          border: 'none', borderRadius: 100, fontFamily: "'Syne',sans-serif",
                          fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase',
                        }}>Upload photos</button>
                        <button onClick={() => router.push('/people')} style={{
                          padding: '10px 22px', background: 'rgba(17,17,17,0.06)', color: '#111',
                          border: '1.5px solid rgba(17,17,17,0.12)', borderRadius: 100,
                          fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700,
                          cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase',
                        }}>Tag people</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── AGENT: chat ──────────────────────────────────────────── */}
          {isAgent && (
            <div style={{ maxWidth: 720, margin: '0 auto' }}>

              {/* mode pill at top */}
              {messages.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <ModePill mode="agent" />
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'assistant' && pendingSteps && i === messages.length - 1 && (
                    <StepTracker steps={pendingSteps} />
                  )}
                  <Message msg={msg} />
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', gap: 8, padding: '8px 0 8px 4px' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'rgba(17,17,17,0.25)',
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}/>
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}

        </div>

        {/* ── Fixed input bar ─────────────────────────────────────────────── */}
        <div style={{
          position: 'fixed', bottom: 0, left: 240, right: 0,
          background: 'rgba(242,239,233,0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(17,17,17,0.08)',
          padding: '14px 40px 22px',
        }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>

            {/* mode hint above input */}
            {!isIdle && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <ModePill mode={mode} />
                <button onClick={reset} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'Syne', sans-serif", fontSize: 11,
                  color: 'rgba(17,17,17,0.4)', letterSpacing: '0.05em',
                }}>← New search</button>
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <input
                ref={inputRef}
                className="smart-input"
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                  if (e.key === 'Escape') reset();
                }}
                placeholder={
                  isAgent
                    ? 'Continue the conversation…'
                    : 'Search photos or ask me to do something…'
                }
                disabled={loading}
              />
              {query && !loading && (
                <button className="clear-btn" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>✕</button>
              )}
              <button
                className="send-btn"
                onClick={() => submit()}
                disabled={loading || !query.trim()}
              >
                {loading ? '…' : isAgent ? 'Send' : 'Go'}
              </button>
            </div>

            {/* idle: show suggestion chips inline too */}
            {isIdle && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, justifyContent: 'center' }}>
                {SUGGESTIONS.slice(0, 4).map((s, i) => (
                  <button key={i} className="chip" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => submit(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        </div>

      </main>
    </>
  );
}