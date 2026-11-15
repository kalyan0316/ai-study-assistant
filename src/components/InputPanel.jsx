const MAX_CHARS = 15000;

export const SIZES = {
  quick: { label: 'Quick (6 cards · 4 questions)', cardCount: 6, quizCount: 4 },
  standard: { label: 'Standard (10 cards · 6 questions)', cardCount: 10, quizCount: 6 },
  deep: { label: 'Deep (15 cards · 10 questions)', cardCount: 15, quizCount: 10 },
};

const EXAMPLES = [
  {
    label: 'Photosynthesis notes',
    text: `Photosynthesis is the process plants use to turn light energy into chemical energy.
It happens in the chloroplasts, which contain the green pigment chlorophyll.
The light-dependent reactions take place in the thylakoid membranes and produce ATP and NADPH, releasing oxygen from water.
The Calvin cycle happens in the stroma and uses ATP and NADPH to fix carbon dioxide into glucose.
The overall equation: 6CO2 + 6H2O + light → C6H12O6 + 6O2.
Factors that limit the rate: light intensity, CO2 concentration and temperature.`,
  },
  { label: 'Topic: The French Revolution', text: 'The French Revolution (1789–1799)' },
  { label: 'Topic: Big-O notation', text: 'Big-O notation and time complexity of common algorithms' },
];

export default function InputPanel({ notes, setNotes, size, setSize, onSubmit, loading }) {
  const tooLong = notes.length > MAX_CHARS;
  const empty = notes.trim().length < 3;

  const submit = (e) => {
    e.preventDefault();
    if (!empty && !tooLong) onSubmit();
  };

  return (
    <form className="panel input-panel" onSubmit={submit}>
      <label htmlFor="notes" className="panel-title">What do you want to study?</label>
      <p className="muted small">Paste your notes, or just type a topic.</p>
      <textarea
        id="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        placeholder="e.g. paste a page of lecture notes, or type “mitosis vs meiosis”"
        rows={8}
        aria-describedby="notes-count"
        aria-invalid={tooLong}
      />
      <div className="input-meta">
        <span id="notes-count" className={tooLong ? 'error-text' : 'muted'}>
          {notes.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          {tooLong && ' (too long, please trim)'}
        </span>
        <span className="muted hide-mobile">Ctrl/⌘ + Enter to generate</span>
      </div>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className="chip" onClick={() => setNotes(ex.text)}>
            {ex.label}
          </button>
        ))}
      </div>

      <div className="input-actions">
        <select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Set size">
          {Object.entries(SIZES).map(([key, s]) => (
            <option key={key} value={key}>{s.label}</option>
          ))}
        </select>
        {/* Stays enabled while loading: submitting again replaces the in-flight request. */}
        <button className="btn primary" type="submit" disabled={empty || tooLong}>
          {loading ? 'Generating… (restart)' : 'Generate study set'}
        </button>
      </div>
    </form>
  );
}
