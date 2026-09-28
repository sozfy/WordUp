# -*- coding: utf-8 -*-
import io

def read_lf(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()
def write_lf(p, t):
    assert '\r' not in t
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)

root = r'C:\Users\30746\Desktop\背单词'

p_css = root + r'\css\style.css'
c = read_lf(p_css).replace('\r\n', '\n')  # 归一化孤立 CRLF
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

# bump css v112 -> v113 in four HTML
for f in ['WordMemorizer.html', 'MyLists.html', 'DictLookup.html', 'index.html']:
    fp = root + '\\' + f
    t = read_lf(fp)
    t2 = t.replace('css/style.css?v=112', 'css/style.css?v=113')
    if t2 != t:
        write_lf(fp, t2)
print('bumped css v113')
