'use strict';

window.BbsGames = (() => {
  const ENDPOINT = 'https://rdvtghfbytigdxtjopbz.supabase.co/functions/v1/bbs-games';
  const ACHIEVEMENT_LABELS = {
    first_descent: 'FIRST DESCENT',
    first_blood: 'FIRST BLOOD',
    cache_hunter: 'CACHE HUNTER',
    first_escape: 'CARRIER ESCAPE',
    first_death: 'NO CARRIER',
  };

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
        throw new Error('The door-game service returned an unreadable response.');
      }
      if (!response.ok) throw new Error(output.error || 'Door-game service failed.');
      return output;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The door-game service timed out.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function occupantAt(run, x, y) {
    if (run.player?.x === x && run.player?.y === y) return { glyph: '@', className: 'game-player', title: 'You' };
    const enemy = (run.enemies || []).find((item) => item.x === x && item.y === y && item.hp > 0);
    if (enemy) {
      return {
        glyph: enemy.glyph,
        className: enemy.glyph === 'D' ? 'game-daemon' : 'game-enemy',
        title: `${enemy.name} ${enemy.hp}/${enemy.maxHp}`,
      };
    }
    const item = (run.items || []).find((entry) => entry.x === x && entry.y === y);
    if (item) return { glyph: item.glyph, className: item.kind === 'medkit' ? 'game-medkit' : 'game-loot', title: item.kind };
    return null;
  }

  function renderMap(run) {
    if (!run || !Array.isArray(run.map)) return '';
    return run.map.map((row, y) => Array.from(row, (tile, x) => {
      const occupant = occupantAt(run, x, y);
      if (occupant) return `<span class="${occupant.className}" title="${escapeHtml(occupant.title)}">${escapeHtml(occupant.glyph)}</span>`;
      if (tile === '#') return '<span class="game-wall">#</span>';
      if (tile === '>') return '<span class="game-exit" title="Carrier exit">&gt;</span>';
      return '<span class="game-floor">.</span>';
    }).join('')).join('\n');
  }

  function profileStats(profile) {
    if (!profile) return '';
    return `<div class="game-stats">
      <span>LVL ${Number(profile.level) || 1}</span>
      <span>XP ${Number(profile.xp) || 0}</span>
      <span>CRED ${Number(profile.credits) || 0}</span>
      <span>RUNS ${Number(profile.runs) || 0}</span>
      <span>WINS ${Number(profile.wins) || 0}</span>
      <span>DEATHS ${Number(profile.deaths) || 0}</span>
      <span>TURNS ${Number(profile.turns_remaining) || 0}/80</span>
    </div>`;
  }

  function runStats(run, profile) {
    if (!run) return '';
    return `<div class="game-stats active-run">
      <span>HP ${Number(run.player?.hp) || 0}/${Number(run.player?.maxHp) || 0}</span>
      <span>KILLS ${Number(run.player?.kills) || 0}</span>
      <span>RUN CRED ${Number(run.player?.runCredits) || 0}</span>
      <span>PATCHES ${Number(run.player?.medkits) || 0}</span>
      <span>USED ${Number(run.turnsUsed) || 0}</span>
      <span>DAILY LEFT ${Number(profile?.turns_remaining) || 0}</span>
    </div>`;
  }

  function achievementsHtml(profile) {
    const entries = Array.isArray(profile?.achievements) ? profile.achievements : [];
    if (!entries.length) return '<span class="muted">No door-game achievements yet.</span>';
    return entries.map((name) => `<span class="achievement">${escapeHtml(ACHIEVEMENT_LABELS[name] || name.toUpperCase())}</span>`).join('');
  }

  function scoreUser(score) {
    return Array.isArray(score?.user) ? score.user[0] : score?.user;
  }

  function leaderboardHtml(scores) {
    if (!Array.isArray(scores) || !scores.length) return '<div class="empty">The Hall of Legends is empty.</div>';
    return `<div class="score-table-wrap"><table class="score-table">
      <thead><tr><th>#</th><th>CALLER</th><th>SCORE</th><th>OUTCOME</th><th>HP</th><th>KILLS</th></tr></thead>
      <tbody>${scores.map((score, index) => {
        const user = scoreUser(score);
        return `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(user?.handle || 'UNKNOWN')}</td>
          <td>${Number(score.score) || 0}</td>
          <td>${escapeHtml(String(score.outcome || '').toUpperCase())}</td>
          <td>${Number(score.details?.hp) || 0}</td>
          <td>${Number(score.details?.kills) || 0}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function commandForKey(event) {
    const key = event.key.toLowerCase();
    if (key === 'arrowup' || key === 'w') return 'n';
    if (key === 'arrowdown' || key === 's') return 's';
    if (key === 'arrowleft' || key === 'a') return 'w';
    if (key === 'arrowright' || key === 'd') return 'e';
    if (key === 'm') return 'm';
    if (key === '.' || key === ' ') return 'wait';
    return '';
  }

  return {
    api,
    renderMap,
    profileStats,
    runStats,
    achievementsHtml,
    leaderboardHtml,
    commandForKey,
  };
})();
