// ==UserScript==
// @name         YouTube ADB - CORE LITE (Instant Ad Kick - CPU/RAM Optimized)
// @namespace    https://github.com/thatonevietnamese/youtube-adb-lite
// @version      1.9
// @description  Instant kick YouTube ads with targeted observers and low CPU usage
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
    // 2. STATE
    // =========================================================

    let currentPlayer = null;
    let currentVideo = null;

    let playerObserver = null;

    let lastAdCheck = false;


    // =========================================================
    // 3. KICK AD
    // =========================================================

    function kickAd(player) {
        if (!player || !player.isConnected) {
            return;
        }

        if (!player.classList.contains('ad-showing')) {
            lastAdCheck = false;
            return;
        }

        const video = player.querySelector('video');

        if (!video) {
            return;
        }

        lastAdCheck = true;

        // -----------------------------
        // MUTE AD
        // -----------------------------

        try {
            video.muted = true;
        } catch (_) {}


        // -----------------------------
        // SEEK TO END
        // -----------------------------

        try {
            if (
                Number.isFinite(video.duration) &&
                video.duration > 0
            ) {
                if (video.currentTime < video.duration - 0.05) {
                    video.currentTime = video.duration;
                }
            } else {
                video.currentTime = 999999;
            }
        } catch (_) {}


        // -----------------------------
        // SKIP BUTTON
        // -----------------------------

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
    }


    // =========================================================
    // 4. CHECK PLAYER
    // =========================================================

    function checkPlayer(player) {
        if (!player || !player.isConnected) {
            return;
        }

        if (player.classList.contains('ad-showing')) {
            kickAd(player);
        } else {
            lastAdCheck = false;
        }
    }


    // =========================================================
    // 5. HOOK VIDEO
    // =========================================================

    function hookVideo(video, player) {
        if (!video || video === currentVideo) {
            return;
        }

        currentVideo = video;


        // Metadata loaded
        video.addEventListener(
            'loadedmetadata',
            function () {
                checkPlayer(player);
            },
            { passive: true }
        );


        // Duration changed
        video.addEventListener(
            'durationchange',
            function () {
                checkPlayer(player);
            },
            { passive: true }
        );


        // Playback started
        video.addEventListener(
            'play',
            function () {
                checkPlayer(player);
            },
            { passive: true }
        );


        // Ad can remain active while time changes
        video.addEventListener(
            'timeupdate',
            function () {
                if (player.classList.contains('ad-showing')) {
                    kickAd(player);
                }
            },
            { passive: true }
        );
    }


    // =========================================================
    // 6. HOOK YOUTUBE PLAYER
    // =========================================================

    function hookPlayer(player) {
        if (!player || player === currentPlayer) {
            return;
        }


        // Cleanup old observer
        if (playerObserver) {
            playerObserver.disconnect();
            playerObserver = null;
        }


        currentPlayer = player;
        currentVideo = null;


        // ---------------------------------------------
        // ONLY OBSERVE THE PLAYER
        // ---------------------------------------------

        playerObserver = new MutationObserver(function (mutations) {

            for (const mutation of mutations) {

                // Player class changed
                if (
                    mutation.type === 'attributes' &&
                    mutation.attributeName === 'class'
                ) {
                    if (
                        player.classList.contains('ad-showing')
                    ) {
                        kickAd(player);
                    } else {
                        lastAdCheck = false;
                    }

                    continue;
                }


                // Something was added/removed inside player
                if (mutation.type === 'childList') {

                    const video = player.querySelector('video');

                    if (video) {
                        hookVideo(video, player);
                    }

                    if (
                        player.classList.contains('ad-showing')
                    ) {
                        kickAd(player);
                    }
                }
            }
        });


        playerObserver.observe(player, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class']
        });


        // Hook existing video
        const video = player.querySelector('video');

        if (video) {
            hookVideo(video, player);
        }


        // Initial check
        checkPlayer(player);
    }


    // =========================================================
    // 7. FIND YOUTUBE PLAYER
    // =========================================================

    function findPlayer() {

        const player =
            document.getElementById('movie_player') ||
            document.querySelector('.html5-video-player');


        if (player) {
            hookPlayer(player);
        }
    }


    // =========================================================
    // 8. YOUTUBE SPA PLAYER DETECTOR
    // =========================================================
    //
    // IMPORTANT:
    //
    // Không dùng requestAnimationFrame.
    // Không scan toàn bộ DOM mỗi frame.
    //
    // Observer này CHỈ dùng để phát hiện player được
    // tạo/thay thế khi YouTube chuyển video hoặc route.
    //
    // Khi player đã tồn tại thì gần như không làm gì.
    // =========================================================

    const rootObserver = new MutationObserver(function () {

        if (
            !currentPlayer ||
            !currentPlayer.isConnected
        ) {
            findPlayer();
            return;
        }


        // Player có thể bị YouTube thay bằng player mới
        const player =
            document.getElementById('movie_player') ||
            document.querySelector('.html5-video-player');


        if (
            player &&
            player !== currentPlayer
        ) {
            hookPlayer(player);
        }
    });


    rootObserver.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );


    // =========================================================
    // 9. INITIAL START
    // =========================================================

    findPlayer();

})();
