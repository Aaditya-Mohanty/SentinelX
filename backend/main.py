import os
import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import engine, get_db, Base
from backend.models import User, Endpoint, Alert, SystemLog, AIChatMessage
from backend.auth.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    require_analyst_or_admin,
    require_any_user,
    require_admin
)
from backend.ai_engine.ai_analyst import ai_analyst
from backend.websocket.websocket_manager import manager

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SentinelX AI SOC Platform API",
    description="Multi-tenant cybersecurity Security Operations Center (SOC) platform backend API.",
    version="1.0.0"
)

# CORS configuration
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")] if settings.CORS_ORIGINS else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seed demo user on startup
db = next(get_db())
try:
    demo_user = db.query(User).filter(User.username == "demo").first()
    if not demo_user:
        hashed_pwd = get_password_hash("Demo123")
        demo_user = User(
            username="demo",
            email="demo@sentinelx.ai",
            password_hash=hashed_pwd,
            role="demo"
        )
        db.add(demo_user)
        db.commit()
        db.refresh(demo_user)
        print("[+] Pre-seeded demo user (demo@sentinelx.ai / Demo123) successfully.")
finally:
    db.close()

# Pydantic Schemas
class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str

class EndpointRegister(BaseModel):
    hostname: str
    os: str
    ip_address: Optional[str] = None

class LogPayload(BaseModel):
    log_type: str
    log_content: str
    severity: str

class AgentReport(BaseModel):
    endpoint_id: int
    cpu_usage: float
    ram_usage: float
    disk_usage: float
    processes: List[str]
    logs: List[LogPayload]

class ChatRequest(BaseModel):
    message: str

