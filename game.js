// --- 状態管理 ---
let currentStage = 1;
const MAX_STAGE = 20;

// LocalStorageからハイスコアを読み込む。なければ0で埋めた配列を用意
let highestScores = JSON.parse(localStorage.getItem('samegame_highscores')) || new Array(MAX_STAGE).fill(0);
let stageScore = 0;

let boardData = [];
let rows = 0, cols = 0, colorsCount = 0;

// スコア保存関数
function saveHighScores() {
    localStorage.setItem('samegame_highscores', JSON.stringify(highestScores));
}

// --- オーディオ管理 ---
let bgmEnabled = false;
let seEnabled = false;
const bgmAudio = document.getElementById('audio-bgm');

// ブラウザの上限エラーを防ぐためContextは1つを使い回す
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

document.getElementById('btn-bgm').addEventListener('click', (e) => {
    bgmEnabled = !bgmEnabled;
    e.target.innerText = `BGM: ${bgmEnabled ? 'ON' : 'OFF'}`;
    if (bgmEnabled) bgmAudio.play().catch(console.error);
    else bgmAudio.pause();
});

document.getElementById('btn-se').addEventListener('click', (e) => {
    seEnabled = !seEnabled;
    e.target.innerText = `SE: ${seEnabled ? 'ON' : 'OFF'}`;
    if (seEnabled) getAudioCtx(); // ユーザー操作時にContextを初期化
});

// 通常の消去音（ポコッ）
function playSE() {
    if (!seEnabled) return;
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
}

// 10個以上消しの派手な音（ギュイーン！）
function playComboSE() {
    if (!seEnabled) return;
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
}

// クリア・全消しのファンファーレ
function playFanfareSE() {
    if (!seEnabled) return;
    const ctx = getAudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const times = [0, 0.15, 0.3, 0.45];
    const durations = [0.1, 0.1, 0.1, 0.6];

    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + times[i]);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + times[i]);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + times[i] + durations[i]);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + times[i]);
        osc.stop(ctx.currentTime + times[i] + durations[i]);
    });
}

// --- ステージ計算 ---
function calcStageParams(stage) {
    const cycle = Math.floor((stage - 1) / 4);
    const step = (stage - 1) % 4;
    return { r: 10 + (cycle * 2), c: 20 + (cycle * 4), colors: 4 + step };
}

function calcTotalScore() {
    return highestScores.reduce((a, b) => a + b, 0);
}

// --- 初期化 ---
function initStage(isRetry = false) {
    if (!isRetry) stageScore = 0;
    
    const params = calcStageParams(currentStage);
    rows = params.r;
    cols = params.c;
    colorsCount = params.colors;
    
    boardData = [];
    for (let y = 0; y < rows; y++) {
        const row = [];
        for (let x = 0; x < cols; x++) {
            row.push(Math.floor(Math.random() * colorsCount) + 1);
        }
        boardData.push(row);
    }
    
    updateHeader();
    renderBoard();
}

function updateHeader() {
    document.getElementById('total-score').innerText = calcTotalScore() + stageScore;
    document.getElementById('stage-score').innerText = stageScore;
    document.getElementById('stage').innerText = currentStage;
}

// --- 描画 ---
function renderBoard() {
    const boardEl = document.getElementById('board');
    boardEl.style.gridTemplateColumns = `repeat(${cols}, var(--block-size))`;
    boardEl.style.gridTemplateRows = `repeat(${rows}, var(--block-size))`;
    boardEl.innerHTML = '';

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (boardData[y][x] === 0) continue;
            const block = document.createElement('div');
            block.className = `block color-${boardData[y][x]}`;
            block.dataset.y = y;
            block.dataset.x = x;
            block.style.gridRow = y + 1;
            block.style.gridColumn = x + 1;

            block.addEventListener('mouseover', () => handleMouseOver(y, x));
            block.addEventListener('mouseout', clearHighlight);
            block.addEventListener('click', () => handleClick(y, x));
            boardEl.appendChild(block);
        }
    }
    
    // 手詰まり・全消しチェック
    const status = checkGameOver();
    if (status.isGameOver) {
        setTimeout(() => showGameOver(status.remainingBlocks), 500);
    }
}

// --- 探索・ロジック (DFS) ---
function getConnectedBlocks(startY, startX) {
    const targetColor = boardData[startY][startX];
    if (targetColor === 0) return [];
    const connected = [];
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

    function dfs(y, x) {
        if (y < 0 || y >= rows || x < 0 || x >= cols) return;
        if (visited[y][x]) return;
        if (boardData[y][x] !== targetColor) return;
        visited[y][x] = true;
        connected.push({ y, x });
        dfs(y - 1, x); dfs(y + 1, x); dfs(y, x - 1); dfs(y, x + 1);
    }
    dfs(startY, startX);
    return connected;
}

function handleMouseOver(y, x) {
    const connected = getConnectedBlocks(y, x);
    if (connected.length >= 2) {
        connected.forEach(pos => {
            const block = document.querySelector(`.block[data-y="${pos.y}"][data-x="${pos.x}"]`);
            if (block) block.classList.add('highlight');
        });
    }
}

function clearHighlight() {
    document.querySelectorAll('.highlight').forEach(b => b.classList.remove('highlight'));
}

function handleClick(y, x) {
    const connected = getConnectedBlocks(y, x);
    if (connected.length < 2) return;

    if (connected.length >= 10) {
        playComboSE();
    } else {
        playSE();
    }

    const score = Math.pow(connected.length - 2, 2);
    stageScore += score;
    updateHeader();

    connected.forEach(pos => { boardData[pos.y][pos.x] = 0; });
    applyGravity();
    renderBoard();
}

