# voice-coding-agent

Phase 1: text-in/text-out agentic loop built on the base `@anthropic-ai/sdk`.

## Setup

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
npm run build
```

## Usage

```bash
npm run dev -- "list the files in this directory"
# or after building:
node dist/cli.js "create a file called hello.txt with the text Hello World"
```
