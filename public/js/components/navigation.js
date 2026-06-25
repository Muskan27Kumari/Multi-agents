// VGI Agent Universe — Navbar component.
window.NAV = (active) => `
<nav class="nav" data-screen-label="Navbar">
  <div class="container nav-inner">
    <a class="logo" href="index.html" aria-label="VGI Agent Universe home">
      <img src="assets/logo.png" class="logo-img" alt="VGI Agent Universe Logo" />
      <span>VGI Agent Universe</span>
    </a>
    <div class="nav-links">
      <a href="index.html"        class="${active === 'home' ? 'active' : ''}">Home</a>
      <a href="agents.html"       class="${active === 'agents' ? 'active' : ''}">Agents</a>
      <a href="index.html#how"    class="">How it works</a>
      <a href="contact.html"      class="${active === 'contact' ? 'active' : ''}">Contact</a>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <a href="contact.html" class="nav-cta">Request an agent ${ICON('arrow', 14)}</a>
      <button class="nav-menu-btn" aria-label="Open menu" onclick="document.body.classList.toggle('menu-open')">${ICON('menu', 18)}</button>
    </div>
  </div>
  <div class="mobile-menu">
    <a href="index.html">Home</a>
    <a href="agents.html">Agents</a>
    <a href="index.html#how">How it works</a>
    <a href="contact.html">Contact</a>
  </div>
</nav>
`;

// Mobile menu CSS (small) — injected so it doesn't bloat styles.css
const mobileMenuCss = `
.mobile-menu {
  display: none;
  padding: 12px 24px 18px;
  border-top: 1px solid var(--border);
  background: rgba(3, 2, 19, 0.92);
  flex-direction: column;
  gap: 4px;
}
.mobile-menu a {
  display: block; padding: 12px 4px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.mobile-menu a:last-child { border-bottom: 0; }
body.menu-open .mobile-menu { display: flex; }
@media (min-width: 880px) {
  body.menu-open .mobile-menu { display: none; }
}
`;
const __s = document.createElement("style");
__s.textContent = mobileMenuCss;
document.head.appendChild(__s);
