// ==UserScript==
// @name         YouTube ADB - CORE LITE (Fixed - No RAM Leak)
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.1
// @description  Cốt lõi diệt quảng cáo YouTube - Đã fix lỗi tràn RAM và sập UI.
// @match        *://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 1. CSS AN TOÀN HƠN (Đã bỏ selector gây sập UI lưới YouTube)
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

    function clearPolymerLocks() {
        const dismissBtn = document.querySelector('ytd-enforcement-message-view-model #dismiss-button, ytd-enforcement-message-view-model button[aria-label="Close"]');
        if (dismissBtn) dismissBtn.click();
        
        document.body.classList.remove('iron-disable-scroll');
        const overlay = document.querySelector('tp-yt-iron-overlay-backdrop.opened');
        if (overlay) {
            overlay.opened = false;
            overlay.classList.remove('opened');
        }
    }

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

        if (video.paused && video.currentTime < 1) {
            video.play().catch(() => {});
        }
    }

    // TỐI ƯU HÓA MUTATION OBSERVER (Chống tràn RAM)
    let isRunning = false;
    const observer = new MutationObserver(() => {
        // Nếu hàm đang chạy, bỏ qua các thay đổi DOM khác để tránh spam
        if (isRunning) return;
        isRunning = true;

        // Giới hạn tốc độ xử lý (Throttle 500ms)
        setTimeout(() => {
            handleVideoAds();
            if (document.querySelector('ytd-enforcement-message-view-model')) {
                clearPolymerLocks();
            }
            isRunning = false;
        }, 500); 
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        const initObserver = new MutationObserver(() => {
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
                initObserver.disconnect();
            }
        });
        initObserver.observe(document.documentElement, { childList: true });
    }
})();
