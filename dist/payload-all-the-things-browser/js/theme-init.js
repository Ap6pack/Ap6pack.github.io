// Applied before first paint to avoid a flash of the wrong theme.
(function () {
    try {
        var t = localStorage.getItem("pb-theme");
        if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
    } catch (e) {}
})();
