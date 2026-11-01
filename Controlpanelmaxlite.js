// ==UserScript==
// @name         YouTube & Media Control Suite (Unified)
// @namespace    https://github.com/thatonevietnamese/media-control-suite
// @version      1.0.0
// @description  Unified media controls, audio boost, loop, force resume, playback speed, YouTube quality and ad bypass.
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

    const isYouTube = /(^|\.)youtube\.com$/i.test(location.hostname);
    const isTopFrame = (() => {
        try {
            return window.top === window.self;
        } catch (_) {
            return true;
        }
    })();

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
        maxSkipInterval: 250
    };

    const ADS_SELECTORS = {
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
            ".ytp-ad-player-overlay",
            ".ad-showing > video",
            ".ad-interrupting > video",
            "div:has(> div#banner)",
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
            "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
            "ytmusic-mealbar-promo-renderer",
            "ytd-in-feed-ad-layout-renderer",
            "#player-ads",
            ".ytd-video-masthead-ad-v3-renderer",
            "ytd-ad-selection-preview-renderer",
            ".ytp-ad-image-overlay",
            "#root.yt-chips-search-renderer-header-v2",
            ".ytp-cued-thumbnail-overlay",
            ".ytp-ad-avatar",
            ".ytp-ad-button-vm"
        ],
        player: ["#movie_player", ".html5-video-player"],
        skipButtons: [
            ".ytp-ad-skip-button-modern",
            ".ytp-skip-ad-button",
            ".ytp-ad-skip-button",
            ".ytp-ad-skip-button-slot",
            ".ytp-ad-skip-button-container"
        ]
    };

    const ADS_CLASSES = [
        "ad-showing",
        "ad-interrupting",
        "ytp-ad-player-overlay",
        "ytp-ad-display-override"
    ];

    const ADS_QUERY = Object.fromEntries(
        Object.entries(ADS_SELECTORS).map(([key, values]) => [key, values.join(", ")])
    );

    let adPlayer = null;
    let adPlayerObserver = null;
    let adVideo = null;
    let adSpinner = null;
    let adCuedOverlay = null;
    let adWasMuted = null;
    let adPreviousRate = null;
    let adWasActive = false;
    let lastAdActionAt = 0;
    let adRetryTimer = null;
    let adRetryCount = 0;
    let adStyleInjected = false;

    function adsLog(message) {
        if (ADS_CONFIG.debug) {
            console.debug("[Media Control Suite / Ads]", message);
        }
    }

    function isYouTubeAdActive() {
        if (!isYouTube || !isTopFrame) return false;

        const player = adPlayer && adPlayer.isConnected
            ? adPlayer
            : document.querySelector(ADS_QUERY.player);

        return Boolean(
            player &&
            ADS_CLASSES.some(className => player.classList.contains(className))
        );
    }

    function injectAdsStyles() {
        if (!isYouTube || !isTopFrame || adStyleInjected) return;

        const style = document.createElement("style");
        style.id = "ymcs-ad-bypass-style";
        style.textContent = `
            @keyframes ymcsAnimateSkip {
                0% { transform: translate(-8px, 0); opacity: 0; }
                25% { opacity: 1; }
                75% { opacity: 1; }
                100% { transform: translate(30px, 0); opacity: 0; }
            }
            ${ADS_QUERY.toHide} {
                display: flex !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 1px !important;
                width: 1px !important;
                overflow: hidden !important;
            }
            ${ADS_QUERY.skipButtons} {
                display: flex !important;
                text-transform: uppercase !important;
                border: 1px solid #fd0 !important;
                background-color: rgba(255,230,50,0.65) !important;
                box-shadow: 0 0 20px #fc0 !important;
                overflow: hidden !important;
            }
            ${ADS_CLASSES.map(name => `.${name} .ytp-spinner-circle`).join(", ")} {
                border-color: #fc0 #fc0 transparent !important;
            }
            .ytp-skip-ad, .ytp-prev-button, .ytp-next-button {
                display: flex !important;
            }
            .ad-simple-attributed-string { visibility: hidden; }
            .ad-simple-attributed-string::before {
                content: "Wait or Press Skip";
                display: flex !important;
                visibility: visible;
                color: white;
                width: 100% !important;
                justify-content: center !important;
                white-space: nowrap !important;
            }
            .ytp-skip-ad-button__icon {
                transform: translate(-8px, 0);
                animation: 1s linear 0s infinite ymcsAnimateSkip;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
        adStyleInjected = true;
    }

    function restoreAfterAd() {
        const media = adVideo;

        if (media && media.isConnected) {
            if (adWasMuted !== null && media.muted !== adWasMuted) {
                media.muted = adWasMuted;
            }
            if (
                adPreviousRate !== null &&
                Math.abs(media.playbackRate - 2) < 0.01 &&
                Number.isFinite(adPreviousRate)
            ) {
                media.playbackRate = adPreviousRate;
            }
        }

        if (media && media.isConnected) {
            setAdGraphMuted(media, false);
        }

        if (adSpinner) adSpinner.style.display = "none";
        if (adCuedOverlay) adCuedOverlay.style.display = "none";

        adWasMuted = null;
        adPreviousRate = null;
        adWasActive = false;
        adsLog("Ad state cleared; restored previous media settings");
    }

    function performAdSkip() {
        const media = adVideo;
        const player = adPlayer;
        if (!media || !player || !media.isConnected) return;

        const now = Date.now();
        if (now - lastAdActionAt < ADS_CONFIG.maxSkipInterval) return;
        lastAdActionAt = now;

        const overlay = player.querySelector(".ytp-ad-player-overlay-layout");
        if (overlay) {
            overlay.style.display = "";
            overlay.removeAttribute("style");
        }
        if (adSpinner) adSpinner.style.display = "";
        if (adCuedOverlay) adCuedOverlay.style.display = "none";

        // Pause first, then seek. HTMLMediaElement.paused is read-only.
        if (!media.paused) media.pause();
        if (!media.muted) media.muted = true;
        setAdGraphMuted(media, true);

        if (Math.abs(media.playbackRate - 2) > 0.01) {
            media.playbackRate = 2;
        }

        if (
            Number.isFinite(media.duration) &&
            media.duration > 0 &&
            media.currentTime < media.duration - 0.2
        ) {
            try {
                media.currentTime = Math.max(0, media.duration - 0.1);
            } catch (_) {}
        }

        const skipButton = player.querySelector(ADS_QUERY.skipButtons);
        if (
            skipButton &&
            !skipButton.disabled &&
            skipButton.getAttribute("aria-disabled") !== "true"
        ) {
            try { skipButton.click(); } catch (_) {}
        }
    }

    function checkYouTubeAds() {
        if (!adPlayer || !adPlayer.isConnected) return;

        if (!adVideo || !adVideo.isConnected || adVideo.parentElement !== adPlayer) {
            adVideo = adPlayer.querySelector("video");
        }
        adSpinner = adPlayer.querySelector(".ytp-spinner");
        adCuedOverlay = adPlayer.querySelector(".ytp-cued-thumbnail-overlay");

        const active = ADS_CLASSES.some(className => adPlayer.classList.contains(className));

        if (active) {
            if (!adWasActive && adVideo) {
                adWasMuted = adVideo.muted;
                adPreviousRate = adVideo.playbackRate;
            }
            adWasActive = true;
            performAdSkip();
        } else if (adWasActive) {
            restoreAfterAd();
        }
    }

    function bindYouTubePlayer() {
        if (!isYouTube || !isTopFrame) return false;

        const nextPlayer = document.querySelector(ADS_QUERY.player);
        if (!nextPlayer) return false;

        if (nextPlayer !== adPlayer) {
            if (adPlayerObserver) {
                adPlayerObserver.disconnect();
                adPlayerObserver = null;
            }

            if (adWasActive) restoreAfterAd();
            adPlayer = nextPlayer;
            adVideo = adPlayer.querySelector("video");
            adSpinner = adPlayer.querySelector(".ytp-spinner");
            adCuedOverlay = adPlayer.querySelector(".ytp-cued-thumbnail-overlay");

            adPlayerObserver = new MutationObserver(checkYouTubeAds);
            adPlayerObserver.observe(adPlayer, {
                attributes: true,
                attributeFilter: ["class"]
            });
        }

        checkYouTubeAds();
        return true;
    }

    function schedulePlayerBind() {
        if (!isYouTube || !isTopFrame) return;
        setTimeout(bindYouTubePlayer, 0);
        setTimeout(bindYouTubePlayer, 250);
    }

    if (isYouTube && isTopFrame) {
        const language = (navigator.language || "en").slice(0, 2);
        const waitText = {
            ar: "انتظر أو اضغط تخطي",
            bn: "অপেক্ষা করুন বা স্কিপ টিপুন",
            cs: "Počkejte nebo klikněte na Přeskočit",
            de: "Warten oder Überspringen",
            el: "Περιμένετε ή πατήστε Παράλειψη",
            en: "Wait or Press Skip",
            es: "Espera o Presiona Saltar",
            fa: "منتظر بمانید یا رد کردن را فشار دهید",
            fr: "Attendre ou Passer",
            he: "המתן או לחץ על דילוג",
            hi: "प्रतीक्षा करें या छोड़ें दबाएं",
            hu: "Várjon vagy nyomja meg a Kihagyást",
            id: "Tunggu atau Tekan Lewati",
            it: "Aspetta o Premi Salta",
            ja: "待つかスキップを押す",
            ko: "기다리거나 건너뛰기 누르기",
            nl: "Wacht of druk op Overslaan",
            pl: "Czekaj lub naciśnij Pomiń",
            pt: "Aguarde ou Pressione Pular",
            ro: "Așteaptă sau apasă Sari",
            ru: "Подождите или нажмите Пропустить",
            sv: "Vänta eller tryck på Hoppa över",
            th: "รอหรือกดข้าม",
            tr: "Bekleyin veya Atla Tuşuna Basın",
            uk: "Зачекайте або натисніть Пропустити",
            vi: "Chờ hoặc nhấn Bỏ qua",
            zh: "等待或点击跳过"
        }[language] || "Wait or Press Skip";

        // Keep the UI text localized without building a second stylesheet.
        const injectLanguageStyle = () => {
            injectAdsStyles();
            const style = document.getElementById("ymcs-ad-bypass-style");
            if (style && waitText !== "Wait or Press Skip") {
                style.textContent = style.textContent.replace(
                    'content: "Wait or Press Skip";',
                    `content: ${JSON.stringify(waitText)};`
                );
            }
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", injectLanguageStyle, { once: true });
        } else {
            injectLanguageStyle();
        }

        window.addEventListener("yt-navigate-finish", schedulePlayerBind);
        window.addEventListener("yt-page-data-updated", schedulePlayerBind);
        window.addEventListener("load", bindYouTubePlayer, { once: true });

        adRetryTimer = setInterval(() => {
            adRetryCount += 1;
            const ready = bindYouTubePlayer();
            if (ready || adRetryCount >= 14) {
                clearInterval(adRetryTimer);
                adRetryTimer = null;
            }
        }, 750);
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
        if (!isUsableMedia(m)) return false;

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
            !settings.forceResume ||
            !m ||
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
        if (!settings.forceResume || !isYouTube || isYouTubeAdActive()) {
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

                if (state === 2) {
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
            if (!settings.forceResume) return;

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
            if (!data && !m._vcp_connected) {
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
                        m._vcp_connected = true;
                    }
                } catch (e) {}
            }

            if (
                data &&
                data.ctx.state === "suspended"
            ) {
                data.ctx.resume().catch(() => {});
            }

            if (m.muted && settings.vol > 0) {
                m.muted = false;
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
        if (!isYouTube || !isTopFrame || settings.q === "auto") {
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
                activeMedia.removeEventListener(
                    "timeupdate",
                    checkLoop
                );
                disconnectDetachedAudioGraph(activeMedia);
            }

            activeMedia = m;

            activeMedia.addEventListener(
                "timeupdate",
                checkLoop
            );

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

            if (!isMedia(target)) return;
            if (!isActuallyPlaying(target)) return;
            if (!isRelevantMedia(target)) return;

            setActiveMedia(target);
        },
        true
    );

    let resumeTimeout = null;

    document.addEventListener(
        "pause",
        (e) => {
            const target = e.target;

            if (!isMedia(target)) return;
            if (!settings.forceResume) return;

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
                !isMedia(target) ||
                volLock
            ) {
                return;
            }

            if (!settings.enableBoost) {
                settings.vol = target.volume;

                updateVolUI(
                    settings.vol
                );

                saveSettings();
            } else {
                applyMediaSettings(
                    target,
                    false
                );
            }
        },
        true
    );

    document.addEventListener(
        "ratechange",
        (e) => {
            const target = e.target;

            if (
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
        if (
            !settings.loop ||
            !activeMedia ||
            isYouTubeAdActive()
        ) {
            return;
        }

        if (
            activeMedia.duration &&
            activeMedia.currentTime >=
                activeMedia.duration - 0.2
        ) {
            activeMedia.currentTime = 0;

            activeMedia
                .play()
                .catch(() => {});
        }
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
        <span id="vcp-status" style="display: none; font-size: 11px; color: #ff6b6b; font-style: italic; margin-left: 2px;">No capable changes</span>

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
        if (!isTopFrame || !panel) return;

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
                    if (isYouTube) {
                        const player =
                            document.getElementById("movie_player") ||
                            document.querySelector(".html5-video-player");

                        if (player && typeof player.getPlaybackRate === "function") {
                            const rate = player.getPlaybackRate();
                            activeMedia.playbackRate = rate;
                            activeMedia.defaultPlaybackRate = rate;
                        } else {
                            activeMedia.playbackRate = 1;
                            activeMedia.defaultPlaybackRate = 1;
                        }
                    } else {
                        activeMedia.playbackRate = 1;
                        activeMedia.defaultPlaybackRate = 1;
                    }
                }

            } else {
                ui.btn3x.classList.add("active");
                ui.spdInput.disabled = false;
                customSpeed = parseFloat(ui.spdInput.value) || 3;

                if (activeMedia) {
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
        if (activeMedia && (!document.contains(activeMedia) || !isActuallyPlaying(activeMedia))) {
            activeMedia.removeEventListener("timeupdate", checkLoop);
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

        if (!ui) return;
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
        const mediaExists = Boolean(
            activeMedia || document.querySelector("video, audio")
        );

        if (settings.forceResume && mediaExists && forceResumeTimer === null) {
            forceResumeTimer = setInterval(() => {
                if (isYouTubeAdActive()) return;

                if (
                    activeMedia &&
                    (!document.contains(activeMedia) || activeMedia.ended)
                ) {
                    activeMedia.removeEventListener("timeupdate", checkLoop);
                    disconnectDetachedAudioGraph(activeMedia);
                    activeMedia = null;
                }

                if (activeMedia) {
                    if (activeMedia.paused && !activeMedia.seeking) {
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
        if (!ui) return;
        updateVolUI(settings.vol);
        ui.boost.checked = settings.enableBoost;
        ui.loop.checked = settings.loop;
        ui.force.checked = settings.forceResume;
        ui.quality.value = settings.q;
    }

    function applySyncedSettings(value) {
        if (!value || typeof value !== "object") return;
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
        updateForceResumeTimer();
        if (isYouTube && isTopFrame) schedulePlayerBind();
    });

})();
