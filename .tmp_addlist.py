# -*- coding: utf-8 -*-
import io, re

def read_lf(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()
def write_lf(p, t):
    assert '\r' not in t
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)

root = r'C:\Users\30746\Desktop\背单词'

# ---- 1. MyLists.html: 添加"新建词表"卡片 + 新建弹窗 ----
p_html = root + r'\MyLists.html'
h = read_lf(p_html)

old_container = """                <div id="savedListContainer" class="dict-list"></div>
            </div>"""
new_container = """                <div id="savedListContainer" class="dict-list"></div>
                <div class="saved-add-list-card" onclick="showCreateSavedListModal()" title="新建词表">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"></path></svg>
                </div>
            </div>"""
assert old_container in h, 'MISS container'
h = h.replace(old_container, new_container, 1)

# 在 savedAddModal 前插入新建词表弹窗
old_modal_anchor = """    <!-- 词表添加单词弹窗 -->
    <div class="modal-overlay" id="savedAddModal">"""
new_modal = """    <!-- 新建词表弹窗 -->
    <div class="modal-overlay" id="savedCreateModal">
        <div class="modal">
            <div class="modal-header">
                <span>新建词表</span>
                <button class="modal-close" onclick="myCloseModal('savedCreateModal')"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2.59 2.72l.06-.07a.5.5 0 01.63-.06l.07.06L8 7.29l4.65-4.64a.5.5 0 01.7.7L8.71 8l4.64 4.65c.18.17.2.44.06.63l-.06.07a.5.5 0 01-.63.06l-.07-.06L8 8.71l-4.65 4.64a.5.5 0 01-.7-.7L7.29 8 2.65 3.35a.5.5 0 01-.06-.63l.06-.07-.06.07z"></path></svg></button>
            </div>
            <div class="modal-body">
                <p class="tip">输入词表名称，创建后出现在「我的词表」中</p>
                <input type="text" id="savedCreateName" placeholder="词表名称" style="width:100%;box-sizing:border-box;margin-bottom:10px;">
                <div style="display: flex; gap: 8px; width: 100%;">
                    <button onclick="doCreateSavedList()">创建</button>
                    <button onclick="myCloseModal('savedCreateModal')">取消</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 词表添加单词弹窗 -->
    <div class="modal-overlay" id="savedAddModal">"""
assert old_modal_anchor in h, 'MISS modal anchor'
h = h.replace(old_modal_anchor, new_modal, 1)
h = h.replace('js/mylists.js?v=16', 'js/mylists.js?v=17', 1)
write_lf(p_html, h)
print('html ok')

# ---- 2. mylists.js: 新建词表函数 ----
p_js = root + r'\js\mylists.js'
j = read_lf(p_js)

anchor = """function myOpenModal(id) {"""
new_funcs = """// 新建词表（我的词表）
function showCreateSavedListModal() {
    const nameInput = document.getElementById('savedCreateName');
    if (nameInput) nameInput.value = '';
    myOpenModal('savedCreateModal');
}
function doCreateSavedList() {
    const data = getWordData();
    const nameInput = document.getElementById('savedCreateName');
    const name = (nameInput.value || '').trim();
    if (!name) { showToast('请输入词表名称', 'warning'); return; }
    let finalName = name;
    let seq = 2;
    while (data.lists.some(l => l.name === finalName)) { finalName = name + seq; seq++; }
    const newList = {
        id: genListId(),
        name: finalName,
        words: [],
        pendingWords: [],
        selectedWord: null,
        queueWords: [],
        savedToDict: true
    };
    data.lists.push(newList);
    saveWordData(data);
    myCloseModal('savedCreateModal');
    renderSavedLists();
    showToast('已创建词表"' + finalName + '"', 'success');
}

function myOpenModal(id) {"""
assert anchor in j, 'MISS js anchor'
j = j.replace(anchor, new_funcs, 1)
write_lf(p_js, j)
print('js ok')

# ---- 3. css/style.css: 新建词表卡片样式 ----
p_css = root + r'\css\style.css'
c = read_lf(p_css)
css_add = """
.saved-add-list-card {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 0;
    margin-top: 10px;
    background-color: var(--bg-panel);
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
}
.saved-add-list-card:hover {
    background-color: rgba(255,255,255,.05);
    color: var(--accent);
}
@media (max-width: 480px) {
    .saved-add-list-card {
        padding: 14px 0;
    }
}
"""
assert c.rstrip().endswith('}')
c = c.rstrip() + '\n' + css_add
write_lf(p_css, c)
print('css ok')

# ---- 4. bump css v112 -> v113 in four HTML ----
for f in ['WordMemorizer.html', 'MyLists.html', 'DictLookup.html', 'index.html']:
    fp = root + '\\' + f
    t = read_lf(fp)
    t2 = t.replace('css/style.css?v=112', 'css/style.css?v=113')
    if t2 != t:
        write_lf(fp, t2)
print('bumped css v113')
