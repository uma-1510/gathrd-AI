'use client';
// app/assistant/backfill/page.js

import { useState, useEffect } from 'react';
import Header from '../../../components/Header';
import Sidebar from '../../../components/Sidebar';

function StatCard({ label, value, total, color = '#111' }) {
  const pct = total ? Math.round((parseInt(value) / parseInt(total)) * 100) : 0;
  return (
    <div style={{ background: '#faf8f4', border: '1px solid rgba(17,17,17,0.08)', borderRadius: 14, padding: '16px 20px', flex: 1, minWidth: 130 }}>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value ?? '…'}</div>
      {total != null && <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.35)', marginTop: 4 }}>of {total} ({pct}%)</div>}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ background: '#faf8f4', border: '1px solid rgba(17,17,17,0.08)', borderRadius: 18, padding: '24px', marginBottom: 20, maxWidth: 600 }}>
      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 4 }}>{title}</p>
      {subtitle && <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.5)', marginBottom: 16, lineHeight: 1.6 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function RunBtn({ onClick, disabled, loading, label, loadingLabel }) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 100, border: 'none', background: '#111', color: '#f2efe9', fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', cursor: disabled || loading ? 'not-allowed' : 'pointer', opacity: disabled || loading ? 0.45 : 1, transition: 'opacity 0.15s' }}>
      {loading && <div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
      {loading ? loadingLabel : label}
    </button>
  );
}

