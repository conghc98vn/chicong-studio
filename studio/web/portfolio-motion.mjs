// Motion is a progressive enhancement: content remains visible if unsupported.
let dispose = () => {};
export function initPortfolioMotion(root) {
  dispose();
  if (!root || !['/', '/portfolio', '/about'].includes(location.pathname.replace(/\/$/, '') || '/')) return;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches || !Element.prototype.animate || !window.IntersectionObserver) return;
  const active = new Set();
  const play = (element, delay = 0, distance = 20) => {
    const animation = element.animate([
      { opacity: 0, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: 'translateY(0)' }
    ], {duration: 850, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards'});
    active.add(animation);
    animation.onfinish = () => active.delete(animation);
  };
  root.querySelectorAll('.hero-copy > .label, .hero-copy h1, .hero-copy > p:not(.label), .hero-actions, .hero-foot, .hero-frame').forEach((element, i) => play(element, Math.min(i * 80, 320), 14));
  const observer = new IntersectionObserver(entries => {
    let sequence = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      play(entry.target, Math.min(sequence++ * 90, 180));
    }
  }, {threshold: 0.08});
  root.querySelectorAll('.section-top, .medium-note > div, .note-section, .public-cta, .about-title, .about-intro, .about-art, .approach-section > h2, .approach-grid article').forEach(element => observer.observe(element));
  const stop = () => {
    observer.disconnect();
    active.forEach(animation => animation.cancel());
    active.clear();
    preference.removeEventListener('change', stop);
    root.removeEventListener('focusin', focus);
  };
  // Keyboard focus reveals its containing animated section immediately.
  const focus = event => {
    for (const animation of active) {
      if (animation.effect?.target?.contains(event.target)) animation.finish();
    }
  };
  root.addEventListener('focusin', focus);
  preference.addEventListener('change', stop);
  dispose = stop;
}
