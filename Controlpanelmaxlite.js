// ==UserScript==
// @name         YouTube & Media Control Suite (Unified)
// @namespace    https://github.com/thatonevietnamese/media-control-suite
// @version      1.4.1
// @description  Unified media controls with selectable YouTube ad skip modes on Watch/Shorts.
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Controlpanelmaxlite.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Controlpanelmaxlite.js
// @match        *://*/*
// @all-frames   true
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // SETTINGS CACHE
    // =========================================================

    const DEFAULT_SETTINGS = {
        vol: 1,
        loop: false,
        forceResume: false,
        q: "auto",
        enableBoost: false,
        adMode: "instant"
    };

    const VALID_QUALITIES = new Set([
        "auto", "tiny", "small", "medium", "large",
        "hd720", "hd1080", "hd1440", "hd2160"
    ]);
    const VALID_AD_MODES = new Set(["none", "normal", "instant"]);

    function normalizeSettings(value) {
        const raw = value && typeof value === "object" ? value : {};
        const parsedVolume = Number(raw.vol);

        return {
            vol: Number.isFinite(parsedVolume)
                ? Math.max(0, Math.min(5, parsedVolume))
                : DEFAULT_SETTINGS.vol,
            loop: Boolean(raw.loop),
            forceResume: Boolean(raw.forceResume),
            q: VALID_QUALITIES.has(raw.q) ? raw.q : "auto",
            enableBoost: Boolean(raw.enableBoost),
            adMode: VALID_AD_MODES.has(raw.adMode)
                ? raw.adMode
                : DEFAULT_SETTINGS.adMode
        };
    }

    const settings = normalizeSettings(
        GM_getValue("vcp_settings", DEFAULT_SETTINGS)
    );

    // =========================================================
    // STATE
    // =========================================================

    let isSpeedForced = false;
    let customSpeed = 3;

    let activeMedia = null;
    let panelVisible = false;
    let volLock = false;

    const userPausedMedia = new WeakSet();
    const originalPlaybackRates = new WeakMap();
    let recentPlayerInteractionUntil = 0;

    const isYouTube = /(^|\.)youtube\.com$/i.test(location.hostname);
    const isTopFrame = (() => {
        try {
            return window.top === window.self;
        } catch (_) {
            return true;
        }
    })();

    function isTargetYouTubePage() {
        if (!isYouTube) return true;

        try {
            const pathname = window.top.location.pathname;
            return pathname === "/watch" || pathname === "/shorts" || pathname.startsWith("/shorts/");
        } catch (_) {
            const pathname = location.pathname;
            return pathname === "/watch" || pathname === "/shorts" || pathname.startsWith("/shorts/");
        }
    }

    function isYouTubeChildFrame() {
        if (isTopFrame) return false;

        // Same-origin YouTube subframes must never run the generic media
        // controller. Cross-origin ad frames are identified by their referrer
        // when the browser exposes it; otherwise the frame remains isolated
        // from the top-frame ad controller by the top-frame-only checks.
        if (isYouTube) return true;

        try {
            const referrer = document.referrer ? new URL(document.referrer) : null;
            return Boolean(referrer && /(^|\.)youtube\.com$/i.test(referrer.hostname));
        } catch (_) {
            return false;
        }
    }

    // The YouTube controller belongs only to the top-level Watch/Shorts page.
    // Do not let ad creatives in child frames receive normal media speed/volume
    // settings intended for the main content video.
    let pageEnabled = isYouTube
        ? (isTopFrame && isTargetYouTubePage())
        : !isYouTubeChildFrame();

    function isPageEnabled() {
        if (isYouTube) {
            return isTopFrame && isTargetYouTubePage();
        }
        return pageEnabled;
    }

    // Shared per-frame audio graph registry. WeakMap avoids retaining media elements.
    const audioCtxMap = new WeakMap();
    let globalAudioCtx = null;

    function setAdGraphMuted(media, muted) {
        if (!media) return;
        const data = audioCtxMap.get(media);
        if (!data || !data.gain || !data.ctx) return;

        try {
            const targetGain = muted
                ? 0
                : (settings.enableBoost && settings.vol > 1 ? settings.vol : 1);
            data.gain.gain.setTargetAtTime(
                targetGain,
                data.ctx.currentTime,
                muted ? 0.015 : 0.04
            );
        } catch (_) {}
    }

    function disconnectDetachedAudioGraph(media) {
        if (!media || media.isConnected) return;
        const data = audioCtxMap.get(media);
        if (!data || data.disconnected) return;

        try {
            data.source.disconnect();
            data.gain.disconnect();
            data.disconnected = true;
        } catch (_) {}
    }

    function reconnectAudioGraph(data) {
        if (!data || !data.disconnected) return;
        try {
            data.source.connect(data.gain);
            data.gain.connect(data.ctx.destination);
            data.disconnected = false;
        } catch (_) {}
    }

    // =========================================================
    // YOUTUBE AD HANDLER (TOP FRAME ONLY)
    // =========================================================

    const ADS_CONFIG = {
        debug: false,
        retryInterval: 100,
        clickInterval: 100,
        seekRetryInterval: 450,
        seekEndOffset: 0.5,
        normalPlaybackRate: 20
    };

    const ADS_SELECTORS = {
        // Hide ad-specific decorations only. Keep the player, video,
        // skip-button containers, and normal player overlays intact.
        toHide: [
            ".ytp-ad-message-container",
            "ytd-player-legacy-desktop-watch-ads-renderer",
            "ytd-ad-slot-renderer",
            "#masthead-ad",
            "tp-yt-paper-dialog:has(#feedback.ytd-enforcement-message-view-model)",
            ".yt-mealbar-promo-renderer",
            ".ytp-ad-player-overlay-layout__player-card-container",
            ".ytp-ad-player-overlay-layout__ad-info-container",
            ".ytp-ad-player-overlay-layout__ad-disclosure-banner-container",
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
            "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
            "ytd-in-feed-ad-layout-renderer",
            "#player-ads",
            ".ytd-video-masthead-ad-v3-renderer",
            "ytd-ad-selection-preview-renderer",
            ".ytp-ad-image-overlay",
            ".ytp-ad-avatar",
            ".ytp-ad-button-vm"
        ],
        player: ["#movie_player", ".html5-video-player"],
        skipButtons: [
            "button.ytp-ad-skip-button-modern",
            ".ytp-ad-skip-button-modern[role='button']",
            "button.ytp-skip-ad-button",
            ".ytp-skip-ad-button[role='button']",
            "button.ytp-ad-skip-button",
            ".ytp-ad-skip-button[role='button']",
            ".ytp-ad-skip-button-slot button",
            ".ytp-ad-skip-button-slot [role='button']",
            ".ytp-ad-skip-button-container button",
            ".ytp-ad-skip-button-container [role='button']",
            ".ytp-ad-skip-button-modern",
            ".ytp-skip-ad-button",
            ".ytp-ad-skip-button"
        ]
    };

    // These are the explicit in-stream ad states. Overlay-only states are
    // deliberately excluded so ordinary videos are never muted by mistake.
    const ADS_CLASSES = ["ad-showing", "ad-interrupting"];

    const ADS_QUERY = Object.fromEntries(
        Object.entries(ADS_SELECTORS).map(([key, values]) => [key, values.join(", ")])
    );

    let adPlayer = null;
    let adPlayerObserver = null;
    let playerDiscoveryObserver = null;
    let adVideo = null;
    let adWasActive = false;
    let lastSkipAttemptAt = 0;
    let lastAdSeekAt = 0;
    let adRetryTimer = null;
    let playerBindTimer = null;
    let adStyleInjected = false;

    // Store state per media element so replacing the video during an ad does
    // not overwrite the mute/rate values belonging to the previous element.
    const adMediaStates = new WeakMap();

    function adsLog(message) {
        if (ADS_CONFIG.debug) {
            console.debug("[Media Control Suite / Ads]", message);
        }
    }

    function findYouTubePlayer() {
        const candidates = document.querySelectorAll(ADS_QUERY.player);
        for (const candidate of candidates) {
            if (ADS_CLASSES.some(name => candidate.classList.contains(name))) {
                return candidate;
            }
            const nestedActive = candidate.querySelector(
                ADS_CLASSES.map(name => `.html5-video-player.${name}, #movie_player.${name}`).join(", ")
            );
            if (nestedActive) return candidate;
        }
        return document.getElementById("movie_player") ||
            document.querySelector(".html5-video-player");
    }

    function hasYouTubeAdState(player) {
        if (!player) return false;
        if (ADS_CLASSES.some(name => player.classList.contains(name))) return true;

        // Some YouTube layouts put the state class on the inner player node.
        for (const name of ADS_CLASSES) {
            if (player.querySelector(`#movie_player.${name}, .html5-video-player.${name}`)) {
                return true;
            }
        }

        // A real in-player Skip control is also an unambiguous ad signal and
        // covers experiments that rename/remove the usual ad-state classes.
        try {
            if (player.querySelector(ADS_SELECTORS.skipButtons.join(", "))) return true;
        } catch (_) {}
        return false;
    }

    function isYouTubeAdActive() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame) return false;
        const player = adPlayer && adPlayer.isConnected ? adPlayer : findYouTubePlayer();
        return hasYouTubeAdState(player);
    }

    function injectAdsStyles() {
        if (
            !isPageEnabled() || !isYouTube || !isTopFrame ||
            settings.adMode === "none" || adStyleInjected
        ) return;

        const scopedSkipSelectors = ADS_SELECTORS.skipButtons
            .flatMap(selector => [
                `#movie_player ${selector}`,
                `.html5-video-player ${selector}`
            ])
            .join(", ");

        const style = document.createElement("style");
        style.id = "ymcs-ad-bypass-style";
        style.textContent = `
            ${ADS_QUERY.toHide} {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            ${scopedSkipSelectors} {
                text-transform: uppercase !important;
                border: 1px solid #fd0 !important;
                background-color: rgba(255,230,50,0.65) !important;
                box-shadow: 0 0 16px rgba(255,204,0,0.75) !important;
            }
            ${ADS_CLASSES.map(name => `.${name} .ytp-spinner-circle`).join(", ")} {
                border-color: #fc0 #fc0 transparent !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
        adStyleInjected = true;
    }

    function removeAdsStyles() {
        const style = document.getElementById("ymcs-ad-bypass-style");
        if (style) style.remove();
        adStyleInjected = false;
    }

    function safeSetPlaybackRate(media, rate) {
        if (!media || !Number.isFinite(rate) || rate <= 0) return;
        try {
            if (Math.abs(media.playbackRate - rate) > 0.01) media.playbackRate = rate;
        } catch (_) {}
    }

    function safeSetDefaultPlaybackRate(media, rate) {
        if (!media || !Number.isFinite(rate) || rate <= 0) return;
        try {
            if (Math.abs(media.defaultPlaybackRate - rate) > 0.01) {
                media.defaultPlaybackRate = rate;
            }
        } catch (_) {}
    }

    function setAdPlaybackRate(media, requestedRate) {
        if (!media || !Number.isFinite(requestedRate) || requestedRate <= 0) return;

        // Some browsers reject 20x with NotSupportedError (Chromium's tested
        // HTMLMediaElement ceiling is 16x). Try the requested value first,
        // then fall back to 16x instead of silently leaving the ad at 1x/2x.
        try {
            media.playbackRate = requestedRate;
        } catch (_) {
            try { media.playbackRate = 16; } catch (_) {}
        }

        const appliedRate = Number.isFinite(media.playbackRate) && media.playbackRate > 0
            ? media.playbackRate
            : Math.min(requestedRate, 16);

        try {
            media.defaultPlaybackRate = requestedRate;
        } catch (_) {
            try { media.defaultPlaybackRate = appliedRate; } catch (_) {}
        }
    }

    function restoreAdVideo(media = adVideo) {
        if (!media) return;

        const state = adMediaStates.get(media);
        if (state) {
            // Restore only if the element is still in the state imposed by this
            // script. This avoids overwriting a user's explicit mute change.
            try {
                if (media.muted === true) media.muted = state.muted;
            } catch (_) {}

            let restoreRate = state.playbackRate;
            let restoreDefaultRate = state.defaultPlaybackRate;

            if (state.wasSpeedForced) {
                if (isSpeedForced) {
                    restoreRate = Math.max(0.1, Math.min(5, customSpeed));
                    restoreDefaultRate = restoreRate;
                } else if (Number.isFinite(state.originalForcedRate)) {
                    // The speed override was disabled while the ad was active.
                    restoreRate = state.originalForcedRate;
                    restoreDefaultRate = state.originalForcedRate;
                    originalPlaybackRates.delete(media);
                }
            }

            safeSetPlaybackRate(media, restoreRate);
            safeSetDefaultPlaybackRate(media, restoreDefaultRate);
            adMediaStates.delete(media);
        }

        try {
            setAdGraphMuted(media, false);
        } catch (_) {}

        if (media === adVideo) adVideo = null;

        // Re-apply current speed/volume/boost settings after the ad. Settings
        // can be changed while the ad is muted, when normal media handling is
        // intentionally suspended.
        if (media === activeMedia && !isYouTubeAdActive()) {
            try { applyMediaSettings(media, true); } catch (_) {}
        }
    }

    function enforceAdVideoState(media) {
        if (!media || settings.adMode === "none") return;

        if (!adMediaStates.has(media)) {
            adMediaStates.set(media, {
                muted: Boolean(media.muted),
                playbackRate: Number.isFinite(media.playbackRate) ? media.playbackRate : 1,
                defaultPlaybackRate: Number.isFinite(media.defaultPlaybackRate)
                    ? media.defaultPlaybackRate
                    : 1,
                wasSpeedForced: originalPlaybackRates.has(media),
                originalForcedRate: originalPlaybackRates.get(media)
            });
        }

        // Mute synchronously as soon as the ad state is detected.
        try {
            if (!media.muted) media.muted = true;
        } catch (_) {}
        setAdGraphMuted(media, true);

        // Normal: accelerate the ad. Instant: keep it at 1x while the
        // controlled near-end seek + Skip-button retry loop does the work.
        const targetRate = settings.adMode === "normal"
            ? ADS_CONFIG.normalPlaybackRate
            : 1;
        setAdPlaybackRate(media, targetRate);
    }

    function trackAdVideo(media) {
        if (media !== adVideo) {
            if (adVideo) restoreAdVideo(adVideo);
            adVideo = media || null;
        }
        if (media) enforceAdVideoState(media);
    }

    function stopAdRetryLoop() {
        if (adRetryTimer !== null) {
            clearInterval(adRetryTimer);
            adRetryTimer = null;
        }
    }

    function startAdRetryLoop() {
        if (adRetryTimer !== null) return;
        adRetryTimer = setInterval(checkYouTubeAds, ADS_CONFIG.retryInterval);
    }

    function restoreAfterAd() {
        stopAdRetryLoop();
        if (adVideo) restoreAdVideo(adVideo);
        adWasActive = false;
        lastSkipAttemptAt = 0;
        lastAdSeekAt = 0;
        adsLog("Ad ended; restored the media state");
    }

    function isElementVisible(element, player) {
        if (!element || !element.isConnected) return false;

        try {
            if (element.getClientRects().length === 0) return false;
            for (let node = element; node && node !== player; node = node.parentElement) {
                const style = window.getComputedStyle(node);
                if (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    style.visibility === "collapse" ||
                    Number(style.opacity) === 0
                ) {
                    return false;
                }
            }
        } catch (_) {
            return false;
        }
        return true;
    }

    function isSkipButtonUsable(button, player) {
        if (!button || !player || !player.contains(button)) return false;
        const knownSkipControl = button.matches(
            ".ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button"
        );
        if (!button.matches("button, [role='button']") && !knownSkipControl) return false;
        if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
        if (button.closest('[aria-disabled="true"]')) return false;
        return isElementVisible(button, player);
    }

    function findSkipButton(player) {
        if (!player) return null;

        for (const selector of ADS_SELECTORS.skipButtons) {
            let matches;
            try {
                matches = player.querySelectorAll(selector);
            } catch (_) {
                continue;
            }

            for (const match of matches) {
                const button = match.matches("button, [role='button']")
                    ? match
                    : (match.querySelector("button, [role='button']") || match);
                if (isSkipButtonUsable(button, player)) return button;
            }
        }

        // Class names can change during YouTube experiments. The fallback
        // accepts localized ad-skip labels, but not unrelated "skip forward".
        const labelPatterns = [
            /^skip(?:\s+ads?)?$/i,
            /\bskip\s+ads?\b/i,
            /^bỏ qua(?:\s+quảng cáo)?$/i,
            /^lewati(?:\s+iklan)?$/i,
            /^langkau(?:\s+iklan)?$/i,
            /^pular(?:\s+anúncio)?$/i,
            /^saltar(?:\s+anuncio)?$/i,
            /^ignorer(?:\s+la\s+publicité)?$/i,
            /^passer(?:\s+la\s+publicité)?$/i,
            /^überspringen$/i,
            /^пропустить(?:\s+рекламу)?$/i,
            /^تخطي(?:\s+الإعلان)?$/i,
            /^跳过广告$/,
            /^広告をスキップ$/,
            /^광고 건너뛰기$/,
            /^ข้ามโฆษณา$/,
            /^reklamı atla$/i,
            /^pomiń reklamę$/i,
            /^विज्ञापन छोड़ें$/
        ];

        for (const button of player.querySelectorAll("button, [role='button']")) {
            const labels = [
                button.getAttribute("aria-label"),
                button.getAttribute("title"),
                button.textContent
            ].filter(Boolean).map(value => value.replace(/\s+/g, " ").trim());

            if (
                labels.some(label => labelPatterns.some(pattern => pattern.test(label))) &&
                isSkipButtonUsable(button, player)
            ) {
                return button;
            }
        }

        return null;
    }

    function tryInstantSeekToEnd(media) {
        if (!media || settings.adMode !== "instant") return false;

        const duration = Number(media.duration);
        const currentTime = Number(media.currentTime);
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) {
            return false;
        }

        const targetTime = Math.max(0, duration - ADS_CONFIG.seekEndOffset);
        // Do not continuously fight an in-flight seek. If YouTube rejects the
        // seek, retry at a controlled interval while the ad remains active.
        if (media.seeking || currentTime >= targetTime - 0.2) return false;

        const now = Date.now();
        if (now - lastAdSeekAt < ADS_CONFIG.seekRetryInterval) return false;
        lastAdSeekAt = now;

        try {
            media.currentTime = targetTime;
            adsLog(`Instant mode requested seek to ${targetTime.toFixed(2)}s`);
            return true;
        } catch (error) {
            adsLog(`Instant seek was rejected: ${String(error)}`);
            return false;
        }
    }

    function performAdSkip() {
        const player = adPlayer;
        if (
            settings.adMode === "none" ||
            !player || !player.isConnected ||
            !hasYouTubeAdState(player)
        ) return false;

        const media = adVideo && adVideo.isConnected
            ? adVideo
            : player.querySelector("video");

        if (settings.adMode === "instant") {
            tryInstantSeekToEnd(media);
        }

        const skipButton = findSkipButton(player);
        if (!skipButton) return false;

        const now = Date.now();
        // Retry the same visible Skip control until the ad state disappears.
        // The short interval is bounded by the single ad retry loop below.
        if (now - lastSkipAttemptAt < ADS_CONFIG.clickInterval) return false;
        lastSkipAttemptAt = now;

        try {
            skipButton.click();
            adsLog(`Clicked Skip (${settings.adMode} mode)`);
            return true;
        } catch (error) {
            adsLog(`Skip-button click failed: ${String(error)}`);
            return false;
        }
    }

    function checkYouTubeAds() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame) return;

        if (settings.adMode === "none") {
            if (adWasActive || adVideo) restoreAfterAd();
            stopAdRetryLoop();
            removeAdsStyles();
            return;
        }

        if (!adPlayer || !adPlayer.isConnected) {
            // A detached player must not leave the old ad video muted or keep
            // a retry interval alive while no player exists.
            if (adWasActive || adVideo) restoreAfterAd();
            adPlayer = null;
            bindYouTubePlayer();
            if (!adPlayer || !adPlayer.isConnected) {
                stopAdRetryLoop();
                return;
            }
        }

        const active = hasYouTubeAdState(adPlayer);
        if (active) {
            if (!adWasActive) {
                adWasActive = true;
                lastSkipAttemptAt = 0;
                lastAdSeekAt = 0;
                adsLog("YouTube in-stream ad detected");
            }

            // Re-read the video every time: YouTube can replace the media node
            // between ad segments while keeping the player root alive.
            const currentVideo = adPlayer.querySelector("video");
            trackAdVideo(currentVideo);
            performAdSkip();
            startAdRetryLoop();
        } else if (adWasActive) {
            restoreAfterAd();
        }
    }

    function scheduleAdCheck() {
        // Do not debounce ad-state changes: the first mute must happen as soon
        // as the player class mutation is delivered by MutationObserver.
        if (!isPageEnabled()) return;
        checkYouTubeAds();
    }

    function bindYouTubePlayer() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame) return false;

        const nextPlayer = findYouTubePlayer();
        if (!nextPlayer) return false;

        if (nextPlayer !== adPlayer) {
            if (adPlayerObserver) {
                adPlayerObserver.disconnect();
                adPlayerObserver = null;
            }

            if (adWasActive || adVideo) restoreAfterAd();
            adPlayer = nextPlayer;
            adPlayerObserver = new MutationObserver(scheduleAdCheck);
            adPlayerObserver.observe(adPlayer, {
                attributes: true,
                attributeFilter: ["class", "aria-disabled", "disabled", "aria-label", "title"],
                childList: true,
                subtree: true
            });

            adsLog("Bound to the current YouTube player");
        }

        checkYouTubeAds();
        return true;
    }

    function schedulePlayerBind() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame || playerBindTimer !== null) return;

        playerBindTimer = setTimeout(() => {
            playerBindTimer = null;
            bindYouTubePlayer();
        }, 0);
    }

    function installPlayerDiscoveryObserver() {
        if (
            !isYouTube || !isTopFrame || !isPageEnabled() ||
            playerDiscoveryObserver || !document.documentElement
        ) {
            return;
        }

        playerDiscoveryObserver = new MutationObserver(() => {
            if (!isPageEnabled()) return;
            if (!adPlayer || !adPlayer.isConnected) schedulePlayerBind();
        });

        playerDiscoveryObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        schedulePlayerBind();
    }

    function disconnectPlayerDiscoveryObserver() {
        if (playerDiscoveryObserver) {
            playerDiscoveryObserver.disconnect();
            playerDiscoveryObserver = null;
        }
    }

    // Player media events are a second, low-latency safety net if YouTube
    // changes the video node or updates mute/rate during an active ad.
    function handleAdMediaEvent(event) {
        if (!isPageEnabled() || !isYouTube || !isTopFrame || !isMedia(event.target)) return;
        const player = adPlayer && adPlayer.isConnected ? adPlayer : findYouTubePlayer();
        if (!player || !player.contains(event.target) || !hasYouTubeAdState(player)) return;
        checkYouTubeAds();
    }

    ["play", "playing", "loadedmetadata", "volumechange", "ratechange"].forEach(type => {
        document.addEventListener(type, handleAdMediaEvent, true);
    });

    let injectLanguageStyle = null;

    if (isYouTube && isTopFrame) {
        // Keep the style lifecycle tied to the active Watch/Shorts route.
        injectLanguageStyle = () => {
            if (!isPageEnabled()) return;
            injectAdsStyles();
        };

        if (document.readyState === "loading") {
            // Install discovery as early as document-start permits. Keep the
            // DOMContentLoaded retry for cases where documentElement is not ready.
            installPlayerDiscoveryObserver();
            document.addEventListener("DOMContentLoaded", () => {
                injectLanguageStyle();
                installPlayerDiscoveryObserver();
            }, { once: true });
        } else {
            injectLanguageStyle();
            installPlayerDiscoveryObserver();
        }

        window.addEventListener("yt-navigate-finish", handleYouTubeRouteChange);
        window.addEventListener("yt-page-data-updated", handleYouTubeRouteChange);
        window.addEventListener("load", schedulePlayerBind, { once: true });

        if (isPageEnabled()) schedulePlayerBind();
    }

    function handleYouTubeRouteChange() {
        if (!isYouTube || !isTopFrame) return;

        const targetActive = isTargetYouTubePage();

        if (!targetActive) {
            pageEnabled = false;
            panelVisible = false;
            if (panel) panel.style.display = "none";

            stopAdRetryLoop();
            if (playerBindTimer !== null) {
                clearTimeout(playerBindTimer);
                playerBindTimer = null;
            }
            if (adPlayerObserver) {
                adPlayerObserver.disconnect();
                adPlayerObserver = null;
            }
            disconnectPlayerDiscoveryObserver();
            if (adWasActive || adVideo) restoreAfterAd();
            adPlayer = null;

            if (activeMedia) {
                activeMedia.removeEventListener("ended", checkLoop);

                const previousRate = originalPlaybackRates.get(activeMedia);
                if (isSpeedForced && Number.isFinite(previousRate)) {
                    activeMedia.playbackRate = previousRate;
                    activeMedia.defaultPlaybackRate = previousRate;
                }
                originalPlaybackRates.delete(activeMedia);

                disconnectDetachedAudioGraph(activeMedia);
                activeMedia = null;
            }

            const style = document.getElementById("ymcs-ad-bypass-style");
            if (style) style.remove();
            adStyleInjected = false;

            if (forceResumeTimer !== null) {
                clearInterval(forceResumeTimer);
                forceResumeTimer = null;
            }
            return;
        }

        pageEnabled = true;
        if (injectLanguageStyle) injectLanguageStyle();
        installPlayerDiscoveryObserver();
        schedulePlayerBind();
        mountPanel();
        updateForceResumeTimer();
    }

    // =========================================================
    // MEDIA VALIDATION
    // =========================================================

    function isMedia(el) {
        return !!(
            el &&
            (
                el.tagName === "VIDEO" ||
                el.tagName === "AUDIO"
            )
        );
    }

    function isUsableMedia(m) {
        if (!isMedia(m)) return false;
        if (!document.contains(m)) return false;

        if (m.readyState < 2) return false;
        if (m.ended) return false;

        return true;
    }

    function isActuallyPlaying(m) {
        if (!isUsableMedia(m)) return false;

        return (
            !m.paused &&
            !m.ended &&
            m.readyState >= 2
        );
    }

    function isRelevantMedia(m) {
        if (!isPageEnabled() || !isUsableMedia(m)) return false;

        if (m.tagName === "AUDIO") {
            return true;
        }

        const rect = m.getBoundingClientRect();

        const hasVisualSize =
            rect.width > 40 &&
            rect.height > 40;

        const isVisible =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;

        return hasVisualSize && isVisible;
    }

    // =========================================================
    // FORCE RESUME KERNEL
    // =========================================================

    function resumeMedia(m) {
        if (
            !isPageEnabled() ||
            !settings.forceResume ||
            !m ||
            userPausedMedia.has(m) ||
            !document.contains(m) ||
            (isYouTubeAdActive() && m.tagName === "VIDEO") ||
            m.ended ||
            m.seeking
        ) {
            return;
        }

        try {
            const p = m.play();

            if (p && typeof p.catch === "function") {
                p.catch(() => {});
            }
        } catch (e) {}
    }

    function resumeYouTube() {
        if (!isPageEnabled() || !settings.forceResume || !isYouTube || isYouTubeAdActive()) {
            return;
        }

        try {
            const player =
                document.getElementById("movie_player") ||
                document.querySelector(".html5-video-player");

            if (
                player &&
                typeof player.getPlayerState === "function" &&
                typeof player.playVideo === "function"
            ) {
                const state = player.getPlayerState();

                const video = document.querySelector("video");
                if (state === 2 && video && !userPausedMedia.has(video)) {
                    player.playVideo();
                }
            }
        } catch (e) {}

        const video = document.querySelector("video");

        if (
            video &&
            video.paused &&
            !video.ended &&
            !video.seeking
        ) {
            resumeMedia(video);
        }
    }

    document.addEventListener(
        "visibilitychange",
        () => {
            if (!isPageEnabled() || !settings.forceResume) return;

            resumeMedia(activeMedia);

            if (isYouTube) {
                resumeYouTube();
            }
        },
        true
    );

    // =========================================================
    // AUDIO / VIDEO CORE
    // =========================================================

    function applyMediaSettings(m, fromScriptUI = false) {
        if (
            !isPageEnabled() ||
            !m ||
            volLock ||
            !document.contains(m) ||
            (isYouTubeAdActive() && m.tagName === "VIDEO")
        ) {
            return;
        }

        // SPEED
        if (isSpeedForced) {
            try {
                if (!originalPlaybackRates.has(m)) {
                    originalPlaybackRates.set(m, m.playbackRate || 1);
                }
                const safeSpeed = Math.max(
                    0.1,
                    Math.min(5, customSpeed)
                );

                if (m.playbackRate !== safeSpeed) {
                    m.playbackRate = safeSpeed;
                    m.defaultPlaybackRate = safeSpeed;
                }
            } catch (e) {}
        }

        let data = audioCtxMap.get(m);
        reconnectAudioGraph(data);

        // AUDIO BOOST
        if (settings.enableBoost) {
            if (!data) {
                try {
                    const Ctx =
                        window.AudioContext ||
                        window.webkitAudioContext;

                    if (Ctx) {
                        if (
                            !globalAudioCtx ||
                            globalAudioCtx.state === "closed"
                        ) {
                            globalAudioCtx = new Ctx();
                        }

                        const source =
                            globalAudioCtx.createMediaElementSource(m);

                        const gain =
                            globalAudioCtx.createGain();

                        source.connect(gain);
                        gain.connect(globalAudioCtx.destination);

                        data = {
                            ctx: globalAudioCtx,
                            gain,
                            source,
                            disconnected: false
                        };

                        audioCtxMap.set(m, data);
                    }
                } catch (e) {}
            }

            if (
                data &&
                data.ctx.state === "suspended"
            ) {
                data.ctx.resume().catch(() => {});
            }

            volLock = true;

            try {
                m.volume =
                    settings.vol > 1
                        ? 1
                        : settings.vol;

                const gainVal =
                    settings.vol > 1
                        ? settings.vol
                        : 1;

                if (data && data.gain) {
                    try {
                        data.gain.gain.setTargetAtTime(
                            gainVal,
                            data.ctx.currentTime,
                            0.05
                        );
                    } catch (e) {
                        data.gain.gain.value = gainVal;
                    }
                }
            } finally {
                volLock = false;
            }

        } else {
            if (data && data.ctx && data.ctx.state === "suspended") {
                data.ctx.resume().catch(() => {});
            }

            if (data && data.gain) {
                try {
                    data.gain.gain.setTargetAtTime(
                        1,
                        data.ctx.currentTime,
                        0.05
                    );
                } catch (e) {
                    data.gain.gain.value = 1;
                }
            }

            if (fromScriptUI) {
                volLock = true;

                try {
                    m.volume = Math.min(
                        settings.vol,
                        1
                    );
                } finally {
                    volLock = false;
                }
            }
        }
    }

    // =========================================================
    // YOUTUBE QUALITY
    // =========================================================

    function applyYouTubeQuality() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame) {
            return;
        }

        try {
            localStorage.setItem(
                "yt-player-quality",
                JSON.stringify({
                    data: settings.q,
                    creation: Date.now()
                })
            );

            const player =
                document.getElementById("movie_player") ||
                document.querySelector(".html5-video-player");

            if (!player) return;

            if (
                typeof player.setPlaybackQualityRange ===
                "function"
            ) {
                player.setPlaybackQualityRange(
                    settings.q,
                    settings.q
                );
            }

            if (
                typeof player.setPlaybackQuality ===
                "function"
            ) {
                player.setPlaybackQuality(settings.q);
            }
        } catch (e) {}
    }

    // =========================================================
    // ACTIVE MEDIA
    // =========================================================

    function setActiveMedia(m) {
        if (!isActuallyPlaying(m)) {
            return;
        }

        if (m !== activeMedia) {
            if (activeMedia) {
                activeMedia.removeEventListener("ended", checkLoop);

                if (isSpeedForced) {
                    const previousRate = originalPlaybackRates.get(activeMedia);
                    if (Number.isFinite(previousRate)) {
                        activeMedia.playbackRate = previousRate;
                        activeMedia.defaultPlaybackRate = previousRate;
                    }
                    originalPlaybackRates.delete(activeMedia);
                }

                disconnectDetachedAudioGraph(activeMedia);
            }

            activeMedia = m;

            activeMedia.addEventListener("ended", checkLoop);

            applyYouTubeQuality();
            updateForceResumeTimer();
        }

        applyMediaSettings(
            activeMedia,
            false
        );
        // Đã xóa hoàn toàn tự động pop-up UI ở đây!
    }

    // =========================================================
    // MEDIA PLAY / PAUSE / EVENTS
    // =========================================================

    document.addEventListener(
        "play",
        (e) => {
            const target = e.target;

            if (!isPageEnabled() || !isMedia(target)) return;
            if (!isActuallyPlaying(target)) return;
            if (!isRelevantMedia(target)) return;

            userPausedMedia.delete(target);
            setActiveMedia(target);
        },
        true
    );

    let resumeTimeout = null;

    document.addEventListener("pointerdown", e => {
        if (!isPageEnabled()) return;
        const player = isYouTube
            ? document.querySelector("#movie_player, .html5-video-player")
            : null;
        if (player && (player === e.target || player.contains(e.target))) {
            recentPlayerInteractionUntil = Date.now() + 1200;
        } else if (activeMedia && (e.target === activeMedia || activeMedia.contains(e.target))) {
            recentPlayerInteractionUntil = Date.now() + 1200;
        }
    }, true);

    document.addEventListener("keydown", e => {
        if (!isPageEnabled() || !isYouTube) return;
        if ([" ", "k", "K"].includes(e.key)) {
            const player = document.querySelector("#movie_player, .html5-video-player");
            if (player && (player.contains(e.target) || e.target === document.body)) {
                recentPlayerInteractionUntil = Date.now() + 1200;
            }
        }
    }, true);

    document.addEventListener(
        "pause",
        (e) => {
            const target = e.target;

            if (!isPageEnabled() || !isMedia(target)) return;
            if (!settings.forceResume) return;

            if (Date.now() < recentPlayerInteractionUntil) {
                userPausedMedia.add(target);
                return;
            }

            if (
                target === activeMedia ||
                isYouTube
            ) {
                if (resumeTimeout !== null) {
                    clearTimeout(resumeTimeout);
                }

                resumeTimeout = setTimeout(() => {
                    resumeTimeout = null;
                    if (
                        !target ||
                        !document.contains(target) ||
                        isYouTubeAdActive()
                    ) {
                        return;
                    }

                    resumeMedia(target);

                    if (isYouTube) {
                        resumeYouTube();
                    }
                }, 80);
            }
        },
        true
    );

    document.addEventListener(
        "volumechange",
        (e) => {
            const target = e.target;

            if (
                !isPageEnabled() ||
                !isMedia(target) ||
                volLock
            ) {
                return;
            }

            if (!settings.enableBoost && target === activeMedia) {
                settings.vol = target.volume;

                updateVolUI(
                    settings.vol
                );

                saveSettings();
            } else if (settings.enableBoost && target === activeMedia) {
                applyMediaSettings(target, false);
            }
        },
        true
    );

    document.addEventListener(
        "ratechange",
        (e) => {
            const target = e.target;
            if (!isPageEnabled() || !isMedia(target)) return;

            if (isYouTubeAdActive() && target.tagName === "VIDEO") {
                // If YouTube or another handler changes rate during an ad,
                // immediately bring it back to normal speed.
                if (adVideo === target) enforceAdVideoState(target);
                return;
            }

            if (!isSpeedForced || target !== activeMedia) return;

            const expectedSpeed = Math.max(0.1, Math.min(5, customSpeed));
            if (Math.abs(target.playbackRate - expectedSpeed) > 0.01) {
                target.playbackRate = expectedSpeed;
            }
        },
        true
    );

    function checkLoop() {
        const media = activeMedia;
        if (
            !isPageEnabled() ||
            !settings.loop ||
            !media ||
            !document.contains(media) ||
            isYouTubeAdActive()
        ) {
            return;
        }

        try {
            media.currentTime = 0;
            const playPromise = media.play();
            if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {});
            }
        } catch (_) {}
    }

    // =========================================================
    // UI
    // =========================================================

    const panel = isTopFrame
        ? document.createElement("div")
        : null;

    if (panel) {
        panel.id = "vcp-panel";
        panel.innerHTML = `
        <span>🔊</span>
        <span id="vcp-status" style="display: none; font-size: 11px; color: #ff6b6b; font-style: italic; margin-left: 2px;">No active media</span>

        <input
            type="range"
            id="vcp-slider"
            step="0.1"
            min="0"
            max="5"
            value="${settings.vol}"
        >

        <input
            type="number"
            id="vcp-vol"
            step="0.1"
            min="0"
            max="5"
            value="${Number(settings.vol).toFixed(2)}"
        >

        <div id="vcp-speed">
            <button
                id="vcp-btn-3x"
                title="Bật/Tắt Ép Tốc độ (Mặc định 3x)"
            >
                3x
            </button>

            <input
                type="number"
                id="vcp-spd-input"
                step="0.1"
                min="0.1"
                max="5"
                value="3"
                disabled
                title="Chỉ hoạt động khi bật tốc độ"
            >
        </div>

        <select
            id="vcp-quality"
            title="Độ phân giải (Chỉ YT)"
        >
            <option value="auto">Auto</option>
            <option value="tiny">144p</option>
            <option value="small">240p</option>
            <option value="medium">360p</option>
            <option value="large">480p</option>
            <option value="hd720">720p</option>
            <option value="hd1080">1080p</option>
            <option value="hd1440">1440p</option>
            <option value="hd2160">4K</option>
        </select>

        <select
            id="vcp-ad-mode"
            title="Chế độ bỏ qua quảng cáo YouTube"
        >
            <option value="none">Ads: None</option>
            <option value="normal" title="20x when supported; falls back to the browser's 16x ceiling when needed">Ads: Normal 20x*</option>
            <option value="instant">Ads: Instant</option>
        </select>

        <label
            title="Kích hoạt Audio Boost (Tắt đi để trả quyền cho trình duyệt)"
        >
            <input
                type="checkbox"
                id="vcp-boost"
                ${settings.enableBoost ? "checked" : ""}
            >
            <span>🚀</span>
        </label>

        <label title="Auto Loop">
            <input
                type="checkbox"
                id="vcp-loop"
                ${settings.loop ? "checked" : ""}
            >
            <span>🔁</span>
        </label>

        <label title="Force Resume (Anti-Pause)">
            <input
                type="checkbox"
                id="vcp-force"
                ${settings.forceResume ? "checked" : ""}
            >
            <span>⏯️</span>
        </label>

        <button id="vcp-close">×</button>
        `;
    }

    if (isTopFrame) GM_addStyle(`
        #vcp-panel {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 8px 12px;
            background: #1e1e1e;
            border-radius: 20px;
            z-index: 2147483647;
            font: 13px Arial, sans-serif;
            color: #fff;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            display: none;
            align-items: center;
            gap: 8px;
            border: 1px solid #444;
            user-select: none;
        }

        #vcp-slider {
            width: 80px;
            height: 6px;
            appearance: none;
            background: #444;
            border-radius: 3px;
            cursor: pointer;
            outline: none;
        }

        #vcp-slider::-webkit-slider-thumb {
            appearance: none;
            width: 14px;
            height: 14px;
            background: #4CAF50;
            border-radius: 50%;
        }

        #vcp-vol {
            width: 45px;
            padding: 2px;
            border: none;
            border-radius: 5px;
            text-align: center;
            background: #333;
            color: #fff;
            font-size: 12px;
        }

        #vcp-vol.boost {
            color: #ff9800;
            font-weight: bold;
        }

        #vcp-speed {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        #vcp-speed button {
            padding: 3px 6px;
            border: none;
            border-radius: 5px;
            background: #333;
            color: #fff;
            cursor: pointer;
            font-size: 11px;
        }

        #vcp-speed button.active {
            background: #4CAF50;
            font-weight: bold;
        }

        #vcp-spd-input {
            width: 42px;
            padding: 2px;
            border: 1px solid #555;
            border-radius: 5px;
            text-align: center;
            background: #333;
            color: #fff;
            font-size: 12px;
        }

        #vcp-spd-input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        #vcp-quality,
        #vcp-ad-mode {
            background: #333;
            color: #fff;
            border: 1px solid #555;
            border-radius: 5px;
            padding: 2px;
            font-size: 11px;
            cursor: pointer;
            outline: none;
        }

        #vcp-panel label {
            cursor: pointer;
            padding: 0 3px;
            display: flex;
            align-items: center;
        }

        #vcp-panel input[type="checkbox"] {
            display: none;
        }

        #vcp-panel label span {
            opacity: 0.4;
            font-size: 15px;
            filter: grayscale(100%);
            transition: 0.2s;
        }

        #vcp-panel input:checked + span {
            opacity: 1;
            filter: grayscale(0%);
        }

        #vcp-close {
            background: none;
            border: none;
            color: #fff;
            font-size: 18px;
            cursor: pointer;
            padding-left: 5px;
            line-height: 1;
        }
    `);

    // =========================================================
    // PANEL MOUNT
    // =========================================================

    function mountPanel() {
        if (!isPageEnabled() || !isTopFrame || !panel) return;

        const targetParent =
            document.fullscreenElement ||
            document.body ||
            document.documentElement;

        if (
            targetParent &&
            !targetParent.contains(panel)
        ) {
            targetParent.appendChild(panel);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountPanel);
    } else {
        mountPanel();
    }

    if (isTopFrame) document.addEventListener("fullscreenchange", mountPanel);

    // =========================================================
    // CONTROLS
    // =========================================================

    const ui = panel ? {
        status: panel.querySelector("#vcp-status"),
        slider: panel.querySelector("#vcp-slider"),
        vol: panel.querySelector("#vcp-vol"),
        btn3x: panel.querySelector("#vcp-btn-3x"),
        spdInput: panel.querySelector("#vcp-spd-input"),
        quality: panel.querySelector("#vcp-quality"),
        adMode: panel.querySelector("#vcp-ad-mode"),
        boost: panel.querySelector("#vcp-boost"),
        loop: panel.querySelector("#vcp-loop"),
        force: panel.querySelector("#vcp-force")
    } : null;

    if (ui && !isYouTube) {
        ui.quality.style.display = "none";
        ui.adMode.style.display = "none";
    }

    function saveSettings() {
        const stData = {
            vol: settings.vol,
            loop: settings.loop,
            forceResume: settings.forceResume,
            q: settings.q,
            enableBoost: settings.enableBoost,
            adMode: settings.adMode
        };

        GM_setValue(
            "vcp_settings",
            normalizeSettings(stData)
        );
    }

    function updateVolUI(v) {
        if (!ui) return;
        ui.slider.value = v;

        ui.vol.value =
            Number(v).toFixed(2);

        ui.vol.classList.toggle(
            "boost",
            v > 1 &&
            settings.enableBoost
        );
    }

    function handleVolChange(val) {
        let v =
            parseFloat(val) || 0;

        if (
            !settings.enableBoost &&
            v > 1
        ) {
            v = 1;
        }

        settings.vol =
            Math.max(
                0,
                Math.min(5, v)
            );

        updateVolUI(settings.vol);

        if (activeMedia) {
            applyMediaSettings(
                activeMedia,
                true
            );
        }

        saveSettings();
    }

    function applyAdModeChange() {
        if (!isYouTube || !isTopFrame || !isPageEnabled()) return;

        if (settings.adMode === "none") {
            // None means no ad mute, rate change, seek, Skip click, or ad CSS.
            stopAdRetryLoop();
            if (adVideo) restoreAdVideo(adVideo);
            adWasActive = false;
            lastSkipAttemptAt = 0;
            lastAdSeekAt = 0;
            removeAdsStyles();
            return;
        }

        injectAdsStyles();
        lastAdSeekAt = 0;
        checkYouTubeAds();
    }

    if (ui) {
        ui.slider.oninput = e => handleVolChange(e.target.value);
        ui.vol.onchange = e => handleVolChange(e.target.value);

        ui.boost.onchange = e => {
            settings.enableBoost = e.target.checked;

            if (!settings.enableBoost && settings.vol > 1) {
                settings.vol = 1;
            }

            updateVolUI(settings.vol);

            if (activeMedia) {
                applyMediaSettings(activeMedia, true);
            }

            saveSettings();
        };

        ui.loop.onchange = e => {
            settings.loop = e.target.checked;
            saveSettings();
        };

        ui.force.onchange = e => {
            settings.forceResume = e.target.checked;
            saveSettings();
            updateForceResumeTimer();

            if (settings.forceResume) {
                resumeMedia(activeMedia);

                if (isYouTube) {
                    resumeYouTube();
                }
            }
        };

        ui.quality.onchange = e => {
            settings.q = e.target.value;
            applyYouTubeQuality();
            saveSettings();
        };

        ui.adMode.onchange = e => {
            settings.adMode = VALID_AD_MODES.has(e.target.value)
                ? e.target.value
                : DEFAULT_SETTINGS.adMode;
            applyAdModeChange();
            saveSettings();
        };

        // SPEED
        ui.btn3x.onclick = () => {
            isSpeedForced = !isSpeedForced;

            if (!isSpeedForced) {
                ui.btn3x.classList.remove("active");
                ui.spdInput.disabled = true;

                if (activeMedia && !isYouTubeAdActive()) {
                    const previousRate = originalPlaybackRates.get(activeMedia);
                    const restoreRate = Number.isFinite(previousRate) ? previousRate : 1;
                    activeMedia.playbackRate = restoreRate;
                    activeMedia.defaultPlaybackRate = restoreRate;
                    originalPlaybackRates.delete(activeMedia);
                }

            } else {
                ui.btn3x.classList.add("active");
                ui.spdInput.disabled = false;
                customSpeed = parseFloat(ui.spdInput.value) || 3;

                if (activeMedia) {
                    if (!originalPlaybackRates.has(activeMedia)) {
                        const adState = adMediaStates.get(activeMedia);
                        const baselineRate = adState && Number.isFinite(adState.playbackRate)
                            ? adState.playbackRate
                            : (activeMedia.playbackRate || 1);
                        originalPlaybackRates.set(activeMedia, baselineRate);
                    }
                    applyMediaSettings(activeMedia, false);
                }
            }
        };

        ui.spdInput.onchange = e => {
            if (!isSpeedForced) return;

            let val = parseFloat(e.target.value);
            if (isNaN(val)) return;

            val = Math.max(0.1, Math.min(5, val));
            ui.spdInput.value = val;
            customSpeed = val;

            if (activeMedia) {
                applyMediaSettings(activeMedia, false);
            }
        };
    }

    // =========================================================
    // PANEL TOGGLE & MEDIA CHECK
    // =========================================================

    function findAndSetActiveMedia() {
        if (!isPageEnabled()) return;
        if (activeMedia && (!document.contains(activeMedia) || !isActuallyPlaying(activeMedia))) {
            activeMedia.removeEventListener("ended", checkLoop);
            disconnectDetachedAudioGraph(activeMedia);
            activeMedia = null;
        }

        if (!activeMedia) {
            const mediaList = document.querySelectorAll("video, audio");
            for (const media of mediaList) {
                if (isActuallyPlaying(media) && isRelevantMedia(media)) {
                    setActiveMedia(media);
                    break;
                }
            }
        }
    }

    function togglePanel(show = !panelVisible) {
        panelVisible = show;

        if (!ui || !isPageEnabled()) {
            if (panel) panel.style.display = "none";
            panelVisible = false;
            return;
        }
        if (show) {
            findAndSetActiveMedia();
            const hasMedia = activeMedia && document.contains(activeMedia) && isActuallyPlaying(activeMedia);
            ui.status.style.display = hasMedia ? "none" : "inline";
        }

        panel.style.display = show ? "flex" : "none";
    }

    if (ui) {
        panel.querySelector("#vcp-close").onclick = () => {
            togglePanel(false);
        };
    }

    if (ui) document.addEventListener(
        "keydown",
        e => {
            const el = e.target;

            if (!isPageEnabled()) return;
            if (
                el &&
                (
                    el.tagName === "INPUT" ||
                    el.tagName === "TEXTAREA" ||
                    el.tagName === "SELECT" ||
                    el.isContentEditable
                )
            ) {
                return;
            }

            if (e.key === "*") {
                e.preventDefault();
                togglePanel();
            } else if (e.key === "Escape" && panelVisible) {
                togglePanel(false);
            }
        }
    );

    updateVolUI(settings.vol);
    if (ui) {
        ui.quality.value = settings.q;
        ui.adMode.value = settings.adMode;
    }

    // =========================================================
    // LOW CPU FALLBACK
    // =========================================================

    let forceResumeTimer = null;

    function updateForceResumeTimer() {
        if (!isPageEnabled()) {
            if (forceResumeTimer !== null) {
                clearInterval(forceResumeTimer);
                forceResumeTimer = null;
            }
            return;
        }

        const mediaExists = Boolean(
            activeMedia || document.querySelector("video, audio")
        );

        if (settings.forceResume && mediaExists && forceResumeTimer === null) {
            forceResumeTimer = setInterval(() => {
                if (!isPageEnabled() || isYouTubeAdActive()) return;

                if (
                    activeMedia &&
                    (!document.contains(activeMedia) || activeMedia.ended)
                ) {
                    activeMedia.removeEventListener("ended", checkLoop);
                    disconnectDetachedAudioGraph(activeMedia);
                    activeMedia = null;
                }

                if (activeMedia) {
                    if (activeMedia.paused && !activeMedia.seeking && !userPausedMedia.has(activeMedia)) {
                        resumeMedia(activeMedia);
                        if (isYouTube) resumeYouTube();
                    }
                    return;
                }

                findAndSetActiveMedia();
            }, 3000);
        } else if (!settings.forceResume && forceResumeTimer !== null) {
            clearInterval(forceResumeTimer);
            forceResumeTimer = null;
        }
    }

    function refreshPanelFromSettings() {
        if (!ui || !isPageEnabled()) return;
        updateVolUI(settings.vol);
        ui.boost.checked = settings.enableBoost;
        ui.loop.checked = settings.loop;
        ui.force.checked = settings.forceResume;
        ui.quality.value = settings.q;
        ui.adMode.value = settings.adMode;
    }

    function applySyncedSettings(value) {
        if (!isPageEnabled() || !value || typeof value !== "object") return;
        const previousAdMode = settings.adMode;
        Object.assign(settings, normalizeSettings(value));
        if (previousAdMode !== settings.adMode) applyAdModeChange();
        refreshPanelFromSettings();
        updateForceResumeTimer();
        if (activeMedia) applyMediaSettings(activeMedia, true);
        if (isYouTube && isTopFrame) applyYouTubeQuality();
    }

    updateForceResumeTimer();

    // One settings listener synchronizes the top-frame panel with media in child frames.
    if (typeof GM_addValueChangeListener === "function") {
        try {
            GM_addValueChangeListener(
                "vcp_settings",
                (_key, _oldValue, newValue) => applySyncedSettings(newValue)
            );
        } catch (_) {}
    }

    window.addEventListener("pagehide", () => {
        stopAdRetryLoop();
        if (playerBindTimer !== null) {
            clearTimeout(playerBindTimer);
            playerBindTimer = null;
        }
        if (adPlayerObserver) {
            adPlayerObserver.disconnect();
            adPlayerObserver = null;
        }
        disconnectPlayerDiscoveryObserver();
        if (adWasActive || adVideo) restoreAfterAd();
        if (forceResumeTimer !== null) {
            clearInterval(forceResumeTimer);
            forceResumeTimer = null;
        }
        if (resumeTimeout !== null) {
            clearTimeout(resumeTimeout);
            resumeTimeout = null;
        }
    });

    window.addEventListener("pageshow", () => {
        if (isYouTube && isTopFrame) {
            handleYouTubeRouteChange();
        } else {
            updateForceResumeTimer();
        }
    });

})();
