/*! Rendra IDE v1.1.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// DevCode tab — a small VS Code-like workspace manager.
//
// Several workspaces live side by side as tabs (rename with double-click). Each one has:
//   left:   folder explorer (lazy tree)
//   middle: terminals in a 1–4 column grid, reorderable with ◀ ▶
//   right:  Monaco editor groups with tabs, shown once a file is opened (Ctrl+\ splits)
// Closing a tab, a workspace or the app with unsaved files asks Salvar / Não salvar / Cancelar.
// All file and process access goes through window.rendra.dev (main process).

(() => {
  const dev = window.rendra.dev;
  const $ = id => document.getElementById(id);
  const MAX_GROUPS = 3;
  const MONACO_BASE = '../node_modules/monaco-editor/min/vs';

  const workspaces = [];
  let activeWs = null;
  let nextWsId = 1;
  let initialized = false;
  let monaco = null;
  let monacoLoading = null;
  const files = new Map(); // path → { model, savedVersion, name } (shared by all workspaces)
  const ptyOwner = new Map(); // pty id → { ws, term }

  const toast = msg => (typeof showToast === 'function' ? showToast(msg) : console.log(msg));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const baseName = p => p.split(/[\\/]/).pop();
  const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  // ── Confirmation modal (save prompt, closing terminals/workspaces) ─────────
  // buttons: [{ choice, label, primary }]; Esc = 'cancel', Enter = the primary button
  function askChoice({ title, body, buttons }) {
    return new Promise(resolve => {
      const overlay = $('save-overlay');
      $('save-title').textContent = title;
      $('save-body').innerHTML = body;
      $('save-actions').innerHTML = buttons.map(b =>
        `<button class="btn ${b.primary ? 'btn-primary' : 'btn-secondary'}" data-choice="${b.choice}" type="button">${esc(b.label)}</button>`).join('');
      const primary = buttons.find(b => b.primary)?.choice || buttons[buttons.length - 1].choice;
      overlay.classList.add('visible');
      const done = choice => {
        overlay.classList.remove('visible');
        overlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        resolve(choice);
      };
      const onClick = e => {
        const btn = e.target.closest('[data-choice]');
        if (btn) done(btn.dataset.choice);
        else if (e.target === overlay) done('cancel');
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); done('cancel'); }
        if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(primary); }
      };
      overlay.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
      overlay.querySelector(`[data-choice="${primary}"]`).focus();
    });
  }

  function askSave(names) {
    return askChoice({
      title: names.length === 1 ? 'Salvar alterações?' : `Salvar ${names.length} arquivos?`,
      body: names.length === 1
        ? `<b>${esc(names[0])}</b> tem alterações não salvas. Sem salvar, elas serão perdidas.`
        : `Estes arquivos têm alterações não salvas:<ul>${names.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`,
      buttons: [
        { choice: 'cancel', label: 'Cancelar' },
        { choice: 'discard', label: 'Não salvar' },
        { choice: 'save', label: 'Salvar', primary: true },
      ],
    });
  }

  const askCloseTerminals = (title, body) => askChoice({
    title, body,
    buttons: [{ choice: 'cancel', label: 'Cancelar' }, { choice: 'close', label: 'Fechar', primary: true }],
  }).then(c => c === 'close');

  const isDirty = p => { const f = files.get(p); return !!f && f.model.getAlternativeVersionId() !== f.savedVersion; };

  async function saveFile(filePath, quiet) {
    const entry = files.get(filePath);
    if (!entry) return true;
    const res = await dev.write(filePath, entry.model.getValue());
    if (!res.ok) { toast(`Erro ao salvar ${entry.name}: ${res.error}`); return false; }
    entry.savedVersion = entry.model.getAlternativeVersionId();
    renderAllTabs();
    if (!quiet) toast(`${entry.name} salvo`);
    return true;
  }

  // Asks about the dirty ones among `paths`; resolves true when it is fine to close them
  async function confirmClose(paths) {
    const dirty = paths.filter(isDirty);
    if (!dirty.length) return true;
    const choice = await askSave(dirty.map(baseName));
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const p of dirty) if (!(await saveFile(p, true))) return false;
    }
    return true;
  }

  // Main process asks these before the window closes
  dev.onQueryDirty(() => [...files.keys()].filter(isDirty).map(baseName));
  dev.onSaveAll(async () => {
    for (const p of [...files.keys()].filter(isDirty)) {
      if (!(await saveFile(p, true))) return { ok: false, error: `Não foi possível salvar ${baseName(p)}` };
    }
    return { ok: true };
  });

  // ── Monaco (lazy AMD load on first file open) ──────────────────────────────
  function loadMonaco() {
    if (monaco) return Promise.resolve(monaco);
    if (monacoLoading) return monacoLoading;
    monacoLoading = new Promise((resolve, reject) => {
      // Workers can't importScripts from file://, so language services run on the main thread
      window.MonacoEnvironment = { getWorker: () => { throw new Error('no workers'); } };
      const s = document.createElement('script');
      s.src = `${MONACO_BASE}/loader.js`;
      s.onerror = () => reject(new Error('Não foi possível carregar o editor'));
      s.onload = () => {
        window.require.config({ paths: { vs: MONACO_BASE } });
        window.require(['vs/editor/editor.main'], () => {
          monaco = window.monaco;
          monaco.editor.defineTheme('rendra', {
            base: 'vs-dark',
            inherit: true,
            rules: [{ token: 'comment', foreground: '707070', fontStyle: 'italic' }],
            colors: {
              'editor.background': '#161616',
              'editor.foreground': '#e8e8e8',
              'editorLineNumber.foreground': '#4a4a4a',
              'editorLineNumber.activeForeground': '#b0b0b0',
              'editorCursor.foreground': '#e8650a',
              'editor.selectionBackground': '#e8650a40',
              'editor.lineHighlightBackground': '#1e1e1e',
              'editorIndentGuide.background1': '#262626',
              'editorWidget.background': '#1e1e1e',
              'editorWidget.border': '#3d3d3d',
              'minimap.background': '#161616',
              'scrollbarSlider.background': '#3d3d3d80',
            },
          });
          resolve(monaco);
        }, reject);
      };
      document.head.appendChild(s);
    });
    return monacoLoading;
  }

  // ── Workspaces ─────────────────────────────────────────────────────────────
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => dev.saveWorkspaces({
      list: workspaces.map(ws => ({
        name: ws.name, custom: ws.custom, cols: ws.cols, root: ws.root?.root || null,
        wsl: ws.root?.wsl?.viaWindows ? { distro: ws.root.wsl.distro, linuxPath: ws.root.wsl.linuxPath } : null,
        // workspaces never activated this run keep the tabs they were restored with
        groups: ws.restore || ws.groups.map(g => ({ tabs: g.tabs, active: g.active })),
      })),
      active: Math.max(0, workspaces.indexOf(activeWs)),
    }), 300);
  }

  // Reopen the editor tabs a workspace had when the app was closed
  async function restoreTabs(ws) {
    const groups = (ws.restore || []).filter(g => g.tabs?.length);
    ws.restore = null;
    for (const g of groups) {
      let group = null;
      for (const p of g.tabs) {
        if (!group) {
          await openFile(ws, p, { newGroup: ws.groups.length > 0 });
          group = ws.groups.find(x => x.tabs.includes(p)) || null;
        } else {
          await openFile(ws, p, { group });
        }
      }
      if (group && g.active && group.tabs.includes(g.active)) showInGroup(ws, group, g.active);
    }
  }

  function createWorkspace({ name, custom, cols, root, groups } = {}) {
    const ws = {
      id: nextWsId++,
      name: name || root?.name || `Workspace ${nextWsId - 1}`,
      custom: !!custom,
      cols: Math.min(Math.max(cols || 1, 1), 4),
      root: root || null,
      expanded: new Set(root ? [root.root] : []),
      groups: [],
      activeGroup: null,
      nextGroupId: 1,
      terms: [],
      termCount: 0,
      started: false,
      restore: groups && groups.length ? groups : null,
      git: null,
      el: null,
      refs: {},
    };
    buildWorkspaceDom(ws);
    workspaces.push(ws);
    renderWsTabs();
    watchWorkspace(ws);
    return ws;
  }

  function buildWorkspaceDom(ws) {
    const el = document.createElement('div');
    el.className = 'ws';
    // Default split: folders 25% · terminals 50% · editor 25% (all draggable)
    el.style.setProperty('--ex-w', lsGet('dev.layout.explorer', '25%'));
    el.style.setProperty('--ed-w', lsGet('dev.layout.editor', '25%'));
    el.innerHTML = `
      <aside class="dev-explorer">
        <div class="dev-panel-head">
          <span class="dev-panel-title">Explorador</span>
          <div class="dev-panel-actions">
            <button class="dev-icon-btn" data-act="open" title="Abrir pasta">📂</button>
            <button class="dev-icon-btn" data-act="refresh" title="Atualizar">↻</button>
            <button class="dev-icon-btn" data-act="collapse" title="Recolher tudo">⊟</button>
          </div>
        </div>
        <div class="dev-root-name"></div>
        <div class="dev-tree"></div>
      </aside>
      <div class="dev-splitter" data-split="explorer" title="Arraste para redimensionar"></div>
      ${terminalSectionHtml()}
      <div class="dev-splitter" data-split="editor" title="Arraste para redimensionar"></div>
      <section class="dev-editors"><div class="dev-editor-empty">Clique num arquivo do explorador para editar aqui</div></section>`;
    $('ws-host').appendChild(el);
    ws.el = el;
    ws.refs = {
      tree: el.querySelector('.dev-tree'),
      rootName: el.querySelector('.dev-root-name'),
      grid: el.querySelector('.dev-term-grid'),
      termTabs: el.querySelector('.dev-term-tabs'),
      editors: el.querySelector('.dev-editors'),
    };

    el.querySelector('[data-act=open]').addEventListener('click', () => pickFolder(ws));
    el.querySelector('[data-act=refresh]').addEventListener('click', () => renderTree(ws));
    el.querySelector('[data-act=collapse]').addEventListener('click', () => {
      if (!ws.root) return;
      ws.expanded = new Set([ws.root.root]);
      renderTree(ws);
    });
    wireTerminalSection(ws, el, persist);
    ws.refs.tree.addEventListener('click', e => onTreeClick(ws, e));
    el.querySelectorAll('.dev-splitter').forEach(sp => initSplitter(ws, sp));
    renderTree(ws);
    layoutTerminals(ws);
  }

  // Terminal panel (tabs, 1–4 columns, shell picker, ＋): shared by DevCode workspaces and the
  // standalone Terminal page
  function terminalSectionHtml() {
    return `
      <section class="dev-terms">
        <div class="dev-panel-head">
          <span class="dev-panel-title">Terminais</span>
          <div class="dev-term-tabs"></div>
          <div class="dev-panel-actions">
            <div class="dev-cols" title="Colunas de terminais">
              ${[1, 2, 3, 4].map(n => `<button class="dev-col-btn" data-cols="${n}">${n}</button>`).join('')}
            </div>
            <select class="dev-shell-select" title="Shell dos novos terminais"></select>
            <button class="dev-icon-btn" data-act="new-term" title="Novo terminal">＋</button>
          </div>
        </div>
        <div class="dev-term-grid"></div>
      </section>`;
  }

  function wireTerminalSection(ws, el, onColsChange) {
    el.querySelector('[data-act=new-term]').addEventListener('click', () => newTerminal(ws));
    // Shell picker: shared default, remembered across restarts
    const shellSel = el.querySelector('.dev-shell-select');
    shellsReady.then(list => {
      shellSel.innerHTML = list.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
      shellSel.value = list.some(s => s.key === lsGet('dev.shell', '')) ? lsGet('dev.shell', '') : list[0]?.key;
    });
    shellSel.addEventListener('change', () => {
      lsSet('dev.shell', shellSel.value);
      document.querySelectorAll('.dev-shell-select').forEach(s => { s.value = shellSel.value; });
    });
    el.querySelectorAll('.dev-col-btn').forEach(b => b.addEventListener('click', () => {
      ws.cols = +b.dataset.cols;
      layoutTerminals(ws);
      onColsChange?.();
    }));
  }

  // ── Terminal page: terminals only, no folder, no Claude/Codex needed ──────
  // Reuses the workspace terminal machinery with a folder-less workspace (starts in home)
  let terminalPage = null;
  function activateTerminalPage() {
    if (!terminalPage) {
      const host = $('term-page');
      host.innerHTML = terminalSectionHtml();
      terminalPage = {
        id: 'terminal-page', name: 'Terminal', root: null, custom: true,
        cols: Math.min(Math.max(+lsGet('term.cols', '1') || 1, 1), 4),
        groups: [], terms: [], termCount: 0, el: host,
        refs: { grid: host.querySelector('.dev-term-grid'), termTabs: host.querySelector('.dev-term-tabs') },
      };
      wireTerminalSection(terminalPage, host, () => lsSet('term.cols', String(terminalPage.cols)));
      layoutTerminals(terminalPage);
      newTerminal(terminalPage);
      return;
    }
    requestAnimationFrame(() => terminalPage.terms.forEach(fitTerm));
    if (!terminalPage.terms.length) newTerminal(terminalPage);
  }

  function activateWorkspace(ws) {
    activeWs = ws;
    workspaces.forEach(w => w.el.classList.toggle('active', w === ws));
    renderWsTabs();
    if (!ws.started) {
      ws.started = true;
      newTerminal(ws); // starts in the workspace folder
      if (ws.restore) restoreTabs(ws);
    }
    requestAnimationFrame(() => {
      ws.terms.forEach(t => fitTerm(t));
      ws.groups.forEach(g => g.editor.layout());
    });
    persist();
  }

  async function closeWorkspace(ws) {
    // Files open only in this workspace get the save prompt; shared ones stay open elsewhere
    const own = new Set(ws.groups.flatMap(g => g.tabs));
    const exclusive = [...own].filter(p => !workspaces.some(w => w !== ws && w.groups.some(g => g.tabs.includes(p))));
    const hasDirty = exclusive.some(isDirty);
    if (!(await confirmClose(exclusive))) return;
    // No unsaved files to ask about, but running terminals would be killed: confirm that instead
    const alive = ws.terms.filter(t => t.alive).length;
    if (!hasDirty && alive && !(await askCloseTerminals(
      `Fechar o workspace ${ws.name}?`,
      `${alive === 1 ? 'O terminal aberto será encerrado' : `Os ${alive} terminais abertos serão encerrados`}, junto com o que estiver rodando neles.`,
    ))) return;
    for (const t of [...ws.terms]) await killTerminal(ws, t);
    ws.groups.forEach(g => g.editor.dispose());
    exclusive.forEach(p => { files.get(p)?.model.dispose(); files.delete(p); });
    ws.el.remove();
    const idx = workspaces.indexOf(ws);
    workspaces.splice(idx, 1);
    unwatchIfUnused(ws.root?.root);
    if (!workspaces.length) createWorkspace();
    activateWorkspace(workspaces[Math.min(idx, workspaces.length - 1)]);
  }

  function renderWsTabs() {
    $('ws-tabs').innerHTML = workspaces.map(ws => `
      <div class="ws-tab${ws === activeWs ? ' active' : ''}" data-id="${ws.id}" title="${esc(ws.root?.root || 'Sem pasta')}${ws.root?.wsl ? ` · WSL ${esc(ws.root.wsl.distro)}: ${esc(ws.root.wsl.linuxPath)}` : ''}">
        ${ws.root?.wsl ? '<span class="ws-tab-badge">WSL</span>' : ''}
        <span class="ws-tab-name">${esc(ws.name)}</span>
        <span class="ws-tab-close" title="Fechar workspace">×</span>
      </div>`).join('');
  }

  function startRename(ws, tabEl) {
    const nameEl = tabEl.querySelector('.ws-tab-name');
    const input = document.createElement('input');
    input.className = 'ws-rename';
    input.value = ws.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = commit => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (commit && v) { ws.name = v; ws.custom = true; persist(); }
      renderWsTabs();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ── Explorer ───────────────────────────────────────────────────────────────
  // With WSL installed, ask Windows or WSL first; with several distros, ask which one
  async function chooseFolderTarget() {
    let info;
    try { info = await dev.wslInfo(); } catch { info = null; }
    if (!info?.available) return {};
    const where = await askChoice({
      title: 'Abrir pasta',
      body: 'Onde está o projeto? No WSL, o terminal e o Git rodam dentro do Linux.',
      buttons: [
        { choice: 'cancel', label: 'Cancelar' },
        { choice: 'wsl', label: 'WSL (Linux)' },
        { choice: 'windows', label: 'Windows', primary: true },
      ],
    });
    if (where === 'cancel') return null;
    if (where === 'windows') return {};
    let distro = info.distros[0].name;
    if (info.distros.length > 1) {
      distro = await askChoice({
        title: 'Escolha a distribuição WSL',
        body: 'Há mais de uma distribuição Linux instalada.',
        buttons: [
          { choice: 'cancel', label: 'Cancelar' },
          ...info.distros.map(d => ({ choice: d.name, label: d.name + (d.isDefault ? ' (padrão)' : ''), primary: d.isDefault })),
        ],
      });
      if (distro === 'cancel') return null;
    }
    const mount = await ensureWslMount(distro);
    if (mount === false) return null;
    return { distro, useMount: !!mount };
  }

  // First WSL use per distro: offer to point at the Windows projects folder, which the Linux
  // side reaches at /mnt/<drive>/… (asked once; the dialog then always starts there)
  async function ensureWslMount(distro) {
    const existing = await dev.wslMountGet(distro);
    if (existing) return existing;
    if (lsGet(`dev.wslMountAsked.${distro}`, '')) return null;
    const choice = await askChoice({
      title: 'Seus projetos ficam no Windows?',
      body: `Escolha a pasta do Windows onde ficam seus projetos (por exemplo <b>C:\\Projetos</b>). ` +
        `Ela fica disponível dentro do Linux (${esc(distro)}) e, a partir de agora, ao abrir pelo WSL ` +
        `o DevCode já começa nela. Os arquivos continuam no Windows; o terminal roda no Linux.`,
      buttons: [
        { choice: 'cancel', label: 'Cancelar' },
        { choice: 'linux', label: 'Meus projetos estão no Linux' },
        { choice: 'windows', label: 'Escolher pasta do Windows', primary: true },
      ],
    });
    if (choice === 'cancel') return false;
    lsSet(`dev.wslMountAsked.${distro}`, '1');
    if (choice === 'linux') return null;
    const mount = await dev.wslMountSet(distro);
    if (!mount) return null;
    if (mount.error) { toast(mount.error); return null; }
    toast(`Pasta montada no Linux em ${mount.linuxPath}${mount.link ? ` (atalho ${mount.link.replace(/^\/home\/[^/]+/, '~')})` : ''}`);
    return mount;
  }

  const sq = s => s.replace(/'/g, "''");
  // How each shell changes directory to a workspace folder (Windows path or WSL UNC share)
  function cdCommand(t, root) {
    const p = root.root;
    switch (t.shellKey) {
      case 'gitbash': return `cd "$(cygpath -u '${p.replace(/'/g, "'\\''")}')"\r`;
      case 'cmd': return `cd /d "${p}"\r`;
      case 'wsl': return root.wsl ? `cd '${root.wsl.linuxPath.replace(/'/g, "'\\''")}'\r` : `cd "$(wslpath '${p.replace(/'/g, "'\\''")}')"\r`;
      case 'powershell': return `Set-Location -LiteralPath '${sq(p)}'\r`;
      // macOS / Linux shells (zsh, bash, fish…)
      default: return `cd '${p.replace(/'/g, "'\\''")}'\r`;
    }
  }

  async function pickFolder(ws) {
    const target = await chooseFolderTarget();
    if (!target) return;
    if (target.distro) toast(`Abrindo o WSL ${target.distro}…`);
    const result = await dev.openFolder(target);
    if (!result) return;
    const previous = ws.root?.root;
    ws.root = result;
    unwatchIfUnused(previous);
    watchWorkspace(ws);
    ws.expanded = new Set([result.root]);
    if (!ws.custom) ws.name = result.name;
    renderWsTabs();
    await renderTree(ws);
    // Existing terminals follow the workspace into the new folder…
    ws.terms.filter(t => t.alive).forEach(t => dev.ptyWrite(t.id, cdCommand(t, result)));
    // …and a WSL project gets a Linux terminal if it has none yet
    if (result.wsl && !ws.terms.some(t => t.alive && t.shellKey === 'wsl')) newTerminal(ws);
    persist();
  }

  async function renderTree(ws) {
    const { tree, rootName } = ws.refs;
    if (!ws.root) {
      rootName.textContent = '';
      tree.innerHTML = `<div class="dev-empty"><p>Nenhuma pasta aberta.</p><button class="btn btn-primary" data-act="open-empty" type="button">Abrir pasta</button></div>`;
      tree.querySelector('[data-act=open-empty]').addEventListener('click', () => pickFolder(ws));
      return;
    }
    rootName.textContent = ws.root.name;
    rootName.title = ws.root.root;
    const frag = document.createDocumentFragment();
    await renderDir(ws, ws.root.root, 0, frag);
    const scroll = tree.scrollTop; // live refreshes must not jump the list
    tree.innerHTML = '';
    tree.appendChild(frag);
    tree.scrollTop = scroll;
    decorateTree(ws);
  }

  // Watch the workspace folder: any change re-reads the tree and git status (debounced in main)
  function watchWorkspace(ws) {
    if (!ws.root) return;
    dev.watch(ws.root.root);
    refreshGit(ws);
  }
  function unwatchIfUnused(root) {
    if (root && !workspaces.some(w => w.root?.root === root)) dev.unwatch(root);
  }
  dev.onFsChanged(({ root }) => {
    workspaces.filter(w => w.root && lower(w.root.root) === lower(root)).forEach(async ws => {
      await renderTree(ws);
      await refreshGit(ws);
    });
  });

  async function renderDir(ws, dir, depth, parent) {
    const entries = await dev.list(dir);
    if (!Array.isArray(entries)) {
      const err = document.createElement('div');
      err.className = 'dev-tree-error';
      err.textContent = entries?.error || 'Erro ao ler a pasta';
      parent.appendChild(err);
      return;
    }
    const current = ws.activeGroup?.active;
    const subs = new Set(ws.git?.submodules || []);
    for (const e of entries) {
      const row = document.createElement('div');
      const kind = fileKind(e.name, e.isDir);
      const isSub = e.isDir && subs.has(lower(e.path));
      row.className = `dev-node k-${kind}${e.isDir ? ' dir' : ' file'}${isSub ? ' submodule' : ''}${e.path === current ? ' active' : ''}`;
      row.style.paddingLeft = `${6 + depth * 12}px`;
      row.dataset.path = e.path;
      row.dataset.dir = e.isDir ? '1' : '';
      row.dataset.kind = kind;
      const open = e.isDir && ws.expanded.has(e.path);
      // thin vertical guides, one per ancestor level, under each parent's chevron
      const guides = Array.from({ length: depth }, (_, i) => `<span class="dev-guide" style="left:${11 + i * 12}px"></span>`).join('');
      row.innerHTML = `${guides}
        <span class="dev-node-chevron">${e.isDir ? (open ? '▾' : '▸') : ''}</span>
        <span class="dev-node-icon">${nodeIcon(kind, open, isSub, e.name)}</span>
        <span class="dev-node-name">${esc(e.name)}</span>
        <span class="dev-node-badge"></span>`;
      row.title = isSub ? `${e.path} (submódulo git)` : e.path;
      parent.appendChild(row);
      if (open) await renderDir(ws, e.path, depth + 1, parent);
    }
  }

  // Five kinds only: folder, hidden (dot-files), config, LLM/docs (markdown) and plain files
  const CONFIG_EXT = new Set(['json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'env', 'cfg', 'conf', 'config', 'xml', 'lock', 'properties', 'editorconfig']);
  const LLM_EXT = new Set(['md', 'mdx', 'markdown', 'prompt']);
  function fileKind(name, isDirectory) {
    if (isDirectory) return name.startsWith('.') ? 'hidden-dir' : 'dir';
    const lower = name.toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    if (LLM_EXT.has(ext)) return 'llm';
    if (CONFIG_EXT.has(ext) || /^\.env(\.|$)/.test(lower) || /rc$/.test(lower) && lower.startsWith('.')) return 'config';
    if (lower.startsWith('.')) return 'hidden';
    return 'file';
  }

  const SVG = {
    dir: '<path d="M1.5 3.5h4l1.5 1.5h7.5v8.5h-13z"/>',
    dirOpen: '<path d="M1.5 3.5h4l1.5 1.5h7v2H4l-2.5 6.5z"/><path d="M4 7h11.5l-2.5 6.5H1.5z"/>',
    file: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
    config: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    llm: '<path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"/>',
    hidden: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/>',
    sub: '<path d="M1.5 3.5h4l1.5 1.5h7.5v8.5h-13z"/><circle cx="8" cy="9.2" r="1.6"/>',
  };
  SVG.md = '<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>';
  const icon = key => `<svg class="dev-ico" viewBox="0 0 16 16" aria-hidden="true">${SVG[key]}</svg>`;
  const glyph = (text, cls) => `<span class="dev-glyph ${cls}">${text}</span>`;
  // VS Code-like: folders show only the chevron; files get a small glyph colored by kind
  function nodeIcon(kind, _open, isSubmodule, name = '') {
    if (kind === 'dir' || kind === 'hidden-dir') return isSubmodule ? icon('sub') : '';
    const ext = name.toLowerCase().split('.').pop();
    if (kind === 'config') {
      if (['json', 'jsonc', 'json5'].includes(ext)) return glyph('{}', 'g-json');
      if (['yml', 'yaml'].includes(ext)) return glyph('!', 'g-yaml');
      return icon('config');
    }
    if (kind === 'llm') return icon('md');
    if (kind === 'hidden') return glyph('◆', 'g-hidden');
    return icon('file');
  }

  // ── Live decorations: git status + unsaved editor files, propagated to parent folders ──
  // must match the main process: paths compare case-insensitively on Windows and macOS only
  const CASE_INSENSITIVE = window.rendra.platform !== 'linux';
  const lower = p => (CASE_INSENSITIVE ? p.toLowerCase() : p);
  const parentOf = p => p.replace(/[\\/][^\\/]+$/, '');
  const RANK = { I: 0.5, U: 1, A: 2, M: 3, D: 3, E: 4 }; // I = git-ignored, E = unsaved in the editor

  function computeDecorations(ws) {
    const deco = new Map(); // lower path → code
    const rootLower = ws.root ? lower(ws.root.root) : '';
    const bump = (p, code) => { if ((RANK[code] || 0) > (RANK[deco.get(p)] || 0)) deco.set(p, code); };
    const mark = (absLower, code) => {
      bump(absLower, code);
      if (code === 'I') return; // ignored paths never color their parents
      // ancestors inside the workspace take the change color too
      for (let d = parentOf(absLower); d.length >= rootLower.length && d.startsWith(rootLower); d = parentOf(d)) {
        bump(d, code === 'E' ? 'E' : 'M');
        if (d === rootLower) break;
      }
    };
    for (const [p, code] of Object.entries(ws.git?.files || {})) {
      const isDirEntry = p.endsWith('\\') || p.endsWith('/');
      mark(isDirEntry ? p.slice(0, -1) : p, code);
    }
    for (const p of files.keys()) if (isDirty(p)) mark(lower(p), 'E');
    return deco;
  }

  // Also used for untracked folders: everything under a "??" directory is new
  function inheritedCode(ws, pLower) {
    for (const [p, code] of Object.entries(ws.git?.files || {})) {
      if ((p.endsWith('\\') || p.endsWith('/')) && pLower.startsWith(p)) return code;
    }
    return null;
  }

  function decorateTree(ws) {
    const deco = computeDecorations(ws);
    const subs = new Set(ws.git?.submodules || []);
    ws.refs.tree.querySelectorAll('.dev-node').forEach(n => {
      const pl = lower(n.dataset.path);
      const code = deco.get(pl) || inheritedCode(ws, pl);
      n.classList.remove('st-M', 'st-A', 'st-U', 'st-D', 'st-E', 'st-I');
      if (code) n.classList.add(`st-${code}`);
      // VS Code style: folders get a dot, files the status letter; ignored paths no badge
      const badge = !code || code === 'I' ? '' : n.dataset.dir || code === 'E' ? '●' : code;
      n.querySelector('.dev-node-badge').textContent = badge;
      const isSub = subs.has(pl);
      if (isSub !== n.classList.contains('submodule')) {
        n.classList.toggle('submodule', isSub);
        n.querySelector('.dev-node-icon').innerHTML = nodeIcon(n.dataset.kind, ws.expanded.has(n.dataset.path), isSub, baseName(n.dataset.path));
      }
    });
  }

  async function refreshGit(ws) {
    if (!ws.root) { ws.git = null; return; }
    ws.git = await dev.gitStatus(ws.root.root);
    decorateTree(ws);
  }

  async function onTreeClick(ws, e) {
    const row = e.target.closest('.dev-node');
    if (!row) return;
    const p = row.dataset.path;
    if (row.dataset.dir) {
      if (ws.expanded.has(p)) ws.expanded.delete(p); else ws.expanded.add(p);
      await renderTree(ws);
    } else {
      openFile(ws, p);
    }
  }

  function markActiveInTree(ws) {
    const current = ws.activeGroup?.active;
    ws.refs.tree.querySelectorAll('.dev-node.file').forEach(n => n.classList.toggle('active', n.dataset.path === current));
  }

  // ── Editor groups (right panel) ────────────────────────────────────────────
  function createGroup(ws) {
    const el = document.createElement('div');
    el.className = 'dev-group';
    el.innerHTML = `
      <div class="dev-tabs-bar">
        <div class="dev-tabs"></div>
        <div class="dev-group-actions">
          <button class="dev-icon-btn" data-act="split" title="Dividir à direita (Ctrl+\\)">⫿</button>
          <button class="dev-icon-btn" data-act="close-group" title="Fechar quadro">✕</button>
        </div>
      </div>
      <div class="dev-editor-host"></div>`;
    ws.refs.editors.appendChild(el);
    const group = { id: ws.nextGroupId++, el, tabsEl: el.querySelector('.dev-tabs'), tabs: [], active: null };
    group.editor = monaco.editor.create(el.querySelector('.dev-editor-host'), {
      theme: 'rendra',
      automaticLayout: true,
      fontFamily: "'Cascadia Code', Consolas, Menlo, 'SF Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace",
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      model: null,
    });
    group.editor.onDidFocusEditorText(() => setActiveGroup(ws, group));
    group.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => group.active && saveFile(group.active));
    group.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => closeTab(ws, group, group.active));
    group.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () => splitActive(ws));
    el.addEventListener('mousedown', () => setActiveGroup(ws, group));
    el.querySelector('[data-act=split]').addEventListener('click', () => { setActiveGroup(ws, group); splitActive(ws); });
    el.querySelector('[data-act=close-group]').addEventListener('click', () => closeGroup(ws, group));
    group.tabsEl.addEventListener('click', e => {
      const tab = e.target.closest('.dev-tab');
      if (!tab) return;
      if (e.target.closest('.dev-tab-close')) closeTab(ws, group, tab.dataset.path);
      else showInGroup(ws, group, tab.dataset.path);
    });
    group.tabsEl.addEventListener('auxclick', e => {
      const tab = e.target.closest('.dev-tab');
      if (tab && e.button === 1) closeTab(ws, group, tab.dataset.path);
    });
    ws.groups.push(group);
    setActiveGroup(ws, group);
    return group;
  }

  function setActiveGroup(ws, group) {
    ws.activeGroup = group;
    ws.groups.forEach(g => g.el.classList.toggle('focused', g === group));
    markActiveInTree(ws);
  }

  async function openFile(ws, filePath, opts = {}) {
    try { await loadMonaco(); } catch (e) { toast(e.message); return; }
    if (!files.has(filePath)) {
      const res = await dev.read(filePath);
      if (res.error) { if (!opts.group && !opts.newGroup) toast(res.error); return; }
      const model = monaco.editor.createModel(res.content, undefined, monaco.Uri.file(filePath));
      files.set(filePath, { model, savedVersion: model.getAlternativeVersionId(), name: baseName(filePath) });
      model.onDidChangeContent(() => renderAllTabs());
    }
    const group = opts.group || (opts.newGroup ? createGroup(ws) : (ws.activeGroup || ws.groups[0] || createGroup(ws)));
    if (!group.tabs.includes(filePath)) group.tabs.push(filePath);
    showInGroup(ws, group, filePath);
  }

  function showInGroup(ws, group, filePath) {
    const entry = files.get(filePath);
    if (!entry) return;
    group.active = filePath;
    group.editor.setModel(entry.model);
    setActiveGroup(ws, group);
    renderTabs(group);
    group.editor.focus();
    persist();
  }

  function renderTabs(group) {
    group.tabsEl.innerHTML = group.tabs.map(p => `
      <div class="dev-tab${p === group.active ? ' active' : ''}${isDirty(p) ? ' dirty' : ''}" data-path="${esc(p)}" title="${esc(p)}">
        <span class="dev-tab-name">${esc(files.get(p)?.name || baseName(p))}</span>
        <span class="dev-tab-close" title="Fechar (Ctrl+W)">${isDirty(p) ? '●' : '×'}</span>
      </div>`).join('');
  }
  // Runs on every edit: tab dots now, tree colors once per frame
  let decoFrame = 0;
  const renderAllTabs = () => {
    workspaces.forEach(ws => ws.groups.forEach(renderTabs));
    cancelAnimationFrame(decoFrame);
    decoFrame = requestAnimationFrame(() => workspaces.forEach(decorateTree));
  };

  const openElsewhere = (group, filePath) =>
    workspaces.some(w => w.groups.some(g => g !== group && g.tabs.includes(filePath)));

  async function closeTab(ws, group, filePath) {
    if (!filePath) return;
    const shared = openElsewhere(group, filePath);
    if (!shared && !(await confirmClose([filePath]))) return;
    const idx = group.tabs.indexOf(filePath);
    if (idx < 0) return;
    group.tabs.splice(idx, 1);
    if (!shared) { files.get(filePath)?.model.dispose(); files.delete(filePath); }
    if (!group.tabs.length) { removeGroup(ws, group); return; }
    if (group.active === filePath) showInGroup(ws, group, group.tabs[Math.max(0, idx - 1)]);
    else { renderTabs(group); persist(); }
    renderAllTabs(); // closing may drop an unsaved marker from the tree
  }

  async function closeGroup(ws, group) {
    const exclusive = group.tabs.filter(p => !openElsewhere(group, p));
    if (!(await confirmClose(exclusive))) return;
    exclusive.forEach(p => { files.get(p)?.model.dispose(); files.delete(p); });
    removeGroup(ws, group);
  }

  function removeGroup(ws, group) {
    group.editor.dispose();
    group.el.remove();
    ws.groups = ws.groups.filter(g => g !== group);
    persist();
    const next = ws.groups[ws.groups.length - 1] || null;
    ws.activeGroup = next;
    if (next) setActiveGroup(ws, next);
    else markActiveInTree(ws);
  }

  function splitActive(ws) {
    const from = ws.activeGroup;
    if (!from?.active) return;
    if (ws.groups.length >= MAX_GROUPS) { toast(`Máximo de ${MAX_GROUPS} quadros de editor`); return; }
    const group = createGroup(ws);
    group.tabs.push(from.active);
    showInGroup(ws, group, from.active);
  }

  // ── Terminals (middle panel, 1–4 column grid) ──────────────────────────────
  const shellsReady = dev.ptyShells().catch(() => [{ key: 'powershell', label: 'PowerShell' }]);

  // Git Bash (mintty) default palette; only the dark blues are lifted a little so they stay
  // readable on the dark background. Background is a soft black, just darker than the bars.
  const TERM_BG = '#171717';
  const TERM_THEME = {
    background: TERM_BG, foreground: '#d4d4d4', cursor: '#e8650a', cursorAccent: TERM_BG,
    selectionBackground: '#e8650a55',
    black: '#000000', red: '#bf0000', green: '#00bf00', yellow: '#bfbf00', blue: '#3b63e0',
    magenta: '#bf00bf', cyan: '#00bfbf', white: '#bfbfbf',
    brightBlack: '#606060', brightRed: '#ff4040', brightGreen: '#40ff40', brightYellow: '#ffff40',
    brightBlue: '#6d8dff', brightMagenta: '#ff40ff', brightCyan: '#40ffff', brightWhite: '#ffffff',
  };

  const fitTerm = t => { if (t.body.offsetParent) { try { t.fit.fit(); } catch { /* hidden */ } } };

  function layoutTerminals(ws) {
    const n = Math.max(ws.terms.length, 1);
    const cols = Math.min(ws.cols, n);
    ws.refs.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    ws.refs.grid.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, minmax(0, 1fr))`;
    ws.el.querySelectorAll('.dev-col-btn').forEach(b => b.classList.toggle('active', +b.dataset.cols === ws.cols));
    requestAnimationFrame(() => ws.terms.forEach(fitTerm));
  }

  async function newTerminal(ws) {
    if (typeof Terminal === 'undefined') { toast('Terminal indisponível'); return; }
    // The terminal's name and controls live as a tab in the "Terminais" header row (one line
    // saved per terminal); the pane itself is only the terminal surface
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    pane.innerHTML = '<div class="term-pane-body"></div>';
    ws.refs.grid.appendChild(pane);
    const tab = document.createElement('div');
    tab.className = 'term-tab';
    tab.draggable = true; // drag a tab onto another to reorder the terminals
    tab.title = 'Arraste para reordenar';
    tab.innerHTML = `
      <span class="term-pane-name">…</span>
      <button class="term-rename-btn" data-act="rename" title="Renomear terminal">✎</button>
      <button class="dev-icon-btn" data-act="close" title="Fechar terminal">✕</button>`;
    ws.refs.termTabs.appendChild(tab);
    const body = pane.querySelector('.term-pane-body');
    const term = new Terminal({
      theme: TERM_THEME,
      // emoji fonts as fallback so emoji render in color instead of boxes
      // per-OS monospace fonts, then color emoji fonts (Windows, macOS, Linux)
      fontFamily: "'Cascadia Mono', Consolas, Menlo, 'SF Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace, 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'",
      fontSize: 13,
      fontWeight: 'normal',
      fontWeightBold: 'normal',        // no bold glyphs: easier to read…
      drawBoldTextInBrightColors: true, // …bold still shows, as a brighter color (like mintty)
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,          // required by the unicode11 addon
      customGlyphs: true,              // pixel-perfect box drawing for tables
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    // Unicode 11 widths: emoji take two cells, so tables and prompts stay aligned
    if (window.Unicode11Addon) {
      term.loadAddon(new Unicode11Addon.Unicode11Addon());
      term.unicode.activeVersion = '11';
    }
    term.open(body);
    const t = { id: null, term, fit, pane, tab, body, alive: false, name: '' };
    // clicking the tab (outside its buttons) focuses that terminal
    tab.addEventListener('mousedown', e => { if (!e.target.closest('button, input')) { e.preventDefault(); term.focus(); } });
    ws.terms.push(t);
    layoutTerminals(ws);
    fitTerm(t);

    const shell = ws.el.querySelector('.dev-shell-select').value || lsGet('dev.shell', '');
    const res = await dev.ptyCreate({ cols: term.cols, rows: term.rows, cwd: ws.root?.root, shell });
    if (res.error) {
      term.write(`\r\n\x1b[31mNão foi possível abrir o terminal: ${res.error}\x1b[0m\r\n`);
      return;
    }
    t.id = res.id;
    t.alive = true;
    t.shellKey = res.shellKey;
    t.name = `${res.shell} ${++ws.termCount}`;
    tab.querySelector('.term-pane-name').textContent = t.name;
    ptyOwner.set(t.id, { ws, t });
    tab.querySelector('[data-act=rename]').addEventListener('click', () => renameTerminal(t));
    tab.querySelector('.term-pane-name').addEventListener('dblclick', () => renameTerminal(t));

    term.onData(data => { if (t.alive) dev.ptyWrite(t.id, data); });
    term.onResize(({ cols, rows }) => dev.ptyResize(t.id, cols, rows));
    // Ctrl+Shift+C / Ctrl+Shift+V copy & paste (plain Ctrl+C stays an interrupt, as in VS Code)
    // Image paste for CLIs like Claude Code, which read the clipboard themselves when they get
    // the key: Alt+V on Windows, Ctrl+V on Linux/WSL and macOS. The browser would otherwise turn
    // Ctrl+V into a text paste, so an image-only clipboard never reached the program.
    const pasteText = () => navigator.clipboard.readText().then(x => { if (x) term.paste(x); });
    term.attachCustomKeyEventHandler(ev => {
      if (ev.type !== 'keydown' || ev.code !== 'KeyV' && ev.code !== 'KeyC') return true;
      if (ev.ctrlKey && ev.shiftKey) {
        if (ev.code === 'KeyC') { const sel = term.getSelection(); if (sel) navigator.clipboard.writeText(sel); }
        else pasteText();
        return false;
      }
      if (ev.code !== 'KeyV' || !t.alive) return true;
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        dev.ptyWrite(t.id, '\x1bv'); // Alt+V as the terminal escape sequence
        return false;
      }
      if (ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        dev.clipboardHasImage().then(hasImage => {
          if (hasImage) dev.ptyWrite(t.id, '\x16'); // raw Ctrl+V: the CLI grabs the image
          else pasteText();
        });
        return false;
      }
      return true; // Cmd+V on macOS: normal paste
    });
    body.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const sel = term.getSelection();
      if (sel) { navigator.clipboard.writeText(sel); term.clearSelection(); }
      else navigator.clipboard.readText().then(x => dev.ptyWrite(t.id, x));
    });
    term.textarea?.addEventListener('focus', () => { pane.classList.add('focused'); tab.classList.add('focused'); });
    term.textarea?.addEventListener('blur', () => { pane.classList.remove('focused'); tab.classList.remove('focused'); });
    initTabDrag(ws, t);
    tab.querySelector('[data-act=close]').addEventListener('click', async () => {
      // a terminal whose process already ended closes without asking
      if (t.alive && !(await askCloseTerminals(
        `Fechar ${t.name}?`,
        'O terminal será encerrado, junto com qualquer comando que estiver rodando nele.',
      ))) return;
      killTerminal(ws, t);
    });
    new ResizeObserver(() => fitTerm(t)).observe(body);
    term.focus();
  }

  // Inline rename: the name becomes an input with its text selected, ready to type over
  function renameTerminal(t) {
    const nameEl = t.tab.querySelector('.term-pane-name');
    if (!nameEl) return; // already editing
    const input = document.createElement('input');
    input.className = 'term-rename';
    input.value = t.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = commit => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (commit && v) t.name = v;
      const span = document.createElement('span');
      span.className = 'term-pane-name';
      span.textContent = t.name;
      span.addEventListener('dblclick', () => renameTerminal(t));
      input.replaceWith(span);
      t.term.focus();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // keep keys away from the terminal and global shortcuts
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Moves terminal t to position `to` (tabs and grid panes follow the same order)
  function moveTerminalTo(ws, t, to) {
    const from = ws.terms.indexOf(t);
    if (from < 0 || to === from) return;
    ws.terms.splice(from, 1);
    ws.terms.splice(Math.max(0, Math.min(to, ws.terms.length)), 0, t);
    ws.terms.forEach(x => { ws.refs.grid.appendChild(x.pane); ws.refs.termTabs.appendChild(x.tab); }); // DOM order = grid order
    layoutTerminals(ws);
    t.term.focus();
  }

  // Drag & drop reorder: dropping on the left half of a tab puts it before, right half after
  let dragged = null;
  function initTabDrag(ws, t) {
    const { tab } = t;
    const clear = () => ws.refs.termTabs.querySelectorAll('.term-tab').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    const after = e => { const r = tab.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
    tab.addEventListener('dragstart', e => {
      dragged = { ws, t };
      tab.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.name);
    });
    tab.addEventListener('dragend', () => { dragged = null; tab.classList.remove('dragging'); clear(); });
    tab.addEventListener('dragover', e => {
      if (!dragged || dragged.ws !== ws || dragged.t === t) return;
      e.preventDefault();
      clear();
      tab.classList.add(after(e) ? 'drop-after' : 'drop-before');
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
    tab.addEventListener('drop', e => {
      if (!dragged || dragged.ws !== ws || dragged.t === t) return;
      e.preventDefault();
      const moving = dragged.t;
      const target = ws.terms.indexOf(t) + (after(e) ? 1 : 0);
      const from = ws.terms.indexOf(moving);
      clear();
      moveTerminalTo(ws, moving, from < target ? target - 1 : target);
    });
  }

  async function killTerminal(ws, t) {
    if (t.id != null) { await dev.ptyKill(t.id); ptyOwner.delete(t.id); }
    t.term.dispose();
    t.pane.remove();
    t.tab.remove();
    ws.terms = ws.terms.filter(x => x !== t);
    layoutTerminals(ws);
  }

  dev.onPtyData(({ id, data }) => ptyOwner.get(id)?.t.term.write(data));
  dev.onPtyExit(({ id, exitCode }) => {
    const owner = ptyOwner.get(id);
    if (!owner) return;
    owner.t.alive = false;
    owner.t.pane.classList.add('dead');
    owner.t.tab.classList.add('dead');
    owner.t.term.write(`\r\n\x1b[90m[processo encerrado com código ${exitCode}]\x1b[0m\r\n`);
  });

  // ── Resizable panels ───────────────────────────────────────────────────────
  function initSplitter(ws, sp) {
    sp.addEventListener('mousedown', down => {
      down.preventDefault();
      const which = sp.dataset.split;
      const rect = ws.el.getBoundingClientRect();
      sp.classList.add('dragging');
      document.body.classList.add('dev-resizing');
      const move = ev => {
        if (which === 'explorer') {
          const w = Math.min(Math.max(ev.clientX - rect.left, 140), rect.width * 0.4);
          ws.el.style.setProperty('--ex-w', `${w}px`);
        } else {
          const w = Math.min(Math.max(rect.right - ev.clientX, 200), rect.width * 0.7);
          ws.el.style.setProperty('--ed-w', `${w}px`);
        }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        sp.classList.remove('dragging');
        document.body.classList.remove('dev-resizing');
        // New workspaces start with the last sizes used
        lsSet('dev.layout.explorer', ws.el.style.getPropertyValue('--ex-w'));
        lsSet('dev.layout.editor', ws.el.style.getPropertyValue('--ed-w'));
        ws.terms.forEach(fitTerm);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  async function init() {
    if (initialized) return;
    initialized = true;

    $('ws-add').addEventListener('click', () => activateWorkspace(createWorkspace()));
    $('ws-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.ws-tab');
      const ws = tab && workspaces.find(w => w.id === +tab.dataset.id);
      if (!ws) return;
      if (e.target.closest('.ws-tab-close')) closeWorkspace(ws);
      else if (ws !== activeWs) activateWorkspace(ws);
    });
    $('ws-tabs').addEventListener('dblclick', e => {
      const tab = e.target.closest('.ws-tab');
      const ws = tab && workspaces.find(w => w.id === +tab.dataset.id);
      if (ws && !e.target.closest('.ws-tab-close')) startRename(ws, tab);
    });
    $('ws-tabs').addEventListener('auxclick', e => {
      const tab = e.target.closest('.ws-tab');
      const ws = tab && workspaces.find(w => w.id === +tab.dataset.id);
      if (ws && e.button === 1) closeWorkspace(ws);
    });

    const saved = await dev.loadWorkspaces();
    (saved.list.length ? saved.list : [{}]).forEach(w => createWorkspace(w));
    activateWorkspace(workspaces[Math.min(saved.active || 0, workspaces.length - 1)]);
  }

  window.devcode = {
    activate() {
      init();
      if (activeWs) requestAnimationFrame(() => {
        activeWs.terms.forEach(fitTerm);
        activeWs.groups.forEach(g => g.editor.layout());
      });
    },
    activateTerminalPage,
  };

  // DevCode is the start page
  if ($('page-devcode').classList.contains('active')) window.devcode.activate();
})();
