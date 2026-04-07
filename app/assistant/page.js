'use client';

import { useState, useEffect, useRef } from 'react';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import BottomNav from '../../components/BottomNav';

const SUGGESTIONS = [
  "What was I doing last summer?",
  "Show me photos with my family",
  "Tell me my life story in chapters",
  "Give me a 2024 year in review",
  "Find my best photos from Barcelona",
  "Who do I take the most photos with?",
  "Create an album of my recent trip",
  "Find duplicate photos",
];

// ── Photo grid rendered inside a chat bubble ──────────────────────────────────
function PhotoGrid({ photos, onPhotoClick }) {
  if (!photos?.length) return null;
  const show = photos.slice(0, 12);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.min(show.length, 4)}, 1fr)`,
      gap: 4, marginTop: 10, borderRadius: 10, overflow: 'hidden',
    }}>
      {show.map((p, i) => (
        <div
          key={p.id || i}
          onClick={() => onPhotoClick?.(p)}
          style={{ aspectRatio: '1/1', cursor: 'pointer', position: 'relative', background: '#e5e7eb', overflow: 'hidden' }}
        >
          <img
            src={p.url}
            alt={p.ai_description || ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s' }}
            onMouseEnter={e => e.target.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.target.style.transform = 'scale(1)'}
          />
          {p.similarity_pct > 0 && (
            <div style={{
              position: 'absolute', bottom: 4, right: 4,
              background: 'rgba(0,0,0,0.6)', color: 'white',
              fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px',
            }}>{p.similarity_pct}%</div>
          )}
        </div>
      ))}
      {photos.length > 12 && (
        <div style={{
          gridColumn: '1 / -1', textAlign: 'center',
          padding: '6px', fontSize: 12, color: 'rgba(17,17,17,0.4)',
          fontFamily: "'Syne', sans-serif",
        }}>
          +{photos.length - 12} more
        </div>
      )}
    </div>
  );
}

// ── Life chapter cards ────────────────────────────────────────────────────────
function ChapterCards({ chapters }) {
  if (!chapters?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
      {chapters.map((ch, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, background: 'rgba(17,17,17,0.03)',
          border: '1px solid rgba(17,17,17,0.08)', borderRadius: 12, overflow: 'hidden',
        }}>
          {ch.cover_url && (
            <img src={ch.cover_url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <div style={{ padding: '10px 12px 10px 0', flex: 1 }}>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 15, fontStyle: 'italic', color: '#111', marginBottom: 2 }}>
              {ch.title}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(17,17,17,0.4)', fontFamily: "'Syne', sans-serif", marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {ch.date_range}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(17,17,17,0.6)', lineHeight: 1.5 }}>
              {ch.description}
            </div>
            {ch.key_places?.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {ch.key_places.map((pl, j) => (
                  <span key={j} style={{ fontSize: 10, background: 'rgba(17,17,17,0.06)', borderRadius: 4, padding: '2px 6px', color: 'rgba(17,17,17,0.5)' }}>
                    📍 {pl}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Timeline period cards ─────────────────────────────────────────────────────
function TimelineView({ periods }) {
  if (!periods?.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 10 }}>
      {periods.map((p, i) => (
        <div key={i} style={{
          background: 'rgba(17,17,17,0.03)', border: '1px solid rgba(17,17,17,0.08)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {p.cover_url && (
            <img src={p.cover_url} alt="" style={{ width: '100%', height: 70, objectFit: 'cover' }} />
          )}
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: '#111', marginBottom: 2 }}>
              {p.period_label?.trim()}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(17,17,17,0.4)' }}>
              {p.photo_count} photo{p.photo_count !== 1 ? 's' : ''}
            </div>
            {p.places?.[0] && (
              <div style={{ fontSize: 10, color: 'rgba(17,17,17,0.4)', marginTop: 2 }}>📍 {p.places[0]}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Year in review ────────────────────────────────────────────────────────────
function YearReview({ data }) {
  if (!data?.narrative) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 13, fontStyle: 'italic', lineHeight: 1.7, color: '#111', whiteSpace: 'pre-wrap' }}>
        {data.narrative}
      </div>
      {data.photos?.length > 0 && <PhotoGrid photos={data.photos} />}
      <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(17,17,17,0.35)', fontFamily: "'Syne', sans-serif" }}>
        {data.total_photos} photos from {data.year}
      </div>
    </div>
  );
}

// ── Duplicate groups ──────────────────────────────────────────────────────────
function DuplicateGroups({ groups }) {
  if (!groups?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
      {groups.map((group, i) => (
        <div key={i} style={{ background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', fontFamily: "'Syne', sans-serif", marginBottom: 6 }}>
            Group {i + 1} — {group.length} duplicates
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {group.map(p => (
              <img key={p.id} src={p.url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Render tool result into UI ────────────────────────────────────────────────
function ToolResultView({ tool, result, onPhotoClick }) {
  if (!result) return null;

  if (tool === 'search_photos' ) {
    const photos = result.photos || [];
    if (!photos.length) return null;
    return <PhotoGrid photos={photos} onPhotoClick={onPhotoClick} />;
  }

  if (tool === 'get_people_stats') {
  if (result.photos?.length) {
    return <PhotoGrid photos={result.photos} onPhotoClick={onPhotoClick} />;
  }
  if (result.people?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
        {result.people.map((p, i) => (
          <div key={i} style={{
            background: 'rgba(17,17,17,0.03)',
            border: '1px solid rgba(17,17,17,0.08)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {/* Person header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
              {p.photos?.[0]?.url && (
                <img src={p.photos[0].url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: '#111' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(17,17,17,0.4)' }}>{p.photo_count} photo{p.photo_count !== 1 ? 's' : ''} together</div>
              </div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, color: 'rgba(17,17,17,0.1)' }}>#{i + 1}</div>
            </div>
            {/* Photo strip */}
            {p.photos?.length > 0 && (
              <div style={{ display: 'flex', gap: 2, padding: '0 2px 2px' }}>
                {p.photos.map((photo, j) => (
                  <div
                    key={j}
                    onClick={() => onPhotoClick?.(photo)}
                    style={{ flex: 1, aspectRatio: '1/1', overflow: 'hidden', cursor: 'pointer', borderRadius: 6 }}
                  >
                    <img
                      src={photo.url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s' }}
                      onMouseEnter={e => e.target.style.transform = 'scale(1.06)'}
                      onMouseLeave={e => e.target.style.transform = 'scale(1)'}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return null;
}
  if (tool === 'get_timeline') {
    return <TimelineView periods={result.periods} />;
  }

  if (tool === 'get_life_chapters') {
    return <ChapterCards chapters={result.chapters} />;
  }

  if (tool === 'generate_year_in_review') {
    return <YearReview data={result} />;
  }

  if (tool === 'find_duplicates') {
    return <DuplicateGroups groups={result.duplicate_groups} />;
  }

  if (tool === 'create_album' && result.album_id) {
    return (
      <a
        href={`/albums/${result.album_id}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '6px 14px', background: '#111', color: '#f2efe9', borderRadius: 20, fontSize: 12, fontFamily: "'Syne', sans-serif", fontWeight: 600, textDecoration: 'none' }}
      >
        Open album →
      </a>
    );
  }

  return null;
}

