# 🏗️ Architecture — Gemini Tales

> Deep-dive into the system design, component responsibilities, data flows, and key design decisions.

---

## Table of Contents

1. [High-level Overview](#1-high-level-overview)
2. [Storytelling Modes](#2-storytelling-modes)
3. [Repository Layout](#3-repository-layout)
4. [Subsystem A — Dynamic Interaction (Frontend)](#4-subsystem-a--dynamic-interaction-frontend)
5. [Subsystem B — Multi-agent Story Engine (Backend)](#5-subsystem-b--multi-agent-story-engine-backend)
6. [Subsystem C — Character Workshop](#6-subsystem-c--character-workshop)
7. [Data Flows](#7-data-flows)
8. [Service Topology & Ports](#8-service-topology--ports)
9. [Deployment](#9-deployment)
10. [Key Design Decisions](#10-key-design-decisions)
11. [Tech Stack Summary](#11-tech-stack-summary)

---

Gemini Tales is an integrated AI storytelling system built on the Google Agent Development Kit (ADK). It allows users to generate interactive stories through two distinct pathways: **Live** and **Agent-driven**, acting as a **Creative Storyteller ✍️** that breaks the traditional "text box" paradigm.

| Component | Responsibility | Primary Technology |
|---|---|---|
| **Frontend** | "Magic Mirror" UI — Real-time interaction & media | React 19 / Vite / Tailwind |
| **Main Agent (Puck)** | Live Narrator — Handles voice, vision, and interleaved media | Python / FastAPI / Gemini Live 2.5 |
| **Supporting Brain** | Background agents for research, safety, and writing | Google ADK / A2A Protocol |
| **Media Factory** | Generates cinematic animations and illustrations | Veo 3.1 / Gemini 2.5 Flash-Image |

```mermaid
graph TD
    User([User]) <--> Browser["Browser (Magic Mirror UI)"]
    
    subgraph "Main Agent (Puck)"
        Browser <-->|WebSocket| LiveBridge[Live Bridge :8000]
        LiveBridge <--> MediaFactory[Media Factory]
    end
    
    subgraph "Google AI & Cloud Services"
        LiveBridge <-->|WebSocket| GeminiLive[Gemini Live 2.5 Flash]
        MediaFactory -->|Video Gen| Veo[Veo 3.1]
        MediaFactory -->|Image Gen| FlashImage[Gemini 2.5 Flash-Image]
        Orchestrator -->|Reasoning| GeminiPro[Gemini 3.1 Pro]
    end
    
    subgraph "Supporting Agents (ADK Brain)"
        LiveBridge -->|HTTP| Orchestrator[Orchestrator :8004]
        Orchestrator <-->|A2A| Researcher[Researcher :8001]
        Orchestrator <-->|A2A| Judge[Judge :8002]
        Orchestrator <-->|A2A| Storysmith[Storysmith :8003]
    end
    
    style Browser fill:#f9f,stroke:#333,stroke-width:2px
    style LiveBridge fill:#f9f,stroke:#333,stroke-width:2px
    style Orchestrator fill:#ccf,stroke:#333,stroke-width:2px
    style MediaFactory fill:#fff4dd,stroke:#d4a017,stroke-width:2px
```

---

## 2. Storytelling Modes

Gemini Tales now supports two core experiences, toggled via the UI.

### 2.1 Live Mode (Spontaneous)
In **Live Mode**, the system uses the native `Gemini Live` capabilities for an unscripted, highly interactive session. 
- **Latency**: Near-zero.
- **Narrative**: Emerges directly from the child's input.
- **Visuals**: Triggered by tool-calls during the live conversation.

### 2.2 Agent Mode (Structured)
In **Agent Mode**, the multi-agent backend pre-generates a story foundation before the live session begins.
1. **Research**: Adventure Seeker scouts facts/legends.
2. **Review**: Guardian of Balance ensures safety and physical activity density.
3. **Writing**: Storysmith weaves a Markdown-based epic.
4. **Narration**: The pre-generated text is injected into the Gemini Live session, where Puck (the AI avatar) narrates it with expressive character voices.

---

## 3. Repository Layout

```
gemini-tales/
├── frontend/                   # "Magic Mirror" React 19 Frontend
│   ├── src/                    # TSX components (Gemini Live integration)
│   └── package.json            # Node.js dependencies
│
├── backend/
│   ├── app/                    # Main Agent (Puck) & Media Factory
│   │   ├── main.py             # FastAPI WebSocket Entry Point
│   │   ├── avatar_generator.py # Veo 3.1 & Flash-Image Logic
│   │   └── routers/            # Puck Live & Agent Story Endpoints
│   │
│   └── agents/                 # Supporting ADK Brain
│       ├── researcher/         # Adventure Seeker (Search)
│       ├── judge/              # Guardian of Balance (Safety/Movement)
│       ├── content_builder/    # Storysmith (Narrative)
│       ├── orchestrator/       # Pipeline coordination
│       ├── shared/             # Shared Safety & Config
│       ├── run_local.ps1       # Local start for Brain microservices
│       └── deploy.ps1          # Cloud Run deployment script
```

---

## 4. Subsystem A — Interactive Story UI (Frontend)

The frontend is a high-performance web interface migrated to **TypeScript** for enhanced stability. It orchestrates a unified multimodal stream.

### 4.1 Multimodal Pipeline (Voice + Vision)

Unlike traditional chatbots, Gemini Tales uses a synchronized stream:
- **Unified Session**: A single WebSocket session handles both **PCM Audio** (captured via `AudioWorklet`) and **Video Frames** (1 FPS JPEG/Base64).
- **Spatial/Visual Context**: Gemini processes video frames in real-time, allowing it to comment on physical actions or surroundings during the audio story.

### 4.2 Auto-start Logic

To minimize friction, the application implements an automatic story trigger:
1. **Handshake**: Browser establishes `ws://` connection via the FastAPI proxy.
2. **Agent Sync**: Upon `SETUP_COMPLETE`, the frontend calls the `/api/chat_stream` endpoint.
3. **Pre-story Research**: The **Orchestrator** triggers the agent network (Researcher -> Judge -> Storysmith) to generate a structured story context based on search and safety rules.
4. **Context Injection**: The resulting story is injected into the Gemini Live session as a background "memory" trigger.
5. **Immersive Entry**: The AI begins the narrative based on the agent-generated plot, greeting the user with voice and an initial illustration.

### 4.3 Interactive Gameplay (Visual Feedback Loop)

The application implements a unique "Stop-and-Watch" mechanism:
- **Challenge Trigger**: The system instructions guide Gemini to ask for a physical action.
- **Immediate Silence**: The model is instructed to stop speaking and wait after the request.
- **Multimodal Verification**: Using the 1 FPS video feed and audio transcription, the "Live" model detects when the child has completed the action and said the magic word, then resumes the story with praise.

### 4.4 Media & Device Management

The UI includes a robust device initialization flow (`fetchDevices`) that handles permissions and allows users to swap microphones/cameras on-the-fly without breaking the live session.

---

## 5. Subsystem B — Multi-agent Story Engine (Backend)

### 5.1 Agent Roles

| Agent | Model | Key tools / output | ADK type |
|---|---|---|---|
| **Adventure Seeker** | `gemini-3.1-flash-lite` | `google_search` | `Agent` |
| **Guardian of Balance** | `gemini-3.1-flash-lite` | Safety/Quality Evaluation | `Agent` |
| **Storysmith** | `gemini-3.1-pro` | High-fidelity narrative | `Agent` |
| **Orchestrator** | — | A2A Coordination | `SequentialAgent` |

### 5.2 Orchestration Logic

```mermaid
stateDiagram-v2
    [*] --> ResearchLoop
    
    state ResearchLoop {
        [*] --> AdventureSeeker
        AdventureSeeker --> GuardianOfBalance: findings
        GuardianOfBalance --> EscalationChecker: feedback
        
        state EscalationChecker <<choice>>
        EscalationChecker --> [*]: status == "pass" (Escalate)
        EscalationChecker --> AdventureSeeker: status == "fail" (Loop)
    }
    
    ResearchLoop --> Storysmith
    Storysmith --> [*]
```

**EscalationChecker** is a custom `BaseAgent` subclass. It reads `session.state["judge_feedback"]` and yields an `Event(escalate=True)` to break the `LoopAgent`, or an empty event to continue.

### 5.3 A2A Communication

Each of the three leaf agents (Researcher, Judge, Content Builder) runs as a standalone **A2A server** (served by `adk_app.py`). The Orchestrator connects to them via `RemoteA2aAgent`, which:

1. Reads the agent card from `<agent_url>/.well-known/agent-card.json`
2. Posts tasks over HTTP using the A2A protocol
3. Uses an **authenticated HTTPX client** (`authenticated_httpx.py`) to attach Google OAuth2 bearer tokens automatically — required when deployed on Cloud Run

```
Orchestrator
  ├── RemoteA2aAgent("researcher")  → HTTP POST  http://localhost:8001/a2a/... (Adventure Seeker)
  ├── RemoteA2aAgent("judge")       → HTTP POST  http://localhost:8002/a2a/... (Guardian of Balance)
  └── RemoteA2aAgent("content_builder") → HTTP POST  http://localhost:8003/a2a/... (Storysmith)
```

### 5.4 FastAPI Proxy Layer

`app/main.py` serves two critical functions:

1. **Static File Hosting**: Serves the compiled React frontend from the `dist/` directory.
2. **Gemini Live WebSocket Proxy**: Exposes a `/ws/proxy` endpoint that handles the complex handshake and authentication with the Google Cloud Vertex AI endpoint.

**Proxy Workflow:**
1. Browser connects to `ws://localhost:8000/ws/proxy?project=...&model=...`.
2. FastAPI backend generates a fresh **Google OAuth2 bearer token**.
3. It establishes a secure WebSocket connection to the **LlmBidiService** in `us-central1`.
4. It bi-directionally pipes messages between the browser and Google, handling binary audio data and JSON tool calls transparently.

---

## 6. Subsystem C — Media Factory & Character Workshop

The **Media Factory** provides a seamless, context-aware visual layer that makes the story **feel alive**.

### 6.1 Cinematic Animation (Veo 3.1)
- **Technology**: **Veo 3.1** (Google's latest video generation model).
- **Function**: Transforms the static character description into a 4-second magical video preview.
- **Trigger**: Activated by the user via the "Animate" button in the Character Workshop.

### 6.2 Interleaved Illustrations (Gemini 2.5 Flash-Image)
- **Technology**: **Gemini 2.5 Flash-Image**.
- **Function**: Automatically generates high-quality watercolor illustrations for every new scene.
- **Mechanism**: The Main Agent (Puck) triggers a `generateIllustration` tool call, which is processed by the backend to return an image URL back into the live stream.

### 6.3 Portrait Transformation
The system supports a multimodal "likeness transfer" flow:
- **Input**: A real photo (JPEG/PNG) and a fairytale style prompt.
- **Process**: Gemini analyzes facial features from the upload and "repaints" them in the whimsical watercolor aesthetic, ensuring the child sees themselves as the hero.

---

## 7. Data Flows

### 7.1 Real-time Storytelling Flow (WebSocket)

```mermaid
sequenceDiagram
    participant B as Browser (React UI)
    participant P as FastAPI Proxy
    participant G as Gemini Live API

    B->>P: 1. WebSocket Connection
    P->>G: 2. Handshake & Auth (OAuth2)
    G-->>P: 3. Setup Complete
    P-->>B: 4. Setup Complete
    
    rect rgb(240, 240, 240)
        Note over B, G: Real-time Interaction
        B->>+P: Audio/Video Stream
        P->>+G: Forward Binary
        G-->>-P: AI Audio & Transcript
        P-->>-B: Forward Response
    end
    
    Note over G, B: Tool Calling
    G->>P: TOOL_CALL: awardBadge
    P->>B: forward awardBadge
```

### 7.2 Multi-agent Research Flow

The ADK agents are still utilized by the `content_builder` during specific story transitions or for pre-generating lore, following the same A2A orchestration described in Subsystem B.

---

## 8. Service Topology & Ports

| Service | Port | Technology | Start command |
|---|---|---|---|
| **App** (Frontend + Proxy) | `8000` | FastAPI + React (dist) | `uvicorn main:app` |
| **Adventure Seeker** | `8001` | ADK A2A server | `adk_app.py --a2a` |
| **Guardian of Balance**| `8002` | ADK A2A server | `adk_app.py --a2a` |
| **Storysmith** | `8003` | ADK A2A server | `adk_app.py --a2a` |
| **Orchestrator** | `8004` | ADK server | `adk_app.py` |

All services are started in the correct order by `run_local.ps1`. A 5-second sleep ensures leaf agents are ready before the orchestrator tries to resolve their agent cards.

---

## 9. Deployment

The system is designed for a split deployment strategy using two specialized automation scripts. This ensures that the "Supporting Brain" (internal agents) and the "Interaction Head" (Puck + Frontend) are correctly configured and secured.

### 9.1 Two-Stage Automation

1. **Supporting Agents (`backend/agents/deploy.ps1`)**:
   - Deploys Researcher, Judge, Content Builder, and Orchestrator.
   - Enforces `--no-allow-unauthenticated` for internal safety.
   - Orchestrates the capture of service URLs to build the agentic network graph.

2. **Main Application (`deploy_app.ps1`)**:
   - Deploys the unified **Gemini Tales App** (Puck + Frontend).
   - Handles the dual-stage build: compiles the React 19 frontend and wraps it with the FastAPI server.
   - Automatically injects `GOOGLE_CLOUD_PROJECT` and other metadata as environment variables.

### 9.2 Dynamic Configuration Injection

To allow for runtime updates to AI models and parameters without re-compiling the frontend, we use a **Dynamic Config Endpoint**:
- **Backend**: `GET /api/config` reads secrets (like API Keys and Model IDs) from the Cloud Run environment.
- **Frontend**: During initialization, the React app fetches this data to self-configure.
- **Benefit**: Judges can swap models or keys via the Google Cloud console, and the "Magic Mirror" will adapt instantly on the next page refresh.

### 9.3 Service Topology & Security

```mermaid
graph TD
    subgraph "Public Internet"
        UI[Public App URL]
    end
    
    subgraph "Google Cloud Run (VPC-Secured)"
        App["Gemini Tales App (Frontend + Puck)"]
        Orchestrator["Orchestrator Agent"]
        Brain["Researcher/Judge/Storysmith Agents"]
    end
    
    UI -->|Unauthenticated| App
    App -->|OAuth2 Token| Orchestrator
    Orchestrator -->|A2A + OAuth2| Brain
```

The **Gemini Tales App** is the only public entry point. All inter-agent communication is secured with Google OAuth2 bearer tokens, managed by `authenticated_httpx.py`.

**Observability:** The FastAPI app instruments traces with **OpenTelemetry** and exports them to **Google Cloud Trace** via `CloudTraceSpanExporter`.

---

## 10. Key Design Decisions

### Proxied WebSocket Communication
Instead of calling the Gemini Live API directly from the browser, we use a FastAPI WebSocket proxy. This ensures that the **Vertex AI credentials** and **Project ID** remain secure on the server, while still providing a low-latency pipe for audio and video data.

### React + Vite Single Page Application (SPA)
The front end was migrated from Vanilla JS to a React SPA. This allows for more robust state management of the complex real-time media streams and tool calls, as well as a more responsive and premium UI.

### Pre-story Agent Contextualization
To provide high-quality and safe content, we separated story *generation* from story *delivery*. The ADK agent network performs research and safety checks asynchronously before the live conversation starts, ensuring the "Live" AI has a solid, well-researched narrative foundation.

### LoopAgent with EscalationChecker
Rather than using a fixed number of research passes, the Judge's `output_schema` produces a structured `{ status: "pass"|"fail" }` verdict. The `EscalationChecker` reads this from session state and escalates the loop early when quality is sufficient (up to a safety cap of 3 iterations).

### A2A over direct agent calls
Using the A2A protocol means each agent is independently deployable and scalable. The Orchestrator only needs to know the agent card URL — not the implementation. This also enables mixing agents written in different languages or frameworks in the future.

### Session state as the shared-memory bus
The Orchestrator saves agent outputs (`research_findings`, `judge_feedback`) into ADK **session state**. Sub-agents read from this state in their prompts via the `{state[key]}` template syntax. This avoids passing large payloads through function arguments and keeps the inter-agent contract simple.

### Authenticated HTTPX client
`authenticated_httpx.py` wraps `google.auth.transport.requests` to inject an OAuth2 bearer token into every outgoing request. The same helper is used both by the Orchestrator (to call leaf agents) and by the FastAPI app (to call the Orchestrator). In local development, tokens are sourced from `gcloud auth application-default login`.

---

## 11. Tech Stack Summary

| Layer | Technology | Version / Specifics |
|---|---|---|
| **Main LLM Brain** | Gemini 3.1 Pro | For orchestration and writing |
| **Fast Reasoning** | Gemini 3.1 Flash-Lite | For research and judging |
| **Live Interaction** | Gemini Live 2.5 Flash | Real-time multimodal streaming |
| **Video Production** | Veo 3.1 | For character animation |
| **Image Production** | Gemini 2.5 Flash-Image | For scene illustrations |
| **Agent Framework** | Google Agent Development Kit (ADK) | 1.22.0 |
| **Frontend** | React 19 + Vite | "Magic Mirror" Dashboard |
| **Backend** | FastAPI (Python 3.12) | Main Agent bridge |
| **Deployment** | Google Cloud Run | Serverless microservices |
