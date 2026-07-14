/* =============================================
   Lyrics – LRC Parser & Synced Display
   ============================================= */

const Lyrics = (() => {
  let parsedLyrics = [];    // [{ time: seconds, text: string }]
  let currentIndex = -1;
  let lyricsEl = null;
  let audioTimeGetter = null;
  let animationId = null;

  // ── LRC Parser ──
  function parseLRC(lrcText) {
    if (!lrcText) return [];

    const lines = lrcText.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{0,3})\]/g;

    for (const line of lines) {
      const times = [];
      let match;

      // Extract all timestamps from the line
      while ((match = timeRegex.exec(line)) !== null) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
        times.push(min * 60 + sec + ms / 1000);
      }

      // Get the text after all timestamps
      const text = line.replace(/\[\d{2}:\d{2}\.?\d{0,3}\]/g, '').trim();

      // Skip metadata tags like [ar:], [ti:], [al:], [by:]
      if (text.match(/^\[.+:.*\]$/)) continue;

      // Add entry for each timestamp (some lines repeat)
      for (const time of times) {
        result.push({ time, text });
      }
    }

    // Sort by time
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  // ── Find current line index ──
  function findCurrentLine(currentTime) {
    if (parsedLyrics.length === 0) return -1;

    let idx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      if (parsedLyrics[i].time <= currentTime) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }

  // ── Scroll to line ──
  function scrollToLine(index) {
    if (!lyricsEl || index < 0) return;

    const lines = lyricsEl.querySelectorAll('.lyric-line');
    if (index >= lines.length) return;

    const line = lines[index];
    const container = lyricsEl;

    // Calculate scroll position to center the line
    const lineTop = line.offsetTop;
    const lineHeight = line.offsetHeight;
    const containerHeight = container.clientHeight;
    const scrollTo = lineTop - containerHeight / 2 + lineHeight / 2;

    container.scrollTo({
      top: Math.max(0, scrollTo),
      behavior: 'smooth',
    });
  }

  // ── Render lyrics ──
  function render(containerEl) {
    lyricsEl = containerEl;
    lyricsEl.innerHTML = '';

    if (parsedLyrics.length === 0) {
      lyricsEl.innerHTML = '<p class="lyrics-placeholder">No lyrics available</p>';
      return;
    }

    for (let i = 0; i < parsedLyrics.length; i++) {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.dataset.index = i;
      div.textContent = parsedLyrics[i].text || '♪';

      // Click to seek
      div.addEventListener('click', () => {
        if (audioTimeGetter && typeof audioTimeGetter.seekTo === 'function') {
          audioTimeGetter.seekTo(parsedLyrics[i].time);
        }
      });
      div.style.cursor = 'pointer';

      lyricsEl.appendChild(div);
    }
  }

  // ── Update highlight ──
  function updateHighlight(currentTime) {
    const newIndex = findCurrentLine(currentTime);

    if (newIndex === currentIndex) return;

    const lines = lyricsEl ? lyricsEl.querySelectorAll('.lyric-line') : [];

    // Remove previous highlight
    if (currentIndex >= 0 && currentIndex < lines.length) {
      lines[currentIndex].classList.remove('active');
      lines[currentIndex].classList.add('past');
    }

    // Mark lines before current as past
    for (let i = 0; i < newIndex; i++) {
      if (lines[i]) {
        lines[i].classList.remove('active');
        lines[i].classList.add('past');
      }
    }

    // Set new current
    currentIndex = newIndex;
    if (currentIndex >= 0 && currentIndex < lines.length) {
      lines[currentIndex].classList.remove('past');
      lines[currentIndex].classList.add('active');
      scrollToLine(currentIndex);
    }
  }

  // ── Animation loop ──
  function startLoop() {
    function loop() {
      if (audioTimeGetter) {
        const time = audioTimeGetter.getCurrentTime();
        updateHighlight(time);
      }
      animationId = requestAnimationFrame(loop);
    }
    stopLoop();
    animationId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  // ── Public API ──
  return {
    load(lrcText, containerEl, timeProvider) {
      parsedLyrics = parseLRC(lrcText);
      audioTimeGetter = timeProvider; // { getCurrentTime(), seekTo(sec) }
      currentIndex = -1;
      render(containerEl);
      startLoop();
    },

    clear(containerEl) {
      parsedLyrics = [];
      currentIndex = -1;
      stopLoop();
      if (containerEl) {
        containerEl.innerHTML = '<p class="lyrics-placeholder">No lyrics available</p>';
      }
    },

    parseLRC,

    stopLoop,

    hasLyrics() {
      return parsedLyrics.length > 0;
    },
  };
})();
