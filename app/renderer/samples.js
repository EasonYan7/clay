/* 内置示例(生成文件,勿手改) */
window.CLAY_SAMPLES = {
  tailwind: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-white antialiased">
  <div class="min-h-screen">
    <header class="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <span class="text-sm font-bold">N</span>
          </div>
          <span class="text-lg font-semibold tracking-tight">NovaFlow</span>
        </div>
        <nav class="hidden items-center gap-8 md:flex">
          <a href="#" class="text-sm text-slate-300 transition hover:text-white">Features</a>
          <a href="#" class="text-sm text-slate-300 transition hover:text-white">Pricing</a>
          <a href="#" class="text-sm text-slate-300 transition hover:text-white">Docs</a>
          <a href="#" class="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-200">Get Started</a>
        </nav>
      </div>
    </header>

    <main>
      <section class="relative overflow-hidden">
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.15),_transparent_50%)]"></div>
        <div class="relative mx-auto max-w-7xl px-6 pb-24 pt-20 text-center">
          <div class="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300">
            <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
            Now in public beta
          </div>
          <h1 class="mx-auto max-w-3xl text-5xl font-bold leading-tight tracking-tight md:text-6xl">
            Ship your ideas
            <span class="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">10x faster</span>
          </h1>
          <p class="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
            NovaFlow turns your team's scattered workflows into one automated pipeline. No code required, no meetings needed.
          </p>
          <div class="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="#" class="w-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-3.5 text-sm font-semibold shadow-lg shadow-violet-500/25 transition hover:opacity-90 sm:w-auto">Start free trial</a>
            <a href="#" class="w-full rounded-full border border-white/15 px-8 py-3.5 text-sm font-semibold text-slate-200 transition hover:bg-white/5 sm:w-auto">Watch demo →</a>
          </div>
          <div class="mt-16 grid grid-cols-3 gap-8 border-t border-white/10 pt-10">
            <div>
              <div class="text-3xl font-bold">40k+</div>
              <div class="mt-1 text-sm text-slate-500">Active teams</div>
            </div>
            <div>
              <div class="text-3xl font-bold">99.9%</div>
              <div class="mt-1 text-sm text-slate-500">Uptime SLA</div>
            </div>
            <div>
              <div class="text-3xl font-bold">4.9/5</div>
              <div class="mt-1 text-sm text-slate-500">User rating</div>
            </div>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-7xl px-6 py-24">
        <div class="mx-auto max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-tight md:text-4xl">Everything you need</h2>
          <p class="mt-4 text-slate-400">Powerful features to help your team move faster without breaking things.</p>
        </div>
        <div class="mt-16 grid gap-6 md:grid-cols-3">
          <div class="rounded-2xl border border-white/10 bg-white/5 p-8 transition hover:border-violet-500/50">
            <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">⚡</div>
            <h3 class="text-lg font-semibold">Instant automation</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-400">Connect your tools in minutes with our visual workflow builder. 200+ integrations out of the box.</p>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/5 p-8 transition hover:border-violet-500/50">
            <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-fuchsia-500/20 text-fuchsia-300">🔒</div>
            <h3 class="text-lg font-semibold">Enterprise security</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-400">SOC 2 Type II certified with end-to-end encryption and granular access controls.</p>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/5 p-8 transition hover:border-violet-500/50">
            <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">📊</div>
            <h3 class="text-lg font-semibold">Real-time analytics</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-400">Track every workflow with live dashboards, alerts, and weekly digest reports.</p>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-7xl px-6 pb-24">
        <div class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-16 text-center">
          <h2 class="text-3xl font-bold tracking-tight md:text-4xl">Ready to get started?</h2>
          <p class="mx-auto mt-4 max-w-md text-violet-100">Join 40,000+ teams already shipping faster with NovaFlow.</p>
          <a href="#" class="mt-8 inline-block rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-50">Start your free trial</a>
        </div>
      </section>
    </main>

    <footer class="border-t border-white/10">
      <div class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 md:flex-row">
        <span class="text-sm text-slate-500">© 2026 NovaFlow, Inc.</span>
        <div class="flex gap-6 text-sm text-slate-500">
          <a href="#" class="transition hover:text-white">Privacy</a>
          <a href="#" class="transition hover:text-white">Terms</a>
          <a href="#" class="transition hover:text-white">Twitter</a>
        </div>
      </div>
    </footer>
  </div>
