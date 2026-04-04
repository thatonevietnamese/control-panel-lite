// ==UserScript==
// @name         youtube-adb
// @name:zh-CN   YouTube去广告
// @name:zh-TW   YouTube去廣告
// @name:zh-HK   YouTube去廣告
// @name:zh-MO   YouTube去廣告
// @namespace    https://github.com/iamfugui/youtube-adb
// @version      6.21
// @description         A script to remove YouTube ads, including static ads and video ads, without interfering with the network and ensuring safety.
// @description:zh-CN   脚本用于移除YouTube广告，包括静态广告和视频广告。不会干扰网络，安全。
// @description:zh-TW   腳本用於移除 YouTube 廣告，包括靜態廣告和視頻廣告。不會干擾網路，安全。
// @description:zh-HK   腳本用於移除 YouTube 廣告，包括靜態廣告和視頻廣告。不會干擾網路，安全。
// @description:zh-MO   腳本用於移除 YouTube 廣告，包括靜態廣告和視頻廣告。不會干擾網路，安全。
// @match        *://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @exclude      *://www.youtube.com/live_chat_replay*
// @exclude      *://www.youtube.com/persist_identity*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=YouTube.com
// @grant        none
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/459541/YouTube%E5%8E%BB%E5%B9%BF%E5%91%8A.user.js
// @updateURL https://update.greasyfork.org/scripts/459541/YouTube%E5%8E%BB%E5%B9%BF%E5%91%8A.meta.js
// ==/UserScript==

