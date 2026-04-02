// ==UserScript==
// @name         Video Control Panel LITE
// @namespace    http://tampermonkey.net/
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/main/Video%20Control%20Panel%20LITE.js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/main/Video%20Control%20Panel%20LITE.js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @description  Panel điều khiển âm thanh video - nhẹ và mượt(check test nữa)
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS =====
const settings = GM_getValue("settings", {
    volume: 1,
    color: "#2b5797",
    autoVideo: true,
    hotkey: "*"
});

// ===== STATE =====
let lastVideo = null;
let observer = null;
const audioContexts = new WeakMap();

// ===== HELPERS =====
function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
}

function getVideo(){
    try {
        const videos = document.querySelectorAll("video");
        for (const v of videos) {
            if (v.offsetParent !== null && v.duration > 0) return v;
        }
        for (const v of videos) {
            if (v.offsetParent !== null) return v;
        }
    } catch (e) {}
    return null;
}

// ===== AUDIO BOOST =====
// FIX: Cleanup audio context khi video bị remove
function cleanupAudioContext(video){
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        try {
            if(audioData.ctx && audioData.ctx.state !== 'closed'){
                audioData.ctx.close();
            }
        } catch(e) {
            console.warn("Error closing AudioContext:", e);
        }
        audioContexts.delete(video);
        console.log("Audio context cleaned up for video");
    }
}

function getOrCreateGainNode(video){
    if(audioContexts.has(video)){
        const audioData = audioContexts.get(video);
        // FIX: Resume AudioContext nếu bị suspended
        if(audioData.ctx.state === 'suspended'){
            audioData.ctx.resume().catch(e => {
                console.warn("Failed to resume AudioContext:", e);
            });
        }
        return audioData;
    }
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(video);
        const gainNode = audioCtx.createGain();
        
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const data = { ctx: audioCtx, gain: gainNode };
        audioContexts.set(video, data);
        
        // FIX: Resume AudioContext ngay sau khi tạo
        if(audioCtx.state === 'suspended'){
            audioCtx.resume().catch(e => {
                console.warn("Failed to resume AudioContext:", e);
            });
        }
        
        console.log("Audio boost initialized for video");
        return data;
    } catch(e) {
        console.warn("Audio boost not available:", e);
        return null;
    }
}

// FIX: Thêm function để smooth gain transition
function smoothGainTransition(gainNode, targetValue, duration = 0.1){
    if(!gainNode) return;
    const currentTime = gainNode.context.currentTime;
    gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
    gainNode.gain.linearRampToValueAtTime(targetValue, currentTime + duration);
}

