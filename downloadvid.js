// ==UserScript==
// @name         Video/Audio Downloader LITE
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-start
// @description  Chỉ giữ lại nút tải Video/Audio (MP4/MP3) và Panel điều khiển đơn giản.
// ==/UserScript==

(function () {
    'use strict';

    let activeMedia = null;
    let panelVisible = false;
    const isYouTube = location.hostname.includes("youtube.com");

    // ===== UI & DOM MOUNTING =====
    const panel = document.createElement("div");
    panel.id = "vcp-panel";
    panel.innerHTML = `
        <div id="vcp-download">
            <button id="vcp-dl-mp4" title="Tải Video (MP4)">🎬 MP4</button>
            <button id="vcp-dl-mp3" title="Tải Audio (MP3)">🎵 MP3</button>
        </div>
        <button id="vcp-close">×</button>
    `;

    GM_addStyle(`
    #vcp-panel { position:fixed; bottom:20px; right:20px; padding:8px 12px; background:#1e1e1e; border-radius:20px; z-index:2147483647; font:13px Arial, sans-serif; color:#fff; box-shadow:0 4px 15px rgba(0,0,0,0.5); display:none; align-items:center; gap:10px; border: 1px solid #444; user-select: none; }
    #vcp-download { display:flex; gap:6px; }
    #vcp-download button { padding:5px 10px; border:none; border-radius:5px; background:#333; color:#fff; cursor:pointer; font-size:12px; }
    #vcp-download button:hover { background:#555; }
    #vcp-close { background:none; border:none; color:#fff; font-size:18px; cursor:pointer; line-height: 1; }
    `);

    function mountPanel() {
        const targetParent = document.fullscreenElement || document.body || document.documentElement;
        if (targetParent && !targetParent.contains(panel)) targetParent.appendChild(panel);
    }
    
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountPanel);
    else mountPanel();
    document.addEventListener("fullscreenchange", mountPanel);

    // ===== TẢI XUỐNG =====
    async function triggerDownload(isAudio) {
        if (!activeMedia) { alert("⚠️ Không tìm thấy video/audio nào đang phát!"); return; }
        
        const src = activeMedia.currentSrc || activeMedia.src;
        const pageUrl = window.location.href;

        // 1. YouTube & Blob
        if (isYouTube || (src && src.startsWith("blob:"))) {
            const mediaType = isAudio ? "Âm thanh (MP3)" : "Video (MP4)";
            if (confirm(`⚠️ Hệ thống phát hiện Video dạng luồng ẩn (Blob) hoặc YouTube.\n\nĐể tải ${mediaType} CHẤT LƯỢNG GỐC, script sẽ mở trình hỗ trợ bóc link (Cobalt). Bạn đồng ý chứ?`)) {
                window.open(`https://cobalt.tools/?u=${encodeURIComponent(pageUrl)}`, "_blank");
            }
            return;
        }

        // 2. Link trực tiếp
        if (!src) { alert("⚠️ Không lấy được liên kết nguồn!"); return; }

        let realFormat = src.toLowerCase().includes(".mp3") || src.toLowerCase().includes(".m4a") || src.toLowerCase().includes(".wav") ? "mp3" : "mp4";
        
        if (confirm(`❓ Tải tập tin này (Định dạng: .${realFormat}) không?`)) {
            try {
                const response = await fetch(src);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `media_${Date.now()}.${realFormat}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                window.open(src, "_blank");
            }
        }
    }

    panel.querySelector("#vcp-dl-mp4").onclick = () => triggerDownload(false);
    panel.querySelector("#vcp-dl-mp3").onclick = () => triggerDownload(true);
    panel.querySelector("#vcp-close").onclick = () => togglePanel(false);

    // ===== ĐIỀU KHIỂN & SỰ KIỆN =====
    function togglePanel(show = !panelVisible) {
        panelVisible = show;
        panel.style.display = show ? "flex" : "none";
    }

    document.addEventListener("play", (e) => {
        if (e.target && (e.target.tagName === "VIDEO" || e.target.tagName === "AUDIO")) {
            activeMedia = e.target;
            if (!panelVisible) togglePanel(true);
        }
    }, true);

    document.addEventListener("keydown", e => {
        if (e.key === "*" || e.key === "Escape") {
            if (e.key === "Escape" && !panelVisible) return;
            e.preventDefault();
            togglePanel();
        }
    });

    // Quét phát hiện Media liên tục
    setInterval(() => {
        if (!activeMedia || activeMedia.paused || !document.contains(activeMedia)) {
            const mediaList = document.querySelectorAll("video, audio");
            for (let m of mediaList) {
                if (m.readyState > 0 && !m.paused) {
                    activeMedia = m;
                    break;
                }
            }
        }
    }, 2000);
})();
