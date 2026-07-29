from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import os, uuid, shutil
from datetime import datetime, timezone

from db.database import get_db
from models.models import Project, Team, Station, Progress, EventLog, ChainStep
from core.station_router import assign_routes
from core import whatsapp as wa
from api.auth import verify_token

router = APIRouter()

# ─── Upload ───────────────────────────────────────────────────────────────────

ALLOWED = {"image/jpeg", "image/png", "image/gif", "image/webp"}

@router.post("/upload")
async def upload_image(file: UploadFile = File(...), x_api_key: str = Header(default="")):
    username = None
    if x_api_key == os.getenv("ADMIN_API_KEY", "changeme"):
        username = "__admin__"
    else:
        from api.auth import verify_token
        username = verify_token(x_api_key)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if file.content_type not in ALLOWED:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, GIF, WEBP allowed")

    # Upload to Cloudinary if configured, otherwise fall back to local storage
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    if cloud_name:
        import cloudinary
        import cloudinary.uploader
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=os.getenv("CLOUDINARY_API_KEY"),
            api_secret=os.getenv("CLOUDINARY_API_SECRET"),
        )
        contents = await file.read()
        result = cloudinary.uploader.upload(contents, folder="race-and-run")
        return {"url": result["secure_url"]}
    else:
        # Local fallback (dev only — not accessible by Twilio)
        upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "static", "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
        filename = f"{uuid.uuid4().hex}.{ext}"
        dest = os.path.join(upload_dir, filename)
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"url": f"/static/uploads/{filename}"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

LEGACY_USER = "__admin__"  # placeholder owner for legacy API-key logins

def require_api_key(x_api_key: str = Header(default="")) -> str:
    """Returns the username of the authenticated user."""
    if x_api_key == os.getenv("ADMIN_API_KEY", "changeme"):
        return LEGACY_USER
    username = verify_token(x_api_key)
    if username:
        return username
    raise HTTPException(status_code=401, detail="Invalid credentials")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    org: str = ""
    event_date: str = ""
    team_count: int = 4

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    org: Optional[str] = None
    event_date: Optional[str] = None
    status: Optional[str] = None
    scoring_wrong_pts: Optional[int] = None
    scoring_wrong_time: Optional[int] = None
    scoring_hint_pts: Optional[int] = None
    scoring_answer_pts: Optional[int] = None
    scoring_stage_pts: Optional[int] = None
    finish_message: Optional[str] = None

class TeamCreate(BaseModel):
    name: str
    leader_name: str = ""
    mobile: str = ""
    group_number: str = ""
    member_numbers: list = []

class ChainStepCreate(BaseModel):
    clue_text: str = ""
    clue_media_url: str = ""
    answer: str = ""
    hint_text: str = ""
    hint_media_url: str = ""
    photo_required: bool = False

class StationCreate(BaseModel):
    station_code: str
    name: str
    order_index: int = 0
    mission_type: str = "text"
    clue_text: str = ""
    clue_media_url: str = ""
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    answer: str
    hint_text: str = ""
    hint_media_url: str = ""
    hint_cost: int = 5
    answer_cost: int = 20
    photo_required: bool = False
    chain_clue: str = ""
    chain_media_url: str = ""
    chain_answer: str = ""
    chain_hint: str = ""
    chain_hint_media_url: str = ""
    chain_photo_required: bool = False
    is_final: bool = False
    chain_steps: list = []

class BroadcastMsg(BaseModel):
    message: str

class PenaltyApply(BaseModel):
    team_id: str
    reason: str
    pts: int = 10
    time_mins: int = 5


# ─── Projects ─────────────────────────────────────────────────────────────────

