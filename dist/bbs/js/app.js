'use strict';

const API_ENDPOINT = 'https://rdvtghfbytigdxtjopbz.supabase.co/functions/v1/bbs';
const TOKEN_KEY = 'apt6pack-bbs-token';
const WELCOME_ART_URL = './ansi/welcome.txt';
const REQUEST_TIMEOUT_MS = 15000;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  board: null,
  thread: null,
};

const app = document.getElementById('app');
const stationStatus = document.getElementById('stationStatus');
const clock = document.getElementById('clock');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'unknown time' : parsed.toLocaleString();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function setStatus(message) {
  stationStatus.textContent = message;
}

function flash(message, type = 'error') {
  const element = document.getElementById('flash');
  if (!element) return;
  element.className = type;
  element.textContent = message || '';
}

function setSubmitting(form, submitting) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = submitting;
  button.dataset.originalText ||= button.textContent;
  button.textContent = submitting ? 'Transmitting...' : button.dataset.originalText;
}

async function api(action, data = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers,
      body: JSON.stringify({ action, ...data }),
      signal: controller.signal,
    });

    let output = {};
    try {
      output = await response.json();
    } catch {
      throw new Error('The station returned an unreadable response.');
    }

    if (!response.ok) throw new Error(output.error || 'Connection failed.');
    return output;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The station timed out. Try again.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderShell(title, body, buttons = '') {
  app.innerHTML = `
    <section class="panel">
      <div class="toolbar">${buttons}</div>
      <h1>${escapeHtml(title)}</h1>
      <div id="flash" class="error"></div>
      ${body}
    </section>
  `;
}

function navigation() {
  if (!state.user) return '';
  return [
    '<button data-nav="home">[H]ome</button>',
    '<button data-nav="boards">[M]essages</button>',
    '<button data-nav="files">[F]iles</button>',
    '<button data-nav="online">[W]ho</button>',
    state.user.role === 'sysop' ? '<button data-nav="invites">[I]nvites</button>' : '',
    '<button data-nav="logout">[G]oodbye</button>',
  ].join('');
}

function bindNavigation() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.nav));
  });
}

async function loadWelcomeArt() {
  try {
    const response = await fetch(WELCOME_ART_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('Welcome art unavailable.');
    return await response.text();
  } catch {
    return [
      '+------------------------------------------------------+',
      '|              A P T 6 P A C K  B B S                 |',
      '|          PRIVATE ACCESS :: INVITE REQUIRED           |',
      '+------------------------------------------------------+',
    ].join('\n');
  }
}

async function boot() {
  setStatus('CONNECT 14400');
  app.innerHTML = `
    <section class="panel">
      <pre id="welcomeArt" class="ascii"></pre>
      <p class="muted">Carrier detected. Negotiating secure session...</p>
    </section>
  `;
  document.getElementById('welcomeArt').textContent = await loadWelcomeArt();
  window.setTimeout(checkSession, 350);
}

async function checkSession() {
  if (!state.token) {
    renderAuth();
    return;
  }

  try {
    const response = await api('me');
    state.user = response.user;
    home();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    state.user = null;
    renderAuth();
  }
}

function renderAuth(mode = 'login') {
  setStatus('AWAITING AUTH');
  const joining = mode === 'join';

  renderShell(
    joining ? 'New Caller Registration' : 'Caller Login',
    `
      <div class="tabs">
        <button id="loginTab" class="${joining ? '' : 'active'}">Login</button>
        <button id="joinTab" class="${joining ? 'active' : ''}">Join with Invite</button>
      </div>
      <form id="authForm">
        <label for="handle">Handle</label>
        <input id="handle" name="handle" autocomplete="username" maxlength="24" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="${joining ? 'new-password' : 'current-password'}" minlength="12" maxlength="128" required>
        ${joining ? '<label for="inviteCode">Invite code</label><input id="inviteCode" name="inviteCode" autocomplete="off" maxlength="160" required>' : ''}
        <p class="muted">${joining ? 'Registration is restricted to invited callers.' : 'Only registered callers can access board contents.'}</p>
        <button type="submit">${joining ? 'Create account' : 'Connect'}</button>
      </form>
    `,
  );

  document.getElementById('loginTab').addEventListener('click', () => renderAuth('login'));
  document.getElementById('joinTab').addEventListener('click', () => renderAuth('join'));
  document.getElementById('handle').focus();

  document.getElementById('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    flash('');
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSubmitting(form, true);

    try {
      const response = await api(joining ? 'register' : 'login', {
        handle: formData.get('handle'),
        password: formData.get('password'),
        inviteCode: formData.get('inviteCode'),
      });
      state.token = response.token;
      state.user = response.user;
      localStorage.setItem(TOKEN_KEY, response.token);
      home();
    } catch (error) {
      flash(error.message);
    } finally {
      setSubmitting(form, false);
    }
  });
}

