'use strict';

(() => {
  const adventure = window.BbsAdventure;
  const games = window.BbsGames;
  const creative = window.BbsCreative;
  let adventureOpen = false;
  let commandPending = false;
  let cardCheckPending = false;

  function returnToDoors() {
    adventureOpen = false;
    document.querySelector('[data-nav="doors"]')?.click();
  }

  function storyHeader() {
    return `<pre class="ascii screen-art lost-node-banner">+------------------------------------------------------------------------------+
| THE LOST NODE :: CHAPTER ONE :: CARRIER GHOST                                |
| COMMAND-DRIVEN ADVENTURE :: AUTO-SAVE :: THREE ENDINGS                       |
+------------------------------------------------------------------------------+</pre>`;
  }

  function quickCommands(view) {
    const exits = Array.isArray(view?.room?.exits) ? view.room.exits : [];
    const directionButtons = exits.map((direction) => `<button type="button" data-adventure-command="${adventure.escapeHtml(direction)}">${adventure.escapeHtml(direction.toUpperCase())}</button>`).join('');
    return `<div class="adventure-quick">
      ${directionButtons}
      <button type="button" data-adventure-command="look">LOOK</button>
      <button type="button" data-adventure-command="inventory">INVENTORY</button>
      <button type="button" data-adventure-command="listen">LISTEN</button>
      <button type="button" data-adventure-command="hint">HINT</button>
      <button type="button" data-adventure-command="help">HELP</button>
    </div>`;
  }

  function renderAdventure(profile, view) {
    adventureOpen = true;
    setStatus(`THE LOST NODE :: ${String(view?.room?.title || 'UNKNOWN').toUpperCase()}`);
    renderShell(
      'The Lost Node',
      `${storyHeader()}
      ${adventure.storyStats(view, profile)}
      <section class="adventure-room">
        <div class="subject">${adventure.escapeHtml(view?.room?.title || 'Unknown location')}</div>
        <p>${adventure.escapeHtml(view?.room?.description || '')}</p>
        <div class="meta">EXITS: ${adventure.escapeHtml((view?.room?.exits || []).join(', ').toUpperCase() || 'NONE')}</div>
        <div class="meta">VISIBLE: ${adventure.escapeHtml((view?.room?.objects || []).join(', ').toUpperCase() || 'NOTHING')}</div>
      </section>
      <div id="adventureTranscript" class="adventure-transcript" aria-live="polite">${adventure.transcriptHtml(view)}</div>
      <form id="adventureForm" class="adventure-prompt" autocomplete="off">
        <label for="adventureCommand">COMMAND</label>
        <div class="adventure-input-row"><span>&gt;</span><input id="adventureCommand" name="command" maxlength="100" spellcheck="false" autocapitalize="none" required><button type="submit">SEND</button></div>
      </form>
      ${quickCommands(view)}
      <div class="adventure-inventory"><span class="meta">INVENTORY</span>${adventure.inventoryHtml(view)}</div>
      <div class="toolbar">
        <button id="lostNodeScores" type="button">Lost Node Legends</button>
        <button id="lostNodeDoors" type="button">Return to Door Games</button>
        <button id="abandonStory" type="button" class="danger">Abandon Story</button>
      </div>
      <p class="meta">Progress saves after every command. LOOK, HELP, INVENTORY, and HINT do not consume daily turns. Story actions do.</p>`,
      navigation(),
    );
    bindNavigation();

    const form = document.getElementById('adventureForm');
    const input = document.getElementById('adventureCommand');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const command = input?.value.trim() || '';
      if (!command) return;
      if (input) input.value = '';
      await sendCommand(command);
    });
    document.querySelectorAll('[data-adventure-command]').forEach((button) => {
      button.addEventListener('click', () => sendCommand(button.dataset.adventureCommand));
    });
    document.getElementById('lostNodeScores')?.addEventListener('click', showAdventureHall);
    document.getElementById('lostNodeDoors')?.addEventListener('click', returnToDoors);
    document.getElementById('abandonStory')?.addEventListener('click', abandonStory);

    const transcript = document.getElementById('adventureTranscript');
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    input?.focus();
  }

  async function enterAdventure() {
    if (commandPending) return;
    commandPending = true;
    try {
      const response = await adventure.api('start');
      renderAdventure(response.profile, response.view);
      if (creative?.isSoundEnabled()) creative.uiTone('success');
    } catch (error) {
      flash(error.message);
    } finally {
      commandPending = false;
    }
  }

  async function sendCommand(command) {
    if (!adventureOpen || commandPending) return;
    commandPending = true;
    document.querySelectorAll('[data-adventure-command], #adventureForm button').forEach((button) => { button.disabled = true; });
    try {
      const response = await adventure.api('command', { command });
      if (response.ending) showEnding(response);
      else renderAdventure(response.profile, response.view);
      if (creative?.isSoundEnabled()) creative.uiTone(response.ending ? 'success' : 'menu');
    } catch (error) {
      flash(error.message);
      document.querySelectorAll('[data-adventure-command], #adventureForm button').forEach((button) => { button.disabled = false; });
      document.getElementById('adventureCommand')?.focus();
    } finally {
      commandPending = false;
    }
  }

  async function abandonStory() {
    if (commandPending) return;
    if (!window.confirm('Abandon The Lost Node? Your current story score will be recorded as abandoned.')) return;
    commandPending = true;
    try {
      const response = await adventure.api('abandon');
      showEnding(response);
    } catch (error) {
      flash(error.message);
    } finally {
      commandPending = false;
    }
  }

  function endingCopy(ending) {
    if (ending === 'restored') return {
      title: 'The Lost Node Restored',
      status: 'CARRIER RESTORED',
      banner: 'CALLERS RESTORED :: GHOST RELEASED',
      text: 'The old message bases return one handle at a time. You inherit the station as its new Sysop.',
    };
    if (ending === 'purged') return {
      title: 'Clean Disconnect',
      status: 'NO CARRIER',
      banner: 'GHOST PURGED :: LINE CLOSED',
      text: 'The haunted process ends. The relay is silent, secure, and finally at rest.',
    };
    if (ending === 'joined') return {
      title: 'Ghost in the Machine',
      status: 'CARRIER FOREVER',
      banner: 'JOIN GHOST :: CARRIER FOREVER',
      text: 'Your handle joins GHOST in the carrier. Every future caller hears both of you answer.',
    };
    return {
      title: 'Call Abandoned',
      status: 'CALLER DROPPED',
      banner: 'CONNECTION CLOSED :: MYSTERY UNRESOLVED',
      text: 'The relay remains lost. You may dial it again when you are ready.',
    };
  }

  function showEnding(response) {
    adventureOpen = false;
    const copy = endingCopy(response.ending);
    setStatus(copy.status);
    renderShell(
      copy.title,
      `<pre class="ascii result-art">+------------------------------------------------------+
| ${adventure.escapeHtml(copy.banner.padEnd(52, ' ').slice(0, 52))} |
+------------------------------------------------------+</pre>
      <p>${adventure.escapeHtml(copy.text)}</p>
      <div class="final-score">SCORE ${Number(response.score) || 0}</div>
      ${games.profileStats(response.profile)}
      <h2>Door Game Achievements</h2>
      <div class="achievement-list">${games.achievementsHtml(response.profile)}</div>
      <div class="toolbar"><button id="endingDoors">Return to Door Games</button><button id="endingScores">Lost Node Legends</button><button id="redialNode">Dial Again</button></div>`,
      navigation(),
    );
    bindNavigation();
    document.getElementById('endingDoors')?.addEventListener('click', returnToDoors);
    document.getElementById('endingScores')?.addEventListener('click', showAdventureHall);
    document.getElementById('redialNode')?.addEventListener('click', enterAdventure);
  }

  async function showAdventureHall() {
    adventureOpen = false;
    setStatus('LOST NODE LEGENDS');
    renderShell('Lost Node Legends', '<div class="empty">Reading carrier records...</div>', navigation());
    bindNavigation();
    try {
      const response = await adventure.api('leaderboard');
      renderShell(
        'Lost Node Legends',
        `${storyHeader()}${adventure.leaderboardHtml(response.scores)}<div class="toolbar"><button id="adventureHallDoors">Return to Door Games</button><button id="adventureHallDial">Dial The Lost Node</button></div>`,
        navigation(),
      );
      bindNavigation();
      document.getElementById('adventureHallDoors')?.addEventListener('click', returnToDoors);
      document.getElementById('adventureHallDial')?.addEventListener('click', enterAdventure);
    } catch (error) {
      flash(error.message);
    }
  }

  async function enhanceLostNodeCard() {
    if (cardCheckPending || !state.user) return;
    const cards = Array.from(document.querySelectorAll('.door-card'));
    const card = cards.find((entry) => entry.querySelector('.subject')?.textContent.includes('The Lost Node'));
    if (!card || card.dataset.lostNodeReady === 'true') return;
    card.dataset.lostNodeReady = 'true';
    card.classList.remove('locked');
    const badge = card.querySelector('.badge');
    if (badge) badge.textContent = 'PLAYABLE';
    const paragraph = card.querySelector('p');
    if (paragraph) paragraph.textContent = 'Explore a vanished relay station through typed commands, solve its carrier puzzle, and choose one of three endings.';
    const button = card.querySelector('button');
    if (!button) return;
    button.disabled = false;
    button.id = 'lostNode';
    button.textContent = 'Dial The Lost Node';
    button.addEventListener('click', enterAdventure);

    cardCheckPending = true;
    try {
      const response = await adventure.api('profile');
      if (response.view) button.textContent = 'Continue saved story';
    } catch {
      // The main Door Games screen remains usable if this optional status check fails.
    } finally {
      cardCheckPending = false;
    }
  }

  const observer = new MutationObserver(() => enhanceLostNodeCard());
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  enhanceLostNodeCard();

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-nav]')) adventureOpen = false;
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!document.getElementById('adventureForm') || commandPending) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      returnToDoors();
    }
  }, true);
})();
