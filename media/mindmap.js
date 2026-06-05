// Markdown Mind Map Editor — Webview Script
// Runs inside the VS Code WebviewPanel (sandboxed browser context)
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ─── Constants ────────────────────────────────────────────────────────────

  const NODE_W = 180;
  const NODE_H = 36;
  const H_SPACE = 240;  // horizontal distance between levels
  const V_GAP = 16;     // vertical gap between siblings
  const PAD = 60;       // canvas padding

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
  let selectedId = null;
  let editingId = null;
  let transform = { x: 80, y: 0, scale: 1 };
  let contextTarget = null;

  // Tracks the visible node count from the last render; used to detect
  // structural changes (add / delete / collapse) that require a re-fit.
  let _lastNodeCount = 0;

  // Drag state
  let dragState = null; // { node, startX, startY, moved, ghost }

  // Pan state
  let panState = null; // { startMouseX, startMouseY, startTx, startTy }

  // ─── DOM refs ─────────────────────────────────────────────────────────────

  const stage = document.getElementById('stage');
  const svgLayer = document.getElementById('svg-layer');
  const nodeLayer = document.getElementById('node-layer');
  const dropIndicator = document.getElementById('drop-indicator');
  const ctxMenu = document.getElementById('context-menu');

  // ─── Layout ───────────────────────────────────────────────────────────────

  /** Compute the total vertical space a node's subtree needs */
  function computeSubtreeH(node) {
    if (!node.children.length || node.collapsed) {
      node._sh = NODE_H;
      return;
    }
    node.children.forEach(computeSubtreeH);
    const childSum = node.children.reduce((s, c) => s + c._sh, 0);
    const gaps = (node.children.length - 1) * V_GAP;
    node._sh = Math.max(NODE_H, childSum + gaps);
  }

  /** Assign x/y positions to every node */
  function assignPositions(node, x, topY) {
    node._x = x;
    node._y = topY + node._sh / 2 - NODE_H / 2;

    if (!node.collapsed && node.children.length) {
      let cy = topY;
      for (const child of node.children) {
        assignPositions(child, x + H_SPACE, cy);
        cy += child._sh + V_GAP;
      }
    }
  }

  function layout() {
    if (!root) return;
    computeSubtreeH(root);
    assignPositions(root, PAD, PAD);
  }

  /** Bounding box of all visible nodes */
  function getBounds(node) {
    const b = {
      minX: node._x,
      maxX: node._x + NODE_W,
      minY: node._y,
      maxY: node._y + NODE_H,
    };
    if (!node.collapsed) {
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

  /** Count all visible (non-collapsed) nodes in the subtree. */
  function countVisibleNodes(node) {
    if (node.collapsed) return 1;
    return 1 + node.children.reduce((s, c) => s + countVisibleNodes(c), 0);
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

    // Re-fit the view whenever the visible node count changes (node added,
    // deleted, or collapsed/expanded). Positions are always fresh here because
    // layout() runs synchronously above, so there are no rAF race conditions.
    const nodeCount = countVisibleNodes(root);
    if (nodeCount !== _lastNodeCount) {
      _lastNodeCount = nodeCount;
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && isFinite(bounds.minX)) {
        const w = bounds.maxX - bounds.minX + PAD * 2;
        const h = bounds.maxY - bounds.minY + PAD * 2;
        transform.scale = Math.min(rect.width / w, rect.height / h, 1.2);
        transform.x = (rect.width - w * transform.scale) / 2 + (PAD - bounds.minX) * transform.scale;
        transform.y = (rect.height - h * transform.scale) / 2 + (PAD - bounds.minY) * transform.scale;
      } else if (rect.width === 0 || rect.height === 0) {
        // Stage has no dimensions yet (first paint). Set the queued flag so the
        // ResizeObserver can trigger a re-fit once the layout settles. Also
        // schedule an rAF retry in case the ResizeObserver already fired before
        // this flag was set (race condition on panel creation).
        _fitQueued = true;
        requestAnimationFrame(() => {
          if (!_fitQueued || !root) return;
          const r2 = stage.getBoundingClientRect();
          if (r2.width > 0 && r2.height > 0) {
            _fitQueued = false;
            _lastNodeCount = 0; // force re-fit on next render
            render();
          }
        });
      }
    }

    applyTransform();
  }

  function drawConnections(node, parent) {
    if (node.collapsed || !node.children.length) return;
    const color = LEVEL_COLORS[Math.min(node.level + 1, LEVEL_COLORS.length - 1)];

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
      parent.appendChild(p);

      drawConnections(child, parent);
    }
  }

  function drawNodes(node, parent) {
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

    // Collapse toggle button
    if (node.children.length) {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn';
      btn.textContent = node.collapsed ? '▶' : '▼';
      btn.title = node.collapsed ? '展開' : '折りたたむ';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse(node);
      });
      div.appendChild(btn);
    }

    // Label
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.text;
    div.appendChild(label);

    // Tooltip: show full text only when text is truncated by ellipsis
    div.addEventListener('mouseenter', () => {
      const lbl = div.querySelector('.label');
      div.title = (lbl && lbl.scrollWidth > lbl.clientWidth) ? node.text : '';
    });

    // Events
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      // Update selection visually WITHOUT calling render() — render() destroys the
      // current div and breaks the subsequent dblclick event.
      document.querySelectorAll('.node.selected').forEach((el) => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedId = node.id;
    });

    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      // Find the current label element in the live div (click may have re-styled it)
      const liveLabel = div.querySelector('.label');
      if (liveLabel) beginEdit(node, div, liveLabel);
    });

    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e, node);
    });

    div.addEventListener('mousedown', (e) => {
      if (e.button === 0 && editingId !== node.id) {
        beginDrag(e, node);
      }
    });

    parent.appendChild(div);

    if (!node.collapsed) {
      for (const child of node.children) {
        drawNodes(child, parent);
      }
    }
  }

  // ─── Transform / Pan / Zoom ───────────────────────────────────────────────

  function applyTransform() {
    const t = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    svgLayer.style.transform = t;
    nodeLayer.style.transform = t;
  }

  function fitView() {
    if (!root) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      _fitQueued = true;
      return;
    }
    // Always recompute layout so positions are fresh regardless of call site.
    layout();
    const b = getBounds(root);
    if (!isFinite(b.minX) || !isFinite(b.minY) || !isFinite(b.maxX) || !isFinite(b.maxY)) return;
    const w = b.maxX - b.minX + PAD * 2;
    const h = b.maxY - b.minY + PAD * 2;
    transform.scale = Math.min(rect.width / w, rect.height / h, 1.2);
    transform.x = (rect.width - w * transform.scale) / 2 + (PAD - b.minX) * transform.scale;
    transform.y = (rect.height - h * transform.scale) / 2 + (PAD - b.minY) * transform.scale;
    applyTransform();
  }

  // True when a fit-view was requested while the stage had zero dimensions.
  // Cleared by the ResizeObserver once the stage is laid out.
  let _fitQueued = false;

  // Re-render (and fit) once the stage gains real dimensions after the initial
  // load, when the first 'update' message may arrive before CSS layout settles.
  new ResizeObserver(() => {
    if (_fitQueued && root) {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        _fitQueued = false;
        _lastNodeCount = 0; // force re-fit on the upcoming render
        render();
      }
    }
  }).observe(stage);

  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Start pan when clicking on empty space (stage, svg-layer, or connection paths).
    // Node mousedown calls stopPropagation, so nodes never reach here.
    const nodeEl = e.target.closest ? e.target.closest('.node') : null;
    if (!nodeEl) {
      panState = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startTx: transform.x,
        startTy: transform.y,
      };
      stage.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (panState) {
      transform.x = panState.startTx + e.clientX - panState.startMouseX;
      transform.y = panState.startTy + e.clientY - panState.startMouseY;
      applyTransform();
    }
    if (dragState) {
      onDragMove(e);
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (panState) {
      panState = null;
      stage.style.cursor = '';
    }
    if (dragState) {
      onDragEnd(e);
    }
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

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    transform.scale = Math.min(4, transform.scale * 1.25);
    applyTransform();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    transform.scale = Math.max(0.15, transform.scale / 1.25);
    applyTransform();
  });
  document.getElementById('btn-fit').addEventListener('click', fitView);
  document.getElementById('btn-expand-all').addEventListener('click', () => {
    if (!selectedId || !root) return;
    const node = findById(root, selectedId);
    if (!node || !node.children.length || !node.collapsed) return;
    node.collapsed = false;
    render();
    postCollapseState();
  });
  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    if (!selectedId || !root) return;
    const node = findById(root, selectedId);
    if (!node || !node.children.length || node.collapsed) return;
    node.collapsed = true;
    render();
    postCollapseState();
  });

  document.addEventListener('keydown', (e) => {
    // Ctrl+S / Cmd+S — save the backing Markdown file
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      vscode.postMessage({ type: 'save' });
      return;
    }
    if (e.key === 'f' || e.key === 'F') { fitView(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '=') {
      transform.scale = Math.min(4, transform.scale * 1.25); applyTransform();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      transform.scale = Math.max(0.15, transform.scale / 1.25); applyTransform();
    }
    if (e.key === 'Delete' && selectedId && !editingId) {
      const node = findById(root, selectedId);
      if (node) deleteNode(node);
    }
    if (e.altKey && e.key === 'ArrowUp' && selectedId && !editingId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (node) moveNodeUp(node);
    }
    if (e.altKey && e.key === 'ArrowDown' && selectedId && !editingId) {
      e.preventDefault();
      const node = findById(root, selectedId);
      if (node) moveNodeDown(node);
    }
  });

  // ─── Node Operations ──────────────────────────────────────────────────────

  function toggleCollapse(node) {
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
    if (node.collapsed && node.children.length) result.push(myPath);
    node.children.forEach((c) => result.push(...extractCollapsedPaths(c, myPath)));
    return result;
  }

  function postStructuralEdit() {
    vscode.postMessage({ type: 'structuralEdit', root });
  }

  // ─── Move Node Up / Down (sibling reorder) ────────────────────────────────

  function moveNodeUp(node) {
    if (!root) return;
    const parent = findParent(root, node);
    if (!parent) return;
    const idx = parent.children.indexOf(node);
    if (idx <= 0) return;
    parent.children[idx] = parent.children[idx - 1];
    parent.children[idx - 1] = node;
    postStructuralEdit();
    render();
  }

  function moveNodeDown(node) {
    if (!root) return;
    const parent = findParent(root, node);
    if (!parent) return;
    const idx = parent.children.indexOf(node);
    if (idx >= parent.children.length - 1) return;
    parent.children[idx] = parent.children[idx + 1];
    parent.children[idx + 1] = node;
    postStructuralEdit();
    render();
  }

  // ─── Inline Editing ───────────────────────────────────────────────────────

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
        node.text = trimmed;
        vscode.postMessage({ type: 'renameNode', id: node.id, newText: trimmed });
      }
      render();
    };

    const cancel = () => {
      editingId = null;
      render();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
      e.stopPropagation();
    });
  }

  // ─── Context Menu ─────────────────────────────────────────────────────────

  function showContextMenu(e, node) {
    contextTarget = node;
    selectedId = node.id;

    // Show/hide move items based on sibling position
    const parent = root ? findParent(root, node) : null;
    const idx = parent ? parent.children.indexOf(node) : -1;
    const elUp = document.getElementById('ctx-move-up');
    const elDown = document.getElementById('ctx-move-down');
    const elAddChild = document.getElementById('ctx-add-child');
    if (elUp)       elUp.classList.toggle('disabled', !parent || idx <= 0);
    if (elDown)     elDown.classList.toggle('disabled', !parent || idx >= parent.children.length - 1);
    // H6 cannot have children (no H7 in Markdown)
    if (elAddChild) elAddChild.classList.toggle('disabled', node.level >= 6);

    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top = e.clientY + 'px';
    ctxMenu.classList.remove('hidden');

    // Update selection highlight without a full re-render
    document.querySelectorAll('.node.selected').forEach((el) => el.classList.remove('selected'));
    const nodeEl = document.querySelector(`.node[data-id="${node.id}"]`);
    if (nodeEl) nodeEl.classList.add('selected');
  }

  function hideContextMenu() {
    ctxMenu.classList.add('hidden');
    contextTarget = null;
  }

  document.getElementById('ctx-add-child').addEventListener('click', () => {
    if (!contextTarget) return;
    if (contextTarget.level >= 6) return; // H6 cannot have children
    const newNode = makeNode('新しいノード', contextTarget.level + 1);
    contextTarget.children.push(newNode);
    contextTarget.collapsed = false;
    selectedId = newNode.id;
    hideContextMenu();
    postStructuralEdit();
    render();
  });

  document.getElementById('ctx-add-sibling').addEventListener('click', () => {
    if (!contextTarget || !root) return;
    const parent = findParent(root, contextTarget);
    if (!parent) { hideContextMenu(); return; }
    const newNode = makeNode('新しいノード', contextTarget.level);
    const idx = parent.children.indexOf(contextTarget);
    parent.children.splice(idx + 1, 0, newNode);
    selectedId = newNode.id;
    hideContextMenu();
    postStructuralEdit();
    render();
  });

  document.getElementById('ctx-move-up').addEventListener('click', () => {
    if (!contextTarget) return;
    const node = contextTarget;
    hideContextMenu();
    moveNodeUp(node);
  });

  document.getElementById('ctx-move-down').addEventListener('click', () => {
    if (!contextTarget) return;
    const node = contextTarget;
    hideContextMenu();
    moveNodeDown(node);
  });

  document.getElementById('ctx-delete').addEventListener('click', () => {
    if (!contextTarget) return;
    deleteNode(contextTarget);
    hideContextMenu();
  });

  function deleteNode(node) {
    if (!root) return;
    if (node.id === root.id) return; // can't delete root

    const hasChildren = node.children.length > 0;
    if (hasChildren) {
      if (!confirm(`"${node.text}" とすべての子ノードを削除しますか？`)) return;
    }

    const parent = findParent(root, node);
    if (!parent) return;
    parent.children = parent.children.filter((c) => c.id !== node.id);

    if (selectedId === node.id) selectedId = null;
    postStructuralEdit();
    render();
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────────

  function beginDrag(e, node) {
    if (node.id === root?.id) return; // root can't be dragged
    e.preventDefault();
    e.stopPropagation(); // prevent stage from starting a pan simultaneously

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
    if (!dragState.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragState.moved = true;
    }
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
    // 'h6-blocked' means the drop target is an H6 node — ignore
    if (result && result.position !== 'h6-blocked') {
      performDrop(ds.node, result.targetNode, result.position);
    }
    render();
  }

  /** Show a horizontal line for before/after, highlight for inside, blocked cursor for H6 */
  function updateDropFeedback(e, draggedNode) {
    clearDropFeedback();
    const result = getDropTarget(e, draggedNode);
    if (!result) return;

    const { targetNode, position } = result;

    if (position === 'h6-blocked') {
      // H6 cannot accept children — show not-allowed cursor, no indicator
      stage.style.cursor = 'not-allowed';
      return;
    }

    if (position === 'inside') {
      const el = document.querySelector(`.node[data-id="${targetNode.id}"]`);
      if (el) el.classList.add('drop-over');
    } else {
      // Show a horizontal line above or below the target node
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
    document.querySelectorAll('.node.drop-over').forEach((el) =>
      el.classList.remove('drop-over')
    );
    dropIndicator.style.display = 'none';
    dropIndicator.className = '';
    stage.style.cursor = '';
  }

  function getDropTarget(e, draggedNode) {
    // Convert client coords to stage-local (accounting for transform)
    const stageRect = stage.getBoundingClientRect();
    const sx = (e.clientX - stageRect.left - transform.x) / transform.scale;
    const sy = (e.clientY - stageRect.top - transform.y) / transform.scale;

    let best = null;
    let bestDist = 40; // px tolerance in node space

    collectDropCandidates(root, draggedNode, sx, sy, bestDist, (result, dist) => {
      if (dist < bestDist) { bestDist = dist; best = result; }
    });

    return best;
  }

  function collectDropCandidates(node, dragged, sx, sy, tolerance, cb) {
    if (node.id === dragged.id) return;
    if (isDescendant(dragged, node)) return;

    // Check if sx,sy is within the node rectangle (with tolerance)
    const nx = node._x, ny = node._y, nw = NODE_W, nh = NODE_H;
    if (sx >= nx - tolerance && sx <= nx + nw + tolerance &&
        sy >= ny - tolerance && sy <= ny + nh + tolerance) {
      // Determine position
      const relY = sy - ny;
      let position;
      if (relY < nh * 0.25) position = 'before';
      else if (relY > nh * 0.75) position = 'after';
      else position = 'inside';

      // H6 nodes cannot have children (H7 does not exist in Markdown)
      if (position === 'inside' && node.level >= 6) position = 'h6-blocked';

      const cx = nx + nw / 2;
      const cy = ny + nh / 2;
      const dist = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
      cb({ targetNode: node, position }, dist);
    }

    if (!node.collapsed) {
      node.children.forEach((c) => collectDropCandidates(c, dragged, sx, sy, tolerance, cb));
    }
  }

  function performDrop(draggedNode, targetNode, position) {
    if (!root) return;

    const sourceParent = findParent(root, draggedNode);
    if (!sourceParent) return;

    // Remove from current parent
    sourceParent.children = sourceParent.children.filter((c) => c.id !== draggedNode.id);

    if (position === 'inside') {
      draggedNode.level = targetNode.level + 1;
      updateChildLevels(draggedNode);
      targetNode.children.push(draggedNode);
      targetNode.collapsed = false;
    } else {
      const targetParent = findParent(root, targetNode);
      if (!targetParent) {
        // Undo the remove
        sourceParent.children.push(draggedNode);
        return;
      }
      draggedNode.level = targetNode.level;
      updateChildLevels(draggedNode);
      const idx = targetParent.children.indexOf(targetNode);
      const insertAt = position === 'before' ? idx : idx + 1;
      targetParent.children.splice(insertAt, 0, draggedNode);
    }

    postStructuralEdit();
  }

  function isDescendant(ancestor, node) {
    if (ancestor.id === node.id) return true;
    return ancestor.children.some((c) => isDescendant(c, node));
  }

  function updateChildLevels(node) {
    node.children.forEach((c) => {
      c.level = node.level + 1;
      updateChildLevels(c);
    });
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

  // ─── Message from Extension ───────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      root = msg.root;
      render();
    }
  });

  // Tell the extension the webview is ready to receive the initial tree.
  // This is more reliable than a fixed setTimeout in the extension.
  vscode.postMessage({ type: 'ready' });

})();
