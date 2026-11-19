// ---------- 我的词典：词典管理 ----------
// 职责：MyLists.html 页面
//   - 词典下载 / 重新下载 / 删除 / 已下载状态展示（按钮按状态禁用）
//   - 词典内词表：预设词表下拉展开（右侧箭头触发）、添加词表、删除、添加到词表
// 词典目录定义见 common.js 的 DICT_CATALOG（在此扩展多本词典）

let _mylistsBusy = false;

// 重新下载图标（刷新）
const REFRESH_ICON = '<svg width="1em" height="1em" viewBox="0 0 20 20" fill="currentColor"><path d="M6.2 4.1a.5.5 0 01-.1.7 6.5 6.5 0 003.66 11.7h.38l-1.55-1.55a.5.5 0 11.7-.7l2.12 2.11c.2.2.2.52 0 .71L9.3 19.2a.5.5 0 11-.7-.7l1-1A7.5 7.5 0 015.5 3.99a.5.5 0 01.7.1zM11.42.8c.2.2.2.52 0 .71l-1 1a7.5 7.5 0 014.07 13.5.5.5 0 11-.59-.8 6.5 6.5 0 00-3.66-11.7l-.3-.01a.5.5 0 01-.07 0l1.55 1.55a.5.5 0 11-.7.7L8.59 3.65a.5.5 0 010-.71L10.7.8c.2-.2.5-.2.7 0z"></path></svg>';

// 渲染词典列表：先渲染全部词典行（状态"检测中"、按钮全部禁用），再并行查询下载状态逐本更新
async function renderDictList() {
    const container = document.getElementById('dictList');
    if (!container) return;

    container.innerHTML = DICT_CATALOG.map(dict => {
        return '<div class="dict-row" data-dict="' + dict.id + '">' +
        '  <div class="dict-info">' +
        '    <span class="dict-name">' + escapeHtml(dict.name) + '</span>' +
        '    <span class="dict-desc">' + escapeHtml(dict.desc) + '</span>' +
        '    <span class="dict-count"></span>' +
        '  </div>' +
        '  <div class="dict-side">' +
        '    <div class="dict-side-row1">' +
        '      <span class="dict-status">检测中...</span>' +
        '      <button class="reload-icon" title="重新下载" disabled onclick="reloadDict(\'' + dict.id + '\')">' + REFRESH_ICON + '</button>' +
        '    </div>' +
        '    <div class="dict-actions">' +
        '      <button class="primary" disabled onclick="downloadDict(\'' + dict.id + '\')">下载</button>' +
        '      <button class="danger" disabled onclick="deleteDict(\'' + dict.id + '\')">删除</button>' +
        '    </div>' +
        '  </div>' +
        '</div>';
    }).join('');

    // 并行查询每本词典的下载状态：每本只查一次词条数（原先 isDictLoaded + countDictEntries 会查两次）
    await Promise.all(DICT_CATALOG.map(async (dict) => {
        const count = await countDictEntries(dict.id);
        const row = container.querySelector('.dict-row[data-dict="' + dict.id + '"]');
        if (row) applyDictRowState(row, dict, count);
    }));
}

// 按词条数量更新单行状态与按钮可用性
function applyDictRowState(row, dict, count) {
    const loaded = count > 0;
    const statusEl = row.querySelector('.dict-status');
    const countEl = row.querySelector('.dict-count');
    const reloadBtn = row.querySelector('.reload-icon');
    const btns = row.querySelectorAll('.dict-actions button');
    if (statusEl) {
        statusEl.textContent = loaded ? '已下载' : '未下载';
        statusEl.classList.toggle('ok', loaded);
    }
    // "共 x / y 词"单独显示：x 为实际条数，y 为目录应有数量
    if (countEl) {
        countEl.textContent = loaded
            ? '共 ' + count.toLocaleString('en-US') + ' / ' + (dict.expectedCount || '') + ' 词'
            : '';
    }
    // actions 内：0=下载、1=删除
    if (reloadBtn) reloadBtn.disabled = !loaded;
    if (btns[0]) btns[0].disabled = loaded;
    if (btns[1]) btns[1].disabled = !loaded;
}

