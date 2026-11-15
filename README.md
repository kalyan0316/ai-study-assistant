# Study Assistant

Paste notes (or just type a topic) → an LLM returns **structured JSON** → the app turns it into
**flashcards** you can flip and mark, and a **multiple-choice quiz** with instant feedback, a score,
and a **"retest only what I got wrong"** loop.

It's not a chatbot: the model's output is parsed, validated and repaired before anything is rendered,
and every way the model can fail (bad JSON, wrong shape, empty, slow, refused, API down) has a defined UI state.

## Run it

Requires Node 18.17+.

```bash
npm install
cp .env.example .env     # optional: add an API key (see below)
npm start                # builds the React app and serves it + the API on http://localhost:3000
```

With no API key the server runs in **mock mode**: it returns a sample study set built from your notes,
so the whole UI (and every failure mode) can be tried without an account.

For development with hot reload:

```bash
npm run dev              # Vite on http://localhost:5173, API on :8787 (proxied)
npm test                 # unit tests for the output parser/validator
```

### Using a real model

Any OpenAI-compatible chat-completions API works. Set three values in `.env`:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` |
| --- | --- | --- |
| Groq (free tier, default) | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` |
| Gemini (free tier) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | any model id |
| Ollama (local) | `http://localhost:11434/v1` | e.g. `llama3.1` (key: `ollama`) |

…plus `LLM_API_KEY`. The key is only read by the Node server; the browser never sees it.

Quick start with Groq: create a free key at https://console.groq.com/keys, then put it in `.env`:

```
LLM_API_KEY=gsk_...your key...
```

and run `npm start` again. The header shows the model name instead of "Mock mode" when the key is picked up.

## Features

- **Flashcards**: tap/Space to flip, ←/→ to move, mark *Still learning* (1) or *Got it* (2).
  At the end, review only the cards you missed, as many rounds as you need.
- **Quiz**: one question at a time, pick with click or keys 1–4 / A–D, see the right answer and an explanation.
  Results list what you got wrong; **Retest** runs just those questions again with options re-shuffled.
- **Refine** (stretch): "make the quiz harder", "add 3 cards on X" edits the current set instead of starting over.
  If the edit fails, the existing set is kept.
- **Saved sets** (stretch): the last 15 sets are kept in localStorage and can be reopened.
- **Dark mode** (follows system), keyboard navigation, reduced-motion support, mobile layout.

## How bad AI output is handled

This is the core of the project. The pipeline is:

```
browser ──POST /api/generate──▶ server ──▶ LLM
   ▲                               │
   │   { content: "<raw model text>", finishReason }
   └───────────────────────────────┘
   extractJson()  →  validateStudySet()  →  render
```

**Server (`server/`)**
- Prompt lives on the server; user notes are wrapped in `<notes>` and the model is told to treat them as data.
- JSON mode (`response_format: json_object`) when the provider supports it; if the model rejects it, the server retries once without it (the client-side parser copes with plain text).
- A retired/unknown model gives a clear "change LLM_MODEL" message instead of a generic error. (This happened during development: Groq retired the Llama model I started with.)
- 40 s upstream timeout; upstream call is aborted if the browser disconnects (so cancelled/superseded requests stop costing tokens).
- Provider errors are mapped to clear codes: `rate-limited`, `auth`, `timeout`, `upstream-error`, … with a `retryable` flag.
- Input limits (15k chars), request body cap, and a small per-IP rate limit.

