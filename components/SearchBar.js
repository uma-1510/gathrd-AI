'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export default function SearchBar({ onResults, onClear }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultCount, setResultCount] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  const runSearch = useCallback(async (q) => {
    if (!q.trim() || q.trim().length < 2) {
      onClear();
      setResultCount(null);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Pass browser timezone offset so the server resolves "today" correctly
      const tz = new Date().getTimezoneOffset();
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&limit=50&tz=${tz}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Search failed');
        onResults([]);
      } else {
        setResultCount(data.count);
        onResults(data.photos);
      }
    } catch (err) {
      setError('Search unavailable');
      onResults([]);
    } finally {
      setLoading(false);
    }
  }, [onResults, onClear]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (!val.trim()) {
      handleClear();
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(val);
    }, 400);
  };

  const handleClear = () => {
    setQuery('');
    setResultCount(null);
    setError('');
    setIsActive(false);
    onClear();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceRef.current);
      runSearch(query);
    }
    if (e.key === 'Escape') {
      handleClear();
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1.1rem',
          backgroundColor: 'white',
          border: `1.5px solid ${isActive ? 'rgba(17,17,17,0.4)' : 'rgba(17,17,17,0.12)'}`,
          borderRadius: '100px',
          transition: 'border-color 0.2s',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Search icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="rgba(17,17,17,0.35)" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsActive(true)}
          onBlur={() => setIsActive(false)}
          placeholder="Search photos — try 'best photos today' or 'beach trip last summer'…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: "'Syne', sans-serif",
            fontSize: 13,
            color: '#111',
          }}
        />

        {/* Clear button */}
        {query && (
          <button
            onClick={handleClear}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(17,17,17,0.4)', fontSize: 18, lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ×
          </button>
        )}

        {/* Loading spinner */}
        {loading && (
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid rgba(17,17,17,0.12)',
            borderTopColor: '#111',
            animation: 'spin 0.7s linear infinite',
            flexShrink: 0,
          }} />
        )}
      </div>

      {/* Result count / error */}
      {!loading && resultCount !== null && (
        <p style={{
          fontFamily: "'Syne', sans-serif", fontSize: 12,
          color: 'rgba(17,17,17,0.4)', marginTop: 8, paddingLeft: 4,
        }}>
          {resultCount === 0
            ? 'No photos found'
            : `${resultCount} photo${resultCount !== 1 ? 's' : ''} found`}
        </p>
      )}

      {error && (
        <p style={{
          fontFamily: "'Syne', sans-serif", fontSize: 12,
          color: '#c0392b', marginTop: 8, paddingLeft: 4,
        }}>
          {error}
        </p>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}