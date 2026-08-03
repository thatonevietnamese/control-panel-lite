// ==UserScript==
// @name         Video Control Panel LITE v4.6 (Fix Bug Volume + Quality Selector)
// @namespace    http://tampermonkey.net/
// @version      4.6
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @description  Sửa triệt để bug mất âm lượng khi đổi video/đổi volume trên YT + Thêm bộ chọn chất lượng bypass lỗi UI
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS CACHE =====
// Thêm tuỳ chọn enableBoost (mặc định false để không tự động ép Web Audio API gây lỗi mất tiếng)
const settings = GM_getValue("vcp_settings", { vol: 1, spd: 1, loop: false, forceResume: false, q: "auto", enableBoost: false });
let activeMedia = null;
let panelVisible = false;
let volLock = false; 
const isYouTube = location.hostname.includes("youtube.com");

// ===== ANTI-PAUSE (FORCE RESUME) KERNEL =====
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
Object.defineProperty(document, 'hidden', { get: () => false });
window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);

// ===== AUDIO & QUALITY CORE =====
const audioCtxMap = new WeakMap();
const hasAudioCtx = !!(window.AudioContext || window.webkitAudioContext);

function applyMediaSettings(m) {
    if(!m || volLock) return;
    
    // 1. Áp dụng tốc độ phát
    m.playbackRate = settings.spd;
    
    // 2. Ép độ phân giải độc quyền cho YouTube (chỉ áp dụng nếu là Video)
    if (isYouTube && m.tagName === "VIDEO") {
        try {
            const player = document.getElementById("movie_player");
            if (player && typeof player.setPlaybackQualityRange === "function") {
                player.setPlaybackQualityRange(settings.q);
                player.setPlaybackQuality(settings.q);
            }
        } catch(e){}
    }

    // 3. Khởi tạo AudioContext NẾU người dùng cho phép bật Boost
    if(hasAudioCtx && settings.enableBoost) {
        let data = audioCtxMap.get(m);
        if (!data) {
            // Chỉ khởi tạo khi Media đã có source
            if (m.src || m.currentSrc) {
                try {
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    const ctx = new Ctx();
                    const source = ctx.createMediaElementSource(m);
                    const gain = ctx.createGain();
                    source.connect(gain);
                    gain.connect(ctx.destination);
                    data = { ctx, gain };
                    audioCtxMap.set(m, data);
                } catch(e) {
                    console.warn("VCP: Không thể khởi tạo AudioContext (Có thể do CORS)", e);
                }
            }
        }
        
        // Cố gắng resume AudioContext nếu nó bị trình duyệt suspend
        if (data && data.ctx.state === 'suspended') {
            data.ctx.resume().catch(()=>{});
        }
    }

    if (m.muted && settings.vol > 0) m.muted = false;

    // 4. Áp dụng Âm lượng (Bọc trong volLock để chống vòng lặp vô hạn)
    volLock = true;
    let data = audioCtxMap.get(m);

    if (settings.enableBoost && data) {
        // Chế độ Boost Volume qua Web Audio API
        if (settings.vol <= 1) {
            m.volume = settings.vol;
            if(data.gain) data.gain.gain.value = 1;
        } else {
            m.volume = 1; // Giữ volume gốc là 1 để tránh vỡ tiếng, phần dư đẩy cho GainNode
            if(data.gain) {
                try {
                    data.gain.gain.setTargetAtTime(settings.vol, data.ctx.currentTime, 0.1);
                } catch(e) { data.gain.gain.value = settings.vol; }
            }
        }
    } else {
        // Chế độ an toàn (Không Boost): Giới hạn volume hệ thống ở mức tối đa 1 (100%)
        m.volume = Math.min(settings.vol, 1);
        
        // Nếu trước đó đã khởi tạo GainNode, reset nó về 1
        if (data && data.gain) {
            data.gain.gain.value = 1;
        }
    }
    volLock = false;
}

// ===== EVENT-DRIVEN KERNEL =====
function setActiveMedia(m) {
    if (!m) return;
    
    // Tháo và gán lại sự kiện loop chuẩn chỉ
    if (m !== activeMedia) {
        if (activeMedia) activeMedia.removeEventListener("timeupdate", checkLoop);
        activeMedia = m;
        activeMedia.addEventListener("timeupdate", checkLoop);
    }
    
    applyMediaSettings(activeMedia);
    if (!panelVisible) togglePanel(true);
}

// Bắt sự kiện Play cho cả VIDEO và AUDIO
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

// Bắt sự kiện đổi volume của hệ thống/web để đè ngược lại cấu hình của Script
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
#vcp-panel label span { opacity:0.4; font-size:15px; filter:grayscale(100%); }
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
    updateVolUI(settings.vol); // Cập nhật lại màu sắc số volume
    if(activeMedia) applyMediaSettings(activeMedia);
    saveSettings();
};

ui.loop.onchange = e => { settings.loop = e.target.checked; saveSettings(); };
ui.force.onchange = e => { settings.forceResume = e.target.checked; saveSettings(); };

ui.quality.onchange = e => {
    settings.q = e.target.value;
    if(activeMedia) applyMediaSettings(activeMedia);
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

// Chạy khởi tạo ban đầu
updateVolUI(settings.vol);
updateSpeedUI();
ui.quality.value = settings.q;

setTimeout(() => {
    // Quét tìm cả video và audio elements
    const mediaElements = document.querySelectorAll("video, audio");
    for(let m of mediaElements) { 
        if(m.readyState > 0 && !m.paused) { 
            setActiveMedia(m); 
            break; 
        } 
    }
}, 1000);

})();
