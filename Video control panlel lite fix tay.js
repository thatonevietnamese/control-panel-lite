// ==UserScript==
// @name         Video Control Panel LITE fix tay
// @namespace    http://tampermonkey.net/
// @version      3.2
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20control%20panlel%20lite%20fix%20tay.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20control%20panlel%20lite%20fix%20tay.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @description  Panel điều khiển âm thanh video - nhẹ và mượt (v3.1 - Fix Shorts & Video Crash)
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS =====
const settings = GM_getValue("settings", {
    volume: 1,
    speed: 1,
    color: "#2b5797",
    autoVideo: true,
    autoLoop: true,
    lastUpdateCheck: 0
});

// ===== STATE =====
let lastVideo = null;
let observer = null;
let isPanelVisible = false;

// ===== CONSTANTS =====
const CURRENT_VERSION = "3.1";
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const HOTKEY = "*";
const LOOP_TIMING_TOLERANCE   = 0.5;
const DETECT_POLL_INTERVAL    = 800; // Tăng tốc độ phản hồi một chút cho Shorts

// ===== CONFLICT CHECK =====
function checkConflict() {
    const proPanel = document.getElementById("panel");
    const litePanel = document.getElementById("vcp-panel");
    if (proPanel && litePanel) {
        showConflictNotification();
    }
}

function showConflictNotification() {
    if (document.getElementById("vcp-conflict-notification")) return;
    const notification = document.createElement("div");
    notification.id = "vcp-conflict-notification";
    notification.innerHTML = `
        <div style="position:fixed; top:20px; right:20px; background:#f44336; color:white; 
                    padding:12px 20px; border-radius:8px; z-index:10002; box-shadow:0 4px 12px rgba(0,0,0,0.3); 
                    font-family:Tahoma; font-size:12px; animation:slideIn 0.3s ease;">
            ⚠️ Conflict! PRO and LITE both running. Please disable one.
            <button onclick="this.parentElement.remove();" 
                    style="margin-left:10px; background:white; color:#f44336; border:none; 
                           padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">
                OK
            </button>
        </div>
    `;
    document.body.appendChild(notification);
}

// ===== HELPERS =====
function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
}

function getVideo(){
    try {
        const videos = document.querySelectorAll("video");
        // Ưu tiên video đang phát (Rất quan trọng với Shorts vì thuật toán Shorts giữ nhiều thẻ video ẩn)
        for (const v of videos) {
            if (v.offsetParent !== null && !v.paused && v.duration > 0) return v;
        }
        for (const v of videos) {
            if (v.offsetParent !== null && v.duration > 0) return v;
        }
        for (const v of videos) {
            if (v.offsetParent !== null) return v;
        }
    } catch (e) {
        console.error("Error in getVideo:", e);
    }
    return null;
}

// ===== AUDIO BOOST CORE (RE-ARCHITECTED FOR SPA/SHORTS) =====
const audioContexts = new WeakMap();
let audioContextSupported = !!(window.AudioContext || window.webkitAudioContext);

function getOrCreateGainNode(video){
    if(!audioContextSupported || !video) return null;

    // Nếu video này ĐÃ TỪNG được tạo rãnh âm thanh, tái sử dụng hoàn toàn node cũ
    // KHÔNG giải phóng (cleanup) khi đổi src để tránh lỗi sập video / mất nguồn cấp.
    if(audioContexts.has(video)){
        const data = audioContexts.get(video);
        if(data.ctx && data.ctx.state === 'suspended'){
            data.ctx.resume().catch(()=>{});
        }
        return data;
    }

    // Kiểm tra xem video đã sẵn sàng nhận AudioContext chưa
    if(!video.src && !video.currentSrc && video.readyState < 1){
        return null;
    }

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        let source;
        
        try {
            source = audioCtx.createMediaElementSource(video);
        } catch(err){
            // Nếu trình phát của trang web (như YT) đã chiếm dụng trước luồng Element
            audioCtx.close().catch(()=>{});
            return null;
        }

        const gainNode = audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const data = { ctx: audioCtx, gain: gainNode };
        audioContexts.set(video, data);

        if(audioCtx.state === 'suspended'){
            audioCtx.resume().catch(()=>{});
        }

        // Fix lỗi video Shorts tự động mute ngầm khi can thiệp AudioContext
        if(video.muted && settings.volume > 0){
            video.muted = false;
        }

        return data;
    } catch(e){
        console.warn("Audio boost initialization deferred/failed:", e.message);
        return null;
    }
}

