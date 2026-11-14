// ==UserScript==
// @name         YouTube & Media Control Suite (Unified)
// @namespace    https://github.com/thatonevietnamese/media-control-suite
// @version      1.1.2
// @description  Aggressive YouTube Skip Ad retries; media controls run on YouTube Watch/Shorts only.
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
        enableBoost: false
    };

    const VALID_QUALITIES = new Set([
        "auto", "tiny", "small", "medium", "large",
        "hd720", "hd1080", "hd1440", "hd2160"
    ]);

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
            enableBoost: Boolean(raw.enableBoost)
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

    function isYouTubeMediaRoute() {
        if (!isYouTube) return true;

        // In YouTube's own SPA, use the top-level route so child frames follow
        // the same Watch/Shorts-only rule. On other sites, an embedded player
        // is not treated as a YouTube menu page.
        let pathname = location.pathname;
        try {
            const topURL = new URL(window.top.location.href);
            if (/(^|\.)youtube\.com$/i.test(topURL.hostname)) {
                pathname = topURL.pathname;
            }
        } catch (_) {}

        return pathname === "/watch" || /^\/shorts(?:\/|$)/i.test(pathname);
    }

    // On YouTube, the whole suite is active only on Watch and Shorts routes.
    // The small route listeners remain alive so SPA navigation can re-enable it.
    let pageEnabled = !isYouTube || isYouTubeMediaRoute();
    function isPageEnabled() {
        return pageEnabled && (!isYouTube || isYouTubeMediaRoute());
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
    // YOUTUBE AD BYPASS (TOP FRAME ONLY)
    // =========================================================

    const ADS_CONFIG = {
        debug: false,
        // First click is immediate. If YouTube ignores it, retry the same
        // still-visible button instead of permanently blacklisting the node.
        // Intentionally aggressive: retry frequently while an ad is active.
        retryDelay: 110,
        retryInterval: 90
    };

    const ADS_SELECTORS = {
        player: ["#movie_player", ".html5-video-player"],
        skipButtons: [
            ".ytp-ad-skip-button-modern",
            ".ytp-skip-ad-button",
            ".ytp-ad-skip-button",
            ".ytp-ad-skip-button-slot button",
            ".ytp-ad-skip-button-container button",
            ".ytp-ad-skip-button-slot [role=\"button\"]",
            ".ytp-ad-skip-button-container [role=\"button\"]"
        ]
    };

    const ADS_CLASSES = ["ad-showing", "ad-interrupting"];
    const ADS_QUERY = Object.fromEntries(
        Object.entries(ADS_SELECTORS).map(([key, values]) => [key, values.join(", ")])
    );

    let adPlayer = null;
    let adPlayerObserver = null;
    let playerDiscoveryObserver = null;
    let adVideo = null;
    let adWasActive = false;
    let lastAdActionAt = 0;
    let lastSkipButton = null;
    let adCheckScheduled = false;
    let playerBindScheduled = false;
    let adRetryTimer = null;
    let adSkipRetryTimer = null;
    let adRetryCount = 0;
    let adStyleInjected = false;

    function adsLog(message) {
        if (ADS_CONFIG.debug) {
            console.debug("[Media Control Suite / Ads]", message);
        }
    }

    function stopAdSkipRetry() {
        if (adSkipRetryTimer !== null) {
            clearInterval(adSkipRetryTimer);
            adSkipRetryTimer = null;
        }
    }

    function startAdSkipRetry() {
        if (adSkipRetryTimer !== null) return;

        // Poll only while an ad is active. MutationObserver remains the
        // primary instant trigger; this catches delayed/ignored button clicks.
        adSkipRetryTimer = setInterval(() => {
            if (!isPageEnabled() || !adPlayer || !adPlayer.isConnected) {
                stopAdSkipRetry();
                return;
            }
            checkYouTubeAds();
        }, ADS_CONFIG.retryInterval);
    }

    function isYouTubeAdActive() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame) return false;

        const player = adPlayer && adPlayer.isConnected
            ? adPlayer
            : document.querySelector(ADS_QUERY.player);

        return Boolean(
            player &&
            ADS_CLASSES.some(className => player.classList.contains(className))
        );
    }

    function injectAdsStyles() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame || adStyleInjected) return;

        const style = document.createElement("style");
        style.id = "ymcs-ad-bypass-style";
        style.textContent = `
            ${ADS_QUERY.skipButtons} {
                border: 1px solid #fd0 !important;
                background-color: rgba(255,230,50,0.22) !important;
                box-shadow: 0 0 8px rgba(255,204,0,.35) !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
        adStyleInjected = true;
    }

    function restoreAfterAd() {
        stopAdSkipRetry();
        adWasActive = false;
        lastSkipButton = null;
        lastAdActionAt = 0;
        adsLog("Ad ended; normal playback was left untouched");
    }

    function findEnabledSkipButtons(player) {
        if (!player) return [];

        const found = [];
        const buttons = player.querySelectorAll(ADS_QUERY.skipButtons);
        for (const button of buttons) {
            const disabled =
                button.disabled ||
                button.getAttribute("aria-disabled") === "true" ||
                button.hasAttribute("disabled");

            if (disabled || button.hidden || button.getAttribute("aria-hidden") === "true") {
                continue;
            }

            const style = window.getComputedStyle(button);
            if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
                continue;
            }

            const rect = button.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && button.isConnected) {
                found.push(button);
            }
        }
        return found;
    }

    function performAdSkip() {
        const player = adPlayer;
        if (!player || !player.isConnected || !isYouTubeAdActive()) return;

        const skipButtons = findEnabledSkipButtons(player);
        if (skipButtons.length === 0) return;

        const now = Date.now();
        // Keep retrying even when YouTube reuses the exact same button node.
        if (now - lastAdActionAt < ADS_CONFIG.retryDelay) return;

        lastAdActionAt = now;
        lastSkipButton = skipButtons[0];

        let clicked = false;
        for (const button of skipButtons) {
            try {
                // Only activate visible, enabled Skip Ad controls supplied by YouTube.
                // No seeking, playback-speed changes, or unrelated player controls.
                button.click();
                clicked = true;
            } catch (_) {}
        }

        adsLog(clicked
            ? `Clicked ${skipButtons.length} visible Skip Ad control(s)`
            : "Skip button click failed; it will be retried");
    }

    function scheduleAdCheck() {
        if (adCheckScheduled) return;
        adCheckScheduled = true;

        const run = () => {
            adCheckScheduled = false;
            checkYouTubeAds();
        };

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 0);
        }
    }

    function checkYouTubeAds() {
        if (!isPageEnabled() || !adPlayer || !adPlayer.isConnected) return;

        if (!adVideo || !adVideo.isConnected || adVideo.parentElement !== adPlayer) {
            adVideo = adPlayer.querySelector("video");
        }

        const active = ADS_CLASSES.some(className => adPlayer.classList.contains(className));

        if (active) {
            if (!adWasActive) {
                adWasActive = true;
                lastSkipButton = null;
                lastAdActionAt = 0;
                adsLog("Ad detected");
            }

            // Try immediately, then retry briefly while the ad remains active.
            performAdSkip();
            startAdSkipRetry();
        } else if (adWasActive) {
            restoreAfterAd();
        }
    }

    function bindYouTubePlayer() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame) return false;

        const nextPlayer = document.querySelector(ADS_QUERY.player);
        if (!nextPlayer) {
            if (adPlayer && !adPlayer.isConnected) {
                if (adPlayerObserver) {
                    adPlayerObserver.disconnect();
                    adPlayerObserver = null;
                }
                if (adWasActive) restoreAfterAd();
                adPlayer = null;
                adVideo = null;
            }
            return false;
        }

        if (nextPlayer !== adPlayer) {
            if (adPlayerObserver) {
                adPlayerObserver.disconnect();
                adPlayerObserver = null;
            }

            if (adWasActive) restoreAfterAd();

            adPlayer = nextPlayer;
            adVideo = adPlayer.querySelector("video");
        }

        // Reattach when a page is restored from BFCache or pagehide cleanup
        // disconnected the observer while the player DOM itself stayed alive.
        if (!adPlayerObserver) {
            adPlayerObserver = new MutationObserver(scheduleAdCheck);
            adPlayerObserver.observe(adPlayer, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: [
                    "class", "aria-disabled", "disabled", "hidden",
                    "aria-hidden", "style"
                ]
            });
        }

        checkYouTubeAds();
        return true;
    }

    function schedulePlayerBind() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame || playerBindScheduled) return;
        playerBindScheduled = true;

        setTimeout(() => {
            playerBindScheduled = false;
            bindYouTubePlayer();
        }, 0);
    }

    function observeForYouTubePlayer() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame || playerDiscoveryObserver) return;

        // YouTube can replace the player root after SPA navigation. Inspect
        // only added/removed subtrees that could contain the player, rather
        // than scheduling a bind for every unrelated page mutation.
        const root = document.documentElement || document;
        playerDiscoveryObserver = new MutationObserver(records => {
            if (!isPageEnabled()) return;

            let playerMayHaveChanged = false;
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches(ADS_QUERY.player) || node.querySelector(ADS_QUERY.player)) {
                        playerMayHaveChanged = true;
                        break;
                    }
                }

                if (!playerMayHaveChanged && adPlayer) {
                    for (const node of record.removedNodes) {
                        if (node === adPlayer || (node.nodeType === 1 && node.contains(adPlayer))) {
                            playerMayHaveChanged = true;
                            break;
                        }
                    }
                }

                if (playerMayHaveChanged) break;
            }

            if (playerMayHaveChanged) schedulePlayerBind();
        });
        playerDiscoveryObserver.observe(root, { childList: true, subtree: true });
    }

    function stopPlayerDiscoveryObserver() {
        if (playerDiscoveryObserver) {
            playerDiscoveryObserver.disconnect();
            playerDiscoveryObserver = null;
        }
    }

    function startPlayerBindRetries() {
        if (!isPageEnabled() || !isYouTube || !isTopFrame || adRetryTimer !== null) return;

        adRetryCount = 0;
        adRetryTimer = setInterval(() => {
            adRetryCount += 1;
            const ready = bindYouTubePlayer();
            if (ready || adRetryCount >= 24 || !isPageEnabled()) {
                clearInterval(adRetryTimer);
                adRetryTimer = null;
            }
        }, 350);
    }

    let injectLanguageStyle = null;

    if (isYouTube && isTopFrame) {
        injectLanguageStyle = () => {
            if (!isPageEnabled()) return;
            injectAdsStyles();
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", injectLanguageStyle, { once: true });
        } else {
            injectLanguageStyle();
        }

        observeForYouTubePlayer();
        window.addEventListener("yt-navigate-finish", handleYouTubeRouteChange);
        window.addEventListener("yt-page-data-updated", handleYouTubeRouteChange);
        window.addEventListener("load", bindYouTubePlayer, { once: true });

        startPlayerBindRetries();
    }

    function handleYouTubeRouteChange() {
        if (!isYouTube || !isTopFrame) return;

        if (!isYouTubeMediaRoute()) {
            pageEnabled = false;
            panelVisible = false;
            if (panel) panel.style.display = "none";

            if (adRetryTimer !== null) {
                clearInterval(adRetryTimer);
                adRetryTimer = null;
            }
            stopAdSkipRetry();
            stopPlayerDiscoveryObserver();

            if (adPlayerObserver) {
                adPlayerObserver.disconnect();
                adPlayerObserver = null;
            }
            if (adWasActive) restoreAfterAd();
            adPlayer = null;
            adVideo = null;

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
        startPlayerBindRetries();
        observeForYouTubePlayer();
        if (injectLanguageStyle) injectLanguageStyle();
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

            if (
                !isPageEnabled() ||
                !isSpeedForced ||
                !isMedia(target) ||
                target !== activeMedia ||
                isYouTubeAdActive()
            ) {
                return;
            }

            const expectedSpeed =
                Math.max(
                    0.1,
                    Math.min(5, customSpeed)
                );

            if (
                target.playbackRate !==
                expectedSpeed
            ) {
                target.playbackRate =
                    expectedSpeed;
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

        #vcp-quality {
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
        boost: panel.querySelector("#vcp-boost"),
        loop: panel.querySelector("#vcp-loop"),
        force: panel.querySelector("#vcp-force")
    } : null;

    if (ui && !isYouTube) {
        ui.quality.style.display = "none";
    }

    function saveSettings() {
        const stData = {
            vol: settings.vol,
            loop: settings.loop,
            forceResume: settings.forceResume,
            q: settings.q,
            enableBoost: settings.enableBoost
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
                        originalPlaybackRates.set(activeMedia, activeMedia.playbackRate || 1);
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
    if (ui) ui.quality.value = settings.q;

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
    }

    function applySyncedSettings(value) {
        if (!isPageEnabled() || !value || typeof value !== "object") return;
        Object.assign(settings, normalizeSettings(value));
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
        if (adRetryTimer !== null) {
            clearInterval(adRetryTimer);
            adRetryTimer = null;
        }
        if (adPlayerObserver) {
            adPlayerObserver.disconnect();
            adPlayerObserver = null;
        }
        stopAdSkipRetry();
        stopPlayerDiscoveryObserver();
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
