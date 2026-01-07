# fitDEGREE Gizmo (ServiceUp)

## Install
Copy this folder into your repo:
- `<repoRoot>/gizmos/fitdegree`

## Server registration
In your Express bootstrap (where you create `app`), add:

```js
import fitdegreeGizmo from "../gizmos/fitdegree/server/index.js";
fitdegreeGizmo.register(app);
```

This mounts routes at:
- `/api/gizmos/fitdegree/public/featured-classes`
- `/api/gizmos/fitdegree/public/instructors`

## ENV
Set these on Render (keys are blank by design):
- `FITDEGREE_API_KEY=`
- `FITDEGREE_FITSPOT_ID=782`
- `FITDEGREE_API_BASE=https://api.fitdegree.com`
- `FITDEGREE_AUTH_HEADER=Authorization`
- `FITDEGREE_AUTH_SCHEME=Bearer`

## If fitDEGREE paths differ
Edit:
- `gizmos/fitdegree/server/endpoints.js`

## UI blocks
`admin/blocks.json` is a generic block registry you can ingest in your UI.