export default function BackfillPage() {
  // AI backfill state
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState(null);
  const [options, setOptions] = useState({
    fix_embeddings: true,
    fix_captions:   true,
    fix_face_tags:  true,
    dry_run:        false,
    limit:          50,
  });

  // Geocode state
  const [geoStats, setGeoStats]     = useState(null);
  const [geoRunning, setGeoRunning] = useState(false);
  const [geoResult, setGeoResult]   = useState(null);

  useEffect(() => { fetchStats(); fetchGeoStats(); }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/photos/backfill');
      const data = await res.json();
      if (!data.error) setStats(data);
    } catch {}
    setLoading(false);
  };

  const fetchGeoStats = async () => {
    try {
      const res = await fetch('/api/photos/geocode');
      const data = await res.json();
      if (!data.error) setGeoStats(data);
    } catch {}
  };

  const runBackfill = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/photos/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      const data = await res.json();
      setResult(data);
      if (!options.dry_run) fetchStats();
    } catch (err) { setResult({ error: err.message }); }
    setRunning(false);
  };

  const runGeocode = async () => {
    setGeoRunning(true);
    setGeoResult(null);
    try {
      const res = await fetch('/api/photos/geocode', { method: 'POST' });
      const data = await res.json();
      setGeoResult(data);
      if (!data.error) { fetchGeoStats(); }
    } catch (err) { setGeoResult({ error: err.message }); }
    setGeoRunning(false);
  };

  const toggle = (key) => setOptions(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #f2efe9; font-family: 'Syne', sans-serif; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        .check-row { display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(17,17,17,0.03);border:1px solid rgba(17,17,17,0.08);border-radius:10px;cursor:pointer;user-select:none;transition:background 0.15s; }
        .check-row:hover { background:rgba(17,17,17,0.06); }
        .check-row input[type="checkbox"] { width:16px;height:16px;accent-color:#111;cursor:pointer; }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft: '240px', marginTop: '62px', padding: '36px 32px', minHeight: 'calc(100vh - 62px)', background: '#f2efe9' }}>

        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.35)', marginBottom: 6 }}>Library Tools</p>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(26px,3.5vw,40px)', fontWeight: 400, fontStyle: 'italic', color: '#111', marginBottom: 8 }}>Fix Library</h1>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: 'rgba(17,17,17,0.5)', maxWidth: 520, lineHeight: 1.7 }}>
            Run these fixes so the AI assistant can find all your photos accurately, and so the map shows every photo in the right place.
          </p>
        </div>

        {/* ── SECTION 1: AI Search Health ── */}
        <Section title="🤖 AI Search Health" subtitle="Fix missing embeddings, captions, and face tags so the AI can find your photos.">

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(17,17,17,0.4)', fontFamily: "'Syne', sans-serif", fontSize: 13, marginBottom: 16 }}>
              <div style={{ width: 16, height: 16, border: '2px solid rgba(17,17,17,0.1)', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Loading stats…
            </div>
          ) : stats && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <StatCard label="Total Photos" value={stats.photo_stats?.total_photos} />
                <StatCard label="Searchable" value={stats.photo_stats?.has_embedding} total={stats.photo_stats?.total_photos} color="#16a34a" />
                <StatCard label="Missing Embeddings" value={stats.photo_stats?.missing_embedding} total={stats.photo_stats?.total_photos} color={parseInt(stats.photo_stats?.missing_embedding) > 0 ? '#dc2626' : '#16a34a'} />
                <StatCard label="Need Recaption" value={stats.photo_stats?.needs_recaption} total={stats.photo_stats?.total_photos} color={parseInt(stats.photo_stats?.needs_recaption) > 0 ? '#f59e0b' : '#16a34a'} />
              </div>
              {parseInt(stats.photo_stats?.missing_embedding) > 0 && (
                <div style={{ padding: '9px 14px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, fontFamily: "'Syne', sans-serif", fontSize: 12, color: '#dc2626', marginBottom: 6 }}>
                  ⚠️ {stats.photo_stats.missing_embedding} photos can't be found by AI — missing embeddings.
                </div>
              )}
              {parseInt(stats.photo_stats?.missing_embedding) === 0 && parseInt(stats.photo_stats?.needs_recaption) === 0 && (
                <div style={{ padding: '9px 14px', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 10, fontFamily: "'Syne', sans-serif", fontSize: 12, color: '#15803d' }}>
                  ✅ All photos are properly indexed and searchable!
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'fix_embeddings', label: 'Fix missing embeddings', desc: 'Generates vector embeddings so photos can be found by AI search' },
              { key: 'fix_captions',   label: 'Fix poor captions',      desc: 'Regenerates AI descriptions for photos marked as needing recaption' },
              { key: 'fix_face_tags',  label: 'Fix face tags',          desc: 'Links people mentioned in descriptions to photos missing face tags' },
              { key: 'dry_run',        label: 'Dry run (preview only)', desc: 'Shows what would be fixed without making any changes' },
            ].map(({ key, label, desc }) => (
              <label key={key} className="check-row" onClick={() => toggle(key)}>
                <input type="checkbox" checked={options[key]} onChange={() => {}} />
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: '#111' }}>{label}</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.4)', marginTop: 2 }}>{desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600, color: 'rgba(17,17,17,0.5)' }}>Max photos per run:</label>
            <select value={options.limit} onChange={e => setOptions(p => ({ ...p, limit: parseInt(e.target.value) }))}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(17,17,17,0.12)', background: '#fff', fontFamily: "'Syne', sans-serif", fontSize: 13, outline: 'none' }}>
              <option value={10}>10 (fast)</option>
              <option value={25}>25</option>
              <option value={50}>50 (recommended)</option>
              <option value={100}>100 (slow)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <RunBtn onClick={runBackfill} loading={running} label={options.dry_run ? '🔍 Preview' : '🔧 Run Fix'} loadingLabel={options.dry_run ? 'Scanning…' : 'Fixing…'} />
            <button onClick={fetchStats} disabled={loading || running}
              style={{ padding: '11px 18px', borderRadius: 100, background: 'rgba(17,17,17,0.06)', border: '1.5px solid rgba(17,17,17,0.12)', fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color: '#111', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
          </div>

          {running && (
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.45)', marginTop: 10 }}>
              This may take 1–2 minutes depending on how many photos need fixing…
            </p>
          )}

          {result && (
            <div style={{ marginTop: 16, padding: '14px 16px', background: result.error ? 'rgba(220,38,38,0.06)' : '#faf8f4', border: `1px solid ${result.error ? 'rgba(220,38,38,0.2)' : 'rgba(17,17,17,0.08)'}`, borderRadius: 12 }}>
              {result.error ? (
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: '#dc2626' }}>✗ {result.error}</p>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    {[
                      { label: 'Embeddings Fixed',     value: result.summary?.embeddings_fixed,       color: '#16a34a' },
                      { label: 'Embeddings Failed',    value: result.summary?.embeddings_failed,      color: '#dc2626' },
                      { label: 'Captions Fixed',       value: result.summary?.captions_fixed,         color: '#16a34a' },
                      { label: 'Face Tags Added',      value: result.summary?.face_tags_added,        color: '#3b82f6' },
                      { label: 'Descriptions Enriched',value: result.summary?.descriptions_enriched,  color: '#8b5cf6' },
                      { label: 'Errors',               value: result.summary?.errors_count,           color: '#dc2626' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(17,17,17,0.03)', borderRadius: 8 }}>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.5)' }}>{item.label}</span>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 800, color: (item.value ?? 0) > 0 ? item.color : 'rgba(17,17,17,0.25)' }}>{item.value ?? 0}</span>
                      </div>
                    ))}
                  </div>
                  {result.after_stats && !result.dry_run && (
                    <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: '#15803d', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 8, padding: '7px 12px', margin: 0 }}>
                      ✓ {result.after_stats.has_embedding}/{result.after_stats.total} photos now searchable
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </Section>

        {/* ── SECTION 2: Map Location Fix ── */}
        <Section title="🗺️ Map Location Fix" subtitle="Converts place names to GPS coordinates so all photos appear on the map. Also fixes any photos showing in the wrong country.">

          {geoStats && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <StatCard label="On Map" value={geoStats.stats?.has_gps} total={geoStats.stats?.total_photos} color="#16a34a" />
                <StatCard label="Need Geocoding" value={geoStats.stats?.needs_geocoding} total={geoStats.stats?.total_photos} color={parseInt(geoStats.stats?.needs_geocoding) > 0 ? '#dc2626' : '#16a34a'} />
                <StatCard label="Wrong Coords" value={geoStats.stats?.wrong_sign_us} color={parseInt(geoStats.stats?.wrong_sign_us) > 0 ? '#f59e0b' : '#16a34a'} />
                <StatCard label="No Location" value={geoStats.stats?.no_location} color="rgba(17,17,17,0.4)" />
              </div>

              {geoStats.places_to_geocode?.length > 0 && (
                <div style={{ padding: '10px 14px', background: 'rgba(17,17,17,0.03)', border: '1px solid rgba(17,17,17,0.08)', borderRadius: 10, maxHeight: 140, overflowY: 'auto', marginBottom: 10 }}>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: 'rgba(17,17,17,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Places to geocode ({geoStats.places_to_geocode.length})
                  </p>
                  {geoStats.places_to_geocode.map((p, i) => (
                    <div key={i} style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.6)', marginBottom: 3 }}>
                      📍 {p.place_name}
                      <span style={{ color: 'rgba(17,17,17,0.35)', marginLeft: 6 }}>({p.photo_count} photo{p.photo_count !== 1 ? 's' : ''})</span>
                    </div>
                  ))}
                </div>
              )}

              {parseInt(geoStats.stats?.needs_geocoding) === 0 && parseInt(geoStats.stats?.wrong_sign_us) === 0 && (
                <div style={{ padding: '9px 14px', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 10, fontFamily: "'Syne', sans-serif", fontSize: 12, color: '#15803d', marginBottom: 10 }}>
                  ✅ All photos with locations are on the map!
                </div>
              )}
            </div>
          )}

          {geoResult && (
            <div style={{ marginBottom: 14, padding: '12px 14px', background: geoResult.error ? 'rgba(220,38,38,0.06)' : 'rgba(22,163,74,0.06)', border: `1px solid ${geoResult.error ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)'}`, borderRadius: 10 }}>
              {geoResult.error ? (
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: '#dc2626', margin: 0 }}>✗ {geoResult.error}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    geoResult.summary?.wrong_sign_fixed > 0 && `✓ Fixed ${geoResult.summary.wrong_sign_fixed} photos with wrong coordinates`,
                    geoResult.summary?.photos_updated > 0 && `✓ Added GPS to ${geoResult.summary.photos_updated} photos (${geoResult.summary.places_geocoded} places)`,
                    geoResult.summary?.geocode_failed > 0 && `⚠ ${geoResult.summary.geocode_failed} places couldn't be found`,
                    geoResult.after_stats && `Now ${geoResult.after_stats.now_has_gps}/${geoResult.after_stats.total} photos visible on map`,
                  ].filter(Boolean).map((msg, i) => (
                    <p key={i} style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: String(msg).startsWith('⚠') ? '#f59e0b' : '#15803d', margin: 0 }}>{msg}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <RunBtn onClick={runGeocode} loading={geoRunning} label="🗺️ Fix Map Locations" loadingLabel="Geocoding… (takes ~30s)" />
            <button onClick={fetchGeoStats}
              style={{ padding: '11px 18px', borderRadius: 100, background: 'rgba(17,17,17,0.06)', border: '1.5px solid rgba(17,17,17,0.12)', fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color: '#111', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
          </div>

          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, color: 'rgba(17,17,17,0.35)', marginTop: 8, lineHeight: 1.6 }}>
            Geocodes each unique place name via OpenStreetMap. Safe to run multiple times — only updates photos missing coordinates.
          </p>
        </Section>

        {/* ── Tips ── */}
        <div style={{ padding: '20px 24px', background: '#faf8f4', border: '1px solid rgba(17,17,17,0.08)', borderRadius: 14, maxWidth: 600 }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.4)', marginBottom: 12 }}>💡 Tips</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[
              'Run AI Search Fix after every batch upload',
              'Run Map Location Fix if photos are missing from the map',
              'Tag faces on the People page for better person searches',
              '100% embedding coverage = perfect AI search accuracy',
              'If a photo shows in the wrong country, run Map Location Fix',
            ].map((tip, i) => (
              <div key={i} style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.55)', display: 'flex', gap: 8 }}>
                <span style={{ color: '#111', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                {tip}
              </div>
            ))}
          </div>
        </div>

      </main>
    </>
  );
}