const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

let puppeteer = null;
try {
    puppeteer = require('puppeteer');
    console.log('Puppeteer loaded successfully');
} catch (error) {
    console.log('Puppeteer not available, using Cheerio only');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('./')); // 정적 파일 서빙

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/word.html');
});

// 문단 단위로 줄바꿈 함수 (문단 내 줄바꿈은 그대로 두고, 문단 구분만 \n\n)
function splitParagraphs(text) {
    if (!text) return '';
    return text
        .split(/\n{2,}/g)
        .map(p => p.trim())
        .filter(Boolean)
        .join('\n\n');
}

// URL에서 텍스트 추출하는 API 엔드포인트
app.post('/api/extract-text', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, error: '올바른 URL을 입력해주세요.' });
    }
    console.log(`[Server] 추출 요청: ${url}`);

    try {
        // 1. Cheerio를 사용한 모바일 페이지 우선 파싱
        const targetUrl = url.replace('blog.naver.com', 'm.blog.naver.com');
        console.log(`[Server] 모바일 URL로 요청: ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Mobile/15E148 Safari/604.1' },
            timeout: 15000
        });

        console.log(`[Server] HTTP 응답 상태: ${response.status}`);
        console.log(`[Server] 응답 데이터 길이: ${response.data.length}`);

        const { text, html } = extractNaverBlogContent(response.data);
        const paraText = splitParagraphs(text);

        if (paraText && paraText.length >= 50) {
            console.log('[Server] Cheerio 추출 성공');
            return res.json({ success: true, text: paraText, html });
        }

        // 2. Puppeteer가 사용 가능한 경우에만 재시도
        if (puppeteer) {
            console.log('[Server] Cheerio 추출 실패 또는 내용 부족. Puppeteer로 재시도.');
            const puppeteerText = await extractNaverBlogWithPuppeteer(url);
            const paraPuppeteerText = splitParagraphs(puppeteerText);
            if (paraPuppeteerText && paraPuppeteerText.length >= 50) {
                console.log('[Server] Puppeteer 추출 성공');
                const puppeteerHtml = paraPuppeteerText.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
                return res.json({ success: true, text: paraPuppeteerText, html: puppeteerHtml });
            }
        } else {
            console.log('[Server] Puppeteer not available, skipping fallback');
        }
        
        console.log('[Server] 모든 추출 방법 실패.');
        return res.status(400).json({ success: false, error: '내용을 추출할 수 없거나 너무 짧습니다.' });

    } catch (error) {
        console.error('[Server] 최초 추출 시도 중 오류 발생:', error.message);
        console.error('[Server] 오류 상세:', error);
        
        // 3. Puppeteer가 사용 가능한 경우에만 재시도
        if (puppeteer) {
            try {
                console.log('[Server] 오류로 인해 Puppeteer로 재시도.');
                const puppeteerText = await extractNaverBlogWithPuppeteer(url);
                const paraPuppeteerText = splitParagraphs(puppeteerText);
                if (paraPuppeteerText && paraPuppeteerText.length >= 50) {
                    console.log('[Server] Puppeteer 재시도 추출 성공');
                    const puppeteerHtml = paraPuppeteerText.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
                    return res.json({ success: true, text: paraPuppeteerText, html: puppeteerHtml });
                }
                console.log('[Server] Puppeteer 재시도 실패.');
            } catch (puppeteerError) {
                console.error('[Server] Puppeteer 재시도 중 오류 발생:', puppeteerError.message);
            }
        }
        
        res.status(500).json({ success: false, error: '서버에서 블로그 내용을 가져오는 데 실패했습니다.' });
    }
});

// Cheerio를 사용하여 네이버 블로그 텍스트/HTML 추출
function extractNaverBlogContent(html) {
    const $ = cheerio.load(html);
    let lines = [];
    // 1. 제목 추출 (있으면 맨 앞에)
    let title = $('.se-title-text, .tit_seblog').first().text().trim();
    if (title) lines.push(title);
    // 2. 본문 내 'hwaseon'이 포함된 이미지 src 추출 (있으면 두 번째 줄)
    let hwaseonImg = null;
    $('.se-main-container img, #postViewArea img, body img').each(function() {
        const $img = $(this);
        const src = $img.attr('data-lazy-src') || $img.attr('src') || '';
        if (src.includes('hwaseon')) {
            hwaseonImg = src;
            return false; // break
        }
    });
    if (hwaseonImg) lines.push(hwaseonImg);
    // 3. 본문 한 줄씩 추출 (span)
    $('.se-main-container span[class*="se-fs-fs"], #postViewArea span[class*="se-fs-fs"], body span[class*="se-fs-fs"]').each(function() {
        const txt = $(this).text().replace(/\r/g, '').trim();
        if (txt.length > 0) lines.push(txt);
    });
    // 만약 위에서 아무것도 안 나오면 기존 방식 fallback
    if (lines.length <= (title ? 1 : 0) + (hwaseonImg ? 1 : 0)) {
        $('.se-main-container .se-module-text, .se-main-container .se-text-paragraph').each(function() {
            const txt = $(this).text().trim();
            if (txt.length > 0 && !lines.includes(txt)) lines.push(txt);
        });
        if (lines.length <= (title ? 1 : 0) + (hwaseonImg ? 1 : 0)) {
            $('#postViewArea p, #postViewArea div').each(function() {
                const txt = $(this).text().trim();
                if (txt.length > 0 && !lines.includes(txt)) lines.push(txt);
            });
        }
        if (lines.length <= (title ? 1 : 0) + (hwaseonImg ? 1 : 0)) {
            $('body p, body div').each(function() {
                const txt = $(this).text().trim();
                if (txt.length > 0 && !lines.includes(txt)) lines.push(txt);
            });
        }
    }
    // 4. 해시태그 추출 (마지막 줄)
    let hashtags = [];
    // 네이버 최신 에디터
    $('.se-main-container .se-hash-tag, .se-hash-tag, .tag, .post_tag, .wrap_tag, .item_tag, .tag_item').find('a, span').each(function() {
        let tag = $(this).text().trim();
        if (tag.startsWith('#')) tag = tag.replace(/^#+/, '#');
        else if (tag.length > 0) tag = '#' + tag;
        if (tag.length > 1 && !hashtags.includes(tag)) hashtags.push(tag);
    });
    // 혹시 위에서 못 찾으면, 본문 내 #으로 시작하는 단어도 추가
    if (hashtags.length === 0) {
        const text = $.root().text();
        const matches = text.match(/#[\w가-힣]+/g);
        if (matches) {
            matches.forEach(tag => {
                if (!hashtags.includes(tag)) hashtags.push(tag);
            });
        }
    }
    if (hashtags.length > 0) lines.push(hashtags.join(' '));
    const text = lines.join('\n');
    if (text.length >= 50) {
        return { text };
    }
    return { text: '', html: '' };
}

// Puppeteer를 사용하여 네이버 블로그 텍스트 추출 (Fallback)
async function extractNaverBlogWithPuppeteer(url) {
    if (!puppeteer) {
        console.log('[Puppeteer] Puppeteer not available');
        return null;
    }
    console.log(`[Puppeteer] 추출 시작: ${url}`);
    let browser;
    try {
        const launchOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        };
        if (process.env.NODE_ENV === 'production') {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
        }
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        let mainFrame = page.mainFrame();
        const blogFrame = mainFrame.childFrames().find(frame => frame.name() === 'mainFrame');
        const targetFrame = blogFrame || mainFrame;
        const contentSelector = '.se-main-container, #postViewArea';
        await targetFrame.waitForSelector(contentSelector, { timeout: 10000 }).catch(() => {
            console.log('[Puppeteer] 특정 컨텐츠 영역을 찾을 수 없습니다.');
        });
        const extractedData = await targetFrame.evaluate(() => {
            let content = '';
            let firstImageFound = false;
            const titleEl = document.querySelector('.se-title-text, .tit_seblog');
            const title = titleEl ? titleEl.innerText.trim() : '';
            const noticeEl = document.querySelector('.se_textarea[data-testid="se-document-notice-text"], .se-module-text-notice');
            const notice = noticeEl ? noticeEl.innerText.trim() : '';
            const mainContainer = document.querySelector('.se-main-container');
            if (mainContainer) {
                const nodes = mainContainer.querySelectorAll('.se-module');
                nodes.forEach(node => {
                    if (node.classList.contains('se-module-text') && !node.classList.contains('se-module-text-notice')) {
                        const text = node.innerText.trim();
                        if (text) {
                            content += text + '\n\n';
                        }
                    } else if (node.classList.contains('se-module-image')) {
                        const img = node.querySelector('img');
                        if (img) {
                            const imgSrc = img.src || img.getAttribute('data-lazy-src');
                            if (imgSrc) {
                                if (!firstImageFound) {
                                    content += `${imgSrc}\n\n`;
                                    firstImageFound = true;
                                } else {
                                    content += `(사진)\n\n`;
                                }
                            }
                        }
                    }
                });
            } else {
                const postArea = document.querySelector('#postViewArea');
                if (postArea) content = postArea.innerText.trim();
            }
            const tags = new Set();
            document.querySelectorAll('.wrap_tag a, .post_tag a, .item_tag a, .tag_item a, a._rosRestrict, a.tag_log').forEach(tag => {
                let tagText = tag.innerText.trim();
                if (tagText.startsWith('#')) {
                    tagText = tagText.substring(1).trim();
                }
                if(tagText) tags.add('#' + tagText);
            });
            const tagString = Array.from(tags).join(' ');
            let fullText = '';
            if (title) fullText += title.trim() + '\n\n';
            if (notice) fullText += notice.trim() + '\n\n';
            if (content) fullText += content.trim() + '\n\n';
            if (tagString) fullText += tagString.trim() + '\n\n';
            return fullText.trim().replace(/\n{3,}/g, '\n\n');
        });
        console.log(`[Puppeteer] 추출된 텍스트 길이: ${extractedData.length}`);
        return extractedData;
    } catch (error) {
        console.error('[Puppeteer] 오류 발생:', error);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Puppeteer 사용 가능: ${puppeteer ? 'Yes' : 'No'}`);
});