// ── Chat message bubble ───────────────────────────────────────────────────────
function Message({ msg, onPhotoClick }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
    }}>
      <div style={{
        maxWidth: '80%', padding: '12px 16px',
        background: isUser ? '#111' : 'white',
        color: isUser ? '#f2efe9' : '#111',
        borderRadius: isUser ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
        fontSize: 14, lineHeight: 1.6,
        border: isUser ? 'none' : '1px solid rgba(17,17,17,0.08)',
        fontFamily: "'Syne', sans-serif",
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        whiteSpace: 'pre-wrap',
      }}>
        {msg.content}

        {/* Render tool results inline */}
        {msg.tool_results?.map((tr, i) => (
          <ToolResultView key={i} tool={tr.tool} result={tr.result} onPhotoClick={onPhotoClick} />
        ))}
      </div>
      {msg.thinking && (
        <div style={{ fontSize: 11, color: 'rgba(17,17,17,0.3)', marginTop: 4, fontFamily: "'Syne', sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'rgba(17,17,17,0.2)', animation: 'pulse 1.2s infinite' }} />
          {msg.thinking}
        </div>
      )}
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ photo, onClose }) {
  if (!photo) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, overflow: 'hidden', maxWidth: 800, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <img src={photo.url} alt="" style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />
        {photo.ai_description && (
          <div style={{ padding: '12px 16px', fontSize: 13, color: '#374151', fontStyle: 'italic', lineHeight: 1.5 }}>
            {photo.ai_description}
          </div>
        )}
        {(photo.place_name || photo.dominant_emotion) && (
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
            {photo.place_name && <span style={{ fontSize: 12, color: '#6b7280' }}>📍 {photo.place_name}</span>}
            {photo.dominant_emotion && <span style={{ fontSize: 12, color: '#6b7280' }}>• {photo.dominant_emotion}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function AssistantPage() {
  const [messages, setMessages] = useState([]); // { role, content, tool_results? }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null); // for destructive actions
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const sendMessage = async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput('');

    const userMsg = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);

    // Add thinking indicator
    setMessages(prev => [...prev, { role: 'assistant', content: '', thinking: 'Thinking…' }]);

    try {
      // Convert to OpenAI format (strip tool_results from history)
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Request failed');

      // Replace thinking indicator with real response
      setMessages(prev => {
        const withoutThinking = prev.slice(0, -1); // remove thinking bubble
        return [
          ...withoutThinking,
          {
            role: 'assistant',
            content: data.reply,
            tool_results: data.tool_results || [],
          },
        ];
      });
    } catch (err) {
      setMessages(prev => {
        const withoutThinking = prev.slice(0, -1);
        return [
          ...withoutThinking,
          { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` },
        ];
      });
    }

    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const isEmpty = messages.length === 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .msg-in { animation: fadeUp 0.25s ease both; }
        .suggestion-chip {
          padding: 8px 16px; border-radius: 20px;
          background: rgba(17,17,17,0.05); border: 1px solid rgba(17,17,17,0.1);
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 600;
          color: rgba(17,17,17,0.6); cursor: pointer;
          transition: all 0.15s;
        }
        .suggestion-chip:hover { background: #111; color: #f2efe9; border-color: #111; }
      `}</style>

      <Header />
      <Sidebar />
      <BottomNav />

      <main style={{
        marginLeft: 0, marginTop: 62, height: 'calc(100vh - 62px)',
        display: 'flex', flexDirection: 'column',
        background: '#f2efe9',
      }} className="lg:ml-[240px]">

        {/* ── Chat area ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px 16px' }} className="lg:px-10">

          {/* Empty state */}
          {isEmpty && (
            <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 40 }}>
              <div style={{ textAlign: 'center', marginBottom: 40 }}>
                <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 400, fontStyle: 'italic', color: '#111', marginBottom: 10 }}>
                  Ask anything about your life
                </h1>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.4)', lineHeight: 1.6 }}>
                  Your photos are a diary you never wrote. I can find them, tell your story, create albums, and more.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="suggestion-chip" onClick={() => sendMessage(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            {messages.map((msg, i) => (
              <div key={i} className="msg-in">
                <Message msg={msg} onPhotoClick={setLightboxPhoto} />
              </div>
            ))}

            {/* Loading indicator (shown while waiting, before thinking bubble) */}
            {loading && messages[messages.length - 1]?.thinking && (
              <div style={{ display: 'flex', gap: 4, padding: '8px 0 16px', paddingLeft: 4 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 7, height: 7, borderRadius: '50%', background: 'rgba(17,17,17,0.25)',
                    animation: `pulse 1.2s ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Input bar ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '12px 16px 16px', background: 'rgba(242,239,233,0.95)',
          borderTop: '1px solid rgba(17,17,17,0.07)',
          backdropFilter: 'blur(12px)',
        }} className="lg:px-10">
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your photos, life story, create albums…"
              rows={1}
              style={{
                flex: 1, padding: '12px 16px',
                border: '1.5px solid rgba(17,17,17,0.15)',
                borderRadius: 20, outline: 'none', resize: 'none',
                fontFamily: "'Syne', sans-serif", fontSize: 14, color: '#111',
                background: 'white', lineHeight: 1.5,
                transition: 'border-color 0.15s',
                maxHeight: 120, overflowY: 'auto',
              }}
              onFocus={e => e.target.style.borderColor = '#111'}
              onBlur={e => e.target.style.borderColor = 'rgba(17,17,17,0.15)'}
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              style={{
                width: 44, height: 44, borderRadius: '50%', border: 'none',
                background: loading || !input.trim() ? 'rgba(17,17,17,0.15)' : '#111',
                color: loading || !input.trim() ? 'rgba(17,17,17,0.3)' : '#f2efe9',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0, transition: 'all 0.15s',
              }}
            >
              {loading ? (
                <div style={{ width: 16, height: 16, border: '2px solid rgba(17,17,17,0.3)', borderTopColor: '#111', borderRadius: '50%', animation: 'pulse 0.7s linear infinite' }} />
              ) : '↑'}
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(17,17,17,0.3)', fontFamily: "'Syne', sans-serif", marginTop: 8 }}>
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </main>

      <Lightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
    </>
  );
}