function home() {
  if (!state.user) {
    renderAuth();
    return;
  }

  setStatus(`${state.user.handle} :: ${state.user.role.toUpperCase()}`);
  renderShell(
    'Main Menu',
    `
      <pre class="ascii">[M] MESSAGE BOARDS     [F] FILE AREAS
[W] WHO'S ONLINE       ${state.user.role === 'sysop' ? '[I] INVITES' : '           '}
[G] LOG OFF</pre>
      <p>Welcome back, <strong>${escapeHtml(state.user.handle)}</strong>. This is a private, invite-only node. Activity is visible only to authenticated callers.</p>
      <p class="muted">Keyboard shortcuts work whenever you are not typing in a form.</p>
    `,
    navigation(),
  );
  bindNavigation();
}

async function showBoards() {
  if (!state.user) return renderAuth();
  setStatus('READING MESSAGE BASE');
  renderShell('Message Boards', '<p id="loadingMessage" class="muted">Loading board directory...</p>', navigation());
  bindNavigation();

  try {
    const response = await api('boards');
    const boards = Array.isArray(response.boards) ? response.boards : [];
    const html = boards.length
      ? `<div class="grid">${boards.map((board) => `
          <article class="card" tabindex="0" data-board="${escapeHtml(board.slug)}">
            <div class="subject">${escapeHtml(board.name)}${board.read_only ? '<span class="badge">READ ONLY</span>' : ''}</div>
            <p>${escapeHtml(board.description)}</p>
            <div class="meta">${Number(board.threadCount) || 0} threads :: ${Number(board.postCount) || 0} messages</div>
          </article>
        `).join('')}</div>`
      : '<div class="empty">No message boards are available.</div>';

    document.getElementById('loadingMessage')?.remove();
    document.querySelector('.panel').insertAdjacentHTML('beforeend', html);
    document.querySelectorAll('[data-board]').forEach((card) => {
      card.addEventListener('click', () => openBoard(card.dataset.board));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openBoard(card.dataset.board);
        }
      });
    });
  } catch (error) {
    flash(error.message);
  }
}

async function openBoard(slug) {
  if (!state.user) return renderAuth();
  setStatus(`BOARD ${String(slug).toUpperCase()}`);
  renderShell(
    'Board',
    '<p id="loadingMessage" class="muted">Loading threads...</p>',
    `${navigation()}<button id="backBoards">Back to boards</button>`,
  );
  bindNavigation();
  document.getElementById('backBoards').addEventListener('click', showBoards);

  try {
    const response = await api('threads', { board: slug });
    state.board = response.board;
    const threads = Array.isArray(response.threads) ? response.threads : [];
    let html = `<h2>${escapeHtml(response.board.name)}</h2><p class="muted">${escapeHtml(response.board.description)}</p>`;

    if (!threads.length) html += '<div class="empty">No messages yet.</div>';

    for (const thread of threads) {
      const author = Array.isArray(thread.author) ? thread.author[0] : thread.author;
      const count = Array.isArray(thread.posts) && thread.posts[0] ? Number(thread.posts[0].count) || 0 : 0;
      html += `
        <article class="card" tabindex="0" data-thread="${escapeHtml(thread.id)}">
          <div class="row">
            <div>
              <div class="subject">${thread.pinned ? '[PIN] ' : ''}${escapeHtml(thread.subject)}${thread.locked ? '<span class="badge">LOCKED</span>' : ''}</div>
              <div class="meta">by ${escapeHtml(author?.handle || 'unknown')} :: updated ${formatDate(thread.updated_at)}</div>
            </div>
            <div class="meta">${count} posts</div>
          </div>
        </article>
      `;
    }

    const canCreate = !response.board.read_only || ['moderator', 'sysop'].includes(state.user.role);
    if (canCreate) {
      html += `
        <h2>New Thread</h2>
        <form id="threadForm">
          <label for="threadSubject">Subject</label>
          <input id="threadSubject" name="subject" maxlength="120" required>
          <label for="threadBody">Message</label>
          <textarea id="threadBody" name="body" maxlength="10000" required></textarea>
          <button type="submit">Post message</button>
        </form>
      `;
    }

    document.getElementById('loadingMessage')?.remove();
    document.querySelector('.panel').insertAdjacentHTML('beforeend', html);

    document.querySelectorAll('[data-thread]').forEach((card) => {
      card.addEventListener('click', () => openThread(card.dataset.thread));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openThread(card.dataset.thread);
        }
      });
    });

    const form = document.getElementById('threadForm');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        setSubmitting(form, true);
        try {
          const created = await api('create_thread', {
            boardId: response.board.id,
            subject: formData.get('subject'),
            body: formData.get('body'),
          });
          await openThread(created.threadId);
        } catch (error) {
          flash(error.message);
        } finally {
          setSubmitting(form, false);
        }
      });
    }
  } catch (error) {
    flash(error.message);
  }
}

