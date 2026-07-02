/* =========================================================================
   Payloads Browser — front-end for PayloadsAllTheThings.
   Live data from the GitHub API + raw CDN.
   ========================================================================= */

document.getElementById("current-year").textContent = new Date().getFullYear();

(function () {
    "use strict";

    var OWNER = "swisskyrepo";
    var REPO = "PayloadsAllTheThings";
    var BRANCH = "master";
    var TREE_API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/git/trees/" + BRANCH + "?recursive=1";
    var RAW_BASE = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/";
    var BLOB_BASE = "https://github.com/" + OWNER + "/" + REPO + "/blob/" + BRANCH + "/";
    var FILE_PATTERN = /\.(md|txt|py|fuzz|yaml|yml)$/i;

    // ---------- Elements ----------
    var searchInput = document.getElementById("pb-search");
    var searchClearBtn = document.getElementById("pb-search-clear");
    var kbdHint = document.getElementById("pb-kbd");
    var statusText = document.getElementById("pb-status-text");
    var statusSpinner = document.getElementById("pb-status-spinner");
    var sidebarListEl = document.getElementById("pb-sidebar-list");
    var contentEl = document.getElementById("pb-content");
    var themeToggleBtn = document.getElementById("pb-theme-toggle");

    var favBlock = document.getElementById("pb-fav-block");
    var favChips = document.getElementById("pb-fav-chips");
    var recentBlock = document.getElementById("pb-recent-block");
    var recentChips = document.getElementById("pb-recent-chips");

    var crumbbar = document.getElementById("pb-crumbbar");
    var crumbsEl = document.getElementById("pb-crumbs");
    var favBtn = document.getElementById("pb-fav-btn");
    var ghLink = document.getElementById("pb-gh-link");

    // ---------- State ----------
    var files = [];
    var activeLink = null;
    var debounceTimer = null;
    var miniSearch = null;
    var pendingPath = null;
    var pendingQuery = null;
    var currentPath = "";
    var gfmReady = false;
    var prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---------- Icons ----------
    var ICON = {
        sun: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line><line x1="4.9" y1="4.9" x2="7" y2="7"></line><line x1="17" y1="17" x2="19.1" y2="19.1"></line><line x1="4.9" y1="19.1" x2="7" y2="17"></line><line x1="17" y1="7" x2="19.1" y2="4.9"></line></svg>',
        moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>',
        starFilled: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        starOutline: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        starChip: '<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
        chev: '<svg class="pb-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>',
        terminal: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 9 12 4 17"></polyline><line x1="12" y1="17" x2="20" y2="17"></line></svg>'
    };

    // Register the GitHub heading-id extension lazily, right before the first
    // parse, so it never races the async CDN <script> load.
    function ensureGfm() {
        if (gfmReady) return;
        if (typeof marked !== "undefined" && typeof markedGfmHeadingId !== "undefined") {
            marked.use(markedGfmHeadingId.gfmHeadingId());
            gfmReady = true;
        }
    }

    // ---------- Storage (favorites + recents) ----------
    function readList(key) {
        try { var v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
    }
    function writeList(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }

    function pushRecent(path) {
        var arr = readList("pb-recents").filter(function (p) { return p !== path; });
        arr.unshift(path);
        writeList("pb-recents", arr.slice(0, 6));
    }
    function isFavorite(path) { return readList("pb-favorites").indexOf(path) !== -1; }
    function toggleFavorite(path) {
        var arr = readList("pb-favorites");
        var i = arr.indexOf(path);
        if (i === -1) arr.unshift(path); else arr.splice(i, 1);
        writeList("pb-favorites", arr.slice(0, 10));
    }

    function renderQuickLinks() {
        renderChips(favChips, favBlock, readList("pb-favorites"), true);
        renderChips(recentChips, recentBlock, readList("pb-recents"), false);
    }
    function renderChips(container, block, list, withStar) {
        container.innerHTML = "";
        if (!list.length) { block.hidden = true; return; }
        block.hidden = false;
        list.forEach(function (path) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pb-chip";
            btn.title = path;
            btn.innerHTML = (withStar ? ICON.starChip : "") + "<span>" + escapeHtml(path.split("/").pop()) + "</span>";
            btn.addEventListener("click", function () { loadFileByPath(path); });
            container.appendChild(btn);
        });
    }

    // ---------- Theme ----------
    function currentEffectiveTheme() {
        var stored = null;
        try { stored = localStorage.getItem("pb-theme"); } catch (e) {}
        if (stored === "dark" || stored === "light") return stored;
        return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    function updateThemeIcon() {
        themeToggleBtn.innerHTML = currentEffectiveTheme() === "dark" ? ICON.sun : ICON.moon;
    }
    function toggleTheme() {
        var next = currentEffectiveTheme() === "dark" ? "light" : "dark";
        try { localStorage.setItem("pb-theme", next); } catch (e) {}
        document.documentElement.setAttribute("data-theme", next);
        updateThemeIcon();
    }
    themeToggleBtn.addEventListener("click", toggleTheme);
    updateThemeIcon();

    // ---------- URL state ----------
    function updateUrl(params, push) {
        try {
            var url = new URL(location.href);
            Object.keys(params).forEach(function (key) {
                var val = params[key];
                if (val === null || val === undefined || val === "") url.searchParams.delete(key);
                else url.searchParams.set(key, val);
            });
            url.hash = "";
            history[push ? "pushState" : "replaceState"](null, "", url.toString());
        } catch (e) {}
    }

    // ---------- Helpers ----------
    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function categoryOf(path) { var parts = path.split("/"); return parts.length > 1 ? parts[0] : "Root"; }
    function groupByCategory(list) {
        var groups = {};
        list.forEach(function (f) { var c = categoryOf(f.path); if (!groups[c]) groups[c] = []; groups[c].push(f); });
        return groups;
    }
    function skeletonHtml(lines) {
        var widths = ["55%", "92%", "72%", "86%", "44%"], html = "";
        for (var i = 0; i < lines; i++) html += '<div class="pb-skeleton pb-skeleton-line" style="width:' + widths[i % widths.length] + '"></div>';
        return html;
    }
    function setStatus(text, loading) {
        statusText.textContent = text;
        statusSpinner.style.display = loading ? "" : "none";
    }
    function emptyStateHtml() {
        return '<div class="pb-empty">'
            + '<div class="pb-empty-mark">' + ICON.terminal + '</div>'
            + '<div class="pb-empty-title">Pick a technique to begin</div>'
            + '<div class="pb-empty-sub">Search or browse the sidebar to open any file from PayloadsAllTheThings. Every code block copies in a single click.</div>'
            + '<div class="pb-empty-hint">Press <span class="pb-inline-kbd">/</span> to search</div>'
            + '</div>';
    }

    // ---------- Sidebar ----------
    function renderSidebar(query) {
        var q = (query || "").trim().toLowerCase();
        var matches = q ? files.filter(function (f) { return f.path.toLowerCase().indexOf(q) !== -1; }) : files;
        sidebarListEl.innerHTML = "";

        if (matches.length === 0) {
            var empty = document.createElement("p");
            empty.className = "pb-side-empty";
            empty.textContent = 'No files match "' + query + '".';
            sidebarListEl.appendChild(empty);
            setStatus("Filename match: 0 of " + files.length, false);
            return;
        }

        var groups = groupByCategory(matches);
        Object.keys(groups).sort().forEach(function (cat) {
            var details = document.createElement("details");
            details.className = "pb-category";
            details.open = !!q;

            var summary = document.createElement("summary");
            summary.innerHTML = ICON.chev
                + '<span class="pb-cat-name">' + escapeHtml(cat.replace(/[-_]/g, " ")) + "</span>"
                + '<span class="pb-count">' + groups[cat].length + "</span>";
            details.appendChild(summary);

            var ul = document.createElement("ul");
            groups[cat].forEach(function (f) {
                var li = document.createElement("li");
                var a = document.createElement("a");
                a.href = "#";
                a.className = "pb-file";
                a.textContent = f.path.split("/").slice(1).join("/") || f.path;
                a.title = f.path;
                a.dataset.path = f.path;
                a.addEventListener("click", function (evt) { evt.preventDefault(); loadFile(f.path, a, { updateUrl: true }); });
                li.appendChild(a);
                ul.appendChild(li);
            });
            details.appendChild(ul);
            sidebarListEl.appendChild(details);
        });

        setStatus(q ? "Filename match: " + matches.length + " of " + files.length : "Browsing " + files.length + " files", false);
    }

    function renderFullTextResults(query) {
        var hits = miniSearch.search(query, { prefix: true, fuzzy: 0.2, boost: { title: 2 } });
        sidebarListEl.innerHTML = "";

        if (hits.length === 0) {
            var empty = document.createElement("p");
            empty.className = "pb-side-empty";
            empty.textContent = 'No payloads match "' + query + '".';
            sidebarListEl.appendChild(empty);
            setStatus("Full-text search: 0 results", false);
            return;
        }

        var ul = document.createElement("ul");
        ul.className = "pb-flat-results";
        hits.slice(0, 100).forEach(function (hit) {
            var li = document.createElement("li");
            var a = document.createElement("a");
            a.href = "#";
            a.className = "pb-flatlink";
            a.title = hit.path;
            a.dataset.path = hit.path;
            a.innerHTML = '<span class="pb-flat-title">' + escapeHtml(hit.title || hit.path) + "</span>"
                + '<span class="pb-flat-path">' + escapeHtml(hit.path) + "</span>";
            a.addEventListener("click", function (evt) { evt.preventDefault(); loadFile(hit.path, a, { updateUrl: true }); });
            li.appendChild(a);
            ul.appendChild(li);
        });
        sidebarListEl.appendChild(ul);

        setStatus("Full-text search: " + hits.length + " result" + (hits.length === 1 ? "" : "s") + (hits.length > 100 ? " (top 100)" : ""), false);
    }

    function runSearch(query) {
        var q = (query || "").trim();
        if (q && miniSearch) renderFullTextResults(q);
        else renderSidebar(query || "");
    }

    function loadSearchIndex() {
        if (typeof MiniSearch === "undefined") return;
        fetch("search-index.json")
            .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
            .then(function (data) {
                miniSearch = new MiniSearch({ idField: "path", fields: ["title", "body"], storeFields: ["path", "title"] });
                miniSearch.addAll(data);
                searchInput.placeholder = "Search payload contents…";
                if (pendingQuery && searchInput.value.trim() === pendingQuery.trim()) renderFullTextResults(pendingQuery);
                pendingQuery = null;
            })
            .catch(function () { pendingQuery = null; });
    }

    // ---------- Link / anchor / copy handling ----------
    function resolveRelative(basePath, target) {
        if (/^([a-z]+:)?\/\//i.test(target) || target.indexOf("#") === 0) return null;
        var baseDir = basePath.split("/").slice(0, -1);
        target.split("/").forEach(function (part) {
            if (part === "." || part === "") return;
            if (part === "..") baseDir.pop(); else baseDir.push(part);
        });
        return baseDir.join("/");
    }
    function fixRelativeLinks(root, basePath) {
        root.querySelectorAll("img[src]").forEach(function (img) {
            var r = resolveRelative(basePath, img.getAttribute("src"));
            if (r) img.src = RAW_BASE + r;
        });
        root.querySelectorAll("a[href]").forEach(function (a) {
            var href = a.getAttribute("href");
            var r = resolveRelative(basePath, href);
            if (r) {
                var hi = r.indexOf("#");
                var rp = hi === -1 ? r : r.slice(0, hi);
                var frag = hi === -1 ? "" : r.slice(hi);
                if (frag && rp === basePath) { a.setAttribute("href", frag); }
                else { a.href = BLOB_BASE + r; a.target = "_blank"; a.rel = "noopener noreferrer"; }
            } else if (/^https?:\/\//i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
        });
    }

    function findAnchorTarget(root, rawId) {
        var id = rawId;
        try { id = decodeURIComponent(rawId); } catch (e) {}
        var esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/(["\\])/g, "\\$1");
        return root.querySelector("#" + esc) || root.querySelector('[name="' + id.replace(/"/g, '\\"') + '"]') || null;
    }
    function getScroller(el) {
        var node = el.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
            var oy = getComputedStyle(node).overflowY;
            if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 2) return node;
            node = node.parentElement;
        }
        return null; // window is the scroll container
    }
    function scrollToEl(target) {
        if (!target) return;
        var behavior = prefersReducedMotion ? "auto" : "smooth";
        var scroller = getScroller(target);
        if (scroller) {
            var top = scroller.scrollTop + (target.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - 18;
            if (scroller.scrollTo) scroller.scrollTo({ top: top, behavior: behavior });
            else scroller.scrollTop = top;
        } else {
            var wtop = window.scrollY + target.getBoundingClientRect().top - 84;
            window.scrollTo({ top: wtop, behavior: behavior });
        }
    }
    function attachAnchorLinks(root) {
        root.querySelectorAll('a[href^="#"]').forEach(function (a) {
            a.addEventListener("click", function (evt) {
                var raw = a.getAttribute("href").slice(1);
                if (!raw) return;
                var target = findAnchorTarget(root, raw);
                if (!target) return;
                evt.preventDefault();
                scrollToEl(target);
            });
        });
    }

    function attachCopyButtons(root) {
        root.querySelectorAll("pre").forEach(function (pre) {
            if (pre.closest(".pb-code")) return;
            var code = pre.querySelector("code");
            var lang = "text";
            if (code && code.className) { var m = code.className.match(/language-([\w-]+)/); if (m) lang = m[1]; }

            var wrap = document.createElement("div"); wrap.className = "pb-code";
            var head = document.createElement("div"); head.className = "pb-code-head";
            var label = document.createElement("span"); label.className = "pb-code-lang"; label.textContent = lang;
            var btn = document.createElement("button"); btn.type = "button"; btn.className = "pb-copy-btn";
            btn.innerHTML = ICON.copy + "<span>Copy</span>";
            btn.addEventListener("click", function () {
                var text = (code || pre).textContent;
                navigator.clipboard.writeText(text).then(function () {
                    btn.classList.add("done"); btn.querySelector("span").textContent = "Copied";
                    setTimeout(function () { btn.classList.remove("done"); btn.querySelector("span").textContent = "Copy"; }, 1400);
                }, function () {
                    btn.querySelector("span").textContent = "Failed";
                    setTimeout(function () { btn.querySelector("span").textContent = "Copy"; }, 1400);
                });
            });
            head.appendChild(label); head.appendChild(btn);
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(head); wrap.appendChild(pre);
            if (code && typeof hljs !== "undefined") { try { hljs.highlightElement(code); } catch (e) {} }
        });
    }

    function renderError(err, context) {
        if (err && err.status === 403) return "GitHub API rate limit reached (60 requests/hour for unauthenticated use). Please wait a bit and try again.";
        if (err && err.status) return "GitHub returned an error (HTTP " + err.status + ") while " + context + ".";
        if (err instanceof TypeError) return "Network request blocked or failed while " + context + ". If you opened this file directly (file://), serve it over http(s) instead. A browser extension may also be blocking api.github.com / raw.githubusercontent.com.";
        return "Unexpected error while " + context + ": " + (err && err.message ? err.message : err);
    }

    function findLinkForPath(path) {
        var els = sidebarListEl.querySelectorAll("a[data-path]");
        for (var i = 0; i < els.length; i++) if (els[i].dataset.path === path) return els[i];
        return null;
    }

    // ---------- Breadcrumb ----------
    function renderCrumbs(path) {
        currentPath = path;
        crumbbar.hidden = false;
        crumbsEl.innerHTML = "";
        var parts = path.split("/");
        parts.forEach(function (p, i) {
            var last = i === parts.length - 1;
            var seg = document.createElement("span");
            seg.className = "pb-crumb" + (last ? " last" : "");
            seg.textContent = p;
            crumbsEl.appendChild(seg);
            if (!last) {
                var sep = document.createElement("span");
                sep.className = "pb-crumb-sep";
                sep.textContent = "/";
                crumbsEl.appendChild(sep);
            }
        });
        ghLink.href = BLOB_BASE + path;
        updateFavBtn();
    }
    function updateFavBtn() {
        var fav = isFavorite(currentPath);
        favBtn.classList.toggle("active", fav);
        favBtn.innerHTML = fav ? ICON.starFilled : ICON.starOutline;
    }
    favBtn.addEventListener("click", function () {
        if (!currentPath) return;
        toggleFavorite(currentPath);
        updateFavBtn();
        renderQuickLinks();
    });

    // ---------- Load file ----------
    function loadFile(path, linkEl, opts) {
        opts = opts || {};
        if (activeLink) activeLink.classList.remove("active");
        if (linkEl) { linkEl.classList.add("active"); activeLink = linkEl; } else { activeLink = null; }

        renderCrumbs(path);
        contentEl.innerHTML = '<div class="pb-loading"><span class="pb-spinner"></span>Loading ' + escapeHtml(path) + "…</div>" + skeletonHtml(4);

        fetch(RAW_BASE + path)
            .then(function (res) { if (!res.ok) { var e = new Error("HTTP " + res.status); e.status = res.status; throw e; } return res.text(); })
            .then(function (text) {
                var inner;
                if (/\.md$/i.test(path)) {
                    ensureGfm();
                    inner = DOMPurify.sanitize(marked.parse(text));
                } else {
                    inner = "<pre><code>" + escapeHtml(text) + "</code></pre>";
                }
                contentEl.innerHTML = '<div class="pb-md">' + inner + "</div>";
                var md = contentEl.querySelector(".pb-md");
                fixRelativeLinks(md, path);
                attachCopyButtons(md);
                attachAnchorLinks(md);
                contentEl.scrollTop = 0;
                if (getScroller(md) === null) window.scrollTo(0, 0);

                pushRecent(path);
                renderQuickLinks();
                if (opts.updateUrl) updateUrl({ path: path }, true);
                if (opts.hash) {
                    var t = findAnchorTarget(md, opts.hash.replace(/^#/, ""));
                    if (t) requestAnimationFrame(function () { scrollToEl(t); });
                }
            })
            .catch(function (err) {
                contentEl.innerHTML = '<p class="pb-error">' + escapeHtml(renderError(err, "loading this file")) + "</p>";
            });
    }

    function loadFileByPath(path) {
        var linkEl = findLinkForPath(path);
        if (linkEl) { var d = linkEl.closest("details"); if (d) d.open = true; }
        loadFile(path, linkEl, { updateUrl: true });
    }

    function openFileFromDeepLink(path, hash, updateAfter) {
        var found = files.some(function (f) { return f.path === path; });
        renderSidebar("");
        if (!found) return;
        var linkEl = findLinkForPath(path);
        if (linkEl) { var d = linkEl.closest("details"); if (d) d.open = true; }
        loadFile(path, linkEl, { updateUrl: !!updateAfter, hash: hash });
    }

    function goHome(push) {
        clearTimeout(debounceTimer);
        searchInput.value = "";
        searchClearBtn.hidden = true;
        kbdHint.hidden = false;
        activeLink = null;
        currentPath = "";
        crumbbar.hidden = true;
        renderSidebar("");
        contentEl.innerHTML = emptyStateHtml();
        if (push !== false) updateUrl({ path: null, q: null }, true);
    }

    function clearSearch() {
        clearTimeout(debounceTimer);
        searchInput.value = "";
        searchClearBtn.hidden = true;
        kbdHint.hidden = false;
        renderSidebar("");
        updateUrl({ q: null }, false);
    }

    // ---------- Boot ----------
    function init() {
        setStatus("Loading file tree…", true);
        fetch(TREE_API)
            .then(function (res) { if (!res.ok) { var e = new Error("HTTP " + res.status); e.status = res.status; throw e; } return res.json(); })
            .then(function (data) {
                files = (data.tree || []).filter(function (n) { return n.type === "blob" && FILE_PATTERN.test(n.path); });
                if (files.length === 0) { setStatus("No indexable files found.", false); return; }

                if (pendingPath) { openFileFromDeepLink(pendingPath, location.hash, false); pendingPath = null; }
                else if (pendingQuery) { searchInput.value = pendingQuery; searchClearBtn.hidden = false; kbdHint.hidden = true; runSearch(pendingQuery); }
                else renderSidebar("");
            })
            .catch(function (err) { setStatus(renderError(err, "loading the file tree"), false); });
    }

    // ---------- Event wiring ----------
    searchInput.addEventListener("input", function (e) {
        clearTimeout(debounceTimer);
        var value = e.target.value;
        searchClearBtn.hidden = !value;
        kbdHint.hidden = !!value;
        debounceTimer = setTimeout(function () {
            runSearch(value);
            updateUrl({ q: value.trim() || null }, false);
        }, 120);
    });
    searchClearBtn.addEventListener("click", function () { clearSearch(); searchInput.focus(); });
    document.getElementById("pb-home-link").addEventListener("click", function () { goHome(true); });
    document.getElementById("pb-crumb-home").addEventListener("click", function () { goHome(true); });

    document.addEventListener("keydown", function (e) {
        var tag = (e.target && e.target.tagName || "").toLowerCase();
        var typing = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
        if (e.key === "/" && !typing) { e.preventDefault(); searchInput.focus(); }
        else if (e.key === "Escape" && (document.activeElement === searchInput || searchInput.value)) { clearSearch(); searchInput.blur(); }
    });

    window.addEventListener("popstate", function () {
        var params = new URLSearchParams(location.search);
        var path = params.get("path");
        var q = params.get("q");
        clearTimeout(debounceTimer);
        if (path) {
            searchInput.value = q || "";
            searchClearBtn.hidden = !q;
            kbdHint.hidden = !!q;
            openFileFromDeepLink(path, location.hash, false);
            if (q) runSearch(q);
        } else if (q) {
            searchInput.value = q;
            searchClearBtn.hidden = false;
            kbdHint.hidden = true;
            activeLink = null;
            currentPath = "";
            crumbbar.hidden = true;
            contentEl.innerHTML = emptyStateHtml();
            runSearch(q);
        } else { goHome(false); }
    });

    (function parseInitialUrl() {
        var params = new URLSearchParams(location.search);
        var path = params.get("path");
        var q = params.get("q");
        if (path) pendingPath = path;
        else if (q) pendingQuery = q;
    })();

    contentEl.innerHTML = emptyStateHtml();
    renderQuickLinks();
    init();
    loadSearchIndex();
})();