@router.get("/projects")
def list_projects(db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    projects = (
        db.query(Project)
        .filter(Project.user_id == user)
        .order_by(Project.created_at.desc())
        .all()
    )
    return [_project_dict(p) for p in projects]


@router.post("/projects")
def create_project(data: ProjectCreate, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = Project(name=data.name, org=data.org, event_date=data.event_date, user_id=user)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _project_dict(p)


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    return _project_dict(p, detail=True)


@router.patch("/projects/{project_id}")
def update_project(project_id: str, data: ProjectUpdate, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    for field, value in data.dict(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    return _project_dict(p)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    db.delete(p)
    db.commit()
    return {"ok": True}


# ─── Race control ─────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/start")
async def start_race(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    if not p.stations:
        raise HTTPException(400, "Add stations before starting")
    if not p.teams:
        raise HTTPException(400, "Add teams before starting")

    # Wipe any leftover progress from a previous run of this project (e.g. earlier
    # testing) so stale flags like awaiting_chain can never carry over into a fresh
    # start — "Start race" should always mean a clean slate for every team.
    team_ids = [t.id for t in p.teams]
    if team_ids:
        db.query(Progress).filter(Progress.team_id.in_(team_ids)).delete(synchronize_session=False)

    assign_routes(p, db)

    p.status = "live"
    for team in p.teams:
        team.status = "racing"
        team.start_time = datetime.now(timezone.utc)
        team.end_time = None
    db.commit()

    for team in p.teams:
        first_station = None
        for code in team.route:
            first_station = db.query(Station).filter_by(
                project_id=p.id, station_code=code
            ).first()
            if first_station:
                break

        await wa.send_text(
            team.group_number,
            f"🏁 *{p.name} has begun!*\n\n"
            f"Welcome, team *{team.name}*!\n"
            f"You have {len(p.stations)} stations to complete.\n\n"
            f"Here is your first mission 👇"
        )
        if first_station:
            await wa.send_station(team.group_number, first_station, p)

    return {"ok": True, "message": "Race started, missions sent to all teams"}


@router.post("/projects/{project_id}/end")
def end_race(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    p.status = "done"
    for team in p.teams:
        if team.status == "racing":
            team.status = "finished"
    db.commit()
    return {"ok": True}


@router.post("/projects/{project_id}/broadcast")
async def broadcast(project_id: str, data: BroadcastMsg, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    for team in p.teams:
        await wa.send_text(team.group_number, data.message)
    return {"ok": True, "sent_to": len(p.teams)}


@router.post("/projects/{project_id}/penalty")
async def apply_penalty(project_id: str, data: PenaltyApply, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    team = _get_or_404(db, Team, data.team_id)
    log = EventLog(
        team_id=team.id,
        project_id=project_id,
        event_type="penalty",
        message=f"Manual penalty: {data.reason}",
        pts_change=-data.pts,
        time_added=data.time_mins,
    )
    db.add(log)
    db.commit()
    await wa.send_text(
        team.group_number,
        f"⚠️ *Penalty applied*\n{data.reason}\n"
        f"-{data.pts} pts · +{data.time_mins} min"
    )
    return {"ok": True}


@router.post("/projects/{project_id}/shuffle-routes")
def shuffle_routes(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    assign_routes(p, db)
    return {"ok": True, "routes": {t.name: t.route for t in p.teams}}


class RouteUpdate(BaseModel):
    route: list

@router.patch("/projects/{project_id}/teams/{team_id}/route")
def update_team_route(project_id: str, team_id: str, data: RouteUpdate,
                      db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    _get_or_404_owned(db, project_id, user)
    t = db.query(Team).filter_by(id=team_id, project_id=project_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Team not found")
    t.route = data.route
    db.commit()
    return {"ok": True}


# ─── Stations ─────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/stations")
def list_stations(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    stations = db.query(Station).filter_by(project_id=project_id).order_by(Station.order_index).all()
    return [_station_dict(s) for s in stations]


@router.post("/projects/{project_id}/stations")
def create_station(project_id: str, data: StationCreate, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    _get_or_404_owned(db, project_id, user)
    data_dict = data.dict()
    chain_steps_data = data_dict.pop('chain_steps', [])
    data_dict['answer'] = data.answer.upper().strip()
    s = Station(project_id=project_id, **data_dict)
    db.add(s)
    db.flush()
    for i, step in enumerate(chain_steps_data):
        cs = ChainStep(station_id=s.id, order_index=i,
                       clue_text=step.get('clue_text',''),
                       clue_media_url=step.get('clue_media_url',''),
                       answer=step.get('answer','').upper().strip(),
                       hint_text=step.get('hint_text',''),
                       hint_media_url=step.get('hint_media_url',''),
                       photo_required=step.get('photo_required', False))
        db.add(cs)
    db.commit()
    db.refresh(s)
    return _station_dict(s)


@router.patch("/projects/{project_id}/stations/{station_id}")
def update_station(project_id: str, station_id: str, data: StationCreate, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    s = _get_or_404(db, Station, station_id)
    data_dict = data.dict()
    chain_steps_data = data_dict.pop('chain_steps', [])
    for field, value in data_dict.items():
        setattr(s, field, value)
    s.answer = s.answer.upper().strip()
    # Replace chain steps
    db.query(ChainStep).filter_by(station_id=s.id).delete()
    for i, step in enumerate(chain_steps_data):
        cs = ChainStep(station_id=s.id, order_index=i,
                       clue_text=step.get('clue_text',''),
                       clue_media_url=step.get('clue_media_url',''),
                       answer=step.get('answer','').upper().strip(),
                       hint_text=step.get('hint_text',''),
                       hint_media_url=step.get('hint_media_url',''),
                       photo_required=step.get('photo_required', False))
        db.add(cs)
    db.commit()
    return _station_dict(s)


@router.delete("/projects/{project_id}/stations/{station_id}")
def delete_station(project_id: str, station_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    s = _get_or_404(db, Station, station_id)
    db.delete(s)
    db.commit()
    return {"ok": True}


# ─── Teams ────────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/teams")
def list_teams(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    teams = db.query(Team).filter_by(project_id=project_id).all()
    return [_team_dict(t) for t in teams]


@router.post("/projects/{project_id}/teams")
def create_team(project_id: str, data: TeamCreate, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    _get_or_404_owned(db, project_id, user)
    t = Team(project_id=project_id, **data.dict())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _team_dict(t)


@router.delete("/projects/{project_id}/teams/{team_id}")
def delete_team(project_id: str, team_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    t = _get_or_404(db, Team, team_id)
    db.delete(t)
    db.commit()
    return {"ok": True}


# ─── Leaderboard + Logs ───────────────────────────────────────────────────────

@router.get("/projects/{project_id}/leaderboard")
def get_leaderboard(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    p = _get_or_404_owned(db, project_id, user)
    teams = sorted(p.teams, key=lambda t: (-t.stages_done, t.penalty_mins))
    return [_team_dict(t, rank=i+1) for i, t in enumerate(teams)]


@router.get("/projects/{project_id}/logs")
def get_logs(project_id: str, db: Session = Depends(get_db), user: str = Depends(require_api_key)):
    logs = (
        db.query(EventLog)
        .filter_by(project_id=project_id)
        .order_by(EventLog.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": l.id,
            "team_id": l.team_id,
            "event_type": l.event_type,
            "station_code": l.station_code,
            "message": l.message,
            "pts_change": l.pts_change,
            "time_added": l.time_added,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_or_404(db, model, id):
    obj = db.query(model).filter_by(id=id).first()
    if not obj:
        raise HTTPException(404, f"{model.__name__} not found")
    return obj


def _get_or_404_owned(db, project_id: str, user: str):
    """Get a project, enforcing ownership. Legacy rows (user_id=None) are accessible to all."""
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    if p.user_id is not None and p.user_id != user:
        raise HTTPException(403, "You don't have access to this project")
    return p


def _project_dict(p: Project, detail=False):
    d = {
        "id": p.id,
        "name": p.name,
        "org": p.org,
        "event_date": p.event_date,
        "status": p.status,
        "station_count": len(p.stations),
        "team_count": len(p.teams),
        "finish_message": p.finish_message or "",
        "scoring": {
            "wrong_pts": p.scoring_wrong_pts,
            "wrong_time": p.scoring_wrong_time,
            "hint_pts": p.scoring_hint_pts,
            "answer_pts": p.scoring_answer_pts,
            "stage_pts": p.scoring_stage_pts,
        },
    }
    if detail:
        d["teams"] = [_team_dict(t) for t in p.teams]
        d["stations"] = [_station_dict(s) for s in p.stations]
        # Collect all photo submissions across all teams
        station_map = {s.id: s.station_code for s in p.stations}
        photos = []
        for t in p.teams:
            for pr in t.progress:
                if pr.photo_url:
                    photos.append({
                        "team_name": t.name,
                        "station_code": station_map.get(pr.station_id, "?"),
                        "photo_url": pr.photo_url,
                        "submitted_at": pr.completed_at.isoformat() if pr.completed_at else None,
                    })
        d["photo_submissions"] = sorted(photos, key=lambda x: x["submitted_at"] or "", reverse=True)
    return d


def _team_dict(t: Team, rank=None):
    return {
        "id": t.id,
        "name": t.name,
        "leader_name": t.leader_name,
        "mobile": t.mobile,
        "group_number": t.group_number,
        "member_numbers": t.member_numbers or [],
        "status": t.status,
        "route": t.route,
        "stages_done": t.stages_done,
        "wrong_count": t.wrong_count,
        "hints_used": t.hints_used,
        "penalty_mins": t.penalty_mins,
        "start_time": t.start_time.isoformat() if t.start_time else None,
        "end_time": t.end_time.isoformat() if t.end_time else None,
        **({"rank": rank} if rank else {}),
    }


def _station_dict(s: Station):
    return {
        "id": s.id,
        "station_code": s.station_code,
        "name": s.name,
        "order_index": s.order_index,
        "mission_type": s.mission_type,
        "clue_text": s.clue_text,
        "clue_media_url": s.clue_media_url,
        "gps_lat": s.gps_lat,
        "gps_lng": s.gps_lng,
        "answer": s.answer,
        "hint_text": s.hint_text,
        "hint_media_url": s.hint_media_url or "",
        "hint_cost": s.hint_cost,
        "answer_cost": s.answer_cost,
        "photo_required": s.photo_required,
        "chain_clue": s.chain_clue or "",
        "chain_media_url": s.chain_media_url or "",
        "chain_answer": s.chain_answer or "",
        "chain_hint": s.chain_hint or "",
        "chain_hint_media_url": s.chain_hint_media_url or "",
        "chain_photo_required": s.chain_photo_required or False,
        "is_final": s.is_final or False,
        "chain_steps": [
            {
                "clue_text": cs.clue_text or "",
                "clue_media_url": cs.clue_media_url or "",
                "answer": cs.answer or "",
                "hint_text": cs.hint_text or "",
                "hint_media_url": cs.hint_media_url or "",
                "photo_required": cs.photo_required or False,
            }
            for cs in (s.chain_steps or [])
        ],
    }