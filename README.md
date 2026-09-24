# WRITR

An infinite canvas writing tool powered by AI. Place text nodes, connect ideas, and transform your writing with a single click.

## Features

- **Infinite canvas** — drag, pan, zoom, and arrange nodes freely
- **AI transforms** — shorten, expand, improve, or change tone with Groq AI
- **Platform presets** — reformat writing for Instagram, LinkedIn, Medium, or Twitter/X
- **Node merging** — blend two pieces of writing into one cohesive piece
- **Brainstorm chat** — an AI thinking partner that reads your canvas
- **Custom prompts** — describe any transformation and apply it
- **Image paste** — paste an image and the AI describes it as a node

## Setup

1. Clone or download this repo
2. Get a free API key from [console.groq.com](https://console.groq.com)
3. Create a `.env` file in the root folder:
   ```
   GROQ_API_KEY=your_key_here
   ```
4. Install dependencies and run:
   ```
   npm install
   cd client && npm install && cd ..
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000)

## Tech

- React + TypeScript + Vite (frontend)
- Express + Node.js (backend)
- Groq SDK with Llama 3.3 70B
