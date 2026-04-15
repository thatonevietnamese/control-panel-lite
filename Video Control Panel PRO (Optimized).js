// ==UserScript==
// @name         Video Control Panel PRO (Optimized)
// @namespace    http://tampermonkey.net/
// @version      17.1
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @description  Auto skip ads + Video info + Custom UI + size/position controls + settings UI v2 (v17.1)
// ==/UserScript==

(function () {
'use strict';

// ===== SETTINGS =====
const settings = GM_getValue("settings", {
    speed: 1,
    volume: 1,
    color: "#2b5797",
    wallpaper: "",
    autoShow: true,
    autoVideo: true,
    autoResume: true,
    autoLoop: true,
    autoSkipAd: true,
    showVideoInfo: true,
    hotkey: "*",
    posX: 60,
    posY: 60,
    panelWidth: 260,
    panelHeight: 200,
    hotkeys: {},
    theme: "auto",
    opacity: 1.0,
    lastUpdateCheck: 0,
    updateAvailable: false,
    updateCheckInterval: 24,
    autoShowNotification: true,
    notificationDuration: 10,
    customUI: false,
    removeShorts: false,
    removeSidebar: false,
    autoFill: false
});

// ===== UPDATE CHECKING =====
const CURRENT_VERSION = "17.1";
const UPDATE_URL = "https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js";

function checkForUpdates(){
    const now = Date.now();
    const intervalMs = (settings.updateCheckInterval || 24) * 60 * 60 * 1000;
    if(now - settings.lastUpdateCheck < intervalMs){
        return;
    }
    
    try {
        GM_xmlhttpRequest({
            method: "GET",
            url: UPDATE_URL,
            onload: function(response) {
                if(response.status === 200){
                    const match = response.responseText.match(/@version\s+([\d.]+)/);
                    if(match && match[1]){
                        const remoteVersion = match[1];
                        if(remoteVersion !== CURRENT_VERSION){
                            settings.updateAvailable = true;
                            console.log("Update available:", remoteVersion);
                            showUpdateNotification(remoteVersion);
                        } else {
                            settings.updateAvailable = false;
                        }
                        settings.lastUpdateCheck = now;
                        GM_setValue("settings", settings);
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

function showUpdateNotification(newVersion){
    if(!settings.autoShowNotification){
        console.log("Update available:", newVersion, "(notification disabled)");
        return;
    }
    
    if(document.getElementById("update-notification")) return;
    
    const notification = document.createElement("div");
    notification.id = "update-notification";
    notification.innerHTML = `
        <div style="position:fixed; bottom:20px; right:20px; background:#4CAF50; color:white; padding:12px 20px; border-radius:8px; z-index:10001; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-family:Tahoma; font-size:12px; animation:slideIn 0.3s ease;">
            🆕 Update available: v${newVersion}
            <button onclick="window.open('${UPDATE_URL}', '_blank'); this.parentElement.remove();" style="margin-left:10px; background:white; color:#4CAF50; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Update</button>
            <button onclick="this.parentElement.remove();" style="margin-left:5px; background:transparent; color:white; border:1px solid white; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Later</button>
        </div>
    `;
    document.body.appendChild(notification);
    
    const duration = settings.notificationDuration || 10;
    if(duration > 0){
        setTimeout(() => {
            if(notification.parentElement){
                notification.remove();
            }
        }, duration * 1000);
    }
}

// ===== CONFLICT CHECK =====
function checkConflict() {
    const proPanel = document.getElementById("panel");
    const litePanel = document.getElementById("vcp-panel");
    
    if (proPanel && litePanel) {
        showConflictNotification();
    }
}

function showConflictNotification() {
    if (document.getElementById("conflict-notification")) return;
    
    const notification = document.createElement("div");
    notification.id = "conflict-notification";
    notification.innerHTML = `
        <div style="position:fixed; top:20px; right:20px; background:#f44336; color:white; padding:12px 20px; border-radius:8px; z-index:10002; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-family:Tahoma; font-size:12px; animation:slideIn 0.3s ease;">
            ⚠️ Conflict! PRO and LITE both running. Please disable one.
            <button onclick="this.parentElement.remove();" style="margin-left:10px; background:white; color:#f44336; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">OK</button>
        </div>
    `;
    document.body.appendChild(notification);
    console.warn("Conflict detected: Both PRO and LITE versions are running!");
}

// ===== STATE =====
let capturingKey = null;
let isDragging = false;
let isLocked = false;
let offsetX = 0, offsetY = 0;
let lastMouseX = 100, lastMouseY = 100;
let lastVideo = null;
let lastApplied = {};
let raf = null;
let observer = null;
let isApplying = false;
let videoInfoInterval = null;
let audioContextSupported = true;

window.autoResumeEnabled = () => settings.autoResume;

// ===== AUDIO BOOST =====
const audioContexts = new WeakMap();

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
    
    if(!video.src && !video.currentSrc){
        return null;
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
        let source;
        
        try {
            source = audioCtx.createMediaElementSource(video);
        } catch(sourceError){
            console.log("MediaElementSource already connected:", sourceError.message);
            if(audioCtx.state === 'suspended'){
                audioCtx.resume().catch(() => {});
            }
            const data = { ctx: audioCtx, gain: audioCtx.createGain(), sourceConnected: false };
            audioContexts.set(video, data);
            return data;
        }
        
        const gainNode = audioCtx.createGain();
        
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
    } catch(e) {}
}

// ===== HELPERS =====
function normalizeKey(key){
    if(!key) return "";
    // Keep special characters like *, +, - as-is, only remove spaces
    return key.replace(/\s+/g, '').toUpperCase();
}

function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
}

function getVideo(){
    try {
        const videos = document.querySelectorAll("video");
        for (const v of videos) {
            if (v.offsetParent !== null && !v.paused && v.duration > 0) {
                return v;
            }
        }
        for (const v of videos) {
            if (v.offsetParent !== null && v.duration > 0) {
                return v;
            }
        }
        for (const v of videos) {
            if (v.offsetParent !== null) {
                return v;
            }
        }
    } catch (e) {
        console.error("Error in getVideo:", e);
    }
    return null;
}

function isVideoVisible(video){
    if(!video) return false;
    const rect = video.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
    );
}

function applyVideo(){
    if(isApplying) return;
    isApplying = true;
    
    try {
        const v = getVideo();
        if(!v) {
            isApplying = false;
            return;
        }

        const speed = clamp(settings.speed, 0.1, 16);
        const volume = clamp(settings.volume, 0, 5);

        if(lastApplied.speed !== speed){
            requestAnimationFrame(() => {
                v.playbackRate = speed;
            });
            lastApplied.speed = speed;
            console.log("Speed applied:", speed);
        }

        if(lastApplied.volume !== volume){
            const audioData = getOrCreateGainNode(v);
            
            if(volume <= 1){
                requestAnimationFrame(() => {
                    v.volume = volume;
                });
                if(audioData && audioData.gain) {
                    smoothGainTransition(audioData.gain, 1);
                }
            } else {
                requestAnimationFrame(() => {
                    v.volume = 1;
                });
                if(audioData && audioData.gain) {
                    smoothGainTransition(audioData.gain, volume);
                } else {
                    console.warn("Audio boost not available, volume limited to 1x");
                }
            }
            
            lastApplied.volume = volume;
            console.log("Volume applied:", volume, "Audio boost:", volume > 1 ? "Yes" : "No");
        }
    } catch(e) {
        console.error("Error in applyVideo:", e);
    } finally {
        isApplying = false;
    }
}

function applyWallpaper(){
    let style = document.getElementById("yt-wallpaper");
    if(!style){
        style = document.createElement("style");
        style.id = "yt-wallpaper";
        document.head.appendChild(style);
    }

    if(!settings.wallpaper){
        style.innerHTML = "";
        return;
    }

    const escapedWallpaper = settings.wallpaper.replace(/"/g, '\\"').replace(/'/g, "\\'");
    style.innerHTML = `
        body, ytd-app {
            background: url("${escapedWallpaper}") no-repeat center center fixed !important;
            background-size: cover !important;
        }
    `;
    console.log("Wallpaper applied:", settings.wallpaper);
}

// ===== PANEL =====
const panel = document.createElement("div");
panel.id = "panel";

panel.innerHTML = `
<div id="header">
    <button id="tab1" data-tooltip="Tinh chỉnh">Tinh chỉnh</button>
    <button id="tab2" data-tooltip="Cài đặt">Cài đặt</button>
    <button id="themeToggle" data-tooltip="Đổi theme">🌓</button>
    <button id="min" data-tooltip="Thu nhỏ">_</button>
    <button id="max" data-tooltip="Phóng to">☐</button>
    <button id="close" data-tooltip="Thoát">✕</button>
    <button id="lock" data-tooltip="Khóa">🔓</button>
</div>

<div id="control">
    <div class="row">🔊 <input type="number" id="volume" step="0.1" min="0" max="5" data-tooltip="Âm lượng (0-5x)"></div>
    <div class="row">⚡ <input type="number" id="speed" step="0.1" min="0.1" max="16" data-tooltip="Tốc độ (0.1-16x)"></div>
    <div class="row"><button id="pauseToggle" data-tooltip="Dừng auto-resume">⏸ Auto</button></div>
</div>

<div id="settings" style="display:none">
    <div class="section">
        <span>🎮 Tính năng</span>
        <div class="settings-grid">
            <label><input type="checkbox" id="autoShow"> Auto hiện</label>
            <label><input type="checkbox" id="autoVideo"> Chỉ khi có video</label>
            <label><input type="checkbox" id="autoLoop"> 🔁 Loop</label>
            <label><input type="checkbox" id="autoResume"> ⏯️ Resume</label>
            <label><input type="checkbox" id="showVideoInfo"> 📺 Info</label>
            <label><input type="checkbox" id="autoSkipAd"> ⏭️ Skip Ad</label>
        </div>
    </div>

    <div class="section">
        <span>🎨 Giao diện</span>
        <div class="settings-grid">
            <label><input type="checkbox" id="customUI"> Custom UI</label>
            <label><input type="checkbox" id="removeShorts"> Ẩn Shorts</label>
            <label><input type="checkbox" id="removeSidebar"> Ẩn Sidebar</label>
            <label><input type="checkbox" id="autoNotify"> 📢 Update</label>
        </div>
    </div>

    <div class="section">
        <span>📏 Kích thước & Vị trí</span>
        <div class="size-pos-grid">
            <div class="row">Rộng: <input type="number" id="panelWidth" min="150" max="500" value="260" style="width:50px;"> px</div>
            <div class="row">Cao: <input type="number" id="panelHeight" min="80" max="800" value="200" style="width:50px;"> px</div>
            <label class="auto-fill"><input type="checkbox" id="autoFill"> Auto-fill</label>
        </div>
        <div class="row">X: <input type="number" id="posX" value="${settings.posX}" style="width:50px;">
            Y: <input type="number" id="posY" value="${settings.posY}" style="width:50px;"></div>
    </div>

    <hr>
    <div class="section">
        <span>🎛️ Hiệu ứng</span>
        <div class="row">Độ mờ: <input type="range" id="opacitySlider" min="0.3" max="1" step="0.1" value="${settings.opacity}"> <span id="opacityValue">${Math.round(settings.opacity*100)}%</span></div>
        <div class="row">Màu: <input type="color" id="color" value="${settings.color}"></div>
        <div class="row">Wallpaper: <input id="wall" type="text" placeholder="URL" value="${settings.wallpaper}"></div>
    </div>

    <hr>
    <div class="section">
        <span>🔄 Cập nhật</span>
        <div class="row">Check: <select id="updateInterval">
            <option value="1">1h</option>
            <option value="6">6h</option>
            <option value="12">12h</option>
            <option value="24">24h</option>
            <option value="48">48h</option>
        </select>
        Ẩn sau: <input type="number" id="notifyDuration" min="0" max="60" value="${settings.notificationDuration}" style="width:40px;">s</div>
    </div>

    <hr>
    <span>⌨️ Hotkey</span>
    <div id="hotkeys"></div>
</div>
<div id="resize-handle"></div>
`;

// ===== THEME FUNCTIONS =====
function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === "auto") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        html.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
        html.setAttribute("data-theme", theme);
    }
    console.log("Theme applied:", theme);
}

// ===== STYLE =====
GM_addStyle(`
:root {
    --panel-bg: ${settings.color};
    --panel-text: #ffffff;
    --panel-border: rgba(255,255,255,0.2);
    --input-bg: rgba(255,255,255,0.1);
    --input-border: rgba(255,255,255,0.3);
    --btn-bg: rgba(255,255,255,0.15);
    --btn-hover: rgba(255,255,255,0.25);
}

[data-theme="dark"] {
    --panel-bg: #1a1a1a;
    --panel-text: #e0e0e0;
    --panel-border: rgba(255,255,255,0.1);
    --input-bg: rgba(255,255,255,0.08);
    --input-border: rgba(255,255,255,0.2);
    --btn-bg: rgba(255,255,255,0.1);
    --btn-hover: rgba(255,255,255,0.2);
}

[data-theme="light"] {
    --panel-bg: #f0f0f0;
    --panel-text: #333333;
    --panel-border: rgba(0,0,0,0.1);
    --input-bg: rgba(0,0,0,0.05);
    --input-border: rgba(0,0,0,0.2);
    --btn-bg: rgba(0,0,0,0.08);
    --btn-hover: rgba(0,0,0,0.15);
}

#panel{
    position:fixed;
    top:${clamp(parseInt(settings.posY) || 60, 0, window.innerHeight - 120)}px;
    left:${clamp(parseInt(settings.posX) || 60, 0, window.innerWidth - 260)}px;
    width:${settings.panelWidth || 260}px;
    min-height:60px;
    padding:4px;
    margin:0;
    background:var(--panel-bg);
    color:var(--panel-text);
    border-radius:10px;
    z-index:9999;
    font-family:Tahoma;
    transition: opacity 0.2s ease, background 0.3s ease;
    opacity:${settings.opacity};
    overflow:auto;
}
#panel, #panel *{ user-select:none !important; }

#header{display:flex;gap:3px;cursor:move;align-items:center;margin-bottom:4px;padding:2px;}
#header button{padding:2px 6px;font-size:10px;}
#header button#min, #header button#max, #header button#close{padding:2px 5px;}
#control{padding:0;margin:0;}
#control .row{margin:2px 0;}
#settings{overflow-x:auto;overflow-y:auto;max-height:300px;max-width:100%;}
#settings::-webkit-scrollbar{width:5px;}
#settings::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);}
#settings::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:2px;}
#settings .section{margin-bottom:8px;}
#settings .section > span{display:block;font-size:11px;font-weight:bold;color:var(--panel-text);margin-bottom:4px;opacity:0.8;}
.size-pos-grid{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.size-pos-grid .auto-fill{display:flex;align-items:center;gap:4px;}

.row{display:flex;gap:5px;margin:4px 0;align-items:center;flex-wrap:wrap;}
.row input[type="number"]{width:50px;background:var(--input-bg);border:1px solid var(--input-border);color:var(--panel-text);}
.row input[type="text"]{flex:1;min-width:60px;background:var(--input-bg);border:1px solid var(--input-border);color:var(--panel-text);}
.row span{font-size:12px;}
button{
    font-size:11px;
    border:none;
    border-radius:6px;
    cursor:pointer;
    padding:4px 8px;
    background:var(--btn-bg);
    color:var(--panel-text);
    transition: background 0.2s ease;
}
button:hover{background:var(--btn-hover);}
button:active{transform:scale(0.9);}
#pauseToggle{width:100%;}
#pauseToggle.auto-disabled{background:#ff9800;color:#000;}
.keybtn{width:90px;}

#hotkeys div{
    display:flex;
    gap:4px;
    margin-bottom:3px;
    align-items:center;
}

.resetBtn{
    background:#ff4d4d;
    color:white;
}

input[type="number"],
input[type="text"]{
    padding:3px;
    border-radius:4px;
    border:1px solid var(--input-border);
    background:var(--input-bg);
    color:var(--panel-text);
}

#settings label{
    display:inline-flex;
    align-items:center;
    gap:4px;
    font-size:12px;
    color:var(--panel-text);
}
#settings hr{
    border:none;
    border-top:1px solid var(--panel-border);
    margin:10px 0;
}
#settings select{
    padding:3px;
    border-radius:4px;
    background:var(--input-bg);
    border:1px solid var(--input-border);
    color:var(--panel-text);
    font-size:11px;
}
#settings .settings-grid{
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap:6px;
}
#settings .settings-grid label{
    display:flex;
    align-items:center;
    gap:4px;
    font-size:11px;
    padding:4px 6px;
    background:var(--btn-bg);
    border-radius:4px;
    cursor:pointer;
    white-space:nowrap;
}
#settings .settings-grid label:hover{
    background:var(--btn-hover);
}

#volume.booster{
    border-color: #ff9800;
    background: linear-gradient(90deg, #fff3e0 0%, #ffe0b2 100%);
    font-weight: bold;
}

#themeToggle{
    width:28px;
    height:28px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:14px;
}

#opacitySlider{
    width:100px;
    height:4px;
    -webkit-appearance:none;
    background:var(--input-border);
    border-radius:2px;
    outline:none;
}
#opacitySlider::-webkit-slider-thumb{
    -webkit-appearance:none;
    width:14px;
    height:14px;
    background:var(--panel-text);
    border-radius:50%;
    cursor:pointer;
}

[data-tooltip]{position:relative;}
[data-tooltip]:hover::after{
    content:attr(data-tooltip);
    position:absolute;
    bottom:100%;
    left:50%;
    transform:translateX(-50%);
    background:rgba(0,0,0,0.8);
    color:white;
    padding:4px 8px;
    border-radius:4px;
    font-size:10px;
    white-space:nowrap;
    z-index:10000;
    margin-bottom:4px;
}

@keyframes fadeIn{
    from{opacity:0;transform:translateY(-10px);}
    to{opacity:1;transform:translateY(0);}
}
@keyframes fadeOut{
    from{opacity:1;transform:translateY(0);}
    to{opacity:0;transform:translateY(-10px);}
}
@keyframes slideIn{
    from{opacity:0;transform:translateX(100px);}
    to{opacity:1;transform:translateX(0);}
}
#panel{animation:fadeIn 0.3s ease;}

#panel::-webkit-scrollbar{width:6px;}
#panel::-webkit-scrollbar-track{background:rgba(255,255,255,0.1);}
#panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.3);border-radius:3px;}

#resize-handle{
    position:absolute;
    bottom:0;
    right:0;
    width:16px;
    height:16px;
    cursor:se-resize;
    background:linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%);
}
`);

// ===== VIDEO INFO DISPLAY =====
let videoInfoElement = null;

function getVideoInfo() {
    const v = getVideo();
    if (!v) return null;

    const videoId = getYouTubeVideoId();
    const title = getYouTubeTitle();
    const channel = getYouTubeChannel();

    return {
        title: title || "Unknown",
        channel: channel || "Unknown",
        videoId: videoId,
        duration: v.duration,
        currentTime: v.currentTime,
        playbackRate: v.playbackRate,
        volume: v.volume * (settings.volume > 1 ? settings.volume : 1),
        src: v.currentSrc ? v.currentSrc.substring(0, 100) : "N/A"
    };
}

function getYouTubeVideoId() {
    try {
        const url = window.location.href;
        const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

function getYouTubeTitle() {
    try {
        // Try meta og:title first (most reliable on YouTube)
        let titleEl = document.querySelector('meta[property="og:title"]');
        if(titleEl && titleEl.content) return titleEl.content.trim();
        
        // Watch page title
        titleEl = document.querySelector('h1.ytd-watch-metadata');
        if(titleEl) return titleEl.textContent.trim();
        
        // Video info section title
        titleEl = document.querySelector('#title');
        if(titleEl) return titleEl.textContent.trim();
        
        // Title from video title element
        titleEl = document.querySelector('ytd-video-title');
        if(titleEl) return titleEl.textContent.trim();
        
        // Any h1 on page
        titleEl = document.querySelector('h1');
        if(titleEl) return titleEl.textContent.trim();
        
        // Shorts specific
        titleEl = document.querySelector('h3.title');
        if(titleEl) return titleEl.textContent.trim();
        
        // Page title fallback
        return document.title.split(' - ')[0].trim();
    } catch (e) { return null; }
}

function getYouTubeChannel() {
    try {
        // Most reliable - owner name link
        let channelEl = document.querySelector('#owner-name a, #owner-name');
        if(channelEl && channelEl.textContent.trim()) return channelEl.textContent.trim();
        
        // Channel link
        channelEl = document.querySelector('#channel-name a, #channel-name');
        if(channelEl && channelEl.textContent.trim()) return channelEl.textContent.trim();
        
        // YTD channel name
        channelEl = document.querySelector('ytd-channel-name a');
        if(channelEl && channelEl.textContent.trim()) return channelEl.textContent.trim();
        
        // Video owner
        channelEl = document.querySelector('ytd-video-owner-renderer a');
        if(channelEl && channelEl.textContent.trim()) return channelEl.textContent.trim();
        
        // Find channel links anywhere
        const allLinks = document.querySelectorAll('a');
        for(const link of allLinks){
            const href = link.getAttribute('href') || '';
            if(href.includes('/channel/') || href.includes('/@')){
                if(link.textContent.trim() && link.textContent.trim().length < 50){
                    return link.textContent.trim();
                }
            }
        }
        
        return null;
    } catch (e) { return null; }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateVideoInfo() {
    if (!settings.showVideoInfo) {
        if (videoInfoElement) {
            videoInfoElement.remove();
            videoInfoElement = null;
        }
        return;
    }

    const info = getVideoInfo();
    if (!info) return;

    if (!videoInfoElement) {
        videoInfoElement = document.createElement("div");
        videoInfoElement.id = "video-info-panel";
        document.body.appendChild(videoInfoElement);
    }

    const progress = info.duration ? (info.currentTime / info.duration) * 100 : 0;

    videoInfoElement.innerHTML = `
        <div class="vi-header">📺 Video Info</div>
        <div class="vi-content">
            <div class="vi-row"><span class="vi-label">Title:</span> <span class="vi-value">${escapeHtml(info.title)}</span></div>
            <div class="vi-row"><span class="vi-label">Channel:</span> <span class="vi-value">${escapeHtml(info.channel)}</span></div>
            ${info.videoId ? `<div class="vi-row"><span class="vi-label">ID:</span> <span class="vi-value">${info.videoId}</span></div>` : ''}
            <div class="vi-row"><span class="vi-label">Time:</span> <span class="vi-value">${formatTime(info.currentTime)} / ${formatTime(info.duration)}</span></div>
            <div class="vi-progress"><div class="vi-progress-bar" style="width:${progress}%"></div></div>
            <div class="vi-row"><span class="vi-label">Speed:</span> <span class="vi-value">${info.playbackRate}x</span></div>
            <div class="vi-row"><span class="vi-label">Volume:</span> <span class="vi-value">${info.volume.toFixed(1)}x</span></div>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ===== AUTO SKIP AD =====
let lastAdDetected = false;

function skipAd() {
    if (!settings.autoSkipAd) return;
    
    // Only run on YouTube
    if (!window.location.hostname.includes('youtube.com')) return;
    
    const v = getVideo();
    
    // Find skip button
    const skipBtn = document.querySelector('.ytp-ad-skip-button') || 
                    document.querySelector('.ytp-ad-skip-button-modern') || 
                    document.querySelector('.ytp-skip-ad-button') ||
                    document.querySelector('[class*="skip-button"]') ||
                    document.querySelector('.videoAdSkipButton');
    
    // Check for short ad indicator
    const shortAdMsg = document.querySelector('.video-ads.ytp-ad-module .ytp-ad-player-overlay') || 
                       document.querySelector('.ytp-ad-button-icon');
    
    // Mute when ad is showing
    if((skipBtn || shortAdMsg) && v){
        v.muted = true;
    }
    
    if (skipBtn) {
        console.log("Skipping ad...");
        const delayTime = 0.5;
        
        // Force skip if video time is past delay
        if(v && v.currentTime > delayTime){
            v.currentTime = v.duration;
            console.log("Force skipped ad (time jump)");
            lastAdDetected = true;
            setTimeout(() => applyVideo(), 500);
            return;
        }
        
        skipBtn.click();
        lastAdDetected = true;
        setTimeout(() => {
            console.log("Ad skipped, re-applying speed...");
            applyVideo();
        }, 500);
        return;
    }
    
    // Force skip when ad is playing but no skip button
    if (shortAdMsg && v && v.duration) {
        v.currentTime = v.duration;
        console.log("Force skipped ad (no button)");
        lastAdDetected = true;
        setTimeout(() => applyVideo(), 500);
        return;
    }
    
    // Close overlay ads
    const adOverlay = document.querySelector('.ytp-ad-overlay-close-button, .ytp-ad-overlay-slot');
    if (adOverlay) {
        lastAdDetected = true;
        adOverlay.click();
        setTimeout(() => applyVideo(), 500);
        return;
    }
}

    const adOverlay = document.querySelector('.ytp-ad-overlay-close-button, .ytp-ad-overlay-slot');
    if (adOverlay) {
        lastAdDetected = true;
        adOverlay.click();
        setTimeout(() => {
            applyVideo();
        }, 500);
        return;
    }

    const adIndicator = document.querySelector('.ytp-ad-text, .ad-showing');
    if (adIndicator) {
        lastAdDetected = true;
        const possibleSkip = document.querySelector('.ytp-ad-skip-button, [data-ad-skip]');
        if (possibleSkip) {
            possibleSkip.click();
            setTimeout(() => {
                applyVideo();
            }, 500);
        }
    }
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

// ===== CUSTOM UI =====
function applyCustomUI() {
    let customStyles = document.getElementById("yt-custom-ui");
    if (!customStyles) {
        customStyles = document.createElement("style");
        customStyles.id = "yt-custom-ui";
        document.head.appendChild(customStyles);
    }

    if (!settings.customUI) {
        customStyles.innerHTML = "";
        return;
    }

    let css = "";

    if (settings.removeShorts) {
        css += `
            ytd-rich-item-renderer[is-shorts], 
            ytd-reel-shelf-renderer,
            [is-shorts],
            ytd-shorts-video-renderer,
            .ytd-rich-grid-slim-media,
            #segments-ads,
            ytd-ad-slot-renderer { display: none !important; }
        `;
    }

    if (settings.removeSidebar) {
        css += `
            #secondary, 
            ytd-watch-next-secondary-results-renderer,
            .ytd-watch-flexy #secondary { display: none !important; }
            #primary { max-width: 100% !important; }
        `;
    }

    css += `
        .dark-theme-custom {
            --yt-spec-brand-background-primary: #0f0f0f !important;
            --yt-spec-app-background: #0f0f0f !important;
            --yt-spec-general-background-a: #0f0f0f !important;
            --yt-spec-general-background-b: #1a1a1a !important;
        }
        
        .ytd-promoted-video-renderer,
        .ytd-banner-promo-renderer { display: none !important; }
        
        .ytp-chrome-bottom { opacity: 0.8 !important; }
        
        ::-webkit-scrollbar { width: 8px !important; }
        ::-webkit-scrollbar-track { background: #1a1a1a !important; }
        ::-webkit-scrollbar-thumb { background: #555 !important; border-radius: 4px !important; }
        
        .ytp-endscreen-content { display: none !important; }
        
        ytd-watch-flexy[dark] #secondary-inner,
        ytd-watch-flexy[dark] ytd-reel-shelf-renderer { opacity: 0.9 !important; }
    `;

    customStyles.innerHTML = css;
    console.log("Custom UI applied");
}

// ===== VIDEO EVENT HANDLERS =====
function onVideoReady() {
    console.log("Video ready, applying settings...");
    applyVideo();
    
    const v = getVideo();
    if (v) {
        v.loop = settings.autoLoop;
    }
}

function onVideoError(e) {
    console.warn("Video error:", e);
}

// ===== VIDEO INFO PANEL STYLES =====
GM_addStyle(`
    #video-info-panel {
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 12px 16px;
        border-radius: 10px;
        font-family: Tahoma, sans-serif;
        font-size: 12px;
        z-index: 9998;
        min-width: 220px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.1);
    }
    #video-info-panel .vi-header {
        font-weight: bold;
        font-size: 13px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.15);
        color: #4CAF50;
    }
    #video-info-panel .vi-row {
        display: flex;
        justify-content: space-between;
        margin: 4px 0;
    }
    #video-info-panel .vi-label {
        color: #aaa;
    }
    #video-info-panel .vi-value {
        color: #fff;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
    }
    #video-info-panel .vi-progress {
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
        margin: 8px 0;
        overflow: hidden;
    }
    #video-info-panel .vi-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #4CAF50, #8BC34A);
        border-radius: 2px;
        transition: width 0.3s ease;
    }
