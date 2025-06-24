// 전역 변수
let originalContent = '';
let bloggerContent = '';
let originalHtmlContent = ''; // 원본 문서의 HTML을 저장할 변수
let bloggerHtmlContent = ''; // 블로거 원고의 HTML 저장

// DOM 로드 완료 후 실행
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
});

// 이벤트 리스너 초기화
function initializeEventListeners() {
    // 파일 업로드 이벤트 리스너
    document.getElementById('originalFile').addEventListener('change', function(e) {
        handleFileUpload(e, 'original');
    });

    document.getElementById('bloggerFile').addEventListener('change', function(e) {
        handleFileUpload(e, 'blogger');
    });

    // 토글 버튼 이벤트 리스너
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.dataset.type;
            
            // 버튼 상태 변경
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // 입력 컨테이너 표시/숨김
            document.getElementById('urlContainer').style.display = type === 'url' ? 'block' : 'none';
            document.getElementById('fileContainer').style.display = type === 'file' ? 'block' : 'none';
            
            // 정보 텍스트 업데이트
            const infoElement = document.getElementById('bloggerInfo');
            if (type === 'url') {
                infoElement.textContent = '블로그 URL을 입력해주세요';
            } else {
                infoElement.textContent = '파일을 선택해주세요';
            }
            
            // 기존 내용 초기화
            bloggerContent = '';
            bloggerHtmlContent = '';
            document.getElementById('compareBtn').disabled = true;
        });
    });

    // URL에서 텍스트 추출 버튼 이벤트
    document.getElementById('extractBtn').addEventListener('click', async function() {
        const url = document.getElementById('blogUrl').value.trim();
        const infoElement = document.getElementById('bloggerInfo');
        
        if (!url || !isValidUrl(url)) {
            infoElement.textContent = '올바른 URL 형식을 입력해주세요';
            return;
        }
        
        this.disabled = true;
        this.textContent = '추출 중...';
        infoElement.textContent = '웹페이지에서 텍스트를 추출하고 있습니다...';
        
        try {
            // extractTextFromUrl 함수는 이제 text와 html을 모두 내부적으로 처리합니다.
            const extractedText = await extractTextFromUrl(url);
            
            if (extractedText && extractedText.length > 50) {
                // bloggerContent와 bloggerHtmlContent는 extractTextFromUrl 함수 내에서 이미 설정되었습니다.
                infoElement.innerHTML = `
                    <strong>✅ 텍스트 추출 완료</strong><br>
                    추출된 텍스트: ${extractedText.length}자<br>
                    <small>${url}</small>
                `;
                
                // 미리보기 추가
                const previewDiv = document.createElement('div');
                previewDiv.className = 'preview-container';
                previewDiv.innerHTML = `
                    <strong>📄 추출된 텍스트 미리보기:</strong><br>
                    <div class="preview-content">${escapeHtml(extractedText.substring(0, 500))}${extractedText.length > 500 ? '...' : ''}</div>
                `;
                
                const existingPreview = document.querySelector('.preview-container');
                if (existingPreview) existingPreview.remove();
                infoElement.parentElement.appendChild(previewDiv);
                
                if (originalContent) {
                    document.getElementById('compareBtn').disabled = false;
                }
            } else {
                infoElement.textContent = '텍스트를 추출할 수 없습니다. URL을 확인해주세요.';
            }
        } catch (error) {
            console.error('텍스트 추출 오류:', error);
            infoElement.textContent = '텍스트 추출에 실패했습니다. 다른 URL을 시도해주세요.';
        }
        
        this.disabled = false;
        this.textContent = '텍스트 추출';
    });

    // 비교 버튼 클릭 이벤트
    document.getElementById('compareBtn').addEventListener('click', function() {
        if (originalContent && bloggerContent) {
            compareDocuments();
        }
    });

    // 비교 모드 토글 이벤트
    document.querySelectorAll('.comparison-mode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const mode = this.dataset.mode;
            
            // 버튼 상태 변경
            document.querySelectorAll('.comparison-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // 뷰 전환
            if (mode === 'side-by-side') {
                document.getElementById('documentComparison').style.display = 'grid';
                document.getElementById('summaryStats').style.display = 'none';
                document.getElementById('differencesList').style.display = 'none';
            } else {
                document.getElementById('documentComparison').style.display = 'none';
                document.getElementById('summaryStats').style.display = 'grid';
                document.getElementById('differencesList').style.display = 'block';
            }
        });
    });
}

