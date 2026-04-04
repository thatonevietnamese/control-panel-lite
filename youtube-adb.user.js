// ==UserScript==
// @name         youtube-adb
// @namespace    https://github.com/iamfugui/youtube-adb
// @version      6.22-fixed
// @match        *://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @exclude      *://www.youtube.com/live_chat_replay*
// @exclude      *://www.youtube.com/persist_identity*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // CSS để ẩn quảng cáo giao diện
    // ============================================
    const adCss = `
        #masthead-ad, .video-ads.ytp-ad-module,
        ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer),
        tp-yt-paper-dialog:has(yt-mealbar-promo-renderer),
        ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
        #related #player-ads, #related ytd-ad-slot-renderer,
        ytd-ad-slot-renderer, yt-mealbar-promo-renderer,
        ytd-popup-container:has(a[href="/premium"]),
        ad-slot-renderer, ytm-companion-ad-renderer
        { display: none !important; }
    `;

    let styleEl = document.createElement('style');
    styleEl.textContent = adCss;
    (document.head || document.body).appendChild(styleEl);

    // ============================================
    // Kiểm tra video hợp lệ
    // ============================================
    function isVideoValid(v) {
        return v && 
               typeof v.duration === 'number' && 
               !isNaN(v.duration) && 
               v.duration > 0 && 
               v.duration !== Infinity;
    }

    // ============================================
    // Resume video an toàn
    // ============================================
    function resumeVideo() {
        const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (v && isVideoValid(v) && v.paused) {
            v.play().catch(() => {});
        }
    }

    // ============================================
    // Xóa overlay/popup
    // ============================================
    function removeOverlays() {
        // Xóa premium popup
        document.querySelectorAll('ytd-popup-container').forEach(el => {
            if (el.querySelector('a[href="/premium"]')) el.remove();
        });

        // Xóa backdrop
        document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(el => {
            if (el.hasAttribute('opened') || parseInt(el.style.zIndex) > 100) {
                el.className = '';
                el.removeAttribute('opened');
                el.remove();
            }
        });
    }

    // ============================================
    // Skip quảng cáo video
    // ============================================
    function skipAd() {
        const v = document.querySelector('.ad-showing video') || 
                  document.querySelector('video.html5-main-video') || 
                  document.querySelector('video');
        
        if (!v || !isVideoValid(v)) return;

        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
        const shortAd = document.querySelector('.video-ads.ytp-ad-module .ytp-ad-player-overlay, .ytp-ad-button-icon');

        // Skip button
        if (skipBtn) {
            if (v.currentTime > 0.5 && v.duration > 0.5) {
                v.currentTime = v.duration;
            } else {
                skipBtn.click();
            }
        } 
        // Quảng cáo ngắn
        else if (shortAd) {
            v.currentTime = v.duration;
            setTimeout(resumeVideo, 100);
        }

        // Resume nếu bị pause
        if (v.paused && v.currentTime >= 1) {
            v.play().catch(() => {});
        }
    }

    // ============================================
    // MutationObserver
    // ============================================
    let lastMutation = 0;
    const observer = new MutationObserver(() => {
        const now = Date.now();
        if (now - lastMutation < 100) return; // Debounce 100ms
        lastMutation = now;
        
        removeOverlays();
        skipAd();
        resumeVideo();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // ============================================
    // Initial cleanup
    // ============================================
    setTimeout(() => {
        removeOverlays();
        skipAd();
        resumeVideo();
    }, 1000);
})();
