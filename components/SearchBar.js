'use client';

/**
 * components/SearchBar.jsx
 *
 * Drop-in search bar for the gallery page.
 * Calls GET /api/search?q=... and returns results via onResults callback.
 *
 * Usage in gallery/page.js:
 *
 *   import SearchBar from '../../components/SearchBar';
 *
 *   // In your state:
 *   const [searchResults, setSearchResults] = useState(null);
 *   // null = no search active, [] = search returned nothing, [...] = results
 *
 *   // In your JSX (add after the header row, before the photo grid):
 *   <SearchBar
 *     onResults={setSearchResults}
 *     onClear={() => setSearchResults(null)}
 *   />
 *
 *   // Then in your photo grid:
 *   // Replace `photos` with `searchResults ?? photos`
 *   // This means: show search results if a search is active, else show all photos
 *
 * Props:
 *   onResults(photos) — called with the array of matching photos (or [] if none)
 *   onClear()         — called when user clears the search
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export default function SearchBar({ onResults, onClear }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultCount, setResultCount] = useState(null); // null = no search yet
  const [isActive, setIsActive] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // ── Search logic ──────────────────────────────────────────────────────────

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
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=50`);
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

  // Debounce: wait 400ms after user stops typing before searching
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

  // Also search on Enter key immediately (skip debounce)
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

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Search input row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1.1rem',
          backgroundColor: 'white',
          border: `1.5px solid ${isActive ? '#2563eb' : '#e5e7eb'}`,
          borderRadius: '12px',
          boxShadow: isActive
            ? '0 0 0 3px rgba(37,99,235,0.1)'
            : '0 2px 6px rgba(0,0,0,0.05)',
          transition: 'all 0.2s ease',
        }}
      >
        {/* Search icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={loading ? '#2563eb' : '#9ca3af'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transition: 'stroke 0.2s',
            animation: loading ? 'pulse 1s ease-in-out infinite' : 'none',
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsActive(true)}
          onBlur={() => setIsActive(false)}
          placeholder="Search your photos… try 'birthday party' or 'beach at sunset'"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '0.95rem',
            color: '#111827',
            backgroundColor: 'transparent',
            fontFamily: 'inherit',
          }}
        />

        {/* Loading spinner */}
        {loading && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        )}

        {/* Clear button */}
        {query && !loading && (
          <button
            onClick={handleClear}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9ca3af',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#374151')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
            title="Clear search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Result count / error feedback */}
      {(resultCount !== null || error) && (
        <div
          style={{
            marginTop: '0.5rem',
            paddingLeft: '0.25rem',
            fontSize: '0.82rem',
            color: error ? '#dc2626' : resultCount === 0 ? '#6b7280' : '#2563eb',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          {error ? (
            <>⚠ {error}</>
          ) : resultCount === 0 ? (
            <>No photos found for "{query}" — try different words</>
          ) : (
            <>
              <span style={{ fontWeight: '700' }}>{resultCount}</span>
              {resultCount === 1 ? ' photo' : ' photos'} matched
              <span style={{ color: '#9ca3af', fontWeight: '400' }}>· ordered by relevance</span>
            </>
          )}
        </div>
      )}

      {/* Hint text: only show when not searching */}
      {!query && !loading && (
        <p
          style={{
            marginTop: '0.5rem',
            paddingLeft: '0.25rem',
            fontSize: '0.78rem',
            color: '#9ca3af',
          }}
        >
          AI-powered · searches by meaning, not just keywords
        </p>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}