async function openThread(id) {
  if (!state.user) return renderAuth();
  setStatus('READING THREAD');
  renderShell(
    'Thread',
    '<p id="loadingMessage" class="muted">Loading messages...</p>',
    `${navigation()}<button id="backBoard">Back to board</button>`,
  );
  bindNavigation();
  document.getElementById('backBoard').addEventListener('click', () => openBoard(state.board?.slug || 'general'));

  try {
    const response = await api('thread', { threadId: id });
    state.thread = response.thread;
    const board = Array.isArray(response.thread.board) ? response.thread.board[0] : response.thread.board;
    state.board = board;
    const posts = Array.isArray(response.posts) ? response.posts : [];
    let html = `<h2>${escapeHtml(response.thread.subject)}</h2>`;

    for (const post of posts) {
      const author = Array.isArray(post.author) ? post.author[0] : post.author;
      const roleBadge = author?.role && author.role !== 'user'
        ? `<span class="badge">${escapeHtml(author.role.toUpperCase())}</span>`
        : '';
      html += `
        <article class="post">
          <div class="row">
            <strong>${escapeHtml(author?.handle || 'unknown')}${roleBadge}</strong>
            <span class="meta">${formatDate(post.created_at)}</span>
          </div>
          <div class="post-body">${escapeHtml(post.body)}</div>
        </article>
      `;
    }

    const canReply = !response.thread.locked && (!board.read_only || ['moderator', 'sysop'].includes(state.user.role));
    if (canReply) {
      html += `
        <h2>Reply</h2>
        <form id="replyForm">
          <label for="replyBody">Message</label>
          <textarea id="replyBody" name="body" maxlength="10000" required></textarea>
          <button type="submit">Transmit reply</button>
        </form>
      `;
    } else {
      html += '<p class="warning">Replies are disabled for this thread.</p>';
    }

    document.getElementById('loadingMessage')?.remove();
    document.querySelector('.panel').insertAdjacentHTML('beforeend', html);

    const form = document.getElementById('replyForm');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        setSubmitting(form, true);
        try {
          await api('reply', { threadId: id, body: formData.get('body') });
          await openThread(id);
        } catch (error) {
          flash(error.message);
        } finally {
          setSubmitting(form, false);
        }
      });
    }
  } catch (error) {
    flash(error.message);
  }
}

