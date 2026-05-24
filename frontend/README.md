# NASA Space Biology AI Agent Frontend

Modern React/Vite SaaS frontend for the existing FastAPI backend.

## Stack

- React + Vite
- Tailwind CSS
- React Router
- Axios
- Framer Motion
- React Markdown
- Lucide React
- Firebase Authentication for Google sign-in UI

## Install

```bash
cd frontend
npm install
```

## Environment

Create `frontend/.env`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000

VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_STORAGE_BUCKET=
```

If your FastAPI server is on another port, update `VITE_API_BASE_URL`.

## Run Locally

Start the backend:

```bash
python3 -m uvicorn main:app --reload
```

Start the frontend:

```bash
cd frontend
npm run dev
```

Open:

```bash
http://127.0.0.1:5173
```

## Firebase Google Sign-In

1. Go to Firebase Console.
2. Create or select a project.
3. Add a Web App.
4. Copy the Firebase config values into `frontend/.env`.
5. Open Authentication > Sign-in method.
6. Enable Google provider.
7. Add your local domain, such as `localhost`, to authorized domains.

The current FastAPI backend issues JWTs through `/login`. This frontend completes the Firebase Google sign-in flow and stores the Google profile client-side, then asks the user to create or link a normal platform account so the app can receive the existing backend JWT without changing backend APIs.

## API Endpoints Used

- `POST /signup`
- `POST /login`
- `POST /logout`
- `GET /me`
- `GET /history`
- `POST /ask`

## Build

```bash
cd frontend
npm run build
```

Static assets are generated in `frontend/dist`.

## Deploy

Deploy `frontend/dist` to Vercel, Netlify, Cloudflare Pages, S3, or any static host.

Set `VITE_API_BASE_URL` to your deployed FastAPI URL before building:

```bash
VITE_API_BASE_URL=https://your-api.example.com npm run build
```

Your FastAPI deployment must allow the frontend origin with CORS if the frontend and backend are on different domains.
