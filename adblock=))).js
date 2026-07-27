// ==UserScript==
// @name         YouTube ADB - CORE LITE (Cá Nhân)
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.3
// @description  Cốt lõi diệt quảng cáo YouTube - Bản tối ưu setInterval siêu nhẹ, dứt điểm tràn RAM
// @match        *://*.youtube.com/*
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/adblock%3D))).js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/adblock%3D))).js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 1. CSS Ẩn Quảng Cáo
    const adSelectors = [
        '#masthead-ad',
        '.video-ads.ytp-ad-module',
        'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        '#related #player-ads',
        'ytd-ad-slot-renderer',
        'yt-mealbar-promo-renderer',
        'ytm-companion-ad-renderer'
    ];

    const style = document.createElement('style');
    style.textContent = adSelectors.map(s => `${s}{display:none!important;}`).join(' ') + `
        html, body, ytd-app { overflow-y: auto !important; pointer-events: auto !important; }
        ytd-enforcement-message-view-model, 
        tp-yt-paper-dialog:has(ytd-enforcement-message-view-model) {
            display: none !important; visibility: hidden !important; pointer-events: none !important; opacity: 0 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 2. Hàm dọn dẹp Polymer (Anti-Adblock popup)
    function clearPolymerLocks() {
        const popup = document.querySelector('ytd-enforcement-message-view-model');
        if (!popup) return;

        const dismissBtn = popup.querySelector('#dismiss-button, button[aria-label="Close"]');
        if (dismissBtn) dismissBtn.click();
        
        document.body.classList.remove('iron-disable-scroll');
        const overlay = document.querySelector('tp-yt-iron-overlay-backdrop.opened');
        if (overlay) {
            overlay.opened = false;
            overlay.classList.remove('opened');
        }
    }

    // 3. Hàm xử lý Tua/Skip quảng cáo video
    function handleVideoAds() {
        const video = document.querySelector('.ad-showing video') || document.querySelector('video.html5-main-video');
        if (!video) return;

        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
        const hasAd = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-button-icon');

        if (skipBtn || hasAd) {
            video.muted = true;
            if (video.currentTime > 0.1) video.currentTime = video.duration || 999;
            if (skipBtn) skipBtn.click();
        }

        // Tự động play lại nếu bị ép pause
        if (video.paused && video.currentTime < 1) {
            video.play().catch(() => {});
        }
    }

    // 4. VÒNG LẶP ĐỊNH KỲ SIÊU NHẸ (Bỏ MutationObserver)
    // Chạy 500ms một lần, tiêu tốn chưa tới 0.01% CPU
    setInterval(() => {
        handleVideoAds();
        clearPolymerLocks();
    }, 500);

})();
