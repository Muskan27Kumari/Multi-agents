// VGI Agent Universe — Request modal popup component.
const requestModalCss = `
.req-modal {
  position: fixed; inset: 0; z-index: 200;
  display: none;
  align-items: center; justify-content: center;
  padding: 24px;
}
.req-modal.open { display: flex; }
.req-modal__scrim {
  position: absolute; inset: 0;
  background: rgba(2, 1, 12, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0; transition: opacity 220ms ease;
}
.req-modal.open .req-modal__scrim { opacity: 1; }
.req-modal__card {
  position: relative;
  width: 100%; max-width: 460px;
  background:
    radial-gradient(520px 240px at 100% 0%, rgba(139,92,246,0.18), transparent 62%),
    linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0)),
    var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  border-radius: 26px;
  padding: 28px;
  box-shadow: 0 40px 120px -30px rgba(0,0,0,0.8);
  transform: translateY(14px) scale(0.97);
  opacity: 0;
  transition: transform 280ms cubic-bezier(0.22,1,0.36,1), opacity 240ms ease;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
}
.req-modal.open .req-modal__card { transform: none; opacity: 1; }
.req-modal__close {
  position: absolute; top: 16px; right: 16px;
  width: 36px; height: 36px;
  display: grid; place-items: center;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.03);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 160ms;
}
.req-modal__close:hover { color: var(--text); border-color: var(--border-strong); }
.req-modal__head {
  display: flex; gap: 16px; align-items: center;
  margin-bottom: 6px;
}
.req-modal__icon {
  width: 54px; height: 54px;
  border-radius: 16px;
  background: var(--grad-soft);
  border: 1px solid rgba(139,92,246,0.34);
  display: grid; place-items: center;
  color: #c7bcff; flex: 0 0 auto;
}
.req-modal__icon svg { width: 26px; height: 26px; }
.req-modal__eyebrow {
  font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--text-dim); font-weight: 500;
}
.req-modal__title {
  font-family: "Bricolage Grotesque", sans-serif;
  font-size: 22px; font-weight: 500; letter-spacing: -0.01em;
  margin-top: 4px;
}
.req-modal__lead {
  color: var(--text-muted); font-size: 14.5px; line-height: 1.55;
  margin: 18px 0 22px;
}
.req-modal__lead b { color: var(--text); font-weight: 500; }

.bot-row {
  display: flex; align-items: center; gap: 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(255,255,255,0.02);
  transition: border-color 180ms, background 180ms;
}
.bot-row + .bot-row { margin-top: 12px; }
.bot-row:hover { border-color: var(--border-strong); background: rgba(255,255,255,0.035); }
.bot-row__tg {
  width: 42px; height: 42px; flex: 0 0 auto;
  border-radius: 12px;
  background: linear-gradient(160deg, #2aabee, #229ed9);
  display: grid; place-items: center; color: white;
  box-shadow: 0 6px 18px -6px rgba(34,158,217,0.7);
}
.bot-row__tg svg { width: 22px; height: 22px; }
.bot-row__body { flex: 1; min-width: 0; }
.bot-row__label {
  font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--text-dim); font-weight: 500;
}
.bot-row__handle {
  font-family: "DM Mono", ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 14px; color: var(--text);
  margin-top: 3px;
  white-space: normal; overflow-wrap: anywhere; line-height: 1.3;
}
.bot-row__handle b { color: #7fd0f5; font-weight: 500; }
.bot-row__actions { display: flex; gap: 8px; flex: 0 0 auto; }
.bot-icon-btn {
  width: 38px; height: 38px;
  display: grid; place-items: center;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.03);
  color: var(--text-muted);
  cursor: pointer; transition: all 160ms;
}
.bot-icon-btn:hover { color: var(--text); border-color: var(--border-strong); transform: translateY(-1px); }
.bot-icon-btn.copied { color: var(--mint); border-color: rgba(52,211,153,0.4); }
.bot-icon-btn svg { width: 16px; height: 16px; }
.bot-open {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 0 14px; height: 38px;
  border-radius: 10px;
  background: linear-gradient(160deg, #2aabee, #229ed9);
  color: white; font-size: 13px; font-weight: 500;
  white-space: nowrap; transition: transform 160ms, box-shadow 200ms;
}
.bot-open:hover { transform: translateY(-1px); box-shadow: 0 8px 22px -8px rgba(34,158,217,0.8); }

.req-modal__divider {
  display: flex; align-items: center; gap: 14px;
  margin: 22px 0;
  color: var(--text-dim); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
}
.req-modal__divider::before, .req-modal__divider::after {
  content: ""; flex: 1; height: 1px; background: var(--border);
}
.req-modal__foot {
  color: var(--text-dim); font-size: 13px; line-height: 1.5; text-align: center;
}
.req-modal__foot a { color: var(--text-muted); text-decoration: underline; text-underline-offset: 2px; }
.req-modal__foot a:hover { color: var(--text); }
.req-modal__status {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 14px;
}
`;
const __ms = document.createElement("style");
__ms.textContent = requestModalCss;
document.head.appendChild(__ms);

