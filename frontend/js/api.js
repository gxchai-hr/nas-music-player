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
      return request('GET', '/api/artists');
    },

    async getArtist(id) {
      return request('GET', `/api/artists/${id}`);
    },

    // Albums
    async getAlbums() {
      return request('GET', '/api/albums');
    },

    async getAlbum(id) {
      return request('GET', `/api/albums/${id}`);
    },

    // Songs
    async getSongs() {
      return request('GET', '/api/songs');
    },

    async getSong(id) {
      return request('GET', `/api/songs/${id}`);
    },

    async getSongsByArtist(artistId) {
      return request('GET', `/api/artists/${artistId}/songs`);
    },

    async getSongsByAlbum(albumId) {
      return request('GET', `/api/albums/${albumId}/songs`);
    },

    // Search
    async search(query) {
      return request('GET', `/api/search?q=${encodeURIComponent(query)}`);
    },

    // Playlists
    async getPlaylists() {
      return request('GET', '/api/playlists');
    },

    async getPlaylist(id) {
      return request('GET', `/api/playlists/${id}`);
    },

    async createPlaylist(name) {
      return request('POST', '/api/playlists', { name });
    },

    async deletePlaylist(id) {
      return request('DELETE', `/api/playlists/${id}`);
    },

    async addToPlaylist(playlistId, songId) {
      return request('POST', `/api/playlists/${playlistId}/songs`, { song_id: songId });
    },

    async removeFromPlaylist(playlistId, songId) {
      return request('DELETE', `/api/playlists/${playlistId}/songs/${songId}`);
    },

    // Lyrics
    async getLyrics(songId) {
      return request('GET', `/api/songs/${songId}/lyrics`);
    },

    // Library
    async triggerScan() {
      return request('POST', '/api/library/scan');
    },

    // Users (admin)
    async getUsers() {
      return request('GET', '/api/users');
    },

    async createUser(username, password, role) {
      return request('POST', '/api/users', { username, password, role });
    },

    async deleteUser(userId) {
      return request('DELETE', `/api/users/${userId}`);
    },

    // Theme
    async updateTheme(theme) {
      return request('POST', '/api/users/theme', { theme });
    },

    // Streaming / Download URLs
    getStreamUrl(songId) {
      return streamUrl(`/api/songs/${songId}/stream`);
    },

    getDownloadUrl(songId) {
      return streamUrl(`/api/songs/${songId}/download`);
    },
  };
})();
