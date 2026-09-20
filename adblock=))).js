// ==UserScript==
// @name         YouTube ADB - CORE LITE (Instant Ad Kick)
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.8
// @description  Instant kick YouTube ads as soon as they appear
// @match        *://*.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 1. CSS ẨN QUẢNG CÁO
    // =========================================================

    const style = document.createElement('style');

    style.textContent = `
        #masthead-ad,
        #related #player-ads,
        ytd-ad-slot-renderer,
        ytm-companion-ad-renderer,
        ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
        yt-mealbar-promo-renderer {
            display: none !important;
        }
    `;

    (document.head || document.documentElement).appendChild(style);

    // =========================================================
    // 2. TRẠNG THÁI
    // =========================================================

    let adKicking = false;
    let currentVideo = null;

    // =========================================================
    // 3. ĐÁ QUẢNG CÁO NGAY KHI XUẤT HIỆN
    // =========================================================

    function kickAd() {
        const player = document.querySelector('.html5-video-player');

        if (!player) {
            adKicking = false;
            return;
        }

        const isAd =
            player.classList.contains('ad-showing') ||
            player.querySelector('.ytp-ad-module') !== null ||
            player.querySelector('.ytp-ad-player-overlay') !== null;

        if (!isAd) {
            adKicking = false;
            return;
        }

        const video = player.querySelector('video');

        if (!video) {
            return;
        }

        currentVideo = video;

        // Mute quảng cáo
        try {
            video.muted = true;
        } catch (_) {}

        // =====================================================
        // ĐÁ THẲNG VIDEO TỚI CUỐI
        // Không chờ Skip Ads
        // =====================================================

        try {
            if (Number.isFinite(video.duration) && video.duration > 0) {
                video.currentTime = video.duration;
            } else {
                // Khi duration chưa load xong
                video.currentTime = 999999;
            }
        } catch (_) {}

        // =====================================================
        // Thử nút skip nếu nó đã xuất hiện
        // =====================================================

        const skip = player.querySelector(
            '.ytp-ad-skip-button,' +
            '.ytp-skip-ad-button,' +
            '.ytp-ad-skip-button-modern'
        );

        if (skip) {
            try {
                skip.click();
            } catch (_) {}
        }

        adKicking = true;
    }

    // =========================================================
    // 4. THEO DÕI CLASS "ad-showing"
    // =========================================================

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (
                mutation.type === 'attributes' &&
                mutation.attributeName === 'class'
            ) {
                const target = mutation.target;

                if (
                    target instanceof HTMLElement &&
                    target.classList.contains('html5-video-player')
                ) {
                    if (target.classList.contains('ad-showing')) {
                        kickAd();
                    } else {
                        adKicking = false;
                    }
                }
            }

            if (mutation.type === 'childList') {
                if (
                    document.querySelector('.html5-video-player.ad-showing')
                ) {
                    kickAd();
                }
            }
        }
    });

    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // =========================================================
    // 5. BẮT VIDEO MỚI
    // =========================================================

    function hookVideo(video) {
        if (video.dataset.instantAdKick) {
            return;
        }

        video.dataset.instantAdKick = '1';

        currentVideo = video;

        // Ngay khi metadata có
        video.addEventListener('loadedmetadata', () => {
            if (
                video.closest('.html5-video-player')?.classList
                    .contains('ad-showing')
            ) {
                kickAd();
            }
        });

        // Ngay khi duration thay đổi
        video.addEventListener('durationchange', () => {
            if (
                video.closest('.html5-video-player')?.classList
                    .contains('ad-showing')
            ) {
                kickAd();
            }
        });

        // Khi YouTube bắt đầu phát
        video.addEventListener('play', () => {
            if (
                video.closest('.html5-video-player')?.classList
                    .contains('ad-showing')
            ) {
                kickAd();
            }
        });

        // Nếu ad vẫn chưa biến mất
        video.addEventListener('timeupdate', () => {
            if (
                video.closest('.html5-video-player')?.classList
                    .contains('ad-showing')
            ) {
                kickAd();
            }
        });
    }

    // =========================================================
    // 6. QUÉT VIDEO
    // =========================================================

    function scanVideos() {
        document.querySelectorAll('video').forEach(hookVideo);
    }

    scanVideos();

    const videoObserver = new MutationObserver(scanVideos);

    videoObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // =========================================================
    // 7. INSTANT FALLBACK
    // =========================================================
    // Chỉ chạy khi đang có quảng cáo.
    // Không can thiệp scroll.

    function instantLoop() {
        const player = document.querySelector(
            '.html5-video-player.ad-showing'
        );

        if (player) {
            kickAd();
        }

        requestAnimationFrame(instantLoop);
    }

    requestAnimationFrame(instantLoop);

})();
