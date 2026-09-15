// ---------- 我的词典：词典管理 ----------
// 词典目录定义见 common.js 的 DICT_CATALOG（在此扩展多本词典）

let _mylistsBusy = false;

// 重新下载图标（刷新）
const REFRESH_ICON = '<svg width="1em" height="1em" viewBox="0 0 20 20" fill="currentColor"><path d="M6.2 4.1a.5.5 0 01-.1.7 6.5 6.5 0 003.66 11.7h.38l-1.55-1.55a.5.5 0 11.7-.7l2.12 2.11c.2.2.2.52 0 .71L9.3 19.2a.5.5 0 11-.7-.7l1-1A7.5 7.5 0 015.5 3.99a.5.5 0 01.7.1zM11.42.8c.2.2.2.52 0 .71l-1 1a7.5 7.5 0 014.07 13.5.5.5 0 11-.59-.8 6.5 6.5 0 00-3.66-11.7l-.3-.01a.5.5 0 01-.07 0l1.55 1.55a.5.5 0 11-.7.7L8.59 3.65a.5.5 0 010-.71L10.7.8c.2-.2.5-.2.7 0z"></path></svg>';

// 预设词表展开箭头（向下）
const PRESET_ARROW_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

// 渲染词典列表：先渲染全部词典行（状态"检测中"、按钮全部禁用），再并行查询下载状态逐本更新
async function renderDictList() {
    const container = document.getElementById('dictList');
    if (!container) return;

    container.innerHTML = DICT_CATALOG.map(dict => {
        // 该词典对应的预设词表
        const presets = (dict.presets || []).map(tag => getPresetListByTag(tag)).filter(Boolean);
        const presetChips = presets.map(p =>
            '<button type="button" class="preset-chip" onclick="createFromPresetTag(\'' + p.tag + '\')">' +
            escapeHtml(p.name) + '<span class="cnt">' + p.count + '词</span></button>'
        ).join('');
        return '<div class="dict-row" data-dict="' + dict.id + '" onclick="onDictRowClick(\'' + dict.id + '\', event)">' +
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
        // 箭头：垂直居中的视觉指示（点击整行任意处触发）
        '  <button type="button" class="dict-preset-btn" title="预设词表">' + PRESET_ARROW_ICON + '</button>' +
        '</div>' +
        // 行下方深色展开区（文档流内，展开时把下方内容往下推）
        '<div class="dict-preset-expand" id="presetExpand_' + dict.id + '" style="display:none;">' +
        '  <div class="preset-tip">点击预设词表创建词表，可在背单词页查看</div>' +
        '  <div class="preset-chips">' + presetChips + '</div>' +
        '</div>';
    }).join('');

    // 并行查询每本词典的下载状态
    await Promise.all(DICT_CATALOG.map(async (dict) => {
        const loaded = await isDictLoaded(dict.id);
        const row = container.querySelector('.dict-row[data-dict="' + dict.id + '"]');
        if (!row) return;
        const statusEl = row.querySelector('.dict-status');
        const countEl = row.querySelector('.dict-count');
        const reloadBtn = row.querySelector('.reload-icon');
        const btns = row.querySelectorAll('.dict-actions button');
        if (loaded) {
            const cnt = await countDictEntries(dict.id);
            statusEl.textContent = '已下载';
            statusEl.classList.add('ok');
            // "共 x / y 词"单独显示，不与"已下载"拼接：x 为实际条数，y 为目录应有数量
            countEl.textContent = '共 ' + cnt.toLocaleString('en-US') + ' / ' + (dict.expectedCount || '') + ' 词';
            // reload 在操作组外；actions 内：0=下载、1=删除
            reloadBtn.disabled = false;  // 重新下载可用
            btns[0].disabled = true;     // 下载禁用
            btns[1].disabled = false;    // 删除可用
        } else {
            statusEl.textContent = '未下载';
            countEl.textContent = '';
            reloadBtn.disabled = true;   // 重新下载禁用（无数据可重下）
            btns[0].disabled = false;    // 下载可用
            btns[1].disabled = true;     // 删除禁用
        }
    }));
}

// 下载并导入指定词典（复用 common.js 的导入链路，含进度提示）
async function downloadDict(id) {
    if (_mylistsBusy) return;
    _mylistsBusy = true;
    setBusy(true, '正在下载并导入词典（约需1-3分钟），请勿关闭页面...');
    try {
        await autoImportDictFromCSV(id);
        if (await isDictLoaded(id)) {
            showToast('词典下载完成', 'success');
        } else {
            showToast('下载失败：未能获取词典文件，请检查网络后重试', 'error');
        }
    } catch (e) {
        console.warn('下载词典失败', e);
        showToast('下载失败：' + e.message, 'error');
    } finally {
        _mylistsBusy = false;
        setBusy(false);
        await renderDictList();
    }
}

