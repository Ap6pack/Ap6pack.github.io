'use strict';

(() => {
  const games = window.BbsGames;
  const creative = window.BbsCreative;
  let doorGameOpen = false;
  let commandPending = false;

  function completeHomeMenu() {
    const menu = document.querySelector('.panel .ascii');
    if (!menu || !state.user) return;
    menu.textContent = `[M] MESSAGE BOARDS     [F] FILE AREAS
[W] WHO'S ONLINE       [A] ANSI ART
[J] TRACKER JUKEBOX     [S] SOUND ${creative?.isSoundEnabled() ? 'ON' : 'OFF'}
[D] DOOR GAMES          ${state.user.role === 'sysop' ? '[I] INVITES' : '           '}
[G] LOG OFF`;
  }

  function doorHeader() {
    return `<pre class="ascii screen-art">+------------------------------------------------------------------------------+
| DOOR GAMES :: REMOTE PROGRAMS :: DAILY TURNS :: PERSISTENT CALLER SAVES      |
+------------------------------------------------------------------------------+</pre>`;
  }

  async function showDoors() {
    if (!state.user) return renderAuth();
    doorGameOpen = false;
    setStatus('DOOR GAMES');
    renderShell('Door Games', `${doorHeader()}<div class="empty">Dialing remote game node...</div>`, navigation());
    bindNavigation();

    try {
      const [profileResponse, scoresResponse] = await Promise.all([
        games.api('profile'),
        games.api('leaderboard'),
      ]);
      const profile = profileResponse.profile;
      const run = profileResponse.run;
      renderShell(
        'Door Games',
        `${doorHeader()}
        ${games.profileStats(profile)}
        <div class="grid door-grid">
          <article class="card door-card">
            <div class="subject">Packet Dungeon <span class="badge">PLAYABLE</span></div>
            <pre class="door-logo">  /\\_/\\    PACKET DUNGEON
 ( o.o )   ASCII CRAWLER
  > ^ <    FLOOR 01</pre>
            <p>Explore a corrupted node, recover data caches, defeat the daemon, and reach the carrier exit.</p>
            <p class="meta">Movement consumes daily turns. Progress is saved after every command.</p>
            <button id="packetDungeon">${run ? 'Continue saved run' : 'Enter Packet Dungeon'}</button>
          </article>
          <article class="card door-card locked">
            <div class="subject">The Lost Node <span class="badge">COMING NEXT</span></div>
            <pre class="door-logo">&gt; EXAMINE TERMINAL
&gt; OPEN MAINTENANCE HATCH
&gt; LISTEN TO CARRIER</pre>
            <p>A handcrafted command-driven text adventure will use the same caller profile, inventory, and achievement system.</p>
            <button disabled>Line busy</button>
          </article>
          <article class="card door-card">
            <div class="subject">Hall of Legends <span class="badge">TOP 20</span></div>
            <p>Highest Packet Dungeon scores across all callers.</p>
            <button id="hallOfLegends">View scores</button>
          </article>
        </div>
        <h2>Achievements</h2>
        <div class="achievement-list">${games.achievementsHtml(profile)}</div>
        <h2>Current Legends</h2>
        ${games.leaderboardHtml((scoresResponse.scores || []).slice(0, 5))}
        <p class="meta">Daily turns reset to 80 at 00:00 UTC. Leaving this screen does not abandon an active run.</p>`,
        navigation(),
      );
      bindNavigation();
      document.getElementById('packetDungeon')?.addEventListener('click', enterDungeon);
      document.getElementById('hallOfLegends')?.addEventListener('click', showHall);
    } catch (error) {
      flash(error.message);
    }
  }

  function dungeonLegend() {
    return `<div class="game-legend">
      <span><b class="game-player">@</b> YOU</span>
      <span><b class="game-enemy">g</b> GLITCH</span>
      <span><b class="game-enemy">b</b> BOT</span>
      <span><b class="game-daemon">D</b> DAEMON</span>
      <span><b class="game-loot">$</b> CACHE</span>
      <span><b class="game-medkit">+</b> PATCH</span>
      <span><b class="game-exit">&gt;</b> EXIT</span>
    </div>`;
  }

  function directionalPad() {
    return `<div class="game-controls" aria-label="Dungeon controls">
      <span></span><button data-game-command="n" aria-label="Move north">N</button><span></span>
      <button data-game-command="w" aria-label="Move west">W</button><button data-game-command="wait" aria-label="Wait">.</button><button data-game-command="e" aria-label="Move east">E</button>
      <span></span><button data-game-command="s" aria-label="Move south">S</button><span></span>
    </div>
    <div class="toolbar game-actions">
      <button data-game-command="m">[M] Use repair patch</button>
      <button id="returnToDoors">Return to doors</button>
      <button id="abandonRun" class="danger">Abandon run</button>
    </div>`;
  }

  function renderDungeon(profile, run) {
    doorGameOpen = true;
    setStatus('PACKET DUNGEON :: FLOOR 01');
    renderShell(
      'Packet Dungeon',
      `${games.runStats(run, profile)}
      ${dungeonLegend()}
      <pre class="dungeon-map" aria-label="Packet Dungeon map">${games.renderMap(run)}</pre>
      ${directionalPad()}
      <div class="game-help">ARROWS or W/A/S/D: MOVE/ATTACK :: M: PATCH :: SPACE: WAIT :: Q: DOOR MENU</div>
      <h2>Terminal Log</h2>
      <div class="game-log">${(run.log || []).map((entry) => `<div>&gt; ${escapeHtml(entry)}</div>`).join('')}</div>`,
      navigation(),
    );
    bindNavigation();
    document.querySelectorAll('[data-game-command]').forEach((button) => {
      button.addEventListener('click', () => sendCommand(button.dataset.gameCommand));
    });
    document.getElementById('returnToDoors')?.addEventListener('click', showDoors);
    document.getElementById('abandonRun')?.addEventListener('click', abandonRun);
  }

  async function enterDungeon() {
    if (commandPending) return;
    commandPending = true;
    try {
      const response = await games.api('start');
      renderDungeon(response.profile, response.run);
      if (creative?.isSoundEnabled()) creative.uiTone('success');
    } catch (error) {
      flash(error.message);
    } finally {
      commandPending = false;
    }
  }

  async function sendCommand(command) {
    if (!doorGameOpen || commandPending) return;
    commandPending = true;
    document.querySelectorAll('[data-game-command]').forEach((button) => { button.disabled = true; });
    try {
      const response = await games.api('command', { command });
      if (response.outcome) {
        showResult(response.outcome, response.score, response.profile);
      } else {
        renderDungeon(response.profile, response.run);
      }
      if (creative?.isSoundEnabled()) creative.uiTone(response.outcome === 'escaped' ? 'success' : 'menu');
    } catch (error) {
      flash(error.message);
      document.querySelectorAll('[data-game-command]').forEach((button) => { button.disabled = false; });
    } finally {
      commandPending = false;
    }
  }

  async function abandonRun() {
    if (commandPending) return;
    if (!window.confirm('Abandon this Packet Dungeon run? The score will be recorded as abandoned.')) return;
    commandPending = true;
    try {
      const response = await games.api('abandon');
      showResult('abandoned', response.score, response.profile);
    } catch (error) {
      flash(error.message);
    } finally {
      commandPending = false;
    }
  }

  function showResult(outcome, score, profile) {
    doorGameOpen = false;
    const escaped = outcome === 'escaped';
    const dead = outcome === 'dead';
    setStatus(escaped ? 'CARRIER RESTORED' : dead ? 'NO CARRIER' : 'RUN ABANDONED');
    renderShell(
      escaped ? 'Packet Dungeon Escaped' : dead ? 'Process Terminated' : 'Run Abandoned',
      `<pre class="ascii result-art">+----------------------------------------+
| ${escaped ? 'CARRIER RESTORED :: NODE ESCAPED' : dead ? 'NO CARRIER :: PROCESS TERMINATED' : 'REMOTE PROGRAM DISCONNECTED'} |
+----------------------------------------+</pre>
      <div class="final-score">SCORE ${Number(score) || 0}</div>
      ${games.profileStats(profile)}
      <div class="achievement-list">${games.achievementsHtml(profile)}</div>
      <div class="toolbar"><button id="resultDoors">Return to Door Games</button><button id="resultScores">Hall of Legends</button></div>`,
      navigation(),
    );
    bindNavigation();
    document.getElementById('resultDoors')?.addEventListener('click', showDoors);
    document.getElementById('resultScores')?.addEventListener('click', showHall);
  }

  async function showHall() {
    doorGameOpen = false;
    setStatus('HALL OF LEGENDS');
    renderShell('Hall of Legends', '<div class="empty">Reading score records...</div>', navigation());
    bindNavigation();
    try {
      const response = await games.api('leaderboard');
      renderShell(
        'Hall of Legends',
        `${doorHeader()}${games.leaderboardHtml(response.scores)}<div class="toolbar"><button id="hallDoors">Return to Door Games</button></div>`,
        navigation(),
      );
      bindNavigation();
      document.getElementById('hallDoors')?.addEventListener('click', showDoors);
    } catch (error) {
      flash(error.message);
    }
  }

  const originalNavigation = navigation;
  navigation = function doorNavigation() {
    const base = originalNavigation();
    return base.replace('<button data-nav="logout">', '<button data-nav="doors">[D]oors</button><button data-nav="logout">');
  };

  const originalGo = go;
  go = function doorGo(destination) {
    if (destination === 'doors') return showDoors();
    doorGameOpen = false;
    return originalGo(destination);
  };

  const originalHome = home;
  home = function doorHome() {
    doorGameOpen = false;
    originalHome();
    completeHomeMenu();
  };

  const originalLogout = logout;
  logout = async function doorLogout() {
    doorGameOpen = false;
    return originalLogout();
  };

  document.addEventListener('keydown', (event) => {
    if (!doorGameOpen || commandPending || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (event.key.toLowerCase() === 'q') {
      event.preventDefault();
      event.stopImmediatePropagation();
      showDoors();
      return;
    }
    const command = games.commandForKey(event);
    if (!command) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendCommand(command);
  }, true);
})();
