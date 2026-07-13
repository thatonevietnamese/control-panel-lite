// ==UserScript==
// @name         Video Control Panel LITE (Super Optimized + Force Resume)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @description  Phiên bản siêu tối ưu, loại bỏ rác, Event-driven, thêm Force Resume
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS CACHE =====
const settings = GM_getValue("vcp_settings", { vol: 1, spd: 1, loop: true, forceResume: false });
let activeVid = null;
let panelVisible = false;

// ===== ANTI-PAUSE (FORCE RESUME) KERNEL =====
// Đánh lừa trình duyệt rằng tab lúc nào cũng đang mở để tránh web tự pause video
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
Object.defineProperty(document, 'hidden', { get: () => false });
window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);

// ===== AUDIO CORE (Lazy Load) =====
const audioCtxMap = new WeakMap();
const hasAudioCtx = !!(window.AudioContext || window.webkitAudioContext);

function applyAudio(v) {
    if(!v || !hasAudioCtx) return;
    v.playbackRate = settings.spd;
    
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

    if (settings.vol <= 1) {
        v.volume = settings.vol;
        if(data.gain) data.gain.gain.value = 1;
    } else {
        v.volume = 1;
        if(data.gain) {
            try {
                data.gain.gain.setValueAtTime(data.gain.gain.value, data.ctx.currentTime);
                data.gain.gain.linearRampToValueAtTime(settings.vol, data.ctx.currentTime + 0.1);
            } catch(e) { data.gain.gain.value = settings.vol; }
        }
    }
}

// ===== EVENT-DRIVEN VIDEO DETECTION =====
// Chỉ gán sự kiện cho video ĐANG CHẠY để tiết kiệm tài nguyên
function setActiveVideo(v) {
    if (!v || v === activeVid) return;
    
    if (activeVid) activeVid.removeEventListener("timeupdate", checkLoop);
    activeVid = v;
    activeVid.addEventListener("timeupdate", checkLoop);
    
    applyAudio(activeVid);
    if (!panelVisible) togglePanel(true);
}

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
    loop: panel.querySelector("#vcp-loop"),
    force: panel.querySelector("#vcp-force")
};

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
    applyAudio(activeVid);
    saveSettings();
}

ui.slider.oninput = e => handleVolChange(e.target.value);
ui.vol.onchange = e => handleVolChange(e.target.value);
ui.loop.onchange = e => { settings.loop = e.target.checked; saveSettings(); };
ui.force.onchange = e => { settings.forceResume = e.target.checked; saveSettings(); };

ui.spdBtns.forEach(btn => {
    btn.onclick = () => {
        settings.spd = parseFloat(btn.dataset.s);
        updateSpeedUI();
        applyAudio(activeVid);
        saveSettings();
    };
});

// Panel Toggle
function togglePanel(show = !panelVisible) {
    panelVisible = show;
    panel.style.display = show ? "flex" : "none";
}

panel.querySelector("#vcp-close").onclick = () => togglePanel(false);

document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "*" || e.key === "Escape") {
        if(e.key === "Escape" && !panelVisible) return;
        e.preventDefault();
        togglePanel();
    }
});

// Khởi tạo UI lần đầu
updateVolUI(settings.vol);
updateSpeedUI();

// Quét nhanh lúc mới vào trang (dành cho các web chạy video sẵn trước khi script load)
setTimeout(() => {
    const vids = document.getElementsByTagName("video");
    for(let v of vids) { if(v.readyState > 0 && !v.paused) { setActiveVideo(v); break; } }
}, 1000);

})();
