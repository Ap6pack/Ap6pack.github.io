document.addEventListener('DOMContentLoaded', function () {
  loadStats();
  loadSamples();
});

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fillTable(tbodyId, rows, renderRow) {
  const tbody = document.querySelector('#' + tbodyId + ' tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">No data yet - check back after the next daily sync.</td></tr>';
    return;
  }
  rows.forEach(function (row) {
    const tr = document.createElement('tr');
    tr.innerHTML = renderRow(row);
    tbody.appendChild(tr);
  });
}

function loadStats() {
  fetch('data/stats.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (stats) {
      document.getElementById('stat-ips').textContent = stats.unique_source_ips ?? '0';
      document.getElementById('stat-logins').textContent = stats.login_attempts ?? '0';
      document.getElementById('stat-commands').textContent = stats.commands_run ?? '0';
      document.getElementById('stat-samples').textContent = stats.files_captured ?? '0';

      const updated = stats.generated_at ? new Date(stats.generated_at).toLocaleString() : 'unknown';
      document.getElementById('last-updated').textContent = 'Last synced: ' + updated;

      fillTable('usernames-table', stats.top_usernames, function (row) {
        return '<td><code>' + escapeHtml(row[0]) + '</code></td><td>' + row[1] + '</td>';
      });
      fillTable('passwords-table', stats.top_passwords, function (row) {
        return '<td><code>' + escapeHtml(row[0]) + '</code></td><td>' + row[1] + '</td>';
      });
    })
    .catch(function () {
      document.getElementById('last-updated').textContent = 'Stats not available yet.';
    });
}

function loadSamples() {
  fetch('data/manifest.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (samples) {
      const tbody = document.querySelector('#samples-table tbody');
      if (!samples || samples.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No samples captured yet.</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      samples.forEach(function (s) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td><code>' + escapeHtml(s.sha256) + '</code></td>' +
          '<td>' + humanSize(s.size) + '</td>' +
          '<td><a class="btn" href="data/samples/' + encodeURIComponent(s.zip) + '">Download .zip</a></td>';
        tbody.appendChild(tr);
      });
    })
    .catch(function () {
      document.querySelector('#samples-table tbody').innerHTML = '<tr><td colspan="3">Sample list not available yet.</td></tr>';
    });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
