/* =============================================
   Main Application – NAS Music Player
   ============================================= */

const App = (() => {
  // ── State ──
  let currentRoute = '';
  let allSongs = [];
  let allArtists = [];
  let allAlbums = [];
  let allPlaylists = [];
  let currentViewSongs = []; // songs in the current view (for context menu)
  let searchDebounceTimer = null;
  let addSongToPlaylistId = null; // song ID waiting to be added to playlist

  // ── DOM cache ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Toast Notifications ──
  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ── Route handling ──
  function navigateTo(hash) {
    window.location.hash = hash;
  }

  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    const parts = hash.split('/');
    const route = parts[0];
    const param = parts[1];

    currentRoute = hash;

    // Update active nav link
    $$('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.route === route || (route === 'playlist' && link.dataset.route === param));
    });

    // Route to view
    switch (route) {
      case 'login':
        showLoginPage();
        break;
      case 'home':
        showMainApp();
        renderSongList();
        break;
      case 'artists':
        showMainApp();
        renderArtistList();
        break;
      case 'artist':
        showMainApp();
        renderArtistDetail(param);
        break;
      case 'albums':
        showMainApp();
        renderAlbumList();
        break;
      case 'album':
        showMainApp();
        renderAlbumDetail(param);
        break;
      case 'playlist':
        showMainApp();
        renderPlaylistView(param);
        break;
      case 'search':
        showMainApp();
        renderSearchResults(decodeURIComponent(parts.slice(1).join('/')));
        break;
      default:
        showMainApp();
        renderSongList();
    }
  }

  function showLoginPage() {
    $('#login-page').classList.add('active');
    $('#app-page').classList.remove('active');
  }

  function showMainApp() {
    $('#login-page').classList.remove('active');
    $('#app-page').classList.add('active');
  }

  // ── Data loading ──
  async function loadAllSongs() {
    try {
      allSongs = await API.getSongs();
      return allSongs;
    } catch (e) {
      console.error('Failed to load songs:', e);
      return [];
    }
  }

  async function loadArtists() {
    try {
      allArtists = await API.getArtists();
      return allArtists;
    } catch (e) {
      console.error('Failed to load artists:', e);
      return [];
    }
  }

  async function loadAlbums() {
    try {
      allAlbums = await API.getAlbums();
      return allAlbums;
    } catch (e) {
      console.error('Failed to load albums:', e);
      return [];
    }
  }

  async function loadPlaylists() {
    try {
      allPlaylists = await API.getPlaylists();
      renderPlaylistSidebar();
      return allPlaylists;
    } catch (e) {
      console.error('Failed to load playlists:', e);
      return [];
    }
  }

  // ── View Renderers ──

  function renderSongList(songs) {
    const container = $('#view-container');
    const songData = songs || allSongs;

    if (!songData || songData.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎵</div>
          <h3>No music found</h3>
          <p>Add music files to your NAS library and scan.</p>
        </div>`;
      return;
    }

    currentViewSongs = songData;

    container.innerHTML = `
      <div class="view-header">
        <h1>All Music</h1>
        <div class="view-actions">
          <button class="btn btn-primary" id="btn-play-all">▶ Play All</button>
        </div>
      </div>
      <div class="song-list">
        <div class="song-list-header">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          <span>Duration</span>
          <span></span>
        </div>
        ${songData.map((song, i) => renderSongRow(song, i + 1)).join('')}
      </div>`;

    bindSongListEvents();
  }

  function renderSongRow(song, index) {
    const isPlaying = Player.currentSong && Player.currentSong.id === song.id;
    const playingClass = isPlaying ? ' playing' : '';

    return `
      <div class="song-row${playingClass}" data-song-id="${song.id}" data-index="${index - 1}">
        <div class="song-index">
          <span class="song-index-text">${index}</span>
          <span class="song-play-btn">▶</span>
          <span class="song-eq-icon">
            <span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>
          </span>
        </div>
        <div class="song-title">${escapeHtml(song.title || 'Unknown')}</div>
        <div class="song-artist">${escapeHtml(song.artist || 'Unknown')}</div>
        <div class="song-duration">${Player.formatTime(song.duration)}</div>
        <div class="song-actions">
          <button class="btn-icon btn-add-playlist" title="Add to playlist" data-song-id="${song.id}">➕</button>
          <button class="btn-icon btn-add-queue" title="Add to queue" data-song-id="${song.id}">📋</button>
        </div>
      </div>`;
  }

  function renderArtistList() {
    const container = $('#view-container');

    if (!allArtists || allArtists.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎤</div>
          <h3>No artists found</h3>
          <p>Artists will appear once music is scanned.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="view-header">
        <h1>Artists</h1>
      </div>
      <div class="artist-grid">
        ${allArtists.map(artist => `
          <div class="artist-card" data-artist-id="${artist.id}">
            <div class="artist-avatar">🎤</div>
            <h3>${escapeHtml(artist.name || 'Unknown')}</h3>
            <p>${artist.song_count || 0} songs</p>
          </div>
        `).join('')}
      </div>`;

    $$('.artist-card').forEach(card => {
      card.addEventListener('click', () => {
        navigateTo(`artist/${card.dataset.artistId}`);
      });
    });
  }

  async function renderArtistDetail(artistId) {
    const container = $('#view-container');
    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;

    try {
      const artist = await API.getArtist(artistId);
      const songs = await API.getSongsByArtist(artistId);

      container.innerHTML = `
        <div class="view-header">
          <div>
            <button class="btn btn-outline" id="btn-back-artists" style="margin-bottom:12px">← Back to Artists</button>
            <h1>${escapeHtml(artist.name || 'Unknown')}</h1>
            <p style="color:var(--text-secondary)">${songs.length} songs</p>
          </div>
          <div class="view-actions">
            <button class="btn btn-primary" id="btn-play-all-artist">▶ Play All</button>
          </div>
        </div>
        <div class="song-list">
          <div class="song-list-header">
            <span>#</span>
            <span>Title</span>
            <span>Album</span>
            <span>Duration</span>
            <span></span>
          </div>
          ${songs.map((s, i) => `
            <div class="song-row" data-song-id="${s.id}" data-index="${i}">
              <div class="song-index">
                <span class="song-index-text">${i + 1}</span>
                <span class="song-play-btn">▶</span>
                <span class="song-eq-icon">
                  <span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>
                </span>
              </div>
              <div class="song-title">${escapeHtml(s.title || 'Unknown')}</div>
              <div class="song-artist">${escapeHtml(s.album || '—')}</div>
              <div class="song-duration">${Player.formatTime(s.duration)}</div>
              <div class="song-actions">
                <button class="btn-icon btn-add-playlist" title="Add to playlist" data-song-id="${s.id}">➕</button>
                <button class="btn-icon btn-add-queue" title="Add to queue" data-song-id="${s.id}">📋</button>
              </div>
            </div>
          `).join('')}
        </div>`;

      currentViewSongs = songs;
      bindSongListEvents();

      $('#btn-back-artists').addEventListener('click', () => navigateTo('artists'));
      $('#btn-play-all-artist').addEventListener('click', () => {
        if (songs.length > 0) {
          Player.setQueue(songs, 0);
          Player.playSong(0);
        }
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Error loading artist</h3><p>${e.message}</p></div>`;
    }
  }

  function renderAlbumList() {
    const container = $('#view-container');

    if (!allAlbums || allAlbums.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💿</div>
          <h3>No albums found</h3>
          <p>Albums will appear once music is scanned.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="view-header">
        <h1>Albums</h1>
      </div>
      <div class="album-grid">
        ${allAlbums.map(album => `
          <div class="album-card" data-album-id="${album.id}">
            <div class="album-art">
              💿
              <div class="album-play-overlay">
                <div class="play-circle">▶</div>
              </div>
            </div>
            <div class="album-info">
              <h3>${escapeHtml(album.title || 'Unknown')}</h3>
              <p>${escapeHtml(album.artist || 'Unknown')}</p>
            </div>
          </div>
        `).join('')}
      </div>`;

    $$('.album-card').forEach(card => {
      card.addEventListener('click', () => {
        navigateTo(`album/${card.dataset.albumId}`);
      });
    });
  }

  async function renderAlbumDetail(albumId) {
    const container = $('#view-container');
    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;

    try {
      const album = await API.getAlbum(albumId);
      const songs = await API.getSongsByAlbum(albumId);

      container.innerHTML = `
        <div class="view-header">
          <div>
            <button class="btn btn-outline" id="btn-back-albums" style="margin-bottom:12px">← Back to Albums</button>
            <h1>${escapeHtml(album.title || 'Unknown')}</h1>
            <p style="color:var(--text-secondary)">${escapeHtml(album.artist || 'Unknown')} · ${songs.length} songs</p>
          </div>
          <div class="view-actions">
            <button class="btn btn-primary" id="btn-play-all-album">▶ Play All</button>
          </div>
        </div>
        <div class="song-list">
          <div class="song-list-header">
            <span>#</span>
            <span>Title</span>
            <span>Duration</span>
            <span></span>
          </div>
          ${songs.map((s, i) => `
            <div class="song-row" data-song-id="${s.id}" data-index="${i}">
              <div class="song-index">
                <span class="song-index-text">${i + 1}</span>
                <span class="song-play-btn">▶</span>
                <span class="song-eq-icon">
                  <span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>
                </span>
              </div>
              <div class="song-title">${escapeHtml(s.title || 'Unknown')}</div>
              <div class="song-duration">${Player.formatTime(s.duration)}</div>
              <div class="song-actions">
                <button class="btn-icon btn-add-playlist" title="Add to playlist" data-song-id="${s.id}">➕</button>
                <button class="btn-icon btn-add-queue" title="Add to queue" data-song-id="${s.id}">📋</button>
              </div>
            </div>
          `).join('')}
        </div>`;

      currentViewSongs = songs;
      bindSongListEvents();

      $('#btn-back-albums').addEventListener('click', () => navigateTo('albums'));
      $('#btn-play-all-album').addEventListener('click', () => {
        if (songs.length > 0) {
          Player.setQueue(songs, 0);
          Player.playSong(0);
        }
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Error loading album</h3><p>${e.message}</p></div>`;
    }
  }

  async function renderPlaylistView(playlistId) {
    const container = $('#view-container');
    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;

    try {
      const playlist = await API.getPlaylist(playlistId);
      const songs = playlist.songs || [];

      container.innerHTML = `
        <div class="view-header">
          <div class="playlist-view-header">
            <div class="playlist-cover">🎵</div>
            <div class="playlist-details">
              <h1>${escapeHtml(playlist.name || 'Playlist')}</h1>
              <p>${songs.length} songs</p>
              <div class="playlist-detail-actions">
                <button class="btn btn-primary" id="btn-play-playlist">▶ Play All</button>
                <button class="btn btn-outline btn-danger" id="btn-delete-playlist">🗑 Delete</button>
              </div>
            </div>
          </div>
        </div>
        ${songs.length > 0 ? `
          <div class="song-list">
            <div class="song-list-header">
              <span>#</span>
              <span>Title</span>
              <span>Artist</span>
              <span>Duration</span>
              <span></span>
            </div>
            ${songs.map((s, i) => `
              <div class="song-row" data-song-id="${s.id}" data-index="${i}">
                <div class="song-index">
                  <span class="song-index-text">${i + 1}</span>
                  <span class="song-play-btn">▶</span>
                  <span class="song-eq-icon">
                    <span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>
                  </span>
                </div>
                <div class="song-title">${escapeHtml(s.title || 'Unknown')}</div>
                <div class="song-artist">${escapeHtml(s.artist || 'Unknown')}</div>
                <div class="song-duration">${Player.formatTime(s.duration)}</div>
                <div class="song-actions">
                  <button class="btn-icon btn-remove-from-playlist" title="Remove" data-song-id="${s.id}">➖</button>
                  <button class="btn-icon btn-add-queue" title="Add to queue" data-song-id="${s.id}">📋</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <h3>Playlist is empty</h3>
            <p>Add songs from All Music or search.</p>
          </div>
        `}`;

      currentViewSongs = songs;
      bindSongListEvents();

      // Play all
      $('#btn-play-playlist').addEventListener('click', () => {
        if (songs.length > 0) {
          Player.setQueue(songs, 0);
          Player.playSong(0);
        }
      });

      // Delete playlist
      $('#btn-delete-playlist').addEventListener('click', async () => {
        if (confirm('Delete this playlist?')) {
          try {
            await API.deletePlaylist(playlistId);
            toast('Playlist deleted', 'success');
            await loadPlaylists();
            navigateTo('home');
          } catch (e) {
            toast('Failed to delete playlist: ' + e.message, 'error');
          }
        }
      });

      // Remove from playlist buttons
      $$('.btn-remove-from-playlist').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const songId = parseInt(btn.dataset.songId);
          try {
            await API.removeFromPlaylist(playlistId, songId);
            toast('Removed from playlist', 'success');
            await loadPlaylists();
            renderPlaylistView(playlistId);
          } catch (e) {
            toast('Failed: ' + e.message, 'error');
          }
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Error loading playlist</h3><p>${e.message}</p></div>`;
    }
  }

  function renderSearchResults(query) {
    const container = $('#view-container');

    if (!query || query.trim() === '') {
      renderSongList();
      return;
    }

    const q = query.toLowerCase();
    const results = allSongs.filter(s =>
      (s.title && s.title.toLowerCase().includes(q)) ||
      (s.artist && s.artist.toLowerCase().includes(q)) ||
      (s.album && s.album.toLowerCase().includes(q))
    );

    if (results.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No results for "${escapeHtml(query)}"</h3>
          <p>Try different keywords.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="view-header">
        <h1>Search Results</h1>
      </div>
      <div class="search-results-info">${results.length} result${results.length !== 1 ? 's' : ''} for "${escapeHtml(query)}"</div>
      <div class="song-list">
        <div class="song-list-header">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          <span>Duration</span>
          <span></span>
        </div>
        ${results.map((song, i) => renderSongRow(song, i + 1)).join('')}
      </div>`;

    currentViewSongs = results;
    bindSongListEvents();
  }

  // ── Song List Event Binding ──
  function bindSongListEvents() {
    $$('.song-row').forEach(row => {
      const songId = parseInt(row.dataset.songId);

      row.addEventListener('click', (e) => {
        // Don't trigger play on action buttons
        if (e.target.closest('.song-actions')) return;

        const song = currentViewSongs.find(s => s.id === songId);
        if (song) {
          Player.playSongDirect(song, currentViewSongs);
        }
      });

      // Double click for alternate play
      row.addEventListener('dblclick', (e) => {
        e.preventDefault();
      });
    });

    // Add to playlist buttons
    $$('.btn-add-playlist').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addSongToPlaylistId = parseInt(btn.dataset.songId);
        showAddToPlaylistModal();
      });
    });

    // Add to queue buttons
    $$('.btn-add-queue').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const songId = parseInt(btn.dataset.songId);
        const song = currentViewSongs.find(s => s.id === songId) || allSongs.find(s => s.id === songId);
        if (song) {
          Player.addToQueue(song);
          toast('Added to queue', 'success');
          renderQueuePanel();
        }
      });
    });
  }

  // ── Playlist Sidebar ──
  function renderPlaylistSidebar() {
    const list = $('#playlist-list');
    if (!list) return;

    if (!allPlaylists || allPlaylists.length === 0) {
      list.innerHTML = '<li style="color:var(--text-muted);font-size:12px;padding:8px 12px;">No playlists yet</li>';
      return;
    }

    list.innerHTML = allPlaylists.map(p => `
      <li data-playlist-id="${p.id}" class="${currentRoute === `playlist/${p.id}` ? 'active' : ''}">
        <span class="playlist-icon">📋</span>
        <span>${escapeHtml(p.name)}</span>
        <span class="playlist-delete" data-playlist-id="${p.id}" title="Delete">🗑</span>
      </li>
    `).join('');

    list.querySelectorAll('li[data-playlist-id]').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('playlist-delete')) return;
        navigateTo(`playlist/${li.dataset.playlistId}`);
      });
    });

    list.querySelectorAll('.playlist-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.playlistId;
        if (confirm('Delete this playlist?')) {
          try {
            await API.deletePlaylist(id);
            toast('Playlist deleted', 'success');
            await loadPlaylists();
            if (currentRoute.startsWith('playlist/')) {
              navigateTo('home');
            }
          } catch (e) {
            toast('Failed: ' + e.message, 'error');
          }
        }
      });
    });
  }

  // ── Queue Panel ──
  function renderQueuePanel() {
    const queueList = $('#queue-list');
    if (!queueList) return;

    const queue = Player.queue;
    const idx = Player.queueIndex;

    if (queue.length === 0) {
      queueList.innerHTML = '<p class="queue-placeholder">Queue is empty</p>';
      return;
    }

    queueList.innerHTML = queue.map((song, i) => `
      <div class="queue-item${i === idx ? ' current' : ''}" data-index="${i}">
        <div class="queue-art">🎵</div>
        <div class="queue-info">
          <div class="queue-title">${escapeHtml(song.title || 'Unknown')}</div>
          <div class="queue-artist">${escapeHtml(song.artist || 'Unknown')}</div>
        </div>
        <button class="btn-icon btn-sm btn-remove-queue queue-remove" data-index="${i}" title="Remove">✕</button>
      </div>
    `).join('');

    queueList.querySelectorAll('.queue-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-queue')) return;
        const i = parseInt(item.dataset.index);
        Player.playSong(i);
        renderQueuePanel();
      });
    });

    queueList.querySelectorAll('.btn-remove-queue').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Player.removeFromQueue(parseInt(btn.dataset.index));
        renderQueuePanel();
      });
    });
  }

  // ── Add to Playlist Modal ──
  function showAddToPlaylistModal() {
    const modal = $('#modal-add-to-playlist');
    const list = $('#modal-playlist-list');

    if (!allPlaylists || allPlaylists.length === 0) {
      list.innerHTML = '<li style="color:var(--text-muted);padding:12px">No playlists. Create one first.</li>';
    } else {
      list.innerHTML = allPlaylists.map(p => `
        <li data-playlist-id="${p.id}">
          <span>📋</span>
          <span>${escapeHtml(p.name)}</span>
        </li>
      `).join('');

      list.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', async () => {
          const playlistId = parseInt(li.dataset.playlistId);
          try {
            await API.addToPlaylist(playlistId, addSongToPlaylistId);
            toast('Added to playlist', 'success');
            modal.classList.add('hidden');
          } catch (e) {
            toast('Failed: ' + e.message, 'error');
          }
        });
      });
    }

    modal.classList.remove('hidden');
  }

  // ── Admin Users Modal ──
  function showAdminUsersModal() {
    const modal = $('#modal-admin-users');
    modal.classList.remove('hidden');
    loadAdminUsers();
  }

  async function loadAdminUsers() {
    const list = $('#admin-user-list');
    list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
      const users = await API.getUsers();
      list.innerHTML = users.map(u => `
        <div class="admin-user-item">
          <div class="user-info">
            <div class="user-name">${escapeHtml(u.username)}</div>
            <div class="user-role">${u.role || 'user'}</div>
          </div>
          ${u.username !== 'admin' ? `<button class="btn btn-sm btn-outline btn-danger" data-user-id="${u.id}">Delete</button>` : ''}
        </div>
      `).join('');

      list.querySelectorAll('.btn-danger').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete this user?')) {
            try {
              await API.deleteUser(btn.dataset.userId);
              toast('User deleted', 'success');
              loadAdminUsers();
            } catch (e) {
              toast('Failed: ' + e.message, 'error');
            }
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<p style="color:var(--danger);padding:12px">${e.message}</p>`;
    }
  }

  // ── Lyrics ──
  async function loadLyricsForSong(song) {
    const panel = $('#lyrics-content');
    if (!song || !panel) return;

    try {
      const data = await API.getLyrics(song.id);
      const lrcText = data?.lyrics || data?.lrc || data?.text || '';
      if (lrcText) {
        Lyrics.load(lrcText, panel, {
          getCurrentTime: () => Player.currentTime,
          seekTo: (t) => Player.seekTo(t),
        });
      } else {
        Lyrics.clear(panel);
      }
    } catch (e) {
      Lyrics.clear(panel);
    }
  }

  // ── Download Handler ──
  function handleDownload(song) {
    if (!song) return;

    const modal = $('#modal-download');
    const filename = $('#download-filename');
    const fill = $('#download-progress-fill');
    const status = $('#download-status');

    filename.textContent = song.title || 'Unknown Song';
    fill.style.width = '0%';
    status.textContent = 'Starting download...';
    modal.classList.remove('hidden');

    // Use fetch with progress tracking if available, else fallback
    const url = API.getDownloadUrl(song.id);

    // Simple download via hidden link
    const a = document.createElement('a');
    a.href = url;
    a.download = `${song.title || 'song'}.mp3`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    status.textContent = 'Download started!';
    fill.style.width = '100%';
  }

  // ── Search ──
  function handleSearch(query) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (query && query.trim().length > 0) {
        navigateTo(`search/${encodeURIComponent(query.trim())}`);
      } else {
        navigateTo('home');
      }
    }, 300);
  }

  // ── Theme Toggle ──
  function initTheme() {
    const saved = localStorage.getItem('nas_theme');
    if (saved === 'light') {
      document.body.classList.add('light-theme');
    }
  }

  function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('nas_theme', isLight ? 'light' : 'dark');
    // Update button icon
    const btn = $('#btn-theme-toggle');
    if (btn) btn.textContent = isLight ? '☀️' : '🌙';

    // Try to save to API (ignore errors)
    API.updateTheme(isLight ? 'light' : 'dark').catch(() => {});
  }

  // ── Utility ──
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Init ──
  async function init() {
    // Init theme
    initTheme();
    const themeBtn = $('#btn-theme-toggle');
    if (themeBtn) {
      themeBtn.textContent = document.body.classList.contains('light-theme') ? '☀️' : '🌙';
    }

    // Init player
    Player.init();

    // Player callbacks
    Player.onSongChange = (song) => {
      Player.updateSongInfo(song);
      updateSongListHighlight();
      renderQueuePanel();
      // Reload lyrics if panel is open
      const lyricsPanel = $('#lyrics-panel');
      if (lyricsPanel && !lyricsPanel.classList.contains('hidden')) {
        loadLyricsForSong(song);
      }
    };

    // ── Login Form ──
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#login-username').value.trim();
      const password = $('#login-password').value;
      const errorEl = $('#login-error');
      const btn = $('#login-btn');

      if (!username || !password) {
        errorEl.textContent = 'Please enter username and password';
        errorEl.classList.remove('hidden');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>Signing in...</span>';
      errorEl.classList.add('hidden');

      try {
        await API.login(username, password);
        errorEl.classList.add('hidden');
        await loadAppData();
        navigateTo('home');
      } catch (err) {
        errorEl.textContent = err.message || 'Login failed';
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Sign In</span>';
      }
    });

    // ── Navigation ──
    $$('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.route);
        // Close mobile sidebar
        $('#sidebar').classList.remove('open');
      });
    });

    // ── Search ──
    $('#search-input').addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });

    $('#search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchDebounceTimer);
        handleSearch(e.target.value);
      }
    });

    // ── Create Playlist ──
    $('#btn-create-playlist').addEventListener('click', () => {
      $('#modal-create-playlist').classList.remove('hidden');
      $('#playlist-name-input').value = '';
      $('#playlist-name-input').focus();
    });

    $('#btn-confirm-create-playlist').addEventListener('click', async () => {
      const name = $('#playlist-name-input').value.trim();
      if (!name) {
        toast('Please enter a playlist name', 'error');
        return;
      }

      try {
        await API.createPlaylist(name);
        toast('Playlist created!', 'success');
        $('#modal-create-playlist').classList.add('hidden');
        await loadPlaylists();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    });

    // ── Scan Library ──
    $('#btn-scan').addEventListener('click', async () => {
      toast('Scanning library...', 'info');
      try {
        await API.triggerScan();
        toast('Scan complete! Refreshing...', 'success');
        await loadAppData();
        handleRoute(); // Re-render current view
      } catch (e) {
        toast('Scan failed: ' + e.message, 'error');
      }
    });

    // ── Theme Toggle ──
    $('#btn-theme-toggle').addEventListener('click', toggleTheme);

    // ── User Menu ──
    $('#btn-user-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#user-dropdown').classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      const dropdown = $('#user-dropdown');
      if (dropdown && !dropdown.contains(e.target) && e.target !== $('#btn-user-menu')) {
        dropdown.classList.add('hidden');
      }
    });

    $('#btn-logout').addEventListener('click', (e) => {
      e.preventDefault();
      API.clearToken();
      navigateTo('login');
      toast('Logged out', 'success');
    });

    // Admin users
    $('#btn-admin-users').addEventListener('click', (e) => {
      e.preventDefault();
      $('#user-dropdown').classList.add('hidden');
      showAdminUsersModal();
    });

    // Add user button
    $('#btn-add-user').addEventListener('click', async () => {
      const username = $('#new-user-username').value.trim();
      const password = $('#new-user-password').value;
      const role = $('#new-user-role').value;

      if (!username || !password) {
        toast('Please fill in username and password', 'error');
        return;
      }

      try {
        await API.createUser(username, password, role);
        toast('User created!', 'success');
        $('#new-user-username').value = '';
        $('#new-user-password').value = '';
        loadAdminUsers();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    });

    // ── Mobile Menu ──
    $('#mobile-menu-btn').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });

    $('#sidebar-close').addEventListener('click', () => {
      $('#sidebar').classList.remove('open');
    });

    // ── Queue panel close ──
    $('#btn-close-queue').addEventListener('click', () => {
      $('#queue-panel').classList.add('hidden');
    });

    // ── Lyrics panel close ──
    $('#btn-close-lyrics').addEventListener('click', () => {
      $('#lyrics-panel').classList.add('hidden');
      Lyrics.stopLoop();
    });

    // ── Modal close buttons ──
    $$('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal-overlay').classList.add('hidden');
      });
    });

    // Close modals on overlay click
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.add('hidden');
        }
      });
    });

    // ── Hash routing ──
    window.addEventListener('hashchange', handleRoute);

    // ── Check token ──
    if (API.getToken()) {
      try {
        await loadAppData();
        handleRoute();
      } catch (e) {
        console.error('Failed to load app data:', e);
        navigateTo('login');
      }
    } else {
      navigateTo('login');
    }
  }

  async function loadAppData() {
    // Show loading
    const username = getStoredUsername();
    if (username) {
      const userEl = $('#current-username');
      if (userEl) userEl.textContent = username;
    }

    // Load all data in parallel
    await Promise.all([
      loadAllSongs(),
      loadArtists(),
      loadAlbums(),
      loadPlaylists(),
    ]);
  }

  function getStoredUsername() {
    try {
      const token = API.getToken();
      if (!token) return null;
      // JWT payload decode (base64)
      const payload = token.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      return decoded.sub || decoded.username || 'User';
    } catch (_) {
      return 'User';
    }
  }

  function updateSongListHighlight() {
    $$('.song-row').forEach(row => {
      const songId = parseInt(row.dataset.songId);
      const isPlaying = Player.currentSong && Player.currentSong.id === songId;
      row.classList.toggle('playing', isPlaying);
    });
  }

  // Start app when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API (for cross-module use)
  return {
    handleDownload,
    loadLyricsForSong,
    toast,
  };
})();
