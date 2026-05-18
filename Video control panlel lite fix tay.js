// ==UserScript==
// @name         Video Control Panel LITE fix tay
// @namespace    http://tampermonkey.net/
// @version      3.0
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20control%20panlel%20lite%20fix%20tay.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20control%20panlel%20lite%20fix%20tay.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @description  Panel điều khiển âm thanh video - nhẹ và mượt (v3.0)
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

// ===== CONSTANTS (hoisted declarations — must be before any function that uses them) =====
const CURRENT_VERSION = "3.0";
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const HOTKEY = "*";
const LOOP_TIMING_TOLERANCE   = 0.5;   // s  — proximity to end to trigger loop
const GAIN_TRANSITION_DURATION = 0.1;  // s  — fade duration when changing gain
const DETECT_POLL_INTERVAL    = 1000;  // ms — SPA fallback: how often to poll for new <video>

// ===== CONFLICT CHECK =====
function checkConflict() {
    // LITE uses id="vcp-panel", PRO uses id="panel"
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
    console.warn("Conflict detected: Both PRO and LITE versions are running!");
}

// ===== HELPERS =====
function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
}

function getVideo(){
    try {
        const videos = document.querySelectorAll("video");
        // Prioritize playing video
        for (const v of videos) {
            if (v.offsetParent !== null && !v.paused && v.duration > 0) return v;
        }
        // Fallback: video with duration
        for (const v of videos) {
            if (v.offsetParent !== null && v.duration > 0) return v;
        }
        // Fallback: any visible video
        for (const v of videos) {
            if (v.offsetParent !== null) return v;
        }
    } catch (e) {
        console.error("Error in getVideo:", e);
    }
    return null;
}

// ===== AUDIO BOOST =====
// =======================
// AUDIO BOOST CORE (FIXED)
// =======================

const audioContexts = new WeakMap();
const processedVideos = new WeakSet();
let audioContextSupported = !!(window.AudioContext || window.webkitAudioContext);

// Fallback khi boost fail - thiết lập volume trực tiếp
function applyFallbackVolume(video, desiredVolume) {
    if(!video) return;
    video.volume = Math.min(1, desiredVolume);
    console.log("Fallback volume applied:", video.volume);
}

// Attach audio boost to video (dùng cho re-hook)
function attachAudioBoost(video) {
    if(!video) return;

    // Cleanup cũ trước
    if(audioContexts.has(video)) {
        const audioData = audioContexts.get(video);
        try {
            if(audioData.ctx && audioData.ctx.state !== 'closed') {
                audioData.ctx.close().catch(() => {});
            }
        } catch(e) {}
        audioContexts.delete(video);
        processedVideos.delete(video);
    }

    // Thử tạo gain node mới
    const audioData = getOrCreateGainNode(video);
    if(audioData) {
        smoothGainTransition(audioData.gain, clamp(settings.volume, 0, 5));
    } else {
        // Fallback khi CORS hoặc lỗi
        applyFallbackVolume(video, settings.volume);
    }
}

// Cleanup khi video reload / đổi source
function cleanupAudioContext(video){
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        try {
            if(audioData.ctx && audioData.ctx.state !== 'closed'){
                audioData.ctx.close().catch(() => {});
            }
        } catch(e) {}

        audioContexts.delete(video);
        processedVideos.delete(video);
        console.log("Audio context cleaned");
    }
}

// Hook lifecycle video (QUAN TRỌNG)
function attachVideoListeners(video){
    if(video._audioHooked) return;
    video._audioHooked = true;

    video.addEventListener("loadstart", () => cleanupAudioContext(video));
    video.addEventListener("emptied", () => cleanupAudioContext(video));
    video.addEventListener("error", () => cleanupAudioContext(video));
}

// Core create gain
function getOrCreateGainNode(video){
    if(!audioContextSupported) return null;
    if(!video) return null;

    attachVideoListeners(video);

    // 🚫 tránh spam create
    if(processedVideos.has(video)){
        return audioContexts.get(video) || null;
    }

    // 🚫 video chưa sẵn sàng
    if(video.readyState < 2){
        console.log("Video not ready");
        return null;
    }

    // 🚫 không có src
    if(!video.src && !video.currentSrc){
        return null;
    }

    // 🔁 nếu đã có context thì reuse
    if(audioContexts.has(video)){
        const data = audioContexts.get(video);
        if(data.ctx.state === 'suspended'){
            data.ctx.resume().catch(()=>{});
        }
        return data;
    }

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();

        let source;
        try {
            source = audioCtx.createMediaElementSource(video);
        } catch(err){
            // 🔥 PLAYER OWNED AUDIO (YouTube kiểu này)
            console.log("Video already has AudioContext → fallback volume");
            audioCtx.close().catch(()=>{});
            return null;
        }

        const gainNode = audioCtx.createGain();

        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const data = {
            ctx: audioCtx,
            gain: gainNode
        };

        audioContexts.set(video, data);
        processedVideos.add(video);

        if(audioCtx.state === 'suspended'){
            audioCtx.resume().catch(()=>{});
        }

        // 🔥 tránh bị mute ngầm
        if(video.muted){
            video.muted = false;
        }

        console.log("Audio boost READY");
        return data;

    } catch(e){
        console.warn("Audio boost fail:", e.message);
        return null;
    }
}

