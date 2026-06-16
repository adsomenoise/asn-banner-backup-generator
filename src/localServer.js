import express from 'express';
import path from 'path';
import { logger } from './logger.js';

export function createServer(port = 3000, tempDir = '') {
  const staticDir = tempDir || path.resolve('temp');
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

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
    const server = app.listen(port, 'localhost', () => {
      logger.stepSuccess(`Local server running at http://localhost:${port}`);
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${port} in use, trying ${port + 1}`);
        createServer(port + 1, tempDir).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

export async function closeServer(server) {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.step('Local server stopped');
  }
}

export function getServerUrl(serverPort, bannerFolderName, entryFileName = 'index.html') {
  return `http://localhost:${serverPort}/${bannerFolderName}/${entryFileName}`;
}

export function getPort(server) {
  return server ? server.address().port : 3000;
}
