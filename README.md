# JyotishGPT — Vedic Astrology AI Chatbot

An AI-powered Vedic astrology (Jyotish) chatbot that generates personalized birth chart readings using the [VedAstro Open API](https://vedastro.org) and Claude LLM with chain-of-thought reasoning.

## Features

- **Vedic Birth Chart Analysis** — Planetary positions, house placements, horoscope predictions via VedAstro API
- **AI Chain-of-Thought Reasoning** — 2-step LLM process: internal astrological reasoning → polished response
- **Location Auto-Search** — Type a city name, get auto-complete results with coordinates from VedAstro
- **Conversation Memory** — Retains last 20 messages per conversation for contextual follow-ups
- **RAG (Retrieval-Augmented Generation)** — Upload Vedic astrology books/texts for enhanced AI responses
- **Real-Time Streaming** — Server-Sent Events for live response streaming
- **Dark/Light Theme** — Vedic-inspired indigo/gold color scheme with theme toggle
- **Multiple Birth Profiles** — Save and switch between different birth charts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| Backend | Express.js (Node 20) |
| Database | SQLite + Drizzle ORM + FTS5 (full-text search for RAG) |
| LLM | Anthropic Claude via `@anthropic-ai/sdk` |
| Astrology | [VedAstro Open API](https://vedastro.org) (free public API) |
| Fonts | Satoshi, Zodiak (Fontshare) + JetBrains Mono |

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   React UI   │────▶│ Express API  │────▶│  VedAstro API   │
│  (Vite SPA)  │     │  (port 5000) │     │ (vedastro.org)  │
└──────────────┘     ├──────────────┤     └─────────────────┘
                     │  Claude LLM  │
                     │  (Anthropic) │
                     ├──────────────┤
                     │ SQLite + FTS │
                     │  (data.db)   │
                     └──────────────┘
```

**VedAstro API Note**: The VedAstro Python package (`pip install vedastro`) is a thin HTTP wrapper — it calls `api.vedastro.org` for all calculations. There is no local computation engine. This app calls VedAstro's REST API directly from the Express backend, which is functionally identical and avoids the need for a Python sidecar process.

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+
- npm 9+
- An [Anthropic API key](https://console.anthropic.com/) (for Claude LLM)

### Setup

```bash
# Clone and install
git clone <your-repo-url>
cd vedic-chatbot
npm install

# Set up environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start dev server (frontend + backend on port 5000)
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

### Usage

1. Click **"New Profile"** to add birth details (date, time, place)
2. Type a city name — locations auto-complete with coordinates from VedAstro
3. Start chatting — ask about your chart, dashas, yogas, remedies, compatibility, etc.
4. Upload Vedic astrology texts (`.txt`) via the **Upload** button for enhanced RAG responses

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key for Claude LLM |
| `PORT` | No | `5000` | Server port |
| `NODE_ENV` | No | `development` | Set to `production` for optimized builds |
| `DATA_DIR` | No | `.` (current dir) | Directory for SQLite database (set to `/app/data` in Docker) |
| `LLM_MODEL` | No | `claude-sonnet-4-6` | Anthropic model ID (e.g. `claude-haiku-4-5` for lower cost) |

## Deployment

### Option 1: Railway (Recommended)

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repository
4. Add environment variable: `ANTHROPIC_API_KEY` = your key
5. Railway auto-detects the `railway.json` config and deploys

Railway provides a free tier with 500 hours/month. The app uses ~256 MB RAM.

### Option 2: Render

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → **New** → **Blueprint**
3. Connect your repo — Render reads `render.yaml` automatically
4. Set `ANTHROPIC_API_KEY` in the dashboard (marked as sync: false for security)
5. Deploy

Render's Starter plan ($7/month) includes a persistent disk for the SQLite database.

### Option 3: Docker (any cloud or VPS)

```bash
# Build and run with Docker Compose
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

docker compose up -d

# Or build manually
docker build -t jyotishgpt .
docker run -d \
  -p 5000:5000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v jyotishgpt-data:/app/data \
  --name jyotishgpt \
  jyotishgpt
```

Works on any Docker host: AWS EC2, DigitalOcean, Fly.io, Google Cloud Run, Azure Container Apps, etc.

### Option 4: AWS (your existing infrastructure)

Since you have AWS experience, you can deploy to:

- **AWS App Runner** — Point to your Docker image or GitHub repo
- **AWS ECS Fargate** — Serverless containers with the Dockerfile
- **AWS EC2** — Docker Compose on a t3.micro instance (free tier eligible)
- **AWS Lightsail** — Simple container service starting at $7/month

For any AWS option, set `ANTHROPIC_API_KEY` as an environment variable or secret.

## Production Build

```bash
# Build for production
npm run build

# Start production server
NODE_ENV=production node dist/index.cjs
```

The build outputs to `dist/` — `index.cjs` (server) and `public/` (static frontend).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/profiles` | Create a birth profile |
| `GET` | `/api/profiles` | List birth profiles |
| `POST` | `/api/conversations` | Create a conversation |
| `GET` | `/api/conversations` | List conversations |
| `DELETE` | `/api/conversations/:id` | Delete a conversation |
| `GET` | `/api/conversations/:id/messages` | Get messages |
| `POST` | `/api/chat` | Send a message (SSE streaming response) |
| `POST` | `/api/rag/upload` | Upload a text document for RAG |
| `GET` | `/api/rag/documents` | List uploaded RAG documents |
| `POST` | `/api/vedastro/calculate` | Direct VedAstro calculation |
| `GET` | `/api/vedastro/search-location?q=` | Search locations by name |
| `GET` | `/api/vedastro/timezone?lat=&lng=` | Lookup timezone for coordinates |

## VedAstro API Integration

The app calls three VedAstro endpoints per chat message (when a birth profile is selected):

1. **AllPlanetData** — All planetary positions (signs, degrees, nakshatras)
2. **AllHouseData** — House cusps and occupants
3. **HoroscopePredictions** — Pre-computed horoscope prediction texts

URL format: `https://vedastroapi.azurewebsites.net/api/Calculate/{Method}/Location/{City}/Time/{HH:MM}/{DD}/{MM}/{YYYY}/{timezone}`

API key: `FreeAPIUser` (public access, no registration needed)

## Project Structure

```
vedic-chatbot/
├── client/                  # React frontend
│   ├── src/
│   │   ├── pages/chat.tsx         # Main chat interface
│   │   ├── components/
│   │   │   ├── BirthProfileDialog.tsx  # Birth data + location search
│   │   │   └── RagUploadDialog.tsx     # File upload for RAG
│   │   └── index.css              # Vedic theme (indigo/gold)
│   └── index.html
├── server/
│   ├── routes.ts            # Express API + VedAstro + LLM orchestration
│   ├── storage.ts           # SQLite + Drizzle ORM + FTS5
│   └── index.ts             # Server entry point
├── shared/
│   └── schema.ts            # Database schema (Drizzle)
├── Dockerfile               # Multi-stage Docker build
├── docker-compose.yml       # Docker Compose config
├── railway.json             # Railway deployment config
├── render.yaml              # Render Blueprint
├── .env.example             # Environment variable template
└── package.json
```

## License

MIT

---

Built with [VedAstro](https://vedastro.org) | Powered by [Anthropic Claude](https://anthropic.com) | Created with [Perplexity Computer](https://perplexity.ai/computer)
