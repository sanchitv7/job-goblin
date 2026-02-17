# JOB_GOBLIN

**AI-powered recruiting with a multi-agent pipeline and a swipe UI. Built in ~2 hours at the Granola x DeepMind Hackathon.**

No frameworks. No LangChain. Just four focused AI agents orchestrated sequentially — sourcing, matching, pitching, and outreach — all powered by Google Gemini.

---

## Highlights

- **Multi-Agent Pipeline** — 4 specialized agents communicate via shared database state, not direct messaging
- **Swipe-to-Hire UI** — Tinder-style candidate review with keyboard shortcuts (arrow keys)
- **Real-Time SSE Streaming** — Watch agents work live as they source and rank candidates
- **Structured AI Outputs** — Gemini JSON schema mode eliminates parsing failures
- **Neobrutalist Design** — Bold colors, thick borders, 4px offset shadows
- **Personalized Outreach** — AI-generated pitch emails tailored to each candidate
- **Interactive Stats** — Click any stat to filter and navigate candidates by status
- **~$0.001 per pipeline run** — Gemini Flash makes it nearly free

---

## Architecture

```
                         JOB_GOBLIN Pipeline
 ┌─────────────────────────────────────────────────────────┐
 │                                                         │
 │   Job Created                                           │
 │       │                                                 │
 │       ▼                                                 │
 │   ┌──────────────┐    ┌──────────────┐                  │
 │   │   Sourcing   │───▶│   Matching   │                  │
 │   │    Agent     │    │    Agent     │                  │
 │   │ (25 profiles)│    │ (0-100 score)│                  │
 │   └──────────────┘    └──────┬───────┘                  │
 │                              │                          │
 │                              ▼                          │
 │                        ┌──────────┐                     │
 │                        │ Database │                     │
 │                        │ (SQLite) │                     │
 │                        └────┬─────┘                     │
 │                             │                           │
 │                             ▼                           │
 │                     ┌───────────────┐                   │
 │                     │  Swipe UI     │                   │
 │                     │  ← Reject     │                   │
 │                     │  → Accept     │                   │
 │                     └───────┬───────┘                   │
 │                             │ Accept                    │
 │                             ▼                           │
 │                     ┌──────────────┐                    │
 │                     │ Pitch Writer │                    │
 │                     │    Agent     │                    │
 │                     └──────┬───────┘                    │
 │                            │                            │
 │                            ▼                            │
 │                     ┌──────────────┐                    │
 │                     │  Outreach    │                    │
 │                     │    Agent     │                    │
 │                     └──────────────┘                    │
 │                                                         │
 └─────────────────────────────────────────────────────────┘
```

**Why sequential?** Each agent completes before the next starts. Simpler to build, debug, and reason about than orchestrator or parallel patterns.

**Why no framework?** At 25-candidate scale, direct implementation took 20 minutes. Framework setup would have taken 60+. Each agent is just a Python class with a focused prompt and a Gemini API call.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Python async/await, SQLite |
| **AI** | Google Gemini (`gemini-3-flash-preview`) via `google-genai` SDK |
| **Frontend** | React 18 + Vite, Tailwind CSS v3, Framer Motion |
| **Streaming** | Server-Sent Events (SSE) for live pipeline progress |
| **Design** | Neobrutalist — bold borders, offset shadows, high-contrast palette |

---

## Quick Start

### One Command

```bash
# 1. Add your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > backend/.env

# 2. Start everything
./start.sh
```

Backend runs at `http://localhost:8000` | Frontend at `http://localhost:5173`

Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### Manual Setup

**Backend:**
```bash
cd backend
uv sync
source .venv/bin/activate
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend-neo
npm install
npm run dev
```

---

## SSE Streaming: Live Pipeline Events

The backend exposes a real-time event stream so the frontend can visualize agent progress as it happens.

**Endpoint:** `GET /api/jobs/{job_id}/pipeline/events`

**How it works:**
1. Client opens an SSE connection when a job is created
2. Backend emits events as each agent starts, progresses, and completes
3. Frontend renders a live pipeline visualization — no polling required

