import express from 'express';
import path from 'path';
import { logger } from './logger.js';

let server = null;
let serverPort = 3000;
let tempRoot = '';

export function createServer(port = 3000, tempDir = '') {
  serverPort = port;
  if (tempDir) tempRoot = tempDir;
  const app = express();
  
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  
  const staticDir = tempRoot || path.resolve('temp');
  app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      }
    }
  }));
  
  app.use((err, req, res, next) => {
    logger.error(`Server error: ${err.message}`);
    res.status(500).send('Internal Server Error');
  });
  
  return new Promise((resolve, reject) => {
    server = app.listen(port, 'localhost', () => {
      logger.stepSuccess(`Local server running at http://localhost:${port}`);
      resolve(server);
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${port} in use, trying ${port + 1}`);
        createServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

export function getServerUrl(bannerFolderName, entryFileName = 'index.html') {
  return `http://localhost:${serverPort}/${bannerFolderName}/${entryFileName}`;
}

export async function closeServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
    logger.step('Local server stopped');
  }
}

export function getPort() {
  return serverPort;
}