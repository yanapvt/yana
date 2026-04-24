# YANA / OGO Platform

WhatsApp-first AI orchestration platform for tourism and real-world service domains.

**Cloud Platform Support:** AWS | Google Cloud Platform (GCP)

## Overview

YANA / OGO is a state-aware orchestration engine that uses WhatsApp as the primary user interface, backend-controlled state and context, schema-driven workflows, one primary LLM for decision support, MCP-style tool calling as an interface layer, and Nango as the integration/auth/normalization layer.

## Project Structure

```
.
├── src/
│   ├── config/          # Environment configuration
│   ├── types/           # Core TypeScript type definitions
│   ├── tests/           # Test files
│   └── index.ts         # Application entry point
├── .env.example         # Example environment variables
├── package.json         # Project dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── .eslintrc.json       # ESLint configuration
└── .prettierrc.json     # Prettier configuration
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and configure your environment variables:
   ```bash
   cp .env.example .env
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Development

Run in development mode with hot reload:
```bash
npm run dev
```

## Deployment

### Google Cloud Platform (Recommended)

**Quick Start (5 minutes):**
```bash
# Run automated setup
./scripts/setup-gcp.sh

# Deploy to Cloud Run
npm run deploy:gcp:run
```

See [GCP_QUICKSTART.md](GCP_QUICKSTART.md) for detailed instructions.

**Full Documentation:** [PRODUCTION_DEPLOYMENT_GCP.md](PRODUCTION_DEPLOYMENT_GCP.md)

### Amazon Web Services

See [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) for AWS deployment instructions.

### Deployment Options

| Platform | Command | Best For |
|----------|---------|----------|
| **GCP Cloud Run** | `npm run deploy:gcp:run` | Serverless, auto-scaling |
| **GCP App Engine** | `npm run deploy:gcp:appengine` | Fully managed PaaS |
| **GCP GKE** | `npm run deploy:gcp:gke` | Kubernetes, full control |
| **AWS Elastic Beanstalk** | `eb deploy` | AWS managed platform |
| **AWS ECS** | See AWS guide | Docker containers |
| **Heroku** | `git push heroku main` | Simplest deployment |


## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run in development mode with hot reload
- `npm start` - Run the compiled application
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint code with ESLint
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Core Type Definitions

The platform includes the following core types (see `src/types/core.ts`):

### Enums
- `BookingState` - Booking lifecycle states
- `PaymentState` - Payment lifecycle states
- `ErrorCategory` - Error classification categories
- `IntentMode` - User intent modes (Explore, Book Now, Compare)

### Core Interfaces
- `InboundMessage` - Incoming WhatsApp messages
- `Session` - User session state
- `UserProfile` - User profile and preferences
- `SchemaDefinition` - Workflow schema definitions
- `SchemaField` - Individual schema field definitions
- `LLMDecisionOutput` - LLM decision outputs
- `ToolCallRequest` - Tool call requests
- `ToolCallResult` - Tool call results
- `BookingRecord` - Booking records
- `PaymentRecord` - Payment records
- `AuditLogEntry` - Audit log entries
- `CorrelationContext` - Request correlation context

## Environment Configuration

The platform uses environment variables for configuration. See `.env.example` for all available options.

Key configuration areas:
- Twilio / WhatsApp integration
- PostgreSQL database
- Redis state store
- LLM provider (OpenAI, etc.)
- Translation service
- Text-to-Speech service
- Nango integration layer
- Feature flags
- Operational settings (timeouts, retries, etc.)

## Architecture

The platform follows a modular architecture:

1. **AI Gateway** - Webhook validation, rate limiting, session initiation
2. **State Layer** - Redis (hot state) + Postgres (durable state)
3. **Orchestrator** - Intent detection, schema management, state transitions
4. **LLM Layer** - Decision support and UI generation
5. **MCP Interface** - Tool call validation and routing
6. **Provider Adapters** - External API integrations via Nango
7. **WhatsApp Renderer** - Message formatting and delivery

## License

ISC
