'use strict';

(() => {
  const CREATIONS_ENDPOINT = 'https://rdvtghfbytigdxtjopbz.supabase.co/functions/v1/bbs-creations';
  const creative = window.BbsCreative;
  const DEFAULT_STYLE = { fg: 10, bg: 0, bold: false };
  const ART_SAMPLE = [
    '              ___    ____  ________  ____  ___   ________ __',
    '             /   |  / __ \/_  __/ / / / / / / | / / ____// /',
    '            / /| | / /_/ / / / / /_/ / /_/ /  |/ / /    / / ',
    '           / ___ |/ ____/ / / / __  / __  / /|  / /___ /_/  ',
    '          /_/  |_/_/     /_/ /_/ /_/_/ /_/_/ |_/\____/(_)   ',
    '',
    '                  CALLER ART :: 80 COLUMN ANSI',
  ].join('\n');

  let artStyles = [];
  let selectedFg = 10;
  let selectedBg = 0;
  let selectedBold = false;

  function authorOf(item) {
    return Array.isArray(item?.author) ? item.author[0] : item?.author;
  }

  function canRemove(item) {
    return item.author_id === state.user?.id || ['moderator', 'sysop'].includes(state.user?.role);
  }

  async function creationsApi(action, data = {}) {
    if (!state.token) throw new Error('Authentication required.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(CREATIONS_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({ action, ...data }),
        signal: controller.signal,
      });
      let output = {};
      try {
        output = await response.json();
      } catch {
        throw new Error('The creation service returned an unreadable response.');
      }
      if (!response.ok) throw new Error(output.error || 'Creation service failed.');
      return output;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The creation service timed out.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function soundButtonText() {
    return creative?.soundLabel() || '[S]ound:OFF';
  }

  function refreshSoundButtons() {
    document.querySelectorAll('[data-nav="sound"]').forEach((button) => {
      button.textContent = soundButtonText();
      button.classList.toggle('active', Boolean(creative?.isSoundEnabled()));
    });
  }

  async function toggleSound() {
    try {
      const enabled = await creative.toggleSound();
      refreshSoundButtons();
      flash(`Sound ${enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (error) {
      flash(error.message);
    }
  }

  function validateArtText(text) {
    const normalized = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\n+$/g, '');
    if (!normalized) return { error: 'ANSI art cannot be empty.' };
    if (!/^[\x20-\x7E\n]+$/.test(normalized)) return { error: 'Use printable ASCII characters only.' };
    const lines = normalized.split('\n');
    if (lines.length > 40) return { error: 'ANSI art is limited to 40 lines.' };
    if (lines.some((line) => line.length > 80)) return { error: 'ANSI art is limited to 80 columns.' };
    return { text: normalized, lines };
  }

  function syncArtStyles(text) {
    const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    artStyles = lines.map((line, lineIndex) => Array.from(line, (_, column) => (
      artStyles[lineIndex]?.[column] || { ...DEFAULT_STYLE }
    )));
  }

  function selectedStyle() {
    return { fg: selectedFg, bg: selectedBg, bold: selectedBold };
  }

  function applyStyleToSelection(textarea) {
    const text = textarea.value;
    syncArtStyles(text);
    if (textarea.selectionStart === textarea.selectionEnd) {
      flash('Select one or more characters before applying color.');
      return;
    }
    const style = selectedStyle();
    let line = 0;
    let column = 0;
    for (let offset = 0; offset < text.length; offset += 1) {
      if (text[offset] === '\n') {
        line += 1;
        column = 0;
        continue;
      }
      if (offset >= textarea.selectionStart && offset < textarea.selectionEnd && artStyles[line]?.[column]) {
        artStyles[line][column] = { ...style };
      }
      column += 1;
    }
    renderArtPreview();
  }

  function currentArtDocument() {
    const textarea = document.getElementById('ansiText');
    if (!textarea) return null;
    const checked = validateArtText(textarea.value);
    if (checked.error) throw new Error(checked.error);
    syncArtStyles(checked.text);
    return creative.documentFromText(checked.text, artStyles);
  }

  function renderArtPreview() {
    const textarea = document.getElementById('ansiText');
    const preview = document.getElementById('ansiPreview');
    const count = document.getElementById('ansiCount');
    if (!textarea || !preview) return;
    syncArtStyles(textarea.value);
    const documentValue = creative.documentFromText(textarea.value, artStyles);
    preview.innerHTML = creative.renderAnsi(documentValue) || ' '; 
    const lines = textarea.value.replaceAll('\r\n', '\n').split('\n');
    const widest = Math.max(0, ...lines.map((line) => line.length));
    if (count) {
      count.textContent = `${lines.length}/40 lines :: ${widest}/80 columns`;
      count.className = lines.length > 40 || widest > 80 ? 'warning' : 'muted';
    }
  }

  function bindPalette() {
    document.querySelectorAll('[data-fg]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedFg = Number(button.dataset.fg);
        document.querySelectorAll('[data-fg]').forEach((item) => item.classList.toggle('selected', item === button));
      });
    });
    document.querySelectorAll('[data-bg]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedBg = Number(button.dataset.bg);
        document.querySelectorAll('[data-bg]').forEach((item) => item.classList.toggle('selected', item === button));
      });
    });
    const bold = document.getElementById('ansiBold');
    if (bold) bold.addEventListener('change', () => { selectedBold = bold.checked; });
  }

  async function loadArtGallery() {
    const gallery = document.getElementById('artGallery');
    if (!gallery) return;
    gallery.innerHTML = '<div class="empty">Loading caller art...</div>';
    try {
      const response = await creationsApi('art_list');
      const art = Array.isArray(response.art) ? response.art : [];
      if (!art.length) {
        gallery.innerHTML = '<div class="empty">No caller art has been uploaded to the gallery yet.</div>';
        return;
      }
      gallery.innerHTML = art.map((item) => {
        const author = authorOf(item);
        return `<article class="creation-card">
          <div class="row">
            <div><div class="subject">${escapeHtml(item.title)}</div><div class="meta">by ${escapeHtml(author?.handle || 'unknown')} :: ${formatDate(item.created_at)}</div></div>
            <div class="toolbar compact"><button data-export-art="${escapeHtml(item.id)}">Export .ANS</button>${canRemove(item) ? `<button class="danger" data-delete-art="${escapeHtml(item.id)}">Delete</button>` : ''}</div>
          </div>
          <pre class="ansi-canvas gallery-art">${creative.renderAnsi(item.document)}</pre>
        </article>`;
      }).join('');

      gallery.querySelectorAll('[data-export-art]').forEach((button) => {
        button.addEventListener('click', () => {
          const item = art.find((entry) => entry.id === button.dataset.exportArt);
          if (item) creative.exportAns(item.document, item.title);
        });
      });
      gallery.querySelectorAll('[data-delete-art]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await creationsApi('art_delete', { id: button.dataset.deleteArt });
            await loadArtGallery();
          } catch (error) {
            flash(error.message);
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      gallery.innerHTML = '';
      flash(error.message);
    }
  }

  async function showArt() {
    if (!state.user) return renderAuth();
    setStatus('ANSI ART GALLERY');
    artStyles = [];
    selectedFg = 10;
    selectedBg = 0;
    selectedBold = false;
    renderShell(
      'ANSI Art Gallery',
      `<pre class="ascii screen-art">+------------------------------------------------------------------------------+
| CALLER ANSI GALLERY :: 80 COLUMNS :: 16 COLORS                              |
+------------------------------------------------------------------------------+</pre>
      <p>Compose printable ASCII, color any selected characters, preview it as ANSI, then save it for other authenticated callers.</p>
      <form id="artForm">
        <label for="artTitle">Title</label>
        <input id="artTitle" name="title" maxlength="80" required>
        <label for="ansiText">80-column canvas</label>
        <textarea id="ansiText" class="ansi-editor" maxlength="3240" spellcheck="false">${escapeHtml(ART_SAMPLE)}</textarea>
        <div id="ansiCount" class="muted"></div>
        <div class="ansi-controls">
          <div><span class="meta">FOREGROUND</span><div class="ansi-palette">${creative.paletteHtml('fg', selectedFg)}</div></div>
          <div><span class="meta">BACKGROUND</span><div class="ansi-palette">${creative.paletteHtml('bg', selectedBg)}</div></div>
          <label class="inline-option"><input id="ansiBold" type="checkbox"> BRIGHT / BOLD</label>
          <button id="applyAnsiStyle" type="button">Apply color to selection</button>
        </div>
        <label>Preview</label>
        <pre id="ansiPreview" class="ansi-canvas"></pre>
        <div class="toolbar">
          <button type="submit">Save to gallery</button>
          <button id="exportDraftAnsi" type="button">Export draft .ANS</button>
        </div>
      </form>
      <h2>Caller Gallery</h2>
      <div id="artGallery"></div>`,
      navigation(),
    );
    bindNavigation();
    bindPalette();

    const textarea = document.getElementById('ansiText');
    syncArtStyles(textarea.value);
    renderArtPreview();
    textarea.addEventListener('input', renderArtPreview);
    document.getElementById('applyAnsiStyle').addEventListener('click', () => applyStyleToSelection(textarea));
    document.getElementById('exportDraftAnsi').addEventListener('click', () => {
      try {
        creative.exportAns(currentArtDocument(), document.getElementById('artTitle').value || 'bbs-art');
      } catch (error) {
        flash(error.message);
      }
    });
    document.getElementById('artForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setSubmitting(form, true);
      try {
        await creationsApi('art_create', {
          title: document.getElementById('artTitle').value,
          document: currentArtDocument(),
        });
        document.getElementById('artTitle').value = '';
        flash('ANSI art saved to the caller gallery.', 'success');
        await loadArtGallery();
      } catch (error) {
        flash(error.message);
      } finally {
        setSubmitting(form, false);
      }
    });
    await loadArtGallery();
  }

  async function loadTracks() {
    const list = document.getElementById('trackList');
    if (!list) return;
    list.innerHTML = '<div class="empty">Loading tracker modules...</div>';
    try {
      const response = await creationsApi('tracks_list');
      const tracks = Array.isArray(response.tracks) ? response.tracks : [];
      if (!tracks.length) {
        list.innerHTML = '<div class="empty">No caller tracker modules have been saved yet.</div>';
        return;
      }
      list.innerHTML = tracks.map((track) => {
        const author = authorOf(track);
        return `<article class="creation-card">
          <div class="row"><div><div class="subject">${escapeHtml(track.title)} <span class="badge">${Number(track.bpm)} BPM</span></div><div class="meta">by ${escapeHtml(author?.handle || 'unknown')} :: ${formatDate(track.created_at)}</div></div>
          <div class="toolbar compact"><button data-play-track="${escapeHtml(track.id)}">Play</button><button data-export-track="${escapeHtml(track.id)}">Export WAV</button>${canRemove(track) ? `<button class="danger" data-delete-track="${escapeHtml(track.id)}">Delete</button>` : ''}</div></div>
          <pre class="tracker-text">${escapeHtml(creative.trackerText(track.pattern))}</pre>
        </article>`;
      }).join('');

      list.querySelectorAll('[data-play-track]').forEach((button) => {
        button.addEventListener('click', async () => {
          const track = tracks.find((item) => item.id === button.dataset.playTrack);
          if (!track) return;
          try {
            await creative.playPattern(track.pattern, Number(track.bpm));
            refreshSoundButtons();
          } catch (error) {
            flash(error.message);
          }
        });
      });
      list.querySelectorAll('[data-export-track]').forEach((button) => {
        button.addEventListener('click', async () => {
          const track = tracks.find((item) => item.id === button.dataset.exportTrack);
          if (!track) return;
          try {
            await creative.exportWav(track.pattern, Number(track.bpm), track.title);
          } catch (error) {
            flash(error.message);
          }
        });
      });
      list.querySelectorAll('[data-delete-track]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await creationsApi('track_delete', { id: button.dataset.deleteTrack });
            await loadTracks();
          } catch (error) {
            flash(error.message);
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      list.innerHTML = '';
      flash(error.message);
    }
  }

  async function showJukebox() {
    if (!state.user) return renderAuth();
    setStatus('TRACKER JUKEBOX');
    renderShell(
      'Tracker Jukebox',
      `<pre class="ascii screen-art">+------------------------------------------------------------------------------+
| CALLER TRACKER :: 4 CHANNELS :: 16 STEPS :: PROCEDURAL LO-FI                 |
+------------------------------------------------------------------------------+</pre>
      <p>Create a tiny old-school module. The BBS stores only the validated note pattern; playback and WAV rendering happen locally in your browser.</p>
      <form id="trackForm">
        <div class="grid two-column">
          <div><label for="trackTitle">Title</label><input id="trackTitle" maxlength="80" required></div>
          <div><label for="trackBpm">BPM</label><input id="trackBpm" type="number" min="60" max="180" value="96" required></div>
        </div>
        <div id="trackerEditor">${creative.trackerEditorHtml()}</div>
        <div class="toolbar">
          <button type="submit">Save module</button>
          <button id="playDraft" type="button">Play draft</button>
          <button id="exportDraftWav" type="button">Export draft WAV</button>
          <button id="stopDraft" type="button">Stop</button>
        </div>
      </form>
      <h2>Caller Jukebox</h2>
      <div id="trackList"></div>`,
      navigation(),
    );
    bindNavigation();

    const editor = document.getElementById('trackerEditor');
    const bpm = () => Math.min(Math.max(Number(document.getElementById('trackBpm').value) || 96, 60), 180);
    const title = () => document.getElementById('trackTitle').value || 'bbs-track';

    document.getElementById('playDraft').addEventListener('click', async () => {
      try {
        await creative.playPattern(creative.readPattern(editor), bpm());
        refreshSoundButtons();
      } catch (error) {
        flash(error.message);
      }
    });
    document.getElementById('exportDraftWav').addEventListener('click', async () => {
      try {
        await creative.exportWav(creative.readPattern(editor), bpm(), title());
      } catch (error) {
        flash(error.message);
      }
    });
    document.getElementById('stopDraft').addEventListener('click', () => creative.stopPlayback());
    document.getElementById('trackForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setSubmitting(form, true);
      try {
        await creationsApi('track_create', {
          title: document.getElementById('trackTitle').value,
          bpm: bpm(),
          pattern: creative.readPattern(editor),
        });
        document.getElementById('trackTitle').value = '';
        flash('Tracker module saved to the caller jukebox.', 'success');
        await loadTracks();
      } catch (error) {
        flash(error.message);
      } finally {
        setSubmitting(form, false);
      }
    });
    await loadTracks();
  }

  const originalNavigation = navigation;
  navigation = function creativeNavigation() {
    const base = originalNavigation();
    const additions = [
      '<button data-nav="art">[A]rt</button>',
      '<button data-nav="jukebox">[J]ukebox</button>',
      `<button data-nav="sound">${escapeHtml(soundButtonText())}</button>`,
    ].join('');
    return base.replace('<button data-nav="logout">', `${additions}<button data-nav="logout">`);
  };

  const originalGo = go;
  go = function creativeGo(destination) {
    if (destination === 'art') return showArt();
    if (destination === 'jukebox') return showJukebox();
    if (destination === 'sound') return toggleSound();
    return originalGo(destination);
  };

  const originalHome = home;
  home = function creativeHome() {
    originalHome();
    const menu = document.querySelector('.panel .ascii');
    if (menu) {
      menu.textContent = `[M] MESSAGE BOARDS     [F] FILE AREAS\n[W] WHO'S ONLINE       [A] ANSI ART\n[J] TRACKER JUKEBOX     [S] SOUND ${creative.isSoundEnabled() ? 'ON' : 'OFF'}\n${state.user?.role === 'sysop' ? '[I] INVITES            ' : '                       '}[G] LOG OFF`;
    }
    refreshSoundButtons();
    if (creative.isSoundEnabled()) creative.startAmbient();
  };

  const originalLogout = logout;
  logout = async function creativeLogout() {
    creative.stopAmbient();
    creative.stopPlayback();
    return originalLogout();
  };

  const originalFlash = flash;
  flash = function creativeFlash(message, type = 'error') {
    originalFlash(message, type);
    if (message) creative.uiTone(type === 'error' ? 'error' : 'success');
  };

  document.addEventListener('keydown', (event) => {
    if (!state.user || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === 'a') showArt();
    else if (key === 'j') showJukebox();
    else if (key === 's') toggleSound();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('button') && creative.isSoundEnabled()) creative.uiTone('menu');
  });
})();