// 下载 / 重新下载词典的共用流程（clearFirst = 先清空已有词条）
async function importDictJob(id, clearFirst, busyText, successText, failureText) {
    if (_mylistsBusy) return;
    _mylistsBusy = true;
    setBusy(true, busyText);
    try {
        if (clearFirst) await clearDictStore(id);
        await autoImportDictFromCSV(id);
        if (await isDictLoaded(id)) {
            showToast(successText, 'success');
        } else {
            showToast(failureText, 'error');
        }
    } catch (e) {
        console.warn('词典导入失败', e);
        showToast(failureText + '：' + (e && e.message ? e.message : e), 'error');
    } finally {
        _mylistsBusy = false;
        setBusy(false);
        await renderDictList();
    }
}

// 下载并导入指定词典（复用 common.js 的导入链路，含进度提示）
function downloadDict(id) {
    return importDictJob(id, false,
        '正在下载并导入词典（约需1-3分钟），请勿关闭页面...',
        '词典下载完成',
        '下载失败：未能获取词典文件，请检查网络后重试');
}

// 重新下载指定词典：清空该词典库并重新导入
function reloadDict(id) {
    if (_mylistsBusy) return;
    const dict = getDictById(id);
    showConfirm('将清空「' + dict.name + '」并重新下载（约需1-3分钟），是否继续？', () => {
        importDictJob(id, true, '正在重新下载词典...', '词典已重新下载', '重新下载失败');
    });
}

// 删除指定词典（先断开本页缓存的数据库连接，再删除其 IndexedDB 库）
function deleteDict(id) {
    if (_mylistsBusy) return;
    showConfirm('确定删除已下载的词典吗？删除后需重新下载才能查词。', async () => {
        _mylistsBusy = true;
        setBusy(true, '正在删除词典...');
        try {
            await closeDB(dictDBName(id));
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(dictDBName(id));
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error || new Error('删除失败'));
                req.onblocked = () => reject(new Error('词典库删除被阻塞，请先关闭其他页面再试'));
            });
            showToast('词典已删除', 'success');
        } catch (e) {
            console.warn('删除词典失败', e);
            showToast('删除失败：' + (e && e.message ? e.message : e), 'error');
        } finally {
            _mylistsBusy = false;
            setBusy(false);
            await renderDictList();
        }
    });
}

// ---------- 预设词表（独立区块，不隶属任何一本词典） ----------
// 下拉框决定导入时用哪本词典补全释义与音标；预设数据只存单词
function renderPresetSection() {
    const sel = document.getElementById('presetDictSelect');
    const chips = document.getElementById('presetChips');
    if (!sel || !chips) return;

    const current = getPresetDictId();
    sel.innerHTML = DICT_CATALOG.map(d =>
        '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'
    ).join('');
    sel.value = current;

    const lists = (window.PRESET_LISTS || []);
    chips.innerHTML = lists.map(p =>
        '<button type="button" class="preset-chip" onclick="createFromPresetTag(\'' + p.tag + '\')">' +
        escapeHtml(p.name) + '<span class="cnt">' + p.count + '词</span></button>'
    ).join('');

    // 未下载的词典在下拉框里标注（不影响选择，导入时会提示）
    Promise.all(DICT_CATALOG.map(async (d) => {
        const count = await countDictEntries(d.id);
        const opt = sel.querySelector('option[value="' + d.id + '"]');
        if (opt) opt.textContent = d.name + (count > 0 ? '' : '（未下载）');
    })).catch(() => { /* 状态标注失败不影响导入 */ });
}

function onPresetDictChange() {
    const sel = document.getElementById('presetDictSelect');
    if (sel) setPresetDictId(sel.value);
}