function applyGravity() {
    for (let x = 0; x < cols; x++) {
        let writeY = rows - 1;
        for (let y = rows - 1; y >= 0; y--) {
            if (boardData[y][x] !== 0) {
                if (writeY !== y) {
                    boardData[writeY][x] = boardData[y][x];
                    boardData[y][x] = 0;
                }
                writeY--;
            }
        }
    }
    let writeX = 0;
    for (let x = 0; x < cols; x++) {
        if (boardData[rows - 1][x] !== 0) {
            if (writeX !== x) {
                for (let y = 0; y < rows; y++) {
                    boardData[y][writeX] = boardData[y][x];
                    boardData[y][x] = 0;
                }
            }
            writeX++;
        }
    }
}

function checkGameOver() {
    let remaining = 0;
    let canClear = false;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (boardData[y][x] !== 0) {
                remaining++;
                if (!canClear && getConnectedBlocks(y, x).length >= 2) {
                    canClear = true;
                }
            }
        }
    }
    return { isGameOver: !canClear, remainingBlocks: remaining };
}

// --- モーダル制御 ---
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalButtons = document.getElementById('modal-buttons');

function showModal(title, bodyHtml, buttons) {
    modalTitle.innerText = title;
    modalBody.innerHTML = bodyHtml;
    modalButtons.innerHTML = '';
    buttons.forEach(btn => {
        const b = document.createElement('button');
        b.innerText = btn.text;
        if (btn.danger) b.classList.add('danger');
        b.onclick = () => {
            modal.classList.add('hidden');
            if (btn.action) btn.action();
        };
        modalButtons.appendChild(b);
    });
    modal.classList.remove('hidden');
}

function showGameOver(remainingBlocks) {
    const isAllClear = (remainingBlocks === 0);

    if (currentStage >= MAX_STAGE) {
        playFanfareSE();
        highestScores[currentStage - 1] = Math.max(highestScores[currentStage - 1], stageScore);
        saveHighScores();
        showModal('🎉 ALL CLEAR! 🎉', `<p>全20ステージクリア！<br>最終トータルスコア: ${calcTotalScore()}</p>`, [
            { text: '最初から遊ぶ', action: resetGame }
        ]);
        return;
    }

    if (isAllClear) playFanfareSE();

    const title = isAllClear ? '✨ 全消しクリア！ ✨' : '終了！';
    const msg = isAllClear ? 'パーフェクト！' : '消せるブロックがなくなりました。';

    showModal(title, `<p>${msg}<br>現在のステージスコア: ${stageScore}</p>`, [
        { 
            text: 'やり直す (0点から)', 
            action: () => {
                stageScore = 0; 
                initStage(true); 
            }
        },
        { 
            text: '次のステージへ進む', 
            action: () => {
                highestScores[currentStage - 1] = Math.max(highestScores[currentStage - 1], stageScore);
                saveHighScores();
                currentStage++;
                initStage();
            }
        }
    ]);
}

function resetGame() {
    currentStage = 1;
    stageScore = 0;
    initStage();
}

// --- ステージジャンプ機能 ---
// HTMLから直接呼び出せるようにグローバルに関数を定義
window.jumpToStage = function(stageNum) {
    modal.classList.add('hidden'); // モーダルを閉じる
    currentStage = stageNum;
    stageScore = 0; // 途中だったスコアは破棄して0からスタート
    initStage();
};

// --- UIボタン処理 ---
document.getElementById('btn-result').addEventListener('click', () => {
    let currentBest = Math.max(highestScores[currentStage - 1], stageScore);
    
    let html = `<p>Total Score: ${calcTotalScore() + stageScore}</p>
                <div style="max-height: 40vh; overflow-y: auto; text-align: left; display: block; padding: 10px; background: #1e1e1e; border-radius: 4px; box-sizing: border-box;">
                <ul style="list-style: none; padding: 0; margin: 0;">`;
    
    for(let i = 0; i < MAX_STAGE; i++) {
        let mark = (i + 1 === currentStage) ? ' <span style="color: #ff4757;">(プレイ中)</span>' : '';
        let s = (i + 1 === currentStage) ? currentBest : highestScores[i];
        
        // ステージごとにスコアと「遊ぶ」ボタンを並べる
        html += `<li style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 4px;">
                    <span>Stage ${String(i + 1).padStart(2, '0')}: ${s}${mark}</span>
                    <button onclick="jumpToStage(${i + 1})" style="padding: 4px 10px; font-size: 0.8rem; background: #1e90ff; color: #fff; border: none; border-radius: 4px; cursor: pointer;">遊ぶ</button>
                 </li>`;
    }
    html += `</ul></div>`;
    
    showModal('リザルト ＆ ステージ選択', html, [
        { text: '閉じる' },
        { text: '記録をリセット', danger: true, action: confirmResetHighScores }
    ]);
});

function confirmResetHighScores() {
    showModal('警告', '<p>本当にハイスコア記録をすべてリセットしますか？</p>', [
        { text: 'キャンセル', action: () => document.getElementById('btn-result').click() },
        { text: 'リセットする', danger: true, action: () => {
            highestScores.fill(0);
            saveHighScores();
            document.getElementById('btn-result').click(); // リザルトを再表示
        }}
    ]);
}

document.getElementById('btn-giveup').addEventListener('click', () => {
    showModal('やめる', '<p>どうする？<br>（過去の最高記録は保持されるよ）</p>', [
        { 
            text: 'キャンセル' 
        },
        { 
            text: 'このステージをやり直す', 
            action: () => {
                stageScore = 0; 
                initStage(true); 
            }
        },
        { 
            text: '最初からやり直す', 
            danger: true, 
            action: resetGame 
        }
    ]);
});

// 起動
initStage();