`);

// ===== INIT =====
function init(){
    if(!document.body){
        requestAnimationFrame(init);
        return;
    }

    document.body.appendChild(panel);
    panel.style.display = "none";
    applyWallpaper();
    applyTheme(settings.theme);
    initEventListeners();
    initVideoDetection();
    
    if(settings.autoFill){
        panel.style.width = "100%";
        panel.style.height = "auto";
        panel.style.maxWidth = "none";
        panel.style.maxHeight = "none";
        panel.style.top = "10px";
        panel.style.left = "10px";
        panel.style.right = "10px";
    } else {
        panel.style.minHeight = "60px";
    }
    
    console.log("Video Control Panel PRO v" + CURRENT_VERSION + " initialized");
    addSmoothTransitions();
}

function addSmoothTransitions(){
    const inputs = panel.querySelectorAll('input[type="number"], input[type="text"], input[type="range"]');
    inputs.forEach(input => {
        input.style.transition = 'all 0.2s ease';
    });
    
    const buttons = panel.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.style.transition = 'all 0.2s ease';
    });
    
    panel.style.transition = 'opacity 0.2s ease, background 0.3s ease, transform 0.2s ease';
}

// ===== INPUT =====
const volumeInput = panel.querySelector("#volume");
const speedInput = panel.querySelector("#speed");

function updateVolumeInput(){
    volumeInput.value = settings.volume;
    volumeInput.classList.toggle("booster", settings.volume > 1);
    console.log("Volume input updated:", settings.volume);
}

updateVolumeInput();
speedInput.value = settings.speed;

volumeInput.onchange = () => {
    settings.volume = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    GM_setValue("settings", settings);
    updateVolumeInput();
    applyVideo();
    console.log("Volume changed:", settings.volume);
};

let volumeInputTimeout = null;
volumeInput.oninput = () => {
    const val = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    volumeInput.classList.toggle("booster", val > 1);
    
    if(volumeInputTimeout) clearTimeout(volumeInputTimeout);
    volumeInputTimeout = setTimeout(() => {
        applyVideoToVolume(val);
    }, 50);
};

speedInput.onchange = () => {
    settings.speed = clamp(parseFloat(speedInput.value) || 1, 0.1, 16);
    GM_setValue("settings", settings);
    applyVideo();
    console.log("Speed changed:", settings.speed);
};

function applyVideoToVolume(vol) {
    const v = getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    
    if(vol <= 1){
        requestAnimationFrame(() => {
            v.volume = vol;
        });
        if(audioData && audioData.gain) {
            smoothGainTransition(audioData.gain, 1);
        }
    } else {
        requestAnimationFrame(() => {
            v.volume = 1;
        });
        if(audioData && audioData.gain) {
            smoothGainTransition(audioData.gain, vol);
        } else {
            console.warn("Audio boost not available, volume limited to 1x");
        }
    }
    console.log("Volume preview:", vol, "Audio boost:", vol > 1 ? "Yes" : "No");
}

// ===== TABS =====
const control = panel.querySelector("#control");
const settingsDiv = panel.querySelector("#settings");

panel.querySelector("#tab1").onclick = () => {
    control.style.display = "block";
    settingsDiv.style.display = "none";
};

panel.querySelector("#tab2").onclick = () => {
    control.style.display = "none";
    settingsDiv.style.display = "block";
};

// ===== SETTINGS CHECKBOXES =====
const autoShowCheckbox = document.getElementById("autoShow");
const autoVideoCheckbox = document.getElementById("autoVideo");
const autoResumeCheckbox = document.getElementById("autoResume");
const autoLoopCheckbox = document.getElementById("autoLoop");
const showVideoInfoCheckbox = document.getElementById("showVideoInfo");
const autoSkipAdCheckbox = document.getElementById("autoSkipAd");
const customUICheckbox = document.getElementById("customUI");
const removeShortsCheckbox = document.getElementById("removeShorts");
const removeSidebarCheckbox = document.getElementById("removeSidebar");

if(autoShowCheckbox){
    autoShowCheckbox.checked = settings.autoShow !== false;
    autoShowCheckbox.onchange = e => {
        settings.autoShow = e.target.checked;
        GM_setValue("settings", settings);
    };
}

if(autoVideoCheckbox){
    autoVideoCheckbox.checked = settings.autoVideo !== false;
    autoVideoCheckbox.onchange = e => {
        settings.autoVideo = e.target.checked;
        GM_setValue("settings", settings);
    };
}

if(autoResumeCheckbox){
    autoResumeCheckbox.checked = settings.autoResume !== false;
    autoResumeCheckbox.onchange = e => {
        settings.autoResume = e.target.checked;
        GM_setValue("settings", settings);
    };
}

if(autoLoopCheckbox){
    autoLoopCheckbox.checked = settings.autoLoop !== false;
    autoLoopCheckbox.onchange = e => {
        settings.autoLoop = e.target.checked;
        GM_setValue("settings", settings);
        const v = getVideo();
        if(v) v.loop = settings.autoLoop;
        console.log("Auto loop:", settings.autoLoop);
    };
}

if(showVideoInfoCheckbox){
    showVideoInfoCheckbox.checked = settings.showVideoInfo !== false;
    showVideoInfoCheckbox.onchange = e => {
        settings.showVideoInfo = e.target.checked;
        GM_setValue("settings", settings);
        if(!settings.showVideoInfo && videoInfoElement){
            videoInfoElement.remove();
            videoInfoElement = null;
        }
    };
}

if(autoSkipAdCheckbox){
    autoSkipAdCheckbox.checked = settings.autoSkipAd !== false;
    autoSkipAdCheckbox.onchange = e => {
        settings.autoSkipAd = e.target.checked;
        GM_setValue("settings", settings);
    };
}

if(customUICheckbox){
    customUICheckbox.checked = settings.customUI || false;
    customUICheckbox.onchange = e => {
        settings.customUI = e.target.checked;
        GM_setValue("settings", settings);
        applyCustomUI();
    };
}

if(removeShortsCheckbox){
    removeShortsCheckbox.checked = settings.removeShorts || false;
    removeShortsCheckbox.onchange = e => {
        settings.removeShorts = e.target.checked;
        GM_setValue("settings", settings);
        applyCustomUI();
    };
}

if(removeSidebarCheckbox){
    removeSidebarCheckbox.checked = settings.removeSidebar || false;
    removeSidebarCheckbox.onchange = e => {
        settings.removeSidebar = e.target.checked;
        GM_setValue("settings", settings);
        applyCustomUI();
    };
}

// ===== WALL =====
const wallInput = panel.querySelector("#wall");
if(wallInput){
    wallInput.value = settings.wallpaper || "";
    wallInput.onchange = () => {
        settings.wallpaper = wallInput.value.trim();
        GM_setValue("settings", settings);
        applyWallpaper();
    };
}

// ===== COLOR =====
const colorInput = panel.querySelector("#color");
if(colorInput){
    colorInput.value = settings.color;
    colorInput.oninput = () => {
        settings.color = colorInput.value;
        document.documentElement.style.setProperty("--panel-bg", settings.color);
    };
    colorInput.onchange = () => {
        GM_setValue("settings", settings);
    };
}

// ===== PANEL SIZE & POSITION =====
const panelWidthInput = document.getElementById("panelWidth");
const panelHeightInput = document.getElementById("panelHeight");
const autoFillCheckbox = document.getElementById("autoFill");
const posXInput = document.getElementById("posX");
const posYInput = document.getElementById("posY");

if(panelWidthInput && panelHeightInput && posXInput && posYInput){
    panelWidthInput.value = parseInt(panel.style.width) || 260;
    panelHeightInput.value = parseInt(panel.style.height) || 200;
    posXInput.value = settings.posX || 60;
    posYInput.value = settings.posY || 60;

    panelWidthInput.onchange = () => {
        const w = parseInt(panelWidthInput.value) || 260;
        panel.style.width = w + "px";
    };

    panelHeightInput.onchange = () => {
        const h = parseInt(panelHeightInput.value) || 200;
        panel.style.height = h + "px";
    };

    if(autoFillCheckbox){
        autoFillCheckbox.checked = settings.autoFill || false;
        autoFillCheckbox.onchange = () => {
            if(autoFillCheckbox.checked){
                settings.autoFill = true;
                panel.style.width = "100%";
                panel.style.height = "auto";
                panel.style.maxWidth = "none";
                panel.style.maxHeight = "none";
                panel.style.top = "10px";
                panel.style.left = "10px";
                panel.style.right = "10px";
                if(posXInput) posXInput.value = 10;
                if(posYInput) posYInput.value = 10;
            } else {
                settings.autoFill = false;
                const w = parseInt(panelWidthInput?.value) || 260;
                const h = parseInt(panelHeightInput?.value) || 200;
                const x = parseInt(posXInput?.value) || 60;
                const y = parseInt(posYInput?.value) || 60;
                panel.style.width = w + "px";
                panel.style.height = h + "px";
                panel.style.top = y + "px";
                panel.style.left = x + "px";
                panel.style.right = "auto";
            }
            GM_setValue("settings", settings);
        };
    }

    posXInput.onchange = () => {
        settings.posX = parseInt(posXInput.value) || 60;
        if(!autoFillCheckbox || !autoFillCheckbox.checked){
            panel.style.left = settings.posX + "px";
        }
        GM_setValue("settings", settings);
    };

    posYInput.onchange = () => {
        settings.posY = parseInt(posYInput.value) || 60;
        if(!autoFillCheckbox || !autoFillCheckbox.checked){
            panel.style.top = settings.posY + "px";
        }
        GM_setValue("settings", settings);
    };
}

// ===== THEME TOGGLE =====
const themeToggle = panel.querySelector("#themeToggle");
const themes = ["auto", "light", "dark"];
let currentThemeIndex = themes.indexOf(settings.theme);
if(currentThemeIndex === -1) currentThemeIndex = 0;

function updateThemeIcon(){
    const icons = { auto: "🌓", light: "☀️", dark: "🌙" };
    themeToggle.textContent = icons[settings.theme] || "🌓";
}

if(themeToggle){
    themeToggle.onclick = () => {
        currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        settings.theme = themes[currentThemeIndex];
        GM_setValue("settings", settings);
        applyTheme(settings.theme);
        updateThemeIcon();
    };
}

applyTheme(settings.theme);
updateThemeIcon();

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if(settings.theme === "auto"){
        applyTheme("auto");
    }
});

// ===== OPACITY SLIDER =====
const opacitySlider = panel.querySelector("#opacitySlider");
const opacityValue = panel.querySelector("#opacityValue");

if(opacitySlider && opacityValue){
    opacitySlider.oninput = () => {
        settings.opacity = parseFloat(opacitySlider.value);
        panel.style.opacity = settings.opacity;
        opacityValue.textContent = Math.round(settings.opacity * 100) + "%";
    };
    opacitySlider.onchange = () => {
        GM_setValue("settings", settings);
    };
}

// ===== AUTO RESUME TOGGLE =====
const pauseToggleBtn = panel.querySelector("#pauseToggle");
if(pauseToggleBtn){
    pauseToggleBtn.textContent = settings.autoResume ? "⏸ Auto" : "▶ Auto";
    if(!settings.autoResume) pauseToggleBtn.classList.add("auto-disabled");
    pauseToggleBtn.onclick = () => {
        settings.autoResume = !settings.autoResume;
        GM_setValue("settings", settings);
        pauseToggleBtn.textContent = settings.autoResume ? "⏸ Auto" : "▶ Auto";
        pauseToggleBtn.classList.toggle("auto-disabled", !settings.autoResume);
    };
}

// ===== UPDATE SETTINGS =====
const updateIntervalSelect = document.getElementById("updateInterval");
const autoNotifyCheckbox = document.getElementById("autoNotify");
const notifyDurationInput = document.getElementById("notifyDuration");

if(updateIntervalSelect){
    updateIntervalSelect.value = settings.updateCheckInterval || 24;
    updateIntervalSelect.onchange = () => {
        settings.updateCheckInterval = parseInt(updateIntervalSelect.value);
        GM_setValue("settings", settings);
    };
}

if(autoNotifyCheckbox){
    autoNotifyCheckbox.checked = settings.autoShowNotification !== false;
    autoNotifyCheckbox.onchange = () => {
        settings.autoShowNotification = autoNotifyCheckbox.checked;
        GM_setValue("settings", settings);
    };
}

if(notifyDurationInput){
    notifyDurationInput.value = settings.notificationDuration || 10;
    notifyDurationInput.onchange = () => {
        settings.notificationDuration = clamp(parseInt(notifyDurationInput.value) || 10, 0, 60);
        notifyDurationInput.value = settings.notificationDuration;
        GM_setValue("settings", settings);
    };
}

// ===== HOTKEY =====
const actions = [
    {key:"toggle",name:"Toggle"},
    {key:"speedUp",name:"Speed+"},
    {key:"speedDown",name:"Speed-"},
    {key:"volUp",name:"Vol+"},
    {key:"volDown",name:"Vol-"},
    {key:"moveToMouse",name:"ToMouse"},
    {key:"toggleVideoInfo",name:"VideoInfo"},
    {key:"toggleCustomUI",name:"CustomUI"},
    {key:"toggleLoop",name:"Loop"}
];

const hkDiv = panel.querySelector("#hotkeys");

function format(hk){
    if(!hk || !hk.key) return "Set";
    return (hk.ctrl?"Ctrl+":"") + (hk.alt?"Alt+":"") + (hk.shift?"Shift+":"") + hk.key;
}

function renderHotkeys(){
    hkDiv.innerHTML = "";
    actions.forEach(a => {
        const line = document.createElement("div");
        const label = document.createElement("span");
        label.innerText = a.name + " ";
        label.style.width = "60px";
        const btn = document.createElement("button");
        btn.className = "keybtn";
        btn.innerText = format(settings.hotkeys[a.key]);
        const reset = document.createElement("button");
        reset.innerText = "⟲";
        reset.className = "resetBtn";
        
        btn.onclick = () => {
            capturingKey = a.key;
            btn.innerText = "Nhập...";
        };
        reset.onclick = () => {
            delete settings.hotkeys[a.key];
            GM_setValue("settings", settings);
            renderHotkeys();
        };
        line.append(label, btn, reset);
        hkDiv.appendChild(line);
    });
    const resetAll = document.createElement("button");
    resetAll.innerText = "Reset All";
    resetAll.className = "resetBtn";
    resetAll.style.marginTop = "8px";
    resetAll.onclick = () => {
        settings.hotkeys = {};
        GM_setValue("settings", settings);
        renderHotkeys();
    };
    hkDiv.appendChild(document.createElement("br"));
    hkDiv.appendChild(resetAll);
}

renderHotkeys();

// ===== KEYBOARD =====
document.addEventListener("keydown", e => {
    if(capturingKey){
        if(e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta"){
            e.preventDefault();
            return;
        }
        e.preventDefault();
        const hk = {
            key: e.key,
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey
        };
        for(let k in settings.hotkeys){
            if(k === capturingKey) continue;
            const existing = settings.hotkeys[k];
            if(existing && JSON.stringify(existing) === JSON.stringify(hk)){
                alert("Phím bị trùng!");
                capturingKey = null;
                renderHotkeys();
                return;
            }
        }
        settings.hotkeys[capturingKey] = hk;
        GM_setValue("settings", settings);
        capturingKey = null;
        renderHotkeys();
        return;
    }
    
    for(let k in settings.hotkeys){
        const hk = settings.hotkeys[k];
        if(!hk || !hk.key) continue;
        if(
            normalizeKey(e.key) === normalizeKey(hk.key) &&
            e.ctrlKey === !!hk.ctrl &&
            e.altKey === !!hk.alt &&
            e.shiftKey === !!hk.shift
        ){
            if(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") continue;
            handle(k);
        }
    }
    
    // Escape hides panel
    if(e.key === "Escape" && panel.style.display !== "none"){
        panel.style.animation = "fadeOut 0.3s ease";
        setTimeout(() => {
            panel.style.display = "none";
        }, 300);
    }
    
    // Main hotkey toggle (case-sensitive)
    const hotkey = settings.hotkey || "*";
    const isModifier = e.ctrlKey || e.altKey || e.metaKey;
    
    // Handle special characters - allow shift for keys like * (Shift+8 on most keyboards)
    let keyMatch = false;
    if(hotkey.length === 1){
        const hotkeyLower = hotkey.toLowerCase();
        const keyLower = e.key.toLowerCase();
        keyMatch = keyLower === hotkeyLower;
    } else {
        keyMatch = e.code === hotkey.toUpperCase();
    }
    
    if(keyMatch && !isModifier && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA"){
        e.preventDefault();
        if(settings.autoVideo && !getVideo()){
            panel.style.display = "none";
            return;
        }
        if(panel.style.display === "none"){
            panel.style.display = "block";
            panel.style.animation = "fadeIn 0.3s ease";
        } else {
            panel.style.animation = "fadeOut 0.3s ease";
            setTimeout(() => {
                panel.style.display = "none";
            }, 300);
        }
        applyVideo();
    }
});

// ===== ACTION =====
function handle(a){
    switch(a){
        case "toggle":
            if(settings.autoVideo && !getVideo()){
                panel.style.display = "none";
                return;
            }
            if(panel.style.display === "none"){
                panel.style.display = "block";
                panel.style.animation = "fadeIn 0.3s ease";
            } else {
                panel.style.animation = "fadeOut 0.3s ease";
                setTimeout(() => {
                    panel.style.display = "none";
                }, 300);
            }
            applyVideo();
            return;
        case "speedUp": 
            settings.speed = clamp(settings.speed + 0.1, 0.1, 16); 
            break;
        case "speedDown": 
            settings.speed = clamp(settings.speed - 0.1, 0.1, 16); 
            break;
        case "volUp": 
            settings.volume = clamp(settings.volume + 0.1, 0, 5); 
            break;
        case "volDown": 
            settings.volume = clamp(settings.volume - 0.1, 0, 5); 
            break;
        case "moveToMouse":
            panel.style.transition = "left 0.2s ease, top 0.2s ease";
            panel.style.left = clamp(lastMouseX, 0, window.innerWidth - 260) + "px";
            panel.style.top = clamp(lastMouseY, 0, window.innerHeight - 120) + "px";
            setTimeout(() => {
                panel.style.transition = "opacity 0.2s ease, background 0.3s ease, transform 0.2s ease";
            }, 200);
            return;
        case "toggleVideoInfo":
            settings.showVideoInfo = !settings.showVideoInfo;
            if(!settings.showVideoInfo && videoInfoElement){
                videoInfoElement.remove();
                videoInfoElement = null;
            }
            if(videoInfoInterval){
                clearInterval(videoInfoInterval);
                videoInfoInterval = null;
            }
            if(settings.showVideoInfo && getVideo()){
                videoInfoInterval = setInterval(updateVideoInfo, 1000);
            }
            GM_setValue("settings", settings);
            return;
        case "toggleCustomUI":
            settings.customUI = !settings.customUI;
            applyCustomUI();
            GM_setValue("settings", settings);
            return;
        case "toggleLoop":
            settings.autoLoop = !settings.autoLoop;
            const v = getVideo();
            if(v) v.loop = settings.autoLoop;
            GM_setValue("settings", settings);
            return;
    }
    GM_setValue("settings", settings);
    applyVideo();
    updateVolumeInput();
    speedInput.value = settings.speed;
}

// ===== MOUSE TRACKING =====
document.addEventListener("mousemove", e => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

// ===== DRAG =====
const header = panel.querySelector("#header");

header.addEventListener("mousedown", e => {
    if(isLocked) return;
    if(e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
    e.preventDefault();
    isDragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
});

document.addEventListener("mousemove", e => {
    if(!isDragging) return;
    if(raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
        const newLeft = clamp(e.clientX - offsetX, 0, window.innerWidth - 260);
        const newTop = clamp(e.clientY - offsetY, 0, window.innerHeight - 120);
        panel.style.left = newLeft + "px";
        panel.style.top = newTop + "px";
        if(posXInput) posXInput.value = newLeft;
        if(posYInput) posYInput.value = newTop;
        raf = null;
    });
});

document.addEventListener("mouseup", () => {
    if(isDragging){
        settings.posX = panel.offsetLeft;
        settings.posY = panel.offsetTop;
        settings.panelWidth = parseInt(panel.style.width) || 260;
        settings.panelHeight = parseInt(panel.style.height) || 200;
        GM_setValue("settings", settings);
    }
    isDragging = false;
});

// ===== LOCK =====
const lockBtn = panel.querySelector("#lock");
if(lockBtn){
    lockBtn.onclick = () => {
        isLocked = !isLocked;
        lockBtn.textContent = isLocked ? "🔒" : "🔓";
        header.style.cursor = isLocked ? "default" : "move";
    };
}

const minBtn = panel.querySelector("#min");
let isMinimized = false;
if(minBtn){
    minBtn.onclick = () => {
        isMinimized = !isMinimized;
        minBtn.textContent = isMinimized ? "☰" : "_";
        if(isMinimized){
            control.style.display = "none";
            header.style.display = "none";
            panel.style.minWidth = "30px";
            panel.style.minHeight = "30px";
            panel.style.width = "30px";
            panel.style.padding = "2px";
        } else {
            control.style.display = "block";
            header.style.display = "flex";
            panel.style.minWidth = "150px";
            panel.style.minHeight = "60px";
            panel.style.width = "";
            panel.style.padding = "4px";
        }
    };
}

panel.addEventListener("click", (e) => {
    if(isMinimized && e.target === panel){
        isMinimized = false;
        minBtn.textContent = "_";
        control.style.display = "block";
        header.style.display = "flex";
        panel.style.minWidth = "150px";
        panel.style.minHeight = "60px";
        panel.style.width = "";
        panel.style.padding = "4px";
    }
});

const maxBtn = panel.querySelector("#max");
const closeBtn = panel.querySelector("#close");
let isMaximized = settings.autoFill || false;

if(maxBtn){
    maxBtn.textContent = isMaximized ? "❐" : "☐";
    maxBtn.onclick = () => {
        isMaximized = !isMaximized;
        maxBtn.textContent = isMaximized ? "❐" : "☐";
        if(isMaximized){
            settings.autoFill = true;
            panel.style.width = "100%";
            panel.style.height = "auto";
            panel.style.maxWidth = "none";
            panel.style.maxHeight = "none";
            panel.style.top = "10px";
            panel.style.left = "10px";
            panel.style.right = "10px";
            if(autoFillCheckbox) autoFillCheckbox.checked = true;
        } else {
            settings.autoFill = false;
            const w = parseInt(panelWidthInput?.value) || 260;
            const h = parseInt(panelHeightInput?.value) || 200;
            const x = parseInt(posXInput?.value) || 60;
            const y = parseInt(posYInput?.value) || 60;
            panel.style.width = w + "px";
            panel.style.height = h + "px";
            panel.style.top = y + "px";
            panel.style.left = x + "px";
            panel.style.right = "auto";
            if(autoFillCheckbox) autoFillCheckbox.checked = false;
        }
        GM_setValue("settings", settings);
    };
}

if(closeBtn){
    closeBtn.onclick = () => {
        panel.style.display = "none";
    };
}

const resizeHandle = panel.querySelector("#resize-handle");
let isResizing = false;
let startX, startY, startW, startH;

if(resizeHandle){
    resizeHandle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = panel.offsetWidth;
        startH = panel.offsetHeight;
        document.body.style.cursor = "se-resize";
    });
}

document.addEventListener("mousemove", (e) => {
    if(!isResizing) return;
    const newW = startW + (e.clientX - startX);
    const newH = startH + (e.clientY - startY);
    if(newW >= 150 && newW <= window.innerWidth){
        panel.style.width = newW + "px";
        if(panelWidthInput) panelWidthInput.value = newW;
    }
    if(newH >= 80 && newH <= window.innerHeight){
        panel.style.height = newH + "px";
        if(panelHeightInput) panelHeightInput.value = newH;
    }
});

document.addEventListener("mouseup", () => {
    if(isResizing){
        isResizing = false;
        document.body.style.cursor = "";
        settings.panelWidth = panel.offsetWidth;
        settings.panelHeight = panel.offsetHeight;
        GM_setValue("settings", settings);
    }
});

// ===== VIDEO DETECTION =====
let detectionTimeout = null;
let lastDetectionTime = 0;
const DETECTION_DEBOUNCE = 100;

function detectVideoOnce(){
    const now = Date.now();
    if(now - lastDetectionTime < DETECTION_DEBOUNCE){
        if(detectionTimeout) clearTimeout(detectionTimeout);
        detectionTimeout = setTimeout(() => detectVideoOnce(), DETECTION_DEBOUNCE);
        return;
    }
    lastDetectionTime = now;
    
    const v = getVideo();
    const videoSrc = v ? (v.src || v.currentSrc || '') : '';
    const lastSrc = lastVideo ? (lastVideo.src || lastVideo.currentSrc || '') : '';
    
    // Detect new video or src change (e.g., after skip ad)
    if(v !== lastVideo || videoSrc !== lastSrc){
        if(lastVideo){
            lastVideo.removeEventListener('canplay', onVideoReady);
            lastVideo.removeEventListener('loadedmetadata', onVideoReady);
            lastVideo.removeEventListener('error', onVideoError);
            cleanupAudioContext(lastVideo);
        }
        lastVideo = v;
        
        if(settings.autoVideo){
            if(v){
                panel.style.display = "block";
                panel.style.animation = "fadeIn 0.3s ease";
            } else {
                panel.style.animation = "fadeOut 0.3s ease";
                setTimeout(() => {
                    panel.style.display = "none";
                }, 300);
            }
        }

        if(v){
            console.log("Video detected:", v.src || v.currentSrc);
            v.addEventListener('canplay', onVideoReady);
            v.addEventListener('loadedmetadata', onVideoReady);
            v.addEventListener('error', onVideoError);
            v.loop = settings.autoLoop;
            
            if(videoInfoInterval) clearInterval(videoInfoInterval);
            if(settings.showVideoInfo){
                videoInfoInterval = setInterval(updateVideoInfo, 1000);
            }
            
            if(v.readyState >= 2){
                applyVideo();
            }
        }
    }
}

function initVideoDetection(){
    if(document.readyState === "complete"){
        detectVideoOnce();
    } else {
        window.addEventListener("load", detectVideoOnce);
    }
    
    document.addEventListener("play", e => {
        if(e.target.tagName === "VIDEO") detectVideoOnce();
    }, true);
    document.addEventListener("playing", e => {
        if(e.target.tagName === "VIDEO") detectVideoOnce();
    }, true);
    document.addEventListener("loadeddata", e => {
        if(e.target.tagName === "VIDEO") detectVideoOnce();
    }, true);
    document.addEventListener("loadstart", e => {
        if(e.target.tagName === "VIDEO") detectVideoOnce();
    }, true);
    document.addEventListener("durationchange", e => {
        if(e.target.tagName === "VIDEO") detectVideoOnce();
    }, true);

    try {
        if(observer) observer.disconnect();
        observer = new MutationObserver(mutations => {
            let shouldCheck = false;
            for(const mut of mutations){
                if(mut.addedNodes.length > 0){
                    for(const node of mut.addedNodes){
                        if(node.nodeName === "VIDEO" || 
                           (node.querySelector && node.querySelector("video"))){
                            shouldCheck = true;
                            break;
                        }
                    }
                }
                if(mut.type === "attributes" && mut.attributeName === "src"){
                    shouldCheck = true;
                }
                if(shouldCheck) break;
            }
            if(shouldCheck){
                requestAnimationFrame(detectVideoOnce);
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'currentSrc', 'style', 'class']
        });
    } catch(e) {
        console.warn("MutationObserver error:", e);
    }

    if(settings.autoSkipAd){
        setInterval(skipAd, 1000);
    }
    if(settings.autoLoop){
        setInterval(forceLoop, 500);
    }
    
    // Periodic check to ensure settings are applied (fallback for ad-skip scenarios)
    setInterval(() => {
        const v = getVideo();
        if(v && v.readyState >= 2 && !v.paused){
            if(lastApplied.speed !== settings.speed || lastApplied.volume !== settings.volume){
                applyVideo();
            }
        }
    }, 2000);
}

// ===== EVENT LISTENERS =====
function initEventListeners(){
    window.addEventListener("resize", () => {
        panel.style.left = clamp(parseInt(panel.style.left) || 0, 0, window.innerWidth - 260) + "px";
        panel.style.top = clamp(parseInt(panel.style.top) || 0, 0, window.innerHeight - 120) + "px";
    });
    
    window.addEventListener("pagehide", () => {
        if(observer) observer.disconnect();
        if(lastVideo) cleanupAudioContext(lastVideo);
        if(videoInfoInterval) clearInterval(videoInfoInterval);
    });
}

// ===== START =====
init();
console.log("Video Control Panel PRO v" + CURRENT_VERSION + " - Fixed version");

checkForUpdates();
setTimeout(checkConflict, 2000);

})();
