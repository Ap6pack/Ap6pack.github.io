// LinkedIn Profile Card
(function(document, window) {
    if (document.addEventListener && document.hidden !== undefined) {
        window.liVisibilityChangeListener = function() {
            if (document.hidden) {
                window.liHasWindowHidden = true;
            }
        };
        document.addEventListener("visibilitychange", window.liVisibilityChangeListener);
    }
})(document, window);

// GitHub Profile Card
(function(document) {
    const baseURL = "//cdn.jsdelivr.net/github-cards/1.0.2/";
    let cardCounter = 0;
    const metaTags = document.getElementsByTagName("meta");

    let gcConfig = {
        url: null,
        base: baseURL,
        clientId: null,
        clientSecret: null,
        theme: "default"
    };

    // Parse meta tags
    for (let tag of metaTags) {
        switch (tag.getAttribute("name")) {
            case "gc:url":
                gcConfig.url = tag.getAttribute("content");
                break;
            case "gc:base":
                gcConfig.base = tag.getAttribute("content");
                break;
            case "gc:client-id":
                gcConfig.clientId = tag.getAttribute("content");
                break;
            case "gc:client-secret":
                gcConfig.clientSecret = tag.getAttribute("content");
                break;
            case "gc:theme":
                gcConfig.theme = tag.getAttribute("content");
                break;
        }
    }

    // Helper functions
    function selectElements(className) {
        return document.querySelectorAll ? document.querySelectorAll("." + className) : Array.from(document.getElementsByTagName("div")).filter(el => el.className.split(" ").includes(className));
    }

    function getDataAttribute(element, attribute) {
        return element.getAttribute("data-" + attribute);
    }

    function setupMessageListener(iframe) {
        if (window.addEventListener) {
            window.addEventListener("message", function(event) {
                if (iframe.id === event.data.sender) {
                    iframe.height = event.data.height;
                }
            }, false);
        }
    }

    function createGithubCard(element, url) {
        cardCounter += 1;
        const user = getDataAttribute(element, "user");
        const repo = getDataAttribute(element, "repo");
        const github = getDataAttribute(element, "github")?.split("/");
        const theme = getDataAttribute(element, "theme") || gcConfig.theme;
        const iframeURL = url || `${gcConfig.base}cards/${theme}.html?user=${user || github[0]}&repo=${repo || github[1]}&identity=ghcard-${user}-${cardCounter}`;
        const iframe = document.createElement("iframe");

        iframe.id = `ghcard-${user}-${cardCounter}`;
        iframe.frameBorder = 0;
        iframe.scrolling = "no";
        iframe.allowTransparency = true;
        iframe.width = getDataAttribute(element, "width") || Math.min(element.parentNode.clientWidth || 400, 400);
        iframe.height = getDataAttribute(element, "height") || "auto";
        iframe.src = iframeURL + `&client_id=${gcConfig.clientId}&client_secret=${gcConfig.clientSecret}&target=${getDataAttribute(element, "target")}`;

        setupMessageListener(iframe);
        element.parentNode.replaceChild(iframe, element);
    }

    // Initialize GitHub cards
    const githubCards = selectElements("github-card");
    for (let card of githubCards) {
        createGithubCard(card, gcConfig.url);
    }

    if (window.githubCard) {
        window.githubCard.render = createGithubCard;
    }
})(document);
