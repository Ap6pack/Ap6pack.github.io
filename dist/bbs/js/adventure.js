'use strict';

window.BbsAdventure = (() => {
  const ENDPOINT = 'https://rdvtghfbytigdxtjopbz.supabase.co/functions/v1/bbs-adventure';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  async function api(action, data = {}) {
    if (!state.token) throw new Error('Authentication required.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
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
        throw new Error('The Lost Node returned an unreadable response.');
      }
      if (!response.ok) throw new Error(output.error || 'The Lost Node connection failed.');
      return output;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The Lost Node timed out.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function storyStats(view, profile) {
    return `<div class="game-stats active-run">
      <span>ROOM ${escapeHtml(view?.room?.title || 'UNKNOWN')}</span>
      <span>STORY TURNS ${Number(view?.turnsUsed) || 0}</span>
      <span>HINTS ${Number(view?.hintsUsed) || 0}</span>
      <span>DAILY LEFT ${Number(profile?.turns_remaining) || 0}</span>
    </div>`;
  }

  function transcriptHtml(view) {
    const lines = Array.isArray(view?.transcript) ? view.transcript : [];
    return lines.map((line) => {
      const command = String(line).startsWith('> ');
      return `<div class="${command ? 'adventure-command' : 'adventure-response'}">${escapeHtml(line)}</div>`;
    }).join('');
  }

  function inventoryHtml(view) {
    const inventory = Array.isArray(view?.inventory) ? view.inventory : [];
    return inventory.length
      ? inventory.map((item) => `<span class="adventure-item">${escapeHtml(item.toUpperCase())}</span>`).join('')
      : '<span class="muted">EMPTY</span>';
  }

  function scoreUser(score) {
    return Array.isArray(score?.user) ? score.user[0] : score?.user;
  }

  function leaderboardHtml(scores) {
    if (!Array.isArray(scores) || !scores.length) return '<div class="empty">No caller has resolved The Lost Node yet.</div>';
    return `<div class="score-table-wrap"><table class="score-table">
      <thead><tr><th>#</th><th>CALLER</th><th>SCORE</th><th>ENDING</th><th>TURNS</th><th>HINTS</th></tr></thead>
      <tbody>${scores.map((score, index) => {
        const user = scoreUser(score);
        return `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(user?.handle || 'UNKNOWN')}</td>
          <td>${Number(score.score) || 0}</td>
          <td>${escapeHtml(String(score.outcome || '').toUpperCase())}</td>
          <td>${Number(score.details?.turnsUsed) || 0}</td>
          <td>${Number(score.details?.hintsUsed) || 0}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  return {
    api,
    escapeHtml,
    storyStats,
    transcriptHtml,
    inventoryHtml,
    leaderboardHtml,
  };
})();
