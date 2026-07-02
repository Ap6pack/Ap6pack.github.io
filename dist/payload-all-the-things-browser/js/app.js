document.getElementById('current-year').textContent = new Date().getFullYear();

(function () {
    "use strict";

    var OWNER = "swisskyrepo";
    var REPO = "PayloadsAllTheThings";
    var BRANCH = "master";
    var TREE_API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/git/trees/" + BRANCH + "?recursive=1";
    var RAW_BASE = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/";
    var BLOB_BASE = "https://github.com/" + OWNER + "/" + REPO + "/blob/" + BRANCH + "/";
    var FILE_PATTERN = /\.(md|txt|py|fuzz|yaml|yml)$/i;

    var searchInput = document.getElementById("pb-search");
    var searchClearBtn = document.getElementById("pb-search-clear");
    var statusEl = document.getElementById("pb-status");
    var sidebarListEl = document.getElementById("pb-sidebar-list");
    var contentEl = document.getElementById("pb-content");
    var themeToggleBtn = document.getElementById("pb-theme-toggle");
    var themeIcon = document.getElementById("pb-theme-icon");

    var files = [];
    var activeLink = null;
    var debounceTimer = null;
    var miniSearch = null;
    var pendingPath = null;
    var pendingQuery = null;
    var prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (typeof marked !== "undefined" && typeof markedGfmHeadingId !== "undefined") {
        marked.use(markedGfmHeadingId.gfmHeadingId());
    }

    // ---------- Theme toggle ----------

    function currentEffectiveTheme() {
        var stored = null;
        try { stored = localStorage.getItem("pb-theme"); } catch (e) {}
        if (stored === "dark" || stored === "light") return stored;
        return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }

    function updateThemeIcon() {
        themeIcon.className = currentEffectiveTheme() === "dark" ? "fas fa-sun" : "fas fa-moon";
    }

    function toggleTheme() {
        var next = currentEffectiveTheme() === "dark" ? "light" : "dark";
        try { localStorage.setItem("pb-theme", next); } catch (e) {}
        document.documentElement.setAttribute("data-theme", next);
        updateThemeIcon();
    }

    themeToggleBtn.addEventListener("click", toggleTheme);
    updateThemeIcon();

    // ---------- URL state (deep linking) ----------

    function updateUrl(params, push) {
        var url = new URL(location.href);
        Object.keys(params).forEach(function (key) {
            var val = params[key];
            if (val === null || val === undefined || val === "") url.searchParams.delete(key);
            else url.searchParams.set(key, val);
        });
        url.hash = "";
        history[push ? "pushState" : "replaceState"](null, "", url.toString());
    }

    // ---------- Rendering helpers ----------

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function categoryOf(path) {
        var parts = path.split("/");
        return parts.length > 1 ? parts[0] : "Root";
    }

    function groupByCategory(list) {
        var groups = {};
        list.forEach(function (f) {
            var cat = categoryOf(f.path);
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(f);
        });
        return groups;
    }

    function skeletonHtml(lines) {
        var widths = ["55%", "90%", "70%", "85%", "40%"];
        var html = "";
        for (var i = 0; i < lines; i++) {
            html += '<div class="pb-skeleton pb-skeleton-line" style="width:' + widths[i % widths.length] + '"></div>';
        }
        return html;
    }

    function renderSidebar(query) {
        var q = (query || "").trim().toLowerCase();
        var matches = q
            ? files.filter(function (f) { return f.path.toLowerCase().indexOf(q) !== -1; })
            : files;

        sidebarListEl.innerHTML = "";

        if (matches.length === 0) {
            var empty = document.createElement("p");
            empty.className = "pb-empty";
            empty.textContent = "No files match \"" + query + "\".";
            sidebarListEl.appendChild(empty);
            statusEl.textContent = "Filename match: 0 of " + files.length;
            return;
        }

        var groups = groupByCategory(matches);
        var categoryNames = Object.keys(groups).sort();

        categoryNames.forEach(function (cat) {
            var details = document.createElement("details");
            details.className = "pb-category";
            details.dataset.category = cat;
            details.open = !!q;

            var summary = document.createElement("summary");
            summary.textContent = cat.replace(/[-_]/g, " ") + " (" + groups[cat].length + ")";
            details.appendChild(summary);

            var ul = document.createElement("ul");
            groups[cat].forEach(function (f) {
                var li = document.createElement("li");
                var a = document.createElement("a");
                a.href = "#";
                a.textContent = f.path.split("/").slice(1).join("/") || f.path;
                a.title = f.path;
                a.dataset.path = f.path;
                a.addEventListener("click", function (evt) {
                    evt.preventDefault();
                    loadFile(f.path, a, { updateUrl: true });
                });
                li.appendChild(a);
                ul.appendChild(li);
            });
            details.appendChild(ul);
            sidebarListEl.appendChild(details);
        });

        statusEl.textContent = q
            ? "Filename match: " + matches.length + " of " + files.length
            : "Browsing " + files.length + " files";
    }

    function renderFullTextResults(query) {
        var hits = miniSearch.search(query, { prefix: true, fuzzy: 0.2, boost: { title: 2 } });

        sidebarListEl.innerHTML = "";

        if (hits.length === 0) {
            var empty = document.createElement("p");
            empty.className = "pb-empty";
            empty.textContent = "No payloads match \"" + query + "\".";
            sidebarListEl.appendChild(empty);
            statusEl.textContent = "Full-text search: 0 results";
            return;
        }

        var ul = document.createElement("ul");
        ul.className = "pb-flat-results";
        hits.slice(0, 100).forEach(function (hit) {
            var li = document.createElement("li");
            var a = document.createElement("a");
            a.href = "#";
            a.textContent = hit.title || hit.path;
            a.title = hit.path;
            a.dataset.path = hit.path;
            a.addEventListener("click", function (evt) {
                evt.preventDefault();
                loadFile(hit.path, a, { updateUrl: true });
            });
            var small = document.createElement("div");
            small.className = "pb-result-path";
            small.textContent = hit.path;
            li.appendChild(a);
            li.appendChild(small);
            ul.appendChild(li);
        });
        sidebarListEl.appendChild(ul);

        statusEl.textContent = "Full-text search: " + hits.length + " result" + (hits.length === 1 ? "" : "s") +
            (hits.length > 100 ? " (showing top 100)" : "");
    }

    function runSearch(query) {
        var q = (query || "").trim();
        if (q && miniSearch) {
            renderFullTextResults(q);
        } else {
            renderSidebar(query || "");
        }
    }

    function loadSearchIndex() {
        if (typeof MiniSearch === "undefined") return;
        fetch("search-index.json")
            .then(function (res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.json();
            })
            .then(function (data) {
                miniSearch = new MiniSearch({
                    idField: "path",
                    fields: ["title", "body"],
                    storeFields: ["path", "title"]
                });
                miniSearch.addAll(data);
                searchInput.placeholder = "Search payload contents... (press /)";
                if (pendingQuery && searchInput.value.trim() === pendingQuery.trim()) {
                    renderFullTextResults(pendingQuery);
                }
                pendingQuery = null;
            })
            .catch(function () {
                // search-index.json not built yet (see build-index.js) -- filename search still works.
                pendingQuery = null;
            });
    }

    function resolveRelative(basePath, target) {
        // Bare "#slug" links are same-file heading anchors (e.g. a table of contents).
        // Leave them untouched -- headings get matching ids (see marked-gfm-heading-id
        // above) so the browser's native in-page anchor jump handles these directly.
        if (/^([a-z]+:)?\/\//i.test(target) || target.indexOf("#") === 0) return null;
        var baseDir = basePath.split("/").slice(0, -1);
        var targetParts = target.split("/");
        targetParts.forEach(function (part) {
            if (part === "." || part === "") return;
            if (part === "..") {
                baseDir.pop();
            } else {
                baseDir.push(part);
            }
        });
        return baseDir.join("/");
    }

    function fixRelativeLinks(root, basePath) {
        root.querySelectorAll("img[src]").forEach(function (img) {
            var resolved = resolveRelative(basePath, img.getAttribute("src"));
            if (resolved) img.src = RAW_BASE + resolved;
        });
        root.querySelectorAll("a[href]").forEach(function (a) {
            var href = a.getAttribute("href");
            var resolved = resolveRelative(basePath, href);
            if (resolved) {
                var hashIndex = resolved.indexOf("#");
                var resolvedPath = hashIndex === -1 ? resolved : resolved.slice(0, hashIndex);
                var resolvedFragment = hashIndex === -1 ? "" : resolved.slice(hashIndex);
                if (resolvedFragment && resolvedPath === basePath) {
                    // Same file as the one currently displayed, just written with an
                    // explicit filename (common in this repo's own tables of contents)
                    // instead of a bare "#slug". Keep it as a native in-page anchor.
                    a.href = resolvedFragment;
                } else {
                    a.href = BLOB_BASE + resolved;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                }
            } else if (/^https?:\/\//i.test(href)) {
                a.target = "_blank";
                a.rel = "noopener noreferrer";
            }
        });
    }

    function attachCopyButtons(root) {
        root.querySelectorAll("pre").forEach(function (pre) {
            if (pre.querySelector(".pb-copy-btn")) return;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pb-copy-btn";
            btn.textContent = "Copy";
            btn.addEventListener("click", function () {
                var code = pre.querySelector("code") || pre;
                var text = code.textContent;
                navigator.clipboard.writeText(text).then(function () {
                    btn.textContent = "Copied!";
                    setTimeout(function () { btn.textContent = "Copy"; }, 1500);
                }, function () {
                    btn.textContent = "Failed";
                    setTimeout(function () { btn.textContent = "Copy"; }, 1500);
                });
            });
            pre.style.position = "relative";
            pre.appendChild(btn);
        });
    }

    function renderError(err, context) {
        var message;
        if (err && err.status === 403) {
            message = "GitHub API rate limit reached (60 requests/hour for unauthenticated use). Please wait a bit and try again.";
        } else if (err && err.status) {
            message = "GitHub returned an error (HTTP " + err.status + ") while " + context + ".";
        } else if (err instanceof TypeError) {
            message = "Network request blocked or failed while " + context + ". If you opened this file directly (file://), serve it from an http(s) origin instead. A browser extension may also be blocking api.github.com/raw.githubusercontent.com.";
        } else {
            message = "Unexpected error while " + context + ": " + (err && err.message ? err.message : err);
        }
        return message;
    }

    function findLinkForPath(path) {
        var els = sidebarListEl.querySelectorAll("a[data-path]");
        for (var i = 0; i < els.length; i++) {
            if (els[i].dataset.path === path) return els[i];
        }
        return null;
    }

    function loadFile(path, linkEl, opts) {
        opts = opts || {};

        if (activeLink) activeLink.classList.remove("active");
        if (linkEl) {
            linkEl.classList.add("active");
            activeLink = linkEl;
        } else {
            activeLink = null;
        }

        contentEl.innerHTML = '<div class="pb-status" style="margin-bottom:1rem;"><span class="pb-spinner"></span>Loading ' +
            escapeHtml(path) + '&hellip;</div>' + skeletonHtml(4);

        fetch(RAW_BASE + path)
            .then(function (res) {
                if (!res.ok) {
                    var err = new Error("HTTP " + res.status);
                    err.status = res.status;
                    throw err;
                }
                return res.text();
            })
            .then(function (text) {
                var isMarkdown = /\.md$/i.test(path);
                var html;
                if (isMarkdown) {
                    html = DOMPurify.sanitize(marked.parse(text));
                } else {
                    html = '<pre><code>' + escapeHtml(text) + '</code></pre>';
                }
                contentEl.innerHTML =
                    '<h2>' + escapeHtml(path) + '</h2>' +
                    '<p><a href="' + BLOB_BASE + path + '" target="_blank" rel="noopener noreferrer">View on GitHub</a></p>' +
                    html;
                fixRelativeLinks(contentEl, path);
                attachCopyButtons(contentEl);

                if (opts.updateUrl) {
                    updateUrl({ path: path }, true);
                }

                if (opts.hash) {
                    var target = document.getElementById(opts.hash.replace(/^#/, ""));
                    if (target) {
                        requestAnimationFrame(function () {
                            target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
                        });
                    }
                }
            })
            .catch(function (err) {
                contentEl.innerHTML = '<p class="pb-error">' + escapeHtml(renderError(err, "loading this file")) + '</p>';
            });
    }

    function openFileFromDeepLink(path, hash, updateUrlAfter) {
        var found = files.some(function (f) { return f.path === path; });
        if (!found) {
            renderSidebar("");
            return;
        }
        renderSidebar("");
        var linkEl = findLinkForPath(path);
        if (linkEl) {
            var details = linkEl.closest("details");
            if (details) details.open = true;
        }
        loadFile(path, linkEl, { updateUrl: !!updateUrlAfter, hash: hash });
    }

    function goHome(push) {
        clearTimeout(debounceTimer);
        searchInput.value = "";
        searchClearBtn.hidden = true;
        activeLink = null;
        renderSidebar("");
        contentEl.innerHTML = '<p class="pb-empty">Select a file from the sidebar to view its payloads.</p>';
        if (push !== false) updateUrl({ path: null, q: null }, true);
    }

    function clearSearch() {
        clearTimeout(debounceTimer);
        searchInput.value = "";
        searchClearBtn.hidden = true;
        renderSidebar("");
        updateUrl({ q: null }, false);
    }

    function init() {
        fetch(TREE_API)
            .then(function (res) {
                if (!res.ok) {
                    var err = new Error("HTTP " + res.status);
                    err.status = res.status;
                    throw err;
                }
                return res.json();
            })
            .then(function (data) {
                files = (data.tree || []).filter(function (node) {
                    return node.type === "blob" && FILE_PATTERN.test(node.path);
                });
                if (files.length === 0) {
                    statusEl.textContent = "No indexable files found.";
                    return;
                }

                if (pendingPath) {
                    openFileFromDeepLink(pendingPath, location.hash, false);
                    pendingPath = null;
                } else if (pendingQuery) {
                    searchInput.value = pendingQuery;
                    searchClearBtn.hidden = false;
                    runSearch(pendingQuery);
                } else {
                    renderSidebar("");
                }
            })
            .catch(function (err) {
                statusEl.innerHTML = '<span class="pb-error">' + escapeHtml(renderError(err, "loading the file tree")) + '</span>';
            });
    }

    // ---------- Event wiring ----------

    searchInput.addEventListener("input", function (e) {
        clearTimeout(debounceTimer);
        var value = e.target.value;
        searchClearBtn.hidden = !value;
        debounceTimer = setTimeout(function () {
            runSearch(value);
            updateUrl({ q: value.trim() || null }, false);
        }, 120);
    });

    searchClearBtn.addEventListener("click", function () {
        clearSearch();
        searchInput.focus();
    });

    document.getElementById("pb-home-btn").addEventListener("click", function () { goHome(true); });
    document.getElementById("pb-home-link").addEventListener("click", function () { goHome(true); });

    document.addEventListener("keydown", function (e) {
        var tag = (e.target && e.target.tagName || "").toLowerCase();
        var typing = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
        if (e.key === "/" && !typing) {
            e.preventDefault();
            searchInput.focus();
        } else if (e.key === "Escape" && (document.activeElement === searchInput || searchInput.value)) {
            clearSearch();
            searchInput.blur();
        }
    });

    window.addEventListener("popstate", function () {
        var params = new URLSearchParams(location.search);
        var path = params.get("path");
        var q = params.get("q");

        clearTimeout(debounceTimer);
        if (path) {
            searchInput.value = q || "";
            searchClearBtn.hidden = !q;
            openFileFromDeepLink(path, location.hash, false);
            if (q) runSearch(q);
        } else if (q) {
            searchInput.value = q;
            searchClearBtn.hidden = false;
            activeLink = null;
            contentEl.innerHTML = '<p class="pb-empty">Select a file from the sidebar to view its payloads.</p>';
            runSearch(q);
        } else {
            goHome(false);
        }
    });

    // ---------- Boot ----------

    (function parseInitialUrl() {
        var params = new URLSearchParams(location.search);
        var path = params.get("path");
        var q = params.get("q");
        if (path) pendingPath = path;
        else if (q) pendingQuery = q;
    })();

    init();
    loadSearchIndex();
})();