const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static('./')); // 정적 파일 서빙

// 메인 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/word.html');
});

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
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Mobile/15E148 Safari/604.1' },
            timeout: 15000
        });

        const { text, html } = extractNaverBlogContent(response.data);

        if (text && text.length >= 50) {
            console.log('[Server] Cheerio 추출 성공');
            return res.json({ success: true, text, html });
        }

        // 2. Cheerio 추출 실패 시 Puppeteer로 재시도
        console.log('[Server] Cheerio 추출 실패 또는 내용 부족. Puppeteer로 재시도.');
        const puppeteerText = await extractNaverBlogWithPuppeteer(url);
        if (puppeteerText && puppeteerText.length >= 50) {
            console.log('[Server] Puppeteer 추출 성공');
            const puppeteerHtml = puppeteerText.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
            return res.json({ success: true, text: puppeteerText, html: puppeteerHtml });
        }
        
        console.log('[Server] 모든 추출 방법 실패.');
        return res.status(400).json({ success: false, error: '내용을 추출할 수 없거나 너무 짧습니다.' });

    } catch (error) {
        console.error('[Server] 최초 추출 시도 중 오류 발생:', error.message);
        
        // 3. 최초 시도(axios)에서 에러 발생 시 Puppeteer로 재시도
        try {
            console.log('[Server] 오류로 인해 Puppeteer로 재시도.');
            const puppeteerText = await extractNaverBlogWithPuppeteer(url);
            if (puppeteerText && puppeteerText.length >= 50) {
                console.log('[Server] Puppeteer 재시도 추출 성공');
                const puppeteerHtml = puppeteerText.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
                return res.json({ success: true, text: puppeteerText, html: puppeteerHtml });
            }
            console.log('[Server] Puppeteer 재시도 실패.');
            res.status(500).json({ success: false, error: '서버에서 블로그 내용을 가져오는 데 실패했습니다.' });
        } catch (puppeteerError) {
            console.error('[Server] Puppeteer 재시도 중 오류 발생:', puppeteerError.message);
            res.status(500).json({ success: false, error: '서버에서 블로그 내용을 가져오는 데 실패했습니다.' });
        }
    }
});

// HTML에서 텍스트 추출 함수
function extractTextFromHtml(html, url) {
    const $ = cheerio.load(html);
    
    // 불필요한 요소 제거
    $('script, style, nav, header, footer, aside, .header, .footer, .nav, .menu, .sidebar, .advertisement, .ad, .popup').remove();
    
    // 블로그별 주요 컨텐츠 선택자
    const contentSelectors = [
        // 네이버 블로그 (최신 에디터)
        '.se-main-container', '.se-module-text', '.se-text-paragraph', '.se-module',
        // 네이버 블로그 (구 에디터)
        '#postViewArea', '.post-view', '.post_ct', '.se-component',
        // 네이버 블로그 (스마트에디터 3.0)
        '.se-component-wrap', '.se-text', '.se-module-text p',
        // 티스토리
        '.entry-content', '.article', '.post-content',
        // 브런치
        '.wrap_body', '.text',
        // 벨로그
        '.atom-one', '.markdown-body',
        // 일반적인 선택자
        'article', '[role="main"]', '.content', '.post-content', 
        '.entry-content', '.post-body', '#content', 'main',
        '.post', '.article-content', '.story-body'
    ];
    
    let mainContent = null;
    
    // URL별 특별 처리
    if (url.includes('blog.naver.com')) {
        // 네이버 블로그 특별 처리
        const naverSelectors = [
            '.se-main-container',
            '#postViewArea', 
            '.post-view',
            '.se-component',
            '.se-module',
            '.post_ct',
            '.se-component-wrap'
        ];
        
        for (const selector of naverSelectors) {
            mainContent = $(selector).first();
            if (mainContent.length && mainContent.text().trim().length > 50) {
                console.log(`네이버 블로그 - 사용된 선택자: ${selector}`);
                break;
            }
        }
        
        // 여전히 내용이 부족하면 모든 텍스트 요소 수집
        if (!mainContent || mainContent.text().trim().length < 50) {
            const allTextElements = $('.se-module-text, .se-text-paragraph, .se-text, p, div').filter(function() {
                return $(this).text().trim().length > 10;
            });
            
            if (allTextElements.length > 0) {
                mainContent = $('<div>');
                allTextElements.each(function() {
                    const text = $(this).text().trim();
                    if (text.length > 10 && !text.match(/^[\s\n\r\t]*$/)) {
                        mainContent.append(`<p>${text}</p>`);
                    }
                });
                console.log(`네이버 블로그 - 텍스트 요소 수집: ${allTextElements.length}개`);
            }
        }
    } else if (url.includes('tistory.com')) {
        // 티스토리 특별 처리
        mainContent = $('.entry-content').first();
        if (!mainContent.length) {
            mainContent = $('.article').first();
        }
    } else {
        // 일반적인 컨텐츠 찾기
        for (const selector of contentSelectors) {
            mainContent = $(selector).first();
            if (mainContent.length && mainContent.text().trim().length > 100) {
                break;
            }
        }
    }
    
    // 메인 컨텐츠가 없으면 body 전체 사용
    if (!mainContent || !mainContent.length) {
        mainContent = $('body');
    }
    
    // 텍스트 추출
    let text = mainContent.text() || '';
    
    // 텍스트 정리
    text = text
        .replace(/\s+/g, ' ')  // 연속된 공백을 하나로
        .replace(/\n\s*\n/g, '\n')  // 연속된 줄바꿈 제거
        .replace(/[\t\r]/g, ' ')  // 탭과 캐리지 리턴을 공백으로
        .trim();
    
    // 너무 짧은 텍스트는 제외
    if (text.length < 100) {
        // p 태그들의 텍스트를 직접 추출
        const paragraphs = [];
        mainContent.find('p, div').each((i, el) => {
            const pText = $(el).text().trim();
            if (pText.length > 20 && !pText.match(/^[\s\n\r\t]*$/)) {
                paragraphs.push(pText);
            }
        });
        
        if (paragraphs.length > 0) {
            text = paragraphs.join('\n').trim();
        }
    }
    
    return text;
}