const TG_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 4.38 18.6 20.2c-.25 1.1-.9 1.38-1.83.86l-5.05-3.72-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.16L17.02 7.5c.41-.36-.09-.56-.63-.2L6.78 13.5l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L20.5 3.07c.9-.33 1.69.2 1.44 1.31z"/></svg>';

window.openRequestModal = (id) => {
  const a = AGENTS.find((x) => x.id === id);
  if (!a || a.status !== "Available") return;
  const handle = a.bot.replace(/^@/, "");
  const uni = UNIVERSE_BOT.replace(/^@/, "");

  let root = document.getElementById("req-modal");
  if (!root) {
    root = document.createElement("div");
    root.id = "req-modal";
    root.className = "req-modal";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <div class="req-modal__scrim" data-close></div>
    <div class="req-modal__card">
      <button class="req-modal__close" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="req-modal__head">
        <div class="req-modal__icon">${ICON(a.icon, 26)}</div>
        <div>
          <div class="req-modal__eyebrow">Request agent</div>
          <div class="req-modal__title">${a.name}</div>
        </div>
      </div>

      <p class="req-modal__lead">
        Start a chat on Telegram to request <b>${a.name}</b>. Message the universe bot for anything, or go straight to this agent's dedicated bot.
      </p>

      <div class="bot-row">
        <div class="bot-row__tg">${TG_ICON}</div>
        <div class="bot-row__body">
          <div class="bot-row__label">Universe bot · start here</div>
          <div class="bot-row__handle">${UNIVERSE_BOT}</div>
        </div>
        <div class="bot-row__actions">
          <button class="bot-icon-btn" data-copy="${UNIVERSE_BOT}" aria-label="Copy handle">${ICON("copy", 16)}</button>
          <a class="bot-open" href="https://t.me/${uni}?start=${a.id}" target="_blank" rel="noopener">Open</a>
        </div>
      </div>

      <div class="bot-row">
        <div class="bot-row__tg">${TG_ICON}</div>
        <div class="bot-row__body">
          <div class="bot-row__label">${a.botName || (a.name + ' bot')}</div>
          <div class="bot-row__handle"><b>${a.bot}</b></div>
        </div>
        <div class="bot-row__actions">
          <button class="bot-icon-btn" data-copy="${a.bot}" aria-label="Copy handle">${ICON("copy", 16)}</button>
          <a class="bot-open" href="https://t.me/${handle}?start=welcome" target="_blank" rel="noopener">Open</a>
        </div>
      </div>

      ${(a.extraBots || []).map(eb => {
        const ebHandle = eb.bot.replace(/^@/, "");
        return `
          <div class="bot-row">
            <div class="bot-row__tg">${TG_ICON}</div>
            <div class="bot-row__body">
              <div class="bot-row__label">${eb.name}</div>
              <div class="bot-row__handle"><b>${eb.bot}</b></div>
            </div>
            <div class="bot-row__actions">
              <button class="bot-icon-btn" data-copy="${eb.bot}" aria-label="Copy handle">${ICON("copy", 16)}</button>
              <a class="bot-open" href="https://t.me/${ebHandle}?start=welcome" target="_blank" rel="noopener">Open</a>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  // Wire interactions
  root.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeRequestModal)
  );
  root.querySelectorAll("[data-copy]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy");
      try { await navigator.clipboard.writeText(text); } catch (e) { }
      btn.classList.add("copied");
      btn.innerHTML = ICON("check", 16);
      setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = ICON("copy", 16); }, 1400);
    })
  );

  requestAnimationFrame(() => root.classList.add("open"));
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", escClose);
};

function escClose(e) { if (e.key === "Escape") closeRequestModal(); }
window.closeRequestModal = () => {
  const root = document.getElementById("req-modal");
  if (!root) return;
  root.classList.remove("open");
  document.body.style.overflow = "";
  document.removeEventListener("keydown", escClose);
};

// Event delegation — any [data-request] element opens the popup.
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-request]");
  if (trigger) {
    e.preventDefault();
    const id = trigger.getAttribute("data-request");
    const a = AGENTS.find((x) => x.id === id);
    if (a && a.status === "Available") {
      openRequestModal(id);
    }
  }
});
