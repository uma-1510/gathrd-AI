'use client';

export default function LandingPage() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>Welcome to PhotoGPT</h1>
      <p style={{ fontSize: '1.25rem', color: '#555' }}>
        Ask questions about your photos, create memory graphs, and relive your memories.
      </p>
      <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
        <a href="/login" style={{ padding: '1rem 2rem', background: '#2563eb', color: 'white', borderRadius: '8px', textDecoration: 'none', fontWeight: '600' }}>
          Sign In
        </a>
        <a href="/signup" style={{ padding: '1rem 2rem', background: '#10b981', color: 'white', borderRadius: '8px', textDecoration: 'none', fontWeight: '600' }}>
          Sign Up
        </a>
      </div>
    </div>
  );
}