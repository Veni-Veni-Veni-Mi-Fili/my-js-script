// ==UserScript==
// @name         Bilibili 搜索结果一键提取器（Bilibili Search Data Extractor）
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在 Bilibili 搜索页面添加悬浮按钮，一键提取视频信息（标题、BV号、时长、UP主、播放量、弹幕数、日期等），自动清洗数据并导出 CSV
// @match        https://search.bilibili.com/*
// @grant        none
// @license      MIT
// @run-at       document-end
// @author       Max Linker with Kimi Code
// @downloadURL https://update.greasyfork.org/scripts/567829/Bilibili%20%E6%90%9C%E7%B4%A2%E7%BB%93%E6%9E%9C%E4%B8%80%E9%94%AE%E6%8F%90%E5%8F%96%E5%99%A8%EF%BC%88Bilibili%20Search%20Data%20Extractor%EF%BC%89.user.js
// @updateURL https://update.greasyfork.org/scripts/567829/Bilibili%20%E6%90%9C%E7%B4%A2%E7%BB%93%E6%9E%9C%E4%B8%80%E9%94%AE%E6%8F%90%E5%8F%96%E5%99%A8%EF%BC%88Bilibili%20Search%20Data%20Extractor%EF%BC%89.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // 样式注入（统一视觉语言）
    const style = document.createElement('style');
    style.textContent = `
        .bili-extract-btn {
            position: fixed;
            top: 100px;
            right: 30px;
            z-index: 999999;
            background: linear-gradient(135deg, #0366fe 0%, #0256d8 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 25px;
            font-family: "Microsoft YaHei", "Helvetica Neue", sans-serif;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(3, 102, 254, 0.4);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .bili-extract-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(3, 102, 254, 0.6);
        }
        .bili-extract-btn:active {
            transform: translateY(0);
        }
        .bili-extract-btn.success {
            background: linear-gradient(135deg, #15d173 0%, #0eb863 100%);
            box-shadow: 0 4px 15px rgba(21, 209, 115, 0.4);
        }
        .bili-extract-toast {
            position: fixed;
            top: 160px;
            right: 30px;
            z-index: 999999;
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 13px;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
            font-family: "Microsoft YaHei", sans-serif;
            max-width: 280px;
            line-height: 1.5;
        }
        .bili-extract-toast.show {
            opacity: 1;
        }
    `;
    document.head.appendChild(style);

    // 创建按钮
    const btn = document.createElement('button');
    btn.className = 'bili-extract-btn';
    btn.innerHTML = '📊 提取数据';
    document.body.appendChild(btn);

    // 提示框
    const toast = document.createElement('div');
    toast.className = 'bili-extract-toast';
    document.body.appendChild(toast);

    function showToast(msg, duration = 3000) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }

    // 工具函数：转换数值（万/亿转数字）
    function parseNumber(str) {
        if (!str) return 0;
        let num = parseFloat(str);
        if (str.includes('万')) num *= 10000;
        if (str.includes('亿')) num *= 100000000;
        return isNaN(num) ? 0 : num;
    }

    // 工具函数：处理日期（相对时间转绝对时间）
    function processDate(dateStr) {
        let now = new Date();
        let targetDate = new Date();
        
        dateStr = dateStr.replace(/·/g, '').trim();

        if (dateStr.includes('分钟前')) {
            let mins = parseInt(dateStr);
            targetDate.setMinutes(now.getMinutes() - mins);
        } else if (dateStr.includes('小时前')) {
            let hours = parseInt(dateStr);
            targetDate.setHours(now.getHours() - hours);
        } else if (dateStr.includes('昨天')) {
            targetDate.setDate(now.getDate() - 1);
        } else if (dateStr.includes('前天')) {
            targetDate.setDate(now.getDate() - 2);
        } else if (/^\d{1,2}-\d{1,2}$/.test(dateStr)) {
            let parts = dateStr.split('-');
            targetDate.setMonth(parseInt(parts[0]) - 1);
            targetDate.setDate(parseInt(parts[1]));
            // 跨年处理：如果结果日期在未来，则认为是去年
            if (targetDate > now) {
                targetDate.setFullYear(targetDate.getFullYear() - 1);
            }
        } else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) {
            return dateStr;
        } else {
            return dateStr;
        }

        let y = targetDate.getFullYear();
        let m = ('0' + (targetDate.getMonth() + 1)).slice(-2);
        let d = ('0' + targetDate.getDate()).slice(-2);
        return `${y}-${m}-${d}`;
    }

    // 工具函数：处理时长（HH:MM:SS → MM:SS）
    function processDuration(timeStr) {
        if (!timeStr) return "00:00";
        let parts = timeStr.split(':').map(Number);
        
        if (parts.length === 3) {
            let minutes = parts[0] * 60 + parts[1];
            let seconds = ('0' + parts[2]).slice(-2);
            return `${minutes}:${seconds}`;
        } else if (parts.length === 2) {
            return `${parts[0]}:${('0' + parts[1]).slice(-2)}`;
        }
        return timeStr;
    }

    // 主逻辑：提取数据
    function extractData() {
        let data = [];
        let cards = document.querySelectorAll('.bili-video-card');

        if (cards.length === 0) {
            showToast('⚠️ 未找到视频卡片！请确保页面已加载完成');
            return null;
        }

        cards.forEach((card) => {
            try {
                // 标题
                let titleEl = card.querySelector('h3');
                let title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText.trim()) : "无标题";

                // 链接与BV号
                let linkEl = card.querySelector('a');
                let link = linkEl ? linkEl.href : "";
                let bvid = (link.match(/(BV\w+)/) || ["", ""])[1];

                // UP主信息
                let authorEl = card.querySelector('.bili-video-card__info--author');
                let author = authorEl ? authorEl.innerText.trim() : "";
                let authorLink = authorEl ? authorEl.href : "";

                // 时长处理
                let durationRaw = card.querySelector('.bili-video-card__stats__duration')?.innerText.trim() || "00:00";
                let durationFormatted = processDuration(durationRaw);

                // 播放/弹幕数据
                let statsItems = card.querySelectorAll('.bili-video-card__stats--item');
                let viewRaw = statsItems[0]?.innerText.trim() || "0";
                let danmakuRaw = statsItems[1]?.innerText.trim() || "0";

                let viewNum = parseNumber(viewRaw);
                let viewK = (viewNum / 1000).toFixed(2);
                let viewW = (viewNum / 10000).toFixed(2);
                let danmakuNum = parseNumber(danmakuRaw);

                // 日期处理
                let dateEl = card.querySelector('.bili-video-card__info--date');
                let dateRaw = "";
                if (dateEl) {
                    dateRaw = dateEl.innerText.trim();
                } else {
                    let bottomText = card.querySelector('.bili-video-card__info--bottom')?.innerText || "";
                    let match = bottomText.match(/(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}|昨天|\d+小时前|\d+分钟前)/);
                    dateRaw = match ? match[0] : "";
                }
                let dateFinal = processDate(dateRaw);

                data.push({
                    "标题": title,
                    "BV号": bvid,
                    "完整链接": link,
                    "时长(MM:SS)": durationFormatted,
                    "UP主": author,
                    "UP主链接": authorLink,
                    "播放量(原数据)": viewRaw,
                    "播放量(k)": viewK,
                    "播放量(万)": viewW,
                    "弹幕数": danmakuNum,
                    "发布日期": dateFinal
                });

            } catch (e) {
                // 忽略单条错误，继续提取
            }
        });

        return data;
    }

    // 下载 CSV
    function downloadCSV(data) {
        let keys = Object.keys(data[0]);
        let csvContent = "\uFEFF" + keys.join(",") + "\n";

        data.forEach(row => {
            let rowStr = keys.map(k => {
                let val = row[k] ? String(row[k]) : "";
                val = val.replace(/"/g, '""');
                return `"${val}"`;
            }).join(",");
            csvContent += rowStr + "\n";
        });

        let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        let url = URL.createObjectURL(blob);
        let link = document.createElement("a");
        link.href = url;
        link.download = `B站数据_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // 按钮点击事件
    btn.addEventListener('click', function() {
        btn.innerHTML = '⏳ 提取中...';
        btn.style.opacity = '0.8';
        
        // 延迟执行以确保UI更新
        setTimeout(() => {
            const data = extractData();
            
            if (data && data.length > 0) {
                // 控制台预览
                console.clear();
                console.log("%c🚀 Bilibili 数据提取完成", "color: #0366fe; font-size: 16px; font-weight: bold;");
                console.table(data.slice(0, 5));
                
                // 下载文件
                downloadCSV(data);
                
                // UI反馈
                btn.innerHTML = '✅ 已下载';
                btn.classList.add('success');
                showToast(`成功提取 ${data.length} 条数据，CSV 文件已下载`);
                
                setTimeout(() => {
                    btn.innerHTML = '📊 提取数据';
                    btn.classList.remove('success');
                    btn.style.opacity = '1';
                }, 2000);
            } else {
                btn.innerHTML = '❌ 无数据';
                btn.style.background = '#ff3517';
                showToast('未找到可提取的视频数据，请检查页面');
                
                setTimeout(() => {
                    btn.innerHTML = '📊 提取数据';
                    btn.style.background = '';
                    btn.style.opacity = '1';
                }, 2000);
            }
        }, 100);
    });
})();