// ==UserScript==
// @name         Video/Audio Control Panel LITE v5.5 (Max Lite)
// @namespace    http://tampermonkey.net/
// @version      5.5
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Controlpanelmaxlite.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Controlpanelmaxlite.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @description  Hỗ trợ Video/Audio, Toggle Boost an toàn, Tốc độ 3x reset thông minh (áp dụng chuẩn cho cả file âm thanh).
// ==/UserScript==

(function () {
    'use strict';

    // ===== SETTINGS CACHE =====
    const settings = GM_getValue("vcp_settings", { vol: 1, loop: false, forceResume: false, q: "auto", enableBoost: false });
    settings.spd = 1; // Mặc định luôn khởi động ở 1x
    
    let activeMedia = null;
    let panelVisible = false;
    let volLock = false; 
    const isYouTube = location.hostname.includes("youtube.com");

    // ===== ANTI-PAUSE KERNEL (SMART PROXY) =====
    try {
        const nativeVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
        const nativeHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');

        if (nativeVisibility && nativeVisibility.configurable) {
            Object.defineProperty(document, 'visibilityState', {
                get: function() { return settings.forceResume ? 'visible' : nativeVisibility.get.call(this); }
            });
        }
        if (nativeHidden && nativeHidden.configurable) {
            Object.defineProperty(document, 'hidden', {
                get: function() { return settings.forceResume ? false : nativeHidden.get.call(this); }
            });
        }
    } catch(e) {}

    window.addEventListener('visibilitychange', e => {
        if (settings.forceResume) e.stopImmediatePropagation();
    }, true);

    // ===== AUDIO/VIDEO CORE =====
    const audioCtxMap = new WeakMap();
    let globalAudioCtx = null;

    function applyMediaSettings(m, fromScriptUI = false) {
        if (!m || volLock || !document.contains(m)) return;

        // 1. Áp dụng tốc độ phát
        try {
            const safeSpeed = Math.max(0.1, Math.min(5, settings.spd));
            if (m.playbackRate !== safeSpeed) {
                m.playbackRate = safeSpeed;
                m.defaultPlaybackRate = safeSpeed;
            }
        } catch(e){}

        let data = audioCtxMap.get(m);

        // 2. Logic Âm thanh & Boost
        if (settings.enableBoost) {
            if (!data && !m._vcp_connected) {
                try {
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    if (Ctx) {
                        if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
                            globalAudioCtx = new Ctx();
                        }
                        const source = globalAudioCtx.createMediaElementSource(m);
                        const gain = globalAudioCtx.createGain();
                        source.connect(gain);
                        gain.connect(globalAudioCtx.destination);
                        data = { ctx: globalAudioCtx, gain, source };
                        audioCtxMap.set(m, data);
                        m._vcp_connected = true;
                    }
                } catch(e) {}
            }

            if (data && data.ctx.state === 'suspended') {
                data.ctx.resume().catch(() => {});
            }
            if (m.muted && settings.vol > 0) m.muted = false;

            volLock = true;
            try {
                m.volume = settings.vol > 1 ? 1 : settings.vol;
                const gainVal = settings.vol > 1 ? settings.vol : 1;
                if (data && data.gain) {
                    try { data.gain.gain.setTargetAtTime(gainVal, data.ctx.currentTime, 0.05); } 
                    catch(e) { data.gain.gain.value = gainVal; }
                }
            } finally {
                volLock = false;
            }
        } else {
            if (data && data.gain) {
                try { data.gain.gain.setTargetAtTime(1, data.ctx.currentTime, 0.05); } 
                catch(e) { data.gain.gain.value = 1; }
            }

            if (fromScriptUI) {
                volLock = true;
                try {
                    m.volume = Math.min(settings.vol, 1);
                } finally {
                    volLock = false;
                }
            }
        }
    }

    // ===== YOUTUBE QUALITY KERNEL =====
    function applyYouTubeQuality() {
        if (!isYouTube || settings.q === "auto") return;
        try {
            localStorage.setItem('yt-player-quality', JSON.stringify({ data: settings.q, creation: Date.now() }));
            const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
            if (player) {
                if (typeof player.setPlaybackQualityRange === "function") player.setPlaybackQualityRange(settings.q, settings.q);
                if (typeof player.setPlaybackQuality === "function") player.setPlaybackQuality(settings.q);
            }
        } catch(e){}
    }

    // ===== EVENT & MEDIA HANDLING =====
    function setActiveMedia(m) {
        if (!m) return;
        if (m !== activeMedia) {
            if (activeMedia) activeMedia.removeEventListener("timeupdate", checkLoop);
            activeMedia = m;
            activeMedia.addEventListener("timeupdate", checkLoop);
            applyYouTubeQuality();
        }
        applyMediaSettings(activeMedia, false);
        if (!panelVisible) togglePanel(true);
    }

    document.addEventListener("play", (e) => {
        const target = e.target;
        if (target && (target.tagName === "VIDEO" || target.tagName === "AUDIO")) setActiveMedia(target);
    }, true);

    document.addEventListener("pause", (e) => {
        const target = e.target;
        if (settings.forceResume && target === activeMedia && !target.ended && !target.seeking) {
            setTimeout(() => {
                if (target.paused && !target.ended) target.play().catch(() => {});
            }, 100);
        }
    }, true);

    document.addEventListener("volumechange", (e) => {
        const target = e.target;
        if ((target.tagName === "VIDEO" || target.tagName === "AUDIO") && !volLock) {
            if (!settings.enableBoost) {
                settings.vol = target.volume;
                updateVolUI(settings.vol);
                saveSettings();
            } else {
                applyMediaSettings(target, false);
            }
        }
    }, true);

    document.addEventListener("ratechange", (e) => {
        const target = e.target;
        if ((target.tagName === "VIDEO" || target.tagName === "AUDIO") && target === activeMedia) {
            const expectedSpeed = Math.max(0.1, Math.min(5, settings.spd));
            if (target.playbackRate !== expectedSpeed) {
                target.playbackRate = expectedSpeed;
            }
        }
    }, true);

    function checkLoop() {
        if (!settings.loop || !activeMedia) return;
        if (activeMedia.duration && activeMedia.currentTime >= activeMedia.duration - 0.2) {
            activeMedia.currentTime = 0;
            activeMedia.play().catch(() => {});
        }
    }

    // ===== UI & DOM MOUNTING =====
    const panel = document.createElement("div");
    panel.id = "vcp-panel";
    panel.innerHTML = `
        <span>🔊</span>
        <input type="range" id="vcp-slider" step="0.1" min="0" max="5" value="${settings.vol}">
        <input type="number" id="vcp-vol" step="0.1" min="0" max="5" value="${Number(settings.vol).toFixed(2)}">
        <div id="vcp-speed">
            <button id="vcp-btn-3x" title="Bật/Tắt Tốc độ (Mặc định 3x)">3x</button>
            <input type="number" id="vcp-spd-input" step="0.1" min="0.1" max="5" value="1" disabled title="Chỉ hoạt động khi bật tốc độ">
        </div>
        <select id="vcp-quality" title="Độ phân giải (Chỉ YT)">
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
        <label title="Kích hoạt Audio Boost (Tắt đi để trả quyền cho trình duyệt)"><input type="checkbox" id="vcp-boost" ${settings.enableBoost?'checked':''}><span>🚀</span></label>
        <label title="Auto Loop"><input type="checkbox" id="vcp-loop" ${settings.loop?'checked':''}><span>🔁</span></label>
        <label title="Force Resume (Anti-Pause)"><input type="checkbox" id="vcp-force" ${settings.forceResume?'checked':''}><span>⏯️</span></label>
        <div id="vcp-download">
            <button id="vcp-dl-mp4" title="Tải Video (MP4 gốc)">🎬 MP4</button>
            <button id="vcp-dl-mp3" title="Tải Audio (MP3 gốc)">🎵 MP3</button>
        </div>
        <button id="vcp-close">×</button>
    `;

    GM_addStyle(`
    #vcp-panel { position:fixed; bottom:20px; right:20px; padding:8px 12px; background:#1e1e1e; border-radius:20px; z-index:2147483647; font:13px Arial, sans-serif; color:#fff; box-shadow:0 4px 15px rgba(0,0,0,0.5); display:none; align-items:center; gap:8px; border: 1px solid #444; user-select: none; }
    #vcp-slider { width:80px; height:6px; appearance:none; background:#444; border-radius:3px; cursor:pointer; outline:none; }
    #vcp-slider::-webkit-slider-thumb { appearance:none; width:14px; height:14px; background:#4CAF50; border-radius:50%; }
    #vcp-vol { width:45px; padding:2px; border:none; border-radius:5px; text-align:center; background:#333; color:#fff; font-size:12px; }
    #vcp-vol.boost { color:#ff9800; font-weight:bold; }
    #vcp-speed { display:flex; align-items:center; gap:4px; }
    #vcp-speed button { padding:3px 6px; border:none; border-radius:5px; background:#333; color:#fff; cursor:pointer; font-size:11px; }
    #vcp-speed button.active { background:#4CAF50; font-weight:bold; }
    #vcp-spd-input { width:42px; padding:2px; border:1px solid #555; border-radius:5px; text-align:center; background:#333; color:#fff; font-size:12px; }
    #vcp-spd-input:disabled { opacity: 0.5; cursor: not-allowed; }
    #vcp-quality { background:#333; color:#fff; border:1px solid #555; border-radius:5px; padding:2px; font-size:11px; cursor:pointer; outline:none; }
    #vcp-download { display:flex; gap:4px; }
    #vcp-download button { padding:3px 6px; border:none; border-radius:5px; background:#333; color:#fff; cursor:pointer; font-size:11px; }
    #vcp-download button:hover { background:#555; }
    #vcp-panel label { cursor:pointer; padding:0 3px; display:flex; align-items:center; }
    #vcp-panel input[type="checkbox"] { display:none; }
    #vcp-panel label span { opacity:0.4; font-size:15px; filter:grayscale(100%); transition:0.2s; }
    #vcp-panel input:checked + span { opacity:1; filter:grayscale(0%); }
    #vcp-close { background:none; border:none; color:#fff; font-size:18px; cursor:pointer; padding-left: 5px; line-height: 1; }
    `);

    function mountPanel() {
        const targetParent = document.fullscreenElement || document.body || document.documentElement;
        if (targetParent && !targetParent.contains(panel)) targetParent.appendChild(panel);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountPanel);
    else mountPanel();
    document.addEventListener("fullscreenchange", mountPanel);

    // ===== CONTROLS LOGIC =====
    const ui = {
        slider: panel.querySelector("#vcp-slider"),
        vol: panel.querySelector("#vcp-vol"),
        btn3x: panel.querySelector("#vcp-btn-3x"),
        spdInput: panel.querySelector("#vcp-spd-input"),
        quality: panel.querySelector("#vcp-quality"),
        boost: panel.querySelector("#vcp-boost"),
        loop: panel.querySelector("#vcp-loop"),
        force: panel.querySelector("#vcp-force"),
        dlMp4: panel.querySelector("#vcp-dl-mp4"),
        dlMp3: panel.querySelector("#vcp-dl-mp3")
    };

    if (!isYouTube) ui.quality.style.display = "none";

    function saveSettings() {
        const stData = { vol: settings.vol, loop: settings.loop, forceResume: settings.forceResume, q: settings.q, enableBoost: settings.enableBoost };
        GM_setValue("vcp_settings", stData);
    }

    function updateVolUI(v) {
        ui.slider.value = v;
        ui.vol.value = Number(v).toFixed(2);
        ui.vol.classList.toggle("boost", v > 1 && settings.enableBoost);
    }

    function handleVolChange(val) {
        let v = parseFloat(val) || 0;
        if (!settings.enableBoost && v > 1) v = 1;
        settings.vol = Math.max(0, Math.min(5, v));
        updateVolUI(settings.vol);
        if (activeMedia) applyMediaSettings(activeMedia, true);
        saveSettings();
    }

    ui.slider.oninput = e => handleVolChange(e.target.value);
    ui.vol.onchange = e => handleVolChange(e.target.value);

    ui.boost.onchange = e => {
        settings.enableBoost = e.target.checked;
        if (!settings.enableBoost && settings.vol > 1) {
            settings.vol = 1;
        }
        updateVolUI(settings.vol);
        if (activeMedia) applyMediaSettings(activeMedia, true);
        saveSettings();
    };

    ui.loop.onchange = e => { settings.loop = e.target.checked; saveSettings(); };
    ui.force.onchange = e => { settings.forceResume = e.target.checked; saveSettings(); };
    ui.quality.onchange = e => { settings.q = e.target.value; applyYouTubeQuality(); saveSettings(); };

    // --- LOGIC TỐC ĐỘ ---
    ui.btn3x.onclick = () => {
        if (ui.btn3x.classList.contains("active")) {
            ui.btn3x.classList.remove("active");
            settings.spd = 1;
            ui.spdInput.value = 1;
            ui.spdInput.disabled = true;
        } else {
            ui.btn3x.classList.add("active");
            settings.spd = 3;
            ui.spdInput.value = 3;
            ui.spdInput.disabled = false;
        }
        if (activeMedia) applyMediaSettings(activeMedia, false);
    };

    ui.spdInput.onchange = e => {
        if (!ui.btn3x.classList.contains("active")) {
            ui.spdInput.value = 1;
            return;
        }
        let val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        val = Math.max(0.1, Math.min(5, val));
        ui.spdInput.value = val;
        settings.spd = val;
        if (activeMedia) applyMediaSettings(activeMedia, false);
    };

    // --- TẢI XUỐNG (Đã sửa Fallback tải chất lượng gốc) ---
    async function triggerDownload(isAudio) {
        if (!activeMedia) { alert("⚠️ Không tìm thấy video/audio nào đang phát!"); return; }
        
        const src = activeMedia.currentSrc || activeMedia.src;
        const pageUrl = window.location.href;

        // 1. YouTube & Blob (Mã hóa Stream)
        if (isYouTube || (src && src.startsWith("blob:"))) {
            const mediaType = isAudio ? "Âm thanh (MP3)" : "Video (MP4)";
            if (confirm(`⚠️ Hệ thống phát hiện Video dạng luồng ẩn (Blob) hoặc YouTube.\n\nĐể tải ${mediaType} CHẤT LƯỢNG GỐC, script sẽ mở trình hỗ trợ bóc link (Cobalt/9xbuddy). Bạn đồng ý chứ?`)) {
                let fallbackUrl = "";
                if (isYouTube) {
                    fallbackUrl = `https://cobalt.tools/?u=${encodeURIComponent(pageUrl)}`;
                } else {
                    fallbackUrl = `https://9xbuddy.com/process?url=${encodeURIComponent(pageUrl)}`;
                }
                window.open(fallbackUrl, "_blank");
            }
            return;
        }

        // 2. Link trực tiếp (File tĩnh)
        if (!src) { alert("⚠️ Không lấy được liên kết nguồn media này!"); return; }

        let realFormat = "mp4";
        if (src.toLowerCase().includes(".mp3") || src.toLowerCase().includes(".m4a") || src.toLowerCase().includes(".wav")) {
            realFormat = "mp3";
        } else if (src.toLowerCase().includes(".webm")) {
            realFormat = "webm";
        }

        if (isAudio && realFormat !== "mp3") {
            alert("⚠️ Lưu ý: Nguồn gốc là định dạng Video. Hệ thống sẽ giữ nguyên gốc để tránh lỗi hỏng file.");
        }

        if (!confirm(`❓ XÁC NHẬN TẢI XUỐNG:\n\nBạn có chắc chắn muốn tải tập tin này (Định dạng gốc: .${realFormat}) không?`)) return;

        try {
            const response = await fetch(src);
            if (!response.ok) throw new Error("CORS or Network issue");
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement("a");
            a.href = url;
            a.download = `media_${Date.now()}.${realFormat}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (e) {
            console.log("Fetch failed, using fallback direct link: ", e);
            const a = document.createElement("a");
            a.href = src;
            a.target = "_blank"; // Cứu cánh nếu bị lỗi CORS từ server
            a.download = `media_${Date.now()}.${realFormat}`; 
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }

    // Gắn sự kiện nút tải xuống
    ui.dlMp4.onclick = () => triggerDownload(false);
    ui.dlMp3.onclick = () => triggerDownload(true);

    // Bật tắt Panel UI
    function togglePanel(show = !panelVisible) {
        panelVisible = show;
        panel.style.display = show ? "flex" : "none";
    }

    panel.querySelector("#vcp-close").onclick = () => togglePanel(false);

    document.addEventListener("keydown", e => {
        const el = e.target;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
        if (e.key === "*" || e.key === "Escape") {
            if (e.key === "Escape" && !panelVisible) return;
            e.preventDefault();
            togglePanel();
        }
    });

    updateVolUI(settings.vol);
    ui.quality.value = settings.q;

    // Quét phát hiện Media liên tục (Tránh lỗi DOM chưa load)
    setInterval(() => {
        if (!activeMedia || activeMedia.paused || !document.contains(activeMedia)) {
            const mediaList = document.querySelectorAll("video, audio");
            for (let m of mediaList) {
                if (m.readyState > 0 && !m.paused) {
                    setActiveMedia(m);
                    break;
                }
            }
        }
    }, 2000);
})();