function smoothGainTransition(gainNode, target, duration = 0.1){
    if(!gainNode) return;
    try {
        const now = gainNode.context.currentTime;
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(target, now + duration);
    } catch(e){}
}

function applyVolume(video){
    const v = video || getVideo();
    if(!v) return;
    applyVolumeToVideo(clamp(settings.volume, 0, 5), v);
}

function applySpeed(video){
    const v = video || getVideo();
    if(!v) return;
    v.playbackRate = clamp(settings.speed, 0.1, 16);
}

// ===== FORCE LOOP =====
let isLooping = false;
function forceLoop() {
    if (!settings.autoLoop || isLooping) return;
    const v = getVideo();
    if (!v) return;

    if (v.ended || (v.currentTime >= v.duration - LOOP_TIMING_TOLERANCE && v.duration > 0)) {
        isLooping = true;
        if (typeof v.fastSeek === "function") {
            v.fastSeek(0);
        } else {
            v.currentTime = 0;
        }
        v.addEventListener("seeked", () => {
            v.play().catch(() => {});
            isLooping = false;
        }, { once: true });
    }
}

// ===== CREATE PANEL UI =====
const panel = document.createElement("div");
panel.id = "vcp-panel";
panel.innerHTML = `
    <div id="vcp-header">
        <span>🔊</span>
        <input type="range" id="vcp-slider" step="0.1" min="0" max="5" value="${settings.volume}">
        <input type="number" id="vcp-vol" step="0.1" min="0" max="5" value="${settings.volume}">
        <div id="vcp-speed">
            <button class="vcp-speed-btn" data-speed="1">1x</button>
            <button class="vcp-speed-btn" data-speed="2">2x</button>
            <button class="vcp-speed-btn" data-speed="3">3x</button>
        </div>
        <label id="vcp-loop-label" title="Loop">
            <input type="checkbox" id="vcp-loop-check" ${settings.autoLoop ? 'checked' : ''}>
            <span>🔁</span>
        </label>
        <button id="vcp-close">×</button>
    </div>
`;

// ===== STYLE =====
GM_addStyle(`
#vcp-panel{ position:fixed; bottom:20px; right:20px; padding:8px 12px; background:${settings.color}; border-radius:20px; z-index:9999; font-family:Tahoma,Arial; box-shadow:0 4px 15px rgba(0,0,0,0.3); }
#vcp-header{display:flex;align-items:center;gap:8px;}
#vcp-slider{ width:100px; height:6px; -webkit-appearance:none; appearance:none; background:rgba(255,255,255,0.3); border-radius:3px; cursor:pointer; }
#vcp-slider::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none; width:16px; height:16px; background:white; border-radius:50%; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.3); }
#vcp-slider::-moz-range-thumb{ width:16px; height:16px; background:white; border-radius:50%; cursor:pointer; border:none; }
#vcp-vol{ width:50px; padding:4px; border:none; border-radius:8px; text-align:center; font-size:14px; background:rgba(255,255,255,0.2); color:white; }
#vcp-vol.booster{ border:2px solid #ff9800; background:linear-gradient(90deg,#fff3e0,#ffe0b2); color:#333; font-weight:bold; }
#vcp-speed{display:flex;gap:4px;}
.vcp-speed-btn{ padding:4px 8px; border:none; border-radius:8px; background:rgba(255,255,255,0.2); color:white; font-size:12px; cursor:pointer; transition:background 0.2s; }
.vcp-speed-btn:hover{background:rgba(255,255,255,0.4);}
.vcp-speed-btn.active{ background:#ff9800; color:white; font-weight:bold; }
#vcp-close{ background:transparent; border:none; color:white; font-size:18px; cursor:pointer; padding:0 4px; }
#vcp-close:hover{opacity:0.7;}
#vcp-loop-label{ display:flex; align-items:center; cursor:pointer; padding:0 4px; }
#vcp-loop-label input{ display:none; }
#vcp-loop-label span{ font-size:16px; opacity:0.6; transition:opacity 0.2s; }
#vcp-loop-label input:checked + span{ opacity:1; color:#ff9800; }
#vcp-loop-label:hover span{opacity:0.8;}
@keyframes slideIn{ from{opacity:0;transform:translateX(100px);} to{opacity:1;transform:translateX(0);} }
`);