// 点击预设词表项：预设文件只存单词，导入时用所选词典补全释义与音标
let _presetCreating = false;
async function createFromPresetTag(tag) {
    if (!tag) return;
    const preset = getPresetListByTag(tag);
    if (!preset) {
        showToast('预设词表不存在', 'error');
        return;
    }
    const data = getWordData();
    if (!data) {
        showToast('词表数据尚未加载，请稍后重试', 'error');
        return;
    }
    if (_presetCreating) {
        showToast('正在创建词表，请稍候…', 'warning');
        return;
    }

    // 预设只存单词，没有词典就没有释义 → 用下拉框选定的词典；未下载时引导切换或下载
    const dictId = getPresetDictId();
    const dict = getDictById(dictId);
    if (!(await isDictLoaded(dictId))) {
        showToast('预设词表只存单词，需先用「' + dict.name + '」补全释义；请先下载该词典，或在「补全用词典」里换一本已下载的', 'warning');
        return;
    }

    // 兼容两种结构：纯字符串数组（当前）与 {word, translation} 旧结构
    const wordTexts = (preset.words || [])
        .map(w => (typeof w === 'string' ? w : (w && w.word) || ''))
        .map(w => String(w).trim())
        .filter(Boolean);
    if (wordTexts.length === 0) {
        showToast('该预设词表为空', 'warning');
        return;
    }

    _presetCreating = true;
    try {
        // 分批查词典（单批 1000 词），避免一次性发上万条 IndexedDB 请求
        const BATCH = 1000;
        const entries = new Map();
        for (let i = 0; i < wordTexts.length; i += BATCH) {
            const part = wordTexts.slice(i, i + BATCH);
            const got = await lookupWords(part, dictId);
            got.forEach((v, k) => entries.set(k, v));
            if (wordTexts.length > BATCH) {
                showToast('正在查词典补全「' + preset.name + '」：' +
                    Math.min(i + BATCH, wordTexts.length) + '/' + wordTexts.length);
            }
        }

        const words = wordTexts.map(w => {
            const e = entries.get(w.toLowerCase());
            return {
                word: (e && e.word) || w,
                mnemonic: null,
                phonetic: (e && e.phonetic) || '',
                meaning: e ? normalizeNewlines(e.translation || e.definition || '(无释义)') : '(无释义)'
            };
        });

        const newList = makeList(uniqueListName(preset.name), words);
        data.lists.push(newList);
        data.activeListId = newList.id;
        saveWordData(data);

        const missing = words.filter(w => w.meaning === '(无释义)').length;
        showToast('已创建词表「' + newList.name + '」，共 ' + words.length + ' 个单词' +
            (missing ? '，' + missing + ' 个词典未收录（可在背单词页手动补释义）' : '，释义已全部补全') +
            '，可在背单词页查看', 'success');
    } catch (e) {
        showToast('创建失败：' + ((e && e.message) || '查询典出错，请重试'), 'error');
    } finally {
        _presetCreating = false;
    }
}

// ---------- 我的词表区：背单词页"保存到我的词典"复制的词表 ----------
// 词表仅有三个操作：添加单词、删除、添加到词表
// 新建词表（我的词表）
function showCreateSavedListModal() {
    const nameInput = document.getElementById('savedCreateName');
    if (nameInput) nameInput.value = '';
    openModal('savedCreateModal');
}
function doCreateSavedList() {
    const saved = getSavedListsData();
    if (!Array.isArray(saved.lists)) saved.lists = [];
    const nameInput = document.getElementById('savedCreateName');
    const name = (nameInput.value || '').trim();
    if (!name) { showToast('请输入词表名称', 'warning'); return; }
    const finalName = uniqueListNameIn(name, saved.lists);
    saved.lists.push(makeList(finalName));
    saveSavedListsData(saved);
    closeModal('savedCreateModal');
    renderSavedLists();
    showToast('已创建词表「' + finalName + '」', 'success');
}

// 弹窗开关沿用 common.js 的 openModal / closeModal（与背单词页同一套行为）

