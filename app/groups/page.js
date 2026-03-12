'use client';

import { useState, useEffect } from 'react';
import Header from '../../components/Header';
import Sidebar from '../../components/Sidebar';
import { useSession } from 'next-auth/react';

export default function Groups() {
  const { data: session } = useSession();

  const [groups, setGroups]                     = useState([]);
  const [selectedGroup, setSelectedGroup]       = useState(null);
  const [groupDetail, setGroupDetail]           = useState(null);
  const [showCreate, setShowCreate]             = useState(false);
  const [newGroup, setNewGroup]                 = useState({ name: '', description: '' });
  const [creating, setCreating]                 = useState(false);
  const [newMember, setNewMember]               = useState('');
  const [addingMember, setAddingMember]         = useState(false);
  const [memberMsg, setMemberMsg]               = useState('');
  const [deleting, setDeleting]                 = useState(null);
  const [removingMember, setRemovingMember]     = useState(null);
  const [myAlbums, setMyAlbums]                 = useState([]);
  const [showShareAlbum, setShowShareAlbum]     = useState(false);
  const [sharingAlbum, setSharingAlbum]         = useState(null);
  const [albumShareMsg, setAlbumShareMsg]       = useState('');

  useEffect(() => { fetchGroups(); }, []);

  // ── Original handlers — untouched ──
  const fetchGroups = async () => {
    const res = await fetch('/api/groups');
    const data = await res.json();
    if (data.groups) setGroups(data.groups);
  };

  const fetchGroupDetail = async (id) => {
    const res = await fetch('/api/groups/' + id);
    const data = await res.json();
    if (data.group) setGroupDetail(data);
  };

  const fetchMyAlbums = async () => {
    const res = await fetch('/api/albums');
    const data = await res.json();
    if (data.albums) setMyAlbums(data.albums);
  };

  const handleSelectGroup = async (group) => {
    setSelectedGroup(group);
    setMemberMsg('');
    await fetchGroupDetail(group.id);
  };

  const handleCreate = async () => {
    if (!newGroup.name.trim()) return;
    setCreating(true);
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newGroup),
    });
    const data = await res.json();
    if (data.group) {
      await fetchGroups();
      setNewGroup({ name: '', description: '' });
      setShowCreate(false);
      handleSelectGroup(data.group);
    }
    setCreating(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this group?')) return;
    setDeleting(id);
    await fetch('/api/groups/' + id, { method: 'DELETE' });
    await fetchGroups();
    setSelectedGroup(null);
    setGroupDetail(null);
    setDeleting(null);
  };

  const handleAddMember = async () => {
    if (!newMember.trim()) return;
    setAddingMember(true);
    setMemberMsg('');
    const res = await fetch('/api/groups/' + selectedGroup.id + '/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newMember.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setMemberMsg('Added: ' + newMember);
      setNewMember('');
      await fetchGroupDetail(selectedGroup.id);
    } else {
      setMemberMsg('Error: ' + data.error);
    }
    setAddingMember(false);
  };

  const handleRemoveMember = async (username) => {
    if (!confirm('Remove ' + username + ' from group?')) return;
    setRemovingMember(username);
    await fetch('/api/groups/' + selectedGroup.id + '/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    await fetchGroupDetail(selectedGroup.id);
    setRemovingMember(null);
  };

  const handleShareAlbum = async (albumId) => {
    setSharingAlbum(albumId);
    setAlbumShareMsg('');
    const res = await fetch('/api/groups/' + selectedGroup.id + '/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId }),
    });
    const data = await res.json();
    if (res.ok) {
      setAlbumShareMsg('Album shared with group');
      await fetchGroupDetail(selectedGroup.id);
    } else {
      setAlbumShareMsg('Error: ' + data.error);
    }
    setSharingAlbum(null);
  };

  const handleUnshareAlbum = async (albumId) => {
    await fetch('/api/groups/' + selectedGroup.id + '/albums', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId }),
    });
    await fetchGroupDetail(selectedGroup.id);
  };

  const isOwner       = groupDetail && session?.user?.username === groupDetail.group.created_by;
  const msgIsSuccess  = (msg) => msg.startsWith('Added') || msg.startsWith('Album shared');

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing:border-box; }
        body { background:#f2efe9; font-family:'Syne',sans-serif; }

        @keyframes fadeUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleIn {
          from { opacity:0; transform:scale(0.96) translateY(-8px); }
          to   { opacity:1; transform:scale(1) translateY(0); }
        }

        .fu-1 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .fu-2 { animation: fadeUp 0.65s cubic-bezier(0.22,1,0.36,1) 0.14s both; }

        .btn {
          display:inline-flex; align-items:center; gap:7px;
          padding:10px 20px; border-radius:100px; border:none; cursor:pointer;
          font-family:'Syne',sans-serif; font-size:12px; font-weight:700;
          letter-spacing:0.05em; text-transform:uppercase;
          transition:transform 0.18s, box-shadow 0.18s, background 0.18s;
        }
        .btn:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(0,0,0,0.1); }
        .btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; box-shadow:none; }
        .btn-primary { background:#111; color:#f2efe9; }
        .btn-ghost   { background:rgba(17,17,17,0.06); color:#111; border:1.5px solid rgba(17,17,17,0.12); }
        .btn-ghost:hover { background:rgba(17,17,17,0.1); }
        .btn-danger  { background:rgba(220,38,38,0.07); color:#c0392b; border:1.5px solid rgba(220,38,38,0.18); }
        .btn-danger:hover { background:rgba(220,38,38,0.12); }
        .btn-sm { padding:6px 14px; font-size:11px; }

        /* Group card */
        .group-card {
          background:#faf8f4; border:1.5px solid rgba(17,17,17,0.07);
          border-radius:14px; padding:18px 20px; cursor:pointer;
          transition:border-color 0.18s, box-shadow 0.18s, transform 0.18s;
        }
        .group-card:hover { border-color:rgba(17,17,17,0.18); transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,0.07); }
        .group-card.active { border-color:#111; box-shadow:0 0 0 1px #111; }
        .group-name {
          font-family:'Syne',sans-serif; font-size:14px; font-weight:700; color:#111; margin-bottom:4px;
        }
        .group-desc {
          font-family:'Syne',sans-serif; font-size:12px; color:rgba(17,17,17,0.42); margin-bottom:8px;
        }
        .group-meta {
          font-family:'Syne',sans-serif; font-size:11px; font-weight:500;
          letter-spacing:0.06em; text-transform:uppercase; color:rgba(17,17,17,0.32);
          display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        }
        .owner-badge {
          background:rgba(17,17,17,0.08); color:rgba(17,17,17,0.55);
          padding:2px 8px; border-radius:100px;
          font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase;
        }

        /* Panel card */
        .panel {
          background:#faf8f4; border:1px solid rgba(17,17,17,0.07);
          border-radius:16px; overflow:hidden;
        }
        .panel-header {
          padding:16px 20px; border-bottom:1px solid rgba(17,17,17,0.07);
          display:flex; justify-content:space-between; align-items:center;
        }
        .panel-title {
          font-family:'Syne',sans-serif; font-size:13px; font-weight:700;
          letter-spacing:0.04em; text-transform:uppercase; color:rgba(17,17,17,0.55);
        }
        .panel-body { padding:20px; }

        /* Member row */
        .member-row {
          display:flex; justify-content:space-between; align-items:center;
          padding:10px 12px; border-radius:10px; background:rgba(17,17,17,0.03);
          margin-bottom:6px;
        }
        .member-name { font-family:'Syne',sans-serif; font-size:13px; font-weight:600; color:#111; }
        .role-badge {
          padding:2px 8px; border-radius:100px;
          font-family:'Syne',sans-serif; font-size:10px; font-weight:700;
          letter-spacing:0.08em; text-transform:uppercase;
        }
        .role-owner  { background:rgba(17,17,17,0.08); color:rgba(17,17,17,0.6); }
        .role-member { background:rgba(45,138,94,0.1); color:#2d8a5e; }

        /* Add member input row */
        .input-row { display:flex; gap:8px; margin-top:12px; }
        .text-input {
          flex:1; padding:10px 16px;
          background:rgba(17,17,17,0.04); border:1.5px solid rgba(17,17,17,0.12);
          border-radius:100px; outline:none;
          font-family:'Syne',sans-serif; font-size:13px; color:#111;
          transition:border-color 0.2s, background 0.2s;
        }
        .text-input:focus { border-color:rgba(17,17,17,0.5); background:#fff; }
        .text-input::placeholder { color:rgba(17,17,17,0.28); }

        /* Album mini card */
        .album-mini {
          background:rgba(17,17,17,0.03); border:1px solid rgba(17,17,17,0.07);
          border-radius:12px; overflow:hidden;
        }
        .album-mini-cover {
          height:110px; background:rgba(17,17,17,0.06);
          display:flex; align-items:center; justify-content:center; overflow:hidden;
        }
        .album-mini-cover img { width:100%; height:100%; object-fit:cover; }
        .album-mini-info { padding:10px 12px; }
        .album-mini-name { font-family:'Syne',sans-serif; font-size:13px; font-weight:700; color:#111; margin-bottom:2px; }
        .album-mini-meta { font-family:'Syne',sans-serif; font-size:11px; color:rgba(17,17,17,0.38); }

        /* Modal */
        .modal-overlay {
          position:fixed; inset:0; background:rgba(8,5,3,0.65); z-index:2000;
          display:flex; align-items:center; justify-content:center; padding:24px;
          animation: fadeIn 0.18s ease both;
        }
        .modal-card {
          background:#faf8f4; border:1px solid rgba(17,17,17,0.08);
          border-radius:24px; padding:clamp(28px,4vw,40px);
          width:100%; max-width:440px;
          box-shadow:0 32px 80px rgba(0,0,0,0.22);
          animation: scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both;
        }
        .modal-card-lg {
          max-width:520px; max-height:82vh;
          display:flex; flex-direction:column; padding:0;
        }
        .modal-title {
          font-family:'Instrument Serif',serif;
          font-size:clamp(22px,2.5vw,28px); font-weight:400; font-style:italic;
          color:#111; letter-spacing:-0.02em; margin-bottom:24px;
        }
        .field { margin-bottom:16px; }
        .field-label {
          display:block; margin-bottom:7px;
          font-family:'Syne',sans-serif; font-size:11px; font-weight:600;
          letter-spacing:0.12em; text-transform:uppercase; color:rgba(17,17,17,0.42);
        }
        .field-input, .field-textarea {
          width:100%; padding:12px 16px;
          background:rgba(17,17,17,0.04); border:1.5px solid rgba(17,17,17,0.11);
          border-radius:10px; outline:none;
          font-family:'Syne',sans-serif; font-size:14px; color:#111;
          transition:border-color 0.2s, background 0.2s, box-shadow 0.2s;
        }
        .field-input:focus, .field-textarea:focus {
          border-color:rgba(17,17,17,0.5); background:#fff;
          box-shadow:0 0 0 3px rgba(17,17,17,0.05);
        }
        .field-input::placeholder, .field-textarea::placeholder { color:rgba(17,17,17,0.25); }
        .field-textarea { resize:vertical; min-height:76px; }
        .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:22px; }

        .empty-state { text-align:center; padding:60px 24px; }
        .empty-icon {
          width:56px; height:56px; border-radius:16px;
          background:rgba(17,17,17,0.05); border:1.5px solid rgba(17,17,17,0.08);
          display:flex; align-items:center; justify-content:center; margin:0 auto 16px;
        }
      `}</style>

      <Header />
      <Sidebar />

      <main style={{ marginLeft:'240px', marginTop:'62px', padding:'36px 32px', minHeight:'calc(100vh - 62px)', background:'#f2efe9' }}>

        {/* Header */}
        <div className="fu-1" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:36, flexWrap:'wrap', gap:16 }}>
          <div>
            <p style={{ fontFamily:"'Syne',sans-serif", fontSize:11, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(17,17,17,0.35)', marginBottom:6 }}>
              Collaborate
            </p>
            <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:'clamp(26px,3.5vw,40px)', fontWeight:400, fontStyle:'italic', color:'#111', lineHeight:1.1, letterSpacing:'-0.02em' }}>
              Groups
            </h1>
          </div>
          {/* Original onClick */}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Group
          </button>
        </div>

        {/* Two-column layout — original grid logic preserved */}
        <div className="fu-2" style={{ display:'grid', gridTemplateColumns: selectedGroup ? '280px 1fr' : '1fr', gap:24, alignItems:'start' }}>

          {/* Groups list */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {groups.length > 0 ? groups.map((group) => (
              <div
                key={group.id}
                className={`group-card${selectedGroup?.id === group.id ? ' active' : ''}`}
                onClick={() => handleSelectGroup(group)}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="group-name">{group.name}</div>
                    {group.description && <div className="group-desc">{group.description}</div>}
                    <div className="group-meta">
                      {group.member_count} member{group.member_count !== '1' ? 's' : ''}
                      <span style={{ opacity:0.4 }}>·</span>
                      {group.album_count} album{group.album_count !== '1' ? 's' : ''}
                      {group.is_owner && <span className="owner-badge">Owner</span>}
                    </div>
                  </div>
                  {/* Delete — original onClick + condition */}
                  {group.is_owner && (
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ marginLeft:8, flexShrink:0 }}
                      onClick={(e) => { e.stopPropagation(); handleDelete(group.id); }}
                      disabled={deleting === group.id}
                    >
                      {deleting === group.id ? '…' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            )) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(17,17,17,0.3)" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>
                </div>
                <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:18, fontStyle:'italic', color:'rgba(17,17,17,0.42)', marginBottom:6 }}>No groups yet</p>
                <p style={{ fontFamily:"'Syne',sans-serif", fontSize:12, color:'rgba(17,17,17,0.32)' }}>Create a group to collaborate</p>
              </div>
            )}
          </div>

          {/* Group detail — original condition preserved */}
          {selectedGroup && groupDetail && (
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

              {/* Members panel */}
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Members ({groupDetail.members.length})</span>
                </div>
                <div className="panel-body">
                  {groupDetail.members.map((member) => (
                    <div key={member.username} className="member-row">
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:30, height:30, borderRadius:'50%', background:'rgba(17,17,17,0.08)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:700, color:'#111' }}>
                          {member.username[0]?.toUpperCase()}
                        </div>
                        <span className="member-name">{member.username}</span>
                        <span className={`role-badge ${member.role === 'owner' ? 'role-owner' : 'role-member'}`}>
                          {member.role}
                        </span>
                      </div>
                      {/* Remove — original condition + handler */}
                      {isOwner && member.role !== 'owner' && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemoveMember(member.username)}
                          disabled={removingMember === member.username}
                        >
                          {removingMember === member.username ? '…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add member — original isOwner condition */}
                  {isOwner && (
                    <div>
                      <div className="input-row">
                        <input
                          className="text-input"
                          type="text"
                          value={newMember}
                          onChange={(e) => { setNewMember(e.target.value); setMemberMsg(''); }}
                          placeholder="Add member by username…"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAddMember(); }}
                        />
                        <button
                          className="btn btn-primary"
                          onClick={handleAddMember}
                          disabled={addingMember || !newMember.trim()}
                          style={{ flexShrink:0 }}
                        >{addingMember ? '…' : '+ Add'}</button>
                      </div>
                      {memberMsg && (
                        <p style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:500, color: msgIsSuccess(memberMsg) ? '#2d8a5e' : '#c0392b', marginTop:8, marginBottom:0 }}>
                          {memberMsg}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Albums panel */}
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Group Albums ({groupDetail.albums.length})</span>
                  {/* Original onClick */}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => { await fetchMyAlbums(); setShowShareAlbum(true); setAlbumShareMsg(''); }}
                  >+ Share album</button>
                </div>
                <div className="panel-body">
                  {groupDetail.albums.length > 0 ? (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:14 }}>
                      {groupDetail.albums.map((album) => (
                        <div key={album.id} className="album-mini">
                          <div className="album-mini-cover">
                            {album.cover_url
                              ? <img src={album.cover_url} alt="" />
                              : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(17,17,17,0.2)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                            }
                          </div>
                          <div className="album-mini-info">
                            <div className="album-mini-name">{album.name}</div>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:4 }}>
                              <span className="album-mini-meta">{album.photo_count} photos</span>
                              {/* Original shared_by condition */}
                              {album.shared_by === session?.user?.username && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  style={{ padding:'4px 10px' }}
                                  onClick={() => handleUnshareAlbum(album.id)}
                                >Remove</button>
                              )}
                            </div>
                            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:11, color:'rgba(17,17,17,0.32)', marginTop:2 }}>by @{album.shared_by}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.38)', textAlign:'center', padding:'24px 0' }}>
                      No albums shared with this group yet
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Create Group Modal — original handleCreate preserved ── */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Create new group</h2>
            <div className="field">
              <label className="field-label">Group name *</label>
              <input
                className="field-input"
                type="text"
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                placeholder="e.g. Family, Friends, Team"
              />
            </div>
            <div className="field">
              <label className="field-label">Description (optional)</label>
              <textarea
                className="field-textarea"
                value={newGroup.description}
                onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                placeholder="What is this group for?"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setNewGroup({ name:'', description:'' }); }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !newGroup.name.trim()}
              >{creating ? 'Creating…' : 'Create group'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share Album with Group Modal — original logic preserved ── */}
      {showShareAlbum && (
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg" style={{ background:'#faf8f4', borderRadius:24 }}>
            <div style={{ padding:'28px 32px 20px', borderBottom:'1px solid rgba(17,17,17,0.07)' }}>
              <h2 className="modal-title" style={{ marginBottom:4 }}>Share album with group</h2>
              <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.42)' }}>
                {selectedGroup?.name}
              </p>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'20px 32px' }}>
              {albumShareMsg && (
                <p style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:500, color: msgIsSuccess(albumShareMsg) ? '#2d8a5e' : '#c0392b', marginBottom:16 }}>
                  {albumShareMsg}
                </p>
              )}
              {myAlbums.length > 0 ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {myAlbums.map((album) => {
                    const alreadyShared = groupDetail?.albums?.some((a) => a.id === album.id);
                    return (
                      <div key={album.id} style={{
                        display:'flex', justifyContent:'space-between', alignItems:'center',
                        padding:'12px 16px', background:'rgba(17,17,17,0.03)',
                        border:'1px solid rgba(17,17,17,0.07)', borderRadius:12,
                      }}>
                        <div>
                          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:700, color:'#111', marginBottom:2 }}>{album.name}</div>
                          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:11, color:'rgba(17,17,17,0.38)' }}>{album.photo_count} photos</div>
                        </div>
                        {/* Original condition + handler */}
                        <button
                          className={`btn btn-sm ${alreadyShared ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => { if (!alreadyShared) handleShareAlbum(album.id); }}
                          disabled={alreadyShared || sharingAlbum === album.id}
                          style={{ opacity: alreadyShared ? 0.55 : 1 }}
                        >
                          {alreadyShared ? 'Shared ✓' : sharingAlbum === album.id ? '…' : 'Share'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontFamily:"'Syne',sans-serif", fontSize:13, color:'rgba(17,17,17,0.38)', textAlign:'center', padding:'32px 0' }}>
                  You have no albums to share
                </p>
              )}
            </div>

            <div style={{ padding:'16px 32px', borderTop:'1px solid rgba(17,17,17,0.07)' }}>
              <button
                className="btn btn-ghost"
                style={{ width:'100%', justifyContent:'center' }}
                onClick={() => { setShowShareAlbum(false); setAlbumShareMsg(''); }}
              >Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}