// ===== INIT =====
function init(){
    if(!document.body){
        requestAnimationFrame(init);
        return;
    }
    document.body.appendChild(panel);
    panel.style.display = "none";
    initDetection();
    console.log("Video Control Panel LITE v" + CURRENT_VERSION + " OK (Shorts Optimized)");
}

// ===== AUTO SHOW/HIDE & MOUNT DATA =====
function detectVideo(){
    const v = getVideo();
    if(!v) {
        if(settings.autoVideo && isPanelVisible) {
            isPanelVisible = false;
            panel.style.display = "none";
        }
        return;
    }

    const videoSrc = v.src || v.currentSrc || '';
    const lastSrc = lastVideo ? (lastVideo.src || lastVideo.currentSrc || '') : '';
    
    // Nếu đổi sang video hoàn toàn mới hoặc đổi SRC (rất phổ biến trên Shorts/SPA)
    if(v !== lastVideo || videoSrc !== lastSrc){
        lastVideo = v;
        
        if(settings.autoVideo){
            isPanelVisible = true;
            panel.style.display = "block";
        }
        
        // Thực thi cấu hình âm lượng / tốc độ tức thì lên video mới
        applyVolume(v);
        applySpeed(v);
    }
}

// ===== INIT DETECTION =====
function initDetection(){
    if(document.readyState === "complete"){
        detectVideo();
    } else {
        window.addEventListener("load", detectVideo);
    }
    
    document.addEventListener("visibilitychange", () => {
        if(!document.hidden) detectVideo();
    });
    
    // Bắt chặt các sự kiện thay đổi trạng thái của Media Element trên trang SPA
    const events = ["play", "playing", "loadstart", "durationchange", "loadeddata"];
    events.forEach(evt => {
        document.addEventListener(evt, e => {
            if(e.target.tagName === "VIDEO") detectVideo();
        }, true);
    });

    // MUTATION OBSERVER
    try {
        if(observer) observer.disconnect();
        observer = new MutationObserver(mutations => {
            for(const mut of mutations){
                if(mut.addedNodes.length > 0){
                    for(const node of mut.addedNodes){
                        if(node.nodeName === "VIDEO" || (node.querySelector && node.querySelector("video"))){
                            detectVideo();
                            return;
                        }
                    }
                }
            }
        });
        observer.observe(document.body, {childList: true, subtree: true});
    } catch(e) {
        console.warn("MutationObserver error:", e);
    }

    // Polling fallback khẩn cấp cho cơ chế cuộn mượt (Seamless Slider) của YouTube Shorts
    setInterval(detectVideo, DETECT_POLL_INTERVAL);
}

// ===== VOLUME INPUT CONTROLS =====
const volInput = panel.querySelector("#vcp-vol");
const volSlider = panel.querySelector("#vcp-slider");

function updateVolUI(val){
    volSlider.value = val;
    volInput.value = val;
    volInput.classList.toggle("booster", val > 1);
}

function setVolume(val, save = true){
    val = clamp(parseFloat(val) || 0, 0, 5);
    if(save){
        settings.volume = val;
        GM_setValue("settings", settings);
    }
    updateVolUI(val);
    applyVolumeToVideo(val);
}

volInput.addEventListener("change", () => setVolume(volInput.value));
volInput.addEventListener("input", () => {
    const val = clamp(parseFloat(volInput.value) || 0, 0, 5);
    updateVolUI(val);
    applyVolumeToVideo(val);
});

volSlider.addEventListener("input", () => {
    const val = clamp(parseFloat(volSlider.value) || 0, 0, 5);
    updateVolUI(val);
    applyVolumeToVideo(val);
});
volSlider.addEventListener("change", () => setVolume(volSlider.value, true));

function applyVolumeToVideo(val, optVideo){
    const v = optVideo || getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    if(val <= 1){
        v.volume = val;
        if(audioData && audioData.gain) smoothGainTransition(audioData.gain, 1);
    } else {
        v.volume = 1;
        if(audioData && audioData.gain){
            smoothGainTransition(audioData.gain, val);
        } else {
            showBoosterUnavailableWarning();
        }
    }
}

