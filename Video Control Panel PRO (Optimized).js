// ==UserScript==
// @name         Video Control Panel PRO (Optimized)
// @namespace    http://tampermonkey.net/
// @version      16.1
// @updateURL    https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js
// @downloadURL  https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @description  Auto skip ads + Video info + Custom UI + size/position controls + settings UI v2 (v16.0)
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
    autoVideo: false,
    autoResume: true,
    autoLoop: true,
    autoSkipAd: true,
    showVideoInfo: true,
    posX: 60,
    posY: 60,
    panelWidth: 260,
    panelHeight: 200,
    hotkeys: {},
    theme: "auto",
    opacity: 1.0,
    compactMode: false,
    lastUpdateCheck: 0,
    updateAvailable: false,
    updateCheckInterval: 24,
    autoShowNotification: true,
    notificationDuration: 10,
    customUI: false,
    removeShorts: false,
    removeSidebar: false
});

// ===== UPDATE CHECKING =====
const CURRENT_VERSION = "16.0";
const UPDATE_URL = "https://raw.githubusercontent.com/thatonevietnamese/control-panel-lite/refs/heads/main/Video%20Control%20Panel%20PRO%20(Optimized).js";

function checkForUpdates(){
    const now = Date.now();
    // Chỉ check update theo interval đã設定
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
                            // Hiển thị thông báo update
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
    // Kiểm tra xem có nên hiện notification không
    if(!settings.autoShowNotification){
        console.log("Update available:", newVersion, "(notification disabled)");
        return;
    }
    
    // Tạo notification element
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
    
    // Tự động remove theo settings (0 = never)
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
    // PRO uses id="panel", LITE uses id="vcp-panel"
    const proPanel = document.getElementById("panel");
    const litePanel = document.getElementById("vcp-panel");
    
    if (proPanel && litePanel) {
        showConflictNotification();
    }
}