function renderSavedLists() {
    const container = document.getElementById('savedListContainer');
    if (!container) return;
    const saved = getSavedListsData();
    const lists = saved && Array.isArray(saved.lists) ? saved.lists : [];
    if (lists.length === 0) {
        container.innerHTML = '<div class="saved-list-row" style="cursor:default;"><div class="saved-list-info">' +
            '<span class="saved-list-count">暂无词表。可在背单词页「词表详细」中点击「保存到我的词典」复制词表到这里</span></div></div>';
        return;
    }
    container.innerHTML = lists.map(list =>
        '<div class="saved-list-row">' +
        '  <div class="saved-list-info">' +
        '    <span class="saved-list-name">' + escapeHtml(list.name) + '</span>' +
        '    <span class="saved-list-count">' + (list.words || []).length + ' 词</span>' +
        '  </div>' +
        '  <div class="saved-list-actions">' +
        '    <button type="button" onclick="viewSavedList(\'' + list.id + '\')">查看</button>' +
        '    <button type="button" onclick="addWordsToList(\'' + list.id + '\')">添加单词</button>' +
        '    <button type="button" onclick="showAddToListModal(\'' + list.id + '\')">添加到词表</button>' +
        '    <button type="button" class="danger" onclick="deleteSavedList(\'' + list.id + '\')">删除</button>' +
        '  </div>' +
        '</div>'
    ).join('');
}

// ---------- 查看词表：与背单词页词表详细一致（搜索 + 单词列表 + 删除 + 点击查看详情） ----------
let _savedViewId = null;
let _savedViewSearch = '';
let _savedViewSearchTimer = null;

function viewSavedList(id) {
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === id) : null;
    if (!list) { showToast('词表不存在', 'error'); return; }
    _savedViewId = id;
    _savedViewSearch = '';
    const searchEl = document.getElementById('savedViewSearch');
    if (searchEl) searchEl.value = '';
    const nameEl = document.getElementById('savedViewListName');
    if (nameEl) nameEl.textContent = list.name;
    openModal('savedViewModal');
    renderSavedListView();
}

// 列表搜索（防抖：避免每次击键都重建整张列表）
function onSavedViewSearch() {
    clearTimeout(_savedViewSearchTimer);
    _savedViewSearchTimer = setTimeout(() => {
        const input = document.getElementById('savedViewSearch');
        _savedViewSearch = input ? input.value : '';
        renderSavedListView();
    }, 120);
}

function renderSavedListView() {
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === _savedViewId) : null;
    const display = document.getElementById('savedViewDisplay');
    const count = document.getElementById('savedViewCount');
    if (!list || !display) return;
    // 与背单词页共用同一套列表渲染（排序 / 搜索 / 删除按钮 / 点击查看详情）
    const markup = buildWordListMarkup(list.words || [], _savedViewSearch, 'deleteWordFromSavedList');
    if (count) count.textContent = markup.countText;
    display.innerHTML = markup.html;
    // 补查缺失释义（词典链接单词），完成后若弹窗仍打开则刷新
    if (markup.missing.length > 0) {
        fillMissingMeanings(markup.missing).then(() => {
            const modal = document.getElementById('savedViewModal');
            if (modal && modal.classList.contains('visible')) renderSavedListView();
        });
    }
}

// 从「我的词典」词表删除单个单词（同步清理待抽取 / 选中 / 记忆队列，规则与背单词页一致）
function deleteWordFromSavedList(word) {
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === _savedViewId) : null;
    if (!list) return;
    const lower = String(word).toLowerCase();
    const target = (list.words || []).find(w => String(w.word).toLowerCase() === lower);
    if (!target) return;
    showConfirm('确定要从「' + list.name + '」中删除单词「' + target.word + '」吗？', () => {
        list.words = list.words.filter(w => String(w.word).toLowerCase() !== lower);
        if (Array.isArray(list.pendingWords)) {
            list.pendingWords = list.pendingWords.filter(w => String(w.word).toLowerCase() !== lower);
        }
        if (list.selectedWord && String(list.selectedWord.word).toLowerCase() === lower) list.selectedWord = null;
        if (Array.isArray(list.queueWords)) {
            list.queueWords = list.queueWords.filter(w => String(w.word).toLowerCase() !== lower);
        }
        saveSavedListsData(saved);
        renderSavedListView();
        renderSavedLists();
        showToast('已删除单词「' + target.word + '」', 'success');
    });
}

// 点击列表中的单词查看详细（与背单词页同一版式，但无单轮判定区）
function showWordDetail(word) {
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === _savedViewId) : null;
    if (!list) { showToast('未在词表中找到该单词', 'warning'); return; }
    const w = (list.words || []).find(x => String(x.word).toLowerCase() === String(word).toLowerCase());
    if (!w) { showToast('未在词表中找到该单词', 'warning'); return; }
    document.getElementById('wdDetailContent').innerHTML = buildWordDetailHtml(w, list.name);
    window._detailWord = String(word);
    openModal('wordDetailModal');
}