async function showFiles() {
  if (!state.user) return renderAuth();
  setStatus('FILE AREA');
  renderShell('File Areas', '<p id="loadingMessage" class="muted">Loading file directory...</p>', navigation());
  bindNavigation();

  try {
    const response = await api('files');
    const files = Array.isArray(response.files) ? response.files : [];
    const html = files.length
      ? `<div class="grid">${files.map((file) => {
          const url = safeExternalUrl(file.url);
          return `
            <article class="card">
              <div class="subject">${escapeHtml(file.name)}<span class="badge">${escapeHtml(String(file.category || 'file').toUpperCase())}</span></div>
              <p>${escapeHtml(file.description)}</p>
              ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open file record -&gt;</a>` : '<span class="warning">Invalid file link</span>'}
            </article>
          `;
        }).join('')}</div>`
      : '<div class="empty">No files are available.</div>';

    document.getElementById('loadingMessage')?.remove();
    document.querySelector('.panel').insertAdjacentHTML('beforeend', html);
  } catch (error) {
    flash(error.message);
  }
}

async function showOnline() {
  if (!state.user) return renderAuth();
  setStatus('WHO IS ONLINE');
  renderShell("Who's Online", '<p id="loadingMessage" class="muted">Checking active callers...</p>', navigation());
  bindNavigation();

  try {
    const response = await api('online');
    const users = Array.isArray(response.users) ? response.users : [];
    const html = users.length
      ? `<div class="grid">${users.map((user) => `
          <article class="card">
            <div class="subject">${escapeHtml(user.handle)}${user.role !== 'user' ? `<span class="badge">${escapeHtml(String(user.role).toUpperCase())}</span>` : ''}</div>
            <div class="meta">Last activity ${formatDate(user.last_seen_at)}</div>
          </article>
        `).join('')}</div>`
      : '<div class="empty">No other callers detected.</div>';

    document.getElementById('loadingMessage')?.remove();
    document.querySelector('.panel').insertAdjacentHTML('beforeend', html);
  } catch (error) {
    flash(error.message);
  }
}

async function showInvites() {
  if (state.user?.role !== 'sysop') {
    home();
    return;
  }

  setStatus('SYSOP INVITE CONTROL');
  renderShell(
    'Invite Control',
    `
      <form id="inviteForm">
        <label for="inviteLabel">Friend / label</label>
        <input id="inviteLabel" name="label" maxlength="100" placeholder="Who this invite is for">
        <div class="grid">
          <div>
            <label for="inviteUses">Uses</label>
            <input id="inviteUses" name="uses" type="number" min="1" max="20" value="1">
          </div>
          <div>
            <label for="inviteDays">Expires in days</label>
            <input id="inviteDays" name="expiresDays" type="number" min="1" max="365" value="30">
          </div>
        </div>
        <label for="inviteRole">Role</label>
        <select id="inviteRole" name="roleGrant">
          <option value="user">Caller</option>
          <option value="moderator">Moderator</option>
        </select>
        <button type="submit">Generate invite</button>
      </form>
      <div id="newInvite"></div>
      <h2>Issued Invites</h2>
      <div id="inviteList" class="muted">Loading...</div>
    `,
    navigation(),
  );
  bindNavigation();

  async function loadInvites() {
    try {
      const response = await api('invites');
      const invites = Array.isArray(response.invites) ? response.invites : [];
      const box = document.getElementById('inviteList');
      if (!invites.length) {
        box.innerHTML = '<div class="empty">No invites issued.</div>';
        return;
      }

      box.innerHTML = invites.map((invite) => `
        <article class="card">
          <div class="row">
            <div>
              <div class="subject">${escapeHtml(invite.label || 'Unlabeled invite')}<span class="badge">${escapeHtml(String(invite.role_grant).toUpperCase())}</span></div>
              <div class="meta">${Number(invite.uses_remaining) || 0} uses left :: expires ${formatDate(invite.expires_at)}</div>
            </div>
            ${invite.uses_remaining ? `<button class="danger" data-revoke="${escapeHtml(invite.id)}">Revoke</button>` : '<span class="meta">CLOSED</span>'}
          </div>
        </article>
      `).join('');

      box.querySelectorAll('[data-revoke]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await api('revoke_invite', { inviteId: button.dataset.revoke });
            await loadInvites();
          } catch (error) {
            flash(error.message);
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      flash(error.message);
    }
  }

  const form = document.getElementById('inviteForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    setSubmitting(form, true);

    try {
      const response = await api('create_invite', {
        label: formData.get('label'),
        uses: formData.get('uses'),
        expiresDays: formData.get('expiresDays'),
        roleGrant: formData.get('roleGrant'),
      });
      document.getElementById('newInvite').innerHTML = `
        <h2>New Invite</h2>
        <p class="warning">This code is shown once. Send it privately.</p>
        <div class="modal-code">${escapeHtml(response.code)}</div>
      `;
      await loadInvites();
    } catch (error) {
      flash(error.message);
    } finally {
      setSubmitting(form, false);
    }
  });

  await loadInvites();
}

async function logout() {
  try {
    await api('logout');
  } catch {
    // Local logout must still complete if the remote session is unavailable.
  }
  state.token = '';
  state.user = null;
  state.board = null;
  state.thread = null;
  localStorage.removeItem(TOKEN_KEY);
  renderAuth();
}

function go(destination) {
  if (destination === 'home') home();
  else if (destination === 'boards') showBoards();
  else if (destination === 'files') showFiles();
  else if (destination === 'online') showOnline();
  else if (destination === 'invites') showInvites();
  else if (destination === 'logout') logout();
}

document.addEventListener('keydown', (event) => {
  if (!state.user) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

  const key = event.key.toLowerCase();
  if (key === 'h') home();
  else if (key === 'm') showBoards();
  else if (key === 'f') showFiles();
  else if (key === 'w') showOnline();
  else if (key === 'i' && state.user.role === 'sysop') showInvites();
  else if (key === 'g') logout();
});

function updateClock() {
  clock.textContent = new Date().toLocaleString();
}

updateClock();
window.setInterval(updateClock, 1000);
boot();