function showConflictNotification() {
    // Only show once
    if (document.getElementById("conflict-notification")) return;
    
    const notification = document.createElement("div");
    notification.id = "conflict-notification";
    notification.innerHTML = `
        <div style="position:fixed; top:20px; right:20px; background:#f44336; color:white; padding:12px 20px; border-radius:8px; z-index:10002; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-family:Tahoma; font-size:12px; animation:slideIn 0.3s ease;">
            ⚠️ Xung đột! Cả PRO và LITE đang bật. Vui lòng tắt một phiên bản.
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

// ===== AUTO RESUME STATE =====
window.autoResumeEnabled = () => settings.autoResume;

// ===== AUDIO BOOST =====
// Cache audio contexts và gain nodes cho từng video
const audioContexts = new WeakMap();

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
        // FIX: Thêm logging để debug
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
        
        const audioData = { ctx: audioCtx, gain: gainNode };
        audioContexts.set(video, audioData);
        
        // FIX: Resume AudioContext ngay sau khi tạo
        if(audioCtx.state === 'suspended'){
            audioCtx.resume().catch(e => {
                console.warn("Failed to resume AudioContext:", e);
            });
        }
        
        // FIX: Thêm logging để debug
        console.log("Audio boost initialized for video");
        
        return audioData;
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

// ===== HELPERS =====
function normalizeKey(key){
    return (key || "").replace(/\s+/g,'').toLowerCase();
}

function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
}

function getVideo(){
    try {
        const videos = document.querySelectorAll("video");
        // FIX: Ưu tiên video đang phát
        for (const v of videos) {
            if (v.offsetParent !== null && !v.paused && v.duration > 0) {
                return v;
            }
        }
        // Fallback: video có duration > 0
        for (const v of videos) {
            if (v.offsetParent !== null && v.duration > 0) {
                return v;
            }
        }
        // Fallback: return first visible video
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

// FIX: Thêm function để check video visibility
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
    // FIX: Prevent multiple simultaneous calls
    if(isApplying) return;
    isApplying = true;
    
    try {
        const v = getVideo();
        if(!v) {
            isApplying = false;
            return;
        }

        const speed = clamp(settings.speed, 0.1, 16);
        const volume = clamp(settings.volume, 0, 5); // Allow boost up to 5x

        // FIX: Smooth speed transition
        if(lastApplied.speed !== speed){
            // Sử dụng requestAnimationFrame để smooth transition
            requestAnimationFrame(() => {
                v.playbackRate = speed;
            });
            lastApplied.speed = speed;
            // FIX: Thêm logging để debug
            console.log("Speed applied:", speed);
        }

        if(lastApplied.volume !== volume){
            const audioData = getOrCreateGainNode(v);
            
            if(volume <= 1){
                // Normal volume: dùng video.volume, gain = 1
                // FIX: Smooth volume transition
                requestAnimationFrame(() => {
                    v.volume = volume;
                });
                if(audioData && audioData.gain) {
                    // FIX: Smooth gain transition
                    smoothGainTransition(audioData.gain, 1);
                }
            } else {
                // Boost volume: set video.volume = 1, gain = volume
                // FIX: Nếu audio boost không khả dụng, vẫn set video.volume = 1
                requestAnimationFrame(() => {
                    v.volume = 1;
                });
                if(audioData && audioData.gain) {
                    // FIX: Smooth gain transition
                    smoothGainTransition(audioData.gain, volume);
                } else {
                    // Fallback: nếu không có audio boost, chỉ set volume = 1
                    console.warn("Audio boost not available, volume limited to 1x");
                }
            }
            
            lastApplied.volume = volume;
            // FIX: Thêm logging để debug
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

    // FIX: Escape wallpaper URL để tránh XSS và lỗi CSS
    const escapedWallpaper = settings.wallpaper.replace(/"/g, '\\"').replace(/'/g, "\\'");
    style.innerHTML = `
        body, ytd-app {
            background: url("${escapedWallpaper}") no-repeat center center fixed !important;
            background-size: cover !important;
        }
    `;
    // FIX: Thêm logging để debug
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
    <button id="lock" data-tooltip="Khóa">🔓</button>
</div>

<div id="control">
    <div class="row">🔊 <input type="number" id="volume" step="0.1" min="0" max="5" data-tooltip="Âm lượng (0-5x)"></div>
    <div class="row">⚡ <input type="number" id="speed" step="0.1" min="0.1" max="16" data-tooltip="Tốc độ (0.1-16x)"></div>
    <div class="row"><button id="pauseToggle" data-tooltip="Dừng auto-resume">⏸ Auto</button></div>
    <div class="row"><label><input type="checkbox" id="compactMode"> Compact</label></div>
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
    // FIX: Thêm logging để debug
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
    min-height:${settings.panelHeight || 200}px;
    padding:6px;
    background:var(--panel-bg);
    color:var(--panel-text);
    border-radius:10px;
    z-index:9999;
    font-family:Tahoma;
    transition: opacity 0.2s ease, background 0.3s ease;
    opacity:${settings.opacity};
    overflow:hidden;
}
#panel, #panel *{ user-select:none !important; }

#header{display:flex;gap:3px;cursor:move;}
#settings{overflow-x:hidden;max-width:100%;}
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

/* Labels and checkboxes */
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

/* Highlight volume input when boosted (>1) */
#volume.booster{
    border-color: #ff9800;
    background: linear-gradient(90deg, #fff3e0 0%, #ffe0b2 100%);
    font-weight: bold;
}

/* Theme toggle button */
#themeToggle{
    width:28px;
    height:28px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:14px;
}

/* Opacity slider */
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

/* Compact mode */
.compact-mode .row span{display:none;}
.compact-mode .row input[type="number"]{width:60px;}
.compact-mode #settings{display:none !important;}
.compact-mode #compactMode{transform:scale(0.8);margin:0;}

/* Tooltips */
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

/* Animations */
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
}`);

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
        const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata, h1');
        return titleEl ? titleEl.textContent.trim() : null;
    } catch (e) { return null; }
}