```
event: sourcing_start
data: {"agent": "sourcing", "status": "running", "message": "Generating candidates..."}

event: sourcing_complete
data: {"agent": "sourcing", "status": "done", "candidates_count": 25}

event: matching_start
data: {"agent": "matching", "status": "running", "message": "Scoring candidates..."}

event: matching_complete
data: {"agent": "matching", "status": "done"}
```

This replaces the previous "wait 30-60 seconds and hope" experience with live, observable agent activity.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs` | Create job and trigger agent pipeline |
| `GET` | `/api/jobs/{job_id}/candidates` | Get next candidate to review |
| `PUT` | `/api/candidates/{id}/accept` | Accept candidate, generate pitch |
| `PUT` | `/api/candidates/{id}/reject` | Reject candidate |
| `GET` | `/api/jobs/{job_id}/stats` | Review statistics |
| `POST` | `/api/jobs/{job_id}/source-more` | Generate a fresh batch |
| `GET` | `/api/jobs/{job_id}/pipeline/events` | SSE stream of pipeline progress |
| `GET` | `/api/jobs/{job_id}/candidates/by-status/{status}` | Filter candidates by status |

Full interactive docs available at `http://localhost:8000/docs` when running locally.

---

## The Agent System

Each agent is a Python class — no base class, no framework, no abstraction layer. Just a prompt, a JSON schema, and a Gemini API call.

```python
class SourcingAgent:
    def generate_candidates(self, job, count=25):
        prompt = f"Generate {count} realistic candidates for: {job.title}..."
        response = get_client().models.generate_content(
            model='gemini-3-flash-preview',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type='application/json',
                response_json_schema=candidate_schema
            )
        )
        return json.loads(response.text)
```

| Agent | Input | Output | Time |
|-------|-------|--------|------|
| **Sourcing** | Job description | 25 candidate profiles | 15-30s |
| **Matching** | Candidates + job | Scores (0-100) + reasoning | 10-20s |
| **Pitch Writer** | Candidate + job | Personalized outreach email | 3-5s |
| **Outreach** | Email content | Delivery (SMTP or console log) | <1s |

---

## Design System

The frontend uses a **neobrutalist** aesthetic — intentionally bold and raw.

| Element | Value |
|---------|-------|
| **Yellow** | `#F7E733` — primary accent |
| **Pink** | `#FF70A6` — reject / danger |
| **Green** | `#00FFA3` — accept / success |
| **Blue** | `#4D90FE` — info / links |
| **Borders** | 2-4px solid black, sharp corners |
| **Shadows** | 4px offset, solid black |
| **Typography** | `font-black` (900), uppercase, tight tracking |

---

## Cost

Gemini Flash is extremely cheap for this use case:

| Operation | Cost |
|-----------|------|
| Source 25 candidates | ~$0.0005 |
| Match all candidates | ~$0.0003 |
| Generate one pitch | ~$0.0001 |
| **Full pipeline per job** | **~$0.001** |

With $1 you can run ~1,000 complete pipeline executions.

---

## Project Structure

```
backend/
  main.py             FastAPI app, routes, SSE endpoint, background pipeline
  agents.py           4 agent classes with Gemini structured output calls
  database.py         SQLite CRUD operations
  models.py           Pydantic request/response schemas
  schema.sql          Table definitions

frontend-neo/src/     Neobrutalist UI (primary frontend)
  App.jsx             Root with neo styling
  context/AppContext.jsx   Global state via React Context
  components/
    JobForm.jsx            Job creation form
    CandidateCard.jsx      Profile display with LinkedIn links
    CandidateSwiper.jsx    Main swipe review interface
    CandidateListModal.jsx Filterable candidate list by status
    StatsPanel.jsx         Clickable stats with modal drill-down
    SwipeControls.jsx      Accept/reject buttons
    PitchModal.jsx         Generated email preview
```

---

## Built At

**Granola x DeepMind Hackathon** — built from scratch in approximately 2 hours.

The goal was to demonstrate that genuine multi-agent AI systems do not require heavyweight frameworks. Four simple agents with focused prompts, structured outputs, and sequential orchestration can deliver a complete, functional product.
