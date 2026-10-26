// ==UserScript==
// @name         YouTube ADB - CORE LITE
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.13
// @description  Lightweight player monitoring, bounded retries and safe SPA recovery
// @match        *://*.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 1. CONFIGURATION
    // =========================================================

    const STYLE_ID = 'youtube-adb-core-lite-style';

    const CSS_TEXT = `
        #masthead-ad,
        #related #player-ads,
        ytd-ad-slot-renderer,
        ytm-companion-ad-renderer,
        ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
        yt-mealbar-promo-renderer,
        .ytp-ad-overlay-container,
        .ytp-ad-overlay-slot,
        .ytp-ad-image-overlay {
            display: none !important;
        }
    `;

    const SKIP_SELECTORS = [
        'button.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-modern',
        'button.ytp-skip-ad-button-modern',
        '.ytp-skip-ad-button-modern',
        'button.ytp-skip-ad-button',
        '.ytp-skip-ad-button',
        'button.ytp-ad-skip-button',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-slot button',
        '.ytp-ad-skip-button-container button',
        'button[aria-label*="Skip ad" i]',
        'button[aria-label*="Skip ads" i]',
        'button[aria-label*="Bỏ qua quảng cáo" i]'
    ].join(',');

    const SKIP_RETRY_MS = 300;
    const AD_RETRY_MS = 150;
    const DOM_CHECK_DELAY_MS = 40;

    // Recovery protection.
    const RECOVERY_COOLDOWN_MS = 60000;
    const STALL_TIMEOUT_MS = 30000;
    const MAX_RECOVERY_ATTEMPTS = 2;

    // =========================================================
    // 2. STATE
    // =========================================================

    let started = false;

    let currentPlayer = null;
    let currentVideo = null;

    let playerClassObserver = null;
    let playerDomObserver = null;
    let rootObserver = null;
    let adUiObserver = null;
    let adUiTargets = [];

    let videoListeners = null;

    let refreshTimer = null;
    let adCheckTimer = null;
    let recoveryTimer = null;

    let adActive = false;
    let lastSkipClickAt = 0;

    let mutedVideoByScript = null;
    let mutedVideoOriginalState = null;

    let lastRecoveryAt = 0;
    let recoveryAttempts = 0;
    let recoveryVideo = null;
    let recoveryStartedAt = 0;

    // =========================================================
    // 3. PAGE / DOM HELPERS
    // =========================================================

    function isConnected(element) {
        return Boolean(element && element.isConnected);
    }

    function isWatchPage() {
        if (location.pathname !== '/watch') {
            return false;
        }

        return Boolean(
            new URLSearchParams(location.search).get('v')
        );
    }

    function isAdShowing(player) {
        return isWatchPage() &&
            isConnected(player) &&
            player.classList.contains('ad-showing');
    }

    function findPlayer() {
        if (!isWatchPage()) {
            return null;
        }

        const primary = document.getElementById('movie_player');

        if (isConnected(primary)) {
            return primary;
        }

        const fallback = document.querySelector(
            '.html5-video-player'
        );

        return isConnected(fallback) ? fallback : null;
    }

    function findVideo(player) {
        if (!isConnected(player) || !isWatchPage()) {
            return null;
        }

        const video = player.querySelector('video');

        return isConnected(video) ? video : null;
    }

    function installStyle() {
        if (!document.documentElement) {
            return;
        }

        const parent = document.head || document.documentElement;

        let style = document.getElementById(STYLE_ID);

        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS_TEXT;
        }

        if (style.parentNode !== parent) {
            parent.appendChild(style);
        }
    }

    // =========================================================
    // 4. SKIP BUTTON DETECTION
    // =========================================================

    function isVisibleControl(element, player) {
        if (
            !element ||
            !element.isConnected ||
            element.getClientRects().length === 0
        ) {
            return false;
        }

        for (
            let node = element;
            node && node !== player;
            node = node.parentElement
        ) {
            if (node.getAttribute('aria-hidden') === 'true') {
                return false;
            }

            const style = window.getComputedStyle(node);

            if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.visibility === 'collapse' ||
                Number(style.opacity) === 0
            ) {
                return false;
            }
        }

        return true;
    }

    function findSkipButton(player) {
        if (!isConnected(player) || !isWatchPage()) {
            return null;
        }

        const candidates = player.querySelectorAll(
            SKIP_SELECTORS
        );

        const checked = new Set();

        for (const candidate of candidates) {
            if (!candidate.isConnected) {
                continue;
            }

            let control = candidate;

            if (!candidate.matches('button,[role="button"]')) {
                const nested = candidate.querySelector(
                    'button,[role="button"]'
                );

                if (nested) {
                    control = nested;
                }
            }

            if (checked.has(control)) {
                continue;
            }

            checked.add(control);

            if (
                control.disabled ||
                control.getAttribute('aria-disabled') === 'true' ||
                control.getAttribute('aria-hidden') === 'true'
            ) {
                continue;
            }

            if (!isVisibleControl(control, player)) {
                continue;
            }

            return control;
        }

        return null;
    }

    // =========================================================
    // 5. AUDIO STATE
    // =========================================================

    function restoreScriptMute() {
        if (
            mutedVideoByScript &&
            isConnected(mutedVideoByScript)
        ) {
            try {
                if (mutedVideoByScript.muted === true) {
                    mutedVideoByScript.muted =
                        Boolean(mutedVideoOriginalState);
                }
            } catch (_) {
                // Player may be changing during navigation.
            }
        }

        mutedVideoByScript = null;
        mutedVideoOriginalState = null;
    }

    function muteAdVideo(video) {
        if (!video || !isAdShowing(currentPlayer)) {
            return;
        }

        if (
            mutedVideoByScript &&
            mutedVideoByScript !== video
        ) {
            restoreScriptMute();
        }

        if (!video.muted) {
            try {
                mutedVideoOriginalState = video.muted;
                mutedVideoByScript = video;
                video.muted = true;
            } catch (_) {
                mutedVideoByScript = null;
                mutedVideoOriginalState = null;
            }
        }
    }

    // =========================================================
    // 6. AD STATE / BOUNDED RETRIES
    // =========================================================

    function stopAdRetry() {
        if (adCheckTimer !== null) {
            clearTimeout(adCheckTimer);
            adCheckTimer = null;
        }
    }

    function resetAdState() {
        stopAdRetry();
        restoreScriptMute();

        adActive = false;
        lastSkipClickAt = 0;
    }

    function scheduleAdRetry(player) {
        if (
            !started ||
            !isWatchPage() ||
            adCheckTimer !== null
        ) {
            return;
        }

        adCheckTimer = setTimeout(() => {
            adCheckTimer = null;

            if (
                !started ||
                !isWatchPage() ||
                player !== currentPlayer
            ) {
                return;
            }

            if (!isAdShowing(player)) {
                if (adActive) {
                    resetAdState();
                }

                return;
            }

            processAd(player);
        }, AD_RETRY_MS);
    }

    function processAd(player) {
        if (
            !started ||
            !isWatchPage() ||
            !isConnected(player)
        ) {
            resetAdState();
            return;
        }

        if (!isAdShowing(player)) {
            if (adActive) {
                resetAdState();
            }

            return;
        }

        const video = findVideo(player);

        if (!video) {
            scheduleAdRetry(player);
            return;
        }

        adActive = true;

        scheduleAdRetry(player);
        muteAdVideo(video);

        const skipButton = findSkipButton(player);

        if (skipButton) {
            const now = Date.now();

            if (now - lastSkipClickAt >= SKIP_RETRY_MS) {
                lastSkipClickAt = now;

                try {
                    skipButton.click();
                } catch (_) {
                    // Control may have been detached.
                }
            }
        }
    }

    function scheduleAdCheck(player) {
        if (
            !started ||
            !isWatchPage() ||
            adCheckTimer !== null
        ) {
            return;
        }

        adCheckTimer = setTimeout(() => {
            adCheckTimer = null;

            if (started && isWatchPage()) {
                processAd(player);
            }
        }, DOM_CHECK_DELAY_MS);
    }

    // =========================================================
    // 7. SAFE PLAYER RECOVERY
    // =========================================================

    function clearRecoveryTimer() {
        if (recoveryTimer !== null) {
            clearTimeout(recoveryTimer);
            recoveryTimer = null;
        }
    }

    function resetRecoveryState() {
        clearRecoveryTimer();

        recoveryVideo = null;
        recoveryStartedAt = 0;
        recoveryAttempts = 0;
    }

    function isPlayerError(player, video) {
        if (
            !isWatchPage() ||
            !isConnected(player) ||
            !isConnected(video)
        ) {
            return false;
        }

        // Native media errors are concrete failure signals.
        if (video.error && video.error.code !== 0) {
            return true;
        }

        // YouTube's player error screen.
        const errorScreen = player.querySelector(
            '.ytp-error, .ytp-error-content-wrap'
        );

        if (
            errorScreen &&
            errorScreen.getClientRects().length > 0
        ) {
            return true;
        }

        return false;
    }

    function requestRecoveryReload(player, video) {
        if (
            !started ||
            !isWatchPage() ||
            player !== currentPlayer ||
            video !== currentVideo
        ) {
            return;
        }

        const now = Date.now();

        if (
            now - lastRecoveryAt < RECOVERY_COOLDOWN_MS ||
            recoveryAttempts >= MAX_RECOVERY_ATTEMPTS
        ) {
            return;
        }

        lastRecoveryAt = now;
        recoveryAttempts++;

        // Reload only after a confirmed player error.
        location.reload();
    }

    function monitorPlayerRecovery(player, video) {
        if (
            !started ||
            !isWatchPage() ||
            player !== currentPlayer ||
            video !== currentVideo
        ) {
            return;
        }

        if (isPlayerError(player, video)) {
            requestRecoveryReload(player, video);
            return;
        }

        // A replaced video means the previous recovery target
        // is no longer valid.
        if (recoveryVideo !== video) {
            resetRecoveryState();
            recoveryVideo = video;
        }

        // Do not reload for a paused video, a normal end, an ad,
        // or a video that has not loaded metadata.
        if (
            isAdShowing(player) ||
            video.ended ||
            video.paused ||
            video.readyState < 2 ||
            video.seeking
        ) {
            recoveryStartedAt = 0;
            clearRecoveryTimer();
            return;
        }

        if (video.currentTime > 0) {
            // Playback is progressing; there is no stall.
            recoveryStartedAt = 0;
            clearRecoveryTimer();
            return;
        }

        // Only monitor a video that is actively attempting to play.
        if (!recoveryStartedAt) {
            recoveryStartedAt = Date.now();
            return;
        }

        if (
            Date.now() - recoveryStartedAt >= STALL_TIMEOUT_MS
        ) {
            // A stalled video alone is not proof of a blocked player.
            // Do not automatically reload based only on elapsed time.
            recoveryStartedAt = 0;
        }
    }

    // =========================================================
    // 8. VIDEO LISTENER LIFECYCLE
    // =========================================================

    function removeVideoListeners() {
        if (currentVideo && videoListeners) {
            for (const [eventName, handler] of videoListeners) {
                currentVideo.removeEventListener(
                    eventName,
                    handler
                );
            }
        }

        videoListeners = null;
        currentVideo = null;
        resetRecoveryState();
    }

    function hookVideo(video, player) {
        if (!isConnected(video) || !isWatchPage()) {
            removeVideoListeners();
            return;
        }

        if (video === currentVideo) {
            return;
        }

        removeVideoListeners();

        if (
            mutedVideoByScript &&
            mutedVideoByScript !== video
        ) {
            restoreScriptMute();
        }

        currentVideo = video;
        recoveryVideo = video;

        const onVideoActivity = () => {
            if (
                !started ||
                !isWatchPage() ||
                player !== currentPlayer ||
                video !== currentVideo
            ) {
                return;
            }

            if (isAdShowing(player)) {
                processAd(player);
            } else if (adActive) {
                resetAdState();
            }

            monitorPlayerRecovery(player, video);
        };

        const events = [
            'loadedmetadata',
            'durationchange',
            'play',
            'playing',
            'waiting',
            'stalled',
            'error',
            'ended',
            'emptied',
            'timeupdate'
        ];

        videoListeners = events.map((eventName) => [
            eventName,
            onVideoActivity
        ]);

        for (const [eventName, handler] of videoListeners) {
            video.addEventListener(eventName, handler, {
                passive: true
            });
        }
    }

    // =========================================================
    // 9. PLAYER OBSERVERS
    // =========================================================

    function disconnectObserver(observer) {
        if (observer) {
            observer.disconnect();
        }
    }

    function stopPlayerObservers() {
        disconnectObserver(playerClassObserver);
        disconnectObserver(playerDomObserver);
        disconnectObserver(adUiObserver);

        playerClassObserver = null;
        playerDomObserver = null;
        adUiObserver = null;
        adUiTargets = [];
    }

    function findAdUiTargets(player) {
        return Array.from(
            player.querySelectorAll(
                '.video-ads, .ytp-ad-module, .ytp-ad-player-overlay'
            )
        ).filter((element, _, candidates) =>
            !candidates.some(other =>
                other !== element && other.contains(element)
            )
        );
    }

    function sameElements(a, b) {
        return a.length === b.length &&
            a.every((element, index) => element === b[index]);
    }

    function updateAdUiObserver(player) {
        const targets = findAdUiTargets(player);

        if (sameElements(targets, adUiTargets)) {
            return;
        }

        disconnectObserver(adUiObserver);

        adUiObserver = null;
        adUiTargets = targets;

        if (!targets.length) {
            return;
        }

        adUiObserver = new MutationObserver(() => {
            if (isWatchPage() && isAdShowing(player)) {
                scheduleAdCheck(player);
            }
        });

        for (const target of targets) {
            adUiObserver.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'style',
                    'disabled',
                    'aria-disabled',
                    'aria-label'
                ]
            });
        }
    }

    function hookPlayer(player) {
        if (!isConnected(player) || !isWatchPage()) {
            return;
        }

        if (player === currentPlayer) {
            const video = findVideo(player);

            if (video !== currentVideo) {
                hookVideo(video, player);
            }

            updateAdUiObserver(player);

            if (isAdShowing(player)) {
                processAd(player);
            } else if (adActive) {
                resetAdState();
            }

            if (currentVideo) {
                monitorPlayerRecovery(player, currentVideo);
            }

            return;
        }

        stopPlayerObservers();
        removeVideoListeners();
        resetAdState();

        currentPlayer = player;

        playerClassObserver = new MutationObserver(() => {
            if (
                !started ||
                !isWatchPage() ||
                player !== currentPlayer
            ) {
                return;
            }

            if (isAdShowing(player)) {
                processAd(player);
            } else if (adActive) {
                resetAdState();
            }
        });

        playerClassObserver.observe(player, {
            attributes: true,
            attributeFilter: ['class']
        });

        playerDomObserver = new MutationObserver(() => {
            if (
                !started ||
                !isWatchPage() ||
                player !== currentPlayer
            ) {
                return;
            }

            const video = findVideo(player);

            if (video !== currentVideo) {
                hookVideo(video, player);
            }

            updateAdUiObserver(player);

            if (isAdShowing(player)) {
                scheduleAdCheck(player);
            }

            if (currentVideo) {
                monitorPlayerRecovery(player, currentVideo);
            }
        });

        playerDomObserver.observe(player, {
            childList: true,
            subtree: true
        });

        hookVideo(findVideo(player), player);
        updateAdUiObserver(player);

        if (isAdShowing(player)) {
            processAd(player);
        }
    }

    // =========================================================
    // 10. SPA REFRESH
    // =========================================================

    function refresh() {
        if (!started) {
            return;
        }

        installStyle();

        // Do not run player or ad checks on the homepage,
        // search pages, Shorts pages or other non-watch routes.
        if (!isWatchPage()) {
            stopAdRetry();

            if (adActive) {
                resetAdState();
            }

            stopPlayerObservers();
            removeVideoListeners();
            currentPlayer = null;

            return;
        }

        const player = findPlayer();

        if (!player) {
            if (
                currentPlayer &&
                !isConnected(currentPlayer)
            ) {
                stopPlayerObservers();
                removeVideoListeners();
                resetAdState();

                currentPlayer = null;
            }

            return;
        }

        hookPlayer(player);

        const video = findVideo(player);

        if (video !== currentVideo) {
            hookVideo(video, player);
        }
    }

    function queueRefresh(delay = 0) {
        if (!started) {
            return;
        }

        if (refreshTimer !== null) {
            if (delay > 0) {
                return;
            }

            clearTimeout(refreshTimer);
            refreshTimer = null;
        }

        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refresh();
        }, delay);
    }

    function onNavigation() {
        installStyle();
        queueRefresh(0);
    }

    function containsPlayerNode(node) {
        if (
            !node ||
            node.nodeType !== Node.ELEMENT_NODE ||
            !isWatchPage()
        ) {
            return false;
        }

        if (
            node.id === 'movie_player' ||
            (
                node.classList &&
                node.classList.contains('html5-video-player')
            )
        ) {
            return true;
        }

        return Boolean(
            node.querySelector &&
            node.querySelector(
                '#movie_player, .html5-video-player'
            )
        );
    }

    function startRootObserver() {
        if (rootObserver || !document.documentElement) {
            return;
        }

        rootObserver = new MutationObserver(mutations => {
            if (!isWatchPage()) {
                return;
            }

            if (
                !currentPlayer ||
                !isConnected(currentPlayer)
            ) {
                queueRefresh(DOM_CHECK_DELAY_MS);
                return;
            }

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (containsPlayerNode(node)) {
                        queueRefresh(0);
                        return;
                    }
                }

                for (const node of mutation.removedNodes) {
                    if (
                        node === currentPlayer ||
                        (
                            node.nodeType === Node.ELEMENT_NODE &&
                            node.contains(currentPlayer)
                        )
                    ) {
                        queueRefresh(0);
                        return;
                    }
                }
            }
        });

        rootObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    // =========================================================
    // 11. START / CLEANUP / BFCACHE
    // =========================================================

    function start() {
        if (started) {
            queueRefresh(0);
            return;
        }

        started = true;

        installStyle();
        startRootObserver();

        document.addEventListener(
            'yt-navigate-finish',
            onNavigation
        );

        document.addEventListener(
            'yt-page-data-updated',
            onNavigation
        );

        document.addEventListener(
            'yt-player-updated',
            onNavigation
        );

        window.addEventListener('popstate', onNavigation);

        queueRefresh(0);
    }

    function cleanup() {
        started = false;

        if (refreshTimer !== null) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }

        stopAdRetry();
        clearRecoveryTimer();
        stopPlayerObservers();

        disconnectObserver(rootObserver);
        rootObserver = null;

        document.removeEventListener(
            'yt-navigate-finish',
            onNavigation
        );

        document.removeEventListener(
            'yt-page-data-updated',
            onNavigation
        );

        document.removeEventListener(
            'yt-player-updated',
            onNavigation
        );

        window.removeEventListener('popstate', onNavigation);

        removeVideoListeners();
        resetAdState();

        currentPlayer = null;
    }

    window.addEventListener('pagehide', event => {
        if (!event.persisted) {
            cleanup();
        }
    });

    window.addEventListener('pageshow', () => {
        if (!started) {
            start();
        } else {
            queueRefresh(0);
        }
    });

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, {
            once: true
        });
    }
})();