// 删除「我的词典」词表副本（不影响背单词页原词表）
function deleteSavedList(id) {
    const saved = getSavedListsData();
    if (!Array.isArray(saved.lists)) return;
    const list = saved.lists.find(l => l.id === id);
    if (!list) return;
    showConfirm('确定删除词表"' + list.name + '"吗？该词表下的所有单词将被删除，无法恢复！', () => {
        saved.lists = saved.lists.filter(l => l.id !== id);
        saveSavedListsData(saved);
        renderSavedLists();
        showToast('已删除词表"' + list.name + '"', 'success');
    });
}

// 添加单词到词表（word#自定义意思 或查词典）
let _savedAddTargetId = null;
function addWordsToList(id) {
    _savedAddTargetId = id;
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === id) : null;
    const nameEl = document.getElementById('savedAddListName');
    if (nameEl) nameEl.textContent = list ? list.name : '';
    const input = document.getElementById('savedAddInput');
    if (input) input.value = '';
    const failed = document.getElementById('savedAddFailed');
    if (failed) { failed.classList.add('hidden'); failed.innerHTML = ''; }
    openModal('savedAddModal');
}

async function submitSavedAddWords() {
    const input = document.getElementById('savedAddInput');
    const parsed = parseWordInput(input ? input.value : '');
    if (parsed.length === 0) { showToast('请输入单词内容', 'error'); return; }
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === _savedAddTargetId) : null;
    if (!list) { showToast('词表不存在', 'error'); return; }

    // 与背单词页共用同一套解析 / 查词逻辑（word#释义 直接使用，其余查词典）
    const { words, failed, dictMissing } = await buildWordObjects(parsed);
    if (dictMissing) {
        showToast('词典未下载，请先到「我的词典」下载词典；或用 word#释义 填写自定义意思', 'error');
        return;
    }

    // 与背单词页共用同一套追加逻辑（按单词去重，words / pendingWords 同步）
    const addedCount = appendWordsToList(list, words);
    list.words.sort((a, b) => a.word.localeCompare(b.word));
    list.pendingWords.sort((a, b) => a.word.localeCompare(b.word));
    saveSavedListsData(saved);
    if (input) input.value = '';

    renderAddFailed('savedAddFailed', failed);
    showToast('成功添加' + addedCount + '个新单词' + (failed.length ? '，' + failed.length + '个失败' : ''),
        failed.length > 0 ? 'error' : 'success');
    renderSavedLists();
    if (isSavedViewOpen()) renderSavedListView();
}

// ---------- 从 Excel/CSV 导入单词（与背单词页共用导入逻辑） ----------
function triggerSavedExcelImport() {
    const input = document.getElementById('savedExcelFileInput');
    if (input) input.click();
}

async function handleSavedExcelFile(file) {
    if (!file) return;
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === _savedAddTargetId) : null;
    if (!list) { showToast('词表不存在', 'error'); return; }
    let result;
    try {
        result = await importWordsFromFile(file, list);
    } catch (e) {
        console.warn('导入词表文件失败', e);
        showToast(e && e.message ? e.message : '读取文件失败', 'error');
        return;
    }
    // 允许再次选择同一文件触发导入
    const input = document.getElementById('savedExcelFileInput');
    if (input) input.value = '';
    if (result.added === 0) {
        showToast('未导入任何单词（请检查第 1 列为单词、第 2 列为意思）', 'error');
        return;
    }
    saveSavedListsData(saved);
    renderSavedLists();
    if (isSavedViewOpen()) renderSavedListView();
    showToast('成功导入 ' + result.added + ' 个单词' + (result.skipped ? '，跳过 ' + result.skipped + ' 个' : ''), 'success');
}

