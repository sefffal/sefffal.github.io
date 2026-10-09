// Interactive sky-path simulation for astrometry.html.
// A Sun-like star at 10 pc with proper motion, parallax, and the reflex
// motion caused by a companion on a Keplerian orbit. Everything is drawn to
// scale (in milliarcseconds) unless the "exaggerate" box is ticked.
(function () {
    var canvas = document.getElementById('sky');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    function el(id) { return document.getElementById(id); }
    var cbPM = el('show-pm'), cbPlx = el('show-plx'), cbPl = el('show-planet'),
        cbBoost = el('boost'), slMass = el('mass'), massOut = el('mass-out'),
        readout = el('sky-readout'), btn = el('sky-play');

    // ---- Physical set-up ----
    var D_PC = 10;                    // distance (pc)
    var PLX = 1000 / D_PC;            // parallax (mas)
    var PM = [-55, 30];               // proper motion: [RA*, Dec] (mas/yr)
    var BETA = 35 * Math.PI / 180;    // ecliptic latitude, sets parallax ellipse shape
    var MSTAR = 1.0;                  // stellar mass (solar masses)
    var MJUP = 9.546e-4;              // Jupiter mass (solar masses)
    var PER = 7;                      // companion orbital period (yr)
    var ECC = 0.3;                    // eccentricity
    var INC = 50 * Math.PI / 180;     // inclination
    var BIGOM = 30 * Math.PI / 180;   // longitude of ascending node
    var OMEGA = 100 * Math.PI / 180;  // argument of periastron
    var TPERI = 1.0;                  // time of periastron (yr)
    var SPAN = 10;                    // years shown
    var BOOST = 20;                   // exaggeration factor
    var LOOP_SECONDS = 14;            // animation time for SPAN years
    var N = 1200;                     // samples along the path

    // Fixed pseudo-random measurement epochs over a 5.5-year window (like DR4).
    var epochs = [], seed = 12345;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var k = 0; k < 44; k++) epochs.push(1.0 + 5.5 * rnd());
    epochs.sort(function (a, b) { return a - b; });

    function kepler(M, e) {
        var E = M;
        for (var i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        return E;
    }
    function orbitScale(mjup) {
        var mp = mjup * MJUP;
        var aAU = Math.cbrt((MSTAR + mp) * PER * PER);   // relative orbit (au)
        return { aAU: aAU, aStarMas: aAU * mp / (MSTAR + mp) * PLX };
    }
    // Reflex motion of the star, [dRA*, dDec] in mas.
    function wobbleAt(t, mjup) {
        var a = orbitScale(mjup).aStarMas;
        var E = kepler(2 * Math.PI * (t - TPERI) / PER, ECC);
        var X = Math.cos(E) - ECC, Y = Math.sqrt(1 - ECC * ECC) * Math.sin(E);
        var cw = Math.cos(OMEGA), sw = Math.sin(OMEGA);
        var cO = Math.cos(BIGOM), sO = Math.sin(BIGOM), ci = Math.cos(INC);
        // Thiele-Innes constants
        var A = a * (cw * cO - sw * sO * ci), B = a * (cw * sO + sw * cO * ci);
        var F = a * (-sw * cO - cw * sO * ci), G = a * (-sw * sO + cw * cO * ci);
        // The companion is at (+), so the star moves the opposite way (-).
        return [-(B * X + G * Y), -(A * X + F * Y)];
    }
    function starAt(t, o) {
        var x = 0, y = 0;
        if (o.pm) { x += PM[0] * t; y += PM[1] * t; }
        if (o.plx) {
            var ph = 2 * Math.PI * t;
            x += PLX * Math.sin(ph);
            y += PLX * Math.sin(BETA) * Math.cos(ph);
        }
        if (o.planet) {
            var w = wobbleAt(t, o.mass);
            x += w[0] * o.boost; y += w[1] * o.boost;
        }
        return [x, y];
    }

    function options() {
        var pm = cbPM.checked, plx = cbPlx.checked, pl = cbPl.checked;
        var boostOn = cbBoost.checked && pl && (pm || plx);
        return { pm: pm, plx: plx, planet: pl, mass: +slMass.value,
                 boost: boostOn ? BOOST : 1, boostOn: boostOn };
    }

    var cache = null;
    function path(o) {
        var key = [o.pm, o.plx, o.planet, o.mass, o.boost].join();
        if (cache && cache.key === key) return cache;
        var pts = [], minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
        for (var i = 0; i <= N; i++) {
            var p = starAt(SPAN * i / N, o);
            pts.push(p);
            if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
            if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
        }
        var meas = epochs.map(function (te) { return [te, starAt(te, o)]; });
        cache = { key: key, pts: pts, meas: meas, minx: minx, maxx: maxx, miny: miny, maxy: maxy };
        return cache;
    }

    function niceLength(x) {
        var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), m = x / p;
        return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
    }
    function fmtMas(v) {
        if (v >= 10) return v.toFixed(0);
        if (v >= 1) return v.toFixed(1);
        return v.toPrecision(2);
    }

    var t = 0, playing = true, last = null, holdStart = 0, visible = true;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { playing = false; t = SPAN; }

    var W = 0, H = 0;
    function resize() {
        var dpr = window.devicePixelRatio || 1;
        W = canvas.clientWidth;
        H = Math.round(Math.min(W * 0.62, 440));
        canvas.style.height = H + 'px';
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function updateReadout(o) {
        var mass = +slMass.value;
        var kind = mass > 13 ? 'brown dwarf' : 'planet';
        massOut.textContent = mass + ' Jupiter mass' + (mass === 1 ? '' : 'es') + ' (' + kind + ')';
        var sc = orbitScale(mass);
        var txt = 'Star: 1 solar mass at 10 parsecs (parallax 100 mas), moving ' +
            Math.round(Math.sqrt(PM[0] * PM[0] + PM[1] * PM[1])) + ' mas per year. ';
        txt += 'Companion: ' + mass + ' Jupiter mass' + (mass === 1 ? '' : 'es') + ', ' +
            PER + '-year orbit (' + sc.aAU.toFixed(1) + ' au). ' +
            'The star’s wobble: ' + fmtMas(sc.aStarMas) + ' mas';
        if (!o.planet) txt += ' (switched off).';
        else if (o.boostOn) txt += ', drawn ' + BOOST + '× larger so you can see it.';
        else txt += ', drawn to scale.';
        readout.textContent = txt;
    }

    function draw() {
        if (!W) return;
        var o = options();
        ctx.fillStyle = '#0b1020';
        ctx.fillRect(0, 0, W, H);
        ctx.font = '13px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
        if (!o.pm && !o.plx && !o.planet) {
            ctx.fillStyle = '#ccc';
            ctx.textAlign = 'center';
            ctx.fillText('Turn on at least one effect to see the star move.', W / 2, H / 2);
            ctx.textAlign = 'left';
            return;
        }
        var P = path(o);
        var pad = 40;
        var spanx = Math.max(P.maxx - P.minx, 1e-6), spany = Math.max(P.maxy - P.miny, 1e-6);
        var s = Math.min((W - 2 * pad) / spanx, (H - 2 * pad) / spany);
        var cx = (P.minx + P.maxx) / 2, cy = (P.miny + P.maxy) / 2;
        function X(p) { return W / 2 - (p[0] - cx) * s; }   // east is to the left
        function Y(p) { return H / 2 - (p[1] - cy) * s; }   // north is up

        // Whole path, faint
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        for (var i = 0; i < P.pts.length; i++) {
            if (i === 0) ctx.moveTo(X(P.pts[i]), Y(P.pts[i])); else ctx.lineTo(X(P.pts[i]), Y(P.pts[i]));
        }
        ctx.stroke();

        // Path travelled so far
        var iNow = Math.round(N * t / SPAN);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#7dc3e4';
        ctx.beginPath();
        for (i = 0; i <= iNow && i < P.pts.length; i++) {
            if (i === 0) ctx.moveTo(X(P.pts[i]), Y(P.pts[i])); else ctx.lineTo(X(P.pts[i]), Y(P.pts[i]));
        }
        ctx.stroke();

        // Measurements made so far
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.5;
        for (i = 0; i < P.meas.length; i++) {
            if (P.meas[i][0] > t) break;
            ctx.beginPath();
            ctx.arc(X(P.meas[i][1]), Y(P.meas[i][1]), 3.5, 0, 2 * Math.PI);
            ctx.stroke();
        }

        // The star
        var p = starAt(t, o), sx = X(p), sy = Y(p);
        var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
        g.addColorStop(0, 'rgba(255,244,214,1)');
        g.addColorStop(0.3, 'rgba(255,230,170,0.6)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, 14, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 2 * Math.PI); ctx.fill();

        // Scale bar
        var L = niceLength((W - 2 * pad) / s / 4), Lpx = L * s, yb = H - 16;
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, yb - 4); ctx.lineTo(pad, yb); ctx.lineTo(pad + Lpx, yb); ctx.lineTo(pad + Lpx, yb - 4);
        ctx.stroke();
        ctx.fillStyle = '#ddd';
        ctx.fillText(fmtMas(L) + ' mas', pad + Lpx + 8, yb + 4);

        // Compass and clock
        var ax = W - 28, ay = 34;
        ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 18); ctx.moveTo(ax, ay); ctx.lineTo(ax - 18, ay); ctx.stroke();
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'center';
        ctx.fillText('N', ax, ay - 22);
        ctx.textAlign = 'right';
        ctx.fillText('E', ax - 22, ay + 4);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ddd';
        ctx.fillText('Year ' + t.toFixed(1), 14, 22);
        if (o.boostOn) { ctx.fillStyle = '#ffb3b3'; ctx.fillText('Wobble exaggerated ' + BOOST + '×', 14, 40); }
    }

    function frame(ts) {
        if (last === null) last = ts;
        var dt = Math.min((ts - last) / 1000, 0.1);
        last = ts;
        if (playing) {
            if (t >= SPAN) {
                if (!holdStart) holdStart = ts;
                if (ts - holdStart > 1500) { t = 0; holdStart = 0; }
            } else {
                t = Math.min(SPAN, t + dt * SPAN / LOOP_SECONDS);
            }
            if (visible) draw();
        }
        window.requestAnimationFrame(frame);
    }

    function onChange() { updateReadout(options()); draw(); }
    [cbPM, cbPlx, cbPl, cbBoost].forEach(function (c) { c.addEventListener('change', onChange); });
    slMass.addEventListener('input', onChange);
    btn.addEventListener('click', function () {
        playing = !playing;
        if (playing && t >= SPAN) { t = 0; holdStart = 0; }
        btn.textContent = playing ? 'Pause' : 'Play';
        draw();
    });
    if (!playing) btn.textContent = 'Play';
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(canvas);
    }
    window.addEventListener('resize', resize);
    updateReadout(options());
    resize();
    window.requestAnimationFrame(frame);
})();