// 네이버 블로그 전용 텍스트 추출 함수 (Cheerio 기반)
function extractNaverBlogText(html, url) {
    const $ = cheerio.load(html);
    
    console.log('네이버 블로그 HTML 파싱 시작');
    
    // 불필요한 요소들을 먼저 제거
    $('script, style, nav, header, footer, .header, .footer, .nav, .menu, .sidebar, .advertisement, .ad, .popup, .comment, .date, .author, .profile, .btn, button, .share, .like, .follow, .subscribe').remove();
    
    let title = '';
    let content = '';
    
    // 1. 제목 추출
    const titleSelectors = [
        '.se-title-text',
        '.post-title', 
        '.title',
        'h1',
        '.se-module-text h1',
        '.se-text-paragraph h1'
    ];
    
    for (const selector of titleSelectors) {
        const titleElement = $(selector).first();
        if (titleElement.length > 0) {
            title = titleElement.text().trim();
            console.log(`제목 발견: ${title}`);
            break;
        }
    }
    
    // 2. 본문 내용 추출 (제목 제외)
    const contentSelectors = [
        '.se-main-container',
        '#postViewArea',
        '.post_ct',
        '.post-view',
        '.post-content'
    ];
    
    for (const selector of contentSelectors) {
        const container = $(selector).first();
        if (container.length > 0) {
            console.log(`본문 컨테이너 발견: ${selector}`);
            
            // 본문 HTML과 텍스트를 모두 추출
            const htmlContent = container.html();
            const textContent = container.text();
            
            return {
                text: textContent,
                html: htmlContent
            };
        }
    }
    
    // 컨테이너를 찾지 못한 경우, body 전체를 반환 (최후의 수단)
    console.log('주요 본문 컨테이너를 찾지 못함. body 전체를 사용합니다.');
    return {
        text: $('body').text(),
        html: $('body').html()
    };
}

