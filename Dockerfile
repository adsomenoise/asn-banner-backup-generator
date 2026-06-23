# Multi-stage build for optimized image size
FROM node:20 AS builder

# Install build dependencies for native modules (sharp, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and Playwright browser
RUN npm ci && npm run postinstall

# Production stage
FROM node:20

# Install runtime dependencies for Playwright and image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxrandr2 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxkbcommon0 \
  libgbm1 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libcairo2 \
  libjpeg62-turbo \
  libpng16-16 \
  libatk1.0-0 \
  libnspr4 \
  libnss3 \
  libdbus-1-3 \
  libasound2 \
  libatspi2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Install Playwright browsers in production stage
RUN npm run postinstall

# Create necessary directories
RUN mkdir -p temp/uploads temp/work temp/results

# Health check — use the app's own /api/v1/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||3001;require('http').get('http://localhost:'+p+'/api/v1/health',r=>{r.resume();process.exit(r.statusCode<200||r.statusCode>=300?1:0)}).on('error',()=>process.exit(1))"

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Start app with preflight checks
CMD ["npm", "run", "serve:prod"]
