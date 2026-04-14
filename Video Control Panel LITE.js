// ==UserScript==
// @name         Video Control Panel LITE
// @namespace    http://tampermonkey.net/
// @version      1.3.35
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @description  Panel điều khiển âm thanh video - nhẹ và mượt (v1.3.3 - Fixed)
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
    hotkey: "V",
    lastUpdateCheck: 0
});

// ===== STATE =====
let lastVideo = null;
let observer = null;
let isPanelVisible = false;
let audioContextSupported = true;
const audioContexts = new WeakMap();

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
function cleanupAudioContext(video){
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        try {
            if(audioData.ctx && audioData.ctx.state !== 'closed'){
                audioData.ctx.close().catch(() => {});
            }
        } catch(e) {
            console.warn("Error closing AudioContext:", e);
        }
        audioContexts.delete(video);
        console.log("Audio context cleaned up for video");
    }
}

function getOrCreateGainNode(video){
    if(!audioContextSupported) return null;
    
    // Check if video has-src (CORS requirement)
    if(!video.src && !video.currentSrc){
        console.log("Video has no src, audio boost unavailable");
        return null;
    }
    
    // Check same-origin
    try {
        const testLink = document.createElement('a');
        testLink.href = video.src || video.currentSrc;
        const isSameOrigin = testLink.origin === window.location.origin;
        
        if(!isSameOrigin && !video.getAttribute('crossOrigin')){
            // Try to detect if CORS is allowed
            if(video.readyState >= 1){
                // May work with crossOrigin attribute
                console.log("Cross-origin video detected, trying audio boost");
            } else {
                console.log("Cross-origin video without CORS, audio boost disabled");
                return null;
            }
        }
    } catch(e) {
        // Can't determine origin, try anyway
    }
    
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        if(audioData.ctx.state === 'suspended'){
            audioData.ctx.resume().catch(() => {});
        }
        return audioData;
    }
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Check if we can createMediaElementSource
        let source;
        try {
            source = audioCtx.createMediaElementSource(video);
        } catch(sourceError){
            // This video's media pipeline is already connected
            // Try to find existing gain node workaround
            console.log("MediaElementSource already connected:", sourceError.message);
            
            // Check if we can work without reconnecting
            if(audioCtx.state === 'suspended'){
                audioCtx.resume().catch(() => {});
            }
            
            // Use Web Audio API to connect to destination anyway
            const data = { ctx: audioCtx, gain: audioCtx.createGain(), sourceConnected: false };
            audioContexts.set(video, data);
            return data;
        }
        
        const gainNode = audioCtx.createGain();
        
        // Check if already connected
        try {
            source.connect(gainNode);
            gainNode.connect(audioCtx.destination);
        } catch(connectError){
            console.warn("Audio connection failed:", connectError.message);
            return null;
        }
        
        const data = { ctx: audioCtx, gain: gainNode, sourceConnected: true };
        audioContexts.set(video, data);
        
        if(audioCtx.state === 'suspended'){
            audioCtx.resume().catch(() => {});
        }
        
        console.log("Audio boost initialized for video");
        return data;
    } catch(e) {
        console.warn("Audio boost not available:", e.message);
        audioContextSupported = false;
        return null;
    }
}

function smoothGainTransition(gainNode, targetValue, duration = 0.1){
    if(!gainNode) return;
    try {
        const currentTime = gainNode.context.currentTime;
        gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
        gainNode.gain.linearRampToValueAtTime(targetValue, currentTime + duration);
    } catch(e) {
        // Gain node may be invalid
    }
}

function applyVolume(){
    const v = getVideo();
    if(!v) return;

    const vol = clamp(settings.volume, 0, 5);
    const audioData = getOrCreateGainNode(v);
    
    if(vol <= 1){
        v.volume = vol;
        if(audioData && audioData.gain) smoothGainTransition(audioData.gain, 1);
    } else {
        v.volume = 1;
        if(audioData && audioData.gain) smoothGainTransition(audioData.gain, vol);
    }
}

function applySpeed(){
    const v = getVideo();
    if(!v) return;
    v.playbackRate = clamp(settings.speed, 0.1, 16);
}

