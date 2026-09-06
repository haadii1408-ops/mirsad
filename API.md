# MIRSAD V2 API

## Authentication
POST `/api/auth/login`
```json
{"email":"...","password":"..."}
```

## Evidence
GET `/api/evidence`
POST `/api/evidence` multipart: `title`, `file`
GET `/api/evidence/:id/analysis`

## Indicators
GET `/api/indicators`

## Human review
POST `/api/evidence/:id/review`
```json
{"link_id":"UUID","status":"APPROVED"}
```

## Schools
GET `/api/schools` (OWNER)
POST `/api/schools` (OWNER)
```json
{"name":"اسم المدرسة","email":"admin@example.sa","password":"12+ chars"}
```

## Design principle
One evidence can create many `evidence_links`, each pointing to a different indicator and carrying:
- confidence
- proof_location
- rationale
- reviewer_status

The engine also records missing evidence dimensions and complementary recommendations.
