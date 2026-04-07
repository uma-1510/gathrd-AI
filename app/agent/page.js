'use client';

import { useState, useRef, useEffect } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';

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
          folder.file(`${String(i + 1).padStart(3, '0')}_${photo.filename || `photo_${i + 1}.${ext}`}`, blob);
        } catch {}
      })
    );
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${zipName}.zip`);
  } catch (err) {
    console.error('[agent] zip download failed:', err);
  }
}

const SUGGESTIONS = [
  "Get my photos from Italy and make an album shared with marco",
  "Who do I take the most photos with?",
  "Find duplicate photos in my Barcelona album",
  "Create a highlight of me with my daughter from this past year",
  "Download all photos from the Family Summer album",
];

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 16 }}>
      <div style={{
        maxWidth: '80%',
        background: isUser ? '#111' : 'rgba(250,248,244,0.9)',
        color: isUser ? '#f2efe9' : '#111',
        border: isUser ? 'none' : '1px solid rgba(17,17,17,0.08)',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '12px 16px',
        fontFamily: "'Syne', sans-serif",
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

function StepTracker({ steps }) {
  if (!steps?.length) return null;

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
    get_top_photos:        'Finding top photos',
    generate_captions:     'Generating captions',
  };

  return (
    <div style={{
      background: 'rgba(17,17,17,0.03)',
      border: '1px solid rgba(17,17,17,0.07)',
      borderRadius: 12,
      padding: '12px 16px',
      marginBottom: 8,
      maxWidth: '80%',
    }}>
      {steps.map((step, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 0',
          fontFamily: "'Syne', sans-serif",
          fontSize: 12,
          color: step.result?.error ? '#dc2626' : 'rgba(17,17,17,0.55)',
          borderBottom: i < steps.length - 1 ? '1px solid rgba(17,17,17,0.05)' : 'none',
        }}>
          <span style={{ fontSize: 10, flexShrink: 0 }}>
            {step.result?.error ? '✗' : '✓'}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {TOOL_LABELS[step.tool] || step.tool}
            {step.result?.count        != null && ` — ${step.result.count} photos`}
            {step.result?.album_name              && ` — "${step.result.album_name}"`}
            {step.result?.duplicate_pairs != null && ` — ${step.result.duplicate_pairs} pairs`}
            {step.result?.deleted        != null && ` — ${step.result.deleted} deleted`}
            {step.result?.selected_count != null && ` — ${step.result.selected_count} selected`}
            {step.result?.error                   && `: ${step.result.error}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ confirmation, onConfirm, onCancel }) {
  const colors = {
    low:    { bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)',  label: 'Safe'      },
    medium: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  label: 'Review'    },
    high:   { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   label: 'Permanent' },
  };
  const c = colors[confirmation.severity] || colors.medium;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(4px)',
      zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: '#faf8f4',
        borderRadius: 20,
        padding: 28,
        width: 'min(500px, 100%)',
        border: '1px solid rgba(17,17,17,0.1)',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        <div style={{
          display: 'inline-block',
          background: c.bg, border: `1px solid ${c.border}`,
          borderRadius: 100, padding: '4px 12px',
          fontFamily: "'Syne', sans-serif",
          fontSize: 11, fontWeight: 600,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          marginBottom: 16,
        }}>
          {c.label}
        </div>
        <p style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: 20, fontStyle: 'italic',
          color: '#111', marginBottom: 8, lineHeight: 1.3,
        }}>
          {confirmation.message}
        </p>
        {confirmation.action_preview && (
          <p style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 13, color: 'rgba(17,17,17,0.5)',
            marginBottom: 24, lineHeight: 1.6,
          }}>
            {confirmation.action_preview}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={onConfirm} style={{
            flex: 1, minWidth: 120, padding: '12px',
            background: '#111', color: '#f2efe9',
            border: 'none', borderRadius: 12,
            fontFamily: "'Syne', sans-serif",
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            Yes, proceed
          </button>
          <button onClick={onCancel} style={{
            flex: 1, minWidth: 120, padding: '12px',
            background: 'transparent',
            border: '1px solid rgba(17,17,17,0.15)',
            borderRadius: 12,
            fontFamily: "'Syne', sans-serif",
            fontSize: 13, color: 'rgba(17,17,17,0.6)', cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const [messages,      setMessages]      = useState([]);
  const [history,       setHistory]       = useState([]);
  const [input,         setInput]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [lastSteps,     setLastSteps]     = useState(null);  // only for most recent assistant msg
  const [confirmation,  setConfirmation]  = useState(null);
  const [pendingHistory, setPendingHistory] = useState(null);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (text, resumeHistory = null) => {
    const userText = (text || input).trim();
    if (!userText || loading) return;

    setInput('');
    setLoading(true);
    setLastSteps(null);
    setMessages(prev => [...prev, { role: 'user', content: userText }]);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          conversation_history: resumeHistory || history,
        }),
      });

      const data = await res.json();

      if (data.conversation_history) {
        setHistory(data.conversation_history);
      }

      // Check for download signal
      const downloadStep = data.steps?.find(s => s.result?.__type === 'DOWNLOAD_READY');
      if (downloadStep) {
        triggerZipDownload(downloadStep.result.photos, downloadStep.result.zip_name || 'gathrd-export');
      }

      // Confirmation pause
      if (data.status === 'needs_confirmation') {
        setLastSteps(data.steps);
        setPendingHistory(data.conversation_history);
        setConfirmation(data.confirmation);
        setLoading(false);
        return;
      }

      // Store steps for the upcoming assistant message only
      if (data.steps?.length) setLastSteps(data.steps);

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.message || 'Done.' },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ]);
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
    sendMessage('Yes, confirmed. Please proceed.', resumeHistory);
  };

  const handleCancel = () => {
    setConfirmation(null);
    setLastSteps(null);
    setMessages(prev => [
      ...prev,
      { role: 'assistant', content: 'Cancelled. No changes were made.' },
    ]);
    setLoading(false);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');

        .agent-input {
          width: 100%; background: transparent; border: none; outline: none;
          font-family: 'Syne', sans-serif; font-size: 14px; color: #111;
          resize: none; line-height: 1.5;
        }
        .agent-input::placeholder { color: rgba(17,17,17,0.3); }

        .suggestion-chip {
          display: inline-block;
          background: rgba(17,17,17,0.05);
          border: 1px solid rgba(17,17,17,0.09);
          border-radius: 100px;
          padding: 7px 14px;
          font-family: 'Syne', sans-serif;
          font-size: 12px; color: rgba(17,17,17,0.6);
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
          text-align: left;
        }
        .suggestion-chip:hover { background: rgba(17,17,17,0.1); color: #111; }

        @keyframes pulse { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }

        /* ── Responsive input bar ─────────────────────────────────────── */
        .agent-input-bar {
          position: fixed;
          bottom: 0;
          /* On desktop: offset by sidebar width */
          left: 240px;
          right: 0;
          background: rgba(242,239,233,0.95);
          backdrop-filter: blur(20px);
          border-top: 1px solid rgba(17,17,17,0.08);
          padding: 16px 40px 24px;
          z-index: 100;
        }

        @media (max-width: 1023px) {
          .agent-input-bar {
            left: 0;
            padding: 12px 16px 20px;
          }
        }

        /* ── Responsive main ─────────────────────────────────────────── */
        .agent-main {
          margin-left: 240px;
          margin-top: 62px;
          min-height: calc(100vh - 62px);
          background: #f2efe9;
          display: flex;
          flex-direction: column;
        }

        @media (max-width: 1023px) {
          .agent-main {
            margin-left: 0;
          }
        }

        .agent-chat-area {
          flex: 1;
          overflow-y: auto;
          padding: 32px 40px 160px;
        }

        @media (max-width: 1023px) {
          .agent-chat-area {
            padding: 20px 16px 140px;
          }
        }

        .agent-messages {
          max-width: 720px;
          margin: 0 auto;
        }

        .agent-empty {
          max-width: 560px;
          margin: 40px auto 0;
          text-align: center;
        }

        @media (max-width: 600px) {
          .agent-empty {
            margin-top: 20px;
          }
        }

        .suggestion-grid {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .agent-input-inner {
          max-width: 720px;
          margin: 0 auto;
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(17,17,17,0.12);
          border-radius: 16px;
          padding: 12px 16px;
          display: flex;
          align-items: flex-end;
          gap: 12px;
        }
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

      <main className="agent-main">
        <div className="agent-chat-area">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="agent-empty">
              <p style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: 11, fontWeight: 600,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'rgba(17,17,17,0.35)', marginBottom: 12,
              }}>
                ✦ Gathrd AI
              </p>
              <h1 style={{
                fontFamily: "'Instrument Serif', serif",
                fontSize: 'clamp(24px, 4vw, 38px)',
                fontWeight: 400, fontStyle: 'italic',
                color: '#111', lineHeight: 1.15, marginBottom: 12,
              }}>
                What would you like to do with your photos?
              </h1>
              <p style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: 13, color: 'rgba(17,17,17,0.45)',
                marginBottom: 28, lineHeight: 1.7,
              }}>
                Ask anything. I can search, organise, share, find duplicates, and manage your entire library.
              </p>
              <div className="suggestion-grid">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="suggestion-chip" onClick={() => sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message history */}
          <div className="agent-messages">
            {messages.map((msg, i) => {
              const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
              return (
                <div key={i}>
                  {/* Step tracker only on the last assistant message */}
                  {isLastAssistant && lastSteps && !loading && (
                    <StepTracker steps={lastSteps} />
                  )}
                  <Message msg={msg} />
                </div>
              );
            })}

            {/* Loading dots */}
            {loading && (
              <div style={{ display: 'flex', gap: 8, padding: '8px 0 8px 4px' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'rgba(17,17,17,0.25)',
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input bar */}
        <div className="agent-input-bar">
          <div className="agent-input-inner">
            <textarea
              ref={inputRef}
              className="agent-input"
              rows={1}
              placeholder="Ask me to do anything with your photos…"
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              style={{
                width: 36, height: 36, flexShrink: 0,
                background: input.trim() && !loading ? '#111' : 'rgba(17,17,17,0.12)',
                border: 'none', borderRadius: 10, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
                color: input.trim() && !loading ? '#f2efe9' : 'rgba(17,17,17,0.3)',
                fontSize: 16, flexShrink: 0,
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </main>
    </>
  );
}