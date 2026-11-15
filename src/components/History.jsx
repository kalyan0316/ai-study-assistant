export default function History({ sessions, currentId, onOpen, onDelete }) {
  if (!sessions.length) return null;
  return (
    <nav className="panel history" aria-label="Saved study sets">
      <p className="panel-title">Saved sets</p>
      <ul>
        {sessions.map((s) => (
          <li key={s.id} className={s.id === currentId ? 'current' : ''}>
            <button className="history-open" onClick={() => onOpen(s)} aria-current={s.id === currentId}>
              <span className="history-title">{s.set.title}</span>
              <span className="muted small">
                {s.set.cards.length} cards · {s.set.quiz.length} Qs · {new Date(s.updatedAt).toLocaleDateString()}
              </span>
            </button>
            <button className="btn ghost icon small" onClick={() => onDelete(s.id)} aria-label={`Delete ${s.set.title}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
