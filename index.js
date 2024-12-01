const debugLog = (message, opts) => {
  if (opts.debug) {
    console.log(`[DEBUG] ${message}`);
  }
};
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const url = require('url');
const { Readable } = require('stream');

// Setup frames in memory
let original;
let flipped;
let cachedOriginal;
let cachedFlipped;

// Function to pad a frame to a specific height
const padFrame = (frame, height) => {
  const lines = frame.split('\n');
  while (lines.length < height) {
    lines.push(' '.repeat(lines[0].length));
  }
  return lines.join('\n');
};

// Function to cache frames
const cacheFrames = (frames) => {
  return frames.map((frame) => Buffer.from(frame));
};
// Load frames asynchronously
(async () => {
  const framesPath = 'frames';
  const files = await fs.readdir(framesPath);

  original = await Promise.all(
    files.map(async (file) => {
      const frame = await fs.readFile(path.join(framesPath, file));
      return frame.toString();
    })
  );
  flipped = original.map((f) => f.split('').reverse().join(''));

  // Calculate the maximum height of all frames
  const maxHeight = Math.max(
    ...original.map((frame) => frame.split('\n').length)
  );

  // Pad each frame to have the same height
  original = original.map((frame) => padFrame(frame, maxHeight));
  flipped = flipped.map((frame) => padFrame(frame, maxHeight));

  // Cache the frames
  cachedOriginal = cacheFrames(original);
  cachedFlipped = cacheFrames(flipped);
})().catch((err) => {
  console.error('Error loading frames:', err);
});

const streamer = (stream, opts) => {
  let index = 0;
  const frames = opts.flip ? cachedFlipped : cachedOriginal;
  const frameCount = frames.length;
  const moveCursorToStart = Buffer.from('\x1b[H');
  const hideCursor = Buffer.from('\x1b[?25l');
  const showCursor = Buffer.from('\x1b[?25h');

  debugLog('Initializing stream', opts);
  // Clear screen and hide cursor only once at the start
  stream.push(Buffer.from('\x1b[2J\x1b[3J\x1b[H'));
  stream.push(hideCursor);

  const interval = setInterval(() => {
    stream.push(moveCursorToStart);
    stream.push(frames[index]);
    index = (index + 1) % frameCount;

    if (opts.debug && index === 0) {
      debugLog('Completed one full cycle of frames', opts);
    }
  }, 100);

  return () => {
    clearInterval(interval);
    stream.push(showCursor);
    debugLog('Stream ended', opts);
  };
};

const validateQuery = ({ flip, debug }) => ({
  flip: String(flip).toLowerCase() === 'true',
  debug: String(debug).toLowerCase() === 'true',
});

const server = http.createServer((req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  const opts = validateQuery(query);

  debugLog(`Received request: ${req.url}`, opts);
  if (pathname === '/healthcheck') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }

  if (
    req.headers['user-agent'] &&
    !req.headers['user-agent'].includes('curl')
  ) {
    debugLog('Non-curl user agent detected, redirecting', opts);
    res.writeHead(302, {
      Location: 'https://github.com/PatoFlamejanteTV/duck.live',
    });
    return res.end();
  }

  debugLog('Starting stream', opts);
  const stream = new Readable({ read() {} });
  stream.pipe(res);

  if (opts.debug) {
    res.write('Debug mode enabled. Streaming will begin shortly...\n');
    res.write(`Flip: ${opts.flip}\n`);
    res.write(
      `Total frames: ${(opts.flip ? cachedFlipped : cachedOriginal).length}\n`
    );
    res.write('---\n');
  }

  const cleanup = streamer(stream, opts);

  req.on('close', () => {
    debugLog('Request closed, cleaning up', opts);
    cleanup();
    stream.destroy();
  });
});

const findAvailablePort = (startPort) => {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        findAvailablePort(startPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
};

const startServer = async () => {
  try {
    const port = await findAvailablePort(3000);
    server.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
};

startServer();
