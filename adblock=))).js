// ==UserScript==
// @name         YouTube ADB - CORE LITE (Cá Nhân) - FIX SCROLL V2
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.5
// @description  Cốt lõi diệt quảng cáo YouTube - Không can thiệp cơ chế scroll
// @match        *://*.youtube.com/*
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/adblock%3D))).js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/adblock%3D))).js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 1. ẨN QUẢNG CÁO
    // =========================================================

    const adSelectors = [
        '#masthead-ad',
        '.video-ads.ytp-ad-module',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        '#related #player-ads',
        'ytd-ad-slot-renderer',
        'yt-mealbar-promo-renderer',
        'ytm-companion-ad-renderer'
    ];

    function injectAdCSS() {
        if (document.getElementById('yt-adb-core-lite-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'yt-adb-core-lite-style';

        style.textContent = adSelectors
            .map(selector => `${selector}{display:none!important;}`)
            .join('\n');

        (document.head || document.documentElement).appendChild(style);
    }

    injectAdCSS();

    // =========================================================
    // 2. XỬ LÝ ANTI-ADBLOCK POPUP
    //    KHÔNG đụng vào:
    //    - html overflow
    //    - body overflow
    //    - pointer-events
    //    - iron-disable-scroll
    //    - backdrop.opened
    // =========================================================

    function hideEnforcementMessage() {
        const popup = document.querySelector(
            'ytd-enforcement-message-view-model'
        );

        if (!popup) {
            return;
        }

        const dismissBtn = popup.querySelector(
            '#dismiss-button,' +
            ' button[aria-label="Close"],' +
            ' tp-yt-paper-button[aria-label="Close"]'
        );

        if (dismissBtn) {
            try {
                dismissBtn.click();
            } catch (_) {}
        }
    }

    // =========================================================
    // 3. XỬ LÝ VIDEO ADS
    //    Chỉ chạy khi thực sự có .ad-showing
    // =========================================================

    function handleVideoAds() {
        const adContainer = document.querySelector(
            '.html5-video-player.ad-showing'
        );

        if (!adContainer) {
            return;
        }

        const video = adContainer.querySelector('video');

        if (!video) {
            return;
        }

        // Mute quảng cáo
        try {
            video.muted = true;
        } catch (_) {}

        // Skip button
        const skipBtn = document.querySelector(
            '.ytp-ad-skip-button,' +
            '.ytp-skip-ad-button,' +
            '.ytp-ad-skip-button-modern'
        );

        if (skipBtn) {
            try {
                skipBtn.click();
            } catch (_) {}
        }

        // Tua quảng cáo đến cuối
        if (
            Number.isFinite(video.duration) &&
            video.duration > 0 &&
            video.currentTime > 0.05
        ) {
            try {
                video.currentTime = video.duration;
            } catch (_) {}
        }

        // Nếu quảng cáo bị pause thì cho chạy tiếp
        if (video.paused) {
            try {
                const promise = video.play();

                if (promise && typeof promise.catch === 'function') {
                    promise.catch(() => {});
                }
            } catch (_) {}
        }
    }

    // =========================================================
    // 4. LOOP
    // =========================================================

    let running = false;

    setInterval(() => {
        if (running) {
            return;
        }

        running = true;

        try {
            handleVideoAds();
            hideEnforcementMessage();
        } catch (_) {
            // Không để script làm crash YouTube
        }

        running = false;
    }, 700);

})();