function getYouTubeChannel() {
    try {
        const channelEl = document.querySelector('#channel-name a, #owner-name a, ytd-channel-name a');
        return channelEl ? channelEl.textContent.trim() : null;
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
function skipAd() {
    if (!settings.autoSkipAd) return;

    // Skip button trên overlay quảng cáo
    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, [class*="skip-button"], .videoAdSkipButton');
    if (skipBtn) {
        console.log("Skipping ad...");
        skipBtn.click();
        return;
    }

    // Skip overlay quảng cáo
    const adOverlay = document.querySelector('.ytp-ad-overlay-close-button, .ytp-ad-overlay-slot');
    if (adOverlay) {
        adOverlay.click();
        return;
    }

    // Check for "Ad playing" indicator
    const adIndicator = document.querySelector('.ytp-ad-text, .ad-showing');
    if (adIndicator) {
        // Try to find skip button in various locations
        const possibleSkip = document.querySelector('.ytp-ad-skip-button, [data-ad-skip]');
        if (possibleSkip) {
            possibleSkip.click();
        }
    }
}

// ===== FORCE LOOP =====
function forceLoop() {
    if (!settings.autoLoop) return;

    const v = getVideo();
    if (!v) return;

    // Force loop by checking if video ended and restarting
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

    // Remove Shorts
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

    // Remove Sidebar
    if (settings.removeSidebar) {
        css += `
            #secondary, 
            ytd-watch-next-secondary-results-renderer,
            .ytd-watch-flexy #secondary { display: none !important; }
            #primary { max-width: 100% !important; }
        `;
    }

    // Custom YouTube styling
    css += `
        /* Custom dark theme */
        .dark-theme-custom {
            --yt-spec-brand-background-primary: #0f0f0f !important;
            --yt-spec-app-background: #0f0f0f !important;
            --yt-spec-general-background-a: #0f0f0f !important;
            --yt-spec-general-background-b: #1a1a1a !important;
        }
        
        /* Hide promotional banners */
        .ytd-promoted-video-renderer,
        .ytd-banner-promo-renderer { display: none !important; }
        
        /* Cleaner video player */
        .ytp-chrome-bottom { opacity: 0.8 !important; }
        
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 8px !important; }
        ::-webkit-scrollbar-track { background: #1a1a1a !important; }
        ::-webkit-scrollbar-thumb { background: #555 !important; border-radius: 4px !important; }
        
        /* Remove suggested video overlay */
        .ytp-endscreen-content { display: none !important; }
        
        /* Darker recommendations */
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
    
    // Also apply loop setting
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
    // Check if body exists, if not wait
    if(!document.body){
        requestAnimationFrame(init);
        return;
    }

    document.body.appendChild(panel);
    panel.style.display = settings.autoShow ? "block" : "none";
    applyWallpaper();
    applyTheme(settings.theme);
    initEventListeners();
    initVideoDetection();
    
    // Initialize video info if enabled
    if (settings.showVideoInfo) {
        setTimeout(() => {
            const v = getVideo();
            if (v) {
                videoInfoInterval = setInterval(updateVideoInfo, 1000);
            }
        }, 1000);
    }

    // Initialize custom UI if enabled
    if (settings.customUI) {
        setTimeout(applyCustomUI, 1000);
    }
    
    console.log("Video Control Panel PRO initialized");
    addSmoothTransitions();
}

// ===== SMOOTH TRANSITIONS =====
function addSmoothTransitions(){
    // Thêm transition cho tất cả các input elements
    const inputs = panel.querySelectorAll('input[type="number"], input[type="text"], input[type="range"]');
    inputs.forEach(input => {
        input.style.transition = 'all 0.2s ease';
    });
    
    // Thêm transition cho tất cả các buttons
    const buttons = panel.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.style.transition = 'all 0.2s ease';
    });
    
    // Thêm transition cho panel
    panel.style.transition = 'opacity 0.2s ease, background 0.3s ease, transform 0.2s ease';
}

// ===== INPUT =====
const volumeInput = panel.querySelector("#volume");
const speedInput = panel.querySelector("#speed");

updateVolumeInput();
speedInput.value = settings.speed;

function updateVolumeInput(){
    volumeInput.value = settings.volume;
    volumeInput.classList.toggle("booster", settings.volume > 1);
    // FIX: Thêm logging để debug
    console.log("Volume input updated:", settings.volume);
}

volumeInput.onchange = () => {
    settings.volume = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    GM_setValue("settings", settings);
    updateVolumeInput();
    applyVideo();
    // FIX: Thêm logging để debug
    console.log("Volume changed:", settings.volume);
};

let volumeInputTimeout = null;
volumeInput.oninput = () => {
    // Live preview with debouncing
    const val = clamp(parseFloat(volumeInput.value) || 0, 0, 5);
    volumeInput.classList.toggle("booster", val > 1);
    
    // FIX: Debounce để tránh gọi quá频繁
    if(volumeInputTimeout) clearTimeout(volumeInputTimeout);
    volumeInputTimeout = setTimeout(() => {
        applyVideoToVolume(val);
    }, 50);
};

speedInput.onchange = () => {
    settings.speed = clamp(parseFloat(speedInput.value) || 1, 0.1, 16);
    GM_setValue("settings", settings);
    applyVideo();
    // FIX: Thêm logging để debug
    console.log("Speed changed:", settings.speed);
};

function applyVideoToVolume(vol) {
    const v = getVideo();
    if(!v) return;
    
    const audioData = getOrCreateGainNode(v);
    
    if(vol <= 1){
        // FIX: Smooth volume transition
        requestAnimationFrame(() => {
            v.volume = vol;
        });
        if(audioData && audioData.gain) {
            // FIX: Smooth gain transition
            smoothGainTransition(audioData.gain, 1);
        }
    } else {
        // FIX: Smooth volume transition
        requestAnimationFrame(() => {
            v.volume = 1;
        });
        if(audioData && audioData.gain) {
            // FIX: Smooth gain transition
            smoothGainTransition(audioData.gain, vol);
        } else {
            // Fallback: nếu không có audio boost, chỉ set volume = 1
            console.warn("Audio boost not available, volume limited to 1x");
        }
    }
    // FIX: Thêm logging để debug
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

// ===== AUTO =====
panel.querySelector("#autoShow").checked = settings.autoShow;
panel.querySelector("#autoVideo").checked = settings.autoVideo;

panel.querySelector("#autoShow").onchange = e => {
    settings.autoShow = e.target.checked;
    GM_setValue("settings", settings);
    // FIX: Thêm logging để debug
    console.log("Auto show:", settings.autoShow);
};

panel.querySelector("#autoVideo").onchange = e => {
    settings.autoVideo = e.target.checked;
    GM_setValue("settings", settings);
    console.log("Auto video:", settings.autoVideo);
};

const autoResumeCheckbox = document.getElementById("autoResume");
if (autoResumeCheckbox) {
    autoResumeCheckbox.checked = settings.autoResume !== false;
    autoResumeCheckbox.onchange = e => {
        settings.autoResume = e.target.checked;
        GM_setValue("settings", settings);
        console.log("Auto resume:", settings.autoResume);
    };
}

// ===== VIDEO INFO & CUSTOM UI SETTINGS =====
const showVideoInfoCheckbox = document.getElementById("showVideoInfo");
const autoSkipAdCheckbox = document.getElementById("autoSkipAd");
const customUICheckbox = document.getElementById("customUI");
const removeShortsCheckbox = document.getElementById("removeShorts");
const removeSidebarCheckbox = document.getElementById("removeSidebar");

if (showVideoInfoCheckbox) {
    showVideoInfoCheckbox.checked = settings.showVideoInfo !== false;
    showVideoInfoCheckbox.onchange = e => {
        settings.showVideoInfo = e.target.checked;
        GM_setValue("settings", settings);
        if (!settings.showVideoInfo && videoInfoElement) {
            videoInfoElement.remove();
            videoInfoElement = null;
        }
        console.log("Show video info:", settings.showVideoInfo);
    };
}

if (autoSkipAdCheckbox) {
    autoSkipAdCheckbox.checked = settings.autoSkipAd !== false;
    autoSkipAdCheckbox.onchange = e => {
        settings.autoSkipAd = e.target.checked;
        GM_setValue("settings", settings);
        console.log("Auto skip ad:", settings.autoSkipAd);
    };
}

const autoLoopCheckbox = document.getElementById("autoLoop");
if (autoLoopCheckbox) {
    autoLoopCheckbox.checked = settings.autoLoop !== false;
    autoLoopCheckbox.onchange = e => {
        settings.autoLoop = e.target.checked;
        GM_setValue("settings", settings);
        
        // Apply loop immediately to current video
        const v = getVideo();
        if (v) {
            v.loop = settings.autoLoop;
        }
        console.log("Auto loop:", settings.autoLoop);
    };
}

if (customUICheckbox) {
    customUICheckbox.checked = settings.customUI || false;
    customUICheckbox.onchange = e => {
        settings.customUI = e.target.checked;
        GM_setValue("settings", settings);
        applyCustomUI();
        console.log("Custom UI:", settings.customUI);
    };
}

if (removeShortsCheckbox) {
    removeShortsCheckbox.checked = settings.removeShorts || false;
    removeShortsCheckbox.onchange = e => {
        settings.removeShorts = e.target.checked;
        GM_setValue("settings", settings);
        applyCustomUI();
    };
}

if (removeSidebarCheckbox) {
    removeSidebarCheckbox.checked = settings.removeSidebar || false;
    removeSidebarCheckbox.onchange = e => {
        settings.removeSidebar = e.target.checked;
        GM_setValue("settings", settings);
        applyCustomUI();
    };
}

// ===== WALL =====
const wallInput = panel.querySelector("#wall");
wallInput.value = settings.wallpaper || "";

wallInput.onchange = () => {
    settings.wallpaper = wallInput.value.trim();
    GM_setValue("settings", settings);
    applyWallpaper();
};

// ===== COLOR =====
const colorInput = panel.querySelector("#color");
colorInput.value = settings.color;

colorInput.oninput = () => {
    settings.color = colorInput.value;
    document.documentElement.style.setProperty("--panel-bg", settings.color);
};

colorInput.onchange = () => {
    GM_setValue("settings", settings);
    console.log("Color changed:", settings.color);
};

// ===== PANEL SIZE & POSITION =====
const panelWidthInput = document.getElementById("panelWidth");
const panelHeightInput = document.getElementById("panelHeight");
const autoFillCheckbox = document.getElementById("autoFill");
const posXInput = document.getElementById("posX");
const posYInput = document.getElementById("posY");

panelWidthInput.value = parseInt(panel.style.width) || 260;
panelHeightInput.value = parseInt(panel.style.height) || 200;
posXInput.value = settings.posX || 60;
posYInput.value = settings.posY || 60;

panelWidthInput.onchange = () => {
    const w = parseInt(panelWidthInput.value) || 260;
    panel.style.width = w + "px";
    console.log("Panel width:", w);
};

panelHeightInput.onchange = () => {
    const h = parseInt(panelHeightInput.value) || 200;
    panel.style.height = h + "px";
    console.log("Panel height:", h);
};

autoFillCheckbox.onchange = () => {
    if (autoFillCheckbox.checked) {
        panel.style.width = "100%";
        panel.style.height = "auto";
        panel.style.maxWidth = "none";
        panel.style.maxHeight = "none";
        panel.style.top = "10px";
        panel.style.left = "10px";
        panel.style.right = "10px";
    } else {
        panel.style.width = panelWidthInput.value + "px";
        panel.style.height = panelHeightInput.value + "px";
        panel.style.top = (posYInput.value || 60) + "px";
        panel.style.left = (posXInput.value || 60) + "px";
        panel.style.right = "auto";
        panel.style.maxWidth = "none";
        panel.style.maxHeight = "none";
    }
    console.log("Auto-fill:", autoFillCheckbox.checked);
};

posXInput.onchange = () => {
    settings.posX = parseInt(posXInput.value) || 60;
    if (!autoFillCheckbox.checked) {
        panel.style.left = settings.posX + "px";
    }
    GM_setValue("settings", settings);
};

posYInput.onchange = () => {
    settings.posY = parseInt(posYInput.value) || 60;
    if (!autoFillCheckbox.checked) {
        panel.style.top = settings.posY + "px";
    }
    GM_setValue("settings", settings);
};

// ===== THEME TOGGLE =====
const themeToggle = panel.querySelector("#themeToggle");
const themes = ["auto", "light", "dark"];
let currentThemeIndex = themes.indexOf(settings.theme);
if (currentThemeIndex === -1) currentThemeIndex = 0;

function updateThemeIcon() {
    const icons = { auto: "🌓", light: "☀️", dark: "🌙" };
    themeToggle.textContent = icons[settings.theme] || "🌓";
    // FIX: Thêm logging để debug
    console.log("Theme icon updated:", settings.theme);
}

themeToggle.onclick = () => {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    settings.theme = themes[currentThemeIndex];
    GM_setValue("settings", settings);
    applyTheme(settings.theme);
    updateThemeIcon();
    // FIX: Thêm logging để debug
    console.log("Theme changed:", settings.theme);
};

// Apply theme on load
applyTheme(settings.theme);
updateThemeIcon();

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "auto") {
        applyTheme("auto");
    }
});

// ===== OPACITY SLIDER =====
const opacitySlider = panel.querySelector("#opacitySlider");
const opacityValue = panel.querySelector("#opacityValue");

opacitySlider.oninput = () => {
    settings.opacity = parseFloat(opacitySlider.value);
    panel.style.opacity = settings.opacity;
    opacityValue.textContent = Math.round(settings.opacity * 100) + "%";
};

opacitySlider.onchange = () => {
    GM_setValue("settings", settings);
    // FIX: Thêm logging để debug
    console.log("Opacity changed:", settings.opacity);
};

// ===== COMPACT MODE =====
const compactModeCheckbox = panel.querySelector("#compactMode");
compactModeCheckbox.checked = settings.compactMode;

function applyCompactMode() {
    if (settings.compactMode) {
        panel.classList.add("compact-mode");
    } else {
        panel.classList.remove("compact-mode");
    }
    // FIX: Thêm logging để debug
    console.log("Compact mode applied:", settings.compactMode);
}

compactModeCheckbox.onchange = () => {
    settings.compactMode = compactModeCheckbox.checked;
    GM_setValue("settings", settings);
    applyCompactMode();
    // FIX: Thêm logging để debug
    console.log("Compact mode:", settings.compactMode);
};

// Apply compact mode on load
applyCompactMode();

// ===== AUTO RESUME TOGGLE =====
const pauseToggleBtn = panel.querySelector("#pauseToggle");
pauseToggleBtn.textContent = settings.autoResume ? "⏸ Auto" : "▶ Auto";
if(!settings.autoResume) pauseToggleBtn.classList.add("auto-disabled");

pauseToggleBtn.onclick = () => {
    settings.autoResume = !settings.autoResume;
    GM_setValue("settings", settings);
    pauseToggleBtn.textContent = settings.autoResume ? "⏸ Auto" : "▶ Auto";
    pauseToggleBtn.classList.toggle("auto-disabled", !settings.autoResume);
    console.log("Auto resume:", settings.autoResume);
};

// ===== UPDATE SETTINGS =====
const updateIntervalSelect = panel.querySelector("#updateInterval");
const autoNotifyCheckbox = panel.querySelector("#autoNotify");
const notifyDurationInput = panel.querySelector("#notifyDuration");

// Set initial values
updateIntervalSelect.value = settings.updateCheckInterval || 24;
autoNotifyCheckbox.checked = settings.autoShowNotification !== false;
notifyDurationInput.value = settings.notificationDuration || 10;

updateIntervalSelect.onchange = () => {
    settings.updateCheckInterval = parseInt(updateIntervalSelect.value);
    GM_setValue("settings", settings);
    console.log("Update check interval changed:", settings.updateCheckInterval, "hours");
};

autoNotifyCheckbox.onchange = () => {
    settings.autoShowNotification = autoNotifyCheckbox.checked;
    GM_setValue("settings", settings);
    console.log("Auto show notification:", settings.autoShowNotification);
};

notifyDurationInput.onchange = () => {
    settings.notificationDuration = clamp(parseInt(notifyDurationInput.value) || 10, 0, 60);
    notifyDurationInput.value = settings.notificationDuration;
    GM_setValue("settings", settings);
    console.log("Notification duration changed:", settings.notificationDuration, "seconds");
};

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
            // FIX: Thêm logging để debug
            console.log("Capturing hotkey for:", a.key);
        };

        reset.onclick = () => {
            delete settings.hotkeys[a.key];
            GM_setValue("settings", settings);
            renderHotkeys();
            // FIX: Thêm logging để debug
            console.log("Hotkey reset for:", a.key);
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
        // FIX: Thêm logging để debug
        console.log("All hotkeys reset");
    };

    hkDiv.appendChild(document.createElement("br"));
    hkDiv.appendChild(resetAll);
}

renderHotkeys();

// ===== KEYBOARD =====
document.addEventListener("keydown", e => {

    // FIX: Bỏ qua nếu đang capture và phím là modifier
    if(capturingKey){
        // Chỉ accept non-modifier keys
        if(e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta"){
            e.preventDefault();
            return;
        }

        e.preventDefault();

        // Nếu không có modifier nào được nhấn cùng, vẫn cho phép
        const hk = {
            key: e.key.length === 1 ? e.key.toUpperCase() : e.key,
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey
        };

        // Kiểm tra trùng lặp
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
        // FIX: Thêm logging để debug
        console.log("Hotkey set:", capturingKey, hk);
        return;
    }

    // Xử lý hotkey đã set
    for(let k in settings.hotkeys){
        const hk = settings.hotkeys[k];
        if(!hk || !hk.key) continue;

        if(
            normalizeKey(e.key) === normalizeKey(hk.key) &&
            e.ctrlKey === !!hk.ctrl &&
            e.altKey === !!hk.alt &&
            e.shiftKey === !!hk.shift
        ){
            // Không trigger nếu đang type trong input
            if(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"){
                continue;
            }
            handle(k);
        }
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
            // FIX: Smooth toggle animation
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
            // FIX: Thêm logging để debug
            console.log("Speed up:", settings.speed);
            break;
        case "speedDown": 
            settings.speed = clamp(settings.speed - 0.1, 0.1, 16); 
            // FIX: Thêm logging để debug
            console.log("Speed down:", settings.speed);
            break;
        case "volUp": 
            settings.volume = clamp(settings.volume + 0.1, 0, 5); 
            // FIX: Thêm logging để debug
            console.log("Volume up:", settings.volume);
            break;
        case "volDown": 
            settings.volume = clamp(settings.volume - 0.1, 0, 5); 
            // FIX: Thêm logging để debug
            console.log("Volume down:", settings.volume);
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
            if (!settings.showVideoInfo) {
                if (videoInfoElement) {
                    videoInfoElement.remove();
                    videoInfoElement = null;
                }
                if (videoInfoInterval) {
                    clearInterval(videoInfoInterval);
                    videoInfoInterval = null;
                }
            } else {
                // Re-initialize video info
                updateVideoInfo();
                const v = getVideo();
                if (v) {
                    videoInfoInterval = setInterval(updateVideoInfo, 1000);
                }
            }
            GM_setValue("settings", settings);
            console.log("Toggle video info:", settings.showVideoInfo);
            return; // Don't call applyVideo() for toggle

        case "toggleCustomUI":
            settings.customUI = !settings.customUI;
            applyCustomUI();
            GM_setValue("settings", settings);
            console.log("Toggle custom UI:", settings.customUI);
            return; // Don't call applyVideo() for toggle

        case "toggleLoop":
            settings.autoLoop = !settings.autoLoop;
            const v = getVideo();
            if (v) v.loop = settings.autoLoop;
            GM_setValue("settings", settings);
            console.log("Toggle loop:", settings.autoLoop);
            return;
    }

    // Only call applyVideo and update inputs for non-toggle actions
    GM_setValue("settings", settings);
    applyVideo();
    
    // Update inputs
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
    // Không drag nếu click vào button
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
        // Update position inputs
        if (posXInput) posXInput.value = newLeft;
        if (posYInput) posYInput.value = newTop;
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
        console.log("Panel position saved:", settings.posX, settings.posY);
    }
    isDragging = false;
});

// ===== LOCK =====
panel.querySelector("#lock").onclick = function(){
    isLocked = !isLocked;
    this.textContent = isLocked ? "🔒" : "🔓";
    header.style.cursor = isLocked ? "default" : "move";
    console.log("Panel locked:", isLocked);
};

panel.querySelector("#min").onclick = () => {
    control.style.display =
        control.style.display === "none" ? "block" : "none";
    console.log("Panel minimized:", control.style.display === "none");
};

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

    if(v !== lastVideo){
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
            
            // Apply loop setting to new video
            v.loop = settings.autoLoop;
            
            // Start video info update interval
            if (videoInfoInterval) clearInterval(videoInfoInterval);
            if (settings.showVideoInfo) {
                videoInfoInterval = setInterval(updateVideoInfo, 1000);
            }
            
            if(v.readyState >= 2){
                applyVideo();
            }
        }
    }
}

function initVideoDetection(){
    // FIX: Thêm play event
    document.addEventListener("play", e => {
        if(e.target.tagName === "VIDEO"){
            detectVideoOnce();
        }
    }, true);

    // FIX: Thêm thêm events để detect video tốt hơn
    document.addEventListener("playing", e => {
        if(e.target.tagName === "VIDEO"){
            detectVideoOnce();
        }
    }, true);
    
    document.addEventListener("loadeddata", e => {
        if(e.target.tagName === "VIDEO"){
            detectVideoOnce();
        }
    }, true);
    
    // FIX: Thêm thêm events để detect video source changes
    document.addEventListener("loadstart", e => {
        if(e.target.tagName === "VIDEO"){
            console.log("Video loadstart detected");
            detectVideoOnce();
        }
    }, true);
    
    document.addEventListener("durationchange", e => {
        if(e.target.tagName === "VIDEO"){
            console.log("Video durationchange detected");
            detectVideoOnce();
        }
    }, true);

    // FIX: Optimized MutationObserver - observe cả addedNodes và attributes
    if(observer) observer.disconnect();
    
    observer = new MutationObserver(mutations => {
        let shouldCheck = false;
        for(const mut of mutations){
            // Check added nodes
            if(mut.addedNodes.length > 0){
                for(const node of mut.addedNodes){
                    if(node.nodeName === "VIDEO" || 
                       (node.querySelector && node.querySelector("video"))){
                        shouldCheck = true;
                        break;
                    }
                }
            }
            // Check attribute changes
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

    // Auto skip ad interval
    if (settings.autoSkipAd) {
        setInterval(skipAd, 1000);
    }

    // Force loop interval
    if (settings.autoLoop) {
        setInterval(forceLoop, 500);
    }
}

// ===== EVENT LISTENERS =====
function initEventListeners(){
    // Window resize - đảm bảo panel không bị mất
    window.addEventListener("resize", () => {
        panel.style.left = clamp(parseInt(panel.style.left) || 0, 0, window.innerWidth - 260) + "px";
        panel.style.top = clamp(parseInt(panel.style.top) || 0, 0, window.innerHeight - 120) + "px";
        // FIX: Thêm logging để debug
        console.log("Window resized, panel position adjusted");
    });
    
    // Cleanup khi page unload
    window.addEventListener("unload", () => {
        if(observer) observer.disconnect();
        if(lastVideo) cleanupAudioContext(lastVideo);
        if(videoInfoInterval) clearInterval(videoInfoInterval);
        console.log("Cleanup completed on page unload");
    });
}

// ===== START =====
init();

// FIX: Thêm version info để debug
console.log("Video Control Panel PRO v" + CURRENT_VERSION + " - Optimized with instant detection, volume boost, and error handling");

// Check for updates on startup
checkForUpdates();

// Check for conflicts with LITE version
setTimeout(checkConflict, 2000);

})();