// URL 유효성 검사
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// URL에서 텍스트 추출 함수 (서버 API 사용)
async function extractTextFromUrl(url) {
    try {
        const response = await fetch('/api/extract-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `서버 오류: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || '텍스트 추출에 실패했습니다.');
        }
        
        // 전역 변수에 텍스트와 HTML을 모두 저장
        bloggerContent = data.text;
        bloggerHtmlContent = data.html;
        
        return data.text; // 미리보기용 텍스트만 반환
        
    } catch (error) {
        console.error('API 호출 또는 파싱 실패:', error);
        throw error; // 에러를 상위로 전파
    }
}

// 파일 업로드 처리
async function handleFileUpload(event, type) {
    const file = event.target.files[0];
    const infoElement = document.getElementById(type + 'Info');
    
    if (!file) {
        infoElement.textContent = '파일을 선택해주세요';
        return;
    }

    infoElement.textContent = `선택된 파일: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    try {
        const arrayBuffer = await file.arrayBuffer();
        
        if (type === 'original') {
            // 1. 텍스트 추출 (비교용)
            const textResult = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
            originalContent = textResult.value.replace(/(\s*\n\s*){2,}/g, '\n\n').trim();

            // 2. 이미지를 포함한 HTML로 변환 (표시용)
            const imageOptions = {
                convertImage: mammoth.images.inline(function(element) {
                    return element.read("base64").then(function(imageBuffer) {
                        return {
                            src: "data:" + element.contentType + ";base64," + imageBuffer
                        };
                    });
                })
            };
            const htmlResult = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, imageOptions);
            originalHtmlContent = htmlResult.value;

        } else { // 블로거 파일
            const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
            bloggerContent = result.value.replace(/(\s*\n\s*){2,}/g, '\n\n').trim();
        }

        // 두 파일이 모두 준비되면 비교 버튼 활성화
        if ((originalContent || originalHtmlContent) && bloggerContent) {
            document.getElementById('compareBtn').disabled = false;
        }

    } catch (error) {
        console.error('파일 읽기 오류:', error);
        infoElement.textContent = '파일 읽기에 실패했습니다. 다시 시도해주세요.';
    }
}

// 문서 비교 함수
function compareDocuments() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';

    setTimeout(() => {
        // 단어 단위로 비교를 수행
        const { originalResult, bloggerResult, stats } = createWordDiff(originalContent, bloggerContent);
        
        // 뷰 설정 함수 호출
        setupComparisonViews(originalResult, bloggerResult);
        displaySummary(stats);
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('results').style.display = 'block';
        // 기본으로 나란히 보기 모드를 활성화
        document.querySelector('.comparison-mode-btn[data-mode="side-by-side"]').click();
    }, 500);
}

function createWordDiff(originalText, bloggerText) {
    // 정규식을 사용하여 단어, 공백, 구두점 등을 분리
    const splitRegex = /(\s+|[^\s\w]+|\w+)/g;
    const originalWords = originalText.match(splitRegex) || [];
    const bloggerWords = bloggerText.match(splitRegex) || [];

    const lcs = findLCS(originalWords, bloggerWords);

    let originalResult = [];
    let bloggerResult = [];
    let stats = {
        addedWords: 0,
        deletedWords: 0,
        sameWords: 0
    };

    let i = 0, j = 0;
    lcs.forEach(commonWord => {
        // 원본에서 다른 부분 (삭제)
        let originalDiff = [];
        while (i < originalWords.length && originalWords[i] !== commonWord) {
            originalDiff.push(originalWords[i]);
            i++;
        }
        if (originalDiff.length > 0) {
            originalResult.push({ type: 'deleted', content: originalDiff.join('') });
            stats.deletedWords += originalDiff.filter(w => w.trim() !== '').length;
        }

        // 블로거에서 다른 부분 (추가)
        let bloggerDiff = [];
        while (j < bloggerWords.length && bloggerWords[j] !== commonWord) {
            bloggerDiff.push(bloggerWords[j]);
            j++;
        }
        if (bloggerDiff.length > 0) {
            bloggerResult.push({ type: 'added', content: bloggerDiff.join('') });
            stats.addedWords += bloggerDiff.filter(w => w.trim() !== '').length;
        }

        // 공통 부분 (동일)
        if (commonWord.trim() !== '') {
           stats.sameWords++;
        }
        originalResult.push({ type: 'same', content: commonWord });
        bloggerResult.push({ type: 'same', content: commonWord });
        i++;
        j++;
    });

    // 남은 부분 처리
    let originalTail = originalWords.slice(i).join('');
    if (originalTail) {
        originalResult.push({ type: 'deleted', content: originalTail });
        stats.deletedWords += originalWords.slice(i).filter(w => w.trim() !== '').length;
    }

    let bloggerTail = bloggerWords.slice(j).join('');
    if (bloggerTail) {
        bloggerResult.push({ type: 'added', content: bloggerTail });
        stats.addedWords += bloggerWords.slice(j).filter(w => w.trim() !== '').length;
    }
    
    return { originalResult, bloggerResult, stats };
}

function findLCS(arr1, arr2) {
    const m = arr1.length;
    const n = arr2.length;
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (arr1[i - 1] === arr2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (arr1[i - 1] === arr2[j - 1]) {
            lcs.unshift(arr1[i - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    return lcs;
}

// 비교 뷰 설정 및 렌더링 함수
function setupComparisonViews(originalResult, bloggerResult) {
    const originalDiv = document.getElementById('originalDocument');
    const bloggerDiv = document.getElementById('bloggerDocument');

    function renderDiff(data) {
        return data.map(item => {
            const content = escapeHtml(item.content)
                // 여러 줄의 공백/줄바꿈을 하나의 단락 구분으로 통일
                .replace(/(\s*\n\s*){2,}/g, '<br><br>')
                .replace(/\n/g, '<br>');
            return `<span class="diff-${item.type}">${content}</span>`;
        }).join('');
    }

    originalDiv.innerHTML = renderDiff(originalResult);
    bloggerDiv.innerHTML = renderDiff(bloggerResult);
    
    // --- 뷰 전환기 관련 코드 완전 제거 ---
    const bloggerHeader = document.querySelector('#bloggerDocument').previousElementSibling;
    const toggleButton = bloggerHeader.querySelector('.view-toggle');
    if (toggleButton) {
        toggleButton.remove();
    }
}

function displaySummary(stats) {
    const summaryDiv = document.getElementById('summaryStats');
    const totalWords = stats.addedWords + stats.deletedWords + stats.sameWords;
    const similarity = totalWords > 0 ? (stats.sameWords / (stats.sameWords + stats.addedWords + stats.deletedWords)) * 100 : 100;

    summaryDiv.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">유사도</span>
            <span class="stat-value">${similarity.toFixed(1)}%</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">추가된 단어</span>
            <span class="stat-value added-text">${stats.addedWords}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">삭제된 단어</span>
            <span class="stat-value deleted-text">${stats.deletedWords}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">총 단어 수 (블로거)</span>
            <span class="stat-value">${stats.addedWords + stats.sameWords}</span>
        </div>
    `;
    
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// 텍스트 입력 모달 표시 함수
function showTextInputModal(callback) {
    const modal = document.getElementById('textInputModal');
    const textInput = document.getElementById('manualTextInput');
    const charCounter = document.getElementById('charCounter');
    const confirmBtn = document.getElementById('confirmText');
    const cancelBtn = document.getElementById('cancelModal');
    
    // 모달 표시
    modal.style.display = 'block';
    textInput.focus();
    
    // 글자 수 카운터 업데이트
    const updateCharCounter = () => {
        const length = textInput.value.trim().length;
        charCounter.textContent = `${length}자 ${length >= 50 ? '✅' : '(최소 50자 필요)'}`;
        charCounter.className = `char-counter ${length >= 50 ? 'valid' : 'invalid'}`;
        confirmBtn.disabled = length < 50;
    };
    
    // 이벤트 리스너 등록
    textInput.addEventListener('input', updateCharCounter);
    
    // 확인 버튼 클릭
    const handleConfirm = () => {
        const text = textInput.value.trim();
        if (text.length >= 50) {
            closeModal();
            callback(text);
        }
    };
    
    // 취소 버튼 클릭
    const handleCancel = () => {
        closeModal();
        callback(null);
    };
    
    // 모달 닫기
    const closeModal = () => {
        modal.style.display = 'none';
        textInput.value = '';
        textInput.removeEventListener('input', updateCharCounter);
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleModalClick);
        document.removeEventListener('keydown', handleEscKey);
    };
    
    // 모달 외부 클릭 시 닫기
    const handleModalClick = (e) => {
        if (e.target === modal) {
            handleCancel();
        }
    };
    
    // ESC 키로 닫기
    const handleEscKey = (e) => {
        if (e.key === 'Escape') {
            handleCancel();
        }
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleModalClick);
    document.addEventListener('keydown', handleEscKey);
    
    // 초기 상태 설정
    updateCharCounter();
}