// ========== 背单词核心逻辑 ==========

// ---------- 侧边栏菜单 ----------
function openSidebar() {
    document.getElementById('sidebarMenu').classList.add('open');
    document.getElementById('overlayLayer').classList.add('visible');
    document.body.style.overflow = 'hidden';
    const fmb = document.getElementById('floatingMenuBtn');
    if (fmb) fmb.classList.add('hidden');
}

function closeSidebar() {
    document.getElementById('sidebarMenu').classList.remove('open');
    document.getElementById('overlayLayer').classList.remove('visible');
    document.body.style.overflow = '';
    const fmb = document.getElementById('floatingMenuBtn');
    if (fmb) fmb.classList.remove('hidden');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebarMenu');
    if (sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

// ---------- 弹窗 ----------
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
        if (id === 'newListModal') {
            loadPresetOptions();
        }
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('visible');
        const anyOpen = document.querySelector('.modal-overlay.visible');
        if (!anyOpen) {
            document.body.style.overflow = '';
        }
    }
}

// ---------- 工具函数 ----------
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function genListId() {
    return 'list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ---------- 存储相关函数 ----------
// 内存缓存：包含完整单词对象（含 meaning），保存到 localStorage 时剥离 meaning
let _wordDataCache = null;
let _meaningsLoaded = false;

function initStorage() {
    const raw = localStorage.getItem('wordData');
    if (!raw) {
        const defaultList = {
            id: genListId(),
            name: '默认词表',
            words: [],
            pendingWords: [],
            selectedWord: null
        };
        _wordDataCache = { activeListId: defaultList.id, lists: [defaultList] };
        saveWordData(_wordDataCache);
    } else {
        _wordDataCache = JSON.parse(raw);
        // 数据迁移：旧格式 { allWords, pendingWords, selectedWord }
        if (_wordDataCache.allWords !== undefined && !_wordDataCache.lists) {
            const migratedList = {
                id: genListId(),
                name: '我的单词',
                words: _wordDataCache.allWords || [],
                pendingWords: _wordDataCache.pendingWords || [],
                selectedWord: _wordDataCache.selectedWord || null
            };
            _wordDataCache = { activeListId: migratedList.id, lists: [migratedList] };
            saveWordData(_wordDataCache);
        }
    }
    // 异步从词典加载释义（localStorage 中不存 meaning）
    loadAllMeanings();
}

// 从词典批量查询所有单词的释义，填充到内存缓存
async function loadAllMeanings() {
    if (!_wordDataCache) return;
    const allWords = new Set();
    _wordDataCache.lists.forEach(list => {
        (list.words || []).forEach(w => allWords.add(w.word));
        (list.pendingWords || []).forEach(w => allWords.add(w.word));
        if (list.selectedWord) allWords.add(list.selectedWord.word);
    });
    if (allWords.size === 0) {
        _meaningsLoaded = true;
        return;
    }
    const entries = await lookupWords(Array.from(allWords));
    _wordDataCache.lists.forEach(list => {
        (list.words || []).forEach(w => {
            const e = entries.get(w.word.toLowerCase());
            if (e) {
                w.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
            } else if (!w.meaning) {
                w.meaning = '(无释义)';
            }
        });
        (list.pendingWords || []).forEach(w => {
            const e = entries.get(w.word.toLowerCase());
            if (e) {
                w.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
            } else if (!w.meaning) {
                w.meaning = '(无释义)';
            }
        });
        if (list.selectedWord) {
            const e = entries.get(list.selectedWord.word.toLowerCase());
            if (e) {
                list.selectedWord.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
            } else if (!list.selectedWord.meaning) {
                list.selectedWord.meaning = '(无释义)';
            }
        }
    });
    _meaningsLoaded = true;
    // 释义加载完成后刷新 UI
    renderSidebarLists();
    refreshCurrentList();
    updateDraw();
}

function getWordData() {
    return _wordDataCache;
}

function saveWordData(data) {
    _wordDataCache = data;
    // 剥离 meaning 后保存（只存 word + mnemonic）
    const stripped = JSON.parse(JSON.stringify(data));
    stripped.lists.forEach(list => {
        (list.words || []).forEach(w => { delete w.meaning; });
        (list.pendingWords || []).forEach(w => { delete w.meaning; });
        if (list.selectedWord) { delete list.selectedWord.meaning; }
    });
    localStorage.setItem('wordData', JSON.stringify(stripped));
}

function getActiveList(data) {
    const d = data || getWordData();
    return d.lists.find(l => l.id === d.activeListId) || d.lists[0];
}

// ---------- 列表管理 ----------
function createList() {
    const input = document.getElementById('newListName');
    const name = input.value.trim();
    if (!name) {
        alert('请输入词表名称');
        return;
    }
    const data = getWordData();
    const newList = {
        id: genListId(),
        name: name,
        words: [],
        pendingWords: [],
        selectedWord: null
    };
    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    input.value = '';
    closeModal('newListModal');
    renderSidebarLists();
    updateDraw();
    closeSidebar();
}

function renameList(id) {
    const data = getWordData();
    const list = data.lists.find(l => l.id === id);
    if (!list) return;
    const newName = prompt('请输入新的词表名称：', list.name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) {
        alert('词表名称不能为空');
        return;
    }
    list.name = trimmed;
    saveWordData(data);
    renderSidebarLists();
    updateActiveListName();
}

function deleteList(id) {
    const data = getWordData();
    if (data.lists.length <= 1) {
        alert('至少保留一个词表');
        return;
    }
    const list = data.lists.find(l => l.id === id);
    if (!list) return;
    if (!confirm('确定删除词表"' + list.name + '"吗？该词表下的所有单词将被删除，无法恢复！')) return;

    data.lists = data.lists.filter(l => l.id !== id);
    if (data.activeListId === id) {
        data.activeListId = data.lists[0].id;
    }
    saveWordData(data);
    renderSidebarLists();
    updateDraw();
    refreshCurrentList();
}

function switchList(id) {
    const data = getWordData();
    if (data.activeListId === id) {
        closeSidebar();
        return;
    }
    data.activeListId = id;
    saveWordData(data);
    renderSidebarLists();
    updateDraw();
    refreshCurrentList();
    closeSidebar();
}

function viewListWords(id) {
    switchList(id);
    openModal('listModal');
}

function renderSidebarLists() {
    const data = getWordData();
    const container = document.getElementById('sidebarLists');
    let html = '';
    data.lists.forEach(list => {
        const isActive = list.id === data.activeListId;
        html += '<div class="sidebar-list-item' + (isActive ? ' active' : '') + '">';
        html += '  <div class="list-item-info" onclick="switchList(\'' + list.id + '\')">';
        html += '    <span class="list-item-name">' + escapeHtml(list.name) + '</span>';
        html += '    <span class="list-item-count">' + list.words.length + ' 词</span>';
        html += '  </div>';
        html += '  <div class="list-item-actions">';
        html += '    <button class="list-action-btn" title="查看单词" onclick="viewListWords(\'' + list.id + '\')">';
        html += '      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M512 256c-141.4 0-260.8 82.2-320 200.5C251.2 574.2 370.6 656 512 656s260.8-82.2 320-200.5C772.8 338.2 653.4 256 512 256zm0 320c-66.3 0-120-53.7-120-120s53.7-120 120-120 120 53.7 120 120-53.7 120-120 120z"/></svg>';
        html += '    </button>';
        html += '    <button class="list-action-btn" title="重命名" onclick="renameList(\'' + list.id + '\')">';
        html += '      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M853.333 128a149.333 149.333 0 00-210.667 0L164.267 632.533a130.133 130.133 0 00-34.134 61.867L52.267 885.333a31.25 31.25 0 0037.333 37.333l190.934-45.867a130.133 130.133 0 0061.866-34.133L853.333 337.067a149.333 149.333 0 000-210.667zm-166.4 44.8a86.4 86.4 0 11122.134 122.134l-37.333 37.333L669.867 213.333l17.067-17.067zM625.067 252.8l121.6 121.6-416 416a66.133 66.133 0 01-31.467 17.067l-142.933 34.133 34.133-142.933a66.133 66.133 0 0117.067-31.467l416-416z"/></svg>';
        html += '    </button>';
        html += '    <button class="list-action-btn danger" title="删除词表" onclick="deleteList(\'' + list.id + '\')">';
        html += '      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M360 184h-8c4.4 0 8-3.6 8-8v8h304v-8c0 4.4 3.6 8 8 8h-8v72h72v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80h72v-72zm504 72H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.9 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32zM731.3 840H292.7l-24.2-512h487l-24.2 512z"/></svg>';
        html += '    </button>';
        html += '  </div>';
        html += '</div>';
    });
    container.innerHTML = html;
}

function updateActiveListName() {
    const list = getActiveList();
    const name = list ? list.name : '无';
    document.getElementById('activeListName').textContent = '当前列表：' + name;
    document.getElementById('addModalListName').textContent = name;
    document.getElementById('listModalName').textContent = name;
}

// ---------- UI 更新辅助函数 ----------
function updateRemainCount() {
    const list = getActiveList();
    document.getElementById('remainCount').textContent = '待抽取个数：' + list.pendingWords.length;
}

function showOption() {
    const optionDiv = document.getElementById('optionDiv');
    const list = getActiveList();
    const switchOn = document.getElementById('switchBtn').checked;
    const enoughWords = list.words && list.words.length >= 4;
    if (switchOn && enoughWords) {
        optionDiv.classList.remove('hidden');
        // 选择题模式下，若有当前词且尚未选选项，显示意思需等选完选项
        if (list.selectedWord) {
            document.getElementById('showButton').disabled = true;
        }
    } else {
        optionDiv.classList.add('hidden');
        // 非选择题模式，有当前词即可显示意思
        if (list.selectedWord) {
            document.getElementById('showButton').disabled = false;
        }
    }
}

function updateDraw() {
    updateActiveListName();
    updateRemainCount();
    createOptions();
    showOption();

    const list = getActiveList();
    document.getElementById('startButton').disabled = true;
    document.getElementById('showButton').disabled = true;
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;

    if (list.selectedWord) {
        document.getElementById('currentWord').textContent = list.selectedWord.word;
        document.getElementById('currentMeaning').textContent = normalizeNewlines(list.selectedWord.meaning);
        document.getElementById('currentMeaning').classList.add('hidden');
        // 选择题模式下需先选选项才能显示意思；非选择题模式直接可显示
        const optionsOn = document.getElementById('switchBtn').checked && list.words && list.words.length >= 4;
        document.getElementById('showButton').disabled = optionsOn;
    } else {
        document.getElementById('startButton').disabled = false;
    }
}

// ---------- 单词列表渲染 ----------
function renderWordList(title, wordArray) {
    const displayEl = document.getElementById('wordListDisplay');
    const countEl = document.getElementById('wordCount');

    countEl.textContent = '单词总数：' + wordArray.length;

    if (wordArray.length === 0) {
        displayEl.innerHTML = '<div class="word-item">暂无单词</div>';
        return;
    }

    let html = '';
    wordArray.forEach((item, index) => {
        html += '<div class="word-item">' + (index + 1) + '. ' + escapeHtml(item.word) + ' —— ' + escapeHtml(normalizeNewlines(item.meaning)) + '</div>';
    });
    displayEl.innerHTML = html;
}

function refreshCurrentList() {
    const list = getActiveList();
    renderWordList("", list.words);
}

// ---------- 选项相关逻辑 ----------
let optionsText = [];

function createOptions() {
    for (let i = 1; i <= 4; i++) {
        const btn = document.getElementById("optionButton" + i);
        btn.style.backgroundColor = '';
        btn.disabled = false;
    }

    const list = getActiveList();
    if (!list.words || list.words.length < 4) {
        document.getElementById('optionDiv').classList.add('hidden');
        return;
    }
    if (!list.selectedWord) return;

    if (document.getElementById('switchBtn').checked) {
        document.getElementById('optionDiv').classList.remove('hidden');
    }

    const rightPos = Math.floor(Math.random() * 4);

    const wrong = [];
    while (wrong.length < 3) {
        const candidate = list.words[Math.floor(Math.random() * list.words.length)];
        if (candidate.word !== list.selectedWord.word && !wrong.includes(candidate)) {
            wrong.push(candidate);
        }
    }

    optionsText = wrong.slice(0, 3);
    optionsText.splice(rightPos, 0, list.selectedWord);

    document.getElementById("optionButton1").innerText = flattenNewlines(optionsText[0].meaning);
    document.getElementById("optionButton2").innerText = flattenNewlines(optionsText[1].meaning);
    document.getElementById("optionButton3").innerText = flattenNewlines(optionsText[2].meaning);
    document.getElementById("optionButton4").innerText = flattenNewlines(optionsText[3].meaning);
}

function isOptionCorrect(num) {
    const list = getActiveList();
    const selectedOption = optionsText[num - 1];

    // 先重置所有选项样式（允许重新选择）
    for (let i = 1; i <= 4; i++) {
        const btn = document.getElementById("optionButton" + i);
        btn.style.backgroundColor = '';
        btn.innerText = flattenNewlines(optionsText[i - 1].meaning);
    }

    // 标记当前选中项
    const btnId = "optionButton" + num;
    if (selectedOption.word === list.selectedWord.word) {
        document.getElementById(btnId).innerText = '√ ' + selectedOption.word + '-' + flattenNewlines(selectedOption.meaning);
        document.getElementById(btnId).style.backgroundColor = '#67c23a';
    } else {
        document.getElementById(btnId).innerText = '× ' + selectedOption.word + '-' + flattenNewlines(selectedOption.meaning);
        document.getElementById(btnId).style.backgroundColor = '#f56c6c';
    }

    // 激活"显示意思"按钮
    document.getElementById('showButton').disabled = false;
}

// ---------- 核心抽取逻辑 ----------
function drawWord(num) {
    const data = getWordData();
    const list = getActiveList(data);

    if (list.pendingWords.length !== 0 && list.selectedWord) {
        document.getElementById('lastWord').textContent =
            list.selectedWord.word + ' — ' + list.selectedWord.meaning;
    }

    if (list.pendingWords.length === 0 && list.selectedWord && num === 0) {
        list.pendingWords.push(list.selectedWord);
        list.selectedWord = null;
    }

    if (list.pendingWords.length === 0) {
        list.selectedWord = null;
        alert('待抽取为空，请重置抽取或添加新单词');
        document.getElementById('currentWord').textContent = "待抽取为空";
        document.getElementById('currentMeaning').textContent = "";
        document.getElementById('startButton').disabled = false;
        document.getElementById('checkButton1').disabled = true;
        document.getElementById('checkButton2').disabled = true;
        saveWordData(data);
        return;
    }

    const randomIndex = Math.floor(Math.random() * list.pendingWords.length);
    if (num === 0 && list.selectedWord) {
        list.pendingWords.push(list.selectedWord);
    }
    list.selectedWord = list.pendingWords.splice(randomIndex, 1)[0];
    saveWordData(data);

    document.getElementById('currentWord').textContent = list.selectedWord.word;
    document.getElementById('currentMeaning').textContent = list.selectedWord.meaning;
    document.getElementById('currentMeaning').classList.add('hidden');

    // 选择题模式：需先选选项才能显示意思；非选择题模式：直接可显示意思
    const optionsOn = document.getElementById('switchBtn').checked && list.words && list.words.length >= 4;
    document.getElementById('showButton').disabled = optionsOn;
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;

    // 重新激活选项按钮
    for (let i = 1; i <= 4; i++) {
        document.getElementById("optionButton" + i).disabled = false;
    }

    createOptions();
    refreshCurrentList();
    updateRemainCount();
}

function startDraw() {
    document.getElementById('startButton').disabled = true;
    drawWord(1);
}

function toggleMeaning() {
    document.getElementById('currentMeaning').classList.remove('hidden');
    document.getElementById('showButton').disabled = true;
    document.getElementById('checkButton1').disabled = false;
    document.getElementById('checkButton2').disabled = false;
}

// ---------- 批量添加单词（纯英文输入，自动查单词） ----------
async function addWords() {
    const input = document.getElementById('wordInput').value.trim();
    if (!input) {
        alert('请输入单词内容');
        return;
    }

    const loaded = await isDictLoaded();
    if (!loaded) {
        alert('词典未导入，请先到"查单词"页面导入 ecdict.csv');
        return;
    }

    const lines = input.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) {
        alert('请输入至少一个单词');
        return;
    }

    try {
        const result = await lookupWords(lines);
        const data = getWordData();
        const list = getActiveList(data);
        let addedCount = 0;
        const notFound = [];

        lines.forEach(w => {
            const entry = result.get(w.toLowerCase());
            if (entry) {
                const wordObj = {
                    word: entry.word,
                    meaning: normalizeNewlines(entry.translation || entry.definition || '(无释义)'),
                    mnemonic: null
                };
                const isExist = list.words.some(item => item.word.toLowerCase() === wordObj.word.toLowerCase());
                if (!isExist) {
                    list.words.push(wordObj);
                    list.pendingWords.push(wordObj);
                    addedCount++;
                }
            } else {
                notFound.push(w);
            }
        });

        list.words.sort((a, b) => a.word.localeCompare(b.word));
        list.pendingWords.sort((a, b) => a.word.localeCompare(b.word));

        saveWordData(data);
        document.getElementById('wordInput').value = '';

        let msg = '成功添加' + addedCount + '个新单词';
        if (notFound.length > 0) {
            msg += '\n以下单词未在词典中找到：\n' + notFound.join(', ');
        }
        alert(msg);

        renderSidebarLists();
        refreshCurrentList();
        updateRemainCount();
        const updatedList = getActiveList();
        if (!updatedList.selectedWord && updatedList.pendingWords.length > 0) {
            document.getElementById('startButton').disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert('添加失败：' + err.message);
    }
}

// ---------- 预设词表 ----------
function loadPresetOptions() {
    const container = document.getElementById('presetListOptions');
    if (!container) return;
    const lists = getPresetLists();
    if (lists.length === 0) {
        container.innerHTML = '<span style="color:#909399;font-size:0.85rem;">暂无预设词表</span>';
        return;
    }
    container.innerHTML = lists.map(l =>
        '<button class="preset-btn" onclick="createListFromPreset(\'' + l.tag + '\')">' +
        escapeHtml(l.name) + ' (' + l.count + '词)</button>'
    ).join('');
}

function createListFromPreset(tag) {
    const preset = getPresetListByTag(tag);
    if (!preset) {
        alert('预设词表不存在');
        return;
    }
    const data = getWordData();
    const words = preset.words.map(w => ({
        word: w.word,
        meaning: normalizeNewlines(w.translation || '(无释义)'),
        mnemonic: null
    }));
    const newList = {
        id: genListId(),
        name: preset.name,
        words: words,
        pendingWords: [...words],
        selectedWord: null
    };
    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    closeModal('newListModal');
    renderSidebarLists();
    updateDraw();
    closeSidebar();
    alert('已创建词表"' + preset.name + '"，共' + words.length + '个单词');
}

// ---------- 重置抽取 ----------
function resetDraw() {
    if (!confirm('确定要重置抽取记录吗？待抽取将重置为全部单词')) return;
    const data = getWordData();
    const list = getActiveList(data);

    list.selectedWord = null;
    list.pendingWords = [...list.words];

    saveWordData(data);

    document.getElementById('currentWord').textContent = '已重置，请开始抽取';
    document.getElementById('currentMeaning').classList.add('hidden');
    document.getElementById('lastWord').textContent = '上一个单词';

    // 清空选项
    for (let i = 1; i <= 4; i++) {
        const btn = document.getElementById('optionButton' + i);
        btn.textContent = '选项' + i;
        btn.style.backgroundColor = '';
        btn.disabled = true;
    }
    document.getElementById('optionDiv').classList.add('hidden');

    document.getElementById('startButton').disabled = false;
    document.getElementById('showButton').disabled = true;
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;

    alert('抽取记录已重置完成');
    refreshCurrentList();
    updateRemainCount();
}

// ---------- 清空当前词表 ----------
function clearAllWords() {
    if (!confirm('⚠️ 警告：此操作将永久删除当前词表的所有单词，无法恢复！确定继续吗？')) return;
    const data = getWordData();
    const list = getActiveList(data);

    list.words = [];
    list.pendingWords = [];
    list.selectedWord = null;

    saveWordData(data);

    document.getElementById('currentWord').textContent = '请添加单词';
    document.getElementById('currentMeaning').classList.add('hidden');
    document.getElementById('lastWord').textContent = '上一个单词';
    document.getElementById('wordListDisplay').innerHTML = '<div class="word-item">暂无单词</div>';
    document.getElementById('wordCount').textContent = '所有单词个数：0';
    document.getElementById('startButton').disabled = false;
    document.getElementById('showButton').disabled = true;
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;
    renderSidebarLists();
    updateRemainCount();
    alert('✅ 已清空当前词表！');
}

// ---------- 页面初始化（脚本在body末尾，DOM已就绪） ----------
(function init() {
    if (!document.getElementById('remainCount')) return;

    initStorage();
    renderSidebarLists();
    refreshCurrentList();
    updateDraw();

    // 绑定底部按钮事件
    const footerBtns = document.querySelectorAll('.footer-icon-btn');
    if (footerBtns[0]) {
        footerBtns[0].addEventListener('click', function(e) {
            e.stopPropagation();
            openModal('settingsModal');
        });
    }
    if (footerBtns[1]) {
        footerBtns[1].addEventListener('click', function(e) {
            e.stopPropagation();
            openModal('addModal');
        });
    }

    // 点击弹窗遮罩关闭弹窗
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });

    // ESC 键关闭侧边栏和弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
            document.querySelectorAll('.modal-overlay.visible').forEach(m => {
                closeModal(m.id);
            });
        }
    });

    // 新建词表弹窗回车创建
    const newListInput = document.getElementById('newListName');
    if (newListInput) {
        newListInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createList();
        });
    }
})();
