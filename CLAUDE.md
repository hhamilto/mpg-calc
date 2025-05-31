# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Start development server:**
```bash
cd server && npm run dev
```

**Start production server:**
```bash
cd server && npm start
```

**Format code:**
```bash
cd server && npm run format
```

**Deploy to production:**
```bash
./server/scripts/deploy
```

## Environment Variables Required

- `TWILIO_API_TOKEN` - Twilio API token for SMS/MMS webhook processing
- `DB_PASSWORD` - PostgreSQL database password
- `OPENAI_API_KEY` - OpenAI API key for image classification and text extraction

## Architecture Overview

This is a Node.js Express server that processes SMS/MMS messages via Twilio webhooks to track vehicle gas mileage. The system:

1. **Receives MMS images** via Twilio webhook at `/webhooks/twilio`
2. **Classifies images** using OpenAI GPT-4o to determine if it's a gas pump display or car odometer
3. **Extracts numeric data** (gallons or mileage) from images using OpenAI vision API
4. **Matches pump/odometer pairs** by phone number and timestamps to create fuel-up records
5. **Calculates MPG** by pairing consecutive fuel-ups and displays results on web interface

### Key Components

- **index.js** - Main Express server with webhook handling and web interface
- **image-extractor.js** - OpenAI API integration for image classification and text extraction
- **migrations/** - PostgreSQL schema migrations for the images table

### Database Schema

PostgreSQL table `images` with columns:
- `class` - enum: 'unknown', 'pump', 'odometer'  
- `mileage` - integer odometer reading
- `gallons` - decimal fuel amount
- `fueling_id` - UUID linking pump/odometer pairs
- `phone_number` - user's phone number from SMS

### Deployment

Production deployment uses a simple tar/scp workflow to a DigitalOcean droplet with systemd service management. See `notes.md` for detailed deployment steps.