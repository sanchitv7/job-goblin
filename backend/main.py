"""FastAPI application for agentic recruiter platform."""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from rate_limiter import RateLimiter

from models import JobCreate, StatsResponse, OutreachSendRequest
from database import (
    init_db, create_job, get_job, create_candidate, create_match,
    get_next_candidate, update_candidate_status, get_candidate,
    create_outreach, update_outreach_status, get_job_stats,
    get_outreach, update_outreach_content, get_outreach_by_candidate_id
)
from agents import SourcingAgent, MatchingAgent, PitchWriterAgent, OutreachAgent


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    await init_db()
    yield


app = FastAPI(title="Agentic Recruiter API", lifespan=lifespan)

# CORS middleware for frontend
allowed_origins = ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"]
frontend_url = os.environ.get("FRONTEND_URL")
if frontend_url:
    allowed_origins.append(frontend_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiter
rate_limiter = RateLimiter()


# Agent instances
sourcing_agent = SourcingAgent()
matching_agent = MatchingAgent()
pitch_writer_agent = PitchWriterAgent()
outreach_agent = OutreachAgent()

# Registry: job_id -> asyncio.Queue for SSE event delivery
pipeline_queues: dict[int, asyncio.Queue] = {}


async def _emit(job_id: int, event: dict):
    """Send a pipeline event if a client is listening on this job's SSE stream."""
    queue = pipeline_queues.get(job_id)
    if queue:
        await queue.put(event)


@app.get("/api/jobs/{job_id}/pipeline/events")
async def pipeline_events(job_id: int):
    """SSE stream: emits structured events as the agent pipeline executes."""
    queue: asyncio.Queue = asyncio.Queue()
    pipeline_queues[job_id] = queue

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=120.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in ("pipeline_complete", "pipeline_error"):
                    break
        finally:
            pipeline_queues.pop(job_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


async def process_job_pipeline(job_id: int, count: int = 25):
    """Background task: Run sourcing and matching agents in batches."""
    try:
        # Get job details
        job = await get_job(job_id)
        if not job:
            print(f"Job {job_id} not found")
            return

        print(f"Starting pipeline for job {job_id}: {job['title']}")
        await _emit(job_id, {"type": "pipeline_start", "job_id": job_id, "total": count, "message": f"Starting pipeline for {count} candidates..."})

        batch_size = 5
        processed_count = 0

        while processed_count < count:
            current_batch_size = min(batch_size, count - processed_count)
            print(f"Processing batch: {current_batch_size} candidates (Total: {processed_count}/{count})...")

            # Step 1: Sourcing Agent - Generate candidates (Batch)
            await _emit(job_id, {"type": "agent_start", "agent": "sourcing", "message": f"Sourcing batch {processed_count+1}–{min(processed_count+current_batch_size, count)} of {count}..."})
            candidates = await sourcing_agent.generate_candidates(job, count=current_batch_size)
            print(f"Generated {len(candidates)} candidates in batch")

            # Save candidates to database
            candidate_ids = []
            for candidate in candidates:
                candidate_id = await create_candidate(
                    job_id=job_id,
                    name=candidate['name'],
                    current_role=candidate['current_role'],
                    current_company=candidate['current_company'],
                    years_experience=candidate['years_experience'],
                    skills=candidate['skills'],
                    location=candidate['location'],
                    email=candidate['email'],
                    linkedin_summary=candidate['linkedin_summary'],
                    linkedin_url=candidate.get('linkedin_url'),
                    company_website=candidate.get('company_website')
                )
                candidate_ids.append(candidate_id)

            await _emit(job_id, {"type": "agent_progress", "agent": "sourcing", "count": processed_count + len(candidates), "total": count, "message": f"Sourced {processed_count + len(candidates)} of {count} candidates"})

            # Step 2: Matching Agent - Rank candidates (Batch)
            await _emit(job_id, {"type": "agent_start", "agent": "matching", "message": f"Ranking {len(candidates)} candidates..."})
            matches = await matching_agent.rank_candidates(job, candidates)
            print(f"Ranked {len(matches)} candidates in batch")

            # Save matches to database
            for match in matches:
                candidate_idx = match['candidate_index']
                if candidate_idx < 0 or candidate_idx >= len(candidate_ids):
                    continue

                candidate_id = candidate_ids[candidate_idx]
                await create_match(
                    job_id=job_id,
                    candidate_id=candidate_id,
                    score=match['score'],
                    key_highlights=match['key_highlights'],
                    fit_reasoning=match['fit_reasoning'],
                    rank_position=match['rank_position'] # Rank is relative to batch, but that's fine for now
                )

            await _emit(job_id, {"type": "agent_complete", "agent": "matching", "count": processed_count + len(candidates), "total": count, "message": f"Matched {len(matches)} candidates in batch"})

            # Step 3: Parallel Pre-generation of pitches for top candidates (Score >= 75)
            top_matches = [m for m in matches if m['score'] >= 75]
            if top_matches:
                await _emit(job_id, {"type": "agent_start", "agent": "pitch_writer", "message": f"Pre-generating pitches for {len(top_matches)} top candidates..."})

                async def generate_and_save_pitch(match_data):
                    idx = match_data['candidate_index']
                    c_id = candidate_ids[idx]
                    c_data = candidates[idx]
                    if isinstance(c_data['skills'], str):
                        c_data['skills'] = json.loads(c_data['skills'])

                    try:
                        pitch = await pitch_writer_agent.create_pitch(job, c_data, match_data)
                        await create_outreach(
                            job_id=job_id,
                            candidate_id=c_id,
                            subject=pitch['subject'],
                            body=pitch['body'],
                            delivery_status="generated"
                        )
                    except Exception as e:
                        print(f"Error in parallel pitch gen for {c_id}: {e}")

                # Run all top match pitch generations concurrently
                await asyncio.gather(*(generate_and_save_pitch(m) for m in top_matches))
                await _emit(job_id, {"type": "agent_complete", "agent": "pitch_writer", "count": processed_count + len(candidates), "total": count, "message": f"Pitches ready for {len(top_matches)} top candidates"})

            processed_count += len(candidates)

            # Small delay to yield control if needed
            await asyncio.sleep(0.1)

        print(f"Pipeline complete for job {job_id}")
        await _emit(job_id, {"type": "pipeline_complete", "job_id": job_id, "total": count, "message": "All candidates ready for review"})

    except Exception as e:
        print(f"Error in pipeline for job {job_id}: {e}")
        await _emit(job_id, {"type": "pipeline_error", "error": str(e), "message": f"Pipeline failed: {str(e)}"})
        import traceback
        traceback.print_exc()


@app.post("/api/jobs")
async def create_job_endpoint(job_data: JobCreate, background_tasks: BackgroundTasks, request: Request):
    """Create job and trigger candidate sourcing pipeline."""
    rate_limiter.check("create_job", request.client.host, limit=10, window=3600)
    job_id = await create_job(
        title=job_data.title,
        company=job_data.company,
        company_website=job_data.company_website,
        description=job_data.description,
        required_skills=job_data.required_skills,
        experience_level=job_data.experience_level,
        location=job_data.location
    )

    # Start background pipeline
    background_tasks.add_task(process_job_pipeline, job_id, count=25)

    return {
        "job_id": job_id,
        "status": "processing",
        "message": "Job created. Generating candidates..."
    }


@app.post("/api/jobs/{job_id}/source-more")
async def source_more_candidates(job_id: int, background_tasks: BackgroundTasks, request: Request):
    """Generate additional batch of candidates on demand."""
    rate_limiter.check("source_more", request.client.host, limit=5, window=3600)
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Generate smaller batch for "more" requests
    background_tasks.add_task(process_job_pipeline, job_id, count=15)

    return {
        "status": "sourcing",
        "message": "Generating new candidates..."
    }


@app.get("/api/jobs/{job_id}/candidates")
async def get_next_candidate_endpoint(job_id: int):
    """Get next candidate to review."""
    candidate = await get_next_candidate(job_id)
    
    # Always get stats
    stats = await get_job_stats(job_id)

    if not candidate:
        return {
            "candidate": None,
            "message": "No more candidates available",
            "stats": stats
        }

    # Parse JSON fields
    skills = json.loads(candidate['skills']) if isinstance(candidate['skills'], str) else candidate['skills']
    key_highlights = json.loads(candidate['key_highlights']) if isinstance(candidate['key_highlights'], str) else candidate['key_highlights']

    return {
        "candidate": {
            "id": candidate['id'],
            "name": candidate['name'],
            "current_role": candidate['current_role'],
            "current_company": candidate['current_company'],
            "years_experience": candidate['years_experience'],
            "skills": skills,
            "location": candidate['location'],
            "email": candidate['email'],
            "linkedin_summary": candidate['linkedin_summary'],
            "linkedin_url": candidate.get('linkedin_url'),
            "company_website": candidate.get('company_website'),
            "status": candidate['status']
        },
        "match": {
            "id": candidate['match_id'],
            "score": candidate['score'],
            "key_highlights": key_highlights,
            "fit_reasoning": candidate['fit_reasoning'],
            "rank_position": candidate['rank_position']
        },
        "stats": stats
    }


@app.put("/api/candidates/{candidate_id}/accept")
async def accept_candidate(candidate_id: int):
    """Accept candidate and generate/retrieve personalized pitch."""
    candidate = await get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Update status to accepted
    await update_candidate_status(candidate_id, "accepted")

    # Check for pre-generated outreach
    existing_outreach = await get_outreach_by_candidate_id(candidate_id)
    
    if existing_outreach:
        print(f"Using pre-generated pitch for candidate {candidate_id}")
        # Update status to draft if it was generated
        if existing_outreach['delivery_status'] == 'generated':
             await update_outreach_status(existing_outreach['id'], "draft")
        
        return {
            "status": "draft_retrieved",
            "pitch": {
                "subject": existing_outreach['subject'],
                "body": existing_outreach['body']
            },
            "outreach_id": existing_outreach['id']
        }

    # If no pre-generated pitch, generate one now
    # Get job and match details
    job = await get_job(candidate['job_id'])

    # Get match details (need to query separately)
    import aiosqlite
    from database import DB_PATH
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM matches WHERE candidate_id = ?",
            (candidate_id,)
        )
        match_row = await cursor.fetchone()
        match = dict(match_row) if match_row else None

    if not match:
        raise HTTPException(status_code=500, detail="Match data not found")

    # Parse JSON fields
    candidate['skills'] = json.loads(candidate['skills']) if isinstance(candidate['skills'], str) else candidate['skills']
    match['key_highlights'] = json.loads(match['key_highlights']) if isinstance(match['key_highlights'], str) else match['key_highlights']

    # Generate pitch with PitchWriterAgent
    print(f"Generating pitch for candidate {candidate_id} (On-demand)...")
    pitch = await pitch_writer_agent.create_pitch(job, candidate, match)

    # Create outreach record as DRAFT
    outreach_id = await create_outreach(
        job_id=candidate['job_id'],
        candidate_id=candidate_id,
        subject=pitch['subject'],
        body=pitch['body'],
        delivery_status="draft"
    )

    return {
        "status": "draft_created",
        "pitch": pitch,
        "outreach_id": outreach_id
    }


@app.put("/api/candidates/{candidate_id}/reject")
async def reject_candidate(candidate_id: int):
    """Reject candidate."""
    candidate = await get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    await update_candidate_status(candidate_id, "rejected")

    # Get next candidate
    next_candidate = await get_next_candidate(candidate['job_id'])

    if not next_candidate:
        return {
            "status": "success",
            "next_candidate": None,
            "message": "No more candidates available"
        }

    # Parse JSON fields
    skills = json.loads(next_candidate['skills']) if isinstance(next_candidate['skills'], str) else next_candidate['skills']
    key_highlights = json.loads(next_candidate['key_highlights']) if isinstance(next_candidate['key_highlights'], str) else next_candidate['key_highlights']

    return {
        "status": "success",
        "next_candidate": {
            "candidate": {
                "id": next_candidate['id'],
                "name": next_candidate['name'],
                "current_role": next_candidate['current_role'],
                "current_company": next_candidate['current_company'],
                "years_experience": next_candidate['years_experience'],
                "skills": skills,
                "location": next_candidate['location'],
                "email": next_candidate['email'],
                "linkedin_summary": next_candidate['linkedin_summary']
            },
            "match": {
                "score": next_candidate['score'],
                "key_highlights": key_highlights,
                "fit_reasoning": next_candidate['fit_reasoning'],
                "rank_position": next_candidate['rank_position']
            }
        }
    }


@app.get("/api/jobs/{job_id}/stats")
async def get_stats(job_id: int):
    """Get job statistics."""
    stats = await get_job_stats(job_id)
    return stats


@app.post("/api/outreach/send")
async def send_outreach(request: OutreachSendRequest):
    """Update draft content and send email."""
    outreach = await get_outreach(request.outreach_id)
    if not outreach:
        raise HTTPException(status_code=404, detail="Outreach record not found")

    # Update content with user edits
    await update_outreach_content(request.outreach_id, request.subject, request.body)

    # Get candidate email
    candidate = await get_candidate(outreach['candidate_id'])
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Send email
    success, message = outreach_agent.send_email(
        to_email=candidate['email'],
        subject=request.subject,
        body=request.body
    )

    # Update status
    from datetime import datetime
    if success:
        await update_outreach_status(request.outreach_id, "sent", datetime.now())
        await update_candidate_status(candidate['id'], "contacted")
    else:
        await update_outreach_status(request.outreach_id, "failed", error_message=message)

    return {
        "status": "success" if success else "failed",
        "delivery_message": message
    }


@app.get("/api/jobs/{job_id}/candidates/by-status/{status}")
async def get_candidates_by_status(job_id: int, status: str):
    """Get all candidates filtered by status."""
    import aiosqlite
    from database import DB_PATH

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT c.*, m.score, m.key_highlights
               FROM candidates c
               JOIN matches m ON c.id = m.candidate_id
               WHERE c.job_id = ? AND c.status = ?
               ORDER BY m.score DESC""",
            (job_id, status)
        )
        rows = await cursor.fetchall()

        candidates = []
        for row in rows:
            candidate_dict = dict(row)
            # Parse JSON fields
            skills = json.loads(candidate_dict['skills']) if isinstance(candidate_dict['skills'], str) else candidate_dict['skills']
            key_highlights = json.loads(candidate_dict['key_highlights']) if isinstance(candidate_dict['key_highlights'], str) else candidate_dict['key_highlights']

            candidates.append({
                "id": candidate_dict['id'],
                "name": candidate_dict['name'],
                "current_role": candidate_dict['current_role'],
                "current_company": candidate_dict['current_company'],
                "years_experience": candidate_dict['years_experience'],
                "skills": skills,
                "location": candidate_dict['location'],
                "email": candidate_dict['email'],
                "linkedin_summary": candidate_dict['linkedin_summary'],
                "linkedin_url": candidate_dict.get('linkedin_url'),
                "company_website": candidate_dict.get('company_website'),
                "status": candidate_dict['status'],
                "score": candidate_dict['score'],
                "key_highlights": key_highlights
            })

        return candidates


@app.get("/")
async def root():
    """Health check."""
    return {"status": "ok", "message": "Agentic Recruiter API"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
