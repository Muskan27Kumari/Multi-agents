// VGI Agent Universe — Navbar component.
window.NAV = (active) => `
<nav class="nav" data-screen-label="Navbar">
  <div class="container nav-inner">
    <a class="logo" href="index.html" onclick="if(location.pathname.endsWith('index.html') || location.pathname === '/' || location.pathname.endsWith('/')) { window.scrollTo({top:0, behavior:'smooth'}); if(window.closeAgentDetails) closeAgentDetails(); event.preventDefault(); }">
      <img src="assets/logo.png" class="logo-img" alt="VGI Agent Universe Logo" />
      <span>VGI Agent Universe</span>
    </a>
  </div>
</nav>
`;

window.scrollToCatalog = (e) => {
  const el = document.getElementById('catalog-section');
  if (el) {
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth' });
    document.body.classList.remove('menu-open');
    if (window.closeAgentDetails) window.closeAgentDetails();
  }
};
