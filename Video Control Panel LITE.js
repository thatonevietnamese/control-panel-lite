
// ==UserScript==
// @name         Video/Audio Control Panel LITE v5.6 (Max Lite - Fixed Speed)
// @namespace    http://tampermonkey.net/
// @version      5.6.3
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Controlpanelmaxlite.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Controlpanelmaxlite.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @description  Hỗ trợ Video/Audio, Force Resume nhẹ, Ép tốc độ 3x - Không can thiệp visibility của YouTube.
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // SETTINGS CACHE
    // =========================================================

    const settings = GM_getValue("vcp_settings", {
        vol: 1,
        loop: false,
        forceResume: false,
        q: "auto",
        enableBoost: false
    });

    // =========================================================
    // STATE
    // =========================================================

    let isSpeedForced = false;
    let customSpeed = 3;

    let activeMedia = null;
    let panelVisible = false;
    let volLock = false;

    const isYouTube = location.hostname.includes("youtube.com");

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

    // Media phải có kích thước hiển thị hoặc là audio.
    // Điều này loại phần lớn media ẩn / preview / tracker
    // của các website như Messenger.
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
        if (!settings.forceResume || !isYouTube) {
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

                // 2 = paused
                // 0 = ended
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

    const audioCtxMap = new WeakMap();
    let globalAudioCtx = null;

    function applyMediaSettings(m, fromScriptUI = false) {
        if (!m || volLock || !document.contains(m)) {
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
                            source
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
        if (!isYouTube || settings.q === "auto") {
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
        // NEVER activate hidden / paused / invalid media.
        if (!isActuallyPlaying(m)) {
            return;
        }

        if (m !== activeMedia) {
            if (activeMedia) {
                activeMedia.removeEventListener(
                    "timeupdate",
                    checkLoop
                );
            }

            activeMedia = m;

            activeMedia.addEventListener(
                "timeupdate",
                checkLoop
            );

            applyYouTubeQuality();
        }

        applyMediaSettings(
            activeMedia,
            false
        );

        if (!panelVisible) {
            togglePanel(true);
        }
    }

    // =========================================================
    // MEDIA PLAY
    // =========================================================

    document.addEventListener(
        "play",
        (e) => {
            const target = e.target;

            if (!isMedia(target)) {
                return;
            }

            /*
             * IMPORTANT:
             * Messenger and many websites may create/play
             * hidden media elements for UI effects, previews,
             * stickers, GIFs, notifications, etc.
             *
             * Only accept media that is actually playing
             * and visibly relevant.
             */

            if (!isActuallyPlaying(target)) {
                return;
            }

            if (!isRelevantMedia(target)) {
                return;
            }

            setActiveMedia(target);
        },
        true
    );

    // =========================================================
    // MEDIA PAUSE
    // =========================================================

    document.addEventListener(
        "pause",
        (e) => {
            const target = e.target;

            if (!isMedia(target)) {
                return;
            }

            if (!settings.forceResume) {
                return;
            }

            if (
                target === activeMedia ||
                isYouTube
            ) {
                setTimeout(() => {
                    if (
                        !target ||
                        !document.contains(target)
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

    // =========================================================
    // VOLUME
    // =========================================================

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

    // =========================================================
    // RATE CHANGE
    // =========================================================

    document.addEventListener(
        "ratechange",
        (e) => {
            const target = e.target;

            if (
                !isSpeedForced ||
                !isMedia(target) ||
                target !== activeMedia
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

    // =========================================================
    // LOOP
    // =========================================================

    function checkLoop() {
        if (
            !settings.loop ||
            !activeMedia
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

    const panel =
        document.createElement("div");

    panel.id = "vcp-panel";

    panel.innerHTML = `
        <span>🔊</span>

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

    GM_addStyle(`
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

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            mountPanel
        );
    } else {
        mountPanel();
    }

    document.addEventListener(
        "fullscreenchange",
        mountPanel
    );

    // =========================================================
    // CONTROLS
    // =========================================================

    const ui = {
        slider:
            panel.querySelector("#vcp-slider"),

        vol:
            panel.querySelector("#vcp-vol"),

        btn3x:
            panel.querySelector("#vcp-btn-3x"),

        spdInput:
            panel.querySelector("#vcp-spd-input"),

        quality:
            panel.querySelector("#vcp-quality"),

        boost:
            panel.querySelector("#vcp-boost"),

        loop:
            panel.querySelector("#vcp-loop"),

        force:
            panel.querySelector("#vcp-force")
    };

    if (!isYouTube) {
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
            stData
        );
    }

    function updateVolUI(v) {
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

    ui.slider.oninput =
        e =>
            handleVolChange(
                e.target.value
            );

    ui.vol.onchange =
        e =>
            handleVolChange(
                e.target.value
            );

    ui.boost.onchange = e => {
        settings.enableBoost =
            e.target.checked;

        if (
            !settings.enableBoost &&
            settings.vol > 1
        ) {
            settings.vol = 1;
        }

        updateVolUI(settings.vol);

        if (activeMedia) {
            applyMediaSettings(
                activeMedia,
                true
            );
        }

        saveSettings();
    };

    ui.loop.onchange = e => {
        settings.loop =
            e.target.checked;

        saveSettings();
    };

    ui.force.onchange = e => {
        settings.forceResume =
            e.target.checked;

        saveSettings();

        if (settings.forceResume) {
            resumeMedia(activeMedia);

            if (isYouTube) {
                resumeYouTube();
            }
        }
    };

    ui.quality.onchange = e => {
        settings.q =
            e.target.value;

        applyYouTubeQuality();

        saveSettings();
    };

    // =========================================================
    // SPEED
    // =========================================================

    ui.btn3x.onclick = () => {
        isSpeedForced =
            !isSpeedForced;

        if (!isSpeedForced) {
            ui.btn3x.classList.remove(
                "active"
            );

            ui.spdInput.disabled = true;

            if (activeMedia) {
                if (isYouTube) {
                    const player =
                        document.getElementById(
                            "movie_player"
                        ) ||
                        document.querySelector(
                            ".html5-video-player"
                        );

                    if (
                        player &&
                        typeof player.getPlaybackRate ===
                        "function"
                    ) {
                        const rate =
                            player.getPlaybackRate();

                        activeMedia.playbackRate =
                            rate;

                        activeMedia.defaultPlaybackRate =
                            rate;
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
            ui.btn3x.classList.add(
                "active"
            );

            ui.spdInput.disabled = false;

            customSpeed =
                parseFloat(
                    ui.spdInput.value
                ) || 3;

            if (activeMedia) {
                applyMediaSettings(
                    activeMedia,
                    false
                );
            }
        }
    };

    ui.spdInput.onchange = e => {
        if (!isSpeedForced) return;

        let val =
            parseFloat(
                e.target.value
            );

        if (isNaN(val)) return;

        val =
            Math.max(
                0.1,
                Math.min(5, val)
            );

        ui.spdInput.value = val;

        customSpeed = val;

        if (activeMedia) {
            applyMediaSettings(
                activeMedia,
                false
            );
        }
    };

    // =========================================================
    // PANEL
    // =========================================================

    function togglePanel(
        show = !panelVisible
    ) {
        panelVisible = show;

        panel.style.display =
            show
                ? "flex"
                : "none";
    }

    panel.querySelector(
        "#vcp-close"
    ).onclick = () => {
        togglePanel(false);
    };

    // "*" = toggle panel
    // Escape = close panel

    document.addEventListener(
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
            } else if (
                e.key === "Escape" &&
                panelVisible
            ) {
                togglePanel(false);
            }
        }
    );

    updateVolUI(
        settings.vol
    );

    ui.quality.value =
        settings.q;

    // =========================================================
    // LOW CPU FALLBACK
    // =========================================================

    setInterval(() => {

        // Existing active media
        if (
            activeMedia &&
            document.contains(activeMedia)
        ) {
            if (
                settings.forceResume &&
                activeMedia.paused &&
                !activeMedia.ended &&
                !activeMedia.seeking
            ) {
                resumeMedia(
                    activeMedia
                );

                if (isYouTube) {
                    resumeYouTube();
                }
            }

            return;
        }

        // Search only when there is no active media.
        const mediaList =
            document.querySelectorAll(
                "video, audio"
            );

        for (const media of mediaList) {

            if (
                !isActuallyPlaying(media)
            ) {
                continue;
            }

            if (
                !isRelevantMedia(media)
            ) {
                continue;
            }

            setActiveMedia(media);
            break;
        }

    }, 5000);

})();

