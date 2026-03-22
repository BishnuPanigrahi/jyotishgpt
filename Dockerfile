# ============================================================
# JyotishGPT - Vedic Astrology AI Chatbot
# Multi-stage Dockerfile for production deployment
# ============================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDeps for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application (frontend + backend)
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy build output from builder
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV DATA_DIR=/app/data

# Expose the port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/profiles || exit 1

# Start the server
CMD ["node", "dist/index.cjs"]