// 清空当前词表（保留词表本身）
function clearSavedListWords() {
    const saved = getSavedListsData();
    const list = saved && Array.isArray(saved.lists) ? saved.lists.find(l => l.id === _savedAddTargetId) : null;
    if (!list) { showToast('词表不存在', 'error'); return; }
    if ((list.words || []).length === 0) { showToast('词表已经是空的', 'warning'); return; }
    showConfirm('确定清空「' + list.name + '」中的全部单词吗？此操作无法恢复！', () => {
        // 与背单词页清空词表保持同一规则：连同待抽取队列 / 选中单词 / 记忆队列 / 单轮判定一并清空
        list.words = [];
        list.pendingWords = [];
        list.selectedWord = null;
        list.queueWords = [];
        list.roundKnown = [];
        list.roundUnknown = [];
        saveSavedListsData(saved);
        renderSavedLists();
        if (isSavedViewOpen()) renderSavedListView();
        showToast('已清空词表「' + list.name + '」', 'success');
    });
}

// 查看弹窗是否打开（用于添加/导入/删除后联动刷新）
function isSavedViewOpen() {
    const modal = document.getElementById('savedViewModal');
    return !!(modal && modal.classList.contains('visible'));
}

// 添加到词表：把该词表的单词合并进另一个「我的词典」词表（按单词去重）
let _savedMergeFromId = null;
function showAddToListModal(id) {
    const saved = getSavedListsData();
    const lists = saved && Array.isArray(saved.lists) ? saved.lists : [];
    const others = lists.filter(l => l.id !== id);
    if (others.length === 0) { showToast('没有其他词表可添加', 'error'); return; }
    _savedMergeFromId = id;
    const sel = document.getElementById('savedMergeSelect');
    if (sel) {
        sel.innerHTML = others.map(l => '<option value="' + l.id + '">' + escapeHtml(l.name) + '（' + (l.words || []).length + '词）</option>').join('');
    }
    openModal('savedMergeModal');
}

function doMergeToList() {
    const saved = getSavedListsData();
    if (!Array.isArray(saved.lists)) return;
    const sel = document.getElementById('savedMergeSelect');
    const targetId = sel ? sel.value : '';
    if (!targetId) { showToast('请选择目标词表', 'error'); return; }
    const from = saved.lists.find(l => l.id === _savedMergeFromId);
    const target = saved.lists.find(l => l.id === targetId);
    if (!from || !target) { showToast('词表不存在', 'error'); return; }
    if (!Array.isArray(from.words)) from.words = [];
    if (!Array.isArray(target.words)) target.words = [];
    if (!Array.isArray(target.pendingWords)) target.pendingWords = [];
    const existing = new Set(target.words.map(w => String(w.word).toLowerCase()));
    let added = 0;
    from.words.forEach(w => {
        const key = String(w.word).toLowerCase();
        if (existing.has(key)) return;
        const copy = {
            word: w.word,
            meaning: w.meaning || '',
            mnemonic: w.mnemonic || null,
            phonetic: w.phonetic || ''
        };
        target.words.push(copy);
        target.pendingWords.push(copy);
        existing.add(key);
        added++;
    });
    target.words.sort((a, b) => a.word.localeCompare(b.word));
    target.pendingWords.sort((a, b) => a.word.localeCompare(b.word));
    saveSavedListsData(saved);
    closeModal('savedMergeModal');
    showToast('已将「' + from.name + '」的 ' + added + ' 个单词添加到「' + target.name + '」', 'success');
    renderSavedLists();
}

// 忙时禁用全部按钮并显示提示
function setBusy(busy, text) {
    const tip = document.getElementById('dictBusyTip');
    if (tip) {
        tip.textContent = busy ? text : '';
        tip.style.display = busy ? 'block' : 'none';
    }
    document.querySelectorAll('#dictList button').forEach(b => { b.disabled = true; });
}

document.addEventListener('DOMContentLoaded', async () => {
    await initWordDataCache(); // 加载共享词表数据（无则创建默认词表）
    await initSavedListsCache(); // 加载「我的词典」词表数据（独立 key）
    await renderDictList();
    renderPresetSection();
    renderSavedLists();
    hideLoading(); // 初始化完成，隐藏加载遮罩
    window.addEventListener('dictReady', async () => {
        await renderDictList();
        renderPresetSection();
        renderSavedLists();
    });
});
