// ==UserScript==
// @name         Video/Audio Control Panel LITE v5.1 (Stable + No Stutter + GC Fix)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @description  Hỗ trợ Video/Audio, Toggle Boost an toàn, Tối ưu hóa hiệu năng và Anti-Pause thông minh.
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS CACHE =====
const settings = GM_getValue("vcp_settings", { vol: 1, spd: 1, loop: false, forceResume: false, q: "auto", enableBoost: false });
let activeMedia = null;
let panelVisible = false;
let volLock = false; 
const isYouTube = location.hostname.includes("youtube.com");

// ===== ANTI-PAUSE KERNEL (SMART PROXY) =====
// Đã fix: Trả về trạng thái thực của tab nếu không bật Force Resume để tránh lỗi các web khác.
const nativeVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
const nativeHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');

if (nativeVisibility) {
    Object.defineProperty(document, 'visibilityState', {
        get: function() { return settings.forceResume ? 'visible' : nativeVisibility.get.call(this); }
    });
}
if (nativeHidden) {
    Object.defineProperty(document, 'hidden', {
        get: function() { return settings.forceResume ? false : nativeHidden.get.call(this); }
    });
}

window.addEventListener('visibilitychange', e => {
    if (settings.forceResume) e.stopImmediatePropagation();
}, true);

// ===== AUDIO CORE =====
const audioCtxMap = new WeakMap();
const hasAudioCtx = !!(window.AudioContext || window.webkitAudioContext);

function applyMediaSettings(m) {
    if(!m || volLock) return;
    
    // 1. Áp dụng tốc độ phát
    m.playbackRate = settings.spd;

    // 2. Xử lý Audio Context (Nếu cho phép)
    if(hasAudioCtx && settings.enableBoost) {
        let data = audioCtxMap.get(m);
        if (!data) {
            if (m.src || m.currentSrc) {
                try {
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    const ctx = new Ctx();
                    const source = ctx.createMediaElementSource(m);
                    const gain = ctx.createGain();
                    source.connect(gain);
                    gain.connect(ctx.destination);
                    // Đã fix: Lưu source lại để tránh bị Garbage Collector dọn dẹp gây ngắt tiếng
                    data = { ctx, gain, source };
                    audioCtxMap.set(m, data);
                } catch(e) {
                    console.warn("VCP: Không thể khởi tạo AudioContext (Có thể do CORS)", e);
                }
            }
        }
        if (data && data.ctx.state === 'suspended') data.ctx.resume().catch(()=>{});
    }

    if (m.muted && settings.vol > 0) m.muted = false;

    // 3. Khóa chống đệ quy (volLock) an toàn với try...finally
    volLock = true;
    try {
        let data = audioCtxMap.get(m);

        if (settings.enableBoost && data) {
            if (settings.vol <= 1) {
                m.volume = settings.vol;
                if(data.gain) {
                    try { data.gain.gain.setTargetAtTime(1, data.ctx.currentTime, 0.1); } 
                    catch(e) { data.gain.gain.value = 1; }
                }
            } else {
                m.volume = 1;
                if(data.gain) {
                    try { data.gain.gain.setTargetAtTime(settings.vol, data.ctx.currentTime, 0.1); } 
                    catch(e) { data.gain.gain.value = settings.vol; }
                }
            }
        } else {
            m.volume = Math.min(settings.vol, 1);
            if (data && data.gain) {
                // Đã fix: Chống tiếng click/pop khi tắt boost
                try { data.gain.gain.setTargetAtTime(1, data.ctx.currentTime, 0.1); } 
                catch(e) { data.gain.gain.value = 1; }
            }
        }
    } finally {
        volLock = false;
    }
}

// ===== YOUTUBE QUALITY KERNEL =====
// Đã fix: Tách riêng ra để không bị gọi liên tục khi thay đổi âm lượng gây giật video
function applyYouTubeQuality(m) {
    if (!isYouTube || !m || m.tagName !== "VIDEO") return;
    try {
        const player = document.getElementById("movie_player");
        if (player && typeof player.setPlaybackQualityRange === "function") {
            player.setPlaybackQualityRange(settings.q);
            player.setPlaybackQuality(settings.q);
        }
    } catch(e){}
}

// ===== EVENT-DRIVEN KERNEL =====
function setActiveMedia(m) {
    if (!m) return;
    if (m !== activeMedia) {
        if (activeMedia) activeMedia.removeEventListener("timeupdate", checkLoop);
        activeMedia = m;
        activeMedia.addEventListener("timeupdate", checkLoop);
        applyYouTubeQuality(activeMedia); // Gọi 1 lần khi chuyển video
    }
    
    applyMediaSettings(activeMedia);
    if (!panelVisible) togglePanel(true);
}

document.addEventListener("play", (e) => {
    if (e.target.tagName === "VIDEO" || e.target.tagName === "AUDIO") {
        setActiveMedia(e.target);
        if (settings.forceResume) e.target.play().catch(()=>{});
    }
}, true);

document.addEventListener("pause", (e) => {
    if (settings.forceResume && e.target === activeMedia && !e.target.ended) {
        e.preventDefault();
        e.target.play().catch(()=>{});
    }
}, true);

document.addEventListener("volumechange", (e) => {
    if ((e.target.tagName === "VIDEO" || e.target.tagName === "AUDIO") && !volLock) {
        applyMediaSettings(e.target);
    }
}, true);

function checkLoop() {
    if (!settings.loop || !activeMedia) return;
    if (activeMedia.duration && activeMedia.currentTime >= activeMedia.duration - 0.3) {
        activeMedia.currentTime = 0;
        activeMedia.play().catch(()=>{});
    }
}

