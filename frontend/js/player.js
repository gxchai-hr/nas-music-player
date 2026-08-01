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
      // v1.0.6.7: 记忆播放位置 + 当前路由
      currentTime: audio.currentTime || 0,
      routeHash: window.location.hash || '',
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
  let _resumeTime = null;  // v1.0.6.7: 恢复播放位置

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

  // v1.0.6.7: 监听音频元数据加载完成，恢复上次播放位置
  function _tryResumeTime() {
    if (_resumeTime != null && isFinite(_resumeTime) && _resumeTime > 0) {
      // 容差 5 秒内不恢复（避免在播放末尾时跳回去）
      if (audio.duration && _resumeTime < audio.duration - 5) {
        audio.currentTime = _resumeTime;
      }
      _resumeTime = null;
    }
  }
  audio.addEventListener('loadedmetadata', _tryResumeTime);

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
  // Use const bindings instead of a single `els` object so that a missing
  // element in cacheDOM no longer throws inside bindEvents (which would
  // abort every subsequent addEventListener call – e.g. an early null on
  // btnPlay would silently kill the speed-menu click handler).
  let btnPlay, btnPrev, btnNext, btnShuffle, btnRepeat,
      btnVolume, volumeSlider,
      progressBar, progressFill, progressHandle,
      timeCurrent, timeTotal,
      playerTitle, playerArtist, playerArt,
      btnSpeed, speedMenu,
      btnDownload, btnLyricsToggle, btnQueueToggle;

  // 拖动状态必须放在模块级（bindEvents 外部），否则每次调用都新建，
  // mousedown 设的 true 在 mousemove handler 里就读不到（因为 handler 是闭包旧的）
  let isDragging = false;

  function cacheDOM() {
    btnPlay         = document.getElementById('btn-play');
    btnPrev         = document.getElementById('btn-prev');
    btnNext         = document.getElementById('btn-next');
    btnShuffle      = document.getElementById('btn-shuffle');
    btnRepeat       = document.getElementById('btn-repeat');
    btnVolume       = document.getElementById('btn-volume');
    volumeSlider    = document.getElementById('volume-slider');
    progressBar     = document.getElementById('progress-bar');
    progressFill    = document.getElementById('progress-fill');
    progressHandle  = document.getElementById('progress-handle');
    timeCurrent     = document.getElementById('time-current');
    timeTotal       = document.getElementById('time-total');
    playerTitle     = document.getElementById('player-song-title');
    playerArtist    = document.getElementById('player-song-artist');
    playerArt       = document.getElementById('player-art');
    btnSpeed        = document.getElementById('btn-speed');
    speedMenu       = document.getElementById('speed-menu');
    btnDownload     = document.getElementById('btn-download');
    btnLyricsToggle = document.getElementById('btn-lyrics-toggle');
    btnQueueToggle  = document.getElementById('btn-queue-toggle');
  }

  // Helper to safely bind – if the element is missing we just skip rather
  // than aborting the whole init flow.
  function on(el, event, handler) {
    if (el && typeof el.addEventListener === 'function') {
      el.addEventListener(event, handler);
      return true;
    }
    return false;
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
    if (!btnPlay) return;

    // Play/Pause button
    btnPlay.textContent = audio.paused ? '▶' : '⏸';

    // Shuffle button
    if (btnShuffle) {
      btnShuffle.classList.toggle('active', shuffleMode);
      btnShuffle.style.color = shuffleMode ? 'var(--accent)' : '';
    }

    // Repeat button
    if (btnRepeat) {
      if (repeatMode === 'off') {
        btnRepeat.textContent = '🔁';
        btnRepeat.style.color = '';
      } else if (repeatMode === 'all') {
        btnRepeat.textContent = '🔁';
        btnRepeat.style.color = 'var(--accent)';
      } else {
        btnRepeat.textContent = '🔂';
        btnRepeat.style.color = 'var(--accent)';
      }
    }
  }

  function updateProgressUI() {
    if (!progressFill) return;

    const current = audio.currentTime || 0;
    const duration = audio.duration || 0;
    const pct = duration ? (current / duration) * 100 : 0;

    progressFill.style.width = `${pct}%`;
    if (progressHandle) progressHandle.style.left = `${pct}%`;
    if (timeCurrent) timeCurrent.textContent = formatTime(current);
    if (timeTotal) timeTotal.textContent = formatTime(duration);
  }

  function updateVolumeUI() {
    if (volumeSlider) {
      volumeSlider.value = Math.round(audio.volume * 100);
    }
    if (btnVolume) {
      if (audio.volume === 0) {
        btnVolume.textContent = '🔇';
      } else if (audio.volume < 0.5) {
        btnVolume.textContent = '🔉';
      } else {
        btnVolume.textContent = '🔊';
      }
    }
  }

  function updateSpeedUI() {
    if (btnSpeed) {
      btnSpeed.textContent = `${audio.playbackRate}x`;
    }
    // Update speed menu active item
    if (speedMenu) {
      const items = speedMenu.querySelectorAll('.dropdown-item');
      items.forEach(item => {
        item.classList.toggle('active', parseFloat(item.dataset.speed) === audio.playbackRate);
      });
    }
  }

  function updateSongInfoUI(song) {
    if (!song) return;
    if (playerTitle) playerTitle.textContent = song.title || 'Unknown';
    if (playerArtist) playerArtist.textContent = song.artist || 'Unknown Artist';

    // Album art placeholder
    if (playerArt) {
      if (song.album_art) {
        playerArt.innerHTML = `<img src="${song.album_art}" alt="Album Art" onerror="this.parentElement.innerHTML='<span>🎵</span>'">`;
      } else {
        playerArt.innerHTML = '<span>🎵</span>';
      }
    }

    // Update page title
    document.title = `${song.title || 'Unknown'} - ${song.artist || ''} | NAS Music`;
  }

  // ── Event Bindings ──
  function bindEvents() {
    // Play / Pause
    on(btnPlay, 'click', togglePlay);
    on(btnPrev, 'click', playPrev);
    on(btnNext, 'click', playNext);

    // Shuffle / Repeat
    on(btnShuffle, 'click', toggleShuffle);
    on(btnRepeat, 'click', toggleRepeat);

    // Volume
    on(btnVolume, 'click', toggleMute);
    on(volumeSlider, 'input', (e) => {
      setVolume(parseInt(e.target.value, 10) / 100);
    });

    // Progress bar seeking
    on(progressBar, 'click', (e) => {
      const rect = progressBar.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      seekPercent(pct);
    });

    // Progress bar dragging
    on(progressBar, 'mousedown', (e) => {
      isDragging = true;
      const rect = progressBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      seekPercent(pct);
      e.preventDefault();
    });
    // 触摸事件支持（手机端）
    if (progressBar) {
      progressBar.addEventListener('touchstart', (e) => {
        isDragging = true;
        const touch = e.touches[0];
        const rect = progressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100));
        seekPercent(pct);
        e.preventDefault();
      }, { passive: false });
    }
    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !progressBar) return;
      const rect = progressBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      seekPercent(pct);
    });
    document.addEventListener('touchmove', (e) => {
      if (!isDragging || !progressBar) return;
      const touch = e.touches[0];
      if (!touch) return;
      const rect = progressBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100));
      seekPercent(pct);
    }, { passive: true });
    document.addEventListener('mouseup', () => { isDragging = false; });
    document.addEventListener('touchend', () => { isDragging = false; });

    // Speed menu
    on(btnSpeed, 'click', (e) => {
      e.stopPropagation();
      if (speedMenu) speedMenu.classList.toggle('hidden');
    });

    if (speedMenu) {
      speedMenu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const speed = parseFloat(item.dataset.speed);
          setSpeed(speed);
          speedMenu.classList.add('hidden');
        });
      });
    }

    // Close speed menu on outside click
    document.addEventListener('click', (e) => {
      if (!speedMenu) return;
      if (!speedMenu.contains(e.target) && e.target !== btnSpeed) {
        speedMenu.classList.add('hidden');
      }
    });

    // Download
    on(btnDownload, 'click', () => {
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
    on(btnQueueToggle, 'click', () => {
      const panel = document.getElementById('queue-panel');
      const lyricsPanel = document.getElementById('lyrics-panel');
      if (lyricsPanel && !lyricsPanel.classList.contains('hidden')) {
        lyricsPanel.classList.add('hidden');
      }
      if (panel) panel.classList.toggle('hidden');
    });

    // Lyrics toggle
    on(btnLyricsToggle, 'click', () => {
      const panel = document.getElementById('lyrics-panel');
      const queuePanel = document.getElementById('queue-panel');
      if (queuePanel && !queuePanel.classList.contains('hidden')) {
        queuePanel.classList.add('hidden');
      }
      if (!panel) return;
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
    // ─────────────────────────────────────────────
    //   Space         播放 / 暂停
    //   ← / →         上一首 / 下一首
    //   ↑ / ↓         音量 ±10%
    //   M             静音切换
    // ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      // Don't handle if typing in an input or with modifier
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          playNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          playPrev();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, audio.volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, audio.volume - 0.1));
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
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

    // v1.0.6.7: 记忆播放位置 + 路由
    setResumeTime: (t) => { _resumeTime = t; },
    saveState,
    get savedRouteHash() {
      try { return JSON.parse(localStorage.getItem('nas_player_state') || '{}').routeHash || ''; }
      catch { return ''; }
    },
    get savedCurrentTime() {
      try { return JSON.parse(localStorage.getItem('nas_player_state') || '{}').currentTime || 0; }
      catch { return 0; }
    },
    get savedSongId() {
      try { return JSON.parse(localStorage.getItem('nas_player_state') || '{}').lastSongId || null; }
      catch { return null; }
    },
  };
})();
