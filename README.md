# ✨ Gemini Tales

![Status](https://img.shields.io/badge/status-active%20development-orange?style=flat-square)
![Hackathon](https://img.shields.io/badge/hackathon-Gemini%20Live%20Agent%20Challenge-4285F4?style=flat-square&logo=google)
![IDE](https://img.shields.io/badge/IDE-Google%20Antigravity-673AB7?style=flat-square&logo=googlecloud)
![Cloud](https://img.shields.io/badge/deployed-Cloud%20Run-blue?style=flat-square&logo=googlecloud)
![Version](https://img.shields.io/badge/version-v1.4.0-green?style=flat-square)

> **Turning screen time into active adventure — A magical AI storyteller that sees, hears, and moves with your child.**

Gemini Tales is an interactive storytelling experience that blends real-time AI conversation with physical activity. Built with a modern **React + Vite** frontend, it leverages the **Gemini Live API** for magical conversation and vision, while a specialized **multi-agent backend** (built with Google ADK) works behind the scenes to research local legends, verify safety, and craft movement-based "Hero's Challenges."

---

## 🧚 The Experience: Live Multimodal Storytelling

The frontend is a direct bridge to **Gemini 2.5 Flash Native Audio**, allowing for a unified **Voice + Vision** interaction.

| Feature | Magic Behind the Scenes |
|---|---|
| 🎙️ **Stable Voice Live** | Interruption-aware, low-latency conversation. The child can speak or change the story path at any time. |
| 📸 **Visual Awareness** | Real-time video stream (1 FPS) allows the AI to "see" costumes, toys, and movements. |
| 🎨 **Dynamic Illustrations** | Powered by **Gemini 3.1 Flash**, generating watercolor-style art that evolves with the plot. |
| ⚡ **Agent-Driven Context** | Before the story starts, the frontend calls the **Storysmith** agent network to research and craft a unique plot foundation. |
| 🎮 **Interactive Challenges** | The AI pauses the story for "Hero's Challenges," requiring physical actions (jumping, waving) detected via video feed. |

---

## 🤖 The Brain: Multi-Agent Story Engine

Our backend uses the **Google Agent Development Kit (ADK)** and the **A2A (Agent-to-Agent) protocol**, following a robust multi-agent architecture.

### 🎭 Meet the Agents

| Agent | Architecture Highlights | Performance Config |
|---|---|---|
| **Adventure Seeker** | Multi-step reasoning for physical activity planning. | **Gemini 3.1 Flash-Lite** + Grounding with Google Search. |
| **Guardian of Balance** | Strict safety validation using Pydantic schemas. | **Gemini 3.1 Flash-Lite** (Temp 0.1). |
| **Storysmith** | Advanced narrative weaving and character depth. | **Gemini 3.1 Pro** for literary quality. |

---

## ⚡ Optimization: Gemini 3.1 Flash-Lite & Pro

We have upgraded our agent network to the **Gemini 3.1** family:
- **Storysmith (3.1 Pro)**: Enhanced reasoning and "Thinking" levels (Medium) for richer, more complex narratives and better agentic orchestration.
- **Background Agents (3.1 Flash-Lite)**:
    - **Cost-Efficiency**: Most cost-efficient for high-volume traffic.
    - **Latency**: Low-latency for fast pre-story generation.
    - **Reliability**: Improved instruction following for strict safety validation.

---

## 🏗️ Architecture

For a detailed deep-dive into the system design, component responsibilities, and data flows, please refer to the [**ARCHITECTURE.md**](./ARCHITECTURE.md) document.

## 🚀 Getting Started

### Prerequisites

- **Python** 3.10+ & **Node.js** 20+
- **[uv](https://docs.astral.sh/uv/)** for backend management.
- **Google Cloud Project** with Vertex AI enabled.

### 1. Backend Launch
The backend runs five distributed services: the App, three specialized agents, and an orchestrator.

#### **Easy Mode (Windows)**
```powershell
# Starts all 5 services with automatic cleanup & dependency sync
.\run_local.ps1
```

#### **Manual Launcher**
```bash
# Start microservices (Leaf Agents)
uv run shared/adk_app.py agents/researcher --port 8001 --a2a
uv run shared/adk_app.py agents/judge --port 8002 --a2a
uv run shared/adk_app.py agents/content_builder --port 8003 --a2a

# Start Orchestrator & Gateway
uv run shared/adk_app.py agents/orchestrator --port 8004
uv run app/main.py
```

---

## 🛠️ Tech Stack

- **Frontend**: **React 19**, **Vite**, **TypeScript** (v1.1 Migration), and **Tailwind CSS**.
- **Intelligence**: **Gemini 3.1 Flash-Lite/Pro** & **Gemini 3.1 Flash Preview** (Images).
- **Core Framework**: **Google ADK** & **Agent-to-Agent (A2A)** Protocol.
- **Infrastructure**: **FastAPI** (Python 3.12), **WebSockets**, and **Google Cloud Run**.
- **Observability**: **OpenTelemetry** with **Google Cloud Trace**.
- **Dev Tools**: **Antigravity IDE** for agentic orchestration and debugging.

---

## 📜 License

MIT — see [LICENSE](LICENSE).

*Created with ❤️ for the next generation of explorers by [Veronika Kashtanova](https://x.com/veron_code)*
