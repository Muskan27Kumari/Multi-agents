// VGI Agent Universe — Main Bootstrap file.
// Bootstrap layout when DOM ready
window.mountShell = (active) => {
  const navContainer = document.querySelector('[data-shell="nav"]');
  const footerContainer = document.querySelector('[data-shell="footer"]');
  if (navContainer) navContainer.innerHTML = NAV(active);
  if (footerContainer) footerContainer.innerHTML = FOOTER();
};

// Async load active bot configurations from the server
(async function initBotConfig() {
  try {
    const res = await fetch('/api/bot-config');
    if (!res.ok) return;
    const config = await res.json();

    if (config.universe) {
      window.UNIVERSE_BOT = '@' + config.universe;
    }

    const mapping = {
      rag: 'rag-knowledge-agent',
      marketing: 'marketing-content-agent',
      portfolio: 'stock-market-agent',
      resume: 'hr-recruitment-agent',
      review: 'customer-review-responder',
      booking: 'appointment-booking-agent',
    };

    for (const [key, username] of Object.entries(config)) {
      if (!username) continue;
      const agentId = mapping[key];
      const agent = (window.AGENTS || []).find(a => a.id === agentId);
      if (agent) {
        agent.bot = '@' + username;
      }

      if (key === 'drive_rag') {
        const ragAgent = (window.AGENTS || []).find(a => a.id === 'rag-knowledge-agent');
        if (ragAgent && ragAgent.extraBots) {
          const driveBot = ragAgent.extraBots.find(eb => eb.name === 'VGI Drive Assistant');
          if (driveBot) {
            driveBot.bot = '@' + username;
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to load bot configuration:', e);
  }
})();

