/**
 * Main JavaScript file for Adam Rhys Heaton's Portfolio
 * Modern vanilla JavaScript implementation (no jQuery dependencies)
 */

// Document ready function
document.addEventListener('DOMContentLoaded', function() {
    // Initialize all components
    initVisibilityTracking();
    initGithubCards();
});

/**
 * Visibility change tracking
 * Tracks when the page becomes hidden (user switches tabs/apps)
 */
function initVisibilityTracking() {
    if (document.addEventListener && document.hidden !== undefined) {
        window.liVisibilityChangeListener = function() {
            if (document.hidden) {
                window.liHasWindowHidden = true;
            }
        };
        document.addEventListener("visibilitychange", window.liVisibilityChangeListener);
    }
}

/**
 * GitHub Profile Cards
 * Renders GitHub profile cards based on data attributes
 */
function initGithubCards() {
    const baseURL = "//cdn.jsdelivr.net/github-cards/1.0.2/";
    let cardCounter = 0;
    const metaTags = document.getElementsByTagName("meta");

    // Configuration object
    let gcConfig = {
        url: null,
        base: baseURL,
        clientId: null,
        clientSecret: null,
        theme: "default"
    };

    // Parse meta tags for configuration
    for (let tag of metaTags) {
        const name = tag.getAttribute("name");
        if (!name) continue;
        
        switch (name) {
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

    // Select all GitHub card elements
    const githubCards = document.querySelectorAll(".github-card");
    
    // Initialize each card
    githubCards.forEach(card => {
        createGithubCard(card, gcConfig.url);
    });

    // Make the render function globally available
    if (window.githubCard) {
        window.githubCard.render = createGithubCard;
    }

    /**
     * Creates a GitHub card iframe
     * @param {HTMLElement} element - The element to replace with the card
     * @param {string} url - Optional URL override
     */
    function createGithubCard(element, url) {
        cardCounter += 1;
        const user = element.getAttribute("data-user");
        const repo = element.getAttribute("data-repo");
        const github = element.getAttribute("data-github")?.split("/");
        const theme = element.getAttribute("data-theme") || gcConfig.theme;
        const iframeURL = url || `${gcConfig.base}cards/${theme}.html?user=${user || github?.[0]}&repo=${repo || github?.[1]}&identity=ghcard-${user}-${cardCounter}`;
        
        // Create iframe element
        const iframe = document.createElement("iframe");
        iframe.id = `ghcard-${user}-${cardCounter}`;
        
        // Use modern attributes instead of deprecated ones
        iframe.style.border = "none"; // Instead of frameBorder
        iframe.setAttribute("scrolling", "no"); // Still needed for some browsers but will be styled with CSS
        iframe.style.overflow = "hidden"; // Modern way to prevent scrolling
        
        iframe.setAttribute("allowtransparency", "true");
        iframe.width = element.getAttribute("data-width") || Math.min(element.parentNode.clientWidth || 400, 400);
        iframe.height = element.getAttribute("data-height") || "auto";
        iframe.src = iframeURL + `&client_id=${gcConfig.clientId}&client_secret=${gcConfig.clientSecret}&target=${element.getAttribute("data-target") || ''}`;

        // Set up message listener for iframe height adjustment
        setupMessageListener(iframe);
        
        // Replace the original element with the iframe
        element.parentNode.replaceChild(iframe, element);
    }

    /**
     * Sets up a message listener for iframe height adjustment
     * @param {HTMLIFrameElement} iframe - The iframe to listen for messages from
     */
    function setupMessageListener(iframe) {
        window.addEventListener("message", function(event) {
            if (iframe.id === event.data.sender) {
                iframe.height = event.data.height;
            }
        }, false);
    }
}
