# VoiceCare – AI Customer Support

VoiceCare is a modern, AI-powered customer support experience that blends real-time voice, text chat, and industry-specific workflows into a single operator console. Built with React and TypeScript, the app showcases how an AI agent can handle end-to-end conversations across multiple service domains while offering a seamless handoff to human specialists when needed.

- **Live voice calls** with mute controls, waveform visualization, and voice-activity indicators
- **Chat interface** that mirrors the conversation, captures transcripts, and surfaces tool executions
- **Industry-aware suggestion cards** for Telecommunications, Government Services, and Financial Services
- **Context side panel** highlighting caller profile, verification status, recent actions, and case notes

## Architecture at a Glance

- **Framework:** React 19 + TypeScript bundled with Vite
- **UI Toolkit:** Radix primitives, Tailwind CSS, custom components
- **Audio Layer:** WebRTC session management, Web Audio API for live waveform rendering
- **State & Utilities:** Modular hooks (`use-realtime-session`, `use-voice-activity`) and shared constants/types

Project layout (abridged):

```
src/
├── App.tsx
├── components/
│   ├── CallControls.tsx
│   ├── ChatComposer.tsx
│   ├── ContextPanel.tsx
│   ├── MessageBubble.tsx
│   ├── SuggestionCards.tsx
│   ├── VoiceActivityIndicator.tsx
│   ├── WaveformVisualizer.tsx
│   └── ui/… (Radix-based primitives)
├── hooks/
│   ├── use-realtime-session.ts
│   └── use-voice-activity.ts
├── lib/
│   ├── constants.ts (industry cards, client config, system prompt)
│   ├── types.ts
│   └── utils.ts
└── styles/
	 └── theme.css
```

## Getting Started

1. **Install dependencies**
	```bash
	npm install
	```

2. **Start the development server**
	```bash
	npm run dev
	```

3. **Build for production**
	```bash
	npm run build
	```

4. **Preview the production build**
	```bash
	npm run preview
	```

### Backend configuration

The frontend expects a Python backend that exposes the realtime voice/chat APIs. If the UI is not running on the same container (or host) as that backend, change the `backendBaseUrl` value in [`src/lib/constants.ts`](src/lib/constants.ts) to point to the appropriate address before starting the app.

```ts
export const CLIENT_CONFIG = {
  backendBaseUrl: "http://<your-backend-host>:8080/api",
  deployment: "gpt-realtime",
  voice: "verse",
};
```

## Available Scripts

- `npm run dev` – Launch Vite in development mode
- `npm run build` – Emit production assets
- `npm run preview` – Preview the built output locally
- `npm run lint` – Run ESLint checks

## Browser & Environment Requirements

- Node.js 18+
- Modern browser with WebRTC and Web Audio API support (Chromium, Firefox, Safari)
- Microphone access for voice features

## License

This project is provided under the MIT License. See [`LICENSE`](LICENSE) for details.