</body>
</html>
`,
  plaincss: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1f2937; background: #fafaf9; }
    .container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
    .navbar { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; }
    .logo { font-size: 22px; font-weight: 700; color: #0f766e; }
    .nav-links { display: flex; gap: 28px; list-style: none; }
    .nav-links a { text-decoration: none; color: #4b5563; font-size: 15px; }
    .nav-links a:hover { color: #0f766e; }
    .hero { display: flex; align-items: center; gap: 48px; padding: 72px 0; }
    .hero-text { flex: 1; }
    .hero-text h1 { font-size: 44px; line-height: 1.15; margin-bottom: 20px; }
    .hero-text h1 em { color: #0f766e; font-style: normal; }
    .hero-text p { font-size: 18px; color: #6b7280; line-height: 1.6; margin-bottom: 32px; }
    .btn-primary {
      display: inline-block; background: #0f766e; color: #fff; padding: 14px 32px;
      border-radius: 8px; text-decoration: none; font-weight: 600;
      box-shadow: 0 4px 14px rgba(15, 118, 110, 0.3);
    }
    .btn-primary:hover { background: #115e59; }
    .hero-img { flex: 1; }
    .hero-img .placeholder {
      width: 100%; aspect-ratio: 4/3; border-radius: 16px;
      background: linear-gradient(135deg, #99f6e4, #0f766e);
    }
    .features { padding: 64px 0 88px; }
    .features h2 { text-align: center; font-size: 32px; margin-bottom: 48px; }
    .feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    .card {
      background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .card .icon {
      width: 44px; height: 44px; border-radius: 10px; background: #ccfbf1;
      display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 16px;
    }
    .card h3 { font-size: 18px; margin-bottom: 8px; }
    .card p { font-size: 14.5px; color: #6b7280; line-height: 1.55; }
    footer { border-top: 1px solid #e5e7eb; padding: 28px 0; text-align: center; color: #9ca3af; font-size: 14px; }
    @media (max-width: 768px) {
      .hero { flex-direction: column; padding: 40px 0; }
      .feature-grid { grid-template-columns: 1fr; }
      .nav-links { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <nav class="navbar">
      <div class="logo">Verdant</div>
      <ul class="nav-links">
        <li><a href="#">Product</a></li>
        <li><a href="#">Solutions</a></li>
        <li><a href="#">Pricing</a></li>
        <li><a href="#">Contact</a></li>
      </ul>
    </nav>

    <section class="hero">
      <div class="hero-text">
        <h1>Grow your garden business <em>online</em></h1>
        <p>Verdant helps local nurseries and landscapers manage bookings, inventory, and invoices — all from one simple dashboard.</p>
        <a href="#" class="btn-primary">Book a demo</a>
      </div>
      <div class="hero-img"><div class="placeholder"></div></div>
    </section>

    <section class="features">
      <h2>Why teams choose Verdant</h2>
      <div class="feature-grid">
        <div class="card">
          <div class="icon">🌱</div>
          <h3>Smart inventory</h3>
          <p>Track every plant and pot in real time with barcode scanning and low-stock alerts.</p>
        </div>
        <div class="card">
          <div class="icon">📅</div>
          <h3>Easy scheduling</h3>
          <p>Let customers book consultations online while you control your availability.</p>
        </div>
        <div class="card">
          <div class="icon">💳</div>
          <h3>Fast invoicing</h3>
          <p>Send professional invoices in one click and get paid twice as fast.</p>
        </div>
      </div>
    </section>
  </div>
  <footer>© 2026 Verdant Software</footer>
</body>
</html>
`,
};