// ===== UI & DOM =====
const panel = document.createElement("div");
panel.id = "vcp-panel";
panel.innerHTML = `
    <span>🔊</span>
    <input type="range" id="vcp-slider" step="0.1" min="0" max="5" value="${settings.vol}">
    <input type="number" id="vcp-vol" step="0.1" min="0" max="5" value="${settings.vol}">
    <div id="vcp-speed">
        <button data-s="1">1x</button>
        <button data-s="2">2x</button>
        <button data-s="3">3x</button>
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
    <label title="Kích hoạt Audio Boost (Tắt nếu video bị mất tiếng)"><input type="checkbox" id="vcp-boost" ${settings.enableBoost?'checked':''}><span>🚀</span></label>
    <label title="Auto Loop"><input type="checkbox" id="vcp-loop" ${settings.loop?'checked':''}><span>🔁</span></label>
    <label title="Force Resume (Anti-Pause)"><input type="checkbox" id="vcp-force" ${settings.forceResume?'checked':''}><span>⏯️</span></label>
    <button id="vcp-close">×</button>
`;

GM_addStyle(`
#vcp-panel { position:fixed; bottom:20px; right:20px; padding:8px 12px; background:#1e1e1e; border-radius:20px; z-index:2147483647; font:13px Arial; color:#fff; box-shadow:0 4px 15px rgba(0,0,0,0.5); display:none; align-items:center; gap:8px; border: 1px solid #444; }
#vcp-slider { width:90px; height:6px; appearance:none; background:#444; border-radius:3px; cursor:pointer; }
#vcp-slider::-webkit-slider-thumb { appearance:none; width:14px; height:14px; background:#4CAF50; border-radius:50%; }
#vcp-vol { width:45px; padding:2px; border:none; border-radius:5px; text-align:center; background:#333; color:#fff; }
#vcp-vol.boost { color:#ff9800; font-weight:bold; }
#vcp-speed button { padding:3px 6px; border:none; border-radius:5px; background:#333; color:#fff; cursor:pointer; font-size:11px; }
#vcp-speed button.active { background:#4CAF50; }
#vcp-quality { background:#333; color:#fff; border:1px solid #555; border-radius:5px; padding:2px; font-size:11px; cursor:pointer; outline:none; }
#vcp-panel label { cursor:pointer; padding:0 3px; display:flex; align-items:center; }
#vcp-panel input[type="checkbox"] { display:none; }
#vcp-panel label span { opacity:0.4; font-size:15px; filter:grayscale(100%); transition:0.2s; }
#vcp-panel input:checked + span { opacity:1; filter:grayscale(0%); }
#vcp-close { background:none; border:none; color:#fff; font-size:18px; cursor:pointer; padding-left: 5px; }
`);

document.documentElement.appendChild(panel);

// ===== CONTROLS LOGIC =====
const ui = {
    slider: panel.querySelector("#vcp-slider"),
    vol: panel.querySelector("#vcp-vol"),
    spdBtns: panel.querySelectorAll("#vcp-speed button"),
    quality: panel.querySelector("#vcp-quality"),
    boost: panel.querySelector("#vcp-boost"),
    loop: panel.querySelector("#vcp-loop"),
    force: panel.querySelector("#vcp-force")
};

if (!isYouTube) ui.quality.style.display = "none";

function saveSettings() { GM_setValue("vcp_settings", settings); }

function updateVolUI(v) {
    ui.slider.value = ui.vol.value = v;
    ui.vol.classList.toggle("boost", v > 1 && settings.enableBoost);
}

function updateSpeedUI() {
    ui.spdBtns.forEach(b => b.classList.toggle("active", parseFloat(b.dataset.s) === settings.spd));
}

function handleVolChange(val) {
    settings.vol = Math.max(0, Math.min(5, parseFloat(val) || 0));
    updateVolUI(settings.vol);
    if(activeMedia) applyMediaSettings(activeMedia);
    saveSettings();
}

ui.slider.oninput = e => handleVolChange(e.target.value);
ui.vol.onchange = e => handleVolChange(e.target.value);

ui.boost.onchange = e => {
    settings.enableBoost = e.target.checked;
    updateVolUI(settings.vol);
    if(activeMedia) applyMediaSettings(activeMedia);
    saveSettings();
};

ui.loop.onchange = e => { settings.loop = e.target.checked; saveSettings(); };
ui.force.onchange = e => { settings.forceResume = e.target.checked; saveSettings(); };

ui.quality.onchange = e => {
    settings.q = e.target.value;
    if(activeMedia) applyYouTubeQuality(activeMedia);
    saveSettings();
};

ui.spdBtns.forEach(btn => {
    btn.onclick = () => {
        settings.spd = parseFloat(btn.dataset.s);
        updateSpeedUI();
        if(activeMedia) applyMediaSettings(activeMedia);
        saveSettings();
    };
});

function togglePanel(show = !panelVisible) {
    panelVisible = show;
    panel.style.display = show ? "flex" : "none";
}

panel.querySelector("#vcp-close").onclick = () => togglePanel(false);

document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (e.key === "*" || e.key === "Escape") {
        if(e.key === "Escape" && !panelVisible) return;
        e.preventDefault();
        togglePanel();
    }
});

updateVolUI(settings.vol);
updateSpeedUI();
ui.quality.value = settings.q;

setTimeout(() => {
    const mediaElements = document.querySelectorAll("video, audio");
    for(let m of mediaElements) { 
        if(m.readyState > 0 && !m.paused) { 
            setActiveMedia(m); 
            break; 
        } 
    }
}, 1000);

})();
