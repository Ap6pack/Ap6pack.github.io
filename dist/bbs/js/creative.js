'use strict';

window.BbsCreative = (() => {
  const SOUND_KEY = 'apt6pack-bbs-sound';
  const PALETTE = [
    '#000000', '#aa0000', '#00aa00', '#aa5500',
    '#0000aa', '#aa00aa', '#00aaaa', '#aaaaaa',
    '#555555', '#ff5555', '#55ff55', '#ffff55',
    '#5555ff', '#ff55ff', '#55ffff', '#ffffff',
  ];
  const NOTE_OPTIONS = ['', 'C2', 'D2', 'E2', 'G2', 'A2', 'C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'K', 'S', 'H'];
  const CHANNELS = [
    { name: 'LEAD', wave: 'square', volume: 0.045 },
    { name: 'BASS', wave: 'sawtooth', volume: 0.035 },
    { name: 'PAD', wave: 'triangle', volume: 0.03 },
    { name: 'DRUM', wave: 'noise', volume: 0.04 },
  ];

  let soundEnabled = localStorage.getItem(SOUND_KEY) === 'on';
  let audioContext = null;
  let ambientTimer = null;
  let ambientGain = null;
  let playbackTimer = null;
  let playbackGain = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function getContext() {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) audioContext = new AudioCtor();
    }
    return audioContext;
  }

  async function unlock() {
    const context = getContext();
    if (context?.state === 'suspended') await context.resume();
    return context;
  }

  function gainNode(context, destination, value = 1) {
    const gain = context.createGain();
    gain.gain.value = value;
    gain.connect(destination);
    return gain;
  }

  function stopGain(gain) {
    if (!gain) return;
    try {
      const now = gain.context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.02);
      window.setTimeout(() => gain.disconnect(), 120);
    } catch {
      // The node is already disconnected.
    }
  }

  function noteFrequency(note) {
    const match = /^([A-G])(#|b)?([2-6])$/.exec(note || '');
    if (!match) return 0;
    const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let value = semitones[match[1]];
    if (match[2] === '#') value += 1;
    if (match[2] === 'b') value -= 1;
    const midi = (Number(match[3]) + 1) * 12 + value;
    return 440 * (2 ** ((midi - 69) / 12));
  }

  function scheduleTone(context, destination, frequency, start, duration, volume, wave) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function noiseBuffer(context, duration) {
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  function scheduleNoise(context, destination, start, duration, volume, highpass = 0) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = noiseBuffer(context, duration);
    gain.gain.setValueAtTime(Math.max(volume, 0.0002), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(gain);
    if (highpass > 0) {
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = highpass;
      gain.connect(filter);
      filter.connect(destination);
    } else {
      gain.connect(destination);
    }
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function scheduleDrum(context, destination, note, start, volume) {
    if (note === 'K') {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(125, start);
      oscillator.frequency.exponentialRampToValueAtTime(42, start + 0.13);
      gain.gain.setValueAtTime(volume * 1.5, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    } else if (note === 'S') {
      scheduleNoise(context, destination, start, 0.13, volume, 900);
      scheduleTone(context, destination, 180, start, 0.08, volume * 0.5, 'triangle');
    } else if (note === 'H') {
      scheduleNoise(context, destination, start, 0.045, volume * 0.6, 5000);
    }
  }

  function schedulePattern(context, destination, pattern, bpm, start = context.currentTime + 0.03) {
    const stepDuration = 60 / bpm / 4;
    const channels = Array.isArray(pattern?.channels) ? pattern.channels.slice(0, 4) : [];
    channels.forEach((channel) => {
      const notes = Array.isArray(channel.notes) ? channel.notes.slice(0, 16) : [];
      const volume = Math.min(Math.max(Number(channel.volume) || 0.03, 0.01), 0.2);
      notes.forEach((note, step) => {
        if (!note) return;
        const when = start + step * stepDuration;
        if (['K', 'S', 'H'].includes(note) || channel.wave === 'noise') {
          scheduleDrum(context, destination, note, when, volume);
        } else {
          const frequency = noteFrequency(note);
          if (frequency) scheduleTone(context, destination, frequency, when, stepDuration * 0.82, volume, channel.wave || 'square');
        }
      });
    });
    return stepDuration * 16;
  }

  function defaultPattern() {
    return {
      version: 1,
      steps: 16,
      channels: [
        { wave: 'square', volume: 0.045, notes: ['C4', null, 'E4', null, 'G4', null, 'E4', null, 'D4', null, 'E4', null, 'A4', null, 'G4', null] },
        { wave: 'sawtooth', volume: 0.035, notes: ['C2', null, null, null, 'G2', null, null, null, 'A2', null, null, null, 'G2', null, null, null] },
        { wave: 'triangle', volume: 0.03, notes: ['C3', null, null, null, 'E3', null, null, null, 'A3', null, null, null, 'G3', null, null, null] },
        { wave: 'noise', volume: 0.04, notes: ['K', 'H', 'S', 'H', 'K', 'H', 'S', 'H', 'K', 'H', 'S', 'H', 'K', 'H', 'S', 'H'] },
      ],
    };
  }

  function ambientPattern() {
    return {
      version: 1,
      steps: 16,
      channels: [
        { wave: 'triangle', volume: 0.012, notes: ['C3', null, null, null, 'G2', null, null, null, 'A2', null, null, null, 'E2', null, null, null] },
        { wave: 'square', volume: 0.008, notes: [null, null, 'E4', null, null, null, 'D4', null, null, null, 'C4', null, null, null, 'D4', null] },
        { wave: 'noise', volume: 0.008, notes: ['H', null, 'H', null, 'H', null, 'H', null, 'H', null, 'H', null, 'H', null, 'H', null] },
      ],
    };
  }

  function stopAmbient() {
    if (ambientTimer) window.clearInterval(ambientTimer);
    ambientTimer = null;
    stopGain(ambientGain);
    ambientGain = null;
  }

  function stopPlayback() {
    if (playbackTimer) window.clearTimeout(playbackTimer);
    playbackTimer = null;
    stopGain(playbackGain);
    playbackGain = null;
  }

  async function startAmbient() {
    if (!soundEnabled || document.hidden || playbackGain || ambientGain) return;
    const context = await unlock();
    if (!context) return;
    const pattern = ambientPattern();
    const bpm = 92;
    ambientGain = gainNode(context, context.destination, 0.8);
    const duration = schedulePattern(context, ambientGain, pattern, bpm);
    ambientTimer = window.setInterval(() => {
      if (soundEnabled && !document.hidden && ambientGain && !playbackGain) schedulePattern(context, ambientGain, pattern, bpm);
    }, duration * 1000);
  }

  async function connectionSound() {
    if (!soundEnabled) return;
    const context = await unlock();
    if (!context) return;
    const gain = gainNode(context, context.destination, 0.75);
    const start = context.currentTime + 0.02;
    scheduleTone(context, gain, 1200, start, 0.06, 0.035, 'square');
    scheduleTone(context, gain, 1700, start + 0.08, 0.06, 0.03, 'square');
    scheduleNoise(context, gain, start + 0.16, 0.22, 0.018, 700);
    scheduleTone(context, gain, 980, start + 0.42, 0.08, 0.03, 'sine');
    scheduleTone(context, gain, 1400, start + 0.52, 0.08, 0.025, 'sine');
    window.setTimeout(() => stopGain(gain), 850);
  }

  async function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
    if (soundEnabled) {
      await unlock();
      await connectionSound();
      window.setTimeout(startAmbient, 850);
    } else {
      stopAmbient();
      stopPlayback();
      if (audioContext?.state === 'running') await audioContext.suspend();
    }
    return soundEnabled;
  }

  async function uiTone(type = 'menu') {
    if (!soundEnabled) return;
    const context = await unlock();
    if (!context) return;
    const gain = gainNode(context, context.destination, 0.8);
    const start = context.currentTime + 0.005;
    if (type === 'error') scheduleTone(context, gain, 180, start, 0.16, 0.025, 'square');
    else if (type === 'success') {
      scheduleTone(context, gain, 660, start, 0.07, 0.02, 'square');
      scheduleTone(context, gain, 880, start + 0.08, 0.09, 0.018, 'square');
    } else scheduleTone(context, gain, 520, start, 0.045, 0.012, 'square');
    window.setTimeout(() => stopGain(gain), 300);
  }

  async function playPattern(pattern, bpm) {
    if (!soundEnabled) {
      soundEnabled = true;
      localStorage.setItem(SOUND_KEY, 'on');
    }
    const context = await unlock();
    if (!context) throw new Error('Web Audio is unavailable in this browser.');
    stopAmbient();
    stopPlayback();
    playbackGain = gainNode(context, context.destination, 0.9);
    const duration = schedulePattern(context, playbackGain, pattern, bpm);
    playbackTimer = window.setTimeout(() => {
      stopPlayback();
      startAmbient();
    }, (duration + 0.2) * 1000);
  }

  function wavBytes(audioBuffer) {
    const channels = Math.min(audioBuffer.numberOfChannels, 2);
    const sampleRate = audioBuffer.sampleRate;
    const frames = audioBuffer.length;
    const blockAlign = channels * 2;
    const buffer = new ArrayBuffer(44 + frames * blockAlign);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + frames * blockAlign, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, frames * blockAlign, true);
    const channelData = Array.from({ length: channels }, (_, channel) => audioBuffer.getChannelData(channel));
    let offset = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return buffer;
  }

  async function exportWav(pattern, bpm, title) {
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) throw new Error('WAV export is unavailable in this browser.');
    const duration = 60 / bpm / 4 * 16 + 0.3;
    const sampleRate = 44100;
    const offline = new OfflineCtor(2, Math.ceil(duration * sampleRate), sampleRate);
    const master = gainNode(offline, offline.destination, 0.95);
    schedulePattern(offline, master, pattern, bpm, 0.03);
    const rendered = await offline.startRendering();
    downloadBlob(new Blob([wavBytes(rendered)], { type: 'audio/wav' }), `${slug(title) || 'bbs-track'}.wav`);
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function styleKey(style) {
    return `${style.fg}:${style.bg}:${style.bold ? 1 : 0}`;
  }

  function documentFromText(text, styles) {
    const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    return {
      version: 1,
      width: 80,
      lines: lines.map((line, lineIndex) => {
        const runs = [];
        let current = null;
        for (let column = 0; column < line.length; column += 1) {
          const style = styles[lineIndex]?.[column] || { fg: 10, bg: 0, bold: false };
          const key = styleKey(style);
          if (!current || current.key !== key) {
            current = { key, text: '', fg: style.fg, bg: style.bg, bold: style.bold };
            runs.push(current);
          }
          current.text += line[column];
        }
        return runs.map(({ key, ...run }) => run);
      }),
    };
  }

  function renderAnsi(documentValue) {
    const lines = Array.isArray(documentValue?.lines) ? documentValue.lines : [];
    return lines.map((line) => {
      if (!Array.isArray(line)) return '';
      return line.map((run) => {
        const fg = Number.isInteger(run.fg) ? run.fg : 7;
        const bg = Number.isInteger(run.bg) ? run.bg : 0;
        return `<span class="ansi-fg-${fg} ansi-bg-${bg}${run.bold ? ' ansi-bold' : ''}">${escapeHtml(run.text)}</span>`;
      }).join('');
    }).join('\n');
  }

  function exportAns(documentValue, title) {
    const lines = Array.isArray(documentValue?.lines) ? documentValue.lines : [];
    const output = lines.map((line) => {
      if (!Array.isArray(line)) return '';
      return line.map((run) => {
        const fg = Number(run.fg);
        const bg = Number(run.bg);
        const fgCode = fg < 8 ? 30 + fg : 90 + (fg - 8);
        const bgCode = bg < 8 ? 40 + bg : 100 + (bg - 8);
        const codes = [run.bold ? 1 : 22, fgCode, bgCode];
        return `\u001b[${codes.join(';')}m${run.text}`;
      }).join('') + '\u001b[0m';
    }).join('\r\n');
    downloadBlob(new Blob([output], { type: 'text/plain;charset=us-ascii' }), `${slug(title) || 'bbs-art'}.ans`);
  }

  function paletteHtml(kind, selected) {
    return PALETTE.map((hex, index) => `<button type="button" class="ansi-swatch${index === selected ? ' selected' : ''}" data-${kind}="${index}" aria-label="${kind} color ${index}"><span class="ansi-chip ansi-bg-${index}"></span>${index.toString(16).toUpperCase()}</button>`).join('');
  }

  function noteOptions(selected) {
    return NOTE_OPTIONS.map((note) => `<option value="${note}"${(selected || '') === note ? ' selected' : ''}>${note || '--'}</option>`).join('');
  }

  function trackerEditorHtml(pattern = defaultPattern()) {
    const channels = Array.isArray(pattern.channels) ? pattern.channels : defaultPattern().channels;
    return `<div class="tracker-scroll"><table class="tracker"><thead><tr><th>CHANNEL</th>${Array.from({ length: 16 }, (_, index) => `<th>${String(index + 1).padStart(2, '0')}</th>`).join('')}</tr></thead><tbody>${CHANNELS.map((defaults, channelIndex) => {
      const channel = channels[channelIndex] || defaults;
      const waveOptions = ['square', 'sawtooth', 'triangle', 'sine', 'noise'].map((wave) => `<option value="${wave}"${channel.wave === wave ? ' selected' : ''}>${wave}</option>`).join('');
      return `<tr><th><span>${defaults.name}</span><select data-wave="${channelIndex}">${waveOptions}</select><input data-volume="${channelIndex}" type="range" min="0.01" max="0.2" step="0.005" value="${Number(channel.volume) || defaults.volume}"></th>${Array.from({ length: 16 }, (_, step) => `<td><select data-channel="${channelIndex}" data-step="${step}">${noteOptions(channel.notes?.[step])}</select></td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function readPattern(root) {
    return {
      version: 1,
      steps: 16,
      channels: CHANNELS.map((defaults, channelIndex) => ({
        wave: root.querySelector(`[data-wave="${channelIndex}"]`)?.value || defaults.wave,
        volume: Number(root.querySelector(`[data-volume="${channelIndex}"]`)?.value || defaults.volume),
        notes: Array.from({ length: 16 }, (_, step) => root.querySelector(`[data-channel="${channelIndex}"][data-step="${step}"]`)?.value || null),
      })),
    };
  }

  function trackerText(pattern) {
    return (pattern?.channels || []).map((channel, index) => `${CHANNELS[index]?.name || `CH${index + 1}`}`.padEnd(5) + ' ' + channel.notes.map((note) => String(note || '--').padEnd(2)).join(' ')).join('\n');
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      stopAmbient();
      stopPlayback();
      if (audioContext?.state === 'running') await audioContext.suspend();
    } else if (soundEnabled) {
      await unlock();
      startAmbient();
    }
  });

  return {
    PALETTE,
    isSoundEnabled: () => soundEnabled,
    soundLabel: () => `[S]ound:${soundEnabled ? 'ON' : 'OFF'}`,
    toggleSound,
    uiTone,
    startAmbient,
    stopAmbient,
    stopPlayback,
    playPattern,
    exportWav,
    defaultPattern,
    trackerEditorHtml,
    readPattern,
    trackerText,
    documentFromText,
    renderAnsi,
    exportAns,
    paletteHtml,
  };
})();
