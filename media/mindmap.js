// @ts-check
(function () {
  'use strict';

  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ── Layout constants ──────────────────────────────────────────────────────
  const NODE_W = 160;
  const NODE_H = 36;
  const H_GAP = 90;   // horizontal gap between levels
  const V_GAP = 14;   // vertical gap between sibling nodes

  // ── State ─────────────────────────────────────────────────────────────────
  let rootNode = null;
  let baseLevel = 0;

  let transform = { x: 60, y: 60, scale: 1 };

  // Drag state
  let dragNode = null;
  let dragStartClient = null;
  let isDragging = false;
  let ghostEl = null;
  let dropTarget = null;
  let dropPosition = null; // 'child' | 'before' | 'after'

  // Pan state
  let isPanning = false;
  let panStart = null;

  // Edit state
  let editingNode = null;
  let pendingConfirm = null;

  // Counter for unique IDs in new nodes
  let nodeIdCounter = Date.now();

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const svg = /** @type {SVGSVGElement} */ (document.getElementById('mindmap-svg'));
  const treeGroup = document.getElementById('tree-group');
  const svgContainer = document.getElementById('svg-container');
  const editOverlay = document.getElementById('edit-overlay');
  const editInput = /** @type {HTMLInputElement} */ (document.getElementById('edit-input'));

  // ── Message handling from extension ──────────────────────────────────────
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'update':
        rootNode = msg.data.root;
        baseLevel = msg.data.baseLevel;
        render();
        break;
      case 'confirmResult':
        if (pendingConfirm && pendingConfirm.id === msg.id) {
          pendingConfirm.resolve(msg.confirmed);
          pendingConfirm = null;
        }
        break;
    }
  });

  // ── Layout ────────────────────────────────────────────────────────────────
  function computeLayout(root) {
    let leafIdx = 0;

    function assign(node, depth) {
      node._x = depth * (NODE_W + H_GAP);
      const children = node.collapsed ? [] : node.children;
      if (children.length === 0) {
        node._y = leafIdx * (NODE_H + V_GAP);
        leafIdx++;
      } else {
        children.forEach(c => assign(c, depth + 1));
        node._y =
          (children[0]._y + children[children.length - 1]._y) / 2;
      }
    }

    assign(root, 0);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    if (!rootNode) return;
    computeLayout(rootNode);
    treeGroup.innerHTML = '';
    // Transparent rect so empty-space clicks register for panning
    const bg = svgEl('rect');
    bg.setAttribute('x', '-5000'); bg.setAttribute('y', '-5000');
    bg.setAttribute('width', '10000'); bg.setAttribute('height', '10000');
    bg.setAttribute('fill', 'none');
    bg.setAttribute('pointer-events', 'all');
    treeGroup.appendChild(bg);
    drawEdges(treeGroup, rootNode);
    drawNodes(treeGroup, rootNode, true);
    applyTransform();
    // Defer fitToScreen so the SVG has valid dimensions after paint
    requestAnimationFrame(fitToScreen);
  }

  function applyTransform() {
    treeGroup.setAttribute(
      'transform',
      `translate(${transform.x}, ${transform.y}) scale(${transform.scale})`
    );
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  function drawEdges(parent, node) {
    const children = node.collapsed ? [] : node.children;
    for (const child of children) {
      const x1 = node._x + NODE_W;
      const y1 = node._y + NODE_H / 2;
      const x2 = child._x;
      const y2 = child._y + NODE_H / 2;
      const mx = (x1 + x2) / 2;

      const path = svgEl('path');
      path.setAttribute('class', 'edge');
      path.setAttribute(
        'd',
        `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
      );
      parent.appendChild(path);
      drawEdges(parent, child);
    }
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────
  function drawNodes(parent, node, isRoot) {
    const g = svgEl('g');
    g.setAttribute('class', 'node-group' + (isRoot ? ' is-root' : ''));
    g.setAttribute('transform', `translate(${node._x}, ${node._y})`);
    g.dataset.nodeId = node.id;

    // Background rect
    const rect = svgEl('rect');
    rect.setAttribute('class', 'node-rect');
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', 6);
    g.appendChild(rect);

    // Label (truncated)
    const text = svgEl('text');
    text.setAttribute('class', 'node-text');
    text.setAttribute('x', NODE_W / 2);
    text.setAttribute('y', NODE_H / 2 + 1);
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = truncate(node.text, 20);
    g.appendChild(text);

    // Collapse toggle
    if (node.children.length > 0) {
      const tog = svgEl('circle');
      tog.setAttribute('class', 'collapse-toggle');
      tog.setAttribute('cx', NODE_W + 10);
      tog.setAttribute('cy', NODE_H / 2);
      tog.setAttribute('r', 9);
      g.appendChild(tog);

      const togTxt = svgEl('text');
      togTxt.setAttribute('class', 'collapse-toggle-text');
      togTxt.setAttribute('x', NODE_W + 10);
      togTxt.setAttribute('y', NODE_H / 2 + 1);
      togTxt.setAttribute('dominant-baseline', 'middle');
      togTxt.setAttribute('text-anchor', 'middle');
      togTxt.textContent = node.collapsed ? '+' : '−';
      g.appendChild(togTxt);

      tog.addEventListener('click', e => {
        e.stopPropagation();
        node.collapsed = !node.collapsed;
        render();
        sendUpdate();
      });
      togTxt.addEventListener('click', e => {
        e.stopPropagation();
        node.collapsed = !node.collapsed;
        render();
        sendUpdate();
      });
    }

    // Add-child button (top-right)
    const addBtn = makeActionBtn('+', NODE_W + 26, 3, 'add-btn');
    addBtn.addEventListener('click', e => { e.stopPropagation(); addChild(node); });
    g.appendChild(addBtn);

    // Add-sibling button (shown only for non-root)
    if (!isRoot) {
      const sibBtn = makeActionBtn('⊕', NODE_W + 26, NODE_H - 16, 'add-sibling-btn add-btn');
      sibBtn.addEventListener('click', e => { e.stopPropagation(); addSibling(node); });
      g.appendChild(sibBtn);

      // Delete button
      const delBtn = makeActionBtn('×', NODE_W + 48, (NODE_H - 13) / 2, 'delete-btn');
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteNode(node); });
      g.appendChild(delBtn);
    }

    // Double-click → inline edit
    g.addEventListener('dblclick', e => {
      e.stopPropagation();
      startEdit(node, g);
    });

    // Mousedown → drag
    g.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (
        e.target.classList.contains('collapse-toggle') ||
        e.target.classList.contains('collapse-toggle-text')
      ) return;
      e.stopPropagation();
      if (!isRoot) beginDrag(node, e);
    });

    parent.appendChild(g);

    // Recurse
    const children = node.collapsed ? [] : node.children;
    for (const child of children) {
      drawNodes(parent, child, false);
    }
  }

  function makeActionBtn(label, cx, cy, className) {
    const g = svgEl('g');
    g.setAttribute('class', `action-btn ${className}`);

    const circle = svgEl('circle');
    circle.setAttribute('cx', cx + 6);
    circle.setAttribute('cy', cy + 6);
    circle.setAttribute('r', 7);
    g.appendChild(circle);

    const text = svgEl('text');
    text.setAttribute('x', cx + 6);
    text.setAttribute('y', cy + 7);
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = label;
    g.appendChild(text);

    return g;
  }

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  function beginDrag(node, e) {
    dragNode = node;
    dragStartClient = { x: e.clientX, y: e.clientY };
    isDragging = false;

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragNode) return;
    const dx = e.clientX - dragStartClient.x;
    const dy = e.clientY - dragStartClient.y;

    if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
      isDragging = true;
      // Mark source node as dragging
      const srcEl = document.querySelector(`[data-node-id="${dragNode.id}"]`);
      if (srcEl) srcEl.classList.add('dragging');
      svgContainer.classList.add('grabbing');
    }

    if (!isDragging) return;

    // Move ghost
    if (!ghostEl) {
      ghostEl = createGhost();
      treeGroup.appendChild(ghostEl);
    }

    const svgPt = clientToSvg(e.clientX, e.clientY);
    ghostEl.setAttribute(
      'transform',
      `translate(${svgPt.x - NODE_W / 2}, ${svgPt.y - NODE_H / 2})`
    );

    // Find drop target
    updateDropTarget(svgPt);
  }

  function createGhost() {
    const g = svgEl('g');
    g.setAttribute('class', 'node-group drag-ghost');

    const rect = svgEl('rect');
    rect.setAttribute('class', 'node-rect');
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', 6);
    g.appendChild(rect);

    const text = svgEl('text');
    text.setAttribute('class', 'node-text');
    text.setAttribute('x', NODE_W / 2);
    text.setAttribute('y', NODE_H / 2 + 1);
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = truncate(dragNode.text, 20);
    g.appendChild(text);

    return g;
  }

  function updateDropTarget(svgPt) {
    let best = null;
    let bestDist = Infinity;

    function check(node) {
      if (node === dragNode) return;
      if (isDescendantOrSelf(dragNode, node)) return;

      const cx = node._x + NODE_W / 2;
      const cy = node._y + NODE_H / 2;
      const dist = Math.hypot(svgPt.x - cx, svgPt.y - cy);

      if (dist < 120 && dist < bestDist) {
        bestDist = dist;
        best = node;
      }

      const children = node.collapsed ? [] : node.children;
      for (const c of children) check(c);
    }

    check(rootNode);

    // Clear previous highlight
    if (dropTarget) {
      const el = document.querySelector(`[data-node-id="${dropTarget.id}"]`);
      if (el) el.classList.remove('drop-target');
    }

    dropTarget = best;

    if (dropTarget) {
      const el = document.querySelector(`[data-node-id="${dropTarget.id}"]`);
      if (el) el.classList.add('drop-target');
    }
  }

  function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);

    svgContainer.classList.remove('grabbing');

    // Restore source node appearance
    const srcEl = document.querySelector(`[data-node-id="${dragNode?.id}"]`);
    if (srcEl) srcEl.classList.remove('dragging');

    // Remove ghost
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }

    // Clear drop target highlight
    if (dropTarget) {
      const el = document.querySelector(`[data-node-id="${dropTarget.id}"]`);
      if (el) el.classList.remove('drop-target');
    }

    if (isDragging && dropTarget && dragNode) {
      // Determine drop position
      const svgPt = clientToSvg(e.clientX, e.clientY);
      const targetCenterY = dropTarget._y + NODE_H / 2;

      const threshold = NODE_H * 0.35;
      const dy = svgPt.y - targetCenterY;

      if (Math.abs(dy) < threshold || dropTarget === rootNode) {
        // Drop as child of target
        removeNodeFromTree(dragNode);
        dropTarget.children.push(dragNode);
        dropTarget.collapsed = false;
      } else {
        // Drop as sibling (before or after)
        const before = dy < 0;
        insertAsSibling(dragNode, dropTarget, before);
      }

      render();
      sendUpdate();
    }

    dragNode = null;
    dragStartClient = null;
    isDragging = false;
    dropTarget = null;
  }

  // ── Node operations ────────────────────────────────────────────────────────
  function addChild(parentNode) {
    const newNode = makeNode('New Node');
    parentNode.children.push(newNode);
    parentNode.collapsed = false;
    render();
    sendUpdate();

    // Focus edit on new node after render
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-node-id="${newNode.id}"]`);
      if (el) startEdit(newNode, el);
    });
  }

  function addSibling(node) {
    const newNode = makeNode('New Node');
    const inserted = insertAsSibling(newNode, node, false);
    if (inserted) {
      render();
      sendUpdate();
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${newNode.id}"]`);
        if (el) startEdit(newNode, el);
      });
    }
  }

  async function deleteNode(node) {
    if (node.children.length > 0) {
      const confirmed = await showConfirm(
        `"${node.text}" には子ノードが ${node.children.length} 個あります。すべて削除しますか？`
      );
      if (!confirmed) return;
    }
    removeNodeFromTree(node);
    render();
    sendUpdate();
  }

  // ── Inline editing ──────────────────────────────────────────────────────────
  function startEdit(node, nodeEl) {
    editingNode = node;

    const svgRect = svg.getBoundingClientRect();
    const containerRect = svgContainer.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();

    const left = nodeRect.left - containerRect.left;
    const top = nodeRect.top - containerRect.top;

    editInput.style.left = left + 'px';
    editInput.style.top = top + 'px';
    editInput.style.width = nodeRect.width + 'px';
    editInput.style.height = nodeRect.height + 'px';
    editInput.value = node.text;
    editOverlay.style.display = 'block';
    editInput.style.display = 'block';
    editInput.focus();
    editInput.select();
  }

  function commitEdit() {
    if (!editingNode) return;
    const newText = editInput.value.trim();
    if (newText && newText !== editingNode.text) {
      editingNode.text = newText;
      render();
      sendUpdate();
    }
    editingNode = null;
    editInput.style.display = 'none';
    editOverlay.style.display = 'none';
  }

  editInput.addEventListener('blur', commitEdit);
  editInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editInput.blur();
    } else if (e.key === 'Escape') {
      editingNode = null;
      editInput.style.display = 'none';
      editOverlay.style.display = 'none';
    }
  });

  // ── Pan & Zoom ─────────────────────────────────────────────────────────────
  svgContainer.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    transform.x = mx - (mx - transform.x) * factor;
    transform.y = my - (my - transform.y) * factor;
    transform.scale = Math.min(Math.max(transform.scale * factor, 0.2), 4);

    applyTransform();
  }, { passive: false });

  svgContainer.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    // Pan only when NOT clicking on a node
    if (e.target.closest && e.target.closest('.node-group')) return;
    isPanning = true;
    panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    svgContainer.classList.add('grabbing');
  });

  document.addEventListener('mousemove', e => {
    if (!isPanning || !panStart) return;
    transform.x = e.clientX - panStart.x;
    transform.y = e.clientY - panStart.y;
    applyTransform();
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      panStart = null;
      svgContainer.classList.remove('grabbing');
    }
  });

  // ── Toolbar buttons ────────────────────────────────────────────────────────
  document.getElementById('btn-text-editor').addEventListener('click', () => {
    vscode.postMessage({ type: 'openTextEditor' });
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    transform.scale = Math.min(transform.scale * 1.2, 4);
    applyTransform();
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    transform.scale = Math.max(transform.scale / 1.2, 0.2);
    applyTransform();
  });

  document.getElementById('btn-fit').addEventListener('click', fitToScreen);

  function fitToScreen() {
    if (!rootNode) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function bounds(node) {
      minX = Math.min(minX, node._x);
      minY = Math.min(minY, node._y);
      maxX = Math.max(maxX, node._x + NODE_W);
      maxY = Math.max(maxY, node._y + NODE_H);
      const children = node.collapsed ? [] : node.children;
      children.forEach(bounds);
    }
    bounds(rootNode);

    // Guard: layout coords not yet set
    if (!isFinite(minX) || !isFinite(minY)) return;

    const W = svg.clientWidth || svgContainer.clientWidth;
    const H = svg.clientHeight || svgContainer.clientHeight;
    if (!W || !H) return;

    const pad = 60;
    const treeW = maxX - minX || 1;
    const treeH = maxY - minY || 1;

    transform.scale = Math.min(
      (W - pad * 2) / treeW,
      (H - pad * 2) / treeH,
      1.5
    );
    transform.x = pad - minX * transform.scale;
    transform.y = pad - minY * transform.scale;

    applyTransform();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function sendUpdate() {
    vscode.postMessage({ type: 'updateTree', root: rootNode });
  }

  function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function truncate(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  function makeNode(text) {
    return {
      id: `new_${++nodeIdCounter}`,
      text,
      children: [],
      collapsed: false,
      bodyLines: [],
    };
  }

  function clientToSvg(cx, cy) {
    const rect = svg.getBoundingClientRect();
    return {
      x: (cx - rect.left - transform.x) / transform.scale,
      y: (cy - rect.top - transform.y) / transform.scale,
    };
  }

  function isDescendantOrSelf(target, ancestor) {
    if (target === ancestor) return true;
    const children = ancestor.collapsed ? [] : ancestor.children;
    return children.some(c => isDescendantOrSelf(target, c));
  }

  function removeNodeFromTree(node) {
    function remove(parent) {
      const idx = parent.children.indexOf(node);
      if (idx >= 0) {
        parent.children.splice(idx, 1);
        return true;
      }
      return parent.children.some(c => remove(c));
    }
    remove(rootNode);
  }

  /** Insert newNode before/after referenceNode within the same parent */
  function insertAsSibling(newNode, referenceNode, before) {
    function insert(parent) {
      const idx = parent.children.indexOf(referenceNode);
      if (idx >= 0) {
        // Remove newNode from wherever it currently lives (if it exists in tree)
        removeNodeFromTree(newNode);
        const insertIdx = before ? idx : idx + 1;
        parent.children.splice(insertIdx, 0, newNode);
        return true;
      }
      return parent.children.some(c => insert(c));
    }
    return insert(rootNode);
  }

  function showConfirm(text) {
    return new Promise(resolve => {
      const id = `confirm_${Date.now()}`;
      pendingConfirm = { id, resolve };
      vscode.postMessage({ type: 'showConfirm', text, id });
    });
  }

})();
