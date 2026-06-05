// Markdown Mind Map Editor — Webview Script
// Runs inside the VS Code WebviewPanel (sandboxed browser context)
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ─── Constants ────────────────────────────────────────────────────────────

  const NODE_W = 260;
  const NODE_H = 46;
  const BODY_H = 30;     // body item node height
  const BODY_V_GAP = 8;  // gap between body items
  const H_SPACE = 280;   // horizontal distance between levels
  const V_GAP = 16;      // vertical gap between siblings
  const PAD = 60;        // canvas padding
  const MAX_UNDO = 50;

  // Level colours (border + connection)
  const LEVEL_COLORS = [
    '#569cd6', // 0 root
    '#569cd6', // 1 H1
    '#4ec9b0', // 2 H2
    '#dcdcaa', // 3 H3
    '#ce9178', // 4 H4
    '#9cdcfe', // 5 H5
    '#c586c0', // 6 H6
  ];

  // ─── State ────────────────────────────────────────────────────────────────

  let root = null;
  let selectedId = null;           // selected heading node id
  let editingId = null;            // heading node being inline-edited
  let transform = { x: 80, y: 0, scale: 1 };
  let contextTarget = null;        // heading node for context menu
  let contextBodyItem = null;      // { parentNode, item, key } for body item context menu
  let _pendingEditId = null;       // heading node to auto-edit after render
  let _pendingBodyEdit = null;     // { parentId, lineIdx } body item to auto-edit after render
  let selectedBodyItemKey = null;  // `${parentId}:${lineIdx}`
  let selectedBodyItemData = null; // { parentNode, lineIdx, item }

  let _lastNodeCount = 0;
  let dragState = null;
  let bodyDragState = null;
  let panState = null;
  let undoStack = [];

  // ─── DOM refs ─────────────────────────────────────────────────────────────

  const stage = document.getElementById('stage');
  const svgLayer = document.getElementById('svg-layer');
  const nodeLayer = document.getElementById('node-layer');
  const dropIndicator = document.getElementById('drop-indicator');
  const ctxMenu = document.getElementById('context-menu');

  // ─── Body Item Helpers ────────────────────────────────────────────────────

  function getBodyItems(bodyText) {
    const lines = (bodyText || '').split('\n');
    const items = [];
    lines.forEach((line, idx) => {
      const chk = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
      const bul = !chk && line.match(/^(\s*)-\s+(.*)$/);
      if (chk) {
        items.push({ lineIdx: idx, type: 'checkbox', checked: chk[2].toLowerCase() === 'x', text: chk[3], indent: chk[1].length, _x: 0, _y: 0 });
      } else if (bul) {
        items.push({ lineIdx: idx, type: 'bullet', text: bul[2], indent: bul[1].length, _x: 0, _y: 0 });
      }
    });
    return items;
  }

  // ─── Layout ───────────────────────────────────────────────────────────────

  function computeSubtreeH(node) {
    if (node.collapsed) { node._sh = NODE_H; return; }
    node.children.forEach(computeSubtreeH);
    const bodyItems = getBodyItems(node.body);
    const hasBody = bodyItems.length > 0;
    const hasChildren = node.children.length > 0;
    if (!hasBody && !hasChildren) { node._sh = NODE_H; return; }
    let totalH = 0;
    // 子見出しが上、本文が下
    if (hasChildren) totalH += node.children.reduce((s, c) => s + c._sh, 0) + (node.children.length - 1) * V_GAP;
    if (hasChildren && hasBody) totalH += V_GAP;
    if (hasBody) totalH += bodyItems.length * BODY_H + Math.max(0, bodyItems.length - 1) * BODY_V_GAP;
    node._sh = Math.max(NODE_H, totalH);
  }

  function assignPositions(node, x, topY) {
    node._x = x;
    node._y = topY + node._sh / 2 - NODE_H / 2;
    if (node.collapsed) { node._bodyItems = []; return; }

    const bodyItems = getBodyItems(node.body);
    node._bodyItems = bodyItems;
    let cy = topY;

    // 子見出しを上側に配置
    for (const child of node.children) {
      assignPositions(child, x + H_SPACE, cy);
      cy += child._sh + V_GAP;
    }
    if (node.children.length > 0 && bodyItems.length > 0) cy += V_GAP - BODY_V_GAP;

    // 本文項目を下側に配置
    for (const item of bodyItems) {
      item._x = x + H_SPACE;
      item._y = cy;
      cy += BODY_H + BODY_V_GAP;
    }
  }

  function layout() {
    if (!root) return;
    computeSubtreeH(root);
    assignPositions(root, PAD, PAD);
  }

  function getBounds(node) {
    const b = { minX: node._x, maxX: node._x + NODE_W, minY: node._y, maxY: node._y + NODE_H };
    if (!node.collapsed) {
      if (node._bodyItems) {
        for (const item of node._bodyItems) {
          if (item._x !== undefined) {
            if (item._x < b.minX) b.minX = item._x;
            if (item._x + NODE_W > b.maxX) b.maxX = item._x + NODE_W;
            if (item._y < b.minY) b.minY = item._y;
            if (item._y + BODY_H > b.maxY) b.maxY = item._y + BODY_H;
          }
        }
      }
      for (const c of node.children) {
        const cb = getBounds(c);
        if (cb.minX < b.minX) b.minX = cb.minX;
        if (cb.maxX > b.maxX) b.maxX = cb.maxX;
        if (cb.minY < b.minY) b.minY = cb.minY;
        if (cb.maxY > b.maxY) b.maxY = cb.maxY;
      }
    }
    return b;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  function countVisibleNodes(node) {
    if (node.collapsed) return 1;
    const bodyCount = node._bodyItems ? node._bodyItems.length : getBodyItems(node.body).length;
    return 1 + bodyCount + node.children.reduce((s, c) => s + countVisibleNodes(c), 0);
  }

  function render() {
    if (!root) return;
    layout();

    const bounds = getBounds(root);
    const W = bounds.maxX + PAD;
    const H = bounds.maxY + PAD;

    svgLayer.setAttribute('width', W);
    svgLayer.setAttribute('height', H);
    svgLayer.setAttribute('viewBox', `0 0 ${W} ${H}`);
    nodeLayer.style.width = W + 'px';
    nodeLayer.style.height = H + 'px';

    svgLayer.innerHTML = '';
    nodeLayer.innerHTML = '';

    drawConnections(root, svgLayer);
    drawNodes(root, nodeLayer);

    const nodeCount = countVisibleNodes(root);
    if (nodeCount !== _lastNodeCount) {
      const isInitialLoad = _lastNodeCount === 0;
      _lastNodeCount = nodeCount;
      if (isInitialLoad) {
        const rect = stage.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && isFinite(bounds.minX)) {
          _applyFit(rect, bounds);
        } else if (rect.width === 0 || rect.height === 0) {
          _fitQueued = true;
          requestAnimationFrame(() => {
            if (!_fitQueued || !root) return;
            const r2 = stage.getBoundingClientRect();
            if (r2.width > 0 && r2.height > 0) {
              _fitQueued = false;
              _lastNodeCount = 0;
              render();
            }
          });
        }
      }
    }

    applyTransform();
  }

  function drawConnections(node, svg) {
    if (node.collapsed) return;
    const color = LEVEL_COLORS[Math.min(node.level + 1, LEVEL_COLORS.length - 1)];

    // Dashed connections to body items
    if (node._bodyItems && node._bodyItems.length) {
      for (const item of node._bodyItems) {
        const x1 = node._x + NODE_W;
        const y1 = node._y + NODE_H / 2;
        const x2 = item._x;
        const y2 = item._y + BODY_H / 2;
        const cx = (x1 + x2) / 2;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#888');
        p.setAttribute('stroke-width', '1.5');
        p.setAttribute('stroke-dasharray', '4,3');
        p.setAttribute('stroke-opacity', '0.45');
        svg.appendChild(p);
      }
    }

    // Solid connections to child heading nodes
    for (const child of node.children) {
      const x1 = node._x + NODE_W;
      const y1 = node._y + NODE_H / 2;
      const x2 = child._x;
      const y2 = child._y + NODE_H / 2;
      const cx = (x1 + x2) / 2;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', node.level <= 1 ? '2.5' : '2');
      p.setAttribute('stroke-opacity', '0.75');
      svg.appendChild(p);
      drawConnections(child, svg);
    }
  }

  function drawNodes(node, parent) {
    // ── Heading node (unchanged design) ──
    const div = document.createElement('div');
    div.className = 'node';
    div.dataset.id = node.id;
    div.dataset.level = node.level;
    div.style.left = node._x + 'px';
    div.style.top = node._y + 'px';
    div.style.width = NODE_W + 'px';
    div.style.height = NODE_H + 'px';

    const col = LEVEL_COLORS[Math.min(node.level, LEVEL_COLORS.length - 1)];
    div.style.setProperty('--node-color', col);

    if (node.id === selectedId) div.classList.add('selected');
    if (node.id === editingId) div.classList.add('editing');

    if (node.children.length || getBodyItems(node.body).length) {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn';
      btn.textContent = node.collapsed ? '▶' : '▼';
      btn.title = node.collapsed ? '展開' : '折りたたむ';
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(node); });
      div.appendChild(btn);
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.text;
    div.appendChild(label);

    // Body-dot for non-list body content
    const hasNonListBody = node.body && node.body.split('\n').some(l => l.trim() && !/^[\s]*-\s+/.test(l));
    if (hasNonListBody) {
      const dot = document.createElement('span');
      dot.className = 'body-dot';
      dot.title = node.body.trim();
      div.appendChild(dot);
    }

    div.addEventListener('mouseenter', () => {
      const lbl = div.querySelector('.label');
      div.title = (lbl && lbl.scrollWidth > lbl.clientWidth) ? node.text : '';
    });

    div.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedId = node.id;
      selectedBodyItemKey = null;
      selectedBodyItemData = null;
    });

    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const liveLabel = div.querySelector('.label');
      if (liveLabel) beginEdit(node, div, liveLabel);
    });

    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showHeadingContextMenu(e, node);
    });

    div.addEventListener('mousedown', (e) => {
      if (e.button === 0 && editingId !== node.id) beginDrag(e, node);
    });

    parent.appendChild(div);

    if (node.id === _pendingEditId) {
      _pendingEditId = null;
      requestAnimationFrame(() => beginEdit(node, div, label));
    }

    // ── Body item nodes ──
    if (!node.collapsed && node._bodyItems && node._bodyItems.length) {
      for (const item of node._bodyItems) {
        drawBodyItemNode(node, item, parent);
      }
    }

    if (!node.collapsed) {
      for (const child of node.children) {
        drawNodes(child, parent);
      }
    }
  }

  function drawBodyItemNode(parentNode, item, container) {
    const key = `${parentNode.id}:${item.lineIdx}`;
    const div = document.createElement('div');
    div.className = 'node body-node' + (item.checked ? ' checked' : '');
    div.dataset.bodyKey = key;
    div.style.left = item._x + 'px';
    div.style.top = item._y + 'px';
    div.style.width = NODE_W + 'px';
    div.style.height = BODY_H + 'px';

    if (key === selectedBodyItemKey) div.classList.add('selected');

    // Checkbox or bullet
    if (item.type === 'checkbox') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'body-node-checkbox';
      cb.checked = item.checked;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleBodyItemCheckbox(parentNode, item.lineIdx, cb.checked);
      });
      div.appendChild(cb);
    } else {
      const bullet = document.createElement('span');
      bullet.className = 'body-node-bullet';
      bullet.textContent = '–';
      div.appendChild(bullet);
    }

    const label = document.createElement('span');
    label.className = 'body-node-label';
    label.textContent = item.text;
    div.appendChild(label);

    div.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedId = null;
      selectedBodyItemKey = key;
      selectedBodyItemData = { parentNode, lineIdx: item.lineIdx, item };
    });

    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const liveLabel = div.querySelector('.body-node-label');
      if (liveLabel) beginBodyItemEdit(parentNode, item, div, liveLabel);
    });

    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showBodyItemContextMenu(e, parentNode, item, key);
    });

    div.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target.type !== 'checkbox') {
        beginBodyItemDrag(e, parentNode, item);
      }
    });

    container.appendChild(div);

    // Auto-start edit for newly added body items
    if (_pendingBodyEdit && _pendingBodyEdit.parentId === parentNode.id && _pendingBodyEdit.lineIdx === item.lineIdx) {
      _pendingBodyEdit = null;
      requestAnimationFrame(() => {
        const liveLabel = div.querySelector('.body-node-label');
        if (liveLabel) beginBodyItemEdit(parentNode, item, div, liveLabel);
      });
    }
  }

  // ─── Transform / Pan / Zoom ───────────────────────────────────────────────

  function applyTransform() {
    const t = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    svgLayer.style.transform = t;
    nodeLayer.style.transform = t;
  }

  function _applyFit(rect, bounds) {
    const w = bounds.maxX - bounds.minX + PAD * 2;
    const h = bounds.maxY - bounds.minY + PAD * 2;
    transform.scale = Math.min(rect.width / w, rect.height / h, 1.2);
    transform.x = (rect.width - w * transform.scale) / 2 + (PAD - bounds.minX) * transform.scale;
    transform.y = (rect.height - h * transform.scale) / 2 + (PAD - bounds.minY) * transform.scale;
  }

  function fitView() {
    if (!root) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { _fitQueued = true; return; }
    layout();
    const b = getBounds(root);
    if (!isFinite(b.minX) || !isFinite(b.minY) || !isFinite(b.maxX) || !isFinite(b.maxY)) return;
    _applyFit(rect, b);
    applyTransform();
  }

  let _fitQueued = false;

  new ResizeObserver(() => {
    if (_fitQueued && root) {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        _fitQueued = false;
        _lastNodeCount = 0;
        render();
      }
    }
  }).observe(stage);

  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const nodeEl = e.target.closest ? e.target.closest('.node') : null;
    if (!nodeEl) {
      panState = { startMouseX: e.clientX, startMouseY: e.clientY, startTx: transform.x, startTy: transform.y };
      stage.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (panState) {
      transform.x = panState.startTx + e.clientX - panState.startMouseX;
      transform.y = panState.startTy + e.clientY - panState.startMouseY;
      applyTransform();
    }
    if (dragState) onDragMove(e);
    if (bodyDragState) onBodyDragMove(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (panState) { panState = null; stage.style.cursor = ''; }
    if (dragState) onDragEnd(e);
    if (bodyDragState) onBodyDragEnd(e);
  });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    transform.x = mx - (mx - transform.x) * delta;
    transform.y = my - (my - transform.y) * delta;
    transform.scale = Math.max(0.15, Math.min(4, transform.scale * delta));
    applyTransform();
  }, { passive: false });

  document.addEventListener('click', (e) => {
    if (!ctxMenu.contains(e.target)) hideContextMenu();
  });

  // ─── Toolbar ─────────────────────────────────────────────────────────────

  function zoomBy(factor) {
    transform.scale = Math.max(0.15, Math.min(4, transform.scale * factor));
    applyTransform();
  }

  document.getElementById('btn-zoom-in').addEventListener('click', () => zoomBy(1.25));
  document.getElementById('btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.25));
  document.getElementById('btn-fit').addEventListener('click', fitView);
  document.getElementById('btn-expand-all').addEventListener('click', () => {
    if (!selectedId || !root) return;
    const node = findById(root, selectedId);
    if (!node || (!node.children.length && !getBodyItems(node.body).length) || !node.collapsed) return;
    pushUndo();
    node.collapsed = false;
    render();
    postCollapseState();
  });
  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    if (!selectedId || !root) return;
    const node = findById(root, selectedId);
    if (!node || (!node.children.length && !getBodyItems(node.body).length) || node.collapsed) return;
    pushUndo();
    node.collapsed = true;
    render();
    postCollapseState();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); performUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); vscode.postMessage({ type: 'save' }); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '=') { zoomBy(1.25); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { zoomBy(1 / 1.25); return; }

    if (editingId) return;

    if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) { fitView(); return; }

    // Delete: heading node or body item
    if (e.key === 'Delete') {
      if (selectedBodyItemData) {
        deleteBodyItem(selectedBodyItemData.parentNode, selectedBodyItemData.lineIdx);
        return;
      }
      if (selectedId) {
        const node = findById(root, selectedId);
        if (node) deleteNode(node);
        return;
      }
    }

    if (e.altKey && e.key === 'ArrowUp' && selectedId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (node) moveNode(node, -1);
      return;
    }
    if (e.altKey && e.key === 'ArrowDown' && selectedId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (node) moveNode(node, 1);
      return;
    }
    if (e.key === 'F2' && selectedId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (node) {
        const nodeEl = document.querySelector(`.node[data-id="${node.id}"]`);
        const lbl = nodeEl && nodeEl.querySelector('.label');
        if (lbl) beginEdit(node, nodeEl, lbl);
      }
      return;
    }
    if (e.key === 'F2' && selectedBodyItemData) {
      e.preventDefault();
      const { parentNode, lineIdx, item } = selectedBodyItemData;
      const nodeEl = document.querySelector(`.body-node[data-body-key="${selectedBodyItemKey}"]`);
      const lbl = nodeEl && nodeEl.querySelector('.body-node-label');
      if (lbl) beginBodyItemEdit(parentNode, item, nodeEl, lbl);
      return;
    }
    // Enter on body item → add new body item below at the same level
    if (e.key === 'Enter' && selectedBodyItemData) {
      e.preventDefault();
      addBodyItem(selectedBodyItemData.parentNode, selectedBodyItemData.lineIdx);
      return;
    }
    if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (!node) return;
      const parent = findParent(root, node);
      if (!parent) {
        const nodeEl = document.querySelector(`.node[data-id="${node.id}"]`);
        const lbl = nodeEl && nodeEl.querySelector('.label');
        if (lbl) beginEdit(node, nodeEl, lbl);
        return;
      }
      const newNode = makeNode('新しいノード', node.level);
      const idx = parent.children.indexOf(node);
      pushUndo();
      parent.children.splice(idx + 1, 0, newNode);
      selectedId = newNode.id;
      _pendingEditId = newNode.id;
      postStructuralEdit();
      render();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && selectedId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (!node || node.level >= 6) return;
      const newNode = makeNode('新しいノード', node.level + 1);
      pushUndo();
      node.children.push(newNode);
      node.collapsed = false;
      selectedId = newNode.id;
      _pendingEditId = newNode.id;
      postStructuralEdit();
      render();
      return;
    }
    if (!e.altKey && !e.ctrlKey && !e.metaKey) {
      if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        navigateByKey(e.key);
        return;
      }
      if (e.key === 'Escape') {
        if (selectedBodyItemKey) {
          document.querySelectorAll('.body-node.selected').forEach(el => el.classList.remove('selected'));
          selectedBodyItemKey = null;
          selectedBodyItemData = null;
        } else if (selectedId) {
          selectedId = null;
          document.querySelectorAll('.node.selected').forEach(el => el.classList.remove('selected'));
        }
        return;
      }
    }
  });

  // ─── Node Operations ──────────────────────────────────────────────────────

  function toggleCollapse(node) {
    pushUndo();
    node.collapsed = !node.collapsed;
    render();
    postCollapseState();
  }

  function postCollapseState() {
    if (!root) return;
    const paths = extractCollapsedPaths(root, '');
    vscode.postMessage({ type: 'saveCollapseState', collapsedPaths: paths });
  }

  function extractCollapsedPaths(node, parentPath) {
    const myPath = parentPath ? `${parentPath}/${node.text}` : node.text;
    const result = [];
    if (node.collapsed && (node.children.length || getBodyItems(node.body).length)) result.push(myPath);
    node.children.forEach((c) => result.push(...extractCollapsedPaths(c, myPath)));
    return result;
  }

  function postStructuralEdit() {
    vscode.postMessage({ type: 'structuralEdit', root });
  }

  // ─── Move Node ────────────────────────────────────────────────────────────

  function moveNode(node, delta) {
    if (!root) return;
    const parent = findParent(root, node);
    if (!parent) return;
    const idx = parent.children.indexOf(node);
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= parent.children.length) return;
    pushUndo();
    [parent.children[idx], parent.children[targetIdx]] = [parent.children[targetIdx], parent.children[idx]];
    postStructuralEdit();
    render();
  }

  // ─── Heading Inline Editing ───────────────────────────────────────────────

  function beginEdit(node, div, label) {
    if (editingId) return;
    editingId = node.id;
    selectedId = node.id;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = node.text;
    label.replaceWith(input);
    input.focus();
    input.select();
    div.classList.add('editing');

    const commit = () => {
      const trimmed = input.value.trim();
      editingId = null;
      div.classList.remove('editing');
      if (trimmed && trimmed !== node.text) {
        pushUndo();
        node.text = trimmed;
        vscode.postMessage({ type: 'renameNode', id: node.id, newText: trimmed });
      }
      render();
    };
    const cancel = () => { editingId = null; render(); };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
      e.stopPropagation();
    });
  }

  // ─── Body Item Operations ─────────────────────────────────────────────────

  function beginBodyItemEdit(parentNode, item, div, label) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = item.text; // text only — checkbox prefix is automatic
    label.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const trimmed = input.value.trim();
      if (trimmed && trimmed !== item.text) {
        pushUndo();
        updateBodyLine(parentNode, item.lineIdx, trimmed);
      }
      render();
    };
    const cancel = () => render();

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
      e.stopPropagation();
    });
  }

  function updateBodyLine(parentNode, lineIdx, newText) {
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    const existing = lines[lineIdx];
    const chk = existing.match(/^(\s*)-\s+\[([ xX])\]\s+/);
    if (chk) {
      // Keep checkbox state, update text only
      lines[lineIdx] = `${chk[1]}- [${chk[2]}] ${newText}`;
    } else {
      // Bullet or other list item → auto-convert to checkbox
      const indent = (existing.match(/^(\s*)/) || ['', ''])[1];
      lines[lineIdx] = `${indent}- [ ] ${newText}`;
    }
    parentNode.body = lines.join('\n');
    vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
  }

  function toggleBodyItemCheckbox(parentNode, lineIdx, checked) {
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    lines[lineIdx] = lines[lineIdx].replace(/\[[ xX]\]/i, checked ? '[x]' : '[ ]');
    parentNode.body = lines.join('\n');
    pushUndo();
    vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
    render();
  }

  function addBodyItem(parentNode, afterLineIdx) {
    const lines = (parentNode.body || '').split('\n');
    const newLine = '- [ ] ';
    let insertAt;
    if (afterLineIdx !== undefined && afterLineIdx !== null) {
      insertAt = afterLineIdx + 1;
    } else {
      // Insert after last body item
      const items = getBodyItems(parentNode.body);
      insertAt = items.length > 0 ? items[items.length - 1].lineIdx + 1 : lines.length;
    }
    lines.splice(insertAt, 0, newLine);
    parentNode.body = lines.join('\n');
    pushUndo();
    parentNode.collapsed = false;
    vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
    _pendingBodyEdit = { parentId: parentNode.id, lineIdx: insertAt };
    selectedBodyItemKey = `${parentNode.id}:${insertAt}`;
    render();
  }

  function deleteBodyItem(parentNode, lineIdx) {
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    pushUndo();
    lines.splice(lineIdx, 1);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    parentNode.body = lines.join('\n');
    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
    render();
  }

  // ─── Context Menu ─────────────────────────────────────────────────────────

  function buildContextMenu(items) {
    ctxMenu.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');
      if (item.divider) {
        li.className = 'divider';
      } else {
        li.dataset.action = item.action;
        li.textContent = item.label;
        if (item.disabled) li.classList.add('disabled');
        if (item.danger) li.classList.add('danger');
      }
      ctxMenu.appendChild(li);
    }
  }

  ctxMenu.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-action]');
    if (!li || li.classList.contains('disabled')) return;
    handleContextAction(li.dataset.action);
    hideContextMenu();
  });

  function handleContextAction(action) {
    switch (action) {
      case 'add-child': {
        if (!contextTarget || contextTarget.level >= 6) return;
        const newNode = makeNode('新しいノード', contextTarget.level + 1);
        pushUndo();
        contextTarget.children.push(newNode);
        contextTarget.collapsed = false;
        selectedId = newNode.id;
        _pendingEditId = newNode.id;
        postStructuralEdit();
        render();
        break;
      }
      case 'add-sibling': {
        if (!contextTarget || !root) return;
        const parent = findParent(root, contextTarget);
        if (!parent) return;
        const newNode = makeNode('新しいノード', contextTarget.level);
        const idx = parent.children.indexOf(contextTarget);
        pushUndo();
        parent.children.splice(idx + 1, 0, newNode);
        selectedId = newNode.id;
        _pendingEditId = newNode.id;
        postStructuralEdit();
        render();
        break;
      }
      case 'add-body': {
        if (!contextTarget) return;
        addBodyItem(contextTarget, null);
        break;
      }
      case 'move-up': {
        if (!contextTarget) return;
        moveNode(contextTarget, -1);
        break;
      }
      case 'move-down': {
        if (!contextTarget) return;
        moveNode(contextTarget, 1);
        break;
      }
      case 'to-body': {
        if (!contextTarget) return;
        convertNodeToBody(contextTarget);
        break;
      }
      case 'body-to-node': {
        if (!contextTarget) return;
        const lines = (contextTarget.body || '').split('\n');
        const idx = lines.findIndex(l => /^[\s]*-\s+/.test(l));
        if (idx >= 0) convertBodyLineToNode(contextTarget, idx);
        break;
      }
      case 'delete': {
        if (!contextTarget) return;
        deleteNode(contextTarget);
        break;
      }
      case 'body-item-to-node': {
        if (!contextBodyItem) return;
        convertBodyLineToNode(contextBodyItem.parentNode, contextBodyItem.item.lineIdx);
        break;
      }
      case 'body-item-delete': {
        if (!contextBodyItem) return;
        deleteBodyItem(contextBodyItem.parentNode, contextBodyItem.item.lineIdx);
        break;
      }
    }
  }

  function showHeadingContextMenu(e, node) {
    contextTarget = node;
    contextBodyItem = null;
    selectedId = node.id;

    const parent = root ? findParent(root, node) : null;
    const idx = parent ? parent.children.indexOf(node) : -1;
    const hasListItem = !!node.body && /^[\s]*-\s+/m.test(node.body);

    buildContextMenu([
      { action: 'add-child',   label: '子ノードを追加',           disabled: node.level >= 6 },
      { action: 'add-sibling', label: '兄弟ノードを追加',         disabled: !parent },
      { action: 'add-body',    label: '本文項目を追加',           disabled: false },
      { divider: true },
      { action: 'move-up',     label: '↑ 上へ移動',             disabled: !parent || idx <= 0 },
      { action: 'move-down',   label: '↓ 下へ移動',             disabled: !parent || idx >= parent.children.length - 1 },
      { divider: true },
      { action: 'to-body',     label: '本文行に変換 (→ 本文)',   disabled: !parent },
      { action: 'body-to-node',label: '先頭項目をノード化',       disabled: !hasListItem || node.level >= 6 },
      { divider: true },
      { action: 'delete',      label: '削除',                   danger: true },
    ]);

    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top = e.clientY + 'px';
    ctxMenu.classList.remove('hidden');

    document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
    const nodeEl = document.querySelector(`.node[data-id="${node.id}"]`);
    if (nodeEl) nodeEl.classList.add('selected');
  }

  function showBodyItemContextMenu(e, parentNode, item, key) {
    contextTarget = null;
    contextBodyItem = { parentNode, item, key };
    selectedBodyItemKey = key;
    selectedBodyItemData = { parentNode, lineIdx: item.lineIdx, item };

    buildContextMenu([
      { action: 'body-item-to-node', label: '↑ ノード化 (→ 見出し)', disabled: parentNode.level >= 6 },
      { divider: true },
      { action: 'body-item-delete',  label: '本文行を削除',           danger: true },
    ]);

    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top = e.clientY + 'px';
    ctxMenu.classList.remove('hidden');

    document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
    const nodeEl = document.querySelector(`.body-node[data-body-key="${key}"]`);
    if (nodeEl) nodeEl.classList.add('selected');
  }

  function hideContextMenu() {
    ctxMenu.classList.add('hidden');
    contextTarget = null;
    contextBodyItem = null;
  }

  // ─── Delete Heading Node ──────────────────────────────────────────────────

  function deleteNode(node) {
    if (!root) return;
    if (node.id === root.id) return;
    if (node.children.length > 0) {
      if (!confirm(`"${node.text}" とすべての子ノードを削除しますか？`)) return;
    }
    const parent = findParent(root, node);
    if (!parent) return;
    pushUndo();
    parent.children = parent.children.filter((c) => c.id !== node.id);
    if (selectedId === node.id) selectedId = null;
    postStructuralEdit();
    render();
  }

  // ─── Conversion Operations ────────────────────────────────────────────────

  function convertNodeToBody(node) {
    if (!root) return;
    const parent = findParent(root, node);
    if (!parent) return;
    pushUndo();
    const newLine = `- [ ] ${node.text}`;
    parent.body = (parent.body && parent.body.trim())
      ? parent.body.trimEnd() + '\n' + newLine
      : newLine;
    const idx = parent.children.indexOf(node);
    const reparented = node.children.map(c => { c.level = node.level; updateChildLevels(c); return c; });
    parent.children.splice(idx, 1, ...reparented);
    selectedId = parent.id;
    postStructuralEdit();
    render();
  }

  function convertBodyLineToNode(parentNode, lineIdx) {
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    if (parentNode.level >= 6) return;
    const line = lines[lineIdx];
    const m = line.match(/^[\s]*-\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (!m) return;
    pushUndo();
    const text = m[1].trim();
    lines.splice(lineIdx, 1);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    parentNode.body = lines.join('\n');
    const newNode = makeNode(text, parentNode.level + 1);
    parentNode.children.push(newNode);
    parentNode.collapsed = false;
    selectedId = newNode.id;
    postStructuralEdit();
    render();
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────────

  function beginDrag(e, node) {
    if (node.id === root?.id) return;
    e.preventDefault();
    e.stopPropagation();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = node.text;
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    document.body.appendChild(ghost);
    dragState = { node, startX: e.clientX, startY: e.clientY, moved: false, ghost };
  }

  function onDragMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) dragState.moved = true;
    if (dragState.moved) {
      dragState.ghost.style.left = (e.clientX + 12) + 'px';
      dragState.ghost.style.top = (e.clientY - 18) + 'px';
      updateDropFeedback(e, dragState.node);
    }
  }

  function onDragEnd(e) {
    const ds = dragState;
    dragState = null;
    ds.ghost.remove();
    clearDropFeedback();
    if (!ds.moved) return;
    const result = getDropTarget(e, ds.node);
    if (result && result.position !== 'h6-blocked') performDrop(ds.node, result.targetNode, result.position);
    render();
  }

  function updateDropFeedback(e, draggedNode) {
    clearDropFeedback();
    const result = getDropTarget(e, draggedNode);
    if (!result) return;
    const { targetNode, position } = result;
    if (position === 'h6-blocked') { stage.style.cursor = 'not-allowed'; return; }
    if (position === 'inside') {
      const el = document.querySelector(`.node[data-id="${targetNode.id}"]`);
      if (el) el.classList.add('drop-over');
    } else {
      const lineY = position === 'before' ? targetNode._y : targetNode._y + NODE_H;
      const sx = targetNode._x * transform.scale + transform.x;
      const sy = lineY * transform.scale + transform.y;
      const sw = NODE_W * transform.scale;
      dropIndicator.className = 'drop-line';
      dropIndicator.style.display = 'block';
      dropIndicator.style.left = sx + 'px';
      dropIndicator.style.top = (sy - 2) + 'px';
      dropIndicator.style.width = sw + 'px';
    }
  }

  function clearDropFeedback() {
    document.querySelectorAll('.node.drop-over').forEach(el => el.classList.remove('drop-over'));
    dropIndicator.style.display = 'none';
    dropIndicator.className = '';
    stage.style.cursor = '';
  }

  function getDropTarget(e, draggedNode) {
    const stageRect = stage.getBoundingClientRect();
    const sx = (e.clientX - stageRect.left - transform.x) / transform.scale;
    const sy = (e.clientY - stageRect.top - transform.y) / transform.scale;
    let best = null;
    let bestDist = 40;
    collectDropCandidates(root, draggedNode, sx, sy, bestDist, (result, dist) => {
      if (dist < bestDist) { bestDist = dist; best = result; }
    });
    return best;
  }

  function collectDropCandidates(node, dragged, sx, sy, tolerance, cb) {
    if (node.id === dragged.id) return;
    if (isDescendant(dragged, node)) return;
    const nx = node._x, ny = node._y, nw = NODE_W, nh = NODE_H;
    if (sx >= nx - tolerance && sx <= nx + nw + tolerance &&
        sy >= ny - tolerance && sy <= ny + nh + tolerance) {
      const relY = sy - ny;
      let position;
      if (relY < nh * 0.25) position = 'before';
      else if (relY > nh * 0.75) position = 'after';
      else position = 'inside';
      if (position === 'inside' && node.level >= 6) position = 'h6-blocked';
      const cx = nx + nw / 2, cy = ny + nh / 2;
      cb({ targetNode: node, position }, Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2));
    }
    if (!node.collapsed) node.children.forEach(c => collectDropCandidates(c, dragged, sx, sy, tolerance, cb));
  }

  function performDrop(draggedNode, targetNode, position) {
    if (!root) return;
    const sourceParent = findParent(root, draggedNode);
    if (!sourceParent) return;
    pushUndo();
    sourceParent.children = sourceParent.children.filter(c => c.id !== draggedNode.id);
    if (position === 'inside') {
      draggedNode.level = targetNode.level + 1;
      updateChildLevels(draggedNode);
      targetNode.children.push(draggedNode);
      targetNode.collapsed = false;
    } else {
      const targetParent = findParent(root, targetNode);
      if (!targetParent) { sourceParent.children.push(draggedNode); return; }
      draggedNode.level = targetNode.level;
      updateChildLevels(draggedNode);
      const idx = targetParent.children.indexOf(targetNode);
      targetParent.children.splice(position === 'before' ? idx : idx + 1, 0, draggedNode);
    }
    postStructuralEdit();
  }

  // ─── Body Item Drag & Drop ────────────────────────────────────────────────

  function beginBodyItemDrag(e, parentNode, item) {
    e.preventDefault();
    e.stopPropagation();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = item.text;
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    document.body.appendChild(ghost);
    bodyDragState = { parentNode, lineIdx: item.lineIdx, item, startX: e.clientX, startY: e.clientY, moved: false, ghost };
  }

  function onBodyDragMove(e) {
    if (!bodyDragState) return;
    const dx = e.clientX - bodyDragState.startX;
    const dy = e.clientY - bodyDragState.startY;
    if (!bodyDragState.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) bodyDragState.moved = true;
    if (bodyDragState.moved) {
      bodyDragState.ghost.style.left = (e.clientX + 12) + 'px';
      bodyDragState.ghost.style.top = (e.clientY - 18) + 'px';
      updateBodyDropFeedback(e, bodyDragState);
    }
  }

  function onBodyDragEnd(e) {
    const ds = bodyDragState;
    bodyDragState = null;
    ds.ghost.remove();
    clearBodyDropFeedback();
    if (!ds.moved) return;
    performBodyDrop(e, ds);
  }

  function updateBodyDropFeedback(e, ds) {
    clearBodyDropFeedback();
    const result = getBodyDropTarget(e, ds);
    if (!result) return;
    if (result.type === 'body-item') {
      const item = result.targetItem;
      const lineY = result.position === 'before' ? item._y : item._y + BODY_H;
      const sx = item._x * transform.scale + transform.x;
      const sy = lineY * transform.scale + transform.y;
      dropIndicator.className = 'drop-line';
      dropIndicator.style.display = 'block';
      dropIndicator.style.left = sx + 'px';
      dropIndicator.style.top = (sy - 2) + 'px';
      dropIndicator.style.width = (NODE_W * transform.scale) + 'px';
    } else if (result.type === 'heading') {
      const el = document.querySelector(`.node[data-id="${result.targetNode.id}"]`);
      if (el) el.classList.add('drop-over');
    }
  }

  function clearBodyDropFeedback() {
    document.querySelectorAll('.node.drop-over').forEach(el => el.classList.remove('drop-over'));
    dropIndicator.style.display = 'none';
    dropIndicator.className = '';
  }

  function getBodyDropTarget(e, ds) {
    const stageRect = stage.getBoundingClientRect();
    const sx = (e.clientX - stageRect.left - transform.x) / transform.scale;
    const sy = (e.clientY - stageRect.top - transform.y) / transform.scale;
    let best = null;
    let bestDist = 40;
    collectBodyDropCandidates(root, ds, sx, sy, (result, dist) => {
      if (dist < bestDist) { bestDist = dist; best = result; }
    });
    return best;
  }

  function collectBodyDropCandidates(node, ds, sx, sy, cb) {
    if (!node.collapsed && node._bodyItems) {
      for (const item of node._bodyItems) {
        if (node.id === ds.parentNode.id && item.lineIdx === ds.lineIdx) continue; // skip self
        const nx = item._x, ny = item._y, nw = NODE_W, nh = BODY_H;
        if (sx >= nx - 40 && sx <= nx + nw + 40 && sy >= ny - 40 && sy <= ny + nh + 40) {
          const position = (sy - ny) < nh * 0.5 ? 'before' : 'after';
          const cx = nx + nw / 2, cy = ny + nh / 2;
          cb({ type: 'body-item', targetNode: node, targetItem: item, position }, Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2));
        }
      }
    }
    // Heading node as drop target (append body item)
    const nx = node._x, ny = node._y, nw = NODE_W, nh = NODE_H;
    if (sx >= nx - 30 && sx <= nx + nw + 30 && sy >= ny - 30 && sy <= ny + nh + 30) {
      const cx = nx + nw / 2, cy = ny + nh / 2;
      cb({ type: 'heading', targetNode: node }, Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2));
    }
    if (!node.collapsed) {
      node.children.forEach(c => collectBodyDropCandidates(c, ds, sx, sy, cb));
    }
  }

  function performBodyDrop(e, ds) {
    const result = getBodyDropTarget(e, ds);
    if (!result) return;
    pushUndo();

    const srcLines = (ds.parentNode.body || '').split('\n');
    const srcLine = srcLines[ds.lineIdx];

    if (result.type === 'body-item' && result.targetNode.id === ds.parentNode.id) {
      // 同一親内の並び替え
      srcLines.splice(ds.lineIdx, 1);
      let insertAt = result.position === 'after' ? result.targetItem.lineIdx + 1 : result.targetItem.lineIdx;
      if (ds.lineIdx < insertAt) insertAt--;
      srcLines.splice(Math.max(0, insertAt), 0, srcLine);
      ds.parentNode.body = srcLines.join('\n');
      vscode.postMessage({ type: 'editBody', id: ds.parentNode.id, body: ds.parentNode.body });
    } else {
      // 別親への移動（structuralEdit でツリー全体を送信）
      srcLines.splice(ds.lineIdx, 1);
      while (srcLines.length > 0 && srcLines[srcLines.length - 1].trim() === '') srcLines.pop();
      ds.parentNode.body = srcLines.join('\n');

      if (result.type === 'body-item') {
        const tgtLines = (result.targetNode.body || '').split('\n');
        const insertAt = result.position === 'after' ? result.targetItem.lineIdx + 1 : result.targetItem.lineIdx;
        tgtLines.splice(insertAt, 0, srcLine);
        result.targetNode.body = tgtLines.join('\n');
      } else {
        // heading: 末尾に追加
        const tgtLines = (result.targetNode.body || '').split('\n');
        const tgtItems = getBodyItems(result.targetNode.body);
        const insertAt = tgtItems.length > 0 ? tgtItems[tgtItems.length - 1].lineIdx + 1 : tgtLines.length;
        tgtLines.splice(insertAt, 0, srcLine);
        result.targetNode.body = tgtLines.join('\n');
      }
      postStructuralEdit();
    }

    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    render();
  }

  function isDescendant(ancestor, node) {
    if (ancestor.id === node.id) return true;
    return ancestor.children.some(c => isDescendant(c, node));
  }

  function updateChildLevels(node) {
    node.children.forEach(c => { c.level = node.level + 1; updateChildLevels(c); });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  let _idSeq = Date.now();
  function makeNode(text, level) {
    return { id: String(_idSeq++), text, level, children: [], collapsed: false, body: '' };
  }

  function findById(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of node.children) {
      const found = findById(c, id);
      if (found) return found;
    }
    return null;
  }

  function findParent(node, target) {
    for (const c of node.children) {
      if (c.id === target.id) return node;
      const found = findParent(c, target);
      if (found) return found;
    }
    return null;
  }

  // ─── Undo ─────────────────────────────────────────────────────────────────

  function cloneForUndo(node) {
    return { id: node.id, text: node.text, level: node.level, collapsed: node.collapsed, body: node.body, children: node.children.map(cloneForUndo) };
  }

  function pushUndo() {
    if (!root) return;
    undoStack.push(cloneForUndo(root));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function performUndo() {
    if (!undoStack.length) return;
    root = undoStack.pop();
    selectedId = null;
    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    render();
    vscode.postMessage({ type: 'structuralEdit', root });
  }

  // ─── Keyboard Navigation ──────────────────────────────────────────────────

  function getVisibleNodes() {
    const result = [];
    function collect(node) {
      result.push(node);
      if (!node.collapsed) node.children.forEach(collect);
    }
    if (root) collect(root);
    return result;
  }

  function scrollNodeIntoView(node) {
    if (node._x === undefined) return;
    const rect = stage.getBoundingClientRect();
    const margin = 60;
    const sx = node._x * transform.scale + transform.x;
    const sy = node._y * transform.scale + transform.y;
    const sw = NODE_W * transform.scale;
    const sh = NODE_H * transform.scale;
    let changed = false;
    if (sx < margin)                        { transform.x += margin - sx;                    changed = true; }
    else if (sx + sw > rect.width - margin) { transform.x -= sx + sw - (rect.width - margin); changed = true; }
    if (sy < margin)                        { transform.y += margin - sy;                    changed = true; }
    else if (sy + sh > rect.height - margin){ transform.y -= sy + sh - (rect.height - margin); changed = true; }
    if (changed) applyTransform();
  }

  function selectNode(node) {
    if (!node) return;
    selectedId = node.id;
    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
    const el = document.querySelector(`.node[data-id="${node.id}"]`);
    if (el) el.classList.add('selected');
    scrollNodeIntoView(node);
  }

  function navigateByKey(key) {
    if (!root) return;
    const nodes = getVisibleNodes();
    if (!nodes.length) return;
    const currentNode = selectedId ? findById(root, selectedId) : null;
    if (!currentNode) { selectNode(nodes[0]); return; }
    const idx = nodes.indexOf(currentNode);

    if (key === 'ArrowDown') {
      if (idx < nodes.length - 1) selectNode(nodes[idx + 1]);
    } else if (key === 'ArrowUp') {
      if (idx > 0) selectNode(nodes[idx - 1]);
    } else if (key === 'ArrowRight') {
      const items = currentNode._bodyItems || getBodyItems(currentNode.body);
      if (currentNode.children.length || items.length) {
        if (currentNode.collapsed) { pushUndo(); currentNode.collapsed = false; render(); postCollapseState(); }
        if (items.length) {
          // Select first body item
          const key2 = `${currentNode.id}:${items[0].lineIdx}`;
          document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
          selectedId = null;
          selectedBodyItemKey = key2;
          selectedBodyItemData = { parentNode: currentNode, lineIdx: items[0].lineIdx, item: items[0] };
          const el = document.querySelector(`.body-node[data-body-key="${key2}"]`);
          if (el) el.classList.add('selected');
        } else if (currentNode.children.length) {
          selectNode(currentNode.children[0]);
        }
      }
    } else if (key === 'ArrowLeft') {
      if ((currentNode.children.length || getBodyItems(currentNode.body).length) && !currentNode.collapsed) {
        pushUndo();
        currentNode.collapsed = true;
        render();
        postCollapseState();
        selectNode(currentNode);
      } else {
        const parent = findParent(root, currentNode);
        if (parent) selectNode(parent);
      }
    }
  }

  // ─── Message from Extension ───────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      if (editingId) return;
      root = msg.root;
      render();
    }
    if (msg.type === 'saved') {
      showSaveIndicator();
    }
  });

  function showSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 1800);
  }

  vscode.postMessage({ type: 'ready' });

})();