function showBoosterUnavailableWarning(){
    if(showBoosterUnavailableWarning._shown) return;
    showBoosterUnavailableWarning._shown = true;
    console.warn("⚠ Audio boost limited to 1x due to site constraints (CORS/Custom Audio Player).");
}

// ===== SPEED BUTTONS =====
const speedBtns = panel.querySelectorAll(".vcp-speed-btn");
function updateSpeedButtons(speed){
    speedBtns.forEach(btn => {
        btn.classList.toggle("active", parseFloat(btn.dataset.speed) === speed);
    });
}

speedBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        const speed = parseFloat(btn.dataset.speed);
        settings.speed = speed;
        GM_setValue("settings", settings);
        applySpeed();
        updateSpeedButtons(speed);
    });
});
updateSpeedButtons(settings.speed);

// ===== CLOSE BUTTON =====
panel.querySelector("#vcp-close").addEventListener("click", () => {
    isPanelVisible = false;
    panel.style.display = "none";
});

// ===== LOOP TOGGLE =====
const loopCheck = panel.querySelector("#vcp-loop-check");
let loopInterval = null;

function toggleLoop() {
    if(loopCheck) settings.autoLoop = loopCheck.checked;
    GM_setValue("settings", settings);
    
    if(loopInterval) {
        clearInterval(loopInterval);
        loopInterval = null;
    }
    if(settings.autoLoop){
        loopInterval = setInterval(forceLoop, 500);
    }
}

if(loopCheck){
    loopCheck.addEventListener("change", toggleLoop);
    if(settings.autoLoop) toggleLoop();
}

// ===== TOGGLE HOTKEY =====
document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    if(e.key === "Escape" && isPanelVisible){
        isPanelVisible = false;
        panel.style.display = "none";
        return;
    }
    if(tag === "INPUT" || tag === "TEXTAREA") return;
    
    let hotkeyMatch = (HOTKEY.length === 1) ? (e.key === HOTKEY) : (e.code === HOTKEY.toUpperCase());
    if(hotkeyMatch && !(e.ctrlKey || e.altKey || e.shiftKey || e.metaKey)){
        e.preventDefault();
        const v = getVideo();
        if(settings.autoVideo && !v){
            isPanelVisible = false;
            panel.style.display = "none";
            return;
        }
        isPanelVisible = !isPanelVisible;
        panel.style.display = isPanelVisible ? "block" : "none";
        if(isPanelVisible){ volInput.focus(); volInput.select(); }
    }
});

// ===== AUTO UPDATE =====
function checkForUpdates(){
    const now = Date.now();
    if(now - settings.lastUpdateCheck < UPDATE_INTERVAL) return;
    try {
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20control%20panlel%20lite%20fix%20tay.js",
            onload: function(response) {
                if(response.status === 200){
                    const match = response.responseText.match(/@version\s+([\d.]+)/);
                    if(match && match[1] && match[1] !== CURRENT_VERSION){
                        showUpdateNotification(match[1]);
                    }
                    settings.lastUpdateCheck = now;
                    GM_setValue("settings", settings);
                }
            },
            onerror: () => { settings.lastUpdateCheck = now; }
        });
    } catch(e) {}
}

function showUpdateNotification(newVersion) {
    if(document.getElementById("vcp-update-notification")) return;
    const notification = document.createElement("div");
    notification.id = "vcp-update-notification";
    notification.innerHTML = `
        <div style="position:fixed; top:20px; right:20px; background:#4CAF50; color:white; 
                    padding:15px; border-radius:8px; z-index:10000; box-shadow:0 4px 15px rgba(0,0,0,0.3);
                    font-family:Tahoma; font-size:12px; animation:slideIn 0.3s ease;">
            🔔 Update available: v${newVersion}
            <button onclick="location.reload()" style="margin-left:10px; padding:5px 15px; background:white; color:#4CAF50; border:none; border-radius:4px; cursor:pointer;">Reload</button>
        </div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => { if(notification.parentElement) notification.remove(); }, 10000);
}

// ===== START =====
init();
setTimeout(checkForUpdates, 5000);
setTimeout(checkConflict, 2000);
})();
