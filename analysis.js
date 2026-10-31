/* Local media never enters the Firebase payload. Legacy scenes remain in storage. */
(() => {
  'use strict';
  const api = window.MakuraAnalysisBridge;
  const $ = id => document.getElementById(id);
  const video = $('analysisVideo');
  const canvas = $('videoInk');
  const ctx = canvas.getContext('2d');
  const copy = value => JSON.parse(JSON.stringify(value));
  const status = message => {
    const show = !!message && !message.includes('端末内保存済み');
    $('videoStatus').textContent = show ? message : '';
    $('videoStatus').hidden = !show;
  };
  let mediaId = null, objectUrl = null;
  let strokes = [], undo = [], redo = [], pending = null, pointer = null;
  let operation = 0, busy = false;

  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('makura-analysis-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('media', { keyPath: 'id' });
      request.result.createObjectStore('scenes', { keyPath: 'id' }); // Keep the v1 schema; do not delete old scenes.
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function db(store, method, value) {
    const connection = await database;
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction(store, method === 'put' ? 'readwrite' : 'readonly');
      const request = transaction.objectStore(store)[method](value);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function paint() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    canvas.width = Math.round(bounds.width * devicePixelRatio);
    canvas.height = Math.round(bounds.height * devicePixelRatio);
    ctx.scale(canvas.width, canvas.height);
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 3 / bounds.width;
    ctx.lineCap = 'round';
    for (const stroke of [...strokes, ...(pending ? [pending] : [])]) {
      const a = stroke.points[0], b = stroke.points.at(-1);
      ctx.beginPath();
      if (stroke.kind === 'circle') {
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2,
          Math.abs(a.x - b.x) / 2, Math.abs(a.y - b.y) / 2, 0, 0, Math.PI * 2);
      } else {
        const points = stroke.kind === 'pen' ? stroke.points : [a, b];
        points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      }
      ctx.stroke();
      if (stroke.kind === 'arrow') {
        const angle = Math.atan2((b.y - a.y) * bounds.height, (b.x - a.x) * bounds.width);
        ctx.beginPath();
        for (const delta of [-.5, .5]) {
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - 15 * Math.cos(angle + delta) / bounds.width,
            b.y - 15 * Math.sin(angle + delta) / bounds.height);
        }
        ctx.stroke();
      }
    }
  }
  new ResizeObserver(paint).observe(canvas);

  function pointFromEvent(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  }

  function hitStroke(stroke, point) {
    const bounds = canvas.getBoundingClientRect();
    let points = stroke.points;
    if (stroke.kind === 'circle') {
      const a = points[0], b = points.at(-1);
      points = Array.from({ length: 65 }, (_, index) => ({
        x: (a.x + b.x) / 2 + Math.abs(a.x - b.x) / 2 * Math.cos(index * Math.PI / 32),
        y: (a.y + b.y) / 2 + Math.abs(a.y - b.y) / 2 * Math.sin(index * Math.PI / 32)
      }));
    } else if (stroke.kind === 'arrow') points = [points[0], points.at(-1)];
    return points.some((b, index) => {
      const a = points[Math.max(0, index - 1)];
      const vx = (b.x - a.x) * bounds.width, vy = (b.y - a.y) * bounds.height;
      const wx = (point.x - a.x) * bounds.width, wy = (point.y - a.y) * bounds.height;
      const fraction = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
      return Math.hypot(wx - fraction * vx, wy - fraction * vy) < 18;
    });
  }

  function rememberInk() {
    undo.push(copy(strokes));
    if (undo.length > 100) undo.shift();
    redo = [];
  }
  function resetInk(value = []) {
    strokes = copy(value); undo = []; redo = []; pending = null; pointer = null;
    paint();
  }
  canvas.onpointerdown = event => {
    if (!mediaId || $('videoTool').value === 'none' || !video.paused || busy || pointer !== null || event.isPrimary === false) return;
    event.preventDefault();
    if ($('videoTool').value === 'erase') {
      const point = pointFromEvent(event);
      for (let index = strokes.length - 1; index >= 0; index--) {
        if (hitStroke(strokes[index], point)) {
          rememberInk(); strokes.splice(index, 1); paint(); break;
        }
      }
      return;
    }
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    pending = { kind: $('videoTool').value, points: [pointFromEvent(event)] };
  };
  canvas.onpointermove = event => {
    if (pointer !== event.pointerId || !pending) return;
    pending.points.push(pointFromEvent(event)); paint();
  };
  canvas.onpointerup = event => {
    if (pointer !== event.pointerId) return;
    if (pending) {
      pending.points.push(pointFromEvent(event)); rememberInk(); strokes.push(pending);
    }
    pointer = null; pending = null; paint();
  };
  canvas.onpointercancel = () => { pending = null; pointer = null; paint(); };
  $('videoUndo').onclick = () => {
    if (undo.length) { redo.push(copy(strokes)); strokes = undo.pop(); } paint();
  };
  $('videoRedo').onclick = () => {
    if (redo.length) { undo.push(copy(strokes)); strokes = redo.pop(); } paint();
  };
  function setVideoTool(tool = 'none') {
    $('videoTool').value = tool;
    document.querySelectorAll('[data-video-tool]').forEach(button => {
      const active = button.dataset.videoTool === tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    pending = null; pointer = null;
    canvas.style.pointerEvents = tool !== 'none' && mediaId && video.paused ? 'auto' : 'none';
    paint();
  }
  $('videoTool').onchange = event => {
    cancelVideoGesture();
    if (event.target.value !== 'none') video.pause();
    setVideoTool(event.target.value);
  };
  document.querySelectorAll('[data-video-tool]').forEach(button => {
    button.onclick = () => {
      cancelVideoGesture();
      const tool = button.dataset.videoTool;
      if (tool !== 'none') video.pause();
      setVideoTool(tool);
    };
  });
  let gesture = null, pinch = null, lastTap = null, feedbackTimer = null;
  const zoom = { scale: 1, x: 0, y: 0 };
  // Playback gestures belong to the whole black video surface. The narrower
  // videoFrame remains the only drawing surface for portrait footage.
  const frame = $('videoSurface');

  function clampZoom() {
    const picture = $('videoFrame').getBoundingClientRect();
    const maxX = picture.width * (zoom.scale - 1) / (2 * zoom.scale);
    const maxY = picture.height * (zoom.scale - 1) / (2 * zoom.scale);
    zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
    zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
  }
  function applyZoom() {
    clampZoom();
    $('videoTransform').style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    $('videoZoomReset').hidden = zoom.scale <= 1.001;
  }
  function resetZoom(showFeedback = false) {
    zoom.scale = 1; zoom.x = 0; zoom.y = 0; pinch = null;
    applyZoom();
    if (showFeedback) feedback('全体表示');
  }
  function touchDistance(touches) {
    return Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  }
  function touchMidpoint(touches) {
    return { x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2 };
  }
  function beginPinch(touches) {
    cancelVideoGesture();
    pending = null; pointer = null; paint();
    const middle = touchMidpoint(touches);
    pinch = { distance: Math.max(1, touchDistance(touches)), middle,
      scale: zoom.scale, x: zoom.x, y: zoom.y };
  }
  function movePinch(touches) {
    if (!pinch || touches.length < 2) return;
    const middle = touchMidpoint(touches);
    zoom.scale = Math.max(1, Math.min(4, pinch.scale * touchDistance(touches) / pinch.distance));
    zoom.x = pinch.x + middle.x - pinch.middle.x;
    zoom.y = pinch.y + middle.y - pinch.middle.y;
    applyZoom();
  }

  function feedback(text, persistent = false) {
    clearTimeout(feedbackTimer);
    $('videoFeedback').textContent = text;
    $('videoFeedback').hidden = false;
    if (!persistent) feedbackTimer = setTimeout(() => { $('videoFeedback').hidden = true; }, 700);
  }
  function cancelVideoGesture(resetTap = true) {
    const previous = gesture;
    gesture = null;
    if (previous) {
      clearTimeout(previous.timer);
      if (previous.boosted) {
        video.playbackRate = previous.rate;
        $('videoFeedback').hidden = true;
      }
      if (previous.source === 'pointer' && frame.hasPointerCapture(previous.pointerId)) {
        frame.releasePointerCapture(previous.pointerId);
      }
    }
    if (resetTap) lastTap = null;
  }
  function syncPlaybackButton() {
    $('videoPlay').textContent = video.paused ? '▶' : 'Ⅱ';
    $('videoPlay').setAttribute('aria-label', video.paused ? '再生' : '一時停止');
    $('videoPlay').title = video.paused ? '再生' : '一時停止';
  }
  function syncAudioButton() {
    $('videoAudio').textContent = video.muted ? '🔇' : '🔊';
    $('videoAudio').setAttribute('aria-pressed', String(!video.muted));
    $('videoAudio').title = video.muted ? '音を出す' : '音を消す';
  }
  function startPlayback() {
    if (!mediaId || busy) { status('＋ 動画から動画を開いてください。'); return; }
    status('');
    // Call play directly inside the user action, including on iPad with audio.
    video.play().catch(error => {
      if (error.name === 'AbortError') return; // A quick pause or seek can abort a pending play.
      status(error.name === 'NotAllowedError'
        ? '再生が許可されませんでした。▶をタップしてください。'
        : '再生できません。この端末で対応する動画形式か確認してください。');
      syncPlaybackButton();
    });
  }
  function togglePlayback() {
    if (!mediaId || busy) { status('＋ 動画から動画を開いてください。'); return; }
    if (video.paused) startPlayback(); else video.pause();
  }
  function mediaEnd() {
    if (Number.isFinite(video.duration)) return Math.max(0, video.duration);
    return video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
  }
  function seekBy(seconds) {
    if (!mediaId || busy) return;
    setVideoTool();
    video.currentTime = Math.max(0, Math.min(mediaEnd(), video.currentTime + seconds));
    feedback(seconds < 0 ? '↶ 10秒' : '10秒 ↷');
  }
  function beginVideoGesture(clientX, clientY, source, pointerId = null) {
    if (!mediaId || busy || $('videoTool').value !== 'none') return false;
    cancelVideoGesture(false);
    const bounds = frame.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width;
    const current = { pointerId, source, x: clientX, y: clientY,
      region: x < .45 ? -1 : x > .55 ? 1 : 0, started: performance.now(),
      rate: video.playbackRate, boosted: false, panning: false,
      panX: zoom.x, panY: zoom.y };
    gesture = current;
    current.timer = setTimeout(() => {
      if (gesture !== current || video.paused || busy) return;
      current.boosted = true;
      video.playbackRate = 2;
      feedback('2×', true);
      lastTap = null;
    }, 450);
    return true;
  }
  function moveVideoGesture(clientX, clientY) {
    if (!gesture) return;
    const dx = clientX - gesture.x, dy = clientY - gesture.y;
    const distance = Math.hypot(dx, dy);
    if (gesture.source === 'touch' && zoom.scale > 1.001 && $('videoTool').value === 'none' &&
        (gesture.panning || distance > 10)) {
      clearTimeout(gesture.timer);
      gesture.panning = true;
      zoom.x = gesture.panX + dx;
      zoom.y = gesture.panY + dy;
      applyZoom();
      return;
    }
    if (distance > 18) cancelVideoGesture();
  }
  function endVideoGesture() {
    if (!gesture) return;
    const current = gesture;
    const now = performance.now();
    const held = current.boosted || now - current.started >= 450;
    cancelVideoGesture(false);
    if (current.panning) { lastTap = null; return; }
    if (held) { lastTap = null; return; }
    if (lastTap && now - lastTap.time < 320 && lastTap.region === current.region) {
      if (current.region) {
        const wasPaused = lastTap.wasPaused;
        seekBy(current.region * 10);
        if (wasPaused) video.pause(); else startPlayback();
      } else resetZoom(true);
      lastTap.time = now;
      return;
    }
    lastTap = { time: now, region: current.region, wasPaused: video.paused };
    togglePlayback();
  }
  frame.addEventListener('pointerdown', event => {
    // iPad Safari has an explicit Touch Events path below. Ignore its synthesized
    // pointer events so a single finger action is never handled twice.
    if (event.pointerType === 'touch' || event.isPrimary === false || event.button !== 0) return;
    if (!beginVideoGesture(event.clientX, event.clientY, 'pointer', event.pointerId)) return;
    event.preventDefault();
    frame.setPointerCapture(event.pointerId);
  });
  frame.addEventListener('pointermove', event => {
    if (gesture?.source === 'pointer' && gesture.pointerId === event.pointerId) moveVideoGesture(event.clientX, event.clientY);
  });
  frame.addEventListener('pointerup', event => {
    if (gesture?.source !== 'pointer' || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    endVideoGesture();
  });
  frame.addEventListener('pointercancel', () => cancelVideoGesture());
  frame.addEventListener('lostpointercapture', event => {
    if (gesture?.source === 'pointer' && gesture.pointerId === event.pointerId) cancelVideoGesture();
  });
  frame.addEventListener('touchstart', event => {
    if (event.touches.length >= 2) {
      event.preventDefault();
      beginPinch(event.touches);
      return;
    }
    if (event.touches.length !== 1) { cancelVideoGesture(); return; }
    const touch = event.touches[0];
    if (beginVideoGesture(touch.clientX, touch.clientY, 'touch')) event.preventDefault();
  }, { passive: false });
  frame.addEventListener('touchmove', event => {
    if (event.touches.length >= 2) {
      event.preventDefault();
      if (!pinch) beginPinch(event.touches);
      movePinch(event.touches);
      return;
    }
    if (gesture?.source !== 'touch' || event.touches.length !== 1) return;
    event.preventDefault();
    moveVideoGesture(event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: false });
  frame.addEventListener('touchend', event => {
    if (pinch) {
      event.preventDefault();
      if (event.touches.length < 2) pinch = null;
      return;
    }
    if (gesture?.source !== 'touch') return;
    event.preventDefault();
    endVideoGesture();
  }, { passive: false });
  frame.addEventListener('touchcancel', () => {
    pinch = null;
    if (gesture?.source === 'touch') cancelVideoGesture();
  });
  frame.addEventListener('keydown', event => {
    if (busy || !mediaId || $('videoTool').value !== 'none') return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); cancelVideoGesture(); togglePlayback(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cancelVideoGesture(); seekBy(event.key === 'ArrowLeft' ? -10 : 10); }
  });
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', '動画。タップで再生・停止、左右のダブルタップで10秒移動、再生中の長押しで2倍速');
  window.addEventListener('blur', () => cancelVideoGesture());
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelVideoGesture(); });
  video.onplay = () => { setVideoTool(); syncPlaybackButton(); };
  video.onpause = () => { cancelVideoGesture(false); syncPlaybackButton(); };
  video.onended = () => { cancelVideoGesture(); syncPlaybackButton(); };
  video.onerror = () => { cancelVideoGesture(); status('この動画形式は再生できません。H.264 MP4をお試しください。'); };
  video.onvolumechange = syncAudioButton;
  video.muted = false;
  video.defaultMuted = false;
  video.volume = 1;
  syncAudioButton();
  $('videoAudio').onclick = () => {
    cancelVideoGesture();
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
    syncAudioButton();
  };
  $('videoZoomReset').onclick = () => resetZoom(true);

  function clearMedia() {
    cancelVideoGesture();
    resetZoom();
    video.pause(); video.removeAttribute('src'); video.load(); mediaId = null;
    setVideoTool(); $('videoSurface').classList.remove('has-media');
    document.body.classList.remove('portrait-video');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  async function loadMedia(id, time, token) {
    const item = await db('media', 'get', id);
    if (token !== operation) return false;
    clearMedia();
    if (!item) {
      status('この端末に動画がありません。元ファイルを取り込んでください。'); return false;
    }
    objectUrl = URL.createObjectURL(item.blob);
    // Attach listeners before changing src; dispose them on success, error or timeout.
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', loaded);
        video.removeEventListener('error', failed);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('unsupported media')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('media timeout')); }, 30000);
      video.addEventListener('loadedmetadata', loaded);
      video.addEventListener('error', failed);
      video.src = objectUrl;
    });
    if (token !== operation) return false;
    mediaId = id;
    $('videoSurface').classList.add('has-media');
    document.body.classList.toggle('portrait-video', video.videoHeight > video.videoWidth);
    setVideoTool(); fitVideoFrame();
    video.currentTime = Math.max(0, Math.min(time || 0, video.duration || 0));
    $('videoLibrary').value = id;
    status(item.name + ' ／ 端末内保存済み');
    return true;
  }
  async function refresh() {
    const items = await db('media', 'getAll');
    $('videoLibrary').replaceChildren(new Option('動画を選択', ''), ...items.map(item => new Option(item.name, item.id)));
    $('videoLibrary').value = mediaId || '';
  }
  async function perform(action) {
    if (busy) return;
    busy = true; const token = ++operation;
    cancelVideoGesture();
    try { await action(token); }
    catch { status('読み込み・保存に失敗しました。動画形式と空き容量を確認してください。'); }
    finally { busy = false; }
  }
  $('videoFile').onchange = event => {
    const file = event.target.files[0]; if (!file) return;
    perform(async token => {
      status('動画を端末内に保存しています…');
      const id = crypto.randomUUID();
      await db('media', 'put', { id, name: file.name, blob: file });
      await refresh(); resetInk(); await loadMedia(id, 0, token);
      navigator.storage?.persist?.().catch(() => {});
      event.target.value = '';
    });
  };
  $('videoLibrary').onchange = event => {
    const id = event.target.value; if (!id) return;
    perform(async token => { resetInk(); await loadMedia(id, 0, token); });
  };
  $('videoPlay').onclick = () => { cancelVideoGesture(); togglePlayback(); };
  $('videoRate').onchange = event => { cancelVideoGesture(); video.playbackRate = Number(event.target.value); };
  function step(direction) {
    if (busy || !mediaId) return;
    cancelVideoGesture(); video.pause(); setVideoTool();
    const fps = Math.max(1, Math.min(240, Number($('videoFps').value) || 30));
    video.currentTime = Math.max(0, Math.min(mediaEnd(), video.currentTime + direction / fps));
  }
  $('frameBack').onclick = () => step(-1);
  $('frameNext').onclick = () => step(1);
  function syncTime() {
    const end = mediaEnd();
    $('videoSeek').value = end ? video.currentTime / end : 0;
    const format = time => Math.floor(time / 60) + ':' + String(Math.floor(time % 60)).padStart(2, '0');
    $('videoTime').textContent = format(video.currentTime || 0) + ' / ' + format(end);
  }
  video.ontimeupdate = syncTime;
  video.ondurationchange = syncTime;
  $('videoSeek').oninput = event => {
    if (busy) return;
    cancelVideoGesture(); video.pause(); setVideoTool();
    if (mediaEnd()) video.currentTime = Number(event.target.value) * mediaEnd();
  };
  function fitVideoFrame() {
    const bounds = $('videoSurface').getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const width = Math.min(bounds.width, bounds.height * ratio);
    $('videoFrame').style.width = width + 'px';
    $('videoFrame').style.height = width / ratio + 'px';
    applyZoom();
  }
  function fitBoard() {
    const bounds = document.querySelector('.stage-wrap').getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const width = Math.min(bounds.width, bounds.height * .82);
    api.stage.style.width = width + 'px';
    api.stage.style.height = width / .82 + 'px';
  }
  function updateOrientationGuide() {
    const wantsPortrait = $('analysisView').value === 'board';
    const isPortrait = window.innerHeight >= window.innerWidth;
    const isTablet = document.documentElement.classList.contains('ipad-like');
    $('analysisLayout').classList.toggle('orientation-mismatch', isTablet && wantsPortrait !== isPortrait);
    $('orientationText').textContent = wantsPortrait ? '縦向きにしてください' : '横向きにしてください';
    requestAnimationFrame(() => { fitBoard(); fitVideoFrame(); });
  }
  function setView(view) {
    cancelVideoGesture();
    if (view === 'board') video.pause();
    document.body.dataset.view = view;
    $('analysisLayout').dataset.view = view;
    setVideoTool();
    updateOrientationGuide();
    // Supported browsers can lock orientation. Safari fallback is the rotate guide.
    if (screen.orientation?.lock) screen.orientation.lock(view === 'board' ? 'portrait' : 'landscape').catch(() => {});
  }
  $('analysisView').onchange = event => setView(event.target.value);
  new ResizeObserver(fitVideoFrame).observe($('videoSurface'));
  new ResizeObserver(fitBoard).observe(document.querySelector('.stage-wrap'));
  window.addEventListener('resize', updateOrientationGuide);
  setView($('analysisView').value);

  for (const surface of [api.stage, $('videoSurface'), api.drawToolbar, $('lineupGrid'), $('enemyRosterGrid')]) {
    for (const type of ['contextmenu', 'selectstart', 'copy']) surface.addEventListener(type, event => {
      if (!event.target.closest('input,textarea,select,[contenteditable=true]')) event.preventDefault();
    });
  }

  // Team presets use separate local collections; legacy tournament data stays compatible.
  function presets() {
    try {
      const data = JSON.parse(localStorage.getItem('makura-team-presets-v1') || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }
  const ACTIVE_ENEMY_PRESET_KEY = 'makura-active-enemy-preset-v1';
  function renderBoardEnemyTeams(preferredId = localStorage.getItem(ACTIVE_ENEMY_PRESET_KEY) || '') {
    const select = $('boardEnemyTeamSelect');
    if (!select) return;
    const enemyPresets = presets().filter(preset => preset.team === 'enemy');
    select.replaceChildren(
      new Option(enemyPresets.length ? '相手チームを選択' : '固定チーム未登録', ''),
      ...enemyPresets.map(preset => new Option(preset.name, preset.id))
    );
    select.value = enemyPresets.some(preset => preset.id === preferredId) ? preferredId : '';
  }
  function presetList() {
    const team = api.memberEditorTeam;
    const own = team === 'mine';
    $('teamPresetLabel').textContent = own ? '自チームの大会編成' : '相手の固定チーム';
    $('teamPresetName').placeholder = own ? '大会編成名' : '相手チーム名';
    $('saveTeamPreset').textContent = own ? '大会編成として保存' : '固定チームとして保存';
    $('loadTeamPreset').textContent = own ? 'この大会編成を適用' : 'この相手チームを適用';
    $('teamPresetHint').textContent = own
      ? '大会ごとに変わる自チームを保存します。'
      : '基本メンバーが同じ相手チームを保存し、大会をまたいで呼び出します。';
    $('teamPresetList').setAttribute('aria-label', own ? '自チームの大会編成' : '相手の固定チーム');
    $('teamPresetList').replaceChildren(new Option(own ? '自チームの大会編成を選択' : '相手の固定チームを選択', ''),
      ...presets().filter(preset => preset.team === team).map(preset => new Option(preset.name, preset.id)));
    renderBoardEnemyTeams();
  }
  for (const id of ['membersBtn', 'ownMembersTab', 'enemyMembersTab']) $(id).addEventListener('click', presetList);
  $('saveTeamPreset').onclick = () => {
    try {
      const team = api.memberEditorTeam, name = $('teamPresetName').value.trim();
      if (!name) { api.showToast('チーム・セット名を入力してください'); return; }
      const list = presets();
      const existing = list.find(item => item.team === team && item.name === name);
      if (existing && !confirm(`「${name}」を現在の編成で更新しますか？`)) return;
      const saved = existing || { id: crypto.randomUUID(), name, team };
      saved.profiles = copy(team === 'mine' ? api.draftMembers : api.draftEnemies);
      saved.slots = copy(api.draftSlots);
      if (!existing) list.push(saved);
      localStorage.setItem('makura-team-presets-v1', JSON.stringify(list));
      presetList(); $('teamPresetList').value = saved.id; $('teamPresetName').value = '';
      window.MakuraCloud?.schedulePush?.();
      api.showToast(team === 'mine' ? '自チームの大会編成を保存しました' : '相手の固定チームを保存しました');
    } catch { api.showToast('編成を保存できませんでした'); }
  };
  $('loadTeamPreset').onclick = () => {
    const preset = presets().find(item => item.id === $('teamPresetList').value && item.team === api.memberEditorTeam);
    if (!preset) return;
    if (preset.team === 'mine') api.draftMembers = copy(preset.profiles);
    else api.draftEnemies = copy(preset.profiles);
    const slots = preset.team === 'mine' ? api.lineupSlotIds : api.enemyLineupSlotIds;
    for (const id of slots) api.draftSlots[id] = preset.slots[id] || '';
    api.renderLineupModal(); presetList();
    if (preset.team === 'enemy') {
      localStorage.setItem(ACTIVE_ENEMY_PRESET_KEY, preset.id);
      renderBoardEnemyTeams(preset.id);
    }
    api.showToast(preset.team === 'mine' ? '大会編成を適用しました。完了で確定します' : '相手チームを適用しました。完了で確定します');
  };
  $('boardEnemyTeamSelect').onchange = event => {
    const preset = presets().find(item => item.id === event.target.value && item.team === 'enemy');
    if (!preset) return;
    $('membersBtn').click();
    $('enemyMembersTab').click();
    api.draftEnemies = copy(preset.profiles);
    for (const id of api.enemyLineupSlotIds) api.draftSlots[id] = preset.slots[id] || '';
    api.renderLineupModal();
    $('saveMembersBtn').click();
    localStorage.setItem(ACTIVE_ENEMY_PRESET_KEY, preset.id);
    renderBoardEnemyTeams(preset.id);
    window.MakuraCloud?.schedulePush?.();
    api.showToast(`相手チームを「${preset.name}」へ切り替えました`);
  };
  $('editEnemyTeamBtn').onclick = () => {
    $('membersBtn').click();
    $('enemyMembersTab').click();
  };
  renderBoardEnemyTeams();
  refresh().catch(() => status('端末内ストレージが利用できません。プライベートブラウズ等の設定を確認してください。'));
})();
