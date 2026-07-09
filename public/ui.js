'use strict';

// Presentation-only behaviours for the Linear/Modern look: theme toggle,
// mouse-tracking spotlight on surfaces, and scroll-reveal. No app data here;
// this stays independent of app.js. Everything degrades cleanly and respects
// prefers-reduced-motion.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Theme toggle ----------
  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('jh_theme', theme);
    } catch (e) {
      /* private mode — the in-memory attribute still holds for this session */
    }
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const toLabel = theme === 'light' ? 'dark' : 'light';
      btn.setAttribute('aria-label', `Switch to ${toLabel} theme`);
      btn.setAttribute('title', `Switch to ${toLabel} theme`);
    }
  }

  function initThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    applyTheme(currentTheme()); // sync the button label to the pre-paint theme
    btn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  }

  // ---------- Mouse-tracking spotlight ----------
  // One delegated listener drives a radial glow on the nearest tracked
  // surface. rAF-throttled so mousemove never does layout work directly.
  const SPOT_SELECTOR = '.card-form, .stats-strip, .board-card, .lock-card, .table-wrap';

  function initSpotlight() {
    if (reduceMotion) return;
    let pending = null;
    document.addEventListener(
      'mousemove',
      (e) => {
        const el = e.target.closest && e.target.closest(SPOT_SELECTOR);
        if (!el) return;
        if (pending) return;
        pending = requestAnimationFrame(() => {
          pending = null;
          const rect = el.getBoundingClientRect();
          el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
          el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
        });
      },
      { passive: true },
    );
  }

  // ---------- Scroll reveal ----------
  // Fade-and-rise elements as they enter the viewport, once. Elements opt in
  // with .reveal; without IntersectionObserver or with reduced motion they're
  // simply shown.
  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    items.forEach((el) => io.observe(el));
  }

  function boot() {
    initThemeToggle();
    initSpotlight();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
