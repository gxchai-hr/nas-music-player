/* =============================================
   Audio Player – NAS Music Player
   ============================================= */

const Player = (() => {
  // ── State ──
  const audio = new Audio();
  audio.preload = 'metadata';

  let queue = [];
  let queueIndex = -1;
  let shuffleMode = false;
  let repeatMode = 'off'; // 'off' | 'all' | 'one'
  let shuffleOrder = [];
  let onSongChange = null;
  let onStateChange = null;

  // DOM references (set on init)
  let els = {};

  // ── Persistence ──
  function saveState() {
    const state = {
      volume: audio.volume,
      speed: audio.playbackRate,
      lastSongId: queueIndex >= 0 && queue[queueIndex] ? queue[queueIndex].id : null,
      lastQueue: queue.map(s => s.id),
      shuffleMode,
      repeatMode,
    };
    localStorage.setItem('nas_player_state', JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem('nas_player_state');
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.volume !== undefined) audio.volume = state.volume;
      if (state.speed !== undefined) audio.playbackRate = state.speed;
      if (state.shuffleMode !== undefined) shuffleMode = state.shuffleMode;
      if (state.repeatMode !== undefined) repeatMode = state.repeatMode;
      return state;
    } catch (_) {
      return null;
    }
  }

  // ── Shuffle ──
  function generateShuffleOrder() {
    shuffleOrder = queue.map((_, i) => i);
    for (let i = shuffleOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
    }
  }

  // ── Play ──
  function playSong(index) {
    if (index < 0 || index >= queue.length) return;

    queueIndex = index;
    const song = queue[index];

    audio.src = API.getStreamUrl(song.id);
    audio.load();

    audio.play().catch(() => {
      // Autoplay blocked, user needs to interact
    });

    updateUI();
    if (onSongChange) onSongChange(song, index);
    saveState();
  }

  function playSongDirect(song, songList) {
    if (songList) {
      queue = [...songList];
      queueIndex = queue.findIndex(s => s.id === song.id);
      if (queueIndex === -1) {
        queue.unshift(song);
        queueIndex = 0;
      }
    } else {
      const existingIdx = queue.findIndex(s => s.id === song.id);
      if (existingIdx >= 0) {
        queueIndex = existingIdx;
      } else {
        queue.push(song);
        queueIndex = queue.length - 1;
      }
    }
    if (shuffleMode) generateShuffleOrder();
    playSong(queueIndex);
  }

  function togglePlay() {
    if (audio.paused) {
      if (queue.length === 0) return;
      if (queueIndex < 0) {
        playSong(0);
        return;
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    updateUI();
  }

  function playNext() {
    if (queue.length === 0) return;

    let nextIndex;

    if (repeatMode === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    if (shuffleMode) {
      const currentShufflePos = shuffleOrder.indexOf(queueIndex);
      const nextShufflePos = currentShufflePos + 1;
      if (nextShufflePos >= shuffleOrder.length) {
        if (repeatMode === 'all') {
          generateShuffleOrder();
          nextIndex = shuffleOrder[0];
        } else {
          audio.pause();
          updateUI();
          return;
        }
      } else {
        nextIndex = shuffleOrder[nextShufflePos];
      }
    } else {
      nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === 'all') {
          nextIndex = 0;
        } else {
          audio.pause();
          updateUI();
          return;
        }
      }
    }

    playSong(nextIndex);
  }

  function playPrev() {
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart current song
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    let prevIndex;

    if (shuffleMode) {
      const currentShufflePos = shuffleOrder.indexOf(queueIndex);
      const prevShufflePos = currentShufflePos - 1;
      if (prevShufflePos < 0) {
        prevIndex = repeatMode === 'all' ? shuffleOrder[shuffleOrder.length - 1] : 0;
      } else {
        prevIndex = shuffleOrder[prevShufflePos];
      }
    } else {
      prevIndex = queueIndex - 1;
      if (prevIndex < 0) {
        prevIndex = repeatMode === 'all' ? queue.length - 1 : 0;
      }
    }

    playSong(prevIndex);
  }

  function seekTo(time) {
    if (isFinite(time)) {
      audio.currentTime = time;
    }
  }

  function seekPercent(percent) {
    if (audio.duration) {
      audio.currentTime = audio.duration * (percent / 100);
    }
  }

  // ── Volume ──
  function setVolume(val) {
    audio.volume = Math.max(0, Math.min(1, val));
    updateVolumeUI();
    saveState();
  }

  function toggleMute() {
    if (audio.volume > 0) {
      audio._prevVolume = audio.volume;
      audio.volume = 0;
    } else {
      audio.volume = audio._prevVolume || 0.8;
    }
    updateVolumeUI();
  }

  // ── Speed ──
  function setSpeed(rate) {
    audio.playbackRate = rate;
    updateSpeedUI();
    saveState();
  }

  // ── Shuffle / Repeat ──
  function toggleShuffle() {
    shuffleMode = !shuffleMode;
    if (shuffleMode) {
      generateShuffleOrder();
    }
    updateUI();
    saveState();
  }

  function toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const idx = modes.indexOf(repeatMode);
    repeatMode = modes[(idx + 1) % modes.length];
    updateUI();
    saveState();
  }

  // ── Queue management ──
  function setQueue(songList, startIndex = 0) {
    queue = [...songList];
    queueIndex = startIndex >= 0 ? startIndex : 0;
    if (shuffleMode) generateShuffleOrder();
    saveState();
  }

  function addToQueue(song) {
    queue.push(song);
    saveState();
  }

  function removeFromQueue(index) {
    if (index < 0 || index >= queue.length) return;
    queue.splice(index, 1);
    if (index < queueIndex) queueIndex--;
    if (index === queueIndex && queue.length > 0) {
      queueIndex = Math.min(queueIndex, queue.length - 1);
      playSong(queueIndex);
    }
    if (index === queueIndex && queue.length === 0) {
      queueIndex = -1;
      audio.src = '';
    }
    updateUI();
    saveState();
  }

  function clearQueue() {
    queue = [];
    queueIndex = -1;
    audio.src = '';
    updateUI();
    saveState();
  }

  // ── DOM ──
  function cacheDOM() {
    els = {
      btnPlay: document.getElementById('btn-play'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnShuffle: document.getElementById('btn-shuffle'),
      btnRepeat: document.getElementById('btn-repeat'),
      btnVolume: document.getElementById('btn-volume'),
      volumeSlider: document.getElementById('volume-slider'),
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      progressHandle: document.getElementById('progress-handle'),
      timeCurrent: document.getElementById('time-current'),
      timeTotal: document.getElementById('time-total'),
      playerTitle: document.getElementById('player-song-title'),
      playerArtist: document.getElementById('player-song-artist'),
      playerArt: document.getElementById('player-art'),
      btnSpeed: document.getElementById('btn-speed'),
      speedMenu: document.getElementById('speed-menu'),
      btnDownload: document.getElementById('btn-download'),
      btnLyricsToggle: document.getElementById('btn-lyrics-toggle'),
      btnQueueToggle: document.getElementById('btn-queue-toggle'),
    };
  }

  // ── Format time ──
  function formatTime(secs) {
    if (!isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ── Update UI ──
  function updateUI() {
    if (!els.btnPlay) return;

    // Play/Pause button
    els.btnPlay.textContent = audio.paused ? '▶' : '⏸';

    // Shuffle button
    els.btnShuffle.classList.toggle('active', shuffleMode);
    if (shuffleMode) {
      els.btnShuffle.style.color = 'var(--accent)';
    } else {
      els.btnShuffle.style.color = '';
    }

    // Repeat button
    if (repeatMode === 'off') {
      els.btnRepeat.textContent = '🔁';
      els.btnRepeat.style.color = '';
    } else if (repeatMode === 'all') {
      els.btnRepeat.textContent = '🔁';
      els.btnRepeat.style.color = 'var(--accent)';
    } else {
      els.btnRepeat.textContent = '🔂';
      els.btnRepeat.style.color = 'var(--accent)';
    }
  }

  function updateProgressUI() {
    if (!els.progressFill) return;

    const current = audio.currentTime || 0;
    const duration = audio.duration || 0;
    const pct = duration ? (current / duration) * 100 : 0;

    els.progressFill.style.width = `${pct}%`;
    els.progressHandle.style.left = `${pct}%`;
    els.timeCurrent.textContent = formatTime(current);
    els.timeTotal.textContent = formatTime(duration);
  }

  function updateVolumeUI() {
    if (els.volumeSlider) {
      els.volumeSlider.value = Math.round(audio.volume * 100);
    }
    if (els.btnVolume) {
      if (audio.volume === 0) {
        els.btnVolume.textContent = '🔇';
      } else if (audio.volume < 0.5) {
        els.btnVolume.textContent = '🔉';
      } else {
        els.btnVolume.textContent = '🔊';
      }
    }
  }

  function updateSpeedUI() {
    if (els.btnSpeed) {
      els.btnSpeed.textContent = `${audio.playbackRate}x`;
    }
    // Update speed menu active item
    const items = els.speedMenu ? els.speedMenu.querySelectorAll('.dropdown-item') : [];
    items.forEach(item => {
      item.classList.toggle('active', parseFloat(item.dataset.speed) === audio.playbackRate);
    });
  }

  function updateSongInfoUI(song) {
    if (!song) return;
    els.playerTitle.textContent = song.title || 'Unknown';
    els.playerArtist.textContent = song.artist || 'Unknown Artist';

    // Album art placeholder
    if (song.album_art) {
      els.playerArt.innerHTML = `<img src="${song.album_art}" alt="Album Art" onerror="this.parentElement.innerHTML='<span>🎵</span>'">`;
    } else {
      els.playerArt.innerHTML = '<span>🎵</span>';
    }

    // Update page title
    document.title = `${song.title || 'Unknown'} - ${song.artist || ''} | NAS Music`;
  }

  // ── Event Bindings ──
  function bindEvents() {
    // Play / Pause
    els.btnPlay.addEventListener('click', togglePlay);
    els.btnPrev.addEventListener('click', playPrev);
    els.btnNext.addEventListener('click', playNext);

    // Shuffle / Repeat
    els.btnShuffle.addEventListener('click', toggleShuffle);
    els.btnRepeat.addEventListener('click', toggleRepeat);

    // Volume
    els.btnVolume.addEventListener('click', toggleMute);
    els.volumeSlider.addEventListener('input', (e) => {
      setVolume(parseInt(e.target.value, 10) / 100);
    });

    // Progress bar seeking
    els.progressBar.addEventListener('click', (e) => {
      const rect = els.progressBar.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      seekPercent(pct);
    });

    // Progress bar dragging
    let isDragging = false;
    els.progressBar.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = els.progressBar.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      seekPercent(pct);
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = els.progressBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      seekPercent(pct);
    });
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Speed menu
    els.btnSpeed.addEventListener('click', (e) => {
      e.stopPropagation();
      els.speedMenu.classList.toggle('hidden');
    });

    els.speedMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const speed = parseFloat(item.dataset.speed);
        setSpeed(speed);
        els.speedMenu.classList.add('hidden');
      });
    });

    // Close speed menu on outside click
    document.addEventListener('click', (e) => {
      if (!els.speedMenu.contains(e.target) && e.target !== els.btnSpeed) {
        els.speedMenu.classList.add('hidden');
      }
    });

    // Download
    els.btnDownload.addEventListener('click', () => {
      if (queueIndex >= 0 && queue[queueIndex]) {
        const song = queue[queueIndex];
        if (typeof App !== 'undefined' && App.handleDownload) {
          App.handleDownload(song);
        } else {
          // Fallback: open download URL
          window.open(API.getDownloadUrl(song.id), '_blank');
        }
      }
    });

    // Queue toggle
    els.btnQueueToggle.addEventListener('click', () => {
      const panel = document.getElementById('queue-panel');
      const lyricsPanel = document.getElementById('lyrics-panel');
      if (lyricsPanel && !lyricsPanel.classList.contains('hidden')) {
        lyricsPanel.classList.add('hidden');
      }
      panel.classList.toggle('hidden');
    });

    // Lyrics toggle
    els.btnLyricsToggle.addEventListener('click', () => {
      const panel = document.getElementById('lyrics-panel');
      const queuePanel = document.getElementById('queue-panel');
      if (queuePanel && !queuePanel.classList.contains('hidden')) {
        queuePanel.classList.add('hidden');
      }
      panel.classList.toggle('hidden');
      // Load lyrics for current song if panel opened
      if (!panel.classList.contains('hidden') && queueIndex >= 0 && queue[queueIndex]) {
        if (typeof App !== 'undefined' && App.loadLyricsForSong) {
          App.loadLyricsForSong(queue[queueIndex]);
        }
      }
    });

    // Audio events
    audio.addEventListener('timeupdate', updateProgressUI);

    audio.addEventListener('ended', () => {
      playNext();
    });

    audio.addEventListener('play', () => {
      updateUI();
      if (onStateChange) onStateChange('play');
    });

    audio.addEventListener('pause', () => {
      updateUI();
      if (onStateChange) onStateChange('pause');
    });

    audio.addEventListener('loadedmetadata', () => {
      updateProgressUI();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't handle if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            playNext();
          } else {
            seekTo(audio.currentTime + 5);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            playPrev();
          } else {
            seekTo(audio.currentTime - 5);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, audio.volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, audio.volume - 0.05));
          break;
      }
    });
  }

  // ── Init ──
  function init() {
    cacheDOM();
    const saved = loadState();
    if (saved) {
      if (saved.speed) audio.playbackRate = saved.speed;
      audio.volume = saved.volume !== undefined ? saved.volume : 0.8;
    } else {
      audio.volume = 0.8;
    }
    bindEvents();
    updateUI();
    updateVolumeUI();
    updateSpeedUI();
  }

  // ── Public API ──
  return {
    init,
    get audio() { return audio; },
    get queue() { return queue; },
    get queueIndex() { return queueIndex; },
    get currentSong() { return queueIndex >= 0 ? queue[queueIndex] : null; },
    get isPlaying() { return !audio.paused; },
    get duration() { return audio.duration || 0; },
    get currentTime() { return audio.currentTime || 0; },
    get shuffleMode() { return shuffleMode; },
    get repeatMode() { return repeatMode; },

    playSong,
    playSongDirect,
    togglePlay,
    playNext,
    playPrev,
    seekTo,
    seekPercent,
    setVolume,
    toggleMute,
    setSpeed,
    toggleShuffle,
    toggleRepeat,
    setQueue,
    addToQueue,
    removeFromQueue,
    clearQueue,
    updateSongInfo: updateSongInfoUI,
    updateQueueUI: updateUI,

    // Callbacks
    set onSongChange(fn) { onSongChange = fn; },
    set onStateChange(fn) { onStateChange = fn; },

    formatTime,
    updateProgressUI,
  };
})();