(function() {
    `use strict`;

    let video;
    //界面广告选择器
    const cssSelectorArr = [
        `#masthead-ad`,//首页顶部横幅广告.
        `ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer)`,//首页视频排版广告.
        `.video-ads.ytp-ad-module`,//播放器底部广告.
        `tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)`,//播放页会员促销广告.
        `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]`,//播放页右上方推荐广告.
        `#related #player-ads`,//播放页评论区右侧推广广告.
        `#related ytd-ad-slot-renderer`,//播放页评论区右侧视频排版广告.
        `ytd-ad-slot-renderer`,//搜索页广告.
        `yt-mealbar-promo-renderer`,//播放页会员推荐广告.
        `ytd-popup-container:has(a[href="/premium"])`,//会员拦截广告
        `ad-slot-renderer`,//M播放页第三方推荐广告
        `ytm-companion-ad-renderer`,//M可跳过的视频广告链接处
    ];
    window.dev=true;//开发使用 - Bật debug để xem logs

    /**
    * 将标准时间格式化
    * @param {Date} time 标准时间
    * @param {String} format 格式
    * @return {String}
    */
    function moment(time) {
        // 获取年⽉⽇时分秒
        let y = time.getFullYear()
        let m = (time.getMonth() + 1).toString().padStart(2, `0`)
        let d = time.getDate().toString().padStart(2, `0`)
        let h = time.getHours().toString().padStart(2, `0`)
        let min = time.getMinutes().toString().padStart(2, `0`)
        let s = time.getSeconds().toString().padStart(2, `0`)
        return `${y}-${m}-${d} ${h}:${min}:${s}`
    }

    /**
    * 输出信息
    * @param {String} msg 信息
    * @return {undefined}
    */
    function log(msg) {
        if(!window.dev){
            return false;
        }
        console.log(window.location.href);
        console.log(`${moment(new Date())}  ${msg}`);
    }

    /**
    * 设置运行标志
    * @param {String} name
    * @return {undefined}
    */
    function setRunFlag(name){
        let style = document.createElement(`style`);
        style.id = name;
        (document.head || document.body).appendChild(style);//将节点附加到HTML.
    }

    /**
    * 获取运行标志
    * @param {String} name
    * @return {undefined|Element}
    */
    function getRunFlag(name){
        return document.getElementById(name);
    }

    /**
    * 检查是否设置了运行标志
    * @param {String} name
    * @return {Boolean}
    */
    function checkRunFlag(name){
        if(getRunFlag(name)){
            return true;
        }else{
            setRunFlag(name)
            return false;
        }
    }

    /**
    * 生成去除广告的css元素style并附加到HTML节点上
    * @param {String} styles 样式文本
    * @return {undefined}
    */
    function generateRemoveADHTMLElement(id) {
        //如果已经设置过,退出.
        if (checkRunFlag(id)) {
            log(`屏蔽页面广告节点已生成`);
            return false
        }

        //设置移除广告样式.
        let style = document.createElement(`style`);//创建style元素.
        (document.head || document.body).appendChild(style);//将节点附加到HTML.
        style.appendChild(document.createTextNode(generateRemoveADCssText(cssSelectorArr)));//附加样式节点到元素节点.
        log(`生成屏蔽页面广告节点成功`);
    }

    /**
    * 生成去除广告的css文本
    * @param {Array} cssSelectorArr 待设置css选择器数组
    * @return {String}
    */
    function generateRemoveADCssText(cssSelectorArr){
        cssSelectorArr.forEach((selector,index)=>{
            cssSelectorArr[index]=`${selector}{display:none!important}`;//遍历并设置样式.
        });
        return cssSelectorArr.join(` `);//拼接成字符串.
    }

    /**
     * 检查 video có hợp lệ không
     * @param {HTMLVideoElement} v - Video element
     * @return {Boolean}
     */
    function isVideoValid(v) {
        return v && 
               typeof v.currentTime === 'number' && 
               typeof v.duration === 'number' && 
               !isNaN(v.duration) && 
               v.duration > 0 &&
               v.duration !== Infinity;
    }

    /**
     * 触摸事件 với error handling
     * @return {undefined}
     */
    function nativeTouch(){
        try {
            // 创建 Touch 对象
            let touch = new Touch({
                identifier: Date.now(),
                target: this,
                clientX: 12,
                clientY: 34,
                radiusX: 56,
                radiusY: 78,
                rotationAngle: 0,
                force: 1
            });

            // 创建 TouchEvent 对象
            let touchStartEvent = new TouchEvent(`touchstart`, {
                bubbles: true,
                cancelable: true,
                view: window,
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch]
            });

            // 分派 touchstart 事件到目标元素
            this.dispatchEvent(touchStartEvent);

            // 创建 TouchEvent 对象
            let touchEndEvent = new TouchEvent(`touchend`, {
                bubbles: true,
                cancelable: true,
                view: window,
                touches: [],
                targetTouches: [],
                changedTouches: [touch]
            });

            // 分派 touchend 事件到目标元素
            this.dispatchEvent(touchEndEvent);
            log('Native touch thành công');
        } catch(e) {
            console.error('Native touch lỗi:', e);
        }
    }


    /**
     * 获取dom với kiểm tra
     * @return {undefined}
     */
    function getVideoDom(){
        video = document.querySelector(`.ad-showing video`) || document.querySelector(`video.html5-main-video`) || document.querySelector(`video`);
        log(`getVideoDom: video = ${video ? 'tìm thấy' : 'không tìm thấy'}`);
    }


    /**
     * 自动播放 với error handling và kiểm tra
     * @return {undefined}
     */
    function playAfterAd(){
        try {
            // Lấy video mới nhất
            const currentVideo = document.querySelector('video.html5-main-video') || document.querySelector('video');
            if(!currentVideo){
                log('playAfterAd: không tìm thấy video');
                return;
            }
            
            // Chỉ play khi video hợp lệ và đang pause
            if(isVideoValid(currentVideo) && currentVideo.paused && currentVideo.currentTime < 1){
                currentVideo.play()
                    .then(() => log(`playAfterAd: auto play thành công, currentTime=${currentVideo.currentTime}`))
                    .catch(e => log(`playAfterAd: auto play lỗi - ${e.message}`));
            }else{
                log(`playAfterAd: bỏ qua - paused=${currentVideo.paused}, currentTime=${currentVideo.currentTime}, valid=${isVideoValid(currentVideo)}`);
            }
        } catch(e) {
            console.error('playAfterAd lỗi:', e);
        }
    }


    /**
     * 移除YT拦截广告拦截弹窗并且关闭关闭遮罩层 với cải thiện
     * @return {undefined}
     */
    function closeOverlay(){
        try {
            //移除YT拦截广告拦截弹窗
            const premiumContainers = [...document.querySelectorAll(`ytd-popup-container`)];
            const matchingContainers = premiumContainers.filter(container => container.querySelector(`a[href="/premium"]`));

            if(matchingContainers.length>0){
                matchingContainers.forEach(container => {
                    container.remove();
                    log(`Đã xóa premium popup`);
                });
            }

            // Xóa tất cả backdrop có zIndex cao
            const backdrops = document.querySelectorAll(`tp-yt-iron-overlay-backdrop`);
            let removedCount = 0;
            backdrops.forEach(backdrop => {
                // Xóa backdrop nếu đang mở hoặc có z-index cao
                if(backdrop.hasAttribute('opened') || parseInt(backdrop.style.zIndex) > 100){
                    backdrop.className = ``;
                    backdrop.removeAttribute(`opened`);
                    backdrop.remove();
                    removedCount++;
                }
            });
            if(removedCount > 0){
                log(`Đã xóa ${removedCount} backdrop`);
            }
        } catch(e) {
            console.error('closeOverlay lỗi:', e);
        }
    }


    /**
     * 跳过广告 với cải thiện và debug
     * @return {undefined}
     */
    function skipAd(mutationsList, observer) {
        try {
            // Lấy video element mới nhất
            const currentVideo = document.querySelector('.ad-showing video') || document.querySelector('video.html5-main-video') || document.querySelector('video');
            if (!currentVideo) {
                log('skipAd: Không tìm thấy video element');
                return;
            }
            
            // Cập nhật biến video toàn cục
            video = currentVideo;
            log(`skipAd: currentTime=${currentVideo.currentTime}, duration=${currentVideo.duration}, paused=${currentVideo.paused}`);

            const skipButton = document.querySelector(`.ytp-ad-skip-button`) || document.querySelector(`.ytp-skip-ad-button`) || document.querySelector(`.ytp-ad-skip-button-modern`);
            const shortAdMsg = document.querySelector(`.video-ads.ytp-ad-module .ytp-ad-player-overlay`) || document.querySelector(`.ytp-ad-button-icon`);

            const isMobile = window.location.href.includes('https://m.youtube.com/');
            
            if((skipButton || shortAdMsg) && !isMobile){ 
                // Chỉ mute khi video hợp lệ
                if(isVideoValid(video) && !video.muted){
                    video.muted = true;
                    log('Đã mute video khi có quảng cáo');
                }
            }

            if(skipButton){
                const delayTime = 0.5;
                
                // Kiểm tra video ready trước khi thao tác
                if(!isVideoValid(video)){
                    log('skipAd: Video không hợp lệ, bỏ qua');
                    return;
                }
                
                // Nếu video đang play và currentTime > delayTime, force skip
                if(video.currentTime > delayTime && video.duration > delayTime){
                    video.currentTime = video.duration;
                    log(`Force skip: currentTime=${video.currentTime}, duration=${video.duration}`);
                    return;
                }
                
                // Thử click skip button
                try {
                    skipButton.click();
                    log('Click skip button thành công');
                } catch(e) {
                    log(`Click skip button lỗi: ${e.message}`);
                    // Thử native touch cho mobile
                    try {
                        nativeTouch.call(skipButton);
                        log('Native touch skip thành công');
                    } catch(e2) {
                        log(`Native touch lỗi: ${e2.message}`);
                    }
                }
                
            }else if(shortAdMsg){
                // Force skip nhưng kiểm tra kỹ
                if(isVideoValid(video)){
                    const wasPaused = video.paused;
                    video.currentTime = video.duration;
                    log(`Force skip quảng cáo ngắn: duration=${video.duration}, wasPaused=${wasPaused}`);
                    
                    // Thử resume video nếu nó bị pause
                    if(wasPaused){
                        setTimeout(() => {
                            if(video.paused && isVideoValid(video)){
                                video.play().catch(e => log(`Resume sau force skip lỗi: ${e.message}`));
                            }
                        }, 100);
                    }
                }else{
                    log('shortAdMsg: Video không hợp lệ');
                }
            }
        } catch(e) {
            console.error('skipAd lỗi:', e);
        }
    }

    /**
     * 去除播放中的广告 với cải thiện và debug
     * @return {undefined}
     */
    function removePlayerAD(id){
        //如果已经在运行,退出.
        if (checkRunFlag(id)) {
            log(`去除播放中的广告功能已在运行`);
            return false
        }

        //监听视频中的广告并处理
        const targetNode = document.body;//直接监听body变动
        const config = {childList: true, subtree: true };// 监听目标节点本身与子树下节点的变动
        
        // Observer với error handling tốt hơn
        const observer = new MutationObserver((mutations) => {
            try {
                mutations.forEach(mutation => {
                    if(mutation.type === 'childList' && mutation.addedNodes.length > 0){
                        // Debug: log số lượng node được thêm
                        log(`MutationObserver: ${mutation.addedNodes.length} nodes added`);
                    }
                });
                getVideoDom();
                closeOverlay();
                skipAd();
                playAfterAd();
            } catch(e) {
                console.error('MutationObserver callback lỗi:', e);
            }
        });//处理视频广告相关
        
        observer.observe(targetNode, config);// 以上述配置开始观察广告节点
        log(`运行去除播放中的广告功能成功`);
    }

    /**
     * Resume video an toàn
     * @return {undefined}
     */
    function safeResumeVideo(){
        try {
            const videoelem = document.querySelector('video.html5-main-video') || document.querySelector('video');
            if (videoelem && isVideoValid(videoelem) && videoelem.paused) {
                videoelem.play()
                    .then(() => console.log('safeResumeVideo: Resume thành công'))
                    .catch(e => console.log('safeResumeVideo: Resume lỗi -', e.message));
            }
        } catch(e) {
            console.error('safeResumeVideo lỗi:', e);
        }
    }

    /**
     * Xóa popup với cải thiện
     * @param {Node} node 
     * @return {undefined}
     */
    function removePop(node) {
        try {
            // Kiểm tra node hợp lệ
            if(!node || node.nodeType !== 1) return;
            
            const elpopup = node.querySelector('.ytd-popup-container > .ytd-popup-container > .ytd-enforcement-message-view-model');

            if (elpopup) {
                elpopup.parentNode.remove();
                console.log('Đã xóa enforcement popup');
                const bdelems = document.getElementsByTagName('tp-yt-iron-overlay-backdrop');
                for (var x = (bdelems || []).length; x--;)
                    bdelems[x].remove();
                safeResumeVideo();
            }

            if (node.tagName && node.tagName.toLowerCase() === 'tp-yt-iron-overlay-backdrop') {
                node.remove();
                safeResumeVideo();
                console.log('Đã xóa backdrop');
            }
        } catch(e) {
            console.error('removePop lỗi:', e);
        }
    }

    /**
     * main函数 với cải thiện
     */
    function main(){
        log('=== YouTube ADB Script bắt đầu ===');
        generateRemoveADHTMLElement(`removeADHTMLElement`);//移除界面中的广告.
        removePlayerAD(`removePlayerAD`);//移除播放中的广告.
        log('=== YouTube ADB Script khởi tạo hoàn tất ===');
    }

    if (document.readyState === `loading`) {
        document.addEventListener(`DOMContentLoaded`, main);// 此时加载尚未完成
        log(`YouTube去广告脚本即将调用:`);
    } else {
        main();// 此时`DOMContentLoaded` 已经被触发
        log(`YouTube去广告脚本快速调用:`);
    }

    // Backup resume function với cải thiện
    let resumeVideo = () => {
        safeResumeVideo();
    };

    // Observer cho popup với cải thiện
    let obs = new MutationObserver(mutations => {
        try {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList' && mutation.addedNodes) {
                    Array.from(mutation.addedNodes)
                        .filter(node => node && node.nodeType === 1)
                        .map(node => removePop(node));
                }
            });
        } catch(e) {
            console.error('Popup Observer lỗi:', e);
        }
    });

    // have the observer observe foo for changes in children
    obs.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    log('Popup Observer đã bắt đầu');
})();