// ==UserScript==
// @name         YouTube ADB - CORE LITE (Cá Nhân)
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.0
// @description  Cốt lõi diệt quảng cáo YouTube - Tối ưu hóa tối đa, không rác, không check update.
// @match        *://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 1. DANH SÁCH SELECTOR QUẢNG CÁO TĨNH
    const adSelectors = [
        '#masthead-ad',
        'ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer)',
        '.video-ads.ytp-ad-module',
        'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        '#related #player-ads',
        '#related ytd-ad-slot-renderer',
        'ytd-ad-slot-renderer',
        'yt-mealbar-promo-renderer',
        'ad-slot-renderer',
        'ytm-companion-ad-renderer'
    ];

    // 2. TIÊM CSS CHẶN CỨNG & CHỐNG KHÓA MÀN HÌNH (Chạy ngay lập tức)
    const style = document.createElement('style');
    style.textContent = adSelectors.map(s => `${s}{display:none!important;}`).join(' ') + `
        html, body, ytd-app { overflow-y: auto !important; pointer-events: auto !important; }
        ytd-enforcement-message-view-model, 
        tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), 
        tp-yt-iron-overlay-backdrop.opened {
            display: none !important; visibility: hidden !important; pointer-events: none !important; opacity: 0 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 3. CORE PHÁ KHÓA POLYMER (Bypass Anti-Adblock)
    function clearPolymerLocks() {
        // Click nút đóng nếu có sẵn
        const dismissBtn = document.querySelector('ytd-enforcement-message-view-model #dismiss-button, ytd-enforcement-message-view-model button[aria-label="Close"]');
        if (dismissBtn) dismissBtn.click();

        // Vượt rào Sandbox để gọi API đóng Dialog tận gốc của YouTube
        const script = document.createElement('script');
        script.textContent = `(() => {
            try {
                document.querySelectorAll('tp-yt-paper-dialog').forEach(d => {
                    if (d.querySelector('ytd-enforcement-message-view-model')) {
                        if (typeof d.close === 'function') d.close();
                        if (typeof d.cancel === 'function') d.cancel();
                        d.opened = false;
                    }
                });
                document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(b => { b.opened = false; b.classList.remove('opened'); });
                document.body.classList.remove('iron-disable-scroll');
            } catch(e){}
        })()`;
        document.documentElement.appendChild(script);
        script.remove(); // Thực thi xong xóa dấu vết ngay lập tức
    }

    // 4. CORE BỎ QUA QUẢNG CÁO VIDEO & TỰ ĐỘNG RESUME
    function handleVideoAds() {
        const video = document.querySelector('.ad-showing video') || document.querySelector('video.html5-main-video');
        if (!video) return;

        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
        const hasAd = document.querySelector('.video-ads.ytp-ad-module .ytp-ad-player-overlay, .ytp-ad-button-icon');

        // Nếu phát hiện có quảng cáo video chèn vào
        if (skipBtn || hasAd) {
            video.muted = true; // Câm mồm quảng cáo
            if (video.currentTime > 0.1) video.currentTime = video.duration || 999; // Tua nhanh đến vô cực
            if (skipBtn) skipBtn.click(); // Click bỏ qua luôn
        }

        // Tự động Resume nếu bị YouTube chơi xấu pause video ở giây đầu tiên
        if (video.paused && video.currentTime < 1) {
            video.play().catch(() => {});
        }
    }

    // 5. KHỞI CHẠY OBSERVER SIÊU TỐI ƯU
    const observer = new MutationObserver(() => {
        handleVideoAds();
        if (document.querySelector('ytd-enforcement-message-view-model')) {
            clearPolymerLocks();
        }
    });

    // Đảm bảo bắt DOM càng sớm càng tốt
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
