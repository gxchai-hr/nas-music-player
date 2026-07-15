/* =============================================
   API Client – NAS Music Player
   ============================================= */

const API = (() => {
  let BASE_URL = window.location.origin;

  // ── Helpers ──
  function getToken() {
    return localStorage.getItem('nas_token');
  }

  function setToken(token) {
    localStorage.setItem('nas_token', token);
  }

  function clearToken() {
    localStorage.removeItem('nas_token');
  }

  function headers(extra = {}) {
    const h = {
      'Content-Type': 'application/json',
      ...extra,
    };
    const token = getToken();
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }

  async function request(method, path, body = null, extraHeaders = {}) {
    const opts = {
      method,
      headers: headers(extraHeaders),
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE_URL}${path}`, opts);
    if (res.status === 401) {
      clearToken();
      window.location.hash = '#login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        errMsg = errBody.detail || errBody.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }
    // Handle empty responses
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  function streamUrl(path) {
    const token = getToken();
    const sep = path.includes('?') ? '&' : '?';
    return `${BASE_URL}${path}${sep}token=${encodeURIComponent(token || '')}`;
  }

  // ── Public API ──
  return {
    setBaseUrl(url) {
      BASE_URL = url;
    },

    getBaseUrl() {
      return BASE_URL;
    },

    getToken,
    setToken,
    clearToken,

    // Auth
    async login(username, password) {
      const data = await request('POST', '/api/login', { username, password });
      if (data && data.token) {
        setToken(data.token);
      }
      return data;
    },

    // Artists
    async getArtists() {
      const res = await request('GET', '/api/artists');
      return res?.artists || [];
    },

    async getArtist(name) {
      const res = await request('GET', `/api/artists/${encodeURIComponent(name)}`);
      return res?.name || name;
    },

    // Albums
    async getAlbums() {
      const res = await request('GET', '/api/albums');
      return res?.albums || [];
    },

    async getAlbum(name) {
      const res = await request('GET', `/api/albums/${encodeURIComponent(name)}`);
      return res?.name || name;
    },

    // Songs
    async getSongs() {
      const res = await request('GET', '/api/songs'); return res?.songs || [];
    },

    async getSong(id) {
      return request('GET', `/api/songs/${id}`);
    },

    async getSongsByArtist(artistName) {
      const res = await request('GET', `/api/artists/${encodeURIComponent(artistName)}`);
      return res?.songs || [];
    },

    async getSongsByAlbum(albumName) {
      const res = await request('GET', `/api/albums/${encodeURIComponent(albumName)}`);
      return res?.songs || [];
    },

    // Search
    async search(query) {
      return request('GET', `/api/search?q=${encodeURIComponent(query)}`);
    },

    // Playlists
    async getPlaylists() {
      const res = await request('GET', '/api/playlists'); return res?.playlists || [];
    },

    async getPlaylist(id) {
      return request('GET', `/api/playlists/${id}`);
    },

    async createPlaylist(name) {
      return request('POST', '/api/playlist/create', { name });
    },

    async deletePlaylist(id) {
      return request('DELETE', `/api/playlist/${id}`);
    },

    async addToPlaylist(playlistId, songId) {
      return request('POST', `/api/playlist/${playlistId}/add`, { song_id: songId });
    },

    async removeFromPlaylist(playlistId, songId) {
      return request('POST', `/api/playlist/${playlistId}/remove`, { song_id: songId });
    },

    // Lyrics
    async getLyrics(songId) {
      return request('GET', `/api/lyrics/${songId}`);
    },

    // Library
    async triggerScan(force = false) {
      return request('POST', `/api/scan?force=${force}`);
    },

    // Users (admin)
    async getUsers() {
      const res = await request('GET', '/api/users'); return res?.users || [];
    },

    async createUser(username, password, role) {
      return request('POST', '/api/users', { username, password, role });
    },

    async deleteUser(userId) {
      return request('DELETE', `/api/users/${userId}`);
    },

    // Theme
    async updateTheme(theme) {
      return request('PUT', '/api/theme', { theme });
    },

    // Directory browsing
    async getDirectory(path = '') {
      const res = await request('GET', `/api/directory?path=${encodeURIComponent(path)}`);
      return res?.items || [];
    },

    async getDirectorySongs(path) {
      const res = await request('GET', `/api/directory/songs?path=${encodeURIComponent(path)}`);
      return res?.songs || [];
    },

    // Streaming / Download URLs
    getStreamUrl(songId) {
      return streamUrl(`/api/stream/${songId}`);
    },

    getDownloadUrl(songId) {
      return streamUrl(`/api/download/${songId}`);
    },
  };
})();