// ===== FORCE LOOP =====
function forceLoop() {
    if (!settings.autoLoop) return;

    const v = getVideo();
    if (!v) return;

    if (v.ended || (v.currentTime >= v.duration - 0.5 && v.duration > 0)) {
        console.log("Force looping video...");
        v.currentTime = 0;
        v.play().catch(e => console.warn("Play failed:", e));
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
        <button id="vcp-loop" title="Loop">🔁</button>
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
#vcp-loop{
    background:transparent;
    border:none;
    color:white;
    font-size:16px;
    cursor:pointer;
    padding:0 4px;
}
#vcp-loop.active{
    color:#ff9800;
}
#vcp-loop:hover{opacity:0.7;}
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
    
    console.log("Video Control Panel LITE v1.3.3 initialized");
}

// ===== AUTO SHOW/HIDE =====
function detectVideo(){
    const v = getVideo();
    if(v !== lastVideo){
        // Cleanup previous video audio context
        if(lastVideo){
            cleanupAudioContext(lastVideo);
            lastVideo.removeEventListener('ended', onVideoEnded);
        }
        
        lastVideo = v;
        
        if(v){
            v.addEventListener('ended', onVideoEnded);
            
            if(settings.autoVideo){
                isPanelVisible = true;
                panel.style.display = "block";
            }
            
            // Apply settings to new video
            applyVolume();
            applySpeed();
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

    // Initialize MutationObserver safely
    try {
        if(observer) observer.disconnect();
        observer = new MutationObserver(mutations => {
            for(const mut of mutations){
                if(mut.addedNodes.length > 0){
                    for(const node of mut.addedNodes){
                        if(node.nodeName === "VIDEO" || 
                           (node.querySelector && node.querySelector("video"))){
                            detectVideo();
                            return;
                        }
                    }
                }
            }
        });
        observer.observe(document.body, {childList: true, subtree: true});
    } catch(e) {
        console.warn("MutationObserver not available:", e);
    }
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
    const v = getVideo();
    val = clamp(parseFloat(val) || 0, 0, 5);
    
    if(save){
        settings.volume = val;
        GM_setValue("settings", settings);
    }
    
    updateVolUI(val);
    
    if(v){
        const audioData = getOrCreateGainNode(v);
        if(val <= 1){
            v.volume = val;
            if(audioData && audioData.gain) smoothGainTransition(audioData.gain, 1);
        } else {
            v.volume = 1;
            if(audioData && audioData.gain) smoothGainTransition(audioData.gain, val);
        }
    }
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

// Unified function to apply volume to video
function applyVolumeToVideo(val){
    const v = getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    if(val <= 1){
        v.volume = val;
        if(audioData && audioData.gain) smoothGainTransition(audioData.gain, 1);
    } else {
        v.volume = 1;
        if(audioData && audioData.gain) smoothGainTransition(audioData.gain, val);
    }
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
const loopBtn = panel.querySelector("#vcp-loop");
let loopInterval = null;

function updateLoopBtn() {
    loopBtn.classList.toggle("active", settings.autoLoop);
}

function toggleLoop() {
    settings.autoLoop = !settings.autoLoop;
    GM_setValue("settings", settings);
    updateLoopBtn();
    
    if(settings.autoLoop && !loopInterval){
        loopInterval = setInterval(forceLoop, 500);
    } else if(!settings.autoLoop && loopInterval){
        clearInterval(loopInterval);
        loopInterval = null;
    }
}

if(loopBtn){
    updateLoopBtn();
    loopBtn.addEventListener("click", toggleLoop);
    
    if(settings.autoLoop){
        loopInterval = setInterval(forceLoop, 500);
    }
}

// ===== TOGGLE HOTKEY =====
const HOTKEY = settings.hotkey && settings.hotkey.trim() ? settings.hotkey.trim() : "V";

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
    
    const key = e.key.toUpperCase();
    const isModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
    
    // Toggle panel with hotkey (no modifiers)
    if(key === HOTKEY.toUpperCase() && !isModifier){
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
const CURRENT_VERSION = "1.3.3";
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function checkForUpdates(){
    const now = Date.now();
    
    // Check interval
    if(now - settings.lastUpdateCheck < UPDATE_INTERVAL){
        return;
    }
    
    try {
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20LITE.js",
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
window.addEventListener("unload", () => {
    if(observer) observer.disconnect();
    if(lastVideo) cleanupAudioContext(lastVideo);
});

// ===== START =====
init();

// Check for updates after delay
setTimeout(checkForUpdates, 5000);

// Check for conflicts with PRO
setTimeout(checkConflict, 2000);

})();
