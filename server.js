const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
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
        // Cheerio를 사용한 텍스트 추출
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 15000
        });

        const { text, html } = extractBlogContent(response.data, url);

        if (text && text.length >= 50) {
            console.log('[Server] 텍스트 추출 성공');
            return res.json({ success: true, text, html });
        }
        
        console.log('[Server] 텍스트 추출 실패 - 내용이 너무 짧습니다.');
        return res.status(400).json({ 
            success: false, 
            error: '내용을 추출할 수 없거나 너무 짧습니다. 수동으로 텍스트를 복사해주세요.' 
        });

    } catch (error) {
        console.error('[Server] 텍스트 추출 중 오류 발생:', error.message);
        res.status(500).json({ 
            success: false, 
            error: '서버에서 블로그 내용을 가져오는 데 실패했습니다. 수동으로 텍스트를 복사해주세요.' 
        });
    }
});

// 블로그 컨텐츠 추출 함수
function extractBlogContent(html, url) {
    const $ = cheerio.load(html);
    let content = '';
    let contentHtml = '';

    // 불필요한 요소 제거
    $('script, style, nav, header, footer, aside, .header, .footer, .nav, .menu, .sidebar, .advertisement, .ad, .popup').remove();

    // URL별 특별 처리
    if (url.includes('blog.naver.com')) {
        // 네이버 블로그 처리
        const title = $('.se-title-text, .tit_seblog').first().text().trim();
        const notice = $('.se_textarea[data-testid="se-document-notice-text"], .se-module-text-notice').first().text().trim();
        
        // 본문 추출
        const mainContainer = $('.se-main-container');
        if (mainContainer.length > 0) {
            mainContainer.children('.se-module').each((i, module) => {
                const moduleElement = $(module);
                
                if (moduleElement.hasClass('se-module-text') && !moduleElement.find('.se-module-text-notice').length) {
                    const text = moduleElement.text().trim();
                    if (text) {
                        content += text + '\n\n';
                        contentHtml += `<p>${moduleElement.html()}</p>`;
                    }
                }
            });
        }

        // fallback: 다른 선택자들 시도
        if (content.trim().length < 50) {
            const fallbackSelectors = [
                '#postViewArea',
                '.post-view',
                '.se-component',
                '.post_ct',
                'article',
                '.content',
                '.post-content'
            ];
            
            for (const selector of fallbackSelectors) {
                const element = $(selector);
                if (element.length > 0) {
                    const text = element.text().trim();
                    if (text.length > 50) {
                        content = text;
                        contentHtml = element.html();
                        break;
                    }
                }
            }
        }

        // 해시태그 추출
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

        // 전체 조합
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
        
        if (tagString.trim()) {
            finalContent += tagString;
            finalContentHtml += `<br><p><strong>${tagString}</strong></p>`;
        }
        
        return { 
            text: finalContent.trim().replace(/\n{3,}/g, '\n\n'), 
            html: finalContentHtml.trim() 
        };

    } else if (url.includes('tistory.com')) {
        // 티스토리 처리
        const title = $('.titleWrap h2, .title').first().text().trim();
        const content = $('.entry-content, .article').first().text().trim();
        const contentHtml = $('.entry-content, .article').first().html();
        
        return { 
            text: `${title}\n\n${content}`.trim(), 
            html: `<h3>${title}</h3>${contentHtml}`.trim() 
        };

    } else {
        // 일반적인 블로그/웹사이트 처리
        const title = $('h1, .title, .post-title').first().text().trim();
        const content = $('article, .content, .post-content, .entry-content, main').first().text().trim();
        const contentHtml = $('article, .content, .post-content, .entry-content, main').first().html();
        
        return { 
            text: `${title}\n\n${content}`.trim(), 
            html: `<h3>${title}</h3>${contentHtml}`.trim() 
        };
    }
}

// 서버 시작
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log('Cheerio 기반 텍스트 추출 서버가 준비되었습니다.');
});