**Parsing (`src/lib/studySet.js`)**: forgiving about format, strict about meaning.
- Accepts JSON wrapped in ```` ```json ```` fences or surrounded by prose, trailing commas, and nested payloads (`{ data: {...} }`).
- Accepts common field-name variants (`flashcards`/`cards`, `term`/`front`, `choices`/`options`) and answers given as an index, a numeric string, a letter ("B"), or the option text.
- Each card/question is validated on its own. Broken ones (missing side, < 2 options, answer not among the options) are **dropped**,
  duplicates removed, and the user sees a small "Some AI output was fixed or skipped" note listing what happened.
  Only if *nothing* usable remains is it an error.
- Duplicate options are removed *after* working out the correct option's text, so de-duplication can't shift the answer index.
- Distinguishes `empty`, `not-json`, `truncated` (cut off mid-object, or `finish_reason: length`), `wrong-shape`,
  `no-usable-items`, and `declined` (model returned `{"error": "..."}` for unusable input).
- Saved sessions from localStorage go through the same validator, so corrupted storage can't crash the app.

**Request lifecycle (`src/hooks/useStudySetRequest.js`)**
- Each request gets an incrementing id; only the latest may update state, so **a slow old response can never overwrite a newer one**.
- Starting a new request aborts the previous `fetch`. Opening a saved set cancels anything in flight.
- "Taking longer than usual" message after 7 s, Cancel button, hard client timeout at 45 s.
- Every failure becomes one `{ title, message, hint, retryable }` object → error card with **Try again** (if retryable), Dismiss, and technical details.
- A failed **refine** leaves the current study set untouched. A refine response is also ignored if you've switched to a different set meanwhile.
- An `ErrorBoundary` catches any render bug and offers reload / reset instead of a white screen.

### Try the failure modes yourself

Open **Developer: simulate AI failures** in the sidebar. The server then fakes the model's reply:

| Option | What it returns | What you should see |
| --- | --- | --- |
| `fenced` | JSON in a markdown fence with chatter around it | Works normally |
| `partial` | Valid set + broken cards/questions + a duplicate | Works, with a "fixed or skipped" note |
| `malformed` | JSON cut off mid-way | "Response was cut off" + Try again |
| `wrong-shape` | `{ "flashcards": "some text" }` | "Missing the flashcards and quiz" + Try again |
| `empty` | `""` | "Empty response" + Try again |
| `declined` | `{ "error": "..." }` | Model's reason, no retry, hint to add detail |
| `slow` | Valid set after 9 s | "Taking longer" message. Click Generate again with other notes before it finishes: the slow one is discarded |
| `timeout` / `rate-limit` / `server-error` | HTTP 504 / 429 / 502 | Matching error message + Try again |

## Project structure

```
server/
  index.js        HTTP server: /api/generate, /api/health, serves dist/
  llm.js          OpenAI-compatible call, timeout, error mapping
  prompt.js       system prompt + JSON schema, generate & refine messages
  mock.js         mock model + failure simulation
  env.js          tiny .env loader (server has no npm dependencies)
src/
  lib/studySet.js         extract → validate → normalise model output   ← most of the logic
  lib/api.js              fetch wrapper, typed RequestError
  hooks/useStudySetRequest.js   request lifecycle (abort, stale, timeout, errors)
  hooks/useSessions.js    saved sets in localStorage
  components/             InputPanel, StudyView, Flashcards, Quiz, History, RequestStatus, ErrorBoundary
tests/studySet.test.js    parser/validator tests (node --test, no extra deps)
```

## Known limitations

- **No streaming.** The whole JSON arrives at once. Streaming partial JSON into cards is possible but makes validation much harder; I chose a reliable non-streaming core.
- Refinement sends the full current set back to the model, so very large sets use more tokens, and the model may rewrite items it was told to keep.
- Card/question ids are regenerated after a refine, so progress in the current round resets after an edit.
- The model can still produce *factually wrong* but well-formed content. Validation checks structure, not truth.
- Rate limiting is in-memory and per process; fine for a demo, not for multiple server instances.
- Saved sets live only in this browser (localStorage); no accounts or sync.
- Quiz answers aren't persisted, so reloading mid-quiz starts that round again.

## What I'd do next

- Stream the response and render cards as each one completes.
- Spaced repetition (remember per-card difficulty across sessions).
- Server-side automatic single retry with a "repair this JSON" prompt before surfacing an error.
- Component tests (React Testing Library) for the quiz/flashcard flows.

## AI usage

I used Claude (Anthropic) heavily on this project. It generated most of the code (server, parser, React
components, styles), the unit tests and the first draft of this README from the assignment PDF.
I ran the app locally, tested it in mock mode and with Groq, and worked through setup problems
(the original Groq model had been retired, so the default model and error handling were updated).
I've read through the code and can explain the main decisions: why parsing and validation happen
client-side, how stale responses are prevented (request ids + AbortController), and why broken
cards/questions are dropped individually instead of rejecting the whole response.

## Time spent

About 4 hours in one sitting, most of it on setup, testing and fixing the model configuration
rather than writing code by hand.