// 重新下载指定词典：清空该词典库并重新导入
function reloadDict(id) {
    if (_mylistsBusy) return;
    const dict = getDictById(id);
    showConfirm('将清空「' + dict.name + '」并重新下载（约需1-3分钟），是否继续？', async () => {
        _mylistsBusy = true;
        setBusy(true, '正在重新下载词典...');
        try {
            const db = await openDictDB(id);
            await new Promise((resolve, reject) => {
                const tx = db.transaction(DICT_STORE_WORDS, 'readwrite');
                tx.objectStore(DICT_STORE_WORDS).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
            // 重置内存状态，强制重新导入
            window.dictLoaded = false;
            window.dictData = null;
            window.dictLoading = false;
            window.dictAutoImporting = false;
            await autoImportDictFromCSV(id);
            if (await isDictLoaded(id)) {
                showToast('词典已重新下载', 'success');
            } else {
                showToast('重新下载失败：未能获取词典文件，请检查网络后重试', 'error');
            }
        } catch (e) {
            console.warn('重新下载词典失败', e);
            showToast('重新下载失败：' + e.message, 'error');
        } finally {
            _mylistsBusy = false;
            setBusy(false);
            await renderDictList();
        }
    });
}

// 删除指定词典（删除其 IndexedDB 库）
function deleteDict(id) {
    if (_mylistsBusy) return;
    showConfirm('确定删除已下载的词典吗？删除后需重新下载才能查词。', async () => {
        _mylistsBusy = true;
        setBusy(true, '正在删除词典...');
        try {
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(dictDBName(id));
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error('词典库删除被阻塞，请先关闭其他页面再试'));
            });
            window.dictLoaded = false;
            if (window.dictData) window.dictData.clear();
            showToast('词典已删除', 'success');
        } catch (e) {
            console.warn('删除词典失败', e);
            showToast('删除失败：' + e.message, 'error');
        } finally {
            _mylistsBusy = false;
            setBusy(false);
            await renderDictList();
        }
    });
}

// 点击词典行任意处展开/收起预设词表（操作按钮区域除外）
function onDictRowClick(id, event) {
    if (event.target.closest('.dict-actions')) return;
    togglePresetPanel(id);
}

// 收起单个展开区（带动画，动画结束后隐藏）
function closeOnePresetPanel(panel) {
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        setTimeout(() => { if (!panel.classList.contains('open')) panel.style.display = 'none'; }, 250);
    } else {
        panel.style.display = 'none';
    }
}

// 展开/收起预设词表展开区（同一时间只展开一个）
function togglePresetPanel(id) {
    document.querySelectorAll('.dict-preset-expand').forEach(el => {
        if (el.id !== 'presetExpand_' + id) closeOnePresetPanel(el);
    });
    document.querySelectorAll('.dict-preset-btn.open').forEach(b => b.classList.remove('open'));
    const panel = document.getElementById('presetExpand_' + id);
    if (panel) {
        const open = panel.classList.contains('open') || panel.style.display === 'block';
        if (open) {
            closeOnePresetPanel(panel);
        } else {
            panel.style.display = 'block';
            setTimeout(() => panel.classList.add('open'), 20); // 下一帧加展开类，触发过渡动画
            const btn = document.querySelector('.dict-row[data-dict="' + id + '"] .dict-preset-btn');
            if (btn) btn.classList.add('open');
        }
    }
}

// 收起全部展开区
function closeAllPresetPanels() {
    document.querySelectorAll('.dict-preset-expand').forEach(el => closeOnePresetPanel(el));
    document.querySelectorAll('.dict-preset-btn.open').forEach(b => b.classList.remove('open'));
}

// 点击词典行或展开区以外区域时收起
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dict-row') && !e.target.closest('.dict-preset-expand')) {
        closeAllPresetPanels();
    }
});

// 点击预设词表项，创建词表并写入共享词表库（背单词页可看到）
function createFromPresetTag(tag) {
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
    const words = preset.words.map(w => ({
        word: w.word,
        meaning: normalizeNewlines(w.translation || '(无释义)'),
        mnemonic: null
    }));
    const name = uniqueListName(preset.name);
    const newList = {
        id: genListId(),
        name: name,
        words: words,
        pendingWords: [...words],
        selectedWord: null
    };
    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    closeAllPresetPanels();
    showToast('已创建词表"' + name + '"，共' + words.length + '个单词，可在背单词页查看', 'success');
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
    await renderDictList();
    window.addEventListener('dictReady', async () => { await renderDictList(); });
});
