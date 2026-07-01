// VGI Agent Universe — Agent Card component.
window.renderAgentCard = (a) => {
  const statusClass = a.status === "Available" ? "status-available" : "status-soon";
  return `
    <article class="card agent-card reveal" data-category="${a.category}">
      <div class="top">
        <div class="agent-icon">${ICON(a.icon, 22)}</div>
        <span class="badge ${statusClass}"><span class="badge-dot"></span>${a.status}</span>
      </div>
      <div>
        <div class="agent-name">${a.name}</div>
        <span class="badge" style="margin-top: 8px;">${a.category}</span>
      </div>
      <p class="agent-desc">${a.short}</p>
      <div class="actions">
        <a class="req-link" href="?id=${a.id}" onclick="openAgentDetails('${a.id}', event)">View details ${ICON('arrow', 14)}</a>
        <button class="btn btn-sm btn-grad" type="button" data-request="${a.id}">Request</button>
      </div>
    </article>
  `;
};
