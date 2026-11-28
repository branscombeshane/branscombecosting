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
  //  - (26 Nov, from AOC1825 Slab Oak sideboard) doors can be their own board (s.doorBoard, e.g.
  //    17 veneer on a 23 solid carcass); dividers are centred behind the gaps between doors, so
  //    each door covers its own compartment; a door can be faced with solid slats on a thinner
  //    veneer door (s.slats); openers can be knobs; edging only on parts whose material has it.
  function buildCarcass(s) {
    var T = s.board.thickness, db = (s.doorBoard && s.doorBoard.material) ? s.doorBoard : s.board, Td = db.thickness, B = s.back.thickness, R = s.back.rebate || 8, W = s.width, D = s.depth, H = s.carcassHeight, n = s.columns;
    var Dc = D - Td;                       // carcass depth (sides, top, bottom), the back sits inside it
    var Din = Dc - B;                      // usable depth in front of the back
    var sideH = H - T;                     // sides: from under the top down to the floor
    var divH = H - 2 * T;                  // dividers: between top and bottom
    var g = s.doorGap, doors = split(W - (n - 1) * g, n);
    // odd millimetres go to the middle doors (as drawn on AOC1825: 623 / 624 / 624 / 623)
    (function () { var tot = W - (n - 1) * g, base = Math.floor(tot / n), rem = tot - base * n; doors = doors.map(function () { return base; });
      var mid = (n - 1) / 2, order = doors.map(function (d, i) { return i; }).sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid) || a - b; });
      for (var q = 0; q < rem; q++) doors[order[q]] += 1; })();
    var dws = (typeof s.doorWidths === 'string' ? s.doorWidths.split(/[,\s]+/).filter(Boolean).map(Number) : (s.doorWidths || []));           // door widths as drawn (e.g. 590,582,582,590)
    if (dws.length === n) {
      var dsum = dws.reduce(function (a, b) { return a + b; }, 0);
      if (Math.abs(dsum - (W - (n - 1) * g)) > 0.5) throw new Error('Door widths add up to ' + dsum + ' + gaps ' + (n - 1) * g + ', but the cabinet is ' + W + ' wide');
      doors = dws;
    }
    // (AOC1561 Plinth media unit) the top can run over the doors, the doors sitting a gap below it
    var topOver = s.topOverDoors === true || s.topOverDoors === 'yes', dGap = s.doorTopGap == null ? 2 : s.doorTopGap, doorH = topOver ? H - T - dGap : H;
    var cuts = [], acc = 0;                // divider centres: behind the gaps between doors
    for (var c = 0; c < n - 1; c++) { acc += doors[c]; cuts.push(acc + g / 2); acc += g; }
    var bays = [], left = T;
    cuts.forEach(function (cx) { bays.push(n2(cx - T / 2 - left)); left = cx + T / 2; });
    bays.push(n2(W - T - left));
    bays.forEach(function (b) { if (b < 50) throw new Error('A compartment is only ' + b + ' wide: fewer doors or a wider cabinet'); });
    var hs = typeof s.hingeSides === 'string' ? s.hingeSides.split(/[,\s]+/).filter(Boolean) : (s.hingeSides || []);
    var hinge = (hs.length === n) ? hs.map(function (x) { return String(x).toUpperCase().charAt(0) === 'R' ? 'R' : 'L'; })
      : doors.map(function (d, i) { return i < n / 2 ? 'L' : 'R'; });
    var sl = s.slats || {}, slatDoors = (sl.doors || []).map(Number).filter(function (x) { return x >= 1 && x <= n; });
    var parts = [];
    function edgeOf(mat, edge, len) { return mat && mat.edging ? [edge, len] : ['', 0]; }
    function part(name, qty, l, w, t, mat, edge, edgeLen, note) { var e = edgeOf(mat, edge, edgeLen); parts.push({ name: name, qty: qty, length: l, width: w, thickness: t, code: mat.code, material: mat.material, edge: e[0], edgeLen: e[1], edgeCode: mat.edgingCode, edgeName: mat.edging, note: note || '' }); }
    part('Top', 1, W, topOver ? D : Dc, T, s.board, 'all round', 2 * (W + (topOver ? D : Dc)), topOver ? 'runs over the doors' : '');
    part('Side', 2, sideH, Dc, T, s.board, 'front, back, bottom', 2 * sideH + Dc);
    part('Bottom', 1, W - 2 * T, Dc, T, s.board, 'front', W - 2 * T);
    if (n > 1) part('Divider', n - 1, divH, Din, T, s.board, 'front', divH, 'centred behind the door gap');
    var shelfRows = {};
    (s.shelves || []).forEach(function (count, i) {
      if (!count || !bays[i]) return;
      var k = (bays[i] - 1) + 'x' + (Din - 1);
      shelfRows[k] = shelfRows[k] || { qty: 0, l: n2(bays[i] - 1), w: Din - 1 };
      shelfRows[k].qty += count;
    });
    var fixedShelves = s.shelvesFixed === true || s.shelvesFixed === 'yes', shelfAt = typeof s.shelfAt === 'string' ? s.shelfAt.split(/[,\s]+/).filter(Boolean).map(Number) : (s.shelfAt || []);
    Object.keys(shelfRows).forEach(function (k) { part('Shelf', shelfRows[k].qty, shelfRows[k].l, shelfRows[k].w, T, s.board, 'front', shelfRows[k].l, (fixedShelves ? 'fixed' : 'on pins') + (shelfAt.length ? ', ' + shelfAt.join(' / ') + ' clear from the bottom' : '')); });
    var doorRows = {}, slatRows = {};
    doors.forEach(function (w, i) {
      var slatted = slatDoors.indexOf(i + 1) !== -1;
      var key = w + (slatted ? 's' : '');
      doorRows[key] = doorRows[key] || { qty: 0, w: w, slatted: slatted };
      doorRows[key].qty++;
    });
    var slatInfo = null;
    Object.keys(doorRows).sort().reverse().forEach(function (k) {
      var r = doorRows[k];
      if (!r.slatted) { part('Door', r.qty, doorH, r.w, Td, db, 'all round', 2 * (doorH + r.w), topOver ? dGap + ' below the top' : ''); return; }
      var sb = sl.doorBoard || db, sw = sl.width || 45, sg = sl.gap || 31, m0 = sl.margin == null ? 20 : sl.margin;
      var cnt = Math.max(1, Math.floor((r.w - 2 * m0 + sg) / (sw + sg))), marg = n2((r.w - cnt * sw - (cnt - 1) * sg) / 2);
      slatInfo = { count: cnt, width: sw, gap: sg, margin: marg, thickness: sl.thickness };
      part('Door (slatted)', r.qty, doorH, r.w, sb.thickness, sb, 'all round', 2 * (doorH + r.w), cnt + ' slats ' + sw + ' wide, ' + sg + ' apart, ' + marg + ' in from each edge');
      part('Slat', r.qty * cnt, doorH, sw, sl.thickness, sl, '', 0, 'glued to the slatted door face');
    });
    var bh = s.backHoles || {}, holeD = Number(bh.diameter) || 0;      // cable holes through the back, centred in each compartment, in its upper quarter
    part('Back (rebated ' + R + ' mm)', 1, W - 2 * T + 2 * R, H - 2 * T + 2 * R, B, s.back, '', 0, holeD ? n + ' x Ø' + holeD + ' holes, centred in each compartment, ' + Math.round((H - 2 * T) / 8) + ' below the top inside' : '');
    var base = s.base, plinth = base.type === 'plinth', steel = [], mid = base.middleRails || 0, frameL, frameW, legH;
    if (plinth) {                                  // a box of carcass board under the carcass, set in from the ends, front and back
      frameL = W - 2 * base.insetX; frameW = D - (base.insetFront || 0) - (base.insetBack || 0); legH = base.height;
      part('Plinth front/back', 2, frameL, base.height, T, s.board, '', 0, base.insetX + ' in from each end');
      part('Plinth side', 2, frameW - 2 * T, base.height, T, s.board, '', 0, 'between the plinth front and back');
    } else {
      frameL = W - 2 * base.insetX; frameW = D - 2 * base.insetY; legH = base.height - base.tube;
      var bar = function (name, qty, len) { steel.push({ name: name, qty: qty, length: len, code: base.code, material: base.material }); };
      bar('Long rail', 2, frameL);
      bar('Cross rail', 2 + mid, frameW - 2 * base.tube);
      var midLegs = base.middleLegs === true || base.middleLegs === 'yes';
      bar('Leg', 4 + (midLegs ? 2 * mid : 0), legH);
    }
    // hardware: 2 hinges per door; a door hinged on an end side is full overlay; on a divider, half overlay
    var full = 0, half = 0;
    hinge.forEach(function (side, i) { var outer = side === 'L' ? i === 0 : i === n - 1; if (outer) full += 2; else half += 2; });
    var hw = [];
    function item(code, qty, name) { hw.push({ code: code, qty: qty, name: name }); }
    var hc = 1, op = s.openers || {};
    if (full) item('H' + hc++, full, 'Hinge, full overlay');
    if (half) item('H' + hc++, half, 'Hinge, half overlay');
    item('H' + hc++, full + half, 'Hinge plate');
    var knobDoors = doors.map(function (d, i) { return i; }).filter(function (i) { return slatDoors.indexOf(i + 1) === -1 || op.slatted; });
    var handleDoors = (typeof op.doors === 'string' ? op.doors.split(/[,\s]+/).filter(Boolean).map(Number) : (op.doors || [])).filter(function (x) { return x >= 1 && x <= n; });
    if (op.type === 'handle' && !handleDoors.length) handleDoors = knobDoors.map(function (i) { return i + 1; });
    if (op.type === 'pushToOpen') { item('H' + hc++, n, op.item); if (op.housing) item('H' + hc++, n, op.housing); }
    else if (op.type === 'handle') { item('H' + hc++, handleDoors.length, op.item || 'Bar handle'); if (op.otherItem && handleDoors.length < n) item('H' + hc++, n - handleDoors.length, op.otherItem); }
    else if (op.type === 'knob' && knobDoors.length) item('H' + hc++, knobDoors.length * (op.perDoor || 1), op.item || 'Knob');
    if (op.type === 'knob' && slatDoors.length && !op.slatted && op.slattedItem) item('H' + hc++, slatDoors.length, op.slattedItem);
    var shelfCount = (s.shelves || []).reduce(function (a, b) { return a + b; }, 0);
    if (shelfCount && !fixedShelves) item('H' + hc++, 4 * shelfCount, 'Shelf support pin (if not fixed)');
    // material totals (what costing needs), plus edging in metres per edging material
    var totals = {}, edging = {};
    parts.forEach(function (p) {
      totals[p.code] = totals[p.code] || { code: p.code, material: p.material, unit: 'm²', amount: 0 };
      totals[p.code].amount += p.qty * p.length * p.width / 1e6;
      if (p.edgeLen) { var ek = p.edgeCode || 'E1'; edging[ek] = edging[ek] || { code: ek, material: p.edgeName || 'Edging', unit: 'm', amount: 0 }; edging[ek].amount += p.qty * p.edgeLen / 1000; }
    });
    steel.forEach(function (b) {
      totals[b.code] = totals[b.code] || { code: b.code, material: b.material, unit: 'm', amount: 0 };
      totals[b.code].amount += b.qty * b.length / 1000;
    });
    var list = Object.keys(totals).sort().map(function (k) { return totals[k]; }).concat(Object.keys(edging).sort().map(function (k) { return edging[k]; }));
    var den = pickScale(function (k) { return (W + D) * k <= 255 && (H + base.height) * k <= 80 && D * k <= 62; });
    return { scale: '1:' + den, k: 1 / den, materials: materialsOf([s.board, db, s.slats && slatDoors.length ? sl.doorBoard : null, slatDoors.length ? sl : null, s.back, plinth ? null : s.base]),
      topOver: topOver, dGap: dGap, doorH: doorH, plinth: plinth, handleDoors: handleDoors, holeD: holeD,
      T: T, Td: Td, B: B, R: R, W: W, D: D, H: H, n: n, Dc: Dc, Din: Din, sideH: sideH, divH: divH, bays: bays, doors: doors, cuts: cuts, hinge: hinge, slatDoors: slatDoors, slatInfo: slatInfo,
      frameL: frameL, frameW: frameW, legH: legH, parts: parts, steel: steel, hardware: hw, totals: list, shelfAt: shelfAt, overall: { width: W, depth: D, height: H + base.height } };
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
    var k = m.k, W = m.W * k, H = m.H * k, b = s.base.height * k, T = m.T * k, out = '';
    var top = oy - b - H;
    // base: a plinth box, or a steel frame (legs at each end, rail along the front)
    var lx = s.base.insetX * k, tb = (s.base.tube || 0) * k;
    if (m.plinth) out += rect(ox + lx, oy - b, W - 2 * lx, b, 0.3, '#c9ab7f');
    else { out += rect(ox + lx, oy - b, tb, b, 0.3, '#222') + rect(ox + W - lx - tb, oy - b, tb, b, 0.3, '#222'); out += rect(ox + lx, oy - b, W - 2 * lx, tb, 0.3, '#222'); }
    if (!m.plinth && (s.base.middleLegs === true || s.base.middleLegs === 'yes')) for (var ml = 1; ml <= (s.base.middleRails || 0); ml++) { var mx = ox + lx + (W - 2 * lx - tb) * ml / ((s.base.middleRails || 0) + 1); out += rect(mx, oy - b, tb, b, 0.3, '#222'); }
    if (withDoors) {
      var x = ox, op = s.openers || {}, dTop = m.topOver ? top + (m.T + m.dGap) * k : top, dH = m.doorH * k;
      out += rect(ox, top, W, H, 0.4, '#efe4d2');
      if (m.topOver) out += rect(ox, top, W, T, 0.3, '#d9c4a0');
      m.doors.forEach(function (d, i) {
        out += rect(x, dTop, d * k, dH, 0.3, '#e8d9c0');
        if (op.type === 'handle' && m.handleDoors.indexOf(i + 1) !== -1) { var hx = m.hinge[i] === 'L' ? x + d * k - (op.fromEdge || 30) * k : x + (op.fromEdge || 30) * k; out += rect(hx - Math.max(0.6, 8 * k), dTop + (op.fromTop || 150) * k, Math.max(1.2, 16 * k), (op.length || 160) * k, 0.2, '#333'); }
        var slatted = m.slatDoors.indexOf(i + 1) !== -1;
        if (slatted && m.slatInfo) { for (var q = 0; q < m.slatInfo.count; q++) { var sx = x + (m.slatInfo.margin + q * (m.slatInfo.width + m.slatInfo.gap)) * k; out += rect(sx, dTop, m.slatInfo.width * k, dH, 0.2, '#d6be98'); } }
        if (op.type === 'knob' && (!slatted || op.slatted)) { var kx = m.hinge[i] === 'L' ? x + d * k - (op.fromEdge || 50) * k : x + (op.fromEdge || 50) * k; out += circle(kx, dTop + (op.fromTop || 110) * k, Math.max(0.8, 15 * k), '#333', 0.2); }
        x += d * k + s.doorGap * k;
      });
    } else {
      out += rect(ox, top, W, H, 0.35, '#f7f1e6');
      out += rect(ox, top, W, T, 0.3, '#d9c4a0');                                   // top, full width
      out += rect(ox, top + T, T, H - T, 0.3, '#d9c4a0') + rect(ox + W - T, top + T, T, H - T, 0.3, '#d9c4a0'); // sides to the floor
      out += rect(ox + T, top + H - T, W - 2 * T, T, 0.3, '#d9c4a0');               // bottom, between the sides
      var cx = ox + T;
      m.bays.forEach(function (bay, i) {
        var shelves = (s.shelves || [])[i] || 0;        // bays come from the model (dividers centred on the door gaps)
        for (var j = 1; j <= shelves; j++) {
          var at = m.shelfAt[j - 1], sy = at ? top + H - T - (at + T) * k : top + T + (H - 2 * T) * j / (shelves + 1) - T / 2;   // shelf: given clear height from the bottom, else evenly
          out += rect(cx + 0.1, sy, bay * k - 0.2, T, 0.25, 'none', DASH);
          out += text(cx + bay * k / 2, sy - 1, 'shelf', 1.8, { anchor: 'middle' });
        }
        if (m.holeD) { var hy = top + T + (H - 2 * T) / 8; out += circle(cx + bay * k / 2, hy, m.holeD * k / 2, '#fff', 0.25) + (i === 0 ? text(cx + bay * k / 2 + m.holeD * k / 2 + 1, hy + 0.7, 'Ø' + m.holeD + ' in the back', 1.6, { fill: '#555' }) : ''); }
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
    else if (m.topOver) out += vChain([top, top + T, top + T + m.dGap * k, top + H], [m.T, m.dGap, m.doorH], ox - 5, ox);
    out += vChain([top, oy - b, oy], [m.H, s.base.height], ox + W + 5, ox + W);
    out += vChain([top, oy], [m.H + s.base.height], ox + W + 11, ox + W);
    if (m.plinth) out += hChain([ox, ox + lx, ox + W - lx, ox + W], [s.base.insetX, m.frameL, s.base.insetX], oy + 5, oy);
    else { var lxs = [ox, ox + lx, ox + lx + tb, ox + W - lx - tb, ox + W - lx, ox + W]; out += hChain(lxs, [s.base.insetX, s.base.tube, m.frameL - 2 * s.base.tube, s.base.tube, s.base.insetX], oy + 5, oy); }
    return out;
  }
  function sideView(s, m, ox, oy, section) {
    var k = m.k, D = m.D * k, H = m.H * k, b = s.base.height * k, T = m.T * k, B = m.B * k, R = m.R * k, Dc = m.Dc * k, out = '';
    var top = oy - b - H;
    out += rect(ox, top, Dc, H, 0.35, section ? '#f7f1e6' : '#efe4d2');          // side panel / carcass
    if (section) {
      out += rect(ox, top, Dc, T, 0.3, '#d9c4a0') + rect(ox, top + H - T, Dc, T, 0.3, '#d9c4a0');
      out += rect(ox, top + T - R, B, H - 2 * T + 2 * R, 0.3, '#c9b48e');        // back in its rebate
      out += rect(ox + B + 0.1, top + H / 2 - T / 2, (m.Din - 1) * k, T, 0.25, 'none', DASH);
      out += text(ox + B + 2, top + H / 2 - T / 2 - 1, 'shelf', 1.8);
      out += text(ox + B + 1.2, top + T + 3, 'back in rebate', 1.6, { fill: '#555' });
    }
    if (m.topOver) out += rect(ox, top, D, T, 0.3, '#d9c4a0') + rect(ox + Dc, top + (m.T + m.dGap) * k, m.Td * k, m.doorH * k, 0.3, '#e8d9c0');   // top over the door
    else out += rect(ox + Dc, top, m.Td * k, H, 0.3, '#e8d9c0');                  // door
    var by = (s.base.insetY || 0) * k, tb = (s.base.tube || 0) * k, pb = (s.base.insetBack || 0) * k, pf = (s.base.insetFront || 0) * k;
    if (m.plinth) out += rect(ox + pb, oy - b, D - pb - pf, b, 0.3, '#c9ab7f');
    else { out += rect(ox + by, oy - b, tb, b, 0.3, '#222') + rect(ox + D - by - tb, oy - b, tb, b, 0.3, '#222'); out += rect(ox + by, oy - b, D - 2 * by, tb, 0.3, '#222'); }
    out += hChain([ox, ox + D], [m.D], top - 9, top);
    out += section ? hChain([ox, ox + B, ox + Dc, ox + D], [m.B, m.Din, m.Td], top - 4, top) : hChain([ox, ox + Dc, ox + D], [m.Dc, m.Td], top - 4, top);
    out += vChain([top, oy - b, oy], [m.H, s.base.height], ox + D + 5, ox + D);
    if (m.plinth) out += hChain([ox, ox + pb, ox + D - pf, ox + D], [s.base.insetBack || 0, m.frameW, s.base.insetFront || 0], oy + 5, oy);
    else out += hChain([ox, ox + by, ox + by + tb, ox + D - by - tb, ox + D - by, ox + D], [s.base.insetY, s.base.tube, m.frameW - 2 * s.base.tube, s.base.tube, s.base.insetY], oy + 5, oy);
    return out;
  }
  function topView(s, m, ox, oy) {        // (ox, oy) = back-left corner
    var k = m.k, W = m.W * k, D = m.D * k, T = m.T * k, B = m.B * k, Dc = m.Dc * k, out = '';
    out += rect(ox, oy, W, m.topOver ? D : Dc, 0.35, '#efe4d2');
    var x = ox;
    if (!m.topOver) m.doors.forEach(function (d) { out += rect(x, oy + Dc, d * k, m.Td * k, 0.25, '#e8d9c0'); x += d * k + s.doorGap * k; });
    else out += text(ox + W / 2, oy + D - 1.5, 'top runs over the doors', 1.7, { anchor: 'middle', fill: '#666' });
    var cx = ox + T;
    m.bays.forEach(function (bay, i) { cx += bay * k; if (i < m.bays.length - 1) out += line(cx, oy + B, cx, oy + Dc, 0.2, DASH) + line(cx + T, oy + B, cx + T, oy + Dc, 0.2, DASH); cx += T; });
    out += line(ox + T, oy + B, ox + W - T, oy + B, 0.2, DASH);                  // back, hidden in its rebate
    out += hChain([ox, ox + W], [m.W], oy - 4, oy);
    out += m.topOver ? vChain([oy, oy + D], [m.D], ox + W + 5, ox + W) : vChain([oy, oy + Dc, oy + D], [m.Dc, m.Td], ox + W + 5, ox + W);
    return out;
  }
  function baseTopView(s, m, ox, oy) {
    var k = m.k, L = m.frameL * k, Wd = m.frameW * k, tb = (s.base.tube || 0) * k, out = '';
    if (m.plinth) {
      var T2 = m.T * k, ib = (s.base.insetBack || 0) * k;
      out += rect(ox - s.base.insetX * k, oy - ib, m.W * k, m.D * k, 0.2, 'none', DASH);
      out += text(ox - s.base.insetX * k + 1, oy - ib + m.D * k + 3, 'dashed: carcass outline above', 1.8, { fill: '#666' });
      out += rect(ox, oy, L, Wd, 0.3, '#c9ab7f') + rect(ox + T2, oy + T2, L - 2 * T2, Wd - 2 * T2, 0.25, '#fff');
      out += rect(ox, oy, L, T2, 0.2, '#b8956a') + rect(ox, oy + Wd - T2, L, T2, 0.2, '#b8956a');
      out += hChain([ox, ox + L], [m.frameL], oy - 9, oy) + hChain([ox, ox + T2, ox + L - T2, ox + L], [m.T, m.frameL - 2 * m.T, m.T], oy - 4, oy);
      out += vChain([oy, oy + T2, oy + Wd - T2, oy + Wd], [m.T, m.frameW - 2 * m.T, m.T], ox + L + 5, ox + L);
      return out;
    }
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
    if (m.plinth) { var px0 = s.base.insetX, px1 = W - s.base.insetX, pz0 = s.base.insetBack || 0, pz1 = D - (s.base.insetFront || 0);
      out += poly([P(px0, 0, pz1), P(px1, 0, pz1), P(px1, b, pz1), P(px0, b, pz1)], '#b8956a', 0.2) + poly([P(px1, 0, pz1), P(px1, 0, pz0), P(px1, b, pz0), P(px1, b, pz1)], '#a5835a', 0.2); }
    else { leg(s.base.insetX, D - s.base.insetY); leg(W - s.base.insetX - s.base.tube, D - s.base.insetY); leg(W - s.base.insetX - s.base.tube, s.base.insetY + s.base.tube); }
    var y0 = b, y1 = b + H;
    out += poly([P(0, y1, 0), P(W, y1, 0), P(W, y1, D), P(0, y1, D)], '#e9dcc4');              // top
    out += poly([P(W, y0, D), P(W, y0, 0), P(W, y1, 0), P(W, y1, D)], '#d8c4a2');             // right side
    out += poly([P(0, y0, D), P(W, y0, D), P(W, y1, D), P(0, y1, D)], '#e3d2b4');             // front
    var x = 0;
    m.doors.forEach(function (d, i) {
      if (i) out += '<line x1="' + n2(P(x, y0, D)[0]) + '" y1="' + n2(P(x, y0, D)[1]) + '" x2="' + n2(P(x, y1, D)[0]) + '" y2="' + n2(P(x, y1, D)[1]) + '" stroke="#111" stroke-width="0.3"/>';
      if (m.slatDoors.indexOf(i + 1) !== -1 && m.slatInfo) for (var q = 0; q < m.slatInfo.count; q++) { var sx = x + m.slatInfo.margin + q * (m.slatInfo.width + m.slatInfo.gap); [sx, sx + m.slatInfo.width].forEach(function (lx2) { out += line(P(lx2, y0, D)[0], P(lx2, y0, D)[1], P(lx2, y1, D)[0], P(lx2, y1, D)[1], 0.15); }); }
      x += d + s.doorGap;
    });
    var tM1 = P(W * 0.3, y1 - H * 0.4, D), dbc = ((s.doorBoard && s.doorBoard.material) ? s.doorBoard : s.board).code, tM3 = m.plinth ? P(s.base.insetX + 60, b * 0.5, D - (s.base.insetFront || 0)) : P(s.base.insetX + 10, b * 0.5, D - s.base.insetY), tTop = P(W * 0.55, y1, D * 0.5);
    out += tag(tM1[0], tM1[1], dbc) + tag(tM3[0] - 4, tM3[1] + 4, m.plinth ? s.board.code : s.base.code) + tag(tTop[0], tTop[1], s.board.code);
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
      .concat((m.steel || []).map(function (b) { return [b.code, b.name, b.qty, b.length, String(b.w || 25), String(b.t || 25), b.material, b.note || 'weld, grind'];}));
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
        var k = m.k, sx = 24 + m.W * k + 34, ix = 24 + m.W * k + 14, size = Math.min(80, 318 - ix);
        return frontView(s, m, 24, 104, true) + viewTitle(24, 118, 1, 'FRONT VIEW', m.scale) +
          sideView(s, m, sx, 104, false) + viewTitle(sx, 118, 2, 'SIDE VIEW', m.scale) +
          topView(s, m, 24, 142) + viewTitle(24, 212, 3, 'TOP VIEW', m.scale) +
          iso(s, m, ix + size * m.D / (m.W + m.D), 150, size) + viewTitle(ix, 212, 4, '3D VIEW', 'not to scale');
      },
      workshopViews: function (s, m) {
        var k = m.k, sx = 24 + m.W * k + 34;
        return frontView(s, m, 24, 104, false) + viewTitle(24, 118, 1, 'CARCASS FRONT (doors off)', m.scale) +
          sideView(s, m, sx, 104, true) + viewTitle(sx, 118, 2, 'CARCASS SIDE SECTION', m.scale) +
          baseTopView(s, m, 24 + s.base.insetX * k, 146) + viewTitle(24, 204, 3, m.plinth ? 'PLINTH, PLAN' : 'STEEL BASE, PLAN', m.scale);
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
  // ---------------------------------------------------------------- shared --------------
  function pickScale(fits) {             // first workshop scale (1:n) at which fits(k) is true
    var list = [5, 7, 8, 10, 15, 20, 25, 30, 40, 50];
    for (var i = 0; i < list.length; i++) if (fits(1 / list[i])) return list[i];
    return 50;
  }
  function materialsOf(list) {           // one entry per ref; the first wins, gaps filled from the others
    var seen = {}, mats = [];
    list.forEach(function (x) {
      if (!x) return;
      var have = seen[x.code];
      if (!have) { seen[x.code] = have = { code: x.code, material: x.material, colour: x.colour || '', finish: x.finish || '', thickness: x.thickness, edging: x.edging, edgingCode: x.edgingCode }; mats.push(have); return; }
      ['colour', 'finish', 'edging', 'edgingCode'].forEach(function (k) { if (!have[k] && x[k]) have[k] = x[k]; });
    });
    return mats.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  }
  function totalsOf(parts) {
    var totals = {};
    parts.forEach(function (p) {
      var u = p.unit || 'm²';
      totals[p.code] = totals[p.code] || { code: p.code, material: p.material, unit: u, amount: 0 };
      totals[p.code].amount += u === 'm' ? p.qty * p.length / 1000 : p.qty * p.length * p.width / 1e6;
    });
    return Object.keys(totals).sort().map(function (k) { return totals[k]; });
  }
  // CNC rule (Shane, 26 Nov 2026): anything cut on the CNC needs 50 mm extra on its length and
  // its width so it can be clamped down; the cutting list gives the blank, the note the finished size.
  var CNC_MARGIN = 50;
  function pathOf(pts, close) { return 'M' + pts.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join(' L') + (close ? ' Z' : ''); }
  function poly2(pts, fill, sw, extra) { return '<path d="' + pathOf(pts, true) + '" fill="' + (fill || 'none') + '" stroke="#111" stroke-width="' + (sw || 0.3) + '" stroke-linejoin="round"' + (extra || '') + '/>'; }
  function hull(pts) {                   // convex hull (monotone chain), for drawing a prism in 3D
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    pts.forEach(function (p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (var i = pts.length - 1; i >= 0; i--) { var p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  // ================================================================ template: table =========
  // Round table on blade legs (from the 1400 Venezia drawing, AOC1892): a solid top with a
  // mitre (bevel) under its edge, screwed to a round MDF sub-base; flat blade legs, rounded at
  // both ends, radiate from the centre at equal angles and are fixed to the sub-base. In plan
  // each blade ends `fromEdge` in from the sub-base edge and runs `length` towards the centre.
  // Option legs.type 'round' (from AOC1690 Contour side table): turned round legs, centres on a
  // circle of radius legs.placeRadius, fixed straight to the top. subBase.diameter 0 = no sub-base.
  function buildTable(s) {
    var D = s.diameter, H = s.height, tp = s.top, sb = s.subBase || {}, lg = s.legs, fx = s.fixings || {};
    var round = lg.type === 'round', hasSub = Number(sb.diameter) > 0;
    var T = tp.thickness, St = hasSub ? sb.thickness : 0, Ds = hasSub ? sb.diameter : 0, n = lg.count;
    var t = round ? lg.diameter : lg.thickness, L = round ? lg.diameter : lg.length, base = hasSub ? Ds : D, baseName = hasSub ? 'sub-base' : 'top';
    var clr = sb.cutoutClearance == null ? 1 : sb.cutoutClearance, r1, r2, bladeH;
    var edge = tp.edgeThickness == null ? T : tp.edgeThickness, ang = tp.bevelAngle || 45;
    var bevel = edge < T ? Math.round((T - edge) / Math.tan(ang * Math.PI / 180)) : 0;
    if (hasSub && Ds > D) throw new Error('The sub-base (Ø' + Ds + ') is bigger than the top (Ø' + D + ')');
    if (!(n >= 1)) throw new Error('A table needs at least 1 leg');
    if (round) {
      r1 = r2 = n === 1 ? 0 : lg.placeRadius;
      bladeH = H - T - St;                                                         // round legs sit under the sub-base, if there is one
      if (n > 1 && 2 * r1 * Math.sin(Math.PI / n) < t + 1) throw new Error('The legs overlap: put their centres at least ' + Math.ceil((t + 1) / (2 * Math.sin(Math.PI / n))) + ' mm from the middle');
      if (r1 + t / 2 > base / 2) throw new Error('The legs stick out past the ' + baseName + ': centres at most ' + Math.floor(base / 2 - t / 2) + ' mm from the middle');
    } else {
      r2 = base / 2 - lg.fromEdge; r1 = r2 - L; bladeH = H - T;                    // blades tuck into sub-base cut-outs (Shane, 26 Nov) and run up to the top
      if (r1 < 0) throw new Error('The legs (' + L + ' long, ' + lg.fromEdge + ' in from the edge) run past the centre of the ' + baseName);
      if (n < 2) throw new Error('A table needs at least 2 blade legs');
      var minR1 = n === 2 ? 0 : (t / 2) / Math.sin(Math.PI / n) + 2;
      if (r1 < minR1) throw new Error('The legs touch in the middle: start them at least ' + Math.ceil(minR1) + ' mm from the centre (shorter legs or further in from the edge)');
    }
    if (bladeH <= St) throw new Error('The height is less than the top and sub-base');
    var parts = [];
    function part(name, qty, l, w, th, mat, note, unit) { parts.push({ name: name, qty: qty, length: l, width: w, thickness: th, code: mat.code, material: mat.material, edge: '', edgeLen: 0, note: note || '', unit: unit }); }
    part('Top (CNC blank)', 1, D + CNC_MARGIN, D + CNC_MARGIN, T, tp, 'CNC to Ø' + D + ' (+' + CNC_MARGIN + ' to clamp)' + (bevel ? '; ' + ang + '° mitre under the edge, ' + edge + ' left' : ''));
    if (hasSub) part('Sub-base (CNC blank)', 1, Ds + CNC_MARGIN, Ds + CNC_MARGIN, St, sb, 'CNC to Ø' + Ds + ' (+' + CNC_MARGIN + ' to clamp)' + (round ? '' : '; ' + n + ' leg cut-outs, leg + ' + clr + ' all round'));
    if (round) part('Leg', n, bladeH, t, t, lg, 'turned Ø' + t + ', round', 'm');
    else part('Blade leg', n, bladeH, L, t, lg, 'both ends rounded R' + n2(t / 2) + ' (in plan)');
    var hw = [], hc = 1;
    if (fx.perLeg) hw.push({ code: 'H' + hc++, qty: fx.perLeg * n, name: fx.legItem || 'Leg fixing' });
    if (fx.topQty) hw.push({ code: 'H' + hc++, qty: fx.topQty, name: fx.topItem || 'Top fixing' });
    var angles = [];
    for (var i = 0; i < n; i++) angles.push(-Math.PI / 2 + i * 2 * Math.PI / n);   // first blade points to the back
    var den = pickScale(function (k) { return D * k <= 86 && H * k <= 78; });
    return { scale: '1:' + den, k: 1 / den, materials: materialsOf([tp, hasSub ? sb : null, lg]), D: D, H: H, T: T, St: St, Ds: Ds, n: n, t: t, L: L, r1: r1, r2: r2, clr: clr,
      round: round, hasSub: hasSub, base: base, baseName: baseName,
      bladeH: bladeH, edge: edge, bevel: bevel, ang: ang, angles: angles, parts: parts, hardware: hw, totals: totalsOf(parts),
      overall: { width: D, depth: D, height: H } };
  }
  // stadium (blade with rounded ends) in plan, centred on (cx, cy), at angle a (radians)
  function bladePlan(m, cx, cy, a, k, fill, extra, grow) {
    var r = (m.t / 2 + (grow || 0)) * k, c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c, p1 = [cx + c * m.r1 * k, cy + s * m.r1 * k], p2 = [cx + c * m.r2 * k, cy + s * m.r2 * k], R = n2(r);
    return '<path d="M' + n2(p1[0] + nx * r) + ',' + n2(p1[1] + ny * r) + ' L' + n2(p2[0] + nx * r) + ',' + n2(p2[1] + ny * r) +
      ' A' + R + ' ' + R + ' 0 0 0 ' + n2(p2[0] - nx * r) + ',' + n2(p2[1] - ny * r) + ' L' + n2(p1[0] - nx * r) + ',' + n2(p1[1] - ny * r) +
      ' A' + R + ' ' + R + ' 0 0 0 ' + n2(p1[0] + nx * r) + ',' + n2(p1[1] + ny * r) + ' Z" fill="' + (fill || 'none') + '" stroke="#111" stroke-width="0.3"' + (extra || '') + '/>';
  }
  // front elevation; (ox, oy) = left edge of the top at floor level
  function tableFront(s, m, ox, oy) {
    var k = m.k, D = m.D * k, H = m.H * k, T = m.T * k, St = m.St * k, top = oy - H, cx = ox + D / 2, out = '';
    var bh = m.bladeH * k, sbw = m.Ds * k, e = m.edge * k, b = m.bevel * k;
    var order = m.angles.slice().sort(function (a, c) { return Math.sin(a) - Math.sin(c); });  // back first
    order.forEach(function (a) {
      var c = Math.cos(a), sn = m.round ? 1 : Math.abs(Math.sin(a)), xs = [m.r1 * c, m.r2 * c].sort(function (p, q) { return p - q; });
      var x0 = cx + (xs[0] - m.t / 2 * sn) * k, x1 = cx + (xs[1] + m.t / 2 * sn) * k;
      out += rect(x0, oy - bh, Math.max(x1 - x0, 0.4), bh, 0.3, Math.sin(a) > 0.01 ? FACE : OAK);
    });
    if (m.hasSub) out += rect(cx - sbw / 2, top + T, sbw, St, 0.3, '#d9d4c8', ' fill-opacity="0.85"');
    out += poly2([[ox, top], [ox + D, top], [ox + D, top + e], [ox + D - b, top + T], [ox + b, top + T], [ox, top + e]], OAK, 0.35);
    out += hChain([ox, ox + D], [m.D], top - 5, top);
    out += vChain([oy - bh, oy], [m.bladeH], ox + D + 5, ox + D) + text(ox + D + 3, top - 1.2, 'top ' + m.T + (!m.hasSub ? '' : m.round ? '; sub-base ' + m.St : '; legs run up through the ' + m.St + ' sub-base'), 1.8, { fill: '#555' });
    out += vChain([top, oy], [m.H], ox + D + 12, ox + D);
    return out;
  }
  // plan; mode 'top' (client: top with the base dashed under it) or 'layout' (workshop: sub-base + legs)
  function tablePlan(s, m, cx, cy, mode) {
    var k = m.k, R = m.D / 2 * k, Rs = m.base / 2 * k, out = '';
    if (mode === 'top') {
      out += circle(cx, cy, R, OAK, 0.35);
      if (m.bevel) out += circle(cx, cy, R - m.bevel * k, 'none', 0.15, DASH);
      if (m.hasSub) out += circle(cx, cy, Rs, 'none', 0.2, DASH);
      m.angles.forEach(function (a) { out += bladePlan(m, cx, cy, a, k, 'none', DASH); });
      out += hChain([cx - R, cx + R], [m.D], cy - R - 5, cy - R);
      out += text(cx, cy + R + 4.5, 'base shown dashed', 1.8, { anchor: 'middle', fill: '#666' });
      return out;
    }
    out += circle(cx, cy, Rs, m.hasSub ? '#efebe3' : '#e6d3b6', 0.35);
    if (!m.hasSub && m.bevel) out += circle(cx, cy, Rs - m.bevel * k, 'none', 0.15, DASH);
    if (m.round) {
      if (m.n > 1) out += circle(cx, cy, m.r1 * k, 'none', 0.15, DASH);
      m.angles.forEach(function (a) { out += circle(cx + Math.cos(a) * m.r1 * k, cy + Math.sin(a) * m.r1 * k, m.t / 2 * k, OAK, 0.3); });
    } else if (m.hasSub) {
      m.angles.forEach(function (a) { out += bladePlan(m, cx, cy, a, k, '#fff', '', m.clr) + bladePlan(m, cx, cy, a, k, OAK, ' fill-opacity="0.55"'); });
      out += text(cx + Rs + 6, cy + Rs - 6, 'leg cut-outs right through', 1.8, { fill: '#555' }) + text(cx + Rs + 6, cy + Rs - 3.6, 'the sub-base: leg + ' + m.clr + ' mm all round', 1.8, { fill: '#555' });
    } else m.angles.forEach(function (a) { out += bladePlan(m, cx, cy, a, k, OAK); });
    out += circle(cx, cy, 0.5, '#111', 0.1);
    var a0 = m.angles[0];
    if (m.round) out += text(cx + Rs + 6, cy - 2, m.n + ' legs Ø' + m.t + (m.n > 1 ? ', centres on R' + m.r1 : ''), 1.9, { fill: '#333' }) + text(cx + Rs + 6, cy + 1, (m.hasSub ? 'under the sub-base' : 'fixed to the underside of the top'), 1.8, { fill: '#555' });
    else out += vChain([cy - Rs, cy - m.r2 * k, cy - m.r1 * k], [s.legs.fromEdge, m.L], cx + m.t / 2 * k + 6, cx);
    out += hChain([cx - Rs, cx + Rs], [m.base], cy + Rs + 5, cy + Rs);
    if (m.n > 2) {                                                                 // angle between blades
      var ra = (m.r1 + m.L * 0.25) * k, a1 = m.angles[1], p0 = [cx + Math.cos(a0) * ra, cy + Math.sin(a0) * ra], p1 = [cx + Math.cos(a1) * ra, cy + Math.sin(a1) * ra];
      out += '<path d="M' + n2(p0[0]) + ',' + n2(p0[1]) + ' A' + n2(ra) + ' ' + n2(ra) + ' 0 0 1 ' + n2(p1[0]) + ',' + n2(p1[1]) + '" fill="none" stroke="#111" stroke-width="0.18"/>';
      var am = (a0 + a1) / 2;
      out += text(cx + Math.cos(am) * (ra + 3), cy + Math.sin(am) * (ra + 3), n2(360 / m.n) + '°', 2, { anchor: 'middle' });
    }
    var a1b = m.angles[1 % m.n], mid = (m.r1 + m.r2) / 2 * k, off = m.t / 2 * k + 2.2;
    if (!m.round) out += text(cx + Math.cos(a1b) * mid - Math.sin(a1b) * off, cy + Math.sin(a1b) * mid + Math.cos(a1b) * off + 0.7, m.t + ' thick', 1.9, { anchor: 'middle', rotate: a1b * 180 / Math.PI });
    var aR = m.angles[m.n - 1] + Math.PI / m.n, ex = cx + Math.cos(aR) * Rs, ey = cy + Math.sin(aR) * Rs;
    out += line(cx, cy, ex, ey, 0.18) + text(cx + Math.cos(aR) * Rs * 0.6, cy + Math.sin(aR) * Rs * 0.6 - 1.2, 'R' + n2(m.base / 2), 2, { anchor: 'middle' });
    return out;
  }
  // one blade, elevation (height x length), plus its plan below; (ox, oy) = bottom-left
  function tableBlade(s, m, ox, oy) {
    var k = m.k, L = m.L * k, h = m.bladeH * k, t = m.t * k, out = '';
    if (m.round) {
      out += rect(ox, oy - h, t, h, 0.35, OAK) + line(ox + t * 0.3, oy - h, ox + t * 0.3, oy, 0.12) + line(ox + t * 0.75, oy - h, ox + t * 0.75, oy, 0.12);
      out += hChain([ox, ox + t], ['Ø' + m.t], oy - h - 5, oy - h) + vChain([oy - h, oy], [m.bladeH], ox + t + 5, ox + t);
      out += circle(ox + t / 2, oy + 4 + t / 2, t / 2, OAK, 0.3) + text(ox + t + 3, oy + 4 + t / 2 + 0.7, 'turned, round', 1.8, { fill: '#555' });
      return out;
    }
    out += rect(ox, oy - h, L, h, 0.35, OAK);
    out += line(ox + t / 2, oy - h, ox + t / 2, oy, 0.15, DASH) + line(ox + L - t / 2, oy - h, ox + L - t / 2, oy, 0.15, DASH);
    out += text(ox + L / 2, oy - h / 2, 'end grain rounded', 1.7, { anchor: 'middle', fill: '#555' });
    out += hChain([ox, ox + L], [m.L], oy - h - 5, oy - h);
    out += vChain([oy - h, oy], [m.bladeH], ox + L + 5, ox + L);
    var py = oy + 6;                                                                // plan of the blade
    out += '<path d="M' + n2(ox + t / 2) + ',' + n2(py) + ' L' + n2(ox + L - t / 2) + ',' + n2(py) + ' A' + n2(t / 2) + ' ' + n2(t / 2) + ' 0 0 1 ' + n2(ox + L - t / 2) + ',' + n2(py + t) +
      ' L' + n2(ox + t / 2) + ',' + n2(py + t) + ' A' + n2(t / 2) + ' ' + n2(t / 2) + ' 0 0 1 ' + n2(ox + t / 2) + ',' + n2(py) + ' Z" fill="' + OAK + '" stroke="#111" stroke-width="0.3"/>';
    out += vChain([py, py + t], [m.t], ox + L + 5, ox + L) + text(ox, py + t + 3.5, 'plan', 1.8, { fill: '#555' });
    return out;
  }
  // edge detail of the top on the sub-base, (ox, oy) = outer top corner, 1:2
  function tableEdge(s, m, ox, oy) {
    var k = 0.5, T = m.T * k, e = m.edge * k, b = m.bevel * k, w = Math.max(m.bevel + 40, 60) * k, St = m.St * k, gap = (m.D - m.Ds) / 2 * k, out = '';
    out += poly2([[ox, oy], [ox + w, oy], [ox + w, oy + T], [ox + b, oy + T], [ox, oy + e]], OAK, 0.35);
    if (!m.hasSub) out += '';
    else if (gap < w) out += rect(ox + gap, oy + T, w - gap, St, 0.3, '#d9d4c8');  // (legs: see the layout)
    else out += text(ox, oy + T + 10, 'sub-base starts ' + n2((m.D - m.Ds) / 2) + ' in from the edge', 1.8, { fill: '#555' });
    out += vChain([oy, oy + e], [m.edge], ox - 4, ox) + vChain([oy, oy + T], [m.T], ox + w + 4, ox + w);
    if (b) out += hChain([ox, ox + b], [m.bevel], oy + T + 4, oy + T) + text(ox + b + 2, oy + T - 1, m.ang + '°', 2);
    return out;
  }
  function tableIso(s, m, bx, by, bw, bh) {
    var c = Math.cos(Math.PI / 6), sn = 0.5, R = m.D / 2, H = m.H;
    var spanX = 2 * R * c * Math.SQRT2, spanY = H + R * Math.SQRT2, sc = Math.min(bw / spanX, bh / spanY);
    var cx = bx + bw / 2, cy = by + (bh - spanY * sc) / 2 + R * Math.SQRT2 * sn * sc + H * sc;
    function P(x, y, z) { return [cx + (x - z) * c * sc, cy - y * sc + (x + z) * sn * sc]; }
    var out = '', rx = R * c * Math.SQRT2 * sc, ry = R * sn * Math.SQRT2 * sc;
    var blades = m.angles.map(function (a) {                                       // plan angle -> x (right), z (towards the viewer)
      var ca = Math.cos(a), sa = Math.sin(a), nx = -sa * m.t / 2, nz = ca * m.t / 2, pts = [];
      [m.r1, m.r2].forEach(function (r) { [1, -1].forEach(function (sg) { [0, m.bladeH].forEach(function (y) { pts.push(P(ca * r + sg * nx, y, sa * r + sg * nz)); }); }); });
      return { depth: ca + sa, pts: pts };
    }).sort(function (p, q) { return p.depth - q.depth; });
    if (m.round) {
      var lr = m.t / 2, erx = lr * Math.SQRT2 * c * sc, ery = lr * Math.SQRT2 * sn * sc, top = H - m.T - m.St;
      m.angles.map(function (a) { return { x: Math.cos(a) * m.r1, z: Math.sin(a) * m.r1 }; }).sort(function (p, q) { return (p.x + p.z) - (q.x + q.z); }).forEach(function (L) {
        var b0 = P(L.x, 0, L.z), t0 = P(L.x, top, L.z);
        out += '<path d="M' + n2(t0[0] - erx) + ',' + n2(t0[1]) + ' L' + n2(b0[0] - erx) + ',' + n2(b0[1]) + ' A' + n2(erx) + ' ' + n2(ery) + ' 0 0 0 ' + n2(b0[0] + erx) + ',' + n2(b0[1]) + ' L' + n2(t0[0] + erx) + ',' + n2(t0[1]) + ' Z" fill="#c4a378" stroke="#111" stroke-width="0.3"/>';
      });
      blades = [{ pts: [P(0, 0, m.r1 + lr)] }];
    } else blades.forEach(function (b) { out += poly2(hull(b.pts), '#c4a378', 0.3); });
    var top = P(0, H, 0), bot = P(0, H - m.T, 0);
    out += '<path d="M' + n2(top[0] - rx) + ',' + n2(top[1]) + ' L' + n2(bot[0] - rx) + ',' + n2(bot[1]) + ' A' + n2(rx) + ' ' + n2(ry) + ' 0 0 0 ' + n2(bot[0] + rx) + ',' + n2(bot[1]) +
      ' L' + n2(top[0] + rx) + ',' + n2(top[1]) + ' Z" fill="#b8956a" stroke="#111" stroke-width="0.3"/>';
    out += '<ellipse cx="' + n2(top[0]) + '" cy="' + n2(top[1]) + '" rx="' + n2(rx) + '" ry="' + n2(ry) + '" fill="#d6b88f" stroke="#111" stroke-width="0.3"/>';
    var tT = P(-R * 0.2, H, -R * 0.2), near = blades[blades.length - 1].pts, foot = near.reduce(function (a, p) { return p[1] > a[1] ? p : a; });
    out += tag(tT[0], tT[1], s.top.code) + tag(foot[0] + 7, foot[1] - 4, s.legs.code);
    return out;
  }
  TEMPLATES.table = {
    build: buildTable,
    clientViews: function (s, m) {
      var k = m.k;
      return tableFront(s, m, 24, 104) + viewTitle(24, 118, 1, 'FRONT VIEW', m.scale) +
        tablePlan(s, m, 160 + m.D * k / 2, 104 - m.D * k / 2, 'top') + viewTitle(160, 118, 2, 'TOP VIEW', m.scale) +
        tableIso(s, m, 40, 128, 220, 78) + viewTitle(24, 212, 3, '3D VIEW', 'not to scale');
    },
    workshopViews: function (s, m) {
      var k = m.k;
      return tablePlan(s, m, 24 + m.base * k / 2 + 4, 110 - m.base * k / 2, 'layout') + viewTitle(24, 124, 1, (m.hasSub ? 'SUB-BASE' : 'UNDERSIDE') + ' & LEG LAYOUT', m.scale) +
        tableBlade(s, m, 150, 96) + viewTitle(150, 124, 2, (m.round ? 'LEG' : 'BLADE LEG') + ' (make ' + m.n + ')', m.scale) +
        tableEdge(s, m, 236, 40) + viewTitle(232, 124, 3, 'EDGE DETAIL', '1:2') +
        tableFront(s, m, 150, 200) + viewTitle(150 + m.D * k + 22, 200, 4, 'FRONT VIEW', m.scale);
    }
  };

  // ================================================================ template: mirror ========
  // Shaped (wavy) mirror frame (from AO2277 Soho Mirror): a solid frame `frame.width` wide and
  // `frame.thickness` thick, CNC cut to a wave outline, with a stepped rebate routed in the back
  // (from the outer edge: full thickness to `backing.inset`, then the backing's thickness deep
  // to `mirror.inset`, then the backing + mirror deep to the inner edge). The mirror sits in the
  // second step under the front lip, the backing over it in the first step, held with glass
  // clips; wood inserts in the back take the hanging hardware. Every outline (outer, inner,
  // backing, mirror) is the same wave shape drawn on a smaller rectangle.
  function waveOutline(W, H, a, nx, ny, rc, steps) {     // points, origin = top-left of the overall size
    var bw = W - 2 * a, bh = H - 2 * a;
    rc = Math.max(1, Math.min(rc, bw / 2 - 0.5, bh / 2 - 0.5));
    var C = [[a + rc, a + rc], [W - a - rc, a + rc], [W - a - rc, H - a - rc], [a + rc, H - a - rc]];
    var pts = [];
    for (var i = 0; i < 4; i++) {
      var th0 = Math.PI * (1.25 + i / 2), straight = (i % 2 === 0 ? bw : bh) - 2 * rc, arc = rc * Math.PI / 4, len = 2 * arc + straight, cyc = i % 2 === 0 ? nx : ny;
      var c0 = C[i], c1 = C[(i + 1) % 4], N = steps || 160;
      for (var j = 0; j < N; j++) {
        var sArc = j / N * len, px, py, nxv, nyv;
        if (sArc < arc) { var th = th0 + sArc / rc; nxv = Math.cos(th); nyv = Math.sin(th); px = c0[0] + rc * nxv; py = c0[1] + rc * nyv; }
        else if (sArc < arc + straight) { var thN = th0 + Math.PI / 4, d = sArc - arc; nxv = Math.cos(thN); nyv = Math.sin(thN); px = c0[0] + rc * nxv - nyv * d; py = c0[1] + rc * nyv + nxv * d; }
        else { var th2 = th0 + Math.PI / 4 + (sArc - arc - straight) / rc; nxv = Math.cos(th2); nyv = Math.sin(th2); px = c1[0] + rc * nxv; py = c1[1] + rc * nyv; }
        var off = a * (1 + Math.cos(2 * Math.PI * cyc * j / N)) / 2;
        pts.push([px + nxv * off, py + nyv * off]);
      }
    }
    return pts;
  }
  function buildMirror(s) {
    if (s.style === 'arch') return buildArchMirror(s);
    var W = s.width, H = s.height, wv = s.waves || {}, fr = s.frame, bk = s.backing, mr = s.mirror, ft = s.fittings || {};
    var a = wv.depth == null ? 20 : wv.depth, nx = wv.across || 4, ny = wv.along || 8, rc = wv.cornerRadius == null ? 50 : wv.cornerRadius;
    var w = fr.width, Tf = fr.thickness, bi = bk.inset, mi = mr.inset, lip = Tf - bk.thickness - mr.thickness;
    if (!(bi > 0 && bi < mi && mi < w)) throw new Error('Back rebate steps must be: 0 < backing step (' + bi + ') < mirror step (' + mi + ') < frame width (' + w + ')');
    if (lip < 6) throw new Error('Backing + mirror (' + (bk.thickness + mr.thickness) + ' mm) leave only ' + lip + ' mm of frame at the front');
    if (W - 2 * w - 2 * a < 40 || H - 2 * w - 2 * a < 40) throw new Error('The frame and waves leave no opening: make it bigger, the frame narrower or the waves shallower');
    var shape = function (inset, steps) { return waveOutline(W - 2 * inset, H - 2 * inset, a, nx, ny, Math.max(rc - inset, 5), steps).map(function (p) { return [p[0] + inset, p[1] + inset]; }); };
    var outer = shape(0), inner = shape(w), backO = shape(bi), mirO = shape(mi);
    var blank = w + a + CNC_MARGIN;                                                  // frame blanks: frame width + wave depth + CNC clamping
    var parts = [];
    function part(name, qty, l, wd, th, mat, note) { parts.push({ name: name, qty: qty, length: l, width: wd, thickness: th, code: mat.code, material: mat.material, edge: '', edgeLen: 0, note: note || '' }); }
    part('Frame side (CNC blank)', 2, H + CNC_MARGIN, blank, Tf, fr, 'join + glue up, then CNC wave profile + back rebate (+' + CNC_MARGIN + ' to clamp)');
    part('Frame top/bottom (CNC blank)', 2, W + CNC_MARGIN - 2 * blank + 2 * 20, blank, Tf, fr, 'between the sides, 20 mm overlap each end');
    part('Backing (CNC blank)', 1, W - 2 * bi + CNC_MARGIN, H - 2 * bi + CNC_MARGIN, bk.thickness, bk, 'CNC to the backing outline, ' + (W - 2 * bi) + ' x ' + (H - 2 * bi) + ' (+' + CNC_MARGIN + ' to clamp)');
    part('Mirror', 1, W - 2 * mi, H - 2 * mi, mr.thickness, mr, 'shaped to the mirror outline, polished edge');
    var hw = [], hc = 1, cl = ft.clips || 0;
    if (cl) hw.push({ code: 'H' + hc++, qty: cl, name: ft.clipItem || 'Glass clip' });
    if (ft.inserts) hw.push({ code: 'H' + hc++, qty: ft.inserts, name: ft.insertItem || 'Wood insert (threaded)' });
    if (ft.hangingQty) hw.push({ code: 'H' + hc++, qty: ft.hangingQty, name: ft.hanging || 'Hanging bracket' });
    var den = pickScale(function (k) { return H * k <= 84 && W * k <= 62; });
    return { scale: '1:' + den, k: 1 / den, materials: materialsOf([fr, bk, mr]), W: W, H: H, a: a, w: w, Tf: Tf, bi: bi, mi: mi, lip: lip, blank: blank,
      outer: outer, inner: inner, backO: backO, mirO: mirO, parts: parts, hardware: hw, totals: totalsOf(parts), overall: { width: W, depth: Tf, height: H } };
  }
  function place(pts, k, ox, oy) { return pts.map(function (p) { return [ox + p[0] * k, oy + p[1] * k]; }); }
  // front (client) or back (workshop) view; (ox, oy) = top-left of the overall size
  function mirrorView(s, m, ox, oy, mode) {
    var k = m.k, W = m.W * k, H = m.H * k, out = '';
    if (mode === 'front') {
      out += '<path d="' + pathOf(place(m.outer, k, ox, oy), true) + ' ' + pathOf(place(m.inner, k, ox, oy).reverse(), true) + '" fill="' + FACE + '" fill-rule="evenodd" stroke="#111" stroke-width="0.3"/>';
      out += poly2(place(m.inner, k, ox, oy), '#dfe7ea', 0.3);
      out += line(ox + W * 0.35, oy + H * 0.3, ox + W * 0.55, oy + H * 0.18, 0.2, ' stroke-opacity="0.5"') + line(ox + W * 0.4, oy + H * 0.4, ox + W * 0.65, oy + H * 0.25, 0.2, ' stroke-opacity="0.5"');
    } else {
      out += poly2(place(m.outer, k, ox, oy), FACE, 0.35);
      out += poly2(place(m.backO, k, ox, oy), '#e9dcc7', 0.2);
      out += poly2(place(m.mirO, k, ox, oy), 'none', 0.2, DASH);
      out += poly2(place(m.inner, k, ox, oy), 'none', 0.2, DASH);
    }
    out += hChain([ox, ox + W], [m.W], oy - 5, oy);
    out += vChain([oy, oy + H], [m.H], ox + W + 5, ox + W);
    return out;
  }
  function mirrorPanel(m, pts, w, h, ox, oy, label) {     // backing or mirror, with its overall size
    var k = m.k, inset = (m.W - w) / 2, out = '';
    out += rect(ox, oy, w * k, h * k, 0.15, 'none', DASH);
    out += poly2(place(pts.map(function (p) { return [p[0] - inset, p[1] - inset]; }), k, ox, oy), label === 'mirror' ? '#dfe7ea' : '#e9dcc7', 0.3);
    out += hChain([ox, ox + w * k], [w], oy - 5, oy) + vChain([oy, oy + h * k], [h], ox + w * k + 5, ox + w * k);
    return out;
  }
  // section through the frame (back up), (ox, oy) = outer edge, back face; scale 1:1 or 1:2
  function mirrorSection(s, m, ox, oy, k, withGlass) {
    var w = m.w * k, T = m.Tf * k, bi = m.bi * k, mi = m.mi * k, b1 = s.backing.thickness * k, b2 = s.mirror.thickness * k, out = '';
    out += poly2([[ox, oy], [ox + bi, oy], [ox + bi, oy + b1], [ox + mi, oy + b1], [ox + mi, oy + b1 + b2], [ox + w, oy + b1 + b2], [ox + w, oy + T], [ox, oy + T]], FACE, 0.35);
    if (withGlass) {
      out += rect(ox + bi + 0.3, oy, (m.w - m.bi + 8) * k, b1, 0.25, '#e9dcc7') + rect(ox + mi + 0.3, oy + b1, (m.w - m.mi + 8) * k, b2, 0.25, '#dfe7ea');
      out += text(ox + w + 9 * k, oy + b1 * 0.75, 'backing', 1.8, { fill: '#555' }) + text(ox + w + 9 * k, oy + b1 + b2 * 0.8, 'mirror', 1.8, { fill: '#555' });
    }
    out += hChain([ox, ox + bi, ox + mi, ox + w], [m.bi, n2(m.mi - m.bi), n2(m.w - m.mi)], oy - 4, oy);
    out += vChain([oy, oy + b1, oy + b1 + b2, oy + T], [s.backing.thickness, s.mirror.thickness, m.lip], ox - 4, ox);
    out += text(ox + w / 2, oy + T + 4, 'back of the frame up; outer edge on the left', 1.7, { anchor: 'middle', fill: '#555' });
    return out;
  }
  // ---- mirror style 'arch' (from AOC1828 Emily Mirror): arched steel frame -------------------
  // Outline: straight sides, a concave shoulder (radius Rs) at each top corner and a convex crown
  // (radius Rc) centred on the middle line, touching the top; the shoulder circles sit on the side
  // lines and just touch the crown circle. Every inner outline (tube frame, mirror, back) uses the
  // same centres, stepped in by d (crown Rc - d, shoulders Rs + d), e.g. R612/R140 -> R604/R148.
  // Build, front to back: a flat-bar rim all round (rolled to the outline, the full depth), the
  // mirror behind a front lip, a square-tube frame (outline + a middle upright + cross bars), and
  // an MDF back.
  function archGeom(W, H, Rc, Rs) {
    var dy = Math.sqrt(Math.pow(Rc + Rs, 2) - Math.pow(W / 2, 2));
    if (!(dy > 0) || Rc - dy < -1e-6) throw new Error('These radii do not make an arch: the crown R' + Rc + ' and shoulders R' + Rs + ' do not meet on a ' + W + ' wide mirror');
    return { cx: W / 2, cy: Rc, ny: Rc - dy };            // crown centre (cx, cy); shoulder centres (0, ny) and (W, ny)
  }
  function archOutline(W, H, Rc, Rs, d, steps) {
    var g = archGeom(W, H, Rc, Rs), rc = Rc - d, rs = Rs + d, pts = [];
    if (rc <= 0) throw new Error('The arch is too tight for the parts inside it');
    var sideTop = g.ny + Math.sqrt(Math.max(0, rs * rs - d * d));          // where the side line meets the shoulder circle
    var tl = [g.cx * rs / (Rc + Rs), g.ny + (g.cy - g.ny) * rs / (Rc + Rs)];                // shoulder/crown touch point (left)
    var a0 = Math.atan2(sideTop - g.ny, d - 0), a1 = Math.atan2(tl[1] - g.ny, tl[0]);
    var N = steps || 24;
    pts.push([d, H - d]); pts.push([d, sideTop]);
    for (var i = 1; i <= N; i++) { var a = a0 + (a1 - a0) * i / N; pts.push([rs * Math.cos(a), g.ny + rs * Math.sin(a)]); }   // left shoulder (concave)
    var cl = Math.atan2(tl[1] - g.cy, tl[0] - g.cx), cr = Math.PI - cl;
    if (cr > cl) cr -= 2 * Math.PI;
    var left = pts.slice(), crown = [];
    for (var j = 1; j < 2 * N; j++) { var b = cl + (cr - cl) * j / (2 * N); crown.push([g.cx + rc * Math.cos(b), g.cy + rc * Math.sin(b)]); }
    var right = left.slice().reverse().map(function (p) { return [W - p[0], p[1]]; });   // right shoulder, side and bottom corner
    return left.concat(crown).concat(right);
  }
  function buildArchMirror(s) {
    var W = s.width, H = s.height, a = s.arch, rim = s.rim, tb = s.tube, mr = s.mirror, bk = s.backing, sec = s.section || {};
    var Rc = a.crownRadius, Rs = a.shoulderRadius;
    var outer = archOutline(W, H, Rc, Rs, 0), mirO = archOutline(W, H, Rc, Rs, mr.inset), backO = archOutline(W, H, Rc, Rs, bk.inset), tubeO = archOutline(W, H, Rc, Rs, tb.inset);
    var t = tb.size, inner = archOutline(W, H, Rc, Rs, tb.inset + t);
    var depth = rim.width, stack = (sec.frontLip || 0) + mr.thickness + (sec.gap || 0) + t + bk.thickness + (sec.backLip || 0);
    if (Math.abs(stack - depth) > 0.5) throw new Error('Front lip + mirror + glue + tube + back + back lip = ' + stack + ', but the rim is ' + depth + ' deep');
    var rows = tb.rows || 4, cols = tb.cols || 2;
    var fw = W - 2 * tb.inset, archTop = archGeom(W, H, Rc, Rs);
    var Hin = H - 2 * (tb.inset + t), colW = (fw - 2 * t - (cols - 1) * t) / cols;
    var rowHs = (tb.rowHeights && tb.rowHeights.length === rows) ? tb.rowHeights.map(Number) : [];
    var sumR = rowHs.reduce(function (x, y) { return x + y; }, 0) + (rows - 1) * t;
    if (!rowHs.length || Math.abs(sumR - Hin) > 2) rowHs = []; for (var ri = 0; ri < rows && rowHs.length < rows; ri++) rowHs.push(n2((Hin - (rows - 1) * t) / rows));
    // cross bars: evenly between the bottom tube and the top of the straight sides, as drawn
    var parts = [];
    function part(name, qty, l, w, th, mat, note, unit) { parts.push({ name: name, qty: qty, length: n2(l), width: w, thickness: th, code: mat.code, material: mat.material, edge: '', edgeLen: 0, note: note || '', unit: unit }); }
    var steel = [];
    function bar(name, qty, len, mat, size, note) { var sz = String(size).split(' x ').map(Number); steel.push({ name: name, qty: qty, length: Math.round(len), code: mat.code, material: mat.material, w: sz[1] || sz[0], t: sz[0], note: note || '' }); }
    bar('Rim (rolled to the outline)', 1, perimOf(outer), rim, rim.thickness + ' x ' + rim.width, 'flat bar, roll + weld to the arch');
    bar('Tube frame outline', 1, perimOf(tubeO) - 4 * t, tb, t + ' x ' + t, 'bend to the arch, weld');
    var crownY = archTop.cy - (Rc - tb.inset - t);                                         // underside of the tube at the crown
    bar('Upright (middle)', cols - 1, H - tb.inset - t - crownY, tb, t + ' x ' + t, 'bottom tube to the crown');
    bar('Cross bar', rows - 1, colW * cols + (cols - 1) * t, tb, t + ' x ' + t, 'between the frame sides');
    var M = CNC_MARGIN;
    part('Mirror', 1, H - 2 * mr.inset, W - 2 * mr.inset, mr.thickness, mr, 'cut to the arch (R' + (Rc - mr.inset) + ' / R' + (Rs + mr.inset) + '), polished edge; glued onto the tube frame');
    part('Back (CNC blank)', 1, H - 2 * bk.inset + M, W - 2 * bk.inset + M, bk.thickness, bk, 'CNC to the arch, ' + (W - 2 * bk.inset) + ' x ' + (H - 2 * bk.inset) + ' (+' + M + ' to clamp)');
    var hw = (s.fittings && s.fittings.items || []).filter(function (x) { return x && x.name && x.qty; }).map(function (x, i) { return { code: 'H' + (i + 1), qty: x.qty, name: x.name }; });
    var totals = totalsOf(parts);
    steel.forEach(function (b) { var tt = totals.filter(function (x) { return x.code === b.code; })[0]; if (!tt) totals.push(tt = { code: b.code, material: b.material, unit: 'm', amount: 0 }); tt.amount += b.qty * b.length / 1000; });
    totals.sort(function (x, y) { return x.code < y.code ? -1 : 1; });
    var den = pickScale(function (k) { return H * k <= 150 && W * k <= 80; });
    return { arch: true, scale: '1:' + den, k: 1 / den, materials: materialsOf([rim, tb, mr, bk]), W: W, H: H, Rc: Rc, Rs: Rs, depth: depth, t: t, rows: rows, cols: cols, colW: colW, rowHs: rowHs, Hin: Hin,
      outer: outer, mirO: mirO, backO: backO, tubeO: tubeO, inner: inner, crownY: crownY, geom: archTop, parts: parts, steel: steel, hardware: hw, totals: totals,
      overall: { width: W, depth: depth, height: H } };
  }
  var GOLD = '#c9a54a', GOLD_D = '#a8862f', GLASS = '#dfe7ea';
  // front (client) / tube frame (workshop) / mirror (workshop); (ox, oy) = top-left of the overall size
  function archView(s, m, ox, oy, mode) {
    var k = m.k, out = '', W = m.W * k, H = m.H * k;
    function pl(pts, d) { return place(pts, k, ox + d * k, oy + d * k); }
    if (mode === 'front') {
      out += '<path d="' + pathOf(place(m.outer, k, ox, oy), true) + ' ' + pathOf(place(m.mirO, k, ox, oy).reverse(), true) + '" fill="' + GOLD + '" fill-rule="evenodd" stroke="#111" stroke-width="0.3"/>';
      out += poly2(place(m.mirO, k, ox, oy), GLASS, 0.25);
      out += line(ox + W * 0.3, oy + H * 0.35, ox + W * 0.6, oy + H * 0.25, 0.2, ' stroke-opacity="0.5"') + line(ox + W * 0.35, oy + H * 0.45, ox + W * 0.7, oy + H * 0.33, 0.2, ' stroke-opacity="0.5"');
      out += hChain([ox, ox + W], [m.W], oy - 5, oy) + vChain([oy, oy + H], [m.H], ox + W + 6, ox + W);
      out += archRadii(m, ox, oy, 0);
      return out;
    }
    if (mode === 'tube') {
      var d = s.tube.inset, t = m.t * k, fw = (m.W - 2 * d) * k, fx = ox + d * k, by = oy + (m.H - d) * k;
      out += '<path d="' + pathOf(place(m.tubeO, k, ox, oy), true) + ' ' + pathOf(place(m.inner, k, ox, oy).reverse(), true) + '" fill="#555" fill-rule="evenodd" stroke="#111" stroke-width="0.25"/>';
      var yTop = d + m.t, yy0 = yTop;
      for (var r = 0; r < m.rows - 1; r++) { yy0 += m.rowHs[r]; out += rect(fx + t, oy + yy0 * k, fw - 2 * t, t, 0.2, '#555'); yy0 += m.t; }
      for (var c = 1; c < m.cols; c++) { var xx = fx + t + (c * m.colW + (c - 1) * m.t) * k; out += rect(xx, oy + m.crownY * k, t, by - t - (oy + m.crownY * k), 0.2, '#555'); }
      var hx = [fx, fx + t], hv = [m.t];
      for (var cc = 0; cc < m.cols; cc++) { hx.push(hx[hx.length - 1] + m.colW * k); hv.push(n2(m.colW)); hx.push(hx[hx.length - 1] + t); hv.push(m.t); }
      out += hChain(hx, hv, oy - 4, oy);
      var ys = [oy + d * k, oy + yTop * k], vs = [m.t];
      for (var q = 0; q < m.rows; q++) { ys.push(ys[ys.length - 1] + m.rowHs[q] * k); vs.push(m.rowHs[q]); ys.push(ys[ys.length - 1] + t); vs.push(m.t); }
      out += vChain(ys, vs, ox + W + 6, ox + W) + hChain([fx, fx + fw], [m.W - 2 * d], oy - 9, oy);
      out += text(fx + fw / 2, by + 4, m.t + ' mm square tube, ' + (m.rows - 1) + ' cross bars, ' + (m.cols - 1) + ' upright', 1.7, { anchor: 'middle', fill: '#444' });
      return out;
    }
    var din = s.mirror.inset;
    out += poly2(place(m.mirO, k, ox, oy), GLASS, 0.3);
    out += hChain([ox + din * k, ox + (m.W - din) * k], [m.W - 2 * din], oy - 4, oy) + vChain([oy + din * k, oy + (m.H - din) * k], [m.H - 2 * din], ox + W + 6, ox + W);
    out += archRadii(m, ox, oy, din);
    return out;
  }
  function archRadii(m, ox, oy, d) {
    var k = m.k, g = m.geom, cx = ox + g.cx * k, cy = oy + g.cy * k, rc = (m.Rc - d) * k, a = -Math.PI * 0.62, out = '';
    out += line(cx, cy, cx + rc * Math.cos(a), cy + rc * Math.sin(a), 0.18) + text(cx + rc * 0.55 * Math.cos(a) - 2, cy + rc * 0.55 * Math.sin(a), 'R' + (m.Rc - d), 1.9, { anchor: 'end' });
    var sx = ox + m.W * k, sy = oy + g.ny * k, rs = (m.Rs + d) * k, b = Math.PI * 0.8;
    out += line(sx, sy, sx + rs * Math.cos(b), sy + rs * Math.sin(b), 0.18) + text(sx + 2, sy - 1, 'R' + (m.Rs + d), 1.9);
    return out;
  }
  // section through the side, 1:1; (ox, oy) = front face, outer edge; depth runs right
  function archSection(s, m, ox, oy) {
    var k = 1, sec = s.section || {}, rt = s.rim.thickness, D = m.depth, out = '', x = ox, h = 34;
    out += rect(ox, oy, D, rt, 0.3, GOLD);                                                      // rim (seen in section along the edge)
    var y0 = oy + rt;
    x += (sec.frontLip || 0);
    out += rect(x, y0, s.mirror.thickness, h, 0.25, GLASS); var xm = x; x += s.mirror.thickness;
    if (sec.gap) out += rect(x, y0 + 2, sec.gap, m.t, 0.15, '#f2e2a0');                         // mirror glue between the glass and the tube
    x += (sec.gap || 0);
    out += rect(x, y0 + 2, m.t, m.t, 0.3, '#555'); var xt = x; x += m.t;
    out += rect(x, y0, s.backing.thickness, h, 0.25, '#e9dcc7'); var xb = x;
    out += hChain([ox, ox + (sec.frontLip || 0), xm + s.mirror.thickness, xt, xt + m.t, xb + s.backing.thickness, ox + D], [sec.frontLip || 0, s.mirror.thickness, sec.gap || 0, m.t, s.backing.thickness, sec.backLip || 0].map(n2), oy - 4, oy);
    out += hChain([ox, ox + D], [m.depth], oy - 9, oy) + vChain([oy, oy + rt], [rt], ox - 4, ox);
    out += text(xm + 1, y0 + h + 3.5, 'mirror', 1.7, { fill: '#444' }) + text(xt, y0 + m.t + 6, 'tube', 1.7, { fill: '#444' }) + text(xb, y0 + h + 6.5, 'back', 1.7, { fill: '#444' });
    out += text(ox, y0 + h + 10, 'front on the left; rim ' + rt + ' x ' + D + ' flat bar', 1.7, { fill: '#555' });
    out += text(ox, y0 + h + 13, 'mirror glued onto the tube frame' + (sec.gap ? ' (' + sec.gap + ' glue)' : ''), 1.7, { fill: '#555' });
    return out;
  }
  function archIso(s, m, bx, by, bw, bh) {
    var c = Math.cos(Math.PI / 6), sn = 0.5, W = m.W, H = m.H, D = m.depth;
    var spanX = (W + D) * c, spanY = H + (W + D) * sn, sc = Math.min(bw / spanX, bh / spanY);
    var cx = bx + (bw - spanX * sc) / 2 + D * c * sc, cy = by + (bh - spanY * sc) / 2 + H * sc;
    function P(x, y, z) { return [cx + (x * c - z * c) * sc, cy - y * sc + (x * sn + z * sn) * sc]; }
    var front = m.outer.map(function (p) { return P(p[0], H - p[1], D); }), back = m.outer.map(function (p) { return P(p[0], H - p[1], 0); });
    var out = poly2(hull(front.concat(back)), GOLD_D, 0.3) + poly2(front, GOLD, 0.3);
    var din = s.mirror.inset;
    out += poly2(m.mirO.map(function (p) { return P(p[0], H - p[1], D); }), GLASS, 0.25);
    var tR = P(W, H * 0.5, D), tM = P(W * 0.5, H * 0.45, D);
    out += tag(tR[0] + 3, tR[1], s.rim.code) + tag(tM[0], tM[1], s.mirror.code);
    return out;
  }
  TEMPLATES.mirror = {
    build: buildMirror,
    clientViews: function (s, m) {
      if (m.arch) {
        var ka = m.k, Wa = m.W * ka, Ha = m.H * ka, sx = 30 + Wa + 26;
        return archView(s, m, 30, 30, 'front') + viewTitle(24, 30 + Ha + 14, 1, 'FRONT VIEW', m.scale) +
          rect(sx, 30, Math.max(m.depth * ka, 1), Ha, 0.3, GOLD) + hChain([sx, sx + m.depth * ka], [m.depth], 25, 30) + vChain([30, 30 + Ha], [m.H], sx + m.depth * ka + 5, sx + m.depth * ka) + viewTitle(sx - 6, 30 + Ha + 14, 2, 'SIDE', m.scale) +
          archSection(s, m, sx + 30, 50) + viewTitle(sx + 24, 120, 3, 'SECTION', '1:1') +
          archIso(s, m, sx + 90, 26, 318 - sx - 90, 186) + viewTitle(sx + 90, 222, 4, '3D VIEW', 'not to scale');
      }
      var k = m.k, W = m.W * k, H = m.H * k, top = 104 - H;
      return mirrorView(s, m, 30, top, 'front') + viewTitle(24, 118, 1, 'FRONT VIEW', m.scale) +
        rect(30 + W + 26, top, m.Tf * k, H, 0.3, FACE) + vChain([top, top + H], [m.H], 30 + W + 26 + m.Tf * k + 5, 30 + W + 26 + m.Tf * k) +
        hChain([30 + W + 26, 30 + W + 26 + m.Tf * k], [m.Tf], top - 5, top) + viewTitle(30 + W + 20, 118, 2, 'SIDE', m.scale) +
        mirrorSection(s, m, 40, 150, 1, true) + viewTitle(24, 212, 3, 'FRAME SECTION', '1:1') +
        tag(30 + W * 0.5, top + 4, s.frame.code) + tag(30 + W * 0.5, top + H * 0.5, s.mirror.code);
    },
    workshopViews: function (s, m) {
      if (m.arch) {
        var kb = m.k, Wb = m.W * kb, Hb = m.H * kb, x2 = 30 + Wb + 30, x3 = x2 + Wb + 34;
        return archView(s, m, 30, 30, 'tube') + viewTitle(24, 30 + Hb + 14, 1, 'STEEL TUBE FRAME', m.scale) +
          archView(s, m, x2, 30, 'mirror') + viewTitle(x2 - 6, 30 + Hb + 14, 2, 'MIRROR', m.scale) +
          archSection(s, m, x3, 50) + viewTitle(x3 - 6, 120, 3, 'SECTION', '1:1') +
          text(x3 - 6, 140, 'Back: ' + s.backing.material + ' cut to the arch, ' + s.backing.inset + ' in from the outside.', 1.9, { fill: '#444' }) +
          text(x3 - 6, 144, 'Rim: ' + s.rim.thickness + ' x ' + s.rim.width + ' flat bar rolled to the outline, ' + Math.round(perimOf(m.outer)) + ' long.', 1.9, { fill: '#444' }) +
          text(x3 - 6, 148, 'All outlines share the same centres (crown R' + m.Rc + ', shoulders R' + m.Rs + ').', 1.9, { fill: '#444' });
      }
      var k = m.k, H = m.H * k, top = 112 - H, x2 = 30 + m.W * k + 22, x3 = x2 + (m.W - 2 * m.bi) * k + 22;
      return mirrorView(s, m, 30, top, 'back') + viewTitle(24, 124, 1, 'BACK VIEW', m.scale) +
        mirrorPanel(m, m.backO, m.W - 2 * m.bi, m.H - 2 * m.bi, x2, top + m.bi * k, 'backing') + viewTitle(x2, 124, 2, 'BACKING', m.scale) +
        mirrorPanel(m, m.mirO, m.W - 2 * m.mi, m.H - 2 * m.mi, x3, top + m.mi * k, 'mirror') + viewTitle(x3, 124, 3, 'MIRROR', m.scale) +
        mirrorSection(s, m, 40, 148, 1, false) + viewTitle(24, 200, 4, 'BACK ROUTER DETAIL', '1:1') +
        text(110, 150, 'Outlines: outer edge = frame outside; inner = frame opening (dashed);', 2, { fill: '#444' }) +
        text(110, 154, 'shaded = backing; dashed inside it = mirror. Same wave on each.', 2, { fill: '#444' }) +
        text(110, 160, 'Waves: ' + (s.waves.across || 4) + ' across, ' + (s.waves.along || 8) + ' down each side, ' + m.a + ' mm deep.', 2, { fill: '#444' }) +
        text(110, 164, 'Frame blanks ' + m.blank + ' mm wide (frame ' + m.w + ' + wave ' + m.a + ' + ' + CNC_MARGIN + ' to clamp on the CNC).', 2, { fill: '#444' });
    }
  };
  // ================================================================ template: desk ==========
  // Desk / console on legs with drawers (from AOC1675 Quinn Wavey Desk): a solid top on an apron
  // box; the sides and back are aprons mitred 45° at the corners, the front is the drawer faces
  // (mitred at the outer ends, a gap between them, a gap under the top). Every apron and face can
  // have a smooth wavy bottom edge (rounded up and down), cut on the CNC, with a flat at each
  // corner. The carcass frame (from the AOC1675 carcass top view, Shane 27 Nov): a side rail along
  // each end, full inside depth, ta + d in from the outside; a divider between drawers, full depth;
  // and a block at the front and back of each end between the side apron and the side rail. Each
  // leg sits in the d x d opening closed by the two aprons, the side rail and the block, and runs
  // up to the top of the frame (under the desk top). Rails, divider and blocks are the full frame
  // height: apron - wave. One drawer box per bay on undermount runners, the bay less the runner
  // clearance each side, directly behind its drawer face, `raise` above the bottom of the rails.
  function arches(len, pitch) { return Math.max(1, Math.round(len / pitch)); }
  // bottom edge from x0 to x1 (paper), base line y (paper, the lowest point), arch depth d (paper)
  function wavePath(x0, x1, y, flat0, flat1, n, d) {
    var a = x0 + flat0, b = x1 - flat1, w = (b - a) / n, pts = [[x0, y], [a, y]];
    for (var i = 0; i < n; i++) for (var j = 1; j <= 24; j++) { var u = j / 24; pts.push([a + (i + u) * w, y - d * (1 - Math.cos(2 * Math.PI * u)) / 2]); }   // smooth: rounded up and down
    pts.push([x1, y]);
    return pts;
  }
  function buildDesk(s) {
    var W = s.width, D = s.depth, H = s.height, tp = s.top, ap = s.apron, fc = s.faces, lg = s.legs, rl = s.rails, wv = s.wave || {}, dr = s.drawers, rn = s.runners;
    var T = tp.thickness, A = ap.height, ta = ap.thickness, n = dr.count, g = fc.gap, tg = fc.topGap, d = lg.diameter, rt = rl.thickness;
    var faceH = A - tg, fw = (W - (n - 1) * g) / n, legH = H - T, inner = W - 2 * (ta + d + rt), bay = (inner - (n - 1) * rt) / n;
    var depth0 = (s.wave || {}).depth || 0, rh = A - depth0, frameIn = D - 2 * ta;
    var depthIn = D - 2 * ta, railLen = frameIn, clr = rn.sideClearance, bt = dr.box.thickness, boxW = bay - 2 * clr, boxIn = boxW - 2 * bt, boxLen = rn.boxLength;
    var depth = wv.depth || 0, pitch = wv.pitch || 90, flat = wv.cornerFlat == null ? ta : wv.cornerFlat;
    if (n < 1) throw new Error('A desk needs at least 1 drawer');
    if (boxW < 100) throw new Error('The drawer bays are only ' + Math.round(bay) + ' wide: fewer drawers or a wider desk');
    if (boxLen > depthIn - rt) throw new Error('Drawer boxes ' + boxLen + ' long do not fit the ' + depthIn + ' inside depth');
    if (dr.box.height + (dr.box.raise || 0) > rh) throw new Error('Drawer boxes ' + dr.box.height + ' high (+' + (dr.box.raise || 0) + ' above the rail bottom) do not fit the ' + rh + ' high frame');
    if (D - 2 * (ta + d + rt) < 50) throw new Error('The desk is too shallow for the legs and blocks');
    if (legH <= A) throw new Error('The height is less than the top and the aprons');
    var parts = [], cnc = depth > 0;
    function part(name, qty, l, w, th, mat, note, unit) { parts.push({ name: name, qty: qty, length: l, width: w, thickness: th, code: mat.code, material: mat.material, edge: '', edgeLen: 0, note: note || '', unit: unit }); }
    var M = cnc ? CNC_MARGIN : 0, wnote = cnc ? 'CNC wave bottom edge (+' + CNC_MARGIN + ' to clamp); ' : '';
    part('Top', 1, W, D, T, tp, '');
    part('Drawer face' + (cnc ? ' (CNC blank)' : ''), n, n2(fw) + M, faceH + M, fc.thickness, fc, wnote + 'finished ' + n2(fw) + ' x ' + faceH + '; 45° mitre on the outer end' + (n > 2 ? ' (end faces only)' : ''));
    part('Side apron' + (cnc ? ' (CNC blank)' : ''), 2, D + M, A + M, ta, ap, wnote + 'finished ' + D + ' x ' + A + '; 45° mitre both ends');
    part('Back apron' + (cnc ? ' (CNC blank)' : ''), 1, W + M, A + M, ta, ap, (wv.back === false ? '' : wnote) + 'finished ' + W + ' x ' + A + '; 45° mitre both ends');
    part('Leg', 4, legH, d, d, lg, 'turned Ø' + d + ', round', 'm');
    part('Side rail', 2, frameIn, rh, rt, rl, 'full inside depth, ' + (ta + d) + ' in from the end; runners fix to it');
    if (n > 1) part('Divider', n - 1, frameIn, rh, rt, rl, 'full inside depth between drawers');
    part('Leg block', 4, d, rh, rt, rl, 'between side apron and side rail, closes the leg opening');
    var bb = dr.bottom || dr.box;
    part('Drawer box side', 2 * n, boxLen, dr.box.height, bt, dr.box);
    part('Drawer box front/back', 2 * n, n2(boxIn), dr.box.height, bt, dr.box);
    part('Drawer bottom', n, n2(boxIn), boxLen - 2 * bt, bb.thickness, bb);
    var hw = [{ code: 'H1', qty: n, name: rn.item + ' (pair)' }];
    if (s.handles && s.handles.item && s.handles.qty) hw.push({ code: 'H2', qty: s.handles.qty * n, name: s.handles.item });
    var den = pickScale(function (k) { return W * k <= 132 && H * k <= 78 && D * k <= 62; });
    return { scale: '1:' + den, k: 1 / den, materials: materialsOf([tp, fc, ap, lg, rl, dr.box, bb]), W: W, D: D, H: H, T: T, A: A, ta: ta, n: n, g: g, tg: tg, d: d, rt: rt,
      faceH: faceH, fw: fw, legH: legH, inner: inner, bay: bay, depthIn: depthIn, railLen: railLen, clr: clr, rh: rh, frameIn: frameIn, bt: bt, boxW: boxW, boxIn: boxIn, boxLen: boxLen,
      wave: depth, pitch: pitch, flat: flat, waveBack: wv.back !== false, parts: parts, hardware: hw, totals: totalsOf(parts), overall: { width: W, depth: D, height: H } };
  }
  // front elevation; (ox, oy) = left end at floor level. section = faces off (carcass)
  function deskFront(s, m, ox, oy, section) {
    var k = m.k, W = m.W * k, H = m.H * k, T = m.T * k, A = m.A * k, ta = m.ta * k, d = m.d * k, top = oy - H, ab = top + T + A, wd = m.wave * k, out = '';
    out += rect(ox + ta, top + T, d, oy - top - T, 0.3, OAK) + rect(ox + W - ta - d, top + T, d, oy - top - T, 0.3, OAK);   // legs up to the top; the aprons are drawn over them
    if (!section) {
      var x = ox;
      for (var i = 0; i < m.n; i++) {
        var w = m.fw * k, f0 = i === 0 ? m.flat * k : 0, f1 = i === m.n - 1 ? m.flat * k : 0, ft = top + T + m.tg * k;
        var edge = m.wave ? wavePath(x, x + w, ab, f0, f1, arches(m.fw - (f0 + f1) / k, m.pitch), wd) : [[x, ab], [x + w, ab]];
        out += poly2([[x, ft]].concat(edge.slice().reverse().reverse()).concat([[x + w, ft]]), FACE, 0.3);
        x += w + m.g * k;
      }
      out += rect(ox, top, W, T, 0.35, OAK);
      var xs = [ox], vals = [];
      for (var j = 0; j < m.n; j++) { xs.push(ox + (j + 1) * m.fw * k + j * m.g * k); vals.push(n2(m.fw)); if (j < m.n - 1) { xs.push(xs[xs.length - 1] + m.g * k); vals.push(m.g); } }
      out += hChain(xs, vals, top - 4, top) + hChain([ox, ox + W], [m.W], top - 9, top);
      out += vChain([top, top + T, top + T + m.tg * k, ab, oy], [m.T, m.tg, m.faceH, n2(m.legH - m.A)], ox + W + 5, ox + W) + vChain([top, oy], [m.H], ox + W + 13, ox + W);
      return out;
    }
    // carcass: back apron seen from the front, rails/dividers in section, drawer boxes
    var back = m.wave && m.waveBack ? wavePath(ox, ox + W, ab, m.flat * k, m.flat * k, arches(m.W - 2 * m.flat, m.pitch), wd) : [[ox, ab], [ox + W, ab]];
    out += poly2([[ox, top + T]].concat(back).concat([[ox + W, top + T]]), '#efe6d6', 0.25);
    var rx0 = ox + ta + d, rh = m.rh * k, fy = top + T + rh;
    out += rect(rx0, top + T, m.rt * k, rh, 0.3, VENEER) + rect(ox + W - ta - d - m.rt * k, top + T, m.rt * k, rh, 0.3, VENEER);
    out += rect(ox + ta, top + T, d, oy - top - T, 0.3, OAK) + rect(ox + W - ta - d, top + T, d, oy - top - T, 0.3, OAK);   // legs, up to the top of the frame
    var bx = rx0 + m.rt * k;
    for (var b = 0; b < m.n; b++) {
      var by = top + T + rh - (s.drawers.box.raise || 0) * k - s.drawers.box.height * k;
      out += rect(bx + m.clr * k, by, m.boxW * k, s.drawers.box.height * k, 0.3, VENEER);
      if (b < m.n - 1) out += rect(bx + m.bay * k, top + T, m.rt * k, rh, 0.3, VENEER);
      bx += (m.bay + m.rt) * k;
    }
    out += rect(ox, top, W, T, 0.2, 'none', DASH);
    var cx = [ox, ox + ta, rx0, rx0 + m.rt * k], cv = [m.ta, m.d, m.rt];
    var p = rx0 + m.rt * k;
    for (var q = 0; q < m.n; q++) { cx.push(p += m.bay * k); cv.push(n2(m.bay)); if (q < m.n - 1) { cx.push(p += m.rt * k); cv.push(m.rt); } }
    cx.push(p += m.rt * k); cv.push(m.rt); cx.push(p += m.d * k); cv.push(m.d); cx.push(ox + W); cv.push(m.ta);
    out += hChain(cx, cv, top - 4, top);
    var bt0 = top + T + rh - (s.drawers.box.raise || 0) * k - s.drawers.box.height * k;
    out += vChain([top + T, bt0, bt0 + s.drawers.box.height * k, top + T + rh], [n2(m.rh - s.drawers.box.height - (s.drawers.box.raise || 0)), s.drawers.box.height, s.drawers.box.raise || 0], ox - 5, ox);
    out += vChain([top, top + T, fy, ab, oy], [m.T, n2(m.rh), m.wave, n2(m.legH - m.A)], ox + W + 5, ox + W);
    out += text(ox + W / 2, ab + 4, 'back apron, seen from the front', 1.7, { anchor: 'middle', fill: '#555' });
    return out;
  }
  // side elevation; (ox, oy) = back end at floor level
  function deskSide(s, m, ox, oy) {
    var k = m.k, D = m.D * k, H = m.H * k, T = m.T * k, A = m.A * k, ta = m.ta * k, d = m.d * k, top = oy - H, ab = top + T + A, wd = m.wave * k, out = '';
    out += rect(ox + ta, top + T, d, oy - top - T, 0.3, OAK) + rect(ox + D - ta - d, top + T, d, oy - top - T, 0.3, OAK);
    var edge = m.wave ? wavePath(ox, ox + D, ab, m.flat * k, m.flat * k, arches(m.D - 2 * m.flat, m.pitch), wd) : [[ox, ab], [ox + D, ab]];
    out += poly2([[ox, top + T]].concat(edge).concat([[ox + D, top + T]]), FACE, 0.3);
    out += rect(ox, top, D, T, 0.35, OAK);
    out += hChain([ox, ox + D], [m.D], top - 5, top);
    out += hChain([ox, ox + m.flat * k, ox + D - m.flat * k, ox + D], [m.flat, n2(m.D - 2 * m.flat), m.flat], ab + 4, ab);
    out += vChain([top, top + T, ab, oy], [m.T, m.A, n2(m.legH - m.A)], ox + D + 5, ox + D);
    return out;
  }
  // plan; mode 'top' (client) or 'carcass' (workshop: top off). (ox, oy) = back-left corner
  function deskPlan(s, m, ox, oy, mode) {
    var k = m.k, W = m.W * k, D = m.D * k, ta = m.ta * k, d = m.d * k, rt = m.rt * k, out = '';
    var legs = [[ta + d / 2, ta + d / 2], [W - ta - d / 2, ta + d / 2], [ta + d / 2, D - ta - d / 2], [W - ta - d / 2, D - ta - d / 2]];
    if (mode === 'top') {
      out += rect(ox, oy, W, D, 0.35, OAK);
      legs.forEach(function (p) { out += circle(ox + p[0], oy + p[1], d / 2, 'none', 0.18, DASH); });
      out += hChain([ox, ox + W], [m.W], oy - 5, oy) + vChain([oy, oy + D], [m.D], ox + W + 5, ox + W);
      return out;
    }
    // aprons with mitred corners
    out += poly2([[ox, oy], [ox + W, oy], [ox + W - ta, oy + ta], [ox + ta, oy + ta]], FACE, 0.3);                 // back
    out += poly2([[ox, oy], [ox + ta, oy + ta], [ox + ta, oy + D - ta], [ox, oy + D]], FACE, 0.3);                 // left
    out += poly2([[ox + W, oy], [ox + W, oy + D], [ox + W - ta, oy + D - ta], [ox + W - ta, oy + ta]], FACE, 0.3); // right
    var x = ox;
    for (var i = 0; i < m.n; i++) {                                                                             // faces
      var w = m.fw * k, l0 = i === 0 ? ta : 0, r0 = i === m.n - 1 ? ta : 0;
      out += poly2([[x, oy + D], [x + w, oy + D], [x + w - r0, oy + D - ta], [x + l0, oy + D - ta]], '#d2b48b', 0.3);
      x += w + m.g * k;
    }
    out += rect(ox + ta + d, oy + ta, rt, m.frameIn * k, 0.25, VENEER) + rect(ox + W - ta - d - rt, oy + ta, rt, m.frameIn * k, 0.25, VENEER);     // side rails
    [[ox + ta, oy + ta + d], [ox + ta, oy + D - ta - d - rt], [ox + W - ta - d, oy + ta + d], [ox + W - ta - d, oy + D - ta - d - rt]].forEach(function (b) { out += rect(b[0], b[1], d, rt, 0.25, '#c8aa80'); });   // leg blocks
    legs.forEach(function (p) { out += circle(ox + p[0], oy + p[1], d / 2, OAK, 0.3); });
    var bx = ox + ta + d + rt;
    for (var b = 0; b < m.n; b++) {
      var bz = oy + D - ta - m.boxLen * k;                                                                 // directly behind the drawer face
      out += rect(bx + m.clr * k, bz, m.boxW * k, m.boxLen * k, 0.25, 'none', DASH) + text(bx + m.bay * k / 2, bz + m.boxLen * k / 2, 'drawer ' + (b + 1), 1.8, { anchor: 'middle', fill: '#555' });
      if (b < m.n - 1) out += rect(bx + m.bay * k, oy + ta, rt, m.depthIn * k, 0.25, VENEER);
      bx += (m.bay + m.rt) * k;
    }
    out += text(ox + W - 1, oy - 1.5, '45° mitred corners; each leg in a ' + m.d + ' x ' + m.d + ' opening: aprons, side rail and block', 1.8, { anchor: 'end', fill: '#555' });
    out += hChain([ox, ox + W], [m.W], oy - 9, oy);
    out += hChain([ox, ox + ta, ox + ta + d, ox + ta + d + rt, ox + W - ta - d - rt, ox + W - ta - d, ox + W - ta, ox + W], [m.ta, m.d, m.rt, n2(m.W - 2 * (m.ta + m.d + m.rt)), m.rt, m.d, m.ta], oy - 4, oy);
    out += vChain([oy, oy + ta, oy + ta + d, oy + ta + d + rt, oy + D - ta - d - rt, oy + D - ta - d, oy + D - ta, oy + D], [m.ta, m.d, m.rt, n2(m.D - 2 * (m.ta + m.d + m.rt)), m.rt, m.d, m.ta], ox + W + 5, ox + W);
    out += vChain([oy + D - ta - m.boxLen * k, oy + D - ta], [m.boxLen], ox - 5, ox);
    out += hChain([ox + ta + d + rt + m.clr * k, ox + ta + d + rt + m.clr * k + m.boxW * k], [n2(m.boxW)], oy + D + 5, oy + D);
    return out;
  }
  // one arch of the wave, 1:2; (ox, oy) = start of the arch on the bottom edge
  function deskWave(s, m, ox, oy) {
    var k = 0.5, n = arches(m.fw - m.flat, m.pitch), w = (m.fw - m.flat) / n * k, dd = m.wave * k, out = '';
    var pts = [[ox - 6, oy]].concat(wavePath(ox, ox + w, oy, 0, 0, 1, dd)).concat([[ox + w + 6, oy], [ox + w + 6, oy - dd - 10], [ox - 6, oy - dd - 10]]);
    out += poly2(pts, FACE, 0.3);
    out += hChain([ox, ox + w], [n2(w / k)], oy + 5, oy) + vChain([oy - dd, oy], [m.wave], ox + w + 10, ox + w);
    out += text(ox - 6, oy + 11, 'waves: ' + n + ' per face, ' + arches(m.D - 2 * m.flat, m.pitch) + ' per side; flat ' + m.flat + ' at each corner', 1.8, { fill: '#555' });
    out += text(ox - 6, oy + 14, 'rounded up and down (no points)', 1.8, { fill: '#555' });
    return out;
  }
  function deskIso(s, m, bx, by, bw, bh) {
    var c = Math.cos(Math.PI / 6), sn = 0.5, W = m.W, D = m.D, H = m.H;
    var spanX = (W + D) * c, spanY = H + (W + D) * sn, sc = Math.min(bw / spanX, bh / spanY);
    var cx = bx + (bw - spanX * sc) / 2 + D * c * sc, cy = by + (bh - spanY * sc) / 2 + H * sc;
    function P(x, y, z) { return [cx + (x * c - z * c) * sc, cy - y * sc + (x * sn + z * sn) * sc]; }
    function poly(pts, fill) { return poly2(pts, fill, 0.3); }
    var out = '', r = m.d / 2, rx = r * Math.SQRT2 * c * sc, ry = r * Math.SQRT2 * sn * sc, y0 = H - m.T - m.A;
    function leg(x, z) { var b = P(x, 0, z), t = P(x, H - m.T, z); return '<path d="M' + n2(t[0] - rx) + ',' + n2(t[1]) + ' L' + n2(b[0] - rx) + ',' + n2(b[1]) + ' A' + n2(rx) + ' ' + n2(ry) + ' 0 0 0 ' + n2(b[0] + rx) + ',' + n2(b[1]) + ' L' + n2(t[0] + rx) + ',' + n2(t[1]) + ' Z" fill="#c4a378" stroke="#111" stroke-width="0.25"/>'; }
    var i0 = m.ta + r;
    out += leg(i0, i0);
    // apron box: front (z = D) and right side (x = W) faces, with the wave
    function waveFace(len, n, map) {
      var pts = [], a = m.flat, b = len - m.flat, w = (b - a) / n;
      pts.push(map(0, H - m.T)); pts.push(map(0, y0)); pts.push(map(a, y0));
      for (var i = 0; i < n; i++) for (var j = 1; j <= 16; j++) { var u = j / 16; pts.push(map(a + (i + u) * w, y0 + m.wave * (1 - Math.cos(2 * Math.PI * u)) / 2)); }
      pts.push(map(len, y0)); pts.push(map(len, H - m.T));
      return pts;
    }
    out += leg(W - i0, i0) + leg(i0, D - i0) + leg(W - i0, D - i0);
    out += poly(waveFace(D, arches(D - 2 * m.flat, m.pitch), function (z, y) { return P(W, y, D - z); }), '#b8956a');
    out += poly(waveFace(W, Math.max(1, m.n * arches(m.fw - m.flat, m.pitch)), function (x, y) { return P(x, y, D); }), '#d2b48b');
    for (var f = 1; f < m.n; f++) { var gx = f * (m.fw + m.g) - m.g / 2; out += line(P(gx, H - m.T, D)[0], P(gx, H - m.T, D)[1], P(gx, y0, D)[0], P(gx, y0, D)[1], 0.3); }
    out += poly([P(0, H, 0), P(W, H, 0), P(W, H, D), P(0, H, D)], '#d6b88f') + poly([P(0, H - m.T, D), P(W, H - m.T, D), P(W, H, D), P(0, H, D)], '#c4a378') + poly([P(W, H - m.T, D), P(W, H - m.T, 0), P(W, H, 0), P(W, H, D)], '#b8956a');
    var tT = P(W * 0.4, H, D * 0.4), tF = P(W * 0.25, y0 + m.A * 0.6, D), tL = P(i0, (H - m.T - m.A) * 0.4, D - i0);
    out += tag(tT[0], tT[1], s.top.code) + tag(tF[0], tF[1], s.faces.code) + tag(tL[0] - 5, tL[1], s.legs.code);
    return out;
  }
  TEMPLATES.desk = {
    build: buildDesk,
    clientViews: function (s, m) {
      var k = m.k, W = m.W * k, D = m.D * k, sx = 24 + W + 26;
      return deskFront(s, m, 24, 104, false) + viewTitle(24, 118, 1, 'FRONT VIEW', m.scale) +
        deskSide(s, m, sx, 104) + viewTitle(sx, 118, 2, 'SIDE VIEW', m.scale) +
        deskPlan(s, m, 24, 136, 'top') + viewTitle(24, 212, 3, 'TOP VIEW', m.scale) +
        deskIso(s, m, Math.max(sx - 10, 24 + W + 14), 128, 316 - Math.max(sx - 10, 24 + W + 14), 76) + viewTitle(Math.max(sx - 10, 24 + W + 14), 212, 4, '3D VIEW', 'not to scale');
    },
    workshopViews: function (s, m) {
      var k = m.k, W = m.W * k;
      return deskFront(s, m, 24, 104, true) + viewTitle(24, 118, 1, 'CARCASS FRONT (faces off)', m.scale) +
        deskPlan(s, m, 24, 134, 'carcass') + viewTitle(24 + W + 16, 196, 2, 'CARCASS PLAN (top off)', m.scale) +
        deskWave(s, m, 24 + W + 30, 60) + viewTitle(24 + W + 24, 118, 3, 'WAVE DETAIL', '1:2');
    }
  };
  // ================================================================ template: chair =========
  // Upholstered dining chair on a T-frame (from AOC1574 Jess Dining Chair). Frame, all solid:
  // two front legs (rounded ends in plan) with a front rail between them at seat height; a spine
  // from the front rail back to two back posts (a gap between them), all the way up; spacer
  // blocks housed between the posts. Upholstery: a seat pad (trapezoid, rounded corners) on the
  // frame and an oval back pad on the front of the posts, each a CNC-cut base board + foam + fabric.
  function roundedPoly(pts, r, steps) {                // convex polygon (clockwise on paper) with every corner rounded r
    var n = pts.length, lines = [];
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = dy / L, ny = -dx / L;
      lines.push({ p: [a[0] - nx * r, a[1] - ny * r], d: [dx / L, dy / L], n: [nx, ny] });             // edge moved in by r
    }
    function meet(l1, l2) { var den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0], t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den; return [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t]; }
    var out = [];
    for (var j = 0; j < n; j++) {
      var prev = lines[(j + n - 1) % n], cur = lines[j], c = meet(prev, cur);
      var a0 = Math.atan2(prev.n[1], prev.n[0]), a1 = Math.atan2(cur.n[1], cur.n[0]);
      while (a1 < a0) a1 += 2 * Math.PI;
      for (var s = 0; s <= (steps || 8); s++) { var t = a0 + (a1 - a0) * s / (steps || 8); out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
    }
    return out;
  }
  function ellipsePts(cx, cy, rx, ry, n) { var p = []; for (var i = 0; i < (n || 48); i++) { var t = i / (n || 48) * 2 * Math.PI; p.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return p; }
  function areaOf(pts) { var a = 0; for (var i = 0; i < pts.length; i++) { var p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
  function perimOf(pts) { var p = 0; for (var i = 0; i < pts.length; i++) { var q = pts[(i + 1) % pts.length]; p += Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]); } return p; }
  function buildChair(s) {
    var fr = s.frame, W = s.width, H = s.height, lg = s.frontLegs, bp = s.backPosts, rl = s.rails, bl = s.blocks, st = s.seat, bk = s.back, up = s.upholstery;
    var lw = lg.width, ld = lg.depth, lh = lg.height, rh = rl.height, rt = rl.thickness, pw = bp.width, pt = bp.thickness, gap = bp.gap;
    var D = s.depth, postsW = 2 * pw + gap, railLen = W - 2 * lw, railZ = D - ld + (ld - rt) / 2, spineLen = railZ - pt;
    var seatTop = lh + st.thickness, backBottom = seatTop + bk.gap, overall = Math.max(H, backBottom + bk.height);
    if (postsW > W) throw new Error('The back posts (' + postsW + ' across) are wider than the chair (' + W + ')');
    if (spineLen < 100) throw new Error('The chair is too shallow for the spine: ' + Math.round(spineLen) + ' between the posts and the front rail');
    if (rh > lh) throw new Error('The rails are taller than the front legs');
    if (backBottom + 50 > H + bk.height) throw new Error('The back pad sits above the top of the posts');
    // seat outline in plan (x across, z from the back of the posts), corners rounded
    var sx0 = (W - st.backWidth) / 2, sx1 = (W - st.frontWidth) / 2, z0 = pt, z1 = pt + st.depth;
    var seatPts = roundedPoly([[sx0, z0], [sx0 + st.backWidth, z0], [sx1 + st.frontWidth, z1], [sx1, z1]], st.cornerRadius || 0, 8);
    var backPts = ellipsePts(0, 0, bk.width / 2, bk.height / 2, 64);
    var seatA = areaOf(seatPts), seatP = perimOf(seatPts), backA = areaOf(backPts), backP = perimOf(backPts), wrap = up.wrap == null ? 50 : up.wrap, waste = 1 + (up.waste == null ? 15 : up.waste) / 100;
    var parts = [];
    function part(name, qty, l, w, th, mat, note, unit) { parts.push({ name: name, qty: qty, length: l, width: w, thickness: th, code: mat.code, material: mat.material, edge: '', edgeLen: 0, note: note || '', unit: unit }); }
    part('Front leg', 2, lh, ld, lw, lg, 'ends rounded R' + n2(lw / 2) + ' in plan');
    part('Back post', 2, H, pw, pt, bp, 'ends rounded R' + n2(pt / 2) + ' in plan; ' + gap + ' apart');
    part('Front rail', 1, railLen, rh, rt, rl, 'between the front legs, top flush with the legs; + tenons');
    part('Spine', 1, n2(spineLen), rh, rt, rl, 'front rail to the back posts, at seat height; + tenons');
    part('Post block', (bl.at || []).length, bl.width, bl.height, pt, bl, 'housed between the posts at ' + (bl.at || []).join(', ') + ' from the floor');
    var M = CNC_MARGIN;
    part('Seat base (CNC blank)', 1, Math.max(st.frontWidth, st.backWidth) + M, st.depth + M, up.base.thickness, up.base, 'CNC to the seat outline (+' + M + ' to clamp)');
    part('Back base (CNC blank)', 1, bk.width + M, bk.height + M, up.base.thickness, up.base, 'CNC oval ' + bk.width + ' x ' + bk.height + ' (+' + M + ' to clamp)');
    var foamT = up.foam.thickness;
    parts.push({ name: 'Seat foam', qty: 1, length: Math.max(st.frontWidth, st.backWidth), width: st.depth, thickness: foamT, code: up.foam.code, material: up.foam.material, edge: '', edgeLen: 0, note: 'cut to the seat outline' });
    parts.push({ name: 'Back foam', qty: 1, length: bk.width, width: bk.height, thickness: foamT, code: up.foam.code, material: up.foam.material, edge: '', edgeLen: 0, note: 'cut to the oval' });
    var fabSeat = (seatA + seatP * (st.thickness + 2 * wrap)) * waste, fabBack = (2 * backA + backP * (bk.thickness + 2 * wrap)) * waste;
    var totals = totalsOf(parts.filter(function (p) { return p.code !== up.fabric.code; }));
    totals.push({ code: up.fabric.code, material: up.fabric.material, unit: 'm²', amount: (fabSeat + fabBack) / 1e6 });
    totals.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    var den = pickScale(function (k) { return overall * k <= 130 && Math.max(W, st.frontWidth, bk.width) * k <= 76 && Math.max(D, pt + st.depth) * k <= 80; });
    return { scale: '1:' + den, k: 1 / den, materials: materialsOf([fr, lg, bp, rl, bl, up.base, up.foam, up.fabric]), W: W, D: D, H: H, oh: overall, lw: lw, ld: ld, lh: lh, rh: rh, rt: rt,
      pw: pw, pt: pt, gap: gap, postsW: postsW, railLen: railLen, railZ: railZ, spineLen: spineLen, seatTop: seatTop, backBottom: backBottom, seatPts: seatPts, z1: z1,
      fabSeat: fabSeat, fabBack: fabBack, parts: parts, hardware: [], totals: totals, overall: { width: Math.max(W, st.frontWidth, bk.width), depth: Math.max(D, z1), height: overall } };
  }
  var FABRIC = '#b9c29a', FABRIC_D = '#a3ad84';
  // back cushion seen from the side: flat against the posts (x), rounded on the front face (x + w)
  function backShape(x, y, w, h, r) {
    r = Math.min(r, w, h / 2);
    return '<path d="M' + n2(x) + ',' + n2(y) + ' L' + n2(x + w - r) + ',' + n2(y) + ' A' + n2(r) + ' ' + n2(r) + ' 0 0 1 ' + n2(x + w) + ',' + n2(y + r) +
      ' L' + n2(x + w) + ',' + n2(y + h - r) + ' A' + n2(r) + ' ' + n2(r) + ' 0 0 1 ' + n2(x + w - r) + ',' + n2(y + h) + ' L' + n2(x) + ',' + n2(y + h) + ' Z" fill="' + FABRIC + '" stroke="#111" stroke-width="0.35"/>';
  }
  // seat cushion in elevation: rounded along the top edge, straight sides down to a flat bottom
  function seatShape(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return '<path d="M' + n2(x) + ',' + n2(y + h) + ' L' + n2(x) + ',' + n2(y + r) + ' A' + n2(r) + ' ' + n2(r) + ' 0 0 1 ' + n2(x + r) + ',' + n2(y) +
      ' L' + n2(x + w - r) + ',' + n2(y) + ' A' + n2(r) + ' ' + n2(r) + ' 0 0 1 ' + n2(x + w) + ',' + n2(y + r) + ' L' + n2(x + w) + ',' + n2(y + h) + ' Z" fill="' + FABRIC + '" stroke="#111" stroke-width="0.35"/>';
  }
  // front (client: with upholstery; workshop: frame only); (ox, oy) = left edge of the frame at floor level
  function chairFront(s, m, ox, oy, upholstery) {
    var k = m.k, W = m.W * k, cx = ox + W / 2, out = '', st = s.seat, bk = s.back;
    var pl = cx - m.postsW * k / 2;
    out += rect(pl, oy - m.H * k, m.pw * k, m.H * k, 0.3, OAK) + rect(pl + (m.pw + m.gap) * k, oy - m.H * k, m.pw * k, m.H * k, 0.3, OAK);
    (s.blocks.at || []).forEach(function (y) { out += rect(cx - s.blocks.width * k / 2, oy - (y + s.blocks.height) * k, s.blocks.width * k, s.blocks.height * k, 0.25, '#b08a5c'); });
    out += rect(ox, oy - m.lh * k, m.lw * k, m.lh * k, 0.3, OAK) + rect(ox + W - m.lw * k, oy - m.lh * k, m.lw * k, m.lh * k, 0.3, OAK);
    out += rect(ox + m.lw * k, oy - m.lh * k, m.railLen * k, m.rh * k, 0.3, FACE);
    if (upholstery) {
      var sw = st.frontWidth * k, sy = oy - m.seatTop * k;
      out += seatShape(cx - sw / 2, sy, sw, st.thickness * k, st.thickness * k / 2);
      out += '<ellipse cx="' + n2(cx) + '" cy="' + n2(oy - (m.backBottom + bk.height / 2) * k) + '" rx="' + n2(bk.width * k / 2) + '" ry="' + n2(bk.height * k / 2) + '" fill="' + FABRIC + '" stroke="#111" stroke-width="0.35"/>';
      out += hChain([cx - bk.width * k / 2, cx + bk.width * k / 2], [bk.width], oy - m.oh * k - 5, oy - m.oh * k);
      out += hChain([cx - sw / 2, cx + sw / 2], [st.frontWidth], sy + st.thickness * k + 4, sy + st.thickness * k);
      var half = Math.max(m.W, st.frontWidth, bk.width) * k / 2;
      out += vChain([oy - m.oh * k, oy - m.backBottom * k, oy - m.seatTop * k, oy - m.lh * k, oy], [bk.height, bk.gap, st.thickness, m.lh], cx - half - 6, cx - half);
      out += vChain([oy - m.oh * k, oy], [m.oh], cx + half + 6, cx + half);
      return out;
    }
    out += hChain([ox, ox + m.lw * k, ox + W - m.lw * k, ox + W], [m.lw, m.railLen, m.lw], oy - m.lh * k - 4, oy - m.lh * k);
    out += hChain([pl, pl + m.pw * k, pl + (m.pw + m.gap) * k, pl + m.postsW * k], [m.pw, m.gap, m.pw], oy - m.H * k - 4, oy - m.H * k);
    var ys = [oy - m.H * k], vs = [], last = m.H;
    (s.blocks.at || []).slice().sort(function (a, b) { return b - a; }).forEach(function (y) { var t = y + s.blocks.height; ys.push(oy - t * k); vs.push(n2(last - t)); ys.push(oy - y * k); vs.push(s.blocks.height); last = y; });
    ys.push(oy); vs.push(last);
    out += vChain(ys, vs, ox + W + 6, ox + W) + vChain([oy - m.H * k, oy], [m.H], ox + W + 14, ox + W);
    out += vChain([oy - m.lh * k, oy - (m.lh - m.rh) * k, oy], [m.rh, m.lh - m.rh], ox - 6, ox);
    return out;
  }
  // side; (ox, oy) = back of the posts at floor level, front to the right
  function chairSide(s, m, ox, oy, upholstery) {
    var k = m.k, D = m.D * k, out = '', st = s.seat, bk = s.back;
    out += rect(ox, oy - m.H * k, m.pt * k, m.H * k, 0.3, OAK);
    out += rect(ox + m.pt * k, oy - m.lh * k, m.spineLen * k, m.rh * k, 0.3, FACE);
    out += rect(ox + D - m.ld * k, oy - m.lh * k, m.ld * k, m.lh * k, 0.3, OAK);
    out += rect(ox + m.railZ * k, oy - m.lh * k, m.rt * k, m.rh * k, 0.15, 'none', DASH);
    if (upholstery) {
      out += seatShape(ox + m.pt * k, oy - m.seatTop * k, st.depth * k, st.thickness * k, st.thickness * k / 2);
      out += backShape(ox + m.pt * k, oy - (m.backBottom + bk.height) * k, bk.thickness * k, bk.height * k, bk.thickness * k / 2);
      out += hChain([ox + m.pt * k, ox + (m.pt + st.depth) * k], [st.depth], oy - m.seatTop * k - 4, oy - m.seatTop * k);
      out += hChain([ox + m.pt * k, ox + (m.pt + bk.thickness) * k], [bk.thickness], oy - m.oh * k - 4, oy - m.oh * k);
      out += vChain([oy - m.seatTop * k, oy], [m.seatTop], ox + Math.max(D, (m.pt + st.depth) * k) + 6, ox + D);
      return out;
    }
    out += hChain([ox, ox + D], [m.D], oy - m.H * k - 9, oy - m.H * k);
    out += hChain([ox, ox + m.pt * k, ox + m.railZ * k, ox + (m.railZ + m.rt) * k, ox + D], [m.pt, n2(m.spineLen), m.rt, n2(m.D - m.railZ - m.rt)], oy - m.H * k - 4, oy - m.H * k);
    out += vChain([oy - m.lh * k, oy], [m.lh], ox + D + 6, ox + D);
    return out;
  }
  // plan; mode 'seat' (client: seat outline over the frame) or 'frame'. (ox, oy) = back-left of the frame
  function chairPlan(s, m, ox, oy, mode) {
    var k = m.k, W = m.W * k, cx = ox + W / 2, out = '';
    function pill(x, y, w, h) { var r = Math.min(w, h) / 2; return '<rect x="' + n2(x) + '" y="' + n2(y) + '" width="' + n2(w) + '" height="' + n2(h) + '" rx="' + n2(r) + '" fill="' + OAK + '" stroke="#111" stroke-width="0.3"/>'; }
    var pl = cx - m.postsW * k / 2;
    var frame = pill(pl, oy, m.pw * k, m.pt * k) + pill(pl + (m.pw + m.gap) * k, oy, m.pw * k, m.pt * k) +
      rect(cx - m.rt * k / 2, oy + m.pt * k, m.rt * k, m.spineLen * k, 0.3, FACE) +
      rect(ox + m.lw * k, oy + m.railZ * k, m.railLen * k, m.rt * k, 0.3, FACE) +
      pill(ox, oy + (m.D - m.ld) * k, m.lw * k, m.ld * k) + pill(ox + W - m.lw * k, oy + (m.D - m.ld) * k, m.lw * k, m.ld * k);
    if (mode === 'seat') {
      out += frame + poly2(m.seatPts.map(function (p) { return [ox + p[0] * k, oy + p[1] * k]; }), FABRIC, 0.35, ' fill-opacity="0.85"');
      out += hChain([ox + (m.W - s.seat.backWidth) / 2 * k, ox + (m.W + s.seat.backWidth) / 2 * k], [s.seat.backWidth], oy - 4, oy);
      out += hChain([ox + (m.W - s.seat.frontWidth) / 2 * k, ox + (m.W + s.seat.frontWidth) / 2 * k], [s.seat.frontWidth], oy + m.z1 * k + 5, oy + m.z1 * k);
      out += vChain([oy + m.pt * k, oy + m.z1 * k], [s.seat.depth], ox + Math.max(W, s.seat.frontWidth * k) + 4, ox + W);
      out += text(cx, oy + (m.pt + s.seat.depth / 2) * k, 'seat R' + (s.seat.cornerRadius || 0) + ' corners', 1.7, { anchor: 'middle', fill: '#333' });
      return out;
    }
    out += frame;
    out += hChain([ox, ox + m.lw * k, ox + W / 2 - m.rt * k / 2, ox + W / 2 + m.rt * k / 2, ox + W - m.lw * k, ox + W], [m.lw, n2((m.W - m.rt) / 2 - m.lw), m.rt, n2((m.W - m.rt) / 2 - m.lw), m.lw], oy + m.D * k + 5, oy + m.D * k);
    out += hChain([pl, pl + m.pw * k, pl + (m.pw + m.gap) * k, pl + m.postsW * k], [m.pw, m.gap, m.pw], oy - 4, oy);
    out += vChain([oy, oy + m.pt * k, oy + m.railZ * k, oy + (m.railZ + m.rt) * k, oy + m.D * k], [m.pt, n2(m.spineLen), m.rt, n2(m.D - m.railZ - m.rt)], ox - 5, ox);
    out += vChain([oy, oy + m.D * k], [m.D], ox + W + 5, ox + W);
    return out;
  }
  // upholstery templates: seat and back outlines with sizes (workshop)
  function chairPads(s, m, ox, oy, k) {
    var out = '', st = s.seat, bk = s.back, ww = Math.max(st.frontWidth, st.backWidth);
    var off = (ww - m.W) / 2;
    out += poly2(m.seatPts.map(function (p) { return [ox + (p[0] + off) * k, oy + (p[1] - m.pt) * k]; }), FABRIC, 0.3);
    out += hChain([ox + (ww - st.backWidth) / 2 * k, ox + (ww + st.backWidth) / 2 * k], [st.backWidth], oy - 4, oy);
    out += hChain([ox, ox + ww * k], [st.frontWidth], oy + st.depth * k + 5, oy + st.depth * k) + vChain([oy, oy + st.depth * k], [st.depth], ox + ww * k + 5, ox + ww * k);
    out += text(ox + ww * k / 2, oy + st.depth * k / 2, 'seat, R' + (st.cornerRadius || 0), 1.7, { anchor: 'middle' });
    var bx = ox + ww * k + 14, by = oy;
    out += '<ellipse cx="' + n2(bx + bk.width * k / 2) + '" cy="' + n2(by + bk.height * k / 2) + '" rx="' + n2(bk.width * k / 2) + '" ry="' + n2(bk.height * k / 2) + '" fill="' + FABRIC + '" stroke="#111" stroke-width="0.3"/>';
    out += hChain([bx, bx + bk.width * k], [bk.width], by - 4, by) + vChain([by, by + bk.height * k], [bk.height], bx + bk.width * k + 5, bx + bk.width * k);
    out += text(bx + bk.width * k / 2, by + bk.height * k / 2, 'back', 1.7, { anchor: 'middle' });
    return out;
  }
  function chairPadNotes(s, m, ox, oy) {
    var st = s.seat, bk = s.back, out = '';
    out += text(ox, oy, 'Each pad: ' + s.upholstery.base.thickness + ' base board (CNC) + ' + s.upholstery.foam.thickness + ' foam + fabric. Seat ' + st.thickness + ', back ' + bk.thickness + ' thick finished.', 1.8, { fill: '#444' });
    out += text(ox, oy + 3.5, 'Fabric about ' + n2(m.fabSeat / 1e6) + ' m² seat + ' + n2(m.fabBack / 1e6) + ' m² back (incl. ' + (s.upholstery.wrap == null ? 50 : s.upholstery.wrap) + ' wrap, ' + (s.upholstery.waste == null ? 15 : s.upholstery.waste) + '% waste).', 1.8, { fill: '#444' });
    return out;
  }
  function chairIso(s, m, bx, by, bw, bh) {
    var c = Math.cos(Math.PI / 6), sn = 0.5, W = Math.max(m.W, s.seat.frontWidth), D = Math.max(m.D, m.z1), H = m.oh, x0 = (W - m.W) / 2;
    var spanX = (W + D) * c, spanY = H + (W + D) * sn, sc = Math.min(bw / spanX, bh / spanY);
    var cx = bx + (bw - spanX * sc) / 2 + D * c * sc, cy = by + (bh - spanY * sc) / 2 + H * sc;
    function P(x, y, z) { x += x0; return [cx + (x * c - z * c) * sc, cy - y * sc + (x * sn + z * sn) * sc]; }
    function prism(pts2, y0, y1, fill, top) {          // pts2 = [[x, z]...] plan outline, extruded y0..y1
      var all = []; pts2.forEach(function (p) { all.push(P(p[0], y0, p[1])); all.push(P(p[0], y1, p[1])); });
      return poly2(hull(all), fill, 0.3) + poly2(pts2.map(function (p) { return P(p[0], y1, p[1]); }), top || fill, 0.3);
    }
    function inset(pts, dd) {
      var c0 = pts.reduce(function (a, p) { return [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length]; }, [0, 0]);
      return pts.map(function (p) { var dx = p[0] - c0[0], dy = p[1] - c0[1], L = Math.hypot(dx, dy) || 1; return [c0[0] + dx * (1 - dd / L), c0[1] + dy * (1 - dd / L)]; });
    }
    function cushion(pts2, y0, y1, r) {               // flat cushion in plan, edges rounded r
      var ym = (y0 + y1) / 2, all = [];
      [[0, 0], [0.5, 0], [0.8, r * 0.4], [1, r]].forEach(function (q) {
        inset(pts2, q[1]).forEach(function (p) { all.push(P(p[0], y0 + (y1 - y0) * q[0], p[1])); });
      });
      var top = inset(pts2, r).map(function (p) { return P(p[0], y1, p[1]); });
      return poly2(hull(all), FABRIC_D, 0.3) + '<path d="M' + top.map(function (q) { return n2(q[0]) + ',' + n2(q[1]); }).join(' L') + ' Z" fill="' + FABRIC + '" stroke="none"/>';
    }
    function box(x0b, x1b, y0, y1, z0, z1, fill) { return prism([[x0b, z0], [x1b, z0], [x1b, z1], [x0b, z1]], y0, y1, fill, '#d6b88f'); }
    var out = '', pl = m.W / 2 - m.postsW / 2, st = s.seat, bk = s.back;
    out += box(pl, pl + m.pw, 0, m.H, 0, m.pt, '#c4a378') + box(pl + m.pw + m.gap, pl + m.postsW, 0, m.H, 0, m.pt, '#c4a378');
    // back pad: oval in the x-y plane, in front of the posts
    var bcx = m.W / 2, bcy = m.backBottom + bk.height / 2, rr = bk.thickness / 2, all = [], face = [];
    for (var i = 0; i < 48; i++) {
      var t = i / 48 * 2 * Math.PI, ct = Math.cos(t), stt = Math.sin(t);
      [[0, 0], [0.5, 0], [0.8, rr * 0.4], [1, rr]].forEach(function (q) { all.push(P(bcx + (bk.width / 2 - q[1]) * ct, bcy + (bk.height / 2 - q[1]) * stt, m.pt + bk.thickness * q[0])); });
      face.push(P(bcx + (bk.width / 2 - rr) * ct, bcy + (bk.height / 2 - rr) * stt, m.pt + bk.thickness));
    }
    out += poly2(hull(all), FABRIC_D, 0.3) + '<path d="M' + face.map(function (q) { return n2(q[0]) + ',' + n2(q[1]); }).join(' L') + ' Z" fill="' + FABRIC + '" stroke="none"/>';
    out += box(m.W / 2 - m.rt / 2, m.W / 2 + m.rt / 2, m.lh - m.rh, m.lh, m.pt, m.railZ, '#c4a378');
    out += box(m.lw, m.W - m.lw, m.lh - m.rh, m.lh, m.railZ, m.railZ + m.rt, '#c4a378');
    out += box(0, m.lw, 0, m.lh, m.D - m.ld, m.D, '#c4a378') + box(m.W - m.lw, m.W, 0, m.lh, m.D - m.ld, m.D, '#c4a378');
    out += cushion(m.seatPts, m.lh, m.seatTop, st.thickness / 2);
    var tS = P(m.W / 2, m.seatTop, m.pt + st.depth * 0.5), tB = P(m.W / 2, bcy, m.pt + bk.thickness), tL = P(m.W - m.lw / 2, m.lh * 0.4, m.D);
    out += tag(tS[0], tS[1], s.upholstery.fabric.code) + tag(tB[0], tB[1], s.upholstery.fabric.code) + tag(tL[0] + 5, tL[1], s.frontLegs.code);
    return out;
  }
  TEMPLATES.chair = {
    build: buildChair,
    // laid out to fill the sheet: front + side large on the left, top view and 3D stacked on the right
    clientViews: function (s, m) {
      var k = m.k, w = Math.max(m.W, s.seat.frontWidth, s.back.width) * k, ox = 34 + (w - m.W * k) / 2, oy = 32 + m.oh * k + 8;
      var sx = 34 + w + 30, sd = Math.max(m.D, m.pt + s.seat.depth) * k, rx = sx + sd + 24, rw = 318 - rx;
      return chairFront(s, m, ox, oy, true) + viewTitle(24, oy + 14, 1, 'FRONT VIEW', m.scale) +
        chairSide(s, m, sx, oy, true) + viewTitle(sx - 6, oy + 14, 2, 'SIDE VIEW', m.scale) +
        chairPlan(s, m, rx + (rw - w) / 2 + (w - m.W * k) / 2, 30, 'seat') + viewTitle(rx, 30 + sd + 16, 3, 'TOP VIEW', m.scale) +
        chairIso(s, m, rx - 6, 30 + sd + 26, rw + 10, 210 - (30 + sd + 26)) + viewTitle(rx, 222, 4, '3D VIEW', 'not to scale');
    },
    workshopViews: function (s, m) {
      var k = m.k, oy = 30 + m.H * k + 6, sx = 34 + m.W * k + 30, px = sx + m.D * k + 30, pk = 0.1;
      return chairFront(s, m, 34, oy, false) + viewTitle(24, oy + 12, 1, 'FRAME FRONT', m.scale) +
        chairSide(s, m, sx, oy, false) + viewTitle(sx - 6, oy + 12, 2, 'FRAME SIDE', m.scale) +
        chairPlan(s, m, px, 30, 'frame') + viewTitle(px - 6, 30 + m.D * k + 14, 3, 'FRAME PLAN', m.scale) +
        chairPads(s, m, Math.min(px - 8, 206), 30 + m.D * k + 30, pk) + viewTitle(px - 14, 203, 4, 'UPHOLSTERY PADS', '1:10') +
        chairPadNotes(s, m, 24, oy + 22);
    }
  };
  // ================================================================ template: freeform ======
  // Free-form table base (from Begin Interiors coffee table base): an organic sub-base (CNC MDF)
  // on curved blade legs that follow its edge and taper towards the floor. Shapes:
  //  - 'pebble': an egg-like oval, width x length, `egg` = how much fuller one end is;
  //  - 'kidney': the same oval bent sideways by `bow` (concave on the left), so the overall
  //    width is width + bow (e.g. 427 + 88).
  // Each leg: `at` = where its middle sits around the edge (0 = top, 0.25 = right, 0.5 = bottom,
  // 0.75 = left, clockwise), `inset` = from the edge to the leg's outer face, `length` = along
  // the leg (plan). Legs run from the floor to the underside of the sub-base; an optional top
  // sits on the sub-base (thickness 0 = base only).
  function freeOutline(sh, steps) {
    var W = sh.width, L = sh.length, e = sh.egg == null ? 0.12 : sh.egg, bow = sh.type === 'kidney' ? (sh.bow || 0) : 0, N = steps || 180, pts = [];
    if (sh.type === 'kidney') {                    // a bean: a band `width` wide along an arc bowed `bow`, round ends
      var c = L - W, r = W / 2, R = bow ? (c * c / 4 + bow * bow) / (2 * bow) : 1e9, half = Math.asin(Math.min(1, c / 2 / R)), cx0 = -R + bow, M = 60;
      function cen(a) { return [cx0 + R * Math.cos(a), R * Math.sin(a)]; }   // centre line, bulging right (x up to `bow`)
      var outer = [], inner = [];
      for (var q = 0; q <= M; q++) { var a = -half + 2 * half * q / M, cc = cen(a), nx = Math.cos(a), ny = Math.sin(a); outer.push([cc[0] + nx * r, cc[1] + ny * r]); inner.push([cc[0] - nx * r, cc[1] - ny * r]); }
      var capB = [], capT = [], cb = cen(half), ct = cen(-half);
      for (var q2 = 1; q2 < 20; q2++) { var b = half + Math.PI * q2 / 20; capB.push([cb[0] + r * Math.cos(b), cb[1] + r * Math.sin(b)]); var b2 = -half + Math.PI + Math.PI * q2 / 20; capT.push([ct[0] + r * Math.cos(b2), ct[1] + r * Math.sin(b2)]); }
      pts = outer.concat(capB).concat(inner.reverse()).concat(capT);
      var mnX = Math.min.apply(null, pts.map(function (p) { return p[0]; })), mnY = Math.min.apply(null, pts.map(function (p) { return p[1]; }));
      return pts.map(function (p) { return [p[0] - mnX, p[1] - mnY]; });
    }
    for (var i = 0; i < N; i++) {
      var t = -Math.PI / 2 + i / N * 2 * Math.PI, ct = Math.cos(t), st = Math.sin(t);
      var nr = sh.roundness || 2.6, sp = function (v) { return (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), 2 / nr); };   // fuller than an ellipse (superellipse)
      var x = W / 2 * sp(ct) * (1 + e * st), y = L / 2 * sp(st);
      x += bow * (1 - Math.pow(2 * y / L, 2));                     // bend: the middle moves right by `bow`
      pts.push([x, y]);
    }
    var minX = Math.min.apply(null, pts.map(function (p) { return p[0]; })), maxX = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
    var minY = Math.min.apply(null, pts.map(function (p) { return p[1]; })), maxY = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    var sx = (W + bow) / (maxX - minX), sy = L / (maxY - minY);
    return pts.map(function (p) { return [(p[0] - minX) * sx, (p[1] - minY) * sy]; });
  }
  function freeNormals(pts) {                // inward unit normals (outline runs clockwise on paper)
    return pts.map(function (p, i) {
      var a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [-dy / L, dx / L];
    });
  }
  // a leg's centre line: a shallow arc, `length` long, parallel to the edge at position `at`, its
  // middle (inset + t/2) in from the edge, bowed `curve` mm towards the edge (it follows the shape)
  function freeLegLine(pts, nrm, leg, t) {
    // where the leg sits: the edge point in direction `at` from the middle of the shape (0 top, 0.25 right, 0.5 bottom, 0.75 left)
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var mx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, my = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var th = -Math.PI / 2 + (((leg.at % 1) + 1) % 1) * 2 * Math.PI, best = -1, bi = 0;
    pts.forEach(function (p, i) { var dx = p[0] - mx, dy = p[1] - my, d = Math.hypot(dx, dy) || 1, sc = (dx * Math.cos(th) + dy * Math.sin(th)) / d; if (sc > best + 1e-9 || (Math.abs(sc - best) < 1e-9 && d > Math.hypot(pts[bi][0] - mx, pts[bi][1] - my))) { best = sc; bi = i; } });
    var j = bi + 1, E = pts[bi];
    var n = nrm[bi], tx = [-n[1], n[0]], off = leg.inset + t / 2, sag = leg.curve == null ? 25 : leg.curve, out = [];
    for (var q = 0; q <= 24; q++) { var u = q / 12 - 1, x = u * leg.length / 2, d = sag * u * u; out.push([E[0] + n[0] * (off + d) + tx[0] * x, E[1] + n[1] * (off + d) + tx[1] * x]); }
    return out;
  }
  function bandOf(line, t, shrink) {        // plan of a blade: the centre line +- t/2, ends rounded; shrink 0..1 shortens it about its middle
    var n = line.length, mid = (n - 1) / 2, ln = line;
    if (shrink) { var keep = Math.max(2, Math.round((n - 1) * (1 - shrink) / 2)); ln = line.slice(Math.floor(mid - keep), Math.ceil(mid + keep) + 1); }
    var L = [], R = [];
    ln.forEach(function (p, i) {
      var a = ln[Math.max(0, i - 1)], b = ln[Math.min(ln.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
      L.push([p[0] + nx * t / 2, p[1] + ny * t / 2]); R.push([p[0] - nx * t / 2, p[1] - ny * t / 2]);
    });
    // round end: from side p, out past the end of the leg (direction `out`), round to the other side
    function cap(p, c, out) { var o = [], u = [(p[0] - c[0]) / (t / 2), (p[1] - c[1]) / (t / 2)]; for (var k = 1; k < 8; k++) { var f = Math.PI * k / 8; o.push([c[0] + t / 2 * (Math.cos(f) * u[0] + Math.sin(f) * out[0]), c[1] + t / 2 * (Math.cos(f) * u[1] + Math.sin(f) * out[1])]); } return o; }
    function dir(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; }
    var e1 = ln[ln.length - 1], e0 = ln[0];
    var end = cap(L[L.length - 1], e1, dir(ln[ln.length - 2], e1)), start = cap(R[0], e0, dir(ln[1], e0));
    return L.concat(end).concat(R.reverse()).concat(start);
  }
  function chordSag(line) {                 // straight length and curve depth of a leg in plan
    var a = line[0], b = line[line.length - 1], c = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / (c || 1), ny = (b[0] - a[0]) / (c || 1), sag = 0;
    line.forEach(function (p) { sag = Math.max(sag, Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny)); });
    return { chord: c, sag: sag };
  }
  function buildFreeform(s) {
    var sh = s.shape, sb = s.subBase, lg = s.legs, tp = s.top || {}, H = s.height;
    var T = Number(tp.thickness) || 0, St = sb.thickness, legH = H - T - St, t = lg.thickness, taper = lg.taper == null ? 0.2 : lg.taper;
    if (legH <= 50) throw new Error('The height leaves only ' + legH + ' for the legs');
    if (!(sh.width > 100 && sh.length > 100)) throw new Error('The shape needs a width and a length');
    var pts = freeOutline(sh), nrm = freeNormals(pts), W = sh.width + (sh.type === 'kidney' ? (sh.bow || 0) : 0), Lg = sh.length;
    var list = (lg.list || []).slice();
    if (!list.length && lg.clock) {                // the Batten form: clock positions (12 top, 3 right, 6 bottom, 9 left) + lists
      var pick = function (arr, i, d) { arr = typeof arr === 'string' ? arr.split(/[,\s]+/).filter(Boolean).map(Number) : (arr || []); return arr.length ? (arr[i] != null ? arr[i] : arr[arr.length - 1]) : d; };
      var clock = typeof lg.clock === 'string' ? lg.clock.split(/[,\s]+/).filter(Boolean).map(Number) : lg.clock;
      list = clock.map(function (h, i) { return { at: ((h % 12) + 12) % 12 / 12, inset: pick(lg.insets, i, 80), length: pick(lg.lengths, i, 286), curve: pick(lg.curves, i, 25) }; });
    }
    list = list.filter(function (x) { return x && x.length > 0; });
    if (!list.length) throw new Error('Add at least one leg');
    var legs = list.map(function (x, i) {
      var line = freeLegLine(pts, nrm, x, t);
      function inside(p) { var c = false; for (var a = 0, b = pts.length - 1; a < pts.length; b = a++) { var pa = pts[a], pb = pts[b]; if ((pa[1] > p[1]) !== (pb[1] > p[1]) && p[0] < (pb[0] - pa[0]) * (p[1] - pa[1]) / (pb[1] - pa[1]) + pa[0]) c = !c; } return c; }
      bandOf(line, t).forEach(function (p) { if (!inside(p)) throw new Error('Leg ' + (i + 1) + ' runs outside the sub-base: shorter, more inset or moved'); });
      return { line: line, band: bandOf(line, t), bottom: bandOf(line, t, taper), cs: chordSag(line), spec: x };
    });
    var parts = [], M = CNC_MARGIN;
    function part(name, qty, l, w, th, mat, note) { parts.push({ name: name, qty: qty, length: Math.round(l), width: Math.round(w), thickness: th, code: mat.code, material: mat.material, edge: '', edgeLen: 0, note: note || '' }); }
    if (T) part('Top (CNC blank)', 1, Lg + M, W + M, T, tp, 'CNC to the ' + sh.type + ' outline, ' + Math.round(W) + ' x ' + Lg + ' (+' + M + ' to clamp)');
    part('Sub-base (CNC blank)', 1, Lg + M, W + M, St, sb, 'CNC to the ' + sh.type + ' outline, ' + Math.round(W) + ' x ' + Lg + ' (+' + M + ' to clamp)');
    legs.forEach(function (x, i) {
      var blankT = Math.ceil((t + x.cs.sag) / 5) * 5;
      part('Leg ' + (i + 1) + ' (CNC blank)', 1, x.cs.chord + M, legH + M, blankT, lg, 'curved blade ' + x.spec.length + ' long (plan), ' + t + ' thick, ' + Math.round(x.cs.sag) + ' curve following the edge; tapers to ' + Math.round(x.spec.length * (1 - taper)) + ' at the floor; blank ' + blankT + ' thick (glue up)');
    });
    var den = pickScale(function (k) { return Math.max(W, Lg) * k <= 110 && H * k <= 60; });
    return { scale: '1:' + den, k: 1 / den, materials: materialsOf([T ? tp : null, sb, lg]), W: W, L: Lg, H: H, T: T, St: St, legH: legH, t: t, taper: taper, pts: pts, legs: legs,
      parts: parts, hardware: [], totals: totalsOf(parts), overall: { width: Math.round(W), depth: Lg, height: H } };
  }
  var MDF = '#d8cfbf';
  // plan; mode 'top' (sub-base outline + legs dashed) or 'layout' (legs with sizes)
  function freePlan(s, m, ox, oy, mode) {
    var k = m.k, out = '', pl = function (pp) { return pp.map(function (p) { return [ox + p[0] * k, oy + p[1] * k]; }); };
    out += poly2(pl(m.pts), mode === 'top' ? MDF : '#efebe3', 0.35);
    m.legs.forEach(function (x, i) {
      out += poly2(pl(x.band), mode === 'top' ? 'none' : OAK, mode === 'top' ? 0.2 : 0.3, mode === 'top' ? DASH : '');
      if (mode !== 'top') { var c = x.line[Math.floor(x.line.length / 2)]; out += text(ox + c[0] * k, oy + c[1] * k + 0.7, String(i + 1), 1.8, { anchor: 'middle', weight: 'bold' }); }
    });
    out += hChain([ox, ox + m.W * k], [Math.round(m.W)], oy - 5, oy) + vChain([oy, oy + m.L * k], [m.L], ox + m.W * k + 6, ox + m.W * k);
    if (s.shape.type === 'kidney' && s.shape.bow) out += hChain([ox, ox + s.shape.bow * k, ox + m.W * k], [s.shape.bow, s.shape.width], oy + m.L * k / 2 + 3, oy + m.L * k / 2);
    return out;
  }
  // elevation: dir 'front' looks along y (x across), 'side' looks along x (y across)
  function freeElev(s, m, ox, oy, dir) {
    var k = m.k, out = '', ix = dir === 'front' ? 0 : 1, span = dir === 'front' ? m.W : m.L, top = oy - m.H * k;
    var lo = top + (m.T + m.St) * k;
    var order = m.legs.slice().sort(function (a, b) { var ca = a.line[12][1 - ix], cb = b.line[12][1 - ix]; return ca - cb; });
    order.forEach(function (x) {
      var a = Math.min.apply(null, x.band.map(function (p) { return p[ix]; })), b = Math.max.apply(null, x.band.map(function (p) { return p[ix]; }));
      var c = Math.min.apply(null, x.bottom.map(function (p) { return p[ix]; })), d = Math.max.apply(null, x.bottom.map(function (p) { return p[ix]; }));
      out += poly2([[ox + a * k, lo], [ox + b * k, lo], [ox + d * k, oy], [ox + c * k, oy]], OAK, 0.3);
    });
    out += rect(ox, top + m.T * k, span * k, m.St * k, 0.3, MDF);
    if (m.T) out += rect(ox, top, span * k, m.T * k, 0.3, STONE);
    out += hChain([ox, ox + span * k], [Math.round(span)], top - 5, top);
    var ys = [top], vs = []; if (m.T) { ys.push(top + m.T * k); vs.push(m.T); } ys.push(lo); vs.push(m.St); ys.push(oy); vs.push(m.legH);
    out += vChain(ys, vs, ox + span * k + 5, ox + span * k) + vChain([top, oy], [m.H], ox + span * k + 12, ox + span * k);
    return out;
  }
  function freeIso(s, m, bx, by, bw, bh) {
    var c = Math.cos(Math.PI / 6), sn = 0.5, W = m.W, D = m.L, H = m.H;
    var spanX = (W + D) * c, spanY = H + (W + D) * sn, sc = Math.min(bw / spanX, bh / spanY);
    var cx = bx + (bw - spanX * sc) / 2 + D * c * sc, cy = by + (bh - spanY * sc) / 2 + H * sc;
    function P(x, y, z) { return [cx + (x * c - z * c) * sc, cy - y * sc + (x * sn + z * sn) * sc]; }
    var out = '', y0 = m.legH;
    m.legs.slice().sort(function (a, b) { var pa = a.line[12], pb = b.line[12]; return (pa[0] + pa[1]) - (pb[0] + pb[1]); }).forEach(function (x) {
      var pts = x.band.map(function (p) { return P(p[0], y0, p[1]); }).concat(x.bottom.map(function (p) { return P(p[0], 0, p[1]); }));
      out += poly2(hull(pts), '#c4a378', 0.3);
    });
    // a flat slab of any outline (concave too): the edge faces that face the viewer, back to front, then the top
    function slab(pts, y0, y1, side, topFill) {
      var faces = [], o = '';
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1];
        if (dz - dx <= 0) continue;                                  // outward normal (dz, -dx) must face +x / +z (the viewer)
        faces.push({ d: a[0] + a[1] + b[0] + b[1], q: [P(a[0], y0, a[1]), P(b[0], y0, b[1]), P(b[0], y1, b[1]), P(a[0], y1, a[1])] });
      }
      faces.sort(function (f, g) { return f.d - g.d; }).forEach(function (f) { o += '<polygon points="' + f.q.map(function (q) { return n2(q[0]) + ',' + n2(q[1]); }).join(' ') + '" fill="' + side + '" stroke="' + side + '" stroke-width="0.2"/>'; });
      var outline = pts.map(function (p) { return P(p[0], y0, p[1]); });
      return o + poly2(pts.map(function (p) { return P(p[0], y1, p[1]); }), topFill, 0.3);
    }
    var topY = m.legH + m.St;
    out += slab(m.pts, m.legH, topY, '#b9ab95', MDF);
    if (m.T) out += slab(m.pts, topY, topY + m.T, '#c6c3bb', STONE);
    var tS = P(W * 0.5, topY + m.T, D * 0.5), tL = P(m.legs[0].line[12][0], m.legH * 0.4, m.legs[0].line[12][1]);
    out += tag(tS[0], tS[1], (m.T ? s.top : s.subBase).code) + tag(tL[0] + 5, tL[1], s.legs.code);
    return out;
  }
  TEMPLATES.freeform = {
    build: buildFreeform,
    clientViews: function (s, m) {
      var k = m.k, w = m.W * k, l = m.L * k, x2 = 30 + w + 30, y1 = 36 + m.H * k, y2 = y1 + 30 + m.H * k, x3 = x2 + Math.max(w, l) + 34;
      return freePlan(s, m, 30, 30, 'top') + viewTitle(24, 30 + l + 14, 1, 'TOP VIEW', m.scale) +
        freeElev(s, m, x2, y1, 'front') + viewTitle(x2, y1 + 12, 2, 'FRONT VIEW', m.scale) +
        freeElev(s, m, x2, y2, 'side') + viewTitle(x2, y2 + 12, 3, 'SIDE VIEW', m.scale) +
        freeIso(s, m, x3, 30, 318 - x3, 130) + viewTitle(x3, 172, 4, '3D VIEW', 'not to scale');
    },
    workshopViews: function (s, m) {
      var k = m.k, w = m.W * k, l = m.L * k, x2 = 30 + w + 34;
      return freePlan(s, m, 30, 30, 'layout') + viewTitle(24, 30 + l + 14, 1, 'LEG LAYOUT (sub-base from below)', m.scale) +
        freeElev(s, m, x2, 30 + m.H * k + 10, 'front') + viewTitle(x2, 30 + m.H * k + 24, 2, 'FRONT VIEW', m.scale) +
        m.legs.map(function (x, i) { return text(x2, 30 + m.H * k + 40 + i * 4, 'Leg ' + (i + 1) + ': ' + x.spec.length + ' long, ' + x.spec.inset + ' in from the edge, ' + m.t + ' thick, ' + Math.round(x.cs.sag) + ' curve, tapers to ' + Math.round(x.spec.length * (1 - m.taper)) + ' at the floor', 1.9, { fill: '#333' }); }).join('') +
        text(x2, 30 + m.H * k + 40 + m.legs.length * 4 + 2, 'Sub-base and legs CNC cut; legs curve to follow the edge.', 1.9, { fill: '#555' });
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

  var api = { buildCarcass: buildCarcass, buildPedestal: buildPedestal, buildTable: buildTable, buildMirror: buildMirror, buildDesk: buildDesk, buildChair: buildChair, buildFreeform: buildFreeform, sheets: sheets, split: split, templates: Object.keys(TEMPLATES) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BattenDrawings = api;
})(this);