function applyVolume(){
    const v = getVideo();
    if(!v) return;

    const vol = clamp(settings.volume, 0, 5);
    const audioData = getOrCreateGainNode(v);
    
    if(vol <= 1){
        v.volume = vol;
        if(audioData) smoothGainTransition(audioData.gain, 1);
    } else {
        v.volume = 1;
        if(audioData) smoothGainTransition(audioData.gain, vol);
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
        <button id="vcp-close">×</button>
    </div>
`;

document.body.appendChild(panel);

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
    display:${settings.autoVideo ? "none" : "block"};
    transition:opacity 0.2s;
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
    box-shadow:0 2px 4px rgba(0,0,0,0.3);
}
#vcp-vol{
    width:50px;
    padding:4px;
    border:none;
    border-radius:8px;
    text-align:center;
    font-size:14px;
}
#vcp-vol.booster{
    border:2px solid #ff9800;
    background:linear-gradient(90deg,#fff3e0,#ffe0b2);
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
`);

// ===== AUTO SHOW/HIDE =====
function detectVideo(){
    const v = getVideo();
    if(v !== lastVideo){
        lastVideo = v;
        if(settings.autoVideo){
            panel.style.display = v ? "block" : "none";
            applyVolume();
        }
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
    
    document.addEventListener("play", e => {
        if(e.target.tagName === "VIDEO") detectVideo();
    }, true);
    
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
}

// ===== VOLUME INPUT =====
const volInput = panel.querySelector("#vcp-vol");
const volSlider = panel.querySelector("#vcp-slider");
const volClose = panel.querySelector("#vcp-close");

volInput.addEventListener("change", () => {
    settings.volume = clamp(parseFloat(volInput.value) || 0, 0, 5);
    GM_setValue("settings", settings);
    applyVolume();
    volSlider.value = settings.volume;
});

volSlider.addEventListener("input", () => {
    const val = clamp(parseFloat(volSlider.value) || 0, 0, 5);
    volInput.value = val;
    volInput.classList.toggle("booster", val > 1);
    
    const v = getVideo();
    if(v){
        const audioData = getOrCreateGainNode(v);
        if(val <= 1){
            v.volume = val;
            if(audioData) smoothGainTransition(audioData.gain, 1);
        } else {
            v.volume = 1;
            if(audioData) smoothGainTransition(audioData.gain, val);
        }
    }
});

volSlider.addEventListener("change", () => {
    settings.volume = clamp(parseFloat(volSlider.value) || 0, 0, 5);
    GM_setValue("settings", settings);
});

volInput.addEventListener("input", () => {
    const val = clamp(parseFloat(volInput.value) || 0, 0, 5);
    volInput.classList.toggle("booster", val > 1);
    volSlider.value = val;
    
    const v = getVideo();
    if(v){
        const audioData = getOrCreateGainNode(v);
        if(val <= 1){
            v.volume = val;
            if(audioData) smoothGainTransition(audioData.gain, 1);
        } else {
            v.volume = 1;
            if(audioData) smoothGainTransition(audioData.gain, val);
        }
    }
});

// ===== CLOSE BUTTON =====
volClose.addEventListener("click", () => {
    panel.style.display = "none";
});

// ===== TOGGLE HOTKEY =====
document.addEventListener("keydown", e => {
    // Toggle khi nhấn * (phím số 8 trên numpad hoặc Shift+8)
    if(e.key === "*" || (e.shiftKey && e.key === "8")){
        const v = getVideo();
        if(settings.autoVideo && !v){
            panel.style.display = "none";
            return;
        }
        panel.style.display = panel.style.display === "none" ? "block" : "none";
        if(panel.style.display === "block"){
            volInput.focus();
            volInput.select();
        }
    }
});

// ===== AUTO UPDATE CHECK =====
function checkForUpdates() {
    const currentVersion = GM_info.script.version;
    
    try {
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/main/Video%20Control%20Panel%20LITE.js",
            onload: function(response) {
                if(response.status === 200){
                    const match = response.responseText.match(/@version\s+([\d.]+)/);
                    if (match && match[1] !== currentVersion) {
                        showUpdateNotification(match[1]);
                    }
                }
            },
            onerror: function(error) {
                console.warn("Update check failed:", error);
            }
        });
    } catch(e) {
        console.warn("Update check not available:", e);
    }
}

function showUpdateNotification(newVersion) {
    const notification = document.createElement("div");
    notification.innerHTML = `
        <div style="position:fixed; top:20px; right:20px; background:#4CAF50; color:white; 
                    padding:15px; border-radius:8px; z-index:10000; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
            <strong>🔔 Có bản cập nhật v${newVersion}!</strong><br>
            <button onclick="location.reload()" 
                    style="margin-top:8px; padding:5px 15px; background:white; color:#4CAF50; 
                           border:none; border-radius:4px; cursor:pointer;">
                Tải lại trang để cập nhật
            </button>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="margin-top:8px; padding:5px 15px; background:transparent; color:white; 
                           border:1px solid white; border-radius:4px; cursor:pointer; margin-left:5px;">
                Để sau
            </button>
        </div>
    `;
    document.body.appendChild(notification);
    
    // FIX: Tự động remove sau 10 giây
    setTimeout(() => {
        if(notification.parentElement){
            notification.remove();
        }
    }, 10000);
}

// Kiểm tra cập nhật sau 3 giây khởi động
setTimeout(checkForUpdates, 3000);

// ===== START =====
initDetection();

})();