# Mount static folder for agent downloads
os.makedirs(os.path.join(os.path.dirname(__file__), "static"), exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

# Serve frontend static assets locally
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.exists(frontend_dir):
    app.mount("/js", StaticFiles(directory=os.path.join(frontend_dir, "js")), name="js")
    
    @app.get("/")
    def read_root():
        return FileResponse(os.path.join(frontend_dir, "index.html"))
        
    @app.get("/index.html")
    def read_index():
        return FileResponse(os.path.join(frontend_dir, "index.html"))
        
    @app.get("/dashboard.html")
    def read_dashboard():
        return FileResponse(os.path.join(frontend_dir, "dashboard.html"))

# AUTH ENDPOINTS
@app.post("/api/auth/register", response_model=Token)
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    # Check if username or email exists
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pwd = get_password_hash(user_data.password)
    user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=hashed_pwd,
        role="analyst"  # Default role
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(data={"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

@app.post("/api/auth/login", response_model=Token)
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_data.username).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    token = create_access_token(data={"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

@app.get("/api/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role
    }

# AGENT ENDPOINTS
@app.post("/api/agent/register")
def register_agent(payload: EndpointRegister, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Check if endpoint already registered for this user
    endpoint = db.query(Endpoint).filter(
        Endpoint.user_id == current_user.id, 
        Endpoint.hostname == payload.hostname
    ).first()
    
    if not endpoint:
        endpoint = Endpoint(
            user_id=current_user.id,
            hostname=payload.hostname,
            os=payload.os,
            ip_address=payload.ip_address,
            status="online",
            last_ping=datetime.datetime.utcnow()
        )
        db.add(endpoint)
    else:
        endpoint.status = "online"
        endpoint.last_ping = datetime.datetime.utcnow()
        endpoint.ip_address = payload.ip_address
        
    db.commit()
    db.refresh(endpoint)
    return {"endpoint_id": endpoint.id}

@app.post("/api/agent/report")
async def report_metrics(payload: AgentReport, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    endpoint = db.query(Endpoint).filter(
        Endpoint.id == payload.endpoint_id,
        Endpoint.user_id == current_user.id
    ).first()
    
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    # Update endpoint stats
    endpoint.cpu_usage = payload.cpu_usage
    endpoint.ram_usage = payload.ram_usage
    endpoint.disk_usage = payload.disk_usage
    endpoint.status = "online"
    endpoint.last_ping = datetime.datetime.utcnow()
    
    db.commit()

    # Process logs & trigger detection logic
    mitre_mappings = {
        "failed": ("SSH Brute Force Attempt", "T1110", "Credential Access", "medium"),
        "invalid": ("SSH Invalid User Login", "T1110", "Credential Access", "medium"),
        "sql": ("SQL Injection Pattern", "T1190", "Initial Access", "high"),
        "nc": ("Reverse Shell Connection", "T1059", "Execution", "critical"),
        "nmap": ("Port Scanning Activity", "T1046", "Discovery", "low"),
        "hydra": ("Automated Password Guessing", "T1110", "Credential Access", "high"),
        "privilege": ("Privilege Escalation Attempt", "T1068", "Privilege Escalation", "high")
    }

    alerts_triggered = []

    for log in payload.logs:
        # Create system log
        sys_log = SystemLog(
            user_id=current_user.id,
            endpoint_id=endpoint.id,
            log_type=log.log_type,
            log_content=log.log_content,
            severity=log.severity
        )
        db.add(sys_log)
        
        # Check rule engines
        content_lower = log.log_content.lower()
        for pattern, (attack_type, mitre_id, tactic, severity) in mitre_mappings.items():
            if pattern in content_lower:
                # Add security alert
                alert = Alert(
                    user_id=current_user.id,
                    endpoint_id=endpoint.id,
                    severity=severity,
                    attack_type=attack_type,
                    mitre_id=mitre_id,
                    tactic=tactic,
                    description=log.log_content,
                    status="unresolved"
                )
                db.add(alert)
                db.commit()
                db.refresh(alert)
                
                # Format websocket message
                ws_alert = {
                    "event": "new_alert",
                    "data": {
                        "id": alert.id,
                        "endpoint": endpoint.hostname,
                        "attack_type": alert.attack_type,
                        "severity": alert.severity,
                        "mitre_id": alert.mitre_id,
                        "tactic": alert.tactic,
                        "timestamp": alert.timestamp.isoformat(),
                        "status": alert.status
                    }
                }
                alerts_triggered.append(ws_alert)
                # Broadcast immediately
                await manager.broadcast_to_user(current_user.id, ws_alert)
                break
                
    db.commit()
    
    # Broadcast general metric update
    await manager.broadcast_to_user(current_user.id, {
        "event": "metric_update",
        "data": {
            "endpoint_id": endpoint.id,
            "hostname": endpoint.hostname,
            "cpu": endpoint.cpu_usage,
            "ram": endpoint.ram_usage,
            "disk": endpoint.disk_usage,
            "status": "online"
        }
    })
    
    return {"status": "ok", "alerts_triggered": len(alerts_triggered)}

# WEBSOCKET CONNECTION
@app.websocket("/ws/{client_token}")
async def websocket_endpoint(websocket: WebSocket, client_token: str, db: Session = Depends(get_db)):
    # Validate token inside WebSocket handshake
    try:
        from jose import jwt
        payload = jwt.decode(client_token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user = db.query(User).filter(User.username == username).first()
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, user.id)
    try:
        while True:
            # We can receive ping/pong or client instructions here
            data = await websocket.receive_text()
            # Send keepalive
            await websocket.send_json({"event": "ack", "data": "ping"})
    except WebSocketDisconnect:
        manager.disconnect(websocket, user.id)

# SOC DASHBOARD APIS
@app.get("/api/dashboard/stats")
def get_dashboard_stats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    endpoints = db.query(Endpoint).filter(Endpoint.user_id == current_user.id).all()
    alerts = db.query(Alert).filter(Alert.user_id == current_user.id).all()
    
    total_endpoints = len(endpoints)
    online_endpoints = sum(1 for e in endpoints if e.status == "online")
    
    total_alerts = len(alerts)
    unresolved_alerts = sum(1 for a in alerts if a.status == "unresolved")
    critical_alerts = sum(1 for a in alerts if a.severity == "critical")
    
    # Calculate Risk Score (out of 100)
    # Critical Alert: 25 points, High Alert: 10 points, Medium: 5, Low: 1
    risk_score = 0
    if unresolved_alerts > 0:
        for a in alerts:
            if a.status == "unresolved":
                if a.severity == "critical":
                    risk_score += 25
                elif a.severity == "high":
                    risk_score += 10
                elif a.severity == "medium":
                    risk_score += 5
                else:
                    risk_score += 1
        risk_score = min(risk_score, 100)
    
    return {
        "total_endpoints": total_endpoints,
        "online_endpoints": online_endpoints,
        "total_alerts": total_alerts,
        "unresolved_alerts": unresolved_alerts,
        "critical_alerts": critical_alerts,
        "risk_score": risk_score
    }

@app.get("/api/dashboard/endpoints")
def get_endpoints(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    endpoints = db.query(Endpoint).filter(Endpoint.user_id == current_user.id).all()
    return [{
        "id": e.id,
        "hostname": e.hostname,
        "os": e.os,
        "ip_address": e.ip_address,
        "status": e.status,
        "cpu_usage": e.cpu_usage,
        "ram_usage": e.ram_usage,
        "disk_usage": e.disk_usage,
        "last_ping": e.last_ping.isoformat()
    } for e in endpoints]

@app.get("/api/dashboard/alerts")
def get_alerts(severity: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Alert).filter(Alert.user_id == current_user.id)
    if severity:
        query = query.filter(Alert.severity == severity)
    
    alerts = query.order_by(Alert.timestamp.desc()).all()
    return [{
        "id": a.id,
        "endpoint": a.endpoint.hostname if a.endpoint else "Unknown",
        "severity": a.severity,
        "attack_type": a.attack_type,
        "mitre_id": a.mitre_id,
        "tactic": a.tactic,
        "description": a.description,
        "status": a.status,
        "timestamp": a.timestamp.isoformat()
    } for a in alerts]

@app.post("/api/dashboard/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id, Alert.user_id == current_user.id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert.status = "resolved"
    db.commit()
    return {"status": "resolved"}

# AI CHAT AND TRIAGE ENDPOINTS
@app.post("/api/ai/chat")
def post_chat_message(request: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Create User Chat Message
    user_msg = AIChatMessage(user_id=current_user.id, role="user", content=request.message)
    db.add(user_msg)
    db.commit()

    # Get Chat History (limit last 15)
    history = db.query(AIChatMessage).filter(AIChatMessage.user_id == current_user.id).order_by(AIChatMessage.timestamp.asc()).all()
    history_payload = [{"role": msg.role, "content": msg.content} for msg in history]

    # Generate AI Analyst Response
    ai_response_text = ai_analyst.generate_chat_response(history_payload)

    # Save Assistant Chat Message
    assistant_msg = AIChatMessage(user_id=current_user.id, role="assistant", content=ai_response_text)
    db.add(assistant_msg)
    db.commit()

    return {"response": ai_response_text}

@app.get("/api/ai/history")
def get_chat_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    history = db.query(AIChatMessage).filter(AIChatMessage.user_id == current_user.id).order_by(AIChatMessage.timestamp.asc()).all()
    return [{"role": msg.role, "content": msg.content, "timestamp": msg.timestamp.isoformat()} for msg in history]

@app.post("/api/ai/analyze-alert/{alert_id}")
def analyze_specific_alert(alert_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id, Alert.user_id == current_user.id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    analysis = ai_analyst.analyze_alert(alert.attack_type, alert.description, alert.severity)
    return {"analysis": analysis}
