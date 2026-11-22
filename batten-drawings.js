// Batten drawing generator (prototype). Pure JavaScript, no dependencies, so the same code
// can run in Node (render.js) and later inside Batten's own page.
//
// One product specification ("spec", see specs/*.json) in -> everything else out:
//   buildCarcass(spec)  -> parts (cutting list), hardware, material totals
//   sheets(spec)        -> [client approval sheet, workshop sheet] as A3 SVG strings
// The drawing, the cutting list and (later) the costing all come from the same numbers, so
// they can never disagree.
//
// Template so far: "carcass" — a box on a steel frame base with equal compartments, full
// overlay doors and optional shelves (e.g. the Block Media Unit). Sizes are in mm.

(function (root) {
  'use strict';

  // ---------------------------------------------------------------- the model -------------
  function split(total, n) {              // whole-mm sizes that add up exactly to total
    var base = Math.floor(total / n), rem = total - base * n, out = [];
    for (var i = 0; i < n; i++) out.push(base);
    // spread the remainder from the outside in, so the result stays symmetrical
    for (var k = 0; k < rem; k++) out[k % 2 === 0 ? Math.floor(k / 2) : n - 1 - Math.floor(k / 2)] += 1;
    return out;
  }

  // Branscombe construction rules (Shane, 22 Nov 2026):
  //  - the TOP runs the full width; the BOTTOM sits between the sides (less end grain shows),
  //    so the sides run from under the top to the floor of the carcass;
  //  - dividers sit between top and bottom, in front of the back;
  //  - the back is 6 mm oak veneer backing, REBATED into the sides, top and bottom, so it
  //    can't be seen from the top or sides (rebate depth = back.rebate, mm into each panel);
  //  - shelves are 1 mm smaller than the opening, in width and in depth (some are fixed,
  //    some sit on brackets);
  //  - edging goes on every edge that is visible on the finished piece.
  function buildCarcass(s) {
    var T = s.board.thickness, B = s.back.thickness, R = s.back.rebate || 8, W = s.width, D = s.depth, H = s.carcassHeight, n = s.columns;
    var Dc = D - T;                        // carcass depth (sides, top, bottom), the back sits inside it
    var Din = Dc - B;                      // usable depth in front of the back
    var sideH = H - T;                     // sides: from under the top down to the floor
    var divH = H - 2 * T;                  // dividers: between top and bottom
    var bays = split(W - 2 * T - (n - 1) * T, n);
    var doors = split(W - (n - 1) * s.doorGap, n);
    var parts = [];
    // edges: [label, total edging length per part in mm]
    function part(name, qty, l, w, t, mat, edge, edgeLen) { parts.push({ name: name, qty: qty, length: l, width: w, thickness: t, code: mat.code, material: mat.material, edge: edge || '', edgeLen: edgeLen || 0 }); }
    part('Top', 1, W, Dc, T, s.board, 'all round', 2 * (W + Dc));
    part('Side', 2, sideH, Dc, T, s.board, 'front, back, bottom', 2 * sideH + Dc);
    part('Bottom', 1, W - 2 * T, Dc, T, s.board, 'front', W - 2 * T);
    if (n > 1) part('Divider', n - 1, divH, Din, T, s.board, 'front', divH);
    var shelfRows = {};
    (s.shelves || []).forEach(function (count, i) {
      if (!count) return;
      var k = (bays[i] - 1) + 'x' + (Din - 1);
      shelfRows[k] = shelfRows[k] || { qty: 0, l: bays[i] - 1, w: Din - 1 };
      shelfRows[k].qty += count;
    });
    Object.keys(shelfRows).forEach(function (k) { part('Shelf', shelfRows[k].qty, shelfRows[k].l, shelfRows[k].w, T, s.board, 'front', shelfRows[k].l); });
    var doorRows = {};
    doors.forEach(function (w) { doorRows[w] = (doorRows[w] || 0) + 1; });
    Object.keys(doorRows).sort().reverse().forEach(function (w) { part('Door', doorRows[w], H, +w, T, s.board, 'all round', 2 * (H + +w)); });
    part('Back (rebated ' + R + ' mm)', 1, W - 2 * T + 2 * R, H - 2 * T + 2 * R, B, s.back, '', 0);
    var base = s.base, frameL = W - 2 * base.insetX, frameW = D - 2 * base.insetY, legH = base.height - base.tube;
    var steel = [];
    function bar(name, qty, len) { steel.push({ name: name, qty: qty, length: len, code: base.code, material: base.material }); }
    bar('Long rail', 2, frameL);
    bar('Cross rail', 2 + (base.middleRails || 0), frameW - 2 * base.tube);
    bar('Leg', 4, legH);
    // hardware: 2 hinges per door; doors left of centre hinge on their left, right of centre
    // on their right. A door hinged on an end side is full overlay; on a divider, half overlay.
    var full = 0, half = 0;
    for (var i = 0; i < n; i++) {
      var hingeOnLeft = i < n / 2, onOuterSide = hingeOnLeft ? i === 0 : i === n - 1;
      if (onOuterSide) full += 2; else half += 2;
    }
    var hw = [];
    function item(code, qty, name) { hw.push({ code: code, qty: qty, name: name }); }
    var hc = 1;
    if (full) item('H' + hc++, full, 'Hinge, full overlay');
    if (half) item('H' + hc++, half, 'Hinge, half overlay');
    item('H' + hc++, full + half, 'Hinge plate');
    if (s.openers && s.openers.type === 'pushToOpen') {
      item('H' + hc++, n, s.openers.item);
      item('H' + hc++, n, s.openers.housing);
    }
    var shelfCount = (s.shelves || []).reduce(function (a, b) { return a + b; }, 0);
    if (shelfCount) item('H' + hc++, 4 * shelfCount, 'Shelf support pin (if not fixed)');
    // material totals (what costing needs), plus edging in metres
    var totals = {}, edging = 0;
    parts.forEach(function (p) {
      totals[p.code] = totals[p.code] || { code: p.code, material: p.material, unit: 'm²', amount: 0 };
      totals[p.code].amount += p.qty * p.length * p.width / 1e6;
      edging += p.qty * p.edgeLen;
    });
    steel.forEach(function (b) {
      totals[b.code] = totals[b.code] || { code: b.code, material: b.material, unit: 'm', amount: 0 };
      totals[b.code].amount += b.qty * b.length / 1000;
    });
    var list = Object.keys(totals).sort().map(function (k) { return totals[k]; });
    if (edging) list.push({ code: s.board.edgingCode || 'E1', material: s.board.edging || 'Edging', unit: 'm', amount: edging / 1000 });
    return { scale: '1:10', materials: [s.board, s.back, s.base], T: T, B: B, R: R, W: W, D: D, H: H, n: n, Dc: Dc, Din: Din, sideH: sideH, divH: divH, bays: bays, doors: doors,
      frameL: frameL, frameW: frameW, legH: legH, parts: parts, steel: steel, hardware: hw, totals: list };
  }

  // ---------------------------------------------------------------- SVG helpers -----------
  var FONT = "font-family=\"'Helvetica Neue',Arial,'DejaVu Sans',sans-serif\"";
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n2(v) { return Math.round(v * 100) / 100; }
  function line(x1, y1, x2, y2, w, extra) { return '<line x1="' + n2(x1) + '" y1="' + n2(y1) + '" x2="' + n2(x2) + '" y2="' + n2(y2) + '" stroke="#111" stroke-width="' + (w || 0.25) + '"' + (extra || '') + '/>'; }
  function rect(x, y, w, h, sw, fill, extra) { return '<rect x="' + n2(x) + '" y="' + n2(y) + '" width="' + n2(w) + '" height="' + n2(h) + '" fill="' + (fill || 'none') + '" stroke="#111" stroke-width="' + (sw || 0.35) + '"' + (extra || '') + '/>'; }
  function text(x, y, t, size, opts) {
    opts = opts || {};
    return '<text x="' + n2(x) + '" y="' + n2(y) + '" ' + FONT + ' font-size="' + (size || 2.4) + '"' +
      (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '') + (opts.weight ? ' font-weight="' + opts.weight + '"' : '') +
      (opts.fill ? ' fill="' + opts.fill + '"' : ' fill="#111"') + (opts.spacing ? ' letter-spacing="' + opts.spacing + '"' : '') +
      (opts.rotate ? ' transform="rotate(' + opts.rotate + ' ' + n2(x) + ' ' + n2(y) + ')"' : '') + '>' + esc(t) + '</text>';
  }
  var DASH = ' stroke-dasharray="1.2 0.8"';
  function tick(x, y) { return line(x - 0.9, y + 0.9, x + 0.9, y - 0.9, 0.3); }
  // horizontal dimension chain: xs are drawing x positions (sorted), values the real sizes
  function hChain(xs, values, y, objY) {
    var out = '';
    out += line(xs[0], y, xs[xs.length - 1], y, 0.18);
    xs.forEach(function (x) { out += line(x, Math.min(objY, y) - (objY < y ? -1 : 1.2) , x, y + (objY < y ? 1.2 : 1.2), 0.15) + tick(x, y); });
    for (var i = 0; i < values.length; i++) {
      var mid = (xs[i] + xs[i + 1]) / 2, wide = (xs[i + 1] - xs[i]) > 4.5;
      out += text(mid, wide ? y - 0.8 : y - 2.6, values[i], 2.1, { anchor: 'middle' });
    }
    return out;
  }
  function vChain(ys, values, x, objX) {
    var out = '';
    out += line(x, ys[0], x, ys[ys.length - 1], 0.18);
    ys.forEach(function (y) { out += line(Math.min(objX, x) + 1, y, x + 1.2, y, 0.15) + tick(x, y); });
    for (var i = 0; i < values.length; i++) {
      var mid = (ys[i] + ys[i + 1]) / 2, tall = Math.abs(ys[i + 1] - ys[i]) > 4.5;
      out += text(tall ? x - 0.8 : x - 2.6, mid, values[i], 2.1, { anchor: 'middle', rotate: -90 });
    }
    return out;
  }
  function viewTitle(x, y, num, title, scale) {
    return '<circle cx="' + (x + 2.6) + '" cy="' + (y - 1.3) + '" r="2.6" fill="none" stroke="#111" stroke-width="0.3"/>' +
      text(x + 2.6, y - 0.4, num, 2.6, { anchor: 'middle', weight: 'bold' }) +
      text(x + 7, y, title, 3.6, { weight: 'bold' }) + text(x + 7, y + 3.8, 'Scale ' + scale, 2.2);
  }
  function tag(x, y, code) {   // material/hardware reference bubble
    return '<rect x="' + n2(x - 2.6) + '" y="' + n2(y - 1.9) + '" width="5.2" height="3.4" rx="1.7" fill="#fff" stroke="#111" stroke-width="0.25"/>' + text(x, y + 0.75, code, 2, { anchor: 'middle', weight: 'bold' });
  }

  // ---------------------------------------------------------------- views ------------------
  // All views at 1:10 (k = 0.1 drawing-mm per real mm). (ox, oy) = left end at floor level.
  function frontView(s, m, ox, oy, withDoors) {
    var k = 0.1, W = m.W * k, H = m.H * k, b = s.base.height * k, T = m.T * k, out = '';
    var top = oy - b - H;
    // steel base: legs at each end, rail along the front
    var lx = s.base.insetX * k, tb = s.base.tube * k;
    out += rect(ox + lx, oy - b, tb, b, 0.3, '#222') + rect(ox + W - lx - tb, oy - b, tb, b, 0.3, '#222');
    out += rect(ox + lx, oy - b, W - 2 * lx, tb, 0.3, '#222');
    if (withDoors) {
      var x = ox;
      out += rect(ox, top, W, H, 0.4, '#efe4d2');
      m.doors.forEach(function (d, i) { out += rect(x, top, d * k, H, 0.3, '#e8d9c0'); x += d * k + s.doorGap * k; });
    } else {
      out += rect(ox, top, W, H, 0.35, '#f7f1e6');
      out += rect(ox, top, W, T, 0.3, '#d9c4a0');                                   // top, full width
      out += rect(ox, top + T, T, H - T, 0.3, '#d9c4a0') + rect(ox + W - T, top + T, T, H - T, 0.3, '#d9c4a0'); // sides to the floor
      out += rect(ox + T, top + H - T, W - 2 * T, T, 0.3, '#d9c4a0');               // bottom, between the sides
      var cx = ox + T;
      m.bays.forEach(function (bay, i) {
        var shelves = (s.shelves || [])[i] || 0;
        for (var j = 1; j <= shelves; j++) {
          var sy = top + T + (H - 2 * T) * j / (shelves + 1) - T / 2;
          out += rect(cx + 0.1, sy, bay * k - 0.2, T, 0.25, 'none', DASH);
          out += text(cx + bay * k / 2, sy - 1, 'shelf', 1.8, { anchor: 'middle' });
        }
        cx += bay * k;
        if (i < m.bays.length - 1) { out += rect(cx, top + T, T, H - 2 * T, 0.3, '#d9c4a0'); cx += T; }
      });
    }
    // dimensions
    out += hChain([ox, ox + W], [m.W], top - 9, top);
    if (withDoors) {
      var xs = [ox], vals = [];
      var p = ox;
      m.doors.forEach(function (d, i) { p += d * k; xs.push(p); vals.push(d); if (i < m.doors.length - 1) { p += s.doorGap * k; xs.push(p); vals.push(s.doorGap); } });
      out += hChain(xs, vals, top - 4, top);
    } else {
      var xs2 = [ox], vals2 = [], q = ox;
      xs2.push(q += T); vals2.push(m.T);
      m.bays.forEach(function (bay) { xs2.push(q += bay * k); vals2.push(bay); xs2.push(q += T); vals2.push(m.T); });
      out += hChain(xs2, vals2, top - 4, top);
    }
    if (!withDoors) out += vChain([top, top + T, top + H - T, top + H], [m.T, m.H - 2 * m.T, m.T], ox - 5, ox);
    out += vChain([top, oy - b, oy], [m.H, s.base.height], ox + W + 5, ox + W);
    out += vChain([top, oy], [m.H + s.base.height], ox + W + 11, ox + W);
    var lxs = [ox, ox + lx, ox + lx + tb, ox + W - lx - tb, ox + W - lx, ox + W];
    out += hChain(lxs, [s.base.insetX, s.base.tube, m.frameL - 2 * s.base.tube, s.base.tube, s.base.insetX], oy + 5, oy);
    return out;
  }
  function sideView(s, m, ox, oy, section) {
    var k = 0.1, D = m.D * k, H = m.H * k, b = s.base.height * k, T = m.T * k, B = m.B * k, R = m.R * k, Dc = m.Dc * k, out = '';
    var top = oy - b - H;
    out += rect(ox, top, Dc, H, 0.35, section ? '#f7f1e6' : '#efe4d2');          // side panel / carcass
    if (section) {
      out += rect(ox, top, Dc, T, 0.3, '#d9c4a0') + rect(ox, top + H - T, Dc, T, 0.3, '#d9c4a0');
      out += rect(ox, top + T - R, B, H - 2 * T + 2 * R, 0.3, '#c9b48e');        // back in its rebate
      out += rect(ox + B + 0.1, top + H / 2 - T / 2, (m.Din - 1) * k, T, 0.25, 'none', DASH);
      out += text(ox + B + 2, top + H / 2 - T / 2 - 1, 'shelf', 1.8);
      out += text(ox + B + 1.2, top + T + 3, 'back in rebate', 1.6, { fill: '#555' });
    }
    out += rect(ox + Dc, top, T, H, 0.3, '#e8d9c0');                              // door
    var by = s.base.insetY * k, tb = s.base.tube * k;
    out += rect(ox + by, oy - b, tb, b, 0.3, '#222') + rect(ox + D - by - tb, oy - b, tb, b, 0.3, '#222');
    out += rect(ox + by, oy - b, D - 2 * by, tb, 0.3, '#222');
    out += hChain([ox, ox + D], [m.D], top - 9, top);
    out += section ? hChain([ox, ox + B, ox + Dc, ox + D], [m.B, m.Din, m.T], top - 4, top) : hChain([ox, ox + Dc, ox + D], [m.Dc, m.T], top - 4, top);
    out += vChain([top, oy - b, oy], [m.H, s.base.height], ox + D + 5, ox + D);
    out += hChain([ox, ox + by, ox + by + tb, ox + D - by - tb, ox + D - by, ox + D], [s.base.insetY, s.base.tube, m.frameW - 2 * s.base.tube, s.base.tube, s.base.insetY], oy + 5, oy);
    return out;
  }
  function topView(s, m, ox, oy) {        // (ox, oy) = back-left corner
    var k = 0.1, W = m.W * k, D = m.D * k, T = m.T * k, B = m.B * k, Dc = m.Dc * k, out = '';
    out += rect(ox, oy, W, Dc, 0.35, '#efe4d2');
    var x = ox;
    m.doors.forEach(function (d) { out += rect(x, oy + Dc, d * k, T, 0.25, '#e8d9c0'); x += d * k + s.doorGap * k; });
    var cx = ox + T;
    m.bays.forEach(function (bay, i) { cx += bay * k; if (i < m.bays.length - 1) out += line(cx, oy + B, cx, oy + Dc, 0.2, DASH) + line(cx + T, oy + B, cx + T, oy + Dc, 0.2, DASH); cx += T; });
    out += line(ox + T, oy + B, ox + W - T, oy + B, 0.2, DASH);                  // back, hidden in its rebate
    out += hChain([ox, ox + W], [m.W], oy - 4, oy);
    out += vChain([oy, oy + Dc, oy + D], [m.Dc, m.T], ox + W + 5, ox + W);
    return out;
  }
  function baseTopView(s, m, ox, oy) {
    var k = 0.1, L = m.frameL * k, Wd = m.frameW * k, tb = s.base.tube * k, out = '';
    out += rect(ox - s.base.insetX * k, oy - s.base.insetY * k, m.W * k, m.D * k, 0.2, 'none', DASH);
    out += text(ox - s.base.insetX * k + 1, oy + m.D * k - s.base.insetY * k + 3, 'dashed: carcass outline above', 1.8, { fill: '#666' });
    out += rect(ox, oy, L, tb, 0.3, '#333') + rect(ox, oy + Wd - tb, L, tb, 0.3, '#333');
    var cross = 2 + (s.base.middleRails || 0);
    for (var i = 0; i < cross; i++) { var cx = ox + (L - tb) * i / (cross - 1); out += rect(cx, oy + tb, tb, Wd - 2 * tb, 0.3, '#333'); }
    var xs = [ox, ox + tb], vals = [s.base.tube];
    var gap = (m.frameL - cross * s.base.tube) / (cross - 1);
    for (var j = 1; j < cross; j++) { xs.push(xs[xs.length - 1] + gap * k); vals.push(Math.round(gap)); xs.push(xs[xs.length - 1] + tb); vals.push(s.base.tube); }
    out += hChain([ox, ox + L], [m.frameL], oy - 9, oy);
    out += hChain(xs, vals, oy - 4, oy);
    out += vChain([oy, oy + tb, oy + Wd - tb, oy + Wd], [s.base.tube, m.frameW - 2 * s.base.tube, s.base.tube], ox + L + 5, ox + L);
    return out;
  }
  // simple isometric line drawing with material tags
  function iso(s, m, cx, cy, size) {
    var c = Math.cos(Math.PI / 6), sn = 0.5;
    var span = (m.W + m.D) * c, sc = size / span;
    function P(x, y, z) { return [cx + (x * c - z * c) * sc, cy - y * sc + (x * sn + z * sn) * sc]; }
    function poly(pts, fill, sw) { return '<polygon points="' + pts.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join(' ') + '" fill="' + fill + '" stroke="#111" stroke-width="' + (sw || 0.3) + '" stroke-linejoin="round"/>'; }
    var W = m.W, D = m.D, H = m.H, b = s.base.height, out = '';
    // legs (front-left, front-right, back-right visible)
    function leg(x, z) { var t = s.base.tube; out += poly([P(x, 0, z), P(x + t, 0, z), P(x + t, b, z), P(x, b, z)], '#222', 0.2); out += poly([P(x + t, 0, z), P(x + t, 0, z - t), P(x + t, b, z - t), P(x + t, b, z)], '#111', 0.2); }
    leg(s.base.insetX, D - s.base.insetY); leg(W - s.base.insetX - s.base.tube, D - s.base.insetY); leg(W - s.base.insetX - s.base.tube, s.base.insetY + s.base.tube);
    var y0 = b, y1 = b + H;
    out += poly([P(0, y1, 0), P(W, y1, 0), P(W, y1, D), P(0, y1, D)], '#e9dcc4');              // top
    out += poly([P(W, y0, D), P(W, y0, 0), P(W, y1, 0), P(W, y1, D)], '#d8c4a2');             // right side
    out += poly([P(0, y0, D), P(W, y0, D), P(W, y1, D), P(0, y1, D)], '#e3d2b4');             // front
    var x = 0;
    m.doors.forEach(function (d, i) { if (i) out += '<line x1="' + n2(P(x, y0, D)[0]) + '" y1="' + n2(P(x, y0, D)[1]) + '" x2="' + n2(P(x, y1, D)[0]) + '" y2="' + n2(P(x, y1, D)[1]) + '" stroke="#111" stroke-width="0.3"/>'; x += d + s.doorGap; });
    var tM1 = P(W * 0.3, y1 - H * 0.4, D), tM3 = P(s.base.insetX + 10, b * 0.5, D - s.base.insetY), tTop = P(W * 0.55, y1, D * 0.5);
    out += tag(tM1[0], tM1[1], s.board.code) + tag(tM3[0] - 4, tM3[1] + 4, s.base.code) + tag(tTop[0], tTop[1], s.board.code);
    return out;
  }

  // ---------------------------------------------------------------- the sheet -------------
  var PAGE_W = 420, PAGE_H = 297, M = 10, TB_X = 328, BAND_Y = 232;
  function frame(s, sheetNo, sheetCount, stamp, stampColor) {
    var out = rect(M, M, PAGE_W - 2 * M, PAGE_H - 2 * M, 0.6) + line(TB_X, M, TB_X, PAGE_H - M, 0.5);
    var x = TB_X + 4, w = PAGE_W - M - TB_X - 8, y = M + 4;
    if (LOGO) out += '<image href="' + LOGO + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + n2(w * 420 / 2400) + '" preserveAspectRatio="xMidYMid meet"/>';
    else out += text(x + w / 2, y + 9, 'BRANSCOMBE', 7.4, { anchor: 'middle', spacing: '2.1' });
    out += text(x + w / 2, y + 16, 'Natalie Branscombe (Pty) Ltd', 2.3, { anchor: 'middle', fill: '#555' });
    y += 19;
    out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="9" fill="' + stampColor + '"/>' + text(x + w / 2, y + 6.1, stamp, 3.4, { anchor: 'middle', weight: 'bold', fill: '#fff' });
    y += 13;
    var rows = [['JOB NO', s.job], ['PRODUCT', s.product], ['CLIENT', s.client], ['PROJECT', s.project], ['QUANTITY', s.quantity],
      ['DRAWN', s.drawnBy], ['CHECKED', s.checkedBy], ['DATE', (s.revisions[s.revisions.length - 1] || {}).date || ''], ['SCALE', SCALE + ' at A3'],
      ['SHEET', sheetNo + ' of ' + sheetCount], ['REVISION', (s.revisions[s.revisions.length - 1] || {}).rev || '']];
    rows.forEach(function (r) {
      out += text(x, y + 3.2, r[0], 2, { fill: '#666' }) + text(x + 20, y + 3.2, r[1], 2.6, { weight: r[0] === 'JOB NO' || r[0] === 'PRODUCT' ? 'bold' : 'normal' });
      out += line(x, y + 5, x + w, y + 5, 0.12);
      y += 5.6;
    });
    y += 3;
    out += text(x, y, 'REVISIONS', 2.4, { weight: 'bold' }); y += 1.6;
    out += line(x, y, x + w, y, 0.2);
    s.revisions.forEach(function (r) {
      y += 4;
      out += text(x, y, r.rev, 2.2, { weight: 'bold' }) + text(x + 5, y, r.date, 2.2) + text(x + 23, y, r.note.length > 34 ? r.note.slice(0, 33) + '…' : r.note, 2.1);
    });
    return { svg: out, y: y + 5, x: x, w: w };
  }
  function table(x, y, cols, rows, opts) {
    opts = opts || {};
    var rh = opts.rowH || 3.9, out = '', cx = x;
    cols.forEach(function (c) { out += text(cx + (c.align === 'end' ? c.w - 1 : 0.5), y, c.title, 2, { weight: 'bold', fill: '#444', anchor: c.align === 'end' ? 'end' : null }); cx += c.w; });
    var total = cols.reduce(function (a, c) { return a + c.w; }, 0);
    out += line(x, y + 1.3, x + total, y + 1.3, 0.25);
    rows.forEach(function (r, i) {
      var yy = y + 1.3 + rh * (i + 1) - 1, cx2 = x;
      if (opts.zebra && i % 2) out += '<rect x="' + x + '" y="' + n2(yy - rh + 1.2) + '" width="' + total + '" height="' + rh + '" fill="#f3f0ea"/>';
      cols.forEach(function (c, j) { out += text(cx2 + (c.align === 'end' ? c.w - 1 : 0.5), yy, r[j], opts.size || 2.3, { anchor: c.align === 'end' ? 'end' : null, weight: j === 0 && opts.boldFirst ? 'bold' : null }); cx2 += c.w; });
    });
    return out;
  }

  function sheetClient(s, m, tpl) {
    var f = frame(s, 1, 2, 'FOR CLIENT APPROVAL', '#2f5d6b');
    var out = f.svg;
    // approval box
    var x = f.x, w = f.w, y = f.y + 2;
    out += rect(x, y, w, 46, 0.35, '#f6f8f8');
    out += text(x + 2, y + 5, 'CLIENT APPROVAL', 2.8, { weight: 'bold' });
    ['I approve the design, dimensions, materials,', 'finishes and quantity shown on this drawing.', 'Changes after approval may affect price and', 'delivery date.'].forEach(function (l, i) { out += text(x + 2, y + 10 + i * 3.2, l, 2.1); });
    ['Name', 'Signature', 'Date'].forEach(function (l, i) { var yy = y + 26 + i * 6.5; out += text(x + 2, yy, l, 2.1, { fill: '#666' }) + line(x + 17, yy + 0.5, x + w - 2, yy + 0.5, 0.2); });
    // views
    out += tpl.clientViews(s, m);
    // bottom band: materials, hardware, notes
    out += line(M, BAND_Y, TB_X, BAND_Y, 0.5);
    var mats = m.materials.map(function (x) { return [x.code, x.material, x.colour || '', x.finish || 'to confirm']; });
    out += text(14, BAND_Y + 5.5, 'MATERIALS & FINISHES', 2.6, { weight: 'bold' });
    out += table(14, BAND_Y + 10, [{ title: 'REF', w: 8 }, { title: 'MATERIAL', w: 36 }, { title: 'COLOUR', w: 27 }, { title: 'FINISH', w: 25 }], mats, { boldFirst: true, size: 2.1 });
    out += line(110, BAND_Y, 110, PAGE_H - M, 0.3);
    out += text(114, BAND_Y + 5.5, 'HARDWARE', 2.6, { weight: 'bold' });
    out += table(114, BAND_Y + 10, [{ title: 'REF', w: 9 }, { title: 'QTY', w: 8, align: 'end' }, { title: 'ITEM', w: 72 }], m.hardware.map(function (h) { return [h.code, h.qty, h.name]; }), { boldFirst: true });
    out += line(206, BAND_Y, 206, PAGE_H - M, 0.3);
    out += text(210, BAND_Y + 5.5, 'INFORMATION FROM CLIENT', 2.6, { weight: 'bold' });
    out += wrap(s.informationFromClient || '-', 210, BAND_Y + 10, 112, 2.3);
    out += text(210, BAND_Y + 25, 'NOTES', 2.6, { weight: 'bold' });
    (s.notes || []).forEach(function (n, i) { out += wrap((i + 1) + '. ' + n, 210, BAND_Y + 29.5 + i * 7, 112, 2.2); });
    out += text(210, PAGE_H - M - 3, 'Solid wood and veneer move with the seasons and vary in colour; samples are indicative only. Indoor and covered outdoor use.', 1.8, { fill: '#666' });
    return svgDoc(out);
  }

  function sheetWorkshop(s, m, tpl) {
    var f = frame(s, 2, 2, 'WORKSHOP · FOR PRODUCTION', '#7a4b1f');
    var out = f.svg, x = f.x, w = f.w, y = f.y + 2;
    out += text(x, y + 2, 'HARDWARE', 2.6, { weight: 'bold' });
    out += table(x, y + 7, [{ title: 'REF', w: 8 }, { title: 'QTY', w: 7, align: 'end' }, { title: 'ITEM', w: w - 15 }], m.hardware.map(function (h) { return [h.code, h.qty, h.name]; }), { size: 2.1, rowH: 3.6, boldFirst: true });
    var hy = y + 9 + 3.6 * (m.hardware.length + 1) + 4;
    out += text(x, hy, 'MATERIAL TOTALS (for costing)', 2.4, { weight: 'bold' });
    out += table(x, hy + 5, [{ title: 'REF', w: 8 }, { title: 'MATERIAL', w: w - 26 }, { title: 'AMOUNT', w: 18, align: 'end' }],
      m.totals.map(function (t) { return [t.code, t.material, t.amount.toFixed(2) + ' ' + t.unit]; }), { size: 2.1, rowH: 3.6, boldFirst: true });
    var fy = hy + 7 + 3.6 * (m.totals.length + 1) + 4;
    out += text(x, fy, 'FINISHING', 2.4, { weight: 'bold' });
    out += table(x, fy + 5, [{ title: 'REF', w: 8 }, { title: 'COLOUR', w: (w - 8) / 2 }, { title: 'FINISH', w: (w - 8) / 2 }],
      m.materials.map(function (x2) { return [x2.code, x2.colour || '', x2.finish || 'to confirm']; }), { size: 2.1, rowH: 3.6, boldFirst: true });
    out += tpl.workshopViews(s, m);
    // cutting list
    out += line(M, BAND_Y - 22, TB_X, BAND_Y - 22, 0.5);
    out += text(14, BAND_Y - 16.5, 'CUTTING LIST', 2.8, { weight: 'bold' });
    out += text(48, BAND_Y - 16.5, 'per unit · ' + s.quantity + ' unit(s) · L = along the grain', 2.1, { fill: '#666' });
    var rows = m.parts.map(function (p) { return [p.code, p.name, p.qty, p.length, p.width, p.thickness, p.material, p.edge || p.note || '']; })
      .concat((m.steel || []).map(function (b) { return [b.code, b.name, b.qty, b.length, '25', '25', b.material, 'weld, grind'];}));
    out += table(14, BAND_Y - 11, [{ title: 'REF', w: 9 }, { title: 'PART', w: 30 }, { title: 'QTY', w: 9, align: 'end' }, { title: 'L', w: 13, align: 'end' }, { title: 'W', w: 13, align: 'end' }, { title: 'T', w: 9, align: 'end' }, { title: '', w: 4 }, { title: 'MATERIAL', w: 52 }, { title: 'EDGING / NOTE', w: 50 }],
      rows.map(function (r) { return [r[0], r[1], r[2], r[3], r[4], r[5], '', r[6], r[7]]; }), { zebra: true, rowH: 3.75, size: 2.2, boldFirst: true });
    return svgDoc(out);
  }

  function wrap(t, x, y, width, size) {     // crude word wrap (average glyph width ~0.5em)
    var words = String(t).split(' '), lines = [''], max = width / (size * 0.5);
    words.forEach(function (wd) { var cur = lines[lines.length - 1]; if ((cur + ' ' + wd).trim().length > max) lines.push(wd); else lines[lines.length - 1] = (cur + ' ' + wd).trim(); });
    return lines.map(function (l, i) { return text(x, y + i * size * 1.3, l, size); }).join('');
  }
  function svgDoc(body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"><rect width="420" height="297" fill="#fff"/>' + body + '</svg>';
  }

  var LOGO = '';   // data URI of the Branscombe logo (assets/branscombe-logo.png), set by the caller
  var SCALE = '1:10';
  var TEMPLATES = {
    carcass: {
      build: buildCarcass,
      clientViews: function (s, m) {
        return frontView(s, m, 24, 104, true) + viewTitle(24, 118, 1, 'FRONT VIEW', '1:10') +
          sideView(s, m, 258, 104, false) + viewTitle(258, 118, 2, 'SIDE VIEW', '1:10') +
          topView(s, m, 24, 142) + viewTitle(24, 212, 3, 'TOP VIEW', '1:10') +
          iso(s, m, 266, 150, 74) + viewTitle(240, 212, 4, '3D VIEW', 'not to scale');
      },
      workshopViews: function (s, m) {
        return frontView(s, m, 24, 104, false) + viewTitle(24, 118, 1, 'CARCASS FRONT (doors off)', '1:10') +
          sideView(s, m, 258, 104, true) + viewTitle(258, 118, 2, 'CARCASS SIDE SECTION', '1:10') +
          baseTopView(s, m, 24 + s.base.insetX * 0.1, 146) + viewTitle(24, 204, 3, 'STEEL BASE, PLAN', '1:10');
      }
    }
  };
  // ================================================================ template: pedestal ======
  // Chelsea-style pedestal (AOC1446 / AOC2055): stacked drawers between four round legs under
  // a stone top. Construction, from the detailed AOC1446 drawing:
  //  - no carcass top: the stone sits on the sides and is notched round the legs;
  //  - sides (solid) are routed into the legs and run leg centre to leg centre; the inner face
  //    of each side lines up with the inside of the legs;
  //  - the back (solid) sits between the sides, full height;
  //  - drawer faces (solid) are inset flush between the sides, with a gap all round;
  //  - base (veneer board) between the sides, between the back and the faces;
  //  - drawer rails are two veneer strips (front and back), centred on the gap between faces;
  //  - drawer boxes are the opening less the runner clearance each side, and sit 10 mm above
  //    the base / rail (undermount runners).
  var OAK = '#c9a77c', VENEER = '#dcc09a', STONE = '#dedcd6', LIGHT = '#f1e9dc', FACE = '#cfae84';
  function buildPedestal(s) {
    var W = s.width, D = s.depth, H = s.height, L = s.legs.diameter, S = s.stoneTop.thickness;
    var cb = s.carcassBoard, fb = s.frontBoard, pb = s.panelBoard, db = s.drawerBox, bb = s.drawerBottom || s.drawerBox;
    var T = cb.thickness, ft = fb.thickness, pT = pb.thickness, ch = s.carcass.height, n = s.drawers.length;
    var inner = W - 2 * L, cw = inner + 2 * T, sideLen = D - L, cx0 = (W - cw) / 2, cz0 = L / 2;
    var Din = sideLen - T - ft, legBelow = H - S - ch, g = s.drawerGap, tg = s.topGap == null ? g : s.topGap;
    var fronts = s.drawers.map(function (d) { return d.front; });
    var sum = fronts.reduce(function (a, b) { return a + b; }, 0) + tg + (n - 1) * g;
    if (sum !== ch) throw new Error('Drawer faces + gaps = ' + sum + ' mm, but the carcass is ' + ch + ' mm high');
    var fw = inner - 2 * g, railW = s.railWidth || 80;
    var y = tg, rails = [], frontTops = [];
    fronts.forEach(function (f, i) { frontTops.push(y); y += f; if (i < n - 1) { rails.push(Math.round(y + g / 2 - pT / 2)); y += g; } });
    var openings = [];
    for (var i = 0; i < n; i++) {
      var oTop = i === 0 ? 0 : rails[i - 1] + pT, oBot = i === n - 1 ? ch - pT : rails[i];
      openings.push({ top: oTop, height: oBot - oTop });
    }
    var clr = s.runners.sideClearance, bt = db.thickness, boxW = inner - 2 * clr, boxIn = boxW - 2 * bt;
    var boxLen = s.runners.boxLength || s.runners.length, raise = s.runners.boxRaise == null ? 10 : s.runners.boxRaise;   // boxes sit 10 mm above the rail / base
    var boxes = s.drawers.map(function (d, i) { return { height: d.boxHeight, top: openings[i].top + openings[i].height - raise - d.boxHeight }; });
    var slotFrom = S, slotLen = ch;
    var parts = [];
    function part(name, qty, l, w, t, mat, edge, edgeLen, extra) {
      var same = parts.filter(function (p) { return p.name === name && p.length === l && p.width === w && p.thickness === t; })[0];
      if (same) { same.qty += qty; return; }
      var p = { name: name, qty: qty, length: l, width: w, thickness: t, code: mat.code, material: mat.material, edge: edge || '', edgeLen: edgeLen || 0 };
      for (var k in extra || {}) p[k] = extra[k];
      parts.push(p);
    }
    part('Side', 2, ch, sideLen, T, cb, '', 0, { note: 'into the leg slots' });
    part('Back', 1, inner, ch, T, cb);
    fronts.forEach(function (f) { part('Drawer face', 1, fw, f, ft, fb, '', 0, { note: 'inset, ' + g + ' mm gap' }); });
    part('Base', 1, inner, Din, pT, pb);
    if (n > 1) part('Drawer rail', 2 * (n - 1), inner, railW, pT, pb, '', 0, { note: 'front and back' });
    boxes.forEach(function (b) {
      part('Drawer box side', 2, boxLen, b.height, bt, db, 'top', boxLen);
      part('Drawer box front/back', 2, boxIn, b.height, bt, db, 'top', boxIn);
      part('Drawer bottom', 1, boxIn, boxLen - 2 * bt, bb.thickness, bb);
    });
    part('Leg', 4, H, L, L, s.legs, '', 0, { note: 'Ø' + L + ', slot ' + T + ' x ' + L / 2 + ' deep x ' + slotLen + ', from ' + slotFrom + ' below the top', unit: 'm' });
    var notchR = L / 2 + (s.stoneTop.notchClearance == null ? 1 : s.stoneTop.notchClearance);
    part('Stone top', 1, cw, sideLen, S, s.stoneTop, '', 0, { note: '4 corner notches R' + notchR + ' round the legs' });
    var hw = [{ code: 'H1', qty: n, name: s.runners.item + ' (pair)' }, { code: 'H2', qty: n, name: s.handles.item }];
    var totals = {}, edging = 0;
    parts.forEach(function (p) {
      var u = p.unit || 'm²';
      totals[p.code] = totals[p.code] || { code: p.code, material: p.material, unit: u, amount: 0 };
      totals[p.code].amount += u === 'm' ? p.qty * p.length / 1000 : p.qty * p.length * p.width / 1e6;
      edging += p.qty * p.edgeLen;
    });
    var list = Object.keys(totals).sort().map(function (k) { return totals[k]; });
    var edger = [db, pb, fb].filter(function (x) { return x.edging; })[0] || {};
    if (edging) list.push({ code: edger.edgingCode || 'E1', material: edger.edging || 'Edging', unit: 'm', amount: edging / 1000 });
    var seen = {}, mats = [];
    // parts sharing a ref are one material: the first one wins, gaps filled from the others
    [cb, fb, pb, db, bb, s.legs, s.stoneTop].forEach(function (x) {
      var have = seen[x.code];
      if (!have) { seen[x.code] = have = { code: x.code, material: x.material, colour: x.colour || '', finish: x.finish || '', thickness: x.thickness, edging: x.edging, edgingCode: x.edgingCode }; mats.push(have); return; }
      ['colour', 'finish', 'edging', 'edgingCode'].forEach(function (k) { if (!have[k] && x[k]) have[k] = x[k]; });
    });
    mats.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    return { scale: '1:8', k: 1 / 8, materials: mats, W: W, D: D, H: H, L: L, S: S, cw: cw, sideLen: sideLen, ch: ch, T: T, pT: pT, legBelow: legBelow,
      g: g, tg: tg, fronts: fronts, frontTops: frontTops, fw: fw, ft: ft, inner: inner, Din: Din, cx0: cx0, cz0: cz0, rails: rails, railW: railW,
      openings: openings, clr: clr, bt: bt, boxW: boxW, boxIn: boxIn, boxLen: boxLen, boxes: boxes, notchR: notchR,
      parts: parts, hardware: hw, totals: list };
  }

  function circle(cx, cy, r, fill, sw, extra) { return '<circle cx="' + n2(cx) + '" cy="' + n2(cy) + '" r="' + n2(r) + '" fill="' + (fill || 'none') + '" stroke="#111" stroke-width="' + (sw || 0.3) + '"' + (extra || '') + '/>'; }

  // stone outline (plan) with a notch round each leg. (x, y) = stone back-left corner on paper
  function stonePath(m, x, y) {
    var k = m.k, w = m.cw * k, d = m.sideLen * k, r = m.notchR * k;
    var dx = (m.L / 2 - m.cx0) * k, dz = (m.L / 2 - m.cz0) * k;       // leg centre from the stone corner
    var a = Math.sqrt(r * r - dz * dz) + dx, b = Math.sqrt(r * r - dx * dx) + dz, R = n2(r);
    function arc(px, py) { return ' A' + R + ' ' + R + ' 0 0 0 ' + n2(px) + ',' + n2(py); }
    return '<path d="M' + n2(x + a) + ',' + n2(y) + ' L' + n2(x + w - a) + ',' + n2(y) + arc(x + w, y + b) +
      ' L' + n2(x + w) + ',' + n2(y + d - b) + arc(x + w - a, y + d) + ' L' + n2(x + a) + ',' + n2(y + d) + arc(x, y + d - b) +
      ' L' + n2(x) + ',' + n2(y + b) + arc(x + a, y) + ' Z" fill="' + STONE + '" stroke="#111" stroke-width="0.35"/>';
  }

  // front elevation. section = the carcass with the faces off. (ox, oy) = left leg face at the floor
  function pedFront(s, m, ox, oy, section) {
    var k = m.k, W = m.W * k, H = m.H * k, L = m.L * k, S = m.S * k, out = '', top = oy - H;
    var ctop = oy - (m.legBelow + m.ch) * k, cx = ox + m.cx0 * k, T = m.T * k, pT = m.pT * k, ix = cx + T, iw = m.inner * k;
    if (!section) {
      out += rect(ix, ctop, iw, m.ch * k, 0.2, '#5b4a36');                                  // shadow in the gaps
      m.fronts.forEach(function (f, i) {
        var fy = ctop + m.frontTops[i] * k;
        out += rect(ix + m.g * k, fy, m.fw * k, f * k, 0.3, FACE);
        out += circle(ox + W / 2, fy + s.handles.fromTop * k, 1.5, '#9c7a48', 0.25);
      });
      out += rect(cx, top, m.cw * k, S, 0.3, STONE);
      out += rect(cx, ctop, T, m.ch * k, 0.3, OAK) + rect(cx + m.cw * k - T, ctop, T, m.ch * k, 0.3, OAK);
      out += rect(ox, top, L, H, 0.3, OAK) + rect(ox + W - L, top, L, H, 0.3, OAK);
      out += hChain([ox, ox + W], [m.W], top - 9, top);
      out += hChain([ox, ox + L, ox + L + m.g * k, ox + W - L - m.g * k, ox + W - L, ox + W], [m.L, m.g, m.fw, m.g, m.L], top - 4, top);
      var ys = [top, top + S], vals = [m.S], p = top + S;
      ys.push(p += m.tg * k); vals.push(m.tg);
      m.fronts.forEach(function (f, i) { ys.push(p += f * k); vals.push(f); if (i < m.fronts.length - 1) { ys.push(p += m.g * k); vals.push(m.g); } });
      ys.push(oy); vals.push(m.legBelow);
      out += vChain(ys, vals, ox + W + 5, ox + W);
      out += vChain([top, oy], [m.H], ox + W + 13, ox + W);
      return out;
    }
    out += rect(ox, top, L, H, 0.2, LIGHT, DASH) + rect(ox + W - L, top, L, H, 0.2, LIGHT, DASH);
    out += rect(cx, top, m.cw * k, S, 0.2, 'none', DASH) + text(ox + W / 2, top + S - 0.6, 'stone', 1.6, { anchor: 'middle', fill: '#666' });
    out += rect(ix, ctop, iw, m.ch * k, 0.3, '#f7f1e6');                                    // the back, seen from the front
    out += rect(cx, ctop, T, m.ch * k, 0.3, OAK) + rect(cx + m.cw * k - T, ctop, T, m.ch * k, 0.3, OAK);
    out += rect(ix, ctop + (m.ch - m.pT) * k, iw, pT, 0.3, VENEER);
    m.rails.forEach(function (r) { out += rect(ix, ctop + r * k, iw, pT, 0.3, VENEER); });
    m.boxes.forEach(function (b, i) {
      var bx = ix + m.clr * k, by = ctop + b.top * k, bw = m.boxW * k, bh = b.height * k, t = m.bt * k;
      out += rect(bx, by, bw, bh, 0.3, VENEER) + rect(bx, by, t, bh, 0.25, '#c8aa80') + rect(bx + bw - t, by, t, bh, 0.25, '#c8aa80');
      out += text(bx + bw / 2, by + bh / 2 + 0.8, 'drawer ' + (i + 1) + ', box ' + b.height + ' high', 1.8, { anchor: 'middle' });
      if (i === m.boxes.length - 1) out += hChain([bx, bx + t, bx + bw - t, bx + bw], [m.bt, m.boxIn, m.bt], by + 3.5, by + 3.5);
    });
    out += hChain([ix, ix + m.clr * k, ix + iw - m.clr * k, ix + iw], [m.clr, m.boxW, m.clr], ctop - 4, ctop);
    out += hChain([cx, ix, ix + iw, cx + m.cw * k], [m.T, m.inner, m.T], ctop - 9, ctop);
    var ys2 = [ctop], v2 = [];
    m.openings.forEach(function (o, i) { ys2.push(ctop + (o.top + o.height) * k); v2.push(o.height); ys2.push(ys2[ys2.length - 1] + pT); v2.push(m.pT); });
    out += vChain(ys2, v2, ox - 5, ox);
    var ys3 = [ctop], v3 = [], last = 0;                                                    // where the boxes sit
    m.boxes.forEach(function (b) { ys3.push(ctop + b.top * k); v3.push(b.top - last); ys3.push(ctop + (b.top + b.height) * k); v3.push(b.height); last = b.top + b.height; });
    ys3.push(ctop + (m.ch - m.pT) * k); v3.push(m.ch - m.pT - last);
    out += vChain(ys3, v3, ox + W + 5, ox + W);
    out += vChain([ctop, ctop + m.ch * k, oy], [m.ch, m.legBelow], ox + W + 12, ox + W);
    return out;
  }

  // side elevation, back on the left. section = cut through the middle with the drawer boxes
  function pedSide(s, m, ox, oy, section) {
    var k = m.k, D = m.D * k, H = m.H * k, L = m.L * k, S = m.S * k, out = '', top = oy - H;
    var ctop = oy - (m.legBelow + m.ch) * k, cz = ox + m.cz0 * k, sl = m.sideLen * k, T = m.T * k, ch = m.ch * k, pT = m.pT * k;
    if (!section) {
      out += rect(cz, ctop, sl, ch, 0.3, OAK);
      out += rect(cz, top, sl, S, 0.3, STONE);
      out += rect(ox, top, L, H, 0.3, OAK) + rect(ox + D - L, top, L, H, 0.3, OAK);
      out += hChain([ox, ox + D], [m.D], top - 9, top);
      out += hChain([ox, ox + L, ox + D - L, ox + D], [m.L, m.D - 2 * m.L, m.L], top - 4, top);
      out += vChain([top, top + S, ctop + ch, oy], [m.S, m.ch, m.legBelow], ox + D + 5, ox + D);
      out += vChain([top, oy], [m.H], ox + D + 13, ox + D);
      return out;
    }
    var fz = cz + T + m.Din * k;                                                            // back of the faces
    out += rect(ox, top, L, H, 0.2, LIGHT, DASH) + rect(ox + D - L, top, L, H, 0.2, LIGHT, DASH);
    out += rect(cz, top, sl, S, 0.2, 'none', DASH);
    out += rect(cz, ctop, sl, ch, 0.35, '#f7f1e6');
    out += rect(cz, ctop, T, ch, 0.3, OAK);                                                 // back
    out += rect(cz + T, ctop + ch - pT, m.Din * k, pT, 0.3, VENEER);                        // base
    m.rails.forEach(function (r) { out += rect(cz + T, ctop + r * k, m.railW * k, pT, 0.3, VENEER) + rect(fz - m.railW * k, ctop + r * k, m.railW * k, pT, 0.3, VENEER); });
    m.fronts.forEach(function (f, i) { out += rect(fz, ctop + m.frontTops[i] * k, m.ft * k, f * k, 0.3, FACE); });
    m.boxes.forEach(function (b) { out += rect(fz - m.boxLen * k, ctop + b.top * k, m.boxLen * k, b.height * k, 0.3, 'none', DASH); });
    out += text(cz + T + 1, ctop + 3, 'back', 1.6, { fill: '#555' });
    out += hChain([fz - m.boxLen * k, fz], [m.boxLen], ctop - 9, ctop);
    out += hChain([cz, cz + T, fz, fz + m.ft * k], [m.T, m.Din, m.ft], ctop - 4, ctop);
    if (m.rails.length) out += hChain([cz + T, cz + T + m.railW * k, fz - m.railW * k, fz], [m.railW, m.Din - 2 * m.railW, m.railW], ctop + ch + 4, ctop + ch) + text(cz + T, ctop + ch + 7.5, 'drawer rails (front and back strips)', 1.6, { fill: '#555' });
    out += vChain([ctop, ctop + ch, oy], [m.ch, m.legBelow], ox + D + 5, ox + D);
    return out;
  }

  // plan views, back at the top. mode: 'top' (client), 'carcass' (section through a drawer), 'stone'
  function pedPlan(s, m, ox, oy, mode) {
    var k = m.k, W = m.W * k, D = m.D * k, r = m.L / 2 * k, out = '', cx = ox + m.cx0 * k, cz = oy + m.cz0 * k, T = m.T * k, sl = m.sideLen * k;
    var legs = [[r, r], [W - r, r], [r, D - r], [W - r, D - r]];
    if (mode === 'stone') {
      out += stonePath(m, ox, oy);
      out += text(ox + m.cw * k - 1, oy + 7, 'R' + m.notchR, 1.9, { anchor: 'end' });
      out += text(ox + m.cw * k / 2, oy + sl / 2 - 1, s.stoneTop.material, 2.1, { anchor: 'middle', fill: '#333' });
      out += text(ox + m.cw * k / 2, oy + sl / 2 + 2.5, '4 corner notches round the legs (leg + ' + (m.notchR - m.L / 2) + ' mm)', 1.8, { anchor: 'middle', fill: '#555' });
      out += text(ox + m.cw * k / 2, oy + sl / 2 + 5.2, 'template off the made carcass before cutting', 1.8, { anchor: 'middle', fill: '#555' });
      out += hChain([ox, ox + m.cw * k], [m.cw], oy - 4, oy);
      out += vChain([oy, oy + sl], [m.sideLen], ox + m.cw * k + 5, ox + m.cw * k);
      return out;
    }
    if (mode === 'top') {
      out += stonePath(m, cx, cz);
      legs.forEach(function (p) { out += circle(ox + p[0], oy + p[1], r, OAK, 0.3); });
      out += text(ox + W / 2, oy + D / 2, 'stone top', 2, { anchor: 'middle', fill: '#555' });
      out += text(ox + W / 2, oy + D / 2 + 3.5, 'legs Ø' + m.L + ' solid oak', 1.8, { anchor: 'middle', fill: '#666' });
      out += hChain([ox, ox + W], [m.W], oy - 9, oy);
      out += hChain([ox, cx, cx + m.cw * k, ox + W], [m.cx0, m.cw, m.cx0], oy - 4, oy);
      out += vChain([oy, cz, cz + sl, oy + D], [m.cz0, m.sideLen, m.cz0], ox + W + 5, ox + W);
      out += vChain([oy, oy + D], [m.D], ox + W + 13, ox + W);
      return out;
    }
    var ix = cx + T, iw = m.inner * k, fz = cz + T + m.Din * k;
    out += rect(ix, cz + T, iw, m.Din * k, 0.2, '#f7f1e6');
    out += rect(cx, cz, T, sl, 0.3, OAK) + rect(cx + m.cw * k - T, cz, T, sl, 0.3, OAK);
    out += rect(ix, cz, iw, T, 0.3, OAK);
    out += rect(ix + m.g * k, fz, m.fw * k, m.ft * k, 0.3, FACE);
    legs.forEach(function (p) { out += circle(ox + p[0], oy + p[1], r, LIGHT, 0.25); });
    var bx = ix + m.clr * k, bz = fz - m.boxLen * k, bw = m.boxW * k, bl = m.boxLen * k, t = m.bt * k;
    out += rect(bx, bz, t, bl, 0.25, VENEER) + rect(bx + bw - t, bz, t, bl, 0.25, VENEER);
    out += rect(bx + t, bz, bw - 2 * t, t, 0.25, VENEER) + rect(bx + t, bz + bl - t, bw - 2 * t, t, 0.25, VENEER);
    out += text(bx + bw / 2, bz + bl / 2, 'drawer box', 1.8, { anchor: 'middle', fill: '#555' });
    out += text(ox + W / 2, fz + m.ft * k + 3.2, 'drawer face, inset', 1.6, { anchor: 'middle', fill: '#555' });
    out += hChain([ox, ox + W], [m.W], oy - 9, oy);
    out += hChain([cx, ix, ix + iw, cx + m.cw * k], [m.T, m.inner, m.T], oy - 4, oy);
    out += hChain([ix, ix + m.g * k, ix + iw - m.g * k, ix + iw], [m.g, m.fw, m.g], oy + D + 6, oy + D);
    out += vChain([cz, cz + T, fz, fz + m.ft * k], [m.T, m.Din, m.ft], ox + W + 5, ox + W);
    out += vChain([cz, cz + sl], [m.sideLen], ox + W + 12, ox + W);
    out += vChain([bz, bz + t, bz + bl - t, bz + bl], [m.bt, m.boxLen - 2 * m.bt, m.bt], ox - 5, ox);
    return out;
  }

  // 3D view fitted into the box (x, y, w, h)
  function pedIso(s, m, bx, by, bw, bh) {
    var c = Math.cos(Math.PI / 6), sn = 0.5, W = m.W, D = m.D, H = m.H;
    var spanX = (W + D) * c, spanY = H + (W + D) * sn, sc = Math.min(bw / spanX, bh / spanY);
    var cx = bx + (bw - spanX * sc) / 2 + D * c * sc, cy = by + (bh - spanY * sc) / 2 + H * sc;
    function P(x, y, z) { return [cx + (x * c - z * c) * sc, cy - y * sc + (x * sn + z * sn) * sc]; }
    function poly(pts, fill, sw) { return '<polygon points="' + pts.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join(' ') + '" fill="' + fill + '" stroke="#111" stroke-width="' + (sw || 0.3) + '" stroke-linejoin="round"/>'; }
    function box(x0, y0, z0, x1, y1, z1, fTop, fFront, fRight) {
      return poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], fTop) +
        poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], fFront) +
        poly([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], fRight);
    }
    var r = m.L / 2, rx = r * Math.SQRT2 * c * sc, ry = r * Math.SQRT2 * sn * sc;
    function leg(xc, zc) {
      var b = P(xc, 0, zc), t = P(xc, H, zc);
      return '<ellipse cx="' + n2(b[0]) + '" cy="' + n2(b[1]) + '" rx="' + n2(rx) + '" ry="' + n2(ry) + '" fill="#b8956a" stroke="#111" stroke-width="0.25"/>' +
        '<rect x="' + n2(t[0] - rx) + '" y="' + n2(t[1]) + '" width="' + n2(2 * rx) + '" height="' + n2(b[1] - t[1]) + '" fill="#b8956a"/>' +
        line(t[0] - rx, t[1], b[0] - rx, b[1], 0.25) + line(t[0] + rx, t[1], b[0] + rx, b[1], 0.25) +
        '<ellipse cx="' + n2(t[0]) + '" cy="' + n2(t[1]) + '" rx="' + n2(rx) + '" ry="' + n2(ry) + '" fill="#d6b88f" stroke="#111" stroke-width="0.25"/>';
    }
    var out = '', y0 = m.legBelow, y1 = m.legBelow + m.ch, x0 = m.cx0, x1 = m.cx0 + m.cw, z0 = m.cz0, z1 = m.cz0 + m.sideLen;
    out += leg(r, r);
    out += box(x0, y0, z0, x1, y1, z1, '#cdb08a', '#5b4a36', '#c4a378');
    out += poly([P(x0, y0, z1), P(x0 + m.T, y0, z1), P(x0 + m.T, y1, z1), P(x0, y1, z1)], '#c4a378');      // side edges on the front
    out += poly([P(x1 - m.T, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x1 - m.T, y1, z1)], '#c4a378');
    m.fronts.forEach(function (f, i) {
      var ft = y1 - m.frontTops[i], fb = ft - f, a = x0 + m.T + m.g, b = x1 - m.T - m.g;
      out += poly([P(a, fb, z1), P(b, fb, z1), P(b, ft, z1), P(a, ft, z1)], '#d2b48b');
      var kn = P(W / 2, ft - s.handles.fromTop, z1);
      out += '<ellipse cx="' + n2(kn[0]) + '" cy="' + n2(kn[1]) + '" rx="0.9" ry="1.1" fill="#9c7a48" stroke="#111" stroke-width="0.2"/>';
    });
    out += box(x0, H - m.S, z0, x1, H, z1, '#e4e2dc', '#cfccc4', '#c6c3bb');
    out += leg(W - r, r) + leg(r, D - r) + leg(W - r, D - r);
    var tS = P(W * 0.45, H, D * 0.45), tF = P(W * 0.3, y1 - m.fronts[0] * 0.5, z1), tC = P(x1, (y0 + y1) / 2, z0 + m.sideLen * 0.4), tL = P(r, m.legBelow * 0.5, D - r);
    out += tag(tS[0], tS[1], s.stoneTop.code) + tag(tF[0], tF[1], s.frontBoard.code) + tag(tC[0] + 4, tC[1], s.carcassBoard.code) + tag(tL[0] - 5, tL[1], s.legs.code);
    return out;
  }

  TEMPLATES.pedestal = {
    build: buildPedestal,
    clientViews: function (s, m) {
      return pedFront(s, m, 24, 104, false) + viewTitle(24, 118, 1, 'FRONT VIEW', '1:8') +
        pedSide(s, m, 140, 104, false) + viewTitle(140, 118, 2, 'SIDE VIEW', '1:8') +
        pedPlan(s, m, 24, 142, 'top') + viewTitle(24, 212, 3, 'TOP VIEW', '1:8') +
        pedIso(s, m, 140, 128, 120, 78) + viewTitle(140, 212, 4, '3D VIEW', 'not to scale');
    },
    workshopViews: function (s, m) {
      return pedFront(s, m, 24, 104, true) + viewTitle(24, 118, 1, 'CARCASS FRONT (faces off)', '1:8') +
        pedSide(s, m, 140, 104, true) + viewTitle(140, 118, 2, 'CARCASS SIDE SECTION', '1:8') +
        pedPlan(s, m, 232, 40, 'carcass') + viewTitle(232, 118, 3, 'PLAN THROUGH A DRAWER', '1:8') +
        pedPlan(s, m, 24, 134, 'stone') + viewTitle(24, 204, 4, 'STONE TOP, PLAN', '1:8');
    }
  };
  function sheets(spec, opts) {
    LOGO = (opts && opts.logo) || '';
    var tpl = TEMPLATES[spec.template];
    if (!tpl) throw new Error('Unknown template: ' + spec.template);
    var m = tpl.build(spec);
    SCALE = m.scale;
    return { model: m, svgs: [sheetClient(spec, m, tpl), sheetWorkshop(spec, m, tpl)] };
  }

  var api = { buildCarcass: buildCarcass, buildPedestal: buildPedestal, sheets: sheets, split: split, templates: Object.keys(TEMPLATES) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BattenDrawings = api;
})(this);