// Puppeteer를 사용하여 네이버 블로그 텍스트 추출 (Fallback)
async function extractNaverBlogWithPuppeteer(url) {
    console.log(`[Puppeteer] 추출 시작: ${url}`);
    let browser;
    try {
        // OnRender 환경에 맞는 Puppeteer 설정
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

        // OnRender 환경에서는 추가 설정
        if (process.env.NODE_ENV === 'production') {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Lazy-loading 이미지 로드를 위해 페이지 아래로 스크롤
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
        
        // iframe 내부 컨텐츠 처리
        let mainFrame = page.mainFrame();
        const blogFrame = mainFrame.childFrames().find(frame => frame.name() === 'mainFrame');
        const targetFrame = blogFrame || mainFrame;

        // 특정 컨텐츠 영역이 로드될 때까지 대기
        const contentSelector = '.se-main-container, #postViewArea';
        await targetFrame.waitForSelector(contentSelector, { timeout: 10000 }).catch(() => {
            console.log('[Puppeteer] 특정 컨텐츠 영역을 찾을 수 없습니다.');
        });

        const extractedData = await targetFrame.evaluate(() => {
            let content = '';
            let firstImageFound = false;
            
            // 1. 제목 추출
            const titleEl = document.querySelector('.se-title-text, .tit_seblog');
            const title = titleEl ? titleEl.innerText.trim() : '';

            // 2. 광고/공지 문구 추출
            const noticeEl = document.querySelector('.se_textarea[data-testid="se-document-notice-text"], .se-module-text-notice');
            const notice = noticeEl ? noticeEl.innerText.trim() : '';
            
            // 3. 본문 내용 추출
            const mainContainer = document.querySelector('.se-main-container');
            if (mainContainer) {
                const nodes = mainContainer.querySelectorAll('.se-module');
                nodes.forEach(node => {
                    // 텍스트 모듈
                    if (node.classList.contains('se-module-text') && !node.classList.contains('se-module-text-notice')) {
                        const text = node.innerText.trim();
                        if (text) {
                            content += text + '\n\n';
                        }
                    }
                    // 이미지 모듈
                    else if (node.classList.contains('se-module-image')) {
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
                // 구버전 에디터용
                const postArea = document.querySelector('#postViewArea');
                if (postArea) content = postArea.innerText.trim();
            }

            // 4. 해시태그 추출
            const tags = new Set();
            document.querySelectorAll('.wrap_tag a, .post_tag a, .item_tag a, .tag_item a, a._rosRestrict, a.tag_log').forEach(tag => {
                let tagText = tag.innerText.trim();
                if (tagText.startsWith('#')) {
                    tagText = tagText.substring(1).trim();
                }
                if(tagText) tags.add('#' + tagText);
            });
            const tagString = Array.from(tags).join(' ');

            // 5. 전체 조합
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

// Cheerio를 사용하여 네이버 블로그 텍스트/HTML 추출
function extractNaverBlogContent(html) {
    const $ = cheerio.load(html);
    let content = '';
    let contentHtml = '';
    let firstImageFound = false;

    // 1. 제목 및 광고 문구 추출
    const title = $('.se-title-text, .tit_seblog').first().text().trim();
    const notice = $('.se_textarea[data-testid="se-document-notice-text"], .se-module-text-notice').first().text().trim();

    // 2. 본문 추출
    const mainContainer = $('.se-main-container');
    if (mainContainer.length > 0) {
        mainContainer.children('.se-module').each((i, module) => {
            const moduleElement = $(module);
            
            // 텍스트 모듈
            if (moduleElement.hasClass('se-module-text') && !moduleElement.find('.se-module-text-notice').length) {
                const text = moduleElement.text().trim();
                if (text) {
                    content += text + '\n\n';
                    contentHtml += `<p>${moduleElement.html()}</p>`;
                }
            } 
            // 이미지 모듈
            else if (moduleElement.hasClass('se-module-image')) {
                const img = moduleElement.find('img');
                const imgSrc = img.attr('data-lazy-src') || img.attr('src');
                if (imgSrc) {
                    if (!firstImageFound) {
                        content += `${imgSrc}\n\n`;
                        contentHtml += `<p><img src="${imgSrc}" alt="image from blog" style="max-width:100%;"></p>`;
                        firstImageFound = true;
                    } else {
                        content += `(사진)\n\n`;
                        // HTML 결과에는 모든 이미지를 보여주되, 텍스트 결과에만 (사진)으로 표시
                        contentHtml += `<p>(사진)</p>`; 
                    }
                }
            }
        });
    }

    // 3. 추출된 내용이 거의 없을 경우 fallback
    if (content.trim().length < 50) {
        console.log('[Cheerio] se-main-container에서 내용 추출 실패. 다른 선택자로 시도.');
        let fallbackContent = extractNaverBlogText(html);
        content = fallbackContent;
        contentHtml = content.replace(/\n/g, '<br>');
    }
    
    // 4. 해시태그 추출 (중복 제거)
    const tags = new Set();
    $('.wrap_tag a, .post_tag a, .item_tag a, .tag_item a, a._rosRestrict, a.tag_log').each((i, tag) => {
        let tagText = $(tag).text().trim();
        if (tagText.startsWith('#')) {
            tagText = tagText.substring(1).trim();
        }
        if (tagText) {
            tags.add('#' + tagText);
        }
    });
    const tagString = Array.from(tags).join(' ');

    // 5. 전체 조합
    let finalContent = '';
    let finalContentHtml = '';

    if (title) {
        finalContent += title + '\n\n';
        finalContentHtml += `<h3>${title}</h3>`;
    }
    if (notice) {
        finalContent += notice + '\n\n';
        finalContentHtml += `<p><em>${notice}</em></p>`;
    }
    
    const trimmedContent = content.trim();
    if (trimmedContent) {
        finalContent += trimmedContent + '\n\n';
        finalContentHtml += contentHtml;
    }
    
    const trimmedTagString = tagString.trim();
    if (trimmedTagString) {
        finalContent += trimmedTagString;
        finalContentHtml += `<br><p><strong>${trimmedTagString}</strong></p>`;
    }
    
    finalContent = finalContent.trim().replace(/\n{3,}/g, '\n\n');

    console.log(`[Cheerio] 최종 추출된 텍스트 길이: ${finalContent.length}`);
    return { text: finalContent, html: finalContentHtml.trim() };
}

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
});