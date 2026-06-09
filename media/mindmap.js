// Markdown Mind Map Editor — Webview Script
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ─── Constants ────────────────────────────────────────────────────────────

  const NODE_W     = 260;
  const NODE_H     = 46;
  const BODY_H     = 30;    // body item node height
  const BODY_V_GAP = 8;     // gap between body items (same level)
  const H_SPACE    = 280;   // horizontal space between heading levels
  const BODY_H_SPACE = NODE_W + 12; // 272px — must exceed NODE_W to prevent overlap
  const V_GAP      = 16;    // vertical gap between heading siblings
  const PAD        = 60;
  const MAX_UNDO   = 50;

  const LEVEL_COLORS = [
    '#569cd6','#569cd6','#4ec9b0','#dcdcaa','#ce9178','#9cdcfe','#c586c0',
  ];

  // ─── State ────────────────────────────────────────────────────────────────

  let root = null;
  let selectedId = null;
  let selectedIds = new Set(); // multi-selection: Set of node ids
  let editingId = null;
  let transform = { x: 80, y: 0, scale: 1 };
  let contextTarget = null;
  let contextBodyItem = null;
  let _pendingEditId = null;
  let _pendingBodyEdit = null;     // { parentId, lineIdx }
  let selectedBodyItemKey = null;  // `${parentNodeId}:${lineIdx}`
  let selectedBodyItemData = null; // { parentNode, lineIdx, indent }
  let selectedBodyItemKeys = new Set(); // multi-selection for body items: Set of keys
  let selectedBodyItemsData = new Map(); // key -> { parentNode, lineIdx, indent }

  let _lastNodeCount = 0;
  let dragState = null;
  let bodyDragState = null;
  let panState = null;
  let undoStack = [];
  let clipboard = null; // { type: 'heading'|'body', lines?: string[], indent?: number, node?: object, nodes?: object[] }

  // Body item collapse state — persists across renders (session-only)
  // key: `${nodeId}:${lineIdx}`
  const collapsedBodyItems = new Map();

  // ─── DOM refs ─────────────────────────────────────────────────────────────

  const stage        = document.getElementById('stage');
  const svgLayer     = document.getElementById('svg-layer');
  const nodeLayer    = document.getElementById('node-layer');
  const dropIndicator = document.getElementById('drop-indicator');
  const ctxMenu      = document.getElementById('context-menu');

  // ─── Body Item Helpers ────────────────────────────────────────────────────

  /** Flat list of all body list items (for line-index-based operations) */
  function getBodyItems(bodyText) {
    const lines = (bodyText || '').split('\n');
    const items = [];
    lines.forEach((line, idx) => {
      const chk = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
      const bul = !chk && line.match(/^(\s*)-\s+(.*)$/);
      if (chk) items.push({ lineIdx: idx, type: 'checkbox', checked: chk[2].toLowerCase() === 'x', text: chk[3], indent: chk[1].length, _x: 0, _y: 0, _sh: BODY_H, children: [] });
      else if (bul) items.push({ lineIdx: idx, type: 'bullet',   checked: false,                    text: bul[2], indent: bul[1].length, _x: 0, _y: 0, _sh: BODY_H, children: [] });
    });
    return items;
  }

  /** Apply saved collapse state to a body item tree */
  function applyBodyItemCollapseState(items, nodeId) {
    for (const item of items) {
      item.collapsed = collapsedBodyItems.get(`${nodeId}:${item.lineIdx}`) || false;
      applyBodyItemCollapseState(item.children, nodeId);
    }
  }

  /** Get hierarchical body item tree with collapse state applied */
  function getBodyTree(node) {
    const tree = getBodyItemTree(node.body);
    applyBodyItemCollapseState(tree, node.id);
    return tree;
  }

  /** Hierarchical tree of body list items (parent→children based on indent) */
  function getBodyItemTree(bodyText) {
    const flat = getBodyItems(bodyText);
    const roots = [];
    const stack = []; // [{item, indent}]
    for (const item of flat) {
      // pop until we find an ancestor with strictly smaller indent
      while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) stack.pop();
      if (stack.length === 0) roots.push(item);
      else stack[stack.length - 1].children.push(item);
      stack.push(item);
    }
    return roots;
  }

  function computeBodyItemSubtreeH(item) {
    if (item.collapsed || !item.children.length) { item._sh = BODY_H; return; }
    item.children.forEach(computeBodyItemSubtreeH);
    const sum  = item.children.reduce((s, c) => s + c._sh, 0);
    const gaps = (item.children.length - 1) * BODY_V_GAP;
    item._sh = Math.max(BODY_H, sum + gaps);
  }

  function assignBodyItemPositions(item, x, topY) {
    item._x = x;
    item._y = topY + item._sh / 2 - BODY_H / 2;
    if (item.collapsed) return;
    let cy = topY;
    for (const child of item.children) {
      assignBodyItemPositions(child, x + BODY_H_SPACE, cy);
      cy += child._sh + BODY_V_GAP;
    }
  }

  /** Last lineIdx in a body item's subtree (used for sibling insertion) */
  function bodyItemLastLineIdx(item) {
    if (!item.children.length) return item.lineIdx;
    return bodyItemLastLineIdx(item.children[item.children.length - 1]);
  }

  /** Total count of visible items in a body tree (respects collapsed) */
  function countBodyTree(items) {
    return items.reduce((s, item) => s + 1 + (item.collapsed ? 0 : countBodyTree(item.children)), 0);
  }

  // ─── Layout ───────────────────────────────────────────────────────────────

  function computeSubtreeH(node) {
    if (node.collapsed) { node._sh = NODE_H; return; }
    node.children.forEach(computeSubtreeH);

    const bodyTree = getBodyTree(node);
    bodyTree.forEach(computeBodyItemSubtreeH);
    const hasChildren = node.children.length > 0;
    const hasBody = bodyTree.length > 0;
    if (!hasChildren && !hasBody) { node._sh = NODE_H; return; }

    let totalH = 0;
    // children (headings) first / top
    if (hasChildren) totalH += node.children.reduce((s, c) => s + c._sh, 0) + (node.children.length - 1) * V_GAP;
    if (hasChildren && hasBody) totalH += V_GAP;
    // body items below
    if (hasBody) totalH += bodyTree.reduce((s, b) => s + b._sh, 0) + (bodyTree.length - 1) * BODY_V_GAP;

    node._sh = Math.max(NODE_H, totalH);
  }

  function assignPositions(node, x, topY) {
    node._x = x;
    node._y = topY + node._sh / 2 - NODE_H / 2;
    if (node.collapsed) { node._bodyItems = []; return; }

    const bodyTree = getBodyTree(node);
    bodyTree.forEach(computeBodyItemSubtreeH);
    node._bodyItems = bodyTree; // store tree roots (with collapse state applied)

    let cy = topY;
    // heading children first (top)
    for (const child of node.children) {
      assignPositions(child, x + H_SPACE, cy);
      cy += child._sh + V_GAP;
    }
    if (node.children.length > 0 && bodyTree.length > 0) cy += V_GAP - BODY_V_GAP;
    // body items below
    for (const item of bodyTree) {
      assignBodyItemPositions(item, x + H_SPACE, cy);
      cy += item._sh + BODY_V_GAP;
    }
  }

  function layout() {
    if (!root) return;
    computeSubtreeH(root);
    assignPositions(root, PAD, PAD);
  }

  function addBodyItemBounds(items, b) {
    for (const item of items) {
      if (item._x !== undefined) {
        if (item._x < b.minX) b.minX = item._x;
        if (item._x + NODE_W > b.maxX) b.maxX = item._x + NODE_W;
        if (item._y < b.minY) b.minY = item._y;
        if (item._y + BODY_H > b.maxY) b.maxY = item._y + BODY_H;
      }
      addBodyItemBounds(item.children, b);
    }
  }

  function getBounds(node) {
    const b = { minX: node._x, maxX: node._x + NODE_W, minY: node._y, maxY: node._y + NODE_H };
    if (!node.collapsed) {
      if (node._bodyItems) addBodyItemBounds(node._bodyItems, b);
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
    const bodyCount = node._bodyItems ? countBodyTree(node._bodyItems) : countBodyTree(getBodyItemTree(node.body));
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
        } else {
          _fitQueued = true;
          requestAnimationFrame(() => {
            if (!_fitQueued || !root) return;
            const r2 = stage.getBoundingClientRect();
            if (r2.width > 0 && r2.height > 0) { _fitQueued = false; _lastNodeCount = 0; render(); }
          });
        }
      }
    }
    applyTransform();
    updateCheckboxProgress();
  }

  function drawBodyItemConnections(items, svg) {
    for (const item of items) {
      if (item.collapsed || !item.children.length) continue;
      for (const child of item.children) {
        const x1 = item._x + NODE_W, y1 = item._y + BODY_H / 2;
        const x2 = child._x,          y2 = child._y + BODY_H / 2;
        const cx = (x1 + x2) / 2;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#666');
        p.setAttribute('stroke-width', '1.5');
        p.setAttribute('stroke-dasharray', '4,3');
        p.setAttribute('stroke-opacity', '0.4');
        svg.appendChild(p);
      }
      drawBodyItemConnections(item.children, svg);
    }
  }

  function drawConnections(node, svg) {
    if (node.collapsed) return;
    const color = LEVEL_COLORS[Math.min(node.level + 1, LEVEL_COLORS.length - 1)];

    // Dashed connections: heading → body items
    if (node._bodyItems && node._bodyItems.length) {
      for (const item of node._bodyItems) {
        const x1 = node._x + NODE_W, y1 = node._y + NODE_H / 2;
        const x2 = item._x,          y2 = item._y + BODY_H / 2;
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
      // body item → nested children
      drawBodyItemConnections(node._bodyItems, svg);
    }

    // Solid connections: heading → child headings
    for (const child of node.children) {
      const x1 = node._x + NODE_W, y1 = node._y + NODE_H / 2;
      const x2 = child._x,          y2 = child._y + NODE_H / 2;
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
    const div = document.createElement('div');
    div.className = 'node';
    div.dataset.id = node.id;
    div.dataset.level = node.level;
    div.style.left = node._x + 'px';
    div.style.top  = node._y + 'px';
    div.style.width  = NODE_W + 'px';
    div.style.height = NODE_H + 'px';

    const col = LEVEL_COLORS[Math.min(node.level, LEVEL_COLORS.length - 1)];
    div.style.setProperty('--node-color', col);
    if (node.id === selectedId || selectedIds.has(node.id)) div.classList.add('selected');
    if (node.id === editingId)  div.classList.add('editing');

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
      if (e.ctrlKey || e.metaKey) {
        // Multi-select: toggle this node in selection
        if (selectedIds.has(node.id)) {
          selectedIds.delete(node.id);
          div.classList.remove('selected');
          if (selectedId === node.id) {
            // Move primary selection to another selected node or null
            selectedId = selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1] : null;
          }
        } else {
          // Add to multi-select; include current primary selection
          if (selectedId) selectedIds.add(selectedId);
          selectedIds.add(node.id);
          selectedId = node.id;
          selectedBodyItemKey = null;
          selectedBodyItemData = null;
          selectedBodyItemKeys.clear();
          selectedBodyItemsData.clear();
          div.classList.add('selected');
        }
      } else {
        // Single select — clear multi-selection
        document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
        selectedIds.clear();
        selectedBodyItemKeys.clear();
        selectedBodyItemsData.clear();
        div.classList.add('selected');
        selectedId = node.id;
        selectedBodyItemKey = null;
        selectedBodyItemData = null;
      }
    });
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const liveLabel = div.querySelector('.label');
      if (liveLabel) beginEdit(node, div, liveLabel);
    });
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
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

    // Body item nodes (top-level, depth=0)
    if (!node.collapsed && node._bodyItems && node._bodyItems.length) {
      for (const item of node._bodyItems) {
        drawBodyItemNode(node, item, parent, 0);
      }
    }

    if (!node.collapsed) {
      for (const child of node.children) drawNodes(child, parent);
    }
  }

  /**
   * Draw a body item node (recursively draws children at depth+1).
   * depth=0: top-level body items (show checkbox if applicable)
   * depth>0: nested body items (always bullet, no checkbox)
   */
  function drawBodyItemNode(parentNode, item, container, depth) {
    const key = `${parentNode.id}:${item.lineIdx}`;
    const isNested = depth > 0;

    const div = document.createElement('div');
    div.className = 'node body-node' + (isNested ? ' body-node-nested' : '') + (item.checked ? ' checked' : '');
    div.dataset.bodyKey = key;
    div.style.left   = item._x + 'px';
    div.style.top    = item._y + 'px';
    div.style.width  = NODE_W + 'px';
    div.style.height = BODY_H + 'px';

    if (key === selectedBodyItemKey || selectedBodyItemKeys.has(key)) div.classList.add('selected');

    // Collapse toggle for body items that have children
    if (item.children.length) {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn';
      btn.textContent = item.collapsed ? '▶' : '▼';
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleBodyItemCollapse(item, parentNode); });
      div.appendChild(btn);
    }

    // Checkbox (top-level only) or bullet
    if (!isNested && item.type === 'checkbox') {
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
      if (e.ctrlKey || e.metaKey) {
        // Multi-select body items
        if (selectedBodyItemKeys.has(key)) {
          selectedBodyItemKeys.delete(key);
          selectedBodyItemsData.delete(key);
          div.classList.remove('selected');
          if (selectedBodyItemKey === key) {
            selectedBodyItemKey = selectedBodyItemKeys.size > 0 ? [...selectedBodyItemKeys][selectedBodyItemKeys.size - 1] : null;
            selectedBodyItemData = selectedBodyItemKey ? selectedBodyItemsData.get(selectedBodyItemKey) : null;
          }
        } else {
          // Add current primary to multi-select
          if (selectedBodyItemKey) {
            selectedBodyItemKeys.add(selectedBodyItemKey);
            selectedBodyItemsData.set(selectedBodyItemKey, selectedBodyItemData);
          }
          selectedBodyItemKeys.add(key);
          selectedBodyItemsData.set(key, { parentNode, lineIdx: item.lineIdx, indent: item.indent });
          selectedBodyItemKey = key;
          selectedBodyItemData = { parentNode, lineIdx: item.lineIdx, indent: item.indent };
          selectedId = null;
          selectedIds.clear();
          div.classList.add('selected');
        }
      } else {
        // Single select
        document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
        selectedIds.clear();
        selectedBodyItemKeys.clear();
        selectedBodyItemsData.clear();
        div.classList.add('selected');
        selectedId = null;
        selectedBodyItemKey = key;
        selectedBodyItemData = { parentNode, lineIdx: item.lineIdx, indent: item.indent };
      }
    });
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const liveLabel = div.querySelector('.body-node-label');
      if (liveLabel) beginBodyItemEdit(parentNode, item, div, liveLabel);
    });
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      showBodyItemContextMenu(e, parentNode, item, key);
    });
    div.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target.type !== 'checkbox') beginBodyItemDrag(e, parentNode, item);
    });

    container.appendChild(div);

    if (_pendingBodyEdit && _pendingBodyEdit.parentId === parentNode.id && _pendingBodyEdit.lineIdx === item.lineIdx) {
      _pendingBodyEdit = null;
      requestAnimationFrame(() => {
        const liveLabel = div.querySelector('.body-node-label');
        if (liveLabel) beginBodyItemEdit(parentNode, item, div, liveLabel);
      });
    }

    // Recursively draw children (depth+1, always bullet)
    if (!item.collapsed && item.children.length) {
      for (const child of item.children) {
        drawBodyItemNode(parentNode, child, container, depth + 1);
      }
    }
  }

  function toggleBodyItemCollapse(item, parentNode) {
    const key = `${parentNode.id}:${item.lineIdx}`;
    if (collapsedBodyItems.get(key)) {
      collapsedBodyItems.delete(key);
    } else {
      collapsedBodyItems.set(key, true);
    }
    render();
    postBodyItemCollapseState(); // persist to frontmatter
  }

  // ─── Checkbox Progress ────────────────────────────────────────────────────

  function updateCheckboxProgress() {
    const el = document.getElementById('checkbox-progress');
    if (!el) return;
    if (!root) { el.textContent = ''; return; }
    let total = 0, done = 0;
    function countInNode(node) {
      (node.body || '').split('\n').forEach(line => {
        const m = line.match(/^[\s]*-\s+\[([ xX])\]/i);
        if (m) { total++; if (m[1].toLowerCase() === 'x') done++; }
      });
      node.children.forEach(countInNode);
    }
    countInNode(root);
    if (total === 0) {
      el.textContent = '';
      el.style.setProperty('--cb-pct', '0%');
      el.title = '';
      return;
    }
    el.textContent = `✓ ${done} / ${total}`;
    el.title = `チェック済: ${done} / 全体: ${total}`;
    const pct = Math.round(done / total * 100);
    el.style.setProperty('--cb-pct', pct + '%');
    el.style.borderColor = done === total
      ? 'var(--vscode-gitDecoration-addedResourceForeground, #4ec994)'
      : 'var(--border)';
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
    transform.x = (rect.width  - w * transform.scale) / 2 + (PAD - bounds.minX) * transform.scale;
    transform.y = (rect.height - h * transform.scale) / 2 + (PAD - bounds.minY) * transform.scale;
  }

  function fitView() {
    if (!root) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { _fitQueued = true; return; }
    layout();
    const b = getBounds(root);
    if (!isFinite(b.minX)) return;
    _applyFit(rect, b);
    applyTransform();
  }

  let _fitQueued = false;

  new ResizeObserver(() => {
    if (_fitQueued && root) {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) { _fitQueued = false; _lastNodeCount = 0; render(); }
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
    if (dragState)     onDragMove(e);
    if (bodyDragState) onBodyDragMove(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (panState) { panState = null; stage.style.cursor = ''; }
    if (dragState)     onDragEnd(e);
    if (bodyDragState) onBodyDragEnd(e);
  });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    transform.x = mx - (mx - transform.x) * delta;
    transform.y = my - (my - transform.y) * delta;
    transform.scale = Math.max(0.15, Math.min(4, transform.scale * delta));
    applyTransform();
  }, { passive: false });

  document.addEventListener('click', (e) => {
    if (!ctxMenu.contains(e.target)) hideContextMenu();
    const helpPopup = document.getElementById('help-popup');
    const btnHelp   = document.getElementById('btn-help');
    if (helpPopup && btnHelp && !btnHelp.contains(e.target) && !helpPopup.contains(e.target)) {
      helpPopup.classList.add('hidden');
    }
  });

  const btnHelp = document.getElementById('btn-help');
  if (btnHelp) {
    btnHelp.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = document.getElementById('help-popup');
      if (p) p.classList.toggle('hidden');
    });
  }

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
    pushUndo(); node.collapsed = false; render(); postCollapseState();
  });
  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    if (!selectedId || !root) return;
    const node = findById(root, selectedId);
    if (!node || (!node.children.length && !getBodyItems(node.body).length) || node.collapsed) return;
    pushUndo(); node.collapsed = true; render(); postCollapseState();
  });

  // ─── Keyboard handler ─────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); performUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); vscode.postMessage({ type: 'save' }); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '=') { zoomBy(1.25); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { zoomBy(1 / 1.25); return; }

    if (editingId) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); performCopy(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); performCut(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); performPaste(); return; }

    if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) { fitView(); return; }

    // Delete
    if (e.key === 'Delete') {
      if (selectedBodyItemData || selectedBodyItemKeys.size > 0) {
        // Multi-body delete
        const keysToDelete = new Set([
          ...(selectedBodyItemKey ? [selectedBodyItemKey] : []),
          ...selectedBodyItemKeys
        ]);
        if (keysToDelete.size > 1) {
          // Collect and sort by lineIdx descending to avoid index shift issues
          const toDelete = [];
          for (const k of keysToDelete) {
            const data = selectedBodyItemsData.get(k) || (k === selectedBodyItemKey ? selectedBodyItemData : null);
            if (data) toDelete.push(data);
          }
          toDelete.sort((a, b) => b.lineIdx - a.lineIdx);
          pushUndo();
          for (const data of toDelete) {
            deleteBodyItemNoUndo(data.parentNode, data.lineIdx);
          }
          selectedBodyItemKey = null;
          selectedBodyItemData = null;
          selectedBodyItemKeys.clear();
          selectedBodyItemsData.clear();
          render();
        } else if (selectedBodyItemData) {
          deleteBodyItem(selectedBodyItemData.parentNode, selectedBodyItemData.lineIdx);
        }
        return;
      }
      if (selectedIds.size > 1) {
        // Multi-node delete
        const allIds = new Set([...selectedIds, ...(selectedId ? [selectedId] : [])]);
        const nodes = [...allIds].map(id => findById(root, id)).filter(n => n && n.id !== root.id);
        if (nodes.length === 0) return;
        pushUndo();
        for (const node of nodes) {
          const parent = findParent(root, node);
          if (parent) parent.children = parent.children.filter(c => c.id !== node.id);
        }
        selectedId = null;
        selectedIds.clear();
        postStructuralEdit();
        render();
        return;
      }
      if (selectedId) { const node = findById(root, selectedId); if (node) deleteNode(node); return; }
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

    // F2: edit
    if (e.key === 'F2') {
      if (selectedBodyItemData) {
        e.preventDefault();
        const nodeEl = document.querySelector(`.body-node[data-body-key="${selectedBodyItemKey}"]`);
        const lbl = nodeEl && nodeEl.querySelector('.body-node-label');
        // find the item
        const allItems = getBodyItems(selectedBodyItemData.parentNode.body);
        const item = allItems.find(i => i.lineIdx === selectedBodyItemData.lineIdx);
        if (lbl && item) beginBodyItemEdit(selectedBodyItemData.parentNode, item, nodeEl, lbl);
        return;
      }
      if (selectedId) {
        e.preventDefault();
        const node = findById(root, selectedId);
        if (node) {
          const nodeEl = document.querySelector(`.node[data-id="${node.id}"]`);
          const lbl = nodeEl && nodeEl.querySelector('.label');
          if (lbl) beginEdit(node, nodeEl, lbl);
        }
        return;
      }
    }

    // Tab: add child body item
    if (e.key === 'Tab' && !e.shiftKey && selectedBodyItemData) {
      e.preventDefault();
      const { parentNode, lineIdx, indent } = selectedBodyItemData;
      addBodyItem(parentNode, lineIdx, indent + 2);
      return;
    }

    // Enter: add sibling body item (after subtree)
    if (e.key === 'Enter' && selectedBodyItemData) {
      e.preventDefault();
      const { parentNode, lineIdx, indent } = selectedBodyItemData;
      // find the item in tree to get its subtree last line
      const tree = getBodyItemTree(parentNode.body);
      const item = findBodyItemByLineIdx(tree, lineIdx);
      const lastLine = item ? bodyItemLastLineIdx(item) : lineIdx;
      addBodyItem(parentNode, lastLine, indent);
      return;
    }

    // Enter: add heading sibling
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

    // Tab: add child heading
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
        if (selectedBodyItemKey || selectedBodyItemKeys.size > 0) {
          document.querySelectorAll('.body-node.selected').forEach(el => el.classList.remove('selected'));
          selectedBodyItemKey = null;
          selectedBodyItemData = null;
          selectedBodyItemKeys.clear();
          selectedBodyItemsData.clear();
        } else if (selectedId || selectedIds.size > 0) {
          selectedId = null;
          selectedIds.clear();
          document.querySelectorAll('.node.selected').forEach(el => el.classList.remove('selected'));
        }
        return;
      }
    }
  });

  // ─── Node Operations ──────────────────────────────────────────────────────

  function toggleCollapse(node) {
    pushUndo(); node.collapsed = !node.collapsed; render(); postCollapseState();
  }

  function postCollapseState() {
    if (!root) return;
    vscode.postMessage({ type: 'saveCollapseState', collapsedPaths: extractCollapsedPaths(root, '') });
  }

  function extractCollapsedPaths(node, parentPath) {
    const myPath = parentPath ? `${parentPath}/${node.text}` : node.text;
    const result = [];
    if (node.collapsed && (node.children.length || getBodyItems(node.body).length)) result.push(myPath);
    node.children.forEach(c => result.push(...extractCollapsedPaths(c, myPath)));
    return result;
  }

  function postStructuralEdit() {
    vscode.postMessage({ type: 'structuralEdit', root });
  }

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
    input.value = item.text;
    label.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const trimmed = input.value.trim();
      if (trimmed && trimmed !== item.text) {
        pushUndo();
        updateBodyLine(parentNode, item.lineIdx, trimmed, item.indent);
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

  function updateBodyLine(parentNode, lineIdx, newText, indent) {
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    const existing = lines[lineIdx];
    const chk = existing.match(/^(\s*)-\s+\[([ xX])\]\s+/);
    if (chk) {
      lines[lineIdx] = `${chk[1]}- [${chk[2]}] ${newText}`;
    } else {
      const indStr = ' '.repeat(indent !== undefined ? indent : 0);
      // top-level (indent=0): auto checkbox; nested: plain bullet
      if (!indent || indent === 0) {
        lines[lineIdx] = `${indStr}- [ ] ${newText}`;
      } else {
        lines[lineIdx] = `${indStr}- ${newText}`;
      }
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

  /**
   * Add a body item after afterLineIdx with the given indent.
   * indent=0 → top-level checkbox item; indent>0 → nested bullet item.
   */
  function addBodyItem(parentNode, afterLineIdx, indent) {
    indent = indent || 0;
    const lines = (parentNode.body || '').split('\n');
    const indStr = ' '.repeat(indent);
    // top-level gets checkbox template, nested gets plain bullet
    const newLine = indent === 0 ? `${indStr}- [ ] ` : `${indStr}- `;

    let insertAt;
    if (afterLineIdx !== undefined && afterLineIdx !== null) {
      insertAt = afterLineIdx + 1;
    } else {
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
    selectedBodyItemData = { parentNode, lineIdx: insertAt, indent };
    render();
  }

  function deleteBodyItemNoUndo(parentNode, lineIdx) {
    const tree = getBodyItemTree(parentNode.body);
    const item = findBodyItemByLineIdx(tree, lineIdx);
    if (!item) return;
    const lastLine = bodyItemLastLineIdx(item);
    const lineCount = lastLine - lineIdx + 1;
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    collapsedBodyItems.delete(`${parentNode.id}:${lineIdx}`);
    lines.splice(lineIdx, lineCount);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    parentNode.body = lines.join('\n');
    vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
  }

  function deleteBodyItem(parentNode, lineIdx) {
    const tree = getBodyItemTree(parentNode.body);
    const item = findBodyItemByLineIdx(tree, lineIdx);
    if (!item) return;
    const lastLine = bodyItemLastLineIdx(item);
    const lineCount = lastLine - lineIdx + 1;
    const lines = (parentNode.body || '').split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    collapsedBodyItems.delete(`${parentNode.id}:${lineIdx}`);
    pushUndo();
    lines.splice(lineIdx, lineCount);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    parentNode.body = lines.join('\n');
    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
    render();
  }

  function findBodyItemByLineIdx(tree, lineIdx) {
    for (const item of tree) {
      if (item.lineIdx === lineIdx) return item;
      const found = findBodyItemByLineIdx(item.children, lineIdx);
      if (found) return found;
    }
    return null;
  }

  // ─── Context Menu ─────────────────────────────────────────────────────────

  function buildContextMenu(items) {
    ctxMenu.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');
      if (item.divider) { li.className = 'divider'; }
      else {
        li.dataset.action = item.action;
        li.textContent = item.label;
        if (item.disabled) li.classList.add('disabled');
        if (item.danger)   li.classList.add('danger');
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
        pushUndo(); contextTarget.children.push(newNode); contextTarget.collapsed = false;
        selectedId = newNode.id; _pendingEditId = newNode.id;
        postStructuralEdit(); render(); break;
      }
      case 'add-sibling': {
        if (!contextTarget || !root) return;
        const parent = findParent(root, contextTarget);
        if (!parent) return;
        const newNode = makeNode('新しいノード', contextTarget.level);
        const idx = parent.children.indexOf(contextTarget);
        pushUndo(); parent.children.splice(idx + 1, 0, newNode);
        selectedId = newNode.id; _pendingEditId = newNode.id;
        postStructuralEdit(); render(); break;
      }
      case 'add-body':          { if (contextTarget) addBodyItem(contextTarget, null, 0); break; }
      case 'move-up':           { if (contextTarget) moveNode(contextTarget, -1); break; }
      case 'move-down':         { if (contextTarget) moveNode(contextTarget, 1); break; }
      case 'delete':            { if (contextTarget) deleteNode(contextTarget); break; }
      case 'body-add-child': {
        if (!contextBodyItem) return;
        addBodyItem(contextBodyItem.parentNode, contextBodyItem.item.lineIdx, contextBodyItem.item.indent + 2);
        break;
      }
      case 'body-add-sibling': {
        if (!contextBodyItem) return;
        const tree = getBodyItemTree(contextBodyItem.parentNode.body);
        const it = findBodyItemByLineIdx(tree, contextBodyItem.item.lineIdx);
        const last = it ? bodyItemLastLineIdx(it) : contextBodyItem.item.lineIdx;
        addBodyItem(contextBodyItem.parentNode, last, contextBodyItem.item.indent);
        break;
      }
      case 'body-item-delete':  { if (contextBodyItem) deleteBodyItem(contextBodyItem.parentNode, contextBodyItem.item.lineIdx); break; }
    }
  }

  function showHeadingContextMenu(e, node) {
    contextTarget = node;
    contextBodyItem = null;
    selectedId = node.id;
    selectedIds.clear();
    selectedBodyItemKeys.clear();
    selectedBodyItemsData.clear();

    const parent = root ? findParent(root, node) : null;
    const idx = parent ? parent.children.indexOf(node) : -1;

    buildContextMenu([
      { action: 'add-child',    label: '子ノードを追加',          disabled: node.level >= 6 },
      { action: 'add-sibling',  label: '兄弟ノードを追加',        disabled: !parent },
      { action: 'add-body',     label: '本文項目を追加',          disabled: false },
      { divider: true },
      { action: 'move-up',      label: '↑ 上へ移動',            disabled: !parent || idx <= 0 },
      { action: 'move-down',    label: '↓ 下へ移動',            disabled: !parent || idx >= parent.children.length - 1 },
      { divider: true },
      { action: 'delete',       label: '削除',                  danger: true },
    ]);

    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top  = e.clientY + 'px';
    ctxMenu.classList.remove('hidden');

    document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
    const nodeEl = document.querySelector(`.node[data-id="${node.id}"]`);
    if (nodeEl) nodeEl.classList.add('selected');
  }

  function showBodyItemContextMenu(e, parentNode, item, key) {
    contextTarget = null;
    contextBodyItem = { parentNode, item, key };
    selectedBodyItemKey = key;
    selectedBodyItemData = { parentNode, lineIdx: item.lineIdx, indent: item.indent };
    selectedIds.clear();
    selectedBodyItemKeys.clear();
    selectedBodyItemsData.clear();

    buildContextMenu([
      { action: 'body-add-sibling', label: '同階層に追加',              disabled: false },
      { action: 'body-add-child',   label: '子項目を追加',              disabled: false },
      { divider: true },
      { action: 'body-item-delete', label: '本文行を削除',              danger: true },
    ]);

    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top  = e.clientY + 'px';
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
    if (!root || node.id === root.id) return;
    const parent = findParent(root, node);
    if (!parent) return;
    pushUndo();
    parent.children = parent.children.filter(c => c.id !== node.id);
    if (selectedId === node.id) selectedId = null;
    postStructuralEdit();
    render();
  }

  // ─── Heading Drag & Drop ──────────────────────────────────────────────────

  function beginDrag(e, node) {
    if (node.id === root?.id) return;
    e.preventDefault(); e.stopPropagation();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';

    // Collect all nodes to drag (multi-select or single)
    let dragNodes;
    const totalSelected = selectedIds.size + (selectedId && !selectedIds.has(selectedId) ? 1 : 0);
    if (totalSelected > 1 && (selectedIds.has(node.id) || selectedId === node.id)) {
      // Multi-drag: gather all selected nodes
      const allSelected = new Set(selectedIds);
      if (selectedId) allSelected.add(selectedId);
      // Filter out root and nodes that are descendants of other selected nodes
      dragNodes = [...allSelected]
        .map(id => findById(root, id))
        .filter(n => n && n.id !== root.id)
        .filter(n => {
          // Exclude if any other selected node is its ancestor
          for (const id2 of allSelected) {
            if (id2 !== n.id) {
              const ancestor = findById(root, id2);
              if (ancestor && isDescendant(ancestor, n) && ancestor.id !== n.id) return false;
            }
          }
          return true;
        });
      ghost.textContent = dragNodes.length > 1 ? `${dragNodes.length}個のノード` : (dragNodes[0] ? dragNodes[0].text : node.text);
    } else {
      dragNodes = [node];
      ghost.textContent = node.text;
    }

    ghost.style.left = e.clientX + 'px';
    ghost.style.top  = e.clientY + 'px';
    document.body.appendChild(ghost);
    dragState = { node, nodes: dragNodes, startX: e.clientX, startY: e.clientY, moved: false, ghost };
  }

  function onDragMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX, dy = e.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) dragState.moved = true;
    if (dragState.moved) {
      dragState.ghost.style.left = (e.clientX + 12) + 'px';
      dragState.ghost.style.top  = (e.clientY - 18) + 'px';
      updateDropFeedback(e, dragState.node);
    }
  }

  function onDragEnd(e) {
    const ds = dragState;
    // Resolve drop target before clearing dragState so getDropTarget can
    // exclude all dragged nodes (not just ds.node) from candidates.
    const result = getDropTarget(e, ds.node);
    dragState = null;
    ds.ghost.remove();
    clearDropFeedback();
    if (!ds.moved) return;
    if (result && result.position !== 'h6-blocked') {
      if (ds.nodes && ds.nodes.length > 1) {
        performMultiDrop(ds.nodes, result.targetNode, result.position);
      } else {
        performDrop(ds.node, result.targetNode, result.position);
      }
    }
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
      dropIndicator.className = 'drop-line';
      dropIndicator.style.display = 'block';
      dropIndicator.style.left  = sx + 'px';
      dropIndicator.style.top   = (sy - 2) + 'px';
      dropIndicator.style.width = (NODE_W * transform.scale) + 'px';
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
    const sy = (e.clientY - stageRect.top  - transform.y) / transform.scale;
    let best = null, bestDist = 40;
    // Use all dragged nodes if multi-drag
    const draggedNodes = (dragState && dragState.nodes && dragState.nodes.length > 1)
      ? dragState.nodes : [draggedNode];
    collectDropCandidates(root, draggedNodes, sx, sy, bestDist, (result, dist) => {
      if (dist < bestDist) { bestDist = dist; best = result; }
    });
    return best;
  }

  function collectDropCandidates(node, dragged, sx, sy, tolerance, cb) {
    // dragged can be a single node or an array of nodes
    const draggedArr = Array.isArray(dragged) ? dragged : [dragged];
    if (draggedArr.some(d => node.id === d.id || isDescendant(d, node))) return;
    const nx = node._x, ny = node._y, nw = NODE_W, nh = NODE_H;
    if (sx >= nx - tolerance && sx <= nx + nw + tolerance && sy >= ny - tolerance && sy <= ny + nh + tolerance) {
      const relY = sy - ny;
      let pos = relY < nh * 0.25 ? 'before' : relY > nh * 0.75 ? 'after' : 'inside';
      if (pos === 'inside' && node.level >= 6) pos = 'h6-blocked';
      cb({ targetNode: node, position: pos }, Math.sqrt((sx - nx - nw/2)**2 + (sy - ny - nh/2)**2));
    }
    if (!node.collapsed) node.children.forEach(c => collectDropCandidates(c, dragged, sx, sy, tolerance, cb));
  }

  // Drop multiple nodes at a target position
  function performMultiDrop(nodes, targetNode, position) {
    if (!root) return;
    pushUndo();
    // Remove all dragged nodes from their parents first
    const removedNodes = [];
    for (const draggedNode of nodes) {
      const srcParent = findParent(root, draggedNode);
      if (!srcParent) continue;
      srcParent.children = srcParent.children.filter(c => c.id !== draggedNode.id);
      removedNodes.push(draggedNode);
    }
    if (removedNodes.length === 0) return;

    if (position === 'inside') {
      for (const n of removedNodes) {
        n.level = targetNode.level + 1;
        updateChildLevels(n);
        targetNode.children.push(n);
      }
      targetNode.collapsed = false;
    } else {
      const targetParent = findParent(root, targetNode);
      if (!targetParent) return;
      const baseIdx = targetParent.children.indexOf(targetNode);
      const insertIdx = position === 'before' ? baseIdx : baseIdx + 1;
      for (let i = 0; i < removedNodes.length; i++) {
        const n = removedNodes[i];
        n.level = targetNode.level;
        updateChildLevels(n);
        targetParent.children.splice(insertIdx + i, 0, n);
      }
    }
    postStructuralEdit();
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
    e.preventDefault(); e.stopPropagation();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';

    // Collect all body items to drag (multi-select or single)
    const key = `${parentNode.id}:${item.lineIdx}`;
    const totalBodySelected = selectedBodyItemKeys.size + (selectedBodyItemKey && !selectedBodyItemKeys.has(selectedBodyItemKey) ? 1 : 0);
    let dragItems; // array of { parentNode, lineIdx, item }
    if (totalBodySelected > 1 && (selectedBodyItemKeys.has(key) || selectedBodyItemKey === key)) {
      const allKeys = new Set(selectedBodyItemKeys);
      if (selectedBodyItemKey) allKeys.add(selectedBodyItemKey);
      dragItems = [];
      for (const k of allKeys) {
        const data = selectedBodyItemsData.get(k) || (k === selectedBodyItemKey ? selectedBodyItemData : null);
        if (!data) continue;
        const tree = getBodyItemTree(data.parentNode.body);
        const it = findBodyItemByLineIdx(tree, data.lineIdx);
        if (it) dragItems.push({ parentNode: data.parentNode, lineIdx: data.lineIdx, item: it });
      }
      ghost.textContent = dragItems.length > 1 ? `${dragItems.length}個の項目` : (dragItems[0] ? dragItems[0].item.text : item.text);
    } else {
      dragItems = [{ parentNode, lineIdx: item.lineIdx, item }];
      ghost.textContent = item.text;
    }

    ghost.style.left = e.clientX + 'px';
    ghost.style.top  = e.clientY + 'px';
    document.body.appendChild(ghost);
    // Store primary drag item for drop-target calculation, plus all items for multi-drop
    bodyDragState = { parentNode, lineIdx: item.lineIdx, item, dragItems, startX: e.clientX, startY: e.clientY, moved: false, ghost };
  }

  function onBodyDragMove(e) {
    if (!bodyDragState) return;
    const dx = e.clientX - bodyDragState.startX, dy = e.clientY - bodyDragState.startY;
    if (!bodyDragState.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) bodyDragState.moved = true;
    if (bodyDragState.moved) {
      bodyDragState.ghost.style.left = (e.clientX + 12) + 'px';
      bodyDragState.ghost.style.top  = (e.clientY - 18) + 'px';
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
      if (result.position === 'inside') {
        const el = document.querySelector(`.body-node[data-body-key="${result.targetNode.id}:${result.targetItem.lineIdx}"]`);
        if (el) el.classList.add('drop-over');
      } else {
        const item = result.targetItem;
        const lineY = result.position === 'before' ? item._y : item._y + BODY_H;
        const sx = item._x * transform.scale + transform.x;
        const sy = lineY * transform.scale + transform.y;
        dropIndicator.className = 'drop-line';
        dropIndicator.style.display = 'block';
        dropIndicator.style.left  = sx + 'px';
        dropIndicator.style.top   = (sy - 2) + 'px';
        dropIndicator.style.width = (NODE_W * transform.scale) + 'px';
      }
    } else if (result.type === 'heading') {
      const el = document.querySelector(`.node[data-id="${result.targetNode.id}"]`);
      if (el) el.classList.add('drop-over');
    }
  }

  function clearBodyDropFeedback() {
    document.querySelectorAll('.node.drop-over, .body-node.drop-over').forEach(el => el.classList.remove('drop-over'));
    dropIndicator.style.display = 'none';
    dropIndicator.className = '';
  }

  function getBodyDropTarget(e, ds) {
    const stageRect = stage.getBoundingClientRect();
    const sx = (e.clientX - stageRect.left - transform.x) / transform.scale;
    const sy = (e.clientY - stageRect.top  - transform.y) / transform.scale;
    let best = null, bestDist = 40;
    collectBodyDropCandidates(root, ds, sx, sy, (result, dist) => {
      if (dist < bestDist) { bestDist = dist; best = result; }
    });
    return best;
  }

  function collectBodyDropFromItems(items, ds, sx, sy, cb) {
    for (const item of items) {
      // Skip the dragged item itself (match by owner + lineIdx)
      const isDragSrc = item._owner && item._owner.id === ds.parentNode.id && item.lineIdx === ds.lineIdx;
      if (!isDragSrc) {
        const nx = item._x, ny = item._y, nw = NODE_W, nh = BODY_H;
        if (sx >= nx - 40 && sx <= nx + nw + 40 && sy >= ny - 40 && sy <= ny + nh + 40) {
          const relY = sy - ny;
          const pos = relY < nh * 0.25 ? 'before' : relY > nh * 0.75 ? 'after' : 'inside';
          cb({ type: 'body-item', targetNode: item._owner, targetItem: item, position: pos },
             Math.sqrt((sx - nx - nw/2)**2 + (sy - ny - nh/2)**2));
        }
      }
      collectBodyDropFromItems(item.children, ds, sx, sy, cb);
    }
  }

  function collectBodyDropCandidates(node, ds, sx, sy, cb) {
    if (!node.collapsed && node._bodyItems) {
      // tag items with owner (heading node) for later reference
      function tagOwner(items, owner) {
        for (const i of items) { i._owner = owner; tagOwner(i.children, owner); }
      }
      tagOwner(node._bodyItems, node);
      for (const item of node._bodyItems) {
        if (node.id === ds.parentNode.id && item.lineIdx === ds.lineIdx) continue;
        const nx = item._x, ny = item._y, nw = NODE_W, nh = BODY_H;
        if (sx >= nx - 40 && sx <= nx + nw + 40 && sy >= ny - 40 && sy <= ny + nh + 40) {
          const relY = sy - ny;
          const pos = relY < nh * 0.25 ? 'before' : relY > nh * 0.75 ? 'after' : 'inside';
          cb({ type: 'body-item', targetNode: node, targetItem: item, position: pos },
             Math.sqrt((sx - nx - nw/2)**2 + (sy - ny - nh/2)**2));
        }
        collectBodyDropFromItems(item.children, ds, sx, sy, cb);
      }
    }
    const nx = node._x, ny = node._y, nw = NODE_W, nh = NODE_H;
    if (sx >= nx - 30 && sx <= nx + nw + 30 && sy >= ny - 30 && sy <= ny + nh + 30) {
      cb({ type: 'heading', targetNode: node },
         Math.sqrt((sx - nx - nw/2)**2 + (sy - ny - nh/2)**2));
    }
    if (!node.collapsed) node.children.forEach(c => collectBodyDropCandidates(c, ds, sx, sy, cb));
  }

  function performBodyDrop(e, ds) {
    const result = getBodyDropTarget(e, ds);
    if (!result) return;

    pushUndo();

    // Determine destination indent
    let destIndent;
    if (result.type === 'heading') {
      destIndent = 0;
    } else if (result.position === 'inside') {
      destIndent = result.targetItem.indent + 2;
    } else {
      destIndent = result.targetItem.indent;
    }

    // Resolve all items to move (multi-drag or single)
    const dragItems = ds.dragItems && ds.dragItems.length > 0 ? ds.dragItems : [{ parentNode: ds.parentNode, lineIdx: ds.lineIdx, item: null }];

    // Resolve item objects for each drag entry, and collect all lines to move
    // Build a list of { parentNode, lineIdx, lineCount, lines, srcIndent }
    const resolved = [];
    for (const di of dragItems) {
      const tree = getBodyItemTree(di.parentNode.body);
      const it = di.item || findBodyItemByLineIdx(tree, di.lineIdx);
      if (!it) continue;
      const lastLine = bodyItemLastLineIdx(it);
      const lineCount = lastLine - di.lineIdx + 1;
      const srcLinesArr = (di.parentNode.body || '').split('\n');
      const movedLines = srcLinesArr.slice(di.lineIdx, di.lineIdx + lineCount);
      resolved.push({ parentNode: di.parentNode, lineIdx: di.lineIdx, lineCount, movedLines, srcIndent: it.indent });
    }
    if (resolved.length === 0) return;

    // Sort by lineIdx descending to avoid index shifts when removing from source
    resolved.sort((a, b) => b.lineIdx - a.lineIdx);

    // Save original lineIdx of drop target before any deletions (for same-parent adjustment)
    const origTargetLineIdx = result.type === 'body-item' ? result.targetItem.lineIdx : -1;

    // Remove all source items from their parent bodies
    for (const r of resolved) {
      const srcLines = (r.parentNode.body || '').split('\n');
      srcLines.splice(r.lineIdx, r.lineCount);
      while (srcLines.length > 0 && srcLines[srcLines.length - 1].trim() === '') srcLines.pop();
      r.parentNode.body = srcLines.join('\n');
    }

    // Collect all reformatted lines in original order (reversed resolved is ascending)
    const allReformattedLines = [];
    for (const r of resolved.slice().reverse()) {
      allReformattedLines.push(...reformatBodyLines(r.movedLines, r.srcIndent, destIndent));
    }

    // Compute lines removed from the target node that were BEFORE the target item's original lineIdx.
    // Only lines before origTargetLineIdx shift the target's position downward.
    let targetParentRemovedCount = 0;
    if (result.type === 'body-item') {
      for (const r of resolved) {
        if (r.parentNode.id === result.targetNode.id && r.lineIdx < origTargetLineIdx) {
          targetParentRemovedCount += r.lineCount;
        }
      }
    }

    // Insert all moved lines at destination
    if (result.type === 'body-item') {
      // Compute adjusted lineIdx of target item after prior deletions
      const adjustedIdx = origTargetLineIdx - targetParentRemovedCount;
      // Search for the item at adjusted index or by text
      const flatItems = getBodyItems(result.targetNode.body);
      let updatedTargetItem = flatItems.find(i => i.lineIdx === adjustedIdx) ||
                              flatItems.find(i => i.text === result.targetItem.text);
      if (!updatedTargetItem) {
        // Fallback: append to end
        const tgtLines = (result.targetNode.body || '').split('\n');
        const allItems2 = getBodyItems(result.targetNode.body);
        const insertAt2 = allItems2.length > 0 ? allItems2[allItems2.length - 1].lineIdx + 1 : tgtLines.length;
        tgtLines.splice(insertAt2, 0, ...allReformattedLines);
        result.targetNode.body = tgtLines.join('\n');
      } else {
        const tgtLines = (result.targetNode.body || '').split('\n');
        const updatedLastLine = bodyItemLastLineIdx(updatedTargetItem);
        let insertAt;
        if (result.position === 'inside') {
          insertAt = updatedTargetItem.lineIdx + 1;
        } else {
          insertAt = result.position === 'after' ? updatedLastLine + 1 : updatedTargetItem.lineIdx;
        }
        tgtLines.splice(Math.max(0, insertAt), 0, ...allReformattedLines);
        result.targetNode.body = tgtLines.join('\n');
      }
    } else {
      // Drop onto heading node: append at end of body
      const tgtAllItems = getBodyItems(result.targetNode.body);
      const tgtLines = (result.targetNode.body || '').split('\n');
      const insertAt = tgtAllItems.length > 0
        ? tgtAllItems[tgtAllItems.length - 1].lineIdx + 1
        : tgtLines.length;
      tgtLines.splice(insertAt, 0, ...allReformattedLines);
      result.targetNode.body = tgtLines.join('\n');
    }

    // Post edits: collect all affected nodes and send messages
    const affectedNodes = new Set();
    for (const r of resolved) affectedNodes.add(r.parentNode.id);
    affectedNodes.add(result.targetNode.id);

    // Build a set of all modified nodes
    const allNodes = new Map(); // id -> node
    for (const r of resolved) allNodes.set(r.parentNode.id, r.parentNode);
    allNodes.set(result.targetNode.id, result.targetNode);

    if (affectedNodes.size === 1 && result.type === 'body-item' && result.targetNode.id === ds.parentNode.id) {
      // Single-parent edit
      vscode.postMessage({ type: 'editBody', id: result.targetNode.id, body: result.targetNode.body });
    } else {
      // Multiple parents changed — do a structural edit
      postStructuralEdit();
    }

    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    selectedBodyItemKeys.clear();
    selectedBodyItemsData.clear();
    render();
  }

  /** Reformat body lines when moving between indent levels.
   *  indent=0 → checkbox (- [ ] / - [x] ), indent>0 → plain bullet (- text) */
  function reformatBodyLines(lines, srcIndent, destIndent) {
    const delta = destIndent - srcIndent;
    return lines.map(line => {
      const m = line.match(/^(\s*)-\s+(\[[ xX]\]\s+)?(.*)$/);
      if (!m) return line;
      const newIndent = Math.max(0, m[1].length + delta);
      const indStr = ' '.repeat(newIndent);
      const text = m[3];
      if (newIndent === 0) {
        return m[2] ? `${indStr}- ${m[2].trimEnd()} ${text}` : `${indStr}- [ ] ${text}`;
      } else {
        return `${indStr}- ${text}`;
      }
    });
  }

  // ─── Copy / Paste ─────────────────────────────────────────────────────────

  function cloneWithNewIds(node) {
    return {
      id: String(_idSeq++),
      text: node.text,
      level: node.level,
      collapsed: node.collapsed,
      body: node.body,
      children: node.children.map(cloneWithNewIds)
    };
  }

  function performCopy() {
    // Multi-select heading nodes
    const multiIds = selectedIds.size > 0 ? new Set([...selectedIds, ...(selectedId ? [selectedId] : [])]) : null;
    if (multiIds && multiIds.size > 1 && !selectedBodyItemData) {
      const nodes = [...multiIds].map(id => findById(root, id)).filter(Boolean);
      if (nodes.length === 0) return;
      clipboard = { type: 'heading-multi', nodes: nodes.map(cloneForUndo) };
      return;
    }

    // Multi-select body items
    const multiBodyKeys = selectedBodyItemKeys.size > 0
      ? new Set([...selectedBodyItemKeys, ...(selectedBodyItemKey ? [selectedBodyItemKey] : [])])
      : null;
    if (multiBodyKeys && multiBodyKeys.size > 1) {
      const items = [];
      for (const k of multiBodyKeys) {
        const data = selectedBodyItemsData.get(k) || (k === selectedBodyItemKey ? selectedBodyItemData : null);
        if (!data) continue;
        const tree = getBodyItemTree(data.parentNode.body);
        const item = findBodyItemByLineIdx(tree, data.lineIdx);
        if (!item) continue;
        const lastLine = bodyItemLastLineIdx(item);
        const lines = (data.parentNode.body || '').split('\n');
        items.push({ lines: lines.slice(data.lineIdx, lastLine + 1), indent: item.indent, parentNodeId: data.parentNode.id });
      }
      if (items.length === 0) return;
      clipboard = { type: 'body-multi', items };
      return;
    }

    if (selectedBodyItemData) {
      const { parentNode, lineIdx } = selectedBodyItemData;
      const tree = getBodyItemTree(parentNode.body);
      const item = findBodyItemByLineIdx(tree, lineIdx);
      if (!item) return;
      const lastLine = bodyItemLastLineIdx(item);
      const lines = (parentNode.body || '').split('\n');
      clipboard = { type: 'body', lines: lines.slice(lineIdx, lastLine + 1), indent: item.indent };
    } else if (selectedId && root) {
      const node = findById(root, selectedId);
      if (!node) return;
      clipboard = { type: 'heading', node: cloneForUndo(node) };
    }
  }

  function performCut() {
    performCopy();
    if (!clipboard) return;

    if (clipboard.type === 'body' && selectedBodyItemData) {
      const cutParentId = selectedBodyItemData.parentNode.id;
      deleteBodyItem(selectedBodyItemData.parentNode, selectedBodyItemData.lineIdx);
      // After cut, select the parent heading node so paste has a valid target
      selectedId = cutParentId;
    } else if (clipboard.type === 'body-multi') {
      // Delete all selected body items (high-to-low lineIdx to avoid index shift)
      const keysToDelete = new Set([
        ...(selectedBodyItemKey ? [selectedBodyItemKey] : []),
        ...selectedBodyItemKeys
      ]);
      const toDelete = [];
      for (const k of keysToDelete) {
        const data = selectedBodyItemsData.get(k) || (k === selectedBodyItemKey ? selectedBodyItemData : null);
        if (data) toDelete.push(data);
      }
      const cutParentId = toDelete.length > 0 ? toDelete[0].parentNode.id : null;
      toDelete.sort((a, b) => b.lineIdx - a.lineIdx);
      pushUndo();
      for (const data of toDelete) {
        deleteBodyItemNoUndo(data.parentNode, data.lineIdx);
      }
      selectedBodyItemKey = null;
      selectedBodyItemData = null;
      selectedBodyItemKeys.clear();
      selectedBodyItemsData.clear();
      // After cut, select the parent heading node so paste has a valid target
      if (cutParentId) selectedId = cutParentId;
      render();
    } else if (clipboard.type === 'heading' && selectedId && root) {
      const node = findById(root, selectedId);
      if (node) deleteNode(node);
    } else if (clipboard.type === 'heading-multi') {
      // Delete all selected nodes
      const allIds = new Set([...selectedIds, ...(selectedId ? [selectedId] : [])]);
      const nodes = [...allIds].map(id => findById(root, id)).filter(n => n && n.id !== root.id);
      if (nodes.length > 0) {
        pushUndo();
        for (const node of nodes) {
          const parent = findParent(root, node);
          if (parent) parent.children = parent.children.filter(c => c.id !== node.id);
        }
        selectedId = null;
        selectedIds.clear();
        postStructuralEdit();
        render();
      }
    }
  }

  function performPaste() {
    if (!clipboard) return;

    if (clipboard.type === 'body') {
      if (selectedBodyItemData) {
        const { parentNode, lineIdx } = selectedBodyItemData;
        const tree = getBodyItemTree(parentNode.body);
        const item = findBodyItemByLineIdx(tree, lineIdx);
        const lastLine = item ? bodyItemLastLineIdx(item) : lineIdx;
        // Paste as child of selected body item (indent + 2)
        const pasteLines = reformatBodyLines(clipboard.lines, clipboard.indent, selectedBodyItemData.indent + 2);
        const lines = (parentNode.body || '').split('\n');
        pushUndo();
        lines.splice(lastLine + 1, 0, ...pasteLines);
        parentNode.body = lines.join('\n');
        vscode.postMessage({ type: 'editBody', id: parentNode.id, body: parentNode.body });
        render();
      } else if (selectedId && root) {
        const node = findById(root, selectedId);
        if (!node) return;
        const pasteLines = reformatBodyLines(clipboard.lines, clipboard.indent, 0);
        const allItems = getBodyItems(node.body);
        const lines = (node.body || '').split('\n');
        const insertAt = allItems.length > 0 ? allItems[allItems.length - 1].lineIdx + 1 : lines.length;
        pushUndo();
        lines.splice(insertAt, 0, ...pasteLines);
        node.body = lines.join('\n');
        vscode.postMessage({ type: 'editBody', id: node.id, body: node.body });
        render();
      }
    } else if (clipboard.type === 'body-multi') {
      // Paste multiple body items after the selected body item (as siblings) or at end of node
      const targetNode = selectedBodyItemData
        ? selectedBodyItemData.parentNode
        : (selectedId && root ? findById(root, selectedId) : null);
      if (!targetNode) return;
      pushUndo();

      // Determine base insertAt and destIndent (same logic as single-body paste)
      let insertAt;
      let destIndent;
      if (selectedBodyItemData) {
        const selTree = getBodyItemTree(targetNode.body);
        const selItem = findBodyItemByLineIdx(selTree, selectedBodyItemData.lineIdx);
        const selLastLine = selItem ? bodyItemLastLineIdx(selItem) : selectedBodyItemData.lineIdx;
        insertAt = selLastLine + 1;
        destIndent = selectedBodyItemData.indent;
      } else {
        const allBodyItems = getBodyItems(targetNode.body);
        const lines = (targetNode.body || '').split('\n');
        insertAt = allBodyItems.length > 0 ? allBodyItems[allBodyItems.length - 1].lineIdx + 1 : lines.length;
        destIndent = 0;
      }

      // Paste all items in order, advancing insertAt after each
      for (const item of clipboard.items) {
        const pasteLines = reformatBodyLines(item.lines, item.indent, destIndent);
        const lines = (targetNode.body || '').split('\n');
        lines.splice(insertAt, 0, ...pasteLines);
        targetNode.body = lines.join('\n');
        insertAt += pasteLines.length;
      }
      vscode.postMessage({ type: 'editBody', id: targetNode.id, body: targetNode.body });
      render();
    } else if (clipboard.type === 'heading') {
      // When multi-selecting, use selectedId (primary selection) as paste target.
      // Fall back to the last entry in selectedIds when selectedId is somehow unset.
      const pasteTargetId = selectedId || (selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1] : null);
      if (!pasteTargetId || !root) return;
      const node = findById(root, pasteTargetId);
      if (!node) return;
      // Paste as child of selected node (not sibling)
      if (node.level >= 6) return; // at H6 limit, cannot add child heading
      const cloned = cloneWithNewIds(clipboard.node);
      // Adjust levels relative to child depth
      const targetChildLevel = node.level + 1;
      const levelDelta = targetChildLevel - cloned.level;
      function adjustLevels(n) {
        n.level = Math.max(1, Math.min(6, n.level + levelDelta));
        n.children.forEach(adjustLevels);
      }
      adjustLevels(cloned);
      pushUndo();
      node.children.push(cloned);
      node.collapsed = false;
      selectedId = cloned.id;
      selectedIds.clear();
      postStructuralEdit();
      render();
    } else if (clipboard.type === 'heading-multi') {
      // Use selectedId as paste target; fall back to last entry in selectedIds.
      const pasteTargetId = selectedId || (selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1] : null);
      if (!pasteTargetId || !root) return;
      const node = findById(root, pasteTargetId);
      if (!node) return;
      // Paste multiple nodes as children of selected node
      if (node.level >= 6) return;
      pushUndo();
      const targetChildLevel = node.level + 1;
      for (const srcNode of clipboard.nodes) {
        const cloned = cloneWithNewIds(srcNode);
        const levelDelta = targetChildLevel - cloned.level;
        function adjustLevelsMulti(n) {
          n.level = Math.max(1, Math.min(6, n.level + levelDelta));
          n.children.forEach(adjustLevelsMulti);
        }
        adjustLevelsMulti(cloned);
        node.children.push(cloned);
      }
      node.collapsed = false;
      selectedIds.clear();
      postStructuralEdit();
      render();
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  let _idSeq = Date.now();
  function makeNode(text, level) {
    return { id: String(_idSeq++), text, level, children: [], collapsed: false, body: '' };
  }

  function findById(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of node.children) { const f = findById(c, id); if (f) return f; }
    return null;
  }

  function findParent(node, target) {
    for (const c of node.children) {
      if (c.id === target.id) return node;
      const f = findParent(c, target);
      if (f) return f;
    }
    return null;
  }

  function isDescendant(ancestor, node) {
    if (ancestor.id === node.id) return true;
    return ancestor.children.some(c => isDescendant(c, node));
  }

  function updateChildLevels(node) {
    node.children.forEach(c => { c.level = node.level + 1; updateChildLevels(c); });
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
    selectedIds.clear();
    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    selectedBodyItemKeys.clear();
    selectedBodyItemsData.clear();
    render();
    vscode.postMessage({ type: 'structuralEdit', root });
  }

  // ─── Keyboard Navigation ──────────────────────────────────────────────────

  function getVisibleNodes() {
    const result = [];
    function collect(node) { result.push(node); if (!node.collapsed) node.children.forEach(collect); }
    if (root) collect(root);
    return result;
  }

  function scrollNodeIntoView(node) {
    if (node._x === undefined) return;
    const rect = stage.getBoundingClientRect(), margin = 60;
    const sx = node._x * transform.scale + transform.x;
    const sy = node._y * transform.scale + transform.y;
    const sw = NODE_W * transform.scale, sh = NODE_H * transform.scale;
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
    selectedIds.clear();
    selectedBodyItemKey = null;
    selectedBodyItemData = null;
    selectedBodyItemKeys.clear();
    selectedBodyItemsData.clear();
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
    if (key === 'ArrowDown') { if (idx < nodes.length - 1) selectNode(nodes[idx + 1]); }
    else if (key === 'ArrowUp') { if (idx > 0) selectNode(nodes[idx - 1]); }
    else if (key === 'ArrowRight') {
      const items = currentNode._bodyItems || getBodyItemTree(currentNode.body);
      if (currentNode.children.length || items.length) {
        if (currentNode.collapsed) { pushUndo(); currentNode.collapsed = false; render(); postCollapseState(); }
        if (currentNode.children.length) selectNode(currentNode.children[0]);
        else if (items.length) {
          const key2 = `${currentNode.id}:${items[0].lineIdx}`;
          document.querySelectorAll('.node.selected, .body-node.selected').forEach(el => el.classList.remove('selected'));
          selectedId = null;
          selectedBodyItemKey = key2;
          selectedBodyItemData = { parentNode: currentNode, lineIdx: items[0].lineIdx, indent: items[0].indent };
          const el = document.querySelector(`.body-node[data-body-key="${key2}"]`);
          if (el) el.classList.add('selected');
        }
      }
    } else if (key === 'ArrowLeft') {
      if ((currentNode.children.length || getBodyItems(currentNode.body).length) && !currentNode.collapsed) {
        pushUndo(); currentNode.collapsed = true; render(); postCollapseState(); selectNode(currentNode);
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
      // Restore body item collapse state from frontmatter
      if (msg.bodyItemCollapsePaths) {
        applyBodyItemCollapsePaths(msg.bodyItemCollapsePaths);
      }
      render();
    }
    if (msg.type === 'saved') showSaveIndicator();
  });

  /** Convert frontmatter paths → collapsedBodyItems Map entries */
  function applyBodyItemCollapsePaths(paths) {
    collapsedBodyItems.clear();
    if (!root || !paths || !paths.length) return;
    for (const path of paths) {
      const sep = path.indexOf('::');
      if (sep === -1) continue;
      const headingPath = path.substring(0, sep);
      const itemChain   = path.substring(sep + 2).split('::');
      const node = findNodeByHeadingPath(headingPath);
      if (!node) continue;
      const items = getBodyItemTree(node.body);
      const item  = findBodyItemByChain(items, itemChain, 0);
      if (!item) continue;
      collapsedBodyItems.set(`${node.id}:${item.lineIdx}`, true);
    }
  }

  function findNodeByHeadingPath(headingPath) {
    if (!root) return null;
    const parts = headingPath.split('/');
    if (root.text !== parts[0]) return null;
    let cur = root;
    for (let i = 1; i < parts.length; i++) {
      const next = cur.children.find(c => c.text === parts[i]);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function findBodyItemByChain(items, textChain, depth) {
    if (depth >= textChain.length) return null;
    for (const item of items) {
      if (item.text === textChain[depth]) {
        if (depth === textChain.length - 1) return item;
        const found = findBodyItemByChain(item.children, textChain, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  /** Convert collapsedBodyItems Map → frontmatter path strings */
  function extractBodyItemCollapsePaths() {
    if (!root) return [];
    const result = [];
    walkNode(root, '');
    return result;

    function walkNode(node, parentPath) {
      const myPath = parentPath ? `${parentPath}/${node.text}` : node.text;
      if (!node.collapsed && node._bodyItems) {
        for (const item of node._bodyItems) {
          walkItem(item, node.id, myPath, '');
        }
      }
      for (const child of node.children) walkNode(child, myPath);
    }

    function walkItem(item, nodeId, headingPath, chain) {
      const myChain = chain ? `${chain}::${item.text}` : item.text;
      if (collapsedBodyItems.get(`${nodeId}:${item.lineIdx}`)) {
        result.push(`${headingPath}::${myChain}`);
      }
      if (!item.collapsed) {
        for (const child of item.children) walkItem(child, nodeId, headingPath, myChain);
      }
    }
  }

  function postBodyItemCollapseState() {
    vscode.postMessage({ type: 'saveBodyItemCollapseState', paths: extractBodyItemCollapsePaths() });
  }

  function showSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 1800);
  }

  vscode.postMessage({ type: 'ready' });

})();
