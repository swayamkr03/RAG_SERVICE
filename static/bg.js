(function () {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');

  let W, H, mouse = { x: -9999, y: -9999 };
  let particles = [];
  let beams = [];
  let frame = 0;
  let raf;

  const PARTICLE_COUNT = 90;
  const BEAM_COUNT = 5;
  const CONNECTION_DIST = 130;

  // Purple / cyan palette
  const COLORS = [
    [168, 85, 247],   // purple
    [139, 92, 246],   // violet
    [34, 211, 238],   // cyan
    [99, 102, 241],   // indigo
  ];

  /* ── Resize ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  /* ── Particles ── */
  function makeParticle() {
    const c = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.8 + 0.4,
      c,
      alpha: Math.random() * 0.5 + 0.3,
      // slow twinkle
      twinkleSpeed: Math.random() * 0.015 + 0.005,
      twinkleOffset: Math.random() * Math.PI * 2,
    };
  }

  function initParticles() {
    particles = Array.from({ length: PARTICLE_COUNT }, makeParticle);
  }

  function updateParticle(p) {
    // Mild mouse repulsion
    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 120 && dist > 0) {
      const force = (120 - dist) / 120 * 0.4;
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
    }

    // Velocity cap
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > 1.2) { p.vx *= 0.95; p.vy *= 0.95; }

    p.x += p.vx;
    p.y += p.vy;

    // Wrap edges
    if (p.x < -10) p.x = W + 10;
    if (p.x > W + 10) p.x = -10;
    if (p.y < -10) p.y = H + 10;
    if (p.y > H + 10) p.y = -10;
  }

  function drawParticle(p) {
    const twinkle = Math.sin(frame * p.twinkleSpeed + p.twinkleOffset) * 0.2 + 0.8;
    const a = p.alpha * twinkle;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`;
    ctx.fill();
  }

  /* ── Connections ── */
  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          const alpha = (1 - dist / CONNECTION_DIST) * 0.18;
          // Mix colors of the two particles
          const r = Math.round((a.c[0] + b.c[0]) / 2);
          const g = Math.round((a.c[1] + b.c[1]) / 2);
          const bv = Math.round((a.c[2] + b.c[2]) / 2);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${r},${g},${bv},${alpha})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }

  /* ── Aurora beams ── */
  function makeBeam() {
    const c = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x: Math.random() * W,
      y: H * 0.1 + Math.random() * H * 0.5,
      width: 180 + Math.random() * 260,
      height: 300 + Math.random() * 400,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.08,
      angle: Math.random() * Math.PI,
      rotSpeed: (Math.random() - 0.5) * 0.003,
      alpha: 0.018 + Math.random() * 0.022,
      c,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.004 + Math.random() * 0.006,
    };
  }

  function initBeams() {
    beams = Array.from({ length: BEAM_COUNT }, makeBeam);
  }

  function drawBeam(b) {
    const pulse = Math.sin(frame * b.phaseSpeed + b.phase) * 0.3 + 0.7;
    const a = b.alpha * pulse;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, b.width * 0.5);
    grad.addColorStop(0,   `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${a})`);
    grad.addColorStop(0.5, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${a * 0.4})`);
    grad.addColorStop(1,   `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`);

    ctx.scale(1, b.height / b.width);
    ctx.beginPath();
    ctx.arc(0, 0, b.width * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function updateBeam(b) {
    b.x += b.vx;
    b.y += b.vy;
    b.angle += b.rotSpeed;
    if (b.x < -b.width) b.x = W + b.width;
    if (b.x > W + b.width) b.x = -b.width;
    if (b.y < -b.height) b.y = H + b.height;
    if (b.y > H + b.height) b.y = -b.height;
  }

  /* ── Shooting stars ── */
  let stars = [];

  function spawnStar() {
    if (Math.random() > 0.004) return;
    const c = COLORS[Math.floor(Math.random() * COLORS.length)];
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.5,
      len: 60 + Math.random() * 80,
      speed: 6 + Math.random() * 6,
      angle: Math.PI / 4 + (Math.random() - 0.5) * 0.4,
      alpha: 1,
      c,
    });
  }

  function updateDrawStars() {
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.x += Math.cos(s.angle) * s.speed;
      s.y += Math.sin(s.angle) * s.speed;
      s.alpha -= 0.025;
      if (s.alpha <= 0) { stars.splice(i, 1); continue; }

      const tx = s.x - Math.cos(s.angle) * s.len;
      const ty = s.y - Math.sin(s.angle) * s.len;
      const grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
      grad.addColorStop(0, `rgba(${s.c[0]},${s.c[1]},${s.c[2]},0)`);
      grad.addColorStop(1, `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${s.alpha * 0.9})`);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /* ── Main loop ── */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Aurora beams (back layer)
    beams.forEach(b => { updateBeam(b); drawBeam(b); });

    // Connections
    drawConnections();

    // Particles
    particles.forEach(p => { updateParticle(p); drawParticle(p); });

    // Shooting stars
    spawnStar();
    updateDrawStars();

    frame++;
    raf = requestAnimationFrame(draw);
  }

  /* ── Init ── */
  function init() {
    resize();
    initParticles();
    initBeams();
    if (raf) cancelAnimationFrame(raf);
    draw();
  }

  window.addEventListener('resize', () => {
    resize();
    initParticles();
    initBeams();
  });

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  init();
})();