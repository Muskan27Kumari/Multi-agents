// VGI Agent Universe — Reveal elements on scroll helper.
// 1) Synchronously reveal anything already in (or near) the viewport — never gate first paint on IO.
// 2) Observe everything below the fold for the smooth on-scroll effect.
// 3) Belt-and-braces: after 900ms, force-reveal anything still hidden (covers bfcache / prerender edge cases).
window.initReveal = () => {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;

  const vh = window.innerHeight || document.documentElement.clientHeight;
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    // Already visible (or within one viewport below the fold) → reveal now, synchronously.
    // Skip the transition so it paints correctly even if the document isn't fully active yet
    // (prerender / bfcache / hidden tab can otherwise freeze the opacity transition at 0).
    if (r.top < vh * 1.05) {
      el.style.transition = "none";
      el.classList.add("in");
      void el.offsetWidth; // commit paint
      el.style.transition = "";
    }
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => {
      if (!el.classList.contains("in")) io.observe(el);
    });
  } else {
    // No IO support → just show everything.
    els.forEach((el) => el.classList.add("in"));
  }

  // Safety net: nothing should stay hidden if the page sat in the background.
  setTimeout(() => {
    document.querySelectorAll(".reveal:not(.in)").forEach((el) => {
      el.style.transition = "none";
      el.classList.add("in");
      void el.offsetWidth;
      el.style.transition = "";
    });
  }, 900);
};
