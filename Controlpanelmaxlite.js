// ==UserScript==
// @name         YouTube & Media Control Suite (Unified)
// @namespace    https://github.com/thatonevietnamese/media-control-suite
// @version      1.4.2
// @description  Unified media controls for volume, playback speed, looping and force resume.
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
        enableBoost: false
    };

    function normalizeSettings(value) {
        const raw = value && typeof value === "object" ? value : {};
        const parsedVolume = Number(raw.vol);

        return {
            vol: Number.isFinite(parsedVolume)
                ? Math.max(0, Math.min(5, parsedVolume))
                : DEFAULT_SETTINGS.vol,
            loop: Boolean(raw.loop),
            forceResume: Boolean(raw.forceResume),
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

    const userPausedMedia = new WeakSet();
    const originalPlaybackRates = new WeakMap();
    let recentPlayerInteractionUntil = 0;

    const isYouTube = /(^|\.)youtube\.com$/i.test(location.hostname);
    const isTopFrame = (() => {
        try {
            return window.top === window.self;
        } catch (_) {
            return true;
        }
    })();

    function isTargetYouTubePage() {
        if (!isYouTube) return true;

        try {
            const pathname = window.top.location.pathname;
            return pathname === "/watch" || pathname === "/shorts" || pathname.startsWith("/shorts/");
        } catch (_) {
            const pathname = location.pathname;
            return pathname === "/watch" || pathname === "/shorts" || pathname.startsWith("/shorts/");
        }
    }

    function isYouTubeChildFrame() {
        if (isTopFrame) return false;

        // Same-origin YouTube subframes must never run the generic media
        // controller. Cross-origin ad frames are identified by their referrer
        // when the browser exposes it; otherwise the frame remains isolated
        // from the top-frame ad controller by the top-frame-only checks.
        if (isYouTube) return true;

        try {
            const referrer = document.referrer ? new URL(document.referrer) : null;
            return Boolean(referrer && /(^|\.)youtube\.com$/i.test(referrer.hostname));
        } catch (_) {
            return false;
        }
    }

    // The YouTube controller belongs only to the top-level Watch/Shorts page.
    // Do not let ad creatives in child frames receive normal media speed/volume
    // settings intended for the main content video.
    let pageEnabled = isYouTube
        ? (isTopFrame && isTargetYouTubePage())
        : !isYouTubeChildFrame();

    function isPageEnabled() {
        if (isYouTube) {
            return isTopFrame && isTargetYouTubePage();
        }
        return pageEnabled;
    }

    // Shared per-frame audio graph registry. WeakMap avoids retaining media elements.
    const audioCtxMap = new WeakMap();
    let globalAudioCtx = null;

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

    function handleYouTubeRouteChange() {
        if (!isYouTube || !isTopFrame) return;

        const targetActive = isTargetYouTubePage();

        if (!targetActive) {
            pageEnabled = false;
            panelVisible = false;
            if (panel) panel.style.display = "none";

            if (activeMedia) {
                activeMedia.removeEventListener("ended", checkLoop);

                const previousRate = originalPlaybackRates.get(activeMedia);
                if (isSpeedForced && Number.isFinite(previousRate)) {
                    activeMedia.playbackRate = previousRate;
                    activeMedia.defaultPlaybackRate = previousRate;
                }
                originalPlaybackRates.delete(activeMedia);

                disconnectDetachedAudioGraph(activeMedia);
                activeMedia = null;
            }

            if (forceResumeTimer !== null) {
                clearInterval(forceResumeTimer);
                forceResumeTimer = null;
            }
            return;
        }

        pageEnabled = true;
        mountPanel();
        updateForceResumeTimer();
    }

    if (isYouTube && isTopFrame) {
        window.addEventListener("yt-navigate-finish", handleYouTubeRouteChange);
        window.addEventListener("yt-page-data-updated", handleYouTubeRouteChange);
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
        if (!isPageEnabled() || !isUsableMedia(m)) return false;

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
            !isPageEnabled() ||
            !settings.forceResume ||
            !m ||
            userPausedMedia.has(m) ||
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
        if (!isPageEnabled() || !settings.forceResume || !isYouTube) {
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

                const video = document.querySelector("video");
                if (state === 2 && video && !userPausedMedia.has(video)) {
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
            if (!isPageEnabled() || !settings.forceResume) return;

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
            !isPageEnabled() ||
            !m ||
            volLock ||
            !document.contains(m)
        ) {
            return;
        }

        // SPEED
        if (isSpeedForced) {
            try {
                if (!originalPlaybackRates.has(m)) {
                    originalPlaybackRates.set(m, m.playbackRate || 1);
                }
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
            if (!data) {
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
                    }
                } catch (e) {}
            }

            if (
                data &&
                data.ctx.state === "suspended"
            ) {
                data.ctx.resume().catch(() => {});
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
            if (data && data.ctx && data.ctx.state === "suspended") {
                data.ctx.resume().catch(() => {});
            }

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
    // ACTIVE MEDIA
    // =========================================================

    function setActiveMedia(m) {
        if (!isActuallyPlaying(m)) {
            return;
        }

        if (m !== activeMedia) {
            if (activeMedia) {
                activeMedia.removeEventListener("ended", checkLoop);

                if (isSpeedForced) {
                    const previousRate = originalPlaybackRates.get(activeMedia);
                    if (Number.isFinite(previousRate)) {
                        activeMedia.playbackRate = previousRate;
                        activeMedia.defaultPlaybackRate = previousRate;
                    }
                    originalPlaybackRates.delete(activeMedia);
                }

                disconnectDetachedAudioGraph(activeMedia);
            }

            activeMedia = m;

            activeMedia.addEventListener("ended", checkLoop);

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

            if (!isPageEnabled() || !isMedia(target)) return;
            if (!isActuallyPlaying(target)) return;
            if (!isRelevantMedia(target)) return;

            userPausedMedia.delete(target);
            setActiveMedia(target);
        },
        true
    );

    let resumeTimeout = null;

    document.addEventListener("pointerdown", e => {
        if (!isPageEnabled()) return;
        const player = isYouTube
            ? document.querySelector("#movie_player, .html5-video-player")
            : null;
        if (player && (player === e.target || player.contains(e.target))) {
            recentPlayerInteractionUntil = Date.now() + 1200;
        } else if (activeMedia && (e.target === activeMedia || activeMedia.contains(e.target))) {
            recentPlayerInteractionUntil = Date.now() + 1200;
        }
    }, true);

    document.addEventListener("keydown", e => {
        if (!isPageEnabled() || !isYouTube) return;
        if ([" ", "k", "K"].includes(e.key)) {
            const player = document.querySelector("#movie_player, .html5-video-player");
            if (player && (player.contains(e.target) || e.target === document.body)) {
                recentPlayerInteractionUntil = Date.now() + 1200;
            }
        }
    }, true);

    document.addEventListener(
        "pause",
        (e) => {
            const target = e.target;

            if (!isPageEnabled() || !isMedia(target)) return;
            if (!settings.forceResume) return;

            if (Date.now() < recentPlayerInteractionUntil) {
                userPausedMedia.add(target);
                return;
            }

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

    document.addEventListener(
        "volumechange",
        (e) => {
            const target = e.target;

            if (
                !isPageEnabled() ||
                !isMedia(target) ||
                volLock
            ) {
                return;
            }

            if (!settings.enableBoost && target === activeMedia) {
                settings.vol = target.volume;

                updateVolUI(
                    settings.vol
                );

                saveSettings();
            } else if (settings.enableBoost && target === activeMedia) {
                applyMediaSettings(target, false);
            }
        },
        true
    );

    document.addEventListener(
        "ratechange",
        (e) => {
            const target = e.target;
            if (!isPageEnabled() || !isMedia(target)) return;

            if (!isSpeedForced || target !== activeMedia) return;

            const expectedSpeed = Math.max(0.1, Math.min(5, customSpeed));
            if (Math.abs(target.playbackRate - expectedSpeed) > 0.01) {
                target.playbackRate = expectedSpeed;
            }
        },
        true
    );

    function checkLoop() {
        const media = activeMedia;
        if (
            !isPageEnabled() ||
            !settings.loop ||
            !media ||
            !document.contains(media)
        ) {
            return;
        }

        try {
            media.currentTime = 0;
            const playPromise = media.play();
            if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {});
            }
        } catch (_) {}
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
        <span id="vcp-status" style="display: none; font-size: 11px; color: #ff6b6b; font-style: italic; margin-left: 2px;">No active media</span>

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

        #vcp-panel select {
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
        if (!isPageEnabled() || !isTopFrame || !panel) return;

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
        boost: panel.querySelector("#vcp-boost"),
        loop: panel.querySelector("#vcp-loop"),
        force: panel.querySelector("#vcp-force")
    } : null;

    function saveSettings() {
        const stData = {
            vol: settings.vol,
            loop: settings.loop,
            forceResume: settings.forceResume,
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

        // SPEED
        ui.btn3x.onclick = () => {
            isSpeedForced = !isSpeedForced;

            if (!isSpeedForced) {
                ui.btn3x.classList.remove("active");
                ui.spdInput.disabled = true;

                if (activeMedia) {
                    const previousRate = originalPlaybackRates.get(activeMedia);
                    const restoreRate = Number.isFinite(previousRate) ? previousRate : 1;
                    activeMedia.playbackRate = restoreRate;
                    activeMedia.defaultPlaybackRate = restoreRate;
                    originalPlaybackRates.delete(activeMedia);
                }

            } else {
                ui.btn3x.classList.add("active");
                ui.spdInput.disabled = false;
                customSpeed = parseFloat(ui.spdInput.value) || 3;

                if (activeMedia) {
                    if (!originalPlaybackRates.has(activeMedia)) {
                        originalPlaybackRates.set(activeMedia, activeMedia.playbackRate || 1);
                    }
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
        if (!isPageEnabled()) return;
        if (activeMedia && (!document.contains(activeMedia) || !isActuallyPlaying(activeMedia))) {
            activeMedia.removeEventListener("ended", checkLoop);
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

        if (!ui || !isPageEnabled()) {
            if (panel) panel.style.display = "none";
            panelVisible = false;
            return;
        }
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

            if (!isPageEnabled()) return;
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
    // =========================================================
    // LOW CPU FALLBACK
    // =========================================================

    let forceResumeTimer = null;

    function updateForceResumeTimer() {
        if (!isPageEnabled()) {
            if (forceResumeTimer !== null) {
                clearInterval(forceResumeTimer);
                forceResumeTimer = null;
            }
            return;
        }

        const mediaExists = Boolean(
            activeMedia || document.querySelector("video, audio")
        );

        if (settings.forceResume && mediaExists && forceResumeTimer === null) {
            forceResumeTimer = setInterval(() => {
                if (!isPageEnabled()) return;

                if (
                    activeMedia &&
                    (!document.contains(activeMedia) || activeMedia.ended)
                ) {
                    activeMedia.removeEventListener("ended", checkLoop);
                    disconnectDetachedAudioGraph(activeMedia);
                    activeMedia = null;
                }

                if (activeMedia) {
                    if (activeMedia.paused && !activeMedia.seeking && !userPausedMedia.has(activeMedia)) {
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
        if (!ui || !isPageEnabled()) return;
        updateVolUI(settings.vol);
        ui.boost.checked = settings.enableBoost;
        ui.loop.checked = settings.loop;
        ui.force.checked = settings.forceResume;
    }

    function applySyncedSettings(value) {
        if (!isPageEnabled() || !value || typeof value !== "object") return;
        Object.assign(settings, normalizeSettings(value));
        refreshPanelFromSettings();
        updateForceResumeTimer();
        if (activeMedia) applyMediaSettings(activeMedia, true);
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
        if (isYouTube && isTopFrame) {
            handleYouTubeRouteChange();
        } else {
            updateForceResumeTimer();
        }
    });

})();
