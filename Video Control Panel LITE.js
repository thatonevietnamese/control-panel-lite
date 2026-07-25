// ==UserScript==
// @name         Video Control Panel LITE v4.6 (Fix Bug Volume + Quality Selector)
// @namespace    http://tampermonkey.net/
// @version      4.6
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/youtube-adb-lite/main/youtube-adb-core.user.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/youtube-adb-lite/main/youtube-adb-core.user.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @description  Sửa triệt để bug mất âm lượng khi đổi video/đổi volume trên YT + Thêm bộ chọn chất lượng bypass lỗi UI
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS CACHE =====
const settings = GM_getValue("vcp_settings", { vol: 1, spd: 1, loop: true, forceResume: false, q: "auto" });
let activeVid = null;
let panelVisible = false;
let volLock = false; // Flag chống lặp vô hạn khi khóa âm lượng
const isYouTube = location.hostname.includes("youtube.com");

// ===== ANTI-PAUSE (FORCE RESUME) KERNEL =====
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
Object.defineProperty(document, 'hidden', { get: () => false });
window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);

// ===== AUDIO & QUALITY CORE =====
const audioCtxMap = new WeakMap();
const hasAudioCtx = !!(window.AudioContext || window.webkitAudioContext);

function applyMediaSettings(v) {
    if(!v || volLock) return;
    
    // 1. Áp dụng tốc độ phát
    v.playbackRate = settings.spd;
    
    // 2. Ép độ phân giải độc quyền cho YouTube
    if (isYouTube) {
        try {
            const player = document.getElementById("movie_player");
            if (player && typeof player.setPlaybackQualityRange === "function") {
                player.setPlaybackQualityRange(settings.q);
                player.setPlaybackQuality(settings.q);
            }
        } catch(e){}
    }

    // 3. Xử lý Khuyếch đại âm thanh x5 bọc trong lõi Lock
    if(!hasAudioCtx) return;
    let data = audioCtxMap.get(v);
    if (!data) {
        if (!v.src && !v.currentSrc) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx();
            const source = ctx.createMediaElementSource(v);
            const gain = ctx.createGain();
            source.connect(gain);
            gain.connect(ctx.destination);
            data = { ctx, gain };
            audioCtxMap.set(v, data);
        } catch(e) { return; }
    }
    
    if (data.ctx.state === 'suspended') data.ctx.resume().catch(()=>{});
    if (v.muted && settings.vol > 0) v.muted = false;

    // Tiến hành khóa cứng Volume, chặn YouTube ghi đè
    volLock = true;
    if (settings.vol <= 1) {
        v.volume = settings.vol;
        if(data.gain) data.gain.gain.value = 1;
    } else {
        v.volume = 1; // Giữ volume gốc là 1 để tránh vỡ tiếng
        if(data.gain) {
            try {
                data.gain.gain.setValueAtTime(data.gain.gain.value, data.ctx.currentTime);
                data.gain.gain.linearRampToValueAtTime(settings.vol, data.ctx.currentTime + 0.1);
            } catch(e) { data.gain.gain.value = settings.vol; }
        }
    }
    volLock = false;
}

// ===== EVENT-DRIVEN KERNEL =====
function setActiveVideo(v) {
    if (!v) return;
    
    // Tháo và gán lại sự kiện loop chuẩn chỉ
    if (v !== activeVid) {
        if (activeVid) activeVid.removeEventListener("timeupdate", checkLoop);
        activeVid = v;
        activeVid.addEventListener("timeupdate", checkLoop);
    }
    
    applyMediaSettings(activeVid);
    if (!panelVisible) togglePanel(true);
}

// Bắt mọi sự kiện Play để nạp lại cấu hình (Trị bệnh đổi video SPA)
document.addEventListener("play", (e) => {
    if (e.target.tagName === "VIDEO") {
        setActiveVideo(e.target);
        if (settings.forceResume) e.target.play().catch(()=>{});
    }
}, true);

document.addEventListener("pause", (e) => {
    if (settings.forceResume && e.target === activeVid && !e.target.ended) {
        e.preventDefault();
        e.target.play().catch(()=>{});
    }
}, true);

// Bắt sự kiện đổi volume của hệ thống/YouTube để đè ngược lại cấu hình của Script
document.addEventListener("volumechange", (e) => {
    if (e.target.tagName === "VIDEO" && !volLock) {
        applyMediaSettings(e.target);
    }
}, true);

function checkLoop() {
    if (!settings.loop || !activeVid) return;
    if (activeVid.duration && activeVid.currentTime >= activeVid.duration - 0.3) {
        activeVid.currentTime = 0;
        activeVid.play().catch(()=>{});
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
#vcp-panel label span { opacity:0.4; font-size:15px; filter:grayscale(100%); }
#vcp-panel input:checked + span { opacity:1; filter:grayscale(0%); }
#vcp-close { background:none; border:none; color:#fff; font-size:18px; cursor:pointer; }
`);

document.documentElement.appendChild(panel);

// ===== CONTROLS LOGIC =====
const ui = {
    slider: panel.querySelector("#vcp-slider"),
    vol: panel.querySelector("#vcp-vol"),
    spdBtns: panel.querySelectorAll("#vcp-speed button"),
    quality: panel.querySelector("#vcp-quality"),
    loop: panel.querySelector("#vcp-loop"),
    force: panel.querySelector("#vcp-force")
};

if (!isYouTube) ui.quality.style.display = "none";

function saveSettings() { GM_setValue("vcp_settings", settings); }

function updateVolUI(v) {
    ui.slider.value = ui.vol.value = v;
    ui.vol.classList.toggle("boost", v > 1);
}

function updateSpeedUI() {
    ui.spdBtns.forEach(b => b.classList.toggle("active", parseFloat(b.dataset.s) === settings.spd));
}

function handleVolChange(val) {
    settings.vol = Math.max(0, Math.min(5, parseFloat(val) || 0));
    updateVolUI(settings.vol);
    if(activeVid) applyMediaSettings(activeVid);
    saveSettings();
}

ui.slider.oninput = e => handleVolChange(e.target.value);
ui.vol.onchange = e => handleVolChange(e.target.value);
ui.loop.onchange = e => { settings.loop = e.target.checked; saveSettings(); };
ui.force.onchange = e => { settings.forceResume = e.target.checked; saveSettings(); };

ui.quality.onchange = e => {
    settings.q = e.target.value;
    if(activeVid) applyMediaSettings(activeVid);
    saveSettings();
};

ui.spdBtns.forEach(btn => {
    btn.onclick = () => {
        settings.spd = parseFloat(btn.dataset.s);
        updateSpeedUI();
        if(activeVid) applyMediaSettings(activeVid);
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
    const vids = document.getElementsByTagName("video");
    for(let v of vids) { if(v.readyState > 0 && !v.paused) { setActiveVideo(v); break; } }
}, 1000);

})();