// Smooth gain
function smoothGainTransition(gainNode, target, duration = 0.1){
    if(!gainNode) return;
    try {
        const now = gainNode.context.currentTime;
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(target, now + duration);
    } catch(e){}
}

// Public API
function applyVolume(video){
    const v = video || document.querySelector("video");
    if(!v) return;

    applyVolumeToVideo(clamp(settings.volume, 0, 5), v);
}

function applySpeed(video){
    const v = video || document.querySelector("video");
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
        console.log("Force looping video...");

        isLooping = true;

        // Seek về đầu
        if (typeof v.fastSeek === "function") {
            v.fastSeek(0);
        } else {
            v.currentTime = 0;
        }

        // 💡 ĐỢI seek xong rồi mới play
        v.addEventListener("seeked", () => {
            v.play().catch(() => {});
            isLooping = false;
        }, { once: true });
    }
}

// ===== PANEL =====
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
#vcp-panel{
    position:fixed;
    bottom:20px;
    right:20px;
    padding:8px 12px;
    background:${settings.color};
    border-radius:20px;
    z-index:9999;
    font-family:Tahoma,Arial;
    box-shadow:0 4px 15px rgba(0,0,0,0.3);
}
#vcp-header{display:flex;align-items:center;gap:8px;}
#vcp-slider{
    width:100px;
    height:6px;
    -webkit-appearance:none;
    appearance:none;
    background:rgba(255,255,255,0.3);
    border-radius:3px;
    cursor:pointer;
}
#vcp-slider::-webkit-slider-thumb{
    -webkit-appearance:none;
    appearance:none;
    width:16px;
    height:16px;
    background:white;
    border-radius:50%;
    cursor:pointer;
    box-shadow:0 2px 4px rgba(0,0,0,0.3);
}
#vcp-slider::-moz-range-thumb{
    width:16px;
    height:16px;
    background:white;
    border-radius:50%;
    cursor:pointer;
    border:none;
}
#vcp-vol{
    width:50px;
    padding:4px;
    border:none;
    border-radius:8px;
    text-align:center;
    font-size:14px;
    background:rgba(255,255,255,0.2);
    color:white;
}
#vcp-vol.booster{
    border:2px solid #ff9800;
    background:linear-gradient(90deg,#fff3e0,#ffe0b2);
    color:#333;
    font-weight:bold;
}
#vcp-speed{display:flex;gap:4px;}
.vcp-speed-btn{
    padding:4px 8px;
    border:none;
    border-radius:8px;
    background:rgba(255,255,255,0.2);
    color:white;
    font-size:12px;
    cursor:pointer;
    transition:background 0.2s;
}
.vcp-speed-btn:hover{background:rgba(255,255,255,0.4);}
.vcp-speed-btn.active{
    background:#ff9800;
    color:white;
    font-weight:bold;
}
#vcp-close{
    background:transparent;
    border:none;
    color:white;
    font-size:18px;
    cursor:pointer;
    padding:0 4px;
}
#vcp-close:hover{opacity:0.7;}
#vcp-loop-label{
    display:flex;
    align-items:center;
    cursor:pointer;
    padding:0 4px;
}
#vcp-loop-label input{
    display:none;
}
#vcp-loop-label span{
    font-size:16px;
    opacity:0.6;
    transition:opacity 0.2s;
}
#vcp-loop-label input:checked + span{
    opacity:1;
    color:#ff9800;
}
#vcp-loop-label:hover span{opacity:0.8;}
@keyframes slideIn{
    from{opacity:0;transform:translateX(100px);}
    to{opacity:1;transform:translateX(0);}
}
`);

// ===== INIT =====
function init(){
    if(!document.body){
        requestAnimationFrame(init);
        return;
    }

    document.body.appendChild(panel);
    
    // Start hidden - let detectVideo() determine visibility
    // This prevents panel showing before video is detected
    panel.style.display = "none";
    
    initDetection();
    
    console.log("Video Control Panel LITE v" + CURRENT_VERSION + " initialized");
}

// ===== AUTO SHOW/HIDE =====
function detectVideo(){
    const v = getVideo();
    const videoSrc = v ? (v.src || v.currentSrc || '') : '';
    const lastSrc = lastVideo ? (lastVideo.src || lastVideo.currentSrc || '') : '';

    // Re-hook video liên tục
    if(v && v !== window._lastVideo){
        window._lastVideo = v;
        attachAudioBoost(v);
    }

    // Detect new video or src change (e.g., after skip ad)
    if(v !== lastVideo || videoSrc !== lastSrc){
        // Cleanup previous video audio context
        // ── Race condition guard ────────────────────────────────────────────
        // detectVideo() may be called re-entrantly (two rapid mutations fire
        // before the first call finishes).  Both calls reach this block with
        // the same lastVideo reference.  The second call sees lastVideo === null
        // (already cleared by the first), so the outer if() is skipped.
        // Meanwhile onVideoEnded may have already fired (once:true removed the
        // listener) before we get here — removeEventListener is always safe as a
        // no-op on an absent listener, so no try/catch needed.
        if(lastVideo){
            cleanupAudioContext(lastVideo);
            lastVideo.removeEventListener('ended', onVideoEnded);
            lastVideo = null; // cleared BEFORE reassigning below; prevents any re-entrant detectVideo() from double-cleaning
        }
        
        lastVideo = v;
        
        if(v){
            // FIX: Use { once: true } so listener is auto-removed after execution,
            // preventing N listeners piling up across src mutations on the same element
            v.addEventListener('ended', onVideoEnded, { once: true });
            
            if(settings.autoVideo){
                isPanelVisible = true;
                panel.style.display = "block";
            }
            
            // Apply settings to new video (including after ad skip)
            applyVolume(v);                              // ← pass v — no extra DOM scan
            applySpeed(v);                               // ← pass v — no extra DOM scan
        } else if(settings.autoVideo){
            isPanelVisible = false;
            panel.style.display = "none";
        }
    }
}

function onVideoEnded(){
    // Handle video ended if needed
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

    document.addEventListener("play", e => {
        if(e.target.tagName === "VIDEO") detectVideo();
    }, true);

    document.addEventListener("playing", e => {
        if(e.target.tagName === "VIDEO") detectVideo();
    }, true);

    document.addEventListener("loadstart", e => {
        if(e.target.tagName === "VIDEO") detectVideo();
    }, true);

    document.addEventListener("durationchange", e => {
        if(e.target.tagName === "VIDEO") detectVideo();
    }, true);

    // ===== CÁCH 2: MutationObserver cho YouTube Shorts =====
    try {
        if(observer) observer.disconnect();
        observer = new MutationObserver(() => {
            const video = document.querySelector("video");
            if(video && video !== window._lastVideo){
                window._lastVideo = video;
                attachAudioBoost(video);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } catch(e) {
        console.warn("MutationObserver not available:", e);
    }

    // ===== CÁCH 1: Re-hook video liên tục =====
    setInterval(() => {
        const video = document.querySelector("video");
        if(video && video !== window._lastVideo){
            window._lastVideo = video;
            attachAudioBoost(video);
        }
    }, 1000);
}

// ===== VOLUME INPUT =====
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
    
    // Delegate actual video/gain application to the single source of truth
    applyVolumeToVideo(val);
}

// Volume input - change saves to settings, input is live preview
volInput.addEventListener("change", () => {
    setVolume(volInput.value);
});

volInput.addEventListener("input", () => {
    const val = clamp(parseFloat(volInput.value) || 0, 0, 5);
    updateVolUI(val);
    applyVolumeToVideo(val);
});

// Volume slider - input is live preview, change saves to settings
volSlider.addEventListener("input", () => {
    const val = clamp(parseFloat(volSlider.value) || 0, 0, 5);
    updateVolUI(val);
    applyVolumeToVideo(val);
});

volSlider.addEventListener("change", () => {
    setVolume(volSlider.value, true);
});

// Unified function: accepts an optional video reference so callers in detectVideo()
// can pass the freshly-retrieved object directly, avoiding a redundant DOM scan
// that can return a stale element in SPAs (YouTube, Twitter/X, TikTok).
function applyVolumeToVideo(val, optVideo){
    // optVideo: optional — if provided, use it directly; otherwise fall back to DOM scan
    // (avoids stale element lookups during SPA navigation hot-paths)
    const v = optVideo || getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    if(val <= 1){
        v.volume = val;
        if(audioData && audioData.gain) smoothGainTransition(audioData.gain, 1);
    } else {
        v.volume = 1;
        // If audioData is null, the gain pipeline couldn't be set up (cross-origin
        // video, player already owns the AudioContext, etc.).  Keep native volume = 1;
        // the slider will show the higher value but the actual audio won't go above 1.
        if(audioData && audioData.gain){
            smoothGainTransition(audioData.gain, val);
        } else {
            // Show a gentle one-time warning so the user knows why boost isn't active
            showBoosterUnavailableWarning();
        }
    }
}

function showBoosterUnavailableWarning(){
    // Avoid flooding the console / screen — warn at most once per page visit
    if(showBoosterUnavailableWarning._shown) return;
    showBoosterUnavailableWarning._shown = true;
    console.warn(
        "⚠ Audio boost unavailable for this video.\n" +
        "   Cause: cross-origin video, protective CORS, or the page's own player\n" +
        "   already owns the AudioContext. Audio volume will be capped at 1×.\n" +
        "   Try lowering the volume slider below 1 for native volume control."
    );
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

function updateLoopState() {
    if(loopCheck) loopCheck.checked = settings.autoLoop;
}

function toggleLoop() {
    if(loopCheck) {
        settings.autoLoop = loopCheck.checked;
    } else {
        settings.autoLoop = !settings.autoLoop;
    }
    GM_setValue("settings", settings);
    
    if(settings.autoLoop){
        // Clear any stale interval first — prevents duplicate timers after toggle/re-init
        if(loopInterval){
            clearInterval(loopInterval);
            loopInterval = null;
        }
        loopInterval = setInterval(forceLoop, 500);
    } else if(!settings.autoLoop && loopInterval){
        clearInterval(loopInterval);
        loopInterval = null;
    }
}

if(loopCheck){
    updateLoopState();
    loopCheck.addEventListener("change", toggleLoop);
    
    // Use toggleLoop() instead of creating a raw interval directly —
    // toggleLoop() always clears any existing interval first, so there is
    // no risk of ending up with two concurrent forceLoop() timers.
    if(settings.autoLoop){
        toggleLoop();              // ← goes through the single, guarded path
    }
}

// ===== TOGGLE HOTKEY =====
document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    
    // Escape always hides panel
    if(e.key === "Escape" && isPanelVisible){
        isPanelVisible = false;
        panel.style.display = "none";
        return;
    }
    
    // Ignore other keys if typing in input
    if(tag === "INPUT" || tag === "TEXTAREA"){
        return;
    }
    
    const isModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
    
    // Toggle panel with hotkey (exact match for single char, code for special keys)
    let hotkeyMatch = false;
    if(HOTKEY.length === 1){
        hotkeyMatch = e.key === HOTKEY;
    } else {
        hotkeyMatch = e.code === HOTKEY.toUpperCase();
    }
    
    if(hotkeyMatch && !isModifier){
        e.preventDefault();
        
        const v = getVideo();
        if(settings.autoVideo && !v){
            isPanelVisible = false;
            panel.style.display = "none";
            return;
        }
        
        isPanelVisible = !isPanelVisible;
        panel.style.display = isPanelVisible ? "block" : "none";
        
        if(isPanelVisible){
            volInput.focus();
            volInput.select();
        }
    }
});

// ===== AUTO UPDATE CHECK =====

function checkForUpdates(){
    const now = Date.now();
    
    // Check interval
    if(now - settings.lastUpdateCheck < UPDATE_INTERVAL){
        return;
    }
    
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
            onerror: function() {
                settings.lastUpdateCheck = now;
            }
        });
    } catch(e) {
        console.warn("Update check not available:", e);
    }
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
            <button onclick="location.reload()" 
                    style="margin-left:10px; padding:5px 15px; background:white; color:#4CAF50; 
                           border:none; border-radius:4px; cursor:pointer;">
                Reload
            </button>
            <button onclick="this.parentElement.remove()" 
                    style="margin-left:5px; padding:5px 15px; background:transparent; color:white; 
                           border:1px solid white; border-radius:4px; cursor:pointer;">
                Later
            </button>
        </div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if(notification.parentElement){
            notification.remove();
        }
    }, 10000);
}

// ===== CLEANUP =====
window.addEventListener("pagehide", () => {
    if(observer) observer.disconnect();
    if(lastVideo) cleanupAudioContext(lastVideo);
    if(loopInterval) clearInterval(loopInterval);
});

// ===== START =====
init();

// Check for updates after delay
setTimeout(checkForUpdates, 5000);

// Check for conflicts with PRO
setTimeout(checkConflict, 2000);

})();
